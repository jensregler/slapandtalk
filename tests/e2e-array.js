// E2E (lean): sticker arrays in the web app. Own server (port 8851, normal app). Also: rows that fold
// round a wall→wall corner and down onto the floor (ARRAY_SHOTS=dir saves array-corner/array-floor shots).
// Hold the button after a slap and turn: ghosts repeat the sticker toward the crosshair; release =
// N stickers in the room (1 + the ghosts); Z peels the whole row as one step; Esc while dragging
// cancels the copies (the first sticker stays).
const sharp = require('sharp');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startServer } = require('./demo-helpers');

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

    // 1) Drag: slap, hold, turn, release. (Aim again first: right after the pointer-lock click the
    // camera can still be settling, and a slap on the ceiling would now fold its row onto the wall.)
    await p.waitForTimeout(400);
    await p.evaluate(() => { const k = window.klibb; k.moveTo(0, -3); k.look(0, 0); });
    await p.waitForTimeout(100);
    await p.mouse.down();
    await p.waitForTimeout(150);
    await p.evaluate(() => window.klibb.look(-0.45, 0));
    await p.waitForTimeout(300); await p.evaluate(() => window.klibb.look(-0.45, 0)); // the camera can still be settling after the lock click
    await p.waitForTimeout(100);
    await p.waitForFunction(() => window.klibb.arrayState().ghosts > 0, null, { timeout: 5000 }).catch(() => {});
    const during = await p.evaluate(() => window.klibb.arrayState());
    if (process.env.ARRAY_SHOT) await p.screenshot({ path: process.env.ARRAY_SHOT });
    if (process.env.ARRAY_DEBUG) console.log(JSON.stringify(during));
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
    await p.mouse.down();
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
    await p.mouse.down();
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
    // 5) Round the corner (t367u): the row folds over the seam onto the next wall / the floor.
    const drag = async (from, to, shot = null, look = from) => {
      await p.evaluate(([y, pi]) => window.klibb.look(y, pi), from);
      await p.mouse.down(); await p.waitForTimeout(150);
      await p.evaluate(([y, pi]) => window.klibb.look(y, pi), to);
      await p.waitForFunction(() => { const st = window.klibb.arrayState(); return new Set(st.surfaces).size > 1; }, null, { timeout: 5000 }).catch(() => {});
      const st = await p.evaluate(() => window.klibb.arrayState());
      if (shot) await p.screenshot({ path: shot + '-ghosts.png' });
      await p.mouse.up(); await settle();
      if (shot) { await p.evaluate(([y, pi]) => window.klibb.look(y, pi), look); await p.waitForTimeout(300); await p.screenshot({ path: shot + '.png' }); }
      return st;
    };
    await p.evaluate(() => window.klibb.moveTo(3.6, -3.6));
    const n0 = (await onServer()).length;
    const pc = await p.evaluate(() => window.klibb.peels().count);
    const cst = await drag([0, 0], [-1.25, 0], process.env.ARRAY_SHOTS && process.env.ARRAY_SHOTS + '/array-corner', [-0.75, -0.1]);
    const cAll = await onServer(), cRow = cAll.slice(n0);
    check('corner: while dragging round the corner the ghosts continue onto the east wall', cst.surfaces.includes('vägg-norr') && cst.surfaces.includes('vägg-öster') && cst.ghostMeshes === cst.ghosts, cst);
    check('corner: release saves the copies on both walls (east-wall ones facing into the room)', cRow.length === 1 + cst.ghosts && cRow.some((s) => s.surface === 'vägg-öster')
      && cRow.filter((s) => s.surface === 'vägg-öster').every((s) => Math.abs(s.position[0] - 5) < 1e-6 && s.normal[0] === -1), cRow.map((s) => [s.surface, s.position]));
    const eastZ = cRow.filter((s) => s.surface === 'vägg-öster').map((s) => s.position[2]).sort((a, b) => a - b);
    check('corner: same spacing round the corner (15 cm along the surface)', eastZ.slice(1).every((z, k) => Math.abs(z - eastZ[k] - 0.15) < 0.002), eastZ);
    await p.waitForFunction((n) => window.klibb.peels().count >= n, pc + cRow.length, { timeout: 8000 }).catch(() => {});
    check('corner: every sticker of the folded row drops its own backing paper', (await p.evaluate(() => window.klibb.peels().count)) - pc === cRow.length);
    await p.evaluate(() => window.klibb.moveTo(-2, -4));
    const n1 = (await onServer()).length;
    const fst = await drag([0, 0], [0, -1.2], process.env.ARRAY_SHOTS && process.env.ARRAY_SHOTS + '/array-floor', [0, -0.6]);
    const fRow = (await onServer()).slice(n1);
    check('wall → floor: dragging down onto the floor folds the row onto it (ghosts and saved copies)', fst.surfaces.includes('golv') && fRow.some((s) => s.surface === 'golv')
      && fRow.filter((s) => s.surface === 'golv').every((s) => s.position[1] === 0 && s.normal[1] === 1), { fst, row: fRow.map((s) => [s.surface, s.position]) });
    check('no page errors', !errors.length, errors);
    await ctx.close();
  } catch (e) { fail++; console.log('  ✗ crashed: ' + (e && e.stack || e)); }
  finally { await browser.close(); S.child.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(`\nArray e2e: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
