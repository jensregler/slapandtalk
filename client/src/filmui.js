// The session film's screens (Jens, 5 Nov 2026, pt536u): "making your film…" (the film shows live
// while it is recorded, with a Skip), then the big question before the city: Watch / Download /
// Discard and go into the city. Skipping or any failure always ends in the city picker (onDone).
import { planFilm, filmChoice } from '../../shared/film.mjs';
import { makeFilmRenderer, recordFilm, canRecordFilm, playLive, filmMime } from './cinematic.js';

const CSS = `
#film-ui{position:fixed;inset:0;z-index:2000;background:rgba(8,6,16,.94);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2.2vh;color:#fff;font-family:system-ui,sans-serif;padding:3vh 3vw;box-sizing:border-box}
#film-ui[hidden]{display:none}
#film-ui h2{margin:0;font-size:clamp(26px,4.4vw,52px);font-weight:900;text-align:center}
#film-ui p{margin:0;font-size:clamp(16px,2.2vw,22px);opacity:.85;text-align:center;max-width:44em}
#film-ui .fu-stage{width:min(92vw,140vh);aspect-ratio:16/9;max-height:62vh;background:#000;border-radius:14px;overflow:hidden;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 40px rgba(0,0,0,.6)}
#film-ui .fu-stage canvas,#film-ui .fu-stage video{width:100%;height:100%;object-fit:contain;display:block}
#film-ui .fu-bar{width:min(80vw,700px);height:12px;border-radius:6px;background:#333;overflow:hidden}
#film-ui .fu-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#ff5fa8,#ffd34d)}
#film-ui .fu-btns{display:flex;flex-wrap:wrap;gap:16px;justify-content:center}
#film-ui button{font:800 clamp(18px,2.5vw,26px) system-ui,sans-serif;padding:18px 30px;min-width:min(80vw,260px);border-radius:16px;border:0;cursor:pointer;color:#111;background:#fff}
#film-ui button.fu-watch{background:#ffd34d}#film-ui button.fu-dl{background:#9fe7ff}#film-ui button.fu-go{background:#ff8fc4}
#film-ui button:disabled{opacity:.4;cursor:not-allowed}
#film-ui button.fu-skip{font-size:16px;padding:10px 20px;min-width:0;background:#444;color:#fff}
#film-ui .fu-note{font-size:15px;opacity:.7}
`;

let st = { phase: 'idle', plan: null, film: null, downloaded: false, choice: null, error: null };
export const filmState = () => ({ phase: st.phase, length: st.plan?.length || 0, scenes: st.plan?.scenes.map((s) => s.kind) || [], bytes: st.film?.blob.size || 0, mime: st.film?.mime || '', ext: st.film?.ext || '', downloaded: st.downloaded, choice: st.choice, error: st.error });
export const filmBlob = () => st.film?.blob || null;

function ui() {
  let el = document.getElementById('film-ui');
  if (el) return el;
  const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s);
  el = document.createElement('div'); el.id = 'film-ui'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  document.body.appendChild(el); return el;
}
const h = (tag, attrs = {}, kids = []) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e[k] = v; else e.setAttribute(k, v); } for (const k of kids) e.appendChild(k); return e; };

// Make the film and ask. events: the film log's events (the 'pack' already in). onDone(): into the city.
export async function runFilm({ events, room, name, model, look, wallMat, floorMat, radioUrl, pacUrl, onDone, onDiscard = () => {} }) {
  const el = ui();
  let finished = false;
  const done = () => { if (finished) return; finished = true; el.hidden = true; el.textContent = ''; st.phase = 'done'; try { onDone(); } catch { /* the city picker */ } };
  st = { phase: 'making', plan: planFilm(events, { room, name }), film: null, downloaded: false, choice: null, error: null };
  const plan = st.plan;
  // making: the film live + a progress bar + Skip
  el.textContent = ''; el.hidden = false;
  const stage = h('div', { class: 'fu-stage' }), bar = h('i');
  let skipped = false;
  el.append(h('h2', { text: '🎬 Making your film…' }), stage, h('div', { class: 'fu-bar' }, [bar]),
    h('button', { class: 'fu-skip', id: 'fu-skip', type: 'button', text: 'Skip – go to the city', onclick: () => { skipped = true; st.choice = 'skip'; onDiscard(); done(); } }));
  let fr = null;
  try {
    const small = Math.min(innerWidth, innerHeight) < 600;
    fr = await makeFilmRenderer({ model, look, name, room, wallMat, floorMat, radioUrl, pacUrl, plan, size: small ? [854, 480] : [1280, 720] });
    if (skipped) { fr.dispose(); return; }
    stage.appendChild(fr.canvas);
    st.renderer = fr;
    st.film = canRecordFilm() ? await recordFilm(fr, plan, { onProgress: (p) => { bar.style.width = (p * 100).toFixed(1) + '%'; } }) : null;
  } catch (err) { st.error = String(err?.message || err); console.warn('film', err); }
  if (skipped) { fr?.dispose(); return; }
  st.phase = 'ask';
  ask(el, fr, plan, done, onDiscard);
}

