// Finished videos from the replay page: one recording canvas that FIRST plays the animated
// logo intro (client/public/intro/, the frame shape picks 16:9, 9:16 or 1:1), then the replay.
// Free videos (no entitlements.full.cleanVideo) also get
//   - the 'slap and talk' channel bug in the top-right corner (like an old TV channel logo), and
//   - a small, calm link ticker along the bottom now and then (text + timing in shared/video.json).
// The intro sound (sat-intro-ljud.wav) is mixed in through WebAudio (MediaStreamDestination).
// Nothing here is image-generated: the bug is Jens's S2 logo sticker, softened in code.
import CFG from '../../shared/video.json';
import { pickIntro, INTRO_ASPECT, outputSize, containRect, bugRect, tickerSchedule, tickerAt } from '../../shared/videoframe.mjs';

const MIME = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1,mp4a', 'video/mp4'];
export const canRecordVideo = () => typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
export function pickMime() { return MIME.find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }) || ''; }

const loadImage = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
const timeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);

// The bug, prepared once: the logo, a soft shadow, a faint bevel light from the top and fine
// scanlines, so it reads as a broadcast "dog" rather than a sticker.
function makeBug(img, w, h) {
  const c = document.createElement('canvas'); c.width = Math.max(2, Math.round(w)); c.height = Math.max(2, Math.round(h));
  const g = c.getContext('2d');
  const pad = Math.max(1, Math.round(c.width * 0.04));
  g.filter = `blur(${Math.max(0.4, c.width / 260).toFixed(2)}px)`; // slightly soft
  g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = Math.max(2, c.width * 0.05); g.shadowOffsetY = Math.max(1, c.width * 0.012);
  g.drawImage(img, pad, pad, c.width - 2 * pad, c.height - 2 * pad);
  g.filter = 'none'; g.shadowColor = 'transparent';
  g.globalCompositeOperation = 'source-atop'; // bevel: light from above, only on the logo
  const lg = g.createLinearGradient(0, 0, 0, c.height);
  lg.addColorStop(0, 'rgba(255,255,255,0.22)'); lg.addColorStop(0.45, 'rgba(255,255,255,0)'); lg.addColorStop(1, 'rgba(0,0,0,0.18)');
  g.fillStyle = lg; g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-out'; // scanlines
  g.fillStyle = 'rgba(0,0,0,0.22)';
  for (let y = 0; y < c.height; y += 3) g.fillRect(0, y, c.width, 1);
  g.globalCompositeOperation = 'source-over';
  return c;
}

