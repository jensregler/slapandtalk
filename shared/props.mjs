// 3D props (Jens t491u/t509u, 4 Nov 2026): furniture and street furniture standing in a room or a city –
// a table with 4 chairs in every room (where you sit down and draw), street lights, bins, benches,
// road signs … Shared by the web app (client/src/props3d.js draws them, client/src/propsmode.js places
// them), the server (server/app.js checks what is sent, server/store.js keeps them with the room, the
// city presets copy them) and the tests.
//
// A room's props: room.props = [ prop, … ] (missing = the room never had any: the DEFAULT set, see
// defaultProps() – a table with 4 chairs in a room or a house, nothing in a city's outside).
//   prop = { id: 10 hex, kind, x, y, z (m, the foot of it; y = what it stands on), yaw (radians),
//            s (scale 0.25–4, 1 = real size) }
//   a cuboid ('box', the build primitive) instead of s: sx, sy, sz (m: width, height, depth) + color.
// Placing, moving and removing them is the BUILD PHASE's (shared/city.mjs CITY_BUILD_PHASE; the Props
// wheel – not part of the final game), for admin and the full version (canEditProps below).
import ROOM from './room.json' with { type: 'json' };

export const PROP_SCALE = Object.freeze({ min: 0.25, max: 4 });
// The cuboid: 10 cm up to a plot (32 m) wide/deep and the city's height (24 m) high.
export const BOX_LIMITS = Object.freeze({ min: 0.1, maxSide: 32, maxHeight: 24 });
// A handful of toon colours for the cuboid (Jens: "en enkel färgväljare").
export const BOX_COLOURS = Object.freeze(['#f4efe6', '#c9c2b6', '#6b6f73', '#2b2b2e', '#d8452f', '#f2a33a', '#ffd23f', '#5fae4e', '#2f7d4f', '#3f7fd0', '#7a4fc9', '#b07a4a']);
export const MAX_PROPS = 400; // per room / city outside (iPhone: every prop is a few draw calls)
export const SIT_REACH = 2.2; // m: the drawing tool opened this close to a free chair = sit down on it