function ask(el, fr, plan, done, onDiscard) {
  const film = st.film, canDownload = !!film;
  const url = film ? URL.createObjectURL(film.blob) : null;
  el.textContent = '';
  const stage = h('div', { class: 'fu-stage' });
  const show = () => { // the last frame (the pack) as the poster
    if (url) { const v = h('video', { src: url, playsinline: '', controls: '', id: 'fu-video' }); v.muted = true; stage.textContent = ''; stage.appendChild(v); return v; }
    if (fr) { stage.textContent = ''; stage.appendChild(fr.canvas); fr.renderAt(plan.length - 0.05); }
    return null;
  };
  const vid = show();
  if (vid) vid.addEventListener('loadeddata', () => { if (vid.paused && vid.currentTime === 0) vid.currentTime = Math.max(0, plan.length - 0.3); }, { once: true });
  const btWatch = h('button', { class: 'fu-watch', id: 'fu-watch', type: 'button', text: '▶ Watch the film' });
  const btDl = h('button', { class: 'fu-dl', id: 'fu-download', type: 'button', text: `⬇ Download${film ? ' (' + film.ext + ')' : ''}` });
  const btGo = h('button', { class: 'fu-go', id: 'fu-discard', type: 'button', text: '✕ Discard and go into the city' });
  if (!canDownload) btDl.disabled = true;
  const finish = () => { if (url) setTimeout(() => URL.revokeObjectURL(url), 60_000); fr?.dispose(); st.renderer = null; done(); };
  btWatch.onclick = () => {
    const r = filmChoice('watch', { canDownload, downloaded: st.downloaded }); st.choice = 'watch';
    if (r.action !== 'play') return;
    if (vid) { vid.currentTime = 0; vid.play().catch(() => {}); } else if (fr) { stage.textContent = ''; stage.appendChild(fr.canvas); playLive(fr, plan); }
  };
  btDl.onclick = async () => {
    const r = filmChoice('download', { canDownload, downloaded: st.downloaded }); st.choice = 'download';
    if (r.action !== 'download') return;
    const file = `slapandtalk-film-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${film.ext}`;
    // iPhone/iPad: a download link opens the video in a new tab at best; the share sheet saves it to Photos/Files.
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    try {
      const f = new File([film.blob], file, { type: film.blob.type });
      if (ios && navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f], title: 'My Slap and Talk film' }); }
      else { const a = h('a', { href: url, download: file }); document.body.appendChild(a); a.click(); a.remove(); }
      st.downloaded = true; btGo.textContent = '➜ Go into the city';
    } catch (err) { if (err?.name !== 'AbortError') st.error = String(err?.message || err); }
  };
  btGo.onclick = () => { const r = filmChoice('discard', { canDownload, downloaded: st.downloaded }); st.choice = 'discard'; void r; onDiscard(); finish(); }; // the log goes either way
  el.append(h('h2', { text: '🎬 Your film is ready!' }), stage,
    h('p', { text: `${plan.scenes.length} scenes · ${plan.length.toFixed(1)} s${canDownload ? '' : ' · this browser can’t save videos – you can watch it here'}` }),
    h('div', { class: 'fu-btns' }, [btWatch, btDl, btGo]), h('p', { class: 'fu-note', text: 'The film is only on this device. After the city it is gone unless you download it.' }));
  btWatch.focus();
}
export { filmMime };
// Stills (tests, the report): the film's plan + any frame as a PNG.
export async function filmPreview({ events, room, name, size, ...rest }) {
  const plan = planFilm(events, { room, name });
  const fr = await makeFilmRenderer({ ...rest, name, room, plan, size: size || [1280, 720] });
  return { plan, frame: (t) => { fr.renderAt(t); return fr.canvas.toDataURL('image/png'); }, dispose: () => fr.dispose() };
}
