// Runway dance for the Slap and Talk Quaternius avatar (Jens t540u, 5 Nov 2026).
// Original keyframe choreography inspired by a CGI Optimus runway clip – no Tesla/Optimus branding.
// Pose numbers are bone turns in the avatar's own frame (same convention as SIT in avatars.js):
//   x = avatar's right, y = up, z = forward. drop = how far the model is lowered (metres).
// Pure maths – no Three.js – so unit tests can sample every phase without a GLB.

export const DANCE = Object.freeze({
  bars: 4, beatsPerBar: 4, // the whole routine = 4 bars of 4/4 on the master clock (16 beats)
  beats: 16,
  key: 'KeyX',             // desktop: X
  bpm: 90,                 // fallback tempo when no clock is given (the master clock's default)
  minBpm: 60, maxBpm: 180, // outside this band the clock is used in double / half time
  maxMs: 19000,            // the longest it can take (lead-in ≤ 1 beat + 16 beats at 60 BPM ≈ 17 s)
});
// (Before Jens t546u: a fixed 19 s timeline at 120 BPM.) Sections, in beats from the first beat:
//   strut 0–2 · chest pops 2–4 · knee drop 4–6 · kneel hold 6–7 · no-hands pop-up 7–9 ·
//   arm flair + shimmy 9–11 · squat bounce 11–15 · rise 15–16.  At 90 BPM: 10.7 s.
export const SECTIONS = Object.freeze([
  ['approach', 0, 2], ['pops', 2, 4], ['kneel', 4, 6], ['kneel-pause', 6, 7], ['popup', 7, 9],
  ['flair', 9, 11], ['squat', 11, 15], ['rise', 15, 16],
]);
// The keyframes below were authored on the old 19 s timeline; each section's beats map linearly
// onto its old seconds (pose shapes only). Everything rhythmic – stride, bop, pops, shimmy, hip
// bounces – is driven by the beat count itself, so it lands ON the clock's beats.
const OLD = [0, 3, 5, 9, 11, 13, 15, 18, 19];
function oldTime(b) {
  for (let i = 0; i < SECTIONS.length; i++) {
    const [, a, z] = SECTIONS[i];
    if (b < z || i === SECTIONS.length - 1) return OLD[i] + (OLD[i + 1] - OLD[i]) * Math.min(1, Math.max(0, (b - a) / (z - a)));
  }
  return OLD[OLD.length - 1];
}

// Tempo (Jens t544u/t546u): the dance follows the master clock (shared/clock.mjs: 90 BPM + the
// room's nudge and phase, on the server-corrected wall clock). It starts on the clock's NEXT beat
// (lead = up to one beat of standing), so every beat of the routine is a clock beat. Above 180 /
// below 60 BPM it runs in half / double time (folded by octaves) so it stays human.
// grid = { bpm, beat (s), lead (s from the press to the first beat), duration (s, lead incl.) }.
export function danceGrid(nowMs, tempo) {
  let bpm = tempo && tempo.bpm > 0 && Number.isFinite(tempo.bpm) ? tempo.bpm : 0;
  if (!bpm || !Number.isFinite(nowMs)) { const beat = 60 / DANCE.bpm; return { bpm: DANCE.bpm, beat, lead: 0, duration: DANCE.beats * beat }; }
  let guard = 0;
  while (bpm > DANCE.maxBpm && guard++ < 40) bpm /= 2;
  while (bpm < DANCE.minBpm && guard++ < 80) bpm *= 2;
  const beatMs = 60000 / bpm, into = ((nowMs - (tempo.phaseMs || 0)) % beatMs + beatMs) % beatMs;
  const leadMs = into < 1e-6 || beatMs - into < 1e-6 ? 0 : beatMs - into;
  return { bpm: +bpm.toFixed(4), beat: beatMs / 1000, lead: leadMs / 1000, duration: (leadMs + DANCE.beats * beatMs) / 1000 };
}
const cleanGrid = (g) => (g && g.beat > 0 && Number.isFinite(g.beat) ? { beat: g.beat, lead: Number.isFinite(g.lead) && g.lead > 0 ? g.lead : 0 } : { beat: 60 / DANCE.bpm, lead: 0 });
/** Total length (s) for a grid (null = the 90 BPM fallback). */
export const danceDuration = (grid = null) => { const g = cleanGrid(grid); return g.lead + DANCE.beats * g.beat; };
/** Beats since the dance's first (clock) beat at dance time t (s); negative during the lead-in. */
export const danceBeats = (t, grid = null) => { const g = cleanGrid(grid); return (t - g.lead) / g.beat; };
/**
 * Looping dance (Jens t814u, 11 Nov 2026: X starts it, it loops until X again). tRaw = seconds since
 * the press (on the clock); returns the time inside the routine. The first pass is as before (lead-in
 * + 16 beats); after that it wraps every 16 clock beats from the first beat, so each new pass starts
 * exactly on a clock beat (a whole 4 bars later) – it never drifts off the BPM grid. The routine ends
 * and starts standing, so the seam is seamless.
 */
