// Avatar clothing patches (Jens, 9 Nov 2026): stamp ops composited INTO the garment
// material (fabPos unwrap atlas → shader), NOT floating decal meshes.
// look.patches = [{ id, slot, p, scale, rot, hue, hueHz, spinHz, scroll, cycleHue, spin }…]
//   id    fabric image id (16 hex) from /api/fabrics (circle/star/upload)
//   slot  garment slot the stamp was painted onto (shirt/pants/…)
//   p     rest-pose position (fabPos space) used to place the stamp in the atlas
//   scale/rot/hue/… same variables as fabric (shared/fabric.json), stored per stamp
import FABRIC from './fabric.json' with { type: 'json' };

export const PATCH_SIZE_DEFAULT = 0.14; // metres across at scale=1
export const PATCH_SIZE_MIN = 0.04;
export const PATCH_SIZE_MAX = 0.4;
export const PATCHES_MAX = 24;
export const PATCH_SLOTS = ['shirt', 'pants', 'shoes', 'hair', 'skin', 'face', 'hat'];
// fabPos Y ranges (unscaled avatar metres) for the cylindrical body unwrap per slot
export const PATCH_Y = Object.freeze({
  shirt: [0.85, 1.55],
  pants: [0.35, 0.95],
  shoes: [0.0, 0.42],
  hair: [1.45, 1.9],
  skin: [0.5, 1.6],
  face: [1.35, 1.7],
  hat: [1.55, 1.9],
});

const ID_RE = /^[a-f0-9]{16}$/;
const round = (n) => Math.round(n * 1e4) / 1e4;
const round3 = (n) => Math.round(n * 1e3) / 1e3;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function slotFromP(p) {
  const y = Array.isArray(p) ? p[1] : 0;
  if (y >= 1.45) return 'hair';
  if (y >= 0.85) return 'shirt';
  if (y >= 0.35) return 'pants';
  return 'shoes';
}

// Cylindrical unwrap of a fabPos point → [u,v] in 0..1 (must match the shader in fabrics.js).
export function patchUnwrap(p, slot) {
  const yR = PATCH_Y[slot] || PATCH_Y.shirt;
  const x = p[0], y = p[1], z = p[2];
  const u = Math.atan2(x, z) / (Math.PI * 2) + 0.5;
  const v = Math.min(1, Math.max(0, (y - yR[0]) / (yR[1] - yR[0] || 1)));
  return [((u % 1) + 1) % 1, v];
}

function cleanParam(name, v) {
  const p = FABRIC.params[name];
  let n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return p.def;
  if (p.wrap) n = ((n % 360) + 360) % 360;
  else n = Math.min(p.max, Math.max(p.min, n));
  return round3(n);
}

export function cleanPatch(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return null;
  if (!Array.isArray(raw.p) || raw.p.length !== 3 || !raw.p.every((x) => num(x) != null)) return null;
  const p = raw.p.map((x) => round(Number(x)));
  let slot = typeof raw.slot === 'string' && PATCH_SLOTS.includes(raw.slot) ? raw.slot : slotFromP(p);
  // Legacy floating-decal shape { id, p, q, size } → scale from size, drop q
  let scale = raw.scale;
  if (scale == null && num(raw.size) != null) scale = num(raw.size) / PATCH_SIZE_DEFAULT;
  const out = { id: raw.id, slot, p };
  for (const k of Object.keys(FABRIC.params)) out[k] = cleanParam(k, raw[k] != null ? raw[k] : (k === 'scale' ? scale : undefined));
  for (const k of FABRIC.flags) {
    if (k === 'photo') continue; // patches are never face photos
    out[k] = raw[k] === true;
  }
  return out;
}

export function cleanPatches(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const raw of list) {
    const p = cleanPatch(raw);
    if (p) out.push(p);
    if (out.length >= PATCHES_MAX) break;
  }
  return out.length ? out : null;
}

export function defaultPatchParams(id, slot, p) {
  return cleanPatch({ id, slot, p, scale: 1, rot: 0, hue: 0, hueHz: 0.25, spinHz: 0.1, scroll: 0, cycleHue: false, spin: false });
}

export function randomPatchParams(base, rand = Math.random) {
  const r = (a, b) => a + (b - a) * rand();
  return cleanPatch({
    ...base,
    scale: r(0.5, 2.2), rot: r(0, 360), hue: r(0, 360),
    cycleHue: rand() < 0.35, hueHz: r(0.05, 0.6),
    spin: rand() < 0.25, spinHz: r(0.03, 0.3),
    scroll: rand() < 0.2 ? r(0.1, 0.8) : 0,
  });
}
