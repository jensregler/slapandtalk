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
(*＋ New quick room*, *🔗 Share link*, *🏙 Visit the City*), vilka som är här,
**⬆ Upload sticker**, dina designs, **Slap mode / 🌿 Nature / Look mode**, **Enter the room** och **⚙ More**.
Allt annat ligger under **⚙ More**: storlek, rotation, slumpvridning och artistnamn, *My slaps in
this room* (historiken och peel), vilka som är här och **🧍 My avatar**, rummets utseende
(*🎨 Change room look*), ljud, **🎬 Recording** med kamerorna, och hjälpen. På mobilen öppnas
⚙ More som ett ark nerifrån (styrspaken göms så länge), ✕ stänger. More stängs av sig själv när
du går in i rummet.

**På datorn:** klicka på *⬆ Upload sticker*, välj en bild och klicka på *Enter the room*.
Gå med **W A S D**, titta med musen och **klicka** för att stämpla (*slap*). Scrollhjulet ändrar storlek
(från 15 cm upp till 1 m i grundversionen; i fullversionen, `bigStickers`, från 5 cm och ingen övre gräns, inte ens
rummet – reglaget går till 4 m, hjulet längre. Storleken gäller klibbans längsta sida. Klibbor som redan sitter
uppe får behålla sin storlek). Den första klibban du håller **börjar 30 cm hög** (oavsett format; en bred blir
bredare än 30 cm), sedan behåller den storleken du har när du byter klibba (R/F, hjulet, paletten, en ny uppladdning)),
**Q/E** vrider klibban, **R** byter till nästa design, **F** till förra, **V** växlar mellan Slap mode och 🌿 Nature mode, **G** slår på/av Look mode, **M**
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

**Slap mode och 🌿 Nature mode (V; Jens 28 okt 2026):** du börjar i *Slap mode*. **V** växlar till
*Nature mode*: du håller en nature-klibba (den du hade senast, annars den första på Nature-hjulet),
Nature-hjulet blir aktivt. **V** igen = tillbaka till klibban du hade på klibbhjulet.
Att välja ur Nature-hjulet/🌿-listan ger också Nature mode, att välja ur klibbhjulet Slap mode. Nature
hör till fullversionen: i gratisversionen öppnar V (och panelens 🌿-knapp) fullversionspanelen och du
stannar i Slap mode. Demot har inga nature-klibbor: där är V kvar som Look mode. *Nature mode har inget
eget ljud:* det procedurella naturljudet (vind, löv, fåglar) togs bort 29 okt 2026 på Jens begäran.

**Look mode (G, förr V):** tryck **G** (eller knappen *Look mode*) när du vill kliva
tillbaka och beundra väggen: pekaren och siktet försvinner (kvar är bara en liten prick), klick
stämplar inte och scroll/Q/E gör ingenting. Gå och titta som vanligt. **R** byter fortfarande
design i Look mode, men du stannar kvar där tills du trycker **G** (eller V) igen. Längst ner i bild står
vilket läge du är i. V/G fungerar inte medan du skriver i ett textfält, och Ctrl+V (klistra in)
växlar inte läge.

**Första eller tredje person (C):** tryck **C** (eller *3rd person* under ⚙ More, eller 👤 på
mobilen) för att se din egen gubbe bakifrån, över axeln. Kameran följer mjukt, dras in mot gubben
när en vägg är i vägen (den går aldrig genom väggen) och gubben göms om kameran kommer för nära.
Siktet i mitten gäller precis som vanligt: strålen går från kameran genom siktet och räknas från
gubben och framåt. När du slappar slår gubben handen mot väggen i samma bildruta som klibban syns
(upp på 25 ms, en kort tryckning, sedan ner igen på ~320 ms), och vid peel griper den klibban.
**Framifrån (selfie):** tryck **C** en gång till (eller *Front 🤳* under ⚙ More; 👤 på mobilen
växlar 1:a → 3:e → framifrån → 1:a) så står kameran framför dig och tittar tillbaka – du ser din
gubbe framifrån och kan titta in i kameran. 📷/P tar då en selfie (sparas med `view: 'front'`).
Siktet räknas som vanligt från gubben och utåt längs kamerans blick, så klibbor hamnar på väggen bakom dig
(den kameran tittar mot). Valet sparas på enheten. Förstapersonsläget är precis som förut (ingen hand syns). De andra i
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
börjar det om på den första). **Klibbhjulet** längst ner (dator; `client/src/wheel.js`, matten i
`shared/wheel.mjs`) visar klibborna som R/F går igenom (din palett, eller biblioteket i demon) som ett
runt hjul utan slut: efter den sista kommer den första igen, åt båda hållen. Den du håller sitter i
mitten med full mättnad, rak och överst (med *2/4* ovanför); utåt tappar de 30 % mättnad per steg
(70 %, 40 %, nästan grått längst ut), lutar mer och mer (medurs till höger, moturs till vänster) och
hamnar bakom varandra. Varje klibba har en liten tät skugga rakt nedanför. R/F, mushjulet/styrplattan
över hjulet, dra i det eller klicka på en klibba vrider det (klickar aldrig fast en klibba). Mobilen:
svep klibbhögen åt sidan (eller hjulet självt) så kommer hjulet upp ovanför högen och följer fingret;
det går undan en stund efter. Svep upp/ner på högen = nästa/förra som förut.
**Två hjul: Nature + klibbor (28 okt 2026):** till VÄNSTER sitter **Nature-hjulet** (bibliotekets 80
nature-klibbor ur Dropbox `/Ulla/nature`, samma utseende och beteende: färgtrappa, ~9 synliga, mitten 2×,
förladdning, skugga), till HÖGER klibbhjulet med allt annat (inga nature-klibbor där, inte heller i All
stickers – de har en egen lista **🌿 Nature (80)**). **Aktivt hjul** = det den hållna klibban kommer från:
klick/tryck/vridning på ett hjul (eller ett val ur dess lista) gör det aktivt; R/F, högens svep och högen
följer det aktiva. Mobilen: två band sida vid sida (Nature till vänster). **Betalvägg:** Nature-hjulet hör
till fullversionen (`entitlements.full.natureStickers`, ny flagga i `FEATURES`). I gratisversionen är det
gråtonat och låst (🔒 Nature · Full version); ett klick (eller ett val i 🌿-listan) öppnar fullversionspanelen
och inget hålls. Servern svarar 403 `{ full: true, feature: 'natureStickers' }` på nature-stämplar och -rader
utan flaggan (admin undantagen). Test: `tests/e2e-naturewheel.js`.
**Hela biblioteket på hjulet (28 okt 2026):** hjulet, R/F och mobilens hög innehåller för alla (inte bara i
demon) dina egna uppladdningar först och sedan hela biblioteket (`/api/library`, manifestordning). Har du inga
egna håller du bibliotekets första. Hjulet visar bara ~9 åt gången (mitten + högst 4 per sida,
`WHEEL.sideMax`), resten kommer fram när du vrider, och en bild laddas först när den syns. Mitten är **dubbelt
så stor** (`WHEEL.centerScale` = 2), grannarna som förut. Bilderna 8 klibbor bortom de synliga åt varje håll
hämtas i förväg, så ett snabbt svep inte visar tomma platser.
**Alla klibbor i panelen och klibbboken (28 okt 2026):** under dina egna (`#tray`) ligger **All stickers (N)**
(`#lib-box`/`#libtray`): hela biblioteket i samma ordning som på hjulet (utom det du själv har laddat upp),
lata miniatyrer; ett tryck håller den. På mobilen ligger listan öppen i 📒 Stickers. Förut nådde man
biblioteket bara genom att vrida hjulet / svepa högen, och boken visade bara de egna – därför såg det ut som
att bara några få klibbor fanns.
**Skugga på klibban du håller:** ljus uppifrån, så en tät mjuk skugga rakt under (på en vägg en bit
nedanför, på golv/tak rakt under) – klibban ser ut att sväva. Den följer vridning och storlek och syns
i 1:a person, 3:e person/kameror och i inspelningar/videor (`StampPreview`, `HELD_SHADOW` i
`client/src/stamps.js`); på mobilen under klibban i hållaren. Uppsatta klibbor har ingen skugga. Vill du sätta samma klibba många gånger trycker du bara inte på R.
Dina uppladdade designs sparas i webbläsaren och finns kvar när du laddar om sidan, så länge
servern har kvar bilderna. Designs som har försvunnit från servern tas bort ur listan automatiskt.

