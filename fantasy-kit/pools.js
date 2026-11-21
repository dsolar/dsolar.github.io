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
  const KIND = { nfl: "Survivor", nflpo: "Playoff bracket", bowls: "Bowl pick'em", survivor: "Survivor", five: "5 teams" };
  const SPORT = { nfl: "NFL", nflpo: "NFL", bowls: "College football", survivor: "March Madness", five: "March Madness" };
  const kindName = (k) => `${SPORT[k] || ""} ${(KIND[k] || "").toLowerCase()}`.trim();
  const ET = { timeZone: "America/New_York" };
  const dayName = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const tipTime = (t) => new Date(t).toLocaleString("en-US", Object.assign({ weekday: "short", hour: "numeric", minute: "2-digit" }, ET)).replace(":00 ", " ");
  const st = { user: C.user(), code: (params.get("p") || params.get("join") || "").toUpperCase(), make: params.get("make"), board: null, teams: {}, tab: "picks", sel: null, mine: null, msg: "", busy: false, open: {} };

  // ---------- theme (the masthead's Dark/Light button) ----------
  const dark = () => document.documentElement.dataset.theme === "dark";
  function themeBtn() { const b = document.querySelector("[data-theme]"); if (b) b.textContent = dark() ? "Light" : "Dark"; }
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
  const artOf = (k) => (k === "nfl" || k === "bowls" ? GOAL_ART : BRACKET_ART);
  const rulesHtml = (kind) => kind === "bowls" ? `<ul class="pl-rules">
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
  const ok = (r) => { if (r && r.error) throw new Error(r.error); return r; };

  // ---------- sign in ----------
  function signinCard(lead) {
    return `<div class="card pl-signin"><div class="bd"><h2>${esc(lead || "Sign in to play")}</h2><p class="ps">Same account as your Draft Lab leagues.</p>
      <form id="pl-link" class="pl-row"><label class="sr" for="pl-email">Email</label><input id="pl-email" type="email" required autocomplete="email" placeholder="you@example.com" value="${esc(C.lastEmail())}"><button class="btn go">Email me a sign-in link</button></form>
      <details class="pl-pw"><summary>Use a password instead</summary><form id="pl-pass" class="pl-row"><label class="sr" for="pl-login">Email or username</label><input id="pl-login" autocomplete="username" placeholder="Email or username" required><label class="sr" for="pl-password">Password</label><input id="pl-password" type="password" autocomplete="current-password" placeholder="Password" required><button class="btn">Sign in</button></form></details>
      <p class="pl-msg" role="status">${esc(st.msg)}</p></div></div>`;
  }

  // ---------- home: every game, your pools and groups, make one, join one ----------
  // in season first: NFL from September through January, March Madness the rest of the year
  const nflSeason = () => { const m = new Date().getMonth(); return m >= 8 || m === 0; };
  const GAMES = [
    { sport: "NFL", key: "pickem", name: "Pick'em", tag: "Every game against the spread, one point a win. One board for everyone, plus private groups.", when: "Weekly, all season", href: "/pickem/", cta: "Make this week's picks" },
    { sport: "NFL", key: "nfl", name: "Survivor", tag: "One team a week to win. Lose and you're out. Use each team once all season.", when: "Season long. A new pool starts with this week's games" },
    { sport: "NFL", key: "nflpo", name: "Playoff bracket", tag: "The 14-team bracket, reseeded the NFL's way. Points double each round.", when: "Locks at the first Wild Card kickoff in January. Practice on today's standings now" },
    { sport: "College football", key: "bowls", name: "Bowl pick'em", tag: "Every bowl and playoff game, each with a confidence number. Your surest pick counts the most.", when: "Mid-December through the title game. Pick each game until its kickoff" },
    { sport: "March Madness", key: "survivor", name: "Survivor", tag: "One team a day. Lose and you're out.", when: "Field set Selection Sunday, March 14. Practice bracket now" },
    { sport: "March Madness", key: "five", name: "5 teams", tag: "Five teams whose seeds add up to 25. Wins pay double each round.", when: "Locks at the first tip-off. Practice bracket now" },
  ];
  function gameCard(gm) {
    const act = gm.href ? `<a class="btn sm go" href="${gm.href}">${esc(gm.cta)}</a>` : `<button type="button" class="btn sm" data-make="${gm.key}">Make a pool</button>`;
    return `<div class="card pl-game"><div class="bd"><h3>${esc(gm.name)}</h3><p class="pl-tag">${esc(gm.tag)}</p><p class="pl-when">${esc(gm.when)}</p>
      ${gm.href ? "" : `<details class="pl-how"><summary>How it works</summary>${rulesHtml(gm.key)}</details>`}<div class="pl-act">${act}</div></div></div>`;
  }
  async function home() {
    let mine = [], groups = [];
    if (st.user) {
      [mine, groups] = await Promise.all([C.rpc("mm_pools_mine").catch((e) => { st.msg = e.message; return []; }), C.rpc("pk_groups_mine").catch(() => [])]);
    }
    const order = nflSeason() ? ["NFL", "College football", "March Madness"] : ["March Madness", "NFL", "College football"];
    const catalog = order.map((sp) => `<section class="pl-sec"><h2 class="pl-sec-h">${esc(sp)}</h2><div class="pl-games">${GAMES.filter((x) => x.sport === sp).map(gameCard).join("")}</div></section>`).join("");
    const items = mine.map((p) => `<li><span class="pl-li-k">${esc(SPORT[p.kind])}</span><a href="/fantasy/pools/?p=${esc(p.id)}"><b>${esc(p.name)}</b><small>${esc(KIND[p.kind])}${p.kind === "nfl" && p.startWeek ? ` from week ${p.startWeek}` : ""}, ${p.members} ${p.members === 1 ? "entry" : "entries"}${p.owner ? ", yours" : ""}</small></a><span class="pl-code">${esc(p.id)}</span></li>`)
      .concat((groups || []).map((g) => `<li><span class="pl-li-k">NFL</span><a href="/pickem/?tab=groups"><b>${esc(g.name)}</b><small>Pick'em group, ${g.members} ${g.members === 1 ? "member" : "members"}${g.owner ? ", yours" : ""}</small></a><span class="pl-code">${esc(g.id)}</span></li>`));
    const yours = st.user ? `<div class="card"><div class="mod-h"><h2>Your pools</h2><span class="grow"></span><span class="ps">${esc(st.user.email || "")}</span></div>
      ${items.length ? `<ul class="pl-list">${items.join("")}</ul>` : `<div class="bd ps">You're not in any pools yet. Make one below, or join with a code from a friend.</div>`}</div>` : signinCard();
    const kinds = (nflSeason() ? ["nfl", "nflpo", "bowls", "survivor", "five"] : ["survivor", "five", "nfl", "nflpo", "bowls"]);
    const pick = st.make && kinds.includes(st.make) ? st.make : kinds[0];
    const forms = st.user ? `<div class="pl-two" id="pl-forms">
        <form class="card" id="pl-new"><div class="mod-h"><h2>Make a pool</h2></div><div class="bd pl-form">
          <fieldset class="pl-kinds"><legend>Game</legend>${kinds.map((k) => `<label><input type="radio" name="kind" value="${k}"${k === pick ? " checked" : ""}><span><b>${esc(KIND[k])}</b><small>${esc(SPORT[k])}</small></span></label>`).join("")}</fieldset>
          <label>Pool name<input name="name" maxlength="40" required placeholder="The office pool"></label>
          <label>Your entry's name <small class="ps">(optional)</small><input name="entry" maxlength="28" placeholder="${esc((st.user.email || "").split("@")[0])}"></label>
          <button class="btn go">Make the pool</button></div></form>
        <form class="card" id="pl-join"><div class="mod-h"><h2>Join with a code</h2></div><div class="bd pl-form">
          <label>Code<input name="code" maxlength="6" required placeholder="ABC123" style="text-transform:uppercase" value="${esc(st.code)}"></label>
          <label>Your entry's name <small class="ps">(optional)</small><input name="entry" maxlength="28"></label>
          <button class="btn">Join</button><p class="ps" style="margin:0">Works for pools and pick'em groups.</p></div></form></div>
      <p class="pl-msg" role="status">${esc(st.msg)}</p>` : "";
    app.innerHTML = `<div class="wrap page pl">${band("Pools", "Pick'em, survivor and bracket games to play with friends. Make a pool, send the code, and the site keeps score.")}
      ${yours}${forms}${catalog}</div>`;
  }

  // ---------- a pool ----------
  async function load() {
    try { st.board = await C.rpc("mm_board", { p_pool: st.code }); } catch (e) { st.board = { error: e.message }; }
    if (st.board && st.board.pool && st.board.pool.kind === "bowls" && !st.cfb) {
      try { st.cfb = await fetch("/cfb/data/extras.json", { cache: "no-cache" }).then((r) => r.json()); } catch (e) { st.cfb = {}; }
    }
  }
  function poolHead(b) {
    const p = b.pool, url = `${location.origin}/fantasy/pools/?join=${p.id}`;
    const when = p.kind === "nfl" ? `${p.season} season from week ${p.startWeek}` : p.kind === "bowls" ? `${p.season}-${String((p.season + 1) % 100).padStart(2, "0")} bowl season` : p.kind === "nflpo" ? `${p.season} season playoffs` : `${p.season} tournament`;
    return band(esc(p.name), `${KIND[p.kind]} &middot; ${when} &middot; ${b.members.length} ${b.members.length === 1 ? "entry" : "entries"}`,
      `<div class="pl-share"><span class="pl-code" title="Pool code">${esc(p.id)}</span><button class="btn sm" data-copy="${esc(url)}">Copy invite link</button><a class="btn sm ghost" href="/fantasy/pools/">All pools</a></div>`, SPORT[p.kind], artOf(p.kind));
  }
  function projectedNote(b) {
    if (!b.projected) return "";
    return `<div class="pl-note"><b>Practice bracket.</b> These are the college hub's projected first-round games on this season's real dates. The real field comes out Selection Sunday, March 14, and replaces them; practice picks are cleared then.</div>`;
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
    const tabs = [["picks", "Picks"], ["standings", "Standings"], ["rules", "Rules"]];
    const body = st.tab === "rules" ? `<div class="card"><div class="bd">${rulesHtml(b.pool.kind)}</div></div>`
      : b.pool.kind === "nfl" ? (st.tab === "picks" ? nflPicks(b) : nflTable(b))
      : b.pool.kind === "bowls" ? (st.tab === "picks" ? bowlPicks(b) : bowlTable(b))
      : b.pool.kind === "nflpo" ? (st.tab === "picks" ? brPicks(b) : brTable(b))
      : b.pool.kind === "five" ? (st.tab === "picks" ? fivePicks(b) : fiveTable(b)) : (st.tab === "picks" ? survPicks(b) : survTable(b));
    app.innerHTML = `<div class="wrap page pl">${poolHead(b)}${projectedNote(b)}
      <div class="seg pl-tabs" role="tablist">${tabs.map(([k, n]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${st.tab === k}">${n}</button>`).join("")}</div>
      <p class="pl-msg" role="status">${esc(st.msg)}</p>${body}</div>`;
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
          ${logo(c.team, 30)}<span class="pl-tn"><b>${seedTag(c.seed)}${name(c.team)}</b><small>vs ${seedTag(c.oppSeed)}${name(c.opp)} &middot; ${tipTime(c.tip)}</small>${c.why && !c.picked ? `<small class="pl-why">${esc(c.why)}</small>` : ""}</span>
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
          ${nflLogo(c.team, 30)}<span class="pl-tn"><b>${nflName(c.team)}</b><small>${c.home ? "vs" : "at"} ${nflName(c.opp)} &middot; ${kickTime(c.kickoff)}</small>${c.why && !c.picked ? `<small class="pl-why">${esc(c.why)}</small>` : ""}</span>
          ${c.p != null ? `<span class="pl-wp" title="Chance to win, from the betting line"><i style="--w:${Math.round(c.p * 100)}%"></i>${Math.round(c.p * 100)}%</span>` : ""}</button>`).join("")}</div>
          ${mineT && !cell.live ? `<p class="pl-foot"><button type="button" class="btn sm ghost" data-nunpick="${w.week}">Take back my week ${w.week} pick</button></p>` : ""}` : ""}</div>`;
    }).join("");
    const mineAll = ((b.picks || []).filter((k) => k.user === uid && k.team).map((k) => k.team));
    const left = Object.keys(NFL).filter((t) => !mineAll.includes(t));
    const usedLine = mineAll.length ? `<p class="ps">Used: ${mineAll.map(nflName).join(", ")}. ${left.length} teams left.</p>` : "";
    const later = `<p class="ps">Later weeks show up as their games are scheduled on the board, a few days ahead.</p>`;
    return status + cards + usedLine + later;
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
      ${B.rows.map((r) => `<tr class="${r.me ? "me" : ""}"><td class="r num">${r.place}</td><td class="nm"><b>${esc(r.name)}</b>${!r.picked ? `<small class="ps"> no picks yet</small>` : ""}</td><td class="r num"><b>${r.points}</b></td><td class="r num ps">${r.right}-${r.wrong}</td><td class="r num ps">${r.max}</td><td class="r num ps pl-hide-s">${tbOpen || r.me ? (r.tb ?? "") : ""}</td></tr>`).join("")}
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

  // ---------- render and events ----------
  async function render() {
    themeBtn();
    if (st.code) await pool(); else await home();
  }
  app.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-tab],[data-day],[data-week],[data-pick],[data-unpick],[data-npick],[data-nunpick],[data-five],[data-save5],[data-copy],[data-make],[data-bteam],[data-bauto],[data-bsave],[data-kb],[data-ksave]");
    if (!t || t.disabled) return;
    st.msg = "";
    if (t.dataset.tab) { st.tab = t.dataset.tab; return render(); }
    if (t.dataset.day) { const n = +t.dataset.day; st.open[n] = t.getAttribute("aria-expanded") !== "true"; return render(); }
    if (t.dataset.week) { st.open["w" + t.dataset.week] = t.getAttribute("aria-expanded") !== "true"; return render(); }
    if (t.dataset.make) {
      st.make = t.dataset.make;
      if (!st.user) { const f = document.querySelector(".pl-signin"); if (f) f.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      const r = document.querySelector(`#pl-new input[name=kind][value="${t.dataset.make}"]`);
      if (r) { r.checked = true; document.getElementById("pl-new").scrollIntoView({ behavior: "smooth", block: "center" }); const n = document.querySelector("#pl-new input[name=name]"); if (n) n.focus({ preventScroll: true }); }
      return;
    }
    if (t.dataset.copy) { try { await navigator.clipboard.writeText(t.dataset.copy); t.textContent = "Copied"; } catch (x) { prompt("Copy this invite link:", t.dataset.copy); } return; }
    if (t.dataset.bteam) { const [gid, tm] = t.dataset.bteam.split("|"); const k = st.bd[gid] = st.bd[gid] || {}; k.team = k.team === tm ? "" : tm; return render(); }
    if (t.hasAttribute("data-bauto")) { st.bd = P.autoRank(st.board.games, st.bd, cfbProb); st.msg = "Numbered: your surest picks carry the most. Save to keep it."; return render(); }
    if (t.dataset.kb) { const [slot, tm] = t.dataset.kb.split("|"); st.kb[slot] = tm; st.kb = P.bracketPicks(st.board.field, st.kb); return render(); }
    if (t.dataset.five) {
      const id = t.dataset.five, i = st.sel.indexOf(id);
      if (i >= 0) st.sel.splice(i, 1); else if (st.sel.length < 5) st.sel.push(id);
      return render();
    }
    try {
      if (t.dataset.pick) { const [d, tm] = t.dataset.pick.split("|"); ok(await C.rpc("mm_pick", { p_pool: st.code, p_day: +d, p_team: tm })); st.msg = `Day ${d}: ${team(tm).n}.`; }
      else if (t.dataset.npick) { const [w, tm] = t.dataset.npick.split("|"); ok(await C.rpc("mm_pick_nfl", { p_pool: st.code, p_week: +w, p_team: tm })); st.msg = `Week ${w}: ${(NFL[tm] || [tm, tm])[1]}.`; }
      else if (t.dataset.nunpick) { ok(await C.rpc("mm_pick_nfl", { p_pool: st.code, p_week: +t.dataset.nunpick, p_team: null })); st.msg = "Pick taken back."; }
      else if (t.dataset.unpick) { ok(await C.rpc("mm_pick", { p_pool: st.code, p_day: +t.dataset.unpick, p_team: null })); st.msg = "Pick taken back."; }
      else if (t.hasAttribute("data-bsave")) {
        const picks = Object.entries(st.bd).filter(([, k]) => k.team || k.pts).map(([game, k]) => ({ game, team: k.team || "", pts: k.pts || null }));
        const r = ok(await C.rpc("mm_save_bowls", { p_pool: st.code, p_picks: picks, p_tb: st.btb === "" || st.btb == null ? null : +st.btb }));
        st.msg = `Saved ${r.saved} ${r.saved === 1 ? "game" : "games"}.`; st.bd = null; await load();
      }
      else if (t.hasAttribute("data-ksave")) {
        ok(await C.rpc("mm_save_nflpo", { p_pool: st.code, p_picks: P.bracketPicks(st.board.field, st.kb), p_tb: st.ktb === "" || st.ktb == null ? null : +st.ktb }));
        st.msg = "Bracket saved."; st.kb = null; await load();
      }
      else if (t.hasAttribute("data-save5")) { const r = ok(await C.rpc("mm_pick_five", { p_pool: st.code, p_teams: st.sel })); st.msg = `Saved: seeds add up to ${r.seeds}.`; st.sel = null; }
      render();
    } catch (x) { fail(x); }
  });
  app.addEventListener("change", (e) => {
    const t = e.target;
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
    if (t.hasAttribute("data-ktb")) { st.ktb = t.value; const b = document.querySelector("[data-ksave]"); if (b) b.disabled = false; }
  });
  app.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, v = (k) => (f.elements[k] ? f.elements[k].value.trim() : "");
    st.msg = "";
    try {
      if (f.id === "pl-link") { await C.signIn(v("pl-email") || f.querySelector("input").value, location.href.split("#")[0]); st.msg = "Check your email for a sign-in link."; return render(); }
      if (f.id === "pl-pass") { await C.passwordSignIn(f.querySelector("#pl-login").value, f.querySelector("#pl-password").value); st.user = C.user(); return render(); }
      if (f.id === "pl-new") {
        const r = ok(await C.rpc("mm_pool_create", { p_name: v("name"), p_kind: (f.querySelector("input[name=kind]:checked") || {}).value, p_entry: v("entry") || null }));
        history.replaceState(null, "", `/fantasy/pools/?p=${r.id}`); st.code = r.id; st.tab = "picks"; return render();
      }
      if (f.id === "pl-join") {
        const raw = await C.rpc("mm_pool_join", { p_code: v("code"), p_entry: v("entry") || null });
        // a pick'em group's code: its own page joins it
        if (raw && raw.error === "pickem") { location.href = `/pickem/?join=${encodeURIComponent(raw.id)}`; return; }
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
