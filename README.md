# Slap and Talk

Ett virtuellt utställningsrum för klistermärken (klibbor, slaps). Du går omkring i ett rum
i förstapersonsvy, laddar upp din egen klibba och stämplar den på väggar, golv och tak.
Allt sparas, så nästa besökare ser vad du har satt upp. Precis som på en riktig lyktstolpe
får man sätta över andras klibbor, och den senaste hamnar alltid överst.

Alla som är i samma rum ser varandra som små gubbar, ser varandras klibbor dyka upp direkt och
kan chatta. Inga konton behövs. Röstsamtal är nästa steg (se *Nästa steg* längst ner).

All kod är öppen källkod under MIT-licensen (se `LICENSE`).

---

## Så använder du det

**På datorn:** klicka på *Ladda upp klibba*, välj en bild och klicka på *Gå in i rummet*.
Gå med **W A S D**, titta med musen och **klicka** för att stämpla. Scrollhjulet ändrar storlek
(från 5 cm upp till väggens höjd, 4 m; det gäller klibbans längsta sida, så den blir aldrig högre
än väggen ens om du vrider den),
**Q/E** vrider klibban, **R** byter design, **V** växlar mellan Klibbläge och Tittläge och
**Esc** tar dig tillbaka till menyn.

**Peel (ångra) med Z:** satt en klibba lite fel? Tryck **Z** (eller **Ctrl+Z** / **Cmd+Z**) så
peelas din senaste klibba i rummet. Tryck igen för att gå bakåt, tills det står *Inga fler egna
klibbor här*. Det fungerar i både Klibbläge och Tittläge. I menyn finns **Mina klibbor i det här
rummet**: dina klibbor med bild och tid, nyast först. Peka på en (eller tryck) så lyser den upp i
rummet, **✕** tar bort just den, och **Peela alla** tar bort alla dina (tryck två gånger för att
bekräfta). Du kan bara peela dina egna: när du stämplar får din enhet en hemlig nyckel för just den
klibban (servern sparar bara en hash av den, och den syns aldrig för andra). Nycklarna sparas i
webbläsaren, så byter du enhet eller rensar webbläsaren kan du inte längre peela de gamla.
Admin kan fortfarande ta bort allt. Andra som är i rummet ser att klibban försvinner direkt.

**Klibbläge och Tittläge (V):** du börjar i *Klibbläge*: den genomskinliga pekaren visar var
klibban hamnar och ett klick stämplar. Tryck **V** för *Tittläge* när du vill kliva tillbaka och
beundra väggen: pekaren och siktet försvinner (kvar är bara en liten prick), klick stämplar inte
och scroll/Q/E gör ingenting. Gå och titta som vanligt. **R** byter fortfarande design i Tittläge,
men du stannar kvar där tills du trycker **V** igen. Längst ner i bild står vilket läge du är i.
V fungerar inte medan du skriver i ett textfält, och Ctrl+V (klistra in) växlar inte läge.

**Byta design med R:** har du laddat upp flera klibbor växlar **R** till nästa (efter den sista
börjar det om på den första). Rutan längst ner i mitten visar vilken design som är vald, till
exempel *2/4*. Vill du sätta samma klibba många gånger trycker du bara inte på R.
Dina uppladdade designs sparas i webbläsaren och finns kvar när du laddar om sidan, så länge
servern har kvar bilderna. Designs som har försvunnit från servern tas bort ur listan automatiskt.

**På mobilen:** ladda upp en bild i menyn och fäll ihop menyn med **☰**. Styrspaken nere till
vänster tar dig framåt, **dra med fingret** för att titta och **tryck** där du vill stämpla.
Den **runda knappen nere till höger** visar vald design: tryck på den för att byta till nästa.
**↩** peelar (ångrar) din senaste klibba. **Ögat 👁** bredvid slår på Tittläge (pekaren försvinner och tryck stämplar inte, designknappen
dämpas); tryck på ögat igen för att klibba.
Välj *Lägg till på hemskärmen* i webbläsarens meny, så öppnas den som en app.

### Tillsammans: gubbar, chatt och live-klibbor

Alla som är i samma rum ser varandra. Varje besökare är en liten gubbe med namnskylt ovanför
huvudet; den går när personen går och står och väger när den står still. Du ser dig själv bara
inifrån (förstapersonsvy), men i **🧍 Min gubbe** finns en förhandsvisning.

