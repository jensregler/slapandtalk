# Texturer och licenser

Bildtexturerna i `client/public/textures/` kommer från [ambientCG](https://ambientcg.com) och är
licensierade under **CC0 1.0** (public domain, inget krav på attribution). De har skalats ner och
gjorts om till WebP med `tools/make-textures.js`.

| Fil | Används till | Källa |
|---|---|---|
| `parkett.webp` | Golv: parkett | [WoodFloor051](https://ambientcg.com/view?id=WoodFloor051) |
| `betong.webp` | Golv, vägg och tak: betong | [Concrete034](https://ambientcg.com/view?id=Concrete034) |
| `asfalt.webp` | Golv: asfalt | [Asphalt031](https://ambientcg.com/view?id=Asphalt031) |
| `matta.webp` | Golv: heltäckningsmatta | [Carpet012](https://ambientcg.com/view?id=Carpet012) |
| `tegel.webp` | Vägg: tegel | [Bricks059](https://ambientcg.com/view?id=Bricks059) |
| `trapanel.webp` | Vägg: träpanel | [WoodSiding005](https://ambientcg.com/view?id=WoodSiding005) |
| `puts.webp` | Vägg: puts | [Plaster001](https://ambientcg.com/view?id=Plaster001) |

Klassisk, målad, kaklad, linoleum och klinker ritas i koden (`client/src/roomstyle.js`) och har
inga externa källor.

# Gubbarna

`client/public/avatars/gubbe.glb` (ca 300 kB) är byggd av fem karaktärer ur **Ultimate Modular Men
Pack** av [Quaternius](https://quaternius.com), licensierade under **CC0 1.0** (public domain).
Hämtade från [Poly Pizza](https://poly.pizza/bundle/Ultimate-Animated-Character-Pack-ZiH8muWqwQ):
Casual Character, Casual 2, Beach Character, Business Man och Punk.
`tools/make-avatar.mjs` slår ihop dem till ett skelett med animationerna Idle, Walk och Wave,
tar bort UV-koordinater och normaler (färgerna är platta) och komprimerar med meshopt.
Kepsen ritas i koden (`client/src/avatars.js`).

# Ljud

Ljuden (slap när man stämplar, peel när man ångrar) skapas i webbläsaren med Web Audio i
`client/src/sound.js` (filtrerat brus och en kort sinuston). Det finns inga ljudfiler och inga
externa källor att kreditera.

# Logga-introt och kanalloggan

`client/public/intro/` är Jens Reglers egna filer (Slap and Talk-loggan): det animerade introt i
16:9, 9:16 och 1:1 (`sat-intro-*.mp4`, plus `.webm`-kopior i VP9 utan ljud gjorda med ffmpeg),
introts ljud (`sat-intro-ljud.wav`) och kanalloggan `bug-s2.png` (S2-klistermärket, nerskalat).
Inget av det är AI-genererat.

# 3D props (bord, stolar, gatumöbler)

`client/public/props/props.glb` (ca 155 kB, byggd med `tools/build-props.sh`: en scen per modell,
texturer inbakade, meshopt-komprimerad). Alla modeller är **CC0 1.0** (public domain):

| Prop | Modell | Källa |
|---|---|---|
| table, chair, sofa, plant, bookcase, floorlamp | table, chair, loungeSofa, pottedPlant, bookcaseOpen, lampRoundFloor | [Kenney – Furniture Kit](https://kenney.nl/assets/furniture-kit) |
| lamp2, cone, barrier, trafficlight | light-curved, construction-cone, construction-barrier, traffic-light | [Kenney – City Kit (Roads)](https://kenney.nl/assets/city-kit-roads) |
| planter, tree, treeL | planter, tree-small, tree-large | [Kenney – City Kit (Suburban)](https://kenney.nl/assets/city-kit-suburban) |
| parasol | detail-parasol-a | [Kenney – City Kit (Commercial)](https://kenney.nl/assets/city-kit-commercial) |
| statue | statue_column | [Kenney – Nature Kit](https://kenney.nl/assets/nature-kit) |
| lamp | Street Light (Quaternius) | [Poly Pizza nFwrlcLvM5](https://poly.pizza/m/nFwrlcLvM5) |
| bin | Trashcan (Quaternius) | [Poly Pizza vlVx279xut](https://poly.pizza/m/vlVx279xut) |
| bin2 | Trashcan (Kenney) | [Poly Pizza eoC8NFaafh](https://poly.pizza/m/eoC8NFaafh) |
| bench | Bench (Quaternius) | [Poly Pizza nARUaxtRHA](https://poly.pizza/m/nARUaxtRHA) |
| market | Market Stand (Quaternius) | [Poly Pizza DGIM5HGISb](https://poly.pizza/m/DGIM5HGISb) |
| hydrant | Fire Hydrant (Quaternius) | [Poly Pizza DKkMQbEklp](https://poly.pizza/m/DKkMQbEklp) |
| dumpster | Dumpster (Quaternius) | [Poly Pizza PKsbolkZSr](https://poly.pizza/m/PKsbolkZSr) |

Byggda i koden (`client/src/props3d.js`, inga externa källor): elskåp, PostNord-låda, cykelställ,
busshållplats, affischpelare, kiosk, telefonkiosk, parkerad bil, fontän, rätblock och vägskyltarna
(stopp, väjningsplikt, 30, övergångsställe, parkering, enkelriktat, förbud mot infart).
Alla ritas i klistermärkesstilen: platt toon-ljus och svart kontur.
