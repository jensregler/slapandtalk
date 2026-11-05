// Modulation LFOs for synth patches (Jens, 5 Nov 2026): up to MOD.max LFOs per patch, each one
// modulating a layer parameter, the patch volume, or ANOTHER LFO's rate or depth (nesting).
// Plain JSON + pure maths, shared by the browser (client/src/synth.js) and the tests.
//
// A MOD is { id: 'm1'…'m99', to: TARGET, wave, rate (Hz), depth (0–1), phase (0–1, start) }.
// TARGET is a string:
//   'L<i>.<param>'  layer i's param (see LAYER_TARGETS – only params that are cheap AudioParams)
//   'G.gain'        the patch volume
//   'm<n>.rate' | 'm<n>.depth'   another LFO (nesting)
//
// How it runs (cheap on purpose): NO audio nodes per LFO. When a voice starts, evalMods() walks
// every LFO once per control block (sampleRate / 128 ≈ 375 blocks/s at 48 kHz) in dependency
// order (an LFO is evaluated after every LFO that modulates it) and returns one multiplicative
// factor curve per target. synth.js writes each curve with ONE setValueCurveAtTime on the
// parameter it drives (osc/sampler detune in cents, filter detune, Q, level gain, patch gain).
//
// Every target is a factor: 'oct' targets swing ±oct octaves at full depth (2^(o·oct)),
// 'trem' targets dip between 1 − depth and 1 (tremolo style). o = wave(phase) · depth ∈ [−1, 1].
// 'add' targets (pan) get o added (curve = 1 + o; the engine subtracts the 1). Several LFOs on one
// target multiply (add: their o's add up).
//
// AUDIO RATE (Jens, 5 Nov 2026: "up to 11"): rates go to 5 kHz, so an LFO can become a tone (FM/AM).
// That can't be a control-rate curve, so in the browser all LFOs of a voice run PER SAMPLE inside ONE
// AudioWorklet node (client/src/dsp.js, 'klibb-mods'): compileMods() turns the mods into a flat,
// topologically ordered program and modRunner() (plain JS, also used by the tests) steps it once per
// sample; each modulated parameter gets one output of that node, connected straight into the
// AudioParam (no per-LFO nodes, no graph rebuild). evalMods() (control rate) is the fallback while
// the worklet loads and the reference the tests compare with.
//
// Limits (enforced by cleanMods, the editor refuses before that):
//   MOD.max 16 LFOs per patch · nesting depth ≤ MOD.maxDepth 6 (an LFO on a layer = level 1, an
//   LFO on that LFO = 2 …) · rate 0.01 Hz – 5 kHz (log slider; above 20 Hz the rate snaps to the
//   semitone grid, A4 = 440 Hz, so an audio-rate LFO makes an in-tune tone) · no cycles.
const WAVES = ['sine', 'square', 'sawtooth', 'triangle']; // (= synth.mjs WAVES; no import cycle)
//
// ENVELOPE FOLLOWER (Jens, 5 Nov 2026): a mod with wave 'follow' is a follower instead of an LFO –
// same list, same targets, same limits (it counts toward MOD.max 16 and the nesting depth 6, can be
// modulated by LFOs (its depth) and can modulate LFOs (rate/depth)), same per-sample worklet.
//   { id, to, wave: 'follow', src, attack (s), release (s), gain, thr (0–1), invert, depth }
//   src: 'mic' (my live microphone, mic.js) · 'master' (my whole sound) · 'bus' (the city place bus,
//        after the zones) · 'L<i>' (layer i of the same voice). At most MOD.maxInputs different
//        sources per patch (each is one input of the worklet node).
// Per sample: env += (|x|·gain − env)·(attack or release coefficient) (one-pole, rectified);
// v = (env − thr) / (1 − thr) clamped 0…1 (1 − v when invert); it then acts like an LFO value
// o = (2v − 1)·depth (so 'trem' targets go from 1 − depth (quiet) to 1 (loud)).
// Feedback (a follower on layer i driving layer i, or on master/bus driving my own sound) is
// ALLOWED: it is a control loop with one render quantum (128 samples) of delay, bounded (v is
// clamped, every target is clamped), and smoothed – such loops get release ≥ MOD.loopRelease.
// selfLoop(mod) tells the editor to mark it "↻ follows itself".

