import assert from 'assert';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

// packswheel is ESM importing strings – load via dynamic import after stubbing localStorage
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.document = { createElement: () => ({ style: {}, classList: { add() {}, remove() {}, contains() { return false; } }, appendChild() {}, querySelector() { return null; }, querySelectorAll() { return []; }, remove() {}, addEventListener() {} }), body: { appendChild() {} } };

const { addPack, readPacks, PACKS_MAX, removePack } = await import('../client/src/packswheel.js');

const pac = (n) => ({ name: 'p' + n, stickers: ['a' + n, 'b' + n, 'c' + n], urls: ['u', 'u', 'u'], bag: 1, img: 'data:x' });

assert.strictEqual(PACKS_MAX, 3);
let r = addPack(pac(1)); assert.ok(r.ok); assert.strictEqual(readPacks().length, 1);
r = addPack(pac(2)); assert.ok(r.ok);
r = addPack(pac(3)); assert.ok(r.ok); assert.strictEqual(readPacks().length, 3);
r = addPack(pac(4)); assert.ok(!r.ok && r.needsReplace && r.pending);
assert.strictEqual(readPacks().length, 3, '4th pack does not save until replace');
console.log('packswheel.test.mjs: ok');
