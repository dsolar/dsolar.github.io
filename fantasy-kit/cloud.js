/* Fantasy Kit: shared leagues. Sign-in by emailed link (Supabase Auth) and calls to the league functions in
   tools/fantasykit_supabase.sql. Plain fetch, no client library.

   FK.cloud:
     user()                 { id, email } or null
     signIn(email, back)    emails a sign-in link that returns to `back` (a URL on this site)
     signUp({ username, email, password, back })  makes an account; { signedIn } or { confirm } (check your email)
     passwordSignIn(login, password)  a username or email and its password (usernames go through fk-login)
     resetPassword(login, back)       emails a link that comes back with { recovery: true } from fromLink()
     setPassword(password)  sets or changes the signed-in account's password
     signOut()
     oauth(provider, back)  signs in with Google or Apple (when providers() says it's on), back to `back`
     providers()            Promise of { google, apple }: which outside sign-ins are switched on
     token()                the signed-in user's access token, refreshed when it's about to run out
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
  const user = () => { if (!session) return null; const c = claims(session.access); return c.sub ? { id: c.sub, email: c.email || "", username: (c.user_metadata && (c.user_metadata.username || c.user_metadata.full_name || c.user_metadata.name)) || "" } : null; };

  // A sign-in link comes back as #access_token=...&refresh_token=...; take them and clean the address bar.
  function fromLink() {
    const h = location.hash.replace(/^#/, "");
    if (!/(^|&)(access_token|error_description)=/.test(h)) return null;
    const p = new URLSearchParams(h);
    history.replaceState(null, "", location.pathname + location.search);
    if (p.get("error_description")) return { error: p.get("error_description").replace(/\+/g, " ") };
    keep({ access: p.get("access_token"), refresh: p.get("refresh_token"), expires: Date.now() + (Number(p.get("expires_in")) || 3600) * 1000 });
    // a password reset link signs you in so you can pick a new one; a confirmation link (sign up) just signs you in
    return { ok: true, user: user(), recovery: p.get("type") === "recovery", signup: p.get("type") === "signup" };
  }

  async function auth(path, body, tok, method) {
    const r = await fetch(BASE + "/auth/v1/" + path, {
      method: method || "POST", headers: Object.assign({ apikey: KEY, "Content-Type": "application/json" }, tok ? { Authorization: "Bearer " + tok } : {}),
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
  const fromTokens = (j) => keep({ access: j.access_token, refresh: j.refresh_token, expires: Date.now() + (j.expires_in || 3600) * 1000 });
  const remember = (email) => { try { localStorage.setItem("fk-auth:email", JSON.stringify(email)); } catch (e) { /* private mode */ } };
  const USERNAME = /^[A-Za-z0-9_.-]{3,20}$/;
  function passwordOk(pw) { if (String(pw || "").length < 8) throw new Error("Use at least 8 characters for your password."); }
  async function fn(name, body) {
    const r = await fetch(`${BASE}/functions/v1/${name}`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || `Error ${r.status}`);
    return j;
  }
  // a new account with a username and password; the email is for league alerts and resetting the password
  async function signUp(o) {
    const username = String(o.username || "").trim(), email = String(o.email || "").trim();
    if (!USERNAME.test(username)) throw new Error("Use 3 to 20 letters, numbers, dots, dashes or underscores for your username.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("That doesn't look like an email address.");
    passwordOk(o.password);
    const free = await rpc("fk_username_free", { p_username: username });
    if (!free || !free.ok) throw new Error((free && free.why) || "That username is taken.");
    const j = await auth("signup?redirect_to=" + encodeURIComponent(o.back || location.href.split("#")[0]), { email, password: o.password, data: { username } });
    remember(email);
    if (j.access_token) { fromTokens(j); return { signedIn: true }; }
    // an email that already has an account comes back with no identities and no email is sent
    const u = j.user || j;
    if (u && Array.isArray(u.identities) && !u.identities.length) throw new Error("That email already has an account. Sign in, or reset your password.");
    return { confirm: true, email };
  }
  async function passwordSignIn(login, password) {
    login = String(login || "").trim();
    if (!login || !password) throw new Error("Enter your username and password.");
    const j = login.includes("@")
      ? await auth("token?grant_type=password", { email: login, password }).catch((e) => { throw new Error(/confirm/i.test(e.message) ? "Confirm your email first: tap the link we sent when you made the account." : e.status === 429 ? "Too many tries. Wait a minute and try again." : "Wrong email or password."); })
      : await fn("fk-login", { action: "login", login, password });
    fromTokens(j);
    if (login.includes("@")) remember(login);
    return { ok: true, user: user() };
  }
  async function resetPassword(login, back) {
    login = String(login || "").trim();
    if (!login) throw new Error("Enter your username or email.");
    await fn("fk-login", { action: "reset", login, redirect: back || location.href.split("#")[0] });
  }
  async function setPassword(password) {
    passwordOk(password);
    const tok = await token();
    if (!tok) throw new Error("Sign in first.");
    await auth("user", { password }, tok, "PUT").catch((e) => { throw new Error(/different from the old/i.test(e.message) ? "That's your current password. Pick a new one." : e.message); });
  }
  // Google or Apple: off to the provider and back to `back` with the same #access_token a sign-in link brings
  function oauth(provider, back) {
    location.href = `${BASE}/auth/v1/authorize?provider=${encodeURIComponent(provider)}&redirect_to=${encodeURIComponent(back || location.href.split("#")[0])}`;
  }
  // which of those are switched on in Supabase: { google: true, apple: false }
  let provP = null;
  const providers = () => (provP = provP || fetch(`${BASE}/auth/v1/settings`, { headers: { apikey: KEY } }).then((r) => (r.ok ? r.json() : {})).then((j) => ({ google: !!(j.external && j.external.google), apple: !!(j.external && j.external.apple) })).catch(() => ({ google: false, apple: false })));
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
  // this NFL week's games and next week's, for one-week slates (fk-live ?slates=1); kept for the page's life
  // basketball's are today's and tomorrow's games, each day shaped like a week with a day (fk-live ?sport=nba&slates=1)
  const slatesP = {};
  const slates = (sport = "nfl") => (slatesP[sport] = slatesP[sport] || fetch(`${BASE}/functions/v1/fk-live?sport=${encodeURIComponent(sport)}&slates=1`).then((r) => (r.ok ? r.json() : { weeks: [] })).catch(() => { slatesP[sport] = null; return { weeks: [] }; }));
  // named games' box scores and states, for a one-day league (fk-live ?games=)
  const games = (sport, ids) => (ids && ids.length ? fetch(`${BASE}/functions/v1/fk-live?sport=${encodeURIComponent(sport)}&games=${ids.map(encodeURIComponent).join(",")}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null));
  const live = (sport) => fetch(`${BASE}/functions/v1/fk-live?sport=${encodeURIComponent(sport)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  FK.cloud = { token, oauth, providers, slates, games, user, signIn, signUp, passwordSignIn, resetPassword, setPassword, signOut, fromLink, rpc, live, now: () => Date.now() + offset, lastEmail: () => { try { return JSON.parse(localStorage.getItem("fk-auth:email")) || ""; } catch (e) { return ""; } } };
})(typeof window !== "undefined" ? window : globalThis);
