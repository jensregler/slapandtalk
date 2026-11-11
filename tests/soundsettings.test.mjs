// Sound settings (Jens, 11 Nov 2026): ONE volume control; walk tempo per player, 30–3000 BPM, only
// for that player's walk-sound sequencer (not the room clock). Run: node tests/soundsettings.test.mjs (in npm test)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RUN, RUN_DEFAULTS, cleanRun, cleanWalkBpm, walkBpmToKnob, knobToWalkBpm, walkBpmLabel } from '../shared/runmode.mjs';
import { roomTempo, barMsAt } from '../shared/clock.mjs';
import { Radio } from '../client/src/radio.js';

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const near = (a, b, e = 0.5) => Math.abs(a - b) <= e;
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

ok('one volume control: the header "Music vol" duplicate is gone, Volume lives in the Master block', () => {
  const html = read('client/index.html'), radio = read('client/src/radio.js'), main = read('client/src/main.js');
  assert.ok(!/id="music-vol/.test(html), 'no #music-vol / #music-vol-row in the page');
  assert.ok(!/music-vol/.test(main), 'main.js does not wire a second volume input');
  assert.equal((radio.match(/type = 'range'[^\n]*id = 'master-vol'/g) || []).length, 1, 'exactly one Volume slider in the Master block');
  assert.ok(!/Master volume/.test(radio), 'no separate "Master volume" control name');
});
ok('walk tempo range: 30…3000 BPM inclusive, default 90, clamps outside', () => {
  assert.equal(RUN.walkMin, 30); assert.equal(RUN.walkMax, 3000); assert.equal(RUN_DEFAULTS.walkBpm, 90);
  assert.equal(cleanWalkBpm(30), 30); assert.equal(cleanWalkBpm(3000), 3000);
  assert.equal(cleanWalkBpm(29.9), 30); assert.equal(cleanWalkBpm(1), 30); assert.equal(cleanWalkBpm(3000.1), 3000); assert.equal(cleanWalkBpm(120000), 3000);
  assert.equal(cleanWalkBpm('x'), 90); assert.equal(cleanWalkBpm(NaN), 90); assert.equal(cleanWalkBpm(1234.56), 1234.6);
  assert.equal(cleanRun(null).walkBpm, 90); assert.equal(cleanRun({ walkBpm: 5000 }).walkBpm, 3000); assert.equal(cleanRun({ walkBpm: 10 }).walkBpm, 30);
});
ok('walk tempo slider (log): knob 0 = 30 BPM, 1 = 3000 BPM, round-trips, monotonic', () => {
  assert.equal(knobToWalkBpm(0), 30); assert.equal(knobToWalkBpm(1), 3000); assert.equal(knobToWalkBpm(-1), 30); assert.equal(knobToWalkBpm(2), 3000);
  assert.ok(near(knobToWalkBpm(0.5), 300, 0.1), 'geometric middle = 300 BPM');
  for (const b of [30, 90, 300, 1200, 3000]) assert.ok(near(knobToWalkBpm(walkBpmToKnob(b)), b, b * 0.003), `${b}`);
  let prev = 0; for (let k = 0; k <= 1000; k++) { const b = knobToWalkBpm(k / 1000); assert.ok(b >= prev); prev = b; }
  assert.equal(walkBpmLabel(90), '90.0 BPM'); assert.equal(walkBpmLabel(3000), '3000 BPM'); assert.equal(walkBpmLabel(30), '30.0 BPM');
});

// A fake Sounds object: only the Steps sound has a 4-step sequencer layer; plays are logged.
function fakeSound() {
  const step = { gain: 1, layers: [{ kind: 'osc', wave: 'sine', freq: 220, a: 0.003, d: 0.1, s: 0, r: 0.05, level: 0.3, seq: { len: 4, bars: 1, steps: [0, 1, 2, 3].map(() => ({ on: true, vol: 100 })) } }] };
  return { engine: {}, ctx: { currentTime: 0 }, muted: false, mine: null, plays: [], setRadio() {}, ready: Promise.resolve(),
    patchFor(kind) { return { patch: kind === 'step' ? step : null }; }, play() {},
    playPatch(p, o) { this.plays.push(o); } };
}
// Walk for `ms` and return the walk-sequencer step times.
function walkSteps(radio, t0, ms) {
  let now = t0; radio.clock = () => now;
  for (; now < t0 + ms; now += 16) { radio.setWalk({ until: now + 140 }); radio.tick(); }
  return radio.voiceLog.filter((e) => e.walk && !e.tone).map((e) => e.t);
}
ok('per player: two players with different walk tempos – each walk sequencer follows its own', () => {
  const T0 = 1793031959884;
  const a = new Radio({ sound: fakeSound(), room: 'stad' }), b = new Radio({ sound: fakeSound(), room: 'stad' });
  assert.equal(a.walkBpm, 90); assert.equal(b.walkBpm, 90);
  a.setWalkBpm(180);
  assert.equal(a.walkBpm, 180); assert.equal(b.walkBpm, 90, 'changing mine does not change yours');
  const ta = walkSteps(a, T0, 2400), tb = walkSteps(b, T0, 2400);
  const gap = (ts) => ts.slice(1).map((t, i) => t - ts[i]);
  assert.ok(ta.length >= 5 && tb.length >= 2, `${ta.length} / ${tb.length}`);
  for (const g of gap(ta)) assert.ok(near(g, barMsAt(180) / 4, 1.5), `A: ${g} ms`);
  for (const g of gap(tb)) assert.ok(near(g, barMsAt(90) / 4, 1.5), `B: ${g} ms`);
});
ok('walk tempo is not a global clock: the room clock (sequencers, voices, dance, voice FX) ignores it', () => {
  const r = new Radio({ sound: fakeSound(), room: 'stad' }), room = roomTempo('stad');
  for (const b of [30, 90, 777, 3000]) { r.setWalkBpm(b); assert.deepEqual(r.tempo(), { bpm: room.bpm, phaseMs: room.phaseMs }); assert.equal(r.walkTempo().bpm, b); }
  r.amb = { setBird() {}, setWind() {} }; r.set({ bpm: 500 }, { save: false }); // an old preset with a "bpm" in it: dormant, does not touch either
  assert.deepEqual(r.tempo(), { bpm: room.bpm, phaseMs: room.phaseMs }); assert.equal(r.walkBpm, 3000);
  assert.equal(r.setWalkBpm(99999), 3000); assert.equal(r.setWalkBpm(0), 30);
});
console.log(`sound settings: ${n} checks ok`);
