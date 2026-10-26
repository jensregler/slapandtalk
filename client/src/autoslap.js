// Auto-slap (shared/autoslap.mjs): the held sticker slaps by itself at the crosshair on a step
// sequence, on the room's Groove bar (default) or at a free rate. This file: the settings (kept in
// localStorage 'klibb.autoslap', except on/off), the editor in ⚙ More → Sound → Auto-slap, the
// readout chip, and tick() – called every frame by main.js, which decides whether a slap may fire
// (canFire) and does it through the normal slap path (fire).
import { AUTO, STEP_PARAMS, cleanSettings, setLen, setStep, visibleSteps, sliderToRate, rateToSlider, stepRate, rateLabel,
  stepMs, effectiveRate, stepAt, createClock } from '../../shared/autoslap.mjs';
import { barsAt, barMs } from '../../shared/groove.mjs';

const KEY = 'klibb.autoslap';
const load = () => { try { return cleanSettings(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return cleanSettings(null); } };
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } };
// The first bool param is what a click on a step cell toggles; the rest get controls in the step row.
const TOGGLE = Object.keys(STEP_PARAMS).find((k) => STEP_PARAMS[k].type === 'bool');
const DETAIL = Object.keys(STEP_PARAMS).filter((k) => k !== TOGGLE);

