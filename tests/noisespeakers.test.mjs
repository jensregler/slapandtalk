// Noise-room speakers (Jens t872u): the zone curve and the shared schedule (shared/noisespeakers.mjs).
import assert from 'node:assert/strict';
import { NOISE_SPEAKERS as Z, NOISE_INSIDE as I, NOISE_WIDTH as W, SPEAKERS, zoneGain, speakerGain, speakerTrackAt, inNoiseRoom } from '../shared/noisespeakers.mjs';
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
ok('silent outside the room (doorway, street, other rooms)', () => {
  for (const [x, z] of [[0, I.z1 + 0.5], [0, 17], [-32, 0], [I.x0 - 0.1, zc], [I.x1 + 0.1, zc]]) { assert.ok(!inNoiseRoom(x, z)); assert.equal(speakerGain('A', x, z), 0); assert.equal(speakerGain('B', x, z), 0); }
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
