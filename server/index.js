// Slap and Talk – servern.
// Den gör tre saker: 1) tar emot och sparar uppladdade klistermärken,
// 2) sparar och lämnar ut stämplar per rum, 3) serverar själva webbappen.
// Logiken finns i app.js (rutterna), store.js (rum/bilder) och storage/ (var det sparas).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const { createAdapter } = require('./storage');
const { createStore } = require('./store');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT || 8787);
const QUICK_TTL_HOURS = Number(process.env.QUICK_ROOM_TTL_HOURS || 24);
const CLEANUP_MINUTES = Number(process.env.ROOM_CLEANUP_INTERVAL_MINUTES || 60);

const adapter = createAdapter();
const store = createStore(adapter);
const app = createApp(store, { adminToken: process.env.ADMIN_TOKEN || '', quickTtlHours: QUICK_TTL_HOURS });

// Städjobbet: tar bort snabbrum som stått tomma längre än QUICK_ROOM_TTL_HOURS.
async function cleanup() {
  try {
    const deleted = await store.cleanupRooms({ quickTtlMs: QUICK_TTL_HOURS * 3600_000 });
    if (deleted.length) console.log(`Städning: tog bort ${deleted.length} tomma snabbrum (${deleted.join(', ')})`);
  } catch (e) { console.error('Städningen misslyckades:', e.message); }
}

store.migrate().then((n) => { if (n) console.log(`Flyttade ${n} bilder från images.json till images/`); }).finally(() => {
  app.listen(PORT, () => console.log(`Slap and Talk kör på http://localhost:${PORT} (lagring: ${adapter.kind})`));
  cleanup();
  setInterval(cleanup, CLEANUP_MINUTES * 60_000).unref();
});
