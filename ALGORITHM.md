# Mars Rover Útvonaltervező és Küldetésvezérlő Algoritmus

## 1. Architekturális Áttekintés

A backend rendszer két elkülöníthető megközelítést tartalmaz, amelyek közül az éles működésben egy **hibrid, heurisztika-vezérelt ágens-alapú szimulációs optimalizáló** dolgozik. 

Noha a forráskódban megtalálható egy `q_table` alapú Megerősítéses Tanulás (Reinforcement Learning - RL) implementáció (`train.py`), az éles inferencia modul (`infer.py` és az `ai.py` magja) a gyakorlatban ezt a korábbi modellezést felülbírálva egy robusztus, előretekintő **A* (A-Star) alapú gráfelméleti keresőt** és egy **erőforrás-tudatos állapottér-szimulációt** használ.

Az algoritmus félórás "lépték-alapú" (step-based) ciklusokban futtatja a küldetést. Célja, hogy a rover úgy maximalizálja a kinyert ásványok számát, hogy közben szigorúan betartja az energetikai (akkumulátor) és az időkeret (műszak hossza, nappali/éjszakai ciklusok) korlátait, majd garantáltan visszatérjen a bázisra.

## 2. Az Algoritmus Működési Logikája

A döntéshozatali mag a következő három fő alrendszerre támaszkodik:

### 2.1. Dinamikus Hálózat és A* Útvonalkeresés
A térkép egy 50x50-es grid ként van ábrázolva. Az A* (A-Star) algoritmus egy Csebisev-távolságra (Chebyshev) épülő heurisztikával keresi a legrövidebb utat, 8 irányú mozgást engedélyezve.
Kritikus működési sajátosság, hogy a **még be nem bányászott ásványokat az algoritmus ideiglenes akadályként kezeli**. Ahogy a rover bányászik, a hálózat dinamikusan frissül, így olyan új (rövidebb) útvonalak és korridorok nyílhatnak meg, amelyek korábban blokkolva voltak.

### 2.2. Priorizált Célpont-kiválasztás (Target Selection)
A célpontok (ásványok) közötti választás nem tisztán a távolságon alapul. Az algoritmus klaszterezési metódust (`_cluster_maps`) használ az ásványok sűrűségének és csomópontjainak felderítésére:
* **Sűrűség és Perem (Frontier) elemzés:** Az algoritmus előnyben részesíti azokat az ásványokat, melyek más nyersanyagokhoz közel helyezkednek el, illetve a "peremen" vannak, megelőzve ezzel, hogy a rover zsákutcába manőverezze magát.
* **Fókusz és Kontinuitás:** Ha a rover egy ásványokkal teli lokális klaszterben van, a heurisztika bónusz pontszámmal (continuation bonus) díjazza a helyben maradást a klaszter kimerítéséig, a felesleges ingázások elkerülése végett.

### 2.3. Szimulációs Előretekintés (Feasibility Check)
A célpont kiválasztása előtt a rendszer "lefejti" az adott útvonal teljes életciklusát, egy lokális beépített szimuláción keresztül (`_evaluate_candidate`):
1. **Odaút:** Milyen sebességgel (1-3 blokk/lépés), mennyi idő alatt és mennyi energia (K konstans alapú fogyasztás) árán érhető el.
2. **Kitettség:** Vizsgálja a nappali (töltési időszak) és éjszakai szakaszokat.
3. **Bányászat:** Belekalkulálja a bányászat idő-, és extra energiaköltségét (2 egység).
4. **Biztonságos hazaút:** Azonnali útvonaltervezés a bányászat helyszínétől a bázisig.
Csak olyan célpont válhat aktívvá, amelynél **a rover a teljes folyamatot (Oda + Kitermelés + Visszaút) garantáltan túléli**, és visszaér az időkereten belül.

### 2.4. Adaptív Sebességszabályzó és Túltöltési Logika
Az `pick_route_speed` modul dinamikusan választ az elérhető sebességek közül. Célja, hogy a rover a lehető leggyorsabban mozogjon anélkül, hogy az az akku végzetes kimerüléséhez vagy a hazaút ellehetetlenüléséhez vezetne. 
Ha a dinamikus mozgásmátrix azt adja ki, hogy a mozgás túl kockázatos, de még nappal van (és a grid lehetővé teszi), a rover taktikusan leáll pihenni (Standby), amíg az akkumulátor kritikus szint fölé nem töltődik (+10 töltés lépésenként).

---

## 3. Az Algoritmus Pszeudokódja

