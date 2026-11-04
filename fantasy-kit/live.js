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
  let data = null, sport = null, players = null, byId = {}, room = null, app = null, mode = null, mine = [], weeks = null, prospects = null;
  const hooks = () => ({ real: weeks, prospects });
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
    sport = S.withScoring(S.attach(Object.assign({}, S[info.sport]), data), D.scoringSpec);   // the league's custom scoring, if it has one
    // a showdown plays one game: its two teams are the whole player pool
    players = data.players.filter((p) => S.inPool(L || D, p)).map((p) => Object.assign({}, p));
    // a dynasty values players over the next five seasons (value.js), a redraft league this season only
    const dyn = !!((D.season && D.season.dynasty) || (L && L.settings.dynasty));
    weeks = await fetch(`data/weeks-${info.sport}.json`, { cache: "no-cache" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (weeks && String(weeks.season) !== String(data.season)) weeks = null;
    // best ball (but not a guillotine, which keeps normal ranks) values upside and depth
    const bb = L ? !!L.settings.bestBall && L.settings.format !== "guillotine" : !!(D.season && D.season.bestBall && D.season.format !== "guillotine");
    V.evaluate(sport, players, { teams: D.teams.length, lineup: D.lineup, bench: D.bench, scoring: D.scoring, budget: D.auction ? D.auction.budget : 200, dynasty: dyn, dynastyRanks: dyn ? await dynastyRanks(info.sport) : null, bestBall: bb, weeks: bb ? weeks : null,
      market: await fetch(`data/market-${info.sport}.json`, { cache: "no-cache" }).then((x) => (x.ok ? x.json() : null)).catch(() => null) });
    byId = Object.fromEntries(players.map((p) => [p.id, p]));
    // a dynasty prices its rookie picks from next year's class on the Big Board
    if ((D.season && D.season.dynasty) || (L && L.settings.dynasty)) prospects = S.prospectClass(await fetch(`../draft/${info.sport}.json`, { cache: "no-cache" }).then((x) => (x.ok ? x.json() : null)).catch(() => null), info.sport);
    livePoll();
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
      // heist moves are sealed on the server until everyone's in or the clock runs out
      heist: {
        lock: async (moves) => { const r = await C.rpc("fk_heist_lock", { p_id: id, p_moves: moves }); if (r && r.ok) pull(); return r; },
        get: () => C.rpc("fk_heist_get", { p_id: id }),
      },
      extra: () => (L ? "" : `<span class="ps">Setting up the season…</span>`),
      chat,
    });
    loadPosts();
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
      notice: () => guestNote() + startNote() + keeperNote(),
      chat,
      history: () => past,
    });
    loadPosts();
    loadPast();
    if (catchUp()) push();
    app.refresh();
  }
  // past seasons for the History page, loaded once (a first-season league has none)
  let past = null, pastAsked = false;
  function loadPast() {
    if (pastAsked || !(L && L.draft && L.draft.year > 1)) return;
    pastAsked = true;
    C.rpc("fk_history", { p_id: id }).then((h) => { if (Array.isArray(h)) { past = h; if (app && !U.dialogOpen()) app.refresh(); } }).catch(() => { pastAsked = false; });
  }
  // Outside dynasty rankings (data/dynasty-<sport>.json, rebuilt daily by tools/dynasty_pull.py), when there are any.
  const dynastyRanks = (k) => fetch(`data/dynasty-${k}.json`, { cache: "no-cache" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  /* ---------- live box scores: every minute while the page is open and the league plays on real games ---------- */
  let liveT = null;
  async function livePoll() {
    clearTimeout(liveT);
    if (weeks && !document.hidden && (!L || L.settings.real)) {
      const lv = await C.live(info.sport);
      // this week's kickoff times go with the league, so every page and the clock lock players when their games start
      const kicked = L && canAct() && G.setKicks(L, lv);
      if (kicked) push();
      if ((Z.mergeLive(weeks, lv) || kicked) && app && !U.dialogOpen()) { app.refresh(); }
    }
    liveT = setTimeout(livePoll, document.hidden ? 5 * 60e3 : 60e3);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && weeks) livePoll(); });
  /* ---------- league chat: posts load every few seconds while the page is open ---------- */
  let posts = [], postT = null, seen = 0;
  try { seen = Number(localStorage.getItem("fk-chat-seen:" + id)) || 0; } catch (e) { /* no storage */ }
  const lastId = () => (posts.length ? posts[posts.length - 1].id : 0);
  const chat = {
    posts: () => posts,
    unread: () => posts.filter((p) => p.id > seen && p.team !== info.me).length,
    seen: () => { const n = lastId(); if (n > seen) { seen = n; try { localStorage.setItem("fk-chat-seen:" + id, String(n)); } catch (e) { /* no storage */ } } },
    async send(body) {
      const r = await C.rpc("fk_post", { p_id: id, p_body: body });
      if (r && r.post && !posts.some((p) => p.id === r.post.id)) posts.push(r.post);
      if (r && r.ok) chat.seen();
      return r;
    },
  };
  async function loadPosts() {
    clearTimeout(postT);
    if (!document.hidden && (L || D)) {
      const r = await C.rpc("fk_posts", { p_id: id, p_after: lastId() }).catch(() => null);
      if (Array.isArray(r) && r.length) {
        const have = new Set(posts.map((p) => p.id));
        posts = posts.concat(r.filter((p) => !have.has(p.id))).slice(-300);
        if (!U.dialogOpen()) { if (room) room.render(); else if (app) app.refresh(); }
      }
    }
    postT = setTimeout(loadPosts, document.hidden ? 60000 : 10000);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && (L || D)) loadPosts(); });
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
    // the heist: the commissioner's page settles it, or anyone's once its clock is five seconds past
    if (D && D.phase === "heist" && canAct()) return info.commish || now() > D.heist.ends + 5000 || F.heistFoe(D, info.me) != null && F.heistDue(D, now());
    if (!D || D.phase !== "live" || !canAct()) return false;
    if (D.paused) return !!D.hold;                     // a draft held for a trade offer: any page can let it go on
    if (info.commish) return true;
    if (D.type === "auction") return Date.now() - lastChange > 8000;
    const c = F.onClock(D, now());
    if (!c) return false;
    const at = F.isBot(D.teams[c.team]) ? D.clockStart + D.botDelay : c.deadline;
    return now() > at + 5000;
  }

  /* ---------- the season (season.js) ---------- */
  // a season in progress is scored on real box scores; out of season it's simulated
  function beginSeason() { L = Z.begin(D, sport, { name: info.name, season: data.season, now: now(), real: weeks || false }); }
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
    return `<ul class="seatl">${doc.teams.map((t, i) => `<li>${U.teamAv(t, "sm")}<span class="grow"><b>${esc(t.name)}</b><small>${info.seats[i] != null ? esc(info.seats[i]) : "Open, drafted by a bot"}</small></span>${info.commish && info.seats[i] != null && i !== 0 && i !== info.me ? `<button type="button" class="btn sm ghost" data-free="${i}">Free this team</button>` : ""}${info.commish && info.seats[i] == null && !L && D && D.phase === "setup" && doc.teams.length > 2 ? `<button type="button" class="btn sm ghost" data-lv="rmteam" data-team="${i}">Remove</button>` : ""}</li>`).join("")}</ul>`;
  }
  function leagueDialog() {
    const u = C.user();
    U.dialog(`<h3>${esc(info.name)}</h3>
      ${info.commish ? `<p class="muted" style="margin:0 0 8px">Send this link to your league. Anyone who opens it signs in with their email and picks an open team.</p>
        <div class="row"><input type="text" readonly value="${esc(inviteUrl())}" id="lv-link" style="flex:1;min-width:0" aria-label="Invite link"><button type="button" class="btn go" data-lv="copy">Copy</button></div>` : ""}
      ${seatList()}
      ${info.commish && D && !L && D.phase !== "done" && D.trading ? `<div class="field" style="margin-top:10px"><label for="lv-oh">A trade offer stops the clock</label><select id="lv-oh">${opt("clock", "When it's to the team on the clock", D.offerHold || "clock")}${opt("all", "For any manager, up to 90 seconds", D.offerHold || "clock")}${opt("off", "Never: the draft keeps going", D.offerHold || "clock")}</select></div>` : ""}
      ${info.commish && D && !L && D.phase === "setup" ? `<div class="row" style="margin-top:8px;flex-wrap:wrap;gap:8px"><span class="ps">${D.teams.length} teams. Teams can change until the draft starts.</span><span class="grow"></span>${D.type !== "auction" && D.type !== "mystery" && !D.carry && !(D.board || []).some((pk) => pk && pk.keeper) ? `<button type="button" class="btn sm" data-lv="order">Draft order</button>` : ""}${D.teams.length < 20 ? `<button type="button" class="btn sm" data-lv="addteam">Add a team</button>` : ""}</div>` : ""}
      <div id="lv-past"></div>
      ${info.me != null ? `<label class="check" style="margin-top:10px"><input type="checkbox" id="lv-mail"${info.notify !== false ? " checked" : ""}> Email me about trade offers, waiver results${D && D.clock >= 3600 ? ", my turn in the draft" : ""} and weekly results</label>` : ""}
      <div class="row ps" style="margin:12px 0 0;gap:6px 16px;flex-wrap:wrap"><span>${u ? `Signed in as ${esc(u.email)}` : `<a href="leagues.html">Sign in</a> to make moves`}</span><span class="grow"></span>${info.commish && !L ? `<button type="button" class="btn sm ghost warn" data-lv="delete">Delete league</button>` : ""}${u ? `<button type="button" class="btn sm ghost" data-lv="out">Sign out</button>` : ""}<button type="button" class="btn sm ghost" data-lv="theme">${theme.dark() ? "Light mode" : "Dark mode"}</button></div>`, null, { wide: true });
    const dlg = $("#fk-dlg");
    // past seasons, newest first; most leagues have none yet, so this stays empty until there are
    if ((D && D.year > 1) || (L && L.draft && L.draft.year > 1)) C.rpc("fk_history", { p_id: id }).then((h) => {
      const el = $("#lv-past"); if (!el || !Array.isArray(h) || !h.length) return;
      el.innerHTML = `<h4 style="margin:14px 0 6px">Past seasons</h4><ul class="seatl">${h.slice().reverse().map((x) => `<li><span class="grow"><b>Year ${esc(x.year)}${x.season ? `, ${esc(x.season)}` : ""}</b><small>${x.champion ? `Champion: ${esc(x.champion.name)}${x.champion.owner ? ` (${esc(x.champion.owner)})` : ""}` : "No champion"}</small></span></li>`).join("")}</ul>`;
    }).catch(() => {});
    dlg.onclick = async (e) => {
      const b = e.target.closest("[data-lv],[data-free]");
      if (!b) return;
      if (b.dataset.lv === "copy") { const el = $("#lv-link"); el.select(); try { await navigator.clipboard.writeText(el.value); U.toast("Invite link copied"); } catch (err) { document.execCommand("copy"); U.toast("Invite link copied"); } }
      else if (b.dataset.lv === "out") { await C.signOut(); location.reload(); }
      else if (b.dataset.lv === "theme") { theme.toggle(); b.textContent = theme.dark() ? "Light mode" : "Dark mode"; if (app) app.render(); }
      else if (b.dataset.lv === "addteam") { dlg.close(); resizeTeams(null); }
      else if (b.dataset.lv === "order") { dlg.close(); orderDialog(); }
      else if (b.dataset.lv === "rmteam") { const t = Number(b.dataset.team); dlg.close(); U.confirm(`Remove ${teamName(t)}?`, "The league drops to one fewer team. You can add one back until the draft starts.", "Remove the team", () => resizeTeams(t)); }
      else if (b.dataset.lv === "delete") { dlg.close(); deleteDialog(); }
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
      if (e.target.id === "lv-oh") { D.offerHold = e.target.value; push(); U.toast("Saved."); return; }
      if (e.target.id !== "lv-mail") return;
      const on = e.target.checked;
      const r = await C.rpc("fk_notify", { p_id: id, p_on: on }).catch((err) => ({ error: err.message }));
      if (r.error) { U.toast(r.error, true); e.target.checked = !on; } else { info.notify = on; U.toast(on ? "Email alerts are on." : "Email alerts are off."); }
    };
  }
  /* ---------- the next season: keepers, then a new draft ---------- */
  const seasonOver = () => L && L.week > G.totalWeeks(L);
  const lctx = () => G.context(L, players, sport, hooks());
  function keeperNote() {
    if (!seasonOver() || !L.next || info.me == null || !L.settings.keepers) return "";
    const mine = L.next.picks && L.next.picks[info.me];
    return `<div class="wrap" style="padding-top:12px"><div class="banner"><b>${mine ? `You're keeping ${mine.length} for next season.` : "Pick your keepers for next season."}</b> <span class="muted">Up to ${L.settings.keepers}${L.next.due ? `, by ${new Date(L.next.due).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}` : ""}.</span> <button class="btn sm go" data-live="keepers">${mine ? "Change keepers" : "Pick keepers"}</button></div></div>`;
  }
  function keeperDialog() {
    const opts = Z.keeperOptions(L, lctx(), info.me), max = L.settings.keepers;
    const cur = (L.next.picks && L.next.picks[info.me]) || Z.autoKeepers(L, lctx(), info.me);
    U.dialog(`<h3>Your keepers</h3><p class="muted" style="margin:0 0 10px">Keep up to ${max}. Each costs ${L.draft && L.draft.type === "auction" ? "the price shown, out of next year's budget" : "the pick shown in next year's draft"}. The best values over their cost are checked to start.</p>
      <form><ul class="seatl kp">${opts.map((o) => `<li><label class="check" style="flex:1;min-width:0"><input type="checkbox" name="k" value="${esc(o.pid)}"${cur.includes(o.pid) ? " checked" : ""}> <span class="ell"><b>${esc(o.n)}</b> <small>${esc(o.cost.label)}</small></span></label><span class="tag${o.surplus > 0 && o.pos !== "K" && o.pos !== "DEF" ? " win" : ""}">${o.pos === "K" || o.pos === "DEF" ? "Easy to replace" : o.surplus > 0 ? "Good value" : "Costly"}</span></li>`).join("")}</ul>
      <div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn go">Save keepers</button></div></form>`, (fd) => {
      const ks = fd.getAll("k");
      if (ks.length > max) { U.toast(`You can keep ${max}`, true); return false; }
      L.next.picks = Object.assign({}, L.next.picks, { [info.me]: ks });
      push(); app.refresh();
      U.toast(ks.length ? `Keeping ${ks.length}.` : "Keeping nobody.");
    }, { wide: true });
  }
  function nextSeasonCard() {
    if (!seasonOver()) return "";
    const k = L.settings.keepers || 0;
    if (k && !L.next) return `<div class="card"><div class="mod-h"><h2>Next season</h2></div><div class="bd stack"><p class="small" style="margin:0">The season is over. Open keeper picks: every manager gets an email and picks up to ${k}. Bots keep their best values.</p><div><button class="btn go" data-live="open-keepers">Open keeper picks</button></div></div></div>`;
    const doc = L, picks = (L.next && L.next.picks) || {};
    const rows = doc.teams.map((t) => `<li>${U.teamAv(t, "sm")}<span class="grow"><b>${esc(t.name)}</b><small>${info.seats[t.id] != null ? (picks[t.id] ? `Keeping ${picks[t.id].length}` : "Hasn't picked yet: keeps the best values") : "Bot: keeps its best values"}</small></span></li>`).join("");
    return `<div class="card"><div class="mod-h"><h2>Next season</h2></div><div class="bd stack">
      <p class="small" style="margin:0">${L.settings.dynasty ? `The season is over. Starting next season saves this one to the league's history. Every roster carries over, and a ${L.settings.dynasty.rounds}-round rookie and free agent draft opens, worst team first${G.pickRounds(L) ? ", with traded picks going to the teams that hold them" : ""}. Until then, trades stay open.` : `${k ? "Keeper picks are open." : "The season is over."} Starting next season saves this one to the league's history and opens a new draft room${k ? " with the keepers on the board" : ""}, worst team picking first.`}</p>
      ${k ? `<ul class="seatl">${rows}</ul>` : ""}<div><button class="btn go" data-live="new-season">Start next season's draft</button></div></div></div>`;
  }
  async function newSeason() {
    const D2 = Z.nextDraft(L, lctx(), sport, (L.next && L.next.picks) || {}, { now: now() });
    const evs = events(clone({ draft: D, league: L }), { draft: D2, league: null });
    const r = await C.rpc("fk_new_season", { p_id: id, p_version: version, p_draft: D2, p_summary: Z.summary(L), p_events: evs }).catch((e) => ({ error: e.message }));
    if (r.error === "stale") { U.toast("Someone else saved first. Try again.", true); version = -1; pull(); return; }
    if (r.error) { U.toast(r.error, true); return; }
    version = r.version; D = D2; L = null; base = clone({ draft: D, league: null });
    app = null; mount();
    U.toast("Next season's draft room is open.");
  }
  /* ---------- commissioner tools ---------- */
  const opt = (v, l, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(l)}</option>`;
  function commishTools() {
    const card = (title, body, btn) => `<div class="card"><div class="mod-h"><h2>${title}</h2></div><div class="bd stack">${body}${btn ? `<div class="row" style="flex-wrap:wrap">${btn}</div>` : ""}</div></div>`;
    const s = L ? L.settings : {};
    const trades = L ? L.trades.filter((t) => t.status === "accepted").slice(-12).reverse() : [];
    return `<div class="head"><h1 class="disp">Commissioner</h1><span class="ps">Every change here saves for the whole league and shows up in its transactions.</span></div>
      ${nextSeasonCard()}
      <div class="cols2">
        ${card("Invite link", `<p class="small" style="margin:0">Anyone with this link can sign in and take an open team, even mid-season.</p>`, `<button class="btn go" data-live="league">Show the invite link</button>`)}
        <div class="card"><div class="mod-h"><h2>Managers</h2></div><div class="bd">${seatList()}</div></div>
      </div>
      ${L ? `<div class="cols2">
        ${card("League rules", `<dl class="kv"><dt>Waivers</dt><dd>${s.waivers === "rolling" ? "Rolling priority" : `FAAB, $${s.faab}`}, ${s.waiverHours} hours</dd><dt>Trades</dt><dd>${s.trades === false ? "Off" : `${s.deadline ? `Deadline after week ${s.deadline}` : "No deadline"}, ${s.tradeReview === "none" ? "no review" : "league review"}`}</dd><dt>Playoffs</dt><dd>${s.playoffTeams ? `${s.playoffTeams} teams` : "None"}</dd><dt>Rosters</dt><dd>${s.bench} bench, ${s.ir || 0} IR${s.maxAdds ? `, ${s.maxAdds} pickups a week` : ""}</dd></dl>`, `<button class="btn" data-cm="rules">Edit rules</button>`)}
        ${card("Teams", `<p class="small" style="margin:0">Rename teams, set FAAB and the waiver order${L.divs ? ", and rename or rearrange the divisions" : ""}.</p>`, `<button class="btn" data-cm="teams">Edit teams</button>`)}
      </div>
      <div class="cols2">
        ${card("Rosters", `<p class="small" style="margin:0">Move any player to another team or to free agency. Roster limits don't stop you; a team left over the limit has to cut.</p>`, `<button class="btn" data-cm="move">Move a player</button>`)}
        ${card("Trades", trades.length ? `<ul class="seatl">${trades.map((t) => `<li><span class="grow"><b>${esc(teamName(t.from))} &#8644; ${esc(teamName(t.to))}</b><small>${esc([].concat(t.get, t.give).map((x) => (byId[x] ? byId[x].n : "?")).join(", "))}${(t.pickGive || []).length + (t.pickGet || []).length ? ", plus picks" : ""}, ${esc(U.ago(t.done || t.at, now()))}</small></span><button type="button" class="btn sm ghost" data-cm-rev="${t.id}">Reverse</button></li>`).join("")}</ul>` : `<p class="small" style="margin:0">No trades yet. When one goes through, you can reverse it here if every player is still where it sent him.</p>`)}
      </div>` : ""}
      <div class="card danger"><div class="mod-h"><h2>Delete the league</h2></div><div class="bd stack"><p class="small" style="margin:0">Deletes the league for everyone: teams, history and chat. You can't undo it.</p><div><button class="btn warn" data-cm="delete">Delete the league</button></div></div></div>`;
  }
  // commissioner changes save like any other move, as the commissioner
  const commishSave = (r, msg) => { if (!r || r.ok === false) { U.toast((r && r.why) || "That didn't work", true); return false; } push(); if (app) app.refresh(); if (msg) U.toast(msg); return true; };
  function rulesDialog() {
    const s = L.settings, started = now() >= L.start || L.week > 1, inPlayoffs = L.week > s.weeks, gl = G.isGuillotine(L);
    const medianOk = s.format === "h2h" && (s.tally || "game") === "game";
    const sel = (id, label, opts, cur) => `<div class="field"><label for="${id}">${label}</label><select id="${id}" name="${id}">${opts.map(([v, l]) => opt(v, l, cur)).join("")}</select></div>`;
    const n = L.teams.length;
    U.dialog(`<h3>League rules</h3><form class="stack">
      <div class="row3">
        ${gl ? "" : sel("waivers", "Waivers", [["faab", "FAAB bids"], ["rolling", "Rolling priority"]], s.waivers)}
        ${sel("waiverHours", "Dropped players clear in", [12, 24, 36, 48, 72].map((x) => [x, `${x} hours`]), s.waiverHours)}
        ${sel("maxAdds", "Pickups a week", [0, 1, 2, 3, 4, 5, 7, 10].map((x) => [x, x ? `Up to ${x}` : "No limit"]), s.maxAdds || 0)}
      </div>
      <div class="row3">
        ${sel("maxAddsSeason", "Pickups a season", [0, 10, 15, 20, 25, 30, 40, 50].map((x) => [x, x ? `Up to ${x}` : "No limit"]), s.maxAddsSeason || 0)}
        ${gl || s.waivers === "faab" ? sel("minBid", "Lowest bid", [[0, "$0 bids allowed"], [1, "$1"]], s.minBid || 0) : ""}
        ${gl ? "" : sel("waiverOrder", "Waiver order", [["rolling", "Rolling"], ["standings", "Reverse standings, weekly"]], s.waiverOrder || "rolling")}
      </div>
      <div class="row3">
        ${sel("bench", "Bench spots", [2, 3, 4, 5, 6, 7, 8, 10, 12].map((x) => [x, x]), s.bench)}
        ${sel("ir", "IR spots", [0, 1, 2, 3, 4].map((x) => [x, x || "None"]), s.ir || 0)}
        ${s.dynasty ? sel("taxi", "Taxi squad", [0, 1, 2, 3, 4, 5].map((x) => [x, x ? `${x} spot${x > 1 ? "s" : ""}` : "None"]), s.taxi || 0) : ""}
        ${gl ? "" : sel("trades", "Trades", [[1, "On"], [0, "Off"]], s.trades === false ? 0 : 1)}
      </div>
      ${gl ? "" : `<div class="row3">
        ${sel("deadline", "Trade deadline", [[0, "None"]].concat(Array.from({ length: Math.max(0, s.weeks - 1) }, (_, i) => [i + 1, `After week ${i + 1}`])), s.deadline || 0)}
        ${sel("tradeReview", "Trade review", [["vote", "The league votes"], ["commish", "The commissioner reviews"], ["none", "None: trades go through"]], s.tradeReview)}
        ${sel("reviewHours", "Review lasts", [12, 24, 48].map((x) => [x, `${x} hours`]), s.reviewHours || 24)}
      </div>
      ${s.tradeReview === "vote" ? `<div class="row3">${sel("vetoShare", "Votes to veto", [[0.34, "A third"], [0.5, "Half"], [0.67, "Two thirds"]], s.vetoShare || 0.5)}</div>` : ""}
      <div class="row3">
        ${medianOk ? sel("median", "Median game", [[0, "Off"], [1, "On"]], s.median ? 1 : 0) : ""}
        ${sel("bestBall", "Lineups", [[0, "Set each week"], [1, "Best ball"]], s.bestBall ? 1 : 0)}
        ${started || s.format === "roto" ? "" : sel("weeks", "Regular season", [6, 8, 10, 12, 13, 14, 15, 16, 17].map((x) => [x, `${x} weeks`]), s.weeks)}
      </div>
      ${inPlayoffs || s.format === "roto" ? `<p class="ps" style="margin:0">${s.format === "roto" ? "" : "The playoffs have started, so their rules are set."}</p>` : `<div class="row3">
        ${sel("playoffTeams", "Playoff teams", [0, 2, 3, 4, 6, 8, 10, 12].filter((x) => x <= n).map((x) => [x, x ? `${x} teams` : "No playoffs"]), s.playoffTeams)}
        ${sel("playoffLegs", "Playoff rounds", [["1", "One week each"], ["final2", "Two-week final"], ["all2", "Two weeks each"]], s.playoffLegs || "1")}
        ${sel("consolation", "Also play", [["none", "Nothing else"], ["third", "A third-place game"], ["bracket", "A consolation bracket"]], s.consolation || "none")}
      </div>`}`}
      <p class="ps" style="margin:0">${started ? "The season has started, so its length and schedule are set. " : ""}Changes apply from now on; finished weeks keep their results${medianOk ? ", except that turning the median game on or off recounts every record" : ""}.</p>
      <div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn go">Save rules</button></div></form>`, (fd) => {
      const patch = {};
      for (const [k, v] of fd.entries()) patch[k] = ["trades", "median", "bestBall"].includes(k) ? v === "1" : ["waivers", "tradeReview", "playoffLegs", "consolation", "waiverOrder"].includes(k) ? v : Number(v);
      for (const k of Object.keys(patch)) if (JSON.stringify(patch[k]) === JSON.stringify(k === "trades" ? s.trades !== false : k === "median" || k === "bestBall" ? !!s[k] : s[k])) delete patch[k];
      if (!Object.keys(patch).length) return;
      const r = G.setRules(L, patch, now());
      if (!commishSave(r, "Rules saved.")) return false;
    }, { wide: true });
  }
  function teamsDialog() {
    const order = L.teams.slice().sort((a, b) => a.priority - b.priority).map((t) => t.id), n = L.teams.length;
    U.dialog(`<h3>Teams</h3><form class="stack">
      <div class="cm-teams">${L.teams.map((t) => `<div class="cm-team">${U.teamAv(t, "sm")}
        <label class="cm-l nm"><span>Team name</span><input type="text" name="n${t.id}" value="${esc(t.name)}" maxlength="28"></label>
        <label class="cm-l"><span>Short</span><input type="text" name="a${t.id}" value="${esc(t.abbr)}" maxlength="4" class="ab"></label>
        <label class="cm-l"><span>FAAB</span><input type="number" name="f${t.id}" value="${t.faab}" min="0" max="100000"></label>
        <label class="cm-l"><span>Waiver #</span><select name="w${t.id}">${Array.from({ length: n }, (_, i) => opt(i + 1, i + 1, order.indexOf(t.id) + 1)).join("")}</select></label>
        ${L.divs ? `<label class="cm-l"><span>Division</span><select name="d${t.id}">${L.divNames.map((nm, k) => opt(k, nm, L.divs[t.id])).join("")}</select></label>` : ""}</div>`).join("")}</div>
      ${L.divs ? `<div class="row" style="flex-wrap:wrap;gap:8px">${L.divNames.map((nm, k) => `<label class="cm-l"><span>Division ${k + 1}</span><input type="text" name="dn${k}" value="${esc(nm)}" maxlength="24"></label>`).join("")}</div>` : ""}
      <div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn go">Save teams</button></div></form>`, (fd) => {
      const at = now();
      for (const t of L.teams) {
        const patch = {};
        if (fd.get("n" + t.id) !== t.name) patch.name = fd.get("n" + t.id);
        if (fd.get("a" + t.id) !== t.abbr) patch.abbr = fd.get("a" + t.id);
        if (Number(fd.get("f" + t.id)) !== t.faab) patch.faab = Number(fd.get("f" + t.id));
        if (L.divs && Number(fd.get("d" + t.id)) !== L.divs[t.id]) patch.div = Number(fd.get("d" + t.id));
        if (Object.keys(patch).length) { const r = G.editTeam(L, t.id, patch, at); if (!r.ok) { U.toast(`${t.name}: ${r.why}`, true); return false; } }
      }
      const wo = L.teams.map((t) => [Number(fd.get("w" + t.id)), t.id]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      if (wo.join() !== order.join()) { const r = G.setWaiverOrder(L, wo, at); if (!r.ok) { U.toast(r.why, true); return false; } }
      if (L.divs) { const names = L.divNames.map((_, k) => fd.get("dn" + k)); if (names.join("|") !== L.divNames.join("|")) { const r = G.setDivisions(L, names, at); if (!r.ok) { U.toast(r.why, true); return false; } } }
      commishSave({ ok: true }, "Teams saved.");
    }, { wide: true });
  }
  function moveDialog() {
    const ctx = lctx();
    U.dialog(`<h3>Move a player</h3><div class="stack"><label class="sr" for="cm-q">Find a player</label><input type="search" id="cm-q" placeholder="Find a player" autocomplete="off"><ul class="seatl" id="cm-res"></ul>
      <div class="acts"><button type="button" class="btn" data-close>Done</button></div></div>`, null, { wide: true });
    const dlg = $("#fk-dlg"), box = $("#cm-res", dlg);
    const draw = (q) => {
      q = q.trim().toLowerCase();
      const hits = q.length < 2 ? [] : players.filter((p) => p.n.toLowerCase().includes(q)).sort((a, b) => a.rank - b.rank).slice(0, 8);
      box.innerHTML = hits.length ? hits.map((p) => { const own = ctx.own[p.id]; return `<li><span class="grow"><b>${esc(p.n)}</b><small>${esc(S.positions(p).join(", "))} ${esc(p.t)}, ${own != null ? `on ${esc(teamName(own))}` : "free agent"}</small></span>
        <label class="sr" for="cm-to-${esc(p.id)}">Move to</label><select id="cm-to-${esc(p.id)}" data-cm-to="${esc(p.id)}">${L.teams.map((t) => opt(t.id, t.name, own)).join("")}${opt("", "Free agents", own == null ? "" : "x")}</select><button type="button" class="btn sm" data-cm-move="${esc(p.id)}">Move</button></li>`; }).join("")
        : `<li class="ps" style="padding:8px 0">${q.length < 2 ? "Type at least two letters of a name." : "Nobody by that name."}</li>`;
    };
    draw("");
    $("#cm-q", dlg).addEventListener("input", (e) => draw(e.target.value));
    $("#cm-q", dlg).focus();
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cm-move]"); if (!b) return;
      const pid = b.dataset.cmMove, v = $(`[data-cm-to="${CSS.escape(pid)}"]`, box).value, to = v === "" ? null : Number(v);
      if (commishSave(G.commishMove(L, lctx(), pid, to, now()), `${byId[pid].n} moved ${to == null ? "to free agency" : `to ${teamName(to)}`}.`)) draw($("#cm-q", dlg).value);
    });
  }
  function deleteDialog() {
    const name = info.name;
    U.dialog(`<h3>Delete ${esc(name)}?</h3><form class="stack"><p class="muted" style="margin:0">This deletes the league for everyone: every team, the season, its history and the chat. You can't undo it.</p>
      <div class="field"><label for="cm-del">Type the league's name to confirm</label><input id="cm-del" name="name" autocomplete="off" placeholder="${esc(name)}"></div>
      <div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn warn">Delete the league</button></div></form>`, async (fd) => {
      if (String(fd.get("name") || "").trim() !== name) { U.toast("Type the name exactly as it is.", true); return false; }
      const r = await C.rpc("fk_delete", { p_id: id, p_name: name }).catch((e) => ({ error: e.message }));
      if (r.error) { U.toast(r.error, true); return false; }
      location.href = "leagues.html";
    });
  }
  // before the draft: add a team, or remove one nobody has claimed
  // the commissioner sets the first-round order by hand or shuffles it, any time before the draft starts
  function orderDialog() {
    let list = D.round1.slice();
    const rows = () => list.map((t, i) => `<li class="ord-row"><span class="ord-n">${i + 1}</span>${U.teamAv(D.teams[t], "sm")}<b class="grow">${esc(D.teams[t].name)}</b>
      <button type="button" class="btn sm ghost" data-up="${i}" aria-label="Move ${esc(D.teams[t].name)} up"${i ? "" : " disabled"}>Up</button><button type="button" class="btn sm ghost" data-dn="${i}" aria-label="Move ${esc(D.teams[t].name)} down"${i < list.length - 1 ? "" : " disabled"}>Down</button></li>`).join("");
    U.dialog(`<h3>Draft order</h3><p class="muted" style="margin:0 0 8px">The first round's order. ${D.type === "linear" ? "Every round goes in this order." : D.type === "3rr" ? "Round two snakes back and round three reverses again." : "Later rounds snake back."}</p>
      <form class="stack"><ol class="ord" id="ord-l">${rows()}</ol>
      <div class="acts"><button type="button" class="btn ghost" data-shuf>Shuffle</button><span class="grow"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn go">Save order</button></div></form>`, () => {
      const r = F.setOrder(D, list);
      if (!r.ok) { U.toast(r.why, true); return false; }
      push(); mount(); U.toast("Draft order saved.");
    });
    const dlg = $("#fk-dlg");
    dlg.onclick = (e) => {
      const b = e.target.closest("[data-up],[data-dn],[data-shuf]"); if (!b) return;
      if (b.hasAttribute("data-shuf")) { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } }
      else { const i = +(b.dataset.up ?? b.dataset.dn), j = b.dataset.up != null ? i - 1 : i + 1; [list[i], list[j]] = [list[j], list[i]]; }
      $("#ord-l").innerHTML = rows();
    };
  }
  async function resizeTeams(remove) {
    const keep = D.teams.filter((t) => t.id !== remove);
    const list = keep.map((t) => ({ name: t.name, abbr: t.abbr, owner: t.owner, color: t.color }));
    if (remove == null) { const used = new Set(D.teams.map((t) => t.name)); const nm = ["Night Shift", "Bench Mob", "Waiver Wire", "Late Scratch", "Deep Sleepers", "Box Score", "Hot Corner", "Full Count", "Red Zone", "Fast Break", "Two Minute", "Garbage Time", "Pick Six", "Rain Delay", "Shot Clock", "Trade Deadline", "Home Stand", "Overtime", "Sixth Man", "Bye Week"].find((x) => !used.has(x)) || `Team ${D.teams.length + 1}`; list.push({ name: nm, abbr: nm.split(" ").map((w) => w[0]).join("").slice(0, 3).toUpperCase(), color: (D.teams.length * 5) % 12 }); }
    const r = F.resize(D, sport, list, players);
    if (!r.ok) { U.toast(r.why, true); return; }
    const map = {}; keep.forEach((t, i) => (map[t.id] = i));
    const res = await C.rpc("fk_resize", { p_id: id, p_version: version, p_draft: r.draft, p_map: map }).catch((e) => ({ error: e.message }));
    if (res.error === "stale") { U.toast("Someone else saved first. Try again.", true); version = -1; pull(); return; }
    if (res.error) { U.toast(res.error, true); return; }
    D = r.draft; version = res.version; base = clone({ draft: D, league: null });
    const s2 = {}; for (const [old, nw] of Object.entries(map)) if (info.seats[old] != null) s2[nw] = info.seats[old];
    info.seats = s2; if (info.me != null) info.me = map[info.me];
    mount(); U.toast(remove == null ? "Added a team." : "Removed the team.");
  }
  document.addEventListener("click", (e) => {
    const lv = e.target.closest("[data-live]"), th = e.target.closest("button[data-theme]");
    if (th) { theme.toggle(); if (app) app.render(); return; }
    if (lv && lv.dataset.live === "league") { e.preventDefault(); leagueDialog(); }
    if (lv && lv.dataset.live === "keepers") keeperDialog();
    if (lv && lv.dataset.live === "open-keepers") { L.next = { opened: now(), due: now() + 3 * 864e5, picks: {} }; push(); app.refresh(); U.toast("Keeper picks are open. Everyone gets an email."); }
    const cm = e.target.closest("[data-cm]");
    if (cm && info.commish) { const k = cm.dataset.cm; if (k === "rules") rulesDialog(); else if (k === "teams") teamsDialog(); else if (k === "move") moveDialog(); else if (k === "delete") deleteDialog(); }
    const rv = e.target.closest("[data-cm-rev]");
    if (rv && info.commish) { const tid = Number(rv.dataset.cmRev); U.confirm("Reverse this trade?", "Every player, pick and FAAB dollar goes back to the team that sent it.", "Reverse the trade", () => commishSave(G.reverseTrade(L, lctx(), tid, now()), "Trade reversed.")); }
    if (lv && lv.dataset.live === "new-season") U.confirm("Start next season?", "This season goes into the league's history, and the league opens a new draft room. You can't undo it.", "Start next season", newSeason);
    const fr = e.target.closest("#app [data-free]");
    if (fr) { const t = Number(fr.dataset.free); U.confirm(`Free ${teamName(t)}?`, `${esc(info.seats[t])} loses the team, and a bot runs it until someone else claims it with the invite link.`, "Free the team", async () => {
      const r = await C.rpc("fk_leave", { p_id: id, p_team: t }).catch((err) => ({ error: err.message }));
      if (r.error) U.toast(r.error, true); else { U.toast("Done. The team is open."); version = -1; pull(); }
    }); }
  });

  window.addEventListener("hashchange", () => { if (/access_token=/.test(location.hash) && C.fromLink()) location.reload(); });
  boot().catch((e) => { console.error(e); fatal("Couldn't load the league.", `<span class="muted">${esc(e.message)}</span>`); });
})();
