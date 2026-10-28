// e2e: peels in the replay (own server on 8871; never 8787). Peels on, one slap before the
// recording (the header's floor) and two during it; the replay (?replay=) shows all three, visible,
// the new ones fall from the slap's t; seeking back puts them in the air again, the same pose at the
// same t; an auto cameraman view and a 📷 photo come from the same scene (peels included).
// Run: node tests/e2e-peelreplay.js   (needs a built client: npx vite build)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.PEELREPLAY_E2E_PORT || 8871);
let passed = 0, failed = 0;
const check = (name, ok, info = '') => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (info ? '  — ' + JSON.stringify(info) : '')); } };

(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '' });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  try {
    const { room: { id: R }, roomKey: KEY } = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const api = (m, p, body = {}) => fetch(`${S.base}/api/rooms/${R}${p}`, { method: m, headers: { 'Content-Type': 'application/json', 'x-room-key': KEY }, body: JSON.stringify(body) }).then((r) => r.json());
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, acceptDownloads: true });
    await ctx.addInitScript(([r, k]) => localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })), [R, KEY]);
    const A = await ctx.newPage(); A.on('pageerror', (e) => errors.push(e.message));
    await A.goto(`${S.base}/?room=${R}`);
    await A.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    await A.setInputFiles('#file', path.join(__dirname, 'demo-klibba.png'));
    await A.waitForFunction(() => window.klibb.state.selected && !window.klibb.state.selected.library);
    await A.evaluate(() => { window.klibb.setSize(30); window.klibb.setView('first', { quiet: true }); });
    await api('PUT', '/peels', { on: true });
    await A.waitForFunction(() => window.klibb.peels().on, null, { timeout: 5000 });
    const slap = async (x) => { await A.evaluate((x) => { const k = window.klibb; k.moveTo(x, -3.6); k.look(0, 0.15); }, x); await sleep(200); return A.evaluate(() => window.klibb.stampAt(0, 0).then((s) => s && s.id)); };
    await slap(-1.5);
    await A.waitForFunction(() => window.klibb.peels().landed === 1, null, { timeout: 8000 });
    const rec = await api('POST', '/recording/start');
    await sleep(600); await slap(0); await sleep(2500); await slap(1.5); // apart by more than a fall (PEEL.fallMax)
    await A.waitForFunction(() => window.klibb.peels().landed === 3, null, { timeout: 8000 });
    await sleep(500);
    const stop = await api('POST', '/recording/stop');
    const REC = (stop.recording || rec.recording).recId;
    const log = (await (await fetch(`${S.base}/api/rooms/${R}/recordings/${REC}/log`, { headers: { 'x-room-key': KEY } })).text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const adds = log.filter((e) => e.e === 'stamp:add' && e.peel);
    check('the recording: header has peelsOn + the floor (1 peel, its image); 2 stamp:add carry their peel', log[0].peelsOn === true && log[0].peels.length === 1 && log[0].images[log[0].peels[0].imageId] && adds.length === 2, { on: log[0].peelsOn, n: log[0].peels && log[0].peels.length, adds: adds.length });

    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${R}&replay=${REC}`);
    await P.waitForFunction(() => window.replay && window.replay.ready, null, { timeout: 30000 });
    const st = async (t) => { await P.evaluate((t) => { window.replay.pause(); window.replay.seek(t); }, t); await sleep(400); return P.evaluate(() => window.replay.state().peels); };
    const s0 = await st(0);
    check('replay at 0: the floor from before the recording, landed and visible', s0.count === 1 && s0.landed === 1 && s0.visible && s0.on, s0);
    const end = await P.evaluate(() => window.replay.duration);
    const sEnd = await st(end);
    check('replay at the end: all 3 peels, landed, visible', sEnd.count === 3 && sEnd.landed === 3 && sEnd.visible, sEnd);
    const t2 = adds[1].t + 150, id2 = adds[1].peel.id;
    const sMid = await st(t2);
    const pose1 = await P.evaluate((id) => window.replay.peelLayer.poseOf(id), id2);
    check('seek back to just after the 2nd slap: 2 on the floor, the new one in the air again', sMid.count === 3 && sMid.falling === 1 && pose1 && pose1.u > 0 && pose1.u < 1 && pose1.p[1] > 0.05, { sMid, pose1 });
    await st(end); await st(adds[0].t - 50);
    const sBefore = await P.evaluate(() => window.replay.state().peels);
    await st(t2);
    const pose2 = await P.evaluate((id) => window.replay.peelLayer.poseOf(id), id2);
    check('…before the 1st slap: only the floor; back at the same t: the very same pose (deterministic)', sBefore.count === 1 && JSON.stringify(pose1) === JSON.stringify(pose2), { sBefore, pose1, pose2 });
    // An auto cameraman view + a photo: the same scene, so the peels are in them.
    await P.evaluate(() => window.replay.setView('auto:perimeter'));
    const sAuto = await st(end);
    const [dl] = await Promise.all([P.waitForEvent('download', { timeout: 20000 }), P.click('#rp-photo')]);
    check('auto cameraman view: peels in its scene, visible; 📷 photo taken from it', sAuto.count === 3 && sAuto.visible && !!dl.suggestedFilename() && await P.evaluate(() => window.replay.scene.getObjectByName('peels').visible), sAuto);
    await P.evaluate(() => window.replay.setView('free'));
    await P.evaluate(() => { window.replay.seek(window.replay.duration); });
    await sleep(400);
    await P.screenshot({ path: path.join(__dirname, '..', 'screenshots', '95-peels-replay.png') });
    check('no page errors', errors.length === 0, errors);
  } catch (err) { failed++; console.log('  ✗ ' + err.stack); } finally {
    await browser.close(); S.child.kill(); fs.rmSync(S.dir, { recursive: true, force: true });
    console.log(`\nPeels replay e2e: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();
