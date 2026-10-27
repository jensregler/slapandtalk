// The touch (phone) layout: the joystick bottom left and the sticker stack bottom right – nothing
// else until you ask for it. (The desktop layout does not use any of this.)
//
// - The stack (#design-btn): your stickers, the one in your hand on top. Tap = the menu fans out
//   up/left of it (two arcs + a Talk card); swipe up/down on it = next/previous sticker.
// - The menu: 📒 Stickers (the sticker book: your palette + ⬆ Upload), 🧍 Character, 🏠 Room (the
//   room's info and Room ▾ on top of ⚙ More: recording, sound, cameras …), ↩ Undo, 👤 3rd person,
//   📷 Photo, and the Talk card (💬 chat, 🎙 microphone). A tap outside closes it.
// - The held sticker floats in its holder at the bottom. There is no Slap/Look switch on touch: the
//   timer (shared/heldtimer.mjs) decides. While it is up, the editing sliders sit on the screen
//   edges: rotation on the left, size on the right (the green arrows in Jens's sketch).
import { createHeldTimer, HELD_VISIBLE_MS, HELD_FADE_MS } from '../../shared/heldtimer.mjs';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const RING = { 1: 120, 2: 210 };   // px from the stack's centre
const STACK = { right: 58, bottom: 66 }; // the stack's centre (px from the bottom-right corner)
const SIZE_TOP_CM = 400;           // the size slider's top when there is no limit (full version)

