/* Fantasy Kit: the browser side. Load after sports.js, value.js and draft.js, with kit.css on the page.

   FK.ui gives a league page:
     helpers   esc, $, $$, store(ns), toast, dialog, theme, fmtLeft, money
     shell     the masthead with brand, a section tab bar and a page tab bar (FK.ui.shell)
     table     sortable tables from column definitions (FK.ui.table)
     players   the player pool: columns per sport, filters, the player card (FK.ui.poolColumns, filterBar, playerCard)
     room      a full draft room on top of FK.draft (FK.ui.room)
   Nothing here saves anything: the page that hosts the room decides where a draft lives (this device, Supabase). */
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
    if (!el) { el = document.createElement("div"); el.id = "fk-toast"; el.className = "toast"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite"); document.body.appendChild(el); }
    el.textContent = msg; el.className = "toast" + (bad ? " bad" : ""); el.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 3200);
  }
  // A modal with a close button. onSubmit(formData, form) runs for a <form>; return false to keep it open.
  function dialog(html, onSubmit, opts = {}) {
    let D = $("#fk-dlg");
    if (!D) { D = document.createElement("dialog"); D.id = "fk-dlg"; D.className = "fk-dlg"; document.body.appendChild(D); D.addEventListener("close", () => D.onclosed && D.onclosed()); }
    D.className = "fk-dlg" + (opts.wide ? " wide" : "");
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

  const posChip = (sport, pos) => `<span class="pp c${(sport.colors && sport.colors[pos]) || 6}">${esc(pos)}</span>`;
  const posChips = (sport, p) => S.positions(p).map((x) => posChip(sport, x)).join("");
  const colorOf = (sport, p) => (sport.colors && sport.colors[FK.value.mainPos(sport, p)]) || 6;

  /* ---------- shell ---------- */
  // opts: { brand: { name, href, mark (html) }, title (html beside the brand), tabs: [[key, label, badge]], tab,
  //         subs: [[key, label, badge]], sub, hrefOf(tab, sub), right (html) }
  function shell(opts) {
    const href = opts.hrefOf || ((t, s) => "#" + t + (s ? "/" + s : ""));
    const badge = (n) => (n ? ` <span class="badge">${n}</span>` : "");
    return `<div class="fk-mast fk-band"><div class="wrap">
        <a class="fk-brand" href="${esc(opts.brand.href || "./")}">${opts.brand.mark || ""}<b class="disp">${esc(opts.brand.name)}</b></a>
        ${opts.title || ""}<span class="grow"></span><div class="fk-who">${opts.right || ""}</div></div></div>
      ${opts.tabs && opts.tabs.length ? `<div class="fk-tabs"><div class="wrap"><nav aria-label="Sections">${opts.tabs.map(([k, n, b]) => `<a href="${href(k)}"${k === opts.tab ? ' aria-current="page"' : ""}>${esc(n)}${badge(b)}</a>`).join("")}</nav></div></div>` : ""}
      ${opts.subs && opts.subs.length ? `<nav class="fk-subs" aria-label="Pages"><div class="wrap">${opts.subs.map(([k, n, b]) => `<a href="${href(opts.tab, k)}"${k === opts.sub ? ' aria-current="page"' : ""}>${esc(n)}${badge(b)}</a>`).join("")}</div></nav>` : ""}`;
  }
  const route = (def) => { const h = location.hash.replace(/^#/, "").split("/").map(decodeURIComponent); return { tab: h[0] || def, sub: h[1] || "", arg: h[2] || "" }; };

  /* ---------- tables ---------- */
  // cols: [{ k, label, title, cls ("r"), hide ("s" hides on phones), sort (row => value), html (row => cell html) }]
  // sort: { k, dir: 1 or -1 }. Sortable headers carry data-sort; wire them with onSortClick.
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
    return `<div class="table-wrap"${opts.id ? ` id="${esc(opts.id)}"` : ""}><table class="t${opts.dense ? " dense" : ""}"><thead><tr>${cols.map(th).join("")}</tr></thead><tbody>
      ${rows.map((r) => `<tr${opts.rowAttr ? " " + opts.rowAttr(r) : ""}>${cols.map((c) => `<td class="${[c.cls || "", c.hide ? "hide-" + c.hide : "", c.td || ""].join(" ").trim()}">${c.html(r)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${cols.length}" class="empty">${esc(opts.empty || "Nothing here.")}</td></tr>`}
      </tbody></table></div>`;
  }
  // Clicking a sortable header: same column flips direction; a new column starts at its natural direction.
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
  const injTag = (p) => (p.inj ? ` <span class="tag inj" title="${esc(p.inj)}">${esc(String(p.inj).slice(0, 3).toUpperCase())}</span>` : "");
  // Columns for a player table. opts: { group ("bat" or "pit" to show one baseball side), money (show $),
  // owner (p => html), actions (p => html), lead (extra columns first) }
  function poolColumns(sport, opts = {}) {
    const hasAge = opts.age !== false && sport.hasAge;
    const cols = [
      { k: "rank", label: "Rk", cls: "r num", title: "Overall rank by value over replacement", sort: (p) => p.rank, asc: true, html: (p) => p.rank },
      { k: "name", label: "Player", td: "nm", sort: (p) => p.n, asc: true, html: (p) => `<span class="pn">${esc(p.n)}</span>${injTag(p)}` },
      { k: "team", label: "Team", cls: "ps", sort: (p) => p.t, asc: true, html: (p) => esc(p.t) },
      { k: "pos", label: "Pos", sort: (p) => p.prank, asc: true, html: (p) => posChips(sport, p) },
      { k: "prank", label: "Pos rk", cls: "r ps", hide: "s", title: "Rank at his position", sort: (p) => parseInt(String(p.prank).replace(/\D+/g, ""), 10), asc: true, html: (p) => esc(p.prank) },
    ];
    if (hasAge) cols.push({ k: "age", label: "Age", cls: "r num", hide: "s", sort: (p) => p.age, asc: true, html: (p) => (p.age ? p.age : "") });
    if (opts.money !== false) cols.push({ k: "$", label: "$", cls: "r num", title: "Auction value in this league", sort: (p) => p.$, html: (p) => (p.$ ? `<span class="dollar">${money(p.$)}</span>` : `<span class="ps">-</span>`) });
    cols.push({ k: "v", label: sport.scorings[opts.scoring] && sport.scorings[opts.scoring].type === "points" ? "Proj" : "Value", cls: "r num", title: "Season fantasy points projected, or summed category z-scores", sort: (p) => p.v, html: (p) => (p.v == null ? "-" : p.v.toFixed(sport.scorings[opts.scoring] && sport.scorings[opts.scoring].type === "points" ? 0 : 1)) });
    for (const [i, c] of sport.columns.entries()) {
      if (opts.group && c.group && c.group !== opts.group) continue;
      cols.push({ k: "s" + i, label: c.label, title: c.title, cls: "r num", hide: c.hide, sort: (p) => statCell(sport, p, c), html: (p) => { const v = statCell(sport, p, c); return v == null ? `<span class="ps">-</span>` : c.fmt(v); } });
    }
    if (opts.owner) cols.push({ k: "owner", label: "Team", cls: "ps", html: opts.owner });
    if (opts.actions) cols.push({ k: "act", label: "", cls: "r act", html: opts.actions });
    return (opts.lead || []).concat(cols);
  }
  // Search, position and team filters. st: { q, pos, team }; groups like "Hitters" come from sport.groups.
  function filterBar(sport, st, teams, extra = "") {
    const groups = sport.groups ? [["g:bat", "Hitters"], ["g:pit", "Pitchers"]] : [];
    const opt = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(l)}</option>`;
    return `<div class="tools"><label class="sr" for="fk-q">Search players</label><input type="search" id="fk-q" placeholder="Search players" value="${esc(st.q || "")}" autocomplete="off">
      <label class="sr" for="fk-pos">Position</label><select id="fk-pos" class="${st.pos ? "set" : ""}">${opt("", "All positions", st.pos || "")}${groups.map(([v, l]) => opt(v, l, st.pos)).join("")}${sport.positions.map((x) => opt(x, x, st.pos)).join("")}</select>
      ${teams ? `<label class="sr" for="fk-team">${esc(sport.league)} team</label><select id="fk-team" class="${st.team ? "set" : ""}">${opt("", `All ${sport.league} teams`, st.team || "")}${teams.map((t) => opt(t, t, st.team)).join("")}</select>` : ""}
      ${extra}</div>`;
  }
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

  // The player card. opts: { actions (html), note (html), scoring }
  function playerCard(sport, p, opts = {}) {
    const sc = sport.scorings[opts.scoring] || Object.values(sport.scorings)[0];
    const lines = Object.entries(sport.data.lines || {}).filter(([k]) => p.l[k]).map(([k, def]) => {
      const cols = def.cols.filter((c) => !/^(eg)$/.test(c));
      return `<div class="stack" style="gap:6px"><div class="ps"><b>${esc(def.label)}</b>, ${esc(sport.data.season)}</div><div class="sgrid">${cols.map((c) => { const v = S.stat(sport, p, k, c); const f = Number.isInteger(v) || Math.abs(v) >= 100 ? S.fmt.f0 : v < 1 && v > 0 && /avg|obp|ops|slg/.test(c) ? S.fmt.r3 : S.fmt.f1; return v == null || (v === 0 && /^(fgm|fga|xpm|def_|pts_allow)/.test(c) && sport.key === "nfl" && !S.positions(p).some((x) => x === "K" || x === "DEF")) ? "" : `<span><small>${esc(label(c))}</small><b>${f(v)}</b></span>`; }).join("")}</div></div>`;
    }).join("");
    const zs = sc.type === "cats" && p.zc ? `<div class="zbars" aria-label="Category strength">${sc.cats.filter((c) => p.zc[c.k] != null).map((c) => { const z = Math.max(-3, Math.min(3, p.zc[c.k])); const w = Math.abs(z) / 3 * 50; return `<span class="ps"><b>${esc(c.label)}</b></span><span class="zbar"><i class="${z < 0 ? "n" : ""}" style="${z < 0 ? `right:50%;width:${w}%` : `left:50%;width:${w}%`}"></i></span><span class="num ps r" style="text-align:right">${z >= 0 ? "+" : ""}${z.toFixed(1)}</span>`; }).join("")}</div>` : "";
    return `<h3 class="disp">${esc(p.n)}</h3>
      <div class="ps" style="margin-bottom:10px">${posChips(sport, p)} ${esc(p.t)}${p.age ? `, age ${p.age}` : ""}${p.inj ? `, <span class="bad">${esc(p.inj)}</span>` : ""}</div>
      <dl class="kv" style="margin:0 0 12px"><dt>Rank</dt><dd>${p.rank} overall, ${esc(p.prank)}</dd><dt>${sc.type === "points" ? "Projection" : "Value"}</dt><dd>${sc.type === "points" ? `${Math.round(p.v)} ${esc(sc.label)} points` : `${p.v.toFixed(1)} (summed z-scores)`}</dd><dt>Auction value</dt><dd>${p.$ ? money(p.$) : "Below the draftable pool"}</dd>${opts.note ? `<dt>Status</dt><dd>${opts.note}</dd>` : ""}</dl>
      <div class="stack">${zs}${lines}</div>${opts.actions ? `<div class="acts">${opts.actions}</div>` : ""}`;
  }
  const LABELS = { gp: "GP", g: "G", gs: "GS", min: "MIN", fgm: "FGM", fga: "FGA", ftm: "FTM", fta: "FTA", tpm: "3PM", pts: "PTS", reb: "REB", ast: "AST", stl: "STL", blk: "BLK", tov: "TO",
    pa: "PA", ab: "AB", r: "R", h: "H", hr: "HR", rbi: "RBI", sb: "SB", tb: "TB", bb: "BB", avg: "AVG", obp: "OBP", ops: "OPS", ip: "IP", w: "W", l: "L", sv: "SV", hld: "HLD", k: "K", er: "ER", era: "ERA", whip: "WHIP", qs: "QS",
    pass_yd: "Pass yd", pass_td: "Pass TD", pass_int: "INT", rush_att: "Rush", rush_yd: "Rush yd", rush_td: "Rush TD", rec: "Rec", rec_tgt: "Targets", rec_yd: "Rec yd", rec_td: "Rec TD", fum_lost: "Fum", fgm_: "FGM",
    xpm: "XPM", def_td: "Def TD", def_int: "Def INT", def_sack: "Sacks", pts_allow: "Pts allowed", pts_std: "Std pts", pts_half_ppr: "Half PPR", pts_ppr: "PPR" };
  const label = (c) => LABELS[c] || c.toUpperCase();

  /* ---------- draft room ---------- */
  /* FK.ui.room(opts) mounts a draft room into opts.el and returns { render, stop, ctx }.
       sport, players  an attached sport and its evaluated players
       draft()         returns the current draft document; save(D) is called after every change
       me()            your team id, or null to watch
       commish         true to show start, pause and undo
       drive           true if this page runs the clock (bots and autopicks); a league with a server sets false
       hooks           FK.draft hooks (a cap rule, a custom bot)
       onChange(D)     after every render-worthy change */
  function room(opts) {
    const { el, sport } = opts;
    const ui = { tab: "players", sort: { k: "rank", dir: 1 }, f: { q: "", pos: "", team: "" }, view: null, bidAmt: null };
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

    function tabs() {
      const d = D(), mine = me() != null;
      const t = [["players", "Players"], ["board", "Board"], ["picks", auction() ? "Sales" : "Picks"], ["teams", "Teams"]];
      if (mine) t.push(["queue", "My queue"]);
      if (d.phase === "done") t.unshift(["results", "Results"]);
      return t;
    }

    /* the band across the top: who's up, the timer, and the auction lot */
    function band() {
      const d = D(), n = now();
      if (d.phase === "setup") return `<div class="clock fk-band"><div class="wrap"><div><div class="disp on">Draft room is set</div><div class="ps">${esc(F.FORMATS[d.type])}, ${d.teams.length} teams, ${d.rounds} rounds${d.clock ? `, ${d.clock} seconds a pick` : ", no clock"}. Build your queue now; it picks for you if your clock runs out.</div></div><span class="grow"></span>${opts.commish ? `<button class="btn go" data-act="start">Start the draft</button>` : ""}</div></div>`;
      if (d.phase === "done") return `<div class="clock fk-band"><div class="wrap"><div><div class="disp on">Draft complete</div><div class="ps">${F.made(d).length} picks. Grades go by each team's best lineup.</div></div><span class="grow"></span>${opts.commish ? `<button class="btn sm" data-act="undo">Undo last ${auction() ? "sale" : "pick"}</button>` : ""}${opts.extra ? opts.extra() : ""}</div></div>`;
      const ctl = opts.commish ? `<button class="btn sm" data-act="pause">${d.paused ? "Resume" : "Pause"}</button><button class="btn sm" data-act="undo">Undo</button>` : "";
      if (auction()) {
        const st = F.auctionState(d, n);
        if (st.kind === "lot") {
          const lot = st.lot, p = ctx.byId[lot.pid], lead = team(lot.team), mine = me() != null && team(me());
          const can = mine && !isMe(lead) && F.maxBid(d, me()) > lot.bid && F.canAdd(d, ctx, me(), p).ok && !d.paused;
          const next = lot.bid + 1;
          return `<div class="clock fk-band"><div class="wrap lot">
            <div class="lot-p"><b class="disp">${esc(p.n)}</b><span class="ps">${posChips(sport, p)} ${esc(p.t)}, rank ${p.rank}, value ${money(p.$)}. Nominated by ${esc(team(lot.by).abbr)}</span></div>
            <div class="lot-b"><span class="ps">${isMe(lead) ? "Your bid" : esc(lead.name)}</span><b class="disp num${isMe(lead) ? " ok" : ""}">${money(lot.bid)}</b></div>
            <div class="lot-t"><span class="disp timer" id="fk-timer"></span></div>
            <div class="lot-a">${can ? `<button class="btn go" data-bid="${next}">Bid ${money(next)}</button><button class="btn" data-bid="${Math.min(F.maxBid(d, me()), lot.bid + 5)}">${money(Math.min(F.maxBid(d, me()), lot.bid + 5))}</button>
              <label class="sr" for="fk-bid">Your bid</label><input type="number" id="fk-bid" min="${next}" max="${F.maxBid(d, me())}" value="${ui.bidAmt && ui.bidAmt > lot.bid ? ui.bidAmt : next}"><button class="btn" data-act="bid">Bid</button>${(lot.passed || []).includes(me()) ? `<span class="ps">You passed</span>` : `<button class="btn ghost" data-act="pass">Pass</button>`}` : mine ? `<span class="ps">${isMe(lead) ? "You're the high bid." : F.maxBid(d, me()) <= lot.bid ? `Your max bid is ${money(F.maxBid(d, me()))}.` : F.canAdd(d, ctx, me(), p).why || ""}</span>` : ""}${ctl}</div>
          </div></div>${budgets()}`;
        }
        const nom = team(st.team);
        return `<div class="clock fk-band"><div class="wrap"><div><div class="disp on${isMe(nom) ? " me" : ""}">${isMe(nom) ? "Your nomination" : esc(nom.name) + " is nominating"}</div><div class="ps">${isMe(nom) ? "Pick a player below and set an opening bid." : F.isBot(nom) ? "Bot nominating" : "Waiting for a nomination"}${d.paused ? ". Paused" : ""}</div></div><span class="grow"></span><span class="disp timer" id="fk-timer"></span>${ctl}</div></div>${budgets()}`;
      }
      const c = F.onClock(d, n);
      const t = team(c.team), mine = isMe(t);
      const next = me() != null ? F.nextPickOf(d, me()) : null;
      return `<div class="clock fk-band"><div class="wrap"><div><div class="disp on${mine ? " me" : ""}">${mine ? "You're on the clock" : esc(t.name) + " on the clock"}</div>
        <div class="ps">Round ${c.round}, pick ${c.inRound} (${c.pick} of ${c.total})${F.isBot(t) ? ", bot" : ""}${next && !mine ? `. Your next pick: ${next} (${next - c.pick} away)` : ""}${d.paused ? ". Paused" : ""}</div></div>
        <span class="grow"></span><span class="disp timer" id="fk-timer"></span>${mine ? `<button class="btn go" data-act="autome">Autopick</button>` : ""}${ctl}</div></div>`;
    }
    function budgets() {
      const d = D(), lot = d.auction.lot;
      return `<div class="wrap" style="padding-top:6px"><div class="budgets">${d.round1.map((id) => { const t = team(id); return `<span class="${isMe(t) ? "me" : ""}${lot && lot.team === id ? " lead" : ""}" title="${esc(t.name)}: ${F.spotsLeft(d, id)} spots left, max bid ${money(F.maxBid(d, id))}"><b>${esc(t.abbr)}</b> ${money(t.budget)} <span class="ps">${F.spotsLeft(d, id)} left</span></span>`; }).join("")}</div></div>`;
    }

    /* pages */
    function players() {
      const d = D(), n = now(), mine = me();
      const c = !auction() && d.phase === "live" ? F.onClock(d, n) : null;
      const myTurn = c && c.team === mine;
      const st = auction() && d.phase === "live" ? F.auctionState(d, n) : null;
      const myNom = st && st.kind === "nominate" && st.team === mine;
      const show = ui.f.show || "avail";
      let rows = (show === "all" ? opts.players : ctx.available).filter((p) => passes(sport, p, ui.f));
      const actions = (p) => {
        const taken = ctx.own[p.id] != null;
        if (taken) return `<span class="ps">${esc(team(ctx.own[p.id]).abbr)}</span>`;
        if (mine == null) return "";
        const ok = F.canAdd(d, ctx, mine, p).ok;
        const q = team(mine).queue.includes(p.id);
        return `${myTurn && ok ? `<button class="btn sm go" data-pick="${esc(p.id)}">Draft</button> ` : ""}${myNom && ok ? `<button class="btn sm go" data-nominate="${esc(p.id)}">Nominate</button> ` : ""}<button class="btn sm" data-queue="${esc(p.id)}">${q ? "Queued" : "Queue"}</button>`;
      };
      const cols = poolColumns(sport, { group: groupOf(sport, ui.f), scoring: d.scoring, actions });
      rows = sortRows(rows, cols, ui.sort);
      const extra = `<label class="sr" for="fk-show">Show</label><select id="fk-show" class="${show !== "avail" ? "set" : ""}"><option value="avail"${show === "avail" ? " selected" : ""}>Available</option><option value="all"${show === "all" ? " selected" : ""}>All players</option></select>`;
      return `${filterBar(sport, ui.f, null, extra)}${table({ cols, rows, sort: ui.sort, dense: true, id: "fk-pool", limit: 250, empty: "No one matches.",
        rowAttr: (p) => `data-player="${esc(p.id)}" class="${mine != null && ctx.own[p.id] == null && !F.canAdd(d, ctx, mine, p).ok ? "dim" : ""}"` })}`;
    }
    function boardCells() {
      const d = D(), n = d.teams.length, rounds = d.rounds;
      const cols = d.round1;
      const cellOf = (r, col) => {
        if (auction()) { const s = d.sales.filter((x) => x.team === cols[col])[r]; return s ? { pk: s, label: money(s.price) } : null; }
        for (let k = r * n; k < (r + 1) * n; k++) if (d.order[k] === cols[col]) return { pk: d.board[k], k };
        return null;
      };
      const nowK = !auction() && d.phase === "live" ? F.onClock(d, now()).index : -1;
      let cells = `<div></div>${cols.map((id) => { const t = team(id); return `<div class="h${isMe(t) ? " me" : ""}" title="${esc(t.name)}${t.owner ? ", " + esc(t.owner) : ", bot"}"><b>${esc(t.abbr)}</b><small>${auction() ? money(t.budget) + " left" : esc(t.owner || "bot")}</small></div>`; }).join("")}`;
      for (let r = 0; r < rounds; r++) {
        cells += `<div class="rn">${r + 1}</div>`;
        for (let col = 0; col < n; col++) {
          const x = cellOf(r, col), t = team(cols[col]);
          const pk = x && x.pk, p = pk && pk.pid && ctx.byId[pk.pid];
          const cls = ["cell", p ? "f c" + colorOf(sport, p) : "", isMe(t) ? "me" : "", x && x.k === nowK ? "now" : "", pk && pk.keeper ? "keep" : ""].join(" ").replace(/\s+/g, " ");
          cells += `<div class="${cls}"${p ? ` data-player="${esc(p.id)}" role="button" tabindex="0" title="${esc(p.n)}${pk.auto ? ", autopick" : ""}"` : ""}>${p ? `<b>${esc(last(p.n))}</b><small>${S.positions(p).join("/")} ${esc(p.t)}${x.label ? " " + x.label : ""}</small>` : pk ? "<b>Passed</b>" : x && x.k != null ? `<small class="ps">${r + 1}.${col + 1}</small>` : ""}</div>`;
        }
      }
      return `<div class="board" id="fk-board"><div class="bgrid" style="--n:${n};grid-template-columns:30px repeat(${n},minmax(0,1fr));grid-template-rows:auto repeat(${rounds},minmax(48px,auto))">${cells}</div></div>`;
    }
    function picks() {
      const d = D(), list = F.made(d).reverse();
      return `<div class="card" style="flex:1;min-height:0;display:flex;flex-direction:column;padding:8px 12px">${list.length ? `<ol class="picks">${list.map((pk) => { const t = team(pk.team), p = ctx.byId[pk.pid];
        return `<li class="${isMe(t) ? "me" : ""}"><span class="no">${auction() ? money(pk.price) : pk.n}</span><span>${p ? `<button class="btn link" data-player="${esc(p.id)}">${esc(p.n)}</button> ${posChips(sport, p)} <span class="ps">${esc(p.t)}</span>` : "<b>Passed</b>"}<br><span class="ps">${auction() ? "" : `Round ${Math.ceil(pk.n / d.teams.length)}: `}${esc(t.name)}${pk.keeper ? ", keeper" : pk.auto ? ", autopick" : ""}</span></span><span class="ps r">${p ? `rank ${p.rank}` : ""}</span></li>`; }).join("")}</ol>` : `<p class="empty">No ${auction() ? "sales" : "picks"} yet.</p>`}</div>`;
    }
    function teamPage() {
      const d = D();
      const id = ui.view != null ? ui.view : me() != null ? me() : d.round1[0];
      const t = team(id);
      const ps = F.rosters(d)[id].map((x) => ctx.byId[x]).filter(Boolean);
      const starters = F.assign(sport, ps, d.lineup);
      const bench = ps.filter((p) => !starters.includes(p));
      const cost = (p) => { const s = auction() ? d.sales.find((x) => x.pid === p.id) : null; return s ? money(s.price) : ""; };
      const row = (slot, p) => `<tr${p ? ` data-player="${esc(p.id)}"` : ""}><td><span class="pp c${slot === "BN" ? 6 : (sport.colors[(sport.slots[slot] || [])[0]] || 6)}">${esc(slot)}</span></td><td class="nm">${p ? `<span class="pn">${esc(p.n)}</span>${injTag(p)}` : `<span class="ps">Open</span>`}</td><td>${p ? posChips(sport, p) : ""}</td><td class="ps">${p ? esc(p.t) : ""}</td><td class="r num">${p ? p.rank : ""}</td>${auction() ? `<td class="r num">${p ? cost(p) : ""}</td>` : ""}<td class="r num">${p ? (p.v || 0).toFixed(1) : ""}</td></tr>`;
      return `<div class="tools"><label class="sr" for="fk-view">Team</label><select id="fk-view">${d.round1.map((x) => `<option value="${x}"${x === id ? " selected" : ""}>${esc(team(x).name)}${isMe(team(x)) ? " (you)" : ""}</option>`).join("")}</select>
        <span class="ps">${ps.length} of ${F.sizeOf(d)} spots${auction() ? `, ${money(t.budget)} left, max bid ${money(F.maxBid(d, id))}` : ""}</span></div>
        <div class="table-wrap"><table class="t dense"><thead><tr><th>Slot</th><th>Player</th><th>Pos</th><th>Team</th><th class="r">Rk</th>${auction() ? `<th class="r">Paid</th>` : ""}<th class="r">Value</th></tr></thead><tbody>
        ${d.lineup.map((s, i) => row(s, starters[i])).join("")}${bench.map((p) => row("BN", p)).join("")}${Array.from({ length: Math.max(0, d.bench - bench.length) }, () => row("BN", null)).join("")}</tbody></table></div>`;
    }
    function queue() {
      const d = D(), t = team(me());
      return `<p class="ps" style="margin:0">If your clock runs out${auction() ? " or it's your nomination" : ""}, the first player here who is still available and fits is your ${auction() ? "nomination" : "pick"}. Add players from the Players page.</p>
        <div class="table-wrap"><table class="t dense"><thead><tr><th class="r">#</th><th>Player</th><th>Pos</th><th class="r">Rk</th><th>Status</th><th></th></tr></thead><tbody>
        ${t.queue.map((id, i) => { const p = ctx.byId[id]; const taken = ctx.own[id] != null; return `<tr class="${taken ? "dim" : ""}"><td class="r num">${i + 1}</td><td class="nm"><button class="btn link" data-player="${esc(id)}">${esc(p.n)}</button></td><td>${posChips(sport, p)}</td><td class="r num">${p.rank}</td><td>${taken ? "Taken" : F.canAdd(d, ctx, me(), p).ok ? `<span class="ok">Fits</span>` : `<span class="bad">Won't fit</span>`}</td>
          <td class="r"><button class="btn sm" data-qup="${esc(id)}"${i ? "" : " disabled"}>Up</button> <button class="btn sm" data-queue="${esc(id)}">Remove</button></td></tr>`; }).join("") || `<tr><td colspan="6" class="empty">Your queue is empty.</td></tr>`}</tbody></table></div>`;
    }
    function results() {
      const d = D(), st = F.standings(d, ctx).sort((a, b) => a.rank - b.rank);
      const sc = sport.scorings[d.scoring] || Object.values(sport.scorings)[0];
      return `<div style="overflow:auto;flex:1;min-height:0"><div class="teams">${st.map((r) => { const t = team(r.team);
        return `<div class="card${isMe(t) ? " me" : ""}" style="${isMe(t) ? "border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)" : ""}"><div style="display:flex;align-items:flex-end;gap:10px;margin-bottom:6px"><b class="disp grade">${r.grade}</b><div><b>${esc(t.name)}</b>${isMe(t) ? ` <span class="tag you">You</span>` : ""}<div class="ps">${ord(r.rank)}, ${sc.type === "points" ? `${Math.round(r.score)} projected starter points` : `${r.score.toFixed(1)} starter value`}${r.spent != null ? `, spent ${money(r.spent)}` : ""}</div></div></div>
          <ol>${r.starters.filter(Boolean).map((p) => `<li>${posChips(sport, p)}<button class="btn link" data-player="${esc(p.id)}">${esc(p.n)}</button><span class="grow"></span><span class="ps">${p.rank}</span></li>`).join("")}</ol></div>`; }).join("")}</div></div>`;
    }

    /* render and wire */
    function render() {
      const d = D();
      const tl = tabs();
      if (d.phase === "done" && ui.phase && ui.phase !== "done") ui.tab = "results";   // the draft just ended
      ui.phase = d.phase;
      if (!tl.some((x) => x[0] === ui.tab)) ui.tab = tl[0][0];
      const keep = { q: document.activeElement && document.activeElement.id, scroll: {} };
      $$("#fk-pool,#fk-board,.picks", el).forEach((x) => (keep.scroll[x.id || x.className] = x.scrollTop));
      const sel = keep.q === "fk-q" || keep.q === "fk-bid" ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
      const body = { players, board: boardCells, picks, teams: teamPage, queue, results }[ui.tab]();
      el.innerHTML = `<nav class="fk-subs" aria-label="Draft room"><div class="wrap">${tl.map(([k, n]) => `<a href="#" data-tab="${k}"${ui.tab === k ? ' aria-current="page"' : ""}>${esc(n)}</a>`).join("")}</div></nav>${band()}<div class="wrap room" id="fk-room"><div class="pane">${body}</div></div>`;
      const top = el.querySelector("#fk-room").getBoundingClientRect().top + window.scrollY;
      document.documentElement.style.setProperty("--top", Math.round(top) + "px");
      $$("#fk-pool,#fk-board,.picks", el).forEach((x) => { const v = keep.scroll[x.id || x.className]; if (v) x.scrollTop = v; });
      if (keep.q) { const f = document.getElementById(keep.q); if (f) { f.focus(); if (sel) try { f.setSelectionRange(sel[0], sel[1]); } catch (e) { /* number input */ } } }
      drawTimer();
      if (opts.onChange) opts.onChange(d);
    }
    function drawTimer() {
      const t = $("#fk-timer", el);
      if (!t) return;
      const d = D(), n = now();
      let left = null;
      if (auction()) { const st = F.auctionState(d, n); left = st ? st.left : null; }
      else { const c = F.onClock(d, n); left = c ? c.left : null; }
      t.textContent = left == null || !Number.isFinite(left) ? "" : fmtLeft(left);
      t.classList.toggle("hot", Number.isFinite(left) && left < 10000);
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
      if (can && can.ok && c && c.team === mine) actions += `<button class="btn go" data-card="pick">Draft ${esc(last(p.n))}</button>`;
      if (can && can.ok && st && st.kind === "nominate" && st.team === mine) actions += `<button class="btn go" data-card="nominate">Nominate</button>`;
      if (mine != null && !taken) actions += `<button class="btn" data-card="queue">${team(mine).queue.includes(pid) ? "Remove from queue" : "Add to queue"}</button>`;
      const note = taken ? `Drafted by ${esc(team(ctx.own[pid]).name)}` : can && !can.ok ? `<span class="bad">${esc(can.why)}</span>` : "";
      const Dl = dialog(playerCard(sport, p, { scoring: d.scoring, actions, note }), null, { wide: true });
      $$("[data-card]", Dl).forEach((b) => b.addEventListener("click", () => {
        const a = b.dataset.card;
        if (a === "pick") { if (act(() => F.pick(D(), ctx, mine, pid, now()))) Dl.close(); }
        else if (a === "nominate") { Dl.close(); nominateDialog(pid); }
        else { toggleQueue(pid); Dl.close(); }
      }));
    }
    function nominateDialog(pid) {
      const d = D(), p = ctx.byId[pid], max = F.maxBid(d, me());
      dialog(`<h3>Nominate ${esc(p.n)}</h3><p class="ps">Value ${money(p.$)}. You can bid up to ${money(max)}.</p><form class="stack"><div class="field"><label for="fk-open">Opening bid</label><input type="number" id="fk-open" name="amt" min="${d.auction.minBid}" max="${max}" value="${d.auction.minBid}"></div><div class="acts"><button type="button" class="btn" data-close>Cancel</button><button class="btn go">Nominate</button></div></form>`,
        (fd) => act(() => F.nominate(D(), ctx, me(), pid, +fd.get("amt"), now())));
    }
    function toggleQueue(pid) {
      const t = team(me());
      if (t.queue.includes(pid)) t.queue = t.queue.filter((x) => x !== pid); else t.queue.push(pid);
      save(); render();
    }

    el.addEventListener("click", (e) => {
      const tb = e.target.closest("[data-tab]");
      if (tb) { e.preventDefault(); ui.tab = tb.dataset.tab; render(); return; }
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
          else if (a === "autome") { const p = F.autoChoice(d, ctx, me(), F.rng(d.seed + 99 + F.made(d).length)); if (p) act(() => F.pick(d, ctx, me(), p.id, n, true)); }
        }
        return;
      }
      const pl = e.target.closest("[data-player]");
      if (pl) { e.preventDefault(); openCard(pl.dataset.player); }
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
      if (e.target.id === "fk-pos") { ui.f.pos = e.target.value; render(); }
      if (e.target.id === "fk-show") { ui.f.show = e.target.value; render(); }
      if (e.target.id === "fk-view") { ui.view = +e.target.value; render(); }
    });

    // The clock: redraw the timer, and when this page drives the draft, let bots and expired clocks move it.
    let lastSig = "";
    const sig = () => { const d = D(); return [d.phase, d.paused, F.made(d).length, d.auction && d.auction.lot ? d.auction.lot.bid + ":" + d.auction.lot.team : ""].join("|"); };
    timer = setInterval(() => {
      if (opts.drive && D().phase === "live" && !dialogOpen()) {
        const moved = F.tick(D(), ctx, now(), 3);
        if (moved) save();
      }
      const s = sig();
      if (s !== lastSig) { lastSig = s; if (!dialogOpen()) render(); else drawTimer(); } else drawTimer();
    }, 250);

    render();
    lastSig = sig();
    return { render, stop: () => clearInterval(timer), get ctx() { return ctx; }, refresh: () => { refresh(); render(); }, ui };
  }

  FK.ui = { esc, $, $$, store, toast, dialog, dialogOpen, theme, fmtLeft, money, ord, last, posChip, posChips, colorOf,
    shell, route, table, sortRows, nextSort, poolColumns, filterBar, passes, groupOf, playerCard, room, statCell, label };
})(this);
