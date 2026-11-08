// The door / pac makeover (Jens, Nov 2026): pick a bag → design it (marker) → optional new-city
// name → choose 3 stickers → reveal + name your pac → back to room / to the city.
// Bag designs: client/public/stickerpacks/pac1..7.webp (pac1 = Priority Mail /start/pac.webp).
import { openNameTag } from './nametag.js';
const PAC = '/start/pac.webp', PW = 563, PH = 802;
export const PACKS = Array.from({ length: 7 }, (_, i) => `/stickerpacks/pac${i + 1}.webp`);
export const bagUrl = (bag) => PACKS[((bag | 0) >= 1 && (bag | 0) <= PACKS.length ? bag | 0 : 1) - 1];
const PAC_KEY = 'klibb.pac';
export const readPac = () => { try { return JSON.parse(localStorage.getItem(PAC_KEY) || 'null'); } catch { return null; } };

let ui = null;
// opts: { S, toast, choices: () => [{ id, url }], unlock: () => void,
//         toCity: (cityName?: string) => void, backToRoom?: () => void,
//         needsNewCity?: () => Promise<boolean>, inCity?: boolean }
export function openDoorPick(opts) { if (!ui) ui = build(); ui.open(opts); return ui; }
export const doorOpen = () => !!ui && !ui.box.hidden;
export const doorState = () => (ui ? ui.state() : { open: false });

