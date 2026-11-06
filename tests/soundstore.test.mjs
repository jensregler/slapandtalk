// Personal sound settings store: follow room→city; reset on a new room / Exit-to-menu.
// Run: node tests/soundstore.test.mjs
import assert from 'node:assert/strict';

const store = (map) => ({
  getItem: (k) => (map.has(k) ? map.get(k) : null),
  setItem: (k, v) => { map.set(String(k), String(v)); },
  removeItem: (k) => { map.delete(String(k)); },
  clear: () => { map.clear(); },
  key: (i) => [...map.keys()][i] ?? null,
  get length() { return map.size; },
});
const ls = new Map(), ss = new Map();
globalThis.localStorage = store(ls);
globalThis.sessionStorage = store(ss);
// Fake IDB so samples.js does not crash on import.
globalThis.indexedDB = { open() { const r = { result: { objectStoreNames: { contains: () => false }, createObjectStore() { return { createIndex() {} }; }, transaction() { return { objectStore() { return { put() {}, get() { return { onsuccess: null }; }, delete() {}, clear() {}, openCursor() { return { onsuccess: null }; } }; }, oncomplete: null }; } }, onupgradeneeded: null, onsuccess: null, onerror: null }; queueMicrotask(() => { r.onsuccess && r.onsuccess({ target: r }); }); return r; } };

const { setSoundRoom, soundKey, loadSoundLook, saveSoundLook, resetPersonalSound, prepareSoundForPlace,
  personalGet, personalSet, PERSONAL_SOUND_KEYS, VOICE_FX_KEY, VOICE_MON_KEY, SOUND_SCOPE_KEY,
} = await import('../client/src/soundui.js');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

ok('soundKey is always the global visit key, even after setSoundRoom', () => {
  assert.equal(soundKey(), 'klibb.sound');
  setSoundRoom('rum-abc');
  assert.equal(soundKey(), 'klibb.sound');
  setSoundRoom('stad');
  assert.equal(soundKey(), 'klibb.sound');
});

ok('save/load sound look round-trips on the global key (never per-room)', () => {
  const layer = { kind: 'osc', wave: 'sine', freq: 220, detune: 0, unison: 1, drive: 0, sub: 0,
    a: 0.01, d: 0.1, s: 0, r: 0.1, hold: 0.05, level: 0.8, delay: 0,
    filter: 'lowpass', cutoff: 4000, q: 0.7, fEnv: 0, fTime: 0.1, pitchAmt: 0, pitchTime: 0.1, lfoRate: 0, lfoDepth: 0 };
  const saved = saveSoundLook({ patches: { slap: { v: 1, gain: 0.5, layers: [layer] } }, fx: null });
  assert.ok(saved.patches?.slap, JSON.stringify(saved));
  assert.ok(sessionStorage.getItem('klibb.sound'));
  assert.equal(sessionStorage.getItem('klibb.sound@rum-abc'), null);
  const loaded = loadSoundLook();
  assert.ok(loaded.patches?.slap);
  assert.equal(loaded.seed, loadSoundLook().seed);
});

ok('voice FX / monitor keys are part of PERSONAL_SOUND_KEYS and clear on reset', () => {
  assert.ok(PERSONAL_SOUND_KEYS.includes(VOICE_FX_KEY));
  assert.ok(PERSONAL_SOUND_KEYS.includes(VOICE_MON_KEY));
  personalSet(VOICE_FX_KEY, JSON.stringify({ on: true, kind: 'echo', amount: 0.8 }));
  personalSet(VOICE_MON_KEY, JSON.stringify({ on: true, vol: 0.5, raw: true }));
  personalSet('klibb.musicVol', '0.4');
  personalSet('klibb.sound', '{"patches":{}}');
  personalSet(SOUND_SCOPE_KEY, 'room:abc');
  resetPersonalSound();
  assert.equal(personalGet(VOICE_FX_KEY), null);
  assert.equal(personalGet(VOICE_MON_KEY), null);
  assert.equal(personalGet('klibb.musicVol'), null);
  assert.equal(personalGet('klibb.sound'), null);
  assert.equal(personalGet(SOUND_SCOPE_KEY), null);
});

