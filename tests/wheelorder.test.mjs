// The sticker wheel's starting order (Jens, 2 Nov / 4 Nov 2026): 98 in the middle, 26, d74, e14 to
// its left; the rest of the library from the back to the right. Menu stickers are gone from the
// wheel (Esc menu replaces them) – their ids sit in WHEEL_EXCLUDE.
import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { wheelOrder, applySwaps, WHEEL_START } from '../shared/wheelorder.mjs';
import { WHEEL_EXCLUDE, FORMER_MENU_IDS, RETIRED_MENU_IDS, MENU_IDS } from '../client/src/menustickers.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const man = JSON.parse(readFileSync(join(root, 'library/manifest.json'), 'utf8')).stickers;
const src = (id) => (man.find((s) => s.id === id) || {}).source;
const lib = man.filter((s) => !s.nature).map((s) => ({ id: s.id, source: s.source }));
const at = (w, i) => w[((i % w.length) + w.length) % w.length];

{
  assert.deepEqual(WHEEL_START.map(src), ['98.png', '26.png', 'd74.png', 'e14.png']);
  assert.equal(MENU_IDS.length, 0, 'no menu stickers on the wheel any more');
  assert.ok(FORMER_MENU_IDS.length === 6);
  assert.ok(RETIRED_MENU_IDS.every((id) => WHEEL_EXCLUDE.includes(id)));
  assert.ok(FORMER_MENU_IDS.every((id) => WHEEL_EXCLUDE.includes(id)));
}
{
  const w = wheelOrder(lib, [], { menus: [], exclude: WHEEL_EXCLUDE });
  assert.ok(!w.some((d) => WHEEL_EXCLUDE.includes(d.id)), 'former + retired menu stickers stay off the wheel');
  assert.equal(at(w, 0).id, WHEEL_START[0]);
  // right of middle: library from the back (no menu block in between)
  const rest = lib.filter((d) => !WHEEL_START.includes(d.id) && !WHEEL_EXCLUDE.includes(d.id));
  assert.equal(at(w, 1).id, rest.at(-1).id);
  assert.equal(at(w, 2).id, rest.at(-2).id);
}
{
  const mine = [{ id: 'new1' }, { id: 'old1' }, { id: FORMER_MENU_IDS[0] }];
  const w = wheelOrder(lib, [...mine, { id: RETIRED_MENU_IDS[0] }], { menus: [], exclude: WHEEL_EXCLUDE });
  assert.ok(!w.some((d) => WHEEL_EXCLUDE.includes(d.id)));
  assert.ok(w.some((d) => d.id === 'new1') && w.some((d) => d.id === 'old1'));
  assert.equal(w.filter((d) => d.id === FORMER_MENU_IDS[0]).length, 0);
}
{
  const order = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(applySwaps(order, { a: 'c' }).map((d) => d.id), ['c', 'b']);
}
console.log('✔ wheelorder (no menu stickers)');
