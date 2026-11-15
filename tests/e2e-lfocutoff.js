// E2E (Jens t959u "lfo funkar icke"): a slow layer LFO on Cutoff (sine 0.4 Hz, depth 70 %, cutoff 466 Hz, Q 11.4 –
// his screenshot) must audibly change the Steps sound over time:
//   1) offline render of short footstep hits the way the game plays them (pool 'step' = free-running LFO): the
//      brightness of the hits rises and falls; with the LFO off it stays flat.
//   2) the Sound settings preview of Steps (▶ Preview / slider moves / ▶ Hear step) uses my free-running clock
//      (pool 'step', lfoId 'me') – before, every preview restarted the LFO at phase 0, so every audition was identical.
//   3) Theme B (no LFOs on Steps) says so under the LFO.
// Needs a build (npx vite build). Own server (8936).
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.LFOCUT_E2E_PORT || 8936);
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 900) : '')); } };
const LAYER = { kind: 'osc', wave: 'sawtooth', freq: 110, filter: 'lowpass', cutoff: 466, q: 11.4, fEnv: 0, fTime: 0.1,
  lfo: 'cutoff', lfoWave: 'sine', lfoRate: 0.4, lfoDepth: 0.7, a: 0.002, d: 0.05, s: 0.3, hold: 0.05, r: 0.003, level: 0.6 };
(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1', DEV_UNLOCK: '1' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) })).json();
    const R = made.room.id;
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.addInitScript(() => localStorage.setItem('klibb.devUnlock', '1'));
    const A = await ctx.newPage(); A.on('pageerror', (e) => errors.push(e.message));
    await A.goto(`${S.base}/?room=${R}`);
    await A.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
    await A.mouse.click(700, 450); await sleep(300);

    // ---------- 1) offline: footstep hits over 2.7 s (a bit more than one 0.4 Hz cycle) ----------
    const patch = { v: 1, gain: 0.8, layers: [LAYER] };
    const on = await A.evaluate((p) => window.klibb.renderLfoHits({ patch: p, hits: 10, gap: 0.3, pool: 'step' }), patch);
    const off = await A.evaluate((p) => window.klibb.renderLfoHits({ patch: { ...p, layers: [{ ...p.layers[0], lfo: 'none', lfoDepth: 0 }] }, hits: 10, gap: 0.3, pool: 'step' }), patch);
    const span = (a) => { const v = a.filter((x) => x != null); return v.length ? Math.max(...v) / Math.max(1e-6, Math.min(...v)) : 0; };
    console.log('    brightness per hit, LFO on :', JSON.stringify(on));
    console.log('    brightness per hit, LFO off:', JSON.stringify(off));
    check('every hit sounds (no silent footsteps)', on.every((x) => x != null) && off.every((x) => x != null), { on, off });
    check('LFO on Cutoff (0.4 Hz, 70 %): the footsteps get clearly brighter and darker over time (max/min ≥ 3×)', span(on) >= 3, { span: span(on), on });
    check('LFO off: the footsteps stay the same (max/min < 1.2×)', span(off) < 1.2, { span: span(off), off });

    // ---------- 2) the Sound settings preview of Steps runs on my free LFO clock ----------
    await A.evaluate(() => window.klibb.soundUi().open()); await A.waitForSelector('#sound-panel:not([hidden])'); await sleep(300);
    const pv = await A.evaluate(async (L) => {
      const ui = window.klibb.soundUi(), st = ui.state();
      st.tab = 'step'; st.patches.step = window.klibb.synthShared().cleanPatch({ ...st.patches.step, layers: [L] }); ui.render();
      const eng = window.klibb.soundObj().engine;
      const res = [];
      for (let i = 0; i < 3; i++) { eng.lastLfo = null; await ui.preview(); res.push(eng.lastLfo ? { id: eng.lastLfo.id, ph: eng.lastLfo.layers[0] } : null); await new Promise((r) => setTimeout(r, 700)); }
      return res;
    }, LAYER);
    check('Steps preview uses the free-running LFO with my walking clock (lfoId "me")', pv.every((x) => x && x.id === 'me'), pv);
    check('consecutive Steps previews land on different points of the LFO cycle (not phase 0 every time)', pv.every((x) => x && x.ph > 0) && new Set(pv.map((x) => x && x.ph.toFixed(3))).size === 3, pv);
    const slap = await A.evaluate(async () => { const ui = window.klibb.soundUi(); ui.state().tab = 'slap'; ui.render(); const eng = window.klibb.soundObj().engine; eng.lastLfo = 'x'; await ui.preview(); return eng.lastLfo; });
    check('Slap preview keeps its retrig LFO (as the slap plays in the game)', slap === 'x', slap);

    // ---------- 3) Theme B: the LFO panel says it is off while walking ----------
    const shown = async () => A.evaluate(() => { const ui = window.klibb.soundUi(); ui.state().tab = 'step'; ui.render(); return { lfo: !!document.querySelector('#snd-body .snd-lfo-under'), warn: document.querySelector('#snd-body .snd-lfo-theme-off')?.textContent || null }; });
    const a = await shown();
    check('Theme A: LFO panel shown, no "off" warning', a.lfo && !a.warn, a);
    await A.evaluate(() => window.klibb.soundTheme('B')); await sleep(800);
    const b = await shown();
    check('Theme B: the LFO panel warns that the Steps LFO is off while walking', b.lfo && /Theme B/.test(b.warn || ''), b);
    await A.evaluate(() => window.klibb.soundTheme('A')); await sleep(300);
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e && e.stack || e)); }
  finally { await browser.close(); S.child.kill(); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
