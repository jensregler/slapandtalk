// The door's pac (t477u, 2 Nov 2026): every part of each of the 3 stickers inside the bag's pouch
// (with the margin), whatever its shape; drawing only on the label.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import { pacSpot, PAC_POUCH, PAC_LABEL, PACKS, bagUrl } from '../client/src/door.js';
let n = 0;
for (const [w, h] of [[1, 1], [1000, 200], [200, 1000], [4000, 300], [300, 4000], [512, 512], [1600, 900]]) {
  for (let k = 0; k < 3; k++) {
    const { cx, cy, rot, sc, inner } = pacSpot(k, w, h);
    assert.ok(inner.x >= PAC_POUCH.x + 10 && inner.x + inner.w <= PAC_POUCH.x + PAC_POUCH.w - 10 && inner.y >= PAC_POUCH.y + 10 && inner.y + inner.h <= PAC_POUCH.y + PAC_POUCH.h - 10, 'margin');
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = sx * w * sc / 2, y = sy * h * sc / 2;
      const px = cx + x * Math.cos(rot) - y * Math.sin(rot), py = cy + x * Math.sin(rot) + y * Math.cos(rot);
      assert.ok(px >= inner.x - 1e-6 && px <= inner.x + inner.w + 1e-6 && py >= inner.y - 1e-6 && py <= inner.y + inner.h + 1e-6, `corner of ${w}x${h} #${k} at ${px.toFixed(1)},${py.toFixed(1)}`);
    }
    assert.ok(Math.max(w, h) * sc > 150, `${w}x${h} #${k} not tiny (${(Math.max(w, h) * sc).toFixed(0)} px)`);
    n++;
  }
}
assert.ok(PAC_LABEL.y + PAC_LABEL.h < PAC_POUCH.y, 'label above the pouch');
// The seven bag designs (t507u, Dropbox stickerpacks → client/public/stickerpacks): all the same size,
// with the label where PAC_LABEL is (opaque there) and the see-through pouch where PAC_POUCH is.
assert.equal(PACKS.length, 7);
assert.equal(bagUrl(3), '/stickerpacks/pac3.webp'); assert.equal(bagUrl(undefined), PACKS[0]); assert.equal(bagUrl(99), PACKS[0]);
for (const url of PACKS) {
  const f = new URL('../client/public' + url, import.meta.url);
  assert.ok(fs.existsSync(f), url);
  const { data, info } = await sharp(fs.readFileSync(f)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [563, 802], url);
  const alpha = (R) => { let s = 0, c = 0; for (let y = R.y; y < R.y + R.h; y += 4) for (let x = R.x; x < R.x + R.w; x += 4) { s += data[(y * info.width + x) * 4 + 3]; c++; } return s / c / 255; };
  assert.ok(alpha(PAC_LABEL) > 0.9, url + ': the label is opaque');
  n++;
}
console.log(`pacfit: ${n} sticker placements inside the pouch + 7 bag designs ✓`);
