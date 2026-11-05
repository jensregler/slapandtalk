// Runway dance for the Slap and Talk Quaternius avatar (Jens t540u, 5 Nov 2026).
// Original keyframe choreography inspired by a CGI Optimus runway clip – no Tesla/Optimus branding.
// Pose numbers are bone turns in the avatar's own frame (same convention as SIT in avatars.js):
//   x = avatar's right, y = up, z = forward. drop = how far the model is lowered (metres).
// Pure maths – no Three.js – so unit tests can sample every phase without a GLB.

export const DANCE = Object.freeze({
  duration: 19,          // seconds, matches the reference clip
  key: 'KeyX',           // desktop: X
  beat: 0.5,             // ~120 BPM
});

const clamp01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };

// Neutral standing (slightly soft knees so pops read).
const STAND = Object.freeze({
  legL: 0, legR: 0, kneeL: 0.08, kneeR: 0.08,
  stanceL: 0, stanceR: 0,
  lean: 0, chest: 0, abdomen: 0,
  armLX: 0.15, armRX: 0.15, armLZ: 0.2, armRZ: -0.2,
  foreL: -0.2, foreR: -0.2,
  head: 0, drop: 0, back: 0,
});

function mix(a, b, t) {
  t = smooth(t);
  const out = {};
  for (const k of Object.keys(STAND)) out[k] = lerp(a[k] ?? STAND[k], b[k] ?? STAND[k], t);
  return out;
}

// Key poses (named for the choreography beats).
const STRUT = Object.freeze({ // confident walk-in-place: right arm across chest, left loose
  legL: -0.35, legR: 0.25, kneeL: 0.55, kneeR: 0.35,
  stanceL: 0.08, stanceR: -0.08,
  lean: 0.05, chest: 0.04, abdomen: 0.02,
  armLX: -0.15, armRX: -0.95, armLZ: 0.55, armRZ: 0.15,
  foreL: -0.25, foreR: -1.1,
  head: -0.05, drop: 0.02, back: 0,
});

const WIDE = Object.freeze({ // stop, right foot back, wide stance, hands fisted at chest
  legL: -0.15, legR: 0.35, kneeL: 0.35, kneeR: 0.55,
  stanceL: 0.35, stanceR: -0.45,
  lean: 0.08, chest: 0, abdomen: 0,
  armLX: -0.85, armRX: -0.95, armLZ: 0.55, armRZ: -0.55,
  foreL: -1.15, foreR: -1.2,
  head: 0.05, drop: 0.04, back: 0.02,
});

const KNEEL = Object.freeze({ // both knees/shins on the floor, torso upright, slight lean back, hands by thighs
  legL: -0.55, legR: -0.55, kneeL: 2.15, kneeR: 2.15,
  stanceL: 0.18, stanceR: -0.18,
  lean: -0.22, chest: -0.05, abdomen: -0.08,
  armLX: -0.35, armRX: -0.35, armLZ: 0.25, armRZ: -0.25,
  foreL: -0.55, foreR: -0.55,
  head: 0.1, drop: 0.62, back: -0.04,
});

const KNEEL_DIP = Object.freeze({ // anticipation before the no-hands pop-up
  ...KNEEL, drop: 0.68, lean: -0.18, kneeL: 2.25, kneeR: 2.25, chest: 0.06,
});

const STAND_WIDE = Object.freeze({ // catch the landing after the pop-up
  legL: -0.2, legR: -0.2, kneeL: 0.55, kneeR: 0.55,
  stanceL: 0.42, stanceR: -0.42,
  lean: 0.1, chest: 0.05, abdomen: 0.02,
  armLX: -0.2, armRX: -0.2, armLZ: 0.7, armRZ: -0.7,
  foreL: -0.3, foreR: -0.3,
  head: 0, drop: 0.06, back: 0,
});

