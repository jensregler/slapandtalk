// E2E: "⬆ Upload sticker" on a desktop viewport, in Chromium and in WebKit (desktop Safari's engine).
// Regression for "clicking Upload does nothing" on desktop Safari:
//  - the file input is visually hidden but NOT display:none (Safari can ignore label clicks then)
//  - the fabric upload input (#fab-file, opened with click()) is hidden the same way
//  - nothing covers the button; a real mouse click on it opens the file chooser
//  - that click never asks for pointer lock
//  - the upload goes through (POST 200), the new sticker is selected, no page errors
//  - picking the same file again works (the value is reset)
//  - a file with an empty MIME type (by extension) works
//  - no createImageBitmap (Safari < 15) and no Array#at (Safari < 15.4) still work
const pw = require('playwright');
const fs = require('fs');
const sharp = require('sharp');

async function runEngine({ engine, browser, BASE, assert, waitReady, testPng, made, other }) {
  const tag = `[${engine}]`;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    window.__lockCalls = 0;
    const orig = Element.prototype.requestPointerLock;
    Element.prototype.requestPointerLock = function (...a) { window.__lockCalls++; return orig && orig.apply(this, a); };
  });
  const page = await ctx.newPage();
  // A standing file-chooser listener, registered before the page loads: Playwright switches on
  // chooser interception asynchronously, so a listener added right before the click can miss it.
  let pending = null, choosers = 0;
  page.on('filechooser', async (fc) => { choosers++; if (pending) { const f = pending; pending = null; await fc.setFiles(f); } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const posts = [];
  page.on('response', (r) => { if (r.request().method() === 'POST' && /\/api\/stickers$/.test(new URL(r.url()).pathname)) posts.push(r.status()); });
  await page.goto(`${BASE}/?room=e2e-upload`);
  await waitReady(page);

  const css = await page.evaluate(() => {
    const i = document.getElementById('file'), s = getComputedStyle(i);
    const span = document.querySelector('label.upload span'), r = span.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { display: s.display, visibility: s.visibility, hit: !!(hit && hit.closest('label.upload')), x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
  });
  assert(css.display !== 'none' && css.visibility !== 'hidden' && css.hit && css.w > 40,
    `${tag} desktop: the file input is visually hidden but not display:none (${css.display}); nothing covers the Upload button`);
  const fab = await page.evaluate(() => { const i = document.getElementById('fab-file'), s = getComputedStyle(i); return { display: s.display, visibility: s.visibility, inDom: i.isConnected, hidden: i.hidden }; });
  assert(fab.inDom && !fab.hidden && fab.display !== 'none' && fab.visibility !== 'hidden',
    `${tag} the fabric file input is in the DOM and visually hidden the same way (not display:none: ${fab.display})`);

  const upload = async (files) => {
    const n = posts.length, c0 = choosers;
    pending = files;
    await page.mouse.click(css.x, css.y);
    for (let t = 0; t < 200 && (posts.length === n || choosers === c0); t++) await page.waitForTimeout(100);
    if (choosers === c0) return { chooser: false };
    await page.waitForFunction(() => window.klibb.state.selected && /Done/.test(document.getElementById('toast').textContent), null, { timeout: 15000 });
    const id = await page.evaluate(() => window.klibb.state.selected.id);
    made.push(id);
    return { id, chooser: choosers > c0, status: posts.slice(n)[0] };
  };

  const a = await upload(testPng);
  const aImg = await page.evaluate((id) => window.klibb.state.mine.find((m) => m.id === id), a.id);
  const locks = await page.evaluate(() => ({ calls: window.__lockCalls, el: !!document.pointerLockElement }));
  assert(a.chooser && a.status === 200 && !locks.calls && !locks.el && !errors.length,
    `${tag} a real click on "⬆ Upload sticker" opens the file chooser; the upload goes through (POST ${a.status}) and the sticker is selected; no pointer-lock request, no page errors`);
  assert(await page.evaluate(() => document.getElementById('file').value === ''), `${tag} the input is reset after the upload`);
  const b = await upload(testPng);
  assert(b.chooser && b.status === 200 && b.id === a.id,
    `${tag} picking the same file again uploads again`);
  const c = await upload({ name: 'photo.png', mimeType: '', buffer: fs.readFileSync(testPng) });
  assert(c.chooser && c.status === 200, `${tag} a file without a MIME type is accepted by its extension (.png)`);
  await ctx.close();

  // Old Safari: no createImageBitmap, no Array#at. A returning user with stickers loads and uploads.
  const old = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await old.addInitScript((mine) => {
    delete window.createImageBitmap;
    delete Array.prototype.at;
    if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); localStorage.setItem('klibb.mine', JSON.stringify(mine)); }
  }, [aImg]);
  const p2 = await old.newPage();
  p2.on('filechooser', (fc) => fc.setFiles({ name: 'other.png', mimeType: 'image/png', buffer: other }));
  const err2 = []; p2.on('pageerror', (e) => err2.push(e.message));
  await p2.goto(`${BASE}/?room=e2e-upload`);
  await waitReady(p2);
  const loaded = await p2.evaluate(() => window.klibb.state.mine.length);
  let posted = 0;
  p2.on('response', (r) => { if (r.request().method() === 'POST' && /\/api\/stickers$/.test(new URL(r.url()).pathname) && r.status() === 200) posted++; });
  await p2.click('label.upload span');
  await p2.waitForFunction(() => /Done/.test(document.getElementById('toast').textContent), null, { timeout: 15000 });
  const after = await p2.evaluate(() => window.klibb.state.mine.length);
  made.push(await p2.evaluate(() => window.klibb.state.selected && window.klibb.state.selected.id));
  assert(loaded === 1 && after === 2 && posted === 1 && !err2.length, `${tag} without createImageBitmap and Array#at (Safari < 15.4) a returning user still loads and uploads${err2.length ? ': ' + err2[0] : ''}`);
  await old.close();
}

async function uploadE2E({ browser, BASE, assert, waitReady, testPng, TOKEN }) {
  const made = [];
  // A second, different picture (big, so it gets shrunk on the canvas path)
  const other = await sharp({ create: { width: 1600, height: 1200, channels: 4, background: { r: 30, g: 140, b: 220, alpha: 1 } } }).png().toBuffer();
  try {
    await runEngine({ engine: 'chromium', browser, BASE, assert, waitReady, testPng, made, other });
    let webkit;
    try { webkit = await pw.webkit.launch(); } catch (e) {
      if (process.env.REQUIRE_WEBKIT) throw e;
      console.log('⚠ WebKit is not installed (npx playwright install webkit): skipping the Safari run');
    }
    if (webkit) {
      try { await runEngine({ engine: 'webkit', browser: webkit, BASE, assert, waitReady, testPng, made, other }); } finally { await webkit.close(); }
    }
  } finally {
    if (TOKEN) for (const id of made) if (id) await fetch(`${BASE}/api/stickers/${id}`, { method: 'DELETE', headers: { 'x-admin-token': TOKEN } }).catch(() => {});
  }
}

module.exports = { uploadE2E };
