// The held sticker on touch screens (phones): no Slap mode / Look mode switch, a timer instead.
//
//   idle     – nothing in the hand yet (start-up): hidden; a tap on the screen wakes it (no slap).
//   holding  – a sticker was just chosen (sticker book, swipe on the stack, a new upload): sharp,
//              hovering in its holder for as long as it takes, until it is placed the first time.
//   timed    – after a stamp (or a wake-up tap): sharp for HELD_VISIBLE_MS, then it fades out over
//              HELD_FADE_MS. Faded = look mode: no held sticker, a tap on a wall does not slap, it
//              only brings the sticker back (a fresh HELD_VISIBLE_MS). Each stamp restarts the clock.
//
// A tap slaps only while the sticker is fully sharp (canSlap). A tap while it is fading or faded
// only wakes it – so a wake-up tap never slaps by accident. Pure: every call takes the time (ms).
export const HELD_VISIBLE_MS = 10000; // visible this long after a stamp / a wake-up tap
export const HELD_FADE_MS = 1000;     // then fades out over this long

export function createHeldTimer({ visibleMs = HELD_VISIBLE_MS, fadeMs = HELD_FADE_MS } = {}) {
  let state = 'idle', since = 0;
  const age = (t) => t - since;
  const opacity = (t) => {
    if (state === 'holding') return 1;
    if (state !== 'timed') return 0;
    const a = age(t);
    if (a < visibleMs) return 1;
    return a < visibleMs + fadeMs ? 1 - (a - visibleMs) / fadeMs : 0;
  };
  const canSlap = (t) => state === 'holding' || (state === 'timed' && age(t) < visibleMs);
  return {
    visibleMs, fadeMs,
    get state() { return state; },
    opacity, canSlap,
    faded: (t) => opacity(t) === 0,
    // a sticker was chosen: sharp until the next placement
    choose(t) { state = 'holding'; since = t; },
    // a sticker was placed: the clock starts (or restarts)
    placed(t) { state = 'timed'; since = t; },
    // a tap while fading / faded (or before anything was held): back, with a fresh visible time
    wake(t) { state = 'timed'; since = t; },
    // the user is working with it (size / rotation sliders, the stack): keep it up while it is up
    keepAlive(t) { if (state === 'timed' && canSlap(t)) since = t; },
    // What a tap on the 3D view does now: 'slap' (sharp) or 'wake' (fading, faded, idle).
    tap(t) { if (canSlap(t)) return 'slap'; this.wake(t); return 'wake'; },
    info(t) { return { state, opacity: +opacity(t).toFixed(3), canSlap: canSlap(t), age: state === 'idle' ? null : Math.round(age(t)) }; },
  };
}
