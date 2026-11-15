// Step lamps (Jens t956u, t960u): a light above each sequencer pad flashes yellow when that step
// sounds, and white when the playhead passes a silent step (unmarked, or on but skipped by 1:N),
// on the AudioContext clock. Each ratchet repeat is its own yellow flash. Run: node tests/steplamps.test.mjs
import assert from 'node:assert/strict';
import { lampsLit, lampsKind, pruneHits, scheduleHit, STEP_LAMP, attachStepLamps, reportStepLamp, tickStepLamps, tickStepLampKinds, resetStepLamps, applyLamps } from '../client/src/steplamps.js';
import { DEFAULT_PATCHES, cleanPatch } from '../shared/synth.mjs';
import { GrooveSteps } from '../client/src/groove.js';

let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };

await ok('lampsLit: dark before the hit, bright at t and through the flash, dark after', () => {
  const hits = [{ i: 0, t: 1 }];
  assert.deepEqual([...lampsLit(hits, 0.999)], []);
  assert.deepEqual([...lampsLit(hits, 1)], [0]);
  assert.deepEqual([...lampsLit(hits, 1 + STEP_LAMP.flashSec / 2)], [0]);
  assert.deepEqual([...lampsLit(hits, 1 + STEP_LAMP.flashSec)], []);
  assert.deepEqual([...lampsLit(hits, 2)], []);
  assert.equal(lampsKind(hits, 1).get(0), 'on');
});

await ok('lampsLit: two steps – only the one whose flash covers now is lit', () => {
  const hits = [{ i: 0, t: 1 }, { i: 2, t: 1.5 }];
  assert.deepEqual([...lampsLit(hits, 1.05)], [0]);
  assert.deepEqual([...lampsLit(hits, 1.11)], [0]);
  assert.deepEqual([...lampsLit(hits, 1.5)], [2]); // flashSec is 0.12, so step 0 is already dark
});

await ok('lampsLit: a 4× ratchet re-flashes the same lamp on each repeat', () => {
  const hits = [0, 1, 2, 3].map((k) => ({ i: 1, t: 2 + k * 0.05 }));
  assert.deepEqual([...lampsLit(hits, 1.99)], []);
  assert.deepEqual([...lampsLit(hits, 2.00)], [1]);
  assert.deepEqual([...lampsLit(hits, 2.06)], [1]); // still in first flash, also in second
  assert.deepEqual([...lampsLit(hits, 2.16)], [1]); // after first ended, second/third still on
  assert.deepEqual([...lampsLit(hits, 2.15 + STEP_LAMP.flashSec)], []);
});

await ok('lampsKind: a silent playhead pass is white; a sounded step is yellow; yellow wins if both cover now', () => {
  const hits = [{ i: 1, t: 3, color: 'white' }, { i: 0, t: 3 }];
  assert.equal(lampsKind(hits, 2.999).size, 0);
  assert.equal(lampsKind(hits, 3).get(1), 'white');
  assert.equal(lampsKind(hits, 3).get(0), 'on');
  assert.equal(lampsKind(hits, 3 + STEP_LAMP.flashSec).size, 0);
  const both = [{ i: 2, t: 1, color: 'white' }, { i: 2, t: 1.05 }];
  assert.equal(lampsKind(both, 1.05).get(2), 'on', 'a sounded hit wins over a white pass on the same step');
  assert.equal(lampsKind(both, 1.05 + STEP_LAMP.flashSec / 2).get(2), 'on'); // yellow still in window after white ended
  assert.equal(lampsKind(both, 1.05 + STEP_LAMP.flashSec).has(2), false);
  assert.equal(lampsKind([{ i: 2, t: 1, color: 'white' }], 1).get(2), 'white');
});

await ok('scheduleHit ignores bad values and already-finished hits; pruneHits drops expired ones; white is stored', () => {
  assert.deepEqual(scheduleHit([], '0', 1, 0), []);
  assert.deepEqual(scheduleHit([], -1, 1, 0), []);
  assert.deepEqual(scheduleHit([], 0, NaN, 0), []);
  assert.deepEqual(scheduleHit([], 0, 1, 1 + STEP_LAMP.flashSec), []);
  const kept = scheduleHit([], 3, 5, 4.9);
  assert.deepEqual(kept, [{ i: 3, t: 5 }]);
  assert.deepEqual(pruneHits(kept, 5 + STEP_LAMP.flashSec), []);
  assert.deepEqual(pruneHits(kept, 5), kept);
  assert.deepEqual(scheduleHit([], 1, 2, 1.9, { color: 'white' }), [{ i: 1, t: 2, color: 'white' }]);
  assert.deepEqual(scheduleHit([], 1, 2, 1.9, { color: 'on' }), [{ i: 1, t: 2 }], 'non-white color is omitted (yellow default)');
});