- **Klibbor syns direkt:** när någon stämplar, peelar eller när admin tar bort något ser alla i
  rummet det på en gång, utan att ladda om. Samma sak när rummets utseende ändras.
- **Vem är här:** i menyn står *3 här just nu* och en lista med namnen (grön prick = ansluten).
- **Chatt:** på datorn trycker du **T** eller **Enter**, skriver och trycker **Enter** för att
  skicka (**Esc** stänger). På mobilen trycker du på **💬**. Meddelandet syns i chatten med namn och
  tid, och en stund som en pratbubbla ovanför din gubbe. Medan du skriver går det inte att gå
  eller stämpla med tangenterna (WASD, V, R, Z, Q och E skrivs bara in i texten).
  De senaste 50 meddelandena finns kvar så länge någon är i rummet; de sparas aldrig på disk.
  Max 300 tecken per meddelande och en spärr mot spam (ungefär ett meddelande varannan sekund).
  Inget filter: det är fritt fram.
- **🧍 Min gubbe:** välj namn, kläder (huvtröja, t-shirt, kostym, väst), frisyr (kort, lugg,
  långt, bakåtkammat, tupp), färg på tröja, byxor och hår, hudton och keps. Gubben snurrar i en
  förhandsvisning medan du väljer (dra för att vrida). **Spara** sparar den på den här enheten och
  de andra ser den direkt. **🎲 Slumpa** ger en slumpad gubbe. Första gången får du en slumpad.
- **Namn på namnskylten:** det namn du väljer i Min gubbe syns för alla direkt när du sparar (och
  när du kommer in igen). Har du inget namn där används ditt artistnamn, annars heter du *Gäst 1*,
  *Gäst 2* … (servern delar ut numren, så två i samma rum får aldrig samma gästnamn, och ingen kan
  välja ett gästnamn själv). Namn rensas från osynliga tecken och dubbla mellanslag och får vara
  högst 24 tecken. Byter någon namn står det i chatten (*Gäst 1 heter nu Ulla*), och *kom in* /
  *gick* visar alltid det namn personen har just då.
- **Fullt rum:** högst 10 gubbar per rum (`MAX_PLAYERS_PER_ROOM`). Den elfte ser rummet, alla
  gubbar och chatten, men kan inte skriva och syns inte, och kommer in automatiskt när någon går.
- **Tappar du anslutningen** (mobilen byter nät, servern startar om eller Render vaknar) kopplar
  appen upp sig igen av sig själv: först efter en halv sekund, sedan längre och längre, som mest
  10 sekunder. När den är tillbaka hämtar den rummet igen så att du ser det du missat.
- Gubbarna stör aldrig stämplandet: klibbor hamnar på väggen bakom en person, inte på personen.

**Rum:** i menyn finns **＋ Nytt snabbrum** (skapar ett eget rum med en kort kod, t.ex.
`/?room=k7m2qx`), **🔗 Dela länk** (kopierar länken, eller öppnar dela-menyn på mobilen) och
**🏙 Till Staden**. Högst upp i bild står vilket rum du är i. Ett nytt rum är alltid helt tomt.

Det finns tre sorters rum:

| Typ | Vad | Sparas |
|---|---|---|
| **Staden** (`stad`) | Det gemensamma rummet där alla hamnar | Alltid, rensas aldrig |
| **Snabbrum** | Vem som helst kan skapa ett, inget konto behövs | Raderas automatiskt när ingen har varit där på 24 timmar |
| **Profilrum** | Hör till en användare (förberett, konton finns inte än) | Sparas, rensas aldrig av städningen |

Man kan också skriva ett eget namn: `/?room=jens`. Det blir då ett snabbrum.

**Städningen:** servern går igenom rummen en gång i timmen och tar bort snabbrum som ingen
har besökt på `QUICK_ROOM_TTL_HOURS` timmar. Ett besök räknas när någon öppnar rummet,
stämplar där, eller har sidan öppen (appen säger till var tionde minut). Designs (bilderna)
tas inte bort, de kan finnas i andras menyer och rum.

### Inspelning och kameror (för poddar och filmer)
Den som skapade rummet (eller admin; i Staden bara admin) ser **🎬 Inspelning** i menyn.