// source: the replay's WebGL canvas. free: draw the bug and the ticker. onIntroEnd: start the replay.
export async function createComposer({ source, free = true, onIntroEnd = () => {}, seed = Date.now(), audioCtx = null } = {}) {
  const { w, h } = outputSize(source.width, source.height, CFG.output.maxSide);
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const g = out.getContext('2d', { alpha: false });
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  const introKey = pickIntro(w, h);
  const st = { phase: 'loading', w, h, introKey, aspect: INTRO_ASPECT[introKey], free, intro: false, introFrames: 0, replayFrames: 0, replayStart: 0, bug: null, schedule: [], tickerShown: 0, audio: false };

  // ---- Intro video (webm VP9 where it plays, otherwise the mp4) ----
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto'; video.crossOrigin = 'anonymous';
  const webm = video.canPlayType('video/webm; codecs="vp9"');
  video.src = `/intro/sat-intro-${introKey}.${webm ? 'webm' : 'mp4'}`;
  const introReady = timeout(new Promise((res, rej) => {
    video.addEventListener('loadeddata', res, { once: true });
    video.addEventListener('error', () => rej(new Error('intro failed to load')), { once: true });
  }), 10000, 'intro');

  // ---- Intro sound -> MediaStreamDestination (also to the speakers, so you hear it) ----
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = audioCtx || (AC ? new AC() : null);
  let dest = null, sound = null;
  const soundReady = (async () => {
    if (!ctx) return;
    dest = ctx.createMediaStreamDestination();
    const buf = await (await fetch('/intro/sat-intro-ljud.wav')).arrayBuffer();
    sound = await new Promise((res, rej) => ctx.decodeAudioData(buf, res, rej));
  })().catch((e) => console.warn('[video] intro sound:', e && e.message));

  const bugImg = free ? loadImage('/intro/bug-s2.png').catch(() => null) : Promise.resolve(null);
  const [, , img] = await Promise.all([introReady.then(() => { st.intro = true; }).catch((e) => console.warn('[video]', e.message)), soundReady, bugImg]);
  if (free && img) {
    st.bug = bugRect(w, h, img.width / img.height, { widthFraction: CFG.bug.widthFraction });
    st.bugCanvas = makeBug(img, st.bug.w, st.bug.h);
  }

  // Background behind a letterboxed intro: the intro's own corner colour.
  const probe = document.createElement('canvas'); probe.width = probe.height = 1;
  const pg = probe.getContext('2d', { willReadFrequently: true });
  function drawIntro() {
    if (video.readyState < 2) return;
    pg.drawImage(video, 0, 0, 4, 4, 0, 0, 1, 1);
    const [r, gg, b] = pg.getImageData(0, 0, 1, 1).data;
    g.fillStyle = `rgb(${r},${gg},${b})`; g.fillRect(0, 0, w, h);
    const rc = containRect(video.videoWidth, video.videoHeight, w, h);
    g.drawImage(video, rc.x, rc.y, rc.w, rc.h);
    st.introFrames++;
  }
  function drawTicker(t) {
    const tk = tickerAt(st.schedule, t);
    if (!tk) return;
    const fs = Math.max(12, Math.round(Math.min(w, h) * 0.032));
    g.save();
    g.font = `500 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const tw = g.measureText(tk.text).width;
    const padX = fs * 0.8, bh = Math.round(fs * 1.9), bw = tw + padX * 2 + fs * 0.9;
    const m = Math.round(Math.min(w, h) * 0.035);
    const x = m - (1 - tk.k) * (bw + m), y = h - m - bh;
    g.globalAlpha = 0.25 + 0.75 * tk.k;
    g.fillStyle = 'rgba(12,12,12,0.58)';
    g.beginPath(); (g.roundRect ? g.roundRect(x, y, bw, bh, bh / 2) : g.rect(x, y, bw, bh)); g.fill();
    g.fillStyle = '#e8c25a'; g.beginPath(); g.arc(x + padX + fs * 0.2, y + bh / 2, fs * 0.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.92)'; g.textBaseline = 'middle';
    g.fillText(tk.text, x + padX + fs * 0.75, y + bh / 2 + 1);
    g.restore();
    st.tickerShown++;
  }
  // Called by the replay right after it rendered a frame (the WebGL buffer is only valid then).
  function frame() {
    if (st.phase !== 'replay') return;
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const rc = containRect(source.width, source.height, w, h);
    g.drawImage(source, rc.x, rc.y, rc.w, rc.h);
    if (free) {
      if (st.bugCanvas) { g.save(); g.globalAlpha = CFG.bug.opacity; g.drawImage(st.bugCanvas, st.bug.x, st.bug.y); g.restore(); }
      drawTicker(performance.now() - st.replayStart);
    }
    st.replayFrames++;
  }

  // ---- The recorder ----
  const stream = out.captureStream(CFG.output.fps);
  if (dest) for (const tr of dest.stream.getAudioTracks()) stream.addTrack(tr);
  st.audio = !!(dest && sound);
  const mime = pickMime();
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: CFG.output.videoBitsPerSecond } : { videoBitsPerSecond: CFG.output.videoBitsPerSecond });
  const chunks = [];
  mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise((res) => { mr.onstop = () => res(new Blob(chunks, { type: (mr.mimeType || mime || 'video/webm').split(';')[0] })); });

  let raf = 0;
  function toReplay() {
    if (st.phase !== 'intro') return;
    cancelAnimationFrame(raf);
    st.phase = 'replay'; st.replayStart = performance.now();
    onIntroEnd();
  }
  async function start(durationMs = 0) {
    st.schedule = free ? tickerSchedule(CFG.ticker, durationMs, seed) : [];
    if (ctx && ctx.state === 'suspended') await ctx.resume().catch(() => {});
    st.phase = 'intro';
    if (st.intro) {
      drawIntro(); // the very first frame is the intro
      mr.start(1000);
      const loop = () => { drawIntro(); if (video.ended || video.currentTime >= video.duration - 0.02) return toReplay(); raf = requestAnimationFrame(loop); };
      video.addEventListener('ended', toReplay, { once: true });
      await video.play().catch(() => {});
      if (ctx && sound) { const s = ctx.createBufferSource(); s.buffer = sound; s.connect(dest); s.connect(ctx.destination); s.start(); }
      raf = requestAnimationFrame(loop);
      // Safety net: never hang on the intro (e.g. a tab in the background).
      setTimeout(toReplay, Math.max(3000, (video.duration || 2.8) * 1000 + 1500));
    } else { mr.start(1000); toReplay(); }
  }
  async function stop() {
    if (st.phase === 'intro') toReplay();
    st.phase = 'stopping';
    cancelAnimationFrame(raf);
    if (mr.state !== 'inactive') mr.stop();
    const blob = await done;
    st.phase = 'done';
    try { video.pause(); video.removeAttribute('src'); video.load(); } catch { /* ok */ }
    for (const tr of stream.getTracks()) tr.stop();
    if (ctx && !audioCtx) ctx.close().catch(() => {});
    return blob;
  }
  return { start, stop, frame, canvas: out, state: st, mime: () => mr.mimeType || mime };
}
