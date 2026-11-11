// Persistent city surface textures (Jens, pt850u–pt852u, 11 Nov 2026: "kollar vilka ytor som påverkats och sen
// 'fota' av dom och uppdatera stadens textur. då kan den fortsätta även om det är en miljon klibbor där").
//
// The mechanism, shared by the web app (client/src/surfacetex.js paints), the server (server/surfacetex.js
// coordinates and stores) and the tests:
//   1. Every flat sticker surface of a city room (the ground, the sky, every house wall and roof, the FX rooms,
//      the subway – and every face of a house room inside) is cut into square TILES of TILE_M metres.
//   2. When a city room has been calm for IDLE_MS (no sticker added or removed), ONE client in it is handed a
//      bake job by the server: the oldest stickers that are no longer peelable by anyone (no peel key left) and
//      are not among the newest LIVE_PER_SURFACE on their surface (shared/surfacebake.mjs – those stay live).
//   3. That client folds each sticker exactly as it is drawn (client/src/fold.js), works out which tiles its
//      pieces touch, and "photographs" those tiles: the tile's previous picture + the new stickers painted on
//      top in order, in a 2D canvas. Only the touched tiles are uploaded.
//   4. The server stores each tile picture (content-addressed, immutable) and moves the painted sticker records
//      out of the room file into an append-only archive segment (also content-addressed). Nothing is deleted:
//      the archive keeps every record, so any tile can be rebuilt from scratch.
//   5. On load a client gets the tile pictures (one transparent sheet per tile, over the surface, under every
//      live sticker) plus only the still-live stickers. A million old stickers cost a fixed number of tiles.
//
// Tile keys: '<surface name>|<i>|<j>' – i along the surface's local +x (width), j along its local +y (height),
// counted from its (-w/2, -h/2) corner. A tile picture is TILE px square with a GUTTER px border of real
// content around the TILE_M square, so neighbouring tiles join without seams under linear filtering.
import { LIVE_PER_SURFACE, idsToKeepLive } from './surfacebake.mjs';
import { onProp } from './props.mjs';
import { isCityRoom, isCityOutside } from './city.mjs';

export const SURFACE_TEX = Object.freeze({
  // Jens said "10 seconds or something more suitable": 10 s of calm. A bake is a few hundred ms of canvas
  // work plus an upload of ~0.2–2 MB per touched tile, so doing it after every pause in slapping would
  // be wasteful; 10 s means it happens when a builder stops to look, never mid-gesture.
  idleMs: 10_000,
  jitterMs: 2_500, // clients wait a random 0–2.5 s more, so two in the same room rarely ask at once
  leaseMs: 90_000, // a job with no word from its baker (no tile, no commit) for this long is dropped (left / crashed) and offered again
  maxJobStamps: 400, // stickers per job (a backlog – the first bake of a heavy city – goes in several jobs)
  maxJobTiles: 64, // tiles one job may upload (the baker stops adding stickers when the next would need more; ~2 min of server encoding at worst)
  maxRebuildTiles: 24, // tiles one rebuild job repaints from the archive
  tileM: 8, // tile size, metres
  tilePx: 1024, // a tile picture, pixels (8 m → 127 px a metre with the gutter)
  skyTilePx: 512, // the city's sky (black walls + ceiling, 48 m away): half the resolution
  gutterPx: 4,
  maxTileBytes: 12 * 1024 * 1024, // one uploaded tile (PNG or WebP)
});

// Rooms that get surface textures: every city room (a city's outside and its houses). Ordinary rooms keep the
// in-session bake only (they are small, capped at MAX_STAMPS_PER_ROOM and have their own presets).
export const surfaceTexRoom = (roomId) => isCityRoom(String(roomId || ''));
const SKY = new Set(['tak', 'vägg-norr', 'vägg-söder', 'vägg-väster', 'vägg-öster']);
export const isSkyFace = (roomId, face) => isCityOutside(String(roomId || '')) && SKY.has(String(face));
export const tilePxFor = (roomId, face) => (isSkyFace(roomId, face) ? SURFACE_TEX.skyTilePx : SURFACE_TEX.tilePx);
// Pixels per metre inside a tile of `px` pixels (the gutter is extra, outside the TILE_M square).
export const pxPerM = (px, { tileM = SURFACE_TEX.tileM, gutterPx = SURFACE_TEX.gutterPx } = {}) => (px - 2 * gutterPx) / tileM;

