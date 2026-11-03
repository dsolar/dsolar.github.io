/* Fantasy Kit: player value. No DOM and no network.

   evaluate(sport, players, league) sets on every player:
     v      raw value: summed category z-scores, or projected fantasy points for the season
     zc     per-category z-scores (category leagues)
     fpts   season fantasy points so far, fpg per game (points leagues)
     vor    value over the replacement player at his best position, given how many teams start how many slots
     rank   overall rank by vor; prank like "RB12"
     $      auction value from the league's budgets (always set, so a snake draft can show it too)
   league: { teams, lineup: [slots], bench, scoring: key in sport.scorings, budget (default 200), minBid (default 1) } */
(function (root, factory) {
  const m = factory(root.FK ? root.FK.sports : typeof require !== "undefined" ? require("./sports.js") : null);
  if (typeof module !== "undefined" && module.exports) module.exports = m;
  else (root.FK = root.FK || {}).value = m;
})(this, function (S) {
  "use strict";

  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const meanSd = (xs) => {
    const m = sum(xs) / Math.max(1, xs.length);
    const sd = Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / Math.max(1, xs.length)) || 1;
    return [m, sd];
  };

  function scoringOf(sport, league) {
    const k = (league && league.scoring) || Object.keys(sport.scorings)[0];
    return sport.scorings[k] || sport.scorings[Object.keys(sport.scorings)[0]];
  }

  // A category's raw number for a player: the counting stat, or how far a rate stat moves a team's rate
  // (hits above the league average over his at-bats, for example), so volume counts.
  function catRaw(sport, p, c, lg, sc) {
    const line = c.line || "pg";
    if (!p.l[line]) return null;
    const f = pace(sport, p, line, sc);
    if (c.num) {
      const n = S.stat(sport, p, line, c.num) || 0, d = S.stat(sport, p, line, c.den) || 0;
      return (n - lg[c.k] * d) * f;
    }
    if (c.rate) {
      const x = S.stat(sport, p, line, c.rate), w = S.stat(sport, p, line, c.w) || 0;
      return x == null ? null : (x - lg[c.k]) * w * f;
    }
    return (S.stat(sport, p, line, c.col) || 0) * f;
  }

  // Full-season pace for season-total sports: a player who missed time is scaled toward a full workload, more
  // the more he played (285 plate appearances paces to about 470, not 600), so an injury year still costs him.
  function pace(sport, p, line, sc) {
    const pc = sc && sc.pace && sc.pace[line];
    if (!pc) return 1;
    const vol = S.stat(sport, p, line, pc.col) || 0;
    const full = typeof pc.full === "function" ? pc.full(sport, p) : pc.full;
    if (!vol || vol >= full) return 1;
    return (vol + (full - vol) * (vol / (vol + pc.k))) / vol;
  }

  function leagueRates(sport, base, cats) {
    const lg = {};
    for (const c of cats) {
      const line = c.line || "pg";
      const rows = base.filter((p) => p.l[line]);
      if (c.num) lg[c.k] = sum(rows.map((p) => S.stat(sport, p, line, c.num) || 0)) / Math.max(1e-9, sum(rows.map((p) => S.stat(sport, p, line, c.den) || 0)));
      else if (c.rate) {
        const w = sum(rows.map((p) => S.stat(sport, p, line, c.w) || 0));
        lg[c.k] = sum(rows.map((p) => (S.stat(sport, p, line, c.rate) || 0) * (S.stat(sport, p, line, c.w) || 0))) / Math.max(1e-9, w);
      }
    }
    return lg;
  }

  function catValues(sport, players, sc) {
    const lines = [...new Set(sc.cats.map((c) => c.line || "pg"))];
    for (const p of players) { p.zc = {}; p.v = 0; }
    for (const line of lines) {
      const cats = sc.cats.filter((c) => (c.line || "pg") === line);
      const has = players.filter((p) => p.l[line]);
      let base = has.filter((p) => (sc.base ? sc.base(sport, p, line) : true));
      if (base.length < 60) base = has.slice().sort((a, b) => volume(sport, b, line) - volume(sport, a, line)).slice(0, Math.min(has.length, 150));
      const lg = leagueRates(sport, base, cats);
      for (const c of cats) {
        const [m, sd] = meanSd(base.map((p) => catRaw(sport, p, c, lg, sc)).filter((x) => x != null));
        for (const p of has) {
          const x = catRaw(sport, p, c, lg, sc);
          if (x == null) continue;
          p.zc[c.k] = ((x - m) / sd) * (c.low ? -1 : 1);
        }
      }
      for (const p of has) p.v += sum(cats.map((c) => p.zc[c.k] || 0));
    }
    for (const p of players) if (!Object.keys(p.zc).length) p.v = -6;
  }
  const volume = (sport, p, line) => (line === "bat" ? S.stat(sport, p, "bat", "pa") : line === "pit" ? S.stat(sport, p, "pit", "ip") : S.stat(sport, p, line, "min") || S.stat(sport, p, line, "gp")) || 0;

  // How much of a season projection a hurt player is likely to play.
  const AVAIL = { ir: 0.5, pup: 0.5, out: 0.82, o: 0.82, doubtful: 0.9, d: 0.9, questionable: 0.97, q: 0.97, sus: 0.7 };
  function pointValues(sport, players, sc) {
    for (const p of players) {
      const line = sc.line;
      let tot = 0;
      // weights name a stat on the scoring's line, or "line.stat" for a sport with two (baseball's bat and pit)
      const at = (k) => { const i = k.indexOf("."); return (i > 0 ? S.stat(sport, p, k.slice(0, i), k.slice(i + 1)) : S.stat(sport, p, line, k)) || 0; };
      if (sc.weights) tot = sum(Object.entries(sc.weights).map(([k, w]) => at(k) * w));
      else tot = S.stat(sport, p, line, sc.col) || 0;
      const base = tot, gl0 = p.l[line] ? line : Object.keys(p.l).find((k) => k !== "proj") || line;
      tot += S.extraPts(sc, p, at, S.stat(sport, p, gl0, sport.sample ? sport.sample.col : "g") || 0);
      const gl = p.l[line] ? line : Object.keys(p.l).find((k) => k !== "proj") || line;
      const g = S.stat(sport, p, gl, sport.sample ? sport.sample.col : "g") || 0;
      if (sc.per === "game") { p.fpg = tot; p.fpts = tot * g; } else { p.fpts = tot; p.fpg = g ? tot / g : 0; }
      p.g = g;
      let proj = sc.proj != null && p.l.proj ? p.l.proj[sc.proj] : null;
      // custom football points: Sleeper's half-PPR projection, scaled by how this scoring rates the player so far
      if (proj == null && sc.projScale != null && p.l.proj) {
        const half = S.stat(sport, p, "tot", "pts_half_ppr") || 0;
        proj = p.l.proj[sc.projScale] * (half > 5 && tot > 0 ? tot / half : 1);
      }
      // bonuses lift a preset's projection by as much as they lift his season so far
      if (proj != null && tot !== base && base > 5) proj *= tot / base;
      p.proj = proj;
    }
  }

  // Pulls small samples toward a below-replacement line: g / (g + k) of a player's own rate.
  function shrink(sport, players, key) {
    const smp = sport.sample;
    if (!smp) return;
    const live = players.filter((p) => p.g == null ? (S.stat(sport, p, smp.line, smp.col) || 0) >= smp.k : p.g >= smp.k);
    const xs = (live.length > 40 ? live : players).map((p) => p[key]).sort((a, b) => b - a);
    const floor = xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.6))];
    for (const p of players) {
      const g = p.g != null ? p.g : S.stat(sport, p, smp.line, smp.col) || 0;
      const w = g / (g + smp.k);
      p[key] = w * p[key] + (1 - w) * floor;
    }
  }

  // Fills every team's starting slots with the best players, most specific slots first. Replacement at a position
  // is the best player left over who can play it.
  function replacement(sport, players, league) {
    const lineup = league.lineup || sport.lineup;
    const cap = {};
    for (const s of lineup) cap[s] = (cap[s] || 0) + (league.teams || 10);
    const order = Object.keys(cap).sort((a, b) => width(sport, a) - width(sport, b));
    const sorted = players.slice().sort((a, b) => b.v - a.v);
    const used = new Set();
    for (const p of sorted) {
      for (const s of order) if (cap[s] > 0 && S.fits(sport, p, s)) { cap[s]--; used.add(p); break; }
      if (Object.values(cap).every((x) => x <= 0)) break;
    }
    const repl = {};
    for (const pos of sport.positions) {
      const best = sorted.find((p) => !used.has(p) && S.positions(p).includes(pos));
      repl[pos] = best ? best.v : sorted.length ? sorted[sorted.length - 1].v : 0;
    }
    return repl;
  }
  const width = (sport, slot) => (sport.slots[slot] === "*" ? 99 : sport.slots[slot].length);

  // Projections (baseball's pbat and ppit, FanGraphs' Steamer): when the data has them, players are valued on the
  // projection, not last season. A player with no projection for a line has nothing on it (he isn't expected to
  // play). Their own lines go back afterward, so tables still show what they did. league.projections = false skips it.
  const PROJ_LINES = { bat: "pbat", pit: "ppit" };
  function swapProjections(sport, players, league) {
    const L = sport.data && sport.data.lines;
    if (league.projections === false || !L || !Object.values(PROJ_LINES).some((k) => L[k])) return null;
    const kept = [];
    for (const p of players) {
      const n = Object.assign({}, p.l);
      for (const [a, b] of Object.entries(PROJ_LINES)) { if (!L[b]) continue; if (n[b]) n[a] = n[b]; else delete n[a]; }
      kept.push([p, p.l]); p.l = n;
    }
    return kept;
  }
  function evaluate(sport, players, league = {}) {
    const kept = swapProjections(sport, players, league);
    try { return evaluate_(sport, players, league); } finally { if (kept) for (const [p, l] of kept) p.l = l; }
  }
  function evaluate_(sport, players, league) {
    const sc = scoringOf(sport, league);
    if (sc.type === "cats") {
      catValues(sport, players, sc);
      if (sport.sample) {
        for (const p of players) p.g = S.stat(sport, p, sport.sample.line, sport.sample.col) || 0;
        shrink(sport, players, "v");
      }
    } else {
      pointValues(sport, players, sc);
      // What a player scores per game from here: his own rate this season (shrunk for small samples) blended with the
      // projection, the real games counting more as they pile up (half and half after six). A rest-of-season
      // projection already leaves out the weeks a player is hurt; a season projection set in the summer doesn't, so
      // injuries come off it. Value stays on a season scale so a week is v / games anywhere it's used.
      for (const p of players) p.v = p.fpg;
      shrink(sport, players, "v");
      const meta = (sport.data && sport.data.lines && sport.data.lines.proj) || {};
      const games = sc.games || 17, left = meta.ros ? Math.max(1, meta.weeks || 1) : games;
      for (const p of players) {
        const pr = p.proj > 0 ? p.proj / left : null;
        const w = p.g ? p.g / (p.g + 6) : 0;
        let rate = pr == null ? p.v : p.g ? w * p.v + (1 - w) * pr : pr;
        if (!meta.ros) rate *= AVAIL[String(p.inj || "").toLowerCase()] || 1;
        p.v = rate * games;
        p.ros = meta.ros && p.proj != null ? p.proj : null;
      }
    }
    const repl = replacement(sport, players, league);
    for (const p of players) {
      const ps = S.positions(p).filter((x) => repl[x] != null);
      p.vor = p.v - (ps.length ? Math.min(...ps.map((x) => repl[x])) : Math.max(...Object.values(repl)));
    }
    streamers(sport, players, league);
    if (league.dynasty) dynasty(sport, players, league);
    if (league.market) market(sport, players, league, sc);
    const sorted = players.slice().sort((a, b) => b.vor - a.vor || b.v - a.v);
    const posN = {};
    sorted.forEach((p, i) => {
      p.rank = i + 1;
      const pos = mainPos(sport, p);
      posN[pos] = (posN[pos] || 0) + 1;
      p.prank = pos + posN[pos];
    });
    dollars(sport, sorted, league);
    return { scoring: sc, repl };
  }

  /* ---------- the market: ESPN's ranks, ADP and auction prices (data/market-<sport>.json, tools/market_pull.py) ---------- */
  // p.mk = { r: ESPN's rank for this league's kind of scoring, a: ESPN's auction value, adp, aav: the average price in
  // real ESPN auctions, own: percent of ESPN leagues rostering him, add: Sleeper adds in the last day }.
  function market(sport, players, league, sc) {
    const rows = league.market && league.market.players;
    if (!rows) return;
    const lineup = league.lineup || sport.lineup;
    const type = sport.key === "nfl" ? (lineup.includes("SFLEX") || lineup.filter((x) => x === "QB").length >= 2 ? "SUPERFLEX" : /std/.test(sc.col || "") ? "STANDARD" : "PPR")
      : sc.type === "cats" ? "ROTO" : "STANDARD";
    let n = 0;
    for (const p of players) {
      const m = rows[p.id];
      if (!m) { delete p.mk; continue; }
      p.mk = { r: (m.r || {})[type] || (m.r || {}).STANDARD || null, a: (m.a || {})[type] || (m.a || {}).STANDARD || null, adp: m.adp || null, aav: m.aav || null, own: m.own == null ? null : m.own, add: m.add || null };
      n++;
    }
    sport.market = n > 50 ? { type, source: league.market.source, updated: league.market.updated } : null;
  }

  /* ---------- dynasty: value over the next five seasons, not just this one ---------- */
  // A player's value this season carried forward on an age curve for his position. Each curve is [peak starts, peak
  // ends, growth a year before the peak, decline a year for two years after it, decline a year after that, the age
  // players start retiring, the share still playing each year past it]. Later seasons count less (0.9, 0.8, 0.7,
  // 0.6), and the sum is scaled so a player at his peak keeps his value: a 20-year-old climbs, a 29-year-old running
  // back or a 37-year-old guard falls a long way, and a 30-year-old quarterback barely moves.
  const AGE_CURVES = {
    nfl: { RB: [23, 26, 0.06, 0.12, 0.2, 30, 0.7], WR: [24, 29, 0.07, 0.08, 0.15, 32, 0.8], TE: [25, 30, 0.1, 0.08, 0.15, 33, 0.8], QB: [25, 33, 0.05, 0.06, 0.15, 37, 0.75] },
    nba: { "*": [24, 29, 0.08, 0.06, 0.15, 33, 0.65] },
    mlb: { SP: [26, 30, 0.04, 0.05, 0.09, 34, 0.8], RP: [26, 30, 0.04, 0.05, 0.09, 34, 0.8], "*": [26, 30, 0.05, 0.04, 0.08, 35, 0.8] },
  };
  const ROOKIE_AGE = { nfl: 22, nba: 20, mlb: 24 };
  const YEAR_W = [1, 0.9, 0.8, 0.7, 0.6];
  function level(c, age) {
    const [a, b, g, d1, d2, ra, q] = c;
    let x;
    if (age < a) x = Math.pow(1 + g, -(a - age));
    else if (age <= b) x = 1;
    else { const over = age - b; x = Math.pow(1 - d1, Math.min(2, over)) * Math.pow(1 - d2, Math.max(0, over - 2)); }
    return age > ra ? x * Math.pow(q, age - ra) : x;           // the chance he's still playing
  }
  function ageOf(sport, p) {
    if (p.age) return p.age;
    if (sport.key === "nfl" && p.exp != null) return 22.5 + p.exp;
    return p.rk ? ROOKIE_AGE[sport.key] : null;
  }
  function dynastyMult(sport, p) {
    const curves = AGE_CURVES[sport.key];
    if (!curves) return 1;
    const pos = mainPos(sport, p), c = curves[pos] || curves["*"], age = ageOf(sport, p);
    if (!c || !age) return 1;
    const now = level(c, age);
    return YEAR_W.reduce((t, w, y) => t + w * level(c, age + y) / now, 0) / YEAR_W.reduce((t, w) => t + w, 0);
  }
  function dynasty(sport, players, league) {
    for (const p of players) {
      const m = dynastyMult(sport, p);
      p.dyn = Math.round(m * 100) / 100;
      // below replacement: a rising player climbs toward it, a fading one sinks further
      p.vor = p.vor >= 0 ? p.vor * m : p.vor * (2 - Math.min(1.9, m));
    }
    // outside consensus (league.dynastyRanks, from tools/dynasty_pull.py): a ranked player takes most of his value
    // from the consensus, read as the model's value at that rank, and keeps some of the model's, which knows this
    // league's scoring and lineup. A football league with a superflex or two QB slots uses the superflex rankings.
    const file = league.dynastyRanks, lineup = league.lineup || sport.lineup;
    const sf = lineup.includes("SFLEX") || lineup.filter((x) => x === "QB").length >= 2;
    // football: FantasyCalc's own market for the nearest setup (team count, points per catch, QB count) when the file has it
    let ranks = file && ((sf && file.sf) || file.players);
    if (file && file.v && sport.key === "nfl") {
      const sc = scoringOf(sport, league), base = sc.col || "";
      const ppr = sc.weights ? sc.weights.rec || 0 : /ppr/.test(base) ? (/half/.test(base) ? 0.5 : 1) : 0;
      const near = (xs, x) => xs.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
      const key = `${near([10, 12, 14], league.teams || 12)}|${near([0, 0.5, 1], ppr)}|${sf ? 2 : 1}`;
      if (file.v[key]) ranks = file.v[key];
    }
    if (!ranks || Object.keys(ranks).length < 50) return;
    const curve = players.map((p) => p.vor).sort((a, b) => b - a), n = Object.keys(ranks).length;
    for (const p of players) {
      const r = ranks[p.id];
      if (r) { p.cons = r[0]; p.vor = 0.65 * curve[Math.min(curve.length - 1, r[0] - 1)] + 0.35 * p.vor; }
      // someone the consensus leaves out ranks no higher than its last player (kickers and defenses aside)
      else if (!(sport.late && S.isLate(sport, p))) p.vor = Math.min(p.vor, curve[Math.min(curve.length - 1, n - 1)]);
    }
  }

  // Kickers and defenses (sport.late): a season projection for them barely predicts the season, and the waiver wire
  // has a startable one every week, so they go in the last rounds of real drafts. Their value is spread over that
  // stretch: the best one is worth what the draft's last few rounds start at (past every other starter and most of
  // the bench), a replacement-level one what its last pick is worth, and anyone below that less still.
  function streamers(sport, players, league) {
    const late = new Set(sport.late || []);
    if (!late.size) return;
    const isLate = (p) => S.positions(p).every((x) => late.has(x));
    const lineup = league.lineup || sport.lineup, teams = league.teams || 10;
    const bench = league.bench == null ? sport.bench : league.bench;
    const lateSlots = lineup.filter((x) => late.has(x)).length;
    const others = players.filter((p) => !isLate(p)).map((p) => p.vor).sort((a, b) => b - a);
    if (!others.length) return;
    const at = (k) => others[Math.max(0, Math.min(others.length - 1, Math.round(k)))];
    const hi = at(teams * (lineup.length - lateSlots + 0.8 * bench)), lo = at(teams * (lineup.length - lateSlots + bench));
    const top = {};
    for (const p of players) if (isLate(p)) { const k = S.positions(p)[0]; top[k] = Math.max(top[k] || 0, p.vor); }
    for (const p of players) {
      if (!isLate(p)) continue;
      const mx = top[S.positions(p)[0]] || 1;
      p.vor = p.vor >= 0 ? lo + (hi - lo) * (p.vor / mx) : lo + 0.2 * p.vor;
    }
  }

  // The position a player is ranked at: his scarcest one (a C/1B ranks at C).
  const mainPos = (sport, p) => {
    const ps = S.positions(p);
    if (ps.length <= 1) return ps[0] || "?";
    const sp = ps.filter((x) => x !== "UT");
    return (sp.length ? sp : ps).slice().sort((a, b) => sport.positions.indexOf(a) - sport.positions.indexOf(b))[0];
  };

  // Auction dollars: $1 for every roster spot, and the rest of the league's money split by value over the last
  // player who would be drafted.
  function dollars(sport, sorted, league) {
    const teams = league.teams || 10, budget = league.budget || 200, minBid = league.minBid == null ? 1 : league.minBid;
    const spots = teams * ((league.lineup || sport.lineup).length + (league.bench == null ? sport.bench : league.bench));
    const pool = sorted.slice(0, spots);
    const floor = pool.length ? pool[pool.length - 1].vor : 0;
    // Real auctions are top heavy: stars go for far more than their share of
    // points, and the last third of every roster goes for about the minimum.
    // Blend a rank curve (quadratic, reaching the minimum at 60% of the
    // rostered pool) with a convex value curve so tiers in the projections
    // still show. Tuned to ESPN and Yahoo average auction prices.
    const edge = Math.max(1, CURVE.edge * spots);
    const byRank = pool.map((p, i) => Math.max(0, 1 - i / edge) ** 2);
    const byValue = pool.map((p) => Math.max(0, p.vor - floor) ** CURVE.power);
    const rt = sum(byRank) || 1, vt = sum(byValue) || 1;
    const money = teams * budget - spots * minBid;
    for (const p of sorted) p.$ = 0;
    pool.forEach((p, i) => {
      const share = CURVE.rank * (byRank[i] / rt) + (1 - CURVE.rank) * (byValue[i] / vt);
      p.$ = Math.max(minBid, Math.round(minBid + share * money));
    });
  }
  const CURVE = { edge: 0.6, rank: 0.7, power: 1.4 };

  return { evaluate, scoringOf, mainPos, replacement, dollars, dynastyMult, ageOf };
});
