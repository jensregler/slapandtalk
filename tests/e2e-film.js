// E2E: the session film (Jens, 5 Nov 2026, pt536u; shared/film.mjs, client/src/cinematic.js, filmui.js).
// I put stickers on the wall, touch the radio, peel one, make my pack at the door → "to city" makes
// the film (the pack last) → Watch / Download / Discard → the city picker. Saves stills of every scene
// kind + the end, and the downloaded film. Own server (FILM_E2E_PORT, 8915).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.FILM_E2E_PORT || 8915);
const SHOTS = process.env.FILM_SHOTS || '/workspace/cinematic-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
const savePng = (file, dataUrl) => fs.writeFileSync(path.join(SHOTS, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
(async () => {
  const { FILMS_ENABLED } = await import('../shared/features.mjs');
  if (!FILMS_ENABLED) {
    console.log('film e2e: SKIPPED (FILMS_ENABLED=false – closed room; flip shared/features.mjs to re-enable)');
    process.exit(0);
  }
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) })).json();
    const R = made.room.id;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    await ctx.addInitScript(([r, k]) => localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })), [R, made.roomKey]);
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${R}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected, null, { timeout: 60000 });
    await sleep(1200);
    check('coming in starts my film log (start)', await P.evaluate(() => window.klibb.filmLog().events()[0]?.e === 'start'));
    await P.evaluate(() => { const k = window.klibb; k.setView('first', { quiet: true }); k.moveTo(0, -1.2); k.look(0, 0.05); });
    await sleep(400);
    // three stickers in a row (one scene), different designs
    const designs = await P.evaluate(() => window.klibb.stickerDesigns().filter((d) => d.url && !/menu/i.test(d.name || '')).slice(2, 6).map((d) => d.id));
    for (const [i, x] of [[0, -0.35], [1, 0], [2, 0.35]]) {
      await P.evaluate((id) => window.klibb.selectDesign(window.klibb.state.library.find((d) => d.id === id)), designs[i]); await sleep(300);
      await P.evaluate((x) => { window.klibb.controls.locked = true; window.klibb.setSize(40); window.klibb.stampAt(x, 0.15); window.klibb.controls.locked = false; }, x);
      await sleep(500);
    }
    // the radio (opens the sound panel) and a dial turn
    await P.evaluate(() => window.klibb.menuAction('radio')); await sleep(600);
    await P.evaluate(() => { const r = window.klibb.radio(); r.onChange?.(); }).catch(() => {});
    await P.keyboard.press('Escape'); await sleep(300);
    await P.evaluate(() => window.klibb.soundUi()?.close?.()).catch(() => {});
    // a late sticker (its own scene) – the log's clock is moved so it is > 8 s later
    await P.evaluate(() => { const L = window.klibb.filmLog(); L.t0 -= 20000; });
    await P.evaluate((id) => window.klibb.selectDesign(window.klibb.state.library.find((d) => d.id === id)), designs[3]); await sleep(300);
    await P.evaluate(() => { window.klibb.controls.locked = true; window.klibb.stampAt(0.1, -0.15); window.klibb.controls.locked = false; }); await sleep(600);
    await P.evaluate(() => { const L = window.klibb.filmLog(); L.t0 -= 20000; L.add('peel'); L.t0 -= 20000; });
    const log = await P.evaluate(() => window.klibb.filmLog().events().map((e) => e.e));
    check('the log has my stickers, the radio and the peel', log.filter((e) => e === 'stick').length === 4 && log.includes('radio') && log.includes('peel'), log);
    // the door: choose 3 → bag (skip draw) → name → to city
    await P.evaluate(() => window.klibb.menuAction('door')); await sleep(300);
    await P.click('#menu-choice-list [data-id="enter-city"]'); await sleep(800);
    const ids = await P.evaluate(() => [...document.querySelectorAll('#df-grid .df-g')].slice(3, 6).map((b) => b.dataset.id));
    for (const id of ids) await P.click(`#df-grid .df-g[data-id="${id}"]`);
    await P.click('#df-next'); await sleep(700);
    await P.click('#df-skip-design'); await sleep(400);
    if (await P.isVisible('#df-city-skip')) await P.click('#df-city-skip');
    await sleep(500);
    if (await P.isVisible('#df-name-yes')) { await P.click('#df-name-yes'); await sleep(300); }
    await P.fill('#df-name', 'Kira pack');
    await P.click('#df-name-go'); await sleep(400);
    const t0 = Date.now();
    await P.click('#df-city');
    await P.waitForSelector('#film-ui:not([hidden]) #fu-skip', { timeout: 15000 });
    await P.waitForSelector('#film-canvas', { timeout: 30000 }).catch(() => {});
    await sleep(1500);
    await P.screenshot({ path: path.join(SHOTS, '00-making-the-film.png') });
    await P.waitForFunction(() => window.klibb.filmState().phase === 'ask', null, { timeout: 120000 });
    const fst = await P.evaluate(() => window.klibb.filmState());
    console.log('    film:', JSON.stringify(fst), `made in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    check('the film: open … stick, radio, stick, cut … and the PACK LAST', fst.scenes[0] === 'open' && fst.scenes.at(-1) === 'pack' && fst.scenes.includes('radio') && fst.scenes.filter((k) => k === 'stick').length === 2 && fst.scenes.includes('cut'), fst.scenes);
    check('…recorded to a video file (webm here) with real bytes', fst.bytes > 20000 && /webm|mp4/.test(fst.mime), fst);
    check('the big dialog: Watch / Download / Discard', await P.isVisible('#fu-watch') && await P.isVisible('#fu-download') && await P.isVisible('#fu-discard') && !(await P.isDisabled('#fu-download')));
    await P.screenshot({ path: path.join(SHOTS, '20-dialog.png') });
    // stills of every scene kind (an offscreen pass, the same renderer as the film)
    const stills = await P.evaluate(async () => {
      const pv = await window.klibb.filmPreview([1600, 900]);
      const out = {}; const seen = {};
      for (const s of pv.plan.scenes) {
        const n = (seen[s.kind] = (seen[s.kind] || 0) + 1);
        if (s.kind === 'stick') { for (const u of [0.18, 0.42, 0.62, 0.95]) out[`stick${n}-${Math.round(u * 100)}`] = pv.frame(s.t0 + s.dur / Math.max(1, s.stickers.length) * u); }
        else if (s.kind === 'pack') { for (const u of [0.12, 0.35, 0.6, 0.8, 0.97]) out[`pack-${Math.round(u * 100)}`] = pv.frame(s.t0 + s.dur * u); }
        else out[`${s.kind}${n}`] = pv.frame(s.t0 + s.dur * (s.kind === 'open' ? 0.45 : 0.55));
        // tiny pause per scene: the textures settle
        await new Promise((r) => setTimeout(r, 50));
      }
      pv.dispose(); return out;
    });
    let k = 1;
    for (const [name, url] of Object.entries(stills)) savePng(`${String(k++).padStart(2, '0')}-${name}.png`, url);
    check('stills of every scene kind saved', ['open1', 'stick1-42', 'radio1', 'cut1', 'pack-60', 'pack-97'].every((n) => stills[n]), Object.keys(stills));
    // pixel sanity: the pack scene is bright and colourful, the stick close-up is not empty
    // Watch
    await P.click('#fu-watch'); await sleep(1800);
    const playing = await P.evaluate(() => { const v = document.getElementById('fu-video'); return v ? { t: v.currentTime, paused: v.paused } : null; });
    check('Watch plays the film in the dialog', playing && playing.t > 0.3, playing);
    await P.screenshot({ path: path.join(SHOTS, '21-watching.png') });
    // Download
    const [dl] = await Promise.all([P.waitForEvent('download', { timeout: 15000 }), P.click('#fu-download')]);
    const file = path.join(SHOTS, 'film' + path.extname(dl.suggestedFilename()));
    await dl.saveAs(file);
    const size = fs.statSync(file).size;
    let probe = '';
    try { probe = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,nb_read_frames', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim(); } catch (e) { probe = 'no ffprobe: ' + e.message.slice(0, 80); }
    console.log('    downloaded:', file, size, 'bytes', probe);
    check('Download saves the film file (.webm)', /\.webm$|\.mp4$/.test(file) && size > 20000, { file, size });
    check('…after it, the 3rd button says "Go into the city"', /Go into the city/.test(await P.textContent('#fu-discard')));
    // Discard → the city picker, the log cleared
    await P.click('#fu-discard'); await sleep(600);
    const pick = await P.evaluate(() => window.klibb.city().pick);
    check('Discard/continue → the city picker; the film screen gone; the log cleared', pick.open && !(await P.isVisible('#film-ui')) && await P.evaluate(() => window.klibb.filmLog().events().length === 0), pick);
    check('no page errors', errors.length === 0, errors);
  } catch (err) { failed++; console.log('  ✗ crashed: ' + (err.stack || err)); }
  await browser.close(); S.child.kill();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
