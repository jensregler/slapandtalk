// Runway dance choreography (shared/dance.mjs; Jens t540u, 5 Nov 2026).
// Pure maths – no browser, no GLB. Run: node tests/dance.test.mjs
import assert from 'assert/strict';
import { DANCE, SECTIONS, dancePoseAt, dancePhase, danceGrid, danceDuration, danceBeats } from '../shared/dance.mjs';
// The keyframe checks below were written on the old 19 s timeline: T(old s) = the same moment in
// the 4-bar routine at the 90 BPM fallback (no lead-in), P = the pose there.
const OLD = [0, 3, 5, 9, 11, 13, 15, 18, 19];
const T = (o) => { for (let i = 0; i < SECTIONS.length; i++) if (o < OLD[i + 1] || i === SECTIONS.length - 1) { const [, a, z] = SECTIONS[i]; return (a + (z - a) * Math.min(1, (o - OLD[i]) / (OLD[i + 1] - OLD[i]))) * (60 / 90); } };

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

ok('4 bars of 4/4 on the clock: 16 beats, 10.7 s at 90 BPM; the desktop key is X', () => {
  assert.equal(DANCE.beats, 16); assert.equal(DANCE.bars * DANCE.beatsPerBar, 16);
  assert.equal(DANCE.key, 'KeyX');
  assert.ok(near(danceDuration(null), 16 * 60 / 90));
  assert.ok(near(danceDuration(danceGrid(0, { bpm: 120, phaseMs: 0 })), 8), '120 BPM: 8 s');
  assert.equal(SECTIONS.at(-1)[2], 16);
  for (const [, a, z] of SECTIONS) assert.ok(Number.isInteger(a) && Number.isInteger(z) && z > a, 'sections on whole beats');
});

ok('phases in order (strut, pops, knee drop, hold, pop-up, flair, squat, rise)', () => {
  const b = (x) => x * 60 / 90;
  assert.equal(dancePhase(-1), 'idle');
  assert.deepEqual([0.5, 2.5, 4.5, 6.5, 7.5, 9.5, 12, 15.5].map((x) => dancePhase(b(x))), ['approach', 'pops', 'kneel', 'kneel-pause', 'popup', 'flair', 'squat', 'rise']);
  assert.equal(dancePhase(b(16)), 'done'); assert.equal(dancePhase(30), 'done');
  const g = danceGrid(100, { bpm: 90, phaseMs: 0 }); // 100 ms into a beat: the dance waits for the next beat
  assert.equal(dancePhase(0.2, g), 'lead-in'); assert.equal(dancePhase(g.lead + 0.01, g), 'approach');
});

ok('t=0 is a standing pose (no drop, soft knees)', () => {
  const p = dancePoseAt(0);
  assert.ok(near(p.drop, 0));
  assert.ok(p.kneeL >= 0 && p.kneeL < 0.3);
  assert.ok(p.kneeR >= 0 && p.kneeR < 0.3);
});

ok('approach (0–3 s): arms asymmetric (right across chest), legs alternate', () => {
  const a = dancePoseAt(T(1.25)), b = dancePoseAt(T(1.75));
  assert.ok(a.armRX < a.armLX - 0.3, 'right arm more across the chest than the left');
  // legs should differ between half-strides (~0.5 s apart at 1 Hz)
  assert.ok(Math.abs(a.legL - b.legL) > 0.1 || Math.abs(a.legR - b.legR) > 0.1, 'strut alternates');
});

ok('pops (3–5 s): wide stance and chest isolation on the beat', () => {
  const wide = dancePoseAt(T(4.0));
  assert.ok(wide.stanceL > 0.2 && wide.stanceR < -0.2, 'feet apart');
  // sample a few beats – at least one frame has a clear chest pop above the settle
  let maxChest = -Infinity;
  for (let t = 3; t < 5; t += 0.05) maxChest = Math.max(maxChest, dancePoseAt(T(t)).chest);
  assert.ok(maxChest > 0.1, 'chest pops', maxChest);
});

ok('kneel (5–9 s): drop grows, knees fold hard, hands stay near the thighs (no floor plant)', () => {
  const early = dancePoseAt(T(5.2)), mid = dancePoseAt(T(7)), late = dancePoseAt(T(8.8));
  assert.ok(early.drop < mid.drop && mid.drop <= late.drop + 0.05, 'drop increases into the kneel');
  assert.ok(late.drop > 0.5, 'knees reach the floor (drop > 0.5 m)');
  assert.ok(late.kneeL > 1.8 && late.kneeR > 1.8, 'shins folded under');
  assert.ok(late.lean < 0, 'slight lean back');
  // arms not reaching down to the floor (forearm bend modest, upper arms not plunged)
  assert.ok(late.armLX > -1.0 && late.armRX > -1.0, 'hands stay by the thighs, not planted');
});

ok('kneel-pause (9–11 s): stays low', () => {
  const p = dancePoseAt(T(10));
  assert.ok(p.drop > 0.5);
  assert.equal(dancePhase(T(10)), 'kneel-pause');
});