await ok('applyLamps toggles .on (yellow) and .white, never both, and clears them when dark', () => {
  const mk = (i) => {
    const cls = { on: false, white: false };
    return { dataset: { step: String(i) }, classList: { toggle(name, v) { if (name === 'on' || name === 'white') cls[name] = !!v; }, get on() { return cls.on; }, get white() { return cls.white; } } };
  };
  const a = mk(0), b = mk(1), c = mk(2);
  const root = { querySelectorAll: () => [a, b, c] };
  applyLamps(new Set([1]), root);
  assert.equal(a.classList.on, false); assert.equal(a.classList.white, false);
  assert.equal(b.classList.on, true); assert.equal(b.classList.white, false);
  assert.equal(c.classList.on, false);
  applyLamps(new Map([[0, 'on'], [2, 'white']]), root);
  assert.equal(a.classList.on, true); assert.equal(a.classList.white, false);
  assert.equal(b.classList.on, false); assert.equal(b.classList.white, false);
  assert.equal(c.classList.on, false); assert.equal(c.classList.white, true);
  applyLamps(new Set(), root);
  assert.equal(a.classList.on, false); assert.equal(c.classList.white, false);
});

await ok('reportStepLamp + tickStepLamps: a scheduled hit lights at its AudioContext time, then goes dark; white is a kind', () => {
  resetStepLamps();
  let now = 4;
  attachStepLamps({ getNow: () => now });
  reportStepLamp(2, 4.2);
  assert.deepEqual([...tickStepLamps(4.0)], []);
  assert.deepEqual([...tickStepLamps(4.2)], [2]);
  assert.equal(tickStepLampKinds(4.2).get(2), 'on');
  assert.deepEqual([...tickStepLamps(4.2 + STEP_LAMP.flashSec)], []);
  resetStepLamps();
  reportStepLamp(1, 5, 'white');
  assert.equal(tickStepLampKinds(5).get(1), 'white');
  assert.deepEqual([...tickStepLamps(5)], [1]);
  assert.deepEqual([...tickStepLamps(5 + STEP_LAMP.flashSec)], []);
  resetStepLamps();
});

// GrooveSteps with a running AudioContext: only my real plays light a lamp yellow; silent passes are white
const step = () => cleanPatch(DEFAULT_PATCHES.step);
const T0 = 1794500012345.6;
function walk(g, ms, t, rate = null) {
  if (rate) g.setRun({ rate, tune: 1 });
  g.update([{ id: 'me', x: 0, z: 0, at: null }], t);
  let x = 0; for (let i = 0; i < ms / 16; i++) { t += 16; x += 0.04; g.update([{ id: 'me', x, z: 0, at: null }], t); }
  return t;
}

await ok('GrooveSteps: each of my sounded steps is yellow; a 1:2 skip and unmarked steps flash white', () => {
  resetStepLamps();
  const ctx = { state: 'running', currentTime: 10 };
  attachStepLamps({ getNow: () => ctx.currentTime });
  const p = step(); p.seq.steps[0].cond = 2; // 1:2 – every other loop of the 4-step pattern
  const played = [];
  const s = { played, ctx, mine: { colour: 0 }, muted: false, engine: null, play: (k, at, o) => played.push({ k, ...o }), patchFor: () => ({ patch: cleanPatch(p) }) };
  const g = new GrooveSteps(s, { now: () => 0 }); clearInterval(g.watch); g.setBpm(90);
  walk(g, 4000, Math.floor(T0 / 1000) * 1000 + 137);
  assert.ok(played.length >= 2, 'some steps played');
  assert.ok(played.every((x) => x.k === 'step' && x.time != null && x.time >= 10 - 0.05));
  assert.ok(played.every((x) => x.seqStep === 0));
  const plays = played.map((x) => x.time).sort((a, b) => a - b);
  const gap = plays[1] - plays[0];
  assert.ok(gap > 0.2, '1:2 leaves a gap between plays, got ' + gap);
  // tickStepLampKinds prunes expired hits, so walk the clock forward only.
  assert.equal(tickStepLampKinds(plays[0]).get(0), 'on', 'lamp 0 is yellow at the first play');
  const stepDt = gap / 8; // two loops of 4 steps between plays
  const unmarkedAt = plays[0] + stepDt + 0.002;
  assert.equal(tickStepLampKinds(unmarkedAt).get(1), 'white', 'unmarked step 2 flashes white');
  const skipAt = plays[0] + gap / 2 + 0.002;
  assert.equal(tickStepLampKinds(skipAt).get(0), 'white', '1:2 skip flashes white at ' + skipAt);
  assert.equal(tickStepLampKinds(plays[1]).get(0), 'on', 'lamp 0 is yellow at the next sounded pass');
  const always = step();
  const playedA = [];
  const sA = { played: playedA, ctx, mine: { colour: 0 }, muted: false, engine: null, play: (k, at, o) => playedA.push({ k, ...o }), patchFor: () => ({ patch: always }) };
  const gA = new GrooveSteps(sA, { now: () => 0 }); clearInterval(gA.watch); gA.setBpm(90);
  resetStepLamps();
  walk(gA, 4000, Math.floor(T0 / 1000) * 1000 + 137);
  assert.ok(playedA.length > played.length, `1:2 played ${played.length}, 1:1 played ${playedA.length}`);
  resetStepLamps();
});