**På mobilen (touch):** när du kommer in syns bara **styrspaken** nere till vänster och din
**klibbhög** nere till höger (dina klibbor, den du håller överst). Ingen panel, ingen ☰ Stickers,
inga 👤/↩/👁-knappar. Styrspaken = gå, **titta** = dra med ett eller två fingrar när du inte håller någon klibba (med en klibba i handen siktar ett finger och två fingrar nyper/vrider den).
- **Tryck på högen** → menyn fäller ut sig uppåt/åt vänster: **📒 Stickers** (klibbboken: dina
  klibbor + ⬆ Upload sticker; stjärna/× med långt tryck som förut), **🧍 Character** (Min gubbe),
  **🏠 Room** (rummets namn och Room ▾ – nytt snabbrum, dela länk, Staden … – överst i ⚙ More, med
  inspelning för rummets skapare, ljud, kameror, hjälp), **↩ Undo** (menyn står kvar, så du kan
  ångra flera), **👤 3rd person**, **📷 Photo**, och kortet **💬 Talk / 🎙 Mic**. Tryck utanför =
  stäng. **Svep upp/ner på högen** = nästa/förra klibba direkt i handen.
- **Redigeringsvyn (Jens bild 4):** klibban i handen svävar skarp mitt på skärmen (ingen streckad ring runt den sedan 28 okt 2026).
  **Två fingrar = nyp och vrid (29 okt 2026, i stället för de två lodräta reglagen):** nyp isär/ihop =
  större/mindre (avståndet mellan fingrarna × storleken den hade), vrid = rotera (fingrarnas vinkeländring,
  medurs = medurs), direkt på klibban i handen, med en liten etikett ovanför ("45 cm · 15°"). Samma
  gränser och samma storlek som överallt (gratis 15–100 cm, full 5 cm – inget tak, nature 5–400 cm);
  storleken följer med när du byter klibba. Ett nyp klibbar aldrig och vrider inte rummet; ett andra
  finger medan du siktar avbryter siktet. Utan klibba i handen tittar två fingrar runt som förut. De tre
  menyknapparna **📒 🧍 🏠** lyser längst ner mellan styrspaken och högen; allt annat är dolt
  (💬/🎙 ligger på menyns Talk-kort).
- **Klibba (28 okt 2026):** med en klibba i handen **siktar ett finger på rummet**: klibban visas på
  väggen där fingret pekar (strålen från fingrets punkt, som en stämpel du håller framför dig) och
  följer fingret; rummet vrider sig inte. **Släpp = klibban sitter där fingret är** – ett tryck, ett
  långt tryck eller efter att du dragit. En klibba som redan sitter under fingret följer inte med.
  Ett andra finger avbryter (då nyper/vrider du i stället, ingen klibba). Du kan fortfarande släppa den ur hållaren
  (tryck på den = mitt på skärmen, eller dra ut den och släpp). Inget markeras, scrollar eller zoomar.
- **Ingen Slap mode / Look mode på mobilen** – en timer i stället (`shared/heldtimer.mjs`):
  en nyvald klibba är skarp tills du satt den första gången; efter varje klibba syns den
  `HELD_VISIBLE_MS` = 2 s (29 okt 2026, förut 10 s) och tonar sedan bort på `HELD_FADE_MS` = 1 s.
  De 2 s räknas från senaste **beröring**: varje tryck/drag på skärmen, siktet, nyp/vrid, storlek/rotation
  och hjulet startar om dem, så den tonar bara bort när den lämnats helt orörd i 2 s (aldrig medan ett
  finger siktar eller nyper). Bortonad = tom hand: ett finger tittar runt (tryck på en klibba visar vem
  som gjorde den). **Ett tryck på skärmen tar tillbaka den** (nya 2 s) – det trycket klibbar aldrig.
  Varje ny klibba startar om de 2 s. Om ett fingers pointerup tappas (iOS) räknas skärmen som tom när
  sista fingret lyfts, så klibban fastnar aldrig skarp.
- **Datorn har samma timer sedan 29 okt 2026** (Jens: "klibborna ska fejda efter ett par sekunder", i Slap
  mode och Nature mode): förhandsklibban vid siktet är skarp tills den satts första gången, sedan 2 s efter
  varje klibb och tonar bort på 1 s. All input (musrörelse, tangent, scrollhjul, hållen knapp) startar om
  de 2 s, och en musrörelse tar även tillbaka en bortonad klibba. Ett klick medan den är bortonad klibbar
  ändå (siktet visar var; ett "uppätet" klick kändes trasigt på datorn) och tar tillbaka den. Look mode (G) finns kvar som förut.
- 💬- och 🎙-bubblorna uppe till höger syns bara när de behövs (olästa meddelanden, mikrofonen på).
Koden: `client/src/stackmenu.js` (+ CSS under *Touch layout* i `style.css`). Datorlayouten är oförändrad.
Välj *Lägg till på hemskärmen* i webbläsarens meny, så öppnas den som en app.

### Tillsammans: gubbar, chatt och live-klibbor

Alla som är i samma rum ser varandra. Varje besökare är en liten gubbe med namnskylt ovanför
huvudet; den går när personen går och står och väger när den står still. Du ser dig själv bara
inifrån (förstapersonsvy), men i **🧍 My avatar** (under ⚙ More) zoomar rummets kamera in på din egen gubbe.

- **Klibbor syns direkt:** när någon stämplar, peelar eller när admin tar bort något ser alla i
  rummet det på en gång, utan att ladda om. Samma sak när rummets utseende ändras.
- **Vem är här:** i menyn står *3 here right now* och en lista med namnen (grön prick = ansluten).
- **Chatt:** på datorn trycker du **T** eller **Enter**, skriver och trycker **Enter** för att
  skicka (**Esc** stänger). På mobilen trycker du på **💬**. Meddelandet syns i chatten med namn och
  tid, och en stund som en pratbubbla ovanför din gubbe. Medan du skriver går det inte att gå
  eller stämpla med tangenterna (WASD, V, G, R, Z, Q och E skrivs bara in i texten).
  De senaste 50 meddelandena finns kvar så länge någon är i rummet; de sparas aldrig på disk.
  Max 300 tecken per meddelande och en spärr mot spam (ungefär ett meddelande varannan sekund).
  Inget filter: det är fritt fram.
