// The name-tag / sticker drawing tool (Jens, 31 Oct 2026; mockups nametag-1..7): CREATE → STICKERS
// (or the old Esc NAME) opens a blank big on the screen. Swipe (or ‹ ›) through the blanks – Jens's
// own images, client/public/nametags/blank1..10.webp; drawn in code if they don't load – then draw on
// it: a colour picker (saturation/value square + hue bar), brush size, brush type (solid / opaque /
// dripping). "done" asks which sticker in the wheel the tag replaces (confirm yes/no), then hands the
// finished PNG back (main.js uploads it as my sticker); "exit" closes it without saving.
// Bottom bar order (Jens, Nov 2026): exit (left) – undo (middle) – done (right).
import { bindHoldRepeat } from './holdrepeat.js';
const TW = 800, TH = 536; // the blanks are 1623x1085 → 800 wide
let W = TW, H = TH; // the canvas size now (the door's Priority Mail pac is portrait: opts.size)
export const BLANKS = Array.from({ length: 10 }, (_, i) => `/nametags/blank${i + 1}.webp`);
// The code fallback: Jens's four tag colours and the white ones (used when an image fails to load).
const FALLBACK = ['#e8262d', '#f57a10', '#a46fe0', '#f2468f', '#ffffff', '#000000'];
export function drawFallbackBlank(ctx, i) {
  const col = FALLBACK[i % FALLBACK.length], tag = i < 4;
  const W = TW, H = TH;
  ctx.clearRect(0, 0, W, H);
  const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
  ctx.fillStyle = '#fff'; rr(0, 0, W, H, 36); ctx.fill();
  ctx.fillStyle = col; rr(10, 10, W - 20, H - 20, 30); ctx.fill();
  if (!tag) return;
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = '900 118px "Arial Black", Arial, sans-serif'; ctx.fillText('FUCK', W / 2, 128);
  ctx.font = '800 62px Arial, sans-serif'; ctx.fillText('my name is', W / 2, 196);
  rr(40, 226, W - 80, H - 270, 22); ctx.fill();
}
const BRUSHES = ['solid', 'opaque', 'dripping'];
const OPAQUE_ALPHA = 0.45;

