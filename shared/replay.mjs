// Uppspelning av en sessionsinspelning (formatet beskrivs i docs/recording-format.md).
// Ren JavaScript utan Three.js och utan webbläsare: samma kod används av uppspelaren i
// webbappen (client/src/replay.js), av testerna och senare av renderingen till video.
//
//   const rec = parseRecording(text)   // text = innehållet i <recId>.jsonl
//   const tl = buildTimeline(rec)
//   const s = snapshotAt(tl, 12_500)   // hur rummet såg ut 12,5 s in i inspelningen
//
// snapshotAt är en ren funktion av tiden: samma tid ger alltid samma svar, oavsett om man
// spelar framåt, hoppar bakåt eller spolar. Det gör uppspelningen (och renderingen) deterministisk.
export const REC_FORMAT = 'slapandtalk-rec';
export const REC_VERSION = 1;
// Positioner skickas ~12 gånger per sekund och sparas högst 10 gånger per sekund. Står någon
// still skickas inget, så nästa position "glider" bara in under de sista 200 ms (inte hela pausen).
const GLIDE_MS = 200;
// Peels (backing paper, shared/peels.mjs): at most this many on the floor, oldest go first (as the server).
const PEELS_MAX = 300;

export function parseRecording(text) {
  const lines = String(text || '').split('\n').filter((l) => l.trim());
  if (!lines.length) throw new Error('Tom inspelning');
  const header = JSON.parse(lines[0]);
  if (header.format !== REC_FORMAT) throw new Error('Det här är ingen inspelning från Slap and Talk');
  if (!(header.v >= 1)) throw new Error('Okänd version av inspelningen');
  const events = [];
  let end = null, bad = 0;
  for (let i = 1; i < lines.length; i++) {
    let e; try { e = JSON.parse(lines[i]); } catch { bad++; continue; } // en trasig sista rad (avbruten skrivning) hoppas över
    if (!e || typeof e.t !== 'number' || typeof e.e !== 'string') { bad++; continue; }
    if (e.e === 'end') { end = e; continue; }
    events.push(e);
  }
  events.sort((a, b) => a.t - b.t); // stabil sortering: samma tid behåller ordningen i filen
  const duration = Math.max(end ? end.t : 0, events.length ? events[events.length - 1].t : 0, header.durationMs || 0);
  return { header, events, end, duration, bad };
}

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// Sista index i en lista sorterad på t där t <= tid (eller -1).
function lastAt(list, t) {
  let lo = 0, hi = list.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

export function buildTimeline(rec) {
  const h = rec.header;
  const players = new Map(), stamps = new Map(), cameras = new Map(), images = { ...(h.images || {}) };
  const styles = [{ t: 0, style: h.style || null }], chat = [];
  const grooves = [{ t: 0, groove: h.groove || null }]; // the footstep groove (shared/groove.mjs): null = default
  // Peels: id -> { peel, image, from, to, pre }. pre = already on the floor at the start (no fall).
  // peelsOn: [{ t, on }]. Older recordings (no header.peelsOn): a peel on any stamp:add means on.
  const peels = new Map(), order = []; let open = 0, oldest = 0;
  const peelsOn = [{ t: 0, on: 'peelsOn' in h ? !!h.peelsOn : rec.events.some((e) => e.e === 'stamp:add' && e.peel) }];
  const peelOut = (p, t) => { if (p.to === Infinity) { p.to = t; open--; } };
  const addPeel = (peel, t, pre) => {
    if (!peel || !peel.id || peels.has(peel.id)) return;
    const p = { peel, image: images[peel.imageId] || null, from: t, to: Infinity, pre };
    peels.set(peel.id, p); order.push(p); open++;
    while (open > PEELS_MAX) peelOut(order[oldest++], t);
  };
  // The slap/peel arm gesture per player (stamp:add / stamp:remove with by = who did it): the
  // replay plays the slap animation on that avatar (client/src/replay.js), the cameramen push in.
  // An array row is one gesture (its first copy). gestures: id -> [{ t, kind, p, normal }] in time order.
  const gestures = new Map();
  const gesture = (by, kind, t, st) => {
    if (typeof by !== 'string' || !by || !st || !Array.isArray(st.position)) return;
    if (!gestures.has(by)) gestures.set(by, []);
    gestures.get(by).push({ t, kind, p: st.position.slice(), normal: Array.isArray(st.normal) ? st.normal.slice() : null });
  };
  const player = (id) => {
    if (!players.has(id)) players.set(id, { id, spans: [], looks: [], track: [], talk: [] });
    return players.get(id);
  };
  const enter = (p, t) => {
    const pl = player(p.id);
    const open = pl.spans[pl.spans.length - 1];
    if (!open || open.to !== Infinity) pl.spans.push({ from: t, to: Infinity });
    pl.looks.push({ t, name: p.name, look: p.look });
    if (Array.isArray(p.p)) pl.track.push({ t, p: p.p, y: p.y || 0, pi: p.pi || 0, jump: true });
  };
  const exit = (id, t) => { const pl = players.get(id); const open = pl && pl.spans[pl.spans.length - 1]; if (open && open.to === Infinity) open.to = t; };
  const camVersion = (c, t) => { if (!cameras.has(c.id)) cameras.set(c.id, []); cameras.get(c.id).push({ t, cam: c }); };

  for (const p of h.players || []) enter(p, 0);
  for (const s of h.stamps || []) stamps.set(s.id, { stamp: s, image: images[s.imageId] || null, from: 0, to: Infinity });
  for (const c of h.cameras || []) camVersion(c, 0);
  for (const p of h.peels || []) addPeel(p, 0, true);

  for (const e of rec.events) {
    const t = e.t;
    switch (e.e) {
      case 'join': enter(e, t); break;
      case 'leave': exit(e.id, t); break;
      case 'look': { const pl = player(e.id); pl.looks.push({ t, name: e.name, look: e.look }); break; }
      case 'move': { const pl = player(e.id); pl.track.push({ t, p: e.p, y: e.y || 0, pi: e.pi || 0 }); break; }
      // Voice loudness (0…15) while someone talks, for the mouth and the auto-director (shared/director.mjs).
      case 'talk': { const l = Number(e.l); if (Number.isFinite(l)) player(e.id).talk.push({ t, l: Math.max(0, Math.min(15, Math.round(l))) }); break; }
      case 'chat': chat.push({ t, id: e.mid, from: e.id, name: e.name, text: e.text }); break;
      case 'stamp:add':
        if (e.image) images[e.image.id] = e.image;
        if (e.stamp && !stamps.has(e.stamp.id)) stamps.set(e.stamp.id, { stamp: e.stamp, image: e.image || images[e.stamp.imageId] || null, from: t, to: Infinity });
        if (e.peel) addPeel(e.peel, t, false); // its backing paper starts falling now (one per slap, the first few of an array row)
        if (!(e.batch && e.batch.i > 0)) gesture(e.by, 'slap', t, e.stamp);
        break;
      case 'stamp:remove': { const s = stamps.get(e.id); if (s && s.to === Infinity) { s.to = t; if (!e.quiet) gesture(e.by, 'peel', t, s.stamp); } break; }
      case 'room:clear-hidden': for (const id of Array.isArray(e.ids) ? e.ids : []) { const s = stamps.get(id); if (s && s.to === Infinity) s.to = t; } break;
      case 'room:reset': for (const s of stamps.values()) if (s.to === Infinity) s.to = t; break;
      case 'image:remove':
        for (const s of stamps.values()) if (s.stamp.imageId === e.id && s.to === Infinity) s.to = t;
        for (const p of peels.values()) if (p.peel.imageId === e.id) peelOut(p, t);
        break;
      case 'room:peels': peelsOn.push({ t, on: !!e.on }); break;
      case 'peels:clear': for (const p of peels.values()) peelOut(p, t); break;
      case 'room:style': styles.push({ t, style: e.style }); break;
      case 'room:groove': if (e.groove) grooves.push({ t, groove: e.groove }); break;
      case 'camera:add': case 'camera:update': if (e.camera && e.camera.id) camVersion(e.camera, t); break;
      case 'camera:remove': camVersion({ id: e.id, removed: true }, t); break;
      default: break; // okända händelser (nyare versioner) hoppas över
    }
  }
  return { header: h, duration: rec.duration, players, stamps, cameras, styles, chat, images, grooves, peels, peelsOn, gestures };
}

// Var stod spelaren och åt vilket håll tittade den vid tiden t?
export function poseAt(track, t) {
  const i = lastAt(track, t);
  if (i < 0) return track.length ? { p: track[0].p.slice(), y: track[0].y, pi: track[0].pi } : null;
  const a = track[i], b = track[i + 1];
  if (!b || b.jump) return { p: a.p.slice(), y: a.y, pi: a.pi };
  const span = Math.min(b.t - a.t, GLIDE_MS), start = b.t - span;
  const k = span > 0 ? Math.min(1, Math.max(0, (t - start) / span)) : 1;
  const lerp = (x, y) => x + (y - x) * k;
  return { p: [lerp(a.p[0], b.p[0]), lerp(a.p[1], b.p[1]), lerp(a.p[2], b.p[2])], y: a.y + wrapAngle(b.y - a.y) * k, pi: lerp(a.pi, b.pi) };
}

// The talk level (0…15) at time t: the last sample, if it is fresh (they come ~every 80 ms).
function talkLevel(talk, t) { if (!talk || !talk.length) return 0; const i = lastAt(talk, t); return i >= 0 && t - talk[i].t <= 260 ? talk[i].l : 0; }

// Hela rummet vid tiden t (millisekunder från starten).
export function snapshotAt(tl, t, { chatKeep = 8 } = {}) {
  const players = [];
  for (const pl of tl.players.values()) {
    if (!pl.spans.some((s) => s.from <= t && t < s.to)) continue;
    const li = lastAt(pl.looks, t); const lk = pl.looks[Math.max(0, li)];
    const pose = poseAt(pl.track, t); if (!pose) continue;
    players.push({ id: pl.id, name: lk ? lk.name : '', look: lk ? lk.look : null, ...pose, talk: talkLevel(pl.talk, t) });
  }
  const stamps = [];
  for (const s of tl.stamps.values()) if (s.from <= t && t < s.to) stamps.push(s);
  stamps.sort((a, b) => (a.stamp.order || 0) - (b.stamp.order || 0) || (a.from - b.from));
  const cameras = [];
  for (const versions of tl.cameras.values()) {
    const i = lastAt(versions, t); if (i < 0) continue;
    const c = versions[i].cam; if (!c.removed) cameras.push(c);
  }
  cameras.sort((a, b) => String(a.name).localeCompare(String(b.name), 'sv', { numeric: true }));
  const style = tl.styles[lastAt(tl.styles, t)]?.style || null;
  const groove = tl.grooves ? tl.grooves[lastAt(tl.grooves, t)]?.groove || null : null;
  const ci = lastAt(tl.chat, t);
  const chat = ci < 0 ? [] : tl.chat.slice(Math.max(0, ci + 1 - chatKeep), ci + 1);
  // Peels on the floor (or falling) at t. age = ms since the slap (Infinity = was already there),
  // so the fall is a pure function of t too (client/src/peels.js uses peelPose with it).
  const peels = [];
  if (tl.peels) for (const p of tl.peels.values()) if (p.from <= t && t < p.to && p.image) peels.push({ peel: p.peel, image: p.image, age: p.pre ? Infinity : t - p.from });
  const peelsOn = tl.peelsOn ? !!tl.peelsOn[lastAt(tl.peelsOn, t)]?.on : false;
  return { t, players, stamps, cameras, style, chat, groove, peels, peelsOn };
}

// The gesture (slap/peel) a player is doing at t: { kind, p, normal, age } (age = ms since it
// started, < maxMs) or null. Pure function of t, so seeking and the finished video agree.
export function gestureAt(tl, id, t, maxMs = 500) {
  const list = tl.gestures && tl.gestures.get(id); if (!list || !list.length) return null;
  const i = lastAt(list, t); if (i < 0) return null;
  const g = list[i], age = t - g.t;
  return age >= 0 && age < maxMs ? { kind: g.kind, p: g.p, normal: g.normal, age, t: g.t } : null;
}

// Alla som var med någon gång (för väljaren "se med någons ögon").
export function participants(tl) {
  return [...tl.players.values()].map((pl) => ({ id: pl.id, name: pl.looks[pl.looks.length - 1]?.name || pl.id, from: pl.spans[0]?.from ?? 0 }));
}
