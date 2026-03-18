# Mars Rover

Mars rover simulation for the 2026 Vadász Dénes Informatika Verseny.

This repo has:
- a FastAPI backend for map loading and simulation
- a planner CLI for generating full mission runs
- a Vite + React frontend for the 3D visualization and dashboard

## Requirements

- Python 3.12+
- Node.js 18+
- npm

## Project Layout

```text
mars-rover/
├── backend/
│   ├── main.py          # FastAPI app entrypoint
│   ├── planner_cli.py   # CLI mission runner
│   ├── rover_backend/   # Planner, API, schemas, map helpers
│   ├── map.py           # Map generator
│   ├── mars_map_50x50.csv
│   ├── mars_maps/       # Generated maps
│   └── tests/
└── frontend/
    ├── src/
    └── package.json
```

## Quick Start

Open 2 terminals.

Terminal 1: backend

```bash
cd /Users/gergo/Developer/mars-rover
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install fastapi uvicorn numpy websockets
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Terminal 2: frontend

```bash
cd /Users/gergo/Developer/mars-rover/frontend
npm install
npm run dev
```

Then open:

- Frontend: [http://localhost:5173](http://localhost:5173)
- Backend API: [http://127.0.0.1:8000](http://127.0.0.1:8000)
- Swagger: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

## Backend Setup

From repo root:

```bash
cd /Users/gergo/Developer/mars-rover
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install fastapi uvicorn numpy websockets
```

## Backend Commands

Run backend in dev mode:

```bash
cd /Users/gergo/Developer/mars-rover/backend
source ../.venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Run backend without reload:

```bash
cd /Users/gergo/Developer/mars-rover/backend
source ../.venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000
```

Run mission planner from CLI on the default map:

```bash
cd /Users/gergo/Developer/mars-rover/backend
source ../.venv/bin/activate
python planner_cli.py --map mars_map_50x50.csv --hours 24 --json
```

Save planner output to a file:

```bash
cd /Users/gergo/Developer/mars-rover/backend
source ../.venv/bin/activate
python planner_cli.py --map mars_map_50x50.csv --hours 24 --json > ../result.json
```

Run planner on a generated map:

```bash
cd /Users/gergo/Developer/mars-rover/backend
source ../.venv/bin/activate
python planner_cli.py --map mars_maps/mars_map_00001.csv --hours 24 --json
```

Important:

- `--hours` is required by the task rules to be at least `24`
- the rover starts at sunrise with `100` battery

## API Commands

Get a random map:

```bash
curl "http://127.0.0.1:8000/map"
```

Get the default fixed map:

```bash
curl "http://127.0.0.1:8000/map?random_map=false"
```

Run a simulation on the default map:

```bash
curl -X POST "http://127.0.0.1:8000/simulate" \
  -H "Content-Type: application/json" \
  -d '{"map_file":"mars_map_50x50.csv","time_limit_hours":24,"collect_all":true}'
```

Run a simulation on a generated map:

```bash
curl -X POST "http://127.0.0.1:8000/simulate" \
  -H "Content-Type: application/json" \
  -d '{"map_file":"mars_map_00001.csv","time_limit_hours":24}'
```

## Frontend Setup

```bash
cd /Users/gergo/Developer/mars-rover/frontend
npm install
```

## Frontend Commands

Run frontend in dev mode:

```bash
cd /Users/gergo/Developer/mars-rover/frontend
npm run dev
```

Alternative dev entry:

```bash
cd /Users/gergo/Developer/mars-rover/frontend
npm start
```

Typecheck:

```bash
cd /Users/gergo/Developer/mars-rover/frontend
npm run typecheck
```

Production build:

```bash
cd /Users/gergo/Developer/mars-rover/frontend
npm run build
```

Preview production build:

```bash
cd /Users/gergo/Developer/mars-rover/frontend
npm run preview
```

## Tests and Validation

Run backend tests:

```bash
cd /Users/gergo/Developer/mars-rover
python3 -m unittest discover -s backend/tests
```

Run one full planner smoke test:

```bash
cd /Users/gergo/Developer/mars-rover
source .venv/bin/activate
python3 backend/planner_cli.py --map backend/mars_map_50x50.csv --hours 24 --json > /tmp/mars-rover-run.json
```

Check frontend build:

```bash
cd /Users/gergo/Developer/mars-rover/frontend
npm run build
```

## Optional: Generate More Maps

The generator script creates a large batch of maps in `backend/mars_maps/`.

Run it like this:

```bash
cd /Users/gergo/Developer/mars-rover/backend
source ../.venv/bin/activate
python map.py
```

Note:

- by default `backend/map.py` generates `10000` maps
- that can take a while
- if you want a smaller run, edit `num_maps` near the bottom of `backend/map.py` before running it

## Typical Dev Workflow

1. Start the backend:

```bash
cd /Users/gergo/Developer/mars-rover/backend
source ../.venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

2. Start the frontend:

```bash
cd /Users/gergo/Developer/mars-rover/frontend
npm run dev
```

3. Run checks after changes:

```bash
cd /Users/gergo/Developer/mars-rover
python3 -m unittest discover -s backend/tests
```

```bash
cd /Users/gergo/Developer/mars-rover/frontend
npm run typecheck
```

```bash
cd /Users/gergo/Developer/mars-rover/frontend
npm run build
```

## Troubleshooting

- If backend imports fail, make sure you started `uvicorn main:app ...` from the `backend/` directory.
- If port `8000` is busy, change the backend port, for example `--port 8001`, and update the frontend API base URL in `frontend/src/services/api.ts`.
- If the frontend cannot reach the backend, confirm the backend is running on `http://localhost:8000`.
- If simulation input fails, check that `time_limit_hours >= 24`.
