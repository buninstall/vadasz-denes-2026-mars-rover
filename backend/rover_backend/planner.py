import heapq
from collections import deque

from .mission import (
    CLUSTER_RADIUS,
    CYCLE,
    DAY_STEPS,
    GRID_SIZE,
    K_CONSTANT,
    MAX_BATTERY,
    MAX_TARGET_CANDIDATES,
    MarsMission,
)

Position = tuple[int, int]


class RoverPlanner:
    def __init__(self, mission: MarsMission):
        self.m = mission
        self._remaining_minerals = set(self.m.minerals.keys())
        self._pair_path_cache: dict[
            tuple[Position, Position, tuple[Position, ...]],
            list[Position],
        ] = {}

    def _invalidate_route_cache(self) -> None:
        self._pair_path_cache = {}

    def reset_runtime_state(self, remaining_minerals: set[Position] | None = None) -> None:
        self._remaining_minerals = set(
            self.m.minerals.keys() if remaining_minerals is None else remaining_minerals
        )
        self._invalidate_route_cache()

    def clear_mineral(self, mineral: Position) -> None:
        if mineral in self._remaining_minerals:
            self._remaining_minerals.remove(mineral)
            self._invalidate_route_cache()

    def _is_day(self, step: int) -> bool:
        return (step % CYCLE) < DAY_STEPS

    def _solar_charge(self, step: int) -> int:
        return 10 if self._is_day(step) else 0

    def _move_battery(self, battery: float, step: int, moved_blocks: int) -> float:
        consumption = (K_CONSTANT * (moved_blocks**2)) if moved_blocks > 0 else 1
        return max(0.0, min(float(MAX_BATTERY), battery - consumption + self._solar_charge(step)))

    def _mine_battery(self, battery: float, step: int) -> float:
        return max(0.0, min(float(MAX_BATTERY), battery - 2 + self._solar_charge(step)))

    def _standby_battery(self, battery: float, step: int) -> float:
        return max(0.0, min(float(MAX_BATTERY), battery - 1 + self._solar_charge(step)))

    def _estimate_route_feasible(self, remaining_blocks: int, battery: float, step: int) -> bool:
        projected_battery = battery
        projected_step = step

        for _ in range(remaining_blocks):
            projected_battery = self._move_battery(projected_battery, projected_step, 1)
            if projected_battery <= 0:
                return False
            projected_step += 1

        return True

    def pick_route_speed(self, remaining_blocks: int, battery: float, step: int) -> int:
        if remaining_blocks <= 0 or battery <= 0:
            return 0

        max_speed = min(3, remaining_blocks)
        for moved_blocks in range(max_speed, 0, -1):
            battery_after_move = self._move_battery(battery, step, moved_blocks)
            if battery_after_move <= 0:
                continue
            if self._estimate_route_feasible(
                remaining_blocks - moved_blocks,
                battery_after_move,
                step + 1,
            ):
                return moved_blocks

        return 0

    def _normalise_passable_cells(
        self,
        start: Position,
        target: Position,
        passable_cells: tuple[Position, ...] | list[Position] | None = None,
    ) -> tuple[Position, ...]:
        cells = {start, target}
        if passable_cells:
            cells.update(passable_cells)
        return tuple(sorted(cells))

    def _compute_path(
        self,
        start: Position,
        target: Position,
        passable_cells: tuple[Position, ...] = (),
    ) -> list[Position]:
        passable = set(passable_cells)
        queue: list[tuple[int, Position]] = [(0, start)]
        came_from: dict[Position, Position | None] = {start: None}
        cost: dict[Position, int] = {start: 0}

        while queue:
            _, current = heapq.heappop(queue)
            if current == target:
                break

            for delta_row, delta_column in [
                (-1, -1),
                (-1, 0),
                (-1, 1),
                (0, -1),
                (0, 1),
                (1, -1),
                (1, 0),
                (1, 1),
            ]:
                next_position = (current[0] + delta_row, current[1] + delta_column)
                if (
                    0 <= next_position[0] < GRID_SIZE
                    and 0 <= next_position[1] < GRID_SIZE
                    and next_position not in self.m.obstacles
                    and (
                        next_position not in self._remaining_minerals
                        or next_position in passable
                    )
                ):
                    new_cost = cost[current] + 1
                    if next_position not in cost or new_cost < cost[next_position]:
                        cost[next_position] = new_cost
                        priority = new_cost + max(
                            abs(next_position[0] - target[0]),
                            abs(next_position[1] - target[1]),
                        )
                        heapq.heappush(queue, (priority, next_position))
                        came_from[next_position] = current

        path: list[Position] = []
        cursor = target
        while cursor in came_from and cursor != start:
            path.append(cursor)
            cursor = came_from[cursor]
        path.reverse()
        return path

    def get_path(
        self,
        start: Position,
        target: Position,
        passable_cells: tuple[Position, ...] | list[Position] | None = None,
    ) -> list[Position]:
        if start == target:
            return []

        passable_signature = self._normalise_passable_cells(start, target, passable_cells)
        key = (start, target, passable_signature)
        cached = self._pair_path_cache.get(key)
        if cached is not None:
            return cached

        path = self._compute_path(start, target, passable_signature)
        self._pair_path_cache[key] = path
        return path

    def _chebyshev_distance(self, start: Position, target: Position) -> int:
        return max(abs(start[0] - target[0]), abs(start[1] - target[1]))

    def _candidate_rank_key(
        self,
        pos: Position,
        mineral: Position,
        density_map: dict[Position, int],
        cluster_size_map: dict[Position, int],
        frontier_exposure_map: dict[Position, int],
    ) -> tuple[float, int]:
        return (
            self._chebyshev_distance(pos, mineral)
            - 0.85 * min(density_map[mineral], 6)
            - 0.35 * min(cluster_size_map[mineral] - 1, 14)
            - 0.25 * min(frontier_exposure_map[mineral], 4),
            self._chebyshev_distance(self.m.start_pos, mineral),
        )

    def _is_frontier_mineral(
        self,
        mineral: Position,
        current_mins: set[Position],
    ) -> int:
        exposure = 0

        for delta_row, delta_column in [
            (-1, -1),
            (-1, 0),
            (-1, 1),
            (0, -1),
            (0, 1),
            (1, -1),
            (1, 0),
            (1, 1),
        ]:
            next_position = (mineral[0] + delta_row, mineral[1] + delta_column)
            if not (0 <= next_position[0] < GRID_SIZE and 0 <= next_position[1] < GRID_SIZE):
                continue
            if next_position in self.m.obstacles:
                continue
            if next_position not in current_mins:
                exposure += 1

        return exposure

    def _cluster_maps(
        self,
        current_mins: set[Position],
    ) -> tuple[dict[Position, int], dict[Position, int], dict[Position, int], dict[int, tuple[Position, ...]]]:
        remaining = set(current_mins)
        cluster_size: dict[Position, int] = {}
        cluster_frontier: dict[Position, int] = {}
        cluster_id_map: dict[Position, int] = {}
        cluster_members: dict[int, tuple[Position, ...]] = {}
        cluster_id = 0

        while remaining:
            seed = remaining.pop()
            queue = deque([seed])
            cluster = [seed]

            while queue:
                current = queue.popleft()
                for delta_row in range(-CLUSTER_RADIUS, CLUSTER_RADIUS + 1):
                    for delta_column in range(-CLUSTER_RADIUS, CLUSTER_RADIUS + 1):
                        if delta_row == 0 and delta_column == 0:
                            continue
                        if max(abs(delta_row), abs(delta_column)) > CLUSTER_RADIUS:
                            continue

                        next_position = (current[0] + delta_row, current[1] + delta_column)
                        if next_position in remaining:
                            remaining.remove(next_position)
                            queue.append(next_position)
                            cluster.append(next_position)

            size = len(cluster)
            frontier_count = sum(
                1 for mineral in cluster if self._is_frontier_mineral(mineral, current_mins) > 0
            )
            cluster_members[cluster_id] = tuple(cluster)

            for mineral in cluster:
                cluster_size[mineral] = size
                cluster_frontier[mineral] = frontier_count
                cluster_id_map[mineral] = cluster_id

            cluster_id += 1

        return cluster_size, cluster_frontier, cluster_id_map, cluster_members

    def _candidate_density_map(self, current_mins: set[Position]) -> dict[Position, int]:
        density: dict[Position, int] = {}
        for mineral in current_mins:
            density[mineral] = sum(
                1
                for other in current_mins
                if other != mineral
                and max(abs(mineral[0] - other[0]), abs(mineral[1] - other[1])) <= CLUSTER_RADIUS
            )
        return density

    def _select_focus_cluster(
        self,
        pos: Position,
        current_mins: set[Position],
        cluster_id_map: dict[Position, int],
        cluster_members: dict[int, tuple[Position, ...]],
    ) -> int | None:
        nearby_clusters: dict[int, dict[str, int]] = {}

        for mineral in current_mins:
            distance = self._chebyshev_distance(pos, mineral)
            if distance > CLUSTER_RADIUS:
                continue

            cluster_id = cluster_id_map[mineral]
            cluster_state = nearby_clusters.setdefault(
                cluster_id,
                {"min_distance": distance, "nearby_count": 0},
            )
            cluster_state["min_distance"] = min(cluster_state["min_distance"], distance)
            cluster_state["nearby_count"] += 1

        if not nearby_clusters:
            return None

        return min(
            nearby_clusters,
            key=lambda cluster_id: (
                nearby_clusters[cluster_id]["min_distance"],
                -nearby_clusters[cluster_id]["nearby_count"],
                -len(cluster_members[cluster_id]),
            ),
        )

    def _score_candidate(
        self,
        pos: Position,
        mineral: Position,
        evaluation: dict[str, int | float | list[Position]],
        time_left: int,
        density_map: dict[Position, int],
        cluster_size_map: dict[Position, int],
        frontier_exposure_map: dict[Position, int],
        cluster_frontier_map: dict[Position, int],
    ) -> float:
        density_bonus = min(density_map[mineral], 8)
        cluster_bonus = min(cluster_size_map[mineral] - 1, 14)
        frontier_bonus = min(frontier_exposure_map[mineral], 5)
        cluster_frontier_bonus = min(cluster_frontier_map[mineral], 10)
        distance_to_rover = self._chebyshev_distance(pos, mineral)
        continuation_bonus = 0.55 if distance_to_rover <= 1 else 0.2 if distance_to_rover <= CLUSTER_RADIUS else 0.0

        return (
            (
                1.0
                + 0.28 * density_bonus
                + 0.06 * cluster_bonus
                + 0.05 * frontier_bonus
                + 0.02 * cluster_frontier_bonus
                + continuation_bonus
            )
            / max(1.0, evaluation["to_target_steps"])
            + 0.002 * evaluation["battery_after_return"]
            + 0.001 * max(0, time_left - evaluation["roundtrip_steps"])
        )

    def _best_candidate_from_pool(
        self,
        candidates: list[Position] | tuple[Position, ...],
        pos: Position,
        battery: float,
        step: int,
        max_steps: int,
        time_left: int,
        density_map: dict[Position, int],
        cluster_size_map: dict[Position, int],
        frontier_exposure_map: dict[Position, int],
        cluster_frontier_map: dict[Position, int],
    ) -> tuple[Position | None, dict[str, int | float | list[Position]] | None, float | None]:
        best_target = None
        best_evaluation = None
        best_score = None

        for mineral in candidates:
            evaluation = self._evaluate_candidate(pos, mineral, battery, step, max_steps)
            if evaluation is None:
                continue

            score = self._score_candidate(
                pos,
                mineral,
                evaluation,
                time_left,
                density_map,
                cluster_size_map,
                frontier_exposure_map,
                cluster_frontier_map,
            )

            if best_score is None or score > best_score:
                best_target = mineral
                best_evaluation = evaluation
                best_score = score

        return best_target, best_evaluation, best_score

    def _evaluate_candidate(
        self,
        pos: Position,
        target: Position,
        battery: float,
        step: int,
        max_steps: int,
    ) -> dict[str, int | float | list[Position]] | None:
        outbound_path = self.get_path(pos, target, passable_cells=(pos, target))
        if pos != target and not outbound_path:
            return None

        return_path = self.get_path(
            target,
            self.m.start_pos,
            passable_cells=(target, self.m.start_pos),
        )
        if target != self.m.start_pos and target != pos and not return_path:
            return None

        simulated_battery = battery
        simulated_step = step
        outbound_remaining = len(outbound_path)
        home_remaining = len(return_path)

        while outbound_remaining > 0:
            if simulated_step >= max_steps:
                return None

            remaining_blocks = outbound_remaining + home_remaining
            moved_blocks = min(
                outbound_remaining,
                self.pick_route_speed(remaining_blocks, simulated_battery, simulated_step),
            )
            if moved_blocks <= 0:
                return None

            simulated_battery = self._move_battery(simulated_battery, simulated_step, moved_blocks)
            if simulated_battery <= 0:
                return None

            outbound_remaining -= moved_blocks
            simulated_step += 1

        if simulated_step >= max_steps:
            return None

        simulated_battery = self._mine_battery(simulated_battery, simulated_step)
        if simulated_battery <= 0:
            return None

        simulated_step += 1
        to_target_steps = simulated_step - step
        battery_after_target = simulated_battery

        while home_remaining > 0:
            if simulated_step >= max_steps:
                return None

            moved_blocks = min(
                home_remaining,
                self.pick_route_speed(home_remaining, simulated_battery, simulated_step),
            )
            if moved_blocks <= 0:
                return None

            simulated_battery = self._move_battery(simulated_battery, simulated_step, moved_blocks)
            if simulated_battery <= 0:
                return None

            home_remaining -= moved_blocks
            simulated_step += 1

        if not self._is_day(simulated_step):
            night_steps_left = CYCLE - (simulated_step % CYCLE)
            if simulated_battery <= night_steps_left:
                return None

        return {
            "to_target_steps": to_target_steps,
            "roundtrip_steps": simulated_step - step,
            "battery_after_target": battery_after_target,
            "battery_after_return": simulated_battery,
            "target_path": outbound_path,
            "home_path": return_path,
        }

    def choose_next_target(
        self,
        pos: Position,
        battery: float,
        step: int,
        current_mins: set[Position],
        max_steps: int,
    ) -> tuple[Position, dict[str, int | float | list[Position]]] | None:
        if not current_mins:
            return None

        density_map = self._candidate_density_map(current_mins)
        cluster_size_map, cluster_frontier_map, cluster_id_map, cluster_members = self._cluster_maps(current_mins)
        frontier_exposure_map = {
            mineral: self._is_frontier_mineral(mineral, current_mins)
            for mineral in current_mins
        }
        focus_cluster_id = self._select_focus_cluster(
            pos,
            current_mins,
            cluster_id_map,
            cluster_members,
        )
        adjacent_candidates = [
            mineral for mineral in current_mins if self._chebyshev_distance(pos, mineral) <= 1
        ]
        frontier_candidates = [
            mineral for mineral in current_mins if frontier_exposure_map[mineral] > 0
        ]
        candidate_pool = frontier_candidates or list(current_mins)

        ranked_candidates = sorted(
            candidate_pool,
            key=lambda mineral: self._candidate_rank_key(
                pos,
                mineral,
                density_map,
                cluster_size_map,
                frontier_exposure_map,
            ),
        )[:MAX_TARGET_CANDIDATES]
        if adjacent_candidates:
            ranked_candidates = list(
                dict.fromkeys(
                    sorted(
                        adjacent_candidates,
                        key=lambda mineral: (
                            self._chebyshev_distance(pos, mineral),
                            -cluster_size_map[mineral],
                        ),
                    )
                    + ranked_candidates
                )
            )[:MAX_TARGET_CANDIDATES]
        ranked_candidate_set = set(ranked_candidates)

        time_left = max_steps - step

        if focus_cluster_id is not None:
            focus_candidates = sorted(
                cluster_members[focus_cluster_id],
                key=lambda mineral: (
                    self._chebyshev_distance(pos, mineral),
                    -density_map[mineral],
                    -frontier_exposure_map[mineral],
                ),
            )
            focus_target, focus_evaluation, _ = self._best_candidate_from_pool(
                focus_candidates,
                pos,
                battery,
                step,
                max_steps,
                time_left,
                density_map,
                cluster_size_map,
                frontier_exposure_map,
                cluster_frontier_map,
            )
            if focus_target is not None and focus_evaluation is not None:
                return focus_target, focus_evaluation

        best_target, best_evaluation, best_score = self._best_candidate_from_pool(
            ranked_candidates,
            pos,
            battery,
            step,
            max_steps,
            time_left,
            density_map,
            cluster_size_map,
            frontier_exposure_map,
            cluster_frontier_map,
        )

        if best_target is None and len(ranked_candidate_set) < len(current_mins):
            fallback_candidates = sorted(
                (mineral for mineral in current_mins if mineral not in ranked_candidate_set),
                key=lambda mineral: self._candidate_rank_key(
                    pos,
                    mineral,
                    density_map,
                    cluster_size_map,
                    frontier_exposure_map,
                ),
            )

            fallback_target, fallback_evaluation, fallback_score = self._best_candidate_from_pool(
                fallback_candidates,
                pos,
                battery,
                step,
                max_steps,
                time_left,
                density_map,
                cluster_size_map,
                frontier_exposure_map,
                cluster_frontier_map,
            )
            if best_score is None or (
                fallback_score is not None and fallback_score > best_score
            ):
                best_target = fallback_target
                best_evaluation = fallback_evaluation

        if best_target is None or best_evaluation is None:
            return None

        return best_target, best_evaluation