await ok('GrooveSteps: a 4× ratchet reports four yellow hits on the same step; someone else walking does not light my lamps', () => {
  resetStepLamps();
  const ctx = { state: 'running', currentTime: 10 };
  attachStepLamps({ getNow: () => ctx.currentTime });
  const p = step(); p.seq.steps[0].ratchet = 4;
  const played = [];
  const s = { played, ctx, mine: { colour: 0 }, muted: false, engine: null, play: (k, at, o) => played.push({ k, ...o }), patchFor: () => ({ patch: cleanPatch(p) }) };
  const g = new GrooveSteps(s, { now: () => 0 }); clearInterval(g.watch); g.setBpm(90);
  walk(g, 2000, Math.floor(T0 / 1000) * 1000 + 137);
  assert.ok(played.length >= 4 && played.length % 4 === 0, 'plays come in groups of 4, got ' + played.length);
  assert.ok(played.every((e) => e.seqStep === 0 && e.time != null));
  const four = played.slice(0, 4);
  const dt = four[1].time - four[0].time;
  assert.ok(dt > 0.01 && dt < 0.2, 'ratchet spacing is a fraction of the step, got ' + dt);
  for (let k = 1; k < 4; k++) assert.ok(Math.abs((four[k].time - four[0].time) - k * dt) < 0.005, 'even ratchet spacing');
  assert.equal(tickStepLampKinds(four[0].time).get(0), 'on');
  assert.equal(tickStepLampKinds(four[3].time).get(0), 'on');

  resetStepLamps();
  const themPlayed = [];
  const s2 = { played: themPlayed, ctx, mine: { colour: 0 }, muted: false, engine: null, play: (k, at, o) => themPlayed.push({ k, ...o }), patchFor: () => ({ patch: step() }) };
  const g2 = new GrooveSteps(s2, { now: () => 0 }); clearInterval(g2.watch); g2.setBpm(90);
  let t = Math.floor(T0 / 1000) * 1000 + 137, x = 0;
  g2.update([{ id: 'them', x: 0, z: 0, at: [1, 0, 1], tempo: { bpm: 90, scale: 1, rate: 1, tune: 1 } }], t);
  for (let i = 0; i < 2000 / 16; i++) { t += 16; x += 0.04; g2.update([{ id: 'them', x, z: 0, at: [1, 0, 1], tempo: { bpm: 90, scale: 1, rate: 1, tune: 1 } }], t); }
  assert.ok(themPlayed.length >= 1, 'their steps still play');
  assert.deepEqual([...tickStepLamps(themPlayed[0].time || ctx.currentTime)], [], 'their steps do not light my lamps');
  resetStepLamps();
});

await ok('GrooveSteps: walk, run, sneak and dance all cycle every step of the set length (empty steps still take time)', () => {
  resetStepLamps();
  const ctx = { state: 'running', currentTime: 10 };
  attachStepLamps({ getNow: () => ctx.currentTime });
  // 8 steps, only 1 and 3 marked – the playhead must still visit 1..8
  const p = step();
  p.seq = { len: 8, loop: 1, steps: Array.from({ length: 8 }, (_, i) => ({ on: i === 0 || i === 2, vol: 100 })) };
  const played = [];
  const s = { played, ctx, mine: { colour: 0 }, muted: false, engine: null, play: (k, at, o) => played.push({ k, ...o }), patchFor: () => ({ patch: cleanPatch(p) }) };
  const g = new GrooveSteps(s, { now: () => 0 }); clearInterval(g.watch); g.setBpm(90);
  walk(g, 3000, Math.floor(T0 / 1000) * 1000 + 137);
  const sounded = new Set(played.map((e) => e.seqStep));
  assert.deepEqual([...sounded].sort((a, b) => a - b), [0, 2], 'only marked steps sound');
  // lamps should have been reported for all 8 indices (yellow on 0,2 and white on the rest)
  const seen = new Set();
  const t0 = Math.min(...played.map((e) => e.time));
  const t1 = Math.max(...played.map((e) => e.time));
  for (let t = t0; t <= t1 + 0.01; t += 0.01) {
    for (const i of tickStepLamps(t)) seen.add(i);
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7], 'playhead + lamps visit every step of length 8');
  resetStepLamps();
});

console.log(`steplamps: ${n} ok`);
