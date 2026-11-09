/* MLB hub model: every number on the page comes from here.
 *
 * Works in the browser (window.MLBModel) and in node (module.exports) for tests: tests/mlb_hub.test.mjs.
 *
 * The year slider. The first season is FanGraphs' own Depth Charts (their playing time, their projections).
 * Each later season is built here:
 *   - who's still on the team: guaranteed years, club options worth picking up, player options worth keeping,
 *     and team control from service time (pre-arb under 3 years, arbitration until 6); everyone else walks
 *     unless you re-sign him
 *   - how good he is: Steamer's full-time WAR rate, aged a year at a time along a standard aging curve
 *   - prospects arrive at their ETA (The Board), or by level when there's no ETA, and grow toward their FV grade
 *   - the depth chart: best available player at each spot, a bench, five starters and eight relievers
 *   - empty spots are "FA Fill": a replacement-level player, or a modest free agent if teams buy (the default)
 * Wins come from team WAR (a replacement team wins about 48), scaled so later seasons spread like the first.
 *
 * Surplus value: projected WAR x the market price of a win, minus salary, every year of the contract or team
 * control, discounted. Like front offices (and Baseball Trade Values, which these defaults are calibrated to), it pays
 * for 85% of projected WAR, a margin of safety for injuries and misses, and fades an unproven big leaguer's later years
 * (20% a year until he'd have 3 years of service), since long control on a short track record is worth less than it adds up to. Arbitration pays a share of market value (25/40/60%), pre-arb the minimum. Club options are
 * picked up only when they're worth it; player options only come back when they're bad for the team.
 * The price of a win is read from recent free agent deals; how far long deals, relievers or qualifying-offer players
 * land above or below it is the market question on the Free Agents tab.
 */
