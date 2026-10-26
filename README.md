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

**Språk:** hela sajten är på **engelska** (ingen språkväljare). All text som besökaren ser finns
samlad i `client/src/strings.js`, så det blir lätt att lägga till fler språk senare. Den här
README:n (och koden) är fortfarande på svenska; knapparnas namn står här som de heter på sidan.

**Första vyn är enkel:** i menyn syns bara det viktigaste: rummets namn och typ, **Room ▾**
(*＋ New quick room*, *🔗 Share link*, *🏙 Back to the City*), vilka som är här,
**⬆ Upload sticker**, dina designs, **Slap mode / Look mode**, **Enter the room** och **⚙ More**.
Allt annat ligger under **⚙ More**: storlek, rotation, slumpvridning och artistnamn, *My slaps in
this room* (historiken och peel), vilka som är här och **🧍 My avatar**, rummets utseende
(*🎨 Change room look*), ljud, **🎬 Recording** med kamerorna, och hjälpen. På mobilen öppnas
⚙ More som ett ark nerifrån (styrspaken göms så länge), ✕ stänger. More stängs av sig själv när
du går in i rummet.

**På datorn:** klicka på *⬆ Upload sticker*, välj en bild och klicka på *Enter the room*.
Gå med **W A S D**, titta med musen och **klicka** för att stämpla (*slap*). Scrollhjulet ändrar storlek
(från 5 cm upp till 1 m i grundversionen; i fullversionen, `bigStickers`, finns ingen övre gräns, inte ens
rummet – reglaget går till 4 m, hjulet längre. Storleken gäller klibbans längsta sida. Klibbor som redan sitter
uppe får behålla sin storlek). Varje design **börjar på sin egen höjd** när du väljer den (R/F, paletten,
en ny uppladdning): bokstaven först i filnamnet, se *Startstorlek från filnamnet* nedan, annars 10 cm),
**Q/E** vrider klibban, **R** byter till nästa design, **F** till förra, **V** växlar mellan Slap mode och Look mode, **M**
stänger av/slår på ljudet och **Esc** tar dig tillbaka till menyn.

**Ljud:** varje gång du stämplar hörs ett kort, smackigt *slap*, och när du peelar ett mjukare
*rrrip*. Andras klibbor och peel i samma rum hörs också, från där klibban sitter: till vänster
eller höger, och tystare ju längre bort (Web Audio, `PannerNode` med HRTF). Varje ljud får en
liten slumpad tonhöjd så att det inte låter likadant varje gång. Ljuden skapas i koden
(`client/src/sound.js`: filtrerat brus och en låg "duns"), så inga ljudfiler behövs och inget
behöver krediteras. **🔊/🔇** uppe i menyn (eller **M**, eller *Sounds* under ⚙ More) stänger av
ljudet; valet sparas i webbläsaren (`klibb.muted`). Webbläsare tillåter ljud först efter att
man klickat eller tryckt någonstans, så det första ljudet kommer efter första klicket.

**Peel (ångra) med Z:** satt en klibba lite fel? Tryck **Z** (eller **Ctrl+Z** / **Cmd+Z**) så
peelas din senaste klibba i rummet. Tryck igen för att gå bakåt. När det inte finns fler kommer en liten ruta,
*End of slap history* (bara en gång, även om du håller Z, och Esc eller *Keep slapping* stänger
den). Är det ditt rum (eller du är admin) frågar den *Reset this room?*: **Reset room** tar bort
**alla** klibbor i rummet (även andras) på servern, alla i rummet ser *X reset the room* och spelas
rummet in kommer det med i inspelningen. Annars (Staden eller någon annans rum) frågar den *Start a
fresh room?*: **New room** gör samma som Room ▾ > New quick room. Bara admin kan nollställa Staden. Det fungerar i både Slap mode och Look mode. Under ⚙ More finns **My slaps in this
room**: dina klibbor med bild och tid, nyast först. Peka på en (eller tryck) så lyser den upp i
rummet, **✕** tar bort just den, och **Peel all** tar bort alla dina (tryck två gånger för att
bekräfta). Du kan bara peela dina egna: när du stämplar får din enhet en hemlig nyckel för just den
klibban (servern sparar bara en hash av den, och den syns aldrig för andra). Nycklarna sparas i
webbläsaren, så byter du enhet eller rensar webbläsaren kan du inte längre peela de gamla.
Admin kan fortfarande ta bort allt. Andra som är i rummet ser att klibban försvinner direkt.

**Bara de senaste 20:** du kan peela dina **20 senaste** klibbor i varje rum (*You can peel your
last 20 slaps in this room*). Äldre sitter kvar för gott (bara admin kan ta bort dem). Servern
sparar bara peel-nycklar för de 20 senaste per person och rum (person = en slumpad id för
enheten, `klibb.device`, annars IP-adressen; bara en hash sparas och den visas aldrig), och
webbläsaren sparar bara 20 per rum. *Peel all* peelar alltså högst 20.

**Snabb peel:** trycker du Z/↩ så fort du kan peelas klibban på skärmen direkt (med ljud), och
anropen till servern slås ihop: högst ett anrop åt gången, med allt som hunnit peelas under
tiden. Svarar servern att en klibba inte gick att peela (för gammal) eller blir det fel på nätet,
kommer den tillbaka på väggen.

