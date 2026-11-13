// E2E: synth sounds + effects and the full version.
// A has the full version (dev unlock; the test server runs with DEV_UNLOCK=1), B is free.
//  - free: no Sound settings anywhere, but B has its own variation of the default sounds and
//    HEARS A's custom sounds (A's look carries the patches; nothing else goes over the network)
//  - A: Sound settings → synth panel per sound + effects, preview, randomize, reset, save
//  - footsteps while walking; a "duff"/Landing when a peel lands (louder for bigger paper)
//  - Tone.Offline render: every default patch (and players' variations, room acoustics, FX) is
//    audible and doesn't clip.
const path = require('path');
const fs = require('fs');
const os = require('os');

async function synthE2E({ browser, BASE, assert, waitReady, testPng }) {
  const OUT = process.env.FABRIC_SHOTS || path.join(os.tmpdir(), 'klibbrum-shots');
  fs.mkdirSync(OUT, { recursive: true });
  const { room: { id: R }, roomKey: KEY } = await (await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  const actx = await browser.newContext({ viewport: { width: 1280, height: 860 } }), bctx = await browser.newContext({ viewport: { width: 1000, height: 640 } });
  await actx.addInitScript(() => localStorage.setItem('klibb.devUnlock', '1'));
  // B is free, but has forged custom patches in its storage: they must never be used or sent
  await bctx.addInitScript(() => localStorage.setItem('klibb.sound', JSON.stringify({ patches: { slap: { layers: [{ kind: 'osc', wave: 'square', freq: 2000, d: 1, level: 1 }] } } })));
  const A = await actx.newPage(), B = await bctx.newPage();
  for (const [n, pg] of [['A', A], ['B', B]]) pg.on('pageerror', (e) => console.log(`sidfel (synth ${n}):`, e.message));
  try {
    await A.goto(`${BASE}/?room=${R}`); await waitReady(A);
    await B.goto(`${BASE}/?room=${R}`); await waitReady(B);
    await A.evaluate(() => window.klibb.entitlementsReady()); await B.evaluate(() => window.klibb.entitlementsReady());
    await A.waitForFunction(() => window.klibb.players().length === 1, null, { timeout: 15000 });
    await B.waitForFunction(() => window.klibb.players().length === 1, null, { timeout: 15000 });
    // Audio needs a click
    await A.mouse.click(640, 430); await B.mouse.click(500, 320);
    await A.evaluate(() => window.klibb.controls.unlock()); await B.evaluate(() => window.klibb.controls.unlock());

    // ---------- Free player: calm UI, own default variation ----------
    await B.evaluate(() => window.klibb.openMore());
    const freeUi = await B.evaluate(() => ({ btn: !!document.getElementById('sound-design-btn').offsetParent, text: document.getElementById('more-panel').innerText }));
    assert(!freeUi.btn && !/sound settings|synth|premium|upgrade|locked|🔒/i.test(freeUi.text), 'free: ⚙ More has just "Sounds" on/off – no Sound settings, nothing locked or for sale');
    await B.evaluate(() => window.klibb.closeMore());
    const bMine = await B.evaluate(() => window.klibb.soundMine());
    const aSeesB = await A.evaluate(() => window.klibb.players()[0].look.sound);
    assert(bMine.seed && !bMine.patches && aSeesB && aSeesB.seed === bMine.seed && !aSeesB.patches,
      `free: B plays its own variation of the defaults (seed ${bMine.seed}); forged patches in storage are neither used nor sent`);

    // ---------- Full version: the synth panel ----------
    await A.evaluate(() => window.klibb.openMore());
    assert(await A.isVisible('#sound-design-btn'), 'full version: ⚙ More → Sound settings… is there');
    await A.click('#sound-design-btn');
    await A.waitForSelector('#sound-panel', { state: 'visible' });
    const tabs = await A.$$eval('#snd-tabs button', (b) => b.map((x) => x.textContent));
    const openTab = await A.evaluate(() => document.querySelector('#snd-tabs button.sel')?.dataset.tab);
    assert(tabs.join() === 'Steps,Slap,Peel,Landing' && openTab === 'step',
      `synth panel tabs (${tabs.join(', ')}): Steps, Slap, Peel, Landing, and it opens on Steps`);
    await A.click('#snd-tabs button[data-tab="slap"]');
    const panel = await A.evaluate(() => ({ layers: document.querySelectorAll('#snd-body .snd-layer').length, sliders: [...document.querySelectorAll('#snd-body .snd-sl')].map((r) => r.dataset.param),
      selects: [...document.querySelectorAll('#snd-body select')].map((s) => s.dataset.name) }));
    assert(panel.layers === 3 && ['cutoff', 'q', 'a', 'd', 's', 'r', 'freq', 'pitchAmt', 'level', 'drive'].every((k) => panel.sliders.includes(k))
      && ['Source', 'Wave', 'Filter'].every((k) => panel.selects.includes(k)),
      `slap has its 3 layers with source/wave/filter and ${panel.sliders.length} sliders`);
    // Tweak: slap layer 1 cutoff + layer-2 pitch LFO via the LFO? ask button (t600u)
    await A.$eval('#snd-body .snd-layer[data-layer="0"] .snd-sl[data-param="cutoff"] input', (r) => { r.value = '700'; r.dispatchEvent(new Event('input', { bubbles: true })); });
    await A.$eval('#snd-body .snd-layer[data-layer="1"] .snd-sl[data-param="freq"] input', (r) => {
      r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      r.value = String(Number(r.value) + 40);
      r.dispatchEvent(new Event('input', { bubbles: true }));
      r.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await A.waitForSelector('#lfo-ask');
    await A.click('#lfo-ask');
    await A.waitForSelector('#snd-body .snd-layer[data-layer="1"] .snd-lfo-under');
    await A.$eval('#snd-body .snd-layer[data-layer="1"] .snd-sl[data-param="lfoDepth"] input', (r) => { r.value = '400'; r.dispatchEvent(new Event('input', { bubbles: true })); });
    const pv = await A.evaluate(() => window.klibb.soundUi().preview());
    assert(pv === true, '▶ Preview plays the edited patch');
    await A.waitForTimeout(300);
    await A.screenshot({ path: path.join(OUT, 'synth-panel.png') });
    // Effects tab is hidden (city drives fx). Set fx on state, then randomize/reset on Steps.
    await A.evaluate(() => {
      const st = window.klibb.soundUi().state(), sh = window.klibb.synthShared();
      st.fx = sh.cleanFx({ reverb: { wet: 0.25 }, delay: { wet: 0.2, sync: '1/8' } });
    });
    await A.click('#snd-tabs button[data-tab="step"]');
    const step0 = await A.evaluate(() => JSON.stringify(window.klibb.soundUi().state().patches.step));
    await A.click('#snd-random');
    const step1 = await A.evaluate(() => JSON.stringify(window.klibb.soundUi().state().patches.step));
    await A.click('#snd-reset');
    const step2 = await A.evaluate(() => JSON.stringify(window.klibb.soundUi().state().patches.step));
    assert(step1 !== step0 && step2 === step0, '🎲 Randomize rolls a new patch, ↺ Reset brings back my default');
    // After reset: restore slap LFO + fx (Effects tab hidden), wild on Peel, then Save
    await A.click('#snd-tabs button[data-tab="slap"]');
    await A.$eval('#snd-body .snd-layer[data-layer="1"] .snd-sl[data-param="freq"] input', (r) => {
      r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      r.value = String(Number(r.value) + 40);
      r.dispatchEvent(new Event('input', { bubbles: true }));
      r.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await A.waitForSelector('#lfo-ask');
    await A.click('#lfo-ask');
    await A.waitForSelector('#snd-body .snd-layer[data-layer="1"] .snd-lfo-under');
    await A.evaluate(() => {
      const st = window.klibb.soundUi().state(), sh = window.klibb.synthShared();
      st.fx = sh.cleanFx({ reverb: { wet: 0.25 }, delay: { wet: 0.2, sync: '1/8' } });
    });
    await A.click('#snd-tabs button[data-tab="peel"]'); await A.click('#snd-wild');
    await A.click('#snd-save');
    await A.waitForSelector('#sound-panel', { state: 'hidden' });
    const saved = await A.evaluate(() => JSON.parse(sessionStorage.getItem('klibb.sound') || localStorage.getItem('klibb.sound') || 'null'));
    assert(saved && saved.patches.slap && saved.patches.peel && !saved.patches.nope && saved.fx.delay.sync === '1/8' && saved.patches.slap.layers[1].lfo === 'pitch',
      'Save: only the changed sounds (slap, peel) + effects are stored in this browser');
    await B.waitForFunction(() => { const s = window.klibb.players()[0].look.sound; return s && s.patches && s.patches.slap && s.fx; }, null, { timeout: 5000 });
    const bSeesA = await B.evaluate(() => window.klibb.players()[0].look.sound);
    assert(JSON.stringify(bSeesA.patches.slap) === JSON.stringify(saved.patches.slap) && bSeesA.fx.delay.sync === '1/8', "B (free) gets A's patches with A's look");
    // A slaps: B plays A's custom slap (same patch, from where it hit)
    await A.setInputFiles('#file', testPng);
    await A.waitForFunction(() => window.klibb.state.selected && !window.klibb.state.selected.library);
    await A.evaluate(() => { const k = window.klibb; k.moveTo(0, 0); k.look(0, 0); });
    const n0 = await B.evaluate(() => window.klibb.soundLog().length);
    await A.evaluate(() => window.klibb.stampAt(0, 0));
    await B.waitForFunction((n) => window.klibb.soundLog().length > n, n0, { timeout: 5000 });
    const heard = await B.evaluate(() => window.klibb.soundLog().at(-1));
    const aMine = await A.evaluate(() => window.klibb.soundMine());
    assert(heard.kind === 'slap' && heard.remote && heard.custom && heard.seed === aMine.seed, `B hears A's own slap patch (custom, seed ${heard.seed}) – free players hear custom sounds too`);

    // ---------- Footsteps ----------
    const s0 = [await A.evaluate(() => window.klibb.soundSteps()), await B.evaluate(() => window.klibb.soundSteps())];
    for (let i = 1; i <= 24; i++) { await A.evaluate((i) => window.klibb.moveTo(0, i * 0.12), i); await A.waitForTimeout(60); }
    await B.waitForTimeout(800);
    const s1 = [await A.evaluate(() => window.klibb.soundSteps()), await B.evaluate(() => window.klibb.soundSteps())];
    const jumps0 = s1[0];
    await A.evaluate(() => window.klibb.moveTo(3, -3)); await A.waitForTimeout(200);
    const s2 = await A.evaluate(() => window.klibb.soundSteps());
    assert(s1[0] - s0[0] >= 2 && s1[0] - s0[0] <= 6 && s1[1] > s0[1] && s2 === jumps0,
      `footsteps: walking ~2.9 m gives ${s1[0] - s0[0]} quiet steps for A (on the shared groove, shared/groove.mjs), B hears A's steps (${s1[1] - s0[1]}), a teleport makes no sound`);

    // ---------- Peel landing plays duff (Landing tab in Sound settings) ----------
    const put = await fetch(`${BASE}/api/rooms/${R}/peels`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-room-key': KEY }, body: JSON.stringify({ on: true }) });
    await A.waitForFunction(() => window.klibb.peels().on, null, { timeout: 5000 });
    await A.evaluate(() => { const k = window.klibb; k.state.size = 0.3; k.moveTo(0, -3.0); k.look(0, 0.1); });
    const nLand = await A.evaluate(() => window.klibb.soundLog().length);
    await A.evaluate(async () => { await window.klibb.stampAt(0, 0); });
    await A.waitForFunction((n) => window.klibb.peels().landed >= 1, nLand, { timeout: 10000 }).catch(() => {});
    await A.waitForFunction((n) => window.klibb.soundLog().slice(n).some((e) => e.kind === 'duff'), nLand, { timeout: 10000 });
    const landCheck = await A.evaluate((n) => ({ peels: window.klibb.peels(), duffs: window.klibb.soundLog().slice(n).filter((e) => e.kind === 'duff') }), nLand);
    assert(put.status === 200 && landCheck.peels.landed >= 1 && landCheck.duffs.length >= 1,
      `peel landing duff: ${landCheck.peels.landed} landed, ${landCheck.duffs.length} duff sounds (expected ≥1)`);

    // ---------- Offline render: audible and never clipping ----------
    const seeds = ['jens', 'sylvester', 'ulla', 'guest-42', 'x7Kq2pLm'];
    const off = await A.evaluate(async (seeds) => {
      const k = window.klibb, S = k.synthShared();
      const list = {};
      for (const name of S.SOUNDS) list[name] = S.DEFAULT_PATCHES[name];
      for (const seed of seeds) for (const name of S.SOUNDS) list[`${name}@${seed}`] = S.variant(S.DEFAULT_PATCHES[name], seed, name);
      list['duff, biggest paper'] = { patch: S.retune(S.DEFAULT_PATCHES.duff, S.duffScale(1.44).rate), gain: S.duffScale(1.44).gain };
      list['slap in a tiled room'] = { patch: S.DEFAULT_PATCHES.slap, room: { wall: 'kakel', floor: 'betong', ceiling: 'betong' } };
      list['slap with reverb + delay'] = { patch: S.DEFAULT_PATCHES.slap, fx: { reverb: { wet: 0.3, decay: 2 }, delay: { wet: 0.3, feedback: 0.5, sync: '1/8' } } };
      return k.synthCheck(list);
    }, seeds);
    const bad = Object.entries(off).filter(([, r]) => !r.ok);
    const peaks = Object.values(off).map((r) => r.peak);
    assert(Object.keys(off).length === 4 + 20 + 3 && bad.length === 0,
      `Tone.Offline: all ${Object.keys(off).length} renders (4 defaults, 20 player variations, big duff, tiled room, FX) are audible and don't clip (peak ${Math.min(...peaks).toFixed(2)}–${Math.max(...peaks).toFixed(2)})${bad.length ? ' FAILED: ' + JSON.stringify(bad) : ''}`);
  } finally {
    await actx.close(); await bctx.close();
  }
}
module.exports = { synthE2E };

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  const { chromium } = require('playwright');
  const sharp = require('sharp');
  const BASE = process.env.BASE_URL || 'http://localhost:8787';
  const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
  const waitReady = (page) => page.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 20000 });
  (async () => {
    const testPng = path.join(os.tmpdir(), 'e2e-synth-klibba.png');
    await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><circle cx="200" cy="200" r="180" fill="#e0245e"/></svg>')).png().toFile(testPng);
    const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    try { await synthE2E({ browser, BASE, assert, waitReady, testPng }); } finally { await browser.close(); }
  })().catch((e) => { console.error(e); process.exit(1); });
}
