import asyncio
import csv
import os
import random
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
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
    time_limit_hours: int = 24

@app.post("/simulate")
def start_simulation(request: SimulationRequest):
    # Resolve map file path
    if request.map_file == DEFAULT_MAP:
        map_path = request.map_file
    else:
        map_path = os.path.join(MAPS_DIR, request.map_file)
        
    if not os.path.exists(map_path):
        raise HTTPException(status_code=404, detail=f"Map file '{request.map_file}' not found")
        
    brain_file = "rover_model.npy"
    if not os.path.exists(brain_file):
        raise HTTPException(status_code=404, detail=f"Brain file '{brain_file}' not found")
        
    try:
        result = run_inference(map_path, brain_file, request.time_limit_hours)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
