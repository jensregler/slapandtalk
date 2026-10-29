// Size prefix: a letter + underscore at the start of the file name sets the starting size (shared/sizeprefix.mjs),
// for uploads (server image record), the curated library (tools/import-library.mjs → /api/library).
// Tests the free/full split, so OPEN ACCESS (shared/openaccess.mjs) is off here unless OPEN_ACCESS is set.
process.env.OPEN_ACCESS ??= '0';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { parsePrefix, letterCm, startHeightCm, stripPrefix, startSizeCm, designStartCm, isStartCm, baseName, DEFAULT_START_CM } from '../shared/sizeprefix.mjs';

const require = createRequire(import.meta.url);
let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };

await ok('mapping: A = 15 cm, B = 17.5, C = 20 … Z = 77.5 (15 + index × 2.5)', () => {
  assert.equal(letterCm('A'), 15); assert.equal(letterCm('b'), 17.5); assert.equal(letterCm('C'), 20); assert.equal(letterCm('D'), 22.5);
  assert.equal(letterCm('Z'), 77.5); assert.equal(letterCm('1'), null); assert.equal(letterCm(''), null);
  for (let i = 0; i < 26; i++) assert.equal(letterCm(String.fromCharCode(65 + i)), 15 + i * 2.5);
});
await ok('parsing: one letter + "_" + a letter or digit, any case; "-", space and ordinary names are not prefixes', () => {
  const yes = { 'A_sticker.png': 'A', 'b_sticker.png': 'B', 'z_9lives.png': 'Z', 'dir/sub/E_x.png': 'E', 'C:\\pics\\F_x.png': 'F', 'G_Ulla - cat.png': 'G', 'H_å.png': 'H' };
  for (const [name, L] of Object.entries(yes)) assert.equal(parsePrefix(name)?.letter, L, name);
  for (const name of ['b-cat.png', 'C cat.png', 'D-cat.webp', 'Apple.png', 'A.png', 'A_.png', 'A__cat.png', 'A - cat.png', 'AB_cat.png', '1_cat.png', '_A_cat.png', 'Ä_cat.png', 'cat_A.png', '', null, 'A-.png', 'A .png'])
    assert.equal(parsePrefix(name), null, String(name));
  assert.equal(baseName('x/y/B_cat.final.png'), 'B_cat.final');
});
await ok('default: no prefix = 30 cm (the original start size, = G_); A_ still 15', () => {
  assert.equal(DEFAULT_START_CM, 30); assert.equal(startHeightCm('cat.png'), 30); assert.equal(startHeightCm('b-cat.png'), 30); assert.equal(startHeightCm('A_cat.png'), 15); assert.equal(startHeightCm('B_cat.png'), 17.5);
  assert.equal(designStartCm({}), 30); assert.equal(designStartCm({ startCm: 17.5 }), 17.5); assert.equal(designStartCm({ source: 'Z_x.png' }), 77.5); assert.equal(designStartCm({ source: 'cat.png' }), 30);
  assert.equal(designStartCm({ startCm: 18 }), 30, 'only the 26 letter sizes count'); assert.equal(designStartCm({ startCm: 7.5 }), 30, 'old scale values are not letter sizes'); assert.equal(designStartCm({ startCm: 400 }), 30);
  assert.ok(isStartCm(15) && isStartCm(30) && isStartCm(77.5) && !isStartCm(10) && !isStartCm(80) && !isStartCm(NaN) && !isStartCm('15'));
});
await ok('the prefix is not part of the name', () => {
  assert.equal(stripPrefix('B_Ulla - cat.png'), 'Ulla - cat.png'); assert.equal(stripPrefix('dir/C_cat.png'), 'dir/cat.png');
  assert.equal(stripPrefix('C cat.png'), 'C cat.png'); assert.equal(stripPrefix('Apple.png'), 'Apple.png'); assert.equal(stripPrefix('A - cat.png'), 'A - cat.png');
});
await ok('held size = the letter value (the longest side, what the size slider shows), for every aspect; free 15 cm – 1 m clamp; full no cap', () => {
  assert.equal(startSizeCm({ startCm: 17.5, width: 100, height: 100 }), 17.5);
  assert.equal(startSizeCm({ startCm: 20, width: 100, height: 400 }), 20, 'portrait');
  assert.equal(startSizeCm({ startCm: 20, width: 400, height: 100 }), 20, 'landscape: the letter value is the longest side, not height × aspect');
  assert.equal(startSizeCm({ startCm: 77.5, width: 300, height: 100 }, { minCm: 15, maxCm: 100 }), 77.5);
  assert.equal(startSizeCm({ startCm: 77.5 }, { maxCm: 50 }), 50, 'max clamp');
  assert.equal(startSizeCm({ startCm: 15 }, { minCm: 20 }), 20, 'min clamp');
  assert.equal(startSizeCm({ startCm: 77.5 }, { minCm: 5, maxCm: Infinity }), 77.5, 'full version: no upper cap');
  assert.equal(startSizeCm({ width: 333, height: 100 }), 30, 'no prefix: 30 cm');
  assert.equal(startSizeCm({}, { minCm: 15, maxCm: 100 }), 30, 'free limits allow the 30 cm default');
});

