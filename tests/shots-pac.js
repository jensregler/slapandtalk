// Screenshots of the door's Priority Mail pac (t477u, 2 Nov 2026): three stickers in the bag and
// strokes drawn over the label AND the bag. PAC_SHOTS dir, PAC_TAG file-name prefix (before/after).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.PAC_SHOTS_PORT || 8991);
const SHOTS = process.env.PAC_SHOTS || '/workspace/city-shots';
const TAG = process.env.PAC_TAG || 'after';
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) })).json();
    const R = made.room.id;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await ctx.addInitScript(([r, k]) => localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k })), [R, made.roomKey]);
    const P = await ctx.newPage(); P.on('pageerror', (e) => console.log('pageerror', e.message));
    await P.goto(`${S.base}/?room=${R}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.selected, null, { timeout: 60000 });
    await sleep(1000);
    await P.evaluate(() => window.klibb.menuAction('door'));
    await sleep(500);
    if (await P.locator('#menu-choice-list [data-id="enter-city"]').count()) { await P.click('#menu-choice-list [data-id="enter-city"]'); await sleep(800); }
    // the widest stickers make the worst case (Burger King in Jens's screenshot)
    const ids = await P.evaluate(async () => {
      const bs = [...document.querySelectorAll('#df-grid .df-g')];
      const dims = await Promise.all(bs.map((b) => new Promise((res) => { const im = new Image(); im.onload = () => res([b.dataset.id, im.width / im.height]); im.onerror = () => res([b.dataset.id, 1]); im.src = b.querySelector('img').src; })));
      dims.sort((a, b) => Math.abs(Math.log(b[1])) - Math.abs(Math.log(a[1])));
      return dims.slice(0, 3).map((d) => d[0]);
    });
    for (const id of ids) await P.click(`#df-grid .df-g[data-id="${id}"]`);
    await P.click('#df-next'); await sleep(1200);
    await P.fill('#df-name', 'Malmö pac');
    await P.click('#df-draw'); await sleep(800);
    const tag = await P.locator('#nt-stroke').boundingBox();
    const line = async (pts) => { await P.mouse.move(tag.x + tag.width * pts[0][0], tag.y + tag.height * pts[0][1]); await P.mouse.down(); for (const p of pts.slice(1)) await P.mouse.move(tag.x + tag.width * p[0], tag.y + tag.height * p[1], { steps: 12 }); await P.mouse.up(); };
    await line([[0.3, 0.14], [0.55, 0.2], [0.75, 0.1], [0.85, 0.22]]); // on the label
    await line([[0.1, 0.5], [0.4, 0.55], [0.6, 0.45], [0.9, 0.6]]); // across the bag
    await line([[0.2, 0.85], [0.8, 0.75]]);
    await P.screenshot({ path: path.join(SHOTS, `pac-${TAG}-1-drawing.png`) });
    await P.click('#nt-save');
    await P.waitForFunction(() => window.klibb.door().open, null, { timeout: 10000 }).catch(() => {}); await sleep(500);
    await P.screenshot({ path: path.join(SHOTS, `pac-${TAG}-2-pac.png`) });
    await P.locator('#df-pac-canvas').screenshot({ path: path.join(SHOTS, `pac-${TAG}-3-pac-close.png`) });
  } catch (e) { console.log('crashed', e.stack || e); }
  await browser.close(); S.child.kill();
})();
