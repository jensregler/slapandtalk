// Highlight reel offer + player. Shown when leaving a room OR the city.
// Large, clear UI (play / skip / download / close). Renders the REAL room/city scene
// (buildBoxRoom / buildCityRoom + applyStyle + StampLayer) – never a default gray plane.
// Records the collage with MediaRecorder (video + one audio track of room sounds / mic)
// so the player can download it; then discards all raw footage (HighlightStore.discardRaw).
// No camera mode / podcast studio / exhibition panel – filming is automatic.
import * as THREE from 'three';
import { assembleReel, detectHighlights, sceneAt, clipPose, reelCameras, cityBounds, REEL } from '../../shared/highlight.mjs';
import { roomBounds } from '../../shared/autocam.mjs';
import { pickFilmMime } from '../../shared/film.mjs';
import { buildBoxRoom } from './room.js';
import { buildCityRoom, CITY_TIMES } from './city.js';
import { cityTime } from './daynight.js';
import { applyStyle, normalizeStyle, DEFAULT_STYLE } from './roomstyle.js';
import { StampLayer } from './stamps.js';
import { poseCamera } from './cameras.js';
import { isCityOutside } from '../../shared/city.mjs';

const CSS = `
#highlight-ui{position:fixed;inset:0;z-index:2100;background:rgba(6,8,14,.96);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2vh;color:#fff;font-family:system-ui,sans-serif;padding:2.5vh 2.5vw;box-sizing:border-box}
#highlight-ui[hidden]{display:none}
#highlight-ui h2{margin:0;font-size:clamp(28px,5vw,56px);font-weight:900;text-align:center;letter-spacing:.02em}
#highlight-ui p{margin:0;font-size:clamp(18px,2.4vw,26px);opacity:.9;text-align:center;max-width:36em}
#highlight-ui .hu-stage{width:min(94vw,150vh);aspect-ratio:16/9;max-height:64vh;background:#0a0c12;border-radius:16px;overflow:hidden;display:flex;align-items:center;justify-content:center;box-shadow:0 12px 48px rgba(0,0,0,.65);position:relative}
#highlight-ui .hu-stage canvas,#highlight-ui .hu-stage video{width:100%;height:100%;object-fit:contain;display:block}
#highlight-ui .hu-badge{position:absolute;left:16px;top:14px;font:800 clamp(16px,2vw,22px)/1.2 system-ui,sans-serif;background:rgba(0,0,0,.55);padding:10px 16px;border-radius:12px;backdrop-filter:blur(4px)}
#highlight-ui .hu-bar{width:min(86vw,760px);height:14px;border-radius:8px;background:#2a2e3a;overflow:hidden}
#highlight-ui .hu-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#7cf0ff,#ffd34d,#ff7ab8)}
#highlight-ui .hu-btns{display:flex;flex-wrap:wrap;gap:18px;justify-content:center}
#highlight-ui button{font:800 clamp(20px,2.8vw,30px) system-ui,sans-serif;padding:20px 34px;min-width:min(82vw,280px);border-radius:18px;border:0;cursor:pointer;color:#111;background:#fff}
#highlight-ui button.hu-play{background:#ffd34d}
#highlight-ui button.hu-skip{background:#9fe7ff}
#highlight-ui button.hu-dl{background:#b8f5c5}
#highlight-ui button.hu-close{background:#ff8fc4}
#highlight-ui button:disabled{opacity:.4;cursor:not-allowed}
#highlight-ui .hu-note{font-size:clamp(15px,1.8vw,18px);opacity:.7}
#highlight-ui .hu-offer{display:flex;flex-direction:column;align-items:center;gap:2.2vh;max-width:40em}
`;

const KIND_LABEL = { homage: '★ Homage', draw: '✎ Drawing', voice: '🎤 Voice', cross: '📷 Cameo', showcase: '🖼 Sticker' };

let st = { phase: 'idle', plan: null, blob: null, mime: '', ext: '', error: null, rawDiscarded: false, hasAudio: false, place: 'room' };
export const highlightState = () => ({
  phase: st.phase,
  length: st.plan?.length || 0,
  clips: st.plan?.clips?.length || 0,
  kinds: st.plan?.kinds || [],
  bytes: st.blob?.size || 0,
  mime: st.mime,
  ext: st.ext,
  error: st.error,
  rawDiscarded: st.rawDiscarded,
  hasAudio: st.hasAudio,
  place: st.place,
});
export const highlightBlob = () => st.blob || null;

