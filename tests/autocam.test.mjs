// The automatic cameramen (shared/autocam.mjs): speed limits, wall bounds, determinism, zoom range,
// sticker targets; the crew (several at once, never colliding, a start → its own path); the shot
// list (v2: one track per cameraman, round robin in the silences); and the server's { auto } entries
// for free / full version (multiCam) / demo (API + recording + GET …/shots).
// Run: node tests/autocam.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  AUTOCAM, AUTO_PATHS, AUTO_CHOICES, MAX_AUTO_CAMS, createAutoCam, createAutoCrew, crewCells, trackOf, legProfile, mmToFov, fovToMm, resolvePath, roomBounds,
  stickerTargets, liveStickerTargets, withAutoCam, autoCamSpans, autoCamTakes, recordingCrew, roomShotCamera,
} from '../shared/autocam.mjs';
import { buildTimeline, parseRecording } from '../shared/replay.mjs';
import { shotList } from '../shared/director.mjs';

const require = createRequire(import.meta.url);
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('✔ ' + name); };
const SEEDS = ['a', 'rec123:perimeter', 'ffeedd'];
const MIN = 10 * 60 * 1000;
const B = roomBounds();

await test('presets come from the room box (room.json): 3 paths + seeded, every waypoint ≥ inset from the walls', () => {
  assert.deepEqual(AUTO_PATHS, ['perimeter', 'diagonal', 'pushin']);
  assert.deepEqual(AUTO_CHOICES, [...AUTO_PATHS, 'seeded']);
  for (const p of AUTO_PATHS) for (const s of SEEDS) {
    const legs = trackOf(p, B, s);
    assert.ok(legs.length >= 6 && legs.some((l) => l.kind === 'frame') && legs.some((l) => l.kind === 'walk'), p);
    for (const l of legs) for (const q of [l.a, l.b]) assert.ok(Math.abs(q[0]) <= B.maxX - AUTOCAM.inset + 1e-9 && Math.abs(q[1]) <= B.maxZ - AUTOCAM.inset + 1e-9, `${p} ${q}`);
    for (let i = 0; i < legs.length; i++) assert.deepEqual(legs[i].b, legs[(i + 1) % legs.length].a, `${p}: a closed loop`);
  }
  // the server keeps the same list (server/app.js AUTO_CHOICES)
  assert.match(fs.readFileSync(new URL('../server/app.js', import.meta.url), 'utf8'), /const AUTO_CHOICES = \['perimeter', 'diagonal', 'pushin', 'seeded'\];/);
  const picked = new Set(Array.from({ length: 40 }, (_, i) => resolvePath('seeded', `s${i}`)));
  assert.equal(picked.size, 3, 'seeded picks every path for some seeds');
  assert.equal(resolvePath('seeded', 'x'), resolvePath('seeded', 'x'));
  assert.equal(resolvePath('pushin', 'x'), 'pushin');
});

await test('speed: ≤ 1.0 m/s walking, ≤ 0.32 m/s framing, cruise 0.5–1.0, smooth ramps (peak accel ≤ 0.45 m/s²), stops at waypoints', () => {
  const P = legProfile(7.8, 0.8); assert.ok(P.v === 0.8 && P.T > 7.8 / 0.8);
  const short = legProfile(0.5, 1.0); assert.ok(short.v < 1.0 && short.cruise === 0);
  for (const p of AUTO_PATHS) for (const s of SEEDS) {
    const c = createAutoCam({ path: p, seed: s });
    let prev = null, prevV = 0, maxV = 0, maxFrame = 0, maxA = 0, maxSway = 0, stops = 0, moving = false;
    const dt = 0.05;
    for (let t = 0; t <= 5 * 60000; t += dt * 1000) {
      const b = c.base(t), q = c.poseAt(t);
      if (prev) {
        const v = Math.hypot(b.p[0] - prev.b.p[0], b.p[2] - prev.b.p[2]) / dt;
        maxV = Math.max(maxV, v); if (b.L.kind === 'frame' && prev.b.L.i === b.L.i) maxFrame = Math.max(maxFrame, v);
        if (prev.b.L.i === b.L.i) maxA = Math.max(maxA, Math.abs(v - prevV) / dt);
        maxSway = Math.max(maxSway, Math.hypot(q.p[0] - prev.q.p[0], q.p[1] - prev.q.p[1], q.p[2] - prev.q.p[2]) / dt);
        if (v > 0.05) moving = true; else if (v < 1e-6 && moving) { stops++; moving = false; }
        prevV = v;
      }
      prev = { b, q };
    }
    assert.ok(maxV <= AUTOCAM.walk[1] + 1e-6 && maxV >= AUTOCAM.walk[0], `${p}/${s}: top speed ${maxV}`);
    assert.ok(maxFrame <= AUTOCAM.frame[1] + 1e-6 && maxFrame > 0.1, `${p}/${s}: framing ${maxFrame}`);
    assert.ok(maxA <= AUTOCAM.accel * 1.05, `${p}/${s}: accel ${maxA}`);
    assert.ok(maxSway <= AUTOCAM.walk[1] + 0.08, `${p}/${s}: with the handheld sway ${maxSway}`);
    assert.ok(stops >= 4, `${p}/${s}: stops at waypoints (${stops})`);
    for (const L of c.legsUntil(5 * 60000)) assert.ok(L.vMax >= (L.kind === 'frame' ? AUTOCAM.frame[0] : AUTOCAM.walk[0]) && L.vMax <= (L.kind === 'frame' ? AUTOCAM.frame[1] : AUTOCAM.walk[1]));
  }
});

