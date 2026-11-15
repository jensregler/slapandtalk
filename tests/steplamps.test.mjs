// Step lamps (Jens t956u): a light above each sequencer pad flashes when that step actually
// sounds, on the AudioContext clock. Conditions skip (no hit → no flash); each ratchet repeat
// is its own flash. Run: node tests/steplamps.test.mjs
import assert from 'node:assert/strict';
import { lampsLit, pruneHits, scheduleHit, STEP_LAMP, attachStepLamps, reportStepLamp, tickStepLamps, resetStepLamps, applyLamps } from '../client/src/steplamps.js';
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

await ok('scheduleHit ignores bad values and already-finished hits; pruneHits drops expired ones', () => {
  assert.deepEqual(scheduleHit([], '0', 1, 0), []);
  assert.deepEqual(scheduleHit([], -1, 1, 0), []);
  assert.deepEqual(scheduleHit([], 0, NaN, 0), []);
  assert.deepEqual(scheduleHit([], 0, 1, 1 + STEP_LAMP.flashSec), []);
  const kept = scheduleHit([], 3, 5, 4.9);
  assert.deepEqual(kept, [{ i: 3, t: 5 }]);
  assert.deepEqual(pruneHits(kept, 5 + STEP_LAMP.flashSec), []);
  assert.deepEqual(pruneHits(kept, 5), kept);
});

await ok('applyLamps toggles .on only on the lit step', () => {
  const mk = (i) => {
    let on = false;
    return { dataset: { step: String(i) }, classList: { toggle(name, v) { if (name === 'on') on = !!v; }, get on() { return on; } } };
  };
  const a = mk(0), b = mk(1), c = mk(2);
  const root = { querySelectorAll: () => [a, b, c] };
  applyLamps(new Set([1]), root);
  assert.equal(a.classList.on, false);
  assert.equal(b.classList.on, true);
  assert.equal(c.classList.on, false);
  applyLamps(new Set(), root);
  assert.equal(b.classList.on, false);
});

await ok('reportStepLamp + tickStepLamps: a scheduled hit lights at its AudioContext time, then goes dark', () => {
  resetStepLamps();
  let now = 4;
  attachStepLamps({ getNow: () => now });
  reportStepLamp(2, 4.2);
  assert.deepEqual([...tickStepLamps(4.0)], []);
  assert.deepEqual([...tickStepLamps(4.2)], [2]);
  assert.deepEqual([...tickStepLamps(4.2 + STEP_LAMP.flashSec)], []);
  resetStepLamps();
});

// GrooveSteps with a running AudioContext: only my real plays light a lamp
const step = () => cleanPatch(DEFAULT_PATCHES.step);
const T0 = 1794500012345.6;
function walk(g, ms, t, rate = null) {
  if (rate) g.setRun({ rate, tune: 1 });
  g.update([{ id: 'me', x: 0, z: 0, at: null }], t);
  let x = 0; for (let i = 0; i < ms / 16; i++) { t += 16; x += 0.04; g.update([{ id: 'me', x, z: 0, at: null }], t); }
  return t;
}

await ok('GrooveSteps: each of my played steps reports a lamp hit at the scheduled audio time; a 1:2 skip is never reported', () => {
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
  // only even passes of step 0 fire (cond 1:2); all plays are step 0
  assert.ok(played.every((x) => x.seqStep === 0));
  // every play should light lamp 0 at its audio time
  for (const ev of played) {
    const lit = tickStepLamps(ev.time);
    assert.ok(lit.has(0), 'lamp 0 lit at play time ' + ev.time);
    assert.equal(lit.size, 1);
  }
  // a time between flashes (after first, before second if they are far enough) stays dark for other steps
  const last = played[played.length - 1];
  assert.deepEqual([...tickStepLamps(last.time + STEP_LAMP.flashSec + 0.001)], []);
  // fewer plays than an always-on (1:1) pattern over the same walk – the skips never reached play()
  const always = step();
  const playedA = [];
  const sA = { played: playedA, ctx, mine: { colour: 0 }, muted: false, engine: null, play: (k, at, o) => playedA.push({ k, ...o }), patchFor: () => ({ patch: always }) };
  const gA = new GrooveSteps(sA, { now: () => 0 }); clearInterval(gA.watch); gA.setBpm(90);
  resetStepLamps();
  walk(gA, 4000, Math.floor(T0 / 1000) * 1000 + 137);
  assert.ok(playedA.length > played.length, `1:2 played ${played.length}, 1:1 played ${playedA.length}`);
  resetStepLamps();
});

await ok('GrooveSteps: a 4× ratchet reports four lamp hits on the same step; someone else walking does not light my lamps', () => {
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
  // first repeat lights; last repeat still lights at its own time
  assert.ok(tickStepLamps(four[0].time).has(0));
  assert.ok(tickStepLamps(four[3].time).has(0));

  // someone else: no new reports after reset
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

console.log(`steplamps: ${n} ok`);
