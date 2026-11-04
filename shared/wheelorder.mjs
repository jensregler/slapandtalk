// The sticker wheel's order from the start (Jens, 2 Nov 2026: "sticker d71-74 från mitten och
// fortsätter vänster ut, till höger ligger menyklibborna och efter dom kommer stickerlistan bakifrån";
// 4 Nov 2026, t507u: "i klibbhjulet så skall vi lägga klibborna: 98, 26, d74, e14 först" – the
// start four are now 98 (the middle), 26, d74, e14 going left; d71-d73 are ordinary list stickers).
// The wheel is a ring; index + 1 = one step to the RIGHT of the middle (shared/wheel.mjs). So:
//   [98 (the middle, held at start), menu stickers…, the rest of the list from the back…,
//    my own uploads (oldest … newest), e14, d74, 26]
// Turning left from 98: 26, d74, e14, my newest upload …, then the library from the front.
// Turning right from 98: the menu stickers, then the library from its last sticker backwards.
// Pictures are known by their image id (a hash of the picture, library/manifest.json), like the
// menu stickers (client/src/menustickers.js), so a re-import of the same picture keeps its place.
export const WHEEL_START = Object.freeze(['2e30991b8436f21a', 'b06481ab68dcc02a', 'cdc47e9da5787154', 'ea4e51d173e634b5']); // 98, 26, d74, e14 .png
// Pure: library = the non-nature library in manifest order, mine = my uploads newest first,
// menus = the menu stickers' ids in the order they sit right of the middle. Ids missing from the
// library are skipped; every sticker is on the wheel once. exclude = ids never on the wheel (the
// retired menu stickers camera, menue, stickerpac – Jens, t471u), also not as one of my uploads.
export function wheelOrder(library, mine = [], { start = WHEEL_START, menus = [], exclude = [] } = {}) {
  if (exclude.length) { const no = new Set(exclude); library = library.filter((d) => !no.has(d.id)); mine = mine.filter((d) => !no.has(d.id)); }
  const byId = new Map(library.map((d) => [d.id, d]));
  const used = new Set();
  const take = (id) => { const d = byId.get(id); if (!d || used.has(id)) return null; used.add(id); return d; };
  const head = start.map(take).filter(Boolean);           // 98, 26, d74, e14 that exist
  const menu = menus.map(take).filter(Boolean);
  const own = mine.filter((d) => !used.has(d.id) && !byId.has(d.id) && (used.add(d.id), true));
  const ownLib = mine.filter((d) => byId.has(d.id) && !used.has(d.id)).map((d) => take(d.id)); // an upload that is also in the library: as mine
  const rest = library.filter((d) => !used.has(d.id));
  if (!head.length) return [...own, ...ownLib, ...menu, ...rest]; // (none of them: the old order, mine first)
  const [centre, ...left] = head;                          // left = 26, d74, e14 (going left)
  return [centre, ...menu, ...rest.slice().reverse(), ...[...own, ...ownLib].reverse(), ...left.slice().reverse()];
}
// The name-tag tool's "choose one to replace" (Jens, mockup nametag-7): swaps = { oldId: newId }.
// The new sticker (one of my uploads, so it is in the order too) takes the old one's place, and is
// not shown a second time among my uploads. A swap whose new sticker is gone is ignored.
export function applySwaps(order, swaps = {}) {
  const byId = new Map(order.map((d) => [d.id, d]));
  const into = new Map(Object.entries(swaps || {}).filter(([from, to]) => from !== to && byId.has(from) && byId.has(to)));
  if (!into.size) return order;
  const moved = new Set(into.values());
  return order.flatMap((d) => (into.has(d.id) ? [byId.get(into.get(d.id))] : moved.has(d.id) ? [] : [d]));
}
