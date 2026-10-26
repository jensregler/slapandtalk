// Voice chat: the sound goes straight between the browsers (WebRTC). The server only passes the
// "signal" messages (offer / answer / ICE candidates) to another player in the same room
// (server/realtime.js). A room has at most 5 players in the demo (10 otherwise), so every browser
// simply connects to every other one (a mesh): no media server.
//
//   - The microphone is OFF until you press 🎙 (or B). The first press asks for permission.
//     After that 🎙 mutes and unmutes (the connection stays, nothing is sent while muted).
//   - You hear the others even with your own mic off.
//   - Voices fade a little with distance (optional, ⚙ More → Sound), never below 30 %.
//   - A small mark shows above whoever is talking (and ·)) in People here).
//   - Public STUN only (stun.l.google.com). Without a TURN server some networks (strict company
//     or carrier NATs) cannot connect: then voice silently does not work for that pair.
// Perfect negotiation (https://w3c.github.io/webrtc-pc/#perfect-negotiation-example): either side
// may (re)offer at any time; on a clash the "polite" side (the larger id) gives way.
export const VOICE = { ice: [{ urls: 'stun:stun.l.google.com:19302' }], near: 1.8, floor: 0.3, talkOn: 0.012, talkOff: 0.006, holdMs: 350, statsMs: 200 };

function rms(analyser, buf) { analyser.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) s += x * x; return Math.sqrt(s / buf.length); }