- **🧍 My avatar:** välj namn, kläder (Hoodie, T-shirt, Suit, Vest), frisyr (Short, Fringe,
  Long, Slicked back, Mohawk), färg på tröja, byxor och hår, hudton och keps. Inget litet
  förhandsfönster: rummets kamera ställer sig framför din egen gubbe och zoomar in så att den fyller
  skärmen bredvid panelen (till vänster om den på datorn, ovanför på mobilen) – stor och tydlig.
  Gubben vänder sig långsamt lite fram och tillbaka mot kameran; dra (mus eller ett finger) för att
  snurra den hela varvet. Allt du väljer (kläder, frisyr, färger, tyger) syns direkt på den. Står du
  nära en vägg flyttar kameran till en sida med plats (aldrig genom väggen). Resten av HUD:en göms
  medan panelen är öppen (`client/src/avatarview.js`). **Save**/**Cancel** = vanliga kameran igen. **Save** sparar den på den här enheten och
  de andra ser den direkt. **🎲 Random** ger en slumpad gubbe. Första gången får du en slumpad.
- **Ansiktet (Face):** ansiktet har ett eget material, skilt från kroppen (framsidan och sidorna av huvudet, från
  pannan till hakan och bakåt förbi öronen – även näsans sidor, så att hudens tyg aldrig lyser igenom
  bredvid ett ansiktsfoto; `client/src/face.js`). Raden *Face* (efter *Skin*) har färgrutor, **Same as skin**
  (standard: ansiktet följer hudens färg och hudens tyg) och **valfri färg** (färgväljaren). Med
  *Colour | Fabric* får ansiktet ett tyg precis som tröjan (dina klibbor, senaste tyger, mönster, egen
  bild) eller ett **🙂 Face photo**: bildens mittersta kvadrat läggs en gång över ansiktet (ögonen ca
  42 % från toppen, som i ett vanligt porträtt); *Zoom* och *Rotation* flyttar det, och modellens egna
  ögon/ögonbryn göms så länge fotot syns. Allt syns direkt på den inzoomade gubben, sparas med gubben,
  skickas till de andra i rummet (`look.face`, `look.fabric.face` med `photo: true`) och finns med i
  inspelningar och foton. Tyg/foto i ansiktet kräver samma behörighet som tyger på tröjan (fullversionen;
  öppet för alla medan OPEN_ACCESS är på); färgen är gratis.
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
- **Fullt rum:** gratisversionen har högst 4 i ett rum (`FREE_MAX_PLAYERS` i `server/entitlements.js`:
  fyra väggar, en var). Den femte ser rummet, alla gubbar och chatten, men syns inte, kan inte skriva
  eller prata och kan inte slappa (servern svarar 409 `full`), och kommer in automatiskt när någon går.
  `MAX_PLAYERS_PER_ROOM` kan bara sänka gränsen. Rummen har ingen betald nivå (fullversionen gäller
  per spelare), så gränsen gäller alla rum, även Staden. Admin (`x-admin-token`) begränsas inte.
- **Tappar du anslutningen** (mobilen byter nät, servern startar om eller Render vaknar) kopplar
  appen upp sig igen av sig själv: först efter en halv sekund, sedan längre och längre, som mest
  10 sekunder. När den är tillbaka hämtar den rummet igen så att du ser det du missat.
- Gubbarna stör aldrig stämplandet: klibbor hamnar på väggen bakom en person, inte på personen.

**Rum:** under **Room ▾** i menyn finns **＋ New quick room** (skapar ett eget rum med en kort kod, t.ex.
`/?room=k7m2qx`), **🔗 Share link** (kopierar länken, eller öppnar dela-menyn på mobilen) och
**🏙 Visit the City** (`/?room=stad`). Högst upp i bild står vilket rum du är i. Ett nytt rum är alltid helt tomt.

**Den vanliga adressen (`/`, utan `?room=`) tar dig till ditt senast använda rum**, inte till Staden
(`client/src/landing.js`, körs i `boot.js` före rummet). "Dina rum" = de rum den här webbläsaren har
en nyckel till (`klibb.roomKeys`: du skapade det; `klibb.memberKeys`: en inbjudan släppte in dig)
eller har öppnat (`klibb.rooms`: `{ rum: senaste besök }`, högst 100; Staden räknas inte). Servern
säger vilka som finns och när något senast hände där: `GET /api/rooms/recent?ids=a,b,c` (högst 50
id, svarar `{ rooms: [{ id, type, updatedAt }], missing: [...] }`, nyast först; `updatedAt` sätts
vid varje sparning av rummet: klibba, peel, utseende, kamera, besök, men inte av städjobben).
Rum som är borta (städade, ett utgånget demorum) hoppas över och glöms på enheten. Svarar inte
servern avgör det senaste lokala besöket. Inga rum alls → ett nytt snabbrum skapas direkt (som
*＋ New quick room* med standardutseendet). Adressen blir `/?room=<id>` med `history.replaceState`
(ingen omladdning, ingen loop). Inte när adressen redan har `?room=` (även `?room=stad`),
`?replay=` eller `?admin=` (admin landar i Staden som förut). **Demon** har sin egen regel (samma
idé): `/` (och `?room=stad`) går till ditt eget demorum eller skapar ett (`client/src/demo.js`).

Det finns tre sorters rum:

| Typ | Vad | Sparas |
|---|---|---|
| **Staden** (`stad`, på sidan *The City*) | Det gemensamma rummet som alla kan besöka (`/?room=stad`, *🏙 Visit the City*) | Alltid, rensas aldrig |
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
- **🎥 Auto cameramen:** kameror som ingen behöver placera (sparas som kameror `{ auto, start?, seq }`,
  så de kommer med i inspelningen). En simulerad fotograf går en bana ur rummets mått
  (`shared/room.json`): **Perimeter** runt rummet 1,1 m från väggarna, sakta längs mittersta
  tredjedelen av varje sida; **Diagonal sweep** hörn till hörn genom mitten; **Push-in** sakta in mot
  en vägg, stanna, backa till ett nytt ställe; **Loop** (bara med en startpunkt, se nedan). Takt:
  0,5–1,0 m/s när den går, 0,18–0,32 m/s när den komponerar, mjuka S-kurvor (≤ 0,45 m/s²), stannar
  1,4–3 s i hörnen, ögonhöjd 1,5–1,7 m, lite handhållen gungning, aldrig närmare en vägg än 0,6 m.
  Zoom 35–70 mm (fullformat), högst 10 mm per 4 s, går in mot väggytor med nya klibbor (30 s),
  panorerar ≤ 60°/s. Deterministisk: samma inspelning ger samma tagning (seed `recId:kameraId`).
  - **Gratis (det som släpps, även demon):** *⚙ More → 🎬 Recording → 🎥 Auto cameraman* är en enkel
    av/på-ruta. Exakt **en**, helt automatisk: seeden väljer banan, inga inställningar (servern
    tvingar `auto: 'seeded'`, stryker `start`, PUT → 403, en andra → 400). **I demon får rummets
    skapare slå på just den här** (att placera vanliga kameror är fortfarande avstängt där).
  - **Fullversionen (`multiCam`):** *＋ Add cameraman* och sedan ett klick i rummet (golvpunkten under
    siktet; klickar man på en vägg blir det 1 m ut från den) = där den börjar. Upp till **6**
    samtidigt (`MAX_AUTO_CAMS`, egen budget bredvid de 12 placerade kamerorna). Varje rad i listan har
    ett valfritt val *Automatic / Perimeter / Diagonal sweep / Push-in* (standard Automatic), 👁 och ✕.
    Banan ur startpunkten: *Automatic* med start = **Loop**, en rektangel runt mitten av kamerans
    område som går genom startpunkten (avståndet från starten till närmaste kant blir varvets
    avstånd in från kanten); en vald bana behåller sin form och börjar på den punkt av banan som är
    närmast klicket.
  - **Flera krockar aldrig:** rummet delas i en cell per fotograf (1 = hela rummet, 2 = halvor,
    3 = tredjedelar, 4 = 2×2, 5–6 = 3×2, längs den längre sidan), var och en går bara i sin cell, 0,6 m
    från cellgränsen, så två banor är alltid ≥ 1,2 m isär. De filmar ändå hela rummet (bara var de
    går delas upp, inte vart de tittar). Den med start får cellen där klicket var.
  - **Uppspelaren:** varje fotograf är en egen vy (*🎥 Auto cameraman 1 / 2 / …*), plus de generella
    *🎥 Auto cameraman: Perimeter / Diagonal sweep / Push-in*; med ingen som pratar startar
    uppspelningen på den första. 🎬 Director använder dem som rumsbild i tystnaderna, **i tur och
    ordning** (tystnad nr n → fotograf nr n bland dem som är på då), så klippet varierar; inga på →
    det fasta hörnet. Bildlistan har ett spår per fotograf (`autocam.crew`, se
    `docs/recording-format.md`). Live i rummet är det en förhandsvisning (börjar om varje hel timme,
    samma för alla); läggs en till delas cellerna om, så de andra byter bana live.
  - **Folket först (v3):** rummets fotografer siktar på deltagarna, inte på tomma väggar: så länge
    någon är i rummet ramar de in hela gruppen (mitten av dem, objektivet vidgas så alla får plats,
    22–70 mm); med ingen där går de tillbaka till väggarna/klibborna. Spåren finns kvar som
    **översiktsspår** (`autocam.crew`).
  - **🎥 Cameraman: \<namn\> (en per deltagare, i uppspelaren):** varje deltagare får en egen fotograf
    (`shared/personcam.mjs`) som föds när de kommer in och försvinner när de går (*(not here now)* i
    listan medan de är borta). Personen är alltid motivet: växlar mellan närbild (~1 m, 50 mm),
    halvbild (~1,9 m) och helbild (~3,1 m), och vinklar (framifrån, 3/4, från sidan, lite under/över),
    blir nyfiken (går närmare vid en klibba eller när de pratar, backar när de går), panorerar bara
    lite, håller sig ≥ 0,45 m från väggarna (kliver närmare/byter vinkel i hörn). Byten är mjuka
    glidningar eller rena klipp vid stora vinkelbyten. Alla spår går på inspelningens klocka, så man kan
    klippa mellan personerna i *#rp-view*-listan utan att tiden hoppar. Bildlistan: `autocam.people`.
  - **Klibbrörelsen syns i bild:** uppspelaren spelar nu armrörelsen (klibba/peel) på den filmade
    dockan, låst till inspelningens klocka (`stamp:add`/`stamp:remove` med `by`), så den syns i
    uppspelning, foton och videor; live syns ens egen docka när man tittar genom en kamera.
  Koden: `shared/autocam.mjs`, `shared/personcam.mjs`. Steg 2 (en smartare fotograf som följer det som händer) är en ny
  *target provider* där, se kommentaren överst i filen.
- **📷 Photo:** knappen 📷 bredvid 🎙/🔊 i panelen, 📷 i kamerarutan när man tittar genom en kamera,
  och **📷 Photo** i uppspelarens rad; tangenten **P** både live och i uppspelaren. Tar en stillbild av
  exakt det du ser (första/tredje person, en kamera, eller vilken uppspelningsvy som helst: Director,
  vinklar, fotograferna), renderad igen i ≥ 1920 px bredd (2× skärmen, högst 3840) utan
  gränssnittet (siktet, förhandsklibban och kameramodellerna döljs), med ett diskret slutarljud
  (tyst om ljudet är av) och en kort blixt. Den laddas ner direkt (`slapandtalk-<rum>-<ÅÅÅÅMMDD-hhmmss>.jpg`)
  och laddas upp till `photos/<rum>/<id>.jpg` (+ `.json`, `photos/_index/<id>.json`) med en egen
  delningslänk **`/p/<id>`** (id: 16 slumpade hex-tecken). Den listas bredvid videorna i 🎬 Recordings.
  Gratis för alla, även i demon; gratisbilder får samma lilla kanallogga som gratisvideor
  (`cleanVideo` tar bort den). Servern kodar om bilden (sharp: ingen EXIF, högst 4096 px), max
  `PHOTO_MAX_MB` (8), 6 per minut och 60 per timme per IP, högst 3 samtidigt. Bilderna sparas
  `PHOTO_RETENTION_DAYS` (standard = `VIDEO_RETENTION_DAYS`, annars 30) och ligger utanför `rooms/`
  och `recordings/`, så **de finns kvar när ett demorum stängs**. Koden: `client/src/photo.js`,
  `server/photos.js`.
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

### Preset-rum (Jens 29 okt 2026)

Jens designar rum med nature-klibborna och ger rumskoderna till Ulla. Ett **preset** görs av ett
befintligt rum och sparas som **sex bilder** (golv, tak och de fyra väggarna) i stället för klibbor:
rummets klibbor "bakas" in i bilderna (i webbläsaren, `client/src/preset.js`: varje yta renderas rakt
framifrån, bara klibborna, olysta, 160 px/m → väggar 1600×640, golv/tak 1600×1600, genomskinligt där det
inte sitter något) och rummets utseende (golv/vägg/tak) följer med.

- **Göra ett preset av en rumskod:** `ADMIN_TOKEN=… node scripts/make-preset.js <rumskod> --base https://slapandtalk.com --name "Skog"`
  (öppnar rummet som admin i en headless Chromium, bakar och sparar; token skrivs aldrig ut).
  `--list` visar dem, `--delete <id>` tar bort ett. Eller som admin i rummet: Room ▾ → *🧩 Save as preset room*.
- **Servern** (`server/presets.js`): `presets/<id>.json` + `presets/<id>/<yta>.webp` i lagringen.
  `POST /api/admin/presets` (multipart: de sex bilderna + `sourceRoom`, admin), `GET /api/admin/presets`,
  `DELETE /api/admin/presets/:id`, bilderna på `GET /api/presets/:id/<yta>.webp`.
- **Nya användare:** ett rum som skapas utan valt utseende (`POST /api/rooms {}`, alltså en ny användares
  första rum via `landing.js`) får ett slumpat preset: dess utseende + de sex bilderna. *＋ New quick room*
  med ett valt utseende får inget preset (inte heller `{ preset: false }`); `{ preset: "<id>" }` ber om ett visst.
  **Inga presets = allt som förut.**
- **I preset-rummet:** bilderna ligger som tunna, belysta lager över ytorna, under alla klibbor. De är inga
  klibbor: går inte att peela, flytta eller ta bort. Väggarna är låsta (ingen 🎨-knapp, `PUT style` → 403 för
  alla utom admin). Man kan fortfarande klibba egna klibbor ovanpå (och peela sina egna som vanligt).
  Repriser visar också bilderna. Tas ett preset bort tappar rum som redan fått det sina bilder.

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

> **OPEN ACCESS är PÅ just nu (29 okt 2026, medan Jens testar):** alla får allt, utan nyckel, och
> rutan "Full version", dess knapp i ⚙ More, 🔒 och "part of the full version" syns inte.
> Brytaren är EN rad: `shared/openaccess.mjs` → `export const OPEN_ACCESS = true;` (sätt `false`
> för att få tillbaka betalväggen), eller bara på servern: env `OPEN_ACCESS=0` på Render.
> Betalväggskoden nedan är orörd. Testa betalväggen med `OPEN_ACCESS=0 node tests/…`.

Grundversionen är ett lugnt, komplett klistermärkesrum: vanliga färger på gubben, egna (unika)
standardljud och en diskret rumsakustik. Fullversionen lägger till de djupa menyerna ovanpå:
**tyger** på gubben (`fabrics`), **Sound settings** med synth och effekter (`soundDesign`) och
**superstora klibbor** större än 1 m, utan övre gräns (`bigStickers`; servern krymper större
gratisklibbor till 1 m), **färdiga videor och 📷-bilder utan kanallogga och länkrad** (`cleanVideo`) och
**flera auto cameramen med klickad startpunkt och valfri bana** (`multiCam`, upp till 6) och
**obegränsat många egna uppladdade klibbor** (`uploads`; gratis = EN egen klibba bredvid det fria
biblioteket – en ny uppladdning ersätter den gamla med en kort toast, äldre sparade uppladdningar ligger
kvar på enheten men bara den nyaste visas; `shared/uploads.mjs`, regeln gäller i webbläsaren eftersom
uppladdningarna bor på enheten och det inte finns konton).
**Färg i rummet** (under `fabrics`: i rumsutseendet – ＋ New quick room / Change look – raden
"Färg": en egen bild över golv, väggar OCH tak, med tygets reglage: skala, rotation, nyans, cykla nyans,
snurra, rulla, färgen under genomskinliga delar och 🌀 Randomize; sparas i rummets utseende
`style.fabric`, så alla i rummet, inspelningar/replay och presets ser den; bilden går via
POST /api/fabrics; servern stryker den för gratisversionen; `client/src/fargui.js`, `roomstyle.js`;
**egen bild per yta**: raderna Golv, Väggar och Tak har var sin "🖼 Own image…" med samma uppladdning och
reglage, `style.surfFabric = { floor, wall, ceiling }` – en ytas egen bild går före Färg, Färg täcker
de andra ytorna, ett katalogval för ytan tar bort dess egna bild; e2e-surffab.js) och
**sin egen gubbe i preset-rum** (`ownAvatar`; gratis: i ett rum som fått en preset är man en slumpad
figur för just det rummet – kläder, hår, färger, hud/ansikte, namnet behålls – samma varje gång för samma
person i samma rum (frö = rum + enhets-id, `shared/randomlook.mjs`), och det är den de andra och
inspelningen ser. Min gubbe visar figuren med utseendet låst och en lugn rad om varför, namnet går att
ändra; den egna gubben ligger kvar sparad och är tillbaka i andra rum. Första anslutningen väntar (max 3 s)
på rumsinfon så att redan första hello bär figuren. Regeln gäller i webbläsaren, som uppladdningarna).
Allt sitter i en gemensam abstraktion, `entitlements.full.<funktion>` (server/entitlements.js och
client/src/entitlements.js), så nya saker (t.ex. ljus) blir bara ett namn till i `FEATURES`.
Standard är `false` för allt. Alla ser och hör andras tyger och ljud; bara att *skicka* egna kräver
flaggan, och servern stryker/nekar tyg- och patchdata från den som inte har den.

**Så slår Jens på fullversionen för sig själv (produktion, t.ex. Render):**

1. Hitta på en hemlig nyckel (minst 12 tecken, `A–Z a–z 0–9 _ . ~ -`), t.ex. `openssl rand -hex 16`.
2. Lägg den i miljövariabeln `FULL_ACCESS_KEYS` på servern (Render → Environment). Flera nycklar
   separeras med komma. `nyckel` ensam låser upp allt; `nyckel:fabrics+bigStickers` bara de uppräknade
   (funktioner: `fabrics`, `soundDesign`, `bigStickers`, `cleanVideo`, `multiCam`, `natureStickers`, `uploads`, `ownAvatar`).
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

#### Fotstegs-groove: alla fotsteg i en gemensam takt

`shared/groove.mjs` (rutnätet) + `client/src/groove.js` (schemaläggningen). Alla i rummet går på
**samma takt** (en "bar" på 420 tick). Varje plats i rummet (samma slot som ger ljudet dess färg)
har en egen polyrytm på takten: slot 0 = 4 steg per takt, 1 = 3, 2 = 5, 3 = 6, 4 = 7, förskjutna så
att de **aldrig** landar på samma tick (minsta avstånd 5 tick ≈ 18 ms vid 1,0×). Går flera samtidigt
fyller de varandras luckor: ett groove. Ett steg hörs bara medan gubben går; tiden kommer från
rutnätet, inte från steglängden. Ingen extra nätverkstrafik: varje webbläsare räknar ut takten från
klockan (rättad med serverns klocka, `now` i WebSocket-välkomnandet) och rummets groove-läge.
Stegen schemaläggs 120–400 ms framåt på AudioContext-klockan (inte setTimeout). Höger/vänster fot
skiljer sig en aning i tonhöjd.

- **Skala (Groove):** en siffra för hela rummet = taktens längd, 1,0× = 1,5 s. Logaritmisk från
  **1/64×** (takten 23 ms: en 4-stegare var 6:e ms – stegen smälter ihop till en ton) till **8×**
  (takten 12 s: en 3-stegare var 4:e sekund). Allt sträcks tillsammans, förhållandena står kvar.
  Byte av skala behåller fasen (som en transport som byter tempo).
- **Var:** ⚙ More → Sound → **Groove**-reglaget (+ "1×" tillbaka), och tangenterna **[** (tätare/
  snabbare) och **]** (glesare/långsammare), en kvarts oktav per tryck, med **Shift** en hel oktav.
  På ett svenskt tangentbord är det tangenterna **Å** och **¨** (samma fysiska tangenter, ingen AltGr).
- **Vem:** rummets skapare (rumsnyckeln) **med fullversionen (`soundDesign`)**, eller admin; i
  Staden bara admin. Inte i demot. Andra ser varken reglaget eller får tangenterna att göra något.
- **Gratis:** alla hör rummets groove (stegen är alltid låsta till takten); i ett rum som ingen
  ändrat är det 1,0×. Står skalan inte på 1,0× syns en liten diskret skylt nere till vänster
  ("Groove 0.50×"). Inga köpknappar.
- **Snabba änden:** när en gubbes steg kommer tätare än 40 ms byts de mot en loopande "buzz"-röst
  (ett korn av stegljudet per puls, i takt med rutnätet). Fotstegen har en egen röstbudget
  (10 samtidiga) så de aldrig tränger undan slap-ljuden. Ingen bild-uppdatering (dold flik) = buzzen
  tystnar av sig själv.
- **Sparas och spelas in:** `PUT /api/rooms/:room/groove { scale }` → `room.groove = { scale, at,
  phase }`, händelsen `room:groove` till alla i rummet och i inspelningen (+ `groove` i huvudet).
  Uppspelningen vet skalan vid varje tidpunkt (`snapshotAt(...).groove`); fotstegsljud i replay och
  videor finns inte än.
- Testerna: `tests/groove.test.mjs` (rutnätet), `tests/groove.test.js` (rättigheter, broadcast,
  sparas, spelas in), `tests/e2e-groove.js` (reglage, tangenter, synk, stegen på rutnätet; port 8846).

#### Fotsteg på peels ("pillen", Jens 29 okt 2026)
Går man **på ett baksidespapper på golvet** (peels) låter steget som pappersprasslande filt: samma
fotsteg som vanligt (samma spelarvariation, slot-färg och groove-takt), men genom en liten insats
`lågpass → mjuk tanh-distorsion` (`shared/peelstep.mjs`, `SynthEngine.paper`). "Lite filter, lite
distorsion":
- **Lågpass** 330 Hz när man släntrar → 420 Hz när man springer (vanliga stegets brus ligger på
  520 Hz), Q 0,6, 12 dB/okt. Nivå ×0,9.
- **Distorsion** (WaveShaper, `tanh(k·x)`, k = 1 + 6·drive, enhetsförstärkning för svaga signaler så
  det inte blir starkare): drive 0,04 vid ≤ 0,6 m/s → 0,28 vid ≥ 4,7 m/s (Shift-spring), linjärt med
  gånghastigheten (gängse gång med tangenterna, 2,6 m/s ≈ 0,16). Ungefär 3 % → 12 % THD i stegets toppar.
- **Kontakt:** fötterna (kamerans x/z, de andras positioner) mot de **landade** papperen – en billig
  rektangeltest i papperets egen ram + 10 cm fotradie (`onPeel`, cirkel-avvisning först; 300 papper
  kostar inget). Gäller mig, de andra spelarna (rumsligt, som deras vanliga steg), dator och telefon.
  Ljud av = tyst som vanligt. Inget fullversionskrav (fotstegen är gratis); egna stegpatchar från
  Sound settings går också genom insatsen. Buzz-läget (groove så snabb att stegen blir en ton) och
  replay spelar vanliga steg.
- Testerna: `tests/peelstep.test.mjs` (hastighet → filter/distorsion, kurvan, THD, fot-testet) och
  `tests/e2e-peelsteps.js` (port 8879: av/på papperet med W, långsamt vs snabbt, den andra
  spelaren hör det, ljud av, telefon; renderar lyssningsprov till `PILL_STEPS`).

#### Auto-slap: stickern slappar av sig själv, i takt

`shared/autoslap.mjs` (sekvensen, tiden, schemat – samma i webbappen och testerna) +
`client/src/autoslap.js` (inställningar, sekvens-editorn, skylten, `tick()` varje bild) + `main.js`
(när den får skjuta, och själva slappen via den vanliga vägen `stampAt`). Med Auto-slap på slappar
den valda stickern vid hårkorset, steg för steg i en **sekvens**.

- **Var:** ⚙ More → Sound → **Auto-slap** (direkt under Groove): på/av, läge (**On the beat** /
  **Free rate**), takter (¼, ½, 1, 2, 4) eller hastighet, och **Sequence** med längd-väljaren (− [n] +).
  Ett klick på en ruta = steget på/av, Shift+klick = välj steget (raden under visar dess parametrar,
  t.ex. volym), mushjulet över en ruta = första parametern (volym). Skylten nere till vänster
  ("Auto-slap 2.7/s", "· paused") syns medan den är på.
- **Tangenter:** **H** på/av; **,** långsammare / **.** snabbare (Free rate: en kvarts oktav per tryck;
  On the beat: sekvensen ett steg kortare/längre). Kollat mot V, G, M, C, L, Q, E, R, F, Z, B, T, P och [ ].
  **Esc** stänger av den.
- **Sekvensen:** längd **1–32** (vilket heltal som helst, standard 8; utanför klämms den). Längre = nya
  steg med standardvärden; kortare = de dolda stegen sparas (alla 32 finns alltid) och kommer tillbaka.
  Rutnätet: upp till 8 i en rad, 9–16 i rader om 8, 17–32 två rader om 16 (tätare rutor).
- **Tid:** *On the beat* (standard): stegen delar rummets Groove-takt × takter, så `n` steg = n slag per
  takt, låst till samma rutnät som fotstegen (udda längder ger polyrytmer mot stegen) och följer
  Groove-skalan. *Free rate*: varje steg är 1/hastighet (0,25–8/s, logaritmisk; sekvensen ger loopen).
  Max **8/s** (minsta mellanrum 125 ms) i båda lägena; ett segt bildintervall skjuter det senaste steget
  en gång, aldrig en hög av missade.
- **Parametrar per steg = ett schema:** `STEP_PARAMS` i `shared/autoslap.mjs`
  (`on` bool, `vol` 0–100 int). Ny parameter = **en rad där**, t.ex.
  `x: { type: 'int', min: -50, max: 50, def: 0, label: 'X offset', short: 'x' }`: rensning, lagring,
  standardsteg och kontrollen i steg-raden följer av sig själva; sedan läser `autoFire(step)` i
  `main.js` `step.x`. Inget antar 8 steg.
- **När den skjuter:** bara i Slap-läge med pekarlås, på en yta inom räckhåll, med en vald design.
  Pausar (utan att ta igen steg) i Look-läge, menyer, chatten, stil-panelen, dialoger, kamera och dold
  flik. Av med Esc, när man lämnar rummet och vid 429 från servern. Aldrig i uppspelning. Står hårkorset
  still (< max(3 cm, ¼ av stickerns storlek) på samma yta) hoppas steget över.
- **Ångra:** en **skur** (från på/återupptagen tills paus/av/Z/200 stickers) = **ett** Z-steg. Klienten
  skickar `auto: true` och för steg 2… `join: { id, token }` (skurens första sticker); servern ger dem
  samma ångra-nyckel (`peelHash`, `group` = första) om token stämmer och skuren har < 200, och svarar
  `joined`. Räknas som ett av de 20 ångra-stegen per ägare.
- **Server-budget:** auto-slappar med fullversionen: 600/min per IP (10/s – 8/s plus luft för vanliga
  slappar); allt annat (vanliga slappar, `auto` utan fullversion) som förut 120/min.
- **Vem:** fullversionen (`soundDesign`, som Groove-skalan) eller admin. Inte i demot, inte på
  touch. Inställningarna (inte på/av) sparas i `localStorage` `klibb.autoslap`.
- **Inspelningar:** varje auto-slap är en vanlig `stamp:add` och syns i inspelningen.
- Testerna: `tests/autoslap.test.mjs` (hastighet, schema, längder 1/3/5/8/16/32, takt-låsning, klocka),
  `tests/autoslap.test.js` (skur = ett ångra-steg, fel token, gräns gratis/full, inspelning),
  `tests/e2e-autoslap.js` (H, längd 1–32 och rutnätet vid 32, pauser, Esc, ångra, räckhåll; port 8853).


### Sticker arrays: slap at A, hold, drag to B
Slap as usual, **keep the mouse button held** and turn toward B: see-through ghosts repeat the sticker
from A toward the crosshair, edge to edge. **Release** = all of them at once. **Esc**, **right-click**,
leaving the pointer lock or switching to Look mode while holding = no copies (A stays). A plain click is
exactly a slap, as before. **Desktop only**: on a phone a drag looks around (no long-press-drag yet).
- **Spacing** (`shared/array.mjs`, the same in the web app and the server): every copy has A's size and
  rotation, never turned to the drag direction. With d = the direction A→B on A's face in the sticker's
  own axes (du, dv): `step = min(w/|du|, h/|dv|)`, so straight across the step is the width, straight up
  the height, and on a diagonal the copies touch along one edge, like a staircase. Count =
  `floor(|AB| / step) + 1` (A included), at most **200**. B is where the crosshair's ray meets A's wall
  plane, so you can look past the wall's end. Copies whose centre falls off A's face aren't placed
  (no wrapping round corners); one whose centre is on the face but overhangs folds like any sticker.
- **Recordings** (28 Oct 2026): the row is in the recording while it is pulled out – the `held` line
  carries `a = { to }` (anchor + drag target, ~8/s; players only, cleaned, rate-limited, never relayed
  live), and the replay recomputes and draws the ghosts with `shared/array.mjs` in every view and the
  finished video, then the real stickers + papers at release. The avatar holds a drag pose (arm up,
  reaching for the row's end) through the drag – live on my own avatar (3rd person / cameras) and in
  replays – and swings back down when let go. Tests: `tests/e2e-arrayrec.js`, `tests/heldrec.test.mjs`.
- **Server:** `POST /api/rooms/:room/stamps/array` `{ anchor: { id, token }, to, nonce, by, peelFrom }`.
  The anchor is your own just-slapped sticker (its peel key proves it). The server recomputes the row
  from the saved anchor, so the size limits that hit A (free 15 cm–1 m) hold for every copy, and adds
  all copies in one locked step. Copies that would land on backing paper on the floor are skipped.
  Limits: 200 per drag, 30 drags and 1000 copies per IP and minute, the room cap of 3000 (oldest go),
  the demo's room/membership rules.
  Each copy goes out as an ordinary `stamp:add` (with `batch: { g, i, n }` and nonce `<nonce>x<i>`),
  so other players, recordings, replays and videos see it without changes; others hear one slap per row.
- **One peel step:** the copies share A's peel key and are saved with `group` = A's id. In this browser
  the row is one history entry (A + `extra` ids, shown as "×N"). **Z/↩ peels the whole row**; the
  history list's ✕ too. It counts as one of the 20 peelable steps, and leaves the history (then
  auto-prune/baking) as a whole. Z right after release (still on the way) takes the row and A at once.
- **Peels (backing paper):** A drops its paper as usual, plus one for each of the first 4 copies
  (5 at most per row) so a long row doesn't bury the floor.
- **Sound:** A's normal slap on the way down, then a short soft rattle (three quiet taps) on release.
- **Fallback** (arrays work in some browsers and not in others): whatever fails on the array path,
  a click is still exactly ONE sticker – the first one is an ordinary slap of its own. A click and
  release without a drag = one; starting the row, the ghosts or the release throwing = the row is
  dropped, the first sticker stays; `…/stamps/array` failing = the copies go, the first stays (404/405/
  501 = an older server: arrays off for the session, plain slaps); a browser that cannot lock the
  pointer at all (it never locked once) = a click slaps one where it lands. Clicks on the desktop
  sticker strip never slap or start a row. Tests: `tests/e2e-arrayfallback.js`.
- **Room limit:** `…/stamps/array` answers 409 `{ full }` like `…/stamps` (tests/roomlimit.test.js).
- **Demo:** works the same (not a paid control). Tests: `tests/array.test.mjs`, `tests/e2e-array.js`.

### Startstorlek från filnamnet (A_, B_, … Z_) – används inte längre av appen (se längst ner)
En bokstav och ett understreck först i bildens filnamn bestämmer klibbans **startstorlek**, alltså det värde
storleksreglaget visar (Esc → Size, klibbans längsta sida): storlek = 15 cm + bokstavens nummer × 2,5 cm,
alltså `A_` = 15 cm, `B_` = 17,5 cm, `C_` = 20 cm … `Z_` = 77,5 cm. Utan prefix: 30 cm (originalstorleken, som G_).
- **Regel:** EN bokstav A–Z (stor eller liten) allra först i filnamnet, sedan `_`, sedan en bokstav eller
  siffra: `A_katt.png`, `b_katt.png`. *Inte* prefix (får 30 cm): `b-katt.png`, `C katt.png`, `Apple.png`,
  `A.png`, `A - katt.png` (formen "Konstnär - titel"), `A__katt.png`, `AB_katt.png`. Koden:
  `shared/sizeprefix.mjs` (samma i webbappen, servern och `tools/import-library.mjs`).
- **Längsta sidan, för alla format:** en liggande bild med `D_` får 22,5 cm på reglaget, precis som en
  kvadratisk (för kvadratiska och stående bilder är det också höjden).
- **Gränser:** gratisversionen 15 cm – 1 m (både i webbappen – reglaget, hjulet, startstorleken – och på
  servern vid slap, där för små/stora gratisklibbor klämms till 15 cm / 1 m). Fullversionen (`bigStickers`):
  5 cm och uppåt, ingen övre gräns. Klibbor som redan sitter uppe behåller sin storlek.
- **Nature-klibbor (28 okt 2026, `shared/nature.mjs`; fullversionen, se Två hjul):** biblioteksklibbor vars namn börjar på `nature` (alla
  skiftlägen; importen ger varje fil i en mapp som heter `nature` det prefixet och `nature: true`) får för alla,
  även gratis: **minst `NATURE.minCm` = 5 cm, högst `NATURE.maxHeightCm` = 400 cm HÖG** (längsta sidan alltså
  400 cm × längsta/höjd, för en bred bild mer). Webbappen (reglage, hjul, slap, mobilens nyp) och servern
  (`POST …/stamps`, klämmer) gör samma sak; serverns tekniska golv 2 cm och NaN-kontrollen gäller fortfarande.
  **Inga peels:** nature-klibbor tappar inget baksidespapper alls (de blir för stora) – varken vid slap eller i
  en rad; servern skapar inget (`POST …/stamps`, `…/stamps/array`) och webbappen visar ingen pappersanimation.
  Bara kurerade biblioteksklibbor – en egen uppladdning som heter `nature…` får vanliga gränser.
  Tester: `tests/nature.test.mjs`, `tests/e2e-size.js`.
- **Var:** uppladdningar (webbappen skickar filnamnet, servern sparar `startCm` på bilden; samma bild igen
  med ett annat prefix får den nya storleken), biblioteket (`startCm` i `library/manifest.json`; varje import
  räknar om den även för redan importerade ur originalnamnet `source`, och `--sizes` gör bara det).
  Prefixet räknas inte in i konstnärens namn (`B_Ulla - katt.png` → Ulla). Filnamnet visas ingenstans.
- **R/F och skalning:** varje gång du byter design (R/F, paletten, ny uppladdning) börjar den på sin egen
  storlek. Sedan skalar du fritt som förut (hjulet, reglaget) inom gränserna tills du byter design igen;
  byter du tillbaka börjar den om på sin startstorlek (den skalade storleken sparas inte per design).

> **Ändrat 28 okt 2026 (Jens): prefixet sätter inte längre storleken i webbappen.** Den första klibban i en
> session börjar **30 cm hög** (höjden, oavsett format: en 2:1-bild får 60 cm längsta sida, en stående 30 cm),
> inom gränserna. Byter du klibba efter det (hjulet, R/F, svep, klibbboken, en ny uppladdning) behåller den
> storleken du hade, som före startstorlekarna; skala upp/ner fritt som vanligt (dator; mobilen: nyp).
> `startCm` och prefixreglerna ovan finns kvar (sparas på bilder och i `library/manifest.json`, `/api/library`
> skickar den) men används inte av appen. Serverns storlekskontroll vid slap är oförändrad (längsta sidan, 15 cm – 1 m
> i gratisversionen). Tester: `tests/e2e-size.js`, `tests/e2e-wheel.js`.

## Demo profile (the free version, DEMO_PROFILE=1)

One switch on the server turns the app into the free demo. Nothing is deleted: turn it off and
uploads, room editing, the full version, the City etc. are all back.

**Render env vars (the web service):**

| Variable | Value | Notes |
|---|---|---|
| `DEMO_PROFILE` | `1` | Required. Unset (or `0`) = the normal app. |
| `DEMO_ROOM_MINUTES` | e.g. `60` | Optional, default 60. How long a room lives. |

`MAX_PLAYERS_PER_ROOM` is ignored in the demo (always `FREE_MAX_PLAYERS` = 4). Keys in `FULL_ACCESS_KEYS` and
`DEV_UNLOCK` unlock nothing while the demo is on. Storage vars (`STORAGE`, `S3_*`) stay as they are.

What changes (shared/demo.json holds the numbers):
- **Name first.** "What's your name?" before anything loads; remembered per device. Each new person gets a random avatar; *My avatar* is hidden.
- **Library only.** The palette is the curated library (`library/`), R/F browse it. `POST /api/stickers` → 403; no Instagram tag field. The artist comes from the library, so Look mode shows it on click.
- **Rooms.** Opening the site creates your own room with the empty preset (tiles, concrete, classic ceiling); no style picker, no room editing, no sound settings, no placing cameras, no City. The room's creator can still **● REC**, switch on the one fully automatic 🎥 Auto cameraman (⚙ More → 🎬 Recording), and make videos with the 🎬 Director or the auto cameraman takes from the replay; anyone can take 📷 photos (P), which are kept like videos and survive the room; recordings are deleted with the room, so make the video before the hour ends. *New quick room* goes straight into a new empty room.
- **Invites.** Max 4 per room and 4 members (`FREE_MAX_PLAYERS`: the creator + 3). Nobody gets in without an invite: each member can make one single-use link (✉ Invite a friend). Asking again re-shares the same unused link; once it is used, that member cannot invite again. The server keeps only hashes (of the room key, member keys and invite tokens). Members get a member key in their browser, so reloads and new tabs get back in. Extra tabs of a member beyond 4 players watch.
- **One hour.** A quiet timer at the top; a calm note at 5 minutes. At the end everyone sees "This room has closed", the sockets close (code 4010, no reconnect) and (after any running recording is stopped) the room JSON (stamps, peels) and `recordings/<room>/` are deleted from storage. `videos/` is never touched. A sweep at start-up and every 5 minutes catches rooms that expired while the server was down.
- **Voice.** 🎙 (or B) – off by default, asks for the microphone on the first press, then mutes/unmutes. Browser-to-browser (WebRTC mesh) through the existing signal relay, public STUN only (no TURN: some strict networks cannot connect). Voice also works outside the demo.

**Sticker library import** (runs locally, then commit `library/`):

```
node tools/import-library.mjs <folder> [--csv artists.csv] [--artist "Name"] [--nature] [--replace] [--dry-run]
node tools/import-library.mjs --sizes   # only re-derive start heights (A_ … Z_) for what is already imported
```

Images: png, jpg, jpeg, webp, gif, avif, tiff. Artist per image, first match wins: the CSV
(`file,artist[,link]`, file relative to the folder), else the subfolder name (`<folder>/Ulla K/star.png`),
else the file name (`Ulla K - star.png` or `ulla_k__star.png`), else `--artist`. Each image is
re-encoded like uploads (WebP, max 1024 px) and gets a content-hash id; duplicates are skipped. Images in a
folder named `nature` (or with `--nature`) become nature stickers (`nature: true`, name prefixed `nature-`;
5 cm – 4 m high, see above; `nature` is never taken as the artist). The run also lists images without
transparency and very small (< 256 px) or very large (> 4000 px) originals.
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
| `PHOTO_RETENTION_DAYS` | = `VIDEO_RETENTION_DAYS` | Hur länge 📷-bilder (`photos/`) sparas |
| `PHOTO_MAX_MB` | `8` | Största bild som får laddas upp |
| `PHOTO_UPLOADS_PER_MINUTE` / `_PER_HOUR` | `6` / `60` | Bilduppladdningar per IP |
| `RESEND_API_KEY` | – | Resend-nyckel för *Email me the link* (hemlig; utan den: bara *Copy link*) |
| `MAIL_FROM` | – | Avsändare, t.ex. `Slap and Talk <video@slapandtalk.com>` (domänen verifierad i Resend) |
| `PUBLIC_URL` | sajtens adress | Adressen i videolänkar och mejl, t.ex. `https://slapandtalk.com` |
| `MAX_PLAYERS_PER_ROOM` | `4` | Hur många som får vara med i ett rum samtidigt (fler kan titta). Kan bara sänka gratisgränsen `FREE_MAX_PLAYERS` = 4 |
| `MAX_STAMPS_PER_ROOM` | `3000` | Högst så många klibbor per rum. En ny slap över taket tar tyst bort den äldsta (vanlig `stamp:remove`) |
| `AUTO_PRUNE_HIDDEN` | `1` | `0` = ingen automatisk städning av helt dolda klibbor när de lämnar peel-historiken (*Clear hidden stickers* fungerar ändå) |

**Slå på Cloudflare R2 senare:** skapa en bucket och en API-token (Object Read & Write) i
Cloudflare, sätt `STORAGE=s3` och S3-variablerna ovan i Render, och starta om. Befintliga
klibbor på Render-disken flyttas inte automatiskt. En riktig databas för rummen kan senare
kopplas in genom att bara skriva om funktionerna i `server/store.js`.
