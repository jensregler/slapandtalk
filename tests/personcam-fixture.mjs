// Shared by tests/personcam.test.mjs and tests/e2e-personcam.js: a synthetic recording and a screen projection.
import { roomBounds } from '../shared/autocam.mjs';
const B = roomBounds();
export const EYE = 1.6;
// A synthetic recording: n people wandering (seeded figure-eights near walls and corners too),
// slapping walls now and then and talking; person 3 joins late and leaves early.
export function fakeRecording(n, { duration = 120000, id = 'rec-pc' } = {}) {
  const players = [], events = [];
  const path = (k, t) => {
    const a = t / 1000 * (0.13 + 0.03 * k) + k * 2.1; // up to ~1.5 m/s along the curve
    const rx = B.maxX - 0.5 - 0.6 * k, rz = B.maxZ - 0.5 - 0.4 * k;
    return [Math.sin(a) * rx * (0.6 + 0.4 * Math.sin(a * 0.31 + k)), EYE, Math.sin(2 * a) * rz * 0.9];
  };
  // the way they walk (a stop keeps the last one)
  const yawAt = (k, t) => { const p0 = path(k, t - 200), p1 = path(k, t); return Math.atan2(-(p1[0] - p0[0]), -(p1[2] - p0[2])); };
  const wt = (t) => Math.floor(t / 20000) * 12000 + Math.min(t % 20000, 12000);
  for (let k = 0; k < n; k++) {
    const late = k === 2;
    const pl = { id: `p${k}`, name: ['Jens', 'Ulla', 'Bo', 'Siv'][k] };
    if (!late) players.push({ ...pl, p: path(k, 0), y: yawAt(k, 0) });
    else events.push({ t: 20000, e: 'join', ...pl, p: path(k, wt(20000)), y: yawAt(k, wt(20000)) });
    // stand still for a while every 20 s (to slap/talk), otherwise walk
    for (let t = late ? 20100 : 100; t < (late ? Math.min(90000, duration) : duration); t += 100) {
      const still = (t % 20000) > 12000;
      const tt = wt(t); // the walk pauses while they stand still (no jumps)
      events.push({ t, e: 'move', id: pl.id, p: path(k, tt), y: yawAt(k, tt), pi: 0 });
      if (still && t % 1500 === 0) { const q = path(k, tt); events.push({ t, e: 'stamp:add', by: pl.id, stamp: { id: `s${k}-${t}`, imageId: 'i', position: [B.maxX - 0.001, 1.4, q[2]], normal: [-1, 0, 0], size: 0.3 } }); }
      if (still && (t % 20000) > 15000) events.push({ t, e: 'talk', id: pl.id, l: 8 });
    }
    if (late && duration > 90000) events.push({ t: 90000, e: 'leave', id: pl.id });
  }
  events.sort((a, b) => a.t - b.t);
  return { header: { id, players, stamps: [], cameras: [], images: {} }, events, duration };
}
export function project(q, pt, aspect = 16 / 9) {
  const cy = Math.cos(q.yaw), sy = Math.sin(q.yaw), cp = Math.cos(q.pitch), sp = Math.sin(q.pitch);
  const f = [-sy * cp, sp, -cy * cp], r = [cy, 0, -sy], u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const d = [pt[0] - q.p[0], pt[1] - q.p[1], pt[2] - q.p[2]];
  const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2]; if (z <= 0.05) return null;
  const th = Math.tan((q.fov * Math.PI) / 360);
  return [(d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / z / (th * aspect), (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / z / th];
}
export const inFrame = (n, lim = 0.92) => n && Math.abs(n[0]) <= lim && Math.abs(n[1]) <= lim;

