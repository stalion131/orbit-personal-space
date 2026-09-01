const SHELL_CACHE = 'orbit-shell-v1';
const SHELL = ['/favicon.svg', '/icons/orbit-192.png', '/icons/orbit-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== SHELL_CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || event.request.mode === 'navigate') return;
  if (!SHELL.includes(url.pathname)) return;
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request)));
});
