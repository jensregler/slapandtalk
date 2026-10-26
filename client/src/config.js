// What the server says this site is (GET /api/config): the normal app, or the demo profile
// (DEMO_PROFILE=1 on the server: the free version for the Thursday demo, see server/demo.js).
// Loaded once by boot.js before the room starts; every module reads the same object.
export const config = { demo: false };
export async function loadConfig({ timeoutMs = 4000 } = {}) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = setTimeout(() => ctl && ctl.abort(), timeoutMs);
  try {
    const r = await fetch('/api/config', { cache: 'no-store', ...(ctl ? { signal: ctl.signal } : {}) });
    if (r.ok) Object.assign(config, await r.json());
  } catch { /* offline or an old server: the normal app */ } finally { clearTimeout(t); }
  return config;
}
