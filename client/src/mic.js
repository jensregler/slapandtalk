// ONE microphone for the whole page (Jens, 5 Nov 2026): voice chat (voice.js), mic layers and the
// 'mic' envelope follower (synth.js) share a single getUserMedia stream – the browser asks once,
// the mic opens once. Nobody asks before they need it: voice chat when 🎙 is pressed, a mic layer
// when one is made or switched on (never on page load). Echo cancellation / noise suppression /
// auto gain stay ON (the browser does them at capture, before any effect).
// Users: a Set of names ('voice', 'layers'); when the last one lets go, the tracks stop.
let stream = null, pending = null, denied = false;
const users = new Set();
export const MIC_CONSTRAINTS = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false };
export const micSupported = () => !!(typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
export const micStream = () => (stream && stream.active ? stream : null);
export const micDenied = () => denied;
// Ask for (or reuse) the mic. Resolves to the stream, or null (denied / no mic / unsupported).
export async function getMic(who) {
  if (who) users.add(who);
  if (micStream()) return stream;
  if (!micSupported()) return null;
  pending ||= navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
    .then((s) => { stream = s; denied = false; return s; }, () => { denied = true; return null; })
    .finally(() => { pending = null; });
  return pending;
}
export function releaseMic(who) {
  users.delete(who);
  if (!users.size && stream) { for (const t of stream.getTracks()) t.stop(); stream = null; }
}
export const micUsers = () => [...users];
