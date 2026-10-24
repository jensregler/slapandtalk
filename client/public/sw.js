// Minimal service worker: behövs för att appen ska kunna "installeras" på hemskärmen.
// Den cachar ingenting, allt hämtas direkt från nätet, så en ny version syns direkt.
// Om en äldre version någon gång har sparat något i en cache rensas det här.
const VERSION = 2;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).then(() => self.clients.claim()),
));
self.addEventListener('fetch', () => {});
