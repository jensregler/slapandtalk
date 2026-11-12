// The city file in the Esc menu (Jens, t864u, 12 Nov 2026): CITY → Export city downloads the whole city as one
// .satcity file (its rooms, the baked surface textures, the painted-in stickers' archive and every design –
// server/cityarchive.js); CITY → Import city puts such a file into the city you are in (admin). On Jens's own
// PC (local mode, /api/config { local, localToken }) the local key is used by itself; on the live server the
// admin key is asked for (or the one this browser already has from ?admin=). Big, clear dialogs.
import { config } from './config.js';
import { S } from './strings.js';

const ADMIN_STORE = 'klibb.admin';
const storedAdmin = () => { try { return sessionStorage.getItem(ADMIN_STORE) || localStorage.getItem(ADMIN_STORE) || ''; } catch { return ''; } };
const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); for (const k of [].concat(kids)) if (k != null) e.append(k); return e; };
const mb = (n) => (n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0);

// One big dialog over everything; resolves with the pressed button's value (or null). Keys stay in it.
function dialog({ title, text, input = null, buttons }) {
  return new Promise((resolve) => {
    const box = el('div', { id: 'cityfile-dialog', className: 'cf-scrim' });
    const panel = el('div', { className: 'cf-panel', role: 'dialog' });
    panel.append(el('div', { className: 'cf-title', textContent: title }));
    if (text) panel.append(el('div', { className: 'cf-text', id: 'cf-text', textContent: text }));
    if (input) panel.append(input);
    const row = el('div', { className: 'cf-btns' });
    const done = (v) => { box.remove(); removeEventListener('keydown', onKey, true); resolve(v); };
    for (const b of buttons) {
      const btn = el('button', { type: 'button', className: 'cf-btn' + (b.primary ? ' cf-primary' : ''), id: b.id || '', textContent: b.text });
      btn.onclick = () => done(b.value);
      row.append(btn);
    }
    panel.append(row); box.append(panel); document.body.append(box);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done(null); return; }
      if (e.key === 'Enter') { const p = buttons.find((b) => b.primary); if (p) { e.preventDefault(); e.stopImmediatePropagation(); done(p.value); } return; }
      e.stopImmediatePropagation(); // typing in the field: the game must not walk
    };
    addEventListener('keydown', onKey, true);
    (input || row.querySelector('.cf-primary'))?.focus?.();
  });
}
// A status line in the same big style (packing / uploading …); returns { set(text), close() }.
function status(text) {
  const box = el('div', { id: 'cityfile-status', className: 'cf-scrim' });
  const t = el('div', { className: 'cf-title cf-status', textContent: text });
  box.append(el('div', { className: 'cf-panel' }, [t])); document.body.append(box);
  return { set: (s) => { t.textContent = s; }, close: () => box.remove() };
}

async function adminKey() {
  if (config.local && config.localToken) return config.localToken;
  const have = storedAdmin(); if (have) return have;
  const inp = el('input', { type: 'password', id: 'cf-token', className: 'cf-input', autocomplete: 'off', spellcheck: false });
  const v = await dialog({ title: S.cityFileTokenTitle, text: S.cityFileTokenNote, input: inp, buttons: [{ text: S.cityFileCancel, value: null }, { text: S.cityFileTokenGo, value: 'ok', primary: true, id: 'cf-token-go' }] });
  return v ? inp.value.trim() || null : null;
}

// Export the city `cityId` (its outside id) as a download.
export async function exportCity(cityId, { toast = () => {}, name = '' } = {}) {
  if (!cityId) { toast(S.cityFileOnlyCity, 2600); return null; }
  const key = await adminKey(); if (!key) return null;
  const st = status(S.cityFileExporting);
  try {
    const r = await fetch(`/api/admin/cities/${encodeURIComponent(cityId)}/export`, { headers: { 'x-admin-token': key }, cache: 'no-store' });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || `HTTP ${r.status}`); }
    const blob = await r.blob();
    const cd = r.headers.get('content-disposition') || '', file = (/filename="([^"]+)"/.exec(cd) || [])[1] || `${cityId}.satcity`;
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: file }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    const shown = decodeURIComponent(r.headers.get('x-city-name') || '') || name || cityId;
    toast(S.cityFileExported(shown, mb(blob.size)), 5000);
    window.__klibbLastExport = { file, size: blob.size };
    return { file, size: blob.size };
  } catch (e) { toast(S.cityFileFailed(e.message), 5000); return null; }
  finally { st.close(); }
}

// Pick a .satcity file and import it into `cityId` (replacing it). onDone(result) – e.g. reload.
export function importCity(cityId, { toast = () => {}, here = '', onDone = () => location.reload(), file: given = null } = {}) {
  if (!cityId) { toast(S.cityFileOnlyCity, 2600); return; }
  const go = async (file) => {
    if (!file) return;
    const ok = await dialog({ title: S.cityFileImportTitle, text: S.cityFileImportAsk(file.name, here || cityId),
      buttons: [{ text: S.cityFileCancel, value: null }, { text: S.cityFileImportYes, value: 'yes', primary: true, id: 'cf-import-yes' }] });
    if (!ok) return;
    const key = await adminKey(); if (!key) return;
    const st = status(S.cityFileImporting(mb(file.size)));
    try {
      const r = await fetch(`/api/admin/cities/import?target=${encodeURIComponent(cityId)}`, { method: 'POST', headers: { 'x-admin-token': key, 'Content-Type': 'application/gzip' }, body: file });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      window.__klibbLastImport = d;
      st.set(S.cityFileImported(d.name || cityId, (d.rooms || []).length));
      setTimeout(() => { st.close(); onDone(d); }, 1200);
    } catch (e) { st.close(); toast(S.cityFileFailed(e.message), 6000); }
  };
  if (given) { go(given); return; }
  const inp = el('input', { type: 'file', accept: '.satcity,application/gzip', id: 'cf-file' });
  inp.style.display = 'none'; document.body.append(inp);
  inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.remove(); go(f); });
  inp.click();
}
