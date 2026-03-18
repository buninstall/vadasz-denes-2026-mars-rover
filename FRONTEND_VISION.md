# Mars Rover Szimuláció - Frontend Fejlesztési Terv (TOP 20 Ötlet)

Ez a lista a "Mars Rover Útvonaltervező" szimulációjának világelszintűre emeléséhez készült. A cél nem egy egyszerű vizualizáció, hanem egy magával ragadó, mérnöki pontosságú, mégis játékosan reszponzív "Mission Control" élmény létrehozása.

## 1. Dinamikus Telemetria és "Ghosting"
A rover jelenlegi pozíciója mellett halványan (vagy szaggatott vonallal) látszódjon a **szimulált terv**. Amikor a rover mozog, lássuk, hogy az algoritmus épp melyik "ágon" gondolkodik, és mi az eredeti terve vs. a valóság.

## 2. Nappal/Éjszaka Világítási Ciklus
A 3D-s színtér (Scene) dinamikusan kövesse a szimuláció óráját. Éjszaka a rover kapcsolja fel a fényszóróit (SpotLight), nappal pedig a nap dőlésszöge változzon. Ez dramatikus vizuális visszajelzést ad az akkumulátor töltési állapotáról.

## 3. "Energy-Heatmap" Overlay
Egy gombbal bekapcsolható réteg a térképen, ami megmutatja, hol a legköltségesebb a mozgás (nehéz terep, nagy távolság a bázistól). Minél pirosabb egy terület, annál nagyobb a kockázata, hogy onnan nem ér vissza a rover.

## 4. Szenzor-adat Vizualizáció (LIDAR Scan)
Mozgás közben a rover "pásztázza" a környezetét. Egy kör alakú effekt (shader) fusson körbe a rover körül, ami mutatja a látótávolságát, mintha valós időben térképezné fel a környező ásványokat.

## 5. Operatív HUD (Head-Up Display)
Ne csak statikus panelek legyenek. A Dashboard kapjon egy "sci-fi" keretet, ahol az adatok (akku, sebesség, koordináták) kis animációkkal, analóg-stílusú mutatókkal ugrálnak, mint egy vadászgép pilótafülkéjében.

## 6. Interaktív Eseménynapló (Log Timeline)
A LogViewer ne csak egy lista legyen, hanem egy görgethető idővonal. Ha rákattintunk egy eseményre (pl. "Bányászat elkezdve"), a kamera ugorjon oda a roverre az adott időpillanatban.

## 7. Ásvány-Klaszter Vizualizáció
Az algoritmus által azonosított ásvány-csoportokat (klasztereket) halvány színű burkológörbékkel (convex hull) jelezzük a térképen. Így láthatóvá válik, miért döntött úgy a rover, hogy "abba az irányba" indul el.

## 8. "Risk Factor" Kijelző
Egy valós idejű mutató, ami jelzi a küldetés aktuális kockázatát. Ha az akku 20% alatt van és a rover messze van a bázistól, a képernyő szélei kezdjenek el vörösen villogni (Glitch effekt), jelezve a veszélyt.

## 9. Dinamikus Kamera Módok
- **Follow Cam:** Szorosan követi a rovert.
- **Drone Cam:** Felülről, stabilan nézi a területet.
- **Mission Lead Cam:** Mindig a rover és a következő célpont közötti vonalat próbálja mutatni.
- **Cinematic Start:** Indításkor egy körberepülés a bázis körül.

## 10. Fizikai Részecske-effektek
A kerekek alól verődjön fel marsi por (parallaxis vagy részecskerendszer), bányászat közben pedig legyenek szikrák vagy törmelék-effekt. Ez adja meg a "súlyát" a gépnek.

## 11. Bázis "Homing" Jelző
Egy folyamatos lézersugár vagy jelzőfény (Beacon), ami a bázisról az ég felé mutat. Ez segít a tájékozódásban, és vizuálisan is rögzíti a "biztonságos pontot".

## 12. "Action Cards" - Döntési Kártyák
Amikor a rover új célt választ, egy kis kártya ugorjon fel a HUD-on: "Új célpont: Klaszter #4, Várható nyereség: 5 ásvány, Kockázat: Alacsony".

## 13. Weather & Dust Devils
Néha (véletlenszerűen vagy adatok alapján) vonuljanak át porördögök a pályán. Ezek vizuálisan zavarják a kamerát, és jelezhetik a napelemek hatékonyságának csökkenését.

## 14. Akusztikus Visszajelzés (Audio-UI)
Nem zene kell, hanem környezeti zajok: a motor halk zümmögése, a bányászfúró fémes hangja, és "UI-ping" hangok, amikor új esemény történik a logban.

## 15. "Photo Mode" / Szemle
Lehetőség a szimuláció megállítására és szabad kamerás bejárásra, ahol a felfedezett ásványokat (amiket már kibányászott) kis "műtárgyakként" lehet megnézni.

## 16. Multi-Map Összehasonlító
Egy nézet, ahol egymás mellett (vagy gyorsan váltogatva) látszanak a korábbi futamok útvonalai ("Ghost trails"). Így látszik, hogy az algoritmus frissítése után mennyivel hatékonyabb lett az útvonaltervezés.

## 17. Rover "Health" és Állapotjelző
Vizuális sérülés-modell vagy "kopás" jelzése. Ha sokat megy nagy sebességgel, a rover textúrája legyen porosabb/koszosabb a szimuláció végére.

## 18. Stratégiai "Minimap" Kibővítés
A minimapon ne csak pontok legyenek, hanem az algoritmus által tervezett teljes útvonal (Path) is látszódjon végig, különböző színekkel jelölve a sebességet (zöld=gyors, sárga=átlagos).

## 19. "Post-Mission" Report Card
A szimuláció végén egy látványos, exportálható infografika: "Összes megtett út", "Átlagos energiahatékonyság", "Legveszélyesebb pillanat", "Legjövedelmezőbb környék".

## 20. Valós Idejű "Code-View" Pip
Egy kis ablak a sarokban (opcionális), ahol látszódik a backend-től érkező JSON stream vagy a futó pszeudokód aktuális sora. Ez bizonyítja a szimuláció hitelességét (hogy nem csak egy animáció, hanem valódi számítás).