ok('popup (11–13 s): anticipation dip then explosive rise; drop returns near standing', () => {
  const dip = dancePoseAt(T(11.3));
  const mid = dancePoseAt(T(11.9));
  const land = dancePoseAt(T(12.7));
  assert.ok(dip.drop >= dancePoseAt(T(11)).drop - 0.01, 'anticipation dips or holds');
  assert.ok(mid.drop < dip.drop - 0.25, 'explosive rise recovers height');
  assert.ok(land.drop < 0.15, 'lands near standing height');
  assert.ok(land.stanceL > 0.3 && land.stanceR < -0.3, 'feet slide out to catch the weight');
});

ok('flair + shimmy (13–15 s): arms thrown wide then shoulders roll', () => {
  const out = dancePoseAt(T(13.4));
  assert.ok(out.armLZ > 1.0 && out.armRZ < -1.0, 'arms flung out');
  let maxChest = -Infinity, minChest = Infinity;
  for (let t = 14.0; t < 14.9; t += 0.02) {
    const c = dancePoseAt(T(t)).chest;
    maxChest = Math.max(maxChest, c); minChest = Math.min(minChest, c);
  }
  assert.ok(maxChest - minChest > 0.15, 'shimmy oscillates the chest/shoulders');
});

ok('squat (15–18 s): deep wide sumo with bouncing drop', () => {
  const s = dancePoseAt(T(16.5));
  assert.ok(s.drop > 0.3, 'deep squat');
  assert.ok(s.stanceL > 0.4 && s.stanceR < -0.4, 'sumo width');
  assert.ok(s.legL < -1.0 && s.kneeL > 1.8, 'thighs and shins folded');
  let maxD = -Infinity, minD = Infinity;
  for (let t = 15.5; t < 17.5; t += 0.05) {
    const d = dancePoseAt(T(t)).drop;
    maxD = Math.max(maxD, d); minD = Math.min(minD, d);
  }
  assert.ok(maxD - minD > 0.04, 'hips bounce on the beat');
});

ok('rise (18–19 s): returns toward standing', () => {
  const a = dancePoseAt(T(18.1)), b = dancePoseAt(T(18.9));
  assert.ok(b.drop < a.drop, 'rising out of the squat');
  assert.ok(b.drop < 0.15);
});

ok('poseAt is deterministic and returns every STAND key', () => {
  const keys = Object.keys(dancePoseAt(0)).sort();
  for (const t of [0, 1, 2.5, 4, 6, 8, 10]) {
    const p = dancePoseAt(t);
    assert.deepEqual(Object.keys(p).sort(), keys);
    assert.deepEqual(dancePoseAt(t), p);
  }
});

ok('tempo: follows the master clock, starts on its next beat, every beat-driven move on its beats', () => {
  const g = danceGrid(250, { bpm: 90, phaseMs: 0 });
  assert.ok(near(g.beat, 60 / 90) && near(g.lead, 60 / 90 - 0.25, 1e-9), 'lead-in to the next clock beat');
  assert.ok(near(danceGrid(0, { bpm: 90, phaseMs: 0 }).lead, 0), 'pressed on a beat: starts at once');
  const onBeat = (gr, t) => { const b = danceBeats(t, gr); return near(b, Math.round(b), 1e-6); };
  // every section boundary is a clock beat: (press time + t − phase) is a whole number of beats
  const press = 123456.7, tempo = { bpm: 91.3, phaseMs: 7 }, gg = danceGrid(press, tempo);
  for (const [, a] of SECTIONS) { const tw = press + (gg.lead + a * gg.beat) * 1000; const k = (tw - 7) / (60000 / 91.3); assert.ok(near(k, Math.round(k), 1e-6), 'section start on a clock beat'); }
  assert.ok(onBeat(gg, gg.lead));
  // extreme tempos: half / double time
  assert.ok(near(danceGrid(0, { bpm: 400, phaseMs: 0 }).bpm, 100)); assert.ok(near(danceGrid(0, { bpm: 200, phaseMs: 0 }).bpm, 100));
  assert.ok(near(danceGrid(0, { bpm: 40, phaseMs: 0 }).bpm, 80)); assert.ok(near(danceGrid(0, { bpm: 180, phaseMs: 0 }).bpm, 180));
  assert.ok(near(danceGrid(0, null).bpm, 90), 'no clock: 90 BPM');
  // the chest pops peak right after each clock beat (2 pops in the pops section)
  const G = { beat: 60 / 90, lead: 0.1 };
  for (const k of [2, 3]) {
    const tb = G.lead + k * G.beat;
    assert.ok(dancePoseAt(tb + 0.18 * G.beat, G).chest > dancePoseAt(tb + 0.7 * G.beat, G).chest + 0.1, `pop on beat ${k}`);
  }
  // squat hip bounce: lowest (highest drop) mid-beat, back up on the beat
  const sq = (x) => dancePoseAt(G.lead + x * G.beat, G).drop;
  assert.ok(sq(12.5) > sq(12.02) + 0.03 && sq(13.5) > sq(13.02) + 0.03, 'bounces on the beat');
  // the same press on two screens (same at + clock): the same pose at the same moment
  const a1 = danceGrid(press, tempo), a2 = danceGrid(press, { ...tempo });
  for (const t of [1, 3.3, 6.1, 9.9]) assert.deepEqual(dancePoseAt(t, a1), dancePoseAt(t, a2));
});

ok('cancel: the pose after stopping is standing (Avatar.stopDance restores the rest pose)', () => {
  assert.deepEqual(dancePoseAt(danceDuration(null)), dancePoseAt(0));
});

console.log(`\ndance: ${n} checks OK`);
