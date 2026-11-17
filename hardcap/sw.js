/* Hard Cap's old app is retired (it's a mode in Draft Lab now). This worker replaces the old one for anyone who
   installed it: it clears Hard Cap's caches, unregisters itself and reloads open pages, which then redirect. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith("hardcap-")).map((k) => caches.delete(k))))
    .then(() => self.registration.unregister())
    .then(() => self.clients.matchAll({ type: "window" }))
    .then((cs) => cs.forEach((c) => c.navigate(c.url))));
});
