// Hold-to-repeat step buttons (client/src/holdrepeat.js; Jens 7 Nov 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindHoldRepeat } from '../client/src/holdrepeat.js';

function fakeEl() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn) { (listeners.get(type) || listeners.set(type, []).get(type)).push(fn); },
    removeEventListener(type, fn) { const a = listeners.get(type) || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
    setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture() { return false; },
    fire(type, e = {}) { for (const fn of listeners.get(type) || []) fn({ button: 0, pointerId: 1, preventDefault() {}, stopPropagation() {}, ...e }); },
  };
}

test('holdRepeat: first step on pointerdown, then repeats, stops on pointerup', async () => {
  const el = fakeEl();
  let n = 0;
  bindHoldRepeat(el, () => { n++; }, { delay: 40, every: 20 });
  el.fire('pointerdown');
  assert.equal(n, 1, 'immediate step');
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(n, 1, 'no repeat before delay');
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(n >= 3, `repeating after delay (got ${n})`);
  const atStop = n;
  el.fire('pointerup');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(n, atStop, 'stopped after pointerup');
});

test('holdRepeat: click after pointer is suppressed; keyboard click still steps', () => {
  const el = fakeEl();
  let n = 0;
  bindHoldRepeat(el, () => { n++; }, { delay: 1000, every: 1000 });
  el.fire('pointerdown');
  el.fire('pointerup');
  el.fire('click'); // synthetic after pointer
  assert.equal(n, 1, 'pointer path only once');
  el.fire('click'); // keyboard-style (suppress already consumed)
  assert.equal(n, 2, 'keyboard click steps once');
});