export function initStackMenu(o) {
  const { state, now = () => performance.now() } = o;
  const held = createHeldTimer();
  const body = document.body;

  // ---- Move the controls that the (hidden) panel used to hold to where they live on touch ----
  const upload = document.querySelector('#panel label.upload'); if (upload) $('book-upload').appendChild(upload);
  $('book-tray').appendChild($('tray'));
  const more = $('more-panel'); more.insertBefore($('room-box'), more.querySelector('.more-head').nextSibling);
  o.renderStack(); // the stack is there from the start, even empty
  $('design-btn').setAttribute('aria-label', o.S.stackBtnAria); $('design-btn').title = o.S.stackBtnAria;

  // ---- The fan ----
  for (const b of document.querySelectorAll('#stack-menu .sm-item')) {
    const r = RING[b.dataset.ring], a = (Number(b.dataset.ang) * Math.PI) / 180;
    b.style.right = `calc(${(STACK.right - r * Math.cos(a)).toFixed(1)}px - var(--sm-half) + env(safe-area-inset-right))`;
    b.style.bottom = `calc(${(STACK.bottom + r * Math.sin(a)).toFixed(1)}px - var(--sm-half) + env(safe-area-inset-bottom))`;
  }
  let open = false;
  function setOpen(v) {
    open = !!v;
    $('stack-menu').hidden = !open; $('stack-scrim').hidden = !open;
    body.classList.toggle('stack-open', open);
    $('design-btn').setAttribute('aria-expanded', String(open));
    if (open) { closeBook(); held.keepAlive(now()); }
  }
  const closeMenu = () => setOpen(false);
  // a menu option: close the fan, then do it
  const item = (id, fn, { stay = false } = {}) => { $(id).onclick = (e) => { e.preventDefault(); if (!stay) closeMenu(); fn(); }; };
  item('sm-book', () => openBook());
  item('sm-avatar', () => $('my-avatar').click());
  item('sm-room', () => o.openMore());
  item('sm-undo', () => o.peelLast(), { stay: true }); // undo again and again
  item('sm-view', () => o.toggleView());
  item('sm-photo', () => o.snapPhoto());
  item('sm-chat', () => { if (!o.chatOpen()) $('chat-btn').click(); });
  $('stack-scrim').addEventListener('pointerdown', (e) => { e.preventDefault(); closeMenu(); });

  // ---- The stack: tap = menu, swipe up/down = next/previous sticker ----
  let swipe = null, swiped = false;
  const stack = $('design-btn');
  stack.addEventListener('pointerdown', (e) => { swipe = { y: e.clientY, x: e.clientX }; swiped = false; });
  stack.addEventListener('pointerup', (e) => {
    if (!swipe) return;
    const dy = e.clientY - swipe.y, dx = e.clientX - swipe.x; swipe = null;
    if (Math.abs(dy) > 28 && Math.abs(dy) > Math.abs(dx)) {
      swiped = true;
      if (open) closeMenu();
      if (dy < 0 ? o.nextDesign() : o.prevDesign()) chosen();
    }
  });
  stack.addEventListener('pointercancel', () => { swipe = null; });
  stack.onclick = (e) => { e.preventDefault(); if (swiped) { swiped = false; return; } setOpen(!open); };

  // ---- The sticker book (a sheet): the palette + ⬆ Upload ----
  function openBook() { o.closeMore(); $('sticker-book').hidden = false; body.classList.add('book-open'); }
  function closeBook() { $('sticker-book').hidden = true; body.classList.remove('book-open'); }
  $('book-close').onclick = () => closeBook();
  // Picking a sticker in the book = holding it (capture: before the thumbnail's own click, so a
  // long press – star/× – is not a pick).
  $('tray').addEventListener('click', (e) => {
    if (!e.target.closest('.pick') || o.longPressed()) return;
    setTimeout(() => { closeBook(); chosen(); }, 0);
  }, true);

  // ---- The editing sliders: rotation (left edge), size (right edge) ----
  const sizeRange = () => { const lo = o.minSizeCm(), hi = Number.isFinite(o.maxSizeCm()) ? o.maxSizeCm() : SIZE_TOP_CM; return [lo, Math.max(hi, lo + 1)]; };
  const edges = {
    rot: { el: $('edge-rot'), get: () => (state.rotation + 180) / 360, set: (v) => o.setRot(Math.round(v * 360 - 180)) },
    size: {
      el: $('edge-size'),
      get: () => { const [lo, hi] = sizeRange(); return clamp(Math.log((state.size * 100) / lo) / Math.log(hi / lo), 0, 1); },
      set: (v) => { const [lo, hi] = sizeRange(); o.setSize(lo * Math.pow(hi / lo, v)); },
    },
  };
  for (const ed of Object.values(edges)) {
    const track = ed.el.querySelector('.edge-track');
    const at = (e) => { const r = track.getBoundingClientRect(); ed.set(clamp(1 - (e.clientY - r.top) / r.height, 0, 1)); held.keepAlive(now()); };
    ed.el.addEventListener('pointerdown', (e) => {
      if (Number(getComputedStyle(ed.el).opacity) < 0.5) return;
      e.preventDefault(); e.stopPropagation(); try { ed.el.setPointerCapture(e.pointerId); } catch { /* synthetic */ } ed.drag = true; at(e);
    });
    ed.el.addEventListener('pointermove', (e) => { if (ed.drag) at(e); });
    const end = () => { ed.drag = false; };
    ed.el.addEventListener('pointerup', end); ed.el.addEventListener('pointercancel', end);
  }

  // ---- The held sticker and the sliders follow the timer (every frame) ----
  let last = '';
  function render() {
    const t = now(), sel = state.selected;
    const op = sel ? held.opacity(t) : 0;
    const cm = Math.round(state.size * 200) / 2, rot = state.rotation;
    const key = [sel?.url, op.toFixed(3), cm, rot, open].join();
    if (key !== last) {
      last = key;
      const h = $('held');
      if (sel && $('held-img').getAttribute('src') !== sel.url) $('held-img').src = sel.url;
      const px = clamp(40 + 9 * Math.sqrt(cm), 64, 150);
      h.style.setProperty('--held-px', `${px.toFixed(0)}px`); h.style.setProperty('--held-rot', `${rot}deg`);
      h.style.opacity = String(op); h.classList.toggle('up', op > 0);
      for (const [k, ed] of Object.entries(edges)) {
        ed.el.style.opacity = String(op); ed.el.classList.toggle('up', op > 0.5);
        ed.el.querySelector('.edge-thumb').style.bottom = `${(ed.get() * 100).toFixed(2)}%`;
        ed.el.querySelector('.edge-fill').style.height = `${(ed.get() * 100).toFixed(2)}%`;
        ed.el.querySelector('.edge-val').textContent = k === 'rot' ? `${rot}°` : `${cm.toLocaleString(o.locale)} cm`;
        ed.el.setAttribute('aria-valuenow', String(k === 'rot' ? rot : cm));
      }
      body.classList.toggle('held-faded', op === 0);
    }
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  // a sticker was chosen (book, swipe, upload): sharp in the holder until it is placed
  function chosen() { held.choose(now()); }

  // Mirror the chat's unread count onto the Talk card.
  new MutationObserver(() => { $('sm-unread').textContent = $('chat-unread').textContent; }).observe($('chat-unread'), { childList: true, characterData: true, subtree: true });

  return {
    held, chosen,
    // A tap on the 3D view: 'slap' (sharp – place it) or 'wake' (it was fading/faded – only bring it back).
    tap() { return held.tap(now()); },
    placed() { held.placed(now()); },
    open: () => setOpen(true), close: closeMenu, isOpen: () => open, openBook, closeBook, bookOpen: () => !$('sticker-book').hidden,
    info() {
      const t = now(), vis = (id) => { const el = $(id); return !!el && el.getClientRects().length > 0 && Number(getComputedStyle(el).opacity) > 0.01; };
      return { ...held.info(t), visibleMs: HELD_VISIBLE_MS, fadeMs: HELD_FADE_MS, menuOpen: open, bookOpen: !$('sticker-book').hidden,
        heldShown: vis('held'), heldOpacity: Number($('held').style.opacity || 0), edges: { rot: vis('edge-rot'), size: vis('edge-size') } };
    },
  };
}