const loadImg = (src) => new Promise((res) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
export const PAC_LABEL = { x: 38, y: 34, w: 486, h: 214 };
export const PAC_POUCH = { x: 44, y: 276, w: 452, h: 472 };
const PAC_MARGIN = 12;
const CELLS = [[0, 0, 0.56, 0.52, -0.12], [0.42, 0.03, 0.58, 0.52, 0.1], [0.16, 0.48, 0.68, 0.52, 0.04]];
export function pacSpot(k, w, h) {
  const R = { x: PAC_POUCH.x + PAC_MARGIN, y: PAC_POUCH.y + PAC_MARGIN, w: PAC_POUCH.w - 2 * PAC_MARGIN, h: PAC_POUCH.h - 2 * PAC_MARGIN };
  const [fx, fy, fw, fh, rot] = CELLS[k % 3];
  const cw = fw * R.w, ch = fh * R.h, c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
  const sc = Math.min(cw / (w * c + h * s), ch / (w * s + h * c));
  return { cx: R.x + fx * R.w + cw / 2, cy: R.y + fy * R.h + ch / 2, rot, sc, inner: R };
}
export async function composePac(urls, { pac = PAC, ink = null } = {}) {
  const c = document.createElement('canvas'); c.width = PW; c.height = PH;
  const x = c.getContext('2d');
  const ims = await Promise.all((urls || []).slice(0, 3).map(loadImg));
  x.save(); const P = pacSpot(0, 1, 1).inner; x.beginPath(); x.rect(P.x, P.y, P.w, P.h); x.clip();
  ims.forEach((im, k) => {
    if (!im || !im.width) return;
    const { cx, cy, rot, sc } = pacSpot(k, im.width, im.height);
    x.save(); x.translate(cx, cy); x.rotate(rot); x.drawImage(im, -im.width * sc / 2, -im.height * sc / 2, im.width * sc, im.height * sc); x.restore();
  });
  x.restore();
  const bag = await loadImg(pac); if (bag) x.drawImage(bag, 0, 0, PW, PH);
  const drawn = typeof ink === 'string' ? await loadImg(ink) : ink;
  if (drawn) { const L = PAC_LABEL; x.drawImage(drawn, L.x * drawn.width / PW, L.y * drawn.height / PH, L.w * drawn.width / PW, L.h * drawn.height / PH, L.x, L.y, L.w, L.h); }
  return c;
}
export async function pacPicture(pac) {
  if (!pac) return null;
  if (!pac.urls || pac.urls.length !== 3) return pac.img ? loadImg(pac.img) : null;
  return composePac(pac.urls, { ink: pac.img || null, pac: pac.bag ? bagUrl(pac.bag) : PAC });
}

const MARKER_SVG = `
<svg class="df-marker-svg" viewBox="0 0 420 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="df-mk-body" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#f5e14a"/><stop offset=".55" stop-color="#f0d020"/><stop offset="1" stop-color="#e6c010"/>
    </linearGradient>
  </defs>
  <g transform="rotate(-18 210 60)">
    <path d="M28 48 L78 38 L88 82 L38 92 Z" fill="#e0352b"/>
    <path d="M70 40 L95 34 L102 78 L78 84 Z" fill="#222"/>
    <rect x="95" y="30" width="250" height="58" rx="10" fill="url(#df-mk-body)" stroke="#222" stroke-width="3"/>
    <rect x="345" y="34" width="42" height="50" rx="6" fill="#111"/>
    <text x="220" y="68" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="15" font-weight="800" fill="#c01010">Design your pac and trade it in the shop</text>
  </g>
</svg>`;

const BURST_WORDS = ['NEW', 'Fresh', 'WHAT!', 'cool', 'NEW', 'Fresh'];

function build() {
  const box = document.createElement('div'); box.id = 'door-flow'; box.hidden = true;
  box.innerHTML = `
    <div class="df-bags" id="df-bags" hidden>
      <div class="df-carousel" id="df-carousel">
        <button type="button" class="df-arrow df-arrow-outer" id="df-bag-prev" aria-label="previous bag">‹</button>
        <div class="df-peek df-peek-l" id="df-peek-l" aria-hidden="true"></div>
        <div class="df-bag-main">
          <canvas id="df-pac-canvas" width="${PW}" height="${PH}"></canvas>
          <button type="button" class="df-marker" id="df-marker" aria-label="Design your pac">${MARKER_SVG}</button>
        </div>
        <div class="df-peek df-peek-r" id="df-peek-r" aria-hidden="true"></div>
        <button type="button" class="df-arrow df-arrow-outer" id="df-bag-next" aria-label="next bag">›</button>
      </div>
      <div class="df-pac-btns"><button type="button" id="df-skip-design"></button></div>
      <button type="button" class="df-back" id="df-back-bags"></button>
    </div>
    <div class="df-newcity" id="df-newcity" hidden>
      <div class="df-panel">
        <div class="df-title" id="df-newcity-title"></div>
        <div class="df-note" id="df-newcity-note"></div>
        <input id="df-city-name" maxlength="32" autocomplete="off" spellcheck="false">
        <div class="df-pac-btns">
          <button type="button" id="df-city-go"></button>
          <button type="button" id="df-city-skip"></button>
        </div>
      </div>
    </div>
    <div class="df-pick" id="df-pick" hidden>
      <div class="df-title" id="df-title"></div>
      <div class="df-grid" id="df-grid"></div>
      <div class="df-tray"><div class="df-slots" id="df-slots"></div><button type="button" id="df-next" disabled></button></div>
      <button type="button" class="df-back" id="df-back-pick"></button>
      <button type="button" class="df-x" id="df-cancel">✕</button>
    </div>
    <div class="df-reveal" id="df-reveal" hidden>
      <div class="df-burst" id="df-burst" aria-hidden="true"></div>
      <canvas id="df-reveal-canvas" width="${PW}" height="${PH}"></canvas>
      <div class="df-reveal-words" id="df-reveal-words"></div>
      <input id="df-name" maxlength="30" autocomplete="off" spellcheck="false">
      <div class="df-pac-btns"><button type="button" id="df-name-go"></button><button type="button" id="df-name-skip"></button></div>
    </div>
    <div class="df-done" id="df-done" hidden>
      <canvas id="df-done-canvas" width="${PW}" height="${PH}"></canvas>
      <div class="df-done-name" id="df-done-name"></div>
      <div class="df-pac-btns">
        <button type="button" id="df-room"></button>
        <button type="button" id="df-city"></button>
      </div>
    </div>`;
  document.body.appendChild(box);
  const $ = (id) => box.querySelector('#' + id);
  const st = {
    picked: [], opts: null, pacImg: null, drawn: false, bag: 1, ink: null,
    step: null, cityName: null, pacName: '',
  };
  let S = {};
  const steps = ['bags', 'newcity', 'pick', 'reveal', 'done'];
  function hideAll() {
    for (const id of ['df-bags', 'df-newcity', 'df-pick', 'df-reveal', 'df-done']) $(id).hidden = true;
  }
  function showStep(step) {
    st.step = step; hideAll(); box.hidden = false;
    if (step === 'bags') { $('df-bags').hidden = false; paintBag(); }
    else if (step === 'newcity') { $('df-newcity').hidden = false; $('df-city-name').value = ''; $('df-city-name').focus(); }
    else if (step === 'pick') { $('df-pick').hidden = false; renderPick(); }
    else if (step === 'reveal') { $('df-reveal').hidden = false; showReveal(); }
    else if (step === 'done') { $('df-done').hidden = false; showDone(); }
  }

  async function paintBag() {
    const bag = st.bag;
    const c = await composePac([], { pac: bagUrl(bag), ink: st.ink });
    if (bag !== st.bag) return;
    const out = $('df-pac-canvas').getContext('2d'); out.clearRect(0, 0, PW, PH); out.drawImage(c, 0, 0);
    st.pacImg = c;
    box.dataset.bag = String(st.bag);
    paintPeeks();
  }
  async function paintPeeks() {
    const left = ((st.bag - 2 + PACKS.length) % PACKS.length) + 1;
    const right = (st.bag % PACKS.length) + 1;
    for (const [el, n] of [[$('df-peek-l'), left], [$('df-peek-r'), right]]) {
      el.textContent = '';
      const im = await loadImg(bagUrl(n));
      if (!im) continue;
      const cv = document.createElement('canvas'); cv.width = PW; cv.height = Math.round(PAC_LABEL.h + 24);
      const x = cv.getContext('2d');
      x.drawImage(im, 0, 0, PW, PAC_LABEL.y + PAC_LABEL.h + 12, 0, 0, PW, cv.height);
      el.appendChild(cv);
    }
  }
  function setBag(n) {
    st.bag = ((n - 1 + PACKS.length) % PACKS.length) + 1;
    st.pacImg = null;
    if (st.step === 'bags') paintBag();
  }
  $('df-bag-prev').onclick = () => setBag(st.bag - 1);
  $('df-bag-next').onclick = () => setBag(st.bag + 1);
  { let sx = null; const cv = $('df-pac-canvas');
    cv.addEventListener('pointerdown', (e) => { sx = e.clientX; });
    cv.addEventListener('pointerup', (e) => { if (sx == null) return; const dx = e.clientX - sx; sx = null; if (Math.abs(dx) > 40) setBag(st.bag + (dx < 0 ? 1 : -1)); }); }

  function openDraw() {
    box.hidden = true;
    // One blank per bag so ‹ › still flip bags while drawing (header zoomed).
    const blanks = PACKS.map((u) => u);
    openNameTag({
      S, toast: st.opts.toast, blanks, size: [PW, PH], direct: true,
      startBlank: st.bag - 1, hideDots: true,
      saveText: S.doorDone || 'done', exitText: S.doorSkip || 'skip',
      clip: PAC_LABEL, zoomClip: PAC_LABEL,
      onBlankChange: (i) => { st.bag = i + 1; box.dataset.bag = String(st.bag); },
      onSave: async (blob) => {
        const im = await loadImg(URL.createObjectURL(blob));
        st.ink = im; st.drawn = true;
        st.pacImg = await composePac([], { ink: im, pac: bagUrl(st.bag) });
      },
      onClose: () => { afterDesign(); },
    });
  }
  $('df-marker').onclick = () => openDraw();
  $('df-pac-canvas').addEventListener('dblclick', () => openDraw());
  $('df-skip-design').onclick = () => afterDesign();
  $('df-back-bags').onclick = () => close();
  $('df-cancel').onclick = () => close();

  async function afterDesign() {
    box.hidden = false;
    let need = false;
    try { need = !st.opts.inCity && !!(await st.opts.needsNewCity?.()); } catch { need = !st.opts.inCity; }
    if (need) showStep('newcity');
    else showStep('pick');
  }
  $('df-city-go').onclick = () => {
    const name = $('df-city-name').value.trim().slice(0, 32);
    if (!name) { $('df-city-name').focus(); return; }
    st.cityName = name; showStep('pick');
  };
  $('df-city-skip').onclick = () => { st.cityName = null; showStep('pick'); };

  function renderPick() {
    $('df-title').textContent = S.doorChoose3;
    $('df-next').textContent = S.doorPack;
    $('df-back-pick').textContent = S.choiceBack;
    const grid = $('df-grid'); grid.textContent = '';
    for (const d of st.opts.choices()) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'df-g'; b.dataset.id = d.id;
      b.innerHTML = `<img loading="lazy" decoding="async" src="${d.url}" alt="">`;
      b.onclick = () => {
        const at = st.picked.findIndex((x) => x.id === d.id);
        if (at >= 0) st.picked.splice(at, 1);
        else if (st.picked.length < 3) st.picked.push(d);
        renderSlots();
      };
      grid.appendChild(b);
    }
    renderSlots();
  }
  function renderSlots() {
    const slots = $('df-slots'); slots.textContent = '';
    for (let k = 0; k < 3; k++) {
      const d = st.picked[k], s = document.createElement('button'); s.type = 'button'; s.className = 'df-slot' + (d ? ' full' : '');
      if (d) { s.innerHTML = `<img src="${d.url}" alt="">`; s.onclick = () => { st.picked.splice(k, 1); renderSlots(); }; }
      slots.appendChild(s);
    }
    $('df-next').disabled = st.picked.length !== 3;
    box.querySelectorAll('.df-g').forEach((b) => b.classList.toggle('on', st.picked.some((d) => d.id === b.dataset.id)));
  }
  $('df-next').onclick = () => { st.pacImg = null; showStep('reveal'); };
  $('df-back-pick').onclick = () => {
    // Back from stickers: to new-city if that step was shown, else bags.
    if (st.cityName != null || (!st.opts.inCity && $('df-newcity'))) {
      // If we came through newcity (even skipped), go bags – simpler: always bags.
    }
    st.picked = []; showStep('bags');
  };

  async function showReveal() {
    const c = await composePac(st.picked.map((d) => d.url), { pac: bagUrl(st.bag), ink: st.ink });
    st.pacImg = c;
    const out = $('df-reveal-canvas').getContext('2d'); out.clearRect(0, 0, PW, PH); out.drawImage(c, 0, 0);
    $('df-name').placeholder = S.doorNamePac; $('df-name').value = st.pacName || '';
    $('df-name-go').textContent = S.doorDone || 'done';
    $('df-name-skip').textContent = S.doorSkip || 'Skip';
    const words = $('df-reveal-words'); words.textContent = '';
    BURST_WORDS.forEach((w, i) => {
      const s = document.createElement('span'); s.className = 'df-w df-w-' + (i % 4); s.textContent = w; words.appendChild(s);
    });
    const burst = $('df-burst'); burst.textContent = '';
    for (let i = 0; i < 18; i++) {
      const sp = document.createElement('span'); sp.className = 'df-spark'; sp.style.setProperty('--a', String((i / 18) * 360));
      sp.style.setProperty('--d', `${0.4 + (i % 5) * 0.12}s`); burst.appendChild(sp);
    }
    $('df-name').focus();
  }
  function finishName() {
    st.pacName = $('df-name').value.trim().slice(0, 30);
    showStep('done');
  }
  $('df-name-skip').onclick = () => { st.pacName = ''; showStep('done'); };
  $('df-name-go').onclick = () => finishName();
  $('df-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finishName(); }
  });

  async function showDone() {
    const c = st.pacImg || await composePac(st.picked.map((d) => d.url), { pac: bagUrl(st.bag), ink: st.ink });
    st.pacImg = c;
    const out = $('df-done-canvas').getContext('2d'); out.clearRect(0, 0, PW, PH); out.drawImage(c, 0, 0);
    $('df-done-name').textContent = st.pacName || '';
    $('df-done-name').hidden = !st.pacName;
    $('df-room').textContent = S.doorBackRoom || 'back to room';
    $('df-city').textContent = S.doorToCityGo || 'to the city';
  }
  function savePac() {
    const pac = {
      name: st.pacName, stickers: st.picked.map((d) => d.id), urls: st.picked.map((d) => d.url),
      designs: st.picked.map((d) => ({ id: d.id, url: d.url, ...(d.width ? { width: d.width, height: d.height } : {}) })),
      bag: st.bag, at: new Date().toISOString(),
    };
    try { localStorage.setItem(PAC_KEY, JSON.stringify({ ...pac, img: st.pacImg.toDataURL('image/webp', 0.85) })); }
    catch { try { localStorage.setItem(PAC_KEY, JSON.stringify(pac)); } catch { /* full */ } }
    return pac;
  }
  $('df-room').onclick = () => {
    savePac(); close();
    st.opts.backToRoom?.();
  };
  $('df-city').onclick = () => {
    savePac(); const name = st.cityName; close();
    if (st.opts.toCity) st.opts.toCity(name || undefined);
    else st.opts.toast?.(S.cityComingSoon, 3500);
  };

  function close() { box.hidden = true; st.step = null; hideAll(); }
  addEventListener('keydown', (e) => {
    if (box.hidden) return;
    const typing = e.target && (e.target.id === 'df-name' || e.target.id === 'df-city-name');
    if (typing) { if (e.key !== 'Escape') { e.stopImmediatePropagation(); return; } }
    if (e.key === 'Escape') {
      if (st.step === 'done') return; // use the buttons
      if (st.step === 'reveal') { st.pacName = ''; showStep('done'); }
      else if (st.step === 'pick') showStep('bags');
      else if (st.step === 'newcity') { st.cityName = null; showStep('pick'); }
      else close();
    } else if (st.step === 'bags' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) setBag(st.bag + (e.key === 'ArrowRight' ? 1 : -1));
    e.stopImmediatePropagation();
  }, true);
  addEventListener('keyup', (e) => { if (!box.hidden) e.stopImmediatePropagation(); }, true);

  return {
    box,
    open(opts) {
      st.opts = opts; S = opts.S || {};
      st.picked = []; st.pacImg = null; st.ink = null; st.drawn = false; st.cityName = null; st.pacName = '';
      { const b = (readPac()?.bag) | 0; st.bag = b >= 1 && b <= PACKS.length ? b : 1; }
      $('df-skip-design').textContent = S.doorSkip || 'Skip';
      $('df-back-bags').textContent = S.choiceBack;
      $('df-newcity-title').textContent = S.doorNewCityTitle || 'Start a new city?';
      $('df-newcity-note').textContent = S.doorNewCityNote || 'You are the city\'s first resident – do you want to name it?';
      $('df-city-name').placeholder = S.cpNamePlaceholder || 'e.g. Slapville';
      $('df-city-go').textContent = S.doorNewCityGo || 'Name it →';
      $('df-city-skip').textContent = S.doorSkip || 'Skip';
      showStep('bags');
    },
    close,
    state: () => ({
      open: !box.hidden, step: box.hidden ? null : st.step, picked: st.picked.map((d) => d.id),
      drawn: st.drawn, bag: st.bag, cityName: st.cityName, pacName: st.pacName,
    }),
    setBag,
  };
}
