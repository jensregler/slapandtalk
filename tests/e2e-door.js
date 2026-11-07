// E2E: the door (Jens, 31 Oct 2026; mockups door-1..5, client/src/door.js). Click a placed door
// (city.png; since t471u, 2 Nov 2026, the city goes through city only – an old stickerpac sticker is a
// plain sticker) → "Enter the city" / "Back to the room"; enter → "choose 3 slaps to
// bring" → the three go into the Priority Mail pac (Jens's stickerpac.png) → name it, draw on it →
// "to city" = the city picker → a new city, named (t476u, t479u; the pac is kept on the device). Own server (DOOR_E2E_PORT, 8903).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.DOOR_E2E_PORT || 8903);
const SHOTS = process.env.STICKERMENU_SHOTS || '/workspace/stickermenu-shots';
const DOOR = 'fe62d4b007728d63', PAC = 'c70d4436a5b53efc'; // PAC: a retired menu sticker still in the library (menue.png; stickerpac.png itself is out since 4 Nov)
const BAG_SHOTS = process.env.LIB_TEAM_SHOTS || '/workspace/lib-team-shots';
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); } };
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
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
    await P.click('#menu-choice-list [data-id="enter-city"]'); await sleep(800);
    let st = await P.evaluate(() => window.klibb.door());
    check('"Enter the city" → "choose 3 slaps to bring"', st.open && st.step === 'pick' && await P.isDisabled('#df-next'), st);
    const ids = await P.evaluate(() => [...document.querySelectorAll('#df-grid .df-g')].slice(3, 7).map((b) => b.dataset.id));
    for (const id of ids) await P.click(`#df-grid .df-g[data-id="${id}"]`);
    st = await P.evaluate(() => window.klibb.door());
    check('…at most 3 (the 4th click does nothing); "pack them" is on with 3', st.picked.length === 3 && JSON.stringify(st.picked) === JSON.stringify(ids.slice(0, 3)) && !(await P.isDisabled('#df-next')), st);
    await sleep(600);
    await P.screenshot({ path: path.join(SHOTS, '31-door-choose-3.png') });
    await P.click('#df-next'); await sleep(1200);
    st = await P.evaluate(() => window.klibb.door());
    const px = await P.evaluate(() => { const d = document.getElementById('df-pac-canvas').getContext('2d').getImageData(0, 0, 563, 802).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n++; return n / (563 * 802); });
    check('…the Priority Mail pac with the 3 stickers inside', st.step === 'pac' && px > 0.35 && st.bag === 1, { st, px });
    // t507u (4 Nov 2026): the bag's design is chosen like the name tag's blanks – ‹ › / dots / ← →
    fs.mkdirSync(BAG_SHOTS, { recursive: true });
    const bagPx = () => P.evaluate(() => { const d = document.getElementById('df-pac-canvas').getContext('2d').getImageData(150, 100, 1, 1).data; return [d[0], d[1], d[2]].join(); });
    const seen = [await bagPx()];
    check('…7 dots for the 7 bags, the first one on', await P.evaluate(() => document.querySelectorAll('#df-dots span').length === 7 && document.querySelector('#df-dots span:nth-child(1)').classList.contains('on')));
    await P.screenshot({ path: path.join(BAG_SHOTS, 'pack-1-priority-mail.png') });
    for (let k = 2; k <= 7; k++) { await P.click('#df-bag-next'); await sleep(500); seen.push(await bagPx()); if (k === 4 || k === 7) await P.screenshot({ path: path.join(BAG_SHOTS, `pack-${k}.png`) }); }
    st = await P.evaluate(() => window.klibb.door());
    check('…› steps through the 7 bags (each label a different colour)', st.bag === 7 && new Set(seen).size === 7, { bag: st.bag, seen });
    await P.click('#df-bag-next'); await sleep(400);
    check('…and round to the first again', (await P.evaluate(() => window.klibb.door())).bag === 1);
    await P.click('#df-bag-prev'); await sleep(400); await P.keyboard.press('ArrowLeft'); await sleep(400);
    check('…‹ and ← go back (7, 6)', (await P.evaluate(() => window.klibb.door())).bag === 6);
    await P.click('#df-dots span:nth-child(4)'); await sleep(500);
    st = await P.evaluate(() => window.klibb.door());
    const px4 = await P.evaluate(() => { const d = document.getElementById('df-pac-canvas').getContext('2d').getImageData(0, 0, 563, 802).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n++; return n / (563 * 802); });
    check('…a dot picks a bag (4), the 3 stickers still inside', st.bag === 4 && px4 > 0.35, { st, px4 });
    await P.fill('#df-name', 'Malmö pac');
    await P.screenshot({ path: path.join(SHOTS, '32-door-pac.png') });
    await P.click('#df-draw'); await sleep(800);
    const nt = await P.evaluate(() => window.klibb.nameTag());
    check('"draw on it": the brushes on the pac (one picture, portrait)', nt.open && await P.evaluate(() => document.getElementById('nt-blank').height === 802 && document.getElementById('nametag').classList.contains('nt-portrait')), nt);
    const tag = await P.locator('#nt-stroke').boundingBox();
    await P.mouse.move(tag.x + tag.width * 0.2, tag.y + tag.height * 0.17); await P.mouse.down(); await P.mouse.move(tag.x + tag.width * 0.6, tag.y + tag.height * 0.15, { steps: 15 }); await P.mouse.up();
    await P.screenshot({ path: path.join(SHOTS, '33-door-draw-on-pac.png') });
    // t477u: drawing only on the label – a stroke across the bag leaves no ink outside it
    await P.mouse.move(tag.x + tag.width * 0.1, tag.y + tag.height * 0.55); await P.mouse.down(); await P.mouse.move(tag.x + tag.width * 0.9, tag.y + tag.height * 0.6, { steps: 15 }); await P.mouse.up();
    await P.mouse.move(tag.x + tag.width * 0.5, tag.y + tag.height * 0.2); await P.mouse.down(); await P.mouse.move(tag.x + tag.width * 0.5, tag.y + tag.height * 0.7, { steps: 15 }); await P.mouse.up();
    const ink = await P.evaluate(() => { const L = window.klibb.nameTag().clip; const d = document.getElementById('nt-ink').getContext('2d').getImageData(0, 0, 563, 802).data; let inL = 0, out = 0; for (let y = 0; y < 802; y++) for (let x = 0; x < 563; x++) { if (d[(y * 563 + x) * 4 + 3] < 10) continue; if (x >= L.x && x <= L.x + L.w && y >= L.y && y <= L.y + L.h) inL++; else out++; } return { inL, out }; });
    check('…drawing only on the label (input outside ignored, strokes clipped) (t477u)', ink.inL > 200 && ink.out === 0, ink);
    await P.click('#nt-save');
    await P.waitForFunction(() => window.klibb.door().open, null, { timeout: 10000 }).catch(() => {}); await sleep(300);
    st = await P.evaluate(() => window.klibb.door());
    check('…save → back to the pac, drawn on', st.open && st.step === 'pac' && st.drawn && !(await P.evaluate(() => window.klibb.nameTag().open)), st);
    // "to city →" = the city picker (t479u): start a city and name it, then in
    // pt536u (5 Nov 2026): first my session's film is made (#film-ui); Skip goes straight on to the picker
    await P.click('#df-city');
    await P.waitForSelector('#film-ui:not([hidden]) #fu-skip', { timeout: 15000 }).catch(() => {});
    check('"to city →" first makes my film (the film screen, with Skip) (pt536u)', await P.isVisible('#fu-skip'));
    await P.click('#fu-skip'); await sleep(500);
    const pick = await P.evaluate(() => window.klibb.city().pick);
    check('…Skip → the city picker (t479u), the film screen gone', pick.open && !(await P.isVisible('#film-ui')), pick);
    await P.click('#cp-new'); await P.fill('#cp-name', 'Door town');
    await Promise.all([P.waitForURL(/room=stad-[a-z0-9]{6}$/, { timeout: 20000 }).catch(() => {}), P.click('#cp-go')]);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 }).catch(() => {}); await sleep(1500);
    const pac = await P.evaluate(() => { const p = JSON.parse(localStorage.getItem('klibb.pac')); return { name: p.name, n: p.stickers.length, bag: p.bag, img: (p.img || '').slice(0, 15) }; });
    const city = await P.evaluate(() => window.klibb.city());
    check('…started and named → out into the new city, the pac kept (name, 3 stickers, bag 4, picture)', city.outside && pac.name === 'Malmö pac' && pac.n === 3 && pac.bag === 4 && pac.img.startsWith('data:image/'), { city, pac });
    await P.screenshot({ path: path.join(SHOTS, '34-door-to-city.png') });
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await browser.close(); S.child.kill();
  console.log(`\nDoor e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
