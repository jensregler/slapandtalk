// Props you can't walk through, and stickers on any prop (Jens t521u, 4 Nov 2026): the shared rules.
// Run: node tests/propcollide.test.mjs
import * as C from '../shared/propcollide.mjs';
import { propMeshSurface, onProp } from '../shared/props.mjs';
import { prepareStamp } from '../shared/coverage.mjs';
const ok = (c, m, x) => { if (!c) throw new Error('FEL: ' + m + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); console.log('✔ ' + m); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const EYE = 1.6;

// a 1 × 0.76 × 1 table at (2, 0, 3)
const table = { id: 'aaaaaaaaa1', kind: 'table', x: 2, y: 0, z: 3, yaw: 0, s: 1 };
const tLocal = [{ x0: -0.5, x1: 0.5, y0: 0, y1: 0.76, z0: -0.5, z1: 0.5 }];
const col = C.createPropCollider();
col.set(table, tLocal);
ok(col.blocked(2, 3) === table.id && col.blocked(2 + 0.85, 3) === null, 'blocked: inside the table (plus the player\'s radius), not past it');
// walking at it from the west: stopped at its side (x = 1.5 − 0.3)
let [x, z] = col.move(0.9, 3, 1.4, 3, EYE);
ok(near(x, 1.5 - C.PLAYER_R) && near(z, 3), 'walking into a table: stopped at its side', [x, z]);
// sliding along it: the z movement is kept
[x, z] = col.move(1.2, 3, 1.4, 3.2, EYE);
ok(near(x, 1.2) && near(z, 3.2), 'walking along it: you slide (only the blocked part of the step is undone)', [x, z]);

// turned 90°: a long bench 3 × 0.5 along x, turned → along z
const bench = { id: 'aaaaaaaaa2', kind: 'bench', x: 10, y: 0, z: 0, yaw: Math.PI / 2, s: 1 };
col.set(bench, [{ x0: -1.5, x1: 1.5, y0: 0, y1: 0.85, z0: -0.25, z1: 0.25 }]);
ok(col.blocked(10, 1.4) === bench.id && col.blocked(10.6, 0) === null && col.blocked(10.5, 0) === bench.id, 'the box turns with the prop (yaw)');
const wb = col.boxes(bench.id)[0];
ok(near(wb.hx, 1.5) && near(wb.hz, 0.25), 'world boxes keep their size');

// height: a cuboid at 3 m up doesn't block; a rug 10 cm high doesn't
const high = { id: 'aaaaaaaaa3', kind: 'box', x: -5, y: 3, z: 0, yaw: 0, sx: 2, sy: 1, sz: 2 };
col.set(high, C.cuboidBoxes(high));
ok(col.blocked(-5, 0, EYE) === null, 'a cuboid over my head doesn\'t block');
const rug = { id: 'aaaaaaaaa4', kind: 'box', x: -10, y: 0, z: 0, yaw: 0, sx: 2, sy: 0.1, sz: 2 };
col.set(rug, C.cuboidBoxes(rug));
ok(col.blocked(-10, 0) === null, 'a low cuboid (under STEP) doesn\'t block');

// never stuck: placed on top of me / spawned inside – I can walk out (and nothing pulls me back in)
[x, z] = col.move(2.1, 3.05, 2.2, 3.05, EYE);
ok(near(x, 2.2), 'inside a prop already (placed on me): ignored, I walk on', [x, z]);
[x, z] = col.move(2.2, 3.05, 2.9, 3.05, EYE); // walking out east
[x, z] = col.move(2.9, 3.05, 2.3, 3.05, EYE); // ... and back in from outside: blocked again
ok(near(x, 2.9) || x >= 2.5 + C.PLAYER_R - 1e-6, 'once out of it, it blocks again', [x, z]);

// skip: the chair I sit on
const chair = { id: 'aaaaaaaaa5', kind: 'chair', x: 0, y: 0, z: 10, yaw: 0, s: 1 };
col.set(chair, [{ x0: -0.22, x1: 0.22, y0: 0, y1: 0.92, z0: -0.22, z1: 0.22 }]);
[x, z] = col.move(0.6, 10, 0.1, 10, EYE, chair.id);
ok(near(x, 0.1), 'the chair I sit on (skip) doesn\'t push me', [x, z]);
[x, z] = col.move(0.6, 10, 0.1, 10, EYE);
ok(near(x, 0.22 + C.PLAYER_R), 'any other time it blocks', [x, z]);

// a wall (clamp) behind a prop: pushed into the wall = clamped back into the prop = stay where I was
const wallProp = { id: 'aaaaaaaaa6', kind: 'box', x: 7.4, y: 0, z: -7.6, yaw: 0, sx: 0.8, sy: 1, sz: 0.8 };
col.set(wallProp, C.cuboidBoxes(wallProp));
const clamp = (a, b) => [Math.min(8, Math.max(-8, a)), Math.min(8, Math.max(-8, b))];
[x, z] = col.move(7.95, -6.6, 7.95, -7.1, EYE, null, clamp);
ok(!col.blocked(x, z) && near(x, 7.95) && near(z, -6.6), 'never pushed through a wall: a push that only lands back inside = stay', [x, z]);

// removal / many props
col.remove(table.id);
ok(col.blocked(2, 3) === null, 'a removed prop doesn\'t block');
const many = C.createPropCollider();
for (let i = 0; i < 400; i++) many.set({ id: (0x1000000000 + i).toString(16), x: (i % 20) * 4 - 40, z: Math.floor(i / 20) * 4 - 40, yaw: i * 0.3, y: 0 }, tLocal);
const t0 = performance.now(); let n = 0;
for (let k = 0; k < 20000; k++) { const a = Math.sin(k) * 40, b = Math.cos(k * 1.3) * 40; many.move(a, b, a + 0.04, b + 0.03, EYE); n++; }
const per = (performance.now() - t0) / n;
ok(per < 0.05, `400 props: a step costs ${(per * 1000).toFixed(1)} µs (a grid, not all 400)`);

// stickers on props: surface names
ok(propMeshSurface('prop-abcdef0123-m0') === 'abcdef0123' && propMeshSurface('prop-abcdef0123-m12') === 'abcdef0123', 'a prop mesh surface names its prop');
ok(propMeshSurface('prop-abcdef0123-px') === null && propMeshSurface('golv') === null && propMeshSurface('prop-xyz-m1') === null, '…a cuboid face, a wall, junk are not prop meshes');
ok(onProp('prop-abcdef0123-px') && onProp('prop-abcdef0123-m3') && !onProp('vägg-norr'), 'onProp: any prop surface');
const img = { width: 100, height: 100 };
const st = { id: 'x', position: [0, 1, -7.99], quaternion: [0, 0, 0, 1], size: 0.3, order: 1, surface: 'prop-abcdef0123-m0' };
ok(prepareStamp(st, img) === null && prepareStamp({ ...st, surface: 'prop-abcdef0123-pz' }, img) === null && !!prepareStamp({ ...st, surface: 'vägg-norr' }, img), 'coverage: stickers on props are never counted as hidden by / hiding the room\'s stickers');
console.log('\npropcollide: all good');
