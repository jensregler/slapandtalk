// The start card (Jens, 31 Oct 2026): a Priority Mail card (his picture: Dropbox /Ulla/knappar/menue.png,
// client/public/start/card.webp) instead of going straight into a room. Shown for the plain address
// and for ?start=1 (the exit sticker's "Exit to menu"); boot.js, before main.js.
//   enter new room       → a second card: name?, instagram @:, roomname?  [back] [save and enter]
//   …or I have a code    → a code dialog (the room's code = its id in the address)
//   …or Join             → the rooms with people in them now AND a free spot (GET /api/rooms/open):
//                          room name, free spots, stickers, visitors, how long it has existed
// Choosing one loads /?room=<id> (a fresh page: main.js then opens that room).
import AV from '../../shared/avatar.json' with { type: 'json' };
import { cleanInsta } from '../../shared/insta.mjs';
import { clearMineForNewRoom } from './designs.js';
import { S } from './strings.js';

const ROOM_RE = /^[a-z0-9-]{1,40}$/;
const LOOK_KEY = 'klibb.avatar', ROOM_KEYS = 'klibb.roomKeys';
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const any = (l) => l[Math.floor(Math.random() * l.length)];
const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); for (const k of [].concat(kids)) e.append(k); return e; };
export const cleanCode = (s) => String(s ?? '').trim().toLowerCase().replace(/^.*[?&]room=/, '').replace(/[^a-z0-9-]/g, '').slice(0, 40);
export function ageText(iso, now = Date.now()) {
  const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return '–';
  return S.roomAge(now - t);
}
const go = (id) => { location.href = `${location.pathname}?room=${encodeURIComponent(id)}`; };

