import random
import csv
import os
import math
import numpy as np
from concurrent.futures import ProcessPoolExecutor, as_completed
from multiprocessing import cpu_count


def perlin_noise_2d(x, y, seed=0):
    """Simple 2D Perlin-like noise implementation."""
    np.random.seed(seed)

    def fade(t):
        return t * t * t * (t * (t * 6 - 15) + 10)

    def lerp(t, a, b):
        return a + t * (b - a)

    def gradient(h, x, y):
        vectors = [(0, 1), (0, -1), (1, 0), (-1, 0)]
        g = vectors[h % 4]
        return g[0] * x + g[1] * y

    x0 = int(math.floor(x))
    x1 = x0 + 1
    y0 = int(math.floor(y))
    y1 = y0 + 1

    sx = fade(x - x0)
    sy = fade(y - y0)

    def hash_coord(x, y):
        return (x * 374761393 + y * 668265263 + seed) % 256

    n0 = gradient(hash_coord(x0, y0), x - x0, y - y0)
    n1 = gradient(hash_coord(x1, y0), x - x1, y - y0)
    ix0 = lerp(sx, n0, n1)

    n0 = gradient(hash_coord(x0, y1), x - x0, y - y1)
    n1 = gradient(hash_coord(x1, y1), x - x1, y - y1)
    ix1 = lerp(sx, n0, n1)

    return lerp(sy, ix0, ix1)


def generate_noise_map(width, height, scale, octaves, seed):
    """Generate multi-octave noise map."""
    noise_map = np.zeros((height, width))

    for y in range(height):
        for x in range(width):
            amplitude = 1.0
            frequency = 1.0
            noise_value = 0.0

            for _ in range(octaves):
                sample_x = x / scale * frequency
                sample_y = y / scale * frequency
                noise_value += (
                    perlin_noise_2d(sample_x, sample_y, seed) * amplitude
                )
                amplitude *= 0.5
                frequency *= 2.0

            noise_map[y][x] = noise_value

    # Normalize to 0-1 range
    noise_map = (noise_map - noise_map.min()) / (
        noise_map.max() - noise_map.min()
    )
    return noise_map


def add_sine_waves(noise_map, width, height, seed):
    """Add sine wave patterns for variation."""
    random.seed(seed)
    wave_map = np.zeros((height, width))

    num_waves = random.randint(3, 6)

    for _ in range(num_waves):
        angle = random.uniform(0, math.pi)
        frequency = random.uniform(0.05, 0.15)
        amplitude = random.uniform(0.1, 0.3)

        for y in range(height):
            for x in range(width):
                wave_value = math.sin(
                    (x * math.cos(angle) + y * math.sin(angle)) * frequency
                )
                wave_map[y][x] += wave_value * amplitude

    wave_map = (wave_map - wave_map.min()) / (
        wave_map.max() - wave_map.min()
    )
    combined = noise_map * 0.7 + wave_map * 0.3
    return combined


def generate_amorphous_cluster(seed, size_range=(8, 16)):
    """Generate an organic, amorphous cluster shape."""
    random.seed(seed)

    # Start with a seed point
    cells = [(0, 0)]
    target_size = random.randint(size_range[0], size_range[1])

    # Grow organically
    while len(cells) < target_size:
        # Pick a random edge cell
        base_cell = random.choice(cells)
        base_x, base_y = base_cell

        # Try to grow in a random direction (with bias for continuation)
        directions = [
            (0, 1),
            (0, -1),
            (1, 0),
            (-1, 0),
            (1, 1),
            (-1, -1),
            (1, -1),
            (-1, 1),
        ]
        random.shuffle(directions)

        for dx, dy in directions:
            new_cell = (base_x + dx, base_y + dy)
            if new_cell not in cells:
                cells.append(new_cell)
                break

        # Safety check
        if len(cells) >= target_size * 2:
            break

    return cells[:target_size]


