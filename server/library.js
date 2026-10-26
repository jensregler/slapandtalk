// The curated sticker library: ready-made designs (from Jens and invited friends) that everyone
// can slap, with the artist's name on each so the Look-mode credit works.
//
// On disk (in the repo, built by tools/import-library.mjs):
//   library/manifest.json   { stickers: [{ id, file, width, height, artist, link?, title? }] }
//   library/images/<id>.webp  (re-encoded like an upload: WebP, max 1024 px, no metadata; id = content hash)
// At start-up seedLibrary() copies every one into the normal image storage (images/<id>.json +
// uploads/<id>.webp, R2 in production) with library: true, so stamps of them work exactly like
// any other sticker. It is idempotent: what is already there is left alone.
const fs = require('fs');
const path = require('path');
const { contentId } = require('./store');

const LIB_DIR = path.join(__dirname, '..', 'library');
const ID_RE = /^[a-f0-9]{16}$/;

function loadLibrary(dir = LIB_DIR) {
  let man;
  try { man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch { return []; }
  const list = Array.isArray(man) ? man : Array.isArray(man.stickers) ? man.stickers : [];
  return list.filter((s) => s && ID_RE.test(s.id) && typeof s.file === 'string').map((s) => ({
    id: s.id, file: path.join(dir, 'images', path.basename(s.file)), width: s.width | 0, height: s.height | 0,
    artist: String(s.artist || '').slice(0, 60), ...(s.link ? { link: String(s.link).slice(0, 200) } : {}), ...(s.title ? { title: String(s.title).slice(0, 80) } : {}),
  }));
}

// Public form (GET /api/library): what the palette needs.
const publicSticker = (s) => ({ id: s.id, url: `/uploads/${s.id}.webp`, width: s.width, height: s.height, artist: s.artist, ...(s.link ? { artistLink: s.link } : {}), library: true });

async function seedLibrary(store, list, { log = console } = {}) {
  let added = 0, bad = 0;
  for (const s of list) {
    try {
      const meta = await store.getImage(s.id);
      if (meta && meta.library && await store.hasImageFile(s.id, { fresh: true })) continue;
      const buf = fs.readFileSync(s.file);
      if (contentId(buf) !== s.id) { bad++; log.error(`[library] ${path.basename(s.file)}: content does not match id ${s.id}, skipped`); continue; }
      await store.putImageFile(s.id, buf);
      await store.addImage({ id: s.id, url: `/uploads/${s.id}.webp`, width: s.width, height: s.height, artist: s.artist, ...(s.link ? { artistLink: s.link } : {}), library: true, createdAt: (meta && meta.createdAt) || new Date().toISOString() });
      added++;
    } catch (e) { bad++; log.error(`[library] ${s.id}: ${e.message}`); }
  }
  if (added || bad) log.log(`[library] ${list.length} stickers: ${added} added to storage${bad ? `, ${bad} failed` : ''}`);
  return { total: list.length, added, bad };
}

module.exports = { LIB_DIR, loadLibrary, seedLibrary, publicSticker };
