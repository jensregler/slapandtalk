// Tillsammans i rummet: andras gubbar, chatten och "Min gubbe".
// main.js anropar initTogether(...) en gång och sedan together.update(dt) varje bildruta.
import * as THREE from 'three';
import { connect } from './net.js';
import { S, LOCALE } from './strings.js';
import { Players, Avatar, loadAvatarModel, loadMyAvatar, saveMyAvatar, normalizeLook, randomLook, AVATAR, cleanName } from './avatars.js';
import { initFabricUI, addRecent } from './fabricui.js';
import { fabricStats } from './fabrics.js';
import { has, credentials } from './entitlements.js';
import { loadSoundLook } from './soundui.js';
import { SHOW, showTurn } from './avatarview.js';

const SEND_HZ = 12;
const CHAT_FADE_MS = 15_000;

// pass(): demo admission ({ roomKey, member, invite }, see demo.js). onDenied/onInvite: demo messages.
// onPeople(ids): the players in the room changed (voice.js builds its connections from it).
// onSignal(from, data): WebRTC signalling for voice chat.
export function initTogether({ room, scene, camera, controls, isTouch, toast, artist, onEvent, onReconnect, onWelcome = () => {}, onBusyChange = () => {}, onSound = () => {},
  pass = () => null, ready = null, onDenied = () => {}, onInvite = () => {}, onPeople = () => {}, onSignal = () => {} }) {
  const $ = (id) => document.getElementById(id);
  const me = loadMyAvatar();
  if (!me.saved) saveMyAvatar(me.name, me.look); // en slumpad gubbe ska se likadan ut nästa gång
  const myName = () => me.name || cleanName(artist()) || '';
  // What others see (and I see on my own avatar): fabrics only with the full version
  // (the server drops them otherwise). Other players' fabrics are always shown.
  // Sound: my seed (= my own variation of the default sounds) always; custom patches/FX only
  // with soundDesign (the server drops them otherwise).
  const shownSound = () => { const s = loadSoundLook(); if (!has('soundDesign')) { delete s.patches; delete s.fx; } s.colour = mySlot; return s; };
  // roomLook: the room's own character for me (a preset room, free version – main.js, shared/randomlook.mjs).
  // It replaces my look for others, recordings and my own avatar there; my own look stays saved for other rooms.
  let roomLook = null;
  const shownLook = () => { const l = { ...(roomLook || me.look), sound: shownSound() }; if (!has('fabrics') || roomLook) delete l.fabric; return l; };
  const players = new Players(scene);
  let status = 'connecting', full = false, unread = 0, serverName = '', mySlot = 0; const talking = new Set(); // serverName = det namn de andra ser på mig

  // ---------- Anslutningen ----------
  const net = connect(room, {
    ...(ready ? { ready } : {}),
    hello: () => { const ps = pass(); return { name: myName(), look: shownLook(), unlock: credentials(), p: camera.position.toArray(), y: controls.yaw, pi: controls.pitch, ...(ps ? { pass: ps } : {}) }; },
    onYou(name) { serverName = name; renderPeople(); },
    onWelcome(m) {
      serverName = m.you?.name || ''; mySlot = Number.isInteger(m.you?.slot) ? m.you.slot : 0; onSound(shownSound());
      players.remove('*');
      for (const p of m.players) players.upsert(p);
      full = !!m.full; $('full-banner').hidden = !full;
      if (full) $('full-banner').textContent = Number.isInteger(m.max) ? S.fullBannerMax(m.max) : S.fullBanner;
      setChatHistory(m.chat || []);
      last = null; renderPeople(); renderChatInput();
      onWelcome(m); onPeople(ids());
    },
    onJoin(p, rejoin) { players.upsert(p); if (!rejoin) sys(S.joined(p.name)); renderPeople(); onPeople(ids()); },
    onLeave(id, rejoin) {
      if (id !== '*' && !rejoin) { const pl = players.map.get(id); if (pl) sys(S.left(pl.name)); } // med det namn personen har nu
      players.remove(id); if (id === '*') talking.clear(); else talking.delete(id); renderPeople(); onPeople(ids());
    },
    onDenied, onInvite, onSignal,
    onMove: (id, p, y) => players.move(id, p, y),
    onLook(id, name, look) {
      const pl = players.map.get(id);
      if (pl && pl.name !== name) sys(S.renamed(pl.name, name));
      players.look(id, name, look); renderPeople();
    },
    onChat(msg) { addChat(msg); if (msg.from !== net.id) players.say(msg.from, msg.text); },
    onEvent,
    onStatus(s) { status = s; renderPeople(); renderChatInput(); if (s === 'online' && roomLook) net.sendLook(myName(), shownLook()); },
    onReconnect,
    onError: (e) => toast(e, 2500),
  });

  const ids = () => [...players.map.keys()];
  // Skicka min position ~12 gånger per sekund, men bara när jag faktiskt rör mig.
  let last = null, acc = 0;
  function sendMove(dt) {
    acc += dt; if (acc < 1 / SEND_HZ) return; acc = 0;
    if (net.status !== 'online') return;
    // Blickriktningen upp/ner (pitch) skickas också, så en inspelning kan visas med någons ögon.
    const p = camera.position, y = controls.yaw, pi = controls.pitch;
    if (last && Math.abs(p.x - last.x) < 0.01 && Math.abs(p.z - last.z) < 0.01 && Math.abs(y - last.y) < 0.01 && Math.abs(pi - last.pi) < 0.02) return;
    last = { x: p.x, z: p.z, y, pi };
    net.sendMove([+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)], +y.toFixed(3), +pi.toFixed(3));
  }

  // ---------- Vem är här ----------
  function renderPeople() {
    const dot = $('net-dot'); dot.className = 'dot ' + status;
    const n = players.map.size + (status === 'online' ? 1 : 0);
    $('presence-text').textContent = status === 'online' ? S.presenceOnline(n)
      : status === 'full' ? S.presenceFull(players.map.size) : status === 'connecting' ? S.presenceConnecting
        : status === 'closed' ? S.deniedGone : status === 'denied' ? S.deniedInvite : S.presenceOffline;
    const ul = $('people'); ul.innerHTML = '';
    const add = (name, color, mine, id) => {
      const li = document.createElement('li'); const i = document.createElement('i'); i.style.background = color;
      if (talking.has(id)) li.classList.add('speaking');
      li.append(i, document.createTextNode(mine ? S.youSuffix(name || S.you) : name)); ul.appendChild(li);
    };
    if (status === 'online') add(serverName || myName(), shownLook().shirt, true, 'me');
    for (const p of players.map.values()) add(p.name, p.look?.shirt || '#888', false, p.id);
  }

  // ---------- Chatt ----------
  const log = $('chat-log'), input = $('chat-input'), form = $('chat-form'), chatEl = $('chat');
  const fmt = (iso) => new Date(iso).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
  function line(li) {
    log.appendChild(li);
    while (log.children.length > 50) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    setTimeout(() => li.classList.add('old'), CHAT_FADE_MS);
  }
  // Allt läggs in som text (textContent), aldrig som HTML – så <script> och liknande visas bara som text.
  function addChat(msg, { history = false } = {}) {
    const li = document.createElement('li');
    li.dataset.id = msg.id; if (msg.from === net.id) li.classList.add('me');
    const tm = document.createElement('span'); tm.className = 'tm'; tm.textContent = fmt(msg.time);
    const nm = document.createElement('span'); nm.className = 'n'; nm.textContent = msg.name;
    li.append(tm, nm, document.createTextNode(msg.text));
    if (history) li.classList.add('old');
    line(li);
    if (!history && !chatOpen() && msg.from !== net.id) { unread++; $('chat-unread').textContent = String(unread); }
  }
  function sys(text) { const li = document.createElement('li'); li.className = 'sys'; li.textContent = text; line(li); }
  function setChatHistory(list) { log.innerHTML = ''; for (const m of list) addChat(m, { history: true }); }
  function renderChatInput() {
    const can = status === 'online';
    input.disabled = !can;
    input.placeholder = can ? S.chatPlaceholder(isTouch)
      : status === 'full' ? S.chatPlaceholderFull : S.chatPlaceholderOffline;
  }
  const chatOpen = () => chatEl.classList.contains('open');
  function openChat() {
    chatEl.classList.add('open'); form.hidden = false; unread = 0; $('chat-unread').textContent = '';
    input.focus(); onBusyChange(); // T-tangenten skrivs inte in: keydown har preventDefault
  }
  function closeChat() { chatEl.classList.remove('open'); form.hidden = true; input.blur(); onBusyChange(); }
  form.onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text) { if (!net.sendChat(text)) toast(S.noConnection); input.value = ''; }
    if (!isTouch || !text) closeChat(); // dator: Enter skickar och stänger
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeChat(); }
  });
  $('chat-close').onclick = () => closeChat();
  $('chat-btn').onclick = (e) => { e.preventDefault(); if (chatOpen()) closeChat(); else openChat(); };
  // Dator: T eller Enter öppnar chatten (inte medan man skriver någon annanstans).
  addEventListener('keydown', (e) => {
    if (isTouch || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target; if (t && t.closest && t.closest('input, textarea, select, [contenteditable]')) return;
    if (av.open || chatOpen()) return;
    if (e.code === 'KeyT' || e.key === 'Enter') { e.preventDefault(); openChat(); }
  });

  // ---------- Min gubbe ----------
  // The panel shows the draft on my own avatar in the room (main.js zooms the room camera in on it; avatarview.js).
  // faceYaw = the direction of the camera (set by main.js), dragged = what I spun it, phase = the slow sway.
  const av = { open: false, draft: null, faceYaw: null, dragged: 0, phase: 0, dragging: false };
  function chips(el, items, sel, pick) {
    el.innerHTML = '';
    for (const [id, spec] of Object.entries(items)) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.id = id; b.textContent = spec.name;
      if (id === sel) b.classList.add('sel'); b.onclick = () => pick(id); el.appendChild(b);
    }
  }
  function colors(el, list, sel, pick) {
    el.innerHTML = '';
    for (const hex of list) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.id = hex; b.style.background = hex; b.setAttribute('aria-label', hex);
      if (hex === sel) b.classList.add('sel'); b.onclick = () => pick(hex); el.appendChild(b);
    }
  }
  // The face's colour: 'Same as skin' (no face field: it follows the skin), the swatches, or any colour.
  function faceColors(el, d, set) {
    colors(el, AVATAR.colors.face, d.face || null, (c) => set({ face: c }));
    const same = document.createElement('button'); same.type = 'button'; same.className = 'face-same'; same.dataset.id = 'skin';
    same.textContent = S.faceSameAsSkin; same.title = S.faceSameAsSkinTitle; same.style.background = d.skin;
    if (!d.face) same.classList.add('sel');
    same.onclick = () => { const { face, ...rest } = av.draft; av.draft = normalizeLook(rest); renderAvatarPanel(); };
    const pick = document.createElement('input'); pick.type = 'color'; pick.id = 'av-face-any'; pick.title = S.faceCustomTitle; pick.setAttribute('aria-label', S.faceCustom);
    pick.value = d.face || d.skin;
    if (d.face && !AVATAR.colors.face.includes(d.face)) pick.classList.add('sel');
    pick.oninput = () => { av.draft = normalizeLook({ ...av.draft, face: pick.value }); self.avatar?.setLook(av.draft); };
    pick.onchange = () => set({ face: pick.value });
    el.prepend(same); el.appendChild(pick);
  }
  // Tyger: Colour | Fabric på varje färgplats (fabricui.js). rerender: false = bara förhandsvisningen (slidrar).
  const fab = initFabricUI({
    $, toast, getDraft: () => av.draft,
    setDraft(patch, { rerender = true } = {}) {
      av.draft = normalizeLook({ ...av.draft, ...patch });
      if (rerender) renderAvatarPanel(); else self.avatar?.setLook(av.draft);
    },
  });
  function renderAvatarPanel() {
    const d = av.draft, set = (patch) => { av.draft = normalizeLook({ ...av.draft, ...patch }); renderAvatarPanel(); };
    chips($('av-outfit'), AVATAR.outfits, d.outfit, (id) => set({ outfit: id }));
    chips($('av-hair'), AVATAR.hair, d.hair, (id) => set({ hair: id }));
    colors($('av-shirt'), AVATAR.colors.shirt, d.shirt, (c) => set({ shirt: c }));
    colors($('av-pants'), AVATAR.colors.pants, d.pants, (c) => set({ pants: c }));
    colors($('av-haircolor'), AVATAR.colors.hair, d.hairColor, (c) => set({ hairColor: c }));
    colors($('av-skin'), AVATAR.colors.skin, d.skin, (c) => set({ skin: c }));
    colors($('av-hatcolor'), AVATAR.colors.hat, d.hatColor, (c) => set({ hatColor: c }));
    faceColors($('av-face'), d, set);
    $('av-hat').checked = d.hat; $('av-hat-row').hidden = !d.hat;
    fab.render();
    self.avatar?.setLook(d); // live on my avatar in the room
    lockForRoomCharacter();
  }
  // In a preset room (free): My avatar shows the room's character, the look can't be edited (only the
  // name), with one calm line saying why. No upsell, no full-version panel.
  function lockForRoomCharacter() {
    const on = !!roomLook, panel = $('avatar-panel');
    panel.classList.toggle('room-character', on);
    let note = $('av-room-note');
    if (!note) { note = document.createElement('p'); note.id = 'av-room-note'; note.className = 'hint'; panel.querySelector('h2').after(note); }
    note.textContent = on ? S.avRoomCharacter : ''; note.hidden = !on;
    for (const el of panel.querySelectorAll('button, input')) {
      if (['av-name', 'av-ok', 'av-cancel'].includes(el.id)) continue;
      el.disabled = on;
    }
  }
  $('av-hat').onchange = (e) => { av.draft = normalizeLook({ ...av.draft, hat: e.target.checked }); renderAvatarPanel(); };
  function openAvatarPanel() {
    av.open = true; av.draft = normalizeLook(shownLook()); fab.reset(av.draft);
    $('av-name').value = me.name || cleanName(artist());
    $('avatar-panel').hidden = false;
    if (isTouch) { $('panel').classList.add('hidden'); $('panel-toggle').setAttribute('aria-expanded', 'false'); }
    controls.unlock?.();
    av.faceYaw = null; av.dragged = 0; av.phase = 0; av.dragging = false;
    document.body.classList.add('avatar-view'); // everything but the room and the panel steps aside (style.css)
    buildSelf().catch(() => toast(S.avatarLoadFailed));
    renderAvatarPanel(); onBusyChange();
  }
  function closeAvatarPanel() {
    av.open = false; av.dragging = false; document.body.classList.remove('avatar-view');
    self.avatar?.setLook(shownLook()); /* släpp tyger man bara provade */
    if (self.avatar) self.avatar.root.visible = self.want;
    $('avatar-panel').hidden = true; onBusyChange();
  }
  $('my-avatar').onclick = () => openAvatarPanel();
  $('av-cancel').onclick = () => closeAvatarPanel();
  // 🎲 Random = färger och kläder som förut (inga tyger). 🌀 Randomize = galna tyger på det mesta.
  $('av-random').onclick = () => { av.draft = randomLook(); fab.reset(av.draft); renderAvatarPanel(); };
  $('av-wild').onclick = async () => {
    if (fab.busy()) return;
    const look = await fab.wild(randomLook());
    if (!av.open) return;
    av.draft = normalizeLook(look); renderAvatarPanel();
  };
  $('av-ok').onclick = () => {
    if (!roomLook) me.look = normalizeLook(av.draft); // the room's character is not mine to keep
    me.name = cleanName($('av-name').value);
    if (me.look.fabric) addRecent(Object.values(me.look.fabric).map((f) => f.id));
    self.avatar?.setLook(shownLook());
    saveMyAvatar(me.name, me.look);
    net.sendLook(myName(), shownLook());
    closeAvatarPanel(); renderPeople();
    toast(S.avatarSaved, 2200);
  };

  // Inget eget namn i Min gubbe? Då används artistnamnet, och ändras det får de andra veta direkt.
  let artistTimer;
  $('artist').addEventListener('input', () => {
    if (me.name) return;
    clearTimeout(artistTimer); artistTimer = setTimeout(() => net.sendLook(myName(), shownLook()), 700);
  });
  // Enter i namnfältet = Spara
  $('av-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('av-ok').click(); } });

  // ---------- Min egen gubbe (bara i tredjepersonsvy, se main.js) ----------
  // Ingen namnskylt: det är ju jag. Byggs först när den behövs.
  const self = { avatar: null, want: false, last: null, speed: 0 };
  let building = null;
  function buildSelf() {
    if (self.avatar) return Promise.resolve(self.avatar);
    building = building || loadAvatarModel().then((m) => {
      if (!self.avatar) {
        self.avatar = new Avatar(m, av.open ? av.draft : shownLook(), ''); self.avatar.root.name = 'min-gubbe';
        self.avatar.root.visible = self.want || av.open;
        scene.add(self.avatar.root);
      }
      return self.avatar;
    }).finally(() => { building = null; });
    return building;
  }
  function showSelf(on) {
    self.want = !!on;
    if (self.want && !self.avatar) buildSelf().catch(() => {});
    if (self.avatar) self.avatar.root.visible = self.want || av.open;
  }
  // Varje bildruta: gubben står där jag står (under ögonen) och tittar åt samma håll.
  function updateSelf(dt, { hide = false } = {}) {
    const a = self.avatar; if (!a) return;
    const p = new THREE.Vector3(camera.position.x, 0, camera.position.z);
    const v = self.last && dt > 0 ? self.last.distanceTo(p) / dt : 0; self.last = p;
    self.speed += (v - self.speed) * Math.min(1, dt * 10);
    a.root.position.copy(p);
    if (av.open) { // 'My avatar' open: it stands still facing the camera, sways slowly, drag spins it
      if (!av.dragging) av.phase += dt * SHOW.swaySpeed;
      a.root.rotation.y = showTurn(av.faceYaw ?? controls.yaw, av.dragged, av.phase);
      a.root.visible = true; a.update(dt, 0); fab.tick();
      return;
    }
    a.root.rotation.y = controls.yaw + Math.PI;
    a.root.visible = self.want && !hide;
    if (self.want) a.update(dt, self.speed);
  }

  renderPeople(); renderChatInput();
  return {
    net, players,
    // A player's sound look (seed + custom patches) by connection id; mine for my own id.
    // colour = the player's slot in the room (shared/synth.mjs SLOT_COLOURS): up to 5 people sound distinct.
    voiceOf(id) { if (!id || id === net.id) return shownSound(); const pl = players.map.get(id); return pl ? { ...(pl.look?.sound || {}), colour: pl.slot || 0 } : null; },
    mySlot: () => mySlot,
    // Voice: who is talking right now (the mark above the avatar and in People here). id 'me' = me.
    setSpeaking(id, on, level = 0) {
      const was = talking.has(id);
      if (on) talking.add(id); else talking.delete(id);
      if (id !== 'me') players.speaking(id, on, level); else if (self.avatar) { if (on) self.avatar.talkLevel(level); else self.avatar.setMouth(0); }
      if (was !== !!on) renderPeople();
    },
    talking: () => [...talking],
    // Sound settings saved: tell everyone (they play my patches; no other network cost).
    soundChanged() { onSound(shownSound()); if (net.status === 'online') net.sendLook(myName(), shownLook()); },
    shownSound,
    // A key was added/forgotten in this tab ("I have a key"): tell the server before the next look.
    sendUnlock(unlock) { if (net.status === 'online') net.sendUnlock(unlock); },
    // The full-version flags arrived (entitlements.js): show/send my fabrics, redraw the panel.
    entitlementsChanged() {
      self.avatar?.setLook(shownLook()); onSound(shownSound());
      const l = shownLook();
      if ((l.fabric || l.sound.patches || l.sound.fx) && net.status === 'online') net.sendLook(myName(), l);
      if (av.open) { fab.reset(av.draft); renderAvatarPanel(); }
    },
    update(dt, eye = camera.position, { hideSelf = false } = {}) { sendMove(dt); players.update(dt, eye); updateSelf(dt, { hide: hideSelf }); },
    showSelf,
    // Min gubbe slappar/peelar (syns bara i tredjepersonsvy). De andra får veta via servern (by = net.id).
    // The drag pose (sticker arrays) on my own avatar: point = where the row ends, null = let go.
    selfHold: (point, normal) => { const a = self.avatar; if (!a) return false; if (point) return a.hold(point, normal); a.release(); return true; },
    selfGesture: (kind, point, normal) => !!(self.want && self.avatar && (kind === 'peel' ? self.avatar.peel(point, normal) : self.avatar.slap(point, normal))),
    freezeGestures(ms) { if (self.avatar) self.avatar.gesture.freeze = ms; for (const p of players.map.values()) if (p.avatar) p.avatar.gesture.freeze = ms; },
    handPos: () => { const a = self.avatar; if (!a) return null; const w = a.gesture.arms.map((x) => x.wrist.getWorldPosition(new THREE.Vector3()).toArray()); return w; },
    selfInfo: () => ({ built: !!self.avatar, visible: !!self.avatar?.root.visible, gestures: self.avatar?.gestures || 0, fabrics: self.avatar ? self.avatar.fabricInfo() : {},
      face: self.avatar ? self.avatar.faceInfo() : null, look: self.avatar ? { ...self.avatar.look } : null, gesturing: !!self.avatar?.gesture.active(), holding: !!self.avatar?.gesture.holding(), pos: self.avatar?.root.position.toArray() || null }),
    busy: () => av.open,
    // The room's character (null = my own avatar): shown on me, sent to the room, the panel locked.
    setRoomLook(look) {
      const next = look ? normalizeLook(look) : null;
      if (JSON.stringify(next) === JSON.stringify(roomLook)) return;
      roomLook = next;
      self.avatar?.setLook(shownLook());
      if (net.status === 'online') net.sendLook(myName(), shownLook());
      if (av.open) { av.draft = normalizeLook(shownLook()); fab.reset(av.draft); renderAvatarPanel(); }
    },
    roomLook: () => (roomLook ? { ...roomLook } : null),
    // 'My avatar' open: main.js tells which way its camera looks from (faceYaw), and passes on drags (px).
    avatarView: () => (av.open ? { faceYaw: av.faceYaw, dragged: av.dragged, phase: av.phase, turn: self.avatar ? self.avatar.root.rotation.y : null,
      built: !!self.avatar, visible: !!self.avatar?.root.visible, pos: self.avatar?.root.position.toArray() || null,
      look: self.avatar ? { ...self.avatar.look } : null, draft: { ...av.draft } } : null),
    setAvatarFace(a) { av.faceYaw = a; },
    spinAvatar(dxPx) { if (av.open) av.dragged += dxPx * SHOW.dragK; },
    avatarDrag(on) { av.dragging = !!on && av.open; },
    fabricStats, previewFabrics: () => (self.avatar ? self.avatar.fabricInfo() : {}),
    chatOpen, openChat, closeChat, openAvatarPanel, closeAvatarPanel,
    sys,
    me: () => ({ name: myName(), shownAs: serverName, look: { ...me.look } }),
  };
}
