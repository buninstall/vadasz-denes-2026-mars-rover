import asyncio
import csv
import json
import os
import random
import uuid
from datetime import datetime, timezone
import io
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from infer import run_inference

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
MAPS_DIR = "mars_maps"
DEFAULT_MAP = "mars_map_50x50.csv"
SIMULATIONS_DIR = "simulations"
UPLOADS_DIR = "uploads"

# Ensure simulations dir exists
os.makedirs(SIMULATIONS_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                await connection.close()
                if connection in self.active_connections:
                    self.active_connections.remove(connection)


def load_map_from_csv(file_path: str):
    grid = []
    try:
        with open(file_path, "r") as f:
            reader = csv.reader(f, skipinitialspace=True)
            for row in reader:
                clean_row = [cell.strip() for cell in row if cell.strip()]
                if clean_row:
                    grid.append(clean_row)
        return grid
    except FileNotFoundError:
        return None


@app.get("/map")
def get_map(random_map: bool = True):
    target_file = DEFAULT_MAP

    if random_map:
        if os.path.exists(MAPS_DIR) and os.path.isdir(MAPS_DIR):
            # List all csv files in the directory
            files = [f for f in os.listdir(MAPS_DIR) if f.endswith(".csv")]
            if files:
                target_file = os.path.join(MAPS_DIR, random.choice(files))
            else:
                return {"error": f"No CSV files found in {MAPS_DIR}"}
        else:
            return {"error": f"Directory {MAPS_DIR} not found"}

    grid = load_map_from_csv(target_file)

    if grid is None:
        return {"error": f"Map file '{target_file}' not found"}

    return {
        "filename": os.path.basename(target_file),
        "width": len(grid[0]) if grid else 0,
        "height": len(grid),
        "data": grid,
    }

class SimulationRequest(BaseModel):
    map_file: str
    time_limit_hours: int = Field(default=24, ge=24)
    collect_all: bool = False

@app.post("/upload-map")
async def upload_map(file: UploadFile = File(...)):
    content = await file.read()
    try:
        content_str = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Invalid file encoding. Must be UTF-8.")
    
    grid = []
    reader = csv.reader(io.StringIO(content_str), skipinitialspace=True)
    for row in reader:
        clean_row = [cell.strip() for cell in row if cell.strip()]
        if clean_row:
            grid.append(clean_row)

    if len(grid) != 50 or any(len(row) != 50 for row in grid):
        raise HTTPException(status_code=400, detail="Map must be exactly 50x50.")

    s_count = sum(row.count("S") for row in grid)
    if s_count != 1:
        raise HTTPException(status_code=400, detail="Map must contain exactly one starting position 'S'.")

    # save file
    file_id = f"custom_{uuid.uuid4().hex}.csv"
    file_path = os.path.join(UPLOADS_DIR, file_id)
    with open(file_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerows(grid)

    return {
        "filename": file_id,
        "width": len(grid[0]) if grid else 0,
        "height": len(grid),
        "data": grid
    }

@app.post("/simulate")
def start_simulation(request: SimulationRequest):
    # Resolve map file path
    if request.map_file == DEFAULT_MAP:
        map_path = request.map_file
    else:
        map_path = os.path.join(MAPS_DIR, request.map_file)
        if not os.path.exists(map_path):
            map_path = os.path.join(UPLOADS_DIR, request.map_file)
        
    if not os.path.exists(map_path):
        raise HTTPException(status_code=404, detail=f"Map file '{request.map_file}' not found")
        
    try:
        result = run_inference(
            map_path,
            None,
            request.time_limit_hours,
            request.collect_all,
        )

        # Auto-save simulation
        sim_id = uuid.uuid4().hex
        grid = load_map_from_csv(map_path)
        sim_record = {
            "id": sim_id,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "hours": request.time_limit_hours,
            "mapFile": request.map_file,
            "mapGrid": grid,
            "result": result,
        }
        sim_path = os.path.join(SIMULATIONS_DIR, f"{sim_id}.json")
        with open(sim_path, "w") as f:
            json.dump(sim_record, f)

        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Simulation CRUD endpoints ──

@app.get("/simulations")
def list_simulations():
    """List all saved simulations (metadata only, no full result)."""
    sims = []
    if not os.path.isdir(SIMULATIONS_DIR):
        return sims
    for fname in sorted(os.listdir(SIMULATIONS_DIR), reverse=True):
        if not fname.endswith(".json"):
            continue
        fpath = os.path.join(SIMULATIONS_DIR, fname)
        try:
            with open(fpath, "r") as f:
                data = json.load(f)
            sims.append({
                "id": data.get("id", fname.replace(".json", "")),
                "createdAt": data.get("createdAt", ""),
                "hours": data.get("hours", 24),
                "mapFile": data.get("mapFile", ""),
                "stepsUsed": data.get("result", {}).get("steps_used", 0),
                "success": data.get("result", {}).get("success", False),
                "mineralsCollected": len(data.get("result", {}).get("minerals", [])),
                "totalMinerals": data.get("result", {}).get("total_minerals", 0),
            })
        except Exception:
            continue
    return sims


@app.get("/simulations/{sim_id}")
def get_simulation(sim_id: str):
    """Get a specific saved simulation (full data including mapGrid and result)."""
    fpath = os.path.join(SIMULATIONS_DIR, f"{sim_id}.json")
    if not os.path.exists(fpath):
        raise HTTPException(status_code=404, detail="Simulation not found")
    with open(fpath, "r") as f:
        return json.load(f)


@app.delete("/simulations/{sim_id}")
def delete_simulation(sim_id: str):
    """Delete a specific saved simulation."""
    fpath = os.path.join(SIMULATIONS_DIR, f"{sim_id}.json")
    if not os.path.exists(fpath):
        raise HTTPException(status_code=404, detail="Simulation not found")
    os.remove(fpath)
    return {"status": "deleted", "id": sim_id}


@app.delete("/simulations")
def clear_simulations():
    """Delete all saved simulations."""
    count = 0
    if os.path.isdir(SIMULATIONS_DIR):
        for fname in os.listdir(SIMULATIONS_DIR):
            if fname.endswith(".json"):
                os.remove(os.path.join(SIMULATIONS_DIR, fname))
                count += 1
    return {"status": "cleared", "deleted": count}
