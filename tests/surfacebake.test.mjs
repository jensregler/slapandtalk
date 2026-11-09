// Per-surface bake rule: keep newest 20 editable; bake older when a surface has more than 20.
import assert from 'node:assert/strict';
import { LIVE_PER_SURFACE, idsToKeepLive, idsToBake } from '../shared/surfacebake.mjs';

assert.equal(LIVE_PER_SURFACE, 20, 'threshold is 20 stickers per surface');

const wall = (n, surface = 'vägg-norr') => Array.from({ length: n }, (_, i) => ({ id: `${surface}-${i}`, order: i + 1, surface }));

{
  const stamps = wall(20);
  assert.equal(idsToBake(stamps).length, 0, 'at exactly 20: nothing baked');
  assert.equal(idsToKeepLive(stamps).size, 20, 'all 20 stay live');
}
{
  const stamps = wall(30);
  const bake = idsToBake(stamps);
  const keep = idsToKeepLive(stamps);
  assert.equal(bake.length, 10, '30 on one wall → bake the 10 older');
  assert.equal(keep.size, 20, '…keep the newest 20');
  assert.ok(bake.every((id) => id.startsWith('vägg-norr-') && Number(id.split('-').pop()) < 10), 'baked are the oldest by order');
  assert.ok([...keep].every((id) => Number(id.split('-').pop()) >= 10), 'kept are the newest 20');
}
{
  // Two surfaces: each judged on its own
  const stamps = [...wall(25, 'vägg-norr'), ...wall(5, 'golv')];
  const bake = idsToBake(stamps);
  const keep = idsToKeepLive(stamps);
  assert.equal(bake.length, 5, 'only the north wall overflows (25→5 baked)');
  assert.equal(keep.size, 25, '20 north + 5 floor stay live');
  assert.ok(bake.every((id) => id.startsWith('vägg-norr-')), 'floor untouched');
}
{
  const stamps = wall(25);
  const extra = stamps[0].id; // oldest, would bake, but keepExtra forces live
  const keep = idsToKeepLive(stamps, { keepExtra: [extra] });
  assert.ok(keep.has(extra) && keep.size === 21, 'keepExtra (peel history) stays live on top of newest 20');
  assert.equal(idsToBake(stamps, { keepExtra: [extra] }).length, 4, '…so only 4 older bake');
}

console.log('surfacebake: all ok');
