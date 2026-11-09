// Landing → name a new city → enter that city (Jens, Nov 2026).
// Bare slapandtalk.com / ?start=1: SLP/TLK art only (no menus/buttons). One click anywhere
// (desktop), Enter, or tap (touch) opens one big "NAME THE NEW CITY" field; Enter confirms
// (empty → random default) and POST /api/cities, then the boot continues straight into that
// city (outside, no room/door/pac intro) without a full reload so the same gesture can unlock
// WebAudio. Direct ?room= / city links still skip this (boot.js). Esc CITY / door remain.
import { S } from './strings.js';
import { resetPersonalSound } from './soundui.js';
import { leaveCity } from './cityleave.js';
import { forceFreshLook } from './restartlook.js';

const LOOK_KEY = 'klibb.avatar';
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); for (const k of [].concat(kids)) e.append(k); return e; };
export const cleanCode = (s) => String(s ?? '').trim().toLowerCase().replace(/^.*[?&]room=/, '').replace(/[^a-z0-9-]/g, '').slice(0, 40);
// Join-list age as on Jens's mockup: "4d 13h 19min" (still used by Esc CITY join / open-rooms API).
export function ageText(iso, now = Date.now()) {
  const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return '–';
  const totalMin = Math.max(0, Math.floor((now - t) / 60000));
  const d = Math.floor(totalMin / 1440), h = Math.floor((totalMin % 1440) / 60), m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h ${m}min`;
  if (h > 0) return `${h}h ${m}min`;
  if (totalMin < 1) return '0min';
  return `${m}min`;
}

// Fun defaults when the name field is left empty (server still requires a non-empty name).
const CITY_NAME_DEFAULTS = [
  'Slapville', 'Stickerton', 'Peeltown', 'Talkburg', 'Klisterköping',
  'Wallonia', 'Glue Creek', 'Stamp City', 'Posterberg', 'Slap & Co',
];
export function defaultCityName(rnd = Math.random) {
  return CITY_NAME_DEFAULTS[Math.floor(rnd() * CITY_NAME_DEFAULTS.length) % CITY_NAME_DEFAULTS.length];
}

const isTouch = () => {
  try { return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints || 0) > 0; }
  catch { return false; }
};

// Sync inside click/Enter/tap so WebAudio is allowed; Sounds.ensure() reuses window.__klibbAudioCtx.
function primeAudioFromGesture() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    let ctx = window.__klibbAudioCtx;
    if (!ctx || ctx.state === 'closed') {
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch { try { ctx = new AC(); } catch { return null; } }
      window.__klibbAudioCtx = ctx;
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch { return null; }
}

// Original Slap-and-Talk startup jingle (same file videocomposer.js mixes into finished videos:
// client/src/videocomposer.js:6 and :65 — /intro/sat-intro-ljud.wav). Preload on splash advance
// (gesture already primed WebAudio); play when the city name is confirmed.
let startupJingleBuf = null;
let startupJingleLoading = null;
function preloadStartupJingle() {
  try {
    const ctx = primeAudioFromGesture();
    if (!ctx || startupJingleLoading) return startupJingleLoading;
    startupJingleLoading = fetch('/intro/sat-intro-ljud.wav')
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('jingle ' + r.status))))
      .then((buf) => new Promise((res, rej) => ctx.decodeAudioData(buf.slice(0), res, rej)))
      .then((audio) => { startupJingleBuf = audio; return audio; })
      .catch(() => null);
    return startupJingleLoading;
  } catch { return null; }
}
function playStartupJingle() {
  try {
    const ctx = primeAudioFromGesture();
    if (!ctx) return;
    const go = (audio) => {
      if (!audio) return;
      try {
        const src = ctx.createBufferSource();
        src.buffer = audio;
        src.connect(ctx.destination);
        src.start(0);
        window.__klibbStartupJingle = true;
      } catch { /* fine */ }
    };
    if (startupJingleBuf) go(startupJingleBuf);
    else {
      const p = preloadStartupJingle();
      if (p && p.then) p.then(go);
    }
  } catch { /* fine */ }
}

// Show the landing; resolves with { cityId } once the city URL is set (boot.js then loads main).
export function showStartCard() {
  resetPersonalSound();
  leaveCity();
  document.body.classList.add('start-card-on');
  const root = el('div', { id: 'start-card', className: 'start-card' });
  document.body.appendChild(root);
  const frame = el('div', { className: 'sc-frame', role: 'dialog', ariaLabel: 'Slap and Talk' });
  const top = el('div', { className: 'sc-bar sc-bar-top', id: 'sc-bar-top' });
  const body = el('div', { className: 'sc-body', id: 'sc-body' });
  const bottom = el('div', { className: 'sc-bar sc-bar-bottom', id: 'sc-bar-bottom' });
  frame.append(top, body, bottom);
  root.appendChild(frame);

  const clear = () => { body.textContent = ''; bottom.textContent = ''; bottom.onclick = null; bottom.classList.remove('sc-back-bar'); };

  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });

  function teardown() {
    document.body.classList.remove('start-card-on');
    root.remove();
  }

  async function enterCity(name) {
    const msg = body.querySelector('#sc-msg') || el('p', { className: 'sc-msg', id: 'sc-msg' });
    if (!msg.parentNode) body.append(msg);
    msg.textContent = S.scMakingCity || S.cpMaking || 'Starting your city…';
    forceFreshLook();
    const saved = read(LOOK_KEY) || {};
    const by = (saved.name || '').trim().slice(0, 24) || undefined;
    try {
      const r = await fetch('/api/cities', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ...(by ? { by } : {}) }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.city) throw new Error(data.error || `Error ${r.status}`);
      const id = data.city.id;
      const q = new URLSearchParams(location.search);
      q.delete('start');
      q.set('room', id);
      history.replaceState(history.state, '', `${location.pathname}?${q}${location.hash}`);
      teardown();
      resolveDone({ cityId: id });
    } catch (e) {
      msg.textContent = e.message || S.cpFailed || S.scFailed;
      return false;
    }
    return true;
  }

  function nameCity() {
    clear();
    frame.dataset.screen = 'namecity';
    const suggested = defaultCityName();
    const label = el('div', { className: 'sc-heading', id: 'sc-city-heading', textContent: S.scCityNameTitle || 'NAME THE NEW CITY' });
    const inp = el('input', {
      id: 'sc-cityname', type: 'text', maxLength: 32, value: '',
      placeholder: suggested,
      autocomplete: 'off', spellcheck: false, className: 'sc-input sc-city-input',
      autocapitalize: 'words',
    });
    const msg = el('p', { className: 'sc-msg', id: 'sc-msg' });
    const form = el('div', { className: 'sc-form sc-city-form', id: 'sc-city-form' }, [label, inp, msg]);
    body.append(form);

    // Touch has no physical Enter: a very discreet confirm on the red bar (not a menu button).
    if (isTouch()) {
      bottom.classList.add('sc-back-bar');
      const go = el('button', { type: 'button', id: 'sc-city-go', className: 'sc-enter-btn sc-city-go', textContent: S.scCityGo || 'ENTER' });
      go.onclick = (e) => { e.stopPropagation(); submit(); };
      bottom.append(go);
    } else {
      // Desktop discoverability: tiny hint only (no button).
      const hint = el('div', { className: 'sc-enter-hint', id: 'sc-enter-hint', textContent: S.scEnterHint || 'click / Enter ↵' });
      bottom.append(hint);
    }

    // The splash advance used pointerdown; the same gesture's click must not also hit ENTER /
    // submit and skip the name screen. Arm submit only after the current pointer gesture ends.
    let armed = false;
    const arm = () => { armed = true; };
    const armAfterGesture = () => {
      const done = () => {
        window.removeEventListener('pointerup', done, true);
        window.removeEventListener('pointercancel', done, true);
        window.removeEventListener('keyup', done, true);
        setTimeout(arm, 0);
      };
      window.addEventListener('pointerup', done, true);
      window.addEventListener('pointercancel', done, true);
      window.addEventListener('keyup', done, true);
      // Enter-key advance has no pointerup – arm on next macrotask as fallback.
      setTimeout(arm, 50);
    };
    armAfterGesture();

    let busy = false;
    const submit = async () => {
      if (!armed || busy) return;
      busy = true;
      primeAudioFromGesture();
      playStartupJingle(); // sat-intro-ljud.wav — videocomposer.js:65 / :6
      const typed = inp.value.trim();
      const name = typed || inp.placeholder || defaultCityName();
      const ok = await enterCity(name);
      if (!ok) busy = false;
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    // Esc on the name screen goes nowhere special (stay); Build-city URL still works via ?room=.
    inp.focus({ preventScroll: true });
  }

  function splash() {
    clear();
    frame.dataset.screen = 'splash';
    const stack = el('div', { className: 'sc-stack sc-splash', id: 'sc-splash' }, [
      el('div', { className: 'sc-title', textContent: 'SLP' }),
      el('div', { className: 'sc-title', textContent: 'TLK' }),
    ]);
    body.append(stack);
    // Subtle discoverability only – no menu, no button. Desktop: click or Enter; touch: tap.
    const hint = el('div', { className: 'sc-enter-hint', id: 'sc-enter-hint', textContent: isTouch() ? (S.scTapHint || 'tap') : (S.scEnterHint || 'click / Enter ↵') });
    bottom.append(hint);

    let gone = false;
    const advance = () => {
      if (gone) return; gone = true;
      primeAudioFromGesture();
      preloadStartupJingle();
      root.removeEventListener('pointerdown', onPtr);
      root.removeEventListener('keydown', onKey);
      nameCity();
    };
    const onPtr = (e) => {
      // Desktop mouse click, pen, or touch anywhere advances (left button only for mouse).
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      advance();
    };
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); advance(); }
    };
    root.addEventListener('pointerdown', onPtr);
    root.addEventListener('keydown', onKey);
    root.tabIndex = 0; root.focus({ preventScroll: true });
  }

  splash();
  return done;
}
