// Site sample library (Jens t964u): packed files, ids, and how a library reference is stored and shared.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIBRARY_IDS, LIBRARY_GROUPS, libraryName, libraryGroupOf } from '../shared/samplelib.mjs';
import { cleanLayer, cleanPatch, cleanSound, cleanLibraryId, cleanSampleLib, sampleLibFromPatches, applySampleLib, morphPatch, DEFAULT_PATCHES, SYNTH } from '../shared/synth.mjs';

let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'client/public/sample-lib');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));

ok('manifest lists every packed wav, 37 samples in Bass / Hat / snare / Other, ids match LIBRARY_IDS', () => {
  assert.equal(manifest.version, 1);
  assert.equal(manifest.format, 'wav');
  const ids = manifest.groups.flatMap((g) => g.samples.map((s) => s.id));
  assert.deepEqual(ids, [...LIBRARY_IDS]);
  assert.equal(ids.length, 37);
  assert.deepEqual(manifest.groups.map((g) => [g.id, g.samples.length]), [['bass', 16], ['hatsnare', 8], ['other', 13]]);
  let bytes = 0;
  for (const g of manifest.groups) for (const s of g.samples) {
    const f = path.join(DIR, s.file);
    assert.ok(fs.existsSync(f), s.file);
    const st = fs.statSync(f);
    assert.equal(st.size, s.bytes);
    const buf = fs.readFileSync(f);
    assert.equal(buf.slice(0, 4).toString(), 'RIFF');
    assert.equal(buf.slice(8, 12).toString(), 'WAVE');
    assert.ok(s.len > 0 && s.len < 2, s.id + ' ' + s.len);
    bytes += st.size;
  }
  assert.ok(bytes === 1200612, 'wav bytes ' + bytes);
});

ok('library names and groups stay readable', () => {
  assert.equal(libraryName('bass-14'), 'Bass 14');
  assert.equal(libraryName('hat-1'), 'Hat 1');
  assert.equal(libraryName('other-13'), 'Other 13');
  assert.equal(libraryGroupOf('hat-8')?.id, 'hatsnare');
  assert.equal(LIBRARY_GROUPS.length, 3);
});

ok('cleanLibraryId: only bass-1 / hat-8 / other-13 style ids; junk dropped', () => {
  assert.equal(cleanLibraryId('Bass-3'), 'bass-3');
  assert.equal(cleanLibraryId('  hat-8 '), 'hat-8');
  assert.equal(cleanLibraryId('other-13'), 'other-13');
  assert.equal(cleanLibraryId('bass-0'), '');
  assert.equal(cleanLibraryId('lib:bass-1'), '');
  assert.equal(cleanLibraryId('../bass-1'), '');
  assert.equal(cleanLibraryId('bass/bass-1'), '');
  assert.equal(cleanLibraryId(''), '');
});

ok('cleanLayer keeps a library id (and a hash) on sampler layers; junk library dropped; osc layers stay unchanged', () => {
  const l = cleanLayer({ kind: 'sampler', library: 'Bass-3', name: 'Bass 3', len: 0.3 });
  assert.equal(l.library, 'bass-3'); assert.equal(l.sample, ''); assert.equal(l.name, 'Bass 3');
  assert.equal(cleanLayer({ kind: 'sampler', library: 'nope' }).library, undefined);
  const hashed = cleanLayer({ kind: 'sampler', sample: 'a'.repeat(64), library: 'hat-2' });
  assert.equal(hashed.sample, 'a'.repeat(64)); assert.equal(hashed.library, 'hat-2');
  const osc = cleanLayer({ kind: 'osc', wave: 'sine', freq: 220 });
  assert.ok(!('library' in osc) && !('sample' in osc));
});

ok('cleanSound: sampleLib is kept even without custom patches; junk ids dropped; free look without sampleLib is still just the seed', () => {
  const free = cleanSound({ seed: 'abcd1234', sampleLib: { step: ['bass-3', 'NOPE'], slap: 'hat-1' } });
  assert.deepEqual(free, { seed: 'abcd1234', sampleLib: { step: ['bass-3'], slap: ['hat-1'] } });
  assert.deepEqual(cleanSound({ seed: 'abcd1234' }), { seed: 'abcd1234' });
  const paid = cleanSound({ seed: 'abcd1234', patches: { step: { layers: [{ kind: 'sampler', library: 'other-4', name: 'Other 4' }] } } }, { custom: true });
  assert.equal(paid.patches.step.layers[0].library, 'other-4');
  assert.deepEqual(paid.sampleLib, { step: ['other-4'] });
  assert.deepEqual(sampleLibFromPatches(paid.patches), { step: ['other-4'] });
});

ok('applySampleLib: re-points my sampler layer, or adds one so I hear their library sample', () => {
  const mine = { seed: 'abcd1234', patches: { step: cleanPatch({ layers: [{ kind: 'sampler', library: 'bass-1', name: 'Bass 1', level: 0.5 }] }) } };
  const a = applySampleLib(mine, { step: ['hat-4'] });
  assert.equal(a.patches.step.layers[0].library, 'hat-4');
  const def = { seed: 'zzzzzzzz', patches: { step: DEFAULT_PATCHES.step } };
  const b = applySampleLib(def, { step: ['other-2'] });
  assert.ok(b.patches.step.layers.some((l) => l.kind === 'sampler' && l.library === 'other-2'));
  assert.ok(b.patches.step.layers.some((l) => l.kind === 'noise')); // my default scuff stays
  assert.equal(applySampleLib(mine, { step: ['../x'] }).patches.step.layers[0].library, 'bass-1');
});

ok('morph: library id follows the sample at the halfway flip', () => {
  const a = cleanPatch({ layers: [{ kind: 'sampler', library: 'bass-1', name: 'Bass 1', sample: 'b'.repeat(64) }] });
  const b = cleanPatch({ layers: [{ kind: 'sampler', library: 'hat-2', name: 'Hat 2', sample: 'c'.repeat(64) }] });
  assert.equal(morphPatch(a, b, 0.4).layers[0].library, 'bass-1');
  assert.equal(morphPatch(a, b, 0.6).layers[0].library, 'hat-2');
  assert.ok(JSON.stringify(a).length < SYNTH.maxPatchBytes);
});

ok('cleanSampleLib clamps to known kinds and max layers', () => {
  assert.equal(cleanSampleLib(null), null);
  assert.equal(cleanSampleLib({ nope: ['bass-1'] }), null);
  const many = Array.from({ length: 9 }, (_, i) => 'bass-' + (i + 1));
  assert.equal(cleanSampleLib({ step: many }).step.length, SYNTH.maxLayers);
});

console.log(`samplelib.test: ${n} ok`);
