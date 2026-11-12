// Slap and Talk – servern.
// Den gör tre saker: 1) tar emot och sparar uppladdade klistermärken,
// 2) sparar och lämnar ut stämplar per rum, 3) serverar själva webbappen.
// Logiken finns i app.js (rutterna), store.js (rum/bilder) och storage/ (var det sparas).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const { createAdapter } = require('./storage');
const { createStore } = require('./store');
const { createApp } = require('./app');
const { attachRealtime } = require('./realtime');
const { createRecorder } = require('./recorder');
const { makeEntitlements, maxPlayersFor } = require('./entitlements');
const { createLicenses } = require('./licenses');
const { safeStep, checkStorage, installProcessGuards } = require('./startup');
const { demoSettings, createDemo } = require('./demo');
const { loadLibrary, seedLibrary } = require('./library');
const { createEmptyRoomReaper } = require('./emptyrooms');

installProcessGuards();

const PORT = Number(process.env.PORT || 8787);
const QUICK_TTL_HOURS = Number(process.env.QUICK_ROOM_TTL_HOURS || 24);
const CLEANUP_MINUTES = Number(process.env.ROOM_CLEANUP_INTERVAL_MINUTES || 60);
// The Thursday demo (free version): DEMO_PROFILE=1. See server/demo.js and README "Demo profile".
const DEMO = demoSettings(process.env);
// The free version's room limit (FREE_MAX_PLAYERS = 4); MAX_PLAYERS_PER_ROOM may only lower it.
const MAX_PLAYERS = DEMO ? DEMO.maxPlayers : maxPlayersFor(process.env);
// Sessionsinspelning: max längd (minuter) och storlek (MB) per inspelning, och hur många samtidigt.
const REC_MAX_MINUTES = Number(process.env.REC_MAX_MINUTES || 120);
const REC_MAX_MB = Number(process.env.REC_MAX_MB || 32);
const REC_MAX_ACTIVE = Number(process.env.REC_MAX_ACTIVE || 4);

const adapter = createAdapter();
const store = createStore(adapter);
const recorder = createRecorder(store, { maxMs: REC_MAX_MINUTES * 60_000, maxBytes: REC_MAX_MB * 1024 * 1024, maxActive: REC_MAX_ACTIVE });
// Full version: manual FULL_ACCESS_KEYS + paid Lemon Squeezy keys (LS_STORE_ID + LS_PRODUCT_ID set).
const licenses = createLicenses({ adapter, env: process.env });
const entitle = makeEntitlements(process.env, { licenses: licenses.enabled ? licenses : null });
if (licenses.enabled) console.log('Full version: Lemon Squeezy keys on' + (process.env.LS_WEBHOOK_SECRET ? ' (webhook on)' : ' (no LS_WEBHOOK_SECRET: webhook off)'));
let realtime = null; // set when the server listens
const demo = DEMO ? createDemo({ store, settings: DEMO, onExpire: async (id) => { if (realtime) realtime.closeRoom(id, { type: 'room:closed' }); await recorder.stop(id, 'closed').catch(() => null); } }) : null;
const library = loadLibrary();
// Local mode (Jens's own PC – scripts/start-local.js / start-local.bat, README "Run the city on your own PC"):
// LOCAL_MODE=1 → listens on this computer only (127.0.0.1), keeps empty cities (nobody else comes by), and –
// when no ADMIN_TOKEN is set – makes its own admin token once in DATA_DIR (local-admin-token.txt), so the
// Esc menu's Export / Import city work here without the production key.
const LOCAL = /^(1|true|on|yes)$/i.test(String(process.env.LOCAL_MODE || ''));
function localAdminToken() {
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN;
  const fs = require('fs'), path = require('path'), crypto = require('crypto');
  const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const file = path.join(dir, 'local-admin-token.txt');
  try { const t = fs.readFileSync(file, 'utf8').trim(); if (t.length >= 32) return t; } catch { /* first start */ }
  const t = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, t + '\n', { mode: 0o600 });
  return t;
}
const ADMIN = LOCAL ? localAdminToken() : (process.env.ADMIN_TOKEN || '');
if (LOCAL && process.env.EMPTY_ROOM_DELETE == null) process.env.EMPTY_ROOM_DELETE = '0';
const app = createApp(store, { adminToken: ADMIN, local: LOCAL ? { token: ADMIN } : null, quickTtlHours: QUICK_TTL_HOURS, recorder, entitle, demo, library });
// Invites over the WebSocket (demo): { t: 'invite', action: 'create' | 'status' } → { t: 'invite', ok, token?, status }
const gate = demo ? {
  admit: (room, pass, name) => demo.admit(room, pass, name),
  async onMessage(c, m, { send }) {
    if (m.action === 'create') {
      const r = await demo.createInvite(c.room, c.member);
      return send(r.token ? { t: 'invite', ok: true, token: r.token, status: r.status } : { t: 'invite', ok: false, code: r.code, error: r.error, ...(r.name ? { name: r.name } : {}) });
    }
    send({ t: 'invite', ok: true, status: await demo.inviteStatus(c.room, c.member) });
  },
} : null;

