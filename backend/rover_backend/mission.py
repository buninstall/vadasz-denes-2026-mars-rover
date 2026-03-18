import csv
from pathlib import Path

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
        self.start_pos = (0, 0)
        self.load_csv(map_file)

    def load_csv(self, map_file: str | Path) -> None:
        with Path(map_file).open("r") as handle:
            content = handle.read()
            delimiter = ";" if ";" in content else ","
            handle.seek(0)
            reader = csv.reader(handle, delimiter=delimiter)

            for row_index, row in enumerate(reader):
                for column_index, cell in enumerate(row):
                    if cell == "#":
                        self.obstacles.add((row_index, column_index))
                    elif cell in {"B", "Y", "G"}:
                        self.minerals[(row_index, column_index)] = cell
                    elif cell == "S":
                        self.start_pos = (row_index, column_index)
