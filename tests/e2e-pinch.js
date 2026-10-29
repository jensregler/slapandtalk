// E2E: pinch to scale, twist to rotate on a phone (Jens, 29 Oct 2026; replaces the two edge sliders).
// iPhone-sized touch emulation, REAL two-finger touch events (CDP Input.dispatchTouchEvent). With a
// sticker in hand (held in the middle), two fingers: the distance ratio scales it, the change of the
// fingers' angle turns it, live, with the usual limits (free 15–100 cm, full 5 cm – no max, nature
// 5–400 cm); the size is kept when switching sticker; no stamp, no camera turn; a second finger during
// aiming cancels the aim. The sliders are gone on the phone (desktop keeps its size/rotation inputs).
// Own server (PINCH_E2E_PORT, default 8873). Screenshots: PINCH_SHOTS (default /workspace/pinch-shots).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep, openAccess } = require('./demo-helpers');

const PORT = Number(process.env.PINCH_E2E_PORT || 8873);
const SHOTS = process.env.PINCH_SHOTS || '/workspace/pinch-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
const W = 390, H = 844, CX = W / 2, CY = H / 2;

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', ADMIN_TOKEN: 'pinch-e2e-admin' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  const OPEN = await openAccess(S.base); // OPEN ACCESS: the 'free' phone has the full limits (5 cm – no max)
  if (OPEN) console.log('  – OPEN ACCESS is on: the free phone gets the full limits (run with OPEN_ACCESS=0 for the free 15–100 cm)');
  const phone = async (full) => {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await ctx.addInitScript(([r, k, f]) => { localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })); if (f) localStorage.setItem('klibb.devUnlock', '1'); }, [made.room.id, made.roomKey, full]);
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${made.room.id}`);
    await P.waitForFunction((f) => window.klibb && window.klibb.ready && window.klibb.state.selected && document.body.classList.contains('touch') && window.klibb.natureOpen() === f, full || OPEN, { timeout: 30000 });
    await P.evaluate(() => { const k = window.klibb; k.moveTo(0, 1); k.look(0, 0); k.setSize(30); k.stackMenu().chosen(); });
    await sleep(500);
    const cdp = await ctx.newCDPSession(P);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
    const at = (r, deg) => { const a = (deg * Math.PI) / 180; return [[CX - r * Math.cos(a), CY - r * Math.sin(a), 1], [CX + r * Math.cos(a), CY + r * Math.sin(a), 2]]; };
    // two fingers from (r0, a0) to (r1, a1) around the middle, then lifted (one after the other)
    const pinch = async (r0, r1, a0 = 0, a1 = a0, { steps = 10, keep = false } = {}) => {
      const p0 = at(r0, a0);
      await T('touchStart', [p0[0]]); await sleep(30); await T('touchStart', p0); await sleep(60);
      for (let i = 1; i <= steps; i++) { await T('touchMove', at(r0 + ((r1 - r0) * i) / steps, a0 + ((a1 - a0) * i) / steps)); await sleep(30); }
      await sleep(120);
      const mid = await st();
      if (!keep) { const p1 = at(r1, a1); await T('touchEnd', [p1[1]]); await sleep(40); await T('touchEnd', []); await sleep(300); }
      return mid;
    };
    const st = () => P.evaluate(() => { const k = window.klibb; return { cm: Math.round(k.state.size * 1000) / 10, rot: k.state.rotation, n: k.stamps.count, yaw: +k.controls.yaw.toFixed(4), pitch: +k.controls.pitch.toFixed(4),
      pinch: k.touchPinch(), aim: k.touchAim(), preview: k.preview.mesh.visible, hud: getComputedStyle(document.getElementById('pinch-hud')).display !== 'none' ? document.getElementById('pinch-hud').textContent : null,
      heldPx: Math.round(document.getElementById('held').getBoundingClientRect().width), heldRot: getComputedStyle(document.getElementById('held')).getPropertyValue('--held-rot').trim(), lim: k.limitsFor(), sel: k.state.selected.id, nat: !!k.state.selected.nature }; });
    return { ctx, P, T, pinch, st };
  };
  try {
    // ---- free ----
    const F = await phone(false);
    const sl = await F.P.evaluate(() => ({ rot: !!document.getElementById('edge-rot'), size: !!document.getElementById('edge-size'), edges: document.querySelectorAll('.edge').length }));
    check('phone: the two vertical sliders (rotation left #edge-rot, size right #edge-size) are gone', !sl.rot && !sl.size && !sl.edges, sl);
    const f0 = await F.st();
    const f1 = await F.pinch(40, 80);
    check(`free: pinch out (×2) → twice the size live (${f0.cm} → ${f1.cm} cm), the held sticker grows (${f0.heldPx} → ${f1.heldPx} px), the readout shows "${f1.hud}"`, f0.cm === 30 && f1.cm === 60 && f1.heldPx > f0.heldPx && f1.pinch && /60 cm/.test(f1.hud || ''), { f0, f1 });
    await F.P.screenshot({ path: path.join(SHOTS, 'free-pinch-out.png') });
    const f2 = await F.st();
    check('…a pinch stamps nothing, the camera does not turn, and the size stays after lifting the fingers', f2.cm === 60 && f2.n === f0.n && f2.yaw === f0.yaw && f2.pitch === f0.pitch && !f2.pinch && !f2.preview, f2);
    const f3 = await F.pinch(80, 30);
    check(`free: pinch in → smaller (60 → ${f3.cm} cm, ×0.375 = 22.5)`, f3.cm === 22.5, f3);
    const f4 = await F.pinch(80, 10);
    check(OPEN ? `open access: pinch in hard → the full 5 cm floor (${f4.cm})` : `free: pinch in hard → clamped at the free 15 cm floor (${f4.cm})`, f4.cm === (OPEN ? 5 : 15), f4);
    const f5 = await F.pinch(15, 170);
    check(OPEN ? `open access: pinch out hard → ×11 from 5 cm (${f5.cm} cm), no max (limits ${f5.lim.minCm} cm – ${f5.lim.maxCm})` : `free: pinch out hard → clamped at the free 100 cm cap (${f5.cm})`, OPEN ? f5.cm > 50 && f5.cm < 60 && f5.lim.maxCm === Infinity : f5.cm === 100, f5);
    await F.P.evaluate(() => window.klibb.setSize(30));
    const f6 = await F.pinch(70, 70, 0, 35);
    check(`free: twist 35° clockwise (same distance) → rotation +35° (${f6.rot}°), the size unchanged (${f6.cm}), the held sticker turned (${f6.heldRot})`, f6.rot === 35 && f6.cm === 30 && f6.heldRot === '35deg', f6);
    await F.P.screenshot({ path: path.join(SHOTS, 'free-twist.png') });
    const f7 = await F.pinch(60, 90, 10, -20);
    check(`free: pinch + twist together: ×1.5 and −30° (${f7.cm} cm, ${f7.rot}°)`, f7.cm === 45 && f7.rot === 5, f7);
    const after = await F.st();
    await F.P.evaluate(() => { window.klibb.nextDesign(); window.klibb.stackMenu().chosen(); }); await sleep(300);
    const sw = await F.st();
    check('switching sticker keeps the pinched size and turn (as with the sliders)', sw.sel !== after.sel && sw.cm === after.cm && sw.rot === after.rot, { after, sw });
    // a second finger while aiming: no stamp
    const n0 = sw.n;
    await F.T('touchStart', [[100, 300, 1]]); for (let i = 1; i <= 4; i++) { await F.T('touchMove', [[100 + i * 10, 300, 1]]); await sleep(30); }
    const a1 = await F.st();
    await F.T('touchStart', [[110 + 40, 300, 1], [260, 380, 2]]); await sleep(80);
    for (let i = 1; i <= 6; i++) { await F.T('touchMove', [[150 - i * 5, 300, 1], [260 + i * 10, 380, 2]]); await sleep(30); }
    const a2 = await F.st();
    await F.T('touchEnd', [[320, 380, 2]]); await sleep(40); await F.T('touchEnd', []); await sleep(700);
    const a3 = await F.st();
    check('a second finger while aiming cancels the aim and starts a pinch; lifting both stamps nothing', a1.aim && !a2.aim && a2.pinch && !a2.preview && a3.n === n0 && !a3.aim && !a3.pinch && a3.cm !== a1.cm, { a1: [a1.aim, a1.cm], a2: [a2.aim, a2.pinch], a3: [a3.n, n0, a3.cm] });
    check('…and the camera did not turn', a3.yaw === f0.yaw && a3.pitch === f0.pitch, a3);
    // nothing in hand: two fingers look around as before, no scaling
    await F.P.evaluate(() => window.klibb.stackMenu().held.placed(performance.now() - 60000)); await sleep(300);
    const g0 = await F.st();
    await F.T('touchStart', [[120, 400, 1]]); await sleep(30); await F.T('touchStart', [[120, 400, 1], [260, 400, 2]]); await sleep(40);
    for (let i = 1; i <= 8; i++) { await F.T('touchMove', [[120 + i * 15, 400, 1], [260 + i * 25, 400, 2]]); await sleep(30); }
    await F.T('touchEnd', [[380, 400, 2]]); await F.T('touchEnd', []); await sleep(400);
    const g1 = await F.st();
    check('nothing in hand (faded): two fingers look around (the view turns), no scaling, no stamp', g1.yaw !== g0.yaw && g1.cm === g0.cm && g1.n === g0.n, { g0, g1 });
    await F.ctx.close();

    // ---- full ----
    const U = await phone(true);
    const u1 = await U.pinch(100, 10);
    check(`full: pinch in → down to the full 5 cm floor (${u1.cm})`, u1.cm === 5, u1);
    await U.P.evaluate(() => window.klibb.setSize(30));
    const u2 = await U.pinch(10, 180);
    check(`full: pinch out ×18 → 540 cm (no max in the full version) (${u2.cm})`, u2.cm === 540, u2);
    // nature (full version only)
    await U.P.evaluate(() => { const k = window.klibb; return k.selectDesign(k.natureDesigns()[0]).then(() => { k.setSize(30); k.stackMenu().chosen(); }); }); await sleep(400);
    const u3 = await U.pinch(10, 180);
    check(`full, nature sticker: pinch out → clamped at the nature 400 cm (${u3.cm}; limits ${u3.lim.minCm}–${u3.lim.maxCm})`, u3.nat && u3.cm === 400 && u3.lim.maxCm === 400, u3);
    const u4 = await U.pinch(180, 2);
    check(`full, nature sticker: pinch in → clamped at the nature 5 cm (${u4.cm})`, u4.nat && u4.cm === 5, u4);
    await U.P.evaluate(() => window.klibb.setSize(60)); await sleep(100);
    await U.pinch(60, 90, 0, 20, { keep: true });
    await U.P.screenshot({ path: path.join(SHOTS, 'full-nature-pinching.png') });
    await U.T('touchEnd', []); await sleep(300);
    await U.ctx.close();

    // ---- desktop: unchanged (its size/rotation inputs in the panel) ----
    const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const D = await dctx.newPage(); D.on('pageerror', (e) => errors.push(e.message));
    await D.goto(S.base + '/'); await D.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    const dk = await D.evaluate(() => ({ touch: document.body.classList.contains('touch'), size: !!document.getElementById('size') && getComputedStyle(document.getElementById('size')).display !== 'none', rot: !!document.getElementById('rot'), edges: document.querySelectorAll('.edge').length, hud: getComputedStyle(document.getElementById('pinch-hud')).display }));
    check('desktop: unchanged – the size slider and rotation input are there, no phone sliders, no pinch readout', !dk.touch && dk.size && dk.rot && dk.edges === 0 && dk.hud === 'none', dk);
    await dctx.close();
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  finally {
    await browser.close(); S.child.kill(); fs.rmSync(S.dir, { recursive: true, force: true });
    console.log(`\nPinch e2e: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();
