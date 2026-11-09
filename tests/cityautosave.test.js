// Build-city autosave: ~3 s debounce, writes ONLY dirty city layers into the default preset.
const fs = require('fs'); const os = require('os'); const path = require('path');
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createCityPresets, AUTOSAVE_MS } = require('../server/citypresets');
const CITY = require('../shared/city.mjs');

const assert = (c, m, x) => { if (!c) throw new Error('FEL: ' + m + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 400) : '')); console.log('✔ ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  assert(AUTOSAVE_MS === 3000, `default autosave interval is 3000 ms (got ${AUTOSAVE_MS})`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-cityauto-'));
  const store = createStore(new LocalAdapter(dir), { log: { error() {}, log() {} } });
  await store.createRoom({ id: CITY.BUILD_CITY, type: 'stad', extra: { name: CITY.BUILD_CITY_NAME } });
  // Seed house 1 empty so a full snapshot would include it once started; leave it absent for now.
  const timers = { setTimeout, clearTimeout };
  const cp = createCityPresets(store, { autosaveMs: 80, log: { error() {}, log() {} }, timers }); // fast for the test
  assert(cp.autosaveMs === 80, 'autosaveMs is injectable for tests');

  // First change: mark outside dirty, wait for debounce, flush writes a new default with outside only.
  assert(cp.autosave(CITY.BUILD_CITY) === true, 'autosave accepts the build city outside');
  assert(cp.pending() === true && cp.dirtyLayers().includes('outside'), 'outside is dirty after a change');
  await sleep(120);
  await sleep(20);
  let d = await cp.getDefault();
  assert(d && d.default && d.layers.outside && !d.layers['1'], 'first autosave created the default preset from the outside only', d && d.layers);

  // Start house 1 with a sticker, touch only that house: outside layer in the preset must stay untouched
  // while house 1 appears.
  await store.createRoom({ id: CITY.houseId(CITY.BUILD_CITY, 1), type: 'stad', extra: { house: 1, city: CITY.BUILD_CITY } });
  await store.addStamp(CITY.houseId(CITY.BUILD_CITY, 1), {
    imageId: 'img000000000001', position: [0, 1, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.2, surface: 'vägg-norr',
  });
  // Put a marker sticker on the outside so we can prove it is NOT re-read away if we only dirty house 1
  // (and also prove partial merge keeps previous outside).
  await store.addStamp(CITY.BUILD_CITY, {
    imageId: 'img000000000002', position: [1, 0, 10], normal: [0, 1, 0], quaternion: [0, 0, 0, 1], size: 1, surface: 'golv',
  });
  // Force a full save so outside has the marker, then dirty ONLY house 1.
  await cp.saveDefault();
  d = await cp.getDefault();
  const outsideBefore = (d.layers.outside.stamps || []).length;
  assert(outsideBefore >= 1, 'outside has the marker sticker after full save', outsideBefore);

  assert(cp.autosave(CITY.houseId(CITY.BUILD_CITY, 1)) === true, 'autosave accepts a build-city house');
  assert(cp.dirtyLayers().length === 1 && cp.dirtyLayers()[0] === '1', 'only house layer 1 is dirty', cp.dirtyLayers());
  await sleep(120);
  d = await cp.getDefault();
  assert((d.layers.outside.stamps || []).length === outsideBefore, 'partial autosave did not rewrite the outside layer', d.layers.outside);
  assert((d.layers['1'].stamps || []).length === 1, 'house 1 layer was written', d.layers['1']);

  // Non-build city must not dirty the preset.
  assert(cp.autosave('stad-zzzzzz') === false && cp.pending() === false, 'a play city does not trigger build-city autosave');

  console.log('\ncityautosave: all ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