// The rooms Jens's presets were made from: never deleted, not by the 24 h cleanup, not when empty. (The
// presets do not need them – each carries its own six baked images and look – but Jens may go on
// designing in them.) If the preset list cannot be read, nothing is deleted this round.
async function presetSourceRooms() { return new Set((await app.locals.presets.list()).map((p) => p.sourceRoom).filter(Boolean)); }
// Städjobbet: tar bort snabbrum som stått tomma längre än QUICK_ROOM_TTL_HOURS.
async function cleanup() {
  try {
    const deleted = await store.cleanupRooms({ quickTtlMs: QUICK_TTL_HOURS * 3600_000, keep: await presetSourceRooms() });
    if (deleted.length) console.log(`Städning: tog bort ${deleted.length} tomma snabbrum (${deleted.join(', ')})`);
    const oldVideos = await app.locals.videos.cleanup().catch((e) => { console.error("Videostädningen misslyckades:", e.message); return []; }); // videos/ has its own retention (VIDEO_RETENTION_DAYS)
    if (oldVideos.length) console.log(`Städning: tog bort ${oldVideos.length} gamla videor`);
    const oldPhotos = await app.locals.photos.cleanup().catch((e) => { console.error('Fotostädningen misslyckades:', e.message); return []; }); // photos/ too (PHOTO_RETENTION_DAYS)
    if (oldPhotos.length) console.log(`Städning: tog bort ${oldPhotos.length} gamla foton`);
    store.evictIdle(2 * 3600_000); // rum ingen använt på 2 h släpps ur minnet (de finns kvar i lagringen)
  } catch (e) { console.error('Städningen misslyckades:', e.message); }
}

(async () => {
  await checkStorage(adapter);
  const n = await safeStep('Flytt av images.json', () => store.migrate(), { fallback: 0 });
  if (n) console.log(`Flyttade ${n} bilder från images.json till images/`);
  await safeStep('Sticker library', () => seedLibrary(store, library), { fallback: null });
})().catch((e) => console.error('[start] Oväntat fel före start:', e)).finally(() => {
  const HOST = process.env.HOST || (LOCAL ? '127.0.0.1' : undefined);
  const server = app.listen(PORT, HOST, () => console.log(`Slap and Talk kör på http://localhost:${PORT} (lagring: ${adapter.kind}${adapter.dir ? ' ' + adapter.dir : ''}, max ${MAX_PLAYERS} per rum${DEMO ? ', DEMO' : ''}${LOCAL ? ', LOCAL MODE' : ''})`));
  // Flerspelarläget (WebSocket på /ws) går på samma port som webbappen.
  // Empty rooms are deleted after EMPTY_ROOM_GRACE_SECONDS (10); presets' source rooms and the City stay. EMPTY_ROOM_DELETE=0: off.
  // Plus a sweep of every empty room: at startup (after the grace period + 5 s, so people reconnecting after the restart keep theirs)
  // and every EMPTY_ROOM_SWEEP_MINUTES (5).
  const reaper = process.env.EMPTY_ROOM_DELETE === '0' || DEMO ? null : createEmptyRoomReaper({
    store, isOccupied: (id) => !!realtime && realtime.occupied(id), graceMs: Number(process.env.EMPTY_ROOM_GRACE_SECONDS || 10) * 1000,
    ...(process.env.EMPTY_CITY_GRACE_SECONDS ? { cityGraceMs: Number(process.env.EMPTY_CITY_GRACE_SECONDS) * 1000 } : {}), // a city as one (default 30 s)
    keepIds: presetSourceRooms,
  });
  realtime = attachRealtime(server, { maxPlayers: MAX_PLAYERS, recorder, entitle, gate, onEmpty: reaper && reaper.empty, onJoin: reaper && reaper.joined });
  if (app.locals.cityBus) {
    app.locals.cityBus.setLive(realtime);
    // Re-seed presence once live is up (startup seed may have run before attachRealtime).
    if (process.env.CITYBUS_TEST === '1' || process.env.CITYBUS_TEST === 'true') {
      app.locals.cityBus.seed().catch((e) => console.error('[citybus] live seed failed', e && e.message));
    }
  }
  if (reaper) {
    const sweep = () => reaper.sweep().then((d) => { if (d.length) console.log(`[rooms] sweep: deleted ${d.length} empty room(s) (${d.join(', ')})`); }).catch((e) => console.error('[rooms] sweep failed:', e.message));
    setTimeout(sweep, Number(process.env.EMPTY_ROOM_GRACE_SECONDS || 10) * 1000 + 5000).unref();
    setInterval(sweep, Number(process.env.EMPTY_ROOM_SWEEP_MINUTES || 5) * 60_000).unref();
  }
  if (demo) { demo.start(); console.log(`[demo] DEMO_PROFILE on: free version, ${DEMO.maxPlayers} per room, invite-only, rooms close after ${DEMO.roomMs / 60_000} min`); }
  // Vid omstart (pm2, Render): säg till alla anslutna att servern startar om, så kopplar
  // deras webbläsare upp sig igen av sig själva när den nya servern är igång.
  // Pågående inspelningar avslutas och sparas först (stoppskäl "shutdown").
  // Rummen skrivs till lagringen i bakgrunden: skriv ut allt som väntar innan vi stänger.
  const flushStore = () => store.flush().then(({ written, failed }) => {
    if (written || failed) console.log(`[lagring] Sparade ${written} rum vid avstängning${failed ? `, ${failed} misslyckades` : ''}`);
  }).catch((e) => console.error('[lagring] Kunde inte spara vid avstängning:', e.message));
  const stop = () => {
    setTimeout(() => process.exit(0), 15_000).unref();
    recorder.close().catch(() => {}).finally(() => {
      realtime.close();
      server.close();
      // the build city's last changes into the default city preset (t493u), then the rooms
      app.locals.cityPresets.flush().catch((e) => console.error('[citypresets] could not save at shutdown:', e.message)).finally(() => flushStore().finally(() => process.exit(0)));
    });
  };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  cleanup();
  setInterval(cleanup, CLEANUP_MINUTES * 60_000).unref();
});
