#!/usr/bin/env node
// Run Slap and Talk fully on this computer (Jens's PC – t864u, 12 Nov 2026): the server + the built web app on
// http://localhost:8790, its own data folder (data-local/), nothing goes to the live server. Build textures and
// assets here with your own graphics card, then Esc → CITY → Export city, and Import city on the live server.
//   node scripts/start-local.js [--build] [--no-open] [--port 8790] [--front]
//     --build    build the web app first (start-local.bat always does)
//     --no-open  do not open the browser
//     --front    open the front page instead of the build city
// Env: LOCAL_PORT, DATA_DIR (default <repo>/data-local). Admin key: made once in DATA_DIR/local-admin-token.txt.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const PORT = Number(opt('--port', process.env.LOCAL_PORT || 8790));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data-local'));
const BUILD_CITY = 'stad-byggen';
const win = process.platform === 'win32';

if (flag('--build') || !fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  console.log('Building the web app (vite build)…');
  const b = spawnSync(win ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: win });
  if (b.status !== 0) { console.error('The build failed – see above.'); process.exit(1); }
}
fs.mkdirSync(DATA_DIR, { recursive: true });
const env = { ...process.env, LOCAL_MODE: '1', STORAGE: 'local', DATA_DIR, PORT: String(PORT), HOST: '127.0.0.1' };
delete env.ADMIN_TOKEN; // never the production key here: the local one is made in DATA_DIR
const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { cwd: ROOT, env, stdio: 'inherit' });
server.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig));

const url = `http://localhost:${PORT}/${flag('--front') ? '' : `?room=${BUILD_CITY}`}`;
async function waitUp() {
  for (let k = 0; k < 120; k++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/config`); if (r.ok) return true; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
waitUp().then((up) => {
  if (!up) { console.error('The server did not start – see above.'); return; }
  console.log('\n  Slap and Talk runs on THIS computer:');
  console.log(`    ${url}`);
  console.log(`    data folder: ${DATA_DIR}`);
  console.log('  Close this window (or press Ctrl+C) to stop it.\n');
  if (flag('--no-open')) return;
  const open = win ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(open[0], open[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* open it by hand */ }
});
