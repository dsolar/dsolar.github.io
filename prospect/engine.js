/* Prospect rules engine. No DOM: the app and the tests both load it.
   Everything a league needs to stay honest lives here: the player pool, the payroll ceiling with its
   minimum-salary reserve, snake drafts, the bots' picks, FAAB waivers, nine-category weekly matchups,
   Game Score, the schedule and the standings. */
(function (root) {
  "use strict";

  const CATS = [
    { k: "fg", label: "FG%", pct: true },
    { k: "ft", label: "FT%", pct: true },
    { k: "tpm", label: "3PM" },
    { k: "pts", label: "PTS" },
    { k: "reb", label: "REB" },
    { k: "ast", label: "AST" },
    { k: "stl", label: "STL" },
    { k: "blk", label: "BLK" },
    { k: "tov", label: "TO", low: true },
  ];
  // Column order of stats.json lines (weekly totals and per-game averages).
  const COLS = ["gp", "min", "fgm", "fga", "ftm", "fta", "tpm", "pts", "reb", "oreb", "ast", "stl", "blk", "tov", "pf"];
  const C = Object.fromEntries(COLS.map((k, i) => [k, i]));

  const DEFAULTS = {
    teams: 10, roster: 12, prospects: 2, faab: 50, minBid: 1, clock: 60,
    regWeeks: 21, playoffTeams: 4, playoffWeeks: 2,
  };

  /* ---------- small helpers ---------- */
  function rng(seed) {                        // mulberry32: same seed, same league
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const money = (n) => "$" + (n / 1e6).toFixed(n >= 1e8 ? 1 : 2).replace(/\.?0+$/, "") + "M";

  /* ---------- player pool ---------- */
  // Blend last season with this one, leaning on this season as games pile up.
  function blendLine(prev, cur) {
    if (!prev && !cur) return null;
    if (!prev) return cur.slice();
    if (!cur) return prev.slice();
    const w = cur[0] / (cur[0] + 12);
    return prev.map((v, i) => (i === 0 ? prev[0] + cur[0] : v * (1 - w) + cur[i] * w));
  }

  function buildPool(nba, stats) {
    const avg = (stats && stats.avg) || {};
    const yrs = Object.keys(avg).sort();
    const cur = yrs.length ? avg[yrs[yrs.length - 1]] : {};
    const prev = yrs.length > 1 ? avg[yrs[yrs.length - 2]] : {};
    const players = [];
    for (const p of nba.players) {
      const sal = (p.c && p.c.sal) || [];
      if (!sal[0]) continue;                   // two-way deals and the unsigned don't count against anything
      const line = blendLine(prev[p.id], cur[p.id]);
      players.push({
        id: p.id, n: p.n, t: p.t, pos: p.pos, ps: p.ps || [], age: p.age, yos: p.yos,
        sal: sal[0], future: sal.slice(1).filter((x) => x > 0), opt: (p.c && p.c.opt) || {},
        tier: p.tier || "", note: p.note || "", rating: (p.o || 0) + (p.d || 0),
        line, cur: cur[p.id] || null, prev: prev[p.id] || null,
        ppg: p.ppg, rpg: p.rpg, apg: p.apg,
      });
    }
    rankNineCat(players);
    return players;
  }

  // Nine-category value: z-scores per game across the regular rotation, with the two percentages weighted by volume.
  function rankNineCat(players) {
    const live = players.filter((p) => p.line && p.line[C.min] >= 16 && p.line[C.gp] >= 8);
    const base = live.length >= 60 ? live : players.filter((p) => p.line);
    const per = (p) => {
      const l = p.line;
      return {
        fgm: l[C.fgm], fga: l[C.fga], ftm: l[C.ftm], fta: l[C.fta], tpm: l[C.tpm], pts: l[C.pts], reb: l[C.reb],
        ast: l[C.ast], stl: l[C.stl], blk: l[C.blk], tov: l[C.tov],
      };
    };
    const rows = base.map(per);
    const fgLg = sum(rows.map((r) => r.fgm)) / Math.max(1, sum(rows.map((r) => r.fga)));
    const ftLg = sum(rows.map((r) => r.ftm)) / Math.max(1, sum(rows.map((r) => r.fta)));
    const impact = (r) => ({
      ...r,
      fg: r.fgm - fgLg * r.fga, ft: r.ftm - ftLg * r.fta,
    });
    const imp = rows.map(impact);
    const stat = {};
    for (const c of CATS) {
      const xs = imp.map((r) => r[c.k]);
      const m = sum(xs) / xs.length;
      const sd = Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / xs.length) || 1;
      stat[c.k] = [m, sd];
    }
    for (const p of players) {
      if (!p.line) { p.z = -3 + p.rating * 0.3; p.zc = null; continue; }
      const r = impact(per(p));
      const zc = {};
      for (const c of CATS) {
        const [m, sd] = stat[c.k];
        zc[c.k] = ((r[c.k] - m) / sd) * (c.low ? -1 : 1);
      }
      // Availability: a player who barely plays is worth less than his per-game line.
      const avail = Math.min(1, p.line[C.min] / 24);
      p.zc = zc;
      p.z = sum(Object.values(zc)) * (0.55 + 0.45 * avail);
    }
    const sorted = players.slice().sort((a, b) => b.z - a.z);
    sorted.forEach((p, i) => (p.rank = i + 1));
  }

  function buildProspects(nba) {
    const out = [];
    const cls = (nba.draft && nba.draft["2027"]) || [];
    for (const p of cls) out.push({ id: "c-" + p.id, n: p.n, pos: p.pos, school: p.school, age: p.age, rank: p.rank, cls: 2027 });
    return out;
  }

  /* ---------- league ---------- */
  const TEAM_NAMES = [
    ["Wellesley Wingspan", "WEL"], ["Fenway Faders", "FEN"], ["Southie Splash", "STH"], ["Back Bay Bigs", "BAY"],
    ["Brookline Bucketeers", "BRK"], ["Quincy Quicksilver", "QCY"], ["Somerville Swing", "SOM"], ["Dorchester Dimes", "DOT"],
    ["Medford Mavens", "MED"], ["Newton Nets", "NWT"], ["Worcester Wolves", "WOR"], ["Revere Rebounders", "REV"],
  ];
  const BOT_STYLES = ["value", "stars", "balanced", "youth", "value", "balanced", "stars", "youth", "balanced", "value", "stars", "balanced"];

  function newLeague(opts) {
    const s = Object.assign({}, DEFAULTS, opts.settings || {});
    const seed = opts.seed || Math.floor(Math.random() * 2 ** 31);
    const r = rng(seed);
    const n = s.teams;
    const names = TEAM_NAMES.slice(0, n);
    const yourSlot = opts.yourSlot != null ? opts.yourSlot : Math.floor(r() * n);
    const teams = names.map(([name, abbr], i) => ({
      id: i, name: i === yourSlot && opts.yourName ? opts.yourName : name, abbr: i === yourSlot && opts.yourAbbr ? opts.yourAbbr : abbr,
      human: i === yourSlot, style: BOT_STYLES[i % BOT_STYLES.length], faab: s.faab,
      hist: [], prospects: [],
    }));
    return {
      v: 1, seed, created: new Date().toISOString(), name: opts.name || "Prospect League",
      ceiling: opts.ceiling, settings: s, teams, you: yourSlot,
      phase: "nba", nba: { order: snake(n, s.roster), picks: [] },
      college: { order: snake(n, s.prospects), picks: [] },
      schedule: roundRobin(n, s.regWeeks, rng(seed + 7)),
      bids: [], log: [], waived: {},
    };
  }

  function snake(n, rounds) {
    const out = [];
    for (let r = 0; r < rounds; r++) for (let i = 0; i < n; i++) out.push(r % 2 ? n - 1 - i : i);
    return out;
  }

  // Circle method, repeated and shuffled so it stretches across the regular season.
  function roundRobin(n, weeks, r) {
    const ids = [...Array(n).keys()];
    const rounds = [];
    const arr = ids.slice();
    for (let k = 0; k < n - 1; k++) {
      const pairs = [];
      for (let i = 0; i < n / 2; i++) pairs.push([arr[i], arr[n - 1 - i]]);
      rounds.push(pairs);
      arr.splice(1, 0, arr.pop());
    }
    for (let i = rounds.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [rounds[i], rounds[j]] = [rounds[j], rounds[i]]; }
    const out = [];
    for (let w = 0; w < weeks; w++) out.push(rounds[w % rounds.length].map((p) => p.slice()));
    return out;
  }

  /* ---------- rosters and payroll ---------- */
  // A roster spot is {pid, from, to}: the weeks it counts for. to = null while he's still on the team.
  const active = (team) => team.hist.filter((h) => h.to == null).map((h) => h.pid);

  function payroll(team, byId) { return sum(active(team).map((id) => (byId[id] ? byId[id].sal : 0))); }

  function owners(league) {
    const o = {};
    for (const t of league.teams) for (const id of active(t)) o[id] = t.id;
    return o;
  }

  // The k cheapest salaries still out there, skipping `skip`: what a team must hold back to fill its roster.
  function reserve(k, available, skip) {
    if (k <= 0) return 0;
    const sals = [];
    for (const p of available) if (p.id !== skip) sals.push(p.sal);
    sals.sort((a, b) => a - b);
    return sum(sals.slice(0, k));
  }

  // Can this team take this player and still fill every open spot under the ceiling?
  function check(league, team, player, ctx, opts = {}) {
    const ros = active(team);
    const dropSal = opts.drop ? ctx.byId[opts.drop].sal : 0;
    const count = ros.length - (opts.drop ? 1 : 0);
    if (count >= league.settings.roster) return { ok: false, why: "Roster is full" };
    const pay = payroll(team, ctx.byId) - dropSal;
    const open = league.settings.roster - count - 1;
    const hold = opts.noReserve ? 0 : reserve(open, ctx.available, player.id);
    const after = pay + player.sal;
    if (after + hold > league.ceiling) {
      const room = league.ceiling - pay - hold;
      return {
        ok: false, after, hold, room,
        why: hold
          ? `Over the ceiling: ${money(after)} plus ${money(hold)} held for ${open} open spot${open === 1 ? "" : "s"}`
          : `Over the ceiling by ${money(after - league.ceiling)}`,
      };
    }
    return { ok: true, after, hold, room: league.ceiling - after - hold };
  }

  function context(league, pool) {
    const byId = Object.fromEntries(pool.map((p) => [p.id, p]));
    const own = owners(league);
    const available = pool.filter((p) => own[p.id] == null);
    return { byId, own, available };
  }

  /* ---------- drafting ---------- */
  function onClock(league) {
    const d = league.phase === "college" ? league.college : league.nba;
    if (league.phase !== "nba" && league.phase !== "college") return null;
    const n = d.picks.length;
    if (n >= d.order.length) return null;
    const teams = league.teams.length;
    return { pick: n + 1, round: Math.floor(n / teams) + 1, inRound: (n % teams) + 1, team: d.order[n], total: d.order.length };
  }

  function draftNba(league, pool, pid, auto) {
    const ctx = context(league, pool);
    const clock = onClock(league);
    if (!clock || league.phase !== "nba") return { ok: false, why: "The NBA draft isn't open" };
    const p = ctx.byId[pid];
    if (!p) return { ok: false, why: "Unknown player" };
    if (ctx.own[pid] != null) return { ok: false, why: `${p.n} is already taken` };
    const team = league.teams[clock.team];
    const c = check(league, team, p, ctx);
    if (!c.ok) return c;
    team.hist.push({ pid, from: 1, to: null });
    league.nba.picks.push({ team: team.id, pid, auto: !!auto });
    if (league.nba.picks.length >= league.nba.order.length) {
      league.phase = "college";
      league.log.push({ at: Date.now(), kind: "draft", text: "NBA draft complete. The college draft is open." });
    }
    return { ok: true };
  }

  function draftCollege(league, prospects, pid, auto) {
    const clock = onClock(league);
    if (!clock || league.phase !== "college") return { ok: false, why: "The college draft isn't open" };
    const taken = new Set(league.college.picks.map((x) => x.pid));
    if (taken.has(pid)) return { ok: false, why: "Already taken" };
    if (!prospects.find((x) => x.id === pid)) return { ok: false, why: "Unknown prospect" };
    const team = league.teams[clock.team];
    if (team.prospects.length >= league.settings.prospects) return { ok: false, why: "Both prospect spots are full" };
    team.prospects.push(pid);
    league.college.picks.push({ team: team.id, pid, auto: !!auto });
    if (league.college.picks.length >= league.college.order.length) {
      league.phase = "league";
      league.log.push({ at: Date.now(), kind: "draft", text: "College draft complete. The league is live." });
    }
    return { ok: true };
  }

  // How a bot (or your autopick) values a player right now.
  function botScore(league, team, p, ctx, r) {
    const ros = active(team);
    const left = league.settings.roster - ros.length;
    const room = league.ceiling - payroll(team, ctx.byId);
    const pace = room / Math.max(1, left);              // what an average remaining spot can cost
    let s = p.z;
    const over = p.sal - pace * 1.35;
    if (over > 0) s -= over / 7.5e6;                     // don't blow the budget early
    if (team.style === "value") s += (pace - p.sal) / 2.2e7;
    if (team.style === "stars" && p.sal > 3.5e7) s += 0.8;
    if (team.style === "youth" && p.age <= 24) s += 0.7;
    if (team.style === "youth" && p.age >= 32) s -= 0.6;
    // Don't stack one position: past four guards or four bigs, everyone else looks better.
    const posCount = ros.filter((id) => ctx.byId[id] && ctx.byId[id].pos === p.pos).length;
    if (posCount >= 4) s -= 0.9 * (posCount - 3);
    return s + (r ? (r() - 0.5) * 1.1 : 0);
  }

  function autoPick(league, pool, r) {
    const ctx = context(league, pool);
    const clock = onClock(league);
    const team = league.teams[clock.team];
    let best = null, bestS = -Infinity;
    for (const p of ctx.available) {
      if (!check(league, team, p, ctx).ok) continue;
      const s = botScore(league, team, p, ctx, r);
      if (s > bestS) { bestS = s; best = p; }
    }
    return best;
  }

  function autoPickCollege(league, prospects, r) {
    const taken = new Set(league.college.picks.map((x) => x.pid));
    let best = null, bestS = -Infinity;
    for (const p of prospects) {
      if (taken.has(p.id)) continue;
      const s = -p.rank + (r ? (r() - 0.5) * 6 : 0);
      if (s > bestS) { bestS = s; best = p; }
    }
    return best;
  }

  /* ---------- the season ---------- */
  function weekDates(opener, w) {
    const o = new Date(opener + "T12:00:00");
    const mon = new Date(o); mon.setDate(o.getDate() - ((o.getDay() + 6) % 7));
    const start = w === 1 ? o : new Date(mon.getTime() + (w - 1) * 7 * 864e5);
    const end = new Date(mon.getTime() + ((w - 1) * 7 + 6) * 864e5);
    return [start, end];
  }

  function weekOf(opener, day) {
    const o = new Date(opener + "T12:00:00");
    const mon = new Date(o); mon.setDate(o.getDate() - ((o.getDay() + 6) % 7));
    const d = new Date(day); d.setHours(12, 0, 0, 0);
    return Math.max(1, Math.floor((d - mon) / (7 * 864e5)) + 1);
  }

  // Who counted for this team in week w.
  function rosterInWeek(team, w) {
    return team.hist.filter((h) => h.from <= w && (h.to == null || h.to >= w)).map((h) => h.pid);
  }

  function teamWeek(team, w, wk) {
    const lines = (wk && wk[String(w)]) || {};
    const t = Object.fromEntries(COLS.map((k) => [k, 0]));
    t.gmsc = 0;
    const per = [];
    for (const pid of rosterInWeek(team, w)) {
      const l = lines[pid];
      if (!l) { per.push({ pid, gp: 0, gmsc: 0 }); continue; }
      COLS.forEach((k, i) => (t[k] += l[i]));
      const g = gameScore(l);
      t.gmsc += g;
      per.push({ pid, gp: l[C.gp], gmsc: g, line: l });
    }
    t.fg = t.fga ? t.fgm / t.fga : null;
    t.ft = t.fta ? t.ftm / t.fta : null;
    return { t, per };
  }

  // Hollinger's Game Score over a stretch of games.
  function gameScore(l) {
    const dreb = l[C.reb] - l[C.oreb];
    return l[C.pts] + 0.4 * l[C.fgm] - 0.7 * l[C.fga] - 0.4 * (l[C.fta] - l[C.ftm]) + 0.7 * l[C.oreb] + 0.3 * dreb
      + l[C.stl] + 0.7 * l[C.ast] + 0.7 * l[C.blk] - 0.4 * l[C.pf] - l[C.tov];
  }

  function compare(a, b) {
    const res = [];
    let w = 0, l = 0, t = 0;
    for (const c of CATS) {
      let x = a[c.k], y = b[c.k];
      let out = "t";
      if (x == null && y == null) out = "t";
      else if (x == null) out = "l";
      else if (y == null) out = "w";
      else {
        const d = c.pct ? Math.round(x * 1000) - Math.round(y * 1000) : Math.round(x * 10) - Math.round(y * 10);
        out = d === 0 ? "t" : (d > 0) !== !!c.low ? "w" : "l";
      }
      if (out === "w") w++; else if (out === "l") l++; else t++;
      res.push({ cat: c, a: x, b: y, out });
    }
    return { cats: res, w, l, t };
  }

  function matchups(league, w, wk) {
    const pairs = league.schedule[w - 1] || [];
    return pairs.map(([i, j]) => {
      const A = teamWeek(league.teams[i], w, wk), B = teamWeek(league.teams[j], w, wk);
      return { a: i, b: j, A, B, cmp: compare(A.t, B.t) };
    });
  }

  // Standings count every category: a 6-3 week is six wins and three losses.
  function standings(league, upTo, wk) {
    const rows = league.teams.map((t) => ({ id: t.id, w: 0, l: 0, t: 0, mw: 0, ml: 0, mt: 0, gmsc: 0, pf: [] }));
    for (let w = 1; w <= Math.min(upTo, league.schedule.length); w++) {
      if (!wk || !wk[String(w)]) continue;
      for (const m of matchups(league, w, wk)) {
        const A = rows[m.a], B = rows[m.b], c = m.cmp;
        A.w += c.w; A.l += c.l; A.t += c.t; B.w += c.l; B.l += c.w; B.t += c.t;
        A.gmsc += m.A.t.gmsc; B.gmsc += m.B.t.gmsc;
        if (c.w > c.l) { A.mw++; B.ml++; A.pf.push("W"); B.pf.push("L"); }
        else if (c.l > c.w) { B.mw++; A.ml++; A.pf.push("L"); B.pf.push("W"); }
        else { A.mt++; B.mt++; A.pf.push("T"); B.pf.push("T"); }
      }
    }
    for (const r of rows) r.pct = r.w + r.l + r.t ? (r.w + r.t / 2) / (r.w + r.l + r.t) : 0;
    return rows.sort((a, b) => b.pct - a.pct || b.gmsc - a.gmsc);
  }

  /* ---------- free agency ---------- */
  // A blind FAAB bid. Checked again when waivers run, since rosters and payrolls move in between.
  function placeBid(league, pool, teamId, add, drop, amount, week) {
    const team = league.teams[teamId];
    const ctx = context(league, pool);
    const p = ctx.byId[add];
    if (!p) return { ok: false, why: "Unknown player" };
    if (ctx.own[add] != null) return { ok: false, why: `${p.n} is on a roster` };
    amount = Math.floor(amount);
    if (!(amount >= league.settings.minBid)) return { ok: false, why: `Bids start at $${league.settings.minBid}` };
    const pending = sum(league.bids.filter((b) => b.team === teamId).map((b) => b.amount));
    if (amount + pending > team.faab) return { ok: false, why: `You have $${team.faab - pending} of FAAB left to bid` };
    if (drop && !active(team).includes(drop)) return { ok: false, why: "You can only drop your own player" };
    if (league.waived[add] === teamId) return { ok: false, why: "You can't claim back a player you just released" };
    const c = check(league, team, p, ctx, { drop, noReserve: true });
    if (!c.ok) return c;
    league.bids.push({ team: teamId, add, drop: drop || null, amount, week, at: Date.now() });
    return { ok: true };
  }

  function dropPlayer(league, pool, teamId, pid, week) {
    const team = league.teams[teamId];
    const h = team.hist.find((x) => x.pid === pid && x.to == null);
    if (!h) return { ok: false, why: "Not on your roster" };
    h.to = week;                                   // his current week still counts; his salary is gone now
    if (h.to < h.from) team.hist.splice(team.hist.indexOf(h), 1);
    league.waived[pid] = teamId;
    league.bids = league.bids.filter((b) => !(b.team === teamId && b.drop === pid));
    const p = pool.find((x) => x.id === pid);
    league.log.push({ at: Date.now(), kind: "drop", team: teamId, text: `${team.name} released ${p ? p.n : pid}` });
    return { ok: true };
  }

  // Highest bid wins; ties go to the team lower in the standings. Losing bids cost nothing.
  function runWaivers(league, pool, week, order) {
    const results = [];
    const rankOf = Object.fromEntries((order || league.teams.map((t) => t.id)).map((id, i) => [id, i]));
    const bids = league.bids.slice().sort((a, b) => b.amount - a.amount || rankOf[b.team] - rankOf[a.team] || a.at - b.at);
    const done = new Set();
    for (const b of bids) {
      if (done.has(b.add)) { results.push({ ...b, ok: false, why: "Outbid" }); continue; }
      const team = league.teams[b.team];
      const ctx = context(league, pool);
      const p = ctx.byId[b.add];
      if (ctx.own[b.add] != null) { results.push({ ...b, ok: false, why: "Already signed" }); continue; }
      if (b.drop && !active(team).includes(b.drop)) { results.push({ ...b, ok: false, why: "Drop no longer on roster" }); continue; }
      if (b.amount > team.faab) { results.push({ ...b, ok: false, why: "Not enough FAAB" }); continue; }
      const c = check(league, team, p, ctx, { drop: b.drop, noReserve: true });
      if (!c.ok) { results.push({ ...b, ok: false, why: c.why }); continue; }
      if (b.drop) dropPlayer(league, pool, b.team, b.drop, week);
      team.hist.push({ pid: b.add, from: week + 1, to: null });
      team.faab -= b.amount;
      done.add(b.add);
      results.push({ ...b, ok: true });
      league.log.push({ at: Date.now(), kind: "add", team: b.team,
        text: `${team.name} signed ${p.n} for $${b.amount} FAAB (${money(p.sal)} salary)` + (b.drop ? `, released ${ctx.byId[b.drop].n}` : "") });
    }
    league.bids = [];
    league.waived = {};
    return results;
  }

  // Bots shop the wire once a week: the best free agent who beats their worst player, if they can afford him.
  function botBids(league, pool, week, r) {
    const ctx = context(league, pool);
    const free = ctx.available.slice().sort((a, b) => b.z - a.z).slice(0, 25);
    for (const team of league.teams) {
      if (team.human || team.faab < 1 || r() < 0.45) continue;
      const ros = active(team).map((id) => ctx.byId[id]).filter(Boolean).sort((a, b) => a.z - b.z);
      const worst = ros[0];
      if (!worst) continue;
      for (const p of free) {
        if (p.z < worst.z + 0.6) break;
        const amount = Math.max(1, Math.min(team.faab, Math.round((p.z - worst.z) * (2 + r() * 3))));
        if (placeBid(league, pool, team.id, p.id, worst.id, amount, week).ok) break;
      }
    }
  }

  const E = {
    CATS, COLS, C, DEFAULTS, rng, money, buildPool, buildProspects, rankNineCat, newLeague, snake, roundRobin,
    active, payroll, owners, reserve, check, context, onClock, draftNba, draftCollege, botScore, autoPick,
    autoPickCollege, weekDates, weekOf, rosterInWeek, teamWeek, gameScore, compare, matchups, standings,
    placeBid, dropPlayer, runWaivers, botBids,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = E;
  else root.Prospect = E;
})(this);
