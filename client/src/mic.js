// ONE microphone for the whole page (Jens, 5 Nov 2026): voice chat (voice.js), mic layers and the
// 'mic' envelope follower (synth.js) share a single getUserMedia stream – the browser asks once,
// the mic opens once. Nobody asks before they need it: voice chat when 🎙 is pressed, a mic layer
// when one is made or switched on (never on page load).
// Echo cancellation / noise suppression / auto gain stay ON for talking (the browser does them at
// capture, before any effect). "Raw mic (for instruments)" (Hear myself) turns them OFF so the
// voice can be played as an instrument without the browser chewing it up – setMicRaw(true).
// Users: a Set of names ('voice', 'layers'); when the last one lets go, the tracks stop.
let stream = null, pending = null, denied = false, rawMode = false;
const users = new Set();
const listeners = new Set();
export const MIC_CONSTRAINTS = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false };
export const MIC_RAW_CONSTRAINTS = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false };
export const micSupported = () => !!(typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
export const micStream = () => (stream && stream.active ? stream : null);
export const micDenied = () => denied;
export const micRaw = () => rawMode;
export const micConstraints = () => (rawMode ? MIC_RAW_CONSTRAINTS : MIC_CONSTRAINTS);
// Ask for (or reuse) the mic. Resolves to the stream, or null (denied / no mic / unsupported).
export async function getMic(who) {
  if (who) users.add(who);
  if (micStream()) return stream;
  if (!micSupported()) return null;
  pending ||= navigator.mediaDevices.getUserMedia(micConstraints())
    .then((s) => { stream = s; denied = false; notify(s); return s; }, () => { denied = true; return null; })
    .finally(() => { pending = null; });
  return pending;
}
export function releaseMic(who) {
  users.delete(who);
  if (!users.size && stream) { for (const t of stream.getTracks()) t.stop(); stream = null; notify(null); }
}
export const micUsers = () => [...users];
// Subscribe to stream swaps (raw ↔ chat). cb(stream|null). Returns unsubscribe.
export function onMicStream(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function notify(s) { for (const cb of listeners) try { cb(s); } catch { /* listener */ } }
// Re-open the mic with (or without) raw constraints. No-op if nothing has opened it yet (the next
// getMic picks up the new mode). Existing users keep their seats; voice.js swaps its clone.
export async function setMicRaw(want) {
  const next = !!want;
  if (next === rawMode && (micStream() || !users.size)) { rawMode = next; return micStream(); }
  rawMode = next;
  if (!users.size) return null;
  if (pending) await pending;
  const prev = stream;
  stream = null;
  denied = false;
  const s = await getMic(null);
  if (prev) for (const t of prev.getTracks()) try { t.stop(); } catch { /* ok */ }
  return s;
}
