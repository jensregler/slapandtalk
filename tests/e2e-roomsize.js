// E2E: the room size test (Jens, 2 Nov 2026: Height / Width / Depth sliders in the room panel to try
// sizes and pick ONE size for all rooms; client/src/roomsize.js). Only this view changes: not synced,
// not saved. Surfaces, bounds and lights follow; stickers on walls / ceiling and a preset's sheets move
// with their surface; slapping is off at a test size; reset = the normal size (shared/room.json).
// Own server (ROOMSIZE_E2E_PORT, default 8905). Screenshots: PRESETPICKER_SHOTS (/workspace/presetpicker-shots).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.ROOMSIZE_E2E_PORT || 8905);
const SHOTS = process.env.PRESETPICKER_SHOTS || '/workspace/presetpicker-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errs = [];
  try {
    const mk = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ style: { floor: 'betong', wall: 'tegel' }, preset: false }) })).json();
    const ready = (p) => p.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected && window.klibb.state.library.length > 0 && window.klibb.net.status === 'online', null, { timeout: 30000 });
    const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); p.on('pageerror', (e) => errs.push(e.message));
    const o = await (await b.newContext({ viewport: { width: 800, height: 600 } })).newPage(); o.on('pageerror', (e) => errs.push('o: ' + e.message));
    await p.goto(`${S.base}/?room=${mk.room.id}`); await ready(p);
    await o.goto(`${S.base}/?room=${mk.room.id}`); await ready(o);
    // stickers: north wall, east wall, ceiling, floor
    const spots = [[0, 0.1], [-Math.PI / 2, 0.1], [0, 1.3], [0, -1.2]];
    for (const [yaw, pitch] of spots) {
      await p.evaluate(async ([yaw, pitch]) => { const k = window.klibb; k.setSize(80); k.setView?.('first', { quiet: true }); k.moveTo(0, 0); k.look(yaw, pitch); await new Promise((r) => setTimeout(r, 120)); return k.stampAt(0, 0); }, [yaw, pitch]);
      await sleep(300);
    }
    await p.waitForFunction(() => window.klibb.pendingSlaps() === 0, null, { timeout: 15000 });
    // the box of each sticker mesh / chunk, by surface
    const boxes = () => p.evaluate(() => {
      const out = []; window.klibb.scene?.traverse?.((m) => { if (m.isMesh && (m.userData.stamp || m.userData.bakedChunk)) { m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox; out.push([bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z].map((x) => Math.round(x * 100) / 100)); } });
      return out;
    });
    const hasScene = await p.evaluate(() => !!(window.klibb.scene && window.klibb.scene.traverse));
    const b0 = hasScene ? await boxes() : [];
    check('4 stickers slapped (north wall, east wall, ceiling, floor)', (await p.evaluate(() => window.klibb.stamps.meshes.size)) === 4, b0);
    await p.evaluate(() => { const k = window.klibb; k.moveTo(0, 4.2); k.look(0, -0.05); });
    await p.evaluate(() => window.klibb.openRoomPanel()); await sleep(700);
    const ui = await p.evaluate(() => ({ vals: ['height', 'width', 'depth'].map((k) => document.getElementById(`rs-${k}-val`).textContent), sum: document.getElementById('rs-sum').textContent, ranges: ['height', 'width', 'depth'].map((k) => { const i = document.getElementById(`rs-${k}`); return [i.min, i.max, i.step]; }) }));
    check('the room panel: Height / Width / Depth sliders showing 8 m / 16 m / 16 m (the normal size, t475u), with their ranges', ui.vals.join() === '8 m,16 m,16 m' && /16 m wide × 16 m deep × 8 m high/.test(ui.sum), ui);
    await sleep(800); await p.screenshot({ path: path.join(SHOTS, '10-roomsize-normal-16x16x8.png') });
    // drag the sliders the way a person does (fill + input event)
    const slide = async (k, v) => { await p.evaluate(([k, v]) => { const i = document.getElementById(`rs-${k}`); i.value = String(v); i.dispatchEvent(new Event('input', { bubbles: true })); }, [k, v]); await sleep(150); };
    await slide('height', 6); await slide('width', 16); await slide('depth', 12);
    const st = await p.evaluate(() => { const k = window.klibb; const s = k.roomSize(); const surf = Object.fromEntries(k.roomSurfaces().map((m) => [m.name, [m.geometry.parameters.width, m.geometry.parameters.height, m.position.x, m.position.y, m.position.z].map((x) => Math.round(x * 100) / 100)])); return { s, surf, val: document.getElementById('rs-height-val').textContent, note: document.getElementById('rs-note').textContent }; });
    check('Height 6, Width 16, Depth 12: the size and the numbers shown', st.s.height === 6 && st.s.width === 16 && st.s.depth === 12 && !st.s.normal && st.val === '6 m', st);
    check('…the surfaces: floor 16×12, ceiling at 6 m, north wall 16×6 at z −6, east wall 12×6 at x 8', st.surf['golv'].slice(0, 2).join() === '16,12' && st.surf['tak'][3] === 6 && st.surf['vägg-norr'].join() === '16,6,0,3,-6' && st.surf['vägg-öster'].join() === '12,6,8,3,0', st.surf);
    await sleep(1200);
    const b1 = hasScene ? await boxes() : [];
    const n = (bs) => bs.find((x) => x[2] < -4.5 && x[5] < -4.5), e = (bs) => bs.find((x) => x[0] > 4.5), c = (bs) => bs.find((x) => x[1] > 3.5), f = (bs) => bs.find((x) => x[4] < 0.1);
    check('…the stickers follow: on the north wall at z −6, the east wall at x 8, the ceiling at 6 m; the floor one stays', n(b1) && Math.abs(n(b1)[2] + 6) < 0.05 && e(b1) && Math.abs(e(b1)[3] - 8) < 0.05 && c(b1) && Math.abs(c(b1)[4] - 6) < 0.05 && JSON.stringify(f(b1)) === JSON.stringify(f(b0)), { b0, b1 });
    const walk = await p.evaluate(() => { const k = window.klibb; k.moveTo(7.5, 5.5); return k.where?.() || null; });
    const bnd = await p.evaluate(() => { const bb = window.klibb.roomBounds(); return [bb.min.x, bb.max.x, bb.min.z, bb.max.z, bb.max.y].map((x) => Math.round(x * 100) / 100); });
    check('…you can walk in the bigger room (bounds 16 × 12 m less the margin)', bnd.join() === '-7.65,7.65,-5.65,5.65,6', { bnd, walk });
    await p.evaluate(() => { const k = window.klibb; k.moveTo(0, 5.6); k.look(0, -0.05); }); await sleep(1500);
    await p.screenshot({ path: path.join(SHOTS, '11-roomsize-16x12x6.png') });
    const slap = await p.evaluate(async () => { const k = window.klibb; k.look(0, 0.1); return !!(await k.stampAt(0, 0)); });
    check('at a test size slapping is off (a toast says why), nothing sent', !slap && (await p.evaluate(() => window.klibb.stamps.meshes.size)) === 4);
    const srv = (await (await fetch(`${S.base}/api/rooms/${mk.room.id}`)).json()).room;
    const other = await o.evaluate(() => { const k = window.klibb; return { s: k.roomSize(), w: k.roomSurfaces().find((m) => m.name === 'golv').geometry.parameters.width }; });
    check('not synced, not saved: the other person still has 16 × 16 × 8, the server room has no size', other.s.normal && other.w === 16 && !('size' in srv) && !JSON.stringify(srv).includes('"width"'), { other, srv });
    await slide('height', 3); await slide('width', 7); await slide('depth', 8); await sleep(1500);
    await p.evaluate(() => { const k = window.klibb; k.moveTo(0, 3.6); k.look(0, -0.05); }); await sleep(800);
    await p.screenshot({ path: path.join(SHOTS, '12-roomsize-7x8x3.png') });
    await slide('height', 99); 
    check('the slider ranges hold (height max 20 m)', (await p.evaluate(() => window.klibb.roomSize().height)) === 20);
    await p.evaluate(() => { const k = window.klibb; k.moveTo(0, 3.6); k.look(0, 0.25); }); await sleep(1200);
    await p.screenshot({ path: path.join(SHOTS, '13-roomsize-7x8x20.png') });
    await p.click('#rs-reset'); await sleep(1200);
    const b2 = hasScene ? await boxes() : [];
    const back = await p.evaluate(() => ({ s: window.klibb.roomSize(), vals: ['height', 'width', 'depth'].map((k) => document.getElementById(`rs-${k}-val`).textContent) }));
    const same = (a, bb) => a && bb && a.every((x, i) => Math.abs(x - bb[i]) < 0.02);
    check('↺ Reset: back to 16 × 16 × 8, numbers too, the stickers exactly where they were', back.s.normal && back.vals.join() === '8 m,16 m,16 m' && same(n(b2), n(b0)) && same(e(b2), e(b0)) && same(c(b2), c(b0)), { back, b0, b2 });
    const slap2 = await p.evaluate(async () => { const k = window.klibb; k.moveTo(0, 0); k.look(0.3, 0.1); await new Promise((r) => setTimeout(r, 150)); return !!(await k.stampAt(0, 0)); });
    check('…and slapping works again', slap2);
    // phone
    const m = await (await b.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage(); m.on('pageerror', (e2) => errs.push('m: ' + e2.message));
    await m.goto(`${S.base}/?room=${mk.room.id}`); await m.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    await m.evaluate(() => window.klibb.openRoomPanel()); await sleep(600);
    await m.evaluate(() => document.getElementById('room-size').scrollIntoView()); await sleep(300);
    await m.screenshot({ path: path.join(SHOTS, '14-roomsize-phone-panel.png') });
    check('no page errors', errs.length === 0, errs);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await b.close(); S.child.kill();
  console.log(`\nRoom size e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
