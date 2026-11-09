// Avatar clothing patches (Jens, 9 Nov 2026): single decals stamped onto the character
// (not tiled fabric). look.patches = [{ id, p, q, size }…] in avatar-root local space.
// id is a fabric image id (16 hex) or a baked patch key resolved by the client (circle/star
// upload through /api/fabrics → hex id).
export const PATCH_SIZE_DEFAULT = 0.14; // metres across
export const PATCH_SIZE_MIN = 0.04;
export const PATCH_SIZE_MAX = 0.4;
export const PATCHES_MAX = 24;

const ID_RE = /^[a-f0-9]{16}$/;
const round = (n) => Math.round(n * 1e4) / 1e4;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function cleanPatch(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  if (typeof p.id !== 'string' || !ID_RE.test(p.id)) return null;
  if (!Array.isArray(p.p) || p.p.length !== 3 || !p.p.every((x) => num(x) != null)) return null;
  if (!Array.isArray(p.q) || p.q.length !== 4 || !p.q.every((x) => num(x) != null)) return null;
  const size = Math.min(PATCH_SIZE_MAX, Math.max(PATCH_SIZE_MIN, num(p.size) ?? PATCH_SIZE_DEFAULT));
  // unit quaternion
  const q = p.q.map(Number);
  const m = Math.hypot(...q); if (!(m > 1e-6)) return null;
  return {
    id: p.id,
    p: p.p.map((x) => round(Number(x))),
    q: q.map((x) => round(x / m)),
    size: round(size),
  };
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
