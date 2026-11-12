/* The site's account: a Sign in button (or your name and a small menu) in the navigation on every page, and the
   daily games' saves following your account across devices.

   It's the Draft Lab account: fantasy-kit/cloud.js does the signing in and keeps the session in this browser
   (localStorage "fk-auth:session"), so one sign-in covers the whole site. This file loads cloud.js when it needs it.

   Sync: the daily games save to localStorage under their own keys (mtc.v2.*, gtp-*, jm-*, sr-*, tempo-*). While
   you're signed in, each change is sent to your account (ds_sync_push, tools/ds_sync.sql) and each page load takes
   what your other devices sent since last time (ds_sync_pull). The newer save of a key wins. Your leaderboard name
   comes along too, and starts as your username. */
(function () {
  "use strict";
  if (window.DSAccount) return;
  var script = document.currentScript;
  var root = script ? new URL("../", script.src).pathname : "/";
  var SYNC = /^(mtc\.v2\.|gtp-|jm-|sr-|tempo-)/;
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var read = function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  var write = function (k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } };

  /* ---------- who's signed in, from the saved session (no network) ---------- */
  function claims(tok) {
    try { var p = tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(decodeURIComponent(escape(atob(p + "=".repeat((4 - (p.length % 4)) % 4))))); } catch (e) { return {}; }
  }
  function me() {
    var s = read("fk-auth:session");
    if (!s || !s.refresh) return null;
    var c = claims(s.access || ""), m = c.user_metadata || {};
    var name = m.username || m.full_name || m.name || (c.email ? c.email.split("@")[0] : "") || "Your account";
    return { id: c.sub || null, email: c.email || "", name: name };
  }

  /* ---------- cloud.js, loaded once when needed ---------- */
  var cloudP = null;
  function cloud() {
    if (window.FK && window.FK.cloud) return Promise.resolve(window.FK.cloud);
    if (!cloudP) cloudP = new Promise(function (ok, no) {
      var s = document.createElement("script");
      s.src = root + "fantasy-kit/cloud.js?v=20261105-acct2";
      s.onload = function () { window.FK && window.FK.cloud ? ok(window.FK.cloud) : no(new Error("Sign-in didn't load.")); };
      s.onerror = function () { cloudP = null; no(new Error("Sign-in didn't load. Check your connection.")); };
      document.head.appendChild(s);
    });
    return cloudP;
  }
  // Draft Lab's own pages load cloud.js and read sign-in links themselves; everywhere else this does it
  var ownsLinks = !(window.FK && window.FK.cloud) && !/\/fantasy-kit\//.test(location.pathname);

  /* ---------- styles ---------- */
  // its look lives in account.css, a file so a page with a strict content security policy still allows it
  var st = document.createElement("link"); st.rel = "stylesheet"; st.href = root + "assets/account.css?v=20261112b"; document.head.appendChild(st);

  function toast(msg, action) {
    var old = document.querySelector(".ds-toast"); if (old) old.remove();
    var t = document.createElement("div"); t.className = "ds-toast"; t.setAttribute("role", "status");
    t.innerHTML = "<span>" + esc(msg) + "</span>" + (action ? '<button type="button">' + esc(action.label) + "</button>" : "");
    if (action) t.querySelector("button").onclick = action.run;
    document.body.appendChild(t);
    setTimeout(function () { if (t.isConnected) t.remove(); }, action ? 12000 : 5000);
  }

  /* ---------- the button in the navigation ---------- */
  var initials = function (n) { return String(n || "?").replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).map(function (w) { return w[0]; }).join("").slice(0, 2).toUpperCase() || "?"; };
  function drawButton() {
    var slot = document.getElementById("ds-account");
    if (!slot) return;
    var u = me();
    slot.innerHTML = u
      ? '<button type="button" class="ds-acct-btn" aria-haspopup="true" aria-expanded="false"><span class="ds-acct-av" aria-hidden="true">' + esc(initials(u.name)) + '</span><span class="ds-acct-name">' + esc(u.name) + '</span><span class="ds-acct-sr">, your account</span></button>'
        + '<div class="ds-acct-menu" hidden><p><b>' + esc(u.name) + "</b>" + esc(u.email) + '</p><a href="' + esc(root + "fantasy-kit/leagues.html") + '">Your leagues</a><a href="' + esc(root + "account/") + '">Account</a><button type="button" data-ds-out>Sign out</button></div>'
      : '<button type="button" class="ds-acct-btn out" data-ds-in><span class="ds-acct-av" aria-hidden="true">?</span><span>Sign in</span></button>';
  }
  document.addEventListener("click", function (e) {
    var slot = document.getElementById("ds-account");
    var menu = slot && slot.querySelector(".ds-acct-menu");
    if (e.target.closest("[data-ds-in]")) { e.preventDefault(); openSignIn("signin"); return; }
    if (e.target.closest("[data-ds-out]")) {
      e.preventDefault();
      cloud().then(function (c) { return c.signOut(); }).catch(function () { write("fk-auth:session", null); }).then(function () { write("ds-sync:at", null); write("ds-sync:dirty", null); location.reload(); });
      return;
    }
    var btn = e.target.closest(".ds-acct-btn");
    if (btn && menu && slot.contains(btn)) { var open = menu.hidden; menu.hidden = !open; btn.setAttribute("aria-expanded", String(open)); return; }
    if (menu && !menu.hidden && !slot.contains(e.target)) { menu.hidden = true; slot.querySelector(".ds-acct-btn").setAttribute("aria-expanded", "false"); }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var menu = document.querySelector("#ds-account .ds-acct-menu");
    if (menu && !menu.hidden) { menu.hidden = true; var b = document.querySelector("#ds-account .ds-acct-btn"); b.setAttribute("aria-expanded", "false"); b.focus(); }
  });
  window.addEventListener("dsolar:nav-render", drawButton);

  /* ---------- the sign-in dialog ---------- */
  var GOOGLE = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  var APPLE = '<svg width="16" height="18" viewBox="0 0 17 20" aria-hidden="true"><path fill="currentColor" d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.1 2.5 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.6-1-2.6-4.2zM11.6 3c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4z"/></svg>';
  var dlg = null, mode = "signin", prov = null;
  function openSignIn(m) {
    mode = m || "signin";
    if (!dlg) {
      dlg = document.createElement("dialog"); dlg.className = "ds-si"; dlg.setAttribute("aria-labelledby", "ds-si-h");
      document.body.appendChild(dlg);
      dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
      dlg.addEventListener("submit", onSubmit);
      dlg.addEventListener("click", onClick);
    }
    drawDialog();
    if (!dlg.open) dlg.showModal();
    var f = dlg.querySelector("input"); if (f) f.focus();
    cloud().then(function (c) { return c.providers(); }).then(function (p) { prov = p; if (dlg.open && (p.google || p.apple)) drawDialog(true); }).catch(function () {});
  }
  function drawDialog(keep) {
    var vals = {}; if (keep) dlg.querySelectorAll("input").forEach(function (i) { vals[i.name] = i.value; });
    var last = ""; try { last = JSON.parse(localStorage.getItem("fk-auth:email")) || ""; } catch (e) { /* none */ }
    var outside = prov && (prov.google || prov.apple) && (mode === "signin" || mode === "signup")
      ? (prov.google ? '<button type="button" class="ds-si-alt" data-oauth="google">' + GOOGLE + "Continue with Google</button>" : "") + (prov.apple ? '<button type="button" class="ds-si-alt" data-oauth="apple">' + APPLE + "Continue with Apple</button>" : "") + '<div class="ds-si-or">or</div>' : "";
    var body = {
      signin: '<h2 id="ds-si-h">Sign in</h2><p class="ds-si-sub">One account for the whole site: your leagues, and your daily game streaks on every device.</p>' + outside
        + '<label>Username or email<input name="login" autocomplete="username" required value="' + esc(last) + '"></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label>'
        + '<p class="ds-si-why" role="alert"></p><button class="ds-si-go" type="submit">Sign in</button>'
        + '<div class="ds-si-links"><button type="button" data-mode="link">Email me a sign-in link</button><button type="button" data-mode="forgot">Forgot your password?</button><button type="button" data-mode="signup">Make an account</button></div>',
      signup: '<h2 id="ds-si-h">Make an account</h2><p class="ds-si-sub">Free. Your email is only for sign-in links and league alerts you turn on.</p>' + outside
        + '<label>Username<input name="username" autocomplete="username" required minlength="3" maxlength="20"></label><label>Email<input name="email" type="email" autocomplete="email" required></label><label>Password<input name="password" type="password" autocomplete="new-password" required minlength="8"></label>'
        + '<p class="ds-si-why" role="alert"></p><button class="ds-si-go" type="submit">Make the account</button><div class="ds-si-links"><button type="button" data-mode="signin">I have an account</button></div>',
      link: '<h2 id="ds-si-h">Email me a link</h2><p class="ds-si-sub">Tap the link in the email and you\'re signed in on this device. No password needed.</p>'
        + '<label>Email<input name="email" type="email" autocomplete="email" required value="' + esc(last) + '"></label><p class="ds-si-why" role="alert"></p><button class="ds-si-go" type="submit">Send the link</button><div class="ds-si-links"><button type="button" data-mode="signin">Use my password</button></div>',
      forgot: '<h2 id="ds-si-h">Reset your password</h2><p class="ds-si-sub">We\'ll email a link to set a new one.</p>'
        + '<label>Username or email<input name="login" required value="' + esc(last) + '"></label><p class="ds-si-why" role="alert"></p><button class="ds-si-go" type="submit">Email the link</button><div class="ds-si-links"><button type="button" data-mode="signin">Back to sign in</button></div>',
      sent: '<h2 id="ds-si-h">Check your email</h2><p class="ds-si-sub">The link signs you in and brings you back here. It can take a minute to arrive.</p><button class="ds-si-go" type="button" data-close>Done</button>',
    }[mode];
    dlg.innerHTML = '<form method="dialog" novalidate>' + body + '</form><button type="button" class="ds-si-x" data-close aria-label="Close">×</button>';
    if (keep) dlg.querySelectorAll("input").forEach(function (i) { if (vals[i.name] != null) i.value = vals[i.name]; });
  }
  function onClick(e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.hasAttribute("data-close")) { dlg.close(); return; }
    if (b.dataset.mode) { mode = b.dataset.mode; drawDialog(); var f = dlg.querySelector("input"); if (f) f.focus(); return; }
    if (b.dataset.oauth) { cloud().then(function (c) { c.oauth(b.dataset.oauth, location.href.split("#")[0]); }); }
  }
  function onSubmit(e) {
    e.preventDefault();
    var f = e.target, v = function (n) { var i = f.elements[n]; return i ? i.value : ""; }, why = f.querySelector(".ds-si-why"), go = f.querySelector(".ds-si-go");
    var back = location.href.split("#")[0];
    go.disabled = true; why.textContent = "";
    cloud().then(function (c) {
      if (mode === "signin") return c.passwordSignIn(v("login"), v("password")).then(function () { signedIn(); });
      if (mode === "signup") return c.signUp({ username: v("username"), email: v("email"), password: v("password"), back: back }).then(function (r) { if (r.signedIn) signedIn(); else { mode = "sent"; drawDialog(); } });
      if (mode === "link") return c.signIn(v("email"), back).then(function () { mode = "sent"; drawDialog(); });
      // a reset link opens Your leagues, which asks for the new password
      if (mode === "forgot") return c.resetPassword(v("login"), location.origin + root + "fantasy-kit/leagues.html").then(function () { mode = "sent"; drawDialog(); });
    }).catch(function (err) { why.textContent = err.message || "That didn't work. Try again."; go.disabled = false; });
  }
  // signed in: start fresh, so every part of the page (and Draft Lab's own pages) sees it
  function signedIn() { write("ds-sync:at", null); location.reload(); }

  /* ---------- sync ---------- */
  var applying = false, dirty = read("ds-sync:dirty") || {}, pushT = null;
  function mark(k) { if (applying || !SYNC.test(k) || !me()) return; dirty[k] = Date.now(); write("ds-sync:dirty", dirty); clearTimeout(pushT); pushT = setTimeout(push, 1500); }
  // every save a game makes goes through here
  try {
    var S = Storage.prototype, set0 = S.setItem, rm0 = S.removeItem;
    S.setItem = function (k, val) { set0.apply(this, arguments); if (this === window.localStorage) mark(String(k)); };
    S.removeItem = function (k) { rm0.apply(this, arguments); if (this === window.localStorage) mark(String(k)); };
  } catch (e) { /* no storage */ }

  function rpc(c, name, args) {
    return c.rpc(name, args).then(function (r) { if (!r || r.error) throw new Error((r && r.error) || "Sync failed"); return r; });
  }
  var pushing = null;
  function push(opts) {
    if (!me() || pushing) return pushing;
    var keys = Object.keys(dirty);
    if (!keys.length) return Promise.resolve();
    var items = {}, sent = {};
    keys.slice(0, 300).forEach(function (k) { var x = null; try { x = localStorage.getItem(k); } catch (e) { /* none */ } items[k] = x; sent[k] = dirty[k]; });
    pushing = cloud().then(function (c) { return rpc(c, "ds_sync_push", { p_items: items }); }).then(function () {
      Object.keys(sent).forEach(function (k) { if (dirty[k] === sent[k]) delete dirty[k]; });
      write("ds-sync:dirty", dirty);
    }).catch(function () { /* tries again with the next change or page */ }).then(function () { pushing = null; if (Object.keys(dirty).length && keys.length > 300) push(); });
    return pushing;
  }
  window.addEventListener("pagehide", function () { if (Object.keys(dirty).length) push(); });
  document.addEventListener("visibilitychange", function () { if (document.hidden && Object.keys(dirty).length) push(); });

  function pull() {
    var u = me(); if (!u) return Promise.resolve();
    var since = read("ds-sync:at"), first = !since, changed = [];
    return cloud().then(function (c) { return rpc(c, "ds_sync_pull", { p_since: since || null }); }).then(function (r) {
      applying = true;
      try {
        Object.keys(r.items || {}).forEach(function (k) {
          var it = r.items[k];
          if (!SYNC.test(k) || (dirty[k] && dirty[k] > Date.parse(it.at))) return;     // changed here since: this one wins
          var cur = null; try { cur = localStorage.getItem(k); } catch (e) { /* none */ }
          if (cur === it.v) return;
          try { if (it.v == null) localStorage.removeItem(k); else localStorage.setItem(k, it.v); changed.push(k); } catch (e) { /* full */ }
        });
      } finally { applying = false; }
      // the first time on this device: what's only here goes up to the account
      if (first) {
        for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (SYNC.test(k) && !(r.items || {})[k]) dirty[k] = Date.now(); }
        write("ds-sync:dirty", dirty);
      }
      // your leaderboard name starts as your username
      if (!read("gtp-name") && u.name && /^[A-Za-z0-9 ._-]{2,20}$/.test(u.name)) { write("gtp-name", u.name); }
      write("ds-sync:at", r.now);
      if (Object.keys(dirty).length) push();
      if (changed.length) {
        window.dispatchEvent(new CustomEvent("dsolar:sync", { detail: { keys: changed } }));
        // a game page that already read its saves: offer to show the ones from your other devices
        if (!first || changed.length) {
          var home = location.pathname === root || location.pathname === root + "index.html";
          if (!home && document.querySelector("[data-ds-navigation]")) toast("Your progress from your other devices is here.", { label: "Show it", run: function () { location.reload(); } });
        }
      }
    }).catch(function () { /* offline or signed out: try next time */ });
  }

  /* ---------- start ---------- */
  function takeLink() {
    if (!ownsLinks || !/(^|[#&])(access_token|error_description)=/.test(location.hash)) return false;
    cloud().then(function (c) {
      var r = c.fromLink();
      drawButton();
      if (r && r.error) toast("That sign-in didn't work: " + r.error);
      else if (r && r.recovery) location.href = root + "fantasy-kit/leagues.html";
      else if (r && r.ok) { if (dlg && dlg.open) dlg.close(); write("ds-sync:at", null); pull(); askUsername(c); window.dispatchEvent(new CustomEvent("dsolar:auth")); }
    });
    return true;
  }
  // a sign-in link opened in the tab that's already on its page only changes the #
  window.addEventListener("hashchange", takeLink);
  function start() {
    drawButton();
    if (takeLink()) return;
    if (me()) pull();
  }
  // signed in with Google, so no username yet: ask for one (leagues and leaderboards show it)
  function askUsername(c) {
    if (/\/account\/?$/.test(location.pathname)) return;
    c.rpc("ds_account_me", {}).then(function (a) {
      if (a && a.ok && !a.username) toast("You're signed in. Pick a username for your leagues and leaderboards.", { label: "Pick one", run: function () { location.href = root + "account/#username"; } });
      else toast("You're signed in.");
    }).catch(function () { toast("You're signed in."); });
  }
  window.DSAccount = { me: me, openSignIn: openSignIn, pull: pull, push: push, cloud: cloud, toast: toast, signOut: function () {
    return cloud().then(function (c) { return c.signOut(); }).catch(function () { write("fk-auth:session", null); }).then(function () { write("ds-sync:at", null); write("ds-sync:dirty", null); drawButton(); });
  } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
