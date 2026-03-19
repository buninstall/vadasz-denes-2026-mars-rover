set shell := ["bash", "-cu"]

# Run FastAPI backend in reload mode.
backend:
    cd backend && .venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Run Vite frontend dev server.
frontend:
    cd frontend && npm run dev

# Run backend and frontend together in one terminal.
dev:
    (cd backend && .venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload) & \
    (cd frontend && npm run dev) & \
    wait
