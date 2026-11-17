// Random mixes of formats and twists, each played from the draft to the end of the season: nothing throws, and the
// league ends whole (every team in the standings, a champion, no player on two rosters, rosters within their size).
// FK_COMBOS=300 node --test tests/fantasycombos.test.mjs runs more; FK_COMBO_SEED picks the mixes.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js');
const V = require('../fantasy-kit/value.js');
const F = require('../fantasy-kit/draft.js');
const G = require('../fantasy-kit/league.js');
const Z = require('../fantasy-kit/season.js');
const WEEK = 7 * 864e5;
const N = Number(process.env.FK_COMBOS) || 24, SEED = Number(process.env.FK_COMBO_SEED) || 20261117;

const DATA = {};
const load = (key) => (DATA[key] = DATA[key] || JSON.parse(readFileSync(new URL(`../fantasy-kit/data/${key}.json`, import.meta.url), 'utf8')));

function mix(r) {
  const pick = (xs) => xs[Math.floor(r() * xs.length)], yes = (p) => r() < p;
  const sport = pick(['nfl', 'nfl', 'nfl', 'nba', 'mlb']);
  const n = 4 + Math.floor(r() * 9), weeks = 4 + Math.floor(r() * 5);
  const format = pick(['h2h', 'h2h', 'h2h', 'guillotine', ...(sport !== 'nfl' ? ['roto'] : [])]);
  const s = { format, weeks, playoffTeams: format === 'h2h' && yes(0.7) ? pick([2, 4, 6].filter((x) => x <= n)) : 0 };
  if (format === 'h2h') {
    if (yes(0.2)) s.tally = 'allplay';
    if (yes(0.25)) s.median = true;
    if (yes(0.25) && n >= 4) s.divisions = 2;
    if (yes(0.2)) s.split = { after: 2 + Math.floor(r() * Math.max(1, weeks - 3)) };
    if (yes(0.2)) s.ladder = { reach: 1 + Math.floor(r() * 3) };
    if (yes(0.2) && n % 2 === 0) s.pyo = true;
    const raid = pick([null, null, 'robin', 'conquest']);
    if (raid === 'robin') s.robin = { protect: 2 };
    if (raid === 'conquest') s.conquest = { protect: 3 };
    if (yes(0.25)) s.crown = { start: 10, step: 10, keep: 5 };
    if (yes(0.25)) s.hangover = true;
    if (yes(0.2)) s.bestBall = true;
  }
  if (format === 'guillotine' && yes(0.5)) s.topBonus = 25;
  if (format !== 'roto' && yes(0.35)) s.deal = { max: pick([0, 1, 2]) };
  const type = pick(['snake', 'snake', 'linear', '3rr', 'auction', 'elephant']);
  // a second season for some: keepers or dynasty carried over
  if (format !== 'guillotine' && yes(0.35)) { if (yes(0.5)) s.keepers = 1 + Math.floor(r() * 3); else if (format === 'h2h' && !s.robin && !s.conquest) s.dynasty = { rounds: 2 }; }
  return { sport, n, type, season: s };
}

