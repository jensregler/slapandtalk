// e2e: the auto cameraman (shared/autocam.mjs), lean, on its own server (port 8841, not the demo):
// the creator switches it on in 🎬 Recording (it walks by itself, 👁 looks through it), the room is
// recorded with a sticker slapped meanwhile, then the replay offers "Auto cameraman: …" views (the
// room's own marked), the view moves and zooms within 35–70 mm, and ⏺ Record video renders and
// uploads a file from it. The shot list has the takes.
// Run: node tests/e2e-autocam.js   (needs a built client: npx vite build)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.AUTOCAM_E2E_PORT || 8841);
let passed = 0, failed = 0;
function check(name, ok, info = '') {
  if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (info ? '  — ' + (typeof info === 'string' ? info : JSON.stringify(info)) : '')); }
}

(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '', FULL_ACCESS_KEYS: '' });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    console.log('Auto cameraman (' + S.base + ')');
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const R = made.room.id, KEY = made.roomKey;
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    await ctx.addInitScript(([room, k]) => localStorage.setItem('klibb.roomKeys', JSON.stringify({ [room]: k })), [R, KEY]);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${S.base}/?room=${R}`);
    await p.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });

    // Live: the toggle in 🎬 Recording (creator), on → a moving camera nobody placed.
    await p.evaluate(() => window.klibb.openMore && window.klibb.openMore());
    const ui = await p.evaluate(() => { const s = document.getElementById('autocam-path'); return { shown: !!s && s.offsetParent !== null, opts: s ? [...s.options].map((o) => o.value) : [], value: s && s.value }; });
    check('the creator sees 🎥 Auto cameraman: Off / Perimeter / Diagonal sweep / Push-in / Any', ui.shown && ui.opts.join() === ',perimeter,diagonal,pushin,seeded' && ui.value === '', ui);
    await p.selectOption('#autocam-path', 'perimeter');
    await p.waitForFunction(() => window.klibb.cameras().some((c) => c.auto === 'perimeter'), null, { timeout: 10000 });
    const a1 = await p.evaluate(() => window.klibb.autoCamPose()); await sleep(1500); const a2 = await p.evaluate(() => window.klibb.autoCamPose());
    check('live: it walks by itself (no placing) at eye height', a1 && a2 && a1.p.join() !== a2.p.join() && a2.p[1] > 1.45 && a2.p[1] < 1.75, { a1, a2 });
    const auto = await p.evaluate(() => window.klibb.cameras().find((c) => c.auto));
    await p.evaluate((id) => window.klibb.enterCamView(id), auto.id); await sleep(400);
    const look = await p.evaluate(() => ({ cam: window.klibb.camView(), hud: document.getElementById('camview-name').textContent, fov: window.klibb.viewCam.fov, p: window.klibb.viewCam.position.toArray() }));
    check('👁 looks through it', look.cam === auto.id && /Auto cameraman/.test(look.hud) && look.fov > 19 && look.fov < 38, look);
    await p.evaluate(() => window.klibb.exitCamView());
    const list = await p.evaluate(() => [...document.querySelectorAll('#cam-list li')].map((l) => l.textContent));
    check('it is in the camera list (no fov/format/move for it)', list.length === 1 && /Auto cameraman · Perimeter/.test(list[0]), list);

    // Record ~9 s, a sticker slapped 3 s in.
    const rec = (what) => fetch(`${S.base}/api/rooms/${R}/recording/${what}`, { method: 'POST', headers: { 'x-room-key': KEY } }).then((r) => r.json());
    const { recording: { recId: REC } } = await rec('start');
    await sleep(3000);
    const fd = new FormData(); fd.append('file', new Blob([await sharp({ create: { width: 64, height: 64, channels: 4, background: '#ff3366' } }).png().toBuffer()], { type: 'image/png' }), 'k.png');
    const img = await (await fetch(`${S.base}/api/stickers`, { method: 'POST', body: fd })).json();
    await fetch(`${S.base}/api/rooms/${R}/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageId: img.id, position: [0, 1.6, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.5, rotation: 0, surface: 'vägg-norr' }) });
    await sleep(6000);
    await rec('stop');
    await ctx.close();

    // The replay: the takes are views; the room's own is marked; it moves and zooms; ⏺ Record video.
    const rctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const P = await rctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${R}&replay=${REC}`);
    await P.waitForFunction(() => window.replay && window.replay.ready, null, { timeout: 30000 });
    const v = await P.evaluate(() => ({ views: window.replay.views(), view: window.replay.view, labels: [...document.getElementById('rp-view').options].map((o) => o.textContent) }));
    check('replay: Auto cameraman: Perimeter / Diagonal sweep / Push-in are views', ['auto:perimeter', 'auto:diagonal', 'auto:pushin'].every((x) => v.views.includes(x)) && v.labels.includes('🎥 Auto cameraman: Perimeter (this room’s)'), v);
    check('…and with nobody talking it starts on the room’s own take (no separate camera entry)', v.view === 'auto:perimeter' && !v.views.some((x) => x.startsWith('cam:')), v);
    const same = await P.evaluate(() => JSON.stringify(window.replay.autoPose('perimeter', 4000)) === JSON.stringify(window.replay.autoPose('perimeter', 4000)));
    await P.evaluate(() => window.replay.setView('auto:diagonal'));
    await P.evaluate(() => window.replay.seek(1000)); await sleep(300);
    const e1 = await P.evaluate(() => ({ ...window.replay.state().eye, label: document.getElementById('rp-viewlabel').textContent }));
    await P.evaluate(() => window.replay.seek(7000)); await sleep(300);
    const e2 = await P.evaluate(() => window.replay.state().eye);
    check('the auto view moves along its path and its fov stays in 35–70 mm (19.5°–37.9°)', e1.p.join() !== e2.p.join() && [e1, e2].every((e) => e.fov >= 19.4 && e.fov <= 37.9) && /Auto cameraman · Diagonal sweep · \d+ mm/.test(e1.label), { e1, e2 });
    check('the same moment gives the same pose (deterministic)', same);
    await P.screenshot({ path: path.join(__dirname, '..', 'screenshots', '90-autocam-replay.png') });

    const started = await P.evaluate(() => window.replay.startVideo());
    await P.waitForFunction(() => window.replay.lastVideo(), null, { timeout: 90000 });
    const up = await P.evaluate(async () => { const j = await window.replay.upload(); return j && { id: j.video && j.video.id, url: j.watchUrl, bytes: window.replay.lastVideo().blob.size, view: window.replay.view }; });
    const files = []; const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const fp = path.join(d, f.name); if (f.isDirectory()) walk(fp); else files.push({ fp, size: fs.statSync(fp).size }); } };
    walk(S.dir);
    const vid = files.find((f) => f.fp.includes(`${path.sep}videos${path.sep}`) && /\.(webm|mp4)$/.test(f.fp));
    check('⏺ Record video from the auto view: a file is rendered and uploaded', started && up && up.id && up.bytes > 10000 && up.view === 'auto:diagonal' && vid && vid.size === up.bytes, { up, vid });

    const shots = await (await fetch(`${S.base}/api/rooms/${R}/recordings/${REC}/shots`)).json();
    const tk = shots.autocam && shots.autocam.takes.find((t) => t.view === 'auto:diagonal');
    check('the shot list has the takes with timestamps (legs, beats, track) and the room’s choice', tk && tk.track.samples.length >= 9 && tk.track.samples[1][0] === 1000 && tk.beats[0].t === 0 && shots.autocam.room[0].view === 'auto:perimeter' && shots.views.some((x) => x.view === 'auto:pushin'), shots.autocam && { room: shots.autocam.room, n: tk && tk.track.samples.length });
    const pose = await P.evaluate(() => window.replay.autoPose('diagonal', 3000));
    check('…and the replay’s take is exactly the shot list’s track', tk && JSON.stringify(tk.track.samples[3]) === JSON.stringify([3000, ...pose.p, pose.yaw, pose.pitch, pose.mm]), { list: tk && tk.track.samples[3], pose });
    check('the slapped sticker is seen as news by the cameraman (a beat aims at it)', tk && shots.autocam.takes.some((t) => t.beats.some((b) => b.target.kind === 'sticker')), shots.autocam.takes.map((t) => t.beats.map((b) => b.target.kind)));
    await rctx.close();
    check('no page errors', errors.length === 0, errors);
  } catch (err) { failed++; console.log('  ✗ ' + err.stack); } finally {
    await browser.close(); S.child.kill(); fs.rmSync(S.dir, { recursive: true, force: true });
    console.log(`\nAuto cameraman e2e: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();
