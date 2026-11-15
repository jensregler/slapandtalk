// E2E (Jens t956u, t960u, t961u, t962u): lamps flash yellow when a step sounds and white when the
// playhead passes a silent / unmarked (or condition-skipped) step; ratchet probability under each
// ratchet button; the Steps value, pad+lamp count and playhead cycle always agree.
// Screenshots → /workspace/lamps-white.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.STEPLAMP_E2E_PORT || 8883);
const SHOTS = process.env.STEPLAMP_SHOTS || '/workspace/lamps-white';

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 900) : '')); } };
const KEY = 'steplamp-e2e-full-key';

(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '0', DEV_UNLOCK: '0', ADMIN_TOKEN: 'steplamp-e2e-admin', FULL_ACCESS_KEYS: KEY });
  const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
  let browser;
  try { browser = await chromium.launch({ args }); }
  catch { browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args }); }
  console.log(`Step lamps / ratchet prob / Steps length (${S.base})`);
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

    const bigShot = async (name, sel = '#snd-stepseq') => {
      await A.evaluate(() => { const p = document.getElementById('sound-panel'); p.style.maxHeight = 'none'; p.style.position = 'absolute'; p.style.zoom = '2'; p.style.top = '0'; p.style.right = '0';
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

    await A.evaluate(() => window.klibb.soundUi().open()); await sleep(300);
    await A.click('#snd-tabs [data-tab="step"]'); await sleep(200);

    const ui = await A.evaluate(() => {
      const cells = [...document.querySelectorAll('#snd-stepseq .ss-cell')];
      return cells.map((c) => {
        const lamp = c.querySelector('.ss-lamp');
        const pad = c.querySelector('.ss-pad');
        const first = c.firstElementChild;
        const rprob = c.querySelector('.ss-rprob');
        return {
          step: c.dataset.step,
          hasLamp: !!lamp,
          lampOn: lamp ? lamp.classList.contains('on') : false,
          lampWhite: lamp ? lamp.classList.contains('white') : false,
          lampFirst: first === lamp,
          lampBeforePad: lamp && pad && lamp.compareDocumentPosition(pad) & Node.DOCUMENT_POSITION_FOLLOWING,
          round: lamp ? getComputedStyle(lamp).borderRadius : null,
          size: lamp ? { w: lamp.getBoundingClientRect().width, h: lamp.getBoundingClientRect().height } : null,
          rprob: rprob ? rprob.textContent : null,
          padOn: pad && pad.getAttribute('aria-pressed') === 'true',
        };
      });
    });
    check('one lamp above each of the 4 default step pads', ui.length === 4 && ui.every((x) => x.hasLamp && x.lampFirst && x.lampBeforePad), ui);
    check('lamps start dim (none lit yellow or white)', ui.every((x) => x.lampOn === false && x.lampWhite === false), ui);
    check('lamps are round and at least 24 px across (readable)', ui.every((x) => x.round && (x.round === '50%' || parseFloat(x.round) >= 12) && x.size.w >= 24 && x.size.h >= 24), ui);
    check('each step has a ratchet probability button at 100%', ui.length === 4 && ui.every((x) => x.rprob === '100%'), ui);
    check('default: step 1 on, steps 2–4 unmarked', ui[0].padOn === true && ui.slice(1).every((x) => x.padOn === false), ui);

    const lit = await A.evaluate(() => {
      const ctx = window.klibb.soundObj().ctx;
      const now = ctx && Number.isFinite(ctx.currentTime) ? ctx.currentTime : 0;
      const ui = window.klibb.soundUi();
      ui.reportStepLamp(0, now);
      const on = [...ui.tickStepLamps(now)];
      const kinds = ui.tickStepLampKinds ? Object.fromEntries([...ui.tickStepLampKinds(now)]) : null;
      const lamps = [...document.querySelectorAll('#snd-stepseq .ss-lamp')].map((l) => ({ i: l.dataset.step, on: l.classList.contains('on'), white: l.classList.contains('white'), bg: getComputedStyle(l).backgroundColor }));
      return { now, on, kinds, lamps };
    });
    check('reporting a sounded hit on step 1 lights only that lamp yellow', lit.on.join() === '0' && lit.lamps[0].on === true && lit.lamps[0].white === false && lit.lamps.slice(1).every((l) => l.on === false && l.white === false), lit);

    const white = await A.evaluate(() => {
      const ui = window.klibb.soundUi();
      ui.resetStepLamps();
      const ctx = window.klibb.soundObj().ctx;
      const now = ctx && Number.isFinite(ctx.currentTime) ? ctx.currentTime : 0;
      ui.reportStepLamp(1, now, 'white');
      const on = [...ui.tickStepLamps(now)];
      const kinds = ui.tickStepLampKinds ? Object.fromEntries([...ui.tickStepLampKinds(now)]) : null;
      const lamps = [...document.querySelectorAll('#snd-stepseq .ss-lamp')].map((l) => ({ i: l.dataset.step, on: l.classList.contains('on'), white: l.classList.contains('white'), bg: getComputedStyle(l).backgroundColor }));
      return { now, on, kinds, lamps };
    });
    const whiteBg = white.lamps[1] && white.lamps[1].bg;
    const rgb = whiteBg && whiteBg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    const isWhite = rgb && +rgb[1] >= 230 && +rgb[2] >= 230 && +rgb[3] >= 230;
    check('reporting a silent pass on unmarked step 2 lights only that lamp white (not yellow)', white.on.join() === '1' && white.lamps[1].white === true && white.lamps[1].on === false && white.lamps.every((l, i) => i === 1 || (l.on === false && l.white === false)) && isWhite, white);

    const off = await A.evaluate(() => {
      const ui = window.klibb.soundUi();
      const on = [...ui.tickStepLamps(1e9)];
      const lamps = [...document.querySelectorAll('#snd-stepseq .ss-lamp')].map((l) => ({ on: l.classList.contains('on'), white: l.classList.contains('white') }));
      return { on, lamps };
    });
    check('after the flash window, every lamp is dim again', off.on.length === 0 && off.lamps.every((x) => x.on === false && x.white === false), off);

    // Hold styles for the screenshot: real flash is 120 ms and would go dark during zoom/sleep.
    // resetStepLamps cancels the rAF loop so it cannot clear the class mid-shot.
    await A.evaluate(() => {
      window.klibb.soundUi().resetStepLamps();
      document.querySelector('#snd-stepseq .ss-lamp[data-step="0"]').classList.add('on');
      document.querySelector('#snd-stepseq .ss-lamp[data-step="1"]').classList.add('white');
    });
    await bigShot('01-unmarked-step-white-lamp.png', '#snd-stepseq');
    check('white-lamp screenshot written', fs.existsSync(path.join(SHOTS, '01-unmarked-step-white-lamp.png')));

    // Ratchet probability: cycle 100→75, then set ratchet 4× so the new row is clearly in use
    await A.click('#snd-stepseq .ss-ratchet[data-step="0"]'); await sleep(80);
    await A.click('#snd-stepseq .ss-ratchet[data-step="0"]'); await sleep(80);
    await A.click('#snd-stepseq .ss-ratchet[data-step="0"]'); await sleep(80); // 1→2→3→4
    await A.click('#snd-stepseq .ss-rprob[data-step="0"]'); await sleep(80); // 100→75
    const rprob = await A.evaluate(() => {
      const st = window.klibb.soundUi().state().patches.step.seq.steps[0];
      const btn = document.querySelector('#snd-stepseq .ss-rprob[data-step="0"]');
      const all = [...document.querySelectorAll('#snd-stepseq .ss-rprob')].map((b) => b.textContent);
      return { stored: st.ratchetProb, ratchet: st.ratchet, label: btn && btn.textContent, on: btn && btn.classList.contains('on'), all };
    });
    check('ratchet 4× and ratchet prob cycles 100% → 75%, stored on the step', rprob.ratchet === 4 && rprob.stored === 75 && rprob.label === '75%' && rprob.on === true && rprob.all[0] === '75%' && rprob.all.slice(1).every((x) => x === '100%'), rprob);

    await A.evaluate(() => {
      window.klibb.soundUi().resetStepLamps();
      document.querySelector('#snd-stepseq .ss-lamp[data-step="0"]').classList.add('on');
      document.querySelector('#snd-stepseq .ss-lamp[data-step="1"]').classList.add('white');
    });
    await bigShot('02-ratchet-prob-row.png', '#snd-stepseq');
    check('ratchet-prob screenshot written', fs.existsSync(path.join(SHOTS, '02-ratchet-prob-row.png')));

    // t962u: Steps button, pad+lamp count and playhead cycle agree for every length, also after Loop=2
    const LENS = [3, 4, 5, 6, 7, 8, 12, 16];
    const agree = await A.evaluate(async (LENS) => {
      const ui = window.klibb.soundUi();
      const out = [];
      const read = () => {
        const box = document.getElementById('snd-stepseq');
        const sel = [...box.querySelectorAll('.snd-seq-quick button')].find((b) => b.classList.contains('sel'));
        const pads = box.querySelectorAll('.ss-cell').length;
        const lamps = box.querySelectorAll('.ss-lamp').length;
        const rprobs = box.querySelectorAll('.ss-rprob').length;
        const q = ui.state().patches.step.seq;
        const cycle = q.len;
        return { btn: sel ? Number(sel.textContent) : null, pads, lamps, rprobs, len: q.len, steps: q.steps.length, loop: q.loop, cycle, agree: sel && Number(sel.textContent) === pads && pads === lamps && lamps === q.len && q.len === q.steps.length };
      };
      for (const n of LENS) {
        const b = [...document.querySelectorAll('#snd-stepseq .snd-seq-quick button')].find((x) => x.textContent === String(n));
        if (b) b.click();
        out.push({ n, ...read() });
      }
      // Loop = 2 footsteps must not change the cycle length or pad count
      const loopSel = document.querySelector('#snd-stepseq select[data-name="Loop"]') || [...document.querySelectorAll('#snd-stepseq select')].find((s) => [...s.options].some((o) => o.value === '2'));
      const after8 = out[out.length - 2] || out.find((x) => x.n === 8);
      if (loopSel) {
        loopSel.value = '2';
        loopSel.dispatchEvent(new Event('change', { bubbles: true }));
        // stay on last clicked length (16) after loop change
        out.push({ n: 'loop2-at-' + (out[out.length - 1] && out[out.length - 1].n), ...read(), loopChanged: true });
      }
      return out;
    }, LENS);
    for (const row of agree.filter((r) => LENS.includes(r.n))) {
      check(`Steps=${row.n}: button, pads, lamps and playhead cycle all equal ${row.n}`, row.agree === true && row.btn === row.n && row.pads === row.n && row.lamps === row.n && row.rprobs === row.n && row.cycle === row.n && row.steps === row.n, row);
    }
    const loop2 = agree.find((r) => r.loopChanged);
    const lastN = agree.filter((r) => LENS.includes(r.n)).pop();
    check('Loop = 2 footsteps keeps the same Steps length, pads and lamps', !!(loop2 && lastN && loop2.loop === 2 && loop2.pads === lastN.n && loop2.lamps === lastN.n && loop2.cycle === lastN.n && loop2.btn === lastN.n), { loop2, lastN });

    // Back to 8 for a clear grid, Loop 2, then reload: length still agrees
    await A.evaluate(() => {
      const b = [...document.querySelectorAll('#snd-stepseq .snd-seq-quick button')].find((x) => x.textContent === '8');
      if (b) b.click();
    });
    await sleep(100);
    await A.click('#snd-save'); await sleep(400);
    await A.reload({ waitUntil: 'domcontentloaded' }); await boot();
    await A.evaluate(() => window.klibb.soundUi().open()); await sleep(300);
    await A.click('#snd-tabs [data-tab="step"]'); await sleep(200);
    const after = await A.evaluate(() => {
      const box = document.getElementById('snd-stepseq');
      const sel = [...box.querySelectorAll('.snd-seq-quick button')].find((b) => b.classList.contains('sel'));
      const q = window.klibb.soundUi().state().patches.step.seq;
      return { btn: sel ? Number(sel.textContent) : null, pads: box.querySelectorAll('.ss-cell').length, lamps: box.querySelectorAll('.ss-lamp').length, len: q.len, steps: q.steps.length, loop: q.loop, rprob0: q.steps[0] && q.steps[0].ratchetProb, ratchet0: q.steps[0] && q.steps[0].ratchet };
    });
    check('after reload: Steps, pads, lamps and cycle still agree (8) and ratchet prob 75% survived', after.btn === 8 && after.pads === 8 && after.lamps === 8 && after.len === 8 && after.steps === 8 && after.rprob0 === 75 && after.ratchet0 === 4, after);

    check('no page errors', A.errors.length === 0, A.errors);
  } finally {
    try { if (A) await A.context().close(); } catch {}
    try { await browser.close(); } catch {}
    try { S.child.kill(); } catch {}
  }
  console.log(fail ? `FAILED ${fail}, passed ${pass}` : `All ${pass} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
