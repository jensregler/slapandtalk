// "Nature" stickers (Jens, 28 Oct 2026): designs whose name starts with "nature" (any case – the
// library's original file name, `source`; the import tool gives every file from a "nature" folder
// that prefix). Jens Nov 2026: NO upper scale limit for nature or normal stickers (min only;
// Infinity/NaN rejected). NATURE.maxHeightCm is kept as a historical room-height hint only.
// The held size (state.size, stamp.size) is the sticker's LONGEST side.
// Used by the web app (size limits), the server (POST …/stamps) and tools/import-library.mjs.
import ROOM from './room.json' with { type: 'json' };
export const NATURE = {
  prefix: 'nature',
  maxHeightCm: Math.round(ROOM.height * 100), // tallest a nature sticker may be (cm) = the room's height (800)
  minCm: 10,        // smallest (cm, longest side) – also in the free version
};
// Every other sticker (cm, longest side). Jens, 10 Nov 2026 (t785u): 10 cm – 4 m (was: no upper cap,
// and 1.5 m before that). free = the free version's min gate (15 cm, unchanged), same 4 m max.
// The slap / peel pitch spans the same 10 cm – 4 m (shared/synth.mjs SIZE_PITCH).
export const STICKER_MAX_CM = 400;
export const STICKER_LIMITS = Object.freeze({ full: Object.freeze({ minCm: 10, maxCm: STICKER_MAX_CM }), free: Object.freeze({ minCm: 15, maxCm: STICKER_MAX_CM }) });
const RE = /^nature/i;
const base = (s) => String(s ?? '').split(/[\\/]/).pop();
// Does this file name count as a nature sticker?
export const isNatureName = (name) => RE.test(base(name));
// A design (library entry / image record): the flag from the import, or its original name.
export const isNature = (img) => !!img && (img.nature === true || isNatureName(img.source) || isNatureName(img.name));
// The longest side (cm) at which a nature design is NATURE.maxHeightCm high.
// maxHeightCm: the space's height (the city's outside: 24 m – shared/city.mjs natureMaxHeightCmIn; t482u).
export function natureMaxSideCm(img, maxHeightCm = NATURE.maxHeightCm) {
  const w = Number(img && img.width), h = Number(img && img.height);
  const a = w > 0 && h > 0 && Number.isFinite(w / h) ? Math.max(1, w / h) : 1;
  return maxHeightCm * a;
}
// The size limits (cm, longest side) for a design: { minCm, maxCm }. normal = the version's limits
// for every other sticker ({ minCm, maxCm }, maxCm may be Infinity).
export function sizeLimitsCm(img, normal, { maxHeightCm = NATURE.maxHeightCm } = {}) {
  // No upper scale limit (Jens Nov 2026). maxHeightCm kept for callers/tests of natureMaxSideCm only.
  void maxHeightCm;
  return isNature(img) ? { minCm: NATURE.minCm, maxCm: Infinity } : normal;
}
