// Sound themes (Jens, 15 Nov 2026): Theme A = the sound exactly as before (every hook is the identity),
// Theme B = tight pitch and timing (shared/soundtheme.mjs). Run: node tests/soundtheme.test.mjs (in npm test)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { THEMES, THEME, THEME_IDS, cleanThemeId, themeWalkBpm, themeGaitStep, themeSlot, themeScale, themeWobble, themeFootTune, themeStepPatch, quantizeHz, PENTATONIC, THEME_RATES } from '../shared/soundtheme.mjs';
import { TEMPO_BPMS, RATE_GRID } from '../shared/tempogrid.mjs';
import { snapWalkBpm, snapRate, gaitStep, RUN_DEFAULTS, RUN } from '../shared/runmode.mjs';
import { cleanPlayerTempo } from '../shared/playertempo.mjs';
import { SCALE_GRID } from '../shared/groove.mjs';
import { DEFAULT_PATCHES, cleanPatch, randomPatch } from '../shared/synth.mjs';

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const A = THEMES.A, B = THEMES.B;

ok('themes: A (default) and B; junk → A', () => {
  assert.deepEqual(THEME_IDS.slice(0, 2), ['A', 'B']); assert.equal(THEME.def, 'A');
  assert.equal(cleanThemeId('B'), 'B'); assert.equal(cleanThemeId('zz'), 'A'); assert.equal(cleanThemeId(null), 'A');
});
ok('Theme A: every hook is the identity', () => {
  for (const b of [30, 45, 90, 100, 150, 475, 2880, 3000]) assert.equal(themeWalkBpm(b, A), snapWalkBpm(b));
  const st = gaitStep('run', RUN_DEFAULTS); assert.equal(themeGaitStep(st, 90, A), st); assert.equal(themeGaitStep(null, 90, A), null);
  for (let s = 0; s < 5; s++) assert.equal(themeSlot(s, A), s);
  for (const s of SCALE_GRID) assert.equal(themeScale(s, A), s);
  assert.equal(themeWobble(A, 1.03), 1.03); assert.equal(themeFootTune(A, 0.97), 0.97);
  const p = cleanPatch(DEFAULT_PATCHES.step); assert.equal(themeStepPatch(p, A), p);
  const w = randomPatch('x', { wild: true }); assert.equal(themeStepPatch(w, A), w);
  for (const k of ['gaitTune', 'wobble', 'footTune', 'sightPitch', 'danceLines', 'npcWild', 'wildButton']) assert.equal(A[k], true, k);
});
ok('snapRate: every notch rate still snaps to itself (also rounded to 6 digits) – Theme A unchanged', () => {
  for (const r of RATE_GRID) { assert.equal(snapRate(r), r); assert.equal(snapRate(+r.toPrecision(6)), r); }
});
ok('Theme B tempo: 60 · 90 · 120 · 180 BPM only, all on the 120-BPM grid', () => {
  assert.deepEqual([...B.tempi], [60, 90, 120, 180]);
  for (const t of B.tempi) assert.ok(TEMPO_BPMS.includes(t));
  for (const b of TEMPO_BPMS) assert.ok(B.tempi.includes(themeWalkBpm(b, B)), String(b));
  assert.equal(themeWalkBpm(90, B), 90); assert.equal(themeWalkBpm(30, B), 60); assert.equal(themeWalkBpm(2880, B), 180); assert.equal(themeWalkBpm(100, B), 90); assert.equal(themeWalkBpm(150, B), 180);
});
ok('Theme B gait: run / crouch land on an allowed tempo, exact ratio, no pitch correction; survives the network', () => {
  for (const w of B.tempi) for (let p = RUN.tempoMin; p <= RUN.tempoMax; p += RUN.tempoStep) {
    for (const g of ['run', 'crouch']) {
      const r = { ...RUN_DEFAULTS, walkBpm: w, tempo: p, crouchTempo: p };
      const st = themeGaitStep(gaitStep(g, r), w, B);
      assert.equal(st.tune, 1);
      assert.ok(B.tempi.includes(Math.round(w * st.rate * 1e9) / 1e9), `${w} ${p} ${g} ${st.rate}`);
      assert.ok(THEME_RATES.includes(st.rate));
      assert.equal(cleanPlayerTempo({ bpm: w, scale: 1, rate: +st.rate.toPrecision(6), tune: 1 }).rate, st.rate); // exact after rounding
    }
  }
  assert.deepEqual(themeGaitStep(gaitStep('run', RUN_DEFAULTS), 90, B), { rate: 2, tune: 1 });        // +100 % from 90 → 180
  assert.deepEqual(themeGaitStep(gaitStep('crouch', RUN_DEFAULTS), 90, B), { rate: 2 / 3, tune: 1 }); // −50 % from 90 → 60
  assert.deepEqual(themeGaitStep(gaitStep('crouch', RUN_DEFAULTS), 120, B), { rate: 3 / 4, tune: 1 }); // 120 × 2/3 = 80 → 90
});
ok('Theme B rhythm: 4- or 3-pulse slots only; Groove on octaves', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 7].map((s) => themeSlot(s, B)), [0, 1, 0, 1, 0, 0, 0]);
  for (const s of SCALE_GRID) { const v = themeScale(s, B); assert.ok(Number.isInteger(Math.log2(v)), `${s} → ${v}`); }
  assert.equal(themeScale(1, B), 1); assert.equal(themeScale(4 / 3, B), 1); assert.equal(themeScale(3 / 2, B), 2);
});
ok('Theme B pitch: no wobble, no left/right foot, A minor pentatonic, no sweep / detune / LFOs / mods', () => {
  assert.equal(themeWobble(B, 1.05), 1); assert.equal(themeFootTune(B, 0.97), 1);
  assert.deepEqual([...PENTATONIC], [0, 3, 5, 7, 10]);
  assert.equal(quantizeHz(440), 440); assert.equal(quantizeHz(220), 220); assert.equal(quantizeHz(466), 440); assert.equal(quantizeHz(500), 523.25);
  for (let i = 0; i < 40; i++) {
    const p = randomPatch('t' + i, { wild: true }), q = themeStepPatch(p, B);
    assert.equal(q.mods, undefined);
    for (const l of q.layers) {
      assert.equal(l.pitchAmt, 0); assert.equal(l.detune, 0); assert.equal(l.lfo, 'none');
      const m = Math.round(12 * Math.log2(l.freq / 440)); assert.ok(Math.abs(12 * Math.log2(l.freq / 440) - m) < 0.01);
      assert.ok(PENTATONIC.includes(((m % 12) + 12) % 12), `${l.freq}`);
    }
    assert.deepEqual(themeStepPatch(q, B), q); // idempotent: the same step always the same frequency
  }
});
ok('Theme B: dance lines, Sightline pitch, NPC Wild and the Wild button are off', () => {
  for (const k of ['gaitTune', 'wobble', 'footTune', 'sightPitch', 'danceLines', 'npcWild', 'wildButton']) assert.equal(B[k], false, k);
});
ok('wiring: the engine reads the theme (sound, groove, radio, npcs, main, escmenu, soundui)', () => {
  assert.match(read('client/src/sound.js'), /themeWobble\(this\.theme/); assert.match(read('client/src/sound.js'), /themeStepPatch\(retune\(patch, rate\), this\.theme\)/);
  assert.match(read('client/src/sound.js'), /this\.stepMod && this\.theme\.danceLines/);
  assert.match(read('client/src/groove.js'), /themeSlot\(/); assert.match(read('client/src/groove.js'), /themeFootTune\(this\.theme/);
  assert.match(read('client/src/radio.js'), /themeWalkBpm\(this\.walkBpmSet, this\.theme\)/);
  assert.match(read('client/src/npcs.js'), /this\.theme\.npcWild/);
  assert.match(read('client/src/main.js'), /themeGaitStep\(gaitStep\(myGait, liveRunMode\(\)\), radio\.walkBpm, theme\)/);
  assert.match(read('client/src/main.js'), /danceLinesStep\(dancingMe && theme\.danceLines\)/);
  const html = read('client/index.html'); assert.match(html, /data-esc="theme"/); assert.match(html, /data-theme="A"/); assert.match(html, /data-theme="B"/);
});
console.log(`soundtheme: ${n} checks passed`);
