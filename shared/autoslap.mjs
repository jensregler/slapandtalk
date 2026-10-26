// Auto-slap: the held sticker slaps by itself at the crosshair, on a step sequence.
// Shared by the web app (client/src/autoslap.js runs it, client/src/autoslapui.js draws it) and the
// tests. The server only knows "auto" slaps by their flag and rate budget (server/app.js).
//
// The sequence: a loop of `len` steps (1…32, default 8). Each step is a plain object of per-step
// params defined ONCE in STEP_PARAMS below (on/off, vol 0–100 …). To add a per-step param, add one
// entry there: cleaning, defaults, storage, the editor's controls and the tests all follow from it.
// Nothing assumes 8 steps: 8 is only DEFAULT_LEN.
//
// Timing (mode):
//   'bar'  (default) the loop is `bars` Groove bars long (shared/groove.mjs, the footsteps' shared
//          bar): each step is bar × bars / len. Odd lengths play polyrhythms against the footsteps
//          (5 steps against the 4-, 3-, 5-, 6-, 7-step walkers), and it follows the room's Groove scale.
//   'free' each step lasts 1 / rate seconds (rate 1 per 4 s … AUTO.maxRate per s, log slider); the
//          length only sets how long the loop is.
// Either way slaps never come closer than AUTO.minGapMs (the server's budget): faster steps are skipped.

export const AUTO = {
  minLen: 1, maxLen: 32, defaultLen: 8,
  minRate: 0.25, maxRate: 8, defaultRate: 2,   // slaps per second (free mode)
  minGapMs: 125,                                // = maxRate: never faster than this, also on the beat
  bars: [0.25, 0.5, 1, 2, 4], defaultBars: 1,   // loop length in Groove bars (bar mode)
  maxBurst: 200,                                // one undo group (Z) is at most this many stickers
  minMove: 0.03,                                // m: the crosshair must have moved this far (or a quarter of the sticker) since the last one
  maxInFlight: 6,                               // unanswered auto slaps at once; beyond that, steps are skipped
  sliderSteps: 1000,
  serverPerMinute: 600,                         // the server's auto budget per IP (10/s, a little over maxRate)
};
export const MODES = ['bar', 'free'];

// ---------- The per-step schema (the one place to add a step variable) ----------
// type 'bool' | 'int' | 'num'. label/short: for the editor. Future x/y/z offsets go here too.
export const STEP_PARAMS = {
  on: { type: 'bool', def: true, label: 'On', short: '' },
  vol: { type: 'int', min: 0, max: 100, def: 100, label: 'Volume', short: 'vol' },
};
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export function cleanParam(spec, v) {
  if (spec.type === 'bool') return typeof v === 'boolean' ? v : spec.def;
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!isNum(n)) return spec.def;
  const c = Math.min(spec.max, Math.max(spec.min, n));
  return spec.type === 'int' ? Math.round(c) : c;
}
export const defaultStep = () => Object.fromEntries(Object.entries(STEP_PARAMS).map(([k, s]) => [k, s.def]));
export function cleanStep(s) {
  const src = s && typeof s === 'object' ? s : {};
  return Object.fromEntries(Object.entries(STEP_PARAMS).map(([k, spec]) => [k, cleanParam(spec, src[k])]));
}
export function clampLen(n) {
  const v = typeof n === 'string' ? Number(n) : n;
  if (!isNum(v)) return AUTO.defaultLen;
  return Math.min(AUTO.maxLen, Math.max(AUTO.minLen, Math.round(v)));
}
// { len, steps }: steps always holds maxLen entries, so shrinking hides steps (kept) and growing
// brings them back as they were; never-used steps are defaults.
export function cleanSeq(q) {
  const src = q && typeof q === 'object' ? q : {};
  const list = Array.isArray(src.steps) ? src.steps : [];
  return { len: clampLen(src.len ?? AUTO.defaultLen), steps: Array.from({ length: AUTO.maxLen }, (_, i) => (list[i] ? cleanStep(list[i]) : defaultStep())) };
}
export const setLen = (q, len) => ({ ...cleanSeq(q), len: clampLen(len) });
export const visibleSteps = (q) => { const c = cleanSeq(q); return c.steps.slice(0, c.len); };
export function setStep(q, i, patch) {
  const c = cleanSeq(q); if (!(i >= 0 && i < AUTO.maxLen)) return c;
  c.steps[i] = cleanStep({ ...c.steps[i], ...patch }); return c;
}

