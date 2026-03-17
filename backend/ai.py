import csv
import heapq
import random
from collections import deque

try:
    import numpy as np
except ImportError:  # numpy is only required for training / legacy Q-table use
    np = None

# --- CONSTANTS FROM TASK ---
GRID_SIZE = 50
MAX_BATTERY = 100
K_CONSTANT = 2
DAY_STEPS = 32  # 16 hours = 32 * 0.5h
NIGHT_STEPS = 16  # 8 hours = 16 * 0.5h
CYCLE = DAY_STEPS + NIGHT_STEPS
MAX_TARGET_CANDIDATES = 40
CLUSTER_RADIUS = 2


class MarsMission:
    def __init__(self, map_file):
        self.obstacles = set()
        self.minerals = {}  # (r, c): type
        self.start_pos = (0, 0)
        self.load_csv(map_file)

    def load_csv(self, map_file):
        with open(map_file, "r") as f:
            # Handle comma or semicolon delimiters automatically
            content = f.read()
            delimiter = ";" if ";" in content else ","
            f.seek(0)
            reader = csv.reader(f, delimiter=delimiter)

            for r, row in enumerate(reader):
                for c, cell in enumerate(row):
                    if cell == "#":
                        self.obstacles.add((r, c))
                    elif cell in ["B", "Y", "G"]:
                        self.minerals[(r, c)] = cell
                    elif cell == "S":
                        self.start_pos = (r, c)


