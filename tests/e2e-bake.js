// E2E: older stickers are "painted into the walls" (merged into a few big meshes, one shared
// texture array) so a full room costs a handful of draw calls. Only the newest (the last
// LIVE_RECENT by anyone, plus my own peelable ones) stay separate meshes.
// Checks: z-order (newer on top) is the same baked or not, the artist credit still finds a baked
// sticker, my own old sticker stays peelable, admin delete / room reset remove baked ones.
const sharp = require('sharp');

async function bakeE2E({ browser, BASE, assert, waitReady, TOKEN }) {
  const solid = async (hex, label) => sharp({ create: { width: 64, height: 64, channels: 4, background: hex } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><text x="4" y="12" font-size="8">${label}</text></svg>`), top: 0, left: 0 }]).png().toBuffer();
  const upload = async (buf) => { const fd = new FormData(); fd.append('file', new Blob([buf], { type: 'image/png' }), 'k.png'); return (await fetch(`${BASE}/api/stickers`, { method: 'POST', body: fd })).json(); };
  const [red, blue, green] = [await upload(await solid('#ff0000', 'bake-r')), await upload(await solid('#0000ff', 'bake-b')), await upload(await solid('#00ff00', 'bake-g'))];
  const made = await (await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  const R = made.room.id;
  const ctx = await browser.newContext({ viewport: { width: 800, height: 500 } });
  const P = await ctx.newPage();
  const errors = [];
  P.on('pageerror', (e) => errors.push(e.message));
  try {
    await P.goto(`${BASE}/?room=${R}`); await waitReady(P);
    const wall = await P.evaluate(() => { const k = window.klibb; k.moveTo(0, 0); k.look(0, 0); const w = k.surfaces.find((s) => s.name === 'vägg-norr'); return { y: k.camera.position.y, z: w.position.z }; });
    // (the server allows 120 slaps a minute per IP: if earlier tests used them up, wait)
    const post = async (img, x, y, size, artist = '') => {
      for (let t = 0; ; t++) {
        const r = await fetch(`${BASE}/api/rooms/${R}/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageId: img.id, position: [x, y, wall.z], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size, rotation: 0, surface: 'vägg-norr', artist }) });
        if (r.status !== 429 || t > 15) return r.json();
        await new Promise((ok) => setTimeout(ok, 5000));
      }
    };
    const centre = async () => { const b = await P.screenshot({ clip: { x: 398, y: 248, width: 4, height: 4 } }); const s = await sharp(b).stats(); return s.channels.slice(0, 3).map((c) => Math.round(c.mean)); };
    const isCol = (c, i) => c[i] > 120 && c.every((v, j) => j === i || v < 90);
    const under = await post(red, 0, wall.y, 0.8, 'Röd');
    const over = await post(blue, 0, wall.y, 0.4, 'Blå');
    for (let i = 0; i < 32; i++) await post(green, -4 + (i % 20) * 0.4, wall.y + 1.4 + Math.floor(i / 20) * 0.3, 0.2);
    await P.waitForFunction(() => window.klibb.stamps.count === 34, null, { timeout: 90000 });
    await P.evaluate(() => window.klibb.stamps.bake());
    const s1 = await P.evaluate(([a, b]) => ({ ...window.klibb.stamps.stats(), a: !!window.klibb.stamps.meshes.get(a)?.baked, b: !!window.klibb.stamps.meshes.get(b)?.baked }), [under.stamp.id, over.stamp.id]);
    assert(s1.live === 30 && s1.baked === 4 && s1.chunks === 1 && s1.pages === 1 && s1.a && s1.b,
      `the newest 30 stay separate meshes, the 4 older are painted in: one merged mesh, one texture array (${JSON.stringify(s1)})`);
    await P.waitForTimeout(300);
    const c1 = await centre();
    assert(isCol(c1, 2), `baked: the newer (blue) sticker is still drawn on top of the older (red) one (${c1})`);
    const calls = await P.evaluate(() => window.klibb.renderer.info.render.calls);
    assert(calls < 30 + 15, `few draw calls with 34 stickers (${calls})`);
    // Artist credit (Look mode) finds the baked sticker under the dot
    await P.mouse.click(600, 250); await P.waitForFunction(() => window.klibb.controls.locked, null, { timeout: 3000 });
    await P.keyboard.press('v'); await P.waitForFunction(() => window.klibb.state.mode === 'view');
    await P.evaluate(() => window.klibb.look(0, 0)); await P.waitForTimeout(200);
    // Look mode: the credit shows on click (dispatched on the canvas, aimed by the dot)
    await P.evaluate(() => { const c = document.getElementById('scene'); for (const t of ['mousedown', 'mouseup', 'click']) c.dispatchEvent(new MouseEvent(t, { bubbles: true, button: 0 })); });
    await P.waitForFunction(() => window.klibb.credit().shown, null, { timeout: 3000 });
    assert((await P.evaluate(() => window.klibb.credit().name)) === 'Blå', 'Look mode: the artist credit still works on a painted-in sticker (the top one)');
    await P.keyboard.press('v'); await P.evaluate(() => window.klibb.controls.unlock());
    // My own sticker stays live (peelable) even when 31 newer ones come after it
    const mine = await P.evaluate(async (g) => { const k = window.klibb; k.state.selected = g; k.look(0.5, 0); await new Promise((r) => setTimeout(r, 100)); const s = await k.stampAt(0, 0); return s && s.id; }, green);
    for (let i = 0; i < 31; i++) await post(green, -4 + (i % 20) * 0.4, wall.y - 1 - Math.floor(i / 20) * 0.3, 0.2);
    await P.waitForFunction(() => window.klibb.stamps.count === 66, null, { timeout: 90000 });
    await P.evaluate(() => window.klibb.stamps.bake());
    const s2 = await P.evaluate((id) => ({ ...window.klibb.stamps.stats(), mineLive: !!window.klibb.stamps.meshes.get(id) && !window.klibb.stamps.meshes.get(id).baked }), mine);
    assert(mine && s2.mineLive && s2.live === 31 && s2.baked === 35 && s2.chunks === 2,
      `my own (peelable) sticker stays a separate mesh; the baked run is split around it so the order stays exact (${JSON.stringify(s2)})`);
    await P.evaluate(() => window.klibb.peelLast());
    await P.waitForFunction((id) => !window.klibb.stamps.meshes.has(id), mine, { timeout: 5000 });
    assert((await P.evaluate(() => window.klibb.stamps.count)) === 65, 'Z still peels my own old sticker');
    // Server-side removal of a baked sticker (admin) → gone right away
    await P.evaluate(() => window.klibb.look(0, 0)); await P.waitForTimeout(200);
    if (TOKEN) {
      await fetch(`${BASE}/api/rooms/${R}/stamps/${over.stamp.id}`, { method: 'DELETE', headers: { 'x-admin-token': TOKEN } });
      await P.waitForFunction((id) => !window.klibb.stamps.meshes.has(id), over.stamp.id, { timeout: 5000 });
      await P.waitForTimeout(300);
      const c2 = await centre();
      assert(isCol(c2, 0), `admin delete of a baked sticker: it disappears and the one under shows (${c2})`);
      await P.waitForTimeout(1200); // the chunk is rebuilt lazily
      const c3 = await centre();
      const s3 = await P.evaluate(() => window.klibb.stamps.stats());
      assert(isCol(c3, 0) && s3.baked === 34, `after the lazy rebuild it is still right (${c3}, ${JSON.stringify(s3)})`);
    }
    // Room reset: everything goes, baked too
    await fetch(`${BASE}/api/rooms/${R}/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-room-key': made.roomKey }, body: JSON.stringify({ by: 'Test' }) });
    await P.waitForFunction(() => window.klibb.stamps.count === 0, null, { timeout: 5000 });
    await P.waitForTimeout(300);
    const s4 = await P.evaluate(() => ({ ...window.klibb.stamps.stats(), calls: window.klibb.renderer.info.render.calls }));
    const c4 = await centre();
    assert(s4.baked === 0 && s4.chunks === 0 && !isCol(c4, 0) && !isCol(c4, 2), `room reset: baked stickers are gone too (${JSON.stringify(s4)}, ${c4})`);
    assert(!errors.length, 'no page errors while baking' + (errors.length ? ': ' + errors.join(' | ') : ''));
  } finally {
    await ctx.close();
    if (TOKEN) {
      await fetch(`${BASE}/api/rooms/${R}`, { method: 'DELETE', headers: { 'x-admin-token': TOKEN } }).catch(() => {});
      for (const img of [red, blue, green]) await fetch(`${BASE}/api/stickers/${img.id}`, { method: 'DELETE', headers: { 'x-admin-token': TOKEN } }).catch(() => {});
    }
  }
}

module.exports = { bakeE2E };

if (require.main === module) {
  require('dotenv').config({ path: __dirname + '/../.env', quiet: true });
  const { chromium } = require('playwright');
  const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
  const waitReady = (page) => page.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 20000 });
  (async () => {
    const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    try { await bakeE2E({ browser, BASE: process.env.BASE_URL || 'http://localhost:8787', assert, waitReady, TOKEN: process.env.ADMIN_TOKEN }); }
    finally { await browser.close(); }
  })().catch((e) => { console.error(e); process.exit(1); });
}
