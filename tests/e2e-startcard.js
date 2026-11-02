// E2E: the Priority Mail start card (Jens, 31 Oct 2026; startcard.js). The plain address and ?start=1
// show it: "enter new room" → name? / instagram @: / roomname? → save and enter (a new named room,
// the name + Instagram name saved with my avatar); "…or I have a code" → a code dialog (unknown code
// = a message); "…or Join" → the rooms with people in them and a free spot. Own server
// (STARTCARD_E2E_PORT, default 8901). Screenshots: STICKERMENU_SHOTS (default /workspace/stickermenu-shots).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.STARTCARD_E2E_PORT || 8901);
const SHOTS = process.env.STICKERMENU_SHOTS || '/workspace/stickermenu-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errs = [];
  try {
    const empty = await (await fetch(`${S.base}/api/rooms/open`)).json();
    check('GET /api/rooms/open: no rooms with people yet', Array.isArray(empty.rooms) && empty.rooms.length === 0, empty);
    const mk = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ullas ateljé' }) })).json();
    await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); // an empty room: never listed
    const o = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); o.on('pageerror', (e) => errs.push('o: ' + e.message));
    await o.goto(`${S.base}/?room=${mk.room.id}`); await o.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.net.status === 'online', null, { timeout: 30000 });
    await sleep(500);
    const open = (await (await fetch(`${S.base}/api/rooms/open`)).json()).rooms;
    check('…a room with someone in it and a free spot is listed (name, free spots, stickers, visitors, age); no keys', open.length === 1 && open[0].id === mk.room.id && open[0].name === 'Ullas ateljé' && open[0].free >= 1 && 'stickers' in open[0] && 'visitors' in open[0] && open[0].createdAt && !JSON.stringify(open[0]).includes('key'), open);
    const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${S.base}/?start=1`); await p.waitForSelector('#sc-list .sc-room', { timeout: 15000 }); await sleep(500);
    const c = await p.evaluate(() => ({ card: !!document.querySelector('#start-card .sc-paper'), bg: getComputedStyle(document.querySelector('.sc-paper')).backgroundImage, rooms: [...document.querySelectorAll('#sc-list .sc-room')].map((x) => x.textContent), main: !!window.klibb }));
    check('?start=1 shows the Priority Mail card (Jens\'s menue.png) – the room does not load behind it', c.card && /start\/card\.webp/.test(c.bg) && !c.main, c);
    check('…"…or Join" lists the open room by name with its facts', c.rooms.length === 1 && /Ullas ateljé/.test(c.rooms[0]) && /free spot/.test(c.rooms[0]), c.rooms);
    const art = await p.evaluate(() => [...document.querySelectorAll('#start-card .sc-hand-img')].map((i) => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0, alt: i.alt })));
    check('Jens\'s hand-drawn "enter" and "…or Join" (cut from his mockup) are shown; "new room" / "…or I have a code:" stay live text',
      art.length === 2 && art.every((a) => a.ok) && /enter\.png/.test(art[0].src) && /orjoin\.png/.test(art[1].src)
      && await p.evaluate(() => document.querySelector('#sc-new .sc-sub').textContent === 'new room' && /I have a code/.test(document.getElementById('sc-code').textContent)), art);
    await p.screenshot({ path: path.join(SHOTS, '10b-start-card.png') });
    await p.click('#sc-code'); await sleep(300); await p.fill('#sc-code-input', 'nope-nope'); await p.click('#sc-code-go'); await sleep(700);
    check('"…or I have a code": a code dialog; an unknown code says so', /no room with that code/i.test(await p.textContent('#sc-code-msg')));
    await p.screenshot({ path: path.join(SHOTS, '11-start-code-dialog.png') });
    await p.fill('#sc-code-input', `https://slapandtalk.com/?room=${mk.room.id}`); await p.click('#sc-code-go');
    await p.waitForFunction((id) => new URLSearchParams(location.search).get('room') === id, mk.room.id, { timeout: 15000 });
    check('…a known code (or a pasted link) opens that room', true);
    await p.goto(`${S.base}/`); await p.waitForSelector('#sc-new', { timeout: 15000 });
    check('the plain address shows the card too', await p.evaluate(() => !!document.getElementById('start-card')));
    await p.click('#sc-new'); await sleep(300);
    await p.fill('#sc-name', 'Jens'); await p.fill('#sc-insta', '@jensregler'); await p.fill('#sc-roomname', 'Malmö slaps');
    await p.screenshot({ path: path.join(SHOTS, '12-start-new-room-card.png') });
    await p.click('#sc-back'); await sleep(200);
    check('"back" returns to the first card', await p.evaluate(() => !!document.getElementById('sc-join')));
    await p.click('#sc-new'); await sleep(200);
    await p.fill('#sc-name', 'Jens'); await p.fill('#sc-insta', '@jensregler'); await p.fill('#sc-roomname', 'Malmö slaps');
    await p.click('#sc-save');
    await p.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    const r = await p.evaluate(async () => ({ room: window.klibb.room, key: !!JSON.parse(localStorage.getItem('klibb.roomKeys') || '{}')[window.klibb.room], av: JSON.parse(localStorage.getItem('klibb.avatar')), name: (await (await fetch('/api/rooms/' + window.klibb.room)).json()).room.name }));
    check('"save and enter": a new room named "Malmö slaps", its key kept, my name + Instagram saved with my avatar', r.name === 'Malmö slaps' && r.key && r.av.name === 'Jens' && r.av.look.insta === 'jensregler' && r.room !== mk.room.id, r);
    const m = await (await b.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
    await m.goto(`${S.base}/`); await m.waitForSelector('#sc-list li', { timeout: 15000 }); await sleep(800);
    await m.screenshot({ path: path.join(SHOTS, '13-start-card-phone.png') });
    check('no page errors', errs.length === 0, errs);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await b.close(); S.child.kill();
  console.log(`\nStart card e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
