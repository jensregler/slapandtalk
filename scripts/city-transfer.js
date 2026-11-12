#!/usr/bin/env node
// Move a city between servers from the command line (the same city file as Esc → CITY → Export / Import city;
// server/cityarchive.js). The admin key is read from a file and never printed.
//   node scripts/city-transfer.js export --server http://localhost:8790 --city stad-byggen [--out city.satcity]
//   node scripts/city-transfer.js import --server https://slapandtalk.com --file city.satcity [--target same|new|stad-xxxxxx]
//   node scripts/city-transfer.js plan   --server https://slapandtalk.com --city stad-byggen
// Key: --token-file <file>, or env ADMIN_TOKEN_FILE, or env ADMIN_TOKEN; for a localhost server the local key
// in data-local/local-admin-token.txt (or DATA_DIR) is used by itself.
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const [cmd, ...rest] = process.argv.slice(2);
const opt = (f, d) => { const i = rest.indexOf(f); return i >= 0 && rest[i + 1] ? rest[i + 1] : d; };
const server = String(opt('--server', 'http://localhost:8790')).replace(/\/+$/, '');
function token() {
  const file = opt('--token-file', process.env.ADMIN_TOKEN_FILE || '');
  if (file) return fs.readFileSync(file, 'utf8').trim();
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN.trim();
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(server)) {
    const f = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data-local'), 'local-admin-token.txt');
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  }
  throw new Error('No admin key: use --token-file <file> (or ADMIN_TOKEN_FILE)');
}
const fail = async (r) => { const d = await r.json().catch(() => ({})); throw new Error(`${r.status} ${d.error || r.statusText}`); };

(async () => {
  if (cmd === 'plan' || cmd === 'export') {
    const city = opt('--city', 'stad-byggen');
    const r = await fetch(`${server}/api/admin/cities/${encodeURIComponent(city)}/export${cmd === 'plan' ? '?plan=1' : ''}`, { headers: { 'x-admin-token': token() } });
    if (!r.ok) await fail(r);
    if (cmd === 'plan') { console.log(JSON.stringify(await r.json(), null, 1)); return; }
    const name = (/filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '') || [])[1] || `${city}.satcity`;
    const out = path.resolve(opt('--out', name));
    await new Promise((ok, no) => { const w = fs.createWriteStream(out); Readable.fromWeb(r.body).pipe(w).on('finish', ok).on('error', no); });
    console.log(`exported ${city} → ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
  } else if (cmd === 'import') {
    const file = opt('--file'); if (!file) throw new Error('--file <city.satcity>');
    const target = opt('--target', 'same');
    const size = fs.statSync(file).size;
    const r = await fetch(`${server}/api/admin/cities/import?target=${encodeURIComponent(target)}`, {
      method: 'POST', headers: { 'x-admin-token': token(), 'Content-Type': 'application/gzip', 'Content-Length': String(size) },
      body: Readable.toWeb(fs.createReadStream(file)), duplex: 'half',
    });
    if (!r.ok) await fail(r);
    console.log(JSON.stringify(await r.json(), null, 1));
  } else {
    console.log('usage: node scripts/city-transfer.js export|import|plan --server <url> [--city id] [--file f] [--target same|new|id] [--token-file f]');
    process.exit(2);
  }
})().catch((e) => { console.error('city-transfer:', e.message); process.exit(1); });
