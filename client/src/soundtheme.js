// My sound theme (shared/soundtheme.mjs): Theme A (default, the sound as it always was) or Theme B (tight pitch
// and timing). Per player, remembered in this browser (localStorage 'klibb.soundTheme'); Esc → THEME picks it.
// Only how I hear / play things changes – no saved patch or run-mode value is rewritten, so A is exactly as before.
import { THEME, THEMES, cleanThemeId } from '../../shared/soundtheme.mjs';

let current = (() => { try { return cleanThemeId(localStorage.getItem(THEME.key)); } catch { return THEME.def; } })();
const subs = new Set();
export const soundTheme = () => THEMES[current];
export const soundThemeId = () => current;
export function setSoundTheme(id) {
  const next = cleanThemeId(id); if (next === current) return THEMES[current];
  current = next;
  try { if (next === THEME.def) localStorage.removeItem(THEME.key); else localStorage.setItem(THEME.key, next); } catch { /* private mode */ }
  for (const f of subs) { try { f(THEMES[current]); } catch (e) { console.warn('sound theme', e); } }
  return THEMES[current];
}
export function onSoundTheme(f) { subs.add(f); return () => subs.delete(f); }
