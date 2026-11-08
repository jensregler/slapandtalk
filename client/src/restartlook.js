// New random character on first page in a tab, or when New Game asks for one (Jens t514u / room-outfit
// fix 8 Nov 2026). A reload and room↔city navigations KEEP the look that was saved (or just worn),
// so clothes picked in Min gubbe survive Ctrl+F5 and house doors. sessionStorage marks the tab so a
// second page in the same tab does not re-roll. Automated browsers (navigator.webdriver) keep the
// saved look unless localStorage klibb.testRoll=1, so e2e suites that seed a fixed look still work.
import AV from '../../shared/avatar.json' with { type: 'json' };

const LOOK_KEY = 'klibb.avatar', SESSION_KEY = 'klibb.lookSession';
const KEYS = ['outfit', 'hair', 'shirt', 'pants', 'hairColor', 'skin', 'hat', 'hatColor'];
const any = (list, rnd) => list[Math.floor(rnd() * list.length)];
export function rollLook(rnd = Math.random) {
  return { outfit: any(Object.keys(AV.outfits), rnd), hair: any(Object.keys(AV.hair), rnd), shirt: any(AV.colors.shirt, rnd), pants: any(AV.colors.pants, rnd),
    hairColor: any(AV.colors.hair, rnd), skin: any(AV.colors.skin, rnd), hat: rnd() < 0.3, hatColor: any(AV.colors.hat, rnd) };
}
export const sameLook = (a, b) => !!a && !!b && KEYS.every((k) => a[k] === b[k]);
// A fresh look unlike prev (outfit, hair or shirt differ, so it visibly changes); keeps insta + fabric.
export function freshLook(prev, rnd = Math.random) {
  let l = rollLook(rnd);
  for (let i = 0; i < 20 && prev && (sameLook(l, prev) || (l.outfit === prev.outfit && l.hair === prev.hair && l.shirt === prev.shirt)); i++) l = rollLook(rnd);
  if (prev?.insta) l.insta = prev.insta;
  if (prev?.fabric) l.fabric = prev.fabric;
  return keepFace(prev, l);
}
export function isRestart(win = globalThis) {
  try {
    // Only the first page in this tab. Reload used to re-roll too (t514u); that wiped clothes picked
    // in Min gubbe when Jens hit Ctrl+F5, so reload now keeps the saved look (room-outfit, 8 Nov 2026).
    return !win.sessionStorage.getItem(SESSION_KEY);
  } catch { return false; }
}
function writeFresh(ls, rnd) {
  let saved = {}; try { saved = JSON.parse(ls.getItem(LOOK_KEY) || '{}') || {}; } catch { saved = {}; }
  ls.setItem(LOOK_KEY, JSON.stringify({ ...saved, name: saved.name || '', look: freshLook(saved.look, rnd) }));
}
let done = false;
// Call before anything reads klibb.avatar. Runs once per page. Rolls only on first page in the tab.
export function rollLookOnRestart(win = globalThis, rnd = Math.random) {
  if (done) return false; done = true;
  try {
    const ls = win.localStorage, ss = win.sessionStorage;
    const restart = isRestart(win);
    ss.setItem(SESSION_KEY, '1');
    if (!restart) return false;
    if (win.navigator?.webdriver && ls.getItem('klibb.testRoll') !== '1') return false;
    writeFresh(ls, rnd);
    return true;
  } catch { return false; }
}
// New Game on the start card: always a new character, even when this tab already had a session
// (Exit → menu → NEW GAME). startcard.js calls this from the details screen.
export function forceFreshLook(win = globalThis, rnd = Math.random) {
  try {
    const ls = win.localStorage, ss = win.sessionStorage;
    ss.setItem(SESSION_KEY, '1');
    if (win.navigator?.webdriver && ls.getItem('klibb.testRoll') !== '1') return false;
    writeFresh(ls, rnd);
    done = true;
    return true;
  } catch { return false; }
}
export const _resetForTest = () => { done = false; };
// The face is the same on every character and is never random (Jens, 8 Nov 2026): 🎲 Random, 🌀 Randomize
// and New Game re-roll clothes and colours only. Carry the face colour, the face fabric/photo and the
// Instagram name (which owns a locked face) over from prev onto the new look.
export function keepFace(prev, look) {
  const out = { ...look };
  if (prev?.face) out.face = prev.face; else delete out.face;
  if (prev?.insta) out.insta = prev.insta;
  const f = prev?.fabric?.face;
  const fabric = { ...(out.fabric || {}) };
  if (f) fabric.face = f; else delete fabric.face;
  if (Object.keys(fabric).length) out.fabric = fabric; else delete out.fabric;
  return out;
}
