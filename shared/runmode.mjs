// Run mode (Jens t544u, 5 Nov 2026): hold Shift while walking = running. Two personal settings on
// the Sound settings' Steps (walk sound) tab change how MY footsteps sound while I run:
//   tempo – step rate relative to walking, shown −200 % … +200 % in 12.5 % jumps.
//           p ≥ 0: rate = 1 + p/100  (0 % = 1:1, +50 % = 3:2, +100 % = 2:1, +200 % = 3:1)
//           p < 0: rate = 1 / (1 + |p|/100)  (−50 % = 2:3, −100 % = 1:2, −200 % = 1:3)
//           a mirror image: never zero or negative, and the 50/100/200 marks are the clean ratios.
//   pitch – a step on a major-pentatonic ladder over the walk sound (C D E G A: no semitone
//           clashes, so running never sounds out of key against the walk / the four voices):
//           down 5 steps to an octave below (−40 % each), up 8 steps to an octave + a fifth above
//           (+25 % each). Default +75 % = +7 semitones (a fifth up).
//   lock  – "Lock to clock": the run tempo snaps to the nearest clean ratio against the walk grid
//           (1:3, 1:2, 2:3, 1:1, 3:2, 2:1, 3:1), so walkers and runners form a polyrhythm. Default on.
//   walkBpm – MY walk tempo (Jens, 11 Nov 2026): 30…3000 BPM, default 90, log slider. Per player
//           (this field, in my personal run-mode settings) – not a room / city / global clock. Only my
//           walk-sound sequencer (Steps sequencer layers, client/src/radio.js walkLoop) follows it.
// Pure maths – shared by the web app (client/src/groove.js, soundui.js) and the unit tests.

export const RUN = Object.freeze({
  speed: 1.8,               // movement speed while Shift is held (controls.js, as before)
  tempoMin: -200, tempoMax: 200, tempoStep: 12.5, tempoDef: 100,
  pitchDown: [-3, -5, -8, -10, -12],        // semitones, steps 1…5 below (pentatonic: A G E D C)
  pitchUp: [2, 4, 7, 9, 12, 14, 16, 19],    // semitones, steps 1…8 above (D E G A C D E G)
  pitchDef: 3,              // step index: +7 st (fifth)
  ratios: Object.freeze([[1, 3], [1, 2], [2, 3], [1, 1], [3, 2], [2, 1], [3, 1]]),
  lockDef: true,
  walkMin: 30, walkMax: 3000, walkDef: 90, // walk tempo, BPM (inclusive range)
  key: 'klibb.runMode',     // sessionStorage (personal sound setting, like the groove scale)
});
export const RUN_DEFAULTS = Object.freeze({ tempo: RUN.tempoDef, pitch: RUN.pitchDef, lock: RUN.lockDef, walkBpm: RUN.walkDef });
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Walk tempo (BPM): clamped to 30…3000 (both ends reachable), 0.1 BPM resolution.
export function cleanWalkBpm(b) {
  if (!isNum(b)) return RUN.walkDef;
  return Math.round(Math.min(RUN.walkMax, Math.max(RUN.walkMin, b)) * 10) / 10;
}
const WL = Math.log(RUN.walkMin), WH = Math.log(RUN.walkMax);
// The walk-tempo slider is logarithmic: knob 0 = 30 BPM, 1 = 3000 BPM (90 BPM ≈ 0.239).
export const walkBpmToKnob = (b) => (Math.log(cleanWalkBpm(b)) - WL) / (WH - WL);
export const knobToWalkBpm = (k) => cleanWalkBpm(Math.exp(WL + Math.min(1, Math.max(0, isNum(k) ? k : 0)) * (WH - WL)));
export const walkBpmLabel = (b) => { const c = cleanWalkBpm(b); return `${c < 200 ? c.toFixed(1) : Math.round(c)} BPM`; };

export function cleanTempo(p) {
  if (!isNum(p)) return RUN.tempoDef;
  const c = Math.min(RUN.tempoMax, Math.max(RUN.tempoMin, p));
  return Math.round(c / RUN.tempoStep) * RUN.tempoStep;
}
export const pitchMin = -RUN.pitchDown.length, pitchMax = RUN.pitchUp.length;
export function cleanPitch(i) { return isNum(i) ? Math.min(pitchMax, Math.max(pitchMin, Math.round(i))) : RUN.pitchDef; }
export function cleanRun(r) {
  if (!r || typeof r !== 'object') return { ...RUN_DEFAULTS };
  return { tempo: cleanTempo(r.tempo), pitch: cleanPitch(r.pitch), lock: typeof r.lock === 'boolean' ? r.lock : RUN.lockDef, walkBpm: cleanWalkBpm(r.walkBpm) };
}

// Tempo slider % → raw step-rate factor (before lock-to-clock).
export function tempoRate(p) { const c = cleanTempo(p); return c >= 0 ? 1 + c / 100 : 1 / (1 + -c / 100); }
// The nearest clean ratio (in log space, i.e. musically). Returns { num, den, rate }.
export function snapRatio(rate) {
  let best = RUN.ratios[3], bd = Infinity;
  for (const [n, d] of RUN.ratios) { const e = Math.abs(Math.log(rate) - Math.log(n / d)); if (e < bd - 1e-12) { bd = e; best = [n, d]; } }
  return { num: best[0], den: best[1], rate: best[0] / best[1] };
}
// What the step grid uses while running: rate (× the walk pulse rate) and the ratio label.
export function runRate(r) {
  const c = cleanRun(r), raw = tempoRate(c.tempo);
  if (!c.lock) return { rate: raw, num: null, den: null };
  return snapRatio(raw);
}
// Pitch slider step → semitones and the shown %.
export function pitchSemitones(i) { const c = cleanPitch(i); return c === 0 ? 0 : c > 0 ? RUN.pitchUp[c - 1] : RUN.pitchDown[-c - 1]; }
export function pitchPercent(i) { const c = cleanPitch(i); return c >= 0 ? c * (200 / pitchMax) : c * (200 / -pitchMin); }
export const pitchRatio = (i) => Math.pow(2, pitchSemitones(i) / 12);
const INTERVALS = { 0: 'same', 2: 'tone', 4: 'third', 7: 'fifth', 9: 'sixth', 12: 'octave', 14: 'octave + tone', 16: 'octave + third', 19: 'octave + fifth', 3: 'minor third', 5: 'fourth', 8: 'minor sixth', 10: 'minor seventh' };
export function pitchLabel(i) {
  const st = pitchSemitones(i), pc = pitchPercent(i);
  const name = INTERVALS[Math.abs(st)] || '';
  return `${pc > 0 ? '+' : ''}${Math.round(pc)}% · ${st > 0 ? '+' : ''}${st} st${st ? ` (${name} ${st > 0 ? 'up' : 'down'})` : ''}`;
}
export function tempoLabel(r) {
  const c = cleanRun(r), rr = runRate(c);
  const pc = `${c.tempo > 0 ? '+' : ''}${c.tempo % 1 ? c.tempo.toFixed(1) : c.tempo}%`;
  return rr.num ? `${pc} · ${rr.num}:${rr.den}` : `${pc} · ×${rr.rate.toFixed(2)}`;
}
