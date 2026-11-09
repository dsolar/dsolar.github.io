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
    $("#sources").innerHTML = out.map((s) => {
      const who = s.analyst ? `${s.name}, ${s.analyst.split(" ").slice(-1)[0]}` : s.name;
      return `<a class="src${s.kind === "mock" ? " mock" : ""}" href="${esc(s.link || s.url)}" target="_blank" rel="noopener" title="${esc(s.note || s.title || s.name)}">
        <b>${esc(s.abbr)}</b><span class="who">${esc(who)}</span>
        <span class="when"><span>${fmtDay(s.date)}</span><span>${s.kind === "mock" ? `${s.count} picks` : `Top ${s.count}`}</span></span>
        ${s.kind === "board" ? `<span class="w" aria-hidden="true"><i style="width:${Math.round(100 * (s.w || 0) / maxW)}%"></i></span>` : ""}</a>`;
    }).join("") + (waiting.length ? `<div class="src pending" title="${esc(waiting.map((s) => s.analyst ? `${s.name} (${s.analyst})` : s.name).join(", "))}">
        <b>Not out yet</b><span class="who wrap">${esc(waiting.map((s) => s.abbr).join(" · "))}</span>
        <span class="when"><span>Joins when out</span></span></div>` : "");
    $("#srcList").innerHTML = D.sources.map((s) => `<li><a href="${esc(s.link || s.url)}" target="_blank" rel="noopener">${esc(s.name)}${s.analyst ? ` (${esc(s.analyst)})` : ""}</a>: ${s.date ? `${s.kind === "mock" ? "mock draft" : `top ${s.count}`}, ${fmtDay(s.date)}${s.versions > 1 ? `, ${s.versions} readings` : ""}` : "not out for this class yet"}${s.kind === "mock" ? ". Shown, not counted" : ""}</li>`).join("")
      + (Object.keys(D.excluded || {}).length ? `<li>Left out on purpose: WalterFootball. PFF and The Athletic only if pasted from a subscription.</li>` : "")
      + `<li>Size, age and stats: <a href="${D.league === "nba" ? "https://www.tankathon.com/big_board" : "https://www.tankathon.com/nfl/big_board"}" target="_blank" rel="noopener">Tankathon</a>, every morning.</li>`;
  }

  function head() {
    const live = liveBoards(), mk = mocks();
    const th = (k, label, cls = "", title = "") => `<th class="${cls}"${ui.sort === k ? ` aria-sort="${ui.dir > 0 ? "ascending" : "descending"}"` : ""}${title ? ` title="${esc(title)}"` : ""}><button type="button" data-sort="${k}">${label}</button></th>`;
    const prev = D.dates.length > 1 ? fmtDay(D.dates[D.dates.length - 2]) : "";
    $("#thead").innerHTML = `<tr>${th("rank", "#", "r")}${th("move", "Move", "", prev ? `Spots since ${prev}` : "")}${th("name", "Player")}
      ${hasStats() ? `<th class="hide-m">${D.league === "nba" ? "This season" : "2026 season"}</th>` : ""}${th("score", "Avg", "r hide-s", "Weighted average rank")}
      ${live.map((s) => th("s:" + s.id, esc(s.abbr), "r col-src", `${s.name}${s.analyst ? `, ${s.analyst}` : ""}, ${fmtDay(s.date)}`)).join("")}
      ${live.length > 1 ? `${th("spread", "Range", "rng", "Best and worst rank across the boards")}` : ""}${mk.length ? th("mock", "Mock", "hide-s", mk.map((m) => `${m.name}, ${fmtDay(m.date)}`).join("; ")) : ""}</tr>`;
  }

  function cols() { return 4 + (hasStats() ? 1 : 0) + liveBoards().length + (liveBoards().length > 1 ? 1 : 0) + (mocks().length ? 1 : 0); }

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
      return p[ui.sort];
    };
    ps = ps.slice().sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : a.rank - b.rank) * ui.dir; });
    const spreads = D.players.slice(0, 60).map((p) => p.lo - p.hi).sort((a, b) => b - a);
    const hotCut = spreads[Math.min(5, spreads.length - 1)] || 99;
    const maxR = Math.max(60, ...ps.slice(0, 100).map((p) => p.lo));
    const n = live.length, st = hasStats();
    if (!ps.length) { $("#tbody").innerHTML = `<tr><td class="empty" colspan="${cols()}">No one matches that.</td></tr>`; return; }
    $("#tbody").innerHTML = ps.slice(0, 250).map((p) => {
      const m = move(p);
      const mvTxt = m == null ? `<span class="mv flat" title="New this update">new</span>` : m > 0 ? `<span class="mv up">&#9650;${m}</span>` : m < 0 ? `<span class="mv down">&#9660;${-m}</span>` : `<span class="mv flat">&ndash;</span>`;
      const spread = p.lo - p.hi;
      const pct = (r) => (100 * (Math.min(r, maxR) - 1) / (maxR - 1)).toFixed(1);
      const mockCell = mk.map((s) => p.mocks[s.id]).find(Boolean);
      const open = ui.open === p.id;
      return `<tr class="p${open ? " open" : ""}" data-id="${esc(p.id)}" tabindex="0" aria-expanded="${open}">
        <td class="rk r">${p.rank}</td><td>${mvTxt}</td>
        <td><div class="who-cell">${BB.who(p)}<div class="nm">${esc(p.n)}<small>${esc([p.pos, p.school].filter(Boolean).join(", "))}</small></div></div></td>
        ${st ? `<td class="stl hide-m">${BB.statLine(p) || `<span class="faint">&ndash;</span>`}</td>` : ""}
        <td class="r sc hide-s">${p.score.toFixed(1)}</td>
        ${live.map((s) => p.ranks[s.id] != null ? `<td class="r cell col-src">${p.ranks[s.id]}</td>` : `<td class="r cell miss col-src" title="Not on this board">&ndash;</td>`).join("")}
        ${n > 1 ? `<td class="rng"><span${spread >= hotCut && p.on > 1 ? ` class="hot"` : ""}>${p.on > 1 ? `${p.hi}&ndash;${p.lo}` : `${p.hi} only`}</span>
          <div class="bar" aria-hidden="true"><i style="left:${pct(p.hi)}%;right:${(100 - pct(p.lo)).toFixed(1)}%"></i><b style="left:${pct(p.rank)}%"></b></div></td>` : ""}
        ${mk.length ? `<td class="mk hide-s">${mockCell ? `<span class="mk-pick"${mockCell[1] && D.teams[mockCell[1]] ? ` title="No. ${mockCell[0]} to ${esc(D.teams[mockCell[1]].city)}"` : ""}>${mockCell[0]}${mockCell[1] && D.teams[mockCell[1]] ? BB.logo(D, mockCell[1], 20) : mockCell[1] ? ` ${esc(mockCell[1])}` : ""}</span>` : "&ndash;"}</td>` : ""}
      </tr>${open ? detail(p) : ""}`;
    }).join("");
  }

  function spark(p) {
    const pts = D.dates.map((d, i) => [d, p.hist[i]]).filter((x) => x[1] != null);
    if (pts.length < 2) return `<p class="note">One reading so far. The line fills in as boards update.</p>`;
    const W = 420, H = 96, pad = 22;
    const lo = Math.max(...pts.map((x) => x[1])), hi = Math.min(...pts.map((x) => x[1]));
    const top = Math.max(1, hi - 2), bot = lo + 2;
    const t0 = Date.parse(pts[0][0]), t1 = Date.parse(pts[pts.length - 1][0]);
    const X = (d) => pad + (W - 2 * pad) * (t1 === t0 ? 0 : (Date.parse(d) - t0) / (t1 - t0));
    const Y = (r) => 20 + (H - 46) * (r - top) / Math.max(1, bot - top);
    const path = pts.map((x, i) => `${i ? "L" : "M"}${X(x[0]).toFixed(1)},${Y(x[1]).toFixed(1)}`).join("");
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Consensus rank over time">
      <path d="${path}" fill="none" stroke="var(--gold)" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
      ${pts.map((x) => `<circle cx="${X(x[0]).toFixed(1)}" cy="${Y(x[1]).toFixed(1)}" r="3.5" fill="var(--stage)" stroke="var(--gold)" stroke-width="2"/><text x="${X(x[0]).toFixed(1)}" y="${(Y(x[1]) - 8).toFixed(1)}" text-anchor="middle">${x[1]}</text>`).join("")}
      <text x="${pad}" y="${H - 4}">${fmtDay(pts[0][0])}</text><text x="${W - pad}" y="${H - 4}" text-anchor="end">${fmtDay(pts[pts.length - 1][0])}</text></svg>`;
  }

  function profile(p) {
    const bits = [p.ht, p.wt ? `${p.wt} lbs` : "", p.yr, p.age ? `${p.age} yrs` : ""].filter(Boolean);
    const stats = (p.stats || []).map(([l, v, per]) => `<div class="stat"><b>${BB.num(v)}</b><span>${esc(BB.label(l))}${per ? ` <em>${esc(per)}/g</em>` : ""}</span></div>`).join("");
    return `${bits.length ? `<p class="bio">${esc(bits.join(" · "))}</p>` : ""}
      ${stats ? `<div class="stats">${stats}</div>` : `<p class="note">${D.league === "nba" ? "No games yet this season." : "No stats on file."}</p>`}`;
  }

  function detail(p) {
    const live = liveBoards(), mk = mocks();
    return `<tr class="detail"><td colspan="${cols()}"><div class="det">
      <div><h4>${D.league === "nba" ? "This season" : "2026 season"}</h4>${profile(p)}<h4>Consensus rank over time</h4>${spark(p)}</div>
      <div><h4>Board by board</h4><ul>${live.map((s) => `<li class="${p.ranks[s.id] == null ? "miss" : ""}"><span>${esc(s.name)}${s.analyst ? ` <span class="note">(${esc(s.analyst.split(" ").slice(-1)[0])})</span>` : ""}</span><span>${p.ranks[s.id] ?? `not in top ${s.count}`}</span></li>`).join("")}
        ${mk.map((s) => `<li class="${p.mocks[s.id] ? "" : "miss"}"><span>${esc(s.name)}</span><span>${p.mocks[s.id] ? `pick ${p.mocks[s.id][0]}${p.mocks[s.id][1] ? `, ${esc(p.mocks[s.id][1])}` : ""}` : "not in mock"}</span></li>`).join("")}</ul>
        ${marketLines(p)}</div>
    </div></td></tr>`;
  }

  // Kalshi's player markets that name him, as chances.
  function marketLines(p) {
    const list = ((D.markets || {}).list || []).map((m) => ({ m, o: m.outcomes.find((o) => o.pid === p.id) })).filter((x) => x.o);
    if (!list.length) return "";
    return `<h4>Markets</h4><ul>${list.map(({ m, o }) => `<li><span>${esc(m.title)}</span><span>${Math.round(o.p)}%</span></li>`).join("")}</ul>
      <p class="note">Kalshi, ${fmtDay(D.markets.updated)}. <a href="#${D.league}/markets">All markets</a></p>`;
  }

  async function render(lg) {
    if (lg !== ui.lg) ui = { lg, q: "", pos: "all", sort: "rank", dir: 1, open: null };
    $("#q").value = ui.q;
    try { D = await BB.data(lg); } catch (e) { $("#tbody").innerHTML = `<tr><td class="empty">Couldn't load the board. Try a refresh.</td></tr>`; return; }
    if (!BB.POS[lg].some(([k]) => k === ui.pos)) ui.pos = "all";
    $("#pos").innerHTML = BB.POS[lg].map(([k, l]) => `<button type="button" data-pos="${k}" aria-pressed="${ui.pos === k}">${l}</button>`).join("");
    const live = liveBoards();
    $("#note").textContent = live.length < 3
      ? `${live.length} board${live.length === 1 ? "" : "s"} so far. ${D.sources.filter((s) => !s.date).map((s) => s.analyst || s.name).join(", ")} join as they publish for this class.`
      : `${D.players.length} players across ${live.length} boards. Tap a player for his stats and line.`;
    sources(); head(); rows();
    $("#stamp").textContent = `Built ${new Date(D.updated).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. Newest board: ${fmtDay(D.asof)}.`;
  }

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#board-view")) return;
    const pos = e.target.closest("[data-pos]");
    if (pos) { ui.pos = pos.dataset.pos; render(ui.lg); return; }
    const so = e.target.closest("[data-sort]");
    if (so) { const k = so.dataset.sort; ui.dir = ui.sort === k ? -ui.dir : 1; ui.sort = k; head(); rows(); return; }
    const tr = e.target.closest("tr.p");
    if (tr && !e.target.closest("a")) { ui.open = ui.open === tr.dataset.id ? null : tr.dataset.id; rows(); }
  });
  document.addEventListener("keydown", (e) => {
    const tr = e.target.closest && e.target.closest("#board-view tr.p");
    if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); tr.click(); }
  });
  document.addEventListener("input", (e) => { if (e.target.id === "q") { ui.q = e.target.value; if (D) rows(); } });
  window.Board = { render };
})();
