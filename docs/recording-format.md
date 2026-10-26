# Inspelningsformatet (sessionsinspelning), version 1

En inspelning är en logg över allt som händer i ett rum, så att rummet kan spelas upp igen
exakt som det var: i webbläsaren (uppspelaren, `?room=<rum>&replay=<recId>`), och senare
renderas till video från valfri kamera eller någons ögon (steg 3), klippas automatiskt efter vem
som pratar (steg 4) och strömmas live (steg 5).

Servern skriver loggen (`server/recorder.js`). Uppspelningen (läsa, tidslinje, läget vid en viss
tid) finns i `shared/replay.mjs` och används av både webbappen, testerna och kommande rendering.

## Filer

Sparas via lagringslagret (lokal disk eller S3/R2):

| Nyckel | Innehåll |
| --- | --- |
| `recordings/<rum>/<recId>.jsonl` | Loggen. En JSON-rad per händelse (JSON Lines, UTF-8). |
| `recordings/<rum>/<recId>.meta.json` | Sammanfattning: start/stopp, längd, storlek, deltagare. |
| `recordings/<rum>/<recId>.shots.json` | Bildlistan (råmaterial för klippning), skrivs när inspelningen stoppas. Se *Bildlistan* nedan. |

`recId` = 16 hex-tecken (slumpat). Medan inspelningen pågår skrivs båda filerna var 20:e sekund
(hela filen skrivs om), och en sista gång när den stoppas. Startar servern om mitt i en inspelning
står `status: "recording"` kvar i meta-filen; API:t visar den då som `interrupted` (avbruten), och
loggen går att spela upp fram till senaste skrivningen (en halv sista rad hoppas över).

## Rad 1: huvudet (startläget)

```json
{
  "format": "slapandtalk-rec", "v": 1, "id": "84732e9bc569733e", "room": "k7m2qx",
  "startedAt": "2026-10-24T17:58:02.120Z", "clock": "ms", "positions": "eye",
  "style": { "floor": "betong", "wall": "tegel", "ceiling": "vit" },
  "stamps": [ { "id": "…", "order": 1, "imageId": "…", "position": [x,y,z], "normal": [x,y,z], "quaternion": [x,y,z,w], "size": 0.3, "rotation": 0, "surface": "vägg-norr", "artist": "Ulla K", "artistLink": "https://www.instagram.com/ulla.k", "createdAt": "…" } ],
  "images": { "<imageId>": { "id": "…", "url": "/uploads/<id>.webp", "width": 400, "height": 400, "artist": "", "createdAt": "…" } },
  "cameras": [ { "id": "…", "name": "Kamera 1", "p": [x,y,z], "yaw": 0.75, "pitch": -0.2, "fov": 60, "aspect": "16:9", "createdAt": "…" } ],
  "players": [ { "id": "5e7d066fda", "name": "Ulla", "look": { "outfit": "kostym", "hair": "lang", "shirt": "#e63946", "pants": "#…", "hairColor": "#…", "skin": "#…", "hat": true, "hatColor": "#…" }, "p": [x,y,z], "y": 0.5, "pi": -0.1 } ],
  "tracks": [],
  "limits": { "maxMs": 7200000, "maxBytes": 33554432 }
}
```

- `format` + `v`: läsaren ska vägra okänt `format` och klara alla `v` den känner till. Nya fält
  läggs bara till (aldrig ändrad betydelse) inom samma version; okända fält och okända
  händelsetyper ska hoppas över.
- Klibbor är de publika fälten (aldrig peel-nyckeln). Bilderna hämtas via `url`.
- `players` = de som var i rummet när inspelningen startade.

## Rad 2…: händelser

Varje rad: `{ "t": <ms sedan start>, "e": "<typ>", …data }`. Raderna står i tidsordning
(läsaren sorterar ändå stabilt på `t`).

