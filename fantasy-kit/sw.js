/* Draft Lab's service worker: phone and computer alerts (web push) and opening the right league from one. It caches
   nothing, so every page and every league is always the live one. Scope: /fantasy-kit/. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (err) { m = { title: "Draft Lab", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(m.title || "Draft Lab", {
    body: m.body || "", icon: "icon-192.png", badge: "badge-72.png", tag: m.tag || undefined, renotify: !!m.tag, data: { url: m.url || "leagues.html" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "leagues.html", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.split("#")[0] === url.split("#")[0] && "focus" in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
