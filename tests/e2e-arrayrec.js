// e2e: sticker arrays in recordings (own server on ARRAYREC_E2E_PORT, default 8921; never 8787).
// A records the room, slaps twice, then pulls out a row (slap at A, hold, turn toward B over ~2 s,
// release). The log has 'held' lines with the row (a = { to }) all through the drag; the replay
// draws the ghosts from the shared array maths BEFORE the stickers exist, the row grows over the
// drag, and at release the real stickers come. A's avatar shows the drag pose (arm up, reaching for
// the row's end) through the drag and the slap gesture at each slap, in A's cameraman, the free
// camera and the finished video (POV hides A as before). Live: A's own avatar (3rd person) holds the
// pose while dragging. Old recordings (no 'a') are unchanged: tests/heldrec.test.mjs.
// Screenshots: ARRAYREC_SHOTS=/workspace/arrayrec-shots
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.ARRAYREC_E2E_PORT || 8921);
const SHOTS = process.env.ARRAYREC_SHOTS || '';
let passed = 0, failed = 0;
const check = (name, ok, info = '') => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (info !== '' ? '  — ' + JSON.stringify(info) : '')); } };

(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '' });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  const png = path.join(os.tmpdir(), 'e2e-arrayrec.png');
  await sharp({ create: { width: 64, height: 64, channels: 4, background: '#ff00cc' } }).png().toFile(png);
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  try {
    const { room: { id: R }, roomKey: KEY } = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const api = (m, p, body = {}) => fetch(`${S.base}/api/rooms/${R}${p}`, { method: m, headers: { 'Content-Type': 'application/json', 'x-room-key': KEY }, body: JSON.stringify(body) }).then((r) => r.json());
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 650 } });
    await ctx.addInitScript(([r, k]) => localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })), [R, KEY]);
    const A = await ctx.newPage(); A.on('pageerror', (e) => errors.push(e.message));
    await A.goto(`${S.base}/?room=${R}`);
    await A.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.net.status === 'online' && window.klibb.net.id, null, { timeout: 30000 });
    const idA = await A.evaluate(() => window.klibb.net.id);
    await A.setInputFiles('#file', png);
    await A.waitForFunction(() => window.klibb.state.selected && window.klibb.designs().length === 1, null, { timeout: 20000 });
    await A.evaluate(() => { const k = window.klibb; k.setSize(15); k.setView('third', { quiet: true }); k.moveTo(0, -3); k.look(0, 0); });
    await A.mouse.click(500, 325); await A.waitForFunction(() => window.klibb.controls.locked, null, { timeout: 5000 });
    // Headless Chromium under pointer lock reports a press with movementX/Y = the cursor's position
    // (a big jump in the aim): park the cursor at (0, 0) so presses don't turn the view.
    await A.mouse.move(0, 0); await sleep(100); await A.evaluate(() => window.klibb.look(0, 0));
    await sleep(500);
    const rec = await api('POST', '/recording/start');
    await A.waitForFunction(() => !!window.klibb.rec(), null, { timeout: 5000 });
    await sleep(900);
    const settle = () => A.waitForFunction(() => window.klibb.pendingSlaps() === 0 && window.klibb.arrayState().inFlight === 0, null, { timeout: 15000 });
    // two plain slaps
    for (const y of [0.35, 0.5]) {
      await A.evaluate((yy) => window.klibb.look(yy, 0.15), y); await sleep(900); // the 3rd-person camera glides after an instant look()
      await A.mouse.down(); await sleep(60); await A.mouse.up(); await settle(); await sleep(700);
    }
    // the row: slap, hold, turn toward B over ~2 s, release
    await A.evaluate(() => window.klibb.look(0, 0)); await sleep(900);
    await A.mouse.down(); await sleep(150);
    let live = null;
    for (let k = 1; k <= 10; k++) {
      await A.evaluate((yy) => window.klibb.look(yy, 0), -0.06 * k); await sleep(200);
      if (k === 6) live = await A.evaluate(() => ({ st: window.klibb.arrayState(), self: window.klibb.selfAvatar() }));
    }
    const tRelease = Date.now();
    await A.mouse.up(); await settle(); await sleep(900);
    const liveAfter = await A.evaluate(() => window.klibb.selfAvatar());
    check('live: my own avatar (3rd person) holds the drag pose while I pull the row out, and lets go after', live && live.st.dragging && live.st.ghosts > 0 && live.self.holding && !liveAfter.holding, { live, liveAfter });
    const stop = await api('POST', '/recording/stop');
    const REC = (stop.recording || rec.recording).recId;
    const log = (await (await fetch(`${S.base}/api/rooms/${R}/recordings/${REC}/log`)).text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const rowLines = log.filter((e) => e.e === 'held' && e.id === idA && e.h && e.h.a);
    const adds = log.filter((e) => e.e === 'stamp:add' && e.by === idA);
    const rowAdds = adds.filter((e) => e.batch && e.batch.i > 0);
    const anchorAdd = adds.find((e) => rowAdds.length && e.stamp.id === rowAdds[0].batch.g);
    const plain = adds.filter((e) => !e.batch && e !== anchorAdd);
    check('log: the row is recorded through the drag (held lines with a = { to }), throttled ~10/s', rowLines.length >= 8 && rowLines.length <= 30 && anchorAdd && rowLines[0].t >= anchorAdd.t - 300, { n: rowLines.length, first: rowLines[0] && rowLines[0].t, anchor: anchorAdd && anchorAdd.t });
    const tos = rowLines.map((e) => e.h.a.to[0]);
    check('log: B moves along the drag (to.x grows)', tos[tos.length - 1] - tos[0] > 0.6, tos);
    check('log: the row lines stop once the copies are in (then the plain held sticker again)', rowAdds.length > 0 && log.some((e) => e.e === 'held' && e.id === idA && e.t > rowAdds[0].t && !(e.h && e.h.a)), rowAdds.length);
    check('log: 2 plain slaps, then the anchor and its copies (one row), all by A', plain.length === 2 && rowAdds.length >= 6 && new Set(rowAdds.map((e) => e.batch.g)).size === 1, { plain: plain.length, row: rowAdds.length });

    // ---------- The replay ----------
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${R}&replay=${REC}`);
    await P.waitForFunction(() => window.replay && window.replay.ready, null, { timeout: 30000 });
    const at = async (t, view) => { await P.evaluate(([t, v]) => { window.replay.pause(); if (v) window.replay.setView(v); window.replay.seek(t); }, [t, view]); await sleep(250); return P.evaluate((id) => ({ s: window.replay.state(), g: window.replay.gesture(id) }), idA); };
    const rowIds = rowAdds.map((e) => e.stamp.id);
    if (process.env.ARRAYREC_DEBUG) console.log(JSON.stringify({ lines: rowLines.map((e) => [e.t, e.h.a.to[0]]), adds: rowAdds.map((e) => e.t), anchor: anchorAdd.t }));
    const tEarly = rowLines[Math.floor(rowLines.length * 0.25)].t + 20, tLate = rowLines[Math.floor(rowLines.length * 0.85)].t + 20;
    const e1 = await at(tEarly, `person:${idA}`);
    await P.waitForFunction((id) => { const h = window.replay.state().held[id]; return h && h.ghostsTextured; }, idA, { timeout: 8000 }).catch(() => {});
    const e1b = await at(tEarly, `person:${idA}`);
    const l1 = await at(tLate, `person:${idA}`);
    check('replay during the drag: ghosts are drawn BEFORE the real copies exist', e1b.s.held[idA] && e1b.s.held[idA].ghosts > 0 && e1b.s.held[idA].ghostsTextured && !e1b.s.held[idA].visible && !rowIds.some((id) => e1b.s.stamps.includes(id)), { held: e1b.s.held[idA] });
    check('replay: the row grows over the drag (more ghosts later)', l1.s.held[idA].ghosts > e1b.s.held[idA].ghosts && !rowIds.some((id) => l1.s.stamps.includes(id)), { early: e1b.s.held[idA].ghosts, late: l1.s.held[idA].ghosts });
    check('replay: the avatar holds the drag pose during the drag (A’s cameraman)', e1b.g && e1b.g.holding && l1.g.holding && l1.g.active, { e: e1b.g, l: l1.g });
    if (SHOTS) await P.screenshot({ path: path.join(SHOTS, 'replay-cameraman-row-ghosts.png') });
    const fr = await at(tLate, 'free');
    check('free camera: ghosts and the drag pose too', fr.s.held[idA].ghosts === l1.s.held[idA].ghosts && fr.g.holding);
    if (SHOTS) await P.screenshot({ path: path.join(SHOTS, 'replay-free-row-ghosts.png') });
    const pov = await at(tLate, `pov:${idA}`);
    check('A’s eyes (POV): the ghosts are there, A’s own avatar hidden as always', pov.s.held[idA].ghosts > 0 && pov.s.players.find((x) => x.id === idA).visible === false);
    if (SHOTS) await P.screenshot({ path: path.join(SHOTS, 'replay-pov-row-ghosts.png') });
    const lastAdd = rowAdds[rowAdds.length - 1].t;
    const after = await at(lastAdd + 1500, `person:${idA}`);
    check('after release: the real stickers are there, the ghosts and the drag pose are gone', rowIds.every((id) => after.s.stamps.includes(id)) && !(after.s.held[idA] && after.s.held[idA].ghosts) && !after.g.holding, { ghosts: after.s.held[idA], g: after.g });
    const letGo = log.find((e) => e.e === 'held' && e.id === idA && e.t > rowLines[rowLines.length - 1].t && !(e.h && e.h.a));
    const sw = await at(letGo.t + 100, `person:${idA}`);
    check('just after letting go: the arm swings back down (gesture still on, no longer holding)', sw.g.active && !sw.g.holding, sw.g);
    // the bridge: between the anchor's last row line and the copies, no gap in what is drawn
    const bridge = await at(rowAdds[0].t - 5, `person:${idA}`);
    check('at release: ghosts stay until the copies arrive (no blank gap)', bridge.s.held[idA].ghosts > 0 || rowIds.some((id) => bridge.s.stamps.includes(id)), bridge.s.held[idA]);
    // the slap gesture at each plain slap and at the anchor (cameraman + free camera)
    for (const [k, e] of [...plain, anchorAdd].entries()) {
      for (const v of [`person:${idA}`, 'free']) {
        const s = await at(e.t + 60, v);
        check(`slap ${k + 1} (${v}): the avatar's slap gesture plays`, s.g && s.g.active && (s.g.kind === 'slap' || s.g.holding), s.g);
      }
    }
    // ---------- The finished video: the ghosts are in the frame during the drag ----------
    await P.evaluate((v) => window.replay.setView(v), `person:${idA}`);
    const ok = await P.evaluate(() => window.replay.startVideo());
    if (ok) {
      await P.waitForFunction(() => { const c = window.replay.composer(); return c && c.state.phase === 'replay'; }, null, { timeout: 20000 });
      await P.evaluate((t) => window.replay.seek(t), tLate); await sleep(500);
      const v = await P.evaluate((id) => ({ s: window.replay.state().held[id], g: window.replay.gesture(id) }), idA);
      check('finished video: ghosts and the drag pose during the drag', v.s && v.s.ghosts > 0 && v.g.holding, v);
      if (SHOTS) { const dataUrl = await P.evaluate(() => window.replay.composer().canvas.toDataURL('image/png')); fs.writeFileSync(path.join(SHOTS, 'video-frame-row-ghosts.png'), Buffer.from(dataUrl.split(',')[1], 'base64')); }
      await P.evaluate(() => window.replay.stopVideo()).catch(() => {});
    } else console.log('  (no MediaRecorder here: video check skipped)');
    check('no page errors', errors.length === 0, errors);
    void tRelease;
  } catch (e) { failed++; console.log('  ✗ crashed: ' + e.stack); } finally {
    await browser.close(); S.child.kill(); fs.rmSync(S.dir, { recursive: true, force: true });
  }
  console.log(`\narrayrec e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
