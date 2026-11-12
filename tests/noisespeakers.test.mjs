// Noise-room speakers (Jens t872u): the zone curve and the shared schedule (shared/noisespeakers.mjs).
import assert from 'node:assert/strict';
import { NOISE_SPEAKERS as Z, NOISE_INSIDE as I, NOISE_WIDTH as W, NOISE_DOOR as D, SPEAKERS, zoneGain, speakerGain, speakerTrackAt, inNoiseRoom, doorDistance, noiseActive } from '../shared/noisespeakers.mjs';
let n = 0; const ok = (name, f) => { f(); n++; console.log('  ✓ ' + name); };
const at = (u) => I.x0 + u * W, zc = (I.z0 + I.z1) / 2;
ok('the room is plot 7 (x −7.6 … 7.6, z 24.4 … 39.6), A west, B east', () => { assert.equal(W, 15.2); assert.equal(SPEAKERS[0].id, 'A'); assert.ok(SPEAKERS[0].x < SPEAKERS[1].x); });
ok('zone curve: 100 % up to 2/3, 99 % → 0 % up to 8/9, silent after', () => {
  assert.equal(zoneGain(0), 1); assert.equal(zoneGain(0.5), 1); assert.equal(zoneGain(2 / 3), 1);
  assert.ok(Math.abs(zoneGain(2 / 3 + 1e-9) - 0.99) < 1e-6);
  assert.ok(Math.abs(zoneGain((2 / 3 + 8 / 9) / 2) - 0.495) < 1e-6);
  assert.equal(zoneGain(8 / 9), 0); assert.equal(zoneGain(0.95), 0); assert.equal(zoneGain(1), 0);
});
ok('west ninth: only A; middle third: both 100 %; east ninth: only B', () => {
  for (const u of [0.01, 0.05, 0.1]) { assert.equal(speakerGain('A', at(u), zc), 1); assert.equal(speakerGain('B', at(u), zc), 0); }
  for (const u of [0.34, 0.5, 0.66]) { assert.equal(speakerGain('A', at(u), zc), 1); assert.equal(speakerGain('B', at(u), zc), 1); }
  for (const u of [0.9, 0.95, 0.99]) { assert.equal(speakerGain('A', at(u), zc), 0); assert.equal(speakerGain('B', at(u), zc), 1); }
});
ok('only the x position matters inside (north wall = south opening)', () => { for (const z of [I.z0 + 0.1, zc, I.z1 - 0.1]) assert.equal(speakerGain('B', at(0.2), z), speakerGain('B', at(0.2), zc)); });
ok('door (t880u): the opening is x −2.2 … 2.2 at z 40 (outer face of the south wall)', () => { assert.deepEqual([D.x0, D.x1, D.zOut], [-2.2, 2.2, 40]); assert.equal(Z.doorRadius, 4); });
ok('door: radial 4 m in front of the opening – 0/1/2/3/4/5 m → 100/75/50/25/0/0 %, both speakers', () => {
  for (const [d, g] of [[0, 1], [1, 0.75], [2, 0.5], [3, 0.25], [4, 0], [5, 0]]) {
    assert.ok(Math.abs(speakerGain('A', 0, D.zOut + d) - g) < 1e-9, `A ${d} m`); assert.ok(Math.abs(speakerGain('B', 0, D.zOut + d) - g) < 1e-9, `B ${d} m`);
  }
  // radial round the opening's edge: 2 m out sideways from the east jamb, 2 m south of the west jamb, on a diagonal
  assert.ok(Math.abs(speakerGain('A', D.x1 + 2, D.zOut + 0.001) - 0.5) < 1e-3); assert.ok(Math.abs(speakerGain('B', D.x0, D.zOut + 2) - 0.5) < 1e-9);
  assert.ok(Math.abs(doorDistance(D.x1 + 3, D.zOut + 4) - 5) < 1e-9); assert.equal(speakerGain('A', D.x1 + 3, D.zOut + 4), 0);
  assert.equal(speakerGain('A', 0, 39.8), 1); // in the doorway itself (the wall's thickness)
});
ok('no sound through the walls: beside / behind the room, in a wall, other rooms, the street', () => {
  for (const [x, z] of [[I.x0 - 0.5, zc], [I.x1 + 0.5, zc], [I.x1 + 1, I.z1 - 0.2], [-9, 39], [0, I.z0 - 1], [5, 39.8], [0, 17], [-32, 0]]) {
    assert.equal(doorDistance(x, z), Infinity, `${x},${z}`); assert.equal(speakerGain('A', x, z), 0); assert.equal(speakerGain('B', x, z), 0);
  }
  assert.ok(noiseActive(0, 44.5) && !noiseActive(0, 45.5) && !noiseActive(9, zc));
});
ok('silent outside the room away from the door (street, other rooms)', () => {
  for (const [x, z] of [[0, D.zOut + 4.5], [0, 17], [-32, 0], [I.x0 - 0.1, zc], [I.x1 + 0.1, zc]]) { assert.ok(!inNoiseRoom(x, z)); assert.equal(speakerGain('A', x, z), 0); assert.equal(speakerGain('B', x, z), 0); }
});
const tracks = [{ file: 'a.mp3', duration: 9 }, { file: 'b.mp3', duration: 12 }, { file: 'c.mp3', duration: 7 }];
ok('schedule: the same for everyone (deterministic), A and B independent', () => {
  const t = Date.UTC(2026, 10, 12, 21, 0, 0);
  assert.deepEqual(speakerTrackAt(tracks, 'A', t), speakerTrackAt(tracks, 'A', t));
  let differ = 0; for (let k = 0; k < 50; k++) { const s = t + k * 10000; if (speakerTrackAt(tracks, 'A', s).track !== speakerTrackAt(tracks, 'B', s).track) differ++; }
  assert.ok(differ > 5, String(differ));
});
ok('schedule: back to back, never the same track twice in a row, random order', () => {
  const t0 = Date.UTC(2026, 10, 12, 18, 0, 0); let cur = speakerTrackAt(tracks, 'A', t0), seen = new Set([cur.track.file]), steps = 0;
  while (steps < 200) { const nx = speakerTrackAt(tracks, 'A', cur.endMs); assert.equal(nx.startMs, cur.endMs); assert.notEqual(nx.track, cur.track); seen.add(nx.track.file); cur = nx; steps++; }
  assert.equal(seen.size, 3);
  const s = speakerTrackAt(tracks, 'A', t0 + 4321); assert.ok(s.offsetSec >= 0 && s.offsetSec < s.track.duration);
});
ok('schedule: one track → it repeats; no tracks → null', () => { const one = [{ file: 'x.mp3', duration: 5 }]; const a = speakerTrackAt(one, 'A', 1e12); assert.equal(speakerTrackAt(one, 'A', a.endMs).track.file, 'x.mp3'); assert.equal(speakerTrackAt([], 'A', 1e12), null); });
console.log(`noisespeakers: ${n} ok`);
