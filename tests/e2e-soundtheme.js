// E2E (Jens, 15 Nov 2026): Esc → THEME → THEME A / THEME B. Theme A is the default and plays exactly as before;
// Theme B: my Tempo on 60 · 90 · 120 · 180 BPM, every footstep the same pentatonic pitch (no wobble, no left/right
// foot), the choice remembered across a reload. Own server (port 8979). Screenshots → THEME_SHOTS (/workspace/sound-themes).
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 900) : '')); } };
const KEY = 'soundtheme-e2e-full-key';
const SHOTS = process.env.THEME_SHOTS || '/workspace/sound-themes';
const PENTA = [0, 3, 5, 7, 10];
const isPenta = (hz) => { const m = 12 * Math.log2(hz / 440), r = Math.round(m); return Math.abs(m - r) < 0.01 && PENTA.includes(((r % 12) + 12) % 12); };
(async () => {
  const S = await startServer(Number(process.env.SOUNDTHEME_E2E_PORT || 8979), { DEMO_PROFILE: '0', DEV_UNLOCK: '0', ADMIN_TOKEN: 'soundtheme-e2e-admin', FULL_ACCESS_KEYS: KEY });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    fs.mkdirSync(SHOTS, { recursive: true });
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const R = made.room.id;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(({ R, roomKey, key }) => { localStorage.setItem('klibb.roomKeys', JSON.stringify({ [R]: roomKey })); localStorage.setItem('klibb.unlock', key); localStorage.setItem('klibb.artist', 'T'); }, { R, roomKey: made.roomKey, key: KEY });
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${R}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.net.id, null, { timeout: 30000 });
    await P.evaluate(() => window.klibb.entitlementsReady && window.klibb.entitlementsReady());
    check('default theme is A', (await P.evaluate(() => window.klibb.soundTheme())) === 'A');

    // ---------- the menu ----------
    await P.evaluate(() => window.klibb.escMenu().open());
    await sleep(700);
    const main = await P.evaluate(() => window.klibb.escMenu().info());
    check(`Esc menu has a THEME button ("${main.themeLabel}")`, main.buttons.includes('theme') && /THEME A/.test(main.themeLabel || ''), main.buttons);
    await P.screenshot({ path: path.join(SHOTS, 'esc-menu-theme-button.png') });
    await P.click('#esc-menu [data-esc="theme"]', { timeout: 5000 });
    await sleep(700);
    const sub = await P.evaluate(() => window.klibb.escMenu().info());
    check('THEME opens THEME A / THEME B', sub.view === 'theme' && sub.buttons.join() === 'themeA,themeB', sub);
    await P.screenshot({ path: path.join(SHOTS, 'theme-menu-A.png') });
    await P.click('#esc-menu [data-esc="themeB"]', { timeout: 5000 });
    await sleep(700);
    const picked = await P.evaluate(() => ({ th: window.klibb.soundTheme(), info: window.klibb.escMenu().info(), sel: document.querySelector('[data-esc="themeB"]').getAttribute('aria-pressed'), ls: localStorage.getItem('klibb.soundTheme') }));
    check('THEME B is picked, ticked and remembered', picked.th === 'B' && picked.sel === 'true' && picked.ls === 'B' && picked.info.view === 'theme', picked);
    await P.screenshot({ path: path.join(SHOTS, 'theme-menu-B.png') });
    await P.evaluate(() => window.klibb.escMenu().close());

    // ---------- Theme B: tempo + pitch ----------
    const bpm = await P.evaluate(() => window.klibb.radio().walkBpm);
    check(`Theme B tempo: ${bpm} BPM (one of 60 · 90 · 120 · 180)`, [60, 90, 120, 180].includes(bpm));
    await P.evaluate(() => { window.klibb.soundUi().open(); document.querySelector('#snd-tabs [data-tab="step"]').click(); });
    await sleep(300);
    const ui = await P.evaluate(() => { const w = document.getElementById('walk-tempo'); const seen = []; for (const v of ['0', '1', '2', '3']) { w.value = v; w.dispatchEvent(new Event('input', { bubbles: true })); seen.push(document.getElementById('walk-tempo-val').textContent); } w.value = '1'; w.dispatchEvent(new Event('input', { bubbles: true })); return { max: w.max, seen, note: document.getElementById('snd-theme-note')?.textContent || '', wild: document.getElementById('snd-wild')?.disabled }; });
    check(`Theme B Tempo slider: 4 notches ${ui.seen.join(' | ')}`, ui.max === '3' && ui.seen[0].startsWith('60 BPM') && ui.seen[3].startsWith('180 BPM') && /Theme B/.test(ui.note), ui);
    check('Theme B: the Wild button is off', ui.wild === true, ui);
    const box = await P.$('#snd-run'); if (box) { await P.evaluate(() => document.getElementById('snd-run').scrollIntoView({ block: 'center' })); await sleep(200); await box.screenshot({ path: path.join(SHOTS, 'theme-B-steps-block.png') }); }
    await P.evaluate(() => document.getElementById('snd-cancel').click());
    await P.evaluate(() => { window.klibb.setView('first'); window.klibb.startDance(); });
    await sleep(800);
    await P.evaluate(() => { window.klibb.soundObj().stepLog.length = 0; });
    await sleep(3000);
    const steps = await P.evaluate(() => window.klibb.soundObj().stepLog.filter((s) => !s.remote));
    const hz = [...new Set(steps.map((s) => (s.hz || []).join('/')))];
    check(`Theme B: ${steps.length} steps, all at one pitch (${hz.join(', ')}), rate 1, on A minor pentatonic`, steps.length >= 3 && hz.length === 1 && steps.every((s) => s.theme === 'B' && s.rate === 1 && s.hz.every(isPenta)), steps.slice(0, 4));

    // ---------- back to A: as before ----------
    await P.evaluate(() => window.klibb.soundTheme('A'));
    await sleep(300);
    await P.evaluate(() => { window.klibb.soundObj().stepLog.length = 0; });
    await sleep(2500);
    const stepsA = await P.evaluate(() => window.klibb.soundObj().stepLog.filter((s) => !s.remote));
    check(`Theme A: ${stepsA.length} steps, no theme fields in the log (as before), localStorage cleared`, stepsA.length >= 3 && stepsA.every((s) => s.theme === undefined && s.hz === undefined) && (await P.evaluate(() => localStorage.getItem('klibb.soundTheme'))) === null, stepsA.slice(0, 2));
    await P.evaluate(() => window.klibb.cancelDance && window.klibb.cancelDance());
    // remembered across a reload
    await P.evaluate(() => window.klibb.soundTheme('B'));
    await P.reload(); await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    check('Theme B survives a reload', (await P.evaluate(() => window.klibb.soundTheme())) === 'B');
    check('no page errors', errors.length === 0, errors);
  } catch (e) { fail++; console.log('  ✗ crashed: ' + (e && e.stack || e)); }
  finally { await browser.close(); S.child.kill(); }
  console.log(`soundtheme e2e: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
