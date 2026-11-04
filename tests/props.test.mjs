// 3D props, the shared rules (shared/props.mjs; Jens t491u + t509u, 4 Nov 2026).
// Run: node tests/props.test.mjs
import * as P from '../shared/props.mjs';
const ok = (c, m, x) => { if (!c) throw new Error('FEL: ' + m + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); console.log('✔ ' + m); };
const CITY = { width: 96, height: 24, depth: 96 };

ok(P.isProp('chair') && P.isProp('box') && P.isProp('sign-stop') && !P.isProp('nope') && !P.isProp('__proto__'), 'the catalogue knows its kinds (and nothing else)');
for (const k of ['lamp', 'bin', 'elskap', 'postlada', 'bench', 'planter', 'tree', 'bikerack', 'busstop', 'pillar', 'cone', 'market', 'kiosk', 'phonebooth', 'car', 'fountain', 'statue',
  'sign-stop', 'sign-yield', 'sign-30', 'sign-crossing', 'sign-parking', 'sign-oneway'])
  if (!P.isProp(k)) throw new Error('FEL: missing city kind ' + k);
ok(true, 'the city set is all there (lights, bins, elskåp, PostNord, benches … Swedish road signs)');
ok(P.isSeat({ kind: 'chair' }) && P.isSeat({ kind: 'bench' }) && !P.isSeat({ kind: 'table' }), 'chairs and benches are seats, tables are not');

// cleanProp
const c = P.cleanProp({ id: 'abcdef0123', kind: 'lamp', x: 999, z: -3.14159, yaw: -Math.PI / 2, s: 9 }, CITY);
ok(c && c.x === 48 && c.z === -3.142 && c.s === P.PROP_SCALE.max && Math.abs(c.yaw - 3 * Math.PI / 2) < 1e-3 && c.y === 0, 'cleanProp: clamped to the space, scale 0.25–4, yaw 0–2π', c);
ok(P.cleanProp({ id: 'abcdef0123', kind: 'chair', x: 0, z: 0, s: 0.01 }).s === 0.25, 'cleanProp: the smallest scale is 0.25×');
ok(!P.cleanProp({ id: 'xyz', kind: 'chair', x: 0, z: 0 }) && !P.cleanProp({ id: 'abcdef0123', kind: 'nope', x: 0, z: 0 }) && !P.cleanProp({ id: 'abcdef0123', kind: 'chair', x: 'a', z: 0 }), 'cleanProp: a bad id, kind or number = not a prop');
const b = P.cleanProp({ id: 'abcdef0123', kind: 'box', x: 1, z: 2, sx: 40, sy: 0.01, sz: 3.33333, color: '#3F7FD0', s: 3 }, CITY);
ok(b && b.sx === 32 && b.sy === 0.1 && b.sz === 3.333 && b.color === '#3f7fd0' && !('s' in b), 'cleanProp: a cuboid keeps its own W/H/D (0.1–32 m wide/deep, 0.1–24 m high) and colour, no scale', b);
ok(P.cleanProp({ id: 'abcdef0123', kind: 'box', x: 0, z: 0, sy: 99, color: 'red' }, CITY).sy === 24 && P.cleanProp({ id: 'abcdef0123', kind: 'box', x: 0, z: 0, color: 'red' }).color === P.BOX_COLOURS[0], 'cleanProp: a cuboid is at most 24 m high; an unknown colour = the first toon colour');
const many = Array.from({ length: P.MAX_PROPS + 20 }, (_, i) => ({ id: (0x1000000000 + i).toString(16), kind: 'cone', x: 0, z: 0 }));
ok(P.cleanProps(many).length === P.MAX_PROPS && P.cleanProps([c, c, { bad: 1 }], CITY).length === 1 && P.cleanProps('x') === null, 'cleanProps: each id once, bad ones dropped, at most MAX_PROPS');

// defaults
ok(P.propsOf({}).length === 5 && P.propsOf({}).filter((p) => p.kind === 'chair').length === 4, 'a room without props has the table with 4 chairs');
ok(P.propsOf({}, true).length === 0, 'a city\'s outside without props has none');
ok(P.propsOf({ props: [] }).length === 0, 'a room whose props were all removed stays empty');
ok(P.cleanProps(P.defaultProps()).length === 5, 'the default set is valid props');
const d = P.defaultProps(); d[0].x = 5; ok(P.DEFAULT_ROOM_PROPS[0].x === 0, 'defaultProps gives copies');

// seats
const ch = P.DEFAULT_ROOM_PROPS[1], s = P.seatOf(ch);
ok(s && s.x === ch.x && s.z === ch.z && s.y > 0.3 && s.y < 0.6 && s.eye > s.y, 'seatOf: the seat height and the eye', s);
ok(P.nearestSeat(P.DEFAULT_ROOM_PROPS, -0.5, 0).id === 'd0000000a1', 'nearestSeat: the nearest chair');
ok(P.nearestSeat(P.DEFAULT_ROOM_PROPS, -0.5, 0, new Set(['d0000000a1'])).id === 'd0000000a2', 'nearestSeat: a taken chair is skipped');
ok(P.nearestSeat(P.DEFAULT_ROOM_PROPS, 6, 6) === null, 'nearestSeat: none within reach');

// who may edit
const E = P.canEditProps;
ok(!E({ buildPhase: false, admin: true }), 'not outside the build phase (not even admin)');
ok(E({ buildPhase: true, admin: true, cityRoom: true }), 'admin: anywhere in the build phase');
ok(!E({ buildPhase: true, full: false, owner: true }), 'the free version: no');
ok(E({ buildPhase: true, full: true, owner: true }) && !E({ buildPhase: true, full: true, owner: false }), 'the full version: in your own room');
ok(E({ buildPhase: true, full: true, cityRoom: true, buildCity: true }) && !E({ buildPhase: true, full: true, cityRoom: true, buildCity: false, owner: true }), 'the full version: in the build city, not in another city');
ok(P.isPropId(P.newPropId()) && !P.isPropId('ABCDEF0123'), 'newPropId: 10 hex');
console.log('\nprops: all good');
