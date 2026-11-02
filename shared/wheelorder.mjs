// The sticker wheel's order from the start (Jens, 2 Nov 2026: "sticker d71-74 från mitten och
// fortsätter vänster ut, till höger ligger menyklibborna och efter dom kommer stickerlistan bakifrån").
// The wheel is a ring; index + 1 = one step to the RIGHT of the middle (shared/wheel.mjs). So:
//   [d71 (the middle, held at start), menu stickers…, the rest of the list from the back…,
//    my own uploads (oldest … newest), d74, d73, d72]
// Turning left from d71: d72, d73, d74, my newest upload …, then the library from the front.
// Turning right from d71: the menu stickers, then the library from its last sticker backwards.
// Pictures are known by their image id (a hash of the picture, library/manifest.json), like the
// menu stickers (client/src/menustickers.js), so a re-import of the same picture keeps its place.
export const WHEEL_START = Object.freeze(['6705c0bb226e755f', '637af7039ccbc251', '63101930ca537cf2', 'cdc47e9da5787154']); // d71, d72, d73, d74 .png
// Pure: library = the non-nature library in manifest order, mine = my uploads newest first,
// menus = the menu stickers' ids in the order they sit right of the middle. Ids missing from the
// library are skipped; every sticker is on the wheel once.
export function wheelOrder(library, mine = [], { start = WHEEL_START, menus = [] } = {}) {
  const byId = new Map(library.map((d) => [d.id, d]));
  const used = new Set();
  const take = (id) => { const d = byId.get(id); if (!d || used.has(id)) return null; used.add(id); return d; };
  const head = start.map(take).filter(Boolean);           // d71…d74 that exist
  const menu = menus.map(take).filter(Boolean);
  const own = mine.filter((d) => !used.has(d.id) && !byId.has(d.id) && (used.add(d.id), true));
  const ownLib = mine.filter((d) => byId.has(d.id) && !used.has(d.id)).map((d) => take(d.id)); // an upload that is also in the library: as mine
  const rest = library.filter((d) => !used.has(d.id));
  if (!head.length) return [...own, ...ownLib, ...menu, ...rest]; // (no d71: the old order, mine first)
  const [centre, ...left] = head;                          // left = d72, d73, d74 (going left)
  return [centre, ...menu, ...rest.slice().reverse(), ...[...own, ...ownLib].reverse(), ...left.slice().reverse()];
}
