import csv
import heapq

# --- CONSTANTS FROM TASK ---
GRID_SIZE = 50
MAX_BATTERY = 100
K_CONSTANT = 2
DAY_STEPS = 32  # 16 hours = 32 * 0.5h
NIGHT_STEPS = 16  # 8 hours = 16 * 0.5h
CYCLE = DAY_STEPS + NIGHT_STEPS
MAX_TARGET_CANDIDATES = 80
CLUSTER_RADIUS = 2
MINERAL_TYPES = {"B", "Y", "G"}
NEIGHBOR_DELTAS = [
    (-1, -1), (-1, 0), (-1, 1),
    (0, -1),           (0, 1),
    (1, -1),  (1, 0),  (1, 1),
]


class MarsMission:
    def __init__(self, map_file):
        self.obstacles = set()
        self.minerals = {}  # (r, c): type
        self.start_pos = (0, 0)
        self.height = 0
        self.width = 0
        self.load_csv(map_file)

    def load_csv(self, map_file):
        with open(map_file, "r") as f:
            content = f.read()
            delimiter = ";" if ";" in content else ","
            f.seek(0)
            reader = csv.reader(f, delimiter=delimiter)

            for r, row in enumerate(reader):
                self.height = max(self.height, r + 1)
                self.width = max(self.width, len(row))
                for c, raw_cell in enumerate(row):
                    cell = raw_cell.strip()
                    if cell == "#":
                        self.obstacles.add((r, c))
                    elif cell in MINERAL_TYPES:
                        self.minerals[(r, c)] = cell
                    elif cell == "S":
                        self.start_pos = (r, c)


