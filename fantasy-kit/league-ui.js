/* Fantasy Kit: a whole league site on top of FK.league, built from the FK.ui modules.
   Load after ui.js and league.js.

   FK.ui.leagueApp(opts) renders every page of a league into opts.el and the shell into opts.top:
     League   Overview, Standings, Scoreboard, Transactions, Draft results, Settings
     My Team  Roster and lineup, Schedule, Trades (offers, the trade window, review votes)
     Matchup  the head-to-head for any week
     Players  Free agents, All players, Watchlist, Waiver claims
     Commish  whatever opts.commishTools() returns
   opts: { top, el, sport, players, league(), save(L), me(), now(), frac(w) (how much of week w has played),
           brand, right(), switcher, commishTools(), draftHref, notice() (html above every page) } */
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
    const fmtS = (x) => (x == null ? "-" : pts() ? (Math.abs(x) < 0.05 ? 0 : x).toFixed(1) : String(Math.round(x) || 0));
    const ui = { moving: null, week: null, pf: { q: "", pos: "" }, psort: { k: "rank", dir: 1 }, pshow: "fa", txf: "", sbWeek: null };
    const curWeek = () => Math.min(L().week, G.totalWeeks(L()));
    const over = () => L().week > G.totalWeeks(L());
    // real scores: nothing is live until the week's first game kicks off (a football Wednesday is still "Projected")
    // Has any of this week's games started? The league's kickoff times if it has them, else the live feed's teams, else
    // for football the week's first game (Thursday night; the week opens Tuesday), so a Wednesday never reads "Live".
    const anyKicked = (w) => {
      const k = L().kick;
      if (k && k.week === w && k.teams) return Object.values(k.teams).some((t) => t <= now());
      const lv = liveWeek(w);
      if (lv && lv.teams && Object.keys(lv.teams).length) return Object.values(lv.teams).some((t) => t.played || t.live);
      return L().sport !== "nfl" || now() >= G.weekStart(L(), w) + 60 * 36e5;
    };
    const noKicks = (w) => !!(L().settings.real && w === L().week && !anyKicked(w));
    const frac = (w) => { if (w < L().week) return 1; if (noKicks(w)) return 0; const f = opts.frac ? opts.frac(w) : 0; return f < 0.01 ? 0 : f; };
    const standings = () => G.standings(L());
    const gl = () => G.isGuillotine(L());
    // moves are open while the season runs and your team is alive; trades also stop at the deadline
    const canMove = () => me() != null && !over() && G.isAlive(L(), me());
    // a dynasty keeps trading through the offseason, until next season starts
    const canTrade = () => me() != null && L().settings.trades !== false && (G.offseason(L()) || (canMove() && !(L().settings.deadline && L().week > L().settings.deadline)));
    const bb = () => !!L().settings.bestBall;
    const roto = () => G.isRoto(L());
    const recOf = (id) => {
      const r = standings().find((x) => x.team === id);
      if (!r) return "";
      if (gl()) return r.alive ? (over() ? "Champion" : "Alive") : `Out week ${r.out}`;
      if (roto()) return `${ord(r.rank)}, ${fmtPts(r.pts)} pts`;
      return `${r.w}-${r.l}${r.t ? "-" + r.t : ""}`;
    };
    // the chopping block for a week, computed once per render (the chop odds take a few hundred simulations)
    let blockCache = {};
    const blockOf = (w) => { const k = w + ":" + frac(w).toFixed(3); return (blockCache[k] = blockCache[k] || G.block(L(), ctx, w, frac(w))); };
    const blockRow = (w, id) => blockOf(w).find((r) => r.team === id);
    const runAt = () => G.waiverRunAt(L());
    const whenRun = () => new Date(runAt()).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" });
    // the next waiver run: this week's if it hasn't happened, otherwise next week's
    const claimsRun = () => {
      if (L().settings.waiverAt == null) {
        const next = L().claims.filter((c) => c.team === me() && c.status === "open").map((c) => G.clearAt(L(), c.add)).filter((x) => x > now()).sort((a, b) => a - b)[0];
        return next ? `Each claim runs when its player clears waivers. Next: ${G.waiverWhen(next)}.` : "Each claim runs when its player clears waivers, at 3 AM Eastern.";
      }
      const at = now() < runAt() ? runAt() : G.waiverRunAt(L(), L().week + 1);
      return `Claims run ${new Date(at).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" })}.`;
    };
    const LOCK = `<svg class="lk-i" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="1.6" fill="currentColor"/><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>`;
    /* ---------- the heist's results ---------- */
    // a player's heist mark: stolen (1.5x for his new team) or jinxed (half)
    const heistTag = (p) => { const m = p && L().pmult && L().pmult[p.id]; return !m || m === 1 ? "" : m > 1 && L().settings.cap ? ` <span class="tag win" title="Nobody else picked him: he scores ${m}x">Unique ${m}x</span>` : m > 1 ? ` <span class="tag win" title="Stolen in the heist: scores ${m}x">${m}x</span>` : ` <span class="tag loss" title="Jinxed in the heist: scores ${m === 0.5 ? "half" : m + "x"}">Jinxed</span>`; };
    // One matchup's heist, both sides: what each team shielded, and every strike with how it landed
    function heistCard(t, opts2 = {}) {
      const H = L().heist; if (!H) return "";
      const pair = H.pairs.find((x) => x.includes(t)); if (!pair) return "";
      const nm = (pid) => esc((ctx.byId[pid] || {}).n || "a player");
      const line = (e, i) => `<li class="${e.ok ? "ok" : "no"}" style="--i:${i}"><span class="hz-k ${e.type}">${e.type === "steal" ? "Steal" : "Jinx"}</span><span><b>${esc(T(e.by).abbr)}</b> ${e.type === "steal" ? "went for" : "jinxed"} <b>${nm(e.pid)}</b></span><b class="hz-r">${e.ok ? (e.type === "steal" ? "Stolen" : "Halved") : "Blocked"}</b></li>`;
      const evs = H.events.filter((e) => pair.includes(e.by));
      const side = (x) => `<div class="hz-sd"><div class="hz-t">${teamAv(T(x), "sm")}<b>${esc(T(x).name)}</b></div><p class="ps">Shielded ${(H.shields[x] || []).map(nm).join(", ") || "no one"}.</p><ul class="hz-ev">${evs.filter((e) => e.by === x).map(line).join("") || `<li class="none"><span class="ps">No strikes.</span></li>`}</ul></div>`;
      const lost = isMe(t) && L().rosters[t].length < G.maxRoster(L()) && !over() ? `<div class="alert"><span>A steal left a spot open in your lineup. Pick up a free agent for it before his game starts: he scores normal points.</span><a class="btn sm go" href="#players/fa">Free agents</a></div>` : "";
      const order = isMe(pair[1]) ? [pair[1], pair[0]] : pair;   // your side first
      const note = `Stolen players score ${F_HEIST().steal}x for their new team; jinxed ones score half.`;
      return `<div class="card hz-card${opts2.reveal ? " reveal" : ""}${opts2.stack ? " stack" : ""}">${opts2.reveal ? `<p class="ps" style="margin:0 0 4px">${note}</p>` : `<div class="mod-h"><h2>The heist</h2><span class="ps">${note}</span></div>`}${lost}<div class="hz-sds">${side(order[0])}${side(order[1])}</div></div>`;
    }
    const F_HEIST = () => Object.assign({}, FK.draft.HEIST, (L().draft && L().draft.season && L().draft.season.heist) || {});
    // the first time you open the league after its heist: the results, revealed one by one
    function heistReveal() {
      const H = L().heist, mid = me(); if (!H || mid == null || U.dialogOpen()) return;
      const key = "fk-heist-seen:" + (L().created || "") + ":" + (L().name || "");
      try { if (localStorage.getItem(key)) return; localStorage.setItem(key, "1"); } catch (e) { return; }
      U.dialog(`<h3 class="disp">The heist</h3>${heistCard(mid, { reveal: true })}<div class="acts"><button class="btn go" data-close>On to the week</button></div>`, null, { wide: true });
    }
    const act = (fn, okMsg) => { const r = fn(); if (r && r.ok === false) { U.toast(r.why, true); return false; } save(); if (okMsg) U.toast(okMsg); if (U.dialogOpen()) setTimeout(render, 0); else render(); return true; };
    // review windows and offer lifetimes read in plain time
    const fmtHours = (h) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} minutes` : h < 48 ? `${Math.round(h)} hour${Math.round(h) === 1 ? "" : "s"}` : `${Math.round(h / 24)} days`);
    const watch = () => { const w = L().watch; return (w[me()] = w[me()] || []); };

    /* ---------- routing ---------- */
    const TABS = () => [["league", "League"], ["team", "My Team"], ["matchup", gl() ? "The block" : roto() ? "Categories" : allplay1() ? "Board" : "Matchup"], ["players", "Players"], ["draft", "Draft"]].concat(opts.commishTools ? [["commish", "Commissioner"]] : []);
    function subsOf(tab) {
      if (tab === "league") return [["overview", "Overview"]].concat(opts.chat ? [["chat", "Chat", opts.chat.unread()]] : []).concat([["standings", gl() ? "Survivors" : "Standings"], ["scoreboard", gl() ? "Weekly results" : roto() ? "By week" : "Scoreboard"]].concat(recapOn() && lastDone() >= 1 ? [["recap", "Recap"]] : []).concat([["managers", "Managers"]]).concat(opts.dues ? [["dues", "Dues"]] : []).concat([["history", "History"], ["rules", "Rules"]]));
      if (tab === "team") return [["roster", "Roster"]].concat(roto() ? [] : [["schedule", gl() ? "History" : "Schedule"]]).concat(L().settings.trades === false ? [] : [["trades", "Trades", pendingTrades()]]);
      if (tab === "players") return [["fa", "Free agents"], ["all", "All players"], ["watch", "Watchlist"], ["claims", "Waiver claims", L().claims.filter((c) => c.team === me() && c.status === "open").length], ["tx", "Transactions"]];
      return [];
    }
    const pendingTrades = () => L().trades.filter((t) => (t.status === "pending" && t.to === me()) || (t.status === "review" && G.voters(L(), t).includes(me()) && !(t.votes || {})[me()])).length;
    function route() {
      const r = U.route("league");
      // pages that moved: transactions went under Players, settings became Rules
      if (r.tab === "league" && r.sub === "tx") { r.tab = "players"; history.replaceState(null, "", "#players/tx"); }
      if (r.tab === "league" && r.sub === "settings") { r.sub = "rules"; history.replaceState(null, "", "#league/rules"); }
      if (!TABS().some((t) => t[0] === r.tab)) r.tab = "league";
      const subs = subsOf(r.tab);
      if (subs.length && !subs.some((s) => s[0] === r.sub)) { r.arg = r.tab === "team" && /^\d+$/.test(r.sub) ? r.sub : r.arg; r.sub = subs[0][0]; }
      return r;
    }
    const teamHref = (id) => `#team/roster/${id}`;
    const matchHref = (w, i) => `#matchup/${w}/${i}`;

    // pick your opponent: who chose this matchup
    const pickedBy = (w, m) => { const p = L().picked && L().picked[w]; return p ? (p.includes(m.a) ? m.a : p.includes(m.b) ? m.b : null) : null; };
    /* ---------- view models ---------- */
    function gamesVM(w) {
      const ms = G.matchups(L(), ctx, w, frac(w));
      return ms.map((m) => ({
        href: matchHref(w, m.i), me: isMe(m.a) || isMe(m.b), status: m.final ? "final" : m.live ? "live" : "proj",
        label: m.final ? "Final" : m.live ? "Live" : pts() ? `Week ${w}, projected` : `Week ${w}`, sub: w > L().settings.weeks ? kindName(m.kind, w) : pickedBy(w, m) ? `${T(pickedBy(w, m)).abbr}'s pick` : "",
        a: { team: T(m.a), score: m.final || m.live ? m.sa : pts() ? m.pa : null, rec: recOf(m.a) }, b: { team: T(m.b), score: m.final || m.live ? m.sb : pts() ? m.pb : null, rec: recOf(m.b) }, m,
        wp: m.final ? null : m.winProb,
      })).sort((x, y) => (y.me ? 1 : 0) - (x.me ? 1 : 0));   // your game first
    }
    function versusVM(w, m) {
      if (isMe(m.b)) m = flip(m);
      const live = !m.final;
      const pj = live && m.proj ? m.proj : null;
      const cats = !pts() && m.cats ? sc().cats.map((c) => { const [x, y, d] = m.cats[c.k]; const f = c.fmt || ((v) => (Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1))); const q = pj && pj.probs[c.k], px = pj && pj.cats[c.k]; return { label: c.label, fa: f(x), fb: f(y), d, p: q, pa: px ? f(px[0]) : null, pb: px ? f(px[1]) : null }; }) : null;
      // a category week projects to a record: "Projected 6-3"
      const rec = (x, y, t) => `${x}-${y}${t ? `-${t}` : ""}`;
      return { a: { team: T(m.a), rec: recOf(m.a), score: m.sa, proj: live && pts() ? m.pa : null, projText: pj ? `Projected ${rec(pj.sa, pj.sb, pj.ties)}` : null }, b: { team: T(m.b), rec: recOf(m.b), score: m.sb, proj: live && pts() ? m.pb : null, projText: pj ? `Projected ${rec(pj.sb, pj.sa, pj.ties)}` : null },
        wp: live ? m.winProb : null, status: m.final ? "Final" : m.live ? `Live, ${Math.round((m.frac || 0) * 100)}% played` : "Projected", live: m.live, cats, fmt: fmtS };
    }
    // the same game with the sides swapped, so your team reads first
    function flip(m) {
      const cats = m.cats ? Object.fromEntries(Object.entries(m.cats).map(([k, [x, y, d]]) => [k, [y, x, -d]])) : m.cats;
      const proj = m.proj ? { cats: Object.fromEntries(Object.entries(m.proj.cats).map(([k, [x, y, d]]) => [k, [y, x, -d]])), sa: m.proj.sb, sb: m.proj.sa, ties: m.proj.ties, probs: Object.fromEntries(Object.entries(m.proj.probs).map(([k, q]) => [k, 1 - q])) } : m.proj;
      return Object.assign({}, m, { proj, a: m.b, b: m.a, sa: m.sb, sb: m.sa, pa: m.pb, pb: m.pa, ta: m.tb, tb: m.ta, w: m.w === "a" ? "b" : m.w === "b" ? "a" : m.w, winProb: m.winProb == null ? null : 1 - m.winProb, cats, outlook: m.outlook ? [m.outlook[1], m.outlook[0]] : m.outlook });
    }
    // with the live feed: "Playing now", "2 games left", or nothing to say
    function liveLeft(p, w) {
      const R = (opts.hooks || {}).real, lv = R && R.live, rw = G.realWeek(L(), ctx, w), t = lv && lv.teams && lv.teams[p.t];
      if (!t || !rw || rw.start !== lv.start) return "";
      return t.live ? "Playing now" : t.left ? `${t.left} game${t.left === 1 ? "" : "s"} left` : t.played ? "Done this week" : "No games this week";
    }
    /* ---------- gameday: each pro team's games this week, from the live feed ---------- */
    // a one-day league (basketball's day slates): its night's games, inside the live feed's week
    const dayL = () => { const sl = L().settings.slate; return sl && sl.day && Array.isArray(sl.list) ? sl : null; };
    const liveWeek = (w) => {
      const R = (opts.hooks || {}).real, lv = R && R.live, d = dayL();
      if (d) return lv && lv.start && lv.start <= d.day && d.day <= lv.end ? lv : null;
      const rw = G.realWeek(L(), ctx, w); return lv && rw && rw.start === lv.start ? lv : null;
    };
    const gamesOf = (p, w) => {
      const lv = liveWeek(w); if (!(lv && lv.games && p && p.t)) return null;
      const gs = lv.games[p.t] || [], d = dayL();
      if (!d) return gs;
      const ids = new Set(d.list.map((g) => g.id));
      return gs.filter((g) => ids.has(g.id));
    };
    // the game that matters now: one being played, else the next, else the last
    const gameNow = (gs) => FK.gameday.current(gs, now());
    const kick = (at) => new Date(at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }).replace(":00", "");
    // "Sun 1 PM vs NYJ", "Q3 4:21, 17-10", "Final, W 24-17", plus "2 of 4 played" for the daily sports
    function gameChip(p, w) {
      const gs = gamesOf(p, w);
      if (!gs) return "";
      if (!gs.length) return `<span class="gm none">No game this week</span>`;
      const g = gameNow(gs), done = gs.filter((x) => x.state === "post").length;
      const of = gs.length > 1 ? `<span class="gm-of">${done} of ${gs.length} played</span>` : "";
      const lv = liveWeek(w), R = (opts.hooks || {}).real;
      const box = (game) => {
        const line = FK.gameday.line(sport.key, p, game, lv);
        const stats = FK.gameday.stats(sport.key, p, line, R);
        return stats.length ? `<dl class="game-stats" aria-label="Game box score for ${esc(p.n)}">${stats.map(([k,v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` : `<span class="ps game-missing">${game.state === "pre" ? "Stats appear after the game starts" : "Awaiting game stats"}</span>`;
      };
      const others = gs.filter(x => x.id !== g.id);
      return oneGame(g) + of + box(g) + (others.length ? `<details class="game-history"><summary>Other games this week</summary>${others.map(x => `<div class="game-history-row">${oneGame(x)}${box(x)}</div>`).join("")}</details>` : "");
    }
    // one game as a chip: kickoff, live clock and score, or the final
    function oneGame(g) {
      const vs = `${g.home ? "vs" : "@"} ${esc(g.opp)}`;
      // ESPN's "4:21 3rd" reads better as "Q3 4:21"
      const clock = String(g.detail || "Live").replace(/^(\d+:\d+)\s+(\d)(st|nd|rd|th)$/, (x, c, q) => (sport.key === "nfl" ? `Q${q} ${c}` : `${q}${{ 1: "st", 2: "nd", 3: "rd" }[q] || "th"} ${c}`));
      if (g.state === "in") return `<span class="gm live"><i aria-hidden="true"></i>${esc(clock)}${g.us != null ? `, ${g.us}-${g.them}` : ""} ${vs}</span>`;
      if (g.state === "post") return `<span class="gm done">Final, ${g.us > g.them ? "W" : g.us < g.them ? "L" : "T"} ${g.us}-${g.them} ${vs}</span>`;
      return `<span class="gm">${esc(kick(g.at))} ${vs}</span>`;
    }
    // how far a football game has gone, 0 to 1, from ESPN's clock ("4:21 3rd", "Halftime", "End of 2nd")
    function progress(g) {
      if (!g || g.state === "pre") return 0;
      if (g.state === "post") return 1;
      const d = String(g.detail || ""), q = /(\d)(st|nd|rd|th)/.exec(d), clock = /(\d+):(\d+)/.exec(d);
      if (/half/i.test(d)) return 0.5;
      if (!q) return 0.5;
      const left = clock ? (+clock[1] * 60 + +clock[2]) / 900 : /end/i.test(d) ? 0 : 1;
      return Math.min(1, (Math.min(4, +q[1]) - left) / 4);
    }
    // a football player's projection for the week: Sleeper's, scored the league's way, less the share of his game already played
    function weekProj(p, w) {
      const lv = liveWeek(w), line = lv && lv.proj && lv.proj[p.id], R = (opts.hooks || {}).real;
      if (!line || !R || !R.cols) return null;
      return G.realPts({ line: R.line, cols: R.cols }, sc(), line, p);
    }
    // what a scoring change from the live feed was, in a few words: "rushing TD, 12 rush yd"
    const PLAY = { nfl: [["pass_td", "TD pass", "TD passes"], ["rush_td", "rushing TD", "rushing TDs"], ["rec_td", "receiving TD", "receiving TDs"], ["def_td", "defensive TD", "defensive TDs"], ["fgm", "field goal", "field goals"], ["xpm", "extra point", "extra points"], ["def_int", "interception", "interceptions"], ["def_sack", "sack", "sacks"], ["pass_int", "interception thrown", "interceptions thrown"], ["fum_lost", "fumble lost", "fumbles lost"], ["rec", "catch", "catches"], ["pass_yd", "pass yd"], ["rush_yd", "rush yd"], ["rec_yd", "rec yd"]],
      nba: [["pts", "PTS"], ["reb", "REB"], ["ast", "AST"], ["stl", "STL"], ["blk", "BLK"], ["tpm", "3PM"], ["tov", "TO"]],
      mlb: [["hr", "HR"], ["r", "R"], ["rbi", "RBI"], ["sb", "SB"], ["h", "H"], ["w", "W"], ["sv", "SV"], ["k", "K"], ["er", "ER"]] };
    function playText(d) {
      const R = (opts.hooks || {}).real; if (!R) return "";
      const bits = [];
      const cols = R.cols ? { _: R.cols } : R.lines || {};
      for (const [key, one, many] of PLAY[sport.key] || []) for (const [ln, cs] of Object.entries(cols)) {
        const row = Array.isArray(d) ? d : d[ln]; const i = cs.indexOf(key); if (!row || i < 0) continue;
        const v = Math.round(row[i] * 10) / 10; if (!v) continue;
        bits.push(many === undefined ? `${v > 0 ? "" : ""}${v} ${one}` : Math.abs(v) === 1 ? `${v < 0 ? "lost " : ""}${one}` : `${v} ${many}`);
      }
      return bits.slice(0, 3).join(", ");
    }
    // A category player's week in a few words: the first three counting categories, like "62 PTS, 21 REB, 9 AST".
    function weekLine(p, w) {
      if (frac(w) <= 0) return "Yet to play";
      const line = G.playerWeek(L(), ctx, p, w, frac(w));
      // a real week: no games yet means no games yet, not a zero
      if (G.realWeek(L(), ctx, w)) { const ln = line[sc().cats[0].line || "pg"], gi = ln && (sport.cols[sc().cats[0].line || "pg"] || {}).gp; if (ln && gi != null && !ln[gi]) return w < L().week ? "Didn't play" : liveLeft(p, w) || "No games"; }
      // counting categories this player's line has (a hitter's for a hitter, a pitcher's for a pitcher), the big three first
      const pref = ["pts", "reb", "ast", "r", "hr", "rbi", "k", "w", "sv"];
      const cats = sc().cats.filter((c) => c.col && line[c.line || "pg"]).sort((a, b) => (pref.indexOf(a.col) + 99) % 99 - (pref.indexOf(b.col) + 99) % 99).slice(0, 3);
      return cats.map((c) => { const ln = line[c.line || "pg"]; const ix = sport.cols[c.line || "pg"] && sport.cols[c.line || "pg"][c.col]; const v = ln && ix != null ? ln[ix] : 0; return `<span class="wl"><b>${Math.round(v)}</b> ${esc(c.label)}</span>`; }).join("");
    }
    const findGame = (w, teamId) => G.matchups(L(), ctx, w, frac(w)).find((m) => m.a === teamId || m.b === teamId);
    const playerVM = (id) => ctx.byId[id];
    // a dynasty's draft pick, shaped like a player for trade cards and the trade window
    const pickVM = (key) => { const [r, t] = key.split(":").map(Number); return { pick: true, id: key, n: `Round ${r} pick, ${G.pickYear(key) > 1 ? "two seasons out" : "next season"}`, sub: (G.pickOwner(L(), key) === t ? `${T(t).name}'s own` : `From ${T(t).name}`) + (G.pickProspect(L(), ctx, key) ? `. Projects to ${G.pickProspect(L(), ctx, key).n}, ${G.pickProspect(L(), ctx, key).pos}` : ""), $: Math.round(G.pickValue(L(), ctx, key)) }; };

    /* ---------- pages: League ---------- */
    // pick your opponent: the order, who's picked whom, and who's on the clock
    function pyoCard() {
      const P = L().pyo; if (!P || P.done || over()) return "";
      const turn = G.pyoTurn(L()), mid = me(), pairs = P.pairs, by = Object.fromEntries(pairs.map(([a, b]) => [a, b]));
      const paired = new Set(pairs.flat());
      const rows = P.order.map((t) => by[t] != null ? `<li><span class="pyo-n">${teamAv(T(t), "sm")}</span><span class="grow"><b>${esc(T(t).name)}</b><small>picked ${esc(T(by[t]).name)}</small></span></li>`
        : paired.has(t) ? "" : `<li${t === turn ? ' class="on"' : ""}><span class="pyo-n">${teamAv(T(t), "sm")}</span><span class="grow"><b>${esc(T(t).name)}</b><small>${t === turn ? "On the clock" : "Waiting"}</small></span>${t === turn && t === mid ? `<button type="button" class="btn sm go" data-pyo>Pick</button>` : ""}</li>`).join("");
      return `<div class="card"><div class="mod-h"><h2>Week ${P.week}: pick your opponent</h2></div><div class="bd" style="padding-bottom:0"><p class="ps" style="margin:0">Worst record picks first, 12 hours a turn.</p></div><ul class="seatl pyo-l">${rows}</ul></div>`;
    }
    // Kingslayer: who wears the crown and what beating him pays
    function crownCard() {
      const c = L().crown; if (!c || over() || !L().settings.crown) return "";
      if (c.king == null) return `<div class="card crown-c"><div class="mod-h"><h2>${CROWN} Kingslayer</h2></div><div class="bd"><p class="ps" style="margin:0">The crown goes to week 1's top scorer. Then whoever beats the king takes the crown and the bounty, which grows $${L().settings.crown.step} every week he holds it.</p></div></div>`;
      const weeks = Math.max(0, L().week - c.since), foe = (() => { const g = (L().schedule[L().week - 1] || []).find((x) => x.includes(c.king)); return g ? (g[0] === c.king ? g[1] : g[0]) : null; })();
      return `<div class="card crown-c"><div class="mod-h"><h2>${CROWN} The crown</h2><span class="ps">$${c.pot} bounty</span></div><div class="bd"><div class="row" style="gap:10px">${teamAv(T(c.king), "md")}<div style="min-width:0"><b>${esc(T(c.king).name)}</b><div class="ps">${weeks ? `King for ${weeks} week${weeks === 1 ? "" : "s"}` : "New king"}${c.reigns.length ? `, ${c.reigns.length} change${c.reigns.length === 1 ? "" : "s"} of the crown` : ""}</div></div></div>
        ${foe != null && L().week <= L().settings.weeks ? `<p class="ps" style="margin:10px 0 0">${isMe(foe) ? `<b>You play the king this week.</b> Win and the crown and $${c.pot} are yours.` : isMe(c.king) ? `You defend the crown against <b>${esc(T(foe).name)}</b>.` : `${esc(T(foe).name)} gets the shot this week.`}</p>` : ""}</div></div>`;
    }
    function pyoDialog() {
      const P = L().pyo, mid = me();
      if (!P || P.done || G.pyoTurn(L()) !== mid) { U.toast("It isn't your turn to pick", true); return; }
      const opts = G.pyoOptions(L(), mid), last = G.pyoLast(L(), mid, P.week);
      const st = Object.fromEntries(standings().map((r) => [r.team, r]));
      const line = (id) => { const r = st[id] || {}; return `${r.w || 0}-${r.l || 0}${r.t ? "-" + r.t : ""}${pts() && r.pf != null ? `, ${fmtS(r.pf)} points` : ""}${G.kingOf(L()) === id ? ", wears the crown" : ""}`; };
      const Dl = U.dialog(`<h3 class="disp">Pick your week ${P.week} opponent</h3><p class="ps" style="margin:0 0 8px">${last != null && !opts.includes(last) ? `Not ${esc(T(last).name)}: you play them this week. ` : ""}Pick someone you can beat, or someone you want to beat.</p>
        <ul class="seatl">${opts.map((id) => `<li>${teamAv(T(id), "sm")}<span class="grow"><b>${esc(T(id).name)}</b><small>${esc(line(id))}</small></span><button type="button" class="btn sm go" data-pyopick="${id}">Pick</button></li>`).join("")}</ul>`, null, { wide: true });
      Dl.onclick = (e) => { const b = e.target.closest("[data-pyopick]"); if (!b) return; const id = +b.dataset.pyopick; Dl.close(); act(() => { const r = G.pyoPick(L(), ctx, mid, id, now()); if (r.ok) G.runPyo(L(), ctx, now()); return r; }, `You play ${T(id).name} in week ${P.week}.`); };
    }
    // your watchlist at a glance: who's free, who's on waivers, who got taken
    function watchCard() {
      if (me() == null || over()) return "";
      const ids = (L().watch[me()] || []).filter((id) => ctx.byId[id]).slice(0, 6);
      if (!ids.length) return "";
      return `<div class="card"><div class="mod-h"><h2>Your watchlist</h2><a href="#players/watch">All ${(L().watch[me()] || []).length}</a></div><ul class="feed">${ids.map((id) => { const p = ctx.byId[id], own = ctx.own[id];
        const tag = own != null ? (own === me() ? `<span class="tag win">Yours</span>` : `<span class="ps">${esc(T(own).abbr)}</span>`) : G.onWaivers(L(), id, now()) ? `<button class="btn xs" data-add="${esc(id)}">Claim</button>` : `<button class="btn xs go" data-add="${esc(id)}">Add</button>`;
        return `<li style="grid-template-columns:minmax(0,1fr) auto;align-items:center;padding:8px 16px"><span data-player="${esc(id)}" style="cursor:pointer;min-width:0">${pname(sport, p, esc(p.prank || ""))}</span>${tag}</li>`; }).join("")}</ul></div>`;
    }
    function overview() {
      if (allplay1()) return weekBoardPage();
      if (gl()) return guillotineOverview();
      if (roto()) return rotoOverview();
      const w = curWeek(), mid = me();
      const games = gamesVM(w);
      const mine = mid != null && !over() ? findGame(w, mid) : null;
      const st = standings().map((r) => Object.assign({}, r, { team: T(r.team), me: isMe(r.team), href: teamHref(r.team), cut: !L().divs && r.rank === L().settings.playoffTeams && r.rank < L().teams.length, badge: seedTag(r) }));
      const recent = L().tx.slice().reverse().filter((x) => x.type !== "draft").slice(0, 7);
      const offers = L().trades.filter((t) => t.status === "pending" && t.to === mid);
      const champ = over() ? championOf() : null;
      // kickers and defenses are always there on waivers; the list is for players worth a look
      const hot = ctx.free.filter((p) => (L().openWaivers > now() || !G.onWaivers(L(), p.id, now())) && !(sport.late && S.isLate(sport, p))).map((p) => ({ p, h: G.hot(L(), p) })).sort((a, b) => (b.p.vor + b.h * 0.6) - (a.p.vor + a.h * 0.6)).slice(0, 5);
      const pw = G.power(L(), ctx).slice(0, 6);
      const myRow = mid != null ? st.find((r) => r.team.id === mid) : null;
      // your team, claims and offers: top of the page on a phone, the sidebar on a wide screen
      // right after the draft, before week 1 is under way: point at the results and grades
      const twists = `${pyoCard()}${crownCard()}${oneWeekLg() ? seriesCard() : ""}`;
      const fresh = L().week === 1 && now() < L().start + 2 * 864e5 && L().draft ? `<div class="card"><div class="mod-h"><h2>The draft is done</h2><a href="#draft">Results and grades</a></div><div class="bd"><p class="ps" style="margin:0">Every pick, each team's grade and the steals of the draft.</p></div></div>` : "";
      const myCards = `${fresh}${twists}${L().heist && mid != null && !over() ? heistCard(mid, { stack: true }) : ""}
          ${myRow ? `<div class="card"><div class="mod-h">${teamAv(myRow.team, "md")}<div style="min-width:0"><b class="ell" style="display:block">${esc(myRow.team.name)}</b><span class="ps">${ord(myRow.rank)} place, ${myRow.w}-${myRow.l}${myRow.t ? "-" + myRow.t : ""}</span></div></div>
            <div class="bd"><div class="stat-row"><div><small>FAAB</small><b>$${T(mid).faab}</b></div><div><small>Waiver priority</small><b>${ord(T(mid).priority + 1)}</b></div><div><small>Streak</small><b>${esc(myRow.streak || "-")}</b></div></div>
            ${over() ? "" : `<div class="row" style="margin-top:12px;flex-wrap:wrap"><a class="btn sm" href="#team/roster">Set lineup</a>${canTrade() ? `<button class="btn sm" data-trade>Propose a trade</button>` : ""}<a class="btn sm" href="#players/fa">Free agents</a></div>`}</div></div>` : ""}
          ${mid != null && L().claims.some((c) => c.team === mid && c.status === "open") ? `<div class="card"><div class="mod-h"><h2>Your waiver claims</h2><a href="#players/claims">All claims</a></div><div class="bd" style="padding-bottom:0"><span class="ps">${esc(claimsRun())}</span></div>${claimList(L().claims.filter((c) => c.team === mid && c.status === "open"))}</div>` : ""}
          ${watchCard()}
          ${offers.length ? `<div class="card"><div class="mod-h"><h2>Trade offers for you</h2><span class="badge">${offers.length}</span><a href="#team/trades">Review</a></div>${U.feed(offers.map((t) => ({ team: T(t.from), when: U.ago(t.at, now()), lines: t.get.map((id) => U.txLine(sport, "drop", playerVM(id), "you send")).concat(t.give.map((id) => U.txLine(sport, "add", playerVM(id), "you get"))) })))}</div>` : ""}`;
      const total = G.totalWeeks(L());
      return `<div class="wrap page">
        <div class="head sr"><h1 class="disp">${over() ? "Season over" : w > L().settings.weeks ? `Playoffs, week ${w}` : `Week ${w}`}</h1><span class="ps">${esc(L().season || "")}${L().season ? " season, " : ""}${over() ? `${total} weeks played` : `${Math.max(0, total - w)} week${total - w === 1 ? "" : "s"} after this one`}${myRow ? `. You're ${ord(myRow.rank)} at ${myRow.w}-${myRow.l}${myRow.t ? "-" + myRow.t : ""}` : ""}.</span></div>
        ${champ != null && oneWeekLg() ? finishCard() : champ != null ? `<div class="banner"><span>${teamAv(T(champ), "lg")}</span><div><b class="disp" style="font-size:26px">${esc(T(champ).name)} won the title</b><div class="ps">The ${esc(L().season || "")} season is over.</div></div></div>` : ""}
        ${!games.length ? "" : `<div class="stack" style="gap:8px"><div class="row"><h2 style="margin:0;font-size:15px">${over() ? "Final week" : mine ? `Around the league, week ${w}` : `Week ${w} scoreboard`}</h2><a href="#league/scoreboard" class="small" style="margin-left:auto">All scores</a></div>${U.scoreboard(mine ? games.filter((g) => !g.me) : games, fmtS)}</div>`}
        <div class="cols"><div class="stack">
          ${myCards.trim() ? `<div class="m-only stack">${myCards}</div>` : ""}
          ${mine ? `<div class="card"><div class="mod-h"><h2>Your matchup</h2><span class="ps">Week ${w}${w > L().settings.weeks ? `, ${esc(kindName(mine.kind, w).toLowerCase())}` : ""}</span><a href="${matchHref(w, mine.i)}">Full matchup</a></div>${U.versus(versusVM(w, mine))}</div>` : ""}
          ${lastWeekCard()}
          <div class="card"><div class="mod-h"><h2>Standings</h2><a href="#league/standings">Full standings</a></div>${U.standingsTable(st, { compact: true, pfLabel: pts() ? "PF" : "Cats", fmt: fmtS })}</div>
          <div class="card feed2"><div class="mod-h"><h2>Recent activity</h2><a href="#players/tx">All transactions</a></div>${U.feed(recent.slice(0, 6).map(txVM), "No moves yet. Pick up a free agent to get things going.")}</div>
        </div><aside class="stack">
          ${myCards.trim() ? `<div class="d-only stack">${myCards}</div>` : ""}
          ${chatCard()}
          ${blockCard(3)}
          <div class="card"><div class="mod-h"><h2>Power rankings</h2><a href="#league/standings">More</a></div><ol class="feed">${pw.map((r) => `<li style="grid-template-columns:24px auto minmax(0,1fr) auto;align-items:center;padding:8px 16px"><b class="ps num">${r.rank}</b>${teamAv(T(r.team), "sm")}<span class="ell"><b>${esc(T(r.team).name)}</b></span>${moveTag(r.move)}</li>`).join("")}</ol></div>
          ${over() ? "" : `<div class="card"><div class="mod-h"><h2>Hot on waivers</h2><a href="#players/fa">Free agents</a></div><ul class="feed">${hot.map(({ p, h }) => `<li style="grid-template-columns:minmax(0,1fr) auto;align-items:center;padding:8px 16px"><span data-player="${esc(p.id)}" style="cursor:pointer;min-width:0">${pname(sport, p, h > 1.15 ? `<span class="win">hot</span>` : "")}</span>${mid != null ? `<button class="btn icon add" data-add="${esc(p.id)}" aria-label="Add ${esc(p.n)}">+</button>` : ""}</li>`).join("") || `<li class="empty">Nobody stands out.</li>`}</ul></div>`}
        </aside></div></div>`;
    }
    // The week that just ended: every result, with the high score called out.
    function lastWeekCard() {
      if (roto() || (over() && oneWeekLg())) return "";
      const w = Math.min(L().week, G.totalWeeks(L()) + 1) - 1;
      if (w < 1 || !L().results[w] || gl()) return "";
      const games = gamesVM(w);
      const all = games.flatMap((g) => [[g.a.team, g.a.score], [g.b.team, g.b.score]]);
      const hi = pts() ? all.slice().sort((x, y) => y[1] - x[1])[0] : null;
      const mine = games.find((g) => g.me);
      let line = "";
      if (mine) { const m = isMe(mine.m.b) ? flip(mine.m) : mine.m; line = m.w === "t" ? `You tied ${esc(T(m.b).name)}` : `You ${m.w === "a" ? "beat" : "lost to"} ${esc(T(m.b).name)}, ${fmtS(m.sa)} to ${fmtS(m.sb)}`; }
      const rc = recapOn() ? recapOf(w) : null, lede = rc ? recapLede(rc) : "";
      return `<div class="card"><div class="mod-h"><h2>Week ${w} results</h2><span class="ps">${line}${hi ? `${line ? ". " : ""}High score: ${esc(hi[0].abbr)} ${fmtS(hi[1])}` : ""}</span><a href="${rc ? `#league/recap/${w}">Read the recap` : `#league/scoreboard/${w}">Scoreboard`}</a></div>${lede ? `<div class="bd rc-mini" style="padding-bottom:0"><p class="ps" style="margin:0">${lede}</p></div>` : ""}<div class="bd sbtwo">${U.scoreboard(games.map((g) => Object.assign({}, g, { wp: null })), fmtS, { list: true })}</div></div>`;
    }
    /* ---------- the weekly recap: a finished week told as a story, with copy for the group chat ---------- */
    const recapOn = () => !gl() && !roto() && !oneWeekLg() && !allplay1() && Object.keys(L().results || {}).length > 0;
    const lastDone = () => Math.min(L().week, G.totalWeeks(L()) + 1) - 1;
    const rcCache = {};
    const recapOf = (w) => { const k = `${w}:${L().week}:${L().version || 0}:${(L().tx || []).length}`; return rcCache[w] && rcCache[w].k === k ? rcCache[w].rc : (rcCache[w] = { k, rc: G.recap(L(), ctx, w) }).rc; };
    const nm = (id) => esc(T(id).name);
    const pn = (pid) => { const p = ctx.byId[pid]; return p ? esc(p.n) : "a player"; };
    const byText = (m) => (pts() ? fmtS(m) : `${fmtS(m)} categor${Math.round(m) === 1 ? "y" : "ies"}`);
    const winLose = (g) => (g.w === "b" ? [g.b, g.a, g.sb, g.sa] : [g.a, g.b, g.sa, g.sb]);
    // the one-paragraph story of the week
    function recapLede(rc) {
      const bits = [];
      if (rc.high) bits.push(`${nm(rc.high.team)} put up the high score, ${fmtS(rc.high.score)}.`);
      if (rc.blowout && rc.blowout.margin > 0) { const [a, b] = winLose(rc.blowout); bits.push(`The biggest win: ${nm(a)} over ${nm(b)} by ${byText(rc.blowout.margin)}.`); }
      if (rc.close && rc.close !== rc.blowout) { const [a, b] = winLose(rc.close); bits.push(rc.close.w === "a" || rc.close.w === "b" ? `${nm(a)} edged ${nm(b)} by ${byText(rc.close.margin)}.` : `${nm(rc.close.a)} and ${nm(rc.close.b)} tied.`); }
      const cost = rc.calls.find((c) => c.cost && c.miss);
      if (cost) bits.push(`${nm(cost.team)} had the points to win on the bench.`);
      return bits.join(" ");
    }
    function recapText(rc) {
      const lines = [`${L().name}, week ${rc.week} recap`];
      for (const g of rc.games) { const [a, b, x, y] = winLose(g); lines.push(g.w === "a" || g.w === "b" ? `${T(a).name} ${fmtS(x)}, ${T(b).name} ${fmtS(y)}` : `${T(g.a).name} ${fmtS(g.sa)}, ${T(g.b).name} ${fmtS(g.sb)} (tie)`); }
      lines.push("");
      if (rc.high) lines.push(`High score: ${T(rc.high.team).name}, ${fmtS(rc.high.score)}. Low: ${T(rc.low.team).name}, ${fmtS(rc.low.score)}.`);
      if (rc.top[0] && ctx.byId[rc.top[0].pid]) lines.push(`Player of the week: ${ctx.byId[rc.top[0].pid].n} (${T(rc.top[0].team).abbr}), ${fmtS(rc.top[0].pts)}.`);
      const bad = rc.calls.find((c) => c.gap > 0 && c.miss && c.over);
      if (bad) lines.push(`Benched: ${T(bad.team).name} left ${fmtS(bad.gap)} on the bench. ${ctx.byId[bad.miss.pid].n} scored ${fmtS(bad.miss.pts)} while ${ctx.byId[bad.over.pid].n} started and scored ${fmtS(bad.over.pts)}.${bad.cost ? " It cost them the game." : ""}`);
      if (rc.perfect.length) lines.push(`Perfect lineup: ${rc.perfect.map((t) => T(t).name).join(", ")}.`);
      if (rc.climb) lines.push(`Biggest climb: ${T(rc.climb.team).name}, ${ord(rc.climb.from)} to ${ord(rc.climb.to)}.`);
      for (const k of rc.streaks.slice(0, 2)) lines.push(`${T(k.team).name}: ${k.n} straight ${k.kind === "W" ? "wins" : "losses"}.`);
      lines.push("", location.href.replace(/#.*$/, "") + `#league/recap/${rc.week}`);
      return lines.join("\n");
    }
    function recapPage(arg) {
      const last = lastDone();
      if (!recapOn() || last < 1) return `<div class="wrap page"><div class="head"><h1 class="disp">Recap</h1></div><div class="card"><div class="bd"><p class="ps" style="margin:0">The recap is written when the first week is final.</p></div></div></div>`;
      const w = Math.max(1, Math.min(last, +arg || last));
      const rc = recapOf(w);
      if (!rc) return `<div class="wrap page"><div class="head"><h1 class="disp">Week ${w} recap</h1></div></div>`;
      const weeks = Array.from({ length: last }, (_, i) => i + 1);
      const row = (team, main, sub, right) => `<li style="grid-template-columns:auto minmax(0,1fr) auto;align-items:center;padding:10px 16px">${teamAv(T(team), "sm")}<span style="min-width:0"><b style="display:block">${main}</b>${sub ? `<span class="ps">${sub}</span>` : ""}</span>${right || ""}</li>`;
      const gameCard = (g, title) => g ? `<a class="card" href="${matchHref(w, g.i)}" style="text-decoration:none;color:inherit"><div class="mod-h"><h2>${title}</h2><span class="ps">${g.w === "a" || g.w === "b" ? `By ${byText(g.margin)}` : "A tie"}</span></div>${U.versus(Object.assign(versusVM(w, G.matchups(L(), ctx, w, 1)[g.i]), { cats: null }))}</a>` : "";
      const bench = rc.calls.filter((c) => c.gap > 0.05 && c.miss && c.over).slice(0, 3);
      const callsCard = rc.pts && rc.calls.length ? `<div class="card"><div class="mod-h"><h2>Lineup calls</h2><span class="ps">Points left on the bench</span></div><ul class="feed">
          ${bench.map((c) => row(c.team, `${nm(c.team)} left ${fmtS(c.gap)} on the bench`, `<span data-player="${esc(c.miss.pid)}" style="cursor:pointer">${pn(c.miss.pid)}</span> scored ${fmtS(c.miss.pts)} on the bench; <span data-player="${esc(c.over.pid)}" style="cursor:pointer">${pn(c.over.pid)}</span> started and scored ${fmtS(c.over.pts)}.${c.cost ? ` <b class="loss">That lost the game to ${nm(c.opp)}.</b>` : ""}`, `<span class="tag loss">-${fmtS(c.gap)}</span>`)).join("")}
          ${rc.perfect.length ? `<li style="padding:10px 16px;display:block"><b>Perfect lineup${rc.perfect.length > 1 ? "s" : ""}:</b> ${rc.perfect.map(nm).join(", ")}. Nobody on the bench would have scored more.</li>` : ""}
          ${!bench.length && !rc.perfect.length ? `<li class="empty">No bench calls this week.</li>` : ""}</ul></div>` : "";
      const topCard = rc.top.length ? `<div class="card"><div class="mod-h"><h2>Top performers</h2></div><ol class="feed">${rc.top.map((x, i) => { const p = ctx.byId[x.pid]; return `<li style="grid-template-columns:20px minmax(0,1fr) auto;align-items:center;padding:8px 16px"><b class="ps num">${i + 1}</b><span data-player="${esc(x.pid)}" style="cursor:pointer;min-width:0">${pname(sport, p, esc(T(x.team).abbr))}</span><b class="num">${fmtS(x.pts)}</b></li>`; }).join("")}</ol></div>` : "";
      const st = [];
      if (rc.climb) st.push(row(rc.climb.team, `${nm(rc.climb.team)} climbed ${rc.climb.by} spot${rc.climb.by === 1 ? "" : "s"}`, `${ord(rc.climb.from)} to ${ord(rc.climb.to)}`, `<span class="tag win">+${rc.climb.by}</span>`));
      if (rc.fall) st.push(row(rc.fall.team, `${nm(rc.fall.team)} fell ${-rc.fall.by} spot${rc.fall.by === -1 ? "" : "s"}`, `${ord(rc.fall.from)} to ${ord(rc.fall.to)}`, `<span class="tag loss">${rc.fall.by}</span>`));
      for (const k of rc.streaks.slice(0, 3)) st.push(row(k.team, `${nm(k.team)}: ${k.n} straight ${k.kind === "W" ? "wins" : "losses"}`, "", ""));
      if (rc.high && rc.low) st.push(row(rc.low.team, `${nm(rc.low.team)} had the low score`, fmtS(rc.low.score), ""));
      const stCard = st.length ? `<div class="card"><div class="mod-h"><h2>Around the league</h2><a href="#league/standings">Standings</a></div><ul class="feed">${st.join("")}</ul></div>` : "";
      const pw = w === last && !over() ? G.power(L(), ctx).slice(0, 5) : [];
      const pwCard = pw.length ? `<div class="card"><div class="mod-h"><h2>Power rankings</h2><a href="#league/standings">More</a></div><ol class="feed">${pw.map((r) => `<li style="grid-template-columns:24px auto minmax(0,1fr) auto;align-items:center;padding:8px 16px"><b class="ps num">${r.rank}</b>${teamAv(T(r.team), "sm")}<span class="ell"><b>${nm(r.team)}</b> <span class="ps">${recOf(r.team)}</span></span>${moveTag(r.move)}</li>`).join("")}</ol></div>` : "";
      const lede = recapLede(rc);
      return `<div class="wrap page rcp">
        <div class="head"><h1 class="disp">Week ${w} recap</h1><span class="ps">${rc.playoff ? esc(kindName(rc.games[0] && rc.games[0].kind, w)) + ". " : ""}${rc.games.length} game${rc.games.length === 1 ? "" : "s"}</span></div>
        ${weeks.length > 1 ? `<div class="chips" role="group" aria-label="Week">${weeks.map((x) => `<button type="button" data-rcweek="${x}" aria-pressed="${x === w}">${weekChip(x)}</button>`).join("")}</div>` : ""}
        <div class="card rc-lede"><div class="bd"><p>${lede || "Every result from the week."}</p><div class="row" style="flex-wrap:wrap"><button class="btn sm" data-copyrecap="${w}">Copy for the group chat</button>${typeof navigator.share === "function" ? `<button class="btn sm ghost" data-sharerecap="${w}">Share</button>` : ""}</div></div></div>
        <div class="cols"><div class="stack">
          ${gameCard(rc.close, "Game of the week")}
          <div class="card"><div class="mod-h"><h2>Every result</h2><a href="#league/scoreboard/${w}">Scoreboard</a></div><div class="bd sbtwo">${U.scoreboard(gamesVM(w).map((g) => Object.assign({}, g, { wp: null })), fmtS, { list: true })}</div></div>
          ${callsCard}
        </div><aside class="stack">${topCard}${stCard}${pwCard}</aside></div></div>`;
    }
    const moveTag = (m) => (m > 0 ? `<span class="tag win">+${m}</span>` : m < 0 ? `<span class="tag loss">${m}</span>` : `<span class="ps">-</span>`);
    const championOf = () => G.finish(L()).champion;
    /* ---------- a one-week league's finish: the winner, the score, the MVP and what decided it ---------- */
    const oneWeekLg = () => L().settings.weeks === 1 && !!(L().draft && L().draft.season && L().draft.season.oneWeek);
    // one week, everyone vs everyone: one leaderboard, ranked on points (live points, or the projection before kickoff)
    const allplay1 = () => oneWeekLg() && L().settings.tally === "allplay";
    function weekRows() {
      const seen = new Set(), rows = [];
      for (const g of G.matchups(L(), ctx, 1, frac(1))) for (const [t, sc, pj] of [[g.a, g.sa, g.pa], [g.b, g.sb, g.pb]]) if (!seen.has(t)) { seen.add(t); rows.push({ t, sc: sc || 0, pj: pj != null ? pj : sc || 0 }); }
      const started = over() || frac(1) > 0 || rows.some((r) => r.sc > 0);
      // final: the standings' order, ties going to the best single player's score
      if (over()) { const at = Object.fromEntries(G.standings(L()).map((r, i) => [r.team, i])); rows.sort((a, b) => at[a.t] - at[b.t]); }
      else rows.sort((a, b) => (started ? b.sc - a.sc || b.pj - a.pj : b.pj - a.pj) || a.t - b.t);
      // during the week: each team's starters whose games haven't kicked off
      const k = L().kick && L().kick.week === 1 ? L().kick.teams : null;
      if (k && !over()) for (const r of rows) r.left = G.lineupFor(L(), ctx, r.t, 1).filter((id) => { const p = id && ctx.byId[id]; return p && !(k[p.t] != null && now() >= k[p.t]); }).length;
      return { rows, started, toPlay: !!k && !over() };
    }
    const slateName = () => { const st = L().settings; return st.slate ? `${st.slate.label}, ${st.slate.games} game${st.slate.games === 1 ? "" : "s"}` : st.showdown ? `${st.showdown.label} showdown` : ""; };
    function leaderboardCard() {
      const { rows, started, toPlay } = weekRows(), live = !over() && frac(1) > 0;
      const status = over() ? "Final" : live ? "Live" : `Projected until the first ${dayL() ? "tip" : "kickoff"}`;
      return `<div class="card"><div class="mod-h"><h2>Leaderboard</h2><span class="ps">${esc(status)}</span></div><div class="table-wrap"><table class="t wklb"><thead><tr><th class="num">#</th><th>Team</th><th class="r">Points</th>${over() ? "" : `${toPlay ? `<th class="r" title="Starters whose games haven't kicked off">To play</th>` : ""}<th class="r" title="Points so far plus what the players still to play should score">Projected</th>`}</tr></thead><tbody>
        ${rows.map((r, i) => `<tr class="${isMe(r.t) ? "me" : ""}"><td class="num"><b>${i + 1}</b></td><td class="nm"><a href="${teamHref(r.t)}" style="color:inherit;text-decoration:none">${teamName(T(r.t), { you: isMe(r.t), badge: over() && i === 0 ? ` <span class="tag gold">Winner</span>` : "" })}</a></td><td class="r num"><b>${started ? fmtS(r.sc) : "-"}</b></td>${over() ? "" : `${toPlay ? `<td class="r num">${r.left}</td>` : ""}<td class="r num ps">${fmtS(r.pj)}</td>`}</tr>`).join("")}</tbody></table></div>${over() ? `<div class="bd ps" style="padding-top:8px">A tie on points goes to the team with the best single player's score.</div>` : ""}</div>`;
    }
    // a one-week game run back week after week: who's won the most, finished top three, scored the most
    function seriesCard() {
      const sr = opts.series && opts.series(); if (!sr || !sr.weeks || sr.weeks.length < 2) return "";
      const done = sr.weeks.filter((w) => w.done && w.scores && Object.keys(w.scores).length), last = sr.weeks[sr.weeks.length - 1];
      const names = (last.teams || []).map((n, i) => (L().teams[i] ? L().teams[i].name : n));
      const row = names.map((n, i) => ({ i, n, wins: 0, top3: 0, pts: 0, played: 0 }));
      for (const w of done) {
        const order = Object.entries(w.scores).map(([t, v]) => [+t, +v]).sort((a, b) => b[1] - a[1]);
        order.forEach(([t, v], k) => { const r = row[t]; if (!r) return; r.played++; r.pts += v; if (k === 0) r.wins++; if (k < 3) r.top3++; });
      }
      row.sort((a, b) => b.wins - a.wins || b.top3 - a.top3 || b.pts - a.pts);
      return `<div class="card"><div class="mod-h"><h2>The series</h2><span class="ps">${done.length} week${done.length === 1 ? "" : "s"} played</span></div><div class="table-wrap"><table class="t dense"><thead><tr><th>Team</th><th class="r">Wins</th><th class="r">Top 3</th><th class="r">Points</th></tr></thead><tbody>
        ${row.map((r) => `<tr${isMe(r.i) ? ' class="me"' : ""}><td class="nm">${L().teams[r.i] ? teamName(T(r.i), { you: isMe(r.i) }) : esc(r.n)}</td><td class="r num"><b>${r.wins}</b></td><td class="r num">${r.top3}</td><td class="r num">${fmtS(r.pts)}</td></tr>`).join("")}</tbody></table></div>
        <div class="bd sr-wks">${sr.weeks.map((w) => `<a class="btn xs ghost" href="play.html?id=${esc(w.id)}">Game ${w.n}${w.label ? `: ${esc(w.label)}` : ""}</a>`).join("")}</div></div>`;
    }
    function weekBoardPage() {
      const mid = me(), { rows } = weekRows(), at = rows.findIndex((r) => r.t === mid);
      return `<div class="wrap page"><div class="head"><h1 class="disp">${over() ? "Final" : dayL() ? "Tonight" : "This week"}</h1><span class="ps">${esc(slateName() || L().season || "")}${mid != null && at >= 0 ? `. You're ${ord(at + 1)} of ${rows.length}` : ""}.</span></div>
        ${over() ? finishCard() : ""}<div class="cols2"><div class="stack">${leaderboardCard()}</div><div class="stack">${seriesCard()}${chatCard()}</div></div>${gamedayStatus(1)}${teamGameBoxes(1, rows.map(r => r.t))}</div>`;
    }
    function finishData() {
      if (allplay1()) {
        const { rows } = weekRows(); if (!rows.length || !over()) return null;
        let mvp = null;
        for (const g of L().results[1] || []) for (const [t, tx] of [[g.a, g.ta], [g.b, g.tb]]) for (const [pid, v] of Object.entries((tx && tx.players) || {})) if (!mvp || v > mvp.v) mvp = { pid, v, t };
        return { allplay: true, rows, champ: rows[0].t, mvp, moments: [] };
      }
      const res = (L().results[1] || []).filter((g) => g && g.ta);
      if (!res.length) return null;
      const champ = championOf(), mid = me();
      const g = res.find((x) => mid != null && (x.a === mid || x.b === mid)) || res.find((x) => x.a === champ || x.b === champ) || res[0];
      const pts = (t) => (t === g.a ? g.ta : g.tb) || { players: {} }, sc = (t) => (t === g.a ? g.sa : g.sb);
      const win = g.sa === g.sb ? null : g.sa > g.sb ? g.a : g.b, lose = win == null ? null : win === g.a ? g.b : g.a;
      // the best score of the game, and what the heist and the captains did to it
      let mvp = null;
      for (const t of [g.a, g.b]) for (const [pid, v] of Object.entries(pts(t).players || {})) if (!mvp || v > mvp.v) mvp = { pid, v, t };
      const moments = [];
      const H = L().heist, mult = L().pmult || {};
      if (H) for (const e of H.events.filter((x) => x.ok && [g.a, g.b].includes(x.by))) {
        if (e.type === "steal") {
          const v = (pts(e.by).players || {})[e.pid] || 0, raw = v / (mult[e.pid] || 1);
          // would the other side have won with him, at normal points, instead?
          const flip = win === e.by && sc(e.by) - v < sc(e.on) + raw;
          moments.push({ k: "steal", text: `${T(e.by).name} stole ${(ctx.byId[e.pid] || {}).n}: ${fmtS(v)} points at ${F_HEIST().steal}x${flip ? ". The steal decided it" : ""}`, big: flip });
        } else {
          const v = (pts(e.on).players || {})[e.pid] || 0;
          const flip = win === e.by && sc(e.by) < sc(e.on) + v;
          moments.push({ k: "jinx", text: `${T(e.by).name}'s jinx on ${(ctx.byId[e.pid] || {}).n} cost ${T(e.on).name} ${fmtS(v)} points${flip ? ". The jinx decided it" : ""}`, big: flip });
        }
      }
      if (L().settings.mult) for (const t of [g.a, g.b]) {
        const lu = G.lineupFor(L(), ctx, t, 1), i = L().settings.lineup.findIndex((sl) => (L().settings.mult[sl] || 1) > 1), pid = i >= 0 ? lu[i] : null;
        if (pid) moments.push({ k: "cpt", text: `${T(t).name}'s captain ${(ctx.byId[pid] || {}).n}: ${fmtS((pts(t).players || {})[pid] || 0)} points` });
      }
      return { g, champ, win, lose, mvp, moments: moments.sort((a, b) => (b.big ? 1 : 0) - (a.big ? 1 : 0)).slice(0, 4), many: L().teams.length > 2 };
    }
    const rematchBtn = () => (opts.rematch ? `<button class="btn sm go" data-rematch>Run it back</button>` : "");
    function finishCard() {
      const f = finishData(); if (!f) return "";
      if (f.allplay) {
        const [a, b] = f.rows, cs = T(a.t), mine = isMe(a.t), mp = f.mvp && ctx.byId[f.mvp.pid], at = f.rows.findIndex((r) => isMe(r.t));
        return `<div class="card fin${mine ? " me" : ""}">
          <div class="fin-h">${teamAv(cs, "xl")}<div><small>${esc(L().name || "")}, final</small><b class="disp">${esc(cs.name)} wins the ${dayL() ? "night" : "week"}</b><span>${fmtS(a.sc)} points${b ? `, ${fmtS(a.sc - b.sc)} ahead of ${esc(T(b.t).name)}` : ""}.${at > 2 ? ` You finished ${ord(at + 1)} of ${f.rows.length}.` : ""}</span></div></div>
          <ol class="fin-pod">${f.rows.slice(0, 3).map((r, i) => `<li${isMe(r.t) ? ' class="me"' : ""}><small>${ord(i + 1)}</small>${teamAv(T(r.t), "sm")}<b class="ell">${esc(T(r.t).name)}</b><span class="num">${fmtS(r.sc)}</span></li>`).join("")}</ol>
          ${mp ? `<div class="fin-mvp"><small>MVP</small><span data-player="${esc(mp.id)}" style="cursor:pointer">${pname(sport, mp, `${fmtS(f.mvp.v)} points for ${esc(T(f.mvp.t).name)}`)}</span></div>` : ""}
          <div class="fin-a">${rematchBtn()}<button class="btn sm" data-copyfinal>Copy the result</button><a class="btn sm" href="leagues.html?w=1">Start another</a></div></div>`;
      }
      const { g, champ, win, lose, mvp } = f, cs = T(champ), mine = isMe(champ);
      const score = win == null ? `${fmtS(g.sa)} to ${fmtS(g.sb)}, a tie` : `${fmtS(Math.max(g.sa, g.sb))} to ${fmtS(Math.min(g.sa, g.sb))}`;
      const head = f.many ? `${esc(cs.name)} wins the ${dayL() ? "night" : "week"}` : win == null ? "A dead heat" : `${esc(T(win).name)} beat ${esc(T(lose).name)}`;
      const sub = f.many ? `Champion on the best record, then points. ${g.a === champ || g.b === champ ? `Won ${score}.` : ""}` : win == null ? `${score}. ${esc(cs.name)} takes it on the tiebreak.` : `${score}, by ${fmtS(Math.abs(g.sa - g.sb))}.`;
      const mp = mvp && ctx.byId[mvp.pid];
      return `<div class="card fin${mine ? " me" : ""}">
        <div class="fin-h">${teamAv(cs, "xl")}<div><small>${esc(L().name || "")}, final</small><b class="disp">${head}</b><span>${sub}</span></div></div>
        ${mp ? `<div class="fin-mvp"><small>MVP</small><span data-player="${esc(mp.id)}" style="cursor:pointer">${pname(sport, mp, `${fmtS(mvp.v)} points for ${esc(T(mvp.t).name)}`)}</span></div>` : ""}
        ${f.moments.length ? `<ul class="fin-m">${f.moments.map((m) => `<li class="${m.k}${m.big ? " big" : ""}">${esc(m.text)}</li>`).join("")}</ul>` : ""}
        <div class="fin-a">${rematchBtn()}<button class="btn sm" data-copyfinal>Copy the result</button><a class="btn sm" href="leagues.html?${sport.key === "nfl" ? "w=1" : `s=${esc(sport.key)}`}">Start another</a></div></div>`;
    }
    // the result as a few lines for the group chat
    function finishText() {
      const f = finishData(); if (!f) return "";
      if (f.allplay) { const mp = f.mvp && ctx.byId[f.mvp.pid]; return [`${L().name}, final:`].concat(f.rows.map((r, i) => `${i + 1}. ${T(r.t).name} ${fmtS(r.sc)}`), mp ? `MVP: ${mp.n}, ${fmtS(f.mvp.v)}` : "").filter(Boolean).join("\n"); }
      const { g, win, lose, mvp } = f, mp = mvp && ctx.byId[mvp.pid];
      return [`${L().name}: ${win == null ? `a tie, ${fmtS(g.sa)} to ${fmtS(g.sb)}` : `${T(win).name} ${fmtS(Math.max(g.sa, g.sb))}, ${T(lose).name} ${fmtS(Math.min(g.sa, g.sb))}`}`, mp ? `MVP: ${mp.n}, ${fmtS(mvp.v)}` : ""].concat(f.moments.map((m) => m.text)).filter(Boolean).join("\n");
    }
    const byes = () => { const n = L().settings.playoffTeams || 0; return n >= 2 ? 2 ** Math.ceil(Math.log2(n)) - n : 0; };
    function finishTag(id) {
      if (!over()) return "";
      const f = G.finish(L());
      return id === f.champion ? ` <span class="tag gold">Champion</span>` : id === f.runnerUp ? ` <span class="tag">Runner-up</span>` : id === f.third ? ` <span class="tag">Third</span>`
        : id === f.consolation ? ` <span class="tag info">Consolation</span>` : "";
    }
    // with divisions the playoff line isn't a line, so each team in line for the playoffs is tagged with its seed
    const CROWN = `<svg class="crown-i" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M2 12.5h12l1-8-4 3-3-5-3 5-4-3z" fill="currentColor"/></svg>`;
    const crownTag = (id) => (G.kingOf(L()) === id && !over() ? ` <span class="tag gold crown-t" title="Wears the crown: beat them to take it and the $${L().crown.pot} bounty">${CROWN}King</span>` : "");
    const seedTag = (r) => (L().divs && r.seed && !over() ? ` <span class="tag${r.divLeader ? " gold" : " info"}" title="${r.divLeader ? "Leads the division" : "Wild card"}">Seed ${r.seed}</span>` : "") + crownTag(r.team);
    // a player's projection for the week: with the live feed, what he has plus what his team's games left should add
    // Football: Sleeper's projection for the week, less the share of his game already played. Basketball and baseball:
    // his rate per game times the games his team has left (from the live feed's schedule), nothing more if he's out.
    function projFor(p, sofar, w) {
      const so = typeof sofar === "number" ? sofar : 0;
      const wp = sport.key === "nfl" ? weekProj(p, w) : null;
      if (wp != null) { const g = gameNow(gamesOf(p, w) || []); return so + wp * (1 - progress(g)); }
      const wk = G.WEEK[sport.key] || { weeks: 20 };
      if (sport.key === "nfl" || !liveWeek(w) || w !== curWeek()) return w === curWeek() && frac(w) > 0 ? so + (p.v / wk.weeks) * Math.max(0, 1 - frac(w)) : p.v / wk.weeks;
      const per = (p.v || 0) / (sc().games || { nba: 82, mlb: 162 }[sport.key] || 82);
      return so + per * G.gamesLeft(L(), ctx, p, w, frac(w)) * G.plays(p);
    }
    // games each lineup still has to play this week, from the live feed
    function outlookLine(m) {
      if (!m.outlook || m.final) return "";
      const n = (x) => Math.round(x.left * 2) / 2, unit = sport.key === "nfl" ? "player" : "game";
      const say = (t, o) => `<b>${esc(T(t).name)}</b> ${n(o) ? `${fmtS(n(o))} ${unit}${n(o) === 1 ? "" : "s"} left` : "done"}`;
      return `<div class="medline"><span>Still to play:</span><span>${say(m.a, m.outlook[0])}</span><span>${say(m.b, m.outlook[1])}</span>${(L().settings.real && (opts.hooks || {}).real && opts.hooks.real.live) ? `<span class="ps">Live box scores, updated ${esc(new Date(opts.hooks.real.live.updated).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }))}</span>` : ""}</div>`;
    }
    // median scoring: where both teams stand against the league's median score this week
    function medianLine(w, m) {
      if (!L().settings.median || w > L().settings.weeks) return "";
      const md = G.medianOf(L(), ctx, w, frac(w));
      if (md == null) return "";
      const side = (t, x) => `<b>${esc(T(t).name)}</b> ${x > md ? `<span class="win">${m.final ? "beat" : "is above"} it</span>` : x < md ? `<span class="loss">${m.final ? "lost to" : "is below"} it</span>` : "is level with it"}`;
      return `<div class="medline"><span>League median${m.final ? "" : " so far"}: <b>${fmtS(md)}</b></span><span>${side(m.a, m.sa)}</span><span>${side(m.b, m.sb)}</span></div>`;
    }
    // a playoff game's label: the round, and which bracket it's in
    function kindName(kind, w) {
      const rd = G.roundOf(L(), w);
      if (!rd) return "Playoffs";
      const leg = rd.weeks.length > 1 ? `, week ${rd.weeks.indexOf(w) + 1} of 2` : "";
      return kind === "third" ? `Third place${leg}` : kind === "cons" ? `Consolation ${rd.name.toLowerCase()}${leg}` : `${rd.name}${leg}`;
    }
    // short week chips: "Week 9", then "Semis", "Final 1", "Final 2"
    function weekChip(x) {
      const rd = G.roundOf(L(), x);
      if (!rd) return `Week ${x}`;
      const short = { Final: "Final", Semifinals: "Semis", Quarterfinals: "Quarters" }[rd.name] || rd.name.replace("Round ", "R");
      return rd.weeks.length > 1 ? `${short} ${rd.weeks.indexOf(x) + 1}` : short;
    }
    function playoffLine(s) {
      const n = s.playoffTeams, P = 2 ** Math.ceil(Math.log2(n)), byes = P - n, plan = G.playoffPlan(L());
      const legs = s.playoffLegs === "all2" ? ", every round two weeks" : s.playoffLegs === "final2" ? ", a two-week final" : "";
      const extra = s.consolation === "third" ? ", and a third-place game" : s.consolation === "bracket" ? ", and a consolation bracket for the teams that miss" : "";
      return `${s.weeks} weeks, then ${n} teams in the playoffs${byes ? ` (the top ${byes} get a bye)` : ""} over ${plan.reduce((a, rd) => a + rd.weeks.length, 0)} weeks${legs}${extra}`;
    }
    // If the season ended today: the seeds, first-round games (and byes) and the rounds after them.
    function bracketPreview() {
      const n = L().settings.playoffTeams, stAll = standings(), seeds = G.seedOrder(L()).slice(0, n).map((t, i) => Object.assign({}, stAll.find((r) => r.team === t), { rank: i + 1 }));
      if (n < 2) return `<p class="ps" style="margin:0">No playoffs in this league.</p>`;
      const P = 2 ** Math.ceil(Math.log2(n)), first = [];
      for (let i = 0; i < P / 2; i++) first.push([seeds[i], seeds[P - 1 - i] || null]);
      const team = (r) => `<div class="bk-t${isMe(r.team) ? " me" : ""}"><span class="sd">${r.rank}</span>${teamAv(T(r.team), "sm")}<span class="ell">${esc(T(r.team).name)}</span><span class="ps">${esc(recOf(r.team))}</span></div>`;
      const wk = (rd) => (rd.weeks.length > 1 ? `weeks ${rd.weeks[0]} and ${rd.weeks[1]}` : `week ${rd.weeks[0]}`);
      const tbd = `<div class="bk-g tbd"><div class="bk-t"><span class="ps">Winner</span></div><div class="bk-t"><span class="ps">Winner</span></div></div>`;
      return `<p class="ps" style="margin:0 0 10px">If the season ended today:</p><div class="bk">${G.playoffPlan(L()).map((rd, ri) => `<div class="bk-r"><b class="ps">${esc(rd.name)}, ${wk(rd)}</b>${ri === 0
        ? first.map(([a, b]) => (b ? `<div class="bk-g">${team(a)}${team(b)}</div>` : `<div class="bk-g">${team(a)}<div class="bk-t"><span class="ps">Bye</span></div></div>`)).join("")
        : Array.from({ length: P / 2 ** (ri + 1) }, () => tbd).join("")}</div>`).join("")}</div>`;
    }
    function standingsPage() {
      if (gl()) return survivorsPage();
      if (roto()) return rotoStandingsPage();
      const dv = !!L().divs;
      const st = standings().map((r) => Object.assign({}, r, { team: T(r.team), me: isMe(r.team), href: teamHref(r.team), cut: !dv && r.rank === L().settings.playoffTeams && r.rank < L().teams.length, badge: finishTag(r.team) || seedTag(r) }));
      const pw = G.power(L(), ctx);
      const tables = dv ? L().divNames.map((nm, k) => `<div class="stack" style="gap:8px"><h2 style="margin:0;font-size:16px">${esc(nm)}</h2>${U.standingsTable(st.filter((r) => r.div === k).map((r, i) => Object.assign({}, r, { rank: i + 1 })), { pfLabel: pts() ? "PF" : "Cats won", paLabel: pts() ? "PA" : "Cats lost", fmt: fmtS })}</div>`).join("")
        : U.standingsTable(st, { pfLabel: pts() ? "PF" : "Cats won", paLabel: pts() ? "PA" : "Cats lost", fmt: fmtS });
      const br = G.bracket(L(), ctx);
      return `<div class="wrap page"><div class="head"><h1 class="disp">Standings</h1><span class="ps">${!L().settings.playoffTeams ? `No playoffs: first place wins the title. Ties break on ${pts() ? "points for" : "categories won"}.` : over() ? "Final regular-season standings. The playoffs decided the title." : `${dv ? `${L().settings.playoffTeams >= L().settings.divisions ? "Division winners get the top seeds, then the best records fill" : "The best records make"} the ${L().settings.playoffTeams} playoff spots` : `Top ${L().settings.playoffTeams} make the playoffs (the dashed line)`}${byes() ? `, and the top ${byes()} get a bye` : ""}.${L().settings.median ? " Records count a game against the league median each week." : ""} Ties break on ${pts() ? "points for" : "categories won"}.`}</span></div>
        ${tables}
        <div class="cols2">
          <div class="card"><div class="mod-h"><h2>Power rankings</h2><span class="ps">Record, scoring and roster strength</span></div><ol class="feed">${pw.map((r) => `<li style="grid-template-columns:24px auto minmax(0,1fr) auto;align-items:center;padding:8px 16px"><b class="ps num">${r.rank}</b>${teamAv(T(r.team), "sm")}<a class="ell" href="${teamHref(r.team)}" style="color:inherit;text-decoration:none"><b>${esc(T(r.team).name)}</b> <span class="ps">${recOf(r.team)}</span></a>${moveTag(r.move)}</li>`).join("")}</ol></div>
          <div class="card"><div class="mod-h"><h2>Playoffs</h2><span class="ps">Weeks ${L().settings.weeks + 1} to ${G.totalWeeks(L())}</span></div><div class="bd pobd">${br.length ? br.map((b) => [["title", ""], ["third", "Third place"], ["cons", "Consolation"]].map(([k, name]) => [name, b.games.filter((m) => (m.kind || "title") === k)]).filter(([, gs]) => gs.length).map(([name, gs]) => `<div class="stack" style="gap:8px;margin-bottom:12px"><b class="ps">${name ? `${name}: ` : ""}${esc(b.round)}, week ${b.week}${b.leg ? ` (${b.leg})` : ""}</b>${U.scoreboard(gs.map((m) => ({ href: matchHref(b.week, m.i), me: isMe(m.a) || isMe(m.b), status: m.final ? "final" : "proj", a: { team: T(m.a), score: m.final ? m.sa : m.pa }, b: { team: T(m.b), score: m.final ? m.sb : m.pb } })), fmtS)}</div>`).join("")).join("") : bracketPreview()}</div></div>
        </div></div>`;
    }
    function scoreboardPage(arg) {
      if (gl()) return resultsPage();
      if (roto()) return rotoWeekPage(arg);
      const w = Math.min(curWeek(), +arg || ui.sbWeek || curWeek());
      const weeks = Array.from({ length: Math.min(curWeek(), G.totalWeeks(L())) }, (_, i) => i + 1);
      return `<div class="wrap page"><div class="head"><h1 class="disp">Scoreboard</h1></div>
        <div class="chips" role="group" aria-label="Week">${weeks.map((x) => `<button type="button" data-sbweek="${x}" aria-pressed="${x === w}">${weekChip(x)}</button>`).join("")}</div>
        <div class="cols2 hide-m">${G.matchups(L(), ctx, w, frac(w)).slice().sort((a, b) => (isMe(b.a) || isMe(b.b) ? 1 : 0) - (isMe(a.a) || isMe(a.b) ? 1 : 0)).map((m) => `<a class="card" href="${matchHref(w, m.i)}" style="text-decoration:none;color:inherit${isMe(m.a) || isMe(m.b) ? ";border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)" : ""}">${U.versus(Object.assign(versusVM(w, m), { cats: null }))}</a>`).join("")}</div>
        <div class="show-m sbm">${U.scoreboard(gamesVM(w), fmtS, { list: true })}</div></div>`;
    }
    const TXK = { add: "add", drop: "drop", "add/drop": "add", waiver: "waiver", trade: "trade", veto: "trade" };
    function txVM(x) {
      const lines = [];
      if (x.type === "trade") { for (const id of x.adds) lines.push(U.txLine(sport, "trade", playerVM(id), `to ${esc(T(x.team).abbr)}`)); for (const id of x.drops) lines.push(U.txLine(sport, "trade", playerVM(id), `to ${esc(T(x.other).abbr)}`)); }
      else { for (const id of x.adds || []) lines.push(U.txLine(sport, x.type === "waiver" ? "waiver" : "add", playerVM(id), x.type === "waiver" && x.faab != null ? `$${x.faab}${x.bid != null && x.bid !== x.faab ? ` (bid $${x.bid})` : ""}${x.bids > 1 ? `, beat ${x.bids - 1} bid${x.bids > 2 ? "s" : ""}` : ""}` : "")); for (const id of x.drops || []) lines.push(U.txLine(sport, "drop", playerVM(id))); }
      if (x.type === "veto") lines.push(`<span class="ps">The league vetoed a trade</span>`);
      if (x.type === "draft" || x.text) lines.push(`<span class="ps">${esc(x.text || "")}</span>`);
      if (x.type === "chop") { lines.length = 0; lines.push(`<span class="ps">${esc(x.text)}</span>`); }
      if (x.type === "bite") { lines.length = 0; for (const id of x.adds) lines.push(U.txLine(sport, "trade", playerVM(id), `from ${esc(T(x.other).abbr)}`)); for (const id of x.drops) lines.push(U.txLine(sport, "trade", playerVM(id), `to ${esc(T(x.other).abbr)}`)); }
      const badge = x.type === "bite" ? `<span class="tag loss">Bite</span>` : x.type === "chop" ? `<span class="tag loss">Chopped</span>` : x.type === "champion" ? `<span class="tag win">Champion</span>` : x.type === "trade" ? `<span class="tag info">Trade</span>` : x.type === "waiver" ? `<span class="tag gold">Waiver</span>` : x.type === "veto" ? `<span class="tag loss">Veto</span>` : "";
      return { team: T(Math.max(0, x.team)), with: x.type === "trade" ? T(x.other) : null, when: now() - x.at < 2 * 864e5 && x.at <= now() ? `Week ${x.week}, ${U.ago(x.at, now())}` : `Week ${x.week}`, lines, badge };
    }
    /* ---------- league chat (shared leagues pass opts.chat: posts(), send(body), unread(), seen()) ---------- */
    // Posts and the league's biggest moves, oldest first, so a trade shows up where people talked about it.
    function chatItems() {
      const posts = opts.chat.posts().map((p) => ({ at: p.at, p }));
      const moves = L().tx.filter((x) => x.type === "trade" || x.type === "chop" || x.type === "champion").map((x) => ({ at: x.at, x }));
      return posts.concat(moves).sort((a, b) => a.at - b.at);
    }
    const chatBody = (t) => esc(t).replace(/\n/g, "<br>");
    function chatLi(it, prev) {
      if (it.x) {
        const x = it.x, t = T(x.team);
        const text = x.type === "trade" ? `<b>${esc(t.name)}</b> and <b>${esc(T(x.other).name)}</b> made a trade` : x.type === "chop" ? `<b>${esc(t.name)}</b> was chopped` : `<b>${esc(t.name)}</b> won the title`;
        return `<li class="sys"><span class="txi ${x.type === "chop" ? "drop" : "trade"}" aria-hidden="true">${x.type === "chop" ? "&times;" : x.type === "trade" ? "&#8644;" : "&#9733;"}</span><span>${text}</span><time>${esc(U.ago(x.at, now()))}</time></li>`;
      }
      const p = it.p, t = T(p.team) || { name: p.author, abbr: "", color: 0 };
      // a run of posts from the same team within ten minutes reads as one message
      const cont = prev && prev.p && prev.p.team === p.team && it.at - prev.at < 6e5;
      return `<li class="${isMe(p.team) ? "mine " : ""}${cont ? "cont" : ""}">${cont ? `<span></span>` : faces()[p.team] && faces()[p.team].photo ? U.faceAv(faces()[p.team], p.author, "sm") : teamAv(t, "sm")}<div class="what">${cont ? "" : `<div class="who"><b>${esc(t.name)}</b><span class="ps">${esc(p.author)}</span><time>${esc(U.ago(p.at, now()))}</time></div>`}<p>${chatBody(p.body)}</p></div></li>`;
    }
    function chatList(items) {
      return items.length ? `<ul class="chat">${items.map((it, i) => chatLi(it, items[i - 1])).join("")}</ul>` : `<div class="bd"><p class="ps" style="margin:0">No posts yet. Say hello, or talk some trash about this week's matchup.</p></div>`;
    }
    const chatForm = (big) => (me() != null ? `<form class="chat-f" id="fk-chatf"><label class="sr" for="fk-chat">Message the league</label><textarea id="fk-chat" rows="${big ? 2 : 1}" maxlength="500" placeholder="Message the league">${esc(ui.chatDraft || "")}</textarea><button class="btn go">Send</button></form>`
      : `<div class="bd ps">Only managers in this league can post.</div>`);
    function chatPage() {
      opts.chat.seen();
      return `<div class="wrap page"><div class="head"><h1 class="disp">Chat</h1><span class="ps">Everyone in the league sees this. Trades and big moves show up here too.</span></div>
        <div class="card chat-card" style="max-width:760px">${chatList(chatItems().slice(-200))}${chatForm(true)}</div></div>`;
    }
    function chatCard() {
      if (!opts.chat) return "";
      const items = chatItems().slice(-4), n = opts.chat.unread();
      return `<div class="card chat-card"><div class="mod-h"><h2>League chat</h2>${n ? `<span class="badge">${n}</span>` : ""}<a href="#league/chat">Open chat</a></div>${chatList(items)}${chatForm(false)}</div>`;
    }
    function txPage() {
      const f = ui.txf;
      const items = L().tx.slice().reverse().filter((x) => x.type !== "draft" && (!f || (f === "add" ? /add/.test(x.type) : f === "drop" ? (x.drops || []).length && x.type !== "trade" : x.type === f)));
      return `<div class="wrap page"><div class="head"><h1 class="disp">Transactions</h1><span class="ps">${((n) => (n ? `${n} move${n === 1 ? "" : "s"} this season` : "No moves yet this season"))(L().tx.filter((x) => x.type !== "draft").length)}</span></div>
        <div class="chips" role="group" aria-label="Type">${[["", "All"], ["add", "Adds"], ["drop", "Drops"], ["waiver", "Waivers"], ["trade", "Trades"]].map(([k, n]) => `<button type="button" data-txf="${k}" aria-pressed="${k === f}">${n}</button>`).join("")}</div>
        <div class="card">${U.feed(items.slice(0, 120).map(txVM), f ? "None of these yet." : "No adds, drops or trades yet.")}</div></div>`;
    }
    /* ---------- league history: past seasons (shared leagues pass opts.history()) plus this one ---------- */
    function seasonsAll() {
      const cur = G.summary(L()), past = ((opts.history && opts.history()) || []).filter((x) => x && x.year !== cur.year);
      cur.live = !over();
      return past.concat(cur).sort((a, b) => a.year - b.year);
    }
    const yearName = (x) => (x.season ? esc(x.season) : `Year ${esc(x.year)}`);
    function pastPage() {
      const all = seasonsAll(), done = all.filter((x) => !x.live), many = all.length > 1;
      const rec = (x) => `${x.w != null ? `${x.w}-${x.l}${x.t ? "-" + x.t : ""}` : "-"}`;
      const champRows = all.slice().reverse().map((x) => {
        const c = x.champion, row = c && (x.standings || []).find((r) => r.team === c.team), lead = x.live ? (x.standings || [])[0] : null;
        return `<tr><td class="nm"><b>${yearName(x)}</b>${x.live ? ` <span class="pill sm">Now</span>` : ""}</td>
          <td>${x.live ? (lead ? `<span class="ps">Leading:</span> ${esc(lead.name)}` : "") : c ? `<b>${esc(c.name)}</b>${c.owner ? ` <span class="ps">${esc(c.owner)}</span>` : ""}` : `<span class="ps">No champion</span>`}</td>
          ${all.some((y) => !y.live && y.runnerUp) ? `<td class="hide-s">${!x.live && x.runnerUp ? esc(x.runnerUp.name) : ""}</td>` : ""}<td class="r num">${x.live ? (lead ? rec(lead) : "") : row ? rec(row) : ""}</td></tr>`;
      }).join("");
      // records across every season that kept them (seasons saved before records were kept are skipped)
      const best = {};
      for (const x of all) for (const [k, v] of Object.entries(x.records || {})) {
        const lower = k === "low" || k === "closest";
        if (!best[k] || (lower ? v.v < best[k].v : v.v > best[k].v)) best[k] = Object.assign({ year: x }, v);
      }
      const when = (r) => `${many ? `${yearName(r.year)}, ` : ""}week ${r.week || r.through}${r.po ? ", playoffs" : ""}`;
      const recRows = [
        best.high && ["Highest score", `<b>${fmtS(best.high.v)}</b> ${esc(best.high.name)}`, when(best.high)],
        best.low && ["Lowest score", `<b>${fmtS(best.low.v)}</b> ${esc(best.low.name)}`, when(best.low)],
        best.blowout && ["Biggest win", best.blowout.cats ? `<b>${best.blowout.score[0]}-${best.blowout.score[1]}</b> ${esc(best.blowout.winName)} over ${esc(best.blowout.loseName)}` : `<b>${fmtS(best.blowout.v)}</b> ${esc(best.blowout.winName)} over ${esc(best.blowout.loseName)}, ${fmtS(best.blowout.score[0])} to ${fmtS(best.blowout.score[1])}`, when(best.blowout)],
        best.closest && ["Closest win", `<b>${fmtS(best.closest.v)}</b> ${esc(best.closest.winName)} over ${esc(best.closest.loseName)}, ${fmtS(best.closest.score[0])} to ${fmtS(best.closest.score[1])}`, when(best.closest)],
        best.streak && ["Longest win streak", `<b>${best.streak.v} straight</b> ${esc(best.streak.name)}`, `${many ? `${yearName(best.streak.year)}, ` : ""}through week ${best.streak.through}`],
      ].filter(Boolean);
      // all-time standings: by team, across every season including this one
      const tot = {};
      for (const x of all) for (const r of x.standings || []) {
        const a = (tot[r.team] = tot[r.team] || { team: r.team, seasons: 0, w: 0, l: 0, t: 0, pts: 0, titles: 0, finals: 0, places: [] });
        a.seasons++; a.w += r.w || 0; a.l += r.l || 0; a.t += r.t || 0; a.pts += r.pts || 0;
        if (!x.live) { if (x.champion && x.champion.team === r.team) a.titles++; if ((x.champion && x.champion.team === r.team) || (x.runnerUp && x.runnerUp.team === r.team)) a.finals++; a.places.push(r.place || r.rank); }
      }
      const hasWL = !gl() && !roto();
      const rows = Object.values(tot).filter((a) => L().teams[a.team]).sort((a, b) => b.titles - a.titles || (hasWL ? (b.w + b.t / 2) / Math.max(1, b.w + b.l + b.t) - (a.w + a.t / 2) / Math.max(1, a.w + a.l + a.t) : 0) || b.pts - a.pts);
      const pct3 = (a) => { const g = a.w + a.l + a.t; return g ? ((a.w + a.t / 2) / g).toFixed(3).replace(/^0/, "") : "-"; };
      const avg = (a) => (a.places.length ? (a.places.reduce((s, x) => s + x, 0) / a.places.length).toFixed(1) : "-");
      return `<div class="wrap page"><div class="head"><h1 class="disp">League history</h1><span class="ps">${done.length ? `${done.length} finished season${done.length > 1 ? "s" : ""}` : "The first season"}${all.some((x) => x.live) ? ", one under way" : ""}</span></div>
        <div class="cols2"><div class="stack">
          <div class="card"><div class="mod-h"><h2>Champions</h2></div><div class="table-wrap"><table class="t"><thead><tr><th>Season</th><th>Champion</th>${all.some((x) => !x.live && x.runnerUp) ? `<th class="hide-s">Runner-up</th>` : ""}<th class="r">Record</th></tr></thead><tbody>${champRows}</tbody></table></div>
            ${many ? "" : `<p class="ps" style="margin:10px 16px 14px">Each finished season is added here when the commissioner starts the next one.</p>`}</div>
          <div class="card"><div class="mod-h"><h2>Records</h2>${many ? `<span class="ps">All seasons</span>` : ""}</div>${recRows.length ? `<div class="bd"><dl class="kv rec">${recRows.map(([k, v, w]) => `<dt>${k}</dt><dd>${v}<small>${w}</small></dd>`).join("")}</dl></div>` : `<p class="empty">${pts() || gl() ? "Records start once a week is final." : "Score records are for points leagues; win streaks start once a week is final."}</p>`}</div>
        </div>
        <div class="card"><div class="mod-h"><h2>All-time standings</h2></div><div class="table-wrap"><table class="t"><thead><tr><th>Team</th>${many ? `<th class="r hide-s">Seasons</th>` : ""}${hasWL ? `<th class="r">Record</th><th class="r hide-s">Pct</th>` : ""}<th class="r">Titles</th>${many ? `<th class="r hide-s">Avg finish</th>` : ""}${pts() ? `<th class="r hide-s">Points</th>` : ""}</tr></thead><tbody>
          ${rows.map((a) => `<tr${isMe(a.team) ? ` class="me"` : ""}><td class="nm"><a class="row" style="gap:8px;text-decoration:none;color:inherit" href="${teamHref(a.team)}">${teamAv(T(a.team), "sm")}<span class="ell">${esc(T(a.team).name)}</span></a></td>${many ? `<td class="r num hide-s">${a.seasons}</td>` : ""}${hasWL ? `<td class="r num">${rec(a)}</td><td class="r num hide-s">${pct3(a)}</td>` : ""}<td class="r num">${a.titles ? `<b>${a.titles}</b>` : "0"}</td>${many ? `<td class="r num hide-s">${avg(a)}</td>` : ""}${pts() ? `<td class="r num hide-s">${fmtS(a.pts)}</td>` : ""}</tr>`).join("")}
        </tbody></table></div></div></div></div>`;
    }
    /* ---------- managers: who runs each team, with their photo, record and titles ---------- */
    const faces = () => (opts.faces && opts.faces()) || {};
    const faceOf = (id) => { const t = T(id), f = faces()[id]; return t.owner ? Object.assign({ name: t.owner }, f || {}) : null; };
    function managerStats(id) {
      const r = standings().find((x) => x.team === id) || {}, all = seasonsAll();
      let titles = 0, w = 0, l = 0, t = 0, seasons = 0;
      for (const x of all) { const row = (x.standings || []).find((y) => y.team === id); if (!row) continue; seasons++; w += row.w || 0; l += row.l || 0; t += row.t || 0; if (!x.live && x.champion && x.champion.team === id) titles++; }
      const now = gl() ? recOf(id) : roto() ? `${ord(r.rank)}` : `${r.w || 0}-${r.l || 0}${r.t ? "-" + r.t : ""}`;
      return { now, place: r.rank, titles, seasons, all: `${w}-${l}${t ? "-" + t : ""}` };
    }
    function managerCard(id, big) {
      const tm = T(id), f = faceOf(id), m = managerStats(id), hasWL = !gl() && !roto();
      const stats = `<div class="mgr-s"><span><small>${gl() ? "This season" : roto() ? "Place" : "Record"}</small><b>${esc(m.now)}</b></span>${!gl() && !roto() && m.place ? `<span><small>Place</small><b>${ord(m.place)}</b></span>` : ""}${m.seasons > 1 && hasWL ? `<span><small>All-time</small><b>${esc(m.all)}</b></span>` : ""}<span><small>Titles</small><b>${m.titles}</b></span></div>`;
      const tags = `${isMe(id) && !/^you$/i.test(tm.owner || "") ? `<span class="tag you">You</span>` : ""}${!tm.owner ? `<span class="tag">Bot</span>` : ""}`;
      if (big) return `<div class="mgr-card">${U.faceAv(f, tm.owner || "Bot", "xl")}<h3 class="disp" style="margin:6px 0 0">${esc(tm.owner || "A bot")}</h3><div class="mgr-tags">${tags}</div>
        <a class="mgr-t" href="${teamHref(id)}" data-close>${teamAv(tm, "sm")}<span class="ell">${esc(tm.name)}</span></a>${stats}
        ${isMe(id) && opts.editProfile ? `<button type="button" class="btn sm" data-editprofile>Edit your profile</button>` : ""}</div>`;
      return `<button type="button" class="mgr${isMe(id) ? " me" : ""}" data-mgr="${id}"><span class="mgr-h">${U.faceAv(f, tm.owner || "Bot", "lg")}<span style="min-width:0"><b class="ell">${esc(tm.owner || "A bot")}</b><span class="mgr-tags">${tags}</span></span></span>
        <span class="mgr-t">${teamAv(tm, "sm")}<span class="ell">${esc(tm.name)}</span></span>${stats}</button>`;
    }
    function managersPage() {
      const ids = standings().map((r) => r.team).concat(L().teams.map((t) => t.id)).filter((x, i, a) => a.indexOf(x) === i);
      const people = ids.filter((id) => T(id).owner).length;
      const bots = ids.filter((id) => !T(id).owner);
      const botList = bots.length ? `<div class="card" style="margin-top:14px"><div class="mod-h"><h2>${opts.invite != null ? "Open seats" : "Run by bots"}</h2><span class="ps">${bots.length} team${bots.length > 1 ? "s" : ""}</span>${opts.invite != null ? `<button type="button" class="btn sm" data-live="invite" style="margin-left:auto">Invite managers</button>` : ""}</div>
        <ul class="feed">${bots.map((id) => { const m = managerStats(id); return `<li style="grid-template-columns:auto minmax(0,1fr) auto;align-items:center;padding:9px 16px"><a class="row" href="${teamHref(id)}" style="gap:8px;text-decoration:none;color:inherit;grid-column:1 / 3">${teamAv(T(id), "sm")}<span class="ell"><b>${esc(T(id).name)}</b></span></a><span class="ps num">${esc(m.now)}${!gl() && !roto() && m.place ? `, ${ord(m.place)}` : ""}</span></li>`; }).join("")}</ul></div>` : "";
      return `<div class="wrap page"><div class="head"><h1 class="disp">Managers</h1><span class="ps">${people} of ${L().teams.length} teams have a manager${people < L().teams.length ? ", bots run the rest" : ""}.</span>${me() != null && opts.editProfile ? `<button type="button" class="btn sm" data-editprofile style="margin-left:auto">Edit your profile</button>` : ""}</div>
        <div class="mgrs">${ids.filter((id) => T(id).owner).map((id) => managerCard(id)).join("")}</div>${botList}</div>`;
    }
    const duesPage = () => (opts.dues ? `<div class="wrap page"><div class="head"><h1 class="disp">Dues</h1><span class="ps">Money moves through Venmo, PayPal, Cash App or Zelle. This keeps track of who's paid.</span></div><div id="fk-dues">${opts.dues()}</div></div>` : `<div class="wrap page"><p class="ps">This league doesn't have dues.</p></div>`);
    function settingsPage() {
      const s = L().settings;
      return `<div class="wrap page"><div class="head"><h1 class="disp">League rules</h1>${opts.commishTools ? `<a class="btn sm" href="#commish" style="margin-left:auto">Change them</a>` : ""}</div><div class="cols2">
        <div class="card"><div class="mod-h"><h2>Format</h2></div><div class="bd"><dl class="kv"><dt>Sport</dt><dd>${esc(sport.name)}</dd><dt>Scoring</dt><dd>${esc(sc().label)}</dd>${S.bonusLines(sc()).length ? `<dt>Bonuses</dt><dd>${S.bonusLines(sc()).map(esc).join("<br>")}</dd>` : ""}<dt>Stats</dt><dd>${s.real ? `Real box scores${(opts.hooks || {}).real ? ` from ${esc(opts.hooks.real.source)}` : ""}. A week closes once its last games are in` : "Simulated from each player's season"}</dd><dt>Teams</dt><dd>${L().teams.length}</dd><dt>Format</dt><dd>${gl() ? `Guillotine: the lowest score each week is chopped${s.chops > 1 ? ` (${s.chops} a week)` : ""}. On a tie, the lower projection goes` : roto() ? "Rotisserie: season totals in each category, ranked" : s.tally === "cats" ? "Head to head: each category is a win or a loss" : s.tally === "allplay" ? "All-play: each week, your score against every team" : "Head to head"}${bb() ? ", best ball" : ""}${s.median ? ", plus a game each week against the league median" : ""}</dd>${L().divs ? `<dt>Divisions</dt><dd>${L().divNames.map((nm, k) => `${esc(nm)}: ${L().teams.filter((t) => L().divs[t.id] === k).map((t) => esc(t.name)).join(", ")}`).join("<br>")}</dd>` : ""}
          ${G.vampireOf(L()) != null ? `<dt>Vampire</dt><dd>${esc(T(G.vampireOf(L())).name)} skipped the draft and built from free agents. Each regular-season week it wins, it takes any player from the team it beat and gives back one of its own${s.vampire.samePos ? " at the same position" : ""}${s.vampire.double ? ", and bites the week's lowest scorer too" : ""}. No bites in the playoffs, and it claims first on waivers every week.</dd>` : ""}
          ${s.pyo ? `<dt>Pick your opponent</dt><dd>Week 1 was drawn. After that, during each week the teams pick next week's opponents, worst record first, with 12 hours a turn. A team that runs out of time gets the weakest team left. Nobody picks the team they're playing that week.</dd>` : ""}
          ${s.robin ? `<dt>Robin Hood</dt><dd>After each regular-season week, the lowest scorer takes one player from the top scorer and gives one back${s.robin.like ? " at the same position" : ""}. The top scorer keeps his ${s.robin.protect} most valuable. Two days into the next week, it's made for him.</dd>` : ""}
          ${s.conquest ? `<dt>Conquest</dt><dd>Win your matchup and take one player from the team you beat, giving one back${s.conquest.like ? " at the same position" : ""}. The loser keeps his ${s.conquest.protect} most valuable. Two days into the next week, it's made for you.</dd>` : ""}
          ${s.crown ? `<dt>Kingslayer</dt><dd>Week 1's top scorer took the crown. Beat the king and you take it, with the bounty: it starts at $${s.crown.start} and grows $${s.crown.step} every week he keeps it${s.crown.keep ? `, and he earns $${s.crown.keep} of FAAB for each week he survives` : ""}. Regular season only.</dd>` : ""}
          ${s.hangover ? `<dt>The Hangover</dt><dd>Last week's winners can't add free agents or put in waiver claims this week. Trades and lineup moves are fine.</dd>` : ""}
          ${s.topBonus ? `<dt>Top-score bonus</dt><dd>The week's top scorer gets $${s.topBonus} of FAAB.</dd>` : ""}<dt>Season</dt><dd>${gl() ? `${s.weeks} weeks, until one team is left` : s.playoffTeams ? playoffLine(s) : `${s.weeks} weeks, no playoffs: first place wins`}</dd>${s.trades === false ? `<dt>Trades</dt><dd>None</dd>` : `<dt>Trade deadline</dt><dd>${s.deadline ? `After week ${s.deadline}` : "None"}</dd><dt>Trade review</dt><dd>${s.tradeReview === "none" ? "None" : `${fmtHours(s.reviewHours)}, ${Math.round(s.vetoShare * 100)}% of the league to veto`}</dd><dt>Offers</dt><dd>Expire after ${fmtHours(s.offerHours || 48)}</dd>`}</dl></div></div>
        <div class="stack"><div class="card"><div class="mod-h"><h2>Rosters</h2></div><div class="bd"><dl class="kv"><dt>Starters</dt><dd>${s.lineup.map((x) => `<span class="slot" style="margin:0 3px 3px 0">${esc(x)}</span>`).join("")}</dd><dt>Bench</dt><dd>${s.bench}</dd><dt>IR spots</dt><dd>${s.ir || "None"}</dd>${s.maxAdds ? `<dt>Pickups</dt><dd>Up to ${s.maxAdds} a week, counting adds and won claims</dd>` : ""}${s.posMax && Object.keys(s.posMax).length ? `<dt>Position limits</dt><dd>${Object.entries(s.posMax).map(([k, v]) => `${v} ${esc(k)}`).join(", ")}</dd>` : ""}${s.confMax ? `<dt>Conference limit</dt><dd>At most ${s.confMax} starters from one FBS college conference, by each school's conference this season. Independents like Notre Dame and schools outside FBS have no limit.</dd>` : ""}<dt>Lineups</dt><dd>${bb() ? "Best ball: set automatically" : "Set each week"}</dd>${s.dynasty ? `<dt>Dynasty</dt><dd>Every roster carries over. Each new season opens with a ${s.dynasty.rounds}-round rookie and free agent draft, worst team first${s.dynasty.picks !== false ? ", and next season's picks can be traded" : ""}.</dd>${s.dynasty && s.taxi ? `<dt>Taxi squad</dt><dd>${s.taxi} spot${s.taxi > 1 ? "s" : ""} for rookies and rookie-draft picks, off the roster limit. They can't start, and a promotion is for good.</dd>` : ""}` : s.keepers ? `<dt>Keepers</dt><dd>Up to ${s.keepers}, costing ${{ round: "the round he went in", round1: "one round earlier than he went", free: "a last-round pick", price: "what he went for", price5: "what he went for plus $5" }[s.keeperCost] || "the round he went in"}</dd>` : ""}<dt>Waivers</dt><dd>${s.waivers === "faab" ? `${s.faabBank ? `FAAB from the draft's time bank, $${Math.round(s.faab / 2)} to $${Math.round(s.faab * 1.5)}` : `$${s.faab} FAAB`}${gl() ? " for the whole season" : ""}, ${s.waiverAt != null ? `claims run ${Math.round(s.waiverAt / 24 * 10) / 10} days into each week` : `${G.waiverDays(L())} business day${G.waiverDays(L()) === 1 ? "" : "s"} after a drop, at 3 AM Eastern${G.gameLockOn(L()) ? "; a player whose game has started is locked until next week" : ""}`}` : "Rolling priority"}</dd><dt>Waiver order</dt><dd>${s.waivers === "faab" ? "The highest bid wins. On a tie, the better waiver priority wins" : "The best waiver priority wins"}. Winning a claim sends you to the back of the line, even within the same run.</dd></dl></div></div>
        ${sc().cats ? `<div class="card"><div class="mod-h"><h2>Categories</h2></div><div class="bd">${sc().cats.map((c) => `<span class="slot" style="margin:0 4px 4px 0">${esc(c.label)}</span>`).join("")}<p class="ps">${gl() ? "Each week, teams are ranked in every category: the best gets one point per team alive, the worst gets one. Lowest total is chopped." : "Head to head: win more categories than your opponent to win the week."}</p></div></div>` : ""}
      </div></div></div>`;
    }
    function draftPage() {
      const D = L().draft;
      if (!D) return `<div class="wrap page"><p class="empty">This league didn't draft here.</p></div>`;
      const dctx = FK.draft.context(D, opts.players, sport);
      const st = FK.draft.standings(D, dctx).sort((a, b) => a.rank - b.rank);
      const n = D.teams.length, cols = D.round1, auction = D.type === "auction";
      let cells = `<div class="h"></div>${cols.map((id) => `<div class="h${isMe(id) ? " me" : ""}">${teamAv(T(id), "sm")}<b>${esc(T(id).name)}</b></div>`).join("")}`;
      // each team's column: the players it ended the draft with, in the order it got them (steals and trades included)
      const mine = (id) => D.board.filter((x) => x && x.team === id && !x.gone);
      for (let r = 0; r < D.rounds; r++) {
        cells += `<div class="rn">${r + 1}</div>`;
        for (let col = 0; col < n; col++) {
          const pk = auction ? D.sales.filter((x) => x.team === cols[col])[r] : mine(cols[col])[r];
          const p = pk && pk.pid && ctx.byId[pk.pid];
          cells += `<div class="cell${p ? " f c" + U.colorOf(sport, p) : ""}${isMe(cols[col]) ? " me" : ""}"${p ? ` data-player="${esc(p.id)}" role="button" tabindex="0"` : ""}>${p ? `<b>${esc(p.n)}</b><small>${S.positions(p).join(", ")} ${esc(p.t)}${auction ? " " + money(pk.price) : ""}</small>` : ""}</div>`;
        }
      }
      return `<div class="wrap page"><div class="head"><h1 class="disp">Draft results</h1><span class="ps">${esc(FK.draft.FORMATS[D.type])}, ${D.rounds} rounds${D.done ? `, ${new Date(D.done).toLocaleDateString("en-US", { month: "long", day: "numeric" })}` : ""}</span>${opts.draftHref ? `<a class="btn sm" href="${esc(opts.draftHref)}" style="margin-left:auto">Open the draft room</a>` : ""}</div>
        <div class="board" style="max-height:70vh"><div class="bgrid" style="--n:${n};grid-template-columns:28px repeat(${n},minmax(0,1fr))">${cells}</div></div>
        <div class="card"><div class="mod-h"><h2>Draft grades</h2><span class="ps">By each team's best lineup at draft time</span></div><div class="bd"><div class="teams">${st.map((r) => `<div class="row gradeitem">${teamAv(T(r.team), "md")}<div style="min-width:0"><b class="ell" style="display:block">${esc(T(r.team).name)}</b><span class="ps">${ord(r.rank)}${r.spent != null ? `, spent ${money(r.spent)}` : ""}</span></div><b class="grade disp">${r.grade}</b></div>`).join("")}</div></div></div></div>`;
    }

    /* ---------- pages: the guillotine ---------- */
    const pct = (x) => (x == null ? "" : x < 0.005 ? "<1%" : x > 0.995 ? ">99%" : Math.round(x * 100) + "%");
    // The chopping block: every team still alive, best to worst, with its odds of going this week.
    // A team the league protects this week (the demo keeps your seat safe until you arrive): settings.immune
    const safeUntil = (team) => (L().settings.immune || {})[team];
    const isProtected = (team, w) => safeUntil(team) >= w;
    // who goes this week: the result once it's final, otherwise the lowest teams that aren't protected
    function doomedOf(w, rows) {
      if (rows.length && rows[0].final) return rows.filter((r) => r.out).map((r) => r.team);
      return rows.filter((r) => !isProtected(r.team, w)).slice(-L().settings.chops).map((r) => r.team);
    }
    function blockList(w, opts = {}) {
      const rows = blockOf(w), live = w === L().week && !over();
      const final = rows.length && rows[0].final;
      const doomed = doomedOf(w, rows);
      const cut = rows.findIndex((r) => doomed.includes(r.team));
      const tie = final && rows.find((r) => doomed.includes(r.team) && rows.some((x) => !doomed.includes(x.team) && !isProtected(x.team, w) && Math.abs(x.score - r.score) < 1e-9));
      const max = Math.max(...rows.map((r) => r.score), 1);
      return `<ol class="blk${opts.compact ? " compact" : ""}">${rows.map((r, i) => {
        const t = T(r.team), out = final ? r.out : false;
        const danger = !final && r.chop != null && r.chop >= 0.25;
        return `${i === cut ? `<li class="cutline" aria-hidden="true"><span>${final ? "" : "The cut line"}</span></li>` : ""}<li class="${isMe(r.team) ? "me " : ""}${out ? "out " : ""}${danger ? "hot" : ""}">
          <span class="rk">${r.rank}</span>${teamAv(t, "sm")}<a class="ell nm" href="${teamHref(r.team)}"><b>${esc(t.name)}</b>${isMe(r.team) ? ` <span class="tag you">You</span>` : ""}${isProtected(r.team, w) ? ` <span class="tag" title="Can't be chopped through week ${safeUntil(r.team)}">Protected</span>` : ""}</a>
          <span class="sc"><b>${!final && !(r.frac > 0) ? (pts() ? fmtS(r.proj) : "-") : fmtS(r.score)}</b>${pts() && !final ? `<small>${r.frac > 0 ? `proj ${fmtS(r.score + r.proj * (1 - (r.frac || 0)))}` : "projected"}</small>` : !pts() ? `<small>${final ? "roto pts" : "roto pts so far"}</small>` : ""}</span>
          ${final ? `<span class="odds bare">${out ? `<span class="tag loss">Chopped</span>` : over() && G.champion(L()) === r.team ? `<span class="tag gold">Champion</span>` : ""}</span>` : `<span class="odds" title="Chance of being chopped this week"><i style="width:${Math.round((r.chop || 0) * 100)}%"></i><span>${pct(r.chop)}</span></span>`}
          <span class="bar" aria-hidden="true"><i style="width:${Math.max(0, (r.score / max) * 100).toFixed(1)}%"></i></span></li>`;
      }).join("")}</ol>${tie && !opts.compact ? `<p class="ps" style="margin:10px 16px 0">${esc(T(tie.team).name)} tied for the lowest score. Ties go to the higher projection, so ${esc(T(tie.team).abbr)} was chopped.</p>` : ""}${rows.some((r) => isProtected(r.team, w)) && !opts.compact ? `<p class="ps" style="margin:10px 16px 0">Protected teams can't be chopped this week${L().demo ? ": the demo keeps your seat safe until the week you arrived" : ""}, so the lowest team without protection goes.</p>` : ""}${live && !opts.compact ? `<p class="ps" style="margin:10px 16px 14px">${Math.round(frac(w) * 100)}% of the week played. Chop odds play out the rest of each team's projection a few hundred times.</p>` : ""}`;
    }
    // Where the chopped team's players went: the winning bid after the chop, or still unclaimed.
    function fateOf(c, pid) {
      const chopId = (L().tx.find((e) => e.type === "chop" && e.team === c.team) || { id: 0 }).id;
      const x = L().tx.find((e) => e.id > chopId && (e.type === "waiver" || /add/.test(e.type)) && (e.adds || []).includes(pid));
      if (x) return x.type === "waiver" ? `went to ${esc(T(x.team).abbr)} for $${x.faab}` : `went to ${esc(T(x.team).abbr)} off free agency`;
      return over() ? (c.week >= G.totalWeeks(L()) ? "was never claimed: the season ended" : "went unclaimed") : G.onWaivers(L(), pid, now()) ? "is up for bids" : "is a free agent";
    }
    function memoriam(limit) {
      const list = (L().chopped || []).slice().reverse().slice(0, limit || 99);
      if (!list.length) return `<p class="empty">No one has been chopped yet. The lowest score this week goes first.</p>`;
      return `<ul class="feed">${list.map((c) => {
        const best = c.roster.map((id) => ctx.byId[id]).filter(Boolean).sort((a, b) => b.$ - a.$).slice(0, 3);
        return `<li style="grid-template-columns:auto minmax(0,1fr);align-items:start;padding:10px 16px">${teamAv(T(c.team), "md")}<div style="min-width:0"><b>${esc(T(c.team).name)}</b> <span class="ps">week ${c.week}, ${fmtS(c.score)}${pts() ? " points" : " roto points"}, ${ord(c.place)} place</span>
          <div class="ps" style="margin-top:3px">${best.map((p) => `<span data-player="${esc(p.id)}" style="cursor:pointer"><b>${esc(p.n)}</b></span> ${fateOf(c, p.id)}`).join(", ")}${c.faab ? `. Left $${c.faab} unspent.` : ""}</div></div></li>`;
      }).join("")}</ul>`;
    }
    function upForBids(n) {
      const ids = Object.keys(L().waivers).filter((id) => G.onWaivers(L(), id, now()) && ctx.own[id] == null);
      const ps = ids.map((id) => ctx.byId[id]).filter(Boolean).sort((a, b) => b.$ - a.$).slice(0, n || 8);
      const mid = me(), mine = mid != null ? L().claims.filter((c) => c.team === mid && c.status === "open") : [];
      if (!ps.length) return `<p class="empty">Nothing on waivers right now. When a team is chopped, its whole roster lands here.</p>`;
      return `<ul class="feed">${ps.map((p) => { const c = mine.find((x) => x.add === p.id); return `<li style="grid-template-columns:minmax(0,1fr) auto;align-items:center;padding:8px 16px"><span data-player="${esc(p.id)}" style="cursor:pointer;min-width:0">${pname(sport, p, `${esc(p.prank)}, worth ${money(p.$)}`)}</span>${mid != null && G.isAlive(L(), mid) ? (c ? `<span class="tag gold">Your bid $${c.bid}</span>` : `<button class="btn sm" data-add="${esc(p.id)}">Bid</button>`) : ""}</li>`; }).join("")}</ul>`;
    }
    function guillotineOverview() {
      const w = curWeek(), mid = me(), champ = over() ? G.champion(L()) : null;
      const mine = mid != null && !over() ? blockRow(w, mid) : null;
      const st = standings(), myRow = mid != null ? st.find((r) => r.team === mid) : null;
      const recent = L().tx.slice().reverse().filter((x) => x.type !== "draft").slice(0, 7);
      const s = L().settings;
      return `<div class="wrap page">
        ${champ != null ? `<div class="banner"><span>${teamAv(T(champ), "lg")}</span><div><b class="disp" style="font-size:26px">${esc(T(champ).name)} is the last team standing</b><div class="ps">${L().teams.length - 1} teams chopped, one a week.</div></div></div>` : ""}
        ${!over() ? `<div class="stack" style="gap:8px"><div class="row"><h2 style="margin:0;font-size:15px">Week ${w} scores</h2><a href="#matchup/${w}" class="small" style="margin-left:auto">The block</a></div>${scoreStrip(w)}</div>` : ""}
        <div class="cols"><div class="stack">
          ${!over() ? `<div class="card"><div class="mod-h"><h2>Week ${w}: the chopping block</h2><span class="ps">${L().alive.length} left, lowest ${s.chops > 1 ? s.chops + " go" : "goes"}</span><a href="#matchup/${w}">Full block</a></div>${blockList(w)}</div>` : ""}
          <div class="card"><div class="mod-h"><h2>In memoriam</h2><a href="#league/standings">Survivors</a></div>${memoriam(5)}</div>
          <div class="card"><div class="mod-h"><h2>Recent activity</h2><a href="#players/tx">All transactions</a></div>${U.feed(recent.map(txVM), "No moves yet.")}</div>
        </div><aside class="stack">
          ${myRow ? `<div class="card"><div class="mod-h">${teamAv(T(mid), "md")}<div style="min-width:0"><b class="ell" style="display:block">${esc(T(mid).name)}</b><span class="ps">${myRow.alive ? (over() ? "Champion" : `Alive, ${ord(myRow.rank)} in points`) : `Chopped in week ${myRow.out}`}</span></div></div>
            <div class="bd"><div class="stat-row"><div><small>FAAB left</small><b>$${T(mid).faab}</b></div><div><small>${mine ? "Chop odds" : "Weeks survived"}</small><b class="${mine && mine.chop >= 0.25 ? "loss" : ""}">${mine ? pct(mine.chop) : myRow.w}</b></div><div><small>Points</small><b>${fmtS(myRow.pf)}</b></div></div>
            ${myRow.alive && !over() ? `<div class="row" style="margin-top:12px;flex-wrap:wrap"><a class="btn sm" href="#team/roster">${bb() ? "See my roster" : "Set lineup"}</a><a class="btn sm" href="#players/claims">My bids</a><a class="btn sm" href="#players/fa">Free agents</a></div>` : ""}</div></div>` : ""}
          ${mid != null && !over() && L().claims.some((c) => c.team === mid && c.status === "open") ? `<div class="card"><div class="mod-h"><h2>Your bids</h2><a href="#players/claims">All bids</a></div><div class="bd" style="padding-bottom:0"><span class="ps">${esc(claimsRun())}</span></div>${claimList(L().claims.filter((c) => c.team === mid && c.status === "open"))}</div>` : ""}
          ${over() ? "" : `<div class="card"><div class="mod-h"><h2>Up for bids</h2>${!over() && Object.keys(L().waivers).some((id) => G.onWaivers(L(), id, now())) ? `<span class="ps">${esc(claimsRun())}</span>` : ""}</div>${upForBids(8)}</div>`}
        </aside></div></div>`;
    }
    // A scoreboard strip for a league with no head-to-head games: every team still alive, its score and chop odds.
    function scoreStrip(w) {
      const rows = blockOf(w), live = w === L().week;
      const list = rows.slice().sort((a, b) => (isMe(b.team) ? 1 : 0) - (isMe(a.team) ? 1 : 0));
      return `<div class="scoreboard${list.length <= 6 ? " fill" : ""}">${list.map((r) => `<a class="game solo${isMe(r.team) ? " me" : ""}" href="${teamHref(r.team)}"><div class="st"><span class="${live && frac(w) > 0 ? "live" : ""}">${live ? (frac(w) > 0 ? "Live" : "Projected") : "Final"}</span><span>${ord(r.rank)}</span></div>
        <div class="ln">${teamAv(T(r.team), "sm")}<span class="ell">${esc(T(r.team).name)}</span><span class="ab">${esc(T(r.team).abbr)}</span><b>${fmtS(r.score)}</b></div>
        <div class="ln"><small>${r.chop != null ? `${pct(r.chop)} to be chopped` : r.out ? "Chopped" : "Safe"}</small></div></a>`).join("")}</div>`;
    }
    function blockPage(sub) {
      let w = +sub || curWeek();
      w = Math.max(1, Math.min(w, curWeek()));
      const weeks = Array.from({ length: curWeek() }, (_, k) => k + 1).filter((x) => L().results[x] || x === L().week);
      const mid = me(), row = mid != null ? blockRow(w, mid) : null;
      return `<div class="wrap page"><div class="head"><h1 class="disp">The block, week ${w}</h1><span class="ps">${bb() ? "Best ball: every roster's best lineup scores automatically. " : ""}The lowest score is chopped. On a tie, the lower projection goes.</span></div>
        <div class="chips" role="group" aria-label="Week">${weeks.map((x) => `<button type="button" data-mweek="${x}" aria-pressed="${x === w}">Wk ${x}</button>`).join("")}</div>
        <div class="cols"><div class="card">${blockList(w)}</div>
        <aside class="stack">${row ? myWeekCard(w, mid, row) : ""}</aside></div>${gamedayStatus(w)}${teamGameBoxes(w, blockOf(w).map(r=>r.team))}</div>`;
    }
    // Your week: who's starting (or, in best ball, who's counting) and what each has scored.
    function myWeekCard(w, id, row) {
      const ids = row.lineup || G.lineupFor(L(), ctx, id, w);
      const p = row.players || {};
      const rows = L().settings.lineup.map((slot, i) => { const q = ids[i] && ctx.byId[ids[i]]; return `<li><span class="slot">${esc(slot)}</span>${q ? `<span data-player="${esc(q.id)}" style="cursor:pointer;min-width:0">${pname(sport, q, "", { size: "sm" })}</span><b class="num">${pts() ? fmtS(p[q.id]) : q.v.toFixed(1)}</b>` : `<span class="ps">Empty</span><span></span>`}</li>`; }).join("");
      const blockRows = blockOf(w), doomed = doomedOf(w, blockRows);
      const onIt = doomed.includes(row.team);
      const safe = blockRows.filter((r) => !doomed.includes(r.team) && !isProtected(r.team, w));
      const lowSafe = safe[safe.length - 1], highDoom = blockRows.filter((r) => doomed.includes(r.team))[0];
      const margin = onIt ? row.score - (lowSafe ? lowSafe.score : row.score) : row.score - (highDoom ? highDoom.score : row.score);
      const line = isProtected(row.team, w) ? `Protected through week ${safeUntil(row.team)}, so you can't be chopped`
        : Math.abs(margin) < 1e-9 && (onIt ? lowSafe : highDoom) ? `Tied with ${esc(T((onIt ? lowSafe : highDoom).team).abbr)} at the cut line. The higher projection stays`
        : onIt ? (lowSafe ? `On the block, ${fmtS(-margin)} behind ${esc(T(lowSafe.team).abbr)}` : "On the block") : `${fmtS(margin)} clear of the block`;
      return `<div class="card"><div class="mod-h">${teamAv(T(id), "sm")}<b>Your week</b><span class="ps" style="margin-left:auto">${ord(row.rank)} of ${blockRows.length}</span></div>
        <div class="bd" style="padding-bottom:4px"><span class="ps">${line}</span></div>
        <ul class="rslots">${rows}</ul>${bb() ? `<p class="ps" style="margin:8px 12px 12px">Best ball picked these from your roster by what they scored.</p>` : ""}</div>`;
    }
    function survivorsPage() {
      const st = standings();
      return `<div class="wrap page"><div class="head"><h1 class="disp">Survivors</h1><span class="ps">${over() ? "The season is over." : `${L().alive.length} of ${L().teams.length} teams left. Teams still alive rank by points; the chopped rank by how long they lasted.`}</span></div>
        <div class="table-wrap"><table class="t"><thead><tr><th class="c">#</th><th>Team</th><th>Status</th><th class="r">Points</th><th class="r hide-s">Last week</th><th class="r hide-s">Close calls</th><th class="r">FAAB</th></tr></thead><tbody>
        ${st.map((r) => `<tr class="${isMe(r.team) ? "me" : ""}${!r.alive ? " dim" : ""}"><td class="c num">${r.rank}</td><td class="nm"><a href="${teamHref(r.team)}" style="color:inherit;text-decoration:none">${teamName(T(r.team), { owner: false })}</a></td><td>${r.alive ? (over() ? `<span class="tag win">Champion</span>` : `<span class="tag win">Alive</span>`) : `<span class="tag loss">Out week ${r.out}</span>`}</td><td class="r num"><b>${fmtS(r.pf)}</b></td><td class="r num hide-s">${fmtS(r.last)}</td><td class="r num hide-s" title="Weeks in the bottom two">${r.close}</td><td class="r num">$${T(r.team).faab}</td></tr>`).join("")}</tbody></table></div>
        <div class="card"><div class="mod-h"><h2>In memoriam</h2></div>${memoriam()}</div></div>`;
    }
    function resultsPage() {
      const w = ui.sbWeek || Math.max(1, Math.min(curWeek(), L().week - 1 || 1));
      const weeks = Object.keys(L().results).map(Number).sort((a, b) => a - b);
      if (!weeks.length) return `<div class="wrap page"><div class="head"><h1 class="disp">Weekly results</h1></div><p class="empty">No week has finished yet. See the live block on the block tab.</p></div>`;
      const show = weeks.includes(w) ? w : weeks[weeks.length - 1];
      return `<div class="wrap page"><div class="head"><h1 class="disp">Weekly results</h1></div>
        <div class="chips" role="group" aria-label="Week">${weeks.map((x) => `<button type="button" data-sbweek="${x}" aria-pressed="${x === show}">Week ${x}</button>`).join("")}</div>
        <div class="card"><div class="mod-h"><h2>Week ${show}</h2><span class="ps">${esc(T(L().results[show].chopped[0]).name)} was chopped</span></div>${blockList(show)}</div></div>`;
    }
    function historyPage(id) {
      const rows = Object.keys(L().results).map(Number).sort((a, b) => a - b).map((w) => {
        const res = L().results[w], b = res.block, r = b.find((x) => x.team === id);
        if (!r) return "";
        const last = b[b.length - 1], above = b[b.length - 2];
        const margin = r.out ? r.score - above.score : r.score - last.score;
        return `<tr><td><a href="#matchup/${w}">Week ${w}</a></td><td class="r num"><b>${fmtS(r.score)}</b></td><td class="r num">${ord(r.rank)} of ${b.length}</td><td class="r num ${r.out ? "loss" : margin < (pts() ? 10 : 4) ? "" : "win"}">${r.out ? `Chopped by ${fmtS(-margin)}` : `+${fmtS(margin)}`}</td></tr>`;
      }).join("");
      const live = !over() && G.isAlive(L(), id) ? blockRow(L().week, id) : null;
      return `<div class="wrap page">${teamHead(id)}<div class="table-wrap"><table class="t"><thead><tr><th>Week</th><th class="r">Score</th><th class="r">Rank</th><th class="r">Over the cut</th></tr></thead><tbody>
        ${live ? `<tr class="me"><td><a href="#matchup/${L().week}">Week ${L().week}</a> <span class="pill live">Live</span></td><td class="r num"><b>${fmtS(live.score)}</b></td><td class="r num">${ord(live.rank)} of ${L().alive.length}</td><td class="r num">${pct(live.chop)} to be chopped</td></tr>` : ""}${rows || `<tr><td colspan="4" class="empty">No weeks finished yet.</td></tr>`}</tbody></table></div></div>`;
    }

    /* ---------- pages: My Team ---------- */
    function teamHead(id) {
      const t = T(id), r = standings().find((x) => x.team === id);
      return `<div class="team-h">${teamAv(t, "xl")}<div style="min-width:0"><h1 class="disp">${esc(t.name)}${isMe(id) ? ` <span class="tag you" style="font-size:13px;vertical-align:6px">You</span>` : ""}${G.vampireOf(L()) === id ? ` <span class="tag loss" style="font-size:13px;vertical-align:6px">Vampire</span>` : ""}</h1>
        <div class="meta">${gl() ? `<span><b>${esc(recOf(id))}</b>${r.alive ? `, ${ord(r.rank)} in points` : ""}</span>` : `<span><b>${r.w}-${r.l}${r.t ? "-" + r.t : ""}</b>, ${ord(r.rank)} place</span>`}<span>${pts() ? `<b>${fmtS(r.pf)}</b> points for` : `<b>${r.pf}</b> categories won`}</span><span>FAAB <b>$${t.faab}</b></span><span>Waiver priority <b>${ord(t.priority + 1)}</b></span>${t.owner && !(isMe(id) && /^you$/i.test(t.owner)) ? `<a href="#league/managers" data-mgr="${id}"${isMe(id) ? ' class="th-me"' : ""} style="display:inline-flex;align-items:center;gap:6px;color:inherit;text-decoration:none">${U.faceAv(faceOf(id), t.owner, "sm")}Manager <b>${esc(t.owner)}</b></a>` : t.owner ? "" : `<span>Bot</span>`}</div></div>
        <span class="grow"></span><div class="th-acts">${isMe(id) ? `<button class="btn" data-editteam>Edit team</button>` : ""}${!isMe(id) && canTrade() ? `<button class="btn go" data-trade="${id}">Propose a trade</button>` : ""}
        <label class="sr" for="team-pick">Team</label><select id="team-pick" style="width:auto;border-radius:999px">${L().teams.map((x) => `<option value="${x.id}"${x.id === id ? " selected" : ""}>${esc(x.name)}${isMe(x.id) ? " (you)" : ""}</option>`).join("")}</select></div></div>`;
    }
    // Where this week's numbers come from: real box scores (and when they last came in), or a simulation.
    function scoreNote() { const m = scoreMsg(); return m ? `<div class="wrap" style="padding-top:10px"><p class="ps" style="margin:0">${m}</p></div>` : ""; }
    function scoreMsg() {
      if (over()) return "";
      const R = (opts.hooks || {}).real, w = L().week, rw = G.realWeek(L(), ctx, w);
      const when = (t) => new Date(t).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
      let msg;
      if (rw && now() >= G.weekStart(L(), w + 1) && !rw.final) msg = `Week ${w} is over and lineups are locked. It closes when the last box scores come in, usually by the next morning.`;
      else if (rw) msg = `Real box scores from ${esc(R.source || "the league feeds")}, updated ${when(R.updated)}.`;
      else msg = "Scores are simulated from each player's season, not real games.";
      return msg;
    }
    // a link to something that isn't there says so once, instead of quietly showing something else
    function badLink(msg) { if (ui.badLink === location.hash) return; ui.badLink = location.hash; setTimeout(() => U.toast(msg, true), 0); }
    function rosterPage(arg) {
      const id = arg !== "" && arg != null && L().teams[+arg] ? +arg : me() != null ? me() : 0;
      if (arg !== "" && arg != null && !L().teams[+arg]) badLink(`There's no team ${arg} in this league, so here's ${isMe(id) ? "yours" : T(id).name}.`);
      const mine = isMe(id);
      const w = ui.week && ui.week >= L().week ? ui.week : curWeek();
      const slots = L().settings.lineup;
      const game = !over() && !gl() ? findGame(w, id) : null;
      const brow = gl() && !over() && G.isAlive(L(), id) && w === L().week ? blockRow(w, id) : null;
      const side = game ? (game.a === id ? game.ta : game.tb) : null;
      // best ball shows the lineup that is counting right now; otherwise the lineup that's set
      const lu = (bb() && w === L().week && (brow ? brow.lineup : side && side.lineup)) || G.lineupFor(L(), ctx, id, w);
      const ptsOf = (pid) => {
        const v = brow ? (brow.players || {})[pid] : side ? (side.players || {})[pid] : null;
        if (v != null || !bb() || !pts() || w !== L().week || !ctx.byId[pid]) return v;
        return G.playerWeek(L(), ctx, ctx.byId[pid], w, frac(w)).pts;   // best ball: the bench scores too, it just doesn't count
      };
      const wk = G.WEEK[sport.key] || { weeks: 20 };
      // this week: what he should finish with (so far plus what's left); next week: his projection for it
      const soFar = (p) => { const v = ptsOf(p.id); return v != null ? v : frac(w) > 0 ? G.playerWeek(L(), ctx, p, w, frac(w)).pts || 0 : 0; };   // bench players too
      // a starter's projection counts his slot's weight too (a showdown captain's 1.5x)
      const projOf = (p) => { if (!pts()) return null; const m = G.slotMult(L(), lu.indexOf(p.id), p.id); return w === curWeek() ? soFar(p) + (projFor(p, soFar(p), w) - soFar(p)) * m : (p.v / wk.weeks) * m; };
      const ir = L().ir[id] || [], irMax = G.irSlots(L()), alive = G.isAlive(L(), id), taxi = G.taxiOf(L(), id), txMax = G.taxiSlots(L());
      const moving = ui.moving && L().rosters[id].includes(ui.moving) && !G.held(L(), id).includes(ui.moving) ? ctx.byId[ui.moving] : null;
      const movingSlot = moving ? lu.indexOf(moving.id) : -1;
      const locked = G.lineupLocked(L(), w, now()) || bb() || !alive;
      // a player whose game has started (real leagues): he stays put, in the lineup or on the bench
      const pl = (p) => !!p && G.isLocked(L(), p, w, now());
      const fitsSlot = (i) => moving && i != null && S.fits(sport, moving, slots[i]) && !pl(lu[i] && ctx.byId[lu[i]]);
      // where the player being moved can go: an open or filled starting slot he fits, or a bench player who fits his slot
      const targetFor = (p, i) => {
        if (!moving || p === moving) return "";
        if (i != null) return fitsSlot(i) ? `<button class="btn xs go" data-here="${i}">${p ? "Swap" : "Move here"}</button>` : "";
        return p && movingSlot >= 0 && S.fits(sport, p, slots[movingSlot]) && !pl(p) ? `<button class="btn xs go" data-swapb="${esc(p.id)}" data-slot="${movingSlot}">Swap</button>` : "";
      };
      const actsFor = (p, onIR, onTaxi) => {
        if (!p) return "";
        if (onTaxi) return mine && alive && !over() ? `<button class="btn xs go" data-promote="${esc(p.id)}" title="Move up to the active roster for good">Promote</button>` : !mine && canTrade() ? `<button class="btn icon trade" data-trade="${id}" data-want="${esc(p.id)}" aria-label="Trade for ${esc(p.n)}" title="Trade for">&#8644;</button>` : "";
        if (!mine) return canTrade() ? `<button class="btn icon trade" data-trade="${id}" data-want="${esc(p.id)}" aria-label="Trade for ${esc(p.n)}" title="Trade for">&#8644;</button>` : "";
        if (!alive || over()) return "";
        if (onIR) return `<button class="btn xs${G.irEligible(p) ? "" : " go"}" data-activate="${esc(p.id)}">Activate</button>`;
        if (moving) return "";
        // locked: a starter can't leave the lineup (no IR, no drop); a locked bench player can still be dropped or stashed
        const lockedIn = pl(p) && lu.includes(p.id);
        if (lockedIn) return `<span class="lk-tag" title="His game has started. He's locked in until the week ends.">${LOCK}Locked</span>`;
        const irBtn = G.irEligible(p) && ir.length < irMax ? `<button class="btn xs" data-toir="${esc(p.id)}" title="Move to injured reserve">IR</button> ` : "";
        const txBtn = txMax && taxi.length < txMax && !lu.includes(p.id) && G.taxiEligible(L(), ctx, p.id) ? `<button class="btn xs" data-totaxi="${esc(p.id)}" title="Stash him on the taxi squad">Taxi</button> ` : "";
        return `${irBtn}${txBtn}${!locked && !pl(p) ? `<button class="btn xs hide-s" data-move="${esc(p.id)}">Move</button>` : ""}${L().settings.frozen ? "" : ` <button class="btn xs warn hide-s" data-drop="${esc(p.id)}" aria-label="Drop ${esc(p.n)}">Drop</button>`}`;
      };
      const blocked = new Set(L().settings.trades === false ? [] : G.blockOf(L(), ctx, id));
      const row = (slotLabel, p, i, onIR, onTaxi) => {
        const can = mine && !locked && p && !onIR && !onTaxi && !pl(p);
        const tgt = targetFor(p, i);
        const on = fitsSlot(i) ? " on" : "";
        const cpt = slotLabel === "CPT" ? " cpt" : "";
        // while moving, a highlighted slot does the move (the same as its Swap button); any other slot cancels it
        const tgtAttr = moving && p !== moving ? (i != null && fitsSlot(i) ? `data-here="${i}"` : tgt && i == null ? `data-swapb="${esc(p.id)}" data-slot="${movingSlot}"` : `data-move=""`) : "";
        const slotEl = moving && tgtAttr && (can || (i != null && fitsSlot(i))) ? `<button type="button" class="slot slotbtn${on}${cpt}" ${tgtAttr} title="${tgtAttr === 'data-move=""' ? "Cancel the move" : `Move ${esc(moving.n)} here`}">${esc(slotLabel)}</button>`
          : can ? `<button type="button" class="slot slotbtn${on}${cpt}" data-move="${moving && p === moving ? "" : esc(p.id)}" title="${moving && p === moving ? "Cancel the move" : `Move ${esc(p.n)}`}">${esc(slotLabel)}</button>`
          : `<span class="slot${on}${cpt}${onIR ? " ir" : ""}${pl(p) && !onIR && !onTaxi ? " lk" : ""}"${pl(p) && !onIR && !onTaxi ? ` title="${esc(p.n)}'s game has started: locked until the week ends"` : ""}>${pl(p) && !onIR && !onTaxi ? LOCK : ""}${esc(slotLabel)}</span>`;
        const cls = [moving && p === moving ? "me" : "", tgt ? "tgt" : "", onIR ? "irrow" : ""].filter(Boolean).join(" ");
        // drag and drop: a starter, bench or IR player can be dragged; every slot, the bench and IR take drops
        const drag = mine && alive && !over() && p && !onTaxi && (onIR || !locked) && (onIR || !pl(p)) ? ` data-dg="${esc(p.id)}" data-from="${onIR ? "ir" : i != null ? "s" + i : "bn"}"` : "";
        const zone = i != null ? (pl(p) ? "" : ` data-dz="s${i}"`) : onIR ? ` data-dz="ir"` : onTaxi ? "" : ` data-dz="bn"${p && !pl(p) ? ` data-dzp="${esc(p.id)}"` : ""}`;
        return `<tr class="${cls}"${drag}${zone}><td class="c" style="width:86px;white-space:nowrap">${drag ? `<span class="grip" aria-hidden="true"></span>` : ""}${slotEl}</td><td class="nm">${p ? `<span data-player="${esc(p.id)}" style="cursor:pointer">${pname(sport, p, `${esc(p.prank)}${onIR && !G.irEligible(p) ? `, <span class="win">healthy</span>` : ""}${blocked.has(p.id) ? `, <span class="blk-tag">on the block</span>` : ""}${heistTag(p)}`)}</span>${!onIR && !onTaxi && w === curWeek() && gameChip(p, w) ? `<div class="gmr">${gameChip(p, w)}</div>` : ""}` : `<span class="ps">${onIR ? "Open for a player who's out or on IR" : onTaxi ? "Open for a rookie" : L().heist && i != null ? "Open: stolen in the heist. Add a free agent here" : "Empty"}</span>`}</td>
          <td class="r num hide-s">${p ? `<span class="ps">#${p.rank}</span>` : ""}</td><td class="r num">${p && pts() && !onIR && !onTaxi ? `<b>${fmtS(ptsOf(p.id))}</b><small class="ps only-s">proj ${fmtS(projOf(p))}</small>` : p && !onIR && !onTaxi ? `<b>${p.v.toFixed(1)}</b>` : ""}</td><td class="r num hide-s">${p && pts() && !onIR && !onTaxi ? fmtS(projOf(p)) : ""}</td>
          <td class="r act">${tgt || actsFor(p, onIR, onTaxi)}</td></tr>`;
      };
      const starters = slots.map((s, i) => row(s, lu[i] ? ctx.byId[lu[i]] : null, i, false)).join("");
      const benchIds = L().rosters[id].filter((x) => !lu.includes(x) && !ir.includes(x) && !taxi.includes(x));
      const bench = benchIds.map((x) => ctx.byId[x]).filter(Boolean).sort((a, b) => a.rank - b.rank).map((p) => row("BN", p, null, false)).join("") || `<tr><td colspan="6" class="empty">No one on the bench.</td></tr>`;
      const txRows = txMax ? taxi.map((x) => row("TX", ctx.byId[x], null, false, true)).join("") + Array.from({ length: Math.max(0, txMax - taxi.length) }, () => row("TX", null, null, false, true)).join("") : "";
      const irRows = irMax ? ir.map((x) => row("IR", ctx.byId[x], null, true)).join("") + Array.from({ length: Math.max(0, irMax - ir.length) }, () => row("IR", null, null, true)).join("") : "";
      const weeks = [curWeek()].concat(curWeek() < G.totalWeeks(L()) ? [curWeek() + 1] : []);
      const claims = mine ? L().claims.filter((c) => c.team === id && c.status === "open") : [];
      return `<div class="wrap page">${teamHead(id)}
        <div class="row wk-bar" style="flex-wrap:wrap">${weeks.length > 1 ? `<div class="seg" role="group" aria-label="Week">${weeks.map((x) => `<button type="button" data-week="${x}" aria-pressed="${x === w}">Week ${x}${x === L().week ? ", now" : ""}</button>`).join("")}</div>` : ""}
          ${game ? `<a class="pill" href="${matchHref(w, game.i)}" style="text-decoration:none">vs ${esc(T(game.a === id ? game.b : game.a).name)}${w === L().week && frac(w) > 0 ? `: ${fmtS(game.a === id ? game.sa : game.sb)} to ${fmtS(game.a === id ? game.sb : game.sa)}` : ""}</a>` : ""}
          ${brow ? `<a class="pill" href="#matchup/${w}" style="text-decoration:none">${fmtS(brow.score)}, ${ord(brow.rank)} of ${L().alive.length}, ${pct(brow.chop)} to be chopped</a>` : ""}
          <span class="grow"></span>${mine && !locked && !moving ? `<button class="btn sm" data-optimize><span class="hide-xs">Start my best lineup</span><span class="show-xs">Best lineup</span></button>` : ""}</div>
        ${moving ? `<div class="movebar" role="status"><span>Moving <b>${esc(moving.n)}</b>. Pick a highlighted spot${movingSlot >= 0 ? ", or swap with a bench player" : ""}.</span><span class="grow"></span>${movingSlot >= 0 ? `<button class="btn sm" data-here="BN">To bench</button>` : ""}<button class="btn sm" data-move="">Cancel</button></div>` : ""}
        ${gl() && !alive ? `<div class="banner loss"><b>Chopped in week ${(L().chopped.find((c) => c.team === id) || {}).week}.</b> <span class="muted">This roster went back on waivers.</span></div>` : ""}
        ${mine && L().settings.frozen && L().heist && L().rosters[id].length < G.maxRoster(L()) && !over() ? `<div class="alert"><span>A steal left a spot open in your lineup. Pick up a free agent for it before his game starts: he scores normal points.</span><a class="btn sm go" href="#players/fa">Free agents</a></div>` : ""}
        ${claims.length ? `<div class="card"><div class="mod-h"><h2>Pending waiver claims</h2><span class="ps">${esc(claimsRun())}</span><a href="#players/claims">All claims</a></div>${claimList(claims)}</div>` : ""}
        <div class="table-wrap"><table class="t roster"><thead><tr><th class="c">Slot</th><th>Player</th><th class="r hide-s">Rank</th><th class="r">${pts() ? "Pts" : "Value"}</th><th class="r hide-s">${pts() ? "Proj" : ""}</th><th class="act"></th></tr></thead><tbody>
          <tr class="sec"><td colspan="6">Starters</td></tr>${starters}<tr class="sec" data-dz="bn"><td colspan="6">Bench</td></tr>${bench}${irMax ? `<tr class="sec" data-dz="ir"><td colspan="6">Injured reserve, ${ir.length} of ${irMax}</td></tr>${irRows}` : ""}${txMax ? `<tr class="sec"><td colspan="6">Taxi squad, ${taxi.length} of ${txMax}</td></tr>${txRows}` : ""}</tbody></table></div>
        ${mine ? `<p class="ps">${bb() ? "Best ball: there's no lineup to set. Each week your best possible lineup scores, picked from what your players actually did." : !alive ? "" : locked ? "This week is locked." : w === L().week && frac(w) > 0 ? `Drag a player onto a slot, or tap a slot, to move him. ${L().kick ? (sport.key === "nfl" ? "Players lock when their game kicks off." : "Players lock for the week when their team's first game starts.") : `Week ${w} is under way; in this demo a change counts for the whole week.`} Starters left empty score nothing.` : `Drag a player onto a slot, or tap a slot, to move him. ${L().settings.real ? (sport.key === "nfl" ? "Each player locks when his game kicks off" : "Each player locks for the week when his team's first game starts") : `Week ${w} lineups lock when it starts`}, and starters left empty score nothing.`}${irMax && alive ? " Drag a player who's out onto injured reserve to open a spot; IR spots don't count against your roster." : ""}${txMax && alive ? " Neither do taxi spots: stash rookies there, and promote one when he's ready to play. A promotion is for good." : ""}</p>` : ""}</div>`;
    }
    // Pending claims with their bids, each one cancellable.
    function claimList(list) {
      const mid = me(), faab = L().settings.waivers === "faab";
      const order = G.myClaims(L(), mid).filter((c) => list.includes(c));
      const canSwap = (a, b) => a && b && (!faab || a.bid === b.bid);
      return `<ul class="feed clms">${order.map((c, i) => `<li class="clm"><span class="n" title="Runs ${ord(i + 1)} of your claims">${i + 1}</span><div class="what">${U.txLine(sport, "add", ctx.byId[c.add])}${c.drop ? U.txLine(sport, "drop", ctx.byId[c.drop]) : ""}</div>${faab ? `<b class="dollar">$${c.bid}</b>` : "<span></span>"}<div class="ca">${order.length > 1 ? `<span class="ordb"><button type="button" class="btn icon xs" data-cup="${c.id}" aria-label="Run this claim earlier"${canSwap(order[i - 1], c) ? "" : " disabled"}>&#9650;</button><button type="button" class="btn icon xs" data-cdown="${c.id}" aria-label="Run this claim later"${canSwap(c, order[i + 1]) ? "" : " disabled"}>&#9660;</button></span>` : ""}<button class="btn sm" data-editclaim="${c.id}">${faab ? "Edit bid" : "Edit"}</button><button class="btn sm ghost" data-unclaim="${c.id}">Cancel</button></div></li>`).join("")}</ul>
        ${order.length > 1 ? `<p class="ps clm-note">${faab ? "Your claims run highest bid first. Among equal bids, the arrows set which runs first." : "Your claims run in this order, one each time your turn in the waiver line comes up."}</p>` : ""}`;
    }
    // What a player on waivers should cost: a fair range from his value, the league's budget and how much season is left.
    // Guillotine money is spent fast, so late in the season the same player costs a bigger share of what you have.
    function bidRange(p, tid) {
      const s = L().settings, have = T(tid).faab, min = s.minBid || 0;
      const total = Math.max(1, G.totalWeeks(L())), left = Math.max(1, total - L().week + 1), late = 1 - left / total, v = Math.max(1, p.$ || 1);
      // a depth add goes for a couple percent of a budget, a breakout starter for a quarter or more of it
      const good = Math.pow(Math.min(1, Math.max(0, v - 1) / 40), 0.8);
      const mid = gl() ? have * Math.max(0.01, Math.min(1, v / 45) * (0.06 + 0.8 * late * late)) : s.faab * (0.02 + 0.28 * good) * Math.sqrt(Math.max(0.3, left / total));
      const cl = (x) => Math.max(min, Math.min(have, Math.round(x)));
      return { lo: cl(mid * 0.6), mid: cl(mid), hi: cl(Math.max(mid * 1.6, mid + 2)), have, min };
    }
    // The last few winning bids in this league, the same position first, so a bid has something to go on.
    function recentWins(p) {
      const pos = S.positions(p)[0];
      const wins = L().tx.filter((x) => x.type === "waiver" && x.faab != null && x.adds && ctx.byId[x.adds[0]]).slice(-40).reverse();
      const pick = wins.filter((x) => S.positions(ctx.byId[x.adds[0]])[0] === pos).slice(0, 3);
      return (pick.length ? pick : wins.slice(0, 3)).map((x) => ({ p: ctx.byId[x.adds[0]], bid: x.faab, team: x.team, week: x.week, bids: x.bids }));
    }
    // A vampire's bite: one player to take from the victim, one of the vampire's own to give back.
    function biteDialog(id) {
      const b = (L().bites || []).find((x) => x.id === id && x.status === "open"), mid = me();
      if (!b) { U.toast("That bite is no longer open", true); return; }
      const like = b.like != null ? !!b.like : !!(L().settings.vampire && L().settings.vampire.samePos), room = L().rosters[mid].length - G.held(L(), mid).length < G.maxRoster(L());
      const off = new Set((b.protect || []).concat(b.by != null ? L().ir[b.victim] || [] : []));
      const theirs = L().rosters[b.victim].map((x) => ctx.byId[x]).filter(Boolean).sort((a, c) => off.has(a.id) - off.has(c.id) || a.rank - c.rank);
      const mine = L().rosters[mid].map((x) => ctx.byId[x]).filter(Boolean).sort((a, c) => c.rank - a.rank);
      const list = (ps, name) => `<div class="table-wrap" style="max-height:38dvh"><table class="t dense droplist"><tbody>${ps.map((q, i) => { const lock = name === "take" && off.has(q.id); return `<tr data-pos="${esc(S.positions(q)[0])}"${lock ? ' class="dim"' : ""}><td style="width:28px"><input type="radio" name="${name}" value="${esc(q.id)}" id="${name}${i}"${lock ? " disabled" : i === 0 && (name === "take" || !room) ? " checked" : ""}></td><td><label for="${name}${i}" style="cursor:pointer">${pname(sport, q, esc(q.prank))}</label></td><td class="r ps">${lock ? `<span class="tag">${(L().ir[b.victim] || []).includes(q.id) ? "IR" : "Protected"}</span>` : `#${q.rank}`}</td></tr>`; }).join("")}</tbody></table></div>`;
      const head = b.why === "robin" ? `Robin Hood: rob ${esc(T(b.victim).name)}` : b.why === "conquest" ? `The spoils: raid ${esc(T(b.victim).name)}` : `Bite ${esc(T(b.victim).name)}`;
      const why = b.why === "robin" ? `You had week ${b.week}'s lowest score and they had the highest. They keep their ${(b.protect || []).length} best.` : b.why === "conquest" ? `You beat them in week ${b.week}. They keep their ${(b.protect || []).length} best.` : b.why === "lowest" ? "The week's lowest scorer." : `You beat them in week ${b.week}.`;
      const verb = b.by != null ? (b.why === "robin" ? "Rob them" : "Take him") : "Bite";
      const Dl = U.dialog(`<h3 class="disp">${head}</h3><p class="ps" style="margin:0">${why} Take any one of their players${room ? "" : ` and give back one of yours${like ? " at the same position" : ""}`}. If you don't by ${esc(new Date(b.due).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" }))}, the best one is taken for you.</p>
        <form class="stack"><div class="cols2" style="gap:12px"><div class="field"><span class="lbl">Take from ${esc(T(b.victim).abbr)}</span>${list(theirs, "take")}</div>
        <div class="field"><span class="lbl">${room ? "Give back (optional: you have an open spot)" : "Give back"}</span>${list(mine, "give")}</div></div>
        <div class="acts"><button type="button" class="btn ghost" data-skipbite>${b.by != null ? "Pass" : "Skip this bite"}</button><span class="grow"></span><button type="button" class="btn" data-close>Later</button><button class="btn go">${verb}</button></div></form>`,
        (fd) => act(() => G.bite(L(), ctx, b.id, fd.get("take"), fd.get("give") || null, now()), `${(ctx.byId[fd.get("take")] || {}).n} is yours.`), { wide: true });
      // like for like: only the positions that match the player you're taking
      const sync = () => {
        if (!like) return;
        const on = Dl.querySelector('input[name="take"]:checked'), pos = on ? on.closest("tr").dataset.pos : null;
        Dl.querySelectorAll('input[name="give"]').forEach((r) => { const ok = r.closest("tr").dataset.pos === pos; r.disabled = !ok; r.closest("tr").classList.toggle("dim", !ok); if (!ok && r.checked) r.checked = false; });
        const first = Dl.querySelector('input[name="give"]:not([disabled])'); if (first && !Dl.querySelector('input[name="give"]:checked')) first.checked = true;
      };
      Dl.addEventListener("change", sync); sync();
      const sk = Dl.querySelector("[data-skipbite]");
      if (sk) sk.addEventListener("click", () => { Dl.close(); act(() => G.skipBite(L(), b.id, now()), b.by != null ? "Passed." : "Bite skipped."); });
    }
    // Who to drop when a full roster brings a player back from IR.
    function activateDialog(pid, taxi) {
      const mid = me(), p = ctx.byId[pid];
      const ros = L().rosters[mid].filter((x) => x !== pid && !G.held(L(), mid).includes(x)).map((x) => ctx.byId[x]).filter(Boolean).sort((a, b) => a.vor - b.vor);
      U.dialog(`<div class="pc-h">${U.playerAv(sport, p, "lg")}<div><h3 class="disp">${taxi ? "Promote" : "Activate"} ${esc(p.n)}</h3><div class="ps">Your roster is full, so someone has to go to make room.</div></div></div>
        <form class="stack"><div class="field"><span class="lbl">Drop</span><div class="table-wrap" style="max-height:44dvh"><table class="t dense droplist"><tbody>${ros.map((q, i) => `<tr><td style="width:28px"><input type="radio" name="drop" value="${esc(q.id)}" id="ad${i}"${i === 0 ? " checked" : ""}></td><td><label for="ad${i}" style="cursor:pointer">${pname(sport, q, esc(q.prank))}</label></td><td class="r ps">#${q.rank}</td></tr>`).join("")}</tbody></table></div></div>
        <div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn go">${taxi ? "Promote" : "Activate"} and drop</button></div></form>`,
        (fd) => act(() => (taxi ? G.promote : G.activate)(L(), ctx, mid, pid, fd.get("drop"), now()), taxi ? `${p.n} is on the active roster.` : `${p.n} is back from IR.`));
    }
    // Your team's look: name, abbreviation, color and crest, or an uploaded logo.
    function editTeam() {
      const mid = me(), t = T(mid);
      const st = { color: t.color || 0, shape: U.shapeOf(t), glyph: t.glyph === false ? "abbr" : U.glyphOf(t), img: t.img || null };
      const Dl = U.dialog(`<h3>Edit your team</h3><form class="stack et">
        <div class="row" id="et-prev" style="gap:14px"></div>
        <div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:10px"><div class="field"><label for="et-name">Team name</label><input type="text" id="et-name" name="name" maxlength="28" value="${esc(t.name)}"></div><div class="field"><label for="et-abbr">Abbreviation</label><input type="text" id="et-abbr" name="abbr" maxlength="3" value="${esc(t.abbr)}" style="text-transform:uppercase"></div></div>
        <div class="field"><span class="lbl">Color</span><div class="swatches">${Array.from({ length: 12 }, (_, i) => `<button type="button" class="sw av c${i}" data-et-color="${i}" aria-label="Color ${i + 1}"></button>`).join("")}</div></div>
        <div class="field"><span class="lbl">Shape</span><div class="swatches">${Object.keys(U.SHAPES).map((k) => `<button type="button" class="pick" data-et-shape="${k}" aria-label="${k}"></button>`).join("")}</div></div>
        <div class="field"><span class="lbl">Icon</span><div class="swatches">${Object.keys(U.GLYPHS).concat("abbr").map((k) => `<button type="button" class="pick" data-et-glyph="${k}" aria-label="${k === "abbr" ? "Abbreviation" : k}"></button>`).join("")}</div></div>
        <div class="field"><label for="et-img">Or upload a logo</label><input type="file" id="et-img" accept="image/*"><span class="ps">Square images look best. It's shrunk to 128 pixels and saved on this device. <button type="button" class="btn link" data-et-noimg>Use the crest instead</button></span></div>
        <div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn go">Save team</button></div></form>`,
        (fd) => {
          const name = String(fd.get("name") || "").trim(), abbr = String(fd.get("abbr") || "").trim().toUpperCase();
          if (!name) { U.toast("Give your team a name", true); return false; }
          const clash = L().teams.find((x) => x.id !== mid && (x.abbr || "").toUpperCase() === abbr);
          if (abbr && clash) { U.toast(`${clash.name} already uses ${abbr}`, true); return false; }
          Object.assign(T(mid), { name, abbr: abbr || name.split(/\s+/).map((x) => x[0]).join("").slice(0, 3).toUpperCase(), color: st.color, shape: st.shape, glyph: st.glyph === "abbr" ? false : st.glyph });
          if (st.img) T(mid).img = st.img; else delete T(mid).img;
          save(); U.toast("Team saved."); setTimeout(render, 0);
        });
      const abbrNow = () => ($("#et-abbr", Dl).value || t.abbr).toUpperCase();
      const redraw = () => {
        $$("[data-et-color]", Dl).forEach((b) => { const on = +b.dataset.etColor === st.color; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
        $$("[data-et-shape]", Dl).forEach((b) => { const on = b.dataset.etShape === st.shape && !st.img; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); b.innerHTML = teamAv({ name: "x", color: st.color, shape: b.dataset.etShape, glyph: "star" }, "md"); });
        $$("[data-et-glyph]", Dl).forEach((b) => { const k = b.dataset.etGlyph, on = k === st.glyph && !st.img; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); b.innerHTML = teamAv({ name: "x", abbr: abbrNow(), color: st.color, shape: st.shape, glyph: k === "abbr" ? false : k }, "md"); });
        const v = { name: $("#et-name", Dl).value || t.name, abbr: abbrNow(), color: st.color, shape: st.shape, glyph: st.glyph === "abbr" ? false : st.glyph, img: st.img };
        $("#et-prev", Dl).innerHTML = `${teamAv(v, "xl")}<div style="min-width:0"><b class="disp ell" style="font-size:24px;display:block">${esc(v.name)}</b><div class="row ps" style="margin-top:4px">${teamAv(v, "sm")} ${esc(v.abbr)}</div></div>`;
      };
      Dl.addEventListener("click", (e) => {
        const c = e.target.closest("[data-et-color]"), sh = e.target.closest("[data-et-shape]"), g = e.target.closest("[data-et-glyph]");
        if (c) { st.color = +c.dataset.etColor; redraw(); } else if (sh) { st.shape = sh.dataset.etShape; st.img = null; redraw(); } else if (g) { st.glyph = g.dataset.etGlyph; st.img = null; redraw(); }
        else if (e.target.closest("[data-et-noimg]")) { st.img = null; redraw(); }
      });
      Dl.addEventListener("input", (e) => { if (e.target.id === "et-name" || e.target.id === "et-abbr") redraw(); });
      $("#et-img", Dl).addEventListener("change", (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        const img = new Image(), url = URL.createObjectURL(f);
        img.onload = () => { const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d"); const sz = Math.min(img.width, img.height); x.drawImage(img, (img.width - sz) / 2, (img.height - sz) / 2, sz, sz, 0, 0, 128, 128); st.img = c.toDataURL("image/png"); URL.revokeObjectURL(url); redraw(); };
        img.onerror = () => U.toast("That file isn't an image", true);
        img.src = url;
      });
      redraw();
    }
    // Things waiting on you, at the top of every page: trade offers, votes, waiver claims, a healthy player on IR.
    function alertsBar(r) {
      const mid = me();
      if (mid == null) return "";
      const items = [];
      // a vampire league: the vampire's open bite, its empty roster before week 1, and a bite that just hit you
      const vamp = G.vampireOf(L());
      if (vamp === mid) {
        const b = G.openBite(L());
        if (b) items.push(`<button type="button" class="alert loss" data-bite="${b.id}"><span>${b.why === "lowest" ? `<b>${esc(T(b.victim).name)}</b> was the week's lowest scorer.` : `You beat <b>${esc(T(b.victim).name)}</b>.`} Take one of their players and give one back, by ${esc(new Date(b.due).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }))} or it's made for you.</span><b class="go">Bite</b></button>`);
        if (L().week === 1 && L().rosters[mid].length < G.maxRoster(L())) items.push(`<a class="alert" href="#players"><span>You're the vampire: you skipped the draft. Build your roster from free agents, ${G.maxRoster(L()) - L().rosters[mid].length} spots to fill.</span><b class="go">Free agents</b></a>`);
      } else if (vamp != null) {
        const hit = (L().bites || []).filter((b) => b.status === "done" && b.victim === mid && now() - b.done < 72 * 36e5).pop();
        if (hit) items.push(`<a class="alert loss" href="#players/tx"><span>The vampire bit you: <b>${esc((ctx.byId[hit.take] || {}).n || "")}</b> is gone${hit.give ? `, and <b>${esc((ctx.byId[hit.give] || {}).n || "")}</b> joined your roster` : ""}.</span><b class="go">See it</b></a>`);
      }
      // Robin Hood and Conquest: a raid you get to make, and one made on you
      const when = (t) => esc(new Date(t).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }));
      for (const b of G.openRaids(L(), mid)) items.push(`<button type="button" class="alert loss" data-bite="${b.id}"><span>${b.why === "robin" ? `<b>Robin Hood.</b> You had the low score: take one of <b>${esc(T(b.victim).name)}</b>'s players` : `<b>The spoils.</b> You beat <b>${esc(T(b.victim).name)}</b>: take one of their players`} and give one back, by ${when(b.due)} or it's made for you.</span><b class="go">${b.why === "robin" ? "Rob them" : "Take one"}</b></button>`);
      const raided = (L().bites || []).filter((b) => b.by != null && b.status === "done" && b.victim === mid && now() - b.done < 72 * 36e5).pop();
      if (raided) items.push(`<a class="alert loss" href="#players/tx"><span>${raided.why === "robin" ? "Robin Hood struck" : `${esc(T(raided.by).name)} took the spoils`}: <b>${esc((ctx.byId[raided.take] || {}).n || "")}</b> is gone${raided.give ? `, and <b>${esc((ctx.byId[raided.give] || {}).n || "")}</b> joined your roster` : ""}.</span><b class="go">See it</b></a>`);
      if (L().pyo && !L().pyo.done && G.pyoTurn(L()) === mid) items.push(`<button type="button" class="alert info" data-pyo><span><b>Your pick.</b> Choose your week ${L().pyo.week} opponent by ${when(Math.min(L().pyo.at + G.PYO_HOURS * 36e5, L().pyo.due))}, or the weakest team left is picked for you.</span><b class="go">Pick</b></button>`);
      const hg = G.hungover(L(), mid);
      if (hg && r.tab === "players") items.push(`<div class="alert"><span><b>The Hangover.</b> You won last week, so no adds or claims until week ${L().week + 1}. Trades and lineups are fine.</span></div>`);
      // a dynasty's new season: rosters run long after the rookie draft until everyone cuts down
      const cut = L().week === 1 ? G.overLimit(L(), mid) : 0;
      if (cut) items.push(`<a class="alert loss" href="#team/roster"><span>Cut ${cut} player${cut === 1 ? "" : "s"} before week 1 starts ${esc(new Date(L().start).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }))}. If you don't, your lowest-valued bench players are dropped.</span><b class="go">Your roster</b></a>`);
      if (!(r.tab === "team" && r.sub === "trades")) {
        // the whole league sees trades: one waiting on your vote, and ones that just went through
        const fresh = L().trades.filter((t) => t.status === "accepted" && t.from !== mid && t.to !== mid && now() - (t.done || t.at) < 48 * 36e5);
        for (const t of fresh.slice(-2)) items.push(`<a class="alert info" href="#players/tx"><span><b>${esc(T(t.from).name)}</b> and <b>${esc(T(t.to).name)}</b> made a trade: ${esc(t.get.map((x) => (ctx.byId[x] || {}).n).filter(Boolean).concat((t.pickGet || []).length ? ["picks"] : []).join(", "))} for ${esc(t.give.map((x) => (ctx.byId[x] || {}).n).filter(Boolean).concat((t.pickGive || []).length ? ["picks"] : []).join(", "))}.</span><b class="go">Transactions</b></a>`);
        const offers = L().trades.filter((t) => t.status === "pending" && t.to === mid);
        for (const t of offers.slice(0, 2)) items.push(`<a class="alert" href="#team/trades">${teamAv(T(t.from), "sm")}<span><b>${esc(T(t.from).name)}</b> sent you a trade offer</span><b class="go">Review</b></a>`);
        if (offers.length > 2) items.push(`<a class="alert" href="#team/trades"><span>${offers.length - 2} more trade offers</span><b class="go">Review</b></a>`);
        const votes = L().trades.filter((t) => t.status === "review" && G.voters(L(), t).includes(mid) && !(t.votes || {})[mid]).length;
        if (votes) items.push(`<a class="alert" href="#team/trades"><span>${votes === 1 ? "A trade needs" : `${votes} trades need`} your vote. It goes through unless the league vetoes it.</span><b class="go">Vote</b></a>`);
      }
      const claims = L().claims.filter((c) => c.team === mid && c.status === "open").length;
      if (claims && !(r.tab === "players" && r.sub === "claims") && !(r.tab === "team" && r.sub === "roster") && !(r.tab === "league" && r.sub === "overview")) items.push(`<a class="alert info" href="#players/claims"><span>${claims} waiver claim${claims === 1 ? "" : "s"} pending. ${esc(claimsRun())}</span><b class="go">See claims</b></a>`);
      if (!bb() && !over() && G.isAlive(L(), mid) && !(r.tab === "team" && r.sub === "roster")) {
        const lu = G.lineupFor(L(), ctx, mid, curWeek()), ir = G.held(L(), mid);
        const bench = L().rosters[mid].filter((x) => !lu.includes(x) && !ir.includes(x)).map((x) => ctx.byId[x]).filter(Boolean);
        const open = L().settings.lineup.filter((sl, i) => !lu[i] && bench.some((p) => S.fits(sport, p, sl)));
        const named = Object.entries(open.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {})).map(([k, n]) => (n > 1 ? `${n} ${k}` : k));
        if (open.length) items.push(`<a class="alert" href="#team/roster"><span>Your ${esc(named.join(", "))} ${open.length === 1 ? "spot is" : "spots are"} empty this week</span><b class="go">Fix lineup</b></a>`);
      }
      // in the offseason nobody's lineup counts, so a healthy player on IR is nothing to fix
      if (!over()) for (const id of G.irBlocked(L(), ctx, mid)) items.push(`<a class="alert" href="#team/roster"><span><b>${esc(ctx.byId[id].n)}</b> is healthy and still on IR</span><b class="go">Activate</b></a>`);
      return items.length ? `<div class="wrap alerts" role="status">${items.join("")}</div>` : "";
    }

    /* ---------- rotisserie ---------- */
    const fmtPts = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
    const catFmt = (c, v) => (v == null ? "-" : c.fmt ? c.fmt(v) : Number.isInteger(v) ? String(v) : v.toFixed(1));
    // the season so far, with this week's stats added in while it's being played
    const rotoRows = () => G.standings(L(), null, over() ? null : G.rotoLive(L(), ctx, frac(L().week)));
    function rotoTable(rows, full) {
      const cats = sc().cats;
      const cols = [
        { k: "rank", label: "#", cls: "c num", html: (r) => r.rank },
        { k: "team", label: "Team", td: "nm", html: (r) => `<a href="${teamHref(r.team)}" style="color:inherit;text-decoration:none">${teamName(T(r.team), { you: isMe(r.team) })}</a>` },
      ].concat(full ? cats.map((c) => ({ k: c.k, label: c.label, cls: "r num", hide: "s", html: (r) => `${catFmt(c, r.vals[c.k])}<small class="rp">${fmtPts(r.catPts[c.k] || 0)}</small>` })) : [],
        [{ k: "pts", label: "Points", cls: "r num", html: (r) => `<b>${fmtPts(r.pts)}</b>` }, { k: "gb", label: "Back", cls: "r num", html: (r) => (r.rank === 1 ? "-" : fmtPts(r.gb)) }]);
      return U.table({ cols, rows, cls: "stand roto", rowAttr: (r) => `class="${isMe(r.team) ? "me" : ""}"` });
    }
    function rotoOverview() {
      const rows = rotoRows(), mid = me(), mine = mid != null ? rows.find((r) => r.team === mid) : null, n = rows.length;
      const champ = over() ? championOf() : null;
      const cats = sc().cats;
      const recent = L().tx.slice().reverse().filter((x) => x.type !== "draft").slice(0, 7);
      const myCard = mine ? `<div class="card"><div class="mod-h">${teamAv(T(mid), "md")}<div style="min-width:0"><b class="ell" style="display:block">${esc(T(mid).name)}</b><span class="ps">${ord(mine.rank)} of ${n}, ${fmtPts(mine.pts)} points</span></div></div>
        <div class="bd"><div class="catrank">${cats.map((c) => `<div><small>${esc(c.label)}</small><b>${catFmt(c, mine.vals[c.k])}</b><span class="ps">${ord(n + 1 - Math.round(mine.catPts[c.k] || 0))}</span></div>`).join("")}</div>
        ${over() ? "" : `<div class="row" style="margin-top:12px;flex-wrap:wrap"><a class="btn sm" href="#team/roster">Set lineup</a>${canTrade() ? `<button class="btn sm" data-trade>Propose a trade</button>` : ""}<a class="btn sm" href="#players/fa">Free agents</a></div>`}</div></div>` : "";
      return `<div class="wrap page">
        ${champ != null ? `<div class="banner"><span>${teamAv(T(champ), "lg")}</span><div><b class="disp" style="font-size:26px">${esc(T(champ).name)} won the title</b><div class="ps">First in the final standings, with ${fmtPts(rows[0].pts)} points.</div></div></div>` : ""}
        <div class="cols"><div class="stack">
          ${myCard ? `<div class="m-only stack">${myCard}</div>` : ""}
          <div class="card"><div class="mod-h"><h2>Standings</h2><span class="ps">${over() ? "Final" : L().week > 1 ? `Weeks 1 to ${L().week}, this week so far included` : "Week 1 so far"}</span><a href="#league/standings">By category</a></div>${rotoTable(rows, false)}</div>
          <div class="card"><div class="mod-h"><h2>How it works</h2></div><div class="bd"><p class="small" style="margin:0">Rotisserie: no weekly games. In each category, the best season total gets ${n} points and the worst gets 1; ties split the points. Most points wins.</p></div></div>
        </div><aside class="stack">
          ${myCard ? `<div class="d-only stack">${myCard}</div>` : ""}
          <div class="card"><div class="mod-h"><h2>Recent activity</h2><a href="#players/tx">All transactions</a></div>${U.feed(recent.map(txVM), "No moves yet.")}</div>
        </aside></div></div>`;
    }
    function rotoStandingsPage() {
      const rows = rotoRows();
      return `<div class="wrap page"><div class="head"><h1 class="disp">Standings</h1><span class="ps">Season totals in each category, and the roto points each earns (small). ${over() ? "Final." : "This week so far is included."}</span></div>
        <div class="card">${rotoTable(rows, true)}</div></div>`;
    }
    // One week's category totals for every team: this week live, or a past week.
    function rotoWeekPage(arg) {
      const cur = Math.min(L().week, G.totalWeeks(L()));
      const w = Math.max(1, Math.min(+arg || cur, cur)), cats = sc().cats;
      const done = L().results[w] && L().results[w].roto;
      const data = done ? L().results[w].roto : (G.rotoLive(L(), ctx, frac(w)) || { rows: {} }).rows;
      const rows = L().teams.map((t) => ({ team: t.id, vals: (data[t.id] || { cats: {} }).cats }));
      const best = Object.fromEntries(cats.map((c) => [c.k, rows.map((r) => r.vals[c.k] || 0).reduce((a, b) => (c.low ? Math.min(a, b) : Math.max(a, b)), c.low ? Infinity : -Infinity)]));
      const cols = [{ k: "team", label: "Team", td: "nm", html: (r) => `<a href="${teamHref(r.team)}" style="color:inherit;text-decoration:none">${teamName(T(r.team), { you: isMe(r.team) })}</a>` }]
        .concat(cats.map((c) => ({ k: c.k, label: c.label, cls: "r num", html: (r) => { const v = r.vals[c.k]; return `<span class="${v === best[c.k] && v ? "win" : ""}">${catFmt(c, v)}</span>`; } })));
      const weeks = Array.from({ length: cur }, (_, i) => i + 1);
      return `<div class="wrap page"><div class="head"><h1 class="disp">Week ${w} categories</h1><span class="ps">${done ? "Final for the week." : `${Math.round(frac(w) * 100)}% of the week played.`} The week's best in each category is green. Weeks add up to the season standings.</span></div>
        <div class="chips" role="group" aria-label="Week">${weeks.map((x) => `<button type="button" data-mweek="${x}" aria-pressed="${x === w}">Week ${x}</button>`).join("")}</div>
        <div class="card">${U.table({ cols, rows, rowAttr: (r) => `class="${isMe(r.team) ? "me" : ""}"` })}</div></div>`;
    }
    function schedulePage(arg) {
      const id = arg !== "" && arg != null && L().teams[+arg] ? +arg : me() != null ? me() : 0;
      if (arg !== "" && arg != null && !L().teams[+arg]) badLink(`There's no team ${arg} in this league, so here's ${isMe(id) ? "yours" : T(id).name}.`);
      if (gl()) return historyPage(id);
      const rows = [];
      for (let w = 1; w <= G.totalWeeks(L()); w++) {
        const games = w <= L().settings.weeks ? L().schedule[w - 1] : w <= L().week ? G.playoffGames(L(), ctx, w) : [];
        const i = games.findIndex((g) => g[0] === id || g[1] === id);
        if (i < 0) {
          if (w > L().settings.weeks) {
            const rd = G.roundOf(L(), w), row = rd && w <= L().week && G.postseason(L()).find((x) => x.round === rd.round);
            const bye = row && row.main.some((g) => g.bye === id);
            rows.push(`<tr><td>Week ${w}</td><td colspan="3" class="ps">${bye ? `A bye through the ${esc(rd.name.toLowerCase())}` : w <= L().week ? "Out of the playoffs" : "Playoffs"}</td></tr>`);
          }
          continue;
        }
        const [a, b] = games[i], opp = a === id ? b : a;
        const res = L().results[w] && L().results[w][i];
        const mineA = a === id;
        const r = res ? (res.w === "t" ? "T" : (res.w === "a") === mineA ? "W" : "L") : "";
        rows.push(`<tr${w === L().week ? ` class="me"` : ""}><td><a href="${matchHref(w, i)}">Week ${w}</a>${w > L().settings.weeks ? ` <span class="tag info">${esc(kindName(games[i].kind, w))}</span>` : ""}</td><td>${teamName(T(opp), { owner: false })}</td><td class="r num">${res ? `<span class="${r === "W" ? "win" : r === "L" ? "loss" : ""}" style="font-weight:850">${r}</span> ${fmtS(mineA ? res.sa : res.sb)}-${fmtS(mineA ? res.sb : res.sa)}` : w === L().week ? `<span class="pill live">Live</span>` : ""}</td><td class="ps hide-s">${recOf(opp)}</td></tr>`);
      }
      return `<div class="wrap page">${teamHead(id)}<div class="table-wrap"><table class="t"><thead><tr><th>Week</th><th>Opponent</th><th class="r">Result</th><th class="hide-s">Their record</th></tr></thead><tbody>${rows.join("")}</tbody></table></div></div>`;
    }
    function tradeVM(t) {
      const mid = me();
      const label = { pending: "Pending", review: "Under review", accepted: "Accepted", rejected: "Rejected", cancelled: "Cancelled", vetoed: "Vetoed", countered: "Countered", failed: "Failed", expired: "Expired" }[t.status];
      const ends = t.status === "pending" ? `Expires ${new Date(G.offerEnds(L(), t)).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric" })}` : "";
      let acts = "";
      if (t.status === "pending" && t.to === mid) acts = `<button class="btn sm win" data-tr-accept="${t.id}">Accept</button><button class="btn sm" data-tr-counter="${t.id}">Counter</button><button class="btn sm warn" data-tr-reject="${t.id}">Reject</button><span class="grow"></span><span class="ps">${esc(ends)}</span>`;
      else if (t.status === "pending" && t.from === mid) acts = `<span class="ps">Waiting on ${esc(T(t.to).name)}. ${esc(ends)}</span><span class="grow"></span><button class="btn sm" data-tr-cancel="${t.id}">Cancel offer</button>`;
      else if (t.status === "review") {
        const v = (t.votes || {})[mid], vetoes = Object.values(t.votes || {}).filter((x) => x === "veto").length;
        const cm = !!opts.commishTools, byCm = L().settings.tradeReview === "commish";
        const when = U.ago(t.reviewEnds, now()).includes("ago") ? "soon" : new Date(t.reviewEnds).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        const cmBtn = cm ? `<button class="btn sm warn" data-tr-cmveto="${t.id}">${byCm ? "Veto" : "Veto as commissioner"}</button>` : "";
        acts = byCm ? `<span class="ps">Goes through ${when} unless the commissioner vetoes it</span><span class="grow"></span>${cmBtn}`
          : `<span class="ps">Goes through ${when} unless ${G.vetoesNeeded(L(), t)} teams veto (${vetoes} so far)</span><span class="grow"></span>${G.voters(L(), t).includes(mid) ? (v ? `<span class="tag">${v === "veto" ? "You voted to veto" : "You approved"}</span>` : `<button class="btn sm" data-tr-ok="${t.id}">Approve</button><button class="btn sm warn" data-tr-veto="${t.id}">Veto</button>`) : ""}${cmBtn}`;
      } else if (t.why) acts = `<span class="ps">${esc(T(t.to).name)}: &ldquo;${esc(t.why)}&rdquo;</span>`;
      return { id: t.id, status: t.status, statusLabel: label, from: T(t.from), to: T(t.to), give: t.give.map(playerVM).concat((t.pickGive || []).map(pickVM)), get: t.get.map(playerVM).concat((t.pickGet || []).map(pickVM)), faab: [t.faabGive, t.faabGet], note: t.note, when: U.ago(t.done || t.at, now()), acts, sub: t.counterOf ? "Counteroffer" : "" };
    }
    function tradesPage() {
      const mid = me();
      const all = L().trades.slice().reverse();
      const toMe = all.filter((t) => t.status === "pending" && t.to === mid), fromMe = all.filter((t) => t.status === "pending" && t.from === mid);
      const review = all.filter((t) => t.status === "review"), done = all.filter((t) => !["pending", "review"].includes(t.status) && (t.from === mid || t.to === mid || t.status === "accepted")).slice(0, 20);
      const sec = (title, list, empty) => `<div class="stack"><h2 style="margin:0;font-size:16px">${title}</h2>${list.length ? list.map((t) => U.tradeCard(sport, tradeVM(t))).join("") : `<div class="card"><p class="empty" style="margin:0">${empty}</p></div>`}</div>`;
      return `<div class="wrap page">${mid != null ? teamHead(mid) : ""}<div class="head"><${mid != null ? 'h2 class="disp" style="font-size:24px;margin:0"' : 'h1 class="disp"'}>Trades</${mid != null ? "h2" : "h1"}><span class="grow"></span>${canTrade() ? `<button class="btn go" data-trade>Propose a trade</button>` : mid != null && L().settings.deadline && L().week > L().settings.deadline && !over() ? `<span class="ps">The trade deadline was week ${L().settings.deadline}.</span>` : ""}</div>${G.offseason(L()) && L().settings.trades !== false ? `<div class="banner info"><b>Offseason trading is open.</b> <span class="muted">Trade players and picks for the next two seasons until next season starts. Roster limits wait until next season's week 1.</span></div>` : ""}
        <div class="cols"><div class="stack">${sec("Offers for you", toMe, "No offers waiting.")}${sec("Your offers", fromMe, "You haven't sent any open offers.")}${sec("League review", review, "No trades under review.")}</div>
        <aside class="stack">${picksCard()}${blockCard(99, true)}${sec("Recent trades", done, "No trades yet.")}</aside></div></div>`;
    }
    // A dynasty's tradeable picks: the ones you hold for next season's rookie and free agent draft.
    function picksCard() {
      if (!G.pickRounds(L()) || me() == null) return "";
      const ks = G.picksOf(L(), me());
      return `<div class="card"><div class="mod-h"><h2>Your draft picks</h2><span class="ps">Next two seasons</span></div>${ks.length ? `<ul class="feed">${ks.map((k) => { const p = pickVM(k); return `<li style="grid-template-columns:minmax(0,1fr) auto;align-items:center;padding:8px 16px">${pname(sport, p)}<span class="ps num">${money(p.$)}</span></li>`; }).join("")}</ul>` : `<div class="bd"><p class="ps" style="margin:0">You've traded away all your picks.</p></div>`}<div class="bd ps" style="border-top:1px solid var(--line)">Next season's values follow the standings: a worse record means an earlier pick${(opts.hooks || {}).prospects && opts.hooks.prospects.length ? `, and each projects to the prospect this league would take there: next year's class from the <a href="../draft/">Big Board</a>, priced against this league's players at his position, so your lineup and scoring move quarterbacks and tight ends up or down` : ""}. Picks two seasons out are priced at the middle of their round.</div></div>`;
    }
    // The trading block: who each team would move, and what it wants. limit caps the teams shown; full adds your
    // own block with a note you can edit.
    function blockCard(limit, full) {
      if (L().settings.trades === false || (over() && !G.offseason(L()))) return "";
      const mid = me();
      const rows = L().teams.filter((t) => t.id !== mid && G.isAlive(L(), t.id)).map((t) => ({ t, ids: G.blockOf(L(), ctx, t.id), note: G.blockNote(L(), ctx, t.id) })).filter((x) => x.ids.length);
      const mine = mid != null ? G.blockOf(L(), ctx, mid) : [];
      if (!rows.length && !full) return "";
      const offer = (t, id) => (canTrade() && mid != null ? `<button class="btn xs" data-trade="${t.id}" data-want="${esc(id)}" aria-label="Offer for ${esc(ctx.byId[id].n)}">Offer</button>` : "");
      const li = (x) => `<li>${teamAv(x.t, "md")}<div class="what"><div class="row" style="gap:8px"><b class="ell">${esc(x.t.name)}</b>${x.note ? `<span class="ps ell">${esc(x.note)}</span>` : ""}</div>
        ${x.ids.map((id) => `<div class="row bkp"><span data-player="${esc(id)}" style="cursor:pointer;min-width:0;flex:1">${pname(sport, ctx.byId[id], `${esc(ctx.byId[id].prank)}`, { size: "sm" })}</span>${x.t.id === mid ? `<button class="btn xs ghost" data-unblock="${esc(id)}">Take off</button>` : offer(x.t, id)}</div>`).join("")}</div></li>`;
      const yours = full && mid != null ? `<div class="bd" style="border-top:1px solid var(--line)"><form class="stack" id="fk-blocknote" style="gap:8px"><label class="lbl" for="fk-bn">What you're looking for</label><div class="row"><input type="text" id="fk-bn" maxlength="80" placeholder="What you need, like an RB" value="${esc((L().blockNote || {})[mid] || "")}" style="flex:1;min-width:0"><button class="btn sm">Save</button></div></form>
        ${mine.length ? "" : `<p class="ps" style="margin:8px 0 0">Open one of your players and choose Put on the block, so the league knows he's available.</p>`}</div>${mine.length ? `<ul class="feed">${li({ t: T(mid), ids: mine, note: "" })}</ul>` : ""}` : "";
      return `<div class="card"><div class="mod-h"><h2>Trading block</h2>${full ? "" : `<a href="#team/trades">All teams</a>`}</div>${rows.length ? `<ul class="feed">${rows.slice(0, limit).map(li).join("")}</ul>` : `<div class="bd"><p class="ps" style="margin:0">Nobody has put players on the block yet.</p></div>`}${yours}</div>`;
    }
    function openTrade(other, want, prefill) {
      const mid = me();
      if (mid == null) return;
      if (!canTrade()) { U.toast(over() ? "The season is over" : `The trade deadline was week ${L().settings.deadline}`, true); return; }
      const teams = L().teams;
      const roster = (id) => L().rosters[id].map((x) => ctx.byId[x]).filter(Boolean).sort((a, b) => b.$ - a.$ || a.rank - b.rank);
      const t0 = other != null ? other : teams.find((t) => t.id !== mid).id;
      U.tradeWindow({ sport, teams, me: mid, other: t0, roster, title: prefill && prefill.counterOf ? "Counteroffer" : "Propose a trade",
        value: (ps, faab) => G.sideValue(ctx, ps.map((p) => p.id), faab), faab: (id) => T(id).faab,
        roomFor: (tr) => G.offseason(L()) ? 0 : Math.max(0, L().rosters[mid].length - tr.give.length + tr.get.length - G.maxRoster(L()) - G.held(L(), mid).filter((x) => !tr.give.includes(x)).length),
        check: (tr) => G.tradeCheck(L(), ctx, Object.assign({ dropsTo: [] }, tr)),
        prefill: prefill || (want ? { get: [want] } : null),
        picks: G.pickRounds(L()) ? (id) => G.picksOf(L(), id).map(pickVM) : null,
        submit: (tr) => { const r = G.propose(L(), ctx, mid, tr.to, tr.give, tr.get, now(), tr); if (!r.ok) return r; save(); U.toast(`Offer sent to ${T(tr.to).name}.`); setTimeout(() => { G.tick(L(), ctx, now() + 1); save(); render(); }, 1200); render(); return r; } });
    }

    /* ---------- Matchup ---------- */
    function matchupPage(sub, arg) {
      if (allplay1()) return weekBoardPage();
      if (gl()) return blockPage(sub);
      if (roto()) return rotoWeekPage(sub);
      let w = +sub || curWeek(), i = arg !== "" && arg != null ? +arg : null;
      const asked = w;
      w = Math.max(1, Math.min(w, curWeek()));
      const games = G.matchups(L(), ctx, w, frac(w));
      if (sub && asked !== w) badLink(`Week ${asked} ${asked > curWeek() ? "hasn't happened yet" : "doesn't exist"}. Showing week ${w}.`);
      else if (i != null && !games[i]) badLink(`Week ${w} has no game ${i + 1}. Showing your matchup.`);
      let m = i != null && games[i] ? games[i] : games.find((g) => isMe(g.a) || isMe(g.b)) || games[0];
      if (m && isMe(m.b)) m = flip(m);
      if (!m) return `<div class="wrap page"><p class="empty">No games this week.</p></div>`;
      // best ball shows the lineup that actually counted
      const la = (bb() && m.ta && m.ta.lineup) || G.lineupFor(L(), ctx, m.a, w), lb = (bb() && m.tb && m.tb.lineup) || G.lineupFor(L(), ctx, m.b, w);
      const ptsA = (m.ta && m.ta.players) || {}, ptsB = (m.tb && m.tb.players) || {};
      const wk = G.WEEK[sport.key] || { weeks: 20 };
      const rows = L().settings.lineup.map((slot, k) => {
        const pa = la[k] && ctx.byId[la[k]], pb = lb[k] && ctx.byId[lb[k]];
        const xa = pa ? (pts() ? ptsA[pa.id] : weekLine(pa, w)) : null, xb = pb ? (pts() ? ptsB[pb.id] : weekLine(pb, w)) : null;
        const cmp = pts() && xa != null && xb != null;
        return { slot, a: { p: pa, pts: xa, proj: pts() && pa && !m.final ? (xa || 0) + (projFor(pa, xa, w) - (xa || 0)) * G.slotMult(L(), k, pa.id) : null, w: cmp && xa > xb, game: pa ? gameChip(pa, w) : "" }, b: { p: pb, pts: xb, proj: pts() && pb && !m.final ? (xb || 0) + (projFor(pb, xb, w) - (xb || 0)) * G.slotMult(L(), k, pb.id) : null, w: cmp && xb > xa, game: pb ? gameChip(pb, w) : "" } };
      });
      // playing, yet to play and done, for each lineup
      const tallyOf = (ids) => { const c = { in: 0, pre: 0, post: 0 }; for (const id of ids) { const p = id && ctx.byId[id], gs = p && gamesOf(p, w); if (!gs) return null; const g = gameNow(gs); if (!g) c.post++; else if (g.state === "in") c.in++; else if (gs.some((x) => x.state === "pre")) c.pre++; else c.post++; } return c; };
      const ta = !m.final && tallyOf(la), tb = !m.final && tallyOf(lb);
      const pips = (c, name) => `<div class="left-t"><b>${esc(name)}</b><span class="lp in" title="Playing now">${c.in} playing</span><span class="lp pre" title="Yet to play">${c.pre} to play</span><span class="lp post" title="Done">${c.post} done</span></div>`;
      const leftHtml = ta && tb ? `<div class="left-l">${pips(ta, T(m.a).name)}${pips(tb, T(m.b).name)}</div>` : "";
      // scoring plays from the live feed, for both lineups, newest first
      const lvw = liveWeek(w), mine = new Set(la.concat(lb).filter(Boolean));
      const plays = lvw && lvw.feed ? lvw.feed.filter((x) => mine.has(x.id)).slice(-40).reverse().map((x) => {
        const p = ctx.byId[x.id]; if (!p) return null;
        const R = (opts.hooks || {}).real, d = pts() && R ? G.realPts(R.cols ? { line: R.line, cols: R.cols } : { lines: R.lines }, sc(), x.d, p) : null;
        const txt = playText(x.d); if (!txt && !d) return null;
        const side = la.includes(x.id) ? "a" : "b";
        return `<li class="${side}">${U.playerAv ? U.playerAv(sport, p, "sm") : ""}<span class="grow"><b>${esc(p.n)}</b><small>${esc(txt)}</small></span>${d != null ? `<b class="pl-d ${d >= 0 ? "up" : "dn"}">${d >= 0 ? "+" : ""}${fmtS(d)}</b>` : ""}<span class="ps">${esc(U.ago(new Date(x.at).getTime(), now()))}</span></li>`;
      }).filter(Boolean).slice(0, 12) : [];
      const playsHtml = plays.length ? `<div class="card plays"><div class="mod-h"><h2>Scoring plays</h2><span class="ps">Updates every minute</span></div><ul class="pl-l">${plays.join("")}</ul></div>` : "";
      const weeks = Array.from({ length: curWeek() }, (_, k) => k + 1);
      return `<div class="wrap page">
        <div class="head"><h1 class="disp">${w > L().settings.weeks ? esc(kindName(m.kind, w)) : L().settings.showdown ? `${esc(L().settings.showdown.label)} showdown` : `Week ${w} matchup`}</h1>${!pts() ? `<span class="ps">Each starter's line for the week so far.</span>` : ""}</div>
        <div class="row" style="flex-wrap:wrap"><div class="chips" role="group" aria-label="Week">${weeks.map((x) => `<button type="button" data-mweek="${x}" aria-pressed="${x === w}">${weekChip(x)}</button>`).join("")}</div></div>
        ${over() && oneWeekLg() ? finishCard() : ""}<div class="card">${U.versus(versusVM(w, m))}${leftHtml || outlookLine(m)}${medianLine(w, m)}</div>${w === 1 && L().heist ? heistCard(m.a) : ""}${playsHtml}${gamedayStatus(w)}
        <div class="cols2" style="grid-template-columns:minmax(0,1fr)">${U.vsTable(sport, rows, pts() ? { a: m.sa, b: m.sb } : null, (x) => (x == null ? "-" : typeof x === "string" ? (/^(No games|Didn't play|Yet to play|Playing now|Done this week|No games this week|\d+ games? left)$/.test(x) ? `<span class="ps">${x}</span>` : x) : x.toFixed(1)))}</div>
        <div class="stack" style="gap:8px"><b class="ps">Other games, week ${w}</b>${U.scoreboard(gamesVM(w), fmtS)}</div></div>`;
    }

    function teamGameBoxes(w, teams) {
      if (!liveWeek(w)) return "";
      return `<div class="stack">${teams.map(id => {
        const ids = G.lineupFor(L(), ctx, id, w).filter(Boolean);
        return `<details class="card team-game-box"${isMe(id) ? " open" : ""}><summary>${esc(T(id).name)} · player box scores</summary><div class="team-game-list">${ids.map(pid => { const p = ctx.byId[pid]; return p ? `<div>${pname(sport,p)}<div class="gmr">${gameChip(p,w)}</div></div>` : ""; }).join("")}</div></details>`;
      }).join("")}</div>`;
    }
    function gamedayStatus(w) {
      if (!L().settings.real) return "";
      const lv = liveWeek(w), age = lv ? now() - Date.parse(lv.updated) : Infinity;
      const delayed = !lv || lv.stale || (lv.errors || []).length || age > 180000;
      return `<div class="gameday-status" role="status"><b>Game box scores</b><span>${!lv ? "Waiting for the game feed" : `${delayed ? "Feed delayed · " : ""}Updated ${esc(new Date(lv.updated).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"}))}`}. Refreshes about once a minute. Fantasy totals use your league’s scoring.</span></div>`;
    }

    /* ---------- Players ---------- */
    function statusOf(p) {
      const own = ctx.own[p.id];
      if (own != null) return `<a href="${teamHref(own)}" class="row" style="gap:6px;text-decoration:none;color:inherit">${teamAv(T(own), "sm")}<span class="ps">${esc(T(own).abbr)}</span></a>`;
      if (G.onWaivers(L(), p.id, now())) return `<span class="tag gold" title="On waivers until ${G.waiverWhen(G.clearAt(L(), p.id))}">W</span>`;
      if (G.isLocked(L(), p, L().week, now())) return `<span class="tag gold" title="Game started; claims wait until next week">Locked</span>`;
      return `<span class="tag win">FA</span>`;
    }
    function playersPage(sub) {
      const mid = me(), w = watch();
      if (sub === "claims") return claimsPage();
      if (sub === "tx") return txPage();
      let rows = opts.players.filter((p) => U.passes(sport, p, ui.pf));
      if (sub === "fa") rows = rows.filter((p) => ctx.own[p.id] == null);
      if (sub === "watch") rows = rows.filter((p) => w.includes(p.id));
      const actions = (p) => {
        const own = ctx.own[p.id];
        const star = mid != null ? `<button class="star${w.includes(p.id) ? " on" : ""}" data-watch="${esc(p.id)}" aria-label="Watch ${esc(p.n)}" aria-pressed="${w.includes(p.id)}">${w.includes(p.id) ? "&#9733;" : "&#9734;"}</button>` : "";
        if (mid == null || !canMove()) return star;
        const myClaim = own == null ? L().claims.find((c) => c.team === mid && c.add === p.id && c.status === "open") : null;
        if (myClaim) return `${star}<a class="tag gold" href="#players/claims" title="Your pending claim">Bid $${myClaim.bid}</a>`;
        if (own == null) return `${star}<button class="btn icon add" data-add="${esc(p.id)}" aria-label="${G.onWaivers(L(), p.id, now()) ? "Claim" : "Add"} ${esc(p.n)}" title="${G.onWaivers(L(), p.id, now()) ? "Put in a claim" : "Add"}">+</button>`;
        if (own === mid) return `${star}<button class="btn icon drop" data-drop="${esc(p.id)}" aria-label="Drop ${esc(p.n)}">&minus;</button>`;
        return L().settings.trades === false ? star : `${star}<button class="btn icon trade" data-trade="${own}" data-want="${esc(p.id)}" aria-label="Trade for ${esc(p.n)}">&#8644;</button>`;
      };
      const cols = U.poolColumns(sport, { group: U.groupOf(sport, ui.pf), scoring: L().scoring, owner: statusOf, ownerHide: sub === "fa" || sub === "watch", ownerSort: (p) => (ctx.own[p.id] == null ? -1 : ctx.own[p.id]), actions, extra: pts() ? [] : [] });
      rows = U.sortRows(rows, cols, ui.psort);
      return `<div class="wrap page"><div class="head"><h1 class="disp">${sub === "fa" ? "Free agents" : sub === "watch" ? "Watchlist" : "All players"}</h1><span class="ps">${rows.length} players. FA is free to add now; W is on waivers, so put in a claim.</span></div>
        ${L().openWaivers > now() && sub !== "all" ? `<div class="banner" style="margin-bottom:12px"><b>Everyone the draft left is on waivers until ${esc(G.waiverWhen(L().openWaivers))}.</b> <span class="muted">Put in claims now${L().settings.waivers === "faab" ? " with a bid" : ""}. They all run then${L().settings.waivers === "faab" ? ", highest bid first" : ", in waiver order"}.</span></div>` : ""}
        <div class="tools">${U.search(ui.pf)}</div>${U.posFilter(sport, ui.pf.pos, [], L().settings.lineup)}
        ${U.table({ cols, rows, sort: ui.psort, dense: true, limit: ui.plimit || 250, id: "fk-players", empty: sub === "watch" ? "Star players to watch them here." : "No one matches.", rowAttr: (p) => `data-player="${esc(p.id)}"${ctx.own[p.id] === mid ? ' class="me"' : ""}` })}</div>`;
    }
    function claimsPage() {
      const mid = me();
      const mine = L().claims.filter((c) => c.team === mid).slice().reverse();
      const open = mine.filter((c) => c.status === "open"), past = mine.filter((c) => c.status !== "open").slice(0, 20);
      const shared = Object.entries(open.reduce((m, c) => (c.drop ? ((m[c.drop] = (m[c.drop] || 0) + 1), m) : m), {})).filter(([, k]) => k > 1);
      const sharedNote = shared.length ? `<div class="alert" style="margin:0 16px 10px"><span>${shared.map(([id, k]) => `${k} claims drop <b>${esc((ctx.byId[id] || {}).n || "the same player")}</b>`).join("; ")}. Claims run highest bid first, so once one wins, the others that drop him fail. Pick a different drop for any you'd want too.</span></div>` : "";
      const row = (c) => `<li style="grid-template-columns:minmax(0,1fr) auto auto;align-items:center"><div class="what">${U.txLine(sport, "add", ctx.byId[c.add])}${c.drop ? U.txLine(sport, "drop", ctx.byId[c.drop]) : ""}</div><b class="dollar">$${c.bid}</b>${c.status === "open" ? `<button class="btn sm" data-unclaim="${c.id}">Cancel</button>` : `<span class="status ${c.status === "won" ? "accepted" : "rejected"}">${c.status === "won" ? "Won" : c.status === "lost" ? `Lost to ${esc(T(c.lostTo).abbr)}` : c.status === "cancelled" ? "Cancelled" : "Failed"}${c.week ? `, week ${c.week}` : ""}</span>`}${c.why ? `<span class="ps" style="grid-column:1/-1">${esc(c.why)}</span>` : ""}</li>`;
      return `<div class="wrap page"><div class="head"><h1 class="disp">Waiver claims</h1><span class="ps">${esc(claimsRun())} Highest bid wins; ties go to waiver priority (you're ${ord(T(mid).priority + 1)}). You have $${T(mid).faab}.</span></div>
        <div class="cols2"><div class="card"><div class="mod-h"><h2>Pending</h2></div>${sharedNote}${open.length ? claimList(open) : `<p class="empty">No pending claims. Players on waivers have a gold W in <a href="#players/fa">Free agents</a>; claim one there.</p>`}</div>
        <div class="card"><div class="mod-h"><h2>Results</h2></div>${past.length ? `<ul class="feed">${past.map(row).join("")}</ul>` : `<p class="empty">Nothing yet.</p>`}</div></div></div>`;
    }
    // Add a free agent (or claim one on waivers), choosing who to drop.
    function addDialog(pid, edit) {
      const mid = me(), p = ctx.byId[pid];
      const onW = G.onWaivers(L(), pid, now()) || G.isLocked(L(), p, L().week, now());
      const irs = G.held(L(), mid);
      const full = L().rosters[mid].length - irs.length >= G.maxRoster(L());
      const ros = L().rosters[mid].filter((x) => !irs.includes(x) && !G.isLocked(L(), ctx.byId[x], L().week, now())).map((x) => ctx.byId[x]).sort((a, b) => a.vor - b.vor);
      if (!edit && L().settings.maxAdds && G.pickupsLeft(L(), mid) <= 0) { U.toast(`You've used all ${L().settings.maxAdds} pickups this week`, true); return; }
      const faab = onW && L().settings.waivers === "faab";
      const R = faab ? bidRange(p, mid) : null;
      const others = L().claims.filter((c) => c.team === mid && c.status === "open" && c.add !== pid);
      const othersBid = others.reduce((t, c) => t + c.bid, 0);
      const start = edit ? edit.bid : R ? R.mid : 0;
      const drops = others.reduce((m, c) => (c.drop ? ((m[c.drop] = 1), m) : m), {});
      const wins = faab ? recentWins(p) : [];
      // one chip per amount; when two land on the same dollar, Fair wins, then Strong, then Low
      const quick = R ? [["Min", R.min, 0], ["Low", R.lo, 1], ["Fair", R.mid, 3], ["Strong", R.hi, 2]].filter(([, v, k], i, a) => !a.some(([, v2, k2]) => v2 === v && k2 > k)) : [];
      const bidBox = R ? `<div class="bidbox" style="--pct:${R.have ? Math.round((start / R.have) * 100) : 0}%">
          <div class="bid-top"><label for="bid">${L().settings.waiverPrice === "second" ? "Your top bid" : "Your bid"}</label><span class="bid-amt"><span aria-hidden="true">$</span><input type="number" inputmode="numeric" id="bid" name="bid" min="${R.min}" max="${R.have}" value="${start}" aria-describedby="bid-note"></span></div>
          <input type="range" class="bid-r" min="${R.min}" max="${R.have}" value="${start}" step="1" aria-label="Bid amount" tabindex="-1">
          <div class="bid-sc"><span>$${R.min}</span><span class="bid-fair" style="left:${R.have ? (R.lo / R.have) * 100 : 0}%;width:${R.have ? ((R.hi - R.lo) / R.have) * 100 : 0}%" title="Fair range"></span><span>$${R.have}</span></div>
          <div class="bid-q" role="group" aria-label="Quick bids">${quick.map(([k, v]) => `<button type="button" data-q="${v}" aria-pressed="${v === start}">${k} <b>$${v}</b></button>`).join("")}</div>
          ${L().settings.waiverPrice === "second" ? `<p class="ps" style="margin:0">If you win, you pay the next-highest bid plus $1, never more than this. So bid what he's really worth to you.</p>` : ""}<p class="ps bid-note" id="bid-note"></p>
          ${wins.length ? `<div class="bid-wins"><span class="lbl">Recent winning bids</span>${wins.map((x) => `<span><b>$${x.bid}</b> ${esc(x.p.n)} <span class="ps">${esc(S.positions(x.p)[0])}, to ${esc(T(x.team).abbr)} in week ${x.week}${x.bids > 1 ? ` over ${x.bids - 1} other bid${x.bids > 2 ? "s" : ""}` : ""}</span></span>`).join("")}</div>` : ""}</div>` : "";
      const D = U.dialog(`${!edit && L().settings.maxAdds ? `<p class="ps" style="margin:0 0 6px">${G.pickupsLeft(L(), mid)} of ${L().settings.maxAdds} pickups left this week.</p>` : ""}<div class="pc-h">${U.playerAv(sport, p, "lg")}<div><h3 class="disp">${edit ? "Change your claim for" : onW ? "Claim" : "Add"} ${esc(p.n)}</h3><div class="ps">${p.inj ? `<span class="tag inj">${esc(p.inj)}</span> ` : ""}${posChips(sport, p)} ${U.proTeam(sport, p.t)}, ${esc(p.prank)}${onW ? `. On waivers: ${esc(claimsRun().replace(/^Claims/, "claims"))}` : ""}</div></div></div>
        <form class="stack">${bidBox}${full ? `<div class="field"><span class="lbl">Pick who to drop to make room</span><div class="table-wrap" style="max-height:${R ? 30 : 44}dvh"><table class="t dense droplist"><tbody>${ros.map((q, i) => `<tr><td style="width:28px"><input type="radio" name="drop" value="${esc(q.id)}" id="d${i}"${i === 0 ? " required" : ""}${edit && edit.drop === q.id ? " checked" : ""}></td><td><label for="d${i}" style="cursor:pointer">${pname(sport, q, `${esc(q.prank)}${drops[q.id] ? `, <span class="blk-tag">dropped in another claim</span>` : ""}`)}</label></td><td class="r ps">#${q.rank}</td></tr>`).join("")}</tbody></table></div></div>` : `<p class="ps" style="margin:0">You have an open roster spot.</p>`}
          <div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn go">${edit ? "Save the claim" : onW ? (faab ? `Bid <span class="bid-go">$${start}</span>` : "Put in the claim") : full ? "Add and drop" : "Add"}</button></div></form>`,
        (fd) => {
          const drop = fd.get("drop") || null;
          if (full && !drop) { U.toast("Pick who to drop first", true); return false; }
          const bid = +(fd.get("bid") || 0);
          if (faab && bid > T(mid).faab) { U.toast(`You only have $${T(mid).faab} of FAAB`, true); return false; }
          if (onW) return act(() => G.claim(L(), ctx, mid, pid, drop, bid, now()), edit ? "Claim saved." : L().settings.waiverAt == null ? `${faab ? "Bid in" : "Claim in"}. It runs ${G.waiverWhen(G.clearAt(L(), pid))}.` : `Bid in. ${claimsRun()}`);
          return act(() => G.addDrop(L(), ctx, mid, pid, drop, now()), `${p.n} added.`);
        });
      if (!R) return;
      const num = D.querySelector("#bid"), rng = D.querySelector(".bid-r"), box = D.querySelector(".bidbox"), note = D.querySelector("#bid-note"), go = D.querySelector(".bid-go");
      const sync = (v, from) => {
        v = Math.max(R.min, Math.min(R.have, Math.round(+v || 0)));
        if (from !== num) num.value = v;
        if (from !== rng) rng.value = v;
        box.style.setProperty("--pct", `${R.have ? (v / R.have) * 100 : 0}%`);
        D.querySelectorAll("[data-q]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.q === v)));
        if (go) go.textContent = `$${v}`;
        const where = v < R.lo ? "Below the fair range" : v > R.hi ? "Above the fair range" : "In the fair range";
        note.innerHTML = `${where} of $${R.lo} to $${R.hi}${R.have ? `, ${Math.round((v / R.have) * 100)}% of your budget` : ""}. If it wins you'll have <b>$${R.have - v}</b> left${othersBid ? `, before your other ${others.length === 1 ? "bid" : `${others.length} bids`} of $${othersBid}` : ""}.`;
      };
      D.oninput = (e) => { if (e.target === num || e.target === rng) sync(e.target.value, e.target); };
      D.onclick = (e) => { const q = e.target.closest("[data-q]"); if (q) { sync(q.dataset.q); num.focus(); } };
      sync(start);
    }
    function dropDialog(pid) {
      const p = ctx.byId[pid];
      U.confirm(`Drop ${p.n}?`, G.waiverDays(L()) ? `He goes on waivers until ${G.waiverWhen(G.waiverClear(L(), now()))}, then becomes a free agent.` : "He becomes a free agent right away.", "Drop him", () => act(() => G.addDrop(L(), ctx, me(), null, pid, now()), `${p.n} dropped.`));
    }
    // A points league's player card: what he's scored in this league each week, with his average.
    // A points player's weeks in this league: each finished week, and the current one so far against its projection.
    function weeksOf(p) {
      const last = Math.min(L().week - 1, G.totalWeeks(L()));
      const done = Array.from({ length: last }, (_, i) => ({ w: i + 1, v: Math.max(0, G.playerWeek(L(), ctx, p, i + 1, 1).pts || 0) }));
      const cw = over() ? null : curWeek(), so = cw && frac(cw) > 0 ? Math.max(0, G.playerWeek(L(), ctx, p, cw, frac(cw)).pts || 0) : 0;
      return { done, cur: cw ? { w: cw, so, pj: Math.max(so, projFor(p, so, cw) || 0) } : null, avg: done.length ? done.reduce((t, x) => t + x.v, 0) / done.length : null };
    }
    function weekBars(p, W) {
      if (!pts()) return catWeeks(p);
      const vals = W.done.map((x) => x.v), n = vals.length + (W.cur ? 1 : 0);
      if (n < 2) return "";
      const max = Math.max(...vals, W.cur ? W.cur.pj : 0, 1), avg = W.avg || 0, bw = 22, gap = 6, H = 64;
      const x = (i) => i * (bw + gap), y = (v) => H - (v / max) * (H - 6), hgt = (v) => Math.max(2, H - y(v));
      const bars = W.done.map((d, i) => `<g><title>Week ${d.w}: ${fmtS(d.v)}</title><rect x="${x(i)}" y="${Math.min(H - 2, y(d.v)).toFixed(1)}" width="${bw}" height="${hgt(d.v).toFixed(1)}" rx="${d.v ? 3 : 1}" class="${d.v >= avg ? "hi" : ""}"></rect><text x="${x(i) + bw / 2}" y="${H + 13}" text-anchor="middle">${d.w}</text></g>`).join("");
      // this week: an outline to the projection, filled to what he has so far
      const c = W.cur, k = vals.length;
      const now = c ? `<g><title>Week ${c.w}: ${fmtS(c.so)} so far, projected ${fmtS(c.pj)}</title><rect x="${x(k) + 1}" y="${Math.min(H - 2, y(c.pj)).toFixed(1)}" width="${bw - 2}" height="${hgt(c.pj).toFixed(1)}" rx="3" class="pj"></rect>${c.so > 0 ? `<rect x="${x(k)}" y="${Math.min(H - 2, y(c.so)).toFixed(1)}" width="${bw}" height="${hgt(c.so).toFixed(1)}" rx="3" class="so"></rect>` : ""}<text x="${x(k) + bw / 2}" y="${H + 13}" text-anchor="middle" class="cw">${c.w}</text></g>` : "";
      const Wd = x(n) - gap;
      return `<div class="wkbars"><div class="ps"><b>Points by week</b>${W.avg != null ? `, ${fmtS(avg)} a week on average` : ""}${c ? `. The outlined bar is week ${c.w}'s projection` : ""}</div><svg viewBox="0 -2 ${Wd} ${H + 18}" role="img" aria-label="Points by week: ${W.done.map((d) => `week ${d.w} ${fmtS(d.v)}`).join(", ")}${c ? `, week ${c.w} ${fmtS(c.so)} so far of ${fmtS(c.pj)} projected` : ""}" preserveAspectRatio="xMinYMid meet" style="max-width:${Math.max(Wd, 120)}px">${bars}${now}${vals.length ? `<line x1="0" x2="${x(k) - gap}" y1="${y(avg).toFixed(1)}" y2="${y(avg).toFixed(1)}" class="avg"></line>` : ""}</svg></div>`;
    }
    // the counting categories that say the most about a player, the big ones first: PTS REB AST, R HR RBI, K W SV
    const PREF = ["pts", "reb", "ast", "tpm", "stl", "blk", "r", "hr", "rbi", "sb", "k", "w", "sv", "qs", "hld"];
    const topCats = (p, n = 5) => sc().cats.filter((c) => c.col && p.l[c.line || "pg"] && (sport.cols[c.line || "pg"] || {})[c.col] != null).sort((a, b) => ((PREF.indexOf(a.col) + 99) % 99) - ((PREF.indexOf(b.col) + 99) % 99)).slice(0, n);
    const catVal = (ln, c) => { const v = ln && ln[c.line || "pg"], i = (sport.cols[c.line || "pg"] || {})[c.col]; return v && i != null ? v[i] || 0 : 0; };
    // A category player's weeks: his line in the big categories, one row a week, this week so far and projected
    function catWeeks(p) {
      const cats = topCats(p);
      const last = Math.min(L().week - 1, G.totalWeeks(L()));
      if (!cats.length || last < 1) return "";
      const ws = Array.from({ length: last }, (_, i) => i + 1).slice(-6);
      const row = (lab, ln, cls = "") => `<tr class="${cls}"><th scope="row">${lab}</th>${cats.map((c) => `<td class="num">${Math.round(catVal(ln, c))}</td>`).join("")}</tr>`;
      const cw = over() ? null : curWeek();
      const proj = cw ? G.projectLine(L(), ctx, ctx.own[p.id] != null ? ctx.own[p.id] : -1, p, cw, frac(cw)) : null;
      const tot = proj ? Object.fromEntries(Object.keys(proj[1]).map((k) => [k, (proj[1][k] || []).map((v, i) => v + ((proj[0][k] || [])[i] || 0))])) : null;
      return `<div class="stack" style="gap:6px"><div class="ps"><b>By week</b></div><div class="table-wrap"><table class="t dense pc-wt"><thead><tr><th>Week</th>${cats.map((c) => `<th class="num">${esc(c.label)}</th>`).join("")}</tr></thead><tbody>
        ${ws.map((w) => row(String(w), G.playerWeek(L(), ctx, p, w, 1))).join("")}${cw ? row(`${cw}, so far`, frac(cw) > 0 ? G.playerWeek(L(), ctx, p, cw, frac(cw)) : {}, "cur") + row(`${cw}, projected`, tot, "pj") : ""}</tbody></table></div></div>`;
    }
    // What's ahead this week: his games, and what he has and should end up with
    function weekPanel(p, W) {
      if (over()) return "";
      const w = curWeek(), gs = gamesOf(p, w);
      const games = gs ? (gs.length ? gs.map(oneGame).join("") : `<span class="gm none">No game this week</span>`) : "";
      let nums;
      if (pts()) nums = `${W.cur.so > 0 ? `<div><small>So far</small><b>${fmtS(W.cur.so)}</b></div>` : ""}<div><small>Projected</small><b>${fmtS(W.cur.pj)}</b></div>${W.avg != null ? `<div><small>His average</small><b>${fmtS(W.avg)}</b></div>` : ""}`;
      else {
        const [a, b] = G.projectLine(L(), ctx, ctx.own[p.id] != null ? ctx.own[p.id] : -1, p, w, frac(w));
        nums = topCats(p, 4).map((c) => `<div><small>${esc(c.label)}</small><b>${Math.round(catVal(a, c) + catVal(b, c))}</b></div>`).join("");
      }
      const left = gs && gs.length > 1 ? `<span class="ps">${gs.filter((g) => g.state !== "post").length} of ${gs.length} games left</span>` : "";
      return `<div class="pc-wk"><div class="pc-wk-h"><b>Week ${w}${pts() ? "" : ", projected"}</b>${left}${p.inj ? `<span class="tag inj">${esc(p.inj)}</span>` : ""}</div>${games ? `<div class="pc-gms">${games}</div>` : ""}<div class="pc-wk-n">${nums}</div></div>`;
    }
    // Everything that's happened to him in this league, newest first
    function leagueLog(p) {
      const items = [], D = L().draft;
      for (const x of L().tx) {
        const got = (x.adds || []).includes(p.id), lost = (x.drops || []).includes(p.id);
        if (!got && !lost) continue;
        const t = T(x.team), o = x.other != null ? T(x.other) : null, ab = (y) => `<b>${esc(y.name)}</b>`;
        const text = x.type === "trade" ? (got ? `Traded to ${ab(t)} by ${ab(o)}` : `Traded to ${ab(o)} by ${ab(t)}`)
          : x.type === "waiver" && got ? `Claimed by ${ab(t)}${x.faab != null ? ` for $${x.faab}${x.bid != null && x.bid !== x.faab ? ` on a $${x.bid} bid` : ""}${x.bids > 1 ? `, over ${x.bids - 1} other bid${x.bids > 2 ? "s" : ""}` : ""}` : ""}`
          : got ? `Added by ${ab(t)}` : `Dropped by ${ab(t)}`;
        items.push({ at: x.at, week: x.week, text });
      }
      if (D) {
        if (D.type === "auction") { const x = (D.sales || []).find((y) => y.pid === p.id); if (x) items.push({ at: x.at || D.done, week: 0, text: `${x.keeper ? "Kept" : "Bought"} by <b>${esc(T(x.team).name)}</b> for ${money(x.price)}` }); }
        else { const i = (D.board || []).findIndex((y) => y && y.pid === p.id); if (i >= 0) { const x = D.board[i], n = D.teams.length; items.push({ at: x.at || D.done, week: 0, text: `${x.keeper ? "Kept" : "Drafted"} by <b>${esc(T(x.team).name)}</b>, round ${Math.floor(i / n) + 1}, pick ${x.n || i + 1}` }); } }
      }
      if (!items.length) return "";
      items.sort((a, b) => b.at - a.at);
      return `<div class="stack" style="gap:6px"><div class="ps"><b>In this league</b></div><ul class="pc-log">${items.slice(0, 8).map((x) => `<li><span>${x.text}</span><small>${x.week ? `Week ${x.week}` : "Draft"}</small></li>`).join("")}</ul></div>`;
    }
    function playerCard(pid) {
      const p = ctx.byId[pid], mid = me(), own = ctx.own[pid];
      if (!p) return;
      let actions = "";
      if (mid != null) {
        const w = watch();
        actions += `<button class="btn" data-card="watch">${w.includes(pid) ? "Unwatch" : "Watch"}</button>`;
        if (own == null && canMove()) actions += `<button class="btn go" data-card="add">${G.onWaivers(L(), pid, now()) ? "Put in a claim" : "Add"}</button>`;
        else if (own === mid && canMove()) actions += `${L().settings.trades !== false && !over() ? `<button class="btn" data-card="block">${G.blockOf(L(), ctx, mid).includes(pid) ? "Take off the block" : "Put on the block"}</button>` : ""}<button class="btn warn" data-card="drop">Drop</button>`;
        else if (own != null && own !== mid && canTrade()) actions += `<button class="btn go" data-card="trade">Trade for him</button>`;
      }
      const status = own != null ? `${teamAv(T(own), "sm")} On ${esc(T(own).name)}` : G.onWaivers(L(), pid, now()) ? `<span class="tag gold">On waivers</span>` : `<span class="tag win">Free agent</span>`;
      // the headline numbers: rank and position, then how he's scoring here (season average, the last three weeks),
      // how often his team starts him, and what he'd go for in an auction
      const W = pts() ? weeksOf(p) : null, last3 = W && W.done.length >= 4 ? W.done.slice(-3).reduce((t, x) => t + x.v, 0) / 3 : null;
      const trend = last3 != null && W.avg ? (last3 - W.avg) / W.avg : null;
      const startWeeks = own != null ? Array.from({ length: Math.min(L().week - 1, G.totalWeeks(L())) }, (_, i) => i + 1) : [];
      const started = startWeeks.filter((w) => G.lineupFor(L(), ctx, own, w).includes(pid)).length;
      const stats = [["Overall", `#${p.rank}`], ["Position", esc(p.prank)]]
        .concat(W && W.avg != null ? [["Per week", fmtS(W.avg)]] : [[pts() ? (sport.weekOf != null ? `Week ${sport.weekOf}` : "Projection") : "Value", pts() ? (sport.weekOf != null ? fmtS(p.v / 17) : String(Math.round(p.v))) : p.v.toFixed(1)]])
        .concat(trend != null ? [["Last 3 weeks", `${fmtS(last3)}<em class="${trend >= 0.1 ? "up" : trend <= -0.1 ? "dn" : ""}">${trend >= 0 ? "+" : ""}${Math.round(trend * 100)}%</em>`]] : [])
        .concat(startWeeks.length && !bb() ? [["Started", `${started} of ${startWeeks.length}`]] : [])
        .concat([["Auction", p.$ ? money(p.$) : "-"]]);
      const Dl = U.dialog(U.playerCard(sport, p, { scoring: L().scoring, actions, status, stats, week: weekPanel(p, W || {}), extra: pts() ? weekBars(p, W) : catWeeks(p), after: leagueLog(p), fold: true }), null, { wide: true, sheet: true });
      $$("[data-card]", Dl).forEach((b) => b.addEventListener("click", () => {
        const a = b.dataset.card; Dl.close();
        if (a === "watch") { const w = watch(); const i = w.indexOf(pid); if (i >= 0) w.splice(i, 1); else w.push(pid); save(); render(); }
        else if (a === "add") addDialog(pid);
        else if (a === "drop") dropDialog(pid);
        else if (a === "trade") openTrade(own, pid);
        else if (a === "block") { const on = !G.blockOf(L(), ctx, mid).includes(pid); act(() => G.setBlock(L(), mid, pid, on), on ? `${p.n} is on the block.` : `${p.n} is off the block.`); }
      }));
    }

    /* ---------- the league's masthead, on its front page ---------- */
    function mastVM() {
      const Lg = L(), br = U.leagueBrand(Lg.name, Lg.settings.brand), total = G.totalWeeks(Lg), reg = Lg.settings.weeks, w = Lg.week;
      const st = gl() || roto() ? null : standings(), my = me() != null && st ? st.find((r) => r.team === me()) : null;
      const lines = [esc(sport.name), `${Lg.teams.length} teams`, esc(sc().label.replace(/ \(.*\)$/, ""))];
      if (gl()) lines.push("guillotine"); else if (roto()) lines.push("rotisserie");
      const champ = over() ? championOf() : null;
      const you = champ != null ? `<b>${esc(T(champ).name)}</b> won the title.` : my ? `You're <b>${ord(my.rank)} at ${my.w}-${my.l}${my.t ? "-" + my.t : ""}</b>.` : "";
      const weeks = total > 1 ? Array.from({ length: total }, (_, i) => { const n = i + 1; return { n, po: n > reg, gap: n === reg + 1, k: over() || n < w ? "done" : n === w ? "now" : "next" }; }) : [];
      const weekLine = over() ? "Season over" : oneWeekLg() ? "One week" : w > reg ? `Playoffs, week ${w}` : `Week ${w} of ${reg}${total > reg ? `, then ${total - reg} of playoffs` : ""}`;
      const champs = seasonsAll().filter((x) => !x.live && x.champion).slice(-4).map((x) => { const t = Lg.teams[x.champion.team]; return { season: x.season || `Year ${x.year}`, name: x.champion.name, abbr: (t && t.name === x.champion.name && t.abbr) || U.initials(x.champion.name).slice(0, 3), color: t ? t.color : 0 }; });
      return { brand: br, sub: `${lines.join(", ")}.${you ? " " + you : ""}`, weeks, weekLine, note: scoreMsg(), champs };
    }

    /* ---------- render ---------- */
    function render() {
      if (U.dialogOpen()) return;
      blockCache = {};
      const r = route();
      const tabs = TABS().map(([k, n]) => [k, n, k === "team" ? pendingTrades() : 0]);
      const subs = subsOf(r.tab);
      const hrefOf = (t, s) => "#" + t + (s ? "/" + s : "");
      const front = r.tab === "league" && (!r.sub || r.sub === "overview");
      opts.top.innerHTML = U.shell({ brand: opts.brand, title: opts.switcher ? opts.switcher() : "", tabs, tab: r.tab, subs, sub: r.sub, hrefOf, right: opts.right ? opts.right() : "", tabbar: true, mast: front ? mastVM() : null });
      document.body.classList.add("fk-hasbar");
      // the sticky header's height, so sticky bars on the page (the "Moving" bar) sit just under it
      const topEl = opts.top.querySelector(".fk-top") || opts.top; document.documentElement.style.setProperty("--fk-top-h", `${Math.round(topEl.getBoundingClientRect().height)}px`);
      const keep = $("#fk-players") ? $("#fk-players").scrollTop : 0;
      const focus = U.focusKey(opts.el) || U.focusKey(opts.top);
      let html = "";
      if (r.tab === "league") html = { overview, chat: chatPage, standings: standingsPage, scoreboard: () => scoreboardPage(r.arg), recap: () => recapPage(r.arg), managers: managersPage, dues: duesPage, history: pastPage, rules: settingsPage }[r.sub]();
      else if (r.tab === "team") html = { roster: () => rosterPage(r.arg), schedule: () => schedulePage(r.arg), trades: tradesPage }[r.sub]();
      else if (r.tab === "matchup") html = matchupPage(r.sub, r.arg);
      else if (r.tab === "players") html = playersPage(r.sub);
      else if (r.tab === "draft") html = draftPage();
      else if (r.tab === "commish") html = `<div class="wrap page">${opts.commishTools()}</div>`;
      // every page names itself: in the tab title, and as a heading for screen readers when the page has none
      const tabName = (TABS().find(([k]) => k === r.tab) || [, ""])[1], subName = (subs.find(([k]) => k === r.sub) || [, ""])[1];
      const pageName = subName && subName !== "Overview" ? subName : tabName;
      document.title = `${pageName ? pageName + " | " : ""}${L().name}`;
      if (!/<h1[\s>]/.test(html)) html = `<h1 class="sr">${esc(pageName || L().name)}, ${esc(L().name)}</h1>` + html;
      const scores = r.tab === "matchup" || (r.tab === "league" && r.sub === "scoreboard") ? scoreNote() : "";
      opts.el.innerHTML = (opts.notice ? opts.notice() : "") + alertsBar(r) + scores + html;
      if (L().heist) setTimeout(heistReveal, 0);
      for (const box of $$(".fk-nav nav, .fk-subs .wrap, .chips", document)) {
        const on = $('[aria-current="page"], [aria-pressed="true"]', box);
        if (on && box.scrollWidth > box.clientWidth) box.scrollLeft += on.getBoundingClientRect().left - box.getBoundingClientRect().left - (box.clientWidth - on.clientWidth) / 2;
      }
      if ($("#fk-players")) $("#fk-players").scrollTop = keep;
      // the chat opens at the newest post
      const cl = r.sub === "chat" && $(".chat-card .chat", opts.el); if (cl) cl.scrollTop = cl.scrollHeight;
      U.keyboardPlayers(opts.el);
      U.refocus(document, focus);
    }

    /* ---------- drag and drop on the roster ---------- */
    // A mouse drags a row once it moves a few pixels; a finger holds still for a moment first, so a swipe still scrolls.
    // While dragging, every place the player can go lights up, and letting go there makes the same move the buttons do.
    let drag = null;
    function dropsFor(pid, from) {
      const p = ctx.byId[pid], slots = L().settings.lineup, mid = me(), ir = L().ir[mid] || [], ok = new Map();
      if (!p) return ok;
      if (from === "ir") { ok.set("bn", { why: "Activate" }); return ok; }
      slots.forEach((s, i) => { if (from !== "s" + i && S.fits(sport, p, s)) ok.set("s" + i, { why: "Start" }); });
      if (from.startsWith("s")) {
        ok.set("bn", { why: "Bench" });
        const k = +from.slice(1);
        const lu = G.lineupFor(L(), ctx, mid, rosterWeek()), tx = G.taxiOf(L(), mid);
        for (const q of L().rosters[mid]) { const qp = ctx.byId[q]; if (qp && q !== pid && !lu.includes(q) && !ir.includes(q) && !tx.includes(q) && S.fits(sport, qp, slots[k])) ok.set("bn:" + q, { why: "Swap" }); }
      }
      if (G.irEligible(p) && ir.length < G.irSlots(L())) ok.set("ir", { why: "To IR" });
      return ok;
    }
    const rosterWeek = () => (ui.week && ui.week >= L().week ? ui.week : curWeek());
    const zoneKey = (el) => (!el ? null : el.dataset.dzp ? "bn:" + el.dataset.dzp : el.dataset.dz);
    function dropAt(key) {
      const { pid, from } = drag, mid = me(), w = rosterWeek(), p = ctx.byId[pid];
      if (!key || !drag.ok.has(key)) return;
      if (from === "ir") { const r = G.activate(L(), ctx, mid, pid, null, now()); if (r.needDrop) activateDialog(pid); else if (!r.ok) U.toast(r.why, true); else { save(); U.toast(`${p.n} is back from IR.`); render(); } return; }
      if (key === "ir") return act(() => G.toIR(L(), ctx, mid, pid, now()), `${p.n} is on IR. His roster spot is open.`);
      if (key.startsWith("bn:")) return act(() => G.move(L(), ctx, mid, w, key.slice(3), +from.slice(1), now()));
      if (key === "bn") return act(() => G.move(L(), ctx, mid, w, pid, "BN", now()));
      act(() => G.move(L(), ctx, mid, w, pid, +key.slice(1), now()));
    }
    function endDrag(e, commit) {
      if (!drag) return;
      const d = drag; drag = null;
      clearTimeout(d.hold);
      document.removeEventListener("touchmove", d.block, { passive: false });
      if (d.ghost) d.ghost.remove();
      opts.el.querySelectorAll(".dz-ok,.dz-on,.dragging").forEach((x) => x.classList.remove("dz-ok", "dz-on", "dragging"));
      document.body.classList.remove("fk-dragging");
      if (commit && d.live) { drag = d; dropAt(d.over); drag = null; }
    }
    function startLive(d, x, y) {
      d.live = true;
      d.ok = dropsFor(d.pid, d.from);
      d.row.classList.add("dragging");
      opts.el.querySelectorAll("[data-dz]").forEach((z) => { if (d.ok.has(zoneKey(z))) z.classList.add("dz-ok"); });
      const p = ctx.byId[d.pid], g = document.createElement("div");
      g.className = "drag-ghost"; g.innerHTML = `${U.playerAv(sport, p, "sm")}<b>${esc(p.n)}</b><small></small>`;
      document.body.appendChild(g); d.ghost = g;
      document.body.classList.add("fk-dragging");
      if (navigator.vibrate) try { navigator.vibrate(10); } catch (err) { /* no buzz */ }
      moveGhost(d, x, y);
    }
    function moveGhost(d, x, y) {
      d.ghost.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
      d.ghost.style.visibility = "hidden";
      const under = document.elementFromPoint(x, y);
      d.ghost.style.visibility = "";
      const z = under && under.closest("[data-dz]"), key = zoneKey(z);
      opts.el.querySelectorAll(".dz-on").forEach((q) => q.classList.remove("dz-on"));
      d.over = key && d.ok.has(key) ? key : null;
      if (d.over) z.classList.add("dz-on");
      d.ghost.querySelector("small").textContent = d.over ? d.ok.get(d.over).why : "";
      // near the top or bottom of the screen, scroll so the whole roster is in reach
      d.lastX = x; d.lastY = y;
      if (!d.scrollT) {
        // keeps scrolling while the finger or mouse rests near an edge (below the sticky header at the top)
        const step = () => {
          if (drag !== d || !d.live) { d.scrollT = 0; return; }
          const top = (opts.top && opts.top.getBoundingClientRect().bottom) || 0, edge = 70;
          const v = d.lastY < top + edge ? -Math.ceil((top + edge - d.lastY) / 5) : d.lastY > innerHeight - edge ? Math.ceil((d.lastY - innerHeight + edge) / 5) : 0;
          if (v) { scrollBy(0, Math.max(-24, Math.min(24, v))); moveGhost(d, d.lastX, d.lastY); }
          d.scrollT = requestAnimationFrame(step);
        };
        d.scrollT = requestAnimationFrame(step);
      }
    }

    opts.el.addEventListener("pointerdown", (e) => {
      const row = e.target.closest("tr[data-dg]");
      if (!row || e.button > 0 || e.target.closest("button:not(.slotbtn),a,input,select,[data-player]")) return;
      const d = { pid: row.dataset.dg, from: row.dataset.from, row, x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType !== "mouse", live: false };
      d.block = (ev) => { if (drag && drag.live) ev.preventDefault(); };
      document.addEventListener("touchmove", d.block, { passive: false });
      if (d.touch) d.hold = setTimeout(() => { if (drag === d) startLive(d, d.x, d.y); }, 280);
      drag = d;
    });
    window.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.live) {
        const far = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
        if (drag.touch) { if (far > 10) endDrag(e, false); return; }
        if (far < 6) return;
        startLive(drag, e.clientX, e.clientY);
      }
      e.preventDefault();
      moveGhost(drag, e.clientX, e.clientY);
    }, { passive: false });
    window.addEventListener("pointerup", (e) => { if (drag && e.pointerId === drag.id) { const was = drag.live; endDrag(e, true); if (was) { const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); window.removeEventListener("click", stop, true); }; window.addEventListener("click", stop, true); setTimeout(() => window.removeEventListener("click", stop, true), 50); } } });
    window.addEventListener("pointercancel", (e) => { if (drag && e.pointerId === drag.id) endDrag(e, false); });
    window.addEventListener("keydown", (e) => { if (e.key === "Escape" && drag) endDrag(e, false); });
    opts.el.addEventListener("contextmenu", (e) => { if (drag && drag.live) e.preventDefault(); });

    opts.el.addEventListener("input", (e) => { if (e.target.id === "fk-chat") ui.chatDraft = e.target.value; });
    opts.el.addEventListener("keydown", (e) => {
      // Enter sends, Shift+Enter starts a new line
      if (e.target.id === "fk-chat" && e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.target.form.requestSubmit(); }
    });
    opts.el.addEventListener("submit", async (e) => {
      if (e.target.id !== "fk-chatf" || !opts.chat) return;
      e.preventDefault();
      const body = (ui.chatDraft || "").trim();
      if (!body || ui.sending) return;
      ui.sending = true;
      const btn = e.target.querySelector("button"); if (btn) btn.disabled = true;
      const r = await opts.chat.send(body).catch((err) => ({ error: err.message }));
      ui.sending = false;
      if (r && r.error) { if (btn) btn.disabled = false; U.toast(r.error, true); return; }
      ui.chatDraft = ""; render();
      const box = $("#fk-chat", opts.el); if (box) box.focus();
    });
    opts.el.addEventListener("submit", (e) => {
      if (e.target.id !== "fk-blocknote" || me() == null) return;
      e.preventDefault();
      const v = $("#fk-bn", opts.el).value.replace(/\s+/g, " ").trim().slice(0, 80);
      L().blockNote = Object.assign({}, L().blockNote, { [me()]: v });
      save(); render(); U.toast(v ? "Note saved." : "Note cleared.");
    });
    opts.el.addEventListener("click", (e) => {
      const mb = e.target.closest("[data-more]");
      if (mb) { ui.plimit = (ui.plimit || 250) + 250; render(); return; }
      const b = e.target.closest("[data-rematch],[data-pyo],[data-mgr],[data-editprofile],[data-unblock],[data-editteam],[data-toir],[data-activate],[data-totaxi],[data-promote],[data-bite],[data-swapb],[data-add],[data-drop],[data-trade],[data-move],[data-here],[data-optimize],[data-week],[data-watch],[data-unclaim],[data-editclaim],[data-cup],[data-cdown],[data-sbweek],[data-mweek],[data-txf],[data-fpos],[data-tr-accept],[data-tr-reject],[data-tr-counter],[data-tr-cancel],[data-tr-ok],[data-tr-veto],[data-tr-cmveto],[data-copyfinal],[data-rcweek],[data-copyrecap],[data-sharerecap],th[data-sort]");
      if (b) {
        e.preventDefault(); e.stopPropagation();
        const d = b.dataset, mid = me();
        if (d.mgr != null) { const Dl = U.dialog(managerCard(+d.mgr, true)); Dl.onclick = (ev) => { if (ev.target.closest("[data-editprofile]")) { Dl.close(); opts.editProfile(); } }; }
        else if (b.hasAttribute("data-editprofile")) opts.editProfile();
        else if (d.unblock) act(() => G.setBlock(L(), mid, d.unblock, false), `${ctx.byId[d.unblock].n} is off the block.`);
        else if (b.hasAttribute("data-editteam")) editTeam();
        else if (d.toir) act(() => G.toIR(L(), ctx, mid, d.toir, now()), `${ctx.byId[d.toir].n} is on IR. His roster spot is open.`);
        else if (d.bite) biteDialog(+d.bite);
        else if (b.hasAttribute("data-pyo")) pyoDialog();
        else if (d.totaxi) act(() => G.toTaxi(L(), ctx, mid, d.totaxi, now()), `${ctx.byId[d.totaxi].n} is on the taxi squad. His roster spot is open.`);
        else if (d.promote) { const r = G.promote(L(), ctx, mid, d.promote, null, now()); if (r.needDrop) activateDialog(d.promote, true); else if (!r.ok) U.toast(r.why, true); else { save(); U.toast(`${ctx.byId[d.promote].n} is on the active roster.`); render(); } }
        else if (d.activate) { const r = G.activate(L(), ctx, mid, d.activate, null, now()); if (r.needDrop) activateDialog(d.activate); else if (!r.ok) U.toast(r.why, true); else { save(); U.toast(`${ctx.byId[d.activate].n} is back from IR.`); render(); } }
        else if (d.swapb) { const w = ui.week && ui.week >= L().week ? ui.week : curWeek(); ui.moving = null; act(() => G.move(L(), ctx, mid, w, d.swapb, +d.slot, now())); }
        else if (d.add) addDialog(d.add);
        else if (d.drop) dropDialog(d.drop);
        else if (d.trade !== undefined && b.hasAttribute("data-trade")) openTrade(d.trade === "" ? null : +d.trade, d.want || null);
        else if (d.move !== undefined && b.hasAttribute("data-move")) { ui.moving = d.move || null; render(); }
        else if (d.here !== undefined && b.hasAttribute("data-here")) { const w = ui.week && ui.week >= L().week ? ui.week : curWeek(); const pid = ui.moving; ui.moving = null; act(() => G.move(L(), ctx, mid, w, pid, d.here === "BN" ? "BN" : +d.here, now())); }
        else if (b.hasAttribute("data-optimize")) { const w = ui.week && ui.week >= L().week ? ui.week : curWeek(); act(() => G.setLineup(L(), ctx, mid, w, G.bestLineup(L(), ctx, mid, w, now()), now()), "Best lineup set."); }
        else if (d.week) { ui.week = +d.week; render(); }
        else if (d.watch) { const w = watch(); const i = w.indexOf(d.watch); if (i >= 0) w.splice(i, 1); else w.push(d.watch); save(); render(); }
        else if (b.hasAttribute("data-rematch")) { if (opts.rematch) opts.rematch(); }
        else if (b.hasAttribute("data-copyfinal")) { const txt = finishText(); (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => U.toast("Copied. Paste it in your group chat."), () => U.dialog(`<h3>The result</h3><textarea rows="6" style="width:100%">${esc(txt)}</textarea><div class="acts"><button class="btn" data-close>Done</button></div>`)); }
        else if (d.unclaim) act(() => G.cancelClaim(L(), +d.unclaim), "Claim cancelled.");
        else if (d.editclaim) { const c = L().claims.find((x) => x.id === +d.editclaim && x.status === "open"); if (c) addDialog(c.add, c); }
        else if (d.cup || d.cdown) act(() => G.moveClaim(L(), me(), +(d.cup || d.cdown), d.cup ? -1 : 1));
        else if (d.rcweek) { location.hash = `#league/recap/${d.rcweek}`; }
        else if (d.copyrecap) { const rc = recapOf(+d.copyrecap); if (rc) { const txt = recapText(rc); (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => U.toast("Recap copied. Paste it in your group chat."), () => U.dialog(`<h3>Week ${rc.week} recap</h3><textarea rows="14" style="width:100%;font:inherit;font-size:13px" readonly>${esc(txt)}</textarea><div class="acts"><button type="button" class="btn" data-close>Close</button></div>`)); } }
        else if (d.sharerecap) { const rc = recapOf(+d.sharerecap); if (rc) navigator.share({ title: `${L().name}, week ${rc.week} recap`, text: recapText(rc) }).catch(() => {}); }
        else if (d.sbweek) { ui.sbWeek = +d.sbweek; location.hash = `#league/scoreboard/${d.sbweek}`; }
        else if (d.mweek) { location.hash = `#matchup/${d.mweek}`; }
        else if (d.txf !== undefined && b.hasAttribute("data-txf")) { ui.txf = d.txf; render(); }
        else if (d.fpos !== undefined && b.hasAttribute("data-fpos")) { ui.pf.pos = d.fpos; render(); }
        else if (d.trAccept) { const id = +d.trAccept; U.confirm("Accept this trade?", L().settings.tradeReview === "none" ? "It goes through right away." : `The ${L().settings.tradeReview === "commish" ? "commissioner gets" : "league gets"} ${fmtHours(L().settings.reviewHours)} to review it before it goes through.`, "Accept trade", () => act(() => G.respond(L(), ctx, id, true, now()), L().settings.tradeReview === "none" ? "Trade accepted." : `Accepted. The league has ${fmtHours(L().settings.reviewHours)} to review it.`)); }
        else if (d.trReject) act(() => G.respond(L(), ctx, +d.trReject, false, now()), "Offer rejected.");
        else if (d.trCancel) act(() => G.cancelTrade(L(), +d.trCancel, now()), "Offer cancelled.");
        else if (d.trOk) act(() => G.vote(L(), ctx, +d.trOk, mid, false, now()), "You approved the trade.");
        else if (d.trCmveto) { const id = +d.trCmveto; U.confirm("Veto this trade?", "It won't go through, and both teams keep their players.", "Veto trade", () => act(() => G.commishVeto(L(), id, now()), "Trade vetoed.")); }
        else if (d.trVeto) act(() => G.vote(L(), ctx, +d.trVeto, mid, true, now()), "You voted to veto.");
        else if (d.trCounter) { const t = L().trades.find((x) => x.id === +d.trCounter); openTrade(t.from, null, { give: t.get.slice(), get: t.give.slice(), pickGive: (t.pickGet || []).slice(), pickGet: (t.pickGive || []).slice(), faabGive: t.faabGet, faabGet: t.faabGive, counterOf: t.id }); }
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
