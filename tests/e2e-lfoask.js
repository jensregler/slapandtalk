// E2E: layer "LFO?" ask button beside the sound table (Jens t600u).
// Screenshots: /workspace/lfo-ask-1.png (ask visible), /workspace/lfo-ask-2.png (Rate/Depth under slider).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.LFOASK_E2E_PORT || 8917);
const SHOT1 = '/workspace/lfo-ask-1.png';
const SHOT2 = '/workspace/lfo-ask-2.png';
let passed = 0, failed = 0;
const check = (name, ok, extra) => {
  if (ok) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 900) : '')); }
};

const nudge = async (A, layer, param, delta = 50) => {
  await A.$eval(`#snd-body .snd-layer[data-layer="${layer}"] .snd-sl[data-param="${param}"] input`, (r, d) => {
    r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    r.value = String(Math.min(1000, Number(r.value) + d));
    r.dispatchEvent(new Event('input', { bubbles: true }));
    r.dispatchEvent(new Event('change', { bubbles: true }));
  }, delta);
};

(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1', DEV_UNLOCK: '1' });
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const errors = [];
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }),
    })).json();
    const R = made.room.id;
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.addInitScript(() => localStorage.setItem('klibb.devUnlock', '1'));
    const A = await ctx.newPage();
    A.on('pageerror', (e) => errors.push(e.message));
    await A.goto(`${S.base}/?room=${R}`);
    await A.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
    await A.mouse.click(700, 450);
    await A.evaluate(() => window.klibb.soundUi().open());
    await A.waitForSelector('#sound-panel:not([hidden])');
    await sleep(300);

    // slap layer 0 = noise (no Pitch); layer 1 = osc (has Pitch). Use layer 1 for pitch LFO.
    const L = 1;

    const ui0 = await A.evaluate(() => ({
      lfoSelect: !!document.querySelector('#snd-body select[data-name="LFO"]'),
      top: !!document.querySelector('#snd-body .snd-lfo-top'),
      under: !!document.querySelector('#snd-body .snd-lfo-under'),
      ask: !!document.getElementById('lfo-ask'),
      kinds: window.klibb.soundUi().state().patches.slap.layers.map((x) => x.kind),
    }));
    check('no LFO target selector and no snd-lfo-top on open', !ui0.lfoSelect && !ui0.top && !ui0.under && !ui0.ask, ui0);

    await A.evaluate((L) => {
      const row = document.querySelector(`#snd-body .snd-layer[data-layer="${L}"] .snd-sl[data-param="freq"]`);
      if (row) row.scrollIntoView({ block: 'center' });
    }, L);
    await sleep(200);
    const beforeLayout = await A.evaluate((L) => {
      const row = document.querySelector(`#snd-body .snd-layer[data-layer="${L}"] .snd-sl[data-param="freq"]`);
      const next = row && row.nextElementSibling;
      return { top: row.getBoundingClientRect().top, nextCls: next && next.className, has: !!row };
    }, L);
    check('layer 1 has a Pitch slider', beforeLayout.has, beforeLayout);

    await nudge(A, L, 'freq', 50);
    await A.waitForSelector('#lfo-ask', { timeout: 3000 });
    const askCss = await A.evaluate(() => {
      const b = document.getElementById('lfo-ask');
      const s = getComputedStyle(b);
      return { pos: s.position, font: parseFloat(s.fontSize), h: b.getBoundingClientRect().height, text: b.textContent, target: b.dataset.target };
    });
    const afterLayout = await A.evaluate((L) => {
      const row = document.querySelector(`#snd-body .snd-layer[data-layer="${L}"] .snd-sl[data-param="freq"]`);
      const next = row && row.nextElementSibling;
      return { top: row.getBoundingClientRect().top, nextCls: next && next.className };
    }, L);
    check('LFO? appears as a big fixed overlay after moving Pitch', askCss.pos === 'fixed' && askCss.font >= 24 && askCss.h >= 48 && askCss.text === 'LFO?' && askCss.target === 'pitch', askCss);
    check('…and the pitch row did not get a sibling inserted (no table reflow from the ask)', afterLayout.nextCls !== 'lfo-pop' && beforeLayout.nextCls === afterLayout.nextCls && Math.abs(beforeLayout.top - afterLayout.top) < 2, { beforeLayout, afterLayout });

    // Crop to the sound panel + ask button for a clear shot
    await A.evaluate(() => {
      const panel = document.getElementById('sound-panel');
      const ask = document.getElementById('lfo-ask');
      if (panel) panel.scrollTop = 120;
      if (ask) ask.scrollIntoView({ block: 'nearest' });
    });
    await sleep(200);
    // Full viewport shot so the floating LFO? (fixed, outside panel) is visible
    await A.screenshot({ path: SHOT1 });
    check('screenshot 1 written', fs.existsSync(SHOT1) && fs.statSync(SHOT1).size > 1000, SHOT1);

    await A.click('#snd-preview');
    await sleep(150);
    check('clicking something else dismisses LFO? (no)', !(await A.$('#lfo-ask')));

    await nudge(A, L, 'freq', 30);
    await A.waitForSelector('#lfo-ask');
    await A.click('#lfo-ask');
    await A.waitForSelector(`#snd-body .snd-layer[data-layer="${L}"] .snd-lfo-under`);
    const assigned = await A.evaluate((L) => {
      const st = window.klibb.soundUi().state();
      const l = st.patches.slap.layers[L];
      const under = document.querySelector(`#snd-body .snd-layer[data-layer="${L}"] .snd-lfo-under`);
      const freq = document.querySelector(`#snd-body .snd-layer[data-layer="${L}"] .snd-sl[data-param="freq"]`);
      const rate = under && under.querySelector('.snd-sl[data-param="lfoRate"]');
      const depth = under && under.querySelector('.snd-sl[data-param="lfoDepth"]');
      const off = under && under.querySelector('.snd-lfo-off');
      const afterFreq = freq && freq.nextElementSibling;
      return {
        lfo: l.lfo, depth: l.lfoDepth,
        hasRate: !!rate, hasDepth: !!depth, hasOff: !!off,
        underRightAfterFreq: afterFreq === under,
        freqHasLfo: freq && freq.classList.contains('has-lfo'),
        underTarget: under && under.dataset.lfoUnder,
      };
    }, L);
    check('accepting LFO? assigns pitch, bumps depth from 0, puts Rate/Depth under Pitch with an off button',
      assigned.lfo === 'pitch' && assigned.depth === 0.35 && assigned.hasRate && assigned.hasDepth && assigned.hasOff
      && assigned.underRightAfterFreq && assigned.freqHasLfo && assigned.underTarget === 'pitch', assigned);

    await A.evaluate((L) => {
      const u = document.querySelector(`#snd-body .snd-layer[data-layer="${L}"] .snd-lfo-under`);
      if (u) u.scrollIntoView({ block: 'center' });
    }, L);
    await sleep(200);
    await A.screenshot({ path: SHOT2 });
    check('screenshot 2 written', fs.existsSync(SHOT2) && fs.statSync(SHOT2).size > 1000, SHOT2);

    // Move LFO to Cutoff on the same layer
    await nudge(A, L, 'cutoff', 40);
    await A.waitForSelector('#lfo-ask');
    await A.click('#lfo-ask');
    await sleep(200);
    const moved = await A.evaluate((L) => {
      const l = window.klibb.soundUi().state().patches.slap.layers[L];
      const under = document.querySelector(`#snd-body .snd-layer[data-layer="${L}"] .snd-lfo-under`);
      const cutoff = document.querySelector(`#snd-body .snd-layer[data-layer="${L}"] .snd-sl[data-param="cutoff"]`);
      return { lfo: l.lfo, under: under && under.dataset.lfoUnder, afterCutoff: cutoff && cutoff.nextElementSibling === under };
    }, L);
    check('accepting on Cutoff moves the single LFO (Rate/Depth follow)', moved.lfo === 'cutoff' && moved.under === 'cutoff' && moved.afterCutoff, moved);

    await A.click(`#snd-body .snd-layer[data-layer="${L}"] .snd-lfo-off`);
    await sleep(150);
    const off = await A.evaluate((L) => ({
      lfo: window.klibb.soundUi().state().patches.slap.layers[L].lfo,
      under: !!document.querySelector(`#snd-body .snd-layer[data-layer="${L}"] .snd-lfo-under`),
    }), L);
    check('✕ turns the layer LFO off and removes Rate/Depth rows', off.lfo === 'none' && !off.under, off);

    await nudge(A, L, 'a', 40);
    await sleep(250);
    check('Attack does not show the layer LFO? ask', !(await A.$('#lfo-ask')));

    check('no page errors', errors.length === 0, errors);
  } finally {
    await browser.close();
    S.child.kill();
  }
  console.log(`lfoask e2e: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
