// The Steps sequencer (Jens t889u, 13 Nov 2026): ONE sequencer for the whole Steps sound (walk / run / crouch / dance
// at their tempo), migration of old per-layer Steps sequencers, parameter locks per step.
// Pure maths + GrooveSteps / Sounds with fakes (no browser). Run: node tests/stepseq.test.mjs (in npm test)
import assert from 'node:assert/strict';
import { DEFAULT_PATCHES, SYNTH, cleanPatch, cleanSound, migrateStepSeq, cleanStepSeq, STEP_SEQ_DEFAULT, stepSeqOf, morphPatch, variant, colourPatch, diffPatch, retune } from '../shared/synth.mjs';
import { stepSeqBetween, lockedPatch, setLock, getLock, clearLock, clearLocks, lockCount, stepsLocking, removeLayerLocks, resizeSeq, stepsPerFoot } from '../shared/stepseq.mjs';
import { eventsBetween, runEventsBetween, pulseMs } from '../shared/groove.mjs';
import { GrooveSteps } from '../client/src/groove.js';

let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const G = { scale: 1, at: 0, phase: 0 }, T0 = 1794500012345.6;
const step = () => cleanPatch(DEFAULT_PATCHES.step);

await ok('default Steps sound: 4 steps a footstep, step 1 on (= one hit per footstep, as before); kept by clean / variant / colour / retune', () => {
  const p = step();
  assert.deepEqual(p.seq, { len: 4, loop: 1, steps: [{ on: true, vol: 100 }, { on: false, vol: 100 }, { on: false, vol: 100 }, { on: false, vol: 100 }] });
  assert.deepEqual(stepSeqOf(null), STEP_SEQ_DEFAULT); assert.deepEqual(stepSeqOf({ layers: [] }), STEP_SEQ_DEFAULT, 'no seq → the default');
  assert.deepEqual(variant(p, 'abcd', 'step').seq, p.seq); assert.deepEqual(colourPatch(p, 2, 'step').seq, p.seq); assert.deepEqual(retune(p, 1.2).seq, p.seq);
  assert.equal(stepsPerFoot(p.seq), 4);
  assert.deepEqual(diffPatch(variant(DEFAULT_PATCHES.step, 'abcd', 'step'), variant(DEFAULT_PATCHES.step, 'abcd', 'step')), []);
});

await ok('the grid: steps on the footstep grid (shared clock, anchored at 0); with the default only step 1 sounds – exactly on every footstep pulse, for every slot, walk and run', () => {
  for (const slot of [0, 1, 2, 3, 4]) for (const rate of [1, 2, 0.5, 11 / 8]) for (const bpm of [90, 120, 180]) {
    const from = T0, to = T0 + 4000;
    const seq = stepSeqBetween(G, slot, from, to, { rate, bpm, seq: STEP_SEQ_DEFAULT });
    const feet = runEventsBetween(G, slot, from, to, rate, { bpm, max: 999 });
    const on = seq.filter((e) => e.i === 0);
    assert.equal(on.length, feet.length, `slot ${slot} rate ${rate} bpm ${bpm}`);
    on.forEach((e, k) => { assert.ok(near(e.t, feet[k].t, 1e-3)); assert.equal(e.n, feet[k].n, 'n = the footstep number (left/right)'); assert.ok(e.foot); assert.equal(e.tick, feet[k].tick); });
    assert.ok(seq.filter((e) => !e.foot).every((e) => e.i !== 0), 'sub-steps 2–4 between the footsteps');
    if (rate === 1) assert.deepEqual(eventsBetween(G, slot, from, to, { bpm, max: 999 }).map((e) => e.t), feet.map((e) => e.t));
  }
  // 3 steps over 2 footsteps: step k at k × 2/3 footsteps
  const q = { len: 3, loop: 2, steps: [{ on: true, vol: 100 }, { on: true, vol: 100 }, { on: true, vol: 100 }] };
  const ev = stepSeqBetween(G, 0, T0, T0 + 3000, { bpm: 90, seq: q }), P = pulseMs(1, 0, 90);
  for (let k = 1; k < ev.length; k++) assert.ok(near(ev[k].t - ev[k - 1].t, P * 2 / 3, 1e-3));
  assert.ok(ev.every((e) => e.i === ((e.m % 3) + 3) % 3));
});

