// Auto-slap on the server (server/app.js POST …/stamps with auto: true): the rate budget (600/min
// for the full version, the hand limit of 120/min for everyone else), bursts sharing one peel key
// (join) = one undo step, a wrong/stale join gets its own key, recordings get the slaps.
// Run: node tests/autoslap.test.js (in npm test)
// Tests the free/full split, so OPEN ACCESS (shared/openaccess.mjs) is off here unless OPEN_ACCESS is set.
process.env.OPEN_ACCESS ??= '0';
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { LocalAdapter } = require('../server/storage/local');
const { createStore, PEEL_KEEP } = require('../server/store');
const { createApp } = require('../server/app');
const { createRecorder } = require('../server/recorder');
const { makeEntitlements } = require('../server/entitlements');

const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
const quiet = { error: () => {}, log: () => {} };
const FULL = 'auto-full-key-test1';

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-auto-'));
  const store = createStore(new LocalAdapter(dir), { writeDelayMs: 10, log: quiet });
  const recorder = createRecorder(store, { flushMs: 100, tickMs: 20 });
  const app = createApp(store, { adminToken: 'adm-test', recorder, entitle: makeEntitlements({ FULL_ACCESS_KEYS: FULL }), log: quiet, autoPrune: false });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = (method, url, body, headers = {}) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  try {
    const png = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#22aaff' } }).png().toBuffer();
    const fd = new FormData(); fd.append('file', new Blob([png], { type: 'image/png' }), 'k.png');
    const img = await (await fetch(`${base}/api/stickers`, { method: 'POST', body: fd })).json();
    const { room: { id: R }, roomKey: KEY } = (await json('POST', '/api/rooms', {})).body;
    let x = 0;
    const slap = (extra = {}, headers = {}) => json('POST', `/api/rooms/${R}/stamps`, { imageId: img.id, position: [-4 + (x++ % 80) * 0.1, 1 + Math.floor(x / 80) * 0.2, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.15, surface: 'vägg-norr', owner: 'devAUTOAUTO', ...extra }, headers);
    const full = { 'x-unlock': FULL };

    // ---------- Bursts: one peel key ----------
    await json('POST', `/api/rooms/${R}/recording/start`, {}, { 'x-room-key': KEY });
    const first = (await slap({ auto: true }, full)).body;
    assert(first.joined === false && first.peelToken, 'the first auto slap of a burst: its own key (joined: false)');
    const rest = [];
    for (let i = 0; i < 30; i++) rest.push((await slap({ auto: true, join: { id: first.stamp.id, token: first.peelToken } }, full)).body);
    assert(rest.every((r) => r.joined === true && r.peelToken === first.peelToken), '30 more join it: same peel key');
    const stale = (await slap({ auto: true, join: { id: first.stamp.id, token: 'wrong-token' } }, full)).body;
    assert(stale.joined === false && stale.peelToken !== first.peelToken, 'a wrong token does not join (own key)');
    const handJoin = (await slap({ join: { id: first.stamp.id, token: first.peelToken } }, full)).body;
    assert(handJoin.joined === undefined && handJoin.peelToken !== first.peelToken, 'a hand slap never joins');
    // the burst is ONE of the 20 peel steps: 20 more single slaps leave it peelable
    for (let i = 0; i < PEEL_KEEP - 3; i++) await slap();
    const items = [first, ...rest].map((r) => ({ id: r.stamp.id, token: first.peelToken }));
    const peel = await json('POST', `/api/rooms/${R}/peel`, { items });
    assert(peel.status === 200 && Object.values(peel.body.results).every((v) => v === 'ok') && Object.keys(peel.body.results).length === 31,
      `the whole burst (31 stickers) is one peel step: still peelable after ${PEEL_KEEP - 3} more steps, peeled with one key`);
    const late = (await slap({ auto: true, join: { id: first.stamp.id, token: first.peelToken } }, full)).body;
    assert(late.joined === false, 'after the burst was peeled, a join to it just gets a new key');
    const stop = await json('POST', `/api/rooms/${R}/recording/stop`, {}, { 'x-room-key': KEY });
    const { parseRecording } = await import('../shared/replay.mjs');
    const log = parseRecording(await (await fetch(`${base}/api/rooms/${R}/recordings/${stop.body.recording.recId}/log`, { headers: { 'x-room-key': KEY } })).text());
    const adds = new Set(log.events.filter((e) => e.e === 'stamp:add').map((e) => e.stamp.id));
    assert([first, ...rest].every((r) => adds.has(r.stamp.id)) && log.events.filter((e) => e.e === 'stamp:remove').length >= 31, 'the recording has every auto slap (stamp:add) and the burst peel');
    assert(!log.events.some((e) => e.stamp && (e.stamp.peelHash || e.stamp.peelOwner)), 'no peel keys in the recording');

    // ---------- Rate budget ----------
    const { room: { id: R2 } } = (await json('POST', '/api/rooms', {})).body;
    const burst = async (n, extra, headers) => { let ok = 0, limited = 0; for (let i = 0; i < n; i++) { const r = await json('POST', `/api/rooms/${R2}/stamps`, { imageId: img.id, position: [0, 1 + i * 0.001, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size: 0.15, surface: 'vägg-norr', ...extra }, headers); if (r.status === 200) ok++; else if (r.status === 429) limited++; } return { ok, limited }; };
    // (this IP already made ~19 hand slaps above; the hand bucket is 120/min)
    const free = await burst(110, { auto: true }, {});
    assert(free.limited > 0 && free.ok < 110, `free auto: the hand limit applies (${free.ok} ok, ${free.limited} × 429)`);
    const paid = await burst(150, { auto: true }, full);
    assert(paid.ok === 150, `full version auto: 150 more in a minute pass (${paid.ok}); budget ${600}/min`);
  } finally { await recorder.close(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  console.log('autoslap (server): all ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
