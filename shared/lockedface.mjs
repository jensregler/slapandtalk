// Locked face photo (Jens, 6 Nov 2026, t587u): the face fabric Jens was wearing in the city
// (prod player "Regelverk" / @jensreglermanniska, fabric id from /uploads, scale 1.15, photo).
// Baked into the client as /locked/jens-face.webp so it survives without the upload store.
// Applied only to looks that belong to that identity (see ownsLockedFace).
export const LOCKED_FACE_ID = '70cf6e844298da52';
export const LOCKED_FACE_INSTA = 'jensreglermanniska';
export const LOCKED_FACE_SCALE = 1.15;
export const LOCKED_FACE_URL = '/locked/jens-face.webp';
// A clean fabric entry (same shape as shared/fabric.mjs cleanFabric).
export const LOCKED_FACE = Object.freeze({
  id: LOCKED_FACE_ID,
  scale: LOCKED_FACE_SCALE,
  rot: 0,
  hue: 0,
  hueHz: 0.25,
  spinHz: 0.1,
  scroll: 0,
  cycleHue: false,
  spin: false,
  photo: true,
});
export function ownsLockedFace(look) {
  const insta = String(look?.insta || '').replace(/^@+/, '').toLowerCase();
  return insta === LOCKED_FACE_INSTA;
}
// Force the locked face onto a look (mutates a shallow copy of fabric). Drops a separate face colour.
export function applyLockedFace(look) {
  if (!look || typeof look !== 'object') return look;
  const fabric = { ...(look.fabric || {}), face: { ...LOCKED_FACE } };
  const { face: _drop, ...rest } = look;
  return { ...rest, fabric };
}