await ok('migration: an old Steps patch with per-layer sequencers → ONE whole-sound sequencer from the first such layer; the loop keeps about the old step rate; layer seqs dropped', () => {
  const old = { v: 1, gain: 1, layers: [
    { kind: 'noise', noise: 'pink', cutoff: 520, level: 0.16 },
    { kind: 'osc', freq: 85, level: 0.12, seq: { len: 5, bars: 0.5, steps: [{ on: true, vol: 100 }, { on: false, vol: 60 }, { on: true, vol: 80 }, { on: true, vol: 100 }, { on: false, vol: 100 }] } },
    { kind: 'osc', freq: 300, level: 0.1, seq: { len: 3, bars: 1, steps: [{ on: true, vol: 100 }, { on: true, vol: 100 }, { on: true, vol: 100 }] } },
  ] };
  const m = migrateStepSeq(old);
  assert.ok(m.layers.every((l) => !l.seq), 'no layer keeps its own sequencer');
  assert.deepEqual(m.seq, { len: 5, loop: 4, steps: [{ on: true, vol: 100 }, { on: false, vol: 60 }, { on: true, vol: 80 }, { on: true, vol: 100 }, { on: false, vol: 100 }] }, '½ bar = 4 footsteps');
  assert.ok(old.layers[1].seq, 'the input is not mutated');
  // through cleanSound (sessionStorage load, together.setLiveSound, the server) – the same
  const s = cleanSound({ seed: 'abcd', patches: { step: old, slap: { layers: [{ kind: 'osc', seq: { len: 4, bars: 1, steps: [] } }] } } }, { custom: true });
  assert.deepEqual(s.patches.step.seq, m.seq); assert.ok(s.patches.step.layers.every((l) => !l.seq));
  assert.ok(s.patches.slap.layers[0].seq, 'Slap / Peel / Landing keep their per-layer sequencers');
  // 1 bar = 8 footsteps; 4 bars → the longest loop (16)
  assert.equal(migrateStepSeq({ layers: [{ seq: { len: 4, bars: 1, steps: [] } }] }).seq.loop, 8);
  assert.equal(migrateStepSeq({ layers: [{ seq: { len: 4, bars: 4, steps: [] } }] }).seq.loop, 16);
  assert.equal(migrateStepSeq({ layers: [{ seq: { len: 4, bars: 0.25, steps: [] } }] }).seq.loop, 2);
  // no seq anywhere → untouched (plays the default); an already migrated patch → unchanged; junk never throws
  const plain = { v: 1, gain: 1, layers: [{ kind: 'noise' }] };
  assert.equal(migrateStepSeq(plain), plain); assert.equal(cleanPatch(migrateStepSeq(plain)).seq, undefined);
  const again = cleanPatch(m); assert.deepEqual(cleanPatch(migrateStepSeq(again)), again);
  for (const junk of [null, undefined, 5, 'x', {}, { layers: 'no' }, { layers: [null, 3, { seq: 'bad' }] }]) assert.doesNotThrow(() => cleanSound({ seed: 'abcd', patches: { step: migrateStepSeq(junk) } }, { custom: true }));
  // an old save with a broken seq still loads (and keeps its layers)
  const bad = cleanSound({ seed: 'abcd', patches: { step: { layers: [{ kind: 'noise', seq: { len: 99, bars: 7, steps: 'x' } }] } } }, { custom: true });
  assert.equal(bad.patches.step.seq.len, 16); assert.equal(bad.patches.step.layers.length, 1);
});

