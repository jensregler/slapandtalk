// E2E (Jens t964u): Load sample opens the site library list (big type) with preview + Upload your own.
// Own server (8944). Large screenshot → /workspace/sample-lib/.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.SAMPLELIB_E2E_PORT || 8944);
const SHOTS = process.env.SAMPLELIB_SHOTS || '/workspace/sample-lib';
fs.mkdirSync(SHOTS, { recursive: true });
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 900) : '')); } };

(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) })).json();
    const R = made.room.id;
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2 });
    const A = await ctx.newPage(); A.on('pageerror', (e) => errors.push('A: ' + e.message));
    await A.goto(`${S.base}/?room=${R}`);
    await A.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
    await A.mouse.click(800, 600); await sleep(400);
    const man = await (await fetch(`${S.base}/sample-lib/manifest.json`)).json();
    const nSamp = man.groups.reduce((s, g) => s + g.samples.length, 0);
    check('GET /sample-lib/manifest.json: 37 samples in three groups', nSamp === 37 && man.groups.length === 3, { nSamp, groups: man.groups.map((g) => [g.id, g.samples.length]) });
    const wav = await fetch(`${S.base}/sample-lib/${man.groups[0].samples[0].file}`);
    check('a library wav is served (200, audio/wav or octet-stream)', wav.ok && /audio\/wav|octet-stream|wav/i.test(wav.headers.get('content-type') || 'audio/wav'), wav.status + ' ' + wav.headers.get('content-type'));

    await A.evaluate(() => window.klibb.soundUi().open()); await sleep(400);
    await A.click('#snd-add-sampler'); await sleep(250);
    const open = await A.evaluate(() => ({ load: !!document.getElementById('smp-load'), upload: !!document.getElementById('smp-upload'), file: !!document.querySelector('.snd-sampler .smp-file') }));
    check('Sampler layer has Load sample and Upload your own (file picker kept)', open.load && open.upload && open.file, open);

    await A.click('#smp-load'); await sleep(800);
    const list = await A.evaluate(() => {
      const pop = document.getElementById('smp-lib');
      if (!pop) return null;
      const title = pop.querySelector('.smp-lib-title');
      const items = [...pop.querySelectorAll('.smp-lib-item')];
      const groups = [...pop.querySelectorAll('.smp-lib-group-title')].map((h) => h.textContent);
      const use = pop.querySelector('.smp-lib-use');
      const upload = pop.querySelector('.smp-lib-upload');
      const cs = (el) => el && parseFloat(getComputedStyle(el).fontSize);
      const row = items.find((b) => b.dataset.id === 'bass-3') || items[5];
      return {
        title: title && title.textContent,
        titlePx: cs(title),
        groupPx: cs(pop.querySelector('.smp-lib-group-title')),
        namePx: cs(row && row.querySelector('.smp-lib-name')),
        rowH: row && row.getBoundingClientRect().height,
        n: items.length,
        groups,
        hasUse: !!use,
        hasUpload: !!upload && /Upload your own/.test(upload.textContent),
        bass3: !!items.find((b) => b.dataset.id === 'bass-3'),
      };
    });
    check('Load sample opens a large, clear list of the library + built-ins + Upload your own',
      list && list.title === 'Load sample' && list.titlePx >= 28 && list.groupPx >= 22 && list.namePx >= 22 && list.rowH >= 56
      && list.n >= 37 + 4 && list.bass3 && list.hasUse && list.hasUpload
      && list.groups.includes('Bass') && list.groups.includes('Hat / snare') && list.groups.includes('Other') && list.groups.includes('Built-in'),
      list);

    await A.screenshot({ path: path.join(SHOTS, 'sample-library-list.png'), fullPage: false });
    check('screenshot written', fs.existsSync(path.join(SHOTS, 'sample-library-list.png')) && fs.statSync(path.join(SHOTS, 'sample-library-list.png')).size > 10000);

    await A.click('.smp-lib-item[data-id="bass-3"]'); await sleep(600);
    await A.click('.smp-lib-use'); await sleep(800);
    const used2 = await A.evaluate(() => {
      const patches = window.klibb.soundUi().state().patches || {};
      const l = Object.values(patches).flatMap((p) => p.layers || []).find((x) => x.kind === 'sampler' && x.library);
      return l && { library: l.library, name: l.name, sample: l.sample, len: l.len };
    });
    check('Use this sample stores a library id (bass-3) and a hash so others can fetch the same file',
      used2 && used2.library === 'bass-3' && /^Bass 3$/.test(used2.name) && /^[a-f0-9]{64}$/.test(used2.sample) && used2.len > 0,
      used2);

    const look = await A.evaluate(() => {
      const patches = window.klibb.soundUi().state().patches || {};
      return Object.values(patches).flatMap((p) => p.layers || []).find((x) => x.kind === 'sampler' && x.library) || null;
    });
    check('the patch still has the library reference after use', look && look.library === 'bass-3', look);

    // picker closed
    check('the list closes after use', !(await A.$('#smp-lib')));

    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await browser.close(); S.child.kill();
  console.log(`\nSample library e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
