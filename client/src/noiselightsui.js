// Esc → LIGHTS (Jens t892u, 13 Nov 2026): "Noise room lights" – the envelope follower and the four ceiling
// lamps one by one, big and clear. Every change shows at once (noiseSpeakers.setLights) and is kept in this
// browser (localStorage, noiselights.js). Copy settings → the JSON on the clipboard + in a big text box, so
// Jens can send it; Paste / Import takes it back; Reset → the original look.
import { ENV_SPEC, ENV_CHOICE, LAMP_SPEC, LAMP_IDS, LAMP_NAMES, SOURCES, SOURCE_NAMES, defaultLights, defaultLamp, cleanLights, loadLights, saveLights, lightsToText, lightsFromText } from './noiselights.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const LOGN = 1000;
const toPos = (s, v) => (s.log ? Math.round(Math.log(Math.max(s.min, v) / s.min) / Math.log(s.max / s.min) * LOGN) : v);
const fromPos = (s, p) => { if (!s.log) return Number(p); const v = s.min * Math.pow(s.max / s.min, Number(p) / LOGN); return Math.min(s.max, Math.max(s.min, Math.round(v / s.step) * s.step)); };
const decimals = (s) => (String(s.step).split('.')[1] || '').length;
const show = (s, v) => Number(v).toFixed(decimals(s));