await test('walls: the camera never comes closer than 0.6 m to a wall (sway included), eye height 1.5–1.7 m', () => {
  for (const p of AUTO_PATHS) for (const s of SEEDS) {
    const c = createAutoCam({ path: p, seed: s });
    assert.ok(c.eye >= 1.5 && c.eye <= 1.7);
    for (let t = 0; t <= MIN; t += 137) {
      const q = c.poseAt(t);
      assert.ok(q.p[0] >= B.minX + AUTOCAM.wallGap && q.p[0] <= B.maxX - AUTOCAM.wallGap && q.p[2] >= B.minZ + AUTOCAM.wallGap && q.p[2] <= B.maxZ - AUTOCAM.wallGap, `${p} ${t} ${q.p}`);
      assert.ok(q.p[1] >= 1.47 && q.p[1] <= 1.73, `${p} eye ${q.p[1]}`);
      assert.ok(Number.isFinite(q.yaw) && Math.abs(q.pitch) < 0.6, `${p} pitch ${q.pitch}`);
    }
  }
  // a smaller room: still inside
  const small = roomBounds({ width: 6, depth: 5, height: 3 });
  for (const p of AUTO_PATHS) { const c = createAutoCam({ path: p, seed: 'x', bounds: small }); for (let t = 0; t < 3 * 60000; t += 250) { const q = c.poseAt(t); assert.ok(Math.abs(q.p[0]) <= 3 - 0.6 + 1e-9 && Math.abs(q.p[2]) <= 2.5 - 0.6 + 1e-9, `${p} small ${q.p}`); } }
});

await test('pans like a person: the aim turns ≤ 60°/s (smoothstep pans over 2.6 s)', () => {
  for (const p of AUTO_PATHS) for (const s of SEEDS) {
    const c = createAutoCam({ path: p, seed: s }); let prev = null, max = 0;
    for (let t = 0; t <= MIN; t += 50) { const q = c.poseAt(t); if (prev) max = Math.max(max, Math.abs(Math.atan2(Math.sin(q.yaw - prev.yaw), Math.cos(q.yaw - prev.yaw))) / 0.05); prev = q; }
    assert.ok((max * 180) / Math.PI <= 60, `${p}/${s}: ${(max * 180) / Math.PI}°/s`);
  }
});

await test('determinism: same seed = the same take, whatever order it is asked in (seeking); another seed = another take', () => {
  for (const p of AUTO_PATHS) {
    const a = createAutoCam({ path: p, seed: 'r1' }), b = createAutoCam({ path: p, seed: 'r1' }), c = createAutoCam({ path: p, seed: 'r2' });
    const ta = a.track(3 * 60000, 500);
    const late = b.poseAt(170000); // b jumps far ahead first
    assert.deepEqual(late, a.poseAt(170000));
    assert.deepEqual(b.track(3 * 60000, 500), ta);
    assert.notDeepEqual(c.track(3 * 60000, 500), ta);
  }
});

