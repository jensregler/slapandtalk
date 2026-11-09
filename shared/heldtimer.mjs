// The held sticker / aim brush (desktop + touch). Jens, 9 Nov 2026: NO auto-fade.
// Visibility is only user-controlled (O key + on-screen Aim toggle → hide/show).
//
//   idle     – nothing in the hand yet: hidden; a tap wakes it (no slap).
//   holding  – a sticker was just chosen: sharp until placed the first time.
//   timed    – after a stamp (or a wake-up): stays sharp forever until the user
//              hides aim or chooses another sticker.
//   hidden   – aim forced off (O / Aim button): opacity 0; show() / choose / wake restore.
//
// A tap slaps only while sharp (canSlap). Pure: every call takes the time (ms).
export const HELD_VISIBLE_MS = Infinity; // no auto-hide timeout (was 2000)
export const HELD_FADE_MS = 0;            // no fade ramp (was 1000)

export function createHeldTimer({ visibleMs = HELD_VISIBLE_MS, fadeMs = HELD_FADE_MS } = {}) {
  let state = 'idle', since = 0, forcedOff = false;
  const age = (t) => t - since;
  const opacity = (t) => {
    if (forcedOff) return 0;
    if (state === 'holding' || state === 'timed') return 1;
    return 0;
  };
  const canSlap = (t) => !forcedOff && (state === 'holding' || state === 'timed');
  return {
    visibleMs, fadeMs,
    get state() { return forcedOff && (state === 'holding' || state === 'timed') ? 'hidden' : state; },
    opacity, canSlap,
    faded: (t) => opacity(t) === 0,
    // a sticker was chosen: sharp until the next placement
    choose(t) { forcedOff = false; state = 'holding'; since = t; },
    // a sticker was placed: stay sharp (no clock)
    placed(t) { forcedOff = false; state = 'timed'; since = t; },
    // a tap while hidden / idle: back sharp
    wake(t) { forcedOff = false; state = 'timed'; since = t; },
    // Aim off: hide without forgetting we were holding/timed
    hide() { forcedOff = true; },
    // Aim on again (without changing which sticker)
    show(t) { forcedOff = false; if (state === 'idle') { state = 'timed'; since = t; } },
    // kept for API compat; no-op now that timed never expires
    keepAlive(t) { if (!forcedOff && state === 'timed') since = t; },
    // What a tap on the 3D view does now: 'slap' (sharp) or 'wake' (hidden / idle).
    tap(t) { if (canSlap(t)) return 'slap'; this.wake(t); return 'wake'; },
    info(t) {
      return {
        state: this.state, opacity: +opacity(t).toFixed(3), canSlap: canSlap(t),
        age: state === 'idle' ? null : Math.round(age(t)), forcedOff,
      };
    },
  };
}
