/* NBA Hub: the model. No DOM, no network: the page and the tests both load it.

   Everything is built on the shared NBA library (nba/lib): Banner 19's ratings, aging, contract value, cap rules and
   trade checks, and Hard Cap's contract merge. The league is assembled fresh on every load from feeds that already
   refresh every day:
     celtics/data.json      the cap sheet: every player's rating, health, contract and the CBA figures
     hardcap/stats.json     contracts (Basketball-Reference) and rosters, injuries, season BPM (twice a day)
     hardcap/contracts.json hand-checked contract fixes
     celtics/live.json      standings (every morning)
     draft/nba.json         the 2027 draft order, who owns each pick, every future pick owed, the consensus board
     nba/data/picks.json    what each draft slot is worth, from 2001-2018 drafts (tools/nba_pick_curve.py)

   Seasons are indexed from 2026-27 = 0, the same as the library. Money is whole dollars. */
(function (root) {
  "use strict";
  const req = (k, f) => root[k] || (typeof require !== "undefined" ? require(f) : null);
  const CBA = req("CBA", "./lib/cba.js");
  const Mo = req("Model", "./lib/model.js");
  const L = req("League", "./lib/league.js");
  if (typeof require !== "undefined" && !L.playoffs) { require("./lib/season.js"); require("./lib/offseason.js"); }
  const NC = req("NbaContracts", "./lib/contracts.js");

  const YEARS = 5;
  const sum = a => a.reduce((s, x) => s + x, 0);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const money = v => "$" + (v / 1e6).toFixed(1) + "M";
  // The draft board and the team file use ESPN-style codes for three teams
  const CODE = { BKN: "BRK", CHA: "CHO", PHX: "PHO" };
  const fix = c => CODE[c] || c;

  const DEFAULTS = {
    sims: 1000,          // simulated rest-of-seasons for this season's odds
    futureSims: 400,     // quick simulated seasons for later years
    disc: 0,             // yearly discount on surplus. Off by default so values and contracts read in real dollars (set it on
                         // the page, 7% is about the cap's growth, to see today's cap dollars)
    anchor: "market",    // price of production: "market" (what teams pay players the max doesn't hold down) or "payroll"
    mode: "prod",        // "prod": what he should produce; "market": what teams would pay him
    fill: true,          // teams fill open roster spots with free agents they can afford
    blend: 2500,         // minutes of this season's BPM it takes to move a rating halfway
    growth: 0.5,         // share of a young player's projected improvement that counts in his value
    lean: 1,             // how strongly a team's situation tilts values (age, picks, this season for rebuilders); 0 = no tilt
    salW: 0.5,           // what a dollar of salary costs a team in value. Teams must spend to the salary floor and unused
                         // cap room disappears, so salary isn't a dollar-for-dollar cost; treating recent trades (2025-26
                         // deadline, 2026 summer) as fair puts it at about a quarter to a half. 1.0 is face value.
    convex: 2,           // production = minutes x (impact above replacement) ^ convex (2: stars the max holds down come out ahead of it, as they should)
    blendRookie: 1000,   // a first- or second-year player's rating is mostly a draft-slot guess, so his play moves it faster
  };

  function build(inp, opts) {
    const cfg = Object.assign({}, DEFAULTS, opts || {});
    const data = inp.data, stats = inp.stats || {}, live = inp.live || null, board = inp.board || {};
    const curve = (inp.picks && inp.picks.curve) || [];
    CBA.init(data.cba);

    // ---------- The league today ----------
    const nba = NC.latestContracts(data, stats, inp.fixes || null);
    const idx = NC.rosterIndex(stats);
    const players = [];
    const injured = {};
    // What an injury report means for this season: the feed gives a status (Out, Day-To-Day) and the latest news line.
    // A torn Achilles or ACL, or a note that says so, is out for the season; "four weeks", "re-evaluated in four
    // months" and the like give a return date from the note's date. A bare "Out" with no timeline gets a week.
    const SEASON_END = "2027-04-11";
    const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
    const readInjury = inj => {
      const st = inj[0] || "", note = inj[1] || "", date = inj[2] || null, out = { st, note, date, season: false, back: null };
      if (/out for the (rest of the )?season|season-ending|remainder of the season|miss the (entire |rest of the |20\d\d-\d\d )?season|torn (right |left )?(achilles|acl)|(achilles|acl) (tear|rupture|surgery|reconstruction)|stepping away from basketball|step away from basketball|announced (his|her) retirement/i.test(note)) { out.season = true; return out; }
      const n = x => (/^\d+$/.test(x) ? +x : NUM[String(x).toLowerCase()] || 0);
      let wk = 0, m;
      if ((m = /(\w+)\s*(?:to|-)\s*(\w+)\s+(weeks|months)/i.exec(note))) wk = (n(m[1]) + n(m[2])) / 2 * (/month/i.test(m[3]) ? 4.3 : 1);
      else if ((m = /(?:at least|approximately|about|another|re-evaluated in|for)\s+(?:approximately |about |another )?(\w+)\s+(weeks?|months?)/i.exec(note))) wk = n(m[1]) * (/month/i.test(m[2]) ? 4.3 : 1);
      else if (/\bmonths\b/i.test(note)) wk = 13;                     // "will miss months"
      else if (/^out$/i.test(st)) wk = 1;
      if (wk > 0 && date) { const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + Math.round(wk * 7)); out.back = d.toISOString().slice(0, 10); if (out.back >= SEASON_END) { out.season = true; out.back = null; } }
      return out;
    };
    // the share of what's left of this season he'll miss
    const outShare = p => {
      const j = p.injury; if (!j) return 0; if (j.season) return 1;
      const day = x => new Date(x + "T12:00:00Z").getTime(), left = day(SEASON_END) - day(asOf);
      // still listed as out past the note's timeline: another week
      let back = j.back && j.back > asOf ? day(j.back) : /^out$/i.test(j.st) ? day(asOf) + 7 * 864e5 : 0;
      return back && left > 0 ? clamp((back - day(asOf)) / left, 0, 1) : 0;
    };
    const seenName = new Set();
    // DARKO, pulled daily from darko.app: half of every cap-sheet rating is DARKO as of June 3, so swap in today's
    const slug = (n) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    // both spellings of an apostrophe name: "deaaron-fox" and "de-aaron-fox" (the cap sheet's)
    const keysOf = (n) => [...new Set([NC.nameKeys(slug(n))[0], NC.nameKeys(slug(n.replace(/['’]/g, " ")))[0]])];
    const dk = inp.darko && inp.darko.p ? {} : null, dkJune = {};
    if (dk) {
      for (const r of inp.darko.p) for (const k of keysOf(r[0])) dk[k] = dk[k] ? "?" : r;
      for (const [n, v] of Object.entries(inp.darko.june || {})) for (const k of keysOf(n)) dkJune[k] = v;
    }
    const DARKO_W = 0.5;
    for (const p0 of nba.players) {
      // the same player under two spellings ("a-j-green" on the cap sheet, "aj-green" in a hand fix): keep the first
      const nk = NC.nameKeys(p0.id)[0] + "|" + p0.t;
      if (seenName.has(nk)) continue;
      seenName.add(nk);
      const p = JSON.parse(JSON.stringify(p0));
      if (!p.c || !p.c.sal) p.c = { sal: [0, 0, 0, 0, 0], opt: {} };
      const now = NC.nbaTeam(p, idx);
      if (now) p.t = now;
      const recent = stats.wk ? Object.keys(stats.wk).map(Number).sort((a, b) => b - a).slice(0, 2).some(w => stats.wk[w][p.id]) : false;
      if ((now === null && !recent) || p.noDeal) continue;            // off every roster: not part of the league now
      if (p.deal) p.two = true;                                       // two-way and 10-day deals aren't standard spots
      if (p.limbo) p.two = true;                                      // his contract row is dead money; he plays on a two-way
      const r = stats.rosters && (stats.rosters[p.id] || stats.rosters[NC.nameKeys(p.id)[0]]);
      if (r && r[3]) p.espn = +r[3];
      if (p.c.opt) delete p.c.opt[0];                                 // this season's calls are made: he's on the roster
      if (p.o == null) { p.o = -1.6; p.d = -0.4; }
      if (p.yos == null) p.yos = 1;
      p.o0 = p.o; p.d0 = p.d;
      // Today's DARKO in place of June's (DARKO already folds in this season's games). A player DARKO didn't rate
      // in June (this year's rookies) moves halfway from his draft-slot guess to DARKO's number.
      const inj0 = stats.inj && stats.inj[p.id];
      const out0 = inj0 && readInjury(inj0).season;
      const dr = dk && dk[NC.nameKeys(p.id)[0]];
      if (dr && dr !== "?" && !out0) {                              // DARKO shrinks players who sit; leave the season-long injured be
        const jn = dkJune[NC.nameKeys(p.id)[0]];
        if (jn) { p.o += DARKO_W * (dr[2] - jn[0]); p.d += DARKO_W * (dr[3] - jn[1]); }
        else { p.o += DARKO_W * (dr[2] - p.o); p.d += DARKO_W * (dr[3] - p.d); }
        p.o = +p.o.toFixed(2); p.d = +p.d.toFixed(2);
        p.darko = +(dr[2] + dr[3]).toFixed(1);
      }
      // This season so far: Basketball-Reference's BPM, faded in by minutes played. With today's DARKO in, the box
      // score only moves the other half of the rating (RAPM, CraftedNBA, last year's box score), so it counts half.
      const v = stats.vorp && (stats.vorp[p.id] || stats.vorp[NC.nameKeys(p.id)[0]]);
      const a = stats.avg && stats.avg[String(2027)] && stats.avg[String(2027)][p.id];
      const mins = a ? a[0] * a[1] : 0;
      if (v && mins > 0) {
        const w = (p.darko != null ? 1 - DARKO_W : 1) * mins / (mins + ((p.yos ?? 3) <= 1 ? cfg.blendRookie : cfg.blend));
        const shift = w * (v[1] - (p.o + p.d));
        p.o = +(p.o + shift * 0.6).toFixed(2); p.d = +(p.d + shift * 0.4).toFixed(2);
        p.form = +shift.toFixed(2); p.bpm = v[1]; p.vorp = v[0];
      }
      if (a) p.line = { gp: a[0], min: a[1], pts: a[7], reb: a[8], ast: a[10] };
      const inj = stats.inj && stats.inj[p.id];
      if (inj) {
        p.inj = inj[0];
        p.injury = readInjury(inj);
        if (p.injury.season) injured[p.id] = true;
      }
      players.push(p);
    }
    // Availability. The cap sheet's health is last season's share of games played, so one long, one-off injury (a
    // torn Achilles) read as a player who'll always miss that much. One season says only so much about the next
    // (about 40% carries over), so shrink it toward a typical 85%, then add this season's games played out of his
    // team's games, with the history worth two seasons, so a short early injury barely moves it.
    const teamG = {};
    for (const p of players) if (p.line) teamG[p.t] = Math.max(teamG[p.t] || 0, p.line.gp);
    for (const p of players) {
      const h0 = 0.85 + 0.4 * ((p.h ?? 0.85) - 0.85), G = teamG[p.t] || 0, gp = Math.min(G, p.line ? p.line.gp : 0);
      p.h0 = p.h ?? 0.85;
      p.h = +clamp(G ? (h0 * 160 + gp) / (160 + G) : h0, 0.4, 0.96).toFixed(3);
    }
    // Over 15 standard contracts: anyone whose contract row sits with another team is playing on a two-way or 10-day
    // deal here while his old team pays off the rest (a waived player catching on), so he doesn't take a spot
    const count = {};
    for (const p of players) if (!p.two && p.c.sal[0]) count[p.t] = (count[p.t] || 0) + 1;
    for (const p of players) {
      const bb = stats.contracts && stats.contracts[p.id];
      const rows = bb ? [bb.slice(0, 3), ...bb.slice(3)] : [];
      if (p.two || !rows.length || rows.some(r => r[0] === p.t)) continue;
      // His only contract is an old team's option for this season, and he's playing somewhere else: the option was
      // declined, so nobody owes it, and he's here on a new deal the feeds don't price yet (two-way or camp deal)
      const declined = rows.every(r => r[2] && r[2]["0"] === "TO");
      if (declined) { p.two = true; p.declinedBy = rows[0][0]; p.c = { sal: [0, 0, 0, 0, 0], opt: {} }; count[p.t]--; continue; }
      if (count[p.t] > 15) { p.two = true; p.deadElsewhere = rows[0][0]; count[p.t]--; }
    }
    // Banner 19's world, set to today: real records, this season's remaining schedule, the real pick ledger
    const asOf = (live && live.updated ? live.updated : stats.updated || "2026-11-09").slice(0, 10);
    const W = L.newWorld(Object.assign({}, data, { players }), live ? Object.assign({}, live, { players: null }) : null, 19);
    W.phase = "reg"; W.date = asOf; W.deadline = "2027-02-11";     // the 2026-27 trade deadline (Feb. 11, 3 p.m. ET)
    for (const p of Object.values(W.P)) if (!p.c.sal.length) p.c.sal = [0, 0, 0, 0, 0];
    // a player acquired by trade can't be combined with other salaries for two months (from the daily roster changes)
    if (inp.moves && inp.moves.moves) for (const m of inp.moves.moves) {
      if (m.kind === "sign") continue;                     // the two-month wait is for players acquired by trade
      const p = W.P[m.id] || W.P[Object.keys(W.P).find(k => NC.nameKeys(k)[0] === NC.nameKeys(m.id)[0])];
      if (!p || p.t !== m.to) continue;
      const d = new Date(m.date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 60);
      const until = d.toISOString().slice(0, 10);
      if (until > asOf) { p.aggOk = until; p.joined = m.date; }
    }
    // free agents signed this summer can't be traded until Dec. 15 (rookie-scale signings excepted)
    for (const p of Object.values(W.P)) if (p.c && p.c.signed === 0 && !(p.c.rk && p.c.rk[1] > 0) && asOf < "2026-12-15") p.tradeOk = "2026-12-15";
    // The real tax history (the world starts with a rough one): who finished over the line in each of the last five seasons
    if (inp.taxhist && inp.taxhist.paid) {
      for (const c of Object.keys(W.T)) {
        W.T[c].taxHist = {};
        for (const [k, list] of Object.entries(inp.taxhist.paid)) W.T[c].taxHist[k] = list.includes(c);
      }
    }
    const rec = L.liveStart(W);
    L.newSchedule(W, rec);
    const played = rec ? sum(Object.values(rec).map(x => x.w + x.l)) / 30 : 0;
    const frac0 = clamp((82 - played) / 82, 0, 1);                 // share of this season still to play
    const codes = Object.keys(W.T);
    const teamInfo = {};
    const brand = (inp.teams && inp.teams.nba) || {};
    for (const c of codes) {
      const raw = Object.entries(brand).find(([k]) => fix(k) === c);
      const b = raw ? raw[1] : {};
      teamInfo[c] = { code: c, name: W.T[c].name, short: b.name || W.T[c].name.split(" ").pop(), city: b.city || "", conf: W.T[c].conf,
        color: (b.c && b.c[0]) || "#33415c", color2: (b.c && b.c[1]) || "#888", espn: b.espn || c.toLowerCase(), w: W.T[c].w, l: W.T[c].l };
    }
    // Pick ledger: 2027 from the current draft order (who owns each team's pick), 2028-33 from every future pick owed
    setPicks(W, board, codes);
    // Denver owes Oklahoma City two firsts that hang together: the 2027 pick (top-5 protected, rolling to 2028 and 2029)
    // and a second one two years after the first conveys (2029 if the 2027 pick goes, 2030 if it rolls to 2028)
    { const a = W.picks.find(x => x.id === "2027-1-DEN"), b = W.picks.find(x => x.id === "2029-1-DEN");
      if (a && a.owner === "OKC") a.note = "Top-5 protected (rolls to 2028, 2029)" + (a.note && !/protected/i.test(a.note) ? "; " + a.note : "");
      if (b && b.owner === "OKC") b.note = "Top-5 protected; the second of two Denver firsts to OKC, conveying two years after the 2027 pick does (2030 if that one rolls to 2028)"; }
    // a team can't reacquire by trade a player it traded away within the past year (nba/data/trades.json)
    if (inp.trades && inp.trades.trades) {
      const byKey = {}; for (const id of Object.keys(W.P)) byKey[NC.nameKeys(id)[0]] = id;
      const keyOf = n => [NC.nameKeys(slug(n))[0], NC.nameKeys(slug(n.replace(/['’]/g, " ")))[0]].map(k => byKey[k]).find(Boolean);
      for (const t of inp.trades.trades) for (const [n, from] of t.p) {
        if (!from) continue;
        const p = W.P[keyOf(n)];
        if (!p || p.t === from) continue;
        const d = new Date(t.date + "T12:00:00Z"); d.setUTCFullYear(d.getUTCFullYear() + 1);
        const until = d.toISOString().slice(0, 10);
        if (until > asOf) (p.noBack = p.noBack || []).push({ team: from, date: t.date, until });
      }
    }
    // and trades since, as the daily roster snapshot saw them (a player straight from one team to another)
    if (inp.moves && inp.moves.moves) for (const m of inp.moves.moves) {
      if (m.kind !== "trade" || !m.from || m.from === "FA") continue;
      const p = W.P[m.id] || W.P[Object.keys(W.P).find(k => NC.nameKeys(k)[0] === NC.nameKeys(m.id)[0])];
      if (!p || p.t === m.from || (p.noBack || []).some(x => x.team === m.from && x.date >= m.date)) continue;
      const d = new Date(m.date + "T12:00:00Z"); d.setUTCFullYear(d.getUTCFullYear() + 1);
      const until = d.toISOString().slice(0, 10);
      if (until > asOf) (p.noBack = p.noBack || []).push({ team: m.from, date: m.date, until });
    }
    // Stepien worst case: a protected first that rolls over can convey in a later year instead, so the team can't count
    // on owning its own first in those years either ("Lottery protected; unprotected in 2028")
    const ruleNotes = {};   // the draft board's pick rules carry rollover notes the picks file sometimes doesn't
    for (const x of ((((inp.board || {}).rules || {}).first) || [])) if (x.orig && x.note) ruleNotes[`${(inp.board.rules.year || 2027)}-1-${NC.teamCode ? NC.teamCode(x.orig) : x.orig}`] = x.note;
    for (const pk of W.picks) {
      if (pk.r !== 1 || pk.owner === pk.from) continue;
      const notes = [pk.note, ruleNotes[pk.id], ruleNotes[pk.id.replace(/PHO$/, "PHX").replace(/BRK$/, "BKN").replace(/CHO$/, "CHA")]].filter(Boolean).join(" ");
      if (!notes) continue;
      const yrs = []; let m;
      const re = /(?:unprotected in|rolls to)\s+([\d, and]+)/gi;
      while ((m = re.exec(notes))) for (const y of m[1].match(/\d{4}/g) || []) yrs.push(+y);
      for (const y of yrs) { const own = W.picks.find(x => x.r === 1 && x.from === pk.from && x.y === y); if (own) own.atRisk = pk.id; }
    }
    // second-apron penalty: a team's first seven years out is frozen for finishing a season over the second apron
    if (inp.frozen && inp.frozen.frozen) for (const [y, list] of Object.entries(inp.frozen.frozen))
      for (const pk of W.picks) if (pk.r === 1 && pk.y === +y && list.includes(pk.from) && pk.owner === pk.from) pk.frozen = true;
    // Every team's real trade exceptions, mid-level use and hard caps
    const tp = (inp.tpes && inp.tpes.teams) || {}, ex = (inp.exceptions && inp.exceptions.teams) || {};
    for (const c of codes) {
      const t = W.T[c];
      t.tpes = (tp[c] || []).filter(x => !x.exp || x.exp >= asOf).map((x, k) => ({ id: "tpe-" + c + "-" + k, amt: x.amt, orig: x.amt, from: x.from, made: x.made, exp: x.exp, season: x.season ?? -1 }));
      const e = ex[c];
      t.used = {}; t.hard = {}; t.hardWhy = {};
      if (e) {
        if (e.kind === "ntmle") { t.used[0] = { ntmle: e.used }; if (e.used > 0) { t.hard[0] = "a1"; t.hardWhy[0] = "Used the non-taxpayer mid-level" + (e.on ? " (" + e.on + ")" : ""); } }
        else if (e.kind === "tmle") { t.used[0] = { tmle: e.used, ntmleOff: true }; if (e.used > 0) { t.hard[0] = "a2"; t.hardWhy[0] = "Used the taxpayer mid-level" + (e.on ? " (" + e.on + ")" : ""); } }
        else if (e.kind === "room") t.used[0] = { room: true, rmle: e.used };
        t.mleNote = e.on ? e.on : "";
      }
      if (((inp.exceptions || {}).baeUsedLastYear || []).includes(c)) t.used[-1] = { bae: 1 };
      t.dead = (((inp.dead || {}).teams || {})[c] || []).map(d => ({ n: d.n, sal: d.sal.slice(), why: "Dead money" }));
    }
    const dec = L.decider(W);

    const H = { cfg, W, CBA, Mo, L, teams: teamInfo, codes, asOf, frac0, played, injured, curve, board, set, reset: () => memo.clear(), readInjury, outShare };
    const memo = new Map();
    const cache = (k, f) => { if (!memo.has(k)) memo.set(k, f()); return memo.get(k); };
    function set(k, v) { cfg[k] = v; memo.clear(); }

    // ---------- Contracts, re-signings and who's on each team in a season ----------
    H.keep = {};                     // user calls on expiring players: id -> true (re-sign) / false (let go)
    H.salary = (p, i) => CBA.salaryIn(p, i, dec);
    H.kicker = p => CBA.kicker(p, 0, dec);           // trade kicker this season, paid by the team that trades for him
    H.lastYear = p => CBA.lastYear(p, dec, 0);
    H.faKind = p => {
      const c = p.c || {}, n = H.lastYear(p) + 1;
      const rookie = (c.rk && c.rk[1] > 0 && c.rk[1] <= 30) || c.rfa;
      return rookie && (p.yos || 0) + n - 1 <= 4 ? "RFA" : "UFA";
    };
    // Ratings ahead: decline counts in full, but only part of a young player's projected growth (cfg.growth),
    // since a lot of projected growth never shows up. Rookies on the slider grow on their own draft-slot curve.
    H.rating = (p, i) => {
      if (p.rook) return rookRating(p, i);
      const r0 = Mo.r(p), r = Mo.rAhead(p, i);
      return r > r0 ? r0 + (r - r0) * cfg.growth : r;
    };
    const marketAt = (p, i) => Mo.market(p, i, W);
    // Minutes: what he's actually playing this season (3+ games), fading toward what his rating earns in later years
    const mpgNow = p => (p.line && p.line.gp >= 3 ? p.line.min : null);
    // The minutes a rating earns (Banner 19's role minutes, smoothed so a rating crossing a line doesn't jump)
    const ROLE = [[-3, 10], [-2, 17], [-0.9, 25], [1, 30], [2, 32], [4, 34]];
    const roleMin = r => { if (r <= ROLE[0][0]) return ROLE[0][1]; for (let k = 1; k < ROLE.length; k++) if (r <= ROLE[k][0]) { const [a, x] = ROLE[k - 1], [b, y] = ROLE[k]; return x + (y - x) * (r - a) / (b - a); } return 34; };
    H.mpgAt = (p, i) => {
      const r = H.rating(p, i), base = roleMin(r), a = mpgNow(p);
      if (a == null || p.rook) return base;
      return clamp(base + (a - roleMin(H.rating(p, 0))) * Math.pow(0.85, i), 0, 38);
    };
    // Production: Stephen Noh's salary model (minutes times impact, scaled to the cap) on real minutes, then scaled
    // once so the whole league's production adds up to what the whole league is paid this season. A dollar of
    // production costs what teams actually pay for it, on average; surplus is who's ahead of that and who's behind.
    const CAP_2526 = 154_647_000;
    // Impact above replacement (-2.5, the level of a free minimum-salary player) counts more than linearly
    // (cfg.convex): minutes and roster spots are scarce, so one +4 player is worth far more than two +1 players,
    // and teams can't buy stars at any price because the max holds their pay down. Linear pricing made cheap
    // role players outrank stars.
    const rawProd = (p, i) => {
      const r = H.rating(p, i), games = Math.min(76, 82 * (p.h ?? 0.85));
      // minutes for valuation: the role his rating earns anywhere, plus part (cfg.minCtx) of what his own team's depth
      // chart adds or takes away, since a starter on a thin roster isn't paid for minutes he'd lose on a good one
      const mv = roleMin(r) + (cfg.minCtx ?? 1) * (H.mpgAt(p, i) - roleMin(r));
      const v = games * mv * Math.pow(Math.max(0, r - (cfg.repl ?? -2.5)), cfg.convex);
      return v * CBA.cap(i) / CAP_2526;
    };
    // The price of production. "market" (the default): what teams pay for it on the open market, read off players the
    // max doesn't hold down (market price under a quarter of the cap) who play real minutes, so a role player's
    // production is worth about what role players get, and a star's runs past his max. "payroll": scaled so the whole
    // league's production adds up to the whole league's payroll (which also spreads sunk money from bad contracts
    // onto everyone who produces, so it runs rich).
    const Kfor = () => cache("K" + cfg.convex + cfg.growth + (cfg.repl ?? -2.5) + cfg.anchor + (cfg.minCtx ?? 1), () => {
      let sv = 0, ss = 0;
      for (const p of Object.values(W.P)) {
        if (p.two) continue;
        if (cfg.anchor === "payroll") { const sal = CBA.salaryIn(p, 0, dec); if (!sal) continue; sv += rawProd(p, 0); ss += sal; continue; }
        const m = marketAt(p, 0), rp = rawProd(p, 0);
        if (!(m > 0) || m > 0.25 * CBA.cap(0) || H.mpgAt(p, 0) < 15) continue;
        sv += rp; ss += m;
      }
      return sv > 0 ? ss / sv : 1;
    });
    Object.defineProperty(H, "K", { get: Kfor });
    const prodAt = (p, i) => Math.max(CBA.minSal((p.yos ?? 3) + i, i), Kfor() * rawProd(p, i));
    H.prodAt = prodAt; H.marketAt = marketAt;
    // A new deal for a player whose contract ends: what the market pays, for as long as the market would go
    H.newDeal = (p, start) => {
      const age = Mo.ageIn(p, start, W), r = Mo.rAhead(p, start);
      const yrs = Math.min(Mo.faYears(age, r), YEARS - start + 2);
      const aav = marketAt(p, start);
      return { start, yrs, aav, sal: k => Math.round(aav * Math.pow(1.05, k - start)) };
    };
    // Default call when his deal is up. His team holds his Bird rights, so it can go over the cap to keep him: a player
    // worth close to his market price (85%) re-signs (33 and under; older players mostly move on or retire). Restricted free agents
    // are matched at a lower bar, since the team controls the offer sheet. Everyone else walks.
    H.defaultKeep = p => {
      const e = H.lastYear(p);
      if (e < 0 || e >= YEARS - 1) return false;
      const pr = prodAt(p, e + 1), mk = marketAt(p, e + 1);
      if (H.faKind(p) === "RFA") return pr >= 0.8 * mk;
      return (p.age + e + 1) <= 33 && mk > CBA.minSal((p.yos ?? 3) + e + 1, e + 1) * 1.5 && pr >= 0.85 * mk;   // teams pay a little over value to keep their own
    };
    H.kept = p => (p.id in H.keep ? H.keep[p.id] : H.defaultKeep(p));
    H.salaryAt = (p, i) => {
      const s = H.salary(p, i);
      if (s > 0) return s;
      const e = H.lastYear(p);
      if (e >= 0 && i > e && H.kept(p)) { const d = H.newDeal(p, e + 1); if (i < d.start + d.yrs) return d.sal(i); }
      return 0;
    };

    // ---------- Team strength ----------
    // Lineups. This season: the real starting five (each team's latest game) and real minutes per game, scaled to
    // 240 among the players available. Later seasons: the best player at each spot (PG, SG, SF, PF, C, by the
    // positions he plays), so two centers don't start together, then the bench by rating.
    const SLOTS = ["PG", "SG", "SF", "PF", "C"];
    const MIN_START = [34, 33, 32, 30, 28], MIN_BENCH = [24, 20, 16, 13, 10];
    const posList = p => (p.ps && p.ps.length ? p.ps : p.pos === "G" ? ["PG", "SG"] : p.pos === "B" ? ["C", "PF"] : ["SF", "PF"]);
    function bySlots(entries) {
      const open = new Set(SLOTS), five = {}, rest = [];
      for (const e of entries.slice().sort((a, b) => b.r - a.r)) {
        const slot = open.size ? posList(e.p).find(x => open.has(x)) : null;
        if (slot) { five[slot] = e; open.delete(slot); } else rest.push(e);
      }
      for (const slot of [...open]) { const e = rest.shift(); if (e) five[slot] = e; }
      return { five, rest };
    }
    // Five players onto PG..C with the least stretch: a player costs nothing at his listed position, a little at his
    // second one, and one step for every position away (so a SG/PG plays the point before a forward does)
    function fitFive(five) {
      const idx = { PG: 0, SG: 1, SF: 2, PF: 3, C: 4 };
      const cost = (e, k) => {
        const ps = posList(e.p);
        return Math.min(...ps.map((x, n) => Math.abs((idx[x] ?? 2) - k) + (n ? 0.25 : 0)));
      };
      let best = null, bestC = Infinity;
      const perm = (left, chosen) => {
        if (!left.length) { const c = chosen.reduce((a, e, k) => a + cost(e, k), 0); if (c < bestC) { bestC = c; best = chosen.slice(); } return; }
        left.forEach((e, n) => perm(left.filter((_, m) => m !== n), chosen.concat([e])));
      };
      perm(five, []);
      const out = {};
      (best || []).forEach((e, k) => { out[SLOTS[k]] = e; });
      return out;
    }
    function buildLineup(entries, i, code) {
      const live = i === 0;
      let starters, bench, mins = {};
      if (live) {
        const latest = stats.lineups && stats.lineups[code];
        const ids = new Set(entries.map(e => e.p.id));
        const real = latest && latest[1].every(id => ids.has(id)) ? latest[1] : null;
        const st = id => (stats.starts && stats.starts[id]) || [0, 0];
        const want = e => { const m = mpgNow(e.p); return m == null ? Mo.roleMin(e.r) * 0.6 : m; };
        const pool = entries.slice().sort((a, b) => want(b) - want(a));
        // The usual starting five: most starts this season (one game's lineup is often a rest night), with last game's
        // starters breaking ties (a starting job that changed hands) and never two true centers when a forward is there
        if (stats.starts && entries.some(e => st(e.p.id)[0] > 0)) {
          const last = new Set(real || []);
          const ranked = pool.slice().sort((a, b) => (st(b.p.id)[0] + (last.has(b.p.id) ? 0.5 : 0)) - (st(a.p.id)[0] + (last.has(a.p.id) ? 0.5 : 0)) || (want(b) - want(a)));
          const isC = e => /^C/.test(e.p.pos || "") && !/F/.test(e.p.pos || "");
          starters = [];
          for (const e of ranked) {
            if (starters.length === 5) break;
            if (isC(e) && starters.some(isC) && ranked.some(x => !starters.includes(x) && x !== e && !isC(x) && st(x.p.id)[0] > 0)) continue;
            starters.push(e);
          }
        } else if (real) starters = real.map(id => entries.find(e => e.p.id === id));
        else starters = SLOTS.map(sl => bySlots(pool).five[sl]).filter(Boolean);
        starters.forEach(e => { e.starts = st(e.p.id); });
        bench = pool.filter(e => !starters.includes(e));
        let tot = 0;
        for (const e of entries) { mins[e.p.id] = want(e); tot += mins[e.p.id]; }
        if (tot > 240) {
          // more minutes than a game has (a trade brought someone in): the worst players give theirs up first, the
          // way a coach would bury the end of the bench, rather than everyone (stars too) losing a slice
          let extra = tot - 240;
          for (const e of entries.slice().sort((a, b) => a.r - b.r)) { if (extra <= 0) break; const cut = Math.min(mins[e.p.id], extra); mins[e.p.id] -= cut; extra -= cut; }
          for (const id in mins) mins[id] = Math.min(38, mins[id]);
        } else {
          const k = tot > 0 ? 240 / tot : 0;
          for (const id in mins) mins[id] = Math.min(38, mins[id] * k);
        }
      } else {
        const { five, rest } = bySlots(entries);
        starters = SLOTS.map(sl => five[sl]).filter(Boolean);
        bench = rest;
        starters.slice().sort((a, b) => b.r - a.r).forEach((e, k) => { mins[e.p.id] = MIN_START[k]; });
        bench.forEach((e, k) => { mins[e.p.id] = MIN_BENCH[k] || 0; });
      }
      // starters placed PG to C by the positions they play
      const fit = starters.length === 5 ? fitFive(starters) : bySlots(starters).five;
      const order = SLOTS.map(sl => fit[sl]).filter(Boolean);
      bench = bench.slice().sort((a, b) => (mins[b.p.id] || 0) - (mins[a.p.id] || 0));
      return { starters: order, slots: SLOTS.filter(sl => fit[sl]), bench, mins, real: live && !!(stats.lineups && stats.lineups[code]) };
    }
    H.buildLineup = buildLineup;
    function strengthOf(entries, i, code) {
      const lu = buildLineup(entries, i, code);
      const list = entries.map(e => ({ id: e.p.id, pos: e.p.pos || "W", o: e.r * 0.6, d: e.r * 0.4 }));
      let raw = Mo.raw(list, lu.mins);
      // a team short of big-man minutes plays a power forward at center: up to half of those forwards' minutes count
      // toward the bigs a lineup needs, so losing a backup center doesn't read as having nobody to play the five
      const b = Mo.posMinutes(list, lu.mins), pf = sum(entries.filter(e => (e.p.pos || "W") === "W" && posList(e.p)[0] === "PF").map(e => lu.mins[e.p.id] || 0));
      const move = Math.min(pf / 2, Math.max(0, 40 - b.B));
      if (move > 0) raw += Mo.posPenalty(b) - Mo.posPenalty({ G: b.G, W: b.W - move, B: b.B + move });
      return { raw, lu };
    }
    // This season's strength with short injuries in: a player out for part of what's left counts as the full team for
    // the share he plays and the team without him for the share he misses (out-for-season players are already gone)
    function strengthNow(entries, code) {
      const full = strengthOf(entries, 0, code);
      let raw = full.raw;
      for (const e of entries) {
        const sh = outShare(e.p);
        if (!(sh > 0) || sh >= 1) continue;
        raw -= sh * (full.raw - strengthOf(entries.filter(x => x !== e), 0, code).raw);
      }
      return { raw, lu: full.lu };
    }
    H.lineup = (code, i) => cache("lu" + code + ":" + i, () => buildLineup(H.rosterAt(code, i).filter(e => i > 0 || !injured[e.p.id]), i, code));
    function netsFrom(raws) {
      const mean = sum(Object.values(raws)) / codes.length, nets = {};
      for (const c of codes) nets[c] = Mo.netOf(raws[c], mean);
      return nets;
    }

    // Season 0: this roster, minus anyone out for the season
    H.roster0 = code => Object.values(W.P).filter(p => p.t === code && !p.two && H.salary(p, 0) > 0);
    H.nets0 = () => cache("nets0", () => {
      const raws = {}, rots = {};
      for (const c of codes) {
        const entries = H.rosterAt(c, 0).filter(e => !injured[e.p.id]);
        const s = strengthNow(entries, c); raws[c] = s.raw; rots[c] = s.lu;
      }
      return { nets: netsFrom(raws), rots };
    });

    // ---------- Monte Carlo: the rest of this season, the play-in, the playoffs and the lottery ----------
    function bracket(rng, nets, wins) {
      const out = { seeds: {}, playin: {}, champ: null, conf: {}, order: {} };
      const win = (a, b, home) => rng() < Mo.winPct(nets[a], nets[b], home) ? a : b;
      const series = (hi, lo) => {
        let wh = 0, wl = 0; const homeHi = [1, 1, 0, 0, 1, 0, 1]; let g = 0;
        while (wh < 4 && wl < 4) { if (rng() < Mo.winPct(nets[hi], nets[lo], !!homeHi[g])) wh++; else wl++; g++; }
        return wh > wl ? hi : lo;
      };
      for (const conf of ["E", "W"]) {
        const st = codes.filter(c => W.T[c].conf === conf).map(c => [c, wins[c] + rng() * 0.01]).sort((a, b) => b[1] - a[1]).map(x => x[0]);
        out.order[conf] = st;
        const w78 = win(st[6], st[7], true), l78 = w78 === st[6] ? st[7] : st[6];
        const w910 = win(st[8], st[9], true);
        const w8 = win(l78, w910, true);
        out.seeds[conf] = [...st.slice(0, 6), w78, w8];
        out.playin[conf] = { teams: st.slice(6, 10), l78 };
        const s = out.seeds[conf];
        const ord = (a, b) => s.indexOf(a) < s.indexOf(b) ? [a, b] : [b, a];
        const r1 = [[0, 7], [3, 4], [2, 5], [1, 6]].map(([a, b]) => series(s[a], s[b]));
        const r2 = [series(...ord(r1[0], r1[1])), series(...ord(r1[2], r1[3]))];
        out.conf[conf] = series(...ord(r2[0], r2[1]));
      }
      const e = out.conf.E, w = out.conf.W;
      out.champ = wins[e] >= wins[w] ? series(e, w) : series(w, e);
      return out;
    }
    // Full draft order for one simulated season: the lottery for the 16 lottery teams, then everyone else by record;
    // the second round worst to best
    const LOTTO_BANS = (inp.lottoBans) || { no1: ["WAS"], noTop5: ["UTA"] };
    H.lottoBans = LOTTO_BANS;
    function draftOrder(rng, wins, br) {
      const all = codes.slice().sort((a, b) => wins[a] - wins[b] || (rng() - 0.5));
      const bottom3 = all.slice(0, 3);
      const lot = L.lotteryEntries(br.order, { E: br.playin.E.l78, W: br.playin.W.l78 }, bottom3);
      // 2027: Washington's pick was No. 1 in 2026; Utah's own pick was top five in 2025 and 2026
      const r1 = L.lotteryDraw(lot, bottom3, rng, LOTTO_BANS);
      const rest = all.filter(c => !r1.includes(c));
      return { r1: r1.concat(rest), r2: all };
    }
    H.season0 = () => cache("season0", () => {
      const { nets } = H.nets0();
      const rng = Mo.rng(2027);
      const games = W.sched.filter(g => !g.done);
      const N = cfg.sims, out = {};
      for (const c of codes) out[c] = { code: c, w: W.T[c].w, l: W.T[c].l, wins: 0, top6: 0, playin: 0, playoffs: 0, confW: 0, title: 0, slots: new Array(31).fill(0), slots2: new Array(31).fill(0), top4: 0, no1: 0, seedSum: 0 };
      const sd = 2.0 * Math.sqrt(frac0);
      for (let k = 0; k < N; k++) {
        const nk = {}; for (const c of codes) nk[c] = nets[c] + Mo.gauss(rng) * sd;
        const wins = {}; for (const c of codes) wins[c] = W.T[c].w;
        for (const g of games) { if (rng() < Mo.winPct(nk[g.h], nk[g.a], true)) wins[g.h]++; else wins[g.a]++; }
        const br = bracket(rng, nk, wins);
        for (const c of codes) out[c].wins += wins[c];
        for (const conf of ["E", "W"]) {
          br.order[conf].forEach((c, j) => { out[c].seedSum += j + 1; if (j < 6) out[c].top6++; else if (j < 10) out[c].playin++; });
          br.seeds[conf].forEach(c => out[c].playoffs++);
          out[br.conf[conf]].confW++;
        }
        out[br.champ].title++;
        const d = draftOrder(rng, wins, br);
        d.r1.forEach((c, j) => { out[c].slots[j + 1]++; if (j < 4) out[c].top4++; if (j === 0) out[c].no1++; });
        d.r2.forEach((c, j) => { out[c].slots2[j + 1]++; });
      }
      for (const c of codes) {
        const o = out[c];
        o.projW = o.wins / N; o.projL = 82 - o.projW; o.net = nets[c];
        for (const k of ["top6", "playin", "playoffs", "confW", "title", "top4", "no1"]) o[k] /= N;
        o.seed = o.seedSum / N;
        o.slots = o.slots.map(x => x / N); o.slots2 = o.slots2.map(x => x / N);
        o.avgPick = sum(o.slots.map((p, s) => p * s));
      }
      return out;
    });

    // ---------- Later seasons: who's on the roster, rookies, free agent fills, projected wins ----------
    // Rookies: ratings from the draft slot (Banner 19's curve, calibrated on recent classes), growing toward a ceiling
    function rookRating(p, i) {
      const k = i - p.arrive;
      let r = p.r0, a = p.age;
      for (let j = 0; j < k; j++) { if (a <= 25 && p.pot > r) r += (p.pot - r) * (a <= 21 ? 0.3 : a <= 23 ? 0.25 : 0.2); else r += Mo.ageStep(a + 1); a++; }
      return r;
    }
    const prospects = (board.players || []).slice().sort((a, b) => a.rank - b.rank);
    H.prospects = prospects;
    // the 2028 class, from the Big Board's early 2028 rankings (draft/nba2028.json), when it's there
    const prospects28 = ((inp.board2028 || {}).players || []).slice().sort((a, b) => a.rank - b.rank);
    H.prospectsBy = { 2027: prospects, 2028: prospects28 };
    // Where each team's pick lands in a draft: 2027 from the simulations, later drafts from the season before
    H.draftSlots = year => cache("slots" + year, () => {
      const i = year - 2027;                                  // the season that decides this draft
      let avg;
      if (i === 0) { const s0 = H.season0(); avg = Object.fromEntries(codes.map(c => [c, s0[c].avgPick])); }
      else {
        // by finish, then the lottery's expected slot for that finish (under 3-2-1 the worst record isn't the likeliest No. 1)
        const s = H.seasonProj(i), T = H.lottoTable(), fin = codes.slice().sort((a, b) => s.teams[a].projW - s.teams[b].projW);
        avg = Object.fromEntries(fin.map((c, k) => [c, sum(T[k + 1].map((p, sl) => p * sl)) + k * 1e-3]));
      }
      const order = codes.slice().sort((a, b) => avg[a] - avg[b]);   // pick 1 first (low avg pick, or fewest wins)
      return Object.fromEntries(order.map((c, j) => [c, j + 1]));
    });
    H.rookies = i => cache("rook" + i, () => {
      if (i < 1) return [];
      const year = 2026 + i, slots = H.draftSlots(year), out = [];
      for (const c of codes) {
        const slot = slots[c];
        const pk = W.picks.find(x => x.y === year && x.r === 1 && x.from === c);
        let owner = pk ? (pk.prot && slot >= pk.prot.lo && slot <= pk.prot.hi ? pk.prot.back : pk.owner) : c;
        const g = pk && H.groupOf(pk);
        if (g) owner = assignGroup(g, Object.fromEntries(g.picks.map(id => [id, slots[id.split("-")[2]]])))[pk.id];
        if (!owner || owner === "OUT" || !W.T[owner]) continue;
        const x = (H.prospectsBy[year] || [])[slot - 1] || null;
        const deal = CBA.rookieDeal(slot, i);
        const pos = x ? (/C|PF/.test(x.pos) ? (x.pos === "C" ? "B" : "W") : /G/.test(x.pos) ? "G" : "W") : ["G", "W", "B"][slot % 3];
        out.push({ id: "rook-" + year + "-" + slot, n: x ? x.n : year + " No. " + slot + " pick" + (owner !== c ? " (" + c + ")" : ""), rook: true, t: owner, from: c, slot, year, arrive: i,
          age: x && x.age ? Math.round(x.age) : 20, r0: L.rookieNow(slot), pot: L.rookiePot(slot), pos, prospect: x ? x.id : null, board: x ? (year === 2027 ? "nba" : "nba" + year) : null, school: x ? x.school : "",
          c: { sal: deal.sal, opt: {} }, h: 0.88, yos: 0, o: L.rookieNow(slot) * 0.6, d: L.rookieNow(slot) * 0.4 });
      }
      return out;
    });
    H.rosterAt = (code, i) => cache("ros" + code + ":" + i, () => {
      if (i === 0) return H.roster0(code).map(p => ({ p, sal: H.salary(p, 0), r: H.rating(p, 0), how: "contract" }));
      const out = [];
      for (const p of Object.values(W.P)) {
        if (p.t !== code || p.two) continue;
        const s = H.salaryAt(p, i);
        if (s > 0) out.push({ p, sal: s, r: H.rating(p, i), how: H.salary(p, i) > 0 ? "contract" : "re-signed" });
      }
      for (let j = 1; j <= i; j++) for (const rk of H.rookies(j)) if (rk.t === code) {
        const s = rk.c.sal[i] || 0;
        if (s > 0) out.push({ p: rk, sal: s, r: rookRating(rk, i), how: "rookie" });
      }
      // Open spots: a team signs what its cap position allows (cap room, then the mid-level, then minimums)
      const payroll = sum(out.map(x => x.sal)) + H.dead(code, i);
      let room = CBA.cap(i) - payroll, mle = false, spent = 0;
      for (let n = out.length; n < 13; n++) {
        let r = -2.5, sal = CBA.minSal(3, i), kind = "Replacement player";
        if (cfg.fill) {
          if (room > 0.22 * CBA.cap(i)) { r = 1.4; sal = Math.round(0.22 * CBA.cap(i)); kind = "Free agent (cap room)"; room -= sal; }
          else if (room > 0.09 * CBA.cap(i)) { r = 0.2; sal = Math.round(0.09 * CBA.cap(i)); kind = "Free agent (cap room)"; room -= sal; }
          else if (!mle && payroll + spent < CBA.a1(i)) { r = -0.6; sal = CBA.line(payroll > CBA.cap(i) ? "ntmle" : "rmle", i); kind = "Free agent (mid-level)"; mle = true; }
          else { r = -1.6; kind = "Free agent (minimum)"; }
        }
        spent += sal;
        out.push({ p: { id: "fill-" + code + "-" + i + "-" + n, n: kind, fill: true, t: code, pos: ["G", "W", "B"][n % 3], age: 28 }, sal, r, how: "fill" });
      }
      return out;
    });
    H.dead = (code, i) => sum(W.T[code].dead.map(d => d.sal[i] || 0));
    H.payroll = (code, i) => sum(H.rosterAt(code, i).map(x => x.sal)) + H.dead(code, i);
    H.seasonProj = i => cache("proj" + i, () => {
      if (i === 0) {
        const s0 = H.season0();
        return { i, teams: s0, nets: H.nets0().nets };
      }
      const raws = {}, rots = {};
      for (const c of codes) {
        const s = strengthOf(H.rosterAt(c, i), i, c); raws[c] = s.raw; rots[c] = s.lu;
      }
      const nets = netsFrom(raws);
      const rng = Mo.rng(2027 + i * 101), N = cfg.futureSims, sd = 1.6 + 0.6 * i;
      const out = {};
      for (const c of codes) {
        const opp = codes.filter(x => x !== c).map(x => nets[x]);
        out[c] = { code: c, projW: Mo.expWins(nets[c], opp), net: nets[c], playoffs: 0, playin: 0, confW: 0, title: 0, top6: 0, rot: rots[c] };
      }
      for (let k = 0; k < N; k++) {
        const nk = {}, wins = {};
        for (const c of codes) { nk[c] = nets[c] + Mo.gauss(rng) * sd; }
        for (const c of codes) wins[c] = clamp(out[c].projW + (nk[c] - nets[c]) * 2.6 + Mo.gauss(rng) * 3, 5, 77);
        const br = bracket(rng, nk, wins);
        for (const conf of ["E", "W"]) {
          br.order[conf].forEach((c, j) => { if (j < 6) out[c].top6++; else if (j < 10) out[c].playin++; });
          br.seeds[conf].forEach(c => out[c].playoffs++);
          out[br.conf[conf]].confW++;
        }
        out[br.champ].title++;
      }
      for (const c of codes) { for (const k of ["top6", "playin", "playoffs", "confW", "title"]) out[c][k] /= N; out[c].projL = 82 - out[c].projW; }
      return { i, teams: out, nets };
    });
    H.standings = i => {
      const s = H.seasonProj(i);
      return codes.map(c => Object.assign({}, s.teams[c], teamInfo[c])).sort((a, b) => b.projW - a.projW);
    };

    // ---------- Surplus: what a contract is worth against what it pays ----------
    const discAt = j => Math.pow(1 + cfg.disc, -j);
    const MARKET_PICK = (slot, round) => round === 1 ? 110e6 * Math.exp(-(Math.max(1, slot) - 1) / 5.5) + 5e6 : 2.5e6;
    const pickCurve = s => curve[clamp(Math.round(s), 1, 60) - 1] || 0;
    H.surplus = (p, mode) => {
      mode = mode || cfg.mode;
      return cache("sur" + p.id + mode + cfg.disc + cfg.growth + cfg.salW, () => {
        const rows = [];
        const e = H.lastYear(p);
        for (let j = 0; j <= Math.max(e, -1) && j < 6; j++) {
          const sal = H.salary(p, j);
          if (!sal) continue;
          const part = j === 0 ? frac0 : 1;
          const v = (mode === "market" ? marketAt(p, j) : prodAt(p, j)) * (j === 0 ? 1 - H.outShare(p) : 1);   // games he'll miss hurt now
          const opt = p.c.opt && p.c.opt[j] ? p.c.opt[j] : "";
          // a salary dollar counts at the salary weight this season and next, then 10 points more each season after:
          // money further out eats flexibility a team would otherwise have (cap room, the aprons, extensions)
          const cost = sal * Math.min(1, (cfg.salW ?? 1) + 0.1 * Math.max(0, j - 1));
          rows.push({ j, season: CBA.seasonName(j), r: H.rating(p, j), value: v * part, sal: sal * part, cost: cost * part, surplus: (v - cost) * part, pv: (v - cost) * part * discAt(j), opt, part });
        }
        let pv = sum(rows.map(r => r.pv));
        // A player still on his rookie deal is mostly his draft slot: the No. 1 pick doesn't lose most of its value the
        // night it's made because a 19-year-old's first box scores are rough. Start from what his slot has produced
        // (or, in the market view, what teams pay for it) over the part of a draftee's first eight seasons still ahead,
        // which also counts the restricted free agency and Bird rights after the rookie deal, and let his own projection
        // take over as he plays: about half by the end of his second season, most of it by his fourth.
        let prior = null;
        const rk = p.c && p.c.rk;
        if (rk && rk[1] >= 1 && (p.yos ?? 9) <= 3) {
          const a = stats.avg && stats.avg[String(2027)] && stats.avg[String(2027)][p.id];
          const xp = (p.yos || 0) + (a ? a[0] * a[1] : 0) / 2000;           // seasons of evidence (about 2,000 minutes a season)
          const w = clamp(xp / (xp + 2), 0, 0.9);
          const left = clamp((8 - (p.yos || 0) - (1 - frac0)) / 8, 0, 1);
          const slotV = (mode === "market" ? MARKET_PICK(rk[1], 1) : pickCurve(rk[1])) * left;
          prior = { slot: rk[1], year: rk[0], value: slotV, w, model: pv };
          pv = w * pv + (1 - w) * slotV;
        }
        return { rows, pv, prior, total: sum(rows.map(r => r.surplus)), years: rows.length, salLeft: sum(rows.map(r => r.sal)), costLeft: sum(rows.map(r => r.cost)) };
      });
    };

    // ---------- Draft picks ----------
    // The 3-2-1 lottery by finish: where the team with the k-th worst record picks. 16 teams are drawn: 2 balls each for
    // the three worst, 3 each for the next seven, 2 each for the four 9-10 seeds, 1 each for the two 7-8 play-in losers;
    // the three worst can't fall below 12th. Picks 17-30 go by record.
    H.lottoTable = () => cache("lotto", () => {
      const T = []; for (let k = 0; k <= 30; k++) T.push(new Array(31).fill(0));
      for (let k = 17; k <= 30; k++) T[k][k] = 1;
      if (!L.lotteryDraw) { for (let k = 1; k <= 16; k++) T[k][k] = 1; return T; }
      const lot = []; for (let k = 1; k <= 16; k++) lot.push({ code: String(k), balls: k <= 3 ? 2 : k <= 10 ? 3 : k <= 14 ? 2 : 1 });
      const r = Mo.rng(321), N = 20000;
      for (let n = 0; n < N; n++) L.lotteryDraw(lot, ["1", "2", "3"], r).forEach((c, j) => { T[+c][j + 1] += 1 / N; });
      return T;
    });
    // Where a team's pick could land: the simulations for 2027 (which play out the season, the play-in and the lottery);
    // after that, a spread of where the team could finish around its projected record (wider each year out), run
    // through the lottery table
    H.slotDist = (from, year, round) => cache("sd" + from + year + round, () => {
      if (year === 2027) {
        const s0 = H.season0()[from];
        return (round === 1 ? s0.slots : s0.slots2).map((p, s) => [s, p]).filter(x => x[0] > 0 && x[1] > 0);
      }
      const yrs = year - 2027;
      let center;
      if (yrs <= YEARS - 1) { const sp = H.seasonProj(yrs); const order = codes.slice().sort((a, b) => sp.teams[a].projW - sp.teams[b].projW); center = order.indexOf(from) + 1; }
      else center = 15.5;
      center = 15.5 + (center - 15.5) * Math.pow(0.8, Math.max(0, yrs - 1));
      const sd = 4 + 2.5 * yrs, rank = [];
      let tot = 0;
      for (let k = 1; k <= 30; k++) { const w = Math.exp(-0.5 * Math.pow((k - center) / sd, 2)); rank.push(w); tot += w; }
      if (round === 2) return rank.map((w, k) => [k + 1, w / tot]);            // second round goes by record
      const T = H.lottoTable(), slot = new Array(31).fill(0);
      rank.forEach((w, k) => { for (let sl = 1; sl <= 30; sl++) slot[sl] += (w / tot) * T[k + 1][sl]; });
      return slot.map((p, sl) => [sl, p]).filter(x => x[0] > 0 && x[1] > 0);
    });
    H.pickInfo = pk => {
      const dist = H.slotDist(pk.from, pk.y, pk.r);
      const prot = pk.prot;
      const conveys = prot ? sum(dist.filter(([s]) => s < prot.lo || s > prot.hi).map(x => x[1])) : 1;
      const avg = sum(dist.map(([s, p]) => s * p)) / Math.max(1e-9, sum(dist.map(x => x[1])));
      return { dist, conveys, avg: avg + (pk.r === 2 ? 30 : 0) };
    };
    // Groups (better-of picks) and swaps: play out where the picks land many times and count who ends up with what
    const sampler = dist => { const cum = []; let t = 0; for (const [sl, p] of dist) { t += p; cum.push([sl, t]); } return u => { u *= t; for (const [sl, c] of cum) if (u <= c) return sl; return cum.length ? cum[cum.length - 1][0] : 15; }; };
    const slotVal = (slot, round, mode) => { const sl = slot + (round === 2 ? 30 : 0); return mode === "market" ? MARKET_PICK(sl, round) : pickCurve(sl); };
    const yearAdj = (yrs, mode) => mode === "market" ? Math.pow(0.93, yrs) : Math.pow(CBA.D().growth, yrs) * discAt(yrs);
    H.groupOf = pk => pk.group ? W.pickGroups.find(g => g.id === pk.group) : null;
    H.groupValues = (g, mode) => cache("gv" + g.id + mode + cfg.disc, () => {
      const picks = g.picks.map(id => W.picks.find(x => x.id === id));
      const samp = picks.map(p => sampler(H.slotDist(p.from, p.y, p.r)));
      const rng = Mo.rng(g.id.length * 7919 + picks[0].y), N = 3000, got = {};
      for (let k = 0; k < N; k++) {
        const slots = {}; picks.forEach((p, j) => { slots[p.id] = samp[j](rng()); });
        const a = assignGroup(g, slots);
        for (const id in a) got[a[id]] = (got[a[id]] || 0) + slotVal(slots[id], picks[0].r, mode) / N;
      }
      const adj = yearAdj(picks[0].y - 2027, mode);
      for (const k in got) got[k] *= adj;
      return got;
    });
    H.swapValue = (sw, mode) => cache("sw" + sw.id + (mode || cfg.mode) + cfg.disc, () => {
      mode = mode || cfg.mode;
      const a = sampler(H.slotDist(sw.from, sw.y, sw.r)), b = sampler(H.slotDist(sw.holder, sw.y, sw.r));
      const rng = Mo.rng(sw.id.length * 31 + sw.y), N = 3000; let v = 0;
      for (let k = 0; k < N; k++) v += Math.max(0, slotVal(a(rng()), sw.r, mode) - slotVal(b(rng()), sw.r, mode)) / N;
      return v * yearAdj(sw.y - 2027, mode);
    });
    H.swapsOf = code => W.swaps.filter(s => s.holder === code);
    H.pickValue = (pk, mode) => {
      mode = mode || cfg.mode;
      if (pk && pk.newProt) return cache("pvp" + pk.id + mode + cfg.disc, () => {
        const info = H.pickInfo(pk), yrs = pk.y - 2027;
        let fb = 0; for (const [sl, p] of info.dist) if (sl <= pk.newProt) fb += p * slotVal(sl, 2, mode);
        return H.pickValue0(pk, mode) + fb * yearAdj(yrs, mode);
      });
      const g = H.groupOf(pk);
      if (g) {
        const got = H.groupValues(g, mode), mine = W.picks.filter(x => x.group === g.id && x.owner === pk.owner).length || 1;
        return (got[pk.owner] || 0) / mine;
      }
      const sw = W.swaps.find(x => x.from === pk.from && x.y === pk.y && x.r === pk.r);
      if (sw) return Math.max(0, H.pickValue0(pk, mode) - H.swapValue(sw, mode));
      return H.pickValue0(pk, mode);
    };
    H.pickValue0 = (pk, mode) => {
      mode = mode || cfg.mode;
      return cache("pv" + pk.id + mode + cfg.disc, () => {
        const info = H.pickInfo(pk), yrs = pk.y - 2027;
        let v = 0;
        for (const [s, p] of info.dist) {
          if (pk.prot && s >= pk.prot.lo && s <= pk.prot.hi) continue;      // stays with the original team
          const slot = s + (pk.r === 2 ? 30 : 0);
          v += p * (mode === "market" ? MARKET_PICK(slot, pk.r) : pickCurve(slot));
        }
        const grow = Math.pow(CBA.D().growth, yrs);
        return mode === "market" ? v * Math.pow(0.93, yrs) : v * grow * discAt(yrs);
      });
    };
    // Protections added in the trade builder: "2028-1-BOS@10" is Boston's 2028 first, top-10 protected; if it lands in
    // the top 10 it stays and turns into a second-rounder. (The 3-2-1 lottery bars new top-12 to top-15 protections.)
    const virt = {};
    H.PROTECT = [3, 5, 8, 10, 11, 16, 20];
    H.pickById = id => {
      if (!id || id.indexOf("@") < 0) return W.picks.find(x => x.id === id) || null;
      if (virt[id]) return virt[id];
      const [base, n] = id.split("@"), pk = W.picks.find(x => x.id === base);
      if (!pk || pk.r !== 1 || pk.prot || !(+n >= 1)) return pk || null;
      return (virt[id] = Object.assign({}, pk, { id, baseId: base, newProt: +n, prot: { lo: 1, hi: +n, back: pk.owner } }));
    };
    H.pickName = pk => {
      const from = teamInfo[pk.from] ? teamInfo[pk.from].short : pk.from;
      let s = pk.y + " " + (pk.r === 1 ? "1st" : "2nd") + (pk.owner !== pk.from ? " (" + from + ")" : "");
      if (pk.newProt) return s + ", top-" + pk.newProt + " protected (else a 2nd)";
      if (pk.prot) s += pk.r === 2 ? ", protected " + (pk.prot.lo + (pk.prot.hi <= 30 ? 30 : 0)) + "-" + (pk.prot.hi + (pk.prot.hi <= 30 ? 30 : 0)) : pk.prot.lo === 1 ? ", top-" + pk.prot.hi + " protected" : ", protected " + pk.prot.lo + "-" + pk.prot.hi;
      return s;
    };
    H.picksOf = code => W.picks.filter(pk => pk.owner === code).sort((a, b) => a.y - b.y || a.r - b.r);
    H.picksOwed = code => W.picks.filter(pk => pk.from === code && pk.owner !== code).sort((a, b) => a.y - b.y || a.r - b.r);

    // ---------- Boards ----------
    H.players = () => Object.values(W.P).filter(p => !p.two && H.salary(p, 0) > 0);
    H.valueBoard = mode => cache("vb" + (mode || cfg.mode) + cfg.disc + cfg.growth, () =>
      H.players().map(p => ({ p, s: H.surplus(p, mode) })).sort((a, b) => b.s.pv - a.s.pv));
    // This summer's class: everyone whose deal ends after this season (options as the model expects them to go)
    // A summer's free agent class: everyone whose deal ends the season before (options as the model expects them).
    // i is the season they'd sign for: 1 = summer 2027.
    H.faClass = (i = 1) => cache("fa" + i + cfg.disc, () => {
      const out = [];
      for (const p of H.players()) {
        if (H.lastYear(p) !== i - 1) continue;
        const opt = p.c.opt && p.c.opt[i];
        const age = Mo.ageIn(p, i, W), r = Mo.rAhead(p, i), yrs = Mo.faYears(age, r);
        let prod = 0, mkt = 0;
        for (let k = 0; k < yrs; k++) { prod += prodAt(p, i + k); mkt += marketAt(p, i + k); }
        out.push({ p, kind: H.faKind(p), opt, age, r, yrs, fair: prod / yrs, market: mkt / yrs, team: p.t, keep: H.kept(p) });
      }
      return out.sort((a, b) => b.r - a.r);
    });
    // Players expected to opt in whose option season is i, but with a real chance (20-50%) of opting out instead.
    // They aren't in the free agent class (the model calls them in), so the page lists them on their own.
    H.maybeOut = (i = 1) => cache("mo" + i + cfg.disc, () => {
      const out = [];
      for (const p of H.players()) {
        const kind = p.c.opt && p.c.opt[i];
        if (kind !== "PO" && kind !== "MO") continue;
        const v = L.optionView(W, p, i);
        if (!v || v.dec || v.set || v.final !== "in" || v.pIn == null) continue;
        const pOut = 1 - v.pIn;
        if (pOut < 0.2) continue;
        out.push({ p, kind, pOut, sal: v.sal, market: v.mkt, team: p.t, age: Mo.ageIn(p, i, W) });
      }
      return out.sort((a, b) => b.pOut - a.pOut);
    });
    // What a team can do right now: cap room, exceptions left, trade exceptions, hard cap, repeater, roster spots
    H.tools = (code, i = 0) => cache("tools" + code + i, () => {
      const t = W.T[code], pay = H.payroll(code, i), status = CBA.status(pay, i);
      const out = [];
      const used = t.used[i] || {}, hard = t.hard[i];
      const head = lvl => CBA.levelAmt(lvl, i) - pay;
      const room = CBA.cap(i) - pay;
      if (room > 0) out.push({ name: "Cap room", amt: room, ok: true, why: "Under the cap" });
      const nt = CBA.line("ntmle", i) - (used.ntmle || 0);
      if (i === 0 && used.room) out.push({ name: "Room mid-level", amt: Math.max(0, CBA.line("rmle", i) - (used.rmle || 0)), ok: CBA.line("rmle", i) - (used.rmle || 0) > 0, why: "Used cap room this summer, so the room exception is its mid-level" });
      else if (i === 0 && used.ntmleOff) out.push({ name: "Taxpayer mid-level", amt: Math.max(0, CBA.line("tmle", i) - (used.tmle || 0)), ok: CBA.line("tmle", i) - (used.tmle || 0) > 0 && head("a2") > 0, why: (used.tmle ? "Used " + (t.mleNote || "") + ". " : "") + "Signing only, hard-caps at the second apron" });
      else if (status === "a2") out.push({ name: "Mid-level", amt: 0, ok: false, why: "Over the second apron: no mid-level" });
      else if (status === "a1") out.push({ name: "Taxpayer mid-level", amt: CBA.line("tmle", i), ok: true, why: "Over the first apron. Signing only, hard-caps at the second apron" });
      else out.push({ name: "Non-taxpayer mid-level", amt: Math.max(0, Math.min(nt, head("a1"))), ok: nt > 0 && head("a1") > 0, why: (used.ntmle ? "Used " + money(used.ntmle) + (t.mleNote ? " (" + t.mleNote + ")" : "") + ". " : "") + "Can sign or absorb a player in a trade; hard-caps at the first apron" });
      const baeLast = (t.used[i - 1] || {}).bae;
      if (!used.room && status !== "a1" && status !== "a2") out.push({ name: "Bi-annual exception", amt: baeLast ? 0 : CBA.line("bae", i), ok: !baeLast && head("a1") > 0, why: baeLast ? "Used last season (every other year)" : "Two years max; hard-caps at the first apron" });
      for (const x of t.tpes) {
        const u = L.tpeUsable(W, t, x, status);
        out.push({ name: "Trade exception: " + x.from, amt: x.amt, ok: u.ok, tpe: true, exp: x.exp, why: u.ok ? "Absorb a player making up to " + money(x.amt + CBA.D().match.plus) + " with nothing back. Expires " + L.fmtDate(x.exp) : u.why });
      }
      const rep = L.repeater(W, code, i, j => H.payroll(code, j));
      const n = H.rosterAt(code, i).filter(e => !e.p.fill).length;
      return { tools: out, pay, status, hard, hardWhy: t.hardWhy[i] || "", rep, taxBill: CBA.taxBill(pay, i, rep), roster: n, two: Object.values(W.P).filter(p => p.t === code && p.two).length,
        toTax: CBA.tax(i) - pay, toA1: CBA.a1(i) - pay, toA2: CBA.a2(i) - pay };
    });
    // The repeater clock: tax paid (history, then each later season's projected payroll unless the user says otherwise),
    // whether a bill that season would be at repeater rates, and how long a run of standard-rate tax seasons the team has
    H.repeaterClock = (code, assume) => {
      const t = W.T[code], A = assume || {}, rows = [];
      const paid = j => j < 0 ? !!t.taxHist[j] : A[j] != null ? A[j] : j >= YEARS ? false : H.payroll(code, j) > CBA.tax(j);
      const repAt = (j, pf) => { let n = 0; for (let k = j - 4; k < j; k++) if (pf(k)) n++; return n; };
      for (let j = -5; j < YEARS; j++) {
        const pay = j >= 0 ? H.payroll(code, j) : null, n = j >= -1 ? repAt(j, paid) : null, rep = n != null && n >= 3;
        rows.push({ j, paid: paid(j), hist: j < 0, forced: A[j] != null, pay, over: j >= 0 ? pay - CBA.tax(j) : null, n, rep,
          bill: j >= 0 && pay > CBA.tax(j) ? CBA.taxBill(pay, j, rep) : 0, billStd: j >= 0 && pay > CBA.tax(j) ? CBA.taxBill(pay, j, false) : 0 });
      }
      // The runway: the first season from now a tax bill would be at standard rates, then pay every season after it
      let start = null;
      for (let j = 0; j < YEARS + 4 && start == null; j++) if (repAt(j, paid) < 3) start = j;
      let run = 0;
      if (start != null) {
        const pf = k => k >= start ? true : paid(k);
        for (let j = start; j < start + 6; j++) { if (repAt(j, pf) >= 3) break; run++; }
      }
      return { rows, start, run, nowRep: rows.find(r => r.j === 0).rep, n0: rows.find(r => r.j === 0).n };
    };
    // Every traded pick in the league, with its protection
    H.allPicks = () => W.picks.filter(pk => pk.owner !== pk.from).slice().sort((a, b) => a.y - b.y || a.r - b.r || a.from.localeCompare(b.from));
    // Next summer's spending power: cap room after the deals already on the books and rookies, or the exception
    // Next summer's spending power: room before cap holds (if the team renounces everyone) and after them
    // (Banner 19's holds: free agents it still has Bird rights to, and its own first-round picks)
    H.capOutlook = i => cache("cap" + i, () => codes.map(c => {
      const committed = sum(Object.values(W.P).filter(p => p.t === c && !p.two).map(p => H.salary(p, i)))
        + sum(H.rookies(i).filter(r => r.t === c).map(r => r.c.sal[i] || 0)) + H.dead(c, i);
      const n = Object.values(W.P).filter(p => p.t === c && !p.two && H.salary(p, i) > 0).length + H.rookies(i).filter(r => r.t === c).length;
      let holds = 0, holdList = [];
      try {
        const b = L.books(W, c, i);
        holdList = b.holds.filter(h => h.kind !== "Draft pick");
        holds = sum(holdList.map(h => h.amt));
      } catch (e) { /* books unavailable for this season */ }
      const room = CBA.cap(i) - committed, roomHolds = CBA.cap(i) - committed - holds;
      const tool = room > CBA.line("rmle", i) ? "Cap room" : committed < CBA.a1(i) ? "Non-taxpayer mid-level" : committed < CBA.a2(i) ? "Taxpayer mid-level" : "Minimums only";
      return { code: c, committed, room, roomHolds, holds, holdList, n, tool, status: CBA.status(committed, i) };
    }).sort((a, b) => b.room - a.room));
    // Who can sign an extension right now, and for how much
    H.extensions = code => Object.values(W.P).filter(p => p.t === code && !p.two && H.salary(p, 0) > 0).map(p => {
      const e = CBA.extEligible(p, 0);
      if (!e.ok) return null;
      const lim = CBA.extLimit(p, 0);
      return { p, kind: e.kind, why: e.why, first: lim.first, years: lim.maxYears, start: lim.start, market: marketAt(p, lim.start), prod: prodAt(p, lim.start) };
    }).filter(Boolean);
    // What deals pay against what they buy: every veteran contract on the books, grouped by kind
    H.premium = () => cache("prem", () => {
      const rows = [];
      for (const p of H.players()) {
        const c = p.c || {}, sal = H.salary(p, 0);
        if (c.rk && c.rk[1] > 0) continue;                                   // rookie scale: set by the league
        if (sal <= CBA.minSal(10, 0) * 1.02) continue;                          // minimums
        const prod = prodAt(p, 0), yrs = H.lastYear(p) + 1, age = p.age;
        rows.push({ p, sal, prod, ratio: sal / prod, yrs, age, max: sal >= CBA.cap(0) * 0.245 });
      }
      const med = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
      const group = (label, f) => { const g = rows.filter(f); return { label, n: g.length, ratio: med(g.map(x => x.ratio)) }; };
      return {
        rows,
        groups: [
          group("Max deals", r => r.max),
          group("Four or more years left", r => !r.max && r.yrs >= 4),
          group("Two or three years left", r => !r.max && r.yrs >= 2 && r.yrs <= 3),
          group("Final season", r => !r.max && r.yrs === 1),
          group("Age 30 and up", r => !r.max && r.age >= 30),
          group("Age 25 and under", r => !r.max && r.age <= 25),
          group("$30M and up (not max)", r => !r.max && r.sal >= 30e6),
          group("$10M to $20M", r => r.sal >= 10e6 && r.sal < 20e6),
        ],
      };
    });

    // ---------- Trades ----------
    // tr: { teams: [codes], moves: [{ kind: "p" | "k", id, from, to }] }
    // soft: a roster overage or a not-yet-tradable player is a footnote (waive someone, or wait until a date), not a failure
    // Pick swaps made in a trade: "s" moves with id "2029-1-BOS", sent by Boston, give the team receiving it the right
    // to take Boston's 2029 first in place of its own if Boston's lands higher. Both teams have to own their own pick
    // that year, with no swap, protection or condition on either, and neither pick can move in the same trade.
    H.swapOf = (m, moves) => {
      const [y, r, from] = String(m.id).split("-"), Y = +y, R = +r, holder = m.to;
      const own = c => W.picks.find(x => x.id === `${Y}-${R}-${c}`);
      const a = own(from), b = own(holder);
      let why = "";
      const nm = c => "The " + (teamInfo[c] ? teamInfo[c].short : c);
      if (!a || a.owner !== from) why = `${nm(from)} don't own their ${Y} ${R === 1 ? "1st" : "2nd"}`;
      else if (!b || b.owner !== holder) why = `${nm(holder)} don't own their ${Y} ${R === 1 ? "1st" : "2nd"}, so there's nothing to swap`;
      else if (a.frozen || b.frozen) why = `A frozen ${Y} first can't be swapped`;
      else if (a.prot || b.prot || a.group || b.group || a.locked || b.locked || W.swaps.some(x => x.y === Y && x.r === R && (x.from === from || x.from === holder || x.holder === from || x.holder === holder))) why = `The ${Y} picks already carry a swap or condition`;
      else if ((moves || []).some(x => x.kind === "k" && (x.id.split("@")[0] === a.id || x.id.split("@")[0] === b.id))) why = `Can't swap a ${Y} pick that's moving in the same trade`;
      return { y: Y, r: R, from, holder, ok: !why, why, id: `vs-${Y}-${R}-${from}-${holder}`, name: `Swap of ${Y} ${R === 1 ? "1sts" : "2nds"} with ${teamInfo[from] ? teamInfo[from].short : from}` };
    };
    H.checkTrade = tr => {
      const res = L.checkTradeMulti(W, { teams: tr.teams, moves: tr.moves.filter(m => m.kind !== "s").map(m => m.kind === "k" && m.id.indexOf("@") > 0 ? Object.assign({}, m, { id: m.id.split("@")[0] }) : m), soft: tr.strict ? false : true });
      for (const m of tr.moves) if (m.kind === "s") {
        const sw = H.swapOf(m, tr.moves);
        if (!sw.ok && res.teams[m.from]) { res.teams[m.from].ok = false; res.teams[m.from].msgs.push(sw.why + "."); res.ok = false; }
      }
      return res;
    };
    H.matchMax = (out, post) => CBA.matchMax(out, 0, post);
    H.matchRule = (out, post) => CBA.matchRule(out, 0, post);
    H.assetValue = (m, mode) => m.kind === "c" ? (m.amt || 0) : m.kind === "p" ? H.surplus(W.P[m.id], mode).pv : m.kind === "s" ? H.swapValue(H.swapOf(m), mode) : H.pickValue(H.pickById(m.id), mode);
    // What a change in luxury tax is worth to a team. Tax a deal adds counts in full this season, and later seasons
    // count less (more can change). Tax a deal saves counts only up to what getting under some other way would cost:
    // a team can shed salary in another deal at roughly 40 cents a dollar (what absorbing teams charge, by the salary
    // weight), 60 this season with fewer chances left, so a team $20 million over next season isn't really facing its
    // whole bill. Later seasons count less again, since the team may not be over then after all.
    const TAX_W = [1, 0.6, 0.45, 0.35, 0.25], SAVE_U = [1, 0.85, 0.7, 0.6, 0.5];
    H.taxValue = (c, d) => {                         // d: payroll change by season
      const rep = H.tools(c, 0).rep, rows = [];
      let v = 0;
      for (let j = 0; j < YEARS; j++) {
        const dj = d[j] || 0;
        if (!dj) { rows.push({ j, bill: 0, counted: 0 }); continue; }
        const pb = H.payroll(c, j), pa = pb + dj, line = CBA.tax(j);
        const bill = CBA.taxBill(pb, j, rep) - CBA.taxBill(pa, j, rep);       // positive: saved
        let counted;
        if (bill > 0) { const shed = Math.max(0, pb - line) - Math.max(0, pa - line); counted = Math.min(bill, (j === 0 ? 0.6 : 0.4) * shed) * SAVE_U[j]; }
        else counted = bill * TAX_W[j];
        rows.push({ j, bill, counted }); v += counted;
      }
      return { v, rows };
    };
    H.tradeSummary = tr => {
      const out = {};
      for (const c of tr.teams) out[c] = { prod: 0, market: 0, salIn: 0, salOut: 0, inn: [], out: [] };
      for (const m of tr.moves) {
        const vp = H.assetValue(m, "prod"), vm = H.assetValue(m, "market");
        const sal = m.kind === "p" ? H.salary(W.P[m.id], 0) : 0;
        out[m.to].prod += vp; out[m.to].market += vm; out[m.to].salIn += sal; out[m.to].inn.push(m);
        out[m.from].prod -= vp; out[m.from].market -= vm; out[m.from].salOut += sal; out[m.from].out.push(m);
      }
      // This season's wins, before and after. Both sides are built the same way (the same rosters, the same depth-chart
      // logic): the standings' own lineups use real minutes, and mixing the two put a gap into every trade
      const moved = {};
      for (const m of tr.moves) if (m.kind === "p") moved[m.id] = m.to;
      const rawsFor = (mv, only) => { const raws = {}; for (const c of only || codes) {
        const entries = Object.values(W.P).filter(p => !p.two && H.salary(p, 0) > 0 && !injured[p.id] && (mv[p.id] || p.t) === c).map(p => ({ p, r: H.rating(p, 0), sal: H.salary(p, 0) }));
        raws[c] = strengthNow(entries, c).raw; } return raws; };
      const base = cache("tradeBase", () => rawsFor({}));
      const raws = Object.assign({}, base);
      const aft = rawsFor(moved, tr.teams); for (const c of tr.teams) raws[c] = aft[c];
      const nets = netsFrom(base), after = netsFrom(raws);
      for (const c of tr.teams) {
        const opp = n => codes.filter(x => x !== c).map(x => n[x]);
        const wLeft = 82 - W.T[c].w - W.T[c].l;
        out[c].winsBefore = W.T[c].w + Mo.expWins(nets[c], opp(nets), wLeft);
        out[c].winsAfter = W.T[c].w + Mo.expWins(after[c], opp(after), wLeft);
        // luxury tax: this season's bill before and after (the tax is figured on salaries at season's end), and next
        // season's at half weight since a team has a summer to adjust
        const rep = H.tools(c, 0).rep;
        const payJ = j => { let pay = H.payroll(c, j); for (const m of tr.moves) if (m.kind === "p") { const q = W.P[m.id], sj = H.salary(q, j) + (j === 0 && m.to === c ? H.kicker(q) : 0); if (m.to === c) pay += sj; if (m.from === c) pay -= sj; } return pay; };
        // every season the contracts run: salary change and tax, later seasons counting less (more can change)
        const dPay = [], dTax = [];
        for (let j = 0; j < YEARS; j++) {
          const pb = H.payroll(c, j), pa = payJ(j);
          dPay.push(pa - pb); dTax.push(CBA.taxBill(pb, j, rep) - CBA.taxBill(pa, j, rep));
        }
        const tv = H.taxValue(c, dPay), taxSave = tv.v, taxRows = tv.rows;
        Object.assign(out[c], { taxBefore: CBA.taxBill(H.payroll(c, 0), 0, rep), taxAfter: CBA.taxBill(payJ(0), 0, rep), taxSave, taxRows, dPay, dTax });
      }
      return out;
    };
    // Better-of groups: hand each pick to whoever gets it where the picks are projected to land today
    for (const g of W.pickGroups) {
      const slots = {};
      for (const id of g.picks) { const p = W.picks.find(x => x.id === id); slots[id] = H.pickInfo(Object.assign({}, p, { prot: null })).avg; }
      const a = assignGroup(g, slots);
      for (const id of g.picks) { const p = W.picks.find(x => x.id === id); p.owner = a[id]; p.locked = a[id] !== g.to[0]; }
    }
    memo.clear();
    // Things the cap rules here don't block but a real trade would run into
    const deadline = L.dates(0).deadlineEnd;
    H.deadline = deadline;
    H.tradeWarnings = tr => {
      const out = [];
      if (asOf > deadline && asOf < L.dates(0).finals) out.push("It's past this season's trade deadline (" + L.fmtDate(deadline) + " in Banner 19's calendar): no trades until after the season.");
      for (const m of tr.moves) {
        const p = m.kind === "p" ? W.P[m.id] : null;
      }
      return out;
    };
    // Trade finder: packages from every other team that make the salaries work for a target player, balanced
    // with draft picks when one side gives up more value. Only legal deals come back.
    H.findTrades = (pid, mode) => {
      mode = mode || cfg.mode;
      const p = W.P[pid];
      if (!p) return [];
      const A = p.t, S = H.salary(p, 0), kickA = H.kicker(p), vT = H.surplus(p, mode).pv;
      const payA = H.payroll(A, 0), out = [];
      for (const B of codes) {
        if (B === A) continue;
        const payB = H.payroll(B, 0);
        const pool = Object.values(W.P).filter(q => q.t === B && !q.two && H.salary(q, 0) > 0).sort((a, b) => H.salary(b, 0) - H.salary(a, 0)).slice(0, 13);
        const combos = [];
        const n = pool.length;
        for (let a = 0; a < n; a++) {
          combos.push([pool[a]]);
          for (let b = a + 1; b < n; b++) {
            combos.push([pool[a], pool[b]]);
            for (let c = b + 1; c < n; c++) combos.push([pool[a], pool[b], pool[c]]);
          }
        }
        const cands = [];
        for (const combo of combos) {
          const T = sum(combo.map(q => H.salary(q, 0))), kickB = sum(combo.map(q => H.kicker(q)));
          const postB = payB - T + S + kickA, postA = payA - S + T + kickB;
          const okB = postB <= CBA.cap(0) || S + kickA <= CBA.matchMax(T, 0, CBA.status(postB, 0));
          const okA = postA <= CBA.cap(0) || T + kickB <= CBA.matchMax(S, 0, CBA.status(postA, 0));
          if (!okA || !okB) continue;
          const v = sum(combo.map(q => H.surplus(q, mode).pv));
          cands.push({ combo, v, gap: v - vT });          // gap > 0: A gets more than it gives
        }
        cands.sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap));
        let found = 0;
        for (const c of cands.slice(0, 40)) {
          if (found >= 2) break;
          const moves = [{ kind: "p", id: p.id, from: A, to: B }].concat(c.combo.map(q => ({ kind: "p", id: q.id, from: B, to: A })));
          let gap = c.gap;
          // the side getting less adds draft picks (smallest that close the gap first) until it's close to even
          const payer = gap < 0 ? B : A, sign = gap < 0 ? 1 : -1;
          const picks = H.picksOf(payer).filter(pk => !pk.locked).map(pk => ({ pk, v: H.pickValue(pk, mode) })).filter(x => x.v > 0).sort((x, y) => x.v - y.v);
          let added = 0;
          while (Math.abs(gap) > 4e6 && added < 3) {
            const need = Math.abs(gap);
            const x = picks.find(y => y.v >= need * 0.8 && y.v <= need * 1.25) || picks.filter(y => y.v < need).pop();
            if (!x) break;
            picks.splice(picks.indexOf(x), 1);
            moves.push({ kind: "k", id: x.pk.id, from: payer, to: payer === A ? B : A });
            gap += sign * x.v; added++;
          }
          if (Math.abs(gap) > Math.max(12e6, Math.abs(vT) * 0.2)) continue;
          const chk = H.checkTrade({ teams: [A, B], moves });
          if (!chk.ok) continue;
          out.push({ team: B, moves, gap, legal: true });
          found++;
        }
      }
      return out.sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap)).slice(0, 15);
    };
    // ---------- Deal finder: team-aware ----------
    // Every team weighs a deal by where it is. Contenders also count the wins it adds this season; rebuilders count
    // picks and young players for more and veterans for less. That's what lets both sides come out ahead (on one
    // value scale a trade is zero-sum). Value is the average of the production and market views, as in trade grades.
    H.teamCtx = c => cache("ctx" + c, () => {
      const st = H.standings(0).find(r => r.code === c), po = st ? st.playoffs : 0.5;
      const tier = po >= 0.65 ? "contend" : po <= 0.3 ? "rebuild" : "middle";
      return { tier, po, winW: tier === "contend" ? 6e6 : tier === "middle" ? 2.5e6 : 0,
        youth: tier === "rebuild" ? 1.3 : tier === "middle" ? 1.1 : 0.95, vet: tier === "rebuild" ? 0.55 : tier === "middle" ? 0.9 : 1.05 };
    });
    const isYoung = p => p.age <= 24 || !!(p.c && p.c.rk && (p.yos ?? 9) <= 3);
    const isVet = p => p.age >= 29;
    const blendV = p => cache("bl" + p.id + cfg.disc + cfg.growth + cfg.salW, () => (H.surplus(p, "prod").pv + H.surplus(p, "market").pv) / 2);
    const pickBlend = pk => cache("pb" + pk.id + cfg.disc, () => (H.pickValue(pk, "prod") + H.pickValue(pk, "market")) / 2);
    const contrib = p => Math.max(0, H.rating(p, 0) + 2) * H.mpgAt(p, 0) / 48 * (p.h ?? 0.85) * (1 - H.outShare(p));
    // Positional fit: a team's rotation skills (minutes-weighted percentiles, nine heaviest-minute players) show what it
    // lacks; a player strong where it's weak is worth more to it (up to 25%), one whose strengths it already has a bit less
    const FIT_CATS = ["shoot", "finish", "create", "pass", "secure", "rimd", "reb", "steal"];
    H.FIT_NAME = { shoot: "shooting", finish: "finishing", create: "shot creation", pass: "playmaking", secure: "ball security", rimd: "rim protection", reb: "rebounding", steal: "perimeter defense" };
    // (without = a player on the team: its needs as if he were gone, so his own team weighs his fit the way others do)
    H.teamNeeds = (c, without) => cache("needs" + c + (without || ""), () => {
      const rows = Object.values(W.P).filter(p => p.t === c && p.id !== without && p.adv && p.adv.mc > 0).sort((a, b) => b.adv.mc - a.adv.mc).slice(0, 9);
      const avg = {}, need = {};
      if (!rows.length) return { avg, need, top: [] };
      for (const k of FIT_CATS) {
        let sw = 0, sv = 0; for (const p of rows) if (p.adv.r[k] != null) { sw += p.adv.mc; sv += p.adv.mc * p.adv.r[k]; }
        avg[k] = sw ? sv / sw : 50; need[k] = clamp((55 - avg[k]) / 25, -1, 1);
      }
      return { avg, need, top: FIT_CATS.filter(k => need[k] >= 0.2).sort((a, b) => need[b] - need[a]).slice(0, 3) };
    });
    H.fit = (p, c) => {
      if (!p || !p.adv || !H.adv) return { score: 0, fills: [] };
      const n = H.teamNeeds(c, p.t === c ? p.id : null).need; let num = 0, den = 0; const fills = [];
      for (const k of FIT_CATS) { const nd = Math.max(0, n[k] || 0), sk = Math.max(0, ((p.adv.r[k] ?? 50) - 50) / 50); num += nd * sk; den += nd; if (nd >= 0.2 && (p.adv.r[k] ?? 0) >= 70) fills.push(k); }
      return { score: den > 0 ? clamp(num / Math.max(0.6, den), 0, 1) : 0, fills };
    };
    // How much a team's timeline favors a player of this age: a rebuilding team wants players who'll still be good when
    // it is, so a 23-year-old counts for 30% more and a 31-year-old about half; a contender leans slightly the other way
    const tilt = m => 1 + (cfg.lean ?? 1) * (m - 1);
    H.ageMul = (p, c) => tilt(ageMul0(p, c));
    const ageMul0 = (p, c) => {
      const t = H.teamCtx(c).tier, a = p.age + (p.c && p.c.rk && (p.yos ?? 9) <= 3 ? -1 : 0);
      if (t === "rebuild") return a <= 24 ? 1.3 : a === 25 ? 1.15 : a === 26 ? 1.05 : a === 27 ? 0.95 : a === 28 ? 0.85 : a === 29 ? 0.7 : 0.55;
      if (t === "middle") return a <= 24 ? 1.1 : a <= 28 ? 1 : a === 29 ? 0.95 : 0.9;
      return a <= 24 ? 0.95 : a >= 30 ? 1.05 : 1;
    };
    // What a salary dollar costs team c in season j. The base is the salary weight (calibrated on real trades), rising 10
    // points a season after next. A team with room under the tax line takes on money more easily (that's how the Nets
    // took Julius Randle and Terance Mann); a rebuilding team cares less about this season's money, since the season is
    // gone either way. Tax is counted on its own in the grade, so a taxpaying team isn't charged twice.
    H.salWeight = (c, j) => {
      const room = CBA.tax(j) - H.payroll(c, Math.min(j, YEARS - 1));
      let w = (cfg.salW ?? 0.5) + 0.1 * Math.max(0, j - 1) - (room >= 20e6 ? 0.15 : room >= 0 ? 0.05 : 0);
      if (j === 0 && H.teamCtx(c).tier === "rebuild") w -= 0.1;
      return clamp(w, 0.15, 1);
    };
    // A player's worth to team c: each season's production (both views averaged) scaled by the team's age lean and fit,
    // minus his salary at the team's weight, discounted. A rebuilding team counts this season's play at 40%: it's out of
    // it, so what matters is next year on. Players on rookie deals blend in their draft slot as in surplus.
    H.teamPV = (p, c) => cache("tpv" + p.id + c + cfg.disc + cfg.growth + cfg.salW + "|" + cfg.lean, () => {
      const ctx = H.teamCtx(c), sp = H.surplus(p, "prod"), sm = H.surplus(p, "market");
      let mul = H.ageMul(p, c) * (0.95 + 0.3 * H.fit(p, c).score);
      // a rebuilding team would lose an expiring veteran for nothing this summer, so it counts him for less
      if (ctx.tier === "rebuild" && H.lastYear(p) <= 0 && H.faKind(p) !== "RFA") mul = Math.min(mul, tilt(0.5));
      let pv = 0;
      sp.rows.forEach((r, k) => {
        const m = sm.rows[k] || r, v = (r.value + m.value) / 2, sw = r.j === 0 && ctx.tier === "rebuild" ? tilt(0.4) : 1;
        pv += (sw * mul * v - H.salWeight(c, r.j) * r.sal) * discAt(r.j);
      });
      if (sp.prior && sm.prior) {
        const w = sp.prior.w, slotV = (sp.prior.value + sm.prior.value) / 2;
        pv = w * pv + (1 - w) * slotV * mul;
      }
      else pv += H.birdValue(p, c) * mul;                 // (a rookie's draft-slot value already counts his second deal)
      return pv;
    });
    // Bird rights: when his deal ends, the team holding him can re-sign him over the cap. Worth the gap between what he
    // produces and what the market charges (half of it, averaging in the market view, where a fair deal is worth
    // nothing extra), plus a premium for a team over the cap, which couldn't replace him in free agency (15% of his
    // production a season; 5% with room). Three seasons of a new deal, discounted, times the chance he re-signs
    // (60% for an unrestricted free agent, 85% restricted).
    H.birdValue = (p, c) => cache("bird" + p.id + (c || p.t) + cfg.disc, () => {
      c = c || p.t;
      const e = H.lastYear(p);
      if (e < 0 || e >= YEARS - 1) return 0;
      const keep = H.faKind(p) === "RFA" ? 0.85 : 0.6;
      let v = 0;
      for (let j = e + 1; j <= Math.min(e + 3, YEARS - 1); j++) {
        const pr = prodAt(p, j), mk = marketAt(p, j);
        if (pr <= CBA.minSal((p.yos ?? 3) + j, j) * 1.5) continue;
        const over = H.payroll(c, j) > CBA.cap(j), prem = over ? 0.15 : 0.05;
        v += (0.5 * Math.max(0, pr - mk) + prem * (pr + mk) / 2) * discAt(j);
      }
      return v * keep;
    });
    H.dealValue = (c, m) => {                      // what one piece is worth to team c
      const ctx = H.teamCtx(c);
      if (m.kind === "c") return m.amt || 0;
      if (m.kind === "k") return pickBlend(H.pickById(m.id)) * tilt(ctx.youth);
      // a team gives up a swap reluctantly (it loses control of its own pick), so it costs the giver 30% more than it's worth to the taker
      if (m.kind === "s") { const sw = H.swapOf(m); return (H.swapValue(sw, "prod") + H.swapValue(sw, "market")) / 2 * tilt(ctx.youth) * (c === m.from ? 1.3 : 1); }
      return H.teamPV(W.P[m.id], c);
    };
    // The trade card's grade for one team: the deal's value by its own situation, the wins it adds (worth more to a
    // contender), and the luxury tax it saves or adds
    H.tradeGrade = (c, tr, sum) => {
      const ctx = H.teamCtx(c);
      let value = 0;
      for (const m of tr.moves) { if (m.to === c) value += H.dealValue(c, m); if (m.from === c) value -= H.dealValue(c, m); }
      const s = sum[c], dw = s.winsAfter - s.winsBefore, wins = ctx.winW * dw, tax = s.taxSave || 0;
      return { total: value + wins + tax, value, wins, dw, tax, tier: ctx.tier };
    };
    const winsFor = (c, moves) => {               // quick estimate of this season's wins added (full sim for the shortlist)
      let d = 0;
      for (const m of moves) if (m.kind === "p") { const q = W.P[m.id]; if (m.to === c) d += contrib(q); if (m.from === c) d -= contrib(q); }
      return d * 2.7 * Math.max(0, 82 - W.T[c].w - W.T[c].l) / 82;
    };
    H.dealUtility = (c, moves, dv) => {
      dv = dv || H.dealValue;
      let u = 0;
      for (const m of moves) { if (m.to === c) u += dv(c, m); if (m.from === c) u -= dv(c, m); }
      const dw = winsFor(c, moves);
      // luxury tax saved (a dump) or added, every season the contracts run, valued as on the trade card
      const d = [];
      for (let j = 0; j < YEARS; j++) { d.push(0); for (const m of moves) if (m.kind === "p") { const q = W.P[m.id], sj = H.salary(q, j) + (j === 0 && m.to === c ? H.kicker(q) : 0); if (m.to === c) d[j] += sj; if (m.from === c) d[j] -= sj; } }
      const tax = H.taxValue(c, d).v;
      return { u: u + H.teamCtx(c).winW * dw + tax, dw, value: u, tax };
    };
    // opts: { team, mode: "win" | "buy" | "sell", player (optional: a player on team who must go out) }
    H.findDeals = (opts, async) => {
      const A = opts.team, mode = opts.mode || "win", forced = opts.player && W.P[opts.player] && W.P[opts.player].t === A ? W.P[opts.player] : null;
      if (!W.T[A]) return async ? Promise.resolve([]) : [];
      const ctxA = H.teamCtx(A), payA = H.payroll(A, 0);
      const dvMemo = new Map(), dv = (c, m) => { if (m.kind === "c") return m.amt || 0; const k = c + m.id; let v = dvMemo.get(k); if (v === undefined) { v = H.dealValue(c, m); dvMemo.set(k, v); } return v; };
      const util = (c, moves) => H.dealUtility(c, moves, dv), poolMemo = {};
      // players who can't be traded yet count if they can be within six weeks (summer signings on Dec. 15): those deals
      // come back marked with the date they work from
      const soon = (() => { const d = new Date(asOf + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 45); return d.toISOString().slice(0, 10); })();
      const roster = c => Object.values(W.P).filter(q => q.t === c && !q.two && H.salary(q, 0) > 0 && !(q.tradeOk && soon < q.tradeOk) && !(q.noTrade && soon < q.noTrade));
      // a team's core: its three best players by rating (an injured star is still core) and its three biggest contributors now
      // (plus young players a team just paid like cornerstones: 27 or under on 25% of the cap or more)
      const core = c => { const r = roster(c); return new Set(r.slice().sort((a, b) => H.rating(b, 0) - H.rating(a, 0)).slice(0, 3).concat(r.slice().sort((a, b) => contrib(b) - contrib(a)).slice(0, 3), r.filter(q => q.age <= 27 && Math.max(H.salary(q, 0), H.salary(q, 1)) >= 0.25 * CBA.cap(0))).map(q => q.id)); };
      const picks = c => H.picksOf(c).filter(pk => !pk.locked && !pk.frozen && (pk.r === 1 ? pk.y <= 2032 : pk.y <= 2028));
      const salOK = (outA, inA, B) => {           // quick salary check for both sides (the full rules run on the shortlist)
        const S = sum(outA.map(q => H.salary(q, 0))), T = sum(inA.map(q => H.salary(q, 0)));
        const kA = sum(outA.map(q => H.kicker(q))), kB = sum(inA.map(q => H.kicker(q)));
        const payB = H.payroll(B, 0), postB = payB - T + S + kA, postA = payA - S + T + kB;
        const okB = !outA.length && !inA.length ? false : (postB <= CBA.cap(0) || S + kA <= (T > 0 ? CBA.matchMax(T, 0, CBA.status(postB, 0)) : 0) || S === 0);
        const okA = postA <= CBA.cap(0) || T + kB <= (S > 0 ? CBA.matchMax(S, 0, CBA.status(postA, 0)) : 0) || T === 0;
        return okA && okB;
      };
      const combos = (pool, max) => {
        const out = [], n = pool.length;
        for (let a = 0; a < n; a++) { out.push([pool[a]]); if (max < 2) continue;
          for (let b = a + 1; b < n; b++) { out.push([pool[a], pool[b]]); if (max < 3) continue;
            for (let c = b + 1; c < n; c++) out.push([pool[a], pool[b], pool[c]]); } }
        return out;
      };
      const mv = (list, from, to) => list.map(q => ({ kind: "p", id: q.id, from, to }));
      const nRoster = {}; for (const c of codes) nRoster[c] = roster(c).length;
      const rosterOK = moves => {
        const d = {};
        for (const m of moves) if (m.kind === "p") { d[m.from] = (d[m.from] || 0) - 1; d[m.to] = (d[m.to] || 0) + 1; }
        return Object.keys(d).every(c => nRoster[c] + d[c] <= 15 && nRoster[c] + d[c] >= 13);
      };
      // Stepien rule: never leave a team without a first-round pick in back-to-back future drafts
      const stepMemo = {};
      const stepienOK = (c, moves) => {
        const ks = moves.filter(m => m.kind === "k");
        const key = c + ks.map(m => m.id + m.from + m.to).sort().join();
        if (key in stepMemo) return stepMemo[key];
        return (stepMemo[key] = stepienOK0(c, ks));
      };
      const stepienOK0 = (c, ks) => {
        // like the trade check: a team that sends a first can't be left with back-to-back years missing one, in any way its picks could convey
        if (!ks.some(m => m.from === c && W.picks.find(x => x.id === m.id).r === 1)) return true;
        return L.stepienAll(W, c, ks.filter(m => m.from === c).map(m => m.id), ks.filter(m => m.to === c).map(m => m.id)).ok;
      };
      const cands = [];
      const coreA = core(A);
      const dbg = H._dealDbg = { combos: 0, sal: 0, floors: 0 };
      const perTeam = B => {
        if (B === A) return;
        const ctxB = H.teamCtx(B), coreB = core(B), rB = roster(B), rA = roster(A);
        if (mode === "sell" && ctxB.tier === "rebuild") return;      // sellers sell to teams trying to win
        if (mode === "buy" && ctxB.tier === "contend") return;       // buyers buy from teams that aren't
        // what A puts on the table
        let outSets;
        if (forced) outSets = [[forced]].concat(rA.filter(q => q.id !== forced.id && !coreA.has(q.id) && !(isYoung(q) && ctxA.tier !== "contend")).sort((a, b) => H.salary(a, 0) - H.salary(b, 0)).slice(0, 6).map(q => [forced, q]));
        else if (mode === "sell") outSets = rA.filter(q => q.age >= 27 && H.rating(q, 0) >= 0 && H.mpgAt(q, 0) >= 15).map(q => [q]);
        else outSets = combos(rA.filter(q => !coreA.has(q.id)).sort((a, b) => H.salary(b, 0) - H.salary(a, 0)).slice(0, 9), 2);
        // what B could send
        let inPool;
        if (mode === "buy") inPool = rB.filter(q => H.rating(q, 0) >= 0.8 && H.mpgAt(q, 0) >= 18 && !isYoung(q)).sort((a, b) => contrib(b) - contrib(a)).slice(0, 5);
        else if (mode === "sell") {
          const nc = rB.filter(q => !coreB.has(q.id));
          const filler = nc.slice().sort((a, b) => H.salary(b, 0) - H.salary(a, 0)).slice(0, 6), young = nc.filter(q => isYoung(q) && !filler.includes(q)).sort((a, b) => blendV(b) - blendV(a)).slice(0, 4);
          inPool = filler.concat(young);
        }
        else {
          // the biggest salaries (where most deals start) plus the players worth most to A, whatever they're paid: a
          // team near a hard cap can't take back a big salary. A team's young core (top three, 27 or under) isn't on
          // the table in a deal it's meant to like; its veteran stars can be.
          const pool = rB.filter(q => H.mpgAt(q, 0) >= 10 && !(coreB.has(q.id) && q.age <= 27)), big = pool.slice().sort((a, b) => H.salary(b, 0) - H.salary(a, 0)).slice(0, 7);
          inPool = big.concat(pool.filter(q => !big.includes(q)).sort((a, b) => H.teamPV(b, A) - H.teamPV(a, A)).slice(0, 6));
        }
        const inSets = mode === "sell" ? combos(inPool, 3) : combos(inPool, 2);
        const best = [];
        for (const outA of outSets) for (const inA of inSets) {
          dbg.combos++;
          if (!salOK(outA, inA, B)) continue;
          if (outA.length + inA.length > 5) continue;
          dbg.sal++;
          let moves = mv(outA, A, B).concat(mv(inA, B, A));
          if (!rosterOK(moves)) continue;
          // a team trying to win now doesn't trade for a player who's out for the season (a rebuilding team might, as salary)
          if ((ctxA.tier !== "rebuild" && inA.some(q => q.injury && q.injury.season)) || (ctxB.tier !== "rebuild" && outA.some(q => q.injury && q.injury.season))) continue;
          if (inA.some(q => (q.noBack || []).some(x => x.team === A)) || outA.some(q => (q.noBack || []).some(x => x.team === B))) continue;
          let uA = util(A, moves), uB = util(B, moves);
          // sweeteners: the side short of what it needs adds picks (and, buying, a young player) until it's there
          const sweeten = (payer, other, need) => {
            // picks, plus first-round swaps (often the cheapest way to close a small gap)
            const pk0 = poolMemo[payer + other] || (poolMemo[payer + other] = picks(payer).map(pk => ({ m: { kind: "k", id: pk.id, from: payer, to: other } }))
              .concat([2027, 2028, 2029, 2030, 2031, 2032].map(y => ({ m: { kind: "s", id: `${y}-1-${payer}`, from: payer, to: other } })).filter(x => H.swapOf(x.m).ok))
              .map(x => Object.assign(x, { v: dv(other, x.m) })).filter(x => x.v > 1e6));
            const hasSwap = moves.some(m => m.kind === "s");       // one swap a deal at most: they're a garnish, not the meal
            const pool = pk0.filter(x => !moves.some(m => m.id === x.m.id) && !(x.m.kind === "s" && (hasSwap || !H.swapOf(x.m, moves).ok)))
              .concat(mode === "buy" && payer === A ? rA.filter(q => isYoung(q) && !coreA.has(q.id) && !outA.includes(q)).map(q => ({ m: { kind: "p", id: q.id, from: A, to: other } })).map(x => Object.assign(x, { v: dv(other, x.m) })).filter(x => x.v > 1e6) : [])
              .sort((x, y) => x.v - y.v);
            let added = 0;
            // picks first; a swap only when picks alone can't close the gap (the second pass), and never more than one
            for (const swaps of [false, true]) while (need() > 0 && added < 3 && pool.length) {
              // the smallest piece that covers the gap, else the biggest one: checked lazily, since the rules are the slow part
              const gap = need(), ok = y => { const t = moves.concat([y.m]); return rosterOK(t) && stepienOK(payer, t); };
              let x = null;
              const live = !swaps || moves.some(m => m.kind === "s") ? pool.filter(y => y.m.kind !== "s") : pool.filter(y => y.m.kind === "s");
              for (const y of live) if (y.v >= gap && ok(y)) { x = y; break; }
              if (!x) for (let k = live.length - 1; k >= 0; k--) if (live[k].v < gap && ok(live[k])) { x = live[k]; break; }
              if (!x) break;
              pool.splice(pool.indexOf(x), 1); moves = moves.concat([x.m]); added++;
              uA = util(A, moves); uB = util(B, moves);
            }
          };
          const floorB = 1e6, floorA = mode === "buy" ? -15e6 : 1e6;
          if (uB.u < floorB) sweeten(A, B, () => floorB - uB.u);
          if (mode === "sell" || mode === "win") {
            if (uA.u < floorA) sweeten(B, A, () => floorA - uA.u);
            // a seller asks for more while the buyer still comes out ahead
            if (mode === "sell" && uA.u >= floorA && uB.u >= floorB) {
              // a seller asks for picks while the buyer still comes out ahead: biggest that fits first, up to three
              const extra = picks(B).filter(pk => !moves.some(m => m.kind === "k" && m.id === pk.id)).map(pk => ({ kind: "k", id: pk.id, from: B, to: A })).sort((x, y) => dv(A, y) - dv(A, x));
              let n = 0;
              for (const m of extra) {
                if (n >= 3) break;
                const t = moves.concat([m]);
                if (!stepienOK(B, t)) continue;
                const ub = util(B, t);
                if (ub.u >= 3e6) { moves = t; uB = ub; uA = util(A, moves); n++; }
              }
            }
          }
          if (uA.u < floorA || uB.u < floorB) continue;
          // a contender doesn't get worse this season in a deal it calls a win; a buyer's seller can, a seller's buyer can't
          if (mode === "win" && ((ctxA.tier === "contend" && uA.dw < -0.3) || (ctxB.tier === "contend" && uB.dw < -0.3))) continue;
          if (mode === "sell" && uB.dw < 0) continue;
          dbg.floors++;
          if (mode === "buy" && uA.dw < 0.5) continue;
          const score = mode === "buy" ? uA.dw * 10e6 + uA.u : mode === "sell" ? uA.value : Math.min(uA.u, uB.u);
          best.push({ team: B, moves, uA, uB, score });
        }
        best.sort((x, y) => y.score - x.score);
        let kept = 0;
        for (const c of best) {
          if (kept >= 2) break;
          if (cands.some(o => o.team === B && o.moves.filter(m => m.kind === "p").map(m => m.id).sort().join() === c.moves.filter(m => m.kind === "p").map(m => m.id).sort().join())) continue;
          cands.push(c); kept++;
        }
      };
      const finish = () => {
      cands.sort((x, y) => y.score - x.score);
      // the quick wins estimate finds candidates; the shortlist gets the full season simulation (the trade card's), and
      // the floors and the contender rule apply again on those wins
      const fl = { A: mode === "buy" ? -15e6 : 1e6, B: 1e6 };
      const rescored = [];
      for (const c of cands.slice(0, 40)) {
        const sm = H.tradeSummary({ teams: [A, c.team], moves: c.moves });
        const re = (team, u) => { const dw = sm[team].winsAfter - sm[team].winsBefore; return Object.assign({}, u, { dw, u: u.value + H.teamCtx(team).winW * dw + u.tax }); };
        const uA = re(A, c.uA), uB = re(c.team, c.uB), tierB = H.teamCtx(c.team).tier;
        if (uA.u < fl.A || uB.u < fl.B) continue;
        if (mode === "win" && ((ctxA.tier === "contend" && uA.dw < -0.3) || (tierB === "contend" && uB.dw < -0.3))) continue;
        if (mode === "sell" && uB.dw < 0) continue;
        if (mode === "buy" && uA.dw < 0.5) continue;
        rescored.push(Object.assign({}, c, { uA, uB, score: mode === "buy" ? uA.dw * 10e6 + uA.u : mode === "sell" ? uA.value : Math.min(uA.u, uB.u) }));
      }
      rescored.sort((x, y) => y.score - x.score);
      const out = [];
      for (const c of rescored) {
        if (out.length >= 12) break;
        // the full rules; the only thing allowed to bend is a date (Dec. 15, the two-month aggregation wait)
        const chk = H.checkTrade({ teams: [A, c.team], moves: c.moves });
        const waive = [A, c.team].some(x => chk.teams[x].waive > 0);
        if (!chk.ok || waive) { (dbg.fails = dbg.fails || []).push([A, c.team].map(x => chk.teams[x].msgs.join("; ")).join(" || ")); continue; }
        const after = [A, c.team].map(x => chk.teams[x].after).filter(Boolean).sort().pop() || null;
        out.push(Object.assign({ tierA: ctxA.tier, tierB: H.teamCtx(c.team).tier, after }, c));
      }
      return out;
      };
      // async: work through the league a few teams at a time so the page stays responsive (resolves to the same list)
      if (async) return new Promise(res => {
        let i = 0;
        const step = () => { const t = Date.now(); while (i < codes.length && Date.now() - t < 35) perTeam(codes[i++]); if (i < codes.length) setTimeout(step, 0); else setTimeout(() => res(finish()), 0); };
        step();
      });
      for (const B of codes) perTeam(B);
      return finish();
    };
    // Which of a team's first-round picks it could trade on their own, and why the rest can't go
    H.firstsStatus = c => {
      const ok = [], blocked = [];
      for (const pk of H.picksOf(c).filter(x => x.r === 1)) {
        if (pk.frozen) { blocked.push({ pk, why: "frozen (second apron)" }); continue; }
        const st = L.stepienAll(W, c, [pk.id], []);
        if (!st.ok) blocked.push({ pk, why: st.why.replace(" (Stepien rule)", "") }); else ok.push(pk);
      }
      return { ok, blocked };
    };
    // For the badge: "Out for the season", "Out, back about Dec. 15", "Day-to-day"
    H.injuryTag = p => {
      const j = p && p.injury; if (!j) return null;
      const share = outShare(p);
      const label = j.season ? "Out for season" : /^out$/i.test(j.st) ? "Out" : j.st || "Injured";
      return { label, season: j.season, share, dtd: !/^out$/i.test(j.st) && !j.season, note: j.note, date: j.date, back: j.season ? null : j.back };
    };
    H.findPlayer = id => W.P[id] || null;
    H.teamPlayers = code => Object.values(W.P).filter(p => p.t === code);
    H.darkoThrough = (inp.darko && inp.darko.through) || null;
    // Skill ratings (tools/nba_ratings.py): joined to the league by name; a row with no contract here still shows
    H.adv = inp.ratings && inp.ratings.players ? inp.ratings : null;
    if (H.adv) {
      const byKey = {};
      for (const p of Object.values(W.P)) byKey[NC.nameKeys(p.id)[0]] = byKey[NC.nameKeys(p.id)[0]] ? "?" : p;
      for (const r of H.adv.players) {
        const p = keysOf(r.n).map(k => byKey[k]).find(x => x && x !== "?");
        if (p) { r.id = p.id; p.adv = r; if (!r.t) r.t = p.t; }
      }
    }
    // Lineups (tools/nba_lineups.py): pbpstats keys players by NBA id and teams by its own abbreviations (BKN, PHX),
    // so players join through the ratings' NBA ids, then by name, and each team goes to the hub code most of its
    // players are on
    H.lu = inp.lineups && inp.lineups.teams ? inp.lineups : null;
    if (H.lu) {
      const byNba = {}, byKey = {};
      if (H.adv) for (const r of H.adv.players) if (r.nba && r.id) byNba[String(r.nba)] = r.id;
      for (const p of Object.values(W.P)) { const k = NC.nameKeys(p.id)[0]; byKey[k] = byKey[k] ? "?" : p.id; }
      H.luIds = {};
      for (const [nid, nm] of Object.entries(H.lu.names || {})) {
        const k = byNba[nid] || keysOf(nm).map(x => byKey[x]).find(x => x && x !== "?");
        if (k) H.luIds[nid] = k;
      }
      H.luTeams = {};
      for (const [ab, t] of Object.entries(H.lu.teams)) {
        const votes = {};
        for (const nid of Object.keys(t.onoff || {})) { const p = W.P[H.luIds[nid]]; if (p) votes[p.t] = (votes[p.t] || 0) + (t.onoff[nid][0] || 0); }
        const code = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0];
        if (code) { t.code = code; H.luTeams[code] = t; }
      }
      // on/off on each player: his current team's numbers (a traded player keeps his biggest sample)
      for (const t of Object.values(H.luTeams)) for (const [nid, v] of Object.entries(t.onoff)) {
        const p = W.P[H.luIds[nid]];
        if (p && (!p.oo || p.oo[1] < v[1])) p.oo = v;
      }
    }
    return H;
  }

  // 2027: the owner of each team's pick from the current draft order. 2028-33: the ledger of picks owed.
  function setPicks(W, board, codes) {
    W.picks = []; W.pickGroups = []; W.swaps = [];
    const favRows = {};
    for (let y = 2027; y <= 2033; y++) for (const c of codes) for (const r of [1, 2]) W.picks.push({ id: `${y}-${r}-${c}`, y, r, from: c, owner: c });
    const pk = id => W.picks.find(p => p.id === id);
    for (const row of ((board.order || {}).picks || [])) {
      const [, round, owner, from] = row;
      const p = pk(`2027-${round}-${fix(from)}`);
      if (p && W.T[fix(owner)]) p.owner = fix(owner);
    }
    // 2027 firsts with protections or conditions (the Big Board's rule list, from RealGM)
    for (const x of (((board.rules || {}).first) || [])) {
      if (x.type === "to") {
        const p = pk(`2027-1-${fix(x.orig)}`); if (!p) continue;
        p.owner = fix(x.to);
        if (x.keep) p.prot = { lo: x.keep[0], hi: x.keep[1], back: p.from };
        if (x.note && x.note !== "Unprotected") p.note = x.note;
      } else if (x.type === "split") {
        const p = pk(`2027-1-${fix(x.orig)}`); if (!p) continue;
        const [a, b] = x.ranges;
        p.owner = fix(b[2]); p.prot = { lo: a[0], hi: a[1], back: fix(a[2]) }; p.note = x.note; p.locked = true;
      } else if (x.type === "swap") {
        const p = pk(`2027-1-${fix(x.with)}`); if (p) { p.note = x.note; p.locked = true; }
      } else if (x.type === "favorable") {
        const ids = x.picks.map(o => `2027-1-${fix(o)}`).filter(pk);
        for (const id of ids) { const p = pk(id); p.note = x.note; p.group = "g2027-" + ids.join("-"); }
        W.pickGroups.push({ id: "g2027-" + ids.join("-"), picks: ids, to: x.to.map(fix), bar: Object.fromEntries(Object.entries(x.bar || {}).map(([k, v]) => [fix(k), v])), lastKeep: x.lastKeep || null, fallback: x.fallback ? fix(x.fallback) : null, alt: {}, note: x.note });
      } else if (x.type === "okc") {
        for (const o of ["OKC", "DEN", "LAC", "TOR"]) { const p = pk(`2027-1-${o}`); if (p) { p.note = x.note; p.locked = true; } }
      }
    }
    for (const row of ((board.future || {}).owed || [])) {
      const [from0, y, r, to0, kind] = row;
      const p = pk(`${y}-${r}-${fix(from0)}`);
      if (!p) continue;
      const tos = String(to0).split("/").map(fix);
      if (kind === "forfeit") { p.owner = "OUT"; p.note = "Forfeited by the league"; continue; }
      if (kind === "swap") {
        p.note = (p.note ? p.note + "; " : "") + tos.join(" or ") + " can swap";
        if (W.T[tos[0]]) { p.swapBy = tos[0]; W.swaps.push({ id: `swap-${y}-${r}-${p.from}-${tos[0]}`, y, r, from: p.from, holder: tos[0], note: tos.length > 1 ? "Swap rights shared with " + tos.slice(1).join(", ") : "" }); }
        continue;
      }
      if (kind === "fav" && W.T[tos[0]]) {
        // the first team takes the most favorable pick of the group; each other pick goes to its own second team
        const key = `${y}-${r}-${tos[0]}`;
        (favRows[key] = favRows[key] || { y, r, best: tos[0], picks: [] }).picks.push({ id: p.id, alt: tos[1] && W.T[tos[1]] ? tos[1] : null, tos });
        p.owner = tos[0];
        continue;
      }
      const to = tos[0];
      if (to === "?" || !W.T[to]) { p.note = "Conditional"; p.locked = true; continue; }
      p.owner = to;
      if (tos.length > 1 || kind === "fav" || kind === "cond") { p.note = kind === "fav" ? "Goes to " + tos.join(" or ") + " (more/less favorable)" : "Goes to " + tos.join(" or ") + " depending on where picks land"; p.locked = true; }
      const m = /^(\d+)-(\d+)$/.exec(kind || "");
      if (m) {
        const lo = +m[1] - (r === 2 ? 30 : 0), hi = +m[2] - (r === 2 ? 30 : 0);
        p.prot = { lo: Math.max(1, lo), hi: Math.min(30, hi), back: p.from };
        p.note = p.note || (r === 1 ? (+m[1] === 1 ? "Top-" + m[2] + " protected" : "Protected " + m[1] + "-" + m[2]) : "Protected " + m[1] + "-" + m[2]);
      }
    }
    for (const g of Object.values(favRows)) {
      const id = `g${g.y}-${g.r}-${g.best}`, alt = {};
      for (const x of g.picks) { alt[x.id] = x.alt; pk(x.id).group = id; }
      const froms = g.picks.map(x => x.id.split("-")[2]);
      const others = [...new Set(g.picks.map(x => x.alt || x.id.split("-")[2]))];
      const note = g.picks.length > 1 ? (g.best + " gets the best of " + froms.join(", ") + "; " + (g.picks.length > 2 ? "the others go to " : "the other goes to ") + others.join(" or ")) : "Goes to " + g.picks[0].tos.join(" or ") + " (more/less favorable)";
      for (const x of g.picks) pk(x.id).note = note;
      W.pickGroups.push({ id, picks: g.picks.map(x => x.id), to: [g.best], bar: {}, lastKeep: null, fallback: null, alt, note });
    }
  }
  // Who gets each pick in a group, given where every pick in it lands (slots: pick id -> slot)
  function assignGroup(g, slots) {
    const res = {};
    let pool = g.picks.slice(), rec = g.to.slice();
    for (const [from, [lo, hi]] of Object.entries(g.bar || {})) {
      const id = g.picks.find(x => x.split("-")[2] === from);
      if (id && slots[id] >= lo && slots[id] <= hi) { res[id] = from; pool = pool.filter(x => x !== id); rec = rec.filter(x => x !== from); }
    }
    pool.sort((a, b) => slots[a] - slots[b]);
    pool.forEach((id, k) => {
      let o = rec[k] || g.alt[id] || id.split("-")[2];
      if (k === pool.length - 1 && pool.length > 1 && g.lastKeep && slots[id] >= g.lastKeep[0] && slots[id] <= g.lastKeep[1] && g.fallback) o = g.fallback;
      res[id] = o;
    });
    return res;
  }

  const NBAHub = { build, YEARS, DEFAULTS, fix };
  if (typeof module !== "undefined") module.exports = NBAHub; else root.NBAHub = NBAHub;
})(typeof window !== "undefined" ? window : globalThis);
