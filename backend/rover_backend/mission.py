from pathlib import Path

from .maps import load_map_from_csv

GRID_SIZE = 50
MAX_BATTERY = 100
K_CONSTANT = 2
DAY_STEPS = 32
NIGHT_STEPS = 16
CYCLE = DAY_STEPS + NIGHT_STEPS
MAX_TARGET_CANDIDATES = 40
CLUSTER_RADIUS = 2


class MarsMission:
    def __init__(self, map_file: str | Path):
        self.obstacles: set[tuple[int, int]] = set()
        self.minerals: dict[tuple[int, int], str] = {}
        self.start_pos: tuple[int, int] | None = None
        self.load_csv(map_file)

    def load_csv(self, map_file: str | Path) -> None:
        grid = load_map_from_csv(map_file)
        if grid is None:
            raise FileNotFoundError(f"Map file '{map_file}' not found")

        if len(grid) != GRID_SIZE or any(len(row) != GRID_SIZE for row in grid):
            raise ValueError(f"Map must be exactly {GRID_SIZE}x{GRID_SIZE}")

        valid_cells = {".", "#", "B", "Y", "G", "S"}
        start_count = 0

        for row_index, row in enumerate(grid):
            for column_index, value in enumerate(row):
                if value not in valid_cells:
                    raise ValueError(f"Invalid cell '{value}' at ({row_index}, {column_index})")

                if value == "#":
                    self.obstacles.add((row_index, column_index))
                elif value in {"B", "Y", "G"}:
                    self.minerals[(row_index, column_index)] = value
                elif value == "S":
                    start_count += 1
                    self.start_pos = (row_index, column_index)

        if start_count != 1 or self.start_pos is None:
            raise ValueError("Map must contain exactly one start point 'S'")
