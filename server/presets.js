// Preset rooms (Jens, 29 Oct 2026): rooms Jens designs with the nature stickers, saved as SIX images
// (floor, ceiling and the four walls, the stickers baked in) instead of sticker objects. A new user's
// first room gets one of them at random: its look (style) plus the six images laid over the surfaces,
// which nobody can peel or change; the walls (the look) are locked. People still slap their own
// stickers on top. No presets = everything as before.
//
// Storage (the same adapter as everything else):
//   "presets/<id>.json"          { id, name, sourceRoom, style, faces: { floor: url, … }, px, createdAt }
//   "presets/<id>/<face>.webp"   the baked image of that surface (transparent where there is no sticker)
//   "presets/<id>/thumb.webp"    (optional) a picture of the room, for the start card's room picker
// title: the display name Jens gives a preset (Jens, 2 Nov 2026: "jag vill döpa dom"); until he has,
// the picker shows the room code it was made from (sourceRoom). Set with
// `node scripts/make-preset.js --rename <id or room code> "Name"` (PATCH /api/admin/presets/:id).
// The images are made in the browser (client/src/preset.js bakes the room's stickers, admin only)
// and sent here (POST /api/admin/presets); scripts/make-preset.js does it from a room code.
const crypto = require('crypto');
const sharp = require('sharp');

const FACES = ['floor', 'ceiling', 'north', 'south', 'west', 'east'];
const ID_RE = /^[a-z0-9]{8,16}$/;
const MAX_PX = 4096;
// a display name: like a room name, max 40 characters, no control characters
const cleanTitle = (v) => Array.from(String(v ?? '').normalize('NFC').replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '').replace(/\s+/g, ' ').trim()).slice(0, 40).join('').trim();
const faceUrl = (id, face, v) => `/api/presets/${id}/${face}.webp?v=${v}`;

function createPresets(adapter, { log = console } = {}) {
  let cache = null; // id -> preset (loaded once; this server is the only writer)
  async function load() {
    if (cache) return cache;
    const next = new Map();
    let keys = [];
    // A failed list is NOT "no presets": nothing is cached (the next call tries again) and it throws, so
    // the cleanups keep every room this round (server/index.js) and the picker just shows Blank room.
    try { keys = await adapter.list('presets/'); } catch (e) { log.error?.('[presets] list failed', e && e.message); throw e; }
    for (const k of keys) {
      const m = /^presets\/([a-z0-9]+)\.json$/.exec(k); if (!m) continue;
      try { const buf = await adapter.get(k); if (buf) { const p = JSON.parse(buf.toString('utf8')); if (p && p.id === m[1]) next.set(p.id, p); } } catch { /* a broken one: skip */ }
    }
    cache = next; return cache;
  }
  const list = async () => [...(await load()).values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const get = async (id) => (ID_RE.test(String(id)) ? (await load()).get(id) || null : null);
  // A random preset (rand = () => [0, 1)), or null when there are none.
  async function pick(rand = Math.random) { const all = await list().catch(() => []); return all.length ? all[Math.floor(rand() * all.length) % all.length] : null; }
  // files: { floor: Buffer, … } – all six. Each is re-encoded (WebP, alpha kept) and checked.
  async function create({ name = '', title = '', sourceRoom = null, style = null, files, thumb = null }) {
    const missing = FACES.filter((f) => !files || !files[f]);
    if (missing.length) throw Object.assign(new Error(`Missing images: ${missing.join(', ')}`), { status: 400 });
    const id = crypto.randomBytes(5).toString('hex');
    const out = {};
    let px = 0;
    for (const f of FACES) {
      let meta;
      try { meta = await sharp(files[f]).metadata(); } catch { throw Object.assign(new Error(`${f}: not an image`), { status: 400 }); }
      if (!meta.width || !meta.height || meta.width > MAX_PX || meta.height > MAX_PX) throw Object.assign(new Error(`${f}: ${meta.width}×${meta.height} px (max ${MAX_PX})`), { status: 400 });
      out[f] = await sharp(files[f]).webp({ quality: 90, alphaQuality: 100, effort: 4 }).toBuffer();
      px = Math.max(px, meta.width, meta.height);
    }
    for (const f of FACES) await adapter.put(`presets/${id}/${f}.webp`, out[f], 'image/webp');
    const v = Date.now().toString(36);
    const preset = { id, name: String(name || '').slice(0, 60), sourceRoom: sourceRoom ? String(sourceRoom).slice(0, 40) : null, style: style || null,
      faces: Object.fromEntries(FACES.map((f) => [f, faceUrl(id, f, v)])), px, createdAt: new Date().toISOString(), ...(cleanTitle(title) ? { title: cleanTitle(title) } : {}) };
    await adapter.put(`presets/${id}.json`, Buffer.from(JSON.stringify(preset)), 'application/json');
    (await load()).set(id, preset);
    if (thumb) { try { return await setThumb(id, thumb); } catch (e) { log.error?.('[presets] picture failed', e && e.message); } }
    return preset;
  }
  async function remove(id) {
    const p = await get(id); if (!p) return false;
    await adapter.delete(`presets/${id}.json`);
    for (const f of FACES) await adapter.delete(`presets/${id}/${f}.webp`).catch(() => {});
    (await load()).delete(id);
    return true;
  }
  const image = (id, face) => (ID_RE.test(String(id)) && (FACES.includes(face) || face === 'thumb') ? adapter.get(`presets/${id}/${face}.webp`) : Promise.resolve(null));
  // The display name (title; '' = none, the picker shows the room code). id may also be the room code.
  const find = async (idOrCode) => { const k = String(idOrCode || '').toLowerCase(); return (await get(k)) || (await list()).find((p) => p.sourceRoom === k) || null; };
  async function save(p) { await adapter.put(`presets/${p.id}.json`, Buffer.from(JSON.stringify(p)), 'application/json'); (await load()).set(p.id, p); return p; }
  async function rename(idOrCode, title) {
    const p = await find(idOrCode); if (!p) return null;
    const t = cleanTitle(title);
    const next = { ...p }; if (t) next.title = t; else delete next.title;
    return save(next);
  }
  // The room's picture for the picker (any image; stored as a WebP ≤ 960 px wide).
  async function setThumb(idOrCode, buf) {
    const p = await find(idOrCode); if (!p) return null;
    let out;
    try { out = await sharp(buf).resize({ width: 960, height: 600, fit: 'cover' }).webp({ quality: 82, effort: 4 }).toBuffer(); } catch { throw Object.assign(new Error('not an image'), { status: 400 }); }
    await adapter.put(`presets/${p.id}/thumb.webp`, out, 'image/webp');
    return save({ ...p, thumb: `/api/presets/${p.id}/thumb.webp?v=${Date.now().toString(36)}` });
  }
  // What the start card's picker gets (public): no style, no faces – the name, the code, a picture.
  // No picture yet: the north wall's baked image (the stickers on it) stands in.
  const publicList = async () => (await list().catch(() => [])).map((p) => ({ id: p.id, title: p.title || '', code: p.sourceRoom || p.id, thumb: p.thumb || null, wall: (p.faces && p.faces.north) || null }));
  // What a room carries (self-contained, so the room shows even if the preset list is not loaded).
  const forRoom = (p) => ({ id: p.id, faces: { ...p.faces } });
  return { FACES, list, get, find, pick, create, remove, image, forRoom, rename, setThumb, publicList };
}

module.exports = { createPresets, PRESET_FACES: FACES };