// The catalogue. h = the real height (m) the model is scaled to at s = 1. where: 'room' / 'city' /
// 'both' (which list the Props wheel shows first; everything can go anywhere). seat: a chair (you sit
// on it: the seat's height, m). label: the wheel's name. code: built in code (no CC0 model).
export const PROP_KINDS = Object.freeze({
  table: { h: 0.76, where: 'room', label: 'Table' },
  chair: { h: 0.92, where: 'room', label: 'Chair', seat: 0.47 },
  sofa: { h: 0.8, where: 'room', label: 'Sofa' },
  plant: { h: 0.9, where: 'room', label: 'Plant' },
  bookcase: { h: 1.8, where: 'room', label: 'Bookcase' },
  floorlamp: { h: 1.6, where: 'room', label: 'Floor lamp' },
  box: { h: 1, where: 'both', label: 'Cuboid', code: true, box: true },
  lamp: { h: 4.6, where: 'city', label: 'Street light' },
  lamp2: { h: 4.6, where: 'city', label: 'Street light 2' },
  bin: { h: 0.95, where: 'city', label: 'Bin' },
  bin2: { h: 1.0, where: 'city', label: 'Bin 2' },
  bench: { h: 0.85, where: 'city', label: 'Bench', seat: 0.45 },
  elskap: { h: 1.25, where: 'city', label: 'Elskåp', code: true },
  postlada: { h: 1.45, where: 'city', label: 'PostNord box', code: true },
  planter: { h: 0.6, where: 'city', label: 'Planter' },
  tree: { h: 3.5, where: 'city', label: 'Tree' },
  treeL: { h: 5.5, where: 'city', label: 'Big tree' },
  bikerack: { h: 0.8, where: 'city', label: 'Bike rack', code: true },
  busstop: { h: 2.6, where: 'city', label: 'Bus stop', code: true },
  pillar: { h: 3.2, where: 'city', label: 'Affischpelare', code: true },
  cone: { h: 0.7, where: 'city', label: 'Cone' },
  barrier: { h: 1.0, where: 'city', label: 'Barrier' },
  market: { h: 2.6, where: 'city', label: 'Market stand' },
  kiosk: { h: 2.8, where: 'city', label: 'Kiosk', code: true },
  phonebooth: { h: 2.4, where: 'city', label: 'Phone booth', code: true },
  car: { h: 1.5, where: 'city', label: 'Parked car', code: true },
  fountain: { h: 1.6, where: 'city', label: 'Fountain', code: true },
  statue: { h: 2.5, where: 'city', label: 'Statue' },
  hydrant: { h: 0.8, where: 'city', label: 'Hydrant' },
  dumpster: { h: 1.4, where: 'city', label: 'Dumpster' },
  trafficlight: { h: 3.2, where: 'city', label: 'Traffic light' },
  parasol: { h: 2.4, where: 'city', label: 'Parasol' },
  // Swedish road signs (built in code: no CC0 models of them)
  'sign-stop': { h: 2.4, where: 'city', label: 'Stop', code: true, sign: true },
  'sign-yield': { h: 2.4, where: 'city', label: 'Väjningsplikt', code: true, sign: true },
  'sign-30': { h: 2.4, where: 'city', label: '30', code: true, sign: true },
  'sign-crossing': { h: 2.4, where: 'city', label: 'Övergångsställe', code: true, sign: true },
  'sign-parking': { h: 2.4, where: 'city', label: 'Parkering', code: true, sign: true },
  'sign-oneway': { h: 2.4, where: 'city', label: 'Enkelriktat', code: true, sign: true },
  'sign-noentry': { h: 2.4, where: 'city', label: 'Förbud mot infart', code: true, sign: true },
});
export const KIND_IDS = Object.freeze(Object.keys(PROP_KINDS));
export const isProp = (k) => Object.prototype.hasOwnProperty.call(PROP_KINDS, k);
export const isSeat = (p) => !!p && isProp(p.kind) && !!PROP_KINDS[p.kind].seat;

