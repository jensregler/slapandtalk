// Lagring på den lokala disken (standard). Nyckeln "rooms/stad.json" blir filen
// <DATA_DIR>/rooms/stad.json. OBS: på Renders gratisnivå är disken tillfällig.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

class LocalAdapter {
  constructor(dir) {
    this.kind = 'local';
    this.dir = path.resolve(dir);
    fs.mkdirSync(this.dir, { recursive: true });
  }
  file(key) {
    const f = path.resolve(this.dir, key);
    if (!f.startsWith(this.dir + path.sep)) throw new Error('Ogiltig nyckel');
    return f;
  }
  async get(key) {
    try { return await fsp.readFile(this.file(key)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  // Skriv först till en temporär fil och byt sedan namn, så filen aldrig blir halvskriven.
  async put(key, buf) {
    const f = this.file(key);
    await fsp.mkdir(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fsp.writeFile(tmp, buf);
    await fsp.rename(tmp, f);
  }
  async delete(key) { await fsp.rm(this.file(key), { force: true }); }
  async exists(key) { try { await fsp.access(this.file(key)); return true; } catch { return false; } }
  // Bara en mappnivå behövs: list('rooms/') -> ['rooms/stad.json', ...]
  async list(prefix) {
    const cut = prefix.lastIndexOf('/') + 1;
    const dirKey = prefix.slice(0, cut), start = prefix.slice(cut);
    let names = [];
    try { names = await fsp.readdir(dirKey ? this.file(dirKey) : this.dir); } catch { return []; }
    return names.filter((n) => n.startsWith(start) && !n.endsWith('.tmp')).map((n) => dirKey + n);
  }
}

module.exports = { LocalAdapter };
