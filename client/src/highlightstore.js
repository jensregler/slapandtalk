// Raw highlight footage store (IndexedDB + memory). Holds quick-cut clip blobs / frame
// payloads only until the reel is assembled and (optionally) downloaded – then discardRaw()
// wipes everything. Never a long-term archive; never a camera/podcast studio.
const DB = 'slapandtalk-highlights';
const STORE = 'raw';
const VER = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    const req = indexedDB.open(DB, VER);
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null); // private mode etc.: memory only
  });
}

export class HighlightStore {
  constructor(room) {
    this.room = room;
    this.mem = []; // { id, t, kind, cam, blob?, meta }
    this.db = null;
    this._ready = openDb().then((db) => { this.db = db; });
  }
  ready() { return this._ready; }
  count() { return this.mem.length; }
  list() { return this.mem.slice(); }
  async put(entry) {
    const row = { id: entry.id || `r${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, t: entry.t || 0, kind: entry.kind || 'clip', cam: entry.cam || null, blob: entry.blob || null, meta: entry.meta || {}, room: this.room };
    this.mem.push(row);
    await this._ready;
    if (!this.db || !row.blob) return row;
    try {
      await new Promise((resolve) => {
        const tx = this.db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(row);
        tx.oncomplete = () => resolve(); tx.onerror = () => resolve();
      });
    } catch { /* ok */ }
    return row;
  }
  async discardRaw() {
    this.mem = [];
    await this._ready;
    if (!this.db) return true;
    try {
      await new Promise((resolve) => {
        const tx = this.db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve(); tx.onerror = () => resolve();
      });
    } catch { /* ok */ }
    return this.count() === 0;
  }
}

// In-memory only (unit tests, Node).
export function memoryStore() {
  const raw = [];
  return {
    raw,
    count: () => raw.length,
    put: (e) => { raw.push(e); return e; },
    discardRaw: () => { raw.length = 0; return true; },
    list: () => raw.slice(),
  };
}
