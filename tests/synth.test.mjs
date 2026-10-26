// Synth + effects (shared/synth.mjs) and the full-version gating of custom sounds:
// schema clamping, deterministic per-player variation, duff scaling, room acoustics, and the
// server dropping custom patches from free players while broadcasting them for soundDesign ones.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { SYNTH, SOUNDS, DEFAULT_PATCHES, FX_DEFAULTS, cleanPatch, cleanLayer, cleanFx, cleanSound, variant, duffScale, roomAcoustics,
  ACOUSTICS, randomPatch, randomFx, delaySeconds, retune, hashSeed, VARIATION } from '../shared/synth.mjs';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { attachRealtime, synthReady } = require('../server/realtime');
const { makeEntitlements } = require('../server/entitlements');

const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Schema: validation and clamping ----------
const wild = cleanLayer({ kind: 'laser', wave: 'zigzag', freq: 1e9, detune: -5000, unison: 99, q: -1, a: 0, s: 7, lfo: 'everything', lfoRate: 'fast', level: 2, drive: NaN, extra: 'x' });
assert(wild.kind === 'osc' && wild.wave === 'sine' && wild.freq === 8000 && wild.detune === -1200 && wild.unison === 5 && wild.q === 0.1 && wild.a === 0.001 && wild.s === 1
  && wild.lfo === 'none' && wild.lfoRate === 5 && wild.level === 1 && wild.drive === 0 && !('extra' in wild),
  'layer: numbers are clamped to their ranges, unknown enums/junk fall back to defaults, unknown keys dropped');
const many = cleanPatch({ gain: 9, layers: Array.from({ length: 9 }, () => ({ kind: 'noise' })) });
assert(many.layers.length === SYNTH.maxLayers && many.gain === 1.5 && cleanPatch({ layers: [] }) === null && cleanPatch('x') === null && cleanPatch({ layers: [null, 5] }) === null,
  `patch: at most ${SYNTH.maxLayers} layers, gain clamped, empty/garbage patches rejected`);
for (const k of SOUNDS) { const p = DEFAULT_PATCHES[k]; if (!same(cleanPatch(p), p)) throw new Error('default patch not clean: ' + k); }
assert(SOUNDS.join() === 'slap,peel,nope,step,duff' && SOUNDS.every((k) => JSON.stringify(DEFAULT_PATCHES[k]).length < SYNTH.maxPatchBytes), 'the five default patches (slap, peel, nope, step, duff) are valid, clean JSON');
const fx = cleanFx({ reverb: { decay: 99, wet: -1 }, delay: { time: 5, sync: '1/3', feedback: 2, pingPong: 'yes' }, crush: { bits: 0.2 }, dist: { amount: 3 }, filter: { type: 'notch', cutoff: 1 }, chorus: {} });
assert(fx.reverb.decay === 12 && fx.reverb.wet === 0 && fx.delay.time === 1.5 && fx.delay.sync === 'free' && fx.delay.feedback === 0.95 && fx.delay.pingPong === false
  && fx.crush.bits === 1 && fx.dist.amount === 1 && fx.filter.type === 'lowpass' && fx.filter.cutoff === 20 && !('chorus' in fx) && cleanFx(null) === null,
  'effects: reverb/delay/crush/distortion/filter params clamped (feedback ≤ 0.95, so the delay can never run away), bad sync/type → defaults');
assert(delaySeconds({ sync: '1/8', time: 0.3 }) === 0.25 && delaySeconds({ sync: '1/4' }) === 0.5 && delaySeconds({ sync: 'free', time: 0.3 }) === 0.3, 'delay sync: 1/4 = 0.5 s and 1/8 = 0.25 s at 120 BPM, free = time');
const big = { seed: 'abcd1234', patches: Object.fromEntries(SOUNDS.map((k) => [k, { layers: Array.from({ length: 4 }, () => ({ kind: 'osc', freq: 123.456789, cutoff: 4567.891 })), fx: FX_DEFAULTS }])), fx: FX_DEFAULTS };
const freeS = cleanSound(big), paidS = cleanSound(big, { custom: true });
assert(same(freeS, { seed: 'abcd1234' }) && paidS.seed === 'abcd1234' && JSON.stringify(paidS).length <= SYNTH.maxSoundBytes && cleanSound({ seed: 'bad seed!' }) === null,
  `look.sound: free = only the seed; soundDesign = patches + fx (≤ ${SYNTH.maxSoundBytes} bytes, else dropped)`);
const huge = cleanSound({ seed: 'abcd1234', patches: Object.fromEntries(SOUNDS.map((k) => [k, { layers: Array.from({ length: 4 }, () => ({ kind: 'osc', fx: 1 })), fx: FX_DEFAULTS }])), fx: FX_DEFAULTS }, { custom: true });
assert(huge && huge.seed, 'oversized sound data never breaks the look (worst case only the seed stays)');

