// The paid full version (Lemon Squeezy): license keys, webhook, cache, flags, admin count, and the
// quiet "Full version" panel in the browser. No real LS: the License API is a fake fetch.
// Runs with: node tests/pay.test.js (part of npm test). The browser part needs dist/ (npm run build)
// and is skipped (with a note) when dist/index.html is missing.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const { LocalAdapter } = require('../server/storage/local');
const { createStore } = require('../server/store');
const { createApp, payConfig } = require('../server/app');
const { attachRealtime } = require('../server/realtime');
const { makeEntitlements } = require('../server/entitlements');
const { createLicenses, verifySignature, hashKey } = require('../server/licenses');

const assert = (c, m) => { if (!c) throw new Error('FEL: ' + m); console.log('✔ ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ALL = { fabrics: true, soundDesign: true, bigStickers: true, cleanVideo: true }, NONE = { fabrics: false, soundDesign: false, bigStickers: false, cleanVideo: false };

const STORE = 4711, PRODUCT = 90210;
const K = {
  good: '38b1460a-5104-4067-a91d-77b872934d51',
  good2: '11111111-2222-4333-8444-555555555555',
  refund: '22222222-3333-4444-8555-666666666666',
  disabled: '33333333-4444-4555-8666-777777777777',
  foreign: '44444444-5555-4666-8777-888888888888',
  unknown: '55555555-6666-4777-8888-999999999999',
  down: '66666666-7777-4888-8999-aaaaaaaaaaaa',
  hook: '77777777-8888-4999-8aaa-bbbbbbbbbbbb',
  later: '88888888-9999-4aaa-8bbb-cccccccccccc',
};
const MANUAL = 'jens-manual-key-123';

// Fake LS License API. db[key] = { status, store, product, order, valid, http }.
function fakeLs() {
  const db = {
    [K.good]: { status: 'inactive', order: 100 }, [K.good2]: { status: 'active', order: 101 },
    [K.refund]: { status: 'active', order: 200 }, [K.disabled]: { status: 'disabled', valid: false, order: 300 },
    [K.foreign]: { status: 'active', product: 1, order: 400 }, [K.down]: { http: 500 },
    [K.hook]: { status: 'active', order: 500 }, [K.later]: { status: 'active', order: 600 },
  };
  const calls = [];
  const fetch = async (url, init) => {
    const form = new URLSearchParams(init.body); const key = form.get('license_key');
    const what = url.split('/').pop(); calls.push({ what, key, instance: form.get('instance_name') });
    const d = db[key];
    const reply = (status, body) => ({ status, ok: status < 300, json: async () => body });
    if (!d) return reply(404, { valid: false, error: 'license_key not found.', license_key: null, meta: null });
    if (d.http) return reply(d.http, {});
    const meta = { store_id: d.store || STORE, order_id: d.order, product_id: d.product || PRODUCT, variant_id: 1, customer_email: 'buyer@example.com' };
    const lk = { id: d.order + 1, status: d.status, key, activation_limit: 5, activation_usage: d.status === 'inactive' ? 0 : 1 };
    if (what === 'activate') { d.status = 'active'; return reply(200, { activated: true, error: null, license_key: { ...lk, status: 'active' }, instance: { id: 'i1', name: form.get('instance_name') }, meta }); }
    const valid = d.valid !== false && ['active', 'inactive'].includes(d.status);
    return reply(valid ? 200 : 400, { valid, error: valid ? null : 'This license key is ' + d.status + '.', license_key: lk, instance: null, meta });
  };
  return { db, calls, fetch, n: (key) => calls.filter((c) => c.key === key).length };
}

// Capture every log line: no key may ever show up in plain text.
const logged = [];
const quietLog = { log: (...a) => logged.push(a.join(' ')), error: (...a) => logged.push(a.join(' ')) };
const origLog = console.log, origErr = console.error;
console.error = (...a) => { logged.push(a.join(' ')); origErr(...a); };

const SECRET = 'whsec-test-123456';
const sign = (raw, secret = SECRET) => crypto.createHmac('sha256', secret).update(raw).digest('hex');
const ENV = { LS_STORE_ID: String(STORE), LS_PRODUCT_ID: String(PRODUCT), LS_WEBHOOK_SECRET: SECRET, FULL_ACCESS_KEYS: `${MANUAL},marika-sound-only1:soundDesign`,
  LS_CHECKOUT_URL: 'https://slapandtalk.lemonsqueezy.com/buy/abc-123' };

async function serverTests() {
  // ---------- Signature ----------
  const raw = Buffer.from('{"meta":{"event_name":"order_created"}}');
  assert(verifySignature(SECRET, raw, sign(raw)) && verifySignature(SECRET, raw, sign(raw).toUpperCase()) && !verifySignature(SECRET, raw, sign(raw, 'other'))
    && !verifySignature(SECRET, Buffer.from(raw.toString() + ' '), sign(raw)) && !verifySignature(SECRET, raw, '') && !verifySignature('', raw, sign(raw, ''))
    && !verifySignature(SECRET, raw, 'abc') && !verifySignature(SECRET, raw, undefined),
  'webhook signature: HMAC-SHA256 hex of the raw body; wrong secret, changed body, empty/short/missing signature and empty secret all fail');

  // ---------- Not configured ----------
  const off = createLicenses({ env: {}, fetch: async () => { throw new Error('must not call LS'); } });
  assert(!off.enabled && !(await off.ensure(K.good)) && !off.peek(K.good), 'without LS_STORE_ID/LS_PRODUCT_ID nothing is asked of LS and LS keys unlock nothing');

  // ---------- Validation + cache ----------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-pay-'));
  const adapter = new LocalAdapter(dir);
  const ls = fakeLs();
  let now = Date.parse('2026-10-26T12:00:00Z');
  const mk = () => createLicenses({ adapter, env: ENV, fetch: ls.fetch, clock: () => now, log: quietLog });
  let lic = mk();
  assert(await lic.ensure(K.good) && lic.peek(K.good) && lic.peek(K.good.toUpperCase()) && lic.peek(' ' + K.good + ' '), 'a paid key for our store + product unlocks (case and spaces don’t matter)');
  assert(ls.calls.filter((c) => c.key === K.good).map((c) => c.what).join() === 'validate,activate' && ls.calls.find((c) => c.what === 'activate').instance === 'slapandtalk.com',
    'a never-activated key is activated ONCE with instance_name slapandtalk.com');
  await lic.ensure(K.good); await lic.ensure(K.good);
  assert(ls.n(K.good) === 2, 'cached: asking again does not call LS');
  const file = path.join(dir, 'entitlements', hashKey(K.good) + '.json');
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  const allFiles = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.json')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  assert(rec.ok && rec.status === 'active' && rec.orderId === '100' && !allFiles.includes(K.good) && !allFiles.includes('buyer@example.com'),
    'the verdict is stored as entitlements/<sha256(key)>.json (no key, no e-mail in storage)');
  lic = mk(); // server restart: memory empty, storage remains
  assert(await lic.ensure(K.good) && ls.n(K.good) === 2, 'after a restart the stored verdict is used (no LS call)');

  assert(!(await lic.ensure(K.disabled)) && JSON.parse(fs.readFileSync(path.join(dir, 'entitlements', hashKey(K.disabled) + '.json'))).reason === 'disabled', 'a disabled key is locked (and remembered)');
  assert(!(await lic.ensure(K.foreign)) && !fs.existsSync(path.join(dir, 'entitlements', hashKey(K.foreign) + '.json')), 'a valid key for ANOTHER LS product does not unlock and is not stored');
  assert(!(await lic.ensure(K.unknown)) && !(await lic.ensure(K.unknown)) && ls.n(K.unknown) === 1, 'an unknown key is refused; asked once, then remembered in memory for a while');
  assert(!(await lic.ensure('not-a-uuid-key-at-all')) && !ls.calls.some((c) => c.key === 'not-a-uuid-key-at-all'), 'something that isn’t an LS key shape never reaches LS');
  assert(!(await lic.ensure(K.down)) && logged.some((l) => l.includes('validation of') && l.includes(hashKey(K.down).slice(0, 8))), 'LS down (500): an unknown key stays free, the error is logged with a hash prefix only');

  // Revalidation after LS_REVALIDATE_HOURS (24): the cached verdict answers at once, LS is asked in the background.
  assert(await lic.ensure(K.good2), 'second paid key unlocks');
  now += 25 * 3600_000;
  ls.db[K.good2].status = 'disabled'; ls.db[K.good2].valid = false;
  const quick = await lic.ensure(K.good2);
  await sleep(20);
  assert(quick === true && ls.n(K.good2) === 2 && !lic.peek(K.good2) && !(await lic.ensure(K.good2)), 'stale verdict: answered from cache, revalidated in the background; disabled in LS ⇒ locked');
  ls.db[K.good].http = 500; now += 25 * 3600_000;
  await lic.ensure(K.good); await sleep(20);
  assert(lic.peek(K.good), 'LS down during revalidation never locks a paying buyer out');
  delete ls.db[K.good].http;
  return { adapter, ls, dir, clock: () => now };
}

async function httpTests({ adapter, ls }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-pay-http-'));
  const store = createStore(new LocalAdapter(dir));
  const licenses = createLicenses({ adapter, env: ENV, fetch: ls.fetch, log: quietLog });
  const entitle = makeEntitlements(ENV, { licenses });
  const app = createApp(store, { adminToken: 'admin-test-token', entitle, pay: payConfig(ENV), log: quietLog });
  const server = app.listen(0);
  const rt = attachRealtime(server, { maxPlayers: 5, heartbeatMs: 500, entitle });
  const base = `http://127.0.0.1:${server.address().port}`;
  const ents = async (key) => (await (await fetch(`${base}/api/entitlements`, { headers: key ? { 'x-unlock': key } : {} })).json());
  const hook = (body, { event, sig, raw } = {}) => { const s = raw || JSON.stringify(body); return fetch(`${base}/api/ls/webhook`, { method: 'POST', body: s,
    headers: { 'Content-Type': 'application/json', 'X-Event-Name': event || body.meta.event_name, 'X-Signature': sig === undefined ? sign(Buffer.from(s)) : sig } }); };
  const sockets = [];
  try {
    // Flags
    const [free, man, marika, paid, refundBefore] = await Promise.all([ents(), ents(MANUAL), ents('marika-sound-only1'), ents(K.good), ents(K.refund)]);
    assert(same(free.full, NONE) && same(man.full, ALL) && same(marika.full, { ...NONE, soundDesign: true }) && same(paid.full, ALL) && same(refundBefore.full, ALL),
      '/api/entitlements: free = nothing; manual FULL_ACCESS_KEYS keys (all / per feature) still work; a paid LS key = the whole full version');
    assert(free.buy && free.buy.url.startsWith(ENV.LS_CHECKOUT_URL + '?') && new URL(free.buy.url).searchParams.get('checkout[custom][src]') === 'app', 'buy.url = LS_CHECKOUT_URL tagged with checkout[custom][src]=app');

    // Webhook: refusals
    const order = (id, extra = {}) => ({ meta: { event_name: 'order_created', custom_data: { src: 'app' } }, data: { type: 'orders', id: String(id), attributes: { store_id: STORE, status: 'paid', refunded: false, total_usd: 500, first_order_item: { product_id: PRODUCT }, ...extra } } });
    const bad = await hook(order(200), { sig: sign(Buffer.from('x')) }), none = await hook(order(200), { sig: '' }), junk = await hook(null, { raw: '{oops', event: 'order_created' });
    assert(bad.status === 401 && none.status === 401 && junk.status === 400, 'webhook: wrong or missing X-Signature ⇒ 401 (nothing changes); signed but broken JSON ⇒ 400');
    const ok1 = await hook(order(200));
    assert(ok1.status === 200 && (await ok1.json()).ok, 'webhook order_created (signed) ⇒ 200');
    // order_refunded locks the order's keys
    const ref = await hook({ ...order(200, { status: 'refunded', refunded: true }), meta: { event_name: 'order_refunded' } });
    const [after, still] = await Promise.all([ents(K.refund), ents(K.good)]);
    assert(ref.status === 200 && same(after.full, NONE) && same(still.full, ALL), 'webhook order_refunded ⇒ that order’s key is locked at once; other keys untouched');
    const partial = await hook({ ...order(100, { status: 'partial_refund', refunded: true }), meta: { event_name: 'order_refunded' } });
    assert(partial.status === 200 && same((await ents(K.good)).full, ALL), 'a partial refund is recorded but does not lock the key');
    // license_key_created / _updated: known without asking LS
    const lkBody = (event, key, extra = {}) => ({ meta: { event_name: event }, data: { type: 'license-keys', id: '9', attributes: { store_id: STORE, product_id: PRODUCT, order_id: 500, key, status: 'inactive', disabled: false, ...extra } } });
    const before = ls.n(K.hook);
    await hook(lkBody('license_key_created', K.hook));
    assert(same((await ents(K.hook)).full, ALL) && ls.n(K.hook) === before, 'webhook license_key_created ⇒ the key works right away, without asking LS');
    await hook(lkBody('license_key_updated', K.hook, { status: 'disabled', disabled: true }));
    assert(same((await ents(K.hook)).full, NONE), 'webhook license_key_updated (disabled) ⇒ locked');
    await hook(lkBody('license_key_updated', K.hook, { status: 'active', disabled: false }));
    assert(same((await ents(K.hook)).full, ALL), '…and re-enabled ⇒ unlocked again');
    const other = await hook(lkBody('license_key_created', K.foreign, { product_id: 1 }));
    assert(other.status === 200 && (await other.json()).ignored && same((await ents(K.foreign)).full, NONE), 'events for another product are acknowledged (200) and ignored');
    await hook({ ...order(600, { status: 'refunded', refunded: true }), meta: { event_name: 'order_refunded' } });
    assert(same((await ents(K.later)).full, NONE), 'a refund that arrives BEFORE the key was ever seen still locks it (order remembered)');

    // POST /api/unlock ("I have a key")
    const unlock = (key) => fetch(`${base}/api/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
    const [u1, u2, u3, u4] = await Promise.all([unlock(K.good), unlock(MANUAL), unlock(K.unknown), unlock('x')]);
    assert(u1.status === 200 && (await u1.json()).ok && u2.status === 200 && u3.status === 403 && u4.status === 400, '/api/unlock: paid key and manual key ok, unknown 403, junk 400');

    // Fabrics gate honours paid keys
    const fd = new FormData();
    const fab = await fetch(`${base}/api/fabrics`, { method: 'POST', body: fd, headers: { 'x-unlock': K.good } });
    const fabFree = await fetch(`${base}/api/fabrics`, { method: 'POST', body: new FormData(), headers: { 'x-unlock': K.refund } });
    assert(fab.status === 400 && fabFree.status === 403, 'fabrics: a paid key passes the gate, a refunded key gets 403');

    // Realtime: hello with a paid key not yet in memory, and the "unlock" message in an open tab
    const lic2 = createLicenses({ adapter, env: ENV, fetch: ls.fetch, log: quietLog }); // cold cache
    const ent2 = makeEntitlements(ENV, { licenses: lic2 });
    const rt2app = createApp(store, { entitle: ent2, pay: payConfig(ENV), log: quietLog }).listen(0);
    const rt2 = attachRealtime(rt2app, { maxPlayers: 5, heartbeatMs: 500, entitle: ent2 });
    const b2 = `ws://127.0.0.1:${rt2app.address().port}/ws?room=pay-rt`;
    const client = (hello) => { const ws = new WebSocket(b2); sockets.push(ws); const c = { ws, msgs: [] }; ws.on('message', (d) => c.msgs.push(JSON.parse(d))); c.send = (m) => ws.send(JSON.stringify(m));
      c.wait = async (p, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { const m = c.msgs.find(p); if (m) return m; await sleep(10); } return null; };
      c.ready = new Promise((r) => ws.on('open', r)).then(() => c.send({ t: 'hello', ...hello })); return c; };
    const patchLook = { outfit: 'punk', sound: { seed: 7, patches: { slap: { layers: [{ type: 'noise', level: 0.5 }] } } } };
    const watcher = client({ name: 'W' }); await watcher.ready; await watcher.wait((m) => m.t === 'welcome');
    const A = client({ name: 'A', unlock: { key: K.good } }); await A.ready; await A.wait((m) => m.t === 'welcome');
    await sleep(50);
    A.send({ t: 'look', name: 'A', look: patchLook });
    const la = await watcher.wait((m) => m.t === 'look' && m.name === 'A');
    const Bc = client({ name: 'B' }); await Bc.ready; await Bc.wait((m) => m.t === 'welcome');
    Bc.send({ t: 'look', name: 'B', look: patchLook });
    const lb1 = await watcher.wait((m) => m.t === 'look' && m.name === 'B');
    await lic2.ensure(K.good); // as /api/unlock would
    Bc.send({ t: 'unlock', unlock: { key: K.good } }); await sleep(20);
    watcher.msgs.length = 0;
    await sleep(2100); // look limit (0.5/s)
    Bc.send({ t: 'look', name: 'B', look: patchLook });
    const lb2 = await watcher.wait((m) => m.t === 'look' && m.name === 'B');
    assert(la && la.look.sound && la.look.sound.patches && lb1 && !(lb1.look.sound && lb1.look.sound.patches) && lb2 && lb2.look.sound && lb2.look.sound.patches,
      'realtime: a paid key in hello is checked with LS and upgrades the player; "unlock" in an open tab applies without reconnecting');
    rt2.close(); rt2app.close();

    // Admin count: no keys
    const noAdmin = await fetch(`${base}/api/admin/entitlements`);
    const adm = await fetch(`${base}/api/admin/entitlements`, { headers: { 'x-admin-token': 'admin-test-token' } });
    const admText = await adm.text(); const a = JSON.parse(admText);
    assert(noAdmin.status === 403 && adm.status === 200 && a.paidActive === 2 && a.paidLocked === 4 && a.manualKeys === 2 && a.lemonSqueezy && a.checkout
      && !Object.values(K).some((k) => admText.includes(k)) && !admText.includes(hashKey(K.good)),
    `admin: GET /api/admin/entitlements (ADMIN_TOKEN) counts paid keys (${a.paidActive} active, ${a.paidLocked} locked) and manual keys; never a key or hash; 403 without token`);
  } finally {
    for (const s of sockets) try { s.close(); } catch { /* ok */ }
    rt.close(); server.close();
  }
}

function configTests() {
  const c = (env) => payConfig(env);
  assert(!c({}).show && !c({}).checkoutUrl, 'no LS_CHECKOUT_URL ⇒ no entry at all');
  assert(c({ LS_CHECKOUT_URL: ENV.LS_CHECKOUT_URL }).show, 'LS_CHECKOUT_URL ⇒ the quiet entry exists');
  assert(!c({ LS_CHECKOUT_URL: 'http://evil.example/buy' }).show && !c({ LS_CHECKOUT_URL: 'javascript:alert(1)' }).show, 'only https checkout URLs are used');
  assert(!c({ LS_CHECKOUT_URL: ENV.LS_CHECKOUT_URL, DEMO_PROFILE: '1' }).show && c({ LS_CHECKOUT_URL: ENV.LS_CHECKOUT_URL, DEMO_PROFILE: '1', SHOW_BUY: '1' }).show,
    'demo profile (DEMO_PROFILE=1): hidden unless SHOW_BUY=1');
}

// ---------- Browser: the panel, presence/absence, no nag, "I have a key", /?thanks=1 ----------
async function browserTests({ adapter, ls }) {
  const DIST = path.join(__dirname, '..', 'dist', 'index.html');
  if (!fs.existsSync(DIST)) { origLog('– browser part skipped: run npm run build first'); return; }
  const { chromium } = require('playwright');
  const start = (env) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'klibb-pay-ui-'));
    const licenses = createLicenses({ adapter, env: { ...ENV, ...env }, fetch: ls.fetch, log: quietLog });
    const e = { ...ENV, ...env };
    const entitle = makeEntitlements(e, { licenses });
    const server = createApp(createStore(new LocalAdapter(dir)), { entitle, pay: payConfig(e), log: quietLog }).listen(0);
    const rt = attachRealtime(server, { maxPlayers: 5, heartbeatMs: 1000, entitle });
    return { base: `http://127.0.0.1:${server.address().port}`, close: () => { rt.close(); server.close(); } };
  };
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const servers = [];
  const open = async (base, q = '') => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage(); page.on('pageerror', (e) => origLog('sidfel (pay):', e.message));
    await page.goto(`${base}/${q}`);
    await page.waitForFunction(() => window.klibb && window.klibb.ready, null, { timeout: 20000 });
    await page.evaluate(() => window.klibb.entitlementsReady && window.klibb.entitlementsReady());
    await page.waitForTimeout(200);
    return page;
  };
  try {
    const shop = start({}); servers.push(shop);
    const noUrl = start({ LS_CHECKOUT_URL: '' }); servers.push(noUrl);
    const demo = start({ DEMO_PROFILE: '1' }); servers.push(demo);

    // Free visitor, shop configured: nothing visible until ⚙ More → Help; the panel never opens by itself.
    const p = await open(shop.base);
    const nag = await p.evaluate(() => ({ panel: !document.getElementById('full-panel').hidden, text: document.body.innerText }));
    assert(!nag.panel && !/full version|pay what|\$1/i.test(nag.text), 'free visitor: no popup, no "full version" text anywhere in the room UI');
    await p.evaluate(() => window.klibb.openMore());
    assert(await p.isVisible('#full-entry'), 'the quiet "★ Full version" entry is in ⚙ More → Help');
    const locked = await p.evaluate(() => ['sound-design-btn'].map((id) => document.getElementById(id).hidden));
    assert(locked.every(Boolean), 'no locked-feature teasers: Sound settings stays hidden for free players');
    await p.click('#full-entry');
    await p.waitForSelector('#full-panel', { state: 'visible' });
    const panel = await p.evaluate(() => ({ text: document.getElementById('full-panel').innerText, href: document.getElementById('full-buy-link').href,
      target: document.getElementById('full-buy-link').target, more: !document.getElementById('more-panel').hidden }));
    assert(/Fabrics/.test(panel.text) && /Sound design/.test(panel.text) && /Big stickers/.test(panel.text) && /more as it comes/.test(panel.text) && /from \$1/.test(panel.text)
      && panel.href.startsWith(ENV.LS_CHECKOUT_URL) && panel.target === '_blank' && !panel.more, 'the panel lists fabrics, sound design, big stickers, more coming; "Get the full version" opens LS_CHECKOUT_URL in a new tab');
    await p.screenshot({ path: path.join(os.tmpdir(), 'pay-panel.png') });
    // I have a key: wrong, then right
    await p.fill('#full-key', K.unknown); await p.click('#full-key-ok');
    await p.waitForFunction(() => /does not unlock/.test(document.getElementById('full-msg').textContent));
    assert(!(await p.evaluate(() => localStorage.getItem('klibb.unlock'))), 'a wrong key shows a calm message and is not stored');
    await p.fill('#full-key', K.good); await p.click('#full-key-ok');
    await p.waitForFunction(() => /Unlocked/.test(document.getElementById('full-msg').textContent));
    const after = await p.evaluate(() => ({ key: localStorage.getItem('klibb.unlock'), full: window.klibb.entitlements().full, status: !document.getElementById('full-status').hidden,
      buy: !document.getElementById('full-buy').hidden, sound: !document.getElementById('sound-design-btn').hidden }));
    assert(after.key === K.good && same(after.full, ALL) && after.status && !after.buy && after.sound, '"I have a key" with the LS key unlocks at once (stored like klibb.unlock; Sound settings appears)');
    await p.keyboard.press('Escape');
    assert(await p.isHidden('#full-panel'), 'Esc closes the panel');
    await p.context().close();

    // /?unlock=<lskey> and /?thanks=1#unlock=<lskey> (the LS thank-you button)
    const u = await open(shop.base, `?unlock=${K.good}`);
    assert(same(await u.evaluate(() => window.klibb.entitlements().full), ALL) && !(await u.evaluate(() => location.href)).includes(K.good), '/?unlock=<LS key> unlocks and leaves the address bar');
    await u.context().close();
    const t = await open(shop.base, `?thanks=1#unlock=${K.good}`);
    const th = await t.evaluate(() => ({ open: !document.getElementById('full-panel').hidden, title: document.getElementById('full-title').textContent, url: location.href, full: window.klibb.entitlements().full }));
    assert(th.open && th.title === 'Thank you!' && same(th.full, ALL) && !th.url.includes('thanks') && !th.url.includes(K.good), '/?thanks=1#unlock=<key>: thank-you panel, unlocked, clean address bar');
    await t.context().close();
    const t2 = await open(shop.base, '?thanks=1');
    assert(await t2.evaluate(() => !document.getElementById('full-panel').hidden && !document.getElementById('full-key-box').hidden), '/?thanks=1 without key: the panel asks for the key from the receipt');
    await t2.context().close();

    // No checkout URL ⇒ no entry. Demo profile ⇒ no entry (unless SHOW_BUY=1).
    for (const [name, srv] of [['no LS_CHECKOUT_URL', noUrl], ['demo profile', demo]]) {
      const q = await open(srv.base);
      await q.evaluate(() => window.klibb.openMore());
      const r = await q.evaluate(() => ({ entry: !document.getElementById('full-entry').hidden, panel: !document.getElementById('full-panel').hidden, text: document.body.innerText }));
      assert(!r.entry && !r.panel && !/full version/i.test(r.text), `${name}: no Full version entry, nothing about buying anywhere`);
      await q.context().close();
    }
    // The demo profile is the FREE version for everyone, keys included (Jens's demo brief: "disable
    // room editing and synth/sound settings, even for entitled keys"; server/entitlements.js). So a
    // key does nothing there and there is no status to find. Turn DEMO_PROFILE off and it all comes back.
    const k = await open(demo.base, `?unlock=${MANUAL}`);
    await k.evaluate(() => window.klibb.openMore());
    const kd = await k.evaluate(() => ({ full: Object.values(window.klibb.entitlements().full || {}).some(Boolean), entry: !document.getElementById('full-entry').hidden }));
    assert(!kd.full && !kd.entry, 'demo profile: even a valid key unlocks nothing (the free version for everyone), and nothing about buying shows');
    await k.context().close();
  } finally {
    for (const s of servers) s.close();
    await browser.close();
  }
}

(async () => {
  configTests();
  const ctx = await serverTests();
  await httpTests(ctx);
  await browserTests(ctx);
  const leaks = logged.filter((l) => Object.values(K).concat([MANUAL]).some((k) => l.toLowerCase().includes(k)));
  assert(leaks.length === 0 && logged.length > 0, `no key ever appears in a log line (${logged.length} lines checked)`);
  console.log('pay tests: all ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
