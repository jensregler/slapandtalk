// Fabrics ("tyg"): an uploaded image tiled over one body part instead of a flat colour.
// One shared set of rules for the browser and the tests; the server (CommonJS) has the same
// rules in server/realtime.js (cleanFabrics), and tests/fabric.test.mjs checks they agree.
//
// look.fabric = { shirt: { id, scale, rot, hue, cycleHue, hueHz, spin, spinHz, scroll }, pants: {...}, ... }
//   id      16 hex chars: an image stored with POST /api/fabrics (served at /uploads/<id>.webp)
//   scale   tile size (× 25 cm), rot = pattern angle (°), hue = hue shift around the colour wheel (°)
//   cycleHue + hueHz  = the hue goes round the wheel hueHz times per second
//   spin + spinHz     = the pattern turns round hueHz times per second
//   scroll            = the pattern slides (tiles per second)
// Slots without a fabric use their colour. Old clients don't know `fabric` and just show the colour.
import FABRIC from './fabric.json' with { type: 'json' };

export { FABRIC };
export const FABRIC_ID_RE = /^[a-f0-9]{16}$/;
const round = (n) => Math.round(n * 1000) / 1000;

export function cleanParam(name, v) {
  const p = FABRIC.params[name];
  let n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return p.def;
  if (p.wrap) n = ((n % 360) + 360) % 360;
  else n = Math.min(p.max, Math.max(p.min, n));
  return round(n);
}
export function cleanFabric(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f) || typeof f.id !== 'string' || !FABRIC_ID_RE.test(f.id)) return null;
  const out = { id: f.id };
  for (const k of Object.keys(FABRIC.params)) out[k] = cleanParam(k, f[k]);
  for (const k of FABRIC.flags) out[k] = f[k] === true;
  return out;
}
// Returns null when no slot has a fabric (so the look stays exactly like before).
export function cleanFabrics(fs) {
  if (!fs || typeof fs !== 'object' || Array.isArray(fs)) return null;
  const out = {};
  for (const s of FABRIC.slots) { const f = cleanFabric(fs[s]); if (f) out[s] = f; }
  return Object.keys(out).length ? out : null;
}
export const defaultFabric = (id) => cleanFabric({ id });

// Where the pattern is right now. Uses the wall clock (ms), so everyone in the room sees the
// same phase; computed in double precision on the CPU so long sessions don't drift or jitter.
export function fabricPhase(f, tMs = Date.now()) {
  const t = tMs / 1000;
  const frac = (x) => x - Math.floor(x);
  const rot = f.spin ? (f.rot + 360 * frac(t * f.spinHz)) % 360 : f.rot;
  const hue = f.cycleHue ? (f.hue + 360 * frac(t * f.hueHz)) % 360 : f.hue;
  const offset = f.scroll ? frac(t * f.scroll) : 0;
  return { rot, hue, offset };
}

// Texture size for an image: a square power of two, minPx..maxPx (the image is fitted inside, the rest transparent).
export function fabricSize(w, h) {
  const m = Math.max(1, w | 0, h | 0);
  return Math.min(FABRIC.maxPx, Math.max(FABRIC.minPx, 2 ** Math.ceil(Math.log2(m))));
}

// Wild random params (for 🌀 Randomize).
export function randomFabricParams(id, rand = Math.random) {
  const r = (a, b) => a + (b - a) * rand();
  return cleanFabric({
    id, scale: r(0.25, 2.5), rot: r(0, 360), hue: r(0, 360),
    cycleHue: rand() < 0.35, hueHz: r(0.05, 0.6), spin: rand() < 0.25, spinHz: r(0.03, 0.3), scroll: rand() < 0.2 ? r(0.1, 0.8) : 0,
  });
}