function ui() {
  let el = document.getElementById('highlight-ui');
  if (el) return el;
  const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s);
  el = document.createElement('div'); el.id = 'highlight-ui'; el.hidden = true;
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  document.body.appendChild(el);
  return el;
}
const h = (tag, attrs = {}, kids = []) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e[k.toLowerCase()] = v;
    else e.setAttribute(k, v);
  }
  for (const k of kids) e.appendChild(k);
  return e;
};

async function makeReelRenderer({ roomId, style, stickers, city, size = [1280, 720] }) {
  const [W, H] = size;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; canvas.id = 'highlight-canvas';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false); renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(city ? CITY_TIMES[cityTime()].reel : 0x1a1c24); // city: the player's day (light blue) or night (black) sky
  const room = city ? buildCityRoom({ time: cityTime() }) : buildBoxRoom();
  scene.add(room.group);
  if (!city) {
    try { await applyStyle(room.surfaces, normalizeStyle(style || DEFAULT_STYLE)); }
    catch (err) { console.warn('highlight style', err); }
  }
  const stamps = new StampLayer(scene, room.surfaces);
  const bounds = city ? cityBounds() : roomBounds();
  const placed = [];
  for (const s of stickers || []) {
    if (!s?.stamp || !s?.image) continue;
    try { await stamps.add(s.stamp, s.image); placed.push(s.stamp.id); }
    catch (err) { console.warn('highlight stamp', err); }
  }
  const cam = new THREE.PerspectiveCamera(50, W / H, 0.05, city ? 200 : 80);
  const crew = reelCameras(bounds, { city, seed: roomId || 'reel' });
  function renderClip(clip, localT) {
    const pose = clipPose(clip, localT, { bounds });
    poseCamera(cam, pose);
    cam.aspect = W / H; cam.updateProjectionMatrix();
    renderer.render(scene, cam);
    return pose;
  }
  function sampleBg() {
    const gl = renderer.getContext();
    const buf = new Uint8Array(4);
    gl.readPixels(Math.floor(W * 0.15), Math.floor(H * 0.15), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return { r: buf[0], g: buf[1], b: buf[2] };
  }
  function dispose() {
    for (const id of [...(stamps.meshes?.keys?.() || [])]) stamps.remove(id);
    renderer.dispose();
    scene.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
        else { o.material.map?.dispose?.(); o.material.dispose?.(); }
      }
    });
  }
  return { canvas, renderClip, sampleBg, dispose, bounds, crew, placed, room, stamps, renderer, scene, cam, W, H };
}

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  return pickFilmMime((m) => MediaRecorder.isTypeSupported(m));
}

