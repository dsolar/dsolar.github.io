// College football box scores for Draft Lab: one ESPN summary in football's columns (the NFL's names, so the NFL's
// scorings, categories and custom points read them), keyed by ESPN athlete id, plus each team's defense line keyed
// by its abbreviation (the pool's DEF ids). Shared by the nightly weekly file (tools/fantasykit_cfb.mjs) and the live
// feed (fk-live ?sport=cfb), so both read a box score the same way.
//
// ESPN's college box score has no targets, two-point tries, safeties or field goal distances: fgm_50p counts at most
// one field goal of 50+ a game (from the longest), and the rest are left out. Points are worked out here in the
// usual way: 0.04 a passing yard, 4 a passing TD, -2 an interception, 0.1 a rushing or receiving yard, 6 a rushing,
// receiving or return TD, -2 a lost fumble, 0, 0.5 or 1 a catch; 3 a field goal (5 from 50+), 1 an extra point, -1 a
// missed one; a defense 1 a sack, 2 an interception or fumble recovery, 6 a TD, and by points allowed.
export const CFB_COLS = ["g", "pass_yd", "pass_td", "pass_int", "rush_att", "rush_yd", "rush_td", "rec", "rec_yd", "rec_td", "fum_lost",
  "fgm", "fga", "xpm", "def_td", "def_int", "def_sack", "pts_allow", "pts_std", "pts_half_ppr", "pts_ppr",
  "pass_att", "pass_cmp", "fum", "fgm_50p", "xpmiss", "fum_rec", "def_st_td", "yds_allow", "ret_td"];
const IX = Object.fromEntries(CFB_COLS.map((c, i) => [c, i]));
export const CFB_ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/college-football";

