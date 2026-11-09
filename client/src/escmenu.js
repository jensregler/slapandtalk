// Esc / touch menu: big buttons that "spawn" when you leave the game.
// CREATE → STICKERS / STICKER PACK submenu. CITY → Create new city / Join existing submenu;
// Join existing shows the live-city list. Esc closes the topmost submenu first (escTopPanel).
const $ = (id) => document.getElementById(id);

export function initEscMenu({
  onSound, onAvatar, onRoom, onCity, onExit, onCreate,
  onStickers, onStickerPack,
  onCreateCity, onPickCity,
  formatCity = (c) => c, // enrich with ageText / facts for the Join list
  onClose = () => {},
  closeTop = () => false,
  isTouch = false,
  hideCreate = false, // optional: hide CREATE / STICKERS / STICKER PACK (unused; city has CREATE again)
} = {}) {
  const root = $('esc-menu');
  const scrim = $('esc-scrim');
  if (!root || !scrim) {
    return { open() {}, close() {}, isOpen: () => false, toggle() {}, submenuOpen: () => false, closeSubmenu() {}, info: () => ({ open: false }) };
  }

  const mainActions = {
    sound: onSound,
    avatar: onAvatar,
    room: onRoom,
    city: onCity, // unused when city opens submenu; kept for tests
    exit: onExit,
    create: onCreate,
  };
  const subActions = {
    stickers: onStickers,
    stickerpack: onStickerPack,
    createcity: onCreateCity,
  };
  const pickCity = onPickCity;

  let open = false;
  // false | 'create' | 'city' | 'cityjoin'
  let view = 'main';
  let spawnTimer = 0;
  let joinCities = null;

  function setView(next) {
    view = next || 'main';
    root.dataset.view = view;
    root.classList.toggle('esc-submenu', view !== 'main');
    root.classList.toggle('esc-cityjoin', view === 'cityjoin');
    for (const btn of root.querySelectorAll('[data-esc]')) {
      const g = btn.dataset.escGroup || 'main';
      if (view === 'main') btn.hidden = g !== 'main';
      else if (view === 'create') btn.hidden = g !== 'create';
      else if (view === 'city') btn.hidden = g !== 'city';
      else btn.hidden = true; // cityjoin: buttons hidden, list shown
    }
    const list = $('esc-city-list');
    if (list) list.hidden = view !== 'cityjoin';
    if (view !== 'main') {
      root.classList.remove('spawn');
      void root.offsetWidth;
      root.classList.add('spawn');
      clearTimeout(spawnTimer);
      spawnTimer = setTimeout(() => root.classList.remove('spawn'), 520);
    }
  }

  function setOpen(v, { resume = false } = {}) {
    const next = !!v;
    if (next === open) {
      if (!next) setView('main');
      return;
    }
    open = next;
    clearTimeout(spawnTimer);
    document.body.classList.toggle('esc-menu-open', open);
    root.hidden = !open;
    scrim.hidden = !open;
    root.setAttribute('aria-hidden', String(!open));
    root.classList.toggle('spawn', false);
    if (!open) setView('main');
    if (open) {
      setView('main');
      // hideCreate can still suppress CREATE (tests / special modes).
      const createBtn = root.querySelector('[data-esc="create"]');
      if (createBtn) createBtn.hidden = !!hideCreate;
      void root.offsetWidth;
      root.classList.add('spawn');
      spawnTimer = setTimeout(() => root.classList.remove('spawn'), 520);
    } else if (resume) onClose();
  }

  function closeSubmenu() {
    if (view === 'cityjoin') setView('city');
    else if (view !== 'main') setView('main');
  }

  async function showJoinList() {
    setView('cityjoin');
    const list = $('esc-city-list');
    if (!list) return;
    list.innerHTML = `<div class="esc-city-empty" data-t-keep>${list.dataset.loading || 'Looking for cities…'}</div>`;
    try {
      const r = await fetch('/api/cities', { cache: 'no-store' });
      const d = await r.json();
      joinCities = (d.cities || []).map((c) => formatCity(c));
    } catch {
      joinCities = null;
      list.innerHTML = `<div class="esc-city-empty">${list.dataset.failed || 'Could not fetch the cities.'}</div>`;
      return;
    }
    renderJoinList();
  }

  function renderJoinList() {
    const list = $('esc-city-list');
    if (!list) return;
    list.textContent = '';
    if (!joinCities || !joinCities.length) {
      list.innerHTML = `<div class="esc-city-empty">${list.dataset.none || 'No cities right now'}</div>`;
      return;
    }
    for (const c of joinCities) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'esc-city-row';
      b.dataset.id = c.id;
      const age = list.dataset.ageFn ? '' : (c.ageText || '');
      b.innerHTML = `<b class="esc-city-name"></b><span class="esc-city-facts"></span>`;
      b.querySelector('.esc-city-name').textContent = c.name || c.id;
      b.querySelector('.esc-city-facts').textContent = c.facts || `${c.stickers ?? 0} stickers · ${c.visitors ?? 0} visitors · ${c.ageText || '–'}`;
      b.addEventListener('click', (e) => {
        e.preventDefault();
        setOpen(false);
        try { pickCity?.(c); } catch (err) { console.warn('esc-menu pickcity', err); }
      });
      list.appendChild(b);
    }
  }

  for (const btn of root.querySelectorAll('[data-esc]')) {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const key = btn.dataset.esc;
      if (key === 'create') {
        if (hideCreate) return;
        setView('create'); try { mainActions.create?.(); } catch (err) { console.warn('esc-menu', key, err); } return;
      }
      if (key === 'city') { setView('city'); try { mainActions.city?.(); } catch (err) { console.warn('esc-menu', key, err); } return; }
      if (key === 'joincity') { showJoinList(); return; }
      if (key === 'createcity') {
        setOpen(false);
        try { subActions.createcity?.(); } catch (err) { console.warn('esc-menu', key, err); }
        return;
      }
      if (subActions[key]) {
        setOpen(false);
        try { subActions[key]?.(); } catch (err) { console.warn('esc-menu', key, err); }
        return;
      }
      const fn = mainActions[key];
      setOpen(false);
      try { fn?.(); } catch (err) { console.warn('esc-menu', key, err); }
    });
  }
  scrim.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (view !== 'main') { closeSubmenu(); return; }
    setOpen(false, { resume: true });
  });

  const sm = $('sm-esc');
  if (sm) sm.addEventListener('click', (e) => {
    e.preventDefault();
    if (closeTop()) return;
    if (view !== 'main') { closeSubmenu(); return; }
    if (open) setOpen(false, { resume: true });
    else setOpen(true);
  });

  return {
    open: () => { if (closeTop()) return; setOpen(true); },
    close: (opts) => setOpen(false, opts),
    isOpen: () => open,
    submenuOpen: () => open && view !== 'main',
    closeSubmenu,
    showJoinList,
    setJoinLabels: ({ loading, none, failed } = {}) => {
      const list = $('esc-city-list');
      if (!list) return;
      if (loading) list.dataset.loading = loading;
      if (none) list.dataset.none = none;
      if (failed) list.dataset.failed = failed;
    },
    toggle: () => {
      if (closeTop()) return;
      if (view !== 'main') { closeSubmenu(); return; }
      if (open) setOpen(false, { resume: true });
      else setOpen(true);
    },
    info: () => ({
      open,
      view,
      submenu: view !== 'main',
      touch: !!isTouch,
      hideCreate: !!hideCreate,
      buttons: [...root.querySelectorAll('[data-esc]:not([hidden])')].map((b) => b.dataset.esc),
      cities: joinCities ? joinCities.map((c) => ({ id: c.id, name: c.name, stickers: c.stickers, visitors: c.visitors, ageText: c.ageText })) : null,
    }),
  };
}
