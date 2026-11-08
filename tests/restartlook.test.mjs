// Unit: a new random character on first tab page / New Game (Jens t514u); kept across reload and room navigations (room-outfit 8 Nov 2026).
import assert from 'node:assert/strict';
import { keepFace, rollLook, rollLookOnRestart, forceFreshLook, freshLook, sameLook, _resetForTest } from '../client/src/restartlook.js';
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const win = (type, ls, ss) => ({ localStorage: ls, sessionStorage: ss, navigator: {}, performance: { getEntriesByType: () => [{ type }] } });
const OWN = { outfit: 'tshirt', hair: 'kort', shirt: '#3a86ff', pants: '#2b4c7e', hairColor: '#4a2c17', skin: '#e0ac69', hat: false, hatColor: '#e63946', insta: 'jens', fabric: { shirt: { id: 'x' } } };
const ls = store(); ls.setItem('klibb.avatar', JSON.stringify({ name: 'Jens', look: OWN }));
let ss = store();
_resetForTest(); assert.equal(rollLookOnRestart(win('navigate', ls, ss)), true, 'first page in a tab rolls');
const a = JSON.parse(ls.getItem('klibb.avatar'));
assert.equal(a.name, 'Jens'); assert.equal(a.look.insta, 'jens'); assert.deepEqual(a.look.fabric, OWN.fabric);
assert.ok(!sameLook(a.look, OWN), 'differs from last');
_resetForTest(); assert.equal(rollLookOnRestart(win('navigate', ls, ss)), false, 'room navigation keeps');
assert.deepEqual(JSON.parse(ls.getItem('klibb.avatar')), a);
_resetForTest(); assert.equal(rollLookOnRestart(win('reload', ls, ss)), false, 'reload keeps the chosen look');
assert.deepEqual(JSON.parse(ls.getItem('klibb.avatar')), a, 'reload did not re-roll');
_resetForTest(); assert.equal(forceFreshLook(win('navigate', ls, ss)), true, 'New Game force-rolls even mid-session');
const b = JSON.parse(ls.getItem('klibb.avatar'));
assert.ok(!sameLook(b.look, a.look), 'forceFreshLook differs');
assert.equal(b.look.insta, 'jens');
ss = store(); const w = win('navigate', ls, ss); w.navigator.webdriver = true;
_resetForTest(); assert.equal(rollLookOnRestart(w), false, 'automation keeps by default');
_resetForTest(); assert.equal(forceFreshLook(w), false, 'automation skips forceFreshLook too');
_resetForTest(); assert.equal(rollLookOnRestart(win('navigate', store(), store())), true, 'no saved avatar still fine');
for (let i = 0; i < 200; i++) assert.ok(!sameLook(freshLook(OWN), OWN));
// The face is never random (Jens, 8 Nov 2026): keepFace carries face colour, face fabric/photo and insta.
{
  const PHOTO = { id: 'abc', scale: 1, rot: 0, hue: 0, hueHz: 0.25, spinHz: 0.1, scroll: 0, cycleHue: false, spin: false, photo: true };
  let prev = { ...OWN, face: '#ff8800', insta: 'jens', fabric: { face: PHOTO, shirt: { id: 'x' } } };
  for (let i = 0; i < 50; i++) {
    const l = keepFace(prev, { ...rollLook(), fabric: { shirt: { id: 'y' + i } } });
    assert.equal(l.face, '#ff8800'); assert.deepEqual(l.fabric.face, PHOTO); assert.equal(l.insta, 'jens');
    prev = l;
  }
  const n = keepFace({}, { ...rollLook(), face: '#000000', fabric: { face: PHOTO } });
  assert.ok(!n.face && !n.fabric, 'random never invents a face');
  const f = freshLook({ ...OWN, face: '#123456' }); assert.equal(f.face, '#123456', 'New Game keeps the face colour');
}
console.log('restartlook: ok');
