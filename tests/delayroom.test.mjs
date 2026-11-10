// The delay room (plot 5) – Jens's sketch + t790u, agreed 10 Nov 2026 (shared/delayroom.mjs):
// three delays on the back wall, spatial feedback (100 % zones overlapping mid-room, 0 % at the opening),
// no delay outside the room, times from MY distance to each delay on slap (10 ms … 1 s at the room's
// diagonal), held until the next slap, set on entry before the first slap; no 90 BPM.
import assert from 'node:assert/strict';
import * as C from '../shared/city.mjs';
import * as F from '../shared/cityfx.mjs';
import { DELAY_ROOM as R, insideDelayRoom, delayRoomGate, delayDistances, delayTimeFor, delayTimesAt, delayFeedbackAt, delayRoomTimes } from '../shared/delayroom.mjs';
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const p5 = C.FX_ROOMS.find((p) => p.n === 5);

ok('three delays on the back wall (west, opposite the east opening): 1 left (+z), 2 centre, 3 right (−z) seen from the entrance', () => {
  assert.equal(p5.fx, 'delay'); assert.equal(R.points.length, 3);
  const back = p5.x - C.HOUSE.width / 2 + C.WALL_T;
  for (const [x, z] of R.points) { assert.ok(x > back && x - back <= 1.5, `near the back wall: ${x}`); assert.ok(insideDelayRoom(x, z)); }
  assert.ok(R.points[0][1] > R.points[1][1] && R.points[1][1] > R.points[2][1], 'left → centre → right');
  assert.ok(near(R.points[1][1], p5.z) && near(R.points[0][1] - p5.z, p5.z - R.points[2][1]), 'centred, symmetric');
  assert.ok(near(R.diagonal, Math.hypot(R.box.x1 - R.box.x0, R.box.z1 - R.box.z0)) && R.diagonal > 20 && R.diagonal < 23, `the room's own diagonal ${R.diagonal}`);
});
ok('delay time: 10 ms at a delay point, 1 s at the room diagonal, linear and clamped', () => {
  assert.equal(delayTimeFor(0), 0.010); assert.equal(delayTimeFor(R.diagonal), 1.0);
  assert.ok(near(delayTimeFor(R.diagonal / 2), 0.010 + 0.99 / 2));
  assert.equal(delayTimeFor(R.diagonal * 3), 1.0); assert.equal(delayTimeFor(-1), 0.010);
  for (const [i, [x, z]] of R.points.entries()) {
    const t = delayTimesAt(x, z); assert.equal(t[i], 0.010, `standing at delay ${i + 1}`);
    const d = delayDistances(x, z); for (let k = 0; k < 3; k++) assert.ok(near(t[k], 0.010 + 0.99 * d[k] / R.diagonal), 'formula');
  }
  // standing at the opening's far corner: delay 3 (right/north) is ~ the diagonal away → ~1 s
  const far = delayTimesAt(R.box.x1 - 0.01, R.box.z1 - 0.01); assert.ok(far[2] > 0.9 && far[2] <= 1, String(far));
});
ok('feedback: mid-room all three at 100 % (the sketch\'s overlap), 0 % at the opening, smooth in between', () => {
  assert.deepEqual(delayFeedbackAt(28, p5.z), [1, 1, 1]);
  let all = 0; for (let x = R.box.x0; x < R.box.x1; x += 0.25) for (let z = R.box.z0; z < R.box.z1; z += 0.25) if (delayFeedbackAt(x, z).every((f) => f === 1)) all++;
  assert.ok(all > 40, `a real overlap zone (${all} grid points)`);
  for (let z = R.box.z0 + 0.01; z < R.box.z1; z += 0.2) assert.ok(delayFeedbackAt(R.box.x1 - 1e-6, z).every((f) => f < 1e-6), `opening z=${z}`);
  for (const [i, [x, z]] of R.points.entries()) assert.equal(delayFeedbackAt(x, z)[i], 1, `100 % at delay ${i + 1}`);
  // walking from the back wall to the opening: never rises, steps per 10 cm small
  let prev = null, worst = 0;
  for (let x = R.box.x0 + 0.05; x < R.box.x1; x += 0.1) { const f = delayFeedbackAt(x, 0.3); if (prev) for (let k = 0; k < 3; k++) { assert.ok(f[k] <= prev[k] + 1e-12); worst = Math.max(worst, prev[k] - f[k]); } prev = f; }
  assert.ok(worst < 0.03, `smooth: ${worst}`);
  const midway = delayFeedbackAt(36, 0)[1]; assert.ok(midway > 0.05 && midway < 0.95, `a fade, not a switch: ${midway}`);
});
ok('NO DELAY OUTSIDE THE ROOM: wet, feedback and the echo return are 0 everywhere outside (street, other rooms, houses)', () => {
  for (let x = -47.5; x <= 47.5; x += 0.5) for (let z = -47.5; z <= 47.5; z += 0.5) {
    if (insideDelayRoom(x, z)) continue;
    const v = F.cityFxAt(x, z);
    assert.ok(v.roomWet === 0 && v.roomFb1 === 0 && v.roomFb2 === 0 && v.roomFb3 === 0 && delayRoomGate(x, z) === 0 && !v.zones.fxDelay, `${x},${z}`);
  }
  for (const p of C.FX_ROOMS.filter((q) => q.n !== 5)) assert.equal(F.cityFxAt(p.x, p.z).roomWet, 0, `room ${p.n}`);
  assert.equal(F.placeHouse().roomWet, 0); assert.equal(F.placeNeutral().roomWet, 0);
  // inside: on, fading out over the last metres before the opening (no click when walking out)
  assert.equal(F.cityFxAt(30, 0).roomWet, R.wet); assert.ok(F.cityFxAt(39, 0).roomWet > 0 && F.cityFxAt(39, 0).roomWet < R.wet);
  // inside the room only the three delays echo – the street's delay A/B are out
  const v = F.cityFxAt(30, 0); assert.ok(v.delayWet === 0 && v.delay2Wet === 0 && v.delayFb === 0);
});
ok('no 90 BPM: the room\'s times are only distance (not ⅛ / dotted ⅛ of the master clock)', () => {
  const v = F.cityFxAt(32, 3);
  assert.deepEqual([v.roomTime1, v.roomTime2, v.roomTime3], delayTimesAt(32, 3));
  for (const t of [v.roomTime1, v.roomTime2, v.roomTime3]) assert.ok(Math.abs(t - F.BEAT / 2) > 0.005 && Math.abs(t - F.BEAT * 3 / 4) > 0.005);
});
ok('held times: set on entry, kept while walking, set by a slap (from ME), kept until the next slap; re-entry sets them again', () => {
  const H = delayRoomTimes();
  H.update(45, 0); assert.equal(H.state.inside, false);
  assert.equal(H.slap(45, 0), false, 'a slap outside the room does not touch its times');
  const entry = H.update(39.5, 1); assert.deepEqual(entry, delayTimesAt(39.5, 1)); assert.equal(H.state.from, 'entry');
  assert.deepEqual(H.update(30, -4), entry, 'walking in the room: times stay (before any slap: the entry times)');
  assert.ok(H.slap(R.points[0][0], R.points[0][1])); const s1 = H.times; assert.equal(s1[0], 0.010); assert.equal(H.state.from, 'slap');
  assert.deepEqual(H.update(36, 6), s1, 'walking after a slap: times stay'); assert.deepEqual(H.update(27, -6), s1);
  assert.ok(H.slap(33, 0)); assert.deepEqual(H.times, delayTimesAt(33, 0), 'the next slap: new times');
  const held = H.times; H.update(45, 0); assert.deepEqual(H.times, held, 'walking out keeps the last times (silent outside anyway)');
  H.update(38, -2); assert.deepEqual(H.times, delayTimesAt(38, -2), 'a new visit: times from where I walked in'); assert.equal(H.state.slapped, false); assert.equal(H.state.entries, 2);
});
console.log(`delayroom: ${n} checks ✓`);
