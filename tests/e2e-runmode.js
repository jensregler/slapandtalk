// E2E (short, Jens t544u): the dance stops on W/A/S/D (and the other player sees it stop), and run
// mode: Shift + moving puts MY footsteps on the run grid (rate/pitch from the Steps tab's Run mode,
// shared/runmode.mjs); letting go of Shift goes back to walking. Own server (port 8851).
const { chromium } = require('playwright');
const { startServer } = require('./demo-helpers');

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 600) : '')); } };
const KEY = 'run-e2e-full-key';

(async () => {
  const S = await startServer(8851, { DEMO_PROFILE: '0', DEV_UNLOCK: '0', ADMIN_TOKEN: 'run-e2e-admin', FULL_ACCESS_KEYS: KEY });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  console.log(`Run mode + dance cancel (${S.base})`);
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const R = made.room.id;
    const open = async (init) => {
      const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
      if (init) await ctx.addInitScript(init, { R, roomKey: made.roomKey, key: KEY });
      const p = await ctx.newPage(); p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message));
      await p.goto(`${S.base}/?room=${R}`);
      await p.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.net.id, null, { timeout: 30000 });
      return p;
    };
    const A = await open(({ R, roomKey, key }) => { localStorage.setItem('klibb.roomKeys', JSON.stringify({ [R]: roomKey })); localStorage.setItem('klibb.unlock', key); localStorage.setItem('klibb.artist', 'A'); });
    const B = await open(() => { localStorage.setItem('klibb.artist', 'B'); });
    await A.evaluate(() => window.klibb.entitlementsReady && window.klibb.entitlementsReady());
    const aId = await A.evaluate(() => window.klibb.net.id);
    await B.waitForFunction((id) => window.klibb.players().some((p) => p.id === id && p.built), aId, { timeout: 15000 }).catch(() => {});

    // ---------- Dance: X starts, W stops ----------
    await A.mouse.click(450, 300).catch(() => {});
    await A.keyboard.press('Escape').catch(() => {});
    await A.evaluate(() => window.klibb.setView('first'));
    const ok = await A.evaluate(() => window.klibb.startDance());
    await A.waitForTimeout(400);
    let s = await A.evaluate(() => ({ d: window.klibb.dancing(), v: window.klibb.view(), grid: window.klibb.selfAvatar() }));
    check('X / startDance: dancing, in 3rd person', ok && s.d && s.v === 'third', s);
    await B.waitForFunction((id) => window.klibb.players().some((p) => p.id === id && p.dancing), aId, { timeout: 5000 }).catch(() => {});
    check('B sees A dance', await B.evaluate((id) => window.klibb.players().some((p) => p.id === id && p.dancing), aId));
    const sa = await A.evaluate(() => window.klibb.selfAvatar()), sb = await B.evaluate((id) => window.klibb.players().find((p) => p.id === id), aId);
    check('…in sync: the same start moment and clock on both screens (4 bars from the next beat)', sa.danceAt != null && sa.danceAt === sb.danceAt && sa.danceBpm === sb.danceBpm && sa.danceBpm > 60, { a: [sa.danceAt, sa.danceBpm], b: [sb.danceAt, sb.danceBpm] });
    await A.keyboard.down('KeyW'); await A.waitForTimeout(250); await A.keyboard.up('KeyW');
    s = await A.evaluate(() => ({ d: window.klibb.dancing(), v: window.klibb.view() }));
    check('W stops the dance at once and the view goes back to 1st person', !s.d && s.v === 'first', s);
    await B.waitForFunction((id) => window.klibb.players().some((p) => p.id === id && !p.dancing), aId, { timeout: 5000 }).catch(() => {});
    check('…and B sees it stop (dance { stop })', await B.evaluate((id) => window.klibb.players().some((p) => p.id === id && !p.dancing), aId));
    // a held key when it starts doesn't cancel it
    await A.keyboard.down('KeyD');
    await A.evaluate(() => window.klibb.startDance()); await A.waitForTimeout(400);
    check('a key already held when the dance starts does not stop it', await A.evaluate(() => window.klibb.dancing()));
    await A.keyboard.up('KeyD');
    await A.keyboard.press('KeyA'); await A.waitForTimeout(100);
    check('A stops it too', !(await A.evaluate(() => window.klibb.dancing())));

    // ---------- Run mode settings (Steps tab) ----------
    await A.evaluate(() => { window.klibb.soundUi().open(); });
    await A.evaluate(() => document.querySelector('#snd-tabs [data-tab="step"]').click());
    const ui = await A.evaluate(() => ({ box: !!document.getElementById('snd-run'), t: document.getElementById('run-tempo-val')?.textContent, p: document.getElementById('run-pitch-val')?.textContent, lock: document.getElementById('run-lock')?.checked,
      tmin: document.getElementById('run-tempo')?.min, tmax: document.getElementById('run-tempo')?.max, tstep: document.getElementById('run-tempo')?.step }));
    check('Steps tab has the Run mode section with defaults (+100% · 2:1, +75% fifth up, lock on)', ui.box && ui.t === '+100% · 2:1' && ui.p === '+75% · +7 st (fifth up)' && ui.lock && ui.tmin === '-200' && ui.tmax === '200' && ui.tstep === '12.5', ui);
    await A.evaluate(() => { const s = document.getElementById('run-tempo'); s.value = '50'; s.dispatchEvent(new Event('input', { bubbles: true })); const p = document.getElementById('run-pitch'); p.value = '-5'; p.dispatchEvent(new Event('input', { bubbles: true })); });
    const ui2 = await A.evaluate(() => ({ t: document.getElementById('run-tempo-val').textContent, p: document.getElementById('run-pitch-val').textContent }));
    check('the sliders show the mapping (+50% · 3:2, −200% octave down)', ui2.t === '+50% · 3:2' && ui2.p === '-200% · -12 st (octave down)', ui2);
    await A.evaluate(() => document.getElementById('snd-save').click());
    const saved = await A.evaluate(() => window.klibb.runMode());
    check('Save keeps it (personal, this visit)', saved.tempo === 50 && saved.pitch === -5 && saved.lock === true, saved);

    // ---------- Shift + W = running ----------
    await A.evaluate(() => { window.klibb.grooveObj().log.length = 0; });
    await A.keyboard.down('Shift'); await A.keyboard.down('KeyW'); await A.waitForTimeout(1500);
    const run = await A.evaluate(() => ({ m: window.klibb.runMode(), log: window.klibb.grooveObj().log.filter((e) => e.id === 'me').slice(-6) }));
    check('Shift + W: running, my steps on the 3:2 run grid an octave down', run.m.running && run.m.run && Math.abs(run.m.run.rate - 1.5) < 1e-9 && Math.abs(run.m.run.tune - 0.5) < 1e-9 && run.log.some((e) => e.run === 1.5), run);
    await A.keyboard.up('Shift'); await A.waitForTimeout(800);
    const walk = await A.evaluate(() => ({ m: window.klibb.runMode(), last: window.klibb.grooveObj().log.filter((e) => e.id === 'me').slice(-2) }));
    check('let go of Shift (still walking): back to the walk sound', !walk.m.running && !walk.m.run && walk.last.length && walk.last.every((e) => !e.run), walk);
    await A.keyboard.up('KeyW');
    check('no page errors', !A.errors.length && !B.errors.length, [...A.errors, ...B.errors]);
  } catch (e) { fail++; console.log('  ✗ crashed: ' + (e && e.stack || e)); }
  finally { await browser.close(); S.child.kill(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
