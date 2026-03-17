"""
Inference script: run the mission planner and produce
an optimised sequence of (row, col) waypoints.

Usage:
    python infer.py --map mars_maps/mars_map_00001.csv --brain rover_model.npy
    python infer.py --map mars_maps/mars_map_00001.csv
"""

import argparse
import json
import os

from ai import MarsMission, RLAgent, DAY_STEPS, CYCLE

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


# Hard cap to prevent infinite loops (50×50 grid, up to ~20 minerals, generous headroom)
MAX_STEPS = 10_000


def run_inference(map_file: str, brain_file: str | None = None, time_limit_hours: int = 24) -> dict:
    """
    Run a single requirements-aligned planning episode and return the full result.

    The route planner uses obstacle-aware A* paths plus a feasibility-aware
    target selector. A mineral is only pursued if the rover can still mine it
    and return to the start within the remaining time budget while respecting
    battery drain, solar charging, and half-hour mining duration.

    Returns a dict with:
        path        – list of [row, col] coordinates visited each step
        minerals    – list of {pos, type, step} for each mineral collected
        battery     – list of battery level at each step
        steps_used  – total half-hour steps consumed
        success     – True if the rover finished back at the start position
        logs        - detailed logs for each step
    """
    mission = MarsMission(map_file)
    agent = RLAgent(mission)

    pos = mission.start_pos
    battery = 100.0
    mins = set(mission.minerals.keys())
    step = 0
    total_distance = 0

    path = [list(pos)]
    battery_log = [battery]
    minerals_collected = []
    logs = []

    agent._path_cache = []
    agent._path_target = None

    # The PDF defines the input time in hours and movement/mining in 0.5h slots.
    max_steps = min(MAX_STEPS, max(1, int(time_limit_hours * 2)))
    active_target = None

    logs.append({
        "step": step,
        "time_hours": step * 0.5,
        "is_day": (step % CYCLE) < DAY_STEPS,
        "position": list(pos),
        "battery": round(battery, 2),
        "speed": 0,
        "distance_traveled": total_distance,
        "minerals_collected": [],
        "action": "start"
    })

    while step < max_steps:
        if active_target not in mins:
            active_target = None

        if active_target is None:
            selection = agent.choose_next_target(pos, battery, step, mins, max_steps)
            if selection is not None:
                active_target, _ = selection

        target = active_target
        if target is None:
            target = mission.start_pos if pos != mission.start_pos else None

        if target is None:
            if mins and agent._is_day(step) and battery < 100:
                battery = agent._standby_battery(battery, step)
                step += 1
                path.append(list(pos))
                battery_log.append(round(battery, 2))
                logs.append({
                    "step": step,
                    "time_hours": step * 0.5,
                    "is_day": (step % CYCLE) < DAY_STEPS,
                    "position": list(pos),
                    "battery": round(battery, 2),
                    "speed": 0,
                    "distance_traveled": total_distance,
                    "minerals_collected": [],
                    "action": "move"
                })
                if battery <= 0:
                    print("Battery depleted while waiting — mission failed.")
                    break
                continue
            break

        current_path = agent.get_path(pos, target)
        home_path = agent.get_path(target, mission.start_pos) if target != mission.start_pos else []
        reserve_blocks = len(current_path) + len(home_path)
        dist_moved = min(
            len(current_path),
            agent.pick_route_speed(reserve_blocks, battery, step),
        )

        if dist_moved <= 0:
            if agent._is_day(step) and battery < 100:
                battery = agent._standby_battery(battery, step)
                step += 1
                path.append(list(pos))
                battery_log.append(round(battery, 2))
                logs.append({
                    "step": step,
                    "time_hours": step * 0.5,
                    "is_day": (step % CYCLE) < DAY_STEPS,
                    "position": list(pos),
                    "battery": round(battery, 2),
                    "speed": 0,
                    "distance_traveled": total_distance,
                    "minerals_collected": [],
                    "action": "move"
                })
                if battery <= 0:
                    print("Battery depleted while recharging — mission failed.")
                    break
                continue

            print("No safe movement remained for the rover — mission ended.")
            break

        new_pos = current_path[dist_moved - 1]
        battery = agent._move_battery(battery, step, dist_moved)

        step += 1
        total_distance += dist_moved
        path.append(list(new_pos))
        battery_log.append(round(battery, 2))

        logs.append({
            "step": step,
            "time_hours": step * 0.5,
            "is_day": (step % CYCLE) < DAY_STEPS,
            "position": list(new_pos),
            "battery": round(battery, 2),
            "speed": dist_moved,
            "distance_traveled": total_distance,
            "minerals_collected": [],
            "action": "move"
        })

        pos = new_pos

        if battery <= 0:
            print("Battery depleted — mission failed.")
            break

        # Mining occupies the full next half-hour slot on the mineral block.
        if active_target is not None and pos == active_target and pos in mins:
            if step >= max_steps:
                break

            battery = agent._mine_battery(battery, step)
            min_type = mission.minerals[pos]
            mins.remove(pos)
            step += 1
            minerals_collected.append({
                "pos": list(pos),
                "type": min_type,
                "step": step,
            })
            path.append(list(pos))
            battery_log.append(round(battery, 2))

            logs.append({
                "step": step,
                "time_hours": step * 0.5,
                "is_day": (step % CYCLE) < DAY_STEPS,
                "position": list(pos),
                "battery": round(battery, 2),
                "speed": 0,
                "distance_traveled": total_distance,
                "minerals_collected": [min_type],
                "action": "mine"
            })

            active_target = None

            if battery <= 0:
                print("Battery depleted during mining — mission failed.")
                break

        elif pos == mission.start_pos and active_target is None:
            break

        if pos == mission.start_pos and target == mission.start_pos and not mins:
            break

    return {
        "path": path,
        "minerals": minerals_collected,
        "battery": battery_log,
        "steps_used": step,
        "success": (pos == mission.start_pos and battery > 0),
        "start": list(mission.start_pos),
        "all_minerals": {str(k): v for k, v in mission.minerals.items()},
        "logs": logs
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Mars Rover mission planner")
    parser.add_argument(
        "--map",
        default=os.path.join(BASE_DIR, "mars_maps/mars_map_00001.csv"),
        help="Path to the map CSV file",
    )
    parser.add_argument(
        "--brain",
        default=os.path.join(BASE_DIR, "rover_model.npy"),
        help="Unused legacy argument kept for CLI compatibility",
    )
    parser.add_argument("--json", action="store_true", help="Output result as JSON")
    args = parser.parse_args()

    result = run_inference(args.map, args.brain)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"\nSteps used : {result['steps_used']}")
        print(f"Minerals   : {len(result['minerals'])} collected")
        for m in result["minerals"]:
            print(f"  [{m['step']:3d}] {m['type']} at {m['pos']}")
        print(f"Success    : {result['success']}")
        print(f"\nFirst 10 waypoints: {result['path'][:10]}")
        print(f"Full path length  : {len(result['path'])} points")
