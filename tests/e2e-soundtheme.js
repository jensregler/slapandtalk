// E2E (Jens, 15 Nov 2026): Esc → THEME → THEME A / THEME B – ONE theme per room, the same for everybody ("alla har
// samma tema"). Two players in a room: one picks Theme B, the other gets it at once (room:soundtheme), the server
// keeps it (GET /api/rooms/:room), a reload and a brand-new visitor come in on it. Theme B plays: my Tempo on 60 · 90 ·
// 120 · 180 BPM, every footstep the same pentatonic pitch (no wobble, no left/right foot). Back to A = as before.
// Own server (port 8979). Screenshots → THEME_SHOTS (/workspace/sound-themes).
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
    const roomTheme = async () => (await (await fetch(`${S.base}/api/rooms/${R}`)).json()).room.soundTheme;
    const open = async (artist) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await ctx.addInitScript(({ key, artist }) => { localStorage.setItem('klibb.unlock', key); localStorage.setItem('klibb.artist', artist); }, { key: KEY, artist });
      const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(artist + ': ' + e.message));
      await p.goto(`${S.base}/?room=${R}`);
      await p.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.net.id, null, { timeout: 30000 });
      await p.evaluate(() => window.klibb.entitlementsReady && window.klibb.entitlementsReady());
      return p;
    };
    const P = await open('P'), Q = await open('Q');
    const th = (X) => X.evaluate(() => window.klibb.soundTheme());
    check('a new room is Theme A for both, the room JSON has no soundTheme (as before)', (await th(P)) === 'A' && (await th(Q)) === 'A' && (await roomTheme()) === undefined);

    // ---------- the menu (P) ----------
    await P.evaluate(() => window.klibb.escMenu().open());
    await sleep(700);
    const main = await P.evaluate(() => window.klibb.escMenu().info());
    check(`Esc menu has a THEME button ("${main.themeLabel}")`, main.buttons.includes('theme') && /THEME A/.test(main.themeLabel || ''), main.buttons);
    await P.screenshot({ path: path.join(SHOTS, 'esc-menu-theme-button.png') });
    await P.click('#esc-menu [data-esc="theme"]', { timeout: 5000 });
    await sleep(700);
    const sub = await P.evaluate(() => window.klibb.escMenu().info());
    check('THEME opens THEME A / THEME B / THEME C', sub.view === 'theme' && sub.buttons.join() === 'themeA,themeB,themeC', sub);
    await P.screenshot({ path: path.join(SHOTS, 'theme-menu-A.png') });
    await P.click('#esc-menu [data-esc="themeB"]', { timeout: 5000 });
    await P.waitForFunction(() => window.klibb.soundTheme() === 'B', null, { timeout: 5000 }).catch(() => {});
    await sleep(400);
    const picked = await P.evaluate(() => ({ th: window.klibb.soundTheme(), info: window.klibb.escMenu().info(), sel: document.querySelector('[data-esc="themeB"]').getAttribute('aria-pressed'), ls: localStorage.getItem('klibb.soundTheme') }));
    check('P picks THEME B: ticked, the menu stays on the THEME page, nothing personal in localStorage', picked.th === 'B' && picked.sel === 'true' && picked.ls === null && picked.info.view === 'theme', picked);
    await P.screenshot({ path: path.join(SHOTS, 'theme-menu-B.png') });
    await P.evaluate(() => window.klibb.escMenu().close());

    // ---------- the other player gets it ----------
    const got = await Q.waitForFunction(() => window.klibb.soundTheme() === 'B', null, { timeout: 5000 }).then(() => true).catch(() => false);
    check('Q (the other player) is on Theme B at once, without reloading', got, await th(Q));
    check('the server keeps it on the room', (await roomTheme()) === 'B', await roomTheme());
    const qBpm = await Q.evaluate(() => window.klibb.radio().walkBpm);
    check(`Q plays Theme B too: Tempo ${qBpm} BPM`, [60, 90, 120, 180].includes(qBpm));

    // ---------- Theme B plays (P) ----------
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
    const heard = await Q.evaluate(() => window.klibb.soundObj().stepLog.filter((s) => s.remote).slice(-6));
    check(`Q hears P's steps in Theme B (${heard.length} heard, ${[...new Set(heard.map((s) => (s.hz || []).join('/')))].join(', ')})`, heard.length >= 1 && heard.every((s) => s.theme === 'B' && s.rate === 1 && s.hz.every(isPenta)), heard.slice(0, 3));
    await P.evaluate(() => window.klibb.cancelDance && window.klibb.cancelDance());

    // ---------- reload + a new visitor ----------
    await Q.reload(); await Q.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    await Q.waitForFunction(() => window.klibb.soundTheme() === 'B', null, { timeout: 5000 }).catch(() => {});
    check('Q reloads: still Theme B (from the room, not this browser)', (await th(Q)) === 'B' && (await Q.evaluate(() => localStorage.getItem('klibb.soundTheme'))) === null);
    const N = await open('N');
    await N.waitForFunction(() => window.klibb.soundTheme() === 'B', null, { timeout: 5000 }).catch(() => {});
    check('a brand-new visitor comes in on Theme B', (await th(N)) === 'B');

    // ---------- Theme C: the new visitor picks it in the menu; everybody follows ----------
    await N.evaluate(() => window.klibb.escMenu().open()); await sleep(600);
    await N.click('#esc-menu [data-esc="theme"]', { timeout: 5000 }); await sleep(600);
    await N.click('#esc-menu [data-esc="themeC"]', { timeout: 5000 });
    const toC = await Promise.all([N, P, Q].map((X) => X.waitForFunction(() => window.klibb.soundTheme() === 'C', null, { timeout: 5000 }).then(() => true).catch(() => false)));
    await sleep(300);
    await N.screenshot({ path: path.join(SHOTS, 'theme-menu-C.png') });
    await N.evaluate(() => window.klibb.escMenu().close());
    const cb = await Promise.all([P, Q, N].map((X) => X.evaluate(() => window.klibb.radio().walkBpm)));
    check(`N picks THEME C: all three on it, the room keeps it, Tempo ${cb.join(' / ')} BPM (90 or 120)`, toC.every(Boolean) && (await roomTheme()) === 'C' && cb.every((b) => [90, 120].includes(b)), { toC, cb });
    await P.evaluate(() => { window.klibb.startDance(); }); await sleep(800);
    await P.evaluate(() => { window.klibb.soundObj().stepLog.length = 0; window.klibb.soundObj().play('slap', null, { size: 0.37 }); window.klibb.soundObj().play('peel', null, { size: 1.3 }); });
    await Q.evaluate(() => { window.klibb.soundObj().stepLog.length = 0; });
    await sleep(2500);
    const cSteps = await P.evaluate(() => window.klibb.soundObj().stepLog.filter((s) => !s.remote));
    const cLog = await P.evaluate(() => window.klibb.soundObj().log.slice(-2));
    const cHeard = await Q.evaluate(() => window.klibb.soundObj().stepLog.filter((s) => s.remote).slice(-6));
    check(`Theme C: ${cSteps.length} steps in key (${[...new Set(cSteps.map((s) => s.hz.join('/')))].join(', ')}), no wobble`, cSteps.length >= 3 && cSteps.every((s) => s.theme === 'C' && s.rate === 1 && s.hz.every(isPenta)), cSteps.slice(0, 3));
    check(`Theme C: slap + peel in key (${cLog.map((e) => e.kind + ' ' + (e.hz || []).join('/')).join(', ')})`, cLog.length === 2 && cLog.every((e) => e.theme === 'C' && e.hz.every(isPenta)), cLog);
    check(`Theme C: Q hears P's steps in key (${cHeard.length} heard)`, cHeard.length >= 1 && cHeard.every((s) => s.theme === 'C' && s.hz.every(isPenta)), cHeard.slice(0, 3));
    await P.evaluate(() => window.klibb.cancelDance && window.klibb.cancelDance());

    // ---------- back to A (Q picks it; everybody follows) ----------
    await Q.evaluate(() => window.klibb.soundTheme('A'));
    const back = await Promise.all([P, N].map((X) => X.waitForFunction(() => window.klibb.soundTheme() === 'A', null, { timeout: 5000 }).then(() => true).catch(() => false)));
    check('Q picks Theme A: P and N follow; the room JSON has no soundTheme again', back.every(Boolean) && (await roomTheme()) === undefined, { back, room: await roomTheme() });
    await P.evaluate(() => window.klibb.startDance()); await sleep(800);
    await P.evaluate(() => { window.klibb.soundObj().stepLog.length = 0; });
    await sleep(2500);
    const stepsA = await P.evaluate(() => window.klibb.soundObj().stepLog.filter((s) => !s.remote));
    check(`Theme A: ${stepsA.length} steps, no theme fields in the log (as before)`, stepsA.length >= 3 && stepsA.every((s) => s.theme === undefined && s.hz === undefined), stepsA.slice(0, 2));
    await P.evaluate(() => window.klibb.cancelDance && window.klibb.cancelDance());
    const bad = await (await fetch(`${S.base}/api/rooms/${R}/soundtheme`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: 'Z' }) })).status;
    check(`an unknown theme is refused (${bad})`, bad === 400);
    check('no page errors', errors.length === 0, errors);
  } catch (e) { fail++; console.log('  ✗ crashed: ' + (e && e.stack || e)); }
  finally { await browser.close(); S.child.kill(); }
  console.log(`soundtheme e2e: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
