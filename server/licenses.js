// Paid full version through Lemon Squeezy (LS, merchant of record: VAT, cards, PayPal, Apple/Google Pay).
// A buyer gets an LS license key (receipt e-mail, or straight back to /?thanks=1&unlock=<key>).
// The browser treats it exactly like a manual FULL_ACCESS_KEYS key (localStorage "klibb.unlock");
// here we decide whether it is a real, paid, not-refunded key for OUR product.
//
//   validate   POST https://api.lemonsqueezy.com/v1/licenses/validate  (license_key=…)
//              valid + meta.store_id = LS_STORE_ID + meta.product_id = LS_PRODUCT_ID
//              + status active/inactive (not disabled/expired) + order not refunded  =>  full version.
//   activate   A key that has never been activated (status "inactive") is activated ONCE with
//              instance_name "slapandtalk.com", so it shows as used in the LS dashboard. Best effort;
//              the server never activates per browser (no activation-limit surprises). LS_ACTIVATE=0 turns it off.
//   webhook    order_created / order_refunded / license_key_created / license_key_updated keep the
//              cache right without waiting for a revalidation (see app.js POST /api/ls/webhook).
//
// Cache: memory + storage "entitlements/<sha256(key)>.json" (no key, no e-mail, just the verdict and ids),
// and "ls-orders/<orderId>.json" ({ refunded, keyHashes }) so a refund can lock the order's keys.
// A paid verdict is re-checked with LS after LS_REVALIDATE_HOURS (24) in the background; meanwhile the
// cached verdict holds (LS being down never locks a buyer out). Unknown/garbage keys are only cached
// in memory (short), never written. Keys are never logged; logs use the first 8 hex of the hash.
const crypto = require('crypto');

const API = 'https://api.lemonsqueezy.com/v1/licenses';
const LS_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OK_STATUS = new Set(['active', 'inactive']);
const normKey = (k) => String(k || '').trim().toLowerCase();
const hashKey = (k) => crypto.createHash('sha256').update(normKey(k)).digest('hex');
const isLsKey = (k) => typeof k === 'string' && LS_KEY_RE.test(k.trim());
const num = (v) => (v === undefined || v === null || v === '' ? null : String(v));

