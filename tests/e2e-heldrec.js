// e2e: the held sticker in the recording (own server on 8913; never 8787). A records the room,
// picks a sticker up (upload = it is in the hand) and aims at the north wall for ~2 s, moves the
// aim, then slaps. In the recording the held sticker is there from the pickup – BEFORE it is on
// the wall – and follows the aim: the log has 'held' lines from the pickup on, the replay draws it
// (state().held, and the pixels in A's eyes / A's cameraman), and the finished video's canvas has
// it too. Before the pickup nothing is held. Screenshots: HELDREC_SHOTS=/workspace/held-rec-shots
// Run: node tests/e2e-heldrec.js   (needs a built client: npx vite build)
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.HELDREC_E2E_PORT || 8913);
const SHOTS = process.env.HELDREC_SHOTS || '';
let passed = 0, failed = 0;
const check = (name, ok, info = '') => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (info ? '  — ' + JSON.stringify(info) : '')); } };
const magenta = ([r, g, b]) => r > 170 && b > 120 && g < 90;

(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '' });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  const png = path.join(os.tmpdir(), 'e2e-heldrec-magenta.png');
  await sharp({ create: { width: 300, height: 300, channels: 4, background: '#ff00cc' } }).png().toFile(png);
  try {
    const { room: { id: R }, roomKey: KEY } = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const api = (m, p, body = {}) => fetch(`${S.base}/api/rooms/${R}${p}`, { method: m, headers: { 'Content-Type': 'application/json', 'x-room-key': KEY }, body: JSON.stringify(body) }).then((r) => r.json());
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    await ctx.addInitScript(([r, k]) => localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })), [R, KEY]);
    const A = await ctx.newPage(); A.on('pageerror', (e) => errors.push(e.message));
    await A.goto(`${S.base}/?room=${R}`);
    await A.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.net.status === 'online' && window.klibb.net.id, null, { timeout: 30000 });
    const idA = await A.evaluate(() => window.klibb.net.id);
    await A.evaluate(() => { const k = window.klibb; k.setView('first', { quiet: true }); k.moveTo(0, -2.6); k.look(0, 0.12); });
    const rec = await api('POST', '/recording/start');
    await A.waitForFunction(() => !!window.klibb.rec(), null, { timeout: 5000 });
    await sleep(1200); // recording, nothing in the hand yet
    // Pick a sticker up: the upload puts it in the hand. Aiming = Slap mode with the pointer locked
    // (headless Chromium has no real pointer lock: the test flips the flag the lock would set).
    await A.setInputFiles('#file', png);
    await A.waitForFunction(() => window.klibb.state.selected && !window.klibb.state.selected.library);
    await A.evaluate(() => { window.klibb.setSize(30); window.klibb.setMode?.('slap'); window.klibb.controls.locked = true; });
    await A.waitForFunction(() => window.klibb.preview.mesh.visible, null, { timeout: 8000 });
    const tPick = Date.now();
    await sleep(1500);
    await A.evaluate(() => window.klibb.look(0.25, 0.12)); // aim somewhere else: it follows
    await sleep(1200);
    const sid = await A.evaluate(() => window.klibb.stampAt(0, 0).then((s) => s && s.id));
    await sleep(800);
    await A.evaluate(() => { window.klibb.controls.locked = false; }); // stop aiming
    await sleep(700);
    const stop = await api('POST', '/recording/stop');
    const REC = (stop.recording || rec.recording).recId;
    const log = (await (await fetch(`${S.base}/api/rooms/${R}/recordings/${REC}/log`)).text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const held = log.filter((e) => e.e === 'held' && e.id === idA);
    const add = log.find((e) => e.e === 'stamp:add' && e.stamp && e.stamp.id === sid);
    const first = held.find((e) => e.h);
    check('log: held lines from the pickup on, with the design on the first one', first && first.image && first.image.url && first.h.s === 'vägg-norr', first);
    check('log: the held sticker comes well BEFORE the slap (stamp:add)', first && add && add.t - first.t > 2000, { held: first && first.t, add: add && add.t });
    check('log: nothing held before the pickup', first && first.t > 1000, first && first.t);
    const xs = held.filter((e) => e.h && e.t < add.t).map((e) => e.h.p[0]);
    check('log: the aim moves → the held sticker follows (several updates, x changes)', xs.length >= 2 && Math.max(...xs) - Math.min(...xs) > 0.3, xs);
    check('log: let go (null) once A stops aiming', held.some((e) => e.h === null && e.t > add.t), held.map((e) => [e.t, !!e.h]));
    check('log: throttled (≤ ~10 lines a second)', held.length <= Math.ceil((log[log.length - 1].t - first.t) / 1000) * 11 + 2, held.length);

    // ---------- The replay ----------
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${R}&replay=${REC}`);
    await P.waitForFunction(() => window.replay && window.replay.ready, null, { timeout: 30000 });
    const at = async (t, view) => { await P.evaluate(([t, v]) => { window.replay.pause(); if (v) window.replay.setView(v); window.replay.seek(t); }, [t, view]); await sleep(400); return P.evaluate(() => window.replay.state()); };
    const centre = async () => { const b = await P.screenshot(); const { data, info } = await sharp(b).raw().toBuffer({ resolveWithObject: true }); const i = (Math.round(info.height * 0.5) * info.width + Math.round(info.width / 2)) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
    const tBefore = first.t + Math.round((add.t - first.t) * 0.3);
    const s0 = await at(first.t - 400, `pov:${idA}`);
    const c0 = await centre();
    check('replay before the pickup: nothing held, the wall in A’s eyes is not magenta', !(s0.held[idA] && s0.held[idA].visible) && !magenta(c0), { held: s0.held, c0 });
    const s1 = await at(tBefore, `pov:${idA}`);
    await P.waitForFunction((id) => { const h = window.replay.state().held[id]; return h && h.visible && h.textured; }, idA, { timeout: 8000 }).catch(() => {});
    await sleep(300);
    const s1b = await P.evaluate(() => window.replay.state());
    const c1 = await centre();
    check('replay BEFORE the slap: the sticker is not on the wall yet …', !s1.stamps.includes(sid), s1.stamps);
    check('… but A’s held sticker is drawn on the wall (visible, textured)', s1b.held[idA] && s1b.held[idA].visible && s1b.held[idA].textured, s1b.held);
    check('… right where A aims (the middle of A’s eyes is the sticker’s colour)', magenta(c1), c1);
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await P.screenshot({ path: path.join(SHOTS, 'replay-pov-held-before-slap.png') }); }
    // A's cameraman (the per-participant track): the held sticker is in the scene for that view too
    const s2 = await at(tBefore, `person:${idA}`);
    check('person cameraman view: held sticker drawn there too, still before the slap', s2.held[idA] && s2.held[idA].visible && !s2.stamps.includes(sid), s2.held);
    if (SHOTS) await P.screenshot({ path: path.join(SHOTS, 'replay-cameraman-held-before-slap.png') });
    // the free camera (behind, high): A and the held sticker on the wall in front of A
    await at(tBefore, 'free');
    { const b = await P.screenshot(); const { data, info } = await sharp(b).raw().toBuffer({ resolveWithObject: true }); let hits = 0;
      for (let i = 0; i < data.length; i += info.channels * 3) if (magenta([data[i], data[i + 1], data[i + 2]])) hits++;
      check('free camera: the held sticker is in the picture too, before the slap', hits > 10, hits);
      if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'replay-room-held-before-slap.png'), b); }
    const s3 = await at(add.t + 300, `pov:${idA}`);
    check('after the slap: the placed sticker is there as before', s3.stamps.includes(sid));
    const s4 = await at(log[log.length - 1].t - 50, `pov:${idA}`);
    check('after letting go: no held sticker', !(s4.held[idA] && s4.held[idA].visible), s4.held);

    // ---------- The finished video (⏺ Record video): a frame from its canvas before the slap ----------
    await P.evaluate((v) => window.replay.setView(v), `pov:${idA}`);
    const ok = await P.evaluate(() => window.replay.startVideo());
    if (ok) {
      await P.waitForFunction(() => { const c = window.replay.composer(); return c && c.state.phase === 'replay'; }, null, { timeout: 20000 });
      await P.evaluate((t) => window.replay.seek(t), tBefore);
      await sleep(600);
      const dataUrl = await P.evaluate(() => window.replay.composer().canvas.toDataURL('image/png'));
      const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
      const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
      let hits = 0; for (let y = Math.round(info.height * 0.35); y < info.height * 0.65; y += 4) for (let x = Math.round(info.width * 0.35); x < info.width * 0.65; x += 4) { const i = (y * info.width + x) * info.channels; if (magenta([data[i], data[i + 1], data[i + 2]])) hits++; }
      check('finished video: a frame before the slap shows the held sticker (magenta in the middle of the frame)', hits > 20, { hits, w: info.width, h: info.height });
      if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'video-frame-held-before-slap.png'), buf);
      await P.evaluate(() => window.replay.stopVideo()).catch(() => {});
    } else console.log('  (no MediaRecorder here: video frame check skipped)');
    // ---------- Touch (phone layout): held while the sticker is up, aimed at the middle of the screen ----------
    const T = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage(); T.on('pageerror', (e) => errors.push(e.message));
    await T.goto(`${S.base}/?room=${R}&touch=1`);
    await T.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.net.id && window.klibb.stackMenu(), null, { timeout: 30000 });
    const idT = await T.evaluate(() => window.klibb.net.id);
    await T.evaluate(() => { const k = window.klibb; k.moveTo(-1, -2.8); k.look(0, 0.1); });
    const rec2 = await api('POST', '/recording/start');
    await T.waitForFunction(() => !!window.klibb.rec(), null, { timeout: 5000 });
    await sleep(800);
    await T.setInputFiles('#file', png);
    await T.waitForFunction(() => window.klibb.state.selected && window.klibb.held() && window.klibb.held().opacity > 0, null, { timeout: 8000 }).catch(() => {});
    const hinfo = await T.evaluate(() => window.klibb.held());
    await sleep(1200);
    const stop2 = await api('POST', '/recording/stop');
    const log2 = (await (await fetch(`${S.base}/api/rooms/${R}/recordings/${(stop2.recording || rec2.recording).recId}/log`)).text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const th = log2.filter((e) => e.e === 'held' && e.id === idT && e.h);
    check('touch: once a sticker is in the hand (holder up), the recording has it on the wall where the middle of the screen aims', th.length >= 1 && th[0].h.s === 'vägg-norr' && th[0].t > 700, { n: th.length, first: th[0], hinfo: hinfo && { state: hinfo.state, opacity: hinfo.opacity } });
    check('no page errors', errors.length === 0, errors);
    void tPick;
  } catch (e) { failed++; console.log('  ✗ crashed: ' + e.stack); } finally {
    await browser.close(); S.child.kill(); fs.rmSync(S.dir, { recursive: true, force: true });
  }
  console.log(`\nheldrec e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
