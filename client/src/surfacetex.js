// Persistent city surface textures – the web app's side (Jens pt850u–pt852u, 11 Nov 2026: after ~10 s of calm,
// see which surfaces changed, "photograph" them and update the city's texture; the whole mechanism is in
// shared/surfacetex.mjs, the server side in server/surfacetex.js).
//
// SurfaceTexLayer does two things:
//   1. SHOWS the room's tiles: one thin, lit, transparent sheet per tile over its surface – after the walls and a
//      house's preset sheets (renderOrder 5), before every live sticker (10 + its number). Nothing can aim at,
//      pick or peel them. The stickers in them are not loaded as records at all.
//   2. BAKES when the server hands this browser a job: the stickers are folded exactly as they are drawn
//      (fold.js), each piece is drawn into the tiles it touches on top of the tile's previous picture (2D canvas,
//      the sticker's picture through the piece's own UVs – an exact affine map, nothing is stretched), and the
//      touched tiles are uploaded. The server then moves those records into its archive and tells everyone.
import * as THREE from 'three';
import { foldStamp } from './fold.js';
import {
  SURFACE_TEX, tilesForRect, tileFrame, tileKey, parseTileKey, affineFrom3, spreadTriple, tileUrl, tilePxFor, bakeableSurface,
} from '../../shared/surfacetex.mjs';

const SHEET_LIFT = 0.0006; // m off the surface; the live stickers sit at ~0.8 mm with polygonOffset -4 (this one -3), and draw after it
const RENDER_ORDER = 8;
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const dims = (image, size) => { const a = (image.width || 1) / (image.height || 1); return a >= 1 ? [size, size / a] : [size * a, size]; }; // = StampLayer.dims

// A fold face's own 2D frame: o = its (-w/2, -h/2) corner, U along its width, V along its height (metres).
export function faceFrame(F) {
  const o = F.corners[0], u = F.corners[1].clone().sub(o), v = F.corners[3].clone().sub(o);
  const W = u.length(), H = v.length();
  return { o, U: u.multiplyScalar(1 / (W || 1)), V: v.multiplyScalar(1 / (H || 1)), N: F.normal.clone().normalize(), W, H };
}
const local = (fr, p) => { const d = p.clone().sub(fr.o); return [d.dot(fr.U), d.dot(fr.V)]; };

// Load a picture as an ImageBitmap (same-origin: designs /uploads/…, tiles /api/surfacetex/…). null on failure.
async function loadBitmap(url) {
  try { const r = await fetch(url); if (!r.ok) return null; return await createImageBitmap(await r.blob()); } catch { return null; }
}

// Fold the job's stickers and sort their pieces into tiles: Map key -> { face, i, j, px, frame, ops: [{ rec, uv, pts }] }.
// Returns { tiles, painted: ids, skipped: ids }. only: a Set of tile keys to keep (a rebuild), null = every one.
export function planTiles(records, images, faces, roomId, { only = null, maxTiles = SURFACE_TEX.maxJobTiles } = {}) {
  const byName = new Map((faces || []).map((F) => [F.name, F]));
  const frames = new Map();
  const frameOf = (F) => { if (!frames.has(F.name)) frames.set(F.name, faceFrame(F)); return frames.get(F.name); };
  const tiles = new Map(), painted = [], skipped = [], deferred = [];
  const sorted = [...records].sort((a, b) => (a.order || 0) - (b.order || 0));
  for (const rec of sorted) {
    const image = images[rec.imageId];
    if (!image || !Array.isArray(rec.position) || !Array.isArray(rec.quaternion)) { skipped.push(rec.id); continue; }
    const [w, h] = dims(image, rec.size);
    let pieces = [];
    try { pieces = foldStamp(faces, { center: new THREE.Vector3(...rec.position), quaternion: new THREE.Quaternion(...rec.quaternion), w, h, surface: rec.surface }); } catch { pieces = []; }
    // Every piece must land on a face we can paint (a sticker folding onto a prop's cuboid stays live: props move).
    if (!pieces.length || pieces.some((p) => !bakeableSurface(p.face) || !byName.has(p.face))) { skipped.push(rec.id); continue; }
    if (deferred.length) { deferred.push(rec.id); continue; }
    const ops = [];
    for (const p of pieces) {
      const F = byName.get(p.face), fr = frameOf(F);
      const pts = p.points.map((q) => local(fr, q));
      const px = tilePxFor(roomId, F.name), g = SURFACE_TEX.gutterPx / ((px - 2 * SURFACE_TEX.gutterPx) / SURFACE_TEX.tileM);
      const ss = pts.map((q) => q[0]), ts = pts.map((q) => q[1]);
      for (const [i, j] of tilesForRect(Math.min(...ss), Math.max(...ss), Math.min(...ts), Math.max(...ts), fr.W, fr.H, { gutterM: g })) {
        const key = tileKey(F.name, i, j);
        if (only && !only.has(key)) continue;
        ops.push({ key, face: F.name, i, j, px, op: { rec, uv: p.uv, pts } });
      }
    }
    // A job uploads at most maxTiles tiles: once the next sticker would need more, it and every later one wait for the
    // next job (stopping, not skipping, keeps the paint order = the sticking order).
    const fresh = new Set(ops.filter((o) => !tiles.has(o.key)).map((o) => o.key));
    if (!only && tiles.size && tiles.size + fresh.size > maxTiles) { deferred.push(rec.id); continue; }
    for (const o of ops) {
      let t = tiles.get(o.key);
      if (!t) { t = { key: o.key, face: o.face, i: o.i, j: o.j, px: o.px, frame: tileFrame(o.i, o.j, o.px), ops: [] }; tiles.set(o.key, t); }
      t.ops.push(o.op);
    }
    painted.push(rec.id);
  }
  return { tiles, painted, skipped, deferred };
}

