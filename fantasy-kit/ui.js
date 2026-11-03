/* Fantasy Kit: the browser side. Load after sports.js, value.js and draft.js, with kit.css on the page.

   FK.ui gives a league page:
     helpers     esc, $, $$, store(ns), toast, dialog, confirm, theme, fmtLeft, money, ord, ago
     identity    teamAv, playerAv, pname, teamName, posChip(s)
     shell       masthead, section tabs, page tabs, league switcher
     tables      sortable tables from column definitions, player columns per sport, position chips
     modules     scoreboard, versus (matchup hero), vsTable (side-by-side lineups), standingsTable, feed, txLine,
                 tradeCard, tradeWindow, playerCard. They take plain view models, so any league engine can use them.
     room        the full draft room on top of FK.draft (FK.ui.room)
   Nothing here saves anything: the page decides where a league lives. */
(function (root) {
  "use strict";
  const FK = root.FK, S = FK.sports, F = FK.draft;

  /* ---------- helpers ---------- */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  function store(ns) {
    return {
      get(k, d) { try { const v = localStorage.getItem(ns + ":" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
      set(k, v) { try { if (v == null) localStorage.removeItem(ns + ":" + k); else localStorage.setItem(ns + ":" + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    };
  }
  let toastT = null;
  function toast(msg, bad) {
    let el = $("#fk-toast");
    if (!el) { el = document.createElement("div"); el.id = "fk-toast"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite"); document.body.appendChild(el); }
    el.textContent = msg; el.className = "toast" + (bad ? " bad" : ""); el.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 3400);
  }
  // A modal with a close button. onSubmit(formData, form) runs for a <form>; return false to keep it open.
  function dialog(html, onSubmit, opts = {}) {
    let D = $("#fk-dlg");
    if (!D) { D = document.createElement("dialog"); D.id = "fk-dlg"; document.body.appendChild(D); D.addEventListener("close", () => { const f = D.onclosed; D.onclosed = null; if (f) f(); }); }
    D.className = "fk-dlg" + (opts.wide ? " wide" : "") + (opts.full ? " full" : "") + (opts.dark ? " fk-dark" : "");
    D.oninput = D.onchange = D.onclick = null;
    D.innerHTML = `<button type="button" class="dlg-x" data-close aria-label="Close">&times;</button>` + html;
    D.onclosed = opts.onClose || null;
    $$("[data-close]", D).forEach((b) => b.addEventListener("click", () => D.close()));
    const f = $("form", D);
    if (f && onSubmit) f.addEventListener("submit", (e) => {
      e.preventDefault();
      const keep = onSubmit(new FormData(f), f, e.submitter);
      if (keep !== false) D.close();
    });
    if (!D.open) D.showModal();
    return D;
  }
  const dialogOpen = () => { const D = $("#fk-dlg"); return !!(D && D.open); };
  function confirm(title, body, yes, onYes) {
    dialog(`<h3>${esc(title)}</h3><p class="muted" style="margin:0">${body}</p><form><div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn go">${esc(yes)}</button></div></form>`, () => { onYes(); });
  }
  function theme(ns) {
    const st = store(ns);
    const apply = (t) => { if (t === "dark") document.documentElement.dataset.theme = "dark"; else delete document.documentElement.dataset.theme; };
    apply(st.get("theme", ""));
    return { dark: () => document.documentElement.dataset.theme === "dark", toggle() { const t = this.dark() ? "light" : "dark"; st.set("theme", t); apply(t); return t; } };
  }
  const fmtLeft = (ms) => {
    if (!Number.isFinite(ms)) return "";
    const left = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), x = left % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
  };
  const money = (n) => "$" + Math.round(n || 0);
  const ord = (n) => n + (["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10] || "th");
  const last = (n) => { const parts = String(n).split(" "); const s = parts.pop(); return /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(s) && parts.length ? parts.pop() + " " + s : s; };
  const initials = (n) => { const w = String(n).replace(/[^A-Za-z0-9 .'-]/g, "").split(/\s+/).filter((x) => x && !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(x)); return ((w[0] || "?")[0] + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase(); };
  const ago = (t, now = Date.now()) => {
    const d = now - t;
    if (d < 6e4) return "Just now";
    if (d < 36e5) return Math.floor(d / 6e4) + "m ago";
    if (d < 864e5) return Math.floor(d / 36e5) + "h ago";
    return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  /* ---------- identity ---------- */
  const teamAv = (t, size = "") => `<span class="av c${((t && t.color) || 0) % 12}${size ? " " + size : ""}" aria-hidden="true">${esc(String((t && t.abbr) || "?").slice(0, 3))}</span>`;
  const posChip = (sport, pos) => `<span class="pp c${(sport.colors && sport.colors[pos]) || 6}">${esc(pos)}</span>`;
  const posChips = (sport, p) => S.positions(p).map((x) => posChip(sport, x)).join("");
  const colorOf = (sport, p) => (sport.colors && sport.colors[FK.value.mainPos(sport, p)]) || 6;
  const playerAv = (sport, p, size = "") => `<span class="pav c${colorOf(sport, p)}${size ? " " + size : ""}" aria-hidden="true">${esc(initials(p.n))}</span>`;
  const injTag = (p) => (p && p.inj ? ` <span class="tag inj" title="${esc(p.inj)}">${esc(String(p.inj).replace(/^day.*/i, "DTD").replace(/^questionable/i, "Q").slice(0, 3).toUpperCase())}</span>` : "");
  // Avatar, name and a small line (positions and team) for any player.
  const pname = (sport, p, extra = "", opts = {}) => p ? `<span class="pname${opts.b ? " b" : ""}">${opts.noAv ? "" : playerAv(sport, p, opts.size || "")}<span><span class="pn">${esc(p.n)}${injTag(p)}</span><span class="sub">${S.positions(p).join(", ")} ${esc(p.t)}${extra ? ", " + extra : ""}</span></span></span>` : `<span class="ps">Empty</span>`;
  const teamName = (t, opts = {}) => `<span class="row" style="gap:9px">${teamAv(t, opts.size || "sm")}<span class="ell"><b>${esc(t.name)}</b>${opts.you ? ` <span class="tag you">You</span>` : ""}${opts.owner !== false && t.owner ? ` <span class="ps">${esc(t.owner)}</span>` : ""}</span></span>`;

  /* ---------- shell ---------- */
  // opts: { brand: { name, href, mark }, title (html beside the brand), tabs: [[key, label, badge]], tab,
  //         subs: [[key, label, badge]], sub, hrefOf(tab, sub), right (html) }
  function shell(opts) {
    const href = opts.hrefOf || ((t, s) => "#" + t + (s ? "/" + s : ""));
    const badge = (n) => (n ? `<span class="badge">${n}</span>` : "");
    return `<div class="fk-mast fk-band"><div class="wrap">
        <a class="fk-brand" href="${esc(opts.brand.href || "./")}">${opts.brand.mark || ""}<b class="disp">${esc(opts.brand.name)}</b></a>
        ${opts.title || ""}<span class="grow"></span><div class="fk-who">${opts.right || ""}</div></div></div>
      ${opts.tabs && opts.tabs.length ? `<div class="fk-nav"><div class="wrap"><nav aria-label="Sections">${opts.tabs.map(([k, n, b]) => `<a href="${href(k)}"${k === opts.tab ? ' aria-current="page"' : ""}>${esc(n)}${badge(b)}</a>`).join("")}</nav></div></div>` : ""}
      ${opts.subs && opts.subs.length ? `<nav class="fk-subs" aria-label="Pages"><div class="wrap">${opts.subs.map(([k, n, b]) => `<a href="${href(opts.tab, k)}"${k === opts.sub ? ' aria-current="page"' : ""}>${esc(n)}${badge(b)}</a>`).join("")}</div></nav>` : ""}`;
  }
  // A league switcher: current league with its avatar, a menu of leagues and extra menu items.
  const switcher = (cur, items, extra = "") => `<details class="switch"><summary>${teamAv(cur, "sm")}<span class="ell">${esc(cur.name)}</span><span class="chev" aria-hidden="true"></span></summary>
    <div class="menu" role="menu">${items.map((x) => `<a role="menuitem" href="${esc(x.href)}">${x.av ? teamAv(x.av, "sm") : ""}<span>${esc(x.name)}${x.sub ? `<small>${esc(x.sub)}</small>` : ""}</span></a>`).join("")}${extra ? `${items.length ? "<hr>" : ""}${extra}` : ""}</div></details>`;
  const route = (def) => { const h = location.hash.replace(/^#/, "").split("/").map(decodeURIComponent); return { tab: h[0] || def, sub: h[1] || "", arg: h[2] || "" }; };

  /* ---------- tables ---------- */
  // cols: [{ k, label, title, cls ("r"), hide ("s" hides on phones), td, sort (row => value), asc, html (row => cell) }]
  function sortRows(rows, cols, sort) {
    const c = cols.find((x) => x.k === sort.k && x.sort);
    if (!c) return rows;
    return rows.slice().sort((a, b) => {
      const x = c.sort(a), y = c.sort(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * sort.dir;
    });
  }
  function table(opts) {
    const { cols, sort = {} } = opts;
    const th = (c) => {
      const cls = [c.cls || "", c.hide ? "hide-" + c.hide : "", c.sort ? "sortable" : "", c.sort && sort.k === c.k ? "on" : ""].join(" ").trim();
      const aria = c.sort ? ` aria-sort="${sort.k === c.k ? (sort.dir > 0 ? "ascending" : "descending") : "none"}" data-sort="${esc(c.k)}" tabindex="0"` : "";
      return `<th class="${cls}"${aria}${c.title ? ` title="${esc(c.title)}"` : ""}>${esc(c.label)}</th>`;
    };
    const rows = opts.rows.slice(0, opts.limit || 400);
    return `<div class="table-wrap"${opts.id ? ` id="${esc(opts.id)}"` : ""}${opts.style ? ` style="${opts.style}"` : ""}><table class="t${opts.dense ? " dense" : ""}${opts.cls ? " " + opts.cls : ""}"><thead><tr>${cols.map(th).join("")}</tr></thead><tbody>
      ${rows.map((r) => (r && r.__html) || `<tr${opts.rowAttr ? " " + opts.rowAttr(r) : ""}>${cols.map((c) => `<td class="${[c.cls || "", c.hide ? "hide-" + c.hide : "", c.td || ""].join(" ").trim()}">${c.html(r)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${cols.length}" class="empty">${esc(opts.empty || "Nothing here.")}</td></tr>`}
      </tbody></table></div>`;
  }
  function nextSort(sort, k, cols) {
    if (sort.k === k) return { k, dir: -sort.dir };
    const c = cols.find((x) => x.k === k);
    return { k, dir: c && c.asc ? 1 : -1 };
  }

  /* ---------- players ---------- */
  function statCell(sport, p, c) {
    if (c.fpts) return p.fpts;
    if (c.fpg) return p.fpg;
    if (c.ratio) { const n = S.stat(sport, p, c.line, c.ratio[0]), d = S.stat(sport, p, c.line, c.ratio[1]); return d ? n / d : null; }
    return S.stat(sport, p, c.line, c.col);
  }
  const isPoints = (sport, scoring) => (sport.scorings[scoring] || Object.values(sport.scorings)[0]).type === "points";
  // Columns for a player table. opts: { group (one baseball side), money (false to hide $), scoring, owner (p => html),
  // actions (p => html), lead (columns first), stats (false to skip), extra (columns before the stats), age }
  function poolColumns(sport, opts = {}) {
    const pts = isPoints(sport, opts.scoring);
    const cols = [
      { k: "rank", label: "Rk", cls: "r num", title: "Overall rank by value over replacement", sort: (p) => p.rank, asc: true, html: (p) => `<span class="ps">${p.rank}</span>` },
      { k: "name", label: "Player", td: "nm", sort: (p) => p.n, asc: true, html: (p) => pname(sport, p) },
      { k: "prank", label: "Pos rk", cls: "r ps", hide: "s", title: "Rank at his position", sort: (p) => parseInt(String(p.prank).replace(/\D+/g, ""), 10), asc: true, html: (p) => esc(p.prank) },
    ];
    if (opts.age !== false && sport.hasAge) cols.push({ k: "age", label: "Age", cls: "r num", hide: "s", sort: (p) => p.age, asc: true, html: (p) => (p.age ? p.age : "") });
    if (opts.owner) cols.push({ k: "owner", label: "Status", cls: "", sort: opts.ownerSort, html: opts.owner });
    if (opts.money !== false) cols.push({ k: "$", label: "$", cls: "r num", title: "Auction value in this league", sort: (p) => p.$, html: (p) => (p.$ ? `<span class="dollar">${money(p.$)}</span>` : `<span class="ps">-</span>`) });
    cols.push({ k: "v", label: pts ? "Proj" : "Value", cls: "r num", title: pts ? "Projected season fantasy points" : "Summed category z-scores", sort: (p) => p.v, html: (p) => `<b>${p.v == null ? "-" : p.v.toFixed(pts ? 0 : 1)}</b>` });
    for (const c of opts.extra || []) cols.push(c);
    if (opts.stats !== false) for (const [i, c] of sport.columns.entries()) {
      if (opts.group && c.group && c.group !== opts.group) continue;
      cols.push({ k: "s" + i, label: c.label, title: c.title, cls: "r num", hide: c.hide, sort: (p) => statCell(sport, p, c), html: (p) => { const v = statCell(sport, p, c); return v == null ? `<span class="ps">-</span>` : c.fmt(v); } });
    }
    if (opts.actions) cols.push({ k: "act", label: "", cls: "r act", html: opts.actions });
    return (opts.lead || []).concat(cols);
  }
  // Position chips across the top of a player list; groups (Hitters, Pitchers) when the sport has them.
  function posFilter(sport, cur, extra = []) {
    const groups = sport.groups ? [["g:bat", "Hitters"], ["g:pit", "Pitchers"]] : [];
    const all = [["", "All"]].concat(groups, sport.positions.filter((x) => x !== "UT").map((x) => [x, x]), extra);
    return `<div class="chips" role="group" aria-label="Positions">${all.map(([v, l]) => `<button type="button" data-fpos="${esc(v)}" aria-pressed="${v === (cur || "")}">${esc(l)}</button>`).join("")}</div>`;
  }
  const search = (st, ph = "Search players") => `<label class="sr" for="fk-q">${esc(ph)}</label><input type="search" id="fk-q" placeholder="${esc(ph)}" value="${esc(st.q || "")}" autocomplete="off">`;
  function passes(sport, p, st) {
    if (st.q) { const q = st.q.trim().toLowerCase(); if (q && !p.n.toLowerCase().includes(q) && String(p.t).toLowerCase() !== q) return false; }
    if (st.pos) {
      if (st.pos.startsWith("g:")) { const g = sport.groups[st.pos.slice(2)]; if (!S.positions(p).some((x) => g.includes(x))) return false; }
      else if (!S.positions(p).includes(st.pos)) return false;
    }
    if (st.team && p.t !== st.team) return false;
    return true;
  }
  const groupOf = (sport, st) => (st.pos && sport.groups ? (st.pos.startsWith("g:") ? st.pos.slice(2) : Object.keys(sport.groups).find((g) => sport.groups[g].includes(st.pos))) : null);

  const LABELS = { gp: "GP", g: "G", gs: "GS", min: "MIN", fgm: "FGM", fga: "FGA", ftm: "FTM", fta: "FTA", tpm: "3PM", pts: "PTS", reb: "REB", ast: "AST", stl: "STL", blk: "BLK", tov: "TO",
    pa: "PA", ab: "AB", r: "R", h: "H", hr: "HR", rbi: "RBI", sb: "SB", tb: "TB", bb: "BB", avg: "AVG", obp: "OBP", ops: "OPS", ip: "IP", w: "W", l: "L", sv: "SV", hld: "HLD", k: "K", er: "ER", era: "ERA", whip: "WHIP", qs: "QS",
    pass_yd: "Pass yd", pass_td: "Pass TD", pass_int: "INT", rush_att: "Rush", rush_yd: "Rush yd", rush_td: "Rush TD", rec: "Rec", rec_tgt: "Targets", rec_yd: "Rec yd", rec_td: "Rec TD", fum_lost: "Fum",
    fgm_: "FGM", xpm: "XPM", def_td: "Def TD", def_int: "Def INT", def_sack: "Sacks", pts_allow: "Pts allowed", pts_std: "Std pts", pts_half_ppr: "Half PPR", pts_ppr: "PPR" };
  const label = (c) => LABELS[c] || c.toUpperCase();
  // The player card. opts: { actions (html), note (html), scoring, status (html) }
  function playerCard(sport, p, opts = {}) {
    const sc = sport.scorings[opts.scoring] || Object.values(sport.scorings)[0];
    const kd = S.positions(p).some((x) => x === "K" || x === "DEF");
    const lines = Object.entries(sport.data.lines || {}).filter(([k]) => p.l[k]).map(([k, def]) => {
      const cells = def.cols.filter((c) => c !== "eg").map((c) => {
        const v = S.stat(sport, p, k, c);
        if (v == null || (sport.key === "nfl" && v === 0 && (kd ? /^(pass|rush|rec|fum)/.test(c) : /^(fg|xpm|def_|pts_allow)/.test(c)))) return "";
        const f = /^(avg|obp|ops|slg)$/.test(c) ? S.fmt.r3 : /^(era|whip)$/.test(c) ? S.fmt.f2 : Number.isInteger(v) || Math.abs(v) >= 100 ? S.fmt.f0 : S.fmt.f1;
        return `<span><small>${esc(label(c))}</small><b>${f(v)}</b></span>`;
      }).join("");
      return `<div class="stack" style="gap:6px"><div class="ps"><b>${esc(def.label)}</b>, ${esc(sport.data.season)}</div><div class="sgrid">${cells}</div></div>`;
    }).join("");
    const zs = sc.type === "cats" && p.zc ? `<div class="zbars" aria-label="Category strength">${sc.cats.filter((c) => p.zc[c.k] != null).map((c) => { const z = Math.max(-3, Math.min(3, p.zc[c.k])); const w = (Math.abs(z) / 3) * 50; return `<span class="ps"><b>${esc(c.label)}</b></span><span class="zbar"><i class="${z < 0 ? "n" : ""}" style="${z < 0 ? `right:50%;width:${w}%` : `left:50%;width:${w}%`}"></i></span><span class="num ps" style="text-align:right">${z >= 0 ? "+" : ""}${z.toFixed(1)}</span>`; }).join("")}</div>` : "";
    return `<div class="pc-h">${playerAv(sport, p, "lg")}<div><h3 class="disp">${esc(p.n)}</h3><div class="ps">${posChips(sport, p)} ${esc(p.t)}${p.age ? `, age ${p.age}` : ""}${p.inj ? `, <span class="bad">${esc(p.inj)}</span>` : ""}</div>${opts.status ? `<div class="ps row" style="margin-top:6px">${opts.status}</div>` : ""}</div></div>
      <div class="stat-row" style="margin-bottom:14px"><div><small>Overall</small><b>${p.rank}</b></div><div><small>Position</small><b>${esc(p.prank)}</b></div><div><small>${sc.type === "points" ? "Projection" : "Value"}</small><b>${sc.type === "points" ? Math.round(p.v) : p.v.toFixed(1)}</b></div><div><small>Auction</small><b>${p.$ ? money(p.$) : "-"}</b></div></div>
      ${opts.note ? `<p class="small" style="margin:0 0 12px">${opts.note}</p>` : ""}
      <div class="stack">${zs}${lines}</div>${opts.actions ? `<div class="acts">${opts.actions}</div>` : ""}`;
  }

  /* ---------- league modules (view models in, HTML out) ---------- */
  // games: [{ href, me, status: "final" | "live" | "proj", label, sub, a: { team, score, rec }, b }]
  function scoreboard(games, fmt = (x) => x) {
    return `<div class="scoreboard" role="list">${games.map((g) => {
      const lead = g.a.score === g.b.score ? null : g.a.score > g.b.score ? "a" : "b";
      const ln = (s, k) => `<div class="ln ${lead ? (lead === k ? "lead" : "trail") : ""}">${teamAv(s.team, "sm")}<span class="ell">${esc(s.team.name)}</span><small>${esc(s.rec || "")}</small><b>${fmt(s.score)}</b></div>`;
      return `<a class="game${g.me ? " me" : ""}" role="listitem" href="${esc(g.href || "#")}"><div class="st"><span class="${g.status === "live" ? "live" : ""}">${esc(g.label || (g.status === "final" ? "Final" : g.status === "live" ? "Live" : "Projected"))}</span>${g.sub ? `<span>${esc(g.sub)}</span>` : ""}</div>${ln(g.a, "a")}${ln(g.b, "b")}</a>`;
    }).join("")}</div>`;
  }
  // The matchup hero. vm: { a: { team, rec, score, proj }, b, wp (0..1 for a), status, live, cats: [{ label, fa, fb, d }], fmt }
  function versus(vm) {
    const lead = vm.a.score === vm.b.score ? null : vm.a.score > vm.b.score ? "a" : "b";
    const fmt = vm.fmt || ((x) => x);
    const side = (s, k) => `<div class="side ${k}${lead ? (lead === k ? " lead" : " trail") : ""}">${teamAv(s.team, "lg")}<div><span class="nm">${esc(s.team.name)}</span><span class="rec">${esc(s.rec || "")}${s.team.owner ? `, ${esc(s.team.owner)}` : ""}</span><span class="score">${fmt(s.score)}</span>${s.proj != null ? `<span class="proj">Projected ${fmt(s.proj)}</span>` : ""}</div></div>`;
    const wp = vm.wp != null ? `<div class="wp"><div class="wp-bar" role="img" aria-label="Win probability ${Math.round(vm.wp * 100)} to ${Math.round((1 - vm.wp) * 100)}"><i style="width:${(vm.wp * 100).toFixed(1)}%;background:var(--t${vm.a.team.color % 12})"></i><i style="width:${((1 - vm.wp) * 100).toFixed(1)}%;background:var(--t${vm.b.team.color % 12})"></i></div><div class="wp-l"><span>${Math.round(vm.wp * 100)}%</span><span>Win probability</span><span>${Math.round((1 - vm.wp) * 100)}%</span></div></div>` : "";
    const cats = vm.cats && vm.cats.length ? `<div class="catgrid" style="--nc:${vm.cats.length};--nc2:${Math.ceil(vm.cats.length / 2)}">${vm.cats.map((c) => `<div><small>${esc(c.label)}</small><b class="${c.d > 0 ? "w" : ""}">${c.fa}</b><b class="${c.d < 0 ? "w" : ""}">${c.fb}</b></div>`).join("")}</div>` : "";
    return `<div class="versus">${side(vm.a, "a")}<div class="mid">${vm.status ? `<span class="pill${vm.live ? " live" : ""}">${esc(vm.status)}</span>` : ""}<span>vs</span></div>${side(vm.b, "b")}</div>${wp}${cats}`;
  }
  // Side-by-side lineups. rows: [{ slot, a: { p, pts, proj, w }, b: { ... } }], totals: { a, b }
  function vsTable(sport, rows, totals, fmt = (x) => (x == null ? "-" : x.toFixed(1))) {
    const cell = (x) => (x && x.p ? `${x.pts != null ? fmt(x.pts) : ""}${x.proj != null ? `<small>${fmt(x.proj)} proj</small>` : ""}` : "");
    return `<div class="table-wrap"><table class="t vs"><tbody>${rows.map((r) => `<tr><td class="nm">${r.a.p ? `<span data-player="${esc(r.a.p.id)}" style="cursor:pointer">${pname(sport, r.a.p)}</span>` : `<span class="ps">Empty</span>`}</td><td class="pa ${r.a.w ? "w" : ""}">${cell(r.a)}</td><td class="sl"><span class="slot">${esc(r.slot)}</span></td><td class="pb ${r.b.w ? "w" : ""}">${cell(r.b)}</td><td class="nm">${r.b.p ? `<span data-player="${esc(r.b.p.id)}" style="cursor:pointer;display:flex;justify-content:flex-end">${pname(sport, r.b.p, "", { b: true })}</span>` : `<span class="ps" style="float:right">Empty</span>`}</td></tr>`).join("")}
      ${totals ? `<tr class="tot"><td>Total</td><td class="pa">${fmt(totals.a)}</td><td class="sl"></td><td class="pb">${fmt(totals.b)}</td><td></td></tr>` : ""}</tbody></table></div>`;
  }
  // rows: [{ rank, team, w, l, t, pct, gb, pf, pa, streak, form, me, cut, href }], opts: { pfLabel, paLabel, fmt, compact, extra }
  function standingsTable(rows, opts = {}) {
    const fmt = opts.fmt || ((x) => x.toFixed(1));
    const cols = [
      { k: "rank", label: "#", cls: "r num", html: (r) => `<span class="ps">${r.rank}</span>` },
      { k: "team", label: "Team", td: "nm", html: (r) => `<a href="${esc(r.href || "#")}" style="color:inherit;text-decoration:none">${teamName(r.team, { you: r.me, owner: !opts.compact })}</a>` },
      { k: "rec", label: "W-L-T", cls: "r num", html: (r) => `<b>${r.w}-${r.l}${r.t ? "-" + r.t : ""}</b>` },
      { k: "pct", label: "Pct", cls: "r num", hide: opts.compact ? "s" : "", html: (r) => r.pct.toFixed(3).replace(/^0/, "") },
      { k: "gb", label: "GB", cls: "r num", hide: "s", html: (r) => (r.gb ? r.gb.toFixed(r.gb % 1 ? 1 : 0) : "-") },
      { k: "pf", label: opts.pfLabel || "PF", cls: "r num", html: (r) => fmt(r.pf) },
    ];
    if (!opts.compact) cols.push({ k: "pa", label: opts.paLabel || "PA", cls: "r num", hide: "s", html: (r) => fmt(r.pa) },
      { k: "streak", label: "Strk", cls: "r", hide: "s", html: (r) => `<span class="${/^W/.test(r.streak) ? "win" : /^L/.test(r.streak) ? "loss" : ""}" style="font-weight:800">${esc(r.streak || "-")}</span>` },
      { k: "form", label: "Last 5", cls: "", hide: "s", html: (r) => `<span class="form">${(r.form || []).slice(-5).map((x) => `<i class="${x}" title="${x}"></i>`).join("")}</span>` });
    if (opts.extra) cols.push(...opts.extra);
    return table({ cols, rows, cls: "stand", rowAttr: (r) => `class="${r.me ? "me " : ""}${r.cut ? "cut" : ""}"` });
  }
  // items: [{ when, team, with, badge, lines: [html], note }]
  function feed(items, empty = "No moves yet.") {
    if (!items.length) return `<p class="empty">${esc(empty)}</p>`;
    return `<ul class="feed">${items.map((x) => `<li>${teamAv(x.team, "md")}<div class="what"><div class="row"><b>${esc(x.team.name)}</b>${x.with ? `<span class="ps">and</span><b>${esc(x.with.name)}</b>` : ""}${x.badge ? ` ${x.badge}` : ""}</div>${x.lines.join("")}${x.note ? `<span class="ps">${x.note}</span>` : ""}</div><time>${esc(x.when)}</time></li>`).join("")}</ul>`;
  }
  const TXI = { add: ["+", "Added"], drop: ["&minus;", "Dropped"], trade: ["&#8644;", "Traded for"], waiver: ["W", "Claimed"] };
  const txLine = (sport, kind, p, extra = "") => `<div class="row"><span class="txi ${kind}" aria-label="${TXI[kind][1]}" title="${TXI[kind][1]}">${TXI[kind][0]}</span><span data-player="${esc(p.id)}" style="cursor:pointer;min-width:0">${pname(sport, p, extra, { size: "sm" })}</span></div>`;
  // vm: { id, status, statusLabel, from, to, give: [players], get, faab: [give, get], note, when, acts (html) }
  function tradeCard(sport, vm) {
    const side = (t, ps, faab, label) => `<div class="side"><h4>${teamAv(t, "sm")}${esc(label)}</h4>${ps.map((p) => `<span data-player="${esc(p.id)}" style="cursor:pointer">${pname(sport, p, p.$ ? money(p.$) : "")}</span>`).join("") || `<span class="ps">No players</span>`}${faab ? `<span><span class="tag gold">$${faab} FAAB</span></span>` : ""}</div>`;
    return `<div class="card" id="trade-${vm.id}"><div class="mod-h"><span class="status ${vm.status}">${esc(vm.statusLabel)}</span>${vm.sub ? `<span class="ps">${vm.sub}</span>` : ""}<span class="ps" style="margin-left:auto">${esc(vm.when || "")}</span></div>
      <div class="trade">${side(vm.from, vm.give, vm.faab && vm.faab[0], `${vm.from.name} sends`)}<span class="arrow" aria-hidden="true">&#8644;</span>${side(vm.to, vm.get, vm.faab && vm.faab[1], `${vm.to.name} sends`)}</div>
      ${vm.note ? `<p class="small" style="margin:0 16px 12px">&ldquo;${esc(vm.note)}&rdquo;</p>` : ""}${vm.acts ? `<div class="trade-foot">${vm.acts}</div>` : ""}</div>`;
  }

  /* The trade window: both rosters side by side, pick players and FAAB, see the value swing, send.
     opts: { sport, teams, me, other, roster(teamId) -> players, value(players, faab) -> number, faab(teamId) (omit to hide),
             roomFor(trade) -> drops needed, check(trade) -> { ok, why }, submit(trade) -> { ok, why },
             prefill: { give, get, faabGive, faabGet, note }, title } */
  function tradeWindow(opts) {
    const pf = opts.prefill || {};
    const st = { other: opts.other, give: new Set(pf.give || []), get: new Set(pf.get || []), drops: new Set(), faabGive: pf.faabGive || 0, faabGet: pf.faabGet || 0, note: pf.note || "" };
    const sport = opts.sport;
    const me = opts.teams.find((t) => t.id === opts.me);
    const trade = () => ({ from: opts.me, to: st.other, give: [...st.give], get: [...st.get], faabGive: st.faabGive, faabGet: st.faabGet, dropsFrom: [...st.drops], note: st.note, counterOf: pf.counterOf || null });
    const D = dialog(`<div class="tw"></div>`, null, { full: true });
    const draw = (focus) => {
      const other = opts.teams.find((t) => t.id === st.other);
      const mine = opts.roster(opts.me), theirs = opts.roster(st.other);
      const byId = Object.fromEntries(mine.concat(theirs).map((p) => [p.id, p]));
      const vg = opts.value([...st.give].map((id) => byId[id]).filter(Boolean), st.faabGive), vr = opts.value([...st.get].map((id) => byId[id]).filter(Boolean), st.faabGet);
      const need = opts.roomFor ? opts.roomFor(trade()) : 0;
      for (const id of [...st.drops]) if (st.give.has(id)) st.drops.delete(id);
      const tot = vg + vr || 1, swing = (vr - vg) / tot;
      const picked = st.give.size || st.get.size;
      const verdict = !picked ? "Pick players on either side" : Math.abs(swing) < 0.08 ? "About even" : swing > 0 ? (swing > 0.35 ? "Lopsided your way" : "Leans your way") : swing < -0.35 ? "Lopsided their way" : "Leans their way";
      const list = (ps, set, kind) => ps.map((p) => `<label class="${set.has(p.id) ? "on" : ""}${kind === "drop" ? " drop" : ""}"><input type="checkbox" data-tw="${kind}" value="${esc(p.id)}"${set.has(p.id) ? " checked" : ""}>${pname(sport, p)}<span class="dollar">${p.$ ? money(p.$) : ""}</span></label>`).join("");
      const dropList = need > 0 ? `<div class="sec">Drop ${need} to make room</div>${list(mine.filter((p) => !st.give.has(p.id)), st.drops, "drop")}` : "";
      const chk = opts.check ? opts.check(trade()) : { ok: true };
      const ready = chk.ok && picked && st.drops.size >= need;
      const scroll = $$(".tw-list", D).map((x) => x.scrollTop);
      $(".tw", D).innerHTML = `
        <div class="tw-h"><h3>${esc(opts.title || "Propose a trade")}</h3><label class="sr" for="tw-team">Trade with</label><select id="tw-team">${opts.teams.filter((t) => t.id !== opts.me).map((t) => `<option value="${t.id}"${t.id === st.other ? " selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div>
        <div class="tw-b">
          <div class="tw-col"><div class="hd">${teamAv(me, "sm")}<b>You send</b><span class="ps">${st.give.size} selected</span></div><div class="tw-list">${list(mine, st.give, "give")}${dropList}</div></div>
          <div class="tw-col"><div class="hd">${teamAv(other, "sm")}<b>${esc(other.name)} sends</b><span class="ps">${st.get.size} selected</span></div><div class="tw-list">${list(theirs, st.get, "get")}</div></div>
        </div>
        <div class="tw-f">
          <div class="meter"><div class="meter-l"><span>You send ${money(vg)}</span><span>${esc(verdict)}</span><span>You get ${money(vr)}</span></div>
            <div class="meter-bar"><i style="${swing >= 0 ? `left:50%;width:${Math.min(50, swing * 50)}%;background:var(--win)` : `right:50%;width:${Math.min(50, -swing * 50)}%;background:var(--loss)`}"></i></div></div>
          ${opts.faab ? `<div class="row"><label class="check">FAAB you send <input type="number" min="0" max="${opts.faab(opts.me)}" data-tw="faabGive" value="${st.faabGive}"></label><label class="check">FAAB you get <input type="number" min="0" max="${opts.faab(st.other)}" data-tw="faabGet" value="${st.faabGet}"></label><span class="ps">You have $${opts.faab(opts.me)}, they have $${opts.faab(st.other)}</span></div>` : ""}
          <div class="row"><label class="sr" for="tw-note">Note</label><input type="text" id="tw-note" data-tw="note" maxlength="140" placeholder="Add a note (optional)" value="${esc(st.note)}" style="flex:1;min-width:160px"><button type="button" class="btn" data-tw-cancel>Cancel</button><button type="button" class="btn go" data-tw-send${ready ? "" : " disabled"}>Send offer</button></div>
          ${picked && !chk.ok ? `<span class="why">${esc(chk.why)}</span>` : picked && need > st.drops.size ? `<span class="why">Pick ${need - st.drops.size} more to drop.</span>` : ""}
        </div>`;
      $$(".tw-list", D).forEach((x, i) => (x.scrollTop = scroll[i] || 0));
      if (focus) { const f = $(`[data-tw=${focus}]`, D); if (f) { f.focus(); try { f.select(); } catch (e) { /* number */ } } }
    };
    D.oninput = (e) => {
      const k = e.target.dataset.tw;
      if (k === "note") { st.note = e.target.value; return; }
      if (k === "faabGive" || k === "faabGet") { st[k] = Math.max(0, Math.round(+e.target.value || 0)); draw(k); }
    };
    D.onchange = (e) => {
      const k = e.target.dataset.tw;
      if (e.target.id === "tw-team") { st.other = +e.target.value; st.get.clear(); st.faabGet = 0; draw(); return; }
      const set = k === "give" ? st.give : k === "get" ? st.get : k === "drop" ? st.drops : null;
      if (!set) return;
      if (e.target.checked) set.add(e.target.value); else set.delete(e.target.value);
      draw();
    };
    D.onclick = (e) => {
      if (e.target.closest("[data-tw-cancel]")) { D.close(); return; }
      if (!e.target.closest("[data-tw-send]")) return;
      const r = opts.submit(trade());
      if (r && r.ok === false) toast(r.why, true); else D.close();
    };
    draw();
  }

  /* ---------- draft room ---------- */
  /* FK.ui.room(opts) mounts a draft room into opts.el and returns { render, stop, ctx, refresh }.
       sport, players  an attached sport and its evaluated players
       draft()         the current draft document; save(D) runs after every change
       me()            your team id, or null to watch
       commish         true to show start, pause and undo
       drive           true if this page runs the clock (bots and autopicks)
       hooks           FK.draft hooks (a cap rule, a custom bot)
       brand           { name, mark } for the top bar; exit { href, label }; extra() html for the top bar when done */
  function room(opts) {
    const { el, sport } = opts;
    const ui = { left: "players", right: "team", sort: { k: "rank", dir: 1 }, f: { q: "", pos: "" }, show: "avail", view: null, bidAmt: null, mobileRight: false };
    let ctx = null, timer = null;
    const D = () => opts.draft();
    const me = () => (opts.me ? opts.me() : null);
    const now = () => (opts.now ? opts.now() : Date.now());
    const refresh = () => { ctx = F.context(D(), opts.players, sport, opts.hooks); return ctx; };
    refresh();
    const save = () => { opts.save(D()); refresh(); };
    const team = (id) => D().teams[id];
    const isMe = (t) => me() != null && t && t.id === me();
    const auction = () => D().type === "auction";
    const pts = () => isPoints(sport, D().scoring);

    /* the top bar: league, who's up and the clock, controls */
    function top() {
      const d = D(), n = now();
      const brand = opts.brand || {};
      const lg = `<a class="lg" href="${esc((opts.exit && opts.exit.href) || "#")}">${brand.mark || ""}<span><b>${esc(d.name || brand.name || "Draft")}</b><small>${esc(F.FORMATS[d.type])}, ${d.teams.length} teams, ${d.rounds} rounds</small></span></a>`;
      const ctl = [];
      if (me() != null && d.phase !== "done") ctl.push(`<button class="btn sm" data-act="auto" aria-pressed="${!!team(me()).auto}" title="Let the bot draft for you">Autodraft</button>`);
      if (opts.commish && d.phase === "live") ctl.push(`<button class="btn sm" data-act="pause">${d.paused ? "Resume" : "Pause"}</button><button class="btn sm" data-act="undo">Undo</button>`);
      if (opts.commish && d.phase === "setup") ctl.push(`<button class="btn sm go" data-act="start">Start the draft</button>`);
      if (d.phase === "done" && opts.extra) ctl.push(opts.extra());
      if (opts.exit) ctl.push(`<a class="btn sm" href="${esc(opts.exit.href)}">${esc(opts.exit.label || "Exit")}</a>`);
      let mid = "";
      if (d.phase === "setup") mid = `<div class="otc"><span class="ring" style="--p:1"><span>${d.clock || d.auction ? (auction() ? d.auction.bidClock : d.clock) : "-"}</span></span><span class="who"><small>Draft room is open</small><b>Build your queue</b><span>${auction() ? `$${d.auction.budget} budgets, ${d.auction.bidClock} seconds a bid` : d.clock ? `${d.clock} seconds a pick` : "No pick clock"}</span></span></div>`;
      else if (d.phase === "done") mid = `<div class="otc"><span class="who"><small>Draft complete</small><b>${F.made(d).length} ${auction() ? "players bought" : "picks"}</b><span>See the Results tab</span></span></div>`;
      else if (auction()) {
        const st = F.auctionState(d, n);
        const t = st.kind === "lot" ? team(st.lot.team) : team(st.team);
        mid = `<div class="otc${isMe(t) && st.kind === "nominate" ? " me" : ""}">${teamAv(t, "md")}<span class="who"><small>${st.kind === "lot" ? "High bid" : isMe(t) ? "Your nomination" : "Nominating"}</small><b>${esc(t.name)}</b><span>${d.sales.length} of ${d.teams.length * d.rounds} bought${d.paused ? ", paused" : ""}</span></span><span class="ring" id="fk-ring"><span id="fk-timer"></span></span></div>`;
      } else {
        const c = F.onClock(d, n), t = team(c.team), mine = isMe(t);
        const next = me() != null ? F.nextPickOf(d, me()) : null;
        mid = `<div class="otc${mine ? " me" : ""}">${teamAv(t, "md")}<span class="who"><small>${mine ? "You're on the clock" : "On the clock"}</small><b>${esc(t.name)}</b><span>Round ${c.round}, pick ${c.inRound} (${ord(c.pick)} overall)${!mine && next ? `. You pick in ${next - c.pick}` : ""}${d.paused ? ", paused" : ""}</span></span><span class="ring" id="fk-ring"><span id="fk-timer"></span></span></div>`;
      }
      return `<div class="dr-top">${lg}${mid}<div class="acts">${ctl.join("")}</div></div>`;
    }
    // The pick ticker: the last few picks, the pick on the clock, and who's up next.
    function ticker() {
      const d = D(), n = d.teams.length;
      if (auction()) return lotBar();
      const k0 = d.phase === "live" ? F.onClock(d, now()).index : d.phase === "done" ? d.order.length : 0;
      const from = Math.max(0, k0 - 6), to = Math.min(d.order.length, from + 22);
      const cards = [];
      for (let k = from; k < to; k++) {
        const pk = d.board[k], t = team(d.order[k]), lab = `${Math.floor(k / n) + 1}.${(k % n) + 1}`;
        const p = pk && pk.pid && ctx.byId[pk.pid];
        if (p) cards.push(`<button type="button" class="tk done c${colorOf(sport, p)}${isMe(t) ? " me" : ""}" data-player="${esc(p.id)}"><span class="n">${lab} ${esc(t.abbr)}</span><b>${esc(p.n)}</b><small>${S.positions(p).join(", ")} ${esc(p.t)}</small></button>`);
        else cards.push(`<div class="tk${k === k0 && d.phase === "live" ? " now" : ""}${isMe(t) ? " me" : ""}"><span class="n">${teamAv(t, "sm")} ${lab}</span><b>${isMe(t) ? "You" : esc(t.name)}</b><small>${k === k0 && d.phase === "live" ? "On the clock" : k > k0 ? `${k - k0} away` : "Passed"}</small></div>`);
      }
      return `<div class="ticker" id="fk-ticker">${cards.join("")}</div>`;
    }
    function lotBar() {
      const d = D(), n = now();
      if (d.phase !== "live") return `<div><div class="budgets">${budgetChips()}</div></div>`;
      const st = F.auctionState(d, n);
      const mine = me() != null;
      if (st.kind === "nominate") {
        const t = team(st.team);
        return `<div><div class="lot">${teamAv(t, "lg")}<div class="lp"><b class="disp">${isMe(t) ? "Your nomination" : esc(t.name) + " is nominating"}</b><span class="ps">${isMe(t) ? "Pick a player below and set an opening bid. Your queue nominates for you if time runs out." : "The next player goes up in a moment."}</span></div><span></span><span></span><span></span></div><div class="budgets">${budgetChips()}</div></div>`;
      }
      const lot = st.lot, p = ctx.byId[lot.pid], lead = team(lot.team);
      const can = mine && !isMe(lead) && F.maxBid(d, me()) > lot.bid && F.canAdd(d, ctx, me(), p).ok && !d.paused;
      const next = lot.bid + 1, max = mine ? F.maxBid(d, me()) : 0;
      const passed = mine && (lot.passed || []).includes(me());
      return `<div><div class="lot">${playerAv(sport, p, "lg")}<div class="lp"><b class="disp">${esc(p.n)}</b><span class="ps">${posChips(sport, p)} ${esc(p.t)}, ${esc(p.prank)}, value ${money(p.$)}. Nominated by ${esc(team(lot.by).name)}</span></div>
        <div class="bid"><small>${teamAv(lead, "sm")} ${isMe(lead) ? "Your bid" : esc(lead.abbr)}</small><b class="${isMe(lead) ? "win" : ""}">${money(lot.bid)}</b></div>
        <span class="ring" id="fk-ring2"><span id="fk-timer2"></span></span>
        <div class="acts">${can ? `<button class="btn go" data-bid="${next}">Bid ${money(next)}</button><button class="btn" data-bid="${Math.min(max, lot.bid + 5)}">${money(Math.min(max, lot.bid + 5))}</button><label class="sr" for="fk-bid">Your bid</label><input type="number" id="fk-bid" min="${next}" max="${max}" value="${ui.bidAmt && ui.bidAmt > lot.bid ? ui.bidAmt : next}"><button class="btn" data-act="bid">Bid</button>${passed ? `<span class="ps">You passed</span>` : `<button class="btn ghost" data-act="pass">Pass</button>`}`
          : mine ? `<span class="ps">${isMe(lead) ? "You have the high bid." : max <= lot.bid ? `Your max bid is ${money(max)}.` : esc(F.canAdd(d, ctx, me(), p).why || "")}</span>` : ""}</div></div>
        <div class="budgets">${budgetChips()}</div></div>`;
    }
    function budgetChips() {
      const d = D(), lot = d.auction.lot;
      return d.round1.map((id) => { const t = team(id); return `<span class="${isMe(t) ? "me" : ""}${lot && lot.team === id ? " lead" : ""}" title="${esc(t.name)}: ${F.spotsLeft(d, id)} spots left, max bid ${money(F.maxBid(d, id))}">${teamAv(t, "sm")}${money(t.budget)} <span class="ps">${F.spotsLeft(d, id)} left</span></span>`; }).join("");
    }

    /* left side: players, board, picks, results */
    function players() {
      const d = D(), n = now(), mine = me();
      const c = !auction() && d.phase === "live" ? F.onClock(d, n) : null;
      const myTurn = c && c.team === mine;
      const st = auction() && d.phase === "live" ? F.auctionState(d, n) : null;
      const myNom = st && st.kind === "nominate" && st.team === mine;
      let rows = (ui.show === "all" ? opts.players : ctx.available).filter((p) => passes(sport, p, ui.f));
      const actions = (p) => {
        if (ctx.own[p.id] != null) return `${teamAv(team(ctx.own[p.id]), "sm")}`;
        if (mine == null) return "";
        const ok = F.canAdd(d, ctx, mine, p).ok;
        const q = team(mine).queue.includes(p.id);
        return `${myTurn && ok ? `<button class="btn xs go" data-pick="${esc(p.id)}">Draft</button> ` : ""}${myNom && ok ? `<button class="btn xs go" data-nominate="${esc(p.id)}">Nominate</button> ` : ""}<button class="star${q ? " on" : ""}" data-queue="${esc(p.id)}" aria-label="${q ? "Remove from" : "Add to"} queue" title="${q ? "In your queue" : "Add to queue"}">${q ? "&#9733;" : "&#9734;"}</button>`;
      };
      const cols = poolColumns(sport, { group: groupOf(sport, ui.f), scoring: d.scoring, actions });
      rows = sortRows(rows, cols, ui.sort);
      return table({ cols, rows, sort: ui.sort, dense: true, id: "fk-pool", limit: 250, empty: "No one matches.",
        rowAttr: (p) => `data-player="${esc(p.id)}" class="${mine != null && ctx.own[p.id] == null && !F.canAdd(d, ctx, mine, p).ok ? "dim" : ""}"` });
    }
    function board() {
      const d = D(), n = d.teams.length, rounds = d.rounds, cols = d.round1;
      const cellOf = (r, col) => {
        if (auction()) { const s = d.sales.filter((x) => x.team === cols[col])[r]; return s ? { pk: s, label: money(s.price) } : null; }
        for (let k = r * n; k < (r + 1) * n; k++) if (d.order[k] === cols[col]) return { pk: d.board[k], k };
        return null;
      };
      const nowK = !auction() && d.phase === "live" ? F.onClock(d, now()).index : -1;
      let cells = `<div class="h"></div>${cols.map((id) => { const t = team(id); return `<div class="h${isMe(t) ? " me" : ""}" title="${esc(t.name)}${t.owner ? ", " + esc(t.owner) : ", bot"}">${teamAv(t, "sm")}<b>${esc(t.name)}</b><small>${auction() ? money(t.budget) + " left" : esc(t.owner || "Bot")}</small></div>`; }).join("")}`;
      for (let r = 0; r < rounds; r++) {
        cells += `<div class="rn">${r + 1}</div>`;
        for (let col = 0; col < n; col++) {
          const x = cellOf(r, col), t = team(cols[col]);
          const pk = x && x.pk, p = pk && pk.pid && ctx.byId[pk.pid];
          const cls = ["cell", p ? "f c" + colorOf(sport, p) : "", isMe(t) ? "me" : "", x && x.k === nowK ? "now" : "", pk && pk.keeper ? "keep" : ""].join(" ").replace(/\s+/g, " ");
          cells += `<div class="${cls}"${p ? ` data-player="${esc(p.id)}" role="button" tabindex="0" title="${esc(p.n)}${pk.auto ? ", autopick" : ""}"` : ""}>${p ? `<b>${esc(p.n)}</b><small>${S.positions(p).join(", ")} ${esc(p.t)}${x.label ? " " + x.label : ""}</small>` : pk ? "<b>Passed</b>" : x && x.k != null ? `<small class="ps">${r + 1}.${col + 1}${x.k === nowK ? ", on the clock" : ""}</small>` : ""}</div>`;
        }
      }
      return `<div class="board" id="fk-board"><div class="bgrid" style="--n:${n};grid-template-columns:28px repeat(${n},minmax(0,1fr))">${cells}</div></div>`;
    }
    function picks() {
      const d = D(), list = F.made(d).reverse();
      return `<div class="table-wrap" id="fk-picks" style="flex:1;min-height:0">${list.length ? `<ol class="picks">${list.map((pk) => { const t = team(pk.team), p = ctx.byId[pk.pid];
        return `<li class="${isMe(t) ? "me" : ""}"><span class="no">${auction() ? money(pk.price) : `${Math.ceil(pk.n / d.teams.length)}.${((pk.n - 1) % d.teams.length) + 1}`}</span><span ${p ? `data-player="${esc(p.id)}"` : ""} style="cursor:pointer;min-width:0">${p ? pname(sport, p, `${pk.keeper ? "keeper" : pk.auto ? "autopick" : ""}`) : "<b>Passed</b>"}</span><span class="row">${teamAv(t, "sm")}<span class="ps hide-s">${esc(t.name)}</span></span></li>`; }).join("")}</ol>` : `<p class="empty">No ${auction() ? "sales" : "picks"} yet.</p>`}</div>`;
    }
    function results() {
      const d = D(), st = F.standings(d, ctx).sort((a, b) => a.rank - b.rank);
      return `<div style="overflow:auto;flex:1;min-height:0"><div class="teams">${st.map((r) => { const t = team(r.team);
        return `<div class="card"${isMe(t) ? ` style="border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)"` : ""}><div class="mod-h">${teamAv(t, "md")}<div style="min-width:0"><b class="ell" style="display:block">${esc(t.name)}${isMe(t) ? ` <span class="tag you">You</span>` : ""}</b><span class="ps">${ord(r.rank)}, ${pts() ? `${Math.round(r.score)} projected` : `${r.score.toFixed(1)} value`}${r.spent != null ? `, spent ${money(r.spent)}` : ""}</span></div><b class="grade disp">${r.grade}</b></div>
          <ol>${r.starters.filter(Boolean).map((p) => `<li>${posChip(sport, FK.value.mainPos(sport, p))}<button class="btn link ell" data-player="${esc(p.id)}">${esc(p.n)}</button><span class="grow"></span><span class="ps">${p.rank}</span></li>`).join("")}</ol></div>`; }).join("")}</div></div>`;
    }
    /* right side: my team, queue, teams */
    function rosterPanel(id) {
      const d = D(), t = team(id);
      const ps = F.rosters(d)[id].map((x) => ctx.byId[x]).filter(Boolean);
      const starters = F.assign(sport, ps, d.lineup);
      const bench = ps.filter((p) => !starters.includes(p));
      const paid = (p) => { const s = auction() ? d.sales.find((x) => x.pid === p.id) : null; return s ? money(s.price) : ""; };
      const li = (slot, p) => `<li class="${p ? "" : "open"}"><span class="slot">${esc(slot)}</span>${p ? `<span data-player="${esc(p.id)}" style="cursor:pointer;min-width:0">${pname(sport, p, "", { size: "sm" })}</span><span class="ps">${paid(p) || "#" + p.rank}</span>` : `<span class="ps">Open</span><span></span>`}</li>`;
      return `<div class="mod-h">${teamAv(t, "sm")}<b class="ell">${esc(t.name)}</b><span class="ps" style="margin-left:auto;white-space:nowrap">${ps.length} of ${F.sizeOf(d)}${auction() ? `, ${money(t.budget)} left` : ""}</span></div>
        <ul class="rslots">${d.lineup.map((s, i) => li(s, starters[i])).join("")}${bench.map((p) => li("BN", p)).join("")}${Array.from({ length: Math.max(0, d.bench - bench.length) }, () => li("BN", null)).join("")}</ul>`;
    }
    function queuePanel() {
      const t = team(me());
      return `<div class="mod-h"><b>Your queue</b><span class="ps" style="margin-left:auto">${t.queue.length} player${t.queue.length === 1 ? "" : "s"}</span></div>
        <p class="ps" style="margin:8px 12px">When your clock runs out${auction() ? " or it's your nomination" : ""}, the first player here who still fits ${auction() ? "goes up for bid" : "is your pick"}. Star players to add them.</p>
        <ul class="rslots">${t.queue.map((id, i) => { const p = ctx.byId[id], taken = ctx.own[id] != null; return `<li${taken ? ` style="opacity:.45"` : ""}><span class="slot">${i + 1}</span><span data-player="${esc(id)}" style="cursor:pointer;min-width:0">${pname(sport, p, taken ? "taken" : "", { size: "sm" })}</span><span class="row" style="gap:4px"><button class="btn xs" data-qup="${esc(id)}"${i ? "" : " disabled"} aria-label="Move up">&uarr;</button><button class="btn xs" data-queue="${esc(id)}" aria-label="Remove">&times;</button></span></li>`; }).join("") || `<li class="open"><span></span><span class="ps">Empty</span><span></span></li>`}</ul>`;
    }
    function teamsPanel() {
      const d = D();
      const id = ui.view != null ? ui.view : d.round1.find((x) => x !== me());
      return `<div style="padding:8px 12px 0"><label class="sr" for="fk-view">Team</label><select id="fk-view">${d.round1.map((x) => `<option value="${x}"${x === id ? " selected" : ""}>${esc(team(x).name)}${isMe(team(x)) ? " (you)" : ""}</option>`).join("")}</select></div>${rosterPanel(id)}`;
    }

    /* render and wire */
    function render() {
      const d = D();
      if (d.phase === "done" && ui.phase && ui.phase !== "done") { ui.left = "results"; ui.mobileRight = false; }
      ui.phase = d.phase;
      const lefts = [["players", "Players"], ["board", "Board"], ["picks", auction() ? "Sales" : "Picks"]].concat(d.phase === "done" ? [["results", "Results"]] : []);
      if (!lefts.some((x) => x[0] === ui.left)) ui.left = "players";
      const rights = me() != null ? [["team", "My team"], ["queue", "Queue"], ["teams", "Teams"]] : [["teams", "Teams"]];
      if (!rights.some((x) => x[0] === ui.right)) ui.right = rights[0][0];
      const keep = { q: document.activeElement && document.activeElement.id, scroll: {} };
      $$("#fk-pool,#fk-board,#fk-picks,.dr-panel,#fk-ticker", el).forEach((x) => (keep.scroll[x.id || x.className] = [x.scrollTop, x.scrollLeft]));
      const sel = keep.q === "fk-q" ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
      const left = { players, board, picks, results }[ui.left]();
      const right = { team: () => rosterPanel(me()), queue: queuePanel, teams: teamsPanel }[ui.right]();
      // one view switch: the left views, plus the right panels as views on narrow screens
      const seg = `<div class="seg" role="group" aria-label="View">${lefts.map(([k, n]) => `<button type="button" data-left="${k}" aria-pressed="${!ui.mobileRight && ui.left === k}">${esc(n)}</button>`).join("")}${rights.map(([k, n]) => `<button type="button" class="show-m" data-mright="${k}" aria-pressed="${ui.mobileRight && ui.right === k}">${esc(n)}</button>`).join("")}</div>`;
      const filters = ui.left === "players" ? `${search(ui.f)}<label class="sr" for="fk-show">Show</label><select id="fk-show" style="width:auto;border-radius:999px;min-height:36px;font-size:13px"><option value="avail"${ui.show === "avail" ? " selected" : ""}>Available</option><option value="all"${ui.show === "all" ? " selected" : ""}>All players</option></select>` : "";
      el.innerHTML = `<div class="droom fk-dark">${top()}${ticker()}<div class="dr-main${ui.mobileRight ? " right" : ""}">
        <section class="dr-left"><div class="dr-bar">${seg}${filters}</div>${ui.left === "players" ? posFilter(sport, ui.f.pos) : ""}${left}</section>
        <aside class="dr-right"><div class="seg hide-m" role="group" aria-label="Panel">${rights.map(([k, n]) => `<button type="button" data-right="${k}" aria-pressed="${ui.right === k}">${esc(n)}</button>`).join("")}</div><div class="show-m" style="padding:10px 12px 0">${seg}</div><div class="dr-panel">${right}</div></aside></div></div>`;
      $$("#fk-pool,#fk-board,#fk-picks,.dr-panel,#fk-ticker", el).forEach((x) => { const v = keep.scroll[x.id || x.className]; if (v) { x.scrollTop = v[0]; x.scrollLeft = v[1]; } });
      const tk = $("#fk-ticker", el), cur = tk && $(".tk.now", tk);
      if (cur && tk && (!keep.scroll["fk-ticker"] || ui.lastPick !== F.made(d).length)) tk.scrollLeft = Math.max(0, cur.offsetLeft - tk.clientWidth * 0.3);
      ui.lastPick = F.made(d).length;
      if (keep.q) { const f = document.getElementById(keep.q); if (f) { f.focus(); if (sel) try { f.setSelectionRange(sel[0], sel[1]); } catch (e) { /* number input */ } } }
      drawTimer();
      if (opts.onChange) opts.onChange(d);
    }
    function drawTimer() {
      const d = D(), n = now();
      let left = null, total = 1;
      if (auction()) { const st = F.auctionState(d, n); left = st ? st.left : null; total = st && st.kind === "lot" ? d.auction.bidClock * 1000 : d.auction.nomClock * 1000; }
      else { const c = F.onClock(d, n); left = c ? c.left : null; total = (d.clock || 1) * 1000; }
      const fin = left != null && Number.isFinite(left);
      for (const [ti, ri] of [["#fk-timer", "#fk-ring"], ["#fk-timer2", "#fk-ring2"]]) {
        const t = $(ti, el), ring = $(ri, el);
        if (t) t.textContent = fin ? fmtLeft(left) : "";
        if (ring) { ring.style.setProperty("--p", fin ? Math.max(0, Math.min(1, left / total)).toFixed(3) : 1); ring.classList.toggle("hot", fin && left < 10000); }
      }
    }
    const act = (fn) => { const r = fn(); if (r && r.ok === false) { toast(r.why, true); return false; } save(); render(); return true; };

    function openCard(pid) {
      const d = D(), p = ctx.byId[pid];
      if (!p) return;
      const mine = me(), taken = ctx.own[pid] != null;
      const c = !auction() && d.phase === "live" ? F.onClock(d, now()) : null;
      const st = auction() && d.phase === "live" ? F.auctionState(d, now()) : null;
      const can = mine != null && !taken ? F.canAdd(d, ctx, mine, p) : null;
      let actions = "";
      if (mine != null && !taken) actions += `<button class="btn" data-card="queue">${team(mine).queue.includes(pid) ? "Remove from queue" : "Add to queue"}</button>`;
      if (can && can.ok && c && c.team === mine) actions += `<button class="btn go" data-card="pick">Draft ${esc(last(p.n))}</button>`;
      if (can && can.ok && st && st.kind === "nominate" && st.team === mine) actions += `<button class="btn go" data-card="nominate">Nominate</button>`;
      const status = taken ? `${teamAv(team(ctx.own[pid]), "sm")} Drafted by ${esc(team(ctx.own[pid]).name)}` : can && !can.ok ? `<span class="bad">${esc(can.why)}</span>` : "";
      const Dl = dialog(playerCard(sport, p, { scoring: d.scoring, actions, status }), null, { wide: true, dark: true });
      $$("[data-card]", Dl).forEach((b) => b.addEventListener("click", () => {
        const a = b.dataset.card;
        if (a === "pick") { if (act(() => F.pick(D(), ctx, mine, pid, now()))) Dl.close(); }
        else if (a === "nominate") { Dl.close(); nominateDialog(pid); }
        else { toggleQueue(pid); Dl.close(); }
      }));
    }
    function nominateDialog(pid) {
      const d = D(), p = ctx.byId[pid], max = F.maxBid(d, me());
      dialog(`<div class="pc-h">${playerAv(sport, p, "lg")}<div><h3 class="disp">Nominate ${esc(p.n)}</h3><div class="ps">Value ${money(p.$)}. You can bid up to ${money(max)}.</div></div></div><form class="stack"><div class="field"><label for="fk-open">Opening bid</label><input type="number" id="fk-open" name="amt" min="${d.auction.minBid}" max="${max}" value="${d.auction.minBid}"></div><div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn go">Nominate</button></div></form>`,
        (fd) => act(() => F.nominate(D(), ctx, me(), pid, +fd.get("amt"), now())), { dark: true });
    }
    function toggleQueue(pid) {
      const t = team(me());
      if (t.queue.includes(pid)) t.queue = t.queue.filter((x) => x !== pid); else t.queue.push(pid);
      save(); render();
    }

    el.addEventListener("click", (e) => {
      const lb = e.target.closest("[data-left]");
      if (lb) { ui.left = lb.dataset.left; ui.mobileRight = false; render(); return; }
      const rb = e.target.closest("[data-right]");
      if (rb) { ui.right = rb.dataset.right; render(); return; }
      const mr = e.target.closest("[data-mright]");
      if (mr) { ui.right = mr.dataset.mright; ui.mobileRight = true; render(); return; }
      const fp = e.target.closest("[data-fpos]");
      if (fp) { ui.f.pos = fp.dataset.fpos; render(); return; }
      const th = e.target.closest("th[data-sort]");
      if (th) { const cols = poolColumns(sport, { scoring: D().scoring, group: groupOf(sport, ui.f) }); ui.sort = nextSort(ui.sort, th.dataset.sort, cols); render(); return; }
      const b = e.target.closest("button[data-pick],button[data-queue],button[data-nominate],button[data-bid],button[data-qup],button[data-act]");
      if (b) {
        e.stopPropagation();
        const d = D(), n = now();
        if (b.dataset.pick) act(() => F.pick(d, ctx, me(), b.dataset.pick, n));
        else if (b.dataset.queue) toggleQueue(b.dataset.queue);
        else if (b.dataset.nominate) nominateDialog(b.dataset.nominate);
        else if (b.dataset.bid) act(() => F.bid(d, ctx, me(), +b.dataset.bid, n));
        else if (b.dataset.qup) { const q = team(me()).queue, i = q.indexOf(b.dataset.qup); if (i > 0) { [q[i - 1], q[i]] = [q[i], q[i - 1]]; save(); render(); } }
        else {
          const a = b.dataset.act;
          if (a === "start") act(() => F.start(d, n));
          else if (a === "pause") act(() => F.pause(d, n, !d.paused));
          else if (a === "undo") act(() => F.undo(d, ctx, n));
          else if (a === "pass") act(() => F.pass(d, ctx, me(), n));
          else if (a === "bid") { const v = +($("#fk-bid", el) || {}).value; act(() => F.bid(d, ctx, me(), v, n)); }
          else if (a === "auto") { const t = team(me()); t.auto = !t.auto; if (t.auto) toast("Autodraft is on: the bot picks for you."); save(); render(); }
        }
        return;
      }
      const pl = e.target.closest("[data-player]");
      if (pl && pl.dataset.player) { e.preventDefault(); openCard(pl.dataset.player); }
    });
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const th = e.target.closest("th[data-sort]"), cell = e.target.closest(".cell[data-player]");
      if (th || cell) { e.preventDefault(); e.target.click(); }
      if (e.target.id === "fk-bid" && e.key === "Enter") { e.preventDefault(); $("[data-act=bid]", el).click(); }
    });
    el.addEventListener("input", (e) => {
      if (e.target.id === "fk-q") { ui.f.q = e.target.value; render(); }
      if (e.target.id === "fk-bid") ui.bidAmt = +e.target.value;
    });
    el.addEventListener("change", (e) => {
      if (e.target.id === "fk-show") { ui.show = e.target.value; render(); }
      if (e.target.id === "fk-view") { ui.view = +e.target.value; render(); }
    });

    // The clock: redraw the timer; when this page drives the draft, bots and expired clocks move it.
    let lastSig = "";
    const sig = () => { const d = D(); return [d.phase, d.paused, F.made(d).length, d.auction && d.auction.lot ? d.auction.lot.bid + ":" + d.auction.lot.team + ":" + (d.auction.lot.passed || []).length : ""].join("|"); };
    timer = setInterval(() => {
      if (opts.drive && D().phase === "live" && !dialogOpen()) {
        const moved = F.tick(D(), ctx, now(), 3);
        if (moved) save();
      }
      const s = sig();
      if (s !== lastSig) { lastSig = s; if (!dialogOpen()) render(); else drawTimer(); } else drawTimer();
    }, 250);

    document.body.classList.add("fk-room");
    render();
    lastSig = sig();
    return { render, stop: () => { clearInterval(timer); document.body.classList.remove("fk-room"); }, get ctx() { return ctx; }, refresh: () => { refresh(); render(); }, ui };
  }

  FK.ui = { esc, $, $$, store, toast, dialog, dialogOpen, confirm, theme, fmtLeft, money, ord, last, initials, ago,
    teamAv, playerAv, pname, teamName, posChip, posChips, colorOf, injTag,
    shell, switcher, route, table, sortRows, nextSort, poolColumns, posFilter, search, passes, groupOf, statCell, label, isPoints,
    playerCard, scoreboard, versus, vsTable, standingsTable, feed, txLine, tradeCard, tradeWindow, room };
})(this);
