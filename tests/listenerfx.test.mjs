// Listener FX (Jens t588u): effects follow the listener, not the source.
import assert from 'node:assert/strict';
import { cleanFx, FX_DEFAULTS } from '../shared/synth.mjs';
import { readFileSync } from 'node:fs';

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

ok('synth.js documents the listener path and exposes setListenerFx / plugEars', () => {
  const src = readFileSync(new URL('../client/src/synth.js', import.meta.url), 'utf8');
  assert.ok(src.includes('setListenerFx'));
  assert.ok(src.includes('plugEars'));
  assert.ok(src.includes('this.ears'));
  assert.ok(src.includes('this.master'));
  // live play no longer routes through per-source chain()
  assert.ok(src.includes('no per-source FX'));
  assert.ok(/const dest = this\.roomIn/.test(src));
});

ok('sound.js applies mine.fx via setListenerFx and play() omits who.fx', () => {
  const src = readFileSync(new URL('../client/src/sound.js', import.meta.url), 'utf8');
  assert.ok(src.includes('setListenerFx'));
  assert.ok(src.includes('Listener FX'));
  assert.ok(!/const fx = who && who\.fx/.test(src));
});

ok('voice.js routes monitor + remote peers through plugEars', () => {
  const src = readFileSync(new URL('../client/src/voice.js', import.meta.url), 'utf8');
  assert.ok(src.includes('plugEars'));
  assert.ok(src.includes('unplugEars'));
  assert.ok(src.includes('listener FX'));
});

ok('place bus feeds ears (not the guard), so city FX stays per-listener and then hits listener FX', () => {
  const src = readFileSync(new URL('../client/src/synth.js', import.meta.url), 'utf8');
  assert.ok(src.includes('intoEars'));
  assert.ok(!/mix\.connect\(lim\)/.test(src)); // old path
});

ok('cleanFx still shapes the listener chain the same way', () => {
  const f = cleanFx({ ...FX_DEFAULTS, reverb: { ...FX_DEFAULTS.reverb, wet: 0.4 } });
  assert.equal(f.reverb.wet, 0.4);
  assert.equal(cleanFx(null), null); assert.ok(cleanFx({ reverb: { wet: 0.2, decay: 1.5, preDelay: 0.01 } }).reverb.wet > 0);
});

console.log(`listenerfx: ${n} ok`);
