// Fictional city names (Jens, t864u, 12 Nov 2026): a new city is born with a made-up name – nobody is asked
// to name it on the way in any more. The name can be changed ONCE, in the Town Hall, by whoever gets there
// first (server/cities.js rename); after that it is the city's name for good.
// A name = a playful first part + a place ending ("Glue" + "haven" = "Gluehaven"), or now and then one of
// the hand-made names. Deterministic for a given rnd (tests).
export const CITY_NAME_FIRST = [
  'Glue', 'Slap', 'Peel', 'Stick', 'Paper', 'Sticker', 'Talk', 'Echo', 'Poster', 'Stamp', 'Tape', 'Doodle',
  'Pixel', 'Velvet', 'Marble', 'Lemon', 'Cobalt', 'Clover', 'Maple', 'Copper', 'Honey', 'Neon', 'Saffron',
  'Bubble', 'Crayon', 'Biscuit', 'Gravel', 'Thistle', 'Willow', 'Puffin', 'Pebble', 'Rumble', 'Whistle',
];
export const CITY_NAME_END = [
  'ton', 'ville', 'burg', 'by', 'holm', 'stad', 'haven', 'field', 'port', 'bridge', 'wick', 'mouth',
  'dale', 'ford', 'borough', 'hamn', 'vik', 'köping', 'sund', 'mere', 'gate', 'stead',
];
export const CITY_NAME_SPECIAL = [
  'Slapville', 'Stickerton', 'Peeltown', 'Talkburg', 'Klisterköping', 'Glue Creek', 'Stamp City',
  'Posterberg', 'Little Sticky', 'Upper Peel', 'Nether Slap', 'Port Paper', 'New Doodle', 'Old Tapewick',
];
const pick = (list, rnd) => list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];
// One name. ("Stickton", not "Stickkton": a doubled letter at the seam is folded.)
export function fictionalCityName(rnd = Math.random) {
  if (rnd() < 0.18) return pick(CITY_NAME_SPECIAL, rnd);
  const a = pick(CITY_NAME_FIRST, rnd), b = pick(CITY_NAME_END, rnd);
  return a.slice(-1).toLowerCase() === b[0] ? a + b.slice(1) : a + b;
}
// A name no city in `taken` (names, any case) has yet – tries a few times, then adds a number.
export function freshCityName(taken = [], rnd = Math.random) {
  const used = new Set([...taken].map((n) => String(n || '').trim().toLowerCase()));
  for (let k = 0; k < 40; k++) { const n = fictionalCityName(rnd); if (!used.has(n.toLowerCase())) return n; }
  const base = fictionalCityName(rnd);
  for (let k = 2; k < 1000; k++) if (!used.has(`${base} ${k}`.toLowerCase())) return `${base} ${k}`;
  return base;
}
