// E2E: the held sticker fades after 2 s untouched – desktop AND phone, Slap mode AND Nature mode
// (Jens, 29 Oct 2026: "Klibborna (både i slap mode och nature mode) ska fejda efter ett par sekunder –
// de gör det inte nu. Fixa så att varje klibba fejdar per tag"). Before: only the phone faded; on the
// desktop the held sticker (the preview on the wall at the crosshair) never did.
// Same rules everywhere (shared/heldtimer.mjs): a newly chosen sticker is sharp until it is placed;
// each placement restarts the clock: sharp 2 s, then a 1 s fade; any input restarts the 2 s; a
// tap while faded only brings it back (phone; no slap). Desktop: moving the mouse brings it back, and a
// click while faded still slaps (the crosshair aims).
// Phone safety: a lost pointerup (iOS) no longer keeps it sharp for good.
// Own server (HELDFADE_E2E_PORT, default 8893). Screenshots: HELDFADE_SHOTS (default /workspace/heldfade-shots).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.HELDFADE_E2E_PORT || 8893);
const SHOTS = process.env.HELDFADE_SHOTS || '/workspace/heldfade-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', ADMIN_TOKEN: 'heldfade-e2e-admin' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  const room = async () => (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  try {
    // ---------------- desktop ----------------
    for (const nature of [false, true]) {
      const tag = nature ? 'desktop Nature mode' : 'desktop Slap mode';
      const made = await room();
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      await ctx.addInitScript(([r, k]) => { localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })); localStorage.setItem('klibb.devUnlock', '1'); }, [made.room.id, made.roomKey]);
      const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
      await P.goto(`${S.base}/?room=${made.room.id}`);
      await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected, null, { timeout: 30000 });
      await P.evaluate(() => { const k = window.klibb; k.moveTo(0, 1); k.look(0, 0); });
      await P.mouse.click(600, 200); await P.waitForFunction(() => window.klibb.controls.locked, null, { timeout: 5000 });
      if (nature) { await P.keyboard.press('KeyV'); await sleep(1500); }
      const st = () => P.evaluate(() => { const k = window.klibb; return { ...k.deskHeld(), n: k.stamps.count, nature: k.natureMode(), selNat: !!(k.state.selected && k.state.selected.nature) }; });
      const s0 = await st();
      if (nature) check(`${tag}: V → Nature mode, a nature sticker held`, s0.nature && s0.selNat, s0);
      check(`${tag}: a newly chosen sticker is held sharp (no clock until it is placed)`, s0.state === 'holding' && s0.previewVisible && s0.previewOpacity === 1, s0);
      await sleep(3200);
      const s0b = await st();
      check(`${tag}: …still sharp after 3 s (not placed yet)`, s0b.state === 'holding' && s0b.previewVisible, s0b);
      await P.mouse.down(); await P.mouse.up(); await sleep(900); // (the preview steps aside ~0.6 s while the slap lands)
      const s1 = await st();
      check(`${tag}: a click slaps it; the 2 s clock starts (sharp)`, s1.n > s0.n && s1.state === 'timed' && s1.canSlap && s1.previewVisible && s1.previewOpacity === 1, s1);
      await sleep(1500);
      const s2 = await st();
      check(`${tag}: ~2.4 s untouched: fading (0 < opacity < 1)`, s2.previewVisible && s2.previewOpacity > 0 && s2.previewOpacity < 1 && !s2.canSlap, s2);
      await sleep(900);
      const s3 = await st();
      check(`${tag}: ~3.3 s untouched: gone (faded, no held sticker on the wall)`, s3.opacity === 0 && !s3.previewVisible, s3);
      await P.screenshot({ path: path.join(SHOTS, `${nature ? 'nature' : 'slap'}-desktop-faded.png`) });
      await P.mouse.down(); await P.mouse.up(); await sleep(900);
      const s4 = await st();
      check(`${tag}: a click while faded still slaps on the desktop (the crosshair aims) and brings it back sharp`, s4.n > s3.n && s4.state === 'timed' && s4.canSlap && s4.previewVisible && s4.previewOpacity === 1, s4);
      const s5 = s4;
      // per placement: each slap restarts the 2 s
      await sleep(1500); await P.mouse.down(); await P.mouse.up(); await sleep(1500);
      const s6 = await st();
      check(`${tag}: each placement restarts the clock ("per tag": 3 s after the first of two slaps 1.5 s apart: still sharp)`, s6.n > s5.n && s6.canSlap && s6.previewOpacity === 1, s6);
      await sleep(1900);
      const s6b = await st();
      check(`${tag}: …and it fades 2 s after the last one`, s6b.opacity === 0 && !s6b.previewVisible, s6b);
      // any input keeps it up; moving the mouse brings a faded one back
      await P.mouse.move(610, 400); await sleep(200); // back
      const n7 = (await st()).n;
      for (let i = 0; i < 8; i++) { await P.mouse.move(600 + (i % 2 ? 6 : -6), 400); await sleep(450); }
      const s7 = await st();
      check(`${tag}: moving the mouse (looking around) keeps it sharp (3.6 s of moves)`, s7.canSlap && s7.previewOpacity === 1 && s7.n === n7, s7);
      for (let i = 0; i < 6; i++) { await P.keyboard.press('KeyQ'); await sleep(500); } // (an unbound key – just input)
      const s7k = await st();
      check(`${tag}: keys keep it up too`, s7k.canSlap && s7k.previewOpacity === 1, s7k);
      await sleep(3200);
      check(`${tag}: then 3 s still: faded`, (await st()).opacity === 0);
      await P.mouse.move(640, 420); await sleep(200);
      const s8 = await st();
      check(`${tag}: moving the mouse again brings it back (desktop)`, s8.canSlap && s8.previewVisible && s8.previewOpacity === 1, s8);
      await ctx.close();
    }

    // ---------------- phone ----------------
    for (const nature of [false, true]) {
      const tag = nature ? 'phone Nature mode' : 'phone Slap mode';
      const made = await room();
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await ctx.addInitScript(([r, k]) => { localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })); localStorage.setItem('klibb.devUnlock', '1'); }, [made.room.id, made.roomKey]);
      const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
      await P.goto(`${S.base}/?room=${made.room.id}`);
      await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected && document.body.classList.contains('touch'), null, { timeout: 30000 });
      await P.evaluate(() => { const k = window.klibb; k.moveTo(0, 1); k.look(0, 0); });
      if (nature) {
        await P.evaluate(() => { const k = window.klibb; const d = k.natureDesigns ? k.natureDesigns()[0] : null; return d; });
        await P.evaluate(() => { document.body.classList.add('wheel-up'); window.klibb.natureWheelApi.render(); });
        await sleep(400);
        await P.evaluate(() => { const b = [...document.querySelectorAll('#nature-row .strip-th')].find((x) => x.style.display !== 'none' && Math.abs(+x.dataset.d) < 0.01); b.click(); });
        await P.evaluate(() => document.body.classList.remove('wheel-up'));
        await sleep(900);
      } else await P.evaluate(() => window.klibb.stackMenu().chosen());
      await sleep(400);
      const cdp = await ctx.newCDPSession(P);
      const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id = 1]) => ({ x, y, id })) });
      const tap = async (x, y) => { await T('touchStart', [[x, y]]); await sleep(60); await T('touchEnd', []); };
      const st = () => P.evaluate(() => { const k = window.klibb; return { ...k.held(), n: k.stamps.count, nature: k.natureMode(), selNat: !!(k.state.selected && k.state.selected.nature) }; });
      const s0 = await st();
      if (nature) check(`${tag}: the Nature wheel → Nature mode, a nature sticker held`, s0.nature && s0.selNat, s0);
      check(`${tag}: chosen = sharp in its holder`, s0.state === 'holding' && s0.opacity === 1, s0);
      await tap(195, 330); await sleep(400);
      const s1 = await st();
      check(`${tag}: a tap slaps it; the clock starts`, s1.n > s0.n && s1.state === 'timed' && s1.canSlap, s1);
      await sleep(3000);
      const s2 = await st();
      check(`${tag}: ~3.4 s untouched: faded`, s2.opacity === 0 && !s2.heldShown, s2);
      await tap(195, 330); await sleep(300);
      const s3 = await st();
      check(`${tag}: a tap while faded only wakes it (no slap)`, s3.n === s2.n && s3.canSlap, s3);
      // a lost pointerup: a synthetic touch pointerdown that never gets its pointerup …
      await P.evaluate(() => window.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 999, pointerType: 'touch', bubbles: true })));
      await sleep(300);
      // … then a real finger comes and goes (touchend with no touches left) – the lost one must not keep it up
      await tap(20, 160); await sleep(3400);
      const s4 = await st();
      check(`${tag}: a lost pointerup no longer keeps it sharp for good (faded after the last finger left)`, s4.opacity === 0, s4);
      await P.screenshot({ path: path.join(SHOTS, `${nature ? 'nature' : 'slap'}-phone-faded.png`) });
      await ctx.close();
    }
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await browser.close(); S.child.kill();
  console.log(`\nHeld fade e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
