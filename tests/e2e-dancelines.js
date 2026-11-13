// E2E (Jens t888u, 13 Nov 2026): dance lines. While I dance (X), WHERE on the aimed surface I look drives my Steps
// sound: Highline (up/down on that surface) → the hold of every layer (0 … 3 s), Widthline (left/right) → the drive
// of every layer (0 … 1), heard at once on the dance steps; a big readout on screen; the sky keeps the last values;
// stopping the dance gives my own hold + drive back and my saved Steps patch is never written. Own LOCAL_MODE server
// (port DANCELINES_E2E_PORT, 8967). Screenshots: DANCELINES_SHOTS (default /workspace/dance-lines).
// Run: node tests/e2e-dancelines.js
const fs = require('fs'); const os = require('os'); const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 900) : '')); } };
const SHOTS = process.env.DANCELINES_SHOTS || '/workspace/dance-lines';
(async () => {
  try { fs.mkdirSync(SHOTS, { recursive: true }); } catch { /* read-only: no shots */ }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-dancelines-'));
  const S = await startServer(Number(process.env.DANCELINES_E2E_PORT || 8967), { DEMO_PROFILE: '0', OPEN_ACCESS: '1', LOCAL_MODE: '1', ADMIN_TOKEN: '', DATA_DIR: dir });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const shot = async (P, name) => { try { await P.screenshot({ path: path.join(SHOTS, name) }); } catch { /* no shots dir */ } };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.addInitScript(() => { localStorage.setItem('klibb.avatar', JSON.stringify({ name: 'Jens', look: { outfit: 'casual', hair: 'short', shirt: '#3a7bd5', pants: '#333333', hairColor: '#3b2a1a', skin: '#e0b48c', hat: false, hatColor: '#d33' } })); });
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=stad-byggen`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 90000 });
    await P.mouse.click(800, 500).catch(() => {}); await sleep(300);
    if (await P.evaluate(() => window.klibb.escMenu().info().open)) await P.keyboard.press('Escape');
    await sleep(300);
    const saved0 = await P.evaluate(() => localStorage.getItem('klibb.sound'));
    const d0 = await P.evaluate(() => window.klibb.danceLines());
    check('not dancing: dance lines off, no override, no readout', !d0.on && d0.mod === null && !d0.hud, d0);
    const own = d0.savedStep;
    const lastStep = () => P.evaluate(() => { const l = window.klibb.soundObj().stepLog.filter((e) => !e.remote); return l.length ? { ...l[l.length - 1], n: window.klibb.soundObj().steps } : null; });
    const aim = async (yaw, pitch, ms = 900) => { await P.evaluate(([y, p]) => window.klibb.look(y, p), [yaw, pitch]); await sleep(ms); return { d: await P.evaluate(() => window.klibb.danceLines()), s: await lastStep(), surface: await P.evaluate(() => window.klibb.sightline().surface) }; };

    check('X: dancing', await P.evaluate(() => window.klibb.startDance()) && await P.evaluate(() => window.klibb.dancing()));
    await sleep(600);
    // the wall at the end of the street: low and high on the same facade
    const low = await aim(0, 0), high = await aim(0, 0.5);
    check(`Highline on the wall ahead (${low.surface}): low ${low.d.highline?.toFixed(2)} → high ${high.d.highline?.toFixed(2)}, hold ${low.d.hold?.toFixed(2)} → ${high.d.hold?.toFixed(2)} s`, low.surface === high.surface && high.d.highline > low.d.highline + 0.1 && high.d.hold > low.d.hold, { low: low.d, high: high.d });
    check('hold = 3 s × Highline, drive = Widthline (linear, the full ranges)', [low, high].every((x) => Math.abs(x.d.hold - 3 * x.d.highline) < 1e-9 && Math.abs(x.d.drive - x.d.widthline) < 1e-9) && high.d.ranges.hold.max === 3 && high.d.ranges.drive.max === 1, high.d);
    check(`heard at once: the next dance step plays hold ${high.s?.holds?.join('/')} s, drive ${high.s?.drives?.join('/')} on every layer`, high.s && high.s.holds.length === own.length && high.s.holds.every((h) => Math.abs(h - high.d.hold) < 0.03) && high.s.drives.every((v) => Math.abs(v - high.d.drive) < 0.03) && high.s.n > low.s.n, { s: high.s, d: high.d });
    const hud = high.d.hud;
    check(`big readout while dancing: "${hud.replace('\n', ' | ')}"`, /^Highline \d\.\d\d → hold \d\.\d\d s\nWidthline \d\.\d\d → drive \d\.\d\d/.test(hud), hud);
    const font = await P.evaluate(() => parseFloat(getComputedStyle(document.getElementById('dance-lines-hud')).fontSize));
    check(`readout text is large (${font}px)`, font >= 26, font);
    await shot(P, '01-dance-lines-wall-high.png');
    // turn: Widthline across walls
    const left = await aim(1.5, 0), right = await aim(-1.5, 0);
    check(`Widthline → drive while turning (${left.surface} ${left.d.drive?.toFixed(2)}, ${right.surface} ${right.d.drive?.toFixed(2)}), all in 0…1`, [left, right].every((x) => x.d.drive >= 0 && x.d.drive <= 1 && x.s.drives.every((v) => Math.abs(v - x.d.drive) < 0.03)), { left: left.d, right: right.d });
    await shot(P, '02-dance-lines-turned.png');
    const floor = await aim(0, -0.6);
    check(`on the ground (${floor.surface}): Highline ${floor.d.highline?.toFixed(2)} → hold ${floor.d.hold?.toFixed(2)} s`, floor.d.highline != null && floor.s.holds.every((h) => Math.abs(h - floor.d.hold) < 0.03), floor.d);
    await shot(P, '03-dance-lines-ground.png');
    // the sky: nothing hit → the last values stay
    const kept = floor.d;
    await P.evaluate(() => { const s = window.klibb.sightlineObj(); s._cast = s.cast; s.cast = () => null; });
    const sky = await aim(0, 0.3, 1200);
    check(`sky (nothing hit): the last values stay (hold ${sky.d.hold?.toFixed(3)} s, drive ${sky.d.drive?.toFixed(3)}) and the readout says so`, sky.d.raw == null && Math.abs(sky.d.hold - kept.hold) < 0.02 && Math.abs(sky.d.drive - kept.drive) < 0.02 && /sky: kept/.test(sky.d.hud), { sky: sky.d, kept });
    await shot(P, '04-dance-lines-sky-kept.png');
    await P.evaluate(() => { const s = window.klibb.sightlineObj(); s.cast = s._cast; });
    // smoothing: a jump between surfaces glides
    const from = (await aim(0, -0.6, 900)).d.highline;
    const trail = await P.evaluate(async () => { const out = []; window.klibb.look(0, 0.5); const t0 = performance.now(); while (performance.now() - t0 < 900) { await new Promise((r) => requestAnimationFrame(r)); const d = window.klibb.danceLines(); out.push([d.highline, d.target.highline]); } return out; });
    const to = trail[trail.length - 1][1], between = trail.filter(([h]) => (h - from) * (to - h) > 0 && Math.abs(h - to) > 0.002 && Math.abs(h - from) > 0.002);
    check(`smoothed: a jump between surfaces glides (${from?.toFixed(3)} → ${to?.toFixed(3)} through ${between.length} in-between frames)`, Math.abs(to - from) > 0.02 && between.length >= 1 && Math.abs(trail[trail.length - 1][0] - to) < 0.01, { from, to, trail: trail.slice(0, 20) });
    // stop: back to my own hold + drive, saved patch untouched
    await P.evaluate(() => window.klibb.cancelDance()); await sleep(400);
    const off = await P.evaluate(() => window.klibb.danceLines());
    check('X again: dance lines off, override gone, readout hidden', !off.on && off.mod === null && !off.hud && !(await P.evaluate(() => window.klibb.dancing())), off);
    check('my Steps patch (hold + drive) is what it was before the dance; the saved sound was never written', JSON.stringify(off.savedStep) === JSON.stringify(own) && (await P.evaluate(() => localStorage.getItem('klibb.sound'))) === saved0, { own, after: off.savedStep });
    await P.keyboard.down('KeyW'); await sleep(900); await P.keyboard.up('KeyW'); await sleep(200);
    const walk = await lastStep();
    check(`walking after the dance: my steps have my own hold (${walk?.holds?.join('/')}) + drive (${walk?.drives?.join('/')})`, walk && walk.holds.every((h, i) => Math.abs(h - +(+own[i].hold).toFixed(3)) < 1e-6) && walk.drives.every((v, i) => Math.abs(v - +(+own[i].drive).toFixed(3)) < 1e-6), { walk, own });
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e && e.stack)); }
  finally { await browser.close(); S.child.kill(); }
  console.log(`e2e-dancelines: ${passed} ok, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