**Slap mode och Look mode (V):** du börjar i *Slap mode*: den genomskinliga pekaren visar var
klibban hamnar och ett klick stämplar. Tryck **V** (eller knappen *Look mode*) när du vill kliva
tillbaka och beundra väggen: pekaren och siktet försvinner (kvar är bara en liten prick), klick
stämplar inte och scroll/Q/E gör ingenting. Gå och titta som vanligt. **R** byter fortfarande
design i Look mode, men du stannar kvar där tills du trycker **V** igen. Längst ner i bild står
vilket läge du är i. V fungerar inte medan du skriver i ett textfält, och Ctrl+V (klistra in)
växlar inte läge.

**Första eller tredje person (C):** tryck **C** (eller *3rd person* under ⚙ More, eller 👤 på
mobilen) för att se din egen gubbe bakifrån, över axeln. Kameran följer mjukt, dras in mot gubben
när en vägg är i vägen (den går aldrig genom väggen) och gubben göms om kameran kommer för nära.
Siktet i mitten gäller precis som vanligt: strålen går från kameran genom siktet och räknas från
gubben och framåt. När du slappar slår gubben handen mot väggen i samma bildruta som klibban syns
(upp på 25 ms, en kort tryckning, sedan ner igen på ~320 ms), och vid peel griper den klibban.
Valet sparas på enheten. Förstapersonsläget är precis som förut (ingen hand syns). De andra i
rummet ser din gubbe slappa och peela i båda lägena: klienten skickar sitt rums-id (`by`) med
slappen/peelen och servern skickar det vidare i `stamp:add`/`stamp:remove` (äldre klienter
bryr sig inte om fältet). Matten finns i `client/src/chasecam.js` och rörelsen i
`client/src/slapanim.js` (tester: `tests/thirdperson.test.mjs`).

**Vem gjorde klibban? (Look mode):** klicka på en klibba (pricken siktar) så syns en liten
etikett bredvid pricken med konstnärens namn och länk, t.ex. *Ulla K · @ulla.k · Instagram*. Ingen
hover: att bara titta på klibban visar ingenting. Klick på en annan klibba byter etikett; klick på
tom vägg, Esc eller att lämna Look mode döljer den. Tryck **L** eller klicka på samma klibba igen: musen släpps och en liten ruta (*Open this link?*) visar
hela adressen; **Open** öppnar den i en ny flik (`rel="noopener noreferrer"`). På mobilen: tryck på
klibban i Look mode, så syns etiketten där du tryckte med en länk du kan trycka på. Klibbor utan namn
och länk visar ingenting. Ditt namn och din länk ställer du in under ⚙ More (*Your artist name* och
*Your link*): skriv `@namn` (blir Instagram) eller en instagram/x/tiktok/youtube- eller annan
`https://`-länk. Namnet och länken sparas med varje klibba du sätter (och kommer med i
inspelningar). Servern tvättar dem (`shared/artistlink.mjs`, samma regler i webbläsaren): bara
`https://` (http blir https), inga `javascript:`/`data:`-länkar, ingen inloggning, IP-adress eller
port i länken, högst 200 tecken; namnet högst 60 tecken. En ogiltig länk sparas inte alls.

**Byta design med R:** har du laddat upp flera klibbor växlar **R** till nästa (efter den sista
börjar det om på den första). Rutan längst ner i mitten visar vilken design som är vald, till
exempel *2/4*. Vill du sätta samma klibba många gånger trycker du bara inte på R.
Dina uppladdade designs sparas i webbläsaren och finns kvar när du laddar om sidan, så länge
servern har kvar bilderna. Designs som har försvunnit från servern tas bort ur listan automatiskt.

**På mobilen:** ladda upp en bild i menyn och fäll ihop menyn med **☰**. Styrspaken nere till
vänster tar dig framåt, **dra med fingret** för att titta och **tryck** där du vill stämpla.
Den **runda knappen nere till höger** visar vald design: tryck på den för att byta till nästa.
**↩** peelar (ångrar) din senaste klibba. **Ögat 👁** bredvid slår på Look mode (pekaren försvinner och tryck stämplar inte, designknappen
dämpas); tryck på ögat igen för att klibba.
Välj *Lägg till på hemskärmen* i webbläsarens meny, så öppnas den som en app.

### Tillsammans: gubbar, chatt och live-klibbor

Alla som är i samma rum ser varandra. Varje besökare är en liten gubbe med namnskylt ovanför
huvudet; den går när personen går och står och väger när den står still. Du ser dig själv bara
inifrån (förstapersonsvy), men i **🧍 My avatar** (under ⚙ More) finns en förhandsvisning.

- **Klibbor syns direkt:** när någon stämplar, peelar eller när admin tar bort något ser alla i
  rummet det på en gång, utan att ladda om. Samma sak när rummets utseende ändras.
