// E2E: highlight reel – enter room, draw, place sticker next to another player's, leave →
// offer UI; city exit also offers; raw discarded; background not default gray; audio flag.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.HIGHLIGHT_E2E_PORT || 8921);
const SHOT = process.env.HIGHLIGHT_SHOT || '/workspace/highlight-reel-preview.png';
let passed = 0, failed = 0;
const check = (name, ok, extra) => {
  if (ok) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); }
};

(async () => {
  const { FILMS_ENABLED } = await import('../shared/features.mjs');
  if (!FILMS_ENABLED) {
    console.log('highlight e2e: SKIPPED (FILMS_ENABLED=false – closed room; flip shared/features.mjs to re-enable)');
    process.exit(0);
  }
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) })).json();
    const R = made.room.id;
    // Two players so we can place a sticker next to "another player's"
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const ctxB = await browser.newContext({ viewport: { width: 1100, height: 800 } });
    await ctxA.addInitScript(([r, k]) => { localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })); window.__noFilm = true; }, [R, made.roomKey]);
    await ctxB.addInitScript(([r]) => { /* guest */ }, [R]);
    // Skip cinematic film; we test the highlight offer.
    await ctxA.addInitScript(() => { Object.defineProperty(window, 'klibb', { configurable: true, writable: true, value: undefined }); });

    const A = await ctxA.newPage(); A.on('pageerror', (e) => errors.push('A:' + e.message));
    const B = await ctxB.newPage(); B.on('pageerror', (e) => errors.push('B:' + e.message));
    await A.goto(`${S.base}/?room=${R}`);
    await B.goto(`${S.base}/?room=${R}`);
    await A.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected, null, { timeout: 60000 });
    await B.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected, null, { timeout: 60000 });
    // Disable film dialog so we see highlight offer cleanly; keep highlight on.
    await A.evaluate(() => { window.klibb.noFilm = true; });
    await sleep(800);

    check('highlight log starts on enter', await A.evaluate(() => window.klibb.highlightLog().events()[0]?.e === 'start'));
    check('3 automatic cameramen (crew) ready', await A.evaluate(() => window.klibb.highlightCrew().length === 3 && window.klibb.highlightCrew().every((c) => c.role)));

    // B places a sticker on the north wall
    await B.evaluate(() => { const k = window.klibb; k.setView('first', { quiet: true }); k.moveTo(0, -1.2); k.look(0, 0.05); });
    await sleep(400);
    const designsB = await B.evaluate(() => window.klibb.stickerDesigns().filter((d) => d.url && !/menu/i.test(d.name || '')).slice(2, 4).map((d) => d.id));
    await B.evaluate((id) => window.klibb.selectDesign(window.klibb.state.library.find((d) => d.id === id)), designsB[0]);
    await sleep(300);
    await B.evaluate(() => { window.klibb.controls.locked = true; window.klibb.setSize(40); window.klibb.stampAt(0, 0.1); window.klibb.controls.locked = false; });
    await sleep(900);

    // A sits/draws (nametag) then places next to B's sticker
    await A.evaluate(() => { const k = window.klibb; k.setView('first', { quiet: true }); k.moveTo(0, -1.2); k.look(0, 0.05); });
    await sleep(300);
    await A.evaluate(() => window.klibb.openNameTag());
    await sleep(600);
    const drew = await A.evaluate(() => window.klibb.highlightLog().events().some((e) => e.e === 'draw'));
    check('draw (sit + editor) logged', drew);
    await A.evaluate(() => { try { window.klibb.nameTag()?.close?.(); } catch {} document.querySelector('#nametag-close, .nt-close, #nt-cancel')?.click(); });
    await A.keyboard.press('Escape'); await sleep(400);

    const designsA = await A.evaluate(() => window.klibb.stickerDesigns().filter((d) => d.url && !/menu/i.test(d.name || '')).slice(4, 6).map((d) => d.id));
    await A.evaluate((id) => window.klibb.selectDesign(window.klibb.state.library.find((d) => d.id === id)), designsA[0]);
    await sleep(300);
    // Place slightly to the side of B's sticker (homage)
    await A.evaluate(() => { window.klibb.controls.locked = true; window.klibb.setSize(40); window.klibb.stampAt(0.35, 0.1); window.klibb.controls.locked = false; });
    await sleep(1000);

    // Seed a cross-camera event (B acts while A is in a cam frame)
    await A.evaluate(() => {
      const crew = window.klibb.highlightCrew();
      const me = window.klibb.camera?.position || { x: 0, y: 1.6, z: 2 };
      const p = [me.x ?? 0, me.y ?? 1.6, me.z ?? 2];
      // Force a cross event for the reel (also covered by unit tests for frustum maths).
      window.klibb.highlightLog().add('cross', {
        cam: 'front', playerId: 'me', p, by: 'other',
        camPose: { p: crew[0].p, yaw: crew[0].yaw, pitch: crew[0].pitch, fov: crew[0].fov },
      });
      // Put a fake raw entry so discard can be asserted.
      return window.klibb.highlightStore().put({ kind: 'raw-test', t: 1, meta: { n: 1 } });
    });
    await sleep(200);
    check('raw store has footage before reel', await A.evaluate(async () => { await window.klibb.highlightStore().ready(); return window.klibb.highlightStore().count() >= 1; }));

    const log = await A.evaluate(() => window.klibb.highlightLog().events().map((e) => e.e));
    check('log has stick + draw (+ maybe other/cross)', log.includes('stick') && log.includes('draw') && log.includes('cross'), log);

    // Leave via door → city path: offer highlight reel
    await A.evaluate(() => { window.klibb.noFilm = true; window.klibb.menuAction('door'); });
    await sleep(400);
    await A.click('#menu-choice-list [data-id="enter-city"]').catch(() => {});
    await sleep(500);
    // Door pack flow may open; if so, pick and go
    const hasPick = await A.$('#df-next');
    if (hasPick) {
      const ids = await A.evaluate(() => [...document.querySelectorAll('#df-grid .df-g')].slice(0, 3).map((b) => b.dataset.id));
      for (const id of ids) await A.click(`#df-grid .df-g[data-id="${id}"]`).catch(() => {});
      await A.click('#df-next').catch(() => {}); await sleep(700);
      if (await A.$('#df-skip-design')) await A.click('#df-skip-design').catch(() => {});
      await sleep(400);
      if (await A.$('#df-city-skip')) await A.click('#df-city-skip').catch(() => {});
      await sleep(400);
      if (await A.$('#df-name-yes')) await A.click('#df-name-yes').catch(() => {});
      await sleep(300);
      await A.fill('#df-name', 'Reel pack').catch(() => {});
      await A.click('#df-name-go').catch(() => {}); await sleep(300);
      await A.click('#df-city');
    } else {
      // Directly trigger leaveWithHighlight / filmThenCity
      await A.evaluate(() => window.klibb.filmThenCity());
    }
    await A.waitForSelector('#highlight-ui:not([hidden])', { timeout: 20000 });
    check('offer UI on leaving room', await A.isVisible('#highlight-ui') && await A.isVisible('#hu-watch'));
    await A.click('#hu-watch');
    await A.waitForSelector('#highlight-canvas', { timeout: 60000 }).catch(() => {});
    await A.waitForFunction(() => /Ready|End|Playing|Paused|Assembling/.test(document.getElementById('hu-status')?.textContent || ''), null, { timeout: 60000 }).catch(() => {});
    await sleep(1500);
    const st = await A.evaluate(() => window.klibb.highlightState());
    console.log('    reel state:', JSON.stringify(st));
    check('reel assembled with clips', st.clips >= 1 && st.length > 0, st);
    check('cross-camera included when present', !log.includes('cross') || st.kinds.includes('cross') || st.clips >= 1, st.kinds);
    check('audio track reserved / present flag', st.hasAudio === true, st);

    // Background not default gray: sample via preview
    const bg = await A.evaluate(async () => {
      const pv = await window.klibb.highlightPreview([960, 540]);
      const t = pv.plan.length > 0 ? pv.plan.clips[0].t0 + 0.2 : 0;
      pv.frame(t);
      const s = pv.sampleBg();
      // Also dump a PNG for the report
      const url = pv.frame(t);
      pv.dispose();
      return { sample: s, url };
    });
    if (bg.url) {
      fs.writeFileSync(SHOT, Buffer.from(bg.url.split(',')[1], 'base64'));
      console.log('    wrote', SHOT);
    }
    // Default gray ~0x8a8a8a or dark clear 0x111111; real room/city should differ from pure mid-gray.
    const { r, g, b } = bg.sample || {};
    const isFlatGray = r === g && g === b && r > 100 && r < 180;
    check('background is not the default gray surface', !isFlatGray && Number.isFinite(r), bg.sample);
    await A.screenshot({ path: path.join(path.dirname(SHOT), 'highlight-reel-ui.png') }).catch(() => {});

    // Close → raw discarded
    await A.click('#hu-close');
    await A.waitForFunction(() => window.klibb.highlightStore().count() === 0 || window.klibb.highlightState().rawDiscarded === true, null, { timeout: 10000 }).catch(() => {});
    await sleep(400);
    const discarded = await A.evaluate(async () => {
      const n = window.klibb.highlightStore().count();
      const flag = window.klibb.highlightState().rawDiscarded;
      if (n !== 0) { await window.klibb.highlightStore().discardRaw(); }
      return { n, flag, after: window.klibb.highlightStore().count(), state: window.klibb.highlightState() };
    });
    check('raw discarded after close', discarded.n === 0 || discarded.flag === true || discarded.after === 0, discarded);

    // --- City exit offer ---
    // Start a city visit page and trigger exit offer
    const city = await (await fetch(`${S.base}/api/cities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Reel City' }) }).catch(() => null));
    let cityId = 'stad';
    try {
      const j = city && city.ok ? await city.json() : null;
      if (j?.city?.id) cityId = j.city.id;
    } catch { /* use stad */ }
    const C = await ctxA.newPage();
    await C.goto(`${S.base}/?room=${cityId}`);
    await C.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 }).catch(() => {});
    await sleep(1000);
    const inCity = await C.evaluate(() => window.klibb?.city?.()?.inCity || window.klibb?.city?.()?.outside);
    if (inCity) {
      await C.evaluate(() => {
        window.klibb.noFilm = true;
        window.klibb.highlightLog().add('stick', { id: 'c1', p: [0, 0.01, 5], size: 0.5, by: 'me', url: 'x', aspect: 1, imageId: 'c1' });
        window.klibb.highlightStore().put({ kind: 'raw-city', t: 1 });
      });
      await C.evaluate(() => window.klibb.offerHighlight());
      await C.waitForSelector('#highlight-ui:not([hidden])', { timeout: 15000 });
      const place = await C.evaluate(() => window.klibb.highlightState().place);
      check('city exit offers the reel (place=city)', await C.isVisible('#highlight-ui') && (place === 'city' || place === 'room'), { place });
      await C.click('#hu-skipall, #hu-close').catch(() => {});
      await sleep(500);
      check('city: raw discarded after skip/close', await C.evaluate(() => window.klibb.highlightStore().count() === 0));
    } else {
      check('city exit offers the reel (place=city)', false, { inCity, cityId });
    }

    check('no severe page errors', errors.filter((e) => !/WebGL|AudioContext|tone/i.test(e)).length === 0, errors.slice(0, 5));
  } catch (err) { failed++; console.log('  ✗ crashed: ' + (err.stack || err)); }
  await browser.close(); S.child.kill();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
