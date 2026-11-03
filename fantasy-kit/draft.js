/* Fantasy Kit: the draft. No DOM and no network: every page in a draft runs the same rules on the same saved
   document, so they agree on what happened, and a server can run it too.

   Formats: snake, linear (same order every round), 3rr (snake with the third round reversed again), mystery (every
   team gets a random package of picks dealt so the packages add up to the same value) and auction (teams nominate
   in turn; every bid resets the clock; the high bid wins when it runs out). Every format but auction can trade picks
   and drafted players while the draft runs.

   White elephant ("elephant") is a snake where your turn can be a steal: take a player someone already drafted.
   The team you took him from picks again right away (a make-up pick) and can't take him straight back. A player
   freezes after `steals.freeze` steals (2), each team gets `steals.perTeam` steals a draft (3), and steals stop
   for the last `steals.lastRounds` rounds (2).

   The draft is a plain JSON object (create()). Functions take (D, ctx, ...) where ctx = context(D, players, sport,
   hooks) holds the evaluated player pool (FK.value.evaluate first). Hooks let a league add its own rules:
     hooks.check(D, team, p, ctx)  -> { ok, why }  extra legality (a salary cap, a keeper rule)
     hooks.worth(D, team, p, w, ctx) -> number     how much a bot or autopick likes a player (w is the default)
   Clocks: a clock per pick (clock: seconds), or a time bank (bank: { perRound, floor }): each team gets one clock for
   the whole draft, perRound seconds for every round. Once it's gone every pick gets `floor` seconds. What's left at
   the end becomes FAAB in the league (bankShare). Bots don't really wait, so they're charged a made-up think time.

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

  const FORMATS = { snake: "Snake", linear: "Linear", "3rr": "Third-round reversal", mystery: "Mystery packages", elephant: "White elephant", auction: "Auction" };
  const REVEALS = { start: "When the draft starts", own: "Yours at the start, the rest as they come up", now: "Right away" };
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
    const rounds = opts.rounds || lineup.length + bench;
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
      teams, round1: first, order: type === "auction" ? [] : type === "mystery" ? Array(n * rounds).fill(0) : makeOrder(type === "elephant" ? "snake" : type, first, rounds),
      board: type === "auction" ? [] : Array(n * rounds).fill(null), sales: [],
      phase: "setup", clockStart: null, paused: false, left: null, log: [],
      auction: type === "auction" ? { budget: opts.budget || 200, minBid: opts.minBid == null ? 1 : opts.minBid, nomClock: opts.nomClock || 30, bidClock: opts.bidClock || 15, nom: 0, lot: null } : null,
      bank: type !== "auction" && opts.bank ? { perRound: opts.bank.perRound || 30, floor: opts.bank.floor == null ? 10 : opts.bank.floor } : null,
      trading: type !== "auction" && type !== "elephant" && opts.trades !== false,
      steals: type === "elephant" ? { freeze: (opts.steals && opts.steals.freeze) || 2, perTeam: (opts.steals && opts.steals.perTeam) || 3, lastRounds: opts.steals && opts.steals.lastRounds != null ? opts.steals.lastRounds : 2 } : null,
      extra: {}, botOffers: opts.botOffers !== false, trades: [], via: {}, offered: {},
    };
    if (D.bank) for (const t of D.teams) t.bank = D.bank.perRound * rounds * 1000;
    if (type === "mystery") {
      const curve = (opts.curve || defaultCurve(n * rounds)).slice(0, n * rounds).map((v) => Math.round(v * 100) / 100);
      D.mystery = { reveal: REVEALS[opts.reveal] ? opts.reveal : "start", curve, tolerance: opts.tolerance == null ? 0.01 : opts.tolerance };
      applyDeal(D, dealPackages(n, rounds, curve, seed, { tolerance: D.mystery.tolerance }));
    }
    for (const k of opts.keepers || []) keep(D, k.team, k.pid, k.round, k.price);
    // a dynasty's rookie and free agent draft: every team brings its whole roster (D.carry) and adds a few rounds
    if (opts.carry) D.carry = D.teams.map((t) => (opts.carry[t.id] || []).slice());
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
    const out = D.teams.map((t) => (D.carry && D.carry[t.id] ? D.carry[t.id].slice() : []));
    for (const pk of D.type === "auction" ? D.sales : D.board) if (pk && pk.pid && !pk.gone) out[pk.team].push(pk.pid);
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

  const sizeOf = (D) => D.lineup.length + D.bench + (D.carry ? D.rounds : 0);

  // Can this team take this player now? Roster room, position limits, every starting slot still fillable, and the
  // league's own rule.
  function canAdd(D, ctx, teamId, p) {
    if (!p) return { ok: false, why: "Unknown player" };
    if (ctx.own[p.id] != null) return { ok: false, why: `${p.n} is already taken` };
    return fitsRoster(D, ctx, teamId, p);
  }
  // Room for him on this roster: size, position limits, the starting lineup still fillable, the league's own rule.
  function fitsRoster(D, ctx, teamId, p) {
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
  // How long the pick on the clock gets: the pick clock, or what's left of the team's bank (never under the floor).
  function clockLen(D, k) {
    if (D.bank) { const t = D.teams[D.order[k]]; return Math.max(t.bank, D.bank.floor * 1000); }
    return D.clock ? D.clock * 1000 : Infinity;
  }
  // A bot's (or an autodrafting manager's) pretend time on a pick: each one has its own pace, and some picks take longer.
  const thinkTime = (D, teamId, k) => Math.round((5 + 20 * hash01(`${D.seed}:pace:${teamId}`)) * (0.4 + 1.2 * hash01(`${D.seed}:think:${k}`)) * 1000);
  function charge(D, k, teamId, now) {
    if (!D.bank) return;
    const t = D.teams[teamId];
    const used = isBot(t) ? Math.min(thinkTime(D, teamId, k), clockLen(D, k)) : Math.max(0, now - D.clockStart);
    t.bank = Math.max(0, t.bank - used);
  }
  // What share of each team's bank was left when the draft ended, 0 to 1.
  const bankShare = (D) => D.teams.map((t) => (D.bank ? Math.max(0, Math.min(1, t.bank / (D.bank.perRound * D.rounds * 1000))) : null));
  function onClock(D, now) {
    if (D.phase !== "live" || D.type === "auction") return null;
    const k = nextIndex(D);
    if (k < 0) return null;
    const n = D.teams.length;
    const len = clockLen(D, k);
    const deadline = D.clockStart + len;
    const si = slotInfo(D, k);
    return { pick: k + 1, index: k, round: si.round, inRound: si.inRound, makeup: si.makeup, team: D.order[k], total: D.order.length,
      deadline, left: D.paused ? D.left : deadline - now };
  }
  // A pick's round and place in the round, counting only scheduled picks (make-up picks after a steal sit between them).
  function slotInfo(D, k) {
    const n = D.teams.length, ex = D.extra || {};
    let sched = 0;
    if (Object.keys(ex).length) { for (let i = 0; i < k; i++) if (!ex[i]) sched++; } else sched = k;
    if (ex[k]) return { round: Math.floor(Math.max(0, sched - 1) / n) + 1, inRound: null, makeup: ex[k] };
    return { round: Math.floor(sched / n) + 1, inRound: (sched % n) + 1, makeup: null };
  }
  const nextPickOf = (D, teamId) => { for (let k = 0; k < D.order.length; k++) if (!D.board[k] && D.order[k] === teamId) return k + 1; return null; };
  const isBot = (t) => !t.owner || t.auto;
  // Autodraft only makes picks: trades are for teams nobody manages, never on a manager's behalf.
  const tradesForThem = (t) => !t.owner;

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
      D.left = lot ? lot.ends - now : D.clockStart + (D.type === "auction" ? D.auction.nomClock * 1000 : Math.min(1e12, clockLen(D, nextIndex(D)))) - now;
    } else if (!on && D.paused) {
      D.paused = false;
      if (lot) lot.ends = now + D.left;
      else D.clockStart = now - ((D.type === "auction" ? D.auction.nomClock * 1000 : Math.min(1e12, clockLen(D, nextIndex(D)))) - D.left);
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
    charge(D, c.index, teamId, now);
    D.board[c.index] = { n: c.pick, team: teamId, pid, at: now, auto: !!auto };
    ctx.own[pid] = teamId;
    ctx.available = ctx.available.filter((x) => x.id !== pid);
    for (const t of D.teams) t.queue = t.queue.filter((x) => x !== pid);
    D.clockStart = now;
    finishIfDone(D, now);
    expireTrades(D, ctx, now);
    return { ok: true, pick: c.pick };
  }

  // How much a bot (or an autopick) wants a player: his auction value, a little less for a bench spot while
  // starters are open, nothing for a kicker before the last rounds, and some noise so bots don't all agree.
  // What a team's roster needs right now, worked out once per pick: whether a player fills an open starting slot
  // depends only on his positions, so that answer is kept per position set.
  function needs(D, ctx, teamId) {
    const ids = rosters(D)[teamId];
    const mine = ids.map((id) => ctx.byId[id]).filter(Boolean);
    const filled = assign(ctx.sport, mine, D.lineup).filter(Boolean).length;
    const lateOpen = D.lineup.filter((s) => (ctx.sport.slots[s] || []) !== "*" && ctx.sport.late.some((x) => (ctx.sport.slots[s] || []).includes(x))).length;
    const memo = new Map();
    const fills = (p) => {
      const k = S.positions(p).join("/");
      if (!memo.has(k)) memo.set(k, assign(ctx.sport, mine.concat(p), D.lineup).filter(Boolean).length > filled);
      return memo.get(k);
    };
    return { left: sizeOf(D) - ids.length, openStarters: D.lineup.length - filled, lateOpen, fills };
  }
  function worth(D, ctx, teamId, p, r, need) {
    const { left, openStarters, lateOpen, fills } = need || needs(D, ctx, teamId);
    const fillsStarter = fills(p);
    let w = (p.$ || 0) + Math.max(0, p.vor || 0) / ctx.maxVor;
    if (S.isLate(ctx.sport, p)) {
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
    const need = needs(D, ctx, teamId);
    for (const p of ctx.available.slice(0, 300)) {
      const w = worth(D, ctx, teamId, p, r, need);
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
      if (!isBot(team) && !D.offered[c.index]) { D.offered[c.index] = true; botOffer(D, ctx, c, now); }
      const at = isBot(team) ? D.clockStart + D.botDelay : c.deadline;
      if (now < at) break;
      if (isBot(team) && team.owner == null && D.steals) {
        const st = botSteal(D, ctx, c, rng(D.seed + c.index * 37 + 3));
        if (st) { steal(D, ctx, c.team, st.id, at); n++; continue; }
      }
      const p = autoChoice(D, ctx, c.team, rng(D.seed + c.index * 31 + 7));
      if (!p) { charge(D, c.index, c.team, at); D.board[c.index] = { n: c.pick, team: c.team, pid: null, at, auto: true }; D.clockStart = at; finishIfDone(D, at); n++; continue; }
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
    if (pk.steal) {
      const was = D.board.find((x) => x && x.gone && x.stolenAt === k);
      if (was) { was.gone = false; delete was.stolenAt; }
      if (D.extra[k + 1] && !D.board[k + 1]) removePick(D, k + 1);
    }
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



  /* ---------- white elephant ---------- */
  // Every board entry that ever held this player, and how many times he's been stolen.
  const stealsOf = (D, pid) => D.board.filter((x) => x && x.pid === pid && x.steal).length;
  const stealsLeft = (D, teamId) => (D.steals ? D.steals.perTeam - D.board.filter((x) => x && x.steal && x.team === teamId).length : 0);
  const activeEntry = (D, pid) => D.board.find((x) => x && x.pid === pid && !x.gone);
  function stealsOpen(D, k) {
    if (!D.steals) return false;
    return slotInfo(D, k).round <= D.rounds - D.steals.lastRounds;
  }
  // Can the team on the clock take this player off another roster right now?
  function canSteal(D, ctx, teamId, pid, now) {
    if (!D.steals) return { ok: false, why: "No steals in this draft" };
    const c = onClock(D, now);
    if (!c) return { ok: false, why: "The draft isn't open" };
    if (c.team !== teamId) return { ok: false, why: "It's not your pick" };
    if (!stealsOpen(D, c.index)) return { ok: false, why: `No steals in the last ${D.steals.lastRounds} rounds` };
    const p = ctx.byId[pid], from = ctx.own[pid];
    if (!p || from == null) return { ok: false, why: "Nobody has him to steal" };
    if (from === teamId) return { ok: false, why: "He's already yours" };
    if (stealsLeft(D, teamId) <= 0) return { ok: false, why: `You've used all ${D.steals.perTeam} steals` };
    const e = activeEntry(D, pid);
    if (e && e.keeper) return { ok: false, why: `${p.n} is a keeper` };
    if (stealsOf(D, pid) >= D.steals.freeze) return { ok: false, why: `${p.n} is frozen: stolen ${D.steals.freeze} times` };
    const mk = D.extra[c.index];
    if (mk && mk.forbid === pid) return { ok: false, why: `You can't steal ${p.n} straight back` };
    return fitsRoster(D, ctx, teamId, p);
  }
  // A new pick slot right after index j, for `team`. Everything keyed by pick index past j moves up one.
  function insertPick(D, j, team, info) {
    D.order.splice(j, 0, team); D.board.splice(j, 0, null);
    const shift = (obj) => { const out = {}; for (const [k, v] of Object.entries(obj || {})) out[+k >= j ? +k + 1 : k] = v; return out; };
    D.extra = shift(D.extra); D.via = shift(D.via); D.offered = shift(D.offered);
    for (const x of D.board) if (x && x.stolenAt != null && x.stolenAt >= j) x.stolenAt++;
    D.extra[j] = info;
  }
  function removePick(D, j) {
    D.order.splice(j, 1); D.board.splice(j, 1);
    const shift = (obj) => { const out = {}; for (const [k, v] of Object.entries(obj || {})) { if (+k === j) continue; out[+k > j ? +k - 1 : k] = v; } return out; };
    D.extra = shift(D.extra); D.via = shift(D.via); D.offered = shift(D.offered);
  }
  function steal(D, ctx, teamId, pid, now) {
    const ok = canSteal(D, ctx, teamId, pid, now);
    if (!ok.ok) return ok;
    const c = onClock(D, now), from = ctx.own[pid], e = activeEntry(D, pid);
    charge(D, c.index, teamId, now);
    e.gone = true; e.stolenAt = c.index;
    D.board[c.index] = { n: c.pick, team: teamId, pid, at: now, steal: true, from };
    insertPick(D, c.index + 1, from, { from: teamId, forbid: pid, at: now });
    // board entries after the new slot keep their own pick numbers in sync
    D.board.forEach((x, i) => { if (x) x.n = i + 1; });
    for (const t of D.teams) t.queue = t.queue.filter((x) => x !== pid);
    D.clockStart = now;
    D.log.push({ kind: "steal", at: now, team: teamId, from, pid });
    refresh(D, ctx);
    return { ok: true, from, pick: c.pick };
  }
  // A bot steals when a drafted player is worth clearly more to it than the best one left, and some bots are greedier
  // than others.
  function botSteal(D, ctx, c, r) {
    if (!stealsOpen(D, c.index)) return null;
    if (stealsLeft(D, c.team) <= 0) return null;
    // greedier bots steal more, and everyone steals more as the good players dry up
    const greed = 0.15 + 0.5 * hash01(`${D.seed}:greed:${c.team}`);
    if (r() > (greed + 0.05) * (0.25 + slotInfo(D, c.index).round / D.rounds)) return null;
    const best = autoChoice(D, ctx, c.team, null);
    const bw = best ? worth(D, ctx, c.team, best, null) : 0;
    let pickP = null, pw = -Infinity;
    for (const [id, t] of Object.entries(ctx.own)) {
      if (t === c.team) continue;
      const p = ctx.byId[id];
      if (!p || !canSteal(D, ctx, c.team, id, D.clockStart).ok) continue;
      const w = worth(D, ctx, c.team, p, null);
      if (w > pw) { pw = w; pickP = p; }
    }
    return pickP && pw > bw * (1.7 - greed * 0.6) + 2 ? pickP : null;
  }

  /* ---------- mystery packages ---------- */
  // What each pick is worth before the draft: the auction dollars of the k-th best player, plus a dollar so a late
  // pick still counts for something. Without a player pool, a curve with the same shape.
  function pickCurve(players, total) {
    const vals = (players || []).map((p) => Math.max(0, p.$ || 0)).sort((a, b) => b - a);
    return Array.from({ length: total }, (_, k) => (k < vals.length ? vals[k] : 0) + 1);
  }
  const defaultCurve = (total) => Array.from({ length: total }, (_, k) => 1 + 60 * Math.exp(-k / Math.max(1, total * 0.18)));
  function spreadOf(tots) { const mean = sum(tots) / tots.length; return mean ? (Math.max(...tots) - Math.min(...tots)) / mean : 0; }

  // Deals n packages of R picks: a random split, then swaps between the richest team and the others (the swap that
  // closes their gap closest to halfway) until the richest and poorest are within `tolerance` of the average. Each
  // swap shrinks the spread of totals, so it always stops; a few fresh shuffles keep the best deal.
  function dealPackages(n, R, curve, seed, opts = {}) {
    const N = n * R, tol = opts.tolerance == null ? 0.01 : opts.tolerance;
    let best = null;
    for (let tryN = 0; tryN < (opts.restarts || 8); tryN++) {
      const r = rng(seed * 7 + tryN * 977 + 13);
      const idx = [...Array(N).keys()];
      for (let i = N - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      const packs = Array.from({ length: n }, (_, t) => idx.slice(t * R, (t + 1) * R));
      const tot = packs.map((ks) => sum(ks.map((k) => curve[k])));
      const trySwap = (a, b, gap) => {          // move value gap/2 from team a to team b
        let bi = -1, bj = -1, be = Infinity;
        for (let i = 0; i < R; i++) for (let j = 0; j < R; j++) {
          const g = curve[packs[a][i]] - curve[packs[b][j]];
          if (g <= 1e-9 || g >= gap - 1e-9) continue;
          const e = Math.abs(g - gap / 2);
          if (e < be) { be = e; bi = i; bj = j; }
        }
        if (bi < 0) return false;
        const g = curve[packs[a][bi]] - curve[packs[b][bj]];
        [packs[a][bi], packs[b][bj]] = [packs[b][bj], packs[a][bi]];
        tot[a] -= g; tot[b] += g;
        return true;
      };
      for (let it = 0; it < 5000; it++) {
        if (spreadOf(tot) <= tol) break;
        const order = [...Array(n).keys()].sort((a, b) => tot[b] - tot[a]);
        let moved = false;
        for (let x = 0; x < n && !moved; x++) for (let y = n - 1; y > x && !moved; y--) moved = trySwap(order[x], order[y], tot[order[x]] - tot[order[y]]);
        if (!moved) break;
      }
      const sp = spreadOf(tot);
      if (!best || sp < best.spread) best = { packs: packs.map((ks) => ks.slice().sort((a, b) => a - b)), tots: tot.slice(), spread: sp };
      if (sp <= tol) break;
    }
    return best;
  }
  function applyDeal(D, deal) {
    deal.packs.forEach((ks, t) => ks.forEach((k) => (D.order[k] = t)));
    D.mystery.packs = deal.packs;
    D.mystery.tots = deal.tots.map((v) => Math.round(v * 10) / 10);
    D.mystery.spread = deal.spread;
  }

  // The bot-draft check: deal a few sets of packages, let bots draft each one, and keep the deal where the bot teams
  // finished closest together. Every deal already balances on paper; this catches the ones where the way the picks
  // cluster (three picks in a row, a long wait) makes one package play better than the others.
  function fairDeal(D, players, sport, hooks, opts = {}) {
    if (D.type !== "mystery" || D.phase !== "setup") return null;
    const n = D.teams.length, tries = opts.tries || 5, out = [];
    let best = null;
    for (let i = 0; i < tries; i++) {
      const deal = dealPackages(n, D.rounds, D.mystery.curve, D.seed + 101 * i, { tolerance: D.mystery.tolerance });
      const T = JSON.parse(JSON.stringify(D));
      applyDeal(T, deal);
      T.teams.forEach((t) => { t.auto = true; t.queue = []; });
      T.botDelay = 0; T.botOffers = false; T.trading = false;
      const ctx = context(T, players, sport, hooks);
      start(T, 0); tick(T, ctx, 1e13, 100000);
      const scores = standings(T, ctx).map((r) => r.score);
      const range = Math.max(...scores) - Math.min(...scores);
      out.push(range);
      if (!best || range < best.range) best = { deal, range, i };
    }
    applyDeal(D, best.deal);
    const sorted = out.slice().sort((a, b) => a - b);
    D.mystery.test = { tries, kept: best.i, range: best.range, median: sorted[Math.floor(sorted.length / 2)], worst: sorted[sorted.length - 1] };
    return D.mystery.test;
  }

  // Can `viewer` see who owns pick k? Packages stay sealed until the draft starts. With reveal "own" you see your
  // own picks at the start and everyone else's once they're on the clock.
  function seen(D, k, viewer) {
    if (D.type !== "mystery" || D.board[k] || D.mystery.reveal === "now") return true;
    if (D.phase === "setup") return false;
    if (D.mystery.reveal === "start" || D.phase === "done") return true;
    if (viewer != null && D.order[k] === viewer) return true;
    const id = pickId(k);                       // a pick you traded away, or saw in a deal you made, stays known
    if (viewer != null && (D.trades || []).some((T) => T.status === "accepted" && (T.from === viewer || T.to === viewer) && (T.give.includes(id) || T.get.includes(id)))) return true;
    const next = nextIndex(D);
    return next >= 0 && k <= next;
  }

  /* ---------- trades during the draft ---------- */
  const PICK = "pick:";
  const isPickId = (x) => String(x).startsWith(PICK);
  const pickId = (k) => PICK + k;
  const pickIdx = (x) => +String(x).slice(PICK.length);
  function pickLabel(D, k) {
    if (D.type === "mystery") return `Pick ${k + 1}`;
    const si = slotInfo(D, k);
    return si.makeup ? `${si.round}.M` : `${si.round}.${si.inRound}`;
  }
  // A team's picks still to make, and its players so far.
  const picksOf = (D, teamId) => D.order.map((t, k) => (t === teamId && !D.board[k] ? k : -1)).filter((k) => k >= 0);

  // A pick's worth now: the auction dollars of the player you'd expect to be left when it comes up, plus a dollar.
  function pickValue(D, ctx, k) {
    const made = D.board.filter(Boolean).length;
    if (!ctx._pv || ctx._pv.made !== made) ctx._pv = { made, vals: ctx.available.map((p) => Math.max(0, p.$ || 0)).sort((a, b) => b - a) };
    let ahead = 0;
    for (let i = 0; i < k; i++) if (!D.board[i]) ahead++;
    return (ctx._pv.vals[ahead] || 0) + 1;
  }
  const assetValue = (D, ctx, id) => (isPickId(id) ? pickValue(D, ctx, pickIdx(id)) : ((ctx.byId[id] && ctx.byId[id].$) || 0) + 1);
  const sideValue = (D, ctx, ids) => sum((ids || []).map((id) => assetValue(D, ctx, id)));

  // Is this trade legal right now? Both teams still own what they'd send, nothing is a pick already made, and after
  // the swap each team can still fit its players and picks on its roster and fill its starting lineup.
  function tradeCheck(D, ctx, t) {
    if (!D.trading) return { ok: false, why: "Trades are off in this draft" };
    if (D.phase === "done") return { ok: false, why: "The draft is over" };
    if (D.type === "mystery" && D.phase === "setup" && D.mystery.reveal !== "now") return { ok: false, why: "Packages are sealed until the draft starts" };
    if (t.from === t.to || !D.teams[t.from] || !D.teams[t.to]) return { ok: false, why: "Pick a team to trade with" };
    const give = t.give || [], get = t.get || [];
    if (!give.length || !get.length) return { ok: false, why: "Add something from each side" };
    const R = rosters(D);
    const owns = (team, id) => (isPickId(id) ? D.order[pickIdx(id)] === team && !D.board[pickIdx(id)] : R[team].includes(id));
    for (const id of give) if (!owns(t.from, id)) return { ok: false, why: `${D.teams[t.from].name} no longer has ${label(D, ctx, id)}` };
    for (const id of get) if (!owns(t.to, id)) return { ok: false, why: `${D.teams[t.to].name} no longer has ${label(D, ctx, id)}` };
    for (const [team, out, inn] of [[t.from, give, get], [t.to, get, give]]) {
      const ps = R[team].filter((id) => !out.includes(id)).concat(inn.filter((id) => !isPickId(id))).map((id) => ctx.byId[id]).filter(Boolean);
      const picks = picksOf(D, team).filter((k) => !out.includes(pickId(k))).length + inn.filter(isPickId).length;
      const name = D.teams[team].name;
      if (ps.length + picks > sizeOf(D)) return { ok: false, why: `${name} wouldn't have room for everyone` };
      const open = D.lineup.length - assign(ctx.sport, ps, D.lineup).filter(Boolean).length;
      if (open > picks) return { ok: false, why: `${name} couldn't fill its starting lineup` };
      for (const [pos, max] of Object.entries(D.posMax || {})) if (ps.filter((q) => S.positions(q).every((x) => x === pos)).length > max) return { ok: false, why: `${name} would have more than ${max} at ${pos}` };
    }
    if (ctx.hooks.tradeCheck) { const c = ctx.hooks.tradeCheck(D, t, ctx); if (c && !c.ok) return c; }
    return { ok: true };
  }
  // Every team starts with exactly one pick per roster spot, so a 2-for-1 would leave someone with too many. The team
  // getting more pieces adds its latest picks until the counts match: the usual way leagues even these out.
  function balance(D, t) {
    const give = (t.give || []).slice(), get = (t.get || []).slice(), added = [];
    const fill = (team, side, need) => {
      const ks = picksOf(D, team).filter((k) => !side.includes(pickId(k))).reverse();
      for (const k of ks.slice(0, need)) { side.push(pickId(k)); added.push({ team, id: pickId(k) }); }
    };
    if (get.length > give.length) fill(t.from, give, get.length - give.length);
    else if (give.length > get.length) fill(t.to, get, give.length - get.length);
    return Object.assign({}, t, { give, get, added });
  }
  const label = (D, ctx, id) => (isPickId(id) ? pickLabel(D, pickIdx(id)) : (ctx.byId[id] || { n: "a player" }).n);

  // A bot takes a deal that gets it a little more value than it sends, by an amount that varies from bot to bot.
  function botAnswer(D, ctx, t) {
    const recv = sideValue(D, ctx, t.give), send = sideValue(D, ctx, t.get);
    const want = 1.03 + 0.07 * hash01(`${D.seed}:ask:${t.to}`);
    if (recv >= send * want) return { yes: true };
    return { yes: false, why: recv >= send ? "They want a little more" : recv >= send * 0.8 ? "They want more for it" : "Not close for them" };
  }

  function propose(D, ctx, t, now) {
    if (t.balance !== false) t = balance(D, t);
    const c = tradeCheck(D, ctx, t);
    if (!c.ok) return c;
    const T = { id: (D.trades.length ? D.trades[D.trades.length - 1].id : 0) + 1, from: t.from, to: t.to, give: t.give.slice(), get: t.get.slice(),
      note: t.note || "", at: now, status: "pending", by: t.by || null, added: (t.added || []).map((x) => x.id),
      // what each piece was worth when the offer went out, so the record doesn't drift as the draft goes on
      vals: Object.fromEntries(t.give.concat(t.get).map((id) => [id, Math.round(assetValue(D, ctx, id))])) };
    D.trades.push(T);
    if (tradesForThem(D.teams[t.to])) {
      const a = botAnswer(D, ctx, T);
      if (a.yes) { execute(D, ctx, T, now); return { ok: true, trade: T, accepted: true }; }
      T.status = "declined"; T.why = a.why; T.done = now;
      return { ok: true, trade: T, accepted: false, why: a.why };
    }
    return { ok: true, trade: T, pending: true };
  }
  function respond(D, ctx, id, teamId, yes, now) {
    const T = D.trades.find((x) => x.id === id);
    if (!T || T.status !== "pending") return { ok: false, why: "That offer is gone" };
    if (T.to !== teamId) return { ok: false, why: "That offer isn't yours to answer" };
    if (!yes) { T.status = "declined"; T.done = now; return { ok: true, trade: T }; }
    const c = tradeCheck(D, ctx, T);
    if (!c.ok) { T.status = "expired"; T.done = now; return c; }
    execute(D, ctx, T, now);
    return { ok: true, trade: T };
  }
  function cancel(D, id, teamId, now) {
    const T = D.trades.find((x) => x.id === id);
    if (!T || T.status !== "pending" || T.from !== teamId) return { ok: false, why: "That offer is gone" };
    T.status = "canceled"; T.done = now;
    return { ok: true };
  }
  function execute(D, ctx, T, now) {
    const c = onClock(D, now);
    const move = (ids, from, to) => {
      for (const id of ids) {
        if (isPickId(id)) { const k = pickIdx(id); if (D.via[k] == null) D.via[k] = from; D.order[k] = to; if (D.via[k] === to) delete D.via[k]; }
        else { const pk = D.board.find((x) => x && x.pid === id); if (pk) { if (pk.drafter == null) pk.drafter = pk.team; pk.team = to; } }
      }
    };
    move(T.give, T.from, T.to); move(T.get, T.to, T.from);
    T.status = "accepted"; T.done = now;
    if (c && D.order[c.index] !== c.team) D.clockStart = now;     // the pick on the clock changed hands: a fresh clock
    refresh(D, ctx);
    expireTrades(D, ctx, now);
  }
  // Offers that can't happen anymore (a pick was made, an asset moved) close.
  function expireTrades(D, ctx, now) {
    for (const T of D.trades || []) if (T.status === "pending" && !tradeCheck(D, ctx, T).ok) { T.status = "expired"; T.done = now || T.at; }
  }

  // When a manager comes on the clock, a bot that picks later sometimes offers to move up: its next pick plus the
  // cheapest later pick that makes the deal worth it to the manager.
  function botOffer(D, ctx, c, now) {
    if (!D.trading || !D.botOffers) return null;
    const r = rng(D.seed + c.index * 53 + 11);
    if (r() > 0.4) return null;
    let v = pickValue(D, ctx, c.index);
    const bots = D.teams.filter((t) => tradesForThem(t) && t.id !== c.team).map((t) => ({ t, ks: picksOf(D, t.id).filter((k) => k > c.index) })).filter((x) => x.ks.length >= 2 && x.ks[0] - c.index >= 3);
    if (!bots.length) return null;
    bots.sort((a, b) => a.ks[0] - b.ks[0]);
    const pool = bots.slice(0, 4);
    const b = pool[Math.floor(r() * pool.length)];
    const k2 = b.ks[0], v2 = pickValue(D, ctx, k2);
    const mineLast = picksOf(D, c.team).filter((k) => k !== c.index).pop();
    if (mineLast == null) return null;
    v += pickValue(D, ctx, mineLast);                 // the manager adds his last pick to even out the counts
    let k3 = null;
    for (const k of b.ks.slice(1).reverse()) if (v2 + pickValue(D, ctx, k) >= v * 1.04) { k3 = k; break; }
    if (k3 == null || v2 + pickValue(D, ctx, k3) > v * 1.3) return null;
    const t = balance(D, { from: b.t.id, to: c.team, give: [pickId(k2), pickId(k3)], get: [pickId(c.index)], note: "Looking to move up", by: "bot" });
    if (!tradeCheck(D, ctx, t).ok) return null;
    return propose(D, ctx, t, now);
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

  return { FORMATS, REVEALS, NAMES, rng, hash01, makeOrder, create, keep, made, rosters, context, assign, canAdd, onClock, nextPickOf, isBot,
    start, pause, pick, worth, autoChoice, tick, undo, maxBid, spotsLeft, nominator, auctionState, nominate, bid, pass, botMax, standings, sizeOf,
    clockLen, thinkTime, bankShare, slotInfo, fitsRoster, canSteal, steal, stealsOf, stealsLeft, stealsOpen, botSteal, pickCurve, dealPackages, fairDeal, seen, pickLabel, picksOf, pickValue, pickId, isPickId, pickIdx, assetValue, sideValue,
    tradeCheck, balance, propose, respond, cancel, botAnswer, botOffer };
});
