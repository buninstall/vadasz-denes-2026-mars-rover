import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

from .config import DEFAULT_MAP_PATH, SIMULATIONS_DIR, UPLOADS_DIR
from .mission import GRID_SIZE
from .maps import find_start_point, load_map_from_csv, pick_map_path, prepare_runtime_map, resolve_map_path
from .schemas import SimulationRequest, UpdateStepRequest
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
def get_map(random_map: bool = True, complexity: str = "uncomplicated"):
    try:
        source_file = pick_map_path(random_map=random_map, complexity=complexity)
    except FileNotFoundError as exc:
        source_file = DEFAULT_MAP_PATH
        if not source_file.exists():
            return {"error": str(exc)}

    try:
        runtime_map_file, runtime_grid = prepare_runtime_map(source_file)
    except (FileNotFoundError, ValueError) as exc:
        return {"error": str(exc)}

    try:
        start_row, start_column = find_start_point(runtime_grid)
    except ValueError as exc:
        return {"error": str(exc)}

    return {
        "filename": runtime_map_file.name,
        "source_filename": source_file.name,
        "start": [start_row, start_column],
        "width": len(runtime_grid[0]) if runtime_grid else 0,
        "height": len(runtime_grid),
        "data": runtime_grid,
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

    if len(grid) != GRID_SIZE or any(len(row) != GRID_SIZE for row in grid):
        target_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail=f"Map must be exactly {GRID_SIZE}x{GRID_SIZE}",
        )

    valid_cells = {".", "#", "B", "Y", "G", "S"}
    invalid_cells = [
        cell
        for row in grid
        for cell in row
        if cell not in valid_cells
    ]
    if invalid_cells:
        target_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail="Map contains invalid symbols. Allowed: ., #, B, Y, G, S",
        )

    # Basic validation
    starts = sum(row.count("S") for row in grid)
    if starts != 1:
        target_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Map must have exactly one start point 'S'")

    try:
        runtime_map_file, runtime_grid = prepare_runtime_map(
            target_path,
            randomize_start=False,
        )
    except (FileNotFoundError, ValueError) as exc:
        target_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        start_row, start_column = find_start_point(runtime_grid)
    except ValueError as exc:
        target_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "filename": runtime_map_file.name,
        "source_filename": file.filename,
        "start": [start_row, start_column],
        "width": len(runtime_grid[0]) if runtime_grid else 0,
        "height": len(runtime_grid),
        "data": runtime_grid,
    }


@app.post("/simulate")
def start_simulation(request: SimulationRequest):
    try:
        map_path = resolve_map_path(request.map_file)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        result = run_simulation(
            map_path,
            request.time_limit_hours,
            collect_all=request.collect_all,
        )
    except Exception as exc:  # pragma: no cover - surfaced as HTTP errors
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    sim_id = uuid.uuid4().hex
    result["sim_id"] = sim_id
    sim_record = {
        "id": sim_id,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "hours": request.time_limit_hours,
        "mapFile": request.map_file,
        "mapGrid": load_map_from_csv(map_path),
        "savedStep": 0,
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
                "savedStep": data.get("savedStep", 0),
            }
        )

    return sorted(records, key=lambda record: record["createdAt"], reverse=True)


@app.get("/simulations/{sim_id}")
def get_simulation(sim_id: str):
    record = _load_simulation_record(_simulation_path(sim_id))
    if record is None:
        raise HTTPException(status_code=404, detail="Simulation not found")
    return record


@app.patch("/simulations/{sim_id}/step")
def update_simulation_step(sim_id: str, request: UpdateStepRequest):
    file_path = _simulation_path(sim_id)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Simulation not found")
    
    with file_path.open("r") as f:
        data = json.load(f)
        
    data["savedStep"] = request.currentStep
    
    with file_path.open("w") as f:
        json.dump(data, f)
        
    return {"status": "ok", "savedStep": request.currentStep}


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