const ID_RE = /^[a-f0-9]{10}$/;
export const isPropId = (v) => typeof v === 'string' && ID_RE.test(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const r3 = (n) => Math.round(n * 1000) / 1000;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
// A prop as it may be kept: null = not a prop. bounds = the space's box { width, height, depth } (centred
// on x/z, y up from 0): a prop stands inside it (its foot; a big cuboid may reach out over the edge).
export function cleanProp(p, bounds = ROOM) {
  if (!p || typeof p !== 'object' || !isPropId(p.id) || !isProp(p.kind)) return null;
  const x = num(p.x), y = num(p.y ?? 0), z = num(p.z), yaw = num(p.yaw ?? 0);
  if ([x, y, z, yaw].some(Number.isNaN)) return null;
  const hw = bounds.width / 2, hd = bounds.depth / 2;
  let a = yaw % (Math.PI * 2); if (a < 0) a += Math.PI * 2;
  const out = { id: p.id, kind: p.kind, x: r3(clamp(x, -hw, hw)), y: r3(clamp(y, 0, bounds.height)), z: r3(clamp(z, -hd, hd)), yaw: r3(a) };
  if (PROP_KINDS[p.kind].box) {
    const side = (v, max, def) => { const n = num(v); return r3(clamp(Number.isNaN(n) ? def : n, BOX_LIMITS.min, max)); };
    out.sx = side(p.sx, BOX_LIMITS.maxSide, 1); out.sy = side(p.sy, BOX_LIMITS.maxHeight, 1); out.sz = side(p.sz, BOX_LIMITS.maxSide, 1);
    out.color = typeof p.color === 'string' && BOX_COLOURS.includes(p.color.toLowerCase()) ? p.color.toLowerCase() : BOX_COLOURS[0];
  } else {
    const s = num(p.s ?? 1);
    out.s = r3(clamp(Number.isNaN(s) ? 1 : s, PROP_SCALE.min, PROP_SCALE.max));
  }
  return out;
}
// A list (from a room file / a preset / the wire): the good ones, each id once, at most MAX_PROPS.
export function cleanProps(list, bounds = ROOM) {
  if (!Array.isArray(list)) return null;
  const seen = new Set(), out = [];
  for (const p of list) { const c = cleanProp(p, bounds); if (c && !seen.has(c.id)) { seen.add(c.id); out.push(c); if (out.length >= MAX_PROPS) break; } }
  return out;
}

// The default set (a room that never had props, an old room, a room preset without props): a table
// with 4 chairs a little in front of the middle (the spawn looks north from the south side). Fixed
// ids, so every room's default table is the same one (and a chair's id is stable for sitting).
const T = { x: 0, z: 1.5 };
export const DEFAULT_ROOM_PROPS = Object.freeze([
  { id: 'd0000000a0', kind: 'table', x: T.x, y: 0, z: T.z, yaw: 0, s: 1 },
  { id: 'd0000000a1', kind: 'chair', x: T.x - 0.45, y: 0, z: T.z - 0.72, yaw: 0, s: 1 },
  { id: 'd0000000a2', kind: 'chair', x: T.x + 0.45, y: 0, z: T.z - 0.72, yaw: 0, s: 1 },
  { id: 'd0000000a3', kind: 'chair', x: T.x - 0.45, y: 0, z: T.z + 0.72, yaw: Math.PI, s: 1 },
  { id: 'd0000000a4', kind: 'chair', x: T.x + 0.45, y: 0, z: T.z + 0.72, yaw: Math.PI, s: 1 },
].map(Object.freeze));
// What a space has when it has no props field: a room or a house the table set; a city's outside nothing.
export const defaultProps = (outside = false) => (outside ? [] : DEFAULT_ROOM_PROPS.map((p) => ({ ...p })));
export const propsOf = (room, outside = false) => (Array.isArray(room && room.props) ? room.props : defaultProps(outside));

// Where you sit on a chair (or a bench): the seat's middle, which way you face (yaw, the same as the
// avatar's root rotation) and the eye. A chair faces +z turned by its yaw (the default ones face the table).
export function seatOf(p) {
  if (!isSeat(p)) return null;
  const k = PROP_KINDS[p.kind], s = p.s || 1;
  return { x: p.x, y: (p.y || 0) + k.seat * s, z: p.z, yaw: p.yaw || 0, eye: (p.y || 0) + (k.seat * s) + 0.72 };
}
// The nearest free seat within reach of (x, z): taken = Set of prop ids someone sits on. null = none.
export function nearestSeat(props, x, z, taken = new Set(), reach = SIT_REACH) {
  let best = null, bd = reach;
  for (const p of props || []) {
    if (!isSeat(p) || taken.has(p.id)) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d <= bd) { bd = d; best = p; }
  }
  return best;
}
// Who may place / move / remove props (server and web app): only in the build phase, admin or the full
// version; in a city only in the build city (shared/city.mjs isBuildCity – the other cities are copies of
// the default city preset); in an ordinary room its owner (the room key) or admin.
export function canEditProps({ buildPhase, admin = false, full = false, cityRoom = false, buildCity = false, owner = false }) {
  if (!buildPhase) return false;
  if (admin) return true;
  if (!full) return false;
  return cityRoom ? buildCity : owner;
}
// A new prop id (10 hex).
export function newPropId(rnd = Math.random) { let s = ''; for (let k = 0; k < 10; k++) s += Math.floor(rnd() * 16).toString(16); return s; }
// Stickers on any prop (Jens t521u): a prop's meshes are sticker surfaces named prop-<id>-m<k> (the k-th
// mesh of the prop, in its model's fixed order); the cuboid's / affischpelare's flat faces keep their
// prop-<id>-<face> names (room surfaces, folded over edges). Stickers are world-space like on a wall.
const MESH_SURFACE = /^prop-([a-f0-9]{10})-m\d{1,3}$/;
export const propMeshSurface = (s) => { const m = MESH_SURFACE.exec(String(s || '')); return m ? m[1] : null; };
export const onProp = (s) => /^prop-[a-f0-9]{10}-/.test(String(s || ''));