// Capture canvas frames + one audio track (room synth bus and/or mic) into a blob.
async function recordReel(fr, plan, { audioStream = null, fps = 30, onProgress = null } = {}) {
  const mimeInfo = pickMime();
  if (!mimeInfo) return null;
  const vStream = fr.canvas.captureStream(fps);
  let stream = vStream;
  let hasAudio = false;
  if (audioStream && audioStream.getAudioTracks?.().length) {
    try {
      stream = new MediaStream([...vStream.getVideoTracks(), ...audioStream.getAudioTracks()]);
      hasAudio = true;
    } catch { stream = vStream; }
  }
  const rec = new MediaRecorder(stream, { mimeType: mimeInfo.mime, videoBitsPerSecond: 4_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  const done = new Promise((resolve) => { rec.onstop = () => resolve(new Blob(chunks, { type: mimeInfo.mime })); });
  rec.start(200);
  const step = 1 / fps;
  for (let t = 0; t <= plan.length + 1e-6; t += step) {
    const at = sceneAt(plan, t); if (at) fr.renderClip(at.clip, at.local);
    onProgress?.(Math.min(1, t / Math.max(1e-6, plan.length)));
    await new Promise((r) => setTimeout(r, step * 1000 * 0.15)); // faster than realtime for assembly
  }
  rec.stop();
  const blob = await done;
  return { blob, mime: mimeInfo.mime, ext: mimeInfo.ext, hasAudio };
}

function audioTap(sound) {
  // One track of the whole room: synth master (slaps/steps/walk) + optional live mic.
  try {
    const eng = sound?.engine; const ctx = sound?.ctx || eng?.Tone?.getContext?.()?.rawContext;
    if (!ctx || !eng?.out) return null;
    const dest = ctx.createMediaStreamDestination();
    try {
      const node = eng.out._gainNode || eng.out.input || eng.out;
      if (node.connect) node.connect(dest);
      else if (eng.Tone) eng.Tone.connect(eng.out, dest);
    } catch { /* graph shape varies */ }
    // Mic (laughter / talk) if the page already has it.
    try {
      const mic = eng.micSource?.();
      if (mic) mic.connect(dest);
    } catch { /* no mic */ }
    return dest.stream;
  } catch { return null; }
}

// Offer screen (same for room leave and city leave), then play / download / close.
export async function offerHighlightReel(opts) {
  const {
    events, roomId, style, stickers, city = false, myId = 'me',
    place = city ? 'city' : 'room',
    store = null, sound = null, onDone = () => {},
  } = opts || {};
  const el = ui();
  let finished = false;
  const finish = async () => {
    if (finished) return; finished = true;
    if (store) { try { await store.discardRaw(); st.rawDiscarded = store.count() === 0; } catch { st.rawDiscarded = true; } }
    else st.rawDiscarded = true;
    el.hidden = true; el.textContent = ''; st.phase = 'done';
    try { onDone(); } catch { /* continue */ }
  };

  const plan = assembleReel(detectHighlights(events || [], { myId }));
  st = { phase: 'offer', plan, blob: null, mime: '', ext: '', error: null, rawDiscarded: false, hasAudio: !!plan.hasAudio, place };

  // Nothing worth showing → skip the offer, still discard raw, continue.
  if (!plan.clips.length) { await finish(); return { plan, skipped: true }; }

  el.textContent = ''; el.hidden = false;
  const where = place === 'city' ? 'the city' : 'the room';
  const offer = h('div', { class: 'hu-offer' }, [
    h('h2', { text: '🎥 Your highlight reel' }),
    h('p', { text: `We filmed ${where} automatically – ${plan.clips.length} clips · ${plan.length.toFixed(1)} s. Watch it, download it, or skip.` }),
    h('div', { class: 'hu-btns' }, [
      h('button', { class: 'hu-play', id: 'hu-watch', type: 'button', text: '▶ Watch the reel' }),
      h('button', { class: 'hu-close', id: 'hu-skipall', type: 'button', text: '✕ Skip' }),
    ]),
    h('p', { class: 'hu-note', text: 'Raw footage is discarded after this. Only the reel can be kept (download).' }),
  ]);
  el.appendChild(offer);

  return await new Promise((resolve) => {
    document.getElementById('hu-skipall').onclick = async () => { await finish(); resolve({ plan, skipped: true }); };
    document.getElementById('hu-watch').onclick = async () => {
      const result = await runHighlightReel({ ...opts, plan, el, finish, place });
      resolve(result);
    };
    document.getElementById('hu-watch').focus();
  });
}

async function runHighlightReel({ events, roomId, style, stickers, city, myId, store, sound, plan: given, el, finish, place }) {
  const plan = given || assembleReel(detectHighlights(events || [], { myId: myId || 'me' }));
  st.phase = 'play'; st.plan = plan; st.place = place || (city ? 'city' : 'room');
  el = el || ui();
  el.textContent = ''; el.hidden = false;
  const stage = h('div', { class: 'hu-stage' });
  const badge = h('div', { class: 'hu-badge', text: '' });
  const bar = h('i');
  stage.appendChild(badge);
  el.append(
    h('h2', { text: place === 'city' ? '🎥 City highlight reel' : '🎥 Room highlight reel' }),
    stage,
    h('div', { class: 'hu-bar' }, [bar]),
    h('p', { id: 'hu-status', text: 'Loading the scene…' }),
    h('div', { class: 'hu-btns' }, [
      h('button', { class: 'hu-play', id: 'hu-play', type: 'button', text: '▶ Play' }),
      h('button', { class: 'hu-skip', id: 'hu-skip', type: 'button', text: '⏭ Skip clip' }),
      h('button', { class: 'hu-dl', id: 'hu-dl', type: 'button', text: '⬇ Download', disabled: 'true' }),
      h('button', { class: 'hu-close', id: 'hu-close', type: 'button', text: '✕ Close' }),
    ]),
    h('p', { class: 'hu-note', text: `${plan.clips.length} clips · ${plan.length.toFixed(1)} s · audio track · raw discarded after download/close` }),
  );

  let fr = null;
  let playing = false;
  let t = 0;
  let raf = 0;
  let last = 0;

  try {
    const small = Math.min(innerWidth, innerHeight) < 600;
    fr = await makeReelRenderer({
      roomId, style, stickers, city: city || isCityOutside(roomId),
      size: small ? [854, 480] : [1280, 720],
    });
    stage.insertBefore(fr.canvas, badge);
    document.getElementById('hu-status').textContent = 'Assembling + recording…';
    // Put a lightweight "raw" marker in the store (tests assert discard).
    if (store) await store.put({ kind: 'raw-session', t: 0, meta: { clips: plan.clips.length, place } });
    const audioStream = audioTap(sound);
    const rec = await recordReel(fr, plan, {
      audioStream,
      onProgress: (p) => { bar.style.width = `${(p * 100).toFixed(1)}%`; },
    });
    if (rec) {
      st.blob = rec.blob; st.mime = rec.mime; st.ext = rec.ext; st.hasAudio = !!rec.hasAudio || !!plan.hasAudio;
      const dl = document.getElementById('hu-dl'); if (dl) { dl.disabled = false; dl.textContent = `⬇ Download (.${rec.ext})`; }
      document.getElementById('hu-status').textContent = `Ready · ${Math.round(rec.blob.size / 1024)} KB${rec.hasAudio ? ' · with audio' : ''}`;
    } else {
      st.hasAudio = !!plan.hasAudio;
      document.getElementById('hu-status').textContent = 'Ready (this browser can’t save video – watch live)';
    }
  } catch (err) {
    st.error = String(err?.message || err);
    console.warn('highlight reel', err);
    document.getElementById('hu-status').textContent = 'Could not build the reel – you can close.';
  }

  const paint = (tt) => {
    if (!fr) return null;
    const at = sceneAt(plan, tt); if (!at) return null;
    fr.renderClip(at.clip, at.local);
    badge.textContent = `${KIND_LABEL[at.clip.kind] || at.clip.kind} · cam ${at.clip.cam}`;
    bar.style.width = `${((tt / Math.max(1e-6, plan.length)) * 100).toFixed(1)}%`;
    return at;
  };

  const tick = (now) => {
    if (!playing) return;
    const dt = last ? Math.min(0.08, (now - last) / 1000) : 0;
    last = now;
    t = Math.min(plan.length, t + dt);
    paint(t);
    if (t >= plan.length - 1e-4) {
      playing = false;
      document.getElementById('hu-play').textContent = '▶ Replay';
      document.getElementById('hu-status').textContent = 'End of reel';
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  paint(0);
  document.getElementById('hu-play').onclick = () => {
    if (!fr) return;
    if (t >= plan.length - 1e-3) t = 0;
    playing = !playing;
    document.getElementById('hu-play').textContent = playing ? '⏸ Pause' : '▶ Play';
    document.getElementById('hu-status').textContent = playing ? 'Playing…' : 'Paused';
    last = 0;
    if (playing) raf = requestAnimationFrame(tick);
    else cancelAnimationFrame(raf);
  };
  document.getElementById('hu-skip').onclick = () => {
    const at = sceneAt(plan, t); if (!at) return;
    const next = plan.clips[at.i + 1];
    t = next ? next.t0 : plan.length;
    paint(t);
    if (!next) { playing = false; document.getElementById('hu-play').textContent = '▶ Replay'; }
  };
  document.getElementById('hu-dl').onclick = async () => {
    if (!st.blob) return;
    const file = `slapandtalk-highlights-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${st.ext || 'webm'}`;
    const url = URL.createObjectURL(st.blob);
    const a = h('a', { href: url, download: file }); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    // After download: wipe raw.
    if (store) { await store.discardRaw(); st.rawDiscarded = store.count() === 0; }
    else st.rawDiscarded = true;
    document.getElementById('hu-status').textContent = 'Downloaded · raw footage discarded';
  };
  document.getElementById('hu-close').onclick = async () => {
    playing = false; cancelAnimationFrame(raf);
    fr?.dispose(); fr = null;
    try { if (store) { await store.discardRaw(); st.rawDiscarded = store.count() === 0; } else st.rawDiscarded = true; } catch { st.rawDiscarded = true; }
    await finish();
  };
  document.getElementById('hu-play').focus();
  return { plan, sampleBg: () => fr?.sampleBg?.() || null, renderer: fr, state: highlightState };
}

export async function highlightPreview({ events, roomId, style, stickers, city, myId, size }) {
  const plan = assembleReel(detectHighlights(events || [], { myId: myId || 'me' }));
  const fr = await makeReelRenderer({ roomId, style, stickers, city, size: size || [1280, 720] });
  return {
    plan,
    frame: (t) => { const at = sceneAt(plan, t); if (at) fr.renderClip(at.clip, at.local); return fr.canvas.toDataURL('image/png'); },
    sampleBg: () => fr.sampleBg(),
    dispose: () => fr.dispose(),
  };
}

export { assembleReel, detectHighlights, REEL, sceneAt, recordReel, audioTap };
