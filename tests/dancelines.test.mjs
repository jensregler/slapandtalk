// Dance lines (Jens t888u, 13 Nov 2026): while dancing, Highline (up/down on the aimed surface, 0…1) → the hold of
// every layer of my Steps sound (0 … 3 s), Widthline (left/right, 0…1) → the drive of every layer (0 … 1), linear,
// smoothed, the sky keeps the last values; my saved patch is never written. Pure maths + the Sounds class with a
// fake engine (no browser). Run: node tests/dancelines.test.mjs
import assert from 'assert/strict';
import { DANCE_LINES, lineHold, lineDrive, stepLines, withLines } from '../shared/dancelines.mjs';
import { DEFAULT_PATCHES, SYNTH } from '../shared/synth.mjs';

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

await ok('ranges = the synth\'s own: hold 0 … 3 s, drive 0 … 1', () => {
  assert.deepEqual([DANCE_LINES.hold.min, DANCE_LINES.hold.max], SYNTH.layer.hold.slice(0, 2));
  assert.deepEqual([DANCE_LINES.drive.min, DANCE_LINES.drive.max], SYNTH.layer.drive.slice(0, 2));
  assert.equal(DANCE_LINES.hold.max, 3); assert.equal(DANCE_LINES.drive.max, 1);
});
await ok('Highline → hold, linear: 0 → 0 s, 0.5 → 1.5 s, 1 → 3 s, clamped', () => {
  assert.equal(lineHold(0), 0); assert.ok(near(lineHold(0.5), 1.5)); assert.equal(lineHold(1), 3);
  assert.ok(near(lineHold(0.62), 1.86)); assert.equal(lineHold(-1), 0); assert.equal(lineHold(7), 3);
});
await ok('Widthline → drive, linear: 0 → 0, 0.31 → 0.31, 1 → 1, clamped', () => {
  assert.equal(lineDrive(0), 0); assert.ok(near(lineDrive(0.31), 0.31)); assert.equal(lineDrive(1), 1); assert.equal(lineDrive(2), 1);
});
await ok('first frame of a dance: straight onto the aim (no glide from nothing)', () => {
  const s = stepLines(null, { highline: 0.8, widthline: 0.2 }, 0);
  assert.ok(near(s.highline, 0.8) && near(s.widthline, 0.2) && near(s.hold, 2.4) && near(s.drive, 0.2));
});
await ok('smoothed: a jump to another surface glides (one-pole, ~150 ms), no step', () => {
  let s = stepLines(null, { highline: 0, widthline: 0 }, 0);
  s = stepLines(s, { highline: 1, widthline: 1 }, 16);
  assert.ok(s.highline > 0 && s.highline < 0.2, 'one frame moves only a bit: ' + s.highline);
  for (let i = 0; i < 60; i++) s = stepLines(s, { highline: 1, widthline: 1 }, 16); // ~1 s
  assert.ok(s.highline > 0.99 && s.drive > 0.99 && s.hold > 2.97);
});
await ok('the sky (nothing hit): the last values stay – and keep gliding to the last target', () => {
  let s = stepLines(null, { highline: 0.4, widthline: 0.7 }, 0);
  for (let i = 0; i < 100; i++) s = stepLines(s, { highline: null, widthline: null }, 16);
  assert.ok(near(s.highline, 0.4) && near(s.widthline, 0.7) && near(s.hold, 1.2));
  assert.equal(stepLines(null, {}, 16).hold, null); // never hit anything yet: no override
});
await ok('withLines: every layer gets the hold + drive, nothing else changes, the patch is not mutated', () => {
  const p = DEFAULT_PATCHES.step, copy = JSON.stringify(p), q = withLines(p, { hold: 1.25, drive: 0.4 });
  assert.equal(q.layers.length, p.layers.length);
  q.layers.forEach((l, i) => { assert.equal(l.hold, 1.25); assert.equal(l.drive, 0.4); assert.deepEqual({ ...l, hold: 0, drive: 0 }, { ...p.layers[i], hold: 0, drive: 0 }); });
  assert.equal(JSON.stringify(p), copy);
  assert.equal(withLines(p, null), p); assert.equal(withLines(p, { hold: null, drive: null }), p);
  assert.equal(withLines(p, { hold: 9, drive: 9 }).layers[0].hold, 3); assert.equal(withLines(p, { hold: 9, drive: 9 }).layers[0].drive, 1);
  assert.equal(withLines(p, { hold: 2 }).layers[0].drive, p.layers[0].drive); // one without the other
});

// The Sounds class with a fake engine: only MY steps (lines: true, as groove.js sends for walker 'me') get it.
globalThis.localStorage ||= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.addEventListener ||= () => {}; globalThis.removeEventListener ||= () => {};
let Sounds = null;
try { ({ Sounds } = await import('../client/src/sound.js')); } catch (e) { console.log('  (sound.js not importable in node: ' + e.message + ' – engine check skipped)'); }
if (Sounds) {
  const s = new Sounds(); s.muted = false; const got = [];
  s.engine = { play: (patch) => { got.push(patch); return true; } }; s.ensure = () => true;
  await ok('Sounds.play: my step with stepMod → every layer hold/drive; others\' steps, slaps and no-mod untouched', () => {
    const own = s.patchFor('step', s.mine).patch;
    s.stepMod = { hold: 1.5, drive: 0.5 };
    s.play('step', null, { exact: true, lines: true });
    s.play('step', [3, 0, 0], { exact: true, sound: { seed: 'x', colour: 1 } }); // someone else's step
    s.play('slap', null, { exact: true, size: 0.3 });
    s.stepMod = null; s.play('step', null, { exact: true, lines: true });   // the dance is over
    assert.equal(got.length, 4);
    assert.ok(got[0].layers.every((l) => near(l.hold, 1.5) && l.drive === 0.5), JSON.stringify(got[0].layers.map((l) => [l.hold, l.drive])));
    assert.ok(got[1].layers.every((l) => l.drive !== 0.5 || l.hold !== 1.5));
    assert.ok(got[3].layers.every((l, i) => near(l.hold, own.layers[i].hold) && l.drive === own.layers[i].drive));
    const log = s.stepLog.filter((e) => !e.remote);
    assert.deepEqual(log[0].holds, own.layers.map(() => 1.5)); assert.deepEqual(log[0].drives, own.layers.map(() => 0.5));
  });
}
console.log(`dancelines.test: ${n} ok`);
