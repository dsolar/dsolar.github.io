/* Draft Lab's service worker (scope /fantasy-kit/): the app kept on this device so it opens on a bad connection or
   none, phone and computer alerts (web push), and opening the right league from one. Registered on every page by
   cloud.js.

   What it keeps, in caches named draft-lab-<VERSION>-*:
   - Pages (index, week, leagues, play, league): network first, so a deploy shows up on the next load. The saved copy
     answers when the network fails, or after PAGE_WAIT on a slow one. One copy per page, whatever its ?query.
   - data/*.json: network first, the saved copy when the network fails. Saved as they're used, not up front.
   - Scripts and stylesheets with a ?v=, and images and fonts, from this site: stale-while-revalidate. A new deploy's
     pages ask for new ?v= URLs, so new code arrives with the new page; an older ?v= of a file is dropped when the new
     one is saved. Scripts and stylesheets without a ?v= (the site's shared header files) are network first.
   - Never: other origins (Supabase, Google Fonts, analytics), anything that isn't a GET, or other site files.
   Install saves the pages and everything they load, read from the pages themselves, so the list here never goes
   stale. Bump VERSION to drop every saved copy: activate deletes the old caches. */
const VERSION = "1";
const PREFIX = "draft-lab-";
const SHELL = `${PREFIX}${VERSION}-shell`, DATA = `${PREFIX}${VERSION}-data`;
const PAGES = ["index.html", "week.html", "leagues.html", "play.html", "league.html"];
const PAGE_WAIT = 4000;
const STATIC = /\.(?:js|css|svg|png|jpe?g|webp|gif|ico|woff2?|webmanifest)$/i;
const MEDIA = /\.(?:svg|png|jpe?g|webp|gif|ico|woff2?)$/i;
const scope = () => new URL(self.registration.scope);
const inScope = (url) => url.origin === self.location.origin && url.pathname.startsWith(scope().pathname);
// one copy per page: "/fantasy-kit/" and "/fantasy-kit/index.html?s=nfl" are both index.html
const pageKey = (url) => new URL((url.pathname.endsWith("/") ? url.pathname + "index.html" : url.pathname), url.origin).href;
const isPage = (url) => inScope(url) && PAGES.includes(new URL(pageKey(url)).pathname.slice(scope().pathname.length));

// A response that followed a redirect can't answer a navigation, so keep a plain copy.
async function plain(res) {
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

// The pages, and the same-origin files they load: <script src>, <link href> and the "file.js?v=" list the pages'
// loader reads from.
async function precache() {
  const shell = await caches.open(SHELL);
  const files = new Set();
  await Promise.all(PAGES.map(async (p) => {
    const url = new URL(p, scope());
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) return;
      const html = await res.clone().text();
      await shell.put(pageKey(url), await plain(res));
      for (const m of html.matchAll(/(?:src|href)="([^"]+)"|"([^"\s]+\.(?:js|css)(?:\?[^"\s]*)?)"/g)) {
        const f = new URL((m[1] || m[2]).replace(/&amp;/g, "&"), url);
        if (f.origin === self.location.origin && STATIC.test(f.pathname)) files.add(f.href);
      }
    } catch (e) { /* offline: it fills in as pages are used */ }
  }));
  await Promise.all([...files].map((f) => shell.match(f).then((hit) => hit || fetch(f).then((r) => r.ok && shell.put(f, r))).catch(() => null)));
}

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(precache());
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith(PREFIX) && k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// network first: the network's answer (saved for next time), or the saved copy when it fails or takes longer than wait
function networkFirst(e, name, key, wait) {
  const net = fetch(e.request);
  // saving goes on after a slow network's answer lost to the saved copy (clone before the page reads the body)
  e.waitUntil(net.then(async (res) => {
    if (!res.ok || res.type !== "basic") return;
    const copy = await plain(res.clone());
    await caches.open(name).then((c) => c.put(key, copy));
    if (name === SHELL) await heal();
  }).catch(() => null));
  const saved = () => caches.open(name).then((c) => c.match(key, { ignoreSearch: name === DATA }));
  const fallback = () => saved().then((hit) => hit || net);
  if (!wait) return net.catch(fallback);
  return new Promise((resolve, reject) => {
    let done = false;
    const give = (r) => { if (!done) { done = true; resolve(r); } };
    const t = setTimeout(() => saved().then((hit) => hit && give(hit)), wait);
    net.then((r) => { clearTimeout(t); give(r); }, () => { clearTimeout(t); fallback().then(give, (err) => { if (!done) { done = true; reject(err); } }); });
  });
}

// stale-while-revalidate: the saved copy now and a fresh one saved behind it, or the network on a first visit
async function staleWhileRevalidate(e) {
  const req = e.request, cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  const net = fetch(req).then(async (res) => {
    if (res.ok && res.type === "basic") {
      await cache.put(req, res.clone());
      // a new ?v= of this file replaces the old ones
      const url = new URL(req.url);
      if (url.search) for (const k of await cache.keys()) { const u = new URL(k.url); if (u.pathname === url.pathname && u.search !== url.search) await cache.delete(k); }
    }
    return res;
  });
  if (hit) { e.waitUntil(net.catch(() => null)); return hit; }
  return net;
}

// Another app on this site can clear every cache on the origin; a page load online puts the shell back.
let healing = null;
function heal() {
  return healing || (healing = caches.open(SHELL).then((c) => c.keys()).then((ks) => (ks.length < PAGES.length * 2 ? precache() : null)).catch(() => null).then(() => { healing = null; }));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                                   // Supabase, fonts, analytics
  if (req.mode === "navigate" || isPage(url)) { if (isPage(url)) e.respondWith(networkFirst(e, SHELL, pageKey(url), req.mode === "navigate" ? PAGE_WAIT : 0)); return; }
  if (inScope(url) && /\/data\/[^/]+\.json$/.test(url.pathname)) { e.respondWith(networkFirst(e, DATA, url.href, 0)); return; }
  if (!STATIC.test(url.pathname)) return;
  e.respondWith(url.search || MEDIA.test(url.pathname) ? staleWhileRevalidate(e) : networkFirst(e, SHELL, url.href, 0));
});

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
