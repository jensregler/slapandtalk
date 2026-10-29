// The full version panel (pay what you want via Lemon Squeezy, see server/licenses.js).
// Calm on purpose: one quiet entry in ⚙ More (Help section), shown only when the server sends
// entitlements.buy (or this browser already has the full version). No popups, no teasers on
// locked features, nothing in the demo profile's flow. The only time the panel opens by itself is
// /?thanks=1, the page Lemon Squeezy sends a buyer back to.
// OPEN ACCESS (shared/openaccess.mjs): the panel never opens and the ⚙ More entry is hidden.
import { entitlements, isFull, hasStoredKey, tryKey, forgetKey, isOpenAccess } from './entitlements.js';
import { S } from './strings.js';

export function initFullVersion({ $, onChange = () => {}, onOpen = () => {} }) {
  const panel = $('full-panel'), entry = $('full-entry');
  let thanks = false;

  function render() {
    const full = isFull();
    $('full-title').textContent = thanks ? S.fullThanksTitle : S.fullTitle;
    $('full-intro').textContent = thanks ? (full ? S.fullThanksDone : S.fullThanksIntro) : (full ? S.fullActive : S.fullIntro);
    $('full-buy').hidden = full || !entitlements.buy;
    if (entitlements.buy) $('full-buy-link').href = entitlements.buy.url;
    $('full-status').hidden = !full;
    $('full-forget').hidden = !(full && hasStoredKey());
    $('full-key-box').hidden = full;
  }
  function refreshEntry() { entry.hidden = isOpenAccess() || !(entitlements.buy || isFull()); if (isOpenAccess()) close(); else if (!panel.hidden) render(); }
  function open({ thanks: t = false } = {}) { if (isOpenAccess()) return; thanks = t; render(); panel.hidden = false; onOpen(); }
  function close() { panel.hidden = true; thanks = false; $('full-msg').textContent = ''; }

  entry.onclick = () => open();
  $('full-close').onclick = close;
  $('full-key-form').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('full-key'), btn = $('full-key-ok');
    if (!input.value.trim()) return;
    btn.disabled = true; $('full-msg').textContent = S.fullChecking;
    const r = await tryKey(input.value);
    btn.disabled = false;
    if (r.ok) { input.value = ''; $('full-msg').textContent = S.fullUnlocked; onChange(); }
    else $('full-msg').textContent = r.error === 'slow' ? S.fullKeySlow : r.error === 'offline' ? S.fullKeyOffline : S.fullKeyBad;
    render(); refreshEntry();
  };
  $('full-forget').onclick = async () => { await forgetKey(); $('full-msg').textContent = S.fullForgotten; onChange(); render(); refreshEntry(); };

  // Back from Lemon Squeezy: /?thanks=1 (the key itself may ride along as #unlock=…, taken by entitlements.js).
  let wantThanks = false;
  try {
    const url = new URL(location.href);
    if (url.searchParams.has('thanks')) {
      wantThanks = true; url.searchParams.delete('thanks');
      history.replaceState(history.state, '', url.pathname + (url.search || '') + url.hash);
    }
  } catch { /* ok */ }

  return {
    open, close, refreshEntry, isOpen: () => !panel.hidden,
    // Call once the entitlements have loaded.
    ready() { refreshEntry(); if (wantThanks) { wantThanks = false; open({ thanks: true }); } },
  };
}
