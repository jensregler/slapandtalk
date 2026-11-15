// Dancing NPCs (Jens t873u / t893u): seeded per city, three on the plaza in a tight conversation + four in the streets, none in a
// building; musical randomized tempo / Steps / run-crouch; octave gait rates keep the dance BPM; the server
// hands them out in the welcome (and not in houses, not with NPCS=0).
import assert from 'node:assert/strict';
import { isGridTempo } from '../shared/tempogrid.mjs';
import { createRequire } from 'node:module';
import http from 'node:http';
import * as N from '../shared/npcs.mjs';
import { insideHouse, PLAZA, CITY, CITY_SPAWN } from '../shared/city.mjs';
import { cleanPatch } from '../shared/synth.mjs';
import { LIBRARY_IDS } from '../shared/samplelib.mjs';
import { danceGrid } from '../shared/dance.mjs';
const require = createRequire(import.meta.url);
let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };

await ok('only a city outside has NPCs: 7 in "stad", none in a house or an ordinary room', () => {
  assert.equal(N.npcsFor('stad').length, 7); assert.equal(N.npcsFor('stad-byggen').length, 7);
  assert.equal(N.npcsFor('stad-3').length, 0); assert.equal(N.npcsFor('stad-byggen-1').length, 0); assert.equal(N.npcsFor('abc123').length, 0);
});
await ok('deterministic per city (the same list every time), different cities differ', () => {
  assert.deepEqual(N.npcsFor('stad'), N.npcsFor('stad'));
  assert.notDeepEqual(N.npcsFor('stad').map((x) => x.sound.patches), N.npcsFor('stad-byggen').map((x) => x.sound.patches));
});
await ok('three on the plaza, a tight conversation triangle, on the paving, clear of spawn; nobody in a wall / bench; all in the city', () => {
  const l = N.npcsFor('stad'), p = l.filter((x) => x.plaza);
  assert.equal(p.length, 3);
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(Math.abs(Math.hypot(p[i].x - p[j].x, p[i].z - p[j].z) - N.NPC.plazaSide) < 0.01);
  assert.ok(N.NPC.plazaSide >= 1 && N.NPC.plazaSide <= 1.5);
  for (const x of p) {
    assert.ok(Math.abs(x.x - PLAZA.x) < PLAZA.w / 2 - 1 && Math.abs(x.z - PLAZA.z) < PLAZA.d / 2 - 1);
    assert.ok(Math.hypot(x.x - CITY_SPAWN.x, x.z - CITY_SPAWN.z) > 2.5, x.id); // not on top of the mid-plaza spawn
  }
  for (const x of l) { assert.equal(insideHouse(x.x, x.z, 0.8), null, x.id); assert.ok(Math.abs(x.x) < CITY.width / 2 - 2 && Math.abs(x.z) < CITY.depth / 2 - 2); }
});
await ok('randomized within musical bounds: Tempo on the 120-BPM grid (75–180, t881u), Groove ½/1/2, slot 0–4, octave run / crouch tempi', () => {
  for (const city of ['stad', 'stad-byggen', 'stad-abc123', 'stad-zzzz99']) for (const x of N.npcsFor(city)) {
    assert.ok(isGridTempo(x.walkBpm) && N.NPC_BPMS.includes(x.walkBpm) && x.walkBpm >= 75 && x.walkBpm <= 180, x.walkBpm);
    assert.ok([0.5, 1, 2].includes(x.scale)); assert.ok(x.slot >= 0 && x.slot <= 4);
    assert.ok([100, 300].includes(x.run.tempo) && [-100, -300].includes(x.run.crouchTempo));
    assert.equal(x.danceBpm, danceGrid(0, { bpm: x.walkBpm }).bpm);
    assert.match(x.label, /^[A-Z][a-z]+ · NPC$/);
  }
});
await ok('Steps sound: a clean Sampler layer on a site library sample, a short sequencer, quiet-ish like a footstep', () => {
  const libs = new Set();
  const list = N.npcsFor('stad');
  list.forEach((x, k) => {
    const p = x.sound.patches.step; assert.deepEqual(cleanPatch(p), p);
    assert.equal(p.layers.length, 1); assert.equal(p.layers[0].kind, 'sampler');
    assert.ok(LIBRARY_IDS.includes(p.layers[0].library), p.layers[0].library);
    assert.equal(p.layers[0].library, N.npcLibraryId(`npc:stad:${k}`));
    libs.add(p.layers[0].library);
    assert.ok(p.layers[0].note >= 45 && p.layers[0].note <= 72, p.layers[0].note);
    assert.ok(p.layers[0].level <= 0.85);
    assert.ok(p.seq && p.seq.len >= 4 && p.seq.steps.some((s) => s.on));
  });
  assert.ok(libs.size >= 4, [...libs]);
  // two cities pick independently (not all the same sample as each other)
  assert.notDeepEqual(list.map((x) => x.sound.patches.step.layers[0].library), N.npcsFor('stad-byggen').map((x) => x.sound.patches.step.layers[0].library));
});
await ok('gait changes on the clock (walk / run / crouch per 32-beat segment), the same for everyone; octave rates keep the steps on the dance\'s beat', () => {
  const x = N.npcsFor('stad')[0], seg = N.npcSegMs(x), seen = new Set();
  for (let k = 0; k < 60; k++) {
    const t = (Math.floor(1794500000000 / seg) + k) * seg + 5;
    const g = N.npcGaitAt(x, t); seen.add(g);
    assert.equal(g, N.npcGaitAt(x, t + seg - 20)); // constant within a segment
    const tp = N.npcTempoAt(x, t);
    assert.ok([1, 2, 4, 0.5, 0.25].includes(tp.rate), tp.rate);
    const oct = Math.log2((tp.bpm * tp.rate) / x.danceBpm); assert.ok(Math.abs(oct - Math.round(oct)) < 1e-9, oct); // steps an octave off the dance at most: still on its beat
  }
  assert.deepEqual([...seen].sort(), ['crouch', 'run', 'walk']);
  assert.deepEqual(N.npcDance(x), { at: 0, bpm: x.danceBpm, phaseMs: 0, loop: true });
});
await ok('Wild (t894u): each NPC presses the Steps Wild button on a seeded 20–60 s period, desynchronised; the same clock → the same patch everywhere', () => {
  const now = 1794500000000;
  const list = N.npcsFor('stad');
  assert.ok(N.NPC_WILD.minMs === 20_000 && N.NPC_WILD.maxMs === 60_000);
  const periods = new Set(), phases = new Set();
  for (const x of list) {
    const period = N.npcWildPeriod(x), phase = N.npcWildPhase(x);
    assert.equal(period, N.npcWildPeriod(x)); // deterministic
    assert.ok(period >= N.NPC_WILD.minMs && period <= N.NPC_WILD.maxMs, period);
    assert.ok(phase >= 0 && phase < period, phase);
    periods.add(period); phases.add(phase);
    const i = N.npcWildIndex(x, now);
    const t0 = i * period + phase; // this press starts here
    assert.equal(N.npcWildIndex(x, now), i);
    assert.equal(N.npcWildIndex(x, t0), i);
    assert.equal(N.npcWildIndex(x, t0 + period - 1), i); // constant until the next press
    assert.equal(N.npcWildIndex(x, t0 + period), i + 1);
    const raw = N.npcWildPatch(x, i);
    assert.equal(raw.layers[0].kind, 'sampler');
    assert.ok(LIBRARY_IDS.includes(raw.layers[0].library), raw.layers[0].library);
    const p = N.npcStepPatchAt(x, now);
    assert.deepEqual(p, N.npcStepPatchAt(x, now));
    // live patch = that Wild roll with cutoff drift + a seq tweak applied (same clock → same result)
    assert.equal(p.layers[0].kind, 'sampler');
    assert.equal(p.layers[0].library, raw.layers[0].library);
    assert.deepEqual(cleanPatch(p), p);
    assert.ok(p.gain <= 1.5 && p.layers.length >= 1 && p.layers.length <= 5);
    assert.ok(p.layers.every((l) => l.level <= 1 && l.level >= 0 && (l.drive || 0) <= 1));
    assert.notDeepEqual(raw, x.sound.patches.step); // a Wild roll, not the welcome footstep
    assert.notDeepEqual(N.npcWildPatch(x, i + 1), raw); // the next press is a new roll
    const later = N.npcStepPatchAt(x, now + period);
    assert.notDeepEqual(later, p);
    // tempo / gait are independent of Wild (same clock → same tempo; Wild does not retune the grid)
    assert.deepEqual(N.npcTempoAt(x, now), N.npcTempoAt(x, now));
    assert.equal(x.walkBpm, N.npcTempoAt(x, now).bpm);
    assert.equal(x.danceBpm, N.npcDance(x).bpm);
  }
  assert.ok(periods.size >= 2 && phases.size >= 2, { periods: [...periods], phases: [...phases] }); // not all in lockstep
  // two cities at the same clock: different sounds (the seed includes the city)
  const a = N.npcsFor('stad')[0], b = N.npcsFor('stad-byggen')[0];
  assert.notDeepEqual(N.npcStepPatchAt(a, now), N.npcStepPatchAt(b, now));
});
await ok('cutoff drift (t967u): 10–60 s period, smooth in a musical range, the same on every screen', () => {
  const now = 1794500000000;
  const list = N.npcsFor('stad');
  const periods = new Set();
  for (const x of list) {
    const period = N.npcMotionPeriod(x, 'cutoff'), phase = N.npcMotionPhase(x, 'cutoff');
    assert.equal(period, N.npcMotionPeriod(x, 'cutoff'));
    assert.ok(period >= N.NPC_MOTION.minMs && period <= N.NPC_MOTION.maxMs, period);
    assert.ok(phase >= 0 && phase < period);
    periods.add(period);
    const a = N.npcCutoffAt(x, now), b = N.npcCutoffAt(x, now + 200);
    assert.equal(a, N.npcCutoffAt(x, now));
    assert.ok(a >= 250 && a <= 5600, a);
    // over a short slice it only moves a little (smooth), and a full period later it can differ
    assert.ok(Math.abs(b - a) < 400, { a, b });
    const mid = N.npcCutoffAt(x, now + Math.floor(period / 2));
    assert.ok(mid >= 250 && mid <= 5600, mid);
  }
  assert.ok(periods.size >= 2, [...periods]);
  assert.notEqual(N.npcCutoffAt(list[0], now), N.npcCutoffAt(N.npcsFor('stad-byggen')[0], now));
});
await ok('sequencer tweaks (t967u): 10–60 s windows, a small change (toggle / condition / ratchet), synced', () => {
  const now = 1794500000000;
  const x = N.npcsFor('stad')[0];
  const period = N.npcMotionPeriod(x, 'seq');
  assert.ok(period >= N.NPC_MOTION.minMs && period <= N.NPC_MOTION.maxMs);
  const a = N.npcSeqAt(x, now, x.sound.patches.step.seq);
  const b = N.npcSeqAt(x, now, x.sound.patches.step.seq);
  assert.deepEqual(a, b);
  assert.ok(a.steps.some((s) => s.on));
  const c = N.npcSeqAt(x, now + period, x.sound.patches.step.seq);
  // a later window is computed independently – may or may not differ; over several windows it does
  let differed = JSON.stringify(a) !== JSON.stringify(c);
  for (let k = 2; k < 12 && !differed; k++) differed = JSON.stringify(a) !== JSON.stringify(N.npcSeqAt(x, now + k * period, x.sound.patches.step.seq));
  assert.ok(differed, 'seq should change in some window');
  const live = N.npcStepPatchAt(x, now, { wild: false });
  assert.equal(live.layers[0].kind, 'sampler');
  assert.equal(live.layers[0].library, x.sound.patches.step.layers[0].library); // Theme B: welcome sample, still drifting
  assert.equal(live.layers[0].cutoff, N.npcCutoffAt(x, now));
  assert.deepEqual(live.seq, N.npcSeqAt(x, now, x.sound.patches.step.seq));
});
await ok('cleanNpcs: drops junk, keeps the server list as is', () => {

  const l = N.npcsFor('stad'); assert.equal(N.cleanNpcs(l).length, 7);
  assert.deepEqual(N.cleanNpcs([{ id: 'x' }, null, 5]), []); assert.deepEqual(N.cleanNpcs('no'), []);
});
await ok('server: the welcome carries the city outside\'s NPCs (not players: welcome.players stays empty); a house gets none; NPCS=0 = none', async () => {
  const { WebSocket } = require('ws');
  const { attachRealtime } = require('../server/realtime.js');
  const srv = http.createServer(); const rt = attachRealtime(srv, {});
  await new Promise((r) => srv.listen(0, r)); const port = srv.address().port;
  const welcome = (room) => new Promise((res, rej) => { const ws = new WebSocket(`ws://localhost:${port}/ws?room=${room}`); ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name: 'T' }))); ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'welcome') { ws.close(); res(m); } }); ws.on('error', rej); });
  const a = await welcome('stad');
  assert.equal(a.npcs.length, 7); assert.equal(a.players.length, 0); assert.equal(a.count, 1);
  assert.deepEqual(a.npcs, JSON.parse(JSON.stringify(N.npcsFor('stad'))));
  assert.equal((await welcome('stad-2')).npcs.length, 0);
  process.env.NPCS = '0'; assert.equal((await welcome('stad-byggen')).npcs.length, 0); delete process.env.NPCS;
  rt.close(); srv.close();
});
console.log(`npcs.test: ${n} ok`);