- **Vem är här:** i menyn står *3 here right now* och en lista med namnen (grön prick = ansluten).
- **Chatt:** på datorn trycker du **T** eller **Enter**, skriver och trycker **Enter** för att
  skicka (**Esc** stänger). På mobilen trycker du på **💬**. Meddelandet syns i chatten med namn och
  tid, och en stund som en pratbubbla ovanför din gubbe. Medan du skriver går det inte att gå
  eller stämpla med tangenterna (WASD, V, R, Z, Q och E skrivs bara in i texten).
  De senaste 50 meddelandena finns kvar så länge någon är i rummet; de sparas aldrig på disk.
  Max 300 tecken per meddelande och en spärr mot spam (ungefär ett meddelande varannan sekund).
  Inget filter: det är fritt fram.
- **🧍 My avatar:** välj namn, kläder (Hoodie, T-shirt, Suit, Vest), frisyr (Short, Fringe,
  Long, Slicked back, Mohawk), färg på tröja, byxor och hår, hudton och keps. Gubben snurrar i en
  förhandsvisning medan du väljer (dra för att vrida). **Save** sparar den på den här enheten och
  de andra ser den direkt. **🎲 Random** ger en slumpad gubbe. Första gången får du en slumpad.
- **Namn på namnskylten:** det namn du väljer i My avatar syns för alla direkt när du sparar (och
  när du kommer in igen). Har du inget namn där används ditt artistnamn, annars heter du *Guest 1*,
  *Guest 2* … (servern delar ut numren, så två i samma rum får aldrig samma gästnamn, och ingen kan
  välja ett gästnamn själv). Namn rensas från osynliga tecken och dubbla mellanslag och får vara
  högst 24 tecken. Byter någon namn står det i chatten (*Guest 1 is now Ulla*), och *joined* /
  *left* visar alltid det namn personen har just då.
- **Inmålade klibbor (prestanda):** bara de nyaste klibborna (de 30 senaste i rummet plus mina egna
  peel-bara) är egna 3D-objekt. Äldre "målas in" i väggarna: de slås ihop till några få stora meshar med
  alla designer i en gemensam texturlista, så ett rum med tusentals klibbor kostar bara ett par ritanrop.
  Ritordning, vikning, utskurna kanter och ljus är som förut (`client/src/stamps.js`). Taket är
  `MAX_STAMPS_PER_ROOM` (3000): då försvinner den äldsta tyst. Mät: `node tools/bench-stamps.js`.
- **✨ Clear hidden stickers (Room ▾, skaparen/admin, även i demon):** tar bort alla klibbor som är helt
  dolda bakom nyare (≥ 98 % av klibbans synliga, utskurna yta täcks av nyare klibbor, räknat på ytan med
  vridning, vikning över kanter och utskurna kanter; `shared/coverage.mjs`). Först en lugn fråga med antalet
  (*Remove 322 hidden stickers? Visible ones stay.*). Det som syns ligger kvar i samma ordning och storlek
  och blir rummets nya botten: peel-historiken nollställs för alla (gamla peel-nycklar slutar gälla), så
  allt kan målas in. `GET /api/rooms/:rum/hidden` (antal) och `POST /api/rooms/:rum/clear-hidden` (gör det,
  i ett låst steg; alla får `room:clear-hidden`). Samma rätt som *Reset room*. *Reset room* finns kvar som förut.
- **Automatisk städning av dolda klibbor:** när en klibba lämnar peel-historiken (ingen kan peela den
  längre, se de 20 senaste per person ovan) kollar servern strax efteråt (samlat, ~1,5 s, högst 8 s)
  bara de klibborna: är en helt dold (samma regel) tas den bort, sparas och skickas som vanlig
  `stamp:remove` (`quiet: true`, utan ljud). Synliga och de som någon fortfarande kan peela ligger kvar.
  Loggas som `[auto-prune] room …: checked N, removed M`. Stängs av med `AUTO_PRUNE_HIDDEN=0` (`server/hidden.js`).
- **Fullt rum:** högst 10 gubbar per rum (`MAX_PLAYERS_PER_ROOM`). Den elfte ser rummet, alla
  gubbar och chatten, men kan inte skriva och syns inte, och kommer in automatiskt när någon går.
- **Tappar du anslutningen** (mobilen byter nät, servern startar om eller Render vaknar) kopplar
  appen upp sig igen av sig själv: först efter en halv sekund, sedan längre och längre, som mest
  10 sekunder. När den är tillbaka hämtar den rummet igen så att du ser det du missat.
- Gubbarna stör aldrig stämplandet: klibbor hamnar på väggen bakom en person, inte på personen.

**Rum:** under **Room ▾** i menyn finns **＋ New quick room** (skapar ett eget rum med en kort kod, t.ex.
`/?room=k7m2qx`), **🔗 Share link** (kopierar länken, eller öppnar dela-menyn på mobilen) och
**🏙 Back to the City**. Högst upp i bild står vilket rum du är i. Ett nytt rum är alltid helt tomt.

Det finns tre sorters rum:

| Typ | Vad | Sparas |
|---|---|---|
| **Staden** (`stad`, på sidan *The City*) | Det gemensamma rummet där alla hamnar | Alltid, rensas aldrig |
| **Snabbrum** (*Quick room*) | Vem som helst kan skapa ett, inget konto behövs | Raderas automatiskt när ingen har varit där på 24 timmar |
| **Profilrum** (*Profile room*) | Hör till en användare (förberett, konton finns inte än) | Sparas, rensas aldrig av städningen |

