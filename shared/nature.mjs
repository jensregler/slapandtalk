// "Nature" stickers (Jens, 28 Oct 2026): designs whose name starts with "nature" (any case – the
// library's original file name, `source`; the import tool gives every file from a "nature" folder
// that prefix) may be scaled far beyond the normal limits: from NATURE.minCm (10 cm) up to a HEIGHT of
// NATURE.maxHeightCm = the room's height (8 m; Jens, 2 Nov 2026, t475u – was 5 cm – 4 m), in the free
// and the full version alike. Every other sticker keeps the normal limits (STICKER_LIMITS: the full
// version 10 cm – 1.5 m, t475u – was 5 cm – no limit; free 15 cm – 1 m; the server's technical floor 2 cm).
// The held size (state.size, stamp.size) is the sticker's LONGEST side, so the 8 m height cap is a
// longest-side cap of 8 m × (longest / height) – 8 m for square and portrait, more for a wide one.
// Used by the web app (size limits), the server (POST …/stamps) and tools/import-library.mjs.
import ROOM from './room.json' with { type: 'json' };
export const NATURE = {
  prefix: 'nature',
  maxHeightCm: Math.round(ROOM.height * 100), // tallest a nature sticker may be (cm) = the room's height (800)
  minCm: 10,        // smallest (cm, longest side) – also in the free version
};
// Every other sticker (cm, longest side; Jens, 2 Nov 2026: "maxstorlek på klibbor till 1,5 m samt
// ministorlek till 0,1 m"). full = the full version (bigStickers); free = the free version's gate inside it.
export const STICKER_LIMITS = Object.freeze({ full: Object.freeze({ minCm: 10, maxCm: 150 }), free: Object.freeze({ minCm: 15, maxCm: 100 }) });
const RE = /^nature/i;
const base = (s) => String(s ?? '').split(/[\\/]/).pop();
// Does this file name count as a nature sticker?
export const isNatureName = (name) => RE.test(base(name));
// A design (library entry / image record): the flag from the import, or its original name.
export const isNature = (img) => !!img && (img.nature === true || isNatureName(img.source) || isNatureName(img.name));
// The longest side (cm) at which a nature design is NATURE.maxHeightCm high.
export function natureMaxSideCm(img) {
  const w = Number(img && img.width), h = Number(img && img.height);
  const a = w > 0 && h > 0 && Number.isFinite(w / h) ? Math.max(1, w / h) : 1;
  return NATURE.maxHeightCm * a;
}
// The size limits (cm, longest side) for a design: { minCm, maxCm }. normal = the version's limits
// for every other sticker ({ minCm, maxCm }, maxCm may be Infinity).
export function sizeLimitsCm(img, normal) {
  return isNature(img) ? { minCm: NATURE.minCm, maxCm: natureMaxSideCm(img) } : normal;
}
