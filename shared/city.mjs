// The City (Jens, 2 Nov 2026, t476u; sketches "one plot" and "the city"). Shared by the client (the
// scene, walking, doors) and the server (where people may stand, which rooms are city rooms).
//
//   - The city is a room-like space: 96 × 96 m, 24 m high (sky walls + sky ceiling you can slap on).
//   - A 3 × 3 grid of 32 × 32 m plots, painted flush on ONE flat ground (t481u: no slabs, no ditches; a
//     paler square a little smaller than the plot, narrow painted streets between) with a 16 × 16 × 8 m
//     house on each – one room.
//   - The 8 outer houses are real rooms (<city>-1 … <city>-8): a black arched door, walk in = that room.
//   - The middle plot holds the Town Hall: three room blocks stacked (24 m high), green. Its door opens
//     the hand-in / swap counter (packs, server/citypacks.js).
// Coordinates: the city is centred on 0 (x east, z south, y up), like every room.
import ROOM from './room.json' with { type: 'json' };

export const CITY_ROOM = 'stad'; // the first city, "The City" (the public room); always there, never swept
export const CITY_GEO = 'city-2'; // room.geo of a city room (server/store.js); 'city-1' = with raised plots (moved down once)
export const OLD_PLOT_SLAB = 0.5; // the plots' height in 'city-1' (2 Nov 2026), before the ground was made one flat piece (t481u)
export const CITY = Object.freeze({ width: 96, height: 24, depth: 96 });
export const PLOT = 32;
export const PLOT_SLAB = 0; // the ground is ONE flat piece (Jens, t481u: no 'ditches'); plots are painted on it
export const PLOT_GAP = 0.8; // the painted street between two plots (flush – nothing to fall into)
export const HOUSE = Object.freeze({ width: ROOM.width, height: ROOM.height, depth: ROOM.depth }); // 16 × 8 × 16
export const HALL_BLOCKS = 3; // the Town Hall: three house blocks high (24 m)
export const DOOR = Object.freeze({ width: 2.6, height: 3.6 }); // the black arch (big and clear)
export const HOUSES = 8;

// Many cities (Jens, t479u, 2 Nov 2026). A city is started by the first person going in (they name
// it); it lives as long as somebody is in it – outside or in one of its houses – and goes when it is
// empty, like a room (server/emptyrooms.js). Room ids:
//   the city outside   'stad-<6 letters/digits>'        (the first city: 'stad')
//   its house n (1–8)  'stad-<6 letters/digits>-<n>'    (the first city's: 'stad-1' … 'stad-8')
// A house exists once somebody started it; houses are started in order (1, 2, 3 …) – the next free one.
export const CITY_CODE_RE = /^stad-[a-z0-9]{6}$/;
const PARSE_RE = /^(stad(?:-[a-z0-9]{6})?)(?:-([1-8]))?$/;
// 'stad-ab12cd-3' → { city: 'stad-ab12cd', n: 3 }; 'stad' → { city: 'stad', n: 0 }; not a city room → null.
export function parseCityRoom(id) {
  const m = PARSE_RE.exec(String(id || ''));
  return m ? { city: m[1], n: m[2] ? Number(m[2]) : 0 } : null;
}
export const cityOf = (id) => parseCityRoom(id)?.city || null;
export const houseNumber = (id) => parseCityRoom(id)?.n || 0;
export const houseId = (city, n) => `${city}-${n}`;
export const houseIds = (city) => Array.from({ length: HOUSES }, (_, k) => houseId(city, k + 1));
export const isCityOutside = (id) => { const p = parseCityRoom(id); return !!p && p.n === 0; };
export const isPlotRoom = (id) => { const p = parseCityRoom(id); return !!p && p.n > 0; };
export const isCityRoom = (id) => !!parseCityRoom(id); // the city and its houses ("in the city")
export const isFirstCity = (id) => cityOf(id) === CITY_ROOM; // 'stad' and stad-1 … stad-8: kept for good
export const PLOT_ROOMS = houseIds(CITY_ROOM); // the first city's houses (stad-1 … stad-8)
// A new city's code: 6 of a–z / 0–9 (always with a letter, so it can't be read as a house number).
export function newCityId(rnd = Math.random) {
  const A = 'abcdefghijkmnpqrstuvwxyz23456789';
  for (;;) { let c = ''; for (let k = 0; k < 6; k++) c += A[Math.floor(rnd() * A.length)]; if (/[a-z]/.test(c)) return 'stad-' + c; }
}
// The next house to start: the lowest number not started yet (started = a list of numbers), or 0 = all 8 are there.
export function nextHouse(started) { const s = new Set(started); for (let n = 1; n <= HOUSES; n++) if (!s.has(n)) return n; return 0; }