// Draw one tile: base (an ImageBitmap of the tile's previous master, or null = blank) + its ops in order.
// bitmaps: Map imageId -> ImageBitmap. Returns the canvas.
export function paintTile(tile, base, bitmaps, images, canvas = document.createElement('canvas')) {
  const { px, frame } = tile;
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, px, px);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  if (base) ctx.drawImage(base, 0, 0, px, px);
  for (const op of tile.ops) {
    const bm = bitmaps.get(op.rec.imageId); if (!bm) continue;
    const iw = bm.width, ih = bm.height;
    const dst = op.pts.map(([s, t]) => frame.toPx(s, t));
    const src = op.uv.map(([u, v]) => [u * iw, (1 - v) * ih]); // UV (0,0) = the picture's bottom-left (flipY)
    const tri = spreadTriple(dst.length, (a, b) => (dst[a][0] - dst[b][0]) ** 2 + (dst[a][1] - dst[b][1]) ** 2,
      (a, b, c) => (dst[b][0] - dst[a][0]) * (dst[c][1] - dst[a][1]) - (dst[c][0] - dst[a][0]) * (dst[b][1] - dst[a][1]));
    if (!tri) continue;
    const M = affineFrom3(tri.map((k) => src[k]), tri.map((k) => dst[k]));
    if (!M) continue;
    ctx.save();
    ctx.beginPath(); dst.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.clip();
    ctx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
    ctx.drawImage(bm, 0, 0, iw, ih);
    ctx.restore();
  }
  return canvas;
}

