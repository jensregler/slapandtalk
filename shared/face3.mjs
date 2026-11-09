// Face 3 photo (Jens, 9 Nov 2026): baked cut-out face for the character-menu Face tab.
// Source: Dropbox /Ulla/knappar/face3.jpg → client/public/faces/face3.webp (square cover).
// Same shape as shared/lockedface.mjs so fabricUrl can serve it without /uploads.
export const FACE3_ID = 'face300000000003';
export const FACE3_URL = '/faces/face3.webp';
export const FACE3_SCALE = 1.0;
export const FACE3 = Object.freeze({
  id: FACE3_ID,
  scale: FACE3_SCALE,
  rot: 0,
  hue: 0,
  hueHz: 0.25,
  spinHz: 0.1,
  scroll: 0,
  cycleHue: false,
  spin: false,
  photo: true,
});
