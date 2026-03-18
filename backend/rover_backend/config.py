from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_MAP_NAME = "mars_map_50x50.csv"
DEFAULT_MAP_PATH = BACKEND_DIR / DEFAULT_MAP_NAME
MAPS_DIR = BACKEND_DIR / "mars_maps"
SIMULATIONS_DIR = BACKEND_DIR / "simulations"

MAX_SIMULATION_STEPS = 10_000
MIN_TIME_LIMIT_HOURS = 24

SIMULATIONS_DIR.mkdir(exist_ok=True)
