// Unit tests for client/src/voice.js without a browser: fake RTCPeerConnection / getUserMedia.
// (The real two-browser test is in tests/e2e-demo.js.)
import assert from 'node:assert/strict';

let pcs = [];
class FakePC {
  constructor(cfg) { this.cfg = cfg; this.senders = []; this.closed = false; this.connectionState = 'new'; this.iceConnectionState = 'new'; this.signalingState = 'stable'; pcs.push(this); }
  addTrack(track, stream) { const s = { track, stream }; this.senders.push(s); queueMicrotask(() => this.onnegotiationneeded && this.onnegotiationneeded()); return s; }
  async setLocalDescription() { this.localDescription = { type: this.remote && this.remote.type === 'offer' ? 'answer' : 'offer', sdp: 'x' }; this.signalingState = this.localDescription.type === 'offer' ? 'have-local-offer' : 'stable'; }
  async setRemoteDescription(d) { this.remote = d; this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable'; }
  async addIceCandidate() {}
  async getStats() { return new Map([['a', { type: 'inbound-rtp', kind: 'audio', audioLevel: this.level || 0 }]]); }
  close() { this.closed = true; }
}
globalThis.RTCPeerConnection = FakePC;
let asked = 0;
const track = { enabled: true, stop() { this.stopped = true; } };
Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { getUserMedia: async () => { asked++; return { getAudioTracks: () => [track], getTracks: () => [track] }; } } }, configurable: true });

const { Voice, VOICE } = await import('../client/src/voice.js');
let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };
const sent = [];
const speak = [];
const pos = { a: { x: 0, z: 0 }, b: { x: 10, z: 0 } };
const v = new Voice({ net: { id: 'm', sendSignal: (to, d) => sent.push({ to, d }) }, positionOf: (id) => pos[id], listener: () => ({ x: 0, z: 0 }), onSpeaking: (id, on) => speak.push([id, on]) });

await ok('STUN is the public Google server, and only that', () => assert.deepEqual(VOICE.ice, [{ urls: 'stun:stun.l.google.com:19302' }]));
await ok('off by default: no mic asked for, no connections', () => { v.setPeople(['a', 'b']); assert.equal(v.state, 'off'); assert.equal(asked, 0); assert.equal(v.peers.size, 0); });
await v.toggle(); await new Promise((r) => setTimeout(r, 5));
await ok('first toggle asks for the mic once and calls everyone already here (mesh)', () => { assert.equal(asked, 1); assert.equal(v.state, 'on'); assert.deepEqual([...v.peers.keys()].sort(), ['a', 'b']); assert.ok(sent.some((s) => s.to === 'a' && s.d.d && s.d.d.type === 'offer')); });
await v.toggle();
await ok('second toggle mutes (track disabled, connection kept), third unmutes; no new permission prompt', () => { assert.equal(v.state, 'muted'); assert.equal(track.enabled, false); assert.equal(v.peers.size, 2); });
await v.toggle();
await ok('…unmuted', () => { assert.equal(v.state, 'on'); assert.equal(track.enabled, true); assert.equal(asked, 1); });
await ok('someone leaving closes their connection', () => { const pc = v.peers.get('b').pc; v.setPeople(['a']); assert.equal(pc.closed, true); assert.equal(v.peers.has('b'), false); });
await ok('perfect negotiation: the impolite side ignores a clashing offer', async () => {
  const p = v.peer('a'); p.polite = false; p.makingOffer = true;
  await v.onSignal('a', { d: { type: 'offer', sdp: 'y' } });
  assert.equal(p.ignoreOffer, true);
});
await ok('proximity: near = full, far = quieter but never below the floor, off = full', () => {
  v.setPeople(['a', 'b']);
  for (const id of ['a', 'b']) { const p = v.peers.get(id); p.stream = {}; p.audio = { volume: 1, remove() {} }; }
  v.near = true; v.update(1e9);
  assert.equal(v.peers.get('a').volume, 1);
  const far = v.peers.get('b').volume; assert.ok(far < 1 && far >= VOICE.floor, String(far));
  pos.b = { x: 1000, z: 0 }; v.update(1e9 + 1); assert.equal(v.peers.get('b').volume, VOICE.floor);
  v.near = false; v.update(1e9 + 2); assert.equal(v.peers.get('b').volume, 1);
});
await ok('speaking: on above talkOn, held for holdMs, off below talkOff', () => {
  const p = v.peers.get('a'); speak.length = 0;
  v.talk(p, 'a', 0.05, 1000); assert.deepEqual(speak[0], ['a', true]);
  v.talk(p, 'a', 0.001, 1100); assert.equal(p.talking, true, 'held');
  v.talk(p, 'a', 0.001, 1000 + VOICE.holdMs + 1); assert.equal(p.talking, false); assert.deepEqual(speak.at(-1), ['a', false]);
});
await ok('closeAll stops the mic and all connections', () => { v.closeAll(); assert.equal(track.stopped, true); assert.equal(v.peers.size, 0); assert.equal(v.state, 'off'); });
console.log(`voice: ${n} passed`);
