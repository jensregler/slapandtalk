// "Clear hidden stickers" (POST /api/rooms/:room/clear-hidden) and the automatic cleanup of
// hidden stickers that leave the peel history (server/hidden.js, AUTO_PRUNE_HIDDEN).
// Körs med: node tests/hidden.test.js (ingår i npm test)
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp } = require('../server/app');
const { onBroadcast } = require('../server/realtime');
const { autoPruneOn } = require('../server/hidden');

const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
const quiet = { error: () => {}, log: () => {} };

async function boot(tmp, opts) {
  const store = createStore(new LocalAdapter(tmp), { writeDelayMs: 20, log: quiet });
  const app = createApp(store, { quickTtlHours: 24, adminToken: 'hemligt-test', log: quiet, pruneDelayMs: 40, ...opts });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = (method, url, body, headers = {}) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const png = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#22aaff' } }).png().toBuffer();
  const fd = new FormData(); fd.append('file', new Blob([png], { type: 'image/png' }), 'k.png');
  const img = await (await fetch(`${base}/api/stickers`, { method: 'POST', body: fd })).json();
  const made = (await json('POST', '/api/rooms', {})).body;
  const R = made.room.id, KEY = made.roomKey;
  const slap = async (x, size, owner = 'devAAAAAAAA', y = 2) => (await json('POST', `/api/rooms/${R}/stamps`, { imageId: img.id, position: [x, y, -5], normal: [0, 0, 1], quaternion: [0, 0, 0, 1], size, surface: 'vägg-norr', owner })).body;
  const list = async () => (await json('GET', `/api/rooms/${R}/stamps`)).body.stamps;
  return { store, app, server, base, json, img, R, KEY, slap, list };
}

