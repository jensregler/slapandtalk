// Held / aim timer (shared/heldtimer.mjs). Jens, 9 Nov 2026: no auto-fade — stays sharp until hide().
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeldTimer, HELD_VISIBLE_MS as V, HELD_FADE_MS as F } from '../shared/heldtimer.mjs';

test('exports: no finite auto-fade window', () => {
  assert.equal(V, Infinity);
  assert.equal(F, 0);
});

test('idle → wake: sharp and can slap', () => {
  const h = createHeldTimer();
  assert.equal(h.state, 'idle'); assert.equal(h.opacity(0), 0); assert.equal(h.canSlap(0), false);
  assert.equal(h.tap(100), 'wake'); assert.equal(h.state, 'timed'); assert.equal(h.opacity(100), 1);
  assert.equal(h.canSlap(100), true);
});

test('choose stays sharp forever (no timeout)', () => {
  const h = createHeldTimer(); h.choose(0);
  for (const t of [0, 2500, 5000, 60000, 3600000, 1e9]) {
    assert.equal(h.opacity(t), 1, `t=${t}`); assert.equal(h.canSlap(t), true);
  }
});

test('placed stays sharp forever (no auto-fade)', () => {
  const h = createHeldTimer(); h.choose(0); h.placed(1000);
  assert.equal(h.state, 'timed');
  for (const t of [1000, 3000, 10000, 60000, 1e8]) {
    assert.equal(h.opacity(t), 1, `t=${t}`); assert.equal(h.canSlap(t), true); assert.equal(h.faded(t), false);
  }
});

test('hide() forces opacity 0; show()/choose restores', () => {
  const h = createHeldTimer(); h.choose(0); h.placed(100);
  h.hide();
  assert.equal(h.opacity(200), 0); assert.equal(h.canSlap(200), false); assert.equal(h.faded(200), true);
  assert.equal(h.state, 'hidden');
  h.show(300);
  assert.equal(h.opacity(300), 1); assert.equal(h.canSlap(300), true); assert.equal(h.state, 'timed');
  h.hide();
  h.choose(400);
  assert.equal(h.state, 'holding'); assert.equal(h.opacity(400), 1);
});

test('tap while hidden wakes (no slap); next tap slaps', () => {
  const h = createHeldTimer(); h.choose(0); h.placed(0); h.hide();
  assert.equal(h.tap(50), 'wake'); assert.equal(h.canSlap(50), true); assert.equal(h.opacity(50), 1);
  assert.equal(h.tap(60), 'slap');
});

test('each placement keeps it sharp ("per tag" no longer starts a fade clock)', () => {
  const h = createHeldTimer(); h.choose(0); h.placed(0); h.placed(1500);
  assert.equal(h.opacity(1500 + 5000), 1); assert.equal(h.canSlap(1500 + 5000), true);
});

test('keepAlive is a no-op for opacity (compat)', () => {
  const h = createHeldTimer(); h.placed(0);
  h.keepAlive(99999);
  assert.equal(h.opacity(99999), 1);
});