```text
FÜGGVÉNY mission_inference(térkép, hátralévő_idő_lépésekben):
    állapot.pozíció = BA_START_POZICIÓ
    állapot.akku = 100.0
    állapot.aktív_célpont = NULL
    
    CIKLUS AMÍG (állapot.lépés_szám < hátralévő_idő_lépésekben):
        
        // 1. Célpont keresése (ha nincs aktív vagy már kitermeltük)
        HA állapot.aktív_célpont ÜRES:
            kandidátusok = klaszter_és_perem_elemzés(jelenlegi_ásványok)
            
            legjobb_pontszám = 0
            MINDEN ásvány IN kandidátusok:
                
                szimuláció_eredmény = szimulál_odaút_bányászat_és_hazaút(állapot.pozíció, ásvány, állapot.akku)
                
                HA szimuláció_eredmény.túlélhető ÉS szimuláció_eredmény.időn_belüli:
                    pont = számol_heurisztika(távolság, klaszter_sűrűség, perem_érték)
                    HA pont > legjobb_pontszám:
                        állapot.aktív_célpont = ásvány
                        legjobb_pontszám = pont
        
        // 2. Ha nincs lehetséges biztonságos célpont, a Bázis a cél
        HA állapot.aktív_célpont ÜRES:
            HA állapot.pozíció == BA_START_POZICIÓ:
                KILÉPÉS -> "Küldetés Befejezve"
            EGYÉBKÉNT:
                állapot.aktív_célpont = BA_START_POZICIÓ
        
        // 3. Mozgási vektor és sebesség kalkulálása
        útvonal = A_STAR_KERESÉS(állapot.pozíció, állapot.aktív_célpont)
        lehetséges_sebesség = számol_maximális_biztonságos_sebesség(útvonal, állapot.akku)
        
        // 4. Energetikai és Cselekvési Állapottér Végrehajtás
        HA lehetséges_sebesség == 0:
            HA NAPPAL_VAN() ÉS állapot.akku < 100:
                // Standby és Töltés
                állapot.akku += NAPPALI_TÖLTÉSI_RÁTA - KÉSZENLÉTI_FOGYASZTÁS
                állapot.lépés_szám += 1
                UGRÁS A CIKLUS ELEJÉRE
            EGYÉBKÉNT:
                // Éjszaka van és mozgásképtelen
                KILÉPÉS -> "Küldetés Sikertelen (Elakadás)"
                
        // 5. Mozgás végrehajtása
        állapot.pozíció = útvonal[lehetséges_sebesség]
        állapot.akku -= mozgás_fogyasztás(lehetséges_sebesség)
        állapot.akku += aktuális_napszak_töltése()
        állapot.lépés_szám += 1
        
        HA állapot.akku <= 0: KILÉPÉS -> "Küldetés Sikertelen (Akkumulátor kimerült)"
        
        // 6. Bányászat ellenőrzése
        HA állapot.pozíció == állapot.aktív_célpont ÉS állapot.pozíció IN jelenlegi_ásványok:
            állapot.akku -= bányászat_fogyasztás
            állapot.akku += aktuális_napszak_töltése()
            töröl_ásványt_a_térképről(állapot.pozíció)
            állapot.aktív_célpont = NULL
            állapot.lépés_szám += 1
```

---

## 4. Javasolt Vizuális Reprezentációk (PDF-be történő szerkesztéshez)

A PDF végleges formázásához az alábbi három folyamatábra (UML / Flowchart forma) megszerkesztése javasolt, ami letisztult mérnöki dizájnt ad a szoftver dokumentációjának.

### Ábra 1: Magasszintű Rendszervezérlési Folyamatábra (Main Loop)
**Formátum:** Letisztult fentről-lefele áramló döntési fa.
* **Kezdőpont:** `[START] System Init (Map, Params)`
* **Folyamat:** Elágazás egy Rombuszból: `Van aktív Célpont?`
  * *NEM:* Meghívja az `Ágens Célkereső (Target Selection) modult`.
* **Döntés:** Középen rombusz: `Lehetséges biztonságos mozgás (Speed > 0)?`
  * *NEM ág:* Visszacsatolódik egy ellenőrzéshez: `Nappal van?`. Ha igen -> Töltési fázis várakozással (Loopback). Ha nem -> `[Mission Failed: No Energy]` állapot.
  * *IGEN ág:* Nyíl lefele a `Mozgás Végrehajtása` blokkra.
* **Folyamat vég:** Rombusz vizsgálja: `Célponton vagyunk?`. Ha bázis -> Sikeres vége. Ha ásvány -> Bányász mód, majd Loopback a Start alá.

### Ábra 2: Célpont-értékelő és Szimulációs Folyamat (Feasibility Check Sub-Routine)
**Formátum:** Szekvenciadiagram vagy vízszintes blokk-diagram, input/output jelekkel.
* **Input Blokk:** Térkép állapot, Jelenlegi pozíció, Akku szint.
* **Folyamat 1:** `A* Klaszterezés és Frontier detektálás (Nyersanyag topológia)`
* **Adatfolyam:** "Kandidátus lista" (n=40 max) átmegy egy filteren.
* **Iterátor blokk:** Egy belső visszacsatolt ciklus, mely szimulálja a `Virtual Forward Pass` állapotot (A* menetideje, várható napszak töltése, akku profil).
* **Biztonsági Gate:** Döntési kapu `E_return >= Safety Margin`.
* **Output Blokk:** Rangsorolt lista és kiválasztott koordináta közzététele. 

### Ábra 3: Dinamikus Akadálytérkép és A* Útvonaltervezés Mechanikája
**Formátum:** Két állapotos térkép-illusztráció (Before/After) rétegzési magyarázattal.
* **Mátrix vizualizálása:** A perem/fal (#) rögzített akadályok fekete blokként való ábrázolása, a kitermelésre váró ásványok piros (ideiglenes akadály) blokként való jelölése. 
* **Mellé rakni a következményét nyíllal:** "Miután az adott pontot lebányássza a rover, az ásvány-akadály blokk törlődik a memóriából, így a következő A* már rövidebb utat képes generálni a frissen átszámolni az újonnan nyílt folyosón (Corridor) mentén."