/* A shared league (play.html?id=<league>): the draft room until the draft is done, then the league pages.
   Everyone runs the same rules on their own page and saves the result with the version they started from
   (fk_save); if someone else saved first, the page takes their copy instead. Unclaimed teams are bots. Time moves
   the season the same way the demo leagues do, on whichever page is open, and each save says who to email. */
(function () {
  "use strict";
  const { sports: S, value: V, draft: F, league: G, season: Z, ui: U, cloud: C } = window.FK;
  const { esc, $ } = U;
  const theme = U.theme("fk-lab");
  const WEEK = 7 * 864e5;
  const SPORT_CLR = { nba: 4, nfl: 2, mlb: 0 };
  const id = new URLSearchParams(location.search).get("id");
  const link = C.fromLink();
  const now = () => C.now();
  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  let info = null, D = null, L = null, version = 0, base = null;
  let data = null, sport = null, players = null, byId = {}, room = null, app = null, mode = null, mine = [], weeks = null;
  const hooks = () => ({ real: weeks });
  let inflight = false, dirty = false, lastChange = Date.now(), userAt = 0, pollT = null;

  const fatal = (msg, more = "") => { document.body.classList.remove("fk-room"); $("#top").innerHTML = ""; $("#app").innerHTML = `<div class="wrap page"><div class="banner loss" role="alert"><b>${esc(msg)}</b> ${more}</div><p><a class="btn" href="leagues.html">Your leagues</a></p></div>`; };
  const seated = () => Object.keys(info.seats || {}).map(Number);
  const canAct = () => info && (info.me != null || info.commish);
  const teamName = (t) => { const doc = L || D; return doc && doc.teams[t] ? doc.teams[t].name : "A team"; };

  function take(v) {
    info = { me: v.me, commish: !!v.commish, seats: v.seats || {}, invite: v.invite, notify: v.notify, name: v.name, sport: v.sport };
    if (v.version != null) version = v.version;
    if ("draft" in v) {
      D = v.draft; L = v.league;
      if (D && D.teams) D.teams.forEach((t, i) => { if (t.color == null) t.color = (i * 5) % 12; });
      base = clone({ draft: D, league: L }); lastChange = Date.now();
    }
  }

  async function boot() {
    if (!id) return fatal("This page needs a league link.", `<span class="muted">Open one from Your leagues.</span>`);
    const v = await C.rpc("fk_view", { p_id: id, p_since: null });
    if (v.error) return fatal(v.error);
    take(v);
    document.title = `${info.name} | Draft Lab`;
    const r = await fetch(`data/${info.sport}.json`, { cache: "no-cache" });
    data = await r.json();
    sport = S.attach(Object.assign({}, S[info.sport]), data);
    players = data.players.map((p) => Object.assign({}, p));
    V.evaluate(sport, players, { teams: D.teams.length, lineup: D.lineup, bench: D.bench, scoring: D.scoring, budget: D.auction ? D.auction.budget : 200 });
    byId = Object.fromEntries(players.map((p) => [p.id, p]));
    weeks = await fetch(`data/weeks-${info.sport}.json`, { cache: "no-cache" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (weeks && String(weeks.season) !== String(data.season)) weeks = null;
    if (C.user()) C.rpc("fk_mine", {}).then((m) => { if (Array.isArray(m)) { mine = m; if (app) app.render(); } }).catch(() => {});
    mount();
    if (link && link.error) U.toast(`That sign-in link didn't work: ${link.error}`, true);
    if (location.hash === "#invite" && info.commish) { history.replaceState(null, "", location.pathname + location.search); leagueDialog(); }
    schedule();
  }

  /* ---------- the two views ---------- */
  const modeNow = () => (L ? "league" : "draft");
  function mount() {
    mode = modeNow();
    if (room) { room.stop(); room = null; }
    if (mode === "draft") mountRoom(); else mountLeague();
  }
  function refreshView() { if (mode !== modeNow()) mount(); else if (room) room.refresh(); else if (app) app.refresh(); }

  function mountRoom() {
    document.body.classList.add("fk-room");
    $("#top").innerHTML = "";
    $("#app").innerHTML = `<div id="room"></div>${guestNote()}`;
    room = U.room({
      el: $("#room"), sport, players, draft: () => D, save: () => push(), me: () => info.me, now,
      get commish() { return info.commish; }, get drive() { return driveOk(); },
      brand: { name: "Draft Lab", mark: `<img src="mark.svg" alt="">` }, exit: { href: "leagues.html", label: "Your leagues" },
      tools: () => `<button class="btn sm" data-live="league">${info.commish ? "Invite" : "League"}</button>`,
      extra: () => (L ? "" : `<span class="ps">Setting up the season…</span>`),
    });
  }
  function mountLeague() {
    document.body.classList.remove("fk-room");
    app = U.leagueApp({
      top: $("#top"), el: $("#app"), sport, players, league: () => L, save: () => push(), me: () => info.me, now, frac, hooks: hooks(),
      brand: { name: "Draft Lab", href: "leagues.html", mark: `<img src="mark.svg" alt="">` },
      switcher: () => U.switcher({ name: L.name, abbr: info.sport.toUpperCase(), color: SPORT_CLR[info.sport] },
        mine.filter((m) => m.id !== id).map((m) => ({ href: `play.html?id=${encodeURIComponent(m.id)}`, name: m.name, sub: S[m.sport].name, av: { abbr: m.sport.toUpperCase(), color: SPORT_CLR[m.sport] } })),
        `<a href="leagues.html">Your leagues<small>Start or join a league</small></a><a href="./">Draft Lab<small>Mock drafts and rankings</small></a>`),
      right: () => `<button class="btn sm ghost" data-live="league">${info.commish ? "Invite" : "League"}</button>`,
      get commishTools() { return info.commish ? commishTools : null; },
      notice: () => guestNote() + startNote(),
    });
    if (catchUp()) push();
    app.refresh();
  }
  // before week 1: when it starts
  function startNote() {
    if (!L || now() >= L.start) return "";
    const d = new Date(L.start).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
    return `<div class="wrap" style="padding-top:12px"><div class="banner"><b>Week 1 starts ${esc(d)}.</b> <span class="muted">Until then, set your lineup, work the waiver wire and make trades.</span></div></div>`;
  }
  function guestNote() {
    if (info.me != null || info.commish) return "";
    const msg = C.user() ? "You don't have a team in this league. Ask the commissioner for the invite link." : "You're looking as a guest.";
    return `<div class="wrap" style="padding-top:12px"><div class="banner"><b>${esc(msg)}</b> ${C.user() ? "" : `<a href="leagues.html">Sign in</a> <span class="muted">to make moves.</span>`}</div></div>`;
  }
  const frac = (w) => Math.max(0, Math.min(1, (now() - G.weekStart(L, w)) / WEEK));

  // The commissioner's page runs bots and the clock. Anyone else's page steps in when that's five seconds late,
  // so the draft keeps moving when the commissioner's page is closed.
  function driveOk() {
    if (!D || D.phase !== "live" || D.paused || !canAct()) return false;
    if (info.commish) return true;
    if (D.type === "auction") return Date.now() - lastChange > 8000;
    const c = F.onClock(D, now());
    if (!c) return false;
    const at = F.isBot(D.teams[c.team]) ? D.clockStart + D.botDelay : c.deadline;
    return now() > at + 5000;
  }

  /* ---------- the season (season.js) ---------- */
  // basketball and football seasons in progress are scored on real box scores
  function beginSeason() { L = Z.begin(D, sport, { name: info.name, season: data.season, now: now(), real: !!weeks }); }
  const catchUp = () => (L ? Z.catchUp(L, G.context(L, players, sport, hooks()), now()) : false);
  const events = (b, c) => Z.events(b, c, { name: info.name, url: location.origin + location.pathname + "?id=" + encodeURIComponent(id), seats: info.seats, me: info.me, byId, now: now() });

  /* ---------- saving ---------- */
  ["pointerdown", "keydown"].forEach((ev) => document.addEventListener(ev, () => (userAt = Date.now()), true));
  function push() {
    if (!canAct()) return;
    dirty = true; lastChange = Date.now();
    if (!inflight) flush();
  }
  async function flush() {
    if (!dirty) return;
    dirty = false; inflight = true;
    if (D && D.phase === "done" && !L) beginSeason();
    const mineMove = Date.now() - userAt < 2500;
    const cur = { draft: D, league: L }, sent = clone(cur);
    let r;
    try {
      r = await C.rpc("fk_save", { p_id: id, p_version: version, p_draft: base && base.league ? null : D, p_league: L, p_events: events(base, cur) });
    } catch (e) {
      inflight = false; dirty = true;
      U.toast(`Couldn't save: ${e.message}. Trying again.`, true);
      setTimeout(flush, 5000);
      return;
    }
    inflight = false;
    if (r.ok) {
      version = r.version; base = sent;
      if (dirty) flush(); else if (mode !== modeNow()) mount();
      return;
    }
    if (r.error === "stale") {
      D = r.draft; L = r.league; version = r.version; base = clone({ draft: D, league: L }); dirty = false; lastChange = Date.now();
      refreshView();
      if (mineMove) U.toast("Someone else moved first, so this reloaded. Check it and try again.", true);
      return;
    }
    U.toast(r.error, true);
    pull();
  }
  async function pull() {
    if (inflight || dirty) return;
    let v;
    try { v = await C.rpc("fk_view", { p_id: id, p_since: version }); } catch (e) { return; }
    if (!v || v.error || inflight || dirty) return;
    const wasMe = info.me, wasCommish = info.commish;
    const before = { offers: myOffers(), week: L ? L.week : 0, phase: D && D.phase };
    take(v);
    if ("draft" in v) {
      refreshView();
      if (L && myOffers().some((t) => !before.offers.includes(t))) U.toast("You have a new trade offer. It's at the top of the page.");
      else if (L && before.week && L.week !== before.week) U.toast(`On to week ${Math.min(L.week, G.totalWeeks(L))}.`);
      else if (D && before.phase === "setup" && D.phase === "live") U.toast("The draft started.");
    } else if (wasMe !== info.me || wasCommish !== info.commish) refreshView();
    if (L && catchUp()) { push(); if (app) app.refresh(); }
  }
  const myOffers = () => (L && info.me != null ? L.trades.filter((t) => t.status === "pending" && t.to === info.me).map((t) => t.id) : []);
  function schedule() {
    clearTimeout(pollT);
    const live = D && D.phase === "live" && !L;
    const ms = document.hidden ? 30000 : live ? 2500 : !L ? 6000 : 20000;
    pollT = setTimeout(async () => {
      const busy = U.dialogOpen() || document.querySelector("details[open]") || (document.activeElement && /^(fk-q|INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.id || document.activeElement.tagName));
      if (!busy || (live && !L)) await pull();
      schedule();
    }, ms);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { pull(); schedule(); } });

  /* ---------- the league dialog: invite link, managers, email alerts ---------- */
  function inviteUrl() { return `${location.origin}${location.pathname.replace(/play\.html$/, "leagues.html")}?join=${encodeURIComponent(id)}&code=${encodeURIComponent(info.invite || "")}`; }
  function seatList() {
    const doc = L || D;
    return `<ul class="seatl">${doc.teams.map((t, i) => `<li>${U.teamAv(t, "sm")}<span class="grow"><b>${esc(t.name)}</b><small>${info.seats[i] != null ? esc(info.seats[i]) : "Open, drafted by a bot"}</small></span>${info.commish && info.seats[i] != null && i !== 0 && i !== info.me ? `<button type="button" class="btn sm ghost" data-free="${i}">Free this team</button>` : ""}</li>`).join("")}</ul>`;
  }
  function leagueDialog() {
    const u = C.user();
    U.dialog(`<h3>${esc(info.name)}</h3>
      ${info.commish ? `<p class="muted" style="margin:0 0 8px">Send this link to your league. Anyone who opens it signs in with their email and picks an open team.</p>
        <div class="row"><input type="text" readonly value="${esc(inviteUrl())}" id="lv-link" style="flex:1;min-width:0" aria-label="Invite link"><button type="button" class="btn go" data-lv="copy">Copy</button></div>` : ""}
      ${seatList()}
      ${info.me != null ? `<label class="check" style="margin-top:10px"><input type="checkbox" id="lv-mail"${info.notify !== false ? " checked" : ""}> Email me about trade offers, waiver results${D && D.clock >= 3600 ? ", my turn in the draft" : ""} and weekly results</label>` : ""}
      <div class="row ps" style="margin:12px 0 0;gap:6px 16px;flex-wrap:wrap"><span>${u ? `Signed in as ${esc(u.email)}` : `<a href="leagues.html">Sign in</a> to make moves`}</span><span class="grow"></span>${u ? `<button type="button" class="btn sm ghost" data-lv="out">Sign out</button>` : ""}<button type="button" class="btn sm ghost" data-lv="theme">${theme.dark() ? "Light mode" : "Dark mode"}</button></div>`, null, { wide: true });
    const dlg = $("#fk-dlg");
    dlg.onclick = async (e) => {
      const b = e.target.closest("[data-lv],[data-free]");
      if (!b) return;
      if (b.dataset.lv === "copy") { const el = $("#lv-link"); el.select(); try { await navigator.clipboard.writeText(el.value); U.toast("Invite link copied"); } catch (err) { document.execCommand("copy"); U.toast("Invite link copied"); } }
      else if (b.dataset.lv === "out") { await C.signOut(); location.reload(); }
      else if (b.dataset.lv === "theme") { theme.toggle(); b.textContent = theme.dark() ? "Light mode" : "Dark mode"; if (app) app.render(); }
      else if (b.dataset.free != null) {
        const t = Number(b.dataset.free);
        dlg.close();
        U.confirm(`Free ${teamName(t)}?`, `${esc(info.seats[t])} loses the team, and a bot runs it until someone else claims it with the invite link.`, "Free the team", async () => {
          const r = await C.rpc("fk_leave", { p_id: id, p_team: t }).catch((err) => ({ error: err.message }));
          if (r.error) U.toast(r.error, true); else { U.toast("Done. The team is open."); version = -1; pull(); }
        });
      }
    };
    dlg.onchange = async (e) => {
      if (e.target.id !== "lv-mail") return;
      const on = e.target.checked;
      const r = await C.rpc("fk_notify", { p_id: id, p_on: on }).catch((err) => ({ error: err.message }));
      if (r.error) { U.toast(r.error, true); e.target.checked = !on; } else { info.notify = on; U.toast(on ? "Email alerts are on." : "Email alerts are off."); }
    };
  }
  function commishTools() {
    return `<div class="head"><h1 class="disp">Commissioner</h1><span class="ps">Invite managers and manage teams. Changes save for everyone.</span></div>
      <div class="cols2"><div class="card"><div class="mod-h"><h2>Invite link</h2></div><div class="bd stack">
        <p class="small" style="margin:0">Anyone with this link can sign in and take an open team, even mid-season.</p>
        <button class="btn go" data-live="league">Show the invite link</button></div></div>
      <div class="card"><div class="mod-h"><h2>Managers</h2></div><div class="bd">${seatList()}</div></div></div>`;
  }
  document.addEventListener("click", (e) => {
    const lv = e.target.closest("[data-live]"), th = e.target.closest("button[data-theme]");
    if (th) { theme.toggle(); if (app) app.render(); return; }
    if (lv && lv.dataset.live === "league") { e.preventDefault(); leagueDialog(); }
    const fr = e.target.closest("#app [data-free]");
    if (fr) { const t = Number(fr.dataset.free); U.confirm(`Free ${teamName(t)}?`, `${esc(info.seats[t])} loses the team, and a bot runs it until someone else claims it with the invite link.`, "Free the team", async () => {
      const r = await C.rpc("fk_leave", { p_id: id, p_team: t }).catch((err) => ({ error: err.message }));
      if (r.error) U.toast(r.error, true); else { U.toast("Done. The team is open."); version = -1; pull(); }
    }); }
  });

  window.addEventListener("hashchange", () => { if (/access_token=/.test(location.hash) && C.fromLink()) location.reload(); });
  boot().catch((e) => { console.error(e); fatal("Couldn't load the league.", `<span class="muted">${esc(e.message)}</span>`); });
})();
