// The 3D props in a room or a city (shared/props.mjs; Jens t491u/t509u, 4 Nov 2026):
//   - the props LAYER: every prop of the space drawn (props3d.js), kept in step with the server
//     (prop:set / prop:remove), far ones lose their ink outline and very far ones are hidden (iPhone);
//     the cuboid's and the affischpelare's faces join the room's surfaces, so stickers go on them.
//   - COLLISION (Jens t521u): every prop is a few boxes (shared/propcollide.mjs) you can't walk through;
//     STICKERS on any prop's mesh too (prop-<id>-m<k>, world-space: they stay put if the prop moves).
//   - SITTING: the drawing tool opened near a free chair = I sit down on it and draw (the server keeps
//     one person per chair, everyone sees me sitting with a "drawing" mark); closing it = I stand up.
//   - the PROPS WHEEL (the build phase only – shared/city.mjs CITY_BUILD_PHASE – for admin / the full
//     version where shared/props.mjs canEditProps allows; not part of the final game): the third wheel,
//     next to the sticker and Nature wheels (V: Slap → Nature → Props). Pick a prop on the wheel, aim
//     (a ghost of it stands where you look; same Aim tool as stickers/nature: O / #aim-toggle, no
//     timeout). Click = place it. Click a placed prop = select it: a big
//     panel to turn, scale (0.25–4×), move, copy or delete it – the cuboid has width / height / depth
//     (0.1 m up to 32 m wide/deep, 24 m high) and a colour. Q/E turn, the mouse wheel scales, Delete
//     removes the selected one, Esc lets go. Every change is saved at once (PUT/DELETE …/props/:id).
import * as THREE from 'three';
import { makeProp, preloadProps, highlightOf, collisionBoxes } from './props3d.js';
import { createPropCollider, cuboidBoxes } from '../../shared/propcollide.mjs';
import { facesFromSurfaces } from './fold.js';
import { createWheel } from './wheel.js';
import { bindHoldRepeat } from './holdrepeat.js';
import { PROP_KINDS, KIND_IDS, cleanProp, newPropId, seatOf, nearestSeat, PROP_SCALE, BOX_LIMITS, BOX_COLOURS, MAX_PROPS } from '../../shared/props.mjs';

const SNAP = Math.PI / 12; // Q/E turn 15°
const INK_FAR = { room: 40, city: 45 }, HIDE_FAR = 150;
const r3 = (n) => Math.round(n * 1000) / 1000;