await ok('cleanStepSeq: len 1–16, loop from the footstep list, step on/vol, locks clamped to the slider ranges; bad keys / missing layers dropped', () => {
  const layers = step().layers;
  const q = cleanStepSeq({ len: 3, loop: 3, steps: [{ on: true, vol: 140, locks: { 'L0.cutoff': 99999, 'L1.freq': 10, 'G.gain': 9, 'L5.cutoff': 100, 'L0.wave': 'square', 'L0.nope': 1, 'x': 1, 'L1.level': NaN } }, { on: 1 }, null] }, layers);
  assert.equal(q.len, 3); assert.equal(q.loop, 1, 'loop not in the list → 1');
  assert.deepEqual(q.steps[0], { on: true, vol: 100, locks: { 'L0.cutoff': 18000, 'L1.freq': 20, 'G.gain': 1.5 } });
  assert.deepEqual(q.steps[1], { on: false, vol: 100 }, 'on must be true');
  assert.deepEqual(q.steps[2], { on: false, vol: 100 });
  assert.equal(cleanStepSeq({ len: 0 }).len, 1); assert.equal(cleanStepSeq({ len: 40 }).len, 16);
  const many = {}; for (const li of [0, 1]) for (const k of Object.keys(SYNTH.layer)) many[`L${li}.${k}`] = SYNTH.layer[k][0];
  assert.equal(Object.keys(cleanStepSeq({ len: 1, steps: [{ on: true, locks: many }] }, layers).steps[0].locks).length, SYNTH.maxLocksPerStep);
});

await ok('locks: step i plays with its locked values, every other step with the base; never mutates; helpers set / get / clear / count / remap', () => {
  const p = step();
  setLock(p.seq, 2, 'L0.cutoff', 3000); setLock(p.seq, 2, 'G.gain', 0.4); setLock(p.seq, 3, 'L1.freq', 440);
  p.seq.steps[2].on = true;
  const c = cleanPatch(p);
  assert.deepEqual(c.seq.steps[2].locks, { 'L0.cutoff': 3000, 'G.gain': 0.4 });
  const s2 = lockedPatch(c, 2), s0 = lockedPatch(c, 0), s3 = lockedPatch(c, 3);
  assert.equal(s2.layers[0].cutoff, 3000); assert.equal(s2.gain, 0.4); assert.equal(s2.layers[1].freq, c.layers[1].freq, 'only the locked params');
  assert.equal(s0, c, 'no locks → the very same patch');
  assert.equal(s3.layers[1].freq, 440); assert.equal(s3.layers[0].cutoff, c.layers[0].cutoff);
  assert.equal(c.layers[0].cutoff, 520, 'the base is untouched');
  assert.equal(lockedPatch(c, 6).layers[0].cutoff, 3000, 'index wraps (6 % 4 = 2)');
  assert.equal(getLock(p.seq, 2, 'L0.cutoff'), 3000); assert.equal(getLock(p.seq, 1, 'L0.cutoff'), undefined);
  assert.deepEqual(stepsLocking(p.seq, 'L0.cutoff'), [2]); assert.equal(lockCount(p.seq), 3); assert.equal(lockCount(p.seq, 2), 2);
  clearLock(p.seq, 2, 'G.gain'); assert.deepEqual(p.seq.steps[2].locks, { 'L0.cutoff': 3000 });
  clearLocks(p.seq, 2); assert.equal(p.seq.steps[2].locks, undefined); assert.equal(lockCount(p.seq), 1);
  clearLocks(p.seq); assert.equal(lockCount(p.seq), 0);
  // a layer removed: its locks go, later layers' locks move down
  const q = { len: 2, loop: 1, steps: [{ on: true, vol: 100, locks: { 'L0.cutoff': 1, 'L1.cutoff': 2, 'L2.q': 3, 'G.gain': 1 } }, { on: false, vol: 100, locks: { 'L1.d': 0.2 } }] };
  removeLayerLocks(q, 1);
  assert.deepEqual(q.steps[0].locks, { 'L0.cutoff': 1, 'L1.q': 3, 'G.gain': 1 }); assert.equal(q.steps[1].locks, undefined);
  resizeSeq(q, 5); assert.equal(q.len, 5); assert.equal(q.steps.length, 5); assert.deepEqual(q.steps[4], { on: false, vol: 100 }); assert.ok(q.steps[0].locks, 'kept');
  resizeSeq(q, 1); assert.equal(q.steps.length, 1);
});

