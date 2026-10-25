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
//   DEV_UNLOCK=1      dev/test servers only: a browser with localStorage "klibb.devUnlock" = "1"
//                     gets everything. Ignored unless the server sets this.
const FEATURES = ['fabrics', 'soundDesign'];
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

// resolver(env) -> ({ key, dev }) -> { fabrics, soundDesign, … }
function makeEntitlements(env = process.env) {
  const keys = parseKeys(env.FULL_ACCESS_KEYS);
  const devAllowed = env.DEV_UNLOCK === '1';
  const resolve = ({ key, dev } = {}) => {
    if (typeof key === 'string' && keys.has(key)) { const out = none(); for (const f of keys.get(key)) out[f] = true; return out; }
    if (devAllowed && (dev === true || dev === '1')) return all();
    return none();
  };
  resolve.devAllowed = devAllowed;
  return resolve;
}
// Credentials from an HTTP request (headers set by client/src/entitlements.js).
const fromReq = (req) => ({ key: req.get('x-unlock') || undefined, dev: req.get('x-dev-unlock') === '1' });
// … and from a WebSocket hello: { unlock: { key, dev } }.
const fromHello = (m) => { const u = m && typeof m.unlock === 'object' && m.unlock ? m.unlock : {}; return { key: typeof u.key === 'string' ? u.key : undefined, dev: u.dev === true }; };

module.exports = { FEATURES, makeEntitlements, fromReq, fromHello, none, all };
