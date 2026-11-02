// The City on the client (Jens, 2 Nov 2026, t476u; layout shared/city.mjs, scene city.js).
//  - What you carry: your pack (klibb.pac, made at the door – door.js) + the packs you took in the
//    Town Hall (klibb.cityTaken, at most 2). Their stickers (≤ 9) are the only stickers on the wheel
//    in the city and in its houses, with the exit button and your pack (cityWheel).
//  - The Town Hall (openTownHall): hand in your pack (it stays a week, server/citypacks.js), then take
//    two packs from other people. Big pictures, big buttons, one column on a phone.
import { readPac, pacPicture, PAC_LABEL } from './door.js';
import { S } from './strings.js';

const TAKEN_KEY = 'klibb.cityTaken', TOKEN_KEY = 'klibb.packToken', FROM_KEY = 'klibb.cityFrom';
const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* full */ } };
export const packToken = () => read(TOKEN_KEY, null);
// The room I came from (the door): "Back to my room". This visit only.
export const cityFrom = () => { try { return sessionStorage.getItem(FROM_KEY); } catch { return null; } };
export const setCityFrom = (id) => { try { if (id) sessionStorage.setItem(FROM_KEY, id); } catch { /* private */ } };
// The packs I took: { mine: packId, packs: [{ id, name, img, stickers: [{ id, url, width, height }] }] }.
// They belong to the pack I handed in; a new pack of mine (another week) starts over.
export function takenPacks() { const t = read(TAKEN_KEY, null); return t && Array.isArray(t.packs) ? t.packs.slice(0, 2) : []; }

// The pseudo designs on the city wheel: the exit button and my pack (picked = opens, never slapped).
export const PACK_DESIGN_ID = 'city-pack';
export const isPackDesign = (d) => !!d && d.id === PACK_DESIGN_ID;
let packUrl = null, packUrlFor = '';
export async function refreshPackPicture() {
  const pac = readPac(); const key = pac ? pac.at + '|' + (pac.img || '').length : '';
  if (key === packUrlFor) return packUrl;
  packUrlFor = key;
  const c = pac ? await pacPicture(pac) : null;
  packUrl = c ? (c.toDataURL ? c.toDataURL('image/webp', 0.85) : c.src) : '/start/pac.webp';
  return packUrl;
}
// The city wheel: [my first sticker (held at start), exit, my pack, …the other stickers]. byId(id)
// finds a design (the library or my uploads) for a sticker id. exit = the exit menu sticker's design.
export function cityWheel({ byId, exit }) {
  const pac = readPac();
  const fromPac = pac && Array.isArray(pac.stickers) ? pac.stickers.map((id, k) => byId(id) || pac.designs?.[k] || (pac.urls && pac.urls[k] ? { id, url: pac.urls[k] } : null)).filter(Boolean) : [];
  const fromTaken = takenPacks().flatMap((p) => p.stickers.filter((s) => !s.gone).map((s) => byId(s.id) || { id: s.id, url: s.url, width: s.width, height: s.height }));
  const seen = new Set(), stickers = [...fromPac, ...fromTaken].filter((d) => !seen.has(d.id) && seen.add(d.id)).slice(0, 9);
  const pack = { id: PACK_DESIGN_ID, url: packUrl || '/start/pac.webp', width: 563, height: 802, name: pac?.name || S.cityMyPack, cityPack: true };
  const [first, ...rest] = stickers;
  return [...(first ? [first] : []), ...(exit ? [exit] : []), pack, ...rest.reverse()];
}

const api = {
  list: () => fetch('/api/city/packs', { headers: packToken() ? { 'x-pack-token': packToken() } : {} }).then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || S.hallLoadFailed); return d; }),
  handIn: async (pac, blob) => {
    const fd = new FormData(); fd.append('name', pac.name || ''); fd.append('stickers', JSON.stringify(pac.stickers || [])); fd.append('img', blob, 'pack.webp');
    const r = await fetch('/api/city/packs', { method: 'POST', body: fd, headers: packToken() ? { 'x-pack-token': packToken() } : {} });
    const d = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(d.error || S.hallLoadFailed), { pack: d.pack }); return d;
  },
  take: async (id) => {
    const r = await fetch(`/api/city/packs/${id}/take`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(packToken() ? { 'x-pack-token': packToken() } : {}) }, body: '{}' });
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || S.hallLoadFailed); return d;
  },
};

let ui = null;
// opts: { toast, onChange: () => void (the wheel changed), onClose, makePack: () => void (no pack yet) }
export function openTownHall(opts) { if (!ui) ui = build(); ui.open(opts); return ui; }
export const townHallOpen = () => !!ui && !ui.box.hidden;
export const townHallState = () => (ui ? ui.state() : { open: false });

