/* Service worker minimal: TANPA cache (state game selalu dari server).
   Hanya ada agar browser menganggap game ini dapat dipasang sebagai aplikasi layar penuh. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* biarkan jaringan menangani */ });
