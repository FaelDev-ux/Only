const CACHE_NAME = "bolo-de-mae-jp-pwa-v2";
const APP_SHELL = [
  "/",
  "/admin/",
  "/caixa/",
  "/manifest.webmanifest",
  "/logo.jpeg",
  "/icon-32.png",
  "/icon-180.png",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }

            return Promise.resolve();
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  const networkResponse = await fetch(request);

  if (networkResponse && networkResponse.status === 200 && networkResponse.type === "basic") {
    const responseToCache = networkResponse.clone();
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, responseToCache);
  }

  return networkResponse;
}

async function navigationResponse(request) {
  try {
    const networkResponse = await fetch(request);

    if (networkResponse && networkResponse.status === 200 && networkResponse.type === "basic") {
      const responseToCache = networkResponse.clone();
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, responseToCache);
    }

    return networkResponse;
  } catch (error) {
    const cachedRoute = await caches.match(request);

    if (cachedRoute) {
      return cachedRoute;
    }

    return caches.match("/");
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);

  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(navigationResponse(event.request));
    return;
  }

  event.respondWith(
    cacheFirst(event.request).catch(() => caches.match(event.request))
  );
});
