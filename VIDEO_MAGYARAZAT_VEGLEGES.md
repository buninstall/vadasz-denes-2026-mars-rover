# Projekt Bemutató Narráció (Mars Rover 2026)

## 1. A* algoritmus elmagyarázása
Ebben a projektben egy olyan útvonaltervezőt alkottunk meg, amely a biztonság és a hatékonyság egyensúlyát tartja szem előtt. A szoftver nem egyszerűen a legközelebbi ásványt veszi célba, hanem klaszter-alapú pontozási rendszert használ. A rendszer a környező ásványok sűrűségét, klaszterméretét, a peremhelyzetet (frontier), (A rover nem csak a legközelebbi pontot nézi (ez a "greedy" vagy mohó algoritmus lenne, ami gyakran rossz döntést hoz), hanem egy pontozási rendszert használ) valamint az oda-vissza út energia- és időigényét együtt értékeli.

## 2. Miért "hagy ki" ásványokat a rover?
A videón látható, hogy a rover néha elhalad ásványok mellett anélkül, hogy felvenné őket. Ez a tervezett optimalizáció következménye. A rendszer három sebességi fokozatot használ, és 2-es vagy 3-as sebességnél fél óra alatt több cellát léphet, így csak az aktuális félórás mozgás végén tud bányászni.
A döntésnél a rendszer nem ásványtípus-értéket súlyoz, hanem főleg útvonal- és klaszterjellemzőket (közelség, sűrűség, visszaút és biztonság). Emiatt előfordul, hogy lokálisan „kihagy” egy ásványt, ha a teljes küldetés szempontjából másik célpontot ítél jobbnak.

## 3. Akkumulátor és éjszakai stratégia
A rover egyik legkritikusabb modulja az energiamenedzsment. A fogyasztás a sebesség négyzetével arányos ($E=2 \cdot v^2$), így a 3-as sebesség kilencszer annyi energiát igényel, mint az 1-es. A rendszer nappal +10 egységet tölt félóránként, éjjel nem tölt.

Ha egy lépés energetikailag nem biztonságos, a rover tud várakozni (standby), főleg nappali töltés reményében. Fontos: a jelenlegi implementáció célja a biztonságos visszatérés, de ez nem minden pályán garantált; időkeret mellett előfordulhat, hogy a rover nem ér vissza a startpontra.

## 4. Megjegyzések és kérdések (audit alapján)
- **Megjegyzés:** A jelenlegi kódban a „mission successful” feltétel engedi a 0.0 végső akkumulátort is (nem lehet negatív, de lehet nulla).
- **Felmerült kérdések** Elfogadott-e az az értelmezés, hogy nappal egy akció akkor is végrehajtható, ha a lépés elején az akkumulátor önmagában nem fedezné a fogyasztást, de a félórás nappali töltéssel együtt a nettó energia nem lesz negatív?

