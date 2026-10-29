// Unit: own uploads per version (Jens, 29 Oct 2026, point 9) – free = ONE own sticker, a new upload
// replaces it; full ('uploads') = all; the entitlement exists on both sides and OPEN_ACCESS opens it.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { FREE_UPLOADS, uploadsToReplace, shownUploads } from '../shared/uploads.mjs';
import { FEATURES as CLIENT_FEATURES } from '../client/src/entitlements.js';
const require = createRequire(import.meta.url);
const { FEATURES, makeEntitlements } = require('../server/entitlements.js');

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const m = (...ids) => ids.map((id) => ({ id }));
ok('free = one own upload', () => assert.equal(FREE_UPLOADS, 1));
ok('free: a new upload replaces every older one', () => {
  assert.deepEqual(uploadsToReplace(m('a', 'b'), 'b', false), ['a']);
  assert.deepEqual(uploadsToReplace(m('a', 'b', 'c'), 'c', false), ['a', 'b']);
  assert.deepEqual(uploadsToReplace(m('a'), 'a', false), []); // the first upload: nothing to replace
  assert.deepEqual(uploadsToReplace(m('b', 'a'), 'a', false), ['b']); // the same image again = still one
});
ok('full: nothing is replaced', () => assert.deepEqual(uploadsToReplace(m('a', 'b', 'c'), 'c', true), []));
ok('the palette: free shows only the newest upload (older ones stay stored), full shows all', () => {
  assert.deepEqual(shownUploads(m('a', 'b', 'c'), false), m('c'));
  assert.deepEqual(shownUploads(m('a', 'b', 'c'), true), m('a', 'b', 'c'));
  assert.deepEqual(shownUploads([], false), []);
});
ok("'uploads' is an entitlement in the browser and on the server", () => {
  assert.ok(FEATURES.includes('uploads') && CLIENT_FEATURES.includes('uploads'));
  assert.deepEqual([...FEATURES].sort(), [...CLIENT_FEATURES].sort());
});
ok('free (OPEN_ACCESS off) has no uploads flag; the full version and OPEN_ACCESS have it', () => {
  const off = makeEntitlements({ OPEN_ACCESS: '0', DEV_UNLOCK: '1' });
  assert.equal(off({}).uploads, false); assert.equal(off({ dev: true }).uploads, true);
  const on = makeEntitlements({ OPEN_ACCESS: '1' });
  assert.equal(on({}).uploads, true);
});
console.log(`uploads: ${n} passed`);
