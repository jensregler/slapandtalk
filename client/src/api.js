// Alla anrop till servern samlade på ett ställe.
import { unlockHeaders } from './entitlements.js';
async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Fel ${res.status}`), { status: res.status, gone: !!data.gone, removed: !!data.removed, nope: !!data.nope });
  return data;
}

export const api = {
  loadRoom: (room) => fetch(`/api/rooms/${room}/stamps`).then(json),

  // name: the original file name (its letter prefix sets the start size, shared/sizeprefix.mjs);
  // startCm: when re-uploading a lost design, the start size it already had.
  uploadSticker: (blob, artist, { name, startCm } = {}) => {
    const fd = new FormData();
    fd.append('artist', artist || '');
    if (name) fd.append('name', String(name).slice(0, 200));
    if (typeof startCm === 'number') fd.append('startCm', String(startCm));
    fd.append('file', blob, 'klibba.png');
    return fetch('/api/stickers', { method: 'POST', body: fd }).then(json);
  },

  addStamp: (room, stamp) => fetch(`/api/rooms/${room}/stamps`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...unlockHeaders() }, body: JSON.stringify(stamp), // bigStickers
  }).then(json),

  // Sticker array: copies of my own just-slapped sticker toward `to` (server/app.js, shared/array.mjs).
  // body = { anchor: { id, token }, to, nonce, by?, peelFrom? }. Answer: { anchor, image, stamps: [{ i, stamp, peel? }] }
  addArray: (room, body) => fetch(`/api/rooms/${room}/stamps/array`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(json),

  // Peela egna stämplar: items = [{ id, token }]. Svar: { results: { id: 'ok'|'notfound'|'forbidden' } }
  // by = mitt id i rummet (WebSocket), så de andra ser min gubbe peela. Valfritt.
  peel: (room, items, by = null) => fetch(`/api/rooms/${room}/peel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(by ? { items, by } : { items }),
  }).then(json),

  createRoom: (style) => fetch('/api/rooms', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...unlockHeaders() }, body: JSON.stringify(style ? { style } : {}), // (unlock: Färg is the full version's)
  }).then(json),
  setStyle: (room, style, { key, admin } = {}) => fetch(`/api/rooms/${room}/style`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...unlockHeaders(), ...(key ? { 'x-room-key': key } : {}), ...(admin ? { 'x-admin-token': admin } : {}) },
    body: JSON.stringify({ style }),
  }).then(json),
  visit: (room) => fetch(`/api/rooms/${room}/visit`, { method: 'POST' }).then(json),

  // Vilka av mina designs finns kvar på servern?
  checkStickers: (ids) => fetch(`/api/stickers?ids=${ids.join(',')}`).then(json),

  checkAdmin: (token) => fetch('/api/admin/check', { headers: { 'x-admin-token': token } }).then(json),

  deleteStamp: (room, id, token) => fetch(`/api/rooms/${room}/stamps/${id}`, {
    method: 'DELETE', headers: { 'x-admin-token': token },
  }).then(json),

  deleteImage: (id, token) => fetch(`/api/stickers/${id}`, {
    method: 'DELETE', headers: { 'x-admin-token': token },
  }).then(json),
};

// ---------- Inspelning och kameror (rättighet: rumsnyckel eller admin, Staden bara admin) ----------
const rights = ({ key, admin } = {}) => ({ ...(key ? { 'x-room-key': key } : {}), ...(admin ? { 'x-admin-token': admin } : {}) });
const send = (method, url, body, auth, extra = {}) => fetch(url, {
  method, headers: { 'Content-Type': 'application/json', ...rights(auth), ...extra }, body: body === undefined ? undefined : JSON.stringify(body),
}).then(json);
Object.assign(api, {
  recStatus: (room) => fetch(`/api/rooms/${room}/recording`).then(json),
  // Nollställ rummet (alla klibbor bort). Bara skaparen (rumsnyckel) eller admin.
  resetRoom: (room, by, auth) => send('POST', `/api/rooms/${room}/reset`, { by }, auth),
  // Clear hidden stickers: how many (for the confirm), then do it. Same rights as resetting.
  hiddenCount: (room, auth) => fetch(`/api/rooms/${room}/hidden`, { headers: rights(auth) }).then(json),
  clearHidden: (room, by, auth) => send('POST', `/api/rooms/${room}/clear-hidden`, { by }, auth),
  startRec: (room, auth) => send('POST', `/api/rooms/${room}/recording/start`, {}, auth),
  stopRec: (room, auth) => send('POST', `/api/rooms/${room}/recording/stop`, {}, auth),
  listRecs: (room, auth) => fetch(`/api/rooms/${room}/recordings`, { headers: rights(auth) }).then(json),
  // Finished videos of the room (videos.js on the server), newest first.
  listVideos: (room, auth) => fetch(`/api/rooms/${room}/videos`, { headers: rights(auth) }).then(json),
  listPhotos: (room, auth) => fetch(`/api/rooms/${room}/photos`, { headers: rights(auth) }).then(json),
  deleteRec: (room, id, auth) => send('DELETE', `/api/rooms/${room}/recordings/${id}`, undefined, auth),
  // cameras: the unlock key too (multiCam: several cameramen, a start, a path choice)
  addCamera: (room, cam, auth) => send('POST', `/api/rooms/${room}/cameras`, cam, auth, unlockHeaders()),
  updateCamera: (room, id, patch, auth) => send('PUT', `/api/rooms/${room}/cameras/${id}`, patch, auth, unlockHeaders()),
  removeCamera: (room, id, auth) => send('DELETE', `/api/rooms/${room}/cameras/${id}`, undefined, auth),
  // Peels (baksidespapper) på/av och sopa golvet. Samma rättighet som rummets utseende.
  setPeels: (room, on, auth) => send('PUT', `/api/rooms/${room}/peels`, { on }, auth),
  clearPeels: (room, auth) => send('POST', `/api/rooms/${room}/peels/clear`, {}, auth),
  // The footstep groove's scale (shared/groove.mjs): full version (soundDesign) + the room's creator, or admin.
  setGroove: (room, scale, auth) => fetch(`/api/rooms/${room}/groove`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...rights(auth), ...unlockHeaders() }, body: JSON.stringify({ scale }),
  }).then(json),
});
