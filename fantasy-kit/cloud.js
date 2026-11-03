/* Fantasy Kit: shared leagues. Sign-in by emailed link (Supabase Auth) and calls to the league functions in
   tools/fantasykit_supabase.sql. Plain fetch, no client library.

   FK.cloud:
     user()                 { id, email } or null
     signIn(email, back)    emails a sign-in link that returns to `back` (a URL on this site)
     signOut()
     fromLink()             call once on load: picks up the tokens a sign-in link brings back, or its error
     rpc(name, args)        calls a league function as the signed-in user (or as a guest)
     now()                  the server's clock, give or take a request */
(function (root) {
  "use strict";
  const FK = (root.FK = root.FK || {});
  const BASE = "https://baxrczyufqbzrogftmyn.supabase.co";
  const KEY = "sb_publishable_brDXGevzcoI7mBaPO7Plow_yaUy4gk4";
  const SK = "fk-auth:session";
  let session = read(), refreshing = null, offset = 0;

  function read() { try { return JSON.parse(localStorage.getItem(SK)); } catch (e) { return null; } }
  function keep(s) { session = s; try { if (s) localStorage.setItem(SK, JSON.stringify(s)); else localStorage.removeItem(SK); } catch (e) { /* private mode */ } }
  // what's inside the access token: the user's id and email
  function claims(tok) {
    try { const p = tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(decodeURIComponent(escape(atob(p + "=".repeat((4 - (p.length % 4)) % 4))))); } catch (e) { return {}; }
  }
  const user = () => { if (!session) return null; const c = claims(session.access); return c.sub ? { id: c.sub, email: c.email || "" } : null; };

  // A sign-in link comes back as #access_token=...&refresh_token=...; take them and clean the address bar.
  function fromLink() {
    const h = location.hash.replace(/^#/, "");
    if (!/(^|&)(access_token|error_description)=/.test(h)) return null;
    const p = new URLSearchParams(h);
    history.replaceState(null, "", location.pathname + location.search);
    if (p.get("error_description")) return { error: p.get("error_description").replace(/\+/g, " ") };
    keep({ access: p.get("access_token"), refresh: p.get("refresh_token"), expires: Date.now() + (Number(p.get("expires_in")) || 3600) * 1000 });
    return { ok: true, user: user() };
  }

  async function auth(path, body, tok) {
    const r = await fetch(BASE + "/auth/v1/" + path, {
      method: "POST", headers: Object.assign({ apikey: KEY, "Content-Type": "application/json" }, tok ? { Authorization: "Bearer " + tok } : {}),
      body: JSON.stringify(body || {}),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j.msg || j.error_description || j.message || j.error || `Error ${r.status}`;
      const e = new Error(r.status === 429 ? "Too many sign-in emails. Wait a minute and try again." : msg);
      e.status = r.status; throw e;
    }
    return j;
  }
  async function signIn(email, back) {
    email = String(email || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("That doesn't look like an email address.");
    await auth("otp?redirect_to=" + encodeURIComponent(back || location.href.split("#")[0]), { email, create_user: true });
    try { localStorage.setItem("fk-auth:email", JSON.stringify(email)); } catch (e) { /* private mode */ }
  }
  async function signOut() {
    const s = session; keep(null);
    if (s) try { await auth("logout", {}, s.access); } catch (e) { /* signed out here either way */ }
  }
  // Tokens last an hour; trade the refresh token for new ones a minute before that.
  async function token() {
    if (!session) return null;
    if (Date.now() < session.expires - 60e3) return session.access;
    if (!refreshing) {
      refreshing = auth("token?grant_type=refresh_token", { refresh_token: session.refresh })
        .then((j) => { keep({ access: j.access_token, refresh: j.refresh_token, expires: Date.now() + (j.expires_in || 3600) * 1000 }); })
        .catch((e) => { if (e.status && e.status < 500) keep(null); })
        .finally(() => { refreshing = null; });
    }
    await refreshing;
    return session ? session.access : null;
  }

  async function rpc(name, args) {
    const tok = await token();
    const r = await fetch(`${BASE}/rest/v1/rpc/${name}`, {
      method: "POST", headers: Object.assign({ apikey: KEY, "Content-Type": "application/json" }, tok ? { Authorization: "Bearer " + tok } : {}),
      body: JSON.stringify(args || {}),
    });
    if (r.status === 401 && tok) { keep(null); throw new Error("You were signed out. Sign in again."); }
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error((j && (j.message || j.hint)) || `Error ${r.status}`);
    if (j && typeof j.now === "number") offset = j.now - Date.now();
    return j;
  }

  // the live box score feed (supabase/functions/fk-live): this week's totals so far, games in progress included
  const live = (sport) => fetch(`${BASE}/functions/v1/fk-live?sport=${encodeURIComponent(sport)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  FK.cloud = { user, signIn, signOut, fromLink, rpc, live, now: () => Date.now() + offset, lastEmail: () => { try { return JSON.parse(localStorage.getItem("fk-auth:email")) || ""; } catch (e) { return ""; } } };
})(typeof window !== "undefined" ? window : globalThis);
