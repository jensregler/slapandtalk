#!/usr/bin/env node
// Make a preset room from a room code (Jens designs rooms with the nature stickers and gives Ulla
// the codes). Opens the room headless as admin, bakes its stickers into six images (floor, ceiling,
// four walls; client/src/preset.js) and saves them with the room's look as a preset
// (POST /api/admin/presets). From then on a new user's first room gets one of the presets at random.
//
//   ADMIN_TOKEN=… node scripts/make-preset.js <room-code> [--base https://slapandtalk.com] [--name "Forest"] [--px 160]
//   ADMIN_TOKEN=… node scripts/make-preset.js --list            (the presets there are)
//   ADMIN_TOKEN=… node scripts/make-preset.js --delete <id>
//   ADMIN_TOKEN=… node scripts/make-preset.js --rename <id or room code> "Skogen"   (the name the start card
//                 shows; --rename <id> "" = back to the room code)
//   ADMIN_TOKEN=… node scripts/make-preset.js --thumb <id or room code | all>   (the picture the start card
//                 shows: a view of the room it was made from, taken headless)
// A new preset gets its picture right away (--no-thumb: not).
//
// CITY presets (t493u; server/citypresets.js) – a snapshot of a whole city (outside + houses 1–8):
//   … make-preset.js --city list                          the city presets (* = the default; stickers per part)
//   … make-preset.js --city save-default                  the build city (stad-byggen) into the default preset NOW
//                                                         (in the build phase this also happens by itself)
//   … make-preset.js --city save --name "Malmö" [--from stad-xxxxxx] [--default]   a NEW named city preset
//   … make-preset.js --city default <id>                  new cities copy this one from now on
//   … make-preset.js --city rename <id> "Name"   |   --city delete <id>
//
// The token is read from the environment (or ADMIN_TOKEN_FILE) and never printed.
const fs = require('fs');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const BASE = (opt('--base', process.env.BASE_URL || 'http://localhost:8080')).replace(/\/$/, '');
const NAME = opt('--name', '');
const PX = Number(opt('--px', '')) || undefined;
const DEL = opt('--delete', null);
const RENAME = opt('--rename', null);
const THUMB = opt('--thumb', null);
const CITY_CMD = opt('--city', null), FROM = opt('--from', null), MAKE_DEFAULT = args.includes('--default') && (args.splice(args.indexOf('--default'), 1), true);
const NO_THUMB = args.includes('--no-thumb') && (args.splice(args.indexOf('--no-thumb'), 1), true);
const LIST = args.includes('--list') && (args.splice(args.indexOf('--list'), 1), true);
const TOKEN = process.env.ADMIN_TOKEN || (process.env.ADMIN_TOKEN_FILE ? fs.readFileSync(process.env.ADMIN_TOKEN_FILE, 'utf8').trim() : '');
if (!TOKEN) { console.error('ADMIN_TOKEN (or ADMIN_TOKEN_FILE) is needed.'); process.exit(2); }
const H = { 'x-admin-token': TOKEN };