Man kan också skriva ett eget namn: `/?room=jens`. Det blir då ett snabbrum.

**Städningen:** servern går igenom rummen en gång i timmen och tar bort snabbrum som ingen
har besökt på `QUICK_ROOM_TTL_HOURS` timmar. Ett besök räknas när någon öppnar rummet,
stämplar där, eller har sidan öppen (appen säger till var tionde minut). Designs (bilderna)
tas inte bort, de kan finnas i andras menyer och rum.

### Inspelning och kameror (för poddar och filmer)
Den som skapade rummet (eller admin; i Staden bara admin) ser **🎬 Recording** under ⚙ More.

- **● Start recording / ■ Stop recording:** servern spelar in allt som händer i rummet: utseendet,
  klibborna (även de som sätts och peelas), kamerorna, vilka som är där, hur deras gubbar ser ut,
  var de står och åt vilket håll de tittar (även upp och ner), och chatten. **Röst spelas inte in**
  (rösten kommer i nästa steg, och då med ett eget ljudspår per person).
- **● REC** syns uppe till höger för **alla** i rummet så länge det spelas in, och chatten säger
  när inspelningen startar och stoppas. Den som kommer in mitt i en inspelning får en ruta:
  *This room is being recorded*. (Ett riktigt samtycke, där var och en godkänner, kommer med kontona.)
- **Gränser:** högst 2 timmar och 32 MB per inspelning (stoppas av sig själv), högst 4 rum
  samtidigt, och står rummet tomt i 5 minuter stoppas inspelningen. Se `REC_MAX_*` nedan.
- **🎥 Place camera here:** ställer en virtuell kamera där du står, åt det håll du tittar
  (*Camera 1, 2 …*). I listan kan du byta namn, bildvinkel (35–90°) och format (fritt, 16:9
  liggande eller 9:16 stående för Reels), **⤓** flyttar kameran dit du står nu, **✕** tar bort den.
  Kamerorna sparas med rummet och syns för alla som små röda kameror (inte i Look mode; kan
  stängas av med *Show cameras in the room*).
- **👁 Titta genom kameran:** skärmen visar exakt det kameran ser, med svarta kanter för 16:9
  och 9:16, så att du kan ställa in bilden. **Esc** (eller *Back*) = tillbaka.
- **Inspelningar:** under *Recordings* i ⚙ More finns de som gjorts i rummet. **▶** öppnar
  uppspelaren (`/?room=<rum>&replay=<id>`): spela/pausa (mellanslag), spola (←/→ = 5 s),
  hastighet 0,5–4×, och välj vy: **fri kamera** (dra för att titta, WASD = gå), **en placerad
  kamera** eller **någons ögon** (POV). **⏺ Record video** gör en färdig video (se nedan).
  Länken till en uppspelning kan delas: id:t är slumpat och går inte att gissa.
- **🎬 Director (auto-regissör) och munnar:** medan ● REC pågår loggas hur högt var och en pratar
  (0–15, aldrig ljudet, bara när mikrofonen är på; den är av från början). I uppspelningen rör sig
  gubbarnas munnar med flit dåligt och glitchigt i takt med talet, och vyn *🎬 Director* klipper
  själv mellan närbild, halvbild och över axeln på den som pratar, och rummet när det är tyst.
  *🎬 Shot list* laddar ner bildlistan (JSON med tider, talare och vinkel) för klippning; vyerna
  *Close-up / Medium / Over the shoulder: <namn>* ger separata tagningar. Rösten finns **inte** med
  i videorna (den går direkt mellan webbläsarna). Se `docs/recording-format.md`.
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
- **🎲 Random** ger en kod på fem tecken, t.ex. `k7m2q`. Samma kod ger alltid samma rum, så du
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
│       ├── together.js     ← andra spelare, chatten och My avatar
│       ├── avatars.js      ← gubbarna: modellen, kläder/färger, namnskylt, gå/stå
│       ├── cameras.js      ← virtuella kameror: modellen i rummet, titta genom, 16:9/9:16-ram
│       ├── replay.js       ← uppspelaren (?replay=): spela, spola, vy, spela in video
│       ├── boot.js         ← väljer uppspelaren eller själva rummet
│       ├── strings.js      ← ALL text som besökaren ser (engelska; förberett för fler språk)
│       ├── sound.js        ← ljuden: slap och peel (Web Audio, rumsljud för andras klibbor)

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

### Färdiga videor: logga-intro, kanallogga, länkar och e-post

**⏺ Record video** i uppspelaren gör en färdig video (`client/src/videocomposer.js`):

1. **Logga-introt först.** Allt ritas i en egen inspelningsduk: först introt (Jens animerade
   logga, `client/public/intro/`, ca 2,8 s), sedan uppspelningen. Bildens form väljer fil:
   16:9, 9:16 eller 1:1 (webm/VP9 där det går, annars mp4). Introts ljud (`sat-intro-ljud.wav`)
   blandas in med WebAudio, så videon har ljud från början.
