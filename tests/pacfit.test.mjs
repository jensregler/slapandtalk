// The door's pac (t477u, 2 Nov 2026): every part of each of the 3 stickers inside the bag's pouch
// (with the margin), whatever its shape; drawing only on the label.
import assert from 'node:assert/strict';
import { pacSpot, PAC_POUCH, PAC_LABEL } from '../client/src/door.js';
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
console.log(`pacfit: ${n} sticker placements inside the pouch ✓`);
