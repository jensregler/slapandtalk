// E2E: Run-DMC start menu (Jens, 6 Nov 2026; startcard.js). Splash → Main → New/Join → details → enter.
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
    check('?start=1 shows SLP/TLK splash (Run-DMC frame) – the room does not load behind it',
      await p.evaluate(() => {
        const t = [...document.querySelectorAll('.sc-title')].map((x) => x.textContent);
        return t.join('/') === 'SLP/TLK' && !!document.querySelector('.sc-frame') && !window.klibb;
      }));

    await toMain(p); await sleep(200);
    await p.screenshot({ path: '/workspace/menu-2.png' });
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
    check('NEW GAME → EMPTY ROOM / PRESET + BACK',
      await p.evaluate(() => document.getElementById('sc-empty')?.textContent === 'EMPTY ROOM'
        && document.getElementById('sc-preset')?.textContent === 'PRESET'
        && document.getElementById('sc-back')?.textContent === 'BACK'));

    await p.click('#sc-preset'); await p.waitForSelector('#sc-preset-heading', { timeout: 10000 }); await sleep(400);
    await p.screenshot({ path: '/workspace/menu-4.png' });
    check('PRESET screen: PRESET: heading + BACK',
      await p.evaluate(() => document.getElementById('sc-preset-heading')?.textContent === 'PRESET:'
        && document.getElementById('sc-back')?.textContent === 'BACK'));

    await p.click('#sc-back'); await sleep(200);
    await p.click('#sc-back'); await sleep(200);
    check('BACK returns to main', await p.evaluate(() => !!document.getElementById('sc-join')));

    await p.click('#sc-join'); await p.waitForSelector('#sc-list .sc-room, #sc-list .sc-empty', { timeout: 15000 }); await sleep(400);
    await p.screenshot({ path: '/workspace/menu-5.png' });
    const rooms = await p.evaluate(() => [...document.querySelectorAll('#sc-list .sc-room')].map((x) => x.textContent));
    check('JOIN EXISTING lists the open room with free spots / stickers / visitors / age',
      rooms.length === 1 && /Ullas ateljé/.test(rooms[0]) && /free spots/.test(rooms[0]) && /stickers/.test(rooms[0]) && /visitors/.test(rooms[0]), rooms);
    check('JOIN has BACK but no CODE button',
      await p.evaluate(() => document.getElementById('sc-back')?.textContent === 'BACK' && !document.getElementById('sc-code')));

    // Join → details (name + Instagram only; no room name) → ENTER
    await p.click(`#sc-list .sc-room[data-id="${mk.room.id}"]`);
    await p.waitForSelector('#sc-details', { timeout: 10000 }); await sleep(300);
    await p.screenshot({ path: '/workspace/menu-6.png' });
    const joinForm = await p.evaluate(() => ({
      room: !!document.getElementById('sc-roomname'),
      name: document.getElementById('sc-name')?.tagName,
      insta: document.getElementById('sc-insta')?.tagName,
      enter: document.getElementById('sc-enter')?.textContent,
      back: document.getElementById('sc-back')?.textContent,
    }));
    check('join → details: NAME + INSTAGRAM + ENTER, no room name field',
      !joinForm.room && joinForm.name === 'INPUT' && joinForm.insta === 'INPUT' && joinForm.enter === 'ENTER' && joinForm.back === 'BACK', joinForm);
    await p.fill('#sc-name', 'Jens'); await p.fill('#sc-insta', '@jensreglermanniska');
    await p.click('#sc-back'); await sleep(200);
    check('details BACK returns to join list', await p.evaluate(() => !!document.querySelector('#sc-list .sc-room')));
    await p.click(`#sc-list .sc-room[data-id="${mk.room.id}"]`);
    await p.waitForSelector('#sc-details'); await sleep(150);
    // Prefill from previous fill (saved on ENTER only — BACK without ENTER does not save). Re-fill and enter.
    await p.fill('#sc-name', 'Jens'); await p.fill('#sc-insta', '@jensreglermanniska');
    await p.click('#sc-enter');
    await p.waitForFunction((id) => new URLSearchParams(location.search).get('room') === id && window.klibb && window.klibb.ready, mk.room.id, { timeout: 30000 });
    const joined = await p.evaluate(() => {
      const av = JSON.parse(localStorage.getItem('klibb.avatar') || '{}');
      return { name: av.name, insta: av.look && av.look.insta, room: window.klibb.room };
    });
    check('join details ENTER: opens the room and saves name + Instagram (face-lock handle)',
      joined.room === mk.room.id && joined.name === 'Jens' && joined.insta === 'jensreglermanniska', joined);

    // Deep link still works with no menu / no CODE UI
    await p.goto(`${S.base}/?room=${mk.room.id}`);
    await p.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    check('direct ?room= link still enters the room (no start menu)', await p.evaluate(() => !document.getElementById('start-card') && !!window.klibb));

    // New game → EMPTY ROOM → details with room name
    await p.goto(`${S.base}/`); await toMain(p);
    check('the plain address shows the menu too', await p.evaluate(() => !!document.getElementById('start-card')));
    // Prefill: avatar already has Jens / jensreglermanniska from the join above
    await p.click('#sc-new'); await sleep(200);
    await p.click('#sc-empty'); await p.waitForSelector('#sc-details'); await sleep(300);
    await p.screenshot({ path: '/workspace/menu-6b.png' });
    const newForm = await p.evaluate(() => ({
      room: !!document.getElementById('sc-roomname'),
      name: document.getElementById('sc-name')?.value,
      insta: document.getElementById('sc-insta')?.value,
      enter: document.getElementById('sc-enter')?.textContent,
    }));
    check('EMPTY ROOM → details: ROOM NAME + prefilled NAME/INSTAGRAM',
      newForm.room && newForm.name === 'Jens' && newForm.insta === 'jensreglermanniska' && newForm.enter === 'ENTER', newForm);
    await p.fill('#sc-roomname', 'Malmö slaps');
    await p.click('#sc-enter');
    await p.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    const r = await p.evaluate(async () => {
      const j = (await (await fetch('/api/rooms/' + window.klibb.room)).json()).room;
      const av = JSON.parse(localStorage.getItem('klibb.avatar') || '{}');
      return { room: window.klibb.room, key: !!JSON.parse(localStorage.getItem('klibb.roomKeys') || '{}')[window.klibb.room], preset: j.preset, name: j.name, avName: av.name, insta: av.look && av.look.insta };
    });
    check('EMPTY ROOM ENTER: new quick room named "Malmö slaps", key kept, identity saved',
      r.key && !r.preset && r.name === 'Malmö slaps' && r.avName === 'Jens' && r.insta === 'jensreglermanniska' && r.room !== mk.room.id, r);

    const m = await (await b.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
    await m.goto(`${S.base}/`); await toMain(m); await sleep(400);
    await m.screenshot({ path: path.join(SHOTS, '13-start-card-phone.png') });
    await m.tap('#sc-join'); await m.waitForSelector('#sc-list', { timeout: 15000 }); await sleep(500);
    check('phone join: no CODE button', await m.evaluate(() => !document.getElementById('sc-code')));
    check('no page errors', errs.length === 0, errs);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await b.close(); S.child.kill();
  console.log(`\nStart card e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
