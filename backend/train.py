import os
import glob
import random
import time
import numpy as np
from concurrent.futures import ProcessPoolExecutor
from multiprocessing import cpu_count
from ai import MarsMission, RLAgent

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

EPOCHS = 5
EPISODES_PER_MAP = 3
# Leave one core free for the OS; at least 1 worker
N_WORKERS = max(1, cpu_count() - 1)


def _worker(args: tuple) -> np.ndarray:
    """
    Train on a chunk of maps and return the updated Q-table.
    Must be a top-level function so it is picklable on macOS (spawn).
    """
    map_chunk, q_table_flat, q_shape, epsilons = args

    agent = RLAgent(MarsMission(map_chunk[0]))
    agent.q_table = q_table_flat.reshape(q_shape).copy()

    for map_path, epsilon in zip(map_chunk, epsilons):
        agent.epsilon = epsilon
        agent.m = MarsMission(map_path)
        agent.train(episodes=EPISODES_PER_MAP)

    return agent.q_table.ravel()  # flatten for safe pickling


def train_parallel(map_files: list) -> np.ndarray:
    n = len(map_files)
    total_steps = EPOCHS * n * EPISODES_PER_MAP
    global_step = 0

    q_table = np.zeros((5, 5, 2, 2))  # 2 actions: mine vs go home
    q_shape = q_table.shape

    print(f"Workers : {N_WORKERS}  |  Maps : {n}  |  Epochs : {EPOCHS}  |  Episodes/map : {EPISODES_PER_MAP}")

    for epoch in range(EPOCHS):
        t0 = time.time()
        print(f"\nEpoch {epoch + 1}/{EPOCHS}")

        epoch_files = map_files[:]
        random.shuffle(epoch_files)

        # Build epsilon schedule — one value per map block
        epsilons = []
        for _ in range(n):
            epsilons.append(max(0.05, 0.5 * (1 - global_step / total_steps)))
            global_step += EPISODES_PER_MAP

        # Divide maps evenly across workers
        chunk_size = max(1, (n + N_WORKERS - 1) // N_WORKERS)
        worker_args = []
        for i in range(0, n, chunk_size):
            chunk = epoch_files[i : i + chunk_size]
            eps_chunk = epsilons[i : i + chunk_size]
            worker_args.append((chunk, q_table.ravel(), q_shape, eps_chunk))

        # Parallel training — each worker returns its own trained Q-table
        with ProcessPoolExecutor(max_workers=N_WORKERS) as pool:
            results = list(pool.map(_worker, worker_args))

        # Federated average: merge all workers' experience into one Q-table
        q_table = np.mean([r.reshape(q_shape) for r in results], axis=0)

        elapsed = time.time() - t0
        print(f"  Done in {elapsed:.1f}s  |  epsilon {epsilons[0]:.3f} → {epsilons[-1]:.3f}")

    return q_table


if __name__ == "__main__":
    map_files = glob.glob(os.path.join(BASE_DIR, "mars_maps/*.csv"))
    if not map_files:
        raise FileNotFoundError(f"No CSV maps found in {BASE_DIR}/mars_maps/")

    t_start = time.time()
    q_table = train_parallel(map_files)

    out_path = os.path.join(BASE_DIR, "rover_model.npy")
    np.save(out_path, q_table)

    print(f"\nTotal training time : {time.time() - t_start:.1f}s")
    print(f"Saved Q-table to    : {out_path}")