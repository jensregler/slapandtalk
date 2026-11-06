// This visit's highlight moments, kept in the tab (sessionStorage, per room/city).
// Cleared when the reel is done or the visit ends. No camera panel – filming is automatic.
import { REEL } from '../../shared/highlight.mjs';

export class HighlightLog {
  constructor(room) {
    this.room = room;
    this.key = `klibb.highlight@${room}`;
    let s = null; try { s = JSON.parse(sessionStorage.getItem(this.key) || 'null'); } catch { s = null; }
    this.t0 = s && Number.isFinite(s.t0) ? s.t0 : Date.now();
    this.list = s && Array.isArray(s.events) ? s.events : [];
    this.timer = null;
    this.myStamps = new Set();
  }
  add(e, data = {}) {
    const row = { t: Date.now() - this.t0, e, ...data };
    this.list.push(row);
    if (this.list.length > 600) this.list.splice(1, this.list.length - 600);
    clearTimeout(this.timer); this.timer = setTimeout(() => this.save(), 250);
    return row;
  }
  has(e) { return this.list.some((x) => x.e === e); }
  events() { return this.list.slice(); }
  noteMine(id) { if (id) this.myStamps.add(id); }
  isMine(id) { return this.myStamps.has(id); }
  save() { try { sessionStorage.setItem(this.key, JSON.stringify({ t0: this.t0, events: this.list })); } catch { /* full */ } }
  clear() {
    this.list = []; this.myStamps.clear(); this.t0 = Date.now();
    try { sessionStorage.removeItem(this.key); } catch { /* ok */ }
  }
}
export { REEL };
