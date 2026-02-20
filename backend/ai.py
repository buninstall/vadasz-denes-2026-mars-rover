import numpy as np
import heapq
import csv
import random

# --- CONSTANTS FROM TASK ---
GRID_SIZE = 50
MAX_BATTERY = 100
K_CONSTANT = 2
DAY_STEPS = 32  # 16 hours = 32 * 0.5h
NIGHT_STEPS = 16  # 8 hours = 16 * 0.5h
CYCLE = DAY_STEPS + NIGHT_STEPS


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
        self.q_table = np.zeros((5, 5, 2, 2))
        self.lr = 0.1
        self.gamma = 0.95
        self.epsilon = 0.3  # Exploration rate
        # Path cache: reuse A* result while following the same target
        self._path_cache: list = []
        self._path_target = None

    def _pick_speed(self, pos, battery, step) -> int:
        """
        Choose the fastest speed that leaves enough energy to return home.

        Cost to return home at speed v (Chebyshev steps = ceil(dist/v)):
            E_return = k * v^2 * ceil(dist/v) - solar_return
        We keep a safety margin and pick the highest v (1, 2, 3) such that
        battery - movement_cost_now - E_return_v >= SAFETY.
        Falls back to speed 1 if even that is tight.
        """
        SAFETY = 5  # keep at least this much battery after returning home
        dist_home = max(abs(pos[0] - self.m.start_pos[0]), abs(pos[1] - self.m.start_pos[1]))
        is_day = (step % CYCLE) < DAY_STEPS
        solar_per_step = 10 if is_day else 0

        for v in (3, 2, 1):
            move_cost = K_CONSTANT * v ** 2       # cost of this step at speed v
            if dist_home == 0:
                return v                           # already home, any speed fine
            steps_home = -(-dist_home // v)       # ceil(dist/v)
            # Net cost to get home: consumption minus solar earned en route
            net_return = max(0, K_CONSTANT * v ** 2 * steps_home - solar_per_step * steps_home)
            if battery - move_cost - net_return >= SAFETY:
                return v
        return 1  # always safe fallback

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

    def _compute_path(self, start, target):
        """A* returning the full path from start to target (start excluded, target included)."""
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

    def path_step(self, start, target, speed):
        """Move along a cached A* path by up to `speed` steps, recomputing only when the target changes."""
        if start == target:
            return start, 0

        # Only recompute when the destination has changed or the cache is exhausted
        if target != self._path_target or not self._path_cache:
            self._path_cache = self._compute_path(start, target)
            self._path_target = target

        if not self._path_cache:
            return start, 0

        actual_move = min(len(self._path_cache), speed)
        new_pos = self._path_cache[actual_move - 1]
        self._path_cache = self._path_cache[actual_move:]  # consume used steps
        return new_pos, actual_move

    # Safety cap: large enough to complete any map, prevents infinite loops during training
    MAX_TRAIN_STEPS = 10_000

    def train(self, episodes=1000):
        for ep in range(episodes):
            pos = self.m.start_pos
            battery = 100.0
            mins = set(self.m.minerals.keys())
            step = 0
            # Reset path cache so stale paths from previous episodes / maps are discarded
            self._path_cache = []
            self._path_target = None

            while step < self.MAX_TRAIN_STEPS:
                s_idx = self.get_state_index(pos, battery, step, mins)

                # Epsilon-greedy action selection (0 = mine, 1 = go home)
                if random.random() < self.epsilon:
                    action = random.randint(0, 1)
                else:
                    action = int(np.argmax(self.q_table[s_idx]))

                # Direction: go to nearest mineral or head home
                target = (
                    self.m.start_pos
                    if (action == 1 or not mins)
                    else min(
                        mins, key=lambda m: max(abs(pos[0] - m[0]), abs(pos[1] - m[1]))
                    )
                )
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
    mission = MarsMission(map_file)
    agent = RLAgent(mission)
    print("Starting RL training against the CSV map layout...")
    agent.train(episodes=episodes)
    print("Training finished.")
    agent.q_table.dump(q_table_file)
    print(f"Saved q-table to {q_table_file}")


if __name__ == "__main__":
    train_and_save()
