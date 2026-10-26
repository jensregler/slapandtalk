// Pure layout and timing for finished videos (used by client/src/videocomposer.js and the tests).
// Config (ticker lines, timings, bug size) lives in shared/video.json.

// Which logo intro fits this frame? 16:9, 9:16 or 1:1 (the three files in client/public/intro/).
export function pickIntro(w, h) {
  const r = w / Math.max(1, h);
  if (r >= 1.3) return '16x9';
  if (r <= 0.77) return '9x16';
  return '1x1';
}
export const INTRO_ASPECT = { '16x9': '16:9', '9x16': '9:16', '1x1': '1:1' };

// Output size: the replay canvas' shape, longest side at most maxSide, even numbers (encoders like that).
export function outputSize(w, h, maxSide = 1280) {
  w = Math.max(2, w | 0); h = Math.max(2, h | 0);
  const s = Math.min(1, maxSide / Math.max(w, h));
  const even = (n) => Math.max(2, Math.round(n * s / 2) * 2);
  return { w: even(w), h: even(h) };
}

// Fit a source (sw x sh) inside the frame (contain), centred. -> { x, y, w, h }
export function containRect(sw, sh, w, h) {
  const s = Math.min(w / sw, h / sh);
  const dw = sw * s, dh = sh * s;
  return { x: (w - dw) / 2, y: (h - dh) / 2, w: dw, h: dh };
}

// The channel bug: top-right corner, a small margin. Width = widthFraction of the frame width
// (landscape); a bit bigger on portrait frames so it stays readable.
export function bugRect(w, h, aspect, { widthFraction = 0.11 } = {}) {
  const bw = Math.round(Math.max(48, (w >= h ? w : w * 1.6) * widthFraction));
  const bh = Math.round(bw / aspect);
  const m = Math.round(Math.min(w, h) * 0.035);
  return { x: w - bw - m, y: m, w: bw, h: bh };
}

// A tiny seeded random (mulberry32), so one video's ticker timing is reproducible in tests.
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// When does the ticker show? [{ at, until, text }] in ms from the START of the replay part
// (after the intro), up to durationMs. First after firstAfterSeconds, then every 20–30 s.
export function tickerSchedule(cfg, durationMs, seed = 1) {
  const out = [], r = rng(seed), lines = (cfg.lines || []).filter(Boolean);
  if (!lines.length) return out;
  const show = cfg.showSeconds * 1000;
  let at = cfg.firstAfterSeconds * 1000, i = 0;
  while (at + show <= durationMs) {
    out.push({ at, until: at + show, text: lines[i % lines.length] });
    i++;
    at += show + (cfg.everyMinSeconds + r() * (cfg.everyMaxSeconds - cfg.everyMinSeconds)) * 1000;
  }
  return out;
}
// Where is the ticker at time t? -> null, or { text, k } with k 0..1 = how far it has slid in.
export function tickerAt(schedule, t, slideMs = 450) {
  for (const s of schedule) {
    if (t < s.at || t >= s.until) continue;
    const k = Math.min(1, (t - s.at) / slideMs, (s.until - t) / slideMs);
    return { text: s.text, k: k * k * (3 - 2 * k) }; // smoothstep: calm in, calm out
  }
  return null;
}
