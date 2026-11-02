// Unit: the sticker wheel's start order (Jens, 2 Nov 2026) – d71 in the middle, d72-d74 to the left,
// the menu stickers to the right and after them the list from the back (shared/wheelorder.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { wheelOrder, WHEEL_START } from '../shared/wheelorder.mjs';
import { MENU_IDS, MENU_STICKERS, MENU_ORDER } from '../client/src/menustickers.js';
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const man = JSON.parse(fs.readFileSync(new URL('../library/manifest.json', import.meta.url))).stickers;
const src = (id) => (man.find((m) => m.id === id) || {}).source;
const lib = man.filter((m) => !m.nature).map((m) => ({ id: m.id }));
const at = (list, k) => list[((k % list.length) + list.length) % list.length];

ok('d71-d74 and every menu sticker are in the library (by picture id)', () => {
  assert.deepEqual(WHEEL_START.map(src), ['d71.png', 'd72.png', 'd73.png', 'd74.png']);
  assert.deepEqual(MENU_IDS.map(src), ['character.png', 'redio.png', 'room.png', 'city.png', 'exit.png', 'camera.png', 'editor.png', 'menue.png', 'stickerpac.png']);
  assert.equal(MENU_IDS.length, MENU_ORDER.length); assert.ok(MENU_IDS.every((id) => MENU_STICKERS[id]));
});
ok('the real library: middle d71, left d72 d73 d74, right the menus then the list from the back; each once', () => {
  const w = wheelOrder(lib, [], { menus: MENU_IDS });
  assert.equal(w.length, lib.length); assert.equal(new Set(w.map((d) => d.id)).size, lib.length);
  assert.equal(src(w[0].id), 'd71.png');
  assert.deepEqual([-1, -2, -3].map((k) => src(at(w, k).id)), ['d72.png', 'd73.png', 'd74.png']);
  assert.deepEqual(MENU_IDS.map((_, i) => at(w, 1 + i).id), MENU_IDS);
  const rest = lib.filter((d) => !WHEEL_START.includes(d.id) && !MENU_IDS.includes(d.id));
  assert.equal(at(w, 1 + MENU_IDS.length).id, rest.at(-1).id); assert.equal(at(w, 2 + MENU_IDS.length).id, rest.at(-2).id);
  assert.equal(at(w, -4).id, rest[0].id); // left past d74: the list from the front
});
ok('my own uploads: left of d74, newest first going left; an upload that is a library picture only once', () => {
  const mine = [{ id: 'new1' }, { id: 'old1' }, { id: MENU_IDS[0] }];
  const w = wheelOrder(lib, mine, { menus: MENU_IDS });
  assert.equal(w.length, lib.length + 2);
  assert.deepEqual([-4, -5].map((k) => at(w, k).id), ['new1', 'old1']);
  assert.equal(w.filter((d) => d.id === MENU_IDS[0]).length, 1);
});
ok('without d71 (another library): the old order, mine first', () => {
  const w = wheelOrder([{ id: 'a' }, { id: 'b' }], [{ id: 'm' }]);
  assert.deepEqual(w.map((d) => d.id), ['m', 'a', 'b']);
});
console.log(`wheelorder: ${n} passed`);
