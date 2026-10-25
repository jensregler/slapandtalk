// E2E: sessionsinspelning och virtuella kameror (körs från e2e.js, eller själv: node tests/e2e-recording.js).
// Rummets skapare (A) placerar kameror och spelar in, B är med, C kommer in mitt i.
// Sen spelas inspelningen upp och jämförs med loggen (samma tid = samma läge).
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

async function recordingE2E({ browser, BASE, SHOTS, assert, waitReady, testPng }) {
  const { parseRecording, buildTimeline, snapshotAt } = await import(pathToFileURL(path.join(__dirname, '..', 'shared', 'replay.mjs')).href);
  const { room: { id: R }, roomKey: KEY } = await (await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  const vp = { viewport: { width: 1024, height: 640 } };
  const actx = await browser.newContext(vp), bctx = await browser.newContext(vp), cctx = await browser.newContext(vp), pctx = await browser.newContext(vp);
  await actx.addInitScript(([r, k]) => { if (!localStorage.getItem('klibb.roomKeys')) localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })); }, [R, KEY]);
  const A = await actx.newPage(), B = await bctx.newPage();
  for (const [n, pg] of [['A', A], ['B', B]]) pg.on('pageerror', (e) => console.log(`sidfel (${n}):`, e.message));
  await A.goto(`${BASE}/?room=${R}`); await waitReady(A);
  await B.goto(`${BASE}/?room=${R}`); await waitReady(B);
  await A.waitForFunction(() => window.klibb.net.status === 'online' && window.klibb.players().length === 1, null, { timeout: 15000 });
  const openMore = (pg) => pg.evaluate(() => window.klibb.openMore()); // 🎬 ligger under ⚙ More
  const recHidden = (pg) => pg.evaluate(() => document.getElementById('rec-box').hidden);
  await openMore(A);
  assert(await A.isVisible('#rec-box') && (await recHidden(B)), 'inspelning och kameror: bara rummets skapare ser 🎬 Inspelning i menyn');

  // ---------- Kameror ----------
  await A.evaluate(() => { const k = window.klibb; k.moveTo(3.4, 3.6); k.camera.position.y = 2.1; k.look(0.75, -0.2); });
  await A.click('#cam-add');
  await B.waitForFunction(() => window.klibb.cameras().length === 1, null, { timeout: 5000 });
  const cam = await B.evaluate(() => window.klibb.cameras()[0]);
  assert(cam.name === 'Camera 1' && cam.p[0] === 3.4 && cam.p[1] === 2.1 && Math.abs(cam.yaw - 0.75) < 1e-3 && Math.abs(cam.pitch + 0.2) < 1e-3 && cam.fov === 60,
    '🎥 Placera kamera här: kameran hamnar där A står, åt det håll A tittar, och syns direkt för B');
  await A.click('#cam-add');
  await B.waitForFunction(() => window.klibb.cameras().length === 2, null, { timeout: 5000 });
  await A.waitForFunction(() => window.klibb.cameras().length === 2, null, { timeout: 5000 });
  const [id1, id2] = await A.evaluate(() => window.klibb.cameras().map((c) => c.id));
  const li = (id) => `#cam-list li[data-id="${id}"]`;
  await A.fill(`${li(id1)} .cam-name`, 'Vida'); await A.press(`${li(id1)} .cam-name`, 'Enter');
  await B.waitForFunction(() => window.klibb.cameras().some((x) => x.name === 'Vida'), null, { timeout: 5000 });
  await A.selectOption(`${li(id1)} .cam-aspect`, '9:16');
  await B.waitForFunction(() => window.klibb.cameras().some((x) => x.name === 'Vida' && x.aspect === '9:16'), null, { timeout: 5000 });
  await A.selectOption(`${li(id1)} .cam-fov`, '75');
  await B.waitForFunction(() => { const c = window.klibb.cameras().find((x) => x.name === 'Vida'); return c && c.aspect === '9:16' && c.fov === 75; }, null, { timeout: 5000 });
  await A.click(`${li(id2)} .cam-del`);
  await B.waitForFunction(() => window.klibb.cameras().length === 1, null, { timeout: 5000 });
  assert(true, 'kameror: byt namn (Vida), format 9:16, bildvinkel 75°, ta bort – syns direkt för de andra');
  // B ställer sig så att kameran syns (skärmdump)
  await B.evaluate(() => { const k = window.klibb; k.moveTo(0.6, 0.9); k.look(-2.4, -0.05); document.getElementById('panel').style.visibility = 'hidden'; });
  await B.waitForTimeout(700);
  assert(await B.evaluate(() => window.klibb.camerasVisible()), 'kamerorna syns som små kameramodeller i rummet');
  await B.screenshot({ path: path.join(SHOTS, '34-kamera-placerad.png') });
  await B.evaluate(() => window.klibb.setMode('view', { quiet: true }));
  assert(!(await B.evaluate(() => window.klibb.camerasVisible())), 'i Tittläge döljs kamerorna');
  await B.evaluate(() => window.klibb.setMode('slap', { quiet: true }));
  // Flytta kameran: A ställer sig på ett nytt ställe och trycker ⤓
  await A.evaluate(() => { const k = window.klibb; k.moveTo(-3.6, 3.7); k.camera.position.y = 1.9; k.look(-0.62, -0.12); });
  await A.click(`${li(id1)} .cam-move`);
  await B.waitForFunction(() => window.klibb.cameras()[0].p[0] === -3.6, null, { timeout: 5000 });
  await A.reload(); await waitReady(A); await openMore(A);
  const camsAfter = await A.evaluate(() => window.klibb.cameras());
  assert(camsAfter.length === 1 && camsAfter[0].name === 'Vida' && camsAfter[0].p[0] === -3.6 && camsAfter[0].aspect === '9:16', 'kameran är flyttad, och kamerorna finns kvar efter omladdning (sparas med rummet)');
  const camId = camsAfter[0].id;
  // Titta genom kamera: visar exakt det kameran ser, med 9:16-ram. Esc = tillbaka.
  await A.evaluate(() => { window.klibb.moveTo(1, 1); });
  await A.click(`${li(id1)} .cam-look`);
  await A.waitForTimeout(600);
  const cv = await A.evaluate(() => ({ id: window.klibb.camView(), p: window.klibb.viewCam.position.toArray(), aspect: window.klibb.viewCam.aspect, fov: window.klibb.viewCam.fov, hud: !document.getElementById('camview-hud').hidden, vis: window.klibb.camerasVisible() }));
  assert(cv.id === camId && Math.abs(cv.p[0] + 3.6) < 1e-6 && Math.abs(cv.aspect - 9 / 16) < 0.01 && cv.fov === 75 && cv.hud && !cv.vis,
    'Titta genom kamera: vyn är kamerans (position, 75°, 9:16), kameramodellerna döljs');
  await A.screenshot({ path: path.join(SHOTS, '31-kamera-titta.png') });
  await A.keyboard.press('Escape');
  assert((await A.evaluate(() => window.klibb.camView())) === null && !(await A.isVisible('#camview-hud')), 'Esc = tillbaka till sin egen vy');

  // ---------- Inspelning ----------
  await openMore(A); await A.click('#rec-toggle');
  await B.waitForSelector('#rec-badge', { state: 'visible', timeout: 5000 });
  await A.waitForSelector('#rec-badge', { state: 'visible', timeout: 5000 });
  const sysB = await B.$$eval('#chat-log li.sys', (l) => l.map((x) => x.textContent));
  assert(sysB.some((t) => /Recording started/.test(t)) && (await B.textContent('#rec-badge')).includes('REC'), '● REC syns för alla i rummet, och chatten säger att inspelningen startade');
  await B.evaluate(() => { const k = window.klibb; k.moveTo(0.4, -2.2); k.look(-2.95, -0.08); });
  await B.waitForTimeout(500);
  await B.screenshot({ path: path.join(SHOTS, '29-rec-indikator.png') });
  const C = await cctx.newPage(); C.on('pageerror', (e) => console.log('sidfel (C):', e.message));
  await C.goto(`${BASE}/?room=${R}`); await waitReady(C);
  await C.waitForSelector('#rec-notice', { state: 'visible', timeout: 8000 });
  assert((await C.textContent('#rec-notice')).includes('This room is being recorded') && await C.isVisible('#rec-badge'), 'den som kommer in mitt i ser "This room is being recorded" och ● REC');
  await C.screenshot({ path: path.join(SHOTS, '30-rec-sen-ankomling.png') });
  // Under inspelningen: B går och tittar upp och ner, en klibba sätts och peelas, B chattar
  const bId = await B.evaluate(() => window.klibb.net.id);
  for (let i = 0; i <= 12; i++) { await B.evaluate((i) => { const k = window.klibb; k.moveTo(-1.5 + i * 0.25, 0.5 - i * 0.1); k.look(0.9 - i * 0.05, -0.3 + i * 0.04); }, i); await B.waitForTimeout(90); }
  const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(testPng)], { type: 'image/png' }), 'k.png');
  const img = await (await fetch(`${BASE}/api/stickers`, { method: 'POST', body: fd })).json();
  const st = await (await fetch(`${BASE}/api/rooms/${R}/stamps`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageId: img.id, position: [0, 2, -4.999], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.8, surface: 'vägg-norr' }) })).json();
  await B.waitForFunction((id) => window.klibb.stamps.meshes.has(id), st.stamp.id, { timeout: 5000 });
  await B.waitForTimeout(600);
  await B.evaluate(() => window.klibb.openChat()); await B.keyboard.type('Hej från inspelningen!'); await B.keyboard.press('Enter');
  await B.waitForTimeout(500);
  await fetch(`${BASE}/api/rooms/${R}/stamps/${st.stamp.id}/peel`, { method: 'DELETE', headers: { 'x-peel-token': st.peelToken } });
  await B.waitForTimeout(500);
  await A.click('#rec-toggle');
  await B.waitForSelector('#rec-badge', { state: 'hidden', timeout: 5000 });
  assert((await B.$$eval('#chat-log li.sys', (l) => l.map((x) => x.textContent))).some((t) => /Recording stopped/.test(t)), 'när inspelningen stoppas försvinner ● REC för alla');
  await A.waitForFunction(() => document.querySelectorAll('#rec-list a').length === 1, null, { timeout: 5000 });
  const href = await A.getAttribute('#rec-list a', 'href');
  const recId = new URL(href, BASE).searchParams.get('replay');
  const text = await (await fetch(`${BASE}/api/rooms/${R}/recordings/${recId}/log`)).text();
  const rec = parseRecording(text), tl = buildTimeline(rec);
  const kinds = new Set(rec.events.map((e) => e.e));
  assert(['join', 'move', 'chat', 'stamp:add', 'stamp:remove'].every((k) => kinds.has(k)) && rec.header.players.length === 2 && rec.header.cameras.length === 1 && rec.end.reason === 'stop',
    `inspelningen finns i listan (▶) och loggen har startläge och händelser (${[...kinds].join(', ')})`);
  const pitched = rec.events.filter((e) => e.e === 'move' && e.id === bId);
  assert(pitched.length >= 3 && pitched.some((e) => Math.abs(e.pi) > 0.05), 'blicken upp/ner (pitch) finns med i inspelningen');

  for (const c of [actx, bctx, cctx]) await c.close(); // färre webbläsare som ritar samtidigt
  // ---------- Uppspelning ----------
  const P = await pctx.newPage(); P.on('pageerror', (e) => console.log('sidfel (uppspelning):', e.message));
  await P.goto(`${BASE}${href}`);
  await P.waitForFunction(() => window.replay && (window.replay.ready || window.replay.error), null, { timeout: 20000 });
  assert(await P.evaluate(() => window.replay.ready && !window.replay.error), 'uppspelaren laddar inspelningen (?replay=…)');
  const views = await P.evaluate(() => window.replay.views());
  assert(views[0] === 'free' && views.includes(`cam:${camId}`) && views.includes(`pov:${bId}`) && views.filter((v) => v.startsWith('pov:')).length === 3, 'vyer: fri kamera, Vida och tre personers ögon');
  const stable = (t) => P.evaluate(async (t) => { window.replay.pause(); window.replay.seek(t); for (let i = 0; i < 100 && window.replay.state().loading; i++) await new Promise((r) => setTimeout(r, 30)); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return window.replay.state(); }, t);
  const tMove = pitched.at(-1).t + 300, tAdd = rec.events.find((e) => e.e === 'stamp:add').t, tPeel = rec.events.find((e) => e.e === 'stamp:remove').t;
  const s1 = await stable(tMove), want = snapshotAt(tl, tMove).players.find((p) => p.id === bId);
  const got = s1.players.find((p) => p.id === bId);
  assert(got && Math.abs(got.pos[0] - want.p[0]) < 1e-3 && Math.abs(got.pos[2] - want.p[2]) < 1e-3 && Math.abs(got.yaw - want.y) < 1e-3,
    `uppspelningen visar B där loggen säger (x=${want.p[0].toFixed(2)}, z=${want.p[2].toFixed(2)})`);
  const sBefore = await stable(tAdd - 50), sMid = await stable((tAdd + tPeel) / 2), sAfter = await stable(tPeel + 50), sMid2 = await stable((tAdd + tPeel) / 2);
  assert(!sBefore.stamps.includes(st.stamp.id) && sMid.stamps.includes(st.stamp.id) && !sAfter.stamps.includes(st.stamp.id) && JSON.stringify(sMid2.stamps) === JSON.stringify(sMid.stamps),
    'klibban syns bara mellan när den sattes och peelades, även när man spolar fram och tillbaka');
  const again = await stable(tMove);
  assert(JSON.stringify(again.players) === JSON.stringify(s1.players), 'samma tid ger samma bild (deterministiskt)');
  // POV: med B:s ögon
  await P.evaluate((v) => window.replay.setView(v), `pov:${bId}`);
  const pov = await stable(tMove);
  assert(Math.abs(pov.eye.p[0] - want.p[0]) < 1e-3 && Math.abs(pov.eye.p[1] - want.p[1]) < 1e-3 && !pov.players.find((p) => p.id === bId).visible,
    'POV: kameran sitter i B:s ögon (och B:s egen gubbe syns inte)');
  await stable((tAdd + tPeel) / 2);
  await P.screenshot({ path: path.join(SHOTS, '33-uppspelning-pov.png') });
  await P.evaluate((v) => window.replay.setView(v), `cam:${camId}`);
  const cs = await stable((tAdd + tPeel) / 2);
  assert(Math.abs(cs.eye.p[0] + 3.6) < 1e-3 && Math.abs(cs.eye.aspect - 9 / 16) < 0.01 && cs.eye.fov === 75 && !cs.camerasVisible, 'kameravy: bilden tas från kameran Vida (9:16, 75°)');
  await P.evaluate(() => window.replay.setView('free'));
  await stable((tAdd + tPeel) / 2);
  await P.evaluate(() => { document.getElementById('rp-view').size = 5; });
  await P.screenshot({ path: path.join(SHOTS, '32-uppspelning.png') });
  await P.evaluate(() => { document.getElementById('rp-view').size = 0; });
  // Spela: tiden går framåt (4×)
  const t0 = await P.evaluate(() => { window.replay.seek(0); window.replay.setSpeed(4); window.replay.play(); return window.replay.t; });
  await P.waitForTimeout(700);
  const t1 = await P.evaluate(() => window.replay.t);
  assert(t1 - t0 > 1500, `▶ spelar upp (4× hastighet: ${Math.round(t1 - t0)} ms på 0,7 s)`);
  // Spela in video av det man ser (webm)
  const video = await P.evaluate(async () => {
    window.replay.seek(0); window.replay.setSpeed(1);
    if (!window.replay.startVideo()) return { ok: false };
    await new Promise((r) => setTimeout(r, 2500));
    const blob = await window.replay.stopVideo();
    return { ok: !!blob, size: blob ? blob.size : 0, type: blob ? blob.type : null, link: !document.getElementById('rp-download').hidden, t: window.replay.t, d: window.replay.duration };
  });
  assert(video.ok && video.size > 1000 && video.type === 'video/webm' && video.link, `⏺ Spela in video: en .webm-fil skapas av det man ser (${Math.round((video.size || 0) / 1024)} kB)` + (video.size ? '' : JSON.stringify(video)));
  await pctx.close();
}

module.exports = { recordingE2E };

if (require.main === module) {
  require('dotenv').config({ path: __dirname + '/../.env', quiet: true });
  const { chromium } = require('playwright');
  const sharp = require('sharp');
  (async () => {
    const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const testPng = path.join(__dirname, 'test-klibba-rec.png');
    await sharp({ create: { width: 200, height: 200, channels: 4, background: '#e0245e' } }).png().toFile(testPng);
    const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
    const waitReady = (page) => page.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 20000 });
    try { await recordingE2E({ browser, BASE: process.env.BASE_URL || 'http://localhost:8787', SHOTS: path.join(__dirname, '..', 'screenshots'), assert, waitReady, testPng }); }
    finally { await browser.close(); fs.rmSync(testPng, { force: true }); }
  })().catch((e) => { console.error(e); process.exit(1); });
}