export const MOD = {
  max: 16,
  maxDepth: 6,
  rate: [0.01, 5000, 0.01],
  gridFrom: 20,         // Hz: from here up, rates snap to the semitone grid (snapRate)
  depth: [0, 1, 0.01],
  phase: [0, 1, 0.01],
  block: 128,           // samples per control block (the Web Audio render quantum)
  maxSeconds: 12,       // the longest voice a curve is made for
  maxInputs: 4,         // different follower sources per patch
  attack: [0.001, 1, 0.001], release: [0.01, 3, 0.01], gain: [0.1, 20, 0.1], thr: [0, 0.95, 0.01],
  loopRelease: 0.05,    // s: the least release for a follower that follows what it modulates
};
export const FOLLOW_SRC_RE = /^(mic|master|bus|L[0-3])$/;
// Does this follower follow (part of) what it modulates? (layer i → L<i>.*, master/bus → anything of mine)
export function selfLoop(m) {
  if (!m || m.wave !== 'follow') return false;
  const t = parseTarget(m.to); if (!t) return false;
  if (m.src === 'master' || m.src === 'bus') return t.type !== 'mod';
  return /^L\d$/.test(m.src) && t.type === 'layer' && `L${t.layer}` === m.src;
}
export function newFollower(patch, to, src = 'master') {
  if (!canAddMod(patch, to)) return null;
  const srcs = new Set((patch.mods || []).filter((m) => m.wave === 'follow').map((m) => m.src));
  if (!srcs.has(src) && srcs.size >= MOD.maxInputs) return null;
  return { id: nextModId(patch.mods), to, wave: 'follow', src, attack: 0.01, release: 0.2, gain: 4, thr: 0, invert: false, depth: 0.6, rate: 1, phase: 0 };
}
// What can be modulated, per layer kind, and how (see the header).
export const LAYER_TARGETS = {
  osc: { freq: { oct: 1 }, detune: { oct: 1 }, cutoff: { oct: 3 }, q: { oct: 2 }, level: { trem: 1 }, decim: { oct: 2 } },
  noise: { cutoff: { oct: 3 }, q: { oct: 2 }, level: { trem: 1 }, decim: { oct: 2 } },
  mic: { cutoff: { oct: 3 }, q: { oct: 2 }, level: { trem: 1 }, decim: { oct: 2 } },
  sampler: { note: { oct: 1 }, detune: { oct: 1 }, cutoff: { oct: 3 }, q: { oct: 2 }, level: { trem: 1 }, pan: { add: 1 }, decim: { oct: 2 } },
};
export const PATCH_TARGETS = { gain: { trem: 1 } };
export const MOD_TARGETS = { rate: { oct: 3 }, depth: { trem: 1 } };
// Sensible defaults when "Add LFO?" is accepted (per param).
export const MOD_DEFAULTS = {
  freq: { wave: 'sine', rate: 5, depth: 0.04 }, note: { wave: 'sine', rate: 5, depth: 0.04 }, detune: { wave: 'sine', rate: 5, depth: 0.04 },
  cutoff: { wave: 'sine', rate: 2, depth: 0.5 }, q: { wave: 'triangle', rate: 1, depth: 0.4 },
  level: { wave: 'sine', rate: 6, depth: 0.5 }, gain: { wave: 'sine', rate: 4, depth: 0.4 },
  pan: { wave: 'sine', rate: 0.25, depth: 0.6 }, decim: { wave: 'triangle', rate: 0.5, depth: 0.5 },
  rate: { wave: 'sine', rate: 0.5, depth: 0.5 }, depth: { wave: 'triangle', rate: 0.3, depth: 0.5 },
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, [min, max, step], fb) => {
  if (!isNum(v)) return fb;
  const n = Math.round(Math.min(max, Math.max(min, v)) / step) * step;
  return Number(Math.min(max, Math.max(min, n)).toFixed(4));
};
const TARGET_RE = /^(?:L([0-3])\.([a-z]+)|G\.(gain)|(m[1-9][0-9]?)\.(rate|depth))$/i;
// Parse a target string → { type: 'layer'|'patch'|'mod', layer?, id?, param } or null.
export function parseTarget(to) {
  const m = typeof to === 'string' ? TARGET_RE.exec(to) : null; if (!m) return null;
  if (m[1] != null) return { type: 'layer', layer: Number(m[1]), param: m[2] };
  if (m[3]) return { type: 'patch', param: 'gain' };
  return { type: 'mod', id: m[4], param: m[5] };
}
// How a target is driven ({ oct } | { trem }), or null when it can't be modulated.
export function targetSpec(to, layers = []) {
  const t = parseTarget(to); if (!t) return null;
  if (t.type === 'patch') return PATCH_TARGETS[t.param] || null;
  if (t.type === 'mod') return MOD_TARGETS[t.param] || null;
  const l = layers[t.layer]; if (!l) return null;
  return (LAYER_TARGETS[l.kind] || {})[t.param] || null;
}