- **● Starta inspelning / ■ Stoppa:** servern spelar in allt som händer i rummet: utseendet,
  klibborna (även de som sätts och peelas), kamerorna, vilka som är där, hur deras gubbar ser ut,
  var de står och åt vilket håll de tittar (även upp och ner), och chatten. **Röst spelas inte in**
  (rösten kommer i nästa steg, och då med ett eget ljudspår per person).
- **● REC** syns uppe till höger för **alla** i rummet så länge det spelas in, och chatten säger
  när inspelningen startar och stoppas. Den som kommer in mitt i en inspelning får en ruta:
  *Det här rummet spelas in*. (Ett riktigt samtycke, där var och en godkänner, kommer med kontona.)
- **Gränser:** högst 2 timmar och 32 MB per inspelning (stoppas av sig själv), högst 4 rum
  samtidigt, och står rummet tomt i 5 minuter stoppas inspelningen. Se `REC_MAX_*` nedan.
- **🎥 Placera kamera här:** ställer en virtuell kamera där du står, åt det håll du tittar
  (*Kamera 1, 2 …*). I listan kan du byta namn, bildvinkel (35–90°) och format (fritt, 16:9
  liggande eller 9:16 stående för Reels), **⤓** flyttar kameran dit du står nu, **✕** tar bort den.
  Kamerorna sparas med rummet och syns för alla som små röda kameror (inte i Tittläge; kan
  stängas av med *Visa kamerorna i rummet*).
- **👁 Titta genom kameran:** skärmen visar exakt det kameran ser, med svarta kanter för 16:9
  och 9:16, så att du kan ställa in bilden. **Esc** (eller *Tillbaka*) = tillbaka.
- **Inspelningar:** under *Inspelningar* i menyn finns de som gjorts i rummet. **▶** öppnar
  uppspelaren (`/?room=<rum>&replay=<id>`): spela/pausa (mellanslag), spola (←/→ = 5 s),
  hastighet 0,5–4×, och välj vy: **fri kamera** (dra för att titta, WASD = gå), **en placerad
  kamera** eller **någons ögon** (POV). **⏺ Spela in video** spelar in det du ser till en
  `.webm`-fil (ett första test; riktig export av råfiler och klippta filmer kommer senare).
  Länken till en uppspelning kan delas: id:t är slumpat och går inte att gissa.
- Formatet på inspelningarna (versionerat, förberett för ljudspår och rendering) beskrivs i
  [`docs/recording-format.md`](docs/recording-format.md).
- **OBS på Render (gratisnivån):** disken är tillfällig, så inspelningarna försvinner när
  servern startas om (precis som klibborna), tills beständig lagring (R2) är påslagen.

### Rummets utseende (golv, väggar, tak)

När du klickar **＋ Nytt snabbrum** öppnas en panel där du väljer hur rummet ska se ut.
Rummet bakom panelen ändras direkt, så du ser resultatet innan du skapar det.

- **Golv:** klassisk, parkett, betong, linoleum (schackrutigt), klinker, asfalt, heltäckningsmatta.
- **Väggar:** klassisk, målad, kaklad, tegel, betong, träpanel, puts. Målad och kaklad
  får en färg ur en liten palett. Alla fyra väggarna blir likadana.
- **Tak:** klassisk, vitt, betong, mörkt.
- **🎲 Slumpa** ger en kod på fem tecken, t.ex. `k7m2q`. Samma kod ger alltid samma rum, så du
  kan skriva in en kod du sett hos någon annan. Väljer du själv en ruta blir det ett eget val
  utan kod.

Utseendet sparas i rummet (`style` i rummets JSON-fil, via lagrings-adaptern), så alla som
går in i rummet ser samma sak. Rum som skapades innan det här fanns får det klassiska utseendet.

**Vem får ändra?** När du skapar ett rum får din webbläsare en hemlig rumsnyckel (servern
sparar bara en hash av den). Då syns **🎨 Ändra rummets utseende** i menyn, bara för dig.
Admin kan ändra alla rum. Stadens utseende kan bara admin ändra.

Texturerna är små WebP-bilder i `client/public/textures/` (ca 470 kB totalt, ett rum laddar
bara de 1–3 som det använder). Målad vägg, kakel, linoleum och klinker ritas i koden i stället
för att laddas ner. Katalogen över alla val finns i `shared/styles.json`. Var bilderna kommer
ifrån och deras licens står i [CREDITS.md](CREDITS.md).

---

## Hur koden hänger ihop

