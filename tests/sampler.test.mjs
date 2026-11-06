// Sampler layer, morph, LFOs (topological per-sample program, cycles, limits), sequencer layers,
// master clock + room offsets, radio presets, decimation, bird – the shared maths (Jens, 5 Nov 2026).
import assert from 'assert/strict';
import { SYNTH, DEFAULT_PATCHES, SOUNDS, cleanPatch, cleanLayer, samplerRate, samplerGate, patchLength, morphPatch, diffPatch, snapFreq, noteName, retune, variant } from '../shared/synth.mjs';
import { newFollower, selfLoop, MOD as MOD2 } from '../shared/lfo.mjs';
import { MOD, cleanMods, modOrder, canAddMod, newMod, removeMod, removeLayerMods, evalMods, compileMods, modRunner, snapRate, parseTarget } from '../shared/lfo.mjs';
import { MASTER, roomTempo, loopSteps, barMsAt, barsAtTime } from '../shared/clock.mjs';
import { cleanRadio, cleanPreset, cleanBpm, knobToBpm, bpmToKnob, FOUR_VOICES, voiceEvents, VOICE_CYCLE_MS, birdPhrase, RADIO } from '../shared/radio.mjs';
import { decimate } from '../client/src/decimator.js';
import { knobToMorph, RADIO_DEFAULTS } from '../shared/radio.mjs';
import { CITY_FX, PLACE, PLACE_NEUTRAL, cityFxAt, zoneWeight, cleanCityFx } from '../shared/cityfx.mjs';
import fs from 'fs';

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

