// Dancing NPCs (Jens t873u): seeded per city, three on the plaza 12 m apart + four in the streets, none in a
// building; musical randomized tempo / Steps / run-crouch; octave gait rates keep the dance BPM; the server
// hands them out in the welcome (and not in houses, not with NPCS=0).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import * as N from '../shared/npcs.mjs';
import { insideHouse, PLAZA, CITY } from '../shared/city.mjs';
import { cleanPatch } from '../shared/synth.mjs';
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
await ok('three on the plaza, an equilateral 12 m triangle, on the paving; nobody in a wall / bench; all in the city', () => {
  const l = N.npcsFor('stad'), p = l.filter((x) => x.plaza);
  assert.equal(p.length, 3);
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(Math.abs(Math.hypot(p[i].x - p[j].x, p[i].z - p[j].z) - 12) < 0.01);
  for (const x of p) assert.ok(Math.abs(x.x - PLAZA.x) < PLAZA.w / 2 - 1 && Math.abs(x.z - PLAZA.z) < PLAZA.d / 2 - 1);
  for (const x of l) { assert.equal(insideHouse(x.x, x.z, 0.8), null, x.id); assert.ok(Math.abs(x.x) < CITY.width / 2 - 2 && Math.abs(x.z) < CITY.depth / 2 - 2); }
});
await ok('randomized within musical bounds: Tempo on the 5 BPM grid (75–170), Groove ½/1/2, slot 0–4, octave run / crouch tempi', () => {
  for (const city of ['stad', 'stad-byggen', 'stad-abc123', 'stad-zzzz99']) for (const x of N.npcsFor(city)) {
    assert.ok(x.walkBpm % 5 === 0 && x.walkBpm >= 75 && x.walkBpm <= 170, x.walkBpm);
    assert.ok([0.5, 1, 2].includes(x.scale)); assert.ok(x.slot >= 0 && x.slot <= 4);
    assert.ok([100, 300].includes(x.run.tempo) && [-100, -300].includes(x.run.crouchTempo));
    assert.equal(x.danceBpm, danceGrid(0, { bpm: x.walkBpm }).bpm);
    assert.match(x.label, /^[A-Z][a-z]+ · NPC$/);
  }
});
await ok('Steps sound: a clean patch (noise scuff + a pentatonic oscillator, A1–A4), quiet like a footstep', () => {
  for (const x of N.npcsFor('stad')) {
    const p = x.sound.patches.step; assert.deepEqual(cleanPatch(p), p);
    assert.equal(p.layers[0].kind, 'noise'); assert.equal(p.layers[1].kind, 'osc');
    assert.ok(p.layers[1].freq >= 55 && p.layers[1].freq <= 440, p.layers[1].freq);
    assert.ok(p.layers.every((l) => l.level <= 0.2));
  }
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