```
klibbrum/
├── client/                 ← det som körs i webbläsaren
│   ├── index.html          ← sidan: menyn, styrspaken och 3D-ytan
│   ├── public/             ← filer som skickas som de är (appikoner, manifest, sw.js, textures/, avatars/gubbe.glb)
│   └── src/
│       ├── main.js         ← startpunkten som kopplar ihop allt (läs den först!)
│       ├── room.js         ← själva rummet (lådan på 10 x 4 x 10 m och ljuset)
│       ├── roomstyle.js    ← rummets utseende: texturer, slumpkoder
│       ├── controls.js     ← gå och titta (tangentbord, mus, styrspak, finger)
│       ├── stamps.js       ← stämplarna (bilden på ytan)
│       ├── fold.js         ← viker klibbor över kanter och hörn
│       ├── api.js          ← alla anrop till servern
│       ├── net.js          ← WebSocket till servern (kopplar upp sig igen själv)
│       ├── together.js     ← andra spelare, chatten och Min gubbe
│       ├── avatars.js      ← gubbarna: modellen, kläder/färger, namnskylt, gå/stå
│       ├── cameras.js      ← virtuella kameror: modellen i rummet, titta genom, 16:9/9:16-ram
│       ├── replay.js       ← uppspelaren (?replay=): spela, spola, vy, spela in video
│       ├── boot.js         ← väljer uppspelaren eller själva rummet

│       └── style.css       ← utseendet på menyn
├── server/                 ← det som körs på servern (Node.js)
│   ├── index.js            ← startar servern och städjobbet
│   ├── app.js              ← webbservern: rum, bilder och stämplar (alla adresser /api/...)
│   ├── store.js            ← rummen, stämplarna och bilderna (rumstyper, städning)
│   ├── storage/            ← VAR det sparas: local.js (disk) eller s3.js (t.ex. Cloudflare R2)
│   ├── realtime.js         ← flerspelarläget: WebSocket /ws, vem är här, chatten, live-händelser
│   └── recorder.js         ← sessionsinspelning: loggen recordings/<rum>/<id>.jsonl (+ .meta.json)
├── shared/                 ← delas av webbläsaren och servern (rummets mått, utseendekatalogen, gubbarna, replay.mjs = uppspelningen)
├── docs/                   ← recording-format.md: inspelningsformatet
├── data/                   ← skapas automatiskt: uppladdade bilder och rummen
├── tests/e2e.js            ← automatiskt test i en osynlig webbläsare
├── tests/rooms.test.js     ← test av rum, städning och lagring (utan webbläsare)
├── tests/realtime.test.js  ← test av flerspelarläget på servern (utan webbläsare)
├── tools/make-icons.js     ← ritar appikonen och testbilden demo-klibba.png (används bara i testerna)
├── tools/make-textures.js  ← gör om texturerna från ambientCG till små WebP-filer
├── tools/make-avatar.mjs   ← bygger gubbe.glb av Quaternius-modellerna
├── screenshots/            ← skärmdumpar från testet
├── ecosystem.config.js     ← säger till pm2 vilka program som ska hållas igång
└── .env                    ← hemligheter (admin-nyckeln). Läggs ALDRIG upp på GitHub.
```

### Vad som händer när du stämplar
1. `controls.js` håller reda på var du står och åt vilket håll du tittar.
2. När du klickar skickar `main.js` en osynlig stråle (en *raycast*) rakt ut från kameran
   och tar reda på var den träffar en yta och åt vilket håll ytan pekar (dess *normal*).
3. `stamps.js` räknar ut hur klibban ska vändas, och `fold.js` lägger den på ytan. Hamnar
   klibban över en kant eller i ett hörn viks den över på grannytorna (upp till tre ytor),
   som ett riktigt klistermärke som trycks in i ett hörn.
4. `api.js` skickar placeringen till servern: position, normal, vridning, storlek,
   bild-id och artistnamn. Servern sparar den i `data/rooms/<rum>.json`.
5. När någon öppnar sidan hämtas alla stämplar och ritas upp igen i samma ordning.

**Varför flimrar inte klibborna?** Två bilder på exakt samma yta "slåss" annars om vilken
som syns. Det kallas *z-fighting*. Därför flyttas varje klibba en aning framåt
(`polygonOffset`), och varje stämpel får ett löpnummer (`renderOrder`), så att den nyaste
alltid ritas sist och hamnar överst.