// Dependency order: every LFO after all LFOs that modulate it. Returns { order: [mods], depth: {id: n},
// cyclic: Set(ids) } – cyclic = ids that sit on (or hang off) a cycle (Kahn's algorithm leftovers).
export function modOrder(mods) {
  const byId = new Map(mods.map((m) => [m.id, m]));
  const into = new Map(mods.map((m) => [m.id, 0])); // how many LFOs modulate this one
  for (const m of mods) { const t = parseTarget(m.to); if (t?.type === 'mod' && byId.has(t.id)) into.set(t.id, into.get(t.id) + 1); }
  const queue = mods.filter((m) => into.get(m.id) === 0), order = [];
  while (queue.length) {
    const m = queue.shift(); order.push(m);
    const t = parseTarget(m.to);
    if (t?.type === 'mod' && byId.has(t.id)) { into.set(t.id, into.get(t.id) - 1); if (into.get(t.id) === 0) queue.push(byId.get(t.id)); }
  }
  const done = new Set(order.map((m) => m.id));
  const cyclic = new Set(mods.filter((m) => !done.has(m.id)).map((m) => m.id));
  // depth: an LFO on a layer/patch = 1, an LFO on an LFO of depth d = d + 1 (walk targets, reverse order)
  const depth = {};
  for (const m of [...order].reverse()) { const t = parseTarget(m.to); depth[m.id] = t?.type === 'mod' ? (depth[t.id] || 0) + 1 : 1; }
  return { order, depth, cyclic };
}

// Clean a patch's mods against its (already cleaned) layers: junk dropped, values clamped, at most
// MOD.max, unknown/unmodulatable targets dropped, LFOs on missing LFOs dropped, cycles dropped,
// anything nested deeper than MOD.maxDepth dropped. Returns [] when nothing is left.
export function cleanMods(mods, layers = []) {
  if (!Array.isArray(mods)) return [];
  let out = [];
  const seen = new Set();
  for (const m of mods.slice(0, MOD.max * 2)) {
    if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !/^m[1-9][0-9]?$/.test(m.id) || seen.has(m.id)) continue;
    if (!targetSpec(m.to, layers)) continue;
    seen.add(m.id);
    if (m.wave === 'follow') {
      if (typeof m.src !== 'string' || !FOLLOW_SRC_RE.test(m.src)) continue;
      if (/^L/.test(m.src) && !layers[Number(m.src[1])]) continue;
      const srcs = new Set(out.filter((x) => x.wave === 'follow').map((x) => x.src));
      if (!srcs.has(m.src) && srcs.size >= MOD.maxInputs) continue;
      const f = { id: m.id, to: m.to, wave: 'follow', src: m.src, attack: clamp(m.attack, MOD.attack, 0.01), release: clamp(m.release, MOD.release, 0.2),
        gain: clamp(m.gain, MOD.gain, 4), thr: clamp(m.thr, MOD.thr, 0), invert: m.invert === true, depth: clamp(m.depth, MOD.depth, 0.5), rate: 1, phase: 0 };
      if (selfLoop(f)) f.release = Math.max(f.release, MOD.loopRelease);
      out.push(f);
    } else out.push({ id: m.id, to: m.to, wave: WAVES.includes(m.wave) ? m.wave : 'sine',
      rate: snapRate(clamp(m.rate, MOD.rate, 1)), depth: clamp(m.depth, MOD.depth, 0.5), phase: clamp(m.phase, MOD.phase, 0) });
    if (out.length >= MOD.max) break;
  }
  // drop LFOs aimed at LFOs that aren't there, repeatedly (removing one can orphan another)
  for (let changed = true; changed;) {
    const ids = new Set(out.map((m) => m.id)); const n = out.length;
    out = out.filter((m) => { const t = parseTarget(m.to); return t.type !== 'mod' || (ids.has(t.id) && t.id !== m.id); });
    changed = out.length !== n;
  }
  const { cyclic } = modOrder(out);
  if (cyclic.size) out = out.filter((m) => !cyclic.has(m.id));
  for (let changed = true; changed;) { // too deep: drop the deepest, then re-check orphans
    const { depth } = modOrder(out); const n = out.length;
    out = out.filter((m) => depth[m.id] <= MOD.maxDepth);
    const ids = new Set(out.map((m) => m.id));
    out = out.filter((m) => { const t = parseTarget(m.to); return t.type !== 'mod' || ids.has(t.id); });
    changed = out.length !== n;
  }
  return out;
}
// Could an LFO be added on `to` (the editor's "Add LFO?")? false when it can't be modulated, already
// has an LFO, the patch is full, or it would nest too deep.
export function canAddMod(patch, to) {
  const mods = patch.mods || [];
  if (mods.length >= MOD.max || !targetSpec(to, patch.layers)) return false;
  if (mods.some((m) => m.to === to)) return false;
  const t = parseTarget(to);
  if (t.type === 'mod') { const { depth } = modOrder(mods); if (!(t.id in depth) || depth[t.id] + 1 > MOD.maxDepth) return false; }
  return true;
}
export function nextModId(mods = []) { for (let i = 1; i < 100; i++) if (!mods.some((m) => m.id === 'm' + i)) return 'm' + i; return null; }
export function newMod(patch, to) {
  if (!canAddMod(patch, to)) return null;
  const param = parseTarget(to).param;
  return { id: nextModId(patch.mods), to, ...(MOD_DEFAULTS[param] || MOD_DEFAULTS.level), phase: 0 };
}
// Remove an LFO and everything that modulated it (recursively).
export function removeMod(mods, id) {
  let out = mods.filter((m) => m.id !== id);
  for (let changed = true; changed;) { const ids = new Set(out.map((m) => m.id)); const n = out.length; out = out.filter((m) => { const t = parseTarget(m.to); return t.type !== 'mod' || ids.has(t.id); }); changed = out.length !== n; }
  return out;
}
// A layer was removed: drop the LFOs on it (and their modulators), shift the higher layers down.
export function removeLayerMods(mods, index) {
  let out = mods.filter((m) => { const t = parseTarget(m.to); return !(t.type === 'layer' && t.layer === index); })
    .map((m) => { const t = parseTarget(m.to); return t.type === 'layer' && t.layer > index ? { ...m, to: `L${t.layer - 1}.${t.param}` } : m; });
  for (let changed = true; changed;) { const ids = new Set(out.map((m) => m.id)); const n = out.length; out = out.filter((m) => { const t = parseTarget(m.to); return t.type !== 'mod' || ids.has(t.id); }); changed = out.length !== n; }
  return out;
}

