// Dancing NPCs in the city (Jens t873u, 12 Nov 2026: "kan du sätta ut några npc som dansar lite här o där.
// slumpa runt med deras olika steg och gå, run, crouch inställningar. jag vill ha tre på torget en bit
// ifrån varandra så man får känslan av volym rangen").
//
// Every city's outside has the same handful of NPCs for everybody in it: the server hands the list out in
// the WebSocket welcome (server/realtime.js, welcome.npcs) and every client renders them like the other
// players – an avatar doing the looping X dance (shared/dance.mjs), whose footsteps play on THEIR OWN
// tempo grid (shared/groove.mjs) as a spatial sound, i.e. the normal remote-player falloff. No traffic
// after the welcome: everything below is a pure function of the city id (the seed) and the server clock.
//
//   - Three stand on the plaza (torg) in a tight conversation (~1.4 m apart), a few metres west of the
//     mid-plaza spawn so they don't overlap new arrivals; four more stand in the streets around the city.
//   - Each has its own randomized (seeded) Steps sound (a variation built on the default step: noise
//     scuff + a tuned oscillator on a pentatonic note), Tempo (a tempo of the 120-BPM grid, t881u), Groove scale,
//     groove slot (polyrhythm 3/4/5/6/7) and walk / run / crouch settings (run tempo, run pitch, crouch
//     tempo, crouch pitch – the same settings real players have, shared/runmode.mjs).
//   - Their gait changes on the clock: every NPC_TIME.segBeats beats of their own dance tempo they pick
//     walk, run or crouch again (seeded by the segment number), so all screens agree. Run / crouch rates are
//     octaves (×2, ×4, ×½, ×¼): the dance keeps its walk tempo (it never jumps) and the steps stay on its
//     beat – double or half time.
//   - Now and then they "press Wild" in the Steps sound menu (Jens t894u): the same randomPatch(..., { wild: true })
//     as the Wild button (client/src/soundui.js). Each NPC has its own seeded period in NPC_WILD.minMs…maxMs and
//     a seeded phase, so they change out of sync; the patch is a pure function of the seed + the server clock,
//     so every client hears the same thing with no extra network traffic. Tempo / gait are untouched. Loudness
//     is whatever Wild already clamps (cleanPatch).
//   - Not players: they are not in "N here", voice chat, slots, room limits or the recording.
// Pure maths (no DOM / Three.js) – the server, the web app and tests/npcs.test.mjs share it.
import AV from './avatar.json' with { type: 'json' };
import { PLAZA, isCityOutside, cityOf } from './city.mjs';
import { cleanPatch, snapFreq, randomPatch } from './synth.mjs';
import { RUN, snapWalkBpm, tempoRate, pitchRatio } from './runmode.mjs';
import { TEMPO_BPMS } from './tempogrid.mjs';
import { cleanPlayerTempo } from './playertempo.mjs';
import { danceGrid } from './dance.mjs';

export const NPC = Object.freeze({
  audibleM: 34,   // beyond this their steps are not scheduled at all (gain there ≈ 5 %, inverse distance from 1.6 m)
  visibleM: 60,
  slowM: 25,      // beyond this the dance is animated every other frame
  maxHeard: 4,    // at most this many (the nearest) are scheduled at once   // beyond this the avatar is hidden and not animated (cheap; the city is 96 m across)
  plazaSide: 1.4,  // conversation distance (m) – a tight triangle, as if in a talk (Jens t893u)
});
// The plaza conversation: a tight equilateral triangle a few metres west of the square's centre (the
// spawn at PLAZA.x/z), on the paving and clear of the benches and the Town Hall wall.
export const PLAZA_TALK = Object.freeze({ x: -4.5, z: PLAZA.z });
const H = NPC.plazaSide * Math.sqrt(3) / 2;
export const NPC_SPOTS = Object.freeze([
  Object.freeze({ x: +(PLAZA_TALK.x - NPC.plazaSide / 2).toFixed(3), z: +(PLAZA_TALK.z - H / 3).toFixed(3), plaza: true }),
  Object.freeze({ x: +(PLAZA_TALK.x + NPC.plazaSide / 2).toFixed(3), z: +(PLAZA_TALK.z - H / 3).toFixed(3), plaza: true }),
  Object.freeze({ x: +PLAZA_TALK.x.toFixed(3), z: +(PLAZA_TALK.z + (2 * H) / 3).toFixed(3), plaza: true }),
  // "here and there": the streets between the plots (open ground, not in a building)
  Object.freeze({ x: -16, z: 2 }),   // west of the Town Hall, by the reverb room
  Object.freeze({ x: 16.5, z: -3 }), // east of the Town Hall, by the delay room
  Object.freeze({ x: -17, z: 28 }),  // south-west, between houses 6 and the noise room
  Object.freeze({ x: 17, z: 30 }),   // south-east, between the noise room and house 8
]);
const NAMES = ['Bop', 'Zuzu', 'Kiko', 'Moxie', 'Pim', 'Rumba', 'Tilly', 'Juno', 'Ozzy', 'Fizz', 'Lulu', 'Dex', 'Mira', 'Taro'];
// Tempo: only tempi of the 120-BPM grid (shared/tempogrid.mjs, Jens t881u) in a danceable band, so every NPC's
// beat meets everybody's on the shared bar line: 75 · 5:8, 80 · 2:3, 90 · 3:4, 96 · 4:5, 100 · 5:6, 105 · 7:8,
// 120 · 1:1, 144 · 6:5, 150 · 5:4, 160 · 4:3, 180 · 3:2 (120 twice: the base is the most common). Groove scale: mostly 1
// (octaves only – on the scale grid).
export const NPC_BPMS = Object.freeze(TEMPO_BPMS.filter((b) => b >= 75 && b <= 180 && b !== 192));
const BPMS = [...NPC_BPMS, 120];
const SCALES = [1, 1, 1, 2, 0.5];
// Run / crouch tempo in % (shared/runmode.mjs): octaves only, so the steps stay on the dance's beat.
const RUN_TEMPI = [100, 100, 300];       // ×2, ×2, ×4
const CROUCH_TEMPI = [-100, -100, -300]; // ×½, ×½, ×¼
// Pentatonic notes for the step oscillator (A minor pentatonic, A1 … A4): nothing clashes much.
const PENTA = [0, 3, 5, 7, 10];
const NOTES = [];
for (let o = 0; o < 3; o++) for (const s of PENTA) NOTES.push(snapFreq(55 * Math.pow(2, o + s / 12)));
NOTES.push(440);
export const NPC_TIME = Object.freeze({ segBeats: 32, gaits: ['walk', 'walk', 'run', 'crouch'] });
// How often an NPC presses Wild on its Steps sound (Jens t894u). Tune these two.
export const NPC_WILD = Object.freeze({ minMs: 20_000, maxMs: 60_000 });

