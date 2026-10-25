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

const SEND_HZ = 12;
const CHAT_FADE_MS = 15_000;

export function initTogether({ room, scene, camera, controls, isTouch, toast, artist, onEvent, onReconnect, onWelcome = () => {}, onBusyChange = () => {}, onSound = () => {} }) {
  const $ = (id) => document.getElementById(id);
  const me = loadMyAvatar();
  if (!me.saved) saveMyAvatar(me.name, me.look); // en slumpad gubbe ska se likadan ut nästa gång
  const myName = () => me.name || cleanName(artist()) || '';
  // What others see (and I see on my own avatar): fabrics only with the full version
  // (the server drops them otherwise). Other players' fabrics are always shown.
  // Sound: my seed (= my own variation of the default sounds) always; custom patches/FX only
  // with soundDesign (the server drops them otherwise).
  const shownSound = () => { const s = loadSoundLook(); if (!has('soundDesign')) { delete s.patches; delete s.fx; } return s; };
  const shownLook = () => { const l = { ...me.look, sound: shownSound() }; if (!has('fabrics')) delete l.fabric; return l; };
  const players = new Players(scene);
  let status = 'connecting', full = false, unread = 0, serverName = ''; // serverName = det namn de andra ser på mig

  // ---------- Anslutningen ----------
  const net = connect(room, {
    hello: () => ({ name: myName(), look: shownLook(), unlock: credentials(), p: camera.position.toArray(), y: controls.yaw, pi: controls.pitch }),
    onYou(name) { serverName = name; renderPeople(); },
    onWelcome(m) {
      serverName = m.you?.name || '';
      players.remove('*');
      for (const p of m.players) players.upsert(p);
      full = !!m.full; $('full-banner').hidden = !full;
      setChatHistory(m.chat || []);
      last = null; renderPeople(); renderChatInput();
      onWelcome(m);
    },
    onJoin(p, rejoin) { players.upsert(p); if (!rejoin) sys(S.joined(p.name)); renderPeople(); },
    onLeave(id, rejoin) {
      if (id !== '*' && !rejoin) { const pl = players.map.get(id); if (pl) sys(S.left(pl.name)); } // med det namn personen har nu
      players.remove(id); renderPeople();
    },
    onMove: (id, p, y) => players.move(id, p, y),
    onLook(id, name, look) {
      const pl = players.map.get(id);
      if (pl && pl.name !== name) sys(S.renamed(pl.name, name));
      players.look(id, name, look); renderPeople();
    },
    onChat(msg) { addChat(msg); if (msg.from !== net.id) players.say(msg.from, msg.text); },
    onEvent,
    onStatus(s) { status = s; renderPeople(); renderChatInput(); },
    onReconnect,
    onError: (e) => toast(e, 2500),
  });

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
      : status === 'full' ? S.presenceFull(players.map.size) : status === 'connecting' ? S.presenceConnecting : S.presenceOffline;
    const ul = $('people'); ul.innerHTML = '';
    const add = (name, color, mine) => {
      const li = document.createElement('li'); const i = document.createElement('i'); i.style.background = color;
      li.append(i, document.createTextNode(mine ? S.youSuffix(name || S.you) : name)); ul.appendChild(li);
    };
    if (status === 'online') add(serverName || myName(), me.look.shirt, true);
    for (const p of players.map.values()) add(p.name, p.look?.shirt || '#888', false);
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
  const av = { open: false, draft: null, renderer: null, scene: null, cam: null, avatar: null, raf: 0, spin: 0.35, drag: null };
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
  // Tyger: Colour | Fabric på varje färgplats (fabricui.js). rerender: false = bara förhandsvisningen (slidrar).
  const fab = initFabricUI({
    $, toast, getDraft: () => av.draft,
    setDraft(patch, { rerender = true } = {}) {
      av.draft = normalizeLook({ ...av.draft, ...patch });
      if (rerender) renderAvatarPanel(); else av.avatar?.setLook(av.draft);
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
    $('av-hat').checked = d.hat; $('av-hat-row').hidden = !d.hat;
    fab.render();
    av.avatar?.setLook(d);
  }
  $('av-hat').onchange = (e) => { av.draft = normalizeLook({ ...av.draft, hat: e.target.checked }); renderAvatarPanel(); };
  async function startPreview() {
    const c = $('avatar-preview');
    if (!av.renderer) {
      av.renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true });
      av.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); av.renderer.outputColorSpace = THREE.SRGBColorSpace;
      av.scene = new THREE.Scene();
      av.scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 2.2));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(1.5, 3, 2.5); av.scene.add(sun);
      av.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
      c.addEventListener('pointerdown', (e) => { av.drag = e.clientX; c.setPointerCapture(e.pointerId); });
      c.addEventListener('pointermove', (e) => { if (av.drag !== null) { av.spin += (e.clientX - av.drag) * 0.012; av.drag = e.clientX; } });
      c.addEventListener('pointerup', () => { av.drag = null; });
    }
    try {
      const model = await loadAvatarModel();
      if (!av.avatar) { av.avatar = new Avatar(model, av.draft, ''); av.scene.add(av.avatar.root); }
      av.avatar.setLook(av.draft);
    } catch { toast(S.avatarLoadFailed); }
    const clock = new THREE.Clock();
    const loop = () => {
      if (!av.open) return;
      const dt = Math.min(clock.getDelta(), 0.1);
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== Math.round(w * av.renderer.getPixelRatio())) { av.renderer.setSize(w, h, false); av.cam.aspect = w / h; av.cam.updateProjectionMatrix(); }
      av.cam.position.set(0, 1.0, 3.7); av.cam.lookAt(0, 0.86, 0);
      if (av.drag === null) av.spin += dt * 0.35;
      if (av.avatar) { av.avatar.root.rotation.y = av.spin; av.avatar.update(dt, 0); }
      fab.tick();
      av.renderer.render(av.scene, av.cam);
      av.raf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(av.raf); loop();
  }
  function openAvatarPanel() {
    av.open = true; av.draft = normalizeLook(shownLook()); fab.reset(av.draft);
    $('av-name').value = me.name || cleanName(artist());
    $('avatar-panel').hidden = false;
    if (isTouch) { $('panel').classList.add('hidden'); $('panel-toggle').setAttribute('aria-expanded', 'false'); }
    controls.unlock?.();
    renderAvatarPanel(); startPreview(); onBusyChange();
  }
  function closeAvatarPanel() { av.open = false; cancelAnimationFrame(av.raf); av.avatar?.setLook(shownLook()); /* släpp tyger man bara provade */ $('avatar-panel').hidden = true; onBusyChange(); }
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
    me.look = normalizeLook(av.draft); me.name = cleanName($('av-name').value);
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
  function showSelf(on) {
    self.want = !!on;
    if (self.want && !self.avatar) {
      loadAvatarModel().then((m) => {
        if (self.avatar) return;
        self.avatar = new Avatar(m, shownLook(), ''); self.avatar.root.name = 'min-gubbe'; self.avatar.root.visible = self.want;
        scene.add(self.avatar.root);
      }).catch(() => {});
    }
    if (self.avatar) self.avatar.root.visible = self.want;
  }
  // Varje bildruta: gubben står där jag står (under ögonen) och tittar åt samma håll.
  function updateSelf(dt, { hide = false } = {}) {
    const a = self.avatar; if (!a) return;
    const p = new THREE.Vector3(camera.position.x, 0, camera.position.z);
    const v = self.last && dt > 0 ? self.last.distanceTo(p) / dt : 0; self.last = p;
    self.speed += (v - self.speed) * Math.min(1, dt * 10);
    a.root.position.copy(p); a.root.rotation.y = controls.yaw + Math.PI;
    a.root.visible = self.want && !hide;
    if (self.want) a.update(dt, self.speed);
  }

  renderPeople(); renderChatInput();
  return {
    net, players,
    // A player's sound look (seed + custom patches) by connection id; mine for my own id.
    voiceOf(id) { if (!id || id === net.id) return shownSound(); const pl = players.map.get(id); return pl ? pl.look?.sound || null : null; },
    // Sound settings saved: tell everyone (they play my patches; no other network cost).
    soundChanged() { onSound(shownSound()); if (net.status === 'online') net.sendLook(myName(), shownLook()); },
    shownSound,
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
    selfGesture: (kind, point, normal) => !!(self.want && self.avatar && (kind === 'peel' ? self.avatar.peel(point, normal) : self.avatar.slap(point, normal))),
    freezeGestures(ms) { if (self.avatar) self.avatar.gesture.freeze = ms; for (const p of players.map.values()) if (p.avatar) p.avatar.gesture.freeze = ms; },
    handPos: () => { const a = self.avatar; if (!a) return null; const w = a.gesture.arms.map((x) => x.wrist.getWorldPosition(new THREE.Vector3()).toArray()); return w; },
    selfInfo: () => ({ built: !!self.avatar, visible: !!self.avatar?.root.visible, gestures: self.avatar?.gestures || 0, fabrics: self.avatar ? self.avatar.fabricInfo() : {},
      gesturing: !!self.avatar?.gesture.active(), pos: self.avatar?.root.position.toArray() || null }),
    busy: () => av.open,
    fabricStats, previewFabrics: () => (av.avatar ? av.avatar.fabricInfo() : {}),
    chatOpen, openChat, closeChat, openAvatarPanel, closeAvatarPanel,
    sys,
    me: () => ({ name: myName(), shownAs: serverName, look: { ...me.look } }),
  };
}
