// The cities on the client (Jens, t476u + t479u, 2 Nov 2026; layout shared/city.mjs, scene city.js).
//  - What you carry: your pack (klibb.pac, made at the door – door.js) + the packs you took in the
//    Town Hall (klibb.cityTaken). Their stickers are the only stickers on the wheel in the city and in
//    its houses, with the exit button and your pack (cityWheel). A free player carries 3 packs at most
//    (9 stickers) and drops what they took when they leave the city (cityleave.js); a paying player
//    keeps them, and puts them in their deck (openDeckPick: choose which deck stickers they replace,
//    like the name-tag tool's save; the deck holds DECK_MAX = 228 at most).
//  - The Town Hall (openTownHall) is ONE pack shop for every city: big cards (picture, name, who made
//    it, the 3 stickers, a few words), a big detail view, hand in with a description. One column on a
//    phone. Server: server/citypacks.js.
//  - The city picker (openCityPick, after "to city →"): start a new city (you name it) or go into one
//    that is alive. Server: server/cities.js.
import { readPac, pacPicture, PAC_LABEL } from './door.js';
import { unlockHeaders } from './entitlements.js';
import { S } from './strings.js';

const TAKEN_KEY = 'klibb.cityTaken', TOKEN_KEY = 'klibb.packToken', KEPT_KEY = 'klibb.deckKept', SWAP_KEY = 'klibb.swaps', LOOK_KEY = 'klibb.avatar';
export const DECK_MAX = 228;
const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* full */ } };
export const packToken = () => read(TOKEN_KEY, null);
// The packs I took: { mine: packId, packs: [{ id, name, img, stickers: [{ id, url, width, height }] }] }.
export function takenPacks() { const t = read(TAKEN_KEY, null); return t && Array.isArray(t.packs) ? t.packs : []; }
// A paying player's kept stickers (in the deck, also outside the city): [{ id, url, width, height, from }].
export const readKept = () => { const k = read(KEPT_KEY, []); return Array.isArray(k) ? k.filter((d) => d && typeof d.id === 'string' && typeof d.url === 'string') : []; };
const readSwaps = () => { const o = read(SWAP_KEY, {}); return o && typeof o === 'object' ? o : {}; };

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
// max: 9 for a free player (3 packs), the deck's size for a paying one.
export function cityWheel({ byId, exit, max = 9 }) {
  const pac = readPac();
  const fromPac = pac && Array.isArray(pac.stickers) ? pac.stickers.map((id, k) => byId(id) || pac.designs?.[k] || (pac.urls && pac.urls[k] ? { id, url: pac.urls[k] } : null)).filter(Boolean) : [];
  const fromTaken = takenPacks().flatMap((p) => p.stickers.filter((s) => !s.gone).map((s) => byId(s.id) || { id: s.id, url: s.url, width: s.width, height: s.height }));
  const seen = new Set(), stickers = [...fromPac, ...fromTaken].filter((d) => !seen.has(d.id) && seen.add(d.id)).slice(0, max);
  const pack = { id: PACK_DESIGN_ID, url: packUrl || '/start/pac.webp', width: 563, height: 802, name: pac?.name || S.cityMyPack, cityPack: true };
  const [first, ...rest] = stickers;
  return [...(first ? [first] : []), ...(exit ? [exit] : []), pack, ...rest.reverse()];
}