await test('zoom: 35–70 mm (full-frame equiv.), ≤ 10 mm per 4 s beat, smooth (≤ 4 mm/s); fov follows the focal length', () => {
  assert.ok(Math.abs(mmToFov(35) - 37.849) < 0.01 && Math.abs(mmToFov(70) - 19.455) < 0.01 && Math.abs(fovToMm(mmToFov(50)) - 50) < 0.01);
  for (const p of AUTO_PATHS) {
    const c = createAutoCam({ path: p, seed: 'z' });
    let prev = null, maxRate = 0, lo = 99, hi = 0;
    for (let t = 0; t <= MIN; t += 100) {
      const q = c.poseAt(t);
      assert.ok(q.mm >= 35 && q.mm <= 70 && Math.abs(q.fov - mmToFov(q.mm)) < 0.01);
      lo = Math.min(lo, q.mm); hi = Math.max(hi, q.mm);
      if (prev) maxRate = Math.max(maxRate, Math.abs(q.mm - prev.mm) / 0.1);
      prev = q;
    }
    assert.ok(maxRate <= 4.0, `${p} zoom rate ${maxRate}`);
    assert.ok(hi - lo >= 4 && hi <= AUTOCAM.idleMm[1] + 1e-9, `${p}: breathes gently when nothing happens (${lo}–${hi})`);
    const bs = c.beatsUntil(MIN);
    for (let i = 1; i < bs.length; i++) assert.ok(Math.abs(bs[i].mm - bs[i - 1].mm) <= AUTOCAM.maxMmStep + 1e-9);
  }
});

// A small recording: a sticker slapped on the north wall at 20 s, the room's auto cameraman on at 5 s.
const T0 = Date.parse('2026-10-26T10:00:00Z');
const rec = (extra = []) => {
  const header = { format: 'slapandtalk-rec', v: 1, id: 'feedc0de00', room: 'test', startedAt: new Date(T0).toISOString(), players: [], stamps: [{ id: 'old1', imageId: 'i1', position: [0, 1.5, -4.99], normal: [0, 0, 1], size: 0.3 }], cameras: [], images: {} };
  const ev = [
    { t: 5000, e: 'camera:add', camera: { id: 'aaaaaaaaaa', name: 'Auto cameraman', auto: 'pushin', p: [0, 1.6, 0], yaw: 0, pitch: 0, fov: 50 } },
    { t: 20000, e: 'stamp:add', stamp: { id: 's1', imageId: 'i1', position: [1, 1.6, -4.99], normal: [0, 0, 1], size: 0.4 } },
    { t: 21000, e: 'stamp:add', stamp: { id: 's2', imageId: 'i1', position: [1.5, 1.2, -4.99], normal: [0, 0, 1], size: 0.3 } },
    ...extra,
  ];
  const text = [JSON.stringify(header), ...ev.map((e) => JSON.stringify(e)), JSON.stringify({ t: 90000, e: 'end' })].join('\n');
  return buildTimeline(parseRecording(text));
};

await test('targets: recent stickers (not the ones already there) pull the aim and the zoom toward their wall area; old news fades', () => {
  const tl = rec();
  const prov = stickerTargets(tl);
  assert.equal(prov.targetsAt(10000).length, 0, 'the sticker already there at the start is not news');
  const at = prov.targetsAt(24000);
  assert.ok(at.length === 2 && at.every((x) => x.kind === 'sticker' && x.weight > 0.8 && x.n === 2), JSON.stringify(at));
  assert.equal(prov.targetsAt(60000).length, 0, 'after recentMs nothing is news any more');
  // the push-in toward the north wall: find a seed whose wall is north (z = minZ), the aim then goes to the area
  const seed = Array.from({ length: 60 }, (_, i) => `n${i}`).find((s) => trackOf('pushin', B, s)[0].look[2] < -4.9);
  const cam = createAutoCam({ path: 'pushin', seed, provider: prov }), plain = createAutoCam({ path: 'pushin', seed });
  const bs = cam.beatsUntil(40000), pb = plain.beatsUntil(40000);
  const hit = bs.filter((b) => b.target.kind === 'sticker');
  assert.ok(hit.length >= 2 && hit[0].t >= 20000 && hit[0].t <= 24000, JSON.stringify(bs.map((b) => [b.t, b.target.kind, b.mm])));
  assert.ok(Math.max(...hit.map((b) => b.mm)) > Math.max(...pb.slice(5, 10).map((b) => b.mm)), 'zooms in on the stickers');
  assert.ok(bs.slice(0, 5).every((b) => b.target.kind === 'track'), 'before the slap: the track’s own aim');
  // the live provider agrees on the same data
  const live = liveStickerTargets(() => [{ id: 's1', position: [1, 1.6, -4.99], normal: [0, 0, 1], size: 0.4, createdAt: new Date(T0 + 20000).toISOString() }], T0);
  assert.equal(live.targetsAt(22000).length, 1); assert.equal(live.targetsAt(70000).length, 0);
  // a floor sticker is no wall area
  assert.equal(liveStickerTargets(() => [{ id: 'f', position: [0, 0, 0], normal: [0, 1, 0], size: 0.4, createdAt: new Date(T0).toISOString() }], T0).targetsAt(1000).length, 0);
});

