// 📷 Photo (button or P): a still of exactly the current view – live (first or third person, or
// through a camera) or any replay view (director, angles, auto cameramen, placed cameras, POV).
// Rendered again at a good size (≥ 1920 px wide, 2× the screen, at most 3840) straight from the
// 3D scene, so no HTML UI is in it; the caller hides in-world chrome (aim preview, camera models)
// around the render. Then a soft shutter + flash, an instant download, and an upload
// (server/photos.js: photos/<room>/<id>.jpg, a /p/<id> link, kept like the videos).
// Free photos get the same small 'slap and talk' corner bug as free videos (cleanVideo removes it).
import CFG from '../../shared/video.json';
import { bugRect } from '../../shared/videoframe.mjs';
import { makeBug } from './videocomposer.js';
import { unlockHeaders } from './entitlements.js';

let bugImg = null;
const loadBug = () => (bugImg ||= new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = '/intro/bug-s2.png'; }));
export const photoName = (room, d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `slapandtalk-${room}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.jpg`;
};
export function photoSize(cssW, cssH, aspect = null) {
  const r = aspect || cssW / Math.max(1, cssH);
  let w = Math.min(3840, Math.max(1920, Math.round(cssW * 2)));
  let h = Math.round(w / r);
  if (h > 3840) { h = 3840; w = Math.round(h * r); }
  return { w: w - (w % 2), h: h - (h % 2) };
}

// A quiet shutter: two short filtered clicks. ctx = an AudioContext (or null = silent).
export function shutter(ctx, { muted = false } = {}) {
  if (!ctx || muted) return;
  try {
    const t = ctx.currentTime + 0.01, out = ctx.createGain(); out.gain.value = 0.18; out.connect(ctx.destination);
    for (const [at, f, len] of [[0, 2600, 0.035], [0.075, 1800, 0.05]]) {
      const n = Math.ceil(ctx.sampleRate * len), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
      const s = ctx.createBufferSource(); s.buffer = b;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 1.4;
      s.connect(bp); bp.connect(out); s.start(t + at);
    }
  } catch { /* no sound, still a photo */ }
}
export function flash() {
  let el = document.getElementById('photo-flash');
  if (!el) { el = document.createElement('div'); el.id = 'photo-flash'; document.body.appendChild(el); }
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
}

// Render `camera` (a THREE camera) at photo size into a JPEG Blob. aspect: the view's own frame
// (a 9:16 camera) or null = the screen. Restores the renderer afterwards.
export async function capture({ THREE, renderer, scene, camera, aspect = null, free = true, hide = () => () => {} }) {
  const css = renderer.getSize(new THREE.Vector2()), pr = renderer.getPixelRatio();
  const { w, h } = photoSize(css.x, css.y, aspect);
  const was = { aspect: camera.aspect, scissor: renderer.getScissorTest() };
  const restoreScene = hide();
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const g = out.getContext('2d');
  try {
    renderer.setPixelRatio(1); renderer.setSize(w, h, false); renderer.setScissorTest(false); renderer.setViewport(0, 0, w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    g.drawImage(renderer.domElement, 0, 0, w, h); // same task as the render: the drawing buffer is still there
  } finally {
    restoreScene();
    renderer.setPixelRatio(pr); renderer.setSize(css.x, css.y, false);
    camera.aspect = was.aspect; camera.updateProjectionMatrix();
  }
  if (free) {
    const img = await loadBug();
    if (img) { const r = bugRect(w, h, img.width / img.height, { widthFraction: CFG.bug.widthFraction }); g.globalAlpha = CFG.bug.opacity; g.drawImage(makeBug(img, r.w, r.h), r.x, r.y); g.globalAlpha = 1; }
  }
  const blob = await new Promise((res) => out.toBlob(res, 'image/jpeg', 0.92));
  return { blob, w, h };
}
export function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
export async function upload(blob, { room, source = 'live', recId = '', view = '' }) {
  const q = new URLSearchParams({ source, ...(recId ? { rec: recId } : {}), ...(view ? { view } : {}) });
  const res = await fetch(`/api/rooms/${room}/photos?${q}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', ...unlockHeaders() }, body: blob });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Error ${res.status}`);
  return j; // { photo, shareUrl }
}
