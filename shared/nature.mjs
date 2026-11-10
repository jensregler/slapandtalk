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
  minCm: 0.01,      // = STICKER_EPSILON_CM: no gameplay floor (Jens, 11 Nov 2026; was 15 cm t788u, 10 cm before)
};
// Every sticker (cm, longest side). Jens, 11 Nov 2026 (voice): scale stickers freely up and down while
// playing – NO upper and NO lower limit on the graphic (t788u's 15 cm floor and t785u's 10 cm – 4 m are
// gone). The only floor is a technical epsilon, STICKER_EPSILON_CM = 0.01 cm (0.1 mm), so a sticker's
// mesh never reaches zero / negative scale (degenerate geometry, inverted faces, divide-by-zero in the
// array spacing) and stays well above the float32 / 1 µm position rounding (shared/array.mjs r6) even
// in the 96 m city. At 0.1 mm a sticker is far below one pixel – visually it is "no limit".
// Only the SOUND is bounded: slap / peel / landing pitch is clamped to 15 cm – 4 m (shared/synth.mjs
// SIZE_PITCH); a smaller sticker sounds like a 15 cm one, a bigger one like a 4 m one.
export const STICKER_EPSILON_CM = 0.01;
export const STICKER_EPSILON_M = STICKER_EPSILON_CM / 100;
export const STICKER_MIN_CM = STICKER_EPSILON_CM;
// The held size's rounding (cm): 0.5 cm steps from 10 cm up (as before – the letter sizes are 2.5 cm
// apart), 3 significant digits below 10 cm so free scaling (wheel ×0.9 / ×1.1, pinch) never sticks or
// rounds to 0; never below the epsilon. Non-finite in → returned unchanged (callers guard).
export function roundSizeCm(cm) {
  const n = Number(cm);
  if (!Number.isFinite(n)) return n;
  const r = n >= 10 ? Math.round(n * 2) / 2 : Number(n.toPrecision(3));
  return Math.max(STICKER_EPSILON_CM, r);
}
// The size label shown in the game (English UI): "30 cm", "2.5 cm", "0.35 cm", "1,200 cm".
export function sizeLabel(cm, locale = 'en') {
  const r = roundSizeCm(cm);
  return `${Number.isFinite(r) ? r.toLocaleString(locale, { maximumFractionDigits: 4 }) : '–'} cm`;
}
export const STICKER_LIMITS = Object.freeze({ full: Object.freeze({ minCm: STICKER_MIN_CM, maxCm: Infinity }), free: Object.freeze({ minCm: STICKER_MIN_CM, maxCm: Infinity }) });
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
