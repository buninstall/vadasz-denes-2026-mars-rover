"""
Inference script: load a trained Q-table and run a greedy episode to produce
an optimised sequence of (row, col) waypoints.

Usage:
    python infer.py --map mars_maps/mars_map_00001.csv --brain rover_model.npy
    python infer.py --map mars_maps/mars_map_00001.csv --hours 24
"""

import argparse
import json
import os
from typing import Optional
import numpy as np
from ai import MarsMission, RLAgent, DAY_STEPS, CYCLE, K_CONSTANT

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


# Hard cap to prevent infinite loops (50×50 grid, up to ~20 minerals, generous headroom)
MAX_STEPS = 10_000


def _is_day(step: int) -> bool:
    return (step % CYCLE) < DAY_STEPS


def _apply_energy_slot(battery: float, step: int, consumption: float) -> Optional[float]:
    """Apply one half-hour slot. Return None if action is not energetically feasible."""
    solar_charge = 10 if _is_day(step) else 0
    next_battery = battery - consumption + solar_charge
    if next_battery < 0:
        return None
    return max(0.0, min(100.0, next_battery))


def _path_block_distance(agent: RLAgent, start: tuple[int, int], target: tuple[int, int]) -> Optional[int]:
    if start == target:
        return 0
    path = agent._compute_path(start, target)
    if not path or path[-1] != target:
        return None
    return len(path)


def _slots_for_blocks(blocks: int, speed: int = 3) -> int:
    if blocks <= 0:
        return 0
    return (blocks + speed - 1) // speed


def _can_return_home(
    agent: RLAgent,
    pos: tuple[int, int],
    battery: float,
    step: int,
    available_slots: int,
) -> bool:
    blocks_home = _path_block_distance(agent, pos, agent.m.start_pos)
    if blocks_home is None:
        return False

    for speed in (3, 2, 1):
        if _slots_for_blocks(blocks_home, speed) > available_slots:
            continue
        if agent._can_travel_blocks(battery, step, blocks_home, speed):
            return True

    return blocks_home == 0


def _can_mine_and_return(
    agent: RLAgent,
    pos: tuple[int, int],
    mineral: tuple[int, int],
    battery: float,
    step: int,
    available_slots: int,
) -> bool:
    blocks_to_mineral = _path_block_distance(agent, pos, mineral)
    blocks_home = _path_block_distance(agent, mineral, agent.m.start_pos)

    if blocks_to_mineral is None or blocks_home is None:
        return False

    for speed_to in (3, 2, 1):
        slots_to = _slots_for_blocks(blocks_to_mineral, speed_to)
        travel_to = agent._simulate_travel(battery, step, blocks_to_mineral, speed_to)
        if travel_to is None:
            continue
        battery_after_travel, step_after_travel = travel_to

        mining_battery = _apply_energy_slot(battery_after_travel, step_after_travel, 2)
        if mining_battery is None:
            continue
        step_after_mining = step_after_travel + 1

        for speed_home in (3, 2, 1):
            slots_home = _slots_for_blocks(blocks_home, speed_home)
            total_slots = slots_to + 1 + slots_home
            if total_slots > available_slots:
                continue
            if agent._can_travel_blocks(mining_battery, step_after_mining, blocks_home, speed_home):
                return True

    return False


def _choose_feasible_target(
    agent: RLAgent,
    pos: tuple[int, int],
    mins: set[tuple[int, int]],
    battery: float,
    step: int,
    remaining_slots: int,
) -> Optional[tuple[int, int]]:
    if not mins:
        return None

    candidates = sorted(
        mins,
        key=lambda m: max(abs(pos[0] - m[0]), abs(pos[1] - m[1])),
    )[:25]

    best_target = None
    best_score = None

    for mineral in candidates:
        blocks_to_mineral = _path_block_distance(agent, pos, mineral)
        blocks_home = _path_block_distance(agent, mineral, agent.m.start_pos)
        if blocks_to_mineral is None or blocks_home is None:
            continue

        optimistic_slots = _slots_for_blocks(blocks_to_mineral, 3) + 1 + _slots_for_blocks(blocks_home, 3)
        if optimistic_slots > remaining_slots:
            continue

        if not _can_mine_and_return(agent, pos, mineral, battery, step, remaining_slots):
            continue

        score = (optimistic_slots, blocks_to_mineral)
        if best_score is None or score < best_score:
            best_score = score
            best_target = mineral

    return best_target


