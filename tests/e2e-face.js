// E2E: the avatar's own face (Jens, 29 Oct 2026): in My avatar a 'Face' row like 'Top' – a colour
// (swatches, Same as skin, any colour), a fabric (stickers / recent / patterns, like the top) and a
// face photo mapped onto the front of the head. Live on the zoomed avatar, saved, seen by the other
// player, in the recording log and in a 📷 photo.
// Own server (FACE_E2E_PORT, default 8897). Screenshots: FACE_SHOTS (default /workspace/face-shots).
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.FACE_E2E_PORT || 8897);
const SHOTS = process.env.FACE_SHOTS || '/workspace/face-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
// A cartoon face photo: orange face, big white eyes with blue irises, a red smile, on a grey background.
const FACE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"><rect width="640" height="800" fill="#8a8f99"/>
  <ellipse cx="320" cy="400" rx="230" ry="300" fill="#ff8800"/>
  <ellipse cx="235" cy="350" rx="55" ry="40" fill="#fff"/><ellipse cx="405" cy="350" rx="55" ry="40" fill="#fff"/>
  <circle cx="235" cy="352" r="24" fill="#1e5bff"/><circle cx="405" cy="352" r="24" fill="#1e5bff"/>
  <rect x="190" y="285" width="95" height="16" rx="8" fill="#3b2000"/><rect x="355" y="285" width="95" height="16" rx="8" fill="#3b2000"/>
  <path d="M220 520 Q320 610 420 520" stroke="#d0002a" stroke-width="26" fill="none" stroke-linecap="round"/></svg>`;

// A close-up of my avatar's head on screen (seen through the showcase camera or the given camera).
async function headShot(p, file, which = 'show') {
  const box = await p.evaluate((which) => {
    const k = window.klibb, cam = which === 'show' ? k.showCam : which === 'tp' ? k.tpCam : k.camera;
    const at = which === 'show' ? k.avatarView().pos : k.players()[0].pos;
    const pr = (y) => { const q = cam.position.clone().set(at[0], y, at[2]).project(cam); return [(q.x + 1) / 2 * innerWidth, (1 - q.y) / 2 * innerHeight]; };
    const top = pr(1.7), chin = pr(1.28), h = chin[1] - top[1]; // the avatar is 0.9 × the model: head top ≈ 1.61 m, chin ≈ 1.35 m
    return { x: Math.max(0, top[0] - h * 0.6), y: Math.max(0, top[1] - h * 0.1), width: h * 1.2, height: h * 1.2, cx: top[0], cy: pr(1.47)[1], r: Math.max(6, h * 0.12) };
  }, which);
  await p.screenshot({ path: file, clip: { x: box.x, y: box.y, width: Math.min(box.width, 1280 - box.x), height: Math.min(box.height, 800 - box.y) } });
  return box;
}
// How much of a region of the screen is close to a colour (0…1).
// orange-ish (the photo's face, lit or in shade): red well above green, green well above blue
const orange = (r, g, b) => r > 110 && r > g * 1.3 && g > b * 2.2 && g > 35; // (the default skin #e0ac69 is not)
async function colourShare(p, box) {
  const png = await p.screenshot({ clip: { x: box.cx - box.r, y: box.cy - box.r, width: box.r * 2, height: box.r * 2 } });
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let hit = 0; const n = info.width * info.height;
  for (let i = 0; i < n; i++) { const o = i * info.channels; if (orange(data[o], data[o + 1], data[o + 2])) hit++; }
  return hit / n;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const facePng = path.join(os.tmpdir(), 'e2e-face-photo.png');
  await sharp(Buffer.from(FACE_SVG)).png().toFile(facePng);
  const S = await startServer(PORT, { DEMO_PROFILE: '0' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  try {
    const { room: { id: R }, roomKey: KEY } = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const api = (m, p, body = {}) => fetch(`${S.base}/api/rooms/${R}${p}`, { method: m, headers: { 'Content-Type': 'application/json', 'x-room-key': KEY }, body: JSON.stringify(body) }).then((r) => r.json());
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctxA.addInitScript(([r, k]) => localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })), [R, KEY]);
    await ctxA.addInitScript(() => localStorage.setItem('klibb.avatar', JSON.stringify({ name: 'Ansikte', look: { outfit: 'tshirt', hair: 'kort', shirt: '#3a86ff', pants: '#2b4c7e', hairColor: '#4a2c17', skin: '#e0ac69', hat: false, hatColor: '#e63946' } })));
    const A = await ctxA.newPage(); A.on('pageerror', (e) => errors.push('A: ' + e.message));
    const B = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); B.on('pageerror', (e) => errors.push('B: ' + e.message));
    for (const P of [A, B]) {
      await P.goto(`${S.base}/?room=${R}`);
      await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.net.status === 'online' && window.klibb.net.id, null, { timeout: 30000 });
    }
    const idA = await A.evaluate(() => window.klibb.net.id);
    const fabricsOn = await A.evaluate(async () => { await window.klibb.entitlementsReady?.(); return !!window.klibb.entitlements().full.fabrics; });
    check('fabrics are open (OPEN_ACCESS), so the face fabric/photo is offered', fabricsOn);
    const rec = await api('POST', '/recording/start');
    await A.evaluate(() => { const k = window.klibb; k.moveTo(0, 0.5); k.look(0, 0); });
    await A.evaluate(() => window.klibb.openAvatarPanel());
    await A.waitForFunction(() => { const v = window.klibb.avatarView(); return v && v.visible && window.klibb.selfAvatar().face; }, null, { timeout: 15000 });
    const ui = await A.evaluate(() => { const row = document.querySelector('#avatar-panel .fab-slot[data-slot="face"]');
      return { row: !!row, label: row?.querySelector('b')?.textContent, swatches: row?.querySelectorAll('#av-face button[data-id^="#"]').length,
        same: !!row?.querySelector('.face-same.sel'), any: !!row?.querySelector('input[type=color]'), seg: !!row?.querySelector('.fab-seg'),
        afterSkin: row?.previousElementSibling?.dataset.slot === 'skin', face: window.klibb.selfAvatar().face };
    });
    check('My avatar has a "Face" row right after Skin: swatches, "Same as skin" (selected), any colour, Colour | Fabric', ui.row && ui.label === 'Face' && ui.swatches >= 10 && ui.same && ui.any && ui.seg && ui.afterSkin, ui);
    check('…the face is its own material on the head (split from the skin), following the skin colour for now', ui.face.split && ui.face.colour === ui.face.skin && ui.face.eyes, ui.face);

    // 1) colour
    await A.evaluate(() => { window.klibb.avatarView(); document.querySelector('#av-face button[data-id="#7cff4f"]').click(); });
    await A.evaluate(() => window.klibb.look(0, 0)); await sleep(500);
    const c1 = await A.evaluate(() => ({ face: window.klibb.selfAvatar().face, draft: window.klibb.avatarView().draft }));
    check('Face colour: live on the zoomed avatar, the skin (hands, neck) unchanged', c1.face.colour === '#7cff4f' && c1.face.skin === '#e0ac69' && c1.draft.face === '#7cff4f', c1);
    await A.evaluate(() => { const k = window.klibb; }); // let the sway bring it round to the front
    await sleep(200);
    await A.screenshot({ path: path.join(SHOTS, '1-colour-avatar-view.png') });
    await headShot(A, path.join(SHOTS, '1-colour-closeup.png'));
    await A.evaluate(() => { const i = document.getElementById('av-face-any'); i.value = '#123456'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
    await sleep(200);
    const c2 = await A.evaluate(() => window.klibb.selfAvatar().face.colour);
    check('…any colour from the colour picker', c2 === '#123456', c2);
    await A.evaluate(() => document.querySelector('#av-face .face-same').click()); await sleep(200);
    const c3 = await A.evaluate(() => ({ f: window.klibb.selfAvatar().face, d: window.klibb.avatarView().draft }));
    check('…"Same as skin" puts it back (no face field in the look)', c3.f.colour === '#e0ac69' && !('face' in c3.d), c3);
    await A.evaluate(() => document.querySelector('#av-face button[data-id="#ff70a6"]').click()); await sleep(200);

    // 2) fabric (a pattern, like the top)
    await A.evaluate(() => document.querySelector('.fab-slot[data-slot="face"] .fab-seg button[data-mode="fabric"]').click()); await sleep(200);
    const picks = await A.evaluate(() => [...document.querySelectorAll('.fab-slot[data-slot="face"] .fab-picks button')].map((b) => b.title));
    check('Face → Fabric: the same picker as the top (patterns etc.) plus "📷 Upload image" and "🙂 Face photo"', picks.some((t) => /Stripes/.test(t)) && await A.evaluate(() => !!document.querySelector('.fab-slot[data-slot="face"] .fab-photo') && !!document.querySelector('.fab-slot[data-slot="face"] .fab-up:not(.fab-photo)')), picks);
    await A.evaluate(() => [...document.querySelectorAll('.fab-slot[data-slot="face"] .fab-picks button')].find((b) => /Checks/.test(b.title)).click());
    await A.waitForFunction(() => window.klibb.selfAvatar().face.fabric?.loaded, null, { timeout: 15000 });
    await sleep(400);
    const f1 = await A.evaluate(() => ({ face: window.klibb.selfAvatar().face, fab: window.klibb.selfAvatar().fabrics }));
    check('…a face fabric, live; the top and skin keep theirs (none)', f1.face.fabric && !f1.face.fabric.photo && f1.face.eyes && !f1.fab.shirt && !f1.fab.skin, f1);
    await A.screenshot({ path: path.join(SHOTS, '2-fabric-avatar-view.png') });
    await headShot(A, path.join(SHOTS, '2-fabric-closeup.png'));

    // 3) face photo
    const [chooser] = await Promise.all([A.waitForEvent('filechooser'), A.evaluate(() => document.querySelector('.fab-slot[data-slot="face"] .fab-photo').click())]);
    await chooser.setFiles(facePng);
    await A.waitForFunction(() => { const f = window.klibb.selfAvatar().face; return f.photo && f.fabric?.loaded; }, null, { timeout: 15000 });
    await sleep(500);
    const p1 = await A.evaluate(() => ({ face: window.klibb.selfAvatar().face, draft: window.klibb.avatarView().draft.fabric }));
    check('Face photo: uploaded, on the front of the head; the model\'s own eyes/brows step aside', p1.face.photo && !p1.face.eyes && p1.draft.face.photo === true, p1);
    // the sway: wait until it faces the camera (within ~10°) before judging the pixels
    await A.waitForFunction(() => { const v = window.klibb.avatarView(); return Math.abs(Math.sin(v.phase)) < 0.2; }, null, { timeout: 15000, polling: 50 });
    const box = await headShot(A, path.join(SHOTS, '3-photo-closeup.png'));
    await A.screenshot({ path: path.join(SHOTS, '3-photo-avatar-view.png') });
    const share = await colourShare(A, box);
    check('…the photo is really on the face (the middle of the face shows the photo\'s orange)', share > 0.25, { share });
    const zoomBefore = await A.evaluate(() => window.klibb.avatarView().draft.fabric.face.scale);
    await A.evaluate(() => { const r = document.querySelector('.fab-slot[data-slot="face"] .fab-sl[data-param="scale"] input[type=range]'); r.value = '1.3'; r.dispatchEvent(new Event('input', { bubbles: true })); });
    await sleep(200);
    check('…Zoom moves it (scale slider, live)', zoomBefore === 1 && await A.evaluate(() => window.klibb.avatarView().draft.fabric.face.scale) === 1.3);
    await A.evaluate(() => { const r = document.querySelector('.fab-slot[data-slot="face"] .fab-sl[data-param="scale"] input[type=range]'); r.value = '1'; r.dispatchEvent(new Event('input', { bubbles: true })); });

    // 4) save → saved, the other player sees it, the recording has it
    await A.evaluate(() => document.getElementById('av-ok').click()); await sleep(300);
    const saved = await A.evaluate(() => JSON.parse(localStorage.getItem('klibb.avatar')).look);
    check('Save: the face colour and the face photo are saved with the avatar', saved.face === '#ff70a6' && saved.fabric?.face?.photo === true, saved);
    await A.evaluate(() => { const k = window.klibb; k.moveTo(0, 0.5); k.look(0, 0); });
    await B.evaluate(() => { const k = window.klibb; k.moveTo(0, -1.3); k.look(Math.PI, -0.05); });
    await B.waitForFunction(() => { const p = window.klibb.players()[0]; return p && p.face && p.face.photo && p.face.fabric?.loaded; }, null, { timeout: 15000 });
    await sleep(1500);
    const seen = await B.evaluate(() => window.klibb.players()[0]);
    check('the other player sees my face photo and face colour (synced like the top fabric)', seen.look.face === '#ff70a6' && seen.look.fabric.face.photo && seen.face.photo && !seen.face.eyes, { look: seen.look, face: seen.face });
    await B.screenshot({ path: path.join(SHOTS, '4-seen-by-the-other-player.png') });
    const bbox = await headShot(B, path.join(SHOTS, '4-seen-by-the-other-player-closeup.png'), 'eyes');
    check('…and it is on screen there too', (await colourShare(B, bbox)) > 0.15);
    const stop = await api('POST', '/recording/stop');
    const log = (await (await fetch(`${S.base}/api/rooms/${R}/recordings/${(stop.recording || rec.recording).recId}/log`)).text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const lk = log.filter((e) => (e.e === 'look' || e.e === 'join') && e.id === idA).pop();
    check('the recording has it (the look event carries face + the face photo, so the replay draws it)', lk && lk.look.face === '#ff70a6' && lk.look.fabric?.face?.photo === true, lk);

    // 5) a 📷 selfie in front view shows the photo face
    await A.evaluate(() => { const k = window.klibb; k.moveTo(0, 0.5); k.look(0, 0); k.setView('front'); });
    await A.waitForFunction(() => window.klibb.selfAvatar().visible && window.klibb.selfAvatar().face.photo, null, { timeout: 10000 }); await sleep(1500);
    await A.screenshot({ path: path.join(SHOTS, '5-front-selfie-view.png') });
    const ph = await A.evaluate(() => window.klibb.photo());
    const jpg = Buffer.from(await (await fetch(`${S.base}${ph.upload.photo.fileUrl}`)).arrayBuffer());
    const { data, info } = await sharp(jpg).raw().toBuffer({ resolveWithObject: true });
    let hit = 0; for (let i = 0; i < info.width * info.height; i++) { const o = i * info.channels; if (orange(data[o], data[o + 1], data[o + 2])) hit++; }
    fs.writeFileSync(path.join(SHOTS, '5-selfie-photo.jpg'), jpg);
    check('a 📷 selfie (front view) has the photo face in it', hit > 400, { hit, w: info.width, h: info.height });
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await browser.close(); S.child.kill();
  console.log(`\nFace e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
