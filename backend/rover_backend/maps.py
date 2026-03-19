import csv
import random
from pathlib import Path

from .config import (
    BACKEND_DIR,
    DEFAULT_MAP_NAME,
    DEFAULT_MAP_PATH,
    MAPS_DIR,
    KONNYU_MAPS_DIR,
    NEHEZ_MAPS_DIR,
    RUNTIME_MAPS_DIR,
    UPLOADS_DIR,
)


def parse_csv_grid(content: str) -> list[list[str]]:
    non_empty_lines = [line for line in content.splitlines() if line.strip()]
    if not non_empty_lines:
        return []

    sample_line = non_empty_lines[0]
    delimiter = ";" if sample_line.count(";") > sample_line.count(",") else ","
    reader = csv.reader(non_empty_lines, delimiter=delimiter, skipinitialspace=True)

    grid: list[list[str]] = []
    for row in reader:
        stripped_row = [cell.strip() for cell in row]

        while stripped_row and stripped_row[-1] == "":
            stripped_row.pop()

        if not stripped_row:
            continue

        normalized_row = [cell if cell else "." for cell in stripped_row]
        grid.append(normalized_row)

    return grid


def load_map_from_csv(file_path: str | Path) -> list[list[str]] | None:
    try:
        content = Path(file_path).read_text(encoding="utf-8")
    except FileNotFoundError:
        return None

    return parse_csv_grid(content)


def list_generated_maps(complexity: str = "uncomplicated") -> list[Path]:
    target_dir = NEHEZ_MAPS_DIR if complexity == "complicated" else KONNYU_MAPS_DIR
    if not target_dir.is_dir():
        return []

    return sorted(path for path in target_dir.iterdir() if path.suffix == ".csv")


def pick_map_path(random_map: bool = True, complexity: str = "uncomplicated") -> Path:
    if not random_map:
        return DEFAULT_MAP_PATH

    available_maps = list_generated_maps(complexity)
    if not available_maps:
        target_dir = NEHEZ_MAPS_DIR if complexity == "complicated" else KONNYU_MAPS_DIR
        raise FileNotFoundError(f"No CSV files found in {target_dir}")

    return random.choice(available_maps)


def write_map_to_csv(grid: list[list[str]], file_path: str | Path) -> None:
    target_path = Path(file_path)
    target_path.parent.mkdir(parents=True, exist_ok=True)

    with target_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerows(grid)


def randomize_start_point(grid: list[list[str]]) -> list[list[str]]:
    if not grid:
        raise ValueError("Map grid is empty")

    randomized_grid = [row.copy() for row in grid]
    preferred_candidates: list[tuple[int, int]] = []
    fallback_candidates: list[tuple[int, int]] = []

    for row_index, row in enumerate(randomized_grid):
        for column_index, value in enumerate(row):
            if value == "S":
                randomized_grid[row_index][column_index] = "."

            if value in {".", "S"}:
                preferred_candidates.append((row_index, column_index))

            if value != "#":
                fallback_candidates.append((row_index, column_index))

    if preferred_candidates:
        start_row, start_column = random.choice(preferred_candidates)
    elif fallback_candidates:
        start_row, start_column = random.choice(fallback_candidates)
    else:
        raise ValueError("Map has no traversable cell for a start point")

    randomized_grid[start_row][start_column] = "S"
    return randomized_grid


def find_start_point(grid: list[list[str]]) -> tuple[int, int]:
    starts: list[tuple[int, int]] = []

    for row_index, row in enumerate(grid):
        for column_index, value in enumerate(row):
            if value == "S":
                starts.append((row_index, column_index))

    if len(starts) != 1:
        raise ValueError("Map must contain exactly one start point 'S'")

    return starts[0]


def prepare_runtime_map(
    source_map: str | Path,
    randomize_start: bool = True,
) -> tuple[Path, list[list[str]]]:
    source_path = Path(source_map)
    grid = load_map_from_csv(source_path)
    if grid is None:
        raise FileNotFoundError(f"Map file '{source_path}' not found")

    runtime_grid = randomize_start_point(grid) if randomize_start else [row.copy() for row in grid]
    filename_prefix = "runtime" if randomize_start else "upload"
    runtime_filename = f"{filename_prefix}_{source_path.stem}_{random.getrandbits(48):012x}.csv"
    runtime_path = RUNTIME_MAPS_DIR / runtime_filename
    write_map_to_csv(runtime_grid, runtime_path)

    return runtime_path, runtime_grid


def resolve_map_path(map_name: str | Path) -> Path:
    requested = Path(map_name)
    candidates: list[Path] = []

    if requested.is_absolute() or requested.exists():
        candidates.append(requested)

    candidates.append(BACKEND_DIR / requested)
    candidates.append(RUNTIME_MAPS_DIR / requested.name)
    candidates.append(UPLOADS_DIR / requested.name)
    candidates.append(MAPS_DIR / requested.name)
    candidates.append(KONNYU_MAPS_DIR / requested.name)
    candidates.append(NEHEZ_MAPS_DIR / requested.name)

    if requested.name == DEFAULT_MAP_NAME:
        candidates.append(DEFAULT_MAP_PATH)

    seen: set[Path] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        if candidate.exists():
            return candidate

    raise FileNotFoundError(f"Map file '{map_name}' not found")
