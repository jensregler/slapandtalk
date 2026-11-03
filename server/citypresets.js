// City presets (Jens, t493u, 3 Nov 2026: "vi bygger EN stad och den sparas som en preset – alla får
// samma stad från början"). Like the room presets (server/presets.js), but a city preset is a
// SNAPSHOT of the stickers placed in a whole city – its outside and its houses 1–8 by number – kept as
// sticker records (not baked images), so a new city gets real stickers in the same places.
//
//   "citypresets/<id>.json"  { id, name, default: true|false, source, createdAt, updatedAt,
//                              layers: { outside: { stamps, geo, style? }, '1': { … }, … '8': { … } } }
//
// One preset is the DEFAULT: every new city (server/cities.js) copies its outside when the city is
// started and its house n when house n is started. A copy: what players do in their city never
// changes the preset (the copied stickers carry no peel key, so nobody but admin can take them off).
// The build city (shared/city.mjs BUILD_CITY, Jens decorates there): while CITY_BUILD_PHASE is on,
// every change in it saves the build city into the default preset by itself (autosave(), a few
// seconds after the last change; flush() at shutdown). Admin can also snapshot any city as a NEW named
// preset, make another one the default, rename or delete one (/api/admin/citypresets,
// scripts/make-preset.js --city …). The Town Hall has no room inside (its door opens the pack shop),
// so there is nothing of it to keep besides its outside walls – those are part of 'outside'.
const crypto = require('crypto');
const CITY = require('../shared/city.mjs');

const ID_RE = /^[a-z0-9]{6,16}$/;
const cleanName = (v) => Array.from(String(v ?? '').normalize('NFC').replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '').replace(/\s+/g, ' ').trim()).slice(0, 40).join('').trim();
// A sticker as it goes into a preset / into a new city: never a peel key, owner or maker.
const cleanStamp = ({ peelHash, peelOwner, madeBy, group, ...s }) => s;
const err = (status, message) => Object.assign(new Error(message), { status });

function createCityPresets(store, { clock = () => Date.now(), autosaveMs = 2000, log = console, timers = { setTimeout, clearTimeout } } = {}) {
  const adapter = store.adapter;
  const key = (id) => `citypresets/${id}.json`;
  const iso = () => new Date(clock()).toISOString();
  let cache = null; // id -> preset (this server is the only writer)
  let chain = Promise.resolve(); // one write at a time
  const serial = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };
  async function load() {
    if (cache) return cache;
    const next = new Map();
    const keys = await adapter.list('citypresets/'); // a failed list throws (nothing cached: the next call tries again)
    for (const k of keys) {
      const m = /^citypresets\/([a-z0-9]+)\.json$/.exec(k); if (!m) continue;
      try { const b = await adapter.get(k); if (b) { const p = JSON.parse(b.toString('utf8')); if (p && p.id === m[1]) next.set(p.id, p); } } catch { /* broken: skip */ }
    }
    cache = next; return cache;
  }
  const summary = (p) => ({ id: p.id, name: p.name, default: !!p.default, source: p.source || null, createdAt: p.createdAt, updatedAt: p.updatedAt,
    stickers: Object.fromEntries(Object.entries(p.layers || {}).map(([l, v]) => [l, (v.stamps || []).length])) });
  const list = async () => [...(await load()).values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const get = async (id) => (ID_RE.test(String(id)) ? (await load()).get(id) || null : null);
  const getDefault = async () => (await list()).find((p) => p.default) || null;
  async function put(p) { await adapter.put(key(p.id), Buffer.from(JSON.stringify(p)), 'application/json'); (await load()).set(p.id, p); return p; }

  // Everything placed in a city now: { outside: { stamps, geo, style? }, '1': … } (only the parts that exist).
  async function snapshot(city = CITY.BUILD_CITY) {
    if (!CITY.isCityOutside(city)) throw err(400, 'Not a city');
    const layers = {};
    for (const layer of CITY.CITY_LAYERS) {
      const id = layer === 'outside' ? city : CITY.houseId(city, Number(layer));
      const r = await store.peek(id); // a storage error throws: never save a half-read city over the preset
      if (!r) continue;
      // geo: the box the stickers are in (normalize() in store.js would otherwise put them away / move them)
      layers[layer] = { stamps: (r.stamps || []).map(cleanStamp), ...(r.geo ? { geo: r.geo } : {}), ...(r.style ? { style: r.style } : {}) };
    }
    return layers;
  }
  // Save a city as a preset. id: overwrite that one; else a new one. makeDefault: it becomes THE default.
  function save({ from = CITY.BUILD_CITY, name = '', id = null, makeDefault = false } = {}) {
    return serial(async () => {
      const layers = await snapshot(from);
      const all = await load();
      const old = id ? all.get(id) : null;
      if (id && !old) throw err(404, 'No such city preset');
      const now = iso();
      const p = { ...(old || { id: crypto.randomBytes(5).toString('hex'), createdAt: now, default: false }), name: cleanName(name) || (old && old.name) || 'A city', source: from, updatedAt: now, layers };
      if (makeDefault || !(await getDefault())) p.default = true; // the first one is the default
      if (p.default) for (const o of all.values()) if (o.id !== p.id && o.default) await put({ ...o, default: false });
      return put(p);
    });
  }
  // The build city into the default preset (made the first time: "The City").
  async function saveDefault() { const d = await getDefault(); return save({ from: CITY.BUILD_CITY, id: d ? d.id : null, name: d ? d.name : 'The City', makeDefault: true }); }
  let timer = null, dirty = false;
  // A change in the build city (app.js): save it a moment after the last one (only in the build phase).
  function autosave(roomId) {
    if (!CITY.CITY_BUILD_PHASE || (roomId && !CITY.isBuildCity(roomId))) return false;
    dirty = true;
    if (timer) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => { timer = null; flush().catch((e) => log.error?.('[citypresets] autosave failed', e && e.message)); }, autosaveMs);
    if (timer && timer.unref) timer.unref();
    return true;
  }
  async function flush() {
    if (timer) { timers.clearTimeout(timer); timer = null; }
    if (!dirty) return null;
    dirty = false;
    try { const p = await saveDefault(); log.log?.(`[citypresets] build city saved into "${p.name}" (${p.id})`); return p; }
    catch (e) { dirty = true; throw e; }
  }
  async function setDefault(id) {
    return serial(async () => {
      const p = await get(id); if (!p) return null;
      for (const o of (await load()).values()) if (o.default && o.id !== id) await put({ ...o, default: false });
      return put({ ...p, default: true });
    });
  }
  async function rename(id, name) { return serial(async () => { const p = await get(id); if (!p) return null; return put({ ...p, name: cleanName(name) || p.name }); }); }
  async function remove(id) { return serial(async () => { const p = await get(id); if (!p) return false; await adapter.delete(key(id)); (await load()).delete(id); return true; }); }
  // What a new city's part gets from the default preset: { stamps, style? } (copies), or null.
  async function layerFor(layer) {
    let d = null;
    try { d = await getDefault(); } catch (e) { log.error?.('[citypresets] could not read the presets', e && e.message); return null; }
    const l = d && d.layers && d.layers[layer];
    if (!l) return null;
    return { preset: d.id, stamps: structuredClone((l.stamps || []).map(cleanStamp)), ...(l.geo ? { geo: l.geo } : {}), ...(l.style ? { style: structuredClone(l.style) } : {}) };
  }
  return { list, get, getDefault, summary, snapshot, save, saveDefault, autosave, flush, setDefault, rename, remove, layerFor, pending: () => dirty };
}
module.exports = { createCityPresets };
