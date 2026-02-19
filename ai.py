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
        # Actions: 0: Go to nearest mineral (S1), 1: (S2), 2: (S3), 3: Go Home (S1), 4: (S2), 5: (S3)
        self.q_table = np.zeros((5, 5, 2, 6))
        self.lr = 0.1
        self.gamma = 0.95
        self.epsilon = 0.3  # Exploration rate

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

    def path_step(self, start, target, speed):
        """Uses A* to find the next physical coordinate based on speed."""
        if start == target:
            return start, 0

        # Simple A* for 8-way movement
        queue = [(0, start)]
        came_from = {start: None}
        cost = {start: 0}

        while queue:
            _, curr = heapq.heappop(queue)
            if curr == target:
                break

            for dr, dc in [
                (-1, -1),
                (-1, 0),
                (-1, 1),
                (0, -1),
                (0, 1),
                (1, -1),
                (1, 0),
                (1, 1),
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

        # Reconstruct path and pick the node at 'speed' distance
        path = []
        temp = target
        while temp in came_from and temp != start:
            path.append(temp)
            temp = came_from[temp]
        path.reverse()

        actual_move = min(len(path), speed)
        new_pos = path[actual_move - 1] if path else start
        return new_pos, actual_move

    def train(self, episodes=1000, hours=24):
        total_steps = hours * 2

        for ep in range(episodes):
            pos = self.m.start_pos
            battery = 100.0
            mins = set(self.m.minerals.keys())
            step = 0

            while step < total_steps:
                s_idx = self.get_state_index(pos, battery, step, mins)

                # Epsilon-greedy action selection
                if random.random() < self.epsilon:
                    action = random.randint(0, 5)
                else:
                    action = np.argmax(self.q_table[s_idx])

                # Logic for action
                target = (
                    self.m.start_pos
                    if (action > 2 or not mins)
                    else min(
                        mins, key=lambda m: max(abs(pos[0] - m[0]), abs(pos[1] - m[1]))
                    )
                )
                speed_choice = (action % 3) + 1

                # Execute physical movement
                new_pos, dist_moved = self.path_step(pos, target, speed_choice)

                # Energy Calculation
                # Consumption: E = k * v^2 (v is blocks moved in 0.5h)
                # If idle, consumption is 1
                consumption = (K_CONSTANT * (dist_moved**2)) if dist_moved > 0 else 1
                is_day = (step % CYCLE) < DAY_STEPS
                charge = 10 if is_day else 0

                battery = min(100, battery - consumption + charge)

                reward = -0.5  # Small penalty to encourage speed

                # Mining Check
                if new_pos in mins:
                    # Task: Mining takes 0.5h and costs 2 units
                    step += 1
                    battery = min(
                        100, battery - 2 + (10 if (step % CYCLE) < DAY_STEPS else 0)
                    )
                    mins.remove(new_pos)
                    reward += 100  # Huge reward for collecting

                # Failure condition
                if battery <= 0:
                    reward -= 500
                    break

                # Returning home success
                if not mins and new_pos == self.m.start_pos:
                    reward += 200
                    break

                # Update Q-Table
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
    hours=24,
):
    mission = MarsMission(map_file)
    agent = RLAgent(mission)
    print("Starting RL training against the CSV map layout...")
    agent.train(episodes=episodes, hours=hours)
    print("Training finished.")
    agent.q_table.dump(q_table_file)
    print(f"Saved q-table to {q_table_file}")


if __name__ == "__main__":
    train_and_save()
