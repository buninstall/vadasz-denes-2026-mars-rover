Mars Rover projekt dokumentációja
=================================

1. Csapat adatai
----------------
Csapat neve: Bun Install
Csapattagok neve: Futó Zsombor, Gyulai Gergő, Szűcs Noel
Iskola: Miskolci SZC Kandó Kálmán Informatikai Technikum
Felkészítő tanár: Kasza László Róbert
Email: zsombi.futo@gmail.com

2. Fejlesztői környezet
-----------------------
A projekt két fő részből áll: egy Python alapú backendből és egy React/Vite alapú frontendből.

Backend:
- Python 3.12
- FastAPI 0.129.0
- Uvicorn 0.35.0
- NumPy 2.4.2
- websockets 16.0

Frontend:
- Node.js 18 vagy újabb
- npm
- Vite 7.3.1
- React 19.2.4
- TypeScript 5.6.4
- Tailwind CSS 4.2.0

3. Rövid használati útmutató
----------------------------
1. Indítsátok el a backendet:

   python3 -m venv .venv
   source .venv/bin/activate
   python -m pip install --upgrade pip
   python -m pip install fastapi uvicorn numpy websockets python-multipart matplotlib
   cd backend
   uvicorn main:app --host 0.0.0.0 --port 8000 --reload

2. Indítsátok el a frontendet egy másik terminálban:

   cd frontend
   npm install
   npm run dev

3. Használat:

- A felület a böngészőben a `http://localhost:5173` címen érhető el. (build után(npm run build && npm run start) 'http://localhost:4173/')
- A backend API a `http://127.0.0.1:8000`, a Swagger felület pedig a `http://127.0.0.1:8000/docs` címen nyitható meg.
- Indulás után választható véletlen pálya, fix pálya vagy saját CSV fájl feltöltése.
- Saját pálya esetén a fájlnak 50x50-es CSV-nek kell lennie, és pontosan egy darab `S` kezdőpontot kell tartalmaznia.
- A pályán használható jelek: `.`, `#`, `S`, `B`, `Y`, `G`.
- A szimuláció indításához meg kell adni az időkeretet órában; a minimum érték 24 óra.
- A `Start` gomb elindítja a szimulációt.
- A program megjeleníti a rover útját, az akkumulátor töltöttségét, a nappali és éjszakai ciklusokat, valamint a begyűjtött ásványokat.
- A lefutott szimulációk elmentődnek, később visszatölthetők és törölhetők.

4. Teszt szimuláció és diagramok generálása (opcionális)
-----------------------------------------
A projekthez készült egy speciális script, ami lefuttat egy teljes küldetést és automatikusan elmenti a dokumentációhoz szükséges diagramokat (folyamatábra, hőtérkép, energia-sebesség grafikon, akkumulátor idősor).

Futtatás:
```bash
cd backend
source ../.venv/bin/activate
python generate_simulation_diagrams.py --map mars_map_50x50.csv --hours 150 --collect-all
```

Az eredmények a `backend/simulations/diagram_reports/<időbélyeg>/` mappába kerülnek.

5. Megjegyzés
-------------
Hogyha véletlenül kevés lenne a teszt pálya, vagy még nehezebb pályákat szeretnénk generálni, akkor csak simán futtatni kell egy python scriptet.
cd /mars-rover/backend
source ../.venv/bin/activate
python konnyu_maps/konnyu_map.py
VAGY
python nehez_maps/nehez_map.py
