// Looping dance + dancing counts as walking (Jens t814u, 11 Nov 2026):
// "när man trycker x så skall dansen loopa ända tills man trycker x. när man dansar räknas det som
// att gå så gåljudet och ev sequenser går så länge man dansar". Pure maths + the footstep groove
// with a fake sound (no browser). Run: node tests/danceloop.test.mjs
import assert from 'assert/strict';
import { DANCE, danceGrid, danceDuration, danceLoopTime, danceLoops, danceBeats, dancePoseAt, dancePhase } from '../shared/dance.mjs';
import { GrooveSteps } from '../client/src/groove.js';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

ok('loop time: the first pass is unchanged (lead-in + 16 beats)', () => {
  const g = danceGrid(250, { bpm: 90, phaseMs: 0 });
  for (const t of [0, 0.1, g.lead, g.lead + 3.3, danceDuration(g) - 1e-3]) assert.ok(near(danceLoopTime(t, g), t), `t=${t}`);
  assert.equal(danceLoops(g.lead + 1, g), 0);
});

ok('loop time: wraps every 16 clock beats from the first beat – each new pass starts ON a clock beat (no drift)', () => {
  const press = 123456.7, tempo = { bpm: 91.3, phaseMs: 7 }, g = danceGrid(press, tempo), len = DANCE.beats * g.beat;
  for (let k = 1; k <= 50; k++) {
    const raw = g.lead + k * len; // the k-th seam
    const lt = danceLoopTime(raw, g), off = Math.min(Math.abs(lt - g.lead), Math.abs(lt - g.lead - len)); // (float: either side of the seam)
    assert.ok(off < 1e-6, `seam ${k} back at the first beat`);
    assert.ok(near(danceLoopTime(raw + 0.01, g), g.lead + 0.01, 1e-6), `just after seam ${k}`);
    assert.equal(danceLoops(raw + 1e-3, g), k);
    const wall = press + raw * 1000, beats = (wall - 7) / (60000 / 91.3);
    assert.ok(near(beats, Math.round(beats), 1e-4), `seam ${k} is a clock beat`);
    // and every beat inside the pass is still a clock beat
    const mid = raw + 5.5 * g.beat; assert.ok(near(danceBeats(danceLoopTime(mid, g), g), 5.5, 1e-6));
  }
  // never the lead-in again, never 'done'
  for (let t = danceDuration(g); t < danceDuration(g) + 5 * len; t += 0.137) { const p = dancePhase(danceLoopTime(t, g), g); assert.ok(p !== 'done' && p !== 'lead-in' && p !== 'idle', `${t}: ${p}`); }
});

ok('seamless seam: the pose just before and just after a seam are both (near) standing', () => {
  const g = danceGrid(0, { bpm: 90, phaseMs: 0 }), len = DANCE.beats * g.beat, seam = g.lead + len;
  const a = dancePoseAt(danceLoopTime(seam - 1e-4, g), g), b = dancePoseAt(danceLoopTime(seam + 1e-4, g), g);
  for (const k of Object.keys(a)) assert.ok(Math.abs(a[k] - b[k]) < 0.05, `${k}: ${a[k]} vs ${b[k]}`);
});

ok('no clock (90 BPM fallback) loops too', () => {
  const len = danceDuration(null);
  assert.ok(near(danceLoopTime(len * 3 + 1, null), 1));
  assert.equal(danceLoops(len * 3 + 1, null), 3);
});

// ---------- the footstep groove: dancing = walking ----------
const fakeSound = () => { const played = []; return { played, ctx: null, mine: { colour: 0 }, muted: false, engine: null, play: (k, at, o) => played.push({ k, ...o }), patchFor: () => ({ patch: { layers: [], gain: 1 } }) }; };
function stand(g, frames, from, { dancing = false, x = 0 } = {}) { let t = from; for (let i = 0; i < frames; i++) { t += 16; g.update([{ id: 'me', x, z: 0, at: null, dancing }], t); } return t; }

ok('dancing in place counts as walking: walkUntil stays ahead and the steps go on on the groove grid; moveUntil does not', () => {
  const s = fakeSound(), g = new GrooveSteps(s, { now: () => 0 }); clearInterval(g.watch);
  let t = 1e6; t = stand(g, 5, t); // standing: no steps
  assert.equal(s.played.length, 0);
  const me = g.track.get('me'); assert.ok(!(me.walkUntil > t));
  t = stand(g, 60 * 4, t, { dancing: true }); // 4 s of dancing
  assert.ok(me.walkUntil > t, 'walking while dancing');
  assert.ok(!((me.moveUntil || 0) > t), 'not "moving" (moveUntil = real movement only)');
  const steps = s.played.filter((p) => p.k === 'step');
  assert.ok(steps.length >= 8, `footsteps while dancing (${steps.length} in 4 s)`);
  // stop dancing: the same short hold as a real stop, then quiet
  const stopAt = t; t = stand(g, 1, t);
  assert.ok(me.walkUntil - stopAt <= 400 + 1, 'at most the usual hold after the dance stops');
  t = stand(g, 30, t); const after = s.played.length; t = stand(g, 120, t);
  assert.equal(s.played.length, after, 'silent after the dance is off');
  assert.ok(!(me.walkUntil > t));
});

ok('real walking still sets both walkUntil and moveUntil (unchanged)', () => {
  const s = fakeSound(), g = new GrooveSteps(s, { now: () => 0 }); clearInterval(g.watch);
  let t = 1e6, x = 0; g.update([{ id: 'me', x, z: 0, at: null }], t);
  for (let i = 0; i < 120; i++) { t += 16; x += 0.03; g.update([{ id: 'me', x, z: 0, at: null }], t); } // ~1.9 m/s
  const me = g.track.get('me'); assert.ok(me.walkUntil > t && me.moveUntil > t);
  assert.ok(s.played.length > 0);
});

console.log(`\ndanceloop: ${n} checks OK`);
