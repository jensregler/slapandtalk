// The door (Jens, 31 Oct 2026; mockups door-1..5): "enter city" → choose 3 slaps to bring → they go
// into a Priority Mail pac (Jens's knappar/stickerpac.png, client/public/start/pac.webp – a see-through
// bag, the stickers inside), "name your pac", draw on it (the name-tag tool's brushes) → "to city".
// "to city" keeps the pac on this device (klibb.pac) and walks you out into the City (opts.toCity;
// t476u – the city: shared/city.mjs, city.js, citymode.js).
// The bag's design (Jens, 4 Nov 2026, t507u: "jag har lagt till stickerpacks så man kan välja på samma
// sätt som man väljer blanks"): swipe (or ‹ ›, or the dots) through Jens's seven bags – Dropbox
// "Teammapp för Ulla o co"/stickerpacks, client/public/stickerpacks/pac1..7.webp (pac1 = the Priority
// Mail bag, also /start/pac.webp). All seven are 563 × 802 with the label and the pouch in the same
// place, so PAC_LABEL / PAC_POUCH hold for every one. The choice is kept with the pac (bag: 1..7).
import { openNameTag } from './nametag.js';
const PAC = '/start/pac.webp', PW = 563, PH = 802;
export const PACKS = Array.from({ length: 7 }, (_, i) => `/stickerpacks/pac${i + 1}.webp`);
// The bag picture for a kept pac (bag 1..7; an old pac without one, or a bad number: the first).
export const bagUrl = (bag) => PACKS[((bag | 0) >= 1 && (bag | 0) <= PACKS.length ? bag | 0 : 1) - 1];
const PAC_KEY = 'klibb.pac';
export const readPac = () => { try { return JSON.parse(localStorage.getItem(PAC_KEY) || 'null'); } catch { return null; } };

let ui = null;
// opts: { S, toast, choices: () => [{ id, url }], unlock: () => void, toCity: () => void }
export function openDoorPick(opts) { if (!ui) ui = build(); ui.open(opts); return ui; }
export const doorOpen = () => !!ui && !ui.box.hidden;
export const doorState = () => (ui ? ui.state() : { open: false });

