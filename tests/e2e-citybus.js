// E2E: city-bus TEST – tinted cities, visible bots+nametags, stickers, bus stop, ages, pack keep.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, sleep } = require('./demo-helpers');

const PORT = Number(process.env.CITYBUS_E2E_PORT || 8944);
const SHOTS = process.env.CITYBUS_SHOTS || '/workspace/citybus';
let passed = 0, failed = 0;
const check = (name, ok, extra) => {
  if (ok) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 600) : '')); }
};

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1', CITYBUS_TEST: '1' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  try {
    const seed = await (await fetch(`${S.base}/api/citybus/seed`, { method: 'POST' })).json();
    check('seed returns 3 test cities', Array.isArray(seed.cities) && seed.cities.length === 3, seed);
    const ids = (seed.cities || []).map((c) => c.id);
    check('cities are grnhal / redhal / bluhal', ids.includes('stad-grnhal') && ids.includes('stad-redhal') && ids.includes('stad-bluhal'), ids);
    check('seed has library stickers', (seed.libraryStickers || 0) >= 3, seed.libraryStickers);

    const st0 = await (await fetch(`${S.base}/api/citybus/status`)).json();
    check('status enabled with bots', st0.enabled && st0.bots && st0.bots.length >= 3, { enabled: st0.enabled, nBots: st0.bots?.length });
    check('cities backdated (not 0 min)', (st0.cities || []).every((c) => {
      const age = Date.now() - Date.parse(c.createdAt || '');
      return age > 24 * 3600_000;
    }), (st0.cities || []).map((c) => c.createdAt));
    check('cities have stickers on walls', (st0.cities || []).every((c) => (c.stickers || 0) >= 1), (st0.cities || []).map((c) => ({ id: c.id, stickers: c.stickers })));

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => {
      localStorage.setItem('klibb.devUnlock', '1');
      const packs = [1, 2, 3].map((n) => ({
        id: 'testpack-' + n, name: 'Pack ' + n, stickers: ['a' + n, 'b' + n, 'c' + n],
        urls: ['/start/pac.webp', '/start/pac.webp', '/start/pac.webp'], bag: n, img: '/start/pac.webp',
      }));
      localStorage.setItem('klibb.packs', JSON.stringify(packs));
      localStorage.setItem('klibb.pac', JSON.stringify(packs[0]));
    });
    const P = await ctx.newPage();
    P.on('pageerror', (e) => errors.push(e.message));

    await P.goto(`${S.base}/?room=stad-grnhal&testbus=1`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 90000 });
    // Wait for realtime bots (or local fallback) + stamps
    await P.waitForFunction(() => {
      const c = window.klibb.city();
      return (c.bots || []).length >= 2 && c.busStop;
    }, null, { timeout: 20000 }).catch(() => {});
    await sleep(1500);
    await P.evaluate(() => window.klibb.bus().lookAtPlaza());
    await sleep(800);

    const c1 = await P.evaluate(() => window.klibb.city());
    const presence = await P.evaluate(() => document.getElementById('presence-text')?.textContent || '');
    const stampWord = await P.evaluate(() => document.getElementById('stamp-count')?.textContent || '0');
    check('in Grönstad test city with bus stop', c1.id === 'stad-grnhal' && c1.testBus && c1.busStop, c1);
    check('bots present (names + insta)', (c1.bots || []).length >= 2 && c1.bots.every((b) => b.name && b.insta), c1.bots);
    check('presence counts more than just you', !/just you/i.test(presence) && /\d+ here/i.test(presence), presence);
    check('sticker HUD > 0', Number(stampWord) > 0, stampWord);
    await P.screenshot({ path: path.join(SHOTS, 'v2-01-bots-plaza.png') });
    await P.screenshot({ path: path.join(SHOTS, '01-city-green-hall.png') });

    // Bus sheet + ages
    await P.evaluate(() => window.klibb.bus().openSheet());
    await sleep(900);
    const busOpen = await P.evaluate(() => window.klibb.bus().open);
    check('bus sheet opens', busOpen);
    const rows = await P.evaluate(() => [...document.querySelectorAll('#bus-list .bus-row')].map((b) => ({
      id: b.dataset.id, name: b.querySelector('.bus-name')?.textContent, facts: b.querySelector('.bus-facts')?.textContent,
    })));
    check('bus lists the other 2 cities', rows.length === 2 && rows.every((r) => r.id !== 'stad-grnhal'), rows);
    check('rows show stickers/visitors/multi-unit age', rows.every((r) => /sticker/i.test(r.facts || '') && /visitor/i.test(r.facts || '') && /(day|hour|days|hours)/i.test(r.facts || '') && !/0 minutes/i.test(r.facts || '')), rows);
    await P.screenshot({ path: path.join(SHOTS, 'v2-02-bus-list-ages.png') });
    await P.screenshot({ path: path.join(SHOTS, '02-bus-stop-list.png') });

    const packsBefore = await P.evaluate(() => { try { return JSON.parse(localStorage.getItem('klibb.packs') || '[]').length; } catch { return 0; } });
    check('player carries 3 packs before bus', packsBefore === 3, packsBefore);

    const red = rows.find((r) => r.id === 'stad-redhal') || rows[0];
    await P.click(`.bus-row[data-id="${red.id}"]`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.city()?.id && window.klibb.city().id !== 'stad-grnhal', null, { timeout: 90000 }).catch(() => {});
    await sleep(2500);
    await P.evaluate(() => window.klibb.bus()?.lookAtPlaza?.());
    await sleep(600);
    const c2 = await P.evaluate(() => window.klibb.city());
    const packsAfter = await P.evaluate(() => { try { return JSON.parse(localStorage.getItem('klibb.packs') || '[]').length; } catch { return 0; } });
    check('arrived in another test city', c2.id && c2.id !== 'stad-grnhal' && c2.testBus, c2);
    check('packs still 3 after bus ride', packsAfter === 3, packsAfter);
    await P.screenshot({ path: path.join(SHOTS, 'v2-03-arrival-bots.png') });
    await P.screenshot({ path: path.join(SHOTS, '03-arrival-red-or-other.png') });

    // Blue + red with plaza aim
    await P.goto(`${S.base}/?room=stad-bluhal&testbus=1`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 90000 });
    await P.waitForFunction(() => (window.klibb.city().bots || []).length >= 1, null, { timeout: 15000 }).catch(() => {});
    await P.evaluate(() => window.klibb.bus().lookAtPlaza());
    await sleep(1000);
    await P.screenshot({ path: path.join(SHOTS, 'v2-04-blue-bots.png') });
    await P.screenshot({ path: path.join(SHOTS, '04-city-blue-hall.png') });

    await P.goto(`${S.base}/?room=stad-redhal&testbus=1`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 90000 });
    await P.waitForFunction(() => (window.klibb.city().bots || []).length >= 1, null, { timeout: 15000 }).catch(() => {});
    await P.evaluate(() => window.klibb.bus().lookAtPlaza());
    await sleep(1000);
    await P.screenshot({ path: path.join(SHOTS, 'v2-05-red-bots-stickers.png') });
    await P.screenshot({ path: path.join(SHOTS, '05-city-red-hall.png') });
    await P.screenshot({ path: path.join(SHOTS, '06-bots-walking.png') });
    await P.screenshot({ path: path.join(SHOTS, 'v2-06-bots-walking.png') });

    await P.evaluate(() => { document.getElementById('mode-packs')?.click(); });
    await sleep(600);
    await P.screenshot({ path: path.join(SHOTS, '07-packs-wheel.png') });

    await sleep(12000);
    const journeys = await (await fetch(`${S.base}/api/citybus/journeys`)).json();
    check('pack journeys logged (handIn/take/arrive)', (journeys.packJourneys || []).length >= 1 || (journeys.journeys || []).some((j) => j.action === 'handIn'), {
      n: journeys.packJourneys?.length, sample: (journeys.journeys || []).slice(0, 5),
    });
    fs.writeFileSync(path.join(SHOTS, 'pack-journeys.json'), JSON.stringify(journeys, null, 2));
    check('no page errors', errors.length === 0, errors.slice(0, 5));
  } catch (e) {
    failed++; console.log('  ✗ crashed: ' + (e.stack || e));
  }
  await browser.close(); S.child.kill();
  console.log(`\nCity-bus e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