await test('the step-2 hook: any target provider steers the aim (here a fake "speaker" provider), deterministic', () => {
  const speaker = { name: 'fake-activity', targetsAt: (t) => (t >= 8000 ? [{ id: 'p1', kind: 'speaker', p: [0, 1.5, 0], size: 0.6, weight: 0.9 }] : []) };
  const c = createAutoCam({ path: 'perimeter', seed: 'h', provider: speaker });
  const bs = c.beatsUntil(30000);
  assert.ok(bs.some((b) => b.target.kind === 'speaker' && b.target.id === 'p1'));
  assert.equal(c.provider, 'fake-activity');
});

await test('crew: 1–6 cells (whole room, halves, thirds, 2×2, 3×2), each track inside its own cell, ≥ 1.2 m from every other track', () => {
  assert.equal(MAX_AUTO_CAMS, 6);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => crewCells(n, B).length), [1, 2, 3, 4, 6, 6]);
  const c = createAutoCrew([{ key: 'a', seed: 'x' }]);
  assert.equal(c.members[0].box, null, 'alone: the whole room, exactly like before');
  const rnd = (i) => { let h = 2166136261; for (const ch of String(i)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return ((h >>> 0) % 10000) / 10000; };
  let worst = Infinity;
  for (let cfg = 0; cfg < 24; cfg++) {
    const n = 2 + (cfg % 5);
    const specs = Array.from({ length: n }, (_, i) => ({ key: `k${i}`, seed: `s${cfg}:${i}`, path: [...AUTO_CHOICES][(cfg + i) % 4],
      ...(rnd(`${cfg}${i}`) < 0.5 ? { start: [(rnd(`x${cfg}${i}`) - 0.5) * (B.maxX - B.minX), (rnd(`z${cfg}${i}`) - 0.5) * (B.maxZ - B.minZ)] } : {}) }));
    const crew = createAutoCrew(specs);
    for (let t = 0; t <= 3 * 60000; t += 500) {
      const ps = crew.members.map((m) => m.poseAt(t).p);
      crew.members.forEach((m, i) => { const q = m.base(t).p; assert.ok(q[0] >= m.box.minX - 1e-3 && q[0] <= m.box.maxX + 1e-3 && q[2] >= m.box.minZ - 1e-3 && q[2] <= m.box.maxZ + 1e-3, `cfg ${cfg}: ${m.key} leaves its cell`); });
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) worst = Math.min(worst, Math.hypot(ps[i][0] - ps[j][0], ps[i][2] - ps[j][2]));
    }
  }
  assert.ok(worst >= AUTOCAM.crewGapM - 0.08, `closest two cameramen came ${worst.toFixed(3)} m (sway included)`);
});

