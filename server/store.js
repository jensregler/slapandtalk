// Enkel lagring i JSON-filer: en fil per rum i data/rooms/<rum>.json
// och en fil för alla bilder (data/images.json).
// Allt går via funktionerna nedan, så om vi vill byta till SQLite senare
// behöver bara den här filen skrivas om.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const ROOMS_DIR = path.join(DATA_DIR, 'rooms');
const IMAGES_FILE = path.join(DATA_DIR, 'images.json');
fs.mkdirSync(ROOMS_DIR, { recursive: true });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
// Skriv först till en temporär fil och byt sedan namn, så filen aldrig blir halvskriven.
function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

const roomFile = (roomId) => path.join(ROOMS_DIR, roomId + '.json');
const newId = () => crypto.randomBytes(8).toString('hex');

function getRoom(roomId) {
  return readJson(roomFile(roomId), { id: roomId, stamps: [] });
}
function listStamps(roomId) {
  return getRoom(roomId).stamps;
}
function addStamp(roomId, stamp) {
  const room = getRoom(roomId);
  const s = { id: newId(), order: (room.stamps.at(-1)?.order ?? 0) + 1, createdAt: new Date().toISOString(), ...stamp };
  room.stamps.push(s);
  writeJson(roomFile(roomId), room);
  return s;
}
function deleteStamp(roomId, stampId) {
  const room = getRoom(roomId);
  const before = room.stamps.length;
  room.stamps = room.stamps.filter((s) => s.id !== stampId);
  writeJson(roomFile(roomId), room);
  return before !== room.stamps.length;
}
function deleteStampsWithImage(imageId) {
  let removed = 0;
  for (const f of fs.readdirSync(ROOMS_DIR).filter((f) => f.endsWith('.json'))) {
    const roomId = f.replace(/\.json$/, '');
    const room = getRoom(roomId);
    const before = room.stamps.length;
    room.stamps = room.stamps.filter((s) => s.imageId !== imageId);
    removed += before - room.stamps.length;
    writeJson(roomFile(roomId), room);
  }
  return removed;
}

function listImages() { return readJson(IMAGES_FILE, {}); }
function addImage(img) {
  const images = listImages();
  images[img.id] = img;
  writeJson(IMAGES_FILE, images);
  return img;
}
function getImage(id) { return listImages()[id]; }
function deleteImage(id) {
  const images = listImages();
  delete images[id];
  writeJson(IMAGES_FILE, images);
}

module.exports = { DATA_DIR, newId, listStamps, addStamp, deleteStamp, deleteStampsWithImage, addImage, getImage, deleteImage };
