// Persistent city surface textures – the shared rules (shared/surfacetex.mjs): tiles, the tile frame, the affine
// map a sticker piece is drawn with, and which stickers a bake job may paint in.
import assert from 'node:assert/strict';
import {
  SURFACE_TEX, surfaceTexRoom, tilePxFor, pxPerM, tileKey, parseTileKey, tilesForRect, tileFrame, affineFrom3, spreadTriple,
  bakeableSurface, bakeCandidates, publicManifest, tileUrl, LIVE_PER_SURFACE,
} from '../shared/surfacetex.mjs';

const ok = (m) => console.log('✔ ' + m);
assert.equal(SURFACE_TEX.idleMs, 10_000); ok('idle time is 10 s (Jens: "10 sekund eller något lämpligare")');
assert.equal(LIVE_PER_SURFACE, 20); ok('the newest 20 per surface stay live (unchanged rule)');

assert.ok(surfaceTexRoom('stad') && surfaceTexRoom('stad-byggen') && surfaceTexRoom('stad-byggen-3') && surfaceTexRoom('stad-abc123'));
assert.ok(!surfaceTexRoom('k7m2qx') && !surfaceTexRoom('')); ok('city rooms (outside + houses) only');

assert.equal(tilePxFor('stad-byggen', 'golv'), 1024);
assert.equal(tilePxFor('stad-byggen', 'vägg-norr'), 512, 'the city sky is half resolution');
assert.equal(tilePxFor('stad-byggen-3', 'vägg-norr'), 1024, 'a house wall is a real wall');
assert.equal(pxPerM(1024), 127); ok('tile resolution: 1024 px / 8 m (+4 px gutter) = 127 px a metre; sky 512');

assert.deepEqual(parseTileKey(tileKey('vägg-väster', 3, 0)), { face: 'vägg-väster', i: 3, j: 0 });
assert.equal(parseTileKey('a|b|c'), null); assert.equal(parseTileKey('x|1'), null); assert.equal(parseTileKey('has space|1|2'), null);
ok('tile keys round-trip (Swedish surface names too), junk is refused');

// a 96 × 96 m ground: 12 × 12 tiles
assert.deepEqual(tilesForRect(1, 2, 1, 2, 96, 96), [[0, 0]]);
assert.deepEqual(tilesForRect(7, 9, 1, 2, 96, 96), [[0, 0], [1, 0]]);
assert.deepEqual(tilesForRect(7.99, 7.995, 3, 3.1, 96, 96, { gutterM: 0.04 }), [[0, 0], [1, 0]], 'just inside a tile edge: in the neighbour\'s gutter too');
assert.deepEqual(tilesForRect(95, 97, 95, 97, 96, 96), [[11, 11]], 'clamped to the surface');
assert.deepEqual(tilesForRect(100, 101, 0, 1, 96, 96), [], 'off the surface: none');
assert.equal(tilesForRect(0, 96, 0, 24, 96, 24).length, 12 * 3, 'a whole sky wall: 12 × 3 tiles');
assert.deepEqual(tilesForRect(0, 4.4, 0, 5, 4.4, 5), [[0, 0]], 'a small FX wall: one tile');
ok('tilesForRect: which tiles a piece reaches');

{
  const f = tileFrame(2, 1, 1024);
  const [x0, y0] = f.toPx(16, 16); // the tile's top-left corner of its 8 m square
  assert.ok(Math.abs(x0 - 4) < 1e-9 && Math.abs(y0 - 4) < 1e-9, 'the square starts after the 4 px gutter');
  const [x1, y1] = f.toPx(24, 8);
  assert.ok(Math.abs(x1 - 1020) < 1e-9 && Math.abs(y1 - 1020) < 1e-9, 'and ends 4 px before the edge (y grows downwards)');
  ok('tileFrame: metres on the surface → canvas pixels');
}

{
  const src = [[0, 0], [100, 0], [0, 50]], dst = [[10, 20], [10, 220], [-90, 20]]; // rotated 90°, scaled 2×
  const M = affineFrom3(src, dst);
  const ap = ([x, y]) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
  for (let k = 0; k < 3; k++) { const p = ap(src[k]); assert.ok(Math.abs(p[0] - dst[k][0]) < 1e-9 && Math.abs(p[1] - dst[k][1]) < 1e-9); }
  const mid = ap([50, 25]); assert.ok(Math.abs(mid[0] - -40) < 1e-9 && Math.abs(mid[1] - 120) < 1e-9);
  assert.equal(affineFrom3([[0, 0], [1, 1], [2, 2]], dst), null, 'degenerate: null');
  const pts = [[0, 0], [0.001, 0], [5, 0], [5, 5]];
  const t = spreadTriple(pts.length, (a, b) => (pts[a][0] - pts[b][0]) ** 2 + (pts[a][1] - pts[b][1]) ** 2,
    (a, b, c) => (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[c][0] - pts[a][0]) * (pts[b][1] - pts[a][1]));
  assert.deepEqual(t, [0, 3, 2]);
  ok('affineFrom3 / spreadTriple: the exact map a sticker piece is drawn with');
}

assert.ok(bakeableSurface('golv') && bakeableSurface('fx5-w2-e') && bakeableSurface('h8-n'));
assert.ok(!bakeableSurface('prop-0123456789-top') && !bakeableSurface('prop-0123456789-m2') && !bakeableSurface(''));
ok('stickers on props never go into a texture (props move)');

{
  const wall = (n, surface, from = 0, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: `${surface}-${from + i}`, order: from + i + 1, surface, ...extra }));
  const stamps = [...wall(30, 'golv'), ...wall(5, 'h8-n', 100), ...wall(25, 'prop-0123456789-top', 200)];
  stamps[0].peelHash = 'x'; // still in someone's peel history
  const c = bakeCandidates(stamps);
  assert.equal(c.length, 9, '30 on the ground − newest 20 − 1 peelable = 9; h8-n (5) none; prop none');
  assert.ok(c.every((s) => s.surface === 'golv' && !s.peelHash));
  assert.deepEqual(c.map((s) => s.order), [2, 3, 4, 5, 6, 7, 8, 9, 10], 'oldest first');
  assert.equal(bakeCandidates(stamps, { max: 3 }).length, 3);
  assert.equal(bakeCandidates(stamps, { skip: new Set(['golv-1', 'golv-2']) }).length, 7);
  ok('bakeCandidates: unpeelable, not the newest 20 on their surface, not props, oldest first, capped');
}

{
  const m = publicManifest({ count: 5, rev: 2, tiles: { 'golv|0|0': { img: 'abcdefabcdefabcd', px: 1024, rev: 2, segs: ['s1'] } }, segs: ['s1'], removed: ['x'] });
  assert.deepEqual(m, { v: 1, count: 5, rev: 2, tiles: { 'golv|0|0': { img: 'abcdefabcdefabcd', px: 1024, rev: 2 } } });
  assert.equal(publicManifest(null), null);
  assert.equal(tileUrl('abcdefabcdefabcd'), '/api/surfacetex/abcdefabcdefabcd-d.webp');
  assert.equal(tileUrl('abcdefabcdefabcd', 'm'), '/api/surfacetex/abcdefabcdefabcd.webp');
  ok('the public manifest has no archive details');
}
console.log('\nsurfacetex (shared): all ok');