const launch = () => require('playwright').chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
// A picture of the preset for the start card's picker, made from the PRESET itself (not its source
// room, which may be gone): a room made from the preset (POST /api/rooms { preset }), first person from
// the south wall looking north (a bit down, so the floor shows too), no UI → POST /api/admin/presets/:id/thumb.
// The room is an ordinary empty room afterwards and the empty-room cleanup takes it within seconds.
async function thumbOf(browser, p) {
  const mk = await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: p.id, name: 'preset picture' }) });
  const room = (await mk.json().catch(() => ({}))).room; if (!mk.ok || !room) throw new Error(`thumb ${p.id}: could not open a room from it (${mk.status})`);
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
  try {
    const P = await ctx.newPage();
    await P.goto(`${BASE}/?room=${room.id}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.presetLayer && window.klibb.presetLayer().loaded >= 6, null, { timeout: 60000 });
    await P.evaluate(() => { const k = window.klibb; k.setView?.('first', { quiet: true }); k.moveTo(0, 4.4); k.look(0, -0.12); });
    await P.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; } dialog { display: none !important; }' });
    await P.waitForTimeout(2500);
    const png = await P.screenshot({ type: 'png' });
    const fd = new FormData(); fd.append('thumb', new Blob([png], { type: 'image/png' }), 'thumb.png');
    const r = await fetch(`${BASE}/api/admin/presets/${p.id}/thumb`, { method: 'POST', headers: H, body: fd });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`thumb ${p.id}: ${j.error || r.status}`);
    console.log(`picture for ${p.id} (${j.preset.title || j.preset.sourceRoom}): ${BASE}${j.preset.thumb}`);
  } finally { await ctx.close(); }
}
const allPresets = async () => { const r = await fetch(`${BASE}/api/admin/presets`, { headers: H }); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j.presets; };

(async () => {
  if (CITY_CMD) {
    const J = { ...H, 'Content-Type': 'application/json' }, call = async (m, u, b) => { const r = await fetch(BASE + u, { method: m, headers: J, ...(b ? { body: JSON.stringify(b) } : {}) }); const j = await r.json().catch(() => ({})); if (!r.ok) { console.error(j.error || r.status); process.exit(1); } return j; };
    const show = (p) => console.log(`${p.default ? '*' : ' '} ${p.id}  "${p.name}"  from ${p.source || '-'}  updated ${p.updatedAt}  stickers ${Object.entries(p.stickers || {}).map(([k, v]) => `${k === 'outside' ? 'outside' : 'house ' + k}: ${v}`).join(', ') || '-'}`);
    if (CITY_CMD === 'list') { const j = await call('GET', '/api/admin/citypresets'); console.log(`build city: ${BASE}/?room=${j.buildCity}  (build phase ${j.buildPhase ? 'on: it saves into the default by itself' : 'off'})`); j.presets.forEach(show); if (!j.presets.length) console.log('(no city presets yet)'); return; }
    if (CITY_CMD === 'save-default') { show((await call('POST', '/api/admin/citypresets/save-default')).preset); return; }
    if (CITY_CMD === 'save') { show((await call('POST', '/api/admin/citypresets', { name: NAME, ...(FROM ? { from: FROM } : {}), default: MAKE_DEFAULT })).preset); return; }
    const id = args[0];
    if (!id) { console.error('usage: --city list | save-default | save --name N [--from city] [--default] | default <id> | rename <id> "Name" | delete <id>'); process.exit(2); }
    if (CITY_CMD === 'default') { show((await call('PATCH', `/api/admin/citypresets/${id}`, { default: true })).preset); return; }
    if (CITY_CMD === 'rename') { show((await call('PATCH', `/api/admin/citypresets/${id}`, { name: args[1] || '' })).preset); return; }
    if (CITY_CMD === 'delete') { console.log((await call('DELETE', `/api/admin/citypresets/${id}`)).ok ? 'deleted' : 'not found'); return; }
    console.error(`unknown --city ${CITY_CMD}`); process.exit(2);
  }
  if (RENAME != null) {
    const title = args[0] ?? '';
    const r = await fetch(`${BASE}/api/admin/presets/${encodeURIComponent(RENAME)}`, { method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) { console.error(j.error || r.status); process.exit(1); }
    console.log(`${j.preset.id} (room ${j.preset.sourceRoom}) is now shown as: ${j.preset.title || j.preset.sourceRoom + ' (the room code)'}`);
    return;
  }
  if (THUMB) {
    const all = await allPresets(), k = THUMB.toLowerCase();
    const pick = k === 'all' ? all : all.filter((p) => p.id === k || p.sourceRoom === k);
    if (!pick.length) { console.error(`no preset ${THUMB}`); process.exit(1); }
    const browser = await launch();
    try { for (const p of pick) await thumbOf(browser, p); } finally { await browser.close(); }
    return;
  }
  if (LIST || DEL) {
    const r = DEL ? await fetch(`${BASE}/api/admin/presets/${DEL}`, { method: 'DELETE', headers: H }) : await fetch(`${BASE}/api/admin/presets`, { headers: H });
    const j = await r.json(); if (!r.ok) { console.error(j.error || r.status); process.exit(1); }
    if (DEL) console.log(j.ok ? `deleted ${DEL}` : `no preset ${DEL}`);
    else for (const p of j.presets) console.log(`${p.id}  ${p.title ? '"' + p.title + '"' : '(no name: shown as ' + p.sourceRoom + ')'}  from room ${p.sourceRoom}  ${p.thumb ? 'picture ✓' : 'no picture'}  ${p.createdAt}`);
    return;
  }
  const code = String(args[0] || '').toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(code)) { console.error('usage: make-preset.js <room-code> [--base URL] [--name NAME] [--px 160]'); process.exit(2); }
  const info = await (await fetch(`${BASE}/api/rooms/${code}/stamps`)).json().catch(() => null);
  const want = info && Array.isArray(info.stamps) ? info.stamps.length : null;
  if (!info || !info.info) { console.error(`room ${code}: not found`); process.exit(1); }
  const browser = await launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript((t) => sessionStorage.setItem('klibb.admin', t), TOKEN); // (not in the address, not in any log)
    const P = await ctx.newPage();
    await P.goto(`${BASE}/?room=${code}`);
    await P.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.state.adminToken, null, { timeout: 60000 });
    // every sticker loaded (the meshes map has live and painted-in ones), then calm for a moment
    await P.waitForFunction((n) => window.klibb.stamps.meshes.size >= (n || 0), want, { timeout: 120000 });
    await P.waitForTimeout(2500);
    const p = await P.evaluate(([name, px]) => window.klibb.savePreset({ name, title: name, ...(px ? { pxPerM: px } : {}) }), [NAME, PX]);
    console.log(`preset ${p.id} from room ${code}: ${p.stickers} stickers baked into 6 images (${p.px} px max side)`);
    for (const [f, u] of Object.entries(p.faces)) console.log(`  ${f.padEnd(7)} ${BASE}${u}`);
    if (NAME) console.log(`  shown on the start card as: ${p.title || NAME}`);
    if (!NO_THUMB) await thumbOf(browser, { id: p.id }).catch((e) => console.error(e.message));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
