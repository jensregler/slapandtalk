// Sampler layers' audio (Jens, 5 Nov 2026). Sound settings are personal and never sent to anyone
// (soundui.js), so the samples stay on this device too: a loaded file is decoded, mixed to mono,
// cut to SYNTH.maxSampleSeconds, stored as a 16-bit WAV in IndexedDB ('klibb-samples') under its
// sha-256, and the patch only keeps that hash (+ name and length). Decoded buffers go into
// SAMPLE_BUFFERS (synth.js), which the engine plays from. "Exit to menu" clears them all
// (resetPersonalSound → clearSamples); samples no saved patch uses are pruned after 2 days.
import { SAMPLE_BUFFERS } from './synth.js';
import { SYNTH } from '../../shared/synth.mjs';

export const SAMPLE_LIMITS = { maxFileBytes: 20 * 1024 * 1024, maxSeconds: SYNTH.maxSampleSeconds,
  exts: /\.(wav|wave|mp3|m4a|aac|mp4|ogg|oga|opus|flac|aif|aiff|caf|webm)$/i };
const DB = 'klibb-samples', STORE = 'samples';
let dbp = null;
function db() {
  if (!('indexedDB' in globalThis)) return Promise.resolve(null);
  return (dbp ||= new Promise((res) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'hash' });
    r.onsuccess = () => res(r.result); r.onerror = () => res(null);
  }));
}
const tx = async (mode, fn) => { const d = await db(); if (!d) return null; return new Promise((res) => { const t = d.transaction(STORE, mode); const q = fn(t.objectStore(STORE)); t.oncomplete = () => res(q?.result ?? null); t.onerror = () => res(null); }); };

// 16-bit mono WAV from a Float32Array
export function encodeWav(data, rate) {
  const n = data.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const x = Math.max(-1, Math.min(1, data[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return buf;
}
async function sha256(buf) {
  if (crypto?.subtle) { const h = await crypto.subtle.digest('SHA-256', buf); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
  // (no secure context: FNV-1a over the bytes, stretched to 64 hex – unique enough for a local cache)
  const u = new Uint8Array(buf); let out = '';
  for (let k = 0; k < 8; k++) { let h = (2166136261 ^ k) >>> 0; for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; } out += h.toString(16).padStart(8, '0'); }
  return out;
}
const decode = (ctx, ab) => new Promise((res, rej) => { try { const p = ctx.decodeAudioData(ab, res, rej); if (p?.then) p.then(res, rej); } catch (e) { rej(e); } });

// A dropped/picked File → { hash, name, len } (stored + decoded) or throws Error(message for the user).
export async function loadSampleFile(file, ctx) {
  if (!file) throw new Error('No file');
  const okType = (file.type || '').startsWith('audio/') || (file.type === 'video/mp4' || file.type === 'video/webm') || SAMPLE_LIMITS.exts.test(file.name || '');
  if (!okType) throw new Error('That is not an audio file');
  if (file.size > SAMPLE_LIMITS.maxFileBytes) throw new Error('The file is too big (max 20 MB)');
  if (!ctx) throw new Error('Sound is not available in this browser');
  let audio;
  try { audio = await decode(ctx, await file.arrayBuffer()); } catch { throw new Error('Could not read that audio file'); }
  const rate = audio.sampleRate, n = Math.min(audio.length, Math.round(SAMPLE_LIMITS.maxSeconds * rate));
  if (n < 16) throw new Error('The sound is empty');
  const mono = new Float32Array(n);
  for (let c = 0; c < audio.numberOfChannels; c++) { const d = audio.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / audio.numberOfChannels; }
  const wav = encodeWav(mono, rate), hash = await sha256(wav);
  const name = String(file.name || 'sample').replace(/\.[a-z0-9]+$/i, '').slice(0, 40);
  await tx('readwrite', (s) => s.put({ hash, name, wav, at: Date.now() }));
  const buf = ctx.createBuffer(1, n, rate); buf.getChannelData(0).set(mono);
  SAMPLE_BUFFERS.set(hash, buf);
  return { hash, name, len: +(n / rate).toFixed(3), truncated: audio.length > n };
}
// Make sure every sample these patches use is decoded (from IndexedDB). Resolves when done.
export async function ensureSamples(patches, ctx) {
  const want = new Set();
  for (const p of Object.values(patches || {})) for (const l of p?.layers || []) if (l.kind === 'sampler' && l.sample && !SAMPLE_BUFFERS.has(l.sample)) want.add(l.sample);
  if (!want.size || !ctx) return;
  await Promise.all([...want].map(async (hash) => {
    const rec = await tx('readonly', (s) => s.get(hash)); if (!rec?.wav) return;
    try { SAMPLE_BUFFERS.set(hash, await decode(ctx, rec.wav.slice(0))); } catch { /* broken: stays silent */ }
  }));
}
export async function clearSamples() { SAMPLE_BUFFERS.clear(); await tx('readwrite', (s) => s.clear()); }
// Drop stored samples that no saved patch uses and that are older than 2 days.
export async function pruneSamples(patches) {
  const keep = new Set(); for (const p of Object.values(patches || {})) for (const l of p?.layers || []) if (l.sample) keep.add(l.sample);
  const all = (await tx('readonly', (s) => s.getAll())) || [];
  const old = all.filter((r) => !keep.has(r.hash) && Date.now() - r.at > 2 * 864e5);
  if (old.length) await tx('readwrite', (s) => { for (const r of old) s.delete(r.hash); });
}
