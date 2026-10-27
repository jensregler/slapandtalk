// e2e: the auto cameramen (shared/autocam.mjs) and 📷 Photo (client/src/photo.js, server/photos.js),
// lean, on their own servers (8841 normal, 8842 demo; never 8787):
//   free     ⚙ More → 🎬 Recording → 🎥 Auto cameraman is a plain on/off: one, fully automatic;
//            P takes a photo (download + upload, ≥ 1920 px)
//   full     ＋ Add cameraman, then a real click in the room sets where it starts – twice; both
//            walk at once, apart; 👁 + 📷 through one; the room is recorded; the replay has both as
//            views (autocam:<id>), ⏺ Record video from one, 📷 from another; the shot list has both
//   demo     the creator can switch the one cameraman on; a 📷 photo outlives the room's expiry
// Run: node tests/e2e-autocam.js   (needs a built client: npx vite build)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { startServer, enter, sleep } = require('./demo-helpers');

const PORT = Number(process.env.AUTOCAM_E2E_PORT || 8841);
const FULL = 'autocam-e2e-full-key-1';
let passed = 0, failed = 0;
function check(name, ok, info = '') {
  if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (info ? '  — ' + (typeof info === 'string' ? info : JSON.stringify(info)) : '')); }
}
const NAME_RE = /^slapandtalk-[a-z0-9]+-\d{8}-\d{6}\.jpg$/;
// Take a photo with `act` and return { file, name, meta, last } (the download and what was uploaded).
async function photo(page, act, last) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), act()]);
  const file = await dl.path();
  await page.waitForFunction(`((x) => x && (x.upload || x.error))((${last})())`, null, { timeout: 20000 });
  const l = await page.evaluate(last);
  return { name: dl.suggestedFilename(), meta: await sharp(fs.readFileSync(file)).metadata(), last: l };
}
const newRoom = (base) => fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json());

