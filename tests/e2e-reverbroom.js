// The reverb room (plot 4) in the browser – Jens, voice 10 Nov 2026 (shared/reverbroom.mjs): three reverb points on the
// place bus (shut outside, entry times, all-100 % mid-room, slap → short time, held while walking, cut on exit / behind
// the back wall, re-entry), three sines (rest 440 Hz, pitch from my look, LFO 0…100 % at a rate from my distance,
// rates locked while I stand still), the look-out fade, and the delay room left alone.
// Own server (REVERB_ROOM_PORT, 8997); screenshots to REVERB_ROOM_SHOTS (default /workspace/reverb-room-shots).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.REVERB_ROOM_PORT || 8997);
const SHOTS = process.env.REVERB_ROOM_SHOTS || '/workspace/reverb-room-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 1200) : '')); } };
const ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
const close = (a, b, e = 0.002) => Array.isArray(a) && a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= e);
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const EAST = yawTo(1, 0), WEST = yawTo(-1, 0);

(async () => {
  const D = await import('../shared/reverbroom.mjs');
  const R = D.REVERB_ROOM;
  fs.mkdirSync(SHOTS, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-reverbroom-'));
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1', DATA_DIR: dataDir });
  const browser = await chromium.launch({ args: ARGS });
  const errors = [];
  try {
    const CID = (await (await fetch(S.base + '/api/cities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Hallville', by: 'Jens' }) })).json()).city.id;
    const P = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${CID}`); await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
    await P.keyboard.press('Shift'); await sleep(300);
    await P.evaluate(async () => { const k = window.klibb, s = k.soundObj(); await s.ready; await s.engine?.ready; k.setView('first', { quiet: true }); k.radio().set({ city: 1 }); });
    const read = () => P.evaluate(() => { const k = window.klibb, n = k.place().now; return { ...k.reverbRoom(), delay: k.delayRoom().live, now: n && { rvWet: n.rvWet, rvTone: n.rvTone, fb: [1, 2, 3].map((i) => n['rvFb' + i]), lfo: [1, 2, 3].map((i) => n['rvLfo' + i]), hz: [1, 2, 3].map((i) => n['rvHz' + i]) }, chip: document.getElementById('place-chip')?.textContent }; });
    const look = (yaw, pitch = 0) => P.evaluate(([yaw, pitch]) => { const k = window.klibb; k.controls.yaw = yaw; k.controls.pitch = pitch; k.controls.apply(); }, [yaw, pitch]);
    const at = async (x, z, yaw = EAST, ms = 1500, pitch = 0) => {
      await P.evaluate(([x, z, yaw, pitch]) => { const k = window.klibb; k.controls.ground = null; k.controls.collide = null; k.camera.position.set(x, 1.7, z); k.controls.yaw = yaw; k.controls.pitch = pitch; k.controls.apply(); }, [x, z, yaw, pitch]);
      await sleep(ms); return read();
    };
    // a real walk (the footsteps' walking test): glide the camera at ~2.5 m/s, frame by frame
    const walkTo = async (x, z) => {
      await P.evaluate(([x1, z1]) => new Promise((res) => { const k = window.klibb, c = k.camera.position, x0 = c.x, z0 = c.z, d = Math.hypot(x1 - x0, z1 - z0), T = Math.max(400, d / 2.5 * 1000), t0 = performance.now();
        const step = () => { const u = Math.min(1, (performance.now() - t0) / T); c.set(x0 + (x1 - x0) * u, 1.7, z0 + (z1 - z0) * u); if (u < 1) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); }), [x, z]);
    };
    const shut = (live) => live && live.length === 3 && live.every((r) => r.send < 1e-3 && r.fb < 1e-3 && r.ret < 1e-3 && r.toneLvl < 1e-3);

    const out = await at(-46, 0);
    check('outside, in front of the opening: the three points and their sines are shut', shut(out.live) && !out.inside, out);

    const ent = await at(-38.5, 2);
    const entT = D.reverbTimesAt(-38.5, 2);
    check('walking in: times set from where I came in (10 ms … 1 s, pre-delay / loop time)', ent.inside && ent.from === 'entry' && close(ent.times, entT, 1e-9) && close(ent.live.map((r) => r.time), entT, 0.01), { got: ent.times, live: ent.live.map((r) => r.time), want: entT });

    const mid = await at(-28, 0, EAST, 2000);
    check('mid-room toward the back: all three feedbacks 100 % (loop 0.95), sends + returns open, street reverb out, delay room shut', mid.now.fb.every((f) => f === 1) && mid.live.every((r) => Math.abs(r.fb - R.loopMax) < 0.01 && r.send > 0.45 && r.ret > 0.95) && close(mid.times, entT, 1e-9) && mid.street.small < 0.01 && mid.street.big < 0.01 && mid.delay.every((r) => r.send < 1e-3 && r.ret < 1e-3), mid);
    // teleported (not walked) from the entry spot: the LFO rates are still the entry's (locked – not walking)
    check('the sines: 440 Hz looking at the back wall centre, LFO 0…100 % (0.5 + 0.5·sin), audible; rates = the entry\'s (I teleported, did not walk)', mid.live.every((r) => Math.abs(r.toneHz - 440) < 1 && Math.abs(r.lfoBase - 0.5) < 1e-6 && Math.abs(r.lfoDepth - 0.5) < 1e-6 && r.toneLvl > 0.1) && close(mid.live.map((r) => r.lfoHz), D.reverbLfoRatesAt(-38.5, 2), 0.05) && mid.lfoLock.locked, { live: mid.live, lock: mid.lfoLock });
    await P.screenshot({ path: path.join(SHOTS, '02-mid-room-looking-at-the-back-wall.png') });

    // LFO lock: walk so the rates differ per point, stand still → locked; look around → pitch moves, rates stay
    await at(-36, -4, EAST, 600); await walkTo(-27.5, -5.5);
    const w1 = await read();
    await sleep(1500);
    const st = await read(), A = D.reverbLfoRatesAt(-27.5, -5.5);
    check('walked near point 1 then stood still: rates differ per point and are LOCKED (≈ where I stopped)', st.lfoLock.locked && !st.walking && Math.abs(st.lfoLock.rates[0] - st.lfoLock.rates[2]) > 1 && close(st.lfoLock.rates, A, 0.4) && close(st.live.map((r) => r.lfoHz), st.lfoLock.rates, 0.05), { w1: w1.lfoLock, st: st.lfoLock, A });
    await look(yawTo(0.3, 1), 0.5); await sleep(2000); // up, and to the right (the south wall); the pitches glide (PLACE_SLEW)
    const lk = await read();
    check('standing still, looking up and to the right: pitches change (tone 1 up, tone 2 up), LFO rates stay locked, LFOs still 0…100 %', lk.lfoLock.locked && close(lk.lfoLock.rates, st.lfoLock.rates, 1e-9) && lk.live[0].toneHz > 800 && lk.live[1].toneHz > 490 && Math.abs(lk.live[2].toneHz - 440) < 3 && lk.live.every((r) => Math.abs(r.lfoDepth - 0.5) < 1e-6) && close(lk.now.hz, D.reverbPitchesAt(-27.5, -5.5, yawTo(0.3, 1), 0.5), 1e-6), { lk: lk.live, now: lk.now });
    await look(EAST, 0);
    await walkTo(-37, 5); const w2 = await read(); await sleep(800); const st2 = await read();
    const B = D.reverbLfoRatesAt(-37, 5);
    check('walking again: the rates unlock and follow the new position', close(st2.lfoLock.rates, B, 0.4) && !close(st2.lfoLock.rates, st.lfoLock.rates, 0.5), { w2: w2.lfoLock, st2: st2.lfoLock, B });

    // look-out fade
    const gIn = await at(-32, 0, EAST, 1500);
    const gEdge = await at(-32, 0, yawTo((-39 - -32) / 7.6, 1), 1500);
    const gOut = await at(-32, 0, WEST, 2000);
    check('look-out fade: back wall audible, toward the side wall\'s open end reduced, out through the opening silent (body still inside: points stay open)', gIn.gaze === 1 && gIn.live.every((r) => r.toneLvl > 0.1) && gEdge.gaze > 0 && gEdge.gaze < 1 && gEdge.live[0].toneLvl < gIn.live[0].toneLvl - 0.01 && gEdge.live[0].toneLvl > 1e-3 && gOut.gaze === 0 && gOut.live.every((r) => r.toneLvl < 2e-3 && r.send > 0.45), { gIn: gIn.live, gEdge: [gEdge.gaze, gEdge.live], gOut: [gOut.gaze, gOut.live] });
    const gBack = await at(-32, 0, EAST, 1500);
    check('looking back at the walls brings the sines back', gBack.live.every((r) => r.toneLvl > 0.1), gBack.live);

    // a slap, 1 m in front of the centre point, looking at the back wall
    const before = (await read()).slaps;
    await at(-26.4, 0, EAST, 600);
    for (let i = 0; i < 3 && (await read()).slaps === before; i++) { await P.evaluate(() => window.klibb.stampAt(0, 0)); await sleep(700); }
    await sleep(1500);
    const sl = await read(), slT = D.reverbTimesAt(-26.4, 0);
    check('a slap: the times jump to MY distances (1 m from point 2 → ~55 ms)', sl.slaps === before + 1 && sl.from === 'slap' && close(sl.times, slT, 1e-6) && Math.abs(sl.times[1] - (0.01 + 0.99 / R.diagonal)) < 1e-6 && close(sl.live.map((r) => r.time), slT, 0.01), { sl, want: slT });
    await P.screenshot({ path: path.join(SHOTS, '03-slap-at-the-back-wall.png') });

    const walk = await at(-36, -4);
    check('walking after the slap: times held, feedback follows me (lower toward the opening)', close(walk.times, slT, 1e-9) && walk.now.fb.every((f) => f < 1) && walk.live.every((r) => r.fb < R.loopMax - 0.05), walk);

    const left = await at(-46, 3, EAST, 2600);
    check('walking out: nothing outside (sends, feedback, returns and sines shut – the tail is cut)', !left.inside && shut(left.live), left.live);
    const behind = await at(-22, 0, WEST, 2600);
    check('behind the back wall (the street): nothing either', shut(behind.live), behind.live);

    const re = await at(-38, -2);
    check('walking in again (a new visit): times from where I came in', re.entries === 2 && re.from === 'entry' && close(re.times, D.reverbTimesAt(-38, -2), 1e-9), re);

    const dr = await at(30, 0, Math.PI / 2, 2000);
    check('the delay room: its three delays still open there, the reverb room shut', dr.delay.every((r) => r.send > 0.45 && r.ret > 0.95) && shut(dr.live), { delay: dr.delay, live: dr.live });

    await at(-47.4, 6, yawTo(0.98, -0.18), 1200);
    await P.screenshot({ path: path.join(SHOTS, '01-reverb-room-from-the-opening.png') });
    const ins = await at(-38.5, 0, EAST, 1200);
    await P.screenshot({ path: path.join(SHOTS, '04-inside-at-the-opening-looking-in.png') });
    check('the place chip names the room inside', /Reverb room/.test(ins.chip || ''), ins.chip);
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e && e.stack || e)); }
  await browser.close(); S.child.kill();
  console.log(`\nReverb room e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
