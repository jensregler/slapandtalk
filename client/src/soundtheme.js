// The room's sound theme (shared/soundtheme.mjs): Theme A (default, the sound as it always was), Theme B (tight pitch
// and timing) … Jens, 15 Nov 2026 ("alla har samma tema"): ONE theme per room / city, the same for everybody in it.
// The server keeps it on the room (PUT /api/rooms/:room/soundtheme, info.soundTheme, event room:soundtheme); this
// module only holds what the server said and tells the engine (main.js applySoundTheme). Esc → THEME asks the server.
// Only how things are PLAYED changes – no saved patch or run-mode value is rewritten, so A is exactly as before.
import { THEME, THEMES, cleanThemeId } from '../../shared/soundtheme.mjs';

// (the first version kept a personal choice in localStorage – it no longer counts; the room decides)
try { localStorage.removeItem(THEME.key); } catch { /* private mode */ }
let current = THEME.def;
const subs = new Set();
export const soundTheme = () => THEMES[current];
export const soundThemeId = () => current;
// The room's theme as the server says it (the room load, a room:soundtheme event, a resync). meta = { by } (who picked it).
export function setSoundTheme(id, meta = {}) {
  const next = cleanThemeId(id); if (next === current) return THEMES[current];
  current = next;
  for (const f of subs) { try { f(THEMES[current], meta); } catch (e) { console.warn('sound theme', e); } }
  return THEMES[current];
}
export function onSoundTheme(f) { subs.add(f); return () => subs.delete(f); }
