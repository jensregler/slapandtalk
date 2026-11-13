// The City (Jens, 2 Nov 2026, t476u; sketches "one plot" and "the city"). Shared by the client (the
// scene, walking, doors) and the server (where people may stand, which rooms are city rooms).
//
//   - The city is a room-like space: 96 × 96 m, 24 m high (sky walls + sky ceiling you can slap on).
//   - A 3 × 3 grid of 32 × 32 m plots, painted flush on ONE flat ground (t481u: no slabs, no ditches; a
//     paler square a little smaller than the plot, narrow painted streets between) with a 16 × 16 × 8 m
//     house on each – one room.
//   - The 8 outer houses were real rooms (<city>-1 … <city>-8). Since the rebuild (10 Nov 2026, below)
//     only houses 1, 3, 6, 8 are rooms (black arched door, walk in = that room); plot 2 is the subway
//     station, plots 4, 5, 7 are open FX rooms (walls + roof, no door).
//   - The middle plot holds the Town Hall: three room blocks stacked (24 m high), green. Its entrance
//     is on the north side (facing the plaza) and opens the pack shop (server/citypacks.js) – no drawn door
//     (Jens t893u).
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
// ---------- The rebuild (Jens, 10 Nov 2026, pt781u + his annotated top-down sketch) ----------
//   - KEPT houses 1, 3, 6, 8: real rooms behind black doors, each with a room preset (HOUSE_PRESETS) –
//     "breathing holes" when the city gets too loud; max HOUSE_MAX (4) people, number 5 is turned away.
//   - Plot 2: the house is gone; a SUBWAY station (sketch: blue box, door on its south side) at the
//     north edge of the plot. Its black door opens the list of living cities that have room.
//   - A PLAZA (torg) between the subway station and the Town Hall.
//   - Plots 4, 5, 7: the rooms are gone – OPEN rooms of walls + a roof (sketch: orange), no door, walk in:
//     4 = reverb room (open to the west), 5 = delay room (open to the east), 7 = noise room (open
//     doorway in the south wall). (Their city audio was removed, Jens t857u 12 Nov 2026 – the rooms stay as plain open buildings.)
export const KEPT_HOUSES = Object.freeze([1, 3, 6, 8]);
export const isKeptHouse = (n) => KEPT_HOUSES.includes(Number(n));
export const HOUSE_MAX = 4; // people in one kept house (pt781u: number five is denied and asked to try another room)
// The room presets in the kept houses (sketch notes). Resolved by id first, then by title (server/housepresets.js),
// so a re-made preset with the same name still lands in the right house.
export const HOUSE_PRESETS = Object.freeze({
  1: Object.freeze({ id: '50288ba516', title: 'small village in forrest', match: 'village in forrest' }),
  3: Object.freeze({ id: 'ef54aa361a', title: 'Reglersro', match: 'reglersro' }),
  6: Object.freeze({ id: '62bda393d3', title: 'modern office', match: 'modern office' }),
  8: Object.freeze({ id: 'af39b8617f', title: 'Cozy Village', match: 'cozy village' }),
});
export const FX_PLOTS = Object.freeze({ 4: 'reverb', 5: 'delay', 7: 'noise' });
export const isFxPlot = (n) => Object.prototype.hasOwnProperty.call(FX_PLOTS, Number(n));
export const SUBWAY_PLOT = 2;
export const WALL_T = 0.4; // an open room's wall thickness (m)
export const FX_OPENING = 4.4; // plot 7's doorway (sketch: a gap in the south wall, no door)
// The next house to start: the lowest KEPT number not started yet (started = a list of numbers), or 0 = all are there.
export function nextHouse(started) { const s = new Set(started); for (const n of KEPT_HOUSES) if (!s.has(n)) return n; return 0; }