class RoverPlanner:
    def __init__(self, mission):
        self.m = mission
        self.remaining_minerals: set[tuple[int, int]] = set(mission.minerals.keys())
        self._path_world_version = 0
        self._pair_path_cache: dict[
            tuple[int, tuple[int, int], tuple[int, int], tuple[tuple[int, int], ...]],
            list[tuple[int, int]],
        ] = {}

    def _is_day(self, step: int) -> bool:
        return (step % CYCLE) < DAY_STEPS

    def _solar_charge(self, step: int) -> int:
        return 10 if self._is_day(step) else 0

    def _move_battery(self, battery: float, step: int, moved_blocks: int) -> float:
        consumption = (K_CONSTANT * (moved_blocks ** 2)) if moved_blocks > 0 else 1
        return max(
            0.0,
            min(float(MAX_BATTERY), battery - consumption + self._solar_charge(step)),
        )

    def _mine_battery(self, battery: float, step: int) -> float:
        return max(0.0, min(float(MAX_BATTERY), battery - 2 + self._solar_charge(step)))

    def _standby_battery(self, battery: float, step: int) -> float:
        return max(0.0, min(float(MAX_BATTERY), battery - 1 + self._solar_charge(step)))

    def reset_planner_state(self, current_mins):
        self.remaining_minerals = set(current_mins)
        self._invalidate_path_cache()

    def sync_planner_state(self, current_mins):
        current_mins = set(current_mins)
        if current_mins != self.remaining_minerals:
            self.remaining_minerals = current_mins
            self._invalidate_path_cache()

    def mark_mined(self, pos):
        if pos in self.remaining_minerals:
            self.remaining_minerals.remove(pos)
            self._invalidate_path_cache()

    def _invalidate_path_cache(self):
        self._path_world_version += 1
        self._pair_path_cache.clear()

    def _in_bounds(self, pos):
        return (
            0 <= pos[0] < (self.m.height or GRID_SIZE)
            and 0 <= pos[1] < (self.m.width or GRID_SIZE)
        )

    def _extra_open_key(self, extra_open):
        if not extra_open:
            return ()
        return tuple(sorted(extra_open))

    def _is_walkable(self, pos, target, extra_open):
        if pos in self.m.obstacles:
            return False
        if pos == target or pos in extra_open:
            return True
        return pos not in self.remaining_minerals

    def _estimate_route_feasible(self, remaining_blocks: int, battery: float, step: int) -> bool:
        """
        Conservative feasibility check for the remaining route.

        We use the energy-optimal movement policy for the lower bound: move one block
        per half-hour. This may underestimate how much battery a faster plan needs,
        but it gives us a safe floor when deciding whether a speed choice could strand
        the rover before it can reach the final safety point.
        """
        projected_battery = battery
        projected_step = step

        for _ in range(remaining_blocks):
            projected_battery = self._move_battery(projected_battery, projected_step, 1)
            if projected_battery <= 0:
                return False
            projected_step += 1

        return True

    def pick_route_speed(self, remaining_blocks: int, battery: float, step: int) -> int:
        """
        Pick the fastest safe speed for the remaining planned route.

        `remaining_blocks` is the total obstacle-aware path length still required to
        reach the current target and, when applicable, get back home safely.
        """
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

    def _compute_path(self, start, target, extra_open=None):
        """A* returning the full path from start to target (start excluded, target included)."""
        if start == target:
            return []

        extra_open = set(extra_open or ())
        queue = [(0, start)]
        came_from = {start: None}
        cost = {start: 0}

        while queue:
            _, curr = heapq.heappop(queue)
            if curr == target:
                break

            for dr, dc in NEIGHBOR_DELTAS:
                nxt = (curr[0] + dr, curr[1] + dc)
                if not self._in_bounds(nxt):
                    continue
                if not self._is_walkable(nxt, target, extra_open):
                    continue

                new_cost = cost[curr] + 1
                if nxt not in cost or new_cost < cost[nxt]:
                    cost[nxt] = new_cost
                    priority = new_cost + max(
                        abs(nxt[0] - target[0]),
                        abs(nxt[1] - target[1]),
                    )
                    heapq.heappush(queue, (priority, nxt))
                    came_from[nxt] = curr

        if target not in came_from:
            return []

        path = []
        temp = target
        while temp != start:
            path.append(temp)
            temp = came_from[temp]
        path.reverse()
        return path

    def get_path(self, start, target, extra_open=None):
        if start == target:
            return []

        key = (
            self._path_world_version,
            start,
            target,
            self._extra_open_key(extra_open),
        )
        cached = self._pair_path_cache.get(key)
        if cached is not None:
            return cached

        path = self._compute_path(start, target, extra_open=extra_open)
        self._pair_path_cache[key] = path
        return path

    def _candidate_density_map(self, current_mins):
        density = {}
        for mineral in current_mins:
            density[mineral] = sum(
                1
                for other in current_mins
                if other != mineral
                and max(abs(mineral[0] - other[0]), abs(mineral[1] - other[1])) <= CLUSTER_RADIUS
            )
        return density

    def _is_frontier_mineral(self, mineral):
        for dr, dc in NEIGHBOR_DELTAS:
            nxt = (mineral[0] + dr, mineral[1] + dc)
            if not self._in_bounds(nxt) or nxt in self.m.obstacles:
                continue
            if nxt not in self.remaining_minerals:
                return True
        return False

    def _evaluate_candidate(self, pos, target, battery, step, max_steps):
        target_open = {target}
        outbound_path = self.get_path(pos, target, extra_open=target_open)
        if pos != target and not outbound_path:
            return None

        return_path = self.get_path(target, self.m.start_pos, extra_open=target_open)
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

            simulated_battery = self._move_battery(
                simulated_battery,
                simulated_step,
                moved_blocks,
            )
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

            simulated_battery = self._move_battery(
                simulated_battery,
                simulated_step,
                moved_blocks,
            )
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

    def choose_next_target(self, pos, battery, step, current_mins, max_steps):
        """
        Pick the next mineral to pursue.

        Candidates are ranked by a mix of proximity and local mineral density, then
        filtered through a full feasibility check that respects obstacles, battery,
        day/night charging, mining time, and the need to return home before the
        time budget expires.
        """
        if not current_mins:
            return None

        self.sync_planner_state(current_mins)

        density_map = self._candidate_density_map(current_mins)
        frontier_candidates = [m for m in current_mins if self._is_frontier_mineral(m)]
        candidate_pool = frontier_candidates or list(current_mins)
        ranked_candidates = sorted(
            candidate_pool,
            key=lambda mineral: (
                max(abs(pos[0] - mineral[0]), abs(pos[1] - mineral[1]))
                - 0.75 * min(density_map[mineral], 6),
                max(
                    abs(self.m.start_pos[0] - mineral[0]),
                    abs(self.m.start_pos[1] - mineral[1]),
                ),
            ),
        )[:MAX_TARGET_CANDIDATES]
        ranked_candidate_set = set(ranked_candidates)

        best_target = None
        best_evaluation = None
        best_score = None
        time_left = max_steps - step

        for mineral in ranked_candidates:
            evaluation = self._evaluate_candidate(pos, mineral, battery, step, max_steps)
            if evaluation is None:
                continue

            cluster_bonus = min(density_map[mineral], 8)
            frontier_bonus = 0.2 if mineral in frontier_candidates else 0.0
            score = (
                (1.0 + 0.35 * cluster_bonus + frontier_bonus)
                / max(1.0, evaluation["to_target_steps"])
                + 0.002 * evaluation["battery_after_return"]
                + 0.001 * max(0, time_left - evaluation["roundtrip_steps"])
            )

            if best_score is None or score > best_score:
                best_target = mineral
                best_evaluation = evaluation
                best_score = score

        if best_target is None and len(ranked_candidate_set) < len(current_mins):
            fallback_candidates = sorted(
                (mineral for mineral in current_mins if mineral not in ranked_candidate_set),
                key=lambda mineral: (
                    max(abs(pos[0] - mineral[0]), abs(pos[1] - mineral[1])),
                    max(abs(self.m.start_pos[0] - mineral[0]), abs(self.m.start_pos[1] - mineral[1])),
                ),
            )

            for mineral in fallback_candidates:
                evaluation = self._evaluate_candidate(pos, mineral, battery, step, max_steps)
                if evaluation is None:
                    continue

                cluster_bonus = min(density_map[mineral], 8)
                score = (
                    (1.0 + 0.35 * cluster_bonus) / max(1.0, evaluation["to_target_steps"])
                    + 0.002 * evaluation["battery_after_return"]
                    + 0.001 * max(0, time_left - evaluation["roundtrip_steps"])
                )

                if best_score is None or score > best_score:
                    best_target = mineral
                    best_evaluation = evaluation
                    best_score = score

        if best_target is None:
            return None

        return best_target, best_evaluation

    def path_step(self, start, target, speed):
        if start == target:
            return start, 0

        extra_open = {target} if target in self.remaining_minerals else None
        current_path = self.get_path(start, target, extra_open=extra_open)
        if not current_path:
            return start, 0

        actual_move = min(len(current_path), speed)
        return current_path[actual_move - 1], actual_move
