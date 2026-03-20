# Mars Rover 2026 - Útvonaltervező Algoritmus Dokumentáció

**Csapat:** [Bun install]
**Dátum:** 2026. március 20.

## 1. Az algoritmus áttekintése
Projektünkben egy többszempontú optimalizációs modellt alkalmaztunk, amely az A* keresőalgoritmus egy módosított változatára épül. Célunk nem csak a legrövidebb út megtalálása volt, hanem a küldetés teljes időtartama alatt begyűjtött ásványok mennyiségének és a rover túlélési esélyeinek (akkumulátor-kezelés) maximalizálása.

### Főbb szempontok:
- **Dinamikus sebességkezelés:** $v \in \{1, 2, 3\}$ sebességfokozatok használata az energiahatékonyság ($E = 2 \cdot v^2$) és az időkeret függvényében.
- **Klaszter-alapú pontozás:** Az ásványokat nem egyenként, hanem klaszterjellemzők (sűrűség, klaszterméret, frontier/perem) alapján pontozzuk.
- **Energia- és visszaút-ellenőrzés:** Célpontválasztáskor és mozgáskor a rendszer számol az oda-vissza út várható energiaigényével és az időkorláttal.
- **Fontos pontosítás:** A jelenlegi implementációban a B/Y/G ásványtípusok azonos értékűek a pontozásban (nincs külön típus-súlyozás).

---

## 2. Pszeudokód

```python
Függvény Küldetés_Szimuláció(Térkép, Időkeret):
    Rover_Pozíció = Kezdőpont
    Akkumulátor = 100
    Összes_Ásvány = Térkép.Ásványok_Listája()

    Amíg Idő < Időkeret ÉS (Van_Még_Ásvány() VAGY Pozíció != Bázis):
        # 1. Célpont kiválasztása
        Célpont = Legjobb_Klaszter_Keresése(Rover_Pozíció, Akkumulátor, Idő)
        Ha Célpont nincs:
            Célpont = Bázis
        
        # 2. Útvonaltervezés (A*)
        Útvonal = Tervezés_A_Csillag(Rover_Pozíció, Célpont)
        
        # 3. Mozgás végrehajtása sebesség-optimalizálással
        Minden félórás ciklusban:
            Ha az aktuális pozíción ásvány van ÉS a bányászás biztonságos:
                Akkumulátor = clamp(Akkumulátor - 2 + NappaliTöltés, 0, 100)
                Ásvány_Begyűjtése()
            Egyébként:
                V választása {1, 2, 3} alapján (Energia vs. Idő)
                Ha mozgás nem biztonságos:
                    Standby vagy leállás
                Különben:
                    Mozgás(V)
                    Akkumulátor = clamp(Akkumulátor - 2 * V^2 + NappaliTöltés, 0, 100)
        
        Ha Küldetés_Vége_Közeledik:
            Útvonal = Tervezés_Bázisra(Rover_Pozíció)
```

---

## 3. Javasolt ábrák a PDF-be

A dokumentációt az alábbi vizuális elemekkel javasoljuk kiegészíteni:

1.  **Döntési folyamatábra:** Egy egyszerű diagram, ami megmutatja, hogyan dönt a szoftverünk: *Van elég energia?* -> *Igen* -> *Mehet a 3-as sebesség?* -> *Nem* -> *Várjunk napfelkeltére.*
2.  **Hőtérkép (Heatmap):** Egy ábra, ami szemlélteti, hogyan látja az algoritmusunk a térképet (a sűrű ásványcsoportok forró pontokként jelennek meg, ahová a rover szívesen navigál).
3.  **Energia-Sebesség grafikon:** Egy görbe, ami szemlélteti a négyzetes összefüggést az energiafogyasztás és a sebesség között (szemléltetve, miért kockázatos a folyamatos 3-as sebesség).

---

## 4. Technikai megvalósítás
A fejlesztés során a **Python** nyelvet használtuk, az útvonaltervezéshez **Chebyshev távolságon** alapuló heurisztikát vezettünk be, amely tökéletesen illeszkedik a 8-irányú mozgási lehetőségekhez. A backend **FastAPI** segítségével kommunikál a frontenddel, biztosítva a valós idejű szimuláció láthatóságát.

---

## 5. Ismert korlátok és nyitott kérdések

- **Akkumulátor-értelmezés:** A jelenlegi modell egy akciót akkor enged, ha a félórás ciklus végén az energiaszint nem negatív (nappali töltés beleszámít).
- **Hazatérési edge case:** Bizonyos pályákon az aktív célpont megtartása miatt előfordulhat, hogy a rover időlimitre nem ér vissza a startpontra.
- **Technikai adósság:** A `passable_cells` paraméter jelenleg a cache-kulcsban szerepel, de a tényleges A* keresési tér szűrését nem módosítja.