// Layer LFO ask-button mapping (Jens t600u)
import assert from 'assert';
import { SLIDER_TO_LFO, lfoSliderFor } from '../client/src/soundui.js';

assert.equal(SLIDER_TO_LFO.freq, 'pitch');
assert.equal(SLIDER_TO_LFO.note, 'pitch');
assert.equal(SLIDER_TO_LFO.cutoff, 'cutoff');
assert.equal(SLIDER_TO_LFO.level, 'amp');
assert.equal(SLIDER_TO_LFO.q, undefined, 'non-targetable sliders stay out of the ask map');

assert.equal(lfoSliderFor({ kind: 'osc' }, 'pitch'), 'freq');
assert.equal(lfoSliderFor({ kind: 'sampler' }, 'pitch'), 'note');
assert.equal(lfoSliderFor({ kind: 'noise' }, 'cutoff'), 'cutoff');
assert.equal(lfoSliderFor({ kind: 'osc' }, 'amp'), 'level');
assert.equal(lfoSliderFor({ kind: 'osc' }, 'none'), null);
assert.equal(lfoSliderFor({ kind: 'osc' }, 'nope'), null);

console.log('lfoask: mapping ok');
