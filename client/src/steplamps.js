// Step lamps (Jens t956u, t960u): a light above each Steps-sequencer pad. Yellow flash when
// that step actually sounds; white flash when the playhead passes a step that does not sound
// (unmarked / off, or on but skipped by its 1:N condition). Times are AudioContext seconds.
// Each ratchet repeat is its own yellow hit, so the lamp flashes again (or stays lit if the
// repeats are closer than the flash). A skipped or off step flashes white once, at the
// playhead. The rAF loop compares AudioContext.currentTime to the scheduled times, so walk /
// run / sneak / dance stay in time even when the gait changes.

export const STEP_LAMP = Object.freeze({ flashSec: 0.12, maxQueue: 256 });

// hits: [{ i, t, color? }]  i = step index (0-based), t = AudioContext time in seconds
//                         color = 'white' for a silent playhead pass; omitted / anything else = yellow (sounded)
// now  = ctx.currentTime
// → Map of step index → 'on' (yellow) | 'white'. Yellow wins if both cover now.
export function lampsKind(hits, now, flashSec = STEP_LAMP.flashSec) {
  const kind = new Map();
  if (!Number.isFinite(now) || !Array.isArray(hits)) return kind;
  for (const h of hits) {
    if (!h || !Number.isInteger(h.i) || h.i < 0 || !Number.isFinite(h.t)) continue;
    if (h.t <= now && now < h.t + flashSec) {
      const c = h.color === 'white' ? 'white' : 'on';
      if (kind.get(h.i) !== 'on') kind.set(h.i, c);
    }
  }
  return kind;
}

// Set of step indices that should be lit right now (yellow or white)
export function lampsLit(hits, now, flashSec = STEP_LAMP.flashSec) {
  return new Set(lampsKind(hits, now, flashSec).keys());
}

export function pruneHits(hits, now, flashSec = STEP_LAMP.flashSec) {
  if (!Array.isArray(hits)) return [];
  if (!Number.isFinite(now)) return hits.slice();
  return hits.filter((h) => h && Number.isFinite(h.t) && now < h.t + flashSec);
}

export function scheduleHit(hits, i, t, now, { flashSec = STEP_LAMP.flashSec, maxQueue = STEP_LAMP.maxQueue, color } = {}) {
  const next = Array.isArray(hits) ? hits.slice() : [];
  if (!Number.isInteger(i) || i < 0 || !Number.isFinite(t)) return next;
  if (Number.isFinite(now) && t + flashSec <= now) return next; // already finished
  const rec = { i, t };
  if (color === 'white') rec.color = 'white';
  next.push(rec);
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

// color = 'white' for a silent playhead pass; omitted = yellow (the step sounded)
export function reportStepLamp(i, t, color) {
  const now = getNow();
  hits = scheduleHit(hits, i, t, now, color === 'white' ? { color: 'white' } : {});
  kick();
}

export function tickStepLampKinds(now = getNow()) {
  if (now == null || !Number.isFinite(now)) return lampsKind(hits, Number.NEGATIVE_INFINITY);
  hits = pruneHits(hits, now);
  const kind = lampsKind(hits, now);
  applyLamps(kind);
  return kind;
}

export function tickStepLamps(now = getNow()) {
  return new Set(tickStepLampKinds(now).keys());
}

// lit may be a Set of indices (all yellow) or a Map of i → 'on' | 'white'
export function applyLamps(lit, root = (typeof document !== 'undefined' ? document : null)) {
  if (!root || !root.querySelectorAll) return;
  const isMap = lit && typeof lit.has === 'function' && typeof lit.get === 'function';
  for (const el of root.querySelectorAll(LAMP_SEL)) {
    const i = Number(el.dataset.step);
    let yellow = false, white = false;
    if (isMap) {
      const k = lit.get(i);
      yellow = k === 'on';
      white = k === 'white';
    } else if (lit && lit.has) {
      yellow = lit.has(i);
    }
    el.classList.toggle('on', !!yellow);
    el.classList.toggle('white', !!white);
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
