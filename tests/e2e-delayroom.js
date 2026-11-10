// The delay room (plot 5) in the browser – Jens's sketch + t790u (shared/delayroom.mjs): the three delay lines on
// the place bus, the held times (entry → slap → walking → leaving → re-entry) and NO DELAY OUTSIDE THE ROOM.
// Own server (DELAY_ROOM_PORT, 8996); screenshots to DELAY_ROOM_SHOTS (default /workspace/delay-room-shots).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.DELAY_ROOM_PORT || 8996);
const SHOTS = process.env.DELAY_ROOM_SHOTS || '/workspace/delay-room-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 900) : '')); } };
const ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
const close = (a, b, e = 0.002) => Array.isArray(a) && a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= e);

(async () => {
  const D = await import('../shared/delayroom.mjs');
  fs.mkdirSync(SHOTS, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-delayroom-'));
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1', DATA_DIR: dataDir });
  const browser = await chromium.launch({ args: ARGS });
  const errors = [];
  try {
    const CID = (await (await fetch(S.base + '/api/cities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Echoville', by: 'Jens' }) })).json()).city.id;
    const P = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${CID}`); await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
    await P.keyboard.press('Shift'); await sleep(300); // a gesture: the audio starts
    await P.evaluate(async () => { const k = window.klibb, s = k.soundObj(); await s.ready; await s.engine?.ready; k.setView('first', { quiet: true }); k.radio().set({ city: 1 }); });
    const at = async (x, z, yaw = Math.PI / 2, ms = 1500) => {
      await P.evaluate(([x, z, yaw]) => { const k = window.klibb; k.controls.ground = null; k.controls.collide = null; k.camera.position.set(x, 1.7, z); k.controls.yaw = yaw; k.controls.pitch = 0; k.controls.apply(); }, [x, z, yaw]);
      await sleep(ms);
      return P.evaluate(() => { const k = window.klibb; return { ...k.delayRoom(), now: k.place().now && { roomWet: k.place().now.roomWet, fb: [1, 2, 3].map((i) => k.place().now['roomFb' + i]) }, chip: document.getElementById('place-chip')?.textContent }; });
    };
    const fbMax = D.DELAY_ROOM.loopMax;

    const out = await at(46, 0);
    check('outside, in front of the opening: the room\'s three delays are shut (send, feedback, return 0)', out.live && out.live.length === 3 && out.live.every((r) => r.send < 1e-3 && r.fb < 1e-3 && r.ret < 1e-3) && !out.inside, out);

    const ent = await at(38.5, 2);
    const entT = D.delayTimesAt(38.5, 2);
    check('walking in: the times are set from where I came in (10 ms … 1 s by distance to each delay)', ent.inside && ent.from === 'entry' && close(ent.times, entT, 1e-9) && close(ent.live.map((r) => r.time), entT, 0.01), { got: ent.times, live: ent.live.map((r) => r.time), want: entT });

    const mid = await at(28, 0);
    check('mid-room (the sketch\'s overlap): all three feedbacks at 100 %, the sends open; times still the entry times', mid.now.fb.every((f) => f === 1) && mid.live.every((r) => Math.abs(r.fb - fbMax) < 0.01 && r.send > 0.45 && r.ret > 0.95) && close(mid.times, entT, 1e-9), mid);
    await P.screenshot({ path: path.join(SHOTS, '02-mid-room-looking-at-the-back-wall.png') });

    // a slap, standing 1 m in front of the centre delay, looking at the back wall
    const before = await P.evaluate(() => window.klibb.delayRoom().slaps);
    await at(26.4, 0, Math.PI / 2, 600);
    for (let i = 0; i < 3 && (await P.evaluate(() => window.klibb.delayRoom().slaps)) === before; i++) { await P.evaluate(() => window.klibb.stampAt(0, 0)); await sleep(700); }
    await sleep(1500);
    const sl = await P.evaluate(() => window.klibb.delayRoom());
    const slT = D.delayTimesAt(26.4, 0);
    check('a slap: the times jump to MY distances (1 m from delay 2 → ~55 ms; delays 1/3 longer)', sl.slaps === before + 1 && sl.from === 'slap' && close(sl.times, slT, 1e-6) && Math.abs(sl.times[1] - (0.01 + 0.99 / D.DELAY_ROOM.diagonal)) < 1e-6 && close(sl.live.map((r) => r.time), slT, 0.01), { sl, want: slT });
    await P.screenshot({ path: path.join(SHOTS, '03-slap-at-the-back-wall.png') });

    const walk = await at(36, -4);
    check('walking after the slap: the times stay; the feedback follows me (lower toward the opening)', close(walk.times, slT, 1e-9) && walk.now.fb.every((f) => f < 1) && walk.live.every((r) => r.fb < fbMax - 0.05), walk);

    const left = await at(46, 3, Math.PI / 2, 2600); // the sends glide shut (PLACE_SLEW)
    check('walking out: no delay outside the room (sends, feedback and the echo return shut)', !left.inside && left.live.every((r) => r.send < 1e-3 && r.fb < 1e-3 && r.ret < 1e-3), left.live);
    const behind = await at(22, 0, -Math.PI / 2, 2600);
    check('behind the back wall (the street): nothing either', behind.live.every((r) => r.send < 1e-3 && r.ret < 1e-3), behind.live);

    const re = await at(38, -2);
    check('walking in again (a new visit): times from where I came in', re.entries === 2 && re.from === 'entry' && close(re.times, D.delayTimesAt(38, -2), 1e-9), re);
    await at(47.4, -6, 1.75, 800);
    await P.screenshot({ path: path.join(SHOTS, '01-delay-room-from-the-opening.png') });
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e && e.stack || e)); }
  await browser.close(); S.child.kill();
  console.log(`\nDelay room e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
