// Undo / peel history (pilhistoriken) capped at 10 entries per room.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PEEL_KEEP } = require('../server/store.js');
assert.equal(PEEL_KEEP, 10, 'server peel-key keep is 10');

// Fake localStorage BEFORE loading the client history module.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const { PER_ROOM, addHistory, roomHistory, readHistory } = await import('../client/src/history.js');
assert.equal(PER_ROOM, 10, 'client undo history cap is 10');
assert.equal(PER_ROOM, PEEL_KEEP, 'client and server undo caps match');

const room = 'abc123';
for (let i = 0; i < 25; i++) {
  addHistory({ room, stampId: `s${i}`, token: `t${i}`, designId: 'd', url: '/x', time: new Date(1_700_000_000_000 + i * 1000).toISOString() });
}
const hist = roomHistory(room);
assert.equal(hist.length, 10, 'roomHistory returns at most 10');
assert.equal(hist[0].stampId, 's24', 'newest first');
assert.equal(hist[9].stampId, 's15', 'tenth is the 10th newest');
assert.ok(readHistory().filter((h) => h.room === room).length <= 10, 'stored list trimmed per room');

console.log('history: all ok');