def run_inference(map_file: str, brain_file: str, time_limit_hours: int = 24) -> dict:
    """
    Run a single greedy episode (epsilon=0) and return the full result.
    The mission runs until all minerals are collected and the rover returns
    home, or until the battery is depleted, or the time limit is reached.

    Returns a dict with:
        path        – list of [row, col] coordinates visited each step
        minerals    – list of {pos, type, step} for each mineral collected
        battery     – list of battery level at each step
        steps_used  – total half-hour steps consumed
        success     – True if all minerals collected and rover returned home
        logs        - detailed logs for each step
    """
    if time_limit_hours < 24:
        raise ValueError("time_limit_hours must be at least 24")

    mission = MarsMission(map_file)
    agent = RLAgent(mission)

    # Load the trained brain
    loaded_q = np.load(brain_file)
    if loaded_q.shape != agent.q_table.shape:
        if loaded_q.size == agent.q_table.size:
            loaded_q = loaded_q.reshape(agent.q_table.shape)
        else:
            raise ValueError(
                f"Invalid Q-table shape: got {loaded_q.shape}, expected {agent.q_table.shape}"
            )
    agent.q_table = loaded_q

    # Greedy policy — no exploration
    agent.epsilon = 0.0

    pos = mission.start_pos
    battery = 100.0
    mins = set(mission.minerals.keys())
    step = 0
    total_distance = 0

    path = [list(pos)]
    battery_log = [battery]
    minerals_collected = []
    logs = []

    time_budget_steps = int(time_limit_hours * 2)
    max_steps = min(MAX_STEPS, time_budget_steps)

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

    termination_reason = "time_limit_reached"

    while step < max_steps:
        remaining_slots = max_steps - step
        s_idx = agent.get_state_index(pos, battery, step, mins)

        # Pure greedy: 0 = mine, 1 = go home
        action = int(np.argmax(agent.q_table[s_idx])) if mins else 1

        home_blocks = _path_block_distance(agent, pos, mission.start_pos)
        if home_blocks is None:
            termination_reason = "home_unreachable"
            break

        must_return = (
            not mins
            or remaining_slots <= _slots_for_blocks(home_blocks, 3)
            or not _can_return_home(agent, pos, battery, step, remaining_slots)
        )

        target = mission.start_pos
        if not must_return and mins:
            preferred_target = min(
                mins,
                key=lambda m: max(abs(pos[0] - m[0]), abs(pos[1] - m[1])),
            )

            if action == 0 and _can_mine_and_return(
                agent,
                pos,
                preferred_target,
                battery,
                step,
                remaining_slots,
            ):
                target = preferred_target
            else:
                feasible_target = _choose_feasible_target(
                    agent,
                    pos,
                    mins,
                    battery,
                    step,
                    remaining_slots,
                )
                target = feasible_target if feasible_target is not None else mission.start_pos

        path_to_target = []
        if pos != target:
            path_to_target = agent._compute_path(pos, target)
            if not path_to_target or path_to_target[-1] != target:
                if target != mission.start_pos:
                    target = mission.start_pos
                    path_to_target = agent._compute_path(pos, target)
                if target == mission.start_pos and pos != target and (
                    not path_to_target or path_to_target[-1] != target
                ):
                    termination_reason = "home_unreachable"
                    break

        next_pos = pos
        dist_moved = 0
        speed_choice = 0

        if path_to_target:
            desired_speed = agent._pick_speed(pos, battery, step)
            battery_after_move = None

            for speed in range(min(3, max(1, desired_speed)), 0, -1):
                moved = min(speed, len(path_to_target))
                consumption = (K_CONSTANT * moved ** 2) if moved > 0 else 1
                maybe_battery = _apply_energy_slot(battery, step, consumption)
                if maybe_battery is None:
                    continue
                speed_choice = speed
                dist_moved = moved
                next_pos = path_to_target[moved - 1] if moved > 0 else pos
                battery_after_move = maybe_battery
                break

            if battery_after_move is None:
                battery_after_move = _apply_energy_slot(battery, step, 1)
                speed_choice = 0
                dist_moved = 0
                next_pos = pos
        else:
            battery_after_move = _apply_energy_slot(battery, step, 1)

        if battery_after_move is None:
            termination_reason = "battery_depleted"
            break

        battery = battery_after_move

        step += 1
        total_distance += dist_moved
        pos = next_pos
        path.append(list(pos))
        battery_log.append(round(battery, 2))

        logs.append({
            "step": step,
            "time_hours": step * 0.5,
            "is_day": (step % CYCLE) < DAY_STEPS,
            "position": list(pos),
            "battery": round(battery, 2),
            "speed": speed_choice,
            "distance_traveled": total_distance,
            "minerals_collected": [],
            "action": "move"
        })

        # Mining: one extra 0.5h slot, 2 energy consumed, rover stays put
        if pos in mins and step < max_steps:
            battery_after_mining = _apply_energy_slot(battery, step, 2)
            if battery_after_mining is not None:
                remaining_after_mining = max_steps - (step + 1)
                if _can_return_home(
                    agent,
                    pos,
                    battery_after_mining,
                    step + 1,
                    remaining_after_mining,
                ):
                    battery = battery_after_mining
                    min_type = mission.minerals[pos]
                    minerals_collected.append({
                        "pos": list(pos),
                        "type": min_type,
                        "step": step + 1,
                    })
                    mins.remove(pos)
                    step += 1  # mining occupies one half-hour slot
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

        if not mins and pos == mission.start_pos:
            termination_reason = "mission_completed"
            break

    success = (
        pos == mission.start_pos
        and termination_reason not in {"battery_depleted", "home_unreachable"}
    )
    if success and termination_reason == "time_limit_reached":
        termination_reason = "returned_home_on_time"

    return {
        "path": path,
        "minerals": minerals_collected,
        "battery": battery_log,
        "steps_used": step,
        "success": success,
        "start": list(mission.start_pos),
        "all_minerals": {str(k): v for k, v in mission.minerals.items()},
        "logs": logs,
        "termination_reason": termination_reason,
        "time_limit_hours": time_limit_hours,
        "time_limit_steps": max_steps,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Mars Rover Q-table inference")
    parser.add_argument(
        "--map",
        default=os.path.join(BASE_DIR, "mars_maps/mars_map_00001.csv"),
        help="Path to the map CSV file",
    )
    parser.add_argument(
        "--brain",
        default=os.path.join(BASE_DIR, "rover_model.npy"),
        help="Path to the trained Q-table .npy file",
    )
    parser.add_argument(
        "--hours",
        type=int,
        default=24,
        help="Mission time limit in hours (minimum 24)",
    )
    parser.add_argument("--json", action="store_true", help="Output result as JSON")
    args = parser.parse_args()

    result = run_inference(args.map, args.brain, args.hours)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"\nSteps used : {result['steps_used']}")
        print(f"Minerals   : {len(result['minerals'])} collected")
        for m in result["minerals"]:
            print(f"  [{m['step']:3d}] {m['type']} at {m['pos']}")
        print(f"Success    : {result['success']}")
        print(f"Reason     : {result['termination_reason']}")
        print(f"\nFirst 10 waypoints: {result['path'][:10]}")
        print(f"Full path length  : {len(result['path'])} points")