// points allowed, the usual tiers
export const allowPts = (pa) => (pa === 0 ? 10 : pa <= 6 ? 7 : pa <= 13 ? 4 : pa <= 20 ? 1 : pa <= 27 ? 0 : pa <= 34 ? -1 : -4);
// a line's three points totals, from its counts
export function withPoints(l, def) {
  const v = (k) => l[IX[k]] || 0;
  if (def) {
    const p = v("def_sack") + 2 * v("def_int") + 2 * v("fum_rec") + 6 * (v("def_td") + v("def_st_td")) + (v("g") ? allowPts(v("pts_allow")) : 0);
    l[IX.pts_std] = l[IX.pts_half_ppr] = l[IX.pts_ppr] = Math.round(p * 100) / 100;
    return l;
  }
  const base = 0.04 * v("pass_yd") + 4 * v("pass_td") - 2 * v("pass_int") + 0.1 * (v("rush_yd") + v("rec_yd")) + 6 * (v("rush_td") + v("rec_td") + v("ret_td"))
    - 2 * v("fum_lost") + 3 * v("fgm") + 2 * v("fgm_50p") + v("xpm") - v("xpmiss");
  const r = (x) => Math.round(x * 100) / 100;
  l[IX.pts_std] = r(base); l[IX.pts_half_ppr] = r(base + 0.5 * v("rec")); l[IX.pts_ppr] = r(base + v("rec"));
  return l;
}
const num = (x) => { const n = parseFloat(String(x == null ? "" : x).replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
const pair = (x) => String(x || "").split("/").map(num);

// one summary: { state, lines: { athleteId: line }, def: { ABBR: line }, pos: { athleteId: "QB" }, names: { id: name },
// teams: { athleteId: ABBR } }
export function cfbBox(s) {
  const out = { state: s?.header?.competitions?.[0]?.status?.type?.state || "pre", lines: {}, def: {}, pos: {}, names: {}, team: {} };
  const comps = s?.header?.competitions?.[0]?.competitors || [];
  const abbrOf = {}, score = {};
  for (const c of comps) { const id = String(c.team?.id || c.id || ""); abbrOf[id] = c.team?.abbreviation; score[id] = num(c.score); }
  const sides = s?.boxscore?.players || [];
  const tyds = {};
  for (const t of s?.boxscore?.teams || []) {
    const st = Object.fromEntries((t.statistics || []).map((x) => [x.name, x.displayValue]));
    tyds[String(t.team?.id || "")] = num(st.totalYards);
  }
  const blank = () => CFB_COLS.map(() => 0);
  const teamIds = sides.map((p) => String(p.team?.id || ""));
  const dl = {};
  for (const [i, side] of sides.entries()) {
    const tid = teamIds[i], ab = side.team?.abbreviation || abbrOf[tid], opp = teamIds[1 - i];
    const D = (dl[tid] = dl[tid] || blank());
    for (const cat of side.statistics || []) {
      const labels = (cat.labels || []).map((x) => String(x).toUpperCase());
      const at = (a, k) => { const j = labels.indexOf(k); return j >= 0 ? a.stats[j] : null; };
      for (const a of cat.athletes || []) {
        const id = a.athlete?.id; if (!id || !a.stats || !a.stats.length) continue;
        const key = String(id);
        // defenders count toward their team's defense, not a line of their own (no individual defensive players)
        if (cat.name === "defensive" || cat.name === "interceptions") {
          if (cat.name === "defensive") { D[IX.def_sack] += num(at(a, "SACKS")); D._dtd = (D._dtd || 0) + num(at(a, "TD")); }
          else { D[IX.def_int] += num(at(a, "INT")); D._itd = (D._itd || 0) + num(at(a, "TD")); }
          continue;
        }
        if (cat.name === "punting") continue;
        const L = (out.lines[key] = out.lines[key] || blank());
        out.names[key] = a.athlete.displayName || out.names[key];
        out.team[key] = ab;
        const ps = a.athlete.position?.abbreviation; if (ps && !out.pos[key]) out.pos[key] = ps;
        const add = (k, x) => { L[IX[k]] += x; };
        switch (cat.name) {
          case "passing": { const [c, t] = pair(at(a, "C/ATT")); add("pass_cmp", c); add("pass_att", t); add("pass_yd", num(at(a, "YDS"))); add("pass_td", num(at(a, "TD"))); add("pass_int", num(at(a, "INT"))); if (t >= 5) out.pos[key] = out.pos[key] || "QB"; break; }
          case "rushing": add("rush_att", num(at(a, "CAR"))); add("rush_yd", num(at(a, "YDS"))); add("rush_td", num(at(a, "TD"))); break;
          case "receiving": add("rec", num(at(a, "REC"))); add("rec_yd", num(at(a, "YDS"))); add("rec_td", num(at(a, "TD"))); break;
          case "fumbles": add("fum", num(at(a, "FUM"))); add("fum_lost", num(at(a, "LOST"))); break;
          case "kickReturns": case "puntReturns": add("ret_td", num(at(a, "TD"))); D[IX.def_st_td] += num(at(a, "TD")); break;
          case "kicking": {
            const [fm, fa] = pair(at(a, "FG")), [xm, xa] = pair(at(a, "XP"));
            add("fgm", fm); add("fga", fa); add("xpm", xm); add("xpmiss", Math.max(0, xa - xm)); if (fm && num(at(a, "LONG")) >= 50) add("fgm_50p", 1);
            out.pos[key] = "K"; break;
          }
          default: break;
        }
      }
    }
    D._ab = ab; D._opp = opp;
  }
  // a defense's fumble recoveries are the other side's lost fumbles; points and yards allowed are the other side's
  const abOf = Object.fromEntries(Object.entries(dl).map(([tid, D]) => [tid, D._ab]));
  for (const [tid, D] of Object.entries(dl)) {
    const opp = D._opp, oppAb = abOf[opp];
    const lost = Object.entries(out.lines).filter(([id]) => out.team[id] === oppAb).reduce((a, [, l]) => a + l[IX.fum_lost], 0);
    // the defensive list's TDs may already include interception returns, so take the larger count, not both
    D[IX.def_td] = Math.max(D._dtd || 0, D._itd || 0); delete D._dtd; delete D._itd;
    D[IX.fum_rec] += lost; D[IX.g] = 1; D[IX.pts_allow] = score[opp] || 0; D[IX.yds_allow] = tyds[opp] || 0;
    delete D._ab; delete D._opp;
    if (abOf[tid]) out.def[abOf[tid]] = withPoints(D, true);
  }
  for (const L of Object.values(out.lines)) { L[IX.g] = 1; withPoints(L); }
  return out;
}

// sums lines into a running total (a week's or a season's), then recomputes the points: tiers for points allowed
// count each game, so a defense's points are summed game by game, not worked out from the total
export function addInto(acc, lines, keep) {
  for (const [id, l] of Object.entries(lines || {})) {
    if (keep && !keep(id)) continue;
    const a = acc[id];
    acc[id] = a ? a.map((x, i) => Math.round((x + (l[i] || 0)) * 100) / 100) : l.slice();
  }
  return acc;
}
export const cfbCol = IX;
