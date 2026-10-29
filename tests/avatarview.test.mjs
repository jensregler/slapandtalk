// Unit: the 'My avatar' camera (client/src/avatarview.js).
import assert from 'node:assert/strict';
import { SHOW, freeRect, fitDist, fitFov, showPose, showTurn } from '../client/src/avatarview.js';

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
// a 10×10 m room, walls at ±5
const room = (o, d) => { let t = Infinity; for (const [i, w] of [[0, 5], [0, -5], [2, 5], [2, -5]]) { if (!d[i]) continue; const s = (w - o[i]) / d[i]; if (s > 0) t = Math.min(t, s); } return t; };

ok('computer: the free area is left of the panel', () => {
  const r = freeRect(1280, 800, { left: 908, top: 12, right: 1268, bottom: 788, width: 360, height: 776 });
  assert.deepEqual(r, { x: 0, y: 0, w: 908, h: 800 });
});
ok('phone: the free area is above the bottom sheet', () => {
  const r = freeRect(390, 844, { left: 0, top: 360, right: 390, bottom: 844, width: 390, height: 484 });
  assert.deepEqual(r, { x: 0, y: 0, w: 390, h: 360 });
});
ok('no panel rect: the whole screen', () => assert.deepEqual(freeRect(800, 600, null), { x: 0, y: 0, w: 800, h: 600 }));
ok('fitDist / fitFov agree', () => {
  const r = { x: 0, y: 0, w: 908, h: 800 }, d = fitDist(1280, 800, r);
  assert.ok(Math.abs(fitFov(1280, 800, r, d) - SHOW.fov) < 1e-6);
  assert.ok(d > 3 && d < 5, d);
});
ok('middle of the room: the camera stands in front of me, long lens, the figure fills the free height', () => {
  const p = showPose({ at: [0, 0], yaw: 0, cast: room, W: 1280, H: 800, rect: { x: 0, y: 0, w: 908, h: 800 } });
  assert.equal(p.faceYaw, 0); assert.equal(p.fov, SHOW.fov);
  assert.ok(p.position[2] < -3 && Math.abs(p.position[0]) < 1e-9, p.position);
  // projected height of the frame = the free height
  const px = (SHOW.frameH / (2 * p.dist * Math.tan((p.fov * Math.PI) / 360))) * 800;
  assert.ok(px >= 799 && px <= 801, px);
  assert.deepEqual(p.offset, [640 - 454, 0]);
});
ok('facing a wall up close: the camera turns to the side with room (never through the wall)', () => {
  const p = showPose({ at: [0, -4.6], yaw: 0, cast: room, W: 1280, H: 800, rect: { x: 0, y: 0, w: 908, h: 800 } });
  assert.ok(p.position[2] > -5 + SHOW.wallGap - 1e-9 && Math.abs(p.position[0]) <= 5 - SHOW.wallGap + 1e-9, p.position);
  assert.notEqual(p.faceYaw, 0);
  assert.ok(p.dist >= fitDist(1280, 800, { x: 0, y: 0, w: 908, h: 800 }) - 1e-9);
});
ok('in a tiny space: closer, with a wider lens (capped)', () => {
  const small = (o, d) => Math.min(1.2, room(o, d));
  const p = showPose({ at: [0, 0], yaw: 0, cast: small, W: 1280, H: 800, rect: { x: 0, y: 0, w: 908, h: 800 } });
  assert.ok(p.dist <= 1.2 - SHOW.wallGap + 1e-9 && p.fov > SHOW.fov && p.fov <= SHOW.maxFov, p);
});
ok('the turn: facing the camera at phase 0, sways ±SHOW.sway, dragging adds', () => {
  assert.equal(showTurn(1, 0, 0), 1 + Math.PI);
  assert.ok(Math.abs(showTurn(0, 0, Math.PI / 2) - (Math.PI + SHOW.sway)) < 1e-12);
  assert.equal(showTurn(0, 2, 0), Math.PI + 2);
});
console.log(`avatarview: ${n} passed`);