// Rates ≥ MOD.gridFrom snap to the nearest equal-tempered semitone (A4 = 440 Hz): audio-rate LFOs
// (and the master clock, shared/clock.mjs) then sit on the same grid as the pitch controls.
export function snapRate(hz) {
  if (!isNum(hz) || hz < MOD.gridFrom) return hz;
  return Number((440 * Math.pow(2, Math.round(12 * Math.log2(hz / 440)) / 12)).toFixed(4));
}
export function waveAt(wave, p) {
  const x = p - Math.floor(p);
  switch (wave) {
    case 'square': return x < 0.5 ? 1 : -1;
    case 'sawtooth': return 2 * x - 1;
    case 'triangle': return x < 0.25 ? 4 * x : x < 0.75 ? 2 - 4 * x : 4 * x - 4;
    default: return Math.sin(2 * Math.PI * x);
  }
}
// Evaluate all LFOs (already cleaned) for `seconds` at blockRate (blocks/s). Returns
// { curves: { target: Float32Array(factor per block) }, blocks, dt }. Only layer/patch targets get
// curves (LFO→LFO effects are folded into their targets' curves).
export function evalMods(mods, { seconds, blockRate = 48000 / MOD.block, layers = null } = {}) {
  const list = layers ? cleanMods(mods, layers) : mods;
  const out = { curves: {}, blocks: 0, dt: 1 / blockRate };
  if (!list.length) return out;
  const n = Math.max(2, Math.min(Math.ceil(Math.min(MOD.maxSeconds, seconds) * blockRate) + 1, Math.ceil(MOD.maxSeconds * blockRate) + 1));
  out.blocks = n;
  const { order } = modOrder(list);
  const factor = new Map(); // target → Float32Array (starts at 1)
  const get = (to) => { let a = factor.get(to); if (!a) { a = new Float32Array(n).fill(1); factor.set(to, a); } return a; };
  const dt = out.dt, [rmin, rmax] = MOD.rate;
  for (const m of order) {
    const rateF = factor.get(m.id + '.rate'), depthF = factor.get(m.id + '.depth');
    const t = parseTarget(m.to);
    const spec = t.type === 'mod' ? MOD_TARGETS[t.param] : t.type === 'patch' ? PATCH_TARGETS[t.param]
      : t.param === 'level' ? { trem: 1 } : t.param === 'pan' ? { add: 1 } : { oct: LAYER_OCT[t.param] ?? 1 };
    const dst = get(m.to), isTrem = !!spec.trem, isAdd = !!spec.add, o0 = spec.oct || 1;
    let phase = m.phase;
    for (let i = 0; i < n; i++) {
      const d = depthF ? Math.min(1, m.depth * depthF[i]) : m.depth;
      const o = m.wave === 'follow' ? 0 : waveAt(m.wave, phase) * d; // (a follower needs audio: neutral here)
      if (isAdd) dst[i] += o; else dst[i] *= isTrem ? 1 - 0.5 * d + 0.5 * o : Math.pow(2, o * o0);
      const r = rateF ? Math.min(rmax, Math.max(rmin, m.rate * rateF[i])) : m.rate;
      phase += r * dt;
    }
  }
  for (const [to, a] of factor) if (!/^m/.test(to)) out.curves[to] = a;
  return out;
}
// (layer params' octave ranges / trem, when evalMods is called without layers)
const LAYER_OCT = { freq: 1, note: 1, detune: 1, cutoff: 3, q: 2, decim: 2 };

