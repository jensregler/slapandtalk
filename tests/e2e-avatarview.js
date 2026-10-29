// E2E: 'My avatar' shows my own avatar big in the room (Jens, 29 Oct 2026: no small preview window;
// the room camera zooms in on my avatar so it fills the screen next to the panel – large and clear;
// it turns slowly a little and I can drag to spin it, mouse or one finger; Save/Cancel = the normal
// camera again; outfit, hair and fabric changes show live on it).
// Own server (AVATARVIEW_E2E_PORT, default 8898). Screenshots: AVATARVIEW_SHOTS (default /workspace/avatar-view-shots).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.AVATARVIEW_E2E_PORT || 8898);
const SHOTS = process.env.AVATARVIEW_SHOTS || '/workspace/avatar-view-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 800) : '')); } };

// Where my avatar is on screen (px), seen through the showcase camera.
const frameInfo = (p) => p.evaluate(() => {
  const k = window.klibb, v = k.avatarView(); if (!v) return null;
  const cam = k.showCam, at = v.pos, W = innerWidth, H = innerHeight;
  const px = (y) => { const q = cam.position.clone().set(at[0], y, at[2]).project(cam); return [(q.x + 1) / 2 * W, (1 - q.y) / 2 * H]; };
  const head = px(1.85), feet = px(0), pr = document.getElementById('avatar-panel').getBoundingClientRect();
  const toCam = [cam.position.x - at[0], cam.position.z - at[2]], len = Math.hypot(...toCam);
  const facing = [Math.sin(v.turn), Math.cos(v.turn)], face = (facing[0] * toCam[0] + facing[1] * toCam[1]) / len;
  return { head, feet, tall: feet[1] - head[1], x: (head[0] + feet[0]) / 2, W, H, panel: { left: pr.left, top: pr.top }, face, v,
    preview: !!document.getElementById('avatar-preview'), panelHidden: getComputedStyle(document.getElementById('panel')).visibility };
});

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(([r, k]) => localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })), [made.room.id, made.roomKey]);
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${made.room.id}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    await P.evaluate(() => { const k = window.klibb; k.moveTo(1, 1); k.look(0.4, 0); });
    check('no preview canvas in the panel any more', await P.evaluate(() => !document.getElementById('avatar-preview')));
    const yaw0 = await P.evaluate(() => window.klibb.controls?.yaw ?? null);
    await P.evaluate(() => document.getElementById('my-avatar').click());
    await P.waitForFunction(() => { const v = window.klibb.avatarView(); return v && v.built && v.visible; }, null, { timeout: 15000 });
    await sleep(800);
    const a = await frameInfo(P);
    check('open (1st person): my own avatar stands in the room, the camera in front of it', a && a.v.visible && a.face > Math.cos(0.75), a);
    check('…big: head to feet fills ≥ 80 % of the screen height', a && a.tall >= 0.8 * a.H && a.head[1] >= 0 && a.feet[1] <= a.H, a && { tall: a.tall, H: a.H, head: a.head, feet: a.feet });
    check('…in the free area left of the panel, in its middle', a && a.x < a.panel.left && Math.abs(a.x - a.panel.left / 2) < 0.1 * a.panel.left, a && { x: a.x, left: a.panel.left });
    check('…the rest of the HUD steps aside (left panel, sticker strip)', a && a.panelHidden === 'hidden', a && a.panelHidden);
    await P.screenshot({ path: path.join(SHOTS, 'desktop-1-open.png') });
    const t0 = (await frameInfo(P)).v.turn; await sleep(1500); const t1 = (await frameInfo(P)).v.turn;
    check('it turns slowly by itself (a gentle sway)', Math.abs(t1 - t0) > 0.05 && Math.abs(t1 - t0) < 1.2, { t0, t1 });
    // mouse drag on the room (left of the panel) spins it
    const d0 = (await frameInfo(P)).v.dragged;
    await P.mouse.move(300, 400); await P.mouse.down(); for (let i = 1; i <= 10; i++) { await P.mouse.move(300 + i * 26, 400); await sleep(16); } await P.mouse.up();
    const d1 = (await frameInfo(P)).v.dragged;
    check('mouse drag spins it (260 px ≈ half a turn)', d1 - d0 > 2.5 && d1 - d0 < 3.6, { d0, d1 });
    check('…and does not turn my view / slap anything', (await P.evaluate(() => window.klibb.controls?.yaw ?? null)) === yaw0 && (await P.evaluate(() => window.klibb.stamps.count)) === 0);
    await sleep(400); await P.screenshot({ path: path.join(SHOTS, 'desktop-2-spun-to-the-back.png') });
    await P.mouse.move(300, 400); await P.mouse.down(); for (let i = 1; i <= 10; i++) { await P.mouse.move(300 + i * 26, 400); await sleep(16); } await P.mouse.up();
    // live changes: outfit, hair, colour
    const before = (await frameInfo(P)).v.look;
    await P.evaluate(() => { const pick = (id) => [...document.querySelectorAll(`#${id} button`)].find((b) => !b.classList.contains('sel')).click(); pick('av-outfit'); pick('av-hair'); pick('av-shirt'); });
    await sleep(300);
    const live = (await frameInfo(P)).v;
    check('outfit, hair and top colour show live on the avatar', live.look.outfit === live.draft.outfit && live.look.hair === live.draft.hair && live.look.shirt === live.draft.shirt
      && (live.look.outfit !== before.outfit) && live.look.hair !== before.hair && live.look.shirt !== before.shirt, { before, look: live.look });
    await sleep(500); await P.screenshot({ path: path.join(SHOTS, 'desktop-3-new-outfit-live.png') });
    // fabric (the full version's fabrics are in e2e-fabric.js; previewFabrics() now reads this avatar)
    check('previewFabrics() reads the same avatar', await P.evaluate(() => typeof window.klibb.previewFabrics() === 'object'));
    // Cancel: the normal camera, the old look
    await P.evaluate(() => document.getElementById('av-cancel').click()); await sleep(400);
    const c = await P.evaluate(() => ({ v: window.klibb.avatarView(), self: window.klibb.selfAvatar(), view: window.klibb.view(), panel: getComputedStyle(document.getElementById('panel')).visibility, cls: document.body.classList.contains('avatar-view') }));
    check('Cancel: the normal camera again (1st person: my avatar hidden, HUD back)', !c.v && !c.self.visible && c.view === 'first' && c.panel === 'visible' && !c.cls, c);
    await P.screenshot({ path: path.join(SHOTS, 'desktop-4-after-cancel.png') });
    // 3rd person + Save
    await P.keyboard.press('KeyC'); await sleep(400);
    await P.evaluate(() => document.getElementById('my-avatar').click()); await P.waitForFunction(() => window.klibb.avatarView()?.visible, null, { timeout: 10000 });
    const shirt = await P.evaluate(() => { const b = [...document.querySelectorAll('#av-shirt button')].find((x) => !x.classList.contains('sel')); b.click(); return b.dataset.id; });
    await sleep(600);
    const b = await frameInfo(P);
    check('3rd person: the same zoomed view', b.tall >= 0.8 * b.H && b.face > Math.cos(0.75), b);
    await P.evaluate(() => document.getElementById('av-ok').click()); await sleep(400);
    const s = await P.evaluate(() => ({ v: window.klibb.avatarView(), self: window.klibb.selfAvatar(), me: window.klibb.together?.me?.() || null, view: window.klibb.view(), chase: window.klibb.chase() }));
    check('Save: back to the 3rd-person chase camera, my avatar still shown', !s.v && s.self.visible && s.view === 'third' && s.chase && !s.chase.front, s);
    check('…wearing the saved top', await P.evaluate((hex) => JSON.parse(localStorage.getItem('klibb.avatar') || '{}').look?.shirt === hex || JSON.stringify(localStorage).includes(hex), shirt));
    await P.screenshot({ path: path.join(SHOTS, 'desktop-5-after-save-3rd-person.png') });
    await ctx.close();

    // Phone: the panel is a bottom sheet; the avatar fills the top part; one finger spins it.
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const M = await mctx.newPage(); M.on('pageerror', (e) => errors.push(e.message));
    await M.goto(`${S.base}/?room=${made.room.id}`);
    await M.waitForFunction(() => window.klibb && window.klibb.ready && document.body.classList.contains('touch'), null, { timeout: 30000 });
    await M.evaluate(() => { const k = window.klibb; k.moveTo(-1, 0); k.look(-0.3, 0); });
    const myaw = await M.evaluate(() => window.klibb.controls?.yaw ?? null);
    await M.evaluate(() => document.getElementById('my-avatar').click());
    await M.waitForFunction(() => window.klibb.avatarView()?.visible, null, { timeout: 15000 }); await sleep(800);
    const m = await frameInfo(M);
    check('phone: the avatar fills the space above the panel (≥ 80 % of it)', m.tall >= 0.8 * m.panel.top && m.feet[1] <= m.panel.top + 4 && m.head[1] >= 0 && Math.abs(m.x - m.W / 2) < 0.1 * m.W, m && { tall: m.tall, top: m.panel.top, head: m.head, feet: m.feet, x: m.x });
    await M.screenshot({ path: path.join(SHOTS, 'phone-1-open.png') });
    const cdp = await mctx.newCDPSession(M);
    const md0 = m.v.dragged;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 80, y: 150 }] });
    for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 80 + i * 25, y: 150 }] }); await sleep(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(300);
    const m2 = await frameInfo(M);
    check('phone: a one-finger drag spins it (and does not turn my view)', m2.v.dragged - md0 > 1.8 && (await M.evaluate(() => window.klibb.controls?.yaw ?? null)) === myaw, { d: m2.v.dragged - md0 });
    await M.screenshot({ path: path.join(SHOTS, 'phone-2-spun.png') });
    await M.evaluate(() => document.getElementById('av-cancel').click()); await sleep(300);
    check('phone: Cancel = the normal view', await M.evaluate(() => !window.klibb.avatarView() && !document.body.classList.contains('avatar-view')));
    await mctx.close();
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await browser.close(); S.child.kill();
  console.log(`\nAvatar view e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
