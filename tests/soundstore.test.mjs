// Personal sound settings store: global for the visit (not per-room), Exit-to-menu clears.
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

const { setSoundRoom, soundKey, loadSoundLook, saveSoundLook, resetPersonalSound, personalGet, personalSet,
  PERSONAL_SOUND_KEYS, VOICE_FX_KEY, VOICE_MON_KEY } = await import('../client/src/soundui.js');

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
  // minimal valid slap patch (cleanPatch accepts DEFAULT-like shapes)
  const layer = { kind: 'osc', wave: 'sine', freq: 220, detune: 0, unison: 1, spread: 0, sub: 0,
    a: 0.01, d: 0.1, s: 0, r: 0.1, hold: 0.05, level: 0.8, drive: 0, delay: 0,
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
  resetPersonalSound();
  assert.equal(personalGet(VOICE_FX_KEY), null);
  assert.equal(personalGet(VOICE_MON_KEY), null);
  assert.equal(personalGet('klibb.musicVol'), null);
  assert.equal(personalGet('klibb.sound'), null);
});

console.log(`\nsoundstore: ${n} passed`);
