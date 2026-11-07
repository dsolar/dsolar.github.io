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
   the whole draft, all of it up front: perRound seconds times the rounds. Once it's gone every pick gets `floor` seconds. What's left at
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

  const FORMATS = { snake: "Snake", linear: "Linear", "3rr": "Third-round reversal", mystery: "Mystery packages", elephant: "White elephant", pack: "Pack draft", auction: "Auction" };
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
    // teams that skip the draft (a vampire league's vampire) aren't in the order at all
    const sit = (opts.sit || []).filter((t) => t >= 0 && t < n);
    if (sit.length) first = first.filter((t) => !sit.includes(t));
    const m = first.length;
    const type = FORMATS[opts.type] ? opts.type : "snake";
    const D = {
      v: 1, kind: "fk-draft", sport: sport.key, type, seed, created: opts.now || Date.now(), name: opts.name || "Mock draft",
      scoring: opts.scoring || Object.keys(sport.scorings)[0],
      lineup, bench, rounds, posMax: opts.posMax || sport.posMax || {},
      clock: opts.clock == null ? 60 : opts.clock, botDelay: opts.botDelay == null ? 1500 : opts.botDelay,
      teams, round1: first, order: type === "auction" ? [] : type === "mystery" ? Array(m * rounds).fill(0) : makeOrder(type === "elephant" ? "snake" : type === "pack" ? "linear" : type, first, rounds),
      board: type === "auction" ? [] : Array(m * rounds).fill(null), sales: [], sit: sit.length ? sit : undefined,
      phase: "setup", clockStart: null, paused: false, left: null, log: [],
      auction: type === "auction" ? { budget: opts.budget || 200, minBid: opts.minBid == null ? 1 : opts.minBid, nomClock: opts.nomClock || 30, bidClock: opts.bidClock || 15, nom: 0, lot: null } : null,
      bank: type !== "auction" && opts.bank ? { perRound: opts.bank.perRound || 30, floor: opts.bank.floor == null ? 10 : opts.bank.floor } : null,
      trading: type !== "auction" && type !== "elephant" && type !== "pack" && opts.trades !== false,
      steals: type === "elephant" ? { freeze: (opts.steals && opts.steals.freeze) || 2, perTeam: (opts.steals && opts.steals.perTeam) || 3, lastRounds: opts.steals && opts.steals.lastRounds != null ? opts.steals.lastRounds : 2 } : null,
      extra: {}, botOffers: opts.botOffers !== false, trades: [], via: {}, offered: {},
    };
    if (D.bank) for (const t of D.teams) t.bank = D.bank.perRound * rounds * 1000;
    if (type === "mystery") {
      const curve = (opts.curve || defaultCurve(m * rounds)).slice(0, m * rounds).map((v) => Math.round(v * 100) / 100);
      D.mystery = { reveal: REVEALS[opts.reveal] ? opts.reveal : "start", curve, tolerance: opts.tolerance == null ? 0.01 : opts.tolerance };
      applyDeal(D, dealPackages(n, rounds, curve, seed, { tolerance: D.mystery.tolerance }));
    }
    for (const k of opts.keepers || []) keep(D, k.team, k.pid, k.round, k.price);
    // a dynasty's rookie and free agent draft: every team brings its whole roster (D.carry) and adds a few rounds
    if (opts.carry) D.carry = D.teams.map((t) => (opts.carry[t.id] || []).slice());
    return D;
  }

  // Before the draft starts: the same draft with a different set of teams (the commissioner added or removed some).
  // teams: [{ name, abbr, owner, color }] in the new order. Keepers and a dynasty's carried rosters can't resize.
  // Before the draft starts: the commissioner sets the first round's order (team ids), or shuffles it. Later rounds
  // follow the draft type (snake, linear, third-round reversal). Not once keepers are on the board.
  function setOrder(D, first, seed) {
    if (D.phase !== "setup") return { ok: false, why: "The draft already started" };
    if (D.type === "auction") return { ok: false, why: "An auction has no draft order" };
    if ((D.board || []).some((pk) => pk && pk.keeper) || D.carry || D.type === "mystery") return { ok: false, why: "This draft's order is set by its keepers or packages" };
    const want = D.round1.slice();
    let next = first ? first.slice() : want.slice();
    if (!first) { const r = rng(seed == null ? Date.now() % 2 ** 31 : seed); for (let i = next.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [next[i], next[j]] = [next[j], next[i]]; } }
    if (next.length !== want.length || want.some((t) => !next.includes(t))) return { ok: false, why: "Every drafting team needs one spot" };
    D.round1 = next;
    D.order = makeOrder(D.type === "elephant" ? "snake" : D.type, next, D.rounds);
    D.board = Array(D.order.length).fill(null);
    D.via = {};
    return { ok: true };
  }
  function resize(D, sport, teams, players) {
    if (D.phase !== "setup") return { ok: false, why: "The draft has started" };
    if (teams.length < 2 || teams.length > 20) return { ok: false, why: "A league has 2 to 20 teams" };
    if (D.carry || (D.board || []).some((pk) => pk && pk.keeper) || (D.sales || []).some((x) => x.keeper)) return { ok: false, why: "Teams can't change once keepers or rosters are in place" };
    const n = teams.length, total = n * D.rounds;
    const N = create({ sport, type: D.type, teams: teams.map((t) => ({ name: t.name, abbr: t.abbr, owner: t.owner })), seed: D.seed, now: D.created,
      lineup: D.lineup, bench: D.bench, scoring: D.scoring, botDelay: D.botDelay, clock: D.clock, name: D.name, trades: D.trading, posMax: D.posMax,
      bidClock: D.auction ? D.auction.bidClock : undefined, nomClock: D.auction ? D.auction.nomClock : undefined, budget: D.auction ? D.auction.budget : (D.teams[0] || {}).budget,
      minBid: D.auction ? D.auction.minBid : undefined, bank: D.bank, steals: D.steals, botOffers: D.botOffers,
      curve: D.type === "mystery" && players ? pickCurve(players, total) : undefined, reveal: D.mystery ? D.mystery.reveal : undefined });
    N.teams.forEach((t, i) => { if (teams[i].color != null) t.color = teams[i].color; });
    for (const k of ["season", "scoringSpec", "year", "commishNote"]) if (D[k] !== undefined) N[k] = D[k];
    return { ok: true, draft: N };
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
  // limit { of(p) -> group or null, max }: at most max starters from one group (a college conference)
  function assign(sport, players, slots, limit) {
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
    // best first; a placed player always stays in the lineup (a later one only moves him), so a group's count only grows
    const n = Object.assign({}, (limit && limit.used) || {});
    for (const p of sorted) {
      const g = limit && limit.max ? limit.of(p) : null;
      if (g && (n[g] || 0) >= limit.max) continue;
      if (tryPlace(p, new Set()) && g) n[g] = (n[g] || 0) + 1;
    }
    // a multiplier spot (a showdown's captain) holds the best player who can play there
    const mult = (S.SHOWDOWN && S.SHOWDOWN.mult) || {};
    slots.forEach((sl, i) => {
      if (!mult[sl] || !at[i]) return;
      let best = i;
      at.forEach((q, j) => { if (q && (q.v || 0) > (at[best].v || 0) && S.fits(sport, q, sl) && S.fits(sport, at[i], slots[j])) best = j; });
      if (best !== i) [at[i], at[best]] = [at[best], at[i]];
    });
    return at;
  }

  const sizeOf = (D) => D.lineup.length + D.bench + (D.carry ? D.rounds : 0);

  // Can this team take this player now? Roster room, position limits, every starting slot still fillable, and the
  // league's own rule.
  function canAdd(D, ctx, teamId, p) {
    if (!p) return { ok: false, why: "Unknown player" };
    if (ctx.own[p.id] != null) return { ok: false, why: `${p.n} is already taken` };
    const spun = wheelFor(D, ctx, teamId);
    if (spun && p.t !== spun) return { ok: false, why: `This pick has to come from ${spun}` };
    const pk = D.packs && D.phase === "live" ? packFor(D, ctx, teamId) : null;
    if (pk) {
      if (!pk.includes(p.id)) return { ok: false, why: `${p.n} isn't in your pack` };
      const m = packMoney(D, teamId), cost = (id) => (D.packs.price[id] || 1);
      const ok = (id) => fitsRoster(D, ctx, teamId, ctx.byId[id]).ok && (!m || cost(id) <= m.max);
      const fit = fitsRoster(D, ctx, teamId, p);
      // nobody in the pack fits what the lineup still needs, or what's left of the budget: then any of them will do
      // (the cheapest when it's the money), so a pick is never stuck
      if (rosters(D)[teamId].length < sizeOf(D) && !pk.some(ok)) {
        if (m && !pk.some((id) => cost(id) <= m.max)) { const cheap = Math.min(...pk.map(cost)); return cost(p.id) === cheap ? { ok: true } : { ok: false, why: `You have $${m.left} left: only the cheapest card here` }; }
        return { ok: true };
      }
      if (m && cost(p.id) > m.max) return { ok: false, why: `${m.picks > 1 ? `With $${m.left} left and ${m.picks - 1} more to pick, $${m.max} is your limit` : `You have $${m.left} left`}` };
      return fit;
    }
    return fitsRoster(D, ctx, teamId, p);
  }

  /* ---------- pack draft ---------- */
  // Like a booster draft: every team opens a pack, takes one player from it, and passes the rest on; the next pick
  // comes from the pack passed in. Packs go left, then right for the next set. No two teams ever hold the same pack,
  // so a turn has everyone picking at once, on one clock. D.packs: { sizes: picks per pack, extra: players left over
  // in each, cards: [pack set][seat] -> player ids }. Seats are the first round's order.
  // Deal the packs from a valued pool so they come out alike: enough players at each lineup position (a quarter
  // more than the lineups need), the rest the best left, then every position spread across the packs in turn.
  function dealPacks(D, players, sport) {
    // with no bench every pick has to fill a lineup spot, so each pack carries a spare more
    const po = D.packOpts || {}, n = D.round1.length, R = D.rounds, Q = po.sets || (R >= 6 ? 2 : 1), extra = po.extra != null ? po.extra : D.bench ? 2 : 3;
    const sizes = Array.from({ length: Q }, (_, q) => Math.floor(R / Q) + (q < R % Q ? 1 : 0));
    const total = sizes.reduce((a, x) => a + (x + extra) * n, 0);
    const ok = players.filter((p) => D.lineup.some((sl) => S.fits(sport, p, sl)) && (p.v || 0) > -1e9).sort((a, b) => (a.rank || 1e5) - (b.rank || 1e5));
    const pick = new Set(), main = (p) => S.positions(p)[0];
    // each position's share of the pool is its share of the lineup (a flex spot split among what it takes, the bench
    // like the starters), and each position's best players fill it
    const all = [...new Set(ok.map(main))], demand = {};
    for (const sl of D.lineup) { const v = sport.slots[sl], el = v === "*" ? all : v.filter((x) => all.includes(x)); for (const x of el) demand[x] = (demand[x] || 0) + 1 / el.length; }
    const dsum = Object.values(demand).reduce((a, x) => a + x, 0) || 1;
    const want = {};
    let given = 0;
    for (const [pos, d] of Object.entries(demand)) { want[pos] = Math.floor((d / dsum) * total); given += want[pos]; }
    for (const pos of Object.keys(demand).sort((a, b) => ((demand[b] / dsum) * total % 1) - ((demand[a] / dsum) * total % 1))) { if (given >= total) break; want[pos]++; given++; }
    // a position with its own lineup spot gets at least one and a half players a team, taken from the biggest group
    const own = {};
    for (const sl of D.lineup) { const v = sport.slots[sl]; if (v !== "*" && v.length === 1) own[v[0]] = (own[v[0]] || 0) + 1; }
    for (const [pos, k] of Object.entries(own)) { const min = Math.ceil(k * n * (D.bench ? 1.5 : 1.7)); while ((want[pos] || 0) < min) { const big = Object.keys(want).filter((x) => x !== pos).sort((a, b) => want[b] - want[a])[0]; if (!big || want[big] <= (own[big] || 0) * n * 1.5) break; want[big]--; want[pos] = (want[pos] || 0) + 1; } }
    for (const [pos, k] of Object.entries(want)) { let left = k; for (const p of ok) { if (!left) break; if (main(p) === pos && !pick.has(p.id)) { pick.add(p.id); left--; } } }
    for (const p of ok) { if (pick.size >= total) break; pick.add(p.id); }
    const byId = Object.fromEntries(ok.map((p) => [p.id, p])), val = (id) => -(byId[id].rank || 1e5);   // draft rank, not raw points: a star is a star at his position
    const r = rng((D.seed ^ 0xbacc) >>> 0);
    // every pack's hit: one of the best players in the pool, so every pack has a star. The best few of those are
    // chase cards. Hits go out in a hidden snake: the seat that opens the best pack of one set opens the weakest of
    // the next, so the luck of the rip evens out over the draft.
    const ranked = [...pick].sort((a, b) => val(b) - val(a)), hits = ranked.slice(0, n * Q);
    const seatRank = D.round1.map((_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [seatRank[i], seatRank[j]] = [seatRank[j], seatRank[i]]; }
    const packs = [];
    for (let q = 0; q < Q; q++) for (let seat = 0; seat < n; seat++) {
      const k = q % 2 === 0 ? seatRank[seat] : n - 1 - seatRank[seat];
      packs.push({ q, seat, cap: sizes[q] + extra, ids: [hits[q * n + k]] });
    }
    // the rest, position by position (scarce ones first), snaking across the packs from the one with the weakest hit
    const groups = {}, isHit = new Set(hits);
    for (const id of pick) if (!isHit.has(id)) (groups[main(byId[id])] = groups[main(byId[id])] || []).push(byId[id]);
    const flow = packs.slice().sort((x, y) => val(x.ids[0]) - val(y.ids[0]));
    // kickers and defenses all come in the last set, so the first is all for the lineup's core and the last has
    // one for everyone
    const lateP = (pos) => !!(sport.late && sport.late.includes(pos));
    const order = Object.keys(groups).sort((a, b) => (lateP(b) - lateP(a)) || groups[a].length - groups[b].length);
    const lastSet = flow.filter((x) => x.q === Q - 1);
    const cur = new Map([[flow, { at: 0, dir: 1 }], [lastSet, { at: 0, dir: 1 }]]);
    for (const pos of order) {
      const lane = lateP(pos) && Q > 1 ? lastSet : flow, c = cur.get(lane);
      let { at, dir } = c;
      for (const p of groups[pos].sort((a, b) => (a.rank || 1e5) - (b.rank || 1e5))) {
        let tries = 0;
        while (lane[at].ids.length >= lane[at].cap && tries++ < lane.length * 2) { at += dir; if (at >= lane.length || at < 0) { dir = -dir; at += dir; } }
        if (lane[at].ids.length >= lane[at].cap) break;
        lane[at].ids.push(p.id);
        at += dir; if (at >= lane.length || at < 0) { dir = -dir; at += dir; }
      }
      Object.assign(c, { at, dir });
    }
    const cards = sizes.map((_, q) => packs.filter((x) => x.q === q).sort((x, y) => x.seat - y.seat).map((x) => x.ids));
    // Who opens which pack, set so the draft comes out even: a seat's haul is roughly the best card of the pack it
    // opens, the second best of the one passed to it, and so on. Swap openers until every seat's haul is close.
    const worth$ = (id) => Math.max(0, byId[id].$ || 0) + Math.max(0, 1e3 - (byId[id].rank || 1e3)) / 1e3;
    const depth = cards.map((set) => set.map((ids) => ids.map(worth$).sort((a, b) => b - a)));
    const haul = (seat) => sizes.reduce((sum, size, q) => { const d = q % 2 === 0 ? 1 : -1; let h = 0; for (let j = 0; j < size; j++) { const src = (((seat - d * j) % n) + n) % n; h += depth[q][src][j] || 0; } return sum + h; }, 0);
    const spread = () => { const hs = D.round1.map((_, i) => haul(i)); return Math.max(...hs) - Math.min(...hs); };
    let best = spread();
    for (let it = 0; it < 60 * n && best > 0; it++) {
      const q = Math.floor(r() * Q), a = Math.floor(r() * n), b = Math.floor(r() * n);
      if (a === b) continue;
      [cards[q][a], cards[q][b]] = [cards[q][b], cards[q][a]]; [depth[q][a], depth[q][b]] = [depth[q][b], depth[q][a]];
      const s2 = spread();
      if (s2 <= best) best = s2;
      else { [cards[q][a], cards[q][b]] = [cards[q][b], cards[q][a]]; [depth[q][a], depth[q][b]] = [depth[q][b], depth[q][a]]; }
    }
    // the rarity printed on each card: the hits are stars (the best of them chase cards), the next tier rares
    const tier = {}, chase = Math.floor((n * Q) / 6);
    hits.forEach((id, i) => (tier[id] = i < chase ? "chase" : "star"));
    ranked.filter((id) => !isHit.has(id)).slice(0, 2 * n * Q).forEach((id) => (tier[id] = "rare"));
    // Price tags: each card's draft value with a markup or a discount of up to a quarter, so a star can be a
    // splurge and a mid-round player a bargain. Every team has one budget for the whole draft ($1 a pick at least).
    // One card a pack is a mystery: face down, showing only its tier and position, and priced at what that tier and
    // position go for on average.
    const budget = 200, price = {}, mystery = {}, est = {};
    for (const set of cards) for (const ids of set) for (const id of ids) {
      const v = Math.max(0, byId[id].$ || 0), n = 0.75 + 0.55 * hash01(`${D.seed}:price:${id}`);
      price[id] = Math.max(1, Math.round(v * n));
    }
    const groupAvg = {};
    for (const set of cards) for (const ids of set) for (const id of ids) { const k = (tier[id] || "base") + ":" + main(byId[id]); (groupAvg[k] = groupAvg[k] || []).push(Math.max(0, byId[id].$ || 0)); }
    for (const set of cards) for (const ids of set) {
      const pool = ids.filter((id) => tier[id] !== "star" && tier[id] !== "chase" && !(sport.late || []).includes(main(byId[id])));
      if (!pool.length) continue;
      const id = pool[Math.floor(r() * pool.length)], g = groupAvg[(tier[id] || "base") + ":" + main(byId[id])];
      mystery[id] = 1;
      est[id] = g.reduce((a, x) => a + x, 0) / g.length;
      price[id] = Math.max(1, Math.round(est[id]));
    }
    D.packs = { sizes, extra, cards, tier, budget, price, mystery, est };
    D.trading = false;
    return D.packs;
  }
  // where the draft stands: pack set q, pick j within it, for turn t (a turn is one round of the board)
  function packAt(D, t) {
    let q = 0, j = t;
    while (q < D.packs.sizes.length - 1 && j >= D.packs.sizes[q]) { j -= D.packs.sizes[q]; q++; }
    return { q, j, size: D.packs.sizes[q], sets: D.packs.sizes.length };
  }
  const packTurnNow = (D) => { const k = nextIndex(D); return k < 0 ? -1 : Math.floor(k / D.round1.length); };
  // the pack in front of a team this turn: the one opened by the seat that many places back (left), or ahead (right)
  function packFor(D, ctx, teamId, t) {
    if (!D.packs) return null;
    if (t == null) t = packTurnNow(D);
    if (t < 0) return null;
    const n = D.round1.length, seat = D.round1.indexOf(teamId);
    if (seat < 0) return null;
    const { q, j } = packAt(D, t), dir = q % 2 === 0 ? 1 : -1;
    const src = (((seat - dir * j) % n) + n) % n;
    return (D.packs.cards[q][src] || []).filter((id) => !ctx || ctx.own[id] == null);
  }
  // the budget: what a team has spent, what it has left, and the most it can pay for this pick and still have $1 for
  // every pick after it
  const priced = (D) => !!(D.packs && D.packs.price);
  const packSpent = (D, teamId) => D.board.reduce((a, pk) => a + (pk && pk.team === teamId && pk.price ? pk.price : 0), 0);
  function packMoney(D, teamId) {
    if (!priced(D)) return null;
    const left = D.packs.budget - packSpent(D, teamId), picks = sizeOf(D) - rosters(D)[teamId].length;
    return { left, picks, max: Math.max(0, left - Math.max(0, picks - 1)), per: picks ? left / picks : 0 };
  }
  // what a card costs this team: its price, or, when nothing in the pack is affordable, all it has left
  const packPrice = (D, teamId, pid) => { const m = packMoney(D, teamId); return m ? Math.min(D.packs.price[pid] || 1, m.max) : 0; };
  // a team's spot on the board this turn, if it hasn't picked yet
  function packSlot(D, teamId) {
    const t = packTurnNow(D);
    if (t < 0 || D.phase !== "live") return -1;
    const k = t * D.round1.length + D.round1.indexOf(teamId);
    return D.board[k] ? -1 : k;
  }
  function packPick(D, ctx, teamId, pid, now, auto) {
    if (D.phase !== "live") return { ok: false, why: "The draft isn't open" };
    const k = packSlot(D, teamId);
    if (k < 0) return { ok: false, why: "You've picked from this pack. The next one comes when everyone has" };
    const p = ctx.byId[pid];
    const ok = canAdd(D, ctx, teamId, p);
    if (!ok.ok) return ok;
    const t = Math.floor(k / D.round1.length);
    D.board[k] = Object.assign({ n: k + 1, team: teamId, pid, at: now, auto: !!auto }, priced(D) ? { price: packPrice(D, teamId, pid) } : {});
    ctx.own[pid] = teamId;
    ctx.available = ctx.available.filter((x) => x.id !== pid);
    for (const tm of D.teams) tm.queue = tm.queue.filter((x) => x !== pid);
    // the turn is over once everyone has picked: the packs pass and the clock starts again
    if (packTurnNow(D) !== t) D.clockStart = now;
    finishIfDone(D, now);
    return { ok: true, pick: k + 1 };
  }
  // bots pick a moment into the turn; a manager whose clock runs out gets the best player left in his pack
  function packTick(D, ctx, now, max) {
    let n = 0;
    while (n < max && D.phase === "live" && !D.paused) {
      const t = packTurnNow(D);
      if (t < 0) break;
      const deadline = D.clockStart + clockLen(D, t * D.round1.length);
      let moved = false;
      for (const team of D.round1) {
        if (packSlot(D, team) < 0) continue;
        const bot = isBot(D.teams[team]), at = bot ? D.clockStart + D.botDelay : deadline;
        if (now < at) continue;
        const p = autoChoice(D, ctx, team, rng(D.seed + (t * 97 + team) * 31 + 7));
        if (!p) continue;
        if (packPick(D, ctx, team, p.id, Math.min(now, at), true).ok) { n++; moved = true; if (packTurnNow(D) !== t) break; }
      }
      if (!moved) break;
    }
    return n;
  }

  /* ---------- team roulette ---------- */
  // D.roulette: { teams: [pro teams], each: "pick" or "round", respins: per team, spins: { pick index: team }, used:
  // { team id: re-spins used } }. Every pick has to be a player from one pro team, drawn from a shuffled deck so each
  // team comes up once before any comes up again. With each: "round", the whole round draws the same team. A team the
  // wheel lands on with nobody this roster can use is skipped for the next card; a re-spin draws a fresh one.
  const decks = new WeakMap();
  function deckOf(D) {
    const R = D.roulette;
    if (decks.has(R)) return decks.get(R);
    const r = rng((D.seed ^ 0x5eed) >>> 0), out = [];
    const need = D.order.length + 64;
    while (out.length < need) {
      const t = R.teams.slice();
      for (let i = t.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [t[i], t[j]] = [t[j], t[i]]; }
      out.push(...t);
    }
    decks.set(R, out);
    return out;
  }
  // the card a pick starts on: its own, or its round's
  const cardOf = (D, k) => (D.roulette.each === "round" ? Math.floor(k / D.teams.length) : k);
  // can this roster use anyone left on that pro team?
  const usable = (D, ctx, teamId, t) => ctx.available.some((q) => q.t === t && ctx.own[q.id] == null && fitsRoster(D, ctx, teamId, q).ok);
  // The pro team pick k has to come from (with ctx, the first card this roster can use). null without roulette.
  function spinOf(D, k, ctx, teamId) {
    const R = D.roulette;
    if (!R || !R.teams || !R.teams.length || D.type === "auction") return null;
    if (R.spins && R.spins[k]) return R.spins[k];
    const deck = deckOf(D), c = cardOf(D, k);
    if (!ctx) return deck[c % deck.length];
    for (let j = 0; j < R.teams.length; j++) { const t = deck[(c + j) % deck.length]; if (usable(D, ctx, teamId, t)) return t; }
    return null;
  }
  // the team the pick on the clock is held to, for the team on the clock (cached per board state, since every row of
  // the player table asks)
  function wheelFor(D, ctx, teamId) {
    if (!D.roulette || D.phase !== "live" || D.type === "auction") return null;
    const k = nextIndex(D);
    if (k < 0 || D.order[k] !== teamId) return null;
    const key = `${k}:${D.board.filter(Boolean).length}:${(D.roulette.spins || {})[k] || ""}`;
    if (ctx._wheel && ctx._wheel.key === key && ctx._wheel.D === D) return ctx._wheel.t;
    const t = spinOf(D, k, ctx, teamId);
    ctx._wheel = { key, D, t };
    return t;
  }
  const respinsLeft = (D, teamId) => (D.roulette ? Math.max(0, (D.roulette.respins || 0) - ((D.roulette.used || {})[teamId] || 0)) : 0);
  // a re-spin: a fresh card for the pick on the clock, never the team it just landed on
  function respin(D, ctx, teamId, now) {
    const c = onClock(D, now);
    if (!D.roulette || !c || c.team !== teamId) return { ok: false, why: "It's not your pick" };
    if (!respinsLeft(D, teamId)) return { ok: false, why: "You're out of re-spins" };
    const R = D.roulette, was = wheelFor(D, ctx, teamId), r = rng((D.seed + 7919 * (c.index + 1) + 31 * ((R.used || {})[teamId] || 0)) >>> 0);
    const pool = R.teams.filter((t) => t !== was && usable(D, ctx, teamId, t));
    if (!pool.length) return { ok: false, why: "No other team has anyone you can use" };
    const t = pool[Math.floor(r() * pool.length)];
    (R.spins = R.spins || {})[c.index] = t;
    (R.used = R.used || {})[teamId] = ((R.used || {})[teamId] || 0) + 1;
    ctx._wheel = null;
    return { ok: true, team: t };
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
  // With a time bank it's sized to the bank: a bot uses about half of its share per pick, more or less by its pace, so
  // it ends the draft with about half its bank left, like a manager who isn't rushing.
  const thinkTime = (D, teamId, k) => {
    const pace = hash01(`${D.seed}:pace:${teamId}`), think = hash01(`${D.seed}:think:${k}`);
    if (D.bank) return Math.round(D.bank.perRound * 1000 * (0.25 + 0.5 * pace) * (0.5 + think));
    return Math.round((5 + 20 * pace) * (0.4 + 1.2 * think) * 1000);
  };
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
    const tq = triviaUp(D, k);
    const deadline = tq ? tq.ends : D.clockStart + len;
    const si = slotInfo(D, k);
    return { pick: k + 1, index: k, round: si.round, inRound: si.inRound, makeup: si.makeup, team: D.order[k], total: D.order.length,
      deadline, left: D.paused ? D.left : deadline - now, trivia: tq || null };
  }
  // A pick's round and place in the round, counting only scheduled picks (make-up picks after a steal sit between them).
  function slotInfo(D, k) {
    const n = D.round1.length, ex = D.extra || {};
    let sched = 0;
    if (Object.keys(ex).length) { for (let i = 0; i < k; i++) if (!ex[i]) sched++; } else sched = k;
    if (ex[k]) return { round: Math.floor(Math.max(0, sched - 1) / n) + 1, inRound: null, makeup: ex[k] };
    return { round: Math.floor(sched / n) + 1, inRound: (sched % n) + 1, makeup: null };
  }
  const nextPickOf = (D, teamId) => { for (let k = 0; k < D.order.length; k++) if (!D.board[k] && D.order[k] === teamId) return k + 1; return null; };
  const isBot = (t) => !t.owner || t.auto;
  // Autodraft only makes picks: trades are for teams nobody manages, never on a manager's behalf.
  const tradesForThem = (t) => !t.owner;

  function start(D, now, ctx) {
    if (D.phase !== "setup") return { ok: false, why: "The draft already started" };
    D.phase = "live"; D.clockStart = now; D.started = now; D.paused = false;
    if (D.type === "auction") skipFull(D);
    finishIfDone(D, now);
    if (ctx) triviaAsk(D, ctx, now);
    return { ok: true };
  }

  function pause(D, now, on) {
    if (D.phase !== "live") return { ok: false, why: "The draft isn't running" };
    const lot = D.auction && D.auction.lot;
    if (on && !D.paused) {
      D.paused = true;
      D.left = lot ? lot.ends - now : D.clockStart + (D.type === "auction" ? D.auction.nomClock * 1000 : Math.min(1e12, clockLen(D, nextIndex(D)))) - now;
    } else if (!on && D.paused) {
      D.paused = false; delete D.hold;
      if (lot) lot.ends = now + D.left;
      else D.clockStart = now - ((D.type === "auction" ? D.auction.nomClock * 1000 : Math.min(1e12, clockLen(D, nextIndex(D)))) - D.left);
      D.left = null;
    }
    return { ok: true };
  }

  function finishIfDone(D, now) {
    const full = rosters(D).every((ids) => ids.length >= sizeOf(D));
    if (D.type !== "auction" ? nextIndex(D) < 0 : full) {
      // a heist league isn't done yet: the heist comes right after the last pick
      if (D.season && D.season.heist && !D.heist) { startHeist(D, now); return true; }
      D.phase = "done"; D.done = now; return true;
    }
    return false;
  }

  /* ---------- the heist ---------- */
  // D.season.heist: { shields, steals, jinxes, clock (seconds) }. When the last pick is in the draft goes to phase
  // "heist": each team, against its opponent for the week, secretly shields some of its own starters and strikes at
  // the opponent's. A steal takes the player, who plays at 1.5x in the same lineup spot for the thief (the thief's own
  // player there is released); the robbed team can pick up a free agent for the hole, at normal points. A jinx halves
  // a player's points. A strike at a shielded player fails. Once every team is in, or the clock runs out, it all
  // resolves at once: a team that didn't choose shields its best starters and strikes at no one.
  const HEIST = { shields: 3, steals: 1, jinxes: 1, clock: 60, steal: 1.5, jinx: 0.5 };
  const heistRules = (D) => Object.assign({}, HEIST, (D.season && D.season.heist) || {});
  function startHeist(D, now) {
    const ids = D.teams.map((t, i) => i), r = rng((D.seed ^ 0x4e157) >>> 0);
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    const pairs = [];
    for (let i = 0; i + 1 < ids.length; i += 2) pairs.push([ids[i], ids[i + 1]]);
    D.phase = "heist";
    D.heist = { pairs, at: now, ends: now + heistRules(D).clock * 1000, moves: {} };
  }
  const heistFoe = (D, t) => { const p = D.heist && D.heist.pairs.find((x) => x.includes(t)); return p ? (p[0] === t ? p[1] : p[0]) : null; };
  // a team's lineup as the draft left it: one player per starting slot
  const heistLineup = (D, ctx, t) => assign(ctx.sport, rosters(D)[t].map((id) => ctx.byId[id]).filter(Boolean), D.lineup).map((p) => (p ? p.id : null));
  // whether a team may make these moves, and the moves cleaned up ({ ok, why, move })
  function heistCheck(D, ctx, t, m) {
    if (D.phase !== "heist") return { ok: false, why: "The heist is over" };
    const foe = heistFoe(D, t);
    if (foe == null) return { ok: false, why: "You sit this one out: no opponent this week" };
    const R = heistRules(D), mine = heistLineup(D, ctx, t).filter(Boolean), theirs = heistLineup(D, ctx, foe).filter(Boolean);
    const list = (x) => [...new Set(Array.isArray(x) ? x.map(String) : [])];
    const shield = list(m && m.shield), steal = list(m && m.steal), jinx = list(m && m.jinx);
    if (shield.length > R.shields || steal.length > R.steals || jinx.length > R.jinxes) return { ok: false, why: "That's more moves than you have" };
    if (!shield.every((id) => mine.includes(id))) return { ok: false, why: "Shield your own starters" };
    if (!steal.concat(jinx).every((id) => theirs.includes(id))) return { ok: false, why: "Strike at your opponent's starters" };
    if (steal.some((id) => jinx.includes(id))) return { ok: false, why: "A player can be stolen or jinxed, not both" };
    return { ok: true, move: { shield, steal, jinx } };
  }
  function heistMove(D, ctx, t, m, now) {
    if (D.phase === "heist" && D.heist.moves[t]) return { ok: false, why: "Your moves are locked in" };
    const c = heistCheck(D, ctx, t, m);
    if (!c.ok) return c;
    D.heist.moves[t] = Object.assign(c.move, { at: now });
    return { ok: true };
  }
  // In a shared league the moves are sealed: the server keeps them, and the league only shows { sealed: true, at }
  // until the heist is due (every manager in, or the clock out). Then heistUnseal puts the opened moves in, checked
  // again (a move that breaks the rules falls back to the default), and heistTick resolves it.
  const heistSealed = (D) => !!(D.phase === "heist" && D.heist && Object.values(D.heist.moves).some((m) => m && m.sealed));
  const heistIn = (D, t) => !!D.heist.moves[t] || !D.teams[t].owner;       // a bot is always ready; it moves at the reveal
  const heistDue = (D, now) => D.phase === "heist" && (D.heist.pairs.flat().every((t) => heistIn(D, t)) || now >= D.heist.ends);
  function heistUnseal(D, ctx, opened) {
    if (D.phase !== "heist") return false;
    let changed = false;
    for (const [k, m] of Object.entries(D.heist.moves)) {
      if (!m || !m.sealed) continue;
      const o = opened && opened[k], c = o ? heistCheck(D, ctx, +k, o) : { ok: false };
      D.heist.moves[k] = Object.assign(c.ok ? c.move : heistDefault(D, ctx, +k, false), { at: m.at });
      changed = true;
    }
    return changed;
  }
  // The moves a bot makes, or a manager who never chose (shield the best, strike at no one). A bot plays the guessing
  // game: it shields mostly but not always its best, steals where it gains the most from a player it guesses is open,
  // and jinxes a good player it doesn't steal.
  function heistDefault(D, ctx, t, bot, r) {
    const R = heistRules(D), foe = heistFoe(D, t), v = (id) => (id && ctx.byId[id] ? Math.max(0, ctx.byId[id].v || 0) : 0);
    const mine = heistLineup(D, ctx, t), theirs = heistLineup(D, ctx, foe);
    const byVal = (ids) => ids.filter(Boolean).sort((a, b) => v(b) - v(a));
    if (!bot) return { shield: byVal(mine).slice(0, R.shields), steal: [], jinx: [], auto: true };
    const draw = (cands, n) => { const out = [], c = cands.slice(); while (out.length < n && c.length) { const tot = c.reduce((s, x) => s + x.w, 0); if (tot <= 0) break; let x = r() * tot, i = 0; while (i < c.length - 1 && (x -= c[i].w) > 0) i++; out.push(c[i].id); c.splice(i, 1); } return out; };
    const shield = draw(byVal(mine).map((id) => ({ id, w: v(id) ** 2 })), R.shields);
    const rank = byVal(theirs), guard = (id) => (rank.indexOf(id) < R.shields ? 0.45 : 1);   // their best are likely shielded
    const steal = draw(theirs.map((id, i) => ({ id, w: id ? Math.max(0, R.steal * v(id) - v(mine[i])) ** 1.5 * guard(id) : 0 })).filter((x) => x.w > 0), R.steals);
    const jinx = draw(theirs.filter((id) => id && !steal.includes(id)).map((id) => ({ id, w: v(id) * guard(id) })), R.jinxes);
    return { shield, steal, jinx, auto: true };
  }
  function heistTick(D, ctx, now) {
    if (D.phase !== "heist" || heistSealed(D) || !heistDue(D, now)) return false;
    // bots move only now, so their moves are never in the league for anyone to read ahead
    for (const t of D.heist.pairs.flat()) {
      if (D.heist.moves[t]) continue;
      const bot = !D.teams[t].owner;
      D.heist.moves[t] = Object.assign(bot ? heistDefault(D, ctx, t, true, rng((D.seed + 977 * (t + 1)) >>> 0)) : heistDefault(D, ctx, t, false), { at: now });
    }
    resolveHeist(D, ctx, now);
    return true;
  }
  // Every move lands at once, from the lineups the draft left: steals first take their players, then each thief's
  // stolen player fills the matching spot (whoever was there is released unless someone stole him too).
  function resolveHeist(D, ctx, now) {
    const R = heistRules(D), H = D.heist, events = [], mult = {};
    const before = Object.fromEntries(D.teams.map((t, i) => [i, heistLineup(D, ctx, i)]));
    const after = Object.fromEntries(Object.entries(before).map(([t, l]) => [t, l.slice()]));
    const takes = [];
    for (const [a, b] of H.pairs) for (const [x, y] of [[a, b], [b, a]]) {
      const m = H.moves[x] || {}, guard = new Set((H.moves[y] || {}).shield || []);
      for (const pid of m.steal || []) { const ok = !guard.has(pid); events.push({ type: "steal", by: x, on: y, pid, ok }); if (ok) takes.push({ by: x, from: y, pid, slot: before[y].indexOf(pid) }); }
      for (const pid of m.jinx || []) { const ok = !guard.has(pid); events.push({ type: "jinx", by: x, on: y, pid, ok }); if (ok) mult[pid] = (mult[pid] || 1) * R.jinx; }
    }
    for (const k of takes) if (after[k.from][k.slot] === k.pid) after[k.from][k.slot] = null;
    for (const k of takes) { after[k.by][k.slot] = k.pid; mult[k.pid] = (mult[k.pid] || 1) * R.steal; }
    const kept = new Set(Object.values(after).flat().filter(Boolean));
    const released = Object.values(before).flat().filter((id) => id && !kept.has(id));
    H.result = { events, lineups: after, released, mult, shields: Object.fromEntries(H.pairs.flat().map((t) => [t, (H.moves[t] || {}).shield || []])) };
    H.done = now;
    D.phase = "done"; D.done = now;
  }

  /* ---------- a trivia draft ---------- */
  // D.trivia { sec, cur, ok: { pick: 1 }, bumped: { pick: 1 }, used: [question ids], log: [] }: before each pick the
  // team on the clock answers an easy multiple-choice question (ctx.hooks.trivia(D, k) makes it). Right, and the pick
  // clock starts fresh. Wrong, or out of time, and the pick moves to the end of the round: everyone after it in the
  // round moves up one. A pick that was moved has no question. Bots get about four in five right; a manager on
  // autodraft skips the questions.
  const TRIVIA_BOT = 0.8;
  // the question up for pick k, still unanswered
  const triviaUp = (D, k) => { const T = D.trivia, q = T && T.cur; return q && q.k === k && q.ans == null && !T.ok[k] && !T.bumped[k] ? q : null; };
  function triviaAsk(D, ctx, now) {
    const T = D.trivia;
    if (!T || D.phase !== "live" || D.paused) return false;
    const k = nextIndex(D);
    if (k < 0 || T.ok[k] || T.bumped[k] || (T.cur && T.cur.k === k)) return false;
    const t = D.teams[D.order[k]];
    if (!t.owner || t.auto) return false;                      // bots answer on their own; autodraft skips them
    const make = ctx && ctx.hooks && ctx.hooks.trivia;
    const q = make ? make(D, k) : null;
    if (!q) { T.ok[k] = 1; return false; }
    // a couple of seconds' grace for the question to reach the manager's page
    T.cur = { k, team: D.order[k], at: now, ends: now + (T.sec || 15) * 1000 + 2500, id: q.id, q: q.q, opts: q.opts, c: q.c, ans: null };
    T.used = (T.used || []).concat(q.id).slice(-200);
    return true;
  }
  function triviaAnswer(D, ctx, teamId, choice, now) {
    const c = onClock(D, now), q = c && c.trivia;
    if (!q || q.team !== teamId) return { ok: false, why: "No question for you right now" };
    if (now > q.ends) return { ok: false, why: "Time ran out" };
    q.ans = choice;
    const right = choice === q.c;
    D.trivia.log = (D.trivia.log || []).concat({ k: q.k, team: teamId, q: q.q, a: q.opts[q.c], got: q.opts[choice] != null ? q.opts[choice] : null, ok: right, at: now }).slice(-60);
    if (right) { D.trivia.ok[q.k] = 1; D.clockStart = now; D.trivia.cur = null; return { ok: true, right: true }; }
    triviaMiss(D, ctx, c, now, choice);
    return { ok: true, right: false, answer: q.opts[q.c] };
  }
  // a miss: the pick goes to the end of its round
  function triviaMiss(D, ctx, c, at, choice) {
    const T = D.trivia, k = c.index, n = D.round1.length, end = Math.min(D.order.length - 1, (Math.floor(k / n) + 1) * n - 1);
    if (T.cur && T.cur.k === k && choice == null) T.log = (T.log || []).concat({ k, team: c.team, q: T.cur.q, a: T.cur.opts[T.cur.c], got: null, ok: false, at }).slice(-60);
    if (!T.cur || T.cur.k !== k) T.log = (T.log || []).concat({ k, team: c.team, q: null, ok: false, bot: true, at }).slice(-60);
    T.cur = null;
    // everyone after it in the round moves up one, a pick that was already moved still marked as moved
    const team = D.order[k];
    for (let i = k; i < end; i++) { D.order[i] = D.order[i + 1]; if (T.bumped[i + 1]) T.bumped[i] = 1; else delete T.bumped[i]; delete T.ok[i]; }
    D.order[end] = team;
    T.bumped[end] = 1;
    D.clockStart = at;
    triviaAsk(D, ctx, at);
  }

  /* ---------- picks ---------- */
  function pick(D, ctx, teamId, pid, now, auto) {
    if (D.packs) return packPick(D, ctx, teamId, pid, now, auto);
    const c = onClock(D, now);
    if (!c) return { ok: false, why: "The draft isn't open" };
    if (c.team !== teamId) return { ok: false, why: "It's not your pick" };
    if (c.trivia && !auto) return { ok: false, why: "Answer the question first" };
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
    triviaAsk(D, ctx, now);
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
    return { left: sizeOf(D) - ids.length, openStarters: D.lineup.length - filled, lateOpen, fills, urgency: D.packs && D.phase === "live" ? packUrgency(D, ctx, teamId, mine) : null };
  }
  // In a pack draft a position can run out. For a team's open spots that only one position can fill (its TE, its QB):
  // how short that position is, as the teams still needing one against the players left at it in the packs to come.
  function packUrgency(D, ctx, teamId, mine) {
    const t = packTurnNow(D);
    if (t < 0) return null;
    const { q } = packAt(D, t), main = (p) => S.positions(p)[0];
    const supply = {};
    for (let x = q; x < D.packs.cards.length; x++) for (const ids of D.packs.cards[x]) for (const id of ids) if (ctx.own[id] == null && ctx.byId[id]) supply[main(ctx.byId[id])] = (supply[main(ctx.byId[id])] || 0) + 1;
    const openOwn = (team) => {
      const ros = rosters(D)[team].map((id) => ctx.byId[id]).filter(Boolean), got = assign(ctx.sport, ros, D.lineup), out = {};
      D.lineup.forEach((sl, i) => { const v = ctx.sport.slots[sl]; if (!got[i] && v !== "*" && v.length === 1) out[v[0]] = (out[v[0]] || 0) + 1; });
      return out;
    };
    const demand = {};
    for (const team of D.round1) for (const [pos, k] of Object.entries(openOwn(team))) demand[pos] = (demand[pos] || 0) + k;
    const mineOpen = teamId != null ? openOwn(teamId) : {};
    // a position with a single lineup spot (QB, TE): a third of the way in, take one the first time it's there
    const single = {};
    for (const sl of D.lineup) { const v = ctx.sport.slots[sl]; if (v !== "*" && v.length === 1) single[v[0]] = (single[v[0]] || 0) + 1; }
    const late = t >= D.rounds / 3;
    return (pos) => (mineOpen[pos] ? Math.min(3, (demand[pos] || 0) / Math.max(1, supply[pos] || 0)) + (late && single[pos] === 1 ? 2 : 0) : 0);
  }
  function worth(D, ctx, teamId, p, r, need) {
    const { left, openStarters, lateOpen, fills, urgency } = need || needs(D, ctx, teamId);
    const fillsStarter = fills(p);
    // a mystery card is worth what its tier and position go for: nobody, bots included, knows who it is
    const myst = D.packs && D.packs.mystery && D.packs.mystery[p.id] && D.phase === "live";
    let w = myst ? D.packs.est[p.id] : (p.$ || 0) + Math.max(0, p.vor || 0) / ctx.maxVor;
    if (S.isLate(ctx.sport, p)) {
      if (left > lateOpen + 1) w *= 0.05;
    }
    if (!fillsStarter && openStarters > 0) w *= left <= openStarters + 1 ? 0.1 : 0.75;
    // a pack draft can't count on a position coming back around: fill the lineup first
    // the scarcer a position he alone can fill, the sooner a bot takes one while it's there
    // kickers and defenses still wait for the last rounds: there are plenty to go around
    const waits = S.isLate(ctx.sport, p) && left > lateOpen + 1;
    if (priced(D) && D.phase === "live") {
      // with price tags a card is worth what it adds over what it costs, the cost weighed by how tight the money is
      // (money left at the end buys nothing, so a team that's flush pays up), plus a bonus for filling the lineup
      const m = packMoney(D, teamId), par = D.packs.budget / sizeOf(D);
      const beta = 0.85 * Math.max(0.35, Math.min(2.2, par / Math.max(0.5, m.per)));
      const urg = urgency ? urgency(S.positions(p)[0]) : 0;
      w = w - beta * (D.packs.price[p.id] || 1) + (waits ? -5 : fillsStarter ? 0.35 * w + 1 + 20 * urg : openStarters > 0 ? -1000 : 0);
      if (r) w += (r() - 0.5) * 4;
      if (ctx.hooks.worth) w = ctx.hooks.worth(D, D.teams[teamId], p, w, ctx);
      return w;
    }
    if (D.packs && !waits) w = fillsStarter ? w * (1.4 + (urgency ? 6 * urgency(S.positions(p)[0]) : 0)) + 1 + (urgency ? 20 * urgency(S.positions(p)[0]) : 0) : openStarters > 0 ? w * 0.02 : w;
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
    // a manager's own board (team.board, from the Rankings page): the first player on it his roster has a use for
    // (no kicker while starters are open, no bench player while a starting slot he can't fill waits), so it follows
    // his order without taking a third quarterback
    if (team.board && team.board.length) {
      const base = (p) => (p.$ || 0) + Math.max(0, p.vor || 0) / ctx.maxVor;
      let first = null;
      for (const id of team.board) {
        const p = ctx.byId[id];
        if (!p || ctx.own[id] != null || !canAdd(D, ctx, teamId, p).ok) continue;
        first = first || p;
        const b = base(p);
        if (b <= 0 || worth(D, ctx, teamId, p, null, need) / b >= 0.7) return p;
      }
      if (first) return first;
    }
    for (const p of ctx.available.slice(0, 300)) {
      const w = worth(D, ctx, teamId, p, r, need);
      if (w > bw && canAdd(D, ctx, teamId, p).ok) { bw = w; best = p; }
    }
    if (best) return best;
    return ctx.available.find((p) => canAdd(D, ctx, teamId, p).ok) || null;
  }

  // Moves the draft forward to `now`: bots pick after a short delay, a manager whose clock ran out gets an
  // autopick stamped at the moment it expired.
  // A trade offer stops the clock so the manager can read it. D.offerHold: "clock" (the default) holds the draft
  // while the manager on the clock has an offer open, "all" holds it for any manager's offer, "off" never holds.
  // Each offer holds once, for up to HOLD_MAX, and the draft picks up where it was when the offer is answered.
  const HOLD_MAX = 90e3;
  function offerHold(D, now) {
    if (D.type === "auction" || D.phase !== "live") return false;
    const mode = D.offerHold || "clock", c = onClock(D, now);
    const open = (T) => T.status === "pending" && !isBot(D.teams[T.to]) && (mode === "all" || (c && T.to === c.team));
    if (D.hold) {
      const T = (D.trades || []).find((x) => x.id === D.hold.trade);
      if (!T || !open(T) || now - D.hold.at >= HOLD_MAX) { pause(D, now, false); return true; }
      return false;
    }
    if (mode === "off" || D.paused) return false;
    D.held = D.held || {};
    const T = (D.trades || []).find((x) => open(x) && !D.held[x.id]);
    if (!T) return false;
    D.held[T.id] = 1;
    if (now - T.at >= HOLD_MAX) return false;     // an offer from a while ago (the draft caught up on its own) doesn't stop it
    pause(D, now, true);
    D.hold = { trade: T.id, team: T.to, at: now };
    return true;
  }
  const holdLeft = (D, now) => (D.hold ? Math.max(0, HOLD_MAX - (now - D.hold.at)) : 0);
  function tick(D, ctx, now, max = 1000) {
    if (D.type === "auction") return auctionTick(D, ctx, now, max);
    if (D.packs) return packTick(D, ctx, now, max);
    offerHold(D, now);
    let n = 0;
    while (n < max && D.phase === "live" && !D.paused) {
      const c = onClock(D, now);
      if (!c) break;
      const team = D.teams[c.team];
      if (!isBot(team) && !D.offered[c.index]) { D.offered[c.index] = true; if (botOffer(D, ctx, c, Math.min(now, D.clockStart))) { offerHold(D, now); if (D.paused) break; } }
      if (D.trivia && !D.trivia.ok[c.index] && !D.trivia.bumped[c.index]) {
        if (!team.owner) {
          // a bot answers after its delay, and gets about four in five right
          const at = D.clockStart + D.botDelay;
          if (now < at) break;
          if (hash01(`${D.seed}:trivia:${c.index}:${c.team}`) >= TRIVIA_BOT) { triviaMiss(D, ctx, c, at, null); n++; continue; }
          D.trivia.ok[c.index] = 1;
        } else if (!team.auto) {
          if (!c.trivia) { if (triviaAsk(D, ctx, now)) n++; else D.trivia.ok[c.index] = 1; continue; }
          if (now < c.trivia.ends) break;
          triviaMiss(D, ctx, c, c.trivia.ends, null); n++; continue;
        }
      }
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
    if (!Number.isFinite(amt) || !Number.isInteger(amt)) return { ok: false, why: "Enter a whole-dollar bid" };
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
  // with no player list to price picks from: the same top-heavy shape as auction values (see value.js)
  const defaultCurve = (total) => Array.from({ length: total }, (_, k) => 1 + 70 * Math.max(0, 1 - k / Math.max(1, total * 0.6)) ** 2);
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
      const mult = (S.SHOWDOWN && S.SHOWDOWN.mult) || {};
      const score = sum(starters.map((p, i) => (p ? (p.v || 0) * (mult[D.lineup[i]] || 1) : 0)));
      const cats = {};
      for (const p of starters.filter(Boolean)) for (const [k, z] of Object.entries(p.zc || {})) cats[k] = (cats[k] || 0) + z;
      const spent = D.type === "auction" ? sum(D.sales.filter((s) => s.team === t).map((s) => s.price)) : null;
      return { team: t, score, starters, bench: ps.filter((p) => !starters.includes(p)), cats, spent };
    });
    const sorted = rows.slice().sort((a, b) => b.score - a.score);
    sorted.forEach((r, i) => { r.rank = i + 1; r.grade = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D"][Math.min(9, Math.floor((i / Math.max(1, rows.length - 1)) * 9.99))]; });
    return rows;
  }

  // The draft in a few headlines: the best values and biggest reaches against the rankings (a pick's slot against
  // the player's overall rank; in an auction, his value against his price), each team's best value, and position
  // runs (four or more of one position inside six straight picks). Keepers and kickers/defenses are left out.
  function recap(D, ctx) {
    const sp = ctx.sport, auc = D.type === "auction";
    const made = made_(D).filter((pk) => pk && pk.pid && !pk.keeper && ctx.byId[pk.pid]);
    // a snake pick's worth: what the player at that slot in the rankings is worth, so a value at 1.08 counts for
    // more than one in round 14
    const curve = ctx.players.map((p) => Math.max(0, p.$ || 0)).sort((a, b) => b - a);
    const rows = made.map((pk, i) => {
      const p = ctx.byId[pk.pid], at = auc ? i + 1 : pk.n, slot = auc ? pk.price : curve[at - 1] || 0;
      return { team: pk.team, pid: pk.pid, at, rank: p.rank, price: auc ? pk.price : null, $: p.$ || 0, slot,
        diff: Math.round((p.$ || 0) - slot), late: !!(sp.late && sp.late.length && S.isLate(sp, p)), pos: S.positions(p)[0] };
    });
    const real = rows.filter((r) => !r.late);
    const steals = real.slice().sort((a, b) => b.diff - a.diff).filter((r) => r.diff > 0).slice(0, 5);
    const reaches = real.slice().sort((a, b) => a.diff - b.diff).filter((r) => r.diff < 0).slice(0, 5);
    const best = {}, worst = {};
    for (const r of real) { if (!best[r.team] || r.diff > best[r.team].diff) best[r.team] = r; if (!worst[r.team] || r.diff < worst[r.team].diff) worst[r.team] = r; }
    const runs = [];
    if (!auc) {
      const seq = made.slice().sort((a, b) => a.n - b.n).map((pk) => S.positions(ctx.byId[pk.pid])[0]);
      for (let i = 0; i + 6 <= seq.length; i++) {
        const win = seq.slice(i, i + 6), pos = win[0], n = win.filter((x) => x === pos).length;
        if (n < 4 || (sp.late || []).includes(pos)) continue;
        const prev = runs[runs.length - 1];
        if (prev && prev.pos === pos && prev.to >= i) { prev.to = i + 5; prev.count = seq.slice(prev.from, prev.to + 1).filter((x) => x === pos).length; continue; }
        runs.push({ pos, from: i, to: i + 5, count: n });
      }
      for (const r of runs) { const ks = made.slice().sort((a, b) => a.n - b.n); r.fromPick = ks[r.from].n; r.toPick = ks[r.to].n; r.of = r.to - r.from + 1; }
    }
    return D.packs ? Object.assign(packRecap(D, ctx, made), { runs: [], auction: false }) : { steals, reaches, best, worst, runs: runs.slice(0, 4), auction: auc };
  }
  // A pack draft's round says which pack a player was in, not what he cost. So a pick is judged by the pack he came
  // from: how many teams passed him by (a steal), and who was still in the pack when he was taken (a reach).
  function packRecap(D, ctx, made) {
    const n = D.round1.length, turnOf = {}, $ = (id) => (ctx.byId[id] ? Math.max(0, ctx.byId[id].$ || 0) : 0);
    for (const pk of made) turnOf[pk.pid] = Math.floor((pk.n - 1) / n);
    const rows = made.filter((pk) => pk.n - 1 < n * (D.rounds || 1e3)).map((pk) => {
      const t = Math.floor((pk.n - 1) / n), seat = (pk.n - 1) % n, { q, j } = packAt(D, t), d = q % 2 === 0 ? 1 : -1;
      const src = (((seat - d * j) % n) + n) % n, pack = D.packs.cards[q][src] || [];
      const left = pack.filter((id) => id !== pk.pid && !(turnOf[id] < t));           // still in the pack when he was taken
      const p = ctx.byId[pk.pid], pos = S.positions(p)[0];
      // the best one left at his position: a team that needed a quarterback didn't reach by taking one
      const top = left.filter((id) => ctx.byId[id] && S.positions(ctx.byId[id])[0] === pos).sort((a, b) => $(b) - $(a))[0];
      return { team: pk.team, pid: pk.pid, at: pk.n, rank: p.rank, $: $(pk.pid), passed: j, price: pk.price, myst: !!(D.packs.mystery && D.packs.mystery[pk.pid]), opener: D.round1[src], tier: (D.packs.tier || {})[pk.pid] || "",
        over: top != null && $(top) > $(pk.pid) ? { pid: top, by: $(top) - $(pk.pid) } : null, late: !!(ctx.sport.late && ctx.sport.late.length && S.isLate(ctx.sport, p)) };
    }).filter((r) => !r.late);
    // a steal: a good player who went around the table; the score is his value, more for every team that passed him
    const steals = rows.filter((r) => r.passed >= 2 && r.$ > 1).map((r) => Object.assign(r, { diff: Math.round(r.$ * r.passed / 2) })).sort((a, b) => b.diff - a.diff).slice(0, 5);
    const reaches = rows.filter((r) => r.over && r.over.by >= 3).map((r) => Object.assign({}, r, { diff: -Math.round(r.over.by) })).sort((a, b) => a.diff - b.diff).slice(0, 5);
    const pulls = rows.filter((r) => r.tier === "chase" || (r.tier === "star" && r.passed === 0)).sort((a, b) => b.$ - a.$).slice(0, 5);
    const best = {}, worst = {};
    for (const r of steals) if (!best[r.team]) best[r.team] = r;
    for (const r of reaches) if (!worst[r.team]) worst[r.team] = r;
    // with price tags: the best buys (value over what was paid), and how each mystery card turned out
    const paid = rows.filter((r) => r.price != null);
    const buys = paid.filter((r) => !r.myst && r.$ - r.price >= 3).sort((a, b) => (b.$ - b.price) - (a.$ - a.price)).slice(0, 5);
    const mysteries = paid.filter((r) => r.myst).sort((a, b) => (b.$ - b.price) - (a.$ - a.price));
    const spent = {};
    for (const r of paid) spent[r.team] = (spent[r.team] || 0) + r.price;
    return { steals, reaches, best, worst, pulls, buys, mysteries, spent, budget: D.packs.budget, pack: true };
  }
  const made_ = (D) => made(D);

  /* ---------- salary cap: no draft ---------- */
  // D.cap { budget, due, bonus }: each team builds one lineup (D.lineup, no bench) under the budget, and a player can
  // be on any number of teams. Entries are sealed on the server until due (the first kickoff), then capReveal makes
  // them the board. A player only one team picked scores D.cap.bonus times (1.25x) for that team.
  // Prices are set once, when the game is made (D.cap.prices), so they can't move under a saved lineup: by projection,
  // like a daily game, from 40% of an even share of the budget for a fringe player to 1.9x it for the best one. A
  // captain costs 1.5x.
  function capPrices(D, players, sport) {
    const n = D.lineup.length, avg = D.cap.budget / n;
    const fit = players.filter((p) => D.lineup.some((sl) => S.fits(sport, p, sl))).sort((a, b) => (b.v || 0) - (a.v || 0));
    if (!fit.length) return {};
    const hi = fit[0].v || 0, lo = fit[Math.floor(fit.length / 2)].v || 0, out = {};
    for (const p of fit) {
      const t = hi > lo ? Math.max(0, Math.min(1, ((p.v || 0) - lo) / (hi - lo))) : 0;
      out[p.id] = Math.max(1, Math.round(avg * (0.4 + 1.5 * Math.pow(t, 1.1))));
    }
    return out;
  }
  // a player with no price (a kicker, or someone added to the pool after the game was made) can't be picked: null
  const capPrice = (D, p) => (!p ? null : D.cap && D.cap.prices ? (D.cap.prices[p.id] == null ? null : D.cap.prices[p.id]) : Math.max(1, Math.round(p.$ || 1)));
  const capCost = (D, p, slot) => { const x = capPrice(D, p); return x == null ? null : slot === "CPT" ? Math.round(x * 1.5) : x; };
  function capCheck(D, ctx, entry) {
    const lu = D.lineup, budget = D.cap.budget;
    if (!Array.isArray(entry) || entry.length !== lu.length) return { ok: false, why: "Fill every spot in your lineup" };
    const seen = new Set(); let spent = 0;
    for (let i = 0; i < lu.length; i++) {
      const pid = entry[i], p = pid && ctx.byId[pid];
      if (!pid) return { ok: false, why: `Fill your ${lu[i]} spot` };
      if (!p || capPrice(D, p) == null) return { ok: false, why: "One of your players isn't in this game's pool" };
      if (seen.has(pid)) return { ok: false, why: `${p.n} is in your lineup twice` };
      if (!S.fits(ctx.sport, p, lu[i])) return { ok: false, why: `${p.n} can't play ${lu[i]}` };
      seen.add(pid); spent += capCost(D, p, lu[i]);
    }
    if (spent > budget) return { ok: false, why: `That's $${spent}, over the $${budget} cap` };
    const cm = D.season && D.season.confMax;
    if (cm) {
      const by = {};
      for (const pid of entry) { const c = S.confOf(ctx.byId[pid]); if (c) by[c] = (by[c] || 0) + 1; }
      const over = Object.keys(by).find((c) => by[c] > cm);
      if (over) return { ok: false, why: `Only ${cm} starters can come from the ${over}` };
    }
    return { ok: true, spent, left: budget - spent };
  }
  // a lineup for a team with no entry (a bot, or someone who didn't make it): the most value it can afford, slot by
  // slot, one-position slots first, keeping the cheapest price for each spot still to fill, with a little of its own taste
  function capAuto(D, ctx, seed) {
    const r = rng(seed >>> 0), lu = D.lineup, out = Array(lu.length).fill(null), used = new Set();
    const order = lu.map((sl, i) => i).sort((a, b) => (ctx.sport.slots[lu[a]] === "*" ? 99 : ctx.sport.slots[lu[a]].length) - (ctx.sport.slots[lu[b]] === "*" ? 99 : ctx.sport.slots[lu[b]].length));
    let left = D.cap.budget;
    const cm = D.season && D.season.confMax, conf = {};
    // the cheapest player there is, and how much projection a dollar buys on average
    const prices = ctx.players.map((p) => capPrice(D, p)).filter((x) => x != null), minP = prices.length ? Math.min(...prices) : 1;
    const vPer = ctx.players.reduce((a, p) => a + (p.v || 0), 0) / Math.max(1, prices.reduce((a, b) => a + b, 0));
    order.forEach((i, k) => {
      const keep = order.length - k - 1;
      // spend toward an even share of what's left, with room to splurge
      const share = (left - keep * minP) / (keep + 1) * (1.3 + r() * 0.6);
      const minLeft = keep * minP;
      const pool = ctx.players.filter((p) => !used.has(p.id) && S.fits(ctx.sport, p, lu[i]) && capCost(D, p, lu[i]) != null && capCost(D, p, lu[i]) <= left - minLeft && !(cm && S.confOf(p) && (conf[S.confOf(p)] || 0) >= cm));
      const pick = pool.map((p) => ({ p, s: (p.v || 0) * (0.85 + r() * 0.3) - Math.max(0, capCost(D, p, lu[i]) - share) * vPer })).sort((a, b) => b.s - a.s)[0];
      if (pick) { out[i] = pick.p.id; used.add(pick.p.id); left -= capCost(D, pick.p, lu[i]); const c = S.confOf(pick.p); if (c) conf[c] = (conf[c] || 0) + 1; }
    });
    return out;
  }
  function capReveal(D, ctx, entries, now) {
    if (!D.cap || D.phase !== "setup") return false;
    const lineups = {};
    D.teams.forEach((t, i) => {
      const e = entries && entries[i];
      lineups[i] = e && capCheck(D, ctx, e).ok ? e.slice() : capAuto(D, ctx, (D.seed || 1) + i * 7919);
    });
    D.board = []; D.order = []; let n = 0;
    for (const i of Object.keys(lineups)) for (const pid of lineups[i]) if (pid) { D.board.push({ n: ++n, team: +i, pid, at: now, auto: !(entries && entries[i]) }); D.order.push(+i); }
    const count = {};
    for (const i of Object.keys(lineups)) for (const pid of lineups[i]) if (pid) count[pid] = (count[pid] || 0) + 1;
    D.cap.lineups = lineups;
    D.cap.unique = D.cap.bonus ? Object.keys(count).filter((pid) => count[pid] === 1) : [];
    D.cap.picked = count;
    D.rounds = D.lineup.length; D.bench = 0;
    D.phase = "done"; D.done = now; D.started = D.started || now;
    return true;
  }
  /* ---------- a sealed draft ---------- */
  // D.sealed { due }: everyone ranks players privately by due; then the draft runs itself, each team picking the best
  // player left on its list (bots and anyone without a list take the best player left).
  function sealedRun(D, ctx, lists, now) {
    if (!D.sealed || D.phase !== "setup") return false;
    D.teams.forEach((t, i) => { t.queue = ((lists && lists[i]) || []).filter((pid) => ctx.byId[pid]).slice(0, 400); t.auto = true; });
    D.botDelay = 0;
    start(D, now);
    let t = now;
    for (let k = 0; k < 20000 && D.phase === "live"; k++) { t += 1000; tick(D, ctx, t, 2000); }
    D.teams.forEach((x) => { x.auto = false; });
    D.sealed.ran = now;
    return true;
  }
  return { triviaAsk, triviaAnswer, triviaUp, TRIVIA_BOT, capPrices, capPrice, capCost, capCheck, capAuto, capReveal, sealedRun, dealPacks, packMoney, packPrice, packFor, packAt, packSlot, packTurnNow, HEIST, heistRules, heistFoe, heistLineup, heistMove, heistCheck, heistDefault, heistTick, heistSealed, heistDue, heistIn, heistUnseal, spinOf, wheelFor, respin, respinsLeft, setOrder, recap, FORMATS, REVEALS, NAMES, rng, hash01, makeOrder, create, keep, made, rosters, context, assign, canAdd, onClock, nextPickOf, isBot,
    start, pause, pick, worth, resize, offerHold, holdLeft, HOLD_MAX, autoChoice, tick, undo, maxBid, spotsLeft, nominator, auctionState, nominate, bid, pass, botMax, standings, sizeOf,
    clockLen, thinkTime, bankShare, slotInfo, fitsRoster, canSteal, steal, stealsOf, stealsLeft, stealsOpen, botSteal, pickCurve, dealPackages, fairDeal, seen, pickLabel, picksOf, pickValue, pickId, isPickId, pickIdx, assetValue, sideValue,
    tradeCheck, balance, propose, respond, cancel, botAnswer, botOffer };
});
