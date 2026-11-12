// The tempo grid (Jens t881u, 12 Nov 2026: "vi måste få folks takter att matcha. om vi utgår från 120 bpm
// och istället för var 5e bpm så delar vi upp det i delar som är perfekta för 120 bpm samt polyrytm tänk").
//
// Everyone's Tempo is one of a fixed set of tempi that are musically related to 120 BPM: 120 × num/den
// with small whole numbers – octaves (×2, ×½), triplets (4:3, 2:3), and the classic polyrhythm ratios
// (6:5, 5:4, 3:2, 8:5, 5:3, 7:4) and their octaves – from 30 to 2880 BPM. The Tempo slider and its arrow
// keys step through this list (TEMPOS); anything else (an old saved 5-BPM value, a peer's message, an
// NPC) snaps to the nearest one (snapTempo, nearest in log space = musically nearest).
//
// Phase: every grid is anchored at server time 0 (the shared, server-corrected wall clock, groove.now()),
// so beat k of a tempo is at k × 60000 / bpm ms – for everybody, on every screen. 120 BPM's bar line
// (4 beats = 2000 ms) is at every multiple of 2000 ms. A tempo 120 × p/q (p, q coprime) has its beats at
// 500 × q/p ms, so it meets 120's beat every q beats of 120 (= p of its own) and 120's bar line every
// lcm(q, 4) / 4 bars: 180 (3:2) meets every 2 beats = every half bar and on every bar line, 150 (5:4)
// every bar, 144 (6:5) every 5 bars... Two grid tempi a and b meet every meetMs(a, b) ms.
// Pure maths – the web app, the server (via playertempo.mjs) and the tests share it.

export const TEMPO_GRID = Object.freeze({ base: 120, beatsPerBar: 4, min: 30, max: 3000, def: 90 });
// The ratios to 120 inside one octave [1, 2): num:den. Every tempo is one of these × a power of two.
export const TEMPO_CLASSES = Object.freeze([[1, 1], [6, 5], [5, 4], [4, 3], [3, 2], [8, 5], [5, 3], [7, 4]]);

const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
const lcm = (a, b) => (a / gcd(a, b)) * b;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function build() {
  const out = [];
  for (const [n0, d0] of TEMPO_CLASSES) {
    for (let k = -4; k <= 6; k++) {
      let num = n0 * (k > 0 ? 2 ** k : 1), den = d0 * (k < 0 ? 2 ** -k : 1);
      const g = gcd(num, den); num /= g; den /= g;
      const bpm = (TEMPO_GRID.base * num) / den; // exact: 120 is divisible by 3, 4 and 5; the rest is ×/÷ 2
      if (bpm < TEMPO_GRID.min - 1e-9 || bpm > TEMPO_GRID.max + 1e-9) continue;
      out.push(Object.freeze({ bpm, num, den, ratio: `${num}:${den}`, label: `${bpm} · ${num}:${den}` }));
    }
  }
  out.sort((a, b) => a.bpm - b.bpm);
  return Object.freeze(out);
}
// [{ bpm, num, den, ratio: '3:2', label: '180 · 3:2' }] from slow to fast.
export const TEMPOS = build();
export const TEMPO_BPMS = Object.freeze(TEMPOS.map((t) => t.bpm));
const LOGS = TEMPO_BPMS.map(Math.log);

// The index of the nearest grid tempo (log space). Junk → the default (90).
export function tempoIndex(b) {
  const v = isNum(b) && b > 0 ? b : TEMPO_GRID.def;
  const l = Math.log(Math.min(TEMPO_BPMS[TEMPO_BPMS.length - 1], Math.max(TEMPO_BPMS[0], v)));
  let best = 0, bd = Infinity;
  for (let i = 0; i < LOGS.length; i++) { const e = Math.abs(LOGS[i] - l); if (e < bd - 1e-12) { bd = e; best = i; } }
  return best;
}
export const snapTempo = (b) => TEMPO_BPMS[tempoIndex(b)];
export const tempoAt = (i) => TEMPOS[Math.min(TEMPOS.length - 1, Math.max(0, Math.round(isNum(i) ? i : tempoIndex(TEMPO_GRID.def))))];
// One notch up / down the list (arrow keys), clamped at the ends.
export const stepTempo = (b, d) => tempoAt(tempoIndex(b) + Math.round(d)).bpm;
export const tempoInfo = (b) => TEMPOS[tempoIndex(b)];
export const tempoGridLabel = (b) => tempoInfo(b).label;
export const isGridTempo = (b) => isNum(b) && Math.abs(snapTempo(b) - b) < 1e-9;

