// Mät hur tungt ett fullt rum är att rita: ritanrop per bildruta och bildrutetid.
//   node tools/bench-stamps.js seed <stamps.json> <DATA_DIR> [rum]   (stamps.json = GET /api/rooms/stad/stamps)
//   node tools/bench-stamps.js measure <BASE_URL> [rum] [sekunder]
// Ritanropen räknas på WebGL-nivå (drawElements/drawArrays mellan två bildrutor), så samma
// mätning fungerar på både gamla och nya byggen.
const fs = require('fs');
const path = require('path');

async function seed(file, dir, room = 'bench') {
  const src = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const d of ['rooms', 'images', 'uploads']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  for (const img of Object.values(src.images)) {
    const to = path.join(dir, 'uploads', `${img.id}.webp`);
    if (!fs.existsSync(to)) {
      const r = await fetch(new URL(img.url, process.env.SOURCE || 'https://slapandtalk.com'));
      if (!r.ok) { console.log('saknas:', img.id, r.status); continue; }
      fs.writeFileSync(to, Buffer.from(await r.arrayBuffer()));
    }
    fs.writeFileSync(path.join(dir, 'images', `${img.id}.json`), JSON.stringify(img));
  }
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(dir, 'rooms', `${room}.json`), JSON.stringify({
    id: room, type: 'quick', owner: null, createdAt: now, lastVisitAt: now, style: src.info?.style || null, cameras: [],
    stamps: src.stamps,
  }));
  console.log(`rum ${room}: ${src.stamps.length} klibbor, ${Object.keys(src.images).length} designer`);
}

async function measure(base, room = 'bench', secs = 5) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: Number(process.env.W || 1280), height: Number(process.env.H || 800) } });
    await page.addInitScript(() => {
      const w = window.__bench = { draws: 0, perFrame: [], cb: [], dt: [], last: 0, on: false };
      for (const P of [WebGL2RenderingContext.prototype, WebGLRenderingContext.prototype]) {
        for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) {
          const o = P[fn]; if (!o) continue;
          P[fn] = function (...a) { w.draws++; return o.apply(this, a); };
        }
      }
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (f) => raf((t) => {
        if (w.on) { w.perFrame.push(w.draws); if (w.last) w.dt.push(t - w.last); }
        w.draws = 0; w.last = t;
        const t0 = performance.now(); f(t); if (w.on) w.cb.push(performance.now() - t0);
      });
    });
    await page.goto(`${base}/?room=${room}`);
    await page.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
    const want = await page.evaluate(async (room) => (await (await fetch(`/api/rooms/${room}/stamps`)).json()).stamps.length, room);
    await page.waitForFunction((n) => window.klibb.stamps.count >= n, want, { timeout: 120000 });
    await page.waitForTimeout(4500); // inmålningen (nya bygget) hinner bli klar
    await page.evaluate(() => { window.klibb.moveTo(0, 3); window.klibb.look(0, 0.05); });
    await page.waitForTimeout(800);
    const out = await page.evaluate(async (ms) => {
      const w = window.__bench; w.perFrame = []; w.cb = []; w.dt = []; w.on = true;
      await new Promise((r) => setTimeout(r, ms));
      w.on = false;
      const avg = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
      const k = window.klibb;
      return { stamps: k.stamps.count, frames: w.dt.length, drawsPerFrame: Math.round(avg(w.perFrame)), frameMs: +avg(w.dt).toFixed(1), rafCallbackMs: +avg(w.cb).toFixed(2),
        rendererCalls: k.renderer ? k.renderer.info.render.calls : null, stats: k.stamps.stats ? k.stamps.stats() : null };
    }, secs * 1000);
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
    console.log(JSON.stringify(out));
  } finally { await browser.close(); }
}

const [cmd, ...a] = process.argv.slice(2);
(cmd === 'seed' ? seed(...a) : measure(a[0], a[1], Number(a[2] || 5))).catch((e) => { console.error(e); process.exit(1); });
