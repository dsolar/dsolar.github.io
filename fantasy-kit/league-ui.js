/* Fantasy Kit: a whole league site on top of FK.league, built from the FK.ui modules.
   Load after ui.js and league.js.

   FK.ui.leagueApp(opts) renders every page of a league into opts.el and the shell into opts.top:
     League   Overview, Standings, Scoreboard, Transactions, Draft results, Settings
     My Team  Roster and lineup, Schedule, Trades (offers, the trade window, review votes)
     Matchup  the head-to-head for any week
     Players  Free agents, All players, Watchlist, Waiver claims
     Commish  whatever opts.commishTools() returns
   opts: { top, el, sport, players, league(), save(L), me(), now(), frac(w) (how much of week w has played),
           brand, right(), switcher, commishTools(), draftHref } */
(function (root) {
  "use strict";
  const FK = root.FK, S = FK.sports, G = FK.league, U = FK.ui;
  const { esc, $, $$, money, ord, teamAv, pname, teamName, posChips } = U;

  function leagueApp(opts) {
    const { sport } = opts;
    const L = () => opts.league();
    let ctx = G.context(L(), opts.players, sport, opts.hooks);
    const refresh = () => (ctx = G.context(L(), opts.players, sport, opts.hooks));
    const save = () => { opts.save(L()); refresh(); };
    const me = () => opts.me();
    const now = () => (opts.now ? opts.now() : Date.now());
    const T = (id) => L().teams[id];
    const isMe = (id) => me() != null && id === me();
    const sc = () => G.scoring(L(), ctx);
    const pts = () => sc().type === "points";
    const fmtS = (x) => (x == null ? "-" : pts() ? x.toFixed(1) : String(Math.round(x)));
    const ui = { moving: null, week: null, pf: { q: "", pos: "" }, psort: { k: "rank", dir: 1 }, pshow: "fa", txf: "", sbWeek: null };
    const curWeek = () => Math.min(L().week, G.totalWeeks(L()));
    const over = () => L().week > G.totalWeeks(L());
    const frac = (w) => (w < L().week ? 1 : opts.frac ? opts.frac(w) : 0);
    const standings = () => G.standings(L());
    const recOf = (id) => { const r = standings().find((x) => x.team === id); return r ? `${r.w}-${r.l}${r.t ? "-" + r.t : ""}` : ""; };
    const act = (fn, okMsg) => { const r = fn(); if (r && r.ok === false) { U.toast(r.why, true); return false; } save(); if (okMsg) U.toast(okMsg); render(); return true; };
    const watch = () => { const w = L().watch; return (w[me()] = w[me()] || []); };

    /* ---------- routing ---------- */
    const TABS = () => [["league", "League"], ["team", "My Team"], ["matchup", "Matchup"], ["players", "Players"], ["draft", "Draft"]].concat(opts.commishTools ? [["commish", "Commissioner"]] : []);
    function subsOf(tab) {
      if (tab === "league") return [["overview", "Overview"], ["standings", "Standings"], ["scoreboard", "Scoreboard"], ["tx", "Transactions"], ["settings", "Settings"]];
      if (tab === "team") return [["roster", "Roster"], ["schedule", "Schedule"], ["trades", "Trades", pendingTrades()]];
      if (tab === "players") return [["fa", "Free agents"], ["all", "All players"], ["watch", "Watchlist"], ["claims", "Waiver claims", L().claims.filter((c) => c.team === me() && c.status === "open").length]];
      return [];
    }
    const pendingTrades = () => L().trades.filter((t) => (t.status === "pending" && t.to === me()) || (t.status === "review" && G.voters(L(), t).includes(me()) && !(t.votes || {})[me()])).length;
    function route() {
      const r = U.route("league");
      if (!TABS().some((t) => t[0] === r.tab)) r.tab = "league";
      const subs = subsOf(r.tab);
      if (subs.length && !subs.some((s) => s[0] === r.sub)) { r.arg = r.tab === "team" && /^\d+$/.test(r.sub) ? r.sub : r.arg; r.sub = subs[0][0]; }
      return r;
    }
    const teamHref = (id) => `#team/roster/${id}`;
    const matchHref = (w, i) => `#matchup/${w}/${i}`;

    /* ---------- view models ---------- */
    function gamesVM(w) {
      const ms = G.matchups(L(), ctx, w, frac(w));
      return ms.map((m) => ({
        href: matchHref(w, m.i), me: isMe(m.a) || isMe(m.b), status: m.final ? "final" : m.live ? "live" : "proj",
        label: m.final ? "Final" : m.live ? "Live" : `Week ${w}`, sub: w > L().settings.weeks ? "Playoffs" : "",
        a: { team: T(m.a), score: m.final || m.live ? m.sa : m.pa, rec: recOf(m.a) }, b: { team: T(m.b), score: m.final || m.live ? m.sb : m.pb, rec: recOf(m.b) }, m,
      }));
    }
    function versusVM(w, m) {
      const live = !m.final;
      const cats = !pts() && m.cats ? sc().cats.map((c) => { const [x, y, d] = m.cats[c.k]; const f = c.fmt || ((v) => (Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1))); return { label: c.label, fa: f(x), fb: f(y), d }; }) : null;
      return { a: { team: T(m.a), rec: recOf(m.a), score: m.sa, proj: live && pts() ? m.pa : null }, b: { team: T(m.b), rec: recOf(m.b), score: m.sb, proj: live && pts() ? m.pb : null },
        wp: live ? m.winProb : null, status: m.final ? "Final" : m.live ? `Live, ${Math.round((m.frac || 0) * 100)}% played` : "Projected", live: m.live, cats, fmt: fmtS };
    }
    const findGame = (w, teamId) => G.matchups(L(), ctx, w, frac(w)).find((m) => m.a === teamId || m.b === teamId);
    const playerVM = (id) => ctx.byId[id];

    /* ---------- pages: League ---------- */
    function overview() {
      const w = curWeek(), mid = me();
      const games = gamesVM(w);
      const mine = mid != null && !over() ? findGame(w, mid) : null;
      const st = standings().map((r) => Object.assign({}, r, { team: T(r.team), me: isMe(r.team), href: teamHref(r.team), cut: r.rank === L().settings.playoffTeams }));
      const recent = L().tx.slice().reverse().filter((x) => x.type !== "draft").slice(0, 7);
      const offers = L().trades.filter((t) => t.status === "pending" && t.to === mid);
      const champ = over() ? championOf() : null;
      const hot = ctx.free.filter((p) => !G.onWaivers(L(), p.id, now())).map((p) => ({ p, h: G.hot(L(), p) })).sort((a, b) => (b.p.vor + b.h * 0.6) - (a.p.vor + a.h * 0.6)).slice(0, 5);
      const pw = G.power(L(), ctx).slice(0, 6);
      const myRow = mid != null ? st.find((r) => r.team.id === mid) : null;
      return `<div class="wrap page">
        ${champ != null ? `<div class="banner"><span>${teamAv(T(champ), "lg")}</span><div><b class="disp" style="font-size:26px">${esc(T(champ).name)} won the title</b><div class="ps">The ${esc(L().season || "")} season is over.</div></div></div>` : ""}
        <div class="stack" style="gap:8px"><div class="row"><h2 style="margin:0;font-size:15px">${over() ? "Final week" : `Week ${w} scoreboard`}</h2><a href="#league/scoreboard" class="small" style="margin-left:auto">All scores</a></div>${U.scoreboard(games, fmtS)}</div>
        <div class="cols"><div class="stack">
          ${mine ? `<div class="card"><div class="mod-h"><h2>Your matchup</h2><span class="ps">Week ${w}${w > L().settings.weeks ? ", playoffs" : ""}</span><a href="${matchHref(w, mine.i)}">Full matchup</a></div>${U.versus(versusVM(w, mine))}</div>` : ""}
          <div class="card"><div class="mod-h"><h2>Standings</h2><a href="#league/standings">Full standings</a></div>${U.standingsTable(st, { compact: true, pfLabel: pts() ? "PF" : "Cats", fmt: fmtS })}</div>
          <div class="card"><div class="mod-h"><h2>Recent activity</h2><a href="#league/tx">All transactions</a></div>${U.feed(recent.map(txVM), "No moves yet. Pick up a free agent to get things going.")}</div>
        </div><aside class="stack">
          ${myRow ? `<div class="card"><div class="mod-h">${teamAv(myRow.team, "md")}<div style="min-width:0"><b class="ell" style="display:block">${esc(myRow.team.name)}</b><span class="ps">${ord(myRow.rank)} place, ${myRow.w}-${myRow.l}${myRow.t ? "-" + myRow.t : ""}</span></div></div>
            <div class="bd"><div class="stat-row"><div><small>FAAB</small><b>$${T(mid).faab}</b></div><div><small>Waiver priority</small><b>${ord(T(mid).priority + 1)}</b></div><div><small>Streak</small><b>${esc(myRow.streak || "-")}</b></div></div>
            <div class="row" style="margin-top:12px;flex-wrap:wrap"><a class="btn sm" href="#team/roster">Set lineup</a><button class="btn sm" data-trade>Propose a trade</button><a class="btn sm" href="#players/fa">Free agents</a></div></div></div>` : ""}
          ${offers.length ? `<div class="card"><div class="mod-h"><h2>Trade offers for you</h2><span class="badge">${offers.length}</span><a href="#team/trades">Review</a></div>${U.feed(offers.map((t) => ({ team: T(t.from), when: U.ago(t.at, now()), lines: t.get.map((id) => U.txLine(sport, "drop", playerVM(id), "you send")).concat(t.give.map((id) => U.txLine(sport, "add", playerVM(id), "you get"))) })))}</div>` : ""}
          <div class="card"><div class="mod-h"><h2>Power rankings</h2><a href="#league/standings">More</a></div><ol class="feed">${pw.map((r) => `<li style="grid-template-columns:24px auto minmax(0,1fr) auto;align-items:center;padding:8px 16px"><b class="ps num">${r.rank}</b>${teamAv(T(r.team), "sm")}<span class="ell"><b>${esc(T(r.team).name)}</b></span>${moveTag(r.move)}</li>`).join("")}</ol></div>
          <div class="card"><div class="mod-h"><h2>Hot on waivers</h2><a href="#players/fa">Free agents</a></div><ul class="feed">${hot.map(({ p, h }) => `<li style="grid-template-columns:minmax(0,1fr) auto;align-items:center;padding:8px 16px"><span data-player="${esc(p.id)}" style="cursor:pointer;min-width:0">${pname(sport, p, h > 1.15 ? `<span class="win">hot</span>` : "")}</span>${mid != null ? `<button class="btn icon add" data-add="${esc(p.id)}" aria-label="Add ${esc(p.n)}">+</button>` : ""}</li>`).join("") || `<li class="empty">Nobody stands out.</li>`}</ul></div>
        </aside></div></div>`;
    }
    const moveTag = (m) => (m > 0 ? `<span class="tag win">+${m}</span>` : m < 0 ? `<span class="tag loss">${m}</span>` : `<span class="ps">-</span>`);
    function championOf() {
      const fin = L().results[G.totalWeeks(L())];
      if (!fin || !fin[0]) return null;
      return fin[0].w === "b" ? fin[0].b : fin[0].a;
    }
    function standingsPage() {
      const st = standings().map((r) => Object.assign({}, r, { team: T(r.team), me: isMe(r.team), href: teamHref(r.team), cut: r.rank === L().settings.playoffTeams }));
      const pw = G.power(L(), ctx);
      const br = G.bracket(L(), ctx);
      return `<div class="wrap page"><div class="head"><h1 class="disp">Standings</h1><span class="ps">Top ${L().settings.playoffTeams} make the playoffs (the dashed line). Ties break on ${pts() ? "points for" : "categories won"}.</span></div>
        ${U.standingsTable(st, { pfLabel: pts() ? "PF" : "Cats won", paLabel: pts() ? "PA" : "Cats lost", fmt: fmtS })}
        <div class="cols2">
          <div class="card"><div class="mod-h"><h2>Power rankings</h2><span class="ps">Record, scoring and roster strength</span></div><ol class="feed">${pw.map((r) => `<li style="grid-template-columns:24px auto minmax(0,1fr) auto;align-items:center;padding:8px 16px"><b class="ps num">${r.rank}</b>${teamAv(T(r.team), "sm")}<a class="ell" href="${teamHref(r.team)}" style="color:inherit;text-decoration:none"><b>${esc(T(r.team).name)}</b> <span class="ps">${recOf(r.team)}</span></a>${moveTag(r.move)}</li>`).join("")}</ol></div>
          <div class="card"><div class="mod-h"><h2>Playoffs</h2><span class="ps">Weeks ${L().settings.weeks + 1} to ${G.totalWeeks(L())}</span></div><div class="bd">${br.length ? br.map((b) => `<div class="stack" style="gap:8px;margin-bottom:12px"><b class="ps">${esc(b.round)}, week ${b.week}</b>${U.scoreboard(b.games.map((m) => ({ href: matchHref(b.week, m.i), me: isMe(m.a) || isMe(m.b), status: m.final ? "final" : "proj", a: { team: T(m.a), score: m.final ? m.sa : m.pa }, b: { team: T(m.b), score: m.final ? m.sb : m.pb } })), fmtS)}</div>`).join("") : `<p class="ps" style="margin:0">If the season ended today: ${standings().slice(0, L().settings.playoffTeams).map((r, i, a) => i < a.length / 2 ? `${esc(T(r.team).abbr)} vs ${esc(T(a[a.length - 1 - i].team).abbr)}` : "").filter(Boolean).join(", ")}.</p>`}</div></div>
        </div></div>`;
    }
    function scoreboardPage() {
      const w = ui.sbWeek || curWeek();
      const weeks = Array.from({ length: Math.min(curWeek(), G.totalWeeks(L())) }, (_, i) => i + 1);
      return `<div class="wrap page"><div class="head"><h1 class="disp">Scoreboard</h1></div>
        <div class="chips" role="group" aria-label="Week">${weeks.map((x) => `<button type="button" data-sbweek="${x}" aria-pressed="${x === w}">${x > L().settings.weeks ? (x === G.totalWeeks(L()) ? "Final" : "Playoffs " + (x - L().settings.weeks)) : "Week " + x}</button>`).join("")}</div>
        <div class="cols2">${G.matchups(L(), ctx, w, frac(w)).map((m) => `<a class="card" href="${matchHref(w, m.i)}" style="text-decoration:none;color:inherit${isMe(m.a) || isMe(m.b) ? ";border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)" : ""}">${U.versus(Object.assign(versusVM(w, m), { cats: null }))}</a>`).join("")}</div></div>`;
    }
    const TXK = { add: "add", drop: "drop", "add/drop": "add", waiver: "waiver", trade: "trade", veto: "trade" };
    function txVM(x) {
      const lines = [];
      if (x.type === "trade") { for (const id of x.adds) lines.push(U.txLine(sport, "trade", playerVM(id), `to ${esc(T(x.team).abbr)}`)); for (const id of x.drops) lines.push(U.txLine(sport, "trade", playerVM(id), `to ${esc(T(x.other).abbr)}`)); }
      else { for (const id of x.adds || []) lines.push(U.txLine(sport, x.type === "waiver" ? "waiver" : "add", playerVM(id), x.type === "waiver" && x.faab != null ? `$${x.faab}${x.bids > 1 ? `, beat ${x.bids - 1} bid${x.bids > 2 ? "s" : ""}` : ""}` : "")); for (const id of x.drops || []) lines.push(U.txLine(sport, "drop", playerVM(id))); }
      if (x.type === "veto") lines.push(`<span class="ps">The league vetoed a trade</span>`);
      if (x.type === "draft" || x.text) lines.push(`<span class="ps">${esc(x.text || "")}</span>`);
      const badge = x.type === "trade" ? `<span class="tag info">Trade</span>` : x.type === "waiver" ? `<span class="tag gold">Waiver</span>` : x.type === "veto" ? `<span class="tag loss">Veto</span>` : "";
      return { team: T(Math.max(0, x.team)), with: x.type === "trade" ? T(x.other) : null, when: `Week ${x.week}, ${U.ago(x.at, now())}`, lines, badge };
    }
    function txPage() {
      const f = ui.txf;
      const items = L().tx.slice().reverse().filter((x) => x.type !== "draft" && (!f || (f === "add" ? /add/.test(x.type) : f === "drop" ? (x.drops || []).length && x.type !== "trade" : x.type === f)));
      return `<div class="wrap page"><div class="head"><h1 class="disp">Transactions</h1><span class="ps">${L().tx.length} moves this season</span></div>
        <div class="chips" role="group" aria-label="Type">${[["", "All"], ["add", "Adds"], ["drop", "Drops"], ["waiver", "Waivers"], ["trade", "Trades"]].map(([k, n]) => `<button type="button" data-txf="${k}" aria-pressed="${k === f}">${n}</button>`).join("")}</div>
        <div class="card">${U.feed(items.slice(0, 120).map(txVM), "Nothing here yet.")}</div></div>`;
    }
    function settingsPage() {
      const s = L().settings;
      return `<div class="wrap page"><div class="head"><h1 class="disp">League settings</h1></div><div class="cols2">
        <div class="card"><div class="mod-h"><h2>Format</h2></div><div class="bd"><dl class="kv"><dt>Sport</dt><dd>${esc(sport.name)}</dd><dt>Scoring</dt><dd>${esc(sc().label)}</dd><dt>Teams</dt><dd>${L().teams.length}</dd><dt>Season</dt><dd>${s.weeks} weeks, then ${s.playoffTeams} teams in the playoffs</dd><dt>Trade deadline</dt><dd>${s.deadline ? `After week ${s.deadline}` : "None"}</dd><dt>Trade review</dt><dd>${s.tradeReview === "none" ? "None" : `${s.reviewHours} hours, ${Math.round(s.vetoShare * 100)}% of the league to veto`}</dd></dl></div></div>
        <div class="card"><div class="mod-h"><h2>Rosters</h2></div><div class="bd"><dl class="kv"><dt>Starters</dt><dd>${s.lineup.map((x) => `<span class="slot" style="margin:0 3px 3px 0">${esc(x)}</span>`).join("")}</dd><dt>Bench</dt><dd>${s.bench}</dd><dt>Waivers</dt><dd>${s.waivers === "faab" ? `$${s.faab} FAAB, ${s.waiverHours} hours after a drop` : "Rolling priority"}</dd></dl></div></div>
        ${sc().cats ? `<div class="card"><div class="mod-h"><h2>Categories</h2></div><div class="bd">${sc().cats.map((c) => `<span class="slot" style="margin:0 4px 4px 0">${esc(c.label)}</span>`).join("")}<p class="ps">Head to head: win more categories than your opponent to win the week.</p></div></div>` : ""}
      </div></div>`;
    }
    function draftPage() {
      const D = L().draft;
      if (!D) return `<div class="wrap page"><p class="empty">This league didn't draft here.</p></div>`;
      const dctx = FK.draft.context(D, opts.players, sport);
      const st = FK.draft.standings(D, dctx).sort((a, b) => a.rank - b.rank);
      const n = D.teams.length, cols = D.round1, auction = D.type === "auction";
      let cells = `<div class="h"></div>${cols.map((id) => `<div class="h${isMe(id) ? " me" : ""}">${teamAv(T(id), "sm")}<b>${esc(T(id).name)}</b></div>`).join("")}`;
      for (let r = 0; r < D.rounds; r++) {
        cells += `<div class="rn">${r + 1}</div>`;
        for (let col = 0; col < n; col++) {
          let pk = null;
          if (auction) pk = D.sales.filter((x) => x.team === cols[col])[r];
          else for (let k = r * n; k < (r + 1) * n; k++) if (D.order[k] === cols[col]) pk = D.board[k];
          const p = pk && pk.pid && ctx.byId[pk.pid];
          cells += `<div class="cell${p ? " f c" + U.colorOf(sport, p) : ""}${isMe(cols[col]) ? " me" : ""}"${p ? ` data-player="${esc(p.id)}" role="button" tabindex="0"` : ""}>${p ? `<b>${esc(p.n)}</b><small>${S.positions(p).join(", ")} ${esc(p.t)}${auction ? " " + money(pk.price) : ""}</small>` : ""}</div>`;
        }
      }
      return `<div class="wrap page"><div class="head"><h1 class="disp">Draft results</h1><span class="ps">${esc(FK.draft.FORMATS[D.type])}, ${D.rounds} rounds${D.done ? `, ${new Date(D.done).toLocaleDateString("en-US", { month: "long", day: "numeric" })}` : ""}</span>${opts.draftHref ? `<a class="btn sm" href="${esc(opts.draftHref)}" style="margin-left:auto">Open the draft room</a>` : ""}</div>
        <div class="board" style="max-height:70vh"><div class="bgrid" style="--n:${n};grid-template-columns:28px repeat(${n},minmax(0,1fr))">${cells}</div></div>
        <div class="card"><div class="mod-h"><h2>Draft grades</h2><span class="ps">By each team's best lineup at draft time</span></div><div class="bd"><div class="teams">${st.map((r) => `<div class="row" style="gap:10px">${teamAv(T(r.team), "md")}<div style="min-width:0"><b class="ell" style="display:block">${esc(T(r.team).name)}</b><span class="ps">${ord(r.rank)}${r.spent != null ? `, spent ${money(r.spent)}` : ""}</span></div><b class="grade disp">${r.grade}</b></div>`).join("")}</div></div></div></div>`;
    }

    /* ---------- pages: My Team ---------- */
    function teamHead(id) {
      const t = T(id), r = standings().find((x) => x.team === id);
      return `<div class="team-h">${teamAv(t, "xl")}<div style="min-width:0"><h1 class="disp">${esc(t.name)}${isMe(id) ? ` <span class="tag you" style="font-size:13px;vertical-align:6px">You</span>` : ""}</h1>
        <div class="meta"><span><b>${r.w}-${r.l}${r.t ? "-" + r.t : ""}</b>, ${ord(r.rank)} place</span><span>${pts() ? `<b>${fmtS(r.pf)}</b> points for` : `<b>${r.pf}</b> categories won`}</span><span>FAAB <b>$${t.faab}</b></span><span>Waiver priority <b>${ord(t.priority + 1)}</b></span>${t.owner ? `<span>Manager <b>${esc(t.owner)}</b></span>` : `<span>Bot</span>`}</div></div>
        <span class="grow"></span>${!isMe(id) && me() != null ? `<button class="btn go" data-trade="${id}">Propose a trade</button>` : ""}
        <label class="sr" for="team-pick">Team</label><select id="team-pick" style="width:auto;border-radius:999px">${L().teams.map((x) => `<option value="${x.id}"${x.id === id ? " selected" : ""}>${esc(x.name)}${isMe(x.id) ? " (you)" : ""}</option>`).join("")}</select></div>`;
    }
    function rosterPage(arg) {
      const id = arg !== "" && arg != null && L().teams[+arg] ? +arg : me() != null ? me() : 0;
      const mine = isMe(id);
      const w = ui.week && ui.week >= L().week ? ui.week : curWeek();
      const lu = G.lineupFor(L(), ctx, id, w);
      const slots = L().settings.lineup;
      const game = !over() ? findGame(w, id) : null;
      const ptsOf = (pid) => (game && game.ta && game.tb ? ((game.a === id ? game.ta : game.tb).players || {})[pid] : null);
      const wk = G.WEEK[sport.key] || { weeks: 20 };
      const projOf = (p) => (pts() ? p.v / wk.weeks : null);
      const moving = ui.moving && L().rosters[id].includes(ui.moving) ? ctx.byId[ui.moving] : null;
      const locked = w < L().week;
      const cols = (slotHtml, p, i) => {
        const tgt = moving && p !== moving && i != null && S.fits(sport, moving, slots[i]) ? `<button class="btn xs go" data-here="${i}">Here</button>` : "";
        return `<td class="c" style="width:70px">${slotHtml}</td><td class="nm">${p ? `<span data-player="${esc(p.id)}" style="cursor:pointer">${pname(sport, p, `${esc(p.prank)}`)}</span>` : `<span class="ps">Empty</span>`}</td>
          <td class="r num hide-s">${p ? `<span class="ps">#${p.rank}</span>` : ""}</td><td class="r num">${p && pts() ? `<b>${fmtS(ptsOf(p.id))}</b>` : p ? `<b>${p.v.toFixed(1)}</b>` : ""}</td><td class="r num hide-s">${p && pts() ? fmtS(projOf(p)) : ""}</td>
          <td class="r act">${tgt}${mine && !locked && p && !moving ? `<button class="btn xs" data-move="${esc(p.id)}">Move</button>` : ""}${mine && p && !moving ? ` <button class="btn icon drop" data-drop="${esc(p.id)}" aria-label="Drop ${esc(p.n)}" title="Drop">&minus;</button>` : ""}${!mine && p && me() != null ? ` <button class="btn icon trade" data-trade="${id}" data-want="${esc(p.id)}" aria-label="Trade for ${esc(p.n)}" title="Trade for">&#8644;</button>` : ""}</td>`;
      };
      const starters = slots.map((s, i) => { const p = lu[i] ? ctx.byId[lu[i]] : null; return `<tr class="${moving && p === moving ? "me" : ""}">${cols(`<span class="slot${moving && S.fits(sport, moving, s) ? " on" : ""}">${esc(s)}</span>`, p, i)}</tr>`; }).join("");
      const benchIds = L().rosters[id].filter((x) => !lu.includes(x));
      const bench = benchIds.map((x) => ctx.byId[x]).sort((a, b) => a.rank - b.rank).map((p) => `<tr class="${moving && p === moving ? "me" : ""}">${cols(`<span class="slot">BN</span>`, p, null)}</tr>`).join("") || `<tr><td colspan="6" class="empty">No one on the bench.</td></tr>`;
      const weeks = [curWeek()].concat(curWeek() < G.totalWeeks(L()) ? [curWeek() + 1] : []);
      return `<div class="wrap page">${teamHead(id)}
        <div class="row" style="flex-wrap:wrap">${weeks.length > 1 ? `<div class="seg" role="group" aria-label="Week">${weeks.map((x) => `<button type="button" data-week="${x}" aria-pressed="${x === w}">Week ${x}${x === L().week ? ", now" : ""}</button>`).join("")}</div>` : ""}
          ${game ? `<a class="pill" href="${matchHref(w, game.i)}" style="text-decoration:none">vs ${esc(T(game.a === id ? game.b : game.a).name)}: ${fmtS(game.a === id ? game.sa : game.sb)} to ${fmtS(game.a === id ? game.sb : game.sa)}</a>` : ""}
          <span class="grow"></span>${moving ? `<span class="ps">Moving <b>${esc(moving.n)}</b>: pick a highlighted slot.</span><button class="btn sm" data-here="BN">To bench</button><button class="btn sm" data-move="">Cancel</button>` : mine && !locked ? `<button class="btn sm" data-optimize>Start my best lineup</button>` : ""}</div>
        <div class="table-wrap"><table class="t"><thead><tr><th class="c">Slot</th><th>Player</th><th class="r hide-s">Rank</th><th class="r">${pts() ? "Pts" : "Value"}</th><th class="r hide-s">${pts() ? "Proj" : ""}</th><th class="act"></th></tr></thead><tbody>
          <tr class="sec"><td colspan="6">Starters</td></tr>${starters}<tr class="sec"><td colspan="6">Bench</td></tr>${bench}</tbody></table></div>
        ${mine ? `<p class="ps">${locked ? "This week is locked." : `Lineups lock when week ${w} starts. Starters left empty score nothing.`}</p>` : ""}</div>`;
    }
    function schedulePage(arg) {
      const id = arg !== "" && arg != null && L().teams[+arg] ? +arg : me() != null ? me() : 0;
      const rows = [];
      for (let w = 1; w <= G.totalWeeks(L()); w++) {
        const games = w <= L().settings.weeks ? L().schedule[w - 1] : w <= L().week ? G.playoffGames(L(), ctx, w) : [];
        const i = games.findIndex((g) => g[0] === id || g[1] === id);
        if (i < 0) { if (w > L().settings.weeks) rows.push(`<tr><td>Week ${w}</td><td colspan="3" class="ps">${w <= L().week ? "Out of the playoffs" : "Playoffs"}</td></tr>`); continue; }
        const [a, b] = games[i], opp = a === id ? b : a;
        const res = L().results[w] && L().results[w][i];
        const mineA = a === id;
        const r = res ? (res.w === "t" ? "T" : (res.w === "a") === mineA ? "W" : "L") : "";
        rows.push(`<tr${w === L().week ? ` class="me"` : ""}><td><a href="${matchHref(w, i)}">Week ${w}</a>${w > L().settings.weeks ? ` <span class="tag info">Playoffs</span>` : ""}</td><td>${teamName(T(opp), { owner: false })}</td><td class="r num">${res ? `<span class="${r === "W" ? "win" : r === "L" ? "loss" : ""}" style="font-weight:850">${r}</span> ${fmtS(mineA ? res.sa : res.sb)}-${fmtS(mineA ? res.sb : res.sa)}` : w === L().week ? `<span class="pill live">Live</span>` : ""}</td><td class="ps hide-s">${recOf(opp)}</td></tr>`);
      }
      return `<div class="wrap page">${teamHead(id)}<div class="table-wrap"><table class="t"><thead><tr><th>Week</th><th>Opponent</th><th class="r">Result</th><th class="hide-s">Their record</th></tr></thead><tbody>${rows.join("")}</tbody></table></div></div>`;
    }
    function tradeVM(t) {
      const mid = me();
      const label = { pending: "Pending", review: "Under review", accepted: "Accepted", rejected: "Rejected", cancelled: "Cancelled", vetoed: "Vetoed", countered: "Countered", failed: "Failed" }[t.status];
      let acts = "";
      if (t.status === "pending" && t.to === mid) acts = `<button class="btn sm win" data-tr-accept="${t.id}">Accept</button><button class="btn sm" data-tr-counter="${t.id}">Counter</button><button class="btn sm warn" data-tr-reject="${t.id}">Reject</button>`;
      else if (t.status === "pending" && t.from === mid) acts = `<span class="ps">Waiting on ${esc(T(t.to).name)}</span><span class="grow"></span><button class="btn sm" data-tr-cancel="${t.id}">Cancel offer</button>`;
      else if (t.status === "review") {
        const v = (t.votes || {})[mid], vetoes = Object.values(t.votes || {}).filter((x) => x === "veto").length;
        acts = `<span class="ps">Goes through ${U.ago(t.reviewEnds, now()).includes("ago") ? "soon" : new Date(t.reviewEnds).toLocaleString("en-US", { weekday: "short", hour: "numeric" })} unless ${G.vetoesNeeded(L(), t)} teams veto (${vetoes} so far)</span><span class="grow"></span>${G.voters(L(), t).includes(mid) ? (v ? `<span class="tag">${v === "veto" ? "You voted to veto" : "You approved"}</span>` : `<button class="btn sm" data-tr-ok="${t.id}">Approve</button><button class="btn sm warn" data-tr-veto="${t.id}">Veto</button>`) : ""}`;
      } else if (t.why) acts = `<span class="ps">${esc(T(t.to).name)}: &ldquo;${esc(t.why)}&rdquo;</span>`;
      return { id: t.id, status: t.status, statusLabel: label, from: T(t.from), to: T(t.to), give: t.give.map(playerVM), get: t.get.map(playerVM), faab: [t.faabGive, t.faabGet], note: t.note, when: U.ago(t.done || t.at, now()), acts, sub: t.counterOf ? "Counteroffer" : "" };
    }
    function tradesPage() {
      const mid = me();
      const all = L().trades.slice().reverse();
      const toMe = all.filter((t) => t.status === "pending" && t.to === mid), fromMe = all.filter((t) => t.status === "pending" && t.from === mid);
      const review = all.filter((t) => t.status === "review"), done = all.filter((t) => !["pending", "review"].includes(t.status) && (t.from === mid || t.to === mid || t.status === "accepted")).slice(0, 20);
      const sec = (title, list, empty) => `<div class="stack"><h2 style="margin:0;font-size:16px">${title}</h2>${list.length ? list.map((t) => U.tradeCard(sport, tradeVM(t))).join("") : `<p class="ps" style="margin:0">${empty}</p>`}</div>`;
      return `<div class="wrap page"><div class="head"><h1 class="disp">Trades</h1><span class="grow"></span>${mid != null ? `<button class="btn go" data-trade>Propose a trade</button>` : ""}</div>
        <div class="cols"><div class="stack">${sec("Offers for you", toMe, "No offers waiting.")}${sec("Your offers", fromMe, "You haven't sent any open offers.")}${sec("League review", review, "No trades under review.")}</div>
        <aside class="stack">${sec("Recent trades", done, "No trades yet.")}</aside></div></div>`;
    }
    function openTrade(other, want, prefill) {
      const mid = me();
      if (mid == null) return;
      const teams = L().teams;
      const roster = (id) => L().rosters[id].map((x) => ctx.byId[x]).filter(Boolean).sort((a, b) => b.$ - a.$ || a.rank - b.rank);
      const t0 = other != null ? other : teams.find((t) => t.id !== mid).id;
      U.tradeWindow({ sport, teams, me: mid, other: t0, roster, title: prefill && prefill.counterOf ? "Counteroffer" : "Propose a trade",
        value: (ps, faab) => G.sideValue(ctx, ps.map((p) => p.id), faab), faab: (id) => T(id).faab,
        roomFor: (tr) => Math.max(0, L().rosters[mid].length - tr.give.length + tr.get.length - G.maxRoster(L())),
        check: (tr) => G.tradeCheck(L(), ctx, Object.assign({ dropsTo: [] }, tr)),
        prefill: prefill || (want ? { get: [want] } : null),
        submit: (tr) => { const r = G.propose(L(), ctx, mid, tr.to, tr.give, tr.get, now(), tr); if (!r.ok) return r; save(); U.toast(`Offer sent to ${T(tr.to).name}.`); setTimeout(() => { G.tick(L(), ctx, now() + 1); save(); render(); }, 1200); render(); return r; } });
    }

    /* ---------- Matchup ---------- */
    function matchupPage(sub, arg) {
      let w = +sub || curWeek(), i = arg !== "" && arg != null ? +arg : null;
      w = Math.max(1, Math.min(w, curWeek()));
      const games = G.matchups(L(), ctx, w, frac(w));
      const m = i != null && games[i] ? games[i] : games.find((g) => isMe(g.a) || isMe(g.b)) || games[0];
      if (!m) return `<div class="wrap page"><p class="empty">No games this week.</p></div>`;
      const la = G.lineupFor(L(), ctx, m.a, w), lb = G.lineupFor(L(), ctx, m.b, w);
      const ptsA = (m.ta && m.ta.players) || {}, ptsB = (m.tb && m.tb.players) || {};
      const wk = G.WEEK[sport.key] || { weeks: 20 };
      const rows = L().settings.lineup.map((slot, k) => {
        const pa = la[k] && ctx.byId[la[k]], pb = lb[k] && ctx.byId[lb[k]];
        const xa = pa ? (pts() ? ptsA[pa.id] : pa.v) : null, xb = pb ? (pts() ? ptsB[pb.id] : pb.v) : null;
        return { slot, a: { p: pa, pts: xa, proj: pts() && pa && !m.final ? pa.v / wk.weeks : null, w: xa != null && xb != null && xa > xb }, b: { p: pb, pts: xb, proj: pts() && pb && !m.final ? pb.v / wk.weeks : null, w: xa != null && xb != null && xb > xa } };
      });
      const weeks = Array.from({ length: curWeek() }, (_, k) => k + 1);
      return `<div class="wrap page">
        <div class="row" style="flex-wrap:wrap"><div class="chips" role="group" aria-label="Week">${weeks.map((x) => `<button type="button" data-mweek="${x}" aria-pressed="${x === w}">${x > L().settings.weeks ? "P" + (x - L().settings.weeks) : "Wk " + x}</button>`).join("")}</div></div>
        <div class="card">${U.versus(versusVM(w, m))}</div>
        <div class="cols2" style="grid-template-columns:minmax(0,1fr)">${U.vsTable(sport, rows, pts() ? { a: m.sa, b: m.sb } : null, (x) => (x == null ? "-" : pts() ? x.toFixed(1) : x.toFixed(1)))}</div>
        ${!pts() ? `<p class="ps">Category leagues show each starter's season value; the category totals above are this week's.</p>` : ""}
        <div class="stack" style="gap:8px"><b class="ps">Other games, week ${w}</b>${U.scoreboard(gamesVM(w), fmtS)}</div></div>`;
    }

    /* ---------- Players ---------- */
    function statusOf(p) {
      const own = ctx.own[p.id];
      if (own != null) return `<a href="${teamHref(own)}" class="row" style="gap:6px;text-decoration:none;color:inherit">${teamAv(T(own), "sm")}<span class="ps">${esc(T(own).abbr)}</span></a>`;
      if (G.onWaivers(L(), p.id, now())) return `<span class="tag gold" title="On waivers until ${new Date(L().waivers[p.id]).toLocaleString("en-US", { weekday: "short", hour: "numeric" })}">W</span>`;
      return `<span class="tag win">FA</span>`;
    }
    function playersPage(sub) {
      const mid = me(), w = watch();
      if (sub === "claims") return claimsPage();
      let rows = opts.players.filter((p) => U.passes(sport, p, ui.pf));
      if (sub === "fa") rows = rows.filter((p) => ctx.own[p.id] == null);
      if (sub === "watch") rows = rows.filter((p) => w.includes(p.id));
      const actions = (p) => {
        const own = ctx.own[p.id];
        const star = mid != null ? `<button class="star${w.includes(p.id) ? " on" : ""}" data-watch="${esc(p.id)}" aria-label="Watch">${w.includes(p.id) ? "&#9733;" : "&#9734;"}</button>` : "";
        if (mid == null) return star;
        if (own == null) return `${star}<button class="btn icon add" data-add="${esc(p.id)}" aria-label="${G.onWaivers(L(), p.id, now()) ? "Claim" : "Add"} ${esc(p.n)}" title="${G.onWaivers(L(), p.id, now()) ? "Put in a claim" : "Add"}">+</button>`;
        if (own === mid) return `${star}<button class="btn icon drop" data-drop="${esc(p.id)}" aria-label="Drop ${esc(p.n)}">&minus;</button>`;
        return `${star}<button class="btn icon trade" data-trade="${own}" data-want="${esc(p.id)}" aria-label="Trade for ${esc(p.n)}">&#8644;</button>`;
      };
      const cols = U.poolColumns(sport, { group: U.groupOf(sport, ui.pf), scoring: L().scoring, owner: statusOf, ownerSort: (p) => (ctx.own[p.id] == null ? -1 : ctx.own[p.id]), actions, extra: pts() ? [] : [] });
      rows = U.sortRows(rows, cols, ui.psort);
      return `<div class="wrap page"><div class="head"><h1 class="disp">${sub === "fa" ? "Free agents" : sub === "watch" ? "Watchlist" : "All players"}</h1><span class="ps">${rows.length} players. FA is free to add now; W is on waivers, so put in a claim.</span></div>
        <div class="tools">${U.search(ui.pf)}</div>${U.posFilter(sport, ui.pf.pos)}
        ${U.table({ cols, rows, sort: ui.psort, dense: true, limit: 250, id: "fk-players", empty: sub === "watch" ? "Star players to watch them here." : "No one matches.", rowAttr: (p) => `data-player="${esc(p.id)}"${ctx.own[p.id] === mid ? ' class="me"' : ""}` })}</div>`;
    }
    function claimsPage() {
      const mid = me();
      const mine = L().claims.filter((c) => c.team === mid).slice().reverse();
      const open = mine.filter((c) => c.status === "open"), past = mine.filter((c) => c.status !== "open").slice(0, 20);
      const row = (c) => `<li style="grid-template-columns:minmax(0,1fr) auto auto;align-items:center"><div class="what">${U.txLine(sport, "add", ctx.byId[c.add])}${c.drop ? U.txLine(sport, "drop", ctx.byId[c.drop]) : ""}</div><b class="dollar">$${c.bid}</b>${c.status === "open" ? `<button class="btn sm" data-unclaim="${c.id}">Cancel</button>` : `<span class="status ${c.status === "won" ? "accepted" : "rejected"}">${c.status === "won" ? "Won" : c.status === "lost" ? `Lost to ${esc(T(c.lostTo).abbr)}` : c.status === "cancelled" ? "Cancelled" : "Failed"}</span>`}</li>`;
      return `<div class="wrap page"><div class="head"><h1 class="disp">Waiver claims</h1><span class="ps">Claims run when the week ends. Highest bid wins; ties go to waiver priority (you're ${ord(T(mid).priority + 1)}). You have $${T(mid).faab}.</span></div>
        <div class="cols2"><div class="card"><div class="mod-h"><h2>Pending</h2></div>${open.length ? `<ul class="feed">${open.map(row).join("")}</ul>` : `<p class="empty">No pending claims. Players on waivers have a W on the Players page.</p>`}</div>
        <div class="card"><div class="mod-h"><h2>Results</h2></div>${past.length ? `<ul class="feed">${past.map(row).join("")}</ul>` : `<p class="empty">Nothing yet.</p>`}</div></div></div>`;
    }
    // Add a free agent (or claim one on waivers), choosing who to drop.
    function addDialog(pid) {
      const mid = me(), p = ctx.byId[pid];
      const onW = G.onWaivers(L(), pid, now());
      const full = L().rosters[mid].length >= G.maxRoster(L());
      const ros = L().rosters[mid].map((x) => ctx.byId[x]).sort((a, b) => a.vor - b.vor);
      U.dialog(`<div class="pc-h">${U.playerAv(sport, p, "lg")}<div><h3 class="disp">${onW ? "Claim" : "Add"} ${esc(p.n)}</h3><div class="ps">${posChips(sport, p)} ${esc(p.t)}, ${esc(p.prank)}${onW ? `. On waivers: claims run when the week ends.` : ""}</div></div></div>
        <form class="stack">${full ? `<div class="field"><span class="lbl">Drop a player to make room</span><div class="table-wrap" style="max-height:44dvh"><table class="t dense"><tbody>${ros.map((q, i) => `<tr><td style="width:28px"><input type="radio" name="drop" value="${esc(q.id)}" id="d${i}"${i === 0 ? " checked" : ""}></td><td><label for="d${i}" style="cursor:pointer">${pname(sport, q, esc(q.prank))}</label></td><td class="r ps">#${q.rank}</td></tr>`).join("")}</tbody></table></div></div>` : `<p class="ps" style="margin:0">You have an open roster spot.</p>`}
          ${onW && L().settings.waivers === "faab" ? `<div class="field"><label for="bid">Your FAAB bid (you have $${T(mid).faab})</label><input type="number" id="bid" name="bid" min="0" max="${T(mid).faab}" value="${Math.min(T(mid).faab, Math.max(1, Math.round((p.$ || 1) / 4)))}"></div>` : ""}
          <div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn go">${onW ? "Put in the claim" : full ? "Add and drop" : "Add"}</button></div></form>`,
        (fd) => {
          const drop = fd.get("drop") || null;
          if (onW) return act(() => G.claim(L(), ctx, mid, pid, drop, +(fd.get("bid") || 0), now()), "Claim in. It runs when the week ends.");
          return act(() => G.addDrop(L(), ctx, mid, pid, drop, now()), `${p.n} added.`);
        });
    }
    function dropDialog(pid) {
      const p = ctx.byId[pid];
      U.confirm(`Drop ${p.n}?`, `He goes on waivers for ${L().settings.waiverHours} hours, then becomes a free agent.`, "Drop him", () => act(() => G.addDrop(L(), ctx, me(), null, pid, now()), `${p.n} dropped.`));
    }
    function playerCard(pid) {
      const p = ctx.byId[pid], mid = me(), own = ctx.own[pid];
      if (!p) return;
      let actions = "";
      if (mid != null) {
        const w = watch();
        actions += `<button class="btn" data-card="watch">${w.includes(pid) ? "Unwatch" : "Watch"}</button>`;
        if (own == null) actions += `<button class="btn go" data-card="add">${G.onWaivers(L(), pid, now()) ? "Put in a claim" : "Add"}</button>`;
        else if (own === mid) actions += `<button class="btn warn" data-card="drop">Drop</button>`;
        else actions += `<button class="btn go" data-card="trade">Trade for him</button>`;
      }
      const status = own != null ? `${teamAv(T(own), "sm")} On ${esc(T(own).name)}` : G.onWaivers(L(), pid, now()) ? `<span class="tag gold">On waivers</span>` : `<span class="tag win">Free agent</span>`;
      const Dl = U.dialog(U.playerCard(sport, p, { scoring: L().scoring, actions, status }), null, { wide: true });
      $$("[data-card]", Dl).forEach((b) => b.addEventListener("click", () => {
        const a = b.dataset.card; Dl.close();
        if (a === "watch") { const w = watch(); const i = w.indexOf(pid); if (i >= 0) w.splice(i, 1); else w.push(pid); save(); render(); }
        else if (a === "add") addDialog(pid);
        else if (a === "drop") dropDialog(pid);
        else if (a === "trade") openTrade(own, pid);
      }));
    }

    /* ---------- render ---------- */
    function render() {
      if (U.dialogOpen()) return;
      const r = route();
      const tabs = TABS().map(([k, n]) => [k, n, k === "team" ? pendingTrades() : 0]);
      const subs = subsOf(r.tab);
      const hrefOf = (t, s) => "#" + t + (s ? "/" + s : "");
      opts.top.innerHTML = U.shell({ brand: opts.brand, title: opts.switcher ? opts.switcher() : "", tabs, tab: r.tab, subs, sub: r.sub, hrefOf, right: opts.right ? opts.right() : "" });
      const keep = $("#fk-players") ? $("#fk-players").scrollTop : 0;
      const focus = document.activeElement && document.activeElement.id;
      let html = "";
      if (r.tab === "league") html = { overview, standings: standingsPage, scoreboard: scoreboardPage, tx: txPage, settings: settingsPage }[r.sub]();
      else if (r.tab === "team") html = { roster: () => rosterPage(r.arg), schedule: () => schedulePage(r.arg), trades: tradesPage }[r.sub]();
      else if (r.tab === "matchup") html = matchupPage(r.sub, r.arg);
      else if (r.tab === "players") html = playersPage(r.sub);
      else if (r.tab === "draft") html = draftPage();
      else if (r.tab === "commish") html = `<div class="wrap page">${opts.commishTools()}</div>`;
      opts.el.innerHTML = html;
      if ($("#fk-players")) $("#fk-players").scrollTop = keep;
      if (focus === "fk-q") { const f = $("#fk-q"); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }
    }

    opts.el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-add],[data-drop],[data-trade],[data-move],[data-here],[data-optimize],[data-week],[data-watch],[data-unclaim],[data-sbweek],[data-mweek],[data-txf],[data-fpos],[data-tr-accept],[data-tr-reject],[data-tr-counter],[data-tr-cancel],[data-tr-ok],[data-tr-veto],th[data-sort]");
      if (b) {
        e.preventDefault(); e.stopPropagation();
        const d = b.dataset, mid = me();
        if (d.add) addDialog(d.add);
        else if (d.drop) dropDialog(d.drop);
        else if (d.trade !== undefined && b.hasAttribute("data-trade")) openTrade(d.trade === "" ? null : +d.trade, d.want || null);
        else if (d.move !== undefined && b.hasAttribute("data-move")) { ui.moving = d.move || null; render(); }
        else if (d.here !== undefined && b.hasAttribute("data-here")) { const w = ui.week && ui.week >= L().week ? ui.week : curWeek(); const pid = ui.moving; ui.moving = null; act(() => G.move(L(), ctx, mid, w, pid, d.here === "BN" ? "BN" : +d.here)); }
        else if (b.hasAttribute("data-optimize")) { const w = ui.week && ui.week >= L().week ? ui.week : curWeek(); delete (L().lineups[w] || {})[mid]; act(() => G.setLineup(L(), ctx, mid, w, G.lineupFor(L(), ctx, mid, w)), "Best lineup set."); }
        else if (d.week) { ui.week = +d.week; render(); }
        else if (d.watch) { const w = watch(); const i = w.indexOf(d.watch); if (i >= 0) w.splice(i, 1); else w.push(d.watch); save(); render(); }
        else if (d.unclaim) act(() => G.cancelClaim(L(), +d.unclaim), "Claim cancelled.");
        else if (d.sbweek) { ui.sbWeek = +d.sbweek; render(); }
        else if (d.mweek) { location.hash = `#matchup/${d.mweek}`; }
        else if (d.txf !== undefined && b.hasAttribute("data-txf")) { ui.txf = d.txf; render(); }
        else if (d.fpos !== undefined && b.hasAttribute("data-fpos")) { ui.pf.pos = d.fpos; render(); }
        else if (d.trAccept) act(() => G.respond(L(), ctx, +d.trAccept, true, now()), L().settings.tradeReview === "none" ? "Trade accepted." : "Accepted. The league has a day to review it.");
        else if (d.trReject) act(() => G.respond(L(), ctx, +d.trReject, false, now()), "Offer rejected.");
        else if (d.trCancel) act(() => G.cancelTrade(L(), +d.trCancel, now()), "Offer cancelled.");
        else if (d.trOk) act(() => G.vote(L(), ctx, +d.trOk, mid, false, now()), "You approved the trade.");
        else if (d.trVeto) act(() => G.vote(L(), ctx, +d.trVeto, mid, true, now()), "You voted to veto.");
        else if (d.trCounter) { const t = L().trades.find((x) => x.id === +d.trCounter); openTrade(t.from, null, { give: t.get.slice(), get: t.give.slice(), faabGive: t.faabGet, faabGet: t.faabGive, counterOf: t.id }); }
        else if (d.sort) { const cols = U.poolColumns(sport, { scoring: L().scoring, group: U.groupOf(sport, ui.pf), owner: statusOf, ownerSort: (p) => ctx.own[p.id] }); ui.psort = U.nextSort(ui.psort, d.sort, cols); render(); }
        return;
      }
      const pl = e.target.closest("[data-player]");
      if (pl && !e.target.closest("a")) { e.preventDefault(); playerCard(pl.dataset.player); }
    });
    opts.el.addEventListener("input", (e) => { if (e.target.id === "fk-q") { ui.pf.q = e.target.value; render(); } });
    opts.el.addEventListener("change", (e) => { if (e.target.id === "team-pick") { const r = route(); location.hash = `#team/${r.sub || "roster"}/${e.target.value}`; } });
    opts.top.addEventListener("click", (e) => { const t = e.target.closest("[data-trade]"); if (t) { e.preventDefault(); openTrade(null); } });
    window.addEventListener("hashchange", () => { ui.moving = null; render(); window.scrollTo(0, 0); });
    render();
    return { render, refresh: () => { refresh(); render(); }, get ctx() { return ctx; }, openTrade };
  }

  FK.ui.leagueApp = leagueApp;
})(this);