export function initAutoSlap({ $, S, groove, canUse, canFire, fire, onPause = () => {} }) {
  const st = { on: false, settings: load(), clock: createClock(), t0: 0, sel: 0, now: -1, fired: 0, skipped: {}, paused: true, playing: -1 };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const bar = () => barMs(groove.scale);

  function set(patch) { st.settings = cleanSettings({ ...st.settings, ...patch }); save(st.settings); render(); }
  function setOn(on) {
    on = !!on && canUse();
    if (on === st.on) { render(); return st.on; }
    st.on = on; st.clock.reset(); st.t0 = groove.now(); st.paused = true;
    if (!on) onPause('off');
    render(); return st.on;
  }

  // ---------- Editor ----------
  const box = $('auto-box');
  $('auto-on').onchange = (e) => setOn(e.target.checked);
  $('auto-mode').onchange = (e) => set({ mode: e.target.value });
  $('auto-bars').onchange = (e) => set({ bars: Number(e.target.value) });
  $('auto-rate').oninput = (e) => set({ rate: sliderToRate(e.target.value) });
  $('auto-len').onchange = (e) => set({ seq: setLen(st.settings.seq, e.target.value) });
  $('auto-len-dn').onclick = () => set({ seq: setLen(st.settings.seq, st.settings.seq.len - 1) });
  $('auto-len-up').onclick = () => set({ seq: setLen(st.settings.seq, st.settings.seq.len + 1) });
  for (const v of AUTO.bars) { const o = el('option', null, S.aslapBars(v)); o.value = String(v); $('auto-bars').append(o); }
  const grid = $('auto-steps'), detail = $('auto-step');
  function renderGrid() {
    const steps = visibleSteps(st.settings.seq), n = steps.length;
    grid.style.setProperty('--cols', String(n <= 8 ? n : n <= 16 ? 8 : 16)); // rows of 8 (≤ 16 steps) or 16 (17–32)
    grid.classList.toggle('dense', n > 16);
    while (grid.children.length > n) grid.lastChild.remove();
    while (grid.children.length < n) {
      const i = grid.children.length, c = el('button', 'auto-cell'); c.type = 'button'; c.dataset.i = String(i);
      c.onclick = (e) => { const k = Number(c.dataset.i); st.sel = k; if (!e.shiftKey && TOGGLE) set({ seq: setStep(st.settings.seq, k, { [TOGGLE]: !st.settings.seq.steps[k][TOGGLE] }) }); else render(); };
      c.onwheel = (e) => { if (!DETAIL.length) return; e.preventDefault(); const k = Number(c.dataset.i), p = DETAIL[0], spec = STEP_PARAMS[p];
        const d = (spec.max - spec.min) / 20 * (e.deltaY < 0 ? 1 : -1); set({ seq: setStep(st.settings.seq, k, { [p]: st.settings.seq.steps[k][p] + d }) }); };
      grid.append(c);
    }
    steps.forEach((s, i) => {
      const c = grid.children[i];
      c.classList.toggle('on', TOGGLE ? !!s[TOGGLE] : true); c.classList.toggle('sel', i === st.sel); c.classList.toggle('now', i === st.playing);
      if (DETAIL.length) { const p = DETAIL[0], spec = STEP_PARAMS[p]; c.style.setProperty('--fill', String((s[p] - spec.min) / (spec.max - spec.min))); }
      c.title = S.aslapStepTitle(i + 1, Object.entries(s).map(([k, v]) => `${STEP_PARAMS[k].label}: ${typeof v === 'boolean' ? (v ? '✓' : '–') : v}`).join(' · '));
    });
    if (st.sel >= n) st.sel = n - 1;
    // the selected step's other params (one control per schema entry)
    detail.replaceChildren(el('span', 'auto-step-n', S.aslapStepN(st.sel + 1)));
    for (const p of DETAIL) {
      const spec = STEP_PARAMS[p], v = st.settings.seq.steps[st.sel][p], lab = el('span', 'auto-param');
      lab.append(el('span', null, spec.short || spec.label));
      const inp = el('input'); inp.dataset.param = p;
      if (spec.type === 'bool') { inp.type = 'checkbox'; inp.checked = v; inp.onchange = () => set({ seq: setStep(st.settings.seq, st.sel, { [p]: inp.checked }) }); }
      else { inp.type = 'range'; inp.min = spec.min; inp.max = spec.max; inp.step = spec.type === 'int' ? 1 : (spec.max - spec.min) / 100; inp.value = v;
        inp.oninput = () => set({ seq: setStep(st.settings.seq, st.sel, { [p]: Number(inp.value) }) }); }
      lab.append(inp, el('span', 'auto-param-v', spec.type === 'bool' ? '' : String(v))); detail.append(lab);
    }
  }
  function render() {
    const ok = canUse(), s = st.settings;
    box.hidden = !ok;
    if (!ok && st.on) { st.on = false; onPause('off'); }
    $('auto-on').checked = st.on;
    $('auto-mode').value = s.mode; $('auto-bars').value = String(s.bars);
    $('auto-bars-row').hidden = s.mode !== 'bar'; $('auto-rate-row').hidden = s.mode !== 'free';
    if (document.activeElement !== $('auto-rate')) $('auto-rate').value = rateToSlider(s.rate);
    $('auto-rate-val').textContent = rateLabel(s.rate);
    if (document.activeElement !== $('auto-len')) $('auto-len').value = String(s.seq.len);
    const eff = effectiveRate(s, bar());
    $('auto-eff').textContent = S.aslapEffective(rateLabel(Number(eff.toPrecision(2))), 1000 / stepMs(s, bar()) > eff + 0.01);
    renderGrid();
    const chip = $('auto-chip'); chip.hidden = !st.on;
    chip.textContent = S.aslapChip(s.mode === 'bar' ? `${s.seq.len}/${S.aslapBars(s.bars)}` : rateLabel(s.rate), st.paused);
    chip.classList.toggle('paused', st.paused);
  }

  // ---------- Every frame ----------
  function tick() {
    if (!st.on) return;
    const now = groove.now(), s = st.settings;
    const n = stepAt(s, { t: now, bars: barsAt(groove.groove, now), t0: st.t0 });
    const len = s.seq.len, idx = ((n % len) + len) % len;
    if (idx !== st.playing) { st.playing = idx; const cells = grid.children; for (let i = 0; i < cells.length; i++) cells[i].classList.toggle('now', i === idx); }
    const why = canFire();
    if (why !== true) { // paused (Look mode, a menu, chat, hidden tab …): no catching up afterwards
      if (!st.paused) { st.paused = true; onPause(why); render(); }
      st.clock.reset(); return;
    }
    if (st.paused) { st.paused = false; render(); }
    const f = st.clock.tick(s, n, now);
    if (!f) return;
    if (f.skipped) { st.skipped[f.skipped] = (st.skipped[f.skipped] || 0) + 1; return; }
    const r = fire(f.step, f);
    if (r === true) st.fired++; else st.skipped[r || 'other'] = (st.skipped[r || 'other'] || 0) + 1;
  }

  // ---------- Keys: H on/off; , and . slower/faster (free: the rate; on the beat: the length) ----------
  function key(code) {
    if (!canUse()) return false;
    const s = st.settings;
    if (code === 'KeyH') { setOn(!st.on); return true; }
    if (code === 'Comma' || code === 'Period') {
      const d = code === 'Period' ? 1 : -1;
      if (s.mode === 'free') set({ rate: stepRate(s.rate, d) }); else set({ seq: setLen(s.seq, s.seq.len + d) });
      return true;
    }
    return false;
  }
  render();
  return {
    setOn, toggle: () => setOn(!st.on), tick, key, render, set,
    get on() { return st.on; },
    info: () => ({ on: st.on, paused: st.paused, fired: st.fired, skipped: { ...st.skipped }, playing: st.playing, settings: JSON.parse(JSON.stringify(st.settings)),
      stepMs: stepMs(st.settings, bar()), effective: effectiveRate(st.settings, bar()), hidden: box.hidden, cells: grid.children.length, chip: $('auto-chip').hidden ? '' : $('auto-chip').textContent }),
  };
}