export function npcHash(str) { // FNV-1a → uint32
  let h = 0x811c9dc5 >>> 0; const s = String(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
export function npcRng(seed) { // mulberry32
  let a = (typeof seed === 'number' ? seed : npcHash(seed)) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];
const between = (r, a, b, dp = 3) => +(a + r() * (b - a)).toFixed(dp);

// One NPC's Steps sound: the default footstep's shape (a soft noise scuff + a tuned oscillator thump), each
// part randomized within tasteful bounds; sometimes a third layer (a sub or a high tick).
export function npcStepPatch(seed) {
  const r = npcRng('npc-step:' + seed);
  const wave = pick(r, ['sine', 'sine', 'triangle', 'triangle', 'square', 'sawtooth']);
  const hard = wave === 'square' || wave === 'sawtooth';
  const freq = pick(r, NOTES);
  const layers = [
    { kind: 'noise', noise: pick(r, ['pink', 'pink', 'white']), filter: 'lowpass', cutoff: Math.round(between(r, 320, 2600, 0)), q: between(r, 0.6, 2.5, 1),
      fEnv: between(r, -2, -0.5, 2), fTime: between(r, 0.03, 0.09), a: 0.002, d: between(r, 0.035, 0.11), level: between(r, 0.1, 0.2, 2) },
    { kind: 'osc', wave, freq, pitchAmt: between(r, 0, 12, 1), pitchTime: between(r, 0.02, 0.07), a: 0.002, d: between(r, 0.05, 0.17),
      filter: 'lowpass', cutoff: Math.round(Math.min(18000, freq * between(r, 4, 14, 1))), level: hard ? between(r, 0.05, 0.09, 2) : between(r, 0.1, 0.18, 2) },
  ];
  const extra = r();
  if (extra < 0.2) layers.push({ kind: 'osc', wave: 'sine', freq: snapFreq(freq / 2), a: 0.002, d: between(r, 0.06, 0.14), level: between(r, 0.06, 0.12, 2) });
  else if (extra < 0.35) layers.push({ kind: 'osc', wave: 'triangle', freq: snapFreq(freq * 4), a: 0.001, d: between(r, 0.015, 0.04), level: between(r, 0.03, 0.06, 2), delay: between(r, 0, 0.02) });
  return cleanPatch({ v: 1, gain: 1, layers });
}

// The NPCs of a room: [] unless it is a city's outside. Each: { id, name, label, x, z, yaw, plaza, slot,
// look, sound: { seed, colour, patches: { step } }, walkBpm, scale, run: { tempo, pitch, crouchTempo, crouchPitch }, danceBpm }.
export function npcsFor(roomId) {
  if (!isCityOutside(roomId)) return [];
  const city = cityOf(roomId), names = NAMES.slice();
  const nr = npcRng('npc-names:' + city);
  return NPC_SPOTS.map((spot, k) => {
    const seed = `npc:${city}:${k}`, r = npcRng(seed);
    const name = names.splice(Math.floor(nr() * names.length), 1)[0];
    const walkBpm = snapWalkBpm(pick(r, BPMS));
    const scale = pick(r, SCALES);
    const run = { tempo: pick(r, RUN_TEMPI), pitch: pick(r, [1, 2, 3, 3, 4, 5]), crouchTempo: pick(r, CROUCH_TEMPI), crouchPitch: pick(r, [-1, -2, -2, -3, -5]) };
    const any = (list) => pick(r, list);
    const look = { outfit: any(Object.keys(AV.outfits)), hair: any(Object.keys(AV.hair)), shirt: any(AV.colors.shirt), pants: any(AV.colors.pants),
      hairColor: any(AV.colors.hair), skin: any(AV.colors.skin), shoes: any(AV.colors.shoes || ['#222222']), hat: false, hatColor: any(AV.colors.hat) };
    // plaza ones face the conversation's centre (a little off); the rest face the city's middle
    const cx = spot.plaza ? PLAZA_TALK.x : 0, cz = spot.plaza ? PLAZA_TALK.z : 0;
    const yaw = +(Math.atan2(-(cx - spot.x), -(cz - spot.z)) + between(r, spot.plaza ? -0.15 : -0.4, spot.plaza ? 0.15 : 0.4)).toFixed(3);
    const slot = Math.floor(r() * 5);
    const id = `npc-${k}`;
    return { id, npc: true, name, label: `${name} · NPC`, x: spot.x, z: spot.z, yaw, plaza: !!spot.plaza, slot, look,
      sound: { seed: `npc${npcHash(seed).toString(36)}`, colour: slot, patches: { step: npcStepPatch(seed) } },
      walkBpm, scale, run, danceBpm: danceGrid(0, { bpm: walkBpm }).bpm };
  });
}

// The dance: looping, anchored at server time 0 on the NPC's walk tempo (folded to 60–180 like everyone's),
// so it is at the same beat on every screen. What Avatar.startDance takes.
export const npcDance = (npc) => ({ at: 0, bpm: npc.danceBpm, phaseMs: 0, loop: true });
// How long one gait segment is (ms): NPC_TIME.segBeats beats of the dance tempo = whole dance loops (16 beats each).
export const npcSegMs = (npc) => (NPC_TIME.segBeats * 60000) / npc.danceBpm;
// Which gait it is in at server time nowMs: 'walk' | 'run' | 'crouch' (seeded per segment, the same everywhere).
export function npcGaitAt(npc, nowMs) {
  const k = Math.floor(nowMs / npcSegMs(npc));
  return pick(npcRng(`npc-gait:${npc.sound.seed}:${k}`), NPC_TIME.gaits);
}
// Its player tempo at nowMs (shared/playertempo.mjs { bpm, scale, rate, tune }) – what groove.js plays its steps on.
export function npcTempoAt(npc, nowMs) {
  const g = npcGaitAt(npc, nowMs), R = npc.run;
  const rate = g === 'run' ? tempoRate(R.tempo) : g === 'crouch' ? tempoRate(R.crouchTempo) : 1;
  const tune = g === 'run' ? pitchRatio(R.pitch) : g === 'crouch' ? pitchRatio(R.crouchPitch) : 1;
  return cleanPlayerTempo({ bpm: npc.walkBpm, scale: npc.scale, rate, tune });
}
// Each NPC's Wild period (ms) and phase (ms into the period): seeded, in NPC_WILD.minMs…maxMs, so
// the seven of them do not all press at once. Period is constant per NPC (the interval is "about
// 20–60 s", different for each); the patch itself is a new Wild roll every period.
export function npcWildPeriod(npc) {
  const r = npcRng('npc-wild-period:' + npc.sound.seed);
  const ms = Math.round(NPC_WILD.minMs + r() * (NPC_WILD.maxMs - NPC_WILD.minMs));
  return Math.max(NPC_WILD.minMs, Math.min(NPC_WILD.maxMs, ms));
}
export function npcWildPhase(npc) {
  return Math.floor(npcRng('npc-wild-phase:' + npc.sound.seed)() * npcWildPeriod(npc));
}
// Which Wild press is in effect at server time nowMs (the same clock as npcGaitAt).
export function npcWildIndex(npc, nowMs) {
  const period = npcWildPeriod(npc), phase = npcWildPhase(npc);
  return Math.floor((Math.floor(nowMs) - phase) / period);
}
// The Wild button on the Steps tab (soundui.js randomize(true) → randomPatch(seed + 'step', { wild: true })).
export function npcWildPatch(npc, index) {
  return randomPatch(`npc-wild:${npc.sound.seed}:${index}:step`, { wild: true });
}
// The Steps patch heard at nowMs. The welcome still carries the original npcStepPatch (no extra
// traffic); clients compute this locally from the seed + the server clock.
export function npcStepPatchAt(npc, nowMs) {
  return npcWildPatch(npc, npcWildIndex(npc, nowMs));
}

// A received list (welcome.npcs) checked: at most 16, the fields the client needs, sane numbers. Bad → [].
export function cleanNpcs(list) {
  if (!Array.isArray(list)) return [];
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  return list.slice(0, 16).filter((n) => n && typeof n.id === 'string' && /^npc-[0-9]{1,2}$/.test(n.id) && isNum(n.x) && isNum(n.z) && isNum(n.walkBpm) && isNum(n.danceBpm) && n.danceBpm > 0 && n.sound && n.run)
    .map((n) => ({ ...n, walkBpm: snapWalkBpm(n.walkBpm), label: String(n.label || n.name || 'NPC').slice(0, 24) }));
}
