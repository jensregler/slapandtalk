// The reverb room (plot 4) – Jens, voice 10 Nov 2026, corrected t808u–t812u (shared/reverbroom.mjs): three points
// on the back (east) wall, one sine per point (pitch from where I look on the unfolded walls, log 20 … 2000 Hz) with ONE sine volume LFO each,
// always 0…100 %, whose FREQUENCY is my distance to the point (2 Hz on it … 1000 Hz at the diagonal) – nothing
// else follows that distance (no distance feedback, no slap times, no send × gate law). The sines fade out when I
// look out through the opening; a plain fixed room reverb inside; nothing outside the room.
import assert from 'node:assert/strict';
import * as C from '../shared/city.mjs';
import * as F from '../shared/cityfx.mjs';
import * as RR from '../shared/reverbroom.mjs';
import { DELAY_ROOM } from '../shared/delayroom.mjs';
import { REVERB_ROOM as R, insideReverbRoom, reverbRoomPresence, reverbDistances, reverbVectors,
  lfoRateFor, reverbLfoRatesAt, reverbGazeAt, reverbGazeYaw, reverbLookAt, reverbPitchesAt } from '../shared/reverbroom.mjs';
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const p4 = C.FX_ROOMS.find((p) => p.n === 4);
// yaw for a look direction (forward = (−sin yaw, −cos yaw))
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