export class Voice {
  // net: { id, sendSignal(to, data) } · sound: Sounds (for the AudioContext) · positionOf(id) → {x, z} | null
  // listener() → {x, z} · onSpeaking(id, on, level) (id 'me' = me) · onState(state) · toast(msg)
  constructor({ net, sound = null, positionOf = () => null, listener = () => null, onSpeaking = () => {}, onState = () => {}, toast = () => {}, ice = VOICE.ice }) {
    Object.assign(this, { net, sound, positionOf, listener, onSpeaking, onState, toast, ice });
    this.peers = new Map(); // id -> peer
    this.state = 'off';     // 'off' | 'on' | 'muted'
    this.stream = null; this.track = null; this.near = true;
    this.me = { talking: false, quietAt: 0, level: 0, analyser: null, buf: null };
    this.lastStats = 0; this.log = []; this.people = [];
  }
  get supported() { return !!(typeof RTCPeerConnection === 'function' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
  // 🎙: off → on (asks for the microphone the first time) → muted → on …
  async toggle() {
    if (this.state === 'off') return this.start();
    this.setMuted(this.state === 'on');
    return this.state;
  }
  async start() {
    if (!this.supported) { this.toast('unsupported'); return this.state; }
    if (this.starting) return this.starting;
    this.starting = (async () => {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      } catch (e) { this.toast('denied'); return this.state; }
      this.track = this.stream.getAudioTracks()[0];
      this.state = 'on'; this.onState(this.state); this.toast('on');
      for (const p of this.peers.values()) this.addTrack(p);
      for (const id of this.people) this.peer(id); // everyone already here: I call them
      this.watchMe();
      return this.state;
    })().finally(() => { this.starting = null; });
    return this.starting;
  }
  setMuted(m) {
    if (!this.track) return;
    this.track.enabled = !m; this.state = m ? 'muted' : 'on';
    if (m && this.me.talking) { this.me.talking = false; this.onSpeaking('me', false, 0); }
    this.onState(this.state); this.toast(m ? 'muted' : 'on');
  }
  // The players in the room now (ids, without me). New ones get a connection if I am sending;
  // otherwise they connect to me when THEY start talking. Gone ones are closed.
  setPeople(ids) {
    this.people = [...ids];
    const want = new Set(ids);
    for (const id of [...this.peers.keys()]) if (!want.has(id)) this.drop(id);
    if (this.track) for (const id of ids) this.peer(id);
  }
  peer(id) {
    let p = this.peers.get(id);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    p = { id, pc, polite: String(this.net.id || '') > String(id), makingOffer: false, ignoreOffer: false, sender: null, audio: null, gain: null, src: null, level: 0, talking: false, quietAt: 0, stream: null };
    this.peers.set(id, p);
    pc.onicecandidate = (e) => { if (e.candidate) this.send(id, { c: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
    pc.onnegotiationneeded = async () => {
      try {
        p.makingOffer = true;
        await pc.setLocalDescription();
        this.send(id, { d: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      } catch (e) { this.log.push(`offer ${id}: ${e.message}`); } finally { p.makingOffer = false; }
    };
    pc.ontrack = (e) => this.hear(p, e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]));
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' && pc.restartIce) pc.restartIce(); };
    if (this.track) this.addTrack(p);
    return p;
  }
  addTrack(p) { if (!p.sender && this.track) p.sender = p.pc.addTrack(this.track, this.stream); }
  send(to, data) { this.net.sendSignal(to, data); }
  async onSignal(from, data) {
    if (!data || typeof data !== 'object' || typeof from !== 'string') return;
    const p = this.peer(from), pc = p.pc;
    try {
      if (data.d && typeof data.d.type === 'string') {
        const offer = data.d.type === 'offer';
        const clash = offer && (p.makingOffer || pc.signalingState !== 'stable');
        p.ignoreOffer = !p.polite && clash;
        if (p.ignoreOffer) return;
        await pc.setRemoteDescription(data.d);
        if (offer) { await pc.setLocalDescription(); this.send(from, { d: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }); }
      } else if (data.c) {
        try { await pc.addIceCandidate(data.c); } catch (e) { if (!p.ignoreOffer) throw e; }
      }
    } catch (e) { this.log.push(`signal ${from}: ${e.message}`); }
  }
  // Their voice: through Web Audio (a gain for the distance) when the audio is running, else the
  // <audio> element's own volume. Chrome only lets a WebRTC stream into Web Audio while it is also
  // attached to a media element, so the element is always there (muted when Web Audio plays it).
  hear(p, stream) {
    if (p.stream === stream) return;
    p.stream = stream;
    if (!p.audio) { p.audio = document.createElement('audio'); p.audio.autoplay = true; p.audio.playsInline = true; p.audio.dataset.voice = p.id; p.audio.style.display = 'none'; document.body.appendChild(p.audio); }
    p.audio.srcObject = stream;
    const ctx = this.sound && this.sound.ensure ? this.sound.ensure() : null;
    if (ctx && ctx.state === 'running' && ctx.createMediaStreamSource) {
      try {
        p.src = ctx.createMediaStreamSource(stream); p.gain = ctx.createGain();
        p.src.connect(p.gain).connect(ctx.destination);
        // Chrome reports inbound audioLevel only for audio an element plays, so with Web Audio the
        // speaking level comes from an analyser on their stream instead.
        p.analyser = ctx.createAnalyser(); p.analyser.fftSize = 512; p.buf = new Float32Array(p.analyser.fftSize); p.src.connect(p.analyser);
        p.audio.muted = true;
      } catch { p.gain = null; p.audio.muted = false; }
    } else p.audio.muted = false;
    const pl = p.audio.play && p.audio.play(); if (pl && pl.catch) pl.catch(() => {});
  }
  drop(id) {
    const p = this.peers.get(id); if (!p) return;
    try { p.pc.close(); } catch { /* */ }
    try { p.src && p.src.disconnect(); p.gain && p.gain.disconnect(); p.analyser && p.analyser.disconnect(); } catch { /* */ }
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    if (p.talking) this.onSpeaking(id, false, 0);
    this.peers.delete(id);
  }
  closeAll() {
    for (const id of [...this.peers.keys()]) this.drop(id);
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null; this.track = null; this.state = 'off'; this.onState(this.state);
  }
  // My own level (for the 🎙 glow), from an analyser on my microphone.
  watchMe() {
    const ctx = this.sound && this.sound.ensure ? this.sound.ensure() : null;
    if (!ctx || !ctx.createMediaStreamSource || !this.stream) return;
    try { const a = ctx.createAnalyser(); a.fftSize = 512; ctx.createMediaStreamSource(this.stream).connect(a); this.me.analyser = a; this.me.buf = new Float32Array(a.fftSize); } catch { /* no glow */ }
  }
  talk(who, id, level, now) {
    who.level = level;
    if (level > VOICE.talkOn) { who.quietAt = now + VOICE.holdMs; if (!who.talking) { who.talking = true; this.onSpeaking(id, true, level); } else this.onSpeaking(id, true, level); }
    else if (who.talking && level < VOICE.talkOff && now > who.quietAt) { who.talking = false; this.onSpeaking(id, false, 0); }
  }
  // Every frame: distance → volume; a few times a second: who is talking (inbound audioLevel).
  update(now = performance.now()) {
    const L = this.listener();
    for (const p of this.peers.values()) {
      if (!p.stream) continue;
      let v = 1;
      const at = this.near && L ? this.positionOf(p.id) : null;
      if (at) { const d = Math.hypot(at.x - L.x, at.z - L.z); v = Math.max(VOICE.floor, Math.min(1, VOICE.near / (VOICE.near + Math.max(0, d - VOICE.near)))); }
      p.volume = v;
      if (p.gain) p.gain.gain.value = v; else if (p.audio && Math.abs(p.audio.volume - v) > 0.01) p.audio.volume = v;
    }
    if (this.me.analyser && this.state === 'on') {
      this.talk(this.me, 'me', rms(this.me.analyser, this.me.buf), now);
    }
    if (now - this.lastStats < VOICE.statsMs) return;
    this.lastStats = now;
    for (const p of this.peers.values()) {
      if (p.analyser) { this.talk(p, p.id, rms(p.analyser, p.buf), now); continue; }
      if (!p.stream || p.statsBusy) continue;
      p.statsBusy = true;
      p.pc.getStats().then((st) => {
        let lvl = 0;
        st.forEach((r) => { if (r.type === 'inbound-rtp' && (r.kind === 'audio' || r.mediaType === 'audio') && typeof r.audioLevel === 'number') lvl = Math.max(lvl, r.audioLevel); });
        this.talk(p, p.id, lvl, performance.now());
      }).catch(() => {}).finally(() => { p.statsBusy = false; });
    }
  }
  info() {
    return { state: this.state, peers: [...this.peers.values()].map((p) => ({ id: p.id, conn: p.pc.connectionState, ice: p.pc.iceConnectionState, sending: !!p.sender, hearing: !!p.stream,
      webAudio: !!p.gain, volume: p.volume ?? null, level: +(+p.level || 0).toFixed(4), talking: p.talking })), me: { talking: this.me.talking, level: +(+this.me.level || 0).toFixed(4) }, log: this.log.slice(-10) };
  }
}
