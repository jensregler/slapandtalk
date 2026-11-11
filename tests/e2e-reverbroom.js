// The reverb room (plot 4) in the browser – Jens, voice 10 Nov 2026, corrected t808u–t812u (shared/reverbroom.mjs):
// three sines (pitch from my look on the unfolded walls, log 20 … 2000 Hz; rest 200 / 2000 / 2000 Hz) each with a sine volume LFO, always 0…100 %, whose FREQUENCY is my
// distance to its point (2 Hz on it … 1000 Hz at the diagonal) – live, also after a teleport. THE LISTENING PATH (Jens 11 Nov
// 2026): dry am → lvl → toneOut, wet am → toneWet → toneTail (the sines' own feedforward tail) → toneRet → toneOut, and
// toneOut → master AFTER ears + listener FX – the sines never enter ears / the listener-FX FeedbackDelay (that locked the
// sound card), never send / pre / fb (5884a56 howled), and nothing comes back to the sines; a plain FIXED room reverb inside (no distance feedback, no slap times, no gate law); shut outside
// and behind the back wall; the look-out fade; and the delay room left alone.
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
    const read = () => P.evaluate(() => { const k = window.klibb, n = k.place().now; return { ...k.reverbRoom(), delay: k.delayRoom().live, now: n && { rvWet: n.rvWet, rvTone: n.rvTone, lfo: [1, 2, 3].map((i) => n['rvLfo' + i]), hz: [1, 2, 3].map((i) => n['rvHz' + i]) }, chip: document.getElementById('place-chip')?.textContent }; });
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
    const shut = (live) => live && live.length === 3 && live.every((r) => r.send < 1e-3 && r.ret < 1e-3 && r.toneLvl < 1e-3 && r.toneWet < 1e-3 && r.toneRet < 1e-3);
    // the graph (point.wires, from → to): the listening path – tones go only to toneOut → master (dry + own feedforward tail);
    // never ears / the FDN / the room tail; nothing downstream reaches the tones
    const TONE = ['osc', 'lfo', 'depth', 'am', 'am.gain', 'lvl', 'toneWet', 'toneTail', 'toneRet'], LOOP = ['send', 'pre', 'a1', 'a2', 'damp', 'fb', 'tail', 'ret', 'ears', 'voiceIn', 'mix'];
    const reach = (wires, from) => { const seen = new Set([from]), q = [from]; while (q.length) { const a = q.shift(); for (const [x, y] of wires) if (x === a && !seen.has(y)) { seen.add(y); q.push(y); } } return seen; };
    const graphOk = (r) => { const w = r.wires || [], has = (a, b) => w.some(([x, y]) => x === a && y === b);
      return has('osc', 'am') && has('am', 'lvl') && has('lvl', 'toneOut') && has('am', 'toneWet') && has('toneWet', 'toneTail') && has('toneTail', 'toneRet') && has('toneRet', 'toneOut') && has('toneOut', 'master')
        && has('a2', 'tail') && has('tail', 'ret') && has('send', 'pre') && has('fb', 'pre') && has('ret', 'ears')
        && !w.some(([x, y]) => TONE.includes(x) && LOOP.includes(y))                       // no tone wired into ears / send / pre / a1 / a2 / damp / fb / tail / ret
        && TONE.every((t) => LOOP.every((n) => !reach(w, t).has(n)))                         // no tone path into ears (→ listener FX) or the FDN at all
        && w.filter(([x]) => x === 'toneWet').every(([, y]) => y === 'toneTail')            // the wet tone only into its own tail
        && w.filter(([x]) => x === 'lvl').every(([, y]) => y === 'toneOut')                 // dry only to the listening output
        && w.filter(([x]) => x === 'toneOut').every(([, y]) => y === 'master')              // the listening output joins at master (after listener FX)
        && w.filter(([, y]) => y === 'send').every(([x]) => x === 'mix' || x === 'voiceIn') // the loop input: my sound and voices only
        && w.filter(([, y]) => y === 'tail').every(([x]) => x === 'a2')                     // the room tail only gets the FDN
        && w.filter(([x]) => x === 'ret').every(([, y]) => y === 'ears')                     // ret only to the ears
        && ['send', 'pre', 'a1', 'a2', 'damp', 'fb', 'tail', 'ret', 'ears', 'toneOut', 'master'].every((n) => TONE.every((t) => !reach(w, n).has(t))); }; // no path back into the sines / LFO
    const fixed = (live) => live.every((r, i) => Math.abs(r.fb - R.loopGain) < 1e-6 && Math.abs(r.time - R.preTimes[i]) < 1e-6 && r.toneInLoop === false);
    const lfoNear = (live, want) => live.every((r, i) => Math.abs(r.lfoHz - want[i]) <= Math.max(0.5, want[i] * 0.01));
    const full = (live) => live.every((r) => Math.abs(r.lfoBase - 0.5) < 1e-6 && Math.abs(r.lfoDepth - 0.5) < 1e-6);

    const out = await at(-46, 0);
    check('outside, in front of the opening: the room reverb and the sines are shut; the reverb is fixed (loop 0.5, fixed pre-delays), sines not in a loop', shut(out.live) && !out.inside && fixed(out.live), out);
    check('the listening path: dry am → lvl → toneOut, wet am → toneWet → toneTail → toneRet → toneOut, toneOut → master (after listener FX); never ears / send / pre / fb / the room tail; FDN = mix + voices → … → ret → ears; no path back to osc / LFO / am', out.live.every((r) => r.toneInSend === false && r.toneInTail === false && r.toneInLoop === false && r.toneInEars === false && r.toneOut === true && graphOk(r)), out.live.map((r) => r.wires));

    const ent = await at(-38.5, 2);
    check('walking in: the sines\' volume-LFO frequencies = my distance to each point (2 … 1000 Hz), live', ent.inside && lfoNear(ent.live, D.reverbLfoRatesAt(-38.5, 2)) && full(ent.live), { live: ent.live.map((r) => r.lfoHz), want: D.reverbLfoRatesAt(-38.5, 2) });

    const mid = await at(-28, 0, EAST, 2000);
    check('mid-room: fixed room reverb open (send = wet × City, ret 1, loop + pre-delays unchanged), street reverb out, delay room shut', mid.live.every((r) => Math.abs(r.send - R.wet) < 0.01 && r.ret > 0.95) && fixed(mid.live) && mid.street.small < 0.01 && mid.street.big < 0.01 && mid.delay.every((r) => r.send < 1e-3 && r.ret < 1e-3), mid);
    check('the sines: 200 / 2000 / 2000 Hz looking at the back wall centre (B) at eye height, LFO always 0…100 % (0.5 + 0.5·sin), audible; LFO Hz = distance (teleported: still live)', mid.live.every((r, i) => Math.abs(r.toneHz - R.restHz[i]) < R.restHz[i] * 0.005 && r.toneLvl > 0.1) && full(mid.live) && lfoNear(mid.live, D.reverbLfoRatesAt(-28, 0)), { live: mid.live, want: D.reverbLfoRatesAt(-28, 0) });
    check('the sines into their own tail: wet = rvTone × wet × City (City once), dry = rvTone × City, toneRet = presence', mid.live.every((r) => r.toneWet > 0.03 && Math.abs(r.toneWet - mid.now.rvTone * R.wet * 1) < 0.005 && Math.abs(r.toneLvl - mid.now.rvTone * 1) < 0.01 && r.toneRet > 0.95), { live: mid.live, now: mid.now });
    // live signal probe, with a listener-FX FeedbackDelay at 0.95 feedback on: the sines are audible at the listening
    // output (toneOut) but absent from ears and from the listener-FX input – they cannot recirculate in that delay
    const probe = await P.evaluate(async () => {
      const e = window.klibb.soundObj().engine, raw = e.raw;
      const fx = e.setListenerFx({ delay: { wet: 0.6, feedback: 0.95, time: 0.3 }, reverb: { wet: 0 }, crush: { wet: 0 }, dist: { wet: 0 }, filter: { wet: 0 } });
      const tap = (n) => { const a = raw.createAnalyser(); a.fftSize = 2048; (n.output || n).connect(a); return a; };
      const at = { ears: tap(e.ears), toneOut: tap(e.toneOut), fxIn: tap(fx.input) };
      await new Promise((r) => setTimeout(r, 600));
      const rms = (a) => { const b = new Float32Array(a.fftSize); let m = 0; for (let k = 0; k < 8; k++) { a.getFloatTimeDomainData(b); let s = 0; for (const x of b) s += x * x; m = Math.max(m, Math.sqrt(s / b.length)); } return m; };
      const res = { ears: rms(at.ears), toneOut: rms(at.toneOut), fxIn: rms(at.fxIn), delay: !!fx.nodes.find((n) => n.name === 'FeedbackDelay'), state: raw.state };
      for (const a of Object.values(at)) a.disconnect();
      try { e.ears.output.disconnect(at.ears); e.toneOut.output.disconnect(at.toneOut); fx.input.output.disconnect(at.fxIn); } catch { /* ok */ }
      e.setListenerFx(null); return res;
    });
    check('live probe (listener FeedbackDelay 0.95 on): sines at the listening output, nothing in ears or the listener-FX input', probe.delay && probe.toneOut > 0.02 && probe.ears < 1e-4 && probe.fxIn < 1e-4, probe);
    await P.screenshot({ path: path.join(SHOTS, '02-mid-room-looking-at-the-back-wall.png') });

    // on point 1: its LFO at 2 Hz, the far one (point 3) much faster; walk away → point 1 speeds up
    const p1 = await at(R.points[0][0], R.points[0][1], EAST, 2500);
    const W1 = D.reverbLfoRatesAt(R.points[0][0], R.points[0][1]);
    check('standing on point 1: its LFO = 2 Hz, the others faster (further = faster)', Math.abs(p1.live[0].lfoHz - 2) < 0.5 && p1.live[2].lfoHz > p1.live[1].lfoHz && p1.live[1].lfoHz > 50 && lfoNear(p1.live, W1), { live: p1.live.map((r) => r.lfoHz), want: W1 });
    await walkTo(-38, 6); await sleep(1500);
    const far = await read(), W2 = D.reverbLfoRatesAt(-38, 6);
    check('walked to the far corner: point 1 now near the top of the range, point 3 slow; = the live distances', far.live[0].lfoHz > 800 && far.live[2].lfoHz < far.live[0].lfoHz && lfoNear(far.live, W2) && full(far.live), { live: far.live.map((r) => r.lfoHz), want: W2 });
    await look(yawTo(0.3, 1), 0.5); await sleep(2000); // standing still, up and to the right: the pitches glide (PLACE_SLEW)
    const lk = await read();
    check('standing still, looking up and to the right: pitches change (tone 1 up from 200, tone 2 down from 2000 toward A, tone 3 stays 2000), LFO frequencies hold (same distances), depth still 0…100 %', lk.live[0].toneHz > 205 && lk.live[1].toneHz < 1900 && Math.abs(lk.live[2].toneHz - 2000) < 10 && close(lk.live.map((r) => r.toneHz), lk.now.hz, 0.01 * 2000) && lfoNear(lk.live, W2) && full(lk.live) && close(lk.now.hz, D.reverbPitchesAt(-38, 6, yawTo(0.3, 1), 0.5), 1e-6), { lk: lk.live, now: lk.now });
    await look(EAST, 0);

    // look-out fade
    const gIn = await at(-32, 0, EAST, 1500);
    const gEdge = await at(-32, 0, yawTo((-39 - -32) / 7.6, 1), 1500);
    const gOut = await at(-32, 0, WEST, 2000);
    check('look-out fade: back wall audible, toward the side wall\'s open end reduced, out through the opening silent, dry AND wet tones (body inside: room reverb stays open)', gIn.gaze === 1 && gIn.live.every((r) => r.toneLvl > 0.1) && gEdge.gaze > 0 && gEdge.gaze < 1 && gEdge.live[0].toneLvl < gIn.live[0].toneLvl - 0.01 && gEdge.live[0].toneLvl > 1e-3 && gOut.gaze === 0 && gOut.live.every((r) => r.toneLvl < 2e-3 && r.toneWet < 2e-3 && r.send > R.wet - 0.01 && r.toneRet > 0.95) && gEdge.live[0].toneWet < gIn.live[0].toneWet - 0.003 && gIn.live.every((r) => r.toneWet > 0.03), { gIn: gIn.live, gEdge: [gEdge.gaze, gEdge.live], gOut: [gOut.gaze, gOut.live] });
    const gBack = await at(-32, 0, EAST, 1500);
    check('looking back at the walls brings the sines back', gBack.live.every((r) => r.toneLvl > 0.1), gBack.live);

    // a slap, 1 m in front of the centre point: nothing in the room reverb changes (no slap-set times)
    await at(-26.4, 0, EAST, 600);
    const slaps0 = await P.evaluate(() => window.klibb.soundObj().stepLog?.length ?? 0);
    await P.evaluate(() => window.klibb.stampAt(0, 0)); await sleep(1500);
    const sl = await read();
    check('a slap: pre-delays and loop gain stay fixed (no slap-set times), LFO Hz still = my distance', fixed(sl.live) && lfoNear(sl.live, D.reverbLfoRatesAt(-26.4, 0)), { sl: sl.live, slaps0 });
    await P.screenshot({ path: path.join(SHOTS, '03-slap-at-the-back-wall.png') });

    const left = await at(-46, 3, EAST, 2600);
    check('walking out: nothing outside (send, return and sines shut)', !left.inside && shut(left.live), left.live);
    const behind = await at(-22, 0, WEST, 2600);
    check('behind the back wall (the street): nothing either', shut(behind.live), behind.live);

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
