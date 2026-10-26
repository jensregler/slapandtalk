// e2e: the character camera (auto-director) and the glitchy talking mouth, on a demo server of
// its own (DEMO_PROFILE=1, own port): the creator records (the demo records now), Jens talks
// with a fake microphone, Marika listens; then the replay cuts to Jens while he talks, his mouth
// moves (glitches and all), the per-angle takes and the shot list are there, and a finished
// video renders with the director.
// Run: node tests/e2e-director.js   (needs a built client: npx vite build)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { toneWav, startServer, enter, sleep } = require('./demo-helpers');

const SHOTS = path.join(__dirname, '..', 'screenshots');
const PORT = Number(process.env.DIRECTOR_E2E_PORT || 8837);
let passed = 0, failed = 0;
function check(name, ok, info = '') {
  if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (info ? '  — ' + (typeof info === 'string' ? info : JSON.stringify(info)) : '')); }
}
const waitReady = (page) => page.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 20000 });

(async () => {
  const A = await startServer(PORT);
  const wav = path.join(os.tmpdir(), 'klibb-director-voice.wav'); fs.writeFileSync(wav, toneWav());
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
  try {
    console.log('Character camera + mouth (' + A.base + ')');
    const ctxJ = await browser.newContext({ viewport: { width: 1100, height: 700 }, permissions: ['microphone'] });
    const jp = await enter(ctxJ, A.base + '/', 'Jens');
    await jp.waitForURL(/\?room=/, { timeout: 20000 }); await waitReady(jp);
    const R = await jp.evaluate(() => window.klibb.room);
    await jp.evaluate(() => { navigator.clipboard.writeText = async () => {}; window.klibb.inviteFriend(); });
    await jp.waitForFunction(() => !!window.klibb.lastInvite, null, { timeout: 10000 });
    const inviteUrl = (await jp.evaluate(() => window.klibb.lastInvite)).replace(/^https?:\/\/[^/]+/, A.base);
    const ctxM = await browser.newContext({ viewport: { width: 900, height: 600 }, permissions: ['microphone'] });
    const mp = await enter(ctxM, inviteUrl, 'Marika'); await waitReady(mp);
    await jp.waitForFunction(() => window.klibb.players().length === 1, null, { timeout: 20000 });
    // Face each other, 2 m apart.
    await jp.evaluate(() => { const k = window.klibb; k.moveTo(0, 1); k.look(0, 0); k.flushMove && k.flushMove(); });
    await mp.evaluate(() => { const k = window.klibb; k.moveTo(0, -1); k.look(Math.PI, 0); });
    await sleep(600);

    // The demo records now: the 🎬 Recording box is there for the creator (no camera placing).
    await jp.evaluate(() => window.klibb.openMore());
    const box = await jp.evaluate(() => { const v = (id) => { const e = document.getElementById(id); return !!e && e.offsetParent !== null; }; return { rec: v('rec-box'), toggle: v('rec-toggle'), camAdd: v('cam-add'), camList: v('cam-list') }; });
    check('demo: the creator sees ● Start recording, but no camera placing', box.rec && box.toggle && !box.camAdd && !box.camList, box);
    // Mic on BEFORE recording: no levels leave the browser until ● REC.
    await jp.evaluate(() => window.klibb.toggleMic());
    await sleep(1500);
    await jp.click('#rec-toggle');
    await jp.waitForFunction(() => !!window.klibb.rec(), null, { timeout: 10000 });
    const recId = await jp.evaluate(() => window.klibb.rec().recId);
    await jp.evaluate(() => window.klibb.closeMore());
    // Jens talks ~5 s; Marika hears him (live mouth).
    let liveMouth = null;
    for (let i = 0; i < 40 && !(liveMouth && liveMouth.shown); i++) { liveMouth = await mp.evaluate(() => (window.klibb.players()[0] || {}).mouth); await sleep(150); }
    check('live: Marika sees Jens\'s mouth move while he talks', !!(liveMouth && liveMouth.shown && liveMouth.open > 0), liveMouth);
    await mp.evaluate(() => { const k = window.klibb; k.setView && k.setView('third'); });
    await sleep(3500);
    await jp.evaluate(() => window.klibb.toggleMic()); // mute
    await sleep(800);
    const mouthMuted = await mp.evaluate(() => (window.klibb.players()[0] || {}).mouth);
    check('live: muted → the mouth disappears', mouthMuted && !mouthMuted.shown, mouthMuted);
    await sleep(3000); // silence at the end
    await jp.evaluate(() => window.klibb.openMore());
    await jp.click('#rec-toggle');
    await jp.waitForFunction(() => !window.klibb.rec(), null, { timeout: 10000 });

    // ---- The log and the shot list ----
    const log = (await (await fetch(`${A.base}/api/rooms/${R}/recordings/${recId}/log`)).text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const jid = await jp.evaluate(() => window.klibb.net.id);
    const talks = log.filter((e) => e.e === 'talk');
    const muteAt = talks.length ? Math.max(...talks.map((e) => e.t)) : 0;
    check('the recording has talk levels (0…15) from Jens only, ~12 per second at most', talks.length > 20 && talks.every((e) => e.id === jid && e.l >= 0 && e.l <= 15)
      && talks.length / ((muteAt - talks[0].t) / 1000 + 0.1) < 16, { n: talks.length, ids: [...new Set(talks.map((e) => e.id))] });
    check('…and they stop with a 0 when he mutes (nothing after)', talks.length && talks[talks.length - 1].l === 0, talks.slice(-3));
    const shots = await (await fetch(`${A.base}/api/rooms/${R}/recordings/${recId}/shots`)).json();
    check('the shot list is saved with the recording: Jens speaks, shots cut to him', shots.format === 'slapandtalk-shots' && shots.speakers.some((s) => s.name === 'Jens')
      && shots.shots.some((s) => s.name === 'Jens' && s.kind === 'close') && shots.shots[shots.shots.length - 1].kind === 'room', shots.shots);

    // ---- The replay: the director ----
    const ctxR = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const rp = await ctxR.newPage();
    rp.on('pageerror', (e) => console.log('    [pageerror replay]', e.message));
    await rp.goto(`${A.base}/?room=${R}&replay=${recId}`);
    await rp.waitForFunction(() => window.replay && window.replay.ready, null, { timeout: 20000 });
    await rp.waitForFunction(() => window.replay.state().players.length >= 2, null, { timeout: 20000 }).catch(() => {});
    const v0 = await rp.evaluate(() => ({ view: window.replay.view, views: window.replay.views(), plan: window.replay.plan(), speakers: window.replay.speakers() }));
    check('the replay opens in 🎬 Director view, with close/medium/over-the-shoulder takes per speaker', v0.view === 'director' && ['close', 'medium', 'rear'].every((k) => v0.views.includes(`${k}:${jid}`)), v0.views);
    const close = v0.plan.find((s) => s.speaker === jid && s.kind === 'close');
    await rp.evaluate((t) => window.replay.seek(t), close.from + 700); await sleep(500);
    const s1 = await rp.evaluate(() => window.replay.state());
    const jensPos = s1.players.find((p) => p.id === s1.shot?.speaker)?.pos;
    const dist = jensPos ? Math.hypot(s1.eye.p[0] - jensPos[0], s1.eye.p[2] - jensPos[2]) : null;
    check('while Jens talks: a close-up of Jens (camera < 1 m in front of him)', s1.shot && s1.shot.kind === 'close' && s1.shot.speaker === jid && dist < 1 && dist > 0.5, { shot: s1.shot, dist });
    // The mouth in the replay comes from the recorded levels (and is the same every time).
    let mo = null; for (let i = 0; i < 10 && !(mo && mo.shown); i++) { await rp.evaluate((t) => window.replay.seek(t + 40), close.from + 900 + i * 90); await sleep(120); mo = (await rp.evaluate(() => window.replay.state())).mouths[jid]; }
    check('replay: Jens\'s mouth opens (chunky steps), the speaking mark shows', mo && mo.shown && [0.25, 0.5, 0.75, 1].includes(mo.open), mo);
    await rp.screenshot({ path: path.join(SHOTS, '70-director-close.png') });
    const glitches = new Set();
    for (let t = close.from + 200; t < close.from + 4000; t += 83) { await rp.evaluate((x) => window.replay.seek(x), t); await sleep(25); const m = (await rp.evaluate(() => window.replay.state())).mouths[jid]; if (m && m.glitch) glitches.add(m.glitch); }
    check('the mouth glitches (wide / slip / tear) every now and then', glitches.size >= 1, [...glitches]);
    for (const [k, file] of [['medium', '71-director-medium.png'], ['rear', '72-director-rear.png']]) {
      await rp.evaluate(([v, t]) => { window.replay.setView(v); window.replay.seek(t); }, [`${k}:${jid}`, close.from + 1500]); await sleep(500);
      const st = await rp.evaluate(() => window.replay.state());
      const d = Math.hypot(st.eye.p[0] - jensPos[0], st.eye.p[2] - jensPos[2]);
      check(`take "${k}": the camera follows Jens (${d.toFixed(2)} m away)`, st.shot && st.shot.kind === k && (k === 'medium' ? d > 1.2 : d > 0.5 && d < 1.3), st.shot);
      await rp.screenshot({ path: path.join(SHOTS, file) });
    }
    await rp.evaluate(() => window.replay.setView('director'));
    const end = await rp.evaluate(() => { window.replay.seek(window.replay.duration - 300); return null; }); void end; await sleep(400);
    const s2 = await rp.evaluate(() => window.replay.state());
    check('in the silence at the end the director goes back to the room', s2.shot && s2.shot.kind === 'room' && !s2.mouths[jid]?.shown, s2.shot);
    await rp.screenshot({ path: path.join(SHOTS, '73-director-room.png') });
    const dl = await rp.evaluate(() => { const a = document.getElementById('rp-shots'); return { hidden: a.hidden, href: a.getAttribute('href'), dl: a.download }; });
    check('🎬 Shot list link in the replay (JSON download)', !dl.hidden && dl.href.endsWith(`/recordings/${recId}/shots`) && /shots\.json$/.test(dl.dl), dl);

    // ---- A finished video with the director (short: 2× speed) ----
    await rp.evaluate(() => { window.replay.setSpeed(2); window.replay.startVideo(); });
    const vid = await rp.waitForFunction(() => window.replay.lastVideo(), null, { timeout: 90000 }).then(() => rp.evaluate(() => ({ size: window.replay.lastVideo().blob.size, frames: window.replay.lastVideo().probe.replayFrames }))).catch((e) => ({ err: e.message }));
    check('⏺ Record video works in the demo with the director (frames drawn, file made)', vid.size > 10_000 && vid.frames > 5, vid);
    const up = await rp.evaluate(() => window.replay.upload()).catch(() => null);
    check('…and uploads (a /v/ link)', !!(up && up.watchUrl), up && { status: up.status, err: up.error });
    await Promise.all([ctxJ.close(), ctxM.close(), ctxR.close()]);
  } catch (e) {
    failed++; console.log('  ✗ crashed: ' + (e && e.stack || e));
    console.log('--- server log (tail) ---\n' + A.log().split('\n').slice(-20).join('\n'));
  } finally {
    await browser.close(); A.child.kill(); fs.rmSync(A.dir, { recursive: true, force: true });
  }
  console.log(`\nDirector e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