await test('a start (the click): the cameraman starts there, Automatic → a loop through the start, a chosen path keeps its shape', () => {
  assert.equal(resolvePath('seeded', 'q', [1, 1]), 'loop');
  assert.equal(resolvePath('diagonal', 'q', [1, 1]), 'diagonal');
  for (const start of [[2, 1], [-3.5, -2.5], [0.4, -0.6]]) {
    const solo = createAutoCam({ seed: 'st', start });
    const p0 = solo.base(0).p;
    assert.ok(solo.path === 'loop' && Math.hypot(p0[0] - start[0], p0[2] - start[1]) <= 0.45, `${start} → ${p0}`);
    const legs = solo.legsUntil(60000);
    assert.ok(legs.some((L) => L.kind === 'frame') && legs.some((L) => L.kind === 'walk'));
    const pre = createAutoCam({ seed: 'st', start, path: 'perimeter' }), q0 = pre.base(0).p;
    const seg = (L) => { const [ax, az] = L.a, [bx, bz] = L.b, dx = bx - ax, dz = bz - az, k = Math.max(0, Math.min(1, ((start[0] - ax) * dx + (start[1] - az) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(ax + k * dx - start[0], az + k * dz - start[1]); };
    const nearest = Math.min(...pre.legsUntil(120000).map(seg));
    assert.ok(pre.path === 'perimeter' && Math.hypot(q0[0] - start[0], q0[2] - start[1]) <= nearest + 0.45, `starts at the nearest point of its path (${nearest})`);
  }
  // two with starts in different halves get those halves, and stay apart
  const crew = createAutoCrew([{ key: 'w', seed: 'a', start: [-3, 0] }, { key: 'e', seed: 'b', start: [3, 0] }]);
  assert.ok(crew.get('w').box.maxX < 0 && crew.get('e').box.minX > 0, JSON.stringify(crew.members.map((m) => m.box)));
  // determinism: the same crew = the same takes, whatever order they are asked in
  const again = createAutoCrew([{ key: 'w', seed: 'a', start: [-3, 0] }, { key: 'e', seed: 'b', start: [3, 0] }]);
  assert.deepEqual(again.get('e').poseAt(95000), crew.get('e').poseAt(95000));
  assert.deepEqual(again.get('w').track(60000, 1000), crew.get('w').track(60000, 1000));
});

await test('shot list v2: one track per room cameraman (autocam:<id>), the generic takes stay, silences go round robin', () => {
  const talk = []; for (const a of [12000, 40000, 66000]) for (let t = a; t < a + 6000; t += 80) talk.push({ t, e: 'talk', id: 'p1', l: 8 });
  const tl = rec([{ t: 1000, e: 'join', id: 'p1', name: 'Jens', p: [0, 1.6, 2], y: 0 },
    { t: 6000, e: 'camera:add', camera: { id: 'bbbbbbbbbb', name: 'Auto cameraman 2', auto: 'seeded', seq: 2, start: [3, 2], p: [0, 1.6, 0], yaw: 0, pitch: 0, fov: 50 } }, ...talk]);
  const spans = autoCamSpans(tl);
  assert.deepEqual(spans.map((x) => [x.id, x.from, x.start]), [['aaaaaaaaaa', 5000, null], ['bbbbbbbbbb', 6000, [3, 2]]]);
  const list = withAutoCam(shotList(tl), tl);
  assert.ok(list.format === 'slapandtalk-shots' && list.autocam.v === 2 && !('room' in list.autocam));
  assert.deepEqual(list.autocam.crew.map((c) => [c.view, c.label, c.on[0].path]), [['autocam:aaaaaaaaaa', 'Auto cameraman', 'pushin'], ['autocam:bbbbbbbbbb', 'Auto cameraman 2', 'loop']]);
  assert.deepEqual(list.autocam.takes.map((t) => t.view), ['auto:perimeter', 'auto:diagonal', 'auto:pushin']);
  for (const v of ['director', 'close:p1', 'autocam:aaaaaaaaaa', 'autocam:bbbbbbbbbb', 'auto:pushin']) assert.ok(list.views.some((x) => x.view === v), v);
  const b = list.autocam.crew[1];
  assert.ok(b.track.samples[0][0] === 6000 && b.beats[0].t >= 6000, 'its track starts when it was switched on');
  const rc = recordingCrew(tl, { seed: 'feedc0de00' });
  const q = rc.poseAt('bbbbbbbbbb', 10000); assert.deepEqual(b.track.samples.find((x) => x[0] === 10000), [10000, ...q.p, q.yaw, q.pitch, q.mm], 'the replay’s pose = the shot list');
  const room = list.shots.filter((x) => x.kind === 'room' && x.from >= 6000);
  assert.ok(room.length >= 2, JSON.stringify(list.shots.map((x) => [x.kind, x.from])));
  assert.ok(new Set(room.map((x) => x.camera)).size === 2 && room.every((x) => x.camera.startsWith('autocam:')), 'they take turns: ' + room.map((x) => x.camera).join());
  assert.deepEqual(room.map((x) => x.camera), room.map((x) => crewViewOf(roomShotCamera(rc, shotList(tl).shots, shotList(tl).shots.find((s) => s.from === x.from)))));
  assert.ok(list.shots.filter((x) => x.kind === 'room' && x.from < 5000).every((x) => x.camera === 'room'), 'before any cameraman: the fixed corner');
  assert.deepEqual(JSON.parse(JSON.stringify(withAutoCam(shotList(tl), tl))), JSON.parse(JSON.stringify(list)), 'the same recording → the same shot list');
  const long = autoCamTakes({ ...tl, duration: 3600000 }, { seed: 'x', paths: ['perimeter'] });
  assert.ok(long[0].track.samples.length <= 1250 && long[0].track.stepMs === 3000);
});
function crewViewOf(s) { return s ? `autocam:${s.id}` : 'room'; }

// ---------- Server: the { auto } camera entries – free / full version (multiCam) / demo ----------
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { attachRealtime } = require('../server/realtime');
const { createRecorder } = require('../server/recorder');
const { makeEntitlements } = require('../server/entitlements');
const { demoSettings, createDemo } = require('../server/demo');
const FULL = 'autocam-full-key-123456';
async function serve(opts = {}, env = { FULL_ACCESS_KEYS: FULL }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-autocam-'));
  const store = createStore(new LocalAdapter(dir));
  const recorder = createRecorder(store, { flushMs: 100, tickMs: 20 });
  const demo = opts.demo ? createDemo({ store, settings: demoSettings({ DEMO_PROFILE: '1' }), log: { log() {}, error() {} } }) : null;
  const app = createApp(store, { adminToken: 'adm', recorder, entitle: makeEntitlements(env), demo });
  const server = app.listen(0); const rt = attachRealtime(server, { maxPlayers: 5, heartbeatMs: 500, recorder });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = (method, url, { key, unlock, body } = {}) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(key ? { 'x-room-key': key } : {}), ...(unlock ? { 'x-unlock': unlock } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const { room: { id: R }, roomKey: KEY } = await (await api('POST', '/api/rooms', { body: {} })).json();
  return { api, R, KEY, close: async () => { await recorder.close(); rt.close(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
await test('server, free: ONE cameraman, always automatic (no path, no start), no settings, only the creator; recorded, in GET …/shots', async () => {
  const { api, R, KEY, close } = await serve();
  try {
    const rs = await (await api('POST', `/api/rooms/${R}/recording/start`, { key: KEY })).json();
    assert.equal((await api('POST', `/api/rooms/${R}/cameras`, { body: { auto: 'seeded' } })).status, 403, 'only the creator');
    assert.equal((await api('POST', `/api/rooms/${R}/cameras`, { key: KEY, body: { auto: 'spiral' } })).status, 400);
    const a = await (await api('POST', `/api/rooms/${R}/cameras`, { key: KEY, body: { auto: 'diagonal', start: [2, 2], p: [9, 9, 9] } })).json();
    assert.ok(a.camera.auto === 'seeded' && !a.camera.start && a.camera.name === 'Auto cameraman 1' && a.camera.p.join() === '0,1.6,0' && a.camera.fov === 50, JSON.stringify(a));
    const again = await api('POST', `/api/rooms/${R}/cameras`, { key: KEY, body: { auto: 'seeded' } });
    assert.equal(again.status, 400); assert.match((await again.json()).error, /already has its auto cameraman/);
    const put = await api('PUT', `/api/rooms/${R}/cameras/${a.camera.id}`, { key: KEY, body: { auto: 'perimeter' } });
    assert.equal(put.status, 403); assert.match((await put.json()).error, /no settings/);
    const fixed = await (await api('POST', `/api/rooms/${R}/cameras`, { key: KEY, body: { p: [1, 1.6, 1], yaw: 0.3 } })).json();
    assert.ok(fixed.camera && !fixed.camera.auto && fixed.camera.name === 'Camera 1', 'placed cameras have their own budget');
    await new Promise((r) => setTimeout(r, 300));
    await api('POST', `/api/rooms/${R}/recording/stop`, { key: KEY });
    const shots = await (await api('GET', `/api/rooms/${R}/recordings/${rs.recording.recId}/shots`)).json();
    assert.ok(shots.autocam.v === 2 && shots.autocam.crew.length === 1 && shots.autocam.crew[0].view === `autocam:${a.camera.id}` && shots.autocam.takes.length === 3, JSON.stringify(shots.autocam.crew.map((c) => c.view)));
    assert.equal((await api('DELETE', `/api/rooms/${R}/cameras/${a.camera.id}`, { key: KEY })).status, 200, 'off = removed');
  } finally { await close(); }
});
await test('server, full version (multiCam key): up to 6 cameramen, each with a start and an optional path; the 7th → 400', async () => {
  const { api, R, KEY, close } = await serve();
  try {
    const ids = [];
    for (let i = 0; i < 6; i++) {
      const r = await (await api('POST', `/api/rooms/${R}/cameras`, { key: KEY, unlock: FULL, body: { auto: i === 1 ? 'pushin' : 'seeded', start: [i - 2.5, 30] } })).json();
      assert.ok(r.camera && r.camera.name === `Auto cameraman ${i + 1}` && r.camera.seq === i + 1, JSON.stringify(r)); ids.push(r.camera);
    }
    assert.ok(ids[1].auto === 'pushin' && ids[0].start[0] === -2.5 && ids[0].start[1] < 5, 'start kept, clamped inside the room');
    const seventh = await api('POST', `/api/rooms/${R}/cameras`, { key: KEY, unlock: FULL, body: { auto: 'seeded' } });
    assert.equal(seventh.status, 400); assert.match((await seventh.json()).error, /At most 6/);
    const u = await (await api('PUT', `/api/rooms/${R}/cameras/${ids[0].id}`, { key: KEY, unlock: FULL, body: { auto: 'diagonal', start: null } })).json();
    assert.ok(u.camera.auto === 'diagonal' && !u.camera.start);
    assert.equal((await api('PUT', `/api/rooms/${R}/cameras/${ids[0].id}`, { key: KEY, body: { auto: 'perimeter' } })).status, 403, 'without the key: no settings');
    await api('DELETE', `/api/rooms/${R}/cameras/${ids[2].id}`, { key: KEY });
    const r = await (await api('POST', `/api/rooms/${R}/cameras`, { key: KEY, unlock: FULL, body: { auto: 'seeded' } })).json();
    assert.equal(r.camera.name, 'Auto cameraman 3', 'the lowest free number');
  } finally { await close(); }
});
await test('server, demo: the creator may switch on the one automatic cameraman; placing cameras stays off; a key unlocks nothing', async () => {
  const { api, R, KEY, close } = await serve({ demo: true }, { FULL_ACCESS_KEYS: FULL, DEMO_PROFILE: '1' });
  try {
    assert.equal((await api('POST', `/api/rooms/${R}/cameras`, { key: KEY, body: { p: [1, 1.6, 1] } })).status, 403, 'placing a camera');
    assert.equal((await api('POST', `/api/rooms/${R}/cameras`, { body: { auto: 'seeded' } })).status, 403, 'not the creator');
    const a = await api('POST', `/api/rooms/${R}/cameras`, { key: KEY, unlock: FULL, body: { auto: 'pushin', start: [1, 1] } });
    const j = await a.json();
    assert.ok(a.status === 200 && j.camera.auto === 'seeded' && !j.camera.start, JSON.stringify(j));
    assert.equal((await api('POST', `/api/rooms/${R}/cameras`, { key: KEY, unlock: FULL, body: { auto: 'seeded' } })).status, 400, 'only one');
    assert.equal((await api('PUT', `/api/rooms/${R}/cameras/${j.camera.id}`, { key: KEY, unlock: FULL, body: { auto: 'perimeter' } })).status, 403);
    assert.equal((await api('DELETE', `/api/rooms/${R}/cameras/${j.camera.id}`, { key: KEY })).status, 200, 'and switch it off again');
  } finally { await close(); }
});
console.log(`autocam: ${passed} passed`);