ok('old patches are unchanged: the five defaults clean to exactly the same JSON; osc/noise layers get no new keys', () => {
  for (const k of SOUNDS) assert.ok(same(cleanPatch(DEFAULT_PATCHES[k]), DEFAULT_PATCHES[k]), k);
  const old = { v: 1, gain: 0.8, layers: [{ kind: 'osc', wave: 'square', freq: 300, d: 0.2, level: 0.4 }, { kind: 'noise', cutoff: 900 }] };
  const c = cleanPatch(old);
  for (const l of c.layers) for (const k of ['sample', 'note', 'root', 'seq', 'decim', 'crush', 'pan', 'loop']) assert.ok(!(k in l), k);
  assert.ok(!('mods' in c) && !('morph' in c));
  assert.ok(same(cleanPatch(c), c), 'idempotent');
});
ok('sampler layer: own keys, clamped; root C4 by default; junk sample ids dropped', () => {
  const l = cleanLayer({ kind: 'sampler', sample: 'f'.repeat(64), name: 'kick<script>', len: 99, note: 200, start: 0.9, end: 0.1, loop: 'yes', poly: 99, pan: -5, decim: 0, crush: 40 });
  assert.equal(l.kind, 'sampler'); assert.equal(l.root, 60); assert.equal(l.note, 108); assert.equal(l.len, 10);
  assert.equal(l.name, 'kickscript'); assert.equal(l.start, 0); assert.equal(l.end, 1); assert.equal(l.loop, false); assert.equal(l.poly, 8); assert.equal(l.pan, -1);
  assert.ok(!('decim' in l)); assert.equal(l.crush, 16); assert.equal(l.freq, 440); assert.equal(l.whole, true);
  assert.equal(cleanLayer({ kind: 'sampler', sample: 'nothex' }).sample, '');
});
ok('pitch ratio: 2^((note − root)/12) × freq/440 (retune wobble/duff carried in freq)', () => {
  const l = cleanLayer({ kind: 'sampler', note: 72, root: 60 }); assert.ok(near(samplerRate(l), 2));
  assert.ok(near(samplerRate(cleanLayer({ kind: 'sampler', note: 67, root: 60 })), Math.pow(2, 7 / 12)));
  assert.ok(near(samplerRate(cleanLayer({ kind: 'sampler', note: 48, root: 60 })), 0.5));
  assert.ok(near(samplerRate(cleanLayer({ kind: 'sampler', note: 57, root: 69 })), 0.5), 'any root');
  const re = retune(cleanPatch({ layers: [{ kind: 'sampler', note: 60 }] }), 1.5).layers[0]; assert.ok(near(samplerRate(re), 1.5));
  // one-shot gate = the played part / ratio; octave up = half as long
  const g = cleanLayer({ kind: 'sampler', len: 2, note: 72, start: 0.25, end: 0.75 }); assert.ok(near(samplerGate(g), 0.5));
  assert.equal(samplerGate(cleanLayer({ kind: 'sampler', len: 2, loop: true })), null, 'looping: the envelope decides');
  assert.ok(near(patchLength(cleanPatch({ layers: [{ kind: 'sampler', len: 1, a: 0.01, r: 0.1, whole: true }] })), 0.01 + 1 + 0.1));
});
ok('serialization: a sampler + LFO + sequencer patch survives JSON round trips and fits the size cap', () => {
  const p = cleanPatch({ layers: [{ kind: 'sampler', sample: 'a'.repeat(64), name: 'x', len: 1.2, note: 64, loop: true, xfade: 0.05, decim: 4, seq: { len: 5, steps: [{ on: true }, { on: false, vol: 30 }] } }, { kind: 'osc' }],
    mods: [{ id: 'm1', to: 'L0.cutoff', rate: 2, depth: 0.5 }, { id: 'm2', to: 'm1.rate', rate: 0.3 }] });
  const back = cleanPatch(JSON.parse(JSON.stringify(p)));
  assert.ok(same(back, p)); assert.equal(back.layers[0].seq.steps.length, 5); assert.equal(back.layers[0].seq.steps[1].vol, 30);
  assert.ok(JSON.stringify(p).length < SYNTH.maxPatchBytes);
});
ok('morph: t = 0 is the original, t = 1 mine; numbers glide (log for freq), choices flip at the middle, one-sided layers fade', () => {
  const a = cleanPatch({ gain: 0.5, layers: [{ kind: 'osc', wave: 'sine', freq: 220, cutoff: 1000, level: 0.4 }] });
  const b = cleanPatch({ gain: 1, layers: [{ kind: 'osc', wave: 'square', freq: 880, cutoff: 4000, level: 0.8 }, { kind: 'noise', level: 0.6 }] });
  assert.ok(same(morphPatch(a, b, 0), a)); assert.ok(same(morphPatch(a, b, 1), b));
  const h = morphPatch(a, b, 0.5);
  assert.equal(h.gain, 0.75); assert.equal(h.layers[0].freq, 440, 'log + on the grid'); assert.equal(h.layers[0].cutoff, 2000);
  assert.equal(h.layers[0].wave, 'square'); assert.equal(morphPatch(a, b, 0.49).layers[0].wave, 'sine');
  assert.ok(near(h.layers[1].level, 0.3, 1e-6), 'a layer only I have fades in');
  assert.ok(near(morphPatch(a, b, 0.3).layers[0].freq, snapFreq(220 * Math.pow(4, 0.3))), 'pitch lands on the semitone grid');
  // layer type flips at the middle, sampler keys follow
  const c = cleanPatch({ layers: [{ kind: 'sampler', sample: 'b'.repeat(64), len: 1 }] });
  assert.equal(morphPatch(a, c, 0.4).layers[0].kind, 'osc'); assert.ok(!('sample' in morphPatch(a, c, 0.4).layers[0]));
  assert.equal(morphPatch(a, c, 0.6).layers[0].kind, 'sampler'); assert.equal(morphPatch(a, c, 0.6).layers[0].sample, 'b'.repeat(64));
  // LFOs only on my side fade in by depth
  const d = cleanPatch({ ...a, mods: [{ id: 'm1', to: 'L0.cutoff', depth: 0.8 }] });
  assert.ok(near(morphPatch(a, d, 0.25).mods[0].depth, 0.2, 1e-6));
  assert.deepEqual(diffPatch(a, b).slice(0, 3), ['gain', 'L0.wave', 'L0.freq']);
  assert.ok(diffPatch(a, b).includes('L1 (added)'));
});
ok('pitch grid: semitones, A4 = 440 (snapFreq, note names)', () => {
  assert.equal(snapFreq(445), 440); assert.equal(snapFreq(262), 261.63); assert.equal(noteName(60), 'C4'); assert.equal(noteName(69), 'A4');
  assert.equal(snapRate(5), 5, 'slow LFO rates stay free'); assert.equal(snapRate(445), 440, 'audio-rate LFOs snap'); assert.equal(snapRate(3000), 2959.9554);
});
ok('LFO limits: max 16, depth ≤ 6, rate 0.01 Hz – 5 kHz, junk dropped, unmodulatable targets refused', () => {
  const layers = cleanPatch({ layers: [{ kind: 'osc' }, { kind: 'noise' }] }).layers;
  const many = Array.from({ length: 30 }, (_, i) => ({ id: 'm' + (i + 1), to: i % 2 ? 'L0.cutoff' : 'L1.level', rate: 1e6 }));
  const c = cleanMods(many, layers); assert.equal(c.length, MOD.max); assert.ok(c.every((m) => m.rate === snapRate(5000)));
  assert.equal(cleanMods([{ id: 'm1', to: 'L1.freq' }], layers).length, 0, 'noise has no pitch');
  assert.equal(cleanMods([{ id: 'm1', to: 'L0.a' }], layers).length, 0, 'attack is not modulatable');
  assert.equal(cleanMods([{ id: 'm1', to: 'L3.cutoff' }], layers).length, 0, 'no such layer');
  assert.equal(cleanMods([{ id: 'bad', to: 'L0.cutoff' }, { id: 'm1', to: 'm9.rate' }], layers).length, 0);
  const chain = [{ id: 'm1', to: 'L0.cutoff' }]; for (let i = 2; i <= 9; i++) chain.push({ id: 'm' + i, to: `m${i - 1}.rate` });
  const cc = cleanMods(chain, layers); assert.equal(cc.length, MOD.maxDepth, 'nesting deeper than 6 dropped');
  assert.equal(modOrder(cc).depth.m6, 6);
  const p = { layers, mods: cc };
  assert.equal(canAddMod(p, 'm6.rate'), false, 'would be depth 7'); assert.equal(canAddMod(p, 'L0.cutoff'), false, 'already has one');
  assert.equal(canAddMod(p, 'L1.q'), true); assert.equal(newMod(p, 'L1.q').id, 'm7');
});
ok('cycles are rejected (m1 → m2 → m1), what hangs off them too', () => {
  const layers = [cleanLayer({ kind: 'osc' })];
  const c = cleanMods([{ id: 'm1', to: 'm2.rate' }, { id: 'm2', to: 'm1.depth' }, { id: 'm3', to: 'm1.rate' }, { id: 'm4', to: 'L0.freq' }], layers);
  assert.deepEqual(c.map((m) => m.id), ['m4']);
  assert.equal(cleanMods([{ id: 'm1', to: 'm1.rate' }], layers).length, 0, 'self-loop');
  assert.ok(modOrder([{ id: 'm1', to: 'm2.rate' }, { id: 'm2', to: 'm1.rate' }]).cyclic.size === 2);
});
ok('topological order: every LFO is evaluated after the LFOs that modulate it', () => {
  const mods = [{ id: 'm1', to: 'L0.cutoff' }, { id: 'm2', to: 'm1.rate' }, { id: 'm3', to: 'm2.depth' }, { id: 'm4', to: 'm1.depth' }];
  const order = modOrder(mods).order.map((m) => m.id);
  for (const m of mods) { const t = parseTarget(m.to); if (t.type === 'mod') assert.ok(order.indexOf(m.id) < order.indexOf(t.id), `${m.id} before ${t.id}`); }
});
ok('removing a layer/LFO takes its LFOs (and their modulators) along; higher layers shift down', () => {
  const mods = [{ id: 'm1', to: 'L0.cutoff' }, { id: 'm2', to: 'm1.rate' }, { id: 'm3', to: 'L2.level' }];
  assert.deepEqual(removeLayerMods(mods, 0).map((m) => [m.id, m.to]), [['m3', 'L1.level']]);
  assert.deepEqual(removeMod(mods, 'm1').map((m) => m.id), ['m3']);
});
ok('per-sample program = the control-rate reference (same maths), nested LFOs included', () => {
  const layers = [cleanLayer({ kind: 'osc' })];
  const mods = cleanMods([{ id: 'm1', to: 'L0.cutoff', rate: 3, depth: 0.6 }, { id: 'm2', to: 'm1.rate', rate: 0.5, depth: 0.4 }, { id: 'm3', to: 'm2.depth', rate: 0.2, depth: 0.5 }, { id: 'm4', to: 'L0.level', rate: 6, depth: 0.5, wave: 'triangle' }], layers);
  const sr = 375; // = blockRate: one runner sample per control block
  const ref = evalMods(mods, { seconds: 2, blockRate: sr });
  const prog = compileMods(mods, layers, { bases: { 'L0.level': 1 } }), r = modRunner(prog, sr);
  const iCut = prog.outs.findIndex((o) => o.to === 'L0.cutoff'), iLev = prog.outs.findIndex((o) => o.to === 'L0.level');
  let worst = 0;
  for (let i = 0; i < 700; i++) {
    r.step();
    worst = Math.max(worst, Math.abs(r.out(iCut) - 1200 * Math.log2(ref.curves['L0.cutoff'][i])), Math.abs(r.out(iLev) - (ref.curves['L0.level'][i] - 1)));
  }
  assert.ok(worst < 0.05, 'max diff ' + worst);
});
ok('audio-rate LFO: 440 Hz on the pitch makes a 440 Hz modulation (zero crossings), outputs never NaN', () => {
  const layers = [cleanLayer({ kind: 'osc' })];
  const mods = cleanMods([{ id: 'm1', to: 'L0.freq', rate: 440, depth: 0.5 }], layers), prog = compileMods(mods, layers), r = modRunner(prog, 48000);
  let prev = 0, zc = 0, nan = 0;
  for (let i = 0; i < 48000; i++) { r.step(); const v = r.out(0); if (!Number.isFinite(v)) nan++; if (prev <= 0 && v > 0) zc++; prev = v; }
  assert.equal(nan, 0); assert.ok(Math.abs(zc - 440) <= 1, 'cycles/s ' + zc);
});
ok('CPU: 16 LFOs nested 6 deep, per sample – cost per 128-sample block', () => {
  const layers = cleanPatch({ layers: [{ kind: 'osc' }, { kind: 'osc' }, { kind: 'noise' }, { kind: 'osc' }] }).layers;
  const ms = [{ id: 'm1', to: 'L0.cutoff', rate: 3 }]; for (let i = 2; i <= 6; i++) ms.push({ id: 'm' + i, to: `m${i - 1}.rate`, rate: 0.5 + i });
  const tg = ['L0.freq', 'L0.level', 'L1.freq', 'L1.cutoff', 'L1.q', 'L2.cutoff', 'L2.level', 'L3.freq', 'L3.cutoff', 'G.gain'];
  tg.forEach((t, i) => ms.push({ id: 'm' + (7 + i), to: t, rate: i % 2 ? 880 : 4, wave: ['sine', 'triangle', 'square', 'sawtooth'][i % 4] }));
  const mods = cleanMods(ms, layers); assert.equal(mods.length, 16); assert.equal(Math.max(...Object.values(modOrder(mods).depth)), 6);
  const prog = compileMods(mods, layers), r = modRunner(prog, 48000), no = prog.outs.length, blocks = 3750; // 10 s of audio
  const t0 = process.hrtime.bigint();
  for (let b = 0; b < blocks; b++) for (let i = 0; i < 128; i++) { r.step(); for (let k = 0; k < no; k++) r.out(k); }
  const us = Number(process.hrtime.bigint() - t0) / 1000 / blocks;
  const budget = 128 / 48000 * 1e6; // 2667 µs of real time per block
  console.log(`      16 LFOs (depth 6), ${no} outputs: ${us.toFixed(1)} µs per 128-sample block = ${(100 * us / budget).toFixed(2)} % of one core in real time`);
  fs.writeFileSync('/tmp/klibb-lfo-bench.json', JSON.stringify({ us, budget, outputs: no }));
  assert.ok(us < budget * 0.25, 'well under a quarter of real time');
});
ok('decimation: sample-and-hold every N samples + bit reduction', () => {
  const x = Float32Array.from({ length: 16 }, (_, i) => i / 16);
  const y = decimate(x, 4); assert.deepEqual([...y.slice(0, 8)].map((v) => +v.toFixed(4)), [0, 0, 0, 0, 0.25, 0.25, 0.25, 0.25]);
  const z = decimate(Float32Array.from([0.3, -0.7]), 1, 2); assert.deepEqual([...z], [0.5, -0.5]);
  assert.deepEqual([...decimate(x, 1)], [...x], 'N = 1 is off');
});
ok('master clock: 90 BPM, 4/4 (2667 ms bar); rooms nudged ±0.3 BPM / 0–12 ms, deterministic; the City exact', () => {
  assert.equal(MASTER.bpm, 90); assert.ok(near(barMsAt(90), 8000 / 3));
  assert.deepEqual(roomTempo('stad'), { bpm: 90, phaseMs: 0 });
  const a = roomTempo('stad-1'), b = roomTempo('stad-4');
  assert.deepEqual(a, roomTempo('stad-1')); assert.notDeepEqual(a, b);
  for (const id of ['stad-1', 'stad-2', 'stad-3', 'stad-4', 'abc123', 'x7k2p9']) { const t = roomTempo(id); assert.ok(Math.abs(t.bpm - 90) <= 0.3 && t.phaseMs >= 0 && t.phaseMs <= 12, id); }
  console.log(`      stad-1: ${a.bpm} BPM + ${a.phaseMs} ms · stad-4: ${b.bpm} BPM + ${b.phaseMs} ms`);
});
ok('polyrhythm: loops of 3/4/5/7 steps per bar all meet on beat 1 of every bar', () => {
  const tempo = { bpm: 90, phaseMs: 0 }, bar = barMsAt(90);
  for (const steps of [3, 4, 5, 7, 12, 16]) {
    const e = loopSteps(0, bar * 2, { steps, tempo }); assert.equal(e.length, steps * 2, String(steps));
    assert.ok(e.some((x) => near(x.t, bar, 1e-6) && x.i === 0), `${steps}: step 0 on bar 2`);
  }
  assert.ok(near(barsAtTime(bar * 3 + 5, { bpm: 90, phaseMs: 5 }), 3));
  const v = voiceEvents(0, VOICE_CYCLE_MS - 1); assert.equal(v.length, 3 + 4 + 5 + 7);
  assert.deepEqual(FOUR_VOICES.map((x) => x.ratio), [1, 1.5, 2, 2.5], 'just intonation: root, fifth, octave, major tenth');
});
ok('tempo: 30 BPM … 120 000 BPM (2 kHz, "11"), log knob, ≥ 20 beats/s snaps to the semitone grid', () => {
  assert.equal(cleanBpm(5), RADIO.minBpm); assert.ok(near(cleanBpm(1e9), snapRate(2000) * 60, 0.01)); assert.equal(cleanBpm(NaN), 90);
  assert.equal(cleanBpm(26400), 26400, '440 Hz × 60'); assert.equal(cleanBpm(26500), 26400);
  assert.ok(near(knobToBpm(bpmToKnob(90)), 90, 0.01)); assert.equal(knobToBpm(0), 30); assert.ok(knobToBpm(1) > 100000);
});
ok('radio + room preset: cleaned, per room; nothing = the original', () => {
  const r = cleanRadio({ on: false, knob: 7, bird: { on: 'x', vol: 0.9 }, bpm: 120 });
  assert.equal(r.on, false); assert.equal(r.knob, 1); assert.equal(r.bird.on, false); assert.equal(r.bird.vol, 0.9); assert.equal(r.bpm, 120);
  assert.equal(cleanPreset(null), null); assert.equal(cleanPreset({}), null);
  const p = cleanPreset({ patches: { slap: { layers: [{ kind: 'sampler', sample: 'c'.repeat(64) }] }, bogus: {} }, radio: { knob: 0.3 } });
  assert.ok(p.patches.slap && !p.patches.bogus && p.radio.knob === 0.3);
});
ok('sequencer layer: lengths 1–16, steps {on, vol} (the old auto-slap step schema), compact storage', () => {
  const l = cleanLayer({ kind: 'osc', seq: { len: 40, bars: 3, steps: [{ on: false }] } });
  assert.equal(l.seq.len, 16); assert.equal(l.seq.bars, 1); assert.equal(l.seq.steps.length, 16); assert.equal(l.seq.steps[0].on, false); assert.equal(l.seq.steps[1].vol, 100);
  assert.equal(cleanLayer({ kind: 'osc', seq: { len: 0 } }).seq.len, 1);
  assert.deepEqual(SYNTH.seqLens, [3, 4, 5, 6, 7, 8, 12, 16]);
});
ok('bird: every phrase falls, sparse (5–17 s gaps), three kinds', () => {
  const kinds = new Set();
  for (let i = 0; i < 60; i++) { const p = birdPhrase('s' + i); kinds.add(p.kind); assert.ok(p.notes.every((x) => x.f1 < x.f0 && x.f0 < 7000 && x.dur > 0)); assert.ok(p.gap >= 5 && p.gap <= 17); }
  assert.deepEqual([...kinds].sort(), ['plover', 'redwing', 'warbler']);
});
ok('radio knob = morph + seek (not a volume): 0 = original, ½ = my preset, 1 = on past it (×2, clamped, on the grid, no louder)', () => {
  assert.equal(knobToMorph(0), 0); assert.equal(knobToMorph(0.5), 1); assert.equal(knobToMorph(1), 2); assert.equal(RADIO_DEFAULTS.knob, 0.5);
  const a = cleanPatch({ gain: 0.8, layers: [{ kind: 'osc', wave: 'sine', freq: 220, cutoff: 1000, level: 0.5 }] });
  const b = cleanPatch({ gain: 0.9, layers: [{ kind: 'osc', wave: 'square', freq: 330, cutoff: 2000, level: 0.7 }, { kind: 'noise', level: 0.3 }] });
  const x = morphPatch(a, b, 2);
  assert.ok(near(x.layers[0].freq, snapFreq(220 * Math.pow(1.5, 2))), 'pitch: the same ratio again (log), on the grid');
  assert.ok(near(x.layers[0].cutoff, 4000, 1e-6), 'cutoff 1000 → 2000 → 4000 (log)');
  assert.equal(x.layers[0].wave, 'square'); assert.equal(x.layers[0].level, 0.7); assert.equal(x.gain, 0.9); assert.equal(x.layers[1].level, 0.3);
  const far = morphPatch(a, cleanPatch({ layers: [{ kind: 'osc', freq: 15000, cutoff: 19000 }] }), 2);
  assert.ok(far.layers[0].freq <= SYNTH.layer.freq[1] && far.layers[0].cutoff <= SYNTH.layer.cutoff[1], 'clamped to legal ranges');
  assert.ok(same(morphPatch(a, a, 2), a), 'no preset (= original): nothing to seek');
  const m15 = morphPatch(a, b, 1.5); assert.ok(m15.layers[0].cutoff > 2000 && m15.layers[0].cutoff < 4000);
});

