// Full version flags in the browser (mirror of server/entitlements.js).
// entitlements.full.<feature> is false until the server says otherwise, so the default
// page is the calm, plain room. The server re-checks everything it receives.
// OPEN ACCESS (shared/openaccess.mjs): while on, every flag is true and there is no Full version UI.
// The server has the last word (/api/entitlements { open }; env OPEN_ACCESS=0 there turns it off).
import { OPEN_ACCESS } from '../../shared/openaccess.mjs';
export const FEATURES = ['fabrics', 'soundDesign', 'bigStickers', 'cleanVideo', 'multiCam', 'natureStickers', 'uploads', 'ownAvatar'];
const KEY = 'klibb.unlock', DEV = 'klibb.devUnlock';
// buy = { url } only when the server wants the quiet "Full version" entry (LS_CHECKOUT_URL set,
// and not the demo profile unless SHOW_BUY=1). Never shown as a popup or teaser.
export const entitlements = { full: Object.fromEntries(FEATURES.map((f) => [f, OPEN_ACCESS])), devAllowed: false, buy: null, open: OPEN_ACCESS };

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
export const isFull = () => FEATURES.some((f) => entitlements.full[f]);
export const hasStoredKey = () => !!get(KEY);
export const isOpenAccess = () => !!entitlements.open;

// /?unlock=<key> (or /#unlock=<key>, which never reaches any server log) stores the key once and
// removes it from the address bar; ?unlock=off forgets it. Works for manual keys and for the
// Lemon Squeezy license key (the receipt/thank-you button can link to /?thanks=1#unlock=[license_key]).
function takeUrlKey() {
  let url; try { url = new URL(location.href); } catch { return; }
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const inQuery = url.searchParams.has('unlock'), inHash = hash.has('unlock');
  if (!inQuery && !inHash) return;
  const v = ((inHash ? hash.get('unlock') : url.searchParams.get('unlock')) || '').trim();
  set(KEY, v === 'off' || !v ? null : v);
  url.searchParams.delete('unlock'); hash.delete('unlock');
  const h = hash.toString();
  try { history.replaceState(history.state, '', url.pathname + (url.search ? url.search : '') + (h ? '#' + h : '')); } catch { /* ok */ }
}

export async function loadEntitlements() {
  takeUrlKey();
  try {
    const res = await fetch('/api/entitlements', { headers: unlockHeaders() });
    const j = await res.json();
    entitlements.open = typeof j.open === 'boolean' ? j.open : OPEN_ACCESS;
    for (const f of FEATURES) entitlements.full[f] = entitlements.open || !!(j.full && j.full[f]);
    entitlements.devAllowed = !!j.devAllowed;
    entitlements.buy = !entitlements.open && j.buy && typeof j.buy.url === 'string' && /^https:\/\//.test(j.buy.url) ? { url: j.buy.url } : null;
  } catch { /* offline: stay free */ }
  return entitlements;
}

// "I have a key": the server checks it (manual key or Lemon Squeezy license key). Only a key that
// unlocks something is stored. -> { ok, error? }
export async function tryKey(raw) {
  const key = String(raw || '').trim();
  if (!key) return { ok: false, error: 'empty' };
  try {
    const res = await fetch('/api/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) return { ok: false, error: res.status === 429 ? 'slow' : 'bad' };
    set(KEY, key);
    await loadEntitlements();
    return { ok: isFull() };
  } catch { return { ok: false, error: 'offline' }; }
}
export async function forgetKey() { set(KEY, null); return loadEntitlements(); }
