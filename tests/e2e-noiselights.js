// E2E (Jens t892u, 13 Nov 2026): Esc → LIGHTS, "Noise room lights". Own LOCAL_MODE server (port 8966).
// Opens the panel from the Esc menu, changes a lamp's colour + brightness and the envelope's release, and
// checks the real THREE lights (and the follower) changed; copy / import / reset; kept after a reload.
const fs = require('fs'); const os = require('os'); const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const SHOTS = process.env.NOISE_LIGHTS_SHOTS || '/workspace/noise-lights';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 900) : '')); } };
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-lights-'));
  const S = await startServer(Number(process.env.NOISE_LIGHTS_PORT || 8966), { DEMO_PROFILE: '0', OPEN_ACCESS: '1', LOCAL_MODE: '1', ADMIN_TOKEN: '', DATA_DIR: dir });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: S.base });
    await ctx.addInitScript(() => { localStorage.setItem('klibb.avatar', JSON.stringify({ name: 'Jens', look: { outfit: 'casual', hair: 'short', shirt: '#3a7bd5', pants: '#333333', hairColor: '#3b2a1a', skin: '#e0b48c', hat: false, hatColor: '#d33' } })); });
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=stad-byggen&noiseplaylist=test`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 90000 });
    await P.mouse.click(800, 500).catch(() => {}); await sleep(300);
    if (await P.evaluate(() => window.klibb.escMenu().info().open)) await P.keyboard.press('Escape');
    await sleep(300);
    const ns = () => P.evaluate(() => window.klibb.noiseSpeakers());
    // in the room, music playing
    await P.evaluate(() => window.klibb.moveTo(0, 33)); await sleep(3500);
    let i0 = await ns();
    for (let k = 0; k < 30 && !i0.players.every((p) => !p.paused && p.ready >= 3); k++) { await sleep(300); i0 = await ns(); }
    check('in the noise room, both speakers playing, four named lamps NW NE SW SE', i0.inRoom && i0.players.every((p) => !p.paused) && ['NW', 'NE', 'SW', 'SE'].every((id) => i0.lights[id]), i0);
    const base = i0.lights.NW.base, d0 = i0.lights.NE.distance;
    check(`defaults = the old look: warm white, decay 1.6, intensity within base × 0.35 … 1.5 (base ${base}, reach ${d0} m)`, Object.values(i0.lights).every((l) => l.color === 'fff4e0'.replace(/^/, '#') && l.decay === 1.6 && l.intensity >= base * 0.35 - 1e-3 && l.intensity <= base * 1.5 + 1e-3), i0.lights);
    // the Esc menu has LIGHTS
    // like Jens: in the game (pointer locked) → Esc → the big buttons → LIGHTS (real clicks)
    await P.mouse.click(400, 500); await sleep(400);
    if (await P.evaluate(() => !!document.pointerLockElement)) { await P.evaluate(() => document.exitPointerLock()); await sleep(900); } // = the browser's own Esc (headless can't)
    if (!(await P.evaluate(() => window.klibb.escMenu().info().open))) { await P.evaluate(() => window.klibb.escMenu().open()); await sleep(700); }
    await sleep(600);
    const menu = await P.evaluate(() => window.klibb.escMenu().info());
    check('the Esc menu shows a LIGHTS button', menu.buttons.includes('lights'), menu.buttons);
    await P.screenshot({ path: path.join(SHOTS, '00-esc-menu-lights-button.png') });
    await P.click('#esc-menu [data-esc="lights"]'); await sleep(600);
    const vis = await P.evaluate(() => { const p = document.getElementById('lights-panel'); const r = p.getBoundingClientRect(); return { hidden: p.hidden, w: r.width, h2: getComputedStyle(p.querySelector('h2')).fontSize, num: getComputedStyle(p.querySelector('.nl-num')).fontSize, tabs: [...p.querySelectorAll('.nl-tab')].map((b) => b.textContent), rows: [...p.querySelectorAll('.nl-row')].map((r) => r.dataset.key) }; });
    check(`the panel "Noise room lights" opens big (${Math.round(vis.w)} px wide, title ${vis.h2}, numbers ${vis.num}); tabs ${vis.tabs.join(' / ')}`, !vis.hidden && vis.w > 600 && parseFloat(vis.h2) >= 30 && parseFloat(vis.num) >= 24 && vis.tabs.length === 6, vis);
    check('envelope controls: attack, release, hold, smoothing, gain, threshold, ceiling, curve, band, Hz, window, rate, master, outside', ['attackMs', 'releaseMs', 'holdMs', 'smoothMs', 'gainDb', 'threshold', 'full', 'curve', 'band', 'bandHz', 'window', 'updateMs', 'master', 'rest'].every((k) => vis.rows.includes(k)), vis.rows);
    await sleep(800);
    await P.screenshot({ path: path.join(SHOTS, '01-panel-envelope.png') });
    // envelope release: 258 → 1500 ms (the number box)
    const setNum = async (key, v) => { const box = P.locator(`#lights-panel .nl-row[data-key="${key}"] .nl-num`); await box.fill(String(v)); await box.press('Enter'); await box.evaluate((b) => b.dispatchEvent(new Event('change'))); await sleep(150); };
    await setNum('releaseMs', 1500);
    const rel = await P.evaluate(() => window.klibb.noiseSpeakersObj().lights.env.releaseMs);
    check(`release set to 1500 ms in the panel → the follower uses ${rel} ms`, rel === 1500, rel);
    // slower fall: after the music's peaks the level stays up longer – the release slider (range) too
    await P.evaluate(() => { const r = document.querySelector('#lights-panel .nl-row[data-key="attackMs"] .nl-range'); r.value = 500; r.dispatchEvent(new Event('input')); });
    const att = await P.evaluate(() => window.klibb.noiseSpeakersObj().lights.env.attackMs);
    check(`attack slider (log) at the middle → ${att} ms`, att > 20 && att < 80, att);
    // lamp NE: red, max brightness 4, min 2
    await P.click('#lights-panel .nl-tab[data-tab="NE"]'); await sleep(200);
    await P.click('#lights-panel .nl-sw[data-color="#ff2a2a"]'); await setNum('min', 2); await setNum('max', 4);
    await sleep(500);
    const i1 = await ns();
    check(`lamp NE turned red (${i1.lights.NE.color}), the others still warm white`, i1.lights.NE.color !== '#fff4e0' && /^#ff/.test(i1.lights.NE.color) && i1.lights.NW.color === '#fff4e0', i1.lights);
    check(`lamp NE brighter: ${i1.lights.NE.intensity} within base × 2 … 4 (${(base * 2).toFixed(1)} … ${(base * 4).toFixed(1)})`, i1.lights.NE.intensity >= base * 2 - 1e-3 && i1.lights.NE.intensity <= base * 4 + 1e-3, i1.lights.NE);
    await P.screenshot({ path: path.join(SHOTS, '02-panel-lamp-NE.png') });
    // NW: off; SW: follows A+B, green, reach 2, hue shift; SE: blue, moved 1 m down
    await P.click('#lights-panel .nl-tab[data-tab="NW"]'); await sleep(200);
    await P.click('#lights-panel [data-key="on"]'); await sleep(200);
    await P.click('#lights-panel .nl-tab[data-tab="SW"]'); await sleep(200);
    await P.click('#lights-panel .nl-segbtn[data-v="mix"]'); await P.click('#lights-panel .nl-sw[data-color="#30ff5a"]'); await setNum('reach', 2); await setNum('max', 4); await setNum('hue', 90);
    await P.click('#lights-panel .nl-tab[data-tab="SE"]'); await sleep(200);
    await P.click('#lights-panel .nl-sw[data-color="#2a5bff"]'); await setNum('dy', -1); await setNum('max', 4);
    await sleep(600);
    const i2 = await ns();
    check(`NW off (intensity ${i2.lights.NW.intensity}), SW reach ${i2.lights.SW.distance} m (2 × ${d0}), SE 1 m lower (y ${i2.lights.SE.pos[1]} vs ${i0.lights.SE.pos[1]})`, i2.lights.NW.intensity === 0 && Math.abs(i2.lights.SW.distance - 2 * d0) < 0.02 && Math.abs(i2.lights.SE.pos[1] - (i0.lights.SE.pos[1] - 1)) < 0.01, i2.lights);
    const mix = await P.evaluate(() => window.klibb.noiseSpeakersObj().lights.lamps.SW.source);
    check('SW follows A + B', mix === 'mix', mix);
    await P.screenshot({ path: path.join(SHOTS, '03-panel-lamp-SE.png') });
    // copy / share
    await P.click('#lights-panel [data-act="copy"]'); await sleep(400);
    const txt = await P.evaluate(() => document.querySelector('#lights-panel .nl-text').value);
    const clip = await P.evaluate(() => navigator.clipboard.readText().catch(() => null));
    check('Copy settings: the JSON in a big text box and on the clipboard', /"noiseLights"/.test(txt) && /"releaseMs": 1500/.test(txt) && (clip === null || clip === txt), { txt: txt.slice(0, 200), clip: clip && clip.slice(0, 80) });
    await P.click('#lights-panel .nl-tab[data-tab="share"]'); await sleep(300);
    await P.screenshot({ path: path.join(SHOTS, '04-panel-share-copy-settings.png') });
    // persisted, survives a reload
    await P.evaluate(() => window.klibb.lightsUi().close()); await sleep(300);
    const stored = await P.evaluate(() => JSON.parse(localStorage.getItem('klibb.noiseLights') || 'null'));
    check('kept in this browser (localStorage klibb.noiseLights)', stored && stored.env.releaseMs === 1500 && stored.lamps.NE.color === '#ff2a2a', stored && stored.env);
    // the room lit with the changed settings (panel closed)
    await P.evaluate(() => window.klibb.moveTo(0, 38.6)); await P.evaluate(() => window.klibb.look(0, 0.55)); await sleep(1500);
    await P.screenshot({ path: path.join(SHOTS, '05-room-lit-with-changed-settings.png') });
    await P.reload(); await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 90000 }); await sleep(800);
    const i3 = await ns();
    check(`after a reload: NE still red (${i3.lights.NE.color}), NW still off, release ${await P.evaluate(() => window.klibb.noiseSpeakersObj().lights.env.releaseMs)} ms`, i3.lights.NE.color === i1.lights.NE.color && i3.lights.NW.intensity === 0, i3.lights);
    // import + reset
    await P.mouse.click(800, 500).catch(() => {}); await sleep(400);
    if (await P.evaluate(() => !!document.pointerLockElement)) { await P.evaluate(() => document.exitPointerLock()); await sleep(900); }
    if (!(await P.evaluate(() => window.klibb.escMenu().info().open))) await P.evaluate(() => window.klibb.escMenu().open());
    await sleep(800); await P.click('#esc-menu [data-esc="lights"]'); await sleep(400);
    await P.evaluate(() => navigator.clipboard.writeText('Hej Ulla! {"noiseLights":{"env":{"releaseMs":700},"lamps":{"SE":{"color":"#a020ff"}}}}').catch(() => {}));
    await P.click('#lights-panel [data-act="paste"]'); await sleep(300);
    let tv = await P.evaluate(() => document.querySelector('#lights-panel .nl-text').value);
    if (!tv.includes('{')) { await P.fill('#lights-panel .nl-text', '{"noiseLights":{"env":{"releaseMs":700},"lamps":{"SE":{"color":"#a020ff"}}}}'); await P.click('#lights-panel [data-act="paste"]'); }
    await sleep(400);
    const imp = await P.evaluate(() => ({ s: window.klibb.noiseSpeakersObj().lights, info: window.klibb.noiseSpeakers().lights }));
    check(`Paste / Import (text with chat around it): release ${imp.s.env.releaseMs} ms, SE ${imp.info.SE.color}, everything else back to defaults`, imp.s.env.releaseMs === 700 && imp.s.lamps.SE.color === '#a020ff' && imp.s.lamps.NE.color === '#fff4e0' && imp.s.lamps.NW.on === true, imp.s);
    await P.click('#lights-panel [data-act="reset"]'); await P.click('#lights-panel [data-act="reset"]'); await sleep(400);
    const rs = await P.evaluate(() => ({ s: window.klibb.noiseSpeakersObj().lights, ls: localStorage.getItem('klibb.noiseLights'), info: window.klibb.noiseSpeakers().lights }));
    check('Reset to defaults (two clicks): the original look, nothing stored', rs.s.env.releaseMs === 258 && Object.values(rs.info).every((l) => l.color === '#fff4e0' && l.decay === 1.6) && rs.ls === null, rs);
    await P.keyboard.press('Escape'); await sleep(300);
    check('Esc closes the panel', await P.evaluate(() => !window.klibb.lightsUi().isOpen()));
    // outside the city: no LIGHTS button
    const P2 = await ctx.newPage(); P2.on('pageerror', (e) => errors.push('P2: ' + e.message));
    await P2.goto(`${S.base}/?room=lights-test-room`); await P2.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 90000 });
    await P2.evaluate(() => window.klibb.escMenu().open()); await sleep(500);
    const b2 = await P2.evaluate(() => window.klibb.escMenu().info().buttons);
    check('a plain room (no noise room): no LIGHTS button', !b2.includes('lights') && b2.includes('sound'), b2);
    await P2.close();
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e && e.stack || e)); }
  finally { await browser.close(); S.child.kill(); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
