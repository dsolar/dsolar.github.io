/* CBB Hub: lines, ratings, matchups, Naismith Watch and the NBA Big Board's college prospects.
   Built on the MLB hub's styles (../mlb/hub.css) like the other hubs. Data: data/hub.json (ratings, rosters, games)
   and data/extras.json (Naismith ladder, the hub's logged pregame lines and its record), both refreshed by GitHub Actions. */
(function () {
"use strict";
const M = window.CBB, $ = s => document.querySelector(s), view = $("#view");
const esc = x => String(x == null ? "" : x).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safe = x => /^https?:\/\//.test(x || "") ? esc(x) : "#";
const fin = M.finite;
const f1 = (x, d = 1) => fin(x) ? Number(x).toFixed(d) : "—";
const sg = (x, d = 1) => fin(x) ? (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(Number(x)).toFixed(d) : "—";
const pct = x => fin(x) ? (x >= 0.995 ? ">99" : x <= 0.005 && x > 0 ? "<1" : Math.round(x * 100)) + "%" : "—";
const half = x => (Math.round(Math.abs(x) * 2) / 2).toFixed(1);
const int = x => fin(x) ? String(Math.round(x)) : "—";
function read(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }

let D = null, X = null, BOARD = null, boardLoading = null, byId = {}, byPlayer = {}, rosters = {}, avg = null, liveStamp = null;
let pctNet = {}, pctTempo = {}, rankO = {}, rankD = {}, naiRank = {}, faves = new Set(read("ds-cbb:favorites", []));

/* ---------- small pieces ---------- */
function route() { const [p, q] = (location.hash.replace(/^#\/?/, "") || "today").split("?"); return { page: p || "today", q: new URLSearchParams(q || "") }; }
function go(page, params) { const q = new URLSearchParams(); for (const [k, v] of Object.entries(params || {})) if (v !== null && v !== undefined && v !== "" && v !== false) q.set(k, v); location.hash = "#/" + page + (q.size ? "?" + q : ""); }
function setParams(values) { const r = route(); for (const [k, v] of Object.entries(values)) { if (v === null || v === "" || v === false || v === undefined) r.q.delete(k); else r.q.set(k, String(v)); } history.replaceState(null, "", "#/" + r.page + (r.q.size ? "?" + r.q : "")); render(); }
function dayNY(d = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d); }
function dLabel(x, opt) { if (!x) return ""; const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(x) ? x + "T12:00:00Z" : x); return Number.isFinite(+d) ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", ...(opt || {}) }).format(d) : esc(x); }
function tip(g) { return g.at ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(g.at)) : "TBA"; }
const logo = (t, cls = "logo") => t && t.logo ? '<img class="' + cls + '" src="' + safe(t.logo) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' : '<span class="' + cls + ' lm">' + esc((t && t.abbr || "?").slice(0, 4)) + "</span>";
const rk = t => fin(t && t.haslamRank) ? '<span class="rk">' + Math.round(t.haslamRank) + "</span>" : '<span class="rk"></span>';
const teamLink = (t, opts = {}) => t ? '<a class="tl" href="#/team?id=' + esc(t.id) + '">' + (opts.logo === false ? "" : logo(t)) + (opts.rank ? rk(t) : "") + '<span class="nm">' + esc(t.short) + "</span></a>" : "—";
const rec = t => t && t.record && fin(t.record.w) ? int(t.record.w) + "-" + int(t.record.l) : "—";
const crec = t => t && t.record && fin(t.record.cw) ? int(t.record.cw) + "-" + int(t.record.cl) : "—";
const proj = t => t && t.projection && fin(t.projection.wins) ? Math.round(t.projection.wins) + "-" + Math.round(t.projection.losses) : "—";
const face = (p, s) => p && p.head ? '<img class="hs" style="--s:' + (s || 28) + 'px" src="' + safe(p.head) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' : '<span class="hs" style="--s:' + (s || 28) + 'px"></span>';
const stat = (p, k) => p && p.stats ? M.num(p.stats[k]) : null;
const hasGames = p => (stat(p, "pts") || stat(p, "reb") || stat(p, "ast")) ? true : false;
function tier(p) { return p === null || p === undefined ? "" : p >= 90 ? "T-Elite" : p >= 70 ? "T-Strong" : p >= 35 ? "T-Average" : p >= 15 ? "T-Weak" : "T-Fringe"; }
function badges(p) {
  let s = "";
  if (naiRank[p.id]) s += ' <span class="pill nai" title="Naismith Trophy watch list · hub ladder #' + naiRank[p.id] + '">Naismith #' + naiRank[p.id] + "</span>";
  if (fin(p.draftRank)) s += ' <span class="pill bb" title="NBA Big Board consensus rank">Board #' + p.draftRank + "</span>";
  return s;
}
const playerLink = p => '<span class="pl" data-player="' + esc(p.id) + '" role="button" tabindex="0">' + face(p) + '<span class="nm">' + esc(p.name) + "</span></span>";
function seg(param, options, value) { return '<div class="seg" role="group">' + options.map(([v, l]) => '<button type="button" data-seg="' + esc(param) + '" data-v="' + esc(v) + '" aria-pressed="' + (String(value) === String(v)) + '">' + esc(l) + "</button>").join("") + "</div>"; }
function confSelect(value, label = "Conference") { const cs = [...new Set(D.teams.map(t => t.conference).filter(Boolean))].sort(); return '<label>' + label + '<select data-param="conf"><option value="">All</option>' + cs.map(c => '<option' + (c === value ? " selected" : "") + ">" + esc(c) + "</option>").join("") + "</select></label>"; }
function teamSelect(param, value, label) { return '<label>' + label + '<select data-param="' + param + '"><option value="">Choose a team</option>' + D.teams.slice().sort((a, b) => a.short.localeCompare(b.short)).map(t => '<option value="' + esc(t.id) + '"' + (t.id === value ? " selected" : "") + ">" + esc(t.short) + "</option>").join("") + "</select></label>"; }
function sortTh(key, label, cur, title) { return '<th class="sort' + (cur === key ? " on" : "") + '" data-sort="' + key + '"' + (title ? ' title="' + esc(title) + '"' : "") + ">" + label + (cur === key ? " ▾" : "") + "</th>"; }
function star(t) { const on = faves.has(t.id); return '<button class="star" type="button" data-fav="' + esc(t.id) + '" aria-pressed="' + on + '" title="' + (on ? "Following" : "Follow") + '">' + (on ? "★" : "☆") + "</button>"; }

/* ---------- season simulation ---------- */
const SIM = () => X && X.season && X.season.teams ? X.season : null;
const odds = id => { const S_ = SIM(); return S_ ? S_.teams[id] : null; };
const ROUNDS = ["R64", "R32", "Sweet 16", "Elite 8", "Final Four", "Title game", "Champion"];
function titleStrip(n) {
  const S_ = SIM(); if (!S_) return "";
  const top = Object.entries(S_.teams).sort((a, b) => b[1].r[6] - a[1].r[6]).slice(0, n || 8);
  return '<div class="cupstrip">' + top.map(([id, o]) => { const t = byId[id]; return '<a href="#/team?id=' + esc(id) + '">' + logo(t) + "<div><b>" + pct(o.r[6]) + "</b><span>" + esc(t.short) + "</span></div></a>"; }).join("") + "</div>";
}

/* ---------- lines ---------- */
function lineFor(g) { return M.line(byId[g.home], byId[g.away], !!g.neutral, avg); }
function loggedLine(g) { return X && X.lines && X.lines.games ? X.lines.games[g.id] : null; }
function favLine(l, home, away) { if (!l) return "—"; if (Math.abs(l.spread) < 0.5) return "Pick'em"; const f = l.spread > 0 ? home : away; return esc(f.short) + " −" + half(l.spread); }
function watchIndex(g, l) {
  const a = byId[g.home], b = byId[g.away]; if (!a || !b || !l) return 0;
  const q = ((pctNet[a.id] || 0) + (pctNet[b.id] || 0)) / 2, close = 1 - Math.abs(l.homeProb - 0.5) * 2, pace = ((pctTempo[a.id] || 50) + (pctTempo[b.id] || 50)) / 2;
  const stars = [...(rosters[a.id] || []), ...(rosters[b.id] || [])], pros = stars.filter(p => fin(p.draftRank) && p.draftRank <= 60).length, nai = stars.filter(p => naiRank[p.id]).length;
  let s = 0.5 * q + 30 * close + 0.05 * pace + Math.min(12, 4 * pros) + Math.min(10, 4 * nai) + (a.conference === b.conference ? 4 : 0) + (g.state === "in" ? 10 : 0);
  return Math.max(0, Math.min(100, Math.round(s)));
}
function upsetAlert(l, g) { if (!l || g.state !== "pre") return false; const dog = Math.min(l.homeProb, 1 - l.homeProb), fav = l.spread > 0 ? byId[g.home] : byId[g.away]; return dog >= 0.3 && fin(fav.haslamRank) && fav.haslamRank <= 50; }

/* ---------- game card ---------- */
/* ---------- public betting (data/betting.json, from tools/betting_pull.py) ---------- */
// Action Network's share of bets (tickets) and bet count, and Kalshi's price on each team's "wins" market.
// Money percentages are an Action Network PRO feature and never reach this file.
let BET = null;
fetch("data/betting.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((b) => { BET = b; if (D && ["today", "team", "matchup"].includes(route().page)) render(); }).catch(() => {});
const kfmt = (v) => (v >= 10000 ? Math.round(v / 1000) + "K" : v >= 1000 ? (v / 1000).toFixed(1) + "K" : String(Math.round(v)));
const lineTxt = (v) => (Math.abs(v) < 0.25 ? "PK" : (v > 0 ? "+" : "−") + half(v).replace(/\.0$/, ""));
const betOk = (p) => fin(p) && p > 0 && p < 100; // a 0/100 split means one side has no data yet
function betBrief(gid, h, a) { // schedule cell: the side most bets are on
  const b = BET && BET.games && BET.games[gid], x = b && b.an; if (!x || !h || !a) return "";
  const tip = ' title="Share of bets across the books Action Network tracks' + (x.n ? ", " + x.n.toLocaleString() + " bets" : "") + '"';
  if (x.sp && fin(x.sp[0]) && betOk(x.sp[1])) { const hs = x.sp[1] >= 50, t = hs ? h : a; return "<span" + tip + "><b>" + Math.round(hs ? x.sp[1] : 100 - x.sp[1]) + "%</b> " + esc(t.abbr || t.short) + " " + lineTxt(hs ? x.sp[0] : -x.sp[0]) + "</span>"; }
  if (x.ml && betOk(x.ml[2])) { const hs = x.ml[2] >= 50, t = hs ? h : a; return "<span" + tip + "><b>" + Math.round(hs ? x.ml[2] : 100 - x.ml[2]) + "%</b> " + esc(t.abbr || t.short) + " ML</span>"; }
  return "";
}
function betPanel(g, h, a) { // matchup page: the full row for the game these two actually play
  const row = g ? betRow(g, h, a) : ""; if (!row) return "";
  return '<div class="panel betbox"><h3>Public betting <small>' + (g.state === "pre" ? "updates until " + (g.at ? "tip" : "start") : "closing numbers") + "</small></h3>" + row + "</div>";
}
function betRow(g, h, a) {
  const b = BET && BET.games && BET.games[g.id]; if (!b) return "";
  const x = b.an, k = b.k, bits = [];
  let book = "";
  if (x && x.sp && fin(x.sp[0])) { const hf = x.sp[0] <= 0, t = hf ? h : a; book = '<span title="Action Network consensus line' + (x.op && fin(x.op[0]) && x.op[0] !== x.sp[0] ? "; opened " + esc((x.op[0] <= 0 ? h : a).abbr || "") + " " + lineTxt(-Math.abs(x.op[0])) : "") + '">Book <b>' + (Math.abs(x.sp[0]) < 0.25 ? "PK" : esc(t.abbr || t.short) + " " + lineTxt(-Math.abs(x.sp[0]))) + "</b>" + (x.op && fin(x.op[0]) && x.op[0] !== x.sp[0] ? " <small>opened " + lineTxt(-Math.abs(x.op[0])) + "</small>" : "") + "</span>"; }
  const ok = betOk;
  if (x && x.sp && fin(x.sp[0]) && ok(x.sp[1])) { const hs = x.sp[1] >= 50, t = hs ? h : a; bits.push("<b>" + Math.round(hs ? x.sp[1] : 100 - x.sp[1]) + "%</b> " + esc(t.abbr || t.short) + " " + lineTxt(hs ? x.sp[0] : -x.sp[0])); }
  else if (x && x.ml && ok(x.ml[2])) { const hs = x.ml[2] >= 50, t = hs ? h : a; bits.push("<b>" + Math.round(hs ? x.ml[2] : 100 - x.ml[2]) + "%</b> " + esc(t.abbr || t.short) + " to win"); }
  if (x && x.tot && fin(x.tot[0]) && ok(x.tot[1])) bits.push("<b>" + Math.round(Math.max(x.tot[1], 100 - x.tot[1])) + "%</b> " + (x.tot[1] >= 50 ? "over" : "under") + " " + x.tot[0]);
  const bets = bits.length ? '<span title="Share of bets (tickets) across the books Action Network tracks' + (x.n ? ", " + x.n.toLocaleString() + " bets" : "") + '">Bets ' + bits.join(" · ") + (x.n ? ' <small>' + kfmt(x.n) + " bets</small>" : "") + "</span>" : "";
  let mk = "";
  if (k && fin(k.h) && fin(k.a) && (k.v || 0) >= 500) { const hf = k.h >= k.a, t = hf ? h : a; mk = '<span title="Kalshi price on each team\'s wins market (cents on the dollar), ' + Math.round(k.v).toLocaleString() + ' contracts traded">Kalshi <b>' + esc(t.abbr || t.short) + " " + Math.round(100 * (hf ? k.h : k.a)) + "¢</b> <small>" + kfmt(k.v) + " traded</small></span>"; }
  return book || bets || mk ? '<div class="bets">' + book + bets + mk + "</div>" : "";
}

// Value watch: where the hub's own line and the market disagree, especially with the public on the other side.
// Same definitions as tools/value_grade.py, which grades each signal against the closing line all season.
let VAL = null;
fetch("data/value.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((v) => { VAL = v; if (D && ["today"].includes(route().page)) render(); }).catch(() => {});
function recTxt(k) { const r = VAL && VAL.records && VAL.records[k]; if (!r || r[0] + r[1] === 0) return "no graded games yet"; return r[0] + "-" + r[1] + (r[2] ? "-" + r[2] : "") + " (" + Math.round((100 * r[0]) / (r[0] + r[1])) + "%)"; }
function betSignals(g, l) {
  const b = BET && BET.games && BET.games[g.id], x = b && b.an;
  if (!x || !l || !x.sp || !fin(x.sp[0]) || !fin(l.spread)) return null;
  const R = (VAL && VAL.rules) || { hubEdge: 3, publicMax: 40, totalEdge: 4 };
  const close = x.sp[0], edge = l.spread + close, side = edge > 0 ? 1 : -1;
  const pct = betOk(x.sp[1]) ? (side === 1 ? x.sp[1] : 100 - x.sp[1]) : null, o = x.op && fin(x.op[0]) ? x.op[0] : null;
  const s1 = Math.abs(edge) >= R.hubEdge, s2 = s1 && pct !== null && pct < R.publicMax, s3 = s2 && o !== null && o !== close && Math.abs(l.spread + close) < Math.abs(l.spread + o);
  const bt = x.tot && fin(x.tot[0]) ? x.tot[0] : null, tot = bt !== null && fin(l.total) ? l.total - bt : null;
  return { edge, side, pct, s1, s2, s3, t1: tot !== null && Math.abs(tot) >= R.totalEdge, tot, close, open: o, bt };
}
function valuePills(g, l, h, a) {
  if (g.state !== "pre") return "";
  const s = betSignals(g, l); if (!s) return "";
  const t = s.side === 1 ? h : a, line = lineTxt(s.side === 1 ? s.close : -s.close), hubLine = lineTxt(s.side === 1 ? -l.spread : l.spread);
  let out = "";
  if (s.s2) out += '<span class="pill val" title="Hub has ' + esc(t.short) + " at " + hubLine + " against the book's " + line + ", and only " + Math.round(s.pct) + "% of bets are on " + esc(t.short) + (s.s3 ? ". The line has moved toward the hub's number since it opened" : "") + ". This signal against the closing line this season: " + recTxt(s.s3 ? "s3" : "s2") + '.">Value' + (s.s3 ? "+" : "") + ": " + esc(t.abbr || t.short) + " " + line + "</span>";
  else if (s.s1 && true) out += '<span class="pill" title="Hub has ' + esc(t.short) + " at " + hubLine + " against the book's " + line + ". Hub disagreements of this size against the closing line this season: " + recTxt("s1") + '.">Hub vs book</span>';
  if (s.t1) out += '<span class="pill" title="Hub total ' + half(l.total) + " against the book's " + s.bt + ". Totals disagreements of this size this season: " + recTxt("t1") + '.">Hub ' + (s.tot > 0 ? "over" : "under") + " " + s.bt + "</span>";
  return out;
}
function valueBoard() {
  if (!VAL || !VAL.records) return "";
  const rows = [["s1", "Hub disagrees with the book by " + VAL.rules.hubEdge + "+ points"], ["s2", "...and under " + VAL.rules.publicMax + "% of bets are on the hub's side"], ["s3", "...and the line has moved toward the hub"], ["t1", "Hub total off the book's by " + VAL.rules.totalEdge + "+ points"], ["pub", "The heavy public side (70%+ of bets)"]];
  const cell = (k) => { const r = VAL.records[k], n = r[0] + r[1], p = n ? (100 * r[0]) / n : null; return '<td class="num">' + r[0] + "-" + r[1] + (r[2] ? "-" + r[2] : "") + '</td><td class="num"><b class="' + (p === null ? "" : p >= 52.4 ? "pos" : "neg") + '">' + (p === null ? "—" : p.toFixed(1) + "%") + "</b></td>"; };
  return '<div class="panel"><h3>Value watch scorecard <small>against the closing line since ' + esc(dLabel(VAL.since)) + '</small></h3><div class="scroll"><table class="t"><thead><tr><th class="l">Signal</th><th>Record</th><th>Win %</th></tr></thead><tbody>' +
    rows.map(([k, lab]) => '<tr><td class="l">' + lab + "</td>" + cell(k) + "</tr>").join("") + '</tbody></table></div><p class="note" style="padding:0 14px 12px">Break-even at standard −110 juice is 52.4%. Green beats it, red doesn\'t. "Value" tags on game cards mark the second signal and "Value+" the third, so read them with these records in mind: a tag is a disagreement worth a look, not a proven edge. The closing line is the market\'s sharpest number, so these records are a tough test.</p></div>';
}

function gameCard(g) {
  const h = byId[g.home], a = byId[g.away], l = lineFor(g), logged = loggedLine(g), w = watchIndex(g, l);
  const shown = g.state === "pre" ? l : (logged || l), live = g.state === "in", fin_ = g.state === "post";
  const side = (t, isHome, score) => {
    const p = shown ? (isHome ? shown.homeProb : 1 - shown.homeProb) : null, fav = shown && (isHome ? shown.spread > 0 : shown.spread < 0);
    const won = fin_ && fin(g.homeScore) && (isHome ? g.homeScore > g.awayScore : g.awayScore > g.homeScore);
    return '<div class="gt' + (won ? " won" : "") + '">' + logo(t) + rk(t) + '<a class="nm" href="#/team?id=' + esc(t.id) + '">' + esc(t.short) + "</a>" + (faves.has(t.id) ? '<span class="fv" title="Following">★</span>' : "") +
      '<small>' + rec(t) + "</small>" + (fin(score) ? '<b class="sc">' + int(score) + "</b>" : '<span class="pr' + (fav ? " fav" : "") + '">' + (p === null ? "" : pct(p)) + "</span>") + "</div>";
  };
  let status = live ? '<span class="live">● ' + esc(g.detail || "Live") + "</span>" : fin_ ? "<b>" + esc(g.detail || "Final") + "</b>" : g.state === "off" ? esc(g.detail || "Postponed") : tip(g) + " ET";
  let tag = "";
  if (upsetAlert(l, g)) tag = '<span class="pill warn">Upset alert</span>';
  else if (w >= 70 && g.state !== "post") tag = '<span class="pill new">Must watch</span>';
  if (fin_ && logged && logged.final) tag = logged.correct ? '<span class="pill up">Hub ✓</span>' : logged.upset ? '<span class="pill fill">Upset</span>' : '<span class="pill">Hub ✗</span>';
  const foot = shown ? "<span><b>" + favLine(shown, h, a) + "</b></span><span>O/U <b>" + half(shown.total) + "</b></span>" : "<span class=\"note\">No line: a team lacks ratings</span>";
  return '<article class="gm' + (live ? " is-live" : "") + '" data-watch="' + w + '"><header><span>' + status + (g.tv ? " · " + esc(g.tv) : "") + (g.neutral ? " · Neutral" : "") + "</span>" + tag + valuePills(g, l, h, a) + "</header>" +
    side(a, false, g.awayScore) + side(h, true, g.homeScore) +
    '<footer>' + foot + '<span class="wi" title="Watchability: team quality, how close the line is, pace and stars on the floor">' + w + '</span><a href="#/matchup?a=' + esc(a.id) + "&b=" + esc(h.id) + "&site=" + (g.neutral ? "n" : "b") + '">Matchup →</a></footer>' + betRow(g, h, a) + "</article>";
}

/* ---------- pages ---------- */
function tiles4(items) { return tiles(items).replace('class="stats"', 'class="stats q4"'); }
function tiles(items) { return '<div class="stats">' + items.map(([v, l]) => '<div class="stat"><b>' + v + "</b><span>" + l + "</span></div>").join("") + "</div>"; }

function today(q) {
  const day = q.get("day") || dayNY(), followOnly = q.get("follow") === "1", sort = q.get("sort") || "watch";
  const days = [...new Set([dayNY(), ...D.games.map(g => g.day)])].filter(d => d >= dayNY(new Date(Date.now() - 3 * 864e5))).sort().slice(0, 12);
  let games = D.games.filter(g => g.day === day && byId[g.home] && byId[g.away]);
  if (followOnly) games = games.filter(g => faves.has(g.home) || faves.has(g.away));
  const w = new Map(games.map(g => [g.id, watchIndex(g, lineFor(g))]));
  const order = { in: 0, pre: 1, post: 2, off: 3 };
  games.sort(sort === "time" ? (x, y) => (x.at || "").localeCompare(y.at || "") : sort === "close" ? (x, y) => { const a = lineFor(x), b = lineFor(y); return (a ? Math.abs(a.spread) : 99) - (b ? Math.abs(b.spread) : 99); } : (x, y) => order[x.state] - order[y.state] || w.get(y.id) - w.get(x.id));
  const lines = games.map(lineFor).filter(Boolean), alerts = games.filter(g => upsetAlert(lineFor(g), g)).length;
  const ranked = games.filter(g => byId[g.home].haslamRank <= 25 || byId[g.away].haslamRank <= 25).length;
  const r = X && X.record;
  const playing = new Set(games.flatMap(g => [g.home, g.away]));
  const pros = D.players.filter(p => fin(p.draftRank) && playing.has(p.teamId)).sort((a, b) => a.draftRank - b.draftRank);
  const nais = (X ? X.naismith.ladder : []).filter(r => playing.has(r.teamId)).slice(0, 8);
  const gameOf = tid => games.find(g => g.home === tid || g.away === tid);
  const vs = tid => { const g = gameOf(tid); if (!g) return ""; const o = byId[g.home === tid ? g.away : g.home]; return (g.home === tid ? "vs " : "at ") + esc(o.short); };
  return '<h2 class="sec">' + (day === dayNY() ? "Tonight's games" : "Games · " + dLabel(day, { weekday: "short" })) + "</h2>" +
    '<p class="lede">Every Division I game with the hub\'s line, win probability and total from adjusted efficiency and pace. Games are sorted by watchability: team quality, how close the line is, pace, and NBA prospects or Naismith candidates on the floor.</p>' +
    tiles([[games.length, "Games"], [ranked, "With a top-25 team"], [alerts, "Upset alerts"], [lines.length ? half(lines.reduce((s, l) => s + Math.abs(l.spread), 0) / lines.length) : "—", "Avg spread"], [r && r.games ? r.right + "-" + (r.games - r.right) : "New", "Hub record"]]) +
    '<div class="controls"><label>Day<select data-param="day">' + days.map(d => '<option value="' + d + '"' + (d === day ? " selected" : "") + ">" + dLabel(d, { weekday: "short" }) + (d === dayNY() ? " · Today" : "") + "</option>").join("") + "</select></label>" +
    '<label>Sort<select data-param="sort"><option value="watch"' + (sort === "watch" ? " selected" : "") + '>Watchability</option><option value="time"' + (sort === "time" ? " selected" : "") + '>Tip time</option><option value="close"' + (sort === "close" ? " selected" : "") + ">Closest line</option></select></label>" +
    '<label class="switch"><input type="checkbox" data-param="follow" value="1"' + (followOnly ? " checked" : "") + "> <span>Teams I follow</span></label>" +
    '<button class="btn" type="button" data-refresh>Refresh scores ↻</button><span class="note" id="stamp">' + (liveStamp ? "Scores checked " + dLabel(liveStamp, { hour: "numeric", minute: "2-digit" }) : "Snapshot " + dLabel(D.sources.games && D.sources.games.updated, { hour: "numeric", minute: "2-digit" })) + "</span></div>" +
    (games.length ? '<div class="games">' + games.map(gameCard).join("") + "</div>" : '<p class="callout">' + (followOnly ? 'None of the teams you follow play this day. Follow teams with ☆ on the <a href="#/teams">Teams</a> tab.' : "No Division I games in this snapshot for that day.") + "</p>") +
    valueBoard() +
    (BET && BET.games ? '<p class="note">Bets: share of bets (tickets) across the books <a href="https://www.actionnetwork.com" target="_blank" rel="noopener">Action Network</a> tracks, with the bet count. Kalshi: the price on each team\'s wins market at <a href="https://kalshi.com" target="_blank" rel="noopener">Kalshi</a>, in cents on the dollar, shown once 500+ contracts have traded. Both freeze at tipoff.</p>' : "") +
    '<div class="two" style="margin-top:16px">' +
    '<div class="panel"><h3>Prospects in action <small><a href="../draft/">NBA Big Board ↗</a></small></h3>' + (pros.length ? '<ul class="rlist">' + pros.slice(0, 10).map(p => "<li>" + '<span class="pill bb">#' + p.draftRank + "</span>" + playerLink(p) + '<span class="grow sub">' + esc(p.team) + " " + vs(p.teamId) + '</span><span class="num">' + f1(stat(p, "pts")) + " ppg</span></li>").join("") + "</ul>" : '<p class="body note">No Big Board prospects play this day.</p>') + "</div>" +
    '<div class="panel"><h3>Naismith candidates playing <small><a href="#/naismith">Full ladder →</a></small></h3>' + (nais.length ? '<ul class="rlist">' + nais.map(r => { const p = byPlayer[r.id]; return "<li>" + '<span class="pill nai">#' + r.rank + "</span>" + playerLink(p) + '<span class="grow sub">' + esc(p.team) + " " + vs(p.teamId) + '</span><span class="num">' + f1(stat(p, "pts")) + " ppg</span></li>"; }).join("") + "</ul>" : '<p class="body note">No watch-list players play this day.</p>') + "</div>" +
    "</div>" + (SIM() ? '<div class="panel"><h3>National title odds <small><a href="#/bracket">Tournament odds →</a></small></h3><div class="body">' + titleStrip(8) + "</div></div>" : "");
}

const RCOLS = [
  ["haslam", "Rk", t => t.haslamRank, true], ["bpi", "BPI", t => t.bpiRank, true], ["sor", "SOR", t => t.sorRank, true],
  ["net", "Net", t => M.em(t)], ["adjO", "Off", t => M.num(t.metrics.adjO)], ["adjD", "Def", t => M.num(t.metrics.adjD), true],
  ["tempo", "Pace", t => M.num(t.metrics.tempo)], ["three", "3PA%", t => M.num(t.metrics.threeShare)], ["rim", "Rim%", t => M.num(t.metrics.rimShare)],
  ["tp", "3P%", t => M.num(t.metrics.threePct)], ["otp", "Opp 3P%", t => M.num(t.metrics.oppThreePct), true],
  ["projw", "Proj", t => t.projection && M.num(t.projection.wins)], ["conf", "Conf %", t => M.num(t.metrics.confTitle)], ["ncaa", "NCAA", t => odds(t.id) ? odds(t.id).in : null], ["move", "7-day", t => M.num(t.change7)]
];
function ratings(q) {
  const conf = q.get("conf") || "", s = (q.get("q") || "").toLowerCase(), sort = q.get("sort") || "haslam", mode = q.get("view") || "table";
  let ts = D.teams.filter(t => (!conf || t.conference === conf) && (!s || (t.name + " " + t.short + " " + t.abbr).toLowerCase().includes(s)));
  const col = RCOLS.find(c => c[0] === sort) || RCOLS[0];
  ts.sort((a, b) => { const x = col[2](a), y = col[2](b); return (x == null) - (y == null) || (x == null ? 0 : col[3] ? x - y : y - x) || (a.haslamRank || 999) - (b.haslamRank || 999); });
  const head = '<h2 class="sec">Team ratings</h2><p class="lede">All 365 teams by adjusted efficiency: points scored and allowed per 100 possessions against an average opponent (Haslametrics), with ESPN BPI and Strength of Record beside it. Net is offense minus defense. Colors show where a team ranks nationally.</p>' +
    '<div class="controls">' + confSelect(conf) + '<label>Find a team<input type="search" data-param="q" value="' + esc(q.get("q") || "") + '" placeholder="Duke, Gonzaga…"></label>' + seg("view", [["table", "Table"], ["chart", "Offense vs defense"]], mode) + "</div>";
  if (mode === "chart") return head + scatter(ts, conf || s);
  const show = q.get("all") === "1" || conf || s ? ts : ts.slice(0, 100);
  const th = "<tr><th class=l>Team</th>" + RCOLS.map(c => sortTh(c[0], c[1], sort)).join("") + "</tr>";
  const body = show.map(t => {
    const m = t.metrics, mv = M.num(t.change7);
    return '<tr class="go" data-href="#/team?id=' + esc(t.id) + '"><td class="tm">' + logo(t) + '<span class="nm">' + esc(t.short) + '</span><small class="cf">' + esc(t.conference || "") + " · " + rec(t) + "</small></td>" +
      "<td><b>" + int(t.haslamRank) + "</b></td><td>" + int(t.bpiRank) + "</td><td>" + int(t.sorRank) + "</td>" +
      '<td class="' + (M.em(t) > 0 ? "pos" : "neg") + '"><b>' + sg(M.em(t)) + "</b></td>" +
      '<td><span class="chip ' + tier(M.percentile(D.teams, t, "adjO")) + '">' + f1(m.adjO) + '</span> <small class="rr">' + (rankO[t.id] || "") + "</small></td>" +
      '<td><span class="chip ' + tier(M.percentile(D.teams, t, "adjD", true)) + '">' + f1(m.adjD) + '</span> <small class="rr">' + (rankD[t.id] || "") + "</small></td>" +
      "<td>" + f1(m.tempo) + "</td><td>" + f1(m.threeShare) + "</td><td>" + f1(m.rimShare) + "</td><td>" + f1(m.threePct) + "</td><td>" + f1(m.oppThreePct) + "</td>" +
      "<td>" + proj(t) + "</td><td>" + (fin(m.confTitle) ? Math.round(m.confTitle) + "%" : "—") + "</td><td>" + (odds(t.id) ? pct(odds(t.id).in) : "—") + '</td><td class="' + (mv > 0 ? "pos" : mv < 0 ? "neg" : "") + '">' + (mv ? (mv > 0 ? "▲" : "▼") + Math.abs(mv) : "–") + "</td></tr>";
  }).join("");
  return head + '<div class="panel"><div class="scroll"><table class="t rt"><thead>' + th + "</thead><tbody>" + body + "</tbody></table></div></div>" +
    (show.length < ts.length ? '<p><button class="btn" data-more="all">Show all ' + ts.length + " teams</button></p>" : "") +
    '<p class="note">Rk: Haslametrics rank (' + dLabel(D.sources.haslam && D.sources.haslam.updated) + "). BPI: ESPN Basketball Power Index rank. SOR: ESPN Strength of Record (résumé) rank. 3PA% and Rim%: share of shots from three and at the rim. Proj: BPI projected record. Conf %: BPI chance to win the regular-season conference title. NCAA: the hub's chance to make the tournament. 7-day: Haslametrics rank change this week.</p>";
}
function scatter(ts, focus) {
  const all = D.teams.filter(t => fin(t.metrics.adjO) && fin(t.metrics.adjD));
  const xs = all.map(t => t.metrics.adjO), ys = all.map(t => t.metrics.adjD);
  const x0 = Math.floor(Math.min(...xs) - 1), x1 = Math.ceil(Math.max(...xs) + 1), y0 = Math.floor(Math.min(...ys) - 1), y1 = Math.ceil(Math.max(...ys) + 1);
  const W = 900, Hh = 620, P = 46, sx = v => P + (v - x0) / (x1 - x0) * (W - 2 * P), sy = v => P + (v - y0) / (y1 - y0) * (Hh - 2 * P); // low defense (better) at the top
  const ids = new Set(ts.map(t => t.id)), labelled = focus ? ts.slice(0, 40) : all.slice().sort((a, b) => (a.haslamRank || 999) - (b.haslamRank || 999)).slice(0, 25);
  const lab = new Set(labelled.map(t => t.id)), mo = sx(avg), md = sy(avg);
  let svg = '<svg class="sc-chart" viewBox="0 0 ' + W + " " + Hh + '" role="img" aria-label="Adjusted offense against adjusted defense for every team">' +
    '<line x1="' + mo + '" y1="' + P + '" x2="' + mo + '" y2="' + (Hh - P) + '" class="ax"/><line x1="' + P + '" y1="' + md + '" x2="' + (W - P) + '" y2="' + md + '" class="ax"/>' +
    '<text x="' + (W - P) + '" y="' + (P - 14) + '" class="q" text-anchor="end">Elite both ends</text><text x="' + P + '" y="' + (P - 14) + '" class="q">Defense first</text>' +
    '<text x="' + (W - P) + '" y="' + (Hh - 12) + '" class="q" text-anchor="end">Offense first</text><text x="' + P + '" y="' + (Hh - 12) + '" class="q">Work in progress</text>' +
    '<text x="' + (W / 2) + '" y="' + (Hh - 12) + '" class="axl" text-anchor="middle">Adjusted offense →</text><text x="14" y="' + (Hh / 2) + '" class="axl" text-anchor="middle" transform="rotate(-90 14 ' + (Hh / 2) + ')">← Adjusted defense (better at top)</text>';
  for (const t of all) { const on = ids.has(t.id), big = lab.has(t.id); if (big) continue; svg += '<a href="#/team?id=' + esc(t.id) + '"><circle cx="' + sx(t.metrics.adjO).toFixed(1) + '" cy="' + sy(t.metrics.adjD).toFixed(1) + '" r="' + (on && focus ? 5 : 3.5) + '" class="dot' + (on && focus ? " on" : focus ? " off" : "") + '"><title>' + esc(t.short + " · Off " + f1(t.metrics.adjO) + " · Def " + f1(t.metrics.adjD)) + "</title></circle></a>"; }
  for (const t of labelled) { const x = sx(t.metrics.adjO), y = sy(t.metrics.adjD); svg += '<a href="#/team?id=' + esc(t.id) + '"><title>' + esc(t.short + " · Off " + f1(t.metrics.adjO) + " · Def " + f1(t.metrics.adjD)) + '</title><circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="11" class="lbg"/>' + (t.logo ? '<image href="' + safe(t.logo) + '" x="' + (x - 10).toFixed(1) + '" y="' + (y - 10).toFixed(1) + '" width="20" height="20"/>' : "") + '<text x="' + (x + 13).toFixed(1) + '" y="' + (y + 4).toFixed(1) + '" class="tl2">' + esc(t.short) + "</text></a>"; }
  return '<div class="fieldwrap">' + svg + "</svg></div><p class=\"note\">Lines cross at the Division I average (" + f1(avg) + " points per 100 possessions). " + (focus ? "Your filter's teams are highlighted." : "The top 25 are labeled; filter by conference to label a league.") + "</p>";
}

function conferences(q) {
  const cs = M.conferences(D.teams), bids = {};
  if (SIM()) for (const [id, o] of Object.entries(SIM().teams)) { const c = byId[id] && byId[id].conference; if (c) bids[c] = (bids[c] || 0) + o.in; }
  else if (D.march) for (const s of D.march.slots) for (const id of s.teamIds) { const c = byId[id] && byId[id].conference; if (c) bids[c] = (bids[c] || 0) + 1; }
  const pick = q.get("conf") || cs[0].name, c = cs.find(x => x.name === pick) || cs[0];
  const teams = c.teams.slice().sort((a, b) => ((odds(b.id) || {}).reg ?? M.num(b.metrics.confTitle) / 100 ?? -1) - ((odds(a.id) || {}).reg ?? M.num(a.metrics.confTitle) / 100 ?? -1) || (a.haslamRank || 999) - (b.haslamRank || 999));
  return '<h2 class="sec">Conference strength</h2><p class="lede">Average efficiency margin of each league\'s rated teams, its top three, and how many NCAA bids the league averages across the hub\'s simulated seasons.</p>' +
    '<div class="panel"><div class="scroll"><table class="t"><thead><tr><th class=l>Conference</th><th>Avg net</th><th>Top-3 net</th><th>Best team</th><th>Teams</th><th>Proj bids</th></tr></thead><tbody>' +
    cs.map((x, i) => '<tr class="go' + (x.name === c.name ? " sel" : "") + '" data-href="#/conferences?conf=' + encodeURIComponent(x.name) + '"><td><span class="rk">' + (i + 1) + "</span> <b>" + esc(x.name) + '</b></td><td class="' + (x.average > 0 ? "pos" : "neg") + '">' + sg(x.average) + "</td><td>" + sg(x.top3) + '</td><td class="tm">' + (x.leader ? logo(x.leader) + '<span class="nm">' + esc(x.leader.short) + "</span>" : "—") + "</td><td>" + x.teams.length + "</td><td><b>" + f1(bids[x.name] || 0) + "</b></td></tr>").join("") +
    "</tbody></table></div></div>" +
    '<h2 class="sec" id="race">' + esc(c.name) + " race</h2><p class=\"lede\">From the hub's season simulation: projected conference record, chance to win (or share) the regular-season title, chance to win the conference tournament and its automatic bid, and chance to make the NCAA tournament. ESPN BPI's title odds are alongside for comparison.</p>" +
    '<div class="controls"><label>Conference<select data-param="conf">' + cs.map(x => "<option" + (x.name === c.name ? " selected" : "") + ">" + esc(x.name) + "</option>").join("") + "</select></label></div>" +
    '<div class="panel"><div class="scroll"><table class="t"><thead><tr><th class=l>Team</th><th>Conf</th><th>Overall</th><th>Proj conf</th><th>Reg-season title</th><th>Auto bid</th><th>Make NCAA</th><th>BPI title</th><th>Net</th><th>Rk</th></tr></thead><tbody>' +
    teams.map(t => { const ct = M.num(t.metrics.confTitle), o = odds(t.id); return '<tr class="go" data-href="#/team?id=' + esc(t.id) + '"><td class="tm">' + logo(t) + '<span class="nm">' + esc(t.short) + "</span></td><td>" + crec(t) + "</td><td>" + rec(t) + "</td><td>" + (o ? Math.round(o.cw) + "-" + Math.round(o.cl) : "—") + '</td><td><span class="bar">' + (o ? pct(o.reg) : "—") + '<i><b style="width:' + (o ? o.reg * 100 : 0) + '%"></b></i></span></td><td>' + (o ? pct(o.aq) : "—") + "</td><td>" + (o ? pct(o.in) : "—") + '</td><td class="note">' + (fin(ct) ? Math.round(ct) + "%" : "—") + "</td><td>" + sg(M.em(t)) + "</td><td>" + int(t.haslamRank) + "</td></tr>"; }).join("") +
    "</tbody></table></div></div>";
}

function teams(q) {
  const s = (q.get("q") || "").toLowerCase(), follow = q.get("follow") === "1";
  const cs = M.conferences(D.teams);
  const list = cs.map(c => [c.name, c.teams.filter(t => (!s || (t.name + " " + t.short).toLowerCase().includes(s)) && (!follow || faves.has(t.id))).sort((a, b) => (a.haslamRank || 999) - (b.haslamRank || 999))]).filter(x => x[1].length);
  return '<h2 class="sec">Teams</h2><p class="lede">Every Division I team by conference. Follow teams with ☆ to filter tonight\'s games to them.</p>' +
    '<div class="controls"><label>Find a team<input type="search" data-param="q" value="' + esc(q.get("q") || "") + '" placeholder="Search 365 teams"></label><label class="switch"><input type="checkbox" data-param="follow" value="1"' + (follow ? " checked" : "") + "> <span>Only teams I follow (" + faves.size + ")</span></label></div>" +
    (list.length ? list.map(([c, ts]) => '<h3 class="ch">' + esc(c) + '</h3><div class="teamgrid">' + ts.map(t => '<div class="tg">' + '<a href="#/team?id=' + esc(t.id) + '">' + logo(t) + "<div><b>" + esc(t.short) + "</b><span>" + rec(t) + " · Rk " + int(t.haslamRank) + "</span></div></a>" + star(t) + "</div>").join("") + "</div>").join("") : '<p class="callout">No teams match.</p>');
}

function teamPage(q) {
  const t = byId[q.get("id")]; if (!t) return '<p class="callout">Team not found. <a href="#/teams">All teams</a></p>';
  const m = t.metrics, roster = (rosters[t.id] || []).slice().sort((a, b) => (stat(b, "min") ?? -1) - (stat(a, "min") ?? -1) || (stat(b, "pts") ?? -1) - (stat(a, "pts") ?? -1));
  ensureSched();
  const liveById = Object.fromEntries(D.games.map(g => [g.id, g]));
  const sched = (SCHED && SCHED.games.length ? SCHED.games.filter(g => g.home === t.id || g.away === t.id).map(g => { const x = liveById[g.id]; return x ? { ...g, ...x, conf: g.conf } : { ...g, homeScore: g.hs, awayScore: g.as }; }) : D.games.filter(g => g.home === t.id || g.away === t.id)).sort((a, b) => (a.at || a.day + "T23").localeCompare(b.at || b.day + "T23"));
  const hl = t.highlights || {}, quads = t.haslamQuads || {};
  const vsOpts = D.teams.filter(x => x.id !== t.id).sort((a, b) => a.short.localeCompare(b.short));
  const schedRows = sched.map(g => {
    const home = g.home === t.id, oid = home ? g.away : g.home, o = byId[oid], l = o ? (g.state === "pre" ? lineFor(g) : loggedLine(g)) : null;
    const p = l ? (home ? l.homeProb : 1 - l.homeProb) : null, mine = l ? (home ? l.spread : -l.spread) : null;
    let res = "";
    if (g.state === "post" && fin(g.homeScore)) { const us = home ? g.homeScore : g.awayScore, them = home ? g.awayScore : g.homeScore; res = '<b class="' + (us > them ? "pos" : "neg") + '">' + (us > them ? "W " : "L ") + int(us) + "-" + int(them) + "</b>"; }
    else if (g.state === "in") res = '<span class="live">● ' + int(home ? g.homeScore : g.awayScore) + "-" + int(home ? g.awayScore : g.homeScore) + "</span>";
    return '<tr><td>' + dLabel(g.day, { weekday: "short" }) + '</td><td class="tm">' + '<span class="at">' + (g.neutral ? "vs" : home ? "" : "@") + "</span>" + (o ? teamLink(o, { rank: true }) : '<span class="nd1">' + esc(SCHED && SCHED.other && SCHED.other[oid] || "Non-D1") + "</span>") + (g.conf ? ' <span class="pill cf2">Conf</span>' : "") + "</td><td>" + (mine === null ? "—" : Math.abs(mine) < 0.5 ? "PK" : (mine > 0 ? "−" : "+") + half(mine)) + "</td><td>" + pct(p) + '</td><td class="bt">' + (o ? betBrief(g.id, home ? t : o, home ? o : t) : "") + "</td><td>" + (res || (g.state === "pre" ? (g.at ? tip(g) : "TBA") : g.state === "off" ? "Postponed" : "")) + "</td></tr>";
  }).join("");
  return '<div class="thead">' + logo(t) + "<div><h2>" + esc(t.name) + " " + star(t) + '</h2><div class="meta">' + esc(t.conferenceName || t.conference || "") + (t.coach ? " · Coach " + esc(t.coach) : "") + " · " + rec(t) + " (" + crec(t) + " conf)</div></div>" +
    '<a class="back" href="' + safe(t.links && t.links.clubhouse) + '" target="_blank" rel="noopener">ESPN ↗</a></div>' +
    tiles([["#" + int(t.haslamRank), "Haslametrics"], ["#" + int(t.bpiRank), "BPI"], ["#" + int(t.sorRank), "SOR (résumé)"], [sg(M.em(t)), "Net rating"], [f1(m.adjO) + ' <small>#' + (rankO[t.id] || "—") + "</small>", "Offense"], [f1(m.adjD) + ' <small>#' + (rankD[t.id] || "—") + "</small>", "Defense"], [f1(m.tempo), "Pace"], [odds(t.id) && fin(odds(t.id).w) ? Math.round(odds(t.id).w) + "-" + Math.round(odds(t.id).l) : proj(t), "Proj record"], [odds(t.id) ? pct(odds(t.id).in) + (odds(t.id).mode ? ' <small>' + odds(t.id).mode + " seed</small>" : "") : "—", "Make NCAA"]]) +
    '<p class="callout">' + esc(M.teamStory(t, D.teams)) + "</p>" + teamBars(t) +
    '<div class="controls"><label>Spread machine: ' + esc(t.short) + ' vs<select data-vs="' + esc(t.id) + '"><option value="">Pick an opponent</option>' + vsOpts.map(o => '<option value="' + esc(o.id) + '">' + esc(o.short) + "</option>").join("") + "</select></label></div>" +
    '<div class="two"><div class="panel"><h3>Schedule <small>' + (odds(t.id) && fin(odds(t.id).w) ? "projected " + Math.round(odds(t.id).w) + "-" + Math.round(odds(t.id).l) + " · " : "") + 'hub line and win %</small></h3><div class="scroll sched"><table class="t"><thead><tr><th>Date</th><th class=l>Opponent</th><th>Line</th><th>Win</th><th>Bets</th><th></th></tr></thead><tbody>' + (schedRows || '<tr><td colspan="6" class="note">Schedule loading…</td></tr>') + "</tbody></table></div></div>" +
    '<div><div class="panel"><h3>Résumé so far</h3><div class="body"><div class="kv"><div><b>' + esc(quads["1"] || "—") + "</b><span>Q1</span></div><div><b>" + esc(quads["2"] || "—") + "</b><span>Q2</span></div><div><b>" + esc(quads["3"] || "—") + "</b><span>Q3</span></div><div><b>" + esc(quads["4"] || "—") + "</b><span>Q4</span></div></div>" +
    ["best", "worst", "latest"].filter(k => hl[k]).map(k => { const h = hl[k]; return '<p class="tldr"><b>' + { best: "Best game", worst: "Worst game", latest: "Latest" }[k] + ":</b> " + (h.us > h.them ? "W " : "L ") + int(h.us) + "-" + int(h.them) + " " + (h.venue === "H" ? "vs" : h.venue === "A" ? "at" : "vs") + " " + esc(h.opponent) + " (" + esc(h.date) + ")</p>"; }).join("") +
    '<p class="note">Quadrants are Haslametrics\' own hNET quadrants, not the NCAA\'s official NET.</p></div></div>' + outlook(t) + '</div></div>' +
    '<h2 class="sec">Roster</h2><div class="panel"><div class="scroll"><table class="t"><thead><tr><th class=l>Player</th><th>Pos</th><th>Yr</th><th>Ht</th><th>GP</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TS%</th><th>GmSc</th></tr></thead><tbody>' +
    roster.map(p => "<tr><td class=\"l\">" + playerLink(p) + badges(p) + "</td><td>" + esc(p.pos || "") + "</td><td>" + esc((p.year || "").slice(0, 2)) + "</td><td>" + esc(p.height || "") + "</td><td>" + f1(stat(p, "gp"), 0) + "</td><td>" + f1(stat(p, "min")) + "</td><td><b>" + f1(stat(p, "pts")) + "</b></td><td>" + f1(stat(p, "reb")) + "</td><td>" + f1(stat(p, "ast")) + "</td><td>" + f1(stat(p, "stl")) + "</td><td>" + f1(stat(p, "blk")) + "</td><td>" + f1(stat(p, "ts")) + "</td><td><b>" + f1(M.gameScore(p)) + "</b></td></tr>").join("") + "</tbody></table></div></div>";
}

function tbarsHtml(groups, sortedOf, color, pctFn) {
  const one = (label, v, pc, dir, fmt) => {
    const c = dir === 0 ? "rgb(128,138,150)" : color(pc), w = Math.max(4, pc);
    return '<div class="svb"><span>' + label + ' <small style="font-weight:600;color:var(--faint)">' + fmt(v) + '</small></span><i><em style="width:' + w + "%;background:" + c + '"></em><b style="left:calc(' + w + "% - 13px);background:" + c + ";color:" + (dir === 0 || pc >= 80 || pc <= 20 ? "#fff" : "var(--ink)") + '">' + pc + "</b></i></div>";
  };
  return '<div class="tbars">' + groups.map(([title, rows], gi) => {
    const html = rows.map(([label, fn, dir, fmt], ri) => { const v = fn(); let pc = pctFn(sortedOf(gi, ri), v); if (pc == null) return ""; if (dir < 0) pc = 100 - pc; return one(label, v, pc, dir, fmt); }).join("");
    return html ? '<div><p class="card-sec">' + title + '</p><div class="svbars one">' + html + "</div></div>" : "";
  }).join("") + "</div>";
}

// Team totals from the roster's per-game lines (each player's average times his games), turned into rates so pace
// and games played don't skew them. Possessions = Haslametrics' adjusted tempo times games played.
function teamBox(t) {
  const ps = rosters[t.id] || [], tot = (k) => ps.reduce((s, p) => s + (fin(stat(p, k)) && fin(stat(p, "gp")) ? stat(p, k) * stat(p, "gp") : 0), 0);
  const g = t.record ? (t.record.w || 0) + (t.record.l || 0) : 0, fga = tot("fga"), fta = tot("fta"), tov = tot("tov"), fgm = tot("fgm"), poss = fin(t.metrics.tempo) && g ? t.metrics.tempo * g : 0;
  if (!g || fga < 50) return {};
  return { ts: 100 * tot("pts") / (2 * (fga + 0.44 * fta)), tov: 100 * tov / (fga + 0.44 * fta + tov), ast: fgm ? 100 * tot("ast") / fgm : null, ftr: 100 * fta / fga, stl: poss ? 100 * tot("stl") / poss : null, blk: poss ? 100 * tot("blk") / poss : null };
}
const pc1 = (x) => (fin(x) ? f1(x) + "%" : "—");
const T_GROUPS = [
  ["Offense", [["Adj. offense", (t) => t.metrics.adjO, 1, f1], ["True shooting", (t, b) => b.ts, 1, pc1], ["3P%", (t) => t.metrics.threePct, 1, pc1], ["Rim FG%", (t) => t.metrics.rimPct, 1, pc1],
    ["Assist rate", (t, b) => b.ast, 1, pc1], ["Turnover rate", (t, b) => b.tov, -1, pc1], ["Free throw rate", (t, b) => b.ftr, 1, pc1]]],
  ["Defense", [["Adj. defense", (t) => t.metrics.adjD, -1, f1], ["Opp. 3P%", (t) => t.metrics.oppThreePct, -1, pc1], ["Steals per 100", (t, b) => b.stl, 1, f1], ["Blocks per 100", (t, b) => b.blk, 1, f1]]],
  ["Style and schedule", [["Schedule faced", (t) => (fin(t.metrics.sosRank) ? -t.metrics.sosRank : null), 1, (v) => "#" + Math.round(-v)], ["Pace", (t) => t.metrics.tempo, 0, f1], ["3PA share", (t) => t.metrics.threeShare, 0, pc1], ["Rim share", (t) => t.metrics.rimShare, 0, pc1]]],
];
let T_SORTED = null;
function teamBars(t) {
  ensureT();
  const b = tbox(t), groups = T_GROUPS.map(([title, rows]) => [title, rows.map(([l, fn, d, f]) => [l, () => fn(t, b), d, f])]);
  const html = tbarsHtml(groups, (g, r) => T_SORTED[g][r], pctColorC, (s, v) => { const p = pctOf(s, v); return p == null ? null : Math.round(p); });
  return '<div class="panel"><h3>Against Division I <small>percentile among all ' + D.teams.length + ' teams</small></h3><div class="body">' + html +
    '<p class="note">Red is good, blue is bad; gray bars describe style, not quality. Adjusted offense and defense, pace, 3P%, rim FG% and shot mix are Haslametrics\'. True shooting, assist, turnover and free throw rates, steals and blocks come from ESPN box scores. Schedule faced is ESPN\'s strength of schedule.</p></div></div>';
}

function muPanel(off, def, rows, color, logoFn) {
  const ok = rows.filter((r) => r[1] && r[2]); if (!ok.length) return "";
  const bar = (pc, side) => { const c = color(pc), w = Math.max(4, pc); return '<i class="' + side + '"><em style="width:' + w + "%;background:" + c + '"></em><b style="' + (side === "l" ? "right" : "left") + ":calc(" + w + "% - 13px);background:" + c + ";color:" + (pc >= 80 || pc <= 20 ? "#fff" : "var(--ink)") + '">' + pc + "</b></i>"; };
  const wins = ok.filter((r) => r[1].pc > r[2].pc).length, loses = ok.filter((r) => r[1].pc < r[2].pc).length;
  const verdict = wins > loses ? esc(off.short) + " offense has the edge in " + wins + " of " + ok.length : loses > wins ? esc(def.short) + " defense has the edge in " + loses + " of " + ok.length : "Even" + (wins ? ", " + wins + (wins === 1 ? " edge" : " edges") + " each way" : "");
  return '<div class="panel"><h3>When ' + esc(off.short) + ' has the ball <small>' + verdict + '</small></h3><div class="body"><div class="mups"><div class="mu-r mu-h"><span>' + logoFn(off) + esc(off.short) + ' offense</span><span></span><span>' + esc(def.short) + " defense " + logoFn(def) + "</span></div>" +
    ok.map(([lab, o, d]) => '<div class="mu-r">' + bar(o.pc, "l") + '<span class="mid">' + lab + "<small>" + o.v + " · " + d.v + "</small></span>" + bar(d.pc, "r") + "</div>").join("") + "</div></div></div>";
}

const TBOX = {};
function ensureT() { if (!T_SORTED) { const boxes = D.teams.map((x) => [x, tbox(x)]); T_SORTED = T_GROUPS.map(([, rows]) => rows.map(([, fn]) => boxes.map(([x, b]) => fn(x, b)).filter(fin).sort((a, b) => a - b))); } }
function tbox(t) { return TBOX[t.id] || (TBOX[t.id] = teamBox(t)); }
function tPct(t, gi, ri) { ensureT(); const [, fn, d, f] = T_GROUPS[gi][1][ri], v = fn(t, tbox(t)), p = pctOf(T_SORTED[gi][ri], v); return p == null ? null : { pc: d < 0 ? 100 - p : p, v: f(v) }; }
const MU_PAIRS = [["Efficiency", [0, 0], [1, 0]], ["Threes", [0, 2], [1, 1]], ["Turnovers vs steals", [0, 5], [1, 2]], ["At the rim", [0, 3], [1, 3]]];
const muSide = (o, d) => muPanel(o, d, MU_PAIRS.map(([lab, op, dp]) => [lab, tPct(o, op[0], op[1]), tPct(d, dp[0], dp[1])]), pctColorC, logo);

function outlook(t) {
  const o = odds(t.id); if (!o) return "";
  const steps = [["Make the field", o.in], ...o.r.slice(1).map((x, k) => [ROUNDS[k + 1], x])];
  const bk = bucketOf(o), bl = bk ? BUCKETS.find(b => b[0] === bk)[1] : null;
  return '<div class="panel"><h3>March outlook ' + (bl ? '<a class="pill ' + (bk === "lock" ? "up" : bk === "long" ? "" : "warn") + '" href="#/bubble?conf=' + encodeURIComponent(t.conference) + '" title="Bubble watch">' + (bk === "lock" ? "Lock" : bl) + "</a> " : "") + '<small><a href="#/bracket">All tournament odds →</a></small></h3><div class="body"><div class="kv"><div><b>' + pct(o.reg) + "</b><span>Reg-season title</span></div><div><b>" + Math.round(o.cw) + "-" + Math.round(o.cl) + "</b><span>Proj conf record</span></div><div><b>" + pct(o.aq) + "</b><span>Auto bid</span></div><div><b>" + (o.seed ? f1(o.seed) : "—") + "</b><span>Avg seed</span></div><div><b>" + pct(o.top4) + "</b><span>Top-4 seed</span></div></div>" +
    '<div class="ladder">' + steps.map(([lab, x]) => '<div class="lr"><span>' + lab + '</span><i><b style="width:' + (x * 100).toFixed(1) + '%"></b></i><em>' + pct(x) + "</em></div>").join("") + "</div></div></div>";
}

const PSTATS = [["gp", "GP", 0], ["min", "MIN", 1], ["pts", "PTS", 1], ["reb", "REB", 1], ["ast", "AST", 1], ["stl", "STL", 1], ["blk", "BLK", 1], ["tov", "TOV", 1], ["ts", "TS%", 1], ["threePct", "3P%", 1], ["gs", "GmSc", 1]];
const pval = (p, k) => k === "gs" ? M.gameScore(p) : k === "board" ? (fin(p.draftRank) ? -p.draftRank : null) : stat(p, k);
function qualified(p, k) {
  const gp = stat(p, "gp"), min = stat(p, "min");
  if (k === "ts") return (stat(p, "fga") || 0) >= 8 && (min || 0) >= 20 && (gp === null || gp >= Math.max(2, maxGp * 0.6));
  if (k === "threePct") return (stat(p, "threeAtt") || 0) >= 3 && (gp === null || gp >= Math.max(2, maxGp * 0.6));
  if (k === "tov") return (min || 0) >= 15;
  return gp === null || gp >= Math.max(2, maxGp * 0.6);
}
let maxGp = 0;
function players(q) {
  const s = (q.get("q") || "").toLowerCase(), conf = q.get("conf") || "", pool = q.get("pool") || "all", sort = q.get("sort") || "pts", n = Number(q.get("n")) || 60, mode = q.get("view") || "leaders";
  let ps = D.players.filter(p => (!conf || p.conference === conf) && (!s || (p.name + " " + p.team).toLowerCase().includes(s)));
  if (pool === "naismith") ps = ps.filter(p => naiRank[p.id]);
  if (pool === "board") ps = ps.filter(p => fin(p.draftRank));
  if (pool === "fresh") ps = ps.filter(p => /^fr/i.test(p.year || ""));
  const head = '<h2 class="sec">Players</h2><p class="lede">Every Division I player\'s season line from ESPN: minutes, scoring, rebounding, playmaking, defense and efficiency. True shooting (TS%) folds threes and free throws into one shooting number; Game Score (GmSc) sums a player\'s whole box score into one per-game figure. Naismith watch-list players and NBA Big Board prospects are tagged.</p>' +
    '<div class="controls"><label>Find a player<input type="search" data-param="q" value="' + esc(q.get("q") || "") + '" placeholder="Name or school"></label>' + confSelect(conf) + seg("pool", [["all", "All"], ["naismith", "Naismith list"], ["board", "Big Board"], ["fresh", "Freshmen"]], pool) + seg("view", [["leaders", "Leaders"], ["table", "Table"]], mode) + "</div>";
  if (mode === "leaders") {
    const board = (k, lab, d, low) => { const rows = ps.filter(p => pval(p, k) !== null && hasGames(p) && qualified(p, k)).sort((a, b) => low ? pval(a, k) - pval(b, k) : pval(b, k) - pval(a, k)).slice(0, 10);
      return '<div class="panel"><h3>' + lab + '</h3><ol class="rlist ldr">' + rows.map((p, i) => '<li><b class="rk">' + (i + 1) + "</b>" + playerLink(p) + '<span class="grow sub">' + esc(p.team) + '</span><span class="num"><b>' + f1(pval(p, k), d) + "</b></span></li>").join("") + "</ol></div>"; };
    return head + '<div class="leaders">' + board("gs", "Game Score", 1) + board("pts", "Points", 1) + board("reb", "Rebounds", 1) + board("ast", "Assists", 1) + board("stl", "Steals", 1) + board("blk", "Blocks", 1) + board("ts", "True shooting %", 1) + board("threePct", "3-point % (3+ attempts a game)", 1) + board("min", "Minutes", 1) + "</div>" +
      '<p class="note">Leaders need ' + Math.max(2, Math.ceil(maxGp * 0.6)) + "+ games. True shooting needs 8+ shots and 20+ minutes a game. " + esc(D.notes && D.notes.players || "") + "</p>";
  }
  ps.sort((a, b) => { const x = pval(a, sort), y = pval(b, sort); return (x == null) - (y == null) || (x == null ? 0 : y - x) || a.name.localeCompare(b.name); });
  if (["ts", "threePct"].includes(sort)) ps = ps.filter(p => qualified(p, sort)).concat(ps.filter(p => !qualified(p, sort)));
  const th = "<tr><th class=l>Player</th><th class=l>Team</th><th>Pos</th><th>Yr</th>" + PSTATS.map(([k, l]) => sortTh(k, l, sort)).join("") + sortTh("board", "Board", sort) + "</tr>";
  return head + '<div class="panel"><div class="scroll"><table class="t pt"><thead>' + th + "</thead><tbody>" +
    ps.slice(0, n).map(p => { const t = byId[p.teamId]; return "<tr><td class=\"l\">" + playerLink(p) + badges(p) + '</td><td class="tm">' + teamLink(t) + "</td><td>" + esc(p.pos || "") + "</td><td>" + esc((p.year || "").slice(0, 2)) + "</td>" + PSTATS.map(([k, , d]) => "<td" + (k === sort ? ' class="on"' : "") + ">" + f1(pval(p, k), d) + "</td>").join("") + "<td>" + (fin(p.draftRank) ? "#" + p.draftRank : "") + "</td></tr>"; }).join("") +
    "</tbody></table></div></div>" + (ps.length > n ? '<p><button class="btn" data-more="n" data-n="' + (n + 120) + '">Show more (' + (ps.length - n) + " left)</button></p>" : "") +
    '<p class="note">' + esc(D.notes && D.notes.players || "") + "</p>";
}

function naismith() {
  if (!X || !X.naismith) return '<p class="callout">Naismith Watch is loading with the next data update.</p>';
  const N = X.naismith, lad = N.ladder.filter(r => byPlayer[r.id]), top = lad[0] && byPlayer[lad[0].id];
  const move = r => r.prev ? (r.prev - r.rank > 0 ? '<span class="pos">▲' + (r.prev - r.rank) + "</span>" : r.prev - r.rank < 0 ? '<span class="neg">▼' + (r.rank - r.prev) + "</span>" : '<span class="note">–</span>') : '<span class="note">new</span>';
  const maxS = Math.max(...lad.map(r => r.score || 0), 1), minS = Math.min(...lad.map(r => r.score ?? 0), 0);
  const hist = !!N.since, row = (r, i) => { const p = byPlayer[r.id], t = byId[p.teamId]; return "<tr><td><b>" + (r.rank || i + 1) + "</b></td>" + (hist ? "<td>" + move(r) + "</td>" : "") + "<td class=\"l\">" + playerLink(p) + (fin(p.draftRank) ? ' <span class="pill bb">Board #' + p.draftRank + "</span>" : "") + '</td><td class="tm">' + teamLink(t, { rank: true }) + "</td><td>" + esc((p.year || "").slice(0, 2)) + "</td><td><b>" + f1(stat(p, "pts")) + "</b></td><td>" + f1(stat(p, "reb")) + "</td><td>" + f1(stat(p, "ast")) + "</td><td>" + f1(stat(p, "ts")) + "</td><td><b>" + f1(M.gameScore(p)) + "</b></td><td>" + sg(M.em(t)) + '</td><td><span class="bar">' + (r.score === null ? '<span class="note">no games</span>' : f1(r.score, 2)) + '<i><b style="width:' + (r.score === null ? 0 : Math.max(3, (r.score - minS) / (maxS - minS) * 100)) + '%"></b></i></span></td></tr>'; };
  const th = "<tr><th>#</th>" + (hist ? "<th></th>" : "") + "<th class=l>Player</th><th class=l>Team</th><th>Yr</th><th>PTS</th><th>REB</th><th>AST</th><th>TS%</th><th>GmSc</th><th>Team net</th><th>Ladder</th></tr>";
  const byConf = {}; lad.forEach(r => { const c = byPlayer[r.id].conference; byConf[c] = (byConf[c] || 0) + 1; });
  return '<h2 class="sec">Naismith Watch</h2><p class="lede">The ' + esc(N.list.toLowerCase()) + ' for the ' + esc(N.award) + ' (' + esc(N.source) + ", " + dLabel(N.announced) + '), ranked by the hub\'s ladder: what each player is producing, how good his team is, and his NBA draft stock. <a href="' + safe(N.url) + '" target="_blank" rel="noopener">Official list ↗</a></p>' +
    (top ? '<div class="verdict">' + face(top, 44) + " <b>" + esc(top.name) + "</b> leads the ladder: " + f1(stat(top, "pts")) + " points, " + f1(stat(top, "reb")) + " rebounds and " + f1(stat(top, "ast")) + " assists a game for " + esc(top.team) + " (Haslametrics #" + int(byId[top.teamId].haslamRank) + ").<small>" + (N.since ? "Movement since " + dLabel(N.since) + "." : "Movement arrows start once the ladder has a week of history.") + "</small></div>" : "") +
    '<div class="panel"><div class="scroll"><table class="t nai-t"><thead>' + th + "</thead><tbody>" + lad.map(row).join("") + "</tbody></table></div></div>" +
    '<div class="two"><div class="panel"><h3>Knocking on the door <small>not on the list, would rank in its top 30</small></h3>' + (N.knocking.length ? '<ul class="rlist">' + N.knocking.filter(r => byPlayer[r.id]).map(r => { const p = byPlayer[r.id]; return "<li>" + playerLink(p) + '<span class="grow sub">' + esc(p.team) + " · " + f1(stat(p, "pts")) + "/" + f1(stat(p, "reb")) + "/" + f1(stat(p, "ast")) + '</span><span class="num">' + f1(r.score, 2) + "</span></li>"; }).join("") + "</ul>" : '<p class="body note">Nobody off the list is producing at a top-30 level yet.</p>') + "</div>" +
    '<div class="panel"><h3>The list by conference</h3><ul class="rlist">' + Object.entries(byConf).sort((a, b) => b[1] - a[1]).map(([c, n]) => '<li><span class="grow">' + esc(c) + '</span><span class="bar">' + n + '<i><b style="width:' + n / 15 * 100 + '%"></b></i></span></li>').join("") + "</ul></div></div>" +
    '<p class="note">' + esc(N.method) + " " + esc(N.note) + "</p>";
}

let SCHED = null, schedLoading = null;
function ensureSched() {
  if (SCHED || schedLoading) return;
  schedLoading = fetch("data/schedule.json", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(x => { SCHED = x && x.games ? x : { games: [] }; if (["team", "bubble"].includes(route().page)) render(); }).catch(() => { SCHED = { games: [] }; });
}
function ensureBoard() {
  if (BOARD || boardLoading) return boardLoading;
  boardLoading = fetch("../draft/nba.json", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(b => { BOARD = b || { players: [] }; if (["prospects"].includes(route().page) || $("#card").open) render(); }).catch(() => { BOARD = { players: [] }; });
  return boardLoading;
}
function spark(hist, delta) {
  const h = (hist || []).filter(fin); if (h.length < 2) return "";
  const lo = Math.min(...h), hi = Math.max(...h), W = 70, Hh = 20, x = i => i / (h.length - 1) * W, y = v => hi === lo ? Hh / 2 : 2 + (v - lo) / (hi - lo) * (Hh - 4);
  const d = h.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" "), up = fin(delta) ? delta > 0 : h[h.length - 1] < h[0], dn = fin(delta) ? delta < 0 : h[h.length - 1] > h[0];
  return '<svg class="spark ' + (up ? "up" : dn ? "dn" : "") + '" viewBox="0 0 ' + W + " " + Hh + '" width="' + W + '" height="' + Hh + '" aria-hidden="true"><path d="' + d + '"/></svg>';
}
function nextGame(tid) { const t0 = dayNY(); return D.games.filter(g => (g.home === tid || g.away === tid) && g.day >= t0 && g.state !== "post").sort((a, b) => (a.at || a.day).localeCompare(b.at || b.day))[0]; }
function prospects(q) {
  ensureBoard();
  const tonight = q.get("tonight") === "1", conf = q.get("conf") || "";
  const bp = BOARD ? Object.fromEntries((BOARD.players || []).map(p => [M.key(p.n), p])) : {};
  let ps = D.players.filter(p => fin(p.draftRank) && (!conf || p.conference === conf)).sort((a, b) => a.draftRank - b.draftRank);
  const t0 = dayNY();
  if (tonight) ps = ps.filter(p => D.games.some(g => g.day === t0 && (g.home === p.teamId || g.away === p.teamId)));
  const row = p => {
    const b = bp[M.key(p.name)], t = byId[p.teamId], g = nextGame(p.teamId);
    let ng = "—"; if (g) { const home = g.home === p.teamId, o = byId[home ? g.away : g.home], l = g.state === "pre" ? lineFor(g) : null; ng = (g.day === t0 ? "<b>Today</b>" : dLabel(g.day, { weekday: "short" })) + " " + (home ? "vs " : "at ") + esc(o.short) + (l ? ' <span class="note">' + pct(home ? l.homeProb : 1 - l.homeProb) + "</span>" : ""); }
    const delta = b && b.hist && b.hist.length > 7 ? b.hist[b.hist.length - 8] - b.rank : null;
    return "<tr><td><b>" + p.draftRank + "</b></td><td>" + (b ? spark(b.hist, delta) : "") + (fin(delta) && delta ? ' <small class="' + (delta > 0 ? "pos" : "neg") + '">' + (delta > 0 ? "▲" : "▼") + Math.abs(delta) + "</small>" : "") + "</td><td class=\"l\">" + playerLink(p) + (naiRank[p.id] ? ' <span class="pill nai">Naismith</span>' : "") + '</td><td class="tm">' + teamLink(t, { rank: true }) + "</td><td>" + esc(b && b.pos || p.pos || "") + "</td><td>" + (b && fin(b.age) ? f1(b.age) : "") + "</td><td>" + (b && b.hi ? b.hi + "–" + b.lo : "") + "</td><td>" + (b ? b.on : p.draftSources || "") + "</td><td><b>" + f1(stat(p, "pts")) + "</b>/" + f1(stat(p, "reb")) + "/" + f1(stat(p, "ast")) + '</td><td class="ng l">' + ng + "</td></tr>";
  };
  return '<h2 class="sec">College prospects</h2><p class="lede">Every college player on the site\'s <a href="../draft/">2027 NBA Big Board</a>, the consensus of ' + (BOARD && BOARD.sources ? BOARD.sources.length : "several") + ' outlets, with how his stock has moved, this season\'s line and his next game. Tap a player for his card.</p>' +
    '<div class="controls">' + confSelect(conf) + '<label class="switch"><input type="checkbox" data-param="tonight" value="1"' + (tonight ? " checked" : "") + "> <span>Playing today</span></label><a class=\"btn\" href=\"../draft/\">Full Big Board and mock draft ↗</a></div>" +
    '<div class="panel"><div class="scroll"><table class="t"><thead><tr><th>Board</th><th>Trend</th><th class=l>Player</th><th class=l>School</th><th>Pos</th><th>Age</th><th>Range</th><th>Boards</th><th>PTS/REB/AST</th><th class=l>Next game</th></tr></thead><tbody>' + (ps.length ? ps.map(row).join("") : '<tr><td colspan="10" class="note">No prospects match.</td></tr>') + "</tbody></table></div></div>" +
    '<p class="note">Board rank, trend (last ' + (BOARD && BOARD.dates ? BOARD.dates.length : "") + " snapshots), range (best–worst outlet rank) and boards (outlets ranking him) come from the Big Board, as of " + dLabel(BOARD && BOARD.asof) + ". International prospects are on the Big Board itself.</p>";
}

function matchup(q) {
  let a = byId[q.get("a")], b = byId[q.get("b")], site = q.get("site") || "n";
  if (!a || !b) {
    const t0 = dayNY(), g = D.games.filter(x => x.day === t0 && x.state === "pre").sort((x, y) => watchIndex(y, lineFor(y)) - watchIndex(x, lineFor(x)))[0];
    if (g && !a && !b) { a = byId[g.away]; b = byId[g.home]; site = g.neutral ? "n" : "b"; }
    else { const r = M.ranked(D.teams); a = a || r[0]; b = b || (r[1].id === a.id ? r[0] : r[1]); }
  }
  const neutral = site === "n", home = site === "a" ? a : b, away = home === a ? b : a;
  const l = M.line(home, away, neutral, avg);
  const controls = '<div class="controls">' + teamSelect("a", a.id, "Team") + '<button class="btn" type="button" data-swap>⇄ Swap</button>' + teamSelect("b", b.id, "Opponent") + '<label>Court' + seg("site", [["a", a.short + " home"], ["n", "Neutral"], ["b", b.short + " home"]], site) + "</label></div>";
  if (!l) return '<h2 class="sec">Spread machine</h2>' + controls + '<p class="callout">One of these teams has no efficiency ratings yet, so the hub can\'t set a line.</p>';
  const aProb = home === a ? l.homeProb : 1 - l.homeProb, aPts = home === a ? l.homePts : l.awayPts, bPts = home === a ? l.awayPts : l.homePts;
  const fav = aProb >= 0.5 ? a : b, dog = fav === a ? b : a, sp = Math.abs(l.spread);
  const venues = [["a", a.short + " home"], ["n", "Neutral"], ["b", b.short + " home"]].map(([s, lab]) => { const h = s === "a" ? a : b, w = h === a ? b : a, x = M.line(h, w, s === "n", avg), pa = h === a ? x.homeProb : 1 - x.homeProb, m = h === a ? x.spread : -x.spread; return "<tr><td>" + esc(lab) + "</td><td>" + (Math.abs(m) < 0.5 ? "Pick'em" : esc((m > 0 ? a : b).short) + " −" + half(m)) + "</td><td>" + pct(pa) + "</td><td>" + pct(1 - pa) + "</td></tr>"; }).join("");
  const tape = [
    ["Haslametrics rank", t => int(t.haslamRank), t => -(t.haslamRank || 999)], ["BPI rank", t => int(t.bpiRank), t => -(t.bpiRank || 999)], ["Record", rec, null],
    ["Adj. offense", t => f1(t.metrics.adjO), t => t.metrics.adjO], ["Adj. defense", t => f1(t.metrics.adjD), t => -t.metrics.adjD], ["Net", t => sg(M.em(t)), t => M.em(t)],
    ["Pace", t => f1(t.metrics.tempo), null], ["3-point rate", t => f1(t.metrics.threeShare) + "%", null], ["3P%", t => f1(t.metrics.threePct), t => t.metrics.threePct],
    ["Opp 3P%", t => f1(t.metrics.oppThreePct), t => -t.metrics.oppThreePct], ["Rim rate", t => f1(t.metrics.rimShare) + "%", null], ["Rim FG%", t => f1(t.metrics.rimPct), t => t.metrics.rimPct],
    ["Schedule rank (SOS)", t => int(t.metrics.sosRank), t => -(t.metrics.sosRank || 999)]
  ].map(([lab, v, edge]) => { const ea = edge ? edge(a) : null, eb = edge ? edge(b) : null, w = edge && fin(ea) && fin(eb) && ea !== eb ? (ea > eb ? "a" : "b") : ""; return "<tr><td" + (w === "a" ? ' class="edge"' : "") + ">" + v(a) + '</td><td class="mid">' + lab + "</td><td" + (w === "b" ? ' class="edge"' : "") + ">" + v(b) + "</td></tr>"; }).join("");
  const keyMen = t => (rosters[t.id] || []).filter(hasGames).sort((x, y) => (stat(y, "pts") || 0) - (stat(x, "pts") || 0)).slice(0, 5).map(p => "<li>" + playerLink(p) + badges(p) + '<span class="grow"></span><span class="num">' + f1(stat(p, "pts")) + "/" + f1(stat(p, "reb")) + "/" + f1(stat(p, "ast")) + "</span></li>").join("") || '<li class="note">No stats yet</li>';
  const g = D.games.find(x => (x.home === a.id && x.away === b.id) || (x.home === b.id && x.away === a.id));
  const pair = (x) => (x.home === a.id && x.away === b.id) || (x.home === b.id && x.away === a.id);
  // prefer ESPN's own game (numeric id) over a schedule placeholder for the same game
  const meet = [...D.games.filter(pair), ...((SCHED && SCHED.games) || []).filter(pair)].filter((x) => BET && BET.games && BET.games[x.id]).sort((x, y) => /^\d+$/.test(y.id) - /^\d+$/.test(x.id))[0];
  return '<h2 class="sec">Spread machine</h2><p class="lede">Pick any two teams and a court. The hub projects each team\'s points from its adjusted offense against the other\'s adjusted defense at their average pace, adds ' + M.HOME_EDGE + ' points for home court, and turns the margin into a win probability.</p>' + controls +
    '<div class="verdict"><b>' + (sp < 0.5 ? "Pick'em" : esc(fav.short) + " by " + half(sp)) + "</b> " + (neutral ? "on a neutral court" : "at " + esc(home.short)) + '<small>Projected ' + esc(a.short) + " " + Math.round(aPts) + ", " + esc(b.short) + " " + Math.round(bPts) + " · Total " + half(l.total) + " · " + f1(l.pace, 0) + " possessions" + (g ? ' · <a href="#/today?day=' + g.day + '">They meet ' + dLabel(g.day) + "</a>" : "") + "</small></div>" +
    '<div class="wp"><div class="wp-l">' + logo(a) + "<b>" + esc(a.short) + "</b> " + pct(aProb) + '</div><div class="wp-bar"><b style="width:' + (aProb * 100).toFixed(1) + '%;background:' + esc(a.color || "var(--ink)") + '"></b><i style="background:' + esc(b.color || "var(--red)") + '"></i></div><div class="wp-r">' + pct(1 - aProb) + " <b>" + esc(b.short) + "</b>" + logo(b) + "</div></div>" +
    (sp >= 0.5 && Math.min(aProb, 1 - aProb) >= 0.25 && (dog.haslamRank || 999) - (fav.haslamRank || 999) >= 25 ? '<p class="callout">Upset watch: ' + esc(dog.short) + " wins this about " + pct(Math.min(aProb, 1 - aProb)) + " of the time.</p>" : "") +
    '<div class="two">' + muSide(a, b) + muSide(b, a) + '</div><p class="note">Percentiles against all Division I teams, each side\'s offense next to the other\'s defense. Red is good, blue is bad; the bigger number wins the row.</p>' +
    (meet ? betPanel(meet, byId[meet.home], byId[meet.away]) : "") +
    '<div class="two"><div class="panel"><h3>Tale of the tape</h3><div class="scroll"><table class="t tape"><thead><tr><th>' + esc(a.short) + '</th><th class="mid"></th><th>' + esc(b.short) + "</th></tr></thead><tbody>" + tape + "</tbody></table></div></div>" +
    '<div><div class="panel"><h3>At every court</h3><table class="t"><thead><tr><th class=l>Court</th><th>Line</th><th>' + esc(a.short) + "</th><th>" + esc(b.short) + "</th></tr></thead><tbody>" + venues + "</tbody></table></div>" +
    '<div class="panel"><h3>' + esc(a.short) + ' go-to players</h3><ul class="rlist">' + keyMen(a) + '</ul></div><div class="panel"><h3>' + esc(b.short) + ' go-to players</h3><ul class="rlist">' + keyMen(b) + "</ul></div></div></div>";
}

function bracket(q) {
  const S_ = SIM(), m = D.march;
  if (!S_) return '<p class="callout">Tournament odds arrive with the next data update.</p>';
  const conf = q.get("conf") || "", show = q.get("show") || "field", sort = q.get("sort") || "title";
  const cols = { title: o => o.r[6], f4: o => o.r[4], e8: o => o.r[3], s16: o => o.r[2], r32: o => o.r[1], in: o => o.in, aq: o => o.aq, seed: o => o.seed === null ? null : -o.seed };
  let rows = Object.entries(S_.teams).filter(([id, o]) => (!conf || byId[id].conference === conf) && (show === "all" || conf || (show === "bubble" ? o.in >= 0.15 && o.in <= 0.85 && o.aq < o.in * 0.6 : o.in >= 0.5)));
  const key = cols[sort] || cols.title;
  rows.sort((a, b) => { const x = key(a[1]), y = key(b[1]); return (x == null) - (y == null) || (y ?? 0) - (x ?? 0) || b[1].in - a[1].in; });
  const cell = x => x >= 0.995 ? '<td class="hot">>99%</td>' : x < 0.001 ? '<td class="note">–</td>' : '<td style="--p:' + Math.min(1, x * 1.6).toFixed(2) + '" class="heat">' + (x < 0.01 ? "<1%" : Math.round(x * 100) + "%") + "</td>";
  const tr = ([id, o]) => { const t = byId[id]; return '<tr class="go" data-href="#/team?id=' + esc(id) + '"><td class="tm">' + logo(t) + '<span class="nm">' + esc(t.short) + '</span><small class="cf">' + esc(t.conference) + " · " + rec(t) + "</small></td><td>" + (o.mode ? "<b>" + o.mode + '</b> <small class="rr">' + f1(o.seed) + "</small>" : "–") + "</td>" + cell(o.in) + cell(o.aq) + o.r.slice(1).map(cell).join("") + "</tr>"; };
  const region = (r, k) => '<div class="region"><h4>' + ["East", "South", "Midwest", "West"][k] + "</h4>" + r.map(sl => '<div class="bs"><b class="sd">' + sl.seed + "</b>" + sl.teams.map(id => { const t = byId[id], o = odds(id); return '<a href="#/team?id=' + esc(id) + '">' + logo(t) + '<span class="nm">' + esc(t.short) + '</span><small>' + (o && o.r[6] >= 0.001 ? pct(o.r[6]) : "") + "</small></a>"; }).join("") + "</div>").join("") + "</div>";
  const bubble = (ids, lab) => '<div class="panel"><h3>' + lab + '</h3><ul class="rlist">' + ids.map(id => { const t = byId[id], o = odds(id); return "<li>" + teamLink(t, { rank: true }) + '<span class="grow sub">' + esc(t.conference) + " · " + rec(t) + '</span><span class="num">' + pct(o && o.in) + "</span></li>"; }).join("") + "</ul></div>";
  return '<h2 class="sec">Tournament odds</h2><p class="lede">The rest of the season played out ' + S_.sims.toLocaleString("en-US") + ' times, through conference tournaments, selection and the 76-team tournament. Each team\'s chance to make the field, earn its conference\'s automatic bid and reach every round. Updated ' + dLabel(X.updated) + ".</p>" +
    titleStrip(8) +
    '<div class="controls">' + confSelect(conf) + seg("show", [["field", "Contenders"], ["bubble", "Bubble"], ["all", "All 365"]], show) + '<a class="btn" href="#/bubble">Bubble watch →</a></div>' +
    '<div class="panel"><div class="scroll"><table class="t odds"><thead><tr><th class=l>Team</th>' + sortTh("seed", "Seed", sort, "Most likely seed, with the average seed when in the field") + sortTh("in", "Make it", sort) + sortTh("aq", "Auto bid", sort) + sortTh("r32", "R32", sort) + sortTh("s16", "Sweet 16", sort) + sortTh("e8", "Elite 8", sort) + sortTh("f4", "Final Four", sort) + "<th>Title game</th>" + sortTh("title", "Champion", sort) + "</tr></thead><tbody>" +
    (rows.length ? rows.map(tr).join("") : '<tr><td colspan="10" class="note">No teams match.</td></tr>') + "</tbody></table></div></div>" +
    '<h2 class="sec">Projected bracket</h2><p class="lede">If the season ended with today\'s ratings: the favorite in each conference tournament takes the automatic bid, the next 44 strongest teams get at-large spots, and seeds follow the S-curve. Pairs play in the Opening Round. Percentages are title odds.</p>' +
    '<div class="regions">' + S_.bracket.map(region).join("") + "</div>" +
    '<div class="two">' + bubble(S_.lastIn, "Last in") + bubble(S_.firstOut, "First out") + "</div>" +
    (m ? '<details class="org"><summary>Haslametrics\' field today (' + dLabel(m.updated) + ')</summary><div class="seeds">' + Array.from({ length: 16 }, (_, k) => k + 1).map(sd => '<div class="sl"><b class="sd">' + sd + "</b>" + m.slots.filter(x => x.seed === sd).map(sl => '<div class="slot' + (sl.teamIds.length > 1 ? " ff" : "") + '">' + sl.teamIds.map(id => { const t = byId[id]; return t ? '<a href="#/team?id=' + esc(id) + '">' + logo(t) + '<span class="nm">' + esc(t.short) + "</span></a>" : ""; }).join("") + "</div>").join("") + "</div>").join("") + "</div></details>" : "") +
    '<p class="note">' + esc(S_.method) + " Regions are named for layout only; the real committee also weighs résumé, which this strength-first selection doesn't.</p>";
}

/* ---------- bubble watch ---------- */
const BUCKETS = [["lock", "Locks", 0.95, 1.01], ["should", "Should be in", 0.75, 0.95], ["work", "Work to do", 0.35, 0.75], ["long", "Long shots", 0.08, 0.35]];
function bucketOf(o) {
  if (!o) return null;
  if (o.in >= 0.95) return "lock";
  if (o.in < 0.08 || o.aq >= 0.6 * o.in) return null; // a one-bid league's path is its automatic bid, not the bubble
  return BUCKETS.find(b => o.in >= b[2] && o.in < b[3])[0];
}
function bubbleHist() {
  const H = (X && X.bubbleHist) || {}, days = Object.keys(H).sort(), last = days[days.length - 1];
  if (!last || days.length < 2) return { H, days, ago: null };
  const wk = new Date(Date.parse(last + "T12:00:00Z") - 7 * 864e5).toISOString().slice(0, 10);
  return { H, days, ago: days.filter(d => d <= wk).pop() || days[0] };
}
function moveChip(id, hb) {
  if (!hb.ago) return "";
  const o = odds(id), was = hb.H[hb.ago][id]; if (!o || was === undefined) return "";
  const d = Math.round((o.in - was) * 100);
  return Math.abs(d) < 2 ? '<span class="mv">–</span>' : '<span class="mv ' + (d > 0 ? "up" : "dn") + '" title="Since ' + dLabel(hb.ago) + '">' + (d > 0 ? "▲" : "▼") + Math.abs(d) + "</span>";
}
function gameById(id) { return D.games.find(g => g.id === id) || (SCHED ? SCHED.games.find(g => g.id === id) : null); }
function nextFor(id) {
  const S_ = SIM(), g = nextGame(id); if (!g) return "";
  const home = g.home === id, o = byId[home ? g.away : g.home]; if (!o) return "";
  const l = lineFor(g), sw = (S_.swing || []).find(x => x.id === g.id), sp = sw ? (home ? sw.h : sw.a) : null;
  return '<span class="nx">' + dLabel(g.day, { weekday: "short" }) + " " + (home ? "vs " : g.neutral ? "vs " : "at ") + esc(o.short) + (l ? " · " + pct(home ? l.homeProb : 1 - l.homeProb) : "") + (sp && sp[0] - sp[1] >= 0.02 ? ' · <b title="Chance to make the field after a win / a loss">' + pct(sp[0]) + " / " + pct(sp[1]) + "</b>" : "") + "</span>";
}
function bubbleRow(id, o, hb, tag) {
  const t = byId[id];
  return '<li class="br"><a class="tl" href="#/team?id=' + esc(id) + '">' + logo(t) + rk(t) + '<span class="nm">' + esc(t.short) + "</span></a>" + (tag || "") +
    '<span class="sub">' + rec(t) + " · WAB " + sg(o.wab) + (o.mode ? " · " + o.mode + " seed" : "") + "</span>" +
    '<span class="odd"><b>' + pct(o.in) + "</b>" + moveChip(id, hb) + "</span>" + nextFor(id) + "</li>";
}
function bubble(q) {
  const S_ = SIM();
  if (!S_) return '<p class="callout">Bubble watch arrives with the next data update.</p>';
  ensureSched();
  const conf = q.get("conf") || "", show = q.get("show") || "conf", hb = bubbleHist();
  const rows = Object.entries(S_.teams).map(([id, o]) => [id, o, bucketOf(o)]).filter(r => r[2] && byId[r[0]] && (!conf || byId[r[0]].conference === conf));
  const count = k => rows.filter(r => r[2] === k).length;
  const lastIn = new Set((S_.lastIn || []).slice(-4)), firstOut = new Set((S_.firstOut || []).slice(0, 4));
  const tag = id => lastIn.has(id) ? '<span class="pill warn">Last 4 in</span>' : firstOut.has(id) ? '<span class="pill">First 4 out</span>' : "";
  const bids = {};
  Object.entries(S_.teams).forEach(([id, o]) => { const c = byId[id] && byId[id].conference; if (c) bids[c] = (bids[c] || 0) + o.in; });
  const topConfs = Object.entries(bids).sort((a, b) => b[1] - a[1]).filter(([, v]) => v >= 1.5);
  const maxBids = topConfs.length ? topConfs[0][1] : 1;
  let body = "";
  if (show === "cut") {
    const list = rows.filter(r => r[2] !== "lock").sort((a, b) => b[1].in - a[1].in);
    const cut = list.findIndex(r => r[1].in < 0.5);
    body = '<div class="panel"><h3>Around the cut line <small>chance to make the field</small></h3><ol class="rlist bub">' + list.map((r, k) => (k === cut ? '<li class="cutline"><span>Cut line · 50%</span></li>' : "") + bubbleRow(r[0], r[1], hb, tag(r[0]))).join("") + "</ol></div>";
  } else {
    const confs = [...new Set(rows.map(r => byId[r[0]].conference))].sort((a, b) => (bids[b] || 0) - (bids[a] || 0));
    body = '<div class="bconfs">' + confs.map(c => {
      const mine = rows.filter(r => byId[r[0]].conference === c).sort((a, b) => b[1].in - a[1].in);
      if (!mine.some(r => r[2] !== "lock") && !conf) { if ((bids[c] || 0) < 1.5) return ""; }
      const locks = mine.filter(r => r[2] === "lock");
      return '<section class="panel bconf"><h3>' + esc(c) + " <small>" + f1(bids[c] || 0) + " bids expected</small></h3>" +
        (locks.length ? '<div class="locks"><span class="bl">Locks</span>' + locks.map(([id]) => '<a href="#/team?id=' + esc(id) + '" title="' + pct(S_.teams[id].in) + '">' + logo(byId[id]) + '<span class="nm">' + esc(byId[id].short) + "</span></a>").join("") + "</div>" : "") +
        BUCKETS.slice(1).map(([k, lab]) => { const rs = mine.filter(r => r[2] === k); return rs.length ? '<p class="bl">' + lab + '</p><ul class="rlist bub">' + rs.map(r => bubbleRow(r[0], r[1], hb, tag(r[0]))).join("") + "</ul>" : ""; }).join("") + "</section>";
    }).join("") + "</div>";
  }
  const swing = (S_.swing || []).filter(g => !conf || byId[g.home].conference === conf || byId[g.away].conference === conf).slice(0, 12);
  const swCard = g => {
    const h = byId[g.home], a = byId[g.away], gm = gameById(g.id), l = gm ? lineFor(gm) : null, hp = l ? l.homeProb : g.hp;
    const side = (t, p, sp) => '<div class="sw-t">' + logo(t) + '<a class="nm" href="#/team?id=' + esc(t.id) + '">' + esc(t.short) + '</a><span class="pr">' + pct(p) + "</span>" +
      (sp[0] - sp[1] >= 0.02 ? '<span class="ifs"><b>' + pct(sp[0]) + "</b> win · <b>" + pct(sp[1]) + "</b> loss</span>" : '<span class="ifs note">' + pct(odds(t.id) && odds(t.id).in) + " either way</span>") + "</div>";
    return '<article class="swc"><header>' + dLabel(g.day, { weekday: "short" }) + (gm ? " · " + tip(gm) + (gm.at ? " ET" : "") + (gm.tv ? " · " + esc(gm.tv) : "") : "") + '<span class="pill">±' + Math.round(g.big * 100) + "</span></header>" +
      side(a, 1 - hp, g.a) + side(h, hp, g.h) + "</article>";
  };
  return '<h2 class="sec">Bubble watch</h2><p class="lede">Every team whose at-large hopes are in play, from ' + S_.sims.toLocaleString("en-US") + " simulated seasons. Selection here blends each team's rating with Wins Above Bubble (WAB): each result minus the chance a bubble-strength team would have won the same game, the résumé number on the committee's team sheets. Teams in one-bid leagues are left out unless they're in either way. Updated " + dLabel(X.updated) + ".</p>" +
    tiles4([[count("lock"), "Locks · 95%+"], [count("should"), "Should be in · 75-95%"], [count("work"), "Work to do · 35-75%"], [count("long"), "Long shots · 8-35%"]]) +
    '<div class="controls">' + confSelect(conf) + seg("show", [["conf", "By conference"], ["cut", "Cut line"]], show) + '<a class="btn" href="#/bracket?show=bubble">Bracket odds →</a></div>' +
    (swing.length ? '<h3 class="ch">Games that matter this week</h3><p class="note">Each team\'s chance to make the field after a win and after a loss. ±: the biggest swing in the game.</p><div class="swings">' + swing.slice(0, 6).map(swCard).join("") + "</div>" + (swing.length > 6 ? '<details class="more-sw"><summary>' + (swing.length - 6) + ' more games</summary><div class="swings">' + swing.slice(6).map(swCard).join("") + "</div></details>" : "") : "") +
    body +
    (!conf && topConfs.length ? '<div class="panel"><h3>Bids by conference <small>expected teams in the field</small></h3><div class="body"><div class="ladder">' + topConfs.map(([c, v]) => '<div class="lr"><span>' + esc(c) + '</span><i><b style="width:' + (v / maxBids * 100).toFixed(1) + '%"></b></i><em>' + f1(v) + "</em></div>").join("") + "</div></div></div>" : "") +
    '<p class="note">WAB and the selection blend are the hub\'s estimate of how the committee reads a résumé (rating + ' + (S_.resume || 1) + " × WAB); the real committee also looks at quadrant records, road wins and the eye test. Movement compares with " + (hb.ago ? dLabel(hb.ago) : "the first day of tracking") + ".</p>";
}

function method() {
  const r = X && X.record, src = Object.values(D.sources || {});
  const graded = X ? Object.values(X.lines.games).filter(v => v.final).sort((a, b) => b.day.localeCompare(a.day)) : [];
  const upsets = graded.filter(v => v.upset).slice(0, 8);
  return '<div class="method"><h2 class="sec">How it works</h2>' +
    "<h3>The line</h3><p>Each team's projected points are its adjusted offense times the opponent's adjusted defense, divided by the Division I average (" + f1(avg) + " points per 100 possessions), scaled to the two teams' average pace. Home court is worth " + M.HOME_EDGE + " points, split between the two scores. The margin becomes a win probability with a normal curve whose spread is " + M.SPREAD_SD + " points: how far the hub\'s lines have actually missed over its last 400 graded games, measured again every day. Early-season ratings miss by more, so the hub is less sure of itself in November than in March. Ratings are Haslametrics' adjusted efficiency and tempo; early in the season they still lean on preseason priors.</p>" +
    "<h3>Keeping score</h3><p>Every few hours the updater logs the hub's line for each scheduled game, refreshing it until tipoff, then grades it against the final. Nothing is graded with hindsight ratings.</p>" +
    (r && r.games ? '<div class="panel"><h3>Hub record <small>since ' + dLabel(X.lines.since) + "</small></h3>" + tiles4([[r.right + "-" + (r.games - r.right), "Picking winners"], [Math.round(r.right / r.games * 100) + "%", "Right"], [f1(r.avgMiss), "Avg spread miss"], [f1(r.avgTotalMiss), "Avg total miss"]]) + '<table class="t"><thead><tr><th class=l>Confidence</th><th>Games</th><th>Right</th><th>Expected</th></tr></thead><tbody>' + r.buckets.map(b => "<tr><td>" + esc(b.label) + "</td><td>" + b.games + "</td><td>" + (b.games ? Math.round(b.right / b.games * 100) + "%" : "—") + "</td><td>" + (fin(b.expected) ? b.expected + "%" : "—") + "</td></tr>").join("") + "</tbody></table></div>" : '<p class="callout">The hub started logging lines on ' + dLabel(X && X.lines.since || D.today) + ". Its record appears once those games go final.</p>") +
    (upsets.length ? '<div class="panel"><h3>Biggest upsets of the hub\'s lines</h3><ul class="rlist">' + upsets.map(v => { const h = byId[v.home], a = byId[v.away], winner = v.final[0] > v.final[1] ? h : a; return "<li>" + logo(winner) + '<span class="grow"><b>' + esc(winner.short) + "</b> beat " + esc((winner === h ? a : h).short) + " " + int(Math.max(...v.final)) + "-" + int(Math.min(...v.final)) + '<span class="sub">' + dLabel(v.day) + " · hub had them at " + pct(winner === h ? v.homeProb : 1 - v.homeProb) + "</span></span></li>"; }).join("") + "</ul></div>" : "") +
    "<h3>Season simulation</h3><p>" + esc(SIM() ? SIM().method : "") + " Every league plays an eight-team conference tournament. Wins Above Bubble counts each finished game against Division I opponents: the result (1 or 0) minus the chance a team with the 45th-best rating would have won it at the same venue.</p>" +
    "<h3>Watchability</h3><p>A 0-100 score for each game: half from the two teams' national rank in efficiency margin, up to 30 for a close line, a little for pace, and bonuses for NBA Big Board top-60 prospects, Naismith watch-list players, conference games and games in progress.</p>" +
    "<h3>Naismith ladder</h3><p>" + esc(X ? X.naismith.method : "") + " The official watch list comes from the Atlanta Tipoff Club; players can play their way on and off it.</p>" +
    "<h3>Sources</h3><ul>" + src.map(s => '<li><a href="' + safe(s.url) + '" target="_blank" rel="noopener">' + esc(s.name) + "</a>: " + esc(s.status === "linked" ? "linked, not connected. " + (s.note || "") : "connected" + (s.updated ? ", updated " + dLabel(s.updated) : "") + (s.coverage ? " (" + s.coverage + ")" : "")) + "</li>").join("") +
    '<li><a href="../draft/">NBA Big Board</a>: the site\'s consensus 2027 board, matched to college rosters by name and school.</li><li><a href="' + safe(X && X.naismith.url) + '">Naismith Trophy watch list</a> (' + esc(X && X.naismith.source || "") + ").</li></ul>" +
    "<p>KenPom, Bart Torvik, EvanMiya and the rest are great; their numbers aren't shown here unless a feed is connected, and nothing local is labeled with their metric names.</p></div>";
}

/* ---------- player card ---------- */
// Percentiles against Division I regulars (3+ games, 15+ minutes a game) at his position (guards, forwards, centers),
// so a guard's rebounding is judged against guards. Rates need volume behind them: TS% 5+ shots a game, 3P% two
// threes a game, assist-to-turnover a turnover a game. Per game, the way the season line reads.
const PCT_STATS = [
  ["pts", "Scoring", (p) => stat(p, "pts")],
  ["ts", "Efficiency (TS%)", (p) => ((stat(p, "fga") || 0) >= 5 ? stat(p, "ts") : null)],
  ["tp", "Three-point %", (p) => ((stat(p, "threeAtt") || 0) >= 2 ? stat(p, "threePct") : null)],
  ["tpa", "Threes a game", (p) => stat(p, "threeAtt")],
  ["reb", "Rebounding", (p) => stat(p, "reb")],
  ["ast", "Playmaking", (p) => stat(p, "ast")],
  ["ato", "Ball security (A/TO)", (p) => ((stat(p, "tov") || 0) >= 1 ? (stat(p, "ast") || 0) / stat(p, "tov") : null)],
  ["stl", "Steals", (p) => stat(p, "stl")],
  ["blk", "Blocks", (p) => stat(p, "blk")],
  ["gs", "Game Score", (p) => M.gameScore(p)],
];
let PCT_POOL = null;
const posGroup = (p) => { const s = String(p.pos || "").toUpperCase(); return /C/.test(s) && !/G/.test(s) ? "C" : /F/.test(s) && !/G/.test(s) ? "F" : "G"; };
const POS_NAME = { G: "guards", F: "forwards", C: "centers" };
function pctPool() {
  if (PCT_POOL) return PCT_POOL;
  PCT_POOL = {};
  const regs = D.players.filter((p) => (stat(p, "gp") || 0) >= 3 && (stat(p, "min") || 0) >= 15);
  for (const g of ["G", "F", "C"]) {
    const grp = regs.filter((p) => posGroup(p) === g);
    PCT_POOL[g] = { n: grp.length, sorted: Object.fromEntries(PCT_STATS.map(([k, , fn]) => [k, grp.map(fn).filter(fin).sort((a, b) => a - b)])) };
  }
  return PCT_POOL;
}
function pctOf(sorted, v) {
  if (!sorted || sorted.length < 10 || !fin(v)) return null;
  let lo = 0, eq = 0;
  for (const w of sorted) { if (w < v) lo++; else if (w === v) eq++; }
  return Math.round(100 * (lo + Math.max(0, eq - 1) / 2) / (sorted.length - 1));
}
function pctColorC(v) { const t = Math.max(0, Math.min(100, v)) / 100, mx = (a, b, k) => Math.round(a + (b - a) * k); const c = t < 0.5 ? [mx(54, 222, t * 2), mx(97, 222, t * 2), mx(173, 222, t * 2)] : [mx(222, 210, (t - 0.5) * 2), mx(222, 45, (t - 0.5) * 2), mx(222, 73, (t - 0.5) * 2)]; return "rgb(" + c.join(",") + ")"; }
function pctBars(p) {
  if ((stat(p, "gp") || 0) < 1) return "";
  const g = posGroup(p), pool = pctPool()[g];
  const bars = PCT_STATS.map(([k, label, fn]) => {
    const v = fn(p), pc = pctOf(pool.sorted[k], v);
    if (pc == null) return "";
    return '<div class="svb"><span>' + label + ' <small style="font-weight:600;color:var(--faint)">' + f1(v, k === "ato" ? 2 : 1) + '</small></span><i><em style="width:' + Math.max(4, pc) + "%;background:" + pctColorC(pc) + '"></em><b style="left:calc(' + Math.max(4, pc) + "% - 13px);background:" + pctColorC(pc) + ";color:" + (pc >= 80 || pc <= 20 ? "#fff" : "var(--ink)") + '">' + pc + "</b></i></div>";
  }).join("");
  if (!bars) return "";
  const reg = (stat(p, "gp") || 0) >= 3 && (stat(p, "min") || 0) >= 15;
  return '<p class="card-sec">Against D-I ' + POS_NAME[g] + '</p><div class="svbars">' + bars + '</div><p class="note">Percentile among ' + pool.n + " Division I " + POS_NAME[g] + " with 15+ minutes a game: red is good, blue is bad." + (reg ? "" : " He's short of that playing time, so read these as a small sample.") + "</p>";
}
// his share of what his team scores (the roster's points a game, summed)
function ordinalC(n) { const v = n % 100; return n + (v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"); }
function teamShare(p) {
  const ros = rosters[p.teamId] || [], tot = ros.reduce((a, q) => a + (stat(q, "pts") || 0), 0), mine = stat(p, "pts") || 0;
  if (!(tot > 20) || !(mine > 0)) return "";
  const rank = 1 + ros.filter((q) => (stat(q, "pts") || 0) > mine).length;
  return '<p class="tldr">Scores <b>' + Math.round(100 * mine / tot) + "%</b> of " + esc(byId[p.teamId].short) + "'s points, " + (rank === 1 ? "the most on the team" : ordinalC(rank) + " on the team") + ".</p>";
}
function openPlayer(id) {
  const p = byPlayer[id]; if (!p) return; ensureBoard();
  const t = byId[p.teamId], b = BOARD ? (BOARD.players || []).find(x => M.key(x.n) === M.key(p.name)) : null, n = X && X.naismith.ladder.find(r => r.id === id), g = nextGame(p.teamId);
  let ng = ""; if (g) { const home = g.home === p.teamId, o = byId[home ? g.away : g.home], l = g.state === "pre" ? lineFor(g) : null; ng = '<p class="tldr"><b>Next:</b> ' + dLabel(g.day, { weekday: "short" }) + " " + (home ? "vs " : "at ") + '<a href="#/matchup?a=' + esc(t.id) + "&b=" + esc(o.id) + "&site=" + (g.neutral ? "n" : home ? "a" : "b") + '">' + esc(o.short) + "</a>" + (l ? " · " + favLine(l, byId[g.home], byId[g.away]) + ", " + esc(t.short) + " " + pct(home ? l.homeProb : 1 - l.homeProb) : "") + "</p>"; }
  $("#cardBody").innerHTML = '<div class="card-h">' + face(p, 72) + "<div><h3>" + esc(p.name) + '</h3><div class="meta">' + logo(t) + " " + esc(t.short) + " · " + esc([p.pos, p.year, p.height, p.weight].filter(Boolean).join(" · ")) + (p.jersey ? " · #" + esc(p.jersey) : "") + "</div><div>" + badges(p) + "</div></div></div>" +
    '<div class="card-b"><div class="kv">' + [["gp", "GP", 0], ["min", "MIN"], ["pts", "PTS"], ["reb", "REB"], ["ast", "AST"], ["stl", "STL"], ["blk", "BLK"], ["tov", "TOV"], ["fgPct", "FG%"], ["threePct", "3P%"], ["ftPct", "FT%"], ["ts", "TS%"], ["gs", "GmSc"]].filter(([k]) => pval(p, k) !== null).map(([k, l, d]) => "<div><b>" + f1(pval(p, k), d === 0 ? 0 : 1) + "</b><span>" + l + "</span></div>").join("") + "</div>" + teamShare(p) + ng + pctBars(p) +
    (n ? '<p class="card-sec">Naismith Watch</p><p class="tldr">On the watch list. Hub ladder <b>#' + n.rank + "</b> of 50" + (n.prev ? " (" + (n.prev > n.rank ? "up " + (n.prev - n.rank) : n.prev < n.rank ? "down " + (n.rank - n.prev) : "no change") + " since " + dLabel(X.naismith.since) + ")" : "") + '. <a href="#/naismith">Ladder →</a></p>' : "") +
    (b ? '<p class="card-sec">NBA Big Board</p><div class="kv"><div><b>#' + b.rank + "</b><span>Consensus</span></div><div><b>" + b.hi + "–" + b.lo + "</b><span>Range</span></div><div><b>" + b.on + "</b><span>Boards</span></div>" + (fin(b.age) ? "<div><b>" + f1(b.age) + "</b><span>Age</span></div>" : "") + "</div>" + (b.stats && b.stats.length ? '<p class="tldr">' + b.stats.map(s => esc(s[0]) + " " + esc(s[1])).join(" · ") + '</p>' : "") + '<p class="tldr">' + spark(b.hist) + ' <a href="../draft/">See him on the Big Board →</a></p>' : fin(p.draftRank) ? '<p class="card-sec">NBA Big Board</p><p class="tldr">Consensus #' + p.draftRank + ' · <a href="../draft/">Big Board →</a></p>' : "") +
    '<p class="note"><a href="' + safe(p.url) + '" target="_blank" rel="noopener">ESPN player page ↗</a> · Season line: ' + esc(p.source || "ESPN") + "</p></div>";
  const dlg = $("#card"); if (!dlg.open) dlg.showModal();
}

/* ---------- render + data ---------- */
const PAGES = { today, ratings, matchup, conferences, teams, team: teamPage, players, naismith, prospects, bracket, bubble, method };
// Four sections, as in the NBA Hub; grouped pages get a sub-tab row, and a section tab returns to the page last used in it
const GROUP = { today: "today", ratings: "teams", teams: "teams", team: "teams", conferences: "teams", matchup: "teams", players: "players", naismith: "players", prospects: "players", bracket: "march", bubble: "march" };
const SUBS = {
  teams: [["ratings", "Ratings"], ["teams", "Teams"], ["conferences", "Conferences"], ["matchup", "Matchup"]],
  players: [["players", "Players"], ["naismith", "Naismith"], ["prospects", "Prospects"]],
  march: [["bracket", "Projected bracket"], ["bubble", "Bubble"]],
};
const lastSub = (g, v) => { try { if (v) localStorage.setItem("cbb.sub." + g, v); return localStorage.getItem("cbb.sub." + g); } catch (e) { return null; } };
function render() {
  if (!D) return;
  const r = route(), fn = PAGES[r.page] || today, page = PAGES[r.page] ? r.page : "today", group = GROUP[page] || "";
  const subs = SUBS[group], cur = page === "team" ? "teams" : page;
  if (subs && subs.some(x => x[0] === cur)) lastSub(group, cur);
  document.querySelectorAll(".tabs a[data-tab]").forEach(a => {
    if (a.dataset.tab === group) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    const last = SUBS[a.dataset.tab] && lastSub(a.dataset.tab);
    if (last) a.setAttribute("href", "#/" + last);
  });
  const st = $("#subtabs");
  st.hidden = !subs;
  if (subs) st.innerHTML = subs.map(x => '<a href="#/' + x[0] + '"' + (x[0] === cur ? ' aria-current="page"' : "") + ">" + x[1] + "</a>").join("");
  view.innerHTML = fn(r.q);
  document.body.dataset.page = page;
}
function index() {
  byId = Object.fromEntries(D.teams.map(t => [t.id, t])); byPlayer = Object.fromEntries(D.players.map(p => [p.id, p])); rosters = {};
  D.players.forEach(p => (rosters[p.teamId] = rosters[p.teamId] || []).push(p));
  avg = M.leagueAvg(D.teams);
  D.teams.forEach(t => { pctNet[t.id] = M.percentile(D.teams, t, "margin") || 0; pctTempo[t.id] = M.percentile(D.teams, t, "tempo") || 50; });
  D.teams.filter(t => fin(t.metrics.adjO)).sort((a, b) => b.metrics.adjO - a.metrics.adjO).forEach((t, i) => rankO[t.id] = i + 1);
  D.teams.filter(t => fin(t.metrics.adjD)).sort((a, b) => a.metrics.adjD - b.metrics.adjD).forEach((t, i) => rankD[t.id] = i + 1);
  maxGp = Math.max(0, ...D.players.map(p => stat(p, "gp") || 0));
  naiRank = {}; if (X && X.naismith) X.naismith.ladder.forEach(r => naiRank[r.id] = r.rank);
}
async function load() {
  try {
    const [h, x] = await Promise.all([fetch("data/hub.json", { cache: "no-store" }), fetch("data/extras.json", { cache: "no-store" }).catch(() => null)]);
    if (!h.ok) throw Error("Data snapshot unavailable");
    D = await h.json(); X = x && x.ok ? await x.json() : null; if (X && X.spreadSd) M.setSpreadSd(X.spreadSd);
    index();
    $("#kicker").textContent = "College basketball · " + (D.seasonLabel || "");
    $("#foot").innerHTML = "Ratings from <a href=\"https://haslametrics.com/\">Haslametrics</a> (" + dLabel(D.sources.haslam && D.sources.haslam.updated) + ") and <a href=\"https://www.espn.com/mens-college-basketball/bpi\">ESPN BPI</a>. Rosters, stats and scores from ESPN. Prospects from the site's <a href=\"../draft/\">NBA Big Board</a>. Updated " + dLabel(D.updated, { hour: "numeric", minute: "2-digit" }) + ". <a href=\"#/method\">How it works</a>.";
    render();
    document.dispatchEvent(new CustomEvent("cbb:ready"));
    if (route().page === "today") refreshLive(false);
  } catch (e) { view.innerHTML = '<p class="callout">The college basketball snapshot did not load. Try again in a moment.</p>'; }
}
async function refreshLive(manual) {
  if (!D || document.hidden) return;
  const day = route().q.get("day") || dayNY(), url = "https://site.web.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?region=us&lang=en&contentorigin=espn&dates=" + day.replace(/-/g, "") + "&groups=50&limit=1000";
  const btn = view.querySelector("[data-refresh]"); if (btn && manual) { btn.disabled = true; btn.textContent = "Checking…"; }
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12000) }); if (!res.ok) throw Error("feed");
    const body = await res.json(); if (!Array.isArray(body.events) || (body.leagues && body.leagues[0] && body.leagues[0].season && body.leagues[0].season.year !== D.season)) throw Error("season");
    const rows = M.gamesFromESPN(body, byId, D.season), map = new Map(D.games.map(g => [g.day + "-" + g.away + "-" + g.home, g]));
    rows.forEach(g => { const k = g.day + "-" + g.away + "-" + g.home, old = map.get(k); map.set(k, old ? { ...old, ...g, id: old.id } : g); });
    D.games = [...map.values()]; liveStamp = new Date().toISOString();
    if (route().page === "today" && (route().q.get("day") || dayNY()) === day) render();
  } catch (e) { const s = $("#stamp"); if (s && manual) s.textContent = "Live scores unavailable, showing the snapshot"; }
  finally { const b = view.querySelector("[data-refresh]"); if (b) { b.disabled = false; b.textContent = "Refresh scores ↻"; } }
}

/* ---------- events ---------- */
let typing = null;
view.addEventListener("input", e => { const el = e.target; if (el.matches('input[type="search"][data-param]')) { clearTimeout(typing); typing = setTimeout(() => { setParams({ [el.dataset.param]: el.value.trim(), all: null, n: null }); const again = view.querySelector('input[data-param="' + el.dataset.param + '"]'); if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); } }, 220); } });
view.addEventListener("change", e => {
  const el = e.target;
  if (el.matches("select[data-param]")) setParams({ [el.dataset.param]: el.value, n: null });
  else if (el.matches('input[type="checkbox"][data-param]')) setParams({ [el.dataset.param]: el.checked ? "1" : null });
  else if (el.matches("select[data-vs]") && el.value) go("matchup", { a: el.dataset.vs, b: el.value, site: "a" });
});
document.addEventListener("click", e => {
  const el = e.target.closest("[data-player],[data-fav],[data-seg],[data-sort],[data-more],[data-refresh],[data-swap],[data-close],tr.go");
  if (!el) { if (e.target === $("#card")) $("#card").close(); return; }
  if (el.matches("a") || (e.target.closest("a") && !el.matches("[data-player]"))) return;
  if (el.hasAttribute("data-player")) { e.preventDefault(); openPlayer(el.dataset.player); return; }
  if (el.hasAttribute("data-close")) { $("#card").close(); return; }
  if (el.hasAttribute("data-fav")) { const id = el.dataset.fav; faves.has(id) ? faves.delete(id) : faves.add(id); save("ds-cbb:favorites", [...faves]); render(); return; }
  if (el.hasAttribute("data-seg")) { setParams({ [el.dataset.seg]: el.dataset.v }); return; }
  if (el.hasAttribute("data-sort")) { setParams({ sort: el.dataset.sort }); return; }
  if (el.hasAttribute("data-more")) { setParams(el.dataset.more === "n" ? { n: el.dataset.n } : { all: "1" }); return; }
  if (el.hasAttribute("data-refresh")) { refreshLive(true); return; }
  if (el.hasAttribute("data-swap")) { const q = route().q, s = q.get("site"); setParams({ a: q.get("b") || view.querySelector('[data-param="b"]').value, b: q.get("a") || view.querySelector('[data-param="a"]').value, site: s === "a" ? "b" : s === "b" ? "a" : s }); return; }
  if (el.matches("tr.go")) location.hash = el.dataset.href;
});
document.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-player]")) { e.preventDefault(); openPlayer(e.target.dataset.player); } });
window.addEventListener("hashchange", () => { const d = $("#card"); if (d.open) d.close(); render(); window.scrollTo({ top: Math.min(window.scrollY, view.offsetTop - 70) }); if (route().page === "today") refreshLive(false); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && route().page === "today") refreshLive(false); });
setInterval(() => { if (!document.hidden && route().page === "today" && D && D.games.some(g => g.day === dayNY() && g.state !== "post")) refreshLive(false); }, 90000);
load();
})();