(async () => {
  assert(autoPruneOn({}) && autoPruneOn({ AUTO_PRUNE_HIDDEN: '1' }) && !autoPruneOn({ AUTO_PRUNE_HIDDEN: '0' }) && !autoPruneOn({ AUTO_PRUNE_HIDDEN: 'off' }),
    'AUTO_PRUNE_HIDDEN: on by default, 0/off turns the automatic cleanup off');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-hidden-'));
  const events = [];
  const off = onBroadcast((room, e) => events.push({ room, ...e }));
  try {
    // ---------- The manual action ----------
    {
      const T = await boot(path.join(tmp, 'a'), { autoPrune: false });
      try {
        const old1 = await T.slap(0, 0.3), old2 = await T.slap(0.1, 0.3), partial = await T.slap(1.2, 0.4);
        const big = await T.slap(0.05, 1.2, 'devBBBBBBBB'), edge = await T.slap(1.5, 0.4, 'devBBBBBBBB'); // big hides old1+old2; edge covers half of partial
        const before = await T.list();
        const no = await T.json('POST', `/api/rooms/${T.R}/clear-hidden`, { by: 'Jens' });
        const wrong = await T.json('POST', `/api/rooms/${T.R}/clear-hidden`, { by: 'Jens' }, { 'x-room-key': 'fel' });
        const noCount = await T.json('GET', `/api/rooms/${T.R}/hidden`);
        assert(no.status === 403 && wrong.status === 403 && noCount.status === 403 && (await T.list()).length === 5, 'without (or with a wrong) room key: 403, nothing removed');
        const cnt = await T.json('GET', `/api/rooms/${T.R}/hidden`, null, { 'x-room-key': T.KEY });
        assert(cnt.status === 200 && cnt.body.hidden === 2 && cnt.body.total === 5, `GET …/hidden counts for the confirm: ${JSON.stringify(cnt.body)}`);
        events.length = 0;
        const ok = await T.json('POST', `/api/rooms/${T.R}/clear-hidden`, { by: 'Jens' }, { 'x-room-key': T.KEY });
        const after = await T.list();
        assert(ok.status === 200 && ok.body.removed === 2 && ok.body.kept === 3 && ok.body.historyCleared === 3, `the creator clears: 2 hidden removed, 3 kept, their peel keys dropped (${JSON.stringify(ok.body)})`);
        assert(after.map((s) => s.id).join() === [partial, big, edge].map((x) => x.stamp.id).join() && after.every((s) => before.find((b) => b.id === s.id).size === s.size && before.find((b) => b.id === s.id).order === s.order),
          'the visible ones stay, in the same order and size; the partly covered one is kept');
        const ev = events.filter((e) => e.room === T.R && e.type === 'room:clear-hidden');
        assert(ev.length === 1 && ev[0].ids.slice().sort().join() === [old1, old2].map((x) => x.stamp.id).sort().join() && ev[0].by === 'Jens' && !events.some((e) => e.type === 'stamp:remove'),
          'everyone in the room gets ONE room:clear-hidden with the removed ids and who did it');
        const peel = await fetch(`${T.base}/api/rooms/${T.R}/stamps/${edge.stamp.id}/peel`, { method: 'DELETE', headers: { 'x-peel-token': edge.peelToken } });
        assert(peel.status === 403, 'the peel history is gone: an old peel token no longer peels a kept sticker');
        await T.store.flush();
        const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'a', 'rooms', `${T.R}.json`), 'utf8'));
        assert(saved.stamps.length === 3 && saved.stamps.every((s) => !s.peelHash && !s.peelOwner), 'persisted: 3 stickers, no peel keys');
        const again = await T.json('POST', `/api/rooms/${T.R}/clear-hidden`, {}, { 'x-room-key': T.KEY });
        const admin = await T.json('POST', `/api/rooms/${T.R}/clear-hidden`, {}, { 'x-admin-token': 'hemligt-test' });
        const stad = await T.json('POST', '/api/rooms/stad/clear-hidden', {}, { 'x-room-key': T.KEY });
        const none = await T.json('POST', '/api/rooms/finns-inte/clear-hidden', {}, { 'x-admin-token': 'hemligt-test' });
        assert(again.body.removed === 0 && admin.status === 200 && stad.status === 403 && none.status === 404, 'again: 0; admin may; the City needs admin; unknown room 404');
        const fresh = await T.slap(3, 0.3);
        const p2 = await fetch(`${T.base}/api/rooms/${T.R}/stamps/${fresh.stamp.id}/peel`, { method: 'DELETE', headers: { 'x-peel-token': fresh.peelToken } });
        assert(p2.status === 200, 'new slaps after the clear can be peeled as usual');
      } finally { T.server.close(); T.app.locals.hidden.close(); }
    }
    // ---------- Automatic cleanup when stickers leave the peel history ----------
    {
      const T = await boot(path.join(tmp, 'b'), { autoPrune: true });
      try {
        const A = 'devAAAAAAAA';
        const covered = await T.slap(-3, 0.3, A), partial = await T.slap(-1.5, 0.4, A), mine = await T.slap(2, 0.3, 'devCCCCCCCC');
        await T.slap(-2.95, 1, 'devBBBBBBBB'); // hides `covered` completely
        await T.slap(-1.2, 0.4, 'devBBBBBBBB'); // covers half of `partial`
        await T.slap(2, 1, 'devBBBBBBBB'); // hides `mine`, but devC's history still has it
        events.length = 0;
        const t0 = Date.now();
        for (let i = 0; i < 20; i++) await T.slap(-4 + i * 0.4, 0.15, A, 0.4); // A's 20 newest: covered+partial leave A's history
        const slapMs = Date.now() - t0;
        await new Promise((r) => setTimeout(r, 80));
        await T.app.locals.hidden.settle();
        const ids = (await T.list()).map((s) => s.id);
        const rm = events.filter((e) => e.room === T.R && e.type === 'stamp:remove');
        assert(!ids.includes(covered.stamp.id) && rm.length === 1 && rm[0].id === covered.stamp.id && rm[0].quiet === true,
          'a sticker that left the history and is fully covered is removed (broadcast as an ordinary, quiet stamp:remove)');
        assert(ids.includes(partial.stamp.id), 'a sticker that left the history but is only partly covered is kept');
        assert(ids.includes(mine.stamp.id), 'a fully covered sticker that is still in someone\'s history is kept');
        await T.store.flush();
        const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'b', 'rooms', `${T.R}.json`), 'utf8'));
        assert(!saved.stamps.some((s) => s.id === covered.stamp.id) && saved.stamps.length === ids.length, 'the automatic removal is persisted');
        console.log(`  (20 slaps with the cleanup on: ${slapMs} ms)`);
      } finally { T.server.close(); T.app.locals.hidden.close(); }
    }
    {
      const T = await boot(path.join(tmp, 'c'), { autoPrune: false });
      try {
        const covered = await T.slap(-3, 0.3);
        await T.slap(-2.95, 1, 'devBBBBBBBB');
        for (let i = 0; i < 20; i++) await T.slap(-4 + i * 0.4, 0.15, 'devAAAAAAAA', 0.4);
        await new Promise((r) => setTimeout(r, 80)); await T.app.locals.hidden.settle();
        assert((await T.list()).some((s) => s.id === covered.stamp.id), 'AUTO_PRUNE_HIDDEN=0 (autoPrune: false): nothing is removed automatically');
      } finally { T.server.close(); T.app.locals.hidden.close(); }
    }
  } finally { off(); fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log('Alla tester för dolda klibbor gick igenom.');
})().catch((e) => { console.error(e); process.exit(1); });
