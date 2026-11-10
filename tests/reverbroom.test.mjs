// The reverb room (plot 4) – Jens, voice 10 Nov 2026 (shared/reverbroom.mjs): three feedback points on the back
// (east) wall like the delay room (spatial feedback, gate, times on slap), three sines (rest 440 Hz, pitch from
// where I look, volume LFO 0…100 % at a rate from my distance to each point, rates locked while I stand still),
// the sines fade out when I look out through the opening; nothing outside the room.
import assert from 'node:assert/strict';
import * as C from '../shared/city.mjs';
import * as F from '../shared/cityfx.mjs';
import { DELAY_ROOM } from '../shared/delayroom.mjs';
import { REVERB_ROOM as R, insideReverbRoom, reverbRoomGate, reverbDistances, reverbVectors, reverbTimeFor, reverbTimesAt, reverbFeedbackAt,
  lfoRateFor, reverbLfoRatesAt, reverbGazeAt, reverbGazeYaw, reverbLookAt, reverbPitchesAt, reverbLfoLock, reverbRoomTimes } from '../shared/reverbroom.mjs';
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const p4 = C.FX_ROOMS.find((p) => p.n === 4);
// yaw for a look direction (forward = (−sin yaw, −cos yaw))
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

ok('plot 4 = the reverb room, open to the west; inner box from the opening (x −40) to the back wall (x −24.4)', () => {
  assert.equal(p4.fx, 'reverb'); assert.equal(p4.x, -32); assert.equal(p4.z, 0);
  assert.ok(near(R.box.x0, -40) && near(R.box.x1, -24.4) && near(R.box.z0, -7.6) && near(R.box.z1, 7.6), JSON.stringify(R.box));
  assert.ok(near(R.diagonal, Math.hypot(15.6, 15.2)) && near(R.diagonal, DELAY_ROOM.diagonal), `diagonal ${R.diagonal}`);
  assert.ok(near(R.fbZero, 14.6, 1e-9) && R.fbFull === 8 && R.loopMax === 0.95 && R.openFade === 3);
});
ok('three points 1 m in from the back (east) wall and the side walls: 1 left (north, −z), 2 centre, 3 right (south, +z) looking in', () => {
  assert.deepEqual(R.points.map((p) => p.map((v) => +v.toFixed(6))), [[-25.4, -6.6], [-25.4, 0], [-25.4, 6.6]]);
  for (const [x, z] of R.points) assert.ok(insideReverbRoom(x, z));
  // looking in from the opening = facing +x: left is −z
  const fwd = [1, 0], left = [fwd[1], -fwd[0]]; // rotate 90° to the left in x/z (+z = south)
  assert.ok(R.points[0][1] * left[1] > 0 && R.points[2][1] * left[1] < 0, 'point 1 on my left, point 3 on my right');
});
ok('times: 10 ms at a point, 1 s at the diagonal, linear (t = 0.010 + 0.99·d/diagonal), clamped', () => {
  assert.equal(reverbTimeFor(0), 0.010); assert.equal(reverbTimeFor(R.diagonal), 1.0);
  assert.equal(reverbTimeFor(R.diagonal * 2), 1.0); assert.equal(reverbTimeFor(-3), 0.010); assert.equal(reverbTimeFor(NaN), 1.0);
  for (const [i, [x, z]] of R.points.entries()) {
    const t = reverbTimesAt(x, z), d = reverbDistances(x, z); assert.equal(t[i], 0.010);
    for (let k = 0; k < 3; k++) assert.ok(near(t[k], 0.010 + 0.99 * d[k] / R.diagonal));
  }
  const far = reverbTimesAt(R.box.x0 + 0.01, R.box.z1 - 0.01); assert.ok(far[0] > 0.9, String(far)); // far corner ↔ point 1
});
ok('feedback: all three 100 % mid-room toward the back, 0 % at the opening, smooth and monotone in between', () => {
  assert.deepEqual(reverbFeedbackAt(-28, 0), [1, 1, 1]);
  let all = 0; for (let x = R.box.x0; x < R.box.x1; x += 0.25) for (let z = R.box.z0; z < R.box.z1; z += 0.25) if (reverbFeedbackAt(x, z).every((f) => f === 1)) all++;
  assert.ok(all > 40, `overlap zone ${all}`);
  for (let z = R.box.z0 + 0.01; z < R.box.z1; z += 0.2) assert.ok(reverbFeedbackAt(R.box.x0 + 1e-6, z).every((f) => f < 1e-6), `opening z=${z}`);
  for (const [i, [x, z]] of R.points.entries()) assert.equal(reverbFeedbackAt(x, z)[i], 1);
  let prev = null, worst = 0;
  for (let x = R.box.x1 - 0.05; x > R.box.x0; x -= 0.1) { const f = reverbFeedbackAt(x, 0.3); if (prev) for (let k = 0; k < 3; k++) { assert.ok(f[k] <= prev[k] + 1e-12); worst = Math.max(worst, prev[k] - f[k]); } prev = f; }
  assert.ok(worst < 0.03, `smooth ${worst}`);
  const mid = reverbFeedbackAt(-36, 0)[1]; assert.ok(mid > 0.05 && mid < 0.95, `a fade ${mid}`);
});
ok('NOTHING OUTSIDE THE ROOM: send, feedback, tones and zone 0 everywhere outside plot 4 (grid over the city)', () => {
  for (let x = -47.5; x <= 47.5; x += 0.5) for (let z = -47.5; z <= 47.5; z += 0.5) {
    if (insideReverbRoom(x, z)) continue;
    const v = F.cityFxAt(x, z);
    assert.ok(v.rvWet === 0 && v.rvTone === 0 && v.rvFb1 === 0 && v.rvFb2 === 0 && v.rvFb3 === 0 && reverbRoomGate(x, z) === 0 && !v.zones.fxReverb && reverbGazeAt(x, z, 1, 0) === 0, `${x},${z}`);
  }
  for (const p of C.FX_ROOMS.filter((q) => q.n !== 4)) { const v = F.cityFxAt(p.x, p.z); assert.ok(v.rvWet === 0 && v.rvTone === 0, `room ${p.n}`); }
  assert.equal(F.placeHouse().rvWet, 0); assert.equal(F.placeHouse().rvTone, 0); assert.equal(F.placeNeutral().rvTone, 0);
  // inside: on; fading over the last 3 m toward the opening
  const a = F.cityFxAt(-30, 0); assert.equal(a.rvWet, R.wet); assert.equal(a.rvTone, R.toneLevel);
  const e = F.cityFxAt(-39, 0); assert.ok(e.rvWet > 0 && e.rvWet < R.wet && e.rvTone < R.toneLevel);
  // inside only the three points ring: the street's small/big reverb is out; the delay room's delays are shut
  assert.ok(a.verbWet === 0 && a.roomWet === 0, JSON.stringify(a));
});
ok('the delay room is unchanged by the reverb room (same values as delayroom.mjs, no reverb-room values there)', () => {
  const v = F.cityFxAt(30, 0); assert.equal(v.roomWet, DELAY_ROOM.wet); assert.equal(v.rvWet, 0); assert.equal(v.rvTone, 0);
});
ok('no BPM: the room times are distance only', () => {
  const v = F.cityFxAt(-32, 3);
  assert.deepEqual([v.rvTime1, v.rvTime2, v.rvTime3], reverbTimesAt(-32, 3));
  for (const t of [v.rvTime1, v.rvTime2, v.rvTime3]) assert.ok(Math.abs(t - F.BEAT / 2) > 0.005 && Math.abs(t - F.BEAT * 3 / 4) > 0.005);
});
ok('held times: entry, walking keeps, slap from ME sets, outside slap ignored, re-entry resets', () => {
  const H = reverbRoomTimes();
  H.update(-46, 0); assert.equal(H.state.inside, false); assert.equal(H.slap(-46, 0), false);
  const entry = H.update(-39.5, 1); assert.deepEqual(entry, reverbTimesAt(-39.5, 1)); assert.equal(H.state.from, 'entry');
  assert.deepEqual(H.update(-30, -4), entry);
  assert.ok(H.slap(R.points[0][0], R.points[0][1])); const s1 = H.times; assert.equal(s1[0], 0.010); assert.equal(H.state.from, 'slap');
  assert.deepEqual(H.update(-36, 6), s1);
  assert.ok(H.slap(-33, 0)); assert.deepEqual(H.times, reverbTimesAt(-33, 0));
  H.update(-46, 0); H.update(-38, -2); assert.deepEqual(H.times, reverbTimesAt(-38, -2)); assert.equal(H.state.slapped, false); assert.equal(H.state.entries, 2);
});
ok('LFO rate from the me→point VECTOR length: 8 Hz on the point … 0.5 Hz at the diagonal, linear, clamped; follows me', () => {
  assert.equal(lfoRateFor([0, 0]), R.lfoMax); assert.equal(lfoRateFor([R.diagonal, 0]), R.lfoMin); assert.equal(lfoRateFor([0, R.diagonal * 3]), R.lfoMin);
  assert.ok(near(lfoRateFor([3, 4]), 8 - 7.5 * 5 / R.diagonal)); assert.ok(near(lfoRateFor([3, 4]), lfoRateFor([-4, 3])), 'length only');
  assert.equal(R.lfoDepth, 1, 'depth 0…100 %');
  const a = reverbLfoRatesAt(-26, -6), b = reverbLfoRatesAt(-38, 6);
  assert.ok(a[0] > a[2] && b[2] > b[0], 'the nearer point pulses faster'); assert.ok(a.some((r, i) => Math.abs(r - b[i]) > 1), 'changes when I move');
  const vs = reverbVectors(-30, 2); for (let k = 0; k < 3; k++) assert.ok(near(Math.hypot(...vs[k]), reverbDistances(-30, 2)[k]));
  const v = F.cityFxAt(-30, 2); assert.deepEqual([v.rvLfo1, v.rvLfo2, v.rvLfo3], reverbLfoRatesAt(-30, 2));
});
ok('pitch: rest 440 Hz looking at the back wall centre at eye height – from anywhere (the vector does NOT move the pitch)', () => {
  for (const [x, z] of [[-38, 0], [-30, 5], [-27, -6], [-35, -3]]) {
    const cx = R.box.x1, cz = 0, yaw = yawTo(cx - x, cz - z);
    const hz = reverbPitchesAt(x, z, yaw, 0, 1.7); assert.ok(hz.every((f) => Math.abs(f - 440) < 1e-6), `${x},${z}: ${hz}`);
  }
  assert.deepEqual([F.cityFxAt(-30, 2).rvHz1, F.cityFxAt(-38, -5).rvHz2], [440, 440], 'position alone never changes the pitch');
});
ok('pitch from the look: up/down → tone 1, how far right → tone 2, how far left → tone 3 (unfolded walls, 220 … 880 Hz)', () => {
  const x = -32, z = 0, east = yawTo(1, 0);
  const up = reverbPitchesAt(x, z, east, 0.6), down = reverbPitchesAt(x, z, east, -0.3);
  assert.ok(up[0] > 440 && down[0] < 440 && up[1] === 440 && up[2] === 440, `${up} / ${down}`);
  const right = reverbPitchesAt(x, z, yawTo(1, 0.8)), farRight = reverbPitchesAt(x, z, yawTo(0, 1)), left = reverbPitchesAt(x, z, yawTo(1, -0.8));
  assert.ok(right[1] > 440 && farRight[1] > right[1] && right[2] === 440, `${right} ${farRight}`);
  assert.ok(left[2] > 440 && left[1] === 440, String(left));
  assert.ok(Math.abs(reverbLookAt(x, z, east).s) < 1e-9 && reverbLookAt(x, z, yawTo(0, 1)).face === 'side');
  // continuous across the corner (back wall → side wall)
  let prev = null; for (let a = -0.3; a <= 0.3; a += 0.002) { const c = Math.atan2(7.6, 7.6); const s = reverbLookAt(x, z, yawTo(Math.cos(c + a), Math.sin(c + a))).s; if (prev !== null) assert.ok(Math.abs(s - prev) < 0.02); prev = s; }
  for (let k = 0; k < 50; k++) { const hz = reverbPitchesAt(-39 + k * 0.28, -7 + k * 0.28, k * 0.7, Math.sin(k) * 1.4); assert.ok(hz.every((f) => f >= 220 && f <= 880)); }
});
ok('LOOK-OUT FADE: back wall = 1, toward the side walls\' open ends = reduced, out through the opening = 0; smooth', () => {
  const x = -32, z = 0;
  assert.equal(reverbGazeAt(x, z, 1, 0), 1, 'back wall');
  assert.equal(reverbGazeAt(x, z, -1, 0), 0, 'straight out');
  assert.equal(reverbGazeAt(x, z, 0, 1), 1, 'side wall far from its end');
  // the side wall hit 1 m from the open end: x = −39 → reduced
  const g = reverbGazeAt(x, z, (-39 - x) / 7.6, 1); assert.ok(g > 0 && g < 1, `edge ${g}`);
  // sweep from looking south to looking west (out): never rises, ends at 0, no jump
  let prev = 1, worst = 0; for (let a = 0; a <= Math.PI / 2; a += 0.002) { const v = reverbGazeAt(x, z, -Math.sin(a), Math.cos(a)); assert.ok(v <= prev + 1e-12); worst = Math.max(worst, prev - v); prev = v; }
  assert.equal(prev, 0); assert.ok(worst < 0.05, `smooth ${worst}`);
  assert.equal(reverbGazeYaw(x, z, yawTo(1, 0)), 1); assert.equal(reverbGazeYaw(x, z, yawTo(-1, 0)), 0);
  assert.equal(reverbGazeAt(-46, 0, 1, 0), 0, 'outside: 0 even when looking in');
});
ok('STANDING STILL locks the LFO rates (walking test); look/pitch stay free; walking again follows the live vectors', () => {
  const L = reverbLfoLock();
  L.update(-46, 0, true); assert.equal(L.state.inside, false);
  const ent = L.update(-38, 5, false); assert.deepEqual(ent, reverbLfoRatesAt(-38, 5), 'entering takes the live rates (even after a teleport)');
  L.update(-34, 3, true); const A = L.update(-30, -5, true); assert.deepEqual(A, reverbLfoRatesAt(-30, -5));
  assert.ok(Math.abs(A[0] - A[2]) > 1, 'rates differ per point');
  const held = L.update(-30, -5, false); assert.deepEqual(held, A); assert.equal(L.state.locked, true);
  assert.deepEqual(L.update(-27, 6, false), A, 'not walking (e.g. moved without walking): still locked');
  // …while the look keeps changing the pitch (pure function of the look)
  assert.notDeepEqual(reverbPitchesAt(-30, -5, yawTo(1, 0), 0.5), reverbPitchesAt(-30, -5, yawTo(1, 0.9), -0.2));
  const B = L.update(-36, 2, true); assert.deepEqual(B, reverbLfoRatesAt(-36, 2)); assert.equal(L.state.locked, false);
  L.update(-46, 0, false); assert.deepEqual(L.rates, reverbLfoRatesAt(-46, 0), 'outside: live (silent anyway)');
  // feedback / times are NOT locked: they're pure functions of position (cityFxAt) and of slaps (reverbRoomTimes)
  assert.notDeepEqual(reverbFeedbackAt(-27, 0), reverbFeedbackAt(-38, 0));
});
console.log(`reverbroom: ${n} checks ✓`);