const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); } catch { return iso; } };
function build() {
  const box = document.createElement('div'); box.id = 'townhall'; box.hidden = true;
  box.innerHTML = `
    <div class="th-panel">
      <div class="th-head"><span class="th-title" id="th-title"></span><button type="button" class="th-x" id="th-x">✕</button></div>
      <div class="th-body">
        <section class="th-mine"><div class="th-h" id="th-h-mine"></div><img id="th-mine-img" alt=""><div class="th-name" id="th-mine-name"></div>
          <div class="th-note" id="th-mine-note"></div><button type="button" class="th-big" id="th-handin"></button></section>
        <section class="th-others"><div class="th-h" id="th-h-others"></div><div class="th-note" id="th-left"></div><div class="th-grid" id="th-grid"></div></section>
      </div>
      <button type="button" class="th-back" id="th-back"></button>
    </div>`;
  document.body.appendChild(box);
  const $ = (id) => box.querySelector('#' + id);
  const st = { opts: null, data: null, busy: false };
  const close = () => { if (box.hidden) return; box.hidden = true; st.opts?.onClose?.(); };
  $('th-x').onclick = close; $('th-back').onclick = close;
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  addEventListener('keydown', (e) => { if (box.hidden) return; if (e.key === 'Escape') close(); e.stopImmediatePropagation(); }, true);
  addEventListener('keyup', (e) => { if (!box.hidden) e.stopImmediatePropagation(); }, true);

  let renders = 0;
  async function render() {
    const n = ++renders, pic = (await refreshPackPicture()) || '/start/pac.webp';
    if (n !== renders) return; // a newer render is on its way (only the last one draws)
    const pac = readPac(), d = st.data, mine = d && d.mine;
    $('th-mine-img').src = pic;
    $('th-mine-name').textContent = pac ? (pac.name || S.cityMyPack) : S.cityNoPack;
    const hb = $('th-handin');
    if (mine) { hb.hidden = true; $('th-mine-note').textContent = S.hallHandedIn(fmtDate(mine.expiresAt)); }
    else { hb.hidden = false; hb.textContent = st.busy ? S.hallMaking : pac ? S.hallHandIn : S.cityNoPack; hb.disabled = st.busy; $('th-mine-note').textContent = pac ? S.hallHandInNote : ''; }
    $('th-left').textContent = mine ? S.hallLeft(mine.left) : S.hallFirst;
    const grid = $('th-grid'); grid.textContent = '';
    const others = d ? d.packs.filter((p) => !p.mine) : [];
    if (!others.length) { const n = document.createElement('div'); n.className = 'th-none'; n.textContent = d ? S.hallNone : '…'; grid.appendChild(n); }
    for (const p of others) {
      const c = document.createElement('div'); c.className = 'th-pack' + (p.taken ? ' taken' : ''); c.dataset.id = p.id;
      c.innerHTML = `<img class="th-pimg" loading="lazy" alt=""><div class="th-pname"></div><div class="th-stk"></div><button type="button" class="th-take"></button>`;
      c.querySelector('.th-pimg').src = p.img; c.querySelector('.th-pname').textContent = p.name;
      for (const s of p.stickers) if (s.url) { const i = document.createElement('img'); i.src = s.url; i.alt = ''; c.querySelector('.th-stk').appendChild(i); }
      const b = c.querySelector('.th-take');
      b.textContent = p.taken ? S.hallTaken : mine ? S.hallTake : S.hallFirst;
      b.disabled = p.taken || !mine || mine.left <= 0 || st.busy;
      b.onclick = () => take(p);
      grid.appendChild(c);
    }
  }
  async function load() {
    try { st.data = await api.list(); } catch (e) { st.opts?.toast?.(e.message || S.hallLoadFailed, 2600); st.data = st.data || { packs: [], mine: null }; }
    // the packs I took belong to the pack I have in the Town Hall: a new week = start over
    const t = read(TAKEN_KEY, null), mine = st.data.mine;
    if (t && (!mine || t.mine !== mine.id)) { write(TAKEN_KEY, null); st.opts?.onChange?.(); }
    await render();
  }
  $('th-handin').onclick = async () => {
    const pac = readPac();
    if (!pac) { close(); st.opts?.makePack?.(); return; }
    st.busy = true; render();
    try {
      const c = await pacPicture(pac);
      const blob = await new Promise((res) => { if (c.toBlob) c.toBlob(res, 'image/webp', 0.9); else fetch(c.src).then((r) => r.blob()).then(res); });
      const r = await api.handIn(pac, blob);
      write(TOKEN_KEY, r.token); write(TAKEN_KEY, { mine: r.pack.id, packs: [] });
    } catch (e) { st.opts?.toast?.(e.message, 2600); }
    st.busy = false; await load();
  };
  async function take(p) {
    st.busy = true; render();
    try {
      const r = await api.take(p.id);
      const t = read(TAKEN_KEY, null) || { mine: st.data.mine.id, packs: [] };
      if (!t.packs.some((x) => x.id === p.id)) t.packs.push({ id: r.pack.id, name: r.pack.name, img: r.pack.img, stickers: r.pack.stickers });
      write(TAKEN_KEY, t); st.opts?.onChange?.(); st.opts?.toast?.(S.hallTookToast(r.pack.name), 2600);
    } catch (e) { st.opts?.toast?.(e.message, 2600); }
    st.busy = false; await load();
  }
  return {
    box,
    open(opts) {
      st.opts = opts; $('th-title').textContent = S.hallTitle; $('th-h-mine').textContent = S.hallYourPack; $('th-h-others').textContent = S.hallOthers; $('th-back').textContent = S.hallBack;
      box.hidden = false; render(); load();
    },
    close,
    state: () => ({ open: !box.hidden, mine: st.data?.mine || null, packs: st.data ? st.data.packs.length : null, taken: takenPacks().map((p) => p.id) }),
  };
}
export { PAC_LABEL };
