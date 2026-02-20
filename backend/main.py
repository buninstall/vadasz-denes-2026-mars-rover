import asyncio
import csv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
        connection.close()
        self.active_connections.remove(connection)
        pass

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
def get_map():
  grid = load_map_from_csv("mars_map_50x50.csv")

  if grid is None:
    return {"error": "Map file not found"}

  return {"width": len(grid[0]) if grid else 0, "height": len(grid), "data": grid}