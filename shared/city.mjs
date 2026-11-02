// The City (Jens, 2 Nov 2026, t476u; sketches "one plot" and "the city"). Shared by the client (the
// scene, walking, doors) and the server (where people may stand, which rooms are city rooms).
//
//   - The city is a room-like space: 96 × 96 m, 24 m high (sky walls + sky ceiling you can slap on).
//   - A 3 × 3 grid of 32 × 32 m plots. Each plot is a slab (PLOT_SLAB m thick, a little smaller than the
//     plot, so there are narrow streets between them) with a 16 × 16 × 8 m house on it – one room.
//   - The 8 outer houses are real rooms (stad-1 … stad-8): a black arched door, walk in = that room.
//   - The middle plot holds the Town Hall: three room blocks stacked (24 m high), green. Its door opens
//     the hand-in / swap counter (packs, server/citypacks.js).
// Coordinates: the city is centred on 0 (x east, z south, y up), like every room.
import ROOM from './room.json' with { type: 'json' };

export const CITY_ROOM = 'stad'; // The City is the public room (PUBLIC_ROOM) – it now looks like this
export const CITY_GEO = 'city-1'; // room.geo of the city room (server/store.js)
export const CITY = Object.freeze({ width: 96, height: 24, depth: 96 });
export const PLOT = 32;
export const PLOT_SLAB = 0.5; // the slab's thickness (a kerb you step up onto)
export const PLOT_GAP = 0.8; // street between two slabs
export const HOUSE = Object.freeze({ width: ROOM.width, height: ROOM.height, depth: ROOM.depth }); // 16 × 8 × 16
export const HALL_BLOCKS = 3; // the Town Hall: three house blocks high (24 m)
export const DOOR = Object.freeze({ width: 2.6, height: 3.6 }); // the black arch (big and clear)

const PLOT_IDS = ['stad-1', 'stad-2', 'stad-3', 'stad-4', null, 'stad-5', 'stad-6', 'stad-7', 'stad-8'];
export const PLOT_ROOMS = PLOT_IDS.filter(Boolean);
export const isPlotRoom = (id) => PLOT_ROOMS.includes(id);
export const isCityRoom = (id) => id === CITY_ROOM || isPlotRoom(id); // the city and its houses ("in the city")

// The 9 plots, row by row from the north-west: { i, j (−1/0/1), x, z (centre), room (null = Town Hall),
// hall, house: { x, z, w, d, h, y0 } (the building's box), door: { x, y0, z, w, h, facing } }.
export const PLOTS = Object.freeze(PLOT_IDS.map((room, k) => {
  const i = (k % 3) - 1, j = Math.floor(k / 3) - 1, x = i * PLOT, z = j * PLOT;
  const hall = room === null, h = HOUSE.height * (hall ? HALL_BLOCKS : 1);
  // every door faces south (+z) like in the sketch; the arch stands on the slab
  return Object.freeze({
    k, i, j, x, z, room, hall,
    house: Object.freeze({ x, z, w: HOUSE.width, d: HOUSE.depth, h, y0: PLOT_SLAB }),
    door: Object.freeze({ x, y0: PLOT_SLAB, z: z + HOUSE.depth / 2, w: DOOR.width, h: DOOR.height, facing: [0, 0, 1] }),
  });
}));
export const HALL = PLOTS.find((p) => p.hall);
export const plotOfRoom = (id) => PLOTS.find((p) => p.room === id) || null;

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
export const roomBox = (id) => (id === CITY_ROOM ? CITY : ROOM);
// Where you come into the city: on the open square between the Town Hall and the south houses, looking
// north at the Town Hall door (8 m ahead).
export const CITY_SPAWN = Object.freeze({ x: 0, z: 17, yaw: 0 });
// Leaving a house (back to the city): just outside its door.
export function spawnOutside(id) {
  const p = plotOfRoom(id);
  return p ? { x: p.door.x, z: p.door.z + 2.4, yaw: Math.PI } : { ...CITY_SPAWN };
}
