// Unit tests: shared/coverage.mjs (which stickers are hidden behind newer ones).
import assert from 'node:assert/strict';
import { hiddenStamps, HIDDEN_AT } from '../shared/coverage.mjs';

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const D = Math.PI / 180;
const qAxis = (ax, a) => [ax[0] * Math.sin(a / 2), ax[1] * Math.sin(a / 2), ax[2] * Math.sin(a / 2), Math.cos(a / 2)];
const qMul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
// Same frames as StampLayer.orientation (z = out of the face), then the sticker's own spin.
const BASE = { 'vägg-norr': [0, 0, 0, 1], 'vägg-öster': qAxis([0, 1, 0], -90 * D), 'vägg-väster': qAxis([0, 1, 0], 90 * D), golv: qAxis([1, 0, 0], -90 * D), tak: qAxis([1, 0, 0], 90 * D) };
let order = 0;
const st = (surface, position, size, { rot = 0, img = 'sq', id } = {}) => ({ id: id || 's' + (++order), order, imageId: img, surface, position, size, quaternion: qMul(BASE[surface], qAxis([0, 0, 1], -rot * D)) });
const images = { sq: { width: 100, height: 100 }, wide: { width: 400, height: 100 }, ring: { width: 100, height: 100 } };
// A ring: opaque except a hole in the middle third (die-cut).
const ring = { n: 9, bits: Uint8Array.from({ length: 81 }, (_, i) => { const x = i % 9, y = Math.floor(i / 9); return x >= 3 && x < 6 && y >= 3 && y < 6 ? 0 : 1; }) };
const hidden = (stamps, extra = {}) => hiddenStamps(stamps, { images, masks: { ring }, ...extra }).map((h) => h.id);

