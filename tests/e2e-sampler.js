// E2E (Jens, 5 Nov 2026): the sampler layer, LFOs ("Add LFO?" + nesting + audio rate), sequencer layers,
// the Master block (blend = morph, power, tempo up to "11", bird, wind, four voices), per-room per-player
// presets on the server, the auto-slap gone. Own server (8911). Screenshots → /workspace/sampler-layer-shots.
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { startServer, sleep } = require('./demo-helpers');
const PORT = Number(process.env.SAMPLER_E2E_PORT || 8911);
const SHOTS = process.env.SAMPLER_SHOTS || '/workspace/sampler-layer-shots';
fs.mkdirSync(SHOTS, { recursive: true });
let passed = 0, failed = 0;
const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 900) : '')); } };
// a 1.2 s test sample: a plucked C4 (261.63 Hz) with a few harmonics, 44.1 kHz 16-bit mono
function wav(file, { f = 261.63, secs = 1.2, rate = 44100 } = {}) {
  const n = Math.round(secs * rate), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const t = i / rate, e = Math.exp(-t * 3) * Math.min(1, t * 200); const v = e * (0.6 * Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t) + 0.1 * Math.sin(6 * Math.PI * f * t)); b.writeInt16LE(Math.round(v * 32000), 44 + i * 2); }
  fs.writeFileSync(file, b); return file;
}
(async () => {
  const S = await startServer(PORT, { DEMO_PROFILE: '0', OPEN_ACCESS: '1' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const errors = [];
  const SAMPLE = wav(path.join(os.tmpdir(), 'klibb-pluck-C4.wav'));
  try {
    const made = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) })).json();
    const R = made.room.id;
    const actx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
    await actx.addInitScript(() => { window.__gum = 0; const md = navigator.mediaDevices; if (md && md.getUserMedia) { const g = md.getUserMedia.bind(md); md.getUserMedia = (c) => { window.__gum++; return g(c); }; } });
    const A = await actx.newPage(); A.on('pageerror', (e) => errors.push('A: ' + e.message));
    const B = await (await browser.newContext({ viewport: { width: 900, height: 700 } })).newPage(); B.on('pageerror', (e) => errors.push('B: ' + e.message));
    await A.goto(`${S.base}/?room=${R}`); await B.goto(`${S.base}/?room=${R}`);
    for (const p of [A, B]) await p.waitForFunction(() => window.klibb && window.klibb.ready && window.klibb.players().length === 1, null, { timeout: 60000 });
    await A.mouse.click(700, 500); await sleep(400);
    await A.evaluate(() => window.klibb.radioReady());
    // ---------- auto-slap is gone ----------
    const gone = await A.evaluate(() => ({ box: !!document.getElementById('auto-box'), chip: !!document.getElementById('auto-chip'), api: window.klibb.autoSlap(), old: localStorage.getItem('klibb.autoslap') }));
    check('auto-slap removed: no editor, no chip, no trigger (old settings dropped)', !gone.box && !gone.chip && gone.api === null && gone.old === null, gone);
    // ---------- open Sound settings: Master block on top ----------
    await A.evaluate(() => window.klibb.soundUi().open()); await sleep(400);
    const r0 = await A.evaluate(() => ({ radio: !!document.querySelector('#snd-radio #radio-box'), vol: !!document.getElementById('master-vol'), city: !!document.getElementById('city-sound'),
      knobEl: !!document.getElementById('radio-knob'), bpmEl: !!document.getElementById('radio-bpm'),
      bpm: window.klibb.radio().state.bpm, cityV: window.klibb.radio().state.city, knob: window.klibb.radio().state.knob, on: window.klibb.radio().state.on,
      tempo: window.klibb.radio().tempo(), headerVol: document.getElementById('music-vol-row')?.hidden }));
    check('Sound settings Master: volume + city sound only (no blend/tempo/power UI); bpm 90, city 0, on+knob forced my-sound',
      r0.radio && r0.vol && r0.city && !r0.knobEl && !r0.bpmEl && r0.bpm === 90 && r0.cityV === 0 && r0.knob === 0.5 && r0.on === true && r0.headerVol === true, r0);
    check(`…this room's clock is slightly off 90 (deterministic): ${r0.tempo.bpm} BPM, phase ${r0.tempo.phaseMs} ms`, Math.abs(r0.tempo.bpm - 90) <= 0.3 && r0.tempo.phaseMs >= 0 && r0.tempo.phaseMs <= 12, r0.tempo);
    // ---------- sampler layer ----------
    await A.click('#snd-add-sampler'); await sleep(200);
    const sl = await A.evaluate(() => ({ n: document.querySelectorAll('#snd-body .snd-sampler').length, src: [...document.querySelectorAll('#snd-body select[data-name="Source"]')].map((s) => [...s.options].map((o) => o.value).join('/')) }));
    check('"+ Sampler layer" adds a new layer TYPE (the osc/noise Source choices are unchanged; + the live mic)', sl.n === 1 && sl.src.every((x) => x === 'osc/noise/mic'), sl);
    await A.setInputFiles('#snd-body .snd-sampler .smp-file', SAMPLE); await sleep(1500);
    const ld = await A.evaluate(() => { const st = window.klibb.soundUi().state(), l = st.patches.slap.layers.find((x) => x.kind === 'sampler'); return { l, info: document.querySelector('.smp-info').textContent }; });
    check('file picker: the sample is decoded, stored (sha-256) and shown with its length', /^[a-f0-9]{64}$/.test(ld.l.sample) && Math.abs(ld.l.len - 1.2) < 0.01 && /klibb-pluck-C4 · 1\.20 s/.test(ld.info), ld);
    // drag-and-drop: a second file onto the drop zone
    const dropped = await A.evaluate(async () => {
      const r = new Float32Array(22050); for (let i = 0; i < r.length; i++) r[i] = Math.sin(i / 10) * Math.exp(-i / 6000);
      const n = r.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 22050, true); v.setUint32(28, 44100, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, r[i] * 30000, true);
      const dt = new DataTransfer(); dt.items.add(new File([buf], 'drop-test.wav', { type: 'audio/wav' }));
      document.querySelector('.smp-drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      await new Promise((res) => setTimeout(res, 1500));
      return window.klibb.soundUi().state().patches.slap.layers.find((x) => x.kind === 'sampler').name;
    });
    check('drag-and-drop onto the drop zone loads a file too', dropped === 'drop-test', dropped);
    const bad = await A.evaluate(async () => { const dt = new DataTransfer(); dt.items.add(new File(['hello'], 'notes.txt', { type: 'text/plain' })); document.querySelector('.smp-drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); await new Promise((r) => setTimeout(r, 400)); return document.querySelector('.smp-info').textContent; });
    check('…a non-audio file is refused with a clear message', /not an audio file/i.test(bad), bad);
    await A.setInputFiles('#snd-body .snd-sampler .smp-file', SAMPLE); await sleep(1200);
    // note G4 (67) → ratio 2^(7/12); loop + crossfade + reverse
    await A.evaluate(() => { const l = window.klibb.soundUi().state().patches.slap.layers.find((x) => x.kind === 'sampler'); Object.assign(l, { note: 67, loop: true, xfade: 0.05, loopStart: 0.2, loopEnd: 0.8, hold: 0.6, pan: -0.4, decim: 6, crush: 8 }); window.klibb.soundUi().render(); });
    const played = await A.evaluate(async () => { const ok = await window.klibb.soundUi().preview(); const e = window.klibb.soundObj().engine; return { ok, polys: [...e.polys.values()].map((x) => x.length), stolen: e.stolen || 0 }; });
    check('▶ Preview plays the sampler layer pitched to its note (G4 = C4 × 1.498), looped, panned, decimated', played.ok && played.polys.some((n) => n >= 1), played);
    const polyRes = await A.evaluate(async () => { const st = window.klibb.soundUi().state(); st.patches.slap.layers.find((x) => x.kind === 'sampler').poly = 2; for (let i = 0; i < 4; i++) await window.klibb.soundUi().preview(); return window.klibb.soundObj().engine.stolen || 0; });
    check('polyphony limit 2: older voices of the sample are cut (voices stolen)', polyRes >= 2, polyRes);
    await A.evaluate(() => document.querySelector('#snd-body .snd-sampler').scrollIntoView());
    await sleep(300);
    await (await A.$('#sound-panel')).screenshot({ path: path.join(SHOTS, '01-sampler-layer-loaded.png') });
    // ---------- "Add LFO?" (advanced mods) ----------
    // Use Resonance (q): pitch/cutoff/level now open the floating layer "LFO?" ask instead (t600u).
    const res = '#snd-body .snd-layer[data-layer="0"] .snd-sl[data-param="q"] input';
    await A.$eval(res, (r) => { r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); r.value = '600'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
    await sleep(200);
    const pop = await A.evaluate(() => { const p = document.getElementById('lfo-pop'); return p && { text: p.textContent, to: p.dataset.to, font: getComputedStyle(p).fontSize }; });
    check('letting go of a changed control (Resonance) offers "Add LFO?" – large text', pop && /Add LFO or follower to Resonance\?/.test(pop.text) && pop.to === 'L0.q' && parseFloat(pop.font) >= 18, pop);
    await A.evaluate(() => document.getElementById('lfo-pop').scrollIntoView({ block: 'center' })); await sleep(150);
    await (await A.$('#sound-panel')).screenshot({ path: path.join(SHOTS, '02-add-lfo-popup.png') });
    await A.click('#lfo-pop-yes'); await sleep(200);
    const m1 = await A.evaluate(() => window.klibb.soundUi().state().patches.slap.mods);
    check('…accepting adds LFO 1 → Layer 1 Resonance (triangle, 1 Hz, depth 40 %)', m1 && m1.length === 1 && m1[0].to === 'L0.q' && m1[0].rate === 1 && m1[0].wave === 'triangle', m1);
    await A.$eval(res, (r) => { r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); r.value = '650'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
    check('…no popup again for a control that already has an LFO', !(await A.$('#lfo-pop')));
    const level = '#snd-body .snd-layer[data-layer="0"] .snd-sl[data-param="a"] input';
    await A.$eval(level, (r) => { r.value = '300'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
    check('…and none for a control that can\'t be modulated (Attack)', !(await A.$('#lfo-pop')));
    // nest: LFO on LFO 1's rate, then on that one's depth … up to depth 6
    for (let d = 1; d <= 6; d++) {
      const id = await A.evaluate(() => { const ms = window.klibb.soundUi().state().patches.slap.mods; return ms[ms.length - 1].id; });
      const sel = `#snd-mods .snd-mod[data-mod="${id}"] .snd-sl[data-param="rate"] input`;
      await A.$eval(sel, (r) => { r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); r.value = String(Number(r.value) + 30); r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
      await sleep(80);
      const yes = await A.evaluate(() => { const y = document.getElementById('lfo-pop-yes'); if (y) y.click(); return !!y; }); if (!yes) break; await sleep(120);
    }
    const nest = await A.evaluate(() => { const sh = window.klibb.synthShared(); const ms = window.klibb.soundUi().state().patches.slap.mods; return { n: ms.length, tos: ms.map((m) => m.to) }; });
    check('nested LFOs: each LFO\'s Rate can get its own LFO – stops at nesting depth 6', nest.n === 6 && nest.tos[5] === 'm5.rate', nest);
    await A.evaluate(() => { const ms = window.klibb.soundUi().state().patches.slap.mods; ms[0].rate = 880; window.klibb.soundUi().render(); });
    const wk = await A.evaluate(async () => { await window.klibb.soundUi().preview(); return window.klibb.soundObj().engine.modStats; });
    check('audio-rate LFO (880 Hz = A5 tone) + 6 nested LFOs run per sample in ONE worklet node', wk && wk.worklet === true && wk.lfos === 6 && wk.outputs >= 1, wk);
    await A.evaluate(() => document.getElementById('snd-mods').scrollIntoView());
    await (await A.$('#sound-panel')).screenshot({ path: path.join(SHOTS, '03-nested-lfos.png') });
    // ---------- sequencer layer ----------
    await A.click('#snd-tabs [data-tab="step"]'); await sleep(150);
    await A.click('#snd-add-seq'); await sleep(150);
    await A.evaluate(() => { const b = [...document.querySelectorAll('.snd-seq-quick button')].find((x) => x.textContent === '7'); b.click(); });
    await sleep(150);
    const sq = await A.evaluate(() => { const p = window.klibb.soundUi().state().patches.step; const l = p.layers[p.layers.length - 1]; return { seq: l.seq, cells: document.querySelectorAll('.snd-seq-grid .snd-step').length }; });
    check('"+ Sequencer layer": a layer that starts as a sequencer; step count 7 (1–16, quick picks 3 4 5 6 7 8 12 16)', sq.seq && sq.seq.len === 7 && sq.cells === 7, sq);
    await A.evaluate(() => [...document.querySelectorAll('.snd-seq-grid .snd-step')][2].click()); await sleep(100);
    await A.evaluate(() => document.querySelector('.snd-seq').scrollIntoView());
    await (await A.$('#sound-panel')).screenshot({ path: path.join(SHOTS, '04-sequencer-layer.png') });
    // ---------- mic layer, envelope follower, voice effect ----------
    const gum0 = await A.evaluate(() => window.__gum);
    await A.click('#snd-add-mic'); await sleep(1500);
    const mic = await A.evaluate(() => { const u = window.klibb.soundUi(), p = u.state().patches[u.state().tab], l = p.layers[p.layers.length - 1], e = window.klibb.soundObj().engine;
      return { tab: u.state().tab, kind: l.kind, level: l.level, hold: l.hold, live: !!e.micSource(), warn: document.querySelector('.mic-warn')?.textContent, state: document.querySelector('.mic-state')?.textContent, gum: window.__gum }; });
    check('"+ Mic layer": a layer TYPE whose sound is my live mic – the mic is asked for only now, gate mode, modest level, a headphones warning', gum0 === 0 && mic.kind === 'mic' && mic.level <= 0.35 && mic.live && /headphones/i.test(mic.warn) && /Mic is on/.test(mic.state), mic);
    const mp = await A.evaluate(async () => { const u = window.klibb.soundUi(); const ok = await u.preview(); return { ok, errs: window.klibb.soundObj().engine.modErrors || 0 }; });
    check('…▶ Preview: the note opens the gate on the live mic (through envelope, filter, the place bus)', mp.ok && !mp.errs, mp);
    await A.evaluate(() => document.querySelector('.mic-box').scrollIntoView({ block: 'center' })); await sleep(100);
    await (await A.$('#sound-panel')).screenshot({ path: path.join(SHOTS, '10-mic-layer.png') });
    // follower: + Follower, then "Follows: mic"
    await A.evaluate(() => document.getElementById('snd-add-follow').click()); await sleep(200);
    await A.evaluate(() => { const s = document.querySelector('.snd-follow select[data-name="Follows"]'); s.value = 'mic'; s.dispatchEvent(new Event('change')); }); await sleep(600);
    const fl = await A.evaluate(async () => { const u = window.klibb.soundUi(), p = u.state().patches[u.state().tab]; const m = p.mods.find((x) => x.wave === 'follow');
      for (let i = 0; i < 4; i++) { await u.preview(); await new Promise((r) => setTimeout(r, 250)); }
      const e = window.klibb.soundObj().engine; return { m, follow: e.follow, inputs: e.followInputs, meter: Number(document.querySelector(`.flw-meter[data-mod="${m.id}"]`)?.dataset.v || 0), stats: e.modStats }; });
    check('envelope follower on the mic: computed per sample in the mods worklet (no new nodes), it moves with the (fake) mic', fl.m && fl.m.src === 'mic' && fl.inputs && fl.inputs.includes('mic') && fl.stats.worklet && fl.follow && fl.follow[fl.m.id] > 0, { m: fl.m, follow: fl.follow, meter: fl.meter, inputs: fl.inputs });
    await A.evaluate(() => { const s = document.querySelector('.snd-follow select[data-name="Follows"]'); s.value = 'master'; s.dispatchEvent(new Event('change')); }); await sleep(300);
    const flm = await A.evaluate(async () => { const u = window.klibb.soundUi(), p = u.state().patches[u.state().tab]; const m = p.mods.find((x) => x.wave === 'follow'); u.preview(); let mx = 0, mt = 0;
      for (let i = 0; i < 12; i++) { await new Promise((r) => setTimeout(r, 40)); const e = window.klibb.soundObj().engine; mx = Math.max(mx, (e.follow || {})[m.id] || 0); mt = Math.max(mt, Number(document.querySelector(`.flw-meter[data-mod="${m.id}"]`)?.dataset.v || 0)); }
      return { mx, mt }; });
    check('…following all my sound: the envelope rises while it plays and the big meter shows it', flm.mx > 0.02 && flm.mt > 0.02, flm);
    await A.evaluate(() => document.querySelector('.snd-follow').scrollIntoView({ block: 'center' })); await sleep(100);
    await (await A.$('#sound-panel')).screenshot({ path: path.join(SHOTS, '11-follower.png') });
    // Decimate is modulatable but not a simple layer-LFO target, so the advanced pop still appears.
    const popF = await A.evaluate(() => { const r = document.querySelector('#snd-body .snd-layer[data-layer="0"] .snd-sl[data-param="decim"] input'); if (!r) return 'no decim'; r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); r.value = String(Number(r.value) + 40); r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); return !!document.getElementById('lfo-pop-follow'); });
    check('…the "Add LFO?" popup also offers "📈 Follower"', popF === true, popF);
    await A.evaluate(() => document.querySelector('#lfo-pop button:last-child')?.click());
    // ---------- save = this room's preset ----------
    console.log('    (patch JSON bytes before save:', await A.evaluate(() => JSON.stringify(window.klibb.soundUi().state().patches).length), ')');
    await A.click('#snd-save'); await sleep(1500);
    const srv = await A.evaluate(async (R) => { const r = await fetch(`/api/rooms/${R}/sound`, { headers: { 'X-Sound-Owner': localStorage.getItem('klibb.soundOwner') } }); return (await r.json()).preset; }, R);
    check('Save stores the preset for THIS room on the server (patches incl. sampler + LFOs + sequencer, master/radio)', srv && srv.patches && srv.patches.slap.layers.some((l) => l.kind === 'sampler') && srv.patches.slap.mods.length === 6 && srv.patches.step.layers.some((l) => l.seq && l.seq.len === 7) && srv.radio.on === true, srv && { keys: Object.keys(srv), pk: srv.patches && Object.keys(srv.patches), size: JSON.stringify(srv).length });
    const other = await B.evaluate(async (R) => { const r = await fetch(`/api/rooms/${R}/sound`, { headers: { 'X-Sound-Owner': localStorage.getItem('klibb.soundOwner') } }); return { preset: (await r.json()).preset, mine: window.klibb.soundMine(), sees: window.klibb.players()[0].look.sound }; }, R);
    check('per player: B in the same room has no preset, keeps the original sound, and only sees A\'s seed', other.preset === null && !other.mine.patches && other.sees && !other.sees.patches, other);
    const noKey = await (await fetch(`${S.base}/api/rooms/${R}/sound`)).status;
    check('…nobody can read a preset without its private key (400)', noKey === 400, noKey);
    // voice chat on: the SAME mic (no second getUserMedia); voice effect on = the peers get the processed track; off = the mic track again
    await A.evaluate(() => window.klibb.toggleMic());
    const vok = await A.waitForFunction(() => { const v = window.klibb.voice(); return v.state === 'on' && v.peers.length === 1 && v.peers[0].sending; }, null, { timeout: 20000 }).then(() => true).catch(() => false);
    const v0 = await A.evaluate(() => ({ v: window.klibb.voice(), gum: window.__gum, box: !!document.getElementById('voice-fx-box') }));
    check('voice chat uses the same mic (one getUserMedia for mic layer + voice), dry by default', vok && v0.gum === 1 && v0.v.fx.on === false && v0.v.sentTracks.every((t) => t === 'mic') && v0.box, { gum: v0.gum, fx: v0.v.fx, sent: v0.v.sentTracks });
    await A.evaluate(() => { const on = document.getElementById('voice-fx-on'); on.checked = true; on.dispatchEvent(new Event('change')); const k = document.getElementById('voice-fx-kind'); k.value = 'echo'; k.dispatchEvent(new Event('change')); }); await sleep(500);
    const v1 = await A.evaluate(() => window.klibb.voice());
    check('…voice effect on (Echo, on the 90 BPM clock): processed on MY side, the peers get that track', v1.fx.on && v1.fx.kind === 'echo' && v1.fxChain === 'echo' && v1.sentTracks.every((t) => t === 'fx'), { fx: v1.fx, chain: v1.fxChain, sent: v1.sentTracks, log: v1.log });
    for (const kind of ['radio', 'hall', 'robot', 'chorus', 'pitch', 'harmony']) await A.evaluate((kind) => { const k = document.getElementById('voice-fx-kind'); k.value = kind; k.dispatchEvent(new Event('change')); }, kind);
    await sleep(300);
    const v2 = await A.evaluate(() => window.klibb.voice());
    await A.evaluate(() => { const on = document.getElementById('voice-fx-on'); on.checked = false; on.dispatchEvent(new Event('change')); }); await sleep(500);
    const v3 = await A.evaluate(() => ({ v: window.klibb.voice(), micLayer: !!window.klibb.soundObj().engine.micSource() }));
    check('…radio / hall / robot / chorus / pitch / harmony build too; turning it off sends the original mic track again (the mic layer keeps working)', v2.fxChain === 'harmony' && v3.v.fxChain === null && v3.v.sentTracks.every((t) => t === 'mic') && v3.micLayer, { v2: v2.fxChain, v3: v3.v.sentTracks });
    // Hear myself: monitor the (dry or effected) voice locally; headphones hint; raw mic for instruments
    await A.evaluate(() => { document.getElementById('more-btn')?.click(); document.getElementById('voice-mon-box')?.scrollIntoView({ block: 'center' }); }); await sleep(200);
    const mon0 = await A.evaluate(() => ({ box: !!document.getElementById('voice-mon-box'), hint: document.getElementById('voice-mon-hint')?.hidden, v: window.klibb.voice() }));
    check('Hear myself UI is next to Voice effect, off by default, hint hidden', mon0.box && mon0.hint === true && mon0.v.monitor.on === false && mon0.v.monitoring === false, mon0);
    await A.evaluate(() => { const on = document.getElementById('voice-mon-on'); on.checked = true; on.dispatchEvent(new Event('change')); }); await sleep(800);
    const mon1 = await A.evaluate(() => ({ v: window.klibb.voice(), hint: document.getElementById('voice-mon-hint')?.hidden, raw: document.getElementById('voice-mon-raw')?.checked, label: document.querySelector('#voice-mon-box [data-t="voiceMon"]')?.textContent }));
    check('…Hear myself on: monitoring into headphones, raw mic on, headphones warning shown', mon1.v.monitor.on && mon1.v.monitoring && mon1.hint === false && mon1.raw === true && /Hear myself/.test(mon1.label || ''), mon1);
    await A.evaluate(() => { const on = document.getElementById('voice-fx-on'); on.checked = true; on.dispatchEvent(new Event('change')); const k = document.getElementById('voice-fx-kind'); k.value = 'echo'; k.dispatchEvent(new Event('change')); }); await sleep(400);
    const mon2 = await A.evaluate(() => window.klibb.voice());
    check('…with Echo on, monitor still taps the processed chain (peers still get fx)', mon2.monitoring && mon2.fxChain === 'echo' && mon2.sentTracks.every((t) => t === 'fx'), mon2);
    await A.evaluate(() => { const on = document.getElementById('voice-mon-on'); on.checked = false; on.dispatchEvent(new Event('change')); const fx = document.getElementById('voice-fx-on'); fx.checked = false; fx.dispatchEvent(new Event('change')); }); await sleep(400);
    await A.evaluate(() => { document.getElementById('voice-fx-box')?.scrollIntoView({ block: 'center' }); }); await sleep(200);
    await A.screenshot({ path: path.join(SHOTS, '12-voice-effect.png') });
    await A.evaluate(() => { window.klibb.toggleMic(); document.getElementById('more-btn')?.click(); }); // mute
    // ---------- the running loops on the master clock ----------
    await A.evaluate(() => window.klibb.radio().set({ voices: { on: true } })); await sleep(2800);
    const loops = await A.evaluate(() => { const r = window.klibb.radio(); return r.voiceLog.slice(-40); });
    const keys = new Set(loops.map((e) => e.key));
    check('Master on: the step sequencer layer and the four voices run on the master clock', keys.has('step' + 2) && ['v0', 'v1', 'v2', 'v3'].every((k) => keys.has(k)), [...keys]);
    // ---------- Master: volume + city sound; blend/knob forced; walk tempo on Steps ----------
    await A.evaluate(() => window.klibb.soundUi().open()); await sleep(300);
    const forced = await A.evaluate(() => { window.klibb.radio().set({ knob: 0, on: false }); return window.klibb.radio().state; });
    check('blend/power dormant: cleanRadio forces on + knob 0.5 (my sound)', forced.on === true && forced.knob === 0.5, forced);
    await A.$eval('#master-vol', (r) => { r.value = '40'; r.dispatchEvent(new Event('input', { bubbles: true })); });
    const vol = await A.evaluate(() => ({ v: window.klibb.soundObj().volume, ui: document.getElementById('master-vol').value, hidden: document.getElementById('music-vol').value }));
    check('Master volume is the ears gain (Music vol merged)', Math.abs(vol.v - 0.4) < 1e-6 && vol.ui === '40' && vol.hidden === '40', vol);
    await A.$eval('#city-sound', (r) => { r.value = '55'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
    const city = await A.evaluate(() => ({ c: window.klibb.radio().state.city, out: document.getElementById('city-sound-val').textContent, placeCity: window.klibb.soundObj().engine?.place?.city }));
    check('City sound 0–100 sets radio.city (dry/wet of city FX)', Math.abs(city.c - 0.55) < 1e-6 && /55 %/.test(city.out), city);
    await (await A.$('#radio-box')).screenshot({ path: path.join(SHOTS, '05-master-volume-city.png') });
    // Walk tempo lives on Steps (was Master tempo)
    await A.click('#snd-tabs [data-tab="step"]'); await sleep(200);
    const walkUi = await A.evaluate(() => ({ walk: !!document.getElementById('walk-tempo'), run: !!document.getElementById('run-tempo'), pitch: !!document.getElementById('run-pitch'), lock: !!document.getElementById('run-lock') }));
    check('Steps tab: Walk tempo, Run tempo, Pitch correction (no lock UI)', walkUi.walk && walkUi.run && walkUi.pitch && !walkUi.lock, walkUi);
    await A.$eval('#walk-tempo', (r) => { r.value = '1000'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
    await sleep(400);
    const fast = await A.evaluate(() => ({ bpm: window.klibb.radio().state.bpm, out: document.getElementById('walk-tempo-val').textContent }));
    check('Walk tempo to top: ~120 000 BPM (semitone grid)', fast.bpm > 100000 && /BPM/.test(fast.out), fast);
    await A.evaluate(() => { window.klibb.radio().set({ bpm: 90, voices: { on: false }, city: 0 }); window.klibb.soundObj().setVolume(1); });
    // bird + wind still work via API (UI dormant)
    await A.evaluate(() => { window.klibb.radio().set({ bird: { on: true }, wind: { on: true } }); });
    await sleep(500);
    const amb = await A.evaluate(() => { const a = window.klibb.radio().amb; const ph = a.phrase('e2e'); return { bird: a.bird.on, phrases: a.bird.phrases, kind: ph && ph.kind, falling: ph && ph.notes.every((n) => n.f1 < n.f0), wind: a.wind.on, gusts: a.wind.gusts }; });
    check('bird/wind engine paths still work (API; Master UI dormant)', amb.bird && amb.phrases >= 1 && amb.falling && amb.wind && amb.gusts >= 1, amb);
    await A.evaluate(() => window.klibb.soundUi().open()); await sleep(300);
    await A.screenshot({ path: path.join(SHOTS, '07-sound-panel-master-full.png') });
    // ---------- reload: the room preset comes back from the server ----------
    await A.evaluate((R) => { sessionStorage.removeItem('klibb.sound'); sessionStorage.removeItem(`klibb.radio@${R}`); }, R);
    await A.reload(); await A.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 }); await A.evaluate(() => window.klibb.radioReady()); await sleep(500);
    const back = await A.evaluate(() => ({ mine: window.klibb.soundMine(), radio: window.klibb.radio().state }));
    check('reload (fresh tab copy): this room\'s preset is loaded from the server, Master as it was', back.mine.patches && back.mine.patches.slap.layers.some((l) => l.kind === 'sampler') && back.radio.knob === 0.5 && back.radio.bird.on, back.radio);
    // another room starts from the original
    const made2 = await (await fetch(`${S.base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: false }) })).json();
    await A.goto(`${S.base}/?room=${made2.room.id}`); await A.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 }); await A.evaluate(() => window.klibb.radioReady()); await sleep(300);
    const fresh = await A.evaluate(() => window.klibb.soundMine());
    check('a different room starts from the original sound (no preset there yet)', !fresh.patches, fresh);
    // ---------- the city: the place effect follows where I stand ----------
    // City sound (radio.city) is the dry/wet of place FX (slim-synth); default 0 = fully dry.
    const C = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage(); C.on('pageerror', (e) => errors.push('C: ' + e.message));
    await C.goto(`${S.base}/?room=stad`); await C.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
    await C.mouse.click(600, 400); await sleep(300);
    await C.evaluate(async () => { const s = window.klibb.soundObj(); await s.ready; await s.engine?.ready; window.klibb.radio().set({ city: 1 }); });
    await sleep(400);
    const go = async (x, z, ms = 1600) => { await C.evaluate(([x, z]) => window.klibb.moveTo(x, z), [x, z]); await sleep(ms); return C.evaluate(() => { const p = window.klibb.place(), e = window.klibb.soundObj().engine?.place; return { ...p, cfg: undefined, live: e ? { a: e.a.send.gain.value, b: e.b.send.gain.value, big: e.big.send.gain.value, mod: e.node?.parameters.get('modMix').value, st: e.node?.parameters.get('stutter').value, dm: e.node?.parameters.get('decimMix').value, fm: e.node?.parameters.get('freqMix')?.value, fh: e.node?.parameters.get('freqHz')?.value } : null, chip: document.getElementById('place-chip')?.textContent }; }); };
    const q = {};
    for (const [id, x, z] of [['delay', -42, -42], ['reverb', 42, -42], ['flanger', -20, 0], ['chorus', 20, 0], ['glitch', -42, 42], ['freq', 42, 42], ['hall', 0, 0]]) q[id] = await go(x, z);
    check('city: one place bus (worklet) after my master; each quarter is heard where it is (delay, reverb, flanger, chorus, glitch, freq)',
      q.delay.bus && q.delay.worklet && q.delay.now.zones.delay > 0.85 && q.delay.live.a > 0.25 && q.reverb.live.big > 0.4 && q.flanger.live.mod > 0.7 && q.chorus.live.mod > 0.6 && q.glitch.live.st > 0.3 && q.glitch.live.dm > 0.5 && q.freq.live.fm > 0.4 && Math.abs(q.freq.live.fh) > 50,
      Object.fromEntries(Object.entries(q).map(([k, v]) => [k, v.live])));
    check('…Town Hall is quiet (no strong sends / freq / glitch)', q.hall.live.a < 0.25 && q.hall.live.big < 0.25 && q.hall.live.mod < 0.2 && (q.hall.live.fm || 0) < 0.15 && q.hall.live.st < 0.15, q.hall.live);
    check('…a big label says where I am ("🎛 Delay quarter" / "🎛 Freq shift quarter")', q.delay.chip === '🎛 Delay quarter' && q.freq.chip === '🎛 Freq shift quarter', [q.delay.chip, q.freq.chip]);
    // smooth: jump from freq to delay – the params glide (no step), settle in about a second
    await go(42, 42, 1500);
    const g0 = await go(-42, -42, 160), g1 = await go(-42, -42, 1400);
    check('…no jumps: teleporting freq → delay quarter, the delay send glides (slew ≈ 0.75 s), then settles', g0.live.a > 0.01 && g0.live.a < 0.35 && g1.live.a > 0.25, { after160ms: g0.live.a, after1_5s: g1.live.a });
    await C.screenshot({ path: path.join(SHOTS, '09-city-delay-quarter.png') });
    // between two quarters: a blend
    const mid = await go(-32, -16);
    check('…on the street between two quarters (delay ↔ flanger) both blend', mid.now.zones.delay > 0.3 && mid.now.zones.flanger > 0.3 && mid.live.a > 0.1 && mid.live.mod > 0.2, mid.now.zones);
    // Blend UI is dormant (cleanRadio forces knob 0.5); place FX are driven by city sound, not knob.
    const before = await C.evaluate(() => JSON.stringify(window.klibb.place().now));
    await C.evaluate(() => window.klibb.radio().set({ knob: 0.1 })); await sleep(400);
    const after = await C.evaluate(() => ({ place: JSON.stringify(window.klibb.place().now), morph: window.klibb.soundObj().radio.knob, city: window.klibb.radio().state.city }));
    check('…knob forced to my-sound (0.5); place effect unchanged (driven by city sound)', before === after.place && after.morph === 0.5 && after.city === 1, after);
    // a house: neutral
    await C.goto(`${S.base}/?room=stad-1`); await C.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 }); await C.mouse.click(600, 400); await sleep(800);
    const house = await C.evaluate(() => ({ ...window.klibb.place(), cfg: undefined, chip: !!document.getElementById('place-chip') }));
    check('…inside a house: no place effect (the bus is never built; the room\'s own reverb only)', !house.bus && !house.chip, house);
    await C.close();
    // ---------- iPhone ----------
    const ictx = await browser.newContext({ ...devices['iPhone 13'] });
    const I = await ictx.newPage(); I.on('pageerror', (e) => errors.push('I: ' + e.message));
    await I.goto(`${S.base}/?room=${R}`); await I.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 60000 });
    await I.evaluate(() => { const sh = window.klibb.soundUi(); sh.open(); sh.state().patches.slap.layers.push({ ...window.klibb.synthShared().cleanPatch({ layers: [{ kind: 'sampler' }] }).layers[0] }); sh.render(); document.querySelector('.snd-sampler').scrollIntoView(); });
    await sleep(400);
    const ip = await I.evaluate(() => { const b = document.querySelector('.smp-pick').getBoundingClientRect(); const f = document.querySelector('.smp-file'); return { h: b.height, accept: f.accept }; });
    check('iPhone: a big "Choose audio file" button (file picker, accept audio/*)', ip.h >= 48 && /audio\/\*/.test(ip.accept), ip);
    await I.screenshot({ path: path.join(SHOTS, '08-iphone-sampler.png') });
    check('no page errors', errors.length === 0, errors);
  } catch (e) { failed++; console.log('  ✗ crashed: ' + (e.stack || e)); }
  await browser.close(); S.child.kill();
  console.log(`\nSampler/Master e2e: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
