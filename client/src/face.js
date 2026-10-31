// The face (Jens, 29 Oct 2026): a material of its own on the front of the head, independent of
// the body – a colour, a fabric, or a face photo. Pure helpers (no three.js), shared by avatars.js
// (the model) and the tests (tests/face.test.mjs).
//
// The model's head is one skin mesh. Once per geometry the triangles on the front of the head
// (forehead to chin, from just behind the ears forwards, whichever way they face) are moved to the end of the index and get their own group,
// so each avatar can give them a second material.
// FACE = where the face is in the rest pose (model metres, the fabPos system): a face photo is drawn
// as a square of `size` centred on (cx, cy), only where z > zMin (the front); with these numbers the
// model's eyes sit ~42 % from the top of the square, as in an ordinary portrait.
// zFace: the face triangles reach back to here (behind the ears, the head's centre is z ≈ 0.11), so the
// sides of the head next to the face are face too; the photo itself fades out at zMin (fabrics.js).
export const FACE = { cx: 0.004, cy: 1.633, size: 0.27, zMin: 0.1, yMin: 1.49, yMax: 1.8, zFace: 0.04 };

// Is a triangle (rest-pose corners a, b, c, each [x, y, z]) part of the face? Everything on the head
// between chin and hairline in front of the ears, whichever way it faces: the sides of the nose and
// the cheeks by the ears face sideways, and once left out the body's skin (fabric) showed through
// there, in stripes, next to a face photo (Jens, 31 Oct 2026).
export function isFaceTriangle(a, b, c) {
  const cy = (a[1] + b[1] + c[1]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
  return cy >= FACE.yMin && cy <= FACE.yMax && cz >= FACE.zFace;
}

// What each slot wears. The face follows the skin (its colour and its fabric) until it gets its own
// colour or fabric; `photo` only means something on the face.
export function effectiveFabrics(L) {
  const fab = { ...(L.fabric || {}) };
  for (const s of Object.keys(fab)) if (s !== 'face' && fab[s].photo) fab[s] = { ...fab[s], photo: false };
  if (!fab.face && !L.face && fab.skin) fab.face = fab.skin;
  return fab;
}
// The face's colour: its own, or the skin's.
export const faceColour = (L) => L.face || L.skin;
// Where a point on the front of the head (rest pose x, y) lands in a face photo (u, v 0…1, v up),
// for zoom `scale` and tilt `rot` (degrees) – the same sum as the shader in fabrics.js.
export function facePhotoUv(x, y, scale = 1, rot = 0) {
  const r = (rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const px = (x - FACE.cx) / (FACE.size * scale), py = (y - FACE.cy) / (FACE.size * scale);
  // GLSL mat2(c, s, -s, c) * p (column-major)
  return [c * px - s * py + 0.5, s * px + c * py + 0.5];
}
