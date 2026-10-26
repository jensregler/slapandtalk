// Outgoing email, behind one tiny interface so the provider can be swapped:
//   mailer.enabled              -> true when a provider is configured
//   mailer.send({ to, subject, text }) -> resolves { id } or throws
//
// Today: Resend (https://resend.com), plain HTTP API, no SDK.
//   RESEND_API_KEY  the API key (secret, set it in Render only)
//   MAIL_FROM       the sender, e.g. "Slap and Talk <video@slapandtalk.com>"
//                   (its domain must be verified in Resend: DNS records at the registrar)
//   RESEND_API_URL  optional, only for tests (a local mock)
// No key or no MAIL_FROM = no email at all: the client then only offers "Copy link".
// Plain-text mails only: no HTML, so no tracking pixels and no rewritten links.
function createMailer(env = process.env, { fetchImpl = globalThis.fetch, log = console } = {}) {
  const key = String(env.RESEND_API_KEY || '').trim();
  const from = String(env.MAIL_FROM || '').trim();
  if (!key || !from) return { enabled: false, provider: null, async send() { throw Object.assign(new Error('Email is not configured'), { code: 'NOMAIL' }); } };
  const url = String(env.RESEND_API_URL || 'https://api.resend.com/emails');
  return {
    enabled: true,
    provider: 'resend',
    async send({ to, subject, text }) {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text }),
        signal: AbortSignal.timeout ? AbortSignal.timeout(15_000) : undefined,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        log.error(`[mail] Resend answered ${res.status}: ${body && (body.message || body.name) ? body.message || body.name : ''}`);
        throw Object.assign(new Error('The email could not be sent'), { code: 'SEND', status: res.status });
      }
      return { id: body.id || null };
    },
  };
}

// A sane address: one @, a dot in the domain, no spaces or control chars, ≤ 254 chars.
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
function cleanEmail(v) {
  if (typeof v !== 'string') return null;
  const e = v.trim();
  if (e.length < 6 || e.length > 254 || !EMAIL_RE.test(e) || e.includes('..')) return null;
  if (!/\.[A-Za-z]{2,}$/.test(e)) return null;
  return e;
}

module.exports = { createMailer, cleanEmail };
