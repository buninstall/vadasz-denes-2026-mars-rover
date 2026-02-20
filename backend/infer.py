"""
Inference script: load a trained Q-table and run a greedy episode to produce
an optimised sequence of (row, col) waypoints.

Usage:
    python infer.py --map mars_maps/mars_map_00001.csv --brain mars_rover_brain.npy
    python infer.py --map mars_maps/mars_map_00001.csv  # uses mars_rover_brain.npy by default
"""

import argparse
import json
import os
import numpy as np
from ai import MarsMission, RLAgent, DAY_STEPS, CYCLE

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


# Hard cap to prevent infinite loops (50×50 grid, up to ~20 minerals, generous headroom)
MAX_STEPS = 10_000


def run_inference(map_file: str, brain_file: str) -> dict:
    """
    Run a single greedy episode (epsilon=0) and return the full result.
    The mission runs until all minerals are collected and the rover returns
    home, or until the battery is depleted — there is no time limit.

    Returns a dict with:
        path        – list of [row, col] coordinates visited each step
        minerals    – list of {pos, type, step} for each mineral collected
        battery     – list of battery level at each step
        steps_used  – total half-hour steps consumed
        success     – True if all minerals collected and rover returned home
    """
    mission = MarsMission(map_file)
    agent = RLAgent(mission)

    # Load the trained brain
    agent.q_table = np.load(brain_file)

    # Greedy policy — no exploration
    agent.epsilon = 0.0

    pos = mission.start_pos
    battery = 100.0
    mins = set(mission.minerals.keys())
    step = 0

    path = [list(pos)]
    battery_log = [battery]
    minerals_collected = []

    agent._path_cache = []
    agent._path_target = None

    while step < MAX_STEPS:
        s_idx = agent.get_state_index(pos, battery, step, mins)

        # Pure greedy: always pick the best-known action
        action = int(np.argmax(agent.q_table[s_idx]))

        target = (
            mission.start_pos
            if (action > 2 or not mins)
            else min(
                mins, key=lambda m: max(abs(pos[0] - m[0]), abs(pos[1] - m[1]))
            )
        )
        speed_choice = (action % 3) + 1

        new_pos, dist_moved = agent.path_step(pos, target, speed_choice)

        # Energy
        consumption = (2 * dist_moved ** 2) if dist_moved > 0 else 1
        is_day = (step % CYCLE) < DAY_STEPS
        battery = min(100.0, battery - consumption + (10 if is_day else 0))
        battery = max(0.0, battery)

        step += 1
        path.append(list(new_pos))
        battery_log.append(round(battery, 2))

        # Mining
        if new_pos in mins:
            battery = min(100.0, battery - 2 + (10 if (step % CYCLE) < DAY_STEPS else 0))
            minerals_collected.append({
                "pos": list(new_pos),
                "type": mission.minerals[new_pos],
                "step": step,
            })
            mins.remove(new_pos)
            step += 1  # mining costs one extra half-hour step
            path.append(list(new_pos))
            battery_log.append(round(battery, 2))

        if battery <= 0:
            print("Battery depleted — mission failed.")
            break

        if not mins and new_pos == mission.start_pos:
            print("All minerals collected and rover returned home — mission success!")
            break

        pos = new_pos

    return {
        "path": path,
        "minerals": minerals_collected,
        "battery": battery_log,
        "steps_used": step,
        "success": (not mins and pos == mission.start_pos),
        "start": list(mission.start_pos),
        "all_minerals": {str(k): v for k, v in mission.minerals.items()},
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
        default=os.path.join(BASE_DIR, "mars_rover_brain.npy"),
        help="Path to the trained Q-table .npy file",
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
