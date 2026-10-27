// E2E (lean): the sticker-array FALLBACK. Arrays work in some browsers and not in others; whenever the
// array path cannot work, a click still places exactly ONE sticker (never nothing). Own server
// (port 8857, normal app). Covers: a plain click (no drag) = one; array start throws; the drag update
// throws; the release throws; …/stamps/array failing (500) and missing (404: arrays off from then on)
// = the first sticker stays, one; no Pointer Lock API at all = a click slaps one where it lands;
// a click on the desktop sticker strip never slaps or starts a row.
const sharp = require('sharp');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startServer } = require('./demo-helpers');

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

(async () => {
  const S = await startServer(8857, { DEMO_PROFILE: '0', ADMIN_TOKEN: 'arrayfb-e2e-admin' });
  const browser = await chromium.launch({ args: GL });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-arrayfb-e2e-'));
  console.log(`Sticker array fallback (${S.base})`);
  try {
    const file = path.join(tmp, 'A_dot.png');
    await sharp({ create: { width: 64, height: 64, channels: 4, background: '#3366ff' } }).png().toFile(file);
    const newRoom = async () => (await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()).room.id;
    const R = await newRoom();
    const onServer = async (room = R) => (await (await fetch(`${S.base}/api/rooms/${room}/stamps`)).json()).stamps;
    const open = async (room, init) => {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 650 } });
      if (init) await ctx.addInitScript(init);
      const p = await ctx.newPage(); const errors = []; p.on('pageerror', (e) => errors.push(e.message));
      await p.goto(`${S.base}/?room=${room}`);
      await p.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
      await p.setInputFiles('#file', file);
      await p.waitForFunction(() => window.klibb.designs().length === 1 && window.klibb.state.selected, null, { timeout: 20000 });
      await p.evaluate(() => { const k = window.klibb; k.moveTo(0, -3); k.look(0, 0); });
      return { ctx, p, errors };
    };
    const { ctx, p, errors } = await open(R);
    await p.mouse.click(500, 325); await p.waitForFunction(() => window.klibb.controls.locked, null, { timeout: 5000 });
    // Headless Chromium reports every mouse event under pointer lock with movementX/Y = the mouse's
    // position (a real mouse held still reports 0): park the mouse at (0, 0) so a press is a press.
    await p.mouse.move(0, 0); await p.evaluate(() => window.klibb.look(0, 0));
    const settle = () => p.waitForFunction(() => window.klibb.pendingSlaps() === 0 && window.klibb.arrayState().inFlight === 0, null, { timeout: 15000 });
    let n = (await onServer()).length;
    check('the locking click is not a slap', n === 0, n);
    // a hold-and-drag (down, turn, up); look(dx) turns the view like the mouse would
    const drag = async (dx = -0.45) => {
      await p.evaluate(() => window.klibb.look(0, 0));
      await p.mouse.down(); await p.waitForTimeout(150);
      await p.evaluate((d) => window.klibb.look(d, 0), dx);
      await p.waitForTimeout(250);
      const during = await p.evaluate(() => window.klibb.arrayState());
      await p.mouse.up(); await settle(); await p.waitForTimeout(150);
      return during;
    };
    const added = async () => { const now = (await onServer()).length; const d = now - n; n = now; return d; };

    // 0) Sanity: a real drag still makes a row (the array feature itself is unchanged).
    const d0 = await drag();
    check(`a real drag still makes a row (1 + ${d0.ghosts})`, d0.ghosts >= 3 && (await added()) === 1 + d0.ghosts, d0);
    // 1) Click and release without a drag = exactly one.
    await p.evaluate(() => window.klibb.look(0.3, 0));
    await p.mouse.down(); await p.waitForTimeout(120);
    const st1 = await p.evaluate(() => window.klibb.arrayState());
    await p.mouse.up(); await settle(); await p.waitForTimeout(150);
    check('click + release without a drag: exactly one sticker (no row)', (await added()) === 1 && st1.ghosts === 0, st1);
    // 2) Starting the row throws (array path unavailable in this browser).
    await p.evaluate(() => { window.klibb.arrayFaults.start = true; });
    const d2 = await drag(-0.3);
    check('array start throws: hold + drag still places exactly one sticker (no ghosts)', (await added()) === 1 && !d2.dragging && d2.ghosts === 0, d2);
    await p.evaluate(() => { window.klibb.arrayFaults.start = false; window.klibb.arrayFaults.update = true; });
    // 3) The drag update throws (ghosts / plane maths fail): one.
    await drag(0.3);
    check('the drag update throws: exactly one sticker, and the game keeps running', (await added()) === 1 && !(await p.evaluate(() => window.klibb.arrayState().dragging)));
    await p.evaluate(() => { window.klibb.arrayFaults.update = false; window.klibb.arrayFaults.commit = true; });
    // 4) The release throws: one (the first sticker).
    const d4 = await drag(-0.3);
    check('releasing the row throws: the first sticker stays, exactly one', d4.ghosts > 0 && (await added()) === 1, d4);
    await p.evaluate(() => { window.klibb.arrayFaults.commit = false; });
    // 5) The array request fails (500): the ghost copies go, the first sticker stays.
    await p.route('**/stamps/array', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
    const d5 = await drag(0.3);
    const local5 = await p.evaluate(() => window.klibb.stampCount ? window.klibb.stampCount() : null);
    check('the array request fails (500): exactly one sticker (the first), the copies are dropped', d5.ghosts > 0 && (await added()) === 1, { d5, local5 });
    // 6) …/stamps/array missing (404 = an older server): one, and arrays are off from then on.
    await p.unroute('**/stamps/array');
    await p.route('**/stamps/array', (r) => r.fulfill({ status: 404, contentType: 'text/html', body: 'Cannot POST' }));
    const d6 = await drag(-0.3);
    check('the array route is missing (404): exactly one sticker', d6.ghosts > 0 && (await added()) === 1, d6);
    check('…and arrays turn off: plain slaps from then on', await p.evaluate(() => window.klibb.arraysOff()));
    const d6b = await drag(0.3);
    check('…the next hold + drag: no ghosts, exactly one sticker', d6b.ghosts === 0 && (await added()) === 1, d6b);
    await p.unroute('**/stamps/array');
    check('no page errors', !errors.length, errors);
    await ctx.close();

    // 7) A browser with no Pointer Lock at all: a click still slaps one, where it lands.
    const R2 = await newRoom();
    const nl = await open(R2, () => { delete HTMLCanvasElement.prototype.requestPointerLock; delete Element.prototype.requestPointerLock; });
    check('no Pointer Lock API: detected', await nl.p.evaluate(() => window.klibb.lockBroken() && !window.klibb.controls.locked));
    await nl.p.mouse.click(500, 300);
    await nl.p.waitForFunction(() => window.klibb.pendingSlaps() === 0, null, { timeout: 15000 });
    await nl.p.waitForTimeout(200);
    let s2 = await onServer(R2);
    check('no Pointer Lock: a click places exactly one sticker', s2.length === 1, s2.length);
    await nl.p.mouse.down(); await nl.p.mouse.move(650, 300, { steps: 5 }); await nl.p.mouse.up();
    await nl.p.waitForFunction(() => window.klibb.pendingSlaps() === 0, null, { timeout: 15000 }); await nl.p.waitForTimeout(200);
    s2 = await onServer(R2);
    check('no Pointer Lock: press, move, release = one more (no row)', s2.length === 2 && !s2.some((s) => s.group), s2.length);
    // the desktop sticker strip: a click there is a pick, never a slap or a row
    const th = await nl.p.$('#strip-row .strip-th');
    if (th) { await th.click(); await nl.p.waitForTimeout(300); }
    s2 = await onServer(R2);
    check('a click on the desktop sticker strip: no slap, no row', !!th && s2.length === 2 && !(await nl.p.evaluate(() => window.klibb.arrayState().dragging)), { th: !!th, n: s2.length });
    check('no page errors (no Pointer Lock)', !nl.errors.length, nl.errors);
    await nl.ctx.close();
  } catch (e) { fail++; console.log('  ✗ crashed: ' + (e && e.stack || e)); }
  finally { await browser.close(); S.child.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(`\nArray fallback e2e: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
