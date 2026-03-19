import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

from .config import SIMULATIONS_DIR, UPLOADS_DIR
from .maps import load_map_from_csv, pick_map_path, resolve_map_path
from .schemas import SimulationRequest
from .simulation import run_simulation

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _simulation_path(sim_id: str) -> Path:
    return SIMULATIONS_DIR / f"{sim_id}.json"


def _load_simulation_record(file_path: Path) -> dict | None:
    try:
        with file_path.open("r") as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None


@app.get("/map")
def get_map(random_map: bool = True):
    try:
        target_file = pick_map_path(random_map=random_map)
    except FileNotFoundError as exc:
        # Fallback to default map if no random maps found
        from .config import DEFAULT_MAP_PATH
        target_file = DEFAULT_MAP_PATH
        if not target_file.exists():
             return {"error": str(exc)}

    grid = load_map_from_csv(target_file)
    if grid is None:
        return {"error": f"Map file '{target_file.name}' not found"}

    return {
        "filename": target_file.name,
        "width": len(grid[0]) if grid else 0,
        "height": len(grid),
        "data": grid,
    }


@app.post("/upload-map")
async def upload_map(file: UploadFile = File(...)):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are allowed")

    target_path = UPLOADS_DIR / file.filename
    try:
        content = await file.read()
        with target_path.open("wb") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not save file: {str(e)}")

    grid = load_map_from_csv(target_path)
    if grid is None:
        raise HTTPException(status_code=400, detail="Invalid map file")

    # Basic validation
    starts = sum(row.count("S") for row in grid)
    if starts != 1:
        target_path.unlink()  # Delete invalid map
        raise HTTPException(status_code=400, detail="Map must have exactly one start point 'S'")

    return {
        "filename": file.filename,
        "width": len(grid[0]) if grid else 0,
        "height": len(grid),
        "data": grid,
    }


@app.post("/simulate")
def start_simulation(request: SimulationRequest):
    try:
        map_path = resolve_map_path(request.map_file)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        result = run_simulation(map_path, request.time_limit_hours)
    except Exception as exc:  # pragma: no cover - surfaced as HTTP errors
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    sim_id = uuid.uuid4().hex
    sim_record = {
        "id": sim_id,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "hours": request.time_limit_hours,
        "mapFile": request.map_file,
        "mapGrid": load_map_from_csv(map_path),
        "result": result,
    }
    with _simulation_path(sim_id).open("w") as handle:
        json.dump(sim_record, handle)

    return result


@app.get("/simulations")
def list_simulations():
    records = []
    for file_path in SIMULATIONS_DIR.glob("*.json"):
        data = _load_simulation_record(file_path)
        if data is None:
            continue
        records.append(
            {
                "id": data.get("id", file_path.stem),
                "createdAt": data.get("createdAt", ""),
                "hours": data.get("hours", 24),
                "mapFile": data.get("mapFile", ""),
                "stepsUsed": data.get("result", {}).get("steps_used", 0),
                "success": data.get("result", {}).get("success", False),
                "mineralsCollected": len(data.get("result", {}).get("minerals", [])),
                "totalMinerals": data.get("result", {}).get("total_minerals", 0),
            }
        )

    return sorted(records, key=lambda record: record["createdAt"], reverse=True)


@app.get("/simulations/{sim_id}")
def get_simulation(sim_id: str):
    record = _load_simulation_record(_simulation_path(sim_id))
    if record is None:
        raise HTTPException(status_code=404, detail="Simulation not found")
    return record


@app.delete("/simulations/{sim_id}")
def delete_simulation(sim_id: str):
    file_path = _simulation_path(sim_id)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Simulation not found")
    file_path.unlink()
    return {"status": "deleted", "id": sim_id}


@app.delete("/simulations")
def clear_simulations():
    deleted = 0
    for file_path in SIMULATIONS_DIR.glob("*.json"):
        file_path.unlink()
        deleted += 1
    return {"status": "cleared", "deleted": deleted}
