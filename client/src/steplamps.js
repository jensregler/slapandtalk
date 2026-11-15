// Step lamps (Jens t956u): a light above each Steps-sequencer pad that flashes when that step
// actually sounds. Times are AudioContext seconds. Conditions are respected because only real
// scheduled hits are reported (groove.js / the walk→run preview). Each ratchet repeat is its
// own hit, so the lamp flashes again (or stays lit if the repeats are closer than the flash).
// The rAF loop compares AudioContext.currentTime to the scheduled times, so walk / run / sneak /
// dance stay in time even when the gait changes.

export const STEP_LAMP = Object.freeze({ flashSec: 0.12, maxQueue: 256 });

// hits: [{ i, t }]  i = step index (0-based), t = AudioContext time in seconds
// now  = ctx.currentTime
// → Set of step indices that should be lit right now
export function lampsLit(hits, now, flashSec = STEP_LAMP.flashSec) {
  const on = new Set();
  if (!Number.isFinite(now) || !Array.isArray(hits)) return on;
  for (const h of hits) {
    if (!h || !Number.isInteger(h.i) || h.i < 0 || !Number.isFinite(h.t)) continue;
    if (h.t <= now && now < h.t + flashSec) on.add(h.i);
  }
  return on;
}

export function pruneHits(hits, now, flashSec = STEP_LAMP.flashSec) {
  if (!Array.isArray(hits)) return [];
  if (!Number.isFinite(now)) return hits.slice();
  return hits.filter((h) => h && Number.isFinite(h.t) && now < h.t + flashSec);
}

export function scheduleHit(hits, i, t, now, { flashSec = STEP_LAMP.flashSec, maxQueue = STEP_LAMP.maxQueue } = {}) {
  const next = Array.isArray(hits) ? hits.slice() : [];
  if (!Number.isInteger(i) || i < 0 || !Number.isFinite(t)) return next;
  if (Number.isFinite(now) && t + flashSec <= now) return next; // already finished
  next.push({ i, t });
  if (next.length > maxQueue) next.splice(0, next.length - maxQueue);
  return next;
}

const LAMP_SEL = '#snd-stepseq .ss-lamp';

let getNow = () => null;
let hits = [];
let raf = 0;

export function attachStepLamps(opts = {}) {
  if (typeof opts.getNow === 'function') getNow = opts.getNow;
}

export function resetStepLamps() {
  hits = [];
  if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
  raf = 0;
}

export function reportStepLamp(i, t) {
  const now = getNow();
  hits = scheduleHit(hits, i, t, now);
  kick();
}

export function tickStepLamps(now = getNow()) {
  if (now == null || !Number.isFinite(now)) return lampsLit(hits, Number.NEGATIVE_INFINITY);
  hits = pruneHits(hits, now);
  const lit = lampsLit(hits, now);
  applyLamps(lit);
  return lit;
}

export function applyLamps(lit, root = (typeof document !== 'undefined' ? document : null)) {
  if (!root || !root.querySelectorAll) return;
  for (const el of root.querySelectorAll(LAMP_SEL)) {
    const on = lit && lit.has(Number(el.dataset.step));
    el.classList.toggle('on', !!on);
  }
}

function kick() {
  if (typeof requestAnimationFrame !== 'function') return;
  if (raf) return;
  raf = requestAnimationFrame(loop);
}

function loop() {
  raf = 0;
  tickStepLamps();
  if (hits.length) kick();
}
