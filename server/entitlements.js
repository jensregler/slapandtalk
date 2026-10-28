// Full version ("entitlements"): ONE shared switch for everything that lets a player go
// beyond the calm default room. Each paid feature is a flag under `full`, so new ones
// (lighting, …) are just one more name in FEATURES.
//
// Free players get every flag false: plain colours, their own default sounds, no deep menus.
// Everyone still SEES other players' fabrics and HEARS their custom sounds; only *sending*
// fabric/patch data needs the flag, and the server strips or rejects it otherwise.
//
// How a player gets the full version (see README "Full version"):
//   FULL_ACCESS_KEYS  comma-separated secret keys (≥ 12 chars). A key alone unlocks every
//                     feature; "key:fabrics+soundDesign" unlocks only the listed ones.
//                     The player opens  /?unlock=<key>  once; the browser keeps the key
//                     (localStorage "klibb.unlock") and sends it with requests.
//   Lemon Squeezy     paid keys (pay what you want, min $1): the buyer's LS license key works the
//                     same way (/?unlock=<key> or "I have a key"); server/licenses.js checks it
//                     with LS (store + product must match) and caches the verdict.
//   DEV_UNLOCK=1      dev/test servers only: a browser with localStorage "klibb.devUnlock" = "1"
//                     gets everything. Ignored unless the server sets this.
// bigStickers: stickers larger than FREE_MAX_STICKER_M (no upper limit) and smaller than
// FREE_MIN_STICKER_M (down to 5 cm). Free = 15 cm – 1 m.
// cleanVideo: finished videos (and photos) without the 'slap and talk' channel bug and the link ticker.
// multiCam: more than one auto cameraman (up to 6), each started with a click in the room, with an
// optional path choice. Free = one automatic cameraman, no settings.
// natureStickers: the Nature wheel (the library's nature stickers, shared/nature.mjs); the server
// refuses nature stamps without it (Jens, 28 Oct 2026).
const FEATURES = ['fabrics', 'soundDesign', 'bigStickers', 'cleanVideo', 'multiCam', 'natureStickers'];
const FREE_MAX_STICKER_M = 1;
// The free version (the one being released): at most this many people IN a room at once, four
// walls = one wall each (a session is ~30 min of slapping, then looking at it together). Rooms have
// no paid tier (the full version is per player, not per room), so this is THE room limit everywhere:
// the normal server, Staden, and the demo (DEMO_PROFILE=1: also the member cap, creator + 3 invites).
// More can connect, but they only watch (invisible, read-only chat, can't slap) until someone leaves.
// MAX_PLAYERS_PER_ROOM can only lower it.
const FREE_MAX_PLAYERS = 4;
const maxPlayersFor = (env = process.env) => { const n = Math.floor(Number(env.MAX_PLAYERS_PER_ROOM)); return n > 0 ? Math.min(n, FREE_MAX_PLAYERS) : FREE_MAX_PLAYERS; };
const FREE_MIN_STICKER_M = 0.15; // free version: at least 15 cm (= the A_ size); the full version keeps the 5 cm minimum
const KEY_RE = /^[A-Za-z0-9_.~-]{12,128}$/;

const none = () => Object.fromEntries(FEATURES.map((f) => [f, false]));
const all = () => Object.fromEntries(FEATURES.map((f) => [f, true]));

function parseKeys(raw) {
  const keys = new Map();
  for (const part of String(raw || '').split(',')) {
    const [key, list] = part.trim().split(':');
    if (!key || !KEY_RE.test(key)) continue;
    const feats = list ? list.split('+').map((s) => s.trim()).filter((f) => FEATURES.includes(f)) : FEATURES;
    keys.set(key, new Set(feats));
  }
  return keys;
}

// resolver(env, { licenses }) -> ({ key, dev }) -> { fabrics, soundDesign, bigStickers, … }
//   resolve(creds)        sync: manual keys, then what licenses already knows (memory), then dev.
//   resolve.check(creds)  async: same, but first asks Lemon Squeezy about an unknown LS key.
//   resolve.licenses      the licenses object (or null when LS isn't configured).
// DEMO_PROFILE=1 (server/demo.js): the demo shows the FREE version, so every key is ignored.
function makeEntitlements(env = process.env, { licenses = null } = {}) {
  const keys = parseKeys(env.FULL_ACCESS_KEYS);
  const demo = env.DEMO_PROFILE === '1' || String(env.DEMO_PROFILE).toLowerCase() === 'true';
  const devAllowed = env.DEV_UNLOCK === '1' && !demo;
  const resolve = ({ key, dev } = {}) => {
    if (demo) return none();
    if (typeof key === 'string' && keys.has(key)) { const out = none(); for (const f of keys.get(key)) out[f] = true; return out; }
    if (licenses && typeof key === 'string' && licenses.peek(key)) return all(); // paid: the whole full version
    if (devAllowed && (dev === true || dev === '1')) return all();
    return none();
  };
  resolve.check = async (creds = {}) => {
    const key = creds.key;
    if (licenses && typeof key === 'string' && !keys.has(key)) { try { await licenses.ensure(key); } catch { /* stays as known */ } }
    return resolve(creds);
  };
  resolve.isManual = (key) => typeof key === 'string' && keys.has(key);
  resolve.manualCount = keys.size;
  resolve.licenses = licenses;
  resolve.devAllowed = devAllowed;
  resolve.demo = demo;
  return resolve;
}
// Credentials from an HTTP request (headers set by client/src/entitlements.js).
const fromReq = (req) => ({ key: req.get('x-unlock') || undefined, dev: req.get('x-dev-unlock') === '1' });
// … and from a WebSocket hello: { unlock: { key, dev } }.
const fromHello = (m) => { const u = m && typeof m.unlock === 'object' && m.unlock ? m.unlock : {}; return { key: typeof u.key === 'string' ? u.key : undefined, dev: u.dev === true }; };

module.exports = { FEATURES, FREE_MAX_PLAYERS, maxPlayersFor, FREE_MAX_STICKER_M, FREE_MIN_STICKER_M, KEY_RE, makeEntitlements, fromReq, fromHello, none, all };
