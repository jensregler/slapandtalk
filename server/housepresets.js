// The room presets in the city's kept houses (Jens, 10 Nov 2026, pt781u + sketch notes; shared/city.mjs
// HOUSE_PRESETS): house 1 "small village in forrest", 3 "Reglersro", 6 "modern office", 8 "Cozy Village".
// Resolved against the room presets there are (server/presets.js) – by id first, then by title – so a
// re-made preset with the same name still lands in its house, and a missing one just means a plain house.
const CITY = require('../shared/city.mjs');

const norm = (v) => String(v || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

function createHousePresets(presets, { log = console } = {}) {
  async function resolve(n) {
    const want = CITY.HOUSE_PRESETS[Number(n)];
    if (!want || !presets) return null;
    try {
      const byId = want.id ? await presets.get(want.id) : null;
      if (byId) return byId;
      const all = await presets.list();
      return all.find((p) => norm(p.title) === norm(want.title))
        || all.find((p) => want.match && norm(p.title).includes(norm(want.match)))
        || null;
    } catch (e) { log.error?.('[housepresets] could not read presets', e && e.message); return null; }
  }
  // What a kept house's room gets from its preset: { preset, style?, props? } (store.createRoom extra), or null.
  async function extraFor(n) {
    const p = await resolve(n);
    if (!p) return null;
    return { preset: presets.forRoom(p), ...(p.style ? { style: p.style } : {}), ...(Array.isArray(p.props) ? { props: p.props } : {}) };
  }
  return { resolve, extraFor };
}
module.exports = { createHousePresets };
