// E2E: stamping on a phone (Jens, 28 Oct 2026). iPhone-sized touch emulation (isMobile, hasTouch),
// REAL touch events (CDP Input.dispatchTouchEvent). With a sticker in hand, one finger on the room
// aims it: the preview sits on the wall where the finger points (the ray from the touch point) and
// follows the finger; the room does not turn; letting go stamps it AT the touch point (compared
// with the raycast from that screen point – not the middle of the screen, not a sticker that was
// under the finger, which stays where it is). Two fingers pinch/twist the held sticker (no stamp,
// no look); with nothing in hand (faded) one finger looks around as before. No dashed ring around the held sticker, no page
// scroll or text selection. Own server (TOUCHSTAMP_E2E_PORT, default 8869). Screenshots:
// TOUCH_SHOTS (default /workspace/touch-stamp-shots).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.TOUCHSTAMP_E2E_PORT || 8869);
const SHOTS = process.env.TOUCH_SHOTS || '/workspace/touch-stamp-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
const dist = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : Infinity);

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', ADMIN_TOKEN: 'touch-e2e-admin' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
    await ctx.addInitScript(([r, k]) => localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })), [made.room.id, made.roomKey]);
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${made.room.id}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected && document.body.classList.contains('touch'), null, { timeout: 30000 });
    await P.evaluate(() => { const k = window.klibb; k.moveTo(0, 1); k.look(0, 0); k.stackMenu().chosen(); });
    await sleep(800);
    const cdp = await ctx.newCDPSession(P);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id = 1]) => ({ x, y, id })) });
    const st = () => P.evaluate(() => { const k = window.klibb; return { yaw: +k.controls.yaw.toFixed(4), pitch: +k.controls.pitch.toFixed(4), n: k.stamps.count, aim: k.touchAim(), preview: k.preview.mesh.visible,
      heldOp: +getComputedStyle(document.getElementById('held')).opacity, scroll: [scrollX, scrollY], sel: String(getSelection()), aiming: document.body.classList.contains('aiming') }; });
    const hitAt = (x, y) => P.evaluate(([x, y]) => window.klibb.hitAt(x, y), [x, y]);
    const stamps = () => P.evaluate(() => [...window.klibb.stamps.meshes.values()].map((m) => { const s = m.userData?.stamp || m.stamp || m.ud?.stamp; return s && { id: s.id, p: s.position }; }).filter(Boolean));
    const W = 390, H = 844, centre = await hitAt(W / 2, H / 2);

    // no ring
    const ring = await P.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('body *')) {
        if (!el.getClientRects().length) continue;
        for (const pseudo of [null, '::before', '::after']) {
          const cs = getComputedStyle(el, pseudo);
          if (pseudo && (cs.content === 'none' || cs.content === 'normal')) continue;
          if ((cs.borderTopStyle === 'dashed' || cs.outlineStyle === 'dashed') && +cs.opacity > 0 && cs.visibility !== 'hidden' && cs.display !== 'none') bad.push((el.id || el.className || el.tagName) + (pseudo || ''));
        }
      }
      const h = getComputedStyle(document.getElementById('held'), '::before');
      return { bad, heldBefore: h.content, heldBorder: h.borderTopStyle, held: window.klibb.held() };
    });
    check('no dashed ring / reticle around the held sticker (no #held::before, nothing dashed on screen)', ring.heldBefore === 'none' && ring.heldBorder !== 'dashed' && ring.bad.length === 0 && ring.held.heldShown, ring);
    await P.screenshot({ path: path.join(SHOTS, 'after-1-holding-no-ring.png') });

    // one finger: aim + follow
    const s0 = await st();
    const A = [90, 330], B = [310, 450], M = [200, 390];
    await T('touchStart', [A]); await sleep(150);
    const sA = await st(), hA = await hitAt(...A);
    check('one finger down (sticker in hand): the preview jumps to where the finger points (the touch ray), the holder steps aside', sA.aiming && sA.preview && dist(sA.aim.hit, hA.point) < 0.02 && sA.heldOp === 0, { sA, hA });
    for (let i = 1; i <= 5; i++) { await T('touchMove', [[A[0] + ((M[0] - A[0]) * i) / 5, A[1] + ((M[1] - A[1]) * i) / 5]]); await sleep(40); }
    await sleep(150);
    const sM = await st(), hM = await hitAt(...M);
    for (let i = 1; i <= 5; i++) { await T('touchMove', [[M[0] + ((B[0] - M[0]) * i) / 5, M[1] + ((B[1] - M[1]) * i) / 5]]); await sleep(40); }
    await sleep(200);
    const sB = await st(), hB = await hitAt(...B);
    check('dragging: the preview follows the finger (halfway and at the end it is at the touch ray\'s point)', dist(sM.aim.hit, hM.point) < 0.02 && dist(sB.aim.hit, hB.point) < 0.02 && dist(sB.aim.hit, hA.point) > 0.3, { m: [sM.aim.hit, hM.point], b: [sB.aim.hit, hB.point] });
    check('…the room does not turn while aiming (yaw/pitch unchanged), nothing stamped yet', sB.yaw === s0.yaw && sB.pitch === s0.pitch && sB.n === s0.n, { s0, sB });
    await P.screenshot({ path: path.join(SHOTS, 'after-2-aiming.png') });
    await T('touchEnd', []);
    await P.waitForFunction((n) => window.klibb.stamps.count === n + 1, s0.n, { timeout: 5000 }).catch(() => {});
    await sleep(400);
    const list1 = await stamps(), first = list1[list1.length - 1], s1 = await st();
    check(`let go: it stamps AT the touch point (${first && first.p.map((v) => v.toFixed(2))} = ray from (${B}); ${dist(first && first.p, hB.point).toFixed(3)} m off), not the middle of the screen (${dist(first && first.p, centre.point).toFixed(2)} m away)`,
      s1.n === s0.n + 1 && dist(first.p, hB.point) < 0.03 && dist(first.p, centre.point) > 0.5, { first, hB, centre });
    check('…the preview is gone again, the holder back', !s1.aiming && !s1.preview && s1.heldOp > 0, s1);
    await P.screenshot({ path: path.join(SHOTS, 'after-3-stamped.png') });

    // press on an existing sticker, drag away: that one stays, the new one lands under the finger
    const C = B, D = [120, 560];
    await T('touchStart', [C]); for (let i = 1; i <= 8; i++) { await T('touchMove', [[C[0] + ((D[0] - C[0]) * i) / 8, C[1] + ((D[1] - C[1]) * i) / 8]]); await sleep(40); }
    await sleep(150); const hD = await hitAt(...D); await T('touchEnd', []);
    await P.waitForFunction((n) => window.klibb.stamps.count === n + 1, s1.n, { timeout: 5000 }).catch(() => {});
    await sleep(400);
    const list2 = await stamps(), again = list2.find((s) => s.id === first.id), second = list2.find((s) => !list1.some((o) => o.id === s.id));
    check('pressing on a sticker already on the wall and dragging: that sticker is not dragged (same place), the new one lands at the finger', again && dist(again.p, first.p) < 1e-6 && second && dist(second.p, hD.point) < 0.03, { again, first, second, hD });

    // a long press without moving stamps there too
    const E = [260, 300], hE = await hitAt(...E), n2 = (await st()).n;
    await T('touchStart', [E]); await sleep(1100); await T('touchEnd', []);
    await P.waitForFunction((n) => window.klibb.stamps.count === n + 1, n2, { timeout: 5000 }).catch(() => {});
    await sleep(300);
    const list3 = await stamps(), third = list3.find((s) => !list2.some((o) => o.id === s.id));
    check('a long press (1.1 s, no move) stamps at the press point', third && dist(third.p, hE.point) < 0.03, { third, hE });

    // two fingers with a sticker in hand: pinch/twist it (e2e-pinch.js), never a look or a stamp
    const s3 = await st(), cm3 = await P.evaluate(() => window.klibb.state.size);
    await T('touchStart', [[120, 400, 1]]); await sleep(60); await T('touchStart', [[120, 400, 1], [260, 400, 2]]); await sleep(60);
    for (let i = 1; i <= 8; i++) { await T('touchMove', [[120 - i * 5, 400, 1], [260 + i * 5, 400, 2]]); await sleep(40); }
    await T('touchEnd', [[300, 400, 2]]); await T('touchEnd', []); await sleep(600);
    const s4 = await st(), cm4 = await P.evaluate(() => window.klibb.state.size);
    check('two fingers with a sticker in hand = pinch (it got bigger), the view does not turn, no stamp, no preview left behind', cm4 > cm3 && s4.yaw === s3.yaw && s4.n === s3.n && !s4.preview && !s4.aiming, { s3, s4, cm3, cm4 });

    // nothing in hand (faded): one finger looks around, a tap only brings the sticker back
    await P.evaluate(() => window.klibb.stackMenu().held.placed(performance.now() - 60000)); await sleep(300);
    const s5 = await st();
    await T('touchStart', [[100, 400]]); for (let i = 1; i <= 8; i++) { await T('touchMove', [[100 + i * 20, 400]]); await sleep(40); } await T('touchEnd', []); await sleep(500);
    const s6 = await st();
    check('faded (nothing in hand): one finger looks around as before, no stamp', s6.yaw !== s5.yaw && s6.n === s5.n && !s6.aiming, { s5, s6 });
    check('no page scroll and no text selected after all the pressing', s6.scroll.join() === '0,0' && s6.sel === '', s6);

    // the held timer (Jens, 29 Oct 2026): fades only after 2 s UNTOUCHED; any touch resets it
    await P.evaluate(() => { const k = window.klibb; k.stackMenu().chosen(); k.stackMenu().placed(); }); // timed, as after a stamp
    const ht = () => P.evaluate(() => window.klibb.held());
    const n7 = (await st()).n, hh0 = await ht();
    await sleep(1500); // most of the 2 s gone already
    await T('touchStart', [[80, 300]]); await sleep(3200); // an aiming finger standing still for 3.2 s (on the room, away from the held sticker)
    const hh1 = await ht(), aimStill = (await st()).aim;
    await T('touchEnd', []);
    await P.waitForFunction((n) => window.klibb.stamps.count === n + 1, n7, { timeout: 5000 }).catch(() => {});
    check('an aiming finger held still for 3.2 s: the sticker does not fade (> 2 s), and letting go still stamps', hh0.state === 'timed' && hh1.heldOpacity === 1 && hh1.canSlap && aimStill && (await st()).n === n7 + 1, { hh0, hh1 });
    await sleep(300);
    // pinch/twist touches every ~1 s for 4 s keep it up
    for (let i = 0; i < 4; i++) {
      await T('touchStart', [[150, 420, 1]]); await sleep(20); await T('touchStart', [[150, 420, 1], [240, 420, 2]]); await sleep(20);
      for (let k = 1; k <= 4; k++) { await T('touchMove', [[150, 420 - k * 3, 1], [240, 420 + k * 3, 2]]); await sleep(30); }
      await T('touchEnd', [[240, 432, 2]]); await T('touchEnd', []); await sleep(800);
    }
    const hh2 = await ht();
    check(`pinching/twisting every second for ~4.5 s keeps it up (age since the last touch ${hh2.age} ms, still sharp)`, hh2.heldOpacity === 1 && hh2.canSlap && hh2.age < 1200, hh2);
    await sleep(800); // ~1.6 s untouched
    const hh3 = await ht();
    await sleep(1700);
    const hh4 = await ht();
    check('…then left untouched: still sharp before 2 s, faded after 2 s + the 1 s fade', hh3.heldOpacity === 1 && hh3.age < 2000 && hh4.heldOpacity === 0 && !hh4.canSlap, { hh3, hh4 });
    // wheel turning (phone band) also counts: keepAlive via wheelUp
    await P.evaluate(() => { const k = window.klibb; k.stackMenu().chosen(); k.stackMenu().placed(); });
    await sleep(1500); await P.evaluate(() => window.klibb.wheelUp()); await sleep(1500);
    const hh5 = await ht();
    check('turning the sticker wheel (its activity) restarts the 2 s too', hh5.heldOpacity === 1 && hh5.canSlap && hh5.age < 1700, hh5);
    await P.evaluate(() => window.klibb.setSize(30)); await sleep(1500); await P.evaluate(() => window.klibb.setSize(40)); await sleep(1500);
    const hh6 = await ht();
    check('changing the size (as a pinch does) restarts the 2 s', hh6.heldOpacity === 1 && hh6.canSlap, hh6);

    // the UI still takes touches: the stack menu opens on a tap and that tap does not stamp
    await P.evaluate(() => window.klibb.stackMenu().chosen()); await sleep(200);
    const nb = (await st()).n;
    await P.tap('#design-btn'); await sleep(500);
    const menu = await P.evaluate(() => window.klibb.held().menuOpen);
    check('UI still works with touch: a tap on the sticker stack opens its menu (no stamp)', menu && (await st()).n === nb, { menu });
    await P.evaluate(() => window.klibb.stackMenu().close());
    check('no page errors', errors.length === 0, errors);
    await ctx.close();
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  finally {
    await browser.close(); S.child.kill(); fs.rmSync(S.dir, { recursive: true, force: true });
    console.log(`\nTouch stamp e2e: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();
