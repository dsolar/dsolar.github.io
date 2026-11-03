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
  const form = { sport: S.inSeason(), teams: 10, type: "snake", clock: 90, season: "h2h", weeks: 14, trades: 1, scoring: "",
    lineup: "", bench: null, playoffs: 4, deadline: null, review: "vote", faab: null, waiverHours: 36,
    weights: null, cats: null, waivers: "faab", ir: 1, maxAdds: 0, posMax: {}, keepers: 0, keeperCost: "round", legs: "1", cons: "none", median: 0, bestball: 0, divs: 0, rookie: 3, fpicks: 1, taxi: 2, ohold: "clock", tep: 0, ptd: 4, b100r: 0, b100c: 0, b300p: 0, vamp: "off", vlike: 0, vdouble: 0,
    reviewHours: 24, vetoShare: 0.5, waiverOrder: "rolling", minBid: 0, maxAddsSeason: 0,
    open: {}, kind: "redraft", keepN: 3, tepOn: 0, tepAmt: 0.5, b100rOn: 0, b100rAmt: 3, b100cOn: 0, b100cAmt: 3, b300pOn: 0, b300pAmt: 3, vampOn: 0, vampWho: "random" };
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
      <div class="su sp-${S.inSeason()}"><div class="nl-band lg-band">${FIELD[S.inSeason()]}<div class="nl-bi"><h1 class="disp">Your leagues</h1><p>Signed in as ${esc(u.email)}</p><button class="btn go" data-a="new">Start a league</button></div></div>
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
    return `<a class="card lgc" href="play.html?id=${esc(l.id)}"><span class="lg-sp sp-${esc(l.sport)}">${icon(l.sport)}</span>
      <span class="grow"><b>${esc(l.name)}</b><small>${esc(S[l.sport].name)}${sub ? `: ${sub}` : ""}</small>${bar != null ? `<span class="lgbar" role="img" aria-label="${Math.round(bar * 100)}% of picks in"><i style="width:${(bar * 100).toFixed(1)}%"></i></span>` : ""}</span>
      ${big ? `<span class="lgstat${l.phase === "live" ? " live" : ""}"><b>${esc(big)}</b><small>${esc(small)}</small></span>` : ""}<span class="btn sm">Open</span></a>`;
  }

  function signInCard() {
    if (sent) return `<div class="card narrow"><div class="bd stack"><h1 class="disp" style="margin:0;font-size:clamp(26px,7vw,32px)">Check your email</h1>
      <p style="margin:0">We sent a sign-in link to <b style="overflow-wrap:anywhere">${esc(sent)}</b>. Open it on the phone or computer you want to play on. It works once and expires in an hour.</p>
      <p class="ps" style="margin:0">Nothing there after a minute? Check spam, or send it again.</p>
      <div class="row" style="flex-wrap:wrap"><button class="btn" data-a="again">Use a different email</button><button class="btn ghost" data-a="resend">Send it again</button></div></div></div>`;
    const k = S.inSeason();
    return `<div class="su sp-${k}"><div class="nl-band si-band">${FIELD[k]}<div class="nl-bi">
        <h1 class="disp">Draft with your friends.</h1>
        <p>Start a league, send the invite link and draft live. Every move saves for the whole league, and you can get an email when a trade offer or a waiver result needs you.</p>
        <form class="si-card" id="signin">
          <label for="si-email">Email</label>
          <div class="si-row"><input id="si-email" type="email" autocomplete="email" required value="${esc(C.lastEmail())}" placeholder="you@example.com"><button class="btn go" type="submit"${busy ? " disabled" : ""}>Email me a sign-in link</button></div>
          <p class="ps">No password. We'll email you a link that signs you in.</p></form>
      </div></div>
      <div class="mk-how" style="margin-top:14px">
        <div class="mk-tip"><b>Draft live or slow</b><p>Snake, auction, mystery packages or white elephant, with a pick clock from 30 seconds to 8 hours.</p></div>
        <div class="mk-tip"><b>A whole season</b><p>Lineups, waivers, trades and playoffs, scored from real games. Redraft, keeper or dynasty.</p></div>
        <div class="mk-tip"><b>Your formats</b><p>Guillotine, vampire, best ball, custom scoring, TE premium and more.</p></div>
      </div></div>`;
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

  /* ---------- start a league: six steps, one at a time, with a live summary beside them ---------- */
  const { ICON, icon, DRAFTS, RANGE_FMT, opt, fid, seg, cards, stepper, toggle, range, numIn, fld, group, art, pickCards, FIELD } = window.FK.setup;
  const SEASON_SUB = { h2h: "Play one team a week", h2hcats: "Every category is its own win or loss", roto: "Rank in each category over the whole season", allplay: "Your score against every team, every week", guillotine: "The lowest score is cut each week" };
  const BONUS = { tep: 0.5, b100r: 3, b100c: 3, b300p: 3 };
  const noLimit = (x) => (x ? `${x}` : "No limit");

  // the league's style: one card that sets the few choices that define it
  // two choices define a league: what carries over to next season, and how a season is played
  const KINDS = [["redraft", "Redraft", "A fresh draft every season"], ["keeper", "Keeper", "Keep a few players a year"], ["dynasty", "Dynasty", "Keep everyone, draft rookies"]];
  const FORMATS = { h2h: ["Head to head", "Play one team a week"], h2hcats: ["Head to head, each category", "Every category is its own win or loss"], roto: ["Rotisserie", "Season totals, ranked category by category"],
    allplay: ["All-play", "Your score against every team, every week"], guillotine: ["Guillotine", "The lowest score is cut every week"], vampire: ["Vampire", "One team skips the draft and steals"] };
  const formatOf = () => (vampOk() && form.vampOn ? "vampire" : form.season);
  const formatsFor = (sp) => seasonsFor(sp).map(([k]) => k).concat(sp.key === "nfl" && scoringType(sp) === "points" ? ["vampire"] : []);
  function pickFormat(k) {
    form.vampOn = 0;
    if (k === "vampire") { form.vampOn = 1; form.season = "h2h"; if (!["snake", "linear", "3rr"].includes(form.type)) form.type = "snake"; }
    else form.season = k;
    if (k === "guillotine" || k === "vampire") form.kind = "redraft";
    form.faab = null;
  }
  const { SC_SUB } = window.FK.setup;
  const DRAFT_SHORT = { snake: "Snake", auction: "Auction", linear: "Linear", "3rr": "Third-round reversal", mystery: "Mystery packages", elephant: "White elephant" };
  // a field drawn behind the header, one for each sport
  function newForm() {
    const sp = S[form.sport];
    if (!(sp.scorings[form.scoring] || isCustom())) form.scoring = Object.keys(sp.scorings)[0];
    const auction = form.type === "auction";
    const seasons = SEASONS[scoringType(sp)];
    if (!seasons.some(([k]) => k === form.season)) form.season = "h2h";
    if (form.season === "guillotine" && form.kind === "dynasty") form.kind = "redraft";
    if (!form.clocks || form.clocks !== auction) { form.clocks = auction; const ok = auction ? [15, 30, 60] : [30, 60, 90, 120, 3600, 14400, 28800]; if (!ok.includes(form.clock)) form.clock = auction ? 15 : 90; }
    const V = values(sp), fmt = formatOf(), gl = form.season === "guillotine";
    // a guillotine empties chopped rosters and a vampire's steals would pile up year after year, so both are redraft only
    const oneYear = gl ? "guillotine" : fmt === "vampire" ? "vampire" : null;
    const kinds = pickCards("kind", KINDS, form.kind, "League type", (k) => (k !== "redraft" && oneYear ? `Not with a ${oneYear}` : ""));
    const cats = scoringType(sp) === "cats";
    const label = (k) => (cats && k === "h2h" ? ["Most categories", "Head to head: win more categories, win the week"] : cats && k === "h2hcats" ? ["Each category", "Head to head: a 6-4 week counts as 6 wins"] : FORMATS[k]);
    const formats = pickCards("format", formatsFor(sp).map((k) => [k, label(k)[0], label(k)[1]]), fmt, "Format", (k) => ((k === "guillotine" || k === "vampire") && form.kind !== "redraft" ? `Redraft only: a ${form.kind} league can't use it` : ""));
    const presets = Object.entries(sp.scorings).map(([k, x]) => [k, x.label.replace(/ \(.*\)$/, ""), SC_SUB[k] || ""]).concat([["cp", "Custom points", SC_SUB.cp]], sp.key !== "nfl" ? [["cc", "Custom categories", SC_SUB.cc]] : []);
    const live = auction ? [[15, "15 sec"], [30, "30 sec"], [60, "1 min"]] : [[30, "30 sec"], [60, "1 min"], [90, "90 sec"], [120, "2 min"], [3600, "1 hr"], [14400, "4 hr"], [28800, "8 hr"]];
    const rows = ROWS(sp).map(([k, title, sub, value, body]) => {
      const open = !!form.open[k];
      return `<div class="nr${open ? " open" : ""}"><button type="button" class="nr-h" data-row="${k}" aria-expanded="${open}" aria-controls="nr-${k}"><span class="nr-t"><b>${esc(title)}</b><small>${esc(sub)}</small></span><span class="nr-v">${esc(value)}</span><span class="chev" aria-hidden="true"></span></button>${open ? `<div class="nr-b" id="nr-${k}">${body()}</div>` : ""}</div>`;
    }).join("");
    return `<div class="su sp-${sp.key}">
      <div class="nl-band">${FIELD[sp.key]}<div class="nl-bi">
        <div class="nl-sports" role="radiogroup" aria-label="Sport">${Object.values(S.ALL).map((s) => `<label class="nl-sp"><input type="radio" name="sport" value="${s.key}"${s.key === form.sport ? " checked" : ""}>${icon(s.key)}<span>${esc(s.name)}</span></label>`).join("")}</div>
        <h1 class="disp">Start a ${esc(sp.name.toLowerCase())} league</h1>
        <p>Pick a league type and a format, give it a name, and you can send the invite link in a minute. Every rule has a default, and most can change after the draft.</p>
      </div></div>
      <form class="nl-body" id="new" novalidate>
        <section class="nl-sec"><h2 class="nl-h">League type</h2>${kinds}</section>
        <section class="nl-sec"><h2 class="nl-h">Format</h2>${formats}
          ${`<div class="nl-bb">${toggle("bestball", gl ? "Best ball guillotine" : "Best ball", gl ? "Your best lineup counts each week, so nobody gets chopped for a bad lineup" : "Lineups set themselves: your best scores count each week", form.bestball)}${form.season === "h2h" && !form.vampOn && scoringType(sp) === "points" ? toggle("median", "Median game", "Also play the league median, for a second win or loss each week", form.median) : ""}</div>`}</section>
        <section class="nl-sec nl-ess">
          <div class="nl-name"><label for="n-name">League name</label><input id="n-name" type="text" maxlength="40" required value="${esc(form.name || "")}" placeholder="Name your league" autocomplete="off"></div>
          <div class="g2">${fld("Your name", `<input id="n-me" type="text" maxlength="24" required value="${esc(form.me || "")}" autocomplete="name">`, "", "n-me")}${fld("Your team's name", `<input id="n-team" type="text" maxlength="28" value="${esc(form.team || "")}" placeholder="Optional">`, "", "n-team")}</div>
          ${fld("Teams", seg("teams", [4, 6, 8, 10, 12, 14, 16, 20].map((x) => [x, String(x)]), form.teams, "Teams", { wrap: true, cls: "big" }))}
          ${fld("Scoring", cards("scoring", presets, form.scoring, "Scoring", presets.length > 4 ? 3 : presets.length))}
          <div class="nl-dr">${fld("Draft", seg("type", Object.keys(F.FORMATS).map((k) => [k, DRAFT_SHORT[k] || F.FORMATS[k]]), form.type, "Draft format", { wrap: true }), esc(DRAFTS[form.type] || ""))}
          ${fld(auction ? "Bid clock" : "Pick clock", seg("clock", live, form.clock, auction ? "Bid clock" : "Pick clock", { wrap: true }), auction ? "Every bid resets the clock." : form.clock >= 3600 ? "A slow draft: managers with email alerts get one when they're up." : "When a clock runs out, the best player left is taken.")}</div>
        </section>
        <section class="nl-sec"><h2 class="nl-h">Fine-tune</h2><p class="nl-sub">Every rule and what it's set to. Open one to change it.</p><div class="nr-l">${rows}</div></section>
        <div class="nl-bar"><div class="nl-sum">${icon(sp.key, "nl-sum-ic")}<span><b id="tk-name">${esc(form.name || "Your league")}</b><small>${esc(V.line)}</small></span></div>
          <p id="n-why" role="alert"></p><span class="grow"></span><button type="button" class="btn ghost" data-a="list">Cancel</button><button type="submit" class="btn go"${busy ? " disabled" : ""}>${busy ? "Making the league…" : "Make the league"}</button></div>
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
    const style = `${(KINDS.find(([k]) => k === form.kind) || [, "Redraft"])[1]}, ${scoringType(sp) === "cats" && formatOf() === "h2h" ? "head to head, most categories" : scoringType(sp) === "cats" && formatOf() === "h2hcats" ? "head to head, each category" : FORMATS[formatOf()] ? FORMATS[formatOf()][0].toLowerCase() : ""}${form.bestball ? (gl ? ", best ball" : ", best ball") : gl ? ", set lineups" : ""}`;
    return {
      line: `${sp.name}, ${n} teams, ${sc}, ${DRAFT_SHORT[form.type]} draft. ${style}`,
      scoring: bon.length ? bon.join(", ") : form.scoring === "cp" ? "Custom points" : "No bonuses",
      draft: `${clock} a ${auction() ? "bid" : "pick"}${!auction() && form.type !== "mystery" && form.type !== "elephant" ? (form.trades ? ", trades on" : ", no trades") : ""}`,
      roster: `${lu.length} starters, ${form.bench == null ? sp.bench : form.bench} bench${form.ir ? `, ${form.ir} IR` : ""}`,
      season: `${gl ? `${n - 1} weeks` : `${form.weeks} weeks`}${form.divs && !gl && form.season !== "roto" ? `, ${form.divs} divisions` : ""}`,
      playoffs: po ? `${po} teams, ${playoffWeeks(po)} weeks` : "None",
      waivers: gl ? `$${faab} FAAB` : form.waivers === "faab" ? `$${faab} FAAB, ${form.waiverHours}h` : `Rolling, ${form.waiverHours}h`,
      trades: `${dl ? `Deadline week ${dl}` : "No deadline"}, ${form.review === "vote" ? "league vote" : form.review === "commish" ? "commissioner" : "no review"}`,
      carry: form.kind === "dynasty" ? `Dynasty, ${form.rookie}-round rookie draft` : form.kind === "keeper" ? `Up to ${form.keepN} keepers` : "Redraft",
      vampire: form.vampOn ? (form.vampWho === "me" ? "You're the vampire" : "A random team") : "Off",
    };
  }
  const auction = () => form.type === "auction";
  const seasonsFor = (sp) => SEASONS[scoringType(sp)];
  // the fine-tune list: [key, title, what it covers, current value, body]
  function ROWS(sp) {
    const V = values(sp), gl = form.season === "guillotine", rows = [];
    if (form.kind !== "redraft") rows.push(["carry", form.kind === "dynasty" ? "Dynasty" : "Keepers", form.kind === "dynasty" ? "Rookie draft, taxi squad, future picks" : "How many and what they cost", V.carry, () => carryBody()]);
    if (vampOk() && form.vampOn) rows.push(["vampire", "Vampire", "Who it is and how it bites", V.vampire, () => vampireBody()]);
    rows.push(["scoring", "Scoring details", sp.key === "nfl" ? "Bonuses, TE premium, custom points" : form.scoring === "cp" ? "Points for each stat" : "Categories and custom scoring", V.scoring, () => scoringBody(sp)]);
    rows.push(["roster", "Roster", "Starting lineup, bench, IR, position limits", V.roster, () => rosterStep(sp)]);
    rows.push(["draft", "Draft room", "Trades during the draft", V.draft, () => draftBody()]);
    rows.push(["season", "Season", form.season === "guillotine" ? "Length" : "Length and divisions", V.season, () => seasonBody(sp)]);
    if (h2hLike()) rows.push(["playoffs", "Playoffs", "Teams, rounds, consolation", V.playoffs, () => playoffsBody()]);
    rows.push(["waivers", "Waivers", "FAAB, clear times, pickup limits", V.waivers, () => waiversBody()]);
    if (!gl) rows.push(["trades", "Trades", "Deadline and review", V.trades, () => tradesBody()]);
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
    const tradesOk = !auction() && form.type !== "mystery" && form.type !== "elephant";
    return tradesOk ? toggle("trades", "Trade picks and players", "Deals happen right in the draft room", form.trades,
      fld("A trade offer stops the clock", seg("ohold", [["clock", "For the team on the clock"], ["all", "For anyone, up to 90 seconds"], ["off", "Never"]], form.ohold, "A trade offer stops the clock", { wrap: true })))
      : `<p class="fl-h">${auction() ? "An auction" : "This draft format"} doesn't allow trades during the draft. Teams can trade once the season starts.</p>`;
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
    const bench = form.bench == null ? sp.bench : form.bench;
    const pm = (POS_MAIN[sp.key] || []).map((ps) => `<div class="pm"><span class="pm-l">${esc(ps)}</span>${stepper("pm_" + ps, [0, 1, 2, 3, 4, 5, 6, 8], form.posMax[ps] || 0, (x) => (x ? `Up to ${x}` : "Any"), `Most ${ps} on a roster`)}</div>`).join("");
    return group("Starting lineup", U.lineupBuilder(sp, lineupOf(sp)))
      + group("Reserves", `<div class="g3">${fld("Bench spots", stepper("bench", [2, 3, 4, 5, 6, 7, 8, 10, 12], bench, String, "Bench spots"))}
        ${fld("IR spots", stepper("ir", [0, 1, 2, 3, 4], form.ir, (x) => (x ? String(x) : "None"), "IR spots"), "For players listed as out.")}</div>`)
      + group("Position limits", `<div class="pml">${pm}</div>`, "The most of one position a team can roster.");
  }
  function seasonBody(sp) {
    const gl = form.season === "guillotine", n = form.teams, po = Math.min(form.playoffs, n);
    const length = gl ? `<p class="fl-h">${n - 1} weeks: one team is cut each week until one is left.</p>` : range("weeks", 8, 16, form.weeks, (x) => `${x} weeks`, h2hLike() && po ? "Weeks before the playoffs" : "Season length");
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
        ${fld("Lowest bid", seg("minBid", [[0, "$0"], [1, "$1"]], form.minBid, "Lowest bid"))}</div>` : ""}
      ${gl ? `<p class="fl-h">Waivers run midweek, 60 hours in, so a chopped roster is back in play.</p>` : `<div class="g2">${fld("Dropped players clear in", seg("waiverHours", [[24, "24h"], [36, "36h"], [48, "48h"], [72, "72h"]], form.waiverHours, "Dropped players clear in"))}
        ${fld("Waiver order", seg("waiverOrder", [["rolling", "Rolling"], ["standings", "Reverse standings"]], form.waiverOrder, "Waiver order"), form.waiverOrder === "standings" ? "Resets every week: the worst record claims first." : "A winning claim moves you to the back.")}</div>`}
      <div class="g2">${fld("Pickups a week", stepper("maxAdds", [0, 1, 2, 3, 4, 5, 7, 10], form.maxAdds, noLimit, "Pickups a week"))}${fld("Pickups a season", stepper("maxAddsSeason", [0, 10, 15, 20, 25, 30, 40, 50], form.maxAddsSeason, noLimit, "Pickups a season"))}</div>`;
  }
  function tradesBody() {
    const dl = form.deadline == null ? Math.max(1, form.weeks - 3) : form.deadline;
    return `${range("deadline", 0, Math.max(1, form.weeks - 1), Math.min(dl, form.weeks - 1), (x) => (x ? `After week ${x}` : "No deadline"), "Trade deadline")}
      ${fld("Review", cards("review", [["vote", "League vote", "Other teams can veto"], ["commish", "Commissioner", "You approve or veto"], ["none", "None", "Trades go through"]], form.review, "Trade review", 3))}
      ${form.review !== "none" ? `<div class="g2">${fld("Review lasts", seg("reviewHours", [[12, "12h"], [24, "24h"], [48, "48h"]], form.reviewHours, "Review lasts"))}
        ${form.review === "vote" ? fld("Votes to veto", seg("vetoShare", [[0.34, "A third"], [0.5, "Half"], [0.67, "Two thirds"]], form.vetoShare, "Votes to veto"), "Of the teams not in the trade.") : ""}</div>` : ""}`;
  }
  const playoffWeeks = (po) => { const R = Math.ceil(Math.log2(po)); return form.legs === "all2" ? 2 * R : form.legs === "final2" ? R + 1 : R; };
  const kc = () => { const ok = form.type === "auction" ? ["price", "price5"] : ["round", "round1", "free"]; return ok.includes(form.keeperCost) ? form.keeperCost : ok[0]; };
  const POS_MAIN = { nfl: ["QB", "RB", "WR", "TE", "K", "DEF"], nba: ["PG", "SG", "SF", "PF", "C"], mlb: ["C", "1B", "2B", "3B", "SS", "OF", "SP", "RP"] };
  const NUMERIC = /^(teams|clock|weeks|trades|bench|faab|playoffs|deadline|waiverHours|ir|maxAdds|median|bestball|divs|rookie|fpicks|taxi|ptd|vlike|vdouble|reviewHours|vetoShare|minBid|maxAddsSeason|keepN|vampOn|(tep|b100r|b100c|b300p)(On|Amt)|pm_.+)$/;
  // keep what's typed when a choice redraws the form
  function grab() {
    const root = $(".su"); if (!root) return;
    const v = (q) => { const el = $(q); return el ? el.value : null; };
    if (v("#n-name") != null) form.name = v("#n-name"); if (v("#n-me") != null) form.me = v("#n-me"); if (v("#n-team") != null) form.team = v("#n-team");
    const s = root.querySelector("input[name=sport]:checked"); if (s) form.sport = s.value;
    root.querySelectorAll("[data-f]").forEach((el) => {
      if (el.type === "radio" && !el.checked) return;
      const k = el.dataset.f, x = el.type === "checkbox" ? (el.checked ? 1 : 0) : el.value;
      if (k.startsWith("pm_")) { form.posMax[k.slice(3)] = Number(x) || 0; return; }
      form[k] = NUMERIC.test(k) ? Number(x) : x;
    });
    root.querySelectorAll("[data-w]").forEach((el) => { form.weights = form.weights || {}; form.weights[el.dataset.w] = Number(el.value) || 0; });
    derive();
  }
  // the values the league is made from, worked out from the friendlier controls
  function derive() {
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
      V.evaluate(sport, players, { teams: n, lineup, bench, scoring, dynasty: form.keepers === -1 && form.season !== "guillotine", dynastyRanks: form.keepers === -1 && form.season !== "guillotine" ? await fetch(`data/dynasty-${form.sport}.json`, { cache: "no-cache" }).then((x) => (x.ok ? x.json() : null)).catch(() => null) : null });
      const auction = form.type === "auction";
      // the vampire (the commissioner, or a random team) sits out the draft
      const vampire = vampOk() && form.vamp !== "off" ? (form.vamp === "me" ? 0 : Math.floor(Math.random() * n)) : null;
      const D = F.create({ sport, type: form.type, teams: n, sit: vampire != null ? [vampire] : undefined, seed: Math.floor(Math.random() * 2 ** 31), now: Date.now(), lineup, bench, scoring,
        botDelay: 3000, clock: auction ? 0 : form.clock, bidClock: auction ? form.clock : 15, nomClock: 30, budget: 200, name: form.name.trim(),
        trades: form.trades !== 0, curve: form.type === "mystery" ? F.pickCurve(players, total) : null, reveal: form.type === "mystery" ? "own" : undefined });
      D.teams.forEach((t, i) => (t.color = (i * 5) % 12));
      if (D.trading) D.offerHold = form.ohold || "clock";        // each team its own color, the same ones the league pages use
      const tn = (form.team || "").trim() || `${form.me.trim().split(" ")[0]}'s team`;
      D.teams[0].name = tn.slice(0, 28);
      D.teams[0].abbr = tn.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 3).toUpperCase() || "YOU";
      const gl = form.season === "guillotine";
      if (spec) D.scoringSpec = spec;
      const fmt = gl ? "guillotine" : form.season === "roto" ? "roto" : "h2h";
      D.season = { format: fmt, tally: form.season === "h2hcats" ? "cats" : form.season === "allplay" ? "allplay" : "game", weeks: form.weeks,
        faab: form.faab == null ? (gl ? 1000 : 100) : form.faab, ir: form.ir, maxAdds: form.maxAdds || 0, maxAddsSeason: form.maxAddsSeason || 0, minBid: form.minBid || 0,
        posMax: Object.fromEntries(Object.entries(form.posMax).filter(([, v]) => v)) };
      if (form.keepers > 0) Object.assign(D.season, { keepers: form.keepers, keeperCost: kc() });
      if (form.keepers === -1 && !gl) { D.season.dynasty = { rounds: form.rookie || 3, picks: form.fpicks !== 0 }; if (form.taxi) D.season.taxi = form.taxi; }
      if (form.bestball) D.season.bestBall = true;
      else if (gl) D.season.bestBall = false;
      if (form.season === "h2h" && form.median && scoringType(sport) === "points") D.season.median = true;
      if (vampire != null) D.season.vampire = { team: vampire, samePos: form.vlike === 1, double: form.vdouble === 1 };
      if (fmt !== "roto" && !gl && form.divs && n >= 2 * form.divs) D.season.divisions = form.divs;
      if (!gl) Object.assign(D.season, { waivers: form.waivers, deadline: form.deadline == null ? Math.max(1, form.weeks - 3) : form.deadline, review: form.review, waiverHours: form.waiverHours, reviewHours: form.reviewHours, vetoShare: form.vetoShare, waiverOrder: form.waiverOrder,
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
  // redraw the form and put focus back where it was
  const redraw = (focusId) => render().then(() => { const el = focusId && (document.getElementById(focusId) || (focusId.startsWith("n-pick-") && $(`.su [data-${focusId.split("-")[2]}="${focusId.split("-").slice(3).join("-")}"]`))); if (el && !el.disabled) el.focus({ preventScroll: true }); });
  app.addEventListener("click", (e) => {
    if (!e.target.closest(".su")) return;
    const row = e.target.closest("[data-row]");
    if (row) { grab(); const k = row.dataset.row; form.open = form.open[k] ? {} : { [k]: 1 }; render().then(() => { const h = $(`.su [data-row="${k}"]`); if (h) { h.focus({ preventScroll: true }); const r = h.getBoundingClientRect(); if (r.top < 70 || r.top > innerHeight - 160) h.scrollIntoView({ block: "start", behavior: "smooth" }); } }); return; }
    const kd = e.target.closest("[data-kind]");
    if (kd) { grab(); form.kind = kd.dataset.kind; derive(); form.open = form.kind === "redraft" ? {} : { carry: 1 }; redraw(`n-pick-kind-${form.kind}`); return; }
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
