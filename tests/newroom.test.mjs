// Unit: clearMineForNewRoom (client/src/designs.js) – a new quick room clears my uploads, starred ones stay.
import assert from 'node:assert/strict';
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { readMine, readFavs, clearMineForNewRoom, addMine, setFav } = await import('../client/src/designs.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('✔ ' + name); };
t('unstarred uploads go, starred stay', () => {
  for (const id of ['a', 'b', 'c']) addMine({ id, url: `/u/${id}.webp` });
  setFav('b', true); setFav('lib-x', true); // a stray star on a library sticker
  const r = clearMineForNewRoom();
  assert.deepEqual(readMine().map((m) => m.id), ['b']);
  assert.deepEqual(r.gone.sort(), ['a', 'c']);
  assert.deepEqual([...readFavs()], ['b']); // the stray library star is dropped
});
t('nothing uploaded: nothing happens', () => { mem.clear(); const r = clearMineForNewRoom(); assert.deepEqual(r.gone, []); assert.deepEqual(readMine(), []); });
console.log(`newroom: ${n} passed`);
