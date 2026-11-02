// E2E: the door (Jens, 31 Oct 2026; mockups door-1..5, client/src/door.js). Click a placed door
// (city.png; since t471u, 2 Nov 2026, the city goes through city only – an old stickerpac sticker is a
// plain sticker) → "Enter the city" / "Back to the room"; enter → "choose 3 slaps to
// bring" → the three go into the Priority Mail pac (Jens's stickerpac.png) → name it, draw on it →
// "to city" = "The city is coming soon!" (the pac is kept on the device). Own server (DOOR_E2E_PORT, 8903).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.DOOR_E2E_PORT || 8903);
const SHOTS = process.env.STICKERMENU_SHOTS || '/workspace/stickermenu-shots';
const DOOR = 'fe62d4b007728d63', PAC = '20c9aed10d5a98e8';
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
    check('the city (door) sticker is a menu sticker; an old stickerpac sticker is not (t471u)', JSON.stringify(await P.evaluate(() => [window.klibb.menuAt(-0.3, 0.1), window.klibb.menuAt(0.3, 0.1)])) === '["door",null]');
    check('…the stickerpac is not on the wheel any more', await P.evaluate((id) => !window.klibb.stickerDesigns().some((d) => d.id === id), PAC));
    const used = await P.evaluate(() => window.klibb.menuClick(0.3, 0.1)); await sleep(400);
    check('…a click on the old stickerpac opens nothing (inert)', used === false && await P.evaluate(() => !window.klibb.choice().open));
    await P.evaluate(() => window.klibb.menuClick(-0.3, 0.1)); await sleep(400);
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
    check('…the Priority Mail pac with the 3 stickers inside', st.step === 'pac' && px > 0.35, { st, px });
    await P.fill('#df-name', 'Malmö pac');
    await P.screenshot({ path: path.join(SHOTS, '32-door-pac.png') });
    await P.click('#df-draw'); await sleep(800);
    const nt = await P.evaluate(() => window.klibb.nameTag());
    check('"draw on it": the brushes on the pac (one picture, portrait)', nt.open && await P.evaluate(() => document.getElementById('nt-blank').height === 802 && document.getElementById('nametag').classList.contains('nt-portrait')), nt);
    const tag = await P.locator('#nt-stroke').boundingBox();
    await P.mouse.move(tag.x + tag.width * 0.2, tag.y + tag.height * 0.17); await P.mouse.down(); await P.mouse.move(tag.x + tag.width * 0.6, tag.y + tag.height * 0.15, { steps: 15 }); await P.mouse.up();
    await P.screenshot({ path: path.join(SHOTS, '33-door-draw-on-pac.png') });
    await P.click('#nt-save');
    await P.waitForFunction(() => window.klibb.door().open, null, { timeout: 10000 }).catch(() => {}); await sleep(300);
    st = await P.evaluate(() => window.klibb.door());
    check('…save → back to the pac, drawn on', st.open && st.step === 'pac' && st.drawn && !(await P.evaluate(() => window.klibb.nameTag().open)), st);
    await P.click('#df-city'); await sleep(600);
    const pac = await P.evaluate(() => { const p = JSON.parse(localStorage.getItem('klibb.pac')); return { name: p.name, n: p.stickers.length, img: (p.img || '').slice(0, 15) }; });
    const toast = await P.evaluate(() => document.body.innerText.includes('The city is coming soon!'));
    check('"to city" → "The city is coming soon!", the pac kept (name, 3 stickers, picture)', toast && pac.name === 'Malmö pac' && pac.n === 3 && pac.img.startsWith('data:image/'), { toast, pac });
    await P.screenshot({ path: path.join(SHOTS, '34-door-city-soon.png') });
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await browser.close(); S.child.kill();
  console.log(`\nDoor e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
