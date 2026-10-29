#!/usr/bin/env node
// Make a preset room from a room code (Jens designs rooms with the nature stickers and gives Ulla
// the codes). Opens the room headless as admin, bakes its stickers into six images (floor, ceiling,
// four walls; client/src/preset.js) and saves them with the room's look as a preset
// (POST /api/admin/presets). From then on a new user's first room gets one of the presets at random.
//
//   ADMIN_TOKEN=… node scripts/make-preset.js <room-code> [--base https://slapandtalk.com] [--name "Forest"] [--px 160]
//   ADMIN_TOKEN=… node scripts/make-preset.js --list            (the presets there are)
//   ADMIN_TOKEN=… node scripts/make-preset.js --delete <id>
//
// The token is read from the environment (or ADMIN_TOKEN_FILE) and never printed.
const fs = require('fs');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const BASE = (opt('--base', process.env.BASE_URL || 'http://localhost:8080')).replace(/\/$/, '');
const NAME = opt('--name', '');
const PX = Number(opt('--px', '')) || undefined;
const DEL = opt('--delete', null);
const LIST = args.includes('--list') && (args.splice(args.indexOf('--list'), 1), true);
const TOKEN = process.env.ADMIN_TOKEN || (process.env.ADMIN_TOKEN_FILE ? fs.readFileSync(process.env.ADMIN_TOKEN_FILE, 'utf8').trim() : '');
if (!TOKEN) { console.error('ADMIN_TOKEN (or ADMIN_TOKEN_FILE) is needed.'); process.exit(2); }
const H = { 'x-admin-token': TOKEN };

(async () => {
  if (LIST || DEL) {
    const r = DEL ? await fetch(`${BASE}/api/admin/presets/${DEL}`, { method: 'DELETE', headers: H }) : await fetch(`${BASE}/api/admin/presets`, { headers: H });
    const j = await r.json(); if (!r.ok) { console.error(j.error || r.status); process.exit(1); }
    if (DEL) console.log(j.ok ? `deleted ${DEL}` : `no preset ${DEL}`);
    else for (const p of j.presets) console.log(`${p.id}  ${p.name || '-'}  from ${p.sourceRoom}  ${p.createdAt}`);
    return;
  }
  const code = String(args[0] || '').toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(code)) { console.error('usage: make-preset.js <room-code> [--base URL] [--name NAME] [--px 160]'); process.exit(2); }
  const info = await (await fetch(`${BASE}/api/rooms/${code}/stamps`)).json().catch(() => null);
  const want = info && Array.isArray(info.stamps) ? info.stamps.length : null;
  if (!info || !info.info) { console.error(`room ${code}: not found`); process.exit(1); }
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript((t) => sessionStorage.setItem('klibb.admin', t), TOKEN); // (not in the address, not in any log)
    const P = await ctx.newPage();
    await P.goto(`${BASE}/?room=${code}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.adminToken, null, { timeout: 60000 });
    // every sticker loaded (the meshes map has live and painted-in ones), then calm for a moment
    await P.waitForFunction((n) => window.klibb.stamps.meshes.size >= (n || 0), want, { timeout: 120000 });
    await P.waitForTimeout(2500);
    const p = await P.evaluate(([name, px]) => window.klibb.savePreset({ name, ...(px ? { pxPerM: px } : {}) }), [NAME || code, PX]);
    console.log(`preset ${p.id} from room ${code}: ${p.stickers} stickers baked into 6 images (${p.px} px max side)`);
    for (const [f, u] of Object.entries(p.faces)) console.log(`  ${f.padEnd(7)} ${BASE}${u}`);
  } finally { await browser.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