2. **Kanallogga (gratisversionen).** Uppe till höger sitter en liten halvgenomskinlig
   "slap and talk"-logga som en gammal tv-kanals logga: Jens S2-klistermärke (`bug-s2.png`),
   lite mjuk, med skugga, svag fasning och tunna scanlines, ritat i koden.
3. **Diskreta länkar (gratisversionen).** Längst ner glider en liten rad in ibland, t.ex.
   "slapandtalk.com · make your own room", ca 4 s var 20–30:e sekund. **Texterna och tiderna
   ändras i `shared/video.json`** (`ticker.lines`).
4. **Uppladdning och länk.** När inspelningen är klar laddas videon upp
   (`server/videos.js`) och man får en fast länk, `/v/<id>`: en enkel sida med videon,
   *Download* och *Copy link*. Filen ligger på `/v/<id>/file` (med range requests, så man kan spola).
   Videorna syns också under sin inspelning i *Recordings* i ⚙ More.
5. **E-post med länken.** Är e-post påslagen (`RESEND_API_KEY` + `MAIL_FROM`) visas
   *Email me the link*: servern skickar ett kort engelskt mejl i ren text (ingen spårning) via
   Resend. Adressen sparas inte. Utan nyckel döljs fältet och man får *Copy link* och en tydlig
   uppmaning att spara länken.

Fullversionen (`cleanVideo`) får videor utan kanallogga och utan länkraden; introt är alltid med.

**Lagring:** `videos/<rum>/<id>.webm` (eller `.mp4` från Safari) + `videos/<rum>/<id>.json`, och
`videos/_index/<id>.json` så att länken hittar videon utan rummet. Allt ligger utanför `rooms/`
och `recordings/`, så **videon finns kvar när demorummet raderas efter en timme**. Videor sparas
`VIDEO_RETENTION_DAYS` dagar (standard 30) och städjobbet tar bort äldre. Uppladdningen strömmas
till en temporär fil och vidare till R2, så den tar inte minne på Render (max `VIDEO_MAX_MB`,
standard 80 MB, högst 2 samtidigt, 4 per minut och 20 per timme per IP).

**Så får Jens e-posten att fungera:**
1. Skapa ett konto på [resend.com](https://resend.com) och lägg till domänen (t.ex. `slapandtalk.com`).
2. Resend visar några DNS-poster (SPF/DKIM, ev. MX för en underdomän). Lägg in dem hos
   Porkbun (DNS) och vänta tills Resend säger *Verified*. Slå inte på open/click tracking.
3. Skapa en API-nyckel (Sending access) och sätt i Render → Environment:
   `RESEND_API_KEY=<nyckeln>`, `MAIL_FROM=Slap and Talk <video@slapandtalk.com>` och
   `PUBLIC_URL=https://slapandtalk.com` (länken i mejlet). Starta om (Manual Deploy).

## Fullversionen (entitlements)

Grundversionen är ett lugnt, komplett klistermärkesrum: vanliga färger på gubben, egna (unika)
standardljud och en diskret rumsakustik. Fullversionen lägger till de djupa menyerna ovanpå:
**tyger** på gubben (`fabrics`), **Sound settings** med synth och effekter (`soundDesign`) och
**superstora klibbor** större än 1 m, utan övre gräns (`bigStickers`; servern krymper större
gratisklibbor till 1 m) och **färdiga videor utan kanallogga och länkrad** (`cleanVideo`).
Allt sitter i en gemensam abstraktion, `entitlements.full.<funktion>` (server/entitlements.js och
client/src/entitlements.js), så nya saker (t.ex. ljus) blir bara ett namn till i `FEATURES`.
Standard är `false` för allt. Alla ser och hör andras tyger och ljud; bara att *skicka* egna kräver
flaggan, och servern stryker/nekar tyg- och patchdata från den som inte har den.

**Så slår Jens på fullversionen för sig själv (produktion, t.ex. Render):**

1. Hitta på en hemlig nyckel (minst 12 tecken, `A–Z a–z 0–9 _ . ~ -`), t.ex. `openssl rand -hex 16`.
2. Lägg den i miljövariabeln `FULL_ACCESS_KEYS` på servern (Render → Environment). Flera nycklar
   separeras med komma. `nyckel` ensam låser upp allt; `nyckel:fabrics+bigStickers` bara de uppräknade
   (funktioner: `fabrics`, `soundDesign`, `bigStickers`, `cleanVideo`).
3. Öppna `https://<sajten>/?unlock=<nyckel>` en gång i webbläsaren. Nyckeln sparas i den
   webbläsaren (localStorage `klibb.unlock`) och tas bort ur adressfältet. `?unlock=off` glömmer den.

**Utveckling/test:** med `DEV_UNLOCK=1` på servern räcker det att sätta
`localStorage.setItem('klibb.devUnlock', '1')` i webbläsaren. Flaggan ignoreras när servern inte har
`DEV_UNLOCK=1` (sätt den aldrig i produktion). E2E-testerna kör med `DEV_UNLOCK=1`.

### Betala för fullversionen: Lemon Squeezy (steg för steg, för Jens)

Fullversionen säljs som **"betala vad du vill", minst 1 dollar**, via **Lemon Squeezy** (LS). LS är
*merchant of record*: de säljer i sitt namn och sköter moms i hela världen, kort, PayPal, Apple Pay och
Google Pay. Köparen får en **licensnyckel** (i kvittomejlet, och direkt tillbaka till sajten). Nyckeln
fungerar precis som de manuella nycklarna ovan, och de manuella (`FULL_ACCESS_KEYS`: Jens, Marika,
Chattis …) fortsätter fungera som förut.

I appen finns bara en diskret rad **★ Full version** längst ner i ⚙ More → Help. Den öppnar en lugn
panel med vad fullversionen ger, en knapp till kassan och fältet **I have a key**. Inga popupper, inga
låsta knappar som retas, och inget alls i demoprofilen (`DEMO_PROFILE=1`) om du inte sätter `SHOW_BUY=1`.
Raden syns bara när `LS_CHECKOUT_URL` är satt (och för den som redan har fullversionen, så man kan se
sin status).

**1. Skapa butiken**
1. Gå till <https://app.lemonsqueezy.com/register> och skapa ett konto. Fyll i butiksnamn (t.ex.
   *Slap and Talk*), valuta **USD**.
