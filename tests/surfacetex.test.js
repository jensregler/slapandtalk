// Persistent city surface textures – the server (server/surfacetex.js): the calm wait, one job per room, tile
// validation, the commit that moves painted records into the archive, rebuilds, presets carrying the textures
// into a new city, reset, gc. No browser: tiles are made with sharp.
const fs = require('fs'); const os = require('os'); const path = require('path');
const sharp = require('sharp');
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createSurfaceTex, imgKey, segKey } = require('../server/surfacetex');
const { createCityPresets } = require('../server/citypresets');
const { createCities } = require('../server/cities');
const CITY = require('../shared/city.mjs');

const assert = (c, m, x) => { if (!c) throw new Error('FEL: ' + m + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 600) : '')); console.log('✔ ' + m); };
const rejects = async (p, status, m) => { try { await p; } catch (e) { assert(e.status === status, m, { got: e.status, msg: e.message }); return e; } throw new Error('FEL: ' + m + ' — did not fail'); };
const quiet = { error() {}, log() {}, warn() {} };
const png = (px, { alpha = 255, color = { r: 255, g: 0, b: 0 } } = {}) => sharp({ create: { width: px, height: px, channels: 4, background: { ...color, alpha: alpha / 255 } } }).png().toBuffer();

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-surfacetex-'));
  const store = createStore(new LocalAdapter(dir), { log: quiet });
  let now = 1_000_000; const clock = () => now;
  const events = [];
  const IMG = { id: 'aaaaaaaaaaaaaaaa', url: '/uploads/aaaaaaaaaaaaaaaa.webp', width: 100, height: 100 };
  const tex = createSurfaceTex(store, { clock, log: quiet, settings: { on: true, idleMs: 10_000, leaseMs: 90_000 },
    imageAvailable: async (id) => (id === IMG.id ? IMG : null), isPlayer: (room, by) => by === 'abcdef0123', broadcast: (r, e) => events.push([r, e]) });
  const R = CITY.BUILD_CITY;
  await store.createRoom({ id: R, type: 'stad', extra: { name: 'Byggstaden' } });
  // 30 stickers on the ground, the first 2 still peelable, 1 on a prop, 1 with a design that is gone
  for (let i = 0; i < 30; i++) await store.addStamp(R, { imageId: IMG.id, position: [i * 0.5 - 7, 0, 3], normal: [0, 1, 0], quaternion: [-0.7071, 0, 0, 0.7071], size: 0.4, surface: 'golv', ...(i < 2 ? { peelHash: 'p' + i, peelOwner: 'o' } : {}) });
  await store.addStamp(R, { imageId: IMG.id, position: [0, 1, 0], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.4, surface: 'prop-0123456789-top' });
  const live0 = (await store.peek(R)).stamps.length;

  await rejects(tex.claim('k7m2qx', { by: 'abcdef0123' }), 404, 'an ordinary room gets no bake jobs');
  await rejects(tex.claim(R, { by: 'nobody0000' }), 403, 'only a player in the room may bake');
  tex.noteChange(R);
  let c = await tex.claim(R, { by: 'abcdef0123' });
  assert(c.wait === 10_000, 'right after a change: wait 10 s for calm', c);
  now += 9_000; c = await tex.claim(R, { by: 'abcdef0123' });
  assert(c.wait === 1_000, '…still 1 s to go', c);
  now += 1_000; c = await tex.claim(R, { by: 'abcdef0123' });
  assert(c.job && c.job.kind === 'bake', 'after 10 s of calm: a bake job', c);
  const job = c.job;
  assert(job.stamps.length === 8 && job.stamps.every((s) => s.surface === 'golv' && !('peelHash' in s)), '30 − newest 20 − 2 peelable = 8 ground stickers (no prop sticker, no peel keys sent)', job.stamps.map((s) => s.order));
  assert(job.images[IMG.id] && Object.keys(job.tiles).length === 0, 'with their designs; no tiles yet');
  const again = await tex.claim(R, { by: 'abcdef0123' });
  assert(again.busy, 'one job per room at a time', again);

  await rejects(tex.putTile(R, job.id, 'golv|5|6', await png(512), { by: 'abcdef0123' }), 400, 'a tile of the wrong size is refused');
  await rejects(tex.putTile(R, job.id, 'golv|5|6', Buffer.from('nope'), { by: 'abcdef0123' }), 400, 'not an image: refused');
  await rejects(tex.putTile(R, job.id, 'golv|5|6', await png(1024), { by: 'someone000' }), 403, 'someone else cannot upload into my job');
  await rejects(tex.putTile(R, 'ffffffffffffffff', 'golv|5|6', await png(1024), { by: 'abcdef0123' }), 409, 'an unknown / old job is over');
  const t1 = await tex.putTile(R, job.id, 'golv|5|6', await png(1024), { by: 'abcdef0123' });
  assert(/^[a-f0-9]{16}$/.test(t1.img), 'a tile is stored, content-addressed', t1);
  for (const k of ['m', 'd', 'h']) assert(fs.existsSync(path.join(dir, imgKey(t1.img, k))), `…its ${k === 'm' ? 'lossless master' : k === 'd' ? 'display copy' : 'half-size copy'} too`);
  const half = await sharp(fs.readFileSync(path.join(dir, imgKey(t1.img, 'h')))).metadata();
  assert(half.width === 512 && half.format === 'webp', 'the half-size copy is 512 px WebP', half);

  await rejects(tex.commit(R, job.id, { painted: ['ffffffffffffffff'], by: 'abcdef0123' }), 400, 'painting stickers that were not in the job is refused (and the job is dropped)');
  now += 1; c = await tex.claim(R, { by: 'abcdef0123' });
  const job2 = c.job; assert(job2 && job2.stamps.length === 8, 'the same stickers are offered again');
  await tex.putTile(R, job2.id, 'golv|5|6', await png(1024), { by: 'abcdef0123' });
  events.length = 0;
  const ids = job2.stamps.map((s) => s.id);
  const done = await tex.commit(R, job2.id, { painted: ids.slice(0, 7), skipped: [ids[7]], by: 'abcdef0123' });
  assert(done.ok && done.baked === 7 && done.tiles['golv|5|6'], 'commit: 7 painted in, one skipped', done);
  let room = await store.peek(R);
  assert(room.stamps.length === live0 - 7 && !room.stamps.some((s) => ids.slice(0, 7).includes(s.id)), 'the painted records left the room file', room.stamps.length);
  assert(room.surfaceTex.count === 7 && room.surfaceTex.segs.length === 1 && room.surfaceTex.tiles['golv|5|6'].segs[0] === room.surfaceTex.segs[0], 'the manifest: count, one archive segment, the tile knows its segment', room.surfaceTex);
  const seg = JSON.parse(fs.readFileSync(path.join(dir, segKey(room.surfaceTex.segs[0]))));
  assert(seg.stamps.length === 7 && seg.stamps.every((s) => s.position && s.quaternion && s.imageId), 'the archive keeps the full sticker records (nothing is lost)');
  assert(events.length === 1 && events[0][1].type === 'surfacetex:update' && events[0][1].baked.length === 7 && events[0][1].count === 7, 'everyone is told: the new tile + which stickers are in it now', events);
  now += 1; c = await tex.claim(R, { by: 'abcdef0123' });
  assert(c.idle, 'nothing left: the skipped one is not offered again', c);

  // a new sticker restarts the calm wait; then the next job paints on the existing tile
  await store.addStamp(R, { imageId: IMG.id, position: [5, 0, 5], normal: [0, 1, 0], quaternion: [-0.7071, 0, 0, 0.7071], size: 0.4, surface: 'golv' });
  tex.noteChange(R);
  c = await tex.claim(R, { by: 'abcdef0123' }); assert(c.wait > 0, 'a new sticker: wait for calm again');
  now += 10_000; c = await tex.claim(R, { by: 'abcdef0123' });
  assert(c.job && c.job.stamps.length === 1 && c.job.tiles['golv|5|6'] && !c.job.tiles['golv|5|6'].segs, 'the next job: 1 sticker, with the current tile to paint on (no archive details)', c.job && c.job.tiles);
  // a sticker in the job goes meanwhile (admin) → the commit is refused, nothing changes
  await tex.putTile(R, c.job.id, 'golv|5|6', await png(1024, { color: { r: 0, g: 0, b: 255 } }), { by: 'abcdef0123' });
  await store.deleteStamp(R, c.job.stamps[0].id);
  await rejects(tex.commit(R, c.job.id, { painted: [c.job.stamps[0].id], by: 'abcdef0123' }), 409, 'a sticker went while painting: commit refused');
  room = await store.peek(R);
  assert(room.surfaceTex.count === 7 && room.surfaceTex.tiles['golv|5|6'].img === t1.img, 'the manifest is unchanged after a refused commit');

  // the lease: a baker that never commits loses the job
  await store.addStamp(R, { imageId: IMG.id, position: [5, 0, 5], normal: [0, 1, 0], quaternion: [-0.7071, 0, 0, 0.7071], size: 0.4, surface: 'golv' });
  now += 10_000; c = await tex.claim(R, { by: 'abcdef0123' }); assert(c.job, 'a job');
  now += 90_001; const c2 = await tex.claim(R, { by: 'abcdef0123' });
  assert(c2.job && c2.job.id !== c.job.id, 'after the lease (90 s) the job is offered again');
  await rejects(tex.commit(R, c.job.id, { painted: [], by: 'abcdef0123' }), 409, 'the old job cannot commit');
  await tex.putTile(R, c2.job.id, 'golv|5|6', await png(1024), { by: 'abcdef0123' });
  await tex.commit(R, c2.job.id, { painted: c2.job.stamps.map((s) => s.id), by: 'abcdef0123' });

  // removing a painted-in sticker (admin / "clear your stickers" / a deleted design): its tiles are repainted
  room = await store.peek(R);
  const victim = seg.stamps[0].id;
  const gone = await tex.removeArchived(R, (s) => s.id === victim);
  room = await store.peek(R);
  assert(gone.length === 1 && room.surfaceTex.removed.includes(victim) && room.surfaceTex.stale.includes('golv|5|6') && room.surfaceTex.count === 7, 'a painted-in sticker removed: remembered, its tile marked for a repaint', room.surfaceTex);
  c = await tex.claim(R, { by: 'abcdef0123' });
  assert(c.job && c.job.kind === 'rebuild' && c.job.keys[0] === 'golv|5|6' && c.job.removed.includes(victim) && c.job.segs['golv|5|6'].length === 2, 'a rebuild job: the tile, its segments, what to leave out', c.job);
  const segData = await tex.segment(R, c.job.segs['golv|5|6'][0]);
  assert(segData.stamps.length === 6 && !segData.stamps.some((s) => s.id === victim) && segData.images[IMG.id], 'a segment is served without the removed sticker, with designs');
  await rejects(tex.segment(R, 'ffffffffffffffff'), 404, 'only this room\'s segments are served');
  await rejects(tex.commit(R, c.job.id, { by: 'abcdef0123' }), 400, 'a rebuild must upload every tile');
  c = await tex.claim(R, { by: 'abcdef0123' });
  await tex.putTile(R, c.job.id, 'golv|5|6', await png(1024, { color: { r: 0, g: 255, b: 0 } }), { by: 'abcdef0123' });
  const rb = await tex.commit(R, c.job.id, { by: 'abcdef0123' });
  room = await store.peek(R);
  assert(rb.ok && room.surfaceTex.stale.length === 0 && room.surfaceTex.tiles['golv|5|6'].img !== t1.img, 'the rebuild replaced the tile, nothing stale');
  // a rebuild that comes out empty drops the tile
  await tex.rebuild(R);
  c = await tex.claim(R, { by: 'abcdef0123' });
  await tex.putTile(R, c.job.id, 'golv|5|6', await png(1024, { alpha: 0 }), { by: 'abcdef0123' });
  await tex.commit(R, c.job.id, { by: 'abcdef0123' });
  room = await store.peek(R);
  assert(!room.surfaceTex.tiles['golv|5|6'] && room.surfaceTex.segs.length === 2, 'an empty repaint removes the tile; the archive stays');
  // put a tile back for the preset part
  await tex.rebuild(R); // (no tiles: nothing)
  await store.addStamp(R, { imageId: IMG.id, position: [6, 0, 5], normal: [0, 1, 0], quaternion: [-0.7071, 0, 0, 0.7071], size: 0.4, surface: 'golv' });
  for (let i = 0; i < 20; i++) await store.addStamp(R, { imageId: IMG.id, position: [6, 0, 6], normal: [0, 1, 0], quaternion: [-0.7071, 0, 0, 0.7071], size: 0.4, surface: 'golv' });
  now += 10_000; c = await tex.claim(R, { by: 'abcdef0123' });
  await tex.putTile(R, c.job.id, 'golv|6|6', await png(1024), { by: 'abcdef0123' });
  await tex.commit(R, c.job.id, { painted: c.job.stamps.map((s) => s.id), by: 'abcdef0123' });

  // city presets carry the textures: a new city starts with the tiles, not the painted records
  room = await store.peek(R);
  assert(room.surfaceTex.count === 28 && room.stamps.length === 24, '7 + 1 − 1 removed + 21 (the old newest 20 + 1 are no longer the newest) painted in; live: 20 newest + 2 peelable + 1 on a prop + 1 skipped', { c: room.surfaceTex.count, live: room.stamps.length });
  const presets = createCityPresets(store, { clock, log: quiet, autosaveMs: 50 });
  const p = await presets.saveDefault();
  assert(p.layers.outside.surfaceTex && p.layers.outside.surfaceTex.tiles['golv|6|6'] && p.layers.outside.surfaceTex.count === room.surfaceTex.count, 'the default city preset keeps the outside\'s textures (manifest + archive refs)', p.layers.outside.surfaceTex);
  assert(presets.summary(p).painted.outside === p.layers.outside.surfaceTex.count, 'the preset summary counts the painted-in stickers');
  const cities = createCities(store, { clock, log: quiet, presets });
  const city = await cities.create({ name: 'Test town' });
  const nr = await store.peek(city.id);
  assert(nr.surfaceTex && nr.surfaceTex.tiles['golv|6|6'].img === p.layers.outside.surfaceTex.tiles['golv|6|6'].img && nr.stamps.length === p.layers.outside.stamps.length, 'a new city: the same tile pictures (shared files), only the live stickers as records', { live: nr.stamps.length });
  assert(city.stickers === nr.stamps.length + nr.surfaceTex.count, 'the city list counts painted-in stickers too', city.stickers);
  const nseg = await tex.segment(city.id, nr.surfaceTex.segs[0]);
  assert(nseg.stamps.length > 0, 'the new city can read the shared archive (to repaint its own tiles later)');

  // status, gc, reset
  const s = await tex.status(R);
  assert(s.on && s.painted === room.surfaceTex.count && s.tiles === 1 && s.segments === 3, 'admin status', s);
  const dry = await tex.gc();
  assert(dry.dry && dry.unreferenced > 0, 'gc (dry run) finds the replaced tile pictures', dry);
  const before = fs.readdirSync(path.join(dir, 'surfacetex/img')).length;
  const wet = await tex.gc({ dry: false });
  const after = fs.readdirSync(path.join(dir, 'surfacetex/img')).length;
  assert(after === before - wet.unreferenced && fs.existsSync(path.join(dir, imgKey(nr.surfaceTex.tiles['golv|6|6'].img, 'd'))), 'gc deletes only what nothing refers to (the preset\'s / new city\'s tile stays)', { before, after, wet });
  const exp = await tex.exportRoom(R);
  assert(exp.archived.length === exp.manifest.count + exp.removed.length, 'export: every archived record is kept (painted + removed)', { a: exp.archived.length, c: exp.manifest.count, r: exp.removed.length });
  const n = await store.resetStamps(R);
  room = await store.peek(R);
  assert(n > 0 && !room.surfaceTex && room.stamps.length === 0, 'room reset clears the textures too', n);

  // a long job (the first bake of a heavy city): every tile handed in renews the lease; stickers the baker left for
  // the next job (its tile cap) make the commit say more
  for (let i = 0; i < 22; i++) await store.addStamp(R, { imageId: IMG.id, position: [i * 0.3 - 3, 0, 5], normal: [0, 1, 0], quaternion: [-0.7071, 0, 0, 0.7071], size: 0.4, surface: 'golv' });
  now += 10_000; c = await tex.claim(R, { by: 'abcdef0123' }); assert(c.job && c.job.stamps.length === 2, '22 new stickers after the reset: the 2 oldest are waiting', c.job && c.job.stamps.length);
  now += 60_000; await tex.putTile(R, c.job.id, 'golv|6|6', await png(1024), { by: 'abcdef0123' });
  now += 60_000; const busy = await tex.claim(R, { by: 'abcdef0123' });
  assert(busy.busy, '120 s after the claim but 60 s after the last tile: the job is still the baker’s', busy);
  const part = await tex.commit(R, c.job.id, { painted: [c.job.stamps[0].id], by: 'abcdef0123' });
  assert(part.baked === 1 && part.more === true, 'one painted, one left for the next job: more', part);
  now += 1; c = await tex.claim(R, { by: 'abcdef0123' });
  assert(c.job && c.job.stamps.length === 1, 'the next job offers the one that was left (no calm wait: nothing changed)', c);
  await tex.putTile(R, c.job.id, 'golv|6|6', await png(1024), { by: 'abcdef0123' });
  const rest = await tex.commit(R, c.job.id, { painted: [c.job.stamps[0].id], by: 'abcdef0123' });
  assert(rest.baked === 1 && !rest.more, 'all done: no more', rest);
  const offTex = createSurfaceTex(store, { clock, log: quiet, settings: { on: false, idleMs: 1, leaseMs: 1 }, isPlayer: () => true });
  assert((await offTex.claim(R, { by: 'abcdef0123' })).off, 'SURFACE_TEX=0: no jobs');
  console.log('\nsurfacetex (server): all ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