// ---------- Deterministic per-player variation ----------
const v1 = variant(DEFAULT_PATCHES.slap, 'playerA', 'slap'), v1b = variant(DEFAULT_PATCHES.slap, 'playerA', 'slap'), v2 = variant(DEFAULT_PATCHES.slap, 'playerB', 'slap');
assert(same(v1, v1b) && !same(v1, v2), 'variation: the same seed always gives the same sound, another player gets another one');
let inBounds = true;
for (let i = 0; i < 200; i++) {
  const seed = 'p' + i;
  for (const k of SOUNDS) {
    const v = variant(DEFAULT_PATCHES[k], seed, k), d = DEFAULT_PATCHES[k];
    v.layers.forEach((l, j) => {
      const r = l.freq / d.layers[j].freq, len = l.d / d.layers[j].d;
      if (Math.abs(r - 1) > VARIATION.pitch + 0.01 || Math.abs(len - 1) > VARIATION.length + 0.02 || l.level !== d.layers[j].level) inBounds = false;
    });
  }
}
assert(inBounds, `variation stays tasteful: pitch ±${Math.round(VARIATION.pitch * 100)} %, length ±${Math.round(VARIATION.length * 100)} %, levels untouched (200 players × 5 sounds)`);
assert(hashSeed('x') === hashSeed('x') && hashSeed('x') !== hashSeed('y'), 'seed hash is stable');

// ---------- Duff: bigger paper = louder and lower ----------
const areas = [0.0025, 0.01, 0.04, 0.09, 0.25, 0.64, 1.44];
const ds = areas.map(duffScale);
assert(ds.every((d, i) => i === 0 || (d.gain >= ds[i - 1].gain && d.rate <= ds[i - 1].rate)) && ds[0].gain < ds[6].gain && ds[0].rate > ds[6].rate && same(duffScale(0.09), { gain: 1, rate: 1 }),
  `duff: volume rises and pitch falls with peel area (${ds.map((d, i) => `${areas[i]} m² → ×${d.gain} vol, ×${d.rate} pitch`).join('; ')})`);
assert(retune(DEFAULT_PATCHES.duff, 0.5).layers[1].freq === DEFAULT_PATCHES.duff.layers[1].freq * 0.5, 'retune lowers the duff pitch for big papers');

// ---------- Free acoustics from the room's materials ----------
const ac = (s) => roomAcoustics(s).reverb.wet;
const tile = ac({ wall: 'kakel', floor: 'parkett' }), concrete = ac({ wall: 'puts', floor: 'betong' }), plain = ac({ wall: 'tapet', floor: 'parkett', ceiling: 'vit' }), both = ac({ wall: 'kakel', floor: 'betong', ceiling: 'betong' });
assert(tile > concrete && concrete > 0 && concrete <= 0.06 && plain === 0 && both <= ACOUSTICS.maxWet && ac(null) === 0 && roomAcoustics({ wall: 'kakel' }).reverb.decay > roomAcoustics({ floor: 'betong' }).reverb.decay,
  `room acoustics: tile walls a little reverb (${tile}), concrete floor very discreet (${concrete}), other materials dry (${plain}), never above ${ACOUSTICS.maxWet}`);

// ---------- Randomize ----------
const rp = randomPatch('x', { wild: true }), rf = randomFx('x', { wild: true });
assert(same(rp, cleanPatch(rp)) && same(rf, cleanFx(rf)) && same(randomPatch('x', { wild: true }), rp) && !same(randomPatch('y'), randomPatch('z')), 'randomize: random patches and effects are always valid (already clamped) and seedable');