2. Under **Settings → Payouts** kopplar du ditt bankkonto, och LS ber dig styrka vem du är. Tills
   butiken är godkänd kan du testa allt i **Test mode** (strömbrytaren nere till vänster).
3. Notera **Store ID**: **Settings → Stores**, siffran vid butiken. → `LS_STORE_ID`

**2. Skapa produkten**
1. **Store → Products → + New product**. Namn: *Slap and Talk – Full version*. Kort beskrivning, t.ex.
   "Fabrics, sound design and big stickers. Pay what you want."
2. **Pricing**: välj **Single payment** och slå på **Pay what you want**. **Minimum price: 1.00**,
   **Suggested price: 5.00**.
3. **Generate license keys**: slå på. **Activation limit: Unlimited** (eller t.ex. 5).
   **License length: Unlimited** (aldrig utgång). Servern aktiverar bara en gång per nyckel (inte per
   webbläsare), så en gräns på 5 räcker gott.
4. **Confirmation modal → Button link** (knappen efter betalningen) och **Receipt → Button link**
   (knappen i kvittomejlet): skriv
   `https://slapandtalk.com/?thanks=1#unlock=[license_key]`
   (LS byter `[license_key]` mot köparens nyckel). Knapptext t.ex. *Back to Slap and Talk*. Då låses
   fullversionen upp direkt när köparen klickar. Delen efter `#` skickas aldrig till någon server, så
   nyckeln hamnar inte i några loggar. (Godtar LS inte `#`, använd `?thanks=1&unlock=[license_key]`.)
5. **Publish**. Notera **Product ID** (siffran i adressen när produkten är öppen, eller under
   **⋯ → Copy ID**). → `LS_PRODUCT_ID`
6. **Share** på produkten → kopiera **checkout-länken** (den med `/checkout/buy/…`, inte en `?cart=`-länk).
   → `LS_CHECKOUT_URL`. Appen lägger själv till `checkout[custom][src]=app`, så du ser i LS vilka köp
   som kom från appen.

**3. Webhooken** (så återbetalningar och avstängda nycklar slår igenom direkt)
1. **Settings → Webhooks → +**.
2. **Callback URL**: `https://slapandtalk.com/api/ls/webhook`
3. **Signing secret**: hitta på en hemlig sträng (6–40 tecken), t.ex. `openssl rand -hex 20`.
   → `LS_WEBHOOK_SECRET`
4. **Events**: kryssa i **order_created**, **order_refunded**, **license_key_created** och
   **license_key_updated**. Spara. (Servern kollar `X-Signature` mot hemligheten och svarar 401 på allt annat.)

**4. Miljövariabler på Render** (Dashboard → tjänsten → **Environment**, sedan **Manual Deploy**)

| Variabel | Värde | Behövs |
|---|---|---|
| `LS_STORE_ID` | butikens id (siffra) | ja |
| `LS_PRODUCT_ID` | produktens id (siffra) | ja – bara nycklar till just den här produkten i just den butiken låser upp |
| `LS_CHECKOUT_URL` | checkout-länken från Share | ja – utan den syns ingen köpknapp |
| `LS_WEBHOOK_SECRET` | samma hemlighet som i webhooken | ja – utan den svarar webhooken 503 |
| `LS_API_KEY` | – | **behövs inte**: licens-API:t (validera/aktivera) kräver ingen nyckel |
| `LS_REVALIDATE_HOURS` | standard `24` | valfri: hur ofta en betald nyckel kollas mot LS igen (i bakgrunden) |
| `LS_ACTIVATE` | standard på | valfri: `0` = aktivera aldrig nycklar i LS (bara validera) |
| `SHOW_BUY` | `1` | valfri: visa ★ Full version även i demoprofilen |
| `ADMIN_TOKEN` | finns redan | för räknaren nedan |

