// Size prefix: a letter at the start of the file name sets the starting height (shared/sizeprefix.mjs),
// for uploads (server image record), the curated library (tools/import-library.mjs → /api/library).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { parsePrefix, letterCm, startHeightCm, stripPrefix, startSizeCm, designStartCm, isStartCm, baseName, DEFAULT_START_CM } from '../shared/sizeprefix.mjs';

const require = createRequire(import.meta.url);
let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };

await ok('mapping: A = 5 cm, B = 7.5, C = 10 … Z = 67.5 (5 + index × 2.5)', () => {
  assert.equal(letterCm('A'), 5); assert.equal(letterCm('b'), 7.5); assert.equal(letterCm('C'), 10); assert.equal(letterCm('D'), 12.5);
  assert.equal(letterCm('Z'), 67.5); assert.equal(letterCm('1'), null); assert.equal(letterCm(''), null);
  for (let i = 0; i < 26; i++) assert.equal(letterCm(String.fromCharCode(65 + i)), 5 + i * 2.5);
});
await ok('parsing: one letter + "_" / "-" / space + a letter or digit, any case; ordinary names are not prefixes', () => {
  const yes = { 'A_sticker.png': 'A', 'b_sticker.png': 'B', 'C-cat.webp': 'C', 'D cat.jpg': 'D', 'z_9lives.png': 'Z', 'dir/sub/E_x.png': 'E', 'C:\\pics\\F_x.png': 'F', 'G_Ulla - cat.png': 'G', 'H_å.png': 'H' };
  for (const [name, L] of Object.entries(yes)) assert.equal(parsePrefix(name)?.letter, L, name);
  for (const name of ['Apple.png', 'A.png', 'A_.png', 'A__cat.png', 'A - cat.png', 'AB_cat.png', '1_cat.png', '_A_cat.png', 'Ä_cat.png', 'cat_A.png', '', null, 'A-.png', 'A .png'])
    assert.equal(parsePrefix(name), null, String(name));
  assert.equal(baseName('x/y/B_cat.final.png'), 'B_cat.final');
});
await ok('default: no prefix = 10 cm (C)', () => {
  assert.equal(DEFAULT_START_CM, 10); assert.equal(startHeightCm('cat.png'), 10); assert.equal(startHeightCm('Apple.png'), 10); assert.equal(startHeightCm('A_cat.png'), 5);
  assert.equal(designStartCm({}), 10); assert.equal(designStartCm({ startCm: 7.5 }), 7.5); assert.equal(designStartCm({ source: 'Z_x.png' }), 67.5);
  assert.equal(designStartCm({ startCm: 8 }), 10, 'only the 26 letter heights count'); assert.equal(designStartCm({ startCm: 400 }), 10);
  assert.ok(isStartCm(5) && isStartCm(67.5) && !isStartCm(70) && !isStartCm(NaN) && !isStartCm('10'));
});
await ok('the prefix is not part of the name', () => {
  assert.equal(stripPrefix('B_Ulla - cat.png'), 'Ulla - cat.png'); assert.equal(stripPrefix('dir/C cat.png'), 'dir/cat.png');
  assert.equal(stripPrefix('Apple.png'), 'Apple.png'); assert.equal(stripPrefix('A - cat.png'), 'A - cat.png');
});
await ok('held size: the height; wide designs get height × aspect (longest side); free 1 m clamp; no other cap', () => {
  assert.equal(startSizeCm({ startCm: 7.5, width: 100, height: 100 }), 7.5);
  assert.equal(startSizeCm({ startCm: 10, width: 100, height: 400 }), 10, 'portrait: height = longest side');
  assert.equal(startSizeCm({ startCm: 10, width: 400, height: 100 }), 40, 'landscape 4:1: 10 cm high = 40 cm wide');
  assert.equal(startSizeCm({ startCm: 67.5, width: 300, height: 100 }, { maxCm: 100 }), 100, 'free version: clamped to 1 m');
  assert.equal(startSizeCm({ startCm: 67.5, width: 1000, height: 100 }), 675, 'full version: no cap (not even the room)');
  assert.equal(startSizeCm({ startCm: 67.5, width: 1000, height: 100 }, { maxCm: Infinity }), 675);
  assert.equal(startSizeCm({ width: 333, height: 100 }), 33.5, 'rounded to 0.5 cm');
});