function createLicenses({
  adapter = null, env = process.env, fetch: fetchFn = globalThis.fetch, clock = () => Date.now(), log = console,
} = {}) {
  const storeId = num(env.LS_STORE_ID), productId = num(env.LS_PRODUCT_ID);
  const enabled = !!(storeId && productId);
  const revalidateMs = Math.max(0.01, Number(env.LS_REVALIDATE_HOURS || 24)) * 3600_000;
  const NEG_MS = 10 * 60_000, NEG_MAX = 5000, TIMEOUT_MS = 8000;
  const activate = env.LS_ACTIVATE !== '0';

  const mem = new Map();      // hash -> record (paid or locked)
  const neg = new Map();      // hash -> until (not a key for us: don't ask LS again for a while)
  const inflight = new Map(); // hash -> Promise<record|null>
  const orders = new Map();   // orderId -> { refunded, keyHashes }
  const stats = { validations: 0, apiErrors: 0 };
  const tag = (h) => h.slice(0, 8);

  const readJson = async (key) => { if (!adapter) return null; try { const b = await adapter.get(key); return b ? JSON.parse(b.toString('utf8')) : null; } catch { return null; } };
  const writeJson = async (key, v) => { if (!adapter) return; try { await adapter.put(key, Buffer.from(JSON.stringify(v)), 'application/json'); } catch (e) { log.error(`[ls] could not save ${key.split('/')[0]}: ${e.message}`); } };
  const recKey = (h) => `entitlements/${h}.json`;
  const orderKey = (id) => `ls-orders/${id}.json`;

  async function getOrder(id) {
    if (!id) return null;
    if (orders.has(id)) return orders.get(id);
    const o = await readJson(orderKey(id));
    if (o) orders.set(id, o);
    return o;
  }
  async function saveOrder(id, patch) {
    const o = { refunded: false, keyHashes: [], ...(await getOrder(id) || {}), ...patch, updatedAt: new Date(clock()).toISOString() };
    o.keyHashes = [...new Set(o.keyHashes)].slice(-50);
    orders.set(id, o); await writeJson(orderKey(id), o); return o;
  }
  async function saveRecord(h, rec) {
    mem.set(h, rec); neg.delete(h);
    await writeJson(recKey(h), rec);
    if (rec.orderId) {
      const o = await getOrder(rec.orderId);
      if (!o || !o.keyHashes.includes(h)) await saveOrder(rec.orderId, { keyHashes: [...((o && o.keyHashes) || []), h] });
    }
    return rec;
  }
  const ours = (sid, pid) => num(sid) === storeId && num(pid) === productId;

  // One LS License API call (form-encoded, like their docs). Returns parsed JSON + status, throws on network/5xx.
  async function call(path, form) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchFn(`${API}/${path}`, {
        method: 'POST', signal: ctl.signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
      });
      if (res.status >= 500 || res.status === 429) throw new Error(`LS ${path} HTTP ${res.status}`);
      let body = {}; try { body = await res.json(); } catch { /* empty */ }
      return { status: res.status, body };
    } finally { clearTimeout(t); }
  }

  // Ask LS. Returns the new record, or null when the key is simply not one of ours (unknown/foreign).
  async function validateNow(key, h) {
    stats.validations++;
    const { body } = await call('validate', { license_key: normKey(key) });
    const meta = body.meta || {}, lk = body.license_key || {};
    if (!meta.store_id || !ours(meta.store_id, meta.product_id)) return null; // unknown key or another product
    const orderId = num(meta.order_id), order = await getOrder(orderId);
    const status = String(lk.status || (body.valid ? 'active' : 'unknown'));
    let ok = body.valid === true && OK_STATUS.has(status) && !(order && order.refunded);
    const reason = ok ? null : (order && order.refunded ? 'refunded' : (OK_STATUS.has(status) ? 'invalid' : status));
    const rec = { v: 1, ok, status, reason, storeId: num(meta.store_id), productId: num(meta.product_id), orderId, licenseId: num(lk.id), source: 'validate', checkedAt: clock() };
    if (ok && activate && status === 'inactive' && !(Number(lk.activation_usage) > 0)) {
      try {
        const a = await call('activate', { license_key: normKey(key), instance_name: 'slapandtalk.com' });
        if (a.body && a.body.activated) rec.status = 'active';
      } catch { /* best effort */ }
    }
    if (!ok) log.log(`[ls] key ${tag(h)} locked (${rec.reason})`);
    return saveRecord(h, rec);
  }

  function refresh(key, h) {
    if (inflight.has(h)) return inflight.get(h);
    const p = validateNow(key, h)
      .then((rec) => {
        if (!rec) { if (neg.size >= NEG_MAX) neg.delete(neg.keys().next().value); neg.set(h, clock() + NEG_MS); }
        return rec;
      })
      .catch((e) => { stats.apiErrors++; log.error(`[ls] validation of ${tag(h)} failed: ${e.message}`); return mem.get(h) || null; })
      .finally(() => inflight.delete(h));
    inflight.set(h, p);
    return p;
  }

  // Sync: what we know right now (memory only). true = paid & fine.
  function peek(key) {
    if (!enabled || !isLsKey(key)) return false;
    const r = mem.get(hashKey(key));
    return !!(r && r.ok);
  }

  // Async: make sure we know (memory → storage → LS). Stale paid verdicts refresh in the background.
  async function ensure(key) {
    if (!enabled || !isLsKey(key)) return false;
    const h = hashKey(key);
    let r = mem.get(h);
    if (!r) {
      const until = neg.get(h);
      if (until && until > clock()) return false;
      r = await readJson(recKey(h));
      if (r) mem.set(h, r);
    }
    if (!r) { r = await refresh(key, h); return !!(r && r.ok); }
    if (clock() - (r.checkedAt || 0) > revalidateMs && r.reason !== 'refunded') refresh(key, h); // background
    return !!r.ok;
  }

  // ---------- Webhooks (already signature-checked by the caller) ----------
  async function lockOrder(orderId) {
    const o = await saveOrder(orderId, { refunded: true });
    let n = 0;
    for (const h of o.keyHashes) {
      const r = mem.get(h) || await readJson(recKey(h));
      if (!r) continue;
      await saveRecord(h, { ...r, ok: false, reason: 'refunded', source: 'webhook', checkedAt: clock() }); n++;
    }
    for (const [h, r] of mem) if (r.orderId === orderId && r.ok) { await saveRecord(h, { ...r, ok: false, reason: 'refunded', source: 'webhook', checkedAt: clock() }); n++; }
    return n;
  }

  async function handleWebhook(event, payload) {
    const data = (payload && payload.data) || {}, a = data.attributes || {};
    if (event === 'order_created' || event === 'order_refunded') {
      const pid = a.first_order_item && a.first_order_item.product_id;
      if (!ours(a.store_id, pid)) return { ignored: 'other product' };
      const orderId = num(data.id);
      const fullRefund = a.status === 'refunded' || (a.refunded === true && a.status !== 'partial_refund');
      if (event === 'order_refunded' || fullRefund) {
        if (!fullRefund) { await saveOrder(orderId, { status: a.status || 'partial_refund' }); return { order: orderId, partial: true }; }
        const locked = await lockOrder(orderId);
        log.log(`[ls] order ${orderId} refunded, ${locked} key(s) locked`);
        return { order: orderId, refunded: true, locked };
      }
      await saveOrder(orderId, { status: a.status || 'paid', refunded: false, total_usd: a.total_usd ?? null });
      return { order: orderId, paid: true };
    }
    if (event === 'license_key_created' || event === 'license_key_updated') {
      if (!ours(a.store_id, a.product_id)) return { ignored: 'other product' };
      if (!isLsKey(a.key)) return { ignored: 'no key' };
      const h = hashKey(a.key), orderId = num(a.order_id), order = await getOrder(orderId);
      const status = String(a.status || 'active'), disabled = !!a.disabled;
      const ok = !disabled && OK_STATUS.has(status) && !(order && order.refunded);
      const reason = ok ? null : (order && order.refunded ? 'refunded' : (disabled ? 'disabled' : status));
      await saveRecord(h, { v: 1, ok, status, reason, storeId: num(a.store_id), productId: num(a.product_id), orderId, licenseId: num(data.id), source: 'webhook', checkedAt: clock() });
      return { key: tag(h), ok };
    }
    return { ignored: event || 'no event' };
  }

  // Admin: how many paid keys are currently good (no keys, only counts).
  async function counts() {
    const recs = new Map(mem);
    if (adapter) {
      let names = []; try { names = await adapter.list('entitlements/'); } catch { /* storage down */ }
      for (const k of names) {
        const h = (/entitlements\/([a-f0-9]{64})\.json$/.exec(k) || [])[1];
        if (h && !recs.has(h)) { const r = await readJson(k); if (r) recs.set(h, r); }
      }
    }
    let active = 0, locked = 0;
    for (const r of recs.values()) if (r.ok) active++; else locked++;
    return { active, locked };
  }

  return { enabled, peek, ensure, handleWebhook, counts, stats, isLsKey, hashKey, _mem: mem };
}

// LS signs the raw body: X-Signature = hex(HMAC-SHA256(secret, rawBody)).
function verifySignature(secret, raw, signature) {
  if (!secret || !Buffer.isBuffer(raw) || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const digest = Buffer.from(crypto.createHmac('sha256', secret).update(raw).digest('hex'), 'utf8');
  const sig = Buffer.from(signature.toLowerCase(), 'utf8');
  return digest.length === sig.length && crypto.timingSafeEqual(digest, sig);
}

module.exports = { createLicenses, verifySignature, hashKey, isLsKey, LS_KEY_RE };
