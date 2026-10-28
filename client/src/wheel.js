// The sticker wheel (shared/wheel.mjs has the maths): the sticker tray as a round reel that never
// ends. Desktop: the strip along the bottom edge (R/F, the mouse wheel / trackpad, drag, click).
// Touch: the same reel in a band above the joystick and the stack, up while you swipe it (on the
// stack sideways, or on the band itself) and a moment after.
//
// Each sticker is a <button class="strip-th" data-id> (translate only, and the drop shadow – light
// from above, so the shadow stays straight below however the sticker turns) holding a <span>
// (rotate + scale) holding the <img> (saturation). Only the stickers in reach are drawn.
import { wrapDist, indexAt, targetFor, itemAt, reach, mod } from '../../shared/wheel.mjs';

export function createWheel(row, o) {
  // o: { pick(img), touch, onActivity() }
  let list = [], key = '', btns = [], pos = 0, target = 0, placed = false, raf = 0, last = 0;
  let drag = null, wheelIdle = 0, selId = null, suppressClick = false;
  const dims = () => {
    const cs = getComputedStyle(row), item = parseFloat(cs.getPropertyValue('--wheel-item')) || 88;
    return { item, first: item * 0.82, gap: item * 0.5, half: row.clientWidth / 2 };
  };

  function setList(next) {
    const k = next.map((d) => d.id + d.url).join();
    list = next;
    if (k === key) return;
    key = k; row.innerHTML = ''; btns = [];
    for (const d of next) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'strip-th'; b.dataset.id = d.id; b.setAttribute('role', 'option'); b.tabIndex = -1;
      b.innerHTML = `<span class="wh-turn"><img src="${d.url}" alt="" loading="lazy" draggable="false"></span>`;
      b.onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (suppressClick) { suppressClick = false; return; }
        const img = list.find((x) => x.id === d.id); if (img) { o.onActivity?.(); o.pick(img); }
      };
      row.appendChild(b); btns.push(b);
    }
    if (selId != null) { const i = list.findIndex((d) => d.id === selId); if (i >= 0) { pos = target = i; placed = true; } }
    kick();
  }

  // The held sticker changed (R/F, a click, the book, a swipe …): turn to it the short way round.
  function setSelected(id) {
    selId = id;
    const i = list.findIndex((d) => d.id === id), n = list.length;
    for (const b of btns) { const on = b.dataset.id === id; b.classList.toggle('sel', on); b.setAttribute('aria-selected', String(on)); }
    if (i < 0 || !n) return;
    if (!placed) { pos = target = i; placed = true; }
    else if (!drag && indexAt(target, n) !== i) target = targetFor(i, target, n);
    kick();
  }

  function kick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } }
  function tick(t) {
    raf = 0;
    const dt = Math.min(0.1, Math.max(0, (t - last) / 1000)); last = t;
    if (!drag) {
      const k = 1 - Math.exp(-dt * 16);
      pos += (target - pos) * k;
      if (Math.abs(target - pos) < 0.002) pos = target;
    }
    render();
    if (drag || pos !== target) raf = requestAnimationFrame(tick);
  }

  function render() {
    const n = list.length; if (!n) return;
    const { item, first, gap, half } = dims();
    const r = reach(half - item * 0.35, first, gap);
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i], d = wrapDist(i, pos, n);
      if (Math.abs(d) > r + 0.5) { if (b.style.display !== 'none') b.style.display = 'none'; continue; }
      const it = itemAt(d, { n, first, gap, reachN: r });
      b.style.display = '';
      b.style.transform = `translate(${it.x.toFixed(1)}px, ${it.y.toFixed(1)}px)`;
      b.style.zIndex = String(it.z); b.style.opacity = it.op.toFixed(3);
      b.style.pointerEvents = it.op > 0.5 ? '' : 'none';
      b.dataset.d = d.toFixed(3);
      const turn = b.firstElementChild;
      turn.style.transform = `rotate(${it.rot.toFixed(2)}deg) scale(${it.scale.toFixed(3)})`;
      turn.firstElementChild.style.filter = `saturate(${it.sat.toFixed(3)})`;
    }
  }

  // Settle on the sticker nearest the middle and hold it.
  function settle(to) {
    const n = list.length; if (!n) return;
    target = Math.round(to);
    const img = list[indexAt(target, n)];
    if (img && img.id !== selId) o.pick(img);
    kick();
  }

  // ---- Turning it by hand: drag (finger or mouse), the mouse wheel / trackpad ----
  function beginDrag(x) { drag = { x, pos, lastX: x, lastT: performance.now(), v: 0, moved: false }; o.onActivity?.(); kick(); }
  function dragTo(x) {
    if (!drag) return;
    const { gap } = dims(), t = performance.now();
    if (Math.abs(x - drag.x) > 6) drag.moved = true;
    const dtm = Math.max(1, t - drag.lastT); drag.v = 0.7 * drag.v + 0.3 * ((x - drag.lastX) / dtm); drag.lastX = x; drag.lastT = t;
    pos = target = drag.pos - (x - drag.x) / gap; // finger left → the reel follows it → the next one comes in from the right
    o.onActivity?.(); kick();
  }
  function endDrag() {
    if (!drag) return false;
    if (performance.now() - drag.lastT > 90) drag.v = 0; // held still before letting go: no fling
    const { gap } = dims(), moved = drag.moved, fling = Math.max(-4, Math.min(4, (-drag.v * 140) / gap));
    drag = null;
    if (moved) settle(pos + fling); else kick();
    o.onActivity?.();
    return moved;
  }
  row.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    e.stopPropagation(); beginDrag(e.clientX); drag.pid = e.pointerId;
  });
  row.addEventListener('pointermove', (e) => {
    if (!drag) return;
    dragTo(e.clientX);
    // only a real drag captures the pointer (a plain tap/click stays a click on that sticker)
    if (drag.moved && !drag.cap) { drag.cap = true; try { row.setPointerCapture(e.pointerId); } catch { /* synthetic */ } }
  });
  row.addEventListener('pointerup', () => {
    if (endDrag()) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
  });
  row.addEventListener('pointercancel', () => { endDrag(); });
  row.addEventListener('wheel', (e) => {
    e.preventDefault(); e.stopPropagation();
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const px = e.deltaMode === 1 ? delta * 33 : e.deltaMode === 2 ? delta * 300 : delta;
    target += px / 100; // one mouse-wheel notch = one sticker; a trackpad turns it smoothly
    o.onActivity?.(); kick();
    clearTimeout(wheelIdle); wheelIdle = setTimeout(() => settle(target), 160);
  }, { passive: false });
  addEventListener('resize', () => kick());

  return {
    setList, setSelected, beginDrag, dragTo, endDrag, render: kick,
    // for the tests / the debug hook
    info: () => ({ pos, target, n: list.length, index: list.length ? indexAt(pos, list.length) : -1, dragging: !!drag,
      items: btns.filter((b) => b.style.display !== 'none').map((b) => ({ id: b.dataset.id, d: Number(b.dataset.d), z: Number(b.style.zIndex), op: Number(b.style.opacity) })) }),
    mod,
  };
}
