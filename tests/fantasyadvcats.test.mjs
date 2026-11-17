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
const DAY = 864e5, WEEK = 7 * DAY;

// A drafted league from the start-a-league path: D.season and D.scoringSpec in, Z.begin out.
function league(key, season, spec, opts = {}) {
  const data = JSON.parse(readFileSync(new URL(`../fantasy-kit/data/${key}.json`, import.meta.url), 'utf8'));
  const sport = S.withScoring(S.attach(Object.assign({}, S[key]), data), spec);
  const have = new Set(data.players.flatMap((p) => p.pos));
  const lineup = sport.lineup.filter((s) => sport.slots[s] === '*' || sport.slots[s].some((x) => have.has(x)));
  const players = data.players.map((p) => ({ ...p }));
  const scoring = spec ? 'custom' : opts.scoring || Object.keys(sport.scorings)[0];
  const n = opts.teams || 6;
  V.evaluate(sport, players, { teams: n, lineup, scoring });
  const T0 = Date.UTC(2026, 9, 1);
  const D = F.create({ sport, teams: n, seed: opts.seed || 4, now: T0, lineup, scoring, botDelay: 0 });
  D.season = season; if (spec) D.scoringSpec = spec;
  F.start(D, T0); F.tick(D, F.context(D, players, sport), T0 + 1, 5000);
  const L = Z.begin(D, sport, { now: T0 + 1 });
  return { sport, players, L, ctx: G.context(L, players, sport), D };
}
const play = (s, weeks) => Z.catchUp(s.L, s.ctx, s.L.start + weeks * WEEK + 1);

// Advanced categories: formulas over box-score columns that add up across players and weeks like FG% does.
test('advanced categories: the pick list knows them, and leaves out what the data can\'t make', () => {
  const nba = S.catCatalog(S.ALL.nba).map((c) => c.k);
  for (const k of ['ts', 'efg', 'ato', 'stocks', 'pra']) assert.ok(nba.includes(k), k);
  // with data attached, a category needing a column the file lacks is left out of the list...
  const fake = S.attach(Object.assign({}, S.mlb), { lines: { bat: { cols: ['g', 'pa', 'ab', 'h', 'tb'] }, pit: { cols: ['ip', 'k', 'bb'] } }, players: [] });
  const ks = S.catCatalog(fake).map((c) => c.k);
  assert.ok(ks.includes('slg') && ks.includes('iso') && ks.includes('k9') && ks.includes('kbb'));
  assert.ok(!ks.includes('woba') && !ks.includes('fip'), 'wOBA and FIP need columns this file lacks');
  // ...but a league that picked one keeps it
  assert.deepEqual(S.customScoring(fake, { type: 'cats', cats: ['woba', 'k9'] }).cats.map((c) => c.k), ['woba', 'k9']);
});

test('formula stats: weighted sums, ratios, multipliers and constants', () => {
  const sp = S.attach(Object.assign({}, S.mlb), { lines: { pit: { cols: ['ip', 'k', 'bb', 'hr', 'hbp'] } }, players: [] });
  const p = { l: { pit: [180, 200, 50, 20, 5] } };
  assert.equal(S.stat(sp, p, 'pit', { k: 1, bb: -1 }), 150);
  assert.equal(S.stat(sp, p, 'pit', { k: 1, nope: 1 }), null, 'a missing column makes the sum unknown');
  const cat = (k) => S.EXTRA_CATS.mlb.find((c) => c.k === k);
  const r = (c) => S.ratioVal(c, S.stat(sp, p, 'pit', c.num), S.stat(sp, p, 'pit', c.den));
  assert.ok(Math.abs(r(cat('k9')) - 10) < 1e-9, 'K/9');
  assert.ok(Math.abs(r(cat('fip')) - ((13 * 20 + 3 * (50 + 5) - 2 * 200) / 180 + 3.1)) < 1e-9, 'FIP');
  assert.equal(S.lineVal([1, 2, 3], { a: 0, c: 2 }, { a: 2, c: 1, b: 5 }), 5, 'a raw line: a missing column counts 0');
});

test('a custom category league scores TS%, A/TO and STL+BLK from real weeks', () => {
  const s = league('nba', { format: 'h2h', weeks: 3, playoffTeams: 0 }, { type: 'cats', cats: ['ts', 'ato', 'stocks', 'pts'] });
  const sc = G.scoring(s.L, s.ctx);
  assert.deepEqual(sc.cats.map((c) => c.k), ['ts', 'ato', 'stocks', 'pts']);
  // values: no NaN, the advanced ones counted in the rankings
  assert.ok(s.players.every((p) => Number.isFinite(p.v)));
  const top = s.players.slice().sort((a, b) => b.v - a.v)[0];
  assert.ok(top.v > 0);
  // a team's week: TS% is all its points over all its true shot attempts
  const x = G.teamWeek(s.L, s.ctx, 0, 1, 1);
  const [n, d] = x.parts.ts;
  assert.ok(d > 0 && Math.abs(x.cats.ts - n / d) < 1e-9);
  assert.ok(x.cats.ts > 0.4 && x.cats.ts < 0.8, `a believable TS% (${x.cats.ts.toFixed(3)})`);
  Z.catchUp(s.L, s.ctx, s.L.start + 3 * WEEK + 1);
  const g = s.L.results[1][0];
  assert.equal(g.sa + g.sb + g.ties, 4, 'four categories decided the game');
});

test('rotisserie with K/9 and ISO: season totals from the parts, scaled', () => {
  const s = league('mlb', { format: 'roto', weeks: 3 }, { type: 'cats', cats: ['iso', 'k9', 'svh', 'hr'] });
  Z.catchUp(s.L, s.ctx, s.L.start + 2 * WEEK + 1);
  const st = G.standings(s.L), n = s.L.teams.length;
  assert.equal(st.reduce((a, r) => a + r.pts, 0), 4 * (n * (n + 1)) / 2, 'every category hands out 1 to n');
  const t = st[0].team, parts = [1, 2].map((w) => s.L.results[w].roto[t].parts.k9);
  const want = 9 * (parts[0][0] + parts[1][0]) / (parts[0][1] + parts[1][1]);
  assert.ok(Math.abs(st[0].vals.k9 - want) < 1e-9, 'season K/9 is nine times all strikeouts over all innings');
  assert.ok(st[0].vals.k9 > 4 && st[0].vals.k9 < 16, `a believable K/9 (${st[0].vals.k9.toFixed(2)})`);
});
