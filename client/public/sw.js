// Minimal service worker: behövs för att appen ska kunna "installeras" på hemskärmen.
// Den cachar ingenting än, allt hämtas direkt från nätet.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