export function initNoiseLightsUI({ noiseSpeakers, toast = () => {}, onOpenChange = () => {} } = {}) {
  let cfg = loadLights(), tab = 'env', open = false, saveT = 0, meterT = 0;
  const panel = el('aside'); panel.id = 'lights-panel'; panel.hidden = true; panel.setAttribute('aria-label', 'Noise room lights');
  document.body.appendChild(panel);
  // typing in a number / text box must not walk, slap or open things
  panel.addEventListener('keydown', (e) => { if (e.key !== 'Escape' && e.target.closest('input:not([type=range]):not([type=checkbox]), textarea, select')) e.stopPropagation(); });

  const apply = () => {
    // (cfg stays the same object: the open tab's rows hold on to cfg.env / cfg.lamps[id]; setLights cleans its own copy)
    if (noiseSpeakers) noiseSpeakers.setLights(cfg);
    clearTimeout(saveT); saveT = setTimeout(() => saveLights(cfg), 250);
  };
  const saveNow = () => { clearTimeout(saveT); saveLights(cfg); };

  // one big slider row: label, slider, an exact number box, and a short help line
  function slider(spec, key, get, set) {
    const row = el('div', 'nl-row'); row.dataset.key = key;
    const head = el('div', 'nl-head'); head.appendChild(el('label', 'nl-lab', spec.label));
    const box = el('input', 'nl-num'); box.type = 'number'; box.min = spec.min; box.max = spec.max; box.step = spec.step; box.value = show(spec, get());
    box.setAttribute('aria-label', spec.label);
    const unit = el('span', 'nl-unit', spec.unit || '');
    const wrap = el('span', 'nl-val'); wrap.append(box, unit); head.appendChild(wrap);
    const r = el('input', 'nl-range'); r.type = 'range';
    r.min = spec.log ? 0 : spec.min; r.max = spec.log ? LOGN : spec.max; r.step = spec.log ? 1 : spec.step; r.value = toPos(spec, get());
    r.setAttribute('aria-label', spec.label);
    r.addEventListener('input', () => { const v = fromPos(spec, r.value); set(v); box.value = show(spec, v); apply(); });
    box.addEventListener('change', () => { const n = Number(box.value); if (!Number.isFinite(n)) { box.value = show(spec, get()); return; } const v = Math.min(spec.max, Math.max(spec.min, n)); set(v); box.value = show(spec, v); r.value = toPos(spec, v); apply(); });
    const reset = el('button', 'nl-mini', '↺'); reset.type = 'button'; reset.title = 'Back to default (' + show(spec, spec.def) + ' ' + (spec.unit || '') + ')';
    reset.addEventListener('click', () => { set(spec.def); box.value = show(spec, spec.def); r.value = toPos(spec, spec.def); apply(); });
    head.appendChild(reset);
    row.append(head, r);
    if (spec.help) row.appendChild(el('div', 'nl-help', spec.help + '  (default ' + show(spec, spec.def) + (spec.unit ? ' ' + spec.unit : '') + ')'));
    return row;
  }
  function choice(label, list, names, get, set, key) {
    const row = el('div', 'nl-row'); row.dataset.key = key;
    row.appendChild(el('div', 'nl-lab', label));
    const seg = el('div', 'nl-seg');
    for (const v of list) {
      const b = el('button', 'nl-segbtn', names ? names[v] : String(v)); b.type = 'button'; b.dataset.v = v;
      if (get() === v) b.classList.add('on');
      b.addEventListener('click', () => { set(v); for (const x of seg.children) x.classList.toggle('on', x === b); apply(); });
      seg.appendChild(b);
    }
    row.appendChild(seg); return row;
  }
  function toggle(label, get, set, key) {
    const b = el('button', 'nl-toggle'); b.type = 'button'; b.dataset.key = key;
    const paint = () => { b.textContent = label + ': ' + (get() ? 'ON' : 'OFF'); b.classList.toggle('on', !!get()); b.setAttribute('aria-pressed', String(!!get())); };
    b.addEventListener('click', () => { set(!get()); paint(); apply(); }); paint(); return b;
  }

  function renderEnv(body) {
    const E = cfg.env;
    const meters = el('div', 'nl-meters');
    for (const id of ['A', 'B']) { const m = el('div', 'nl-meter'); m.dataset.id = id; m.append(el('span', 'nl-meter-lab', 'Speaker ' + id), el('span', 'nl-meter-bar'), el('span', 'nl-meter-num', '0 %')); m.querySelector('.nl-meter-bar').appendChild(el('i')); meters.appendChild(m); }
    body.appendChild(meters);
    body.appendChild(el('h3', null, 'Envelope follower (speakers A and B)'));
    for (const k of ['attackMs', 'releaseMs', 'holdMs', 'smoothMs']) body.appendChild(slider(ENV_SPEC[k], k, () => E[k], (v) => { E[k] = v; }));
    body.appendChild(el('h3', null, 'How loud = how bright'));
    for (const k of ['gainDb', 'threshold', 'full', 'curve']) body.appendChild(slider(ENV_SPEC[k], k, () => E[k], (v) => { E[k] = v; }));
    body.appendChild(el('h3', null, 'What it listens to'));
    body.appendChild(choice(ENV_CHOICE.band.label, ENV_CHOICE.band.list, ENV_CHOICE.band.names, () => E.band, (v) => { E.band = v; }, 'band'));
    body.appendChild(slider(ENV_SPEC.bandHz, 'bandHz', () => E.bandHz, (v) => { E.bandHz = v; }));
    body.appendChild(choice(ENV_CHOICE.window.label, ENV_CHOICE.window.list, null, () => E.window, (v) => { E.window = v; }, 'window'));
    body.appendChild(slider(ENV_SPEC.updateMs, 'updateMs', () => E.updateMs, (v) => { E.updateMs = v; }));
    body.appendChild(el('h3', null, 'All four lamps'));
    for (const k of ['master', 'rest']) body.appendChild(slider(ENV_SPEC[k], k, () => E[k], (v) => { E[k] = v; }));
  }
  function renderLamp(body, id) {
    const c = cfg.lamps[id];
    body.appendChild(el('h3', null, `Lamp ${id} – ${LAMP_NAMES[id]}`));
    const top = el('div', 'nl-line');
    top.appendChild(toggle('Lamp', () => c.on, (v) => { c.on = v; }, 'on'));
    top.appendChild(toggle('Invert (bright in silence)', () => c.invert, (v) => { c.invert = v; }, 'invert'));
    body.appendChild(top);
    const col = el('div', 'nl-row nl-colrow'); col.dataset.key = 'color';
    col.appendChild(el('div', 'nl-lab', 'Colour'));
    const pick = el('input', 'nl-color'); pick.type = 'color'; pick.value = c.color; pick.setAttribute('aria-label', 'Colour');
    const hexBox = el('input', 'nl-hex'); hexBox.type = 'text'; hexBox.value = c.color; hexBox.maxLength = 7; hexBox.setAttribute('aria-label', 'Colour code');
    const sw = el('div', 'nl-swatches');
    for (const h of ['#fff4e0', '#ffffff', '#ff2a2a', '#ff8a00', '#ffe600', '#30ff5a', '#00e5ff', '#2a5bff', '#a020ff', '#ff2ad4']) {
      const b = el('button', 'nl-sw'); b.type = 'button'; b.style.background = h; b.title = h; b.dataset.color = h;
      b.addEventListener('click', () => { c.color = h; pick.value = h; hexBox.value = h; apply(); }); sw.appendChild(b);
    }
    pick.addEventListener('input', () => { c.color = pick.value; hexBox.value = pick.value; apply(); });
    hexBox.addEventListener('change', () => { const t = hexBox.value.trim(); if (/^#?[0-9a-f]{6}$/i.test(t)) { c.color = (t[0] === '#' ? t : '#' + t).toLowerCase(); pick.value = c.color; apply(); } hexBox.value = c.color; });
    const cl = el('div', 'nl-line'); cl.append(pick, hexBox); col.append(cl, sw); body.appendChild(col);
    body.appendChild(choice('Follows', SOURCES, SOURCE_NAMES, () => c.source, (v) => { c.source = v; }, 'source'));
    for (const k of ['min', 'max', 'hue', 'reach', 'decay']) body.appendChild(slider(LAMP_SPEC[k], k, () => c[k], (v) => { c[k] = v; }));
    body.appendChild(el('h3', null, 'Move the lamp'));
    for (const k of ['dx', 'dy', 'dz']) body.appendChild(slider(LAMP_SPEC[k], k, () => c[k], (v) => { c[k] = v; }));
    const tools = el('div', 'nl-line');
    const all = el('button', 'nl-btn', 'Copy this lamp to all 4'); all.type = 'button'; all.dataset.act = 'copyall';
    all.addEventListener('click', () => { for (const o of LAMP_IDS) if (o !== id) cfg.lamps[o] = { ...c, source: cfg.lamps[o].source }; apply(); toast(`Lamp ${id}'s look on all four (each keeps its speaker)`, 2000); });
    const rs = el('button', 'nl-btn', 'Reset this lamp'); rs.type = 'button'; rs.dataset.act = 'resetlamp';
    rs.addEventListener('click', () => { cfg.lamps[id] = defaultLamp(id); apply(); render(); });
    tools.append(all, rs); body.appendChild(tools);
  }
  function renderShare(body) {
    body.appendChild(el('h3', null, 'Send your settings to Ulla'));
    body.appendChild(el('p', 'nl-help', 'Copy settings puts them on the clipboard and in the box below. Paste them in a message. To load settings: paste text in the box and press Import.'));
  }

  const head = el('div', 'nl-top');
  const h2 = el('h2', null, '💡 Noise room lights');
  const x = el('button', 'nl-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.addEventListener('click', () => close());
  head.append(h2, x);
  const status = el('div', 'nl-status');
  const tabs = el('div', 'nl-tabs');
  const body = el('div', 'nl-body');
  const bar = el('div', 'nl-bar');
  const text = el('textarea', 'nl-text'); text.hidden = true; text.spellcheck = false; text.setAttribute('aria-label', 'Settings as text');
  const mk = (label, act, fn) => { const b = el('button', 'nl-btn nl-big', label); b.type = 'button'; b.dataset.act = act; b.addEventListener('click', fn); return b; };
  const bCopy = mk('📋 Copy settings', 'copy', () => copySettings());
  const bPaste = mk('📥 Paste / Import', 'paste', () => pasteSettings());
  const bReset = mk('↺ Reset to defaults', 'reset', () => resetAll());
  bar.append(bCopy, bPaste, bReset);
  panel.append(head, status, tabs, body, bar, text);
  const TABS = [['env', 'Envelope'], ...LAMP_IDS.map((id) => [id, 'Lamp ' + id]), ['share', 'Share']];
  for (const [k, lab] of TABS) {
    const b = el('button', 'nl-tab', lab); b.type = 'button'; b.dataset.tab = k;
    b.addEventListener('click', () => { tab = k; render(); });
    tabs.appendChild(b);
  }

  function render() {
    for (const b of tabs.children) { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-pressed', String(b.dataset.tab === tab)); }
    panel.classList.toggle('nl-sharing', tab === 'share'); // the text box takes the free space
    const keep = body.scrollTop; body.textContent = '';
    if (tab === 'env') renderEnv(body); else if (tab === 'share') { renderShare(body); text.hidden = false; if (!text.value) text.value = lightsToText(cfg); } else renderLamp(body, tab);
    body.scrollTop = keep; paintStatus();
  }
  function paintStatus() {
    const i = noiseSpeakers ? noiseSpeakers.info() : null;
    status.textContent = !noiseSpeakers ? 'Only in a city: the lights of the NOISE room (plot 7).'
      : i.inRoom ? '🎵 You are in the noise room: every change shows right away.'
        : i.inside ? '🎵 By the noise room: every change shows right away.'
          : 'Walk into the NOISE room (plot 7) to see the music move the lights. Colour, reach and place show from anywhere.';
    status.classList.toggle('live', !!(i && i.inside));
    for (const m of panel.querySelectorAll('.nl-meter')) {
      const p = i && i.players.find((q) => q.id === m.dataset.id), lv = p ? Math.max(0, Math.min(1, p.shown ?? p.level)) : 0;
      m.querySelector('i').style.width = Math.round(lv * 100) + '%'; m.querySelector('.nl-meter-num').textContent = Math.round(lv * 100) + ' %';
    }
  }
  async function copySettings() {
    saveNow(); const t = lightsToText(cfg); text.value = t; text.hidden = false;
    let ok = false; try { await navigator.clipboard.writeText(t); ok = true; } catch { try { text.focus(); text.select(); ok = document.execCommand('copy'); } catch { ok = false; } }
    toast(ok ? 'Light settings copied – paste them in a message to Ulla' : 'Select the text in the box and copy it', 2600);
    text.scrollIntoView?.({ block: 'nearest' });
  }
  async function pasteSettings() {
    if (text.hidden || !text.value.trim()) {
      text.hidden = false; text.value = '';
      try { const t = await navigator.clipboard.readText(); if (t && t.includes('{')) text.value = t; } catch { /* no permission: paste by hand */ }
    }
    if (!text.value.trim()) { text.placeholder = 'Paste the settings here, then press Paste / Import again'; text.focus(); bPaste.textContent = '✅ Import'; return; }
    try { cfg = lightsFromText(text.value); apply(); saveNow(); render(); toast('Light settings imported', 2000); bPaste.textContent = '📥 Paste / Import'; text.value = lightsToText(cfg); }
    catch (e) { toast('Could not read those settings: ' + (e.message || e), 3000); }
  }
  function resetAll() {
    if (bReset.dataset.sure !== '1') { bReset.dataset.sure = '1'; bReset.textContent = 'Sure? Click again'; setTimeout(() => { bReset.dataset.sure = ''; bReset.textContent = '↺ Reset to defaults'; }, 3000); return; }
    bReset.dataset.sure = ''; bReset.textContent = '↺ Reset to defaults';
    cfg = defaultLights(); apply(); saveNow(); if (!text.hidden) text.value = lightsToText(cfg); render(); toast('Lights back to the original look', 1800);
  }
  function openPanel() {
    cfg = loadLights(); open = true; panel.hidden = false; text.hidden = tab !== 'share'; if (tab === 'share') text.value = lightsToText(cfg);
    render(); clearInterval(meterT); meterT = setInterval(paintStatus, 100); onOpenChange(true);
  }
  function close() {
    if (!open) return; saveNow(); open = false; panel.hidden = true; clearInterval(meterT); onOpenChange(false);
  }
  return {
    open: openPanel, close, isOpen: () => open,
    settings: () => cleanLights(cfg),
    setTab: (k) => { tab = k; if (open) render(); },
    info: () => ({ open, tab, settings: cleanLights(cfg), status: status.textContent }),
  };
}
