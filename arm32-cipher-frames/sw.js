/* Serves a private demo's files from Cache Storage, where unlock.js put
 * them after decrypting bundle.bin in this browser. Registered with scope
 * SLUG/app/; nothing under app/ exists on the server. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!url.href.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    let key = url.origin + url.pathname;
    if (key.endsWith('/')) key += 'index.html';
    const hit = await caches.match(key);
    if (hit) return hit;
    return new Response('<!doctype html><meta charset="utf-8"><title>Locked</title>' +
      '<p style="font:15px system-ui;margin:2em">This private demo is locked in this browser. <a href="../">Unlock it</a>.</p>',
      { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  })());
});
