/**
 * Vite replaces these markers with every emitted chunk and public file,
 * including both offline catalogues, plus a digest of their contents.
 * This source is a template; vite.config.ts writes the final dist/sw.js.
 */
const BUILD_ID = '__BUILD_ID__'
const PRECACHE = /* __PRECACHE__ */ ['./', './index.html']
const CACHE_PREFIX = 'omron-bp-v5:' + self.registration.scope + ':'
const CACHE = CACHE_PREFIX + BUILD_ID
const LEGACY_CACHE = 'omron-bp-v4'
const REVALIDATE = /\/(drugs|supplements)\.json$/

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    try {
      // addAll commits the complete response set or fails installation. Do not
      // let a stale HTTP cache supply content for this new application version.
      await cache.addAll(PRECACHE.map(url => new Request(new URL(url, self.registration.scope), { cache: 'reload' })))
      await self.skipWaiting()
    } catch (error) {
      await caches.delete(CACHE)
      throw error
    }
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    const ours = keys.filter(key => key.startsWith(CACHE_PREFIX))
    // A still-open page can request an old lazy chunk after skipWaiting. Keep
    // the previous version as well; never remove another application's cache.
    // The old unscoped v4 cache is left alone: it can contain another base path.
    const previous = ours.filter(key => key !== CACHE).at(-1)
    await Promise.all(ours.filter(key => key !== CACHE && key !== previous).map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})

async function previousResponse(request) {
  for (const key of await caches.keys()) {
    if (key !== CACHE && (key.startsWith(CACHE_PREFIX) || key === LEGACY_CACHE)) {
      const cached = await (await caches.open(key)).match(request)
      if (cached) return cached
    }
  }
}

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    // Keep online reloads fresh. Never overwrite an installed version's HTML
    // with a newer shell whose assets may not have finished downloading.
    event.respondWith(
      fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' })
        .then(response => {
          if (!response.ok) throw new Error('Navigation failed: ' + response.status)
          return response
        })
        .catch(() => caches.open(CACHE).then(cache => cache.match(new URL('./index.html', self.registration.scope)))),
    )
    return
  }

  const save = async response => {
    if (response.ok) {
      try {
        const cache = await caches.open(CACHE)
        await cache.put(request, response.clone())
      } catch { /* A full cache must not prevent a successful network response. */ }
    }
    return response
  }

  if (REVALIDATE.test(new URL(request.url).pathname)) {
    event.respondWith(caches.open(CACHE).then(async cache => {
      const cached = await cache.match(request)
      const fresh = fetch(request).then(save)
      if (!cached) return fresh
      event.waitUntil(fresh.catch(() => {}))
      return cached
    }))
    return
  }

  event.respondWith(caches.open(CACHE).then(async cache =>
    (await cache.match(request)) ?? (await previousResponse(request)) ?? fetch(request).then(save),
  ))
})
