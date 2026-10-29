// E2E: preset rooms (Jens, 29 Oct 2026: "Preset-rummet ska sparas som sex bilder (golv, tak, fyra
// väggar) istället för klistermärken, väggarna låsta, och nature-klibborna går inte att ändra – rummet
// är default. När en ny användare startar ett rum får den ett av presetsen.").
// A room is designed with nature stickers (here: by the test), admin saves it as a preset (the
// stickers baked into six images, client/src/preset.js → POST /api/admin/presets), and then:
//   - with NO presets a new room is as before (checked first);
//   - a new user's room (POST /api/rooms {}, as landing.js does) gets the preset: the look + six images;
//   - in the browser the six sheets are on the surfaces and the room LOOKS like the designed one
//     (the same view, pixel-compared), but has no sticker objects: nothing to peel or change;
//   - the walls are locked: no 🎨 button, PUT style → 403 even with the room key;
//   - people can still slap their own stickers on top;
//   - "＋ New quick room" with a picked look, and { preset: false }, get no preset;
//   - admin only (403 without the token); scripts/make-preset.js makes one from a room code.
// Own server (PRESET_E2E_PORT, default 8897). Screenshots: PRESET_SHOTS (default /workspace/preset-shots).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { chromium } = require('playwright');
const sharp = require('sharp');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.PRESET_E2E_PORT || 8897);
const SHOTS = process.env.PRESET_SHOTS || '/workspace/preset-shots';
const ADMIN = 'preset-e2e-admin';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };

