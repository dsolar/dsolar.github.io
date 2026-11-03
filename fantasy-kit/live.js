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
    sport = S.withScoring(S.attach(Object.assign({}, S[info.sport]), data), D.scoringSpec);   // the league's custom scoring, if it has one
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
      notice: () => guestNote() + startNote() + keeperNote(),
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
      <div id="lv-past"></div>
      ${info.me != null ? `<label class="check" style="margin-top:10px"><input type="checkbox" id="lv-mail"${info.notify !== false ? " checked" : ""}> Email me about trade offers, waiver results${D && D.clock >= 3600 ? ", my turn in the draft" : ""} and weekly results</label>` : ""}
      <div class="row ps" style="margin:12px 0 0;gap:6px 16px;flex-wrap:wrap"><span>${u ? `Signed in as ${esc(u.email)}` : `<a href="leagues.html">Sign in</a> to make moves`}</span><span class="grow"></span>${u ? `<button type="button" class="btn sm ghost" data-lv="out">Sign out</button>` : ""}<button type="button" class="btn sm ghost" data-lv="theme">${theme.dark() ? "Light mode" : "Dark mode"}</button></div>`, null, { wide: true });
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
      <form><ul class="seatl kp">${opts.map((o) => `<li><label class="check" style="flex:1;min-width:0"><input type="checkbox" name="k" value="${esc(o.pid)}"${cur.includes(o.pid) ? " checked" : ""}> <span class="ell"><b>${esc(o.n)}</b> <small>${esc(o.cost.label)}</small></span></label><span class="tag${o.surplus > 0 ? " win" : ""}">${o.surplus > 0 ? "Good value" : "Costly"}</span></li>`).join("")}</ul>
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
      <p class="small" style="margin:0">${k ? "Keeper picks are open." : "The season is over."} Starting next season saves this one to the league's history and opens a new draft room${k ? " with the keepers on the board" : ""}, worst team picking first.</p>
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
  function commishTools() {
    return `<div class="head"><h1 class="disp">Commissioner</h1><span class="ps">Invite managers and manage teams. Changes save for everyone.</span></div>
      ${nextSeasonCard()}
      <div class="cols2"><div class="card"><div class="mod-h"><h2>Invite link</h2></div><div class="bd stack">
        <p class="small" style="margin:0">Anyone with this link can sign in and take an open team, even mid-season.</p>
        <button class="btn go" data-live="league">Show the invite link</button></div></div>
      <div class="card"><div class="mod-h"><h2>Managers</h2></div><div class="bd">${seatList()}</div></div></div>`;
  }
  document.addEventListener("click", (e) => {
    const lv = e.target.closest("[data-live]"), th = e.target.closest("button[data-theme]");
    if (th) { theme.toggle(); if (app) app.render(); return; }
    if (lv && lv.dataset.live === "league") { e.preventDefault(); leagueDialog(); }
    if (lv && lv.dataset.live === "keepers") keeperDialog();
    if (lv && lv.dataset.live === "open-keepers") { L.next = { opened: now(), due: now() + 3 * 864e5, picks: {} }; push(); app.refresh(); U.toast("Keeper picks are open. Everyone gets an email."); }
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