const hdrs = (json) => ({ ...(json ? { 'Content-Type': 'application/json' } : {}), ...(packToken() ? { 'x-pack-token': packToken() } : {}), ...unlockHeaders() });
const answer = async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(d.error || S.hallLoadFailed), { status: r.status, pack: d.pack }); return d; };
const api = {
  list: () => fetch('/api/city/packs', { headers: hdrs(false), cache: 'no-store' }).then(answer),
  handIn: (pac, blob, { about, author, insta }) => {
    const fd = new FormData(); fd.append('name', pac.name || ''); fd.append('stickers', JSON.stringify(pac.stickers || []));
    fd.append('about', about || ''); fd.append('author', author || ''); fd.append('insta', insta || ''); fd.append('img', blob, 'pack.webp');
    return fetch('/api/city/packs', { method: 'POST', body: fd, headers: hdrs(false) }).then(answer);
  },
  take: (id) => fetch(`/api/city/packs/${id}/take`, { method: 'POST', headers: hdrs(true), body: '{}' }).then(answer),
  cities: () => fetch('/api/cities', { cache: 'no-store' }).then(answer),
  newCity: (name, by) => fetch('/api/cities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, by }) }).then(answer),
};
export const cityApi = {
  info: (id) => fetch(`/api/cities/${id}`, { cache: 'no-store' }).then(answer),
  startHouse: (id, by) => fetch(`/api/cities/${id}/houses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ by }) }).then(answer),
};
const myLook = () => { const l = read(LOOK_KEY, {}) || {}; return { name: String(l.name || '').slice(0, 24), insta: String(l.look?.insta || '') }; };
const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); } catch { return iso; } };
const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); for (const k of [].concat(kids)) if (k != null) e.append(k); return e; };
const img = (src, cls = '') => { const i = el('img', { className: cls, alt: '', draggable: false }); i.loading = 'lazy'; i.src = src; return i; };
// Keys inside a sheet stay in the sheet (the game must not walk / slap while typing).
// (typing in a field: the key reaches the field, then stops at the sheet)
function trapKeys(box, onEsc) {
  addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'Escape') { onEsc(); e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (!box.contains(e.target)) e.stopImmediatePropagation();
  }, true);
  addEventListener('keyup', (e) => { if (!box.hidden && !box.contains(e.target)) e.stopImmediatePropagation(); }, true);
  for (const t of ['keydown', 'keyup', 'keypress']) box.addEventListener(t, (e) => e.stopPropagation());
}

// ---------------- The Town Hall: the pack shop ----------------
let ui = null;
// opts: { toast, onChange: () => void (the wheel changed), onClose, makePack: () => void (no pack yet),
//         deck: () => [designs] (my deck, no menu stickers), onDeck: () => void (the deck changed) }
export function openTownHall(opts) { if (!ui) ui = buildHall(); ui.open(opts); return ui; }
export const townHallOpen = () => !!ui && !ui.box.hidden;
export const townHallState = () => (ui ? ui.state() : { open: false });

function buildHall() {
  const box = el('div', { id: 'townhall' }); box.hidden = true;
  box.innerHTML = `
    <div class="th-panel">
      <div class="th-head"><span class="th-title" id="th-title"></span><button type="button" class="th-x" id="th-x" aria-label="close">✕</button></div>
      <div class="th-bar" id="th-bar"></div>
      <div class="th-body" id="th-main">
        <section class="th-mine" id="th-mine"><div class="th-h" id="th-h-mine"></div><img id="th-mine-img" alt=""><div class="th-name" id="th-mine-name"></div>
          <div class="th-note" id="th-mine-note"></div><button type="button" class="th-big" id="th-handin"></button></section>
        <section class="th-shop"><div class="th-h" id="th-h-others"></div><div class="th-grid" id="th-grid"></div></section>
      </div>
      <div class="th-body th-detail" id="th-detail" hidden></div>
      <div class="th-body th-form" id="th-form" hidden></div>
      <div class="th-body th-deck" id="th-deck" hidden></div>
      <button type="button" class="th-back" id="th-back"></button>
    </div>`;
  document.body.appendChild(box);
  const $ = (id) => box.querySelector('#' + id);
  const st = { opts: null, data: null, busy: false, view: 'main', detail: null, deck: null };
  const close = () => { if (box.hidden) return; box.hidden = true; st.opts?.onClose?.(); };
  const show = (view) => { st.view = view; for (const v of ['main', 'detail', 'form', 'deck']) $('th-' + v).hidden = v !== view; $('th-back').textContent = view === 'main' ? S.hallBack : S.hallDetailBack; box.querySelector('.th-panel').scrollTop = 0; for (const v of ['main', 'detail', 'form', 'deck']) $('th-' + v).scrollTop = 0; };
  const back = () => { if (st.view === 'main') close(); else { show('main'); render(); } };
  $('th-x').onclick = close; $('th-back').onclick = back;
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  trapKeys(box, back);
  const mine = () => st.data && st.data.mine;
  const paid = () => !!(st.data && st.data.paid);
  const carried = () => takenPacks().length;
  const kept = () => new Set(readKept().map((d) => d.from).filter(Boolean));

  // one pack card (the grid) – the whole card opens the big view; the button takes it
  function card(p) {
    const c = el('div', { className: 'th-pack' + (p.taken ? ' taken' : '') }); c.dataset.id = p.id;
    const by = el('div', { className: 'th-by' }, [S.hallBy(p.author?.name, p.author?.insta) + ' ']);
    if (p.author?.insta) by.append(el('span', { className: 'th-insta', textContent: '@' + p.author.insta }));
    const stk = el('div', { className: 'th-stk' }); for (const s of p.stickers) if (s.url) stk.append(img(s.url));
    const about = el('div', { className: 'th-about', textContent: p.about || '' });
    const meta = el('div', { className: 'th-meta', textContent: [p.forever ? '♾' : S.hallUntil(fmtDate(p.expiresAt)), p.takenCount ? S.hallTakenCount(p.takenCount) : ''].filter(Boolean).join(' · ') });
    c.append(img(p.img, 'th-pimg'), el('div', { className: 'th-pname', textContent: p.name }), by, stk, about, meta, takeButton(p, 'th-take'));
    c.onclick = (e) => { if (!e.target.closest('button')) openDetail(p); };
    return c;
  }
  function takeButton(p, cls) {
    const b = el('button', { type: 'button', className: cls });
    const m = mine(), left = m ? m.left : 0;
    if (p.taken && paid()) { const k = kept().has(p.id); b.textContent = k ? S.dkInDeck : S.dkPut; b.disabled = k || st.busy; b.onclick = () => openDeck(p); return b; }
    b.textContent = p.taken ? S.hallTaken : !m ? S.hallFirst : left <= 0 ? S.hallFull(st.data.maxPacks) : S.hallTake;
    b.disabled = p.taken || !m || left <= 0 || st.busy;
    b.onclick = () => take(p);
    return b;
  }
  function openDetail(p) {
    st.detail = p.id; const d = $('th-detail'); d.textContent = '';
    const by = el('div', { className: 'th-by th-by-big' }, [S.hallBy(p.author?.name, p.author?.insta) + ' ']);
    if (p.author?.insta) by.append(el('a', { className: 'th-insta', href: `https://instagram.com/${encodeURIComponent(p.author.insta)}`, target: '_blank', rel: 'noopener', textContent: '@' + p.author.insta }));
    const stk = el('div', { className: 'th-stk th-stk-big' }); for (const s of p.stickers) if (s.url) stk.append(img(s.url));
    const info = el('div', { className: 'th-dinfo' }, [
      el('div', { className: 'th-dname', textContent: p.name }), by, stk,
      el('div', { className: 'th-h', textContent: S.hallAbout }), el('div', { className: 'th-dabout', textContent: p.about || S.hallNoAbout }),
      el('div', { className: 'th-meta', textContent: [p.forever ? S.hallForever : S.hallUntil(fmtDate(p.expiresAt)), p.takenCount ? S.hallTakenCount(p.takenCount) : ''].filter(Boolean).join(' · ') }),
      p.mine ? null : takeButton(p, 'th-big th-dtake'),
    ]);
    d.append(el('div', { className: 'th-dpic' }, [img(p.img, 'th-dimg')]), info);
    show('detail');
  }
  // the hand-in form: a few words about me and the stickers
  async function openForm() {
    const pac = readPac(); if (!pac) { close(); st.opts?.makePack?.(); return; }
    const f = $('th-form'); f.textContent = '';
    const me = myLook();
    const name = el('input', { id: 'hi-name', type: 'text', maxLength: 24, value: me.name, autocomplete: 'nickname' });
    const insta = el('input', { id: 'hi-insta', type: 'text', maxLength: 31, value: me.insta, autocapitalize: 'none', spellcheck: false });
    const about = el('textarea', { id: 'hi-about', maxLength: 400, rows: 5, placeholder: S.hiAboutPlaceholder });
    const count = el('div', { className: 'th-count', textContent: '0 / 400' });
    about.addEventListener('input', () => { count.textContent = `${about.value.length} / 400`; });
    const week = new Date(Date.now() + 7 * 864e5).toISOString();
    const go = el('button', { type: 'button', className: 'th-big', id: 'hi-go', textContent: S.hiGo });
    const cancel = el('button', { type: 'button', className: 'th-big th-plain', id: 'hi-cancel', textContent: S.hiCancel });
    const msg = el('div', { className: 'th-note th-msg', id: 'hi-msg' });
    const lab = (t, i) => el('label', { className: 'th-field' }, [el('span', { textContent: t }), i]);
    f.append(
      el('div', { className: 'th-fpic' }, [img((await refreshPackPicture()) || '/start/pac.webp', 'th-fimg'), el('div', { className: 'th-name', textContent: pac.name || S.cityMyPack })]),
      el('div', { className: 'th-fields' }, [el('div', { className: 'th-dname', textContent: S.hiTitle }), lab(S.hiName, name), lab(S.hiInsta, insta), lab(S.hiAbout, about), count,
        el('div', { className: 'th-note', textContent: paid() ? S.hiForever : S.hiWeek(fmtDate(week)) }), msg, el('div', { className: 'th-btns' }, [cancel, go])]),
    );
    cancel.onclick = () => { show('main'); render(); };
    go.onclick = async () => {
      go.disabled = true; msg.textContent = S.hallMaking;
      try {
        const c = await pacPicture(pac);
        const blob = await new Promise((res) => { if (c.toBlob) c.toBlob(res, 'image/webp', 0.9); else fetch(c.src).then((r) => r.blob()).then(res); });
        const r = await api.handIn(pac, blob, { about: about.value, author: name.value, insta: insta.value });
        write(TOKEN_KEY, r.token);
        const t = read(TAKEN_KEY, null); if (!t) write(TAKEN_KEY, { mine: r.pack.id, packs: [] }); else write(TAKEN_KEY, { ...t, mine: r.pack.id });
        show('main'); await load();
      } catch (e) { msg.textContent = e.message; go.disabled = false; }
    };
    show('form'); name.focus();
  }

  let renders = 0;
  async function render() {
    const n = ++renders, pic = (await refreshPackPicture()) || '/start/pac.webp';
    if (n !== renders) return; // a newer render is on its way (only the last one draws)
    const pac = readPac(), d = st.data, m = mine();
    $('th-mine-img').src = pic;
    $('th-mine-name').textContent = pac ? (pac.name || S.cityMyPack) : S.cityNoPack;
    const hb = $('th-handin');
    // mine in the shop: when it leaves; a paying player may hand in this pack too if it is not in yet
    const sameIn = m && pac && d.packs.some((p) => p.mine && p.stickers.map((s) => s.id).join() === (pac.stickers || []).join() && p.name === (pac.name || p.name));
    if (m && (!paid() || sameIn)) { hb.hidden = true; $('th-mine-note').textContent = m.forever ? S.hallForever : S.hallHandedIn(fmtDate(m.expiresAt)); }
    else { hb.hidden = false; hb.textContent = !pac ? S.cityNoPack : m ? S.hallHandInAnother : S.hallHandIn; hb.disabled = st.busy; $('th-mine-note').textContent = m ? (m.forever ? S.hallForever : S.hallHandedIn(fmtDate(m.expiresAt))) : pac ? S.hallHandInNote : ''; }
    const bar = $('th-bar'); bar.textContent = '';
    if (d) {
      bar.append(el('span', { className: 'th-chip th-chip-carry', id: 'th-carry', textContent: paid() ? S.hallCarryPaid(1 + carried()) : S.hallCarry(1 + carried(), d.maxPacks) }));
      bar.append(el('span', { className: 'th-chip' + (paid() ? ' th-chip-paid' : ''), textContent: paid() ? S.hallPaidRule : S.hallFreeRule }));
    }
    const others = d ? d.packs.filter((p) => !p.mine) : [];
    $('th-h-others').textContent = S.hallShop(others.length);
    const grid = $('th-grid'); grid.textContent = '';
    if (!others.length) grid.append(el('div', { className: 'th-none', textContent: d ? S.hallNone : '…' }));
    for (const p of others) grid.append(card(p));
    if (st.view === 'detail' && st.detail && d) { const p = d.packs.find((x) => x.id === st.detail); if (p) openDetail(p); }
  }
  async function load() {
    try { st.data = await api.list(); } catch (e) { st.opts?.toast?.(e.message || S.hallLoadFailed, 2600); st.data = st.data || { packs: [], mine: null, maxPacks: 3 }; }
    // what I carry = what the server says I took (a new pack of mine / a week later / I left: start over)
    const t = read(TAKEN_KEY, null), m = st.data.mine, takes = m ? m.takes : [];
    if (t && t.packs.some((p) => !takes.includes(p.id))) { write(TAKEN_KEY, { ...t, packs: t.packs.filter((p) => takes.includes(p.id)) }); st.opts?.onChange?.(); }
    await render();
  }
  $('th-handin').onclick = () => openForm();
  async function take(p) {
    st.busy = true; render();
    try {
      const r = await api.take(p.id);
      const t = read(TAKEN_KEY, null) || { mine: mine().id, packs: [] };
      if (!t.packs.some((x) => x.id === p.id)) t.packs.push({ id: r.pack.id, name: r.pack.name, img: r.pack.img, stickers: r.pack.stickers });
      write(TAKEN_KEY, t); st.opts?.onChange?.(); st.opts?.toast?.(S.hallTookToast(r.pack.name), 2600);
      st.busy = false; await load();
      if (paid()) openDeck(st.data.packs.find((x) => x.id === p.id) || r.pack); // a paying player: into the deck
      return;
    } catch (e) { st.opts?.toast?.(e.message, 2600); }
    st.busy = false; await load();
  }

  // ---- a paying player's deck picker: which deck stickers do the pack's stickers replace? ----
  function openDeck(p) {
    const deck = (st.opts?.deck?.() || []).filter((d) => d && d.id && d.url);
    const have = new Set(deck.map((d) => d.id));
    const fresh = p.stickers.filter((s) => s.url && !s.gone && !have.has(s.id));
    const targets = new Map(); // new id -> old id | 'add'
    let active = fresh[0] ? fresh[0].id : null;
    const room = () => Math.max(0, DECK_MAX - deck.length - [...targets.values()].filter((v) => v === 'add').length);
    const box2 = $('th-deck');
    st.deck = { pack: p.id, targets, fresh: fresh.map((s) => s.id) };
    function draw() {
      box2.textContent = '';
      const slots = el('div', { className: 'dk-slots', id: 'dk-slots' });
      for (const s of p.stickers) {
        if (!s.url) continue;
        const already = have.has(s.id), to = targets.get(s.id), old = to && to !== 'add' ? deck.find((d) => d.id === to) : null;
        const slot = el('button', { type: 'button', className: 'dk-slot' + (s.id === active ? ' on' : '') + (already ? ' already' : '') }, [
          img(s.url, 'dk-new'), el('span', { className: 'dk-arrow', textContent: already ? S.dkAlready : S.dkPickFor }),
          already ? null : old ? img(old.url, 'dk-old') : el('span', { className: 'dk-empty', textContent: to === 'add' ? '＋' : S.dkChoose }),
        ]);
        slot.dataset.id = s.id; slot.disabled = already;
        slot.onclick = () => { active = s.id; draw(); };
        slots.append(slot);
      }
      const grid = el('div', { className: 'dk-grid', id: 'dk-grid' });
      const used = new Set([...targets.values()]);
      for (const d of deck) {
        const b = el('button', { type: 'button', className: 'dk-g' + (used.has(d.id) ? ' picked' : '') }, [img(d.url)]);
        b.dataset.id = d.id;
        b.onclick = () => {
          if (!active) return;
          for (const [k, v] of targets) if (v === d.id) targets.delete(k); // one deck sticker, one new sticker
          targets.set(active, d.id);
          active = fresh.find((s) => !targets.has(s.id))?.id || active; draw();
        };
        grid.append(b);
      }
      const done = fresh.every((s) => targets.has(s.id));
      const save = el('button', { type: 'button', className: 'th-big', id: 'dk-save', textContent: S.dkSave }); save.disabled = !done;
      const later = el('button', { type: 'button', className: 'th-big th-plain', id: 'dk-later', textContent: S.dkLater });
      const need = fresh.filter((s) => !targets.has(s.id)).length;
      const add = el('button', { type: 'button', className: 'th-big th-plain', id: 'dk-add', textContent: S.dkAdd(room()) });
      add.hidden = !need || room() < need;
      add.onclick = () => { for (const s of fresh) if (!targets.has(s.id)) targets.set(s.id, 'add'); draw(); };
      later.onclick = () => { show('main'); render(); };
      save.onclick = () => { putInDeck(p, fresh, targets); show('main'); render(); st.opts?.onDeck?.(); st.opts?.toast?.(S.dkSaved, 2600); };
      box2.append(el('div', { className: 'th-dname', textContent: S.dkTitle(p.name) }), el('div', { className: 'th-note', textContent: S.dkNote(DECK_MAX) }), slots,
        el('div', { className: 'th-btns' }, [later, add, save]), grid);
    }
    draw(); show('deck');
  }
  return {
    box,
    open(opts) {
      st.opts = opts; $('th-title').textContent = S.hallTitle; $('th-h-mine').textContent = S.hallYourPack;
      box.hidden = false; show('main'); render(); load();
    },
    close,
    openDetail: (id) => { const p = st.data?.packs.find((x) => x.id === id); if (p) openDetail(p); },
    openForm, openDeck: (id) => { const p = st.data?.packs.find((x) => x.id === id); if (p) openDeck(p); },
    state: () => ({ open: !box.hidden, view: st.view, mine: st.data?.mine || null, paid: paid(), packs: st.data ? st.data.packs.length : null, taken: takenPacks().map((p) => p.id),
      maxPacks: st.data?.maxPacks ?? null, deck: st.deck ? { pack: st.deck.pack, fresh: st.deck.fresh, targets: Object.fromEntries(st.deck.targets) } : null }),
  };
}
// The deck picker's save: the new stickers become kept stickers; each replaces its old one (klibb.swaps,
// the same as the name-tag tool – main.js applySwaps), or is added at the end of the deck.
export function putInDeck(p, fresh, targets) {
  const k = readKept(), swaps = readSwaps();
  for (const s of fresh) {
    const to = targets.get(s.id); if (!to) continue;
    if (!k.some((d) => d.id === s.id)) k.push({ id: s.id, url: s.url, ...(s.width ? { width: s.width, height: s.height } : {}), from: p.id });
    if (to === 'add') continue;
    let chained = false;
    for (const [a, b] of Object.entries(swaps)) if (b === to) { swaps[a] = s.id; chained = true; } // it was already in another one's place: that place
    if (!chained) swaps[to] = s.id;
    const at = k.findIndex((d) => d.id === to); if (at >= 0) k.splice(at, 1); // a kept one replaced: gone
  }
  write(KEPT_KEY, k.slice(0, DECK_MAX)); write(SWAP_KEY, swaps);
}

// ---------------- The city picker: start a city (name it) or go into one ----------------
let cp = null;
// opts: { toast, go: (cityId) => void }
export function openCityPick(opts) { if (!cp) cp = buildPick(); cp.open(opts); return cp; }
export const cityPickOpen = () => !!cp && !cp.box.hidden;
export const cityPickState = () => (cp ? cp.state() : { open: false });
function buildPick() {
  const box = el('div', { id: 'citypick' }); box.hidden = true;
  box.innerHTML = `
    <div class="th-panel cp-panel">
      <div class="th-head"><span class="th-title" id="cp-title"></span><button type="button" class="th-x" id="cp-x" aria-label="close">✕</button></div>
      <div class="cp-body" id="cp-list-view">
        <button type="button" class="cp-new" id="cp-new"><b id="cp-new-t"></b><span id="cp-new-n"></span></button>
        <ol class="cp-list" id="cp-list"></ol>
      </div>
      <div class="cp-body" id="cp-name-view" hidden>
        <div class="th-dname" id="cp-name-t"></div>
        <input id="cp-name" type="text" maxlength="32" autocomplete="off" spellcheck="false">
        <div class="th-note th-msg" id="cp-msg"></div>
        <div class="th-btns"><button type="button" class="th-big th-plain" id="cp-back"></button><button type="button" class="th-big" id="cp-go"></button></div>
      </div>
    </div>`;
  document.body.appendChild(box);
  const $ = (id) => box.querySelector('#' + id);
  const st = { opts: null, cities: null, step: 'list' };
  const close = () => { box.hidden = true; };
  const step = (s) => { st.step = s; $('cp-list-view').hidden = s !== 'list'; $('cp-name-view').hidden = s !== 'name'; if (s === 'name') $('cp-name').focus(); };
  $('cp-x').onclick = close; box.addEventListener('click', (e) => { if (e.target === box) close(); });
  trapKeys(box, () => (st.step === 'name' ? step('list') : close()));
  $('cp-new').onclick = () => { $('cp-msg').textContent = ''; step('name'); };
  $('cp-back').onclick = () => step('list');
  $('cp-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('cp-go').click(); } });
  $('cp-go').onclick = async () => {
    const name = $('cp-name').value.trim();
    if (!name) { $('cp-msg').textContent = S.cpNeedName; $('cp-name').focus(); return; }
    $('cp-go').disabled = true; $('cp-msg').textContent = S.cpMaking;
    try { const r = await api.newCity(name, myLook().name); st.opts?.go?.(r.city.id); } catch (e) { $('cp-msg').textContent = e.message || S.cpFailed; $('cp-go').disabled = false; }
  };
  async function load() {
    const list = $('cp-list'); list.textContent = ''; list.append(el('li', { className: 'cp-empty', textContent: S.cpLoading }));
    try { st.cities = (await api.cities()).cities || []; } catch { st.cities = null; }
    list.textContent = '';
    if (!st.cities) { list.append(el('li', { className: 'cp-empty', textContent: S.cpFailed })); return; }
    if (!st.cities.length) { list.append(el('li', { className: 'cp-empty', textContent: S.cpNone })); return; }
    for (const c of st.cities) {
      const b = el('button', { type: 'button', className: 'cp-city' }, [el('b', { textContent: c.name }), el('span', { textContent: S.cpFacts(c.people, c.houses.length) }), el('em', { textContent: S.cpJoin })]);
      b.dataset.id = c.id; b.onclick = () => st.opts?.go?.(c.id);
      list.append(el('li', {}, b));
    }
  }
  return {
    box,
    open(opts) {
      st.opts = opts; $('cp-title').textContent = S.cpTitle; $('cp-new-t').textContent = S.cpNew; $('cp-new-n').textContent = S.cpNewNote;
      $('cp-name-t').textContent = S.cpNameTitle; $('cp-name').placeholder = S.cpNamePlaceholder; $('cp-name').value = ''; $('cp-back').textContent = S.cpBack; $('cp-go').textContent = S.cpGo; $('cp-go').disabled = false;
      box.hidden = false; step('list'); load();
    },
    state: () => ({ open: !box.hidden, step: st.step, cities: st.cities ? st.cities.map((c) => ({ id: c.id, name: c.name, people: c.people })) : null }),
  };
}
export { PAC_LABEL };
