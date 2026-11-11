// Undo / peel history (pilhistoriken) capped at 100 entries per room (Jens, 11 Nov 2026; was 10).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PEEL_KEEP } = require('../server/store.js');
assert.equal(PEEL_KEEP, 100, 'server peel-key keep is 100');

// Fake localStorage BEFORE loading the client history module.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const { PER_ROOM, addHistory, removeHistory, roomHistory, readHistory } = await import('../client/src/history.js');
assert.equal(PER_ROOM, 100, 'client undo history cap is 100');
assert.equal(PER_ROOM, PEEL_KEEP, 'client and server undo caps match');

const room = 'abc123';
const t = (i) => new Date(1_700_000_000_000 + i * 1000).toISOString();
for (let i = 0; i < 125; i++) addHistory({ room, stampId: `s${i}`, token: `t${i}`, designId: 'd', url: '/x', time: t(i) });
const hist = roomHistory(room);
assert.equal(hist.length, 100, 'roomHistory returns at most 100');
assert.equal(hist[0].stampId, 's124', 'newest first');
assert.equal(hist[99].stampId, 's25', 'the 100th is the 100th newest');
assert.equal(readHistory().filter((h) => h.room === room).length, 100, 'stored list trimmed to 100 per room');

// A second room keeps its own 100 (the per-room cap, not a global one).
for (let i = 0; i < 30; i++) addHistory({ room: 'other1', stampId: `o${i}`, token: `u${i}`, designId: 'd', url: '/x', time: t(200 + i) });
assert.equal(roomHistory(room).length, 100, 'another room does not eat this room\'s history');
assert.equal(roomHistory('other1').length, 30, 'the other room has its own entries');

// Removing (peel / ✕) walks back through the whole 100: peel the newest one by one.
for (let k = 0; k < 100; k++) {
  const newest = roomHistory(room)[0];
  assert.equal(newest.stampId, `s${124 - k}`, `step ${k + 1}: the newest left is peeled next`);
  removeHistory([newest.stampId]);
}
assert.equal(roomHistory(room).length, 0, 'all 100 steps can be removed');

console.log('history: all ok');
