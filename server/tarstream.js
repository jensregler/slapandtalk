// A tiny streaming tar (ustar) writer and reader – just enough for a city file (server/cityarchive.js):
// regular files with short names, written and read one after the other, gzip around it (zlib). No
// dependency, works the same on Windows and Linux, and nothing is held in memory but one entry at a time.
const { Writable } = require('stream');

const BLOCK = 512;
const octal = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
function header(name, size, mtime = Math.floor(Date.now() / 1000)) {
  const nb = Buffer.from(name, 'utf8');
  if (nb.length > 100) throw new Error(`tar: name too long: ${name}`);
  const h = Buffer.alloc(BLOCK, 0);
  nb.copy(h, 0);
  h.write(octal(0o644, 8), 100, 'ascii');
  h.write(octal(0, 8), 108, 'ascii');
  h.write(octal(0, 8), 116, 'ascii');
  h.write(octal(size, 12), 124, 'ascii');
  h.write(octal(mtime, 12), 136, 'ascii');
  h.fill(0x20, 148, 156); // checksum field counts as spaces
  h.write('0', 156, 'ascii'); // a regular file
  h.write('ustar\0', 257, 'ascii'); h.write('00', 263, 'ascii');
  let sum = 0; for (let i = 0; i < BLOCK; i++) sum += h[i];
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return h;
}
const pad = (size) => (BLOCK - (size % BLOCK)) % BLOCK;

// out: a Writable (a gzip stream). add() waits for 'drain' so a big city never piles up in memory.
function createTarWriter(out) {
  const write = (buf) => new Promise((resolve, reject) => {
    const ok = out.write(buf, (e) => (e ? reject(e) : null));
    if (ok) resolve(); else out.once('drain', resolve);
  });
  return {
    async add(name, buf) {
      const body = Buffer.isBuffer(buf) ? buf : Buffer.from(typeof buf === 'string' ? buf : JSON.stringify(buf));
      await write(header(name, body.length));
      if (body.length) await write(body);
      const p = pad(body.length); if (p) await write(Buffer.alloc(p, 0));
    },
    async end() { await write(Buffer.alloc(BLOCK * 2, 0)); await new Promise((r) => out.end(r)); },
  };
}

function parseHeader(h) {
  if (h.every((b) => b === 0)) return null; // the end
  const str = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
  let sum = 0; for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
  const want = parseInt(str(148, 156).trim(), 8);
  if (!Number.isFinite(want) || want !== sum) throw new Error('tar: bad header checksum (not a city file?)');
  const prefix = str(345, 500);
  const name = (prefix ? prefix + '/' : '') + str(0, 100);
  const size = parseInt(str(124, 136).trim() || '0', 8);
  const type = String.fromCharCode(h[156] || 0x30);
  return { name, size, type };
}

// A Writable that cuts the tar apart: onEntry({ name, size, type }, buf) for every entry, in order (awaited –
// backpressure). maxEntry: bytes one entry may have (bigger: error). maxTotal: bytes of the whole tar.
function createTarReader(onEntry, { maxEntry = 64 * 1024 * 1024, maxTotal = 4 * 1024 * 1024 * 1024 } = {}) {
  let buf = Buffer.alloc(0), cur = null, chunks = [], got = 0, skip = 0, total = 0, done = false;
  async function feed() {
    for (;;) {
      if (done) { buf = Buffer.alloc(0); return; }
      if (skip) { const n = Math.min(skip, buf.length); buf = buf.subarray(n); skip -= n; if (skip) return; }
      if (!cur) {
        if (buf.length < BLOCK) return;
        const h = parseHeader(buf.subarray(0, BLOCK)); buf = buf.subarray(BLOCK);
        if (!h) { done = true; continue; }
        if (h.size > maxEntry) throw new Error(`tar: ${h.name} is too big`);
        cur = h; chunks = []; got = 0;
        if (!cur.size) { const e = cur; cur = null; await onEntry(e, Buffer.alloc(0)); }
        continue;
      }
      const n = Math.min(cur.size - got, buf.length);
      if (n) { chunks.push(buf.subarray(0, n)); buf = buf.subarray(n); got += n; }
      if (got < cur.size) return;
      const e = cur; cur = null; skip = pad(e.size);
      await onEntry(e, Buffer.concat(chunks)); chunks = [];
    }
  }
  return new Writable({
    write(chunk, _enc, cb) {
      total += chunk.length;
      if (total > maxTotal) { cb(new Error('tar: the file is too big')); return; }
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      feed().then(() => cb(), cb);
    },
    final(cb) { if (cur) cb(new Error('tar: the file ends in the middle of an entry')); else cb(); },
  });
}

module.exports = { createTarWriter, createTarReader, header, parseHeader };