const PLOT_NS = [1, 2, 3, 4, null, 5, 6, 7, 8]; // house numbers, row by row (null = the Town Hall)
// The 9 plots, row by row from the north-west: { i, j (−1/0/1), x, z (centre), n (house 1–8; 0 = Town Hall),
// room (the FIRST city's house id, for old callers; null = Town Hall),
// hall, house: { x, z, w, d, h, y0 } (the building's box), door: { x, y0, z, w, h, facing } }.
export const PLOTS = Object.freeze(PLOT_NS.map((hn, k) => {
  const room = hn ? houseId(CITY_ROOM, hn) : null, n = hn || 0;
  const i = (k % 3) - 1, j = Math.floor(k / 3) - 1, x = i * PLOT, z = j * PLOT;
  const hall = room === null, h = HOUSE.height * (hall ? HALL_BLOCKS : 1);
  // every door faces south (+z) like in the sketch; the arch stands on the slab
  return Object.freeze({
    k, i, j, x, z, n, room, hall,
    house: Object.freeze({ x, z, w: HOUSE.width, d: HOUSE.depth, h, y0: PLOT_SLAB }),
    door: Object.freeze({ x, y0: PLOT_SLAB, z: z + HOUSE.depth / 2, w: DOOR.width, h: DOOR.height, facing: [0, 0, 1] }),
  });
}));
export const HALL = PLOTS.find((p) => p.hall);
export const plotOfHouse = (n) => (n ? PLOTS.find((p) => p.n === n) || null : null);
export const plotOfRoom = (id) => plotOfHouse(houseNumber(id));

// The slab under (x, z), or null on the street.
export function slabAt(x, z) {
  const half = (PLOT - PLOT_GAP) / 2;
  return PLOTS.find((p) => Math.abs(x - p.x) <= half && Math.abs(z - p.z) <= half) || null;
}
export const groundAt = (x, z) => (slabAt(x, z) ? PLOT_SLAB : 0);

// Walking: you can't walk into a house (a margin like the room's walls).
export function insideHouse(x, z, margin = 0.35) {
  return PLOTS.find((p) => Math.abs(x - p.house.x) < p.house.w / 2 + margin && Math.abs(z - p.house.z) < p.house.d / 2 + margin) || null;
}
// Push (x, z) out of any house, to the nearest side. Returns [x, z].
export function pushOut(x, z, margin = 0.35) {
  const p = insideHouse(x, z, margin);
  if (!p) return [x, z];
  const hw = p.house.w / 2 + margin, hd = p.house.d / 2 + margin, dx = x - p.house.x, dz = z - p.house.z;
  const ox = hw - Math.abs(dx), oz = hd - Math.abs(dz);
  return ox < oz ? [p.house.x + Math.sign(dx || 1) * hw, z] : [x, p.house.z + Math.sign(dz || 1) * hd];
}
// Standing at a door (in front of it, close): the plot, else null.
export function doorAt(x, z, reach = 1.4) {
  return PLOTS.find((p) => Math.abs(x - p.door.x) < p.door.w / 2 + 0.3 && z >= p.door.z - 0.01 && z < p.door.z + reach) || null;
}

// Where people may stand / hold cameras: the city box for the city, the room box elsewhere.
export const roomBox = (id) => (isCityOutside(id) ? CITY : ROOM);
// How tall a nature sticker may be here (cm): the space's height – 24 m in the city's outside (ground and
// sky; Jens, t482u), 8 m in a room or a house (shared/nature.mjs).
export const natureMaxHeightCmIn = (id) => Math.round(roomBox(id).height * 100);
// Where you come into the city: on the open square between the Town Hall and the south houses, looking
// north at the Town Hall door (8 m ahead).
export const CITY_SPAWN = Object.freeze({ x: 0, z: 17, yaw: 0 });
// Leaving a house (back to the city): just outside its door.
export function spawnOutside(id) {
  const p = plotOfRoom(id);
  return p ? { x: p.door.x, z: p.door.z + 2.4, yaw: Math.PI } : { ...CITY_SPAWN };
}

// ---------- The build phase (Jens, t492u + t493u, 3 Nov 2026) ----------
// "aktivera nature mode i staden tills spelet släpps så jag kan dekorera staden ordentligt" – until
// release, Jens t492u: the Nature wheel (two wheels, V, the nature list) works in the city's outside
// and in its houses too (the city wheel itself – my pack's stickers, exit, my pack – stays as it is).
// t493u: "we build ONE city and it is stored as a preset – everyone gets the same city at first".
// Jens decorates the BUILD CITY (BUILD_CITY, a fixed city reachable by its URL, never deleted when
// empty, not on the Join list); while CITY_BUILD_PHASE is on, everything placed in it (outside +
// houses 1–8) is saved into the DEFAULT city preset by itself (server/citypresets.js), and every NEW
// city copies the default city preset when it is started (its houses when they are started).
// Turn this off at release: the Nature wheel leaves the city and the build city stops auto-saving
// (the presets stay and new cities still copy the default one).
export const CITY_BUILD_PHASE = true; // until release, Jens t492u
export const BUILD_CITY = 'stad-byggen'; // the build city (a valid city code: 'stad-' + 6 letters)
export const BUILD_CITY_NAME = 'Build city';
export const isBuildCity = (id) => cityOf(id) === BUILD_CITY; // the build city's outside or one of its houses
// The part of a city a room is: 'outside' or the house number as a string ('1' … '8'); null = not a city room.
export const cityLayerOf = (id) => { const p = parseCityRoom(id); return p ? (p.n ? String(p.n) : 'outside') : null; };
export const CITY_LAYERS = Object.freeze(['outside', ...Array.from({ length: HOUSES }, (_, k) => String(k + 1))]);
