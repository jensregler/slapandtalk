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
    const onServer = async () => (await (await fetch(`${S.base}/api/rooms/${R}/stamps`)).json()).stamps;
    await p.evaluate(() => { const k = window.klibb; k.moveTo(0, -3); k.look(0, 0); });
    await p.mouse.click(500, 325); await p.waitForFunction(() => window.klibb.controls.locked, null, { timeout: 5000 });
    await p.evaluate(() => window.klibb.peelSettled());
    const base = (await onServer()).length; // the locking click is not a slap
    const settle = () => p.waitForFunction(() => window.klibb.pendingSlaps() === 0 && window.klibb.arrayState().inFlight === 0, null, { timeout: 15000 });

    // 1) Drag: slap, hold, turn, release.
    await p.mouse.down();
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
    check('no page errors', !errors.length, errors);
    await ctx.close();
  } catch (e) { fail++; console.log('  ✗ crashed: ' + (e && e.stack || e)); }
  finally { await browser.close(); S.child.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(`\nArray e2e: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
