// Per-surface sticker bake rule (Jens, Nov 2026, release prep):
// When a surface (wall / floor / ceiling / prop mesh) has MORE than LIVE_PER_SURFACE stickers,
// bake the ones older than the newest LIVE_PER_SURFACE into one merged draw for that surface.
// The newest LIVE_PER_SURFACE stay editable (live meshes / peelable). Surfaces at or under the
// threshold are left alone.
export const LIVE_PER_SURFACE = 20;

// stamps: [{ id, order, surface, ... }]. keepExtra: ids that must stay live (e.g. my peel history).
// Returns the set of stamp ids that should remain live meshes.
export function idsToKeepLive(stamps, { perSurface = LIVE_PER_SURFACE, keepExtra = [] } = {}) {
  const keep = new Set(keepExtra);
  const bySurf = new Map();
  for (const s of stamps || []) {
    if (!s || !s.id) continue;
    const k = String(s.surface || '');
    let list = bySurf.get(k);
    if (!list) { list = []; bySurf.set(k, list); }
    list.push(s);
  }
  for (const list of bySurf.values()) {
    list.sort((a, b) => (b.order || 0) - (a.order || 0));
    for (const s of list.slice(0, Math.max(0, perSurface))) keep.add(s.id);
  }
  return keep;
}

// Stamp ids that should be painted in (baked) given the same rule.
export function idsToBake(stamps, opts) {
  const keep = idsToKeepLive(stamps, opts);
  return (stamps || []).filter((s) => s && s.id && !keep.has(s.id)).map((s) => s.id);
}