ok('fresh room entry (no scope) resets leftovers and sets room scope', () => {
  personalSet('klibb.sound', '{"patches":{"slap":{}}}');
  personalSet('klibb.musicVol', '0.2');
  personalSet(VOICE_FX_KEY, '{"on":true}');
  sessionStorage.setItem('klibb.radio@old', '{"knob":0.5}');
  const r = prepareSoundForPlace({ kind: 'room', id: 'rum-1' });
  assert.equal(r.reset, true);
  assert.equal(personalGet('klibb.sound'), null);
  assert.equal(personalGet('klibb.musicVol'), null);
  assert.equal(personalGet(VOICE_FX_KEY), null);
  assert.equal(sessionStorage.getItem('klibb.radio@old'), null);
  assert.equal(personalGet(SOUND_SCOPE_KEY), 'room:rum-1');
});

ok('reload of the SAME room keeps settings', () => {
  personalSet('klibb.sound', '{"patches":{"slap":{"v":1}}}');
  personalSet('klibb.musicVol', '0.55');
  personalSet(VOICE_FX_KEY, JSON.stringify({ on: true, kind: 'chorus', amount: 0.4 }));
  personalSet(SOUND_SCOPE_KEY, 'room:rum-1');
  const r = prepareSoundForPlace({ kind: 'room', id: 'rum-1' });
  assert.equal(r.reset, false);
  assert.ok(personalGet('klibb.sound'));
  assert.equal(personalGet('klibb.musicVol'), '0.55');
  assert.ok(personalGet(VOICE_FX_KEY));
  assert.equal(personalGet(SOUND_SCOPE_KEY), 'room:rum-1');
});

ok('room → city keeps settings and marks city scope', () => {
  personalSet('klibb.sound', '{"patches":{"slap":{"v":1}}}');
  personalSet(VOICE_MON_KEY, JSON.stringify({ on: true, vol: 0.7, raw: true }));
  personalSet(SOUND_SCOPE_KEY, 'room:rum-1');
  const r = prepareSoundForPlace({ kind: 'city', id: 'stad-abc' });
  assert.equal(r.reset, false);
  assert.ok(personalGet('klibb.sound'));
  assert.ok(personalGet(VOICE_MON_KEY));
  assert.equal(personalGet(SOUND_SCOPE_KEY), 'city:stad-abc');
});

ok('city → new room resets to defaults', () => {
  personalSet('klibb.sound', '{"patches":{"slap":{"v":1}}}');
  personalSet('klibb.musicVol', '0.3');
  personalSet(VOICE_FX_KEY, '{"on":true,"kind":"echo"}');
  personalSet(VOICE_MON_KEY, '{"on":true}');
  personalSet(SOUND_SCOPE_KEY, 'city:stad-abc');
  const r = prepareSoundForPlace({ kind: 'room', id: 'rum-2' });
  assert.equal(r.reset, true);
  assert.equal(personalGet('klibb.sound'), null);
  assert.equal(personalGet('klibb.musicVol'), null);
  assert.equal(personalGet(VOICE_FX_KEY), null);
  assert.equal(personalGet(VOICE_MON_KEY), null);
  assert.equal(personalGet(SOUND_SCOPE_KEY), 'room:rum-2');
});

ok('moving to a different room (no city) also resets', () => {
  personalSet('klibb.sound', '{"fx":{}}');
  personalSet(SOUND_SCOPE_KEY, 'room:rum-2');
  const r = prepareSoundForPlace({ kind: 'room', id: 'rum-3' });
  assert.equal(r.reset, true);
  assert.equal(personalGet('klibb.sound'), null);
  assert.equal(personalGet(SOUND_SCOPE_KEY), 'room:rum-3');
});

console.log(`\nsoundstore: ${n} passed`);