// ---------- Per-sample program (the worklet) ----------
// compileMods(mods, layers, { gate }) → { list, slots, outs } – plain arrays/numbers (structured-clone
// safe, sent to the worklet as processorOptions):
//   list: in dependency order, each { wave (0 sine, 1 square, 2 saw, 3 triangle, 4 gate), rate, depth,
//         phase, rateSlot, depthSlot (−1 = none), dst (slot), mode (0 oct, 1 trem, 2 add, 3 gate), oct,
//         pattern?, decay? }
//   slots: how many factor slots (each starts every sample at 1)
//   outs:  [{ to, slot, conv: 'cents' | 'lin' | 'add', scale }] – one worklet output each. Pitch params
//          of a layer (freq, note, detune) share one slot 'L<i>.pitch' (they multiply anyway).
const WAVE_CODE = { sine: 0, square: 1, sawtooth: 2, triangle: 3, gate: 4, follow: 5 };
export function compileMods(mods, layers = [], { bases = {} } = {}) {
  const { order } = modOrder(mods);
  const slot = new Map(); const key = (to) => { const t = parseTarget(to); return t && t.type === 'layer' && ['freq', 'note', 'detune'].includes(t.param) ? `L${t.layer}.pitch` : to; };
  const get = (k) => { if (!slot.has(k)) slot.set(k, slot.size); return slot.get(k); };
  const list = [], inputs = [];
  for (const m of order) {
    const t = parseTarget(m.to);
    const spec = t.type === 'mod' ? MOD_TARGETS[t.param] : t.type === 'patch' ? PATCH_TARGETS[t.param]
      : m.wave === 'gate' ? { gate: 1 } : t.param === 'level' ? { trem: 1 } : t.param === 'pan' ? { add: 1 } : { oct: LAYER_OCT[t.param] ?? 1 };
    list.push({ wave: WAVE_CODE[m.wave] ?? 0, rate: m.rate, depth: m.depth, phase: m.phase || 0,
      rateSlot: slot.has(m.id + '.rate') || mods.some((x) => x.to === m.id + '.rate') ? get(m.id + '.rate') : -1,
      depthSlot: slot.has(m.id + '.depth') || mods.some((x) => x.to === m.id + '.depth') ? get(m.id + '.depth') : -1,
      dst: get(key(m.to)), mode: m.wave === 'gate' ? 3 : spec.add ? 2 : spec.trem ? 1 : 0, oct: spec.oct || 1,
      ...(m.pattern ? { pattern: Array.from(m.pattern), decay: m.decay || 0 } : {}),
      ...(m.wave === 'follow' ? { inp: inputs.includes(m.src) ? inputs.indexOf(m.src) : inputs.push(m.src) - 1, att: m.attack, rel: m.release, gain: m.gain, thr: m.thr, inv: m.invert ? 1 : 0, id: m.id } : {}) });
  }
  // (an LFO's rate slot must exist before its modulators write it: get() above made it at first use)
  const outs = [];
  for (const [k, sl] of slot) {
    if (/^m/.test(k)) continue;
    const t = parseTarget(k.replace('.pitch', '.freq'));
    const conv = t.type === 'layer' && (k.endsWith('.pitch') || t.param === 'cutoff') ? 'cents' : t.type === 'layer' && t.param === 'pan' ? 'add' : 'lin';
    outs.push({ to: k, slot: sl, conv, scale: bases[k] ?? 1 });
  }
  void layers;
  return { list, slots: slot.size, outs, inputs };
}
// A runner for a compiled program: step() advances one sample and fills `f` (Float64Array of slot
// factors); out(i) gives output i's value in its param's units (cents offset, or scale·(f − 1)).
// Self-contained on purpose: client/src/dsp.js puts its source text into the worklet.
export function modRunner(prog, sampleRate) {
  const L = prog.list, n = L.length, f = new Float64Array(Math.max(1, prog.slots)), ph = new Float64Array(n), dt = 1 / sampleRate;
  for (let j = 0; j < n; j++) ph[j] = L[j].phase || 0;
  const env = new Float64Array(n), ca = new Float64Array(n), cr = new Float64Array(n);
  for (let j = 0; j < n; j++) if (L[j].wave === 5) { ca[j] = 1 - Math.exp(-1 / (Math.max(0.0005, L[j].att) * sampleRate)); cr[j] = 1 - Math.exp(-1 / (Math.max(0.005, L[j].rel) * sampleRate)); }
  const W = (w, x) => (w === 1 ? (x < 0.5 ? 1 : -1) : w === 2 ? 2 * x - 1 : w === 3 ? (x < 0.25 ? 4 * x : x < 0.75 ? 2 - 4 * x : 4 * x - 4) : Math.sin(6.283185307179586 * x));
  function step(inp) { // inp: this sample of each follower input (array), or nothing
    f.fill(1);
    for (let j = 0; j < n; j++) {
      const m = L[j];
      let r = m.rateSlot >= 0 ? m.rate * f[m.rateSlot] : m.rate; if (!(r >= 0.01)) r = 0.01; else if (r > 5000) r = 5000;
      let d = m.depthSlot >= 0 ? m.depth * f[m.depthSlot] : m.depth; if (!(d >= 0)) d = 0; else if (d > 1) d = 1;
      const x = ph[j];
      if (m.wave === 5) { // envelope follower: rectify + one-pole smooth (attack up, release down)
        let a = inp ? inp[m.inp] : 0; a = a > 0 ? a * m.gain : -a * m.gain; if (!(a < 1e3)) a = 0;
        let e = env[j]; e += (a > e ? ca[j] : cr[j]) * (a - e); if (e < 1e-12) e = 0; env[j] = e;
        let v = m.thr > 0 ? (e - m.thr) / (1 - m.thr) : e; v = v < 0 ? 0 : v > 1 ? 1 : v; if (m.inv) v = 1 - v;
        const o = (2 * v - 1) * d;
        if (m.mode === 2) f[m.dst] += o; else if (m.mode === 1) f[m.dst] *= 1 - 0.5 * d + 0.5 * o; else f[m.dst] *= Math.pow(2, o * m.oct);
        continue;
      }
      if (m.mode === 3) { // gate: step pattern (loop = one cycle), each step decays
        const len = m.pattern.length, pos = x * len, i = Math.floor(pos) % len, fr = pos - Math.floor(pos);
        f[m.dst] *= m.pattern[i] * (m.decay > 0 ? Math.exp(-fr * m.decay) : 1);
      } else {
        const o = W(m.wave, x) * d;
        if (m.mode === 2) f[m.dst] += o; else if (m.mode === 1) f[m.dst] *= 1 - 0.5 * d + 0.5 * o; else f[m.dst] *= Math.pow(2, o * m.oct);
      }
      let p = x + r * dt; p -= Math.floor(p); ph[j] = p;
    }
  }
  const outs = prog.outs;
  function out(i) {
    const o = outs[i], v = f[o.slot];
    let y = o.conv === 'cents' ? 1200 * Math.log2(v > 1e-6 ? v : 1e-6) : o.conv === 'add' ? v - 1 : o.scale * (v - 1);
    if (!(y === y) || y === Infinity || y === -Infinity) y = 0; // NaN / ∞ guard
    else if (y > -1e-20 && y < 1e-20) y = 0;                     // no denormals
    return y;
  }
  return { step, out, f, phases: ph, env };
}
