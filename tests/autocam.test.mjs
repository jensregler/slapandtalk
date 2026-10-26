// The automatic cameraman (shared/autocam.mjs): speed limits, wall bounds, determinism, zoom range,
// sticker targets, the shot-list takes; and the server's { auto } camera entry (API + recording +
// GET …/shots). Run: node tests/autocam.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  AUTOCAM, AUTO_PATHS, AUTO_CHOICES, createAutoCam, trackOf, legProfile, mmToFov, fovToMm, resolvePath, roomBounds,
  stickerTargets, liveStickerTargets, withAutoCam, autoCamSpans, roomAutoPathAt, autoCamTakes,
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

await test('shot list: auto takes per path (legs, beats, track with timestamps), the views to cut between, the director’s room shot uses the room’s auto cameraman', () => {
  const talk = []; for (let t = 30000; t < 36000; t += 80) talk.push({ t, e: 'talk', id: 'p1', l: 8 });
  const tl = rec([{ t: 1000, e: 'join', id: 'p1', name: 'Jens', p: [0, 1.6, 2], y: 0 }, ...talk]);
  const spans = autoCamSpans(tl);
  assert.equal(spans.length, 1); assert.equal(spans[0].from, 5000); assert.equal(roomAutoPathAt(spans, 3000, 'feedc0de00'), null); assert.equal(roomAutoPathAt(spans, 6000, 'feedc0de00'), 'pushin');
  const list = withAutoCam(shotList(tl), tl);
  assert.equal(list.format, 'slapandtalk-shots');
  assert.deepEqual(list.autocam.takes.map((t) => t.view), ['auto:perimeter', 'auto:diagonal', 'auto:pushin']);
  const pt = list.autocam.takes[2];
  assert.ok(pt.label === 'Auto cameraman: Push-in' && pt.seed === 'feedc0de00:pushin' && pt.legs.length > 3 && pt.beats.length === Math.floor(90000 / 4000) + 1);
  assert.deepEqual(pt.track.columns, ['t', 'x', 'y', 'z', 'yaw', 'pitch', 'mm']);
  assert.ok(pt.track.samples.length === 91 && pt.track.samples[10][0] === 10000);
  // the replay's take (the same seed) gives the very same pose as the shot list says
  const replayCam = createAutoCam({ path: 'pushin', seed: 'feedc0de00:pushin', provider: stickerTargets(tl) });
  const q = replayCam.poseAt(10000); assert.deepEqual(pt.track.samples[10], [10000, ...q.p, q.yaw, q.pitch, q.mm]);
  assert.ok(list.views.some((v) => v.view === 'director') && list.views.some((v) => v.view === 'close:p1') && list.views.some((v) => v.view === 'auto:pushin'));
  const room = list.shots.filter((s) => s.kind === 'room');
  assert.ok(room.length >= 2 && room.every((s) => s.camera === (s.from >= 5000 ? 'auto:pushin' : 'room')), JSON.stringify(list.shots));
  assert.ok(list.shots.some((s) => s.kind !== 'room' && s.camera === `${s.kind}:p1`));
  assert.deepEqual(list.autocam.room, [{ from: 5000, to: 90000, choice: 'pushin', view: 'auto:pushin' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(withAutoCam(shotList(tl), tl))), JSON.parse(JSON.stringify(list)), 'the same recording → the same shot list');
  // an hour stays small: ≤ ~1200 samples per take
  const long = autoCamTakes({ ...tl, duration: 3600000 }, { seed: 'x', paths: ['perimeter'] });
  assert.ok(long[0].track.samples.length <= 1250 && long[0].track.stepMs === 3000);
});

// ---------- Server: the { auto } camera entry ----------
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { attachRealtime } = require('../server/realtime');
const { createRecorder } = require('../server/recorder');
await test('server: one auto cameraman per room, path changes, no placed↔auto conversion, recorded, in GET …/shots', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-autocam-'));
  const store = createStore(new LocalAdapter(dir));
  const recorder = createRecorder(store, { flushMs: 100, tickMs: 20 });
  const app = createApp(store, { adminToken: 'adm', recorder });
  const server = app.listen(0); const rt = attachRealtime(server, { maxPlayers: 5, heartbeatMs: 500, recorder });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = (method, url, { key, body } = {}) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(key ? { 'x-room-key': key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    const { room: { id: R }, roomKey: KEY } = await (await api('POST', '/api/rooms', { body: {} })).json();
    const rs = await (await api('POST', `/api/rooms/${R}/recording/start`, { key: KEY })).json();
    assert.equal((await api('POST', `/api/rooms/${R}/cameras`, { body: { auto: 'perimeter' } })).status, 403, 'only the creator');
    assert.equal((await api('POST', `/api/rooms/${R}/cameras`, { key: KEY, body: { auto: 'spiral' } })).status, 400);
    const a = await (await api('POST', `/api/rooms/${R}/cameras`, { key: KEY, body: { auto: 'diagonal', p: [9, 9, 9] } })).json();
    assert.ok(a.camera.auto === 'diagonal' && a.camera.name === 'Auto cameraman' && a.camera.p.join() === '0,1.6,0' && a.camera.fov === 50, JSON.stringify(a));
    const again = await api('POST', `/api/rooms/${R}/cameras`, { key: KEY, body: { auto: 'perimeter' } });
    assert.equal(again.status, 400); assert.match((await again.json()).error, /already has an auto cameraman/);
    const u = await (await api('PUT', `/api/rooms/${R}/cameras/${a.camera.id}`, { key: KEY, body: { auto: 'seeded', p: [1, 1, 1] } })).json();
    assert.ok(u.camera.auto === 'seeded' && u.camera.p.join() === '0,1.6,0');
    const fixed = await (await api('POST', `/api/rooms/${R}/cameras`, { key: KEY, body: { p: [1, 1.6, 1], yaw: 0.3 } })).json();
    assert.ok(fixed.camera && !fixed.camera.auto && fixed.camera.name === 'Camera 1');
    assert.equal((await api('PUT', `/api/rooms/${R}/cameras/${fixed.camera.id}`, { key: KEY, body: { auto: 'perimeter' } })).status, 400, 'a placed camera stays placed');
    const room = await (await api('GET', `/api/rooms/${R}/stamps`)).json();
    assert.equal(room.cameras.filter((c) => c.auto).length, 1);
    await new Promise((r) => setTimeout(r, 400));
    await api('POST', `/api/rooms/${R}/recording/stop`, { key: KEY });
    const shots = await (await api('GET', `/api/rooms/${R}/recordings/${rs.recording.recId}/shots`)).json();
    assert.ok(shots.autocam && shots.autocam.takes.length === 3 && shots.autocam.room.length === 2 && shots.autocam.room[0].choice === 'diagonal' && shots.autocam.room[1].choice === 'seeded', JSON.stringify(shots.autocam?.room));
    assert.ok(shots.views.some((v) => v.view === 'auto:perimeter'));
  } finally { await recorder.close(); rt.close(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
await test('demo: placing cameras stays off on the server, the auto cameraman entry too (the replay takes need no entry)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-autocam-demo-'));
  const store = createStore(new LocalAdapter(dir));
  const app = createApp(store, { adminToken: 'adm', demo: { on: true, roomMs: 3600000, warnMs: 600000, maxPlayers: 5, maxMembers: 5, style: {} } });
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const r = await fetch(`${base}/api/rooms/abc/cameras`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auto: 'perimeter' }) });
    assert.equal(r.status, 403);
  } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
console.log(`autocam: ${passed} passed`);
