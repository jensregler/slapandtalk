// The touch (phone) layout: the joystick bottom left and the sticker stack bottom right – nothing
// else until you ask for it. (The desktop layout does not use any of this.)
//
// - The stack (#design-btn): your stickers, the one in your hand on top. Tap = the menu fans out
//   up/left of it (two arcs + a Talk card); swipe up/down on it = next/previous sticker; swipe it
//   sideways = turn the sticker wheel (a band above the stack, up while you turn it; wheel.js).
// - The menu: 📒 Stickers (the sticker book: your palette + ⬆ Upload), 🧍 Character, 🏠 Room (the
//   room's info and Room ▾ on top of ⚙ More: recording, sound, cameras …), ↩ Undo, 👤 3rd person,
//   📷 Photo, and the Talk card (💬 chat, 🎙 microphone). A tap outside closes it.
// - The editing view (Jens's picture 4): the held sticker sits in its holder (no ring) in the middle of the
//   screen, sharp; the green sliders on the edges: rotation on the left, size on the right; the three
//   menu buttons (📒 Stickers, 🧍 Character, 🏠 Room) stay lit at the bottom; everything else is
//   hidden (💬/🎙 are on the menu's Talk card). Release it from the holder: tap it (it slaps where
//   it is, the middle of the screen) or drag it out and let go where it should go; or put a finger on
//   the room: it aims the sticker there (the preview follows the finger) and letting go stamps it
//   there (main.js, the touch input).
// - There is no Slap/Look switch on touch: the timer (shared/heldtimer.mjs) decides.
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
  const lib = $('lib-box'); if (lib) { $('book-tray').appendChild(lib); lib.open = true; } // all stickers, open in the book
  const nat = $('nature-box'); if (nat) { $('book-tray').appendChild(nat); nat.open = true; } // 🌿 Nature (locked in the free version)
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

  // ---- The stack: tap = menu, swipe up/down = next/previous sticker, swipe sideways = turn the
  //      sticker wheel (main.js / wheel.js: the band comes up above the stack and follows the finger) ----
  let swipe = null, swiped = false;
  const stack = $('design-btn');
  stack.addEventListener('pointerdown', (e) => { swipe = { y: e.clientY, x: e.clientX, wheel: false }; swiped = false; });
  stack.addEventListener('pointermove', (e) => {
    if (!swipe || !o.wheel) return;
    const dy = e.clientY - swipe.y, dx = e.clientX - swipe.x;
    if (!swipe.wheel && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      swipe.wheel = true; if (open) closeMenu();
      o.wheelUp?.(); o.wheel.beginDrag(swipe.x);
    }
    if (swipe.wheel) o.wheel.dragTo(e.clientX);
  });
  stack.addEventListener('pointerup', (e) => {
    if (!swipe) return;
    const dy = e.clientY - swipe.y, dx = e.clientX - swipe.x, wasWheel = swipe.wheel; swipe = null;
    if (wasWheel) { swiped = true; o.wheel.endDrag(); chosen(); return; }
    if (Math.abs(dy) > 28 && Math.abs(dy) > Math.abs(dx)) {
      swiped = true;
      if (open) closeMenu();
      if (dy < 0 ? o.nextDesign() : o.prevDesign()) chosen();
    }
  });
  stack.addEventListener('pointercancel', () => { if (swipe?.wheel) o.wheel.endDrag(); swipe = null; });
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
  $('naturetray')?.addEventListener('click', (e) => { // a nature sticker (full version; free: the full version panel opens instead)
    if (!e.target.closest('.pick') || !o.natureOpen?.()) return;
    setTimeout(() => { closeBook(); chosen(); }, 0);
  }, true);
  $('libtray')?.addEventListener('click', (e) => { // a library sticker: same as picking one of mine
    if (!e.target.closest('.pick')) return;
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
      body.classList.toggle('editing', op > 0 && !open); // picture 4: holder + sliders + the three buttons
    }
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  // ---- Release from the holder: tap it, or drag it out and let go over the spot ----
  const hold = $('held'); let rel = null;
  hold.addEventListener('pointerdown', (e) => {
    if (!hold.classList.contains('up')) return;
    e.preventDefault(); e.stopPropagation(); try { hold.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    rel = { id: e.pointerId, x: e.clientX, y: e.clientY, t: now() }; hold.classList.add('dragging');
  });
  hold.addEventListener('pointermove', (e) => {
    if (!rel || e.pointerId !== rel.id) return;
    hold.style.setProperty('--dx', `${e.clientX - rel.x}px`); hold.style.setProperty('--dy', `${e.clientY - rel.y}px`);
  });
  const letGo = (e, ok) => {
    if (!rel || e.pointerId !== rel.id) return;
    rel = null; hold.classList.remove('dragging'); hold.style.setProperty('--dx', '0px'); hold.style.setProperty('--dy', '0px');
    if (ok) o.release(e.clientX, e.clientY);
  };
  hold.addEventListener('pointerup', (e) => letGo(e, true));
  hold.addEventListener('pointercancel', (e) => letGo(e, false));

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
        editing: body.classList.contains('editing'), heldRect: $('held').getBoundingClientRect().toJSON(),
        heldShown: vis('held'), heldOpacity: Number($('held').style.opacity || 0), edges: { rot: vis('edge-rot'), size: vis('edge-size') } };
    },
  };
}
