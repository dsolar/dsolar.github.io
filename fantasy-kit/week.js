/* One week: this week's NFL games as slates to start a one-week game from (the whole week, Sunday, the night games,
   one game, or games you pick), your one-week games and the series they're in, and how it works. A slate's Start
   opens the start form (leagues.html?w=1&slate=...) with it picked. */
(function () {
  "use strict";
  const { sports: S, ui: U, cloud: C, slates: SL } = window.FK;
  const { icon, FIELD } = window.FK.setup;
  const { esc, $ } = U;
  const theme = U.theme("fk-lab");
  const top = $("#top"), app = $("#app");
  const link = C.fromLink();
  let data = null, mine = null, wk = 0;

  function header() {
    top.innerHTML = U.shell({ brand: { name: "Draft Lab", href: "./", mark: `<img src="mark.svg" alt="">` },
      tabs: [["leagues", "Your leagues"], ["week", "One week"], ["draft", "Mock draft"], ["rankings", "Rankings"], ["league", "Demo league"]], tab: "week",
      right: `<button class="btn sm ghost" data-theme>${theme.dark() ? "Light" : "Dark"}</button>`,
      hrefOf: (t) => (t === "leagues" ? "leagues.html" : t === "week" ? "week.html" : t === "league" ? "league.html" : "./#" + t) });
  }
  const day = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  const weeks = () => ((data && data.weeks) || []).filter((w) => SL.list(w).length);
  const start = (q) => `leagues.html?w=1&${q}${wk ? "&wk=1" : ""}`;

  function slateCards(w) {
    const list = SL.list(w).filter((x) => x.kind !== "one" && x.kind !== "custom");
    const games = (gs) => gs.map((g) => `<li><b>${esc(g.away)} @ ${esc(g.home)}</b><small>${esc(SL.kick(g.at))}</small></li>`).join("");
    return `<div class="wk-sl">${list.map((x) => {
      const lu = SL.lineup(x.games.length, 8);
      return `<article class="card wk-c"><div class="wk-ch"><h3>${esc(x.label)}</h3><span class="ps">${esc(x.sub)}</span></div>
        <ul class="wk-g">${games(x.games.slice(0, 6))}${x.games.length > 6 ? `<li class="more"><small>and ${x.games.length - 6} more</small></li>` : ""}</ul>
        <p class="ps wk-lu">${esc(lu.note)}.</p><a class="btn go" href="${start(`slate=${x.kind}`)}">${esc({ full: x.label === "Full week" ? "Start a full-week game" : "Start a rest-of-the-week game", sunday: "Start a Sunday game", prime: "Start a primetime game" }[x.kind])}</a></article>`;
    }).join("")}
      <article class="card wk-c"><div class="wk-ch"><h3>Pick your games</h3><span class="ps">Your team's game, a rivalry, the late window: any games you like</span></div>
        <p class="ps wk-lu">Two or three games use a captain at 1.5x and five flex. Four or more, a regular lineup.</p><a class="btn" href="${start("slate=custom")}">Pick the games</a></article></div>`;
  }
  function showdowns(w) {
    const gs = SL.open(w);
    return `<div class="card"><div class="mod-h"><h2>Showdowns</h2><span class="ps">One game: a captain at 1.5x and five flex, two to six teams</span></div>
      <div class="bd"><div class="slg-l" style="margin:0">${gs.map((g) => `<a class="slg" href="${start(`game=${encodeURIComponent(g.id)}`)}" aria-label="Start a showdown: ${esc(g.away)} at ${esc(g.home)}, ${esc(SL.kick(g.at))}"><b>${esc(g.away)} @ ${esc(g.home)}</b><small>${esc(SL.kick(g.at))}</small></a>`).join("")}</div></div></div>`;
  }
  // your one-week games: the latest game of each series, with how far it's got
  function mineCard() {
    if (!C.user()) return `<div class="card"><div class="bd stack"><p style="margin:0"><b>Your one-week games</b></p><p class="ps" style="margin:0"><a href="leagues.html">Sign in</a> to see yours and run them back.</p></div></div>`;
    if (!mine) return `<div class="card"><div class="bd"><p class="ps" style="margin:0">Loading your games…</p></div></div>`;
    const ones = mine.filter((l) => l.oneWeek), by = {};
    for (const l of ones) { const k = l.series || l.id; if (!by[k] || (l.seriesN || 1) > (by[k].seriesN || 1)) by[k] = l; }
    const list = Object.values(by).sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated));
    if (!list.length) return `<div class="card"><div class="bd stack"><p style="margin:0"><b>No one-week games yet.</b></p><p class="ps" style="margin:0">Start one above and send the link to your group.</p></div></div>`;
    const status = (l) => { const c = l.card || {}; return l.phase === "live" ? "Drafting now" : l.phase === "season" ? (c.week > (c.weeks || 1) ? "Final" : "Playing this week") : l.phase === "done" ? "Draft done" : "Draft room open"; };
    return `<div class="card"><div class="mod-h"><h2>Your one-week games</h2></div><ul class="feed wk-mine">${list.map((l) => `<li><a class="row" href="play.html?id=${esc(l.id)}" style="gap:10px;text-decoration:none;color:inherit;min-width:0"><span class="lg-sp sp-${esc(l.sport)}">${icon(l.sport)}</span><span class="grow" style="min-width:0"><b class="ell" style="display:block">${esc(l.name)}</b><small>${l.seriesN > 1 ? `Game ${l.seriesN}, ` : ""}${l.slate ? esc(l.slate) + ", " : ""}${esc(status(l))}</small></span></a><a class="btn sm" href="play.html?id=${esc(l.id)}">Open</a></li>`).join("")}</ul></div>`;
  }
  function render() {
    header();
    const ws = weeks(), w = ws[Math.min(wk, Math.max(0, ws.length - 1))];
    const weekTabs = ws.length > 1 ? `<div class="sg wr wk-tabs" role="radiogroup" aria-label="Which week">${ws.map((x, i) => `<label class="sg-o"><input type="radio" name="wk" value="${i}"${i === wk ? " checked" : ""} data-wk="${i}"><span>Week ${x.week}, ${day(x.start)} to ${day(x.end)}</span></label>`).join("")}</div>` : "";
    const games = !data ? `<p class="ps">Loading this week's games…</p>` : !w ? `<div class="card"><div class="bd"><p style="margin:0"><b>No games left to draft this week.</b> <span class="ps">The next week's games show up here once the schedule is out.</span></p></div></div>`
      : `${weekTabs}${slateCards(w)}<div class="cols2" style="margin-top:14px"><div class="stack">${showdowns(w)}</div><div class="stack">${mineCard()}</div></div>`;
    app.innerHTML = `<div class="wrap page">
      <div class="su sp-nfl"><div class="nl-band wk-band">${FIELD.nfl}<div class="nl-bi">
        <h1 class="disp">One week</h1>
        <p>Pick the games, draft with your group in about ten minutes, play one real week of football and crown a winner. Then run it back next week with the same people, and keep a running series.</p>
        <div class="row" style="gap:8px;flex-wrap:wrap"><a class="btn go" href="leagues.html?w=1">Start a one-week game</a><a class="btn" href="./#draft">Mock one first</a></div>
      </div></div></div>
      <section style="margin-top:18px"><h2 class="nl-h" style="margin:0 0 10px">This week's games</h2>${games}</section>
      <div class="mk-how" style="margin-top:18px">
        <div class="mk-tip"><b>Pick the games</b><p>The whole week, Sunday's day games, the night games, one game or your own picks. The lineup fits the slate, so three games never ask for three receivers.</p></div>
        <div class="mk-tip"><b>Everyone vs. everyone</b><p>With a group, the top score wins and everyone is ranked. Or pair off head to head, add a heist, or go best ball.</p></div>
        <div class="mk-tip"><b>Run it back</b><p>When the week's over, one tap starts next week with the same group. The series keeps score: wins, top-three finishes and points.</p></div>
      </div></div>`;
  }
  app.addEventListener("change", (e) => { const r = e.target.closest("[data-wk]"); if (r) { wk = +r.dataset.wk; render(); } });
  document.addEventListener("click", (e) => { if (e.target.closest("button[data-theme]")) { theme.toggle(); header(); } });
  if (link && link.error) U.toast(link.error, true);
  render();
  C.slates().then((d) => { data = d || { weeks: [] }; render(); });
  if (C.user()) C.rpc("fk_mine", {}).then((r) => { mine = Array.isArray(r) ? r : []; render(); }).catch(() => { mine = []; render(); });
})();
