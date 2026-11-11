// E2E (Jens, 11 Nov 2026): while the dance (X) is on, my distance to where the sticker lands sets that slap's
// envelope hold – 0 s within 1 m, 3 s at 96 m (the city across), linear (shared/dancehold.mjs). Not dancing:
// the slap plays with its patch's own hold (no hold override in the sound log). One page, own server
// (port DANCEHOLD_E2E_PORT, 8873). Run: node tests/e2e-dancehold.js
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.DANCEHOLD_E2E_PORT || 8873);

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
const law = (d) => 3 * Math.min(1, Math.max(0, (d - 1) / 95));

(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '0', DEV_UNLOCK: '0' });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  console.log(`Dance-mode hold vector (${S.base})`);
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const R = made.room.id;
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    await ctx.addInitScript(() => localStorage.setItem('klibb.artist', 'A'));
    const P = await ctx.newPage(); const errors = []; P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${R}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.net.id, null, { timeout: 30000 });
    await P.mouse.click(500, 350).catch(() => {}); await P.keyboard.press('Escape').catch(() => {});
    await P.evaluate(() => window.klibb.setView('first'));
    await P.waitForFunction(() => window.klibb.soundObj().engine, null, { timeout: 20000 }).catch(() => {});
    const pose = (x, z, yaw) => P.evaluate(([x, z, yaw]) => { const k = window.klibb; k.controls.ground = null; k.controls.collide = null; k.camera.position.set(x, 1.6, z); k.controls.yaw = yaw; k.controls.pitch = 0; k.controls.apply(); }, [x, z, yaw]);
    // slap at the screen centre; returns the slap's sound-log entry and my distance (head → sticker)
    const slap = () => P.evaluate(async () => {
      const k = window.klibb; k.setMode?.('slap'); k.controls.locked = true;
      const me = k.camera.position.toArray(), n0 = k.soundLog().length;
      const s = await k.stampAt(0, 0); k.controls.locked = false;
      const e = k.soundLog().slice(n0).find((x) => x.kind === 'slap');
      return s && { d: Math.hypot(s.position[0] - me[0], s.position[1] - me[1], s.position[2] - me[2]), e };
    });

    // ---------- not dancing: no override ----------
    await pose(0, 6, 0); await sleep(300);
    let a = await slap(); await sleep(600);
    check('not dancing: the slap plays with the patch\'s own hold (no hold in the log)', a && a.e && !('hold' in a.e), a);

    // ---------- dancing: near and far ----------
    await P.focus('canvas').catch(() => {});
    await P.keyboard.press('KeyX'); await sleep(600);
    check('X: dancing', await P.evaluate(() => window.klibb.dancing()));
    await pose(0, -7.4, 0); await sleep(300);   // ~0.6 m from the north wall (looking north, -z)
    const n = await slap(); await sleep(600);
    check(`dancing, sticker ${n && n.d.toFixed(2)} m away (inside 1 m): hold 0 s`, n && n.e && n.d <= 1 && n.e.hold === 0, n);
    await pose(0, 7.5, 0); await sleep(300);    // across the room: ~15 m
    const f = await slap(); await sleep(600);
    check(`dancing, sticker ${f && f.d.toFixed(2)} m away: hold ${f && f.e && f.e.hold} s = the law (${f && law(f.d).toFixed(3)} s)`, f && f.e && Math.abs(f.e.hold - law(f.d)) < 0.002 && f.e.hold > 0, f);
    check('further sticker → longer hold', n && f && f.e.hold > n.e.hold);

    // ---------- X again: back to normal ----------
    await P.keyboard.press('KeyX'); await sleep(600);
    check('X again: not dancing', !(await P.evaluate(() => window.klibb.dancing())));
    await P.evaluate(() => window.klibb.setView('first'));
    await pose(0, 7.5, 0); await sleep(300);
    a = await slap(); await sleep(600);
    check('after the dance: no hold override again', a && a.e && !('hold' in a.e), a);
    check('no page errors', errors.length === 0, errors);
  } catch (e) { fail++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  finally { await browser.close().catch(() => {}); S.child.kill(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
