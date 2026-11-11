// Persistent city surface textures – the server side (Jens pt850u–pt852u, 11 Nov 2026; the whole mechanism is
// described in shared/surfacetex.mjs). This module:
//   - remembers when each city room last had a sticker change (noteChange, from app.js's broadcast),
//   - hands out ONE bake job per room at a time, after SURFACE_TEX.idleMs of calm, to a player in the room
//     (claim) – the oldest stickers nobody can peel any more, minus the newest 20 per surface,
//   - takes the photographed tiles (putTile: PNG/WebP, exactly the tile's size) and stores them content-addressed:
//       surfacetex/img/<hash>.webp     the master (lossless WebP – the base the next bake paints on)
//       surfacetex/img/<hash>-d.webp   the display copy (lossy WebP) every client loads
//       surfacetex/img/<hash>-h.webp   the half-size copy (phones)
//   - commits a job in ONE locked room edit: the painted sticker records go out of room.stamps into an archive
//     segment (surfacetex/seg/<hash>.json, content-addressed, never rewritten) and room.surfaceTex is updated:
//       { v: 1, count, rev, tiles: { <key>: { img, px, rev, segs: [seg …] } }, segs: [seg …], stale: [key …], removed: [id …] }
//     count = stickers painted in, segs = every archive segment in order (the full record of the build),
//     tiles[k].segs = the segments whose stickers touch tile k (to rebuild it), stale = tiles to repaint from
//     the archive (an archived sticker was removed: admin / "clear your stickers" / a design deleted),
//     removed = archived sticker ids left out of every rebuild.
//   - repaints stale tiles with rebuild jobs (the same claim → putTile → commit, from a blank tile).
// Content-addressed files are shared by city presets and the cities made from them (nothing is copied);
// gc() (admin) deletes the ones nothing refers to any more.
const crypto = require('crypto');
const sharp = require('sharp');
const ST = require('../shared/surfacetex.mjs');

const HASH_RE = /^[a-f0-9]{16}$/;
const JOB_RE = /^[a-f0-9]{16}$/;
const hash16 = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
const imgKey = (h, kind = 'm') => `surfacetex/img/${h}${kind === 'm' ? '' : '-' + kind}.webp`;
const segKey = (h) => `surfacetex/seg/${h}.json`;
const err = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const publicStamp = ({ peelHash, peelOwner, madeBy, ...s }) => s;
const offEnv = (v) => /^(0|off|false|no)$/i.test(String(v ?? '').trim());

function surfaceTexSettings(env = process.env) {
  const n = (v, d) => { const x = Number.parseInt(v, 10); return Number.isFinite(x) && x >= 0 ? x : d; };
  return { on: !offEnv(env.SURFACE_TEX), idleMs: n(env.SURFACE_TEX_IDLE_MS, ST.SURFACE_TEX.idleMs), leaseMs: n(env.SURFACE_TEX_LEASE_MS, ST.SURFACE_TEX.leaseMs) };
}