// the 3D view only (not the panel, the HUD or the wheels, which differ between rooms)
// (the clean shots hide all UI); crop = the part of the frame where the stickers are
async function meanDiff(a, b, crop = null) {
  const [x, y] = await Promise.all([a, b].map((f) => (crop ? sharp(f).extract(crop) : sharp(f)).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
  let s = 0; for (let i = 0; i < x.data.length; i++) s += Math.abs(x.data[i] - y.data[i]);
  return s / x.data.length;
}

// a screenshot of the 3D view only (no panel, HUD or wheels – they differ between rooms)
async function clean(p, file) {
  const h = await p.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });
  await sleep(150); await p.screenshot({ path: file }); await h.evaluate((el) => el.remove());
}
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', ADMIN_TOKEN: ADMIN });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  let ipN = 0; // (POST /api/rooms is rate-limited per IP: every call from its own address)
  const post = async (url, body, headers = {}) => { const r = await fetch(S.base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.9.${++ipN}.1`, ...headers }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
  const ready = (p) => p.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected && window.klibb.state.library.length > 0, null, { timeout: 30000 });
  // the same first-person view in any room: in the middle, looking at the north wall
  const pose = (p, yaw = 0, pitch = 0.05) => p.evaluate(([y, pi]) => { const k = window.klibb; k.setView?.('first', { quiet: true }); k.moveTo(0, 2.5); k.look(y, pi); }, [yaw, pitch]);
  try {
    // ---- no presets: as before ----
    const plain = await post('/api/rooms', {});
    check('no presets: a new room is as before (no preset, the default look)', plain.status === 200 && !plain.j.room.preset, plain.j.room);
    check('admin only: listing / saving presets without the token → 403', (await fetch(`${S.base}/api/admin/presets`)).status === 403
      && (await fetch(`${S.base}/api/admin/presets`, { method: 'POST' })).status === 403);

    // ---- Jens designs a room with nature stickers ----
    const src = (await post('/api/rooms', { style: { floor: 'betong', wall: 'tegel' } })).j.room;
    const dctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const D = await dctx.newPage(); D.on('pageerror', (e) => errors.push(e.message));
    await D.goto(`${S.base}/?room=${src.id}`); await ready(D);
    await D.evaluate(() => window.klibb.setNatureMode(true, { quiet: true })); await sleep(800);
    const spots = [[0, 0.05, 0, 0], [0.35, 0.18, 0, 0], [-0.35, -0.08, 0, 0], [Math.PI / 2, 0.05, 0, 0], [Math.PI, 0.05, 0.2, 0.2], [-Math.PI / 2, 0.05, -0.2, 0], [0, -1.2, 0, 0], [0, 1.2, 0, 0]];
    let made = 0;
    for (let i = 0; i < spots.length; i++) {
      const [yaw, pitch, x, y] = spots[i];
      const ok = await D.evaluate(async ([yaw, pitch, x, y, i]) => {
        const k = window.klibb, nat = k.state.library.filter((d) => d.nature && !/\.jpe?g$/i.test(d.url || ''));
        await k.selectDesign(nat[(i * 7) % nat.length]); k.setSize(110 + i * 10);
        k.setView?.('first', { quiet: true }); k.moveTo(0, 2.5); k.look(yaw, pitch);
        await new Promise((r) => setTimeout(r, 150));
        return !!(await k.stampAt(x, y));
      }, [yaw, pitch, x, y, i]);
      if (ok) made++;
      await sleep(250);
    }
    await D.waitForFunction(() => window.klibb.pendingSlaps() === 0, null, { timeout: 15000 });
    check(`the designed room: ${made} nature stickers slapped (walls, floor, ceiling)`, made === spots.length, made);
    await pose(D); await sleep(1500);
    const shotSrc = path.join(SHOTS, '1-designed-room.png'); await clean(D, shotSrc);
    await pose(D, 0, -1.2); await sleep(1200);
    const shotSrcF = path.join(SHOTS, '1b-designed-room-floor.png'); await clean(D, shotSrcF);
    await dctx.close();

    // ---- admin saves it as a preset ----
    const actx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    await actx.addInitScript((t) => sessionStorage.setItem('klibb.admin', t), ADMIN);
    const A = await actx.newPage(); A.on('pageerror', (e) => errors.push(e.message));
    await A.goto(`${S.base}/?room=${src.id}`);
    await A.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.adminToken, null, { timeout: 30000 });
    await A.waitForFunction((n) => window.klibb.stamps.meshes.size >= n, made, { timeout: 30000 }); await sleep(2500);
    const btn = await A.evaluate(() => !document.getElementById('save-preset').hidden);
    check('admin: "🧩 Save as preset room" in Room ▾ (admin only)', btn);
    const preset = await A.evaluate(() => window.klibb.savePreset({ name: 'E2E forest' }));
    check('admin: saved – six images, the source room and its look', preset && preset.id && Object.keys(preset.faces).sort().join() === 'ceiling,east,floor,north,south,west' && preset.sourceRoom === src.id && preset.style && preset.style.wall === 'tegel', preset);
    check(`…every sticker of the room was baked in (${preset.stickers})`, preset.stickers >= made, preset.stickers);
    await actx.close();
    // the images: sizes and content
    const meta = {};
    for (const [f, u] of Object.entries(preset.faces)) {
      const buf = Buffer.from(await (await fetch(S.base + u)).arrayBuffer());
      const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let on = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 128) on++;
      meta[f] = { w: info.width, h: info.height, cover: +(on / (info.width * info.height)).toFixed(4) };
      fs.writeFileSync(path.join(SHOTS, `face-${f}.webp`), buf);
    }
    check('the images: floor/ceiling 1600×1600, walls 1600×640 (160 px/m), WebP with transparency', ['floor', 'ceiling'].every((f) => meta[f].w === 1600 && meta[f].h === 1600) && ['north', 'south', 'west', 'east'].every((f) => meta[f].w === 1600 && meta[f].h === 640), meta);
    check('…each surface that got stickers has them in its image; the rest is transparent', Object.values(meta).every((m) => m.cover > 0.004 && m.cover < 0.6), meta);
    const list = await (await fetch(`${S.base}/api/admin/presets`, { headers: { 'x-admin-token': ADMIN } })).json();
    check('admin: GET /api/admin/presets lists it', list.presets.length === 1 && list.presets[0].id === preset.id);

    // ---- a new user's room gets it ----
    const nu = await post('/api/rooms', {});
    check('a new user\'s room (POST /api/rooms {}, as landing.js) gets the preset: its look and its six images', nu.j.room.preset && nu.j.room.preset.id === preset.id && nu.j.room.style.wall === 'tegel' && Object.keys(nu.j.room.preset.faces).length === 6, nu.j.room);
    const picked = await post('/api/rooms', { style: { floor: 'betong', wall: 'puts' } });
    const none = await post('/api/rooms', { preset: false });
    check('"＋ New quick room" with a picked look, and { preset: false }: no preset', !picked.j.room.preset && !none.j.room.preset);
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    await ctx.addInitScript(([r, k]) => localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })), [nu.j.room.id, nu.j.roomKey]);
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${nu.j.room.id}`); await ready(P);
    await P.waitForFunction(() => window.klibb.preset().loaded === 6, null, { timeout: 20000 });
    const pi = await P.evaluate(() => ({ ...window.klibb.preset(), stamps: window.klibb.stamps.count, editHidden: document.getElementById('edit-style').hidden, canEdit: window.klibb.canEditStyle(), savePresetHidden: document.getElementById('save-preset').hidden }));
    check('in the browser: the six images are on floor, ceiling and the four walls', pi.room && pi.faces.join() === 'ceiling,east,floor,north,south,west', pi);
    check('…and no sticker objects (the nature stickers cannot be peeled or changed)', pi.stamps === 0, pi);
    check('…the walls are locked: no 🎨 Change room look (even for its creator); no admin button', pi.editHidden && pi.savePresetHidden, pi);
    const put = await fetch(`${S.base}/api/rooms/${nu.j.room.id}/style`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-room-key': nu.j.roomKey }, body: JSON.stringify({ style: { floor: 'betong', wall: 'puts' } }) });
    check('…PUT style with the room key → 403 (preset: walls locked)', put.status === 403, put.status);
    await pose(P); await sleep(1500);
    const shotPre = path.join(SHOTS, '2-preset-room-same-view.png'); await clean(P, shotPre);
    await pose(P, 0, -1.2); await sleep(1200);
    const shotPreF = path.join(SHOTS, '2b-preset-room-floor.png'); await clean(P, shotPreF);
    // an empty room with the same look, the same view: how far "no stickers" is
    const ectx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const E = await ectx.newPage();
    const empty = (await post('/api/rooms', { style: preset.style })).j.room;
    await E.goto(`${S.base}/?room=${empty.id}`); await ready(E); await pose(E); await sleep(1500);
    const shotEmpty = path.join(SHOTS, '0-empty-room-same-view.png'); await clean(E, shotEmpty);
    await pose(E, 0, -1.2); await sleep(1200);
    const shotEmptyF = path.join(SHOTS, '0b-empty-room-floor.png'); await clean(E, shotEmptyF); await ectx.close();
    for (const [what, a, b, c, crop] of [['the north wall', shotSrc, shotPre, shotEmpty, { left: 230, top: 170, width: 380, height: 200 }], ['the floor', shotSrcF, shotPreF, shotEmptyF, null]]) {
      const dPre = await meanDiff(a, b, crop), dEmpty = await meanDiff(a, c, crop);
      check(`${what}: the preset room looks like the designed one (mean pixel diff ${dPre.toFixed(2)}, vs ${dEmpty.toFixed(2)} for the empty room)`, dPre < dEmpty * 0.5, { dPre, dEmpty });
    }
    // slap my own sticker on top
    const mine = await P.evaluate(async () => { const k = window.klibb; k.setNatureMode(false, { quiet: true }); k.look(0, 0.05); return !!(await k.stampAt(0.1, 0.1)); });
    await sleep(600);
    check('people can still slap their own stickers on top', mine && (await P.evaluate(() => window.klibb.stamps.count)) > 0);
    await P.screenshot({ path: path.join(SHOTS, '3-preset-room-own-sticker-on-top.png') });
    await pose(P, Math.PI / 2, 0.05); await sleep(800); await P.screenshot({ path: path.join(SHOTS, '4-preset-room-east.png') });
    await pose(P, 0, -1.0); await sleep(800); await P.screenshot({ path: path.join(SHOTS, '5-preset-room-floor.png') });
    await ctx.close();

    // ---- the script: a room code → a preset ----
    const out = await new Promise((ok) => execFile(process.execPath, [path.join(__dirname, '..', 'scripts', 'make-preset.js'), src.id, '--base', S.base, '--name', 'From the script'],
      { env: { ...process.env, ADMIN_TOKEN: ADMIN }, timeout: 180000 }, (err, so, se) => ok({ err, so: String(so), se: String(se) })));
    const list2 = await (await fetch(`${S.base}/api/admin/presets`, { headers: { 'x-admin-token': ADMIN } })).json();
    check('scripts/make-preset.js <room code>: makes a preset (now 2) and never prints the token', !out.err && /preset [a-f0-9]+ from room/.test(out.so) && list2.presets.length === 2 && !out.so.includes(ADMIN) && !out.se.includes(ADMIN), out);
    const picks = new Set(); for (let i = 0; i < 16; i++) picks.add((await post('/api/rooms', {})).j.room.preset?.id);
    check('with two presets, new users get one of them at random', picks.size === 2 && [...picks].every(Boolean), [...picks]);
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await browser.close(); S.child.kill();
  console.log(`\nPreset rooms e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
