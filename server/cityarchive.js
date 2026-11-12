// Export / import a whole city as ONE file (Jens, t864u, 12 Nov 2026: "spara undan texturer så det inte
// försvinner" + build the city locally on his own PC, then put it on the live server).
//
// The file (<name>.satcity) is a gzipped tar whose entries are the storage keys themselves:
//   satcity.json                  what is in it: { format, v, city, name, nameLocked, rooms, counts, exportedAt }
//   rooms/<id>.json               the city's outside + every house that exists (stamps, props, look, name,
//                                 the surface-texture manifest room.surfaceTex …) – the whole room record
//   surfacetex/img/<h>[-d|-h].webp  every baked tile picture the manifests refer to (master + display + half)
//   surfacetex/seg/<h>.json       every archive segment (the painted-in stickers' records, to repaint a tile)
//   images/<id>.json + uploads/<id>.webp   every sticker design a live, archived or peel record uses
// The admin route GET /api/admin/surfacetex/:room/export (server/surfacetex.js exportRoom) gives the same
// sticker records as JSON; this file adds the pictures, so it can be put back anywhere.
//
// Import: content-addressed files (tiles, segments, designs) are added when missing (never overwritten);
// the rooms are put in place under the target city's ids (stad-abc123 → stad-xyz789, its houses with it). A
// room that is replaced is first copied to backups/cityimport/<time>/rooms/<id>.json.
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const CITY = require('../shared/city.mjs');
const { createTarWriter, createTarReader } = require('./tarstream');

const FORMAT = 'slapandtalk-city', VERSION = 1;
const HASH = /^[a-f0-9]{16}$/;
const err = (status, message) => Object.assign(new Error(message), { status });
// The only entries a city file may have (anything else is ignored – never a path outside these folders).
const ENTRY = {
  manifest: /^satcity\.json$/,
  room: /^rooms\/([a-z0-9-]{1,40})\.json$/,
  tile: /^surfacetex\/img\/([a-f0-9]{16})(-[dh])?\.webp$/,
  seg: /^surfacetex\/seg\/([a-f0-9]{16})\.json$/,
  image: /^images\/([a-f0-9]{16})\.json$/,
  upload: /^uploads\/([a-f0-9]{16})\.webp$/,
};
const isWebp = (b) => Buffer.isBuffer(b) && b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
const fileName = (name, city) => `${String(name || city).normalize('NFKD').replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || city}-${new Date().toISOString().slice(0, 10)}.satcity`;

