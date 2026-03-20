from pathlib import Path

from .config import MAX_SIMULATION_STEPS, MIN_TIME_LIMIT_HOURS
from .mission import CYCLE, DAY_STEPS, GRID_SIZE, MAX_BATTERY, MarsMission
from .planner import RoverPlanner

Position = tuple[int, int]


def _resolve_start_override(
    mission: MarsMission,
    start_override: tuple[int, int] | list[int] | None,
) -> Position | None:
    if start_override is None:
        return None

    if len(start_override) != 2:
        raise ValueError("start_override must contain exactly two values: [row, col]")

    row, col = start_override
    if not isinstance(row, int) or not isinstance(col, int) or isinstance(row, bool) or isinstance(col, bool):
        raise ValueError("start_override row/col must be integers")

    if not (0 <= row < GRID_SIZE and 0 <= col < GRID_SIZE):
        raise ValueError(f"start_override must be within map bounds 0..{GRID_SIZE - 1}")

    candidate = (row, col)
    if candidate in mission.obstacles:
        raise ValueError("start_override cannot be placed on obstacle '#' cell")

    return candidate


def _build_log_entry(
    step: int,
    position: Position,
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


def run_simulation(
    map_file: str | Path,
    time_limit_hours: int = 24,
    collect_all: bool = False,
    start_override: tuple[int, int] | list[int] | None = None,
) -> dict:
    mission = MarsMission(map_file)

    resolved_override = _resolve_start_override(mission, start_override)
    if resolved_override is not None:
        mission.start_pos = resolved_override

    planner = RoverPlanner(mission)

    pos = mission.start_pos
    active_target: Position | None = None
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

    planner.reset_runtime_state(remaining_minerals)

    effective_hours = max(MIN_TIME_LIMIT_HOURS, int(time_limit_hours))
    time_budget_steps = max(1, effective_hours * 2)
    max_steps = min(MAX_SIMULATION_STEPS, time_budget_steps)

    def should_wait_for_day() -> bool:
        if step >= max_steps:
            return False

        if planner._is_day(step):
            return battery < MAX_BATTERY and planner.can_standby(battery, step)

        steps_until_day = CYCLE - (step % CYCLE)
        if step + steps_until_day >= max_steps:
            return False

        return battery >= steps_until_day

    def standby(reason: str) -> bool:
        nonlocal battery, step, termination_reason

        if step >= max_steps:
            return False

        if not planner.can_standby(battery, step):
            termination_reason = reason
            return False

        battery = planner._standby_battery(battery, step)
        step += 1
        path.append(list(pos))
        battery_log.append(round(battery, 2))
        logs.append(_build_log_entry(step, pos, battery, 0, total_distance, [], "standby"))

        return True

    def mine_current_position() -> bool:
        nonlocal battery, step

        if pos not in remaining_minerals or step >= max_steps:
            return False

        if not planner.can_mine(battery, step):
            return False

        if planner.evaluate_target(pos, pos, battery, step, max_steps) is None:
            return False

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

        return True

    while step < max_steps:
        if pos in remaining_minerals and not planner.can_mine(battery, step):
            if should_wait_for_day():
                if not standby("battery_depleted_waiting_to_mine"):
                    break
                continue

            termination_reason = "no_safe_mining"
            break

        if mine_current_position():
            active_target = None
            continue

        if (
            active_target is not None
            and active_target != mission.start_pos
            and active_target not in remaining_minerals
        ):
            active_target = None

        if not remaining_minerals:
            active_target = mission.start_pos
        else:
            selection = planner.choose_next_target(
                pos,
                battery,
                step,
                remaining_minerals,
                max_steps,
            )
            candidate_target = selection[0] if selection is not None else None
            candidate_evaluation = selection[1] if selection is not None else None

            if active_target is None:
                active_target = candidate_target
            elif active_target not in remaining_minerals:
                active_target = candidate_target
            else:
                active_evaluation = planner.evaluate_target(
                    pos,
                    active_target,
                    battery,
                    step,
                    max_steps,
                )

                if active_evaluation is None:
                    active_target = candidate_target
                elif candidate_target is not None and candidate_target != active_target:
                    active_path = planner.get_path(pos, active_target, passable_cells=(pos, active_target))
                    candidate_path = planner.get_path(pos, candidate_target, passable_cells=(pos, candidate_target))

                    active_distance = len(active_path) if active_path else 10_000
                    candidate_distance = len(candidate_path) if candidate_path else 10_000

                    active_roundtrip_steps = int(active_evaluation["roundtrip_steps"])
                    candidate_roundtrip_steps = (
                        int(candidate_evaluation["roundtrip_steps"])
                        if candidate_evaluation is not None
                        else None
                    )
                    candidate_has_time_advantage = (
                        candidate_roundtrip_steps is not None
                        and candidate_roundtrip_steps + 1 < active_roundtrip_steps
                    )

                    if candidate_has_time_advantage or candidate_distance + 1 < active_distance:
                        active_target = candidate_target

        if active_target is None:
            if pos != mission.start_pos:
                active_target = mission.start_pos
            else:
                if should_wait_for_day():
                    if not standby("battery_depleted_waiting"):
                        break
                    continue

                termination_reason = "no_feasible_target"
                break

        target = active_target
        if (
            target != mission.start_pos
            and target in remaining_minerals
            and planner.evaluate_target(pos, target, battery, step, max_steps) is None
        ):
            active_target = None
            continue

        if target == pos:
            if target == mission.start_pos and not remaining_minerals:
                termination_reason = "completed"
                break
            active_target = None
            continue

        current_path = planner.get_path(pos, target, passable_cells=(pos, target))
        if not current_path:
            if target != mission.start_pos:
                active_target = None
                continue

            termination_reason = "no_path_home"
            break

        home_path = []
        if target != mission.start_pos:
            home_path = planner.get_path(
                target,
                mission.start_pos,
                passable_cells=(target, mission.start_pos),
            )
            if not home_path:
                active_target = None
                continue

        reserve_blocks = len(current_path) + len(home_path)
        safe_speed = planner.pick_route_speed(
            reserve_blocks,
            battery,
            step,
            max_speed=3,
        )
        dist_moved = min(safe_speed, len(current_path)) if safe_speed > 0 else 0

        if dist_moved <= 0:
            if should_wait_for_day():
                if not standby("battery_depleted_recharging"):
                    break
                continue

            termination_reason = "no_safe_movement"
            break

        new_pos = current_path[dist_moved - 1]
        if new_pos in mission.obstacles:
            termination_reason = "invalid_obstacle_step"
            break

        battery = planner._move_battery(battery, step, dist_moved)

        step += 1
        total_distance += dist_moved
        path.append(list(new_pos))
        battery_log.append(round(battery, 2))
        logs.append(_build_log_entry(step, new_pos, battery, dist_moved, total_distance, [], "move"))

        pos = new_pos

        if pos == target:
            if target == mission.start_pos and not remaining_minerals:
                termination_reason = "completed"
                break
            active_target = None

    if termination_reason == "unknown":
        termination_reason = "time_budget_reached" if step >= max_steps else "ended"

    all_collected = len(remaining_minerals) == 0
    returned_home = pos == mission.start_pos
    mission_success = (
        returned_home
        and battery >= 0
        and step <= max_steps
        and (all_collected if collect_all else True)
    )

    return {
        "path": path,
        "minerals": minerals_collected,
        "battery": battery_log,
        "steps_used": step,
        "success": mission_success,
        "collect_all_mode": collect_all,
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
