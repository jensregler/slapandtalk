// E2E: persistent city surface textures (Jens pt850u–pt852u, 11 Nov 2026). Own server (SURFACETEX_E2E_PORT, 8994)
// with a seeded build city: 300 old stickers (no peel keys – like a city preset's copy) on the ground round the
// spawn, over two tile edges, overlapping. Checks:
//   - the stickers load as records first; after the calm wait ONE browser gets the bake jobs, photographs the
//     touched tiles and the server moves the painted records into its archive (the newest 20 stay live);
//   - a second browser in the room swaps to the tiles live (surfacetex:update), without a reload;
//   - a reload loads the tiles + only the live stickers, and looks the same as before (pixel diff);
//   - a new sticker after that stays live (peelable), the count shown includes the painted-in ones;
//   - admin removes a painted-in sticker → its tiles are repainted from the archive without it.
// Screenshots to SURFACETEX_SHOTS (/workspace/city-surface-textures/shots).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.SURFACETEX_E2E_PORT || 8994);
const SHOTS = process.env.SURFACETEX_SHOTS || '/workspace/city-surface-textures/shots';
const ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const ADMIN = 'demo-e2e-admin';
const CITY = 'stad-byggen';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 900) : '')); } };

async function seed(dir) {
  const designs = [];
  const art = [['#e8312f', 'circle'], ['#2f6fe8', 'star'], ['#f2c12e', 'square'], ['#33b35a', 'ring']];
  for (const [col, shape] of art) {
    const body = shape === 'circle' ? `<circle cx="128" cy="128" r="110" fill="${col}" stroke="#111" stroke-width="14"/>`
      : shape === 'star' ? `<polygon points="128,10 160,96 250,96 178,150 206,240 128,186 50,240 78,150 6,96 96,96" fill="${col}" stroke="#111" stroke-width="10"/>`
      : shape === 'square' ? `<rect x="20" y="40" width="216" height="176" rx="20" fill="${col}" stroke="#111" stroke-width="14"/><text x="128" y="150" font-size="70" font-family="Arial" font-weight="900" text-anchor="middle">UP</text>`
      : `<circle cx="128" cy="128" r="100" fill="none" stroke="${col}" stroke-width="40"/><circle cx="128" cy="128" r="30" fill="#111"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="${shape === 'square' ? 256 : 256}">${body}</svg>`;
    const webp = await sharp(Buffer.from(svg)).webp({ quality: 92 }).toBuffer();
    const id = crypto.createHash('sha256').update(webp).digest('hex').slice(0, 16);
    fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true }); fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'uploads', `${id}.webp`), webp);
    const meta = { id, url: `/uploads/${id}.webp`, width: 256, height: 256, artist: 'E2E', createdAt: new Date().toISOString() };
    fs.writeFileSync(path.join(dir, 'images', `${id}.json`), JSON.stringify(meta));
    designs.push(meta);
  }
  const stamps = []; let order = 0;
  const q = (deg) => { // flat on the ground (+z of the sticker = up), turned deg about the up axis
    const a = -Math.PI / 4, r = (deg * Math.PI) / 360; // rx(-90°) then rz(deg): q = qx * qz
    const qx = [Math.sin(a), 0, 0, Math.cos(a)], qz = [0, 0, Math.sin(-r), Math.cos(-r)];
    return [qx[3] * qz[0] + qx[0] * qz[3] + qx[1] * qz[2] - qx[2] * qz[1], qx[3] * qz[1] - qx[0] * qz[2] + qx[1] * qz[3] + qx[2] * qz[0], qx[3] * qz[2] + qx[0] * qz[1] - qx[1] * qz[0] + qx[2] * qz[3], qx[3] * qz[3] - qx[0] * qz[0] - qx[1] * qz[1] - qx[2] * qz[2]];
  };
  for (let r = 0; r < 15; r++) for (let c = 0; c < 20; c++) {
    const x = -5.7 + c * 0.6, z = 12.6 + r * 0.6, d = designs[(r * 7 + c * 3) % designs.length];
    stamps.push({ id: crypto.randomBytes(8).toString('hex'), order: ++order, createdAt: new Date().toISOString(), imageId: d.id, position: [x, 0, z], normal: [0, 1, 0],
      quaternion: q((r * 37 + c * 11) % 360), size: 0.55 + ((r + c) % 3) * 0.15, rotation: 0, surface: 'golv', artist: 'E2E' });
  }
  fs.mkdirSync(path.join(dir, 'rooms'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'rooms', `${CITY}.json`), JSON.stringify({ id: CITY, type: 'stad', name: 'Byggstaden', geo: 'city-2', createdAt: new Date().toISOString(), lastVisitAt: new Date().toISOString(), stamps }));
  return { designs, stamps };
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'klibb-surfacetex-e2e-'));
  const { designs, stamps: seeded } = await seed(dir);
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1', DATA_DIR: dir, SURFACE_TEX_IDLE_MS: '6000' });
  const browser = await chromium.launch({ args: ARGS });
  const errors = [];
  const admin = (p, opt = {}) => fetch(S.base + p, { ...opt, headers: { 'x-admin-token': ADMIN, 'Content-Type': 'application/json', ...(opt.headers || {}) } }).then((r) => r.json());
  const ready = (P) => P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 90000 });
  const look = JSON.stringify({ name: 'Baker', look: { outfit: 'casual', hair: 'short', shirt: '#3a7bd5', pants: '#333333', hairColor: '#3b2a1a', skin: '#e0b48c', hat: false, hatColor: '#d33' } });
  const open = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
    await ctx.addInitScript((l) => { localStorage.setItem('klibb.avatar', l); }, look.replace('Baker', name));
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(name + ': ' + e.message));
    P.on('console', (m) => { if (m.type() === 'error' && /surfacetex/i.test(m.text())) errors.push(name + ' console: ' + m.text()); });
    await P.goto(`${S.base}/?room=${CITY}`); await ready(P);
    return { ctx, P };
  };
  const frame = async (P) => {
    await P.evaluate(() => { const k = window.klibb; k.moveTo(0, 17); k.camera.position.y = 1.6; k.look(0, -1.25); });
    await sleep(700);
    return P.screenshot({ clip: { x: 320, y: 60, width: 560, height: 480 } }); // right of the panel, under the toasts
  };
  const diff = async (a, b) => {
    const A = await sharp(a).raw().toBuffer({ resolveWithObject: true }), B = await sharp(b).raw().toBuffer();
    let big = 0, sum = 0; const n = A.info.width * A.info.height, ch = A.info.channels;
    for (let i = 0; i < n; i++) { let d = 0; for (let k = 0; k < 3; k++) d += Math.abs(A.data[i * ch + k] - B[i * ch + k]); sum += d / 3; if (d / 3 > 48) big++; }
    return { mean: +(sum / n).toFixed(2), bigFrac: +(big / n).toFixed(4) };
  };
  try {
    const st0 = await admin(`/api/admin/surfacetex/${CITY}`);
    check('the seeded build city: 300 live stickers, nothing painted in, 280 waiting (newest 20 stay live)', st0.live === 300 && st0.painted === 0 && st0.candidates === 280, st0);
    const A = await open('Baker');
    const a0 = await A.P.evaluate(() => ({ count: window.klibb.stamps.count, tex: window.klibb.surfTex().info() }));
    check('first load: all 300 come as sticker records (no tiles yet), baking is on', a0.count === 300 && a0.tex.on && a0.tex.tiles === 0, a0);
    await A.P.evaluate(() => window.klibb.stamps.bake()); // the in-session bake (as after 700 ms)
    const before = await frame(A.P);
    fs.writeFileSync(path.join(SHOTS, '1-before-records.png'), before);
    const B = await open('Watcher');
    // wait for the bake: 6 s calm + jitter, one job of 280 stickers
    await A.P.waitForFunction(() => window.klibb.surfTex().info().count === 280, null, { timeout: 120000 }).catch(() => {});
    const a1 = await A.P.evaluate(() => ({ tex: window.klibb.surfTex().info(), live: window.klibb.stamps.meshes.size, shown: document.getElementById('stamp-count').textContent }));
    const st1 = await admin(`/api/admin/surfacetex/${CITY}`);
    check('after the calm wait: 280 painted into tiles, the newest 20 stay live records', st1.painted === 280 && st1.live === 20 && st1.tiles >= 2 && a1.tex.count === 280 && a1.live === 20, { st1, a1 });
    check('only the touched tiles were photographed (ground tiles round the spawn, not the 144 of the whole ground)', st1.tiles >= 2 && st1.tiles <= 6, st1.tiles);
    check('the sticker count shown still says 300', a1.shown === '300', a1.shown);
    check('one browser baked it (one job, timings logged)', a1.tex.stats.jobs >= 1 && a1.tex.stats.last && a1.tex.stats.last.painted === 280, a1.tex.stats);
    const b1 = await B.P.waitForFunction(() => window.klibb.surfTex().info().count === 280 && window.klibb.stamps.meshes.size === 20, null, { timeout: 30000 }).then(() => true).catch(() => false);
    const bInfo = await B.P.evaluate(() => ({ tex: window.klibb.surfTex().info(), live: window.klibb.stamps.meshes.size }));
    check('the other browser in the room swapped to the tiles live (surfacetex:update), no reload', b1 && bInfo.tex.shown === st1.tiles && bInfo.tex.stats.jobs === 0, bInfo);
    await B.ctx.close(); // (its avatar would stand in A's picture)
    await sleep(1500);
    const after = await frame(A.P);
    fs.writeFileSync(path.join(SHOTS, '2-after-tiles-live.png'), after);
    const d1 = await diff(before, after);
    check(`the tiles look like the stickers did (mean diff ${d1.mean}, ${(d1.bigFrac * 100).toFixed(2)} % pixels off)`, d1.mean < 4 && d1.bigFrac < 0.01, d1);
    // reload: tiles + 20 records
    const load = await (await fetch(`${S.base}/api/rooms/${CITY}/stamps`)).json();
    check('GET …/stamps now sends 20 records + the tile manifest (no archive details)', load.stamps.length === 20 && load.surfaceTex && Object.keys(load.surfaceTex.tiles).length === st1.tiles && !JSON.stringify(load.surfaceTex).includes('segs') && load.info.stickers === 300, { n: load.stamps.length, info: load.info });
    await A.P.reload(); await ready(A.P);
    await A.P.waitForFunction((n) => window.klibb.surfTex().info().shown === n, st1.tiles, { timeout: 30000 }).catch(() => {});
    const a2 = await A.P.evaluate(() => ({ tex: window.klibb.surfTex().info(), live: window.klibb.stamps.meshes.size, shown: document.getElementById('stamp-count').textContent }));
    check('reload: the tiles + only 20 live sticker meshes, count 300', a2.tex.shown === st1.tiles && a2.live === 20 && a2.shown === '300', a2);
    const reloaded = await frame(A.P);
    fs.writeFileSync(path.join(SHOTS, '3-after-reload.png'), reloaded);
    const d2 = await diff(before, reloaded);
    check(`after a reload it still looks the same (mean diff ${d2.mean}, ${(d2.bigFrac * 100).toFixed(2)} % off)`, d2.mean < 4 && d2.bigFrac < 0.01, d2);
    // a close-up for the report
    await A.P.evaluate(() => { const k = window.klibb; k.moveTo(0.3, 16.2); k.camera.position.y = 0.9; k.look(0.2, -1.35); }); await sleep(600);
    fs.writeFileSync(path.join(SHOTS, '4-closeup-tile-edges.png'), await A.P.screenshot());
    // a new sticker (by hand, via the page's API): live and peelable; it does not get painted in (newest 20)
    const mine = await A.P.evaluate(async (img) => {
      const r = await fetch(`/api/rooms/stad-byggen/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageId: img, position: [2, 0, 18], normal: [0, 1, 0], quaternion: [-0.7071068, 0, 0, 0.7071068], size: 0.8, rotation: 0, surface: 'golv', owner: 'e2e-device-1234' }) });
      return r.json();
    }, designs[0].id);
    await A.P.waitForFunction((id) => window.klibb.stamps.meshes.has(id), mine.stamp.id, { timeout: 10000 }).catch(() => {});
    await sleep(8500 + 2600); // longer than the calm wait: a job would have come
    const st2 = await admin(`/api/admin/surfacetex/${CITY}`);
    const peel = await (await fetch(`${S.base}/api/rooms/${CITY}/stamps/${mine.stamp.id}/peel`, { method: 'DELETE', headers: { 'x-peel-token': mine.peelToken } })).json();
    // (it pushes the oldest of the 20 newest out of the "newest 20": that one is painted in after the calm wait)
    check('a new sticker stays a live record (peelable); the one it pushed out of the newest 20 was painted in after the calm wait', st2.painted === 281 && st2.live === 20 && peel.ok, { st2, peel });
    // admin deletes a painted-in sticker → its tiles are repainted from the archive without it
    const victim = seeded[100];
    const del = await admin(`/api/rooms/${CITY}/stamps/${victim.id}`, { method: 'DELETE' });
    const st3a = await admin(`/api/admin/surfacetex/${CITY}`);
    check('admin delete of a painted-in sticker: found in the archive, its tiles marked for a repaint', del.ok && st3a.stale >= 1 && st3a.painted === 280, { del, st3a });
    // whichever browser asks first gets the repaint
    const rebuilt = (P) => P.waitForFunction(() => window.klibb.surfTex().info().stats.last?.kind === 'rebuild', null, { timeout: 60000 }).then(() => P);
    const who = await rebuilt(A.P).catch(() => null);
    const st3 = await admin(`/api/admin/surfacetex/${CITY}`);
    const last = who && await who.evaluate(() => window.klibb.surfTex().info().stats.last);
    await A.P.waitForFunction((r) => window.klibb.surfTex().info().rev >= r, st3a.tiles ? 3 : 0, { timeout: 10000 }).catch(() => {});
    check('the repaint ran (a rebuild job from the archive), nothing stale left', st3.stale === 0 && last && last.kind === 'rebuild', { st3, last });
    await sleep(800);
    fs.writeFileSync(path.join(SHOTS, '5-after-delete-rebuild.png'), await frame(A.P));
    const exp = await admin(`/api/admin/surfacetex/${CITY}/export`);
    check('export: every record is still kept (19 live + 281 archived, 1 of them marked removed)', exp.live.length === 19 && exp.archived.length === 281 && exp.removed.length === 1, { live: exp.live.length, archived: exp.archived.length, removed: exp.removed.length });
    check('no page errors', errors.length === 0, errors);
    await A.ctx.close();
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e && e.stack)); }
  await browser.close(); S.child.kill();
  console.log(`\ne2e-surfacetex: ${passed} ok, ${failed} failed`);
  if (failed) { console.log(S.log().split('\n').filter((l) => /surfacetex|Error|error/.test(l)).slice(-30).join('\n')); }
  process.exit(failed ? 1 : 0);
})();