const FLAIR = Object.freeze({ // arms thrown out, taller stance
  legL: -0.05, legR: -0.05, kneeL: 0.15, kneeR: 0.15,
  stanceL: 0.18, stanceR: -0.18,
  lean: 0.02, chest: 0.08, abdomen: 0.04,
  armLX: -0.15, armRX: -0.15, armLZ: 1.35, armRZ: -1.35,
  foreL: -0.15, foreR: -0.15,
  head: -0.05, drop: 0.01, back: 0,
});

const SHIMMY = Object.freeze({ // arms pulled in a bit, ready to shimmy
  ...FLAIR, armLZ: 0.85, armRZ: -0.85, chest: 0.12, abdomen: 0.1, armLX: -0.35, armRX: -0.35,
});

const SQUAT = Object.freeze({ // deep wide sumo squat, arms down/out, palms toward floor
  legL: -1.35, legR: -1.35, kneeL: 2.05, kneeR: 2.05,
  stanceL: 0.55, stanceR: -0.55,
  lean: 0.18, chest: 0.05, abdomen: 0.08,
  armLX: 0.55, armRX: 0.55, armLZ: 0.55, armRZ: -0.55,
  foreL: -0.15, foreR: -0.15,
  head: 0.15, drop: 0.38, back: 0.02,
});

/** Phase name at time t (seconds). Useful for tests and debugging. */
export function dancePhase(t) {
  if (t < 0) return 'idle';
  if (t < 3) return 'approach';
  if (t < 5) return 'pops';
  if (t < 9) return 'kneel';
  if (t < 11) return 'kneel-pause';
  if (t < 13) return 'popup';
  if (t < 15) return 'flair';
  if (t < 18) return 'squat';
  if (t < DANCE.duration) return 'rise';
  return 'done';
}

/**
 * Sample the dance pose at time t (seconds from the start).
 * Returns a plain pose object (see STAND). After DANCE.duration the last rise pose is held;
 * callers should stop the dance at duration.
 */
