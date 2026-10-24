# Slap and Talk

Ett virtuellt utställningsrum för klistermärken (klibbor, slaps). Du går omkring i ett rum
i förstapersonsvy, laddar upp din egen klibba och stämplar den på väggar, golv och tak.
Allt sparas, så nästa besökare ser vad du har satt upp. Precis som på en riktig lyktstolpe
får man sätta över andras klibbor, och den senaste hamnar alltid överst.

Det här är **version 1**: en person i taget, inga konton. Koden är redan förberedd för
flera besökare samtidigt, chatt, röstsamtal och egna rum (se *Nästa steg* längst ner).

All kod är öppen källkod under MIT-licensen (se `LICENSE`).

---

## Så använder du det

**På datorn:** klicka på *Ladda upp klibba*, välj en bild och klicka på *Gå in i rummet*.
Gå med **W A S D**, titta med musen och **klicka** för att stämpla. Scrollhjulet ändrar storlek,
**Q/E** vrider klibban, **R** byter design, **V** växlar mellan Klibbläge och Tittläge och
**Esc** tar dig tillbaka till menyn.

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
**Ögat 👁** bredvid slår på Tittläge (pekaren försvinner och tryck stämplar inte, designknappen
dämpas); tryck på ögat igen för att klibba.
Välj *Lägg till på hemskärmen* i webbläsarens meny, så öppnas den som en app.

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

---

## Hur koden hänger ihop

```
klibbrum/
├── client/                 ← det som körs i webbläsaren
│   ├── index.html          ← sidan: menyn, styrspaken och 3D-ytan
│   ├── public/             ← filer som skickas som de är (appikoner, manifest, sw.js)
│   └── src/
│       ├── main.js         ← startpunkten som kopplar ihop allt (läs den först!)
│       ├── room.js         ← själva rummet (lådan på 10 x 4 x 10 m och ljuset)
│       ├── controls.js     ← gå och titta (tangentbord, mus, styrspak, finger)
│       ├── stamps.js       ← stämplarna (bilden på ytan)
│       ├── fold.js         ← viker klibbor över kanter och hörn
│       ├── api.js          ← alla anrop till servern
│       ├── net.js          ← tom förberedelse för flerspelarläge
│       └── style.css       ← utseendet på menyn
├── server/                 ← det som körs på servern (Node.js)
│   ├── index.js            ← startar servern och städjobbet
│   ├── app.js              ← webbservern: rum, bilder och stämplar (alla adresser /api/...)
│   ├── store.js            ← rummen, stämplarna och bilderna (rumstyper, städning)
│   ├── storage/            ← VAR det sparas: local.js (disk) eller s3.js (t.ex. Cloudflare R2)
│   └── realtime.js         ← tom förberedelse för flerspelarläge
├── data/                   ← skapas automatiskt: uppladdade bilder och rummen
├── tests/e2e.js            ← automatiskt test i en osynlig webbläsare
├── tests/rooms.test.js     ← test av rum, städning och lagring (utan webbläsare)
├── tools/make-icons.js     ← ritar appikonen och testbilden demo-klibba.png (används bara i testerna)
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
- En användare i taget. Två personer kan vara inne samtidigt, men de ser inte varandras
  nya klibbor förrän de laddar om sidan.
- Inga konton. Artistnamnet sparas bara i din egen webbläsare och följer med dina stämplar.
- En klibba hamnar bara på den yta du träffar och viker sig inte runt hörn.
- Klibbor som du lagt upp syns i menyn bara i den webbläsare där du laddade upp dem.
- Det finns ingen ångra-knapp. Bara admin kan ta bort.

## Nästa steg (förberett, inte byggt)
- **Flerspelarläge (6–8 personer):** WebSocket-server i `server/realtime.js`, klient i
  `client/src/net.js`. Händelserna `stamp:add`, `stamp:remove`, `player:move` och
  `chat:message` finns redan beskrivna där.
- **Textchatt:** samma WebSocket-anslutning.
- **Röstsamtal:** WebRTC direkt mellan besökarna. Servern skickar bara vidare
  "signalerna" (offer/answer/ICE).
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
| `ROOM_CLEANUP_INTERVAL_MINUTES` | `60` | Hur ofta städningen körs |

**Slå på Cloudflare R2 senare:** skapa en bucket och en API-token (Object Read & Write) i
Cloudflare, sätt `STORAGE=s3` och S3-variablerna ovan i Render, och starta om. Befintliga
klibbor på Render-disken flyttas inte automatiskt. En riktig databas för rummen kan senare
kopplas in genom att bara skriva om funktionerna i `server/store.js`.
