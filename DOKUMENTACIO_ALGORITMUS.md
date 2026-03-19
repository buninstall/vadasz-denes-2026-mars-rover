# Mars Rover 2026 - Útvonaltervező Algoritmus Dokumentáció

**Csapat:** [Csapatneved]
**Dátum:** 2026. március 19.

## 1. Az algoritmus áttekintése
Projektünkben egy többszempontú optimalizációs modellt alkalmaztunk, amely az A* keresőalgoritmus egy módosított változatára épül. Célunk nem csak a legrövidebb út megtalálása volt, hanem a küldetés teljes időtartama alatt begyűjtött ásványok mennyiségének és a rover túlélési esélyeinek (akkumulátor-kezelés) maximalizálása.

### Főbb szempontok:
- **Dinamikus sebességkezelés:** $v \in \{1, 2, 3\}$ sebességfokozatok használata az energiahatékonyság ($E = 2 \cdot v^2$) és az időkeret függvényében.
- **Klaszter-alapú pontozás:** Az ásványokat nem egyenként, hanem sűrűség és típus (érték) alapján súlyozott klaszterekként kezeli a rendszerünk.
- **Biztonsági tartalék:** Folyamatos kalkuláció a bázisra való visszatéréshez szükséges minimális energiáról.

---

## 2. Pszeudokód

```python
Függvény Küldetés_Szimuláció(Térkép, Időkeret):
    Rover_Pozíció = Kezdőpont
    Akkumulátor = 100
    Összes_Ásvány = Térkép.Ásványok_Listája()

    Amíg Idő < Időkeret ÉS Pozíció != Bázis:
        # 1. Célpont kiválasztása
        Célpont = Legjobb_Klaszter_Keresése(Rover_Pozíció, Akkumulátor, Idő)
        
        # 2. Útvonaltervezés (A*)
        Útvonal = Tervezés_A_Csillag(Rover_Pozíció, Célpont)
        
        # 3. Mozgás végrehajtása sebesség-optimalizálással
        Minden lépés az Útvonalon:
            Ha Éjszaka_Van ÉS Akkumulátor < Biztonsági_Szint:
                Várakozás_Nappalig() (Standby mód)
            Egyébként:
                V választása {1, 2, 3} alapján (Energia vs. Idő)
                Mozgás(V)
                Akkumulátor -= 2 * V^2
                Ha Útpont == Ásvány:
                    Ásvány_Begyűjtése()
        
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