| `e` | Data | Betydelse |
| --- | --- | --- |
| `join` | `id, name, look, p, y, pi` | Någon kom in (eller kom tillbaka efter ett avbrott; då med nytt `id`). |
| `leave` | `id` | Någon gick. |
| `look` | `id, name, look` | Bytte gubbe eller namn. |
| `move` | `id, p, y, pi` | Position och blick. Högst ~10 per sekund och person; den senaste kommer alltid med. |
| `chat` | `id, name, text, mid` | Chattmeddelande (`id` = avsändaren, `mid` = meddelandets id). |
| `stamp:add` | `stamp, image` | En klibba sattes. `stamp.artist` (högst 60 tecken) och `stamp.artistLink` (valfri, alltid en tvättad `https:`-länk, se `shared/artistlink.mjs`) säger vem som gjorde den. |
| `stamp:remove` | `id` | En klibba peelades eller togs bort. |
| `image:remove` | `id` | Admin tog bort en bild helt: alla klibbor med den bilden försvinner. |
| `room:reset` | `by`, `removed` | Rummets skapare (eller admin) nollställde rummet: alla klibbor försvinner. `by` = namnet som visades. |
| `room:style` | `style` | Rummets utseende ändrades. |
| `camera:add` / `camera:update` | `camera` (hela kameran) | En kamera placerades / flyttades / ändrades. |
| `camera:remove` | `id` | En kamera togs bort. |
| `talk` | `id, l` | Hur högt någon pratar, 0–15 (kvantiserat, `l=0` = tyst igen). Bara medan inspelningen pågår och mikrofonen är på och inte avstängd; högst ~12 per sekund och person, och bara när personen pratar. **Aldrig själva ljudet.** Driver munnen och auto-regissören. |
| `end` | `reason` | Sista raden: `stop` (någon tryckte stopp), `time` (maxlängden), `size` (maxstorleken), `empty` (rummet tomt i 5 min), `shutdown` (servern stängdes). |

### Koordinater

- Meter. Rummet är 10 × 4 × 10 m med mitten av golvet i origo, y uppåt (`shared/room.json`).
- `p` för spelare = **ögats** position (kamerans position i webbläsaren, oftast y = 1,6).
  Gubben står på golvet under ögat.
- `y` (yaw) = vridning runt y-axeln i radianer, 0 = tittar mot −z (norra väggen).
  `pi` (pitch) = blicken upp (+) / ner (−) i radianer. Blickriktningen är
  `Euler(pi, y, 0, 'YXZ')` i Three.js – samma som kamerorna (`yaw`, `pitch`).
- `fov` = lodrät bildvinkel i grader. `aspect` = `""` (fritt), `"16:9"` eller `"9:16"`.
  Personers ögon använder 70° (samma som appen).

### Uppspelning (deterministisk)

`snapshotAt(tidslinje, t)` ger läget vid tiden `t` som en ren funktion av `t`: vilka som är där,
deras gubbe, position och blick, vilka klibbor som sitter, kamerorna, utseendet och de senaste
chattmeddelandena. Positioner mellan två `move` glider linjärt under högst 200 ms före nästa
position (står någon still skickas inget, så gubben ska inte glida under hela pausen).
Samma tid ger alltid samma resultat, oavsett om man spelar, spolar eller hoppar bakåt.

## Vad som INTE spelas in

- Själva rösten/ljudet (röstchatten går direkt mellan webbläsarna, WebRTC). Bara nivån (`talk`) loggas.
- Röstchattens signalering (`signal`-meddelanden: WebRTC offer/answer/ICE).
- Peel-nycklar, rumsnyckeln, admin-nyckeln, IP-adresser.
- Vem som tittar i rummet utan att vara med (när rummet är fullt).

## Framtid: ljudspår (steg 2) och rendering (steg 3)

Ljudet spelas in per talare (LiveKit, ett spår per person) som separata filer bredvid loggen:

```
recordings/<rum>/<recId>/audio/<playerId>-<n>.opus
```

och beskrivs i huvudet (`tracks`) eller, om ett spår startar senare, med en händelse:

```json
{ "t": 1520, "e": "track", "kind": "audio", "id": "a1", "player": "5e7d066fda", "file": "audio/5e7d066fda-1.opus", "offsetMs": 1520, "codec": "opus", "sampleRate": 48000 }
{ "t": 9000, "e": "track:end", "id": "a1" }
{ "t": 4100, "e": "speaking", "player": "5e7d066fda", "level": 0.8 }
```

- `offsetMs` = var i inspelningens klocka spåret börjar, så ljud och bild hamnar i synk.
- `speaking` (vem som pratar, från LiveKit) blir grunden för automatklippningen (steg 4).
- Rendering (steg 3) läser loggen med `shared/replay.mjs`, ställer en kamera per bildruta
  (en placerad kamera med `fov`/`aspect`, eller någons ögon) och ritar rummet i t.ex. 30 bilder
  per sekund. Uppspelarens "⏺ Spela in video" är ett första test av den vägen (webm i webbläsaren).

Nya händelsetyper läggs till inom version 1 (läsare hoppar över det de inte känner till).
Ändras betydelsen av ett befintligt fält höjs `v`.

