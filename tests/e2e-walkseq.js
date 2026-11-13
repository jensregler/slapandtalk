// E2E (Jens t889u, 13 Nov 2026 – was t783u's per-layer walk sequencer): the Steps sound has ONE sequencer for the
// whole sound, at the top of the Steps tab (under Walk, run & sneak). It IS the footsteps: it only runs while I walk
// (standing = silent), the first step is step 1 on the beat, run mode (Shift) runs it at the run rate with the run
// pitch. Slap / Peel / Landing keep their per-layer sequencers (they run on my Tempo while I stand), the four voices too.
// One page, own server (port WALKSEQ_E2E_PORT, 8863). Reads the footstep log (groove.js) and the step log (sound.js).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.WALKSEQ_E2E_PORT || 8863);
const SHOTS = process.env.WALKSEQ_SHOTS || '/workspace/step-seq';

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
const KEY = 'walkseq-e2e-full-key';
const near = (g, want) => Math.abs(g - want) <= want * 0.02 + 1.5;
const onGrid = (g, per) => { const k = Math.round(g / per); return k >= 1 && near(g, k * per); };
const PULSES = [4, 3, 5, 6, 7];

(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '0', DEV_UNLOCK: '0', ADMIN_TOKEN: 'walkseq-e2e-admin', FULL_ACCESS_KEYS: KEY });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  console.log(`Steps sequencer – walk / run (${S.base})`);
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

    // ---------- the Steps tab: one sequencer for the whole sound, above the layers ----------
    await A.evaluate(() => window.klibb.soundUi().open()); await sleep(300);
    await A.click('#snd-tabs [data-tab="step"]'); await sleep(200);
    const ui = await A.evaluate(() => {
      const body = document.getElementById('snd-body'), kids = [...body.children];
      const run = kids.findIndex((e) => e.id === 'snd-run'), seq = kids.findIndex((e) => e.id === 'snd-stepseq'), lay = kids.findIndex((e) => e.classList.contains('snd-layer'));
      const pads = [...document.querySelectorAll('#snd-stepseq .ss-pad')].map((b) => b.getAttribute('aria-pressed'));
      return { run, seq, lay, pads, layerSeqs: document.querySelectorAll('#snd-body .snd-layer .snd-seq-tog').length, addSeq: !!document.getElementById('snd-add-seq'), loop: document.querySelector('#snd-stepseq select[data-name="Loop"]')?.value, p: window.klibb.soundUi().state().patches.step.seq };
    });
    check('Steps tab: the sequencer sits under Walk, run & sneak and above the layers', ui.run >= 0 && ui.seq === ui.run + 1 && ui.lay > ui.seq, ui);
    check('…default 4 steps a footstep: step 1 on, 2–4 off, loop 1 footstep', JSON.stringify(ui.pads) === '["true","false","false","false"]' && ui.loop === '1' && ui.p.len === 4, ui);
    check('…no per-layer sequencer on Steps (no layer toggles, no "+ Sequencer layer")', ui.layerSeqs === 0 && !ui.addSeq, ui);
    // step 3 on → an off-beat step halfway between footsteps; save
    await A.click('#snd-stepseq .ss-pad[data-step="2"]'); await sleep(150);
    const on3 = await A.evaluate(() => window.klibb.soundUi().state().patches.step.seq.steps.map((s) => s.on));
    check('click step 3: on', JSON.stringify(on3) === '[true,false,true,false]', on3);
    await A.evaluate(() => document.getElementById('snd-save').click()); await sleep(300);
    const saved = await A.evaluate(() => window.klibb.soundObj().mine?.patches?.step?.seq);
    check('saved with my sound (whole-sound seq in the Steps patch)', saved && saved.len === 4 && saved.steps[2].on, saved);

    const now = () => A.evaluate(() => window.klibb.grooveObj().now());
    const log = (since) => A.evaluate((since) => window.klibb.grooveObj().log.filter((e) => e.id === 'me' && e.t >= since), since);
    const walk = async (ms, { run = false } = {}) => {
      if (run) await A.keyboard.down('Shift');
      for (const k of ['KeyW', 'KeyS']) { await A.keyboard.down(k); await sleep(ms / 2); await A.keyboard.up(k); }
      if (run) await A.keyboard.up('Shift');
    };

    // ---------- standing still ----------
    await sleep(600); let t0 = await now(); await sleep(2200);
    let ev = await log(t0);
    check('standing still: the Steps sequencer does not roll (no steps in 2.2 s)', ev.length === 0, ev);

    // ---------- walking ----------
    t0 = await now(); await walk(3200);
    ev = await log(t0);
    const slot = ev.length ? ev[0].slot : 0, P = 4000 / 3 / PULSES[slot];
    const gaps = ev.slice(1).map((e, k) => e.t - ev[k].t).filter((g) => g > 20);
    check('walking: steps 1 and 3 only, the first one step 1 (the entry, on the beat)', ev.length >= 6 && ev[0].i === 0 && ev.some((e) => e.entry) && ev.every((e) => e.i === 0 || e.i === 2) && ev.some((e) => e.i === 2), { n: ev.length, ev: ev.slice(0, 8) });
    check(`…on the footstep grid: step 3 halfway between footsteps (${(P / 2).toFixed(1)} ms)`, gaps.length > 3 && gaps.every((g) => onGrid(g, P / 2)) && gaps.filter((g) => near(g, P / 2)).length >= gaps.length / 2, { P, gaps });
    const sl = await A.evaluate(() => window.klibb.soundObj().stepLog.slice(-12).map((e) => ({ step: e.step, vol: e.vol })));
    check('…each step plays the whole Steps sound with its step index (sound.js step log)', sl.length && sl.every((e) => e.step === 0 || e.step === 2), sl);

    // ---------- stop ----------
    await sleep(400); const t2 = await now(); await sleep(1800);
    check('stop: silent again', (await log(t2)).length === 0);

    // ---------- run (Shift, default +100 % = 2:1, a fifth up) ----------
    await sleep(300); t0 = await now(); await walk(2400, { run: true });
    ev = (await log(t0)).filter((e) => e.run);
    const rg = ev.slice(1).map((e, k) => e.t - ev[k].t).filter((g) => g > 10);
    check('running: the same sequencer at 2× (step 3 every half run-footstep), run pitch', ev.length >= 8 && ev.every((e) => e.run === 2 && Math.abs(e.tune - 1.4983) < 1e-3 && (e.i === 0 || e.i === 2)) && rg.every((g) => onGrid(g, P / 4)) && rg.filter((g) => near(g, P / 4)).length >= rg.length / 2, { n: ev.length, rg: rg.slice(0, 10) });
    await sleep(900); const t3 = await now(); await sleep(1500); // (run speed is 2×: the avatar glides a little longer)
    { const l3 = await log(t3); check('…and silent after running', l3.length === 0, { t3, l3 }); }

    // ---------- sneak (Ctrl): default −50 % = 2:3 ----------
    t0 = await now();
    await A.keyboard.down('Control'); for (const k of ['KeyW', 'KeyS']) { await A.keyboard.down(k); await sleep(1600); await A.keyboard.up(k); } await A.keyboard.up('Control');
    ev = (await log(t0)).filter((e) => e.run);
    const cg = ev.slice(1).map((e, k) => e.t - ev[k].t).filter((g) => g > 10);
    check('sneaking (Ctrl): the same sequencer at the crouch rate (2:3)', ev.length >= 3 && ev.every((e) => Math.abs(e.run - 2 / 3) < 1e-3 && (e.i === 0 || e.i === 2)) && cg.every((g) => onGrid(g, P / 2 * 1.5)), { n: ev.length, cg, ev: ev.slice(0, 3) });

    // ---------- Slap keeps its per-layer sequencer (the "your sequencers" that follow Tempo) ----------
    await A.evaluate(() => window.klibb.soundUi().open()); await sleep(300);
    await A.click('#snd-tabs [data-tab="slap"]'); await sleep(200);
    const slapAdd = await A.evaluate(() => !!document.getElementById('snd-add-seq'));
    check('Slap tab: "+ Sequencer layer" is still there', slapAdd);
    await A.click('#snd-add-seq'); await sleep(150);
    await A.evaluate(() => document.getElementById('snd-save').click()); await sleep(1500);
    const keys = await A.evaluate(() => [...new Set(window.klibb.radio().voiceLog.map((e) => e.key))]);
    check('…a Slap sequencer layer runs on my Tempo while I stand (radio.js, unchanged)', keys.some((k) => /^slap\d$/.test(k)), keys);
    await A.evaluate(() => window.klibb.radio().set({ voices: { on: true } }, { save: false })); await sleep(1500);
    const keys2 = await A.evaluate(() => [...new Set(window.klibb.radio().voiceLog.map((e) => e.key))]);
    check('four voices still run', ['v0', 'v1', 'v2', 'v3'].every((k) => keys2.includes(k)), keys2);
    await A.evaluate(() => window.klibb.radio().set({ voices: { on: false } }, { save: false }));
    fs.mkdirSync(SHOTS, { recursive: true });
    await A.evaluate(() => window.klibb.soundUi().open()); await sleep(300);
    await A.click('#snd-tabs [data-tab="step"]'); await sleep(200);
    await (await A.$('#snd-stepseq')).screenshot({ path: path.join(SHOTS, 'walkseq-steps-1-3.png') }).catch(() => {});
    check('no page errors', !A.errors.length, A.errors);
  } catch (e) { fail++; console.log('  ✗ crashed: ' + (e && e.stack || e)); }
  finally { await browser.close(); S.child.kill(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