const loadImg = (src) => new Promise((res) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
// The bag's two areas, in pac.webp pixels (563 × 802; t477u, 2 Nov 2026):
//  - PAC_LABEL: the Priority Mail label at the top (the "FROM:" card). Drawing is only allowed here.
//  - PAC_POUCH: the clear pouch under it. The stickers go here, every part of them inside, with a margin.
export const PAC_LABEL = { x: 38, y: 34, w: 486, h: 214 };
export const PAC_POUCH = { x: 44, y: 276, w: 452, h: 472 };
const PAC_MARGIN = 12;
// The three spots (cells in the pouch, a little overlapping like stickers thrown in a bag) and turns.
const CELLS = [[0, 0, 0.56, 0.52, -0.12], [0.42, 0.03, 0.58, 0.52, 0.1], [0.16, 0.48, 0.68, 0.52, 0.04]];
// Where sticker k (w × h px) goes: centre, turn and scale so its turned box fits its cell, inside the
// pouch minus the margin. Exported for the test.
export function pacSpot(k, w, h) {
  const R = { x: PAC_POUCH.x + PAC_MARGIN, y: PAC_POUCH.y + PAC_MARGIN, w: PAC_POUCH.w - 2 * PAC_MARGIN, h: PAC_POUCH.h - 2 * PAC_MARGIN };
  const [fx, fy, fw, fh, rot] = CELLS[k % 3];
  const cw = fw * R.w, ch = fh * R.h, c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
  const sc = Math.min(cw / (w * c + h * s), ch / (w * s + h * c));
  return { cx: R.x + fx * R.w + cw / 2, cy: R.y + fy * R.h + ch / 2, rot, sc, inner: R };
}
// The pac: the three stickers inside the bag, the bag over them, and – if given – the drawing, but
// only what is on the label (ink: a full-size picture of a drawn pac; anything outside the label is
// never shown, also in pacs saved before this rule).
export async function composePac(urls, { pac = PAC, ink = null } = {}) {
  const c = document.createElement('canvas'); c.width = PW; c.height = PH;
  const x = c.getContext('2d');
  const ims = await Promise.all(urls.slice(0, 3).map(loadImg));
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
// A kept pac's picture, built again from its stickers (+ the label part of its drawing).
export async function pacPicture(pac) {
  if (!pac) return null;
  if (!pac.urls || pac.urls.length !== 3) return pac.img ? loadImg(pac.img) : null;
  return composePac(pac.urls, { ink: pac.img || null, pac: pac.bag ? bagUrl(pac.bag) : PAC });
}

function build() {
  const box = document.createElement('div'); box.id = 'door-flow'; box.hidden = true;
  box.innerHTML = `
    <div class="df-pick" id="df-pick">
      <div class="df-title" id="df-title"></div>
      <div class="df-grid" id="df-grid"></div>
      <div class="df-tray"><div class="df-slots" id="df-slots"></div><button type="button" id="df-next" disabled></button></div>
      <button type="button" class="df-x" id="df-cancel">✕</button>
    </div>
    <div class="df-pac" id="df-pac" hidden>
      <div class="df-bag"><button type="button" class="df-arrow" id="df-bag-prev" aria-label="previous bag">‹</button><canvas id="df-pac-canvas" width="${PW}" height="${PH}"></canvas><button type="button" class="df-arrow" id="df-bag-next" aria-label="next bag">›</button></div>
      <div class="df-dots" id="df-dots"></div>
      <input id="df-name" maxlength="30" autocomplete="off" spellcheck="false">
      <div class="df-pac-btns"><button type="button" id="df-draw"></button><button type="button" id="df-city"></button></div>
      <button type="button" class="df-back" id="df-back"></button>
    </div>`;
  document.body.appendChild(box);
  const $ = (id) => box.querySelector('#' + id);
  const st = { picked: [], opts: null, pacImg: null, drawn: false, bag: 1, ink: null };
  let S = {};
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
  async function showPac() {
    $('df-pick').hidden = true; $('df-pac').hidden = false;
    const bag = st.bag;
    const c = st.pacImg || await composePac(st.picked.map((d) => d.url), { pac: bagUrl(bag), ink: st.ink });
    if (bag !== st.bag) return; // swiped on meanwhile: that one draws
    const out = $('df-pac-canvas').getContext('2d'); out.clearRect(0, 0, PW, PH); out.drawImage(c, 0, 0);
    st.pacImg = c;
    [...$('df-dots').children].forEach((d, k) => d.classList.toggle('on', k === st.bag - 1));
    box.dataset.bag = String(st.bag);
  }
  // Choosing the bag, like the name tag's blanks: ‹ › / the dots / a swipe on the bag / ← →. A drawing
  // on the label stays (it is only ever the label part, PAC_LABEL).
  function setBag(n) { st.bag = ((n - 1 + PACKS.length) % PACKS.length) + 1; st.pacImg = null; showPac(); }
  for (let k = 0; k < PACKS.length; k++) { const d = document.createElement('span'); d.onclick = () => setBag(k + 1); $('df-dots').appendChild(d); }
  $('df-bag-prev').onclick = () => setBag(st.bag - 1);
  $('df-bag-next').onclick = () => setBag(st.bag + 1);
  { let sx = null; const cv = $('df-pac-canvas');
    cv.addEventListener('pointerdown', (e) => { sx = e.clientX; });
    cv.addEventListener('pointerup', (e) => { if (sx == null) return; const dx = e.clientX - sx; sx = null; if (Math.abs(dx) > 40) setBag(st.bag + (dx < 0 ? 1 : -1)); }); }
  $('df-next').onclick = () => { st.pacImg = null; st.drawn = false; st.ink = null; showPac(); };
  $('df-cancel').onclick = () => close();
  $('df-back').onclick = () => { $('df-pac').hidden = true; $('df-pick').hidden = false; };
  $('df-draw').onclick = () => {
    box.hidden = true;
    openNameTag({
      S, toast: st.opts.toast, blanks: [st.pacImg.toDataURL('image/png')], size: [PW, PH], direct: true, saveText: S.ntSave, clip: PAC_LABEL,
      onSave: async (blob) => { const im = await loadImg(URL.createObjectURL(blob)); st.ink = im; st.pacImg = await composePac(st.picked.map((d) => d.url), { ink: im, pac: bagUrl(st.bag) }); st.drawn = true; },
      onClose: () => { box.hidden = false; showPac(); },
    });
  };
  $('df-city').onclick = () => {
    const pac = { name: $('df-name').value.trim().slice(0, 30), stickers: st.picked.map((d) => d.id), urls: st.picked.map((d) => d.url), designs: st.picked.map((d) => ({ id: d.id, url: d.url, ...(d.width ? { width: d.width, height: d.height } : {}) })), bag: st.bag, at: new Date().toISOString() };
    try { localStorage.setItem(PAC_KEY, JSON.stringify({ ...pac, img: st.pacImg.toDataURL('image/webp', 0.85) })); } catch { try { localStorage.setItem(PAC_KEY, JSON.stringify(pac)); } catch { /* full */ } }
    close(); if (st.opts.toCity) st.opts.toCity(); else st.opts.toast?.(S.cityComingSoon, 3500); // the City (t476u): main.js goes there
  };
  function close() { box.hidden = true; }
  addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.target.id === 'df-name') { if (e.key !== 'Escape') { e.stopImmediatePropagation(); return; } }
    if (e.key === 'Escape') { if (!$('df-pac').hidden) $('df-back').click(); else close(); }
    else if (!$('df-pac').hidden && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) setBag(st.bag + (e.key === 'ArrowRight' ? 1 : -1));
    e.stopImmediatePropagation();
  }, true);
  addEventListener('keyup', (e) => { if (!box.hidden) e.stopImmediatePropagation(); }, true);
  return {
    box,
    open(opts) {
      st.opts = opts; S = opts.S || {}; st.picked = []; st.pacImg = null; st.ink = null; { const b = (readPac()?.bag) | 0; st.bag = b >= 1 && b <= PACKS.length ? b : 1; } // the last bag I chose
      $('df-title').textContent = S.doorChoose3; $('df-next').textContent = S.doorPack; $('df-draw').textContent = S.doorDraw; $('df-city').textContent = S.doorToCity;
      $('df-back').textContent = S.choiceBack; $('df-name').placeholder = S.doorNamePac; $('df-name').value = '';
      const grid = $('df-grid'); grid.textContent = '';
      for (const d of opts.choices()) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'df-g'; b.dataset.id = d.id;
        b.innerHTML = `<img loading="lazy" decoding="async" src="${d.url}" alt="">`;
        b.onclick = () => { const at = st.picked.findIndex((x) => x.id === d.id); if (at >= 0) st.picked.splice(at, 1); else if (st.picked.length < 3) st.picked.push(d); renderSlots(); };
        grid.appendChild(b);
      }
      $('df-pick').hidden = false; $('df-pac').hidden = true; box.hidden = false; renderSlots();
    },
    close,
    state: () => ({ open: !box.hidden, step: box.hidden ? null : $('df-pac').hidden ? 'pick' : 'pac', picked: st.picked.map((d) => d.id), drawn: st.drawn, bag: st.bag }),
    setBag,
  };
}
