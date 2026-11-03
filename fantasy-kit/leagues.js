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
  const form = { sport: "nfl", teams: 10, type: "snake", clock: 90, season: "h2h", weeks: 14, trades: 1, scoring: "",
    lineup: "", bench: null, playoffs: 4, deadline: null, review: "vote", faab: null, waiverHours: 36,
    weights: null, cats: null, waivers: "faab", ir: 1, maxAdds: 0, posMax: {}, keepers: 0, keeperCost: "round", legs: "1", cons: "none", median: 0, bestball: 0, divs: 0, rookie: 3, fpicks: 1, taxi: 2, ohold: "clock", tep: 0, ptd: 4, b100r: 0, b100c: 0, b300p: 0 };
  // scoring: a preset key, or "cp" (custom points) / "cc" (custom categories)
  const isCustom = () => form.scoring === "cp" || form.scoring === "cc";
  const scoringType = (sp) => (form.scoring === "cp" ? "points" : form.scoring === "cc" ? "cats" : (sp.scorings[form.scoring] || Object.values(sp.scorings)[0]).type);
  // season: how a week is decided. Category leagues can count each category, or go rotisserie; points leagues can add all-play.
  const SEASONS = { cats: [["h2h", "Head to head: most categories wins the week"], ["h2hcats", "Head to head: each category is a win or loss"], ["roto", "Rotisserie: season totals"], ["guillotine", "Best ball guillotine"]],
    points: [["h2h", "Head to head"], ["allplay", "All-play: your score against every team"], ["guillotine", "Best ball guillotine"]] };
  const h2hLike = () => form.season === "h2h" || form.season === "h2hcats" || form.season === "allplay";
  // the sport's standard lineup, without slots its player pool can't fill
  const lineupOf = (sp) => (form.lineup ? form.lineup.split(" ") : sp.lineup.slice()).filter((x) => sp.slots[x] && x !== "BN");
  if (S.ALL[params.get("s")]) { form.sport = params.get("s"); view = "new"; }

  function header() {
    top.innerHTML = U.shell({ brand: { name: "Draft Lab", href: "./", mark: `<img src="mark.svg" alt="">` },
      tabs: [["draft", "Mock draft"], ["rankings", "Rankings"], ["league", "Demo league"], ["leagues", "Your leagues"], ["kit", "The kit"]], tab: "leagues",
      right: `${C.user() ? `<button class="btn sm ghost" data-a="out">Sign out</button>` : ""}<button class="btn sm ghost" data-theme>${theme.dark() ? "Light" : "Dark"}</button>`,
      hrefOf: (t) => (t === "leagues" ? "leagues.html" : t === "league" ? "league.html" : "./#" + t) });
  }
  const page = (html) => { app.innerHTML = `<div class="wrap page">${html}</div>`; };
  const fail = (msg) => `<div class="banner loss" role="alert"><b>${esc(msg)}</b></div>`;
  const back = () => location.origin + location.pathname + location.search;

  async function render() {
    header();
    const u = C.user();
    const err = link && link.error ? fail(`That sign-in link didn't work: ${link.error}. Send yourself a new one.`) : "";
    let invite = "";
    if (joinId) {
      const v = await C.rpc("fk_view", { p_id: joinId, p_since: null }).catch((e) => ({ error: e.message }));
      invite = v.error ? fail(v.error) : u ? joinCard(v) : `<div class="banner"><b>You're invited to ${esc(v.name)}</b> <span class="muted">a ${esc(S[v.sport].name.toLowerCase())} league with ${v.draft.teams.length} teams. Sign in to pick your team.</span></div>`;
    }
    if (!u) return page(`${err}${invite}${signInCard()}`);
    if (view === "new") return page(newForm());
    const mine = await C.rpc("fk_mine", {}).catch((e) => ({ error: e.message }));
    // on an invite, the join form is the page; your other leagues, if any, follow it quietly
    if (joinId) return page(`${err}${invite}${Array.isArray(mine) && mine.length ? `<div class="head" style="margin-top:8px"><h2 style="margin:0">Your other leagues</h2></div><div class="lgl">${mine.map(card).join("")}</div>` : ""}`);
    page(`${err}${invite}
      <div class="head"><h1 class="disp">Your leagues</h1><span class="ps">Signed in as ${esc(u.email)}</span><span class="grow"></span><button class="btn go" data-a="new">Start a league</button></div>
      ${mine.error ? fail(mine.error) : mine.length ? `<div class="lgl">${mine.map(card).join("")}</div>` : joinId ? "" : `<div class="card"><div class="bd stack"><p style="margin:0"><b>No leagues yet.</b></p><p class="ps" style="margin:0">Start one and send your friends the invite link, or open the invite link your commissioner sent you.</p><div><button class="btn go" data-a="new">Start a league</button></div></div></div>`}`);
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
    return `<a class="card lgc" href="play.html?id=${esc(l.id)}">${U.teamAv({ abbr: l.sport.toUpperCase(), color: SPORT_CLR[l.sport] }, "md")}
      <span class="grow"><b>${esc(l.name)}</b><small>${esc(S[l.sport].name)}${sub ? `: ${sub}` : ""}</small>${bar != null ? `<span class="lgbar" role="img" aria-label="${Math.round(bar * 100)}% of picks in"><i style="width:${(bar * 100).toFixed(1)}%"></i></span>` : ""}</span>
      ${big ? `<span class="lgstat${l.phase === "live" ? " live" : ""}"><b>${esc(big)}</b><small>${esc(small)}</small></span>` : ""}<span class="btn sm">Open</span></a>`;
  }

  function signInCard() {
    if (sent) return `<div class="card narrow"><div class="bd stack"><h1 class="disp" style="margin:0;font-size:clamp(26px,7vw,32px)">Check your email</h1>
      <p style="margin:0">We sent a sign-in link to <b style="overflow-wrap:anywhere">${esc(sent)}</b>. Open it on the phone or computer you want to play on. It works once and expires in an hour.</p>
      <p class="ps" style="margin:0">Nothing there after a minute? Check spam, or send it again.</p>
      <div class="row" style="flex-wrap:wrap"><button class="btn" data-a="again">Use a different email</button><button class="btn ghost" data-a="resend">Send it again</button></div></div></div>`;
    return `<div class="hero"><h1 class="disp">Draft with<br>your friends.</h1><p>Start a league, send the invite link and draft live. Every move saves for the whole league, and you can get an email when a trade offer or a waiver result needs you.</p></div>
      <form class="card narrow" id="signin"><div class="bd stack">
        <div class="field"><label for="si-email">Email</label><input id="si-email" type="email" autocomplete="email" required value="${esc(C.lastEmail())}" placeholder="you@example.com"></div>
        <button class="btn go" type="submit"${busy ? " disabled" : ""}>Email me a sign-in link</button>
        <p class="ps" style="margin:0">No password. We'll email you a link that signs you in.</p></div></form>`;
  }

  function joinCard(v) {
    const teams = v.draft.teams, seats = v.seats || {};
    if (v.me != null) return `<div class="banner"><b>You're already in ${esc(v.name)}.</b> <a href="play.html?id=${esc(joinId)}">Open the league</a></div>`;
    const open = teams.map((t, i) => [t, i]).filter(([, i]) => seats[i] == null);
    if (!open.length) return fail(`Every team in ${v.name} has a manager.`);
    const u = C.user(), guess = (u.email.split("@")[0] || "").replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 24);
    return `<form class="card" id="join"><div class="mod-h"><h2>Join ${esc(v.name)}</h2><span class="ps">${esc(S[v.sport].name)}, ${teams.length} teams${v.draft.phase !== "setup" ? ". The draft has started, so you take over that team's picks." : ""}</span></div><div class="bd stack">
      <fieldset class="seats"><legend class="sr">Pick a team</legend>${teams.map((t, i) => `<label class="${seats[i] != null ? "taken" : ""}"><input type="radio" name="team" value="${i}"${seats[i] != null ? " disabled" : open[0][1] === i ? " checked" : ""}>${U.teamAv(t, "sm")}<span><b>${esc(t.name)}</b><small>${seats[i] != null ? esc(seats[i]) : "Open"}</small></span></label>`).join("")}</fieldset>
      <div class="field"><label for="j-name">Your name</label><input id="j-name" type="text" maxlength="24" required value="${esc(guess)}"></div>
      <div><button class="btn go" type="submit">Join the league</button></div></div></form>`;
  }

  function newForm() {
    const sp = S[form.sport];
    const scoring = sp.scorings[form.scoring] || isCustom() ? form.scoring : Object.keys(sp.scorings)[0];
    const opt = (v, l, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(l)}</option>`;
    const auction = form.type === "auction";
    const seasons = SEASONS[scoringType(sp)];
    if (!seasons.some(([k]) => k === form.season)) form.season = "h2h";
    const clocks = auction ? [[15, "15 seconds a bid"], [30, "30 seconds a bid"], [60, "1 minute a bid"]]
      : [[30, "30 seconds"], [60, "1 minute"], [90, "90 seconds"], [120, "2 minutes"], [3600, "1 hour (slow draft)"], [14400, "4 hours (slow draft)"], [28800, "8 hours (slow draft)"]];
    if (!clocks.some(([v]) => v === form.clock)) form.clock = clocks[auction ? 0 : 2][0];
    return `<div class="head"><h1 class="disp">Start a league</h1><span class="ps">You'll be the commissioner. You can invite everyone once it's made.</span></div>
      <form class="card form" id="new"><div class="bd stack">
        <div class="sports" role="radiogroup" aria-label="Sport">${Object.values(S.ALL).map((s) => `<label><input type="radio" name="sport" value="${s.key}"${s.key === form.sport ? " checked" : ""}><span><b class="disp">${esc(s.name)}</b><small>${esc(BLURB[s.key])}</small></span></label>`).join("")}</div>
        <div class="row3">
          <div class="field"><label for="n-name">League name</label><input id="n-name" type="text" maxlength="40" required value="${esc(form.name || "")}"></div>
          <div class="field"><label for="n-me">Your name</label><input id="n-me" type="text" maxlength="24" required value="${esc(form.me || "")}"></div>
          <div class="field"><label for="n-team">Your team's name</label><input id="n-team" type="text" maxlength="28" value="${esc(form.team || "")}" placeholder="Optional"></div>
        </div>
        <div class="row3">
          <div class="field"><label for="n-teams">Teams</label><select id="n-teams" data-f="teams">${[4, 6, 8, 10, 12, 14, 16, 20].map((n) => opt(n, n, form.teams)).join("")}</select></div>
          <div class="field"><label for="n-type">Draft</label><select id="n-type" data-f="type">${Object.entries(F.FORMATS).map(([k, l]) => opt(k, l, form.type)).join("")}</select></div>
          <div class="field"><label for="n-clock">${auction ? "Bid clock" : "Pick clock"}</label><select id="n-clock" data-f="clock">${clocks.map(([v, l]) => opt(v, l, form.clock)).join("")}</select></div>
        </div>
        ${!auction && form.type !== "mystery" && form.type !== "elephant" ? `<div class="row3"><div class="field"><label for="n-trades">Trades during the draft</label><select id="n-trades" data-f="trades">${opt(1, "Picks and players", form.trades)}${opt(0, "Off", form.trades)}</select></div>${form.trades !== 0 ? `<div class="field"><label for="n-oh">A trade offer stops the clock</label><select id="n-oh" data-f="ohold">${opt("clock", "When it's to the team on the clock", form.ohold)}${opt("all", "For any manager, up to 90 seconds", form.ohold)}${opt("off", "Never: the draft keeps going", form.ohold)}</select></div>` : ""}</div>` : ""}
        <div class="row3">
          <div class="field"><label for="n-scoring">Scoring</label><select id="n-scoring" data-f="scoring">${Object.entries(sp.scorings).map(([k, s]) => opt(k, s.label.replace(/ \(.*\)$/, ""), scoring)).join("")}${opt("cp", "Custom points", scoring)}${sp.key !== "nfl" ? opt("cc", "Custom categories", scoring) : ""}</select></div>
          <div class="field"><label for="n-season">Season</label><select id="n-season" data-f="season">${seasons.map(([k, l]) => opt(k, l, form.season)).join("")}</select></div>
          ${form.season !== "guillotine" ? `<div class="field"><label for="n-weeks">${form.playoffs && h2hLike() ? "Weeks before playoffs" : "Season length"}</label><select id="n-weeks" data-f="weeks">${[8, 10, 12, 14, 16].map((n) => opt(n, `${n} weeks`, form.weeks)).join("")}</select></div>`
            : `<div class="field"><label>Weeks</label><p class="ps" style="margin:6px 0 0">${form.teams - 1}: the lowest score is chopped each week</p></div>`}
        </div>
        ${scoringEditor(sp)}
        ${rulesFields(sp)}
        <p class="ps" style="margin:0">Teams nobody has claimed draft on their own. Anyone with the invite link can take one over, even after the draft. ${form.clock >= 3600 ? "In a slow draft, managers who turn on email alerts get one when they're on the clock." : "If someone's clock runs out, the best player left is taken for them."}</p>
        <p class="ps" id="n-why" role="alert" style="margin:0;color:var(--loss)"></p>
        <div class="row"><button class="btn go" type="submit"${busy ? " disabled" : ""}>${busy ? "Making the league…" : "Make the league"}</button><button class="btn ghost" type="button" data-a="list">Cancel</button></div>
      </div></form>`;
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
    const opt = (v, l, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(l)}</option>`;
    const pts = (id, label, cur) => `<div class="field"><label for="n-${id}">${label}</label><select id="n-${id}" data-f="${id}">${[0, 1, 2, 3, 5].map((x) => opt(x, x ? `+${x} points` : "No bonus", cur)).join("")}</select></div>`;
    return `<fieldset class="rules"><legend>Bonuses</legend><div class="row3">
      <div class="field"><label for="n-tep">TE premium</label><select id="n-tep" data-f="tep">${[0, 0.25, 0.5, 1].map((x) => opt(x, x ? `+${x} a catch` : "None", form.tep)).join("")}</select></div>
      ${form.scoring === "cp" ? "" : `<div class="field"><label for="n-ptd">Passing TDs</label><select id="n-ptd" data-f="ptd">${[4, 5, 6].map((x) => opt(x, `${x} points`, form.ptd)).join("")}</select></div>`}
      ${pts("b100r", "100-yard rushing game", form.b100r)}${pts("b100c", "100-yard receiving game", form.b100c)}${pts("b300p", "300-yard passing game", form.b300p)}
    </div><p class="ps" style="margin:6px 0 0">A yardage bonus counts once a game. Player values and projections include what each bonus is likely to add.</p></fieldset>`;
  }
  // Custom scoring: a value for every stat, or the categories to play.
  function scoringEditor(sp) {
    if (form.scoring !== "cc" && sp.key === "nfl") return pointsEditor(sp) + bonusFields(sp);
    return pointsEditor(sp);
  }
  function pointsEditor(sp) {
    if (form.scoring === "cp") {
      const w = form.weights || (form.weights = Object.assign({}, S.POINT_DEFAULTS[sp.key]));
      return `<fieldset class="rules"><legend>Points for each stat</legend><div class="wts">${S.POINT_STATS[sp.key].map(([k, l]) => `<label class="wt"><span>${esc(l)}</span><input type="number" step="0.01" data-w="${esc(k)}" value="${w[k] != null ? w[k] : 0}" aria-label="Points for ${esc(l)}"></label>`).join("")}</div>
        <p class="ps" style="margin:8px 0 0">${sp.key === "nfl" ? "Per yard, catch, touchdown and so on. Points allowed counts each point a defense gives up, so use a small negative number. Bonuses for big games are below." : sp.key === "mlb" ? "Hitting and pitching stats from each player's line. Total bases count singles 1, doubles 2, triples 3 and homers 4." : "Per stat, per game."}</p></fieldset>`;
    }
    if (form.scoring === "cc") {
      const all = S.catCatalog(sp);
      const on = form.cats || (form.cats = (Object.values(sp.scorings).find((x) => x.type === "cats") || { cats: [] }).cats.map((c) => c.k));
      return `<fieldset class="rules"><legend>Categories (${on.length} chosen)</legend><div class="chips presets" role="group" aria-label="Categories">${all.map((c) => `<button type="button" data-cat="${esc(c.k)}" aria-pressed="${on.includes(c.k)}">${esc(c.label)}</button>`).join("")}</div>
        <p class="ps" style="margin:4px 0 0">Pick at least two. ${all.some((c) => c.low) ? "Some, like turnovers and ERA, are better low." : ""}</p></fieldset>`;
    }
    return "";
  }
  // Lineup, bench, budget, and the head to head rules: playoffs, the trade deadline and trade review.
  function rulesFields(sp) {
    const opt = (v, l, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(l)}</option>`;
    const gl = form.season === "guillotine", n = form.teams;
    const bench = form.bench == null ? sp.bench : form.bench, faab = form.faab == null ? (gl ? 1000 : 100) : form.faab;
    const po = Math.min(form.playoffs, n), dl = form.deadline == null ? Math.max(1, form.weeks - 3) : form.deadline;
    return `<fieldset class="rules"><legend>Starting lineup</legend>${U.lineupBuilder(sp, lineupOf(sp))}</fieldset>
      <h3 class="fsec">Rosters and waivers</h3>
      <div class="row3">
        <div class="field"><label for="n-bench">Bench spots</label><select id="n-bench" data-f="bench">${[2, 3, 4, 5, 6, 7, 8, 10].map((x) => opt(x, x, bench)).join("")}</select></div>
        ${gl || form.waivers === "faab" ? `<div class="field"><label for="n-faab">FAAB budget</label><select id="n-faab" data-f="faab">${[100, 200, 500, 1000].map((x) => opt(x, `$${x}${gl ? " for the season" : ""}`, faab)).join("")}</select></div>` : `<div class="field"><label>FAAB budget</label><p class="ps" style="margin:6px 0 0">None: claims go by waiver priority</p></div>`}
        ${gl ? `<div class="field"><label>Waivers</label><p class="ps" style="margin:6px 0 0">Run midweek, 60 hours in, so a chopped roster is back in play</p></div>`
          : `<div class="field"><label for="n-wh">Dropped players clear in</label><select id="n-wh" data-f="waiverHours">${[24, 36, 48, 72].map((x) => opt(x, `${x} hours`, form.waiverHours)).join("")}</select></div>`}
      </div>
      <div class="row3">
        ${gl ? "" : `<div class="field"><label for="n-wv">Waivers</label><select id="n-wv" data-f="waivers">${opt("faab", "FAAB bids", form.waivers)}${opt("rolling", "Rolling priority", form.waivers)}</select></div>`}
        <div class="field"><label for="n-ir">IR spots</label><select id="n-ir" data-f="ir">${[0, 1, 2, 3, 4].map((x) => opt(x, x ? x : "None", form.ir)).join("")}</select></div>
        <div class="field"><label for="n-ma">Pickups a week</label><select id="n-ma" data-f="maxAdds">${[0, 1, 2, 3, 4, 5, 7, 10].map((x) => opt(x, x ? `Up to ${x}` : "No limit", form.maxAdds)).join("")}</select></div>
      </div>
      <details class="rules-more"${Object.values(form.posMax).some(Boolean) ? " open" : ""}><summary>Position limits</summary><div class="pml">${(POS_MAIN[sp.key] || []).map((ps) => `<label class="wt"><span>${esc(ps)}</span><select data-pm="${esc(ps)}" aria-label="Most ${esc(ps)} on a roster">${opt(0, "Any", form.posMax[ps] || 0)}${[1, 2, 3, 4, 5, 6, 8].map((x) => opt(x, `Up to ${x}`, form.posMax[ps] || 0)).join("")}</select></label>`).join("")}</div></details>
      ${form.season === "guillotine" ? "" : `<h3 class="fsec">Weekly format</h3><div class="row3">
        <div class="field"><label for="n-bb">Lineups</label><select id="n-bb" data-f="bestball">${opt(0, "Set each week", form.bestball)}${opt(1, "Best ball: set for you", form.bestball)}</select></div>
        ${form.season === "h2h" ? `<div class="field"><label for="n-md">Median game</label><select id="n-md" data-f="median">${opt(0, "Off", form.median)}${opt(1, "On: also play the league median", form.median)}</select></div>` : ""}
        ${form.season !== "roto" && n >= 4 ? `<div class="field"><label for="n-dv">Divisions</label><select id="n-dv" data-f="divs">${[0, 2, 3, 4].filter((k) => !k || n >= 2 * k).map((k) => opt(k, k ? `${k} divisions` : "None", form.divs)).join("")}</select></div>` : ""}
      </div>`}
      ${!h2hLike() ? (form.season === "roto" ? `<h3 class="fsec">Trades</h3><div class="row3">${dealRules()}</div>` : "") : `<h3 class="fsec">Playoffs and trades</h3><div class="row3">
        <div class="field"><label for="n-po">Playoff teams</label><select id="n-po" data-f="playoffs">${[0, 2, 3, 4, 6, 8, 10, 12].filter((x) => x <= n).map((x) => { const b = 2 ** Math.ceil(Math.log2(Math.max(2, x))) - x; return opt(x, x ? `${x} teams${b ? `, top ${b} get a bye` : ""}` : "No playoffs", po); }).join("")}</select></div>
        ${dealRules()}
      </div>
      ${po >= 2 ? `<div class="row3">
        <div class="field"><label for="n-lg">Playoff rounds</label><select id="n-lg" data-f="legs">${opt("1", "One week each", form.legs)}${opt("final2", "Two-week final", form.legs)}${opt("all2", "Two weeks each", form.legs)}</select></div>
        <div class="field"><label for="n-cs">Also play</label><select id="n-cs" data-f="cons">${opt("none", "Nothing else", form.cons)}${po >= 3 ? opt("third", "A third-place game", form.cons) : ""}${n - po >= 2 ? opt("bracket", "A consolation bracket", form.cons) : ""}</select></div>
        <div class="field"><label>Playoff weeks</label><p class="ps" style="margin:6px 0 0">${playoffWeeks(po)} after week ${form.weeks}, so the season runs ${form.weeks + playoffWeeks(po)} weeks.</p></div>
      </div>` : ""}`}
      <h3 class="fsec">Next season</h3>
      <div class="row3">
        <div class="field"><label for="n-kp">What carries over</label><select id="n-kp" data-f="keepers">${[0, 1, 2, 3, 4, 5, 6, 8].map((x) => opt(x, x ? `Keep up to ${x}` : "Redraft: nobody carries over", form.keepers)).join("")}${form.season === "guillotine" ? "" : opt(-1, "Dynasty: keep everyone", form.keepers)}</select></div>
        ${form.keepers === -1 ? `<div class="field"><label for="n-rk">Rookie draft</label><select id="n-rk" data-f="rookie">${[2, 3, 4, 5].map((x) => opt(x, `${x} rounds, worst team first`, form.rookie)).join("")}</select></div>
        <div class="field"><label for="n-tx">Taxi squad</label><select id="n-tx" data-f="taxi">${[0, 1, 2, 3, 4, 5].map((x) => opt(x, x ? `${x} spot${x > 1 ? "s" : ""} for rookies` : "None", form.taxi)).join("")}</select></div>
        <div class="field"><label for="n-fp">Trade future picks</label><select id="n-fp" data-f="fpicks">${opt(1, "Yes: next season's picks", form.fpicks)}${opt(0, "No", form.fpicks)}</select></div>` : form.keepers > 0 ? `<div class="field"><label for="n-kc">A keeper costs</label><select id="n-kc" data-f="keeperCost">${(form.type === "auction" ? [["price", "What he went for"], ["price5", "What he went for, plus $5"]] : [["round", "The round he went in"], ["round1", "One round earlier"], ["free", "A last-round pick"]]).map(([v, l]) => opt(v, l, kc())).join("")}</select></div>
        <div class="field"><label>Keeper rules</label><p class="ps" style="margin:6px 0 0">Worst team picks first. Pickups cost ${form.type === "auction" ? "$5" : "the last round"}.</p></div>` : ""}
      </div>`;
    function dealRules() {
      return `<div class="field"><label for="n-dl">Trade deadline</label><select id="n-dl" data-f="deadline">${opt(0, "None", dl)}${Array.from({ length: form.weeks - 1 }, (_, i) => i + 1).map((x) => opt(x, `After week ${x}`, dl)).join("")}</select></div>
        <div class="field"><label for="n-rv">Trade review</label><select id="n-rv" data-f="review">${opt("vote", "League can veto for 24 hours", form.review)}${opt("none", "None: trades go through", form.review)}</select></div>`;
    }
  }
  const playoffWeeks = (po) => { const R = Math.ceil(Math.log2(po)); return form.legs === "all2" ? 2 * R : form.legs === "final2" ? R + 1 : R; };
  const kc = () => { const ok = form.type === "auction" ? ["price", "price5"] : ["round", "round1", "free"]; return ok.includes(form.keeperCost) ? form.keeperCost : ok[0]; };
  const POS_MAIN = { nfl: ["QB", "RB", "WR", "TE", "K", "DEF"], nba: ["PG", "SG", "SF", "PF", "C"], mlb: ["C", "1B", "2B", "3B", "SS", "OF", "SP", "RP"] };
  // keep what's typed when a choice redraws the form
  function grab() {
    const f = $("#new"); if (!f) return;
    form.name = $("#n-name").value; form.me = $("#n-me").value; form.team = $("#n-team").value;
    const s = f.querySelector("input[name=sport]:checked"); if (s) form.sport = s.value;
    f.querySelectorAll("[data-f]").forEach((el) => { form[el.dataset.f] = /^(teams|clock|weeks|trades|bench|faab|playoffs|deadline|waiverHours|ir|maxAdds|keepers|median|bestball|divs|rookie|fpicks|taxi|tep|ptd|b100r|b100c|b300p)$/.test(el.dataset.f) ? Number(el.value) : el.value; });
    f.querySelectorAll("[data-w]").forEach((el) => { form.weights = form.weights || {}; form.weights[el.dataset.w] = Number(el.value) || 0; });
    f.querySelectorAll("[data-pm]").forEach((el) => { form.posMax[el.dataset.pm] = Number(el.value) || 0; });
  }

  async function makeLeague() {
    grab();
    const why = (m) => { const el = $("#n-why"); if (el) el.textContent = m; };
    if (!form.name.trim()) return why("Give the league a name.");
    if (!form.me.trim()) return why("Add your name.");
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
      const lineup = lineupOf(sport).filter((s) => sport.slots[s] === "*" || sport.slots[s].some((x) => have.has(x)));
      const bench = form.bench == null ? sport.bench : form.bench;
      const players = data.players.map((p) => Object.assign({}, p));
      const scoring = spec ? "custom" : sport.scorings[form.scoring] ? form.scoring : Object.keys(sport.scorings)[0];
      const n = form.teams, total = n * (lineup.length + bench);
      // can the player pool fill it? every one-position slot needs a player per team, and so does every roster spot
      const need = {};
      for (const sl of lineup) { const v = sport.slots[sl]; if (v !== "*" && v.length === 1) need[v[0]] = (need[v[0]] || 0) + n; }
      for (const [pos, k] of Object.entries(need)) {
        const haveN = players.filter((p) => S.positions(p).includes(pos)).length;
        if (haveN < k) throw new Error(`There aren't enough ${pos} for this lineup: ${n} teams need ${k}, and the pool has ${haveN}.`);
      }
      if (total > players.length) throw new Error(`${n} teams with ${lineup.length + bench} roster spots need ${total} players, and the pool has ${players.length}.`);
      V.evaluate(sport, players, { teams: n, lineup, bench, scoring });
      const auction = form.type === "auction";
      const D = F.create({ sport, type: form.type, teams: n, seed: Math.floor(Math.random() * 2 ** 31), now: Date.now(), lineup, bench, scoring,
        botDelay: 3000, clock: auction ? 0 : form.clock, bidClock: auction ? form.clock : 15, nomClock: 30, budget: 200, name: form.name.trim(),
        trades: form.trades !== 0, curve: form.type === "mystery" ? F.pickCurve(players, total) : null, reveal: form.type === "mystery" ? "own" : undefined });
      D.teams.forEach((t, i) => (t.color = (i * 5) % 12));
      if (D.trading) D.offerHold = form.ohold || "clock";        // each team its own color, the same ones the league pages use
      const tn = form.team.trim() || `${form.me.trim().split(" ")[0]}'s team`;
      D.teams[0].name = tn.slice(0, 28);
      D.teams[0].abbr = tn.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 3).toUpperCase() || "YOU";
      const gl = form.season === "guillotine";
      if (spec) D.scoringSpec = spec;
      const fmt = gl ? "guillotine" : form.season === "roto" ? "roto" : "h2h";
      D.season = { format: fmt, tally: form.season === "h2hcats" ? "cats" : form.season === "allplay" ? "allplay" : "game", weeks: form.weeks,
        faab: form.faab == null ? (gl ? 1000 : 100) : form.faab, ir: form.ir, maxAdds: form.maxAdds || 0,
        posMax: Object.fromEntries(Object.entries(form.posMax).filter(([, v]) => v)) };
      if (form.keepers > 0) Object.assign(D.season, { keepers: form.keepers, keeperCost: kc() });
      if (form.keepers === -1 && !gl) { D.season.dynasty = { rounds: form.rookie || 3, picks: form.fpicks !== 0 }; if (form.taxi) D.season.taxi = form.taxi; }
      if (!gl && form.bestball) D.season.bestBall = true;
      if (form.season === "h2h" && form.median) D.season.median = true;
      if (fmt !== "roto" && !gl && form.divs && n >= 2 * form.divs) D.season.divisions = form.divs;
      if (!gl) Object.assign(D.season, { waivers: form.waivers, deadline: form.deadline == null ? Math.max(1, form.weeks - 3) : form.deadline, review: form.review, waiverHours: form.waiverHours,
        playoffTeams: fmt === "roto" ? 0 : Math.min(form.playoffs, n), playoffLegs: form.legs,
        consolation: form.cons === "third" && Math.min(form.playoffs, n) < 3 ? "none" : form.cons === "bracket" && n - Math.min(form.playoffs, n) < 2 ? "none" : form.cons });
      const r = await C.rpc("fk_create", { p_name: form.name, p_sport: form.sport, p_manager: form.me, p_draft: D });
      if (r.error) throw new Error(r.error);
      location.href = `play.html?id=${encodeURIComponent(r.id)}#invite`;
    } catch (e) { busy = false; await render(); why(e.message); }
  }

  app.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
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
      location.href = `play.html?id=${encodeURIComponent(joinId)}`;
    } else if (f.id === "new") makeLeague();
  });
  app.addEventListener("click", (e) => {
    const cb = e.target.closest("#new [data-cat]");
    if (cb) {
      grab();
      const k = cb.dataset.cat, on = form.cats || [];
      form.cats = on.includes(k) ? on.filter((x) => x !== k) : on.concat(k);
      render().then(() => { const back = $(`#new [data-cat="${k}"]`); if (back) back.focus(); });
      return;
    }
    const b = e.target.closest("#new [data-preset], #new [data-lb]");
    if (!b) return;
    grab();
    const sp = S[form.sport], next = U.lineupStep(sp, lineupOf(sp), b);
    if (!next.length) { U.toast("A lineup needs at least one starter", true); return; }
    form.lineup = next.join(" ");
    render().then(() => { const back = b.dataset.lb ? $(`#new [data-lb="${b.dataset.lb}"][data-d="${b.dataset.d}"]`) : $(`#new [data-preset="${b.dataset.preset}"]`); if (back && !back.disabled) back.focus(); });
  });
  app.addEventListener("change", (e) => {
    if (!e.target.closest("#new") || !(e.target.name === "sport" || e.target.dataset.f)) return;
    const was = { sport: form.sport, season: form.season, weeks: form.weeks };
    grab();
    // a shorter season can't keep a deadline past its end; go back to the default for the new length
    if (form.weeks !== was.weeks && form.deadline != null && form.deadline >= form.weeks) form.deadline = null;
    // a new sport starts from its own lineup; a new season format from its own budget
    if (form.sport !== was.sport) { form.lineup = ""; form.bench = null; form.scoring = ""; form.weights = null; form.cats = null; form.posMax = {}; }
    if (form.season !== was.season) form.faab = null;
    render();
  });
  document.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-a]"), th = e.target.closest("button[data-theme]");
    if (th) { theme.toggle(); header(); return; }
    if (!a) return;
    const k = a.dataset.a;
    if (k === "out") { await C.signOut(); sent = null; render(); }
    else if (k === "again") { sent = null; render(); }
    else if (k === "resend") { try { await C.signIn(sent, back()); U.toast("Sent again."); } catch (err) { U.toast(err.message, true); } }
    else if (k === "new") { view = "new"; render(); }
    else if (k === "list") { view = "list"; render(); }
  });
  // a sign-in link opened in this same tab only changes the hash
  window.addEventListener("hashchange", () => { const l = C.fromLink(); if (l) { sent = null; if (l.error) U.toast(l.error, true); render(); } });
  render().catch((e) => page(fail(e.message)));
})();
