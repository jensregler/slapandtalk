// The 120-BPM tempo grid (Jens t881u, 12 Nov 2026: "vi måste få folks takter att matcha … delar som är perfekta för
// 120 bpm samt polyrytm tänk") and entering in time (t883u): shared/tempogrid.mjs + how the footstep groove, the
// dance and peers' tempo messages use it. Run: node tests/tempogrid.test.mjs (in npm test)
import assert from 'node:assert/strict';
import * as T from '../shared/tempogrid.mjs';
import { snapWalkBpm, cleanRun, RATE_GRID, tempoRate, RUN, snapRate } from '../shared/runmode.mjs';
import { cleanPlayerTempo, danceBpmOf } from '../shared/playertempo.mjs';
import { eventsBetween, runEventsBetween, barMs, SCALE_GRID, cleanScale } from '../shared/groove.mjs';
import { danceGrid, danceRetime } from '../shared/dance.mjs';
import { loopSteps, playerTempo } from '../shared/clock.mjs';
import { GrooveSteps } from '../client/src/groove.js';

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const T0 = 1794500012345.6; // a server time in Nov 2026 (the grid is anchored at 0 – this far out it must still be exact)

ok('the set: 53 tempi 30 … 2880, sorted, unique, each 120 × num/den in lowest terms with a "BPM · n:d" label', () => {
  assert.equal(T.TEMPOS.length, 53);
  assert.equal(T.TEMPO_BPMS[0], 30); assert.equal(T.TEMPO_BPMS.at(-1), 2880);
  for (let i = 0; i < T.TEMPOS.length; i++) {
    const t = T.TEMPOS[i];
    if (i) assert.ok(t.bpm > T.TEMPOS[i - 1].bpm, 'sorted, unique');
    assert.equal(gcd(t.num, t.den), 1, t.label); assert.equal(t.bpm, 120 * t.num / t.den, t.label);
    assert.equal(t.label, `${t.bpm} · ${t.num}:${t.den}`);
    assert.ok(t.bpm >= 30 && t.bpm <= 3000);
  }
  for (const b of [30, 60, 120, 240, 480, 960, 1920]) assert.ok(T.TEMPO_BPMS.includes(b), `octaves: ${b}`);
  for (const b of [40, 80, 160, 320, 640]) assert.ok(T.TEMPO_BPMS.includes(b), `triplets: ${b}`);
  for (const [b, r] of [[180, '3:2'], [90, '3:4'], [160, '4:3'], [150, '5:4'], [96, '4:5'], [200, '5:3'], [80, '2:3'], [144, '6:5'], [210, '7:4']]) assert.equal(T.tempoInfo(b).ratio, r, `${b}`);
  assert.ok(T.TEMPO_BPMS.includes(90), 'the default 90 is on the grid (3:4)');
});
ok('snapping: nearest in log space; old 5-BPM values and junk', () => {
  for (const [a, b] of [[92, 90], [92.9, 90], [93, 96], [185, 180], [475, 480], [130, 120], [133, 144], [1000, 960], [29, 30], [3000, 2880], [1e9, 2880]]) assert.equal(T.snapTempo(a), b, `${a} → ${b}`);
  assert.equal(T.snapTempo(NaN), 90); assert.equal(T.snapTempo(-5), 90); assert.equal(snapWalkBpm('x'), 90); assert.equal(snapWalkBpm(0), 30);
  assert.equal(cleanRun({ walkBpm: 475 }).walkBpm, 480, 'a saved run mode snaps');
  for (const b of T.TEMPO_BPMS) { assert.equal(T.snapTempo(b), b); assert.ok(T.isGridTempo(b)); }
  assert.ok(!T.isGridTempo(95));
  assert.equal(T.stepTempo(120, 1), 144); assert.equal(T.stepTempo(120, -1), 105); assert.equal(T.stepTempo(30, -5), 30); assert.equal(T.stepTempo(2880, 3), 2880);
});
ok('phase: every grid tempo is anchored at server time 0 – its beats meet 120\'s on the bar line (2000 ms), exactly', () => {
  for (const t of T.TEMPOS) {
    const bar = 2000, k = Math.ceil(T0 / (bar * T.meetBars(t.bpm))) * T.meetBars(t.bpm), line = k * bar; // a bar line where they should meet
    const beat = T.beatMsOf(t.bpm), idx = line / beat;
    assert.ok(Math.abs(idx - Math.round(idx)) < 1e-6, `${t.label}: a beat on bar line ${k} (index ${idx})`);
    assert.equal(T.meetMs(t.bpm), 500 * t.den, `${t.label}: meets 120's beat every ${t.den} beats of 120`);
  }
  assert.equal(T.meetBars(180), 1); assert.equal(T.meetBars(150), 1); assert.equal(T.meetBars(144), 5); assert.equal(T.meetBars(160), 3); assert.equal(T.meetBars(90), 1);
  assert.equal(T.meetMs(180, 150), 2000, '3:2 against 5:4: every bar'); assert.equal(T.meetMs(90, 160), 6000, '3:4 against 4:3: every 3 bars');
  assert.ok(near(T.nextBeatMs(1001, 120), 1500) && near(T.nextBeatMs(1500, 120), 1500));
});
ok('the clock\'s loops (sequencers, four voices) on any two grid tempi land together on the shared bar line', () => {
  const lcm = (x, y) => (x / gcd(x, y)) * y;
  for (const [a, b] of [[120, 180], [90, 150], [144, 120], [80, 210]]) {
    const M = lcm(T.meetBars(a), T.meetBars(b)), line = Math.ceil(T0 / (2000 * M)) * 2000 * M, to = line + M * 2 * 2000 + 1;
    const sa = loopSteps(line - 1, to, { steps: 4, tempo: playerTempo(a) }).map((s) => s.t), sb = loopSteps(line - 1, to, { steps: 4, tempo: playerTempo(b) }).map((s) => s.t);
    assert.ok(near(sa[0], line, 1e-3) && near(sb[0], line, 1e-3), `${a} & ${b}: both step on bar line ${line}`);
    const common = sa.filter((x) => sb.some((y) => Math.abs(x - y) < 1e-3));
    assert.ok(common.length >= 2, `${a} & ${b}: meet more than once (${common.length})`);
  }
});
ok('footsteps (groove): every slot\'s pulses at two grid tempi meet on the shared bar line; groove scale on its grid keeps it', () => {
  const g = { scale: 1, at: 0, phase: 0 }, line = Math.ceil(T0 / 8000) * 8000; // a bar line of 120 that is also a groove bar line of 90, 150, 180
  for (const slot of [0, 1, 2, 3, 4]) for (const bpm of [120, 180, 90, 150]) {
    const ev = eventsBetween(g, slot, line - 0.5, line + 0.5, { bpm });
    assert.equal(ev.length, 1, `slot ${slot} at ${bpm}: a step on the bar line`);
  }
  for (const s of SCALE_GRID) { // bar = 2 × scale beats: an exact fraction of beats → meets 120's bar line periodically
    const beats = 2 * s; let q = 1; while (Math.abs(beats * q - Math.round(beats * q)) > 1e-9 && q < 1e6) q++;
    assert.ok(q <= 64 * 15, `scale ${s}: bar = ${beats} beats (period ${q})`);
  }
  assert.equal(cleanScale(Math.pow(2, 1 / 4)), 1.2, 'the old quarter-octave key step snaps to 6:5');
});
ok('run / crouch rates: exact (8 + k):8 / 8:(8 + k) ratios; ±100 / 300 % are octaves that stay ON the tempo grid; peers\' rates snap back exact', () => {
  for (let p = -400; p <= 400; p += 12.5) assert.ok(RATE_GRID.includes(tempoRate(p)), `${p} %`);
  for (const [p, r] of [[100, 2], [300, 4], [-100, 0.5], [-300, 0.25]]) {
    assert.equal(tempoRate(p), r);
    for (const b of [90, 120, 180]) assert.ok(T.isGridTempo(b * r) || b * r < 30 || b * r > 2880, `${b} × ${r}`);
  }
  assert.equal(snapRate(0.727273), 8 / 11); assert.equal(cleanPlayerTempo({ rate: 0.727273 }).rate, 8 / 11);
  // a run rate meets the walk grid: run pulses on 120 × 11/8 meet 120's bar line every 8 bars at most
  const line = Math.ceil(T0 / 16000) * 16000, ev = runEventsBetween({ scale: 1, at: 0, phase: 0 }, 0, line - 0.5, line + 0.5, 11 / 8, { bpm: 120 });
  assert.equal(ev.length, 1, 'an 11:8 run step on the 8-bar line');
});
ok('peers: bpm / scale / rate in a tempo message snap to the grid, so a remote player\'s steps are on the beat', () => {
  assert.deepEqual(cleanPlayerTempo({ bpm: 181.3, scale: 1.333, rate: 1.5, tune: 1 }), { bpm: 180, scale: 4 / 3, rate: 1.5, tune: 1 });
  assert.ok(near(danceBpmOf({ bpm: 120, rate: 8 / 11 }), 960 / 11, 1e-12), 'dance tempo exact, not 6 digits');
});
ok('dance: starts on a grid beat; a relayed (0.001-rounded) bpm is made exact again; a retime re-anchors on the grid', () => {
  for (const bpm of [120, 180, 150, 120 * 8 / 11, 90 * 2 / 3]) {
    const g = danceGrid(T0, { bpm: Math.round(bpm * 1000) / 1000, phaseMs: 0 }), first = T0 + g.lead * 1000, beat = g.beat * 1000;
    const k = first / beat; assert.ok(Math.abs(k - Math.round(k)) < 1e-4, `${bpm}: first beat on the grid (${k})`);
  }
  const at0 = Math.ceil(T0 / 500) * 500, cur = { at: at0, grid: danceGrid(at0, { bpm: 120, phaseMs: 0 }), loop: true };
  const r = danceRetime(at0 + 3333, cur, { bpm: 180 }), bm = 60000 / r.bpm, off = ((r.at % bm) + bm) % bm;
  assert.equal(r.phaseMs, 0); assert.ok(Math.min(off, bm - off) <= 0.5, `retimed anchor on the 180 grid (${off})`);
});
ok('entering in time (t883u): the first step waits for the next beat of tempo × rate, ≤ 0.5 s; a beat ≤ 20 ms ago is taken', () => {
  assert.equal(T.entryUnitMs(120), 500); assert.equal(T.entryUnitMs(180), 1000 / 3); assert.equal(T.entryUnitMs(30), 500, '30 BPM: half beats … quarter beats = 120\'s beat');
  assert.equal(T.entryUnitMs(60), 500); assert.equal(T.entryUnitMs(90), 1000 / 3, '90: 667 ms → half beat 333 ms'); assert.equal(T.entryUnitMs(120, 2), 250);
  assert.equal(T.entryMs(10010, 120), 10000, 'just past a beat: take it'); assert.equal(T.entryMs(10030, 120), 10500, 'else the next one');
  assert.equal(T.entryMs(10500, 120), 10500);
  for (const bpm of T.TEMPO_BPMS) { const e = T.entryMs(T0, bpm), u = T.entryUnitMs(bpm); assert.ok(e - T0 <= 500 + 1e-6 && e - T0 >= -20); assert.ok(Math.abs(e - Math.round(e / u) * u) < 0.01, `${bpm}: on its grid`); }
});
const fakeSound = () => { const played = []; return { played, ctx: null, mine: { colour: 1 }, muted: false, engine: null, play: (k, at, o) => played.push({ k, ...o }), patchFor: () => ({ patch: { layers: [], gain: 1 } }) }; };
ok('GrooveSteps: my first step after starting to walk is on the next beat of my tempo (not at the key press), then the pattern', () => {
  for (const bpm of [120, 180, 90]) {
    const s = fakeSound(), g = new GrooveSteps(s, { now: () => 0 }); clearInterval(g.watch); g.setBpm(bpm);
    let t = Math.floor(T0 / 1000) * 1000 + 137; // 137 ms after a whole second: between beats
    g.update([{ id: 'me', x: 0, z: 0, at: null }], t);
    let x = 0; for (let i = 0; i < 90; i++) { t += 16; x += 0.04; g.update([{ id: 'me', x, z: 0, at: null }], t); }
    const steps = g.log.filter((e) => e.id === 'me');
    assert.ok(steps.length >= 3, `${bpm}: steps`); assert.ok(steps[0].entry, 'the first is the entry step');
    const u = T.entryUnitMs(bpm), k = steps[0].t / u;
    assert.ok(Math.abs(k - Math.round(k)) < 1e-3 * 10, `${bpm}: entry ${steps[0].t} on the grid (${k})`);
    assert.ok(steps.slice(1).every((e) => e.t > steps[0].t), 'the pattern carries on after it');
  }
});
console.log(`tempogrid: ${n} checks ok`);
