// E2E: the random character in a preset room (Jens, 29 Oct 2026, point 8). Free version (OPEN_ACCESS
// off): in a room that got a preset I am a random character (outfit, hair, colours, skin/face; my
// name kept), the same on reload, seen by the others and in the recording; My avatar shows it with the
// look locked and one calm line. My own avatar stays saved and is back in other rooms. Full version
// (dev unlock) and OPEN_ACCESS on: my own avatar. The deck stays the free one.
// Own servers (ROOMCHAR_E2E_PORT, default 8898, and +1). Screenshots → /workspace/face-shots/ (FACE_SHOTS).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.ROOMCHAR_E2E_PORT || 8898);
const SHOTS = process.env.FACE_SHOTS || '/workspace/face-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
const OWN = { outfit: 'tshirt', hair: 'kort', shirt: '#3a86ff', pants: '#2b4c7e', hairColor: '#4a2c17', skin: '#e0ac69', hat: false, hatColor: '#e63946' };
const LOOK_KEYS = ['outfit', 'hair', 'shirt', 'pants', 'hairColor', 'skin', 'hat', 'hatColor'];
const same = (a, b) => !!a && !!b && LOOK_KEYS.every((k) => a[k] === b[k]) && (a.face || null) === (b.face || null);
let ipN = 0;
const mkRoom = async (S, body = {}) => (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.7.${++ipN}.9` }, body: JSON.stringify(body) })).json();
async function makePreset(S) {
  const src = (await mkRoom(S, { style: { floor: 'parkett', wall: 'tegel' } })).room;
  const fd = new FormData(); fd.append('sourceRoom', src.id); fd.append('name', 'Skogen');
  for (const f of ['north', 'south', 'east', 'west', 'floor', 'ceiling']) {
    const b = await sharp({ create: { width: 128, height: f === 'floor' || f === 'ceiling' ? 128 : 64, channels: 4, background: { r: 40, g: 120 + f.length * 10, b: 70, alpha: 1 } } }).png().toBuffer();
    fd.append(f, new Blob([b], { type: 'image/png' }), `${f}.png`);
  }
  const r = await fetch(`${S.base}/api/admin/presets`, { method: 'POST', headers: { 'x-admin-token': 'demo-e2e-admin' }, body: fd });
  return (await r.json()).preset;
}
async function context(browser, { name, device, dev = false, key = null }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(([name, device, dev, own, key]) => {
    if (localStorage.getItem('klibb.device')) return;
    localStorage.setItem('klibb.device', device);
    localStorage.setItem('klibb.avatar', JSON.stringify({ name, look: own }));
    if (dev) localStorage.setItem('klibb.devUnlock', '1');
    if (key) localStorage.setItem('klibb.roomKeys', JSON.stringify(key));
  }, [name, device, dev, OWN, key]);
  return ctx;
}
async function enterRoom(page, S, R, errors, tag) {
  page.on('pageerror', (e) => errors.push(tag + ': ' + e.message));
  await page.goto(`${S.base}/?room=${R}`);
  await page.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.net.status === 'online' && window.klibb.net.id && window.klibb.roomInfo, null, { timeout: 30000 });
  await page.evaluate(() => window.klibb.entitlementsReady());
  await sleep(400);
  return page;
}
const info = (P) => P.evaluate(() => { const k = window.klibb, e = k.entitlements();
  return { id: k.net.id, roomLook: k.roomLook(), saved: JSON.parse(localStorage.getItem('klibb.avatar')), self: k.selfAvatar().look, own: e.full.ownAvatar, open: e.open,
    nature: e.full.natureStickers, lib: k.stickerDesigns().filter((d) => d.library).length, mine: k.stickerDesigns().filter((d) => !d.library).length, preset: !!(k.roomInfo.preset && k.roomInfo.preset.faces) }; });

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const { seededLook, roomCharacterSeed } = await import('../shared/randomlook.mjs');
  const AV = require('../shared/avatar.json');
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const FREE = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '0' });
  const OPEN = await startServer(PORT + 1, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const errors = [];
  try {
    const plain = await mkRoom(FREE); // before any preset: a room without one
    const preset = await makePreset(FREE);
    const made = await mkRoom(FREE), R = made.room.id, KEY = made.roomKey;
    check('setup: a preset exists and a new room gets it', preset && made.room.preset && made.room.preset.id === preset.id, made.room.preset);
    const api = (m, p) => fetch(`${FREE.base}/api/rooms/${R}${p}`, { method: m, headers: { 'Content-Type': 'application/json', 'x-room-key': KEY }, body: '{}' }).then((r) => r.json());
    const want = seededLook(AV, roomCharacterSeed(R, 'device-free-1'));

    const rec = await api('POST', '/recording/start');
    const ctxF = await context(browser, { name: 'Frida', device: 'device-free-1' });
    const ctxU = await context(browser, { name: 'Ulf', device: 'device-full-1', dev: true });
    const F = await enterRoom(await ctxF.newPage(), FREE, R, errors, 'F');
    const U = await enterRoom(await ctxU.newPage(), FREE, R, errors, 'U');
    const f = await info(F);
    check('free, preset room: I am the room\'s random character (seed = room + my device)', !f.own && !f.open && f.preset && same(f.roomLook, want) && !same(want, OWN), { f, want });
    check('…my own avatar stays saved on the device (for my other rooms)', same(f.saved.look, OWN) && f.saved.name === 'Frida', f.saved);
    await U.waitForFunction((id) => window.klibb.players().some((p) => p.id === id && p.built), f.id, { timeout: 15000 });
    const seenByU = await U.evaluate((id) => window.klibb.players().find((p) => p.id === id), f.id);
    check('the other player sees the random character, with my name', same(seenByU.look, want) && seenByU.name === 'Frida', seenByU && { look: seenByU.look, name: seenByU.name });
    const u = await info(U);
    await F.waitForFunction((id) => window.klibb.players().some((p) => p.id === id), u.id, { timeout: 15000 });
    const seenByF = await F.evaluate((id) => window.klibb.players().find((p) => p.id === id), u.id);
    check('full version (dev unlock) in the same room: keeps my own avatar (and is seen so)', u.own && u.roomLook === null && same(seenByF.look, OWN), { u, seen: seenByF?.look });
    check('free deck in the preset room: the free library deck (no nature) + at most my one upload', f.nature === false && f.lib > 50 && f.mine <= 1, f);

    // My avatar: shows the character, look locked, name editable, one calm line
    await F.evaluate(() => { const k = window.klibb; k.moveTo(0, 0.5); k.look(0, 0); k.openAvatarPanel(); });
    await F.waitForFunction(() => { const v = window.klibb.avatarView(); return v && v.visible; }, null, { timeout: 15000 });
    await sleep(900);
    const panel = await F.evaluate(() => { const p = document.getElementById('avatar-panel'), note = document.getElementById('av-room-note');
      const ctl = [...p.querySelectorAll('button, input')].filter((e) => !['av-name', 'av-ok', 'av-cancel'].includes(e.id));
      return { locked: p.classList.contains('room-character'), note: note && !note.hidden ? note.textContent : '', disabled: ctl.filter((e) => e.disabled).length, total: ctl.length,
        name: !document.getElementById('av-name').disabled, ok: !document.getElementById('av-ok').disabled, full: !!document.querySelector('#full-panel[open], #full-dialog[open]'), view: window.klibb.selfAvatar().look }; });
    check('My avatar opens and shows the room\'s character (not the full-version panel)', panel.locked && !panel.full && same(panel.view, want), panel);
    check('…every look control is locked, the name and Save are not', panel.total > 20 && panel.disabled === panel.total && panel.name && panel.ok, panel);
    check('…with one calm line why (no upsell)', /surprise character/.test(panel.note) && /other rooms/.test(panel.note) && !/full version|upgrade|buy/i.test(panel.note), panel.note);
    await F.screenshot({ path: path.join(SHOTS, '6-avatar-panel-locked.png') });
    await F.fill('#av-name', 'Frida B');
    await F.click('#av-ok');
    await sleep(600);
    const afterSave = await info(F);
    check('Save keeps the name change but not the character: my own look is still mine', afterSave.saved.name === 'Frida B' && same(afterSave.saved.look, OWN) && same(afterSave.roomLook, want), afterSave.saved);
    await U.waitForFunction((id) => window.klibb.players().find((p) => p.id === id)?.name === 'Frida B', f.id, { timeout: 10000 }).catch(() => {});
    const seen2 = await U.evaluate((id) => window.klibb.players().find((p) => p.id === id), f.id);
    check('…the others see the new name on the same character', seen2.name === 'Frida B' && same(seen2.look, want), { name: seen2.name, look: seen2.look });
    // A third-person view of the random character, as the other player sees it
    await F.evaluate(() => { const k = window.klibb; k.moveTo(0, -0.6); k.look(0, 0); });
    await U.evaluate(() => { const k = window.klibb; k.moveTo(0, 2.2); k.look(0, -0.05); });
    await sleep(1500);
    await U.screenshot({ path: path.join(SHOTS, '6-preset-random-character.png') });

    // Reload: the same character
    await F.reload();
    await enterRoom(F, FREE, R, errors, 'F2');
    const f2 = await info(F);
    check('reload: the same character again (stable)', same(f2.roomLook, want), f2.roomLook);
    // Recording: the joins and looks carry the character
    const stop = await api('POST', '/recording/stop');
    const log = (await (await fetch(`${FREE.base}/api/rooms/${R}/recordings/${(stop.recording || rec.recording).recId}/log`)).text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const mineLooks = log.filter((e) => (e.e === 'look' || e.e === 'join') && (e.name === 'Frida' || e.name === 'Frida B' || e.id === f.id || e.id === f2.id));
    check('the recording has the random character (so the replay draws it), never my own look', mineLooks.length >= 2 && mineLooks.every((e) => same(e.look, want)), mineLooks.map((e) => ({ e: e.e, name: e.name, outfit: e.look?.outfit })));

    // Another room without a preset: my own avatar is back
    const F3 = await enterRoom(await ctxF.newPage(), FREE, plain.room.id, errors, 'F3');
    const f3 = await info(F3);
    check('a room without a preset: my own avatar (free too)', !f3.preset && f3.roomLook === null, f3);
    // Another preset room: another character
    const R2 = (await mkRoom(FREE)).room.id;
    const F4 = await enterRoom(await ctxF.newPage(), FREE, R2, errors, 'F4');
    const f4 = await info(F4);
    check('another preset room: another character (seeded by that room)', same(f4.roomLook, seededLook(AV, roomCharacterSeed(R2, 'device-free-1'))) && !same(f4.roomLook, want), f4.roomLook);

    // OPEN_ACCESS on: no room character
    await makePreset(OPEN);
    const RO = (await mkRoom(OPEN)).room;
    const ctxO = await context(browser, { name: 'Olle', device: 'device-open-1' });
    const O = await enterRoom(await ctxO.newPage(), OPEN, RO.id, errors, 'O');
    const o = await info(O);
    check('OPEN_ACCESS on: a preset room, but my own avatar (everything open)', !!RO.preset && o.open && o.own && o.roomLook === null, o);
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  finally { await browser.close(); FREE.child.kill(); OPEN.child.kill(); }
  console.log(`\nRoom character e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
