// E2E (Jens t889u, 13 Nov 2026): the Steps sequencer's parameter locks. Pick a step (✎, or hold its number), move
// sliders – they lock to that step only (marked orange, 🔒 step N); ✓ Done = back to the base sound (the slider shows
// the base, marked with the steps that lock it). Walking (and dancing, live without Save) plays the locked values on
// that step only. Clear one step / all. An old saved Steps sound with a per-layer sequencer is migrated on load.
// Big screenshots of the panel go to STEPSEQ_SHOTS (/workspace/step-seq). Own server (STEPSEQ_E2E_PORT, 8871).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.STEPSEQ_E2E_PORT || 8871);
const SHOTS = process.env.STEPSEQ_SHOTS || '/workspace/step-seq';

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 900) : '')); } };
const KEY = 'stepseq-e2e-full-key';
const CUT = '#snd-body .snd-layer[data-layer="0"] .snd-sl[data-param="cutoff"]';
const VOL = '#snd-body > .snd-sl[data-lock="G.gain"]';

(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '0', DEV_UNLOCK: '0', ADMIN_TOKEN: 'stepseq-e2e-admin', FULL_ACCESS_KEYS: KEY });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  console.log(`Steps sequencer – parameter locks (${S.base})`);
  fs.mkdirSync(SHOTS, { recursive: true });
  let A;
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const R = made.room.id;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(({ R, roomKey, key }) => { localStorage.setItem('klibb.roomKeys', JSON.stringify({ [R]: roomKey })); localStorage.setItem('klibb.unlock', key); localStorage.setItem('klibb.artist', 'L'); }, { R, roomKey: made.roomKey, key: KEY });
    A = await ctx.newPage(); A.errors = []; A.on('pageerror', (e) => A.errors.push(e.message));
    const boot = async () => {
      await A.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.net.id, null, { timeout: 30000 });
      await A.evaluate(() => window.klibb.entitlementsReady && window.klibb.entitlementsReady());
      await A.mouse.click(640, 450).catch(() => {}); await A.keyboard.press('Escape').catch(() => {});
      await A.evaluate(() => window.klibb.setView('first'));
      await A.waitForFunction(() => window.klibb.soundObj().engine, null, { timeout: 20000 }).catch(() => {});
    };
    await A.goto(`${S.base}/?room=${R}`); await boot();
    const openSteps = async () => { await A.evaluate(() => window.klibb.soundUi().open()); await sleep(300); await A.click('#snd-tabs [data-tab="step"]'); await sleep(200); };
    const seqState = () => A.evaluate(() => JSON.parse(JSON.stringify(window.klibb.soundUi().state().patches.step)));
    const setSlider = (sel, v) => A.evaluate(({ sel, v }) => { const i = document.querySelector(sel + ' input'); i.value = String(v); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); return document.querySelector(sel + ' output').textContent; }, { sel, v });
    const rowInfo = (sel) => A.evaluate((sel) => { const r = document.querySelector(sel); return r && { locked: r.classList.contains('locked'), has: r.classList.contains('has-locks'), steps: r.dataset.lockSteps, badge: r.querySelector('.lock-badge')?.textContent || '', out: r.querySelector('output').textContent, val: r.querySelector('input').value }; }, sel);
    const bigShot = async (name, sel = '#sound-panel') => { // the whole panel (or a part), unscrolled, at 2× (CSS zoom – Jens's eyes); only the top part
      await A.evaluate(() => { const p = document.getElementById('sound-panel'); p.style.maxHeight = 'none'; p.style.position = 'absolute'; p.style.zoom = '2'; p.style.top = '0'; p.style.right = '0';
        // only the top: Volume, Walk/run/sneak, the sequencer and Layer 1 (the rest is hidden for the picture)
        for (const e of document.querySelectorAll('#snd-body > .snd-layer:not([data-layer="0"]), #snd-body > .snd-adds, #snd-body > #snd-mods, #snd-body > .snd-own, #snd-body > .snd-fx')) { e.dataset.shotHide2 = '1'; e.style.display = 'none'; }
      });
      const h = await A.evaluate(() => Math.ceil(document.getElementById('sound-panel').getBoundingClientRect().height * 2 + 40));
      await A.setViewportSize({ width: 1280, height: Math.min(16000, Math.max(900, h)) }); await sleep(300);
      await (await A.$(sel)).screenshot({ path: path.join(SHOTS, name), timeout: 60000 }).catch((e) => console.log('   (shot failed: ' + e.message + ')'));
      await A.evaluate(() => { const p = document.getElementById('sound-panel'); for (const k of ['maxHeight', 'position', 'zoom', 'top', 'right']) p.style[k] = '';
        for (const e of document.querySelectorAll('[data-shot-hide2]')) { e.style.display = ''; delete e.dataset.shotHide2; }
      });
      await A.setViewportSize({ width: 1280, height: 900 }); await sleep(200);
    };

    await openSteps();
    const p0 = await seqState(), baseCut = p0.layers[0].cutoff, baseGain = p0.gain;
    // step 3 on, then pick it with ✎
    await A.click('#snd-stepseq .ss-pad[data-step="2"]'); await sleep(150);
    await A.click('#snd-stepseq .ss-pick[data-step="2"]'); await sleep(200);
    let sel = await A.evaluate(() => ({ sel: window.klibb.soundUi().state().sel, cell: document.querySelector('#snd-stepseq .ss-cell[data-step="2"]').className, bar: document.getElementById('ss-editing')?.textContent || '', on: window.klibb.soundUi().state().patches.step.seq.steps[2].on }));
    check('✎ on step 3: step 3 is picked – yellow frame + "Editing step 3" banner (and the click did not turn it off)', sel.sel === 2 && /sel/.test(sel.cell) && /Editing step 3/.test(sel.bar) && sel.on, sel);
    // lock Layer 1 cutoff + Volume on step 3
    const outCut = await setSlider(CUT, 820); const outVol = await setSlider(VOL, 300);
    let p1 = await seqState();
    const lk = p1.seq.steps[2].locks || {};
    check(`moving Layer 1 Cutoff (${outCut}) and Volume (${outVol}) while step 3 is picked → locks on step 3, the base sound untouched`, lk['L0.cutoff'] > baseCut * 2 && lk['G.gain'] != null && lk['G.gain'] < baseGain && p1.layers[0].cutoff === baseCut && p1.gain === baseGain && !p1.seq.steps[0].locks, { lk, baseCut, baseGain, l0: p1.layers[0].cutoff });
    let ri = await rowInfo(CUT);
    check('…the locked sliders are marked (orange, "🔒 step 3 ✕")', ri.locked && /step 3/.test(ri.badge) && (await rowInfo(VOL)).locked, ri);
    const locked = { cut: lk['L0.cutoff'], gain: lk['G.gain'] };
    await A.click('#snd-stepseq .ss-pick[data-step="0"]'); await sleep(150); await setSlider(CUT, 260); // step 1: a darker cutoff
    await A.click('#snd-stepseq .ss-pick[data-step="2"]'); await sleep(150);
    await bigShot('steps-panel-step3-selected-locked.png');
    await bigShot('steps-sequencer-step3-selected.png', '#snd-stepseq');
    // long-press step 2's number → picks step 2 (does not toggle it)
    const pad = await A.$('#snd-stepseq .ss-pad[data-step="1"]'); await pad.scrollIntoViewIfNeeded(); await sleep(100); const bb = await pad.boundingBox();
    await A.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await A.mouse.down(); await sleep(700); await A.mouse.up(); await sleep(250);
    sel = await A.evaluate(() => ({ sel: window.klibb.soundUi().state().sel, on: window.klibb.soundUi().state().patches.step.seq.steps[1].on }));
    check('long-press on step 2: picks it, stays off', sel.sel === 1 && sel.on === false, sel);
    ri = await rowInfo(CUT);
    check('…step 2 has no cutoff lock: the slider shows the base, marked with the steps that lock it (1, 3)', !ri.locked && ri.has && ri.steps === '1,3', ri);
    // ✓ Done → base
    await A.click('#ss-done'); await sleep(200);
    ri = await rowInfo(CUT);
    sel = await A.evaluate(() => window.klibb.soundUi().state().sel);
    check('✓ Done: back to the base sound – the Cutoff slider shows the base value, badge "🔒 1, 3"', sel === null && !ri.locked && ri.has && /1, 3/.test(ri.badge), ri);
    await setSlider(CUT, 700); p1 = await seqState();
    check('…a slider moved now changes the base (not a lock)', p1.layers[0].cutoff !== baseCut && p1.seq.steps[2].locks['L0.cutoff'] === locked.cut, { base: p1.layers[0].cutoff });
    await setSlider(CUT, 600); // a mid base (between the locks)
    const baseNow = (await seqState()).layers[0].cutoff;
    await bigShot('steps-panel-base-with-lock-markers.png');
    await A.evaluate(() => document.getElementById('snd-save').click()); await sleep(300);
    const savedSeq = await A.evaluate(() => window.klibb.soundObj().mine?.patches?.step?.seq);
    check('Save: the locks are kept in my sound', savedSeq && savedSeq.steps[2].locks && savedSeq.steps[2].locks['L0.cutoff'] === locked.cut && savedSeq.steps[0].locks['L0.cutoff'] > 0, savedSeq);
    const ss = await A.evaluate(() => JSON.parse(sessionStorage.getItem('klibb.sound') || '{}').patches?.step?.seq);
    check('…and in this visit\'s saved sound settings (sessionStorage)', ss && ss.steps[2].locks && ss.steps[2].locks['L0.cutoff'] === locked.cut, ss);

    // ---------- walk: step 3 plays its locks, step 1 its own, nothing else changes ----------
    // walk until some steps were played (W/S, then A/D if a wall is in the way), up to `ms` per pair
    const walkSome = async (ms, want = 6) => {
      const c0 = await A.evaluate(() => window.klibb.grooveObj().log.filter((e) => e.id === 'me').length);
      for (const pair of [['KeyW', 'KeyS'], ['KeyA', 'KeyD'], ['KeyS', 'KeyW']]) {
        for (const k of pair) { await A.keyboard.down(k); await sleep(ms / 2); await A.keyboard.up(k); }
        const c = await A.evaluate(() => window.klibb.grooveObj().log.filter((e) => e.id === 'me').length);
        if (c - c0 >= want) return c - c0;
      }
      return 0;
    };
    const escOpen = () => A.evaluate(() => { const s = document.getElementById('esc-scrim'); return !!(s && getComputedStyle(s).display !== 'none' && !s.hidden); });
    const refocus = async () => { await A.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()); if (await escOpen()) await A.keyboard.press('Escape'); await sleep(200); };
    await refocus();
    const now = () => A.evaluate(() => window.klibb.soundObj().stepLog.length);
    let n0 = await now();
    await walkSome(3600, 8);
    let sl = await A.evaluate((n0) => window.klibb.soundObj().stepLog.slice(n0 - window.klibb.soundObj().stepLog.length || -40).filter((e) => !e.remote), n0);
    sl = sl.slice(-30);
    if (process.env.STEPSEQ_DEBUG) console.log(JSON.stringify(await A.evaluate(() => ({ g: window.klibb.grooveObj().log.slice(-5), n: window.klibb.soundObj().stepLog.length, me: window.klibb.me ? window.klibb.me() : null, act: document.activeElement?.tagName, panel: document.getElementById('sound-panel').hidden, dancing: window.klibb.dancing() }))));
    const s3 = sl.filter((e) => e.step === 2), s1 = sl.filter((e) => e.step === 0);
    const step1Cut = savedSeq.steps[0].locks['L0.cutoff'];
    check(`walking: step 3 plays the locked cutoff ${locked.cut} Hz + volume ×${locked.gain}`, s3.length >= 2 && s3.every((e) => e.locked && e.cut[0] === locked.cut && e.pg === locked.gain), s3.slice(0, 3));
    check(`…step 1 plays its own lock (${step1Cut} Hz) at the base volume – never step 3's values`, s1.length >= 2 && s1.every((e) => e.cut[0] === step1Cut && e.pg === baseGain), s1.slice(0, 3));
    check('…the other layers keep the base on both steps (the lock is on layer 1 only)', sl.every((e) => e.cut.length < 2 || e.cut[1] === p0.layers[1].cutoff), sl.slice(0, 2).map((e) => e.cut));

    // ---------- dancing: a lock changed in the panel is heard at once (live, no Save, still dancing) ----------
    const started = await A.evaluate(() => window.klibb.startDance()); await sleep(1500);
    await openSteps();
    await A.click('#snd-stepseq .ss-pick[data-step="2"]'); await sleep(150);
    const out2 = await setSlider(CUT, 950); await sleep(1600);
    const lk2 = (await seqState()).seq.steps[2].locks['L0.cutoff'];
    sl = (await A.evaluate(() => window.klibb.soundObj().stepLog.slice(-10))).filter((e) => e.step === 2);
    check(`dancing: step 3's cutoff lock moved to ${out2} → the next dance steps play it at once (no Save), still dancing`, started && sl.length >= 1 && sl.at(-1).cut[0] === lk2 && lk2 !== locked.cut && (await A.evaluate(() => window.klibb.dancing())), { started, lk2, sl: sl.slice(-2) });
    await A.evaluate(() => window.klibb.stopDance && window.klibb.stopDance()); await A.keyboard.press('KeyX').catch(() => {});

    // ---------- clear ----------
    await A.click('#ss-clear-step'); await sleep(200);
    let p2 = await seqState();
    check('"Clear step 3 locks": step 3 has none, step 1 keeps its lock', !p2.seq.steps[2].locks && p2.seq.steps[0].locks && (await rowInfo(CUT)).locked === false, p2.seq.steps.map((s) => s.locks || null));
    await A.click('#ss-clear-all'); await sleep(200);
    p2 = await seqState();
    check('"Clear all locks": none left, no markers', p2.seq.steps.every((s) => !s.locks) && !(await rowInfo(CUT)).has && !(await rowInfo(CUT)).locked);
    await A.click('#snd-cancel'); await sleep(200);

    // ---------- an OLD save (per-layer Steps sequencer) is migrated on load ----------
    await A.evaluate(() => sessionStorage.setItem('klibb.sound', JSON.stringify({ patches: { step: { v: 1, gain: 1, layers: [
      { kind: 'noise', noise: 'pink', filter: 'lowpass', cutoff: 520, a: 0.002, d: 0.055, level: 0.16, seq: { len: 5, bars: 0.5, steps: [{ on: true, vol: 100 }, { on: false, vol: 100 }, { on: true, vol: 70 }, { on: false, vol: 100 }, { on: true, vol: 100 }] } },
      { kind: 'osc', wave: 'sine', freq: 85, d: 0.05, level: 0.12 }] } } })));
    await A.reload(); await boot();
    await openSteps();
    const mig = await A.evaluate(() => ({ seq: window.klibb.soundUi().state().patches.step.seq, layerSeq: window.klibb.soundUi().state().patches.step.layers.map((l) => !!l.seq), pads: [...document.querySelectorAll('#snd-stepseq .ss-pad')].map((b) => b.getAttribute('aria-pressed')), loop: document.querySelector('#snd-stepseq select[data-name="Loop"]').value }));
    check('old save (Layer 1 "Sequencer: on", 5 steps, ½ bar): loads as the whole-sound sequencer – 5 steps (1, 3, 5 on), loop 4 footsteps, no layer sequencers', mig.seq.len === 5 && JSON.stringify(mig.pads) === '["true","false","true","false","true"]' && mig.loop === '4' && mig.layerSeq.every((x) => !x), mig);
    await bigShot('steps-panel-migrated-old-save.png');
    await A.click('#snd-cancel'); await sleep(200); await refocus();
    n0 = await A.evaluate(() => window.klibb.soundObj().stepLog.length);
    if (process.env.STEPSEQ_DEBUG) console.log('MIG0', await A.evaluate(() => JSON.stringify({ view: window.klibb.view(), focus: document.hasFocus(), open: window.klibb.soundUi().isOpen(), esc: document.getElementById('esc-scrim') && getComputedStyle(document.getElementById('esc-scrim')).display, act: document.activeElement?.tagName })));
    await walkSome(3000, 4);
    sl = (await A.evaluate(() => window.klibb.soundObj().stepLog.slice(-20))).filter((e) => !e.remote);
    check('…and walking plays it: both layers on every played step (none is skipped as a "sequencer layer")', sl.length >= 2 && sl.every((e) => [0, 2, 4].includes(e.step) && e.cut.length === 2), sl.slice(0, 3).map((e) => ({ step: e.step, cut: e.cut })));
    check('no page errors', !A.errors.length, A.errors);
  } catch (e) { fail++; console.log('  ✗ crashed: ' + (e && e.stack || e)); }
  finally { await browser.close(); S.child.kill(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
