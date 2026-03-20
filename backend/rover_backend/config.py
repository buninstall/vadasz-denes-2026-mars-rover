from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_MAP_NAME = "mars_map_50x50.csv"
DEFAULT_MAP_PATH = BACKEND_DIR / DEFAULT_MAP_NAME
MAPS_DIR = BACKEND_DIR / "mars_maps"
KONNYU_MAPS_DIR = BACKEND_DIR / "konnyu_maps"
NEHEZ_MAPS_DIR = BACKEND_DIR / "nehez_maps"
UPLOADS_DIR = BACKEND_DIR / "uploads"
SIMULATIONS_DIR = BACKEND_DIR / "simulations"
RUNTIME_MAPS_DIR = SIMULATIONS_DIR / "runtime_maps"
MAX_SIMULATION_STEPS = 10_000
MIN_TIME_LIMIT_HOURS = 24
SIMULATIONS_DIR.mkdir(exist_ok=True)
UPLOADS_DIR.mkdir(exist_ok=True)
KONNYU_MAPS_DIR.mkdir(exist_ok=True)
NEHEZ_MAPS_DIR.mkdir(exist_ok=True)
RUNTIME_MAPS_DIR.mkdir(parents=True, exist_ok=True)