// ---------- Settings (what the browser keeps in localStorage 'klibb.autoslap') ----------
// on is NOT kept: it always starts off (and goes off on Esc / leaving the room).
export function cleanSettings(s) {
  const src = s && typeof s === 'object' ? s : {};
  const r = isNum(src.rate) ? src.rate : AUTO.defaultRate;
  return {
    mode: MODES.includes(src.mode) ? src.mode : 'bar',
    rate: Number(Math.min(AUTO.maxRate, Math.max(AUTO.minRate, r)).toPrecision(3)),
    bars: AUTO.bars.includes(src.bars) ? src.bars : AUTO.defaultBars,
    seq: cleanSeq(src.seq),
  };
}

// ---------- Rate slider (log): 0 = 1 per 4 s, sliderSteps = maxRate per s ----------
const LO = Math.log2(AUTO.minRate), HI = Math.log2(AUTO.maxRate);
export function rateToSlider(r) { const v = Math.min(AUTO.maxRate, Math.max(AUTO.minRate, isNum(r) ? r : AUTO.defaultRate)); return Math.round(AUTO.sliderSteps * (Math.log2(v) - LO) / (HI - LO)); }
export function sliderToRate(x) { const k = Math.min(1, Math.max(0, Number(x) / AUTO.sliderSteps || 0)); return Number(Math.pow(2, LO + k * (HI - LO)).toPrecision(3)); }
// , and . : a quarter octave slower / faster
export const stepRate = (r, dir) => Number(Math.min(AUTO.maxRate, Math.max(AUTO.minRate, (isNum(r) ? r : AUTO.defaultRate) * Math.pow(2, Math.sign(dir) / 4))).toPrecision(3));
export const rateLabel = (r) => (r >= 1 ? `${Number(r.toPrecision(3))}/s` : `1 per ${Number((1 / r).toPrecision(2))} s`);

// ---------- Timing ----------
// ms per step. bar mode: barMs = the room's Groove bar length (shared/groove.mjs barMs(scale)).
export function stepMs(settings, barMs = 1500) {
  const s = cleanSettings(settings);
  return s.mode === 'bar' ? barMs * s.bars / s.seq.len : 1000 / s.rate;
}
// Effective slaps per second when every step is on (after the minGap cap).
export const effectiveRate = (settings, barMs) => Math.min(1000 / AUTO.minGapMs, 1000 / stepMs(settings, barMs));
// Which step (absolute number; step index = n mod len) is playing at time t.
//   bar mode: from the Groove's shared bar position (barsAt(groove, t) in bars) – the same for
//             everyone in the room, on the beat with the footsteps.
//   free mode: from the moment it was switched on (t0).
export function stepAt(settings, { t, bars = null, t0 = 0 }) {
  const s = cleanSettings(settings);
  if (s.mode === 'bar') return Math.floor(((bars ?? 0) / s.bars) * s.seq.len + 1e-9);
  return Math.floor((t - t0) / (1000 / s.rate) + 1e-9);
}
// The Sequencer: called every frame with the current absolute step n. Returns the step to fire
// ({ n, i, step }) or null: only when n moved on (a slow frame fires the newest step once, never a
// burst of missed ones), the step is on, and the last slap was ≥ minGapMs ago.
export function createClock() {
  let last = null, lastFire = -Infinity;
  return {
    tick(settings, n, now) {
      if (last === n) return null;
      const first = last === null; last = n;
      if (first) return null; // switching on (or resuming) waits for the next step boundary
      const s = cleanSettings(settings), i = ((n % s.seq.len) + s.seq.len) % s.seq.len, step = s.seq.steps[i];
      if (!step.on) return null; // (vol 0 = a silent slap, still a slap)
      if (now - lastFire < AUTO.minGapMs - 1) return { n, i, step, skipped: 'gap' };
      lastFire = now;
      return { n, i, step };
    },
    reset() { last = null; },
    get lastFire() { return lastFire; },
  };
}
// Skip a slap if the crosshair has hardly moved since the last one (no hundreds in one spot).
export function movedEnough(prev, point, surface, size) {
  if (!prev) return true;
  if (prev.surface !== surface) return true;
  const d = Math.hypot(point[0] - prev.point[0], point[1] - prev.point[1], point[2] - prev.point[2]);
  return d >= Math.max(AUTO.minMove, (isNum(size) ? size : 0.15) * 0.25);
}
