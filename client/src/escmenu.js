// Esc / touch menu: three (plus a few) big buttons that "spawn" when you leave the game.
// Replaces the old menu stickers (character / radio / room / door / exit / nametag).
// Desktop: Esc unlocks the pointer → this overlay pops in. Esc again or a tap on the scrim closes it
// and tries to go back into the room. Touch: the same overlay from the stack's Menu button
// (and the three bottom editing buttons still work).
// Esc priority (main.js): close the topmost panel first; only when nothing is open do we toggle
// this button row. open()/Menu refuse to appear over an open panel (closeTop).
const $ = (id) => document.getElementById(id);

export function initEscMenu({
  onSound, onAvatar, onRoom, onCity, onExit, onName,
  onClose = () => {},
  closeTop = () => false, // () => true if a panel was closed (Esc priority)
  isTouch = false,
} = {}) {
  const root = $('esc-menu');
  const scrim = $('esc-scrim');
  if (!root || !scrim) return { open() {}, close() {}, isOpen: () => false, toggle() {} };

  const actions = {
    sound: onSound,
    avatar: onAvatar,
    room: onRoom,
    city: onCity,
    exit: onExit,
    name: onName,
  };

  let open = false;
  let spawnTimer = 0;

  function setOpen(v, { resume = false } = {}) {
    const next = !!v;
    if (next === open) return;
    open = next;
    clearTimeout(spawnTimer);
    document.body.classList.toggle('esc-menu-open', open);
    root.hidden = !open;
    scrim.hidden = !open;
    root.setAttribute('aria-hidden', String(!open));
    root.classList.toggle('spawn', false);
    if (open) {
      // force reflow so the spawn animation restarts every time
      void root.offsetWidth;
      root.classList.add('spawn');
      spawnTimer = setTimeout(() => root.classList.remove('spawn'), 520);
    } else if (resume) onClose();
  }

  for (const btn of root.querySelectorAll('[data-esc]')) {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const key = btn.dataset.esc;
      const fn = actions[key];
      setOpen(false);
      try { fn?.(); } catch (err) { console.warn('esc-menu', key, err); }
    });
  }
  scrim.addEventListener('pointerdown', (e) => { e.preventDefault(); setOpen(false, { resume: true }); });

  // Touch: the stack's Menu item – same Esc priority: close top panel first, else toggle buttons.
  const sm = $('sm-esc');
  if (sm) sm.addEventListener('click', (e) => {
    e.preventDefault();
    if (closeTop()) return;
    if (open) setOpen(false, { resume: true });
    else setOpen(true);
  });

  return {
    open: () => { if (closeTop()) return; setOpen(true); },
    close: (opts) => setOpen(false, opts),
    isOpen: () => open,
    toggle: () => {
      if (closeTop()) return;
      if (open) setOpen(false, { resume: true });
      else setOpen(true);
    },
    // tests / klibb
    info: () => ({ open, touch: !!isTouch, buttons: [...root.querySelectorAll('[data-esc]')].map((b) => b.dataset.esc) }),
  };
}
