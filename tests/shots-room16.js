// Screenshots for the 16 × 8 × 16 m room (t475u) → ROOM16_SHOTS (default /workspace/roomsize16-shots).
// Own server (ROOM16_PORT, default 8990). COZY_DIR: Cozy Village's six faces (from prod, read-only).
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const SHOTS = process.env.ROOM16_SHOTS || '/workspace/roomsize16-shots';
const PORT = Number(process.env.ROOM16_PORT || 8990), COZY = process.env.COZY_DIR || '/tmp/cozy';
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S0 = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  // Cozy Village as a local preset (the old 10 × 4 × 10 m bake, no geo)
  const id = 'af39b8617f';
  fs.mkdirSync(path.join(S0.dir, 'presets', id), { recursive: true });
  for (const f of ['floor', 'ceiling', 'north', 'south', 'west', 'east', 'thumb']) fs.copyFileSync(path.join(COZY, f + '.webp'), path.join(S0.dir, 'presets', id, f + '.webp'));
  const faces = Object.fromEntries(['floor', 'ceiling', 'north', 'south', 'west', 'east'].map((f) => [f, `/api/presets/${id}/${f}.webp?v=1`]));
  fs.writeFileSync(path.join(S0.dir, 'presets', id + '.json'), JSON.stringify({ id, name: 'Cozy Village', title: 'Cozy Village', sourceRoom: 'jgfdn9', style: { floor: 'klassisk', wall: 'klassisk', ceiling: 'klassisk' }, faces, px: 1600, createdAt: '2026-11-01T10:00:00Z', thumb: `/api/presets/${id}/thumb.webp?v=1` }));
  S0.child.kill(); await sleep(500);
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1', DATA_DIR: S0.dir });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  const room = async (body = { preset: false }) => (await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json());
  const open = async (r, { w = 1600, h = 1000, touch = false } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    await ctx.addInitScript(([rid, k]) => { localStorage.setItem('klibb.roomKeys', JSON.stringify({ [rid]: k })); localStorage.setItem('klibb.devUnlock', '1'); }, [r.room.id, r.roomKey]);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${S.base}/?room=${r.room.id}`);
    await p.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected, null, { timeout: 60000 });
    await sleep(1500); return p;
  };
  const hideUi = (p) => p.addStyleTag({ content: '#toast,#hint{display:none!important}' });
  const shot = (p, n) => p.screenshot({ path: path.join(SHOTS, n) });
  try {
    // 1) empty room, from the door side corner
    const r1 = await room(); const P = await open(r1); await hideUi(P);
    await P.evaluate(() => { const k = window.klibb; k.setView('first', { quiet: true }); k.moveTo(6.5, 6.5); k.look(Math.PI / 4, 0.05); }); await sleep(1200);
    await shot(P, '01-empty-room-16x8x16.png');
    const info = await P.evaluate(() => ({ size: window.klibb.roomSize(), bounds: window.klibb.roomBounds() }));
    console.log('room', JSON.stringify(info));
    // 2) busy room: a lot of stickers on the north wall and floor
    const lib = await P.evaluate(() => window.klibb.stickerDesigns().slice(6, 60));
    await P.evaluate(() => { const k = window.klibb; k.moveTo(0, -1); k.look(0, 0.15); }); await sleep(500);
    let i = 0;
    for (const d of lib) {
      await P.evaluate(([d, i]) => { const k = window.klibb; k.selectDesign(d); k.controls.locked = true; k.setSize(30 + (i % 5) * 25); }, [d, i]); await sleep(120);
      const x = ((i * 37) % 100) / 100 * 1.8 - 0.9, y = ((i * 53) % 100) / 100 * 1.6 - 0.75;
      await P.evaluate(([x, y]) => window.klibb.stampAt(x, y), [x, y]); i++;
    }
    await P.evaluate(() => { window.klibb.controls.locked = false; }); await sleep(800);
    await P.evaluate(() => { const k = window.klibb; k.moveTo(4, 5); k.look(0.35, 0.1); }); await sleep(1200);
    await shot(P, '02-busy-room.png');
    // 3) biggest and smallest sticker (full version: 1.5 m, 10 cm) and nature (10 cm, 8 m high)
    await P.evaluate(() => { const k = window.klibb; k.moveTo(-4, 0); k.look(Math.PI / 2, 0.1); }); await sleep(400); // facing the west wall
    const big = await P.evaluate(async (d) => { const k = window.klibb; k.selectDesign(d); await new Promise((r) => setTimeout(r, 300)); k.controls.locked = true; k.setSize(999); const a = await k.stampAt(-0.3, 0); k.setSize(1); const b = await k.stampAt(0.35, -0.1); k.controls.locked = false; return [a && a.size, b && b.size]; }, lib[3]);
    console.log('sticker sizes (max, min)', big);
    await sleep(800); await shot(P, '03-biggest-1.5m-and-smallest-10cm-sticker.png');
    await P.evaluate(() => { const k = window.klibb; k.moveTo(-6.5, 0); k.look(Math.PI / 2, 0.1); }); await sleep(800);
    await shot(P, '03b-smallest-10cm-close-up.png');
    await P.keyboard.press('KeyV'); await sleep(1500); // Nature mode
    await P.evaluate(() => { const k = window.klibb; k.moveTo(0, 5); k.look(0, 0.05); }); await sleep(400);
    const nat = await P.evaluate(async () => { const k = window.klibb; k.controls.locked = true; k.setSize(99999); const a = await k.stampAt(0.2, 0); k.setSize(1); const b = await k.stampAt(-0.45, -0.3); k.controls.locked = false; return [a && a.size, b && b.size, k.state.selected && [k.state.selected.width, k.state.selected.height]]; });
    console.log('nature sizes (max, min, px)', nat);
    await P.evaluate(() => { const k = window.klibb; k.moveTo(0, 7); k.look(0, 0.3); }); await sleep(1200);
    await shot(P, '04-nature-max-8m-high-and-min-10cm.png');
    // 4) Cozy Village (an old 10 × 4 × 10 m preset) in the new room
    const r2 = await room({ preset: id }); const C = await open(r2); await hideUi(C);
    await C.waitForFunction(() => window.klibb.presetLayer && window.klibb.presetLayer().loaded >= 6, null, { timeout: 30000 }).catch(() => {});
    await C.evaluate(() => { const k = window.klibb; k.setView('first', { quiet: true }); k.moveTo(0, 6.5); k.look(0, 0.12); }); await sleep(1500);
    await shot(C, '05-preset-cozy-village-north.png');
    await C.evaluate(() => { const k = window.klibb; k.moveTo(6.5, 6.5); k.look(Math.PI / 4, 0.1); }); await sleep(1200);
    await shot(C, '06-preset-cozy-village-corner.png');
    await C.evaluate(() => { const k = window.klibb; k.moveTo(0, 2); k.look(0, 0.75); }); await sleep(1200);
    await shot(C, '07-preset-cozy-village-ceiling.png');
    // 5) phone
    const r3 = await room(); const M = await open(r3, { w: 390, h: 844, touch: true }); await hideUi(M);
    await M.evaluate(() => { const k = window.klibb; k.moveTo(0, 5); k.look(0, 0.08); }); await sleep(1200);
    await shot(M, '08-phone.png');
    const M2 = await open(r2, { w: 390, h: 844, touch: true }); await hideUi(M2);
    await M2.evaluate(() => { const k = window.klibb; k.moveTo(0, 6); k.look(0, 0.1); }); await sleep(2000);
    await shot(M2, '09-phone-cozy-village.png');
    console.log('errors', JSON.stringify(errors));
  } catch (e) { console.log('crashed', e.stack || e); }
  await browser.close(); S.child.kill();
})();
