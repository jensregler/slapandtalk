// E2E: Jens's six icon images from Dropbox /Ulla/SLTstickers (camera, character, door, exit, redio,
// room .png; 30 Oct 2026) are ordinary library stickers – in the same sticker wheel/stack and the
// "All stickers" list as every other regular sticker (not nature, no own category or button), and
// they are picked and slapped like any other sticker (desktop: R/F + a click in the wheel; phone: the
// sticker list + the stack). Own server (ICONS_E2E_PORT, default 8895). Screenshots: ICON_SHOTS
// (default /workspace/icon-shots).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.ICONS_E2E_PORT || 8895);
const SHOTS = process.env.ICON_SHOTS || '/workspace/icon-shots';
const ICONS = ['camera.png', 'character.png', 'door.png', 'exit.png', 'redio.png', 'room.png'];
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 600) : '')); } };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', ADMIN_TOKEN: 'icons-e2e-admin' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  try {
    const lib = (await (await fetch(`${S.base}/api/library`)).json()).stickers;
    const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'library', 'manifest.json'), 'utf8')).stickers;
    const icons = ICONS.map((n) => { const m = man.find((s) => s.source === n); return m && lib.find((d) => d.id === m.id); });
    const regular = lib.find((d) => !d.nature && !ICONS.includes((man.find((s) => s.id === d.id) || {}).source));
    check('/api/library has all six icon images', icons.every(Boolean), ICONS.filter((n, i) => !icons[i]));
    check('…as ordinary stickers: not nature, no special fields, 30 cm start', icons.every((d) => d && !d.nature && d.startCm === 30 && Object.keys(d).sort().join() === Object.keys(regular).sort().join()), { icon: icons.map((d) => d && Object.keys(d)), regular: Object.keys(regular) });
    const imgs = await Promise.all(icons.map((d) => fetch(S.base + (d.url || `/api/stickers/${d.id}`)).then((r) => r.status + ' ' + r.headers.get('content-type'))));
    check('…their images are served (200, image)', imgs.every((s) => /^200 image\//.test(s)), imgs);
    const ids = icons.map((d) => d.id);

    // ---- desktop ----
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) })).json();
    const room = made.room.id;
    await P.goto(`${S.base}/?room=${room}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected, null, { timeout: 60000 });
    const d0 = await P.evaluate((ids) => ({
      sticker: window.klibb.stickerDesigns().map((d) => d.id), nature: window.klibb.natureDesigns().map((d) => d.id),
      wheel: [...document.querySelectorAll('#strip-row .strip-th')].map((b) => b.dataset.id),
      tray: [...document.querySelectorAll('#libtray .thumb')].map((t) => t.dataset.id),
      first: window.klibb.state.selected.id, act: window.klibb.activeWheel(),
    }), ids);
    check('desktop: all six are in the sticker wheel\'s list (the same list as the other regular stickers)', ids.every((id) => d0.sticker.includes(id)), { n: d0.sticker.length });
    check('…none in the Nature wheel', !ids.some((id) => d0.nature.includes(id)));
    check('…the wheel has a sticker button for each (same .strip-th as the rest)', ids.every((id) => d0.wheel.includes(id)), { n: d0.wheel.length });
    check('…and they are in "All stickers" with the others', ids.every((id) => d0.tray.includes(id)), { n: d0.tray.length });
    // stand in front of the north wall, slap mode, first person
    await P.evaluate(() => { const k = window.klibb; k.setView('first', { quiet: true }); k.moveTo(0, -1.4); k.look(0, 0.05); k.setMode?.('slap'); });
    await sleep(500);
    // the icons are the last six of the endless wheel: F (back) from the first sticker reaches them one by one
    const order = [...ids].reverse(), seen = [];
    const spots = [[-0.2, 0.36], [0.25, 0.36], [0.7, 0.36], [-0.2, -0.28], [0.25, -0.28], [0.7, -0.28]];
    const stamps = [];
    for (let i = 0; i < 6; i++) {
      await P.keyboard.press('f'); await sleep(700);
      const sel = await P.evaluate(() => ({ id: window.klibb.state.selected.id, strip: window.klibb.strip().sel, src: window.klibb.state.selected.source }));
      seen.push(sel);
      if (i === 0) await P.screenshot({ path: path.join(SHOTS, '1-desktop-wheel-icon-held.png') });
      await P.evaluate(() => { window.klibb.controls.locked = true; window.klibb.setSize(55); });
      const st = await P.evaluate(([x, y]) => window.klibb.stampAt(x, y).then((s) => s && { imageId: s.imageId, size: s.size, surface: s.surface }), spots[i]);
      await P.evaluate(() => { window.klibb.controls.locked = false; });
      stamps.push(st);
      await sleep(300);
    }
    check('desktop: F turns the sticker wheel onto each icon in turn (held + marked in the wheel)', seen.every((s, i) => s.id === order[i] && s.strip === order[i]), seen);
    check('desktop: each icon slaps onto the wall like any sticker', stamps.every((s, i) => s && s.imageId === order[i] && s.surface), stamps);
    await sleep(1500);
    const srv = (await (await fetch(`${S.base}/api/rooms/${room}/stamps`)).json()).stamps;
    check('server: the room has the six icon stamps', ids.every((id) => srv.some((s) => s.imageId === id)) && srv.length === 6, srv.map((s) => s.imageId));
    const meshes = await P.evaluate(() => window.klibb.stamps.meshes.size);
    check('…and all six are drawn in the room', meshes === 6, meshes);
    await P.screenshot({ path: path.join(SHOTS, '2-desktop-six-icons-slapped.png') });
    // a mouse click on an icon in the wheel picks it too
    const target = ids[2]; // door
    const vis = await P.evaluate((id) => { const b = document.querySelector(`#strip-row .strip-th[data-id="${id}"]`); const r = b.getBoundingClientRect(); return { r: r.toJSON(), shown: b.style.display !== 'none' && r.width > 0 }; }, target);
    if (vis.shown) await P.evaluate((id) => document.querySelector(`#strip-row .strip-th[data-id="${id}"]`).click(), target); // (the fanned thumbs overlap; click that very button)
    await sleep(800);
    const picked = await P.evaluate(() => window.klibb.state.selected.id);
    check('desktop: clicking the door icon in the wheel picks it', vis.shown && picked === target, { vis, picked, target });
    await P.screenshot({ path: path.join(SHOTS, '3-desktop-door-picked-from-wheel.png') });
    // "All stickers" list: the pick button
    await P.evaluate((id) => document.querySelector(`#libtray .thumb[data-id="${id}"] .pick`).click(), ids[4]); await sleep(600);
    check('desktop: picking redio from "All stickers" holds it', await P.evaluate((id) => window.klibb.state.selected.id === id, ids[4]));
    await ctx.close();

    // ---- phone ----
    const mctx = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const M = await mctx.newPage(); M.on('pageerror', (e) => errors.push(e.message));
    await M.goto(`${S.base}/?room=${room}`);
    await M.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected, null, { timeout: 60000 });
    await M.evaluate((id) => document.querySelector(`#libtray .thumb[data-id="${id}"] .pick`).click(), ids[0]); await sleep(800);
    const m0 = await M.evaluate((id) => ({ sel: window.klibb.state.selected.id, btn: getComputedStyle(document.getElementById('design-btn')).backgroundImage || '', html: document.getElementById('design-btn').innerHTML }), ids[0]);
    check('phone: the camera icon is held in the sticker stack', m0.sel === ids[0] && (m0.btn.includes(ids[0]) || m0.html.includes(ids[0])), { sel: m0.sel, btn: m0.btn.slice(0, 120), html: m0.html.slice(0, 200) });
    await M.evaluate(() => { document.body.classList.add('wheel-up'); window.klibb.wheelApi.render(); });
    await sleep(800);
    const m1 = await M.evaluate((ids) => ({ strip: window.klibb.strip(), shownIcons: ids.filter((id) => { const b = document.querySelector(`#strip-row .strip-th[data-id="${id}"]`); return b && b.style.display !== 'none' && b.getBoundingClientRect().width > 0; }) }), ids);
    check('phone: the sticker band shows the camera icon (selected) among the regular stickers', m1.strip.shown && m1.strip.sel === ids[0] && m1.shownIcons.length >= 1, m1);
    await M.screenshot({ path: path.join(SHOTS, '4-phone-stack-camera-icon.png') });
    await M.evaluate(() => { document.body.classList.remove('wheel-up'); const k = window.klibb; k.setView('first', { quiet: true }); k.moveTo(0, -1.4); k.look(0, 0.05); k.controls.locked = true; k.setSize(55); });
    const ms = await M.evaluate(() => window.klibb.stampAt(0, 0).then((s) => s && s.imageId));
    check('phone: the camera icon slaps like any sticker', ms === ids[0], ms);
    await sleep(800);
    await M.evaluate(() => { window.klibb.controls.locked = false; });
    await M.screenshot({ path: path.join(SHOTS, '5-phone-icons-in-room.png') });
    await mctx.close();
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  finally {
    await browser.close(); S.child.kill(); fs.rmSync(S.dir, { recursive: true, force: true });
    console.log(`\nIcon stickers e2e: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();
