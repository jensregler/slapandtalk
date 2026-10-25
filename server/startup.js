// Start-hjälp som ser till att lagringsfel (t.ex. att R2 inte svarar eller TLS-fel)
// aldrig kraschar servern: de loggas tydligt och servern startar ändå.
// Rum som inte kan läsas blir tomma tills lagringen fungerar igen.

function describe(e) {
  if (!e) return String(e);
  const bits = [e.name, e.code, e.message].filter(Boolean);
  const st = e.$metadata && e.$metadata.httpStatusCode;
  if (st) bits.push(`HTTP ${st}`);
  return [...new Set(bits)].join(': ');
}

// Kör ett lagringssteg vid start; fel loggas och ersätts med fallback.
async function safeStep(label, fn, { log = console, fallback = null } = {}) {
  try { return await fn(); } catch (e) {
    log.error(`[lagring] ${label} misslyckades – servern kör vidare utan det: ${describe(e)}`);
    return fallback;
  }
}

// Snabb kontroll att lagringen svarar (listar en nyckel-prefix). Kastar aldrig.
async function checkStorage(adapter, { log = console, timeoutMs = 10_000 } = {}) {
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`inget svar inom ${timeoutMs} ms`)), timeoutMs); });
  try {
    await Promise.race([adapter.list('rooms/'), timeout]);
    log.log(`[lagring] ${adapter.kind} svarar`);
    return true;
  } catch (e) {
    log.error(`[lagring] ${adapter.kind} svarar inte (${describe(e)}). Kontrollera STORAGE/S3_*-variablerna; servern kör vidare.`);
    return false;
  } finally { clearTimeout(timer); }
}

// Process-vakter: ett missat promise-fel (t.ex. från AWS SDK) loggas i stället för att döda processen.
function installProcessGuards({ log = console, proc = process } = {}) {
  const onRejection = (reason) => log.error(`[process] Ohanterat promise-fel (servern kör vidare): ${describe(reason)}`, reason && reason.stack ? `\n${reason.stack}` : '');
  proc.on('unhandledRejection', onRejection);
  return onRejection;
}

module.exports = { safeStep, checkStorage, installProcessGuards, describe };
