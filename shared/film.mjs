// The session film (Jens, 5 Nov 2026, pt536u): instead of a log, the time in a room becomes a short
// cinematic film, made when I leave the room for the city. Pure maths, no browser: the planner here
// turns my own session's events (client/src/filmlog.js) into a list of scenes; client/src/cinematic.js
// renders them (an offscreen Three.js pass, only while the film is being made) and records them.
//
// Events (t = ms since I came into the room):
//   { t, e: 'start', room, name }       – I came in
//   { t, e: 'stick', url, aspect }      – I put a sticker on a wall / the floor
//   { t, e: 'radio', what }             – I touched the radio / the sound controls (knob, power, panel)
//   { t, e: 'peel' | 'chat' | 'look' }  – smaller moments: get a simple camera move at most
//   { t, e: 'pack', name, bag }         – I made my sticker pack at the door (the LAST scene)
//
// Scenes: { kind, t0 (s, in the film), dur (s), at (ms, session time), ...data }
//   open   – the title: my character in the room
//   stick  – close-up of the wall: an animated hand brings the sticker(s) and presses them on, the
//            adhesive visible (curl, glue strands, wet sheen), then flat. Rapid stickers merge: one
//            scene shows up to FILM.stickShow of them (and counts the rest).
//   radio  – my character turning the radio dial (close-up of the character + the radio)
//   cut    – a quick camera move along my wall (peel/chat/look moments), rare
//   pack   – the END: my character holds up the new sticker pack – shiny, bling, Japanese style
//   end    – (only if there is no pack) a plain end card
export const FILM = Object.freeze({
  open: 2.2, stickOne: 1.7, stickExtra: 0.9, stickShow: 3, radio: 2.6, cut: 1.4, pack: 4.6, end: 1.6,
  mergeStickMs: 8000,   // stickers closer than this (to the first of the group) are one scene
  mergeRadioMs: 15000,  // radio touches within this are one scene
  maxStick: 6, maxRadio: 3, maxCut: 2,
  cutGapMs: 6000,       // a 'cut' only where nothing else happens this close
  maxLog: 400,          // events kept (the oldest stickers are thinned first by the planner anyway)
  fps: 30,
});
const CUT_KINDS = new Set(['peel', 'chat', 'look']);

// Pick n of a list, evenly (always the first and the last).
export function spread(list, n) {
  if (list.length <= n) return list.slice();
  if (n <= 1) return [list[list.length - 1]];
  return Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))]);
}
// Group events: a new group when this one is further than `win` ms from the group's first.
export function groupBy(events, win) {
  const out = [];
  for (const e of events) { const g = out[out.length - 1]; if (g && e.t - g[0].t <= win) g.push(e); else out.push([e]); }
  return out;
}

export function planFilm(events = [], { room = '', name = '' } = {}) {
  const ev = (Array.isArray(events) ? events : []).filter((e) => e && typeof e.e === 'string' && Number.isFinite(e.t)).slice().sort((a, b) => a.t - b.t);
  const packAt = ev.findIndex((e) => e.e === 'pack');
  const pack = packAt >= 0 ? ev[packAt] : null;
  const body = pack ? ev.slice(0, packAt) : ev; // nothing after the pack: the pack is the end
  const start = body.find((e) => e.e === 'start');
  const scenes = [];
  // stickers
  const sg = spread(groupBy(body.filter((e) => e.e === 'stick'), FILM.mergeStickMs), FILM.maxStick);
  let shown = 0;
  for (const g of sg) {
    const show = g.slice(0, FILM.stickShow);
    scenes.push({ kind: 'stick', at: g[0].t, dur: FILM.stickOne + FILM.stickExtra * (show.length - 1), stickers: show.map((e) => ({ url: e.url || '', aspect: Number(e.aspect) > 0 ? Number(e.aspect) : 1 })), count: g.length, first: shown });
    shown += show.length;
  }
  // radio
  for (const g of spread(groupBy(body.filter((e) => e.e === 'radio'), FILM.mergeRadioMs), FILM.maxRadio)) scenes.push({ kind: 'radio', at: g[0].t, dur: FILM.radio, touches: g.length });
  // small moments: only far from everything else, at most maxCut
  const busy = scenes.map((s) => s.at);
  const cuts = [];
  for (const e of body.filter((x) => CUT_KINDS.has(x.e))) {
    if (busy.some((t) => Math.abs(t - e.t) < FILM.cutGapMs) || cuts.some((c) => Math.abs(c.at - e.t) < FILM.cutGapMs)) continue;
    cuts.push({ kind: 'cut', at: e.t, dur: FILM.cut, what: e.e });
  }
  scenes.push(...spread(cuts, FILM.maxCut));
  scenes.sort((a, b) => a.at - b.at || (a.kind < b.kind ? -1 : 1));
  // the title first, the pack (or an end card) last
  scenes.unshift({ kind: 'open', at: start ? start.t : 0, dur: FILM.open, room: start?.room || room, name: start?.name || name });
  if (pack) scenes.push({ kind: 'pack', at: pack.t, dur: FILM.pack, name: String(pack.name || '').slice(0, 30), bag: pack.bag | 0 || 1, stuck: shown });
  else scenes.push({ kind: 'end', at: body.length ? body[body.length - 1].t : 0, dur: FILM.end });
  let t = 0; for (const s of scenes) { s.t0 = +t.toFixed(3); t += s.dur; }
  return { scenes, length: +t.toFixed(3), stickers: shown, hasPack: !!pack };
}
// The scene at film time t (s) and how far into it (0…1).
export function sceneAt(plan, t) {
  const L = plan.scenes; if (!L.length) return null;
  const tt = Math.max(0, Math.min(t, plan.length - 1e-6));
  let i = L.length - 1; while (i > 0 && L[i].t0 > tt) i--;
  const s = L[i];
  return { i, scene: s, local: tt - s.t0, u: Math.max(0, Math.min(1, (tt - s.t0) / s.dur)) };
}

// After the film (the big dialog): Watch / Download / Discard and go into the city.
export const FILM_CHOICES = Object.freeze(['watch', 'download', 'discard']);
export function filmChoice(choice, { canDownload = true, downloaded = false } = {}) {
  if (choice === 'watch') return { action: 'play', stay: true };
  if (choice === 'download') return canDownload ? { action: 'download', stay: true } : { action: 'none', stay: true, why: 'unsupported' };
  if (choice === 'discard') return { action: 'continue', discard: !downloaded, stay: false };
  return { action: 'none', stay: true };
}
// The recording format: webm where it works (Chrome, Firefox, Android); mp4 on Safari (iPhone/iPad, Mac),
// which records only mp4. prefer: 'mp4' to try mp4 first. → { mime, ext } or null (no recorder).
const WEBM = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
const MP4 = ['video/mp4;codecs=avc1', 'video/mp4'];
export function pickFilmMime(isSupported, { prefer = 'webm' } = {}) {
  const order = prefer === 'mp4' ? [...MP4, ...WEBM] : [...WEBM, ...MP4];
  for (const m of order) { try { if (isSupported(m)) return { mime: m, ext: m.startsWith('video/mp4') ? 'mp4' : 'webm' }; } catch { /* no */ } }
  return null;
}
