/* Draft Lab's pools page (fantasy/pools/): every competition to play with friends in one place. Pick'em (its own page,
   pickem/) and its groups, season-long NFL survivor, and March Madness survivor and 5 teams: sign in, make or join a
   pool, pick, and the standings. The rules are pools-core.js (FK.pools); the games, picks and locks live on the server
   (tools/fantasykit_pools.sql, through FK.cloud.rpc). College team names, logos and ratings come from the college hub
   (/cbb/data/teams.json); NFL games and lines come from the pick'em's board.

   ?p=CODE     a pool's page        ?join=CODE   the invite link: join, then the pool */
(function () {
  "use strict";
  const C = window.FK.cloud, P = window.FK.pools, N = window.FK.nav;
  const app = document.getElementById("app");
  const params = new URLSearchParams(location.search);
  const esc = (x) => String(x == null ? "" : x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const KIND = { nfl: "Survivor", nflpo: "Playoff bracket", nflff: "Playoff fantasy", bowls: "Bowl pick'em", survivor: "Survivor", five: "5 teams", squares: "Super Bowl squares" };
  const SPORT = { nfl: "NFL", nflpo: "NFL", nflff: "NFL", squares: "NFL", bowls: "College football", survivor: "March Madness", five: "March Madness" };
  const kindName = (k) => k === "squares" ? "Super Bowl squares" : `${SPORT[k] || ""} ${(KIND[k] || "").toLowerCase()}`.trim();
  const ET = { timeZone: "America/New_York" };
  const dayName = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const tipTime = (t) => new Date(t).toLocaleString("en-US", Object.assign({ weekday: "short", hour: "numeric", minute: "2-digit" }, ET)).replace(":00 ", " ");
  const st = { user: C.user(), code: (params.get("p") || params.get("join") || "").toUpperCase(), make: params.get("make"), board: null, teams: {}, tab: "picks", sel: null, mine: null, msg: "", busy: false, open: {} };

  // ---------- theme (the masthead's Dark/Light button) ----------
  const dark = () => document.documentElement.dataset.theme === "dark";
  function themeBtn() { const b = document.querySelector("button[data-theme]"); if (b) b.textContent = dark() ? "Light" : "Dark"; }
  document.addEventListener("click", (e) => {
    if (!e.target.closest("button[data-theme]")) return;
    const on = !dark();
    if (on) document.documentElement.dataset.theme = "dark"; else delete document.documentElement.dataset.theme;
    try { localStorage.setItem("fk-lab:theme", JSON.stringify(on ? "dark" : "light")); } catch (x) { /* private mode */ }
    themeBtn();
  });

  // ---------- teams ----------
  const team = (id) => st.teams[id] || { n: id ? "TBD" : "TBD" };
  const logo = (id, px = 28) => { const t = team(id); return t.logo ? `<img class="pl-logo" src="${esc(t.logo)}" alt="" width="${px}" height="${px}" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="pl-logo pl-nologo" style="width:${px}px;height:${px}px"></span>`; };
  const NFL = { ARI: ["Arizona", "Cardinals"], ATL: ["Atlanta", "Falcons"], BAL: ["Baltimore", "Ravens"], BUF: ["Buffalo", "Bills"], CAR: ["Carolina", "Panthers"],
    CHI: ["Chicago", "Bears"], CIN: ["Cincinnati", "Bengals"], CLE: ["Cleveland", "Browns"], DAL: ["Dallas", "Cowboys"], DEN: ["Denver", "Broncos"], DET: ["Detroit", "Lions"],
    GB: ["Green Bay", "Packers"], HOU: ["Houston", "Texans"], IND: ["Indianapolis", "Colts"], JAX: ["Jacksonville", "Jaguars"], KC: ["Kansas City", "Chiefs"],
    LV: ["Las Vegas", "Raiders"], LAC: ["Los Angeles", "Chargers"], LAR: ["Los Angeles", "Rams"], MIA: ["Miami", "Dolphins"], MIN: ["Minnesota", "Vikings"],
    NE: ["New England", "Patriots"], NO: ["New Orleans", "Saints"], NYG: ["New York", "Giants"], NYJ: ["New York", "Jets"], PHI: ["Philadelphia", "Eagles"],
    PIT: ["Pittsburgh", "Steelers"], SF: ["San Francisco", "49ers"], SEA: ["Seattle", "Seahawks"], TB: ["Tampa Bay", "Buccaneers"], TEN: ["Tennessee", "Titans"], WSH: ["Washington", "Commanders"] };
  const nflName = (ab) => esc((NFL[ab] || [ab, ""])[1] || ab);
  const nflLogo = (ab, px = 28) => `<img class="pl-logo" src="https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500/${esc(String(ab).toLowerCase())}.png&w=${px * 2}&h=${px * 2}" alt="" width="${px}" height="${px}" loading="lazy" onerror="this.style.visibility='hidden'">`;
  const seedTag = (s) => (s != null ? `<span class="pl-seed">${s}</span>` : "");
  const name = (id) => esc(team(id).n || "TBD");

  // ---------- pieces ----------
  const band = (title, sub, extra = "", kick = "Draft Lab", art = BRACKET_ART) => `<section class="pl-band"><div class="pl-band-in"><p class="pl-kick">${kick}</p><h1 class="disp">${title}</h1>${sub ? `<p class="pl-sub">${sub}</p>` : ""}${extra}</div>${art}</section>`;
  const BRACKET_ART = `<svg class="pl-art" viewBox="0 0 220 160" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
    <path d="M10 14h36v20H10M10 54h36v-20M46 24h34v40H46M10 94h36v20H10M10 134h36v-20M46 104h34v-40M80 44h34v40H80M114 64h40"/>
    <path d="M210 14h-36v20h36M210 54h-36v-20M174 24h-34v40h34M210 94h-36v20h36M210 134h-36v-20M174 104h-34v-40M140 44h-26v40h26" opacity=".55"/></g></svg>`;
  const GOAL_ART = `<svg class="pl-art" viewBox="0 0 220 160" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
    <path d="M110 150V96M60 96h100M60 96V14M160 96V14"/><path d="M14 150h192M30 132h160M46 114h128" opacity=".55"/></g></svg>`;
  const artOf = (k) => (k === "nfl" || k === "bowls" || k === "squares" ? GOAL_ART : BRACKET_ART);
  const rulesHtml = (kind) => kind === "squares" ? `<ul class="pl-rules">
      <li>A <b>10 by 10 board</b>: the AFC champion across the top, the NFC champion down the side. Tap a square to claim it.</li>
      <li>The pool's owner sets how many squares each person can take, and can put names on squares for people without an account.</li>
      <li>The <b>numbers are drawn at random</b> once the owner says so, or half an hour before kickoff, and the board locks.</li>
      <li>After the <b>1st quarter, halftime, the 3rd quarter and the final</b>, the square at the last digit of each team's score wins that share. Overtime counts toward the final.</li>
      <li>The site shows the pot and shares but doesn't take or pay any money.</li></ul>`
    : kind === "nflff" ? `<ul class="pl-rules">
      <li>Set a <b>fantasy lineup every playoff round</b>: QB, 2 RB, 2 WR, TE, FLEX (RB, WR or TE), K and DEF, from the teams playing that round.</li>
      <li>Each player can play for you <b>only once</b> all postseason. Spend your stars early, or save the ones you think go deep.</li>
      <li>Each player <b>locks at his own game's kickoff</b> and shows to everyone then. Until then you can swap him out.</li>
      <li>Scoring is <b>${FF_SL[ffSiOf(st.board)]}</b>, from Sleeper's stats. Most points over the four rounds wins.</li></ul>`
    : kind === "bowls" ? `<ul class="pl-rules">
      <li>Pick the winner of <b>every bowl and College Football Playoff game</b>.</li>
      <li>Give each game a <b>confidence number</b>, from 1 up to the number of games, each number once. Your surest pick gets the biggest.</li>
      <li>A right pick scores its number. Each game's pick and number lock at its kickoff and show to everyone then.</li>
      <li>Playoff games fill in as teams advance: pick them once they're set, any time before kickoff.</li>
      <li>Most points wins. Ties go to <b>more right picks</b>, then the closest guess at the <b>title game's total points</b>.</li></ul>`
    : kind === "nflpo" ? `<ul class="pl-rules">
      <li>Fill out the <b>whole NFL playoff bracket</b>, 14 teams, before the first Wild Card kickoff.</li>
      <li>The bracket reseeds the NFL's way: in the divisional round, each conference's <b>top seed plays the lowest seed left</b>.</li>
      <li>A team scores for every round it wins that you had it winning: <b>1</b> for the Wild Card round, <b>2</b> divisional, <b>4</b> conference title, <b>8</b> Super Bowl.</li>
      <li>Until the field is set after week 18, the bracket shows the standings today. If the seeds change, check your bracket before it locks.</li>
      <li>Most points wins. Ties go to the closest guess at the <b>Super Bowl's total points</b>.</li></ul>`
    : kind === "nfl" ? `<ul class="pl-rules">
      <li>Pick <b>one NFL team a week</b> to win outright, from the pool's first week through week 18.</li>
      <li>You can use a team <b>only once</b> all season.</li>
      <li>A loss or a <b>tie</b> is out. So is no pick by the week's last kickoff.</li>
      <li>Each pick locks when its own game kicks off, and shows to everyone then.</li>
      <li>The last one standing wins. If everyone left goes out the same week, or more than one makes it through week 18, they split it.</li></ul>`
    : kind === "five" ? `<ul class="pl-rules">
      <li>Pick <b>five teams</b> whose seeds add up to <b>25 or more</b>.</li>
      <li>Every win scores by its round: <b>1, 2, 4, 8, 16, 32</b> points from the first round to the title game. First Four wins don't count.</li>
      <li>Picks lock when the first round tips off. Everyone's teams show once they lock.</li>
      <li>Most points wins. Ties go to the <b>higher combined seeds</b>, then the <b>deepest run</b> (whose best team won the most games, then the next best, and so on). Still tied, they split it.</li></ul>`
    : `<ul class="pl-rules">
      <li>Pick <b>one team a day</b>, every day from the first round to the title game. If it wins, you're through.</li>
      <li>You can use a team <b>only once</b>, and <b>no 1 or 2 seeds on day 1</b>.</li>
      <li>A pick locks when its game tips off, and shows to everyone then. No pick by the day's last tip-off is out.</li>
      <li>The last one standing wins. If everyone left loses on the same day, or more than one survives the title game, the <b>higher combined seeds of their winning picks</b> wins. Still tied, they split it.</li></ul>`;
  const fail = (e) => { st.msg = e && e.message ? e.message : String(e || "Something went wrong."); st.busy = false; render(); };
  // picks the owner makes for a member go through mm_as, which runs the member's own save as them (and logs it)
  const SAVES = new Set(["mm_pick", "mm_pick_nfl", "mm_pick_five", "mm_save_bowls", "mm_save_nflpo", "mm_save_nflff"]);
  const srpc = (fn, args) => (st.as && SAVES.has(fn) ? C.rpc("mm_as", { p_pool: st.code, p_user: st.as, p_fn: fn, p_args: args }) : C.rpc(fn, args));
  const ok = (r) => { if (r && r.error) throw new Error(r.error); return r; };

  // ---------- sign in ----------
  function signinCard(lead) {
    return `<div class="card pl-signin" id="pl-signin"><div class="bd"><h2>${esc(lead || "Sign in to play")}</h2><p class="ps">Same account as your Draft Lab leagues.</p>
      <form id="pl-link" class="pl-row"><label class="sr" for="pl-email">Email</label><input id="pl-email" type="email" required autocomplete="email" placeholder="you@example.com" value="${esc(C.lastEmail())}"><button class="btn go">Email me a sign-in link</button></form>
      <details class="pl-pw"><summary>Use a password instead</summary><form id="pl-pass" class="pl-row"><label class="sr" for="pl-login">Email or username</label><input id="pl-login" autocomplete="username" placeholder="Email or username" required><label class="sr" for="pl-password">Password</label><input id="pl-password" type="password" autocomplete="current-password" placeholder="Password" required><button class="btn">Sign in</button></form></details>
      <p class="pl-msg" role="status">${esc(st.msg)}</p></div></div>`;
  }

  // ---------- home: every game, your pools and groups, make one, join one ----------
  // in season first: NFL from September through January, March Madness the rest of the year
  const nflSeason = () => { const m = new Date().getMonth(); return m >= 8 || m === 0; };
  // each sport's color, and a small drawn icon for each game
  const SPORT_C = { NFL: "#C8102E", NBA: "#1D5FBF", "College football": "#1F7A4D", "March Madness": "#E0702A" };
  const ico = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICON = {
    pickem: ico('<path d="M4 6h10M4 12h10M4 18h7"/><path d="m15 17 2.5 2.5L22 15"/>'),
    nfl: ico('<path d="M12 3 4 6v6c0 4.4 3.4 7.8 8 9 4.6-1.2 8-4.6 8-9V6z"/><path d="M12 8v5M12 16h.01"/>'),
    nflpo: ico('<path d="M3 5h5v4H3M3 15h5v4H3M8 7h4v10H8M12 12h4"/><path d="M16 9h5v6h-5z"/>'),
    nflff: ico('<path d="M8 3h8l1 3 4 2-2 5h-2v8H7v-8H5L3 8l4-2z"/><path d="M10 11h4"/>'),
    bowls: ico('<path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 3M17 6h3a3 3 0 0 1-3 3M12 13v4M8 20h8M9 17h6"/>'),
    survivor: ico('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c-2.5 2.4-3.6 5.2-3.6 8.5s1.1 6.1 3.6 8.5M12 3.5c2.5 2.4 3.6 5.2 3.6 8.5s-1.1 6.1-3.6 8.5"/>'),
    squares: ico('<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17"/>'),
    wins: ico('<path d="M4 20h16M6 20v-5h3v5M10.5 20V10h3v10M15 20V5h3v15"/>'),
    five: ico('<circle cx="6" cy="7" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="6" cy="17" r="2"/><circle cx="18" cy="17" r="2"/>'),
  };
  /* The season's dates, Eastern. Each game is "live" from open to end, and the list puts live games first, then the
     rest by when they open. Roll these forward each summer. */
  const CAL = {
    nflWeek1: "2026-09-10", nbaTip: "2026-10-20", nbaEnd: "2027-04-11", bowlsSet: "2026-12-06", bowls: "2026-12-12", nflField: "2027-01-10", wildCard: "2027-01-16",
    cfpTitle: "2027-01-25", superBowl: "2027-02-14", selection: "2027-03-14", mmTitle: "2027-04-05",
  };
  const MILESTONES = [
    { d: CAL.bowlsSet, sport: "College football", t: "Bowl matchups set" },
    { d: CAL.bowls, sport: "College football", t: "Bowl games start" },
    { d: CAL.nflField, sport: "NFL", t: "Playoff field set" },
    { d: CAL.wildCard, sport: "NFL", t: "Wild Card weekend" },
    { d: CAL.superBowl, sport: "NFL", t: "Super Bowl" },
    { d: CAL.selection, sport: "March Madness", t: "Selection Sunday" },
  ];
  const day0 = (d) => Date.parse(d + "T05:00:00Z");
  const shortDate = (d) => new Date(day0(d) + 12 * 3600e3).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  const GAMES = [
    { sport: "NFL", key: "pickem", name: "Pick'em", tag: "Every game against the spread. One board for everyone, plus private groups.", facts: ["Every game", "Against the spread", "Groups"], live: "Live now", href: "/pickem/", cta: "Make this week's picks", open: CAL.nflWeek1, end: CAL.nflField },
    { sport: "NFL", key: "nfl", name: "Survivor", tag: "One team a week to win. Lose and you're out.", facts: ["1 team a week", "Each team once", "Through week 18"], live: "Live now", open: CAL.nflWeek1, end: CAL.nflField },
    { sport: "NFL", key: "wins", name: "Wins pool", tag: "Draft real teams in a snake. Most combined wins from draft day forward takes it.", facts: ["Draft teams", "No lineups", "No clock"], href: "/fantasy/pools/wins/?make=nfl", cta: "Start a wins pool", open: CAL.nflWeek1, end: CAL.nflField },
    { sport: "NBA", key: "wins", name: "Wins pool", tag: "Draft real teams in a snake. Most combined wins from draft day forward takes it.", facts: ["Draft teams", "No lineups", "No clock"], href: "/fantasy/pools/wins/?make=nba", cta: "Start a wins pool", open: CAL.nbaTip, end: CAL.nbaEnd },
    { sport: "NFL", key: "nflpo", name: "Playoff bracket", tag: "The 14-team bracket, reseeded the NFL's way.", facts: ["14 teams", "1-2-4-8 points", "Locks at the Wild Card"], soon: "Practice now", open: CAL.nflField, end: CAL.superBowl },
    { sport: "NFL", key: "nflff", name: "Playoff fantasy", tag: "A fantasy lineup every playoff round, and each player only once.", facts: ["9-man lineups", "Each player once", "Half PPR"], soon: "Opens in January", open: CAL.nflField, end: CAL.superBowl },
    { sport: "NFL", key: "squares", name: "Super Bowl squares", tag: "Claim squares on a 10 by 10 board. Each quarter's score picks a winner.", facts: ["100 squares", "4 winners", "Add friends by name"], soon: "Fill it now", open: CAL.nflWeek1, end: CAL.superBowl },
    { sport: "College football", key: "bowls", name: "Bowl pick'em", tag: "Every bowl and playoff game, each with a confidence number.", facts: ["Every bowl", "Confidence points", "Title game tiebreak"], soon: "Matchups Dec 6", open: CAL.bowlsSet, end: CAL.cfpTitle },
    { sport: "March Madness", key: "survivor", name: "Survivor", tag: "One team a day. Lose and you're out.", facts: ["1 team a day", "Each team once", "No 1-2 seeds day 1"], soon: "Practice now", open: CAL.selection, end: CAL.mmTitle },
    { sport: "March Madness", key: "five", name: "5 teams", tag: "Five teams whose seeds add up to 25. Wins pay double each round.", facts: ["5 teams", "Seeds reach 25", "Wins double"], soon: "Practice now", open: CAL.selection, end: CAL.mmTitle },
  ];
  const sportC = (k) => SPORT_C[SPORT[k]] || SPORT_C.NFL;
  function gameCard(gm) {
    const act = gm.href ? `<a class="btn go" href="${gm.href}">${esc(gm.cta)}</a>` : `<button type="button" class="btn go" data-make="${gm.key}">Make a pool</button>`;
    return `<article class="pl-gc" style="--sc:${SPORT_C[gm.sport]}"><div class="pl-gc-top"><span class="pl-gc-ic">${ICON[gm.key]}</span><span class="pl-gc-sp">${esc(gm.sport)}</span><span class="pl-gc-st${gm.isLive ? " live" : ""}">${esc(gm.isLive ? "Live now" : gm.soon || `Opens ${shortDate(gm.open)}`)}</span></div>
      <h3>${esc(gm.name)}</h3><p class="pl-tag">${esc(gm.tag)}</p><ul class="pl-gc-facts">${gm.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      <div class="pl-act">${act}${gm.href ? "" : `<details class="pl-how"><summary>How it works</summary>${rulesHtml(gm.key)}</details>`}</div></article>`;
  }
  // where you stand in each of your pools: every board, scored the same way its own page does. Kept a minute, since
  // opening a form re-renders the page.
  async function statuses(mine) {
    const now = Date.now();
    if (st.stat && now - st.stat.at < 60000 && st.stat.ids === mine.map((p) => p.id).join()) return st.stat.by;
    const by = {};
    await Promise.all(mine.map(async (p) => {
      try {
        const b = await C.rpc("mm_board", { p_pool: p.id });
        if (!b || !b.ok) return;
        let stats = null;
        if (b.pool.kind === "nflff") {
          stats = {};
          await Promise.all([1, 2, 3, 4].map(async (r) => { const k = ffLock(b, r); if (k && now >= k) { const x = await C.nflPost(b.pool.season, r); if (x && x.players) stats[r] = x; } }));
        }
        by[p.id] = P.status(b, now, stats);
      } catch (e) { /* the row just goes without a status */ }
    }));
    st.stat = { at: now, ids: mine.map((p) => p.id).join(), by };
    return by;
  }
  // a deadline: the day and time this week, the date after that
  const dueText = (t) => t - Date.now() < 6 * 864e5 ? tipTime(t) : new Date(t).toLocaleDateString("en-US", Object.assign({ month: "short", day: "numeric" }, ET));
  const TONE_ORDER = { todo: 0, ok: 1, wait: 2, won: 3, out: 4, done: 5 };
  async function home() {
    let mine = [], groups = [], wins = [], stat = {};
    if (st.user) {
      // wins pools (their own page, fantasy/pools/wins/) are listed here with the rest
      [mine, groups, wins] = await Promise.all([C.rpc("mm_pools_mine").catch((e) => { st.msg = e.message; return []; }), C.rpc("pk_groups_mine").catch(() => []), C.rpc("wn_mine").catch(() => [])]);
      if (!Array.isArray(wins)) wins = [];
      stat = await statuses(mine || []);
      if ((groups || []).length) {
        try {
          const pb = await C.rpc("pk_board", {});
          const gs = (pb && pb.games) || [], open = gs.filter((g) => !g.locked && g.spread != null), todo = open.filter((g) => !g.pick);
          const picked = gs.filter((g) => g.pick).length, rec = pb.me && pb.me.w + pb.me.l + pb.me.p ? `${pb.me.w}-${pb.me.l}${pb.me.p ? "-" + pb.me.p : ""} this season` : "";
          const wkn = pb.week ? `Week ${pb.week}` : "This week";
          st.pkStat = !gs.length ? null : todo.length ? { text: `${wkn}: ${picked} of ${gs.length} picked${rec ? ". " + rec : ""}`, tone: "todo", due: Math.min(...todo.map((g) => Date.parse(g.kickoff))) }
            : gs.some((g) => g.spread != null) ? { text: `${wkn}: ${picked} of ${gs.length} picked${rec ? ". " + rec : ""}`, tone: "ok" }
            : { text: `${wkn}: lines lock ${pb.freezeAt ? tipTime(pb.freezeAt) : "soon"}${rec ? ". " + rec : ""}`, tone: "wait" };
        } catch (e) { st.pkStat = null; }
      }
    }
    const now = Date.now();
    GAMES.forEach((g) => { g.isLive = now >= day0(g.open) && now < day0(g.end) + 864e5; });
    const live = GAMES.filter((g) => g.isLive), later = GAMES.filter((g) => !g.isLive && day0(g.open) > now).sort((a, c) => day0(a.open) - day0(c.open));
    const soon = later.filter((g) => day0(g.open) - now < 75 * 864e5), far = later.filter((g) => day0(g.open) - now >= 75 * 864e5);
    const miles = MILESTONES.filter((m) => day0(m.d) + 864e5 > now).slice(0, 5);
    const timeline = miles.length ? `<ol class="pl-tl" aria-label="Coming up">${miles.map((m) => `<li style="--sc:${SPORT_C[m.sport]}"><time datetime="${m.d}">${shortDate(m.d)}</time><span>${esc(m.t)}</span></li>`).join("")}</ol>` : "";
    const group = (title, gs) => gs.length ? `<div class="pl-sec"><h3 class="pl-grp">${title}</h3><div class="pl-games">${gs.map(gameCard).join("")}</div></div>` : "";
    const catalog = `<section class="pl-cat"><h2 class="pl-sec-h">Games</h2>${timeline}${group("Playing now", live)}${group("Coming up", soon)}
      ${far.length ? `<details class="pl-later"><summary>Later: ${esc([...new Set(far.map((g) => g.sport))].join(", "))} <small>(${far.length} ${far.length === 1 ? "game" : "games"})</small></summary><div class="pl-games">${far.map(gameCard).join("")}</div></details>` : ""}</section>`;
    const pill = (x) => !x ? "" : x.tone === "todo" ? `<span class="pl-due">${x.due ? `Due ${esc(dueText(x.due))}` : "To do"}</span>` : x.tone === "won" ? `<span class="pl-due won">Won</span>` : x.tone === "out" ? `<span class="pl-due out">Out</span>` : "";
    const row = (href, key, sc, name, sub, x) => `<li class="${x ? "t-" + x.tone : ""}"><a href="${href}"><span class="pl-badge" style="--sc:${sc}">${ICON[key]}</span><span class="pl-li-t"><b>${esc(name)}</b><small>${sub}</small></span>${pill(x)}<span class="pl-chev" aria-hidden="true">&rsaquo;</span></a></li>`;
    const sorted = (mine || []).slice().sort((a, c) => { const x = stat[a.id] || { tone: "ok" }, y = stat[c.id] || { tone: "ok" }; return (TONE_ORDER[x.tone] - TONE_ORDER[y.tone]) || ((x.due || 0) - (y.due || 0)); });
    const items = sorted.map((p) => { const x = stat[p.id]; return row(`/fantasy/pools/?p=${esc(p.id)}`, p.kind, sportC(p.kind), p.name, `${esc(kindName(p.kind))} &middot; ${x && x.text ? esc(x.text) : `${p.members} ${p.members === 1 ? "entry" : "entries"}`}`, x); })
      .concat((groups || []).map((g) => row("/pickem/", "pickem", SPORT_C.NFL, g.name, `NFL pick'em group &middot; ${st.pkStat ? esc(st.pkStat.text) : `${g.members} ${g.members === 1 ? "member" : "members"}`}`, st.pkStat)));
    const winStat = wins.map((p) => (window.FK.wins ? window.FK.wins.status(p) : null));
    wins.forEach((p, i) => items.push(row(`/fantasy/pools/wins/?p=${esc(p.id)}`, "wins", SPORT_C[p.sport === "nba" ? "NBA" : "NFL"], p.name, `${p.sport === "nba" ? "NBA" : "NFL"} wins pool &middot; ${winStat[i] ? esc(winStat[i].text) : `${p.members} ${p.members === 1 ? "entry" : "entries"}`}`, winStat[i])));
    const todo = Object.values(stat).concat(st.pkStat && (groups || []).length ? [st.pkStat] : [], winStat.filter(Boolean)).filter((x) => x.tone === "todo").sort((a, c) => (a.due || Infinity) - (c.due || Infinity));
    const summary = !items.length ? "" : todo.length ? `<p class="pl-todo"><b>${todo.length === 1 ? "1 pool needs" : `${todo.length} pools need`} your picks.</b>${todo[0].due ? ` ${todo.length === 1 ? "Due" : "The first is due"} ${esc(dueText(todo[0].due))}.` : ""}</p>` : mine.length ? `<p class="pl-todo ok">You're all set. Nothing due right now.</p>` : "";
    // the make-a-pool choices in the same order as the games below: playing now, then soonest
    const kinds = live.concat(soon, far).map((g) => g.key).filter((k) => k !== "pickem" && k !== "wins");
    const pick = st.make && kinds.includes(st.make) ? st.make : kinds[0];
    const panel = st.panel || (st.make ? "make" : st.code ? "join" : null);
    const makeForm = `<form class="pl-panel" id="pl-new"><div class="pl-form">
        <fieldset class="pl-kinds"><legend>Game</legend>${kinds.map((k) => `<label style="--sc:${sportC(k)}"><input type="radio" name="kind" value="${k}"${k === pick ? " checked" : ""}><span><i class="pl-kic">${ICON[k]}</i><b>${esc(KIND[k])}</b><small>${esc(SPORT[k])}</small></span></label>`).join("")}</fieldset>
        <label>Pool name<input name="name" maxlength="40" required placeholder="The office pool"></label>
        <label>Your entry's name <small class="ps">optional</small><input name="entry" maxlength="28" placeholder="${esc((st.user && st.user.email || "").split("@")[0])}"></label>
        <button class="btn go">Make the pool</button></div></form>`;
    const joinForm = `<form class="pl-panel" id="pl-join"><div class="pl-form">
        <label>Code <small class="ps">from a pool or a pick'em group</small><input name="code" maxlength="6" required placeholder="ABC123" autocapitalize="characters" style="text-transform:uppercase;letter-spacing:.12em" value="${esc(st.code)}"></label>
        <label>Your entry's name <small class="ps">optional</small><input name="entry" maxlength="28"></label>
        <button class="btn go">Join</button></div></form>`;
    const yours = st.user ? `<section class="card pl-yours"><div class="pl-yours-h"><h2>Your pools</h2><div class="pl-yours-act">
        <button type="button" class="btn sm${panel === "make" ? " on" : ""}" data-panel="make" aria-expanded="${panel === "make"}">+ Make a pool</button><button type="button" class="btn sm${panel === "join" ? " on" : ""}" data-panel="join" aria-expanded="${panel === "join"}">Join with a code</button></div></div>
      ${panel === "make" ? makeForm : panel === "join" ? joinForm : ""}<p class="pl-msg" role="status">${esc(st.msg)}</p>
      ${summary}${items.length ? `<ul class="pl-list">${items.join("")}</ul>` : `<div class="pl-empty"><b>No pools yet.</b> Make one and send the code, or join a friend's.</div>`}</section>` : "";
    const signin = st.user ? "" : signinCard("Sign in to make or join a pool");
    app.innerHTML = `<div class="wrap page pl">${band("Pools", "Pick'em, survivor and bracket games to play with friends. Make a pool, send the code, and the site keeps score.", st.user ? "" : `<div class="pl-share"><a class="btn sm" href="#pl-signin">Sign in to play</a></div>`)}
      ${yours}${catalog}${signin}</div>`;
  }

  // ---------- a pool ----------
  async function load() {
    try { st.board = await (st.as ? C.rpc("mm_board_as", { p_pool: st.code, p_user: st.as }) : C.rpc("mm_board", { p_pool: st.code })); } catch (e) { st.board = { error: e.message }; }
    if (st.as && st.board && st.board.error) { st.msg = st.board.error; st.as = null; st.board = await C.rpc("mm_board", { p_pool: st.code }).catch((e) => ({ error: e.message })); }
    if (st.board && st.board.ok && st.remind == null) { try { const g = await C.rpc("mm_remind_get", { p_pool: st.code }); st.remind = !!g.remind; st.recap = !!g.recap; } catch (e) { st.remind = false; st.recap = false; } }
    if (st.board && st.board.pool && st.board.pool.kind === "nflff") await ffLoad(st.board);
    if (st.board && st.board.pool && st.board.pool.kind === "bowls" && !st.cfb) {
      try { st.cfb = await fetch("/cfb/data/extras.json", { cache: "no-cache" }).then((r) => r.json()); } catch (e) { st.cfb = {}; }
    }
  }
  // phones get the share sheet (Messages, WhatsApp...); desktops copy the link
  const canShare = () => !!navigator.share && matchMedia("(pointer:coarse)").matches;
  // everything for getting people in: the link, the phone's share sheet, a text, an email, and a QR code to scan
  // across the room (fantasy-kit/vendor/qrcode.min.js, loaded the first time the panel opens)
  let qrLoad = null;
  const loadQr = () => qrLoad || (qrLoad = new Promise((res) => { const s = document.createElement("script"); s.src = "/fantasy-kit/vendor/qrcode.min.js"; s.onload = () => res(window.qrcode); s.onerror = () => res(null); document.head.appendChild(s); }));
  function invitePanel(b) {
    const p = b.pool, url = `${location.origin}/fantasy/pools/?join=${p.id}`;
    const text = `Join my ${kindName(p.kind)} pool, ${p.name}, on Draft Lab: ${url}`;
    let qr = "";
    if (window.qrcode) { try { const q = window.qrcode(0, "M"); q.addData(url); q.make(); qr = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); } catch (e) { qr = ""; } }
    else loadQr().then((ok) => { if (ok && st.invite) render(); });
    return `<section class="card pl-inv" aria-label="Invite people"><div class="mod-h"><h2>Invite people</h2><span class="grow"></span><button type="button" class="btn sm ghost" data-invite>Done</button></div>
      <div class="bd pl-inv-b"><div class="pl-inv-qr">${qr || `<span class="ps">Loading the code</span>`}<small>Scan with a phone camera to join</small></div>
      <div class="pl-inv-o">
        <label class="pl-inv-l">Invite link<span><input readonly value="${esc(url)}" onfocus="this.select()"><button type="button" class="btn sm" data-copy="${esc(url)}" data-nosheet>Copy</button></span></label>
        <div class="pl-inv-btns">${navigator.share ? `<button type="button" class="btn sm go" data-copy="${esc(url)}" data-share-title="${esc(`Join ${p.name}`)}" data-share-text="${esc(`Join my ${kindName(p.kind)} pool, ${p.name}, on Draft Lab.`)}" data-sheet>Share</button>` : ""}
          <a class="btn sm" href="sms:?&body=${encodeURIComponent(text)}">Text it</a>
          <a class="btn sm" href="mailto:?subject=${encodeURIComponent(`Join ${p.name}`)}&body=${encodeURIComponent(`${text}\n\nYou'll sign in with your email, then you're in.`)}">Email it</a></div>
        <p class="ps">Or tell them the code <b class="pl-code">${esc(p.id)}</b>: Pools, then Join with a code. Anyone with the link can join, and they sign in with just an email.</p>
      </div></div></section>`;
  }
  function poolHead(b) {
    const p = b.pool, url = `${location.origin}/fantasy/pools/?join=${p.id}`;
    const when = p.kind === "nfl" ? `${p.season} season from week ${p.startWeek}` : p.kind === "bowls" ? `${p.season}-${String((p.season + 1) % 100).padStart(2, "0")} bowl season` : p.kind === "nflpo" || p.kind === "nflff" ? `${p.season} season playoffs` : p.kind === "squares" ? `Super Bowl, ${shortDate(CAL.superBowl)}` : `${p.season} tournament`;
    return band(esc(p.name), `${KIND[p.kind]} &middot; ${when} &middot; ${b.members.length} ${b.members.length === 1 ? "entry" : "entries"}`,
      `<div class="pl-share"><span class="pl-code" title="Pool code">${esc(p.id)}</span><button class="btn sm go" data-invite aria-expanded="${!!st.invite}">Invite people</button><a class="btn sm ghost" href="/fantasy/pools/">All pools</a></div>`, SPORT[p.kind], artOf(p.kind));
  }
  function projectedNote(b) {
    if (!b.projected) return "";
    return `<div class="pl-note"><b>Practice bracket.</b> These are the college hub's projected first-round games on this season's real dates. The real field comes out Selection Sunday, March 14, and replaces them; practice picks are cleared then.</div>`;
  }
  // the pot (from the buy-in and the members), each payout, who's paid, and past champions, under the standings
  function potAndChamps(b) {
    const ex = b.pool.extra || {}, n = b.members.length, paid = b.members.filter((m) => m.paid).length;
    const pays = (ex.payouts || [100]).filter((v) => v > 0);
    const pot = ex.buyin && b.pool.kind !== "squares" ? `<section class="card pl-pot"><div class="mod-h"><h2>The pot</h2><span class="grow"></span><span class="ps">${paid} of ${n} paid</span></div><div class="bd">
      <p class="pl-potn"><b class="num">${money(ex.buyin * n)}</b> <span class="ps">${money(ex.buyin)} buy-in, ${n} ${n === 1 ? "entry" : "entries"}</span></p>
      <ul class="pl-pays">${pays.map((v, i) => `<li><span>${P.ord(i + 1)}</span><b class="num">${money(Math.round(ex.buyin * n * v) / 100)}</b><small class="ps">${v}%</small></li>`).join("")}</ul>
      <p class="ps" style="margin:8px 0 0">Tracked here only. The site doesn't collect or pay money.</p></div></section>` : "";
    const ch = (ex.champs || []).length ? `<section class="card pl-champs"><div class="mod-h"><h2>Past champions</h2></div><ul>${ex.champs.map((c) => `<li><span class="ps num">${esc(c.year)}</span><b>${esc(c.name)}</b></li>`).join("")}</ul></section>` : "";
    return pot + ch;
  }
  // ---------- settings: how it works, you, the members, and the owner's controls ----------
  function settingsTab(b) {
    const p = b.pool, owner = p.owner, uid = meId(b), ex = p.extra || {};
    const mine = b.members.find((m) => m.me) || {};
    const how = `<details class="card pl-set" open><summary class="mod-h"><h2>How it works</h2></summary><div class="bd">${rulesHtml(p.kind)}</div></details>`;
    const you = `<section class="card pl-set"><div class="mod-h"><h2>You</h2></div><div class="bd pl-setb">
      <form id="pl-entry" class="pl-row"><label>Your name in this pool<input name="entry" maxlength="28" value="${esc(mine.name || "")}"></label><button class="btn sm">Save</button></form>
      ${remindable(b) ? `<label class="pl-remind"><input type="checkbox" data-remind${st.remind ? " checked" : ""}><span><b>Email me before a pick is due</b> <span class="ps">About 3 hours ahead, only if I haven't made it</span></span></label>` : ""}
      ${p.kind !== "squares" ? `<label class="pl-remind"><input type="checkbox" data-recap${st.recap ? " checked" : ""}><span><b>Email me a weekly recap</b> <span class="ps">Tuesday mornings: who went out, the standings and what's due</span></span></label>` : ""}
      <div class="pl-row"><button type="button" class="btn sm go" data-invite>Invite people</button>${owner ? "" : `<button type="button" class="btn sm ghost${st.leave ? " danger" : ""}" data-leave>${st.leave ? "Tap again to leave. Your picks go too" : "Leave this pool"}</button>`}</div></div></section>`;
    const members = `<section class="card pl-set"><div class="mod-h"><h2>Members</h2><span class="grow"></span><span class="ps">${b.members.length}</span></div>
      <ul class="pl-mem">${b.members.map((m) => `<li><b>${esc(m.name)}</b>${m.me ? ` <span class="ps">you</span>` : ""}${m.owner ? ` <span class="tag">Owner</span>` : ""}
        ${ex.buyin ? (owner ? `<label class="pl-paid"><input type="checkbox" data-paid="${esc(m.id)}"${m.paid ? " checked" : ""}> Paid</label>` : `<span class="tag${m.paid ? " win" : ""}">${m.paid ? "Paid" : "Owes"}</span>`) : ""}
        ${owner && !m.me && p.kind !== "squares" ? `<button type="button" class="btn sm" data-as="${esc(m.id)}" title="Make or fix ${esc(m.name)}'s picks">Picks</button>` : ""}
        ${owner && !m.me ? `<button type="button" class="btn sm ghost${st.rm === m.id ? " danger" : ""}" data-rm="${esc(m.id)}">${st.rm === m.id ? "Tap again to remove" : "Remove"}</button>` : ""}</li>`).join("")}</ul></section>`;
    const log = (b.log || []).length ? `<section class="card pl-set"><div class="mod-h"><h2>Owner activity</h2><span class="grow"></span><span class="ps">Everyone sees this</span></div>
      <ul class="pl-mem">${b.log.map((l) => `<li><span><b>${esc(l.who)}</b> ${esc(l.what)} <b>${esc(l.whom)}</b></span><span class="ps" style="margin-left:auto">${esc(tipTime(l.at))}</span></li>`).join("")}</ul></section>` : "";
    if (!owner) return how + you + members + log;
    const ffLocked = p.kind === "nflff" && (b.games || []).some((g) => g.round === 1 && Date.parse(g.kickoff) <= Date.now());
    const game = p.kind === "nflff" ? `<label>Scoring<select name="scoring"${ffLocked ? " disabled" : ""}>${[["half", "Half PPR"], ["ppr", "PPR"], ["std", "Standard"]].map(([v, l]) => `<option value="${v}"${(ex.scoring || "half") === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>${ffLocked ? `<p class="ps">Set for the season: the playoffs have started.</p>` : ""}` : "";
    const sq = p.kind === "squares" && !(ex.nums) ? sqSettings(P.squares(b)) : p.kind === "squares" ? `<p class="ps">The numbers are drawn, so the squares settings are locked.</p>` : "";
    const commish = `<section class="card pl-set pl-own"><div class="mod-h"><h2>Owner</h2><span class="grow"></span><span class="ps">Only you see this</span></div><div class="bd pl-setb">
      <form id="pl-pool" class="pl-setf"><label>Pool name<input name="name" maxlength="40" required value="${esc(p.name)}"></label>${game}<button class="btn sm">Save</button></form>
      ${sq}
      <form id="pl-notef" class="pl-setf"><label>Message to the pool <small class="ps">pinned at the top for everyone</small><textarea name="note" maxlength="500" rows="3" placeholder="Buy-in is due by kickoff. Venmo me.">${esc(ex.note || "")}</textarea></label><button class="btn sm">${ex.note ? "Update message" : "Pin message"}</button></form>
      ${p.kind === "squares" ? "" : `<form id="pl-money" class="pl-setf"><h3>Buy-in and payouts</h3><label>Buy-in per entry <small class="ps">optional, tracked only</small><input name="buyin" type="number" min="0" step="1" value="${ex.buyin || ""}" placeholder="$"></label>
        <fieldset class="pl-payf"><legend>Payout shares (%)</legend>${[0, 1, 2].map((i) => `<label>${P.ord(i + 1)}<input name="pay${i}" type="number" min="0" max="100" value="${(ex.payouts || [70, 30, 0])[i] || 0}"></label>`).join("")}</fieldset>
        <button class="btn sm">Save buy-in</button></form>`}
      <label class="pl-remind"><input type="checkbox" data-closed${ex.closed ? " checked" : ""}><span><b>Close to new entries</b> <span class="ps">People already in stay in. The invite link stops working for anyone new.</span></span></label>
      <div class="pl-champf"><h3>Past champions</h3>${(ex.champs || []).length ? `<ul class="pl-mem">${ex.champs.map((c, i) => `<li><span class="ps num">${esc(c.year)}</span><b>${esc(c.name)}</b><button type="button" class="btn sm ghost" data-champrm="${i}">Remove</button></li>`).join("")}</ul>` : ""}
        <form id="pl-champ" class="pl-row"><label style="flex:0 0 90px;min-width:0">Year<input name="year" maxlength="9" placeholder="${new Date().getFullYear() - 1}"></label><label>Champion<input name="name" maxlength="40" placeholder="Name"></label><button class="btn sm">Add</button></form></div>
      ${b.members.length > 1 ? `<div class="pl-row"><label>Hand the pool to<select data-xfer><option value="">Pick a member</option>${b.members.filter((m) => !m.me).map((m) => `<option value="${esc(m.id)}"${st.xfer === m.id ? " selected" : ""}>${esc(m.name)}</option>`).join("")}</select></label><button type="button" class="btn sm${st.xferArm ? " danger" : ""}" data-xferb${st.xfer ? "" : " disabled"}>${st.xferArm ? "Tap again: they become the owner" : "Hand it over"}</button></div>` : ""}
      <form id="pl-del" class="pl-row pl-del"><label>Delete this pool <small class="ps">Type its code, ${esc(p.id)}, to confirm. Every pick goes with it.</small><input name="code" maxlength="6" autocomplete="off" placeholder="Pool code"></label><button class="btn sm danger">Delete</button></form>
      </div></section>`;
    return how + you + members + commish + log;
  }
  // a reminder only helps while there's a pick still ahead of you: not once you're out, the pool is over, or a
  // lock-once game (5 teams, the NFL bracket) has locked
  function remindable(b) {
    let x; try { x = P.status(b, Date.now(), st.ffs); } catch (e) { return true; }
    if (x.tone === "out" || x.tone === "won" || x.tone === "done") return false;
    if (b.pool.kind === "five") { const F = P.five(b, Date.now()); return !F.locked; }
    if (b.pool.kind === "nflpo") return !b.lock || Date.now() < Date.parse(b.lock);
    if (b.pool.kind === "squares") return !P.squares(b).locked;
    return true;
  }
  async function pool() {
    await load();
    const b = st.board;
    if (b && b.error === "join") {
      app.innerHTML = `<div class="wrap page pl">${band(esc(b.pool.name), `${KIND[b.pool.kind]}${b.pool.kind === "nfl" ? ` from week ${b.pool.startWeek}` : ""} &middot; ${b.pool.members} ${b.pool.members === 1 ? "entry" : "entries"}`, "", SPORT[b.pool.kind], artOf(b.pool.kind))}
        ${st.user ? `<form class="card" id="pl-join"><div class="mod-h"><h2>Join this pool</h2></div><div class="bd pl-form"><input type="hidden" name="code" value="${esc(b.pool.id)}"><label>Your entry's name <small class="ps">(optional)</small><input name="entry" maxlength="28"></label><button class="btn go">Join ${esc(b.pool.name)}</button><p class="pl-msg" role="status">${esc(st.msg)}</p></div></form>` : signinCard(`Sign in to join ${b.pool.name}`)}
        <div class="card"><div class="bd">${rulesHtml(b.pool.kind)}</div></div></div>`;
      return;
    }
    if (!b || b.error) { app.innerHTML = `<div class="wrap page pl">${band("Pools", "")}<div class="card"><div class="bd"><p style="margin:0"><b>${esc((b && b.error) || "Couldn't load this pool.")}</b></p><p class="ps"><a href="/fantasy/pools/">Back to your pools</a></p></div></div></div>`; return; }
    const tabs = b.pool.kind === "squares" ? [["picks", "Board"], ["standings", "Winners"], ["settings", "Settings"]]
      : [["picks", "Picks"], ["games", b.pool.kind === "nflff" ? "Lineups" : "Scores"], ["standings", "Standings"], ["settings", "Settings"]];
    if (st.tab === "rules") st.tab = "settings";
    if (st.as) { const i = tabs.findIndex((t) => t[0] === "settings"); if (i >= 0) tabs.splice(i, 1); if (st.tab === "settings") st.tab = "picks"; }
    const body = st.tab === "settings" ? settingsTab(b)
      : st.tab === "games" && b.pool.kind !== "squares" ? scoreboard(b)
      : b.pool.kind === "nfl" ? (st.tab === "picks" ? nflPicks(b) : nflTable(b))
      : b.pool.kind === "bowls" ? (st.tab === "picks" ? bowlPicks(b) : bowlTable(b))
      : b.pool.kind === "nflpo" ? (st.tab === "picks" ? brPicks(b) : brTable(b))
      : b.pool.kind === "nflff" ? (st.tab === "picks" ? ffPicks(b) : ffTable(b))
      : b.pool.kind === "squares" ? (st.tab === "picks" ? sqPicks(b) : sqTable(b))
      : b.pool.kind === "five" ? (st.tab === "picks" ? fivePicks(b) : fiveTable(b)) : (st.tab === "picks" ? survPicks(b) : survTable(b));
    const ex0 = b.pool.extra || {}, boss = b.members.find((m) => m.owner);
    const pin = ex0.note ? `<div class="pl-note pl-pin"><b>From ${esc(boss ? boss.name : "the commish")}</b><span>${esc(ex0.note).replace(/\n/g, "<br>")}</span></div>` : "";
    const asBar = st.as && b.as ? `<div class="pl-asbar" role="status"><span><b>You're making picks for ${esc(b.as.name)}.</b> Every lock still applies, and each pick is logged where the whole pool can see it.</span><button type="button" class="btn sm" data-asdone>Done</button></div>` : "";
    app.innerHTML = `<div class="wrap page pl">${poolHead(b)}${asBar}${st.invite ? invitePanel(b) : ""}${pin}${projectedNote(b)}
      <div class="seg pl-tabs" role="tablist">${tabs.map(([k, n]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${st.tab === k}">${n}</button>`).join("")}</div>
      <p class="pl-msg" role="status">${esc(st.msg)}</p>${body}${st.tab === "standings" ? potAndChamps(b) : ""}</div>`;
  }

  // ---------- survivor ----------
  const me = (b) => (b.members.find((m) => m.me) || {}).id;
  function survPicks(b) {
    const S = P.survivor(b, Date.now()), uid = me(b), row = S.rows.find((r) => r.id === uid), now = Date.now();
    if (!S.days.length) return `<div class="card"><div class="bd ps">The bracket isn't set yet.</div></div>`;
    const status = S.winners ? (S.winners.includes(uid) ? `<div class="pl-note win"><b>${S.winners.length > 1 ? `You split the pool with ${S.winners.length - 1} other${S.winners.length > 2 ? "s" : ""}.` : "You won the pool."}</b></div>` : `<div class="pl-note"><b>The pool is over.</b> ${S.winners.map((w) => esc((b.members.find((m) => m.id === w) || {}).name)).join(" and ")} ${S.winners.length > 1 ? "split it" : "won it"}.</div>`)
      : row && !row.alive ? `<div class="pl-note loss"><b>You're out</b> on day ${row.out}. You can still follow along on Standings.</div>` : "";
    const cards = S.days.map((d) => {
      const cell = row ? row.cells[d.n] : null, locked = now >= d.lock, mineT = cell && cell.team;
      const head = `<div class="pl-day-h"><b>Day ${d.n}</b><span>${dayName(d.day)} &middot; ${P.ROUNDS[d.round]}</span><span class="grow"></span>${mineT ? `<span class="pl-pick ${cell.win ? "win" : cell.loss ? "loss" : ""}">${logo(mineT, 18)}${name(mineT)}${cell.win ? " &middot; won" : cell.loss ? " &middot; lost" : cell.live ? " &middot; playing" : ""}</span>` : cell && cell.miss ? `<span class="pl-pick loss">No pick</span>` : locked ? "" : `<span class="pl-pick none" title="Each pick locks when its own game tips off">Last tip-off ${tipTime(d.lock)}</span>`}</div>`;
      const playable = row && row.alive && !S.winners && !locked;
      const showOpen = st.open[d.n] != null ? st.open[d.n] : playable && (!mineT || !cell.win) && S.days.filter((x) => now < x.lock)[0] === d;
      if (!playable) return `<div class="card pl-day done">${head}</div>`;
      const ch = P.choices(b, d.n, uid, now).map((c) => Object.assign(c, { p: P.winProb(team(c.team), team(c.opp)) }))
        .sort((x, y) => (!!x.why - !!y.why) || ((y.p || 0) - (x.p || 0)));
      return `<div class="card pl-day${showOpen ? " open" : ""}">${head.replace('<div class="pl-day-h">', `<button type="button" class="pl-day-h" data-day="${d.n}" aria-expanded="${!!showOpen}">`).replace(/<\/div>$/, "</button>")}
        ${showOpen ? `<div class="pl-choices">${ch.map((c) => `<button type="button" class="pl-team${c.picked ? " on" : ""}" data-pick="${d.n}|${esc(c.team)}"${c.why && !c.picked ? ` disabled title="${esc(c.why)}"` : ""}>
          ${logo(c.team, 30)}<span class="pl-tn"><b>${seedTag(c.seed)}${name(c.team)}</b><small>vs ${seedTag(c.oppSeed)}${name(c.opp)}<span class="pl-sep"> &middot; </span><span class="pl-tw">${tipTime(c.tip)}</span></small>${c.why && !c.picked ? `<small class="pl-why">${esc(c.why)}</small>` : ""}</span>
          ${c.p != null ? `<span class="pl-wp" title="Chance to win, from the college hub's ratings"><i style="--w:${Math.round(c.p * 100)}%"></i>${Math.round(c.p * 100)}%</span>` : ""}</button>`).join("")}</div>
          ${mineT && !cell.live ? `<p class="pl-foot"><button type="button" class="btn sm ghost" data-unpick="${d.n}">Take back my day ${d.n} pick</button></p>` : ""}` : ""}</div>`;
    }).join("");
    const more = b.projected ? `<p class="ps">Later days appear as the bracket fills in.</p>` : "";
    return status + cards + more;
  }
  function survTable(b) {
    const S = P.survivor(b, Date.now());
    const cell = (c) => {
      if (!c) return `<td class="pl-c"></td>`;
      if (c.miss) return `<td class="pl-c loss" title="No pick">&ndash;</td>`;
      if (c.hidden) return `<td class="pl-c hid" title="Picked: shows at tip-off">&#9679;</td>`;
      if (c.none) return `<td class="pl-c"></td>`;
      return `<td class="pl-c ${c.win ? "win" : c.loss ? "loss" : ""}" title="${name(c.team)}">${logo(c.team, 20)}<span>${esc(team(c.team).ab || "")}</span></td>`;
    };
    return `<div class="card"><div class="table-wrap"><table class="t pl-st"><thead><tr><th>Entry</th><th>Status</th><th class="r" title="Combined seeds of winning picks: the tiebreaker">Seeds</th>${S.days.map((d) => `<th class="pl-c" title="${dayName(d.day)}">D${d.n}</th>`).join("")}</tr></thead><tbody>
      ${S.rows.map((r) => `<tr class="${r.me ? "me" : ""}"><td class="nm"><b>${esc(r.name)}</b></td><td>${r.winner ? `<span class="tag win">${S.winners.length > 1 ? "Split" : "Winner"}</span>` : r.alive ? `<span class="tag">Alive</span>` : `<span class="tag loss">Out day ${r.out}</span>`}</td><td class="r num ps">${r.seeds || ""}</td>${S.days.map((d) => cell(r.cells[d.n])).join("")}</tr>`).join("")}
      </tbody></table></div></div><p class="ps">${S.rows.filter((r) => r.alive).length} of ${S.rows.length} still alive. A dot is a pick that shows at tip-off. Seeds, the combined seeds of winning picks, breaks ties.</p>`;
  }

  // ---------- NFL survivor ----------
  const kickTime = (t) => new Date(t).toLocaleString("en-US", Object.assign({ weekday: "short", hour: "numeric", minute: "2-digit" }, ET)).replace(":00 ", " ");
  const weekDates = (w) => { const f = (t) => new Date(t).toLocaleDateString("en-US", Object.assign({ month: "short", day: "numeric" }, ET)); return f(w.first) === f(w.lock) ? f(w.first) : `${f(w.first)} to ${f(w.lock)}`; };
  function nflPicks(b) {
    const S = P.nfl(b, Date.now()), uid = me(b), row = S.rows.find((r) => r.id === uid), now = Date.now();
    if (!S.weeks.length) return `<div class="card"><div class="bd ps">This week's games aren't on the board yet. They show up a few days before the first kickoff.</div></div>`;
    const status = S.winners ? (S.winners.includes(uid) ? `<div class="pl-note win"><b>${S.winners.length > 1 ? `You split the pool with ${S.winners.length - 1} other${S.winners.length > 2 ? "s" : ""}.` : "You won the pool."}</b></div>` : `<div class="pl-note"><b>The pool is over.</b> ${S.winners.map((w) => esc((b.members.find((m) => m.id === w) || {}).name)).join(" and ")} ${S.winners.length > 1 ? "split it" : "won it"}.</div>`)
      : row && !row.alive ? `<div class="pl-note loss"><b>You're out</b> in week ${row.out}. You can still follow along on Standings.</div>` : "";
    const nextOpen = S.weeks.filter((w) => now < w.lock)[0];
    const cards = S.weeks.map((w) => {
      const cell = row ? row.cells[w.week] : null, locked = now >= w.lock, mineT = cell && cell.team;
      const res = cell && cell.win ? " &middot; won" : cell && cell.loss ? (cell.tie ? " &middot; tied" : " &middot; lost") : cell && cell.live ? " &middot; playing" : "";
      const head = `<div class="pl-day-h"><b>Week ${w.week}</b><span>${weekDates(w)}</span><span class="grow"></span>${mineT ? `<span class="pl-pick ${cell.win ? "win" : cell.loss ? "loss" : ""}">${nflLogo(mineT, 18)}${nflName(mineT)}${res}</span>` : cell && cell.miss ? `<span class="pl-pick loss">No pick</span>` : locked ? "" : `<span class="pl-pick none" title="Each pick locks when its own game kicks off">Last kickoff ${kickTime(w.lock)}</span>`}</div>`;
      const playable = row && row.alive && !S.winners && !locked;
      const showOpen = st.open["w" + w.week] != null ? st.open["w" + w.week] : playable && nextOpen === w;
      if (!playable) return `<div class="card pl-day done">${head}</div>`;
      const ch = P.nflChoices(b, w.week, uid, now).sort((x, y) => (!!x.why - !!y.why) || ((y.p == null ? -1 : y.p) - (x.p == null ? -1 : x.p)));
      return `<div class="card pl-day${showOpen ? " open" : ""}">${head.replace('<div class="pl-day-h">', `<button type="button" class="pl-day-h" data-week="${w.week}" aria-expanded="${!!showOpen}">`).replace(/<\/div>$/, "</button>")}
        ${showOpen ? `<div class="pl-choices">${ch.map((c) => `<button type="button" class="pl-team${c.picked ? " on" : ""}" data-npick="${w.week}|${esc(c.team)}"${c.why && !c.picked ? ` disabled title="${esc(c.why)}"` : ""}>
          ${nflLogo(c.team, 30)}<span class="pl-tn"><b>${nflName(c.team)}</b><small>${c.home ? "vs" : "at"} ${nflName(c.opp)}<span class="pl-sep"> &middot; </span><span class="pl-tw">${kickTime(c.kickoff)}</span></small>${c.why && !c.picked ? `<small class="pl-why">${esc(c.why)}</small>` : ""}</span>
          ${c.p != null ? `<span class="pl-wp" title="Chance to win, from the betting line"><i style="--w:${Math.round(c.p * 100)}%"></i>${Math.round(c.p * 100)}%</span>` : ""}</button>`).join("")}</div>
          ${mineT && !cell.live ? `<p class="pl-foot"><button type="button" class="btn sm ghost" data-nunpick="${w.week}">Take back my week ${w.week} pick</button></p>` : ""}` : ""}</div>`;
    }).join("");
    const mineAll = ((b.picks || []).filter((k) => k.user === uid && k.team).map((k) => k.team));
    const left = Object.keys(NFL).filter((t) => !mineAll.includes(t));
    const usedLine = mineAll.length ? `<p class="ps">Used: ${mineAll.map(nflName).join(", ")}. ${left.length} teams left.</p>` : "";
    const later = `<p class="ps">Later weeks show up as their games are scheduled on the board, a few days ahead.</p>`;
    return status + cards + usedLine + (row && row.alive && !S.winners ? survPlanCard(b, uid, nextOpen) : "") + later;
  }
  // ---------- survivor planner: the rest of the season, from the NFL hub's schedule and team ratings ----------
  const toHub = (t) => (t === "WSH" ? "WAS" : t), fromHub = (t) => (t === "WAS" ? "WSH" : t);
  let planLoad = null;
  const loadPlan = () => planLoad || (planLoad = Promise.all([
    new Promise((res) => { if (window.NFLSeason) return res(); const sc = document.createElement("script"); sc.src = "/nfl/lib/season.js"; sc.onload = res; sc.onerror = res; document.body.appendChild(sc); }),
    fetch("/nfl/data/games.json", { cache: "no-cache" }).then((r) => r.json()).catch(() => null),
  ]).then(([, d]) => {
    const S = window.NFLSeason;
    if (!S || !d || !d.games) return null;
    return { games: d.games, ratings: S.ratings(d.games, Object.keys(S.divOf)) };
  }));
  function survPlanCard(b, uid, nextOpen) {
    if (!st.planData) { loadPlan().then((x) => { st.planData = x || { none: true }; if (x) render(); }); return ""; }
    if (st.planData.none) return "";
    const from = nextOpen ? nextOpen.week : Math.max(...P.nflWeeks(b.games).map((w) => w.week)) + 1;
    if (from > 18) return "";
    // teams you've used in weeks already locked are out; this week's pick is still yours to change
    const usedT = (b.picks || []).filter((k) => k.user === uid && k.team && +k.slot.slice(1) < from).map((k) => toHub(k.team));
    const thisWeek = ((b.picks || []).find((k) => k.user === uid && k.slot === "w" + from) || {}).team;
    const key = `${from}|${usedT.join()}`;
    if (!st.plan || st.plan.key !== key) st.plan = { key, out: P.survPlan({ games: st.planData.games, ratings: st.planData.ratings, from, to: 18, used: usedT }) };
    const out = st.plan.out, wks = out.weeks, onPath = {}; out.path.forEach((x) => { onPath[x.team + "|" + x.week] = true; });
    if (!out.path.length) return "";
    // teams ordered by how much they're worth from here: their best few weeks
    const val = (t) => wks.map((w) => Math.max(0, out.grid[t][w] || 0)).sort((x, y) => y - x).slice(0, 3).reduce((a, v) => a + v, 0);
    const rows = out.teams.slice().sort((x, y) => val(y) - val(x));
    const shown = st.planAll ? rows : rows.slice(0, 14);
    const sug = out.path[0], mineNow = thisWeek ? toHub(thisWeek) : null;
    const cell = (t, w) => { const q = out.grid[t][w]; return q == null ? `<td class="pl-pc bye" title="Bye">bye</td>` : q < 0 ? `<td class="pl-pc bye" title="Already played">played</td>` : `<td class="r pl-pc${onPath[t + "|" + w] ? " path" : ""}${mineNow === t && w === from ? " mine" : ""}" style="--p:${Math.max(0, (q - 0.45) / 0.55).toFixed(3)}">${Math.round(q * 100)}</td>`; };
    return `<section class="card pl-plan pl-splan"><div class="mod-h"><h2>Plan ahead</h2><span class="grow"></span><span class="ps">Win chance each week, to week 18</span></div>
      <div class="bd pl-sum"><p><b>Best path from here:</b> ${out.path.slice(0, 4).map((x) => `<span class="pl-gchip">Wk ${x.week} ${nflName(fromHub(x.team))} <small>${Math.round(x.p * 100)}%</small></span>`).join(" ")}${out.path.length > 4 ? ` <span class="ps">and ${out.path.length - 4} more</span>` : ""}</p>
        <p class="ps">Chance to survive every week left on that path: <b>${(out.odds * 100).toFixed(out.odds < 0.1 ? 1 : 0)}%</b>.${mineNow && mineNow !== sug.team ? ` Your week ${from} pick is ${nflName(fromHub(mineNow))}; the path would take ${nflName(fromHub(sug.team))} and save ${nflName(fromHub(mineNow))} for week ${(out.path.find((x) => x.team === mineNow) || {}).week || "later"}.` : mineNow ? ` Your week ${from} pick matches it.` : ""}</p></div>
      <div class="table-wrap"><table class="t pl-pt"><thead><tr><th>Team</th>${wks.map((w) => `<th class="r${w === from ? " cur" : ""}">${w}</th>`).join("")}</tr></thead><tbody>
      ${shown.map((t) => `<tr><td class="nm"><span class="pl-ptn">${nflLogo(fromHub(t), 18)}<b>${esc(fromHub(t))}</b></span></td>${wks.map((w) => cell(t, w)).join("")}</tr>`).join("")}
      </tbody></table></div>
      <div class="bd"><p class="ps">${rows.length > 14 ? `<button type="button" class="btn sm ghost" data-planall>${st.planAll ? "Show fewer teams" : `Show all ${rows.length} teams`}</button> ` : ""}Outlined: the best path, one team a week and each team once. Posted point spreads where there are any, the NFL hub's team ratings after that. Used teams aren't listed.</p></div></section>`;
  }
  function nflTable(b) {
    const S = P.nfl(b, Date.now());
    const cell = (c) => {
      if (!c) return `<td class="pl-c"></td>`;
      if (c.miss) return `<td class="pl-c loss" title="No pick">&ndash;</td>`;
      if (c.hidden) return `<td class="pl-c hid" title="Picked: shows at kickoff">&#9679;</td>`;
      if (c.none) return `<td class="pl-c"></td>`;
      return `<td class="pl-c ${c.win ? "win" : c.loss ? "loss" : ""}" title="${nflName(c.team)}${c.tie ? " (tie)" : ""}">${nflLogo(c.team, 20)}<span>${esc(c.team)}</span></td>`;
    };
    return `<div class="card"><div class="table-wrap"><table class="t pl-st"><thead><tr><th>Entry</th><th>Status</th><th class="r" title="Winning picks">W</th>${S.weeks.map((w) => `<th class="pl-c" title="${weekDates(w)}">W${w.week}</th>`).join("")}</tr></thead><tbody>
      ${S.rows.map((r) => `<tr class="${r.me ? "me" : ""}"><td class="nm"><b>${esc(r.name)}</b></td><td>${r.winner ? `<span class="tag win">${S.winners.length > 1 ? "Split" : "Winner"}</span>` : r.alive ? `<span class="tag">Alive</span>` : `<span class="tag loss">Out week ${r.out}</span>`}</td><td class="r num ps">${r.wins || ""}</td>${S.weeks.map((w) => cell(r.cells[w.week])).join("")}</tr>`).join("")}
      </tbody></table></div></div><p class="ps">${S.rows.filter((r) => r.alive).length} of ${S.rows.length} still alive. A dot is a pick that shows at kickoff.</p>`;
  }

  // ---------- bowl pick'em ----------
  const cfbName = (id, full) => esc((st.teams[id] && st.teams[id].n) || full || "TBD");
  const cfbLogo = (id, px = 28) => id ? `<img class="pl-logo" src="https://a.espncdn.com/combiner/i?img=/i/teamlogos/ncaa/500/${esc(id)}.png&w=${px * 2}&h=${px * 2}" alt="" width="${px}" height="${px}" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="pl-logo pl-nologo" style="width:${px}px;height:${px}px"></span>`;
  // a team's chance in a bowl: the college football hub's power ratings on a neutral field
  const cfbProb = (g, t) => {
    const R = st.cfb && st.cfb.ratings, sd = (st.cfb && Number(st.cfb.sd)) || 14;
    if (!R || !g.a || !g.b || !R[g.a] || !R[g.b]) return null;
    const pa = P.normCdf((R[g.a].power - R[g.b].power) / sd);
    return t === g.a ? pa : t === g.b ? 1 - pa : null;
  };
  const myPicks = (b) => { const uid = me(b), out = {}; (b.picks || []).forEach((k) => { if (k.user === uid && k.slot[0] === "g") out[k.slot.slice(1)] = { team: k.team || "", pts: k.pts }; }); return out; };
  const myTb = (b) => { const k = (b.picks || []).find((x) => x.user === me(b) && x.slot === "tb"); return k ? k.team : ""; };
  const dayOf = (t) => new Date(t).toLocaleDateString("en-US", Object.assign({ weekday: "short", month: "short", day: "numeric" }, ET));
  function bowlPicks(b) {
    const games = b.games || [], n = games.length, now = Date.now();
    if (!n) return `<div class="card"><div class="bd ps">The bowl schedule isn't out yet.</div></div>`;
    if (!st.bd) { st.bd = myPicks(b); st.btb = myTb(b); }
    const norm = (o) => JSON.stringify(Object.entries(o).filter(([, k]) => k.team || k.pts).map(([id, k]) => [id, k.team || "", k.pts || null]).sort());
    const dirty = norm(st.bd) !== norm(myPicks(b)) || String(st.btb || "") !== String(myTb(b) || "");
    const chk = P.bowlsCheck(st.bd, n), B = P.bowls(b, now), row = B.rows.find((r) => r.me);
    const used = {}; Object.values(st.bd).forEach((k) => { if (k.pts) used[k.pts] = true; });
    const picked = Object.values(st.bd).filter((k) => k.team).length, numbered = Object.values(st.bd).filter((k) => k.pts).length;
    const tbLocked = b.lock && now >= Date.parse(b.lock);
    const bar = `<div class="card pl-bar pl-bbar"><div class="bd">
      <div class="pl-bstat"><span><b>${picked}</b> of ${n} picked</span><span><b>${numbered}</b> of ${n} numbered</span>${row && (row.right || row.wrong) ? `<span><b>${row.points}</b> points, ${row.right}-${row.wrong}</span>` : ""}</div>
      <label class="pl-tb">Title game total points<input type="number" inputmode="numeric" min="0" max="200" data-btb value="${esc(st.btb || "")}" placeholder="e.g. 48"${tbLocked ? " disabled" : ""}></label>
      <div class="pl-save"><button type="button" class="btn sm" data-bauto title="Give the biggest numbers to your surest picks">Number by confidence</button><span class="ps">${chk.ok ? (dirty ? "Not saved yet." : "Saved.") : esc(chk.why)}</span><button type="button" class="btn go" data-bsave${chk.ok && dirty ? "" : " disabled"}>Save picks</button></div></div></div>`;
    let lastDay = "";
    const rows = games.map((g) => {
      const k = st.bd[g.id] || {}, locked = now >= Date.parse(g.kickoff), d = dayOf(g.kickoff);
      const head = d !== lastDay ? `<h3 class="pl-bday">${esc(d)}</h3>` : ""; lastDay = d;
      const side = (t, full) => {
        const p = cfbProb(g, t), on = k.team && k.team === t, won = g.final && g.w === t, lost = g.final && g.w && g.w !== t;
        return `<button type="button" class="pl-bt${on ? " on" : ""}${won ? " won" : ""}${lost ? " lost" : ""}" data-bteam="${esc(g.id)}|${esc(t || "")}"${!t || locked ? " disabled" : ""}>
          ${cfbLogo(t, 24)}<span class="pl-tn"><b>${cfbName(t, full)}</b>${g.final ? `<small>${t === g.a ? g.ap : g.bp}</small>` : p != null ? `<small>${Math.round(p * 100)}%</small>` : ""}</span></button>`;
      };
      const res = g.final && k.team ? (g.w === k.team ? `<span class="pl-pick win">+${k.pts || 0}</span>` : `<span class="pl-pick loss">0</span>`) : "";
      const sel = locked ? `<span class="pl-bpts">${k.pts ? `<b>${k.pts}</b>` : "&ndash;"}</span>` : `<select class="pl-bsel" data-bpts="${esc(g.id)}" aria-label="Confidence for the ${esc(g.label)}"><option value="">&ndash;</option>${Array.from({ length: n }, (_, i) => n - i).map((v) => `<option value="${v}"${k.pts === v ? " selected" : ""}>${v}${used[v] && k.pts !== v ? " (used)" : ""}</option>`).join("")}</select>`;
      return `${head}<div class="pl-bowl${locked ? " locked" : ""}${g.round ? " cfp" : ""}"><div class="pl-bowl-h"><b>${esc(g.label.replace(/ Presented by .*| Game$/, ""))}</b><span>${locked ? (g.final ? "Final" : "Playing") : tipTime(g.kickoff)}</span>${res}</div>
        <div class="pl-bowl-b"><div class="pl-bts">${side(g.a, g.an)}${side(g.b, g.bn)}</div><label class="pl-conf"><span>Points</span>${sel}</label></div></div>`;
    }).join("");
    // with 40-odd games to go through, a save button follows you down the list once there's something to save
    const float = chk.ok && dirty ? `<div class="pl-float"><span>${picked} picked, ${numbered} numbered</span><button type="button" class="btn go" data-bsave>Save picks</button></div>` : "";
    return bar + `<div class="pl-bowls">${rows}</div><p class="ps">Chances come from the college football hub's ratings. Picking a number that's taken swaps it with that game.</p>` + float;
  }
  function bowlTable(b) {
    const B = P.bowls(b, Date.now()), tbOpen = b.lock && Date.now() >= Date.parse(b.lock);
    return `<div class="card"><div class="table-wrap"><table class="t pl-st"><thead><tr><th class="r">#</th><th>Entry</th><th class="r">Pts</th><th class="r" title="Right and wrong picks">W-L</th><th class="r" title="Points still possible">Max</th><th class="r pl-hide-s" title="Title game total points guess">TB</th></tr></thead><tbody>
      ${B.rows.map((r) => `<tr class="${r.me ? "me" : ""}"><td class="r num">${r.place}</td><td class="nm"><b>${esc(r.name)}</b>${!r.teams.length ? `<small class="ps"> no picks yet</small>` : !r.picked ? `<small class="ps"> ${r.teams.length} of 5 picked</small>` : ""}</td><td class="r num"><b>${r.points}</b></td><td class="r num ps">${r.right}-${r.wrong}</td><td class="r num ps">${r.max}</td><td class="r num ps pl-hide-s">${tbOpen || r.me ? (r.tb ?? "") : ""}</td></tr>`).join("")}
      </tbody></table></div></div><p class="ps">A right pick scores its confidence number. Max is what an entry could still reach. Everyone's pick shows at each game's kickoff.${B.total != null ? ` The title game totaled ${B.total}.` : ""}</p>`;
  }

  // ---------- NFL playoff bracket ----------
  // ESPN lists playoff games at midnight Eastern until their times are set: show the day then, not "12 AM"
  const lockText = (b) => {
    if (!b.lock) return "at the first Wild Card kickoff";
    const r1 = (b.games || []).filter((g) => g.round === 1), tbd = r1.length && r1.every((g) => /T05:00:00/.test(new Date(g.kickoff).toISOString()));
    return tbd ? `at the first Wild Card kickoff, ${dayOf(b.lock).replace(/^\w+, /, "")} weekend` : tipTime(b.lock);
  };
  function brPicks(b) {
    const field = b.field || [], now = Date.now(), locked = b.lock && now >= Date.parse(b.lock);
    if (field.length < 14) return `<div class="card"><div class="bd ps">The playoff field isn't set yet.</div></div>`;
    const mine = {}; (b.picks || []).forEach((k) => { if (k.user === me(b) && k.slot !== "tb") mine[k.slot] = k.team; });
    if (!st.kb) { st.kb = P.bracketPicks(field, mine); st.ktb = myTb(b); }
    const br = P.bracket(field, st.kb), seedOf = {}; field.forEach((f) => { seedOf[f.team] = f.seed; });
    const won = {}, lost = {}; (b.games || []).forEach((g) => { if (g.final && g.w) { won[g.round + g.w] = true; lost[g.w === g.a ? g.b : g.a] = true; } });
    const roundOf = (slot) => (slot === "sb" ? 4 : /cf$/.test(slot) ? 3 : /dv/.test(slot) ? 2 : 1);
    const dirty = JSON.stringify(P.bracketPicks(field, st.kb)) !== JSON.stringify(P.bracketPicks(field, mine)) || String(st.ktb || "") !== String(myTb(b) || "");
    const total = Object.keys(P.bracketPicks(field, st.kb)).length;
    const team = (g, t) => {
      if (!t) return `<span class="pl-kt tbd">TBD</span>`;
      const on = g.pick === t, r = roundOf(g.slot), mark = locked && on ? (won[r + t] ? " won" : lost[t] ? " lost" : "") : "";
      return `<button type="button" class="pl-kt${on ? " on" : ""}${mark}" data-kb="${g.slot}|${t}"${locked ? " disabled" : ""}>${nflLogo(t, 20)}<span class="pl-seed">${seedOf[t]}</span><b>${nflName(t)}</b></button>`;
    };
    const game = (g) => `<div class="pl-kg">${team(g, g.a)}${team(g, g.b)}</div>`;
    const conf = (cf) => { const c = br.confs[cf]; return `<div class="card pl-kconf"><div class="mod-h"><h2>${cf}</h2><span class="grow"></span><span class="ps">${nflLogo(c.bye, 16)} ${nflName(c.bye)} has the bye</span></div><div class="pl-kcols">
      <div class="pl-kr"><h4>Wild Card</h4>${c.wc.map(game).join("")}</div><div class="pl-kr"><h4>Divisional</h4>${c.dv.map(game).join("")}</div><div class="pl-kr"><h4>${cf} title</h4>${game(c.cf)}</div></div></div>`; };
    const sb = `<div class="card pl-ksb"><div class="mod-h"><h2>Super Bowl</h2></div><div class="bd">${game(br.sb)}
      <label class="pl-tb">Super Bowl total points<input type="number" inputmode="numeric" min="0" max="200" data-ktb value="${esc(st.ktb || "")}" placeholder="e.g. 47"${locked ? " disabled" : ""}></label>
      ${locked ? "" : `<div class="pl-save"><span class="ps">${total} of 13 picked. ${dirty ? "Not saved yet." : "Saved."} Locks ${lockText(b)}.</span><button type="button" class="btn go" data-ksave${dirty ? "" : " disabled"}>Save bracket</button></div>`}</div></div>`;
    const note = !locked ? `<div class="pl-note"><b>${(b.games || []).some((g) => g.round === 1 && g.a) ? "The field is set." : "Practice bracket."}</b> ${(b.games || []).some((g) => g.round === 1 && g.a) ? "Pick away before the first Wild Card kickoff." : "These are the seeds if the season ended today. They update with the standings until week 18 is over, so check your bracket again before it locks."}</div>` : "";
    return note + `<div class="pl-kwrap">${conf("AFC")}${conf("NFC")}</div>` + sb;
  }
  function brTable(b) {
    const R = P.nflpo(b, Date.now()), locked = b.lock && Date.now() >= Date.parse(b.lock);
    return `<div class="card"><div class="table-wrap"><table class="t pl-st"><thead><tr><th class="r">#</th><th>Entry</th><th class="r">Pts</th><th class="r" title="Points still possible">Max</th><th>Champion</th><th class="r pl-hide-s" title="Super Bowl total points guess">TB</th></tr></thead><tbody>
      ${R.rows.map((r) => `<tr class="${r.me ? "me" : ""}"><td class="r num">${locked ? r.place : ""}</td><td class="nm"><b>${esc(r.name)}</b>${!r.picked ? `<small class="ps"> no bracket yet</small>` : ""}</td><td class="r num"><b>${r.points}</b></td><td class="r num ps">${locked ? r.max : ""}</td><td>${r.champ ? `${nflLogo(r.champ, 18)} ${nflName(r.champ)}` : (locked || r.me ? "" : `<span class="ps">Shows at lock</span>`)}</td><td class="r num ps pl-hide-s">${locked || r.me ? (r.tb ?? "") : ""}</td></tr>`).join("")}
      </tbody></table></div></div><p class="ps">${locked ? "Each round a team wins that you picked scores 1, 2, 4 or 8. Max is what an entry could still reach." : "Everyone's bracket shows at the first Wild Card kickoff."}</p>`;
  }

  // ---------- NFL playoff fantasy ----------
  const RNAME = { 1: "Wild Card", 2: "Divisional", 3: "Conference", 4: "Super Bowl" };
  const SLOT_NAME = { QB: "QB", RB1: "RB", RB2: "RB", WR1: "WR", WR2: "WR", TE: "TE", FLEX: "FLEX", K: "K", DEF: "DEF" };
  // the Draft Lab player list (names, teams, positions, season points) and each scored round's points from fk-live
  async function ffLoad(b) {
    if (!st.ffp) {
      try {
        const d = await fetch("/fantasy-kit/data/nfl.json", { cache: "no-cache" }).then((r) => r.json());
        // each player's season points in all three scorings, per game, and the latest week's projection
        const L = d.lines || {}, cols = (L.tot && L.tot.cols) || [], gi = cols.indexOf("g"), SC = ["pts_std", "pts_half_ppr", "pts_ppr"];
        const wk = Object.keys(L).filter((k) => /^wk\d+$/.test(k)).sort((x, y) => +y.slice(2) - +x.slice(2))[0], wc = wk ? L[wk].cols : [];
        st.ffWeek = wk ? +wk.slice(2) : null; st.ffdata = d; st.ffraw = {}; st.ffcols = cols; st.ffwcols = wc;
        st.ffp = {};
        (d.players || []).forEach((p) => {
          const t = p.l && p.l.tot, g = t ? t[gi] || 0 : 0, w = wk && p.l && p.l[wk];
          const tot = SC.map((c) => (t ? t[cols.indexOf(c)] || 0 : 0)), pj = SC.map((c) => (w && wc.indexOf(c) >= 0 ? w[wc.indexOf(c)] || 0 : null));
          st.ffraw[p.id] = p;
          st.ffp[p.id] = { id: p.id, n: p.n, t: p.t === "WAS" ? "WSH" : p.t, pos: p.pos[0], g, tot, pj, espn: p.espn, ppg: g ? tot[1] / g : 0, s: t || null, w: w || null };
        });
      } catch (e) { st.ffp = {}; }
    }
    st.ffs = st.ffs || {};
    const now = Date.now();
    await Promise.all([1, 2, 3, 4].map(async (r) => {
      const lk = ffLock(b, r);
      if (!lk || now < lk || (st.ffs[r] && st.ffs[r].final)) return;
      const x = await C.nflPost(b.pool.season, r);
      if (x && x.players) st.ffs[r] = x;
    }));
  }
  // league-wide ownership: the share of entries that started each player in a round (others' players show at their
  // kickoff, so it fills in as games start)
  // (only players whose game has kicked off count: before that, only your own picks are visible to you)
  const ffOwn = (F, r, n, b) => {
    const c = {}, now = Date.now(), kicked = (id) => { const t = ((st.ffp || {})[id] || {}).t, k = b ? ffKick(b, r, t) : null; return k != null && now >= k; };
    F.rows.forEach((x) => Object.values(((x.rounds[r] || {}).lineup) || {}).forEach((id) => { if (kicked(id)) c[id] = (c[id] || 0) + 1; }));
    Object.keys(c).forEach((k) => { c[k] = Math.round((100 * c[k]) / Math.max(1, n)); });
    return c;
  };
  const ffSiOf = (b) => (b && b.pool ? ffSi(b) : 1);
  // the stats table's columns for each spot
  const REC = [["rec_tgt", "Tgt"], ["rec", "Rec"], ["rec_yd", "Rec yds"], ["rec_td", "Rec TD"], ["rush_yd", "Rush yds"]];
  const FF_COLS = {
    QB: [["pass_cmp", "Cmp"], ["pass_att", "Att"], ["pass_yd", "Pass yds"], ["pass_td", "Pass TD"], ["pass_int", "INT"], ["rush_yd", "Rush yds"], ["rush_td", "Rush TD"]],
    RB: [["rush_att", "Car"], ["rush_yd", "Rush yds"], ["rush_td", "Rush TD"], ["rec_tgt", "Tgt"], ["rec", "Rec"], ["rec_yd", "Rec yds"], ["rec_td", "Rec TD"]],
    WR: REC, TE: REC,
    FLEX: [["rush_yd", "Rush yds"], ["rush_td", "Rush TD"], ["rec_tgt", "Tgt"], ["rec", "Rec"], ["rec_yd", "Rec yds"], ["rec_td", "Rec TD"]],
    K: [["fgm", "FGM"], ["fga", "FGA"], ["fgm_50p", "50+"], ["xpm", "XPM"]],
    DEF: [["def_sack", "Sacks"], ["def_int", "INT"], ["fum_rec", "Fum rec"], ["def_td", "TD"], ["pts_allow", "Pts allowed"]],
  };
  // one stat for a player in the chosen view: season total, per game, or this week's projection
  const ffStat = (p, col, view) => {
    if (view === "proj") { const i = (st.ffwcols || []).indexOf(col); return p.w && i >= 0 ? p.w[i] || 0 : null; }
    const i = (st.ffcols || []).indexOf(col); if (!p.s || i < 0) return null;
    const v = p.s[i] || 0; return view === "pg" ? (p.g ? v / p.g : 0) : v;
  };
  const fmt1 = (v, view) => (v == null ? "&ndash;" : view === "tot" && Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toFixed(1));
  const FF_SI = { std: 0, half: 1, ppr: 2 }, FF_SL = ["Standard", "Half PPR", "PPR"];
  const ffSi = (b) => (FF_SI[((b.pool && b.pool.extra) || {}).scoring] != null ? FF_SI[b.pool.extra.scoring] : 1);
  // a player's number for a sort: points a game, season points, or this week's projection, in the pool's scoring
  const ffVal = (p, b, mode) => { const i = ffSi(b); return mode === "tot" ? p.tot[i] : mode === "proj" ? (p.pj && p.pj[i] != null ? p.pj[i] : 0) : p.g ? p.tot[i] / p.g : 0; };
  const ffPhoto = (p, px = 32) => {
    const logo = `https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500/${esc(String(p.t || "").toLowerCase())}.png&w=${px * 2}&h=${px * 2}`;
    const src = p.espn && p.pos !== "DEF" ? `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${esc(p.espn)}.png&w=${px * 3}&h=${Math.round(px * 2.2)}` : logo;
    return `<span class="pl-pph${p.espn && p.pos !== "DEF" ? " face" : ""}" style="width:${px}px;height:${px}px"><img src="${src}" alt="" loading="lazy" onerror="if(!this.dataset.l){this.dataset.l=1;this.parentNode.classList.remove('face');this.src='${logo}'}else{this.remove()}"></span>`;
  };
  // the same player card as the rest of Draft Lab (fantasy-kit/ui.js and friends, loaded the first time one opens)
  let cardLibs = null;
  const loadCardLibs = () => cardLibs || (cardLibs = ["sports.js?v=20261121lg", "value.js?v=202611201102", "experience.js?v=20261124gw", "../assets/faces.js?v=20261121b", "../assets/pcard.js?v=20261124a", "ui.js?v=20261124gw"].reduce((pr, f) => pr.then(() => new Promise((res) => {
    const sc = document.createElement("script"); sc.src = "/fantasy-kit/" + f; sc.onload = res; sc.onerror = res; document.body.appendChild(sc);
  })), Promise.resolve()));
  async function ffCard(id, b) {
    await loadCardLibs();
    const FK = window.FK || {}, S = FK.sports, U = FK.ui, raw = st.ffraw && st.ffraw[id];
    if (!S || !U || !S.nfl || !raw) { st.msg = "Couldn't open that player's card."; return render(); }
    if (!st.ffsport) st.ffsport = S.attach(Object.assign({}, S.nfl), st.ffdata);
    const F = P.nflff(b, st.ffs), row = F.rows.find((r) => r.me) || { rounds: {} };
    const used = [1, 2, 3, 4].find((r) => Object.values((row.rounds[r] || {}).lineup || {}).includes(id));
    const pts = [1, 2, 3, 4].map((r) => st.ffs[r] && st.ffs[r].players && st.ffs[r].players[id] ? [r, st.ffs[r].players[id][ffSi(b)]] : null).filter(Boolean);
    const extra = `<div class="pc-line pc-line-s"><span class="ps"><b>In this pool</b></span><span>${used ? `You used him in the ${RNAME[used]}.` : "You haven't used him."}${pts.length ? " " + pts.map(([r, v]) => `${RNAME[r]}: <b class="num">${v}</b>`).join(", ") : ""}</span></div>`;
    const pp = st.ffp[id] || {}, i = ffSi(b), f1 = (v) => (v == null ? "-" : (Math.round(v * 10) / 10).toFixed(1));
    const stats = [["Season pts", f1(pp.tot && pp.tot[i])], ["Per game", f1(pp.g ? pp.tot[i] / pp.g : null)], [st.ffWeek ? `Proj, wk ${st.ffWeek}` : "Projection", f1(pp.pj && pp.pj[i])], ["Playoff pts", pts.length ? f1(pts.reduce((a, [, v]) => a + v, 0)) : "-"]];
    U.dialog(U.playerCard(st.ffsport, raw, { scoring: ["std", "half", "ppr"][i], extra, stats, fold: true, logo: true }), null, { wide: true, sheet: true });
  }
  const ffLock = (b, r) => { const ks = (b.games || []).filter((g) => g.round === r).map((g) => Date.parse(g.kickoff)); return ks.length ? Math.min(...ks) : null; };
  // when a team kicks off in a round (a player locks then)
  const ffKick = (b, r, t) => { const g = (b.games || []).find((x) => x.round === r && (x.a === t || x.b === t)); return g ? Date.parse(g.kickoff) : null; };
  const ffLast = (b, r) => { const ks = (b.games || []).filter((g) => g.round === r).map((g) => Date.parse(g.kickoff)); return ks.length ? Math.max(...ks) : null; };
  // before week 18 ends the Wild Card round plays from projected matchups: 2 v 7, 3 v 6, 4 v 5 in each conference, if
  // the season ended today (the server takes those teams too). A player whose team misses the cut scores nothing.
  const ffProj = (b) => !(b.games || []).some((g) => g.round === 1 && g.a && g.b) && (b.field || []).filter((f) => f.seed >= 2 && f.seed <= 7).length === 12;
  const ffTeams = (b, r) => {
    const out = {};
    if (r === 1 && ffProj(b)) {
      ["AFC", "NFC"].forEach((cf) => { const by = {}; b.field.forEach((f) => { if (f.conf === cf) by[f.seed] = f.team; }); [[2, 7], [3, 6], [4, 5]].forEach(([x, y]) => { out[by[x]] = by[y]; out[by[y]] = by[x]; }); });
      return out;
    }
    (b.games || []).forEach((g) => { if (g.round === r && g.a && g.b) { out[g.a] = g.b; out[g.b] = g.a; } });
    return out;
  };
  function ffRound(b) {
    const now = Date.now(), open = [1, 2, 3, 4].find((r) => Object.keys(ffTeams(b, r)).length && now < ffLast(b, r));
    const played = [1, 2, 3, 4].filter((r) => ffLock(b, r) && now >= ffLock(b, r)).pop();
    return open || played || 1;
  }
  function ffPicks(b) {
    const uid = me(b), F = P.nflff(b, st.ffs), row = F.rows.find((r) => r.id === uid) || { rounds: {}, used: [] };
    if (!st.ffr) st.ffr = ffRound(b);
    const r = st.ffr, now = Date.now(), teams = ffTeams(b, r), lk = ffLock(b, r), last = ffLast(b, r), locked = last && now >= last, set = Object.keys(teams).length > 0;
    const started = (t) => { const k = ffKick(b, r, t); return k != null && now >= k; };
    const proj = r === 1 && ffProj(b), ownR = ffOwn(F, r, b.members.length, b);
    const saved = (row.rounds[r] && row.rounds[r].lineup) || {};
    if (!st.ffl || st.fflr !== r) { st.ffl = Object.assign({}, saved); st.fflr = r; st.ffslot = null; }
    const usedElsewhere = new Set(row.used.filter((id) => !Object.values(saved).includes(id)));
    // which round each used player went in, so the list can say so
    const usedIn = {}; [1, 2, 3, 4].forEach((x) => { if (x !== r) Object.values((row.rounds[x] && row.rounds[x].lineup) || {}).forEach((id) => { usedIn[id] = RNAME[x]; }); });
    const dirty = JSON.stringify(Object.entries(st.ffl).filter(([, v]) => v).sort()) !== JSON.stringify(Object.entries(saved).sort());
    const tabs = `<div class="seg pl-rtabs" role="tablist">${[1, 2, 3, 4].map((x) => { const l = ffLock(b, x), on = Object.keys(ffTeams(b, x)).length; return `<button type="button" role="tab" data-ffr="${x}" aria-selected="${x === r}"><b>${RNAME[x]}</b><small>${l && now >= l ? (row.rounds[x] && row.rounds[x].pts != null ? `${row.rounds[x].pts} pts` : "Locked") : on ? "Open" : "Not set"}</small></button>`; }).join("")}</div>`;
    if (!set) {
      const fieldTeams = (b.field || []).map((f) => f.team);
      return tabs + `<div class="pl-note"><b>${RNAME[r]} lineups open once its matchups are set.</b> ${r === 1 ? `The Wild Card games are set after week 18. You'll pick from the 12 teams playing that weekend (the two 1 seeds rest). ${fieldTeams.length ? `In the field if the season ended today: ${fieldTeams.map(nflName).join(", ")}.` : ""}` : "This round's teams fill in as the last round's games end."}</div>`;
    }
    const pl = (id) => (st.ffp && st.ffp[id]) || { id, n: id, t: "", pos: "" };
    const slotRow = (sl) => {
      const id = st.ffl[sl], p = id ? pl(id) : null, pts = row.rounds[r] && row.rounds[r].each ? row.rounds[r].each[sl] : null;
      const lockedHere = locked || (p && saved[sl] === id && started(p.t));
      const pg = p && p.g != null ? ffVal(p, b, "pg") : 0;
      return `<div class="pl-ffi"><button type="button" class="pl-ffs${st.ffslot === sl ? " on" : ""}${p ? "" : " empty"}${lockedHere ? " lk" : ""}" data-ffslot="${sl}"${lockedHere ? ` disabled title="Locked: his game has started"` : ""}><span class="pl-ffpos">${SLOT_NAME[sl]}</span>
        ${p ? `${ffPhoto(p, 30)}<span class="pl-tn"><b>${esc(p.n)}</b><small>${esc(p.t)}${teams[p.t] ? ` vs ${esc(teams[p.t])}` : ""}${!lockedHere && pg ? ` &middot; ${pg.toFixed(1)} a game` : ""}${lockedHere ? ` &middot; locked${ownR[id] != null ? `, ${ownR[id]}% started` : ""}` : teams[p.t] && ffKick(b, r, p.t) ? ` &middot; ${tipTime(ffKick(b, r, p.t))}` : ""}</small></span>` : `<span class="pl-tn"><b class="ps">${locked ? "Empty" : "Pick a player"}</b></span>`}
        ${pts != null ? `<span class="pl-ffpts">${pts}</span>` : ""}</button>${p && st.ffraw && st.ffraw[id] ? `<button type="button" class="pl-ffinfo" data-ffcard="${esc(id)}" aria-label="${esc(p.n)}: player card" title="Player card">i</button>` : ""}</div>`;
    };
    let picker = "";
    if (st.ffslot && !locked) {
      const want = P.ffSlots(st.ffslot), inLu = new Set(Object.entries(st.ffl).filter(([k, v]) => v && k !== st.ffslot).map(([, v]) => v));
      // the numbers: season totals, per game, or this week's projection; shown as a list or as a stats table
      const view = st.ffstat || "pg", table = st.ffview === "table", cols = FF_COLS[st.ffslot] || FF_COLS[st.ffslot.replace(/\d/, "")] || [];
      const VL = { tot: "season", pg: "a game", proj: st.ffWeek ? `proj, wk ${st.ffWeek}` : "proj" };
      const sc = st.ffsortcol && (st.ffsortcol === "fp" || st.ffsortcol === "g" || cols.some(([k]) => k === st.ffsortcol)) ? st.ffsortcol : "fp", dir = st.ffsortdir || -1;
      const key = (p) => (sc === "fp" ? ffVal(p, b, view) : sc === "g" ? p.g || 0 : ffStat(p, sc, view) || 0);
      const fits = Object.values(st.ffp || {}).filter((p) => want.includes(p.pos) && teams[p.t] && !started(p.t) && !inLu.has(p.id)).sort((x, y) => dir * (key(x) - key(y)));
      // players you've already used stay in the list, grayed out with the round you used them, unless you hide them
      const list = fits.filter((p) => !usedElsewhere.has(p.id)).slice(0, 60).concat(st.ffhide ? [] : fits.filter((p) => usedElsewhere.has(p.id)));
      const seg = (attr, cur, items) => `<div class="seg pl-ffseg" role="group">${items.map(([v, l]) => `<button type="button" ${attr}="${v}" aria-pressed="${cur === v}">${l}</button>`).join("")}</div>`;
      const opp = (p) => `${esc(p.t)} ${ffKick(b, r, p.t) && (b.games || []).some((g) => g.round === r && g.b === p.t) ? "vs" : ffProj(b) && r === 1 ? "vs" : "at"} ${esc(teams[p.t])}`;
      const usedNote = (p) => (usedElsewhere.has(p.id) ? ` &middot; used in the ${esc(usedIn[p.id] || "playoffs")}` : "");
      const clear = st.ffl[st.ffslot] ? `<button type="button" class="pl-ffp pl-ffclear" data-ffpick=""><span class="pl-tn"><b>Clear this spot</b></span></button>` : "";
      const body = table
        ? `<div class="table-wrap pl-ffst"><table class="t"><thead><tr><th class="pl-stk">Player</th>${view === "proj" ? "" : `<th class="r"><button type="button" data-ffcol="g" aria-pressed="${sc === "g"}">G</button></th>`}${cols.map(([k, l]) => `<th class="r"><button type="button" data-ffcol="${k}" aria-pressed="${sc === k}">${l}${sc === k ? (dir < 0 ? " &darr;" : " &uarr;") : ""}</button></th>`).join("")}<th class="r"><button type="button" data-ffcol="fp" aria-pressed="${sc === "fp"}">FP${sc === "fp" ? (dir < 0 ? " &darr;" : " &uarr;") : ""}</button></th><th></th></tr></thead><tbody>
            ${list.map((p) => { const used = usedElsewhere.has(p.id); return `<tr class="${used ? "used" : ""}"><td class="pl-stk"><button type="button" class="pl-ffsn" data-ffpick="${esc(p.id)}"${used ? " disabled" : ""}>${ffPhoto(p, 26)}<span class="pl-tn"><b>${esc(p.n)}</b><small>${esc(p.pos)} &middot; ${opp(p)}${usedNote(p)}</small></span></button></td>${view === "proj" ? "" : `<td class="r num">${p.g || 0}</td>`}${cols.map(([k]) => `<td class="r num">${fmt1(ffStat(p, k, view), view)}</td>`).join("")}<td class="r num fp">${fmt1(ffVal(p, b, view), "pg")}</td><td><button type="button" class="pl-ffinfo" data-ffcard="${esc(p.id)}" aria-label="${esc(p.n)}: player card">i</button></td></tr>`; }).join("")}
            </tbody></table></div>`
        : `<div class="pl-fflist">${list.map((p) => { const used = usedElsewhere.has(p.id), v = ffVal(p, b, view); return `<div class="pl-ffi"><button type="button" class="pl-ffp${used ? " used" : ""}" data-ffpick="${esc(p.id)}"${used ? " disabled" : ""}>${ffPhoto(p, 30)}<span class="pl-tn"><b>${esc(p.n)}</b><small>${esc(p.pos)} &middot; ${opp(p)}${usedNote(p)}</small></span><span class="pl-ffpg">${v ? v.toFixed(1) : "&ndash;"}<small>${esc(VL[view])}</small></span></button><button type="button" class="pl-ffinfo" data-ffcard="${esc(p.id)}" aria-label="${esc(p.n)}: player card" title="Player card">i</button></div>`; }).join("")}</div>`;
      picker = `<div class="card pl-ffpick${table ? " wide" : ""}" role="dialog" aria-label="Pick your ${SLOT_NAME[st.ffslot]}"><div class="mod-h"><h2>Pick your ${SLOT_NAME[st.ffslot]}${st.ffslot === "FLEX" ? " <small class=\"ps\">RB, WR or TE</small>" : ""}</h2><span class="grow"></span><button type="button" class="btn sm ghost" data-ffslot="">Close</button></div>
        <div class="bd pl-ffbar"><input class="pl-ffq" type="search" data-ffq placeholder="Search players or a team" value="${esc(st.ffq || "")}" aria-label="Search players">
          <div class="pl-ffctl">${seg("data-ffstat", view, [["pg", "Per game"], ["tot", "Season"], ["proj", st.ffWeek ? `Proj wk ${st.ffWeek}` : "Projected"]])}${seg("data-ffview", table ? "table" : "list", [["list", "List"], ["table", "Stats"]])}</div>
          ${usedElsewhere.size ? `<label class="pl-ffhide"><input type="checkbox" data-ffhide${st.ffhide ? " checked" : ""}> Hide players I've used</label>` : ""}</div>
        ${clear}${list.length ? body : `<p class="ps" style="padding:0 14px 14px">No players left for this spot.</p>`}</div>`;
    }
    const total = row.rounds[r] && row.rounds[r].pts;
    const lineup = `<div class="card pl-fflu"><div class="mod-h"><h2>${RNAME[r]} lineup</h2><span class="grow"></span><span class="ps">${total != null ? `<b>${total}</b> points${locked ? "" : " so far"}` : locked ? "Locked" : proj ? "Projected matchups" : `Each player locks at his kickoff, from ${tipTime(lk)}`}</span></div>
      <div class="pl-ffslots">${P.FF_SLOTS.map(slotRow).join("")}</div>
      ${locked ? "" : `<div class="pl-save bd"><span class="ps">${Object.values(st.ffl).filter(Boolean).length} of 9 set. ${dirty ? "Not saved yet." : "Saved."}</span><button type="button" class="btn go" data-ffsave${dirty ? "" : " disabled"}>Save lineup</button></div>`}</div>`;
    const usedList = Object.keys(usedIn).length ? `<div class="card pl-ffused"><div class="mod-h"><h2>Already used</h2><span class="grow"></span><span class="ps">${Object.keys(usedIn).length} players, out for the rest of the playoffs</span></div><div class="bd">${[1, 2, 3, 4].filter((x) => x !== r && row.rounds[x] && row.rounds[x].set).map((x) => `<p class="pl-ffur"><b>${RNAME[x]}</b>${Object.values(row.rounds[x].lineup).map((id) => `<span class="pl-ffchip">${esc(pl(id).n)}</span>`).join("")}</p>`).join("")}</div></div>` : "";
    const projNote = proj ? `<div class="pl-note"><b>Projected Wild Card matchups.</b> These are the games if the season ended today: ${["AFC", "NFC"].map((cf) => { const by = {}; b.field.forEach((f) => { if (f.conf === cf) by[f.seed] = f.team; }); return `${cf} ${[[2, 7], [3, 6], [4, 5]].map(([x, y]) => `${by[y]} at ${by[x]}`).join(", ")}`; }).join("; ")}. Your lineup saves now. If a player's team falls out of the field by week 18, swap him out or he scores nothing.</div>` : "";
    document.body.classList.toggle("pl-sheet-on", !!picker);
    if (picker) picker = `<div class="pl-ffback" data-ffback aria-hidden="true"></div>` + picker;
    return tabs + projNote + `<div class="pl-ffwrap">${lineup}${picker || usedList || (locked ? "" : `<div class="pl-note"><b>Tap a spot to pick a player.</b> Anyone you start is gone for the rest of the playoffs, so check Plan ahead before spending a star from a team that should go deep.</div>`)}</div>` + ffPlan(b, r, row, pl) + (picker ? usedList : "") + `<p class="ps">Points are ${FF_SL[ffSi(b)]}, from Sleeper. "A game" is each player's regular-season average. Tap <b>i</b> for a player's card.</p>`;
  }
  /* Plan ahead: how far each team should go (the bracket simulated from point differential) next to the players you
     still have from it, so you can see whose stars to spend now and whose to save. */
  function ffPlan(b, r, row, pl) {
    const field = b.field || [];
    if (field.length < 14) return "";
    const key = (b.games || []).filter((g) => g.final).map((g) => g.w).join(",");
    if (!st.ffreach || st.ffreachKey !== key) { st.ffreach = P.reach(field, b.games, 4000); st.ffreachKey = key; }
    const R = st.ffreach, used = new Set(row.used);
    const cur = new Set(Object.values(st.ffl || {}).filter(Boolean));
    const byTeam = {}; Object.values(st.ffp || {}).forEach((p) => { if (p.ppg >= 4 || p.pos === "DEF") (byTeam[p.t] = byTeam[p.t] || []).push(p); });
    const rows = field.map((f) => {
      const x = R[f.team] || { p: [0, 0, 0, 0, 0] }, now = x.p[r - 1], later = x.p.slice(r, 4).reduce((a, v) => a + v, 0);
      return { f, x, now, later };
    }).filter((t) => t.now > 0 || t.later > 0).sort((a, c) => (c.now + c.later) - (a.now + a.later));
    // only this round on: the rounds played are settled. The last column is winning the Super Bowl.
    const cols = [1, 2, 3, 4, 5].filter((x) => x >= r), SHORT = { 1: "WC", 2: "Div", 3: "Conf", 4: "SB", 5: "Title" };
    const cell = (v) => { const pct = Math.round(v * 100); return `<td class="r pl-pc" style="--p:${v.toFixed(3)}">${pct >= 100 ? "&#10003;" : pct < 1 ? "" : pct + "%"}</td>`; };
    const going = (t) => { const k = ffKick(b, r, t); return k != null && Date.now() >= k; };
    const hint = (t) => t.now <= 0 ? `<span class="pl-hint later">Plays later</span>` : going(t.f.team) ? `<span class="pl-hint later">Kicked off</span>` : t.later < 0.45 ? `<span class="pl-hint now">Use now</span>` : t.later > 1.4 ? `<span class="pl-hint save">Worth saving</span>` : "";
    const chips = (t) => (byTeam[t] || []).sort((a, c) => c.ppg - a.ppg).slice(0, 4).map((p) => {
      const u = used.has(p.id) && !cur.has(p.id), on = cur.has(p.id);
      return `<span class="pl-pchip${u ? " used" : ""}${on ? " on" : ""}" title="${u ? "Already used" : on ? `In your ${RNAME[r]} lineup` : `${p.ppg.toFixed(1)} a game`}">${esc(p.pos)} ${esc(p.pos === "DEF" ? p.t : p.n.replace(/ (Jr\.?|Sr\.?|II|III|IV|V)$/, "").split(" ").slice(-1)[0])}</span>`;
    }).join("");
    return `<div class="card pl-plan"><div class="mod-h"><h2>Plan ahead</h2><span class="grow"></span><span class="ps">Chance each team plays in each round, and wins it all</span></div>
      <div class="table-wrap"><table class="t pl-pt"><thead><tr><th>Team</th>${cols.map((x) => `<th class="r${x === r ? " cur" : ""}">${SHORT[x]}</th>`).join("")}<th class="pl-pch">Your best players left</th></tr></thead><tbody>
      ${rows.map((t) => `<tr><td class="nm"><span class="pl-ptn">${nflLogo(t.f.team, 20)}<b>${esc(t.f.team)}</b><small class="ps">${t.f.seed}</small></span>${hint(t)}</td>${cols.map((x) => cell(t.x.p[x - 1])).join("")}<td class="pl-pcs">${chips(t.f.team)}</td></tr>
        <tr class="pl-pcr"><td colspan="${cols.length + 1}"><div class="pl-pcs">${chips(t.f.team)}</div></td></tr>`).join("")}
      </tbody></table></div>
      <p class="ps bd">Each game is simulated 4,000 times from the teams' regular-season point differential, with the better seed at home and the bracket reseeded. Struck players are used. "Use now": the team is unlikely to play past this round. "Worth saving": it should play more than one more game.</p></div>`;
  }
  function ffTable(b) {
    const F = P.nflff(b, st.ffs);
    return `<div class="card"><div class="table-wrap"><table class="t pl-st"><thead><tr><th class="r">#</th><th>Entry</th>${[1, 2, 3, 4].map((r) => `<th class="r" title="${RNAME[r]}">${["", "WC", "Div", "Conf", "SB"][r]}</th>`).join("")}<th class="r">Total</th></tr></thead><tbody>
      ${F.rows.map((r) => `<tr class="${r.me ? "me" : ""}"><td class="r num">${r.place}</td><td class="nm"><b>${esc(r.name)}</b></td>${[1, 2, 3, 4].map((x) => `<td class="r num ps">${r.rounds[x].pts != null ? r.rounds[x].pts : ""}</td>`).join("")}<td class="r num"><b>${r.total}</b></td></tr>`).join("")}
      </tbody></table></div></div><p class="ps">Each player shows to everyone at his kickoff. Points are ${FF_SL[ffSi(b)]}.</p>`;
  }

  // ---------- 5 teams ----------
  function fivePicks(b) {
    const F = P.five(b, Date.now()), uid = me(b), row = F.rows.find((r) => r.id === uid), field = P.field(b.games);
    if (!Object.keys(field).length) return `<div class="card"><div class="bd ps">The bracket isn't set yet.</div></div>`;
    const saved = row ? row.teams.map((t) => t.team).filter(Boolean) : [];
    if (st.sel == null) st.sel = saved.slice();
    if (F.locked) {
      return `<div class="card"><div class="mod-h"><h2>Your teams</h2><span class="grow"></span><span class="ps">Locked at ${tipTime(F.lock)}</span></div><div class="bd">${row && row.teams.length ? fiveChips(row.teams) : `<p class="ps" style="margin:0">You didn't make picks before the first round tipped off.</p>`}</div></div>`;
    }
    const chk = P.fiveCheck(b, st.sel), dirty = st.sel.slice().sort().join() !== saved.slice().sort().join();
    const byRegion = {};
    b.games.filter((g) => g.round <= 1).forEach((g) => [[g.a, g.as], [g.b, g.bs]].forEach(([t, s]) => { if (t && s != null) (byRegion[g.region || "Field"] = byRegion[g.region || "Field"] || {})[t] = s; }));
    const regions = Object.keys(byRegion);
    return `<div class="pl-five">
      <div class="card pl-bar"><div class="bd"><div class="pl-chips">${Array.from({ length: 5 }, (_, i) => st.sel[i] ? `<button type="button" class="pl-chip" data-five="${esc(st.sel[i])}" title="Take off">${logo(st.sel[i], 20)}${seedTag(field[st.sel[i]])}${name(st.sel[i])}<i aria-hidden="true">&times;</i></button>` : `<span class="pl-chip empty">Team ${i + 1}</span>`).join("")}</div>
        <div class="pl-meter ${chk.seeds >= P.MIN_SEEDS ? "ok" : ""}"><span>Seeds <b>${chk.seeds}</b> of ${P.MIN_SEEDS}</span><i style="--w:${Math.min(100, Math.round((chk.seeds / P.MIN_SEEDS) * 100))}%"></i></div>
        <div class="pl-save"><span class="ps">${chk.ok ? (dirty ? "Ready to save." : "Saved. You can change them until the first tip-off.") : esc(chk.why)} Locks ${tipTime(F.lock)}.</span><button type="button" class="btn go" data-save5${chk.ok && dirty ? "" : " disabled"}>Save my teams</button></div></div></div>
      <div class="pl-regions">${regions.map((rg) => `<div class="card"><div class="mod-h"><h2>${esc(rg)}</h2></div><div class="pl-field">${Object.entries(byRegion[rg]).sort((x, y) => x[1] - y[1] || String(team(x[0]).n).localeCompare(String(team(y[0]).n))).map(([t, s]) => {
        const on = st.sel.includes(t), xp = P.xPts(team(t));
        return `<button type="button" class="pl-team sm${on ? " on" : ""}" data-five="${esc(t)}"${!on && st.sel.length >= 5 ? " disabled" : ""}>${logo(t, 24)}<span class="pl-tn"><b>${seedTag(s)}${name(t)}</b>${team(t).conf ? `<small>${esc(team(t).conf)}</small>` : ""}</span>${xp != null ? `<span class="pl-xp" title="Expected points, from the college hub's tournament sim">${xp.toFixed(1)}<small>xPts</small></span>` : ""}</button>`;
      }).join("")}</div></div>`).join("")}</div></div>`;
  }
  const fiveChips = (teams) => `<div class="pl-chips">${teams.map((t) => t.hidden ? `<span class="pl-chip hid">Picked</span>` : `<span class="pl-chip ${t.alive ? "" : "out"}">${logo(t.team, 20)}${seedTag(t.seed)}${name(t.team)}<b>${t.pts}</b></span>`).join("")}</div>`;
  function fiveTable(b) {
    const F = P.five(b, Date.now());
    return `<div class="card"><div class="table-wrap"><table class="t pl-st"><thead><tr><th class="r">#</th><th>Entry</th><th class="r" title="Points">Pts</th><th class="r" title="Points still possible">Max</th><th class="r" title="Combined seeds: the first tiebreaker">Seeds</th><th class="pl-hide-s">Teams</th></tr></thead><tbody>
      ${F.rows.map((r) => `<tr class="${r.me ? "me" : ""}"><td class="r num">${F.locked ? r.place : ""}</td><td class="nm"><b>${esc(r.name)}</b>${!r.picked ? `<small class="ps"> no picks yet</small>` : ""}${r.teams.length ? `<div class="pl-only-s">${fiveChips(r.teams)}</div>` : ""}</td><td class="r num"><b>${r.points}</b></td><td class="r num ps">${F.locked ? r.max : ""}</td><td class="r num ps">${F.locked && r.picked ? r.seeds : ""}</td><td class="pl-hide-s">${r.teams.length ? fiveChips(r.teams) : ""}</td></tr>`).join("")}
      </tbody></table></div></div><p class="ps">${F.locked ? "Wins score 1, 2, 4, 8, 16, 32 by round. Max is what an entry could still reach if its teams keep winning. Ties go to higher seeds, then the deepest run." : `Everyone's teams show when the first round tips off (${tipTime(F.lock || Date.now())}).`}</p>`;
  }

  // ---------- scoreboards: the games that matter now, with who picked what ----------
  // a period picker (week, day, round or date) above a list of games; under each team, the entries who have it
  const segPick = (key, items, cur) => `<div class="seg pl-gsel" role="tablist">${items.map(([v, label, sub]) => `<button type="button" role="tab" data-gsel="${esc(key)}|${esc(v)}" aria-selected="${String(v) === String(cur)}"><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</button>`).join("")}</div>`;
  const gStatus = (g, t) => g.final ? `<span class="pl-gst fin">Final</span>` : Date.parse(t) <= Date.now() ? `<span class="pl-gst live">Live</span>` : `<span class="pl-gst">${esc(tipTime(t))}</span>`;
  function gameBlock(g, side) {
    // side(t) -> { logo, name, seed, score, win, who: [{ name, me, note }] }
    const row = (x) => `<div class="pl-gr${x.win ? " w" : x.lose ? " l" : ""}"><span class="pl-gt">${x.logo}<b>${x.seed != null ? seedTag(x.seed) : ""}${x.name}</b>${x.pct ? `<small class="pl-gpct" title="Share of the pool">${x.pct}%</small>` : ""}</span><span class="pl-gs num">${x.score != null ? x.score : ""}</span>
      <span class="pl-gw">${x.who.length ? x.who.map((w) => `<span class="pl-gchip${w.me ? " me" : ""}">${esc(w.name)}${w.note != null ? ` <small>${esc(w.note)}</small>` : ""}</span>`).join("") : ""}</span></div>`;
    return `<article class="pl-gm"><div class="pl-gh">${g.label ? `<span class="pl-gl">${esc(g.label)}</span>` : ""}${gStatus(g, g.when)}</div>${row(side(g.x))}${row(side(g.y))}${g.hidden ? `<p class="pl-ghid ps">${esc(g.hidden)}</p>` : ""}</article>`;
  }
  const gameList = (blocks, empty) => blocks.length ? `<div class="pl-gms">${blocks.join("")}</div>` : `<div class="pl-note">${empty}</div>`;
  const nameOf = (b, id) => { const m = b.members.find((x) => x.id === id); return m ? m.name : "Someone"; };
  const meId = (b) => (b.members.find((x) => x.me) || {}).id;
  function scoreboard(b) {
    const k = b.pool.kind, now = Date.now(), uid = meId(b);
    const who = (ids) => ids.map((x) => (typeof x === "string" ? { name: nameOf(b, x), me: x === uid } : { name: nameOf(b, x.id), me: x.id === uid, note: x.note }));
    // a side's share of the pool, once everyone's picks show (only your own before that, so no share yet)
    const pct = (ids, shown) => (shown && ids && ids.length ? Math.round((100 * ids.length) / Math.max(1, b.members.length)) : 0);
    if (k === "nfl") {
      const ws = P.nflWeeks(b.games);
      if (!ws.length) return `<div class="pl-note">No games yet.</div>`;
      const cur = st.gsel && st.gsel.k === "w" ? +st.gsel.v : (ws.find((w) => !w.done) || ws[ws.length - 1]).week;
      const wk = ws.find((w) => w.week === cur) || ws[0], by = {}; let hidden = 0;
      (b.picks || []).forEach((pk) => { if (pk.slot !== "w" + wk.week) return; if (pk.team == null) hidden++; else (by[pk.team] = by[pk.team] || []).push(pk.user); });
      const counts = Object.entries(by).sort((x, y) => y[1].length - x[1].length);
      const head = counts.length ? `<p class="pl-gsum">Most picked in week ${wk.week}: ${counts.slice(0, 3).map(([t, u]) => `<b>${nflName(t)}</b> ${Math.round((100 * u.length) / b.members.length)}%`).join(", ")}${hidden ? `. ${hidden} more ${hidden === 1 ? "pick shows" : "picks show"} at kickoff.` : "."}</p>` : hidden ? `<p class="pl-gsum">${hidden} ${hidden === 1 ? "pick is" : "picks are"} in. They show at kickoff.</p>` : "";
      const blocks = wk.games.map((g) => gameBlock({ x: "away", y: "home", when: g.kickoff, final: g.final }, (sd) => {
        const t = g[sd], sc = sd === "away" ? g.ap : g.hp, op = sd === "away" ? g.hp : g.ap, on = Date.parse(g.kickoff) <= now;
        return { logo: nflLogo(t, 22), name: nflName(t), score: on ? sc : null, win: g.final && sc > op, lose: g.final && sc < op, who: who(by[t] || []), pct: pct(by[t], on) };
      }));
      // games with picks first, then the rest in kickoff order
      const order = wk.games.map((g, i) => [i, (by[g.away] || []).length + (by[g.home] || []).length]).sort((x, y) => (y[1] > 0) - (x[1] > 0) || x[0] - y[0]).map(([i]) => blocks[i]);
      return segPick("w", ws.map((w) => [w.week, `Week ${w.week}`, w.done ? "Done" : ""]), wk.week) + head + gameList(order, "No games this week.");
    }
    if (k === "survivor" || k === "five") {
      const ds = P.days(b.games || []);
      if (!ds.length) return `<div class="pl-note">The games show up once the field is set on Selection Sunday.</div>`;
      const cur = st.gsel && st.gsel.k === "d" ? +st.gsel.v : (ds.find((d) => !d.done) || ds[ds.length - 1]).n;
      const d = ds.find((x) => x.n === cur) || ds[0], by = {}; let hidden = 0;
      (b.picks || []).forEach((pk) => {
        if (k === "survivor" ? pk.slot !== "d" + d.n : pk.slot[0] !== "f") return;
        if (pk.team == null) { if (k === "survivor") hidden++; return; }
        (by[pk.team] = by[pk.team] || []).push(pk.user);
      });
      const blocks = d.games.map((g) => gameBlock({ x: "a", y: "b", when: g.tip, final: g.final, label: g.region }, (sd) => {
        const t = g[sd], sc = sd === "a" ? g.ap : g.bp, on = Date.parse(g.tip) <= now;
        return { logo: logo(t, 22), name: name(t), seed: sd === "a" ? g.as : g.bs, score: on ? sc : null, win: g.final && g.w === t, lose: g.final && g.w && g.w !== t, who: who(by[t] || []),
          pct: pct(by[t], k === "survivor" ? on : b.games.some((x) => x.round === 1 && Date.parse(x.tip) <= now)) };
      }));
      if (k === "survivor" && hidden) blocks.unshift(`<p class="pl-gsum">${hidden} ${hidden === 1 ? "pick shows" : "picks show"} once its game tips off.</p>`);
      return segPick("d", ds.map((x) => [x.n, `Day ${x.n}`, dayName(x.day)]), d.n) + (k === "five" && !b.games.some((g) => g.round === 1 && Date.parse(g.tip) <= now) ? `<p class="pl-gsum">Everyone's five teams show once the first round tips off.</p>` : "") + gameList(blocks, "No games this day.");
    }
    if (k === "bowls") {
      const games = (b.games || []).filter((g) => g.a || g.b);
      if (!games.length) return `<div class="pl-note">The matchups are set on Sunday, Dec 6.</div>`;
      const days = [...new Set(games.map((g) => dayOf(g.kickoff)))];
      const next = games.find((g) => !g.final), cur = st.gsel && st.gsel.k === "b" ? st.gsel.v : next ? dayOf(next.kickoff) : days[days.length - 1];
      const blocks = games.filter((g) => dayOf(g.kickoff) === cur).map((g) => {
        const by = {};
        (b.picks || []).forEach((pk) => { if (pk.slot !== "g" + g.id || !pk.team) return; (by[pk.team] = by[pk.team] || []).push({ id: pk.user, note: pk.pts }); });
        return gameBlock({ x: "a", y: "b", when: g.kickoff, final: g.final, label: g.label, hidden: Date.parse(g.kickoff) > now && b.members.length > 1 ? "Everyone else's picks show at kickoff" : "" }, (sd) => {
          const t = g[sd], sc = sd === "a" ? g.ap : g.bp, on = Date.parse(g.kickoff) <= now;
          return { logo: cfbLogo(t, 22), name: cfbName(t, sd === "a" ? g.an : g.bn), score: on ? sc : null, win: g.final && g.w === t, lose: g.final && g.w && g.w !== t, who: who(by[t] || []), pct: pct(by[t], on) };
        });
      });
      return segPick("b", days.map((d) => [d, d.replace(/^\w+, /, ""), d.split(",")[0]]), cur) + `<p class="pl-gsum">Each name shows its confidence number. Picks show at each game's kickoff.</p>` + gameList(blocks, "No games that day.");
    }
    if (k === "nflpo") {
      const rounds = [1, 2, 3, 4], lk = b.lock && now >= Date.parse(b.lock);
      const cur = st.gsel && st.gsel.k === "r" ? +st.gsel.v : rounds.find((r) => (b.games || []).some((g) => g.round === r && g.a && g.b && !g.final)) || 1;
      const roundOf = (slot) => (slot === "sb" ? 4 : /cf$/.test(slot) ? 3 : /dv/.test(slot) ? 2 : 1);
      const by = {}; (b.picks || []).forEach((pk) => { if (pk.slot === "tb" || !pk.team || roundOf(pk.slot) !== cur) return; (by[pk.team] = by[pk.team] || []).push(pk.user); });
      const gs = (b.games || []).filter((g) => g.round === cur && g.a && g.b);
      const blocks = gs.map((g) => gameBlock({ x: "a", y: "b", when: g.kickoff, final: g.final, label: g.label }, (sd) => {
        const t = g[sd], sc = sd === "a" ? g.ap : g.bp, on = Date.parse(g.kickoff) <= now;
        return { logo: nflLogo(t, 22), name: nflName(t), score: on ? sc : null, win: g.final && g.w === t, lose: g.final && g.w && g.w !== t, who: who(lk ? by[t] || [] : (by[t] || []).filter((u) => u === uid)), pct: pct(by[t], lk) };
      }));
      return segPick("r", rounds.map((r) => [r, RNAME[r]]), cur) + `<p class="pl-gsum">${lk ? "Under each team: who has it winning this round." : "Everyone's brackets show once the Wild Card round kicks off. For now you see your own."}</p>` + gameList(blocks, "This round's games aren't set yet.");
    }
    if (k === "nflff") return ffLineups(b);
    return "";
  }
  // everyone's playoff fantasy lineup for a round, with each player's points; others' players show at their kickoff
  function ffLineups(b) {
    const F = P.nflff(b, st.ffs), pl = (id) => (st.ffp && st.ffp[id]) || { id, n: id, t: "", pos: "" }, now = Date.now(), n = b.members.length;
    const view = st.luview || String(ffRound(b));
    // one bar: each round, then everything to date
    const bar = `<div class="seg pl-gsel" role="tablist">${[1, 2, 3, 4].map((r) => { const set = Object.keys(ffTeams(b, r)).length; return `<button type="button" role="tab" data-luview="${r}" aria-selected="${view === String(r)}"><b>${RNAME[r]}</b><small>${!set ? "Not set" : (b.games || []).filter((g) => g.round === r && g.a).every((g) => g.final) && (b.games || []).some((g) => g.round === r && g.a) ? "Final" : ffLock(b, r) && now >= ffLock(b, r) ? "In progress" : "Open"}</small></button>`; }).join("")}<button type="button" role="tab" data-luview="all" aria-selected="${view === "all"}"><b>To date</b><small>All rounds</small></button></div>`;
    // a player's game in a round: his team's logo, the opponent, and whether it's to play, live or final
    const gameOf = (r, t) => (b.games || []).find((g) => g.round === r && (g.a === t || g.b === t));
    const ply = (r, sl, id, R, own) => {
      const p = pl(id), g = gameOf(r, p.t), opp = g ? (g.a === p.t ? g.b : g.a) : ffTeams(b, r)[p.t];
      const on = g && Date.parse(g.kickoff) <= now, fin = g && g.final, pts = R.each && R.each[sl];
      const stt = fin ? "Final" : on ? "Live" : g && !(r === 1 && ffProj(b)) ? tipTime(g.kickoff) : "";
      return `<li class="${fin ? "fin" : on ? "live" : "todo"}"><span class="pl-ffpos">${SLOT_NAME[sl]}</span>${ffPhoto(p, 28)}
        <span class="pl-lun">${st.ffraw && st.ffraw[id] ? `<button type="button" class="pl-lunb" data-ffcard="${esc(id)}">${esc(p.n)}</button>` : esc(p.n)}
          <small class="pl-lut">${p.t ? nflLogo(p.t, 14) : ""}<b>${esc(p.t)}</b>${opp ? ` ${g && g.b === p.t ? "vs" : "at"} ${esc(opp)}` : ""}${stt ? ` &middot; <span class="st">${esc(stt)}</span>` : ""}${own != null ? ` &middot; ${own}% started` : ""}</small></span>
        <span class="num pl-lup">${pts != null ? pts : ""}</span></li>`;
    };
    const left = (r, R) => Object.values(R.lineup || {}).filter((id) => { const g = gameOf(r, pl(id).t); return !g || Date.parse(g.kickoff) > now; }).length;
    if (view === "all") {
      const owns = { 1: ffOwn(F, 1, n, b), 2: ffOwn(F, 2, n, b), 3: ffOwn(F, 3, n, b), 4: ffOwn(F, 4, n, b) };
      const cards = F.rows.map((r) => {
        const rs = [1, 2, 3, 4].filter((x) => Object.keys((r.rounds[x] || {}).lineup || {}).length);
        return `<article class="pl-lu${r.me ? " me" : ""}"><div class="pl-luh"><b>${esc(r.name)}</b><span class="num">${r.total} pts</span></div>
          ${rs.length ? rs.map((x) => { const R = r.rounds[x]; return `<div class="pl-lur"><span>${RNAME[x]}</span><span class="num">${R.pts != null ? R.pts : ""}</span></div><ul>${P.FF_SLOTS.filter((sl) => R.lineup[sl]).map((sl) => ply(x, sl, R.lineup[sl], R, owns[x][R.lineup[sl]])).join("")}</ul>`; }).join("") : `<p class="ps" style="margin:0">${r.me ? "No lineups yet." : "Lineups show at kickoff."}</p>`}</article>`;
      });
      return bar + `<p class="pl-gsum">Every round so far, ${FF_SL[ffSi(b)]}. Others' players show once their games kick off.</p><div class="pl-lus">${cards.join("")}</div>`;
    }
    const cur = +view, own = ffOwn(F, cur, n, b);
    const rows = F.rows.slice().sort((x, y) => ((y.rounds[cur] || {}).pts || 0) - ((x.rounds[cur] || {}).pts || 0) || (y.me - x.me));
    const meRow = F.rows.find((r) => r.me);
    // compare your lineup with someone else's, slot by slot: who you share, and who's only on one side
    const vs = st.luvs && F.rows.find((r) => r.id === st.luvs && !r.me);
    const compare = meRow && n > 1 ? `<label class="pl-luvs">Compare with<select data-luvs><option value="">Nobody</option>${F.rows.filter((r) => !r.me).map((r) => `<option value="${esc(r.id)}"${vs && vs.id === r.id ? " selected" : ""}>${esc(r.name)}</option>`).join("")}</select></label>` : "";
    let body;
    if (vs) {
      const A = meRow.rounds[cur] || { lineup: {}, each: {} }, B = vs.rounds[cur] || { lineup: {}, each: {} };
      const Bids = new Set(Object.values(B.lineup)), Aids = new Set(Object.values(A.lineup));
      const side = (R, other) => P.FF_SLOTS.map((sl) => R.lineup[sl] ? ply(cur, sl, R.lineup[sl], R, own[R.lineup[sl]]).replace("<li class=\"", `<li class="${other.has(R.lineup[sl]) ? "both " : "only "}`) : `<li class="emp"><span class="pl-ffpos">${SLOT_NAME[sl]}</span><span class="ps">${R === A || !(b.games || []).some((g) => g.round === cur && g.a && Date.parse(g.kickoff) > now) ? "Empty" : "Hidden until kickoff"}</span></li>`).join("");
      const shared = [...Aids].filter((x) => Bids.has(x)).length, diff = Math.round(((A.pts || 0) - (B.pts || 0)) * 100) / 100;
      body = `<p class="pl-gsum">${shared} ${shared === 1 ? "player" : "players"} in common.${A.pts != null || B.pts != null ? ` You're ${diff >= 0 ? "up" : "down"} ${Math.abs(diff)}.` : ""} Shared players are faded, so the difference stands out.</p>
        <div class="pl-luc"><article class="pl-lu me"><div class="pl-luh"><b>${esc(meRow.name)}</b><span class="num">${A.pts != null ? A.pts + " pts" : ""}</span></div><ul>${side(A, Bids)}</ul></article>
        <article class="pl-lu"><div class="pl-luh"><b>${esc(vs.name)}</b><span class="num">${B.pts != null ? B.pts + " pts" : ""}</span></div><ul>${side(B, Aids)}</ul></article></div>`;
    } else {
      const cards = rows.map((r) => {
        const R = r.rounds[cur] || { lineup: {}, each: {} }, cnt = Object.keys(R.lineup).length, yet = left(cur, R);
        return `<article class="pl-lu${r.me ? " me" : ""}"><div class="pl-luh"><b>${esc(r.name)}</b><span class="num">${!cnt ? (r.me ? "Not set" : "Shows at kickoff") : R.pts != null ? `${R.pts} pts` : `${cnt} of 9 set`}</span></div>
          ${cnt ? `${yet && R.pts != null ? `<p class="pl-luy ps">${yet} still to play</p>` : ""}<ul>${P.FF_SLOTS.filter((sl) => R.lineup[sl]).map((sl) => ply(cur, sl, R.lineup[sl], R, own[R.lineup[sl]])).join("")}</ul>` : ""}</article>`;
      });
      body = `<div class="pl-lus">${cards.join("")}</div>`;
    }
    const top = Object.entries(own).sort((x, y) => y[1] - x[1]).slice(0, 6);
    const ownStrip = top.length && !vs ? `<div class="pl-owns"><b>Most started</b>${top.map(([id, v]) => `<span class="pl-gchip">${st.ffraw && st.ffraw[id] ? `<button type="button" class="pl-lunb" data-ffcard="${esc(id)}">${esc(pl(id).n)}</button>` : esc(pl(id).n)} <small>${v}%</small></span>`).join("")}</div>` : "";
    return bar + `<div class="pl-lubar"><p class="pl-gsum">Each player shows once his game kicks off, with the share of entries that started him. ${FF_SL[ffSi(b)]}.</p>${compare}</div>` + ownStrip + body;
  }


  // ---------- Super Bowl squares ----------
  const initials = (nm) => { const w = String(nm || "").trim().split(/\s+/); return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : w[0].slice(0, 3)).toUpperCase(); };
  const PSHORT = ["Q1", "Half", "Q3", "Final"];
  const money = (v) => v == null ? "" : `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
  function sqScore(b, S) {
    const g = S.game;
    if (!g || !g.a || !g.b) return `<div class="pl-sqsb wait"><b>Super Bowl LXI</b><span class="ps">${shortDate(CAL.superBowl)}. The teams fill in after the conference championships.</span></div>`;
    const started = Date.parse(g.kickoff) <= Date.now(), L = g.lines || {};
    const line = (t) => { const ls = (t === g.a ? L.a : L.b) || []; const tot = t === g.a ? g.ap : g.bp; return `<tr><td class="nm">${nflLogo(t, 22)}<b>${nflName(t)}</b></td>${[0, 1, 2, 3].map((i) => `<td class="r num">${ls[i] != null ? ls[i] : ""}</td>`).join("")}${ls.length > 4 ? `<td class="r num">${ls.slice(4).reduce((a, v) => a + v, 0)}</td>` : ""}<td class="r num tot">${started && tot != null ? tot : ""}</td></tr>`; };
    return `<div class="card pl-sqsb"><div class="table-wrap"><table class="t"><thead><tr><th>${g.final ? "Final" : started ? "Live" : esc(tipTime(g.kickoff))}</th>${["1", "2", "3", "4"].map((q) => `<th class="r">${q}</th>`).join("")}${(L.a || []).length > 4 ? `<th class="r">OT</th>` : ""}<th class="r">T</th></tr></thead>
      <tbody>${line(S.top || g.a)}${line(S.side || g.b)}</tbody></table></div>${started && !g.final ? `<p class="ps bd">Scores update about every 10 minutes.</p>` : ""}</div>`;
  }
  function sqPicks(b) {
    const S = P.squares(b, Date.now()), owner = b.pool.owner, open = !S.locked;
    const won = {}; S.periods.forEach((x) => { if (x.sq != null) (won[x.sq] = won[x.sq] || []).push(PSHORT[x.k]); });
    const topName = S.top ? nflName(S.top) : "AFC", sideName = S.side ? nflName(S.side) : "NFC";
    const dig = (arr, i) => (arr ? arr[i] : "?");
    let grid = `<div class="pl-sqg" style="--top:${S.top ? "var(--ink)" : "var(--muted)"}">
      <div class="pl-sqtop">${S.top ? nflLogo(S.top, 20) : ""}<b>${topName}</b></div><div class="pl-sqside"><b>${sideName}</b>${S.side ? nflLogo(S.side, 20) : ""}</div>
      <div class="pl-sqcells"><span class="pl-sqc corner"></span>${[...Array(10)].map((_, c) => `<span class="pl-sqc hd">${dig(S.nums && S.nums.c, c)}</span>`).join("")}`;
    for (let r = 0; r < 10; r++) {
      grid += `<span class="pl-sqc hd">${dig(S.nums && S.nums.r, r)}</span>`;
      for (let c = 0; c < 10; c++) {
        const n = r * 10 + c, x = S.cells[n], w = won[n], lv = S.live && S.live.sq === n;
        const can = open && (!x || x.mine || owner);
        const cls = ["pl-sq", x ? (x.mine ? "mine" : x.guest ? "guest" : "taken") : "empty", w ? "won" : "", lv ? "live" : ""].filter(Boolean).join(" ");
        const title = x ? `${x.name}${w ? `, won ${w.join(" and ")}` : ""}` : open ? "Open: tap to claim" : "Nobody";
        grid += `<button type="button" class="${cls}" data-sq="${n}"${can ? "" : " disabled"} title="${esc(title)}" aria-label="Square ${dig(S.nums && S.nums.r, r)}-${dig(S.nums && S.nums.c, c)}: ${esc(title)}">${x ? `<span class="i">${esc(initials(x.name))}</span><span class="f">${esc(x.name)}</span>` : open ? `<span class="plus">+</span>` : ""}${w ? `<em>${w.join(" ")}</em>` : ""}</button>`;
      }
    }
    grid += `</div></div>`;
    const left = S.cap - S.mine;
    const status = open
      ? `<p class="pl-sqst"><b>${S.mine ? `You have ${S.mine} of ${S.cap} squares.` : `Tap open squares to claim them, up to ${S.cap}.`}</b> ${S.claimed} of 100 taken. ${owner ? "Draw the numbers when the board is full, or they're drawn half an hour before kickoff." : "The numbers are drawn once the board fills, or half an hour before kickoff."}</p>`
      : `<p class="pl-sqst"><b>The numbers are drawn${b.pool.extra && b.pool.extra.auto ? " (automatically)" : ""}.</b> ${S.mine ? `You have ${S.mine} ${S.mine === 1 ? "square" : "squares"}.` : ""} ${S.top ? `${nflName(S.top)} digits run across the top, ${nflName(S.side)} down the side.` : "AFC digits run across the top, NFC down the side."}</p>`;
    const pays = `<ul class="pl-sqpay">${S.pay.map((v, k) => { const x = S.periods.find((y) => y.k === k); return `<li class="${x ? "done" : ""}"><span>${SQ(k)}</span><b>${v}%${S.pot != null ? ` <small>${money(Math.round(S.pot * v) / 100)}</small>` : ""}</b><span class="who">${x ? (x.cell ? `${esc(x.cell.name)} <small class="ps">${x.top}-${x.side}</small>` : `<span class="ps">Empty square (${x.top}-${x.side})</span>`) : S.live && k === S.periods.length ? `<span class="ps">Now: ${S.cells[S.live.sq] ? esc(S.cells[S.live.sq].name) : "empty square"}</span>` : ""}</span></li>`; }).join("")}</ul>`;
    const potLine = S.price ? `<p class="ps">${money(S.price)} a square, ${money(S.pot)} in the pot so far. The site doesn't handle money.</p>` : "";
    const ownerBox = owner && open ? `<details class="pl-sqown"${st.sqOwn ? " open" : ""}><summary>Owner tools</summary>
        <label class="pl-sqname">Put a name on squares <input data-sqname maxlength="24" placeholder="Uncle Joe" value="${esc(st.sqName || "")}"></label>
        <p class="ps">${st.sqName ? `Tapping open squares now puts <b>${esc(st.sqName)}</b> on them. Clear the name to claim for yourself.` : "Type a name, then tap open squares to give them to someone without an account."}</p>
        <p class="ps">Limit, price and shares are in Settings.</p>
        <button type="button" class="btn sm${st.sqDraw ? " go" : ""}" data-sqdraw>${st.sqDraw ? "Tap again to draw. The board locks" : "Draw the numbers now"}</button></details>` : "";
    return `${sqScore(b, S)}<div class="pl-sqwrap"><div class="card pl-sqcard"><div class="bd">${grid}</div></div>
      <div class="pl-sqside-col"><div class="card"><div class="bd">${status}${pays}${potLine}</div></div>${ownerBox}</div></div>`;
  }
  const SQ = (k) => P.SQ_PERIODS[k];
  const sqSettings = (S) => `<form id="pl-sqset" class="pl-sqset"><h3>Squares</h3><label>Most squares per person<input name="cap" type="number" min="1" max="100" value="${S.cap}"></label>
      <label>Price per square <small class="ps">optional, just to show the pot</small><input name="price" type="number" min="0" step="0.5" value="${S.price != null ? S.price : ""}" placeholder="$"></label>
      <fieldset><legend>Shares (%)</legend>${S.pay.map((v, k) => `<label>${PSHORT[k]}<input name="pay${k}" type="number" min="0" max="100" value="${v}"></label>`).join("")}</fieldset>
      <button class="btn sm">Save squares settings</button></form>`;
  function sqTable(b) {
    const S = P.squares(b, Date.now());
    if (!S.people.length) return `<div class="pl-note"><b>No squares claimed yet.</b> Share the invite link and the board fills up.</div>`;
    return `<div class="card"><div class="table-wrap"><table class="t pl-st"><thead><tr><th>Name</th><th class="r">Squares</th><th>Won</th>${S.pot != null ? `<th class="r">Share</th>` : ""}</tr></thead><tbody>
      ${S.people.map((x) => `<tr class="${x.mine ? "me" : ""}"><td class="nm"><b>${esc(x.name)}</b></td><td class="r num">${x.squares}</td><td>${x.wins.length ? x.wins.map((w) => `<span class="tag win">${esc(w)}</span>`).join(" ") : `<span class="ps">${S.periods.length ? "Not yet" : ""}</span>`}</td>${S.pot != null ? `<td class="r num">${x.amount ? money(x.amount) : ""}</td>` : ""}</tr>`).join("")}
      </tbody></table></div></div><p class="ps">${S.claimed} of 100 squares taken.${S.pot != null ? ` ${money(S.pot)} in the pot: ${S.pay.map((v, k) => `${PSHORT[k]} ${v}%`).join(", ")}.` : ""}</p>`;
  }

  // ---------- render and events ----------
  async function render() {
    document.body.classList.remove("pl-sheet-on");
    themeBtn();
    if (st.code) await pool(); else await home();
  }
  app.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-tab],[data-day],[data-week],[data-pick],[data-unpick],[data-npick],[data-nunpick],[data-five],[data-save5],[data-copy],[data-make],[data-panel],[data-bteam],[data-bauto],[data-bsave],[data-kb],[data-ksave],[data-ffr],[data-ffslot],[data-ffpick],[data-ffsave],[data-sq],[data-sqdraw],[data-invite],[data-gsel],[data-leave],[data-rm],[data-ffcard],[data-luview],[data-champrm],[data-xferb],[data-as],[data-asdone],[data-planall],[data-ffstat],[data-ffview],[data-ffcol],[data-ffback]");
    if (!t || t.disabled) return;
    st.msg = "";
    if (t.dataset.tab) { st.tab = t.dataset.tab; return render(); }
    if (t.dataset.day) { const n = +t.dataset.day; st.open[n] = t.getAttribute("aria-expanded") !== "true"; return render(); }
    if (t.dataset.week) { st.open["w" + t.dataset.week] = t.getAttribute("aria-expanded") !== "true"; return render(); }
    if (t.dataset.panel) { st.panel = st.panel === t.dataset.panel ? "" : t.dataset.panel; return render(); }
    if (t.dataset.make) {
      st.make = t.dataset.make;
      if (!st.user) { const f = document.querySelector(".pl-signin"); if (f) f.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      st.panel = "make"; await render();
      const f = document.getElementById("pl-new");
      if (f) { f.scrollIntoView({ behavior: "smooth", block: "start" }); const n = f.querySelector("input[name=name]"); if (n) n.focus({ preventScroll: true }); }
      return;
    }
    if (t.dataset.ffcard) { ffCard(t.dataset.ffcard, st.board); return; }
    if (t.dataset.ffstat) { st.ffstat = t.dataset.ffstat; return render(); }
    if (t.dataset.ffview) { st.ffview = t.dataset.ffview; return render(); }
    if (t.dataset.ffcol) { if (st.ffsortcol === t.dataset.ffcol) st.ffsortdir = -(st.ffsortdir || -1); else { st.ffsortcol = t.dataset.ffcol; st.ffsortdir = t.dataset.ffcol === "pass_int" || t.dataset.ffcol === "pts_allow" ? 1 : -1; } return render(); }
    if (t.hasAttribute("data-ffback")) { st.ffslot = null; return render(); }
    if (t.hasAttribute("data-planall")) { st.planAll = !st.planAll; return render(); }
    if (t.dataset.as) { st.as = t.dataset.as; st.tab = "picks"; ["ffl", "ffr", "bd", "kb", "sel", "ffreach"].forEach((k) => { st[k] = null; }); await load(); window.scrollTo(0, 0); return render(); }
    if (t.hasAttribute("data-asdone")) { st.as = null; st.tab = "settings"; ["ffl", "ffr", "bd", "kb", "sel", "ffreach"].forEach((k) => { st[k] = null; }); await load(); return render(); }
    if (t.hasAttribute("data-xferb") && !st.xferArm) { st.xferArm = true; return render(); }
    if (t.dataset.luview) { st.luview = t.dataset.luview; return render(); }
    if (t.hasAttribute("data-leave") && !st.leave) { st.leave = true; return render(); }
    if (t.dataset.rm && st.rm !== t.dataset.rm) { st.rm = t.dataset.rm; return render(); }
    if (t.dataset.gsel) { const [k2, v2] = t.dataset.gsel.split("|"); st.gsel = { k: k2, v: v2 }; return render(); }
    if (t.hasAttribute("data-invite")) { st.invite = !st.invite; return render(); }
    if (t.dataset.copy && (t.hasAttribute("data-sheet") || (canShare() && !t.hasAttribute("data-nosheet")))) { navigator.share({ title: t.dataset.shareTitle, text: t.dataset.shareText, url: t.dataset.copy }).catch(() => {}); return; }
    if (t.dataset.copy) { try { await navigator.clipboard.writeText(t.dataset.copy); t.textContent = "Copied"; } catch (x) { prompt("Copy this invite link:", t.dataset.copy); } return; }
    if (t.dataset.bteam) { const [gid, tm] = t.dataset.bteam.split("|"); const k = st.bd[gid] = st.bd[gid] || {}; k.team = k.team === tm ? "" : tm; return render(); }
    if (t.hasAttribute("data-bauto")) { st.bd = P.autoRank(st.board.games, st.bd, cfbProb); st.msg = "Numbered: your surest picks carry the most. Save to keep it."; return render(); }
    if (t.dataset.ffr) { st.ffr = +t.dataset.ffr; st.ffl = null; return render(); }
    if (t.dataset.ffslot != null) { st.ffslot = t.dataset.ffslot && st.ffslot !== t.dataset.ffslot ? t.dataset.ffslot : null; st.ffq = ""; return render(); }
    if (t.dataset.ffpick != null) { st.ffl[st.ffslot] = t.dataset.ffpick || undefined; if (!t.dataset.ffpick) delete st.ffl[st.ffslot]; const nx = P.FF_SLOTS.find((x) => !st.ffl[x]);
      // on a phone the sheet closes after each pick, so the lineup (and its Save button) is right there
      const phone = matchMedia("(max-width: 760px)").matches;
      st.ffslot = t.dataset.ffpick && nx && !phone ? nx : null; st.ffq = "";
      if (phone && t.dataset.ffpick) st.msg = `${((st.ffp || {})[t.dataset.ffpick] || {}).n || "Player"} added. ${nx ? "Tap the next spot, or save." : "Lineup full: save it."}`;
      return render(); }
    if (t.dataset.kb) { const [slot, tm] = t.dataset.kb.split("|"); st.kb[slot] = tm; st.kb = P.bracketPicks(st.board.field, st.kb); return render(); }
    if (t.hasAttribute("data-sqdraw") && !st.sqDraw) { st.sqDraw = true; st.sqOwn = true; return render(); }
    if (t.dataset.five) {
      const id = t.dataset.five, i = st.sel.indexOf(id);
      if (i >= 0) st.sel.splice(i, 1); else if (st.sel.length < 5) st.sel.push(id);
      return render();
    }
    try {
      if (t.dataset.pick) { const [d, tm] = t.dataset.pick.split("|"); ok(await srpc("mm_pick", { p_pool: st.code, p_day: +d, p_team: tm })); st.msg = `Day ${d}: ${team(tm).n}.`; }
      else if (t.dataset.npick) { const [w, tm] = t.dataset.npick.split("|"); ok(await srpc("mm_pick_nfl", { p_pool: st.code, p_week: +w, p_team: tm })); st.msg = `Week ${w}: ${(NFL[tm] || [tm, tm])[1]}.`; }
      else if (t.dataset.nunpick) { ok(await srpc("mm_pick_nfl", { p_pool: st.code, p_week: +t.dataset.nunpick, p_team: null })); st.msg = "Pick taken back."; }
      else if (t.dataset.unpick) { ok(await srpc("mm_pick", { p_pool: st.code, p_day: +t.dataset.unpick, p_team: null })); st.msg = "Pick taken back."; }
      else if (t.hasAttribute("data-bsave")) {
        const picks = Object.entries(st.bd).filter(([, k]) => k.team || k.pts).map(([game, k]) => ({ game, team: k.team || "", pts: k.pts || null }));
        const r = ok(await srpc("mm_save_bowls", { p_pool: st.code, p_picks: picks, p_tb: st.btb === "" || st.btb == null ? null : +st.btb }));
        st.msg = `Saved ${r.saved} ${r.saved === 1 ? "game" : "games"}.`; st.bd = null; await load();
      }
      else if (t.hasAttribute("data-ffsave")) {
        const lu = {}; P.FF_SLOTS.forEach((x) => { if (st.ffl[x]) lu[x] = `${st.ffl[x]}@${((st.ffp || {})[st.ffl[x]] || {}).t || ""}`; });
        ok(await srpc("mm_save_nflff", { p_pool: st.code, p_round: st.ffr, p_lineup: lu }));
        st.msg = `${RNAME[st.ffr]} lineup saved.`; st.ffl = null; await load();
      }
      else if (t.hasAttribute("data-ksave")) {
        ok(await srpc("mm_save_nflpo", { p_pool: st.code, p_picks: P.bracketPicks(st.board.field, st.kb), p_tb: st.ktb === "" || st.ktb == null ? null : +st.ktb }));
        st.msg = "Bracket saved."; st.kb = null; await load();
      }
      else if (t.dataset.sq != null) {
        const n = +t.dataset.sq, x = P.squares(st.board).cells[n], nm = (st.sqName || "").trim();
        if (x && (x.mine || (st.board.pool.owner && (x.guest || !nm)))) ok(await C.rpc("mm_squares_claim", { p_pool: st.code, p_sq: n, p_on: false }));
        else if (!x) ok(await C.rpc("mm_squares_claim", { p_pool: st.code, p_sq: n, p_on: true, p_name: nm || null }));
        else { st.msg = `${x.name} has that square.`; return render(); }
        await load();
      }
      else if (t.dataset.champrm != null) { const c = ((st.board.pool.extra || {}).champs || []).filter((_, i) => i !== +t.dataset.champrm); ok(await C.rpc("mm_pool_extra", { p_pool: st.code, p_set: { champs: c } })); await load(); }
      else if (t.hasAttribute("data-xferb")) { ok(await C.rpc("mm_pool_transfer", { p_pool: st.code, p_user: st.xfer })); st.xferArm = false; st.xfer = null; st.msg = "Done. They own the pool now."; await load(); }
      else if (t.hasAttribute("data-leave")) { ok(await C.rpc("mm_pool_leave", { p_code: st.code })); location.href = "/fantasy/pools/"; return; }
      else if (t.dataset.rm) { ok(await C.rpc("mm_member_remove", { p_pool: st.code, p_user: t.dataset.rm })); st.rm = null; st.msg = "Removed."; await load(); }
      else if (t.hasAttribute("data-sqdraw")) { st.sqDraw = false; ok(await C.rpc("mm_squares_draw", { p_pool: st.code })); st.msg = "Numbers drawn. Good luck."; await load(); }
      else if (t.hasAttribute("data-save5")) { const r = ok(await srpc("mm_pick_five", { p_pool: st.code, p_teams: st.sel })); st.msg = `Saved: seeds add up to ${r.seeds}.`; st.sel = null; }
      render();
    } catch (x) { fail(x); }
  });
  app.addEventListener("change", (e) => {
    const t = e.target;
    if (t.hasAttribute("data-ffhide")) { st.ffhide = t.checked; render(); return; }
    if (t.hasAttribute("data-ffsort")) { st.ffsort = t.value; render(); return; }
    if (t.hasAttribute("data-luvs")) { st.luvs = t.value || null; render(); return; }
    if (t.hasAttribute("data-recap")) { const on = t.checked; C.rpc("mm_recap_set", { p_pool: st.code, p_on: on }).then(ok).then(() => { st.recap = on; st.msg = on ? "Weekly recap on. It comes Tuesday mornings." : "Weekly recap off."; render(); }).catch((e) => { t.checked = !on; fail(e); }); return; }
    if (t.hasAttribute("data-xfer")) { st.xfer = t.value || null; st.xferArm = false; render(); return; }
    if (t.hasAttribute("data-paid")) { const on = t.checked; C.rpc("mm_member_paid", { p_pool: st.code, p_user: t.dataset.paid, p_paid: on }).then(ok).then(load).then(render).catch((e) => { t.checked = !on; fail(e); }); return; }
    if (t.hasAttribute("data-closed")) { const on = t.checked; C.rpc("mm_pool_extra", { p_pool: st.code, p_set: { closed: on } }).then(ok).then(() => { st.msg = on ? "Closed to new entries." : "Open to new entries."; return load(); }).then(render).catch((e) => { t.checked = !on; fail(e); }); return; }
    if (t.hasAttribute("data-sqname")) { st.sqName = t.value.trim(); st.sqOwn = true; render(); return; }
    if (t.hasAttribute("data-remind")) {
      const on = t.checked;
      C.rpc("mm_remind_set", { p_pool: st.code, p_on: on }).then(ok).then(() => { st.remind = on; st.msg = on ? "Reminders on. You'll get an email about 3 hours before a pick is due, if it isn't in." : "Reminders off."; render(); }).catch((e) => { t.checked = !on; fail(e); });
      return;
    }
    if (t.dataset.bpts != null) {
      // a number already on another open game trades places with this one
      const gid = t.dataset.bpts, v = t.value ? +t.value : null, k = st.bd[gid] = st.bd[gid] || {}, old = k.pts || null;
      if (v) Object.entries(st.bd).forEach(([id, o]) => { if (id !== gid && o.pts === v) { const g = (st.board.games || []).find((x) => x.id === id); if (g && Date.now() < Date.parse(g.kickoff)) o.pts = old; } });
      k.pts = v; st.msg = ""; render();
    }
  });
  app.addEventListener("input", (e) => {
    const t = e.target;
    if (t.hasAttribute("data-btb")) { st.btb = t.value; const b = document.querySelector("[data-bsave]"); if (b) b.disabled = !P.bowlsCheck(st.bd, (st.board.games || []).length).ok; }
    if (t.hasAttribute("data-ffq")) {
      // filter the player list in place, so typing keeps the keyboard up
      st.ffq = t.value; const q = t.value.toLowerCase();
      document.querySelectorAll(".pl-ffp[data-ffpick], .pl-ffsn[data-ffpick]").forEach((el) => { if (!el.dataset.ffpick) return; (el.closest(".pl-ffi") || el.closest("tr") || el).hidden = !!q && !el.textContent.toLowerCase().includes(q); });
    }
    if (t.hasAttribute("data-ktb")) { st.ktb = t.value; const b = document.querySelector("[data-ksave]"); if (b) b.disabled = false; }
  });
  app.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, v = (k) => (f.elements[k] ? f.elements[k].value.trim() : "");
    st.msg = "";
    try {
      if (f.id === "pl-link") { await C.signIn(v("pl-email") || f.querySelector("input").value, location.href.split("#")[0]); st.msg = "Check your email for a sign-in link."; return render(); }
      if (f.id === "pl-pass") { await C.passwordSignIn(f.querySelector("#pl-login").value, f.querySelector("#pl-password").value); st.user = C.user(); return render(); }
      if (f.id === "pl-entry") { ok(await C.rpc("mm_entry_rename", { p_pool: st.code, p_name: v("entry") })); st.msg = "Saved."; await load(); return render(); }
      if (f.id === "pl-pool") {
        const sel = f.querySelector("select[name=scoring]");
        ok(await C.rpc("mm_pool_update", { p_pool: st.code, p_name: v("name"), p_settings: sel && !sel.disabled ? { scoring: sel.value } : null }));
        st.msg = "Saved."; await load(); return render();
      }
      if (f.id === "pl-notef") { ok(await C.rpc("mm_pool_extra", { p_pool: st.code, p_set: { note: f.elements.note.value } })); st.msg = f.elements.note.value.trim() ? "Message pinned." : "Message cleared."; await load(); return render(); }
      if (f.id === "pl-money") { ok(await C.rpc("mm_pool_extra", { p_pool: st.code, p_set: { buyin: v("buyin") === "" ? null : +v("buyin"), payouts: [0, 1, 2].map((i) => +v("pay" + i) || 0) } })); st.msg = "Saved."; await load(); return render(); }
      if (f.id === "pl-champ") { if (!v("name")) return; const c = ((st.board.pool.extra || {}).champs || []).concat([{ year: v("year"), name: v("name") }]); ok(await C.rpc("mm_pool_extra", { p_pool: st.code, p_set: { champs: c } })); await load(); return render(); }
      if (f.id === "pl-del") { ok(await C.rpc("mm_pool_delete", { p_pool: st.code, p_confirm: v("code") })); location.href = "/fantasy/pools/"; return; }
      if (f.id === "pl-sqset") {
        ok(await C.rpc("mm_squares_set", { p_pool: st.code, p_cap: +v("cap"), p_price: v("price") === "" ? null : +v("price"), p_pay: [0, 1, 2, 3].map((k) => +v("pay" + k)) }));
        st.msg = "Settings saved."; st.sqOwn = true; await load(); return render();
      }
      if (f.id === "pl-new") {
        const r = ok(await C.rpc("mm_pool_create", { p_name: v("name"), p_kind: (f.querySelector("input[name=kind]:checked") || {}).value, p_entry: v("entry") || null }));
        history.replaceState(null, "", `/fantasy/pools/?p=${r.id}`); st.code = r.id; st.tab = "picks"; st.invite = true; st.msg = "Your pool is ready. Invite people below."; return render();
      }
      if (f.id === "pl-join") {
        const raw = await C.rpc("mm_pool_join", { p_code: v("code"), p_entry: v("entry") || null });
        // a pick'em group's code: its own page joins it
        if (raw && raw.error === "pickem") { location.href = `/pickem/?join=${encodeURIComponent(raw.id)}`; return; }
        // not one of these pools: a wins pool's code joins on its own page
        if (raw && raw.error && /No pool has that code/.test(raw.error)) {
          const w = await C.rpc("wn_join", { p_code: v("code"), p_entry: v("entry") || null }).catch(() => null);
          if (w && w.ok) { location.href = `/fantasy/pools/wins/?p=${encodeURIComponent(w.id)}`; return; }
          if (w && w.error && !/No pool has that code/.test(w.error)) throw new Error(w.error);
        }
        const r = ok(raw);
        history.replaceState(null, "", `/fantasy/pools/?p=${r.id}`); st.code = r.id; st.tab = "picks"; return render();
      }
    } catch (x) { fail(x); }
  });

  (async function start() {
    const back = C.fromLink();
    if (back && back.user) st.user = back.user;
    st.user = C.user();
    try { const j = await fetch("/cbb/data/teams.json", { cache: "no-cache" }).then((r) => r.json()); st.teams = j.teams || {}; } catch (e) { /* names fall back to TBD */ }
    render();
  })();
})();