(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '', FULL_ACCESS_KEYS: FULL, DEV_UNLOCK: '' });
  const D = await startServer(PORT + 1, { DEMO_PROFILE: '1', DEMO_ROOM_MINUTES: '0.25', FULL_ACCESS_KEYS: FULL });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const ctxFor = async (room, key, unlock = '') => {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, acceptDownloads: true });
    await ctx.addInitScript(([r, k, u]) => { localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })); if (u) localStorage.setItem('klibb.unlock', u); }, [room, key, unlock]);
    return ctx;
  };
  try {
    // ---------- Free: one, automatic, a plain on/off ----------
    console.log('Free (' + S.base + ')');
    const f = await newRoom(S.base);
    const fctx = await ctxFor(f.room.id, f.roomKey);
    const fp = await fctx.newPage(); fp.on('pageerror', (e) => errors.push(e.message));
    await fp.goto(`${S.base}/?room=${f.room.id}`);
    await fp.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    await fp.evaluate(() => window.klibb.openMore());
    const fui = await fp.evaluate(() => ({ box: !document.getElementById('autocam-free').hidden && document.getElementById('autocam-free').offsetParent !== null, add: !document.getElementById('autocam-add').hidden, select: !!document.getElementById('autocam-path') }));
    check('free: 🎥 Auto cameraman is a plain on/off (no path choice, no ＋ Add)', fui.box && !fui.add && !fui.select, fui);
    await fp.click('#autocam-on');
    await fp.waitForFunction(() => window.klibb.cameras().some((c) => c.auto), null, { timeout: 10000 });
    const a1 = await fp.evaluate(() => window.klibb.autoCamPose()); await sleep(1200); const a2 = await fp.evaluate(() => window.klibb.autoCamPose());
    const fc = await fp.evaluate(() => ({ cams: window.klibb.cameras(), items: [...document.querySelectorAll('#cam-list li')].map((l) => ({ t: l.textContent, sel: !!l.querySelector('select') })) }));
    check('…on: one cameraman, Automatic, no start, walks by itself, no settings in the list', fc.cams.length === 1 && fc.cams[0].auto === 'seeded' && !fc.cams[0].start && a1.p.join() !== a2.p.join() && fc.items.length === 1 && !fc.items[0].sel, fc);
    await fp.evaluate(() => window.klibb.closeMore());
    const fph = await photo(fp, () => fp.keyboard.press('p'), () => window.klibb.lastPhoto());
    check('P: a JPEG is downloaded at once (slapandtalk-<room>-<time>.jpg, ≥ 1920 px wide)', NAME_RE.test(fph.name) && fph.name.includes(f.room.id) && fph.meta.format === 'jpeg' && fph.meta.width >= 1920, { name: fph.name, w: fph.meta.width });
    const fid = fph.last.upload && fph.last.upload.photo.id;
    const fpage = fid && await fetch(`${S.base}/p/${fid}`);
    const fstored = fid && fs.existsSync(path.join(S.dir, 'photos', f.room.id, `${fid}.jpg`));
    check('…and uploaded: /p/<id> works, stored as photos/<room>/<id>.jpg', fpage && fpage.status === 200 && fstored && fph.last.upload.photo.free === true, { status: fpage && fpage.status, fstored, free: fph.last.upload && fph.last.upload.photo.free });
    await fp.click('#more-btn').catch(() => fp.evaluate(() => window.klibb.openMore()));
    await fp.evaluate(() => window.klibb.openMore());
    await fp.click('#autocam-on');
    await fp.waitForFunction(() => !window.klibb.cameras().some((c) => c.auto), null, { timeout: 10000 });
    check('…off again: removed', true);
    await fctx.close();

    // ---------- Full version: ＋ Add cameraman, click to start, two at once ----------
    console.log('Full version');
    const m = await newRoom(S.base); const R = m.room.id, KEY = m.roomKey;
    const ctx = await ctxFor(R, KEY, FULL);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${S.base}/?room=${R}`);
    await p.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.entitlements && true, null, { timeout: 30000 });
    await p.waitForFunction(() => !document.getElementById('autocam-add').hidden, null, { timeout: 10000 });
    const place = async (yaw) => {
      await p.evaluate(() => window.klibb.openMore());
      await p.click('#autocam-add');
      const placing = await p.evaluate(() => window.klibb.placingCam() && !window.klibb.moreOpen());
      await p.evaluate((y) => { const c = window.klibb.controls; c.yaw = y; c.pitch = -0.55; c.apply(); }, yaw);
      const n0 = await p.evaluate(() => window.klibb.cameras().filter((c) => c.auto).length);
      await p.mouse.click(880, 300); await sleep(250); // the first click enters the room (pointer lock)
      if (await p.evaluate(() => window.klibb.placingCam())) { await p.evaluate((y) => { const c = window.klibb.controls; c.yaw = y; c.pitch = -0.55; c.apply(); }, yaw); await p.mouse.click(880, 300); }
      await p.waitForFunction((n) => window.klibb.cameras().filter((c) => c.auto).length > n, n0, { timeout: 10000 });
      await p.evaluate(() => window.klibb.controls.unlock()); await sleep(150);
      return placing;
    };
    const pl1 = await place(0), pl2 = await place(Math.PI);
    const cams = await p.evaluate(() => window.klibb.cameras().filter((c) => c.auto));
    check('＋ Add cameraman → a click in the room sets where it starts (twice)', pl1 && pl2 && cams.length === 2 && cams.every((c) => Array.isArray(c.start)) && cams[0].start.join() !== cams[1].start.join() && cams.map((c) => c.name).join() === 'Auto cameraman 1,Auto cameraman 2', cams);
    await sleep(800);
    let minD = Infinity;
    for (let i = 0; i < 6; i++) { const ps = Object.values(await p.evaluate(() => window.klibb.autoCamPoses())); minD = Math.min(minD, Math.hypot(ps[0].p[0] - ps[1].p[0], ps[0].p[2] - ps[1].p[2])); await sleep(300); }
    check('both walk at the same time, apart (≥ 1.1 m)', minD >= 1.1, minD);
    await p.evaluate(() => window.klibb.openMore());
    const sels = await p.$$('#cam-list li .cam-path');
    check('each has an optional path (Automatic / Perimeter / Diagonal sweep / Push-in) and ✕', sels.length === 2 && (await p.$$('#cam-list li .cam-del')).length === 2);
    await sels[1].selectOption('perimeter');
    await p.waitForFunction(() => window.klibb.cameras().some((c) => c.auto === 'perimeter'), null, { timeout: 10000 });
    await p.evaluate(() => window.klibb.closeMore());
    // 👁 through the first and 📷 from there (the camera HUD's button)
    await p.evaluate((id) => window.klibb.enterCamView(id), cams[0].id); await sleep(300);
    const cph = await photo(p, () => p.click('#camview-photo'), () => window.klibb.lastPhoto());
    check('👁 + 📷 through a cameraman: downloaded and uploaded (view autocam:<id>, no free bug: full version)', NAME_RE.test(cph.name) && cph.meta.width >= 1920 && cph.last.upload && cph.last.upload.photo.view === `autocam:${cams[0].id}` && cph.last.upload.photo.free === false, cph.last);
    await p.evaluate(() => window.klibb.exitCamView());
    await p.evaluate(() => window.klibb.renderRecs());
    await p.waitForFunction(() => document.querySelector('#rec-list .rec-photo'), null, { timeout: 5000 }).catch(() => {});
    const recPhoto = await p.evaluate(() => { const a = document.querySelector('#rec-list .rec-photo'); return a && a.getAttribute('href'); });
    check('the photo is listed in 🎬 Recordings with its /p/<id> link', recPhoto === `/p/${cph.last.upload.photo.id}`, recPhoto);

    // Record ~8 s, a sticker slapped 3 s in.
    const rec = (what) => fetch(`${S.base}/api/rooms/${R}/recording/${what}`, { method: 'POST', headers: { 'x-room-key': KEY } }).then((r) => r.json());
    const { recording: { recId: REC } } = await rec('start');
    await sleep(3000);
    const fd = new FormData(); fd.append('file', new Blob([await sharp({ create: { width: 64, height: 64, channels: 4, background: '#ff3366' } }).png().toBuffer()], { type: 'image/png' }), 'k.png');
    const img = await (await fetch(`${S.base}/api/stickers`, { method: 'POST', body: fd })).json();
    await fetch(`${S.base}/api/rooms/${R}/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageId: img.id, position: [0, 1.6, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.5, rotation: 0, surface: 'vägg-norr' }) });
    await sleep(5000);
    await rec('stop');
    await ctx.close();

    // The replay: one view per cameraman, both move, a video from one, a photo from the other.
    const rctx = await browser.newContext({ viewport: { width: 960, height: 540 }, acceptDownloads: true });
    const P = await rctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${R}&replay=${REC}`);
    await P.waitForFunction(() => window.replay && window.replay.ready, null, { timeout: 30000 });
    const v = await P.evaluate(() => ({ views: window.replay.views(), view: window.replay.view, labels: [...document.getElementById('rp-view').options].map((o) => o.textContent), ids: window.replay.crewIds() }));
    const cv = cams.map((c) => `autocam:${c.id}`);
    check('replay: “Auto cameraman 1” and “2” are their own views; the generic path views stay', cv.every((x) => v.views.includes(x)) && ['auto:perimeter', 'auto:diagonal', 'auto:pushin'].every((x) => v.views.includes(x)) && v.labels.some((l) => /Auto cameraman 1/.test(l)) && v.labels.some((l) => /Auto cameraman 2/.test(l)), v);
    check('…with nobody talking it starts on the first cameraman', v.view === cv[0], v.view);
    const both = await P.evaluate((ids) => ids.map((id) => window.replay.crewPose(id, 4000)), cams.map((c) => c.id));
    check('both have a take at the same moment, apart', both.every(Boolean) && Math.hypot(both[0].p[0] - both[1].p[0], both[0].p[2] - both[1].p[2]) >= 1.1, both);
    await P.evaluate((x) => window.replay.setView(x), cv[1]);
    await P.evaluate(() => window.replay.seek(1000)); await sleep(300);
    const e1 = await P.evaluate(() => window.replay.state().eye);
    await P.evaluate(() => window.replay.seek(6000)); await sleep(300);
    const e2 = await P.evaluate(() => ({ ...window.replay.state().eye, label: document.getElementById('rp-viewlabel').textContent }));
    check('the second cameraman’s view moves and zooms within 22–70 mm (22 mm only when widening to fit the people in the room)', e1.p.join() !== e2.p.join() && [e1, e2].every((e) => e.fov >= 19.4 && e.fov <= 57.3) && /Auto cameraman 2/.test(e2.label), { e1, e2 });
    const rph = await photo(P, () => P.click('#rp-photo'), () => window.replay.lastPhoto());
    check('📷 in the replay (from Auto cameraman 2): downloaded and uploaded with source replay + the view', NAME_RE.test(rph.name) && rph.meta.width >= 1920 && rph.last.upload && rph.last.upload.photo.source === 'replay' && rph.last.upload.photo.view === cv[1] && rph.last.upload.photo.recId === REC, rph.last);
    await P.screenshot({ path: path.join(__dirname, '..', 'screenshots', '90-autocam-replay.png') });

    await P.evaluate((x) => window.replay.setView(x), cv[0]);
    const started = await P.evaluate(() => window.replay.startVideo());
    await P.waitForFunction(() => window.replay.lastVideo(), null, { timeout: 90000 });
    const up = await P.evaluate(async () => { const j = await window.replay.upload(); return j && { id: j.video && j.video.id, bytes: window.replay.lastVideo().blob.size, view: window.replay.view }; });
    check('⏺ Record video from Auto cameraman 1: rendered and uploaded', started && up && up.id && up.bytes > 10000 && up.view === cv[0], up);
    const shots = await (await fetch(`${S.base}/api/rooms/${R}/recordings/${REC}/shots`)).json();
    const crew = shots.autocam && shots.autocam.crew;
    check('the shot list has one track per cameraman (autocam, v3) and the generic takes', shots.autocam.v === 3 && crew.length === 2 && crew.map((c) => c.view).join() === cv.join() && crew.every((c) => c.track.samples.length >= 5) && shots.autocam.takes.length === 3, crew && crew.map((c) => [c.view, c.track.samples.length]));
    const pose = await P.evaluate((id) => window.replay.crewPose(id, 3000), cams[1].id);
    const s3 = crew[1].track.samples.find((x) => x[0] === 3000);
    check('…and the replay’s take is exactly the shot list’s track', JSON.stringify(s3) === JSON.stringify([3000, ...pose.p, pose.yaw, pose.pitch, pose.mm]), { s3, pose });
    await rctx.close();

    // ---------- Demo: the one cameraman for the creator; a photo outlives the room ----------
    console.log('Demo (' + D.base + ')');
    const d = await newRoom(D.base);
    const dctx = await ctxFor(d.room.id, d.roomKey, FULL);
    const dp = await enter(dctx, `${D.base}/?room=${d.room.id}`, 'Jens');
    dp.on('pageerror', (e) => errors.push(e.message));
    await dp.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 30000 });
    await dp.evaluate(() => window.klibb.openMore());
    const dui = await dp.evaluate(() => ({ box: document.getElementById('autocam-free').offsetParent !== null, add: !document.getElementById('autocam-add').hidden, place: document.getElementById('cam-add').offsetParent !== null }));
    await dp.click('#autocam-on');
    await dp.waitForFunction(() => window.klibb.cameras().some((c) => c.auto), null, { timeout: 10000 }).catch(() => {});
    const dc = await dp.evaluate(() => window.klibb.cameras());
    check('demo: the creator switches on the one automatic cameraman (a key unlocks nothing; placing stays hidden)', dui.box && !dui.add && !dui.place && dc.length === 1 && dc[0].auto === 'seeded', { dui, dc });
    await dp.evaluate(() => window.klibb.closeMore());
    const dph = await photo(dp, () => dp.click('#photo-btn'), () => window.klibb.lastPhoto());
    const did = dph.last.upload && dph.last.upload.photo.id;
    check('demo: 📷 downloads and uploads (free for everyone)', NAME_RE.test(dph.name) && did && dph.last.upload.photo.free === true, dph.last);
    let gone = false;
    const roomFile = path.join(D.dir, 'rooms', `${d.room.id}.json`);
    const had = fs.existsSync(roomFile);
    await dp.waitForFunction(() => window.klibb.demoState().closed, null, { timeout: 40000 }).catch(() => {});
    for (let i = 0; i < 20 && !gone; i++) { gone = had && !fs.existsSync(roomFile); if (!gone) await sleep(500); }
    const after = did && await fetch(`${D.base}/p/${did}/file`);
    check('…the room expires and is deleted, the photo is still there (/p/<id>, photos/<room>/<id>.jpg)', gone && after.status === 200 && (await fetch(`${D.base}/p/${did}`)).status === 200 && fs.existsSync(path.join(D.dir, 'photos', d.room.id, `${did}.jpg`)), { gone, status: after && after.status });
    await dctx.close();
    check('no page errors', errors.length === 0, errors);
  } catch (err) { failed++; console.log('  ✗ ' + err.stack); } finally {
    await browser.close(); S.child.kill(); D.child.kill();
    fs.rmSync(S.dir, { recursive: true, force: true }); fs.rmSync(D.dir, { recursive: true, force: true });
    console.log(`\nAuto cameraman + photo e2e: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();
