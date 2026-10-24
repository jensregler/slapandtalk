// Alla anrop till servern samlade på ett ställe.
async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Fel ${res.status}`), { status: res.status, gone: !!data.gone });
  return data;
}

export const api = {
  loadRoom: (room) => fetch(`/api/rooms/${room}/stamps`).then(json),

  uploadSticker: (blob, artist) => {
    const fd = new FormData();
    fd.append('artist', artist || '');
    fd.append('file', blob, 'klibba.png');
    return fetch('/api/stickers', { method: 'POST', body: fd }).then(json);
  },

  addStamp: (room, stamp) => fetch(`/api/rooms/${room}/stamps`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stamp),
  }).then(json),

  // Peela egna stämplar: items = [{ id, token }]. Svar: { results: { id: 'ok'|'notfound'|'forbidden' } }
  peel: (room, items) => fetch(`/api/rooms/${room}/peel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }),
  }).then(json),

  createRoom: (style) => fetch('/api/rooms', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(style ? { style } : {}),
  }).then(json),
  setStyle: (room, style, { key, admin } = {}) => fetch(`/api/rooms/${room}/style`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'x-room-key': key } : {}), ...(admin ? { 'x-admin-token': admin } : {}) },
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
const send = (method, url, body, auth) => fetch(url, {
  method, headers: { 'Content-Type': 'application/json', ...rights(auth) }, body: body === undefined ? undefined : JSON.stringify(body),
}).then(json);
Object.assign(api, {
  recStatus: (room) => fetch(`/api/rooms/${room}/recording`).then(json),
  startRec: (room, auth) => send('POST', `/api/rooms/${room}/recording/start`, {}, auth),
  stopRec: (room, auth) => send('POST', `/api/rooms/${room}/recording/stop`, {}, auth),
  listRecs: (room, auth) => fetch(`/api/rooms/${room}/recordings`, { headers: rights(auth) }).then(json),
  deleteRec: (room, id, auth) => send('DELETE', `/api/rooms/${room}/recordings/${id}`, undefined, auth),
  addCamera: (room, cam, auth) => send('POST', `/api/rooms/${room}/cameras`, cam, auth),
  updateCamera: (room, id, patch, auth) => send('PUT', `/api/rooms/${room}/cameras/${id}`, patch, auth),
  removeCamera: (room, id, auth) => send('DELETE', `/api/rooms/${room}/cameras/${id}`, undefined, auth),
});
