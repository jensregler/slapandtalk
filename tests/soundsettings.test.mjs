// Sound settings (Jens, 11 Nov 2026): ONE volume control; Tempo per player, 30–3000 BPM. Since t846u
// ("ta bort den globala klockan") there is no room clock: radio.tempo() IS my Tempo. Run: node tests/soundsettings.test.mjs (in npm test)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RUN, RUN_DEFAULTS, cleanRun, cleanWalkBpm, snapWalkBpm, walkBpmToKnob, knobToWalkBpm, walkBpmLabel, WALK_KNOB_STEPS, stepWalkBpm } from '../shared/runmode.mjs';
import { TEMPO_BPMS, isGridTempo } from '../shared/tempogrid.mjs';
import { barMsAt, playerTempo } from '../shared/clock.mjs';
import * as clock from '../shared/clock.mjs';
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
ok('walk tempo range: 30…2880 BPM inclusive (the 120-BPM grid\'s ends, t881u), default 90, clamps outside', () => {
  assert.equal(RUN.walkMin, 30); assert.equal(RUN.walkMax, 2880); assert.equal(RUN_DEFAULTS.walkBpm, 90);
  assert.equal(cleanWalkBpm(30), 30); assert.equal(cleanWalkBpm(2880), 2880);
  assert.equal(cleanWalkBpm(29.9), 30); assert.equal(cleanWalkBpm(1), 30); assert.equal(cleanWalkBpm(3000.1), 2880); assert.equal(cleanWalkBpm(120000), 2880);
  assert.equal(cleanWalkBpm('x'), 90); assert.equal(cleanWalkBpm(NaN), 90); assert.equal(cleanWalkBpm(1234.56), 1234.6);
  assert.equal(cleanRun(null).walkBpm, 90); assert.equal(cleanRun({ walkBpm: 5000 }).walkBpm, 2880); assert.equal(cleanRun({ walkBpm: 10 }).walkBpm, 30);
});
ok('Tempo on the 120-BPM grid (Jens t881u; was 5 BPM steps, t868u): old saved values snap to the nearest grid tempo', () => {
  assert.equal(RUN.walkStep, undefined, 'no 5 BPM step any more');
  assert.equal(snapWalkBpm(475), 480); assert.equal(snapWalkBpm(92.4), 90); assert.equal(snapWalkBpm(185), 180); assert.equal(snapWalkBpm(1234.56), 1200);
  assert.equal(snapWalkBpm(31), 30); assert.equal(snapWalkBpm(2999), 2880); assert.equal(snapWalkBpm(1), 30); assert.equal(snapWalkBpm('x'), 90);
  assert.equal(cleanRun({ walkBpm: 475.5 }).walkBpm, 480); assert.equal(cleanRun({ walkBpm: 88 }).walkBpm, 90);
  const seen = []; for (let k = 0; k <= WALK_KNOB_STEPS; k++) { const b = knobToWalkBpm(k / WALK_KNOB_STEPS); assert.ok(isGridTempo(b), String(b)); seen.push(b); }
  assert.deepEqual(seen, [...TEMPO_BPMS], 'one slider notch per grid tempo, in order, every one reachable');
  for (const b of TEMPO_BPMS) assert.equal(knobToWalkBpm(Math.round(walkBpmToKnob(b) * WALK_KNOB_STEPS) / WALK_KNOB_STEPS), b);
});
ok('walk tempo slider: knob 0 = 30 BPM, 1 = 2880 BPM, round-trips, monotonic; labels "180 BPM · 3:2"', () => {
  assert.equal(knobToWalkBpm(0), 30); assert.equal(knobToWalkBpm(1), 2880); assert.equal(knobToWalkBpm(-1), 30); assert.equal(knobToWalkBpm(2), 2880);
  for (const b of [30, 90, 120, 180, 1200, 2880]) assert.equal(knobToWalkBpm(walkBpmToKnob(b)), b, `${b}`);
  let prev = 0; for (let k = 0; k <= 1000; k++) { const b = knobToWalkBpm(k / 1000); assert.ok(b >= prev); prev = b; }
  assert.equal(walkBpmLabel(90), '90 BPM · 3:4'); assert.equal(walkBpmLabel(120), '120 BPM · 1:1'); assert.equal(walkBpmLabel(180), '180 BPM · 3:2');
  assert.equal(walkBpmLabel(30), '30 BPM · 1:4'); assert.equal(walkBpmLabel(2880), '2880 BPM · 24:1'); assert.equal(walkBpmLabel(475.5), '480 BPM · 4:1');
  assert.equal(stepWalkBpm(90, 1), 96); assert.equal(stepWalkBpm(90, -1), 80); assert.equal(stepWalkBpm(30, -1), 30); assert.equal(stepWalkBpm(2880, 1), 2880);
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
ok('no global clock (t846u): radio.tempo() = MY Tempo – sequencers, four voices, dance, voice FX follow it; old preset bpm stays dormant', () => {
  assert.equal(clock.roomTempo, undefined, 'roomTempo (90 BPM ± a per-room nudge) is gone');
  assert.deepEqual(Object.keys(clock.MASTER).sort(), ['beatsPerBar', 'bpm'], 'MASTER = defaults only, no nudge / phase');
  const a = new Radio({ sound: fakeSound(), room: 'stad-1' }), b = new Radio({ sound: fakeSound(), room: 'stad-4' });
  assert.deepEqual(a.tempo(), { bpm: 90, phaseMs: 0 }); assert.deepEqual(b.tempo(), a.tempo(), 'the room code sets no tempo');
  for (const bpm of [30, 90, 768, 2880]) { a.setWalkBpm(bpm); assert.deepEqual(a.tempo(), { bpm, phaseMs: 0 }); assert.deepEqual(a.walkTempo(), a.tempo()); }
  a.setWalkBpm(777); assert.equal(a.tempo().bpm, 768, 'radio.setWalkBpm snaps to the 120-BPM grid (t881u)'); a.setWalkBpm(3000);
  assert.deepEqual(b.tempo(), { bpm: 90, phaseMs: 0 }, 'mine does not change yours');
  a.amb = { setBird() {}, setWind() {} }; a.set({ bpm: 500 }, { save: false }); // an old preset with a "bpm" in it: dormant
  assert.deepEqual(a.tempo(), { bpm: 2880, phaseMs: 0 }); assert.equal(a.walkBpm, 2880);
  assert.equal(a.setWalkBpm(99999), 2880); assert.equal(a.setWalkBpm(0), 30);
  assert.deepEqual(playerTempo(120), { bpm: 120, phaseMs: 0 }); assert.deepEqual(playerTempo('x'), { bpm: 90, phaseMs: 0 });
});
// A fake Sounds object with a 3-step sequencer layer on the SLAP sound (not the walk sound) – it used to
// stay on the room clock whatever the walk tempo; now it follows my Tempo too.
function fakeSlapSeq() {
  const slap = { gain: 1, layers: [{ kind: 'osc', wave: 'sine', freq: 330, a: 0.003, d: 0.1, s: 0, r: 0.05, level: 0.3, seq: { len: 3, bars: 1, steps: [0, 1, 2].map(() => ({ on: true, vol: 100 })) } }] };
  return { engine: {}, ctx: { currentTime: 0 }, muted: false, mine: null, plays: [], setRadio() {}, ready: Promise.resolve(),
    patchFor(kind) { return { patch: kind === 'slap' ? slap : null }; }, play() {}, playPatch(p, o) { this.plays.push(o); } };
}
const seqTimes = (radio, t0, ms) => { let now = t0; radio.clock = () => now; for (; now < t0 + ms; now += 16) radio.tick(); return radio.voiceLog.filter((e) => e.key === 'slap0' && !e.tone).map((e) => e.t); };
ok('other sequencer layers (and the four voices) run on MY Tempo, not a room clock', () => {
  const T0 = 1793031959884, gap = (ts) => ts.slice(1).map((t, i) => t - ts[i]);
  for (const bpm of [60, 90, 240]) {
    const r = new Radio({ sound: fakeSlapSeq(), room: 'stad-2' }); r.setWalkBpm(bpm);
    const ts = seqTimes(r, T0, 6000);
    assert.ok(ts.length >= 4, `${bpm}: ${ts.length}`);
    for (const g of gap(ts)) assert.ok(near(g, barMsAt(bpm) / 3, 1.5), `${bpm} BPM: ${g} ms (want ${barMsAt(bpm) / 3})`);
  }
  // the four voices: one loop per voice, bars: 1, on tempo() – a bar of MY tempo
  const r = new Radio({ sound: fakeSlapSeq(), room: 'stad' }); r.setWalkBpm(180); r.state = { ...r.state, voices: { on: true, vol: 0.5 } };
  let now = T0; r.clock = () => now; for (; now < T0 + 3000; now += 16) r.tick();
  const v0 = r.voiceLog.filter((e) => e.key === 'v0').map((e) => e.t);
  assert.ok(v0.length >= 3 && gap(v0).every((g) => near(g, barMsAt(180) / 3, 1.5)), `Low voice: 3 per bar of 180 BPM ${JSON.stringify(gap(v0))}`);
});
ok('Tempo UI: labelled "Tempo" (not "Walk tempo"), help says everything follows it, tempi fit 120 BPM and everyone counts from the same clock (t881u; no shared TEMPO)', () => {
  const strings = read('client/src/strings.js'), ui = read('client/src/soundui.js');
  assert.match(strings, /walkTempo: 'Tempo'/); assert.ok(!/'Walk tempo'/.test(strings) && !/'Walk tempo'/.test(ui));
  assert.ok(!/room clock|master clock/i.test(strings), 'no string talks about a room / master clock');
  assert.match(strings, /fit 120 BPM/); assert.match(strings, /same clock/); assert.match(strings, /Other players keep their own/);
});
console.log(`sound settings: ${n} checks ok`);
