// Dance-mode hold vector (Jens, 11 Nov 2026): while dancing, the distance from me to where the sticker
// lands sets the slap's envelope hold – 0 s within 1 m, 3 s across the city (96 m), linear, clamped.
// Not dancing: the slap's hold is untouched. Pure maths + the Sounds class with a fake engine (no browser).
// Run: node tests/dancehold.test.mjs
import assert from 'assert/strict';
import { DANCE_HOLD, danceHoldFor, slapHold, withHold } from '../shared/dancehold.mjs';
import { CITY } from '../shared/city.mjs';
import { DEFAULT_PATCHES, SYNTH } from '../shared/synth.mjs';

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const me = [0, 1.6, 0];
const at = (d) => [d, 1.6, 0]; // a sticker d metres straight ahead (same height)

await ok('the law: 1 m → 0 s, 96 m (the city across) → 3 s, the full 0–3 s hold range', () => {
  assert.equal(DANCE_HOLD.near, 1); assert.equal(DANCE_HOLD.far, CITY.width); assert.equal(DANCE_HOLD.far, 96);
  assert.equal(DANCE_HOLD.min, 0); assert.equal(DANCE_HOLD.max, 3);
  assert.deepEqual([DANCE_HOLD.min, DANCE_HOLD.max], SYNTH.layer.hold.slice(0, 2));
});

await ok('inside the near radius → 0 s', () => {
  for (const d of [0, 0.3, 0.99, 1]) assert.equal(slapHold({ dancing: true, from: me, to: at(d) }), 0, `d=${d}`);
});

await ok('at the far city wall (96 m) → 3 s; beyond is clamped to 3 s', () => {
  assert.ok(near(slapHold({ dancing: true, from: me, to: at(96) }), 3));
  // standing at the west wall, the sticker on the east wall: 96 m across the city
  assert.ok(near(slapHold({ dancing: true, from: [-48, 1.6, 0], to: [48, 1.6, 0] }), 3));
  assert.equal(slapHold({ dancing: true, from: me, to: [96, 1.6, 96] }), 3); // the diagonal (≈136 m)
});

await ok('halfway (48.5 m) → 1.5 s, and linear in between', () => {
  assert.ok(near(slapHold({ dancing: true, from: me, to: at((1 + 96) / 2) }), 1.5));
  assert.ok(near(danceHoldFor(1 + 95 / 4), 0.75)); assert.ok(near(danceHoldFor(1 + 95 * 3 / 4), 2.25));
});

await ok('near and far slaps while dancing give different holds (far > near)', () => {
  const a = slapHold({ dancing: true, from: me, to: at(3) }), b = slapHold({ dancing: true, from: me, to: at(40) });
  assert.ok(b > a && a > 0);
});

await ok('not dancing → null (the patch keeps its own hold)', () => {
  for (const d of [0, 10, 48.5, 96]) assert.equal(slapHold({ dancing: false, from: me, to: at(d) }), null);
  const p = DEFAULT_PATCHES.slap; assert.equal(withHold(p, null), p); assert.equal(withHold(p, undefined), p);
});

await ok('withHold sets every layer\'s hold (seconds) and nothing else', () => {
  const p = DEFAULT_PATCHES.slap, q = withHold(p, 1.25);
  assert.equal(q.layers.length, p.layers.length);
  q.layers.forEach((l, i) => { assert.equal(l.hold, 1.25); assert.deepEqual({ ...l, hold: 0 }, { ...p.layers[i], hold: 0 }); });
  assert.equal(withHold(p, 9).layers[0].hold, 3); assert.equal(withHold(p, -1).layers[0].hold, 0);
});

// The Sounds class (client/src/sound.js) with a fake engine: what the engine is handed.
globalThis.localStorage ||= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.addEventListener ||= () => {}; globalThis.removeEventListener ||= () => {};
let Sounds = null;
try { ({ Sounds } = await import('../client/src/sound.js')); } catch (e) { console.log('  (sound.js not importable in node: ' + e.message + ' – engine check skipped)'); }
if (Sounds) {
  const s = new Sounds(); s.muted = false; const got = [];
  s.engine = { play: (patch) => { got.push(patch); return true; } }; s.ensure = () => true;
  await ok('Sounds.play: a dancing slap hands the engine the distance hold; a plain slap the patch\'s own hold', () => {
    s.play('slap', null, { size: 0.3, exact: true, hold: slapHold({ dancing: true, from: me, to: at(48.5) }) });
    s.play('slap', null, { size: 0.3, exact: true, hold: slapHold({ dancing: true, from: me, to: at(96) }) });
    s.play('slap', null, { size: 0.3, exact: true, hold: slapHold({ dancing: false, from: me, to: at(96) }) });
    s.play('slap', null, { size: 0.3, exact: true });
    assert.equal(got.length, 4);
    assert.ok(got[0].layers.every((l) => near(l.hold, 1.5)));
    assert.ok(got[1].layers.every((l) => l.hold === 3));
    const own = s.patchFor('slap', s.mine).patch.layers.map((l) => l.hold);
    assert.deepEqual(got[2].layers.map((l) => l.hold), own);
    assert.deepEqual(got[3].layers.map((l) => l.hold), own);
    assert.ok(near(s.log.at(-4).hold, 1.5) && s.log.at(-3).hold === 3 && !('hold' in s.log.at(-2)) && !('hold' in s.log.at(-1)));
  });
}
console.log(`dancehold: ${n} ok`);