**5. Testa** (i LS Test mode): köp med testkortet `4242 4242 4242 4242`, klicka på knappen efter
betalningen → sajten öppnas med "Thank you!" och fullversionen på. Eller klistra in nyckeln från
kvittot i ⚙ More → ★ Full version → *I have a key*. Gör en återbetalning i LS → nyckeln låses
(webhooken). Byt till Live mode när du är klar: test- och live-produkter har olika id, så uppdatera
`LS_PRODUCT_ID` och `LS_CHECKOUT_URL` (och skapa webhooken i live-läget också).

**Hur det funkar i servern** (`server/licenses.js`): nyckeln valideras med
`POST https://api.lemonsqueezy.com/v1/licenses/validate`; den måste vara giltig, ha status
active/inactive, höra till `LS_STORE_ID` + `LS_PRODUCT_ID`, och ordern får inte vara återbetald.
En nyckel som aldrig använts aktiveras **en gång** (`instance_name=slapandtalk.com`), så den syns som
använd i LS. Svaret sparas i minnet och i lagringen (R2) som `entitlements/<sha256(nyckel)>.json`
(bara utslag och id:n, aldrig nyckeln eller mejladressen) och ordrar i `ls-orders/<order-id>.json`.
Ligger LS nere gäller det sparade svaret, så ingen som betalat blir utelåst. Nycklar loggas aldrig.

**Räknare för admin** (inga nycklar, bara antal):
```bash
curl -H "x-admin-token: $ADMIN_TOKEN" https://slapandtalk.com/api/admin/entitlements
# {"paidActive":12,"paidLocked":1,"manualKeys":3,"lemonSqueezy":true,"checkout":true}
```

### Ljud: synth, effekter och rumsakustik

Alla ljud (slap, peel, nope, fotsteg, "duff" när ett baksidespapper landar) är JSON-patchar
(`shared/synth.mjs`) som spelas av en liten synthmotor byggd på **Tone.js** (MIT, laddas först
när ljudet startar, så första sidladdningen är lika lätt). En patch = upp till 4 lager: oscillator
(sine/square/saw/triangle, detune, unison, sub) eller brus (vitt/rosa), ADSR, LP/HP/BP-filter med
cutoff, Q och filterenvelope, tonhöjdssvep, LFO (tonhöjd/cutoff/volym), nivå och drive.
Effekter: reverb (decay, pre-delay, wet), delay (tid eller synk 1/4, 1/8, 1/8d, 1/16, 1/4t,
feedback ≤ 0,95, wet, ping-pong), filter, bitcrush och distortion – per spelare och per ljud.

- **Gratis:** varje spelare får en egen, diskret variant av standardljuden (frö i
  localStorage `klibb.soundSeed`, skickas med gubbens look – andra hör *din* variant utan extra
  trafik). Rummets material ger automatiskt lite akustik: kakelväggar lite reverb, betonggolv
  mycket diskret, övrigt torrt (`roomAcoustics`, max 12 % wet). Inga menyer.
- **Fullversionen (`soundDesign`):** ⚙ More → Sound settings… – en synthpanel per ljud plus
  Effects, med Preview, Randomize, Wild, Reset. Sparas i webbläsaren (`klibb.sound`) och skickas
  med looken; servern klämmer alla värden och stryker patchar från den som saknar flaggan.
- Duff: volym och tonhöjd följer pappersytan (`duffScale`: större = högre och mörkare).
- Testerna: `tests/synth.test.mjs` och `tests/e2e-synth.js` (renderar alla patchar med
  `Tone.Offline` och kollar att de hörs och inte klipper).


### Startstorlek från filnamnet (A_, B_, … Z_)
En bokstav först i bildens filnamn bestämmer klibbans **starthöjd**: höjd = 5 cm + bokstavens nummer × 2,5 cm,
alltså `A_` = 5 cm, `B_` = 7,5 cm, `C_` = 10 cm … `Z_` = 67,5 cm. Utan prefix: 10 cm (som C).
- **Regel:** EN bokstav A–Z (stor eller liten) allra först i filnamnet, sedan `_`, `-` eller mellanslag, sedan
  en bokstav eller siffra: `A_katt.png`, `b-katt.png`, `C katt.png`. *Inte* prefix: `Apple.png`, `A.png`,
  `A - katt.png` (formen "Konstnär - titel"), `A__katt.png`, `AB_katt.png`. Koden: `shared/sizeprefix.mjs`
  (samma i webbappen, servern och `tools/import-library.mjs`).
- **Höjd, inte längsta sida:** en liggande bild (t.ex. 2:1) med `D_` blir 12,5 cm hög, alltså 25 cm bred
  (storleksreglaget visar längsta sidan). Gratisversionens 1 m gäller fortfarande; ingen annan gräns.
- **Var:** uppladdningar (webbappen skickar filnamnet, servern sparar `startCm` på bilden; samma bild igen
  med ett annat prefix får den nya höjden), biblioteket (`startCm` i `library/manifest.json`; varje import
  räknar om den även för redan importerade ur originalnamnet `source`, och `--sizes` gör bara det).
  Prefixet räknas inte in i konstnärens namn (`B_Ulla - katt.png` → Ulla). Filnamnet visas ingenstans.
- **R/F och skalning:** varje gång du byter design (R/F, paletten, ny uppladdning) börjar den på sin egen
  höjd. Sedan skalar du fritt som förut (hjulet, reglaget) tills du byter design igen; byter du tillbaka
  börjar den om på sin starthöjd (den skalade storleken sparas inte per design).

