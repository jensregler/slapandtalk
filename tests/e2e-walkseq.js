// E2E (Jens t783u, 10 Nov 2026): a sequencer layer on the walk (Steps) sound only runs while I walk
// (standing = no steps, the clock doesn't roll), pauses in place, and follows run mode (Shift):
// run tempo × the step rate, run pitch on every step. One page, own server (port WALKSEQ_E2E_PORT, 8863).
// Reads radio.voiceLog (what radio.js scheduled), so it doesn't depend on hearing audio.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.WALKSEQ_E2E_PORT || 8863);
const SHOTS = process.env.WALKSEQ_SHOTS || '/workspace/walk-seq-run-shots';

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
const KEY = 'walkseq-e2e-full-key';
// my own Tempo (90 BPM default; no room nudge since t846u) – the log is in whole ms: 1 %
const near = (g, want) => Math.abs(g - want) <= want * 0.01 + 1;
// a gap of a whole number of steps: turning from W to S stops me for a moment (the footsteps pause too),
// and the sequencer pauses in place – the next step is still the next one in the pattern, on the grid
const onGrid = (g, per) => { const k = Math.round(g / per); return k >= 1 && near(g, k * per); };

(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '0', DEV_UNLOCK: '0', ADMIN_TOKEN: 'walkseq-e2e-admin', FULL_ACCESS_KEYS: KEY });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  console.log(`Walk-sound sequencer (${S.base})`);
  let A;
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const R = made.room.id;
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    await ctx.addInitScript(({ R, roomKey, key }) => { localStorage.setItem('klibb.roomKeys', JSON.stringify({ [R]: roomKey })); localStorage.setItem('klibb.unlock', key); localStorage.setItem('klibb.artist', 'W'); }, { R, roomKey: made.roomKey, key: KEY });
    A = await ctx.newPage(); A.errors = []; A.on('pageerror', (e) => A.errors.push(e.message));
    await A.goto(`${S.base}/?room=${R}`);
    await A.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.net.id, null, { timeout: 30000 });
    await A.evaluate(() => window.klibb.entitlementsReady && window.klibb.entitlementsReady());
    await A.mouse.click(500, 350).catch(() => {}); await A.keyboard.press('Escape').catch(() => {});
    await A.evaluate(() => window.klibb.setView('first'));
    await A.waitForFunction(() => window.klibb.soundObj().engine, null, { timeout: 20000 }).catch(() => {});

    // a sequencer layer on the Steps sound (4 steps per bar, all on), saved
    await A.evaluate(() => window.klibb.soundUi().open()); await sleep(300);
    await A.click('#snd-tabs [data-tab="step"]'); await sleep(200);
    await A.click('#snd-add-seq'); await sleep(150);
    await A.evaluate(() => { const b = [...document.querySelectorAll('.snd-seq-quick button')].find((x) => x.textContent === '4'); b && b.click(); });
    await sleep(150);
    const seq = await A.evaluate(() => { const p = window.klibb.soundUi().state().patches.step; const i = p.layers.findIndex((l) => l.seq); return { i, len: i >= 0 ? p.layers[i].seq.len : 0 }; });
    check('Steps tab: a 4-step sequencer layer added', seq.i >= 0 && seq.len === 4, seq);
    await A.evaluate(() => document.getElementById('snd-save').click()); await sleep(300);
    const key = 'step' + seq.i;
    const stepLog = (since) => A.evaluate(({ key, since }) => window.klibb.radio().voiceLog.filter((e) => e.key === key && e.t >= since), { key, since });
    const now = () => A.evaluate(() => window.klibb.grooveObj().now());

    // ---------- standing still ----------
    await sleep(600); let t0 = await now(); await sleep(2200);
    let ev = await stepLog(t0);
    check('standing still: the walk sequencer does not roll (no steps in 2.2 s)', ev.length === 0, ev);

    // ---------- walking (W, then S back so I don't end up in a wall) ----------
    const walk = async (ms, { run = false } = {}) => {
      if (run) await A.keyboard.down('Shift');
      for (const k of ['KeyW', 'KeyS']) { await A.keyboard.down(k); await sleep(ms / 2); await A.keyboard.up(k); }
      if (run) await A.keyboard.up('Shift');
    };
    t0 = await now();
    await walk(3200);
    const t1 = await now();
    ev = await stepLog(t0);
    const walkGaps = ev.slice(1).map((e, k) => e.t - ev[k].t);
    check('walking: the sequencer steps (≈ 3 steps/s at 90 BPM, 4 per bar)', ev.length >= 3 && ev.every((e) => e.walk && !e.run), { n: ev.length, ev: ev.slice(0, 8) });
    check('…a quarter bar apart (667 ms), in pattern order', walkGaps.length && walkGaps.every((g) => onGrid(g, 666.7)) && walkGaps.filter((g) => near(g, 666.7)).length >= 1 && ev.every((e, k) => k === 0 || e.i === (ev[k - 1].i + 1) % 4), { walkGaps, i: ev.map((e) => e.i) });

    // ---------- stop again ----------
    await sleep(400); const t2 = await now(); await sleep(2000);
    const w1 = await stepLog(t0), lastI = w1.length ? w1[w1.length - 1].i : null; // (incl. the last lookahead step)
    ev = await stepLog(t2);
    check('stop: silent again (no steps after I stop)', ev.length === 0, { ev, stoppedAt: t1 });

    // ---------- walk again: goes on from the next step ----------
    t0 = await now(); await walk(1400);
    ev = await stepLog(t0);
    check('walk again: continues from the next step (pause, not back to step 1)', ev.length >= 1 && ev[0].i === (lastI + 1) % 4, { lastI, first: ev[0] });

    // ---------- run mode: Shift + W ----------
    const rm = await A.evaluate(() => window.klibb.runMode());
    await sleep(500); t0 = await now();
    await walk(2400, { run: true });
    ev = (await stepLog(t0)).filter((e) => e.run);
    const runGaps = ev.slice(1).map((e, k) => e.t - ev[k].t);
    check('running (Shift, default +100 % = 2:1, a fifth up): steps at 2× rate with the run pitch', ev.length >= 6 && ev.every((e) => e.run === 2 && Math.abs(e.tune - 1.4983) < 1e-3) && runGaps.every((g) => onGrid(g, 333.3)) && runGaps.filter((g) => near(g, 333.3)).length >= runGaps.length / 2, { rm, n: ev.length, runGaps, ev: ev.slice(0, 4) });

    // change the run sliders (−100 % = 1:2, octave down) and run again
    await A.evaluate(() => window.klibb.soundUi().open()); await sleep(300);
    await A.click('#snd-tabs [data-tab="step"]'); await sleep(200);
    await A.evaluate(() => { const s = document.getElementById('run-tempo'); s.value = '-100'; s.dispatchEvent(new Event('input', { bubbles: true })); const p = document.getElementById('run-pitch'); p.value = '-5'; p.dispatchEvent(new Event('input', { bubbles: true })); });
    await A.evaluate(() => document.getElementById('snd-save').click()); await sleep(300);
    await sleep(400); t0 = await now();
    await walk(4200, { run: true });
    ev = (await stepLog(t0)).filter((e) => e.run);
    const slowGaps = ev.slice(1).map((e, k) => e.t - ev[k].t);
    check('run tempo −100 % (1:2) + pitch octave down: half the step rate, tune 0.5', ev.length >= 2 && ev.every((e) => e.run === 0.5 && Math.abs(e.tune - 0.5) < 1e-6) && slowGaps.every((g) => onGrid(g, 1333.3)) && ev.every((e, k) => k === 0 || e.i === (ev[k - 1].i + 1) % 4), { n: ev.length, slowGaps, ev: ev.slice(0, 4) });
    await sleep(400); const t3 = await now(); await sleep(1600);
    check('…and silent again after running', (await stepLog(t3)).length === 0);
    // the other sounds' sequencers are unchanged: still on the master clock (checked by e2e-sampler); the four voices still run
    await A.evaluate(() => window.klibb.radio().set({ voices: { on: true } }, { save: false })); await sleep(1500);
    const keys = await A.evaluate(() => [...new Set(window.klibb.radio().voiceLog.map((e) => e.key))]);
    check('four voices still run on the master clock while I stand (unchanged)', ['v0', 'v1', 'v2', 'v3'].every((k) => keys.includes(k)) && !(await stepLog(t3 + 1700)).length, keys);
    await A.evaluate(() => window.klibb.radio().set({ voices: { on: false } }, { save: false }));
    fs.mkdirSync(SHOTS, { recursive: true });
    await A.evaluate(() => window.klibb.soundUi().open()); await sleep(300);
    await A.click('#snd-tabs [data-tab="step"]'); await sleep(200);
    await (await A.$('#sound-panel')).screenshot({ path: path.join(SHOTS, 'steps-tab-seq-run.png') }).catch(() => {});
    check('no page errors', !A.errors.length, A.errors);
  } catch (e) { fail++; console.log('  ✗ crashed: ' + (e && e.stack || e)); }
  finally { await browser.close(); S.child.kill(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
