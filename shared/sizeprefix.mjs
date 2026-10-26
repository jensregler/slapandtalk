// A letter at the start of an image's file name sets the sticker's starting SIZE: the value the
// size slider shows (Esc → Size), i.e. the sticker's longest side (= its height for square and
// portrait images).
//   "A_cat.png" → 15 cm, "B_cat.png" → 17.5 cm, "C_cat.png" → 20 cm … "Z_cat.png" → 77.5 cm
//   size = 15 cm + (letter index × 2.5 cm), A = index 0. No prefix → 15 cm (same as A).
// Rule: ONE letter A–Z (either case) at the very start of the base name, then "_", then a
// letter or digit. So "A_cat", "b_cat" are prefixed; "Apple", "A.png", "b-cat", "C cat",
// "A - cat" (the "Artist - title" form) and "A__cat" are not.
// Used by the web app (R/F, uploads), the server (image records, /api/library) and
// tools/import-library.mjs. Plain ESM, no dependencies.
export const PREFIX_BASE_CM = 15;
export const PREFIX_STEP_CM = 2.5;
export const DEFAULT_START_CM = 15; // no prefix (= A)
const RE = /^([A-Za-z])_(?=[\p{L}\p{N}])/u;

// "path/to/B_cat.final.png" → "B_cat.final"
export function baseName(name) {
  const b = String(name ?? '').split(/[\\/]/).pop();
  const dot = b.lastIndexOf('.');
  return dot > 0 ? b.slice(0, dot) : b;
}
export const letterCm = (letter) => {
  const i = String(letter || '').toUpperCase().charCodeAt(0) - 65;
  return i >= 0 && i < 26 ? PREFIX_BASE_CM + i * PREFIX_STEP_CM : null;
};
// → { letter: 'B', cm: 17.5 } or null
export function parsePrefix(name) {
  const m = RE.exec(baseName(name));
  return m ? { letter: m[1].toUpperCase(), cm: letterCm(m[1]) } : null;
}
// The starting height (cm) for a file name: the prefix, else 10 cm.
export const startHeightCm = (name) => parsePrefix(name)?.cm ?? DEFAULT_START_CM;
// The name without its size prefix, for anything that shows or reads the name ("B_Ulla - cat.png" → "Ulla - cat.png").
export function stripPrefix(name) {
  const s = String(name ?? '');
  const cut = s.lastIndexOf('/') >= s.lastIndexOf('\\') ? s.lastIndexOf('/') : s.lastIndexOf('\\');
  const dir = s.slice(0, cut + 1), file = s.slice(cut + 1);
  return parsePrefix(file) ? dir + file.slice(2) : s;
}
// Only the 26 letter heights count as a stored start height (anything else: unknown).
export const isStartCm = (v) => typeof v === 'number' && Number.isFinite(v) && v >= PREFIX_BASE_CM && v <= PREFIX_BASE_CM + 25 * PREFIX_STEP_CM
  && Math.abs((v - PREFIX_BASE_CM) / PREFIX_STEP_CM - Math.round((v - PREFIX_BASE_CM) / PREFIX_STEP_CM)) < 1e-9;
// A design's start size: its stored startCm, else from its original file name (library: source), else 15 cm.
export const designStartCm = (img) => (img && isStartCm(img.startCm) ? img.startCm : img && img.source ? startHeightCm(img.source) : DEFAULT_START_CM);

// The held size (= the sticker's LONGEST side, like the size slider and stamp.size): the letter
// value itself, for every aspect ratio. minCm / maxCm: the free version's 15 cm and 1 m (null or
// Infinity = no limit). Rounded to 0.5 cm.
const lim = (v) => typeof v === 'number' && v > 0 && Number.isFinite(v);
export function startSizeCm(img, { minCm = null, maxCm = null } = {}) {
  let side = designStartCm(img);
  if (lim(maxCm)) side = Math.min(side, maxCm);
  if (lim(minCm)) side = Math.max(side, minCm);
  return Math.round(side * 2) / 2;
}