ok('plot 4 = the reverb room, open to the west; inner box from the opening (x −40) to the back wall (x −24.4)', () => {
  assert.equal(p4.fx, 'reverb'); assert.equal(p4.x, -32); assert.equal(p4.z, 0);
  assert.ok(near(R.box.x0, -40) && near(R.box.x1, -24.4) && near(R.box.z0, -7.6) && near(R.box.z1, 7.6), JSON.stringify(R.box));
  assert.ok(near(R.diagonal, Math.hypot(15.6, 15.2)) && near(R.diagonal, DELAY_ROOM.diagonal) && near(R.diagonal, 21.78, 0.01), `diagonal ${R.diagonal}`);
});
ok('three points 1 m in from the back (east) wall and the side walls: 1 left (north, −z), 2 centre, 3 right (south, +z) looking in', () => {
  assert.deepEqual(R.points.map((p) => p.map((v) => +v.toFixed(6))), [[-25.4, -6.6], [-25.4, 0], [-25.4, 6.6]]);
  for (const [x, z] of R.points) assert.ok(insideReverbRoom(x, z));
  const fwd = [1, 0], left = [fwd[1], -fwd[0]]; // looking in from the opening = facing +x: left is −z
  assert.ok(R.points[0][1] * left[1] > 0 && R.points[2][1] * left[1] < 0, 'point 1 on my left, point 3 on my right');
});
ok('the rejected delay-room law is gone: no distance feedback, no slap / held times, no 3 m gate, no LFO lock', () => {
  for (const k of ['reverbFeedbackAt', 'reverbTimesAt', 'reverbTimeFor', 'reverbRoomTimes', 'reverbRoomGate', 'reverbLfoLock']) assert.equal(RR[k], undefined, k);
  for (const k of ['fbFull', 'fbZero', 'openFade', 'loopMax', 'minTime', 'maxTime']) assert.equal(R[k], undefined, k);
  for (const k of ['rvFb1', 'rvFb2', 'rvFb3', 'rvTime1', 'rvTime2', 'rvTime3']) { assert.ok(!(k in F.PLACE), k); assert.ok(!(k in F.cityFxAt(-30, 0)), k); }
});
ok('VOLUME-LFO FREQUENCY = my distance to the point: 2 Hz on it … 1000 Hz at the diagonal (or further), linear, further = faster', () => {
  assert.equal(R.lfoMin, 2); assert.equal(R.lfoMax, 1000); assert.equal(R.lfoDepth, 1, 'depth always 0…100 %');
  assert.equal(lfoRateFor([0, 0]), 2); assert.equal(lfoRateFor(0), 2); assert.equal(lfoRateFor([R.diagonal, 0]), 1000);
  assert.equal(lfoRateFor([0, R.diagonal * 3]), 1000); assert.equal(lfoRateFor(-4), 2); assert.equal(lfoRateFor(NaN), 1000);
  for (const d of [0.5, 3, 7.25, 10.89, 15, 21]) assert.ok(near(lfoRateFor(d), 2 + 998 * d / R.diagonal), `d=${d}`);
  assert.ok(near(lfoRateFor([3, 4]), lfoRateFor([-4, 3])), 'length only');
  let prev = 0; for (let d = 0; d <= 30; d += 0.1) { const f = lfoRateFor(d); assert.ok(f >= prev && f >= 2 && f <= 1000); prev = f; }
  for (const [i, [x, z]] of R.points.entries()) assert.equal(reverbLfoRatesAt(x, z)[i], 2, `on point ${i + 1}`);
  const a = reverbLfoRatesAt(-26, -6), b = reverbLfoRatesAt(-38, 6);
  assert.ok(a[0] < a[2] && b[2] < b[0], 'the nearer point pulses slower'); assert.ok(a.some((r, i) => Math.abs(r - b[i]) > 10), 'changes when I move');
  const vs = reverbVectors(-30, 2); for (let k = 0; k < 3; k++) assert.ok(near(Math.hypot(...vs[k]), reverbDistances(-30, 2)[k]));
  const v = F.cityFxAt(-30, 2); assert.deepEqual([v.rvLfo1, v.rvLfo2, v.rvLfo3], reverbLfoRatesAt(-30, 2));
  // the far corner by the opening ↔ point 3 (~20.4 m, the points sit 1 m in) → ~935 Hz
  { const f = reverbLfoRatesAt(R.box.x0 + 0.01, R.box.z0 + 0.01)[2], d = reverbDistances(R.box.x0 + 0.01, R.box.z0 + 0.01)[2]; assert.ok(f > 900 && near(f, 2 + 998 * d / R.diagonal), String(f)); }
});
ok('the distance drives ONLY the LFO frequency: send and tone level are flat everywhere inside (no fade with distance)', () => {
  for (let x = R.box.x0 + R.presenceFade; x < R.box.x1; x += 0.5) for (let z = R.box.z0 + 0.05; z < R.box.z1; z += 0.5) {
    const v = F.cityFxAt(x, z);
    assert.ok(v.rvWet === R.wet && v.rvTone === R.toneLevel && reverbRoomPresence(x, z) === 1, `${x},${z} ${v.rvWet} ${v.rvTone}`);
  }
  // no 3 m gate: only a short 2 m step just inside the opening (so walking in / out never clicks); full beyond it
  assert.equal(R.presenceFade, 2); assert.equal(F.cityFxAt(R.box.x0 + 2, 0).rvWet, R.wet); assert.equal(F.cityFxAt(R.box.x0 + 2, 0).rvTone, R.toneLevel);
  const e = F.cityFxAt(R.box.x0 + 0.75, 0); assert.ok(e.rvWet > 0 && e.rvWet < R.wet, String(e.rvWet));
  let prev = 0; for (let x = R.box.x0 - 1; x < R.box.x0 + 3; x += 0.1) { const p = reverbRoomPresence(x, 0); assert.ok(p >= prev - 1e-12 && p - prev < 0.08, `${x}: ${p}`); prev = p; }
});
ok('NOTHING OUTSIDE THE ROOM: send, tones and zone 0 everywhere outside plot 4 (grid over the city)', () => {
  for (let x = -47.5; x <= 47.5; x += 0.5) for (let z = -47.5; z <= 47.5; z += 0.5) {
    if (insideReverbRoom(x, z)) continue;
    const v = F.cityFxAt(x, z);
    assert.ok(v.rvWet === 0 && v.rvTone === 0 && reverbRoomPresence(x, z) === 0 && !v.zones.fxReverb && reverbGazeAt(x, z, 1, 0) === 0, `${x},${z}`);
  }
  for (const p of C.FX_ROOMS.filter((q) => q.n !== 4)) { const v = F.cityFxAt(p.x, p.z); assert.ok(v.rvWet === 0 && v.rvTone === 0, `room ${p.n}`); }
  assert.equal(F.placeHouse().rvWet, 0); assert.equal(F.placeHouse().rvTone, 0); assert.equal(F.placeNeutral().rvTone, 0);
  // inside: the room's own fixed reverb; the street's small/big reverb is out; the delay room's delays are shut
  const a = F.cityFxAt(-30, 0); assert.ok(a.verbWet === 0 && a.roomWet === 0, JSON.stringify(a));
});
ok('the room reverb is fixed (no distance, no slap): constant send, modest loop gain, short fixed pre-delays', () => {
  assert.ok(R.wet > 0 && R.wet <= 0.5 && R.loopGain > 0 && R.loopGain <= 0.6, `${R.wet} ${R.loopGain}`);
  assert.equal(R.preTimes.length, 3); assert.ok(R.preTimes.every((t) => t > 0.005 && t < R.maxPre));
});
ok('the delay room is unchanged by the reverb room (same values as delayroom.mjs, no reverb-room values there)', () => {
  const v = F.cityFxAt(30, 0); assert.equal(v.roomWet, DELAY_ROOM.wet); assert.equal(v.rvWet, 0); assert.equal(v.rvTone, 0);
});
ok('pitch: rest 200 / 2000 / 2000 Hz looking at the back wall centre (B) at eye height – from anywhere (the vector does NOT move the pitch)', () => {
  assert.equal(R.toneMinHz, 20); assert.equal(R.toneMaxHz, 2000); assert.deepEqual([...R.restHz], [200, 2000, 2000]);
  for (const [x, z] of [[-38, 0], [-30, 5], [-27, -6], [-35, -3]]) {
    const cx = R.box.x1, cz = 0, yaw = yawTo(cx - x, cz - z);
    const hz = reverbPitchesAt(x, z, yaw, 0, 1.7); assert.ok(near(hz[0], 200, 1e-6) && near(hz[1], 2000, 1e-6) && near(hz[2], 2000, 1e-6), `${x},${z}: ${hz}`);
  }
  assert.deepEqual([F.cityFxAt(-30, 2).rvHz1, F.cityFxAt(-38, -5).rvHz2, F.cityFxAt(-38, -5).rvHz3], [200, 2000, 2000], 'position alone never changes the pitch');
  assert.deepEqual([F.placeNeutral().rvHz1, F.placeNeutral().rvHz2, F.placeNeutral().rvHz3], [200, 2000, 2000]);
});
ok('pitch from the look, log 20 … 2000 Hz: floor 20 / eye 200 / roof 2000 (tone 1); B 2000 → A 20 (tone 2, right); B 2000 → C 20 (tone 3, left)', () => {
  const x = -32, z = 0, east = yawTo(1, 0);
  const up = reverbPitchesAt(x, z, east, 0.6), down = reverbPitchesAt(x, z, east, -0.3);
  assert.ok(up[0] > 200 && down[0] < 200 && near(up[1], 2000, 1e-6) && near(up[2], 2000, 1e-6), `${up} / ${down}`);
  assert.ok(near(reverbPitchesAt(x, z, east, 1.5)[0], 2000, 1e-6) && near(reverbPitchesAt(x, z, east, -1.5)[0], 20, 1e-6), 'roof 2000, floor 20');
  const right = reverbPitchesAt(x, z, yawTo(1, 0.8)), farRight = reverbPitchesAt(x, z, yawTo(0, 1)), left = reverbPitchesAt(x, z, yawTo(1, -0.8));
  assert.ok(right[1] < 2000 && farRight[1] < right[1] && near(right[2], 2000, 1e-6), `${right} ${farRight}`);
  assert.ok(left[2] < 2000 && near(left[1], 2000, 1e-6), String(left));
  // the opening ends: A = the right (south, +z) jamb, C = the left (north, −z) jamb → 20 Hz
  const jA = reverbPitchesAt(x, z, yawTo(R.box.x0 + 1e-4 - x, R.box.z1 - z)), jC = reverbPitchesAt(x, z, yawTo(R.box.x0 + 1e-4 - x, R.box.z0 - z));
  assert.ok(near(jA[1], 20, 0.01) && near(jA[2], 2000, 1e-6) && near(jC[2], 20, 0.01) && near(jC[1], 2000, 1e-6), `${jA} / ${jC}`);
  // exactly the formulas, for any look
  for (let k = 0; k < 200; k++) {
    const px = -39.5 + (k * 0.37) % 15, pz = -7 + (k * 0.53) % 14, yaw = k * 0.71, pitch = Math.sin(k) * 1.4;
    const L = reverbLookAt(px, pz, yaw, pitch, 1.7), hz = reverbPitchesAt(px, pz, yaw, pitch, 1.7);
    const want = [20 * Math.pow(100, (L.h + 1) / 2), 2000 * Math.pow(0.01, Math.max(0, L.s)), 2000 * Math.pow(0.01, Math.max(0, -L.s))];
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(hz[i] - want[i]) <= want[i] * 1e-9 && hz[i] >= 20 && hz[i] <= 2000, `${k}: ${hz} vs ${want}`);
  }
  assert.ok(Math.abs(reverbLookAt(x, z, east).s) < 1e-9 && reverbLookAt(x, z, yawTo(0, 1)).face === 'side');
  // continuous across the corner (back wall → side wall)
  let prev = null; for (let a = -0.3; a <= 0.3; a += 0.002) { const c = Math.atan2(7.6, 7.6); const s = reverbLookAt(x, z, yawTo(Math.cos(c + a), Math.sin(c + a))).s; if (prev !== null) assert.ok(Math.abs(s - prev) < 0.02); prev = s; }
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
console.log(`reverbroom: ${n} checks ✓`);
