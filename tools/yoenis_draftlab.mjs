// Builds Don't Forget to Wipe Yoenis as a Draft Lab league, as it stands after the 2026 season: the 16 teams, the
// 2026 draft, final rosters (injured list too), the final standings, every keeper's cost history, and the seasons
// back to 2013 as league history. Writes tools/yoenis_draftlab.json ({ name, draft, league, seasons, seats }), which
// the database loads (see the note at the end of tools/fantasykit_supabase.sql).
//
// Sources: tools/yahoo_yoenis/2026.json (Yahoo's draft, rosters and final ranks) and yoenis/data.json (team and
// manager names, past seasons, and data.keepers2027: each rostered player's keeper cost under the league's rules,
// which the Yoenis page shows). Run: node tools/yoenis_draftlab.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js');
const V = require('../fantasy-kit/value.js');
const F = require('../fantasy-kit/draft.js');
const G = require('../fantasy-kit/league.js');
const Z = require('../fantasy-kit/season.js');
const root = new URL('../', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

const Y = read('tools/yahoo_yoenis/2026.json');
const data = read('yoenis/data.json');
const pool = read('fantasy-kit/data/mlb.json');
const s26 = data.seasons.find((x) => +x.year === 2026);

// names match across Yahoo and the player feed once accents, punctuation, suffixes and Ohtani's "(Batter)" go
const norm = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\(.*?\)/g, '').replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z]/g, '');
// two players can share a name once it's folded (Luis García Jr. the infielder and Luis García the pitcher; the Dodgers'
// and the Athletics' Max Muncy): keep every one, and pick by exact name, then MLB team, then position
const byName = new Map();
for (const p of pool.players) { const k = norm(p.n); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(p); }
const fold = (s) => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
function findPlayer(name, mlb, pos) {
  const c = byName.get(norm(name));
  if (!c) return null;
  if (c.length === 1) return c[0];
  const ps = yPos(pos);
  const score = (p) => (fold(p.n) === fold(name) ? 4 : 0) + (mlb && p.t === mlb ? 2 : 0) + (ps.some((x) => p.pos.includes(x)) ? 1 : 0);
  return c.slice().sort((a, b) => score(b) - score(a))[0];
}

// the teams, in the order the Yoenis page uses (2026's), with their Yahoo keys and managers
const teams = s26.teams.map((name, i) => ({ name, owner: (data.owners[s26.o[i]] || {}).n || data.managers[name] || null }));
const keyOf = {};
for (const [k, t] of Object.entries(Y.teams)) keyOf[k] = teams.findIndex((x) => x.name === t.name);
if (Object.values(keyOf).some((i) => i < 0)) throw new Error('a Yahoo team has no match');
const abbr = (name) => { const w = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean); return (w.length > 1 ? w.slice(0, 3).map((x) => x[0]).join('') : w[0].slice(0, 3)).toUpperCase(); };
teams.forEach((t) => (t.abbr = abbr(t.name)));

// players the feed doesn't have (prospects, a pitcher out for the year) ride along with the league
const extra = new Map();
const yPos = (pos) => String(pos || 'UTIL').split(',').map((x) => x.trim()).map((x) => (x === 'Util' ? 'UT' : x)).filter((x) => x && x !== 'IL' && x !== 'BN');
// Yahoo keeps Ohtani as two players (the batter and the pitcher, on different teams here): this league carries both,
// each with his half of the feed's lines, and hides the feed's combined Ohtani
const two = (byName.get(norm('Shohei Ohtani')) || [])[0];
const split = two ? {
  'shoheiohtanibatter': { id: 'yx-ohtani-b', n: 'Shohei Ohtani (Batter)', t: two.t, pos: ['UT'], age: two.age, l: Object.fromEntries(Object.entries(two.l || {}).filter(([k]) => /bat/.test(k))) },
  'shoheiohtanipitcher': { id: 'yx-ohtani-p', n: 'Shohei Ohtani (Pitcher)', t: two.t, pos: ['SP'], age: two.age, l: Object.fromEntries(Object.entries(two.l || {}).filter(([k]) => /pit/.test(k))) },
} : {};
const rawKey = (s) => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
function idOf(name, pos, mlb) {
  const sp = split[rawKey(name)];
  if (sp) { if (!extra.has(sp.id)) extra.set(sp.id, sp); return sp.id; }
  const p = findPlayer(name, mlb, pos);
  if (p) return p.id;
  const id = 'yx-' + norm(name);
  if (!extra.has(id)) extra.set(id, { id, n: name.replace(/\s*\((Batter|Pitcher)\)/, ''), t: mlb || 'FA', pos: yPos(pos).length ? yPos(pos) : ['UT'] });
  return id;
}

