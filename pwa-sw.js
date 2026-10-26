const CACHE_VERSION = "jokstream-v1";
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_SHELL_CACHE);
    await Promise.all(APP_SHELL.map(async (url) => {
      try {
        const response = await fetch(url, { cache: "reload" });
        if (response.ok && response.type === "basic") await cache.put(url, response);
      } catch (_) {
        // A missing optional asset must not prevent the worker from installing.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith("jokstream-") &&
        key !== APP_SHELL_CACHE && key !== STATIC_CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Do not cache live streams, playlist segments, or chat/API data.
  if (/\.(m3u8|mpd|ts|m4s|mp4|m4a|aac|mp3|key)$/i.test(url.pathname) ||
      /\/(api|publicChat)(\/|$)/i.test(url.pathname)) return;

  if (request.mode === "navigate" || url.pathname.endsWith("/index.html")) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && response.type === "basic") {
          const cache = await caches.open(APP_SHELL_CACHE);
          await cache.put("./index.html", response.clone());
        }
        return response;
      } catch (_) {
        return (await caches.match(request)) ||
          (await caches.match("./index.html")) ||
          new Response("JokStream is offline. Please reconnect to the internet.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" }
          });
      }
    })());
    return;
  }

  if (/\.(css|js|png|jpg|jpeg|webp|svg|woff2?)$/i.test(url.pathname) ||
      url.pathname.endsWith("/manifest.json")) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok && response.type === "basic") {
          const cache = await caches.open(STATIC_CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      } catch (_) {
        return new Response("Asset unavailable offline.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      }
    })());
  }
});