await ok('locks are saved with the sound (cleanSound round trip); too big a patch drops the locks, never the sound', () => {
  const p = step(); setLock(p.seq, 1, 'L0.cutoff', 2400); p.seq.steps[1].on = true;
  const s = cleanSound({ seed: 'abcd', patches: { step: p } }, { custom: true });
  assert.deepEqual(s.patches.step.seq.steps[1], { on: true, vol: 100, locks: { 'L0.cutoff': 2400 } });
  assert.deepEqual(JSON.parse(JSON.stringify(cleanSound(JSON.parse(JSON.stringify(s)), { custom: true }))), JSON.parse(JSON.stringify(s)));
  // a big 4-layer patch + 16 steps × 24 locks: over maxPatchBytes → the locks go
  const big = { v: 1, gain: 1, layers: [0, 1, 2, 3].map(() => ({ kind: 'osc' })), seq: { len: 16, loop: 1, steps: Array.from({ length: 16 }, () => ({ on: true, vol: 100, locks: Object.fromEntries(Object.keys(SYNTH.layer).slice(0, 24).map((k, j) => [`L${j % 4}.${k}`, SYNTH.layer[k][0]])) })) } };
  const c = cleanPatch(big);
  assert.ok(c, 'the patch survives'); assert.equal(c.layers.length, 4); assert.ok(c.seq.steps.every((x) => !x.locks)); assert.ok(JSON.stringify(c).length <= SYNTH.maxPatchBytes);
});

await ok('morph (the Blend knob): the sequencer flips at the middle like the other step patterns', () => {
  const a = step(), b = step(); b.seq.steps[2].on = true; setLock(b.seq, 2, 'L0.cutoff', 4000);
  assert.deepEqual(morphPatch(a, b, 0.3).seq, a.seq); assert.deepEqual(morphPatch(a, b, 0.7).seq.steps[2], { on: true, vol: 100, locks: { 'L0.cutoff': 4000 } });
  assert.ok(diffPatch(a, b).includes('seq'));
});

// GrooveSteps (client/src/groove.js) with a fake Sounds: the sequencer runs on my footsteps, the entry is step 1
const fakeSound = (patch) => { const played = []; return { played, ctx: null, mine: { colour: 0 }, muted: false, engine: null, play: (k, at, o) => played.push({ k, ...o }), patchFor: () => ({ patch }) }; };
function walk(g, ms, t, rate = null) {
  if (rate) g.setRun({ rate, tune: 1 });
  g.update([{ id: 'me', x: 0, z: 0, at: null }], t);
  let x = 0; for (let i = 0; i < ms / 16; i++) { t += 16; x += 0.04; g.update([{ id: 'me', x, z: 0, at: null }], t); }
  return t;
}
await ok('GrooveSteps, default sequencer: the same footsteps as before (entry on the beat, then one per pulse), every one step 1 at full volume', () => {
  const s = fakeSound(step()), g = new GrooveSteps(s, { now: () => 0 }); clearInterval(g.watch); g.setBpm(90);
  walk(g, 3000, Math.floor(T0 / 1000) * 1000 + 137);
  const log = g.log.filter((e) => e.id === 'me');
  assert.ok(log.length >= 8 && log[0].entry);
  assert.ok(s.played.every((p) => p.seqStep === 0 && p.volume === 1));
  const P = pulseMs(1, 0, 90);
  for (let k = 2; k < log.length; k++) assert.ok(near(log[k].t - log[k - 1].t, P, 0.2), 'one footstep per pulse');
  assert.equal(s.played.length, log.length);
});
await ok('GrooveSteps, a pattern with locks: steps 1 + 3 on (3 at 50 %), the played steps carry their index – only step 3 gets its locks', () => {
  const p = step(); p.seq.steps[2].on = true; p.seq.steps[2].vol = 50; setLock(p.seq, 2, 'L0.cutoff', 3000);
  const c = cleanPatch(p), s = fakeSound(c), g = new GrooveSteps(s, { now: () => 0 }); clearInterval(g.watch); g.setBpm(90);
  walk(g, 3000, Math.floor(T0 / 1000) * 1000 + 137);
  const idx = s.played.map((x) => x.seqStep);
  assert.ok(idx.includes(0) && idx.includes(2) && idx.every((i) => i === 0 || i === 2), JSON.stringify(idx));
  assert.ok(s.played.filter((x) => x.seqStep === 2).every((x) => x.volume === 0.5));
  const P = pulseMs(1, 0, 90), log = g.log.filter((e) => e.id === 'me' && !e.entry);
  for (let k = 1; k < log.length; k++) assert.ok(near(log[k].t - log[k - 1].t, P / 2, 0.2), 'step 3 halfway between two footsteps');
  // what Sounds.play does with seqStep: the locked patch for step 3 only
  assert.equal(lockedPatch(c, 2).layers[0].cutoff, 3000); assert.equal(lockedPatch(c, 0).layers[0].cutoff, 520);
});
await ok('GrooveSteps: running doubles the sequencer with the footsteps (rate × steps), entry is step 1', () => {
  const p = step(); p.seq.steps[1].on = true;
  const s = fakeSound(cleanPatch(p)), g = new GrooveSteps(s, { now: () => 0 }); clearInterval(g.watch); g.setBpm(120);
  walk(g, 3000, Math.floor(T0 / 1000) * 1000 + 61, 2);
  const log = g.log.filter((e) => e.id === 'me'); assert.equal(log[0].i, 0); assert.ok(log[0].entry);
  const P = pulseMs(1, 0, 120) / 2, rest = log.slice(1);
  const gaps = rest.slice(1).map((e, k) => e.t - rest[k].t);
  assert.ok(gaps.every((d) => near(d, P / 4, 0.2) || near(d, P * 3 / 4, 0.2)), JSON.stringify(gaps.slice(0, 6)));
  assert.ok(rest.every((e) => e.run === 2));
});