// deps: imageAvailable(id) → image meta or null; isPlayer(roomId, by) → is that WebSocket id a player in the room;
// broadcast(roomId, event); listPresets() → city presets (for gc).
function createSurfaceTex(store, { clock = () => Date.now(), log = console, settings = surfaceTexSettings(), imageAvailable = async () => null, isPlayer = () => false, broadcast = () => {}, listPresets = async () => [] } = {}) {
  const adapter = store.adapter;
  const lastChange = new Map(); // roomId -> ms of the last sticker change (none since start = calm)
  const jobs = new Map(); // roomId -> job
  const skip = new Map(); // roomId -> Set of sticker ids a baker could not paint (they stay live)
  const segCache = new Map(); // seg hash -> records (small LRU)
  const SEG_CACHE = 64;
  const on = () => settings.on;

  function noteChange(roomId) { if (ST.surfaceTexRoom(roomId)) lastChange.set(roomId, clock()); }
  const liveJob = (roomId) => { const j = jobs.get(roomId); if (j && clock() - j.at > settings.leaseMs) { jobs.delete(roomId); return null; } return j || null; };

  async function readSeg(h) {
    if (segCache.has(h)) { const v = segCache.get(h); segCache.delete(h); segCache.set(h, v); return v; }
    const b = await adapter.get(segKey(h));
    if (!b) return null;
    let recs; try { recs = JSON.parse(b.toString('utf8')).stamps || []; } catch { return null; }
    segCache.set(h, recs); while (segCache.size > SEG_CACHE) segCache.delete(segCache.keys().next().value);
    return recs;
  }
  async function putOnce(key, buf, type) { if (!(await adapter.exists(key))) await adapter.put(key, buf, type); }

  // Images (design metadata) for a list of records; records whose design is gone are left out.
  async function withImages(records) {
    const images = {}, ids = [...new Set(records.map((s) => s.imageId))];
    const metas = await Promise.all(ids.map((i) => imageAvailable(i)));
    ids.forEach((i, n) => { if (metas[n]) images[i] = metas[n]; });
    return { images, stamps: records.filter((s) => images[s.imageId]) };
  }

  // A job for this room, or why not: { job } | { wait: ms } | { busy: true, wait } | { idle: true } | { off: true }.
  async function claim(roomId, { by = null, admin = false } = {}) {
    if (!on()) return { off: true };
    if (!ST.surfaceTexRoom(roomId)) throw err(404, 'Not a city room');
    if (!admin && !isPlayer(roomId, by)) throw err(403, 'Join the room first');
    const cur = liveJob(roomId);
    if (cur) return { busy: true, wait: Math.max(1000, settings.leaseMs - (clock() - cur.at)) };
    const room = await store.peek(roomId);
    if (!room) return { idle: true };
    const st = room.surfaceTex || null;
    // 1) Tiles to repaint from the archive (a painted sticker was removed): no need to wait for calm.
    if (st && Array.isArray(st.stale) && st.stale.length) {
      const keys = st.stale.filter((k) => st.tiles && st.tiles[k]).slice(0, ST.SURFACE_TEX.maxRebuildTiles);
      if (!keys.length) { await store.editRoom(roomId, (r) => { if (r.surfaceTex) r.surfaceTex.stale = []; }); return { idle: true }; }
      const segs = {}; for (const k of keys) segs[k] = [...(st.tiles[k].segs || [])];
      const job = { id: crypto.randomBytes(8).toString('hex'), kind: 'rebuild', room: roomId, by, at: clock(), keys, tiles: new Map(), ids: new Set() };
      jobs.set(roomId, job);
      return { job: { id: job.id, kind: 'rebuild', keys, segs, removed: [...(st.removed || [])], tiles: {} } };
    }
    // 2) New stickers to paint in: only after a calm moment.
    const since = clock() - (lastChange.get(roomId) || 0);
    if (since < settings.idleMs) return { wait: settings.idleMs - since };
    const sk = skip.get(roomId) || new Set();
    const cands = ST.bakeCandidates(room.stamps || [], { skip: sk, max: ST.SURFACE_TEX.maxJobStamps });
    if (!cands.length) return { idle: true };
    const { images, stamps } = await withImages(cands);
    for (const s of cands) if (!images[s.imageId]) sk.add(s.id); // design gone: never offered again (stays as it is)
    skip.set(roomId, sk);
    if (!stamps.length) return { idle: true };
    const job = { id: crypto.randomBytes(8).toString('hex'), kind: 'bake', room: roomId, by, at: clock(), ids: new Set(stamps.map((s) => s.id)), tiles: new Map(), more: cands.length >= ST.SURFACE_TEX.maxJobStamps };
    jobs.set(roomId, job);
    const pub = ST.publicManifest(st);
    return { job: { id: job.id, kind: 'bake', stamps: stamps.map(publicStamp), images, tiles: pub ? pub.tiles : {}, more: job.more } };
  }

  function jobFor(roomId, jobId, by, admin) {
    const j = liveJob(roomId);
    if (!j || j.id !== jobId) throw err(409, 'That bake job is over', { stale: true });
    if (!admin && j.by !== by) throw err(403, 'Not your bake job');
    return j;
  }

  // One photographed tile of a job. buf = PNG or WebP, exactly the tile's size.
  async function putTile(roomId, jobId, key, buf, { by = null, admin = false } = {}) {
    const j = jobFor(roomId, jobId, by, admin);
    const t = ST.parseTileKey(key);
    if (!t) throw err(400, 'Bad tile');
    if (j.kind === 'rebuild' && !j.keys.includes(key)) throw err(400, 'That tile is not part of this rebuild');
    if (!j.tiles.has(key) && j.tiles.size >= ST.SURFACE_TEX.maxJobTiles) throw err(413, 'Too many tiles in one job');
    if (!Buffer.isBuffer(buf) || !buf.length || buf.length > ST.SURFACE_TEX.maxTileBytes) throw err(413, 'Tile too big');
    const px = ST.tilePxFor(roomId, t.face);
    let meta; try { meta = await sharp(buf).metadata(); } catch { throw err(400, 'Not an image'); }
    if (!['png', 'webp'].includes(meta.format) || meta.width !== px || meta.height !== px) throw err(400, `A tile is ${px} × ${px} px (PNG or WebP)`);
    const stats = await sharp(buf).ensureAlpha().stats();
    const empty = stats.channels[3].max === 0;
    if (empty) { j.tiles.set(key, { img: null, px }); j.at = clock(); return { img: null }; }
    const master = await sharp(buf).ensureAlpha().webp({ lossless: true, effort: 3 }).toBuffer();
    const h = hash16(master);
    await putOnce(imgKey(h, 'm'), master, 'image/webp');
    await putOnce(imgKey(h, 'd'), await sharp(buf).ensureAlpha().webp({ quality: 86, alphaQuality: 92, effort: 4 }).toBuffer(), 'image/webp');
    await putOnce(imgKey(h, 'h'), await sharp(buf).ensureAlpha().resize(px / 2, px / 2).webp({ quality: 82, alphaQuality: 90, effort: 4 }).toBuffer(), 'image/webp');
    j.tiles.set(key, { img: h, px });
    j.at = clock(); // the lease is 'no word from the baker for leaseMs': every tile handed in renews it
    return { img: h };
  }

  // Finish a job. painted: the sticker ids now in the pictures (bake), skipped: ones the baker could not paint.
  async function commit(roomId, jobId, { painted = [], skipped = [], by = null, admin = false } = {}) {
    const j = jobFor(roomId, jobId, by, admin);
    const ids = [...new Set((Array.isArray(painted) ? painted : []).map(String))];
    if (j.kind === 'bake') {
      if (ids.some((id) => !j.ids.has(id))) { jobs.delete(roomId); throw err(400, 'Painted stickers that were not in the job'); }
      const sk = skip.get(roomId) || new Set();
      for (const id of Array.isArray(skipped) ? skipped : []) if (j.ids.has(String(id))) sk.add(String(id));
      skip.set(roomId, sk);
      if (ids.length && !j.tiles.size) { jobs.delete(roomId); throw err(400, 'No tiles for the painted stickers'); }
    } else if (j.keys.some((k) => !j.tiles.has(k))) { jobs.delete(roomId); throw err(400, 'Every tile of the rebuild must be uploaded'); }
    const changed = {};
    const res = await store.editRoom(roomId, async (room) => {
      const byId = new Map((room.stamps || []).map((s) => [s.id, s]));
      if (j.kind === 'bake' && ids.some((id) => !byId.has(id))) return { save: false, changed: true }; // a sticker went meanwhile: paint again
      const st = room.surfaceTex || (room.surfaceTex = { v: 1, count: 0, rev: 0, tiles: {}, segs: [], stale: [], removed: [] });
      for (const k of ['tiles']) if (!st[k] || typeof st[k] !== 'object') st[k] = {};
      for (const k of ['segs', 'stale', 'removed']) if (!Array.isArray(st[k])) st[k] = [];
      let seg = null;
      if (j.kind === 'bake' && ids.length) {
        const recs = ids.map((id) => byId.get(id)).sort((a, b) => (a.order || 0) - (b.order || 0));
        const body = Buffer.from(JSON.stringify({ room: roomId, at: new Date(clock()).toISOString(), stamps: recs }));
        seg = hash16(body);
        await putOnce(segKey(seg), body, 'application/json');
        segCache.set(seg, recs);
        if (!st.segs.includes(seg)) st.segs.push(seg);
        const gone = new Set(ids);
        room.stamps = room.stamps.filter((s) => !gone.has(s.id));
        st.count = (st.count || 0) + ids.length;
      }
      if (!j.tiles.size && !seg) return { save: false, nothing: true };
      st.rev = (st.rev || 0) + 1;
      for (const [key, t] of j.tiles) {
        const old = st.tiles[key];
        if (!t.img) { if (old) { delete st.tiles[key]; changed[key] = null; } continue; }
        const segs = old && Array.isArray(old.segs) ? old.segs.slice() : [];
        if (seg && !segs.includes(seg)) segs.push(seg);
        st.tiles[key] = { img: t.img, px: t.px, rev: st.rev, segs };
        changed[key] = { img: t.img, px: t.px, rev: st.rev };
      }
      if (j.kind === 'rebuild') st.stale = st.stale.filter((k) => !j.keys.includes(k));
      return { ok: true, count: st.count, rev: st.rev };
    });
    jobs.delete(roomId);
    if (res === 'notfound') throw err(404, 'That room is gone');
    if (res && res.changed) throw err(409, 'The stickers changed while you painted', { stale: true });
    if (res && res.ok) {
      broadcast(roomId, { type: 'surfacetex:update', tiles: changed, baked: j.kind === 'bake' ? ids : [], count: res.count, rev: res.rev });
      log.log?.(`[surfacetex] ${roomId}: ${j.kind} ${j.kind === 'bake' ? ids.length + ' stickers' : j.keys.length + ' tiles'} → ${Object.keys(changed).length} tiles (rev ${res.rev}, ${res.count} painted in)`);
    }
    // more: the backlog had more than one job's worth, or the baker left some of this job for the next (tile cap)
    const handled = ids.length + (Array.isArray(skipped) ? skipped.filter((id) => j.ids.has(String(id))).length : 0);
    const left = j.kind === 'bake' && ids.length > 0 && handled < j.ids.size;
    return { ok: true, tiles: changed, baked: j.kind === 'bake' ? ids.length : 0, more: !!j.more || left };
  }

  // Archived (painted-in) stickers matching pred go: their ids are remembered as removed and every tile they
  // may touch is marked stale (the next job repaints it from the archive without them). Returns the ids.
  async function removeArchived(roomId, pred) {
    const room = await store.peek(roomId);
    const st = room && room.surfaceTex;
    if (!st || !Array.isArray(st.segs) || !st.segs.length) return [];
    const already = new Set(st.removed || []), hit = [], hitSegs = new Set();
    for (const h of st.segs) {
      const recs = await readSeg(h); if (!recs) continue;
      for (const s of recs) if (!already.has(s.id) && pred(s)) { hit.push(s.id); hitSegs.add(h); }
    }
    if (!hit.length) return [];
    await store.editRoom(roomId, (r) => {
      const t = r.surfaceTex; if (!t) return { save: false };
      t.removed = [...new Set([...(t.removed || []), ...hit])];
      t.count = Math.max(0, (t.count || 0) - hit.length);
      const stale = new Set(t.stale || []);
      for (const [k, tile] of Object.entries(t.tiles || {})) if ((tile.segs || []).some((h) => hitSegs.has(h))) stale.add(k);
      t.stale = [...stale];
    });
    noteChange(roomId);
    return hit;
  }
  // Mark tiles to be repainted from the archive (admin; keys null = every tile).
  async function rebuild(roomId, keys = null) {
    const r = await store.editRoom(roomId, (room) => {
      const t = room.surfaceTex; if (!t || !t.tiles) return { save: false, n: 0 };
      const want = Array.isArray(keys) && keys.length ? keys.filter((k) => t.tiles[k]) : Object.keys(t.tiles);
      t.stale = [...new Set([...(t.stale || []), ...want])];
      return { n: want.length };
    });
    return r === 'notfound' ? 0 : r.n;
  }
  // The archive's records for a segment of this room (a rebuild job reads them), with their designs.
  async function segment(roomId, h) {
    if (!HASH_RE.test(String(h))) throw err(400, 'Bad segment');
    const room = await store.peek(roomId);
    const st = room && room.surfaceTex;
    if (!st || !(st.segs || []).includes(h)) throw err(404, 'No such segment here');
    const recs = (await readSeg(h)) || [];
    const removed = new Set(st.removed || []);
    const { images, stamps } = await withImages(recs.filter((s) => !removed.has(s.id)));
    return { stamps: stamps.map(publicStamp), images };
  }
  async function tileFile(file) {
    const m = /^([a-f0-9]{16})(-d|-h)?\.webp$/.exec(String(file));
    if (!m) return null;
    return adapter.get(imgKey(m[1], m[2] ? m[2].slice(1) : 'm'));
  }
  // Everything kept for a room: the live records + every archived one (a backup / export).
  async function exportRoom(roomId) {
    const room = await store.peek(roomId);
    if (!room) return null;
    const st = room.surfaceTex || null, archived = [];
    for (const h of (st && st.segs) || []) archived.push(...((await readSeg(h)) || []));
    return { room: roomId, at: new Date(clock()).toISOString(), live: room.stamps || [], archived, removed: (st && st.removed) || [], manifest: st };
  }
  async function status(roomId) {
    const room = await store.peek(roomId);
    const st = room && room.surfaceTex;
    const j = liveJob(roomId);
    return {
      on: on(), room: roomId, live: room ? (room.stamps || []).length : 0, painted: st ? st.count || 0 : 0, tiles: st ? Object.keys(st.tiles || {}).length : 0,
      segments: st ? (st.segs || []).length : 0, stale: st ? (st.stale || []).length : 0, removed: st ? (st.removed || []).length : 0,
      candidates: room ? ST.bakeCandidates(room.stamps || [], { max: Infinity, skip: skip.get(roomId) }).length : 0,
      job: j ? { id: j.id, kind: j.kind, ageMs: clock() - j.at } : null, calmMs: clock() - (lastChange.get(roomId) || 0), idleMs: settings.idleMs,
    };
  }
  // Delete tile pictures and segments nothing refers to (rooms + city presets). dry: only count.
  async function gc({ dry = true } = {}) {
    const imgs = new Set(), segs = new Set();
    const mark = (st) => {
      if (!st) return;
      for (const t of Object.values(st.tiles || {})) { if (t && t.img) imgs.add(t.img); for (const h of t.segs || []) segs.add(h); }
      for (const h of st.segs || []) segs.add(h);
    };
    for (const id of await store.listRooms()) { const r = await store.peek(id).catch(() => null); if (r) mark(r.surfaceTex); }
    for (const p of await listPresets()) for (const l of Object.values(p.layers || {})) mark(l && l.surfaceTex);
    let gone = 0, kept = 0;
    for (const k of await adapter.list('surfacetex/img/')) {
      const m = /^surfacetex\/img\/([a-f0-9]{16})(-[dh])?\.webp$/.exec(k);
      if (m && !imgs.has(m[1])) { gone++; if (!dry) await adapter.delete(k); } else kept++;
    }
    for (const k of await adapter.list('surfacetex/seg/')) {
      const m = /^surfacetex\/seg\/([a-f0-9]{16})\.json$/.exec(k);
      if (m && !segs.has(m[1])) { gone++; if (!dry) await adapter.delete(k); } else kept++;
    }
    return { dry, unreferenced: gone, kept };
  }
  return { noteChange, claim, putTile, commit, removeArchived, rebuild, segment, tileFile, exportRoom, status, gc, settings, on, jobs, isJob: (id) => JOB_RE.test(String(id)) };
}

module.exports = { createSurfaceTex, surfaceTexSettings, imgKey, segKey };
