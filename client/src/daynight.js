// Day or night in the city (Jens, t864u, 12 Nov 2026): day is the default again; the Esc menu's DAY / NIGHT
// button flips it. Each player's own choice (it is only the look – nothing changes for the others), kept in
// this browser (localStorage klibb.cityTime) so the city looks the same next time.
const KEY = 'klibb.cityTime';
export const cityTime = () => { try { return localStorage.getItem(KEY) === 'night' ? 'night' : 'day'; } catch { return 'day'; } };
export function setCityTime(t) {
  const v = t === 'night' ? 'night' : 'day';
  try { localStorage.setItem(KEY, v); } catch { /* private mode: this visit only */ }
  return v;
}
export const toggleCityTime = () => setCityTime(cityTime() === 'night' ? 'day' : 'night');
