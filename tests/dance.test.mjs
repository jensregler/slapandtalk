// Runway dance choreography (shared/dance.mjs; Jens t540u, 5 Nov 2026).
// Pure maths – no browser, no GLB. Run: node tests/dance.test.mjs
import assert from 'assert/strict';
import { DANCE, dancePoseAt, dancePhase } from '../shared/dance.mjs';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

ok('duration is 19 s and the desktop key is X', () => {
  assert.equal(DANCE.duration, 19);
  assert.equal(DANCE.key, 'KeyX');
  assert.ok(DANCE.beat > 0 && DANCE.beat <= 1);
});

ok('phases follow the reference clip timeline', () => {
  assert.equal(dancePhase(-1), 'idle');
  assert.equal(dancePhase(0), 'approach');
  assert.equal(dancePhase(1.5), 'approach');
  assert.equal(dancePhase(3.5), 'pops');
  assert.equal(dancePhase(7), 'kneel');
  assert.equal(dancePhase(10), 'kneel-pause');
  assert.equal(dancePhase(12), 'popup');
  assert.equal(dancePhase(14), 'flair');
  assert.equal(dancePhase(16.5), 'squat');
  assert.equal(dancePhase(18.5), 'rise');
  assert.equal(dancePhase(19), 'done');
  assert.equal(dancePhase(30), 'done');
});

ok('t=0 is a standing pose (no drop, soft knees)', () => {
  const p = dancePoseAt(0);
  assert.ok(near(p.drop, 0));
  assert.ok(p.kneeL >= 0 && p.kneeL < 0.3);
  assert.ok(p.kneeR >= 0 && p.kneeR < 0.3);
});

ok('approach (0–3 s): arms asymmetric (right across chest), legs alternate', () => {
  const a = dancePoseAt(1.25), b = dancePoseAt(1.75);
  assert.ok(a.armRX < a.armLX - 0.3, 'right arm more across the chest than the left');
  // legs should differ between half-strides (~0.5 s apart at 1 Hz)
  assert.ok(Math.abs(a.legL - b.legL) > 0.1 || Math.abs(a.legR - b.legR) > 0.1, 'strut alternates');
});

ok('pops (3–5 s): wide stance and chest isolation on the beat', () => {
  const wide = dancePoseAt(4.0);
  assert.ok(wide.stanceL > 0.2 && wide.stanceR < -0.2, 'feet apart');
  // sample a few beats – at least one frame has a clear chest pop above the settle
  let maxChest = -Infinity;
  for (let t = 3; t < 5; t += 0.05) maxChest = Math.max(maxChest, dancePoseAt(t).chest);
  assert.ok(maxChest > 0.1, 'chest pops', maxChest);
});

ok('kneel (5–9 s): drop grows, knees fold hard, hands stay near the thighs (no floor plant)', () => {
  const early = dancePoseAt(5.2), mid = dancePoseAt(7), late = dancePoseAt(8.8);
  assert.ok(early.drop < mid.drop && mid.drop <= late.drop + 0.05, 'drop increases into the kneel');
  assert.ok(late.drop > 0.5, 'knees reach the floor (drop > 0.5 m)');
  assert.ok(late.kneeL > 1.8 && late.kneeR > 1.8, 'shins folded under');
  assert.ok(late.lean < 0, 'slight lean back');
  // arms not reaching down to the floor (forearm bend modest, upper arms not plunged)
  assert.ok(late.armLX > -1.0 && late.armRX > -1.0, 'hands stay by the thighs, not planted');
});

ok('kneel-pause (9–11 s): stays low', () => {
  const p = dancePoseAt(10);
  assert.ok(p.drop > 0.5);
  assert.equal(dancePhase(10), 'kneel-pause');
});

ok('popup (11–13 s): anticipation dip then explosive rise; drop returns near standing', () => {
  const dip = dancePoseAt(11.3);
  const mid = dancePoseAt(11.9);
  const land = dancePoseAt(12.7);
  assert.ok(dip.drop >= dancePoseAt(11).drop - 0.01, 'anticipation dips or holds');
  assert.ok(mid.drop < dip.drop - 0.25, 'explosive rise recovers height');
  assert.ok(land.drop < 0.15, 'lands near standing height');
  assert.ok(land.stanceL > 0.3 && land.stanceR < -0.3, 'feet slide out to catch the weight');
});

ok('flair + shimmy (13–15 s): arms thrown wide then shoulders roll', () => {
  const out = dancePoseAt(13.4);
  assert.ok(out.armLZ > 1.0 && out.armRZ < -1.0, 'arms flung out');
  let maxChest = -Infinity, minChest = Infinity;
  for (let t = 14.0; t < 14.9; t += 0.02) {
    const c = dancePoseAt(t).chest;
    maxChest = Math.max(maxChest, c); minChest = Math.min(minChest, c);
  }
  assert.ok(maxChest - minChest > 0.15, 'shimmy oscillates the chest/shoulders');
});

ok('squat (15–18 s): deep wide sumo with bouncing drop', () => {
  const s = dancePoseAt(16.5);
  assert.ok(s.drop > 0.3, 'deep squat');
  assert.ok(s.stanceL > 0.4 && s.stanceR < -0.4, 'sumo width');
  assert.ok(s.legL < -1.0 && s.kneeL > 1.8, 'thighs and shins folded');
  let maxD = -Infinity, minD = Infinity;
  for (let t = 15.5; t < 17.5; t += 0.05) {
    const d = dancePoseAt(t).drop;
    maxD = Math.max(maxD, d); minD = Math.min(minD, d);
  }
  assert.ok(maxD - minD > 0.04, 'hips bounce on the beat');
});

ok('rise (18–19 s): returns toward standing', () => {
  const a = dancePoseAt(18.1), b = dancePoseAt(18.9);
  assert.ok(b.drop < a.drop, 'rising out of the squat');
  assert.ok(b.drop < 0.15);
});

ok('poseAt is deterministic and returns every STAND key', () => {
  const keys = Object.keys(dancePoseAt(0)).sort();
  for (const t of [0, 1, 4, 8, 12, 16, 18.5]) {
    const p = dancePoseAt(t);
    assert.deepEqual(Object.keys(p).sort(), keys);
    assert.deepEqual(dancePoseAt(t), p);
  }
});

console.log(`\ndance: ${n} checks OK`);