// Show the card; resolves never (it navigates) – or with null if the page cannot show it.
export function showStartCard() {
  document.body.classList.add('start-card-on');
  const root = el('div', { id: 'start-card', className: 'start-card' });
  document.body.appendChild(root);
  const card = el('div', { className: 'sc-paper' });
  root.appendChild(card);

  function first() {
    card.textContent = '';
    const enter = el('button', { type: 'button', className: 'sc-big sc-enter', id: 'sc-new' }, [el('span', { className: 'sc-hand', textContent: S.scEnter }), el('span', { className: 'sc-sub', textContent: S.scNewRoom })]);
    const code = el('button', { type: 'button', className: 'sc-mid', id: 'sc-code', textContent: S.scHaveCode });
    const join = el('button', { type: 'button', className: 'sc-big sc-join', id: 'sc-join' }, [el('span', { className: 'sc-hand', textContent: S.scJoin })]);
    const list = el('ol', { className: 'sc-list', id: 'sc-list' });
    card.append(el('div', { className: 'sc-body' }, [enter, code, join, list]));
    enter.onclick = second; code.onclick = codeDialog; join.onclick = () => loadJoin(list, true);
    loadJoin(list, false);
  }
  async function loadJoin(list, focus) {
    list.textContent = ''; list.append(el('li', { className: 'sc-empty', textContent: S.scLoading }));
    let rooms = [];
    try { const r = await fetch('/api/rooms/open', { cache: 'no-store' }); rooms = (await r.json()).rooms || []; } catch { rooms = null; }
    list.textContent = '';
    if (!rooms) { list.append(el('li', { className: 'sc-empty', textContent: S.scJoinOffline })); return; }
    if (!rooms.length) { list.append(el('li', { className: 'sc-empty', textContent: S.scJoinNone })); return; }
    for (const r of rooms.slice(0, 8)) {
      const b = el('button', { type: 'button', className: 'sc-room' });
      b.dataset.id = r.id;
      b.append(el('b', { textContent: r.name || r.id }), el('span', { textContent: S.scRoomFacts(r.free, r.stickers, r.visitors, ageText(r.createdAt)) }));
      b.onclick = () => go(r.id);
      list.append(el('li', {}, b));
    }
    if (focus) list.querySelector('button')?.focus();
  }
  function second() {
    card.textContent = '';
    const saved = read(LOOK_KEY) || {};
    const field = (id, label, value, max, extra = {}) => {
      const inp = el('input', { id, type: 'text', maxLength: max, value: value || '', autocomplete: 'off', spellcheck: false, ...extra });
      return [el('label', { className: 'sc-field', htmlFor: id }, [el('span', { textContent: label }), inp]), inp];
    };
    const [fName, iName] = field('sc-name', S.scName, saved.name, 24, { autocomplete: 'nickname' });
    const [fInsta, iInsta] = field('sc-insta', S.scInsta, saved.look?.insta, 31, { autocapitalize: 'none' });
    const [fRoom, iRoom] = field('sc-roomname', S.scRoomName, '', 40);
    iInsta.addEventListener('input', () => { const v = cleanInsta(iInsta.value); if (v !== iInsta.value.toLowerCase().replace(/^@+/, '')) iInsta.value = v; });
    const msg = el('p', { className: 'sc-msg', id: 'sc-msg' });
    const back = el('button', { type: 'button', className: 'sc-foot', id: 'sc-back', textContent: S.scBack });
    const save = el('button', { type: 'button', className: 'sc-foot sc-go', id: 'sc-save', textContent: S.scSaveEnter });
    card.append(el('div', { className: 'sc-body sc-form' }, [fName, fInsta, fRoom, msg]), el('div', { className: 'sc-feet' }, [back, save]));
    back.onclick = first;
    for (const i of [iName, iInsta, iRoom]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save.click(); } });
    iName.focus();
    save.onclick = async () => {
      save.disabled = true; msg.textContent = S.scMaking;
      // the name and the Instagram name go with my avatar (the same place My avatar saves them)
      const name = iName.value.trim().slice(0, 24), insta = cleanInsta(iInsta.value);
      const look = { ...(saved.look || { outfit: any(Object.keys(AV.outfits)), hair: any(Object.keys(AV.hair)), shirt: any(AV.colors.shirt), pants: any(AV.colors.pants), hairColor: any(AV.colors.hair), skin: any(AV.colors.skin), hat: false, hatColor: any(AV.colors.hat) }) };
      if (insta) look.insta = insta; else delete look.insta;
      write(LOOK_KEY, { ...saved, name: name || saved.name || '', look });
      try {
        const r = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(iRoom.value.trim() ? { name: iRoom.value.trim() } : {}) });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.room) throw new Error(data.error || `Error ${r.status}`);
        const keys = read(ROOM_KEYS) || {}; keys[data.room.id] = data.roomKey; write(ROOM_KEYS, keys);
        try { clearMineForNewRoom(); } catch { /* no storage */ }
        go(data.room.id);
      } catch (e) { msg.textContent = e.message || S.scFailed; save.disabled = false; }
    };
  }
  function codeDialog() {
    const dlg = el('dialog', { id: 'sc-code-dialog', className: 'sc-dialog' });
    const inp = el('input', { id: 'sc-code-input', type: 'text', maxLength: 200, autocomplete: 'off', autocapitalize: 'none', spellcheck: false, placeholder: S.scCodePlaceholder });
    const msg = el('p', { className: 'sc-msg', id: 'sc-code-msg' });
    const ok = el('button', { type: 'button', className: 'sc-foot sc-go', id: 'sc-code-go', textContent: S.scCodeGo });
    const cancel = el('button', { type: 'button', className: 'sc-foot', id: 'sc-code-cancel', textContent: S.scBack });
    dlg.append(el('h2', { textContent: S.scCodeTitle }), inp, msg, el('div', { className: 'sc-feet' }, [cancel, ok]));
    root.appendChild(dlg); dlg.showModal(); inp.focus();
    cancel.onclick = () => { dlg.close(); dlg.remove(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } });
    ok.onclick = async () => {
      const code = cleanCode(inp.value);
      if (!ROOM_RE.test(code)) { msg.textContent = S.scCodeBad; return; }
      if (code === 'stad') { go(code); return; }
      ok.disabled = true; msg.textContent = '';
      try {
        const r = await fetch(`/api/rooms/recent?ids=${code}`, { cache: 'no-store' }); const a = await r.json();
        if ((a.rooms || []).some((x) => x.id === code)) { go(code); return; }
        msg.textContent = S.scCodeUnknown;
      } catch { go(code); return; } // offline check: just try it
      ok.disabled = false;
    };
  }
  first();
  return new Promise(() => {});
}