## Demo profile (the free version, DEMO_PROFILE=1)

One switch on the server turns the app into the free demo. Nothing is deleted: turn it off and
uploads, room editing, the full version, the City etc. are all back.

**Render env vars (the web service):**

| Variable | Value | Notes |
|---|---|---|
| `DEMO_PROFILE` | `1` | Required. Unset (or `0`) = the normal app. |
| `DEMO_ROOM_MINUTES` | e.g. `60` | Optional, default 60. How long a room lives. |

`MAX_PLAYERS_PER_ROOM` is ignored in the demo (always 5). Keys in `FULL_ACCESS_KEYS` and
`DEV_UNLOCK` unlock nothing while the demo is on. Storage vars (`STORAGE`, `S3_*`) stay as they are.

What changes (shared/demo.json holds the numbers):
- **Name first.** "What's your name?" before anything loads; remembered per device. Each new person gets a random avatar; *My avatar* is hidden.
- **Library only.** The palette is the curated library (`library/`), R/F browse it. `POST /api/stickers` → 403; no Instagram tag field. The artist comes from the library, so Look mode shows it on click.
- **Rooms.** Opening the site creates your own room with the empty preset (tiles, concrete, classic ceiling); no style picker, no room editing, no sound settings, no placing cameras, no City. The room's creator can still **● REC** (and make videos with the 🎬 Director from the replay); recordings are deleted with the room, so make the video before the hour ends. *New quick room* goes straight into a new empty room.
- **Invites.** Max 5 per room and 5 members. Nobody gets in without an invite: each member can make one single-use link (✉ Invite a friend). Asking again re-shares the same unused link; once it is used, that member cannot invite again. The server keeps only hashes (of the room key, member keys and invite tokens). Members get a member key in their browser, so reloads and new tabs get back in. Extra tabs of a member beyond 5 players watch.
- **One hour.** A quiet timer at the top; a calm note at 5 minutes. At the end everyone sees "This room has closed", the sockets close (code 4010, no reconnect) and (after any running recording is stopped) the room JSON (stamps, peels) and `recordings/<room>/` are deleted from storage. `videos/` is never touched. A sweep at start-up and every 5 minutes catches rooms that expired while the server was down.
- **Voice.** 🎙 (or B) – off by default, asks for the microphone on the first press, then mutes/unmutes. Browser-to-browser (WebRTC mesh) through the existing signal relay, public STUN only (no TURN: some strict networks cannot connect). Voice also works outside the demo.

**Sticker library import** (runs locally, then commit `library/`):

```
node tools/import-library.mjs <folder> [--csv artists.csv] [--artist "Name"] [--replace] [--dry-run]
node tools/import-library.mjs --sizes   # only re-derive start heights (A_ … Z_) for what is already imported
```

Images: png, jpg, jpeg, webp, gif, avif, tiff. Artist per image, first match wins: the CSV
(`file,artist[,link]`, file relative to the folder), else the subfolder name (`<folder>/Ulla K/star.png`),
else the file name (`Ulla K - star.png` or `ulla_k__star.png`), else `--artist`. Each image is
re-encoded like uploads (WebP, max 1024 px) and gets a content-hash id; duplicates are skipped.
`--replace` starts from an empty library (otherwise new ones are added). The server seeds `library/`
into storage at start-up. `node tools/make-placeholder-library.mjs` rebuilds the 6 placeholders.

Tests: `npm run test:demo` (starts its own demo servers on 8817/8818).

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
| `VIDEO_RETENTION_DAYS` | `30` | Hur länge färdiga videor (`videos/`) sparas; städjobbet tar bort äldre |
| `VIDEO_MAX_MB` | `80` | Största video som får laddas upp |
| `RESEND_API_KEY` | – | Resend-nyckel för *Email me the link* (hemlig; utan den: bara *Copy link*) |
| `MAIL_FROM` | – | Avsändare, t.ex. `Slap and Talk <video@slapandtalk.com>` (domänen verifierad i Resend) |
| `PUBLIC_URL` | sajtens adress | Adressen i videolänkar och mejl, t.ex. `https://slapandtalk.com` |
| `MAX_PLAYERS_PER_ROOM` | `10` | Hur många gubbar som får vara i ett rum samtidigt (fler kan titta) |
| `MAX_STAMPS_PER_ROOM` | `3000` | Högst så många klibbor per rum. En ny slap över taket tar tyst bort den äldsta (vanlig `stamp:remove`) |
| `AUTO_PRUNE_HIDDEN` | `1` | `0` = ingen automatisk städning av helt dolda klibbor när de lämnar peel-historiken (*Clear hidden stickers* fungerar ändå) |

**Slå på Cloudflare R2 senare:** skapa en bucket och en API-token (Object Read & Write) i
Cloudflare, sätt `STORAGE=s3` och S3-variablerna ovan i Render, och starta om. Befintliga
klibbor på Render-disken flyttas inte automatiskt. En riktig databas för rummen kan senare
kopplas in genom att bara skriva om funktionerna i `server/store.js`.
