// A random character from a seed (Jens, 29 Oct 2026, point 8): in a preset room a free player is a
// random character – outfit, hair, colours, skin and face – the same one every time for the same
// person in the same room (seed = room id + the device id), no fabrics. Pure, for browser and tests.
// AV = shared/avatar.json (passed in so this file needs no JSON import).

// FNV-1a → 32-bit seed, then mulberry32: small, fast, the same numbers everywhere.
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
export function seededRandom(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const roomCharacterSeed = (roomId, deviceId) => `room-character:${roomId}:${deviceId}`;
export function seededLook(AV, seed) {
  const r = seededRandom(seed), any = (list) => list[Math.floor(r() * list.length)];
  const look = {
    outfit: any(Object.keys(AV.outfits)), hair: any(Object.keys(AV.hair)), shirt: any(AV.colors.shirt), pants: any(AV.colors.pants),
    hairColor: any(AV.colors.hair), skin: any(AV.colors.skin), hat: r() < 0.3, hatColor: any(AV.colors.hat),
  };
  if (r() < 0.25 && AV.colors.face) look.face = any(AV.colors.face); // now and then a face colour of its own
  return look;
}