ok('full overlap on the same wall: the older one is hidden, the newer one stays', () => {
  const a = st('vägg-norr', [0, 2, -5], 0.4), b = st('vägg-norr', [0.05, 2, -5], 1);
  assert.deepEqual(hidden([a, b]), [a.id]);
});
ok('partial overlap is kept (and so is 95 %, under the 98 % line)', () => {
  const a = st('vägg-norr', [0, 2, -5], 0.5), b = st('vägg-norr', [0.3, 2, -5], 0.5);
  assert.deepEqual(hidden([a, b]), []);
  const c = st('vägg-norr', [2, 2, -5], 1), d = st('vägg-norr', [2.05, 2, -5], 1); // 95 % covered
  assert.deepEqual(hidden([c, d]), []);
  assert.equal(HIDDEN_AT, 0.98);
});
ok('order matters: a newer small sticker under an older big one is not "hidden"', () => {
  const big = st('vägg-norr', [0, 2, -5], 1), small = st('vägg-norr', [0, 2, -5], 0.3);
  assert.deepEqual(hidden([big, small]), []);
});
ok('several newer stickers together can hide an older one', () => {
  const a = st('vägg-norr', [0, 2, -5], 0.6);
  const l = st('vägg-norr', [-0.25, 2, -5], 0.7), r = st('vägg-norr', [0.25, 2, -5], 0.7);
  assert.deepEqual(hidden([a, l, r]), [a.id]);
});
ok('rotation: a 45° square covers less than the same square straight; a wide strip turned 90° misses', () => {
  const a = st('vägg-norr', [0, 2, -5], 0.3), straight = st('vägg-norr', [0, 2, -5], 0.32);
  assert.deepEqual(hidden([a, straight]), [a.id]);
  const a2 = st('vägg-norr', [0, 2, -5], 0.3), turned = st('vägg-norr', [0, 2, -5], 0.32, { rot: 45 });
  assert.deepEqual(hidden([a2, turned]), []);
  const a3 = st('vägg-norr', [0, 2, -5], 0.5, { rot: 45 }), big45 = st('vägg-norr', [0, 2, -5], 0.75, { rot: 45 });
  assert.deepEqual(hidden([a3, big45]), [a3.id]);
  const strip = st('vägg-norr', [1, 1, -5], 1, { img: 'wide' }), cross = st('vägg-norr', [1, 1, -5], 1.2, { img: 'wide', rot: 90 });
  assert.deepEqual(hidden([strip, cross]), []);
  const strip2 = st('vägg-norr', [-1, 1, -5], 1, { img: 'wide', rot: 90 }), cross2 = st('vägg-norr', [-1, 1, -5], 1.2, { img: 'wide', rot: 90 });
  assert.deepEqual(hidden([strip2, cross2]), [strip2.id]);
});
ok('different surfaces never cover each other (floor vs ceiling, two walls)', () => {
  const floor = st('golv', [0, 0, 0], 0.5), ceil = st('tak', [0, 4, 0], 2);
  const north = st('vägg-norr', [-4, 2, -5], 0.4), west = st('vägg-väster', [-5, 2, -4], 3);
  assert.deepEqual(hidden([floor, ceil]), []);
  assert.deepEqual(hidden([north, west]), []);
  assert.deepEqual(hidden([floor, st('golv', [0, 0, 0], 1)]), [floor.id]);
});
ok('folds over an edge: the part on the neighbouring wall has to be covered too', () => {
  // A at the north wall's east end: the right 0.2 m folds onto the east wall.
  const a = st('vägg-norr', [4.9, 2, -5], 0.6);
  const north = st('vägg-norr', [4.6, 2, -5], 0.8); // covers the north part only (up to the corner)
  assert.deepEqual(hidden([a, north]), []);
  const east = st('vägg-öster', [5, 2, -4.6], 0.8); // and the east part, from the east wall
  assert.deepEqual(hidden([a, north, east]), [a.id]);
  const a2 = st('vägg-norr', [4.9, 2, -5], 0.6), over = st('vägg-norr', [4.8, 2, -5], 1); // one newer sticker folding the same way
  assert.deepEqual(hidden([a2, over]), [a2.id]);
});
ok('die-cut alpha: a hole in the newer sticker leaves the older one visible; the older one\'s own holes do not count', () => {
  const a = st('vägg-norr', [0, 2, -5], 0.2), donut = st('vägg-norr', [0, 2, -5], 0.9, { img: 'ring' });
  assert.deepEqual(hidden([a, donut]), []);
  // An older ring whose opaque part is covered by a newer ring of the same size, shifted inside its hole: fine either way;
  // a ring fully under a plain square is hidden.
  const r = st('vägg-norr', [2, 2, -5], 0.5, { img: 'ring' }), sq = st('vägg-norr', [2, 2, -5], 0.52);
  assert.deepEqual(hidden([r, sq]), [r.id]);
});
ok('candidates limit the check; unknown images are neither removed nor covering', () => {
  const a = st('vägg-norr', [0, 2, -5], 0.3), b = st('vägg-norr', [1, 2, -5], 0.3), top = st('vägg-norr', [0.5, 2, -5], 2);
  assert.deepEqual(hidden([a, b, top], { candidates: [b.id] }), [b.id]);
  const ghost = st('vägg-norr', [3, 2, -5], 0.3, { img: 'nope' }), over = st('vägg-norr', [3, 2, -5], 1);
  const c = st('vägg-norr', [-3, 2, -5], 0.3), ghostTop = st('vägg-norr', [-3, 2, -5], 1, { img: 'nope' });
  assert.deepEqual(hidden([ghost, over, c, ghostTop]), []);
});
ok('deterministic and quick: 3,000 stickers in well under a second', () => {
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const walls = ['vägg-norr', 'golv'];
  const many = Array.from({ length: 3000 }, () => { const w = walls[Math.floor(rnd() * 2)]; const x = rnd() * 9 - 4.5, y = rnd() * 3 + 0.5;
    return st(w, w === 'golv' ? [x, 0, y - 2] : [x, y, -5], 0.2 + rnd() * 0.8, { rot: rnd() * 360 }); });
  const t0 = Date.now(); const h1 = hidden(many); const ms = Date.now() - t0;
  assert.deepEqual(hidden(many), h1);
  assert.ok(h1.length > 100 && h1.length < 3000, h1.length);
  assert.ok(ms < 3000, ms + ' ms');
  console.log(`    (3,000 stickers: ${h1.length} hidden, ${ms} ms)`);
});
console.log(`coverage: ${n} passed`);