// ---------- API: uploads and the library ----------
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { loadLibrary } = require('../server/library');
const { importFolder, artistFor } = await import('../tools/import-library.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-size-'));
try {
  const png = (hex, w = 40, h = 40) => sharp({ create: { width: w, height: h, channels: 4, background: hex } }).png().toBuffer();
  const src = path.join(tmp, 'src'); fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'B_Ulla - cat.png'), await png('#ff0000'));
  fs.writeFileSync(path.join(src, 'Apple.png'), await png('#00ff00'));
  fs.writeFileSync(path.join(src, 'z-wide.png'), await png('#0000ff', 120, 40));
  const out = path.join(tmp, 'lib');
  await importFolder({ folder: src, out, csv: null, artist: '', replace: false, dry: false }, () => {});
  const man = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  const by = Object.fromEntries(man.stickers.map((s) => [s.source, s]));
  await ok('import: startCm in the manifest from the prefix (none = 10), prefix not in the artist name', () => {
    assert.equal(by['B_Ulla - cat.png'].startCm, 7.5); assert.equal(by['B_Ulla - cat.png'].artist, 'Ulla');
    assert.equal(by['Apple.png'].startCm, 10); assert.equal(by['z-wide.png'].startCm, 67.5);
    assert.equal(artistFor('C_Bo__dog.png').artist, 'Bo');
  });
  // An entry imported before this feature (no startCm): re-derived from its original name.
  delete by['z-wide.png'].startCm; fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(man));
  const store = createStore(new LocalAdapter(path.join(tmp, 'data')), { writeDelayMs: 20, log: { error() {}, log() {} } });
  const app = createApp(store, { quickTtlHours: 24, log: { error() {}, log() {} }, library: loadLibrary(out) });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const lib = (await (await fetch(`${base}/api/library`)).json()).stickers;
    const lb = Object.fromEntries(lib.map((s) => [s.id, s]));
    await ok('GET /api/library: each sticker has its startCm (also an older entry, from its original name)', () => {
      assert.equal(lb[by['B_Ulla - cat.png'].id].startCm, 7.5); assert.equal(lb[by['Apple.png'].id].startCm, 10); assert.equal(lb[by['z-wide.png'].id].startCm, 67.5);
      assert.ok(!('source' in lb[by['Apple.png'].id]), 'the file name itself is not sent');
    });
    const up = async (buf, fields = {}, fileName = 'klibba.png') => {
      const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      fd.append('file', new Blob([buf], { type: 'image/png' }), fileName);
      return (await fetch(`${base}/api/stickers`, { method: 'POST', body: fd })).json();
    };
    const d1 = await up(await png('#123456'), { name: 'D_hat.png' });
    const plain = await up(await png('#654321'), { name: 'hat.png' });
    const byFile = await up(await png('#abcdef'), {}, 'E-file.png');
    const restored = await up(await png('#fedcba'), { startCm: '12.5' });
    const junk = await up(await png('#0f0f0f'), { startCm: '400' });
    await ok('upload: the server derives startCm from the name the web app sends (or the file name), default 10', async () => {
      assert.equal(d1.startCm, 12.5); assert.equal(plain.startCm, 10); assert.equal(byFile.startCm, 15);
      assert.equal(restored.startCm, 12.5, 're-upload of a lost design keeps its start height'); assert.equal(junk.startCm, 10, 'only letter heights are taken from the client');
      const meta = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'images', `${d1.id}.json`), 'utf8'));
      assert.equal(meta.startCm, 12.5, 'stored on the image record');
    });
    await ok('the same picture renamed with another prefix gets the new height; without a prefix it keeps it', async () => {
      const again = await up(await png('#123456'), { name: 'A_hat.png' });
      const same = await up(await png('#123456'), { name: 'hat-copy.png' });
      assert.equal(again.id, d1.id); assert.equal(again.startCm, 5); assert.equal(same.startCm, 5);
    });
  } finally { server.close(); }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`sizeprefix: ${n} passed`);
