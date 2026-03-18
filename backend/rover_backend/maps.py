import csv
import random
from pathlib import Path

from .config import BACKEND_DIR, DEFAULT_MAP_NAME, DEFAULT_MAP_PATH, MAPS_DIR


def load_map_from_csv(file_path: str | Path) -> list[list[str]] | None:
    grid: list[list[str]] = []

    try:
        with Path(file_path).open("r") as handle:
            reader = csv.reader(handle, skipinitialspace=True)
            for row in reader:
                clean_row = [cell.strip() for cell in row if cell.strip()]
                if clean_row:
                    grid.append(clean_row)
    except FileNotFoundError:
        return None

    return grid


def list_generated_maps() -> list[Path]:
    if not MAPS_DIR.is_dir():
        return []

    return sorted(path for path in MAPS_DIR.iterdir() if path.suffix == ".csv")


def pick_map_path(random_map: bool = True) -> Path:
    if not random_map:
        return DEFAULT_MAP_PATH

    available_maps = list_generated_maps()
    if not available_maps:
        raise FileNotFoundError(f"No CSV files found in {MAPS_DIR}")

    return random.choice(available_maps)


def resolve_map_path(map_name: str | Path) -> Path:
    requested = Path(map_name)
    candidates: list[Path] = []

    if requested.is_absolute() or requested.exists():
        candidates.append(requested)

    if requested.name == DEFAULT_MAP_NAME:
        candidates.append(DEFAULT_MAP_PATH)

    candidates.append(BACKEND_DIR / requested)
    candidates.append(MAPS_DIR / requested.name)

    seen: set[Path] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        if candidate.exists():
            return candidate

    raise FileNotFoundError(f"Map file '{map_name}' not found")
