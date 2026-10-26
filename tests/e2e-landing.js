// e2e: the plain address goes to your most recently used room (client/src/landing.js), on its own
// server (port 8861; never the shared 8787):
//   no rooms → a new quick room (?room=<new>, its key saved), one navigation, no reload loop
//   two rooms → the one with the latest activity; activity in the other → that one
//   a room that is gone (deleted from storage) is skipped and forgotten
//   ?room=stad still opens the City, and Room ▾ → 🏙 Visit the City goes there
// Run: node tests/e2e-landing.js   (needs a built client: npx vite build)
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { sleep } = require('./demo-helpers');

const PORT = Number(process.env.LANDING_E2E_PORT || 8861);
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, ok, info = '') {
  if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (info ? '  — ' + JSON.stringify(info) : '')); }
}
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-landing-e2e-'));
const base = `http://localhost:${PORT}`;
let child = null;
async function start() {
  child = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], { env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(PORT), DATA_DIR: DIR, STORAGE: 'local', ADMIN_TOKEN: 'landing-admin' }, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/config')).ok) return; } catch { /* starting */ } await sleep(150); }
  throw new Error('server did not start');
}
async function stop() { if (!child) return; const c = child; child = null; await new Promise((r) => { c.once('exit', r); c.kill('SIGTERM'); }); }
const mk = () => fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json());
const visit = (id) => fetch(`${base}/api/rooms/${id}/visit`, { method: 'POST' });
const ready = (p) => p.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });

(async () => {
  await start();
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  const open = async (ctx, url = '/') => {
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
    let navs = 0; p.on('load', () => navs++); // real page loads (replaceState is not one)
    await p.goto(base + url); await ready(p); await sleep(300);
    return { p, navs: () => navs, room: await p.evaluate(() => window.klibb.room), url: p.url() };
  };
  try {
    console.log('Landing (' + base + ')');
    // 1. No rooms → a new room
    const c1 = await browser.newContext();
    const a = await open(c1);
    const keys = await a.p.evaluate(() => JSON.parse(localStorage.getItem('klibb.roomKeys') || '{}'));
    const info = await (await fetch(`${base}/api/rooms/recent?ids=${a.room}`)).json();
    check('no rooms: the plain address makes a new quick room (?room=<id>, key saved, exists on the server)', a.room !== 'stad' && a.url === `${base}/?room=${a.room}` && keys[a.room] && info.rooms.length === 1, { room: a.room, url: a.url });
    check('…one page load, no reload loop', a.navs() === 1, a.navs());
    const again = await open(c1);
    check('…and the next visit comes back to that room (no second new room)', again.room === a.room, again.room);
    await c1.close();

    // 2. Two rooms → the latest activity
    const A = await mk(); await sleep(50); const B = await mk();
    const c2 = await browser.newContext();
    await c2.addInitScript(([x, y]) => { if (!localStorage.getItem('klibb.roomKeys')) localStorage.setItem('klibb.roomKeys', JSON.stringify(Object.fromEntries([x, y].map((r) => [r.room.id, r.roomKey])))); }, [A, B]);
    const l1 = await open(c2);
    check('two rooms: lands in the most recently updated one (B, made last)', l1.room === B.room.id, { got: l1.room, A: A.room.id, B: B.room.id });
    await l1.p.close();
    // something happens in A (a new look by its creator) → A
    await sleep(1100);
    await fetch(`${base}/api/rooms/${A.room.id}/style`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-room-key': A.roomKey }, body: JSON.stringify({ style: { floor: 'parkett', wall: 'klassisk', ceiling: 'klassisk' } }) });
    const l2 = await open(c2);
    check('…activity in A (its look changed) → A', l2.room === A.room.id, l2.room);
    await l2.p.close();

    // 3. A room that is gone: C is the latest, then deleted from storage (as the cleanup would)
    const C = await mk(); await visit(C.room.id);
    await c2.addInitScript((c) => { const k = JSON.parse(localStorage.getItem('klibb.roomKeys') || '{}'); if (!k[c.room.id] && !sessionStorage.getItem('c-added')) { k[c.room.id] = c.roomKey; localStorage.setItem('klibb.roomKeys', JSON.stringify(k)); sessionStorage.setItem('c-added', '1'); } }, C);
    await stop();
    const file = path.join(DIR, 'rooms', `${C.room.id}.json`);
    const had = fs.existsSync(file); fs.rmSync(file, { force: true });
    await start();
    const l3 = await open(c2);
    const left = await l3.p.evaluate((id) => id in JSON.parse(localStorage.getItem('klibb.roomKeys') || '{}'), C.room.id);
    check('a deleted room is skipped (lands in A) and forgotten on this device', had && l3.room === A.room.id && !left, { had, room: l3.room, left });

    // 4. The City
    const city = await open(c2, '/?room=stad');
    const ci = await city.p.evaluate(() => ({ room: window.klibb.room, badge: document.getElementById('room-type').textContent }));
    check('?room=stad still opens the City', ci.room === 'stad' && ci.badge === 'The City' && city.url === `${base}/?room=stad`, ci);
    const lab = await l3.p.evaluate(() => { const b = document.getElementById('to-stad'); return b.textContent; });
    await l3.p.evaluate(() => document.getElementById('to-stad').click());
    await l3.p.waitForURL(`${base}/?room=stad`, { timeout: 10000 }); await ready(l3.p);
    check('Room ▾ → “🏙 Visit the City” goes to /?room=stad', lab === '🏙 Visit the City' && await l3.p.evaluate(() => window.klibb.room) === 'stad', lab);
    const back = await open(c2);
    check('…visiting the City does not make it “my room”: the plain address still goes to A', back.room === A.room.id, back.room);
    await c2.close();
    check('no page errors', errors.length === 0, errors);
  } catch (err) { failed++; console.log('  ✗ ' + err.stack); } finally {
    await browser.close(); await stop(); fs.rmSync(DIR, { recursive: true, force: true });
    console.log(`\nLanding e2e: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();