export function danceLoopTime(tRaw, grid = null) {
  const g = cleanGrid(grid), len = DANCE.beats * g.beat;
  if (!(tRaw > 0)) return 0;
  if (tRaw < g.lead + len) return tRaw;
  return g.lead + (((tRaw - g.lead) % len) + len) % len;
}
/** How many whole passes have finished at tRaw (0 during the first pass). */
export const danceLoops = (tRaw, grid = null) => { const g = cleanGrid(grid); return tRaw > g.lead ? Math.floor((tRaw - g.lead) / (DANCE.beats * g.beat)) : 0; };

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

/** Phase name at dance time t (seconds; grid as danceGrid, null = 90 BPM). */
export function dancePhase(t, grid = null) {
  if (t < 0) return 'idle';
  const b = danceBeats(t, grid);
  if (b < 0) return 'lead-in';
  for (const [name, , z] of SECTIONS) if (b < z) return name;
  return 'done';
}

/**
 * Sample the dance pose at dance time tSec (seconds since the press; grid from danceGrid, null =
 * 90 BPM, no lead-in). Standing during the lead-in and after the last beat; callers stop the
 * dance at danceDuration(grid).
 */
export function dancePoseAt(tSec, grid = null) {
  if (!(tSec > 0)) return { ...STAND };
  const B = danceBeats(tSec, grid); // beats on the clock (0 = the dance's first beat)
  if (B <= 0 || B >= DANCE.beats) return { ...STAND };
  const t = oldTime(B); // where the keyframes sit on their authored (old 19 s) timeline

  // 0–3: approach strut (walk-in-place, alternating legs + shoulder bop)
  if (t < 3) {
    const u = t / 3;
    const step = Math.sin(B * Math.PI); // one stride = 2 beats
    const bop = Math.sin(B * Math.PI * 2) * 0.08; // shoulder bop on the beat
    const base = mix(STAND, STRUT, Math.min(1, u * 2));
    return {
      ...base,
      legL: base.legL + step * 0.45,
      legR: base.legR - step * 0.45,
      kneeL: base.kneeL + Math.max(0, step) * 0.35,
      kneeR: base.kneeR + Math.max(0, -step) * 0.35,
      chest: base.chest + bop,
      abdomen: base.abdomen + bop * 0.6,
      armRX: base.armRX + Math.sin(B * Math.PI + 0.4) * 0.08,
      drop: base.drop + Math.abs(step) * 0.015,
    };
  }

  // 3–5: wide stance + chest/shoulder pops on the beat
  if (t < 5) {
    const u = (t - 3) / 2;
    const base = mix(STRUT, WIDE, Math.min(1, u * 2.5));
    const beat = Math.floor(B);
    const local = B - beat; // 0 = on the clock's beat
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
    const sh = Math.sin(B * Math.PI * 4); // two shoulder rolls per beat
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
    const local = B - Math.floor(B);
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
    // the step back fades out over the last beat-and-a-bit so the pose lands exactly on STAND – the loop
    // (Jens t814u) goes straight back into the strut, so there must be no snap at the seam
    const sb = u * (1 - smooth((u - 0.6) / 0.4));
    return {
      ...base,
      legL: base.legL + step * 0.25,
      legR: base.legR - step * 0.15,
      back: -sb * 0.08,
      armLX: base.armLX - sb * 0.1,
      armRX: base.armRX - sb * 0.1,
    };
  }
}

/** Soft clone of a pose (tests / debugging). */
export function clonePose(p) { return { ...p }; }
