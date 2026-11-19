// "Under construction" (Jens t982u): server/maintenance.js swaps ONLY the HTML pages, only on Render (or MAINTENANCE=1).
const assert = require('node:assert/strict');
const { maintenance, maintenanceOn } = require('../server/maintenance');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const run = (path, { method = 'GET', query = {}, cookie = '' } = {}) => {
  const out = { next: false, body: null, headers: {} };
  const res = { status() { return res; }, setHeader(k, v) { out.headers[k.toLowerCase()] = v; return res; }, type() { return res; }, send(b) { out.body = b; return res; } };
  maintenance({ method, path, query, headers: { cookie } }, res, () => { out.next = true; });
  return out;
};
const env = (e, fn) => { const keep = { ...process.env }; Object.assign(process.env, e); for (const k of Object.keys(e)) if (e[k] === undefined) delete process.env[k]; try { fn(); } finally { process.env = keep; } };
ok('off by default outside Render (tests, dev, Jens\'s PC in local mode)', () => env({ RENDER: undefined, MAINTENANCE: undefined }, () => { assert.equal(maintenanceOn(), false); assert.equal(run('/').next, true); }));
ok('local mode is never affected, even on a box with RENDER set', () => env({ RENDER: 'true', LOCAL_MODE: '1', MAINTENANCE: undefined }, () => assert.equal(maintenanceOn(), false)));
ok('on Render: / and app routes get the page; API, uploads, assets, POST pass through', () => env({ RENDER: 'true', LOCAL_MODE: undefined, MAINTENANCE: undefined }, () => {
  for (const p of ['/', '/index.html', '/stad', '/r/abc']) { const r = run(p); assert.equal(r.next, false, p); assert.match(r.body, /Under construction – back soon/); assert.match(r.body, /\/icons\/icon-512\.png/); }
  for (const p of ['/api/rooms', '/uploads/x.webp', '/assets/index-x.js', '/icons/icon-512.png', '/slap-radio/a.mp3', '/sw.js']) assert.equal(run(p).next, true, p);
  assert.equal(run('/', { method: 'POST' }).next, true);
}));
ok('preview: ?preview=1 lets this browser in (cookie), ?preview=0 shows the page again', () => env({ RENDER: 'true', LOCAL_MODE: undefined, MAINTENANCE: undefined }, () => {
  const a = run('/', { query: { preview: '1' } }); assert.equal(a.next, true); assert.match(a.headers['set-cookie'], /sat_preview=1/);
  assert.equal(run('/', { cookie: 'x=1; sat_preview=1' }).next, true);
  const c = run('/', { query: { preview: '0' }, cookie: 'sat_preview=1' }); assert.equal(c.next, false); assert.match(c.headers['set-cookie'], /Max-Age=0/);
}));
ok('MAINTENANCE env wins: 0 turns it off on Render, 1 turns it on anywhere', () => {
  env({ RENDER: 'true', MAINTENANCE: '0' }, () => assert.equal(maintenanceOn(), false));
  env({ RENDER: undefined, MAINTENANCE: '1' }, () => assert.equal(maintenanceOn(), true));
});
console.log(`maintenance: ${n} ok`);
