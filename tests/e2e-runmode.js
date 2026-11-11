// E2E (short, Jens t544u): the dance stops on W/A/S/D (and the other player sees it stop), and run
// mode: Shift + moving puts MY footsteps on the run grid (rate/pitch from the Steps tab's Run mode,
// shared/runmode.mjs); letting go of Shift goes back to walking. Sneak (Jens, 11 Nov 2026): Ctrl + moving = crouch
// tempo/pitch and slower; run + crouch tempo −400…+400 %, live while Sound settings is open; dance + Shift =
// run tempo, dance + Ctrl = crouch tempo. Own server (port 8851).
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
    const ui = await A.evaluate(() => ({ box: !!document.getElementById('snd-run'),
      walk: document.getElementById('walk-tempo-val')?.textContent,
      t: document.getElementById('run-tempo-val')?.textContent, p: document.getElementById('run-pitch-val')?.textContent,
      lock: document.getElementById('run-lock'),
      ct: document.getElementById('crouch-tempo-val')?.textContent, cp: document.getElementById('crouch-pitch-val')?.textContent,
      ctmin: document.getElementById('crouch-tempo')?.min, ctmax: document.getElementById('crouch-tempo')?.max,
      tmin: document.getElementById('run-tempo')?.min, tmax: document.getElementById('run-tempo')?.max, tstep: document.getElementById('run-tempo')?.step,
      wmin: document.getElementById('walk-tempo')?.dataset.min, wmax: document.getElementById('walk-tempo')?.dataset.max,
      bpm: window.klibb.radio().walkBpm }));
    check('Steps tab: Walk tempo (~90 BPM), Run tempo (+100% · 2:1, −400…+400), Pitch correction (+75% fifth), Crouch tempo (−50% · 2:3, −400…+400) + crouch pitch; no lock UI',
      ui.box && /90/.test(ui.walk || '') && ui.t === '+100% · 2:1' && ui.p === '+75% · +7 st (fifth up)' && !ui.lock && ui.tmin === '-400' && ui.tmax === '400' && ui.ct === '-50% · 2:3' && ui.cp === '-80% · -5 st (fourth down)' && ui.ctmin === '-400' && ui.ctmax === '400' && ui.tstep === '12.5' && ui.bpm === 90 && ui.wmin === '30' && ui.wmax === '3000', ui);
    await A.evaluate(() => { const w = document.getElementById('walk-tempo'); w.value = '500'; w.dispatchEvent(new Event('input', { bubbles: true })); });
    const wt = await A.evaluate(() => ({ bpm: window.klibb.radio().walkBpm, room: window.klibb.radio().tempo().bpm, out: document.getElementById('walk-tempo-val').textContent }));
    check('Walk tempo slider: knob middle = 300 BPM, my walk tempo only – the room clock stays ~90', Math.abs(wt.bpm - 300) < 1 && wt.out === '300 BPM' && Math.abs(wt.room - 90) <= 0.3, wt);
    for (const [k, want] of [['0', 30], ['1000', 3000]]) {
      const b = await A.evaluate((k) => { const w = document.getElementById('walk-tempo'); w.value = k; w.dispatchEvent(new Event('input', { bubbles: true })); return window.klibb.radio().walkBpm; }, k);
      check(`Walk tempo slider end ${k} = ${want} BPM`, b === want, b);
    }
    await A.evaluate(() => { const w = document.getElementById('walk-tempo'); w.value = '600'; w.dispatchEvent(new Event('input', { bubbles: true })); const s = document.getElementById('run-tempo'); s.value = '50'; s.dispatchEvent(new Event('input', { bubbles: true })); const p = document.getElementById('run-pitch'); p.value = '-5'; p.dispatchEvent(new Event('input', { bubbles: true })); });
    const ui2 = await A.evaluate(() => ({ t: document.getElementById('run-tempo-val').textContent, p: document.getElementById('run-pitch-val').textContent }));
    check('the sliders show the mapping (+50% · 3:2, −200% octave down)', ui2.t === '+50% · 3:2' && ui2.p === '-200% · -12 st (octave down)', ui2);
    await A.evaluate(() => document.getElementById('snd-save').click());
    const saved = await A.evaluate(() => window.klibb.runMode());
    check('Save keeps it (personal, this visit)', saved.tempo === 50 && saved.pitch === -5 && saved.lock === false, saved);
    const wantW = Math.round(30 * Math.pow(100, 0.6) * 10) / 10;
    const pp = { a: await A.evaluate(() => ({ run: window.klibb.runMode().walkBpm, radio: window.klibb.radio().walkBpm })), b: await B.evaluate(() => ({ run: window.klibb.runMode().walkBpm, radio: window.klibb.radio().walkBpm, room: window.klibb.radio().tempo().bpm })) };
    check(`per player: A saved walk tempo ${wantW} BPM, B (same room) keeps its own 90 BPM`, Math.abs(pp.a.run - wantW) < 0.2 && pp.a.radio === pp.a.run && pp.b.run === 90 && pp.b.radio === 90 && Math.abs(pp.b.room - 90) <= 0.3, pp);

    // ---------- Shift + W = running ----------
    // start each walk at the back of the room facing the long way (W = −z), so no wall stops it
    const place = () => A.evaluate(() => { const k = window.klibb, b = k.controls.bounds; k.camera.position.x = (b.min.x + b.max.x) / 2; k.camera.position.z = b.max.z - 0.4; k.controls.yaw = 0; k.controls.apply(); });
    await A.evaluate(() => { window.klibb.grooveObj().log.length = 0; });
    await A.keyboard.down('Shift'); await A.keyboard.down('KeyW'); await A.waitForTimeout(1500);
    const run = await A.evaluate(() => ({ m: window.klibb.runMode(), log: window.klibb.grooveObj().log.filter((e) => e.id === 'me').slice(-6) }));
    check('Shift + W: running, my steps on the 3:2 run grid an octave down', run.m.running && run.m.run && Math.abs(run.m.run.rate - 1.5) < 1e-9 && Math.abs(run.m.run.tune - 0.5) < 1e-9 && run.log.some((e) => e.run === 1.5), run);
    await A.keyboard.up('Shift'); await A.waitForTimeout(800);
    const walk = await A.evaluate(() => ({ keys: [...window.klibb.controls.keys], mv: window.klibb.controls.moving, pos: [window.klibb.camera.position.x, window.klibb.camera.position.z], tr: window.klibb.groove().tracks, now: window.klibb.grooveObj().now(), m: window.klibb.runMode(), last: window.klibb.grooveObj().log.filter((e) => e.id === 'me').slice(-2) }));
    check('let go of Shift (still walking): back to the walk sound', !walk.m.running && !walk.m.run && walk.last.length && walk.last.every((e) => !e.run), walk);
    await A.keyboard.up('KeyW'); await A.waitForTimeout(400);

    // ---------- Run tempo is live while Sound settings is open (Jens 11 Nov: "run tempo verkar inte funka") ----------
    await A.evaluate(() => { window.klibb.soundUi().open(); document.querySelector('#snd-tabs [data-tab="step"]').click(); });
    await A.evaluate(() => { const s = document.getElementById('run-tempo'); s.value = '37.5'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    const lab = await A.evaluate(() => document.getElementById('run-tempo-val').textContent);
    await place(); await A.waitForTimeout(200);
    await A.evaluate(() => { window.klibb.grooveObj().log.length = 0; });
    await A.keyboard.down('Shift'); await A.keyboard.down('KeyW'); await A.waitForTimeout(1200);
    const live = await A.evaluate(() => ({ m: window.klibb.runMode(), log: window.klibb.grooveObj().log.filter((e) => e.id === 'me').slice(-4) }));
    await A.keyboard.up('KeyW'); await A.keyboard.up('Shift');
    check('+37.5% is its own tempo (11:8, no longer snapped to 3:2) and heard at once, before Save', lab === '+37.5% · 11:8' && Math.abs(live.m.run?.rate - 1.375) < 1e-9 && live.log.some((e) => e.run === 1.375), { lab, live });
    // crouch sliders to the ends
    for (const [v, want] of [['400', '+400% · 5:1'], ['-400', '-400% · 1:5'], ['-100', '-100% · 1:2']]) {
      const got = await A.evaluate((v) => { const s = document.getElementById('crouch-tempo'); s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); return document.getElementById('crouch-tempo-val').textContent; }, v);
      check(`Crouch tempo slider ${v} → ${want}`, got === want, got);
    }
    await A.evaluate(() => { const p = document.getElementById('crouch-pitch'); p.value = '-5'; p.dispatchEvent(new Event('input', { bubbles: true })); });
    await A.evaluate(() => document.getElementById('snd-save').click());
    const sv2 = await A.evaluate(() => window.klibb.runMode());
    check('Save keeps run 37.5 %, crouch −100 % and crouch pitch −5 (octave down)', sv2.tempo === 37.5 && sv2.crouchTempo === -100 && sv2.crouchPitch === -5, sv2);

    // ---------- Ctrl + W = sneak (crouch) ----------
    await A.evaluate(() => window.klibb.setView('first'));
    const speedOf = async (mods) => {
      await place(); await A.waitForTimeout(200);
      for (const m of mods) await A.keyboard.down(m);
      await A.keyboard.down('KeyW'); await A.waitForTimeout(300);
      const p0 = await A.evaluate(() => [window.klibb.camera.position.x, window.klibb.camera.position.z, performance.now()]);
      await A.waitForTimeout(700);
      const p1 = await A.evaluate(() => [window.klibb.camera.position.x, window.klibb.camera.position.z, performance.now()]);
      const m = await A.evaluate(() => ({ m: window.klibb.runMode(), log: window.klibb.grooveObj().log.filter((e) => e.id === 'me').slice(-4) }));
      await A.keyboard.up('KeyW'); for (const k of mods) await A.keyboard.up(k);
      await A.waitForTimeout(300);
      return { v: Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / ((p1[2] - p0[2]) / 1000), ...m };
    };
    const hasCam = await A.evaluate(() => !!(window.klibb.camera && window.klibb.camera.position));
    await A.evaluate(() => { window.klibb.grooveObj().log.length = 0; });
    const cw = await speedOf(['Control']);
    check('Ctrl + W: sneaking – gait crouch, my steps at 1:2 an octave down (crouch tempo/pitch)', cw.m.gait === 'crouch' && cw.m.crouching && !cw.m.running && Math.abs(cw.m.run?.rate - 0.5) < 1e-9 && Math.abs(cw.m.run?.tune - 0.5) < 1e-9 && cw.log.some((e) => e.run === 0.5), cw);
    if (hasCam) {
      const ww = await speedOf([]);
      check('…and slower than walking (sneak speed)', cw.v > 0.2 && cw.v < ww.v * 0.7, { sneak: cw.v, walk: ww.v });
    }
    check('Ctrl + W did not close the page; the tab is still here', !A.isClosed());
    const cs = await speedOf(['Control', 'Shift']);
    check('Ctrl + Shift + W: Ctrl wins → crouch', cs.m.gait === 'crouch', cs.m);

    // ---------- Dance + Shift = run tempo, dance + Ctrl = crouch tempo ----------
    await A.evaluate(() => window.klibb.startDance()); await A.waitForTimeout(400);
    await A.keyboard.down('Shift'); await A.waitForTimeout(500);
    const ds = await A.evaluate(() => ({ d: window.klibb.dancing(), m: window.klibb.runMode(), seq: window.klibb.radio().walk }));
    await A.keyboard.up('Shift'); await A.waitForTimeout(400);
    check('dance + Shift: still dancing, the dance steps on the run tempo (11:8) and run pitch', ds.d && ds.m.gait === 'run' && Math.abs(ds.m.run?.rate - 1.375) < 1e-9 && Math.abs(ds.seq.run?.rate - 1.375) < 1e-9, ds);
    await A.keyboard.down('Control'); await A.waitForTimeout(500);
    const dc = await A.evaluate(() => ({ d: window.klibb.dancing(), m: window.klibb.runMode(), seq: window.klibb.radio().walk }));
    await A.keyboard.up('Control'); await A.waitForTimeout(400);
    check('dance + Ctrl: still dancing, the dance steps on the crouch tempo (1:2) and crouch pitch', dc.d && dc.m.gait === 'crouch' && Math.abs(dc.m.run?.rate - 0.5) < 1e-9 && Math.abs(dc.seq.run?.tune - 0.5) < 1e-9, dc);
    const dw = await A.evaluate(() => ({ d: window.klibb.dancing(), m: window.klibb.runMode() }));
    check('dance, keys up: back to the walk tempo', dw.d && dw.m.gait === 'walk' && !dw.m.run, dw);
    await A.keyboard.press('KeyX'); await A.waitForTimeout(300);
    check('X stops the dance', !(await A.evaluate(() => window.klibb.dancing())));
    await A.keyboard.down('Control'); await A.keyboard.press('KeyX'); await A.waitForTimeout(500);
    const cx = await A.evaluate(() => ({ d: window.klibb.dancing(), m: window.klibb.runMode() }));
    await A.keyboard.up('Control');
    check('hold Ctrl + X: the dance starts, on the crouch tempo', cx.d && cx.m.gait === 'crouch', cx);
    await A.keyboard.press('KeyX'); await A.waitForTimeout(200);
    check('no page errors', !A.errors.length && !B.errors.length, [...A.errors, ...B.errors]);
  } catch (e) { fail++; console.log('  ✗ crashed: ' + (e && e.stack || e)); }
  finally { await browser.close(); S.child.kill(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