## Bildlistan (auto-regissören)

`shared/director.mjs` räknar fram, deterministiskt ur loggen, vilka bilder en klippare kan använda.
Samma logg ger alltid samma lista (och samma bild i uppspelarens vy *🎬 Director*).

```json
{ "format": "slapandtalk-shots", "v": 1, "recId": "…", "room": "…", "durationMs": 61234, "introMs": 2800,
  "speakers": [{ "id": "5e7d…", "name": "Jens", "talkMs": 21400 }],
  "speech":   [{ "id": "5e7d…", "from": 1200, "to": 4800 }],
  "shots":    [{ "from": 0, "to": 1200, "kind": "room" }, { "from": 1200, "to": 3900, "kind": "close", "speaker": "5e7d…", "name": "Jens" }],
  "angles":   ["room", "close", "medium", "rear"], "params": { … } }
```

- Tider i ms i inspelningens klocka (en video från uppspelaren börjar med `introMs` logga-intro).
- `kind`: `room` (hörnet, översikt, när ingen pratar), `close` (närbild på ansiktet), `medium`
  (halvbild från sidan), `rear` (över axeln, bakifrån).
- Regler: ett tal-segment börjar vid nivå ≥ 2, slutar efter 650 ms tystnad, kortare än 350 ms räknas
  inte. En bild varar 2,2–5,2 s; vinkeln växlar närbild → halvbild → närbild → över axeln.
  Någon annan tar över bilden först när den pratat 0,9 s (eller 0,3 s om den som visas varit tyst
  i 650 ms). Tystnad i 1,2 s → rummet.
- Hämtas med `GET /api/rooms/:rum/recordings/:recId/shots` (räknas fram ur loggen om filen inte finns
  än, t.ex. medan inspelningen pågår) och med *🎬 Shot list* i uppspelaren. Separata tagningar per
  vinkel spelas in med *⏺ Record video* och vyn *Close-up / Medium / Over the shoulder: <namn>*.

## Gränser

| Variabel | Standard | Betydelse |
| --- | --- | --- |
| `REC_MAX_MINUTES` | 120 | Längsta inspelning; sedan stoppas den (`time`). |
| `REC_MAX_MB` | 32 | Största logg; sedan stoppas den (`size`). |
| `REC_MAX_ACTIVE` | 4 | Hur många rum som kan spelas in samtidigt på servern (sedan 429). |

Ungefärlig storlek: en rörelse ≈ 70 byte, alltså ≈ 0,7 kB/s per person som rör sig hela tiden
(10 personer i 2 timmar ≈ 50 MB i värsta fall, oftast mycket mindre eftersom stillastående inte skickas).
En `talk`-rad ≈ 40 byte, alltså ≈ 0,5 kB/s per person medan den pratar.

## API

| Metod och adress | Vem | Svar |
| --- | --- | --- |
| `GET /api/rooms/:rum/recording` | alla | `{ recording: null \| { recId, startedAt, durationMs, bytes } }` |
| `POST /api/rooms/:rum/recording/start` | skaparen / admin | `{ ok, already, recording }` |
| `POST /api/rooms/:rum/recording/stop` | skaparen / admin | `{ ok, recording: meta }` (409 om ingen pågår) |
| `GET /api/rooms/:rum/recordings/:recId/shots` | alla med id:t | bildlistan (se ovan) |
| `GET /api/rooms/:rum/recordings` | skaparen / admin | `{ recordings: [meta, …] }` |
| `GET /api/rooms/:rum/recordings/:recId` | alla med länken | meta |
| `GET /api/rooms/:rum/recordings/:recId/log` | alla med länken | loggen (`application/x-ndjson`) |
| `DELETE /api/rooms/:rum/recordings/:recId` | skaparen / admin | `{ ok }` |
| `POST /api/rooms/:rum/cameras` | skaparen / admin | `{ camera }` (högst 12 per rum) |
| `PUT /api/rooms/:rum/cameras/:id` | skaparen / admin | `{ camera }` |
| `DELETE /api/rooms/:rum/cameras/:id` | skaparen / admin | `{ ok }` |

"Skaparen" = rumsnyckeln i `x-room-key`, admin = `x-admin-token`. I Staden bara admin.
Händelser till alla i rummet via WebSocket: `rec:start`, `rec:stop`, `camera:add`,
`camera:update`, `camera:remove` (som `event`), och `welcome.rec` för den som kommer in.