(function (root) {
  "use strict";

  var DEFAULTS = {
    dpw: 9.5,          // $M per WAR in the first season; replaced by the free agent read when there's enough data
    inflation: 0.03,   // yearly growth in the price of a win
    discount: 0.08,    // yearly discount rate for surplus
    minSalary: 0.8,    // $M, league minimum (assumed until the next CBA sets it)
    arbPct: [0.25, 0.4, 0.6, 0.7], // share of market value paid in arbitration years 1-4
    fill: true,        // teams buy modest free agents for empty spots
    fillWar: { bat: 1.5, sp: 1.5, rp: 0.4 },
    haircut: 0.85,     // share of projected WAR teams pay for (their margin of safety for injuries and misses)
    fade: 1,           // yearly shrink of WAR further out (projections get less certain each year)
    youngFade: 0.8,    // extra yearly shrink for unproven big leaguers (under 3 years of service): long control on a
                       // short track record is worth less than its projection adds up to
    tiered: false,     // price WAR by tier: 1-2 WAR players are plentiful, stars aren't (from the free agent market)
    years: 5,          // seasons on the slider
    sims: 4000
  };

  // ---------- aging and prospects ----------

  // Change in full-time WAR rate going into this season age (hitters and starters; relievers scaled)
  // Modest gains into the mid-20s (Steamer already builds some growth into a young player's line), flat at 27-28,
  // then a steepening decline
  function agingDelta(age) {
    if (age <= 23) return 0.25;
    var t = { 24: 0.2, 25: 0.15, 26: 0.1, 27: 0.05, 28: 0, 29: -0.15, 30: -0.3, 31: -0.4, 32: -0.45, 33: -0.5, 34: -0.55 };
    return age in t ? t[age] : -0.6;
  }

  // Full-time WAR a prospect's FV grade implies at his peak (FanGraphs' scale: 50 = average regular, 60 = plus,
  // 70 = all-star). "+" grades sit halfway to the next step.
  var FV_WAR = { 30: 0, 35: 0.2, 40: 0.4, 45: 1.0, 50: 2.0, 55: 2.8, 60: 3.6, 65: 4.5, 70: 5.5, 75: 6.5, 80: 7.5 };
  function fvWar(fv, reliever) {
    var m = /^(\d+)(\+?)/.exec(String(fv || ""));
    if (!m) return 0;
    var g = +m[1], base = FV_WAR[g] != null ? FV_WAR[g] : (g >= 80 ? 7.5 : 0);
    if (m[2]) base = (base + (FV_WAR[g + 5] != null ? FV_WAR[g + 5] : base)) / 2;
    return reliever ? base * 0.5 : base;
  }
  // How much of a prospect's graded value to count: plenty of grades never arrive
  var RISK_HIT = { Low: 0.75, Med: 0.6, Medium: 0.6, High: 0.45, Extreme: 0.3 };
  var RAMP = [0.5, 0.7, 0.85, 1];

  function seasonAge(p, year, season) {
    return p.age == null ? 27 : Math.floor(p.age + 0.6 + (year - season));
  }
  function isReliever(p) { return p.p && !p.sp && !/SP/.test(p.ppos || p.pos || ""); }
  function isProspect(p) { return !!p.fv && (p.g === "min" || (p.st || 0) < 1); }

  function arrival(p, season) {
    if (p.g !== "min") return season;
    if (p.eta) return Math.max(season, p.eta);
    return season + ({ AAA: 1, AA: 2, "A+": 3, A: 4 }[p.lvl] || 4);
  }

  // Full-time WAR rate in a season
  function rateAt(p, year, season) {
    var scale = isReliever(p) ? 0.4 : 1;
    var r = p.rate != null ? p.rate : 0;
    for (var y = season + 1; y <= year; y++) r += agingDelta(seasonAge(p, y, season)) * scale;
    if (!isProspect(p)) return r;
    var peak = fvWar(p.fv, isReliever(p)), a = arrival(p, season);
    if (year < a) return r;
    var k = year - a, age = seasonAge(p, year, season), rp = peak * RAMP[Math.min(k, 3)];
    if (age > 29) { // past his peak, the prospect path ages too
      var drop = 0;
      for (var g = 30; g <= age; g++) drop += agingDelta(g) * scale;
      rp = peak + drop;
    }
    // Steamer's read of him now (aged) and the path his grade implies, weighted toward the grade
    return p.rate != null ? 0.4 * r + 0.6 * rp : rp;
  }

  // ---------- contracts and team control ----------

  function contractYear(p, year) {
    if (!p.c || !p.c.yrs) return null;
    for (var i = 0; i < p.c.yrs.length; i++) if (p.c.yrs[i][0] === year) return p.c.yrs[i];
    return null;
  }

  // Service-time status in a season: "pre", "arb1".."arb4", or "fa" (no longer controlled)
  function controlStatus(p, year, season) {
    var st;
    if (p.g === "min" || p.st == null) {
      var a = arrival(p, season);
      if (year < a) return "minors";
      st = year - a;
    } else {
      st = p.st + (year - season);
    }
    if (st < 3) return "pre";
    if (st < 6) return "arb" + Math.min(4, Math.floor(st) - 2);
    return "fa";
  }

  function dpwAt(cfg, year, season) { return cfg.dpw * Math.pow(1 + cfg.inflation, year - season); }
  // What a season of WAR is worth as a share of the going rate, by how much WAR it is. From this market's own deals:
  // players projected under 1.5 WAR signed for about 22% under the rate, 2.5-4 WAR players about 15% over.
  function tierMult(war) {
    var pts = [[0, 0.7], [1, 0.78], [2, 0.94], [3.25, 1.15], [6, 1.15]];
    if (war <= 0) return pts[0][1];
    for (var i = 1; i < pts.length; i++) if (war <= pts[i][0]) {
      var a = pts[i - 1], b = pts[i];
      return a[1] + (b[1] - a[1]) * (war - a[0]) / (b[0] - a[0]);
    }
    return pts[pts.length - 1][1];
  }
  function fieldValue(war, year, season, cfg, p) {
    var prospect = p && isProspect(p), young = p && !prospect && p.g !== "min" && (p.st || 0) < 3;
    var w = Math.max(0, war) * (prospect || cfg.haircut == null ? 1 : cfg.haircut) * Math.pow(cfg.fade == null ? 1 : cfg.fade, year - season)
      * (young ? Math.pow(cfg.youngFade == null ? 1 : cfg.youngFade, Math.min(year - season, Math.ceil(3 - (p.st || 0)))) : 1); // until he'd be established
    return w * (cfg.tiered ? tierMult(w) : 1) * dpwAt(cfg, year, season);
  }

  // Expected WAR in a season for value purposes: the rate times a playing-time share
  function warAt(p, year, season) {
    var rate = rateAt(p, year, season);
    var dc = p.pjs === "dc" && p.pj && p.pj.war != null ? p.pj.war : null;
    if (year === season && dc != null && p.g !== "min") return dc;
    // Playing time: FanGraphs' share for the coming season, growing a little each year (a catcher tops out lower)
    var cap = p.pos === "C" || (p.el && p.el[0] === "C") ? 0.8 : 0.9;
    var share0 = dc != null && p.rate > 0.3 ? Math.max(0.15, Math.min(1, dc / p.rate)) : null;
    var reg = rate >= 2 ? 0.85 : rate >= 1 ? 0.7 : 0.5;
    var share = share0 == null ? Math.min(cap, reg) : Math.min(Math.max(cap, share0), share0 + 0.05 * (year - season));
    return Math.max(-0.3, rate * share);
  }

  // Salary, its kind, and whether he's with the team in a season. Options are decided on value.
  // Value never goes below zero: a team can always play a replacement-level player for the minimum instead.
  // Pre-arb and arbitration years aren't guaranteed (the team can option, release or non-tender him), so they're
  // flagged control: a controlled year can't cost the team more than it's worth. Only guaranteed money goes negative.
  function yearTerms(p, year, season, cfg, resigned) {
    var war = warAt(p, year, season), value = fieldValue(war, year, season, cfg, p);
    var cy = contractYear(p, year), st = controlStatus(p, year, season);
    if (cy) {
      var sal = cy[1] != null ? cy[1] / 1e6 : null, code = cy[2], buyout = (cy[3] || 0) / 1e6;
      if (p.c.defer && cy[5]) sal = cy[5] / 1e6; // deferred money: value it at the CBT hit, not face
      if (code === "CO") return { on: value >= sal, salary: value >= sal ? sal : buyout, kind: "Club option", value: value, war: war, option: true, buyout: buyout };
      if (code === "PO" || code === "OO") return { on: sal >= value, salary: sal >= value ? sal : 0, kind: "Player option", value: value, war: war, option: true };
      if (code === "MO") return { on: false, salary: buyout, kind: "Mutual option", value: value, war: war, option: true };
      if (/^A/.test(code) || code === "PA") {
        var n = /^A(\d)/.exec(code), arbN = n ? +n[1] : (/arb(\d)/.exec(st) || [0, 1])[1];
        var est = code === "PA" ? cfg.minSalary : Math.max(cfg.minSalary, cfg.arbPct[Math.min(3, arbN - 1)] * Math.max(0, value));
        var arbProj = cy[4] ? cy[4] / 1e6 : null; // FanGraphs' arbitration projection, when it has one
        return { on: true, salary: sal != null && sal > 0 ? sal : (arbProj || est), kind: code === "PA" ? "Pre-arb" : "Arb " + arbN, value: value, war: war, est: !(sal > 0), control: true };
      }
      return { on: true, salary: sal != null ? sal : 0, kind: "Signed", value: value, war: war };
    }
    // past the contract: team control from service time
    var last = p.c && p.c.yrs && p.c.yrs.length ? p.c.yrs[p.c.yrs.length - 1][0] : null;
    var signedThrough = last != null && year > last && p.c.type && !/Arbitration|Pre-Arb/i.test(p.c.type);
    if (st === "minors") return { on: false, salary: 0, kind: "Minors", value: 0, war: 0 };
    if (!signedThrough && st === "pre") return { on: true, salary: cfg.minSalary, kind: "Pre-arb", value: value, war: war, control: true };
    if (!signedThrough && /^arb/.test(st)) {
      var k = +st.slice(3);
      return { on: true, salary: Math.max(cfg.minSalary, cfg.arbPct[k - 1] * Math.max(0, value)), kind: "Arb " + k, value: value, war: war, est: true, control: true };
    }
    if (resigned) return { on: true, salary: Math.max(cfg.minSalary, value), kind: "Re-signed", value: value, war: war };
    return { on: false, salary: 0, kind: "Free agent", value: value, war: war };
  }

  function retires(p, year, season) {
    var age = seasonAge(p, year, season);
    return age >= 41 || (age >= 38 && rateAt(p, year, season) < 0.5);
  }

  // ---------- surplus value ----------

  function surplus(p, cfg, season, resigned) {
    cfg = cfg || DEFAULTS;
    var rows = [], pv = 0, total = 0, prospect = isProspect(p);
    var start = prospect ? Math.max(season, arrival(p, season)) : season;
    var hit = prospect ? (RISK_HIT[p.risk] || 0.75) : 1;
    for (var y = season; y <= season + 11; y++) {
      if (y < start) continue;
      var t = yearTerms(p, y, season, cfg, resigned);
      if (!t.on && !(t.option && t.salary)) { if (y > start) break; else continue; }
      if (retires(p, y, season)) break;
      var s = t.on ? t.value - t.salary : -t.salary; // a declined option still costs its buyout
      if (t.control) s = Math.max(0, s);             // not guaranteed: the team would cut him before paying more
      if (t.kind === "Player option" && !t.on) s = 0;
      s *= hit;
      var disc = Math.pow(1 + cfg.discount, y - season);
      rows.push({ y: y, war: t.on ? t.war : 0, value: t.on ? t.value : 0, salary: t.salary, kind: t.kind, surplus: s, pv: s / disc, est: !!t.est });
      total += s;
      pv += s / disc;
      if (!t.on) break;
    }
    return { rows: rows, total: total, pv: pv, prospect: prospect, hit: hit };
  }

  // ---------- depth charts ----------

  var SLOTS = ["C", "SS", "CF", "2B", "3B", "RF", "LF", "1B", "DH"];
  var FIELD_ORDER = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"];
  var CAN = { // who can cover a spot besides the listed position
    "1B": ["3B", "LF", "RF", "C", "DH"], "2B": ["SS", "3B"], "3B": ["SS", "2B"], "SS": [],
    "LF": ["CF", "RF"], "RF": ["CF", "LF"], "CF": [], "C": [], "DH": null
  };
  function canPlay(p, slot) {
    if (slot === "DH") return true;
    var el = p.el || [p.pos];
    if (el.indexOf(slot) >= 0) return true;
    if (/IF/.test(el.join("/")) && /1B|2B|3B|SS/.test(slot)) return true;
    if (/OF/.test(el.join("/")) && /LF|CF|RF/.test(slot)) return true;
    var alt = CAN[slot] || [];
    for (var i = 0; i < alt.length; i++) if (el.indexOf(alt[i]) >= 0) return true;
    return false;
  }
  var LINE_PT = 0.9, BENCH_PT = [0.45, 0.3, 0.25, 0.2];
  var SP_PT = [0.95, 0.9, 0.85, 0.8, 0.7], RP_PT = [1, 0.95, 0.9, 0.85, 0.8, 0.7, 0.6, 0.5];

  function Hub(hub, fa, opts) {
    this.hub = hub;
    this.season = hub.season;
    this.cfg = Object.assign({}, DEFAULTS, opts || {});
    this.teams = hub.teams;
    this.byAbbr = {};
    var self = this;
    hub.teams.forEach(function (t) { self.byAbbr[t.abbr] = t; });
    this.players = hub.players;
    this.byId = {};
    hub.players.forEach(function (p) { self.byId[p.id] = p; });
    this.resigned = {};
    this.fa = fa || { classes: {} };
    this.market = marketRead(this.fa, this.season, this.cfg);
    if (this.market && this.market.dpw && !(opts && opts.dpw)) this.cfg.dpw = this.market.dpw;
    this._cache = {};
  }

  Hub.prototype.set = function (k, v) { this.cfg[k] = v; this._cache = {}; };
  Hub.prototype.toggleResign = function (id) {
    if (this.resigned[id]) delete this.resigned[id]; else this.resigned[id] = 1;
    this._cache = {};
  };
  Hub.prototype.org = function (abbr) { return this.players.filter(function (p) { return p.t === abbr; }); };

  // The first season, straight from RosterResource and Depth Charts
  Hub.prototype.firstSeason = function (abbr) {
    var org = this.org(abbr), season = this.season;
    var line = {}, bench = [], rot = [], pen = [], il = [];
    org.forEach(function (p) {
      var war = p.pj && p.pj.war != null ? p.pj.war : 0, e = { p: p, war: war, rate: p.rate || 0, kind: "" };
      if (p.g === "sl") line[p.pos === "DH" ? "DH" : p.pos] = line[p.pos === "DH" ? "DH" : p.pos] || e;
      else if (p.g === "bn") bench.push(e);
      else if (p.g === "sp") rot.push(e);
      else if (p.g === "bp") pen.push(e);
      else if (p.g === "il") il.push(e);
    });
    rot.sort(function (a, b) { return (a.p.role || "").localeCompare(b.p.role || ""); });
    var order = { CL: 0, SU8: 1, SU7: 2, MID: 3, LR: 4 };
    pen.sort(function (a, b) { return (order[a.p.role] == null ? 5 : order[a.p.role]) - (order[b.p.role] == null ? 5 : order[b.p.role]) || b.war - a.war; });
    // team WAR: every projected player in the organization (Depth Charts spreads playing time down to the minors)
    var bat = 0, pit = 0;
    org.forEach(function (p) {
      if (p.pjs !== "dc" || !p.pj) return;
      if (p.p) pit += p.pj.war || 0; else bat += p.pj.war || 0;
    });
    var holes = [];
    FIELD_ORDER.forEach(function (s) { if (!line[s]) holes.push(s); });
    return { year: season, abbr: abbr, line: line, bench: bench, rot: rot, pen: pen, il: il, bat: bat, pit: pit,
      war: bat + pit, holes: holes, arrivals: [], departures: [], first: true };
  };

  // A later season, built from contracts, control, aging and the farm
  Hub.prototype.laterSeason = function (abbr, year) {
    var self = this, season = this.season, cfg = this.cfg;
    var pool = [], departures = [], arrivals = [];
    this.org(abbr).forEach(function (p) {
      if (retires(p, year, season)) return;
      var t = yearTerms(p, year, season, cfg, self.resigned[p.id]);
      var tPrev = year - 1 === season ? { on: p.g !== "min" } : yearTerms(p, year - 1, season, cfg, self.resigned[p.id]);
      if (!t.on) {
        if (tPrev.on && t.kind !== "Minors") departures.push({ p: p, kind: t.kind, war: warAt(p, year, season) });
        return;
      }
      var rate = rateAt(p, year, season);
      var e = { p: p, rate: rate, kind: t.kind, salary: t.salary };
      if (p.g === "min" && arrival(p, season) === year) e.debut = true;
      pool.push(e);
    });
    var hitters = pool.filter(function (e) { return !e.p.p; }).sort(function (a, b) { return b.rate - a.rate; });
    var pitchers = pool.filter(function (e) { return e.p.p; });
    var line = {}, used = {};
    SLOTS.forEach(function (slot) {
      for (var i = 0; i < hitters.length; i++) {
        var e = hitters[i];
        if (used[e.p.id] || !canPlay(e.p, slot)) continue;
        // a minor leaguer only takes a job he's ready for: above replacement
        if (e.p.g === "min" && e.rate < 0.5) continue;
        used[e.p.id] = 1;
        line[slot] = Object.assign({}, e, { war: e.rate * LINE_PT });
        return;
      }
    });
    var bench = hitters.filter(function (e) { return !used[e.p.id] && !(e.p.g === "min" && e.rate < 0.3); }).slice(0, 4)
      .map(function (e, i) { used[e.p.id] = 1; return Object.assign({}, e, { war: e.rate * BENCH_PT[i] }); });
    // pitchers: starters by their starter rate; relievers from everyone left (a starter in relief at 40%)
    var spRate = function (e) { return isReliever(e.p) ? -9 : e.rate; };
    var rpRate = function (e) { return isReliever(e.p) ? e.rate : e.rate * 0.4; };
    var rot = pitchers.filter(function (e) { return !isReliever(e.p) && !(e.p.g === "min" && e.rate < 0.8); })
      .sort(function (a, b) { return spRate(b) - spRate(a); }).slice(0, 5)
      .map(function (e, i) { used[e.p.id] = 1; return Object.assign({}, e, { war: e.rate * SP_PT[i] }); });
    var pen = pitchers.filter(function (e) { return !used[e.p.id] && !(e.p.g === "min" && rpRate(e) < 0.2); })
      .sort(function (a, b) { return rpRate(b) - rpRate(a); }).slice(0, 8)
      .map(function (e, i) { used[e.p.id] = 1; return Object.assign({}, e, { war: rpRate(e) * RP_PT[i] }); });
    var holes = [], fillBat = 0, fillPit = 0;
    FIELD_ORDER.forEach(function (s) {
      if (!line[s]) { holes.push(s); if (cfg.fill) fillBat += cfg.fillWar.bat * LINE_PT; }
    });
    for (var i = rot.length; i < 5; i++) { holes.push("SP" + (i + 1)); if (cfg.fill) fillPit += cfg.fillWar.sp * SP_PT[i]; }
    for (var j = pen.length; j < 8; j++) { holes.push("RP" + (j + 1)); if (cfg.fill) fillPit += cfg.fillWar.rp * RP_PT[j]; }
    var sum = function (a) { return a.reduce(function (s, e) { return s + e.war; }, 0); };
    var bat = Object.keys(line).reduce(function (s, k) { return s + line[k].war; }, 0) + sum(bench) + fillBat;
    var pit = sum(rot) + sum(pen) + fillPit;
    var placed = {};
    Object.keys(line).forEach(function (k) { placed[line[k].p.id] = line[k]; });
    bench.concat(rot, pen).forEach(function (e) { placed[e.p.id] = e; });
    pool.forEach(function (e) { if (e.debut && placed[e.p.id]) arrivals.push(placed[e.p.id]); });
    arrivals.sort(function (a, b) { return b.war - a.war; });
    departures.sort(function (a, b) { return b.war - a.war; });
    return { year: year, abbr: abbr, line: line, bench: bench, rot: rot, pen: pen, il: [], bat: bat, pit: pit,
      war: bat + pit, holes: holes, arrivals: arrivals, departures: departures, first: false };
  };

  Hub.prototype.team = function (abbr, year) {
    var key = abbr + year;
    if (!this._cache[key]) this._cache[key] = year === this.season ? this.firstSeason(abbr) : this.laterSeason(abbr, year);
    return this._cache[key];
  };

  // The engine's read of the first season, used to keep later seasons on Depth Charts' scale
  Hub.prototype.calibration = function () {
    if (this._cal) return this._cal;
    var self = this, dc = [], eng = [];
    this.teams.forEach(function (t) {
      dc.push(self.team(t.abbr, self.season).war);
      eng.push(self.laterSeasonAt(t.abbr, self.season).war);
    });
    var md = mean(dc), me = mean(eng), num = 0, den = 0;
    for (var i = 0; i < dc.length; i++) { num += (eng[i] - me) * (dc[i] - md); den += (eng[i] - me) * (eng[i] - me); }
    var off = {};
    this.teams.forEach(function (t, i) { off[t.abbr] = dc[i] - (md + (den ? num / den : 1) * (eng[i] - me)); });
    this._cal = { slope: den ? Math.max(0.5, Math.min(1.5, num / den)) : 1, offset: off };
    return this._cal;
  };
  // the later-season engine run on the first season (every current player on hand)
  Hub.prototype.laterSeasonAt = function (abbr, year) {
    var saved = this.cfg.fill; this.cfg.fill = true;
    var r = this.laterSeason(abbr, year);
    this.cfg.fill = saved;
    return r;
  };

  Hub.prototype.standings = function (year) {
    var key = "st" + year + (this.cfg.fill ? "f" : "");
    if (this._cache[key]) return this._cache[key];
    var self = this, rows = this.teams.map(function (t) {
      var tm = self.team(t.abbr, year);
      return { t: t, tm: tm, war: tm.war, bat: tm.bat, pit: tm.pit };
    });
    var m = mean(rows.map(function (r) { return r.war; }));
    var cal = year === this.season ? null : this.calibration();
    rows.forEach(function (r) {
      var adj = r.war - m;
      if (cal) adj = cal.slope * adj + cal.offset[r.t.abbr] * Math.pow(0.5, year - self.season);
      r.wins = 81 + adj;
    });
    var m2 = mean(rows.map(function (r) { return r.wins; }));
    rows.forEach(function (r) {
      r.wins = Math.max(40, Math.min(122, r.wins - m2 + 81));
      r.losses = 162 - r.wins;
      // runs: the league's runs per team, moved about 10 runs per win of hitting or pitching WAR
      var lg = self.hub.rs && Object.keys(self.hub.rs).length ? mean(Object.values(self.hub.rs)) : 720;
      r.rs = lg + 10 * (r.bat - mean(rows.map(function (x) { return x.bat; })));
      r.ra = lg - 10 * (r.pit - mean(rows.map(function (x) { return x.pit; })));
    });
    var odds = simulate(rows.map(function (r) { return { abbr: r.t.abbr, lg: r.t.lg, div: r.t.div, wins: r.wins }; }), this.cfg.sims, year);
    rows.forEach(function (r) { Object.assign(r, odds[r.t.abbr]); });
    this._cache[key] = rows;
    return rows;
  };

  // ---------- playoff odds ----------

  function rng(seed) { // small seeded generator so the odds don't flicker between renders
    var s = seed >>> 0 || 1;
    return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  }
  function gauss(r) { var u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function log5(a, b) { return (a - a * b) / (a + b - 2 * a * b); }
  function seriesWin(p, n) { // chance to win a best-of-n against a single-game chance p
    var need = (n + 1) / 2, q = 1 - p, tot = 0;
    for (var l = 0; l < need; l++) tot += comb(need - 1 + l, l) * Math.pow(p, need) * Math.pow(q, l);
    return tot;
  }
  function comb(n, k) { var c = 1; for (var i = 1; i <= k; i++) c = c * (n - k + i) / i; return c; }

  function simulate(teams, n, seed) {
    var r = rng(9301 + (seed || 0) * 7), out = {};
    teams.forEach(function (t) { out[t.abbr] = { playoff: 0, div: 0, ws: 0, pennant: 0 }; });
    for (var s = 0; s < n; s++) {
      var res = teams.map(function (t) {
        var talent = t.wins / 162 + 0.025 * gauss(r);
        talent = Math.max(0.25, Math.min(0.75, talent));
        var w = 162 * talent + Math.sqrt(162 * talent * (1 - talent)) * gauss(r);
        return { t: t, w: w + r() * 1e-3, talent: talent };
      });
      var champs = {};
      ["AL", "NL"].forEach(function (lg) {
        var L = res.filter(function (x) { return x.t.lg === lg; });
        var divs = {};
        L.forEach(function (x) { (divs[x.t.div] = divs[x.t.div] || []).push(x); });
        var winners = Object.keys(divs).map(function (d) { return divs[d].sort(function (a, b) { return b.w - a.w; })[0]; })
          .sort(function (a, b) { return b.w - a.w; });
        var wc = L.filter(function (x) { return winners.indexOf(x) < 0; }).sort(function (a, b) { return b.w - a.w; }).slice(0, 3);
        winners.forEach(function (x) { out[x.t.abbr].div++; });
        winners.concat(wc).forEach(function (x) { out[x.t.abbr].playoff++; });
        var seeds = winners.concat(wc); // 1-3 division winners, 4-6 wild cards
        var play = function (a, b, games) { return r() < seriesWin(log5(a.talent, b.talent), games) ? a : b; };
        var w36 = play(seeds[2], seeds[5], 3), w45 = play(seeds[3], seeds[4], 3);
        var ds1 = play(seeds[0], w45, 5), ds2 = play(seeds[1], w36, 5);
        champs[lg] = play(ds1, ds2, 7);
        out[champs[lg].t.abbr].pennant++;
      });
      var ws = r() < seriesWin(log5(champs.AL.talent, champs.NL.talent), 7) ? champs.AL : champs.NL;
      out[ws.t.abbr].ws++;
    }
    Object.keys(out).forEach(function (k) { var o = out[k]; o.playoff /= n; o.div /= n; o.ws /= n; o.pennant /= n; });
    return out;
  }

  // ---------- the free agent market ----------

  // WAR over a contract from a first-year projection, aged a year at a time
  function warPath(war, age, years, reliever) {
    var out = [], w = war, scale = reliever ? 0.4 : 1;
    for (var k = 0; k < years; k++) {
      if (k > 0) w += agingDelta(age + k) * scale;
      out.push(Math.max(-0.5, w));
    }
    return out;
  }
  function isRP(pos) { return /^RP|RHP-R|LHP-R|^CL/.test(String(pos || "")); }

  // Past classes only carry last season's WAR, not the projection at signing. The estimate is fit on this winter's
  // class, which has both: Steamer's projection against last season's WAR and age (least squares, hitters and
  // starters apart from relievers), so history is read the way Steamer reads players now.
  function fitProj(rows) {
    var fit = {};
    [false, true].forEach(function (rp) {
      var X = [], Y = [];
      rows.forEach(function (r) {
        if (r.wj == null || r.wp == null || r.age == null || isRP(r.pos) !== rp) return;
        X.push([r.wp, r.age - 30, 1]); Y.push(r.wj);
      });
      fit[rp ? "rp" : "bat"] = X.length >= 15 ? lsq(X, Y) : (rp ? [0.45, -0.02, 0.15] : [0.5, -0.06, 0.55]);
    });
    return fit;
  }
  function lsq(X, Y) { // normal equations for three coefficients
    var A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
    X.forEach(function (x, n) { for (var i = 0; i < 3; i++) { b[i] += x[i] * Y[n]; for (var j = 0; j < 3; j++) A[i][j] += x[i] * x[j]; } });
    for (var c = 0; c < 3; c++) { // Gauss-Jordan
      var piv = c;
      for (var r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      var t = A[c]; A[c] = A[piv]; A[piv] = t; var tb = b[c]; b[c] = b[piv]; b[piv] = tb;
      if (Math.abs(A[c][c]) < 1e-9) return [0.5, -0.05, 0.5];
      for (var r2 = 0; r2 < 3; r2++) {
        if (r2 === c) continue;
        var f = A[r2][c] / A[c][c];
        for (var k = c; k < 3; k++) A[r2][k] -= f * A[c][k];
        b[r2] -= f * b[c];
      }
    }
    return [b[0] / A[0][0], b[1] / A[1][1], b[2] / A[2][2]];
  }
  function faProj(r, fit) {
    if (r.wj != null) return r.wj;
    if (r.wp == null) return null;
    var k = fit[isRP(r.pos) ? "rp" : "bat"];
    return k[0] * r.wp + k[1] * ((r.age || 30) - 30) + k[2];
  }

  // Reads the market price of a win from each past class (every deal for a player projected at 1+ WAR, $3M or
  // more: total dollars over the WAR it should buy, aged and inflated), then measures how far each kind of deal
  // lands from that price, by length, age, projection, role and qualifying offer.
  function marketRead(fa, season, cfg) {
    var classes = fa && fa.classes ? fa.classes : {}, years = Object.keys(classes).map(Number).sort();
    var past = years.filter(function (y) { return y < season; });
    if (!past.length) return null;
    var fit = fitProj(classes[season] || []);
    var spot = {}, deals = [];
    past.forEach(function (y) {
      var num = 0, den = 0;
      classes[y].forEach(function (r) {
        var wj = faProj(r, fit);
        if (!r.aav || !r.yrs || wj == null || wj < 1 || r.age == null || r.aav * r.yrs < 3e6) return;
        if (r.ctype && /Arbitration|Extension|Pre|Minor/i.test(r.ctype)) return;
        var path = warPath(wj, r.age, r.yrs, isRP(r.pos)), infl = 0;
        for (var k = 0; k < path.length; k++) infl += path[k] * Math.pow(1 + cfg.inflation, k);
        var d = { y: y, r: r, wj: wj, path: path, wInfl: infl, total: r.aav * r.yrs / 1e6 };
        deals.push(d);
        num += d.total; den += infl;
      });
      if (den > 3) spot[y] = num / den;
    });
    var spotYears = Object.keys(spot).map(Number).sort();
    if (!spotYears.length) return null;
    // this winter's price. Best read: Steamer's projections for this class against the crowd's predicted contracts,
    // corrected by how far past crowds landed from what players actually signed for. Fallback: the last three
    // classes carried forward with inflation.
    var act = 0, crowd = 0, byClass = {};
    past.forEach(function (y) {
      var ya = 0, yc = 0;
      classes[y].forEach(function (r) {
        if (!r.aav || !r.yrs || !r.ma || !r.my || r.aav * r.yrs < 3e6) return;
        ya += r.aav * r.yrs; yc += r.ma * r.my;
      });
      if (yc > 0) { byClass[y] = ya / yc; act += ya; crowd += yc; }
    });
    var crowdErr = crowd ? act / crowd : 1, cn = 0, cd = 0, ck = 0;
    (classes[season] || []).forEach(function (r) {
      if (r.wj == null || r.wj < 1 || !r.ma || !r.my || r.age == null) return;
      var path = warPath(r.wj, r.age, r.my, isRP(r.pos)), w = 0;
      for (var k = 0; k < path.length; k++) w += path[k] * Math.pow(1 + cfg.inflation, k);
      cn += r.ma * r.my / 1e6; cd += w; ck++;
    });
    var dpw, how;
    if (ck >= 20 && cd > 0) { dpw = cn / cd * crowdErr; how = "crowd"; }
    else {
      var wsum = 0, psum = 0;
      spotYears.slice(-3).forEach(function (y, i) { psum += (i + 1) * spot[y] * Math.pow(1 + cfg.inflation, season - y); wsum += i + 1; });
      dpw = psum / wsum; how = "history";
    }
    deals.forEach(function (d) {
      var s = spot[d.y] || dpw / Math.pow(1 + cfg.inflation, season - d.y);
      d.model = s * d.wInfl;
      d.prem = d.model > 0 ? d.total / d.model - 1 : null;
    });
    var good = deals.filter(function (d) { return d.prem != null && d.model > 2; });
    var bucket = function (label, fn) {
      var g = {};
      good.forEach(function (d) {
        var k = fn(d);
        if (k == null) return;
        (g[k] = g[k] || { k: k, n: 0, paid: 0, model: 0 });
        g[k].n++; g[k].paid += d.total; g[k].model += d.model;
      });
      return { label: label, rows: Object.keys(g).map(function (k) { var x = g[k]; x.prem = x.paid / x.model - 1; return x; }) };
    };
    var lenK = function (d) { var y = d.r.yrs; return y === 1 ? "1 year" : y <= 3 ? "2-3 years" : y <= 5 ? "4-5 years" : "6+ years"; };
    var ageK = function (d) { var a = d.r.age; return a <= 28 ? "28 and under" : a <= 31 ? "29-31" : a <= 34 ? "32-34" : "35+"; };
    var roleK = function (d) { var p = String(d.r.pos || ""); return isRP(p) ? "Relievers" : /SP|P$/.test(p) ? "Starters" : "Hitters"; };
    var qoK = function (d) { return d.r.qo ? "Turned down a QO" : "No QO"; };
    var tiers = function (d) { var w = d.wj; return w >= 4 ? "4+ WAR" : w >= 2.5 ? "2.5-4 WAR" : w >= 1.5 ? "1.5-2.5 WAR" : "Under 1.5 WAR"; };
    var order = { "1 year": 0, "2-3 years": 1, "4-5 years": 2, "6+ years": 3, "28 and under": 0, "29-31": 1, "32-34": 2, "35+": 3,
      "Hitters": 0, "Starters": 1, "Relievers": 2, "No QO": 0, "Turned down a QO": 1, "Under 1.5 WAR": 0, "1.5-2.5 WAR": 1, "2.5-4 WAR": 2, "4+ WAR": 3 };
    var buckets = [bucket("Contract length", lenK), bucket("Age at signing", ageK), bucket("Projected WAR", tiers),
      bucket("Role", roleK), bucket("Qualifying offer", qoK)];
    buckets.forEach(function (b) { b.rows.sort(function (a, c) { return order[a.k] - order[c.k]; }); });
    var allPaid = 0, allModel = 0;
    good.forEach(function (d) { allPaid += d.total; allModel += d.model; });
    return { dpw: dpw, how: how, crowdDpw: cd ? cn / cd : null, crowdN: ck, crowdErr: crowdErr, crowdByClass: byClass,
      spot: spot, deals: good, buckets: buckets, fit: fit, overall: allModel ? allPaid / allModel - 1 : 0,
      lenPrem: function (yrs) {
        var b = buckets[0].rows, k = yrs === 1 ? "1 year" : yrs <= 3 ? "2-3 years" : yrs <= 5 ? "4-5 years" : "6+ years";
        for (var i = 0; i < b.length; i++) if (b[i].k === k && b[i].n >= 4) return b[i].prem;
        return 0;
      } };
  }

  // This winter's free agents: what the model says each is worth over the crowd's contract length
  Hub.prototype.faBoard = function () {
    var cls = (this.fa.classes || {})[this.season] || [], self = this, cfg = this.cfg, mk = this.market;
    return cls.map(function (r) {
      var p = r.id ? self.byId[r.id] : null;
      var war = r.wj != null ? r.wj : p && p.pj ? p.pj.war : null;
      var yrs = r.yrs || r.my || (war >= 3 ? 4 : war >= 1.5 ? 2 : 1);
      var age = r.age || (p ? seasonAge(p, self.season, self.season) : 30);
      var path = war == null ? [] : warPath(war, age, yrs, isRP(r.pos)), val = 0;
      for (var k = 0; k < path.length; k++) val += path[k] * dpwAt(cfg, self.season + k, self.season);
      var spotAav = yrs ? Math.max(cfg.minSalary, val / yrs) : null;
      var mktAav = spotAav != null && mk ? spotAav * (1 + mk.lenPrem(yrs)) : spotAav;
      return { r: r, p: p, war: war, yrs: yrs, age: age, path: path, value: val, spotAav: spotAav, mktAav: mktAav,
        crowdAav: r.ma ? r.ma / 1e6 : null, signedAav: r.aav ? r.aav / 1e6 : null,
        gap: r.aav && mktAav ? (r.aav / 1e6) / mktAav - 1 : null };
    }).filter(function (x) { return x.war != null; }).sort(function (a, b) { return b.value - a.value; });
  };

  Hub.prototype.surplus = function (p) { return surplus(p, this.cfg, this.season, this.resigned[p.id]); };
  Hub.prototype.terms = function (p, year) { return yearTerms(p, year, this.season, this.cfg, this.resigned[p.id]); };
  Hub.prototype.rateAt = function (p, year) { return rateAt(p, year, this.season); };
  Hub.prototype.warAt = function (p, year) { return warAt(p, year, this.season); };
  Hub.prototype.ageAt = function (p, year) { return seasonAge(p, year, this.season); };
  Hub.prototype.arrival = function (p) { return arrival(p, this.season); };
  Hub.prototype.payroll = function (abbr, year) {
    var self = this, tot = 0;
    this.org(abbr).forEach(function (p) {
      var t = self.terms(p, year);
      if (t.on || t.option) tot += t.salary || 0;
    });
    return tot;
  };

  // Tiers for a spot: where this team's WAR there ranks among all 30 in the same season
  Hub.prototype.tiers = function (year) {
    var key = "tiers" + year;
    if (this._cache[key]) return this._cache[key];
    var self = this, spots = {};
    this.teams.forEach(function (t) {
      var tm = self.team(t.abbr, year);
      var add = function (k, v) { (spots[k] = spots[k] || []).push(v); };
      FIELD_ORDER.forEach(function (s) { add(s, tm.line[s] ? tm.line[s].war : 0); });
      add("SP", tm.rot.reduce(function (a, e) { return a + e.war; }, 0));
      add("RP", tm.pen.reduce(function (a, e) { return a + e.war; }, 0));
      add("bat", tm.bat); add("pit", tm.pit);
    });
    Object.keys(spots).forEach(function (k) { spots[k].sort(function (a, b) { return a - b; }); });
    this._cache[key] = spots;
    return spots;
  };
  Hub.prototype.tier = function (year, spot, war) {
    var list = this.tiers(year)[spot] || [];
    if (!list.length) return "Average";
    var below = 0;
    for (var i = 0; i < list.length; i++) if (list[i] < war - 1e-9) below++;
    var pct = below / list.length;
    return pct < 0.15 ? "Fringe" : pct < 0.35 ? "Weak" : pct < 0.68 ? "Average" : pct < 0.88 ? "Strong" : "Elite";
  };
  Hub.prototype.rank = function (year, spot, war) {
    var list = this.tiers(year)[spot] || [];
    var above = 0;
    for (var i = 0; i < list.length; i++) if (list[i] > war + 1e-9) above++;
    return above + 1;
  };

  function mean(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : 0; }

  var api = { Hub: Hub, DEFAULTS: DEFAULTS, tierMult: tierMult, agingDelta: agingDelta, fvWar: fvWar, rateAt: rateAt, warAt: warAt,
    yearTerms: yearTerms, controlStatus: controlStatus, surplus: surplus, simulate: simulate, seriesWin: seriesWin,
    marketRead: marketRead, warPath: warPath, canPlay: canPlay, FIELD_ORDER: FIELD_ORDER, arrival: arrival };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MLBModel = api;
})(typeof window !== "undefined" ? window : this);