export class SurfaceTexLayer {
  // stamps: the StampLayer (its fold faces; baked ids are removed from it). room: the room id. by(): my WebSocket id.
  constructor(scene, stamps, { room, by = () => null, onCount = () => {}, log = console } = {}) {
    this.scene = scene; this.stamps = stamps; this.room = room; this.by = by; this.onCount = onCount; this.log = log;
    this.group = new THREE.Group(); this.group.name = 'surface-textures'; scene.add(this.group);
    this.meshes = new Map(); // tile key -> mesh
    this.manifest = { count: 0, rev: 0, tiles: {} };
    this.on = false; this.idleMs = SURFACE_TEX.idleMs; this.timer = 0; this.busy = false; this.stats = { jobs: 0, painted: 0, tiles: 0, last: null };
    this.loader = new THREE.TextureLoader(); this.gen = 0;
  }
  get count() { return this.manifest.count || 0; }
  get faces() { return this.stamps.faces; }
  // The room's tiles (GET …/stamps → surfaceTex) and whether baking is on. Missing tiles are removed.
  async setManifest(m, { on = false, idleMs } = {}) {
    this.on = !!on && !!this.faces;
    if (Number.isFinite(idleMs)) this.idleMs = idleMs;
    const tiles = (m && m.tiles) || {};
    this.manifest = { count: (m && m.count) || 0, rev: (m && m.rev) || 0, tiles: { ...tiles } };
    for (const k of [...this.meshes.keys()]) if (!tiles[k]) this.drop(k);
    await Promise.all(Object.entries(tiles).map(([k, t]) => this.show(k, t)));
    this.onCount();
    if (this.on) this.noteChange(); // a backlog (stickers waiting to be painted in) gets its turn after a calm moment
  }
  // A commit (event surfacetex:update): the new pictures first, then the stickers that are in them go.
  async applyUpdate(e) {
    const tiles = (e && e.tiles) || {};
    await Promise.all(Object.entries(tiles).map(([k, t]) => (t ? this.show(k, t) : (this.drop(k), null))));
    for (const [k, t] of Object.entries(tiles)) { if (t) this.manifest.tiles[k] = t; else delete this.manifest.tiles[k]; }
    if (Number.isFinite(e.count)) this.manifest.count = e.count;
    if (Number.isFinite(e.rev)) this.manifest.rev = Math.max(this.manifest.rev, e.rev);
    for (const id of Array.isArray(e.baked) ? e.baked : []) this.stamps.remove(id);
    this.onCount();
  }
  clear() { for (const k of [...this.meshes.keys()]) this.drop(k); this.manifest = { count: 0, rev: 0, tiles: {} }; this.onCount(); }
  drop(k) { const m = this.meshes.get(k); if (!m) return; this.group.remove(m); m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); this.meshes.delete(k); }
  async show(key, t) {
    const cur = this.meshes.get(key);
    if (cur && cur.userData.img === t.img) return;
    const tk = parseTileKey(key), F = tk && (this.faces || []).find((f) => f.name === tk.face);
    if (!F) return;
    let tex;
    try { tex = await this.loader.loadAsync(tileUrl(t.img, coarse() ? 'h' : 'd')); } catch { return; }
    if (this.manifest.tiles[key] && this.manifest.tiles[key].img !== t.img && this.manifest.tiles[key].rev > t.rev) { tex.dispose(); return; } // a newer one came meanwhile
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const fr = faceFrame(F), T = SURFACE_TEX.tileM;
    const s0 = tk.i * T, s1 = Math.min(fr.W, (tk.i + 1) * T), t0 = tk.j * T, t1 = Math.min(fr.H, (tk.j + 1) * T);
    if (!(s1 > s0 && t1 > t0)) { tex.dispose(); return; }
    const sw = s1 - s0, sh = t1 - t0, sc = (s0 + s1) / 2, tc = (t0 + t1) / 2;
    const geo = new THREE.PlaneGeometry(sw, sh);
    const P = t.px || tilePxFor(this.room, F.name), frame = tileFrame(tk.i, tk.j, P);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let k = 0; k < pos.count; k++) {
      const [cx, cy] = frame.toPx(sc + pos.getX(k), tc + pos.getY(k));
      uv.setXY(k, cx / P, 1 - cy / P); // the picture's top row is canvas y = 0 (TextureLoader flips: v = 1)
    }
    uv.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.02, depthWrite: false, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(fr.o).addScaledVector(fr.U, sc).addScaledVector(fr.V, tc).addScaledVector(fr.N, SHEET_LIFT);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fr.U, fr.V, fr.N));
    m.renderOrder = RENDER_ORDER; m.raycast = () => {}; m.name = `tex-${key}`; m.userData = { surfaceTile: key, img: t.img };
    m.updateMatrix(); m.matrixAutoUpdate = false;
    if (this.meshes.has(key)) this.drop(key);
    this.group.add(m); this.meshes.set(key, m);
  }

  // ---- baking ----
  // A sticker came or went (anyone's): wait for calm again (the server checks the same).
  noteChange(extraMs = 0) {
    if (!this.on) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tryBake(), this.idleMs + extraMs + Math.random() * SURFACE_TEX.jitterMs);
  }
  async tryBake() {
    if (!this.on || this.busy) return null;
    const by = this.by();
    if (!by) { this.noteChange(); return null; } // not connected yet
    this.busy = true;
    try {
      for (let n = 0; n < 50; n++) {
        const r = await this.api('POST', `/api/rooms/${this.room}/surfacetex/claim`, { by });
        if (!r || r.off) { this.on = false; return r; }
        if (r.wait) { this.noteChange(Math.max(0, r.wait - this.idleMs)); return r; }
        if (!r.job) return r; // idle: nothing to paint in
        const done = await this.run(r.job, by);
        if (!done || !done.more) { if (done && r.job.kind === 'rebuild') continue; return done; }
      }
      return null;
    } catch (e) { this.log.warn?.('[surfacetex]', e && e.message); this.noteChange(); return null; }
    finally { this.busy = false; }
  }
  async api(method, url, body) {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status, body: j });
    return j;
  }
  // Paint one job and hand it in. Returns the commit's answer.
  async run(job, by) {
    const t0 = performance.now();
    let records = job.stamps || [], images = job.images || {}, only = null;
    if (job.kind === 'rebuild') {
      records = []; images = {}; only = new Set(job.keys);
      const segs = [...new Set(Object.values(job.segs || {}).flat())];
      for (const h of segs) { const s = await this.api('GET', `/api/rooms/${this.room}/surfacetex/seg/${h}`); records.push(...s.stamps); Object.assign(images, s.images); }
      const removed = new Set(job.removed || []);
      const seen = new Set(); records = records.filter((s) => !removed.has(s.id) && !seen.has(s.id) && seen.add(s.id));
    }
    const plan = planTiles(records, images, this.faces, this.room, { only });
    if (job.kind === 'rebuild') for (const k of job.keys) if (!plan.tiles.has(k)) { const tk = parseTileKey(k); if (tk) plan.tiles.set(k, { key: k, ...tk, px: tilePxFor(this.room, tk.face), frame: tileFrame(tk.i, tk.j, tilePxFor(this.room, tk.face)), ops: [] }); }
    const bitmaps = new Map();
    const want = [...new Set([...plan.tiles.values()].flatMap((t) => t.ops.map((o) => o.rec.imageId)))];
    await Promise.all(want.map(async (id) => { const b = await loadBitmap(images[id].url); if (b) bitmaps.set(id, b); }));
    // a sticker whose picture did not load is left out of this job (it stays live; the server offers it again later)
    const missing = new Set(records.filter((s) => !bitmaps.has(s.imageId)).map((s) => s.id));
    const painted = plan.painted.filter((id) => !missing.has(id));
    if (job.kind === 'bake' && missing.size) for (const t of plan.tiles.values()) t.ops = t.ops.filter((o) => !missing.has(o.rec.id));
    const canvas = document.createElement('canvas');
    let up = 0;
    try {
      for (const t of plan.tiles.values()) {
        if (job.kind === 'bake' && !t.ops.length) continue;
        const prev = job.kind === 'bake' && job.tiles && job.tiles[t.key];
        let base = null;
        if (prev) { base = await loadBitmap(tileUrl(prev.img, 'm')); if (!base) throw new Error('could not load a tile to paint on'); } // never paint over a picture we could not read
        paintTile(t, base, bitmaps, images, canvas);
        base?.close?.();
        const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
        const r = await fetch(`/api/rooms/${this.room}/surfacetex/jobs/${job.id}/tile?key=${encodeURIComponent(t.key)}&by=${by}`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: blob });
        if (!r.ok) throw new Error(`tile upload ${r.status}`);
        up++;
      }
    } finally { for (const b of bitmaps.values()) b.close?.(); canvas.width = canvas.height = 1; }
    const skipped = job.kind === 'bake' ? [...plan.skipped] : [];
    const res = await this.api('POST', `/api/rooms/${this.room}/surfacetex/jobs/${job.id}/commit`, { by, painted: job.kind === 'bake' ? painted : [], skipped });
    this.stats = { jobs: this.stats.jobs + 1, painted: this.stats.painted + (res.baked || 0), tiles: this.stats.tiles + up, last: { kind: job.kind, ms: Math.round(performance.now() - t0), tiles: up, painted: res.baked || 0, skipped: skipped.length } };
    return res;
  }
  info() {
    return { on: this.on, count: this.count, rev: this.manifest.rev, tiles: Object.keys(this.manifest.tiles).length, shown: this.meshes.size, busy: this.busy, idleMs: this.idleMs, stats: { ...this.stats } };
  }
}