// ---------- Phase on the shared clock (server ms, anchored at 0) ----------
export const beatMsOf = (bpm) => 60000 / bpm;
export const barMsOf = (bpm) => beatMsOf(bpm) * TEMPO_GRID.beatsPerBar;
// The first beat of `bpm` at or after t (ms). (A beat within eps before t counts as now.)
export function nextBeatMs(t, bpm, eps = 1e-6) { const B = beatMsOf(bpm); return Math.ceil((t - eps) / B) * B; }
// The ratio of any tempo to 120 as an exact fraction (grid tempi; others are snapped first).
export function ratioOf(b) { const t = tempoInfo(b); return { num: t.num, den: t.den }; }
// How often (ms) two grid tempi's beats coincide: lcm of the two beat periods. Beat of 120·p/q = 500·q/p ms,
// lcm(500·q1/p1, 500·q2/p2) = 500 · lcm(q1, q2) / gcd(p1, p2).
export function meetMs(a, b = TEMPO_GRID.base) {
  const x = ratioOf(a), y = ratioOf(b);
  return (beatMsOf(TEMPO_GRID.base) * lcm(x.den, y.den)) / gcd(x.num, y.num);
}
// …in bars of 120 (2000 ms), rounded up to whole bars: every how many bars of 120 the two land on the bar line together.
export function meetBars(a, b = TEMPO_GRID.base) {
  const m = meetMs(a, b), bar = barMsOf(TEMPO_GRID.base);
  return lcm(Math.round(m * 1000), bar * 1000) / (bar * 1000);
}

// ---------- Entering in time (Jens t883u) ----------
// When you start walking / dancing or switch gait, your first step waits for the next beat of your
// tempo × gait rate on the shared clock instead of sounding at the key press. The unit is that beat,
// halved (still on the same grid) while it is longer than ENTRY.maxWaitMs, so you never wait more than
// half a second, even at 30 BPM. A beat that went by less than ENTRY.graceMs ago is taken at once (that
// little late is not heard; waiting a whole beat would be).
export const ENTRY = Object.freeze({ maxWaitMs: 500, graceMs: 20 });
export function entryUnitMs(bpm, rate = 1) {
  let u = beatMsOf((isNum(bpm) && bpm > 0 ? bpm : TEMPO_GRID.def) * (isNum(rate) && rate > 0 ? rate : 1)), g = 0;
  while (u > ENTRY.maxWaitMs + 1e-9 && g++ < 16) u /= 2;
  return u;
}
export function entryMs(t, bpm, rate = 1) {
  const u = entryUnitMs(bpm, rate), prev = Math.floor(t / u) * u;
  if (t - prev <= ENTRY.graceMs) return prev;
  return prev + u;
}

// Every rate a run / crouch tempo notch can give (shared/runmode.mjs tempoRate), as exact fractions:
// (8 + k):8 and 8:(8 + k), k = 0 … 32 (−400 … +400 % in 12.5 % notches).
export const RATE_GRID = Object.freeze((() => { const out = new Set(); for (let k = 0; k <= 32; k++) { out.add((8 + k) / 8); out.add(8 / (8 + k)); } return [...out].sort((a, b) => a - b); })());
// Every tempo anybody's steps / dance can run at: a grid tempo × a rate (before octave folding).
const STEP_TEMPI = (() => { const out = new Set(); for (const b of TEMPO_BPMS) for (const r of RATE_GRID) out.add(b * r); return [...out]; })();
// A tempo that is a grid tempo × a run / crouch rate (and maybe folded by octaves for the dance) but arrived
// rounded (the server relays a dance's bpm at 0.001, playertempo rounds to 6 digits): back to the exact value it
// stands for, so its beats sit on the shared grid even ~1.8e12 ms after the epoch. Anything else → unchanged.
export function exactBpm(b, tol = 0.00051) {
  if (!isNum(b) || b <= 0) return b;
  for (const c of STEP_TEMPI) {
    const k = Math.round(Math.log2(b / c)), v = c * 2 ** k;
    if (Math.abs(v - b) <= tol) return v;
  }
  return b;
}