def get_amorphous_shapes():
    """Get a variety of predefined organic shapes."""
    shapes = [
        # Amoeba-like blob
        [
            (1, 0),
            (2, 0),
            (0, 1),
            (1, 1),
            (2, 1),
            (3, 1),
            (0, 2),
            (1, 2),
            (2, 2),
            (3, 2),
            (4, 2),
            (1, 3),
            (2, 3),
            (3, 3),
            (2, 4),
        ],
        # Winding shape
        [
            (0, 0),
            (1, 0),
            (0, 1),
            (1, 1),
            (2, 1),
            (2, 2),
            (3, 2),
            (3, 3),
            (4, 3),
            (4, 4),
        ],
        # Irregular blob with tentacles
        [
            (2, 0),
            (1, 1),
            (2, 1),
            (3, 1),
            (0, 2),
            (1, 2),
            (2, 2),
            (3, 2),
            (4, 2),
            (1, 3),
            (2, 3),
            (3, 3),
            (2, 4),
            (3, 4),
        ],
        # Curved shape
        [
            (0, 0),
            (1, 0),
            (2, 0),
            (0, 1),
            (1, 1),
            (0, 2),
            (1, 2),
            (2, 2),
            (2, 3),
            (3, 3),
            (3, 4),
        ],
        # Organic cluster 1
        [
            (1, 0),
            (2, 0),
            (3, 0),
            (0, 1),
            (1, 1),
            (2, 1),
            (1, 2),
            (2, 2),
            (3, 2),
            (4, 2),
            (3, 3),
            (4, 3),
        ],
        # Branching form
        [
            (2, 0),
            (2, 1),
            (1, 2),
            (2, 2),
            (3, 2),
            (0, 3),
            (1, 3),
            (2, 3),
            (3, 3),
            (4, 3),
            (2, 4),
        ],
        # Scattered organic
        [
            (1, 0),
            (2, 0),
            (0, 1),
            (1, 1),
            (3, 1),
            (1, 2),
            (2, 2),
            (3, 2),
            (0, 3),
            (2, 3),
            (1, 4),
        ],
        # Irregular mass
        [
            (0, 0),
            (1, 0),
            (0, 1),
            (1, 1),
            (2, 1),
            (3, 1),
            (1, 2),
            (2, 2),
            (3, 2),
            (2, 3),
            (3, 3),
            (4, 3),
            (3, 4),
        ],
        # Sprawling blob
        [
            (2, 0),
            (1, 1),
            (2, 1),
            (3, 1),
            (0, 2),
            (1, 2),
            (2, 2),
            (4, 2),
            (1, 3),
            (2, 3),
            (3, 3),
            (2, 4),
        ],
        # Meandering form
        [
            (0, 0),
            (1, 0),
            (1, 1),
            (2, 1),
            (2, 2),
            (3, 2),
            (3, 3),
            (2, 3),
            (2, 4),
            (3, 4),
        ],
    ]
    return shapes


def place_clean_cluster(mars_map, x, y, symbol, width, height, seed):
    """Place an amorphous cluster with clean margins."""
    random.seed(seed + x * 1000 + y)

    # Mix of procedural and predefined shapes
    if random.random() < 0.5:
        shape = generate_amorphous_cluster(seed + x + y, size_range=(8, 18))
    else:
        shapes = get_amorphous_shapes()
        shape = random.choice(shapes)

    # Randomly rotate the shape
    rotation = random.choice([0, 90, 180, 270])
    if rotation == 90:
        shape = [(-dy, dx) for dx, dy in shape]
    elif rotation == 180:
        shape = [(-dx, -dy) for dx, dy in shape]
    elif rotation == 270:
        shape = [(dy, -dx) for dx, dy in shape]

    # Randomly flip
    if random.random() < 0.5:
        shape = [(-dx, dy) for dx, dy in shape]

    # Place the cluster
    placed = False
    for dx, dy in shape:
        new_x, new_y = x + dx, y + dy
        if 0 <= new_x < width and 0 <= new_y < height:
            if mars_map[new_y][new_x] == ".":
                mars_map[new_y][new_x] = symbol
                placed = True

    return placed