export function dancePoseAt(t) {
  if (!(t > 0)) return { ...STAND };
  if (t >= DANCE.duration) return { ...STAND };

  // 0–3: approach strut (walk-in-place, alternating legs + shoulder bop)
  if (t < 3) {
    const u = t / 3;
    const step = Math.sin(t * Math.PI * 2); // ~1 Hz stride
    const bop = Math.sin(t * Math.PI * 4) * 0.08; // shoulder bop on the beat
    const base = mix(STAND, STRUT, Math.min(1, u * 2));
    return {
      ...base,
      legL: base.legL + step * 0.45,
      legR: base.legR - step * 0.45,
      kneeL: base.kneeL + Math.max(0, step) * 0.35,
      kneeR: base.kneeR + Math.max(0, -step) * 0.35,
      chest: base.chest + bop,
      abdomen: base.abdomen + bop * 0.6,
      armRX: base.armRX + Math.sin(t * Math.PI * 2 + 0.4) * 0.08,
      drop: base.drop + Math.abs(step) * 0.015,
    };
  }

  // 3–5: wide stance + chest/shoulder pops on the beat
  if (t < 5) {
    const u = (t - 3) / 2;
    const base = mix(STRUT, WIDE, Math.min(1, u * 2.5));
    const beat = Math.floor((t - 3) / DANCE.beat);
    const local = ((t - 3) % DANCE.beat) / DANCE.beat;
    // sharp isolation: quick out, quick back
    const pop = local < 0.18 ? smooth(local / 0.18) : local < 0.45 ? 1 - smooth((local - 0.18) / 0.27) : 0;
    const side = beat % 2 === 0 ? 1 : -1;
    return {
      ...base,
      chest: base.chest + pop * 0.22,
      abdomen: base.abdomen + pop * 0.14,
      armLZ: base.armLZ + pop * 0.12 * side,
      armRZ: base.armRZ - pop * 0.12 * side,
      lean: base.lean + pop * 0.04,
    };
  }

  // 5–9: lower onto both knees (no hands on the floor)
  if (t < 9) {
    const u = (t - 5) / 4;
    // ease into the kneel: a little faster in the middle so it reads as a drop, not a float
    const e = u < 0.55 ? smooth(u / 0.55) * 0.85 : 0.85 + smooth((u - 0.55) / 0.45) * 0.15;
    return mix(WIDE, KNEEL, e);
  }

  // 9–11: kneeling pause, looking forward (tiny breath)
  if (t < 11) {
    const breath = Math.sin((t - 9) * Math.PI) * 0.02;
    return { ...KNEEL, chest: KNEEL.chest + breath, lean: KNEEL.lean + breath * 0.5, drop: KNEEL.drop + breath * 0.4 };
  }

  // 11–13: no-hands pop-up – dip, then explosive spring to a wide standing stance
  if (t < 13) {
    const u = (t - 11) / 2;
    if (u < 0.18) return mix(KNEEL, KNEEL_DIP, u / 0.18); // anticipation
    // explosive rise: most of the height recovered in the next ~0.45 of the window
    const rise = (u - 0.18) / 0.45;
    if (rise < 1) {
      const p = mix(KNEEL_DIP, STAND_WIDE, smooth(rise));
      // feet slide out as weight catches (stance widens through the rise)
      const slide = smooth(rise);
      return {
        ...p,
        stanceL: lerp(KNEEL_DIP.stanceL, STAND_WIDE.stanceL, slide),
        stanceR: lerp(KNEEL_DIP.stanceR, STAND_WIDE.stanceR, slide),
        // a touch of stretch past standing mid-air so the catch has weight
        drop: Math.max(0, p.drop - (rise > 0.55 && rise < 0.85 ? 0.02 : 0)),
      };
    }
    return mix(STAND_WIDE, STAND_WIDE, 1); // settle
  }

  // 13–15: arm flair out → pull in + shoulder shimmy/roll
  if (t < 15) {
    const u = (t - 13) / 2;
    if (u < 0.35) return mix(STAND_WIDE, FLAIR, u / 0.35);
    if (u < 0.55) return mix(FLAIR, SHIMMY, (u - 0.35) / 0.2);
    // shimmy: rapid shoulder/chest roll
    const sh = Math.sin((t - 13.9) * Math.PI * 10);
    const base = SHIMMY;
    return {
      ...base,
      chest: base.chest + sh * 0.14,
      abdomen: base.abdomen + sh * 0.1,
      armLZ: base.armLZ + sh * 0.18,
      armRZ: base.armRZ + sh * 0.18,
      lean: base.lean + sh * 0.03,
    };
  }

  // 15–18: deep sumo squat with hip bounces on the beat
  if (t < 18) {
    const u = (t - 15) / 3;
    const base = u < 0.35 ? mix(SHIMMY, SQUAT, u / 0.35) : { ...SQUAT };
    const local = ((t - 15) % DANCE.beat) / DANCE.beat;
    const bounce = local < 0.5 ? smooth(local / 0.5) : 1 - smooth((local - 0.5) / 0.5);
    return {
      ...base,
      drop: base.drop + bounce * 0.06,
      kneeL: base.kneeL + bounce * 0.08,
      kneeR: base.kneeR + bounce * 0.08,
      lean: base.lean + bounce * 0.04,
      armLX: base.armLX + bounce * 0.05,
      armRX: base.armRX + bounce * 0.05,
    };
  }

  // 18–19: rise from the squat and start to step back
  {
    const u = (t - 18) / 1;
    const base = mix(SQUAT, STAND, smooth(u));
    const step = Math.sin(u * Math.PI) * 0.2;
    return {
      ...base,
      legL: base.legL + step * 0.25,
      legR: base.legR - step * 0.15,
      back: -u * 0.08,
      armLX: base.armLX - u * 0.1,
      armRX: base.armRX - u * 0.1,
    };
  }
}

/** Soft clone of a pose (tests / debugging). */
export function clonePose(p) { return { ...p }; }