function play({ sport: key, n, type, season }, seed) {
  const data = load(key), sport = S.attach(Object.assign({}, S[key]), data);
  const have = new Set(data.players.flatMap((p) => p.pos));
  const lineup = sport.lineup.filter((s) => sport.slots[s] === '*' || sport.slots[s].some((x) => have.has(x)));
  const players = data.players.map((p) => ({ ...p }));
  const sc = season.format === 'roto' ? (Object.keys(sport.scorings).find((k) => sport.scorings[k].type !== 'points') || Object.keys(sport.scorings)[0])
    : Object.keys(sport.scorings).find((k) => sport.scorings[k].type === 'points') || Object.keys(sport.scorings)[0];
  V.evaluate(sport, players, { teams: n, lineup, scoring: sc, bench: 5 });
  const T0 = Date.UTC(2026, 8, 1);
  const D = F.create({ sport, type, teams: n, seed, now: T0, lineup, scoring: sc, bench: 5, clock: 30, botDelay: 0 });
  D.season = JSON.parse(JSON.stringify(season));
  let t = T0; F.start(D, t);
  const dctx = F.context(D, players, sport);
  for (let i = 0; i < 200000 && D.phase === 'live'; i++) { t += 3000; F.tick(D, dctx, t); }
  assert.equal(D.phase, 'done', 'the draft finishes');
  const L = Z.begin(D, sport, { now: t }), ctx = G.context(L, players, sport);
  // bots only: give one team an owner so the human paths (offers, challenges) are on the table too
  L.teams[0].owner = 'Me';
  for (let w = 1; w <= G.totalWeeks(L) + 1; w++) Z.catchUp(L, ctx, L.start + w * WEEK + 1);
  return { L, ctx, sport, players, again: !!(season.keepers || season.dynasty) };
}
// next season: the keeper or rookie draft, then two weeks of play
function second({ L, ctx, sport, players }, seed) {
  const D2 = Z.nextDraft(L, ctx, sport, {}, { now: L.start + 60 * WEEK, seed });
  assert.ok(D2 && Array.isArray(D2.teams), 'a next draft');
  let t = L.start + 60 * WEEK; F.start(D2, t);
  const dctx = F.context(D2, players, sport);
  for (let i = 0; i < 200000 && D2.phase === 'live'; i++) { t += 3000; F.tick(D2, dctx, t); }
  assert.equal(D2.phase, 'done', 'the next draft finishes');
  const L2 = Z.begin(D2, sport, { now: t, prev: L }), c2 = G.context(L2, players, sport);
  Z.catchUp(L2, c2, L2.start + 2 * WEEK + 1);
  const seen = new Set();
  for (const ids of L2.rosters) for (const id of ids) { assert.ok(!seen.has(id), `season 2: player ${id} on two rosters`); seen.add(id); }
  if (L.settings.keepers) for (const tm of L.teams) assert.ok(L2.rosters[tm.id].length >= 1);
}

function check({ L }) {
  assert.ok(L.week > G.totalWeeks(L), `season over (week ${L.week} of ${G.totalWeeks(L)})`);
  const st = G.standings(L);
  assert.equal(new Set(st.map((r) => r.team)).size, L.teams.length, 'every team in the standings once');
  const champ = G.finish(L).champion;
  assert.ok(champ != null && L.teams[champ], 'a champion');
  const seen = new Map();
  L.rosters.forEach((ids, t) => ids.forEach((id) => { assert.ok(!seen.has(id), `player ${id} on teams ${seen.get(id)} and ${t}`); seen.set(id, t); }));
  const cap = L.settings.lineup.length + L.settings.bench;
  L.rosters.forEach((ids, t) => assert.ok(ids.length <= cap + 1, `team ${t} roster ${ids.length} over ${cap}`));
  if (L.ladder) assert.deepEqual(L.ladder.order.slice().sort((a, b) => a - b), L.teams.map((x) => x.id), 'the ladder holds every team once');
  for (let w = 1; w <= L.settings.weeks; w++) if (!['roto', 'guillotine'].includes(L.settings.format)) assert.ok(Array.isArray(L.results[w]), `week ${w} has results`);
  assert.ok(Buffer.byteLength(JSON.stringify(L)) < 1200000, 'the league fits under the save cap');
}

test(`${N} random mixes of formats and twists play a whole season`, () => {
  const r = F.rng(SEED), fails = [];
  let seconds = 0;
  for (let i = 0; i < N; i++) {
    const m = mix(r), seed = SEED + i;
    try { const g = play(m, seed); check(g); if (g.again) { second(g, seed + 0.5); seconds++; } } catch (e) { fails.push(`#${i} ${JSON.stringify(m)}: ${e.message.split('\n')[0]}`); }
  }
  assert.deepEqual(fails, [], fails.join('\n'));
  if (N >= 20) assert.ok(seconds > 0, 'some mixes played a second season');
  console.log(`# ${N} mixes, ${seconds} with a second season`);
});
