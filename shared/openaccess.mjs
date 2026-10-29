// OPEN ACCESS – the ONE switch that opens the whole app for everyone (Jens, 29 Oct 2026: "full
// access to the entire app while I test; the restrictions come back later").
//
//   true  = everyone has every full-version feature (fabrics, sound design, big stickers 5 cm – no
//           max, the Nature wheel + Nature mode on V, clean videos/photos, several cameramen …);
//           the "Full version" panel, its ⚙ More entry, the 🔒 locks and the "part of the full
//           version" toasts are all gone.
//   false = the normal free/full split (the paywall code is all still there, untouched).
//
// REVERT: set OPEN_ACCESS below to false (one line), or on the server only: env OPEN_ACCESS=0
// (the browser follows the server: /api/entitlements says { open }).
// Not affected: the room limit (4 people, one wall each: not a paid tier) and the demo profile's
// own rules (no uploads, room timer).
export const OPEN_ACCESS = true;

// env value → on/off; unset/empty = the constant above. "0", "false", "off", "no" = off.
export function openAccessFrom(value, fallback = OPEN_ACCESS) {
  if (value == null || value === '') return fallback;
  return !['0', 'false', 'off', 'no'].includes(String(value).trim().toLowerCase());
}
