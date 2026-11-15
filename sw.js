// Service worker: keeps the app shell on the phone so a cold open works with no signal.
//
// Same-origin GETs and the supabase-js module from the CDN are served
// stale-while-revalidate: the cached copy at once, the network copy saved for next time
// (so a published update shows after one more reload). Everything else, including every
// request to the Supabase API (another origin) and every non-GET, goes straight to the
// network and is never cached. All URLs are relative to this file, so the app works
// from a GitHub Pages sub-path; the scope is this file's directory.
const CACHE = 'gym-shell-v1';
const CDN_ORIGIN = 'https://cdn.jsdelivr.net';
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/config.js',
  'js/default-routine.js',
  'js/logic.js',
  'js/queue.js',
  'js/store.js',
  'js/sync.js',
  'js/timer.js',
  'js/views/progress.js',
  'js/views/routine.js',
  'js/views/workout.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL.map(path => new Request(path, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function cacheable(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) return true;
  // supabase-js and the modules it imports; never the Supabase API itself.
  return url.origin === CDN_ORIGIN && url.pathname.startsWith('/npm/@supabase/');
}

async function staleWhileRevalidate(event) {
  const { request } = event;
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(response => {
      if (response.ok && (response.type === 'basic' || response.type === 'cors')) {
        return cache.put(request, response.clone()).then(() => response, () => response);
      }
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const response = await network;
  if (response) return response;
  // Offline and not cached: a page load still gets the app shell.
  if (request.mode === 'navigate') {
    const shell = await cache.match('index.html');
    if (shell) return shell;
  }
  return Response.error();
}

self.addEventListener('fetch', event => {
  if (!cacheable(event.request)) return;
  event.respondWith(staleWhileRevalidate(event));
});
