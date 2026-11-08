// The door / pac makeover (Jens, Nov 2026):
// CREATE → STICKER PACK (Jens final flow):
//   1) choose 3 stickers
//   2) label colour carousel + Draw (draw: skip / undo / done; bag shows the 3 stickers)
//   3) celebration (glitter / fireworks)
//   4) "Would you like to name your pack?" yes/no (yes → text input)
//   5) "Back to room" or "To the city – trade your stickers"
// No mid-flow new-city question (city = final button or CITY menu). Every step has Exit → room.
// Bag designs: client/public/stickerpacks/pac1..7.webp (pac1 = Priority Mail /start/pac.webp).
import { openNameTag } from './nametag.js';
import { addPack, openPackReplace } from './packswheel.js';
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

const BURST_WORDS = ['NEW', 'Fresh', 'WHAT!', 'cool', 'NEW', 'Fresh'];

function build() {
  const box = document.createElement('div'); box.id = 'door-flow'; box.hidden = true;
  box.innerHTML = `
    <div class="df-pick" id="df-pick" hidden>
      <div class="df-title" id="df-title"></div>
      <div class="df-grid" id="df-grid"></div>
      <div class="df-tray"><div class="df-slots" id="df-slots"></div><button type="button" id="df-next" disabled></button></div>
      <button type="button" class="df-back" id="df-back-pick"></button>
      <button type="button" class="df-x" id="df-cancel">✕</button>
    </div>
    <div class="df-bags" id="df-bags" hidden>
      <div class="df-carousel" id="df-carousel">
        <button type="button" class="df-arrow df-arrow-outer" id="df-bag-prev" aria-label="previous bag">‹</button>
        <div class="df-peek df-peek-l" id="df-peek-l" aria-hidden="true"></div>
        <div class="df-bag-main">
          <canvas id="df-pac-canvas" width="${PW}" height="${PH}"></canvas>
        </div>
        <div class="df-peek df-peek-r" id="df-peek-r" aria-hidden="true"></div>
        <button type="button" class="df-arrow df-arrow-outer" id="df-bag-next" aria-label="next bag">›</button>
      </div>
      <div class="df-pac-btns">
        <button type="button" class="df-draw" id="df-draw"></button>
        <button type="button" id="df-skip-design"></button>
      </div>
      <button type="button" class="df-back" id="df-back-bags"></button>
      <button type="button" class="df-x" id="df-exit-bags">✕</button>
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
        <button type="button" class="df-back" id="df-back-newcity"></button>
        <button type="button" class="df-x" id="df-exit-newcity">✕</button>
      </div>
    </div>
    <div class="df-reveal" id="df-reveal" hidden>
      <canvas class="df-fx" id="df-fx" width="900" height="700" aria-hidden="true"></canvas>
      <div class="df-burst" id="df-burst" aria-hidden="true"></div>
      <canvas id="df-reveal-canvas" width="${PW}" height="${PH}"></canvas>
      <div class="df-reveal-words" id="df-reveal-words"></div>
      <div class="df-wow" id="df-wow"></div>
      <div class="df-ask" id="df-ask-view">
        <div class="df-ask-q" id="df-ask-q"></div>
        <div class="df-pac-btns df-ask-btns">
          <button type="button" class="df-ask-no" id="df-name-no"></button>
          <button type="button" class="df-ask-yes" id="df-name-yes"></button>
        </div>
      </div>
      <div class="df-name-view" id="df-name-view" hidden>
        <input id="df-name" maxlength="30" autocomplete="off" spellcheck="false">
        <div class="df-pac-btns"><button type="button" id="df-name-go"></button></div>
      </div>
      <button type="button" class="df-x" id="df-exit-reveal">✕</button>
    </div>
    <div class="df-done" id="df-done" hidden>
      <canvas id="df-done-canvas" width="${PW}" height="${PH}"></canvas>
      <div class="df-done-name" id="df-done-name"></div>
      <div class="df-pac-btns">
        <button type="button" id="df-room"></button>
        <button type="button" id="df-city"></button>
      </div>
      <button type="button" class="df-x" id="df-exit-done">✕</button>
    </div>`;
  document.body.appendChild(box);
  const $ = (id) => box.querySelector('#' + id);
  const st = {
    picked: [], opts: null, pacImg: null, drawn: false, bag: 1, ink: null,
    step: null, cityName: null, pacName: '', revealPhase: 'ask', fxRaf: 0,
  };
  let S = {};
  const stickerUrls = () => st.picked.map((d) => d.url);

  function hideAll() {
    for (const id of ['df-bags', 'df-newcity', 'df-pick', 'df-reveal', 'df-done']) $(id).hidden = true;
  }
  function showStep(step) {
    st.step = step; hideAll(); box.hidden = false;
    if (step === 'pick') { $('df-pick').hidden = false; renderPick(); }
    else if (step === 'bags') { $('df-bags').hidden = false; paintBag(); }
    else if (step === 'newcity') { $('df-newcity').hidden = false; $('df-city-name').value = ''; $('df-city-name').focus(); }
    else if (step === 'reveal') { $('df-reveal').hidden = false; showReveal(); }
    else if (step === 'done') { $('df-done').hidden = false; showDone(); }
  }

  async function paintBag() {
    const bag = st.bag;
    const c = await composePac(stickerUrls(), { pac: bagUrl(bag), ink: st.ink });
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

  // Draw: same sticker-editor layout (exit – undo – done), label clip, bag+3 stickers as the blank.
  async function openDraw() {
    box.hidden = true;
    const urls = stickerUrls();
    // One blank: current bag with the 3 stickers already in the pouch (fast open).
    const blank = await composePac(urls, { pac: bagUrl(st.bag) });
    openNameTag({
      S, toast: st.opts.toast, blanks: [blank.toDataURL('image/png')], size: [PW, PH], direct: true,
      startBlank: 0, hideDots: true,
      // Pack label draw: skip (left) – undo – done (right); same L/R convention as sticker editor.
      saveText: S.ntSave || S.doorDone || 'done',
      exitText: S.doorSkip || 'Skip',
      clip: PAC_LABEL, zoomClip: PAC_LABEL,
      onSave: async (blob) => {
        const im = await loadImg(URL.createObjectURL(blob));
        st.ink = im; st.drawn = true;
        st.pacImg = await composePac(urls, { ink: im, pac: bagUrl(st.bag) });
      },
      onClose: () => { afterDesign(); },
    });
  }
  $('df-draw').onclick = () => openDraw();
  $('df-pac-canvas').addEventListener('dblclick', () => openDraw());
  $('df-skip-design').onclick = () => afterDesign();
  $('df-back-bags').onclick = () => showStep('pick');
  $('df-cancel').onclick = () => close();
  const exitToRoom = () => { stopFx(); close(); st.opts.backToRoom?.(); };
  $('df-exit-bags').onclick = exitToRoom;
  $('df-exit-newcity').onclick = exitToRoom;
  $('df-exit-reveal').onclick = exitToRoom;
  $('df-exit-done').onclick = () => { savePac(); exitToRoom(); };
  $('df-back-newcity').onclick = () => showStep('bags');

  async function afterDesign() {
    box.hidden = false;
    // CREATE → STICKER PACK: never ask new-city mid-flow (city via final button / CITY menu).
    if (st.opts.skipNewCity) { showStep('reveal'); return; }
    let need = false;
    try { need = !st.opts.inCity && !!(await st.opts.needsNewCity?.()); } catch { need = !st.opts.inCity; }
    if (need) showStep('newcity');
    else showStep('reveal');
  }
  $('df-city-go').onclick = () => {
    const name = $('df-city-name').value.trim().slice(0, 32);
    if (!name) { $('df-city-name').focus(); return; }
    st.cityName = name; showStep('reveal');
  };
  $('df-city-skip').onclick = () => { st.cityName = null; showStep('reveal'); };

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
  $('df-next').onclick = () => { st.pacImg = null; st.ink = null; st.drawn = false; showStep('bags'); };
  $('df-back-pick').onclick = () => close();

  function stopFx() { cancelAnimationFrame(st.fxRaf); st.fxRaf = 0; }
  function startFx() {
    const cv = $('df-fx'); if (!cv) return;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const sparks = Array.from({ length: 70 }, () => ({
      x: Math.random() * W, y: Math.random() * H * 0.7,
      vx: (Math.random() - 0.5) * 3.2, vy: -1.2 - Math.random() * 3.5,
      life: 40 + Math.random() * 60, age: Math.random() * 40,
      r: 1.5 + Math.random() * 3.5, hue: Math.floor(Math.random() * 360),
    }));
    const boom = [];
    const boomAt = (x, y) => {
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2 + Math.random() * 0.2;
        const sp = 1.5 + Math.random() * 4;
        boom.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 35 + Math.random() * 25, age: 0, r: 2 + Math.random() * 3, hue: Math.floor(Math.random() * 360) });
      }
    };
    let tick = 0;
    const frame = () => {
      st.fxRaf = requestAnimationFrame(frame);
      tick++;
      ctx.clearRect(0, 0, W, H);
      if (tick % 28 === 1) boomAt(80 + Math.random() * (W - 160), 60 + Math.random() * (H * 0.45));
      for (const s of sparks) {
        s.age++; s.x += s.vx; s.y += s.vy; s.vy += 0.04;
        if (s.age > s.life) { s.age = 0; s.x = Math.random() * W; s.y = Math.random() * H * 0.55; s.vy = -1.2 - Math.random() * 3.5; }
        const a = 1 - s.age / s.life;
        ctx.fillStyle = `hsla(${s.hue},95%,65%,${a})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(0.01, s.r), 0, 7); ctx.fill();
      }
      for (let i = boom.length - 1; i >= 0; i--) {
        const s = boom[i]; s.age++; s.x += s.vx; s.y += s.vy; s.vy += 0.05;
        const a = 1 - s.age / s.life;
        ctx.fillStyle = `hsla(${s.hue},100%,60%,${a})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(0.01, s.r * a), 0, 7); ctx.fill();
        if (s.age >= s.life) boom.splice(i, 1);
      }
    };
    stopFx(); frame();
  }
  function setRevealPhase(phase) {
    st.revealPhase = phase;
    $('df-ask-view').hidden = phase !== 'ask';
    $('df-name-view').hidden = phase !== 'name';
    if (phase === 'name') { $('df-name').value = ''; $('df-name').focus(); }
  }
  async function showReveal() {
    const c = await composePac(stickerUrls(), { pac: bagUrl(st.bag), ink: st.ink });
    st.pacImg = c;
    const out = $('df-reveal-canvas').getContext('2d'); out.clearRect(0, 0, PW, PH); out.drawImage(c, 0, 0);
    $('df-wow').textContent = S.doorWow || 'wow you made a sticker pack';
    $('df-ask-q').textContent = S.doorNameAsk || 'Would you like to name your pack?';
    $('df-name-yes').textContent = S.doorNameYes || 'yes';
    $('df-name-no').textContent = S.doorNameNo || 'no';
    $('df-name').placeholder = S.doorNamePac || 'name your pack';
    $('df-name-go').textContent = S.doorDone || 'done';
    const words = $('df-reveal-words'); words.textContent = '';
    BURST_WORDS.forEach((w, i) => {
      const s = document.createElement('span'); s.className = 'df-w df-w-' + (i % 4); s.textContent = w; words.appendChild(s);
    });
    const burst = $('df-burst'); burst.textContent = '';
    for (let i = 0; i < 22; i++) {
      const sp = document.createElement('span'); sp.className = 'df-spark'; sp.style.setProperty('--a', String((i / 22) * 360));
      sp.style.setProperty('--d', `${0.35 + (i % 6) * 0.1}s`); burst.appendChild(sp);
    }
    setRevealPhase('ask');
    startFx();
  }
  function finishName() {
    st.pacName = $('df-name').value.trim().slice(0, 30);
    stopFx();
    showStep('done');
  }
  $('df-name-no').onclick = () => { st.pacName = ''; stopFx(); showStep('done'); };
  $('df-name-yes').onclick = () => setRevealPhase('name');
  $('df-name-go').onclick = () => finishName();
  $('df-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finishName(); }
  });

  async function showDone() {
    const c = st.pacImg || await composePac(stickerUrls(), { pac: bagUrl(st.bag), ink: st.ink });
    st.pacImg = c;
    const out = $('df-done-canvas').getContext('2d'); out.clearRect(0, 0, PW, PH); out.drawImage(c, 0, 0);
    $('df-done-name').textContent = st.pacName || '';
    $('df-done-name').hidden = !st.pacName;
    // Final choice after name (or decline): back to room / to the city (trade stickers).
    $('df-room').textContent = S.doorBackRoom || 'back to room';
    $('df-city').textContent = S.doorToCityGo || 'To the city – trade your stickers';
  }
  function savePac() {
    const pac = {
      name: st.pacName, stickers: st.picked.map((d) => d.id), urls: st.picked.map((d) => d.url),
      designs: st.picked.map((d) => ({ id: d.id, url: d.url, ...(d.width ? { width: d.width, height: d.height } : {}) })),
      bag: st.bag, at: new Date().toISOString(),
    };
    try { pac.img = st.pacImg.toDataURL('image/webp', 0.85); localStorage.setItem(PAC_KEY, JSON.stringify(pac)); }
    catch { try { localStorage.setItem(PAC_KEY, JSON.stringify(pac)); } catch { /* full */ } }
    // Packs wheel (max 3): add, or ask which to replace.
    const r = addPack(pac);
    if (r.needsReplace) {
      openPackReplace(r.pending, { toast: st.opts.toast, onDone: () => st.opts.onPacksChange?.() });
    } else if (r.ok) {
      st.opts.toast?.(S.packsAdded || 'Pack saved on your PACKS wheel.', 2200);
      st.opts.onPacksChange?.();
    }
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

  function close() { stopFx(); box.hidden = true; st.step = null; hideAll(); }
  addEventListener('keydown', (e) => {
    if (box.hidden) return;
    const typing = e.target && (e.target.id === 'df-name' || e.target.id === 'df-city-name');
    if (typing) { if (e.key !== 'Escape') { e.stopImmediatePropagation(); return; } }
    if (e.key === 'Escape') {
      if (st.step === 'done') { savePac(); exitToRoom(); return; }
      if (st.step === 'reveal') {
        if (st.revealPhase === 'name') setRevealPhase('ask');
        else exitToRoom(); // Exit → room (no save yet)
      }
      else if (st.step === 'newcity') exitToRoom();
      else if (st.step === 'bags') showStep('pick'); // Back; ✕ exits to room
      else if (st.step === 'pick') close();
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
      $('df-draw').textContent = S.doorDraw || 'Draw';
      $('df-skip-design').textContent = S.doorSkip || 'Skip';
      $('df-back-bags').textContent = S.choiceBack;
      $('df-back-newcity').textContent = S.choiceBack;
      $('df-newcity-title').textContent = S.doorNewCityTitle || 'Start a new city?';
      $('df-newcity-note').textContent = S.doorNewCityNote || 'You are the city\'s first resident – do you want to name it?';
      $('df-city-name').placeholder = S.cpNamePlaceholder || 'e.g. Slapville';
      $('df-city-go').textContent = S.doorNewCityGo || 'Name it →';
      $('df-city-skip').textContent = S.doorSkip || 'Skip';
      showStep('pick');
    },
    close,
    state: () => ({
      open: !box.hidden, step: box.hidden ? null : st.step, picked: st.picked.map((d) => d.id),
      drawn: st.drawn, bag: st.bag, cityName: st.cityName, pacName: st.pacName, revealPhase: st.revealPhase,
    }),
    setBag,
  };
}
