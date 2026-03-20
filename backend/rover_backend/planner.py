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
PathEvaluation = dict[str, int | float | list[Position]]

CELL_COUNT = GRID_SIZE * GRID_SIZE
ADJACENT_OFFSETS = tuple(
    (delta_row, delta_column)
    for delta_row in (-1, 0, 1)
    for delta_column in (-1, 0, 1)
    if delta_row != 0 or delta_column != 0
)
CLUSTER_NEIGHBOR_OFFSETS = tuple(
    (delta_row, delta_column)
    for delta_row in range(-CLUSTER_RADIUS, CLUSTER_RADIUS + 1)
    for delta_column in range(-CLUSTER_RADIUS, CLUSTER_RADIUS + 1)
    if (delta_row != 0 or delta_column != 0)
    and max(abs(delta_row), abs(delta_column)) <= CLUSTER_RADIUS
)
MOVE_COST_BY_SPEED = (0, K_CONSTANT, K_CONSTANT * 4, K_CONSTANT * 9)
FOCUS_CLUSTER_RADIUS = CLUSTER_RADIUS + 2
FOCUS_LOCAL_SWEEP_RADIUS = CLUSTER_RADIUS + 1


class RoverPlanner:
    def __init__(self, mission: MarsMission):
        self.m = mission
        self._coords_by_index = tuple(
            (index // GRID_SIZE, index % GRID_SIZE) for index in range(CELL_COUNT)
        )
        self._start_index = self._position_to_index(self.m.start_pos)
        self._obstacle_indices = {
            self._position_to_index(obstacle) for obstacle in self.m.obstacles
        }
        self._path_neighbors_by_index = self._build_path_neighbors()
        self._cluster_neighbors_by_index = self._build_cluster_neighbors()
        self._pair_path_cache: dict[
            tuple[int, int, tuple[int, ...]],
            list[Position],
        ] = {}
        self._search_generation = 0
        self._seen_generation = [0] * CELL_COUNT
        self._g_cost = [0] * CELL_COUNT
        self._parent = [-1] * CELL_COUNT
        self._remaining_minerals = set(self.m.minerals.keys())
        self._remaining_mineral_indices: set[int] = set()
        self.reset_runtime_state()

    def _position_to_index(self, position: Position) -> int:
        return position[0] * GRID_SIZE + position[1]

    def _index_to_position(self, index: int) -> Position:
        return self._coords_by_index[index]

    def _build_path_neighbors(self) -> tuple[tuple[int, ...], ...]:
        neighbors: list[tuple[int, ...]] = []

        for index, (row, column) in enumerate(self._coords_by_index):
            if index in self._obstacle_indices:
                neighbors.append(())
                continue

            cell_neighbors = []
            for delta_row, delta_column in ADJACENT_OFFSETS:
                next_row = row + delta_row
                next_column = column + delta_column
                if not (0 <= next_row < GRID_SIZE and 0 <= next_column < GRID_SIZE):
                    continue

                next_index = next_row * GRID_SIZE + next_column
                if next_index in self._obstacle_indices:
                    continue

                if abs(delta_row) == 1 and abs(delta_column) == 1:
                    orthogonal_a = (row + delta_row) * GRID_SIZE + column
                    orthogonal_b = row * GRID_SIZE + (column + delta_column)
                    if (
                        orthogonal_a in self._obstacle_indices
                        or orthogonal_b in self._obstacle_indices
                    ):
                        continue

                cell_neighbors.append(next_index)

            neighbors.append(tuple(cell_neighbors))

        return tuple(neighbors)

    def _build_cluster_neighbors(self) -> tuple[tuple[int, ...], ...]:
        neighbors: list[tuple[int, ...]] = []

        for row, column in self._coords_by_index:
            cell_neighbors = []
            for delta_row, delta_column in CLUSTER_NEIGHBOR_OFFSETS:
                next_row = row + delta_row
                next_column = column + delta_column
                if 0 <= next_row < GRID_SIZE and 0 <= next_column < GRID_SIZE:
                    cell_neighbors.append(next_row * GRID_SIZE + next_column)

            neighbors.append(tuple(cell_neighbors))

        return tuple(neighbors)

    def _refresh_remaining_mineral_state(self) -> None:
        self._remaining_mineral_indices = {
            self._position_to_index(mineral) for mineral in self._remaining_minerals
        }

    def _invalidate_route_cache(self) -> None:
        self._pair_path_cache = {}

    def reset_runtime_state(self, remaining_minerals: set[Position] | None = None) -> None:
        self._remaining_minerals = set(
            self.m.minerals.keys() if remaining_minerals is None else remaining_minerals
        )
        self._refresh_remaining_mineral_state()
        self._invalidate_route_cache()

    def clear_mineral(self, mineral: Position) -> None:
        if mineral in self._remaining_minerals:
            self._remaining_minerals.remove(mineral)
            mineral_index = self._position_to_index(mineral)
            self._remaining_mineral_indices.discard(mineral_index)
            self._invalidate_route_cache()

    def _is_day(self, step: int) -> bool:
        return (step % CYCLE) < DAY_STEPS

    def _solar_charge(self, step: int) -> int:
        return 10 if self._is_day(step) else 0

    def _can_apply_action(self, battery: float, step: int, consumption: int) -> bool:
        return (battery - consumption + self._solar_charge(step)) >= 0

    def can_move(self, battery: float, step: int, moved_blocks: int) -> bool:
        if moved_blocks <= 0 or moved_blocks >= len(MOVE_COST_BY_SPEED):
            return False
        return self._can_apply_action(battery, step, MOVE_COST_BY_SPEED[moved_blocks])

    def can_mine(self, battery: float, step: int) -> bool:
        return self._can_apply_action(battery, step, 2)

    def can_standby(self, battery: float, step: int) -> bool:
        return self._can_apply_action(battery, step, 1)

    def _move_battery(self, battery: float, step: int, moved_blocks: int) -> float:
        consumption = MOVE_COST_BY_SPEED[moved_blocks] if moved_blocks > 0 else 1
        return max(0.0, min(float(MAX_BATTERY), battery - consumption + self._solar_charge(step)))

    def _mine_battery(self, battery: float, step: int) -> float:
        return max(0.0, min(float(MAX_BATTERY), battery - 2 + self._solar_charge(step)))

    def _standby_battery(self, battery: float, step: int) -> float:
        return max(0.0, min(float(MAX_BATTERY), battery - 1 + self._solar_charge(step)))

    def _estimate_route_feasible(self, remaining_blocks: int, battery: float, step: int) -> bool:
        projected_battery = battery
        projected_step = step

        for _ in range(remaining_blocks):
            if not self.can_move(projected_battery, projected_step, 1):
                return False
            projected_battery = self._move_battery(projected_battery, projected_step, 1)
            projected_step += 1

        return True

    def pick_route_speed(
        self,
        remaining_blocks: int,
        battery: float,
        step: int,
        max_speed: int = 3,
    ) -> int:
        if remaining_blocks <= 0 or battery < 0:
            return 0

        capped_speed = min(3, max(1, max_speed), remaining_blocks)
        for moved_blocks in range(capped_speed, 0, -1):
            if not self.can_move(battery, step, moved_blocks):
                continue
            battery_after_move = self._move_battery(battery, step, moved_blocks)
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
    ) -> tuple[int, ...]:
        cells = {
            self._position_to_index(start),
            self._position_to_index(target),
        }
        if passable_cells:
            cells.update(self._position_to_index(cell) for cell in passable_cells)
        return tuple(sorted(cells))

    def _index_chebyshev_distance(self, start_index: int, target_index: int) -> int:
        start_row, start_column = self._coords_by_index[start_index]
        target_row, target_column = self._coords_by_index[target_index]
        return max(abs(start_row - target_row), abs(start_column - target_column))

    def _is_blocked_index(
        self,
        index: int,
        passable_obstacle_indices: set[int],
    ) -> bool:
        return index in self._obstacle_indices and index not in passable_obstacle_indices

    def _iter_path_neighbors(
        self,
        current_index: int,
        passable_obstacle_indices: set[int],
    ) -> tuple[int, ...]:
        if not passable_obstacle_indices:
            return self._path_neighbors_by_index[current_index]

        row, column = self._coords_by_index[current_index]
        neighbors: list[int] = []

        for delta_row, delta_column in ADJACENT_OFFSETS:
            next_row = row + delta_row
            next_column = column + delta_column
            if not (0 <= next_row < GRID_SIZE and 0 <= next_column < GRID_SIZE):
                continue

            next_index = next_row * GRID_SIZE + next_column
            if self._is_blocked_index(next_index, passable_obstacle_indices):
                continue

            if abs(delta_row) == 1 and abs(delta_column) == 1:
                orthogonal_a = (row + delta_row) * GRID_SIZE + column
                orthogonal_b = row * GRID_SIZE + (column + delta_column)
                if (
                    self._is_blocked_index(orthogonal_a, passable_obstacle_indices)
                    or self._is_blocked_index(orthogonal_b, passable_obstacle_indices)
                ):
                    continue

            neighbors.append(next_index)

        return tuple(neighbors)

    def _compute_path(
        self,
        start: Position,
        target: Position,
        passable_cells: tuple[int, ...] = (),
    ) -> list[Position]:
        start_index = self._position_to_index(start)
        target_index = self._position_to_index(target)
        passable_obstacle_indices = {
            index for index in passable_cells if index in self._obstacle_indices
        }

        if self._is_blocked_index(start_index, passable_obstacle_indices):
            return []
        if self._is_blocked_index(target_index, passable_obstacle_indices):
            return []

        self._search_generation += 1
        generation = self._search_generation
        queue: list[tuple[int, int, int]] = [(
            self._index_chebyshev_distance(start_index, target_index),
            0,
            start_index,
        )]
        self._seen_generation[start_index] = generation
        self._g_cost[start_index] = 0
        self._parent[start_index] = -1

        while queue:
            _, current_cost, current_index = heapq.heappop(queue)
            if (
                self._seen_generation[current_index] != generation
                or current_cost != self._g_cost[current_index]
            ):
                continue

            if current_index == target_index:
                break

            for next_index in self._iter_path_neighbors(current_index, passable_obstacle_indices):
                new_cost = current_cost + 1
                if (
                    self._seen_generation[next_index] != generation
                    or new_cost < self._g_cost[next_index]
                ):
                    self._seen_generation[next_index] = generation
                    self._g_cost[next_index] = new_cost
                    self._parent[next_index] = current_index
                    priority = new_cost + self._index_chebyshev_distance(
                        next_index,
                        target_index,
                    )
                    heapq.heappush(queue, (priority, new_cost, next_index))

        if self._seen_generation[target_index] != generation:
            return []

        path_indices: list[int] = []
        cursor = target_index
        while cursor != start_index:
            path_indices.append(cursor)
            cursor = self._parent[cursor]
            if cursor < 0:
                return []

        path_indices.reverse()
        return [self._index_to_position(index) for index in path_indices]

    def _reverse_path(self, path: list[Position], start: Position) -> list[Position]:
        if not path:
            return []
        return list(reversed(path[:-1])) + [start]

    def get_path(
        self,
        start: Position,
        target: Position,
        passable_cells: tuple[Position, ...] | list[Position] | None = None,
    ) -> list[Position]:
        if start == target:
            return []

        start_index = self._position_to_index(start)
        target_index = self._position_to_index(target)
        passable_signature = self._normalise_passable_cells(start, target, passable_cells)
        key = (start_index, target_index, passable_signature)
        cached = self._pair_path_cache.get(key)
        if cached is not None:
            return cached

        path = self._compute_path(start, target, passable_signature)
        self._pair_path_cache[key] = path

        reverse_key = (target_index, start_index, passable_signature)
        if reverse_key not in self._pair_path_cache:
            self._pair_path_cache[reverse_key] = self._reverse_path(path, start)

        return path

    def _chebyshev_distance(self, start: Position, target: Position) -> int:
        return self._index_chebyshev_distance(
            self._position_to_index(start),
            self._position_to_index(target),
        )

    def _candidate_rank_key(
        self,
        pos_index: int,
        mineral_index: int,
        density_map: dict[int, int],
        cluster_size_map: dict[int, int],
        frontier_exposure_map: dict[int, int],
    ) -> tuple[float, int]:
        return (
            self._index_chebyshev_distance(pos_index, mineral_index)
            - 0.85 * min(density_map[mineral_index], 6)
            - 0.35 * min(cluster_size_map[mineral_index] - 1, 14)
            - 0.25 * min(frontier_exposure_map[mineral_index], 4),
            self._index_chebyshev_distance(self._start_index, mineral_index),
        )

    def _build_spatial_maps(
        self,
        current_mins: set[Position],
    ) -> tuple[
        set[int],
        dict[int, int],
        dict[int, int],
        dict[int, int],
        dict[int, int],
        dict[int, int],
        dict[int, tuple[int, ...]],
        dict[int, tuple[int, ...]],
    ]:
        current_indices = {self._position_to_index(mineral) for mineral in current_mins}
        density_map: dict[int, int] = {}
        frontier_exposure_map: dict[int, int] = {}

        for mineral_index in current_indices:
            density_map[mineral_index] = sum(
                1
                for neighbor_index in self._cluster_neighbors_by_index[mineral_index]
                if neighbor_index in current_indices
            )
            frontier_exposure_map[mineral_index] = sum(
                1
                for neighbor_index in self._path_neighbors_by_index[mineral_index]
                if neighbor_index not in current_indices
            )

        remaining = set(current_indices)
        cluster_size_map: dict[int, int] = {}
        cluster_frontier_map: dict[int, int] = {}
        cluster_id_map: dict[int, int] = {}
        cluster_members: dict[int, tuple[int, ...]] = {}
        cluster_frontier_members: dict[int, tuple[int, ...]] = {}
        cluster_id = 0

        while remaining:
            seed = remaining.pop()
            queue = deque([seed])
            cluster = [seed]
            frontier_members = [seed] if frontier_exposure_map[seed] > 0 else []
            frontier_count = len(frontier_members)

            while queue:
                current = queue.popleft()
                for next_index in self._cluster_neighbors_by_index[current]:
                    if next_index not in remaining:
                        continue

                    remaining.remove(next_index)
                    queue.append(next_index)
                    cluster.append(next_index)
                    if frontier_exposure_map[next_index] > 0:
                        frontier_members.append(next_index)
                        frontier_count += 1

            members = tuple(cluster)
            cluster_members[cluster_id] = members
            cluster_frontier_members[cluster_id] = (
                tuple(frontier_members) if frontier_members else members
            )

            size = len(cluster)
            for mineral_index in members:
                cluster_size_map[mineral_index] = size
                cluster_frontier_map[mineral_index] = frontier_count
                cluster_id_map[mineral_index] = cluster_id

            cluster_id += 1

        return (
            current_indices,
            density_map,
            frontier_exposure_map,
            cluster_size_map,
            cluster_frontier_map,
            cluster_id_map,
            cluster_members,
            cluster_frontier_members,
        )

    def _select_focus_cluster(
        self,
        pos_index: int,
        current_indices: set[int],
        cluster_id_map: dict[int, int],
        cluster_members: dict[int, tuple[int, ...]],
    ) -> int | None:
        nearby_clusters: dict[int, dict[str, int]] = {}

        for mineral_index in current_indices:
            distance = self._index_chebyshev_distance(pos_index, mineral_index)
            if distance > FOCUS_CLUSTER_RADIUS:
                continue

            cluster_id = cluster_id_map[mineral_index]
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
        pos_index: int,
        mineral_index: int,
        evaluation: PathEvaluation,
        time_left: int,
        density_map: dict[int, int],
        cluster_size_map: dict[int, int],
        frontier_exposure_map: dict[int, int],
        cluster_frontier_map: dict[int, int],
    ) -> float:
        density_bonus = min(density_map[mineral_index], 8)
        cluster_bonus = min(cluster_size_map[mineral_index] - 1, 14)
        frontier_bonus = min(frontier_exposure_map[mineral_index], 5)
        cluster_frontier_bonus = min(cluster_frontier_map[mineral_index], 10)
        distance_to_rover = self._index_chebyshev_distance(pos_index, mineral_index)
        home_distance = self._index_chebyshev_distance(mineral_index, self._start_index)
        target_path = evaluation["target_path"]
        home_path = evaluation["home_path"]
        path_detour_penalty = max(0, len(target_path) - distance_to_rover)
        home_detour_penalty = max(0, len(home_path) - home_distance)
        continuation_bonus = (
            0.55 if distance_to_rover <= 1 else 0.2 if distance_to_rover <= CLUSTER_RADIUS else 0.0
        )

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
            - 0.03 * path_detour_penalty
            - 0.015 * home_detour_penalty
        )

    def _best_candidate_from_pool(
        self,
        candidates: list[int] | tuple[int, ...],
        pos: Position,
        pos_index: int,
        battery: float,
        step: int,
        max_steps: int,
        time_left: int,
        density_map: dict[int, int],
        cluster_size_map: dict[int, int],
        frontier_exposure_map: dict[int, int],
        cluster_frontier_map: dict[int, int],
    ) -> tuple[int | None, PathEvaluation | None, float | None]:
        best_target = None
        best_evaluation = None
        best_score = None

        for mineral_index in candidates:
            mineral = self._index_to_position(mineral_index)
            evaluation = self._evaluate_candidate(pos, mineral, battery, step, max_steps)
            if evaluation is None:
                continue

            score = self._score_candidate(
                pos_index,
                mineral_index,
                evaluation,
                time_left,
                density_map,
                cluster_size_map,
                frontier_exposure_map,
                cluster_frontier_map,
            )

            if best_score is None or score > best_score:
                best_target = mineral_index
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
    ) -> PathEvaluation | None:
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
                self.pick_route_speed(
                    remaining_blocks,
                    simulated_battery,
                    simulated_step,
                    max_speed=3,
                ),
            )
            if moved_blocks <= 0:
                if (
                    self._is_day(simulated_step)
                    and simulated_battery < MAX_BATTERY
                    and self.can_standby(simulated_battery, simulated_step)
                ):
                    simulated_battery = self._standby_battery(simulated_battery, simulated_step)
                    simulated_step += 1
                    continue
                return None

            simulated_battery = self._move_battery(simulated_battery, simulated_step, moved_blocks)

            outbound_remaining -= moved_blocks
            simulated_step += 1

        if simulated_step >= max_steps:
            return None

        if not self.can_mine(simulated_battery, simulated_step):
            return None
        simulated_battery = self._mine_battery(simulated_battery, simulated_step)

        simulated_step += 1
        to_target_steps = simulated_step - step
        battery_after_target = simulated_battery

        while home_remaining > 0:
            if simulated_step >= max_steps:
                return None

            moved_blocks = min(
                home_remaining,
                self.pick_route_speed(
                    home_remaining,
                    simulated_battery,
                    simulated_step,
                    max_speed=3,
                ),
            )
            if moved_blocks <= 0:
                if (
                    self._is_day(simulated_step)
                    and simulated_battery < MAX_BATTERY
                    and self.can_standby(simulated_battery, simulated_step)
                ):
                    simulated_battery = self._standby_battery(simulated_battery, simulated_step)
                    simulated_step += 1
                    continue
                return None

            simulated_battery = self._move_battery(simulated_battery, simulated_step, moved_blocks)

            home_remaining -= moved_blocks
            simulated_step += 1

        return {
            "to_target_steps": to_target_steps,
            "roundtrip_steps": simulated_step - step,
            "battery_after_target": battery_after_target,
            "battery_after_return": simulated_battery,
            "target_path": outbound_path,
            "home_path": return_path,
        }

    def evaluate_target(
        self,
        pos: Position,
        target: Position,
        battery: float,
        step: int,
        max_steps: int,
    ) -> PathEvaluation | None:
        return self._evaluate_candidate(pos, target, battery, step, max_steps)

    def choose_next_target(
        self,
        pos: Position,
        battery: float,
        step: int,
        current_mins: set[Position],
        max_steps: int,
    ) -> tuple[Position, PathEvaluation] | None:
        if not current_mins:
            return None

        pos_index = self._position_to_index(pos)
        (
            current_indices,
            density_map,
            frontier_exposure_map,
            cluster_size_map,
            cluster_frontier_map,
            cluster_id_map,
            cluster_members,
            cluster_frontier_members,
        ) = self._build_spatial_maps(current_mins)

        focus_cluster_id = self._select_focus_cluster(
            pos_index,
            current_indices,
            cluster_id_map,
            cluster_members,
        )
        adjacent_candidates = [
            mineral_index
            for mineral_index in current_indices
            if self._index_chebyshev_distance(pos_index, mineral_index) <= 1
        ]
        frontier_candidates = [
            mineral_index
            for mineral_index in current_indices
            if frontier_exposure_map[mineral_index] > 0
        ]
        candidate_pool = frontier_candidates or list(current_indices)

        ranked_candidates = heapq.nsmallest(
            MAX_TARGET_CANDIDATES,
            candidate_pool,
            key=lambda mineral_index: self._candidate_rank_key(
                pos_index,
                mineral_index,
                density_map,
                cluster_size_map,
                frontier_exposure_map,
            ),
        )
        if adjacent_candidates:
            ranked_candidates = list(
                dict.fromkeys(
                    sorted(
                        adjacent_candidates,
                        key=lambda mineral_index: (
                            self._index_chebyshev_distance(pos_index, mineral_index),
                            -cluster_size_map[mineral_index],
                        ),
                    )
                    + ranked_candidates
                )
            )[:MAX_TARGET_CANDIDATES]
        ranked_candidate_set = set(ranked_candidates)

        time_left = max_steps - step

        if focus_cluster_id is not None:
            focus_pool = cluster_frontier_members[focus_cluster_id]
            focus_local_candidates = heapq.nsmallest(
                MAX_TARGET_CANDIDATES,
                (
                    mineral_index
                    for mineral_index in focus_pool
                    if self._index_chebyshev_distance(pos_index, mineral_index)
                    <= FOCUS_LOCAL_SWEEP_RADIUS
                ),
                key=lambda mineral_index: (
                    self._index_chebyshev_distance(pos_index, mineral_index),
                    -frontier_exposure_map[mineral_index],
                    -density_map[mineral_index],
                ),
            )
            if focus_local_candidates:
                local_target, local_evaluation, _ = self._best_candidate_from_pool(
                    focus_local_candidates,
                    pos,
                    pos_index,
                    battery,
                    step,
                    max_steps,
                    time_left,
                    density_map,
                    cluster_size_map,
                    frontier_exposure_map,
                    cluster_frontier_map,
                )
                if local_target is not None and local_evaluation is not None:
                    return self._index_to_position(local_target), local_evaluation

            focus_candidates = heapq.nsmallest(
                MAX_TARGET_CANDIDATES,
                focus_pool,
                key=lambda mineral_index: (
                    self._index_chebyshev_distance(pos_index, mineral_index),
                    -density_map[mineral_index],
                    -frontier_exposure_map[mineral_index],
                ),
            )

            adjacent_focus_candidates = sorted(
                (
                    mineral_index
                    for mineral_index in adjacent_candidates
                    if cluster_id_map[mineral_index] == focus_cluster_id
                ),
                key=lambda mineral_index: (
                    self._index_chebyshev_distance(pos_index, mineral_index),
                    -cluster_frontier_map[mineral_index],
                ),
            )
            if adjacent_focus_candidates:
                focus_candidates = list(
                    dict.fromkeys(adjacent_focus_candidates + focus_candidates)
                )[:MAX_TARGET_CANDIDATES]

            focus_target, focus_evaluation, _ = self._best_candidate_from_pool(
                focus_candidates,
                pos,
                pos_index,
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
                return self._index_to_position(focus_target), focus_evaluation

        best_target, best_evaluation, best_score = self._best_candidate_from_pool(
            ranked_candidates,
            pos,
            pos_index,
            battery,
            step,
            max_steps,
            time_left,
            density_map,
            cluster_size_map,
            frontier_exposure_map,
            cluster_frontier_map,
        )

        if best_target is None and len(ranked_candidate_set) < len(current_indices):
            fallback_candidates = sorted(
                (mineral_index for mineral_index in current_indices if mineral_index not in ranked_candidate_set),
                key=lambda mineral_index: self._candidate_rank_key(
                    pos_index,
                    mineral_index,
                    density_map,
                    cluster_size_map,
                    frontier_exposure_map,
                ),
            )

            fallback_target, fallback_evaluation, fallback_score = self._best_candidate_from_pool(
                fallback_candidates,
                pos,
                pos_index,
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

        return self._index_to_position(best_target), best_evaluation
