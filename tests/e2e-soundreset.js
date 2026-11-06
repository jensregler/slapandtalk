// E2E: Sound settings → ↺ Reset (Jens, 2 Nov 2026) puts EVERYTHING back to the defaults: every sound
// (Slap, Peel, Nope, Steps, Duff tabs, incl. own effects), all the Effects (reverb decay/pre-delay/wet,
// delay sync/ping-pong/time/feedback/wet, filter type/cutoff/resonance/wet, bitcrush bits/wet,
// distortion amount/wet) and Music vol. The sliders show it; Save keeps it on this device and the
// others hear my default sounds again; Cancel after Reset puts Music vol back. Own server (8906).
const { chromium } = require('playwright');
const path = require('path');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.SOUNDRESET_E2E_PORT || 8906);
const SHOTS = process.env.STICKERMENU_SHOTS || '/workspace/stickermenu-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 900) : '')); } };
const CUSTOM = {
  patches: Object.fromEntries(['slap', 'peel', 'nope', 'step', 'duff'].map((k, i) => [k, { gain: 0.3, layers: [{ kind: 'osc', wave: 'square', freq: 300 + i * 200, d: 0.5, level: 0.9 }], fx: { reverb: { decay: 6, preDelay: 0.2, wet: 0.7 } } }])),
  fx: { reverb: { decay: 7, preDelay: 0.3, wet: 0.8 }, delay: { time: 0.6, feedback: 0.7, wet: 0.5, sync: '1/8', pingPong: true }, filter: { type: 'highpass', cutoff: 900, q: 8, wet: 0.6 }, crush: { bits: 3, wet: 0.7 }, dist: { amount: 0.9, wet: 0.8 } },
};
(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) })).json();
    const R = made.room.id;
    const actx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    await actx.addInitScript(([c, R]) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('klibb.sound', JSON.stringify(c)); sessionStorage.setItem('klibb.musicVol', '0.35'); sessionStorage.setItem('seeded', '1'); } }, [CUSTOM, R]);
    const A = await actx.newPage(); A.on('pageerror', (e) => errors.push('A: ' + e.message));
    const B = await (await browser.newContext({ viewport: { width: 900, height: 700 } })).newPage(); B.on('pageerror', (e) => errors.push('B: ' + e.message));
    await A.goto(`${S.base}/?room=${R}`); await B.goto(`${S.base}/?room=${R}`);
    for (const p of [A, B]) await p.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.players().length === 1, null, { timeout: 60000 });
    await sleep(800);
    const before = await A.evaluate(() => window.klibb.voiceOf(null));
    const bSees0 = await B.evaluate(() => window.klibb.players()[0].look.sound);
    check('before: A has custom sounds + effects (personal: B gets only A\'s seed, never the settings – Jens, 2 Nov 2026)', !!before.patches && Object.keys(before.patches).length === 5 && before.fx && before.fx.crush.bits === 3 && bSees0 && !bSees0.patches && !bSees0.fx, { before: before && Object.keys(before), bSees0 });
    await A.evaluate(() => window.klibb.soundUi().open()); await sleep(300);
    check('…Music vol slider at 35', await A.inputValue('#music-vol') === '35');
    await A.click('#snd-tabs [data-tab="fx"]'); await sleep(200);
    const fxBefore = await A.evaluate(() => [...document.querySelectorAll('#snd-body input[type=range]')].map((r) => r.value).join());
    await A.click('#snd-reset'); await sleep(500);
    const r = await A.evaluate(() => {
      const k = window.klibb, sh = k.synthShared(), st = k.soundUi().state(), seed = localStorage.getItem('klibb.soundSeed');
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const tabs = Object.fromEntries(sh.SOUNDS.map((s) => [s, same(st.patches[s], sh.variant(sh.DEFAULT_PATCHES[s], seed, s)) && !st.patches[s].fx]));
      return { tabs, custom: [...st.custom], fx: same(sh.cleanFx(st.fx), sh.cleanFx(sh.FX_DEFAULTS)), vol: k.sound ? null : null, mv: document.getElementById('music-vol').value,
        fxUi: [...document.querySelectorAll('#snd-body input[type=range]')].map((x) => x.value).join(), sel: [...document.querySelectorAll('#snd-body select')].map((x) => x.value), pp: document.querySelector('#snd-body input[type=checkbox]').checked };
    });
    check('Reset: every tab (Slap, Peel, Nope, Steps, Duff) back to my default sound, no own effects, nothing custom', Object.values(r.tabs).every(Boolean) && r.custom.length === 0, r);
    check('…every Effects variable back to default (reverb, delay incl. sync + ping-pong, filter incl. type, bitcrush, distortion)', r.fx && JSON.stringify(r.sel) === '["free","lowpass"]' && r.pp === false, r);
    check('…the Effects sliders visibly moved (not the values from before)', r.fxUi !== fxBefore, { before: fxBefore, after: r.fxUi });
    check('…Music vol slider back to 100 and the sound follows (master volume 1)', r.mv === '100' && await A.evaluate(() => sessionStorage.getItem('klibb.musicVol')) === '1', r.mv);
    await A.click('#snd-tabs [data-tab="nope"]'); await sleep(150);
    const nopeUi = await A.evaluate(() => { const v = document.querySelector('#snd-body .snd-sl[data-param="level"] output').textContent; const seed = localStorage.getItem('klibb.soundSeed'); const sh = window.klibb.synthShared(); return { v, want: Math.round(sh.variant(sh.DEFAULT_PATCHES.nope, seed, 'nope').gain * 100) + '%' }; });
    check('…the Nope tab shows its default (Volume slider)', nopeUi.v === nopeUi.want, nopeUi);
    await A.screenshot({ path: path.join(SHOTS, '40-sound-reset.png') });
    // Cancel after Reset: nothing saved, Music vol back to 35
    await A.click('#snd-cancel'); await sleep(200);
    check('Cancel after Reset: nothing saved, Music vol back where it was', await A.evaluate((R) => !!sessionStorage.getItem('klibb.sound') && sessionStorage.getItem('klibb.musicVol') === '0.35' && document.getElementById('music-vol').value === '35', R));
    // Reset + Save
    await A.evaluate(() => window.klibb.soundUi().open()); await A.click('#snd-reset'); await sleep(200); await A.click('#snd-save'); await sleep(1200);
    const saved = await A.evaluate((R) => ({ ls: sessionStorage.getItem('klibb.sound'), vol: sessionStorage.getItem('klibb.musicVol'), mine: window.klibb.soundMine() }), R);
    const bSees = await B.evaluate(() => window.klibb.players()[0].look.sound);
    check('Save: the defaults are kept on this device (no custom sound stored, Music vol 1) and my own engine plays the defaults', saved.ls === null && saved.vol === '1' && saved.mine && !saved.mine.patches && !saved.mine.fx, saved);
    check('…and B still gets only A\'s seed (no patches, no effects – nothing is sent)', bSees && !bSees.patches && !bSees.fx && bSees.seed === before.seed, bSees);
    await A.reload(); await A.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 }); await sleep(500);
    const again = await A.evaluate(() => { window.klibb.soundUi().open(); return { custom: [...window.klibb.soundUi().state().custom], mv: document.getElementById('music-vol').value }; });
    check('…after a reload it is still the defaults', again.custom.length === 0 && again.mv === '100', again);
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await browser.close(); S.child.kill();
  console.log(`\nSound reset e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
