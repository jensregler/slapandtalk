// Noise room lights (Jens t892u): the settings model – defaults = the t875u look, clean / JSON round trip, the envelope.
import assert from 'node:assert/strict';
import { LAMP } from '../client/src/noisespeakers.js';
import { defaultLights, cleanLights, lightsToText, lightsFromText, loadLights, saveLights, isDefaultLights, envTarget, envStep, coef, lampLevel, lampFactor, restFactor, bandFilter, LAMP_IDS, ENV_SPEC, LAMP_SPEC, LIGHTS_KEY } from '../client/src/noiselights.js';
let n = 0; const ok = (name, f) => { f(); n++; console.log('  ✓ ' + name); };
const d = defaultLights();
ok('defaults = the old look: every 33 ms, full at RMS 0.2, glow 0.35 … 1.5, warm white, decay 1.6, NW/SW ← A, NE/SE ← B', () => {
  assert.equal(d.env.updateMs, LAMP.everyMs); assert.equal(d.env.full, LAMP.full);
  assert.deepEqual(LAMP_IDS, ['NW', 'NE', 'SW', 'SE']);
  for (const id of LAMP_IDS) { const l = d.lamps[id]; assert.equal(l.min, LAMP.min); assert.equal(l.max, LAMP.max); assert.equal(l.color, '#fff4e0'); assert.equal(l.decay, 1.6); assert.equal(l.reach, 1); assert.equal(l.on, true); assert.equal(l.invert, false); assert.equal(l.hue, 0); }
  assert.deepEqual(LAMP_IDS.map((id) => d.lamps[id].source), ['A', 'B', 'A', 'B']);
  assert.equal(d.env.band, 'full'); assert.equal(d.env.window, 512); assert.equal(d.env.gainDb, 0); assert.equal(d.env.threshold, 0); assert.equal(d.env.curve, 1); assert.equal(d.env.holdMs, 0); assert.equal(d.env.smoothMs, 0); assert.equal(d.env.master, 1); assert.equal(d.env.rest, 1);
});
ok('attack 36 ms / release 258 ms at a 33 ms tick = the old 60 % up / 12 % down per tick (within 0.1 %)', () => {
  assert.ok(Math.abs(coef(d.env.attackMs, 33) - LAMP.attack) < 1e-3); assert.ok(Math.abs(coef(d.env.releaseMs, 33) - LAMP.release) < 1e-3);
});
ok('default envelope over a burst = the old formula, tick by tick', () => {
  const st = { level: 0, out: 0, holdUntil: 0 }; let old = 0;
  const rmss = [0, 0.05, 0.3, 0.3, 0.1, 0, 0, 0, 0.15, 0.02, 0, 0];
  rmss.forEach((rms, k) => {
    const t = Math.min(1, rms / LAMP.full); old += (t - old) * (t > old ? LAMP.attack : LAMP.release);
    const now = envStep(st, envTarget(rms, d.env), 33, k * 33, d.env);
    assert.ok(Math.abs(now - old) < 2e-3, `tick ${k}: ${now} vs ${old}`);
    const lamp = d.lamps.NW, f = lampFactor(lamp, lampLevel(lamp, { A: now, B: 0 }), d.env);
    assert.ok(Math.abs(f - (LAMP.min + (LAMP.max - LAMP.min) * old)) < 3e-3);
  });
});
ok('gain / threshold / ceiling / curve shape the target', () => {
  const e = { ...d.env, gainDb: 6.0206, threshold: 0.1, full: 0.5, curve: 2 };
  assert.ok(Math.abs(envTarget(0.05, e) - 0) < 1e-6); // 0.1 after gain = floor
  assert.ok(Math.abs(envTarget(0.15, e) - 0.25) < 1e-3); // 0.3 → (0.2/0.4)^2
  assert.equal(envTarget(1, e), 1);
});
ok('hold keeps the peak, smoothing slows the shown level', () => {
  const e = { ...d.env, holdMs: 100 }; const st = { level: 0, out: 0, holdUntil: 0 };
  envStep(st, 1, 1000, 0, e); const top = st.level; envStep(st, 0, 33, 50, e); assert.equal(st.level, top); envStep(st, 0, 33, 150, e); assert.ok(st.level < top);
  const s2 = { level: 0, out: 0, holdUntil: 0 }; const shown = envStep(s2, 1, 33, 0, { ...d.env, smoothMs: 200 }); assert.ok(shown < s2.level);
});
ok('sources: A, B, the louder of both, none; invert; off = dark; outside = rest × master', () => {
  const lv = { A: 0.2, B: 0.7 }, L = (o) => ({ ...d.lamps.NW, ...o });
  assert.equal(lampLevel(L({ source: 'A' }), lv), 0.2); assert.equal(lampLevel(L({ source: 'B' }), lv), 0.7); assert.equal(lampLevel(L({ source: 'mix' }), lv), 0.7); assert.equal(lampLevel(L({ source: 'none' }), lv), 0);
  assert.ok(Math.abs(lampLevel(L({ source: 'A', invert: true }), lv) - 0.8) < 1e-9);
  assert.equal(lampFactor(L({ on: false }), 1, d.env), 0); assert.equal(restFactor(L({}), d.env), 1); assert.equal(restFactor(L({}), { ...d.env, rest: 0.5, master: 2 }), 1);
});
ok('clean: out-of-range clamps, junk → defaults, short colours expand, unknown keys dropped', () => {
  const c = cleanLights({ env: { attackMs: -5, releaseMs: 99999, band: 'nope', window: '1024', junk: 1 }, lamps: { NE: { color: 'f0a', min: '0.5', source: 'mix', on: false }, XX: {} } });
  assert.equal(c.env.attackMs, ENV_SPEC.attackMs.min); assert.equal(c.env.releaseMs, ENV_SPEC.releaseMs.max); assert.equal(c.env.band, 'full'); assert.equal(c.env.window, 1024); assert.equal(c.env.junk, undefined);
  assert.equal(c.lamps.NE.color, '#ff00aa'); assert.equal(c.lamps.NE.min, 0.5); assert.equal(c.lamps.NE.source, 'mix'); assert.equal(c.lamps.NE.on, false); assert.equal(c.lamps.XX, undefined);
  assert.deepEqual(cleanLights(null), d); assert.deepEqual(cleanLights('x'), d);
});
ok('text round trip (also with chat text around it), bad text throws', () => {
  const s = cleanLights({ env: { releaseMs: 900 }, lamps: { SW: { color: '#00e5ff', max: 4 } } });
  const t = lightsToText(s); assert.ok(t.includes('"noiseLights"'));
  assert.deepEqual(lightsFromText(t), s); assert.deepEqual(lightsFromText('Hej Ulla! ' + t + ' /Jens'), s);
  assert.deepEqual(lightsFromText(JSON.stringify(s)), s);
  assert.throws(() => lightsFromText('')); assert.throws(() => lightsFromText('hello')); assert.throws(() => lightsFromText('{"a":1}'));
});
ok('localStorage: defaults are not stored, changes are, junk reads as defaults', () => {
  const m = new Map(), store = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  saveLights(d, store); assert.equal(m.has(LIGHTS_KEY), false); assert.ok(isDefaultLights(loadLights(store)));
  const s = cleanLights({ lamps: { NW: { color: '#ff2a2a' } } }); saveLights(s, store); assert.deepEqual(loadLights(store), s);
  m.set(LIGHTS_KEY, '{oops'); assert.deepEqual(loadLights(store), d);
});
ok('every range holds its default; band filter: full = allpass', () => {
  for (const s of [...Object.values(ENV_SPEC), ...Object.values(LAMP_SPEC)]) assert.ok(s.def >= s.min && s.def <= s.max, s.label);
  assert.equal(bandFilter(d.env).type, 'allpass'); assert.deepEqual(bandFilter({ ...d.env, band: 'low', bandHz: 150 }), { type: 'lowpass', frequency: 150, Q: 0.707 });
});
console.log(`noiselights: ${n} ok`);
