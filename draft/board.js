/* The Big Board view: consensus table, outlets, range, movement, stats. */
(function () {
  "use strict";
  const { $, esc, fmtDay } = BB;
  let ui = { lg: "nba", q: "", pos: "all", sort: "rank", dir: 1, open: null };
  let D = null;

  const liveBoards = () => D.sources.filter((s) => s.kind === "board" && s.w);
  const mocks = () => D.sources.filter((s) => s.kind === "mock" && s.date);
  const hasStats = () => D.players.some((p) => p.stats && p.stats.length);

  function move(p) {
    const h = p.hist, now = h[h.length - 1];
    if (h.length < 2) return 0;
    for (let i = h.length - 2; i >= 0; i--) if (h[i] != null) return h[i] - now;
    return null;
  }

  function sources() {
    const maxW = Math.max(...D.sources.map((s) => s.w || 0), 1);
    // Outlets that have published get a card each; the ones still to come share one card, so the strip
    // fits in a row or two and never scrolls.
    const out = D.sources.filter((s) => s.date), waiting = D.sources.filter((s) => !s.date);
    // One compact table, hub style: outlet, when it last updated, how deep it goes, how much it counts
    $("#sources").innerHTML = `<table class="t srct"><thead><tr><th>Outlet</th><th>Updated</th><th>Ranks</th><th class="hide-s">Weight</th></tr></thead><tbody>` +
      out.map((s) => {
        const who = s.analyst ? `${s.name} (${s.analyst})` : s.name;
        return `<tr><td><a href="${esc(s.link || s.url)}" target="_blank" rel="noopener" title="${esc(s.note || s.title || s.name)}"><b>${esc(s.abbr)}</b></a> <span class="who">${esc(who)}</span>${s.kind === "mock" ? ' <span class="pill">Mock</span>' : ""}</td>
          <td>${fmtDay(s.date)}</td><td>${s.kind === "mock" ? `${s.count} picks` : `Top ${s.count}`}</td>
          <td class="hide-s">${s.kind === "board" ? `<span class="w" aria-hidden="true"><i style="width:${Math.round(100 * (s.w || 0) / maxW)}%"></i></span>` : "Mock column"}</td></tr>`;
      }).join("") +
      (waiting.length ? `<tr class="pending"><td colspan="4">Not out yet: <span title="${esc(waiting.map((s) => s.analyst ? `${s.name} (${s.analyst})` : s.name).join(", "))}">${esc(waiting.map((s) => s.name).join(", "))}</span>. Each joins when it publishes.</td></tr>` : "") +
      "</tbody></table>";
    $("#srcList").innerHTML = D.sources.map((s) => `<li><a href="${esc(s.link || s.url)}" target="_blank" rel="noopener">${esc(s.name)}${s.analyst ? ` (${esc(s.analyst)})` : ""}</a>: ${s.date ? `${s.kind === "mock" ? "mock draft" : `top ${s.count}`}, ${fmtDay(s.date)}${s.versions > 1 ? `, ${s.versions} readings` : ""}` : "not out for this class yet"}${s.kind === "mock" ? ". Shown, not counted" : ""}</li>`).join("")
      + (Object.keys(D.excluded || {}).length ? `<li>Left out on purpose: WalterFootball. PFF and The Athletic only if pasted from a subscription.</li>` : "")
      + `<li>Size, age and stats: <a href="${D.league === "nba" ? "https://www.tankathon.com/big_board" : "https://www.tankathon.com/nfl/big_board"}" target="_blank" rel="noopener">Tankathon</a>, daily.</li>`;
  }

  function head() {
    const live = liveBoards(), mk = mocks();
    const th = (k, label, cls = "", title = "") => `<th class="${cls}"${ui.sort === k ? ` aria-sort="${ui.dir > 0 ? "ascending" : "descending"}"` : ""}${title ? ` title="${esc(title)}"` : ""}><button type="button" data-sort="${k}">${label}</button></th>`;
    const prev = D.dates.length > 1 ? fmtDay(D.dates[D.dates.length - 2]) : "";
    // Move only once a player has moved; on a phone it rides next to the rank instead of taking a column
    const moved = D.players.some((p) => { const m = move(p); return m != null && m !== 0; });
    $("#thead").innerHTML = `<tr>${th("rank", "#", "r")}${moved ? th("move", "Move", "hide-s", prev ? `Spots since ${prev}` : "") : ""}${th("name", "Player")}
      ${hasStats() ? th("prod", D.league === "nba" ? "This season" : "2026 season", "hide-m", D.league === "nba" ? "Sort by production: box plus-minus where the board has it, else points, rebounds, assists, steals and blocks, as a percentile of the class" : "Sort by production against his position on this board: yards a game for passers, runners and receivers, tackles and sacks for defenders") : ""}${th("score", "Avg", "r", "Weighted average rank")}
      ${live.map((s) => th("s:" + s.id, esc(s.abbr), "r col-src", `${s.name}${s.analyst ? `, ${s.analyst}` : ""}, ${fmtDay(s.date)}`)).join("")}
      ${live.length > 1 ? `${th("spread", "Range", "rng", "Best and worst rank across the boards")}` : ""}${mk.length ? th("mock", "Mock", "hide-s", mk.map((m) => `${m.name}, ${fmtDay(m.date)}`).join("; ")) : ""}</tr>`;
  }

  function cols() { return 3 + (D.players.some((p) => { const m = move(p); return m != null && m !== 0; }) ? 1 : 0) + (hasStats() ? 1 : 0) + liveBoards().length + (liveBoards().length > 1 ? 1 : 0) + (mocks().length ? 1 : 0); }

  // production, as a percentile (0-100) of this board's players who have numbers: NBA by box plus-minus (OBPM + DBPM)
  // when listed, else a box-score blend; NFL against his own position group by its main stat a game. No stats: null.
  let prodCache = null;
  function prod(p) {
    if (!prodCache || prodCache.d !== D) {
      const num = (x) => { const v = parseFloat(String(x == null ? "" : x).replace(/,/g, "")); return Number.isFinite(v) ? v : null; };
      const stat = (q, k, per) => { const r = (q.stats || []).find((x) => x[0] === k); return r ? num(per ? (r[2] !== "" && r[2] != null ? r[2] : r[1]) : r[1]) : null; };
      const raw = {}, group = {}, gOf = {};
      for (const q of D.players) {
        let v = null, g = "all";
        if (D.league === "nba") {
          const ob = stat(q, "OBPM"), db = stat(q, "DBPM");
          if (ob != null && db != null) { v = ob + db; g = "bpm"; }
          else { const pts = stat(q, "PTS"); if (pts != null) { v = pts + 0.7 * (stat(q, "REB") || 0) + (stat(q, "AST") || 0) + (stat(q, "STL") || 0) + 0.7 * (stat(q, "BLK") || 0); g = "box"; } }
        } else {
          const pos = String(q.pos || "").split("/")[0];
          if (stat(q, "Pass Yds", true) != null) { v = stat(q, "Pass Yds", true); g = "QB"; }
          else if (stat(q, "Rush Yds", true) != null) { v = stat(q, "Rush Yds", true); g = "RB"; }
          else if (stat(q, "REC Yds", true) != null) { v = stat(q, "REC Yds", true); g = pos === "TE" ? "TE" : "WR"; }
          else if (stat(q, "TACKLES") != null) { v = stat(q, "TACKLES") + 6 * (stat(q, "SACKS") || 0); g = ["EDGE", "DL"].includes(pos) ? "DL" : ["CB", "S"].includes(pos) ? "DB" : "LB"; }
        }
        if (v != null) { raw[q.id] = v; gOf[q.id] = g; (group[g] = group[g] || []).push(v); }
      }
      const out = {};
      for (const q of D.players) {
        if (raw[q.id] == null) continue;
        const xs = group[gOf[q.id]];
        out[q.id] = Math.round(100 * xs.filter((x) => x < raw[q.id]).length / Math.max(1, xs.length - 1));
      }
      prodCache = { d: D, out };
    }
    const v = prodCache.out[p.id]; return v == null ? null : v;
  }
  function rows() {
    const live = liveBoards(), mk = mocks();
    const q = ui.q.trim().toLowerCase();
    let ps = D.players.filter((p) => BB.inGroup(ui.lg, p.pos, ui.pos)
      && (!q || p.n.toLowerCase().includes(q) || (p.school || "").toLowerCase().includes(q)));
    const val = (p) => {
      if (ui.sort === "name") return p.n.split(" ").slice(-1)[0].toLowerCase();
      if (ui.sort === "move") { const m = move(p); return m == null ? -999 * ui.dir : -m; }
      if (ui.sort === "spread") return -(p.lo - p.hi);
      if (ui.sort === "mock") { const m = mk.map((s) => p.mocks[s.id]).find(Boolean); return m ? m[0] : 999; }
      if (ui.sort.startsWith("s:")) return p.ranks[ui.sort.slice(2)] ?? 999;
      if (ui.sort === "prod") { const v = prod(p); return v == null ? 999 * ui.dir : -v; }
      return p[ui.sort];
    };
    ps = ps.slice().sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : a.rank - b.rank) * ui.dir; });
    const spreads = D.players.slice(0, 60).map((p) => p.lo - p.hi).sort((a, b) => b - a);
    const hotCut = spreads[Math.min(5, spreads.length - 1)] || 99;
    const maxR = Math.max(60, ...ps.slice(0, 100).map((p) => p.lo));
    const n = live.length, st = hasStats(), moved = D.players.some((p) => { const m = move(p); return m != null && m !== 0; });
    if (!ps.length) { $("#tbody").innerHTML = `<tr><td class="empty" colspan="${cols()}">No one matches that.</td></tr>`; return; }
    $("#tbody").innerHTML = ps.slice(0, 250).map((p) => {
      const m = move(p);
      const mvTxt = m == null ? `<span class="mv flat" title="New this update">new</span>` : m > 0 ? `<span class="mv up">&#9650;${m}</span>` : m < 0 ? `<span class="mv down">&#9660;${-m}</span>` : `<span class="mv flat">&ndash;</span>`;
      const spread = p.lo - p.hi;
      const pct = (r) => (100 * (Math.min(r, maxR) - 1) / (maxR - 1)).toFixed(1);
      const mockCell = mk.map((s) => p.mocks[s.id]).find(Boolean);
      const open = ui.open === p.id;
      return `<tr class="p${open ? " open" : ""}" data-id="${esc(p.id)}" tabindex="0">
        <td class="rk r">${p.rank}${moved && m ? `<small class="mv-in ${m > 0 ? "up" : "down"}">${m > 0 ? "&#9650;" + m : "&#9660;" + -m}</small>` : ""}</td>${moved ? `<td class="hide-s">${mvTxt}</td>` : ""}
        <td><div class="who-cell">${BB.who(p)}<div class="nm">${esc(p.n)}<small>${esc([p.pos, p.school].filter(Boolean).join(", "))}</small></div></div></td>
        ${st ? `<td class="stl hide-m">${BB.statLine(p) || `<span class="faint">&ndash;</span>`}</td>` : ""}
        <td class="r sc">${p.score.toFixed(1)}</td>
        ${live.map((s) => p.ranks[s.id] != null ? `<td class="r cell col-src">${p.ranks[s.id]}</td>` : `<td class="r cell miss col-src" title="Not on this board">&ndash;</td>`).join("")}
        ${n > 1 ? `<td class="rng"><span${spread >= hotCut && p.on > 1 ? ` class="hot"` : ""}>${p.on > 1 ? `${p.hi}&ndash;${p.lo}` : `${p.hi} only`}</span>
          <div class="bar" aria-hidden="true"><i style="left:${pct(p.hi)}%;right:${(100 - pct(p.lo)).toFixed(1)}%"></i><b style="left:${pct(p.rank)}%"></b></div></td>` : ""}
        ${mk.length ? `<td class="mk hide-s">${mockCell ? `<span class="mk-pick"${mockCell[1] && D.teams[mockCell[1]] ? ` title="No. ${mockCell[0]} to ${esc(D.teams[mockCell[1]].city)}"` : ""}>${mockCell[0]}${mockCell[1] && D.teams[mockCell[1]] ? BB.logo(D, mockCell[1], 20) : mockCell[1] ? ` ${esc(mockCell[1])}` : ""}</span>` : "&ndash;"}</td>` : ""}
      </tr>`;
    }).join("");
  }

  // His rank over time: a step line over the update dates, labels only where it says something (first, last, best,
  // worst). A rank that never moved gets a sentence instead of a flat line.
  function spark(p) {
    const pts = D.dates.map((d, i) => [d, p.hist[i]]).filter((x) => x[1] != null);
    if (pts.length < 2) return "";
    const ranks = pts.map((x) => x[1]), best = Math.min(...ranks), worst = Math.max(...ranks);
    if (best === worst) return `<p class="note">No. ${best} on every update since ${fmtDay(pts[0][0])}.</p>`;
    const W = 420, H = 100, padX = 16, top = 18, bot = 30;
    const t0 = Date.parse(pts[0][0]), t1 = Date.parse(pts[pts.length - 1][0]);
    const X = (d) => padX + (W - 2 * padX) * ((Date.parse(d) - t0) / Math.max(1, t1 - t0));
    const Y = (r) => top + (H - top - bot) * (r - best) / Math.max(1, worst - best);
    let path = "";
    pts.forEach((x, i) => { path += i ? `H${X(x[0]).toFixed(1)}V${Y(x[1]).toFixed(1)}` : `M${X(x[0]).toFixed(1)},${Y(x[1]).toFixed(1)}`; });
    const want = [...new Set([0, ranks.indexOf(best), ranks.lastIndexOf(worst), pts.length - 1])].sort((a, b) => a - b);
    // skip a label that repeats the one just before it a short way off (a rank held through the last few updates)
    const keep = want.filter((i, k) => k === 0 || !(ranks[i] === ranks[want[k - 1]] && X(pts[i][0]) - X(pts[want[k - 1]][0]) < 70) || i === pts.length - 1)
      .filter((i, k, a) => !(k < a.length - 1 && ranks[i] === ranks[a[k + 1]] && X(pts[a[k + 1]][0]) - X(pts[i][0]) < 70));
    const marks = keep.map((i) => { const x = X(pts[i][0]), y = Y(pts[i][1]), anchor = i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle";
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="var(--panel)" stroke="var(--gold)" stroke-width="2"/><text x="${x.toFixed(1)}" y="${(pts[i][1] === worst && i !== 0 && i !== pts.length - 1 ? y + 15 : y - 7).toFixed(1)}" text-anchor="${anchor}">${pts[i][1]}</text>`; }).join("");
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Consensus rank over time: ${ranks[0]} on ${fmtDay(pts[0][0])}, ${ranks[ranks.length - 1]} now, best ${best}, worst ${worst}">
      <path d="${path}" fill="none" stroke="var(--gold)" stroke-width="2.5" stroke-linejoin="round"/>${marks}
      <text x="${padX}" y="${H - 4}">${fmtDay(pts[0][0])}</text><text x="${W - padX}" y="${H - 4}" text-anchor="end">${fmtDay(pts[pts.length - 1][0])}</text></svg>`;
  }

  // College numbers for the cards (draft/prospects.json, built by tools/draft_college.py): loaded on the first card
  let PROS = null, prosWait = null;
  function pros() {
    if (PROS) return Promise.resolve(PROS);
    if (!prosWait) prosWait = fetch("prospects.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((j) => (PROS = j || {}));
    return prosWait;
  }
  const colOf = (p) => (PROS && PROS[D.league === "nfl" ? "nfl" : "nba"] || {})[p.id] || null;
  const ord = (n) => { const v = n % 100; return n + (v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"); };
  const teamName = (ab) => { const t = (D.teams || {})[ab]; return t ? t.city + " " + t.name : ab; };

  // Where he's ranked: every board as a dot on one line from No. 1 down, the consensus as a bar, mocks as diamonds
  function rankStrip(p) {
    const live = liveBoards(), mk = mocks();
    const dots = live.filter((s) => p.ranks[s.id] != null).map((s) => ({ r: +p.ranks[s.id], s }));
    const picks = mk.filter((s) => p.mocks[s.id]).map((s) => ({ r: +p.mocks[s.id][0], s, t: p.mocks[s.id][1] }));
    const all = dots.map((d) => d.r).concat(picks.map((d) => d.r), [+p.rank]);
    const maxR = Math.max(10, Math.ceil((Math.max(...all) + 2) / 5) * 5);
    const x = (r) => (100 * (r - 1) / (maxR - 1)).toFixed(2);
    // one dot per rank; when boards agree, the dot says how many
    const by = {}; dots.forEach((d) => { (by[d.r] = by[d.r] || []).push(d.s.name); });
    const dotHtml = Object.keys(by).map((r) => `<span class="rs-dot" style="left:${x(+r)}%" title="No. ${r}: ${esc(by[r].join(", "))}">${by[r].length > 1 ? `<i>${by[r].length}</i>` : ""}</span>`).join("");
    const mkHtml = picks.map((d) => `<span class="rs-mock" style="left:${x(d.r)}%" title="${esc(d.s.name)}: pick ${d.r}${d.t ? ", " + esc(teamName(d.t)) : ""}"></span>`).join("");
    const strip = `<div class="rs" role="img" aria-label="Board ranks from ${p.hi} to ${p.lo}, consensus ${p.rank}"><div class="rs-line"></div>${mkHtml}${dotHtml}<span class="rs-con" style="left:${x(+p.rank)}%"><b>${p.rank}</b></span><span class="rs-end">No. ${maxR}</span></div>`;
    // the sentence under it
    const n = dots.length, of = live.length;
    let say = n === 0 ? "No board ranks him yet." : p.hi === p.lo ? `No. ${p.hi} on ${n === of ? (n === 1 ? "the one board" : "all " + n + " boards") : n + " of " + of + " boards"}.`
      : `Ranked ${ord(p.hi)} to ${ord(p.lo)} across ${n} of ${of} boards; the consensus puts him ${ord(+p.rank)}.`;
    if (picks.length) {
      const by = {}; picks.forEach((d) => { if (d.t) by[d.t] = (by[d.t] || 0) + 1; });
      const top = Object.keys(by).sort((a, b) => by[b] - by[a])[0];
      const lo = Math.min(...picks.map((d) => d.r)), hi = Math.max(...picks.map((d) => d.r));
      say += picks.length === 1 ? ` ${picks[0].s.name} (${fmtDay(picks[0].s.date)}) has him going ${ord(lo)}${top ? " to " + teamName(top) : ""}.`
        : ` Mocks have him going ${lo === hi ? ord(lo) : ord(lo) + " to " + ord(hi)}${top ? ", most often to " + teamName(top) : ""}.`;
    }
    return strip + `<p class="rs-say">${esc(say)}</p>` + (picks.length || dots.length ? `<p class="rs-key"><span class="k-dot"></span>A board <span class="k-con"></span>Consensus${picks.length ? ' <span class="k-mock"></span>A mock' : ""}</p>` : "");
  }

  // the draft's date, for his age on draft night
  const DRAFT_DAY = { nba: "06-24", nfl: "04-22" };
  function measurables(p, c) {
    const lg = D.league === "nfl" ? "nfl" : "nba";
    const day = Date.parse((D.year || 2027) + "-" + DRAFT_DAY[lg] + "T12:00:00");
    const asof = Date.parse(D.asof || D.updated || Date.now()) || Date.now();
    const age = p.age ? +p.age : null, draftAge = age != null ? age + (day - asof) / (365.25 * 864e5) : null;
    return P().spec([
      ["Height", p.ht || ""], ["Weight", p.wt ? p.wt + " lbs" : ""],
      ["Age", age != null ? `${age.toFixed(1)} <small>(${draftAge.toFixed(1)} on draft night)</small>` : "", true],
      ["Class", p.yr || ""], ["School", (p.school || c && c.team || "") + (c && c.conf ? ` (${c.conf})` : "")],
      ["Hometown", c && c.home || ""], ["Position", p.pos || ""]]);
  }
  const P = () => window.PCard;
  const f1 = (v, d = 1) => (v == null || !isFinite(v) ? "–" : (+v).toFixed(d));

  // the season tables (Stats tab)
  function seasonTables(p, c) {
    if (!c) return (p.stats || []).length ? P().spec(p.stats.map(([l, v, pg]) => [BB.label(l), BB.num(v) + (pg ? ` <small>(${pg} a game)</small>` : ""), true])) : `<p class="note">No college stats on file.</p>`;
    if (c.line) {
      const L = c.line;
      const main = P().sec("Per game", `${c.gp} game${c.gp === 1 ? "" : "s"}, ${esc(c.team || "")}`) + P().table(["MIN", "PTS", "REB", "AST", "STL", "BLK", "TOV", "PF"], [[f1(L.min), f1(L.pts), f1(L.reb), f1(L.ast), f1(L.stl), f1(L.blk), f1(L.tov), f1(L.pf)]], 0);
      const shoot = P().sec("Shooting") + P().table(["", "Made-Att", "Pct"], [["Field goals", f1(L.fgm) + "-" + f1(L.fga), f1(L.fgPct) + "%"], ["Threes", f1(L.tpm) + "-" + f1(L.threeAtt), f1(L.threePct) + "%"], ["Free throws", f1(L.ftm) + "-" + f1(L.fta), f1(L.ftPct) + "%"]]) +
        P().spec([["True shooting", L.ts != null ? f1(L.ts) + "%" : ""], ["Effective FG", L.efg != null ? f1(L.efg) + "%" : ""], ["Game Score", L.gs != null ? f1(L.gs) : ""]]);
      return main + shoot + `<p class="note">${esc(D.year - 1)}-${String(D.year).slice(2)} season from ESPN, through ${fmtDay((PROS.sources || {}).nba || D.asof)}.</p>`;
    }
    if (c.groups) return c.groups.map(([g, cols]) => P().sec(g, g === c.groups[0][0] ? `${c.gp} game${c.gp === 1 ? "" : "s"}, ${esc(c.team || "")}` : "") + P().table(cols.map((x) => x[0]), [cols.map((x) => String(x[1]))], 0)).join("") +
      `<p class="note">${esc(D.year - 1)} season from ESPN, through ${fmtDay((PROS.sources || {}).nfl || D.asof)}.</p>`;
    return `<p class="note">No college stats on file.</p>`;
  }
  // the four numbers under his name
  function headline(p, c) {
    const out = [{ v: "#" + p.rank, l: "Consensus" }, { v: p.on > 1 && p.hi !== p.lo ? `${p.hi}-${p.lo}` : `${p.hi}`, l: p.on > 1 ? "Board range" : "Only board" }];
    if (c && c.line) return out.concat([{ v: f1(c.line.pts), l: "Points" }, { v: f1(c.line.reb), l: "Rebounds" }]);
    if (c && c.groups) {
      const g = c.groups[0], pick = { Passing: ["Yds", "TD"], Rushing: ["Yds", "TD"], Receiving: ["Yds", "TD"], Defense: ["Tkl", "Sacks"] }[g[0]] || [];
      const lab = { Passing: ["Pass yards", "Pass TD"], Rushing: ["Rush yards", "Rush TD"], Receiving: ["Rec yards", "Rec TD"], Defense: ["Tackles", "Sacks"] }[g[0]] || [];
      return out.concat(pick.map((k, i) => { const x = g[1].find((y) => y[0] === k); return x ? { v: String(x[1]), l: lab[i] } : null; }).filter(Boolean));
    }
    return out.concat((p.stats || []).slice(0, 2).map(([l, v]) => ({ v: BB.num(v), l: BB.label(l) })));
  }

  // A prospect's card: Overview (where he's ranked, his profile against his position, recent games, measurables, rank
  // over time), Stats (the season), Boards (each board and mock), Markets (Kalshi, when he's in one)
  function openCard(p) {
    if (!P()) return;
    const dlg = document.getElementById("card");
    if (!PROS) pros().then(() => { if (dlg.open && dlg.dataset.pid === p.id) { const cur = dlg.querySelector('[data-ctab][aria-selected="true"]'); draw(p, cur && cur.dataset.ctab); } });
    draw(p);
    dlg.dataset.pid = p.id;
    if (!dlg.open) dlg.showModal();
  }
  function draw(p, tab) {
    const live = liveBoards(), mk = mocks(), m = move(p), c = colOf(p), lg = D.league === "nfl" ? "ncaaf" : "ncaab";
    let ov = P().sec("Where he's ranked", `${live.length} board${live.length === 1 ? "" : "s"}${mk.length ? ", " + mk.length + " mock" + (mk.length === 1 ? "" : "s") : ""}`) + rankStrip(p);
    if (c && c.prof) ov += P().sec("Profile", "percentile vs " + c.pool) + P().bars(c.prof.map(([label, sub, pct]) => ({ label, sub, pct }))) +
      `<p class="note">Among ${c.poolN} ${esc(c.pool)} with real playing time.${c.small ? " He's short of that so far, so read these as a small sample." : ""}</p>`;
    if (c && c.espn && window.GameLog) ov += GameLog.slot({ league: lg, espn: c.espn, name: p.n, rows: 0 });
    ov += P().sec("Measurables") + measurables(p, c);
    ov += P().sec("Consensus rank over time") + spark(p);
    if (!PROS) ov += `<p class="note">Loading his college numbers…</p>`;
    const st = seasonTables(p, c) + (c && c.espn && window.GameLog ? GameLog.slot({ league: lg, espn: c.espn, name: p.n, n: 15, rows: 15 }) : "");
    const bd = P().table(["Board", "Rank", "As of"], live.map((s) => [s.name + (s.analyst ? " (" + s.analyst.split(" ").slice(-1)[0] + ")" : ""), p.ranks[s.id] != null ? "No. " + p.ranks[s.id] : `Not in his top ${s.count}`, fmtDay(s.date)])
      .concat(mk.map((s) => [s.name, p.mocks[s.id] ? `Pick ${p.mocks[s.id][0]}${p.mocks[s.id][1] ? ", " + teamName(p.mocks[s.id][1]) : ""}` : "Not in the mock", fmtDay(s.date)])));
    const mkt = marketLines(p);
    document.getElementById("cardBody").innerHTML = P().html({ face: BB.who(p, 60), name: p.n, color: "var(--chalk)", team: P().esc(p.school || ""), meta: [p.pos, p.yr, p.ht, p.wt ? p.wt + " lbs" : "", p.age ? "Age " + p.age : ""],
      chips: [m > 0 ? [`Up ${m} since the last update`, "tag"] : m < 0 ? [`Down ${-m} since the last update`, "inj"] : null, p.lo - p.hi >= 15 && p.on > 1 ? ["Boards split on him", ""] : null],
      head: headline(p, c),
      tabs: [{ id: "ov", label: "Overview", html: ov }, { id: "st", label: "Stats", html: st }, { id: "bd", label: "Boards", html: bd }, mkt ? { id: "mk", label: "Markets", html: mkt } : null],
      tab: tab, foot: `<div class="pc-acts"><a href="#${ui.lg}/mock">Mock the draft</a>${c && c.espn ? `<a href="https://www.espn.com/${D.league === "nfl" ? "college-football" : "mens-college-basketball"}/player/_/id/${encodeURIComponent(c.espn)}" target="_blank" rel="noopener">ESPN page</a>` : ""}</div>` });
  }
  document.addEventListener("click", (e) => { const x = e.target.closest("#card [data-close]"); if (x) document.getElementById("card").close(); });

  // Kalshi's player markets that name him, as chances.
  function marketLines(p) {
    const list = ((D.markets || {}).list || []).map((m) => ({ m, o: m.outcomes.find((o) => o.pid === p.id) })).filter((x) => x.o);
    if (!list.length) return "";
    return `<h4>Markets</h4><ul>${list.map(({ m, o }) => `<li><span>${esc(m.title)}</span><span>${Math.round(o.p)}%</span></li>`).join("")}</ul>
      <p class="note">Kalshi, ${fmtDay(D.markets.updated)}. <a href="#${D.league}/markets">All markets</a></p>`;
  }

  // A link from the NBA Hub: ?p=<id> opens that prospect, ?at=<n> marks No. n; both scroll to the row
  let jump = null;
  async function render(lg, q) {
    if (lg !== ui.lg) ui = { lg, q: "", pos: "all", sort: "rank", dir: 1, open: null };
    if (q && (q.p || q.at)) { ui = { lg, q: "", pos: "all", sort: "rank", dir: 1, open: q.p || null }; jump = q; }
    $("#q").value = ui.q;
    try { D = await BB.data(lg); } catch (e) { $("#tbody").innerHTML = `<tr><td class="empty">Couldn't load the board. Try a refresh.</td></tr>`; return; }
    if (!BB.POS[lg].some(([k]) => k === ui.pos)) ui.pos = "all";
    $("#pos").innerHTML = BB.POS[lg].map(([k, l]) => `<button type="button" data-pos="${k}" aria-pressed="${ui.pos === k}">${l}</button>`).join("");
    const live = liveBoards();
    $("#note").textContent = `${D.players.length} players, ${live.length} board${live.length === 1 ? "" : "s"}${live.length < 3 ? " so far" : ""}`;
    sources(); head(); rows();
    if (jump) {
      const j = jump; jump = null;
      const tr = j.p ? document.querySelector(`#tbody tr.p[data-id="${CSS.escape(j.p)}"]`) : [...document.querySelectorAll("#tbody tr.p")].find((r) => r.querySelector(".rk").textContent === String(+j.at));
      if (tr) {
        const row = document.querySelector(`#tbody tr.p[data-id="${CSS.escape(tr.dataset.id)}"]`);
        row.classList.add("hl"); row.scrollIntoView({ block: "center" }); row.focus({ preventScroll: true });
        if (j.p) { const p = D.players.find((x) => x.id === j.p); if (p) openCard(p); }
      }
    }
    $("#stamp").textContent = `Built ${new Date(D.updated).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. Newest board: ${fmtDay(D.asof)}.`;
  }

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#board-view")) return;
    const pos = e.target.closest("[data-pos]");
    if (pos) { ui.pos = pos.dataset.pos; render(ui.lg); return; }
    const so = e.target.closest("[data-sort]");
    if (so) { const k = so.dataset.sort; ui.dir = ui.sort === k ? -ui.dir : 1; ui.sort = k; head(); rows(); return; }
    const tr = e.target.closest("tr.p");
    if (tr && !e.target.closest("a")) { const p = D.players.find((x) => x.id === tr.dataset.id); if (p) openCard(p); }
  });
  document.addEventListener("keydown", (e) => {
    const tr = e.target.closest && e.target.closest("#board-view tr.p");
    if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); tr.click(); }
  });
  document.addEventListener("input", (e) => { if (e.target.id === "q") { ui.q = e.target.value; if (D) rows(); } });
  window.Board = { render };
})();
