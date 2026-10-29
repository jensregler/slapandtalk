// E2E: Färg (Jens, 29 Oct 2026, point 11) – in the room look panel before a quick room is created
// ('＋ New quick room' → Create room): your own image as the room's surface, on the floor, the walls
// AND the ceiling, with the avatar fabric's controls (scale, rotation, hue, cycle hue, spin, scroll,
// colour under transparent parts, 🌀 Randomize). Stored in the room look: the others, the recording
// (and its replay) and a preset made from the room see it. Full version (fabrics); free = no row and
// the server drops it; OPEN_ACCESS on = open. Own servers (FARG_E2E_PORT, default 8902, and +1).
// Screenshots → /workspace/farg-shots/ (FARG_SHOTS).
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.FARG_E2E_PORT || 8902);
const SHOTS = process.env.FARG_SHOTS || '/workspace/farg-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
const SURFACES = ['golv', 'tak', 'vägg-norr', 'vägg-söder', 'vägg-väster', 'vägg-öster'];
let ipN = 0;
const post = (S, p, body, headers = {}) => fetch(`${S.base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.8.${++ipN}.3`, ...headers }, body: JSON.stringify(body) }).then((r) => r.json());
// Magenta diagonal stripes on transparent (so the colour under transparent parts shows between them).
const STRIPES = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><g fill="#ff00ff">
  <polygon points="0,0 64,0 256,192 256,256 192,256 0,64"/><polygon points="160,0 256,0 256,96"/><polygon points="0,160 0,256 96,256"/></g></svg>`;
const magenta = (r, g, b) => r > 150 && b > 150 && g < 110 && Math.abs(r - b) < 90;
async function share(file, pred) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  let hit = 0; const n = info.width * info.height;
  for (let i = 0; i < n; i++) { const o = i * info.channels; if (pred(data[o], data[o + 1], data[o + 2])) hit++; }
  return hit / n;
}
async function page(browser, S, url, { dev = false } = {}, errors = []) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(([dev]) => {
    if (sessionStorage.getItem('init')) return; sessionStorage.setItem('init', '1');
    localStorage.setItem('klibb.avatar', JSON.stringify({ name: dev ? 'Full' : 'Fri', look: { outfit: 'tshirt', hair: 'kort', shirt: '#3a86ff', pants: '#2b4c7e', hairColor: '#4a2c17', skin: '#e0ac69', hat: false, hatColor: '#e63946' } }));
    if (dev) localStorage.setItem('klibb.devUnlock', '1');
  }, [dev]);
  const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
  await P.goto(url);
  return P;
}
const ready = (P) => P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 }).then(() => P.evaluate(() => window.klibb.entitlementsReady()));
const fargOf = (P) => P.evaluate(() => ({ draft: window.klibb.styleDraft(), cur: window.klibb.currentStyle(), fab: window.klibb.roomFabric(), row: !document.getElementById('sp-farg-row').hidden,
  label: document.querySelector('#sp-farg-row b')?.textContent, sliders: [...document.querySelectorAll('#farg-box .fab-sl')].map((r) => r.dataset.param),
  base: document.querySelectorAll('#farg-box .farg-base button').length, any: !!document.getElementById('farg-base-any'), wild: !!document.querySelector('#farg-box .farg-wild') }));
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const img = path.join(os.tmpdir(), 'e2e-farg-stripes.png');
  await sharp(Buffer.from(STRIPES)).png().toFile(img);
  const browser = await chromium.launch({ args: GL });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '0' });
  const O = await startServer(PORT + 1, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const errors = [];
  try {
    const start = await post(S, '/api/rooms', { preset: false });
    // ---- full version: '＋ New quick room' → the look panel → Färg
    const A = await page(browser, S, `${S.base}/?room=${start.room.id}`, { dev: true }, errors);
    await ready(A);
    await A.evaluate(() => { const k = window.klibb; k.moveTo(0, 2.5); k.look(0, 0.12); });
    await A.evaluate(() => window.klibb.openStylePanel('create'));
    await A.waitForSelector('#style-panel:not([hidden])');
    const before = path.join(SHOTS, '0-before.png'); await sleep(800); await A.screenshot({ path: before });
    const f0 = await fargOf(A);
    check('the New quick room panel has a "Färg" row (full version), off to start with', f0.row && f0.label === 'Färg' && !f0.draft.fabric && !!(await A.$('#farg-box .farg-none.sel')), f0);
    await A.setInputFiles('#farg-file', img);
    await A.waitForFunction(() => window.klibb.styleDraft()?.fabric?.id && window.klibb.roomFabric().loaded, null, { timeout: 20000 });
    await sleep(600);
    const f1 = await fargOf(A);
    check('upload an image → it is the surface on the floor, all four walls AND the ceiling (live preview)', f1.fab.on.length === 6 && SURFACES.every((s) => f1.fab.on.includes(s)) && f1.fab.id === f1.draft.fabric.id, f1.fab);
    check('…with every fabric control: scale, rotation, hue, cycle hue, spin, scroll, colour under transparent parts, Randomize', f1.sliders.join() === 'scale,rot,hue,hueHz,spinHz,scroll' && f1.base >= 8 && f1.any && f1.wild, f1);
    const shot1 = path.join(SHOTS, '1-farg-panel.png'); await A.screenshot({ path: shot1 });
    const m0 = await share(before, magenta), m1 = await share(shot1, magenta);
    check('…and it is on screen (the magenta stripes)', m0 < 0.01 && m1 > 0.08, { m0, m1 });
    const setRange = (param, v) => A.evaluate(([p, v]) => { const r = document.querySelector(`#farg-box .fab-sl[data-param="${p}"] input[type=range]`); r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); }, [param, v]);
    const setFlag = (flag, on = true) => A.evaluate(([f, on]) => { const c = document.querySelector(`#farg-box input[data-flag="${f}"]`); c.checked = on; c.dispatchEvent(new Event('change', { bubbles: true })); }, [flag, on]);
    await setRange('scale', 2.5); await setRange('rot', 45); await setRange('hue', 120); await setFlag('cycleHue');
    await A.click('#farg-box .farg-base button[data-id="#ffd400"]');
    await sleep(500);
    const f2 = await fargOf(A);
    check('the sliders and toggles change it (scale 2.5, rotation 45, hue 120, cycle hue on)', f2.draft.fabric.scale === 2.5 && f2.draft.fabric.rot === 45 && f2.draft.fabric.hue === 120 && f2.draft.fabric.cycleHue === true, f2.draft.fabric);
    check('…the colour under transparent parts is every surface\'s base colour', f2.draft.fabric.base === '#ffd400' && f2.fab.colors.every((c) => c === '#ffd400'), f2.fab.colors);
    await A.screenshot({ path: path.join(SHOTS, '2-farg-tuned.png') });
    const id = f2.draft.fabric.id;
    await A.click('#farg-box .farg-wild'); await sleep(300);
    const f3 = await fargOf(A);
    check('Randomize: wild values, same image', f3.draft.fabric.id === id && JSON.stringify(f3.draft.fabric) !== JSON.stringify(f2.draft.fabric), f3.draft.fabric);
    await A.click('#style-random'); await sleep(300);
    check('Random (floor/walls) keeps the Färg', (await fargOf(A)).draft.fabric?.id === id);
    await A.click('#farg-box .farg-none'); await sleep(400);
    const f4 = await fargOf(A);
    check('None: back to the floor/walls/ceiling from the catalogue', !f4.draft.fabric && f4.fab.on.length === 0 && f4.fab.id === null, f4.fab);
    await A.click(`#farg-box .farg-pick[style*="${id}"]`);
    await A.waitForFunction((id) => window.klibb.styleDraft()?.fabric?.id === id, id, { timeout: 8000 }).catch(() => {});
    const back = (await fargOf(A)).draft.fabric;
    check('…and the recent image is one click away again (its values kept)', back && back.id === id && back.base === f3.draft.fabric.base, back);
    await setRange('scale', 1.5); await setRange('hue', 0); await setFlag('cycleHue', false); await setFlag('spin'); await sleep(200); // (hue 0: the stripes stay magenta for the pixel checks)
    const want = (await fargOf(A)).draft.fabric;
    await Promise.all([A.waitForNavigation({ timeout: 20000 }), A.click('#style-ok')]);
    await ready(A);
    await A.waitForFunction(() => window.klibb.roomFabric().loaded, null, { timeout: 15000 });
    const R = await A.evaluate(() => new URLSearchParams(location.search).get('room'));
    const KEY = await A.evaluate((r) => JSON.parse(localStorage.getItem('klibb.roomKeys'))[r], R);
    const a1 = await fargOf(A);
    const sameFab = (x) => !!x && x.id === want.id && x.scale === want.scale && x.spin === true && x.base === want.base;
    check('Create room → the new room has it: in the room look and on all six surfaces', sameFab(a1.cur.fabric) && a1.fab.on.length === 6, { cur: a1.cur, fab: a1.fab });
    const srv = await (await fetch(`${S.base}/api/rooms/${R}`)).json();
    check('…stored on the server with the room look', sameFab(srv.room.style.fabric), srv.room.style);
    await A.evaluate(() => { const k = window.klibb; k.moveTo(0, 2.5); k.look(0, 0.12); }); await sleep(900);
    await A.screenshot({ path: path.join(SHOTS, '3-room-created.png') });
    // record through the creator's own Start recording button
    await A.evaluate(() => document.getElementById('rec-toggle').click());
    await A.waitForFunction(() => !!window.klibb.rec(), null, { timeout: 8000 });
    const recId = await A.evaluate(() => window.klibb.rec().recId);
    const B = await page(browser, S, `${S.base}/?room=${R}`, {}, errors);
    await ready(B);
    await B.waitForFunction(() => window.klibb.roomFabric().loaded, null, { timeout: 15000 });
    const b1 = await fargOf(B);
    check('another player (free version) sees it on all six surfaces', sameFab(b1.cur.fabric) && b1.fab.on.length === 6, b1.fab);
    await B.evaluate(() => { const k = window.klibb; k.moveTo(1, -1); k.look(2.4, 0.3); }); await sleep(900);
    const shotB = path.join(SHOTS, '4-seen-by-another-player.png'); await B.screenshot({ path: shotB });
    check('…on screen too', (await share(shotB, magenta)) > 0.05);
    await sleep(1200);
    await A.evaluate(() => document.getElementById('rec-toggle').click());
    await A.waitForFunction(() => !window.klibb.rec(), null, { timeout: 8000 });
    await sleep(800);
    const logText = await (await fetch(`${S.base}/api/rooms/${R}/recordings/${recId}/log`)).text();
    const lines = logText.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const head = lines.find((l) => l.style);
    check('the recording carries it (the header room look)', head && sameFab(head.style.fabric), head && head.style);
    const RP = await page(browser, S, `${S.base}/?room=${R}&replay=${recId}`, {}, errors);
    await sleep(6000);
    const shotR = path.join(SHOTS, '5-replay.png'); await RP.screenshot({ path: shotR });
    check('…and the replay draws it', (await share(shotR, magenta)) > 0.05);
    // free version
    await B.evaluate(() => window.klibb.openStylePanel('create')); await B.waitForSelector('#style-panel:not([hidden])');
    const bf = await fargOf(B);
    check('free version: no Färg row in the New quick room panel (no upsell)', !bf.row, bf);
    await B.evaluate(() => document.getElementById('style-cancel').click());
    const style = { floor: 'parkett', wall: 'tegel', ceiling: 'vit', fabric: want };
    const freeRoom = await post(S, '/api/rooms', { style }), fullRoom = await post(S, '/api/rooms', { style }, { 'x-dev-unlock': '1' });
    check('server: the free version\'s Färg is dropped (the rest of the look kept), the full version\'s kept', freeRoom.room && !freeRoom.room.style.fabric && freeRoom.room.style.floor === 'parkett' && sameFab(fullRoom.room.style.fabric), { free: freeRoom.room?.style, full: fullRoom.room?.style });
    const bad = await post(S, '/api/rooms', { style: { ...style, fabric: { id: '../etc', base: 'red' } } }, { 'x-dev-unlock': '1' });
    check('…a bad image id is dropped, the rest of the look stays', bad.room && !bad.room.style.fabric && bad.room.style.wall === 'tegel', bad);
    // OPEN_ACCESS on: open for everyone
    const oRoom = await post(O, '/api/rooms', { preset: false });
    const C = await page(browser, O, `${O.base}/?room=${oRoom.room.id}`, {}, errors);
    await ready(C); await C.evaluate(() => window.klibb.openStylePanel('create')); await C.waitForSelector('#style-panel:not([hidden])');
    check('OPEN_ACCESS on: Färg is there for everyone', (await fargOf(C)).row);
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  finally { await browser.close(); S.child.kill(); O.child.kill(); }
  console.log(`\nFärg e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
