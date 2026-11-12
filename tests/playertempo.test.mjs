// Per-player tempo (Jens t846u, 11 Nov 2026: "ta bort den globala klockan helt och hållet. alla har sin
// egen bpm"): shared/playertempo.mjs, the server's copy of its limits, and source checks that no room /
// master clock is left driving audio or the dance. Run: node tests/playertempo.test.mjs (in npm test)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { cleanPlayerTempo, sameTempo, danceBpmOf, myPlayerTempo, PLAYER_TEMPO, PLAYER_TEMPO_DEFAULTS } from '../shared/playertempo.mjs';
import { RUN, gaitStep, RUN_DEFAULTS } from '../shared/runmode.mjs';
import { GROOVE } from '../shared/groove.mjs';

const require = createRequire(import.meta.url);
const { cleanTempoMsg } = require('../server/realtime.js');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

ok('defaults: 90 BPM, Groove 1×, walking (rate 1, no pitch)', () => {
  assert.deepEqual(PLAYER_TEMPO_DEFAULTS, { bpm: 90, scale: 1, rate: 1, tune: 1 });
  assert.deepEqual(cleanPlayerTempo(null), PLAYER_TEMPO_DEFAULTS); assert.deepEqual(cleanPlayerTempo('x'), PLAYER_TEMPO_DEFAULTS);
  assert.equal(PLAYER_TEMPO_DEFAULTS.bpm, RUN.walkDef); assert.equal(PLAYER_TEMPO_DEFAULTS.scale, GROOVE.def);
});
ok('clamped: bpm 30…2880 (the Tempo slider, 120-BPM grid), Groove 1/64…8, rate 1/5…5 (±400 %), pitch ratio 1/4…4', () => {
  assert.deepEqual(cleanPlayerTempo({ bpm: 1e6, scale: 99, rate: 99, tune: 99 }), { bpm: 2880, scale: 8, rate: 5, tune: 4 });
  assert.deepEqual(cleanPlayerTempo({ bpm: 1, scale: 1e-9, rate: 1e-9, tune: 1e-9 }), { bpm: 30, scale: 1 / 64, rate: 0.2, tune: 0.25 });
  assert.deepEqual(cleanPlayerTempo({ bpm: 'fast', scale: -1, rate: 0, tune: NaN }), PLAYER_TEMPO_DEFAULTS);
  assert.equal(cleanPlayerTempo({ bpm: 123.456 }).bpm, 120, 'snapped to the 120-BPM grid (t881u)'); assert.equal(cleanPlayerTempo({ bpm: 92 }).bpm, 90);
  assert.equal(cleanPlayerTempo({ rate: 0.727273 }).rate, 8 / 11, 'a relayed rate back to its exact ratio'); assert.equal(cleanPlayerTempo({ scale: 1.333 }).scale, 4 / 3);
  assert.equal(PLAYER_TEMPO.maxRate, 1 + RUN.tempoMax / 100); assert.equal(PLAYER_TEMPO.minRate, 1 / (1 + RUN.tempoMax / 100));
});
ok('the server cleans a tempo message exactly like the client (server/realtime.js cleanTempoMsg)', () => {
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const pick = () => { const r = rnd(); return r < 0.1 ? NaN : r < 0.15 ? -1 : r < 0.2 ? 'x' : Math.exp((rnd() - 0.5) * 20); };
  for (let i = 0; i < 2000; i++) {
    const t = { bpm: pick() * (rnd() < 0.5 ? 100 : 1), scale: pick(), rate: pick(), tune: pick() };
    assert.deepEqual(cleanTempoMsg(t), cleanPlayerTempo(t), JSON.stringify(t));
  }
  assert.deepEqual(cleanTempoMsg(undefined), cleanPlayerTempo(undefined));
});
ok('my tempo message from my Tempo, Groove and gait; dance tempo = Tempo × run / crouch rate', () => {
  assert.deepEqual(myPlayerTempo(144, 0.5, null), { bpm: 144, scale: 0.5, rate: 1, tune: 1 });
  const run = myPlayerTempo(144, 1, gaitStep('run', RUN_DEFAULTS));
  assert.equal(run.rate, 2); assert.ok(Math.abs(run.tune - 1.49831) < 1e-4); assert.equal(danceBpmOf(run), 288);
  assert.ok(sameTempo({ bpm: 90 }, PLAYER_TEMPO_DEFAULTS) && sameTempo({ bpm: 91 }, PLAYER_TEMPO_DEFAULTS) && !sameTempo({ bpm: 96 }, PLAYER_TEMPO_DEFAULTS), '91 snaps to 90 (the grid)');
});
ok('no global clock left: no roomTempo, no room-clock tempo() in the radio, the dance clock is my tempo, peers get mine', () => {
  const src = ['shared/clock.mjs', 'shared/radio.mjs', 'client/src/radio.js', 'client/src/main.js', 'client/src/avatars.js', 'client/src/voice.js', 'client/src/groove.js', 'shared/dance.mjs', 'shared/walkseq.mjs']
    .map((p) => [p, read(p)]);
  for (const [p, s] of src) assert.ok(!/roomTempo\s*\(/.test(s), `${p}: no roomTempo()`);
  const radio = read('client/src/radio.js'), main = read('client/src/main.js');
  assert.match(radio, /tempo\(\) \{ return playerTempo\(this\.walkBpm\); \}/, 'radio.tempo() = my Tempo');
  assert.match(main, /setDanceClock\(\(\) => \(\{ nowMs: groove\.now\(\), tempo: \{ bpm: danceBpmOf\(myTempoNow\)/, 'the dance follows my own tempo');
  assert.match(main, /together\.setTempo\(myTempoNow\)/, 'my tempo goes to the room');
  assert.match(main, /tempo: pl\.tempo \}\);/, 'others\' steps use their tempo');
  assert.match(main, /voice\?\.setTempo\?\.\(bpm\)/); assert.match(main, /setSyncBpm\?\.\(bpm\)/);
  assert.match(read('server/realtime.js'), /m\.t === 'tempo'/);
});
console.log(`player tempo: ${n} checks ok`);