const PLOT_NS = [1, 2, 3, 4, null, 5, 6, 7, 8]; // plot numbers, row by row (null = the Town Hall)
const box = (x, z, w, d, h, y0 = PLOT_SLAB) => Object.freeze({ x, z, w, d, h, y0 });
// An open room's wall segments (plot centre cx, cz; open: 'w' | 'e' | 's-door').
function fxWalls(cx, cz, open) {
  const hw = HOUSE.width / 2, hd = HOUSE.depth / 2, h = HOUSE.height, t = WALL_T, out = [];
  const n = box(cx, cz - hd + t / 2, HOUSE.width, t, h), s = box(cx, cz + hd - t / 2, HOUSE.width, t, h);
  const w = box(cx - hw + t / 2, cz, t, HOUSE.depth, h), e = box(cx + hw - t / 2, cz, t, HOUSE.depth, h);
  if (open === 'w') out.push(n, s, e);
  else if (open === 'e') out.push(n, s, w);
  else { // a doorway in the middle of the south wall
    const side = (HOUSE.width - FX_OPENING) / 2;
    out.push(n, w, e, box(cx - hw + side / 2, cz + hd - t / 2, side, t, h), box(cx + hw - side / 2, cz + hd - t / 2, side, t, h));
  }
  return out;
}
// The subway station (sketch: a low wide box at the north edge of plot 2, door in the middle of its south side).
export const SUBWAY = Object.freeze({ x: 0, z: -38.5, w: 16, d: 4.5, h: 4.8 });
// The plaza: paved, from the subway station's door down to the Town Hall's north wall (the street between them included).
export const PLAZA = Object.freeze({ x: 0, z: -22, w: 22, d: 27 }); // z −35.5 … −8.5
// Benches on the plaza (solid, low): along its east and west edges, facing in.
export const PLAZA_BENCHES = Object.freeze([[-8.5, -28], [-8.5, -16], [8.5, -28], [8.5, -16]].map(([x, z]) => box(x, z, 0.7, 2.4, 0.5, 0)));
// The 9 plots, row by row from the north-west: { k, i, j (−1/0/1), x, z (centre), n (plot number 1–8; 0 = Town Hall),
// kind: 'house' | 'hall' | 'subway' | 'fx', room (the FIRST city's house id for a kept house, else null),
// hall, house: { x, z, w, d, h, y0 } (the building's box; an open room's outline), walls: [boxes you bump into],
// door: { x, y0, z, w, h, facing } | null (open rooms have none), fx: 'reverb' | 'delay' | 'noise' | null, roof (open rooms) }.
export const PLOTS = Object.freeze(PLOT_NS.map((hn, k) => {
  const n = hn || 0, hall = hn === null;
  const kind = hall ? 'hall' : isKeptHouse(n) ? 'house' : n === SUBWAY_PLOT ? 'subway' : 'fx';
  const room = kind === 'house' ? houseId(CITY_ROOM, n) : null;
  const i = (k % 3) - 1, j = Math.floor(k / 3) - 1, x = i * PLOT, z = j * PLOT;
  let house, walls, door = null, roof = null;
  if (kind === 'subway') {
    house = box(SUBWAY.x, SUBWAY.z, SUBWAY.w, SUBWAY.d, SUBWAY.h); walls = [house];
  } else {
    house = box(x, z, HOUSE.width, HOUSE.depth, HOUSE.height * (hall ? HALL_BLOCKS : 1));
    walls = kind === 'fx' ? fxWalls(x, z, n === 4 ? 'w' : n === 5 ? 'e' : 's-door') : [house];
    if (kind === 'fx') roof = box(x, z, HOUSE.width, HOUSE.depth, 0.3, HOUSE.height);
  }
  // Kept houses and the subway: the door faces south (+z), like the sketch. The Town Hall's entrance
  // is on the north wall (facing the plaza); there is no drawn door (Jens t893u).
  if (kind !== 'fx') {
    const south = kind !== 'hall';
    door = Object.freeze({ x: house.x, y0: PLOT_SLAB, z: house.z + (south ? 1 : -1) * house.d / 2, w: DOOR.width, h: DOOR.height, facing: south ? [0, 0, 1] : [0, 0, -1] });
  }
  return Object.freeze({ k, i, j, x, z, n, kind, room, hall, subway: kind === 'subway', open: kind === 'fx', fx: kind === 'fx' ? FX_PLOTS[n] : null,
    house, walls: Object.freeze(walls), door, roof });
}));
export const HALL = PLOTS.find((p) => p.hall);
export const SUBWAY_PLOT_INFO = PLOTS.find((p) => p.subway);
export const FX_ROOMS = Object.freeze(PLOTS.filter((p) => p.open));
export const plotOfHouse = (n) => (n ? PLOTS.find((p) => p.n === n) || null : null);
export const plotOfRoom = (id) => plotOfHouse(houseNumber(id));
// Everything solid in the city: [{ ...box, plot }] (buildings, open-room walls, plaza benches).
export const SOLIDS = Object.freeze([...PLOTS.flatMap((p) => p.walls.map((b) => Object.freeze({ ...b, plot: p }))), ...PLAZA_BENCHES.map((b) => Object.freeze({ ...b, plot: null, bench: true }))]);

