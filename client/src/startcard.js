// Run-DMC start menu (Jens, 6 Nov 2026): black square, two dark-red bars, huge white type.
// Flow: Splash (SLP/TLK) → Main (NEW GAME / JOIN EXISTING) → NEW GAME (EMPTY ROOM / PRESET)
//   → PRESET list or JOIN list → details (name, Instagram; room name when creating) → enter.
// Empty room = POST /api/rooms { preset:false }. Preset = POST { preset:id }. Join = /?room=<id>.
// Direct ?room= links still work (boot.js). No CODE button (t591u).
import { cleanInsta } from '../../shared/insta.mjs';
import { CITY_BUILD_PHASE, BUILD_CITY } from '../../shared/city.mjs';
import { clearMineForNewRoom } from './designs.js';
import { S } from './strings.js';
import { resetPersonalSound } from './soundui.js';
import { leaveCity } from './cityleave.js';
import { forceFreshLook } from './restartlook.js';

const ROOM_KEYS = 'klibb.roomKeys';
const LOOK_KEY = 'klibb.avatar';
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); for (const k of [].concat(kids)) e.append(k); return e; };
export const cleanCode = (s) => String(s ?? '').trim().toLowerCase().replace(/^.*[?&]room=/, '').replace(/[^a-z0-9-]/g, '').slice(0, 40);
// Join-list age as on Jens's mockup: "4d 13h 19min"
export function ageText(iso, now = Date.now()) {
  const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return '–';
  const totalMin = Math.max(0, Math.floor((now - t) / 60000));
  const d = Math.floor(totalMin / 1440), h = Math.floor((totalMin % 1440) / 60), m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h ${m}min`;
  if (h > 0) return `${h}h ${m}min`;
  if (totalMin < 1) return '0min';
  return `${m}min`;
}
const go = (id) => { location.href = `${location.pathname}?room=${encodeURIComponent(id)}`; };
const roomLine = (r) => {
  const name = r.city
    ? ('🏙 ' + (r.city.house ? S.cityHud(r.city.name, r.city.house) : r.city.name))
    : (r.name || r.id);
  return `${name} ${r.free} free spots ${r.stickers} stickers ${r.visitors} visitors ${ageText(r.createdAt)}`;
};

// Show the menu; resolves never (it navigates) – or with null if the page cannot show it.
export function showStartCard() {
  resetPersonalSound();
  leaveCity();
  document.body.classList.add('start-card-on');
  const root = el('div', { id: 'start-card', className: 'start-card' });
  document.body.appendChild(root);
  const frame = el('div', { className: 'sc-frame', role: 'dialog', ariaLabel: 'Slap and Talk menu' });
  const top = el('div', { className: 'sc-bar sc-bar-top', id: 'sc-bar-top' });
  const body = el('div', { className: 'sc-body', id: 'sc-body' });
  const bottom = el('div', { className: 'sc-bar sc-bar-bottom', id: 'sc-bar-bottom' });
  frame.append(top, body, bottom);
  root.appendChild(frame);

  let presetsP = null;
  const loadPresets = () => (presetsP ||= fetch('/api/presets', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : { presets: [] }))
    .then((j) => (Array.isArray(j.presets) ? j.presets : []))
    .catch(() => []));

  const clear = () => { body.textContent = ''; bottom.textContent = ''; bottom.onclick = null; bottom.classList.remove('sc-back-bar'); };
  const opt = (id, text, cls = '') => el('button', { type: 'button', id, className: 'sc-opt ' + cls, textContent: text });
  const backBar = (onBack, extra) => {
    bottom.classList.add('sc-back-bar');
    const b = el('button', { type: 'button', id: 'sc-back', className: 'sc-back', textContent: 'BACK' });
    b.onclick = (e) => { e.stopPropagation(); onBack(); };
    bottom.append(b);
    if (extra) bottom.append(extra);
    bottom.onclick = (e) => { if (e.target === bottom) onBack(); };
  };

  // Save name + Instagram into klibb.avatar (face lock keys off look.insta).
  function saveIdentity(name, instaRaw) {
    const saved = read(LOOK_KEY) || {};
    const insta = cleanInsta(instaRaw);
    const look = { ...(saved.look || {}) };
    if (insta) look.insta = insta; else delete look.insta;
    write(LOOK_KEY, { ...saved, name: name.trim().slice(0, 24) || saved.name || '', look });
    return look;
  }

  async function createAndEnter(presetId, roomName) {
    const msg = el('p', { className: 'sc-msg', id: 'sc-msg', textContent: S.scMaking });
    body.append(msg);
    try {
      const payload = { preset: presetId || false };
      const n = (roomName || '').trim().slice(0, 40);
      if (n) payload.name = n;
      const r = await fetch('/api/rooms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.room) throw new Error(data.error || `Error ${r.status}`);
      const keys = read(ROOM_KEYS) || {}; keys[data.room.id] = data.roomKey; write(ROOM_KEYS, keys);
      try { clearMineForNewRoom(); } catch { /* no storage */ }
      go(data.room.id);
    } catch (e) {
      msg.textContent = e.message || S.scFailed;
      return false;
    }
    return true;
  }

  // Intermediate details page (t590u): after Empty/Preset/Join choice, before entering.
  // opts: { kind:'new'|'join', presetId?, roomId?, onBack }
  function details(opts) {
    clear();
    frame.dataset.screen = 'details';
    if (opts.kind === 'new') forceFreshLook();
    const saved = read(LOOK_KEY) || {};

    const field = (id, label, value, max, extra = {}) => {
      const inp = el('input', {
        id, type: 'text', maxLength: max, value: value || '',
        autocomplete: 'off', spellcheck: false, className: 'sc-input', ...extra,
      });
      const wrap = el('label', { className: 'sc-field', htmlFor: id }, [
        el('span', { className: 'sc-field-label', textContent: label }),
        inp,
      ]);
      return [wrap, inp];
    };

    const form = el('div', { className: 'sc-form', id: 'sc-details' });
    let iRoom = null;
    if (opts.kind === 'new') {
      const [fRoom, inp] = field('sc-roomname', S.scRoomName, '', 40);
      iRoom = inp;
      form.append(fRoom);
    }
    const [fName, iName] = field('sc-name', S.scName, saved.name || '', 24, { autocomplete: 'nickname' });
    const [fInsta, iInsta] = field('sc-insta', S.scInsta, saved.look?.insta || '', 31, { autocapitalize: 'none', autocomplete: 'username' });
    form.append(fName, fInsta);
    iInsta.addEventListener('input', () => {
      const v = cleanInsta(iInsta.value);
      if (v !== iInsta.value.toLowerCase().replace(/^@+/, '')) iInsta.value = v;
    });
    const msg = el('p', { className: 'sc-msg', id: 'sc-msg' });
    form.append(msg);
    body.append(form);

    const goBtn = el('button', { type: 'button', id: 'sc-enter', className: 'sc-enter-btn', textContent: S.scEnterGo });
    backBar(opts.onBack, goBtn);

    const submit = async () => {
      if (goBtn.disabled) return;
      goBtn.disabled = true;
      saveIdentity(iName.value, iInsta.value);
      if (opts.kind === 'join') {
        go(opts.roomId);
        return;
      }
      const ok = await createAndEnter(opts.presetId || false, iRoom ? iRoom.value : '');
      if (!ok) goBtn.disabled = false;
    };
    goBtn.onclick = (e) => { e.stopPropagation(); submit(); };
    for (const i of [iRoom, iName, iInsta].filter(Boolean)) {
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    }
    (iRoom || iName).focus();
  }

  function splash() {
    clear();
    frame.dataset.screen = 'splash';
    const stack = el('div', { className: 'sc-stack sc-splash', id: 'sc-splash' }, [
      el('div', { className: 'sc-title', textContent: 'SLP' }),
      el('div', { className: 'sc-title', textContent: 'TLK' }),
    ]);
    body.append(stack);
    let gone = false;
    const advance = () => {
      if (gone) return; gone = true;
      root.removeEventListener('pointerdown', onPtr);
      root.removeEventListener('keydown', onKey);
      main();
    };
    const onPtr = (e) => { e.preventDefault(); advance(); };
    const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); advance(); } };
    root.addEventListener('pointerdown', onPtr);
    root.addEventListener('keydown', onKey);
    root.tabIndex = 0; root.focus({ preventScroll: true });
  }

  function main() {
    clear();
    frame.dataset.screen = 'main';
    const newBtn = opt('sc-new', 'NEW GAME', 'sc-opt-main');
    const joinBtn = opt('sc-join', 'JOIN EXISTING', 'sc-opt-main');
    const kids = [newBtn, joinBtn];
    // Build phase: Jens decorates stad-byggen (props + stickers autosave into the city preset).
    // Not on the Join list – only this button / its URL. Full version (OPEN_ACCESS) can place
    // props there without being admin; admin still needed in the play city.
    if (CITY_BUILD_PHASE) {
      const buildBtn = opt('sc-build', 'BUILD CITY', 'sc-opt-main');
      buildBtn.title = 'Decorate the city (props & stickers save into the city preset)';
      buildBtn.onclick = () => { location.href = `${location.pathname}?room=${encodeURIComponent(BUILD_CITY)}`; };
      kids.push(buildBtn);
    }
    body.append(el('div', { className: 'sc-stack' }, kids));
    newBtn.onclick = newGame;
    joinBtn.onclick = joinScreen;
    newBtn.focus();
  }

  function newGame() {
    clear();
    frame.dataset.screen = 'newgame';
    const empty = opt('sc-empty', 'EMPTY ROOM', 'sc-opt-main');
    const preset = opt('sc-preset', 'PRESET', 'sc-opt-main');
    body.append(el('div', { className: 'sc-stack' }, [empty, preset]));
    empty.onclick = () => details({ kind: 'new', presetId: false, onBack: newGame });
    preset.onclick = presetScreen;
    backBar(main);
    empty.focus();
  }

  function presetScreen() {
    clear();
    frame.dataset.screen = 'presets';
    body.append(el('div', { className: 'sc-heading', id: 'sc-preset-heading', textContent: 'PRESET:' }));
    const list = el('div', { className: 'sc-list-wrap', id: 'sc-preset-list' }, [
      el('p', { className: 'sc-empty', textContent: S.scLoading }),
    ]);
    body.append(list);
    backBar(newGame);
    loadPresets().then((presets) => {
      list.textContent = '';
      if (!presets.length) {
        list.append(el('p', { className: 'sc-empty', textContent: S.scNoPresets }));
        return;
      }
      for (const p of presets) {
        const label = (p.title || p.code || p.id || '').trim();
        const b = el('button', {
          type: 'button', className: 'sc-opt sc-opt-list sc-preset-item',
          textContent: label,
        });
        b.dataset.id = p.id;
        b.onclick = () => details({ kind: 'new', presetId: p.id, onBack: presetScreen });
        list.append(b);
      }
      list.querySelector('button')?.focus();
    });
  }

  function joinScreen() {
    clear();
    frame.dataset.screen = 'join';
    const list = el('div', { className: 'sc-list-wrap', id: 'sc-list' }, [
      el('p', { className: 'sc-empty', textContent: S.scLoading }),
    ]);
    body.append(list);
    backBar(main);

    (async () => {
      let rooms = [];
      try {
        const r = await fetch('/api/rooms/open', { cache: 'no-store' });
        rooms = (await r.json()).rooms || [];
      } catch { rooms = null; }
      list.textContent = '';
      if (!rooms) { list.append(el('p', { className: 'sc-empty', textContent: S.scJoinOffline })); return; }
      if (!rooms.length) { list.append(el('p', { className: 'sc-empty', textContent: S.scJoinNone })); return; }
      for (const r of rooms.slice(0, 50)) {
        const b = el('button', { type: 'button', className: 'sc-opt sc-opt-list sc-room' + (r.city ? ' sc-room-city' : '') });
        b.dataset.id = r.id;
        b.textContent = roomLine(r);
        b.onclick = () => details({ kind: 'join', roomId: r.id, onBack: joinScreen });
        list.append(b);
      }
      list.querySelector('button')?.focus();
    })();
  }

  splash();
  return new Promise(() => {});
}
