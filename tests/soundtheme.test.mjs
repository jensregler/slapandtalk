// Sound themes (Jens, 15 Nov 2026): Theme A = the sound exactly as before (every hook is the identity),
// Theme B = tight pitch and timing (shared/soundtheme.mjs). Run: node tests/soundtheme.test.mjs (in npm test)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { THEMES, THEME, THEME_IDS, cleanThemeId, themeWalkBpm, themeGaitStep, themeSlot, themeScale, themeWobble, themeFootTune, themeStepPatch, quantizeHz, PENTATONIC, THEME_RATES, themeRemoteTempo, themeGaitPct, themeAnyPatch, themeScalePatch } from '../shared/soundtheme.mjs';
import { TEMPO_BPMS, RATE_GRID } from '../shared/tempogrid.mjs';
import { snapWalkBpm, snapRate, gaitStep, RUN_DEFAULTS, RUN } from '../shared/runmode.mjs';
import { cleanPlayerTempo } from '../shared/playertempo.mjs';
import { SCALE_GRID } from '../shared/groove.mjs';
import { DEFAULT_PATCHES, cleanPatch, randomPatch } from '../shared/synth.mjs';

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const A = THEMES.A, B = THEMES.B, C = THEMES.C;

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
ok('Theme A: others\' tempo untouched; Theme B: others / NPCs on the same rules as me', () => {
  for (const b of TEMPO_BPMS) for (const r of [1 / 5, 2 / 3, 1, 11 / 8, 2, 5]) {
    const t = cleanPlayerTempo({ bpm: b, scale: 4 / 3, rate: r, tune: 1.5 });
    assert.equal(themeRemoteTempo(t, A), t);
    const q = themeRemoteTempo(t, B);
    assert.ok(B.tempi.includes(q.bpm)); assert.ok(B.tempi.includes(Math.round(q.bpm * q.rate * 1e9) / 1e9), `${b} ${r}`);
    assert.equal(q.tune, 1); assert.equal(q.scale, 1);
  }
  assert.equal(B.conformRemote, true); assert.ok(!A.conformRemote);
});
ok('one theme per room: server route, store field, room event; no personal localStorage choice', () => {
  const app = read('server/app.js'), store = read('server/store.js'), main = read('client/src/main.js'), ct = read('client/src/soundtheme.js');
  assert.match(app, /app\.put\('\/api\/rooms\/:room\/soundtheme'/); assert.match(app, /broadcast\(id, \{ type: 'room:soundtheme', theme: r/);
  assert.match(app, /soundThemeOf\(r\) !== 'A' \? \{ soundTheme: soundThemeOf\(r\) \} : \{\}/); // Theme A rooms: the room JSON as before
  assert.match(store, /async function setSoundTheme\(/); assert.match(store, /if \(theme === 'A'\) delete room\.soundTheme; else room\.soundTheme = theme;/);
  assert.match(main, /e\.type === 'room:soundtheme'\) setSoundTheme\(e\.theme/); assert.match(main, /setSoundTheme\(info\?\.soundTheme/);
  assert.match(main, /onTheme: \(id\) => requestSoundTheme\(id\)/);
  assert.doesNotMatch(ct, /localStorage\.setItem/);
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
// ---------- Theme C (Jens, 15 Nov 2026: one key, one clock for the whole city) ----------
const inKey = (hz) => { const m = 12 * Math.log2(hz / 440), r = Math.round(m); return Math.abs(m - r) < 0.01 && PENTATONIC.includes(((r % 12) + 12) % 12); };
ok('Theme C: listed third; Theme A and B hooks unchanged by it', () => {
  assert.deepEqual(THEME_IDS, ['A', 'B', 'C']);
  assert.equal(themeRemoteTempo({ bpm: 150, scale: 1, rate: 11 / 8, tune: 1 }, A).bpm, 150); assert.equal(themeRemoteTempo({ bpm: 150, scale: 1, rate: 11 / 8, tune: 1 }, B).bpm, 180);
  const w = randomPatch('slap', { wild: true }); assert.equal(themeAnyPatch(w, 'slap', A), w); assert.equal(themeAnyPatch(w, 'slap', B), w);
  assert.equal(themeGaitPct(100, A), 100); assert.equal(themeGaitPct(100, B), 100);
});
ok('Theme C tempo: 90 or 120 BPM (the nearer), mine and others\'', () => {
  assert.deepEqual([...C.tempi], [90, 120]);
  for (const b of TEMPO_BPMS) assert.ok([90, 120].includes(themeWalkBpm(b, C)));
  assert.equal(themeWalkBpm(60, C), 90); assert.equal(themeWalkBpm(100, C), 90); assert.equal(themeWalkBpm(108, C), 120); assert.equal(themeWalkBpm(2880, C), 120);
  for (const b of TEMPO_BPMS) assert.ok([90, 120].includes(themeRemoteTempo(cleanPlayerTempo({ bpm: b }), C).bpm));
});
ok('Theme C run / crouch: the existing % variation limited to ±25 / ±50 % (rates 2:3, 4:5, 1, 5:4, 3:2), exact on the notch grid', () => {
  const allowed = [2 / 3, 4 / 5, 1, 5 / 4, 3 / 2];
  for (const r of allowed) assert.ok(RATE_GRID.includes(r), String(r));
  for (let p = RUN.tempoMin; p <= RUN.tempoMax; p += RUN.tempoStep) for (const g of ['run', 'crouch']) {
    const st = themeGaitStep(gaitStep(g, { ...RUN_DEFAULTS, tempo: p, crouchTempo: p }), 90, C);
    assert.ok(allowed.includes(st.rate), `${g} ${p} → ${st.rate}`);
    assert.equal(cleanPlayerTempo({ bpm: 90, rate: +st.rate.toPrecision(6) }).rate, st.rate);
  }
  assert.equal(themeGaitStep(gaitStep('run', RUN_DEFAULTS), 90, C).rate, 3 / 2);    // +100 % → +50 %
  assert.equal(themeGaitStep(gaitStep('crouch', RUN_DEFAULTS), 90, C).rate, 2 / 3); // −50 % stays
  assert.equal(themeGaitStep(gaitStep('run', { ...RUN_DEFAULTS, tempo: 25 }), 90, C).rate, 5 / 4);
  assert.equal(themeGaitStep(gaitStep('run', { ...RUN_DEFAULTS, tempo: 12.5 }), 90, C).rate, 1); // nearer 0 than +25
  assert.equal(themeGaitStep(gaitStep('run', RUN_DEFAULTS), 90, C).tune, gaitStep('run', RUN_DEFAULTS).tune); // pitch correction kept (lands in key later)
  for (const r of [1 / 5, 8 / 11, 11 / 8, 2, 5]) assert.ok(allowed.includes(themeRemoteTempo({ bpm: 90, scale: 1, rate: r, tune: 1 }, C).rate), String(r));
});
ok('Theme C rhythm: 4/4 + 3/4 slots, Groove on octaves – mine and others\'', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((s) => themeSlot(s, C)), [0, 1, 0, 1, 0]);
  assert.equal(themeRemoteTempo({ bpm: 90, scale: 4 / 3, rate: 1, tune: 1 }, C).scale, 1);
});
ok('Theme C pitch: every sound in key (A minor pentatonic), no detune / vibrato; no wobble, no left/right foot, no NPC Wild', () => {
  assert.equal(themeWobble(C, 1.05), 1); assert.equal(themeFootTune(C, 0.97), 1); assert.equal(C.npcWild, false);
  for (let i = 0; i < 40; i++) for (const kind of ['step', 'slap', 'peel', 'duff']) {
    const p = randomPatch(kind + i, { wild: true }), q = themeAnyPatch(p, kind, C);
    for (const l of q.layers) { assert.ok(inKey(l.freq), `${kind} ${l.freq}`); assert.equal(l.detune, 0); assert.notEqual(l.lfo, 'pitch'); }
    assert.equal(q.layers.length, p.layers.length);
    for (let k = 0; k < p.layers.length; k++) assert.equal(q.layers[k].pitchAmt, p.layers[k].pitchAmt); // sweeps stay
    assert.deepEqual(themeAnyPatch(q, kind, C), q); // idempotent
  }
  const withMods = cleanPatch({ ...cleanPatch(DEFAULT_PATCHES.step), mods: [{ id: 'm1', to: 'L1.freq', wave: 'sine', rate: 5, depth: 0.3 }, { id: 'm2', to: 'L0.cutoff', wave: 'sine', rate: 2, depth: 0.5 }] });
  assert.equal(withMods.mods.length, 2); { const q = themeScalePatch(withMods); assert.equal(q.mods.find((m) => m.id === 'm1').depth, 0); assert.equal(q.mods.find((m) => m.id === 'm2').depth, 0.5); }
});
ok('Theme C wiring: others conformed in the groove, every kind + loops in key in sound.js', () => {
  assert.match(read('client/src/groove.js'), /this\.theme\.conformRemote \? themeRemoteTempo\(cleanPlayerTempo\(w\.tempo\), this\.theme\)/);
  assert.match(read('client/src/sound.js'), /themeAnyPatch\(retune\(patch, rate\), kind, this\.theme\)/);
  assert.match(read('client/src/sound.js'), /this\.theme\.allKinds \? themeScalePatch\(patch\) : patch/);
  assert.match(read('client/index.html'), /data-theme="C"/);
});
// The effective Theme C values (printed for the report)
{
  const run = themeGaitStep(gaitStep('run', RUN_DEFAULTS), 90, C), cr = themeGaitStep(gaitStep('crouch', RUN_DEFAULTS), 90, C);
  const st = themeAnyPatch(cleanPatch(DEFAULT_PATCHES.step), 'step', C), sl = themeAnyPatch(cleanPatch(DEFAULT_PATCHES.slap), 'slap', C);
  console.log('  Theme C effective: walk', themeWalkBpm(90, C), '/', themeWalkBpm(150, C), 'BPM; run', run, 'crouch', cr,
    '; step Hz', cleanPatch(DEFAULT_PATCHES.step).layers.map((l) => l.freq), '→', st.layers.map((l) => l.freq), '; slap Hz', cleanPatch(DEFAULT_PATCHES.slap).layers.map((l) => l.freq), '→', sl.layers.map((l) => l.freq));
}
console.log(`soundtheme: ${n} checks passed`);
