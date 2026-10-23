// Alla anrop till servern samlade på ett ställe.
async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fel ${res.status}`);
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

  checkAdmin: (token) => fetch('/api/admin/check', { headers: { 'x-admin-token': token } }).then(json),

  deleteStamp: (room, id, token) => fetch(`/api/rooms/${room}/stamps/${id}`, {
    method: 'DELETE', headers: { 'x-admin-token': token },
  }).then(json),

  deleteImage: (id, token) => fetch(`/api/stickers/${id}`, {
    method: 'DELETE', headers: { 'x-admin-token': token },
  }).then(json),
};
