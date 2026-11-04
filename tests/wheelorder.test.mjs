// Unit: the sticker wheel's start order (Jens, 2 Nov 2026; 4 Nov t507u) – 98 in the middle, 26, d74, e14 to the left,
// the menu stickers to the right and after them the list from the back (shared/wheelorder.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { wheelOrder, applySwaps, WHEEL_START } from '../shared/wheelorder.mjs';
import { MENU_IDS, MENU_STICKERS, MENU_ORDER, RETIRED_MENU_IDS } from '../client/src/menustickers.js';
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const man = JSON.parse(fs.readFileSync(new URL('../library/manifest.json', import.meta.url))).stickers;
const src = (id) => (man.find((m) => m.id === id) || {}).source;
const lib = man.filter((m) => !m.nature).map((m) => ({ id: m.id }));
const at = (list, k) => list[((k % list.length) + list.length) % list.length];

ok('98, 26, d74, e14 and every menu sticker are in the library (by picture id)', () => {
  assert.deepEqual(WHEEL_START.map(src), ['98.png', '26.png', 'd74.png', 'e14.png']);
  assert.deepEqual(MENU_IDS.map(src), ['character.png', 'redio.png', 'room.png', 'city.png', 'exit.png', 'editor.png']);
  assert.equal(MENU_IDS.length, MENU_ORDER.length); assert.ok(MENU_IDS.every((id) => MENU_STICKERS[id]));
  assert.equal(Object.keys(MENU_STICKERS).length, 6); // t471u: only these six are active
  assert.deepEqual(RETIRED_MENU_IDS.map(src), [undefined, 'menue.png', undefined]); // 4 Nov: camera + stickerpac out of the library (knappar has 7)
  assert.ok(RETIRED_MENU_IDS.every((id) => !MENU_STICKERS[id]));
  assert.ok(!man.some((m) => /^rita/i.test(m.source || ''))); // rita.png is not in the library
});
ok('the real library: middle 98, left 26 d74 e14, right the menus then the list from the back; each once', () => {
  const w = wheelOrder(lib, [], { menus: MENU_IDS, exclude: RETIRED_MENU_IDS });
  const retiredIn = RETIRED_MENU_IDS.filter((id) => src(id)).length;
  const n = lib.length - retiredIn;
  assert.equal(w.length, n); assert.equal(new Set(w.map((d) => d.id)).size, n);
  assert.ok(!w.some((d) => RETIRED_MENU_IDS.includes(d.id))); // camera, menue, stickerpac: not on the wheel
  assert.equal(src(w[0].id), '98.png');
  assert.deepEqual([-1, -2, -3].map((k) => src(at(w, k).id)), ['26.png', 'd74.png', 'e14.png']);
  assert.deepEqual(MENU_IDS.map((_, i) => at(w, 1 + i).id), MENU_IDS);
  const rest = lib.filter((d) => !WHEEL_START.includes(d.id) && !MENU_IDS.includes(d.id) && !RETIRED_MENU_IDS.includes(d.id));
  assert.equal(at(w, 1 + MENU_IDS.length).id, rest.at(-1).id); assert.equal(at(w, 2 + MENU_IDS.length).id, rest.at(-2).id);
  assert.equal(at(w, -4).id, rest[0].id); // left past e14: the list from the front
});
ok('my own uploads: left of e14, newest first going left; an upload that is a library picture only once', () => {
  const mine = [{ id: 'new1' }, { id: 'old1' }, { id: MENU_IDS[0] }];
  const w = wheelOrder(lib, [...mine, { id: RETIRED_MENU_IDS[0] }], { menus: MENU_IDS, exclude: RETIRED_MENU_IDS });
  assert.equal(w.length, lib.length - RETIRED_MENU_IDS.filter((id) => src(id)).length + 2);
  assert.deepEqual([-4, -5].map((k) => at(w, k).id), ['new1', 'old1']);
  assert.equal(w.filter((d) => d.id === MENU_IDS[0]).length, 1);
});
ok('without the start four (another library): the old order, mine first', () => {
  const w = wheelOrder([{ id: 'a' }, { id: 'b' }], [{ id: 'm' }]);
  assert.deepEqual(w.map((d) => d.id), ['m', 'a', 'b']);
});
ok('applySwaps: a name tag takes the chosen sticker’s place, once; a gone one is ignored', () => {
  const o = ['a', 'b', 'c', 't'].map((id) => ({ id }));
  assert.deepEqual(applySwaps(o, { b: 't' }).map((d) => d.id), ['a', 't', 'c']);
  assert.deepEqual(applySwaps(o, { b: 'gone' }).map((d) => d.id), ['a', 'b', 'c', 't']);
  assert.deepEqual(applySwaps(o, {}).map((d) => d.id), ['a', 'b', 'c', 't']);
});
console.log(`wheelorder: ${n} passed`);
