// CREATE + full sticker wheel available in the city (same as the room).
// Also: packs wheel still shows all carried packs (≤3) after opening PACKS mode.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.CREATEROOM_E2E_PORT || 8925);
const SHOTS = process.env.CREATEROOM_SHOTS || '/workspace/createroomonly';
let passed = 0, failed = 0;
const check = (name, ok, extra) => {
  if (ok) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 700) : '')); }
};

const pac = (n) => ({
  id: 'pack-id-' + n, name: 'Pack' + n,
  stickers: ['s' + n + 'a', 's' + n + 'b', 's' + n + 'c'],
  urls: ['/start/pac.webp', '/start/pac.webp', '/start/pac.webp'], designs: [], bag: 1,
  img: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="112" height="160"><rect width="112" height="160" rx="12" fill="hsl(${n * 80} 70% 45%)"/><text x="56" y="90" text-anchor="middle" fill="#fff" font-size="40">${n}</text></svg>`)}`,
  at: new Date().toISOString(),
});

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) })).json();
    const R = made.room.id;
    const city = await (await fetch(`${S.base}/api/cities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'CreateInCity' }) })).json();
    const CID = city.city.id;
    const packs = [pac(1), pac(2), pac(3)];
    const lib = (await (await fetch(`${S.base}/api/library`)).json()).stickers || [];
    const libIds = lib.filter((d) => d && d.url && !d.nature).map((d) => d.id);

    // ---- Room: ESC has CREATE ----
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await ctx.addInitScript(([r, k, packs]) => {
        localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k }));
        localStorage.setItem('klibb.packs', JSON.stringify(packs));
        localStorage.setItem('klibb.pac', JSON.stringify(packs[2]));
        localStorage.setItem('klibb.devUnlock', '1');
      }, [R, made.roomKey, packs]);
      const P = await ctx.newPage();
      P.on('pageerror', (e) => errors.push('room: ' + e.message));
      await P.goto(`${S.base}/?room=${R}`);
      await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
      await P.evaluate(() => { window.klibb.escGate.unlockedAt = -1e9; window.klibb.escMenu().open(); });
      await sleep(500);
      const info = await P.evaluate(() => window.klibb.escMenu().info());
      check('room ESC menu includes CREATE', info.open && info.buttons.includes('create') && !info.hideCreate, info);
      await P.screenshot({ path: path.join(SHOTS, 'room-esc-with-create.png') });

      // Packs wheel: 3 of 3 visible
      await P.evaluate(() => window.klibb.escMenu().close());
      await P.click('#mode-packs');
      await sleep(700);
      const w = await P.evaluate(() => {
        const btns = [...document.querySelectorAll('#packs-row .strip-th')];
        return {
          stored: JSON.parse(localStorage.getItem('klibb.packs') || '[]').length,
          num: document.getElementById('packs-num').textContent,
          visible: btns.filter((b) => b.style.display !== 'none' && Number(b.style.opacity) > 0.05).length,
          ops: btns.map((b) => Number(b.style.opacity)),
          stripW: document.getElementById('packs-strip').clientWidth,
        };
      });
      check('room PACKS wheel: 3 stored, counter ≤3, all 3 visible', w.stored === 3 && /3\/3/.test(w.num) && w.visible === 3, w);
      await P.screenshot({ path: path.join(SHOTS, 'room-packs-wheel-3.png') });
      await ctx.close();
    }

    // ---- City: ESC has CREATE; editors open; full sticker wheel ----
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await ctx.addInitScript(([r, k, packs]) => {
        localStorage.setItem('klibb.roomKeys', JSON.stringify({ [r]: k }));
        localStorage.setItem('klibb.packs', JSON.stringify(packs));
        localStorage.setItem('klibb.pac', JSON.stringify(packs[2]));
        localStorage.setItem('klibb.devUnlock', '1');
      }, [R, made.roomKey, packs]);
      const P = await ctx.newPage();
      P.on('pageerror', (e) => errors.push('city: ' + e.message));
      await P.goto(`${S.base}/?room=${CID}`);
      await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
      await sleep(800);
      check('in city', await P.evaluate(() => window.klibb.city().inCity));

      await P.evaluate(() => { window.klibb.escGate.unlockedAt = -1e9; window.klibb.escMenu().open(); });
      await sleep(500);
      const info = await P.evaluate(() => window.klibb.escMenu().info());
      check('city ESC menu includes CREATE', info.open && !info.hideCreate && info.buttons.includes('create'), info);
      await P.screenshot({ path: path.join(SHOTS, 'city-esc-with-create.png') });
      // Also write the delegated screenshot path
      await P.screenshot({ path: '/workspace/city-create.png' });
      await P.evaluate(() => window.klibb.escMenu().close());

      // CREATE → STICKERS / STICKER PACK open the editors
      await P.evaluate(() => window.klibb.menuAction('nametag'));
      await sleep(400);
      const ntOpen = await P.evaluate(() => window.klibb.nameTag().open);
      check('city: CREATE → STICKERS opens nametag editor', !!ntOpen, { ntOpen });
      await P.click('#nt-exit');
      await sleep(300);
      await P.evaluate(() => window.klibb.menuAction('stickerPack'));
      await sleep(400);
      const doorOpen = await P.evaluate(() => window.klibb.door().open);
      check('city: CREATE → STICKER PACK opens pack maker', !!doorOpen, { doorOpen });
      await P.click('#df-cancel');
      await sleep(300);

      // Full sticker wheel = deck (library), not just 3 carried pack stickers
      const wheel = await P.evaluate(() => {
        const ids = window.klibb.stickerDesigns().map((d) => d.id);
        const deck = window.klibb.deck();
        return { n: ids.length, deckN: deck.length, hasCityPack: ids.includes('city-pack'), sample: ids.slice(0, 8), sameAsDeck: JSON.stringify(ids) === JSON.stringify(deck) };
      });
      check('city sticker wheel is the full deck (not reduced carried packs)', wheel.n > 20 && wheel.sameAsDeck && !wheel.hasCityPack && wheel.n === wheel.deckN, wheel);

      // Nature open when entitled (devUnlock / OPEN_ACCESS)
      const nat = await P.evaluate(() => ({ open: window.klibb.natureOpen(), n: window.klibb.natureDesigns().length, strip: window.klibb.natureStrip() }));
      check('city Nature wheel open like the room (miljöklibbor available)', nat.open && nat.n > 0 && nat.strip.shown, nat);

      // Light the sticker wheel and screenshot full strip
      await P.evaluate(() => { window.klibb.wheelUp(); window.klibb.setMode?.('slap', { quiet: true }); });
      await sleep(400);
      const strip = await P.evaluate(() => window.klibb.strip());
      check('city sticker strip lit with full library count', strip.lit && strip.n > 20, strip);
      await P.screenshot({ path: path.join(SHOTS, 'city-full-wheel.png') });
      await P.screenshot({ path: '/workspace/city-full-wheel.png' });

      // Packs wheel still shows the 3 carried packs
      await P.click('#mode-packs');
      await sleep(700);
      const w = await P.evaluate(() => {
        const btns = [...document.querySelectorAll('#packs-row .strip-th')];
        return {
          stored: JSON.parse(localStorage.getItem('klibb.packs') || '[]').length,
          num: document.getElementById('packs-num').textContent,
          visible: btns.filter((b) => b.style.display !== 'none' && Number(b.style.opacity) > 0.05).length,
          ops: btns.map((b) => Number(b.style.opacity)),
        };
      });
      check('city PACKS wheel: still ≤3 packs, all visible', w.stored === 3 && w.stored <= 3 && /3\/3/.test(w.num) && w.visible === 3, w);
      await P.screenshot({ path: path.join(SHOTS, 'city-packs-wheel-3.png') });
      await ctx.close();
    }

    // ---- City without pac: door does not auto-open (CREATE is there; no forced modal)
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await ctx.addInitScript(() => { localStorage.setItem('klibb.devUnlock', '1'); });
      const P = await ctx.newPage();
      await P.goto(`${S.base}/?room=${CID}`);
      await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
      await sleep(2500);
      check('city with no pac: door does not auto-open', !(await P.evaluate(() => window.klibb.door())).open);
      await P.evaluate(() => { window.klibb.escGate.unlockedAt = -1e9; window.klibb.escMenu().open(); });
      await sleep(400);
      const info = await P.evaluate(() => window.klibb.escMenu().info());
      check('city with no pac: CREATE still reachable', info.open && info.buttons.includes('create'), info);
      await ctx.close();
    }
  } finally {
    await browser.close();
    S.child.kill();
  }
  if (errors.length) console.log('pageerrors', errors.slice(0, 5));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