// deps: surfaceTex (server/surfacetex.js – exportRoom gives a room's archived records), clock, log.
function createCityArchive(store, { surfaceTex = null, clock = () => Date.now(), log = console } = {}) {
  const adapter = store.adapter;
  async function roomsOf(city) {
    const ids = [];
    if (await store.peek(city)) ids.push(city);
    for (const h of CITY.houseIds(city)) if (await store.peek(h).catch(() => null)) ids.push(h);
    return ids;
  }

  // What a city file of this city would hold (without the bytes) – also the export's plan.
  async function plan(city) {
    if (!CITY.isCityOutside(city)) throw err(404, 'Not a city');
    const outside = await store.peek(city);
    if (!outside) throw err(404, 'That city does not exist');
    const rooms = [], tiles = new Set(), segs = new Set(), images = new Set();
    let stamps = 0, painted = 0;
    for (const id of await roomsOf(city)) {
      const room = await store.peek(id); if (!room) continue;
      rooms.push(room);
      for (const s of room.stamps || []) if (s && s.imageId) images.add(s.imageId);
      for (const p of room.peels || []) if (p && p.imageId) images.add(p.imageId);
      stamps += (room.stamps || []).length;
      const st = room.surfaceTex;
      if (st) {
        painted += st.count || 0;
        for (const t of Object.values(st.tiles || {})) { if (t && HASH.test(t.img)) tiles.add(t.img); for (const h of (t && t.segs) || []) if (HASH.test(h)) segs.add(h); }
        for (const h of st.segs || []) if (HASH.test(h)) segs.add(h);
        // the painted-in stickers' designs (the same records as GET /api/admin/surfacetex/:room/export)
        const ex = surfaceTex ? await surfaceTex.exportRoom(id).catch(() => null) : null;
        for (const s of (ex && ex.archived) || []) if (s && s.imageId) images.add(s.imageId);
      }
    }
    return {
      city, name: outside.name || (city === CITY.BUILD_CITY ? CITY.BUILD_CITY_NAME : city), nameLocked: !!outside.nameLocked,
      rooms, tiles: [...tiles], segs: [...segs], images: [...images].filter((i) => HASH.test(i)), stamps, painted,
    };
  }

  // Write the city file to `out` (a Writable – the HTTP response). Returns the manifest.
  async function exportCity(city, out) {
    const p = await plan(city);
    const gz = zlib.createGzip({ level: 6 });
    const piping = pipeline(gz, out);
    const tar = createTarWriter(gz);
    const manifest = {
      format: FORMAT, v: VERSION, city: p.city, name: p.name, nameLocked: p.nameLocked, exportedAt: new Date(clock()).toISOString(),
      rooms: p.rooms.map((r) => r.id), counts: { rooms: p.rooms.length, stamps: p.stamps, painted: p.painted, tiles: p.tiles.length, segments: p.segs.length, designs: p.images.length },
    };
    const missing = { tiles: 0, segs: 0, designs: 0 };
    try {
      await tar.add('satcity.json', Buffer.from(JSON.stringify(manifest, null, 1)));
      for (const r of p.rooms) await tar.add(`rooms/${r.id}.json`, Buffer.from(JSON.stringify(r)));
      for (const h of p.segs) { const b = await adapter.get(`surfacetex/seg/${h}.json`); if (b) await tar.add(`surfacetex/seg/${h}.json`, b); else missing.segs++; }
      for (const h of p.tiles) {
        let any = false;
        for (const k of ['', '-d', '-h']) { const b = await adapter.get(`surfacetex/img/${h}${k}.webp`); if (b) { any = true; await tar.add(`surfacetex/img/${h}${k}.webp`, b); } }
        if (!any) missing.tiles++;
      }
      for (const id of p.images) {
        const meta = await store.getImage(id), file = await store.getImageFile(id);
        if (!meta || !file) { missing.designs++; continue; }
        await tar.add(`images/${id}.json`, Buffer.from(JSON.stringify(meta)));
        await tar.add(`uploads/${id}.webp`, file);
      }
      await tar.end();
    } catch (e) { gz.destroy(e); throw e; }
    await piping;
    log.log?.(`[cityfile] export ${city}: ${manifest.counts.rooms} rooms, ${manifest.counts.stamps} live + ${manifest.counts.painted} painted stickers, ${manifest.counts.tiles} tiles, ${manifest.counts.designs} designs` + (missing.tiles + missing.segs + missing.designs ? ` (missing: ${JSON.stringify(missing)})` : ''));
    return { ...manifest, missing };
  }

  // Read a city file from `input` (a Readable – the HTTP request body) and put the city in place.
  // target: 'same' (the city id in the file), 'new' (a fresh city id) or a city id (stad-xxxxxx).
  async function importCity(input, { target = 'same', maxBytes } = {}) {
    let manifest = null;
    const rooms = new Map(), counts = { tiles: 0, segs: 0, designs: 0, kept: 0, ignored: 0 };
    const putOnce = async (key, buf, type) => { if (await adapter.exists(key)) { counts.kept++; return false; } await adapter.put(key, buf, type); return true; };
    const reader = createTarReader(async (e, buf) => {
      const name = e.name;
      if (e.type !== '0' && e.type !== '\0') { counts.ignored++; return; }
      let m;
      if (ENTRY.manifest.test(name)) {
        try { manifest = JSON.parse(buf.toString('utf8')); } catch { throw err(400, 'The city file is damaged (satcity.json)'); }
        if (!manifest || manifest.format !== FORMAT) throw err(400, 'Not a Slap and Talk city file');
        if (Number(manifest.v) > VERSION) throw err(400, 'This city file is from a newer version of Slap and Talk');
      } else if ((m = ENTRY.room.exec(name))) {
        if (!CITY.isCityRoom(m[1])) { counts.ignored++; return; }
        let r; try { r = JSON.parse(buf.toString('utf8')); } catch { throw err(400, `The city file is damaged (${name})`); }
        if (!r || typeof r !== 'object' || Array.isArray(r)) throw err(400, `The city file is damaged (${name})`);
        rooms.set(m[1], r);
      } else if ((m = ENTRY.tile.exec(name))) {
        if (!isWebp(buf)) throw err(400, `The city file is damaged (${name})`);
        if (await putOnce(name, buf, 'image/webp')) counts.tiles++;
      } else if ((m = ENTRY.seg.exec(name))) {
        try { JSON.parse(buf.toString('utf8')); } catch { throw err(400, `The city file is damaged (${name})`); }
        if (await putOnce(name, buf, 'application/json')) counts.segs++;
      } else if ((m = ENTRY.image.exec(name))) {
        let meta; try { meta = JSON.parse(buf.toString('utf8')); } catch { throw err(400, `The city file is damaged (${name})`); }
        if (!meta || meta.id !== m[1]) throw err(400, `The city file is damaged (${name})`);
        if (!(await store.getImage(m[1]))) { await store.addImage(meta); counts.designs++; } else counts.kept++;
      } else if ((m = ENTRY.upload.exec(name))) {
        if (!isWebp(buf)) throw err(400, `The city file is damaged (${name})`);
        if (!(await store.hasImageFile(m[1], { fresh: true }))) await store.putImageFile(m[1], buf); else counts.kept++;
      } else counts.ignored++;
    }, maxBytes ? { maxTotal: maxBytes } : {});
    try { await pipeline(input, zlib.createGunzip(), reader); }
    catch (e) { if (e.status) throw e; throw err(400, e && /tar:|incorrect header|unexpected end|invalid/i.test(e.message || '') ? `Not a readable city file (${e.message})` : (e.message || 'Could not read the city file')); }
    if (!manifest) throw err(400, 'Not a Slap and Talk city file (no satcity.json)');
    const from = String(manifest.city || '');
    if (!CITY.isCityOutside(from) || !rooms.has(from)) throw err(400, 'The city file has no city in it');

    // where it goes
    let to = target === 'same' || !target ? from : String(target);
    if (to === 'new') {
      to = null;
      for (let k = 0; k < 40 && !to; k++) { const c = CITY.newCityId(); if (c !== CITY.BUILD_CITY && !(await store.peek(c))) to = c; }
      if (!to) throw err(500, 'Could not find a free city code');
    }
    if (!CITY.isCityOutside(to)) throw err(400, 'Import into a city (stad-…)');
    const mapId = (id) => { const p = CITY.parseCityRoom(id); if (!p || p.city !== from) return null; return p.n ? CITY.houseId(to, p.n) : to; };

    const stamp = new Date(clock()).toISOString().replace(/[:.]/g, '-');
    const backup = `backups/cityimport/${stamp}`;
    const written = [];
    let backedUp = 0;
    for (const [id, data] of rooms) {
      const dest = mapId(id); if (!dest) continue;
      const old = await store.peek(dest);
      if (old) { await adapter.put(`${backup}/rooms/${dest}.json`, Buffer.from(JSON.stringify(old)), 'application/json'); backedUp++; }
      const rec = { ...data, id: dest, importedAt: new Date(clock()).toISOString(), importedFrom: from };
      if (CITY.parseCityRoom(dest).n) rec.city = to; // a house knows its city
      await store.replaceRoom(dest, rec);
      if (surfaceTex && surfaceTex.jobs && typeof surfaceTex.jobs.delete === 'function') surfaceTex.jobs.delete(dest); // a bake on the old room is void
      written.push(dest);
    }
    const out = { ok: true, city: to, from, name: rooms.get(from).name || manifest.name || null, rooms: written, added: counts, backup: backedUp ? backup : null };
    log.log?.(`[cityfile] import ${from} → ${to}: ${written.length} rooms, +${counts.tiles} tiles, +${counts.segs} segments, +${counts.designs} designs${backedUp ? `, backup ${backup}` : ''}`);
    return out;
  }

  return { plan, exportCity, importCity, fileName, FORMAT, VERSION };
}

module.exports = { createCityArchive, fileName, FORMAT, VERSION };
