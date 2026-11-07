// Master / room sound (was "the radio"; Jens, 5 Nov 2026 + rebuild Nov 2026).
// Sound-settings Master UI shows only: master volume (ears) + City sound (0–100 dry↔wet).
// Saved shape still carries the older fields so presets load:
//   on, knob – forced to on + 0.5 ("my sound"); Blend / power UI removed
//   bpm      – walk tempo (moved to Steps tab; dance clock / radio.tempo() follow it)
//   city     – 0..1 dry/wet of the city place bus (reverb + delay); 0 = dry, 1 = wet only
//   bird, wind, voices – dormant (engine paths kept; no Master UI)
// Per PLAYER and per ROOM: saved on the server, never broadcast.
import { cleanSound, rng, hashSeed } from './synth.mjs';
import { MASTER } from './clock.mjs';
import { snapRate } from './lfo.mjs';

// bpm: MY master tempo (default 90). Range 30 BPM … 120 000 BPM (= 2 kHz beats: "up to 11"); the
// knob is logarithmic. From 20 beats/s (1200 BPM) up the tempo snaps to the semitone grid, so a
// clock run up into audio rate plays an in-tune tone.
export const RADIO = { maxPresetBytes: 46000, minBpm: 30, maxBpm: 120000, gridFromHz: 20, fastSteps: 25 };
export function cleanBpm(v) {
  if (!isNum(v)) return MASTER.bpm;
  const b = Math.min(RADIO.maxBpm, Math.max(RADIO.minBpm, v));
  return b / 60 >= RADIO.gridFromHz ? Number((snapRate(b / 60) * 60).toFixed(2)) : Number(b.toFixed(2));
}
const BL = Math.log(RADIO.minBpm), BH = Math.log(RADIO.maxBpm);
export const bpmToKnob = (b) => (Math.log(cleanBpm(b)) - BL) / (BH - BL);
export const knobToBpm = (k) => cleanBpm(Math.exp(BL + Math.min(1, Math.max(0, k)) * (BH - BL)));
export const OWNER_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const knobToMorph = (k) => 2 * Math.min(1, Math.max(0, Number.isFinite(k) ? k : 0.5));
export const RADIO_DEFAULTS = Object.freeze({ on: true, knob: 0.5, bpm: MASTER.bpm, city: 0, bird: { on: false, vol: 0.35 }, wind: { on: false, vol: 0.25 }, voices: { on: false, vol: 0.5 } });
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const unit = (v, fb) => (isNum(v) ? Math.round(Math.min(1, Math.max(0, v)) * 100) / 100 : fb);
const sw = (o, d) => ({ on: typeof o?.on === 'boolean' ? o.on : d.on, vol: unit(o?.vol, d.vol) });
export function cleanRadio(r) {
  const d = RADIO_DEFAULTS; if (!r || typeof r !== 'object') return { ...d, bird: { ...d.bird }, wind: { ...d.wind }, voices: { ...d.voices } };
  // on + knob always "my sound" (Blend / power UI gone). bpm / city / ambients still load from presets.
  return { on: true, knob: 0.5, bpm: cleanBpm(r.bpm), city: unit(r.city, d.city), bird: sw(r.bird, d.bird), wind: sw(r.wind, d.wind), voices: sw(r.voices, d.voices) };
}
// A room preset as stored: { patches?, fx?, radio }. null = nothing (= the original sound, radio defaults).
export function cleanPreset(p) {
  if (!p || typeof p !== 'object') return null;
  const s = cleanSound({ patches: p.patches, fx: p.fx }, { custom: true }) || {};
  const out = { radio: cleanRadio(p.radio) };
  if (s.patches) out.patches = s.patches;
  if (s.fx) out.fx = s.fx;
  if (!out.patches && !out.fx && !p.radio) return null;
  return out;
}