### Flerspelarläget
Webbläsaren öppnar en WebSocket till samma server: `/ws?room=<rum>` (samma port som webbappen,
så det fungerar på Render utan extra inställningar). HTTP-API:t är fortfarande det som gäller för
klibbor och rummets utseende: när något sparas där skickar servern en händelse (`stamp:add`,
`stamp:remove`, `image:remove`, `room:style`) till alla i rummet. Peel- och rumsnycklar skickas
aldrig ut. Över WebSocket går bara sådant som inte sparas: position (~12 gånger per sekund, och
bara när man rör sig), gubbens utseende, chatten och (senare) röst-signaler. Varje anslutning har
en spärr mot för många meddelanden. Servern pingar alla var 15:e sekund och kopplar bort den som
inte svarar; webbläsaren gör likadant åt andra hållet. Vid omstart säger servern till alla
(kod 1012) och webbläsarna kopplar upp sig igen. De andras gubbar visas 150 ms i efterhand och
glider mellan positionerna, så rörelsen blir mjuk även när nätet hackar. Alla meddelanden står
beskrivna överst i `server/realtime.js`.

### Byta rummet mot ett eget från Blender
Bygg rummet i Blender och exportera det med *Arkiv → Exportera → glTF 2.0 (.glb)*.
Lägg filen i `client/public/rum/stad.glb`. I `main.js` byter du sedan
`buildBoxRoom()` mot `await loadGltfRoom('/rum/stad.glb')`. Alla ytor i modellen går att
stämpla på. Tänk på att stämplar som redan sitter i rummet är knutna till ytornas namn
(t.ex. `vägg-norr`), så ett nytt rum börjar lämpligen tomt.

---

## Köra själv

