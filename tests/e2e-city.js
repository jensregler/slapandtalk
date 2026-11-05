// The cities (t476u + t479u, 2 Nov 2026): screenshots to CITY_SHOTS (/workspace/city2-shots) + checks.
// A room → the door → 3 slaps in a pack → "to city →" → the city picker → start a city and NAME it →
// the city (houses start in order: door colours, "not yet", start house 1) → the Town Hall's pack shop
// (hand in with a description, take 2 = 3 packs, the big detail view) → Exit (no "back to my room") →
// the start card's Join list with the city's name → Exit to menu drops a free player's taken packs →
// a paying player (dev unlock) hands in for good and puts a taken pack in the deck (replace picker) →
// the shop on a phone. Own server (CITY_E2E_PORT, 8992).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.CITY_E2E_PORT || 8992);
const SHOTS = process.env.CITY_SHOTS || '/workspace/city2-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 900) : '')); } };
const ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const EXIT = 'a03b0ba5768979e6';
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1', ...(process.env.CITY_DATA_DIR ? { DATA_DIR: process.env.CITY_DATA_DIR } : {}) });
  const browser = await chromium.launch({ args: ARGS });
  const errors = [];
  const shot = (P, name) => P.screenshot({ path: path.join(SHOTS, name) });
  const look = (name, insta) => JSON.stringify({ name, look: { outfit: 'casual', hair: 'short', shirt: '#3a7bd5', pants: '#333333', hairColor: '#3b2a1a', skin: '#e0b48c', hat: false, hatColor: '#d33', insta } });
  const ready = (P) => P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
  const ids = (P, sel) => P.evaluate((s) => [...document.querySelectorAll(s)].map((b) => b.dataset.id), sel);
  try {
    // three other people hand in packs (straight to the API; a picture made from the bag) – one of them paid
    const lib = (await (await fetch(`${S.base}/api/library`)).json()).stickers.filter((d) => !d.nature);
    const bag = fs.readFileSync(path.join(__dirname, '../client/public/start/pac.webp'));
    const sharp = require('sharp');
    async function packPicture(stk) {
      const spots = [[70, 300], [270, 320], [150, 500]], layers = [];
      for (let k = 0; k < 3; k++) {
        const buf = Buffer.from(await (await fetch(S.base + stk[k].url)).arrayBuffer());
        layers.push({ input: await sharp(buf).resize(200, 200, { fit: 'inside' }).png().toBuffer(), left: spots[k][0], top: spots[k][1] });
      }
      return sharp({ create: { width: 563, height: 802, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([...layers, { input: bag, left: 0, top: 0 }]).webp().toBuffer();
    }
    // Kim's own stickers (uploads – not in anybody's deck yet), drawn here
    const own = [];
    for (const [k, col, txt] of [[0, '#ff4fa3', 'OWL'], [1, '#3ec6ff', 'NIGHT'], [2, '#ffd23e', '00:00']]) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><circle cx="200" cy="200" r="180" fill="${col}" stroke="#111" stroke-width="22"/><text x="200" y="${232 + k}" font-family="Arial Black,Arial" font-weight="900" font-size="${txt.length > 3 ? 84 : 120}" text-anchor="middle" fill="#111">${txt}</text></svg>`;
      const fd = new FormData(); fd.append('artist', 'Kim'); fd.append('file', new Blob([await sharp(Buffer.from(svg)).png().toBuffer()], { type: 'image/png' }), 'k.png');
      own.push(await (await fetch(`${S.base}/api/stickers`, { method: 'POST', body: fd })).json());
    }
    const others = [];
    const people = [
      ['Malmö crew', 20, 'Ulla', 'ulla.malmo', 'We are three friends from Möllan. These are the stickers we slap on every lamp post on the way home.', {}],
      ['Göteborg 🌊', 40, 'Sara', 'sara.gbg', 'Sea, gulls and a fish. Made on the ferry to Frederikshavn.', {}],
      ['Night owls', 70, 'Kim', '', 'Only slapped after midnight.', { 'x-dev-unlock': '1' }],
    ];
    for (const [name, k, author, insta, about, h] of people) {
      const stk = name === 'Night owls' ? own : lib.slice(k, k + 3);
      const fd = new FormData(); fd.append('name', name); fd.append('stickers', JSON.stringify(stk.map((d) => d.id)));
      fd.append('about', about); fd.append('author', author); fd.append('insta', insta);
      fd.append('img', new Blob([await packPicture(stk)], { type: 'image/webp' }), 'p.webp');
      others.push(await (await fetch(`${S.base}/api/city/packs`, { method: 'POST', body: fd, headers: h })).json());
    }
    check('three packs handed in by others: free ones a week, the paid one for good (open access is not "paid")',
      others[0].pack && Date.parse(others[0].pack.expiresAt) - Date.parse(others[0].pack.createdAt) === 7 * 864e5 && others[2].pack && others[2].pack.forever && others[2].pack.expiresAt === null && others[0].pack.about.startsWith('We are'),
      others.map((o) => o.error || [o.pack.expiresAt, o.pack.forever]));

    // ---- A (free): a room → the door → a pack → "to city →" → the city picker → start + name a city
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) })).json();
    const R = made.room.id;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await ctx.addInitScript(([r, k, l]) => { if (!localStorage.getItem('klibb.roomKeys')) { localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })); localStorage.setItem('klibb.avatar', l); } }, [R, made.roomKey, look('Jens', 'jensregler')]);
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push('A: ' + e.message));
    await P.goto(`${S.base}/?room=${R}`); await ready(P); await sleep(800);
    await P.evaluate(() => window.klibb.menuAction('door')); await sleep(300);
    await P.click('#menu-choice-list [data-id="enter-city"]'); await sleep(600);
    const picked = await P.evaluate(() => [...document.querySelectorAll('#df-grid .df-g')].slice(4, 7).map((b) => b.dataset.id));
    for (const id of picked) await P.click(`#df-grid .df-g[data-id="${id}"]`);
    await P.click('#df-next'); await sleep(900);
    await P.fill('#df-name', 'Jens pack');
    await P.click('#df-city');
    await P.waitForSelector('#film-ui:not([hidden]) #fu-skip', { timeout: 15000 }).catch(() => {}); // pt536u: the film first – skip it
    if (await P.isVisible('#fu-skip')) await P.click('#fu-skip');
    await sleep(900);
    let pk = await P.evaluate(() => window.klibb.city().pick);
    check('"to city →" opens the city picker (no city yet: start one)', pk.open && pk.step === 'list' && pk.cities && pk.cities.length === 0, pk);
    await shot(P, '01-city-picker-empty.png');
    await P.click('#cp-new'); await sleep(300);
    await P.click('#cp-go'); await sleep(200);
    const need = await P.textContent('#cp-msg');
    await P.fill('#cp-name', 'Slapville'); await sleep(200);
    await shot(P, '02-name-your-city.png');
    await Promise.all([P.waitForURL(/room=stad-[a-z0-9]{6}$/, { timeout: 20000 }), P.click('#cp-go')]);
    await ready(P); await sleep(2500);
    const CID = await P.evaluate(() => window.klibb.room);
    let c = await P.evaluate(() => window.klibb.city());
    check('a city needs a name; started → you walk into it (stad-<code>), its name in the HUD', /name/i.test(need) && c.outside && c.id === CID && c.info && c.info.name === 'Slapville' && (await P.textContent('#room-hud')) === 'Slapville', { need, c: { id: c.id, info: c.info } });
    check('the reduced wheel: my 3 stickers + exit + my pack', c.wheel.length === 5 && picked.every((id) => c.wheel.includes(id)) && c.wheel.includes(EXIT) && c.wheel.includes('city-pack'), c.wheel);
    check('houses start in order: no house yet – door 1 is the next one (yellow), the rest not yet (grey)', JSON.stringify(c.doorStates.filter((d) => d[0] !== 'hall')) === JSON.stringify([[1, 'next'], [2, 'later'], [3, 'later'], [4, 'later'], [5, 'later'], [6, 'later'], [7, 'later'], [8, 'later']]), c.doorStates);
    const pose = (Q, x, y, z, yaw, pitch) => Q.evaluate(([x, y, z, yaw, pitch]) => { const k = window.klibb; k.controls.ground = null; k.controls.collide = null; k.camera.position.set(x, y, z); k.controls.yaw = yaw; k.controls.pitch = pitch; k.controls.apply(); }, [x, y, z, yaw, pitch]);
    await P.evaluate(() => window.klibb.setView('first', { quiet: true }));
    await pose(P, -6, 15, 50, -0.12, -0.32); await sleep(900);
    await shot(P, '03-new-city-overview-doors.png');
    // a later house's door: not yet (houses start in order) – and a way to the next one
    await P.evaluate(() => window.klibb.cityDoor(3)); await sleep(400);
    const notYet = await ids(P, '#menu-choice-list > *');
    const notYetText = await P.textContent('#menu-choice-list [data-id="not-yet"]').catch(() => '');
    check('house 3\'s door: "not started yet – house 1 is next" (+ walk there)', JSON.stringify(notYet) === JSON.stringify(['not-yet', 'to-next', 'back']) && /house 1 is next/.test(notYetText), { notYet, notYetText });
    await pose(P, -33, 2.1, -18, 0.25, 0.05); await sleep(500);
    await shot(P, '04-house-not-started-yet.png');
    await P.click('#menu-choice-list [data-id="back"]');

    // ---- the Town Hall = the pack shop
    await P.evaluate(() => { const k = window.klibb; k.controls.ground = (x, z) => (Math.abs(x) <= 15.6 && Math.abs(z) <= 15.6 ? 0.5 : 0); k.camera.position.set(0, 2.1, 12); k.controls.yaw = 0; k.controls.pitch = 0; k.controls.apply(); });
    await sleep(300); await P.evaluate(() => { window.klibb.camera.position.set(0, 2.1, 8.9); }); await sleep(900);
    c = await P.evaluate(() => window.klibb.city());
    check('walking up to the Town Hall door opens the shop', c.hall.open && c.atDoor === 'hall', c.hall);
    await P.waitForFunction(() => window.klibb.city().hall.packs !== null, null, { timeout: 10000 }); await sleep(1200);
    const cards = await ids(P, '#th-grid .th-pack');
    check('the shop shows every pack (one shop for all cities), each with picture, name, author, 3 stickers, description', cards.length === 3 && await P.evaluate(() => [...document.querySelectorAll('#th-grid .th-pack')].every((c) => c.querySelector('.th-pimg') && c.querySelector('.th-pname').textContent && c.querySelectorAll('.th-stk img').length === 3 && c.querySelector('.th-about'))), cards);
    await shot(P, '05-shop-before-hand-in.png');
    await P.click('#th-handin'); await sleep(700);
    const form = await P.evaluate(() => ({ view: window.klibb.city().hall.view, name: document.querySelector('#hi-name').value, insta: document.querySelector('#hi-insta').value }));
    await P.fill('#hi-about', 'Hi, I\'m Jens from Malmö! These three are from my first room – the red one is my favourite. Slap them somewhere sunny.');
    await sleep(300);
    await shot(P, '06-hand-in-with-description.png');
    check('hand in: a form with my name and Instagram filled in, and a description', form.view === 'form' && form.name === 'Jens' && form.insta === 'jensregler', form);
    await P.click('#hi-go'); await P.waitForFunction(() => window.klibb.city().hall.mine, null, { timeout: 15000 }); await sleep(900);
    c = await P.evaluate(() => window.klibb.city());
    check('handed in: in the shop for a week (free), I may take 2', c.hall.mine && c.hall.mine.left === 2 && !c.hall.mine.forever && !c.hall.paid && c.hall.mine.about.startsWith('Hi, I\'m Jens') && c.hall.mine.author.insta === 'jensregler', c.hall.mine);
    await P.click(`.th-pack[data-id="${others[0].pack.id}"] .th-take`); await P.waitForFunction(() => window.klibb.city().taken.length === 1, null, { timeout: 10000 });
    await P.click(`.th-pack[data-id="${others[1].pack.id}"] .th-take`); await P.waitForFunction(() => window.klibb.city().taken.length === 2, null, { timeout: 10000 }); await sleep(900);
    c = await P.evaluate(() => window.klibb.city());
    const third = await P.evaluate((id) => { const b = document.querySelector(`.th-pack[data-id="${id}"] .th-take`); return { disabled: b.disabled, text: b.textContent }; }, others[2].pack.id);
    const carry = await P.textContent('#th-carry');
    check('free: take 2 → I carry 3 packs, 9 stickers (+ exit + pack) on the wheel; a 3rd take is refused', c.taken.length === 2 && c.wheel.length === 11 && third.disabled && /3 packs/.test(third.text) && /3 of 3/.test(carry), { taken: c.taken, w: c.wheel.length, third, carry });
    await shot(P, '07-shop-carrying-3-packs.png');
    await P.click(`.th-pack[data-id="${others[0].pack.id}"] .th-pname`); await sleep(800);
    check('a card opens the big view of the pack (description, Instagram link)', (await P.evaluate(() => window.klibb.city().hall.view)) === 'detail' && /@ulla\.malmo/.test(await P.textContent('#th-detail')));
    await shot(P, '08-shop-pack-detail.png');
    await P.click('#th-back'); await sleep(300); await P.click('#th-back'); await sleep(500);

    // the exit button outside: no "back to my room" (t479u point 4) – only Exit to menu
    await P.evaluate((x) => window.klibb.selectDesign(window.klibb.stickerDesigns().find((d) => d.id === x)), EXIT); await sleep(300);
    await P.evaluate(async () => { const k = window.klibb; k.controls.locked = true; await k.stampAt(0, 0); k.controls.locked = false; }); await sleep(400);
    const ex = await ids(P, '#menu-choice-list button');
    check('the exit button in the city: Exit to menu / Back – no way back into the room I left', JSON.stringify(ex) === JSON.stringify(['exit-menu', 'back']), ex);
    await P.click('#menu-choice-list [data-id="back"]');

    // ---- house 1: start it (the next one), go in
    await P.evaluate(() => window.klibb.cityDoor(1)); await sleep(300);
    const st1 = await ids(P, '#menu-choice-list button');
    check('house 1\'s door: "Start house 1 – a new empty room"', st1[0] === 'start-house', st1);
    await Promise.all([P.waitForURL(new RegExp(`room=${CID}-1$`), { timeout: 20000 }), P.click('#menu-choice-list [data-id="start-house"]')]);
    await ready(P); await sleep(2500);
    c = await P.evaluate(() => window.klibb.city());
    const h1 = (await (await fetch(`${S.base}/api/rooms/${CID}-1`)).json()).room;
    check('house 1 is a new empty room (type stad, no preset), same reduced wheel, HUD "Slapville · house 1"', h1.type === 'stad' && !h1.preset && c.inCity && !c.outside && c.house === 1 && c.wheel.length === 11 && (await P.textContent('#room-hud')) === 'Slapville · house 1', { h1: h1.type, c: { house: c.house, w: c.wheel.length } });
    await P.evaluate(() => window.klibb.menuAction('exit')); await sleep(300);
    const ex2 = await ids(P, '#menu-choice-list button');
    check('…its exit menu: Back to the City, Exit to menu (no "back to my room")', JSON.stringify(ex2) === JSON.stringify(['to-city', 'exit-menu', 'back']), ex2);
    await P.click('#menu-choice-list [data-id="back"]');

    // ---- B on the start card: the Join list shows the city's name
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const B = await ctxB.newPage(); B.on('pageerror', (e) => errors.push('B: ' + e.message));
    await B.goto(`${S.base}/?start=1`); await B.waitForSelector('#sc-list .sc-room', { timeout: 20000 }); await sleep(800);
    const join = await B.evaluate(() => [...document.querySelectorAll('#sc-list .sc-room')].map((b) => ({ id: b.dataset.id, text: b.textContent })));
    check('start card Join list: the room in the city shows the city name ("🏙 Slapville · house 1")', join.some((r) => r.id === `${CID}-1` && r.text.includes('🏙 Slapville · house 1')), join);
    await shot(B, '09-join-list-with-city-name.png');
    // B joins via the list → the house; no pack yet → the pack maker opens by itself
    await Promise.all([B.waitForURL(new RegExp(`room=${CID}-1$`), { timeout: 20000 }), B.click(`#sc-list .sc-room[data-id="${CID}-1"]`)]);
    await ready(B); await sleep(3000);
    check('joining a city room without a pack: the pack maker opens ("choose 3 slaps")', (await B.evaluate(() => window.klibb.door())).open);

    // A: back to the city → in front of house 1; door 1 started, door 2 next
    await Promise.all([P.waitForURL(new RegExp(`room=${CID}&at=${CID}-1`), { timeout: 20000 }), P.evaluate(() => { window.klibb.menuAction('exit'); document.querySelector('#menu-choice-list [data-id="to-city"]').click(); })]);
    await ready(P); await sleep(2000);
    c = await P.evaluate(() => window.klibb.city());
    const pos = await P.evaluate(() => window.klibb.camera.position.toArray());
    check('back outside in front of house 1; door 1 started (black), door 2 next', Math.abs(pos[2] - (-32 + 8 + 2.4)) < 0.6 && Math.abs(pos[0] + 32) < 1.2 && c.doorStates.find((d) => d[0] === 1)[1] === 'started' && c.doorStates.find((d) => d[0] === 2)[1] === 'next', { pos, d: c.doorStates });
    const picker2 = await (await fetch(`${S.base}/api/cities`)).json();
    check('the city picker lists Slapville with its people and houses', picker2.cities.some((x) => x.id === CID && x.name === 'Slapville' && x.houses.length === 1 && x.people >= 1), picker2);

    // A: Exit to menu → a free player's taken packs stay behind; their own pack stays in the shop
    const tok = await P.evaluate(() => JSON.parse(localStorage.getItem('klibb.packToken')));
    const pac = await P.evaluate(() => localStorage.getItem('klibb.pac'));
    await Promise.all([P.waitForURL(/start=1/, { timeout: 20000 }), P.evaluate(() => { window.klibb.menuAction('exit'); document.querySelector('#menu-choice-list [data-id="exit-menu"]').click(); })]);
    await sleep(2500);
    const afterTaken = await P.evaluate(() => JSON.parse(localStorage.getItem('klibb.cityTaken') || 'null'));
    const srv = await (await fetch(`${S.base}/api/city/packs`, { headers: { 'x-pack-token': tok } })).json();
    check('free: Exit to menu drops the 2 packs I took (here and on the server); my pack stays in the shop', afterTaken && afterTaken.packs.length === 0 && srv.mine && srv.mine.takes.length === 0 && srv.mine.left === 2, { afterTaken, mine: srv.mine && srv.mine.takes });
    await ctx.close();

    // ---- C: a paying player (dev unlock) with a pack: hands in for good, takes a pack → the deck picker
    const ctxC = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await ctxC.addInitScript(([p, l]) => { if (!localStorage.getItem('klibb.pac')) { localStorage.setItem('klibb.pac', p); localStorage.setItem('klibb.avatar', l); localStorage.setItem('klibb.devUnlock', '1'); } }, [pac, look('Maja', 'maja.slaps')]);
    const C3 = await ctxC.newPage(); C3.on('pageerror', (e) => errors.push('C: ' + e.message));
    await C3.goto(`${S.base}/?room=${CID}`); await ready(C3); await sleep(2000);
    await C3.evaluate(() => window.klibb.openHall()); await C3.waitForFunction(() => window.klibb.city().hall.packs !== null, null, { timeout: 10000 }); await sleep(800);
    await C3.click('#th-handin'); await sleep(500);
    const note = await C3.textContent('#th-form');
    await C3.fill('#hi-about', 'Paying member – my pack lives in the archive.'); await C3.click('#hi-go');
    await C3.waitForFunction(() => window.klibb.city().hall.mine, null, { timeout: 15000 }); await sleep(700);
    let h = await C3.evaluate(() => window.klibb.city().hall);
    check('paid: the shop knows it ("★ Paid"), the pack stays for good', h.paid && h.mine.forever && /for good/.test(note), { paid: h.paid, forever: h.mine && h.mine.forever });
    const deckBefore = await C3.evaluate(() => window.klibb.deck());
    await C3.click(`.th-pack[data-id="${others[2].pack.id}"] .th-take`);
    await C3.waitForFunction(() => window.klibb.city().hall.view === 'deck', null, { timeout: 10000 }); await sleep(700);
    h = await C3.evaluate(() => window.klibb.city().hall);
    // pick three deck stickers to replace (the first three after the start ones)
    const targets = deckBefore.slice(10, 13);
    for (const id of targets) { await C3.click(`#dk-grid .dk-g[data-id="${id}"]`); await sleep(150); }
    await sleep(400);
    await shot(C3, '10-paid-replace-in-deck-picker.png');
    const picked3 = await C3.evaluate(() => window.klibb.city().hall.deck);
    await C3.click('#dk-save'); await sleep(800);
    const deckAfter = await C3.evaluate(() => window.klibb.deck()), kept = await C3.evaluate(() => window.klibb.kept());
    const fresh = picked3.fresh;
    check('paid: taking a pack opens "Put it in your deck"; I choose the 3 stickers it replaces', h.view === 'deck' && fresh.length === 3 && Object.keys(picked3.targets).length === fresh.length, picked3);
    check('…saved: the new stickers sit where the replaced ones were, the deck is not bigger (≤ 228)', fresh.every((id, k) => deckAfter.indexOf(id) === deckBefore.indexOf(targets[k])) && targets.every((id) => !deckAfter.includes(id)) && deckAfter.length === deckBefore.length && deckAfter.filter((x) => x).length <= 228 + 6 && kept.length === fresh.length, { fresh, targets, idx: fresh.map((id) => deckAfter.indexOf(id)), was: targets.map((id) => deckBefore.indexOf(id)) });
    await shot(C3, '11-paid-shop-after-deck.png');
    // C leaves the city (to a normal room): keeps the pack she took
    const r2 = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) })).json();
    await C3.goto(`${S.base}/?room=${r2.room.id}`); await ready(C3); await sleep(1500);
    const keptOut = await C3.evaluate(() => ({ taken: JSON.parse(localStorage.getItem('klibb.cityTaken') || 'null'), deck: window.klibb.stickerDesigns().map((d) => d.id) }));
    check('paid: after leaving the city the taken pack is still mine, its stickers in my deck', keptOut.taken && keptOut.taken.packs.length === 1 && fresh.every((id) => keptOut.deck.includes(id)), { t: keptOut.taken && keptOut.taken.packs.length });
    await ctxC.close();

    // ---- the phone: the shop, big and in one column
    const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ph.addInitScript(([p]) => { if (!localStorage.getItem('klibb.pac')) localStorage.setItem('klibb.pac', p); }, [pac]);
    const Q = await ph.newPage(); Q.on('pageerror', (e) => errors.push('phone: ' + e.message));
    await Q.goto(`${S.base}/?room=${CID}`); await ready(Q); await sleep(2500);
    await Q.evaluate(() => window.klibb.openHall()); await Q.waitForFunction(() => window.klibb.city().hall.packs !== null, null, { timeout: 10000 }); await sleep(1200);
    await Q.evaluate(() => document.querySelector('#th-grid .th-pack').scrollIntoView({ block: 'start' })); await sleep(500);
    await Q.screenshot({ path: path.join(SHOTS, '12-phone-shop.png') });
    const fit = await Q.evaluate(() => { const r = document.querySelector('#townhall .th-panel').getBoundingClientRect(); const cards = [...document.querySelectorAll('#th-grid .th-pack')].map((c) => c.getBoundingClientRect()); const b = document.querySelector('#th-grid .th-take').getBoundingClientRect(); const t = getComputedStyle(document.querySelector('#th-grid .th-pname')).fontSize; return { w: r.width, cols: new Set(cards.map((c) => Math.round(c.left))).size, bh: b.height, t }; });
    check('phone: the shop fills the screen, one column of cards, buttons ≥ 56 px, names ≥ 22 px', fit.w <= 390 && fit.cols === 1 && fit.bh >= 56 && parseFloat(fit.t) >= 22, fit);
    await Q.click(`.th-pack[data-id="${others[0].pack.id}"] .th-pname`); await sleep(800);
    await Q.screenshot({ path: path.join(SHOTS, '13-phone-pack-detail.png') });
    await Q.click('#th-back'); await sleep(300);
    await Q.evaluate(() => document.querySelector('#th-x').click()); await sleep(300);
    await ph.close();
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await browser.close(); S.child.kill();
  console.log(`\nCity e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
