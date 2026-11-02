/* Fantasy Kit: the draft. No DOM and no network: every page in a draft runs the same rules on the same saved
   document, so they agree on what happened, and a server can run it too.

   Formats: snake, linear (same order every round), 3rr (snake with the third round reversed again) and auction
   (teams nominate in turn; every bid resets the clock; the high bid wins when it runs out).

   The draft is a plain JSON object (create()). Functions take (D, ctx, ...) where ctx = context(D, players, sport,
   hooks) holds the evaluated player pool (FK.value.evaluate first). Hooks let a league add its own rules:
     hooks.check(D, team, p, ctx)  -> { ok, why }  extra legality (a salary cap, a keeper rule)
     hooks.worth(D, team, p, w, ctx) -> number     how much a bot or autopick likes a player (w is the default)
   Every change takes `now` (ms) so a replay of the same calls gives the same draft. */
(function (root, factory) {
  const m = factory(root.FK ? root.FK.sports : typeof require !== "undefined" ? require("./sports.js") : null);
  if (typeof module !== "undefined" && module.exports) module.exports = m;
  else (root.FK = root.FK || {}).draft = m;
})(this, function (S) {
  "use strict";

  const sum = (a) => a.reduce((s, x) => s + x, 0);
  function rng(seed) {                         // mulberry32
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function hash01(str) { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; }

  const FORMATS = { snake: "Snake", linear: "Linear", "3rr": "Third-round reversal", auction: "Auction" };
  const NAMES = [
    ["Night Shift", "NS"], ["Bench Mob", "BM"], ["Waiver Wire", "WW"], ["Late Scratch", "LS"], ["Deep Sleepers", "DS"], ["Box Score", "BX"],
    ["Hot Corner", "HC"], ["Full Count", "FC"], ["Red Zone", "RZ"], ["Fast Break", "FB"], ["Two Minute", "TM"], ["Garbage Time", "GT"],
    ["Pick Six", "P6"], ["Rain Delay", "RD"], ["Shot Clock", "SC"], ["Trade Deadline", "TD"], ["Home Stand", "HS"], ["Overtime", "OT"],
    ["Sixth Man", "6M"], ["Bye Week", "BW"],
  ];

  // Which team picks at each overall pick, from the first round's order.
  function makeOrder(type, first, rounds) {
    const out = [];
    for (let r = 0; r < rounds; r++) {
      const rev = type === "linear" ? false : type === "3rr" ? (r === 1 || (r >= 2 && r % 2 === 0)) : r % 2 === 1;
      out.push(...(rev ? first.slice().reverse() : first));
    }
    return out;
  }

  function create(opts) {
    const sport = typeof opts.sport === "string" ? S.ALL[opts.sport] : opts.sport;
    const lineup = opts.lineup || sport.lineup;
    const bench = opts.bench == null ? sport.bench : opts.bench;
    const rounds = lineup.length + bench;
    const seed = opts.seed == null ? Math.floor(Math.random() * 2 ** 31) : opts.seed;
    const list = Array.isArray(opts.teams) ? opts.teams : Array.from({ length: opts.teams || 10 }, () => ({}));
    const n = Math.max(2, Math.min(20, list.length));
    const r = rng(seed + 5);
    const teams = list.slice(0, n).map((t, i) => ({
      id: i, name: t.name || NAMES[i % NAMES.length][0], abbr: t.abbr || NAMES[i % NAMES.length][1],
      owner: t.owner || null, auto: !!t.auto, queue: [], budget: opts.budget || 200,
    }));
    let first = opts.order ? opts.order.slice() : [...Array(n).keys()];
    if (!opts.order) for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [first[i], first[j]] = [first[j], first[i]]; }
    const type = FORMATS[opts.type] ? opts.type : "snake";
    const D = {
      v: 1, kind: "fk-draft", sport: sport.key, type, seed, created: opts.now || Date.now(), name: opts.name || "Mock draft",
      scoring: opts.scoring || Object.keys(sport.scorings)[0],
      lineup, bench, rounds, posMax: opts.posMax || sport.posMax || {},
      clock: opts.clock == null ? 60 : opts.clock, botDelay: opts.botDelay == null ? 1500 : opts.botDelay,
      teams, round1: first, order: type === "auction" ? [] : makeOrder(type, first, rounds),
      board: type === "auction" ? [] : Array(n * rounds).fill(null), sales: [],
      phase: "setup", clockStart: null, paused: false, left: null, log: [],
      auction: type === "auction" ? { budget: opts.budget || 200, minBid: opts.minBid == null ? 1 : opts.minBid, nomClock: opts.nomClock || 30, bidClock: opts.bidClock || 15, nom: 0, lot: null } : null,
    };
    for (const k of opts.keepers || []) keep(D, k.team, k.pid, k.round, k.price);
    return D;
  }

  // A keeper takes the team's pick in that round (or, in an auction, its price comes out of the budget).
  function keep(D, teamId, pid, round, price) {
    if (D.type === "auction") {
      D.sales.push({ team: teamId, pid, price: price || D.auction.minBid, at: D.created, keeper: true });
      D.teams[teamId].budget -= price || D.auction.minBid;
      return { ok: true };
    }
    const n = D.teams.length;
    for (let k = 0; k < D.order.length; k++) {
      if (D.order[k] !== teamId || D.board[k]) continue;
      if (round != null && Math.floor(k / n) + 1 < round) continue;
      D.board[k] = { n: k + 1, team: teamId, pid, at: D.created, keeper: true };
      return { ok: true, pick: k + 1 };
    }
    return { ok: false, why: "No pick left for that keeper" };
  }

  /* ---------- who has whom ---------- */
  const made = (D) => (D.type === "auction" ? D.sales.slice() : D.board.filter(Boolean).sort((a, b) => a.at - b.at || a.n - b.n));
  function rosters(D) {
    const out = D.teams.map(() => []);
    for (const pk of D.type === "auction" ? D.sales : D.board) if (pk && pk.pid) out[pk.team].push(pk.pid);
    return out;
  }
  function context(D, players, sport, hooks) {
    sport = sport || S.ALL[D.sport];
    const byId = Object.fromEntries(players.map((p) => [p.id, p]));
    const own = {};
    rosters(D).forEach((ids, t) => ids.forEach((id) => (own[id] = t)));
    const available = players.filter((p) => own[p.id] == null).sort((a, b) => a.rank - b.rank);
    const maxVor = Math.max(1e-9, ...players.map((p) => p.vor || 0));
    return { sport, players, byId, own, available, hooks: hooks || {}, maxVor };
  }

  // Best starting lineup: a matching of players to slots, most specific slots first (augmenting paths, so a
  // G/F who blocks a better player gets moved to his other slot).
  function assign(sport, players, slots) {
    const sorted = players.slice().sort((a, b) => (b.v || 0) - (a.v || 0));
    const at = Array(slots.length).fill(null);
    const width = (s) => (sport.slots[s] === "*" ? 99 : (sport.slots[s] || []).length);
    const idx = slots.map((s, i) => i).sort((a, b) => width(slots[a]) - width(slots[b]) || a - b);
    const tryPlace = (p, seen) => {
      for (const i of idx) {
        if (seen.has(i) || !S.fits(sport, p, slots[i])) continue;
        seen.add(i);
        if (!at[i] || tryPlace(at[i], seen)) { at[i] = p; return true; }
      }
      return false;
    };
    for (const p of sorted) tryPlace(p, new Set());
    return at;
  }

  const sizeOf = (D) => D.lineup.length + D.bench;

  // Can this team take this player now? Roster room, position limits, every starting slot still fillable, and the
  // league's own rule.
  function canAdd(D, ctx, teamId, p) {
    if (!p) return { ok: false, why: "Unknown player" };
    if (ctx.own[p.id] != null) return { ok: false, why: `${p.n} is already taken` };
    const team = D.teams[teamId];
    const ids = rosters(D)[teamId];
    if (ids.length >= sizeOf(D)) return { ok: false, why: "Roster is full" };
    const mine = ids.map((id) => ctx.byId[id]).filter(Boolean);
    for (const [pos, max] of Object.entries(D.posMax || {})) {
      if (!S.positions(p).every((x) => x === pos)) continue;
      if (mine.filter((q) => S.positions(q).every((x) => x === pos)).length >= max) return { ok: false, why: `Already ${max} at ${pos}, the limit` };
    }
    const after = mine.concat(p);
    const open = D.lineup.length - assign(ctx.sport, after, D.lineup).filter(Boolean).length;
    if (open > sizeOf(D) - after.length) return { ok: false, why: `Not enough spots left to fill your starting lineup` };
    if (ctx.hooks.check) { const c = ctx.hooks.check(D, team, p, ctx); if (c && !c.ok) return c; }
    return { ok: true };
  }

  /* ---------- the clock ---------- */
  const nextIndex = (D) => D.board.findIndex((x) => !x);
  function onClock(D, now) {
    if (D.phase !== "live" || D.type === "auction") return null;
    const k = nextIndex(D);
    if (k < 0) return null;
    const n = D.teams.length;
    const len = D.clock ? D.clock * 1000 : Infinity;
    const deadline = D.clockStart + len;
    return { pick: k + 1, index: k, round: Math.floor(k / n) + 1, inRound: (k % n) + 1, team: D.order[k], total: D.order.length,
      deadline, left: D.paused ? D.left : deadline - now };
  }
  const nextPickOf = (D, teamId) => { for (let k = 0; k < D.order.length; k++) if (!D.board[k] && D.order[k] === teamId) return k + 1; return null; };
  const isBot = (t) => !t.owner || t.auto;

  function start(D, now) {
    if (D.phase !== "setup") return { ok: false, why: "The draft already started" };
    D.phase = "live"; D.clockStart = now; D.started = now; D.paused = false;
    if (D.type === "auction") skipFull(D);
    finishIfDone(D, now);
    return { ok: true };
  }

  function pause(D, now, on) {
    if (D.phase !== "live") return { ok: false, why: "The draft isn't running" };
    const lot = D.auction && D.auction.lot;
    if (on && !D.paused) {
      D.paused = true;
      D.left = lot ? lot.ends - now : D.clockStart + (D.type === "auction" ? D.auction.nomClock * 1000 : (D.clock || 1e9) * 1000) - now;
    } else if (!on && D.paused) {
      D.paused = false;
      if (lot) lot.ends = now + D.left;
      else D.clockStart = now - ((D.type === "auction" ? D.auction.nomClock * 1000 : (D.clock || 1e9) * 1000) - D.left);
      D.left = null;
    }
    return { ok: true };
  }

  function finishIfDone(D, now) {
    const full = rosters(D).every((ids) => ids.length >= sizeOf(D));
    if (D.type !== "auction" ? nextIndex(D) < 0 : full) { D.phase = "done"; D.done = now; return true; }
    return false;
  }

  /* ---------- picks ---------- */
  function pick(D, ctx, teamId, pid, now, auto) {
    const c = onClock(D, now);
    if (!c) return { ok: false, why: "The draft isn't open" };
    if (c.team !== teamId) return { ok: false, why: "It's not your pick" };
    const p = ctx.byId[pid];
    const ok = canAdd(D, ctx, teamId, p);
    if (!ok.ok) return ok;
    D.board[c.index] = { n: c.pick, team: teamId, pid, at: now, auto: !!auto };
    ctx.own[pid] = teamId;
    ctx.available = ctx.available.filter((x) => x.id !== pid);
    for (const t of D.teams) t.queue = t.queue.filter((x) => x !== pid);
    D.clockStart = now;
    finishIfDone(D, now);
    return { ok: true, pick: c.pick };
  }

  // How much a bot (or an autopick) wants a player: his auction value, a little less for a bench spot while
  // starters are open, nothing for a kicker before the last rounds, and some noise so bots don't all agree.
  function worth(D, ctx, teamId, p, r) {
    const ids = rosters(D)[teamId];
    const mine = ids.map((id) => ctx.byId[id]).filter(Boolean);
    const left = sizeOf(D) - ids.length;
    const filled = assign(ctx.sport, mine, D.lineup).filter(Boolean).length;
    const fillsStarter = assign(ctx.sport, mine.concat(p), D.lineup).filter(Boolean).length > filled;
    const openStarters = D.lineup.length - filled;
    let w = (p.$ || 0) + Math.max(0, p.vor || 0) / ctx.maxVor;
    if (S.isLate(ctx.sport, p)) {
      const lateOpen = D.lineup.filter((s) => (ctx.sport.slots[s] || []) !== "*" && ctx.sport.late.some((x) => (ctx.sport.slots[s] || []).includes(x))).length;
      if (left > lateOpen + 1) w *= 0.05;
    }
    if (!fillsStarter && openStarters > 0) w *= left <= openStarters + 1 ? 0.1 : 0.75;
    if (r) w *= 0.85 + r() * 0.3;
    if (ctx.hooks.worth) w = ctx.hooks.worth(D, D.teams[teamId], p, w, ctx);
    return w;
  }

  // The pick a team gets when its clock runs out: its queue first, then the best fit.
  function autoChoice(D, ctx, teamId, r) {
    const team = D.teams[teamId];
    for (const id of team.queue || []) { const p = ctx.byId[id]; if (p && canAdd(D, ctx, teamId, p).ok) return p; }
    let best = null, bw = -Infinity;
    for (const p of ctx.available.slice(0, 300)) {
      const w = worth(D, ctx, teamId, p, r);
      if (w > bw && canAdd(D, ctx, teamId, p).ok) { bw = w; best = p; }
    }
    if (best) return best;
    return ctx.available.find((p) => canAdd(D, ctx, teamId, p).ok) || null;
  }

  // Moves the draft forward to `now`: bots pick after a short delay, a manager whose clock ran out gets an
  // autopick stamped at the moment it expired.
  function tick(D, ctx, now, max = 1000) {
    if (D.type === "auction") return auctionTick(D, ctx, now, max);
    let n = 0;
    while (n < max && D.phase === "live" && !D.paused) {
      const c = onClock(D, now);
      if (!c) break;
      const team = D.teams[c.team];
      const at = isBot(team) ? D.clockStart + D.botDelay : c.deadline;
      if (now < at) break;
      const p = autoChoice(D, ctx, c.team, rng(D.seed + c.index * 31 + 7));
      if (!p) { D.board[c.index] = { n: c.pick, team: c.team, pid: null, at, auto: true }; D.clockStart = at; finishIfDone(D, at); n++; continue; }
      const res = pick(D, ctx, c.team, p.id, at, true);
      if (!res.ok) break;
      n++;
    }
    return n;
  }

  function undo(D, ctx, now) {
    if (D.type === "auction") {
      const k = D.sales.map((s) => !s.keeper).lastIndexOf(true);
      if (k < 0) return { ok: false, why: "Nothing to undo" };
      const s = D.sales.splice(k, 1)[0];
      D.teams[s.team].budget += s.price;
      D.auction.lot = null; D.phase = "live"; D.clockStart = now;
      if (ctx) refresh(D, ctx);
      return { ok: true, sale: s };
    }
    let k = -1, at = -Infinity;
    D.board.forEach((pk, i) => { if (pk && !pk.keeper && (pk.at > at || (pk.at === at && i > k))) { at = pk.at; k = i; } });
    if (k < 0) return { ok: false, why: "Nothing to undo" };
    const pk = D.board[k];
    D.board[k] = null; D.phase = "live"; D.clockStart = now; delete D.done;
    if (ctx) refresh(D, ctx);
    return { ok: true, pick: pk };
  }
  function refresh(D, ctx) { const c = context(D, ctx.players, ctx.sport, ctx.hooks); Object.assign(ctx, c); }

  /* ---------- auction ---------- */
  const spotsLeft = (D, teamId) => sizeOf(D) - rosters(D)[teamId].length;
  // The most a team can bid and still have the minimum for every other open spot.
  const maxBid = (D, teamId) => { const left = spotsLeft(D, teamId); return left <= 0 ? 0 : D.teams[teamId].budget - D.auction.minBid * (left - 1); };

  function skipFull(D) {
    const n = D.round1.length;
    for (let i = 0; i < n; i++) {
      const t = D.round1[D.auction.nom % n];
      if (spotsLeft(D, t) > 0) return t;
      D.auction.nom++;
    }
    return null;
  }
  const nominator = (D) => (D.type === "auction" && D.phase === "live" ? D.round1[D.auction.nom % D.round1.length] : null);

  function auctionState(D, now) {
    if (D.type !== "auction" || D.phase !== "live") return null;
    const A = D.auction;
    if (A.lot) return { kind: "lot", lot: A.lot, ends: A.lot.ends, left: D.paused ? D.left : A.lot.ends - now };
    const t = nominator(D);
    return { kind: "nominate", team: t, ends: D.clockStart + A.nomClock * 1000, left: D.paused ? D.left : D.clockStart + A.nomClock * 1000 - now };
  }

  function nominate(D, ctx, teamId, pid, amt, now) {
    const st = auctionState(D, now);
    if (!st || st.kind !== "nominate") return { ok: false, why: "Nothing to nominate right now" };
    if (st.team !== teamId) return { ok: false, why: "It's not your nomination" };
    const p = ctx.byId[pid];
    const ok = canAdd(D, ctx, teamId, p);
    if (!ok.ok) return ok;
    amt = Math.max(D.auction.minBid, Math.round(amt || D.auction.minBid));
    if (amt > maxBid(D, teamId)) return { ok: false, why: `You can bid at most $${maxBid(D, teamId)}` };
    D.auction.lot = { pid, by: teamId, bid: amt, team: teamId, ends: now + D.auction.bidClock * 1000, at: now, bids: [[teamId, amt, now]], passed: [] };
    botsRespond(D, ctx, now);
    settle(D, ctx, now);
    return { ok: true };
  }

  function bid(D, ctx, teamId, amt, now) {
    const lot = D.auction && D.auction.lot;
    if (!lot || D.phase !== "live") return { ok: false, why: "Nothing is up for bid" };
    if (D.paused) return { ok: false, why: "The draft is paused" };
    if (now >= lot.ends) return { ok: false, why: "Bidding closed" };
    amt = Math.round(amt);
    if (amt <= lot.bid) return { ok: false, why: `The bid is already $${lot.bid}` };
    if (amt > maxBid(D, teamId)) return { ok: false, why: `You can bid at most $${maxBid(D, teamId)}` };
    const ok = canAdd(D, ctx, teamId, ctx.byId[lot.pid]);
    if (!ok.ok) return ok;
    lot.bid = amt; lot.team = teamId; lot.ends = now + D.auction.bidClock * 1000; lot.bids.push([teamId, amt, now]);
    lot.passed = (lot.passed || []).filter((x) => x !== teamId);
    botsRespond(D, ctx, now);
    settle(D, ctx, now);
    return { ok: true };
  }

  // A manager who is out on this player. When every manager who could still bid has passed (bots answer at once),
  // the lot closes in three seconds instead of running out the clock.
  function pass(D, ctx, teamId, now) {
    const lot = D.auction && D.auction.lot;
    if (!lot || D.phase !== "live") return { ok: false, why: "Nothing is up for bid" };
    if (lot.team === teamId) return { ok: false, why: "You have the high bid" };
    lot.passed = lot.passed || [];
    if (!lot.passed.includes(teamId)) lot.passed.push(teamId);
    settle(D, ctx, now);
    return { ok: true };
  }
  function settle(D, ctx, now) {
    const lot = D.auction.lot;
    if (!lot) return;
    const p = ctx.byId[lot.pid];
    const live = D.teams.filter((t) => !isBot(t) && t.id !== lot.team && !(lot.passed || []).includes(t.id) && maxBid(D, t.id) > lot.bid && canAdd(D, ctx, t.id, p).ok);
    if (!live.length) lot.ends = Math.min(lot.ends, now + 3000);
  }

  // A bot's top price: the player's auction value, moved by how much money it has per open spot against the
  // league, how much it needs him, and a little private taste.
  function botMax(D, ctx, teamId, p) {
    if (!canAdd(D, ctx, teamId, p).ok) return 0;
    const left = spotsLeft(D, teamId);
    const rich = (D.teams[teamId].budget / left) / Math.max(1, sum(D.teams.map((t) => t.budget)) / Math.max(1, sum(D.teams.map((t) => spotsLeft(D, t.id)))));
    const base = worth(D, ctx, teamId, p, null) * (0.85 + 0.3 * hash01(`${D.seed}:${teamId}:${p.id}`));
    const v = Math.floor(base * Math.min(1.35, Math.max(0.6, Math.sqrt(rich))));
    return Math.min(maxBid(D, teamId), Math.max(v, (p.$ || 0) >= 1 && left > 0 ? D.auction.minBid : 0));
  }

  // Bots bid by proxy: the bot with the highest top price leads at one dollar over the next best price.
  function botsRespond(D, ctx, now) {
    const lot = D.auction.lot;
    const p = ctx.byId[lot.pid];
    const tops = D.teams.filter((t) => isBot(t)).map((t) => [t.id, botMax(D, ctx, t.id, p)]).filter(([, m]) => m > 0);
    const leaderHuman = !isBot(D.teams[lot.team]);
    const field = tops.slice();
    if (leaderHuman) field.push([lot.team, lot.bid, true]);
    field.sort((a, b) => b[1] - a[1] || (a[2] ? -1 : 1));
    const top = field[0];
    if (!top || top[2]) return;                                    // a manager holds the high bid
    const second = field[1] ? field[1][1] : 0;
    const price = Math.min(top[1], Math.max(top[0] === lot.team ? lot.bid : lot.bid + 1, second + 1));
    if (price <= lot.bid && top[0] === lot.team) return;
    if (price <= lot.bid) return;
    lot.bid = price; lot.team = top[0]; lot.ends = now + D.auction.bidClock * 1000; lot.bids.push([top[0], price, now]);
  }

  function sell(D, ctx, at) {
    const lot = D.auction.lot;
    D.sales.push({ team: lot.team, pid: lot.pid, price: lot.bid, at, by: lot.by });
    D.teams[lot.team].budget -= lot.bid;
    for (const t of D.teams) t.queue = t.queue.filter((x) => x !== lot.pid);
    D.auction.lot = null; D.auction.nom++;
    D.clockStart = at;
    refresh(D, ctx);
    if (!finishIfDone(D, at)) skipFull(D);
  }

  function auctionTick(D, ctx, now, max) {
    let n = 0;
    while (n < max && D.phase === "live" && !D.paused) {
      const A = D.auction;
      if (A.lot) {
        if (now < A.lot.ends) break;
        sell(D, ctx, A.lot.ends); n++; continue;
      }
      const t = skipFull(D);
      if (t == null) { finishIfDone(D, now); break; }
      const team = D.teams[t];
      const at = isBot(team) ? D.clockStart + D.botDelay : D.clockStart + A.nomClock * 1000;
      if (now < at) break;
      const r = rng(D.seed + D.sales.length * 17 + 3);
      const queued = (team.queue || []).map((id) => ctx.byId[id]).find((p) => p && canAdd(D, ctx, t, p).ok);
      const p = queued || autoChoice(D, ctx, t, r);
      if (!p) { A.nom++; D.clockStart = at; n++; continue; }
      nominate(D, ctx, t, p.id, A.minBid, at);
      n++;
    }
    return n;
  }

  /* ---------- results ---------- */
  // Each team's best lineup and what it adds up to: summed category z-scores or projected points of its starters.
  function standings(D, ctx) {
    const rows = rosters(D).map((ids, t) => {
      const ps = ids.map((id) => ctx.byId[id]).filter(Boolean);
      const starters = assign(ctx.sport, ps, D.lineup);
      const score = sum(starters.filter(Boolean).map((p) => p.v || 0));
      const cats = {};
      for (const p of starters.filter(Boolean)) for (const [k, z] of Object.entries(p.zc || {})) cats[k] = (cats[k] || 0) + z;
      const spent = D.type === "auction" ? sum(D.sales.filter((s) => s.team === t).map((s) => s.price)) : null;
      return { team: t, score, starters, bench: ps.filter((p) => !starters.includes(p)), cats, spent };
    });
    const sorted = rows.slice().sort((a, b) => b.score - a.score);
    sorted.forEach((r, i) => { r.rank = i + 1; r.grade = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D"][Math.min(9, Math.floor((i / Math.max(1, rows.length - 1)) * 9.99))]; });
    return rows;
  }

  return { FORMATS, NAMES, rng, hash01, makeOrder, create, keep, made, rosters, context, assign, canAdd, onClock, nextPickOf, isBot,
    start, pause, pick, worth, autoChoice, tick, undo, maxBid, spotsLeft, nominator, auctionState, nominate, bid, pass, botMax, standings, sizeOf };
});