// The slab under (x, z), or null on the street.
export function slabAt(x, z) {
  const half = (PLOT - PLOT_GAP) / 2;
  return PLOTS.find((p) => Math.abs(x - p.x) <= half && Math.abs(z - p.z) <= half) || null;
}
export const groundAt = (x, z) => (slabAt(x, z) ? PLOT_SLAB : 0);

// Walking: you can't walk into a building or through a wall (a margin like the room's walls).
// Returns the plot whose building / wall you are in (a bench: { bench: true }), else null.
const solidAt = (x, z, margin) => SOLIDS.find((b) => Math.abs(x - b.x) < b.w / 2 + margin && Math.abs(z - b.z) < b.d / 2 + margin) || null;
export function insideHouse(x, z, margin = 0.35) { const b = solidAt(x, z, margin); return b ? b.plot || { bench: true, house: b } : null; }
// Is (x, z) inside an open room's walls (under its roof)? The plot, else null.
export function insideFxRoom(x, z, inset = WALL_T) {
  return FX_ROOMS.find((p) => Math.abs(x - p.x) < HOUSE.width / 2 - inset && Math.abs(z - p.z) < HOUSE.depth / 2 - inset) || null;
}
// Push (x, z) out of any building / wall, to the nearest side. Returns [x, z].
export function pushOut(x, z, margin = 0.35) {
  for (let pass = 0; pass < 4; pass++) {
    const b = solidAt(x, z, margin);
    if (!b) break;
    const hw = b.w / 2 + margin, hd = b.d / 2 + margin, dx = x - b.x, dz = z - b.z;
    const ox = hw - Math.abs(dx), oz = hd - Math.abs(dz);
    if (ox < oz) x = b.x + Math.sign(dx || 1) * hw; else z = b.z + Math.sign(dz || 1) * hd;
  }
  return [x, z];
}
// Standing at a door (in front of it, close): the plot, else null. Open rooms have no door.
// South-facing doors (houses, subway): stand on the +z side. The Town Hall faces north (−z).
export function doorAt(x, z, reach = 1.4) {
  return PLOTS.find((p) => {
    if (!p.door) return false;
    if (Math.abs(x - p.door.x) >= p.door.w / 2 + 0.3) return false;
    const along = (z - p.door.z) * (p.door.facing[2] >= 0 ? 1 : -1);
    return along >= -0.01 && along < reach;
  }) || null;
}

// Where people may stand / hold cameras: the city box for the city, the room box elsewhere.
export const roomBox = (id) => (isCityOutside(id) ? CITY : ROOM);
// How tall a nature sticker may be here (cm): the space's height – 24 m in the city's outside (ground and
// sky; Jens, t482u), 8 m in a room or a house (shared/nature.mjs).
export const natureMaxHeightCmIn = (id) => Math.round(roomBox(id).height * 100);
// Where you come into the city: the middle of the plaza (torg) between the subway and the Town Hall,
// looking south at the Town Hall's north entrance (Jens t893u). A fresh load always starts here (plus a
// little jitter so two arrivals don't overlap); leaving a house still uses spawnOutside, and ?at=subway
// / ?at=<house> keep their own spots. Walk position is not saved across reloads.
export const CITY_SPAWN = Object.freeze({ x: PLAZA.x, z: PLAZA.z, yaw: Math.PI });
// Leaving a house (back to the city): just outside its door.
export function spawnOutside(id) {
  const p = plotOfRoom(id);
  return p && p.door ? { x: p.door.x, z: p.door.z + 2.4, yaw: Math.PI } : { ...CITY_SPAWN };
}
// Coming up from the subway (?at=subway): on the plaza in front of the station, looking south at the Town Hall.
export const SUBWAY_SPAWN = Object.freeze({ x: 0, z: SUBWAY.z + SUBWAY.d / 2 + 2.6, yaw: Math.PI });

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