// the league's rules
const lineup = ['C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'UTIL', 'UTIL', 'SP', 'SP', 'SP', 'RP', 'RP', 'RP', 'P', 'P', 'P', 'P'];
const bench = 5, rounds = lineup.length + bench;
const sport = S.attach(Object.assign({}, S.mlb), pool);
const draftAt = Number(Y.settings.draft_time) * 1000;

// the 2026 draft, pick by pick as Yahoo has it (each slot's team, so traded picks land right)
const picks = Y.draft.slice().sort((a, b) => a.pick - b.pick);
if (picks.length !== rounds * 16) throw new Error(`expected ${rounds * 16} picks, got ${picks.length}`);
const D = F.create({ sport, type: 'snake', teams, seed: 2026, now: draftAt, lineup, bench, rounds, scoring: 'yoenis', botDelay: 1500, clock: 90, name: data.league, trades: true,
  order: picks.slice(0, 16).map((p) => keyOf[p.team]) });
D.order = picks.map((p) => keyOf[p.team]);
const kept26 = new Set(s26.draft.filter((x) => x[3]).map((x) => `${x[1]}|${norm(x[2])}`));
picks.forEach((p, k) => {
  const team = keyOf[p.team], pid = idOf(p.name, p.pos, p.mlb);
  D.board[k] = Object.assign({ n: k + 1, team, pid, at: draftAt + k * 60000 }, kept26.has(`${team}|${norm(p.name)}`) ? { keeper: true } : {});
});
D.teams.forEach((t, i) => (t.color = (i * 5) % 12));
D.phase = 'done'; D.done = draftAt + picks.length * 60000; D.year = data.seasons.length;
// the league's look: the banner says WY (Wipe Yoenis), in green
const brand = { color: 2, letters: 'WY', hex: '#BD3039', bg: '#1F4532' }; // the Green Monster and Red Sox red, as on the Yoenis page
D.season = { format: 'h2h', weeks: 22, playoffTeams: 6, faab: 100, waivers: 'faab', keepers: 5, keeperRule: { steps: [0, 2, 6], fa: 15, cutoff: '09-01', sameRound: 'up' }, pickTrades: 'offseason', review: 'commish', ir: 3 };
D.extraPlayers = [];

// the season, from that draft
const L = Z.begin(D, sport, { now: Date.UTC(2026, 2, 26), name: data.league, season: '2026' });
L.season = '2026';
L.settings.brand = brand;
L.start = Date.UTC(2026, 2, 26, 7);

// final rosters, the injured list included (it holds a roster spot here like any bench player)
const rosterOf = {}, slots = {};
for (const [k, list] of Object.entries(Y.rosters)) {
  const t = keyOf[k];
  rosterOf[t] = list.map((p) => idOf(p.name, p.pos, p.mlb));
  list.forEach((p) => (slots[idOf(p.name, p.pos, p.mlb)] = p.slot));
}
L.rosters = teams.map((_, t) => rosterOf[t] || []);
L.ir = teams.map((_, t) => L.rosters[t].filter((pid) => slots[pid] === 'IL'));

// keeper history: each player's base cost and years kept, and anyone added too late, from the Yoenis page's math
L.keepInfo = {};
const miss = [];
for (const [team, rows] of Object.entries(data.keepers2027)) {
  const t = teams.findIndex((x) => x.name === team);
  for (const e of rows) {
    const pid = L.rosters[t].find((id) => { const x = pool.players.find((p) => p.id === id) || extra.get(id); return x && (x.n === e.p || norm(x.n) === norm(e.p)) && (!split[rawKey(e.p)] || id === split[rawKey(e.p)].id); }) || idOf(e.p, null, null);
    if (!L.rosters[t].includes(pid)) { miss.push(`${team}: ${e.p}`); continue; }
    const years = e.next ? e.next[1] - 1 : e.k ? e.k[1] : 0;
    L.keepInfo[pid] = Object.assign({ base: e.path[0], years }, e.late ? { late: true } : {});
  }
}
if (miss.length) console.warn(`keeper rows with no rostered player (${miss.length}):`, miss.slice(0, 10));
L.extraPlayers = [...extra.values()];
D.extraPlayers = L.extraPlayers;
if (two) L.hidePlayers = D.hidePlayers = [two.id];

// ---------- the league's real rules (Yahoo's settings page and the league's own rules) ----------
const H = read('tools/yahoo_yoenis/history/2026.json');
const yWeeks = H.weeks, REG = yWeeks.filter((w) => !w.matchups.some((m) => m.playoffs || m.consolation)).length;   // 23
const dayOf = (iso) => Date.parse(iso + 'T12:00:00Z');
const weekOfDay = (t) => { const w = yWeeks.find((x) => t >= dayOf(x.s) - 12 * 36e5 && t <= dayOf(x.e) + 12 * 36e5); return w ? w.week : t < dayOf(yWeeks[0].s) ? 1 : yWeeks.length; };
Object.assign(L.settings, {
  tally: 'cats',                                     // the standings count every category: 214-127-27, not matchups
  weeks: REG, playoffTeams: 8, playoffLegs: '1', consolation: 'places', reseed: true, playoffTie: 'h2h',  // 8 teams, no byes, every playoff team plays for its place
  ir: 4, maxAdds: 7, minIP: 30, waiverDays: 2, faab: 100, waivers: 'faab',
  tradeReview: 'counter', reviewHours: 48, tradeMax: 2, deadline: weekOfDay(Date.parse(Y.settings.trade_end_date + 'T12:00:00Z')),
  draftOrder: 'lottery', lotteryOdds: 'weighted', daily: true, bots: false, historyUrl: '/yoenis/',
});
L.settings.playoffWeeks = G.playoffPlan(L).reduce((a, rd) => a + rd.weeks.length, 0);
// weeks line up with Yahoo's: week 1 is the short opening week, then Monday to Sunday
L.start = dayOf(yWeeks[1].s) - 7 * 864e5 - 5 * 36e5;
// Yahoo's schedule and every week's category results
const T = (k) => keyOf[k];
L.schedule = yWeeks.slice(0, REG).map((w) => w.matchups.map((m) => [T(m.teams[0]), T(m.teams[1])]));
const sc = sport.scorings.yoenis, catKey = H.cats.map((c) => (sc.cats.find((x) => x.label === c.abbr) || {}).k);
if (catKey.some((k) => !k)) throw new Error('a Yahoo category has no match: ' + H.cats.map((c) => c.abbr).join(','));
function resultOf(m, a, b) {
  const ka = Object.keys(Y.teams).find((k) => T(k) === a), kb = Object.keys(Y.teams).find((k) => T(k) === b);
  const cats = {}; let wa = 0, wb = 0, ties = 0;
  catKey.forEach((k, i) => { const won = m.won[i], d = won === ka ? 1 : won === kb ? -1 : 0; cats[k] = [m.stats[ka][i], m.stats[kb][i], d]; if (d > 0) wa++; else if (d < 0) wb++; else ties++; });
  return { a, b, sa: wa, sb: wb, ties, w: wa > wb ? 'a' : wa < wb ? 'b' : 't', cats, ta: null, tb: null };
}
L.results = {};
for (let w = 1; w <= REG; w++) L.results[w] = yWeeks[w - 1].matchups.map((m) => resultOf(m, T(m.teams[0]), T(m.teams[1])));
// the playoffs, a round at a time: the bracket this league's rules make, matched to Yahoo's games
const ctx0 = G.context(L, pool.players.concat([...extra.values()]).map((p) => ({ ...p })), sport);
const poMiss = [];
for (let w = REG + 1; w <= yWeeks.length; w++) {
  L.week = w;
  const pairs = G.playoffGames(L, ctx0, w), ym = yWeeks[w - 1].matchups.slice();
  L.results[w] = pairs.map((pr) => {
    const k = ym.findIndex((m) => { const x = m.teams.map(T); return (x[0] === pr[0] && x[1] === pr[1]) || (x[0] === pr[1] && x[1] === pr[0]); });
    if (k < 0) { poMiss.push(`week ${w}: ${teams[pr[0]].name} v ${teams[pr[1]].name} isn't a Yahoo game`); return null; }
    const m = ym.splice(k, 1)[0];
    return Object.assign(resultOf(m, pr[0], pr[1]), { kind: pr.kind });
  }).filter(Boolean);
  for (const m of ym) poMiss.push(`week ${w}: Yahoo's ${m.teams.map((k) => Y.teams[k].name).join(' v ')} isn't in the bracket`);
}
L.week = G.totalWeeks(L) + 1;
const fin = G.finish(L), yFinal = s26.standings.slice().sort((a, b) => a[0] - b[0]).map((r) => r[1]);
const placesOk = [fin.champion, fin.runnerUp, fin.third].every((t, i) => t === yFinal[i]);
// Yahoo's final places stand only if the bracket here came out differently
L.imported = placesOk && !poMiss.length ? { from: 'Yahoo' } : { from: 'Yahoo', final: { champion: yFinal[0], runnerUp: yFinal[1], third: yFinal[2] } };

// ---------- the waiver budget, waiver order, and every move of the season ----------
let mgr = null;
try { mgr = JSON.parse(readFileSync(process.env.YOENIS_MANAGERS || '/dev/null', 'utf8')); } catch (e) { /* run without it: FAAB and priority from Yahoo's transactions are skipped */ }
if (mgr) for (const m of mgr.teams) { const t = teams.findIndex((x) => x.name === m.team || (m.team === 'Kitty' && x.name.startsWith('Kitty'))); if (t >= 0) { L.teams[t].faab = m.fabLeft; L.teams[t].priority = m.waiverPriority; } }
L.tx = L.tx.filter((x) => x.type === 'draft');
L.trades = [];
// Yahoo's own player keys settle two players with one name (the Dodgers' and the Athletics' Max Muncy)
const byKey = {};
for (const p of Y.draft) if (p.player) byKey[p.player] = idOf(p.name, p.pos, p.mlb);
for (const list of Object.values(Y.rosters)) for (const p of list) if (p.key) byKey[p.key] = idOf(p.name, p.pos, p.mlb);
const txs = Y.transactions.filter((x) => x.status === 'successful' && x.type !== 'commish' && x.moves.length).sort((a, b) => a.ts - b.ts);
for (const x of txs) {
  const at = x.ts * 1000, week = weekOfDay(at), pid = (mv) => byKey[mv.player] || idOf(mv.name, mv.pos, null);
  if (x.type === 'trade') {
    const from = T(x.moves[0].from_team), to = T(x.moves[0].to_team);
    const give = x.moves.filter((mv) => T(mv.from_team) === from).map(pid), get = x.moves.filter((mv) => T(mv.from_team) === to).map(pid);
    const id = L.nextId++;
    L.trades.push({ id, from, to, give, get, pickGive: [], pickGet: [], faabGive: 0, faabGet: 0, dropsFrom: [], dropsTo: [], note: '', at, status: 'accepted', done: at });
    L.tx.push({ id: L.nextId++, at, week, type: 'trade', team: from, other: to, adds: get, drops: give, trade: id });
    continue;
  }
  const team = T((x.moves.find((mv) => mv.to_team) || x.moves[0]).to_team || x.moves[0].from_team);
  const add = x.moves.find((mv) => mv.type === 'add'), drop = x.moves.find((mv) => mv.type === 'drop');
  const type = add && add.from === 'waivers' ? 'waiver' : add && drop ? 'add/drop' : add ? 'add' : 'drop';
  L.tx.push(Object.assign({ id: L.nextId++, at, week, type, team, adds: add ? [pid(add)] : [], drops: drop ? [pid(drop)] : [] }, x.faab != null && add ? { faab: x.faab } : {}));   // what the claim cost, when Yahoo recorded it
}

// every season before this one, for the History page and the champion pennants. A team is this league's team when the
// same manager runs it now (x.o: the manager behind each team that year), so the all-time standings and titles follow
// managers through their renames; a manager who has left keeps a team id of his own ("x:" and his key).
const nowTeam = Object.fromEntries(s26.o.map((k, i) => [k, i]));
const seasons = data.seasons.filter((x) => +x.year < 2026).sort((a, b) => a.year - b.year).map((x, i) => {
  const id = (t) => (nowTeam[x.o[t]] != null ? nowTeam[x.o[t]] : `x:${x.o[t]}`);
  const rows = x.standings.map(([rank, t, rec]) => { const [w, l, tt] = rec.split('-').map(Number); return { team: id(t), name: x.teams[t], owner: (data.owners[x.o[t]] || {}).n || null, w, l, t: tt, rank, place: rank }; }).sort((a, b) => a.rank - b.rank);
  const who = (r) => (r ? { team: r.team, name: r.name, owner: r.owner } : null);
  return { season: String(x.year), year: i + 1, sport: 'mlb', format: 'h2h', champion: who(rows[0]), runnerUp: who(rows[1]), third: who(rows[2]), playoffTeams: 6, standings: rows };
});

// ---------- Yahoo's ranks and the season's box scores (tools/yoenis_box_pull.py, run in the box score workflow) ----------
// a player in the pool by name, without adding anyone new (the ranks and box scores cover players nobody rostered)
const findId = (name, pos, mlb) => (split[rawKey(name)] || {}).id || (findPlayer(name, mlb, pos) || {}).id || null;
const tryRead = (f) => { try { return read(f); } catch (e) { return null; } };
const yr = tryRead('tools/yahoo_yoenis/box/ranks2026.json');
if (yr && yr.players) {
  const ranks = {};
  for (const [yk, r] of Object.entries(yr.players)) {
    const pid = byKey[yk] || findId(r.n || '', r.pos, r.t);
    if (!pid) continue;
    const o = {};
    if (r.pre) o.pre = r.pre;
    if (r.szn) o.szn = r.szn;
    if (r.own != null) o.own = r.own;
    if (Object.keys(o).length) ranks[pid] = o;
  }
  L.ext = { source: 'Yahoo', season: 2026, ranks };
  console.log(`Yahoo ranks: ${Object.keys(ranks).length} players`);
}
// each team's season totals in every category, as Yahoo has them (the Team stats page)
{
  const race = tryRead('yoenis/race.json');
  if (race && race.season_stats) {
    const keyOfCat = { R: 'r', H: 'h', HR: 'hr', RBI: 'rbi', SB: 'sb', TB: 'tb', AVG: 'avg', OPS: 'ops', W: 'w', L: 'l', SV: 'sv', K: 'k', HLD: 'hld', ERA: 'era', WHIP: 'whip', QS: 'qs' };
    const out = {};
    for (const [tk, arr] of Object.entries(race.season_stats)) { const t = keyOf[tk]; if (t == null || t < 0) continue; out[t] = Object.fromEntries(race.cats.map((c, i) => [keyOfCat[c.abbr] || c.abbr.toLowerCase(), arr[i]])); }
    L.imported.seasonStats = out;
  }
}
const yb = tryRead('tools/yahoo_yoenis/box/2026.json');
if (yb && yb.box && Object.keys(yb.box).length) {
  const weeks = {};
  let n = 0, miss = 0;
  for (const [w, teamsOf] of Object.entries(yb.box)) {
    for (const [tk, players] of Object.entries(teamsOf)) {
      const t = keyOf[tk];
      if (t == null || t < 0) continue;
      for (const [pk, row] of Object.entries(players)) {
        const name = (yb.names || {})[pk] || '';
        const pid = byKey[pk] || findId(name, null, null);
        if (!pid) miss++;
        ((weeks[w] = weeks[w] || {})[t] = weeks[w][t] || []).push([pid || `y:${name}`, row.slot === 'Util' ? 'UTIL' : row.slot, row.days, row.s]);
        n++;
      }
    }
  }
  // Yahoo's day lines carry OPS and ERA only as rates, so two things need squaring with each team's real week
  // (yoenis/race.json): OBP is weighted by at-bats rather than plate appearances, so each team's OBP parts are scaled
  // to its real OPS; and an outing with no outs recorded has earned runs but no rate to read them from, so those runs
  // and baserunners go on one line of their own
  const race = tryRead('yoenis/race.json'), ix = race ? Object.fromEntries(race.cats.map((c, i) => [c.abbr, i])) : null;
  if (race) for (const rw of race.weeks) for (const mu of rw.matchups) for (const tk of mu.teams) {
    const t = keyOf[tk], rows = weeks[rw.week] && weeks[rw.week][t];
    if (!rows) continue;
    const real = mu.stats[tk], sum = (k) => rows.reduce((a, r) => a + ((r[3] || {})[k] || 0), 0);
    const ab = sum('ab'), tb = sum('tb'), ob = sum('obpab'), ops = real[ix.OPS];
    if (ab && ob && ops != null) { const f = (ops - tb / ab) / (ob / ab); if (f > 0.8 && f < 1.3) for (const r of rows) if (r[3] && r[3].obpab) r[3].obpab = Math.round(r[3].obpab * f * 1000) / 1000; }
    const outs = sum('outs'), er = sum('er'), bbh = sum('bbh'), era = real[ix.ERA], whip = real[ix.WHIP];
    if (outs && era != null && whip != null) {
      const xer = Math.round(era * outs / 27 - er), xbbh = Math.round(whip * outs / 3 - bbh);
      if (xer >= 1 || xbbh >= 1) rows.push(['y:Outings with no outs recorded', 'RP', 0, { outs: 0, er: Math.max(0, xer), bbh: Math.max(0, xbbh) }]);
    }
  }
  writeFileSync(new URL('yoenis/box-2026.json', root), JSON.stringify({ season: 2026, source: 'Yahoo', complete: !!yb.complete, weeks }));
  L.imported.boxUrl = '/yoenis/box-2026.json';
  console.log(`box scores: ${Object.keys(weeks).length} weeks, ${n} player-weeks (${miss} not in the player pool)${yb.complete ? '' : ', still filling in'}`);
  // each day on its own, a file a week (yoenis/days-2026/<week>.json), so a matchup can go back to any day:
  // { start, end, days: [{ date, teams: { team: [[player id, slot, stats]] } }] }, only starters who played
  const yd = tryRead('tools/yahoo_yoenis/box/days2026.json');
  if (yd && yb.weeks) {
    mkdirSync(new URL('yoenis/days-2026/', root), { recursive: true });
    let files = 0;
    for (const [w, span] of Object.entries(yb.weeks)) {
      const days = [];
      for (let t = Date.parse(span.start + 'T12:00:00Z'); t <= Date.parse(span.end + 'T12:00:00Z'); t += 864e5) {
        const ds = new Date(t).toISOString().slice(0, 10), day = yd[ds], teamsOut = {};
        if (day) for (const [tk, lst] of Object.entries(day.lu || {})) {
          const tm = keyOf[tk];
          if (tm == null || tm < 0) continue;
          for (const [pk, name, slot] of lst) {
            const sl = (day.st || {})[pk];
            if (!sl) continue;
            const pid = byKey[pk] || findId(name || (yb.names || {})[pk] || '', null, null);
            (teamsOut[tm] = teamsOut[tm] || []).push([pid || `y:${name}`, slot === 'Util' ? 'UTIL' : slot, sl[1]]);
          }
        }
        days.push({ date: ds, teams: day ? teamsOut : null });
      }
      writeFileSync(new URL(`yoenis/days-2026/${w}.json`, root), JSON.stringify({ week: +w, start: span.start, end: span.end, days }));
      files++;
    }
    L.imported.dayUrl = '/yoenis/days-2026/{w}.json';
    console.log(`day box scores: ${files} weeks`);
  }
}

L.extraPlayers = [...extra.values()];
D.extraPlayers = L.extraPlayers;
const me = teams.findIndex((t) => t.name === "Ippei's Book Club");
writeFileSync(new URL('tools/yoenis_draftlab.json', root), JSON.stringify({ id: 'yoenis', name: data.league, sport: 'mlb', draft: D, league: L, seasons, me }));

// a check run on the result: every player's cost matches the Yoenis page
const players = pool.players.map((p) => ({ ...p })).concat(L.extraPlayers.map((x) => ({ l: {}, rank: 9999, ...x })));
V.evaluate(sport, players, { teams: 16, lineup, bench, scoring: 'yoenis' });
let n = 0, bad = [];
for (const [team, rows] of Object.entries(data.keepers2027)) for (const e of rows) {
  const t = teams.findIndex((x) => x.name === team);
  const pid = L.rosters[t].find((id) => { const x = players.find((p) => p.id === id); return x && (x.n === e.p || norm(x.n) === norm(e.p)); }) || idOf(e.p, null, null), c = Z.keeperCost(L, pid); n++;
  if (!L.rosters[t].includes(pid)) bad.push(`${team}: ${e.p} isn't on the roster`);
  const want = e.next ? e.next[0] : null;
  if ((c.round ?? null) !== want) bad.push(`${team}: ${e.p} page ${want} draft lab ${c.round ?? c.no}`);
}
console.log(`${teams.length} teams, ${picks.length} picks, ${L.rosters.flat().length} rostered, ${extra.size} players added to the pool, ${seasons.length} past seasons`);
console.log(`keeper costs checked: ${n}, mismatched: ${bad.length}`, bad.slice(0, 15));
console.log(`your team: ${teams[me].name} (${me})`);
console.log(`rules: ${L.settings.weeks} weeks + ${L.settings.playoffWeeks} playoff weeks, ${L.settings.playoffTeams} teams, deadline after week ${L.settings.deadline}`);
console.log(`results: ${Object.keys(L.results).length} weeks; playoff games matched to Yahoo: ${poMiss.length ? 'NO\n  ' + poMiss.join('\n  ') : 'all'}; final places ${placesOk ? 'match' : 'differ'} (${[fin.champion, fin.runnerUp, fin.third].map((t) => t != null ? teams[t].name : '?').join(', ')})`);
console.log(`moves: ${L.tx.length - 1} (${L.trades.length} trades); FAAB and waiver order ${mgr ? 'from the managers page' : 'not set (no YOENIS_MANAGERS file)'}`);
const stand = G.standings(L);
console.log('regular season:', stand.slice(0, 8).map((r) => `${r.rank}. ${teams[r.team].name} ${r.w}-${r.l}-${r.t} GB ${r.gb} ${r.streak || ''}`).join(' | '));
// every rostered player is the right one: same MLB team as Yahoo has him, or a player the league carries itself
const wrong = [];
for (const [k, list] of Object.entries(Y.rosters)) for (const y of list) {
  const id = idOf(y.name, y.pos, y.mlb), p = pool.players.find((x) => x.id === id);
  if (p && y.mlb && p.t !== y.mlb && norm(p.n) === norm(y.name) && (byName.get(norm(y.name)) || []).length > 1) wrong.push(`${y.name} (${y.mlb}) matched ${p.n} (${p.t})`);
}
console.log(`name collisions settled: ${wrong.length ? wrong.join('; ') : 'all by team'}`);
