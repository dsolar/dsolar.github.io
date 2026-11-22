/* Shared calculations for the College Football Hub. tools/cfb_extras.py computes the ratings and logs the same line. */
(function (root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(); else root.CFB = factory(); })(typeof globalThis !== "undefined" ? globalThis : this, function () {
"use strict";
const finite = x => x !== null && x !== undefined && x !== "" && Number.isFinite(Number(x));
const num = x => finite(x) ? Number(x) : null;
const round = (x, n = 1) => finite(x) ? Math.round(Number(x) * 10 ** n) / 10 ** n : null;
const key = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, "and").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/[^a-z0-9]/g, "");
const phi = z => { const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2); return 0.5 * (1 + (z < 0 ? -y : y)); };

// Projected score from the hub's power ratings (spread) and adjusted offense/defense (total). Mirrors line() in tools/cfb_extras.py.
function line(home, away, neutral, X) {
  if (!X || !X.ratings) return null;
  const rh = X.ratings[home], ra = X.ratings[away], H = num(X.hfa) ?? 2.5, SD = num(X.sd) ?? 14, base = num(X.base) ?? 27;
  if (!rh || !ra) return null;
  const spread = rh.power - ra.power + (neutral ? 0 : H), e = neutral ? 0 : H / 2;
  let hp = base + rh.o + ra.d + e, ap = base + ra.o + rh.d - e;
  // totals keep X.totK of the points model's distance from average scoring (calibrate_totals in tools/cfb_extras.py)
  const k = num(X.totK) ?? 1, total = k !== 1 ? num(X.totAvg) + k * (hp + ap - num(X.totRaw)) : hp + ap;
  hp = (total + spread) / 2; ap = (total - spread) / 2;
  hp = Math.max(hp, 3); ap = Math.max(ap, 3);
  return { spread: round(spread), total: round(hp + ap), hp: round(hp), ap: round(ap), prob: round(phi(spread / SD), 3) };
}
// Win probability for a given spread (points, positive = home favored).
const prob = (spread, X) => phi(spread / (num(X && X.sd) ?? 14));

// Hub pick against the sportsbook: positive edge = the hub likes the home team more than the market does.
function edge(l, g) {
  const m = g && g.market; if (!l || !m || !finite(m.spread)) return null;
  return round(l.spread - m.spread);
}

// Watchability, 0-100: both teams' quality, how close the line is, playoff stakes, a ranked team, a conference game.
function watch(g, l, ctx) {
  const a = ctx.byId[g.home], b = ctx.byId[g.away]; if (!a || !b || !l) return 0;
  const pr = t => { const r = ctx.X.ratings[t.id]; return r ? Math.max(0, 1 - (r.rank - 1) / 100) : 0; };
  const q = (pr(a) + pr(b)) / 2 * 100, close = 1 - Math.abs(l.prob - 0.5) * 2;
  const st = t => { const o = ctx.odds(t.id); return o ? Math.min(o.cfp, 1 - o.cfp) * 2 + o.ccg * 0.3 : 0; };
  const stakes = Math.min(1, st(a) + st(b));
  const ranked = [a, b].filter(t => t.polls && (t.polls.cfp || t.polls.ap)).length;
  let s = 0.45 * q + 28 * close + 18 * stakes + 4 * ranked + (g.conf ? 3 : 0) + (g.state === "in" ? 10 : 0) + (g.note && /rivalry|cup|trophy|bowl|championship|playoff/i.test(g.note) ? 6 : 0);
  return Math.max(0, Math.min(100, Math.round(s)));
}

// Résumé value of a win or loss: wins above an average top-25 team against that opponent at that site.
function resumeValue(opp, site, won, X) {
  const H = num(X.hfa) ?? 2.5, r = X.ratings[opp];
  const p = phi(((num(X.bar) ?? 15) - (r ? r.power : -25) + site * H) / (num(X.sd) ?? 14));
  return (won ? 1 : 0) - p;
}

// Live scoreboard rows from ESPN (browser refresh). Status and scores only; the snapshot keeps the rest.
function gamesFromESPN(body) {
  const out = [];
  for (const e of (body && body.events) || []) {
    const c = (e.competitions || [])[0] || {}, cs = c.competitors || [];
    const h = cs.find(x => x.homeAway === "home"), a = cs.find(x => x.homeAway === "away"); if (!h || !a) continue;
    const st = ((c.status || e.status || {}).type) || {}; let state = st.state || "pre";
    if (/postpon|cancel/i.test(st.description || "")) state = "off";
    out.push({ id: String(e.id), state, detail: st.shortDetail || st.detail || "", hs: state === "pre" ? null : num(h.score), as: state === "pre" ? null : num(a.score) });
  }
  return out;
}

// Heisman-style production line for a player card and tables.
function statLine(p) {
  const s = p && p.s || {}, g = k => num(s[k]) || 0, parts = [];
  if (g("att") >= 40) parts.push(g("pyd").toLocaleString() + " pass yds, " + g("ptd") + " TD, " + g("int") + " INT");
  if (g("car") >= 25) parts.push(g("ryd").toLocaleString() + " rush yds, " + g("rtd") + " TD");
  if (g("rec") >= 10) parts.push(g("rec") + " rec, " + g("wyd").toLocaleString() + " yds, " + g("wtd") + " TD");
  if (g("tkl") >= 15 || g("dsk") >= 2 || g("dint") >= 2) parts.push([g("tkl") ? g("tkl") + " tkl" : "", g("tfl") ? g("tfl") + " TFL" : "", g("dsk") ? g("dsk") + " sacks" : "", g("dint") ? g("dint") + " INT" : ""].filter(Boolean).join(", "));
  return parts.slice(0, 2).join(" · ");
}

return { finite, num, round, key, phi, line, prob, edge, watch, resumeValue, gamesFromESPN, statLine };
});
