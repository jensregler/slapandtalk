// Peels in recordings (shared/replay.mjs): the floor at the start (header), new paper on stamp:add,
// peels:clear, room:peels on/off, image:remove, and an old recording without header.peelsOn.
// snapshotAt is a pure function of t, so seeking back and forth gives the same peels and ages.
import assert from 'node:assert/strict';
import { parseRecording, buildTimeline, snapshotAt } from '../shared/replay.mjs';

const img = (id) => ({ id, url: `/uploads/${id}.webp`, width: 100, height: 100 });
const peel = (id, imageId = 'i1') => ({ id, imageId, w: 0.3, h: 0.3, seed: id, start: [0, 0.9, 0], x: 0, z: -4, yaw: 0 });
const stampAdd = (t, id, imageId = 'i1', withPeel = true) => ({ t, e: 'stamp:add', stamp: { id, imageId, position: [0, 1, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.3 }, image: img(imageId), ...(withPeel ? { peel: peel(id, imageId) } : {}) });
const rec = (header, events) => parseRecording([JSON.stringify({ format: 'slapandtalk-rec', v: 1, ...header }), ...events.map((e) => JSON.stringify(e))].join('\n'));
const ids = (s) => s.peels.map((p) => p.peel.id).sort().join();
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('✔ ' + m); };

const tl = buildTimeline(rec({ peelsOn: true, peels: [peel('old')], images: { i1: img('i1') } }, [
  stampAdd(1000, 'a'), stampAdd(2000, 'b', 'i2'), stampAdd(2500, 'nopeel', 'i1', false),
  { t: 3000, e: 'room:peels', on: false }, { t: 4000, e: 'room:peels', on: true },
  { t: 5000, e: 'image:remove', id: 'i2' }, stampAdd(6000, 'c'), { t: 7000, e: 'peels:clear' }, stampAdd(8000, 'd'),
]));
const at = (t) => snapshotAt(tl, t);
ok(at(0).peelsOn && ids(at(0)) === 'old' && at(0).peels[0].age === Infinity, 'start: the header floor is there, already landed (age Infinity), peels on');
ok(ids(at(1500)) === 'a,old' && at(1500).peels.find((p) => p.peel.id === 'a').age === 500, 'stamp:add with a peel: falling, age = t − slap');
ok(ids(at(2600)) === 'a,b,old', 'a stamp:add without a peel adds no paper');
ok(!at(3500).peelsOn && ids(at(3500)) === 'a,b,old' && at(4500).peelsOn, 'room:peels off hides (paper kept), on shows it again');
ok(ids(at(5500)) === 'a,old', 'image:remove takes its paper too');
ok(ids(at(6500)) === 'a,c,old' && ids(at(7500)) === '' && ids(at(8500)) === 'd', 'peels:clear sweeps the floor, new paper after it');
const fwd = JSON.stringify(at(1500)); at(8500); at(0);
ok(JSON.stringify(at(1500)) === fwd, 'seek back and forth: the same peels and ages at the same t');

// An old recording: no header.peelsOn, but a peel on a stamp:add → peels were on.
const old = buildTimeline(rec({ images: {} }, [stampAdd(500, 'x')]));
ok(snapshotAt(old, 0).peelsOn && ids(snapshotAt(old, 600)) === 'x', 'old recording: a peel field means peels on');
ok(!snapshotAt(buildTimeline(rec({}, [stampAdd(500, 'y', 'i1', false)])), 600).peelsOn, 'old recording without peels: off');
// At most 300 on the floor (oldest first, like the server).
const many = buildTimeline(rec({ peelsOn: true }, Array.from({ length: 305 }, (_, i) => stampAdd(i * 10, 'p' + i))));
const last = snapshotAt(many, 5000);
ok(last.peels.length === 300 && !last.peels.some((p) => p.peel.id === 'p0') && snapshotAt(many, 15).peels.some((p) => p.peel.id === 'p0'), 'at most 300 peels, the oldest go first');
console.log(`peel replay: ${n} ok`);