def generate_terrain_with_clusters(width, height, seed):
    """Generate terrain by placing discrete amorphous clusters."""
    mars_map = [["." for _ in range(width)] for _ in range(height)]
    random.seed(seed)

    # Generate noise maps to determine WHERE clusters spawn
    blue_noise = generate_noise_map(width, height, 15, 3, seed + 1)
    yellow_noise = generate_noise_map(width, height, 18, 3, seed + 2)
    green_noise = generate_noise_map(width, height, 20, 3, seed + 3)
    obstacle_noise = generate_noise_map(width, height, 12, 3, seed + 4)

    # Place blue mineral clusters
    for y in range(0, height, 6):
        for x in range(0, width, 6):
            if blue_noise[y][x] > 0.68:
                place_clean_cluster(
                    mars_map, x, y, "B", width, height, seed + x + y
                )

    # Place yellow mineral clusters
    for y in range(0, height, 7):
        for x in range(0, width, 7):
            if yellow_noise[y][x] > 0.70:
                place_clean_cluster(
                    mars_map, x, y, "Y", width, height, seed + x + y + 1000
                )

    # Place green mineral clusters
    for y in range(0, height, 8):
        for x in range(0, width, 8):
            if green_noise[y][x] > 0.72:
                place_clean_cluster(
                    mars_map, x, y, "G", width, height, seed + x + y + 2000
                )

    # Place obstacle clusters
    for y in range(0, height, 5):
        for x in range(0, width, 5):
            if obstacle_noise[y][x] > 0.73:
                place_clean_cluster(
                    mars_map, x, y, "#", width, height, seed + x + y + 3000
                )

    return mars_map


def place_rover(mars_map, width, height, seed):
    """Place rover in an open area."""
    random.seed(seed)
    attempts = 0
    max_attempts = 100

    while attempts < max_attempts:
        x = random.randint(5, width - 6)
        y = random.randint(5, height - 6)

        # Check if area is clear
        clear = True
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                if mars_map[y + dy][x + dx] != ".":
                    clear = False
                    break
            if not clear:
                break

        if clear:
            mars_map[y][x] = "S"
            return mars_map
        attempts += 1

    # Fallback
    for y in range(height):
        for x in range(width):
            if mars_map[y][x] == ".":
                mars_map[y][x] = "S"
                return mars_map

    return mars_map


def generate_mars_map(width=50, height=50, seed=None):
    """Generate a Mars surface map with amorphous clusters."""
    if seed is None:
        seed = random.randint(0, 1000000)

    # Generate terrain with amorphous clusters
    mars_map = generate_terrain_with_clusters(width, height, seed)

    # Place rover
    mars_map = place_rover(mars_map, width, height, seed)

    return mars_map


def save_map_to_csv(mars_map, filename):
    """Save the map to a CSV file."""
    with open(filename, "w", newline="") as f:
        writer = csv.writer(f)
        for row in mars_map:
            writer.writerow(row)


def generate_and_save_map(args):
    """Worker function to generate and save a single map."""
    i, output_dir = args
    seed = i * 1000
    mars_map = generate_mars_map(width=50, height=50, seed=seed)
    filename = os.path.join(output_dir, f"mars_map_{i+1:05d}.csv")
    save_map_to_csv(mars_map, filename)
    return i + 1


if __name__ == "__main__":
    # Create output directory
    output_dir = "mars_maps"
    os.makedirs(output_dir, exist_ok=True)

    # Number of maps to generate
    num_maps = 10000

    # Determine number of worker processes (use all available cores)
    num_workers = cpu_count()
    print(f"Using {num_workers} worker processes...")

    # Prepare arguments for worker function
    tasks = [(i, output_dir) for i in range(num_maps)]

    # Generate maps in parallel
    print(f"Generating {num_maps} Mars maps with amorphous clusters...")

    completed = 0
    with ProcessPoolExecutor(max_workers=num_workers) as executor:
        futures = {executor.submit(generate_and_save_map, task): task for task in tasks}

        for future in as_completed(futures):
            try:
                result = future.result()
                completed += 1

                # Print progress every 100 maps
                if completed % 100 == 0:
                    print(f"Generated {completed}/{num_maps} maps...")
            except Exception as e:
                print(f"Error generating map: {e}")

    print(f"\nCompleted! All {num_maps} maps saved in '{output_dir}/' directory")
    print(f"Files: mars_map_00001.csv to mars_map_{num_maps:05d}.csv")