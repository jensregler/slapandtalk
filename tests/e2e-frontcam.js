// E2E: three camera views (Jens, 29 Oct 2026: "first person, third person, och third person from front
// – man ser sig själv framifrån, kan titta in i kameran och ta bild på sig själv").
// Desktop: C cycles 1st → 3rd (behind) → front → 1st; ⚙ More has the three buttons; in front view
// the camera stands in front of me looking back (my own avatar's face in the middle of the frame),
// it follows when I turn; 📷 / P takes the selfie (the photo is saved with view 'front'). The choice
// is kept on reload. Phone: 👤 cycles the same way; front view shows my avatar from the front.
// Own server (FRONTCAM_E2E_PORT, default 8899). Screenshots: FRONTCAM_SHOTS (default /workspace/frontcam-shots).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.FRONTCAM_E2E_PORT || 8899);
const SHOTS = process.env.FRONTCAM_SHOTS || '/workspace/frontcam-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', ADMIN_TOKEN: 'frontcam-e2e-admin' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  const st = (p) => p.evaluate(() => {
    const k = window.klibb, cam = k.tpCam, eye = k.camera.position, self = k.selfAvatar();
    const fwd = [-Math.sin(k.controls.yaw), 0, -Math.cos(k.controls.yaw)];
    const rel = [cam.position.x - eye.x, cam.position.y - eye.y, cam.position.z - eye.z];
    const d = cam.position.clone(); cam.getWorldDirection(d);
    const head = cam.position.clone().set(eye.x, eye.y - 0.1, eye.z).project(cam);
    return { view: k.view(), stored: localStorage.getItem('klibb.view'), self: self.visible, built: self.built,
      ahead: rel[0] * fwd[0] + rel[2] * fwd[2], looksBack: d.x * fwd[0] + d.z * fwd[2], head: [+head.x.toFixed(2), +head.y.toFixed(2)],
      pressed: ['view-first', 'view-third', 'view-front'].map((id) => document.getElementById(id).getAttribute('aria-pressed') === 'true'), body: document.body.classList.contains('front-view') };
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(([r, k]) => localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })), [made.room.id, made.roomKey]);
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${made.room.id}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected, null, { timeout: 30000 });
    await P.evaluate(() => { const k = window.klibb; k.moveTo(0, 0.5); k.look(0.6, 0); });
    check('starts in 1st person', (await st(P)).view === 'first');
    await P.keyboard.press('KeyC'); await sleep(600);
    const a = await st(P);
    check('C → 3rd person (behind): the camera is behind me', a.view === 'third' && a.ahead < -1.5 && a.pressed.join() === 'false,true,false', a);
    await P.keyboard.press('KeyC');
    await P.waitForFunction(() => window.klibb.selfAvatar().visible, null, { timeout: 10000 }); await sleep(1500);
    const b = await st(P);
    check('C again → front: in front of me, looking back at me (saved; ⚙ More shows "Front")', b.view === 'front' && b.stored === 'front' && b.ahead > 1.5 && b.looksBack < -0.9 && b.pressed.join() === 'false,false,true' && b.body, b);
    check('…my own avatar is shown, its face in the middle of the frame', b.self && Math.abs(b.head[0]) < 0.15 && Math.abs(b.head[1]) < 0.45, b);
    await P.screenshot({ path: path.join(SHOTS, 'desktop-front-selfie-view.png') });
    await P.evaluate(() => window.klibb.look(-1.2, 0)); await sleep(1200);
    const c = await st(P);
    check('turning: the camera swings round and stays in front of me', c.ahead > 1.5 && c.looksBack < -0.9 && Math.abs(c.head[0]) < 0.15, c);
    await P.screenshot({ path: path.join(SHOTS, 'desktop-front-turned.png') });
    const ph = await P.evaluate(() => window.klibb.photo());
    check('📷 in front view = a selfie: a photo of me from the front, saved online with view "front"', ph && ph.w >= 1920 && ph.upload && ph.upload.photo && ph.upload.photo.view === 'front', ph);
    await P.reload(); await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    check('the choice is kept on reload', (await P.evaluate(() => window.klibb.view())) === 'front');
    await P.keyboard.press('KeyC'); await sleep(300);
    check('C again → back to 1st person', (await P.evaluate(() => window.klibb.view())) === 'first');
    await P.evaluate(() => { window.klibb.openMore?.(); }); await sleep(200);
    await P.evaluate(() => document.getElementById('view-front').click()); await sleep(300);
    check('⚙ More → "Front 🤳" button switches straight to front', (await P.evaluate(() => window.klibb.view())) === 'front');
    await ctx.close();

    // phone
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const M = await mctx.newPage(); M.on('pageerror', (e) => errors.push(e.message));
    await M.goto(`${S.base}/?room=${made.room.id}`);
    await M.waitForFunction(() => window.klibb && window.klibb.ready && document.body.classList.contains('touch'), null, { timeout: 30000 });
    await M.evaluate(() => { const k = window.klibb; k.moveTo(0, 0.5); k.look(0.3, 0); });
    const seq = [];
    for (let i = 0; i < 3; i++) {
      await M.tap('#design-btn'); await sleep(250);
      seq.push(await M.textContent('#sm-view .sm-lab'));
      await M.tap('#sm-view'); await sleep(400);
      seq.push(await M.evaluate(() => window.klibb.view()));
      if (seq[seq.length - 1] === 'front') { await M.waitForFunction(() => window.klibb.selfAvatar().visible, null, { timeout: 10000 }); await sleep(1500); await M.screenshot({ path: path.join(SHOTS, 'phone-front-selfie-view.png') }); }
    }
    check('phone: 👤 cycles 3rd person → front → 1st person (the label names the next view)', seq.join('|') === '3rd person|third|Front 🤳|front|1st person|first', seq);
    await mctx.close();
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await browser.close(); S.child.kill();
  console.log(`\nFront camera e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
