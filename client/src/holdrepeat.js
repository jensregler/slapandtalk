// Hold-to-repeat for step buttons (Jens: "hjulen snurrar om man håller intryckt", 7 Nov 2026).
// First step on pointerdown; after `delay` ms, step every `every` ms until pointerup / leave / cancel.
// Works on mouse and touch (pointer events). A plain click from the keyboard (Space/Enter) still steps once.
export function bindHoldRepeat(el, step, { delay = 350, every = 90 } = {}) {
  if (!el || typeof step !== 'function') return () => {};
  let delayT = 0, everyT = 0, suppressClick = false, ptr = null;
  const clearTimers = () => { clearTimeout(delayT); clearInterval(everyT); delayT = everyT = 0; };
  const stop = () => {
    clearTimers();
    if (ptr != null) { try { el.releasePointerCapture?.(ptr); } catch { /* already released */ } ptr = null; }
  };
  const onDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    suppressClick = true;
    stop();
    ptr = e.pointerId;
    try { el.setPointerCapture?.(ptr); } catch { /* old browser */ }
    step();
    delayT = setTimeout(() => { everyT = setInterval(step, every); }, delay);
  };
  const onUp = () => stop();
  const onLeave = () => { if (ptr == null || !el.hasPointerCapture?.(ptr)) stop(); };
  const onClick = (e) => {
    if (suppressClick) { suppressClick = false; e.preventDefault(); e.stopPropagation(); return; }
    step(); // keyboard activation (Space / Enter)
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('lostpointercapture', onUp);
  el.addEventListener('pointerleave', onLeave);
  el.addEventListener('click', onClick);
  return () => {
    stop();
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.removeEventListener('lostpointercapture', onUp);
    el.removeEventListener('pointerleave', onLeave);
    el.removeEventListener('click', onClick);
  };
}
