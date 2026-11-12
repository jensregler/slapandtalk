// Esc / touch menu: big buttons that "spawn" when you leave the game.
// CREATE → STICKERS / STICKER PACK submenu. CITY → Create new city / Join existing submenu;
// Join existing shows the live-city list. Esc closes the topmost submenu first (escTopPanel).
// Catalogs (Jens t792u–t794u, 10 Nov 2026; the wheels are gone): STICKERS / NATURE / ASSETS under the
// six open a big grid of every item in that list, tiles in the same chrome as the buttons; a click
// holds it and closes the menu. HELP (t797u) lists every key. CREATE → MY PACKS picks the pack you carry.
const $ = (id) => document.getElementById(id);

export function initEscMenu({
  onSound, onAvatar, onRoom, onCity, onExit, onCreate,
  onStickers, onStickerPack,
  onCreateCity, onPickCity,
  // DAY / NIGHT (Jens t864u): flips the city's look, returns the new time ('day' | 'night'); the menu stays open.
  onDayNight = null, dayNight = () => 'day',
  // CITY → Export city / Import city (the city file; Jens t864u)
  onExportCity = null, onImportCity = null,
  showButton = () => true, // false: that button is hidden (DAY/NIGHT outside the city, export/import outside a city)
  formatCity = (c) => c, // enrich with ageText / facts for the Join list
  onClose = () => {},
  closeTop = () => false,
  isTouch = false,
  hideCreate = false, // optional: hide CREATE / STICKERS / STICKER PACK (unused; city has CREATE again)
  // catalog(kind) → { title, items: [{ id, url, name }], selected, empty } (kind: stickers | nature | assets | packs)
  catalog = () => null,
  canCatalog = () => true, // false: the caller handled it (e.g. the full version panel for Nature); the grid stays shut
  showCatalog = () => true, // false: that catalog's button is hidden (ASSETS outside the build phase)
  onCatalogPick = () => {},
  helpHtml = () => '',
  labels = {},
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
    exportcity: onExportCity,
    importcity: onImportCity,
  };
  const pickCity = onPickCity;

  let open = false;
  // false | 'create' | 'city' | 'cityjoin'
  let view = 'main';
  let spawnTimer = 0;
  let joinCities = null;
  let catKind = null; // the open catalog (view 'catalog')
  const CAT_KEYS = { catstickers: 'stickers', catnature: 'nature', catassets: 'assets', mypacks: 'packs' };

  function setView(next) {
    view = next || 'main';
    root.dataset.view = view;
    root.classList.toggle('esc-submenu', view !== 'main');
    root.classList.toggle('esc-cityjoin', view === 'cityjoin');
    root.classList.toggle('esc-catalog-view', view === 'catalog' || view === 'help');
    if (view !== 'catalog') catKind = null;
    paintDayNight();
    root.dataset.catalog = catKind || '';
    for (const btn of root.querySelectorAll('[data-esc]')) {
      const g = btn.dataset.escGroup || 'main';
      const key = btn.dataset.esc;
      let shown = true; try { shown = showButton(key) !== false; } catch { shown = true; }
      if (view === 'main') btn.hidden = g !== 'main' || !shown || (key === 'create' && !!hideCreate) || (key === 'catassets' && !showCatalog('assets'));
      else if (view === 'create') btn.hidden = g !== 'create' || !shown;
      else if (view === 'city') btn.hidden = g !== 'city' || !shown;
      else btn.hidden = true; // cityjoin: buttons hidden, list shown
    }
    const list = $('esc-city-list');
    if (list) list.hidden = view !== 'cityjoin';
    const cat = $('esc-catalog'); if (cat) cat.hidden = view !== 'catalog';
    const help = $('esc-help'); if (help) help.hidden = view !== 'help';
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

  // The DAY / NIGHT button shows the time it is now (☀️ DAY / 🌙 NIGHT, big); a click switches to the other.
  function paintDayNight() {
    const b = root.querySelector('[data-esc="daynight"]'); if (!b) return;
    let t = 'day'; try { t = dayNight() === 'night' ? 'night' : 'day'; } catch { /* day */ }
    b.dataset.time = t;
    const ico = b.querySelector('.esc-ico'), lab = b.querySelector('.esc-lab');
    if (ico) ico.textContent = t === 'night' ? '🌙' : '☀️';
    if (lab) lab.textContent = t === 'night' ? (labels.night || 'NIGHT') : (labels.day || 'DAY');
    b.setAttribute('aria-pressed', String(t === 'night'));
  }
  function closeSubmenu() {
    if (view === 'cityjoin') setView('city');
    else if (view === 'catalog' && catKind === 'packs') setView('create');
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

  // ---------- the catalogs: every sticker / nature sticker / asset as big tiles ----------
  function openCatalog(kind) {
    let ok = true;
    try { ok = canCatalog(kind) !== false; } catch (err) { console.warn('esc-menu catalog', kind, err); ok = false; }
    if (!ok) return false;
    catKind = kind;
    setView('catalog');
    catKind = kind; root.dataset.catalog = kind;
    renderCatalog({ scroll: true });
    return true;
  }
  function renderCatalog({ scroll = false } = {}) {
    const box = $('esc-catalog'); if (!box || !catKind) return;
    let c = null;
    try { c = catalog(catKind); } catch (err) { console.warn('esc-menu catalog', catKind, err); }
    c = c || { title: catKind.toUpperCase(), items: [] };
    const grid = box.querySelector('.esc-cat-grid');
    box.querySelector('.esc-cat-title').textContent = c.title || catKind.toUpperCase();
    box.querySelector('.esc-cat-count').textContent = c.items.length ? String(c.items.length) : '';
    const keepTop = grid.scrollTop;
    grid.textContent = '';
    if (!c.items.length) {
      const empty = document.createElement('div'); empty.className = 'esc-cat-empty'; empty.textContent = c.empty || labels.catEmpty || 'Nothing here yet';
      grid.appendChild(empty);
      return;
    }
    let selEl = null;
    for (const it of c.items) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'esc-tile'; b.dataset.id = it.id;
      if (it.id === c.selected) { b.classList.add('sel'); b.setAttribute('aria-pressed', 'true'); selEl = b; }
      const pic = document.createElement('span'); pic.className = 'esc-tile-pic';
      if (it.url) { const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.draggable = false; img.src = it.url; pic.appendChild(img); }
      b.appendChild(pic);
      const name = document.createElement('span'); name.className = 'esc-tile-name'; name.textContent = it.name || '';
      b.appendChild(name);
      if (it.id === c.selected) { const tag = document.createElement('span'); tag.className = 'esc-tile-tag'; tag.textContent = labels.holding || '✓'; b.appendChild(tag); }
      b.addEventListener('click', (e) => {
        e.preventDefault();
        const kind = catKind;
        setOpen(false, { resume: true });
        try { onCatalogPick(kind, it.id); } catch (err) { console.warn('esc-menu pick', kind, err); }
      });
      grid.appendChild(b);
    }
    if (scroll) { grid.scrollTop = 0; if (selEl) requestAnimationFrame(() => { try { selEl.scrollIntoView({ block: 'center' }); } catch { /* fine */ } }); }
    else grid.scrollTop = keepTop;
  }
  function openHelp() {
    setView('help');
    const body = $('esc-help')?.querySelector('.esc-help-body');
    if (body) { try { body.innerHTML = helpHtml() || ''; } catch (err) { console.warn('esc-menu help', err); } body.scrollTop = 0; }
  }
  for (const b of root.querySelectorAll('.esc-cat-back')) b.addEventListener('click', (e) => { e.preventDefault(); closeSubmenu(); });

  for (const btn of root.querySelectorAll('[data-esc]')) {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const key = btn.dataset.esc;
      if (CAT_KEYS[key]) { openCatalog(CAT_KEYS[key]); return; }
      if (key === 'help') { openHelp(); return; }
      if (key === 'daynight') { try { onDayNight?.(); } catch (err) { console.warn('esc-menu', key, err); } paintDayNight(); return; }
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
    openCatalog: (kind) => { if (!open) setOpen(true); return openCatalog(kind); },
    openHelp: () => { if (!open) setOpen(true); openHelp(); },
    refreshCatalog: () => { if (open && view === 'catalog') renderCatalog(); },
    catalogOpen: () => open && view === 'catalog',
    scrollingUi: () => open && (view === 'catalog' || view === 'help' || view === 'cityjoin'),
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
      time: (() => { try { return dayNight(); } catch { return null; } })(),
      dayNightLabel: root.querySelector('[data-esc="daynight"]')?.textContent?.trim() || null,
      buttons: [...root.querySelectorAll('[data-esc]:not([hidden])')].map((b) => b.dataset.esc),
      catalog: view === 'catalog' ? {
        kind: catKind,
        title: $('esc-catalog')?.querySelector('.esc-cat-title')?.textContent || '',
        n: $('esc-catalog')?.querySelectorAll('.esc-tile').length || 0,
        selected: $('esc-catalog')?.querySelector('.esc-tile.sel')?.dataset.id || null,
        ids: [...($('esc-catalog')?.querySelectorAll('.esc-tile') || [])].slice(0, 400).map((t) => t.dataset.id),
      } : null,
      help: view === 'help' ? ($('esc-help')?.querySelector('.esc-help-body')?.textContent || '') : null,
      cities: joinCities ? joinCities.map((c) => ({ id: c.id, name: c.name, stickers: c.stickers, visitors: c.visitors, ageText: c.ageText })) : null,
    }),
  };
}