function hsvToHex(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

let ui = null;
// opts: { S, choices: () => [{ id, url }] (wheel stickers it may replace), onSave: async (blob, replaceId) => void, toast }
export function openNameTag(opts) {
  if (!ui) ui = build();
  ui.open(opts);
  return ui;
}
export const nameTagOpen = () => !!ui && !ui.box.hidden;

function build() {
  const box = document.createElement('div'); box.id = 'nametag'; box.hidden = true;
  box.innerHTML = `
    <div class="nt-stage">
      <button type="button" class="nt-arrow" id="nt-prev" aria-label="previous">‹</button>
      <div class="nt-tag"><canvas id="nt-blank"></canvas><canvas id="nt-ink"></canvas><canvas id="nt-stroke"></canvas><div class="nt-clip" id="nt-clip" hidden></div></div>
      <button type="button" class="nt-arrow" id="nt-next" aria-label="next">›</button>
    </div>
    <div class="nt-dots" id="nt-dots"></div>
    <div class="nt-tools">
      <div class="nt-picker"><canvas id="nt-sv" width="200" height="200"></canvas><canvas id="nt-hue" width="26" height="200"></canvas></div>
      <div class="nt-side">
        <label class="nt-label"><span id="nt-size-label"></span><input id="nt-size" type="range" min="3" max="60" value="14"></label>
        <button type="button" class="nt-label nt-typebtn" id="nt-type"></button>
        <div class="nt-types" id="nt-types" hidden></div>
        <span class="nt-swatch" id="nt-swatch"></span>
      </div>
    </div>
    <div class="nt-bottom"><button type="button" id="nt-exit"></button><button type="button" id="nt-undo"></button><button type="button" id="nt-save"></button></div>
    <div class="nt-replace" id="nt-replace" hidden>
      <div class="nt-replace-title" id="nt-replace-title"></div>
      <div class="nt-grid" id="nt-grid"></div>
      <div class="nt-confirm" id="nt-confirm" hidden>
        <div class="nt-confirm-ask" id="nt-confirm-ask"></div>
        <div class="nt-confirm-btns">
          <button type="button" id="nt-confirm-no" class="nt-confirm-no"></button>
          <button type="button" id="nt-confirm-yes" class="nt-confirm-yes"></button>
        </div>
      </div>
      <button type="button" id="nt-replace-back"></button>
    </div>`;
  document.body.appendChild(box);
  const $ = (id) => box.querySelector('#' + id);
  const blank = $('nt-blank').getContext('2d'), ink = $('nt-ink').getContext('2d'), stroke = $('nt-stroke').getContext('2d');
  const st = { blanks: BLANKS, custom: false, i: 0, hue: 0, s: 1, v: 0.9, color: '#e6191f', size: 14, brush: 'solid', imgs: [], drips: [], raf: 0, undo: [], opts: null, fallback: new Set(), pickId: null };
  let S = {};

  // ---- blanks ----
  const imgCache = new Map(); // url -> Image | null
  function loadBlank(i) {
    const url = st.blanks[i];
    if (imgCache.has(url)) return Promise.resolve(imgCache.get(url));
    return new Promise((res) => { const im = new Image(); im.onload = () => { imgCache.set(url, im); res(im); }; im.onerror = () => res(null); im.src = url; });
  }
  async function showBlank(i) {
    st.i = (i + st.blanks.length) % st.blanks.length;
    const im = await loadBlank(st.i);
    blank.clearRect(0, 0, W, H);
    if (im) { blank.drawImage(im, 0, 0, W, H); st.fallback.delete(st.i); } else if (st.custom) st.fallback.add(st.i); else { drawFallbackBlank(blank, st.i); st.fallback.add(st.i); }
    [...$('nt-dots').children].forEach((d, k) => d.classList.toggle('on', k === st.i));
    box.dataset.blank = String(st.i + 1);
    st.opts?.onBlankChange?.(st.i);
  }
  for (let k = 0; k < BLANKS.length; k++) { const d = document.createElement('span'); d.onclick = () => showBlank(k); $('nt-dots').appendChild(d); }
  // Hold-to-repeat: keep flipping blanks while the arrow is held (touch + mouse).
  bindHoldRepeat($('nt-prev'), () => showBlank(st.i - 1));
  bindHoldRepeat($('nt-next'), () => showBlank(st.i + 1));

  // ---- colour ----
  const sv = $('nt-sv').getContext('2d'), hue = $('nt-hue').getContext('2d');
  function paintPicker() {
    const g1 = sv.createLinearGradient(0, 0, 200, 0); g1.addColorStop(0, '#fff'); g1.addColorStop(1, hsvToHex(st.hue, 1, 1));
    sv.fillStyle = g1; sv.fillRect(0, 0, 200, 200);
    const g2 = sv.createLinearGradient(0, 0, 0, 200); g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, '#000');
    sv.fillStyle = g2; sv.fillRect(0, 0, 200, 200);
    sv.strokeStyle = st.v > 0.5 ? '#000' : '#fff'; sv.lineWidth = 2; sv.beginPath(); sv.arc(st.s * 200, (1 - st.v) * 200, 6, 0, 7); sv.stroke();
    const g3 = hue.createLinearGradient(0, 0, 0, 200);
    for (let k = 0; k <= 6; k++) g3.addColorStop(k / 6, hsvToHex(k * 60 % 360, 1, 1));
    hue.fillStyle = g3; hue.fillRect(0, 0, 26, 200);
    hue.fillStyle = '#fff'; hue.fillRect(0, st.hue / 360 * 200 - 2, 26, 4);
    st.color = hsvToHex(st.hue, st.s, st.v);
    $('nt-swatch').style.background = st.color; box.dataset.color = st.color;
  }
  const drag = (el, fn) => {
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); fn(e); e.preventDefault(); });
    el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) fn(e); });
  };
  const rel = (el, e) => { const r = el.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
  drag($('nt-sv'), (e) => { const [x, y] = rel($('nt-sv'), e); st.s = x; st.v = 1 - y; paintPicker(); });
  drag($('nt-hue'), (e) => { const [, y] = rel($('nt-hue'), e); st.hue = Math.min(359.9, y * 360); paintPicker(); });

  // ---- size / type ----
  $('nt-size').oninput = () => { st.size = Number($('nt-size').value); };
  function setBrush(b) { st.brush = b; box.dataset.brush = b; $('nt-types').hidden = true; $('nt-type').textContent = `${S.ntBrushType}: ${S['ntBrush_' + b]}`; }
  $('nt-type').onclick = () => { $('nt-types').hidden = !$('nt-types').hidden; };
  for (const b of BRUSHES) {
    const t = document.createElement('button'); t.type = 'button'; t.className = 'nt-brush nt-brush-' + b; t.dataset.brush = b;
    t.innerHTML = `<span class="nt-blob"></span><span class="nt-bname"></span>`; t.onclick = () => setBrush(b); $('nt-types').appendChild(t);
  }

  // ---- drawing ----
  const tagEl = box.querySelector('.nt-tag'), strokeEl = $('nt-stroke');
  let last = null, sinceDrip = 0;
  const toTag = (e) => { const r = strokeEl.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H]; };
  function segment(ctx, a, b) {
    ctx.strokeStyle = st.color; ctx.lineWidth = st.size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  function maybeDrip(p, dist) {
    sinceDrip += dist;
    if (st.brush !== 'dripping' || sinceDrip < 26) return;
    sinceDrip = 0;
    if (Math.random() < 0.55) st.drips.push({ x: p[0] + (Math.random() - 0.5) * st.size * 0.5, y: p[1], len: 0, max: 25 + Math.random() * 110, w: st.size * (0.35 + Math.random() * 0.3), speed: 0.8 + Math.random() * 1.8, color: st.color });
    if (!st.raf) st.raf = requestAnimationFrame(runDrips);
  }
  function runDrips() {
    st.raf = 0;
    ink.lineCap = 'round';
    for (const d of st.drips) {
      const step = Math.min(d.speed, d.max - d.len); if (step <= 0) continue;
      ink.strokeStyle = d.color; ink.fillStyle = d.color; ink.lineWidth = d.w;
      ink.beginPath(); ink.moveTo(d.x, d.y + d.len); ink.lineTo(d.x, d.y + d.len + step); ink.stroke();
      d.len += step; d.speed *= 0.985;
      if (d.len >= d.max - 0.01 || d.speed < 0.15) { d.max = d.len; ink.beginPath(); ink.arc(d.x, d.y + d.len, d.w * 0.75, 0, 7); ink.fill(); }
    }
    st.drips = st.drips.filter((d) => d.len < d.max);
    if (st.drips.length) st.raf = requestAnimationFrame(runDrips);
  }
  // opts.clip {x, y, w, h} (canvas px; the door's pac label, t477u): drawing only inside it – a
  // stroke can't start outside, and the ink is clipped to it (drips too).
  const inClip = (p) => !st.clip || (p[0] >= st.clip.x && p[0] <= st.clip.x + st.clip.w && p[1] >= st.clip.y && p[1] <= st.clip.y + st.clip.h);
  strokeEl.addEventListener('pointerdown', (e) => {
    if (!inClip(toTag(e))) return;
    strokeEl.setPointerCapture(e.pointerId); e.preventDefault();
    st.undo.push(ink.getImageData(0, 0, W, H)); if (st.undo.length > 20) st.undo.shift();
    last = toTag(e); sinceDrip = 20;
    const ctx = st.brush === 'opaque' ? stroke : ink;
    strokeEl.style.opacity = st.brush === 'opaque' ? String(OPAQUE_ALPHA) : '1';
    segment(ctx, last, [last[0] + 0.01, last[1]]); maybeDrip(last, 0);
  });
  strokeEl.addEventListener('pointermove', (e) => {
    if (!last || !strokeEl.hasPointerCapture(e.pointerId)) return;
    const p = toTag(e); segment(st.brush === 'opaque' ? stroke : ink, last, p);
    maybeDrip(p, Math.hypot(p[0] - last[0], p[1] - last[1])); last = p;
  });
  const endStroke = () => {
    if (!last) return; last = null;
    if (st.brush === 'opaque') { ink.save(); ink.globalAlpha = OPAQUE_ALPHA; ink.drawImage(strokeEl, 0, 0); ink.restore(); stroke.clearRect(0, 0, W, H); }
  };
  strokeEl.addEventListener('pointerup', endStroke); strokeEl.addEventListener('pointercancel', endStroke);
  $('nt-undo').onclick = () => { const d = st.undo.pop(); if (d) { st.drips = []; ink.putImageData(d, 0, 0); } };

  // ---- save / exit / replace confirm ----
  function compose() {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'); x.drawImage($('nt-blank'), 0, 0); x.drawImage($('nt-ink'), 0, 0);
    return new Promise((res) => c.toBlob(res, 'image/png'));
  }
  function setPanelHidden(v) { document.body.classList.toggle('nametag-open', !!v); }
  function clearInk() {
    ink.clearRect(0, 0, W, H); stroke.clearRect(0, 0, W, H); st.undo = []; st.drips = [];
    cancelAnimationFrame(st.raf); st.raf = 0;
  }
  function clearConfirm() {
    st.pickId = null;
    $('nt-confirm').hidden = true;
    $('nt-grid').querySelectorAll('.nt-pick').forEach((b) => b.classList.remove('picked'));
  }
  function backToDraw({ discard = false } = {}) {
    clearConfirm();
    $('nt-replace').hidden = true;
    if (discard) clearInk();
  }
  function close() {
    if (!box.hidden) st.opts?.onClose?.();
    box.hidden = true; $('nt-replace').hidden = true; clearConfirm();
    cancelAnimationFrame(st.raf); st.raf = 0; st.drips = [];
    setPanelHidden(false);
  }
  $('nt-exit').onclick = close;
  // Back on the replace screen: keep the drawing, return to draw mode.
  $('nt-replace-back').onclick = () => backToDraw({ discard: false });
  // No: discard the newly drawn sticker and return to drawing mode.
  $('nt-confirm-no').onclick = () => backToDraw({ discard: true });
  $('nt-confirm-yes').onclick = async () => {
    const id = st.pickId; if (!id) return;
    const grid = $('nt-grid');
    grid.querySelectorAll('button').forEach((x) => { x.disabled = true; });
    $('nt-confirm-yes').disabled = true; $('nt-confirm-no').disabled = true;
    try { await st.opts.onSave(await compose(), id); close(); }
    catch (err) {
      st.opts.toast?.(err && err.message ? err.message : S.uploadFailed);
      grid.querySelectorAll('button').forEach((x) => { x.disabled = false; });
      $('nt-confirm-yes').disabled = false; $('nt-confirm-no').disabled = false;
    }
  };
  $('nt-save').onclick = async () => {
    if (st.opts.direct) { // the door's pac: no "replace" – the picture goes straight back
      try { await st.opts.onSave(await compose(), null); close(); } catch (err) { st.opts.toast?.(err && err.message ? err.message : S.uploadFailed); }
      return;
    }
    const grid = $('nt-grid'); grid.textContent = '';
    clearConfirm();
    for (const d of (st.opts.choices?.() || [])) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'nt-pick'; b.dataset.id = d.id;
      b.innerHTML = `<img loading="lazy" decoding="async" src="${d.url}" alt="">`;
      b.onclick = () => {
        // Highlight / lift the pick and ask "Replace this?"
        grid.querySelectorAll('.nt-pick').forEach((x) => x.classList.remove('picked'));
        b.classList.add('picked');
        st.pickId = d.id;
        $('nt-confirm').hidden = false;
        $('nt-confirm-ask').textContent = S.ntReplaceAsk || 'Replace this?';
        $('nt-confirm-yes').textContent = S.ntReplaceYes || 'yes';
        $('nt-confirm-no').textContent = S.ntReplaceNo || 'no';
        $('nt-confirm-yes').disabled = false; $('nt-confirm-no').disabled = false;
        // Bring the lifted sticker into view
        try { b.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); } catch { /* fine */ }
      };
      grid.appendChild(b);
    }
    $('nt-replace').hidden = false;
  };
  // While it is open the room gets no keys (no walking or wheel-turning behind it); Esc closes.
  addEventListener('keydown', (e) => {
    if (box.hidden || e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    if (e.key === 'Escape') {
      if (!$('nt-confirm').hidden) clearConfirm();
      else if (!$('nt-replace').hidden) backToDraw({ discard: false });
      else close();
    }
    else if (e.key === 'ArrowLeft') showBlank(st.i - 1); else if (e.key === 'ArrowRight') showBlank(st.i + 1);
    else if ((e.ctrlKey || e.metaKey) && e.key === 'z') $('nt-undo').click();
    e.stopImmediatePropagation();
  }, true);
  addEventListener('keyup', (e) => { if (!box.hidden) e.stopImmediatePropagation(); }, true);
  // Swipe on the tag with two fingers? No – one finger draws. The arrows and dots switch blanks; a
  // quick horizontal swipe in the empty space around the tag does too.
  let sx = null;
  box.querySelector('.nt-stage').addEventListener('pointerdown', (e) => { if (e.target === e.currentTarget) sx = e.clientX; });
  box.querySelector('.nt-stage').addEventListener('pointerup', (e) => { if (sx != null && Math.abs(e.clientX - sx) > 50) showBlank(st.i + (e.clientX < sx ? 1 : -1)); sx = null; });

  return {
    box,
    open(opts) {
      st.opts = opts; S = opts.S || {};
      $('nt-size-label').textContent = S.ntBrushSize; $('nt-save').textContent = S.ntSave; $('nt-exit').textContent = S.ntExit; $('nt-undo').textContent = S.ntUndo;
      $('nt-replace-title').textContent = S.ntReplace; $('nt-replace-back').textContent = S.choiceBack;
      $('nt-confirm-ask').textContent = S.ntReplaceAsk || 'Replace this?';
      $('nt-confirm-yes').textContent = S.ntReplaceYes || 'yes';
      $('nt-confirm-no').textContent = S.ntReplaceNo || 'no';
      box.querySelectorAll('.nt-brush').forEach((t) => { t.querySelector('.nt-bname').textContent = S['ntBrush_' + t.dataset.brush]; });
      setBrush(st.brush); paintPicker();
      st.custom = !!opts.blanks; st.blanks = opts.blanks || BLANKS;
      [W, H] = opts.size || [TW, TH];
      for (const c of [$('nt-blank'), $('nt-ink'), $('nt-stroke')]) { c.width = W; c.height = H; }
      tagEl.style.aspectRatio = `${W} / ${H}`; box.classList.toggle('nt-portrait', H > W);
      const many = st.blanks.length > 1;
      $('nt-prev').style.visibility = $('nt-next').style.visibility = many ? '' : 'hidden';
      $('nt-dots').hidden = !many || !!opts.hideDots;
      // Rebuild dots when blank count changes (door pac: 7 bags).
      const dots = $('nt-dots'); dots.textContent = '';
      for (let k = 0; k < st.blanks.length; k++) { const d = document.createElement('span'); d.onclick = () => showBlank(k); dots.appendChild(d); }
      if (opts.saveText) $('nt-save').textContent = opts.saveText;
      if (opts.exitText) $('nt-exit').textContent = opts.exitText;
      ink.clearRect(0, 0, W, H); stroke.clearRect(0, 0, W, H); st.undo = [];
      st.clip = opts.clip || null; clearConfirm(); $('nt-replace').hidden = true;
      for (const g of [ink, stroke]) { g.restore(); g.save(); if (st.clip) { g.beginPath(); g.rect(st.clip.x, st.clip.y, st.clip.w, st.clip.h); g.clip(); } }
      const cl = $('nt-clip'); cl.hidden = !st.clip;
      if (st.clip) Object.assign(cl.style, { left: `${st.clip.x / W * 100}%`, top: `${st.clip.y / H * 100}%`, width: `${st.clip.w / W * 100}%`, height: `${st.clip.h / H * 100}%` });
      // Zoom the tag so the label (clip) fills the stage – pac makeover draw step.
      if (opts.zoomClip) {
        box.classList.add('nt-zoom-clip');
        const L = opts.zoomClip;
        const ox = ((L.x + L.w / 2) / W) * 100, oy = ((L.y + L.h / 2) / H) * 100;
        const sc = Math.min(W / L.w, H / L.h) * 0.62;
        tagEl.style.transformOrigin = `${ox}% ${oy}%`;
        tagEl.style.transform = `scale(${sc})`;
      } else {
        box.classList.remove('nt-zoom-clip');
        tagEl.style.transformOrigin = '';
        tagEl.style.transform = '';
      }
      const start = Number.isFinite(opts.startBlank) ? opts.startBlank : (st.custom ? 0 : st.i);
      box.hidden = false; setPanelHidden(true); showBlank(start);
    },
    close,
    state: () => ({
      open: !box.hidden, clip: st.clip, blank: st.i + 1, brush: st.brush, color: st.color, size: st.size,
      fallback: [...st.fallback], replacing: !$('nt-replace').hidden, confirming: !$('nt-confirm').hidden,
      pickId: st.pickId, drips: st.drips.length,
      buttons: ['nt-exit', 'nt-undo', 'nt-save'].map((id) => ({ id, text: $(id).textContent })),
    }),
  };
}
export const nameTagState = () => (ui ? ui.state() : { open: false });
