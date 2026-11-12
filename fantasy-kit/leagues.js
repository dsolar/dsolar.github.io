/* Your leagues: sign in with an emailed link, see the shared leagues you're in, start one, or join from an invite
   link (leagues.html?join=<id>&code=<invite>). The leagues themselves open in play.html. */
(function () {
  "use strict";
  const { sports: S, value: V, draft: F, ui: U, cloud: C } = window.FK;
  const { esc, $ } = U;
  const theme = U.theme("fk-lab");
  const params = new URLSearchParams(location.search);
  const joinId = params.get("join"), joinCode = params.get("code") || "";
  const top = $("#top"), app = $("#app");
  const link = C.fromLink();
  const SPORT_CLR = { nba: 4, nfl: 2, mlb: 0 };
  const BLURB = { nba: "Points or categories", nfl: "PPR, half or standard", mlb: "Roto or points" };
  let sent = null, busy = false, view = "list";
  // signing in: siMode is "password" (username or email and a password), "signup", "forgot" or "link" (an emailed
  // link). confirmTo: a new account waiting on its confirmation email; resetTo: a reset link was asked for.
  // recovery: a reset link brought you back signed in, so the page asks for a new password first.
  let provs = null;
  let siMode = "password", confirmTo = null, resetTo = null, recovery = !!(link && link.recovery);
  // a showdown's games: this week's, from the live feed, loaded when the format is picked (null until then)
  // one-week football: this week's and next week's games (the live feed), and the slate the form has picked
  const SL = window.FK.slates;
  // one-day basketball: today's and tomorrow's games, each day shaped like a week with a day (slates.js reads both)
  const slatesFor = {}, slatesAsked = {};
  const slData = () => slatesFor[form.sport] || null;
  function loadSlates() {
    const k = form.sport;
    if (slatesAsked[k] || !SLATE_SPORTS.includes(k)) return;
    slatesAsked[k] = true;
    // a feed that couldn't be reached ({ error }) is asked again from Try again (data-a="slates-retry")
    C.slates(k).then((d) => { slatesFor[k] = d && Array.isArray(d.weeks) ? d : { weeks: [], error: true }; render(); });
  }
  const SLATE_SPORTS = ["nfl", "nba"];
  // how many players each pro team has (data/<sport>.json), so a slate offers only the team counts its players can
  // fill: one football game's two teams have 30 or so, enough for five teams of six but not six
  const proCounts = {}, proAsked = {};
  function loadPros() {
    const k = form.sport;
    if (proAsked[k]) return;
    proAsked[k] = true;
    fetch(`data/${k}.json`, { cache: "no-cache" }).then((r) => r.json()).then((d) => { const c = {}; for (const p of d.players || []) c[p.t] = (c[p.t] || 0) + 1; proCounts[k] = c; render(); }).catch(() => {});
  }
  // the players a slate drafts from, and the most teams that can each fill a roster from them (null: no limit known)
  function slateRoom() {
    const sl = slateOn() && !capOn() ? curSlate() : null;
    if (!sl) return null;
    loadPros();
    const proCount = proCounts[form.sport];
    if (!proCount) return null;
    const sp = S[form.sport], players = sl.teams.reduce((a, t) => a + (proCount[t] || 0), 0), per = lineupOf(sp).length + benchOf(sp);
    return { players, per, games: sl.games.length, max: Math.max(2, Math.floor(players / Math.max(1, per))) };
  }
  const slWeeks = () => ((slData() && slData().weeks) || []).filter((w) => SL.list(w).length);
  const slWeek = () => { const ws = slWeeks(); return ws[Math.min(form.slWeek || 0, Math.max(0, ws.length - 1))] || null; };
  const slateOn = () => oneWeek() && SLATE_SPORTS.includes(form.sport);
  const dayOn = () => slateOn() && form.sport === "nba";
  function curSlate() {
    const w = slWeek(); if (!w) return null;
    const kind = form.slKind || "full";
    if (kind === "one") return SL.pick(w, "one", [form.slOne || (SL.open(w)[0] || {}).id]);
    if (kind === "custom") return (form.slGames || []).length ? SL.pick(w, "custom", form.slGames) : null;
    return SL.pick(w, kind) || SL.pick(w, "full");
  }
  // one game: a showdown, with its own lineup and budget
  // (a basketball game is a day slate of one: its captain comes from the slate's lineup, not a football showdown)
  const sdGame = () => { const sl = slateOn() ? curSlate() : null; return sl && sl.games.length === 1 && !sl.day ? { id: sl.games[0].id, at: Date.parse(sl.games[0].at), home: sl.games[0].home, away: sl.games[0].away, week: sl.week } : null; };
  const kickLabel = (t) => new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }).replace(":00", "");
  const form = { sport: S.inSeason(), teams: 10, type: "snake", clock: 90, season: "h2h", weeks: 14, trades: 1, scoring: "",
    lineup: "", bench: null, playoffs: 4, deadline: null, review: "vote", faab: null, waiverDays: 2, gameLock: null,
    weights: null, cats: null, waivers: "faab", ir: 1, maxAdds: 0, posMax: {}, keepers: 0, keeperCost: "round", legs: "1", cons: "none", median: 0, bestball: 0, divs: 0, rookie: 3, fpicks: 1, taxi: 2, ohold: "clock", tep: 0, ptd: 4, b100r: 0, b100c: 0, b300p: 0, vamp: "off", vlike: 0, vdouble: 0,
    reviewHours: 24, vetoShare: 0.5, waiverOrder: "rolling", minBid: 0, waiverPrice: "first", maxAddsSeason: 0,
    open: {}, capBudget: 100, capBonus: 1, confOn: 0, tvOn: 0, pyoOn: 0, robinOn: 0, robinP: 2, conqOn: 0, conqP: 3, conqLike: 0, crownOn: 0, crownStep: 10, crownKeep: 5, hangOn: 0, tbOn: 0, tbAmt: 25, reveal: "start", kind: "redraft", when: "now", rlOn: 0, rlRound: 0, respins: 1, hzOn: 0, hzShields: 3, hzSteals: 1, hzJinxes: 1, hzClock: 60, keepN: 3, tepOn: 0, tepAmt: 0.5, b100rOn: 0, b100rAmt: 3, b100cOn: 0, b100cAmt: 3, b300pOn: 0, b300pAmt: 3, vampOn: 0, vampWho: "random" };
  // a vampire league: football, head to head on points, and a draft where one team can simply sit out
  const vampOk = () => form.sport === "nfl" && form.season === "h2h" && ["snake", "linear", "3rr"].includes(form.type);
  // scoring: a preset key, or "cp" (custom points) / "cc" (custom categories)
  const isCustom = () => form.scoring === "cp" || form.scoring === "cc";
  const scoringType = (sp) => (form.scoring === "cp" ? "points" : form.scoring === "cc" ? "cats" : (sp.scorings[form.scoring] || Object.values(sp.scorings)[0]).type);
  // season: how a week is decided. Category leagues can count each category, or go rotisserie; points leagues can add all-play.
  const SEASONS = { cats: [["h2h", "Head to head: most categories wins the week"], ["h2hcats", "Head to head: each category is a win or loss"], ["roto", "Rotisserie: season totals"], ["guillotine", "Guillotine"]],
    points: [["h2h", "Head to head"], ["allplay", "All-play: your score against every team"], ["guillotine", "Guillotine"]] };
  const h2hLike = () => form.season === "h2h" || form.season === "h2hcats" || form.season === "allplay";
  // the sport's standard lineup, without slots its player pool can't fill
  // one-week football starts eight, no kicker or defense; a heist has no bench at all
  const ONE_WEEK_NFL = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX"];
  // a heist needs the full one-week lineup, so a slate of eight games or more
  const heist = () => !!form.hzOn && form.type !== "cap" && slateOn() && form.sport === "nfl" && form.season === "h2h" && !!curSlate() && curSlate().games.length >= 8;
  // a salary cap game (one-week football, points): no draft, a lineup under a budget, players on any number of teams.
  // A sealed draft: everyone ranks players in private and the draft runs itself when the lists lock.
  const capOn = () => form.type === "cap" && slateOn();
  const sealedOn = () => form.type === "sealed";
  const noRoom = () => capOn() || sealedOn();
  const draftType = () => (form.type === "cap" || form.type === "sealed" ? "snake" : form.type);
  // with no draft, every team can start the slate's quarterbacks, so it's never a superflex
  const slateLU = () => { const sl = slateOn() && !heist() ? curSlate() : null; return sl ? SL.lineup(sl.games.length, capOn() ? 2 : form.teams, form.sport) : null; };
  const lineupOf = (sp) => (heist() ? ONE_WEEK_NFL.slice() : slateLU() ? slateLU().lineup.slice() : form.lineup ? form.lineup.split(" ") : oneWeek() && sp.key === "nfl" ? ONE_WEEK_NFL.slice() : sp.lineup.slice()).filter((x) => sp.slots[x] && x !== "BN");
  const benchOf = (sp) => (heist() || capOn() ? 0 : slateLU() ? slateLU().bench : form.bench != null ? form.bench : oneWeek() && sp.key === "nfl" ? 2 : sp.bench);
  if (S.ALL[params.get("s")]) { form.sport = params.get("s"); view = "new"; }
  // leagues.html?rematch=<id>: run a one-week game back, next week, with the same managers in the same seats
  const rematchId = params.get("rematch");
  let rematch = null, rematchErr = "";
  async function loadRematch() {
    const v = await C.rpc("fk_view", { p_id: rematchId, p_since: null }).catch((e) => ({ error: e.message }));
    if (!v || v.error || !v.draft) { rematchErr = (v && v.error) || "Couldn't load that game."; return; }
    const D0 = v.draft, s0 = D0.season || {}, doc = v.league || D0;
    rematch = { id: rematchId, name: v.name, n: D0.teams.length, teams: doc.teams.map((t) => ({ name: t.name, abbr: t.abbr, color: t.color, shape: t.shape, glyph: t.glyph, img: t.img })) };
    const kind = s0.slate ? s0.slate.kind : s0.showdown ? "one" : "full";
    form.me = form.me || (prof && prof.name) || (v.me != null && v.seats ? v.seats[v.me] : "") || "Me";
    Object.assign(form, { kind: "week", wkSet: 1, sport: v.sport, teams: D0.teams.length, name: v.name, type: D0.type || "snake", clock: D0.clock || 30,
      season: s0.tally === "allplay" ? "allplay" : s0.tally === "cats" ? "h2hcats" : "h2h", slKind: kind === "custom" ? "full" : kind, slWeek: 0, hzOn: s0.heist ? 1 : 0, bestball: s0.bestBall ? 1 : 0 });
    if (D0.scoring && S[v.sport] && S[v.sport].scorings[D0.scoring]) form.scoring = D0.scoring;
    if (D0.cap) Object.assign(form, { type: "cap", capBudget: D0.cap.budget, capBonus: D0.cap.bonus ? 1 : 0 });
    else if (D0.sealed) form.type = "sealed";
    if (s0.confMax) form.confOn = 1;
    if (D0.trivia) form.tvOn = 1;
    form.dtMode = "at"; form.dtAt = null;
    view = "new"; loadSlates();
  }
  // leagues.html?w=1: start a one-week game (from the One week page, or a slate picked there)
  if (params.get("w")) {
    form.kind = "week"; if (!S.ALL[params.get("s")]) form.sport = "nfl"; view = "new"; oneWeekDefaults();
    if (["full", "sunday", "prime", "early", "late", "one", "custom"].includes(params.get("slate"))) form.slKind = params.get("slate");
    if (params.get("game")) { form.slKind = "one"; form.slOne = params.get("game"); }
    if (params.get("wk") === "1") form.slWeek = 1;
    loadSlates();
  }

  function header() {
    top.innerHTML = U.shell({ brand: { name: "Draft Lab", href: "./", mark: `<img src="mark.svg" alt="">` },
      tabs: [["leagues", "Your leagues"], ["week", "Quick games"], ["draft", "Mock draft"], ["rankings", "Rankings"], ["league", "Demo league"]], tab: view === "new" && oneWeek() ? "week" : "leagues",
      right: `${C.user() ? `<button class="btn sm ghost" data-a="out">Sign out</button>` : ""}<button class="btn sm ghost" data-theme>${theme.dark() ? "Light" : "Dark"}</button>`,
      hrefOf: (t) => (t === "leagues" ? "leagues.html" : t === "week" ? "week.html" : t === "league" ? "league.html" : "./#" + t) });
  }
  const page = (html) => { app.innerHTML = `<div class="wrap page">${html}</div>`; U.pushBox($("#lg-push")); };
  const fail = (msg) => `<div class="banner loss" role="alert"><b>${esc(msg)}</b></div>`;
  const back = () => location.origin + location.pathname + location.search;

  // your profile: one name and photo for every league (fk_profile_me), loaded once you're signed in
  let prof = null;
  async function loadProfile() {
    if (!C.user()) { prof = null; return; }
    const r = await C.rpc("fk_profile_me", {}).catch(() => null);
    prof = r && r.ok ? r : null;
    if (prof && prof.name && !(form.me || "").trim()) form.me = prof.name;
  }
  const profChip = () => prof ? `<button type="button" class="pf-chip" data-a="profile">${U.faceAv(prof, prof.name, "md")}<span>${esc(prof.name || "Add your name")}<small style="display:block">${prof.saved ? "Edit your profile" : "Set up your profile"}</small></span></button>` : "";
  async function render() {
    header();
    const u = C.user();
    if (u && !prof) await loadProfile();
    const err = link && link.error ? fail(`That sign-in link didn't work: ${link.error}. Send yourself a new one.`) : "";
    let invite = "";
    if (joinId) {
      const v = await C.rpc("fk_view", { p_id: joinId, p_since: null }).catch((e) => ({ error: e.message }));
      invite = v.error ? fail(v.error) : u ? joinCard(v) : "";
      if (!u && !v.error) return page(`${err}${signInCard(v)}`);
    }
    if (!u) return page(`${err}${invite}${signInCard()}`);
    if (rematchId && !rematch && !rematchErr) await loadRematch();
    if (rematchErr) return page(fail(rematchErr));
    if (recovery) return page(newPasswordCard());
    if (view === "new") return page(newForm());
    const mine = await C.rpc("fk_mine", {}).catch((e) => ({ error: e.message }));
    // on an invite, the join form is the page; your other leagues, if any, follow it quietly
    if (joinId) return page(`${err}${invite}${Array.isArray(mine) && mine.length ? `<div class="head" style="margin-top:8px"><h2 style="margin:0">Your other leagues</h2></div><div class="lgl">${mine.map(card).join("")}</div>` : ""}`);
    page(`${err}${invite}
      <div class="su sp-${S.inSeason()}"><div class="nl-band lg-band">${FIELD[S.inSeason()]}<div class="nl-bi"><h1 class="disp">Your leagues</h1>${profChip()}<p>Signed in as ${esc(u.email)}${prof && prof.username ? `, username <b style="color:#fff">${esc(prof.username)}</b>` : ""}</p><div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn go" data-a="new">Start a league</button><button class="btn" data-a="account">${prof && prof.username ? "Username and password" : "Set a username and password"}</button></div></div></div>
      <div id="lg-push"></div>
      ${mine.error ? fail(mine.error) : mine.length ? `<div class="lgl">${mine.map(card).join("")}</div>` : joinId ? "" : `<div class="card"><div class="bd stack"><p style="margin:0"><b>No leagues yet.</b></p><p class="ps" style="margin:0">Start one and send your friends the invite link, or open the invite link your commissioner sent you.</p><div><button class="btn go" data-a="new">Start a league</button></div></div>`}</div>`);
  }
  // One league in the list: your team, where the league is, and your record or the draft's progress.
  function card(l) {
    const c = l.card || {}, when = (t) => new Date(t).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const total = c.weeks != null ? c.weeks + (c.playoffWeeks || 0) : null;
    let status = "", big = "", small = "", bar = null;
    if (l.phase === "season") {
      if (c.start && Date.now() < c.start) status = `Week 1 starts ${when(c.start)}`;
      else if (total != null && c.week > total) status = "Season over";
      else if (c.week != null) status = c.weeks != null && c.week > c.weeks ? `Playoffs, week ${c.week}` : `Week ${c.week}${c.weeks ? ` of ${c.weeks}` : ""}`;
      if (c.format === "guillotine") { big = c.alive === false ? "Out" : c.alive ? "Alive" : ""; small = c.alive === false ? "Chopped" : "Still standing"; }
      else if (c.format !== "roto" && l.team != null && c.w != null && (c.w || c.l || c.t)) { big = `${c.w}-${c.l}${c.t ? "-" + c.t : ""}`; small = "Record"; }
    } else if (l.phase === "live") { status = "Drafting now"; if (c.total) { bar = c.picks / c.total; big = `${c.picks}`; small = `of ${c.total} picks`; } }
    else if (l.phase === "done") status = "Draft done, the season starts soon";
    else { status = "Draft room open"; if (c.teams) { big = `${c.claimed}/${c.teams}`; small = "teams claimed"; } }
    const sub = [c.teamName ? esc(c.teamName) : "", esc(status), l.commish ? "you're the commissioner" : ""].filter(Boolean).join(", ");
    return `<a class="card lgc" href="play.html?id=${esc(l.id)}">${l.phase === "season" || l.brand ? `<span class="lg-cr">${U.leagueCrest(U.leagueBrand(l.name, l.brand))}</span>` : `<span class="lg-sp sp-${esc(l.sport)}">${icon(l.sport)}</span>`}
      <span class="grow"><b>${esc(l.name)}</b><small>${esc(S[l.sport].name)}${sub ? `: ${sub}` : ""}</small>${bar != null ? `<span class="lgbar" role="img" aria-label="${Math.round(bar * 100)}% of picks in"><i style="width:${(bar * 100).toFixed(1)}%"></i></span>` : ""}</span>
      ${big ? `<span class="lgstat${l.phase === "live" ? " live" : ""}"><b>${esc(big)}</b><small>${esc(small)}</small></span>` : ""}<span class="btn sm">Open</span></a>`;
  }

  function signInCard(inv) {
    const k0 = inv && S[inv.sport] ? inv.sport : S.inSeason();
    const band = (title, body) => `<div class="su sp-${k0}"><div class="nl-band si-band">${FIELD[k0]}<div class="nl-bi"><h1 class="disp">${title}</h1>${body}</div></div></div>`;
    if (sent) return band("Check your email", `<p>We sent a sign-in link to <b style="color:#fff;overflow-wrap:anywhere">${esc(sent)}</b>.</p>
        <div class="si-card">
          <ol class="si-steps"><li>Open the email from Draft Lab on the phone or computer you want to play on.</li><li>Tap <b>Sign in</b>. The link works once and expires in an hour.</li><li>You land back here, signed in.</li></ol>
          <p class="ps">Nothing there after a minute? Check spam, or send it again.</p>
          <div class="si-row"><button class="btn go" data-a="resend">Send it again</button><button class="btn" data-a="again">Use a different email</button></div></div>`);
    if (confirmTo) return band("Confirm your email", `<p>Your account is made. We sent a confirmation link to <b style="color:#fff;overflow-wrap:anywhere">${esc(confirmTo)}</b>.</p>
        <div class="si-card">
          <ol class="si-steps"><li>Open the email from Draft Lab.</li><li>Tap <b>Confirm</b>. You land back here, signed in.</li><li>After that, sign in any time with your username and password.</li></ol>
          <p class="ps">Nothing there after a minute? Check spam.</p>
          <div class="si-row"><button class="btn" data-a="si-mode" data-m="password">Back to sign in</button></div></div>`);
    if (resetTo) return band("Check your email", `<p>If <b style="color:#fff;overflow-wrap:anywhere">${esc(resetTo)}</b> has an account, we sent it a link to reset the password.</p>
        <div class="si-card"><ol class="si-steps"><li>Open the email and tap the reset link.</li><li>You land back here and pick a new password.</li></ol>
          <div class="si-row"><button class="btn" data-a="si-mode" data-m="password">Back to sign in</button></div></div>`);
    const lead = inv ? `<p class="jn-kick">${icon(k0, "sp-ic")}You're invited</p><h1 class="disp">${esc(inv.name)}</h1>
        <p>A ${esc(S[k0].name.toLowerCase())} league with ${inv.draft.teams.length} teams. Sign in or make an account, then pick your team.</p>` : `<h1 class="disp">Draft with your friends.</h1>
        <p>Start a league, send the invite link and draft live. Every move saves for the whole league, and you can get an email when a trade offer or a waiver result needs you.</p>`;
    const tabs = `<div class="si-tabs" role="tablist" aria-label="Sign in or make an account">${[["password", "Sign in"], ["signup", "Create account"]].map(([m, n]) => `<button type="button" role="tab" aria-selected="${siMode === m || (m === "password" && (siMode === "forgot" || siMode === "link"))}" data-a="si-mode" data-m="${m}">${n}</button>`).join("")}</div>`;
    const pwField = (id, auto, label) => `<label for="${id}">${label}</label><div class="si-pw"><input id="${id}" type="password" autocomplete="${auto}" required minlength="${auto === "new-password" ? 8 : 1}"><button type="button" class="si-show" data-a="si-show" data-for="${id}" aria-label="Show password">Show</button></div>`;
    const alt = (items) => `<div class="si-alt">${items.map(([m, n]) => `<button type="button" class="si-link" data-a="si-mode" data-m="${m}">${n}</button>`).join("")}</div>`;
    const go = (label) => `<button class="btn go si-go" type="submit"${busy ? " disabled" : ""}>${busy ? "One moment…" : label}</button>`;
    // Google (or Apple), once it's switched on in Supabase
    if (!provs) C.providers().then((p) => { provs = p; if (p.google || p.apple) render(); });
    const outside = provs && (provs.google || provs.apple) ? `<div class="si-oauth">${provs.google ? `<button type="button" class="btn si-oa" data-a="oauth" data-p="google">Continue with Google</button>` : ""}${provs.apple ? `<button type="button" class="btn si-oa" data-a="oauth" data-p="apple">Continue with Apple</button>` : ""}<p class="ps si-or">or</p></div>` : "";
    const forms = {
      password: `<form class="si-card" id="pw-in">${tabs}${outside}
          <label for="pi-login">Username or email</label><input id="pi-login" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${esc(C.lastEmail())}">
          ${pwField("pi-pw", "current-password", "Password")}${go("Sign in")}
          ${alt([["forgot", "Forgot your password?"], ["link", "Email me a sign-in link instead"]])}
          <p class="ps">Signed in with an emailed link before? Use a link once more, then set a username and password from your profile.</p></form>`,
      signup: `<form class="si-card" id="pw-up">${tabs}${outside}
          <label for="pu-user">Username</label><input id="pu-user" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="20" pattern="[A-Za-z0-9_.\\x2D]{3,20}" aria-describedby="pu-user-h"><p class="ps" id="pu-user-h">3 to 20 letters, numbers, dots, dashes or underscores. It's how you sign in.</p>
          <label for="pu-email">Email</label><input id="pu-email" type="email" autocomplete="email" required value="${esc(C.lastEmail())}" aria-describedby="pu-email-h"><p class="ps" id="pu-email-h">For league alerts and resetting your password. Other managers never see it.</p>
          ${pwField("pu-pw", "new-password", "Password")}<p class="ps">At least 8 characters.</p>${go("Create account")}</form>`,
      forgot: `<form class="si-card" id="pw-forgot">${tabs}
          <p class="si-note">Enter your username or email. We'll email you a link to pick a new password.</p>
          <label for="pf-login">Username or email</label><input id="pf-login" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${esc(C.lastEmail())}">
          ${go("Email me a reset link")}${alt([["password", "Back to sign in"]])}</form>`,
      link: `<form class="si-card" id="signin">${tabs}
          <label for="si-email">Email</label>
          <div class="si-row"><input id="si-email" type="email" autocomplete="email" required value="${esc(C.lastEmail())}" placeholder="you@example.com"><button class="btn go" type="submit"${busy ? " disabled" : ""}>Email me a sign-in link</button></div>
          <p class="ps">No password needed: the link signs you in.</p>${alt([["password", "Use a password instead"]])}</form>`,
    };
    return `<div class="su sp-${k0}"><div class="nl-band si-band">${FIELD[k0]}<div class="nl-bi">${lead}${forms[siMode] || forms.password}</div></div>
      <div class="mk-how" style="margin-top:14px">
        <div class="mk-tip"><b>Draft live or slow</b><p>Snake, auction, mystery packages or white elephant, with a pick clock from 30 seconds to 8 hours.</p></div>
        <div class="mk-tip"><b>A whole season</b><p>Lineups, waivers, trades and playoffs, scored from real games. Redraft, keeper or dynasty.</p></div>
        <div class="mk-tip"><b>Your formats</b><p>Guillotine, vampire, pick your opponent, Robin Hood, Conquest, Kingslayer, best ball and more.</p></div>
      </div></div>`;
  }
  // after a reset link: pick the new password before anything else
  const newPasswordCard = () => `<div class="card" style="max-width:520px;margin:0 auto 16px"><div class="mod-h"><h2>Pick a new password</h2></div><form class="bd stack" id="pw-new">
      <div class="field"><label for="pn-pw">New password</label><div class="si-pw"><input id="pn-pw" type="password" autocomplete="new-password" required minlength="8"><button type="button" class="si-show" data-a="si-show" data-for="pn-pw" aria-label="Show password">Show</button></div><p class="ps" style="margin:4px 0 0">At least 8 characters.</p></div>
      <div class="row" style="gap:8px"><button class="btn go" type="submit">Save the password</button><button type="button" class="btn ghost" data-a="pw-skip">Not now</button></div></form></div>`;
  // username and password for a signed-in account (people who signed up with an emailed link have neither)
  function accountDialog() {
    const u = C.user(), un = prof && prof.username;
    U.dialog(`<h3>Username and password</h3><p class="ps" style="margin:0 0 12px">Signed in as ${esc(u ? u.email : "")}. Sign in with your username or this email, and your password.</p>
      <form id="acct-user" class="stack" style="gap:6px"><label for="ac-user">Username</label><div class="si-row"><input id="ac-user" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20" required value="${esc(un || "")}" placeholder="Pick one"><button class="btn" type="submit">${un ? "Change it" : "Save it"}</button></div><p class="ps" style="margin:0">3 to 20 letters, numbers, dots, dashes or underscores.</p></form>
      <form id="acct-pw" class="stack" style="gap:6px;margin-top:16px"><label for="ac-pw">${prof && prof.hasPassword === false ? "Set a password" : "New password"}</label><div class="si-row"><div class="si-pw" style="flex:1 1 220px"><input id="ac-pw" type="password" autocomplete="new-password" minlength="8" required><button type="button" class="si-show" data-a="si-show" data-for="ac-pw" aria-label="Show password">Show</button></div><button class="btn" type="submit">Save the password</button></div><p class="ps" style="margin:0">At least 8 characters.</p></form>`, null, { wide: true });
    const D = $("#fk-dlg");
    D.querySelector("#acct-user").onsubmit = async (e) => {
      e.preventDefault();
      const r = await C.rpc("fk_username_set", { p_username: $("#ac-user").value.trim() }).catch((err) => ({ error: err.message }));
      if (!r || r.error) { U.toast((r && r.error) || "Couldn't save that.", true); return; }
      prof = Object.assign({}, prof, { username: r.username }); U.toast(`Your username is ${r.username}.`); D.close(); render();
    };
    D.querySelector("#acct-pw").onsubmit = async (e) => {
      e.preventDefault();
      try { await C.setPassword($("#ac-pw").value); U.toast("Password saved."); D.close(); } catch (err) { U.toast(err.message, true); }
    };
  }
  function joinCard(v) {
    const teams = v.draft.teams, seats = v.seats || {};
    if (v.me != null) return `<div class="banner"><b>You're already in ${esc(v.name)}.</b> <a href="play.html?id=${esc(joinId)}">Open the league</a></div>`;
    const open = teams.map((t, i) => [t, i]).filter(([, i]) => seats[i] == null);
    if (!open.length) return fail(`Every team in ${v.name} has a manager.`);
    const u = C.user(), guess = (prof && prof.name) || (u.email.split("@")[0] || "").replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 24);
    const k = v.sport;
    return `<div class="su sp-${k}"><form id="join"><div class="nl-band si-band jn-band">${FIELD[k] || ""}<div class="nl-bi">
        <p class="jn-kick">${icon(k, "sp-ic")}You're invited</p>
        <h1 class="disp">${esc(v.name)}</h1>
        <p>${esc(S[k].name)}, ${teams.length} teams, ${open.length} open${v.draft.phase !== "setup" ? ". The draft has started, so you take over that team's picks." : ". Pick a team and you're in."}</p>
      </div></div>
      <div class="nl-ess jn-body">
        <div class="fl"><div class="fl-l">Pick your team</div><fieldset class="seats"><legend class="sr">Pick a team</legend>${teams.map((t, i) => `<label class="${seats[i] != null ? "taken" : ""}"><input type="radio" name="team" value="${i}"${seats[i] != null ? " disabled" : open[0][1] === i ? " checked" : ""}>${U.teamAv(t, "sm")}<span><b>${esc(t.name)}</b><small>${seats[i] != null ? esc(seats[i]) : "Open"}</small></span></label>`).join("")}</fieldset></div>
        <div class="g2"><div class="fl"><div class="fl-l"><label for="j-name">Your name</label></div><input id="j-name" type="text" maxlength="24" required value="${esc(guess)}" autocomplete="name"></div><div class="fl"><div class="fl-l"><label for="j-team">Your team's name</label></div><input id="j-team" type="text" maxlength="28" placeholder="Leave blank to keep it" autocomplete="off"></div></div>
        <div><button class="btn go" type="submit">Join the league</button></div>
      </div></form></div>`;
  }

  /* ---------- start a league: six steps, one at a time, with a live summary beside them ---------- */
  const { ICON, icon, DRAFTS, RANGE_FMT, opt, fid, seg, cards, stepper, toggle, range, numIn, fld, group, art, pickCards, FIELD } = window.FK.setup;
  const SEASON_SUB = { h2h: "Play one team a week", h2hcats: "Every category is its own win or loss", roto: "Rank in each category over the whole season", allplay: "Your score against every team, every week", guillotine: "The lowest score is cut each week" };
  const BONUS = { tep: 0.5, b100r: 3, b100c: 3, b300p: 3 };
  const noLimit = (x) => (x ? `${x}` : "No limit");

  // the league's style: one card that sets the few choices that define it
  // two choices define a league: what carries over to next season, and how a season is played
  // first, a season or one week; then for a season, what carries over to the next one
  const MODES = [["season", "A season", "Lineups, waivers, trades and playoffs, all season long"], ["week", "Quick game", "Draft, play one real night or week, crown a winner"]];
  // the mode card's name for basketball, where a one-week game is one night
  const modeName = (k) => (k === "week" && form.sport === "nba" ? ["One day", "Draft tonight's games, crown a winner by midnight"] : null);
  const KINDS = [["redraft", "Redraft", "A fresh draft every season"], ["keeper", "Keeper", "Keep a few players a year"], ["dynasty", "Dynasty", "Keep everyone, draft rookies"]];
  // a one-week league: head to head only, and it plays the week that's on or the next one
  const oneWeek = () => form.kind === "week";
  const WEEK_OK = ["h2h", "h2hcats", "allplay"];
  // the formats a league type can use: one week is head to head; a guillotine or vampire is a single season
  const formatFits = (k) => (oneWeek() ? WEEK_OK.includes(k) : (k !== "guillotine" && k !== "vampire") || form.kind === "redraft") && k !== "showdown" || (k === "showdown" && oneWeek());
  // the week that's on (its start, the latest Monday 13:00 UTC, Tuesday for football) and the next, as dates to show
  function weekChoices(sp) {
    const DAY = 864e5, want = sp.key === "nfl" ? 2 : 1, now = Date.now(), d = new Date(now);
    d.setUTCHours(13, 0, 0, 0);
    let back = (d.getUTCDay() - want + 7) % 7; if (back === 0 && d.getTime() > now) back = 7;
    const cur = d.getTime() - back * DAY, next = cur + 7 * DAY;
    const day = (t) => new Date(t).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
    // the week ends the morning after its last day of games
    return { cur, next, left: next - now, curLabel: `${day(cur)} to ${day(next - DAY)}`, nextLabel: `${day(next)} to ${day(next + 6 * DAY)}` };
  }
  const FORMATS = { h2h: ["Head to head", "Play one team a week"], h2hcats: ["Head to head, each category", "Every category is its own win or loss"], roto: ["Rotisserie", "Season totals, ranked category by category"],
    allplay: ["All-play", "Your score against every team, every week"], showdown: ["Showdown", "One game: a captain at 1.5x and five flex"], guillotine: ["Guillotine", "The lowest score is cut every week"], vampire: ["Vampire", "One team skips the draft and steals"] };
  const formatOf = () => (vampOk() && form.vampOn ? "vampire" : form.season);
  function teamsHint() {
    const n = form.teams;
    const room = oneWeek() ? slateRoom() : null, all = showdown() && !capOn() ? 6 : form.season === "allplay" ? 16 : 20;
    const cap = room && room.max < all ? ` ${room.games === 1 ? "This game has" : "These games have"} ${room.players} players, enough for ${Math.max(...teamVals())} teams of ${room.per}.` : "";
    if (oneWeek()) return (form.season === "allplay" ? (n === 2 ? "Just the two of you: the higher score wins." : `Everyone is ranked 1 to ${n} on points. The top score wins.`) : n === 2 ? "Just you and one other team, head to head." : `${n / 2} games: everyone is paired off.`) + cap;
    if (form.season === "guillotine") return `${n - 1} weeks: one team is chopped each week until one is left.`;
    if (form.season === "roto" || form.season === "allplay") return "Everyone is ranked against everyone, so any number works.";
    return n % 2 ? `With an odd number, one team has a bye each week.` : "";
  }
  const formatsFor = (sp) => seasonsFor(sp).map(([k]) => k).concat(sp.key === "nfl" && scoringType(sp) === "points" && !oneWeek() ? ["vampire"] : []);
  const showdown = () => slateOn() && !!sdGame();
  function pickFormat(k) {
    form.vampOn = 0;
    if (k === "vampire") { form.vampOn = 1; form.season = "h2h"; if (!["snake", "linear", "3rr"].includes(form.type)) form.type = "snake"; }
    else form.season = k;
    if (k === "guillotine" || k === "vampire") form.kind = "redraft";
    if (oneWeek() && !WEEK_OK.includes(k)) form.kind = "redraft";
    form.faab = null;
  }
  const { SC_SUB } = window.FK.setup;
  const DRAFT_SHORT = { cap: "Salary cap", sealed: "Sealed", snake: "Snake", auction: "Auction", linear: "Linear", "3rr": "Third-round reversal", mystery: "Mystery packages", elephant: "White elephant", pack: "Pack" };
  // a field drawn behind the header, one for each sport
  function newForm() {
    derive();
    const sp = S[form.sport];
    if (!(sp.scorings[form.scoring] || isCustom())) form.scoring = Object.keys(sp.scorings)[0];
    if (form.type === "cap" && !draftTypes(sp).includes("cap")) form.type = "snake";
    const auction = form.type === "auction";
    const seasons = SEASONS[scoringType(sp)];
    if (!seasons.some(([k]) => k === form.season)) form.season = "h2h";
    if (form.season === "guillotine" && form.kind === "dynasty") form.kind = "redraft";
    if (!form.clocks || form.clocks !== auction) { form.clocks = auction; const ok = auction ? [15, 30, 60] : [30, 60, 90, 120, 3600, 14400, 28800]; if (!ok.includes(form.clock)) form.clock = auction ? 15 : 90; }
    const V = values(sp), fmt = formatOf(), gl = form.season === "guillotine";
    // a guillotine empties chopped rosters and a vampire's steals would pile up year after year, so both are redraft only
    const oneYear = gl ? "guillotine" : fmt === "vampire" ? "vampire" : null;
    // every league type can be picked: one that a format doesn't allow switches the format instead (below, on click)
    const modes = pickCards("mode", MODES.map((m) => (modeName(m[0]) ? [m[0]].concat(modeName(m[0])) : m)), oneWeek() ? "week" : "season", form.sport === "nba" ? "A season or one day" : "A season or one week");
    const kinds = oneWeek() ? "" : pickCards("kind", KINDS, form.kind, "League type");
    // a one-week league plays the week that's on, or the next one when too little of this week is left (or for
    // baseball, whose stats can't be split midweek)
    const wc = weekChoices(sp), tooLate = wc.left < 30 * 36e5;
    form.when = tooLate || sp.key === "mlb" ? "next" : "now";
    const sdHtml = "";
    const slateHtml = slateOn() ? slateSection() : "";
    const whenHtml = slateOn() || !oneWeek() ? "" : `<p class="nl-when ps">${form.when === "now" ? `Plays this week, ${esc(wc.curLabel)}. It starts when the draft ends, and games played before then don't count.` : `Plays next week, ${esc(wc.nextLabel)}${sp.key === "mlb" ? ": baseball can't split a week midway" : ": too little of this week is left"}.`}</p>`;
    const cats = scoringType(sp) === "cats";
    const label = (k) => (oneWeek() && k === "allplay" ? ["Everyone vs. everyone", "Top score wins. Everyone is ranked"] : oneWeek() && k === "h2h" && !cats ? ["Head to head", "Beat the team you're paired with"]
      : cats && k === "h2h" ? ["Most categories", "Head to head: win more categories, win the week"] : cats && k === "h2hcats" ? ["Each category", "Head to head: a 6-4 week counts as 6 wins"] : FORMATS[k]);
    const formats = pickCards("format", formatsFor(sp).filter(formatFits).map((k) => [k, label(k)[0], label(k)[1]]), fmt, "Format");
    const presets = Object.entries(sp.scorings).map(([k, x]) => [k, x.label.replace(/ \(.*\)$/, ""), SC_SUB[k] || ""]).concat([["cp", "Custom points", SC_SUB.cp]], sp.key !== "nfl" ? [["cc", "Custom categories", SC_SUB.cc]] : []);
    const live = auction ? [[15, "15 sec"], [30, "30 sec"], [60, "1 min"]] : [[30, "30 sec"], [60, "1 min"], [90, "90 sec"], [120, "2 min"], [3600, "1 hr"], [14400, "4 hr"], [28800, "8 hr"]];
    const rows = ROWS(sp).map(([k, title, sub, value, body]) => {
      const open = !!form.open[k];
      return `<div class="nr${open ? " open" : ""}"><button type="button" class="nr-h" data-row="${k}" aria-expanded="${open}" aria-controls="nr-${k}"><span class="nr-t"><b>${esc(title)}</b><small>${esc(sub)}</small></span><span class="nr-v">${esc(value)}</span><span class="chev" aria-hidden="true"></span></button>${open ? `<div class="nr-b" id="nr-${k}">${body()}</div>` : ""}</div>`;
    }).join("");
    return `<div class="su sp-${sp.key}">
      <div class="nl-band">${FIELD[sp.key]}<div class="nl-bi">
        <div class="nl-sports" role="radiogroup" aria-label="Sport">${Object.values(S.ALL).map((s) => `<label class="nl-sp"><input type="radio" name="sport" value="${s.key}"${s.key === form.sport ? " checked" : ""}>${icon(s.key)}<span>${esc(s.name)}</span></label>`).join("")}</div>
        <h1 class="disp">${dayOn() ? "Start a one-day basketball game" : oneWeek() ? `Start a one-week ${esc(sp.name.toLowerCase())} game` : `Start a ${esc(sp.name.toLowerCase())} league`}</h1>
        <p>${dayOn() ? "Pick tonight's games, draft with your group, and know the winner when the last game ends. Run it back tomorrow with the same people." : oneWeek() ? "Pick the games, draft with your group, play one real week and crown a winner. Run it back next week with the same people." : "Pick a league type and a format, give it a name, and you can send the invite link in a minute. Every rule has a default, and most can change after the draft."}</p>
      </div></div>
      <form class="nl-body" id="new" novalidate>
        ${rematch ? `<div class="banner" style="margin:0 0 4px"><b>Running it back: ${esc(rematch.name)}, the same ${rematch.n} teams and managers.</b> <span class="muted">Pick next week's games and go. Everyone in this week's game is in the new one.</span></div>` : ""}
        <section class="nl-sec nl-ess"><h2 class="nl-h">The basics</h2>
          <div class="nl-name"><label for="n-name">League name</label><input id="n-name" type="text" maxlength="40" required value="${esc(form.name || "")}" placeholder="Name your league" autocomplete="off"></div>
          <div class="g2">${fld("Your name", `<input id="n-me" type="text" maxlength="24" required value="${esc(form.me || "")}" autocomplete="name">`, "", "n-me")}${fld("Your team's name", `<input id="n-team" type="text" maxlength="28" value="${esc(form.team || "")}" placeholder="Optional">`, "", "n-team")}</div>
          ${fld("Teams", stepper("teams", teamVals(), form.teams, (x) => `${x} teams`, "Teams"), teamsHint())}
        </section>
        <section class="nl-sec"><h2 class="nl-h">What are you starting?</h2>${modes}${kinds ? `<div style="margin-top:12px">${kinds}</div>` : ""}${whenHtml}</section>
        ${slateHtml}
        <section class="nl-sec"><h2 class="nl-h">Format</h2>${formats}${sdHtml}
          ${showdown() || capOn() ? "" : `<div class="nl-bb">${toggle("bestball", gl ? "Best ball guillotine" : "Best ball", gl ? "Your best lineup counts each week, so nobody gets chopped for a bad lineup" : "Lineups set themselves: your best scores count each week", form.bestball)}${slateOn() && form.season === "h2h" && scoringType(sp) === "points" && curSlate() && curSlate().games.length >= 8 ? toggle("hzOn", "Heist", "Right after the draft, everyone secretly shields their own starters and steals or jinxes the other team's", form.hzOn) : ""}${form.season === "h2h" && !form.vampOn && !heist() && scoringType(sp) === "points" ? toggle("median", "Median game", "Also play the league median, for a second win or loss each week", form.median) : ""}</div>`}</section>
        ${form.sport === "nfl" ? `<section class="nl-sec" style="padding-top:0"><div class="nl-bb" style="margin-top:0">${toggle("confOn", "Conference limit", "No more than two starters from one FBS college conference, like the SEC or the Mountain West", form.confOn)}</div></section>` : ""}
        <section class="nl-sec"><h2 class="nl-h">Scoring</h2>
          ${fld("", cards("scoring", presets, form.scoring, "Scoring", presets.length > 4 ? 3 : presets.length))}
        </section>
        <section class="nl-sec"><h2 class="nl-h">The draft</h2>
          <div class="nl-dr">${pickCards("type", draftTypes(sp).map((k) => [k, DRAFT_SHORT[k] || F.FORMATS[k], DRAFTS[k] || ""]), form.type, "Draft format")}
          ${triviaOk() ? toggle("tvOn", "Trivia draft", `On the clock, answer an easy ${{ nfl: "football", nba: "basketball", mlb: "baseball" }[sp.key] || "sports"} question first: four choices, 15 seconds. Miss it and your pick moves to the end of the round`, form.tvOn) : ""}
          ${rlOk() ? toggle("rlOn", "Team roulette", `Each pick, a wheel picks the ${sp.key === "nfl" ? "NFL" : sp.key === "nba" ? "NBA" : "MLB"} team you have to draft from`, form.rlOn,
            `<div class="g2">${fld("The wheel spins", seg("rlRound", [[0, "Every pick"], [1, "Once a round, same team for all"]], form.rlRound, "The wheel spins", { wrap: true }))}${fld("Re-spins a team", seg("respins", [[0, "None"], [1, "1"], [2, "2"], [3, "3"]], form.respins, "Re-spins a team"))}</div>`) : ""}
          ${noRoom() ? "" : fld(auction ? "Bid clock" : "Pick clock", seg("clock", live, form.clock, auction ? "Bid clock" : "Pick clock", { wrap: true }), auction ? "Every bid resets the clock." : form.clock >= 3600 ? "A slow draft: managers with email alerts get one when they're up." : "When a clock runs out, the best player left is taken.")}</div>
          ${capOn() ? capHtml() : sealedOn() ? lockHtml() : draftTimeHtml()}
        </section>
        ${twistsHtml()}
        <section class="nl-sec"><h2 class="nl-h">Fine-tune</h2><p class="nl-sub">Every rule and what it's set to. Open one to change it.</p><div class="nr-l">${rows}</div></section>
        <div class="nl-bar"><div class="nl-sum">${icon(sp.key, "nl-sum-ic")}<span><b id="tk-name">${esc(form.name || "Your league")}</b><small>${esc(V.line)}</small></span></div>
          <p id="n-why" role="alert"></p><span class="grow"></span><button type="button" class="btn ghost" data-a="list">Cancel</button><button type="submit" class="btn go"${busy ? " disabled" : ""}>${busy ? (rematch ? "Setting it up…" : "Making the league…") : rematch ? "Run it back" : oneWeek() ? "Make the game" : "Make the league"}</button></div>
      </form></div>`;
  }
  // plain-English values for the summary bar and the fine-tune rows
  function values(sp) {
    const gl = form.season === "guillotine", n = form.teams, lu = lineupOf(sp), po = Math.min(form.playoffs, n);
    const sc = form.scoring === "cp" ? "Custom points" : form.scoring === "cc" ? `Custom categories (${(form.cats || []).length})` : (sp.scorings[form.scoring] || Object.values(sp.scorings)[0]).label.replace(/ \(.*\)$/, "");
    const bon = [];
    if (sp.key === "nfl" && scoringType(sp) === "points") {
      if (form.tep) bon.push(`TE +${form.tep}`);
      if (form.scoring !== "cp" && form.ptd !== 4) bon.push(`${form.ptd}-pt pass TD`);
      const y = [form.b100r, form.b100c, form.b300p].filter(Boolean).length; if (y) bon.push(`${y} yardage bonus${y > 1 ? "es" : ""}`);
    }
    const clock = form.clock >= 3600 ? `${form.clock / 3600} hr` : form.clock >= 60 ? `${form.clock === 90 ? "90 sec" : form.clock / 60 + " min"}` : `${form.clock} sec`;
    const faab = form.faab == null ? (gl ? 1000 : 100) : form.faab;
    const dl = form.deadline == null ? Math.max(1, form.weeks - 3) : form.deadline;
    const seasonName = (seasonsFor(sp).find(([x]) => x === form.season) || [, ""])[1].split(":")[0];
    const slt = slateOn() ? curSlate() : null;
    const fmtName = oneWeek() && formatOf() === "allplay" ? "everyone vs. everyone" : scoringType(sp) === "cats" && formatOf() === "h2h" ? "head to head, most categories" : scoringType(sp) === "cats" && formatOf() === "h2hcats" ? "head to head, each category" : FORMATS[formatOf()] ? FORMATS[formatOf()][0].toLowerCase() : "";
    const style = oneWeek() ? `${slt && slt.day ? "One day" : "One week"}${slt ? `: ${slt.label}, ${slt.day ? SL.dayName(slt.day).toLowerCase() : `week ${slt.week}`}` : slateOn() ? "" : ` (${form.when === "now" ? "this week" : "next week"})`}${showdown() ? ", captain at 1.5x" : ""}, ${fmtName}${form.bestball ? ", best ball" : ""}`
      : `${(KINDS.find(([k]) => k === form.kind) || [, "Redraft"])[1]}, ${fmtName}${form.bestball ? ", best ball" : gl ? ", set lineups" : ""}`;
    return {
      line: `${sp.name}, ${n} teams, ${sc}, ${capOn() ? `$${form.capBudget} salary cap, no draft` : `${DRAFT_SHORT[form.type]} draft`}${rlOk() && form.rlOn ? " with team roulette" : ""}${heist() ? " and a heist" : ""}${trivia() ? ", trivia to pick" : ""}${sp.key === "nfl" && form.confOn ? ", two starters a conference" : ""}. ${style}`,
      scoring: bon.length ? bon.join(", ") : form.scoring === "cp" ? "Custom points" : "No bonuses",
      draft: `${rlOk() && form.rlOn ? `Team roulette${form.rlRound ? " by round" : ""}, ` : ""}${auction() ? `$${showdown() ? 50 : 200} budgets, ` : ""}${clock} a ${auction() ? "bid" : "pick"}${form.type === "mystery" ? `, packages open ${{ now: "now", start: "at the start", own: "as picks come up" }[form.reveal || "start"]}` : ""}${!auction() && form.type !== "elephant" ? (form.trades ? ", trades on" : ", no trades") : ""}`,
      roster: capOn() ? `${lu.length} starters, no bench` : showdown() ? "Captain and 5 flex, no bench" : heist() ? "8 starters, no bench" : `${lu.length} starters, ${benchOf(sp)} bench${form.ir ? `, ${form.ir} IR` : ""}`,
      heist: `${form.hzShields} shield${form.hzShields === 1 ? "" : "s"}, ${form.hzSteals} steal${form.hzSteals === 1 ? "" : "s"}, ${form.hzJinxes} jinx${form.hzJinxes === 1 ? "" : "es"}, ${form.hzClock} sec`,
      season: `${gl ? `${n - 1} weeks` : `${form.weeks} weeks`}${form.divs && !gl && form.season !== "roto" ? `, ${form.divs} divisions` : ""}`,
      playoffs: po ? `${po} teams, ${playoffWeeks(po)} weeks` : "None",
      waivers: gl ? `$${faab} FAAB` : form.waivers === "faab" ? `$${faab} FAAB, ${form.waiverDays}-day waivers` : `Rolling, ${form.waiverDays}-day waivers`,
      trades: `${oneWeek() ? "" : dl ? `Deadline week ${dl}, ` : "No deadline, "}${form.review === "vote" ? "league vote" : form.review === "commish" ? "commissioner" : "no review"}`,
      carry: form.kind === "dynasty" ? `Dynasty, ${form.rookie}-round rookie draft` : form.kind === "keeper" ? `Up to ${form.keepN} keepers` : "Redraft",
      vampire: form.vampOn ? (form.vampWho === "me" ? "You're the vampire" : "A random team") : "Off",
    };
  }
  // twists a season-long league can add on top of its format: head to head ones, and a guillotine's top-score bonus
  const twistOk = () => !oneWeek() && ["h2h", "h2hcats"].includes(form.season);
  function twistsHtml() {
    const gl = form.season === "guillotine";
    if (oneWeek() || (!twistOk() && !gl)) return "";
    const on = [form.pyoOn, form.robinOn, form.conqOn, form.crownOn, form.hangOn].filter(Boolean).length + (gl && form.tbOn ? 1 : 0);
    const odd = form.teams % 2 === 1, faab = form.waivers === "faab";
    const body = gl ? toggle("tbOn", "Top-score bonus", "The week's top scorer gets extra FAAB: a reason to spend early instead of hoarding", form.tbOn,
        fld("Bonus", seg("tbAmt", [[10, "$10"], [25, "$25"], [50, "$50"], [100, "$100"]], form.tbAmt, "Top-score bonus")))
      : `${toggle("pyoOn", "Pick your opponent", odd ? "Needs an even number of teams" : "Every week, worst record first, each team picks who it plays the next week", form.pyoOn && !odd, `<p class="fl-h">Each team gets 12 hours on its turn. Week 1 is drawn; no divisions.</p>`)}
        ${toggle("robinOn", "Robin Hood", "The week's lowest scorer takes a player from the top scorer and gives one back", form.robinOn,
          fld("The top scorer keeps his best", seg("robinP", [[0, "None"], [1, "1"], [2, "2"], [3, "3"], [4, "4"]], form.robinP, "Protected players"), "Protected, by value. Robin takes from the rest."))}
        ${toggle("conqOn", "Conquest", "Win your matchup and take a player from the team you beat, giving one back", form.conqOn,
          `<div class="g2">${fld("The loser keeps his best", seg("conqP", [[1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5"]], form.conqP, "Protected players"))}${fld("Swaps", seg("conqLike", [[0, "Any player"], [1, "Same position"]], form.conqLike, "Swaps"))}</div>`)}
        ${toggle("crownOn", "Kingslayer", faab ? "One team wears the crown. Beat the king to take it and the bounty, which grows every week he holds it" : "Needs FAAB waivers: the bounty is paid in FAAB", form.crownOn && faab,
          `<div class="g2">${fld("Bounty grows", seg("crownStep", [[5, "$5"], [10, "$10"], [20, "$20"]], form.crownStep, "Bounty grows"), "A week, while the king holds the crown. Week 1's top scorer is the first king.")}${fld("The king earns", seg("crownKeep", [[0, "$0"], [5, "$5"], [10, "$10"]], form.crownKeep, "The king earns"), "For each week he survives.")}</div>`)}
        ${toggle("hangOn", "The Hangover", "Last week's winners can't add free agents or put in claims this week", form.hangOn)}`;
    // folded until you want them; open on its own once one is on
    const open = on || form.twOpen;
    return `<section class="nl-sec"><details class="nl-tw" id="nl-tw"${open ? " open" : ""}><summary><span style="display:grid;gap:2px"><b>Twists${on ? ` <span class="tag info">${on} on</span>` : ""}</b><small>${gl ? "An optional extra rule on top of the guillotine." : "Optional extra rules on top of the format: Robin Hood, Kingslayer and more."}</small></span><span class="chev" aria-hidden="true"></span></summary><div class="stack tw-l nl-bb">${body}</div></details></section>`;
  }
  // the games a one-week football game plays: this week or next, a slate, and for one game or your own pick, the games
  function slateSection() {
    loadSlates();
    if (!slData()) return `<section class="nl-sec"><h2 class="nl-h">The games</h2><p class="ps">Loading the schedule…</p></section>`;
    if (slData().error) return `<section class="nl-sec" role="alert"><h2 class="nl-h">The games</h2><p class="ps">Couldn't load the schedule. Check your connection and try again.</p><button type="button" class="btn" data-a="slates-retry">Try again</button></section>`;
    const ws = slWeeks();
    if (!ws.length) return `<section class="nl-sec"><h2 class="nl-h">The games</h2><p class="ps">${dayOn() ? "There are no games left tonight or tomorrow to draft." : "There are no games left on the schedule to draft. Try again when the next week's games are out."}</p></section>`;
    const w = slWeek(), list = SL.list(w), day = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
    if (!list.some((x) => x.kind === form.slKind)) form.slKind = "full";
    const wkName = (x) => (x.day ? `${SL.dayName(x.day)}, ${day(x.day)}` : `Week ${x.week}, ${day(x.start)} to ${day(x.end)}`);
    const weekSeg = w.day ? (ws.length > 1 ? `<div style="margin-bottom:12px">${seg("slWeek", ws.map((x, i) => [i, wkName(x)]), Math.min(form.slWeek || 0, ws.length - 1), "Which night", { wrap: true })}</div>` : `<p class="ps" style="margin:0 0 10px">${esc(wkName(w))}</p>`)
      : ws.length > 1 ? `<div style="margin-bottom:12px">${seg("slWeek", ws.map((x, i) => [i, wkName(x)]), Math.min(form.slWeek || 0, ws.length - 1), "Which week", { wrap: true })}</div>` : `<p class="ps" style="margin:0 0 10px">Week ${w.week}, ${day(w.start)} to ${day(w.end)}</p>`;
    const cardsHtml = pickCards("slkind", list.map((x) => [x.kind, x.label, x.sub]), form.slKind, "The games");
    const games = SL.open(w);
    const chip = (g, on, attr) => `<button type="button" class="slg${on ? " on" : ""}" ${attr} aria-pressed="${on}"><b>${esc(g.away)} @ ${esc(g.home)}</b><small>${esc(SL.kick(g.at))}</small></button>`;
    const pickOne = form.slKind === "one" ? `<div class="slg-l">${games.map((g) => chip(g, (form.slOne || games[0].id) === g.id, `data-slone="${esc(g.id)}"`)).join("")}</div>` : "";
    const pickMany = form.slKind === "custom" ? `<div class="slg-l">${games.map((g) => chip(g, (form.slGames || []).includes(g.id), `data-slg="${esc(g.id)}"`)).join("")}</div>` : "";
    const sl = curSlate(), lu = sl ? (heist() ? null : SL.lineup(sl.games.length, form.teams, form.sport)) : null, kw = SL.word(form.sport);
    const early = sl && sl.first - Date.now() < 36 * 36e5 ? ` The first game ${kw} ${esc(SL.kick(sl.games[0].at))}: finish the draft before then, or that game's players won't count.` : "";
    const dayNote = sl && sl.day ? " It's scored on tonight's box scores and wraps up when the last game ends." : "";
    const sum = sl ? `<p class="fl-h slsum"><b>${esc(sl.label)}: ${sl.games.length} game${sl.games.length === 1 ? "" : "s"}, ${sl.teams.length} teams' players.</b> ${heist() ? "The heist lineup: QB, 2 RB, 3 WR, TE and a flex, no bench." : esc(lu.note) + "."} Each player locks when his game ${kw}.${dayNote}${early}</p>`
      : `<p class="fl-h slsum">Pick at least one game.</p>`;
    return `<section class="nl-sec"><h2 class="nl-h">The games</h2>${weekSeg}${cardsHtml}${pickOne}${pickMany}${sum}</section>`;
  }
  // when the draft starts: when you start it, or on its own at a time (with a reminder an hour before). A one-week
  // game's time has to come before its first kickoff.
  const localInput = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 6e4); return d.toISOString().slice(0, 16); };
  function draftTimeDefault() {
    const sl = slateOn() ? curSlate() : null, H = 36e5, now = Date.now();
    let t = sl ? sl.first - H : now + 24 * H;
    t = Math.floor(t / H) * H;
    return Math.max(t, Math.ceil((now + 15 * 6e4) / (15 * 6e4)) * 15 * 6e4);
  }
  function draftTimeHtml() {
    const at = form.dtMode === "at";
    if (at && !form.dtAt) form.dtAt = draftTimeDefault();
    const sl = slateOn() ? curSlate() : null;
    return fld("Draft time", `${seg("dtMode", [["self", "I'll start it"], ["at", "Set a time"]], at ? "at" : "self", "Draft time")}${at ? `<div style="margin-top:8px"><input id="n-dt" type="datetime-local" value="${esc(localInput(form.dtAt))}" min="${esc(localInput(Date.now() + 5 * 6e4))}"${sl ? ` max="${esc(localInput(sl.first - 10 * 6e4))}"` : ""} aria-label="When the draft starts"></div>` : ""}`,
      at ? "It starts on its own, with an email an hour before. Anyone who isn't there gets picks from their queue, or the best player left." : "Start it from the draft room when everyone's in.");
  }
  const auction = () => form.type === "auction";
  // the draft types a league can pick: every live format, a sealed draft, and for one-week football on points, a
  // salary cap game with no draft at all
  const draftTypes = (sp) => Object.keys(F.FORMATS).concat(["sealed"], slateOn() && scoringType(sp) === "points" ? ["cap"] : []);
  function capHtml() {
    const sl = curSlate();
    return `<div class="g2">${fld("Budget", seg("capBudget", [[50, "$50"], [100, "$100"], [200, "$200"]], form.capBudget, "Budget"), "Stars cost about twice an even share, so you can't have them all.")}
      ${fld("Unique picks", toggle("capBonus", "1.25x for a player nobody else has", "Fading the obvious picks pays", form.capBonus))}</div>
      <p class="fl-h">No draft: everyone builds one lineup under the budget, and anyone can pick the same players. Lineups stay hidden and lock at the first ${dayOn() ? "tip" : "kickoff"}${sl ? `, ${esc(SL.kick(sl.games[0].at))}` : ""}. Anyone who doesn't set one gets a bot's.</p>`;
  }
  // a sealed draft: the time the lists lock, when the draft runs itself (before the first kickoff, for a slate)
  function lockHtml() {
    if (!form.lkAt) form.lkAt = draftTimeDefault();
    const sl = slateOn() ? curSlate() : null;
    return fld("Lists lock", `<input id="n-lk" type="datetime-local" value="${esc(localInput(form.lkAt))}" min="${esc(localInput(Date.now() + 5 * 6e4))}"${sl ? ` max="${esc(localInput(sl.first - 10 * 6e4))}"` : ""} aria-label="When the lists lock">`,
      "Everyone ranks players in private until then. Then the draft runs itself in a snake order: each pick is the highest player left on that team's list.");
  }
  // team roulette works with drafts that go pick by pick (not a showdown: two teams make a dull wheel)
  const rlOk = () => ["snake", "linear", "3rr"].includes(form.type) && !showdown();
  // a trivia draft: any sport, a draft that goes pick by pick
  const triviaOk = () => ["snake", "linear", "3rr"].includes(form.type);
  const trivia = () => triviaOk() && !!form.tvOn;
  const seasonsFor = (sp) => SEASONS[scoringType(sp)];
  // the fine-tune list: [key, title, what it covers, current value, body]
  function ROWS(sp) {
    const V = values(sp), gl = form.season === "guillotine", rows = [];
    if (form.kind !== "redraft" && !oneWeek()) rows.push(["carry", form.kind === "dynasty" ? "Dynasty" : "Keepers", form.kind === "dynasty" ? "Rookie draft, taxi squad, future picks" : "How many and what they cost", V.carry, () => carryBody()]);
    if (vampOk() && form.vampOn) rows.push(["vampire", "Vampire", "Who it is and how it bites", V.vampire, () => vampireBody()]);
    rows.push(["scoring", "Scoring details", sp.key === "nfl" ? "Bonuses, TE premium, custom points" : form.scoring === "cp" ? "Points for each stat" : "Categories and custom scoring", V.scoring, () => scoringBody(sp)]);
    if (heist()) rows.push(["heist", "Heist", "Shields, steals, jinxes and its clock", V.heist, () => heistBody()]);
    if (!slateOn() && !heist()) rows.push(["roster", "Roster", "Starting lineup, bench, IR, position limits", V.roster, () => rosterStep(sp)]);
    if (!noRoom()) rows.push(["draft", "Draft room", form.type === "mystery" ? "When packages open, trades during the draft" : "Trades during the draft", V.draft, () => draftBody()]);
    if (!oneWeek()) rows.push(["season", "Season", form.season === "guillotine" ? "Length" : "Length and divisions", V.season, () => seasonBody(sp)]);
    if (h2hLike() && !oneWeek()) rows.push(["playoffs", "Playoffs", "Teams, rounds, consolation", V.playoffs, () => playoffsBody()]);
    if (!showdown() && !heist() && !capOn()) rows.push(["waivers", "Waivers", "FAAB, clear times, pickup limits", V.waivers, () => waiversBody()]);
    if (!gl && !oneWeek()) rows.push(["trades", "Trades", "Deadline and review", V.trades, () => tradesBody()]);
    return rows;
  }
  function carryBody() {
    if (form.kind === "keeper") return `<div class="g2">${fld("Keepers a team", stepper("keepN", [1, 2, 3, 4, 5, 6, 8], form.keepN, String, "Keepers a team"))}
        ${fld("A keeper costs", seg("keeperCost", form.type === "auction" ? [["price", "His price"], ["price5", "His price + $5"]] : [["round", "His round"], ["round1", "A round earlier"], ["free", "A last-round pick"]], kc(), "A keeper costs", { wrap: true }), `Worst team picks first. Players picked up in season cost ${form.type === "auction" ? "$5" : "the last round"}.`)}</div>`;
    return `<div class="g3">${fld("Rookie draft", stepper("rookie", [2, 3, 4, 5], form.rookie, (x) => `${x} rounds`, "Rookie draft rounds"), "Worst team picks first.")}
        ${fld("Taxi squad", stepper("taxi", [0, 1, 2, 3, 4, 5], form.taxi, (x) => (x ? `${x} spot${x > 1 ? "s" : ""}` : "None"), "Taxi squad spots"), "Stash rookies off the roster.")}
        ${fld("Future picks", toggle("fpicks", "Tradeable", "Next season's picks", form.fpicks))}</div>`;
  }
  function vampireBody() {
    return `<div class="g2">${fld("The vampire is", seg("vampWho", [["random", "A random team"], ["me", "Me"]], form.vampWho, "The vampire is"))}${fld("Swaps", seg("vlike", [[0, "Any position"], [1, "Same position"]], form.vlike, "The vampire swaps"))}</div>
      ${toggle("vdouble", "Bite the low scorer too", "Each week, also take from the league's lowest score", form.vdouble)}
      <p class="fl-h">The vampire skips the draft and builds from free agents, with the first waiver claim every week. Each regular-season week it wins, it takes a player from the team it beat and gives one back.</p>`;
  }
  function scoringBody(sp) {
    const cur = sp.scorings[form.scoring];
    const cats = cur && cur.type === "cats" ? `<div class="catl" aria-label="Categories">${cur.cats.map((c) => `<span class="${c.line === "pit" ? "pit" : ""}">${esc(c.label)}</span>`).join("")}</div><p class="fl-h">Want different categories? Pick Custom categories above.</p>` : "";
    const ed = pointsEditor(sp) + (form.scoring !== "cc" && sp.key === "nfl" ? bonusFields(sp) : "");
    return cats + ed || `<p class="fl-h">${esc(cur ? cur.label : "")}. Pick Custom points above to set every stat.</p>`;
  }
  function draftBody() {
    // trading in the draft room: not in an auction, a white elephant (steals take its place) or a pack draft
    const tradesOk = !["auction", "elephant", "pack", "cap", "sealed"].includes(form.type) && !trivia();
    const reveal = form.type === "mystery" ? fld("Packages open", seg("reveal", [["now", "Right away"], ["start", "When the draft starts"], ["own", "Yours first, the rest as they come up"]], form.reveal || "start", "Packages open", { wrap: true }),
      form.reveal === "own" ? "Other teams' picks stay hidden until they're on the clock, so a trade for one is a blind deal." : form.reveal === "now" ? "Everyone sees every package now, and teams can trade before the draft starts." : "Everyone sees every package once the draft starts, so trades show exactly which picks move.") : "";
    if (form.type === "mystery") return reveal + toggle("trades", "Trade picks and players", "Deals happen right in the draft room", form.trades);
    return tradesOk ? toggle("trades", "Trade picks and players", "Deals happen right in the draft room", form.trades,
      fld("A trade offer stops the clock", seg("ohold", [["clock", "For the team on the clock"], ["all", "For anyone, up to 90 seconds"], ["off", "Never"]], form.ohold, "A trade offer stops the clock", { wrap: true })))
      : `<p class="fl-h">${auction() ? "An auction" : form.type === "pack" ? "A pack draft" : trivia() ? "A trivia draft" : "This draft format"} doesn't allow trades during the draft.${oneWeek() ? "" : " Teams can trade once the season starts."}</p>`;
  }
  // Football bonuses on any points scoring: a TE premium, passing TDs worth more, and points for big yardage games.
  function nflExtras() {
    const pos = {}, bonus = [];
    if (form.tep) pos.TE = { rec: form.tep };
    if (form.scoring !== "cp" && form.ptd && form.ptd !== 4) pos["*"] = { pass_td: form.ptd - 4 };
    if (form.b100r) bonus.push({ stat: "rush_yd", at: 100, pts: form.b100r });
    if (form.b100c) bonus.push({ stat: "rec_yd", at: 100, pts: form.b100c });
    if (form.b300p) bonus.push({ stat: "pass_yd", at: 300, pts: form.b300p });
    return Object.keys(pos).length || bonus.length ? { pos, bonus } : null;
  }
  function bonusFields(sp) {
    if (sp.key !== "nfl" || scoringType(sp) !== "points") return "";
    const amt = (k, label, o) => numIn(k + "Amt", form[k + "Amt"], Object.assign({ label, min: 0.25, max: 20, step: o.step || 1 }, o));
    return group("Bonuses", `<div class="bl">
      ${toggle("tepOn", "TE premium", "Extra points for every tight end catch", form.tepOn, amt("tep", "TE premium points a catch", { step: 0.25, post: "a catch", pre: "+" }))}
      ${form.scoring === "cp" ? "" : `<div class="tg-w"><div class="tg-t pl"><b>Passing touchdowns</b><small>Four points is standard</small></div><div class="tg-x">${seg("ptd", [[4, "4 pts"], [5, "5 pts"], [6, "6 pts"]], form.ptd, "Passing touchdown points")}</div></div>`}
      ${toggle("b100rOn", "100-yard rushing game", "Once a game, on top of yardage points", form.b100rOn, amt("b100r", "100-yard rushing bonus", { pre: "+", post: "points" }))}
      ${toggle("b100cOn", "100-yard receiving game", "Once a game, on top of yardage points", form.b100cOn, amt("b100c", "100-yard receiving bonus", { pre: "+", post: "points" }))}
      ${toggle("b300pOn", "300-yard passing game", "Once a game, on top of yardage points", form.b300pOn, amt("b300p", "300-yard passing bonus", { pre: "+", post: "points" }))}
    </div>`, "Player values and projections include what each bonus is likely to add.");
  }
  function pointsEditor(sp) {
    if (form.scoring === "cp") {
      const w = form.weights || (form.weights = Object.assign({}, S.POINT_DEFAULTS[sp.key]));
      return group("Points for each stat", `<div class="wts">${S.POINT_STATS[sp.key].map(([key, l]) => `<label class="wt"><span>${esc(l)}</span><input type="number" step="0.01" data-w="${esc(key)}" value="${w[key] != null ? w[key] : 0}" aria-label="Points for ${esc(l)}"></label>`).join("")}</div>`,
        sp.key === "nfl" ? "Per yard, catch, touchdown and so on. Points allowed counts each point a defense gives up, so use a small negative number." : sp.key === "mlb" ? "Hitting and pitching stats from each player's line. Total bases count singles 1, doubles 2, triples 3 and homers 4." : "Per stat, per game.");
    }
    if (form.scoring === "cc") {
      const all = S.catCatalog(sp);
      const on = form.cats || (form.cats = (Object.values(sp.scorings).find((x) => x.type === "cats") || { cats: [] }).cats.map((c) => c.k));
      return group(`Categories (${on.length} chosen)`, `<div class="chips presets" role="group" aria-label="Categories">${all.map((c) => `<button type="button" data-cat="${esc(c.k)}" aria-pressed="${on.includes(c.k)}">${esc(c.label)}</button>`).join("")}</div>`,
        `Pick at least two.${all.some((c) => c.low) ? " Some, like turnovers and ERA, are better low." : ""}`);
    }
    return "";
  }

  function rosterStep(sp) {
    const bench = benchOf(sp);
    const pm = (POS_MAIN[sp.key] || []).map((ps) => `<div class="pm"><span class="pm-l">${esc(ps)}</span>${stepper("pm_" + ps, [0, 1, 2, 3, 4, 5, 6, 8], form.posMax[ps] || 0, (x) => (x ? `Up to ${x}` : "Any"), `Most ${ps} on a roster`)}</div>`).join("");
    return group("Starting lineup", U.lineupBuilder(sp, lineupOf(sp)))
      + group("Reserves", `<div class="g3">${fld("Bench spots", stepper("bench", [2, 3, 4, 5, 6, 7, 8, 10, 12], bench, String, "Bench spots"))}
        ${fld("IR spots", stepper("ir", [0, 1, 2, 3, 4], form.ir, (x) => (x ? String(x) : "None"), "IR spots"), "For players listed as out.")}</div>`)
      + group("Position limits", `<div class="pml">${pm}</div>`, "The most of one position a team can roster.");
  }
  function seasonBody(sp) {
    const gl = form.season === "guillotine", n = form.teams, po = Math.min(form.playoffs, n);
    const left = oneWeek() ? null : weeksLeft(), pw = h2hLike() && po ? playoffWeeks(po) : 0, maxReg = left == null ? 16 : Math.max(1, Math.min(16, left - pw));
    const capNote = left != null && left < 16 + pw ? `<p class="fl-h">The ${esc(S[form.sport].name.toLowerCase())} season has ${left} weeks left${pw ? `, and the playoffs take ${pw}` : ""}, so the regular season can run ${maxReg} at most. It ends by ${endLabel()}.</p>` : "";
    const length = gl ? `<p class="fl-h">${n - 1} weeks: one team is cut each week until one is left.${left != null && n - 1 > left ? ` <b>Only ${left} weeks are left in the season</b>, so the last ${n - 1 - left} would have no games. Pick ${left + 1} teams or fewer.` : ""}</p>`
      : range("weeks", Math.min(8, maxReg), maxReg, Math.min(form.weeks, maxReg), (x) => `${x} weeks`, h2hLike() && po ? "Weeks before the playoffs" : "Season length") + capNote;
    const divs = !gl && form.season !== "roto" && n >= 4 ? fld("Divisions", seg("divs", [0, 2, 3, 4].filter((d) => !d || n >= 2 * d).map((d) => [d, d ? `${d}` : "None"]), form.divs, "Divisions"), form.divs ? "Division winners make the playoffs, and the schedule plays your division more." : "") : "";
    return length + divs;
  }
  function playoffsBody() {
    const n = form.teams, po = Math.min(form.playoffs, n);
    const poOpts = [0, 2, 3, 4, 6, 8, 10, 12].filter((x) => x <= n).map((x) => [x, x ? `${x}` : "None"]);
    const byes = po ? 2 ** Math.ceil(Math.log2(Math.max(2, po))) - po : 0;
    return `${fld("Playoff teams", seg("playoffs", poOpts, po, "Playoff teams", { wrap: true }), po ? `${byes ? `The top ${byes} get a bye. ` : ""}${playoffWeeks(po)} playoff weeks after week ${form.weeks}, so the season runs ${form.weeks + playoffWeeks(po)} weeks.` : "")}
        ${po >= 2 ? `<div class="g2">${fld("Each round lasts", seg("legs", [["1", "One week"], ["final2", "Two-week final"], ["all2", "Two weeks"]], form.legs, "Playoff rounds", { wrap: true }))}
        ${fld("Also play", seg("cons", [["none", "Nothing else"]].concat(po >= 3 ? [["third", "Third place"]] : [], n - po >= 2 ? [["bracket", "Consolation"]] : []), form.cons, "Also play", { wrap: true }))}</div>` : ""}`;
  }
  function waiversBody() {
    const gl = form.season === "guillotine", faab = form.faab == null ? (gl ? 1000 : 100) : form.faab, fb = gl || form.waivers === "faab";
    return `${gl ? "" : fld("Claims go by", cards("waivers", [["faab", "FAAB bids", "A season budget. High bid wins"], ["rolling", "Rolling priority", "Top of the order wins, then goes to the back"]], form.waivers, "Waivers", 2))}
      ${fb ? `<div class="g2">${fld("FAAB budget", `<div class="row" style="flex-wrap:wrap">${numIn("faab", faab, { pre: "$", min: 1, max: 100000, label: "FAAB budget" })}<span class="qk">${(gl ? [500, 1000, 2000] : [100, 200, 500, 1000]).map((x) => `<button type="button" data-set="faab" data-v="${x}" aria-pressed="${x === faab}">$${x}</button>`).join("")}</span></div>`, gl ? "For the whole season." : "")}
        ${fld("Lowest bid", seg("minBid", [[0, "$0"], [1, "$1"]], form.minBid, "Lowest bid"))}</div>
      ${fld("The winner pays", cards("waiverPrice", [["first", "Their own bid", "Bid $40, win, pay $40"], ["second", "Second-highest bid, plus $1", "A Vickrey auction: bid $40 against $25, pay $26"]], form.waiverPrice, "The winner pays", 2), form.waiverPrice === "second" ? "So bid what he's really worth to you: you only pay enough to beat the next bid." : "")}` : ""}
      ${gl ? `<p class="fl-h">Waivers run midweek, 60 hours in, so a chopped roster is back in play.</p>` : `<div class="g2">${fld("Dropped players clear after", seg("waiverDays", [[1, "1 day"], [2, "2 days"], [3, "3 days"]], form.waiverDays, "Dropped players clear after"), "Business days, at 3 AM Eastern. Dropped Monday on 2 days, he clears early Thursday.")}${fld("After a player's game starts", seg("gameLock", [["week", "Locked until next week"], ["off", "Free to add"]], form.gameLock || (form.sport === "nfl" ? "week" : "off"), "After a player's game starts"), "Locked: Thursday's players can't be picked up Friday. Claims open for next week.")}
        ${fld("Waiver order", seg("waiverOrder", [["rolling", "Rolling"], ["standings", "Reverse standings"]], form.waiverOrder, "Waiver order"), form.waiverOrder === "standings" ? "Resets every week: the worst record claims first." : "A winning claim moves you to the back.")}</div>`}
      <div class="g2">${fld("Pickups a week", stepper("maxAdds", [0, 1, 2, 3, 4, 5, 7, 10], form.maxAdds, noLimit, "Pickups a week"))}${fld("Pickups a season", stepper("maxAddsSeason", [0, 10, 15, 20, 25, 30, 40, 50], form.maxAddsSeason, noLimit, "Pickups a season"))}</div>`;
  }
  function heistBody() {
    return `<div class="g2">${fld("Shields", stepper("hzShields", [1, 2, 3, 4, 5], form.hzShields, String, "Shields"), "Starters of your own that can't be stolen or jinxed.")}
      ${fld("Steals", stepper("hzSteals", [0, 1, 2], form.hzSteals, String, "Steals"), "Each takes one of their starters, who plays 1.5x for you.")}
      ${fld("Jinxes", stepper("hzJinxes", [0, 1, 2], form.hzJinxes, String, "Jinxes"), "Each halves one of their starters' points.")}
      ${fld("Time to decide", seg("hzClock", [[45, "45 sec"], [60, "1 min"], [90, "90 sec"], [120, "2 min"]], form.hzClock, "Time to decide"))}</div>`;
  }
  function tradesBody() {
    const dl = form.deadline == null ? Math.max(1, form.weeks - 3) : form.deadline;
    return `${oneWeek() ? "" : range("deadline", 0, Math.max(1, form.weeks - 1), Math.min(dl, form.weeks - 1), (x) => (x ? `After week ${x}` : "No deadline"), "Trade deadline")}
      ${fld("Review", cards("review", [["vote", "League vote", "Other teams can veto"], ["commish", "Commissioner", "You approve or veto"], ["none", "None", "Trades go through"]], form.review, "Trade review", 3))}
      ${form.review !== "none" ? `<div class="g2">${fld("Review lasts", seg("reviewHours", [[12, "12h"], [24, "24h"], [48, "48h"]], form.reviewHours, "Review lasts"))}
        ${form.review === "vote" ? fld("Votes to veto", seg("vetoShare", [[0.34, "A third"], [0.5, "Half"], [0.67, "Two thirds"]], form.vetoShare, "Votes to veto"), "Of the teams not in the trade.") : ""}</div>` : ""}`;
  }
  // the weeks left in the real season from the first week this league would play (next Monday, Tuesday for football),
  // so a league started in November can't run into February. null when the season hasn't started (no cap).
  function weeksLeft() {
    const end = S.seasonEnd(form.sport, Date.now()); if (!end) return null;
    const d = new Date(), want = form.sport === "nfl" ? 2 : 1;
    d.setUTCHours(13, 0, 0, 0);
    do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() !== want);
    return Math.max(1, Math.floor((end - d.getTime()) / 6048e5));
  }
  const endLabel = () => { const e = S.seasonEnd(form.sport, Date.now()); return e ? new Date(e).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""; };
  const playoffWeeks = (po) => { const R = Math.ceil(Math.log2(po)); return form.legs === "all2" ? 2 * R : form.legs === "final2" ? R + 1 : R; };
  const kc = () => { const ok = form.type === "auction" ? ["price", "price5"] : ["round", "round1", "free"]; return ok.includes(form.keeperCost) ? form.keeperCost : ok[0]; };
  const POS_MAIN = { nfl: ["QB", "RB", "WR", "TE", "K", "DEF"], nba: ["PG", "SG", "SF", "PF", "C"], mlb: ["C", "1B", "2B", "3B", "SS", "OF", "SP", "RP"] };
  const NUMERIC = /^(hzOn|hzShields|hzSteals|hzJinxes|hzClock|rlOn|rlRound|respins|teams|clock|weeks|trades|bench|faab|playoffs|deadline|waiverDays|ir|maxAdds|median|bestball|divs|rookie|fpicks|taxi|ptd|vlike|vdouble|reviewHours|vetoShare|minBid|maxAddsSeason|keepN|vampOn|pyoOn|robinOn|robinP|conqOn|conqP|conqLike|crownOn|crownStep|crownKeep|hangOn|tbOn|tbAmt|slWeek|capBudget|capBonus|confOn|tvOn|(tep|b100r|b100c|b300p)(On|Amt)|pm_.+)$/;
  // keep what's typed when a choice redraws the form
  function grab() {
    const root = $(".su"); if (!root) return;
    const v = (q) => { const el = $(q); return el ? el.value : null; };
    if (v("#n-dt")) { const t = new Date(v("#n-dt")).getTime(); if (Number.isFinite(t)) form.dtAt = t; }
    if (v("#n-lk")) { const t = new Date(v("#n-lk")).getTime(); if (Number.isFinite(t)) form.lkAt = t; }
    if (v("#n-name") != null) form.name = v("#n-name"); if (v("#n-me") != null) form.me = v("#n-me"); if (v("#n-team") != null) form.team = v("#n-team");
    const s = root.querySelector("input[name=sport]:checked"); if (s) form.sport = s.value;
    root.querySelectorAll("[data-f]").forEach((el) => {
      if (el.type === "radio" && !el.checked) return;
      const k = el.dataset.f, x = el.type === "checkbox" ? (el.checked ? 1 : 0) : el.value;
      if (k.startsWith("pm_")) { form.posMax[k.slice(3)] = Number(x) || 0; return; }
      if (k === "weeks" && Number(x) !== form.weeks) form.weeksWant = Number(x);
      form[k] = NUMERIC.test(k) ? Number(x) : x;
    });
    root.querySelectorAll("[data-w]").forEach((el) => { form.weights = form.weights || {}; form.weights[el.dataset.w] = Number(el.value) || 0; });
    derive();
  }
  // the values the league is made from, worked out from the friendlier controls
  // Any number of teams from 3 to 20 for a season (an odd count gives one team a bye each week). A one-week league
  // stays even, since an odd team would sit out the only week, and a showdown's two NFL teams fill at most six rosters.
  const span = (a, b, step = 1) => Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) => a + i * step);
  const teamVals = () => {
    const all = showdown() && !capOn() ? [2, 3, 4, 5, 6] : oneWeek() ? (form.season === "allplay" ? span(2, 16) : span(2, 20, 2)) : span(3, 20);
    const room = oneWeek() ? slateRoom() : null, fit = room ? all.filter((n) => n <= room.max) : all;
    return fit.length ? fit : all.slice(0, 1);
  };
  function derive() {
    if (rematch) form.teams = rematch.n;
    if (slateOn()) loadSlates();
    // one-day basketball defaults to points, as DraftKings scores it
    if (dayOn() && !form.scoring && S.nba.scorings.points) form.scoring = "points";
    // keep the season inside the real one: fewer playoff weeks first if even one regular week won't fit, then fewer weeks
    const left = oneWeek() || form.season === "guillotine" ? null : weeksLeft();
    if (form.weeksWant) form.weeks = form.weeksWant;
    if (left != null) {
      const pwOf = (po) => (h2hLike() && po ? playoffWeeks(Math.min(po, form.teams)) : 0);
      while (form.playoffs > 0 && 1 + pwOf(form.playoffs) > left) form.playoffs = [0, 2, 3, 4, 6, 8, 10, 12].filter((x) => x < form.playoffs).pop() || 0;
      form.weeks = Math.max(1, Math.min(form.weeks, left - pwOf(form.playoffs)));
    }
    const tv = teamVals();
    if (!tv.includes(form.teams)) form.teams = tv.reduce((b, v) => (Math.abs(v - form.teams) < Math.abs(b - form.teams) || (Math.abs(v - form.teams) === Math.abs(b - form.teams) && v > b) ? v : b), tv[0]);
    for (const [k, d] of Object.entries(BONUS)) form[k] = form[k + "On"] ? (+form[k + "Amt"] > 0 ? +form[k + "Amt"] : d) : 0;
    form.keepers = form.kind === "dynasty" ? -1 : form.kind === "keeper" ? form.keepN : 0;
    form.vamp = form.vampOn ? form.vampWho || "random" : "off";
  }

  async function makeLeague() {
    grab();
    const why = (m) => { const el = $("#n-why"); if (el) el.textContent = m; };
    const need = (m, el) => { why(m); const x = $(el); if (x) { x.focus({ preventScroll: true }); x.scrollIntoView({ block: "center", behavior: "smooth" }); } };
    if (!(form.name || "").trim()) return need("Give the league a name.", "#n-name");
    if (!(form.me || "").trim()) return need("Add your name.", "#n-me");
    busy = true; render();
    try {
      const r0 = await fetch(`data/${form.sport}.json`, { cache: "no-cache" });
      const data = await r0.json();
      // a custom scoring rides along as plain data (D.scoringSpec) and becomes the sport's "custom" scoring
      const ex = form.sport === "nfl" && form.scoring !== "cc" ? nflExtras() : null, sp0 = S[form.sport];
      const spec = form.scoring === "cp" ? Object.assign({ type: "points", weights: Object.fromEntries(Object.entries(form.weights || S.POINT_DEFAULTS[form.sport]).filter(([, v]) => v)) }, ex || {})
        : form.scoring === "cc" ? { type: "cats", cats: (form.cats || []).slice() }
        : ex ? Object.assign({ type: "points", base: sp0.scorings[form.scoring] ? form.scoring : Object.keys(sp0.scorings)[0] }, ex) : null;
      if (spec && spec.type === "cats" && spec.cats.length < 2) throw new Error("Pick at least two categories.");
      if (spec && spec.type === "points" && !spec.base && !Object.keys(spec.weights).length) throw new Error("Give at least one stat a point value.");
      const sport = S.withScoring(S.attach(Object.assign({}, S[form.sport]), data), spec);
      const have = new Set(data.players.flatMap((p) => p.pos));
      // one-week football drafts from its slate's games (one game is a showdown)
      const slate = slateOn() ? curSlate() : null;
      if (slateOn() && !slate) throw new Error(slData() ? (dayOn() ? "Pick tonight's games." : "Pick the games for this week.") : "The schedule is still loading. Try again in a moment.");
      if (slate && slate.first <= Date.now()) throw new Error(`A game in this slate ${dayOn() ? "has tipped off" : "has kicked off"}. Pick the games again.`);
      const sd = slate && slate.games.length === 1 ? sdGame() : null;
      const slu = slate && !heist() ? SL.lineup(slate.games.length, form.teams, form.sport) : null;
      const lineup = slu ? slu.lineup.slice() : lineupOf(sport).filter((s) => sport.slots[s] === "*" || sport.slots[s].some((x) => have.has(x)));
      const bench = capOn() ? 0 : slu ? slu.bench : benchOf(sport);
      const players = data.players.filter((p) => !slate || slate.teams.includes(p.t)).map((p) => Object.assign({}, p));
      const scoring = spec ? "custom" : sport.scorings[form.scoring] ? form.scoring : Object.keys(sport.scorings)[0];
      const n = form.teams, total = n * (lineup.length + bench);
      // can the player pool fill it? every one-position slot needs a player per team, and so does every roster spot
      const need = {};
      for (const sl of lineup) { const v = sport.slots[sl]; if (v !== "*" && v.length === 1) need[v[0]] = (need[v[0]] || 0) + n; }
      if (!capOn()) for (const [pos, k] of Object.entries(need)) {
        const haveN = players.filter((p) => S.positions(p).includes(pos)).length;
        if (haveN < k) throw new Error(`There aren't enough ${pos} for this lineup: ${n} teams need ${k}, and the pool has ${haveN}.`);
      }
      if (!capOn() && total > players.length) throw new Error(`${n} teams with ${lineup.length + bench} roster spots need ${total} players, and the pool has ${players.length}.`);
      const bb = !!form.bestball && form.season !== "guillotine" && !capOn();
      const wk = bb ? await fetch(`data/weeks-${form.sport}.json`, { cache: "no-cache" }).then((x) => (x.ok ? x.json() : null)).catch(() => null) : null;
      V.evaluate(sport, players, { teams: n, lineup, bench, scoring, week: slate ? S.weekFor({ season: { slate } }, sport) : null, oneDay: !!(slate && slate.day), bestBall: bb, weeks: wk && String(wk.season) === String(data.season) ? wk : null, dynasty: form.keepers === -1 && form.season !== "guillotine", dynastyRanks: form.keepers === -1 && form.season !== "guillotine" ? await fetch(`data/dynasty-${form.sport}.json`, { cache: "no-cache" }).then((x) => (x.ok ? x.json() : null)).catch(() => null) : null });
      const auction = form.type === "auction";
      // the vampire (the commissioner, or a random team) sits out the draft
      const vampire = vampOk() && form.vamp !== "off" ? (form.vamp === "me" ? 0 : Math.floor(Math.random() * n)) : null;
      const D = F.create({ sport, type: draftType(), teams: n, sit: vampire != null ? [vampire] : undefined, seed: Math.floor(Math.random() * 2 ** 31), now: Date.now(), lineup, bench, scoring,
        botDelay: 2000, clock: auction ? 0 : form.clock, bidClock: auction ? form.clock : 15, nomClock: 30, budget: sd ? 50 : 200, name: form.name.trim(),
        trades: form.trades !== 0 && !noRoom() && !trivia(), curve: form.type === "mystery" ? F.pickCurve(players, total) : null, reveal: form.type === "mystery" ? form.reveal || "start" : undefined });
      D.teams.forEach((t, i) => (t.color = (i * 5) % 12));
      if (form.type === "pack") F.dealPacks(D, players, sport);
      if (rlOk() && form.rlOn) {
        let pro = [...new Set(players.map((p) => p.t).filter((t) => t && t !== "FA"))].sort();
        // a one-week league that starts now leaves out teams on a bye or already done playing
        if (oneWeek() && form.when !== "next") { const lv = await C.live(form.sport).catch(() => null); const playing = Object.entries((lv && lv.games) || {}).filter(([, gs]) => (gs || []).some((g) => g.state === "pre")).map(([t]) => t); if (playing.length >= 4) pro = pro.filter((t) => playing.includes(t)); }
        D.roulette = { teams: pro, each: form.rlRound ? "round" : "pick", respins: form.respins || 0, spins: {}, used: {} };
      }
      if (D.trading) D.offerHold = form.ohold || "clock";
      if (trivia()) D.trivia = { sec: 15, ok: {}, bumped: {}, used: [], log: [] };
      if (capOn()) {
        D.cap = { budget: form.capBudget || 100, due: slate.first, bonus: form.capBonus ? 1.25 : null };
        D.cap.prices = F.capPrices(D, players, sport);
      } else if (sealedOn()) {
        const t = form.lkAt || draftTimeDefault();
        if (t < Date.now() + 2 * 6e4) throw new Error("Pick a time for the lists to lock that's still to come.");
        if (slate && t >= slate.first) throw new Error(`The lists have to lock before the first ${dayOn() ? "tip" : "kickoff"}, ${SL.kick(slate.games[0].at)}.`);
        D.sealed = { due: t };
      } else if (form.dtMode === "at") {
        const t = form.dtAt || draftTimeDefault();
        if (t < Date.now() + 2 * 6e4) throw new Error("Pick a draft time that's still to come.");
        if (slate && t >= slate.first) throw new Error(`The draft has to start before the first ${dayOn() ? "tip" : "kickoff"}, ${SL.kick(slate.games[0].at)}.`);
        D.startAt = t;
      }        // each team its own color, the same ones the league pages use
      const tn = (form.team || "").trim() || `${form.me.trim().split(" ")[0]}'s team`;
      D.teams[0].name = tn.slice(0, 28);
      D.teams[0].abbr = tn.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 3).toUpperCase() || "YOU";
      const gl = form.season === "guillotine";
      if (spec) D.scoringSpec = spec;
      const fmt = gl ? "guillotine" : form.season === "roto" ? "roto" : "h2h";
      D.season = { format: fmt, tally: form.season === "h2hcats" ? "cats" : form.season === "allplay" ? "allplay" : "game", weeks: form.weeks,
        faab: form.faab == null ? (gl ? 1000 : 100) : form.faab, ir: form.ir, maxAdds: form.maxAdds || 0, maxAddsSeason: form.maxAddsSeason || 0, minBid: form.minBid || 0, waiverPrice: form.waiverPrice === "second" ? "second" : "first",
        posMax: Object.fromEntries(Object.entries(form.posMax).filter(([, v]) => v)) };
      if (form.keepers > 0) Object.assign(D.season, { keepers: form.keepers, keeperCost: kc() });
      if (form.keepers === -1 && !gl) { D.season.dynasty = { rounds: form.rookie || 3, picks: form.fpicks !== 0 }; if (form.taxi) D.season.taxi = form.taxi; }
      if (sd) Object.assign(D.season, { showdown: { id: sd.id, teams: [sd.away, sd.home], at: sd.at, week: sd.week, label: `${sd.away} @ ${sd.home}` }, ir: 0, when: "now" });
      else if (slate) Object.assign(D.season, { slate: Object.assign({}, slate, slu && slu.mult ? { mult: slu.mult } : {}), ir: 0, when: slate.day || (slWeeks()[0] && slWeeks()[0].week === slate.week) ? "now" : "next" });
      if (form.bestball && !sd && !capOn()) D.season.bestBall = true;
      else if (gl) D.season.bestBall = false;
      if (form.season === "h2h" && form.median && scoringType(sport) === "points") D.season.median = true;
      if (vampire != null) D.season.vampire = { team: vampire, samePos: form.vlike === 1, double: form.vdouble === 1 };
      if (fmt !== "roto" && !gl && form.divs && n >= 2 * form.divs) D.season.divisions = form.divs;
      if (twistOk()) {
        if (form.pyoOn && n % 2 === 0) { D.season.pyo = true; delete D.season.divisions; }
        if (form.robinOn) D.season.robin = { protect: form.robinP };
        if (form.conqOn) D.season.conquest = { protect: form.conqP, like: !!form.conqLike };
        if (form.crownOn && form.waivers === "faab") D.season.crown = { start: form.crownStep, step: form.crownStep, keep: form.crownKeep };
        if (form.hangOn) D.season.hangover = true;
      }
      if (gl && form.tbOn) D.season.topBonus = form.tbAmt;
      if (form.sport === "nfl" && form.confOn) D.season.confMax = 2;
      if (heist()) Object.assign(D.season, { heist: { shields: form.hzShields, steals: form.hzSteals, jinxes: form.hzJinxes, clock: form.hzClock }, ir: 0 });
      if (oneWeek()) Object.assign(D.season, { weeks: 1, when: D.season.when || (form.when === "next" || form.sport === "mlb" ? "next" : "now"), oneWeek: true });
      if (!gl) Object.assign(D.season, { waivers: form.waivers, deadline: oneWeek() ? 0 : form.deadline == null ? Math.max(1, form.weeks - 3) : form.deadline, review: n <= 2 && form.review === "vote" ? "none" : form.review, waiverDays: form.waiverDays, gameLock: form.gameLock || (form.sport === "nfl" ? "week" : "off"), reviewHours: form.reviewHours, vetoShare: form.vetoShare, waiverOrder: form.waiverOrder,
        playoffTeams: fmt === "roto" || oneWeek() ? 0 : Math.min(form.playoffs, n), playoffLegs: form.legs,
        consolation: form.cons === "third" && Math.min(form.playoffs, n) < 3 ? "none" : form.cons === "bracket" && n - Math.min(form.playoffs, n) < 2 ? "none" : form.cons });
      if (rematch) {
        D.teams.forEach((t, i) => { const o = rematch.teams[i]; if (o) Object.assign(t, o); });
        const r = await C.rpc("fk_rematch", { p_id: rematch.id, p_draft: D, p_name: form.name }).catch((e) => ({ error: e.message }));
        if (!r || r.error) throw new Error((r && r.error) || "Couldn't run it back.");
        if (!r.existed) C.rpc("fk_post", { p_id: rematch.id, p_body: `Running it back: next week's draft room is open. ${location.origin}${location.pathname.replace(/leagues\.html$/, "play.html")}?id=${r.id}` }).catch(() => null);
        location.href = `play.html?id=${encodeURIComponent(r.id)}`;
        return;
      }
      const r = await C.rpc("fk_create", { p_name: form.name, p_sport: form.sport, p_manager: form.me, p_draft: D });
      if (r.error) throw new Error(r.error);
      location.href = `play.html?id=${encodeURIComponent(r.id)}#invite`;
    } catch (e) { busy = false; await render(); why(e.message); }
  }

  app.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.id === "pw-in" || f.id === "pw-up" || f.id === "pw-forgot" || f.id === "pw-new") {
      const v = (id) => { const el = $("#" + id); return el ? el.value : ""; };
      const vals = { login: v("pi-login"), pw: v("pi-pw"), user: v("pu-user"), email: v("pu-email"), upw: v("pu-pw"), flogin: v("pf-login"), npw: v("pn-pw") };
      const btn = f.querySelector("button[type=submit]"); if (btn) { btn.disabled = true; btn.dataset.was = btn.textContent; btn.textContent = "One moment…"; }
      const done = () => { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = btn.dataset.was; } };
      try {
        if (f.id === "pw-in") { await C.passwordSignIn(vals.login, vals.pw); prof = null; }
        else if (f.id === "pw-up") { const r = await C.signUp({ username: vals.user, email: vals.email, password: vals.upw, back: back() }); if (r.confirm) confirmTo = r.email; else prof = null; }
        else if (f.id === "pw-forgot") { await C.resetPassword(vals.flogin, back()); resetTo = vals.flogin.trim(); }
        else { await C.setPassword(vals.npw); recovery = false; U.toast("Password saved. You're signed in."); }
      } catch (err) { done(); U.toast(err.message, true); return; }
      render();
      return;
    }
    if (f.id === "signin") {
      const email = $("#si-email").value;
      busy = true;
      try { await C.signIn(email, back()); sent = email.trim(); } catch (err) { busy = false; render().then(() => U.toast(err.message, true)); return; }
      busy = false; render();
    } else if (f.id === "join") {
      const t = f.querySelector("input[name=team]:checked");
      if (!t) { U.toast("Pick a team", true); return; }
      const r = await C.rpc("fk_join", { p_id: joinId, p_invite: joinCode, p_team: Number(t.value), p_manager: $("#j-name").value }).catch((err) => ({ error: err.message }));
      if (r.error) { U.toast(r.error, true); return; }
      const tn = $("#j-team").value.trim();
      if (tn) await C.rpc("fk_team_name", { p_id: joinId, p_name: tn }).catch(() => null);
      location.href = `play.html?id=${encodeURIComponent(joinId)}`;
    } else if (f.id === "new") makeLeague();
  });
  // a league type, from the cards or the season / one week choice
  function setKind(k) {
    form.kind = k;
    if (!formatFits(formatOf())) { form.vampOn = 0; form.season = oneWeek() ? (form.teams > 2 ? "allplay" : "h2h") : "h2h"; }
    if (!oneWeek() && form.teams === 2) form.teams = 4;
    if (oneWeek() && !WEEK_OK.includes(form.season)) form.season = form.teams > 2 ? "allplay" : "h2h";
    if (oneWeek()) { form.vampOn = 0; form.median = 0; loadSlates(); }
    derive();
    form.open = form.kind === "redraft" || oneWeek() ? {} : { carry: 1 };
  }
  // one week starts fast: everyone vs everyone for a group, a short pick clock, the whole week's games
  function oneWeekDefaults() {
    if (!form.wkSet) { form.wkSet = 1; if (form.teams > 2) form.season = "allplay"; if (form.clock === 90) form.clock = 30; form.slKind = form.slKind || "full"; }
  }
  // redraw the form and put focus back where it was
  const redraw = (focusId) => render().then(() => { const el = focusId && (document.getElementById(focusId) || (focusId.startsWith("n-pick-") && $(`.su [data-${focusId.split("-")[2]}="${focusId.split("-").slice(3).join("-")}"]`))); if (el && !el.disabled) el.focus({ preventScroll: true }); });
  // the twists stay open or closed across redraws
  app.addEventListener("toggle", (e) => { if (e.target && e.target.id === "nl-tw") form.twOpen = e.target.open; }, true);
  app.addEventListener("click", (e) => {
    if (!e.target.closest(".su")) return;
    const row = e.target.closest("[data-row]");
    if (row) { grab(); const k = row.dataset.row; form.open = form.open[k] ? {} : { [k]: 1 }; render().then(() => { const h = $(`.su [data-row="${k}"]`); if (h) { h.focus({ preventScroll: true }); const r = h.getBoundingClientRect(); if (r.top < 70 || r.top > innerHeight - 160) h.scrollIntoView({ block: "start", behavior: "smooth" }); } }); return; }
    const md = e.target.closest("[data-mode]");
    if (md) { grab(); const k = md.dataset.mode === "week" ? "week" : form.lastKind || "redraft"; if (k === "week") oneWeekDefaults(); setKind(k); redraw(`n-pick-mode-${md.dataset.mode}`); return; }
    const ty = e.target.closest("button[data-type]");
    if (ty) { grab(); form.type = ty.dataset.type; derive(); redraw(`n-pick-type-${form.type}`); return; }
    const sk = e.target.closest("[data-slkind]");
    if (sk) { grab(); form.slKind = sk.dataset.slkind; if (form.slKind === "custom" && !(form.slGames || []).length && slWeek()) form.slGames = SL.open(slWeek()).slice(0, 3).map((g) => g.id); derive(); redraw(`n-pick-slkind-${form.slKind}`); return; }
    const so = e.target.closest("[data-slone]");
    if (so) { grab(); form.slOne = so.dataset.slone; derive(); redraw(); return; }
    const sg = e.target.closest("[data-slg]");
    if (sg) { grab(); const id = sg.dataset.slg, cur = new Set(form.slGames || []); if (cur.has(id)) cur.delete(id); else cur.add(id); form.slGames = [...cur]; derive(); redraw(); return; }
    const kd = e.target.closest("[data-kind]");
    if (kd) { grab(); form.lastKind = kd.dataset.kind; setKind(kd.dataset.kind); redraw(`n-pick-kind-${form.kind}`); return; }
    const fm = e.target.closest("[data-format]");
    if (fm) { grab(); pickFormat(fm.dataset.format); derive(); if (fm.dataset.format === "vampire") form.open = { vampire: 1 }; redraw(`n-pick-format-${fm.dataset.format}`); return; }
    const st = e.target.closest("[data-stp]");
    if (st) {
      grab();
      const f = st.dataset.stp, inp = st.parentNode.querySelector("input[type=hidden]"), vals = inp.dataset.vals.split(",").map(Number);
      const i = Math.min(vals.length - 1, Math.max(0, vals.indexOf(Number(inp.value)) + Number(st.dataset.d)));
      if (f.startsWith("pm_")) form.posMax[f.slice(3)] = vals[i]; else form[f] = vals[i];
      derive();
      if (f === "weeks" && form.deadline != null && form.deadline >= form.weeks) form.deadline = null;
      redraw(st.id);
      return;
    }
    const set = e.target.closest("[data-set]");
    if (set) { grab(); form[set.dataset.set] = Number(set.dataset.v); redraw(); return; }
    const cb = e.target.closest("[data-cat]");
    if (cb) {
      grab();
      const k = cb.dataset.cat, on = form.cats || [];
      form.cats = on.includes(k) ? on.filter((x) => x !== k) : on.concat(k);
      render().then(() => { const back = $(`.su [data-cat="${k}"]`); if (back) back.focus(); });
      return;
    }
    const b = e.target.closest("[data-preset], [data-lb]");
    if (!b) return;
    grab();
    const sp = S[form.sport], next = U.lineupStep(sp, lineupOf(sp), b);
    if (!next.length) { U.toast("A lineup needs at least one starter", true); return; }
    form.lineup = next.join(" ");
    render().then(() => { const back = b.dataset.lb ? $(`.su [data-lb="${b.dataset.lb}"][data-d="${b.dataset.d}"]`) : $(`.su [data-preset="${b.dataset.preset}"]`); if (back && !back.disabled) back.focus(); });
  });
  // sliders read out as they move; the league name shows on the summary as you type
  app.addEventListener("input", (e) => {
    const el = e.target;
    if (el.type === "range" && el.dataset.f && RANGE_FMT[el.dataset.f]) {
      const out = $(`.su [data-out="${el.dataset.f}"]`); if (out) out.textContent = RANGE_FMT[el.dataset.f](Number(el.value));
      el.style.setProperty("--pct", `${((el.value - el.min) / (el.max - el.min || 1)) * 100}%`);
    } else if (el.id === "n-name") { const t = $("#tk-name"); if (t) t.textContent = el.value || "Your league"; }
  });
  app.addEventListener("change", (e) => {
    if (!e.target.closest(".su") || !(e.target.name === "sport" || e.target.dataset.f)) return;
    const was = { sport: form.sport, season: form.season, weeks: form.weeks };
    grab();
    // a shorter season can't keep a deadline past its end; go back to the default for the new length
    if (form.weeks !== was.weeks && form.deadline != null && form.deadline >= form.weeks) form.deadline = null;
    // a new sport starts from its own lineup; a new season format from its own budget
    if (form.sport !== was.sport) { form.lineup = ""; form.bench = null; form.scoring = ""; form.weights = null; form.cats = null; form.posMax = {}; }
    if (form.season !== was.season) form.faab = null;
    redraw(e.target.id);
  });
  document.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-a]"), th = e.target.closest("button[data-theme]");
    if (th) { theme.toggle(); header(); return; }
    if (!a) return;
    const k = a.dataset.a;
    if (k === "out") { await C.signOut(); sent = null; prof = null; siMode = "password"; confirmTo = null; resetTo = null; recovery = false; render(); }
    else if (k === "profile") U.profileDialog(prof, async (v) => { const r = await C.rpc("fk_profile_set", { p_name: v.name, p_photo: v.photo }); if (r && r.ok) { prof = Object.assign({}, prof, { name: r.name, photo: v.photo, saved: true }); form.me = r.name; render(); } return r; });
    else if (k === "again") { sent = null; render(); }
    else if (k === "oauth") C.oauth(a.dataset.p, location.href.split("#")[0]);
    else if (k === "si-mode") { siMode = a.dataset.m; confirmTo = null; resetTo = null; sent = null; render().then(() => { const el = $(".si-card input:not([type=hidden])"); if (el) el.focus(); }); }
    else if (k === "si-show") { const el = document.getElementById(a.dataset.for); if (el) { const show = el.type === "password"; el.type = show ? "text" : "password"; a.textContent = show ? "Hide" : "Show"; a.setAttribute("aria-label", show ? "Hide password" : "Show password"); } }
    else if (k === "account") accountDialog();
    else if (k === "pw-skip") { recovery = false; render(); }
    else if (k === "resend") { try { await C.signIn(sent, back()); U.toast("Sent again."); } catch (err) { U.toast(err.message, true); } }
    else if (k === "new") { view = "new"; render(); }
    else if (k === "list") { view = "list"; render(); }
    else if (k === "slates-retry") { delete slatesFor[form.sport]; slatesAsked[form.sport] = false; render(); }
  });
  // a sign-in link opened in this same tab only changes the hash
  window.addEventListener("hashchange", () => { const l = C.fromLink(); if (l) { sent = null; confirmTo = null; resetTo = null; if (l.recovery) recovery = true; if (l.error) U.toast(l.error, true); render(); } });
  render().catch((e) => page(fail(e.message)));
})();
