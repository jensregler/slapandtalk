import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPatch, cleanPatches, PATCHES_MAX, patchUnwrap, slotFromP } from '../shared/patches.mjs';

test('cleanPatch accepts atlas stamp with fabric vars', () => {
  const p = cleanPatch({
    id: '0123456789abcdef', slot: 'shirt', p: [0, 1.1, 0.2],
    scale: 1.2, rot: 45, hue: 10, cycleHue: true, spin: false, scroll: 0.2,
  });
  assert.equal(p.id, '0123456789abcdef');
  assert.equal(p.slot, 'shirt');
  assert.equal(p.scale, 1.2);
  assert.equal(p.rot, 45);
  assert.equal(p.cycleHue, true);
  assert.equal(p.spin, false);
  assert.ok(!('q' in p));
  assert.ok(!('size' in p));
});

test('cleanPatch migrates legacy floating-decal shape', () => {
  const p = cleanPatch({ id: '0123456789abcdef', p: [0, 1.2, 0.2], q: [0, 0, 0, 1], size: 0.28 });
  assert.equal(p.slot, 'shirt');
  assert.equal(p.scale, 2); // 0.28 / 0.14
  assert.ok(!('q' in p));
});

test('cleanPatch rejects bad id / missing pose', () => {
  assert.equal(cleanPatch({ id: 'nope', p: [0, 0, 0] }), null);
  assert.equal(cleanPatch({ id: '0123456789abcdef', p: [0, 0] }), null);
  assert.equal(cleanPatch(null), null);
});

test('cleanPatches caps and filters', () => {
  const ok = { id: '0123456789abcdef', slot: 'pants', p: [0, 0.5, 0], scale: 1 };
  const list = cleanPatches([ok, { id: 'bad' }, ok, ...Array(30).fill(ok)]);
  assert.equal(list.length, PATCHES_MAX);
  assert.equal(cleanPatches([]), null);
  assert.equal(cleanPatches(null), null);
});

test('patchUnwrap is stable and in 0..1', () => {
  const [u, v] = patchUnwrap([0.1, 1.1, 0.2], 'shirt');
  assert.ok(u >= 0 && u <= 1);
  assert.ok(v >= 0 && v <= 1);
  assert.equal(slotFromP([0, 1.2, 0]), 'shirt');
  assert.equal(slotFromP([0, 0.5, 0]), 'pants');
});