class RLAgent:
    def __init__(self, mission):
        self.m = mission
        # State: (Dist_Bin, Bat_Bin, Time_Bin) -> 5*5*2
        # Actions: 0 = go to nearest mineral, 1 = go home
        # Speed is chosen separately by _pick_speed() based on energy budget
        self.q_table = np.zeros((5, 5, 2, 2)) if np is not None else None
        self.lr = 0.1
        self.gamma = 0.95
        self.epsilon = 0.3  # Exploration rate
        self._remaining_minerals = set(self.m.minerals.keys())
        # Path cache: reuse A* result while following the same target
        self._path_cache: list = []
        self._path_target = None
        self._pair_path_cache: dict[
            tuple[tuple[int, int], tuple[int, int], tuple[tuple[int, int], ...]],
            list[tuple[int, int]],
        ] = {}

    def _invalidate_route_cache(self):
        self._path_cache = []
        self._path_target = None
        self._pair_path_cache = {}

    def reset_runtime_state(self, remaining_minerals=None):
        self._remaining_minerals = set(
            self.m.minerals.keys() if remaining_minerals is None else remaining_minerals
        )
        self._invalidate_route_cache()

    def clear_mineral(self, mineral):
        if mineral in self._remaining_minerals:
            self._remaining_minerals.remove(mineral)
            self._invalidate_route_cache()

    def _is_day(self, step: int) -> bool:
        return (step % CYCLE) < DAY_STEPS

    def _solar_charge(self, step: int) -> int:
        return 10 if self._is_day(step) else 0

    def _move_battery(self, battery: float, step: int, moved_blocks: int) -> float:
        consumption = (K_CONSTANT * (moved_blocks ** 2)) if moved_blocks > 0 else 1
        return max(0.0, min(float(MAX_BATTERY), battery - consumption + self._solar_charge(step)))

    def _mine_battery(self, battery: float, step: int) -> float:
        return max(0.0, min(float(MAX_BATTERY), battery - 2 + self._solar_charge(step)))

    def _standby_battery(self, battery: float, step: int) -> float:
        return max(0.0, min(float(MAX_BATTERY), battery - 1 + self._solar_charge(step)))

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

    def _pick_speed(self, pos, battery, step) -> int:
        """
        Choose the fastest speed that leaves enough energy to return home.

        Cost to return home at speed v (Chebyshev steps = ceil(dist/v)):
            E_return = k * v^2 * ceil(dist/v) - solar_return
        We keep a safety margin and pick the highest v (1, 2, 3) such that
        battery - movement_cost_now - E_return_v >= SAFETY.
        Falls back to speed 1 if even that is tight.
        """
        home_path = self.get_path(pos, self.m.start_pos)
        speed = self.pick_route_speed(len(home_path), battery, step)
        return max(1, speed) if home_path else 1

    def get_state_index(self, pos, battery, step, current_mins):
        # 1. Distance to nearest objective
        if not current_mins:
            d_bin = 4
        else:
            d = min(max(abs(pos[0] - m[0]), abs(pos[1] - m[1])) for m in current_mins)
            d_bin = min(4, int(d / 10))

        # 2. Battery (0-100 -> 0-4)
        b_bin = min(4, int(battery / 21))

        # 3. Nappal vs Éjszaka
        is_day = 1 if (step % CYCLE) < DAY_STEPS else 0

        return (d_bin, b_bin, is_day)

    def _normalise_passable_cells(self, start, target, passable_cells=None):
        cells = {start, target}
        if passable_cells:
            cells.update(passable_cells)
        return tuple(sorted(cells))

    def _compute_path(self, start, target, passable_cells=()):
        """
        A* returning the full path from start to target (start excluded, target included).

        Mineral tiles that have not been mined yet are treated as temporarily occupied,
        except for the explicitly passable cells (for example the current target).
        Once a mineral is mined, `clear_mineral()` removes it from the blocked set so
        later paths can immediately cut through the opened corridor.
        """
        passable = set(passable_cells)
        queue = [(0, start)]
        came_from = {start: None}
        cost = {start: 0}

        while queue:
            _, curr = heapq.heappop(queue)
            if curr == target:
                break

            for dr, dc in [
                (-1, -1), (-1, 0), (-1, 1),
                (0, -1),           (0,  1),
                (1, -1),  (1,  0), (1,  1),
            ]:
                nxt = (curr[0] + dr, curr[1] + dc)
                if (
                    0 <= nxt[0] < GRID_SIZE
                    and 0 <= nxt[1] < GRID_SIZE
                    and nxt not in self.m.obstacles
                    and (nxt not in self._remaining_minerals or nxt in passable)
                ):
                    new_cost = cost[curr] + 1
                    if nxt not in cost or new_cost < cost[nxt]:
                        cost[nxt] = new_cost
                        priority = new_cost + max(
                            abs(nxt[0] - target[0]), abs(nxt[1] - target[1])
                        )
                        heapq.heappush(queue, (priority, nxt))
                        came_from[nxt] = curr

        path = []
        temp = target
        while temp in came_from and temp != start:
            path.append(temp)
            temp = came_from[temp]
        path.reverse()
        return path

    def get_path(self, start, target, passable_cells=None):
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

    def _chebyshev_distance(self, a, b):
        return max(abs(a[0] - b[0]), abs(a[1] - b[1]))

    def _candidate_rank_key(
        self,
        pos,
        mineral,
        density_map,
        cluster_size_map,
        frontier_exposure_map,
    ):
        return (
            self._chebyshev_distance(pos, mineral)
            - 0.85 * min(density_map[mineral], 6)
            - 0.35 * min(cluster_size_map[mineral] - 1, 14)
            - 0.25 * min(frontier_exposure_map[mineral], 4),
            self._chebyshev_distance(self.m.start_pos, mineral),
        )

    def _is_frontier_mineral(self, mineral, current_mins):
        exposure = 0

        for dr, dc in [
            (-1, -1), (-1, 0), (-1, 1),
            (0, -1),           (0, 1),
            (1, -1),  (1, 0),  (1, 1),
        ]:
            nxt = (mineral[0] + dr, mineral[1] + dc)
            if not (0 <= nxt[0] < GRID_SIZE and 0 <= nxt[1] < GRID_SIZE):
                continue
            if nxt in self.m.obstacles:
                continue
            if nxt not in current_mins:
                exposure += 1

        return exposure

    def _cluster_maps(self, current_mins):
        remaining = set(current_mins)
        cluster_size = {}
        cluster_frontier = {}
        cluster_id_map = {}
        cluster_members = {}
        cluster_id = 0

        while remaining:
            seed = remaining.pop()
            queue = deque([seed])
            cluster = [seed]

            while queue:
                curr = queue.popleft()
                for dr in range(-CLUSTER_RADIUS, CLUSTER_RADIUS + 1):
                    for dc in range(-CLUSTER_RADIUS, CLUSTER_RADIUS + 1):
                        if dr == 0 and dc == 0:
                            continue
                        if max(abs(dr), abs(dc)) > CLUSTER_RADIUS:
                            continue

                        nxt = (curr[0] + dr, curr[1] + dc)
                        if nxt in remaining:
                            remaining.remove(nxt)
                            queue.append(nxt)
                            cluster.append(nxt)

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

    def _select_focus_cluster(self, pos, current_mins, cluster_id_map, cluster_members):
        nearby_clusters = {}

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
            key=lambda cid: (
                nearby_clusters[cid]["min_distance"],
                -nearby_clusters[cid]["nearby_count"],
                -len(cluster_members[cid]),
            ),
        )

    def _score_candidate(
        self,
        pos,
        mineral,
        evaluation,
        time_left,
        density_map,
        cluster_size_map,
        frontier_exposure_map,
        cluster_frontier_map,
    ):
        density_bonus = min(density_map[mineral], 8)
        cluster_bonus = min(cluster_size_map[mineral] - 1, 14)
        frontier_bonus = min(frontier_exposure_map[mineral], 5)
        cluster_frontier_bonus = min(cluster_frontier_map[mineral], 10)
        distance_to_rover = self._chebyshev_distance(pos, mineral)
        continuation_bonus = (
            0.55
            if distance_to_rover <= 1
            else 0.2 if distance_to_rover <= CLUSTER_RADIUS else 0.0
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
        )

    def _best_candidate_from_pool(
        self,
        candidates,
        pos,
        battery,
        step,
        max_steps,
        time_left,
        density_map,
        cluster_size_map,
        frontier_exposure_map,
        cluster_frontier_map,
    ):
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

    def _evaluate_candidate(self, pos, target, battery, step, max_steps):
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

        density_map = self._candidate_density_map(current_mins)
        cluster_size_map, cluster_frontier_map, cluster_id_map, cluster_members = (
            self._cluster_maps(current_mins)
        )
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
            mineral
            for mineral in current_mins
            if self._chebyshev_distance(pos, mineral) <= 1
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
                    ) + ranked_candidates
                )
            )[:MAX_TARGET_CANDIDATES]
        ranked_candidate_set = set(ranked_candidates)

        time_left = max_steps - step

        # Once the rover is already inside a mineral neighborhood, finish that
        # feasible local cluster before switching to a different area.
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
            if focus_target is not None:
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
                best_score = fallback_score

        if best_target is None:
            return None

        return best_target, best_evaluation

    def path_step(self, start, target, speed):
        """Move along a cached A* path by up to `speed` steps, recomputing only when the target changes."""
        if start == target:
            return start, 0

        # Only recompute when the destination has changed or the cache is exhausted
        if target != self._path_target or not self._path_cache:
            self._path_cache = self.get_path(start, target, passable_cells=(start, target))
            self._path_target = target

        if not self._path_cache:
            return start, 0

        actual_move = min(len(self._path_cache), speed)
        new_pos = self._path_cache[actual_move - 1]
        self._path_cache = self._path_cache[actual_move:]  # consume used steps
        return new_pos, actual_move

    # Safety cap: large enough to complete any map, prevents infinite loops during training
    MAX_TRAIN_STEPS = 10_000

    def _require_numpy(self):
        if np is None:
            raise RuntimeError(
                "numpy is required for Q-table training, but it is not installed in this environment."
            )

    def train(self, episodes=1000):
        self._require_numpy()
        if self.q_table is None:
            self.q_table = np.zeros((5, 5, 2, 2))

        for ep in range(episodes):
            pos = self.m.start_pos
            battery = 100.0
            mins = set(self.m.minerals.keys())
            step = 0
            self.reset_runtime_state(mins)

            while step < self.MAX_TRAIN_STEPS:
                s_idx = self.get_state_index(pos, battery, step, mins)

                # Epsilon-greedy action selection (0 = mine, 1 = go home)
                if random.random() < self.epsilon:
                    action = random.randint(0, 1)
                else:
                    action = int(np.argmax(self.q_table[s_idx]))

                # Direction: go to nearest mineral or head home
                if action == 1 or not mins:
                    target = self.m.start_pos
                else:
                    selection = self.choose_next_target(
                        pos,
                        battery,
                        step,
                        mins,
                        self.MAX_TRAIN_STEPS,
                    )
                    target = selection[0] if selection is not None else self.m.start_pos
                # Speed: fastest that still leaves enough energy to get home
                speed_choice = self._pick_speed(pos, battery, step)

                # Execute physical movement
                old_dist = max(abs(pos[0] - target[0]), abs(pos[1] - target[1]))
                new_pos, dist_moved = self.path_step(pos, target, speed_choice)
                new_dist = max(abs(new_pos[0] - target[0]), abs(new_pos[1] - target[1]))

                # Energy for this half-hour slot (movement or standby if dist_moved==0)
                # E = k*v²  (v = blocks moved); standby = 1; spec: k=2
                consumption = (K_CONSTANT * (dist_moved ** 2)) if dist_moved > 0 else 1
                is_day = (step % CYCLE) < DAY_STEPS
                solar_charge = 10 if is_day else 0   # +10 per 0.5h daytime, 0 at night

                battery = max(0.0, min(100.0, battery - consumption + solar_charge))

                # Step penalty + shaped reward for making progress toward target
                reward = -0.5 + 0.2 * (old_dist - new_dist)

                # Mining: takes one additional 0.5h slot, costs 2 energy, rover stays put
                if new_pos in mins:
                    step += 1
                    mining_charge = 10 if (step % CYCLE) < DAY_STEPS else 0
                    battery = max(0.0, min(100.0, battery - 2 + mining_charge))
                    mins.remove(new_pos)
                    self.clear_mineral(new_pos)
                    reward += 100  # Huge reward for collecting

                # Failure condition — update Q-table before terminating
                if battery <= 0:
                    reward -= 500
                    self.q_table[s_idx][action] += self.lr * (
                        reward - self.q_table[s_idx][action]
                    )
                    break

                # Returning home success — update Q-table before terminating
                if not mins and new_pos == self.m.start_pos:
                    reward += 200
                    self.q_table[s_idx][action] += self.lr * (
                        reward - self.q_table[s_idx][action]
                    )
                    break

                # Update Q-Table (non-terminal)
                step += 1
                new_s_idx = self.get_state_index(new_pos, battery, step, mins)
                best_future_q = np.max(self.q_table[new_s_idx])
                self.q_table[s_idx][action] += self.lr * (
                    reward + self.gamma * best_future_q - self.q_table[s_idx][action]
                )

                pos = new_pos

            if ep % 100 == 0:
                print(f"Episode {ep} complete...")


def train_and_save(
    map_file="mars_map_50x50.csv",
    q_table_file="q_table",
    episodes=10000,
):
    if np is None:
        raise RuntimeError(
            "numpy is required for training, but it is not installed in this environment."
        )

    mission = MarsMission(map_file)
    agent = RLAgent(mission)
    print("Starting RL training against the CSV map layout...")
    agent.train(episodes=episodes)
    print("Training finished.")
    agent.q_table.dump(q_table_file)
    print(f"Saved q-table to {q_table_file}")


if __name__ == "__main__":
    train_and_save()
