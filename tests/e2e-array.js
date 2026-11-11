// E2E (lean): sticker arrays in the web app. Own server (port 8851, normal app).
// Hold the button after a slap and turn: ghosts repeat the sticker toward the crosshair; release =
// N stickers in the room (1 + the ghosts); Z peels the whole row as one step; Esc while dragging
// cancels the copies (the first sticker stays).
const sharp = require('sharp');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startServer } = require('./demo-helpers');
// Point 10 (Jens, 29 Oct 2026): once the held sticker has faded out completely only a press brings
// it back, and that press only wakes it (no slap). These tests are about arrays, not the fade, and
// under swiftshader a mouse event can take seconds to arrive: keep the held sticker sharp (test hook).
const wakeHeld = (p) => p.evaluate(() => window.klibb.holdSharp(true));

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };

(async () => {
  const S = await startServer(8851, { DEMO_PROFILE: '0', ADMIN_TOKEN: 'array-e2e-admin' });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-array-e2e-'));
  console.log(`Sticker arrays (${S.base})`);
  try {
    const file = path.join(tmp, 'A_dot.png');
    await sharp({ create: { width: 64, height: 64, channels: 4, background: '#ff3300' } }).png().toFile(file);
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const R = made.room.id;
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 650 } });
    const p = await ctx.newPage(); const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${S.base}/?room=${R}`);
    await p.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    await p.setInputFiles('#file', file);
    await p.waitForFunction(() => window.klibb.designs().length === 1 && window.klibb.state.selected, null, { timeout: 20000 });
    await p.evaluate(() => window.klibb.setSize(15)); // the A_ prefix no longer sets the start size (30 cm high spawn since 28 Oct 2026): 15 cm by hand
    const onServer = async () => (await (await fetch(`${S.base}/api/rooms/${R}/stamps`)).json()).stamps;
    await p.evaluate(() => { const k = window.klibb; k.moveTo(0, -3); k.look(0, 0); });
    await p.mouse.click(500, 325); await p.waitForFunction(() => window.klibb.controls.locked, null, { timeout: 5000 });
    // Headless Chromium under pointer lock reports a press with movementX/Y = the cursor's position
    // (the aim jumps, e.g. onto the ceiling): park the cursor at (0, 0) so presses don't turn the view.
    await p.mouse.move(0, 0); await p.waitForTimeout(100); await p.evaluate(() => window.klibb.look(0, 0));
    await p.evaluate(() => window.klibb.peelSettled());
    const base = (await onServer()).length; // the locking click is not a slap
    const settle = () => p.waitForFunction(() => window.klibb.pendingSlaps() === 0 && window.klibb.arrayState().inFlight === 0, null, { timeout: 15000 });

    // 1) Drag: slap, hold, turn, release.
    await wakeHeld(p); await p.mouse.down();
    await p.waitForTimeout(150);
    await p.evaluate(() => window.klibb.look(-0.45, 0));
    await p.waitForFunction(() => window.klibb.arrayState().ghosts > 0, null, { timeout: 5000 }).catch(() => {});
    const during = await p.evaluate(() => window.klibb.arrayState());
    if (process.env.ARRAY_SHOT) await p.screenshot({ path: process.env.ARRAY_SHOT });
    check('holding and turning shows ghost copies toward the crosshair', during.dragging && during.ghosts >= 3, during);
    await p.mouse.up();
    await settle();
    const after = await onServer();
    const row = after.filter((s) => s.group);
    check(`release: 1 + ${during.ghosts} stickers in the room, edge to edge, same size`, after.length === base + 1 + during.ghosts && row.length === during.ghosts
      && row.every((s) => s.size === after[base].size), { n: after.length, base, ghosts: during.ghosts, row: row.length });
    const xs = after.slice(base).map((s) => s.position[0]).sort((a, b) => a - b);
    const gaps = xs.slice(1).map((x, k) => Math.round((x - xs[k]) * 1000) / 1000);
    check('neighbours just touch (step = the sticker width, 15 cm)', gaps.every((g) => Math.abs(g - 0.15) < 0.002), gaps);
    const hist = await p.evaluate(() => window.klibb.roomHistory());
    check('the whole row is ONE history entry (anchor + extra)', hist.length === 1 && hist[0].extra && hist[0].extra.length === during.ghosts, hist.map((h) => (h.extra || []).length));

    // 2) Z peels the row.
    await p.evaluate(() => window.klibb.look(0, 0));
    await p.keyboard.press('KeyZ');
    await p.waitForTimeout(300); await p.evaluate(() => window.klibb.peelSettled());
    check('Z peels the whole row in one step', (await onServer()).length === base && (await p.evaluate(() => window.klibb.roomHistory().length)) === 0);

    // 3) Esc while dragging cancels the copies; the first sticker stays.
    await wakeHeld(p); await p.mouse.down();
    await p.waitForTimeout(150);
    await p.evaluate(() => window.klibb.look(0, 0.35));
    await p.waitForFunction(() => window.klibb.arrayState().ghosts > 0, null, { timeout: 5000 }).catch(() => {});
    const up = await p.evaluate(() => window.klibb.arrayState());
    await p.keyboard.press('Escape');
    await p.waitForTimeout(150);
    const esc = await p.evaluate(() => window.klibb.arrayState());
    await p.mouse.up();
    await settle();
    check('Esc while dragging: the ghosts go and nothing is repeated, the first sticker stays', up.ghosts > 0 && !esc.dragging && esc.ghosts === 0 && (await onServer()).length === base + 1, { up, esc });
    // 4) Peels on: EVERY sticker in a row of ~10 drops its backing paper (was only the first 4 copies).
    await fetch(`${S.base}/api/rooms/${R}/peels`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-room-key': made.roomKey }, body: JSON.stringify({ on: true }) });
    await p.waitForFunction(() => window.klibb.peels().on, null, { timeout: 5000 });
    await p.evaluate(() => window.klibb.look(0, 0));
    const floor0 = (await (await fetch(`${S.base}/api/rooms/${R}/stamps`)).json()).peels?.length ?? 0;
    const c0 = await p.evaluate(() => window.klibb.peels().count);
    await wakeHeld(p); await p.mouse.down();
    await p.waitForTimeout(150);
    await p.evaluate(() => window.klibb.look(-0.62, 0));
    await p.waitForFunction(() => window.klibb.arrayState().ghosts >= 9, null, { timeout: 5000 }).catch(() => {});
    const ten = await p.evaluate(() => window.klibb.arrayState());
    await p.mouse.up();
    await settle();
    await p.waitForFunction((n) => window.klibb.peels().count >= n, c0 + 1 + ten.ghosts, { timeout: 8000 }).catch(() => {});
    const c1 = await p.evaluate(() => window.klibb.peels().count);
    const floor1 = (await (await fetch(`${S.base}/api/rooms/${R}/stamps`)).json()).peels?.length ?? 0;
    check(`peels on: a row of ${1 + ten.ghosts} stickers drops ${1 + ten.ghosts} papers (one per sticker), live and on the server`, ten.ghosts >= 9 && c1 - c0 === 1 + ten.ghosts && floor1 - floor0 === 1 + ten.ghosts,
      { ghosts: ten.ghosts, live: c1 - c0, server: floor1 - floor0 });
    // 5) Hold, drag AND scale at once (Jens, 11 Nov 2026): the wheel while the button is held scales the
    //    row's last sticker; the row fans from the anchor's size to it, live and on the server.
    await fetch(`${S.base}/api/rooms/${R}/peels`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-room-key': made.roomKey }, body: JSON.stringify({ on: false }) });
    await p.evaluate(() => window.klibb.look(0, 0.12));
    const n5 = (await onServer()).length;
    await wakeHeld(p); await p.mouse.down();
    await p.waitForTimeout(150);
    await p.evaluate(() => window.klibb.look(-0.3, 0.12));
    await p.waitForFunction(() => window.klibb.arrayState().ghosts > 0, null, { timeout: 5000 }).catch(() => {});
    const s0 = await p.evaluate(() => window.klibb.arrayState());
    for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, -100); await p.waitForTimeout(60); }
    await p.evaluate(() => window.klibb.look(-0.55, 0.12)); // keep dragging after scaling
    await p.waitForTimeout(200);
    const s1 = await p.evaluate(() => window.klibb.arrayState());
    await p.mouse.up();
    await settle();
    const fanRow = (await onServer()).slice(n5);
    check('hold + drag + wheel at once: the last sticker grows while dragging (the row keeps following the crosshair)', s0.dragging && s1.dragging && s1.endSize > s0.endSize * 1.3 && s1.ghosts > 0, { s0, s1 });
    check(`…and the released row (${fanRow.length}) is saved fanned: first = the anchor size, the last the biggest`, fanRow.length === 1 + s1.ghosts && fanRow.at(-1).size > fanRow[0].size * 1.2 && fanRow.every((x, i) => i === 0 || x.size >= fanRow[i - 1].size - 1e-6),
      fanRow.map((x) => x.size));
    check('no page errors', !errors.length, errors);
    await ctx.close();

    // 6) Hold-and-drag in the CITY (it was dead outside the middle 16 m: the rows used the room box).
    const CID = (await (await fetch(S.base + '/api/cities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Rowville', by: 'Jens' }) })).json()).city?.id;
    if (!CID) { check('city made for the city drag', false); } else {
      const cctx = await browser.newContext({ viewport: { width: 1000, height: 650 } });
      const c = await cctx.newPage(); const cerr = []; c.on('pageerror', (e) => cerr.push(e.message));
      await c.goto(`${S.base}/?room=${CID}`);
      await c.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
      await c.setInputFiles('#file', file);
      await c.waitForFunction(() => window.klibb.state.selected && !window.klibb.state.selected.library, null, { timeout: 20000 }).catch(() => {});
      const place = () => c.evaluate(() => { const k = window.klibb; k.setView && k.setView('first', { quiet: true }); k.controls.ground = null; k.controls.collide = null; k.camera.position.set(0, 1.7, 30); k.controls.yaw = Math.PI / 2; k.controls.pitch = -0.9; k.controls.apply(); });
      await c.evaluate(() => window.klibb.setSize(15)); await place();
      await c.mouse.click(500, 325); await c.waitForFunction(() => window.klibb.controls.locked, null, { timeout: 5000 });
      await c.mouse.move(0, 0); await c.waitForTimeout(100); await place();
      const cityOn = async () => (await (await fetch(`${S.base}/api/rooms/${CID}/stamps`)).json()).stamps.length;
      const c0 = await cityOn();
      await wakeHeld(c); await c.mouse.down(); await c.waitForTimeout(250);
      await c.evaluate(() => { const k = window.klibb; k.controls.yaw = Math.PI / 2 + 0.4; k.controls.apply(); });
      await c.waitForFunction(() => window.klibb.arrayState().ghosts > 0, null, { timeout: 5000 }).catch(() => {});
      const cs = await c.evaluate(() => window.klibb.arrayState());
      for (let i = 0; i < 3; i++) { await c.mouse.wheel(0, -100); await c.waitForTimeout(60); }
      const cs2 = await c.evaluate(() => window.klibb.arrayState());
      await c.mouse.up();
      await c.waitForFunction(() => window.klibb.pendingSlaps() === 0 && window.klibb.arrayState().inFlight === 0, null, { timeout: 15000 }).catch(() => {});
      const c1 = await cityOn();
      check('city, 30 m out on the ground: holding and dragging shows ghost copies (was 0)', cs.dragging && cs.ghosts >= 2, cs);
      check(`city: drag + scale at once, then release → 1 + ${cs2.ghosts} stickers saved on the server`, cs2.endSize > cs.endSize && c1 - c0 === 1 + cs2.ghosts && cs2.ghosts >= 2, { c0, c1, cs, cs2 });
      check('city: no page errors', !cerr.length, cerr);
      await cctx.close();
    }
  } catch (e) { fail++; console.log('  ✗ crashed: ' + (e && e.stack || e)); }
  finally { await browser.close(); S.child.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(`\nArray e2e: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
