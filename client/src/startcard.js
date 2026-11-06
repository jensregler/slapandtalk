// Run-DMC start menu (Jens, 6 Nov 2026): black square, two dark-red bars, huge white type.
// Flow: Splash (SLP/TLK) → Main (NEW GAME / JOIN EXISTING) → NEW GAME (EMPTY ROOM / PRESET)
//   → PRESET list (GET /api/presets) or JOIN list (GET /api/rooms/open). BACK in the bottom bar.
// Empty room = quick create (POST /api/rooms {}). Preset = POST { preset: id }. Join = /?room=<id>.
// Code entry kept on the join screen (bottom bar). Shown for the plain address and ?start=1 (boot.js).
import { clearMineForNewRoom } from './designs.js';
import { S } from './strings.js';
import { resetPersonalSound } from './soundui.js';
import { leaveCity } from './cityleave.js';
import { isCityRoom } from '../../shared/city.mjs';
import { rollLookOnRestart } from './restartlook.js';

const ROOM_RE = /^[a-z0-9-]{1,40}$/;
const ROOM_KEYS = 'klibb.roomKeys';
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
  const backBar = (onBack) => {
    bottom.classList.add('sc-back-bar');
    const b = el('button', { type: 'button', id: 'sc-back', className: 'sc-back', textContent: 'BACK' });
    b.onclick = (e) => { e.stopPropagation(); onBack(); };
    bottom.append(b);
    bottom.onclick = (e) => { if (e.target === bottom) onBack(); };
  };

  async function makeRoom(presetId) {
    rollLookOnRestart();
    const msg = el('p', { className: 'sc-msg', id: 'sc-msg', textContent: S.scMaking });
    body.append(msg);
    try {
      const r = await fetch('/api/rooms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: presetId || false }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.room) throw new Error(data.error || `Error ${r.status}`);
      const keys = read(ROOM_KEYS) || {}; keys[data.room.id] = data.roomKey; write(ROOM_KEYS, keys);
      try { clearMineForNewRoom(); } catch { /* no storage */ }
      go(data.room.id);
    } catch (e) {
      msg.textContent = e.message || S.scFailed;
    }
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
    body.append(el('div', { className: 'sc-stack' }, [newBtn, joinBtn]));
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
    empty.onclick = () => { empty.disabled = true; preset.disabled = true; makeRoom(false); };
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
        b.onclick = () => {
          for (const x of list.querySelectorAll('button')) x.disabled = true;
          makeRoom(p.id);
        };
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
    // Bottom bar: BACK + CODE (code path kept; not on the mockup but needed for room codes)
    bottom.classList.add('sc-back-bar');
    const back = el('button', { type: 'button', id: 'sc-back', className: 'sc-back', textContent: 'BACK' });
    const code = el('button', { type: 'button', id: 'sc-code', className: 'sc-code', textContent: 'CODE' });
    back.onclick = (e) => { e.stopPropagation(); main(); };
    code.onclick = (e) => { e.stopPropagation(); codeDialog(); };
    bottom.append(back, code);
    bottom.onclick = (e) => { if (e.target === bottom) main(); };

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
        b.onclick = () => go(r.id);
        list.append(b);
      }
      list.querySelector('button')?.focus();
    })();
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
      if (isCityRoom(code)) { go(code); return; }
      ok.disabled = true; msg.textContent = '';
      try {
        const r = await fetch(`/api/rooms/recent?ids=${code}`, { cache: 'no-store' }); const a = await r.json();
        if ((a.rooms || []).some((x) => x.id === code)) { go(code); return; }
        msg.textContent = S.scCodeUnknown;
      } catch { go(code); return; }
      ok.disabled = false;
    };
  }

  splash();
  return new Promise(() => {});
}