// ---------- API: uploads and the library ----------
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { loadLibrary } = require('../server/library');
const { makeEntitlements } = require('../server/entitlements');
const { importFolder, artistFor } = await import('../tools/import-library.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-size-'));
try {
  const png = (hex, w = 40, h = 40) => sharp({ create: { width: w, height: h, channels: 4, background: hex } }).png().toBuffer();
  const src = path.join(tmp, 'src'); fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'B_Ulla - cat.png'), await png('#ff0000'));
  fs.writeFileSync(path.join(src, 'Apple.png'), await png('#00ff00'));
  fs.writeFileSync(path.join(src, 'z_wide.png'), await png('#0000ff', 120, 40));
  fs.writeFileSync(path.join(src, 'c-dash.png'), await png('#00ffff'));
  const out = path.join(tmp, 'lib');
  await importFolder({ folder: src, out, csv: null, artist: '', replace: false, dry: false }, () => {});
  const man = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  const by = Object.fromEntries(man.stickers.map((s) => [s.source, s]));
  await ok('import: startCm in the manifest from the prefix (none, or a dash, = 30), prefix not in the artist name', () => {
    assert.equal(by['B_Ulla - cat.png'].startCm, 17.5); assert.equal(by['B_Ulla - cat.png'].artist, 'Ulla');
    assert.equal(by['Apple.png'].startCm, 30); assert.equal(by['z_wide.png'].startCm, 77.5); assert.equal(by['c-dash.png'].startCm, 30);
    assert.equal(artistFor('C_Bo__dog.png').artist, 'Bo');
  });
  // An entry imported before this feature (no startCm): re-derived from its original name.
  delete by['z_wide.png'].startCm; fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(man));
  const store = createStore(new LocalAdapter(path.join(tmp, 'data')), { writeDelayMs: 20, log: { error() {}, log() {} } });
  const KEY = 'size-test-key-123456';
  const app = createApp(store, { quickTtlHours: 24, log: { error() {}, log() {} }, library: loadLibrary(out), entitle: makeEntitlements({ FULL_ACCESS_KEYS: KEY }) });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const lib = (await (await fetch(`${base}/api/library`)).json()).stickers;
    const lb = Object.fromEntries(lib.map((s) => [s.id, s]));
    await ok('GET /api/library: each sticker has its startCm (also an older entry, from its original name)', () => {
      assert.equal(lb[by['B_Ulla - cat.png'].id].startCm, 17.5); assert.equal(lb[by['Apple.png'].id].startCm, 30); assert.equal(lb[by['z_wide.png'].id].startCm, 77.5);
      assert.ok(!('source' in lb[by['Apple.png'].id]), 'the file name itself is not sent');
    });
    const up = async (buf, fields = {}, fileName = 'klibba.png') => {
      const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      fd.append('file', new Blob([buf], { type: 'image/png' }), fileName);
      return (await fetch(`${base}/api/stickers`, { method: 'POST', body: fd })).json();
    };
    const d1 = await up(await png('#123456'), { name: 'D_hat.png' });
    const plain = await up(await png('#654321'), { name: 'hat.png' });
    const byFile = await up(await png('#abcdef'), {}, 'E_file.png');
    const dashed = await up(await png('#aabbcc'), {}, 'E-file.png');
    const restored = await up(await png('#fedcba'), { startCm: '22.5' });
    const junk = await up(await png('#0f0f0f'), { startCm: '400' });
    await ok('upload: the server derives startCm from the name the web app sends (or the file name), default 30', async () => {
      assert.equal(d1.startCm, 22.5); assert.equal(plain.startCm, 30); assert.equal(byFile.startCm, 25); assert.equal(dashed.startCm, 30, 'a dash is no prefix');
      assert.equal(restored.startCm, 22.5, 're-upload of a lost design keeps its start size'); assert.equal(junk.startCm, 30, 'only letter sizes are taken from the client');
      const meta = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'images', `${d1.id}.json`), 'utf8'));
      assert.equal(meta.startCm, 22.5, 'stored on the image record');
    });
    await ok('the same picture renamed with another prefix gets the new size; without a prefix it keeps it', async () => {
      const again = await up(await png('#123456'), { name: 'A_hat.png' });
      const same = await up(await png('#123456'), { name: 'hat-copy.png' });
      assert.equal(again.id, d1.id); assert.equal(again.startCm, 15); assert.equal(same.startCm, 15);
    });
    await ok('slap: the free version is clamped up to 15 cm (and down to 1 m); the full version keeps 5 cm; in between untouched', async () => {
      const slap = async (size, key) => (await (await fetch(`${base}/api/rooms/sizes/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'x-unlock': key } : {}) },
        body: JSON.stringify({ imageId: d1.id, position: [0, 1, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size, surface: 'vägg-norr' }) })).json()).stamp.size;
      const r = { f5: await slap(0.05), f10: await slap(0.1), f145: await slap(0.145), f20: await slap(0.2), f3: await slap(3), k5: await slap(0.05, KEY), k3: await slap(3, KEY) };
      assert.deepEqual(r, { f5: 0.15, f10: 0.15, f145: 0.145, f20: 0.2, f3: 1, k5: 0.05, k3: 3 }, JSON.stringify(r));
      const tiny = await (await fetch(`${base}/api/rooms/sizes/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageId: d1.id, position: [0, 1, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.01, surface: 'vägg-norr' }) })).status;
      assert.equal(tiny, 400, 'below 2 cm is still invalid');
    });
  } finally { server.close(); }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`sizeprefix: ${n} passed`);
