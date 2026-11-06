// E2E: Run-DMC start menu (Jens, 6 Nov 2026; startcard.js). Splash → Main → New game / Join.
// Own server (STARTCARD_E2E_PORT, default 8901). Screenshots: STICKERMENU_SHOTS + /workspace/menu-N.png.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.STARTCARD_E2E_PORT || 8901);
const SHOTS = process.env.STICKERMENU_SHOTS || '/workspace/stickermenu-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
async function toMain(page) {
  await page.waitForSelector('#sc-splash, #sc-new', { timeout: 15000 });
  if (await page.$('#sc-new')) return;
  await page.click('#start-card');
  await page.waitForSelector('#sc-new', { timeout: 10000 });
}
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errs = [];
  try {
    const empty = await (await fetch(`${S.base}/api/rooms/open`)).json();
    check('GET /api/rooms/open: no rooms with people yet', Array.isArray(empty.rooms) && empty.rooms.length === 0, empty);
    const mk = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ullas ateljé' }) })).json();
    await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const o = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); o.on('pageerror', (e) => errs.push('o: ' + e.message));
    await o.goto(`${S.base}/?room=${mk.room.id}`); await o.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.net.status === 'online', null, { timeout: 30000 });
    await sleep(500);
    const open = (await (await fetch(`${S.base}/api/rooms/open`)).json()).rooms;
    check('…a room with someone in it and a free spot is listed (name, free spots, stickers, visitors, age); no keys', open.length === 1 && open[0].id === mk.room.id && open[0].name === 'Ullas ateljé' && open[0].free >= 1 && 'stickers' in open[0] && 'visitors' in open[0] && open[0].createdAt && !JSON.stringify(open[0]).includes('key'), open);

    const p = await (await b.newContext({ viewport: { width: 900, height: 1000 } })).newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${S.base}/?start=1`);
    await p.waitForSelector('#sc-splash', { timeout: 15000 }); await sleep(200);
    await p.screenshot({ path: '/workspace/menu-1.png' });
    await p.screenshot({ path: path.join(SHOTS, '10a-splash.png') });
    check('?start=1 shows SLP/TLK splash (Run-DMC frame) – the room does not load behind it',
      await p.evaluate(() => {
        const t = [...document.querySelectorAll('.sc-title')].map((x) => x.textContent);
        return t.join('/') === 'SLP/TLK' && !!document.querySelector('.sc-frame') && !window.klibb;
      }));

    await toMain(p); await sleep(200);
    await p.screenshot({ path: '/workspace/menu-2.png' });
    await p.screenshot({ path: path.join(SHOTS, '10b-main.png') });
    const main = await p.evaluate(() => ({
      frame: !!document.querySelector('#start-card .sc-frame'),
      newTxt: document.getElementById('sc-new')?.textContent,
      joinTxt: document.getElementById('sc-join')?.textContent,
      bar: getComputedStyle(document.querySelector('.sc-bar-top')).backgroundColor,
      main: !!window.klibb,
    }));
    check('main: NEW GAME + JOIN EXISTING on black square with red bars',
      main.frame && main.newTxt === 'NEW GAME' && main.joinTxt === 'JOIN EXISTING' && !main.main
      && /rgb\(160,\s*12,\s*36\)/.test(main.bar), main);

    await p.click('#sc-new'); await sleep(250);
    await p.screenshot({ path: '/workspace/menu-3.png' });
    await p.screenshot({ path: path.join(SHOTS, '10c-newgame.png') });
    check('NEW GAME → EMPTY ROOM / PRESET + BACK',
      await p.evaluate(() => document.getElementById('sc-empty')?.textContent === 'EMPTY ROOM'
        && document.getElementById('sc-preset')?.textContent === 'PRESET'
        && document.getElementById('sc-back')?.textContent === 'BACK'));

    await p.click('#sc-preset'); await p.waitForSelector('#sc-preset-heading', { timeout: 10000 }); await sleep(400);
    await p.screenshot({ path: '/workspace/menu-4.png' });
    await p.screenshot({ path: path.join(SHOTS, '10d-presets.png') });
    check('PRESET screen: PRESET: heading + BACK',
      await p.evaluate(() => document.getElementById('sc-preset-heading')?.textContent === 'PRESET:'
        && document.getElementById('sc-back')?.textContent === 'BACK'));

    await p.click('#sc-back'); await sleep(200);
    await p.click('#sc-back'); await sleep(200);
    check('BACK returns to main', await p.evaluate(() => !!document.getElementById('sc-join')));

    await p.click('#sc-join'); await p.waitForSelector('#sc-list .sc-room, #sc-list .sc-empty', { timeout: 15000 }); await sleep(400);
    await p.screenshot({ path: '/workspace/menu-5.png' });
    await p.screenshot({ path: path.join(SHOTS, '10e-join.png') });
    const rooms = await p.evaluate(() => [...document.querySelectorAll('#sc-list .sc-room')].map((x) => x.textContent));
    check('JOIN EXISTING lists the open room with free spots / stickers / visitors / age',
      rooms.length === 1 && /Ullas ateljé/.test(rooms[0]) && /free spots/.test(rooms[0]) && /stickers/.test(rooms[0]) && /visitors/.test(rooms[0]), rooms);

    await p.click('#sc-code'); await sleep(300); await p.fill('#sc-code-input', 'nope-nope'); await p.click('#sc-code-go'); await sleep(700);
    check('CODE: a code dialog; an unknown code says so', /no room with that code/i.test(await p.textContent('#sc-code-msg')));
    await p.screenshot({ path: path.join(SHOTS, '11-start-code-dialog.png') });
    await p.fill('#sc-code-input', `https://slapandtalk.com/?room=${mk.room.id}`); await p.click('#sc-code-go');
    await p.waitForFunction((id) => new URLSearchParams(location.search).get('room') === id, mk.room.id, { timeout: 15000 });
    check('…a known code (or a pasted link) opens that room', true);

    await p.goto(`${S.base}/`); await toMain(p);
    check('the plain address shows the menu too', await p.evaluate(() => !!document.getElementById('start-card')));
    await p.click('#sc-new'); await sleep(200);
    await p.click('#sc-back'); await sleep(200);
    check('"BACK" returns to main from NEW GAME', await p.evaluate(() => !!document.getElementById('sc-join')));
    await p.click('#sc-new'); await sleep(200);
    await p.click('#sc-empty');
    await p.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    const r = await p.evaluate(async () => ({
      room: window.klibb.room,
      key: !!JSON.parse(localStorage.getItem('klibb.roomKeys') || '{}')[window.klibb.room],
      preset: (await (await fetch('/api/rooms/' + window.klibb.room)).json()).room.preset,
    }));
    check('EMPTY ROOM: a new quick room, its key kept, no preset', r.key && !r.preset && r.room !== mk.room.id, r);

    const m = await (await b.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
    await m.goto(`${S.base}/`); await toMain(m); await sleep(400);
    await m.screenshot({ path: path.join(SHOTS, '13-start-card-phone.png') });
    await m.tap('#sc-join'); await m.waitForSelector('#sc-list', { timeout: 15000 }); await sleep(500);
    await m.screenshot({ path: path.join(SHOTS, '13b-join-phone.png') });
    check('no page errors', errs.length === 0, errs);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await b.close(); S.child.kill();
  console.log(`\nStart card e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