// A surface name as it appears in a tile key: anything a room surface is called, never a '|'.
const FACE_RE = /^[^|\s]{1,40}$/u;
export const tileKey = (face, i, j) => `${face}|${i}|${j}`;
export function parseTileKey(key) {
  const p = String(key || '').split('|');
  if (p.length !== 3 || !FACE_RE.test(p[0]) || !/^\d{1,4}$/.test(p[1]) || !/^\d{1,4}$/.test(p[2])) return null;
  return { face: p[0], i: Number(p[1]), j: Number(p[2]) };
}
// The tiles of a W × H m surface that the local rectangle [s0, s1] × [t0, t1] (metres from the -w/2,-h/2 corner)
// reaches – including a tile's gutter, so a sticker just over a tile edge is in both pictures.
export function tilesForRect(s0, s1, t0, t1, W, H, { tileM = SURFACE_TEX.tileM, gutterM = 0 } = {}) {
  const ni = Math.max(1, Math.ceil(W / tileM - 1e-9)), nj = Math.max(1, Math.ceil(H / tileM - 1e-9));
  const lo = (x, n) => Math.max(0, Math.min(n - 1, Math.floor((x - gutterM) / tileM)));
  const hi = (x, n) => Math.max(0, Math.min(n - 1, Math.floor((x + gutterM) / tileM)));
  if (s1 < -gutterM || t1 < -gutterM || s0 > W + gutterM || t0 > H + gutterM) return [];
  const out = [];
  for (let i = lo(s0, ni); i <= hi(s1, ni); i++) for (let j = lo(t0, nj); j <= hi(t1, nj); j++) out.push([i, j]);
  return out;
}
// The tile's canvas: world (s, t) in metres on the surface → canvas pixels (x right, y DOWN).
export function tileFrame(i, j, px, { tileM = SURFACE_TEX.tileM, gutterPx = SURFACE_TEX.gutterPx } = {}) {
  const k = pxPerM(px, { tileM, gutterPx }), g = gutterPx / k;
  const s0 = i * tileM - g, tTop = (j + 1) * tileM + g;
  return { k, g, s0, tTop, toPx: (s, t) => [(s - s0) * k, (tTop - t) * k] };
}
// The 2D affine map (canvas setTransform a, b, c, d, e, f) that takes three source points to three destination
// points: x' = a x + c y + e, y' = b x + d y + f. null when the source triangle is degenerate.
export function affineFrom3(src, dst) {
  const [[x0, y0], [x1, y1], [x2, y2]] = src, [[X0, Y0], [X1, Y1], [X2, Y2]] = dst;
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const a = ((X1 - X0) * (y2 - y0) - (X2 - X0) * (y1 - y0)) / det;
  const c = ((X2 - X0) * (x1 - x0) - (X1 - X0) * (x2 - x0)) / det;
  const b = ((Y1 - Y0) * (y2 - y0) - (Y2 - Y0) * (y1 - y0)) / det;
  const d = ((Y2 - Y0) * (x1 - x0) - (Y1 - Y0) * (x2 - x0)) / det;
  return [a, b, c, d, X0 - a * x0 - c * y0, Y0 - b * x0 - d * y0];
}
// The three most spread-out points of a polygon (for a well-conditioned affine fit): first, farthest from it,
// and the one farthest from the line between those two.
export function spreadTriple(n, dist2, area2) {
  if (n < 3) return null;
  let b = 1, best = -1;
  for (let k = 1; k < n; k++) { const d = dist2(0, k); if (d > best) { best = d; b = k; } }
  let c = -1; best = -1;
  for (let k = 1; k < n; k++) { if (k === b) continue; const a = Math.abs(area2(0, b, k)); if (a > best) { best = a; c = k; } }
  return c < 0 || best < 1e-14 ? null : [0, b, c];
}

// May this sticker ever be painted into a tile? Not on a prop (props move and get removed in the build phase),
// and it must have a surface name.
export const bakeableSurface = (surface) => !!surface && FACE_RE.test(String(surface)) && !onProp(surface);

// The server's pick for a bake job: stickers nobody can peel any more (peelable(s) false), on a bakeable
// surface, not among the newest perSurface on their surface, not skipped before (skip: Set of ids), oldest
// first, at most max. stamps are the room's live records in order.
export function bakeCandidates(stamps, { peelable = (s) => !!s.peelHash, perSurface = LIVE_PER_SURFACE, max = SURFACE_TEX.maxJobStamps, skip = null } = {}) {
  const list = (stamps || []).filter((s) => s && s.id);
  const keep = idsToKeepLive(list, { perSurface });
  const out = [];
  for (const s of list) {
    if (keep.has(s.id) || peelable(s) || !bakeableSurface(s.surface) || (skip && skip.has(s.id))) continue;
    out.push(s);
  }
  out.sort((a, b) => (a.order || 0) - (b.order || 0));
  return out.slice(0, Math.max(0, max));
}

// The manifest as the clients see it (room.surfaceTex on the server):
//   { v: 1, count, rev, tiles: { <key>: { img: '<16 hex>', px, rev } } }
// count = stickers painted in (they are in no list the client loads), rev = bumps with every commit.
export function publicManifest(st) {
  if (!st || typeof st !== 'object' || !st.tiles) return null;
  const tiles = {};
  for (const [k, t] of Object.entries(st.tiles)) if (t && t.img) tiles[k] = { img: t.img, px: t.px, rev: t.rev || 0 };
  return { v: 1, count: st.count || 0, rev: st.rev || 0, tiles };
}
// Where a tile picture is served: the display copy (lossy WebP), the half-size one (phones), the master
// (lossless – only the baker needs it, as the base it paints on).
export const tileUrl = (img, kind = 'd') => `/api/surfacetex/${img}${kind === 'm' ? '' : '-' + kind}.webp`;
export { LIVE_PER_SURFACE };