// o: { scene, renderer, camera, controls, room (surfaces, bounds), faces (stamps.faces: mutated in place),
//      roomId, outside, aim(ndc) → raycaster, aimOff() → bool, toast, isTouch,
//      canEdit() → bool, headers() → {} (x-room-key / x-admin-token / unlock), netId() → my id,
//      sendSit(chair, draw), takenSeats() → Set, setSelfSeat(seat|null), onModeChange(on), wheelUp() }
export function initProps(o) {
  const { scene, camera, controls, room } = o;
  const group = new THREE.Group(); group.name = 'props'; scene.add(group);
  const items = new Map(); // id -> { p, obj, inks: [], faces: [] }
  const pending = new Map(); // id -> token (a newer build of the same prop wins)
  const bounds = o.outside ? { width: 96, height: 24, depth: 96 } : { width: 16, height: 8, depth: 16 };
  // You can't walk through props (shared/propcollide.mjs; Jens t521u): a few boxes per prop.
  const collider = createPropCollider();
  const collide = (it) => { const local = PROP_KINDS[it.p.kind].box ? cuboidBoxes(it.p) : collisionBoxes(it.p, it.obj); collider.set(it.p, local || []); };
  // Stickers on any prop (Jens t521u): every mesh of a prop (not the cuboid's / affischpelare's faces,
  // which are room surfaces) is a sticker target named prop-<id>-m<k>; stickers on it are world-space like
  // on a wall (stamps.js projects them onto the prop's meshes), so they stay where they were slapped if
  // the prop is moved later (Jens: build first, texture afterwards).
  const meshName = (id, k) => `prop-${id}-m${k}`;

  // ---------- the layer ----------
  const faceName = (id, f) => `prop-${id}-${f}`;
  function refreshFaces() {
    if (!o.faces) return;
    const f = facesFromSurfaces(room.surfaces); if (!f) return;
    o.faces.length = 0; o.faces.push(...f);
  }
  function dropFaces(id) {
    for (let i = room.surfaces.length - 1; i >= 0; i--) if (room.surfaces[i].userData.prop === id) room.surfaces.splice(i, 1);
  }
  function place(obj, p) {
    obj.position.set(p.x, p.y || 0, p.z); obj.rotation.set(0, p.yaw || 0, 0);
    obj.scale.setScalar(PROP_KINDS[p.kind].box ? 1 : p.s || 1); obj.updateMatrixWorld(true);
  }
  const sameShape = (a, b) => a.kind === b.kind && (!PROP_KINDS[a.kind].box || (a.sx === b.sx && a.sy === b.sy && a.sz === b.sz && a.color === b.color));
  async function upsert(p, { refresh = true } = {}) {
    p = cleanProp(p, bounds); if (!p) return null;
    const cur = items.get(p.id);
    if (cur && sameShape(cur.p, p)) { cur.p = p; place(cur.obj, p); collide(cur); if (refresh && cur.faces.length) refreshFaces(); return cur; }
    const token = {}; pending.set(p.id, token);
    let obj; try { obj = await makeProp(p); } catch (e) { console.warn('[props]', p.kind, e && (e.stack || e.message)); return null; }
    if (pending.get(p.id) !== token) return null; // a newer one (or a removal) came meanwhile
    pending.delete(p.id);
    const old = items.get(p.id); if (old) { group.remove(old.obj); dropFaces(p.id); }
    place(obj, p); obj.userData.propId = p.id;
    const inks = [], faces = [], meshes = [];
    obj.traverse((m) => {
      if (m.userData.ink) inks.push(m);
      else if (m.isMesh) m.userData.propId = p.id;
      if (m.isMesh && m.userData.propFace) { m.name = faceName(p.id, m.userData.propFace); m.userData.prop = p.id; faces.push(m); }
      else if (m.isMesh && !m.userData.ink) { m.name = meshName(p.id, meshes.length); m.userData.propMesh = p.id; meshes.push(m); }
    });
    group.add(obj);
    for (const f of faces) room.surfaces.push(f);
    const it = { p, obj, inks, faces, meshes }; items.set(p.id, it);
    collide(it);
    o.onPropBuilt?.(p.id);
    if (refresh && faces.length) refreshFaces();
    if (sel && sel.id === p.id) highlight(it, true);
    return it;
  }
  function remove(id) {
    pending.delete(id);
    const it = items.get(id); if (!it) return false;
    group.remove(it.obj); items.delete(id); collider.remove(id);
    if (it.faces.length) { dropFaces(id); refreshFaces(); }
    if (sel && sel.id === id) deselect();
    return true;
  }
  // The whole list (loading the room / after a reconnect): built before the stickers are added, so a
  // sticker on a cuboid's face finds its face.
  async function setAll(list) {
    const want = new Map((list || []).map((p) => [p.id, p]));
    for (const id of [...items.keys()]) if (!want.has(id)) remove(id);
    await Promise.all([...want.values()].map((p) => upsert(p, { refresh: false })));
    refreshFaces();
  }
  const list = () => [...items.values()].map((it) => it.p);

  // far away: no ink (and very far: not drawn) – checked a few times a second, not every frame
  let lodT = 0;
  function lod(dt) {
    lodT -= dt; if (lodT > 0) return; lodT = 0.4;
    const c = camera.position, far = o.outside ? INK_FAR.city : INK_FAR.room;
    for (const it of items.values()) {
      const p = it.p, d = Math.hypot(p.x - c.x, p.z - c.z), big = Math.max(p.s || 1, (p.sx || 0) / 4, (p.sy || 0) / 4, (p.sz || 0) / 4, 1);
      it.obj.visible = d < HIDE_FAR * Math.min(2, big);
      const ink = d < far * big;
      if (it.inkOn !== ink) { it.inkOn = ink; for (const m of it.inks) m.visible = ink; }
    }
  }

  // ---------- sitting down to draw ----------
  let mySeat = null; // { id, seat, eye: Vector3, back: Vector3 }
  function seatPose(id) {
    const it = items.get(id); const s = it && seatOf(it.p); if (!s) return null;
    return { x: s.x, y0: it.p.y || 0, z: s.z, yaw: s.yaw, eye: s.eye };
  }
  // The drawing tool opened: the nearest free chair in reach (shared/props.mjs SIT_REACH) – sit on it.
  function sitToDraw() {
    if (mySeat) { o.sendSit(mySeat.id, true); o.setSelfSeat({ ...mySeat.seat, draw: true }); return true; }
    const taken = o.takenSeats();
    const ch = nearestSeat(list(), camera.position.x, camera.position.z, taken);
    if (!ch) return false;
    const s = seatPose(ch.id);
    const fwd = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    const eye = new THREE.Vector3(s.x, s.eye, s.z).addScaledVector(fwd, 0.12);
    const back = new THREE.Vector3(s.x, camera.position.y, s.z).addScaledVector(fwd, -0.75);
    mySeat = { id: ch.id, seat: s, eye, back };
    o.sendSit(ch.id, true); o.setSelfSeat({ ...s, draw: true });
    camera.position.copy(eye); controls.yaw = s.yaw - Math.PI; controls.pitch = -0.35; controls.apply?.();
    return true;
  }
  function standUp() {
    if (!mySeat) return false;
    const m = mySeat; mySeat = null;
    o.sendSit(null, false); o.setSelfSeat(null);
    camera.position.set(m.back.x, (m.seat.y0 || 0) + 1.6, m.back.z); controls.pitch = 0; controls.apply?.();
    return true;
  }
  // every frame, after the controls moved me: sitting = I stay on the chair; walking off = stand up
  function keepSeat() {
    if (!mySeat) return;
    const e = mySeat.eye;
    if (Math.hypot(camera.position.x - e.x, camera.position.z - e.z) > 0.04) { const mv = camera.position.clone(); standUp(); camera.position.x = mv.x; camera.position.z = mv.z; return; }
    camera.position.copy(e);
  }
  function onSit(m) { if (m.taken && mySeat && m.taken === mySeat.id) { mySeat = null; o.setSelfSeat(null); o.toast?.('Someone else just sat there.', 1800); } }

  // ---------- the Props wheel (the build phase) ----------
  let active = false, kind = null, held = { yaw: 0, s: 1, sx: 2, sy: 1, sz: 2, color: BOX_COLOURS[0] };
  let ghost = null, ghostKey = '', ghostAt = null, sel = null, moving = null, thumbs = null;
  const $ = (id) => document.getElementById(id);
  const ui = buildUi();
  const wheel = createWheel(ui.row, { pick: (d) => { pickKind(d.id); }, onActivity: () => o.wheelUp?.() });
  const kindsInOrder = () => {
    const first = o.outside ? ['city', 'both', 'room'] : ['room', 'both', 'city'];
    return first.flatMap((w) => KIND_IDS.filter((k) => PROP_KINDS[k].where === w));
  };
  function wheelList() { return kindsInOrder().map((k) => ({ id: k, url: (thumbs && thumbs.get(k)) || labelThumb(PROP_KINDS[k].label) })); }
  function renderWheel() {
    wheel.setList(wheelList()); wheel.setSelected(kind);
    const i = kindsInOrder().indexOf(kind);
    ui.num.textContent = `🪑 ${i >= 0 ? `${i + 1}/` : ''}${KIND_IDS.length} · ${kind ? PROP_KINDS[kind].label : ''}`;
  }
  const open = () => !!o.canEdit();
  function setActive(on) {
    on = !!on && open();
    if (on === active) return active;
    active = on; document.body.classList.toggle('props-mode', on); ui.strip.hidden = !on;
    if (on) {
      if (!kind) kind = kindsInOrder()[0];
      renderWheel(); makeThumbs();
    } else { deselect(); clearGhost(); moving = null; }
    o.onModeChange?.(on);
    return active;
  }
  function pickKind(k) { if (!PROP_KINDS[k]) return; kind = k; moving = null; if (sel) deselect(); renderWheel(); clearGhost(); }
  function step(dir) { const l = kindsInOrder(); const i = l.indexOf(kind); pickKind(l[(i + dir + l.length) % l.length]); }

  // the ghost: the held prop where I aim (see-through)
  const heldRecord = () => {
    const base = moving ? { ...moving } : { id: 'ffffffffff', kind, ...held };
    return base;
  };
  function clearGhost() { if (ghost) { group.remove(ghost); ghost = null; ghostKey = ''; } }
  async function ensureGhost() {
    const p = heldRecord(); if (!p.kind) return;
    const key = p.kind + (PROP_KINDS[p.kind].box ? `${p.sx}/${p.sy}/${p.sz}/${p.color}` : '');
    if (key === ghostKey) return; ghostKey = key;
    const obj = await makeProp(cleanProp({ ...p, x: 0, z: 0 }, bounds) || p);
    if (ghostKey !== key || !active) return;
    if (ghost) group.remove(ghost);
    obj.traverse((m) => { if (m.isMesh) { m.raycast = () => {}; if (!m.userData.ink) { const see = (x) => { const c = x.clone(); c.transparent = true; c.opacity = 0.55; c.depthWrite = false; return c; }; m.material = Array.isArray(m.material) ? m.material.map(see) : see(m.material); } } });
    ghost = obj; ghost.renderOrder = 50; group.add(ghost);
  }
  // where a prop goes: a floor-like surface I aim at (the ground, a floor, a cuboid's top)
  function aimAt(ndc) {
    const rc = o.aim(ndc);
    const hits = rc.intersectObjects(room.surfaces, false);
    for (const h of hits) {
      const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
      if (n.y > 0.7) return h.point.clone();
      if (n.y < 0.3) { // a wall: on the floor right in front of it
        const pt = h.point.clone().addScaledVector(n.setY(0).normalize(), 0.3); pt.y = 0; return pt;
      }
    }
    return null;
  }
  function pickProp(ndc) {
    const rc = o.aim(ndc);
    const objs = []; for (const it of items.values()) objs.push(it.obj);
    const h = rc.intersectObjects(objs, true).find((x) => x.object.visible && !x.object.userData.ink);
    if (!h) return null;
    let m = h.object; while (m && !m.userData.propId) m = m.parent;
    const wall = rc.intersectObjects(room.surfaces.filter((s) => !s.userData.prop), false)[0];
    if (wall && wall.distance < h.distance - 0.01) return null;
    return m ? items.get(m.userData.propId) || null : null;
  }
  const CENTER = new THREE.Vector2(0, 0);
  // Aim tool (O / #aim-toggle): same on/off as stickers and nature; no auto-fade.
  const aimOn = () => !o.aimOff?.();
  function tick(dt, ndc = CENTER) {
    lod(dt); keepSeat();
    if (!active || sel || !aimOn()) { if (ghost) ghost.visible = false; return; }
    ensureGhost();
    const pt = aimAt(ndc);
    ghostAt = pt;
    if (!ghost) return;
    ghost.visible = !!pt;
    if (pt) { const p = heldRecord(); ghost.position.copy(pt); ghost.rotation.set(0, p.yaw || 0, 0); ghost.scale.setScalar(PROP_KINDS[p.kind].box ? 1 : p.s || 1); }
  }

  // ---------- saving ----------
  const url = (id) => `/api/rooms/${encodeURIComponent(o.roomId)}/props/${id}`;
  async function save(p) {
    const r = await fetch(url(p.id), { method: 'PUT', headers: { 'Content-Type': 'application/json', ...o.headers() }, body: JSON.stringify({ prop: p, by: o.netId() || undefined }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
    return d.prop;
  }
  let saveT = 0, saveP = null;
  function saveSoon(p) { saveP = p; clearTimeout(saveT); saveT = setTimeout(() => { const q = saveP; saveP = null; save(q).catch((e) => o.toast?.(e.message, 2600)); }, 250); }
  async function del(id) {
    const r = await fetch(url(id), { method: 'DELETE', headers: o.headers() });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || `Error ${r.status}`); }
  }

  // place the held prop (or the one being moved) where the ghost is
  async function placeHeld() {
    if (!ghostAt) { o.toast?.('Aim at the floor or the ground.', 1600); return null; }
    if (!moving && items.size >= MAX_PROPS) { o.toast?.(`At most ${MAX_PROPS} props here.`, 2200); return null; }
    const base = heldRecord();
    const p = cleanProp({ ...base, id: moving ? moving.id : newPropId(), x: ghostAt.x, y: Math.max(0, ghostAt.y), z: ghostAt.z }, bounds);
    if (!p) return null;
    moving = null; clearGhost();
    await upsert(p);
    try { await save(p); } catch (e) { o.toast?.(e.message, 2600); }
    return p;
  }
  // a click / tap in Props mode: a prop under it = select it; else place the held one.
  // Aim off (O): do not place; selecting a placed prop is still allowed.
  function click(ndc = CENTER) {
    if (!active) return false;
    if (!aimOn()) {
      if (moving) return true;
      if (sel) { const it = pickProp(ndc); if (it && it.p.id !== sel.id) select(it.p.id); else deselect(); return true; }
      const it = pickProp(ndc);
      if (it) { select(it.p.id); return true; }
      return true;
    }
    if (moving) { placeHeld(); return true; }
    if (sel) { const it = pickProp(ndc); if (it && it.p.id !== sel.id) select(it.p.id); else deselect(); return true; }
    const it = pickProp(ndc);
    if (it) { select(it.p.id); return true; }
    if (o.isTouch) { ghostAt = aimAt(ndc); }
    placeHeld();
    return true;
  }

  // ---------- the selected prop's panel ----------
  // no ink hulls (INK_OUTLINES off): the selected prop glows yellow instead
  function highlight(it, on) { if (!it.inks.length) return glow(it, on); for (const m of it.inks) { if (on) { m.userData.mat = m.userData.mat || m.material; m.material = highlightOf(m.userData.mat); m.visible = true; } else if (m.userData.mat) m.material = m.userData.mat; } }
  function select(id) {
    const it = items.get(id); if (!it) return;
    if (sel) { const o2 = items.get(sel.id); if (o2) highlight(o2, false); }
    sel = { id }; highlight(it, true); clearGhost();
    controls.unlock?.(); // the mouse is free for the panel
    renderPanel();
  }
  function glow(it, on) {
    it.obj.traverse((m) => {
      if (!m.isMesh) return;
      if (on && !m.userData.glowMat) { const mk = (x) => { if (!x.emissive) return x; const c = x.clone(); c.emissive.setHex(0x806a00); return c; }; m.userData.glowMat = m.material; m.material = Array.isArray(m.material) ? m.material.map(mk) : mk(m.material); }
      else if (!on && m.userData.glowMat) { m.material = m.userData.glowMat; delete m.userData.glowMat; }
    });
  }
  function deselect() { if (sel) { const it = items.get(sel.id); if (it) highlight(it, false); } sel = null; ui.panel.hidden = true; }
  const selected = () => (sel ? items.get(sel.id)?.p || null : null);
  function change(fn) {
    const p0 = selected(); if (!p0) return;
    const p = cleanProp(fn({ ...p0 }), bounds); if (!p) return;
    upsert(p); saveSoon(p); renderPanel(p);
  }
  function renderPanel(p = selected()) {
    if (!p) { ui.panel.hidden = true; return; }
    const K = PROP_KINDS[p.kind];
    ui.panel.hidden = false;
    ui.title.textContent = K.label;
    ui.boxRow.hidden = !K.box; ui.scaleRow.hidden = !!K.box;
    ui.scale.value = String(p.s || 1); ui.scaleOut.textContent = `${(p.s || 1).toFixed(2)}×`;
    ui.turnOut.textContent = `${Math.round(((p.yaw || 0) * 180) / Math.PI) % 360}°`;
    if (K.box) for (const ax of ['sx', 'sy', 'sz']) { ui[ax].value = String(p[ax]); ui[ax + 'n'].value = String(p[ax]); }
    for (const b of ui.colours.children) b.classList.toggle('on', K.box && b.dataset.c === p.color);
  }
  function turn(dir) {
    if (sel) return change((p) => ({ ...p, yaw: (p.yaw || 0) + dir * SNAP }));
    if (moving) moving.yaw = (moving.yaw || 0) + dir * SNAP; else held.yaw += dir * SNAP;
  }
  function scaleBy(k) {
    const P = PROP_KINDS[sel ? selected()?.kind : (moving || {}).kind || kind];
    if (!P) return;
    if (P.box) { // the cuboid: all three sides
      const f = (p) => ({ ...p, sx: p.sx * k, sy: p.sy * k, sz: p.sz * k });
      if (sel) return change(f);
      if (moving) Object.assign(moving, f(moving)); else Object.assign(held, f(held));
      for (const t of [held, moving]) if (t) { t.sx = clampSide(t.sx); t.sy = clampSide(t.sy); t.sz = clampSide(t.sz); }
      return;
    }
    const cl = (s) => { const n = r3(s); return Number.isFinite(n) ? Math.max(PROP_SCALE.min, n) : PROP_SCALE.min; };
    if (sel) return change((p) => ({ ...p, s: cl((p.s || 1) * k) }));
    if (moving) moving.s = cl((moving.s || 1) * k); else held.s = cl(held.s * k);
  }
  const clampSide = (v) => { const n = r3(v); return Number.isFinite(n) ? Math.max(BOX_LIMITS.min, n) : BOX_LIMITS.min; };
  async function removeSelected() {
    const p = selected(); if (!p) return;
    remove(p.id);
    try { await del(p.id); o.toast?.('Removed.', 1200); } catch (e) { o.toast?.(e.message, 2600); }
  }
  function moveSelected() { const p = selected(); if (!p) return; deselect(); moving = { ...p }; controls.lock?.(); o.toast?.('Aim and click to put it down.', 1800); }
  function copySelected() {
    const p = selected(); if (!p) return; deselect();
    kind = p.kind; held = { ...held, yaw: p.yaw || 0, s: p.s || 1, ...(PROP_KINDS[p.kind].box ? { sx: p.sx, sy: p.sy, sz: p.sz, color: p.color } : {}) };
    renderWheel(); clearGhost(); controls.lock?.(); o.toast?.('Copy in hand – click to place it.', 1800);
  }

  function buildUi() {
    const strip = document.createElement('div'); strip.id = 'props-strip'; strip.hidden = true; strip.setAttribute('role', 'listbox'); strip.title = 'Props (build phase)';
    strip.innerHTML = '<span id="props-num"></span><div id="props-row"></div>';
    document.body.appendChild(strip);
    strip.addEventListener('mousedown', (e) => e.stopPropagation());
    const panel = document.createElement('div'); panel.id = 'props-panel'; panel.hidden = true;
    panel.innerHTML = `
      <div class="pp-head"><b id="pp-title"></b><button type="button" id="pp-done" class="pp-x" aria-label="Done">✕</button></div>
      <div class="pp-row"><span class="pp-lab">Turn</span><button type="button" id="pp-left">⟲</button><span id="pp-turn" class="pp-out"></span><button type="button" id="pp-right">⟳</button></div>
      <div class="pp-row" id="pp-scale-row"><span class="pp-lab">Size</span><button type="button" id="pp-smaller">−</button><input type="range" id="pp-scale" min="${PROP_SCALE.min}" max="${PROP_SCALE.uiMax}" step="0.05"><button type="button" id="pp-bigger">+</button><span id="pp-scale-out" class="pp-out"></span></div>
      <div id="pp-box">
        ${[['sx', 'Width', BOX_LIMITS.uiMaxSide], ['sy', 'Height', BOX_LIMITS.uiMaxHeight], ['sz', 'Depth', BOX_LIMITS.uiMaxSide]].map(([a, l, max]) => `<div class="pp-row"><span class="pp-lab">${l}</span><input type="range" id="pp-${a}" min="${BOX_LIMITS.min}" max="${max}" step="0.05"><input type="number" id="pp-${a}n" min="${BOX_LIMITS.min}" max="${max}" step="0.1"><span class="pp-unit">m</span></div>`).join('')}
        <div class="pp-row pp-colours" id="pp-colours">${BOX_COLOURS.map((c) => `<button type="button" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>
      </div>
      <div class="pp-row pp-actions"><button type="button" id="pp-move">✋ Move</button><button type="button" id="pp-copy">⧉ Copy</button><button type="button" id="pp-del">🗑 Delete</button></div>
      <p class="pp-note">Build phase only · saved at once</p>`;
    document.body.appendChild(panel);
    for (const ev of ['mousedown', 'pointerdown', 'wheel', 'keydown']) panel.addEventListener(ev, (e) => e.stopPropagation());
    const q = (id) => panel.querySelector('#' + id);
    const u = { strip, row: strip.querySelector('#props-row'), num: strip.querySelector('#props-num'), panel, title: q('pp-title'), scale: q('pp-scale'), scaleOut: q('pp-scale-out'), turnOut: q('pp-turn'),
      scaleRow: q('pp-scale-row'), boxRow: q('pp-box'), colours: q('pp-colours') };
    for (const a of ['sx', 'sy', 'sz']) { u[a] = q('pp-' + a); u[a + 'n'] = q(`pp-${a}n`); }
    q('pp-done').onclick = () => { deselect(); controls.lock?.(); };
    // Hold-to-repeat (Jens: wheels keep spinning while pressed) – Turn ⟲/⟳ and Size −/+.
    bindHoldRepeat(q('pp-left'), () => turn(1));
    bindHoldRepeat(q('pp-right'), () => turn(-1));
    bindHoldRepeat(q('pp-smaller'), () => scaleBy(1 / 1.1));
    bindHoldRepeat(q('pp-bigger'), () => scaleBy(1.1));
    u.scale.oninput = () => change((p) => ({ ...p, s: Number(u.scale.value) }));
    for (const a of ['sx', 'sy', 'sz']) {
      u[a].oninput = () => change((p) => ({ ...p, [a]: Number(u[a].value) }));
      u[a + 'n'].onchange = () => change((p) => ({ ...p, [a]: Number(u[a + 'n'].value) }));
    }
    u.colours.onclick = (e) => { const c = e.target.closest('button')?.dataset.c; if (c) { change((p) => ({ ...p, color: c })); held.color = c; } };
    q('pp-move').onclick = moveSelected; q('pp-copy').onclick = copySelected; q('pp-del').onclick = removeSelected;
    return u;
  }
  // the wheel's pictures: every prop rendered once, small, with the game's renderer
  function labelThumb(text) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="138"><rect x="6" y="20" width="108" height="100" rx="18" fill="#fff" stroke="#15130f" stroke-width="6"/><text x="60" y="78" font-family="Arial" font-weight="700" font-size="17" text-anchor="middle" fill="#15130f">${String(text).replace(/[<&>]/g, '')}</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  let thumbing = null;
  function makeThumbs() {
    if (thumbing || !o.renderer) return thumbing;
    thumbing = (async () => {
      await preloadProps().catch(() => {});
      const R = o.renderer, W = 160, H = 184, rt = new THREE.WebGLRenderTarget(W, H, { colorSpace: THREE.SRGBColorSpace });
      const sc = new THREE.Scene(); sc.add(new THREE.AmbientLight(0xffffff, 1.6)); const dl = new THREE.DirectionalLight(0xffffff, 2.2); dl.position.set(2, 4, 3); sc.add(dl);
      const cam = new THREE.PerspectiveCamera(30, W / H, 0.05, 500), px = new Uint8Array(W * H * 4);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g2 = cv.getContext('2d'); const img = g2.createImageData(W, H);
      const out = new Map();
      for (const k of KIND_IDS) {
        let obj; try { obj = await makeProp({ id: 'eeeeeeeeee', kind: k, x: 0, y: 0, z: 0, yaw: 0, s: 1, sx: 1.2, sy: 1.2, sz: 1.2, color: '#3f7fd0' }); } catch { continue; }
        obj.rotation.y = -0.6; sc.add(obj); obj.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(obj), c = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3());
        const r = Math.max(sz.x, sz.y, sz.z) * 0.62;
        cam.position.set(c.x + r * 1.6, c.y + r * 1.1, c.z + r * 2.6); cam.lookAt(c); cam.near = r * 0.1; cam.far = r * 20; cam.updateProjectionMatrix();
        const prev = R.getRenderTarget(), clr = R.getClearColor(new THREE.Color()), ca = R.getClearAlpha();
        R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(sc, cam); R.readRenderTargetPixels(rt, 0, 0, W, H, px);
        R.setRenderTarget(prev); R.setClearColor(clr, ca);
        for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
        g2.putImageData(img, 0, 0); out.set(k, cv.toDataURL('image/png'));
        sc.remove(obj);
      }
      rt.dispose(); thumbs = out; if (active) renderWheel();
      return out;
    })();
    return thumbing;
  }

  // controls.js, every step: from (px, pz) to (x, z) → where I may be. Sitting: the chair doesn't push me off.
  function collideStep(px, pz, x, z, eyeY, clamp) { return collider.move(px, pz, x, z, eyeY, mySeat ? mySeat.id : null, clamp); }
  // the sticker targets: every prop mesh (raycast for a slap), and one prop's meshes (stamps.js)
  function stickerMeshes() { const out = []; for (const it of items.values()) if (it.obj.visible) for (const m of it.meshes) if (m.visible !== false) out.push(m); return out; }
  const meshesOf = (id) => items.get(id)?.meshes || null;
  return {
    collideStep, collider, stickerMeshes, meshesOf,
    group, upsert, remove, setAll, list, items, refreshFaces,
    onEvent(e) {
      if (!e) return false;
      if (e.type === 'prop:set' && e.prop) { upsert(e.prop); return true; }
      if (e.type === 'prop:remove' && e.id) { remove(e.id); return true; }
      return false;
    },
    seatPose, sitToDraw, standUp, seated: () => (mySeat ? { id: mySeat.id, ...mySeat.seat } : null), onSit,
    open, active: () => active, setActive, toggle: () => setActive(!active), tick, click, turn, scaleBy, step, pickKind,
    select, deselect, selected, removeSelected, moveSelected, copySelected, change, held: () => ({ kind, ...held, moving: moving ? { ...moving } : null }),
    ghost: () => (ghost && ghost.visible ? ghost.position.toArray() : null),
    thumbs: () => makeThumbs(),
    info: () => ({ active, kind, n: items.size, sel: sel ? sel.id : null, panel: !ui.panel.hidden, strip: !ui.strip.hidden, ghost: !!(ghost && ghost.visible), seated: mySeat ? mySeat.id : null, faces: o.faces ? o.faces.length : 0 }),
  };
}
