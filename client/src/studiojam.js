// Temporary film-studio jam recorder (Jens, Nov 2026): mic (± room synth bus) → WebM download.
// Used only while ?studio=1 / film-studio mode is on. Reuses mic.js (shared getUserMedia) and,
// when available, the synth engine's micSource / master tap so game sounds ride along.
import { getMic, releaseMic, micSupported, micDenied } from './mic.js';

const WHO = 'studio-jam';
const MIMES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of MIMES) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* skip */ }
  }
  return '';
}

export function createStudioJam({ sound = null, toast = () => {} } = {}) {
  let rec = null, chunks = [], startedAt = 0, mixing = null;

  function state() {
    return {
      supported: micSupported() && typeof MediaRecorder !== 'undefined',
      recording: !!(rec && rec.state === 'recording'),
      denied: micDenied(),
      mime: pickMime(),
      ms: startedAt ? Math.max(0, Date.now() - startedAt) : 0,
    };
  }

  async function start() {
    if (rec && rec.state === 'recording') return state();
    const mime = pickMime();
    if (!mime) { toast('No MediaRecorder audio mime on this browser', 2600); return state(); }
    const mic = await getMic(WHO);
    if (!mic) { toast(micDenied() ? 'Mic permission denied' : 'No microphone', 2600); return state(); }

    let stream = mic;
    // Prefer mixing mic + room synth into one track when the audio engine is up.
    try {
      const eng = sound?.engine;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (eng && AC) {
        const ctx = eng.ctx || eng.context;
        if (ctx) {
          const dest = ctx.createMediaStreamDestination();
          const micNode = ctx.createMediaStreamSource(mic);
          micNode.connect(dest);
          try {
            const master = eng.micSource?.() || eng.masterOut || eng.master || eng.out;
            if (master && master.connect) master.connect(dest);
          } catch { /* room bus optional */ }
          stream = dest.stream;
          mixing = { ctx, micNode, dest };
        }
      }
    } catch { stream = mic; }

    chunks = [];
    rec = new MediaRecorder(stream, { mimeType: mime });
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onerror = () => { toast('Jam recording failed', 2200); };
    rec.start(250);
    startedAt = Date.now();
    toast('🎙 Jam recording… (J again to stop & download)', 2200);
    return state();
  }

  function stop({ download = true } = {}) {
    return new Promise((resolve) => {
      if (!rec || rec.state === 'inactive') {
        releaseMic(WHO);
        resolve({ blob: null, ...state() });
        return;
      }
      const mime = rec.mimeType || pickMime() || 'audio/webm';
      rec.onstop = () => {
        const blob = chunks.length ? new Blob(chunks, { type: mime }) : null;
        chunks = [];
        rec = null;
        startedAt = 0;
        if (mixing) {
          try { mixing.micNode.disconnect(); } catch { /* ok */ }
          mixing = null;
        }
        releaseMic(WHO);
        if (blob && download) {
          const ext = /mp4/i.test(mime) ? 'm4a' : /ogg/i.test(mime) ? 'ogg' : 'webm';
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `slapandtalk-jam-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext}`;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          toast('Jam saved – check your downloads', 2400);
        }
        resolve({ blob, ...state() });
      };
      try { rec.stop(); } catch { rec.onstop(); }
    });
  }

  async function toggle() {
    if (state().recording) return stop({ download: true });
    return start();
  }

  function dispose() {
    if (rec && rec.state === 'recording') {
      try { rec.ondataavailable = null; rec.onstop = null; rec.stop(); } catch { /* ok */ }
    }
    rec = null; chunks = []; startedAt = 0;
    if (mixing) { try { mixing.micNode.disconnect(); } catch { /* ok */ } mixing = null; }
    releaseMic(WHO);
  }

  return { start, stop, toggle, state, dispose };
}
