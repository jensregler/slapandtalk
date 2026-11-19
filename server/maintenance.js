// "Under construction" (Jens t981u + t982u, 19 Nov 2026): while Jens works on his own PC (start-local), the public
// site shows one big black page instead of the game. ONLY the HTML pages are swapped; the game's code, the
// API, the websocket, city data, autosave and every stored file keep running untouched behind it.
//   - On:  MAINTENANCE_DEFAULT below (true), or env MAINTENANCE=1.
//   - Off: revert the commit that added this file, or set env MAINTENANCE=0 on Render (no code change).
//   - Peek behind it: open /?preview=1 once (sets a cookie for this browser); /?preview=0 clears it.
//   - Only on Render (Render sets RENDER=true by itself): Jens's PC (start-local), tests and dev never see it.
const MAINTENANCE_DEFAULT = true;

const on = () => {
  const v = process.env.MAINTENANCE;
  if (v != null && v !== '') return !/^(0|false|off|no)$/i.test(v);
  if (process.env.LOCAL_MODE === '1' || !process.env.RENDER) return false;
  return MAINTENANCE_DEFAULT;
};

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Slap and Talk – under construction</title><meta name="robots" content="noindex">
<link rel="icon" href="/icons/icon-192.png">
<style>
  html,body{margin:0;height:100%;background:#000;color:#fff;font-family:Arial Black,Arial,Helvetica,sans-serif}
  main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:6vh 6vw;box-sizing:border-box;gap:4vh}
  img{width:min(56vw,46vh);height:auto;border-radius:12%}
  h1{margin:0;font-size:clamp(34px,8vw,96px);line-height:1.05;letter-spacing:.02em;color:#ffd400}
  p{margin:0;font-size:clamp(26px,5.5vw,64px);line-height:1.15;font-weight:900}
</style></head>
<body><main>
  <img src="/icons/icon-512.png" alt="Slap and Talk logo">
  <h1>SLAP AND TALK</h1>
  <p id="uc">Under construction – back soon</p>
</main></body></html>`;

const cookieOn = (req) => /(?:^|;\s*)sat_preview=1(?:;|$)/.test(req.headers.cookie || '');
// an HTML page request: '/', '/index.html', or a path without a file extension (the app's own routes), not the API
const isPage = (p) => p === '/' || p === '/index.html' || (!/^\/(api|uploads|ws)(\/|$)/.test(p) && !/\.[a-z0-9]{1,8}$/i.test(p));

function maintenance(req, res, next) {
  if (!on() || (req.method !== 'GET' && req.method !== 'HEAD') || !isPage(req.path)) return next();
  const q = req.query && req.query.preview;
  if (q === '1') { res.setHeader('Set-Cookie', 'sat_preview=1; Path=/; Max-Age=2592000; SameSite=Lax'); return next(); }
  if (q === '0') res.setHeader('Set-Cookie', 'sat_preview=; Path=/; Max-Age=0; SameSite=Lax');
  else if (cookieOn(req)) return next();
  res.status(200).setHeader('Cache-Control', 'no-store');
  res.type('html').send(PAGE);
}

module.exports = { maintenance, maintenanceOn: on, MAINTENANCE_PAGE: PAGE };