// Sounds.play (client/src/sound.js) with a fake engine: seqStep applies that step's locks, the wobble stays
globalThis.localStorage ||= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.sessionStorage ||= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.addEventListener ||= () => {}; globalThis.removeEventListener ||= () => {};
let Sounds = null;
try { ({ Sounds } = await import('../client/src/sound.js')); } catch (e) { console.log('  (sound.js not importable in node: ' + e.message + ' – engine check skipped)'); }
if (Sounds) {
  await ok('Sounds.play(step, { seqStep }): the engine gets step 3\'s locked cutoff on step 3 only; the walking wobble still varies the pitch', () => {
    const s = new Sounds(); s.muted = false; const got = [];
    s.engine = { play: (patch) => { got.push(patch); return true; } }; s.ensure = () => true;
    const p = step(); p.seq.steps[2].on = true; setLock(p.seq, 2, 'L0.cutoff', 3000);
    s.mine = { seed: 'abcd', patches: { step: cleanPatch(p) } };
    for (let k = 0; k < 8; k++) s.play('step', null, { seqStep: k % 2 ? 2 : 0 });
    const cut = got.map((x) => x.layers[0].cutoff), fq = got.map((x) => x.layers[1].freq);
    // retune (the wobble) scales the cutoff by the per-step rate: locked ≈ 3000 × 0.94…1.06, base ≈ 520 × the same
    cut.forEach((c, k) => assert.ok(k % 2 ? c > 2700 && c < 3300 : c > 470 && c < 570, `${k}: ${c}`));
    assert.ok(new Set(fq).size > 1, 'the per-step wobble is still there');
    assert.ok(s.stepLog.slice(-8).every((e, k) => e.step === (k % 2 ? 2 : 0) && e.locked === !!(k % 2) && e.cut[0] === (k % 2 ? 3000 : 520)));
    // an OLD save (per-layer seq) is migrated on the fly: every layer plays on the trigger (none skipped as a seq layer)
    s.mine = { seed: 'abcd', patches: { step: { v: 1, gain: 1, layers: [{ kind: 'noise', cutoff: 600, level: 0.2, seq: { len: 4, bars: 1, steps: [{ on: true, vol: 100 }] } }, { kind: 'osc', level: 0.1 }] } } };
    const pf = s.patchFor('step', s.mine).patch;
    assert.ok(pf.layers.every((l) => !l.seq) && pf.seq && pf.seq.len === 4);
  });
}
console.log(`stepseq: ${n} checks ok`);
