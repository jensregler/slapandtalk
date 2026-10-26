// Full version flags in the browser (mirror of server/entitlements.js).
// entitlements.full.<feature> is false until the server says otherwise, so the default
// page is the calm, plain room. The server re-checks everything it receives.
export const FEATURES = ['fabrics', 'soundDesign', 'bigStickers', 'cleanVideo'];
const KEY = 'klibb.unlock', DEV = 'klibb.devUnlock';
export const entitlements = { full: Object.fromEntries(FEATURES.map((f) => [f, false])), devAllowed: false };

const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* privat läge */ } };

export function credentials() { return { key: get(KEY) || undefined, dev: get(DEV) === '1' }; }
export function unlockHeaders() {
  const c = credentials(), h = {};
  if (c.key) h['x-unlock'] = c.key;
  if (c.dev) h['x-dev-unlock'] = '1';
  return h;
}
export const has = (feature) => !!entitlements.full[feature];

// /?unlock=<key> stores the key once (and removes it from the address bar); /?unlock=off forgets it.
function takeUrlKey() {
  let url; try { url = new URL(location.href); } catch { return; }
  if (!url.searchParams.has('unlock')) return;
  const v = url.searchParams.get('unlock') || '';
  set(KEY, v === 'off' || !v ? null : v);
  url.searchParams.delete('unlock');
  try { history.replaceState(history.state, '', url.pathname + (url.search ? url.search : '') + url.hash); } catch { /* ok */ }
}

export async function loadEntitlements() {
  takeUrlKey();
  try {
    const res = await fetch('/api/entitlements', { headers: unlockHeaders() });
    const j = await res.json();
    for (const f of FEATURES) entitlements.full[f] = !!(j.full && j.full[f]);
    entitlements.devAllowed = !!j.devAllowed;
  } catch { /* offline: stay free */ }
  return entitlements;
}
