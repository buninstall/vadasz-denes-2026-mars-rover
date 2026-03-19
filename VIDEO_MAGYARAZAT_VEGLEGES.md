# Projekt Bemutató Narráció (Mars Rover 2026)

## 1. Az algoritmus alapfilozófiája
Ebben a projektben egy olyan autonóm útvonaltervezőt alkottunk meg, amely a biztonság és a hatékonyság egyensúlyát tartja szem előtt. A szoftver nem egyszerűen a legközelebbi ásványt veszi célba, hanem egy klaszter-alapú pontozási rendszert használ. Ez azt jelenti, hogy a rendszer folyamatosan értékeli a környező ásványok sűrűségét, és oda navigálja a rovert, ahol a legkevesebb energia befektetéssel a legtöbb mintát ásványt be.

## 2. Miért "hagy ki" ásványokat a rover?
A videón látható, hogy a rover néha elhalad ásványok mellett anélkül, hogy felvenné őket. Ez nem hiba, hanem a tervezett optimalizáció eredménye. A rendszer három sebességi fokozatot használ. Amikor a rover 2-es vagy 3-as sebességgel halad át egy cellán, a fizikai korlátok miatt csak a mozgás végpontján tud mintát venni. 

A szoftver ilyenkor egy döntési mátrix alapján mérlegel: ha a megállás és az újraindulás több energiát fogyasztana, mint amennyit az adott ásvány ér abban a pillanatban, akkor a rendszer inkább fenntartja a rover lendületét a távolabbi, értékesebb célpont felé. Később, egy másik útvonalon visszatérve, sokkal hatékonyabban tudja majd begyűjteni a maradékot.

## 3. Akkumulátor és éjszakai stratégia
A rover egyik legkritikusabb modulja az energiamenedzsment. A fogyasztás a sebesség négyzetével arányos ($E=2 \cdot v^2$), így a 3-as sebesség kilencszer annyi energiát igényel, mint az 1-es. A program kalkulál a marsi nappalok és éjszakák váltakozásával is. 

Ha a rendszer azt látja, hogy a rover éjszaka merülne le egy veszélyes zónában, akkor inkább "Standby" módba kapcsolja az egységet, és megvárja a napfelkeltét a töltéshez. Ez a konzervatív stratégia garantálja, hogy a gép ne ragadjon a sötétben, és mindig legyen elég tartaléka a biztonságos visszatéréshez a kiinduló pontra.

## 4. Összegzés
A végeredmény egy olyan intelligens vezérlés, amely képes 100%-os hatékonysággal begyűjti az ásványokat a megadott időkereten belül, miközben dinamikusan alkalmazkodik a változó energiaviszonyokhoz és az akadályokhoz.