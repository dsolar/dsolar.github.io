// Builds Don't Forget to Wipe Yoenis as a Draft Lab league, as it stands after the 2026 season: the 16 teams, the
// 2026 draft, final rosters (injured list too), the final standings, every keeper's cost history, and the seasons
// back to 2013 as league history. Writes tools/yoenis_draftlab.json ({ name, draft, league, seasons, seats }), which
// the database loads (see the note at the end of tools/fantasykit_supabase.sql).
//
// Sources: tools/yahoo_yoenis/2026.json (Yahoo's draft, rosters and final ranks) and yoenis/data.json (team and
// manager names, past seasons, and data.keepers2027: each rostered player's keeper cost under the league's rules,
// which the Yoenis page shows). Run: node tools/yoenis_draftlab.mjs
import { readFileSync, writeFileSync } from 'node:fs';
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
const brand = { color: 2, letters: 'WY' };
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

// the season's over: Yahoo's final places stand in for games played here
const st = s26.standings.map(([rank, t, rec]) => { const [w, l, tt] = rec.split('-').map(Number); return { team: t, w, l, t: tt, rank }; }).sort((a, b) => a.rank - b.rank);
L.imported = { from: 'Yahoo', standings: st, final: { champion: st[0].team, runnerUp: st[1].team, third: st[2].team } };
L.week = G.totalWeeks(L) + 1;
L.tx = L.tx.filter((x) => x.type === 'draft');

// every season before this one, for the History page and the champion pennants
const seasons = data.seasons.filter((x) => +x.year < 2026).map((x, i) => {
  const rows = x.standings.map(([rank, t, rec]) => { const [w, l, tt] = rec.split('-').map(Number); return { team: t, name: x.teams[t], owner: (data.owners[x.o[t]] || {}).n || null, w, l, t: tt, rank }; }).sort((a, b) => a.rank - b.rank);
  const who = (r) => (r ? { team: r.team, name: r.name, owner: r.owner } : null);
  return { season: String(x.year), year: i + 1, sport: 'mlb', format: 'h2h', champion: who(rows[0]), runnerUp: who(rows[1]), third: who(rows[2]), playoffTeams: 6, standings: rows };
});

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
// every rostered player is the right one: same MLB team as Yahoo has him, or a player the league carries itself
const wrong = [];
for (const [k, list] of Object.entries(Y.rosters)) for (const y of list) {
  const id = idOf(y.name, y.pos, y.mlb), p = pool.players.find((x) => x.id === id);
  if (p && y.mlb && p.t !== y.mlb && norm(p.n) === norm(y.name) && (byName.get(norm(y.name)) || []).length > 1) wrong.push(`${y.name} (${y.mlb}) matched ${p.n} (${p.t})`);
}
console.log(`name collisions settled: ${wrong.length ? wrong.join('; ') : 'all by team'}`);
