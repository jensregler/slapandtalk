// E2E: pac makeover door flow (Jens, Nov 2026).
// Enter city → pick bag (carousel + marker, no name/draw/to-city) → draw done/skip →
// new-city question only when no cities → choose 3 stickers → reveal + name →
// back to room / to the city. Own server (DOOR_E2E_PORT, 8903).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.DOOR_E2E_PORT || 8903);
const SHOTS = process.env.STICKERMENU_SHOTS || '/workspace/stickermenu-shots';
const PAC_SHOTS = process.env.PAC_MAKEOVER_SHOTS || '/workspace/pacmakeover';
const DOOR = 'fe62d4b007728d63', PAC = 'c70d4436a5b53efc';
const BAG_SHOTS = process.env.LIB_TEAM_SHOTS || '/workspace/lib-team-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync(PAC_SHOTS, { recursive: true });
  fs.mkdirSync(BAG_SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) })).json();
    const R = made.room.id;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await ctx.addInitScript(([r, k]) => localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })), [R, made.roomKey]);
    const P = await ctx.newPage(); P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${S.base}/?room=${R}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected, null, { timeout: 60000 });
    await sleep(1200);
    await P.evaluate(() => { const k = window.klibb; k.setView('first', { quiet: true }); k.moveTo(0, -1.4); k.look(0, 0.05); });
    await sleep(400);
    for (const [id, x] of [[DOOR, -0.3], [PAC, 0.3]]) {
      await P.evaluate((id) => window.klibb.selectDesign(window.klibb.state.library.find((d) => d.id === id)), id); await sleep(500);
      await P.evaluate((x) => { window.klibb.controls.locked = true; window.klibb.setSize(60); window.klibb.stampAt(x, 0.1); window.klibb.controls.locked = false; }, x);
      await sleep(500);
    }
    await sleep(600);
    check('city + former menu stickers are off the wheel', await P.evaluate((ids) => ids.every((id) => !window.klibb.stickerDesigns().some((d) => d.id === id)), [DOOR, PAC]));
    check('…clicking a placed former menu sticker opens nothing', await P.evaluate(() => window.klibb.menuClick(-0.3, 0.1)) === false);
    await P.evaluate(() => window.klibb.menuAction('door')); await sleep(400);
    await P.screenshot({ path: path.join(SHOTS, '30-door-choice.png') });
    await P.click('#menu-choice-list [data-id="enter-city"]'); await sleep(1000);

    let st = await P.evaluate(() => window.klibb.door());
    check('Enter city → bag picker (no sticker grid yet)', st.open && st.step === 'bags', st);
    check('…no page dots, no name field, no draw/to-city on bags step', await P.evaluate(() => ({
      dots: !!document.getElementById('df-dots'),
      name: !document.getElementById('df-name') || document.getElementById('df-reveal')?.hidden,
      draw: !document.getElementById('df-draw'),
      city: document.getElementById('df-city') && !document.getElementById('df-done')?.hidden === false ? false : !document.querySelector('#df-bags:not([hidden]) #df-city'),
      marker: !!document.getElementById('df-marker') && !document.getElementById('df-bags').hidden,
      skip: !!document.getElementById('df-skip-design'),
    })).then((x) => !x.dots && x.name && x.draw && x.marker && x.skip));
    await P.screenshot({ path: path.join(PAC_SHOTS, 'new-01-bags.png') });
    await P.screenshot({ path: path.join(SHOTS, '31-door-bags.png') });

    // Bag carousel
    const bagPx = () => P.evaluate(() => { const d = document.getElementById('df-pac-canvas').getContext('2d').getImageData(150, 100, 1, 1).data; return [d[0], d[1], d[2]].join(); });
    const seen = [await bagPx()];
    await P.screenshot({ path: path.join(BAG_SHOTS, 'pack-1-priority-mail.png') });
    for (let k = 2; k <= 7; k++) { await P.click('#df-bag-next'); await sleep(450); seen.push(await bagPx()); if (k === 4 || k === 7) await P.screenshot({ path: path.join(BAG_SHOTS, `pack-${k}.png`) }); }
    st = await P.evaluate(() => window.klibb.door());
    check('…› steps through the 7 bags (each label a different colour)', st.bag === 7 && new Set(seen).size === 7, { bag: st.bag, seen });
    await P.click('#df-bag-next'); await sleep(350);
    check('…and round to the first again', (await P.evaluate(() => window.klibb.door())).bag === 1);
    await P.click('#df-bag-prev'); await sleep(350); await P.keyboard.press('ArrowLeft'); await sleep(350);
    check('…‹ and ← go back (7, 6)', (await P.evaluate(() => window.klibb.door())).bag === 6);
    // Pick bag 4 for the rest
    for (let i = 0; i < 5; i++) { await P.click('#df-bag-next'); await sleep(200); }
    check('…landed on bag 4', (await P.evaluate(() => window.klibb.door())).bag === 4);

    // Draw via marker
    await P.click('#df-marker'); await sleep(900);
    const nt = await P.evaluate(() => window.klibb.nameTag());
    check('marker → draw (done/skip labels, portrait pac, label clip)', nt.open && await P.evaluate(() => {
      const save = document.getElementById('nt-save')?.textContent;
      const exit = document.getElementById('nt-exit')?.textContent;
      return document.getElementById('nt-blank').height === 802
        && document.getElementById('nametag').classList.contains('nt-portrait')
        && document.getElementById('nametag').classList.contains('nt-zoom-clip')
        && /done/i.test(save) && /skip/i.test(exit);
    }), nt);
    await P.screenshot({ path: path.join(PAC_SHOTS, 'new-02-draw.png') });
    const tag = await P.locator('#nt-stroke').boundingBox();
    await P.mouse.move(tag.x + tag.width * 0.2, tag.y + tag.height * 0.17); await P.mouse.down(); await P.mouse.move(tag.x + tag.width * 0.6, tag.y + tag.height * 0.15, { steps: 15 }); await P.mouse.up();
    await P.screenshot({ path: path.join(SHOTS, '33-door-draw-on-pac.png') });
    await P.mouse.move(tag.x + tag.width * 0.1, tag.y + tag.height * 0.55); await P.mouse.down(); await P.mouse.move(tag.x + tag.width * 0.9, tag.y + tag.height * 0.6, { steps: 15 }); await P.mouse.up();
    await P.mouse.move(tag.x + tag.width * 0.5, tag.y + tag.height * 0.2); await P.mouse.down(); await P.mouse.move(tag.x + tag.width * 0.5, tag.y + tag.height * 0.7, { steps: 15 }); await P.mouse.up();
    const ink = await P.evaluate(() => { const L = window.klibb.nameTag().clip; const d = document.getElementById('nt-ink').getContext('2d').getImageData(0, 0, 563, 802).data; let inL = 0, out = 0; for (let y = 0; y < 802; y++) for (let x = 0; x < 563; x++) { if (d[(y * 563 + x) * 4 + 3] < 10) continue; if (x >= L.x && x <= L.x + L.w && y >= L.y && y <= L.y + L.h) inL++; else out++; } return { inL, out }; });
    check('…drawing only on the label (t477u)', ink.inL > 200 && ink.out === 0, ink);
    await P.click('#nt-save');
    await P.waitForFunction(() => window.klibb.door().open && window.klibb.door().step !== null, null, { timeout: 10000 }).catch(() => {}); await sleep(500);

    st = await P.evaluate(() => window.klibb.door());
    check('done → new-city step (no cities yet)', st.open && st.step === 'newcity' && st.drawn, st);
    check('…Which city? picker is NOT open yet', await P.evaluate(() => !window.klibb.city().pick.open));
    await P.screenshot({ path: path.join(PAC_SHOTS, 'new-03-newcity.png') });
    await P.fill('#df-city-name', 'Door town');
    await P.click('#df-city-go'); await sleep(500);

    st = await P.evaluate(() => window.klibb.door());
    check('…then choose 3 stickers', st.open && st.step === 'pick' && st.cityName === 'Door town', st);
    await P.screenshot({ path: path.join(PAC_SHOTS, 'new-04-pick3.png') });
    await P.screenshot({ path: path.join(SHOTS, '31-door-choose-3.png') });
    const ids = await P.evaluate(() => [...document.querySelectorAll('#df-grid .df-g')].slice(3, 7).map((b) => b.dataset.id));
    for (const id of ids) await P.click(`#df-grid .df-g[data-id="${id}"]`);
    st = await P.evaluate(() => window.klibb.door());
    check('…at most 3; pack them is on with 3', st.picked.length === 3 && JSON.stringify(st.picked) === JSON.stringify(ids.slice(0, 3)) && !(await P.isDisabled('#df-next')), st);
    await P.click('#df-next'); await sleep(1200);

    st = await P.evaluate(() => window.klibb.door());
    const px = await P.evaluate(() => { const d = document.getElementById('df-reveal-canvas').getContext('2d').getImageData(0, 0, 563, 802).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n++; return n / (563 * 802); });
    check('reveal: pac with 3 stickers + name your pac?', st.step === 'reveal' && px > 0.35 && st.bag === 4, { st, px });
    await P.screenshot({ path: path.join(PAC_SHOTS, 'new-05-reveal.png') });
    await P.fill('#df-name', 'Malmö pac');
    await P.click('#df-name-go'); await sleep(600);

    st = await P.evaluate(() => window.klibb.door());
    check('done step: named pac + back to room / to the city', st.step === 'done' && st.pacName === 'Malmö pac' && await P.isVisible('#df-room') && await P.isVisible('#df-city'), st);
    await P.screenshot({ path: path.join(PAC_SHOTS, 'new-06-done.png') });
    await P.screenshot({ path: path.join(SHOTS, '32-door-pac.png') });

    const { FILMS_ENABLED } = await import('../shared/features.mjs');
    await P.click('#df-city');
    if (FILMS_ENABLED) {
      await P.waitForSelector('#film-ui:not([hidden]) #fu-skip', { timeout: 15000 }).catch(() => {});
      check('"to the city" first makes my film', await P.isVisible('#fu-skip'));
      await P.click('#fu-skip'); await sleep(500);
    } else {
      await P.waitForURL(/room=stad-[a-z0-9]{6}$/, { timeout: 20000 }).catch(() => {});
      await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 }).catch(() => {}); await sleep(1500);
      check('"to the city" with early name creates the city (no Which city? dialog)', await P.evaluate(() => {
        const c = window.klibb.city();
        return c.outside && !c.pick.open;
      }));
    }
    const pac = await P.evaluate(() => { const p = JSON.parse(localStorage.getItem('klibb.pac')); return { name: p.name, n: p.stickers.length, bag: p.bag, img: (p.img || '').slice(0, 15) }; });
    const city = await P.evaluate(() => window.klibb.city());
    check('…in the new city, pac kept (name, 3 stickers, bag 4, picture)', city.outside && pac.name === 'Malmö pac' && pac.n === 3 && pac.bag === 4 && pac.img.startsWith('data:image/'), { city, pac });
    const wheelHasPack = await P.evaluate(() => window.klibb.city().wheel.includes('city-pack'));
    check('…pac sits on the city sticker wheel', wheelHasPack);
    await P.screenshot({ path: path.join(PAC_SHOTS, 'new-07-city-wheel.png') });
    await P.screenshot({ path: path.join(SHOTS, '34-door-to-city.png') });

    // Pack button → shop (Town Hall) directly
    await P.evaluate(() => { const pack = window.klibb.stickerDesigns().find((d) => d.id === 'city-pack'); if (pack) window.klibb.selectDesign(pack); });
    await sleep(200);
    await P.evaluate(() => window.klibb.stampAt(0, 0.1)); await sleep(800);
    check('…tapping the pack opens the Town Hall shop', await P.evaluate(() => !!window.klibb.city().hall.open));
    await P.screenshot({ path: path.join(PAC_SHOTS, 'new-08-shop.png') });

    // ---- Skip paths in a fresh room ----
    await P.evaluate(() => { window.klibb.city().hall.open && document.querySelector('#th-x')?.click(); });
    await sleep(300);
    // New room for skip-path checks
    const made2 = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) })).json();
    const R2 = made2.room.id;
    await ctx.addInitScript(([r, k]) => {
      const o = JSON.parse(localStorage.getItem('klibb.roomKeys') || '{}'); o[r] = k; localStorage.setItem('klibb.roomKeys', JSON.stringify(o));
      localStorage.removeItem('klibb.pac');
    }, [R2, made2.roomKey]);
    await P.goto(`${S.base}/?room=${R2}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
    await sleep(800);
    await P.evaluate(() => window.klibb.menuAction('door')); await sleep(300);
    await P.click('#menu-choice-list [data-id="enter-city"]'); await sleep(800);
    // Cities now exist (Door town) → no newcity step after skip design
    await P.click('#df-skip-design'); await sleep(600);
    st = await P.evaluate(() => window.klibb.door());
    check('skip design when a city exists → straight to sticker pick (no new-city)', st.step === 'pick', st);
    await P.screenshot({ path: path.join(PAC_SHOTS, 'new-09-skip-to-pick.png') });
    const ids2 = await P.evaluate(() => [...document.querySelectorAll('#df-grid .df-g')].slice(0, 3).map((b) => b.dataset.id));
    for (const id of ids2) await P.click(`#df-grid .df-g[data-id="${id}"]`);
    await P.click('#df-next'); await sleep(900);
    await P.click('#df-name-skip'); await sleep(500);
    st = await P.evaluate(() => window.klibb.door());
    check('skip name → done with empty pac name', st.step === 'done' && st.pacName === '', st);
    await P.click('#df-room'); await sleep(500);
    const pac2 = await P.evaluate(() => { try { return JSON.parse(localStorage.getItem('klibb.pac')); } catch { return null; } });
    check('back to room saves pac and stays (no city picker)', pac2 && pac2.stickers.length === 3 && pac2.name === '' && await P.evaluate(() => !window.klibb.city().pick.open && !window.klibb.door().open), pac2);

    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await browser.close(); S.child.kill();
  console.log(`\nDoor e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