Du behöver [Node.js](https://nodejs.org) version 20 eller senare.

```bash
npm install          # hämtar allt som behövs (en gång)
npm run build        # bygger webbappen till dist/
npm start            # startar servern på http://localhost:8787
```

Medan du skriver kod: kör `npm start` i ett fönster och `npm run dev` i ett annat. Öppna
adressen som Vite visar, så laddas sidan om automatiskt varje gång du sparar.

Testa allt automatiskt: `npm test` (servern måste vara igång).

### I bakgrunden med pm2
```bash
./scripts/start.sh                       # bygg + starta server och tunnel
npx pm2 ls                               # vad är igång?
npx pm2 logs slapandtalk                 # serverns logg
npx pm2 restart slapandtalk              # starta om servern
npx pm2 restart slapandtalk-tunnel       # starta om tunneln (ny adress!)
```

---

## Admin: ta bort olagligt innehåll

Det finns ingen förhandsgranskning, allt kommer upp direkt. Men den som driver en tjänst där
andra lägger upp saker måste enligt *lagen om elektroniska anslagstavlor* ta bort innehåll
som uppenbart är olagligt. Därför finns ett dolt admin-läge.

1. Admin-nyckeln står i filen `.env` (`ADMIN_TOKEN=...`). Visa den aldrig för någon.
2. Öppna sidan med `?admin=DIN_NYCKEL` i slutet av adressen. Nyckeln försvinner direkt
   ur adressfältet, och en röd rad visar att du är i admin-läge.
3. Klicka eller tryck på en klibba. Välj *Ta bort den här stämpeln*, eller
   *Ta bort bilden överallt* om själva bilden inte får finnas kvar.

Admin-läget gäller tills du stänger fliken. Vill du byta nyckel ändrar du den i `.env` och
startar om servern.

---

## Gränser i version 1
- Högst 10 gubbar per rum (fler kan titta). Chatten finns bara i minnet och försvinner när
  rummet blir tomt eller servern startar om.
- Ingen röst än, och man ser inte vart de andra tittar upp/ner (gubben vrider sig bara åt sidan;
  blicken upp/ner skickas och spelas in, så den syns med någons ögon i uppspelningen).
- Inspelning: inget riktigt samtycke än (bara ● REC och en ruta till den som kommer in). Det kommer
  med kontona, liksom behörigheter för vem som får se en inspelning (nu: alla med länken).
- Inga konton. Artistnamnet sparas bara i din egen webbläsare och följer med dina stämplar.
- Klibbor som du lagt upp syns i menyn bara i den webbläsare där du laddade upp dem.
- Du kan peela (ta bort) dina egna klibbor från samma webbläsare. Andras kan bara admin ta bort.
- Texturerna har inga normal maps (ingen djupverkan i fogar och tegel), för att hålla nere storleken.

## Nästa steg (förberett, inte byggt)
- **Inspelning, steg 2–5:** röst via LiveKit med ett ljudspår per person (så att varje talare
  hamnar i en egen fil och i synk med loggen, se `docs/recording-format.md`), export av råfiler
  (en video per kamera och per persons ögon + ljud), automatklippning efter vem som pratar och
  9:16-Reels, och till sist livesändning, konton och betalning.
- **Röstsamtal:** WebRTC direkt mellan besökarna, med ljud i 3D (rösten kommer från gubben och
  blir svagare på avstånd, Web Audio `PannerNode`). Servern är redan klar: meddelandet
  `signal {to, data}` skickas vidare till en annan spelare i samma rum (för offer/answer/ICE), och
  klienten har `net.sendSignal(to, data)` och `onSignal(from, data)`. Det som saknas är själva
  WebRTC-koden i webbläsaren, en mikrofonknapp och en STUN/TURN-server (TURN behövs för en del
  mobilnät).
- **Profiler och egna rum:** rummen har redan egna id:n (`?room=...`). Det som behövs är
  inloggning och en ägare per rum, med behörigheterna *titta*, *chatta* och *sätta upp*.
- **SQLite i stället för JSON-filer:** byt bara ut `server/store.js`.

Byggt med [Three.js](https://threejs.org), [Vite](https://vite.dev),
[Express](https://expressjs.com), [sharp](https://sharp.pixelplumbing.com),
[pm2](https://pm2.keymetrics.io) och [Playwright](https://playwright.dev).
Alla är öppen källkod.

### Om Render och gamla klibbor
På Renders gratisnivå är disken tillfällig: när tjänsten startas om (efter en uppdatering eller
när den har sovit) försvinner uppladdade bilder och stämplar. Webbläsaren minns ändå dina designs
och kan visa gamla kopior ur sin cache. Därför kollar appen vid start att dina designs finns kvar
på servern och tar bort de som är borta, och servern hoppar över stämplar vars bild saknas.
För att klibborna ska ligga kvar på riktigt behövs en beständig disk eller en databas.

### Lagring och inställningar (miljövariabler)
All lagring går genom ett litet lager i `server/storage/`, så vi kan byta från disk till
beständig lagring utan att skriva om appen. Rummen sparas som `rooms/<rum>.json`, varje design
en gång som `images/<id>.json` + `uploads/<id>.webp`, och stämplarna pekar på designen med dess id.
Id:t räknas fram ur bildens innehåll, så laddar två personer upp exakt samma bild blir det en design.

| Variabel | Standard | Vad |
|---|---|---|
| `STORAGE` | `local` | `local` = disken, `s3` = S3-kompatibel lagring (t.ex. Cloudflare R2) |
| `DATA_DIR` | `./data` | Mappen som används när `STORAGE=local` |
| `S3_BUCKET` | – | Bucketens namn (krävs för `s3`) |
| `S3_ENDPOINT` | – | För R2: `https://<konto-id>.r2.cloudflarestorage.com` |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | – | API-nyckeln från leverantören (hemlig, lägg den bara i Render/`.env`) |
| `S3_REGION` | `auto` | Region (R2 använder `auto`) |
| `S3_PREFIX` | tomt | Lägger allt under en "mapp" i bucketen, t.ex. `slapandtalk/` |
| `QUICK_ROOM_TTL_HOURS` | `24` | Hur länge ett tomt snabbrum får stå kvar |
| `REC_MAX_MINUTES` | `120` | Längsta inspelning (minuter) |
| `REC_MAX_MB` | `32` | Största inspelning (MB logg) |
| `REC_MAX_ACTIVE` | `4` | Hur många rum som kan spelas in samtidigt |
| `ROOM_CLEANUP_INTERVAL_MINUTES` | `60` | Hur ofta städningen körs |
| `MAX_PLAYERS_PER_ROOM` | `10` | Hur många gubbar som får vara i ett rum samtidigt (fler kan titta) |

**Slå på Cloudflare R2 senare:** skapa en bucket och en API-token (Object Read & Write) i
Cloudflare, sätt `STORAGE=s3` och S3-variablerna ovan i Render, och starta om. Befintliga
klibbor på Render-disken flyttas inte automatiskt. En riktig databas för rummen kan senare
kopplas in genom att bara skriva om funktionerna i `server/store.js`.
