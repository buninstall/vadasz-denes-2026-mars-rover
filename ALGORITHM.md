# A szimuláció algoritmusa

## A működés lényege

1. A program betölti és ellenőrzi a pályát.
   A pálya 50x50 mezős rács, ahol az `S` a kezdőpont, a `#` az akadály, a `B`, `Y`, `G` pedig a begyűjthető ásványok.

2. A rover minden lépésben megkeresi a következő célpontot.
   A választásnál nemcsak a távolság számít, hanem az is, hogy az adott ásvány mennyire van jó helyen egy csoporton belül, és mennyire éri meg arra indulni.

3. Az útvonaltervezés A* algoritmussal történik.
   A rover mindig egy járható útvonalat keres a kiválasztott célhoz, majd szükség esetén újratervez, ha a pálya állapota megváltozik.

4. A program előre ellenőrzi, hogy a célpont biztonságosan teljesíthető-e.
   Mielőtt a rover elindulna, a rendszer megbecsüli, hogy elegendő lesz-e az energia az odajutáshoz, a bányászáshoz és a hazatéréshez is.

5. Ha a célpont nem biztonságos, a rover másik célpontot választ, vagy visszatér a bázisra.
   Ha nappal van és szükséges, várakozással töltődik. Ha már nincs értelmes következő lépés, a szimuláció leáll.

## Energia- és időkezelés

- Egy lépés 0,5 órának felel meg.
- A nappali szakaszban a rover töltődik, éjszaka nem.
- A mozgás, a várakozás és a bányászás mind fogyaszt energiát.
- A rover egy félórás lépésben 1-3 mezőt haladhat (választott sebességtől függően), az energiafogyasztás pedig $E = 2 \cdot v^2$ szerint számolódik.

## Összefoglalás

A szimuláció egy biztonságtudatos útvonaltervező és döntési rendszert használ. A fő szempontjai:

- elérhető legyen a célpont
- maradjon elég energia a műveletekhez
- a rover szükség esetén vissza tudjon térni a bázisra

Ennek köszönhetően a rover nem egyszerűen a legközelebbi ásványt választja, hanem a teljes küldetés szempontjából próbál jó döntést hozni.
