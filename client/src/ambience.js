// Nature mode ambience (Jens, 28 Oct 2026: "Nature mode should include the nature sound playing").
// NOTE: there was no earlier nature sound/ambience in the repo (searched the code, the assets and
// the whole git history on all branches for nature/ambience/birds/rain/wind/forest: none), so this
// is a NEW one, made the same way as every other sound here: procedural Web Audio, no file to
// download, nothing to license. A soft wind with gusts, a quiet rustle of leaves and now and then
// a little bird phrase from somewhere left or right. It loops (endlessly varied) while Nature mode
// is on and fades out when it ends.
// A real recording can replace it without code: put client/public/audio/nature-ambience.mp3 (or
// .ogg) in place and that file is looped instead.
const FILES = ['/audio/nature-ambience.mp3', '/audio/nature-ambience.ogg'];
const LEVEL = 0.5;

function noiseBuffer(ctx, seconds, pink) {
  const n = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c); let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (!pink) { d[i] = w * 0.5; continue; }
      b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
    }
    // a seamless loop: cross-fade the last 0.2 s into the start
    const f = Math.floor(ctx.sampleRate * 0.2);
    for (let i = 0; i < f; i++) { const t = i / f; d[i] = d[i] * t + d[n - f + i] * (1 - t); }
  }
  return buf;
}

export class NatureAmbience {
  constructor(getCtx) {
    this.getCtx = getCtx; this.playing = false; this.nodes = null; this.birds = 0; this.source = null;
    this.file = undefined; // undefined = not looked for yet, null = none, AudioBuffer = a recording
  }
  async findFile(ctx) {
    if (this.file !== undefined) return this.file;
    this.file = null;
    for (const url of FILES) {
      try {
        const r = await fetch(url, { cache: 'force-cache' });
        if (!r.ok || !/^audio\//.test(r.headers.get('content-type') || '')) continue;
        this.file = await ctx.decodeAudioData(await r.arrayBuffer()); break;
      } catch { /* none / undecodable: the procedural one */ }
    }
    return this.file;
  }
  start() {
    if (this.playing) return true;
    const ctx = this.getCtx(); if (!ctx) return false;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    this.playing = true;
    const out = ctx.createGain(); out.gain.value = 0;
    const meter = ctx.createAnalyser(); meter.fftSize = 2048; out.connect(meter); meter.connect(ctx.destination); // meter: info().rms (tests)
    out.gain.setTargetAtTime(LEVEL, ctx.currentTime, 0.6); // fade in
    const nodes = this.nodes = { out, meter, stop: [] };
    this.findFile(ctx).then((buf) => {
      if (this.nodes !== nodes) return; // stopped meanwhile
      if (buf) { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(out); s.start(); nodes.stop.push(s); this.source = 'file'; return; }
      this.source = 'procedural'; this.procedural(ctx, nodes);
    });
    return true;
  }
  procedural(ctx, nodes) {
    const { out } = nodes;
    // wind: pink noise through a low-pass whose cutoff and level drift slowly (gusts)
    const wind = ctx.createBufferSource(); wind.buffer = noiseBuffer(ctx, 6, true); wind.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.6;
    const wg = ctx.createGain(); wg.gain.value = 0.55;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 260;
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.11; const lfo2Amt = ctx.createGain(); lfo2Amt.gain.value = 0.22;
    lfo.connect(lfoAmt).connect(lp.frequency); lfo2.connect(lfo2Amt).connect(wg.gain);
    wind.connect(lp).connect(wg).connect(out);
    // leaves: white noise, band-passed high and quiet, with its own slow swell
    const leaves = ctx.createBufferSource(); leaves.buffer = noiseBuffer(ctx, 4, false); leaves.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 5200; bp.Q.value = 0.9;
    const lg = ctx.createGain(); lg.gain.value = 0.035;
    const lfo3 = ctx.createOscillator(); lfo3.frequency.value = 0.17; const lfo3Amt = ctx.createGain(); lfo3Amt.gain.value = 0.025;
    lfo3.connect(lfo3Amt).connect(lg.gain);
    leaves.connect(bp).connect(lg).connect(out);
    for (const s of [wind, leaves, lfo, lfo2, lfo3]) { s.start(); nodes.stop.push(s); }
    // birds: a short phrase now and then (2–7 s apart), panned left or right
    const phrase = () => {
      if (this.nodes !== nodes) return;
      const t0 = ctx.currentTime + 0.05, notes = 2 + Math.floor(Math.random() * 5), base = 2300 + Math.random() * 1800;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null; if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; pan.connect(out); }
      for (let i = 0; i < notes; i++) {
        const t = t0 + i * (0.09 + Math.random() * 0.08), len = 0.05 + Math.random() * 0.07;
        const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
        const f = base * (0.85 + Math.random() * 0.4);
        o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * (Math.random() < 0.5 ? 1.35 : 0.75), t + len);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07 + Math.random() * 0.05, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        o.connect(g).connect(pan || out); o.start(t); o.stop(t + len + 0.02);
      }
      this.birds++;
      nodes.timer = setTimeout(phrase, 2000 + Math.random() * 5000);
    };
    nodes.timer = setTimeout(phrase, 700);
  }
  stop() {
    if (!this.playing) return;
    this.playing = false;
    const nodes = this.nodes; this.nodes = null; if (!nodes) return;
    clearTimeout(nodes.timer);
    const ctx = this.getCtx(); const t = ctx ? ctx.currentTime : 0;
    nodes.out.gain.cancelScheduledValues(t); nodes.out.gain.setTargetAtTime(0, t, 0.25); // fade out
    setTimeout(() => { for (const s of nodes.stop) { try { s.stop(); } catch { /* already */ } } nodes.out.disconnect(); nodes.meter.disconnect(); }, 1500);
  }
  // rms = how loud it is right now (0 = silent), from the meter on the output.
  info() {
    let rms = 0; const m = this.nodes && this.nodes.meter;
    if (m) { const d = new Float32Array(m.fftSize); m.getFloatTimeDomainData(d); rms = Math.sqrt(d.reduce((a, x) => a + x * x, 0) / d.length); }
    return { playing: this.playing, source: this.playing ? this.source : null, birds: this.birds, rms: +rms.toFixed(4) };
  }
}
