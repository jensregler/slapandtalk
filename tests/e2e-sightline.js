// E2E (Jens t866u, 12 Nov 2026): Sightline in sneak. Ctrl + moving in the city: the aim's distance (1 m … 96 m,
// log) sets the Steps osc pitch (near = high, far = low); letting go of Ctrl gives my own Steps pitch back and the
// saved Steps patch (the slider) is never changed. Own LOCAL_MODE server (port 8963).
const fs = require('fs'); const os = require('os'); const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 900) : '')); } };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-sight-'));
  const S = await startServer(Number(process.env.SIGHTLINE_E2E_PORT || 8963), { DEMO_PROFILE: '0', OPEN_ACCESS: '1', LOCAL_MODE: '1', ADMIN_TOKEN: '', DATA_DIR: dir });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    await ctx.addInitScript(() => { localStorage.setItem('klibb.avatar', JSON.stringify({ name: 'Jens', look: { outfit: 'casual', hair: 'short', shirt: '#3a7bd5', pants: '#333333', hairColor: '#3b2a1a', skin: '#e0b48c', hat: false, hatColor: '#d33' } })); });
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=stad-byggen`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 90000 });
    await P.mouse.click(600, 400).catch(() => {}); await sleep(300);
    if (await P.evaluate(() => window.klibb.escMenu().info().open)) await P.keyboard.press('Escape');
    await sleep(300);
    const s0 = await P.evaluate(() => window.klibb.sightline());
    check('Sightline is off while not sneaking; my Steps osc pitch is read from my patch', !s0.on && s0.base > 0, s0);
    const sneak = async (pitch, ms = 1400) => {
      await P.evaluate((p) => window.klibb.look(0, p), pitch);
      await P.keyboard.down('Control'); await P.keyboard.down('KeyS'); await sleep(ms);
      const r = await P.evaluate(() => ({ s: window.klibb.sightline(), run: window.klibb.runMode() }));
      await P.keyboard.up('KeyS'); await P.keyboard.up('Control'); await sleep(200);
      return r;
    };
    const far = await sneak(0.02); // straight ahead across the city
    const near = await sneak(-1.35); // down at the ground in front of my feet
    check(`sneak + look far: ${far.s.distance} m → ${far.s.hz?.toFixed(1)} Hz (low)`, far.s.on && far.run.gait === 'crouch' && far.s.distance > 8 && far.s.hz < 400, far);
    check(`sneak + look down: ${near.s.distance} m → ${near.s.hz?.toFixed(1)} Hz (high)`, near.s.on && near.s.distance < 4 && near.s.hz > 600, near);
    check('the played step tune = sightline Hz ÷ my Steps osc pitch', Math.abs(near.run.run.tune - near.s.hz / near.s.base) < 1e-6, near.run.run);
    check('throttled raycast: ~10 casts a second, not every frame', near.s.casts >= 8 && near.s.casts <= 20, near.s.casts);
    await sleep(500);
    const after = await P.evaluate(() => window.klibb.sightline());
    check('letting go of Ctrl: Sightline off, my own Steps osc pitch unchanged (slider never written)', !after.on && after.hz == null && after.base === s0.base, { s0, after });
    // Highline / Widthline (t867u): the same cast, shown in the dev readout (?sightline=1 / klibb.sightlineHud)
    await P.evaluate(() => window.klibb.sightlineHud(true));
    const lines = async (yaw, pitch) => { await P.evaluate(([y, p]) => window.klibb.look(y, p), [yaw, pitch]); await sleep(500); return P.evaluate(() => window.klibb.sightline()); };
    const g1 = await lines(0, -1.35), g2 = await lines(0, -0.9), g3 = await lines(-0.25, -0.9);
    check(`Highline on the ground grows as I look further (${g1.highline} → ${g2.highline}), not sneaking`, !g2.on && g1.highline != null && g2.highline > g1.highline, { g1, g2 });
    check(`Widthline grows as I turn right (${g2.widthline} → ${g3.widthline}); all in 0…1`, g3.widthline > g2.widthline && [g1, g2, g3].every((g) => g.highline >= 0 && g.highline <= 1 && g.widthline >= 0 && g.widthline <= 1), { g2, g3 });
    const w = await lines(0, 0.05);
    const hud = await P.evaluate(() => document.getElementById('sightline-hud')?.textContent || '');
    check(`dev readout: "${hud}"`, /Sightline [\d.]+ m · Highline \d+ % · Widthline \d+ %/.test(hud), { hud, w });
    await P.screenshot({ path: path.join(process.env.DAYTOWNHALL_SHOTS || '/workspace/day-townhall/shots', '12-sightline-readout.png') });
    await P.evaluate(() => window.klibb.sightlineHud(false)); await sleep(200);
    check('readout off again', await P.evaluate(() => document.getElementById('sightline-hud').style.display === 'none'));
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e && e.stack)); }
  finally { await browser.close(); S.child.kill(); }
  console.log(`e2e-sightline: ${passed} ok, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
