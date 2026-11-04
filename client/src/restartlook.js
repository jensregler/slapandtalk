// New random character on every restart (Jens t514u, 4 Nov 2026). A "restart" is the first page in
// a tab (sessionStorage empty) or a reload. Going between rooms/houses (plain navigations) keeps the
// character, so a look picked in "Min gubbe" lasts the whole session. The name, Instagram name and
// fabrics are kept; only the body/colours are re-rolled, never the same as last time if avoidable.
// Automated browsers (navigator.webdriver) keep the saved look unless localStorage klibb.testRoll=1,
// so the existing e2e suites that seed a fixed look still work.
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
  return l;
}
export function isRestart(win = globalThis) {
  try {
    if (!win.sessionStorage.getItem(SESSION_KEY)) return true;
    const nav = win.performance?.getEntriesByType?.('navigation')?.[0];
    return nav?.type === 'reload';
  } catch { return false; }
}
let done = false;
// Call before anything reads klibb.avatar. Runs once per page.
export function rollLookOnRestart(win = globalThis, rnd = Math.random) {
  if (done) return false; done = true;
  try {
    const ls = win.localStorage, ss = win.sessionStorage;
    const restart = isRestart(win);
    ss.setItem(SESSION_KEY, '1');
    if (!restart) return false;
    if (win.navigator?.webdriver && ls.getItem('klibb.testRoll') !== '1') return false;
    let saved = {}; try { saved = JSON.parse(ls.getItem(LOOK_KEY) || '{}') || {}; } catch { saved = {}; }
    ls.setItem(LOOK_KEY, JSON.stringify({ ...saved, name: saved.name || '', look: freshLook(saved.look, rnd) }));
    return true;
  } catch { return false; }
}
export const _resetForTest = () => { done = false; };
