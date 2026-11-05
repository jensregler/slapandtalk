// My session's moments, for the film (shared/film.mjs): kept in this tab (sessionStorage, per room),
// small (FILM.maxLog events), never sent anywhere. A reload continues the same film; it is cleared
// when the film is done (watched, downloaded or discarded) and I go into the city.
import { FILM } from '../../shared/film.mjs';

export class FilmLog {
  constructor(room) {
    this.key = `klibb.film@${room}`;
    let s = null; try { s = JSON.parse(sessionStorage.getItem(this.key) || 'null'); } catch { s = null; }
    this.t0 = s && Number.isFinite(s.t0) ? s.t0 : Date.now();
    this.list = s && Array.isArray(s.events) ? s.events : [];
    this.timer = null;
  }
  add(e, data = {}) {
    this.list.push({ t: Date.now() - this.t0, e, ...data });
    if (this.list.length > FILM.maxLog) this.list.splice(1, this.list.length - FILM.maxLog); // keep 'start'
    clearTimeout(this.timer); this.timer = setTimeout(() => this.save(), 300);
    return this.list[this.list.length - 1];
  }
  has(e) { return this.list.some((x) => x.e === e); }
  events() { return this.list.slice(); }
  save() { try { sessionStorage.setItem(this.key, JSON.stringify({ t0: this.t0, events: this.list })); } catch { /* full / private */ } }
  clear() { this.list = []; this.t0 = Date.now(); try { sessionStorage.removeItem(this.key); } catch { /* ok */ } }
}