// ---------- Server: gating and broadcast of custom patches ----------
await synthReady;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-synth-'));
const store = createStore(new LocalAdapter(dir));
const entitle = makeEntitlements({ FULL_ACCESS_KEYS: 'sound-key-12345:soundDesign, fabric-key-1234:fabrics' });
const app = createApp(store, { adminToken: 'x', entitle });
const server = app.listen(0);
const rt = attachRealtime(server, { maxPlayers: 5, heartbeatMs: 500, entitle });
const base = `ws://127.0.0.1:${server.address().port}`;
const clients = [];
const client = (room, hello) => {
  const ws = new WebSocket(`${base}/ws?room=${room}`);
  const c = { ws, msgs: [] }; clients.push(c);
  ws.on('message', (d) => c.msgs.push(JSON.parse(d.toString())));
  c.send = (m) => ws.send(JSON.stringify(m));
  c.wait = async (pred, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = c.msgs.find(pred); if (m) return m; await sleep(10); } return null; };
  c.ready = new Promise((r) => ws.on('open', r)).then(() => c.send({ t: 'hello', ...hello }));
  return c;
};
try {
  const mine = { seed: 'paidPlayer1', patches: { slap: { gain: 1, layers: [{ kind: 'noise', cutoff: 99999, q: 50 }] } }, fx: { delay: { wet: 0.5, feedback: 3 } } };
  const a = client('snd', { name: 'Paid', look: { outfit: 'punk', sound: mine }, unlock: { key: 'sound-key-12345' } });
  await a.ready; await a.wait((m) => m.t === 'welcome');
  const f = client('snd', { name: 'Free', look: { outfit: 'punk', sound: { seed: 'freePlayer1', patches: mine.patches, fx: mine.fx } }, unlock: { key: 'fabric-key-1234' } });
  await f.ready;
  const wf = await f.wait((m) => m.t === 'welcome');
  const seenPaid = wf.players.find((p) => p.name === 'Paid').look.sound;
  assert(seenPaid.seed === 'paidPlayer1' && seenPaid.patches.slap.layers[0].cutoff === 18000 && seenPaid.patches.slap.layers[0].q === 30 && seenPaid.fx.delay.feedback === 0.95,
    'soundDesign player: custom patches + effects are broadcast with the look, clamped by the server');
  const jf = await a.wait((m) => m.t === 'join' && m.player.name === 'Free');
  assert(same(jf.player.look.sound, { seed: 'freePlayer1' }), 'free player (even with a fabrics-only key): custom patches/effects are dropped by the server, the seed stays');
  f.send({ t: 'look', name: 'Free', look: { outfit: 'punk', sound: { seed: 'freePlayer1', patches: mine.patches } } });
  const lf = await a.wait((m) => m.t === 'look' && m.name === 'Free');
  assert(lf && same(lf.look.sound, { seed: 'freePlayer1' }), 'also on look updates (no way around the UI)');
  a.send({ t: 'look', name: 'Paid', look: { outfit: 'punk', sound: { seed: 'paidPlayer1', patches: { peel: DEFAULT_PATCHES.peel } } } });
  const la = await f.wait((m) => m.t === 'look' && m.name === 'Paid');
  assert(la && same(la.look.sound.patches, { peel: DEFAULT_PATCHES.peel }) && !la.look.sound.fx, 'changing sounds reaches everyone right away (the others play MY patch, no audio over the network)');
  const old = client('snd', { name: 'Old', look: { outfit: 'punk' } });
  await old.ready; const jo = await a.wait((m) => m.t === 'join' && m.player.name === 'Old');
  assert(jo && !('sound' in jo.player.look), 'older clients without look.sound work as before (they just get the default sounds)');
} finally {
  for (const c of clients) try { c.ws.close(); } catch { /* */ }
  rt.close?.(); server.close(); fs.rmSync(dir, { recursive: true, force: true });
}
// ---------- Slot colours (demo: up to five people sound distinct) ----------
{
  const S2 = await import('../shared/synth.mjs');
  const ok2 = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
  ok2(S2.SLOT_COLOURS.length === 5 && S2.colourPatch(S2.DEFAULT_PATCHES.step, 0, 'step') === S2.DEFAULT_PATCHES.step, 'slot colours: five, slot 0 = the plain default');
  for (const kind of S2.COLOURED) {
    const freqs = S2.SLOT_COLOURS.map((_, i) => S2.colourPatch(S2.cleanPatch(S2.DEFAULT_PATCHES[kind]), i, kind));
    const sig = freqs.map((p) => p.layers.map((l) => `${l.freq}/${l.cutoff}`).join());
    ok2(new Set(sig).size === 5 && freqs.every((p) => S2.cleanPatch(p) && p.layers.every((l) => l.freq <= 8000 && l.cutoff <= 18000)), `slot colours: ${kind} sounds different in all five slots and stays in range`);
    // at least ~2 semitones apart in pitch between any two slots
    const pitch = S2.SLOT_COLOURS.map((c) => 12 * Math.log2(c.pitch)).sort((a, b) => a - b);
    ok2(pitch.every((v, i) => i === 0 || v - pitch[i - 1] >= 1.9), `slot colours: ${kind} pitches at least 2 semitones apart (more than a player's own ±7 % variation)`);
  }
  ok2(S2.colourPatch(S2.DEFAULT_PATCHES.nope, 3, 'nope') === S2.DEFAULT_PATCHES.nope && S2.slotColour(7) === S2.SLOT_COLOURS[2], 'slot colours: "nope" stays plain; slots wrap around');
}
console.log('Alla synth-tester gick igenom.');
process.exit(0);