ok('city place effect: zones blend smoothly (no jumps), quarters as laid out, clean quarter fully dry, table editable', () => {
  const at = (x, z) => cityFxAt(x, z);
  const z = (x, zz) => at(x, zz).zones;
  assert.equal(z(-32, -32).delay, 1); assert.equal(z(32, -32).reverb, 1); assert.equal(z(-32, 0).flanger, 1); assert.equal(z(32, 0).chorus, 1);
  assert.equal(z(-32, 32).glitch, 1); assert.equal(z(32, 32).clean, 1); assert.equal(z(0, 17).square, 1); assert.equal(z(0, -46).park, 1);
  const c = at(32, 32); for (const k of Object.keys(PLACE)) if (!['bird', 'wind'].includes(k)) assert.ok(near(c[k], PLACE_NEUTRAL[k], 1e-6), 'clean: ' + k);
  const dl = at(-32, -32); assert.ok(near(dl.delayTime, 1 / 3) && near(dl.delay2Time, 0.5) && dl.delayFb > 0.3, 'delay quarter: ⅛ + dotted ⅛ at 90 BPM, feedback');
  assert.ok(at(32, -32).verbWet >= 0.7 && at(32, -32).verbSize === 1);
  assert.ok(at(-32, 0).modBase < 3 && at(-32, 0).modFb > 0.5, 'flanger: short + feedback'); assert.ok(at(32, 0).modBase > 10 && at(32, 0).modFb === 0, 'chorus: longer, no feedback');
  const g = at(-32, 32); assert.ok(g.stutter > 0.3 && g.decimMix > 0.5 && g.bits < 8 && near(g.stutterLen, 1 / 6), 'glitch: crush + bits + 16th stutter');
  assert.ok(at(47.5, 0).decimMix > 0.6 && at(47.5, 0).cutoff < 6000, 'edge: a broken radio'); assert.ok(at(0, -46).bird === 2, 'park: more bird');
  assert.ok(at(16, 0).delayWet > 0 && at(0, 30).verbWet > 0.12, 'streets: slapback; square: big echo');
  // between two quarters: a blend
  const mid = at(-32, -16); assert.ok(mid.zones.delay > 0.3 && mid.zones.flanger > 0.3 && mid.modMix > 0.2 && mid.delay2Wet > 0.05);
  // walking: every 10 cm step changes each value by only a small part of its range (no jumps)
  let worst = 0;
  for (const line of [[[-48, -32], [48, -32]], [[-48, 0], [48, 0]], [[-48, 32], [48, 32]], [[-32, -48], [-32, 48]], [[32, -48], [32, 48]], [[0, -48], [0, 48]], [[-48, -48], [48, 48]]]) {
    let prev = null;
    for (let i = 0; i <= 960; i++) {
      const t = i / 960, v = at(line[0][0] + (line[1][0] - line[0][0]) * t, line[0][1] + (line[1][1] - line[0][1]) * t);
      if (prev) for (const k of Object.keys(PLACE)) { const [lo, hi, log] = PLACE[k]; const d = log ? Math.abs(Math.log(v[k] / prev[k])) / Math.log(hi / lo) : Math.abs(v[k] - prev[k]) / (hi - lo); worst = Math.max(worst, d); }
      prev = v;
    }
  }
  assert.ok(worst < 0.04, `largest step ${worst.toFixed(4)} of a range per 10 cm`);
  for (let i = 0; i < 300; i++) { const v = at(Math.random() * 120 - 60, Math.random() * 120 - 60); for (const k of Object.keys(PLACE)) assert.ok(v[k] >= PLACE[k][0] && v[k] <= PLACE[k][1] && Number.isFinite(v[k]), k); }
  assert.ok(same(Object.keys(at(NaN, 0)).sort(), Object.keys(at(0, 0)).sort()));
  // weights: 1 inside, smooth to 0 at feather
  const q = { shape: 'circle', x: 0, z: 0, r: 5, feather: 4 }; assert.equal(zoneWeight(q, 3, 0), 1); assert.equal(zoneWeight(q, 9, 0), 0); assert.ok(near(zoneWeight(q, 7, 0), 0.5));
  // data-driven: a cleaned edit drives cityFxAt; junk is dropped and clamped
  const ed = cleanCityFx({ base: { verbWet: 9 }, zones: [{ shape: 'circle', x: 0, z: 0, r: 4, fx: { modMix: 1, bogus: 3 } }, { shape: 'star' }, null] });
  assert.equal(ed.base.verbWet, PLACE.verbWet[1]); assert.equal(ed.zones.length, 1); assert.ok(!('bogus' in ed.zones[0].fx));
  assert.equal(cityFxAt(0, 0, ed).modMix, 1); assert.equal(cityFxAt(30, 30, ed).modMix, 0);
  assert.ok(same(cleanCityFx(CITY_FX).zones.map((x) => x.id), CITY_FX.zones.map((x) => x.id)), 'the built-in table passes its own check');
});
ok('envelope follower: a mod source like an LFO (same list/limits/cycles/nesting), rectify + one-pole, threshold, invert, loops smoothed', () => {
  const layers = cleanPatch({ layers: [{ kind: 'osc' }, { kind: 'mic' }] }).layers;
  assert.equal(layers[1].kind, 'mic'); assert.ok(!('sample' in layers[1]) && !('note' in layers[1]), 'a mic layer gets no sampler keys');
  const p = { layers, mods: [] };
  const f = newFollower(p, 'L0.cutoff', 'mic'); assert.ok(f && f.wave === 'follow' && f.src === 'mic');
  const mods = cleanMods([f, { id: 'm2', to: 'm1.depth', wave: 'sine', rate: 3, depth: 0.5 }, { id: 'm3', to: 'L1.level', wave: 'follow', src: 'L1', release: 0.01 }, { id: 'm4', to: 'G.gain', wave: 'follow', src: 'nope' }], layers);
  assert.deepEqual(mods.map((m) => m.id), ['m1', 'm2', 'm3'], 'unknown source dropped');
  assert.ok(selfLoop(mods[2]) && mods[2].release === MOD2.loopRelease, 'following what it moves: allowed, release ≥ 50 ms');
  // cycles still refused: follower m1 depth ← LFO m2 rate ← … a loop back to m1 is dropped
  const cyc = cleanMods([{ id: 'm1', to: 'm2.rate', wave: 'follow', src: 'master' }, { id: 'm2', to: 'm1.depth', wave: 'sine', rate: 1 }], layers);
  assert.equal(cyc.length, 0, 'a mod cycle through a follower is removed');
  // at most MOD.maxInputs different sources
  const many = cleanMods(['master', 'bus', 'mic', 'L0', 'L1'].map((src, i) => ({ id: 'm' + (i + 1), to: ['L0.cutoff', 'L0.q', 'L0.level', 'L1.cutoff', 'G.gain'][i], wave: 'follow', src })), layers);
  assert.equal(new Set(many.map((m) => m.src)).size, MOD2.maxInputs);
  // the runner: a loud input raises the cutoff, silence lowers it; attack fast, release slow; invert flips
  const prog = compileMods([mods[0]], layers); assert.deepEqual(prog.inputs, ['mic']);
  const r = modRunner(prog, 48000), loud = [], quiet = [];
  for (let i = 0; i < 4800; i++) { r.step([0.25 * Math.sin(i / 7)]); } loud.push(r.out(0), r.env[0]);
  for (let i = 0; i < 480; i++) r.step([0]); quiet.push(r.env[0]);
  for (let i = 0; i < 48000; i++) r.step([0]); quiet.push(r.out(0));
  assert.ok(loud[0] > 0 && loud[1] > 0.5, 'loud: env up, cutoff up (cents > 0)');
  assert.ok(quiet[0] > 0.1 && quiet[0] < loud[1], 'release is a smooth fall (not instant)');
  assert.ok(quiet[1] < 0, 'silence: cutoff below its setting');
  const ri = modRunner(compileMods([{ ...mods[0], invert: true }], layers), 48000); for (let i = 0; i < 4800; i++) ri.step([0.25 * Math.sin(i / 7)]); assert.ok(ri.out(0) < 0, 'invert');
  const rt = modRunner(compileMods([{ ...mods[0], thr: 0.9 }], layers), 48000); for (let i = 0; i < 4800; i++) rt.step([0.1 * Math.sin(i / 7)]); assert.ok(rt.out(0) < 0, 'below the threshold = closed');
  const rn = modRunner(compileMods([mods[0]], layers), 48000); for (let i = 0; i < 128; i++) rn.step([NaN]); assert.ok(Number.isFinite(rn.out(0)), 'NaN input guarded');
  // evalMods (control-rate fallback): a follower is neutral, no crash
  assert.ok(evalMods(mods, { seconds: 0.5 }).blocks > 0);
});
ok('voice effect settings: off by default (dry), kinds incl. chorus/pitch/harmony, amount 0–1; echo on the 90 BPM clock', async () => {
  const { cleanVoiceFx, VOICE_FX, delaySec, snapVoicePitch, cleanMonitor } = await import('../client/src/voice.js');
  const d = cleanVoiceFx(null); assert.equal(d.on, false);
  assert.deepEqual(VOICE_FX.kinds, ['dry', 'radio', 'echo', 'hall', 'robot', 'chorus', 'pitch', 'harmony']);
  const f = cleanVoiceFx({ on: true, kind: 'hall', amount: 3 }); assert.ok(f.on && f.kind === 'hall' && f.amount === 1);
  assert.equal(cleanVoiceFx({ kind: 'x' }).kind, 'radio'); assert.ok(Math.abs(VOICE_FX.beat - 2 / 3) < 1e-9);
  assert.ok(Math.abs(delaySec('1/8', 90) - 1 / 3) < 1e-9);
  assert.ok(Math.abs(delaySec('1/4', 90) - 2 / 3) < 1e-9);
  assert.ok(Math.abs(delaySec('1/8.', 90) - 0.5) < 1e-9);
  assert.equal(snapVoicePitch(6), 7); assert.equal(snapVoicePitch(0), 0); assert.equal(snapVoicePitch(100), 19);
  const m = cleanMonitor(null); assert.equal(m.on, false); assert.equal(m.vol, VOICE_FX.monVolDef); assert.equal(m.raw, false);
  assert.equal(cleanVoiceFx({ kind: 'echo', div: '1/4' }).div, '1/4');
  assert.equal(cleanVoiceFx({ kind: 'harmony', harm: 'octave' }).harm, 'octave');
});
void variant;
console.log(`sampler/LFO/radio: ${n} checks ok`);
