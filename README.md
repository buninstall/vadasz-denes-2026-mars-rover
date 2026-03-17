# Mars Rover projekt — teljes indítási útmutató

Ez a dokumentáció lépésről lépésre leírja:
- hogyan indítsd el a backendet,
- hogyan futtasd a tréninget,
- hogyan futtasd az inference-t,
- hogyan indítsd a frontendet.

## 1) Előfeltételek

- Python 3.12+
- Node.js 18+
- npm

## 2) Projekt mappa

```bash
cd /Users/futozs/Documents/mars-rover
```

## 3) Python virtual environment + backend csomagok

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install fastapi uvicorn numpy websockets
```

## 4) Backend indítása (FastAPI)

```bash
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Ekkor elérhető:
- API: `http://127.0.0.1:8000`
- Swagger: `http://127.0.0.1:8000/docs`

## 5) Gyors API teszt parancsok

Új terminálban (repo gyökérből):

```bash
source .venv/bin/activate
```

Térkép lekérése:

```bash
curl "http://127.0.0.1:8000/map"
```

Szimuláció indítása:

```bash
curl -X POST "http://127.0.0.1:8000/simulate" \
  -H "Content-Type: application/json" \
  -d '{"map_file":"mars_map_50x50.csv","time_limit_hours":24,"collect_all":true}'
```

Megjegyzés:
- `collect_all=true` (alapértelmezett): a rover addig fut, amíg minden ásványt begyűjt és visszaér a start pontra.
- `collect_all=false`: a szimuláció a megadott órakeretet (`time_limit_hours`) tiszteletben tartja.

## 6) Tréning (modell újratanítása)

```bash
cd /Users/futozs/Documents/mars-rover
source .venv/bin/activate
cd backend
python train.py
```

Kimenet: `backend/rover_model.npy`

## 7) Inference futtatása CLI-ből

```bash
cd /Users/futozs/Documents/mars-rover
source .venv/bin/activate
cd backend
python infer.py --map mars_map_50x50.csv --brain rover_model.npy --hours 24 --json > ../result.json
```

Másik map példával:

```bash
python infer.py --map mars_maps/mars_map_00001.csv --brain rover_model.npy --hours 24 --json
```

Időkeret-korlátos futás (nem teljes begyűjtés):

```bash
python infer.py --map mars_maps/mars_map_00001.csv --hours 24 --respect-time-limit --json
```

## 8) Frontend indítása (dashboard)

```bash
cd /Users/futozs/Documents/mars-rover/frontend
npm install
npm run dev
```

A frontend alapból a `http://localhost:8000` backendhez csatlakozik.

## 9) Gyakori hibák

- Ha `ModuleNotFoundError` jön backend induláskor: futtasd az `uvicorn main:app ...` parancsot a `backend` mappából.
- Ha foglalt a 8000-es port: indítsd másik porton, pl. `--port 8001`, és állítsd át a frontend API URL-t.
- A `time_limit_hours` minimuma 24 óra.