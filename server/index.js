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
const { makeEntitlements } = require('./entitlements');
const { createLicenses } = require('./licenses');
const { safeStep, checkStorage, installProcessGuards } = require('./startup');
const { demoSettings, createDemo } = require('./demo');
const { loadLibrary, seedLibrary } = require('./library');

installProcessGuards();

const PORT = Number(process.env.PORT || 8787);
const QUICK_TTL_HOURS = Number(process.env.QUICK_ROOM_TTL_HOURS || 24);
const CLEANUP_MINUTES = Number(process.env.ROOM_CLEANUP_INTERVAL_MINUTES || 60);
// The Thursday demo (free version): DEMO_PROFILE=1. See server/demo.js and README "Demo profile".
const DEMO = demoSettings(process.env);
const MAX_PLAYERS = DEMO ? DEMO.maxPlayers : Number(process.env.MAX_PLAYERS_PER_ROOM || 10);
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
const demo = DEMO ? createDemo({ store, settings: DEMO, onExpire: (id) => { if (realtime) realtime.closeRoom(id, { type: 'room:closed' }); } }) : null;
const library = loadLibrary();
const app = createApp(store, { adminToken: process.env.ADMIN_TOKEN || '', quickTtlHours: QUICK_TTL_HOURS, recorder, entitle, demo, library });
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

// Städjobbet: tar bort snabbrum som stått tomma längre än QUICK_ROOM_TTL_HOURS.
async function cleanup() {
  try {
    const deleted = await store.cleanupRooms({ quickTtlMs: QUICK_TTL_HOURS * 3600_000 });
    if (deleted.length) console.log(`Städning: tog bort ${deleted.length} tomma snabbrum (${deleted.join(', ')})`);
    const oldVideos = await app.locals.videos.cleanup().catch((e) => { console.error("Videostädningen misslyckades:", e.message); return []; }); // videos/ has its own retention (VIDEO_RETENTION_DAYS)
    if (oldVideos.length) console.log(`Städning: tog bort ${oldVideos.length} gamla videor`);
    store.evictIdle(2 * 3600_000); // rum ingen använt på 2 h släpps ur minnet (de finns kvar i lagringen)
  } catch (e) { console.error('Städningen misslyckades:', e.message); }
}

(async () => {
  await checkStorage(adapter);
  const n = await safeStep('Flytt av images.json', () => store.migrate(), { fallback: 0 });
  if (n) console.log(`Flyttade ${n} bilder från images.json till images/`);
  await safeStep('Sticker library', () => seedLibrary(store, library), { fallback: null });
})().catch((e) => console.error('[start] Oväntat fel före start:', e)).finally(() => {
  const server = app.listen(PORT, () => console.log(`Slap and Talk kör på http://localhost:${PORT} (lagring: ${adapter.kind}, max ${MAX_PLAYERS} per rum${DEMO ? ', DEMO' : ''})`));
  // Flerspelarläget (WebSocket på /ws) går på samma port som webbappen.
  realtime = attachRealtime(server, { maxPlayers: MAX_PLAYERS, recorder, entitle, gate });
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
      flushStore().finally(() => process.exit(0));
    });
  };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  cleanup();
  setInterval(cleanup, CLEANUP_MINUTES * 60_000).unref();
});
