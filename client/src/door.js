// The door (Jens, 31 Oct 2026; mockups door-1..5): "enter city" → choose 3 slaps to bring → they go
// into a Priority Mail pac (Jens's knappar/stickerpac.png, client/public/start/pac.webp – a see-through
// bag, the stickers inside), "name your pac", draw on it (the name-tag tool's brushes) → "to city".
// The city itself isn't defined yet: "to city" keeps the pac on this device (klibb.pac) and says
// "The city is coming soon!".
import { openNameTag } from './nametag.js';
const PAC = '/start/pac.webp', PW = 563, PH = 802;
const PAC_KEY = 'klibb.pac';
export const readPac = () => { try { return JSON.parse(localStorage.getItem(PAC_KEY) || 'null'); } catch { return null; } };

let ui = null;
// opts: { S, toast, choices: () => [{ id, url }], unlock: () => void }
export function openDoorPick(opts) { if (!ui) ui = build(); ui.open(opts); return ui; }
export const doorOpen = () => !!ui && !ui.box.hidden;
export const doorState = () => (ui ? ui.state() : { open: false });

const loadImg = (src) => new Promise((res) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
// The pac: the three stickers inside the bag (overlapping, a little turned), the bag over them.
export async function composePac(urls, { pac = PAC } = {}) {
  const c = document.createElement('canvas'); c.width = PW; c.height = PH;
  const x = c.getContext('2d');
  const spots = [[0.3, 0.5, -0.12], [0.68, 0.56, 0.1], [0.46, 0.78, 0.04]];
  const ims = await Promise.all(urls.slice(0, 3).map(loadImg));
  ims.forEach((im, k) => {
    if (!im) return;
    const [fx, fy, rot] = spots[k], max = PW * 0.5, sc = Math.min(max / im.width, max / im.height);
    x.save(); x.translate(fx * PW, fy * PH); x.rotate(rot); x.drawImage(im, -im.width * sc / 2, -im.height * sc / 2, im.width * sc, im.height * sc); x.restore();
  });
  const bag = await loadImg(pac); if (bag) x.drawImage(bag, 0, 0, PW, PH);
  return c;
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
      <canvas id="df-pac-canvas" width="${PW}" height="${PH}"></canvas>
      <input id="df-name" maxlength="30" autocomplete="off" spellcheck="false">
      <div class="df-pac-btns"><button type="button" id="df-draw"></button><button type="button" id="df-city"></button></div>
      <button type="button" class="df-back" id="df-back"></button>
    </div>`;
  document.body.appendChild(box);
  const $ = (id) => box.querySelector('#' + id);
  const st = { picked: [], opts: null, pacImg: null, drawn: false };
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
    const c = st.pacImg || await composePac(st.picked.map((d) => d.url));
    const out = $('df-pac-canvas').getContext('2d'); out.clearRect(0, 0, PW, PH); out.drawImage(c, 0, 0);
    st.pacImg = c;
  }
  $('df-next').onclick = () => { st.pacImg = null; st.drawn = false; showPac(); };
  $('df-cancel').onclick = () => close();
  $('df-back').onclick = () => { $('df-pac').hidden = true; $('df-pick').hidden = false; };
  $('df-draw').onclick = () => {
    box.hidden = true;
    openNameTag({
      S, toast: st.opts.toast, blanks: [st.pacImg.toDataURL('image/png')], size: [PW, PH], direct: true, saveText: S.ntSave,
      onSave: async (blob) => { const im = await loadImg(URL.createObjectURL(blob)); const c = document.createElement('canvas'); c.width = PW; c.height = PH; c.getContext('2d').drawImage(im, 0, 0); st.pacImg = c; st.drawn = true; },
      onClose: () => { box.hidden = false; showPac(); },
    });
  };
  $('df-city').onclick = () => {
    const pac = { name: $('df-name').value.trim().slice(0, 30), stickers: st.picked.map((d) => d.id), at: new Date().toISOString() };
    try { localStorage.setItem(PAC_KEY, JSON.stringify({ ...pac, img: st.pacImg.toDataURL('image/webp', 0.85) })); } catch { try { localStorage.setItem(PAC_KEY, JSON.stringify(pac)); } catch { /* full */ } }
    close(); st.opts.toast?.(S.cityComingSoon, 3500);
  };
  function close() { box.hidden = true; }
  addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.target.id === 'df-name') { if (e.key !== 'Escape') { e.stopImmediatePropagation(); return; } }
    if (e.key === 'Escape') { if (!$('df-pac').hidden) $('df-back').click(); else close(); }
    e.stopImmediatePropagation();
  }, true);
  addEventListener('keyup', (e) => { if (!box.hidden) e.stopImmediatePropagation(); }, true);
  return {
    box,
    open(opts) {
      st.opts = opts; S = opts.S || {}; st.picked = []; st.pacImg = null;
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
    state: () => ({ open: !box.hidden, step: box.hidden ? null : $('df-pac').hidden ? 'pick' : 'pac', picked: st.picked.map((d) => d.id), drawn: st.drawn }),
  };
}
