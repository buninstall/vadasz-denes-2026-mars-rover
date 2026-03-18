from pathlib import Path

from .config import MAX_SIMULATION_STEPS, MIN_TIME_LIMIT_HOURS
from .mission import CYCLE, DAY_STEPS, MAX_BATTERY, MarsMission
from .planner import RoverPlanner


def _build_log_entry(
    step: int,
    position: tuple[int, int],
    battery: float,
    speed: int,
    total_distance: int,
    minerals_collected: list[str],
    action: str,
) -> dict:
    return {
        "step": step,
        "time_hours": step * 0.5,
        "is_day": (step % CYCLE) < DAY_STEPS,
        "position": list(position),
        "battery": round(battery, 2),
        "speed": speed,
        "distance_traveled": total_distance,
        "minerals_collected": minerals_collected,
        "action": action,
    }


def run_simulation(map_file: str | Path, time_limit_hours: int = 24) -> dict:
    mission = MarsMission(map_file)
    planner = RoverPlanner(mission)

    pos = mission.start_pos
    battery = float(MAX_BATTERY)
    remaining_minerals = set(mission.minerals.keys())
    step = 0
    total_distance = 0

    path = [list(pos)]
    battery_log = [battery]
    minerals_collected: list[dict] = []
    logs = [_build_log_entry(step, pos, battery, 0, total_distance, [], "start")]
    total_minerals = len(mission.minerals)
    termination_reason = "unknown"
    active_target: tuple[int, int] | None = None

    planner.reset_runtime_state(remaining_minerals)

    effective_hours = max(MIN_TIME_LIMIT_HOURS, int(time_limit_hours))
    time_budget_steps = max(1, effective_hours * 2)
    max_steps = min(MAX_SIMULATION_STEPS, time_budget_steps)

    while step < max_steps:
        if active_target not in remaining_minerals:
            active_target = None

        if active_target is None:
            selection = planner.choose_next_target(
                pos,
                battery,
                step,
                remaining_minerals,
                max_steps,
            )
            if selection is not None:
                active_target, _ = selection

        if active_target is not None:
            target = active_target
        elif remaining_minerals:
            if pos != mission.start_pos:
                target = mission.start_pos
            else:
                if battery < MAX_BATTERY:
                    battery = planner._standby_battery(battery, step)
                    step += 1
                    path.append(list(pos))
                    battery_log.append(round(battery, 2))
                    logs.append(_build_log_entry(step, pos, battery, 0, total_distance, [], "move"))
                    if battery <= 0:
                        termination_reason = "battery_depleted_waiting"
                        break
                    continue

                termination_reason = "no_feasible_target"
                break
        elif pos != mission.start_pos:
            target = mission.start_pos
        else:
            termination_reason = "completed"
            break

        current_path = planner.get_path(pos, target, passable_cells=(pos, target))
        home_path = (
            planner.get_path(
                target,
                mission.start_pos,
                passable_cells=(target, mission.start_pos),
            )
            if target != mission.start_pos
            else []
        )
        reserve_blocks = len(current_path) + len(home_path)
        safe_speed = planner.pick_route_speed(reserve_blocks, battery, step)
        dist_moved = min(len(current_path), safe_speed)

        if dist_moved <= 0:
            if planner._is_day(step) and battery < MAX_BATTERY:
                battery = planner._standby_battery(battery, step)
                step += 1
                path.append(list(pos))
                battery_log.append(round(battery, 2))
                logs.append(_build_log_entry(step, pos, battery, 0, total_distance, [], "move"))
                if battery <= 0:
                    termination_reason = "battery_depleted_recharging"
                    break
                continue

            termination_reason = "no_safe_movement"
            break

        new_pos = current_path[dist_moved - 1]
        battery = planner._move_battery(battery, step, dist_moved)

        step += 1
        total_distance += dist_moved
        path.append(list(new_pos))
        battery_log.append(round(battery, 2))
        logs.append(_build_log_entry(step, new_pos, battery, dist_moved, total_distance, [], "move"))

        pos = new_pos

        if battery <= 0:
            termination_reason = "battery_depleted"
            break

        if active_target is not None and pos == active_target and pos in remaining_minerals:
            if step >= max_steps:
                break

            battery = planner._mine_battery(battery, step)
            mineral_type = mission.minerals[pos]
            remaining_minerals.remove(pos)
            planner.clear_mineral(pos)
            step += 1
            minerals_collected.append(
                {
                    "pos": list(pos),
                    "type": mineral_type,
                    "step": step,
                }
            )
            path.append(list(pos))
            battery_log.append(round(battery, 2))
            logs.append(_build_log_entry(step, pos, battery, 0, total_distance, [mineral_type], "mine"))

            active_target = None

            if battery <= 0:
                termination_reason = "battery_depleted_mining"
                break

        if pos == mission.start_pos and target == mission.start_pos and not remaining_minerals:
            termination_reason = "completed"
            break

    if termination_reason == "unknown":
        termination_reason = "time_budget_reached" if step >= max_steps else "ended"

    all_collected = len(remaining_minerals) == 0
    returned_home = pos == mission.start_pos
    mission_success = returned_home and battery > 0 and step <= max_steps

    return {
        "path": path,
        "minerals": minerals_collected,
        "battery": battery_log,
        "steps_used": step,
        "success": mission_success,
        "all_collected": all_collected,
        "returned_home": returned_home,
        "total_minerals": total_minerals,
        "time_budget_hours": effective_hours,
        "time_budget_steps": time_budget_steps,
        "termination_reason": termination_reason,
        "start": list(mission.start_pos),
        "all_minerals": {str(position): mineral for position, mineral in mission.minerals.items()},
        "logs": logs,
    }
