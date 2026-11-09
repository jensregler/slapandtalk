// Which part of the app starts? ?replay=<id> = the replay page, otherwise the room itself.
// The page text is filled in from strings.js first. The server's config (config.js) decides if
// this is the demo profile: then the name question and the room routing (demo.js) come first;
// otherwise the plain address shows SLP/TLK → click/Enter/tap → name a new city (startcard.js); ?last=1 goes to your most
// recently used room (landing.js).
import { applyStrings } from './strings.js';
import { loadConfig, config } from './config.js';
applyStrings();
if (new URLSearchParams(location.search).has('replay')) import('./replay.js');
else start();
async function start() {
  await loadConfig();
  if (config.demo) {
    const { demoGate } = await import('./demo.js');
    if (!(await demoGate())) return;
  } else {
    const q = new URLSearchParams(location.search);
    // City-bus TEST: bare ?testbus=1 (no room) opens the first fake city. No Render env needed –
    // the client will POST /api/citybus/seed and keep a session alive with /ping.
    if (q.get('testbus') === '1') {
      const { isTestBusCity, TEST_CITIES } = await import('../../shared/citybus.mjs');
      const room = (q.get('room') || '').toLowerCase();
      if (!isTestBusCity(room)) {
        q.set('room', TEST_CITIES[0].id);
        history.replaceState(null, '', location.pathname + '?' + q.toString() + location.hash);
      }
    }
    // Only the bare address (or ?start=1): links with anything else – ?room, ?admin, ?last, and the
    // shop's ?unlock= / ?thanks=1#unlock= return – go on to the room as before.
    const bare = [...q.keys()].every((k) => k === 'start') && !/unlock=/.test(location.hash);
    if (bare) {
      // Plain address / ?start=1: SLP/TLK → click/Enter/tap → name a new city → enter it (startcard.js).
      // Resolves after history.replaceState(?room=<new city>); main.js then opens that city.
      // Direct ?room= / city links never hit this branch.
      const { showStartCard } = await import('./startcard.js');
      await showStartCard();
    } else {
      // ?last=1: straight to my most recently used room, as the plain address did before (landing.js).
      if (q.has('last')) { q.delete('last'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash); }
      const { land } = await import('./landing.js');
      await land();
    }
  }
  await import('./main.js');
}
