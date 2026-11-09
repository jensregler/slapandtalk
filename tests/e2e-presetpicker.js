// E2E: presets via make-preset.js + POST /api/rooms (landing is city-only since Nov 2026).
// Presets are made the real way
// (a room with nature stickers → scripts/make-preset.js, which also takes the picker's picture from the
// PRESET, not from its room), one more without a picture (the wall stands in), named with
// make-preset.js --rename; then the source rooms are DELETED, and the picker still offers the presets
// and a room made from one still looks like it (the presets are snapshots). Blank room is the default.
// Own server (PRESETPICKER_E2E_PORT, default 8903). Screenshots: PRESETPICKER_SHOTS (/workspace/presetpicker-shots).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { chromium } = require('playwright');
const sharp = require('sharp');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.PRESETPICKER_E2E_PORT || 8903);
const SHOTS = process.env.PRESETPICKER_SHOTS || '/workspace/presetpicker-shots';
const ADMIN = 'presetpicker-e2e-admin';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };

async function assertLandingIsCityOnly(page) {
  await page.waitForSelector('#sc-splash', { timeout: 15000 });
  return page.evaluate(() => !document.getElementById('sc-new') && !document.getElementById('sc-preset') && !!document.getElementById('sc-splash'));
}
const script = (base, ...a) => new Promise((ok) => execFile(process.execPath, [path.join(__dirname, '..', 'scripts', 'make-preset.js'), ...a, '--base', base], { env: { ...process.env, ADMIN_TOKEN: ADMIN }, timeout: 240000 }, (err, so, se) => ok({ err, so, se })));
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1', ADMIN_TOKEN: ADMIN, EMPTY_ROOM_GRACE_SECONDS: '15' });
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errs = [];
  let ip = 0;
  const post = async (body) => (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.7.${++ip}.1` }, body: JSON.stringify(body) })).json();
  const H = { 'x-admin-token': ADMIN };
  try {
    check('GET /api/presets: none yet → []', (await (await fetch(`${S.base}/api/presets`)).json()).presets.length === 0);
    // Landing no longer offers PRESET / NEW GAME – city-name flow only.
    const p0 = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage(); p0.on('pageerror', (e) => errs.push(e.message));
    await p0.goto(`${S.base}/`);
    check('landing is city-only (no PRESET / NEW GAME menus)', await assertLandingIsCityOnly(p0));
    await p0.context().close();

    // ---- Jens designs a room with nature stickers; the script makes it a preset (+ its picture) ----
    const src = (await post({ style: { floor: 'betong', wall: 'tegel' }, preset: false })).room;
    const D = await (await b.newContext({ viewport: { width: 1200, height: 800 } })).newPage(); D.on('pageerror', (e) => errs.push(e.message));
    await D.goto(`${S.base}/?room=${src.id}`);
    await D.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected && window.klibb.state.library.length > 0, null, { timeout: 30000 });
    await D.evaluate(() => window.klibb.setNatureMode(true, { quiet: true })); await sleep(800);
    const spots = [[0, 0.05, 0, 0], [0.35, 0.18, 0, 0], [-0.35, -0.08, 0, 0], [0.15, -0.5, 0, 0], [-0.2, 0.4, 0, 0]];
    for (let i = 0; i < spots.length; i++) {
      await D.evaluate(async ([yaw, pitch, x, y, i]) => {
        const k = window.klibb, nat = k.state.library.filter((d) => d.nature && !/\.jpe?g$/i.test(d.url || ''));
        await k.selectDesign(nat[(i * 7) % nat.length]); k.setSize(150 + i * 20);
        k.setView?.('first', { quiet: true }); k.moveTo(0, 2.5); k.look(yaw, pitch);
        await new Promise((r) => setTimeout(r, 150)); return !!(await k.stampAt(x, y));
      }, [...spots[i], i]);
      await sleep(250);
    }
    await D.waitForFunction(() => window.klibb.pendingSlaps() === 0, null, { timeout: 15000 });
    await D.context().close(); await sleep(500);
    const out = await script(S.base, src.id, '--name', 'Skogen');
    const list1 = (await (await fetch(`${S.base}/api/presets`)).json()).presets;
    check('make-preset.js <code> --name "Skogen": a preset, its display name, a picture; the token never printed', !out.err && list1.length === 1 && list1[0].title === 'Skogen' && /thumb\.webp/.test(list1[0].thumb || '') && !(out.so + out.se).includes(ADMIN), { so: out.so, se: out.se, list1 });
    const th = await fetch(S.base + list1[0].thumb); const tm = await sharp(Buffer.from(await th.arrayBuffer())).metadata();
    check('…the picture is a WebP (960×600) of the room', th.ok && tm.format === 'webp' && tm.width === 960 && tm.height === 600, tm);
    fs.writeFileSync(path.join(SHOTS, '00-preset-picture-skogen.webp'), Buffer.from(await (await fetch(S.base + list1[0].thumb)).arrayBuffer()));

    // ---- a second one (plain images, no picture): shown by its room code until named ----
    const src2 = (await post({ style: { floor: 'parkett', wall: 'puts' }, preset: false })).room;
    const fd = new FormData(); fd.append('sourceRoom', src2.id);
    for (const f of ['floor', 'ceiling', 'north', 'south', 'west', 'east']) fd.append(f, new Blob([await sharp({ create: { width: 200, height: f === 'floor' || f === 'ceiling' ? 200 : 80, channels: 4, background: { r: 200, g: 40, b: 90, alpha: f === 'north' ? 0.9 : 0 } } }).png().toBuffer()], { type: 'image/png' }), f + '.png');
    const p2 = (await (await fetch(`${S.base}/api/admin/presets`, { method: 'POST', headers: H, body: fd })).json()).preset;
    let pub = (await (await fetch(`${S.base}/api/presets`)).json()).presets;
    const q2 = pub.find((x) => x.id === p2.id);
    check('a preset not named yet: title "" and its room code (the picker shows the code); no picture → the wall', q2 && q2.title === '' && q2.code === src2.id && !q2.thumb && /north\.webp/.test(q2.wall), q2);
    check('GET /api/presets is public and small: no style, no faces, no keys', pub.every((x) => !('style' in x) && !('faces' in x)) && !JSON.stringify(pub).includes('key'), pub);
    check('PATCH /api/admin/presets/:id: admin only', (await fetch(`${S.base}/api/admin/presets/${p2.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"title":"x"}' })).status === 403);
    const rn = await script(S.base, '--rename', src2.id, 'Källaren');
    pub = (await (await fetch(`${S.base}/api/presets`)).json()).presets;
    check('make-preset.js --rename <room code> "Källaren": named (by its room code works too)', !rn.err && /now shown as: Källaren/.test(rn.so) && pub.find((x) => x.id === p2.id).title === 'Källaren' && !(rn.so + rn.se).includes(ADMIN), rn);
    const ls = await script(S.base, '--list');
    check('make-preset.js --list shows names and pictures', /"Skogen"/.test(ls.so) && /"Källaren"/.test(ls.so) && /picture ✓/.test(ls.so), ls.so);
    await script(S.base, '--rename', p2.id, ''); // back to the code, then name it again for the screenshots
    check('--rename <id> "": back to the room code', (await (await fetch(`${S.base}/api/presets`)).json()).presets.find((x) => x.id === p2.id).title === '');
    await script(S.base, '--rename', p2.id, 'Källaren');

    // ---- the source rooms go (as on the live site): the presets do not need them ----
    const store = path.join(S.dir, 'rooms');
    for (const f of fs.existsSync(store) ? fs.readdirSync(store) : []) if (f.startsWith(src.id) || f.startsWith(src2.id)) fs.rmSync(path.join(store, f), { recursive: true, force: true });
    // (the server keeps rooms in memory too; a restart reads the disk)
    S.child.kill(); await sleep(800);
    Object.assign(S, await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1', ADMIN_TOKEN: ADMIN, DATA_DIR: S.dir, EMPTY_ROOM_GRACE_SECONDS: '2' }));
    const gone = await (await fetch(`${S.base}/api/rooms/recent?ids=${src.id},${src2.id}`)).json();
    pub = (await (await fetch(`${S.base}/api/presets`)).json()).presets;
    check('the source rooms deleted (+ a restart): both presets still offered, with names and pictures', gone.missing.length === 2 && pub.length === 2 && pub[0].title === 'Skogen' && pub[0].thumb, { gone, pub });

    // ---- Preset rooms via API (landing no longer has PRESET / EMPTY ROOM menus) ----
    const made = await post({ preset: list1[0].id, name: 'Malmö slaps' });
    check('POST /api/rooms { preset: Skogen }: room made from preset', made.room && made.room.preset && made.room.preset.id === list1[0].id && made.room.name === 'Malmö slaps', made.room);
    const p = await (await b.newContext({ viewport: { width: 900, height: 1000 } })).newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${S.base}/?room=${made.room.id}`);
    await p.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.presetLayer && window.klibb.presetLayer().loaded >= 6, null, { timeout: 40000 });
    const r = await p.evaluate(async () => { const j = (await (await fetch('/api/rooms/' + window.klibb.room)).json()).room; return { name: j.name, preset: j.preset && j.preset.id, floor: j.style.floor, stickers: j.stickers }; });
    check('opening Skogen room: look + six images (source room gone)', r.name === 'Malmö slaps' && r.preset === list1[0].id && r.floor === 'betong', r);
    await p.evaluate(() => { const k = window.klibb; k.setView?.('first', { quiet: true }); k.moveTo(0, 4.4); k.look(0, -0.12); }); await sleep(1500);
    await p.screenshot({ path: path.join(SHOTS, '04-room-from-skogen.png') });
    // EMPTY ROOM: { preset: false } – no preset even though there are some
    const empty = await post({ preset: false, name: 'Blank' });
    check('EMPTY ROOM via API: the new room has no preset', empty.room && !empty.room.preset, empty.room);
    const p3 = await (await b.newContext({ viewport: { width: 900, height: 1000 } })).newPage(); p3.on('pageerror', (e) => errs.push(e.message));
    await p3.goto(`${S.base}/?room=${empty.room.id}`);
    await p3.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 40000 });
    const r3 = await p3.evaluate(async () => (await (await fetch('/api/rooms/' + window.klibb.room)).json()).room);
    check('EMPTY ROOM loads without preset layer', !r3.preset, r3);
    // phone landing still city-only
    const m = await (await b.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage(); m.on('pageerror', (e) => errs.push(e.message));
    await m.goto(`${S.base}/`); check('phone landing is city-only', await assertLandingIsCityOnly(m));
    await m.screenshot({ path: path.join(SHOTS, '05-phone-new-room-card.png') });
    // deep links untouched
    const dl = await (await b.newContext()).newPage();
    await dl.goto(`${S.base}/?room=${r3.id}`); await dl.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    check('a deep link (?room=) still goes straight into the room (no card)', await dl.evaluate(() => !document.getElementById('start-card')));
    check('no page errors', errs.length === 0, errs);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await b.close(); S.child.kill();
  console.log(`\nPreset picker e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
