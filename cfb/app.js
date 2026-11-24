/* CFB Hub: lines against the sportsbook, power ratings, 12-team playoff odds, the Heisman ladder and the NFL Big Board's
   college prospects. Built on the MLB hub's styles (../mlb/hub.css) like the other hubs. Data: data/hub.json (teams, FPI,
   polls, conferences, every game, sportsbook lines), data/players.json (season stats, NFL Big Board matches) and
   data/extras.json (hub ratings, logged lines and record, the season simulation, Heisman ladder), refreshed by GitHub Actions. */
(function () {
"use strict";
const M = window.CFB, $ = s => document.querySelector(s), view = $("#view");
const esc = x => String(x == null ? "" : x).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safe = x => /^https?:\/\//.test(x || "") ? esc(x) : "#";
const fin = M.finite;
const f1 = (x, d = 1) => fin(x) ? Number(x).toFixed(d) : "—";
const sg = (x, d = 1) => fin(x) ? (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(Number(x)).toFixed(d) : "—";
const pct = x => fin(x) ? (x >= 0.995 && x < 1 ? ">99" : x <= 0.005 && x > 0 ? "<1" : Math.round(x * 100)) + "%" : "—";
const half = x => (Math.round(Math.abs(x) * 2) / 2).toFixed(1);
const int = x => fin(x) ? String(Math.round(x)) : "—";
const num0 = x => fin(x) ? Math.round(x).toLocaleString() : "—";
function read(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }

let D = null, X = null, P = null, C = null, byId = {}, byPlayer = {}, rosters = {}, liveStamp = null, heisRank = {};
let faves = new Set(window.Follow ? Follow.list("ncaaf") : read("ds-cfb:favorites", []));

/* ---------- small pieces ---------- */
function route() { const [p, q] = (location.hash.replace(/^#\/?/, "") || "week").split("?"); return { page: p || "week", q: new URLSearchParams(q || "") }; }
function go(page, params) { const q = new URLSearchParams(); for (const [k, v] of Object.entries(params || {})) if (v !== null && v !== undefined && v !== "" && v !== false) q.set(k, v); location.hash = "#/" + page + (q.size ? "?" + q : ""); }
function setParams(values) { const r = route(); for (const [k, v] of Object.entries(values)) { if (v === null || v === "" || v === false || v === undefined) r.q.delete(k); else r.q.set(k, String(v)); } history.replaceState(null, "", "#/" + r.page + (r.q.size ? "?" + r.q : "")); render(); }
function dayNY(d = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d); }
function dLabel(x, opt) { if (!x) return ""; const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(x) ? x + "T12:00:00Z" : x); return Number.isFinite(+d) ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", ...(opt || {}) }).format(d) : esc(x); }
function kick(g) { return g.at ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(g.at)) + " ET" : dLabel(g.day, { weekday: "short" }) + " · TBA"; }
// FBS teams are in byId; FCS opponents come from the snapshot's "other" list.
function team(id) { if (byId[id]) return byId[id]; const o = D.other && D.other[id]; return { id, short: o ? o.name : "FCS", abbr: o ? o.abbr : "", logo: o && o.logo, fcs: true }; }
const logo = (t, cls = "logo") => t && t.logo ? '<img class="' + cls + '" src="' + safe(t.logo) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' : '<span class="' + cls + ' lm">' + esc((t && t.abbr || "?").slice(0, 4)) + "</span>";
const R = id => X && X.ratings ? X.ratings[id] : null;
const poll = t => t && t.polls ? (t.polls.cfp || t.polls.ap || null) : null;
const pollRank = t => { const p = poll(t); return p ? p.rank : null; };
const rk = t => pollRank(t) ? '<span class="rk">' + pollRank(t) + "</span>" : '<span class="rk"></span>';
const teamLink = (t, opts = {}) => !t ? "—" : t.fcs ? '<span class="tl">' + (opts.logo === false ? "" : logo(t)) + '<span class="nm nd1">' + esc(t.short) + "</span></span>" : '<a class="tl" href="#/team?id=' + esc(t.id) + '">' + (opts.logo === false ? "" : logo(t)) + (opts.rank ? rk(t) : "") + '<span class="nm">' + esc(t.short) + "</span></a>";
const rec = t => t && t.record ? t.record.w + "-" + t.record.l : "—";
const crec = t => t && t.record ? t.record.cw + "-" + t.record.cl : "—";
const face = (p, s) => p && p.head ? '<img class="hs" style="--s:' + (s || 28) + 'px" src="' + safe(p.head) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' : '<span class="hs" style="--s:' + (s || 28) + 'px"></span>';
const st = (p, k) => p && p.s ? M.num(p.s[k]) : null;
function tier(p) { return p === null || p === undefined ? "" : p >= 90 ? "T-Elite" : p >= 70 ? "T-Strong" : p >= 35 ? "T-Average" : p >= 15 ? "T-Weak" : "T-Fringe"; }
const pctRank = (r, n) => fin(r) ? Math.round(100 * (1 - (r - 1) / Math.max(1, n - 1))) : null;
function badges(p) { let b = ""; if (heisRank[p.id] && heisRank[p.id] <= 15) b += ' <span class="pill hz" title="Hub Heisman ladder">H#' + heisRank[p.id] + "</span>"; if (p.nfl) b += ' <span class="pill nfl" title="NFL Big Board">NFL #' + p.nfl.rank + "</span>"; return b; }
const playerLink = p => p ? '<span class="pl" data-player="' + esc(p.id) + '" role="button" tabindex="0">' + face(p) + '<span class="nm">' + esc(p.name) + "</span></span>" : "—";
function seg(param, options, value) { return '<div class="seg" role="group">' + options.map(([v, l]) => '<button type="button" data-seg="' + esc(param) + '" data-v="' + esc(v) + '" aria-pressed="' + (String(value) === String(v)) + '">' + esc(l) + "</button>").join("") + "</div>"; }
function confSelect(value, label = "Conference") { return '<label>' + label + '<select data-param="conf"><option value="">All</option>' + D.conferences.map(c => '<option value="' + esc(c.short) + '"' + (c.short === value ? " selected" : "") + ">" + esc(c.short) + "</option>").join("") + "</select></label>"; }
function teamSelect(param, value, label) { return '<label>' + label + '<select data-param="' + param + '"><option value="">Choose a team</option>' + D.teams.slice().sort((a, b) => a.short.localeCompare(b.short)).map(t => '<option value="' + esc(t.id) + '"' + (t.id === value ? " selected" : "") + ">" + esc(t.short) + "</option>").join("") + "</select></label>"; }
function sortTh(key, label, cur, title) { return '<th class="sort' + (cur === key ? " on" : "") + '" data-sort="' + key + '"' + (title ? ' title="' + esc(title) + '"' : "") + ">" + label + (cur === key ? " ▾" : "") + "</th>"; }
function star(t) { const on = faves.has(t.id); return '<button class="star" type="button" data-follow="ncaaf:' + esc(t.id) + '" data-name="' + esc(t.short) + '" aria-pressed="' + on + '" title="' + (on ? "Following" : "Follow") + '">' + (on ? "★" : "☆") + "</button>"; }
function tiles(items) { return '<div class="stats">' + items.map(([v, l]) => '<div class="stat"><b>' + v + "</b><span>" + l + "</span></div>").join("") + "</div>"; }
function mv(x) { return fin(x) && x ? '<span class="mv ' + (x > 0 ? "up" : "dn") + '">' + (x > 0 ? "▲" : "▼") + Math.abs(x) + "</span>" : '<span class="mv">–</span>'; }

/* ---------- CollegeFootballData (optional): EPA, SP+, opening and closing lines ---------- */
const ADV = id => C && C.advanced ? C.advanced[id] : null;
const SPR = id => C && C.sp ? C.sp[id] : null;
const PEPA = id => C && C.playerEpa ? C.playerEpa[id] : null;
const BOOK = id => C && C.lines ? C.lines[id] : null;
const hasAdv = () => !!(C && C.advanced && Object.keys(C.advanced).length);
const hasSP = () => !!(C && C.sp && Object.keys(C.sp).length);
const e3 = x => fin(x) ? (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(2) : "—";
const p1 = x => fin(x) ? (x * 100).toFixed(1) + "%" : "—";
const ownLine = x => fin(x) ? (x > 50 ? 100 - x : x) : null; // snapshots before the fix stored yards to goal
let advRank = {};
function rankAdv() {
  advRank = {}; if (!hasAdv()) return;
  const ids = D.teams.map(t => t.id).filter(id => ADV(id));
  const by = (k, f, asc) => ids.filter(id => fin(f(ADV(id)))).sort((a, b) => asc ? f(ADV(a)) - f(ADV(b)) : f(ADV(b)) - f(ADV(a))).forEach((id, i) => ((advRank[id] = advRank[id] || {})[k] = i + 1));
  by("oEpa", a => a.off.epa); by("dEpa", a => a.def.epa, true); by("net", a => a.off.epa - a.def.epa); by("oSr", a => a.off.sr); by("dSr", a => a.def.sr, true);
  by("oXpl", a => a.off.xpl); by("dHav", a => a.def.havoc); by("oPass", a => a.off.passEpa); by("oRush", a => a.off.rushEpa); by("dPass", a => a.def.passEpa, true); by("dRush", a => a.def.rushEpa, true);
}

/* ---------- simulation ---------- */
const SIM = () => X && X.season_sim && X.season_sim.teams ? X.season_sim : null;
const odds = id => { const S_ = SIM(); return S_ ? S_.teams[id] : null; };
const ctx = { get byId() { return byId; }, get X() { return X; }, odds };
function titleStrip(n) {
  const S_ = SIM(); if (!S_) return "";
  const top = Object.entries(S_.teams).sort((a, b) => b[1].r[3] - a[1].r[3]).slice(0, n || 8);
  return '<div class="cupstrip">' + top.map(([id, o]) => { const t = byId[id]; return '<a href="#/team?id=' + esc(id) + '">' + logo(t) + "<div><b>" + pct(o.r[3]) + "</b><span>" + esc(t.short) + "</span></div></a>"; }).join("") + "</div>";
}

/* ---------- lines ---------- */
function lineFor(g) { return M.line(g.home, g.away, !!g.neutral, X); }
const logged = g => X && X.lines && X.lines.games ? X.lines.games[g.id] : null;
function favText(spread, home, away) { if (!fin(spread)) return "—"; if (Math.abs(spread) < 0.5) return "Pick'em"; const f = spread > 0 ? home : away; return esc(f.abbr || f.short) + " −" + half(spread); }
function shownLine(g) { return g.state === "pre" ? lineFor(g) : (logged(g) || lineFor(g)); }
// A ranked favorite the hub gives real but not even odds of losing (28-42%); closer than that is a toss-up.
function upset(l, g) { if (!l || g.state !== "pre") return false; const dog = Math.min(l.prob, 1 - l.prob), fav = byId[l.spread > 0 ? g.home : g.away]; return dog >= 0.28 && dog < 0.42 && !!(fav && pollRank(fav)); }
const tossup = (l, g) => l && g.state === "pre" && Math.abs(l.prob - 0.5) < 0.08;

/* ---------- public betting (data/betting.json, from tools/betting_pull.py) ---------- */
// Action Network's share of bets (tickets) and bet count, and Kalshi's price on each team's "wins" market.
// Money percentages are an Action Network PRO feature and never reach this file.
let BET = null;
fetch("data/betting.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((b) => { BET = b; if (D && ["week", "team", "matchup"].includes(route().page)) render(); }).catch(() => {});
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
  const ok = betOk;
  if (x && x.sp && fin(x.sp[0]) && ok(x.sp[1])) { const hs = x.sp[1] >= 50, t = hs ? h : a; bits.push("<b>" + Math.round(hs ? x.sp[1] : 100 - x.sp[1]) + "%</b> " + esc(t.abbr || t.short) + " " + lineTxt(hs ? x.sp[0] : -x.sp[0])); }
  else if (x && x.ml && ok(x.ml[2])) { const hs = x.ml[2] >= 50, t = hs ? h : a; bits.push("<b>" + Math.round(hs ? x.ml[2] : 100 - x.ml[2]) + "%</b> " + esc(t.abbr || t.short) + " to win"); }
  if (x && x.tot && fin(x.tot[0]) && ok(x.tot[1])) bits.push("<b>" + Math.round(Math.max(x.tot[1], 100 - x.tot[1])) + "%</b> " + (x.tot[1] >= 50 ? "over" : "under") + " " + x.tot[0]);
  const bets = bits.length ? '<span title="Share of bets (tickets) across the books Action Network tracks' + (x.n ? ", " + x.n.toLocaleString() + " bets" : "") + '">Bets ' + bits.join(" · ") + (x.n ? ' <small>' + kfmt(x.n) + " bets</small>" : "") + "</span>" : "";
  let mk = "";
  if (k && fin(k.h) && fin(k.a) && (k.v || 0) >= 500) { const hf = k.h >= k.a, t = hf ? h : a; mk = '<span title="Kalshi price on each team\'s wins market (cents on the dollar), ' + Math.round(k.v).toLocaleString() + ' contracts traded">Kalshi <b>' + esc(t.abbr || t.short) + " " + Math.round(100 * (hf ? k.h : k.a)) + "¢</b> <small>" + kfmt(k.v) + " traded</small></span>"; }
  return bets || mk ? '<div class="bets">' + bets + mk + "</div>" : "";
}

// Value watch: where the hub's own line and the market disagree, especially with the public on the other side.
// Same definitions as tools/value_grade.py, which grades each signal against the closing line all season.
let VAL = null;
const SHOW_T1 = false; // CFB totals were recalibrated Nov. 23 (they had run far from the market); the tag returns once the new totals have a record
fetch("data/value.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((v) => { VAL = v; if (D && ["week"].includes(route().page)) render(); }).catch(() => {});
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
  else if (s.s1 && false) out += '<span class="pill" title="Hub has ' + esc(t.short) + " at " + hubLine + " against the book's " + line + ". Hub disagreements of this size against the closing line this season: " + recTxt("s1") + '.">Hub vs book</span>';
  if (s.t1 && SHOW_T1) out += '<span class="pill" title="Hub total ' + half(l.total) + " against the book's " + s.bt + ". Totals disagreements of this size this season: " + recTxt("t1") + '.">Hub ' + (s.tot > 0 ? "over" : "under") + " " + s.bt + "</span>";
  return out;
}
function valueBoard() {
  if (!VAL || !VAL.records) return "";
  const rows = [["s1", "Hub disagrees with the book by " + VAL.rules.hubEdge + "+ points"], ["s2", "...and under " + VAL.rules.publicMax + "% of bets are on the hub's side"], ["s3", "...and the line has moved toward the hub"], ["t1", "Hub total off the book's by " + VAL.rules.totalEdge + "+ points" + (VAL.t1Since ? " (new totals, since " + dLabel(VAL.t1Since) + ")" : "")], ["pub", "The heavy public side (70%+ of bets)"]];
  const cell = (k) => { const r = VAL.records[k], n = r[0] + r[1], p = n ? (100 * r[0]) / n : null; return '<td class="num">' + r[0] + "-" + r[1] + (r[2] ? "-" + r[2] : "") + '</td><td class="num"><b class="' + (p === null ? "" : p >= 52.4 ? "pos" : "neg") + '">' + (p === null ? "—" : p.toFixed(1) + "%") + "</b></td>"; };
  return '<div class="panel"><h3>Value watch scorecard <small>against the closing line since ' + esc(dLabel(VAL.since)) + '</small></h3><div class="scroll"><table class="t"><thead><tr><th class="l">Signal</th><th>Record</th><th>Win %</th></tr></thead><tbody>' +
    rows.map(([k, lab]) => '<tr><td class="l">' + lab + "</td>" + cell(k) + "</tr>").join("") + '</tbody></table></div><p class="note" style="padding:0 14px 12px">Break-even at standard −110 juice is 52.4%. Green beats it, red doesn\'t. "Value" tags on game cards mark the second signal and "Value+" the third, so read them with these records in mind: a tag is a disagreement worth a look, not a proven edge. The closing line is the market\'s sharpest number, so these records are a tough test.</p></div>';
}

function gameCard(g) {
  const h = team(g.home), a = team(g.away), l = shownLine(g), lg = logged(g), w = M.watch(g, l, ctx);
  const live = g.state === "in", done = g.state === "post", mk = g.market || (lg && lg.market);
  const side = (t, isHome, score) => {
    const p = l ? (isHome ? l.prob : 1 - l.prob) : null, fav = l && (isHome ? l.spread > 0 : l.spread < 0);
    const won = done && fin(g.hs) && (isHome ? g.hs > g.as : g.as > g.hs);
    return '<div class="gt' + (won ? " won" : "") + '">' + logo(t) + rk(t) + (t.fcs ? '<span class="nm nd1">' + esc(t.short) + "</span>" : '<a class="nm" href="#/team?id=' + esc(t.id) + '">' + esc(t.short) + "</a>") + (faves.has(t.id) ? '<span class="fv" title="Following">★</span>' : "") +
      "<small>" + (t.fcs ? "FCS" : rec(t)) + "</small>" + (fin(score) ? '<b class="sc">' + int(score) + "</b>" : '<span class="pr' + (fav ? " fav" : "") + '">' + (p === null ? "" : pct(p)) + "</span>") + "</div>";
  };
  const status = live ? '<span class="live">● ' + esc(g.detail || "Live") + "</span>" : done ? "<b>" + esc(g.detail || "Final") + "</b>" : g.state === "off" ? esc(g.detail || "Postponed") : kick(g);
  let tag = "";
  const e = g.state === "pre" ? M.edge(l, g) : lg && lg.edge;
  if (upset(l, g)) tag = '<span class="pill warn">Upset alert</span>';
  else if (tossup(l, g) && (pollRank(h) || pollRank(a))) tag = '<span class="pill new">Toss-up</span>';
  else if (g.state === "pre" && fin(e) && Math.abs(e) >= 4) tag = '<span class="pill fill">Hub vs book</span>';
  else if (w >= 72 && !done) tag = '<span class="pill new">Must watch</span>';
  if (done && lg && lg.final) tag = lg.ats === "win" ? '<span class="pill up">Hub ✓ ATS</span>' : lg.ats === "loss" ? '<span class="pill">Hub ✗ ATS</span>' : lg.correct ? '<span class="pill up">Hub ✓</span>' : lg.upset ? '<span class="pill fill">Upset</span>' : "";
  const foot = l ? "<span>Hub <b>" + favText(l.spread, h, a) + "</b></span><span>O/U <b>" + half(l.total) + "</b></span>" + (mk && fin(mk.spread) ? '<span class="mkt" title="' + esc(mk.book || "Sportsbook") + ' line shown by ESPN">Book ' + favText(mk.spread, h, a) + (BOOK(g.id) && fin(BOOK(g.id).open) && BOOK(g.id).open !== mk.spread ? " · opened " + favText(BOOK(g.id).open, h, a) : "") + "</span>" : "") : '<span class="note">No line: FCS opponent without a rating</span>';
  return '<article class="gm' + (live ? " is-live" : "") + '" data-watch="' + w + '"><header><span>' + status + (g.tv ? " · " + esc(g.tv) : "") + (g.neutral ? " · Neutral" : "") + "</span>" + tag + valuePills(g, l, h, a) + "</header>" +
    (g.note ? '<div class="note2">' + esc(g.note) + "</div>" : "") +
    side(a, false, g.as) + side(h, true, g.hs) +
    '<footer>' + foot + '<span class="wi" title="Watchability: team quality, how close the line is, playoff stakes and polls">' + w + "</span>" + (h.fcs || a.fcs ? "" : '<a href="#/matchup?a=' + esc(a.id) + "&b=" + esc(h.id) + "&site=" + (g.neutral ? "n" : "b") + '">Matchup →</a>') + "</footer>" + betRow(g, h, a) + "</article>";
}

/* ---------- weeks ---------- */
function weekOptions() {
  const reg = D.weeks.filter(w => w.type === 2).map(w => ["" + w.week, w.label + (w.detail ? " · " + w.detail : "")]);
  if (D.games.some(g => g.post)) reg.push(["post", "Bowls & playoff"]);
  return reg;
}
function gamesOf(wk) { return D.games.filter(g => wk === "post" ? g.post : !g.post && String(g.week) === String(wk)).filter(g => byId[g.home] || byId[g.away]); }
function currentWeek() { return D.current && D.current.type === 3 ? "post" : String((D.current && D.current.week) || 1); }

function week(q) {
  const wk = q.get("w") || currentWeek(), sort = q.get("sort") || "watch", show = q.get("show") || "all";
  let games = gamesOf(wk);
  if (show === "follow") games = games.filter(g => faves.has(g.home) || faves.has(g.away));
  if (show === "ranked") games = games.filter(g => pollRank(byId[g.home]) || pollRank(byId[g.away]));
  if (show === "conf") games = games.filter(g => g.conf);
  const L = new Map(games.map(g => [g.id, shownLine(g)])), W = new Map(games.map(g => [g.id, M.watch(g, L.get(g.id), ctx)]));
  const order = { in: 0, pre: 1, post: 2, off: 3 };
  games.sort(sort === "time" ? (x, y) => (x.at || x.day).localeCompare(y.at || y.day) : sort === "edge" ? (x, y) => Math.abs(M.edge(L.get(y.id), y) || 0) - Math.abs(M.edge(L.get(x.id), x) || 0) : sort === "close" ? (x, y) => Math.abs((L.get(x.id) || { spread: 99 }).spread) - Math.abs((L.get(y.id) || { spread: 99 }).spread) : (x, y) => order[x.state] - order[y.state] || W.get(y.id) - W.get(x.id));
  const all = gamesOf(wk), ranked = all.filter(g => pollRank(byId[g.home]) && pollRank(byId[g.away])).length, alerts = all.filter(g => upset(shownLine(g), g)).length;
  const edges = all.filter(g => g.state === "pre").map(g => ({ g, l: lineFor(g), e: M.edge(lineFor(g), g) })).filter(x => fin(x.e)).sort((a, b) => Math.abs(b.e) - Math.abs(a.e));
  const r = X && X.record;
  const playing = new Set(all.flatMap(g => [g.home, g.away]));
  const gameOf = tid => all.find(g => g.home === tid || g.away === tid);
  const vs = tid => { const g = gameOf(tid); if (!g) return ""; const o = team(g.home === tid ? g.away : g.home); return (g.home === tid ? "vs " : "at ") + esc(o.short); };
  const hz = (X ? X.heisman.ladder : []).filter(x => playing.has(x.teamId)).slice(0, 8);
  const pros = (P ? P.players : []).filter(p => p.nfl && playing.has(p.teamId)).sort((a, b) => a.nfl.rank - b.nfl.rank).slice(0, 10);
  const wl = weekOptions().find(o => o[0] === wk);
  return '<h2 class="sec">' + (wk === "post" ? "Bowls & playoff" : "Week " + esc(wk)) + (wl && wk !== "post" ? ' <small class="note">' + esc((wl[1].split(" · ")[1]) || "") + "</small>" : "") + "</h2>" +
    '<p class="lede">Every FBS game with the hub\'s spread, total and win probability, next to the sportsbook line ESPN shows. Games are sorted by watchability: both teams\' quality, how close the line is, what\'s at stake for the playoff, and the polls.</p>' +
    tiles([[all.length, "Games"], [ranked, "Ranked vs ranked"], [alerts, "Upset alerts"], [edges.filter(x => Math.abs(x.e) >= 3).length, "Hub 3+ pts off the book"], [r && r.games ? r.right + "-" + (r.games - r.right) : "New", "Hub record (SU)"], (r && r.atsClose && (r.atsClose[0] + r.atsClose[1]) ? [r.atsClose[0] + "-" + r.atsClose[1] + (r.atsClose[2] ? "-" + r.atsClose[2] : ""), "Hub ATS vs close"] : [r && (r.ats[0] + r.ats[1]) ? r.ats[0] + "-" + r.ats[1] + (r.ats[2] ? "-" + r.ats[2] : "") : "New", "Hub ATS"])]) +
    '<div class="controls"><label>Week<select data-param="w">' + weekOptions().map(([v, l]) => '<option value="' + v + '"' + (v === wk ? " selected" : "") + ">" + esc(l) + (v === currentWeek() ? " · now" : "") + "</option>").join("") + "</select></label>" +
    '<label>Sort<select data-param="sort">' + [["watch", "Watchability"], ["time", "Kickoff"], ["close", "Closest line"], ["edge", "Hub vs book"]].map(([v, l]) => '<option value="' + v + '"' + (sort === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select></label>" +
    seg("show", [["all", "All"], ["ranked", "Ranked"], ["conf", "Conference"], ["follow", "Following"]], show) +
    '<button class="btn" type="button" data-refresh>Refresh scores ↻</button><span class="note" id="stamp">' + (liveStamp ? "Scores checked " + dLabel(liveStamp, { hour: "numeric", minute: "2-digit" }) : "Snapshot " + dLabel(D.updated, { hour: "numeric", minute: "2-digit" })) + "</span></div>" +
    (games.length ? '<div class="games">' + games.map(gameCard).join("") + "</div>" : '<p class="callout">' + (show === "follow" ? 'None of the teams you follow play this week. Follow teams with ☆ on the <a href="#/teams">Teams</a> tab.' : "No games here yet.") + "</p>") +
    valueBoard() +
    (BET && BET.games ? '<p class="note">Bets: share of bets (tickets) across the books <a href="https://www.actionnetwork.com" target="_blank" rel="noopener">Action Network</a> tracks, with the bet count. Kalshi: the price on each team\'s wins market at <a href="https://kalshi.com" target="_blank" rel="noopener">Kalshi</a>, in cents on the dollar, shown once 500+ contracts have traded. Both freeze at kickoff.</p>' : "") +
    '<div class="two" style="margin-top:16px">' +
    '<div class="panel"><h3>Where the hub disagrees with the book <small>' + esc((edges[0] && edges[0].g.market && edges[0].g.market.book) || "Sportsbook") + " via ESPN</small></h3>" + (edges.length ? '<div class="scroll"><table class="t"><thead><tr><th class=l>Game</th>' + (C && C.lines ? "<th>Open</th>" : "") + '<th>Book</th><th>Hub</th><th>Edge</th></tr></thead><tbody>' + edges.slice(0, 8).map(({ g, l, e }) => { const h = team(g.home), a = team(g.away), side = e > 0 ? h : a; return '<tr><td class="tm">' + esc(a.short) + " at " + esc(h.short) + "</td>" + (C && C.lines ? "<td class=note>" + (BOOK(g.id) ? favText(BOOK(g.id).open, h, a) : "—") + "</td>" : "") + "<td>" + favText(g.market.spread, h, a) + "</td><td>" + favText(l.spread, h, a) + '</td><td class="edge' + (Math.abs(e) >= 4 ? " big" : "") + '">' + esc(side.abbr || side.short) + " " + half(e) + "</td></tr>"; }).join("") + "</tbody></table></div>" : '<p class="body note">No sportsbook lines posted for the games left this week.</p>') + "</div>" +
    '<div class="panel"><h3>Heisman contenders playing <small><a href="#/heisman">Full ladder →</a></small></h3>' + (hz.length ? '<ul class="rlist">' + hz.map(x => { const p = byPlayer[x.id]; return "<li>" + '<span class="pill hz">#' + x.rank + "</span>" + playerLink(p) + '<span class="grow sub">' + esc(p ? p.team : "") + " " + vs(x.teamId) + "</span></li>"; }).join("") + "</ul>" : '<p class="body note">No ladder players this week.</p>') + "</div>" +
    "</div>" +
    '<div class="two"><div class="panel"><h3>NFL prospects in action <small><a href="../draft/">NFL Big Board ↗</a></small></h3>' + (pros.length ? '<ul class="rlist">' + pros.map(p => "<li>" + '<span class="pill nfl">#' + p.nfl.rank + "</span>" + playerLink(p) + '<span class="grow sub">' + esc(p.pos) + " · " + esc(p.team) + " " + vs(p.teamId) + "</span></li>").join("") + "</ul>" : '<p class="body note">No Big Board prospects play this week.</p>') + "</div>" +
    (SIM() ? '<div class="panel"><h3>National title odds <small><a href="#/playoff">Playoff odds →</a></small></h3><div class="body">' + titleStrip(8) + "</div></div>" : "") + "</div>";
}

/* ---------- playoff ---------- */
function bracketSlot(id, seed, opts = {}) {
  if (!id) return '<div class="tmr tbd"><span class="sd">' + (seed || "") + "</span><span></span><span>" + esc(opts.label || "TBD") + "</span><small></small></div>";
  const t = byId[id], o = odds(id), aq = opts.auto && opts.auto.includes(id);
  return '<div class="tmr"><span class="sd">' + seed + "</span>" + logo(t) + '<a href="#/team?id=' + esc(id) + '">' + esc(t.short) + (aq ? ' <span class="pill aq" title="Automatic bid as a conference champion">AQ</span>' : "") + "</a><small>" + rec(t) + (o ? " · " + pct(o.cfp) : "") + "</small></div>";
}
function bracket() {
  const S_ = SIM(); if (!S_) return "";
  const pj = S_.projected, s = i => pj.seeds[i - 1], A = pj.auto || [];
  const mu = (rows, foot) => '<div class="mu">' + rows.join("") + (foot ? "<footer>" + foot + "</footer>" : "") + "</div>";
  const fr = (hi, lo) => mu([bracketSlot(s(hi), hi, { auto: A }), bracketSlot(s(lo), lo, { auto: A })], "First round · at " + esc(byId[s(hi)] ? byId[s(hi)].short : "the higher seed"));
  const qf = (top, a, b) => mu([bracketSlot(s(top), top, { auto: A }), bracketSlot(null, "", { label: "Winner " + a + "/" + b })], "Quarterfinal");
  const t0 = S_.titleGames && S_.titleGames[0];
  return '<div class="cfp"><div class="col"><h4>First round · Dec 18–19</h4>' + fr(8, 9) + fr(5, 12) + fr(7, 10) + fr(6, 11) + "</div>" +
    '<div class="col qf"><h4>Quarterfinals · byes</h4>' + qf(1, 8, 9) + qf(4, 5, 12) + qf(2, 7, 10) + qf(3, 6, 11) + "</div>" +
    '<div class="col sf"><h4>Semifinals</h4>' + mu([bracketSlot(null, "", { label: "1 / 8 / 9 / 4 / 5 / 12" })], "Semifinal") + mu([bracketSlot(null, "", { label: "2 / 7 / 10 / 3 / 6 / 11" })], "Semifinal") + "</div>" +
    '<div class="col fin"><h4>Championship · Jan 25</h4><div class="champ"><span>Most likely final</span>' + (t0 ? "<b>" + t0.teams.map(id => esc(byId[id].short)).join(" vs ") + "</b><span>" + pct(t0.p) + " of simulations · Las Vegas</span>" : "<b>TBD</b>") + "</div></div></div>";
}
function playoff(q) {
  const S_ = SIM(); if (!S_) return '<p class="callout">The season simulation has not run yet.</p>';
  const view_ = q.get("show") || "contenders", sort = q.get("sort") || "cfp";
  const cols = [["cfp", "Make", o => o.cfp], ["auto", "Auto bid", o => o.auto], ["bye", "Bye", o => o.bye], ["host", "Host R1", o => o.host], ["qf", "QF", o => o.r[0]], ["sf", "Semis", o => o.r[1]], ["fin", "Final", o => o.r[2]], ["title", "Champion", o => o.r[3]], ["champ", "Win conf", o => o.champ]];
  const col = cols.find(c => c[0] === sort) || cols[0];
  let ts = D.teams.filter(t => odds(t.id));
  if (view_ === "contenders") ts = ts.filter(t => odds(t.id).cfp >= 0.005 || pollRank(t));
  ts.sort((a, b) => col[2](odds(b.id)) - col[2](odds(a.id)) || (R(a.id).rank - R(b.id).rank));
  const bids = {}; for (const t of D.teams) { const o = odds(t.id); if (o) bids[t.conference] = (bids[t.conference] || 0) + o.cfp; }
  const pj = S_.projected;
  const bubble = (ids, title) => '<div class="panel"><h3>' + title + '</h3><ul class="rlist">' + ids.map(id => { const t = byId[id], o = odds(id); return "<li>" + logo(t) + rk(t) + '<a class="tl" href="#/team?id=' + esc(id) + '"><span class="nm">' + esc(t.short) + '</span></a><span class="grow sub">' + esc(t.conference) + " · " + rec(t) + '</span><span class="num">' + pct(o.cfp) + "</span></li>"; }).join("") + "</ul></div>";
  const cfpNow = D.teams.filter(t => t.polls && t.polls.cfp).sort((a, b) => a.polls.cfp.rank - b.polls.cfp.rank);
  const head = cfpNow[0] && cfpNow[0].polls.cfp.headline;
  return '<h2 class="sec">Playoff odds</h2><p class="lede">The rest of the season played out ' + S_.sims.toLocaleString() + ' times: every remaining game, the conference championship games, a committee ranking built from each team\'s résumé, its rating and where the committee has it now, then the 12-team field and bracket under this year\'s rules (four power-conference champions, the best Group of Six champion, Notre Dame if it\'s top 12, seven at-large teams, straight seeding with byes for the top four).</p>' +
    titleStrip(8) +
    '<h3 class="ch">Projected bracket</h3><p class="note">If the season finished the way the simulations most expect. Seeds come from the hub\'s projected final committee ranking; AQ marks the automatic bids. Selection day is Dec. 6.</p>' + bracket() +
    '<div class="bubble">' + bubble(pj.lastIn, "Last in") + bubble(pj.firstOut, "First out") + "</div>" +
    '<h3 class="ch">Every contender</h3>' +
    '<div class="controls">' + seg("show", [["contenders", "Contenders"], ["all", "All 138"]], view_) + '<span class="note">Click a column to sort. FPI is ESPN\'s own playoff chance, for comparison.</span></div>' +
    '<div class="panel"><div class="scroll"><table class="t odds"><thead><tr><th class=l>Team</th><th>CFP</th><th>Rec</th><th>Proj</th>' + cols.map(c => sortTh(c[0], c[1], sort)).join("") + "<th>Avg seed</th><th>FPI</th></tr></thead><tbody>" +
    ts.map(t => { const o = odds(t.id); return '<tr class="go" data-href="#/team?id=' + esc(t.id) + '"><td class="tm">' + logo(t) + '<span class="nm">' + esc(t.short) + '</span><small class="cf">' + esc(t.conference) + "</small></td><td>" + (t.polls.cfp ? t.polls.cfp.rank : "—") + "</td><td>" + rec(t) + "</td><td>" + Math.round(o.w) + "-" + Math.round(o.l) + "</td>" + cols.map(c => { const v = c[2](o); return '<td class="heat' + (v >= 0.5 ? " hot" : "") + '" style="--p:' + Math.min(1, v).toFixed(3) + '">' + (v ? pct(v) : "—") + "</td>"; }).join("") + "<td>" + (o.seed ? f1(o.seed) : "—") + '</td><td class="note">' + (fin(t.fpi.playoff) ? Math.round(t.fpi.playoff) + "%" : "—") + "</td></tr>"; }).join("") +
    "</tbody></table></div></div>" +
    '<div class="two"><div class="panel"><h3>Bids by conference <small>average across simulations</small></h3><ul class="rlist">' + Object.entries(bids).sort((a, b) => b[1] - a[1]).filter(x => x[1] >= 0.05).map(([c, b]) => '<li><b>' + esc(c) + '</b><span class="grow"></span><span class="num">' + f1(b) + "</span></li>").join("") + "</ul></div>" +
    '<div class="panel"><h3>Most likely title games</h3><ul class="rlist">' + (S_.titleGames || []).map(x => "<li>" + x.teams.map(id => logo(byId[id]) + " " + esc(byId[id].short)).join(" <span class=\"note\">vs</span> ") + '<span class="grow"></span><span class="num">' + pct(x.p) + "</span></li>").join("") + "</ul></div></div>" +
    (cfpNow.length ? '<div class="panel"><h3>The committee\'s current top 25 <small>' + esc(head || "") + '</small></h3><div class="scroll"><table class="t"><thead><tr><th>CFP</th><th class=l>Team</th><th>Rec</th><th>Prev</th><th>Hub power</th><th>Hub résumé</th><th>Make CFP</th></tr></thead><tbody>' +
      cfpNow.map(t => { const c = t.polls.cfp, r = R(t.id); return '<tr class="go" data-href="#/team?id=' + esc(t.id) + '"><td><b>' + c.rank + '</b></td><td class="tm">' + logo(t) + '<span class="nm">' + esc(t.short) + "</span></td><td>" + rec(t) + "</td><td>" + (c.prev || "—") + "</td><td>#" + r.rank + "</td><td>#" + r.resRank + "</td><td>" + pct(odds(t.id).cfp) + "</td></tr>"; }).join("") + "</tbody></table></div></div>" : "");
}

/* ---------- ratings ---------- */
const RCOLS = [
  ["rank", "Rk", t => R(t.id).rank, true], ["power", "Power", t => R(t.id).power], ["off", "Off", t => R(t.id).o], ["def", "Def", t => R(t.id).d, true],
  ["fpi", "FPI", t => t.fpi.fpi], ["sp", "SP+", t => SPR(t.id) ? SPR(t.id).rating : null], ["res", "Résumé", t => R(t.id).resRank, true], ["sor", "ESPN SOR", t => t.fpi.sorRank, true], ["sos", "SOS", t => R(t.id).sosRank, true],
  ["proj", "Proj", t => odds(t.id) ? odds(t.id).w : null], ["champ", "Win conf", t => odds(t.id) ? odds(t.id).champ : null], ["cfp", "Make CFP", t => odds(t.id) ? odds(t.id).cfp : null], ["move", "7-day", t => R(t.id).move]
];
function ratings(q) {
  const conf = q.get("conf") || "", s = (q.get("q") || "").toLowerCase(), sort = q.get("sort") || "rank", mode = q.get("view") || "table";
  let ts = D.teams.filter(t => R(t.id) && (!conf || t.conference === conf) && (!s || (t.name + " " + t.short + " " + t.abbr).toLowerCase().includes(s)));
  const col = RCOLS.find(c => c[0] === sort) || RCOLS[0];
  ts.sort((a, b) => { const x = col[2](a), y = col[2](b); return (x == null) - (y == null) || (x == null ? 0 : col[3] ? x - y : y - x) || R(a.id).rank - R(b.id).rank; });
  const n = D.teams.length, base = X.base;
  const head = '<h2 class="sec">Power ratings</h2><p class="lede">All ' + n + ' FBS teams. Power is points better than an average FBS team on a neutral field, blending ' + (X.spBlend ? "ESPN\'s FPI, SP+ and the hub\'s own points model (a third each)" : "ESPN\'s FPI and the hub\'s own points model (half each)") + ', fit to every score this season. Off and Def are adjusted points scored and allowed per game against an average opponent. Résumé ranks wins above what an average top-25 team would expect against the same schedule.</p>' +
    '<div class="controls">' + confSelect(conf) + '<label>Find a team<input type="search" data-param="q" value="' + esc(q.get("q") || "") + '" placeholder="Georgia, Boise…"></label>' + seg("view", [["table", "Table"]].concat(hasAdv() ? [["adv", "Efficiency"]] : []).concat([["chart", "Offense vs defense"]]), mode) + "</div>";
  if (mode === "chart") return head + scatter(ts, conf || s);
  if (mode === "adv" && hasAdv()) return head + advTable(ts, q.get("asort") || "net");
  const th = "<tr><th class=l>Team</th><th>Poll</th>" + RCOLS.map(c => sortTh(c[0], c[1], sort)).join("") + "</tr>";
  const body = ts.map(t => {
    const r = R(t.id), o = odds(t.id);
    return '<tr class="go" data-href="#/team?id=' + esc(t.id) + '"><td class="tm">' + logo(t) + '<span class="nm">' + esc(t.short) + '</span><small class="cf">' + esc(t.conference || "") + " · " + rec(t) + "</small></td>" +
      "<td>" + (pollRank(t) || "") + "</td><td><b>" + r.rank + '</b></td><td class="' + (r.power > 0 ? "pos" : "neg") + '"><b>' + sg(r.power) + "</b></td>" +
      '<td><span class="chip ' + tier(pctRank(r.oRank, n)) + '">' + f1(base + r.o) + '</span> <small class="rr">' + r.oRank + "</small></td>" +
      '<td><span class="chip ' + tier(pctRank(r.dRank, n)) + '">' + f1(base + r.d) + '</span> <small class="rr">' + r.dRank + "</small></td>" +
      "<td>" + f1(t.fpi.fpi) + ' <small class="rr">' + int(t.fpi.rank) + "</small></td><td>" + (SPR(t.id) ? f1(SPR(t.id).rating) + ' <small class="rr">' + int(SPR(t.id).rank) + "</small>" : "—") + "</td><td>" + r.resRank + "</td><td>" + int(t.fpi.sorRank) + "</td><td>" + r.sosRank + "</td>" +
      "<td>" + (o ? Math.round(o.w) + "-" + Math.round(o.l) : "—") + "</td><td>" + (o ? pct(o.champ) : "—") + "</td><td>" + (o ? pct(o.cfp) : "—") + "</td><td>" + mv(r.move) + "</td></tr>";
  }).join("");
  return head + '<div class="panel"><div class="scroll"><table class="t rt"><thead>' + th + "</thead><tbody>" + body + "</tbody></table></div></div>" +
    '<p class="note">Poll: CFP ranking (AP before the committee\'s first release). FPI: ESPN Football Power Index and its rank. SP+: Bill Connelly\'s SP+ via CollegeFootballData. ESPN SOR: ESPN Strength of Record rank. SOS: average power of opponents played. Proj: the hub\'s projected record including a conference title game. 7-day: change in the hub\'s rank over the last week.</p>';
}
const ACOLS = [
  ["net", "Net EPA", a => a.off.epa - a.def.epa, false, e3], ["oEpa", "Off EPA", a => a.off.epa, false, e3], ["dEpa", "Def EPA", a => a.def.epa, true, e3],
  ["oSr", "Off SR", a => a.off.sr, false, p1], ["dSr", "Def SR", a => a.def.sr, true, p1], ["oPass", "Pass EPA", a => a.off.passEpa, false, e3], ["oRush", "Rush EPA", a => a.off.rushEpa, false, e3],
  ["oXpl", "Explosive", a => a.off.xpl, false, x => f1(x, 2)], ["dHav", "Havoc", a => a.def.havoc, false, p1], ["start", "Field pos", a => ownLine(a.off.start), false, x => f1(x)], ["ppo", "Pts/trip", a => a.off.ppo, false, x => f1(x, 2)]
];
function advTable(ts, sort) {
  const col = ACOLS.find(c => c[0] === sort) || ACOLS[0], n = D.teams.length;
  ts = ts.filter(t => ADV(t.id)).sort((x, y) => { const a = col[2](ADV(x.id)), b = col[2](ADV(y.id)); return (a == null) - (b == null) || (col[3] ? a - b : b - a); });
  const chip = (id, k, v, f) => '<span class="chip ' + tier(pctRank(advRank[id] && advRank[id][k], n)) + '">' + f(v) + "</span>";
  return '<div class="panel"><div class="scroll"><table class="t rt"><thead><tr><th class=l>Team</th><th>Hub</th>' + ACOLS.map(c => '<th class="sort' + (c[0] === col[0] ? " on" : "") + '" data-asort="' + c[0] + '">' + c[1] + (c[0] === col[0] ? " ▾" : "") + "</th>").join("") + "</tr></thead><tbody>" +
    ts.map(t => { const a = ADV(t.id); return '<tr class="go" data-href="#/team?id=' + esc(t.id) + '"><td class="tm">' + logo(t) + '<span class="nm">' + esc(t.short) + '</span><small class="cf">' + esc(t.conference) + " · " + rec(t) + "</small></td><td>" + R(t.id).rank + "</td>" + ACOLS.map(c => "<td>" + (["net", "oEpa", "dEpa", "oSr", "dSr", "oPass", "oRush", "oXpl", "dHav"].includes(c[0]) ? chip(t.id, c[0], c[2](a), c[4]) : c[4](c[2](a))) + "</td>").join("") + "</tr>"; }).join("") +
    "</tbody></table></div></div>" + '<p class="note">From CollegeFootballData, garbage time excluded. EPA: expected points added per play (offense: higher is better; defense: lower is better). SR: success rate. Explosive: average EPA on successful plays. Havoc: share of defensive plays with a tackle for loss, forced fumble, interception or pass breakup. Field pos: average starting yard line on offense (own territory). Pts/trip: points per trip inside the 40.</p>';
}
function scatter(ts, focus) {
  const all = D.teams.filter(t => R(t.id)), base = X.base;
  const xs = all.map(t => base + R(t.id).o), ys = all.map(t => base + R(t.id).d);
  const x0 = Math.floor(Math.min(...xs) - 1), x1 = Math.ceil(Math.max(...xs) + 1), y0 = Math.floor(Math.min(...ys) - 1), y1 = Math.ceil(Math.max(...ys) + 1);
  const W = 900, Hh = 620, Pd = 46, sx = v => Pd + (v - x0) / (x1 - x0) * (W - 2 * Pd), sy = v => Pd + (v - y0) / (y1 - y0) * (Hh - 2 * Pd);
  const ids = new Set(ts.map(t => t.id)), labelled = focus ? ts.slice(0, 40) : all.slice().sort((a, b) => R(a.id).rank - R(b.id).rank).slice(0, 25);
  const lab = new Set(labelled.map(t => t.id)), mo = sx(base), md = sy(base);
  let svg = '<svg class="sc-chart" viewBox="0 0 ' + W + " " + Hh + '" role="img" aria-label="Adjusted offense against adjusted defense for every FBS team">' +
    '<line x1="' + mo + '" y1="' + Pd + '" x2="' + mo + '" y2="' + (Hh - Pd) + '" class="ax"/><line x1="' + Pd + '" y1="' + md + '" x2="' + (W - Pd) + '" y2="' + md + '" class="ax"/>' +
    '<text x="' + (W - Pd) + '" y="' + (Pd - 14) + '" class="q" text-anchor="end">Elite both ways</text><text x="' + Pd + '" y="' + (Pd - 14) + '" class="q">Defense first</text>' +
    '<text x="' + (W - Pd) + '" y="' + (Hh - 12) + '" class="q" text-anchor="end">Offense first</text><text x="' + Pd + '" y="' + (Hh - 12) + '" class="q">Rebuilding</text>' +
    '<text x="' + (W / 2) + '" y="' + (Hh - 12) + '" class="axl" text-anchor="middle">Adjusted points scored →</text><text x="14" y="' + (Hh / 2) + '" class="axl" text-anchor="middle" transform="rotate(-90 14 ' + (Hh / 2) + ')">← Adjusted points allowed (better at top)</text>';
  for (const t of all) { const r = R(t.id), on = focus ? ids.has(t.id) : lab.has(t.id); svg += '<a href="#/team?id=' + esc(t.id) + '"><circle class="dot' + (on ? " on" : focus ? " off" : "") + '" cx="' + sx(base + r.o).toFixed(1) + '" cy="' + sy(base + r.d).toFixed(1) + '" r="' + (on ? 6 : 4.5) + '"><title>' + esc(t.short + ": " + f1(base + r.o) + " scored, " + f1(base + r.d) + " allowed") + "</title></circle></a>"; }
  for (const t of labelled) { const r = R(t.id); svg += '<text class="tl2" x="' + (sx(base + r.o) + 8).toFixed(1) + '" y="' + (sy(base + r.d) + 4).toFixed(1) + '">' + esc(t.abbr || t.short) + "</text>"; }
  return '<div class="panel"><div class="body">' + svg + "</svg></div></div>";
}

/* ---------- matchup ---------- */
function matchup(q) {
  const a = byId[q.get("a")] || D.teams[1], b = byId[q.get("b")] || D.teams[0], site = q.get("site") || "b";
  const home = site === "a" ? a : b, away = site === "a" ? b : a, neutral = site === "n";
  const l = M.line(home.id, away.id, neutral, X);
  const ra = R(a.id), rb = R(b.id), pa = l ? (home === a ? l.prob : 1 - l.prob) : null;
  const real = D.games.filter(g => (g.home === a.id && g.away === b.id) || (g.home === b.id && g.away === a.id));
  const row = (lab, va, vb, better) => { const x = M.num(va), y = M.num(vb), ea = x !== null && y !== null && (better === "low" ? x < y : x > y), eb = x !== null && y !== null && (better === "low" ? y < x : y > x); return "<tr><td" + (ea ? ' class="edge"' : "") + ">" + (typeof va === "string" ? va : f1(va)) + '</td><td class="mid">' + lab + "</td><td" + (eb ? ' class="edge"' : "") + ">" + (typeof vb === "string" ? vb : f1(vb)) + "</td></tr>"; };
  const fav = l ? (l.spread > 0 ? home : away) : null;
  // the shared game page (assets/pcard.js): pickers on top, then the scoreboard header and the tabs every hub uses
  const g0 = real.filter(g => g.state !== "post").sort((x, y) => x.day.localeCompare(y.day))[0] || real.filter(g => g.state === "post").sort((x, y) => y.day.localeCompare(x.day))[0];
  const done = g0 && g0.state === "post", live = g0 && g0.state === "in";
  const left = neutral ? a : away, right = neutral ? b : home, lProb = pa == null ? null : left === a ? pa : 1 - pa;
  const scoreOf = (t) => !g0 || !(done || live) ? null : t.id === g0.home ? g0.hs : g0.as;
  const sideOf = (t) => { const sc = scoreOf(t), o = scoreOf(t === a ? b : a); return { logo: logo(t), name: t.short, rec: rec(t) + (pollRank(t) ? " · No. " + pollRank(t) : ""), href: "#/team?id=" + encodeURIComponent(t.id), color: t.color, score: sc, won: done && fin(sc) && fin(o) && sc > o }; };
  const book = g0 && g0.market && fin(g0.market.spread) ? favText(g0.market.spread, team(g0.home), team(g0.away)) : null;
  const bm = real.find((g) => BET && BET.games && BET.games[g.id]);
  return window.PCard.game({
    before: '<h2 class="sec">Spread machine</h2>' + '<div class="controls">' + teamSelect("a", a.id, "Team A") + teamSelect("b", b.id, "Team B") + seg("site", [["b", esc(b.short) + " home"], ["a", esc(a.short) + " home"], ["n", "Neutral"]], site) + '<button class="btn" type="button" data-swap>Swap ⇄</button></div>',
    away: sideOf(left), home: sideOf(right), at: neutral ? "vs" : "at",
    status: !g0 ? "Any two teams, any site" : done ? "<b>Final</b> · " + dLabel(g0.day, { weekday: "short" }) : live ? '<b class="live">● Live</b>' : dLabel(g0.at || g0.day, { weekday: "long" }) + (g0.at ? " · " + new Date(g0.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET" : ""),
    meta: [g0 && g0.post ? "Bowl" : g0 && g0.week ? "Week " + g0.week : "", g0 && g0.conf ? "Conference game" : "", neutral ? "Neutral site" : "", g0 && g0.note ? esc(g0.note) : ""],
    verdict: l ? "<b>" + esc(fav.short) + " by " + half(l.spread) + "</b>" + (neutral ? " at a neutral site" : " in " + esc(home.short) + "'s stadium") + "<br>Projected " + esc(away.short) + " " + int(l.ap) + ", " + esc(home.short) + " " + int(l.hp) : '<span class="note">No line for these teams.</span>',
    head: l ? [{ v: fav.short + " −" + half(l.spread), l: "Hub line" }, book ? { v: book, l: done ? "Closing line" : "Book line", html: true } : null, { v: half(l.total), l: "Hub total" }, { v: pct(Math.max(pa, 1 - pa)), l: fav.short + " win chance" }] : [],
    prob: lProb == null ? null : { away: lProb, src: "Hub model" },
    tabs: [
      { id: "matchup", label: "Matchup", html: ADV(a.id) && ADV(b.id) ? '<div class="two">' + muSide(a, b) + muSide(b, a) + '</div><p class="note">Percentiles against FBS teams from CollegeFootballData, each side\'s offense next to the other\'s defense. Red is good, blue is bad; the bigger number wins the row.</p>' : '<p class="note">Advanced stats aren\'t in for one of these teams yet.</p>' },
      { id: "betting", label: "Betting", html: bm ? betPanel(bm, team(bm.home), team(bm.away)) : '<p class="note">' + (g0 ? "No betting numbers for this game yet." : "These two aren\'t on the schedule, so there are no book lines or bets. The hub\'s line is up top.") + "</p>" },
      { id: "details", label: "Details", html: '<div class="panel"><table class="t tape"><thead><tr><th>' + logo(a) + " " + esc(a.short) + '</th><th class="mid">Tale of the tape</th><th>' + esc(b.short) + " " + logo(b) + "</th></tr></thead><tbody>" +
    row("Record", rec(a), rec(b)) + row("Poll", pollRank(a) ? "#" + pollRank(a) : "—", pollRank(b) ? "#" + pollRank(b) : "—") +
    row("Hub power", ra.power, rb.power) + row("Hub rank", ra.rank, rb.rank, "low") + row("Adj. points scored", X.base + ra.o, X.base + rb.o) + row("Adj. points allowed", X.base + ra.d, X.base + rb.d, "low") +
    row("ESPN FPI", a.fpi.fpi, b.fpi.fpi) + (SPR(a.id) && SPR(b.id) ? row("SP+", SPR(a.id).rating, SPR(b.id).rating) : "") +
    (ADV(a.id) && ADV(b.id) ? row("Off EPA/play", e3(ADV(a.id).off.epa), e3(ADV(b.id).off.epa)) + row("Def EPA/play", e3(ADV(a.id).def.epa), e3(ADV(b.id).def.epa)) + row("Off success rate", p1(ADV(a.id).off.sr), p1(ADV(b.id).off.sr)) + row("Havoc", p1(ADV(a.id).def.havoc), p1(ADV(b.id).def.havoc)) : "") + row("Résumé rank", ra.resRank, rb.resRank, "low") + row("Schedule rank", ra.sosRank, rb.sosRank, "low") +
    row("Make CFP", odds(a.id) ? pct(odds(a.id).cfp) : "—", odds(b.id) ? pct(odds(b.id).cfp) : "—") + "</tbody></table></div>" + '<p class="note">Any two FBS teams, any site: the hub\'s spread, total, projected score and win probability. <a href="#/method">How the hub works</a></p>' }
    ]
  });
}

/* ---------- conferences ---------- */
function conferences(q) {
  const cs = D.conferences.filter(c => !c.independent).map(c => {
    const ts = c.teams.map(id => byId[id]).filter(Boolean), pw = ts.map(t => R(t.id).power).sort((x, y) => y - x);
    return { c, ts, avg: pw.reduce((s, x) => s + x, 0) / pw.length, top3: pw.slice(0, 3).reduce((s, x) => s + x, 0) / Math.min(3, pw.length), bids: ts.reduce((s, t) => s + (odds(t.id) ? odds(t.id).cfp : 0), 0), fav: ts.slice().sort((x, y) => (odds(y.id) || {}).champ - (odds(x.id) || {}).champ)[0] };
  }).sort((x, y) => y.avg - x.avg);
  const pick = q.get("conf") || cs[0].c.short, cur = cs.find(x => x.c.short === pick) || cs[0], c = cur.c;
  const order = c.teams.map(id => byId[id]).filter(Boolean);
  const rows = (ts, div) => ts.map((t, i) => { const o = odds(t.id) || {}; return '<tr class="go" data-href="#/team?id=' + esc(t.id) + '"><td><span class="rk">' + (i + 1) + '</span></td><td class="tm">' + logo(t) + rk(t) + '<span class="nm">' + esc(t.short) + "</span></td>" + (div ? "<td class=l>" + esc((t.division || "").replace(/^.* - /, "")) + "</td>" : "") + "<td><b>" + crec(t) + "</b></td><td>" + rec(t) + "</td><td>" + (fin(o.cw) ? Math.round(o.cw) + "-" + Math.round(o.cl) : "—") + '</td><td><span class="bar">' + pct(o.ccg) + '<i><b style="width:' + ((o.ccg || 0) * 100) + '%"></b></i></span></td><td><b>' + pct(o.champ) + "</b></td><td>" + pct(o.cfp) + '</td><td class="note">' + (fin(t.fpi.conf) ? Math.round(t.fpi.conf) + "%" : "—") + "</td><td>" + sg(R(t.id).power) + "</td></tr>"; }).join("");
  const div = !!c.divisions;
  return '<h2 class="sec">Conference strength</h2><p class="lede">Average hub power of each league\'s teams, its top three, how many playoff bids it averages across the simulations, and its title favorite.</p>' +
    '<div class="panel"><div class="scroll"><table class="t"><thead><tr><th class=l>Conference</th><th>Avg power</th><th>Top-3</th><th>Favorite</th><th>Teams</th><th>Proj CFP bids</th></tr></thead><tbody>' +
    cs.map((x, i) => '<tr class="go' + (x.c.short === c.short ? " sel" : "") + '" data-href="#/conferences?conf=' + encodeURIComponent(x.c.short) + '"><td><span class="rk">' + (i + 1) + "</span> <b>" + esc(x.c.short) + "</b>" + (x.c.power ? ' <span class="pill cf2">Power 4</span>' : "") + '</td><td class="' + (x.avg > 0 ? "pos" : "neg") + '">' + sg(x.avg) + "</td><td>" + sg(x.top3) + '</td><td class="tm">' + (x.fav ? logo(x.fav) + '<span class="nm">' + esc(x.fav.short) + "</span> <small class=cf>" + pct((odds(x.fav.id) || {}).champ) + "</small>" : "—") + "</td><td>" + x.ts.length + "</td><td><b>" + f1(x.bids) + "</b></td></tr>").join("") +
    "</tbody></table></div></div>" +
    '<h2 class="sec" id="race">' + esc(c.short) + " race</h2><p class=\"lede\">In the current standings order (ESPN, with the league's tiebreakers). From the hub's simulation: projected conference record, the chance to reach the " + (div ? "championship game as a division winner" : "championship game as one of the top two") + ", to win the conference and to make the playoff. ESPN FPI's conference title odds are alongside.</p>" +
    '<div class="controls"><label>Conference<select data-param="conf">' + cs.map(x => '<option value="' + esc(x.c.short) + '"' + (x.c.short === c.short ? " selected" : "") + ">" + esc(x.c.short) + "</option>").join("") + "</select></label></div>" +
    '<div class="panel"><div class="scroll"><table class="t"><thead><tr><th></th><th class=l>Team</th>' + (div ? "<th class=l>Div</th>" : "") + "<th>Conf</th><th>Overall</th><th>Proj conf</th><th>Title game</th><th>Win conf</th><th>Make CFP</th><th>FPI conf</th><th>Power</th></tr></thead><tbody>" + rows(order, div) + "</tbody></table></div></div>";
}

/* ---------- teams ---------- */
// Standings: every conference's current table (ESPN's order, with each league's tiebreakers), the conferences of teams you follow on top
function teams(q) {
  const s = (q.get("q") || "").toLowerCase(), follow = q.get("follow") === "1", pick = q.get("conf") || "";
  const cs = D.conferences.map(c => ({ name: c.short, ind: c.independent, teams: c.teams.map(id => byId[id]).filter(Boolean) }));
  const mine = c => c.teams.some(t => faves.has(t.id));
  const order = cs.filter(mine).concat(cs.filter(c => !mine(c)));
  const shown = order.filter(c => !pick || c.name === pick).map(c => [c, c.teams.filter(t => (!s || (t.name + " " + t.short).toLowerCase().includes(s)) && (!follow || faves.has(t.id)))]).filter(x => x[1].length);
  const table = (c, ts) => '<div class="panel st-conf"><h3>' + esc(c.name) + (mine(c) ? ' <small>you follow a team here</small>' : "") + '</h3><div class="scroll"><table class="t st"><thead><tr><th class=l>Team</th>' + (c.ind ? "" : "<th>Conf</th>") + '<th>Overall</th><th class="hide-m">Proj</th><th title="Chance to make the College Football Playoff">CFP</th><th class="hide-m">Hub rank</th><th></th></tr></thead><tbody>' +
    ts.map(t => { const o = odds(t.id), r = R(t.id) || {}, n = c.teams.indexOf(t) + 1;
      return '<tr class="go' + (faves.has(t.id) ? " mine" : "") + '" data-href="#/team?id=' + esc(t.id) + '"><td class="tm"><span class="pos">' + n + "</span>" + logo(t) + (pollRank(t) ? '<span class="ap">' + pollRank(t) + "</span>" : "") + '<span class="nm">' + esc(t.short) + "</span></td>" + (c.ind ? "" : "<td><b>" + crec(t) + "</b></td>") + "<td>" + (c.ind ? "<b>" + rec(t) + "</b>" : rec(t)) + '</td><td class="hide-m">' + (o ? Math.round(o.w) + "-" + Math.round(o.l) : "—") + "</td><td>" + (o ? pct(o.cfp) : "—") + '</td><td class="hide-m">' + (r.rank || "—") + "</td><td>" + star(t) + "</td></tr>"; }).join("") + "</tbody></table></div></div>";
  return '<h2 class="sec">Standings</h2><p class="lede">Every FBS conference in ESPN\'s standings order, with each league\'s tiebreakers. Make CFP is from the hub\'s season simulation. Tap ☆ to follow a team: your teams show up first here and at the top of This week, on every device you sign in on.</p>' +
    '<div class="controls"><label>Find a team<input type="search" data-param="q" value="' + esc(q.get("q") || "") + '" placeholder="Search ' + D.teams.length + ' teams"></label><label>Conference<select data-param="conf"><option value="">All</option>' + order.map(c => '<option value="' + esc(c.name) + '"' + (c.name === pick ? " selected" : "") + ">" + esc(c.name) + "</option>").join("") + '</select></label><label class="switch"><input type="checkbox" data-param="follow" value="1"' + (follow ? " checked" : "") + "> <span>Only teams I follow (" + faves.size + ")</span></label></div>" +
    (shown.length ? shown.map(([c, ts]) => table(c, ts)).join("") : '<p class="callout">No teams match.</p>');
}
function story(t) {
  const r = R(t.id), n = D.teams.length, o = odds(t.id), parts = [];
  if (r.oRank <= 15 && r.dRank <= 15) parts.push("A top-15 unit on both sides of the ball.");
  else if (r.oRank + 30 < r.dRank) parts.push("The offense carries this team (No. " + r.oRank + " in adjusted scoring; the defense is No. " + r.dRank + ").");
  else if (r.dRank + 30 < r.oRank) parts.push("Defense first: No. " + r.dRank + " in adjusted points allowed, No. " + r.oRank + " on offense.");
  else parts.push("Balanced: No. " + r.oRank + " on offense and No. " + r.dRank + " on defense.");
  if (r.resRank + 15 < r.rank) parts.push("Its résumé (No. " + r.resRank + ") runs ahead of its power rating, so it has won games the numbers didn't expect.");
  else if (r.rank + 20 < r.resRank) parts.push("It rates better (No. " + r.rank + ") than its résumé (No. " + r.resRank + ") shows: close losses or a soft schedule.");
  if (o) { if (o.cfp >= 0.9) parts.push("The simulations have it in the playoff almost every time."); else if (o.cfp >= 0.25) parts.push("A real playoff contender: in the field in " + pct(o.cfp) + " of simulations."); else if (o.champ >= 0.2) parts.push("Its clearest path is the conference title (" + pct(o.champ) + ")."); else if (o.six < 0.5 && o.six > 0.02) parts.push("Bowl eligibility is in the balance: six wins in " + pct(o.six) + " of simulations."); }
  return parts.join(" ");
}
function leaders(tid) {
  const ps = (rosters[tid] || []);
  const best = (k, min) => ps.filter(p => (st(p, k) || 0) >= (min || 1)).sort((a, b) => st(b, k) - st(a, k));
  const rows = [["Passing", best("pyd", 100).slice(0, 1), p => num0(st(p, "pyd")) + " yds · " + int(st(p, "ptd")) + " TD · " + int(st(p, "int")) + " INT"],
    ["Rushing", best("ryd", 100).slice(0, 2), p => num0(st(p, "ryd")) + " yds · " + int(st(p, "rtd")) + " TD · " + f1(st(p, "ryd") / Math.max(1, st(p, "car"))) + " ypc"],
    ["Receiving", best("wyd", 100).slice(0, 3), p => int(st(p, "rec")) + " rec · " + num0(st(p, "wyd")) + " yds · " + int(st(p, "wtd")) + " TD"],
    ["Tackles", best("tkl", 10).slice(0, 2), p => int(st(p, "tkl")) + " tkl · " + f1(st(p, "tfl")) + " TFL"],
    ["Pass rush", best("dsk", 1).slice(0, 2), p => f1(st(p, "dsk")) + " sacks · " + f1(st(p, "tfl")) + " TFL"],
    ["Ball hawks", best("dint", 1).slice(0, 2), p => int(st(p, "dint")) + " INT · " + int(st(p, "pd")) + " PD"]];
  return '<div class="panel"><h3>Leaders</h3><ul class="rlist">' + rows.filter(r => r[1].length).map(([lab, ps2, f]) => ps2.map(p => '<li><span class="sub" style="min-width:76px">' + lab + "</span>" + playerLink(p) + badges(p) + '<span class="grow"></span><span class="num sub">' + f(p) + "</span></li>").join("")).join("") + "</ul></div>";
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

const e2 = (x) => (fin(x) ? (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(2) : "—"), n2 = (x) => (fin(x) ? x.toFixed(2) : "—"), yd = (x) => (fin(x) ? "own " + Math.round(x) : "—");
const A_GROUPS = [
  ["Offense", [["EPA per play", (a) => a.off.epa, 1, e2], ["Success rate", (a) => a.off.sr, 1, p1], ["Explosiveness", (a) => a.off.xpl, 1, n2], ["Points per trip", (a) => a.off.ppo, 1, n2],
    ["Pass EPA", (a) => a.off.passEpa, 1, e2], ["Rush EPA", (a) => a.off.rushEpa, 1, e2], ["Line yards", (a) => a.off.lineYds, 1, n2], ["Runs stuffed", (a) => a.off.stuff, -1, p1], ["Havoc allowed", (a) => a.off.havoc, -1, p1], ["Field position", (a) => ownLine(a.off.start), 1, yd]]],
  ["Defense", [["EPA per play", (a) => a.def.epa, -1, e2], ["Success rate", (a) => a.def.sr, -1, p1], ["Explosiveness", (a) => a.def.xpl, -1, n2], ["Points per trip", (a) => a.def.ppo, -1, n2],
    ["Pass EPA", (a) => a.def.passEpa, -1, e2], ["Rush EPA", (a) => a.def.rushEpa, -1, e2], ["Line yards", (a) => a.def.lineYds, -1, n2], ["Stuff rate", (a) => a.def.stuff, 1, p1], ["Havoc", (a) => a.def.havoc, 1, p1], ["Opp. field position", (a) => ownLine(a.def.start), -1, yd]]],
];
let A_SORTED = null;
function advBars(t) {
  const a = ADV(t.id); if (!a || !a.off || !a.def) return "";
  ensureA();
  const groups = A_GROUPS.map(([title, rows]) => [title, rows.map(([l, fn, d, f]) => [l, () => fn(a), d, f])]);
  return tbarsHtml(groups, (g, r) => A_SORTED[g][r], cfbColor, cfbPct) + '<p class="note">Percentile among ' + A_SORTED.n + ' FBS teams: red is good, blue is bad. Points per trip counts drives that reach the opponent\'s 40. Havoc is tackles for loss, sacks, interceptions, breakups and forced fumbles per play.</p>';
}

function muPanel(off, def, rows, color, logoFn) {
  const ok = rows.filter((r) => r[1] && r[2]); if (!ok.length) return "";
  const bar = (pc, side) => { const c = color(pc), w = Math.max(4, pc); return '<i class="' + side + '"><em style="width:' + w + "%;background:" + c + '"></em><b style="' + (side === "l" ? "right" : "left") + ":calc(" + w + "% - 13px);background:" + c + ";color:" + (pc >= 80 || pc <= 20 ? "#fff" : "var(--ink)") + '">' + pc + "</b></i>"; };
  const wins = ok.filter((r) => r[1].pc > r[2].pc).length, loses = ok.filter((r) => r[1].pc < r[2].pc).length;
  const verdict = wins > loses ? esc(off.short) + " offense has the edge in " + wins + " of " + ok.length : loses > wins ? esc(def.short) + " defense has the edge in " + loses + " of " + ok.length : "Even" + (wins ? ", " + wins + (wins === 1 ? " edge" : " edges") + " each way" : "");
  return '<div class="panel"><h3>When ' + esc(off.short) + ' has the ball <small>' + verdict + '</small></h3><div class="body"><div class="mups"><div class="mu-r mu-h"><span>' + logoFn(off) + esc(off.short) + ' offense</span><span></span><span>' + esc(def.short) + " defense " + logoFn(def) + "</span></div>" +
    ok.map(([lab, o, d]) => '<div class="mu-r">' + bar(o.pc, "l") + '<span class="mid">' + lab + "<small>" + o.v + " · " + d.v + "</small></span>" + bar(d.pc, "r") + "</div>").join("") + "</div></div></div>";
}

function ensureA() { if (!A_SORTED) { const pool = D.teams.filter((x) => !x.fcs).map((x) => ADV(x.id)).filter((x) => x && x.off && x.def); A_SORTED = A_GROUPS.map(([, rows]) => rows.map(([, fn]) => pool.map(fn).filter(fin).sort((p, q) => p - q))); A_SORTED.n = pool.length; } }
function aPct(t, gi, ri) { const a = ADV(t.id); if (!a || !a.off || !a.def) return null; ensureA(); const [, fn, d, f] = A_GROUPS[gi][1][ri], v = fn(a), p = cfbPct(A_SORTED[gi][ri], v); return p == null ? null : { pc: d < 0 ? 100 - p : p, v: f(v) }; }
const MU_LABELS = ["EPA per play", "Success rate", "Explosiveness", "Points per trip", "Passing", "Running", "Line yards", "Stuffs", "Havoc", "Field position"];
const muSide = (o, d) => muPanel(o, d, MU_LABELS.map((lab, i) => [lab, aPct(o, 0, i), aPct(d, 1, i)]), cfbColor, logo);

function efficiency(t) {
  const a = ADV(t.id), sp = SPR(t.id), rr = advRank[t.id] || {}, n = D.teams.length, rc = C && C.recruiting && C.recruiting.teams && C.recruiting.teams[t.id], rp = C && C.returning && C.returning.teams && C.returning.teams[t.id];
  if (!a && !sp) return "";
  const cell = (v, lab, k) => "<div><b>" + v + (k && rr[k] ? ' <small>#' + rr[k] + "</small>" : "") + "</b><span>" + lab + "</span></div>";
  return '<div class="panel"><h3>Efficiency against FBS <small>CollegeFootballData · garbage time excluded</small></h3><div class="body">' + advBars(t) + '<div class="kv">' +
    (sp ? cell(f1(sp.rating), "SP+" + (fin(sp.rank) ? " #" + sp.rank : "")) + cell(f1(sp.off), "SP+ off" + (fin(sp.offRank) ? " #" + sp.offRank : "")) + cell(f1(sp.def), "SP+ def" + (fin(sp.defRank) ? " #" + sp.defRank : "")) + (fin(sp.sow) ? cell(f1(sp.sow), "2nd-order wins") : "") : "") +
    (rc ? cell("#" + rc.rank, (C.recruiting.year) + " recruiting") : "") + (rp && fin(rp.pct) ? cell(p1(rp.pct), "Returning production") : "") +
    "</div></div></div>";
}
function teamPage(q) {
  const t = byId[q.get("id")]; if (!t) return '<p class="callout">Team not found. <a href="#/teams">All teams</a></p>';
  const r = R(t.id), o = odds(t.id), n = D.teams.length;
  const sched = D.games.filter(g => g.home === t.id || g.away === t.id).sort((a, b) => (a.at || a.day).localeCompare(b.at || b.day));
  const schedRows = sched.map(g => {
    const home = g.home === t.id, op = team(home ? g.away : g.home), l = shownLine(g), lg = logged(g);
    const p = l ? (home ? l.prob : 1 - l.prob) : null, mine = l ? (home ? l.spread : -l.spread) : null, mk = g.market || (lg && lg.market), mm = mk && fin(mk.spread) ? (home ? mk.spread : -mk.spread) : null;
    let res = "";
    if (g.state === "post" && fin(g.hs)) { const us = home ? g.hs : g.as, them = home ? g.as : g.hs, rv = M.resumeValue(op.id, g.neutral ? 0 : home ? 1 : -1, us > them, X); res = '<b class="' + (us > them ? "pos" : "neg") + '">' + (us > them ? "W " : "L ") + int(us) + "-" + int(them) + '</b> <small class="note" title="Résumé value: wins above an average top-25 team">' + sg(rv, 2) + "</small>"; }
    else if (g.state === "in") res = '<span class="live">● ' + int(home ? g.hs : g.as) + "-" + int(home ? g.as : g.hs) + "</span>";
    const sp = x => x === null ? "—" : Math.abs(x) < 0.5 ? "PK" : (x > 0 ? "−" : "+") + half(x);
    return "<tr><td>" + (g.post ? "Bowl" : "Wk " + (g.week || "")) + ' <small class="note">' + dLabel(g.day) + '</small></td><td class="tm"><span class="at">' + (g.neutral ? "vs" : home ? "" : "@") + "</span>" + teamLink(op, { rank: true }) + (g.conf ? ' <span class="pill cf2">Conf</span>' : "") + (g.note ? ' <small class="cf">' + esc(g.note) + "</small>" : "") + "</td><td>" + sp(mine) + '</td><td class="note">' + sp(mm) + "</td><td>" + pct(p) + '</td><td class="bt">' + betBrief(g.id, home ? t : op, home ? op : t) + "</td><td>" + (res || (g.state === "pre" ? kick(g) : g.state === "off" ? "Canceled" : "")) + "</td></tr>";
  }).join("");
  const pros = (rosters[t.id] || []).filter(p => p.nfl).sort((a, b) => a.nfl.rank - b.nfl.rank);
  const vsOpts = D.teams.filter(x => x.id !== t.id).sort((a, b) => a.short.localeCompare(b.short));
  const steps = o ? [["Title game", o.ccg], ["Win conference", o.champ], ["Make playoff", o.cfp], ["First-round bye", o.bye], ["Quarterfinal", o.r[0]], ["Semifinal", o.r[1]], ["Title game (CFP)", o.r[2]], ["National title", o.r[3]]] : [];
  // the shared team header (assets/pcard.js); Overview, Schedule and Outlook as tabs (?v=)
  const v = ["schedule", "outlook"].includes(q.get("v")) ? q.get("v") : "overview", tab = (k) => "#/team?id=" + encodeURIComponent(t.id) + (k === "overview" ? "" : "&v=" + k);
  const head = window.PCard.teamHead({ logo: logo(t), name: t.name, color: t.color || "var(--ink)", follow: { sport: "ncaaf", id: t.id, name: t.short },
    meta: [esc(t.conferenceName || t.conference || ""), rec(t) + " (" + crec(t) + " conf)", t.coach ? "Coach " + esc(t.coach) : ""],
    chips: [t.polls.cfp ? ["CFP No. " + t.polls.cfp.rank, "tag"] : null, t.polls.ap ? ["AP No. " + t.polls.ap.rank, "tag"] : null, ["ESPN FPI #" + int(t.fpi.rank) + ", hub résumé #" + r.resRank + ", schedule #" + r.sosRank, ""]],
    head: [{ v: "#" + r.rank, l: "Hub power " + sg(r.power) }, { v: f1(X.base + r.o), l: "Points scored, #" + r.oRank }, { v: f1(X.base + r.d), l: "Points allowed, #" + r.dRank }, { v: o ? pct(o.cfp) : "—", l: "Make the playoff" }],
    tabs: [["overview", "Overview"], ["schedule", "Schedule"], ["outlook", "Outlook and leaders"]].map(([k, l]) => ({ label: l, href: tab(k), on: v === k })),
    after: '<p class="pt-ext"><a href="' + safe(t.links && t.links.clubhouse) + '" target="_blank" rel="noopener">ESPN team page ↗</a></p>' });
  if (v === "schedule") return head +
    '<div class="panel"><h3>Schedule <small>hub line, book line and win % · result and its résumé value</small></h3><div class="scroll"><table class="t"><thead><tr><th>Week</th><th class=l>Opponent</th><th>Hub</th><th>Book</th><th>Win</th><th>Bets</th><th>Result</th></tr></thead><tbody>' + schedRows + "</tbody></table></div></div>";
  if (v === "outlook") return head +
    '<div class="two"><div>' + (o ? '<div class="panel"><h3>Season outlook <small><a href="#/playoff">All playoff odds →</a></small></h3><div class="body"><div class="kv"><div><b>' + Math.round(o.cw) + "-" + Math.round(o.cl) + "</b><span>Proj conf</span></div><div><b>" + pct(o.six) + "</b><span>Bowl eligible</span></div><div><b>" + (o.seed ? f1(o.seed) : "—") + "</b><span>Avg CFP seed</span></div><div><b>" + (fin(t.fpi.playoff) ? Math.round(t.fpi.playoff) + "%" : "—") + "</b><span>FPI playoff</span></div></div>" +
      '<div class="ladder">' + steps.map(([lab, x]) => '<div class="lr"><span>' + lab + '</span><i><b style="width:' + (x * 100).toFixed(1) + '%"></b></i><em>' + pct(x) + "</em></div>").join("") + "</div></div></div>" : "") +
    "</div><div>" + leaders(t.id) +
    (pros.length ? '<div class="panel"><h3>NFL prospects <small><a href="../draft/">Big Board ↗</a></small></h3><ul class="rlist">' + pros.map(p => '<li><span class="pill nfl">#' + p.nfl.rank + "</span>" + playerLink(p) + '<span class="grow sub">' + esc(p.pos) + (p.year ? " · " + esc(p.year) : "") + "</span></li>").join("") + "</ul></div>" : "") +
    "</div></div>";
  return head + window.PCard.facts([[o ? Math.round(o.w) + "-" + Math.round(o.l) : "—", "Projected record"]]) +
    '<p class="callout">' + esc(story(t)) + "</p>" + efficiency(t) +
    '<div class="controls"><label>Spread machine: ' + esc(t.short) + ' vs<select data-vs="' + esc(t.id) + '"><option value="">Pick an opponent</option>' + vsOpts.map(x => '<option value="' + esc(x.id) + '">' + esc(x.short) + "</option>").join("") + "</select></label></div>";
}

/* ---------- players ---------- */
const CATS = {
  pass: { label: "Passing", min: p => (st(p, "att") || 0) >= 60, def: "pyd", cols: [["gp", "GP", 0], ["cmp", "CMP", 0], ["att", "ATT", 0], ["cpct", "CMP%", 1], ["pyd", "YDS", 0], ["ypa", "Y/A", 1], ["ptd", "TD", 0], ["int", "INT", 0], ["rate", "Rating", 1], ["aqbr", "QBR", 1], ["ryd", "Rush", 0], ["rtd", "R-TD", 0]] },
  rush: { label: "Rushing", min: p => (st(p, "car") || 0) >= 30, def: "ryd", cols: [["gp", "GP", 0], ["car", "CAR", 0], ["ryd", "YDS", 0], ["ypc", "YPC", 1], ["rtd", "TD", 0], ["rpg", "Y/G", 1], ["rlong", "LONG", 0], ["rbig", "Big", 0], ["fuml", "FUM", 0]] },
  rec: { label: "Receiving", min: p => (st(p, "rec") || 0) >= 10, def: "wyd", cols: [["gp", "GP", 0], ["rec", "REC", 0], ["tgt", "TGT", 0], ["wyd", "YDS", 0], ["ypr", "Y/R", 1], ["wtd", "TD", 0], ["wpg", "Y/G", 1], ["wlong", "LONG", 0], ["yac", "YAC", 0]] },
  def: { label: "Defense", min: p => (st(p, "tkl") || 0) >= 10 || (st(p, "dsk") || 0) >= 1 || (st(p, "dint") || 0) >= 1, def: "tkl", cols: [["gp", "GP", 0], ["tkl", "TKL", 0], ["solo", "SOLO", 0], ["tfl", "TFL", 1], ["dsk", "SACK", 1], ["dint", "INT", 0], ["pd", "PD", 0], ["ff", "FF", 0], ["fr", "FR", 0]] }
};
function pv(p, k) {
  const g = x => st(p, x);
  if (k === "epa") return PEPA(p.id) ? PEPA(p.id).epa : null;
  if (k === "epaPlay") return PEPA(p.id) ? PEPA(p.id).perPlay : null;
  if (k === "cpct") return g("att") ? 100 * g("cmp") / g("att") : null;
  if (k === "ypc") return g("car") ? g("ryd") / g("car") : null;
  if (k === "ypr") return g("rec") ? g("wyd") / g("rec") : null;
  if (k === "rpg") return g("gp") ? (g("ryd") || 0) / g("gp") : null;
  if (k === "wpg") return g("gp") ? (g("wyd") || 0) / g("gp") : null;
  return g(k);
}
function players(q) {
  if (!P) return '<p class="loading">Loading players…</p>';
  const cat = CATS[q.get("cat")] ? q.get("cat") : "pass", CT = CATS[cat], conf = q.get("conf") || "", s = M.key(q.get("q") || ""), sort = q.get("sort") || CT.def, more = +(q.get("n") || 100);
  const pos = q.get("pos") || "";
  const cols = C && C.playerEpa && cat !== "def" ? CT.cols.concat([["epa", "EPA", 1], ["epaPlay", "EPA/play", 2]]) : CT.cols;
  let ps = P.players.filter(p => CT.min(p) && (!conf || (byId[p.teamId] && byId[p.teamId].conference === conf)) && (!pos || p.pos === pos) && (!s || M.key(p.name + " " + p.team).includes(s)));
  const asc = sort === "int" || sort === "fuml";
  ps.sort((a, b) => { const x = pv(a, sort), y = pv(b, sort); return (x == null) - (y == null) || (asc ? x - y : y - x); });
  const poss = [...new Set(P.players.filter(CT.min).map(p => p.pos).filter(Boolean))].sort();
  return '<h2 class="sec">Players</h2><p class="lede">Season stats for every FBS player with a real workload, from ESPN. Heisman ladder and NFL Big Board players are tagged; open any player for his card.</p>' +
    '<div class="controls">' + seg("cat", Object.entries(CATS).map(([k, v]) => [k, v.label]), cat) + confSelect(conf) + '<label>Position<select data-param="pos"><option value="">All</option>' + poss.map(x => "<option" + (x === pos ? " selected" : "") + ">" + esc(x) + "</option>").join("") + '</select></label><label>Find a player<input type="search" data-param="q" value="' + esc(q.get("q") || "") + '" placeholder="Name or school"></label></div>' +
    '<div class="panel"><div class="scroll"><table class="t pt"><thead><tr><th>#</th><th class=l>Player</th><th class=l>Team</th><th>Pos</th><th>Yr</th>' + cols.map(([k, l]) => sortTh(k, l, sort)).join("") + "</tr></thead><tbody>" +
    ps.slice(0, more).map((p, i) => { const t = byId[p.teamId]; return "<tr><td>" + (i + 1) + '</td><td class="l">' + playerLink(p) + badges(p) + '</td><td class="tm">' + logo(t) + '<span class="nm">' + esc(t.short) + "</span></td><td>" + esc(p.pos) + "</td><td>" + esc((p.year || "").slice(0, 2)) + "</td>" + cols.map(([k, , d]) => "<td" + (k === sort ? ' class="on"' : "") + ">" + (d ? f1(pv(p, k), d) : num0(pv(p, k))) + "</td>").join("") + "</tr>"; }).join("") +
    "</tbody></table></div></div>" + (ps.length > more ? '<p><button class="btn" data-more="n" data-n="' + (more + 150) + '">Show more (' + (ps.length - more) + " left)</button></p>" : "");
}

/* ---------- Heisman ---------- */
function nextGame(tid) { return D.games.filter(g => (g.home === tid || g.away === tid) && g.state !== "post" && g.state !== "off").sort((a, b) => (a.at || a.day).localeCompare(b.at || b.day))[0]; }
function nextText(tid) {
  const g = nextGame(tid); if (!g) return "Season complete";
  const home = g.home === tid, o = team(home ? g.away : g.home), l = lineFor(g);
  return dLabel(g.day, { weekday: "short" }) + " " + (home ? "vs " : "at ") + esc(o.short) + (l ? " · " + pct(home ? l.prob : 1 - l.prob) : "");
}
function heisman() {
  if (!X || !P) return '<p class="loading">Loading…</p>';
  const lad = X.heisman.ladder;
  return '<h2 class="sec">Heisman ladder</h2><p class="lede">The hub\'s ranking of the Heisman race: production per game (yards, touchdowns and turnovers for quarterbacks, yards and scores for runners and receivers, sacks, tackles for loss and takeaways for defenders) weighted by how good the team is and how it\'s winning, because voters reward stars on contenders. The leader is set to 100. It\'s a model of the race, not betting odds.</p>' +
    '<div class="panel"><div class="scroll"><table class="t"><thead><tr><th>#</th><th>7-day</th><th class=l>Player</th><th class=l>Team</th><th>Pos</th><th class=l>Season</th>' + (C && C.playerEpa ? "<th>EPA</th>" : "") + '<th>Per game</th><th>Ladder</th><th class=l>Next</th></tr></thead><tbody>' +
    lad.slice(0, 30).map(x => { const p = byPlayer[x.id], t = byId[x.teamId]; if (!p) return ""; const d = fin(x.prev) ? x.prev - x.rank : null; return "<tr><td><b>" + x.rank + "</b></td><td>" + (x.prev ? mv(d) : X.heisman.since ? '<span class="pill new">New</span>' : '<span class="mv">–</span>') + '</td><td class="l">' + playerLink(p) + (p.nfl ? ' <span class="pill nfl">NFL #' + p.nfl.rank + "</span>" : "") + '</td><td class="tm">' + logo(t) + rk(t) + '<span class="nm">' + esc(t.short) + '</span> <small class="cf">' + rec(t) + "</small></td><td>" + esc(p.pos) + '</td><td class="ln">' + esc(M.statLine(p)) + "</td>" + (C && C.playerEpa ? "<td>" + (PEPA(p.id) ? f1(PEPA(p.id).epa) : "—") + "</td>" : "") + "<td>" + f1(x.prod) + "</td><td><b>" + f1(x.score) + '</b><span class="hzbar"><b style="width:' + x.score + '%"></b></span></td><td class="ln">' + nextText(x.teamId) + "</td></tr>"; }).join("") +
    "</tbody></table></div></div>" + '<p class="note">7-day: places gained or lost since ' + (X.heisman.since ? dLabel(X.heisman.since) : "the first snapshot") + ". The ladder refreshes with each stat update.</p>";
}

/* ---------- prospects ---------- */
function spark(hist) {
  const h = (hist || []).filter(fin); if (h.length < 2) return "";
  const lo = Math.min(...h), hi = Math.max(...h), W = 70, H = 18, x = i => i / (h.length - 1) * W, y = v => hi === lo ? H / 2 : (v - lo) / (hi - lo) * H;
  const d = h.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" "), dir = h[h.length - 1] < h[0] ? "up" : h[h.length - 1] > h[0] ? "dn" : "";
  return '<svg class="spark ' + dir + '" width="' + W + '" height="' + H + '" viewBox="0 -2 ' + W + " " + (H + 4) + '" aria-hidden="true"><path d="' + d + '"/></svg>';
}
function prospects(q) {
  if (!P) return '<p class="loading">Loading prospects…</p>';
  const pos = q.get("pos") || "", conf = q.get("conf") || "";
  let ps = P.players.filter(p => p.nfl && (!pos || p.nfl.pos === pos) && (!conf || (byId[p.teamId] && byId[p.teamId].conference === conf))).sort((a, b) => a.nfl.rank - b.nfl.rank);
  const poss = [...new Set(P.players.filter(p => p.nfl).map(p => p.nfl.pos))].sort();
  return '<h2 class="sec">NFL prospects</h2><p class="lede">Players on the site\'s <a href="../draft/">NFL Big Board</a> (consensus of public boards, as of ' + dLabel(P.boardAsOf) + ') matched to their college season, with the trend of their rank and their next game.</p>' +
    '<div class="controls"><label>Position<select data-param="pos"><option value="">All</option>' + poss.map(x => "<option" + (x === pos ? " selected" : "") + ">" + esc(x) + "</option>").join("") + "</select></label>" + confSelect(conf) + '<span class="note">' + ps.length + " of " + P.boardMatched + " matched</span></div>" +
    '<div class="panel"><div class="scroll"><table class="t"><thead><tr><th>Board</th><th>Trend</th><th class=l>Player</th><th>Pos</th><th class=l>School</th><th>Yr</th><th class=l>Season</th><th class=l>Next</th></tr></thead><tbody>' +
    ps.map(p => { const t = byId[p.teamId]; return '<tr><td><b>#' + p.nfl.rank + "</b> <small class=note>" + (p.nfl.hi !== p.nfl.lo ? p.nfl.hi + "–" + p.nfl.lo : "") + "</small></td><td>" + spark(p.nfl.hist) + '</td><td class="l">' + playerLink(p) + (heisRank[p.id] && heisRank[p.id] <= 15 ? ' <span class="pill hz">H#' + heisRank[p.id] + "</span>" : "") + "</td><td>" + esc(p.nfl.pos) + '</td><td class="tm">' + logo(t) + '<span class="nm">' + esc(t.short) + "</span></td><td>" + esc((p.year || "").slice(0, 2)) + '</td><td class="ln">' + esc(M.statLine(p)) + '</td><td class="ln">' + nextText(p.teamId) + "</td></tr>"; }).join("") +
    "</tbody></table></div></div>";
}

/* ---------- how it works ---------- */
function method() {
  const r = X && X.record, S_ = SIM();
  return '<div class="method"><h2 class="sec">How it works</h2>' +
    "<h3>Power ratings</h3><p>Each team's power is points better than an average FBS team on a neutral field. Half of it is ESPN's Football Power Index. The other half is the hub's own points model, fit to every score of the season: each team gets an offense and a defense number (adjusted points scored and allowed against an average opponent), with margins past " + 24 + " points counted at 40% so blowouts don't run the table, and every team pulled a little toward average until it has played enough games. FCS opponents start 22 points below an average FBS team. The model is stretched to FPI's spread before the two are blended.</p>" +
    (X && X.spBlend ? "<h3>SP+ in the blend</h3><p>With CollegeFootballData connected, power is a third each: ESPN FPI, Bill Connelly's SP+ and the hub's points model, then pulled 15% toward average.</p>" : "") +
    "<h3>Lines</h3><p>The spread is the difference in power plus " + (X ? X.hfa : 2.5) + " points for the home team (none at a neutral site). The total starts from the two offenses against the two defenses, then keeps " + (X && X.totK ? Math.round(X.totK * 100) : 45) + "% of that number\'s distance from this season\'s average FBS game total (" + (X && X.totAvg ? f1(X.totAvg) : "about 53") + " points): on its own the matchup math ran more than twice as wide as the market\'s totals. Win probability treats the final margin as normally distributed around the spread with a " + (X ? X.sd : 15) + "-point standard deviation: the hub\'s own typical miss over its last 400 graded games, but never below 15, about what the closing line misses by, since the hub is no sharper than the close. Every line is logged before kickoff and graded once the game is final: straight up, and against the sportsbook line ESPN shows (DraftKings), picking the side the hub likes better than the book." + (r && r.games ? " Record so far: " + r.right + "-" + (r.games - r.right) + " straight up, " + r.ats[0] + "-" + r.ats[1] + (r.ats[2] ? "-" + r.ats[2] : "") + " against the spread, average miss " + f1(r.mae) + " points" + (r.marketMae ? " (the book: " + f1(r.marketMae) + ")" : "") + "." : " The record starts with this week's games.") + "</p>" +
    "<h3>Résumé</h3><p>For every game played, the hub asks how often an average top-25 team (the 25th-best power rating) would win that same game at the same site, and credits the actual result minus that chance. A road win over a top-10 team is worth close to a full win; beating an FCS team is worth almost nothing; losing to one costs almost a full win. This is the hub's own Strength of Record, shown beside ESPN's.</p>" +
    "<h3>Playoff simulation</h3><p>" + (S_ ? S_.sims.toLocaleString() : "10,000") + " seasons, each with every team's true strength nudged by a random amount (" + (S_ ? S_.drift : 3.5) + " points) so good and bad seasons stay correlated. Every remaining game is played. Conference standings come from conference record, then head-to-head or record among tied teams, then a draw weighted toward the stronger team (a stand-in for each league's deeper tiebreakers). The top two meet in the championship game (Sun Belt: the two division winners), at a neutral site or the higher seed's stadium where the league hosts it.</p>" +
    "<p>The committee is modeled with a score that mixes the final résumé, the team's power rating and where the committee ranks it today (the committee's view is sticky), with a small bonus for conference champions. The field follows the 2026 rules: the SEC, Big Ten, Big 12 and ACC champions are in, plus the highest-ranked champion from the other six conferences; Notre Dame is in if it ranks in the top 12; seven at-large teams fill the rest. Teams are seeded straight by ranking. Seeds 1-4 get byes; 5-8 host first-round games. The quarterfinals, semifinals and title game are played at neutral sites. Next season the field grows to 24 teams and conference championship games go away; this hub models this season's 12.</p>" +
    "<h3>Heisman ladder</h3><p>Production per game: for passers, yards, touchdowns, interceptions and yards per attempt, plus rushing; for runners and receivers, yards and touchdowns; for defenders, sacks, tackles for loss, takeaways and passes defended; return touchdowns for anyone. That is multiplied by a team factor built from winning percentage, the team's power and whether it is in the CFP top 12, then scaled so the leader is 100.</p>" +
    "<h3>Closing-line grading</h3><p>Beating the closing line is the real test of a betting model: the close is the market's sharpest number. With CollegeFootballData's opening and closing lines, every game is also graded against the close, and the hub tracks closing-line value: when the hub disagreed with the opening line, did the market move toward the hub's number?" + (r && r.clv && r.clv[2] ? " So far the market moved the hub's way in " + r.clv[0] + " of " + r.clv[2] + " games (average " + sg(r.clvAvg, 2) + " points)." : "") + "</p>" +
    "<h3>Sources</h3><ul><li>ESPN: FPI and Strength of Record, the AP, Coaches and CFP rankings, standings, every team's schedule and scores, the sportsbook lines ESPN displays, rosters and season stats. Updated daily.</li><li><a href=\"https://collegefootballdata.com/\">CollegeFootballData.com</a>: EPA and success rates (garbage time excluded), SP+, player EPA, opening and closing lines, recruiting, returning production and the transfer portal. Pulled once a day on the free tier.</li><li>The site's own <a href=\"../draft/\">NFL Big Board</a> for prospect ranks.</li><li>For deeper team analytics, explore <a href=\"https://www.espn.com/college-football/fpi\">ESPN FPI</a>, <a href=\"https://collegefootballdata.com/\">CollegeFootballData</a> and <a href=\"https://www.sports-reference.com/cfb/\">Sports Reference</a>.</li></ul></div>";
}

/* ---------- player card ---------- */
// Percentiles against FBS players at his position with real volume (quarterbacks 80+ attempts, backs 40+ carries,
// receivers and tight ends 12+ catches, defenders 10+ tackles). Counting stats per game, since teams have played
// different numbers of games. Interception rate ranks lower-is-better.
const per = (p, k) => { const g = st(p, "gp"), v = st(p, k); return g > 0 && fin(v) ? v / g : null; };
const CFB_POOLS = {
  QB: { name: "quarterbacks", pos: ["QB"], ok: (p) => (st(p, "att") || 0) >= 80, stats: [
    ["Yards per attempt", (p) => pv(p, "ypa"), 1], ["Completion %", (p) => pv(p, "cpct"), 1], ["TD rate", (p) => (st(p, "att") ? 100 * (st(p, "ptd") || 0) / st(p, "att") : null), 1, "%"],
    ["INT rate", (p) => (st(p, "att") ? 100 * (st(p, "int") || 0) / st(p, "att") : null), -1, "%"], ["QBR", (p) => st(p, "aqbr"), 1], ["Pass yards a game", (p) => per(p, "pyd"), 1],
    ["Rush yards a game", (p) => per(p, "ryd"), 1], ["EPA per play", (p) => pv(p, "epaPlay"), 1]] },
  RB: { name: "running backs", pos: ["RB", "FB"], ok: (p) => (st(p, "car") || 0) >= 40, stats: [
    ["Yards per carry", (p) => pv(p, "ypc"), 1], ["Rush yards a game", (p) => per(p, "ryd"), 1], ["Rush TDs a game", (p) => per(p, "rtd"), 1],
    ["Receiving yards a game", (p) => per(p, "wyd"), 1], ["EPA per play", (p) => pv(p, "epaPlay"), 1]] },
  WR: { name: "wide receivers", pos: ["WR"], ok: (p) => (st(p, "rec") || 0) >= 12, stats: null },
  TE: { name: "tight ends", pos: ["TE"], ok: (p) => (st(p, "rec") || 0) >= 12, stats: null },
  DL: { name: "defensive linemen", pos: ["DL", "DE", "DT", "EDGE", "NT"], ok: (p) => (st(p, "tkl") || 0) >= 10, stats: [
    ["Tackles a game", (p) => per(p, "tkl"), 1], ["TFL a game", (p) => per(p, "tfl"), 1], ["Sacks a game", (p) => per(p, "dsk"), 1], ["Forced fumbles", (p) => st(p, "ff"), 1], ["Passes defended", (p) => st(p, "pd"), 1]] },
  LB: { name: "linebackers", pos: ["LB"], ok: (p) => (st(p, "tkl") || 0) >= 10, stats: [
    ["Tackles a game", (p) => per(p, "tkl"), 1], ["TFL a game", (p) => per(p, "tfl"), 1], ["Sacks a game", (p) => per(p, "dsk"), 1], ["Interceptions", (p) => st(p, "dint"), 1], ["Passes defended", (p) => st(p, "pd"), 1]] },
  DB: { name: "defensive backs", pos: ["DB", "S", "CB"], ok: (p) => (st(p, "tkl") || 0) >= 10, stats: [
    ["Tackles a game", (p) => per(p, "tkl"), 1], ["Interceptions", (p) => st(p, "dint"), 1], ["Passes defended", (p) => st(p, "pd"), 1], ["TFL a game", (p) => per(p, "tfl"), 1]] },
};
const REC_STATS = [["Receiving yards a game", (p) => per(p, "wyd"), 1], ["Yards per catch", (p) => pv(p, "ypr"), 1], ["Catches a game", (p) => per(p, "rec"), 1], ["Receiving TDs a game", (p) => per(p, "wtd"), 1],
  ["YAC per catch", (p) => ((st(p, "yac") || 0) > 0 && st(p, "rec") ? st(p, "yac") / st(p, "rec") : null), 1]];
CFB_POOLS.WR.stats = REC_STATS; CFB_POOLS.TE.stats = REC_STATS;
let CFB_SORTED = null;
function cfbPoolOf(p) { const pos = String(p.pos || "").toUpperCase(); return Object.keys(CFB_POOLS).find((k) => CFB_POOLS[k].pos.includes(pos)) || null; }
function cfbSorted() {
  if (CFB_SORTED) return CFB_SORTED;
  CFB_SORTED = {};
  const all = Object.values(byPlayer);
  for (const [k, P] of Object.entries(CFB_POOLS)) {
    const grp = all.filter((p) => P.pos.includes(String(p.pos || "").toUpperCase()) && P.ok(p));
    CFB_SORTED[k] = { n: grp.length, s: P.stats.map(([, fn]) => grp.map(fn).filter(fin).sort((a, b) => a - b)) };
  }
  return CFB_SORTED;
}
function cfbPct(sorted, v) { if (!sorted || sorted.length < 10 || !fin(v)) return null; let lo = 0, eq = 0; for (const w of sorted) { if (w < v) lo++; else if (w === v) eq++; } return Math.round(100 * (lo + Math.max(0, eq - 1) / 2) / (sorted.length - 1)); }
function cfbColor(v) { const t = Math.max(0, Math.min(100, v)) / 100, mx = (a, b, k) => Math.round(a + (b - a) * k); const c = t < 0.5 ? [mx(54, 222, t * 2), mx(97, 222, t * 2), mx(173, 222, t * 2)] : [mx(222, 210, (t - 0.5) * 2), mx(222, 45, (t - 0.5) * 2), mx(222, 73, (t - 0.5) * 2)]; return "rgb(" + c.join(",") + ")"; }
function cfbBars(p) {
  const k = cfbPoolOf(p); if (!k) return "";
  const P = CFB_POOLS[k], S = cfbSorted()[k];
  const rows = P.stats.map(([label, fn, dir, unit], i) => {
    const v = fn(p); let pc = cfbPct(S.s[i], v); if (pc == null) return null; if (dir < 0) pc = 100 - pc;
    return { label, sub: (Math.abs(v) < 1 && v !== 0 ? v.toFixed(2) : f1(v)) + (unit || ""), pct: pc };
  }).filter(Boolean);
  if (!rows.length) return "";
  return window.PCard.sec("Profile", "percentile vs FBS " + P.name) + window.PCard.bars(rows) + '<p class="note">Among ' + S.n + " FBS " + P.name + " with real playing time." + (P.ok(p) ? "" : " He's short of that volume, so read these as a small sample.") + "</p>";
}
function openPlayer(id) {
  const p = byPlayer[id]; if (!p) return;
  const t = byId[p.teamId], hz = X && X.heisman.ladder.find(x => x.id === id);
  const g = nextGame(p.teamId);
  let ng = ""; if (g) { const home = g.home === p.teamId, o = team(home ? g.away : g.home), l = g.state === "pre" ? lineFor(g) : null; ng = '<p class="tldr"><b>Next:</b> ' + dLabel(g.day, { weekday: "short" }) + " " + (home ? "vs " : "at ") + (o.fcs ? esc(o.short) : '<a href="#/matchup?a=' + esc(t.id) + "&b=" + esc(o.id) + "&site=" + (g.neutral ? "n" : home ? "a" : "b") + '">' + esc(o.short) + "</a>") + (l ? " · " + favText(l.spread, team(g.home), team(g.away)) + ", " + esc(t.short) + " " + pct(home ? l.prob : 1 - l.prob) : "") + "</p>"; }
  const groups = [["Passing", [["att", "ATT"], ["cpct", "CMP%"], ["pyd", "YDS"], ["ypa", "Y/A"], ["ptd", "TD"], ["int", "INT"], ["aqbr", "QBR"]], (st(p, "att") || 0) >= 10],
    ["Rushing", [["car", "CAR"], ["ryd", "YDS"], ["ypc", "YPC"], ["rtd", "TD"], ["rlong", "LONG"]], (st(p, "car") || 0) >= 5],
    ["Receiving", [["rec", "REC"], ["tgt", "TGT"], ["wyd", "YDS"], ["ypr", "Y/R"], ["wtd", "TD"]], (st(p, "rec") || 0) >= 3],
    ["Defense", [["tkl", "TKL"], ["tfl", "TFL"], ["dsk", "SACK"], ["dint", "INT"], ["pd", "PD"], ["ff", "FF"]], (st(p, "tkl") || 0) >= 3 || (st(p, "dint") || 0) > 0]];
  const dec = k => ["cpct", "ypa", "ypc", "ypr", "aqbr", "tfl", "dsk"].includes(k);
  const PC = window.PCard, live = groups.filter(x => x[2]);
  const HEAD = { Passing: [["pyd", "Pass yards"], ["ptd", "Pass TD"], ["ypa", "Yards / att"], ["int", "INT"]], Rushing: [["ryd", "Rush yards"], ["ypc", "Yards / carry"], ["rtd", "Rush TD"], ["car", "Carries"]],
    Receiving: [["wyd", "Rec yards"], ["rec", "Catches"], ["wtd", "Rec TD"], ["ypr", "Yards / catch"]], Defense: [["tkl", "Tackles"], ["tfl", "TFL"], ["dsk", "Sacks"], ["dint", "INT"]] };
  const head = live.length ? HEAD[live[0][0]].filter(([k2]) => pv(p, k2) !== null).map(([k2, l2]) => ({ v: dec(k2) ? f1(pv(p, k2)) : num0(pv(p, k2)), l: l2 })) : [];
  let ov = cfbBars(p);
  if (g) {
    const home = g.home === p.teamId, o = team(home ? g.away : g.home), l = g.state === "pre" ? lineFor(g) : null, dd = new Date(g.day + "T12:00:00");
    ov += PC.sec("Next game") + PC.line({ when: [dd.toLocaleDateString("en-US", { weekday: "short" }), dd.toLocaleDateString("en-US", { month: "short", day: "numeric" })],
      what: (home ? "vs " : "at ") + (o.fcs ? esc(o.short) : '<a href="#/matchup?a=' + esc(t.id) + "&b=" + esc(o.id) + "&site=" + (g.neutral ? "n" : home ? "a" : "b") + '">' + esc(o.short) + "</a>"),
      sub: l ? "Hub line: " + favText(l.spread, team(g.home), team(g.away)).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&") : "", right: l ? pct(home ? l.prob : 1 - l.prob) : "" });
  }
  if (hz) ov += '<p class="note">Heisman ladder No. ' + hz.rank + ", ladder score " + f1(hz.score) + ", " + f1(hz.prod) + ' production per game. <a href="#/heisman">Ladder</a></p>';
  if (!ov) ov = '<p class="note">' + int(st(p, "gp")) + " games, not enough volume for a profile yet.</p>";
  const pe = PEPA(p.id);
  const stp = '<p class="note" style="margin-top:2px">' + int(st(p, "gp")) + " games" + (p.home ? ". From " + esc(p.home) : "") + ".</p>" +
    live.map(([lab, ks]) => { const kk = ks.filter(([k2]) => pv(p, k2) !== null); return PC.sec(lab) + PC.table(kk.map(x => x[1]), [kk.map(([k2]) => dec(k2) ? f1(pv(p, k2)) : num0(pv(p, k2)))]); }).join("") +
    (pe ? PC.sec("Efficiency", "CollegeFootballData") + PC.facts([[f1(pe.epa), "EPA added"], [e3(pe.perPlay), "EPA per play"], fin(pe.pass) ? [f1(pe.pass), "Passing EPA"] : null, fin(pe.rush) ? [f1(pe.rush), "Rushing EPA"] : null]) : "") +
    '<p class="note">Season stats from ESPN.</p>';
  const dr = p.nfl ? PC.sec("NFL Big Board", "consensus of " + p.nfl.on + " boards") + PC.facts([["#" + p.nfl.rank, "Consensus rank"], [p.nfl.hi + "-" + p.nfl.lo, "Range"], [p.nfl.on, "Boards"], [p.nfl.pos, "Position"]]) +
    '<p class="note">' + spark(p.nfl.hist) + ' <a href="../draft/">See him on the Big Board</a></p>' : "";
  const chips = [hz ? ["Heisman ladder #" + hz.rank, "tag"] : null, p.nfl ? ["NFL Board #" + p.nfl.rank, "tag"] : null];
  $("#cardBody").innerHTML = PC.html({ face: face(p, 60), name: p.name, color: t.color || "var(--ink)", team: '<a href="#/team?id=' + esc(t.id) + '">' + logo(t) + " " + esc(t.short) + "</a>",
    meta: [p.pos, p.year, p.ht, p.wt, p.jersey ? "#" + p.jersey : ""], chips, head,
    tabs: [{ id: "ov", label: "Overview", html: ov }, { id: "st", label: "Stats", html: stp }, { id: "dr", label: "Draft", html: dr }],
    foot: '<div class="pc-acts"><a href="#/team?id=' + esc(t.id) + '">' + esc(t.short) + ' page</a><a class="pri" href="https://www.espn.com/college-football/player/_/id/' + encodeURIComponent(p.id) + '" target="_blank" rel="noopener">ESPN page</a></div>' });
  const dlg = $("#card"); if (!dlg.open) dlg.showModal();
}

/* ---------- render + data ---------- */
const PAGES = { week, playoff, ratings, matchup, conferences, teams, team: teamPage, players, heisman, prospects, method };
// Four sections, as in the NBA and CBB hubs; grouped pages get a sub-tab row, and a section tab returns to the page last
// used in it
const GROUP = { week: "week", playoff: "playoff", ratings: "teams", teams: "teams", team: "teams", conferences: "teams", matchup: "teams", players: "players", heisman: "players", prospects: "players" };
const SUBS = {
  teams: [["teams", "Standings"], ["ratings", "Ratings"], ["conferences", "Conferences"], ["matchup", "Matchup"]],
  players: [["players", "Players"], ["heisman", "Heisman"], ["prospects", "Prospects"]],
};
const lastSub = (g, v) => { try { if (v) localStorage.setItem("cfb.sub." + g, v); return localStorage.getItem("cfb.sub." + g); } catch (e) { return null; } };
function render() {
  if (!D) return;
  const r = route(), fn = PAGES[r.page] || week, page = PAGES[r.page] ? r.page : "week", group = GROUP[page] || "";
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
  view.innerHTML = (page === "week" || page === "teams" ? yours() : "") + fn(r.q);
  document.body.dataset.page = page;
}
// the teams you follow, with their record and next game, at the top of the main pages (assets/follow.js)
function yours() {
  if (!window.Follow) return "";
  return Follow.strip("ncaaf", [...faves].map(id => byId[id]).filter(Boolean).map(t => {
    const g = D.games.filter(x => (x.home === t.id || x.away === t.id) && x.state !== "post").sort((a, b) => (a.at || a.day).localeCompare(b.at || b.day))[0];
    const o = g && byId[g.home === t.id ? g.away : g.home];
    const nx = !g ? "" : g.state === "in" ? " · Live" : " · " + dLabel(g.day, { weekday: "short" }) + (g.neutral ? " vs " : g.home === t.id ? " vs " : " at ") + esc(o ? o.short : "TBD");
    return { id: t.id, href: "#/team?id=" + encodeURIComponent(t.id), logo: logo(t), name: t.short, sub: rec(t) + nx };
  }));
}
function index() {
  byId = Object.fromEntries(D.teams.map(t => [t.id, t]));
  byPlayer = {}; rosters = {};
  if (P) P.players.forEach(p => { byPlayer[p.id] = p; (rosters[p.teamId] = rosters[p.teamId] || []).push(p); });
  heisRank = {}; if (X && X.heisman) X.heisman.ladder.forEach(x => heisRank[x.id] = x.rank);
  rankAdv();
}
async function load() {
  try {
    const opt = { cache: "no-store" };
    const [h, x, p, c] = await Promise.all([fetch("data/hub.json", opt), fetch("data/extras.json", opt).catch(() => null), fetch("data/players.json", opt).catch(() => null), fetch("data/cfbd.json", opt).catch(() => null)]);
    if (!h.ok) throw Error("Data snapshot unavailable");
    D = await h.json(); X = x && x.ok ? await x.json() : null; P = p && p.ok ? await p.json() : null;
    try { C = c && c.ok ? await c.json() : null; if (C && C.season !== D.season) C = null; } catch (e) { C = null; }
    if (!X) throw Error("Ratings unavailable");
    index();
    $("#kicker").textContent = "College football · " + (D.seasonLabel || "") + (D.current && D.current.week ? " · Week " + D.current.week : "");
    $("#foot").innerHTML = "Ratings blend <a href=\"https://www.espn.com/college-football/fpi\">ESPN FPI</a> with the hub's own points model. Polls, schedules, scores, sportsbook lines (as shown by ESPN), rosters and stats from ESPN. " + (C ? "EPA, SP+ and opening lines from <a href=\"https://collegefootballdata.com/\">CollegeFootballData</a>. " : "") + "Prospects from the site's <a href=\"../draft/\">NFL Big Board</a>. Updated " + dLabel(D.updated, { hour: "numeric", minute: "2-digit" }) + ". <a href=\"#/method\">How it works</a>.";
    render();
    document.dispatchEvent(new CustomEvent("cfb:ready"));
    if (route().page === "week") refreshLive(false);
  } catch (e) { view.innerHTML = '<p class="callout">The college football snapshot did not load. Try again in a moment.</p>'; }
}
async function refreshLive(manual) {
  if (!D || document.hidden) return;
  const wk = route().q.get("w") || currentWeek(); if (wk !== currentWeek() || wk === "post") return;
  const today = dayNY(), soon = D.games.filter(g => String(g.week) === wk && !g.post && g.state !== "post" && g.day <= today);
  if (!manual && !soon.length) return;
  const confs = [...new Set(soon.flatMap(g => [g.home, g.away]).map(id => byId[id] && byId[id].conferenceId).filter(Boolean))];
  const btn = view.querySelector("[data-refresh]"); if (btn && manual) { btn.disabled = true; btn.textContent = "Checking…"; }
  try {
    const base = "https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?region=us&lang=en&contentorigin=espn&limit=100&seasontype=2&dates=" + D.season + "&week=" + wk + "&groups=";
    const bodies = await Promise.all((confs.length ? confs : D.conferences.map(c => c.id)).map(c => fetch(base + c, { cache: "no-store", signal: AbortSignal.timeout(12000) }).then(r => r.ok ? r.json() : null).catch(() => null)));
    const rows = bodies.filter(Boolean).flatMap(b => M.gamesFromESPN(b)); if (!rows.length) throw Error("feed");
    const map = new Map(D.games.map(g => [g.id, g]));
    rows.forEach(r => { const g = map.get(r.id); if (g) Object.assign(g, { state: r.state, detail: r.detail, hs: r.hs, as: r.as }); });
    liveStamp = new Date().toISOString();
    if (route().page === "week") render();
  } catch (e) { const s = $("#stamp"); if (s && manual) s.textContent = "Live scores unavailable, showing the snapshot"; }
  finally { const b = view.querySelector("[data-refresh]"); if (b) { b.disabled = false; b.textContent = "Refresh scores ↻"; } }
}

/* ---------- events ---------- */
let typing = null;
view.addEventListener("input", e => { const el = e.target; if (el.matches('input[type="search"][data-param]')) { clearTimeout(typing); typing = setTimeout(() => { setParams({ [el.dataset.param]: el.value.trim(), n: null }); const again = view.querySelector('input[data-param="' + el.dataset.param + '"]'); if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); } }, 220); } });
view.addEventListener("change", e => {
  const el = e.target;
  if (el.matches("select[data-param]")) setParams({ [el.dataset.param]: el.value, n: null });
  else if (el.matches('input[type="checkbox"][data-param]')) setParams({ [el.dataset.param]: el.checked ? "1" : null });
  else if (el.matches("select[data-vs]") && el.value) go("matchup", { a: el.dataset.vs, b: el.value, site: "a" });
});
document.addEventListener("click", e => {
  const el = e.target.closest("[data-player],[data-fav],[data-seg],[data-sort],[data-asort],[data-more],[data-refresh],[data-swap],[data-close],tr.go");
  if (!el) { if (e.target === $("#card")) $("#card").close(); return; }
  if (el.matches("a") || (e.target.closest("a") && !el.matches("[data-player]"))) return;
  if (el.hasAttribute("data-player")) { e.preventDefault(); openPlayer(el.dataset.player); return; }
  if (el.hasAttribute("data-close")) { $("#card").close(); return; }
  if (el.hasAttribute("data-seg")) { const extra = el.dataset.seg === "cat" ? { sort: null, pos: null } : {}; setParams({ [el.dataset.seg]: el.dataset.v, n: null, ...extra }); return; }
  if (el.hasAttribute("data-sort")) { setParams({ sort: el.dataset.sort }); return; }
  if (el.hasAttribute("data-asort")) { setParams({ asort: el.dataset.asort }); return; }
  if (el.hasAttribute("data-more")) { setParams({ n: el.dataset.n }); return; }
  if (el.hasAttribute("data-refresh")) { refreshLive(true); return; }
  if (el.hasAttribute("data-swap")) { const q = route().q, s = q.get("site"); setParams({ a: q.get("b") || view.querySelector('[data-param="b"]').value, b: q.get("a") || view.querySelector('[data-param="a"]').value, site: s === "a" ? "b" : s === "b" ? "a" : s }); return; }
  if (el.matches("tr.go")) location.hash = el.dataset.href;
});
document.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-player]")) { e.preventDefault(); openPlayer(e.target.dataset.player); } });
window.addEventListener("hashchange", () => { const d = $("#card"); if (d.open) d.close(); render(); window.scrollTo({ top: Math.min(window.scrollY, view.offsetTop - 70) }); if (route().page === "week") refreshLive(false); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && route().page === "week") refreshLive(false); });
setInterval(() => { if (!document.hidden && route().page === "week" && D && D.games.some(g => g.state === "in")) refreshLive(false); }, 90000);
// followed teams live in assets/follow.js (synced to your account); redraw when they change here or on another device
window.addEventListener("ds-follow", (e) => { if (e.detail && e.detail.sport === "ncaaf") { faves = new Set(Follow.list("ncaaf")); render(); } });
load();
})();
