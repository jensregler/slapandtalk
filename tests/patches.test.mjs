import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPatch, cleanPatches, PATCH_SIZE_DEFAULT, PATCHES_MAX } from '../shared/patches.mjs';

test('cleanPatch accepts a valid stamp', () => {
  const p = cleanPatch({ id: '0123456789abcdef', p: [0, 1, 0.2], q: [0, 0, 0, 1], size: 0.14 });
  assert.equal(p.id, '0123456789abcdef');
  assert.equal(p.size, PATCH_SIZE_DEFAULT);
  assert.deepEqual(p.p, [0, 1, 0.2]);
});

test('cleanPatch rejects bad id / missing pose', () => {
  assert.equal(cleanPatch({ id: 'nope', p: [0, 0, 0], q: [0, 0, 0, 1] }), null);
  assert.equal(cleanPatch({ id: '0123456789abcdef', p: [0, 0], q: [0, 0, 0, 1] }), null);
  assert.equal(cleanPatch(null), null);
});

test('cleanPatches caps and filters', () => {
  const ok = { id: '0123456789abcdef', p: [0, 0, 0], q: [0, 0, 0, 1], size: 0.1 };
  const list = cleanPatches([ok, { id: 'bad' }, ok, ...Array(30).fill(ok)]);
  assert.equal(list.length, PATCHES_MAX);
  assert.equal(cleanPatches([]), null);
  assert.equal(cleanPatches(null), null);
});