// ---------- Four voices in phase ----------
// One shared cycle (the bar, from the server-corrected clock, so everyone's radio agrees). Each voice
// has its own step count – 3, 4, 5, 7 – so they run as a polyrhythm and all meet again on beat 1 of
// every cycle. Pitches are just-intonation ratios over the root (1 : 3/2 : 2 : 5/2 = root, fifth,
// octave, major tenth): whole-number ratios, so the voices never beat against each other.
// Each voice plays one of my sounds (my preset through the knob), retuned by its ratio.
export const FOUR_VOICES = Object.freeze([
  { name: 'Low', steps: 3, ratio: 1, sound: 'duff', gain: 1.1 },
  { name: 'Walk', steps: 4, ratio: 3 / 2, sound: 'step', gain: 1.6 },
  { name: 'Call', steps: 5, ratio: 2, sound: 'peel', gain: 0.7 }, // was nope (removed); peel keeps all four non-nope sounds in the voices
  { name: 'Spark', steps: 7, ratio: 5 / 2, sound: 'slap', gain: 0.45 },
]);
export const VOICE_CYCLE_MS = 60000 / MASTER.bpm * MASTER.beatsPerBar; // one cycle = one master bar (2667 ms at 90 BPM)
// Every voice step with from ≤ t < to (ms on the shared clock): [{ t, voice, n }], sorted by t.
export function voiceEvents(from, to, cycleMs = VOICE_CYCLE_MS, max = 200) {
  const out = []; if (!(to > from) || !(cycleMs > 0)) return out;
  FOUR_VOICES.forEach((v, voice) => {
    const step = cycleMs / v.steps;
    for (let k = Math.ceil(from / step - 1e-9); out.length < max; k++) {
      const t = k * step; if (t >= to) break; if (t < from) continue;
      out.push({ t, voice, n: ((k % v.steps) + v.steps) % v.steps });
    }
  });
  return out.sort((a, b) => a.t - b.t || a.voice - b.voice);
}

// ---------- Background bird (no samples) ----------
// Loosely after Norrland birds: the willow warbler's soft descending cascade (lövsångare), the
// redwing's short falling flute phrase (rödvingetrast) and the golden plover's lonely, falling
// "tlüü" whistle (ljungpipare). Every phrase falls; long silences between them.
// Returns [{ t (s from the phrase start), f0, f1 (Hz glide), dur (s), amp (0–1) }].
export function birdPhrase(seed) {
  const r = rng(hashSeed('bird:' + seed)), out = [];
  const kind = r() < 0.4 ? 'warbler' : r() < 0.6 ? 'redwing' : 'plover';
  if (kind === 'warbler') { // 8–13 soft notes stepping down ~4.6 → 3 kHz, getting slower and fuller
    const n = 8 + Math.floor(r() * 6); let f = 4400 + r() * 500, t = 0;
    for (let i = 0; i < n; i++) { const d = 0.07 + i * 0.006; out.push({ t, f0: f * 1.06, f1: f * 0.94, dur: d, amp: 0.5 + 0.4 * (i / n) }); t += d + 0.03; f *= 0.955 + r() * 0.015; }
  } else if (kind === 'redwing') { // 3–5 clear falling notes, then a short twitter
    const n = 3 + Math.floor(r() * 3); let f = 3600 + r() * 600, t = 0;
    for (let i = 0; i < n; i++) { out.push({ t, f0: f, f1: f * 0.82, dur: 0.12, amp: 0.8 }); t += 0.16; f *= 0.9; }
    for (let i = 0; i < 4; i++) { out.push({ t, f0: 5200 + r() * 800, f1: 4600, dur: 0.035, amp: 0.3 }); t += 0.05; }
  } else { // 1–2 long mournful whistles 2.6 → 2.1 kHz
    const n = 1 + Math.floor(r() * 2); let t = 0;
    for (let i = 0; i < n; i++) { const f = 2500 + r() * 200; out.push({ t, f0: f, f1: f * 0.82, dur: 0.45 + r() * 0.15, amp: 0.7 }); t += 1.1 + r() * 0.5; }
  }
  return { kind, notes: out, gap: 5 + r() * 12 }; // gap: silence (s) before the next phrase
}
