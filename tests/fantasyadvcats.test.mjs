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

test('football category leagues: a custom set scores week by week, with per-game simulated weeks', () => {
  const spec = { type: 'cats', cats: ['pass_yd', 'pass_td', 'pass_int', 'rush_yd', 'rec', 'skill_td', 'ypc', 'catch', 'scrim'] };
  const s = league('nfl', { format: 'h2h', tally: 'cats', weeks: 3, playoffTeams: 0 }, spec);
  const sc = G.scoring(s.L, s.ctx);
  assert.equal(sc.type, 'cats');
  assert.deepEqual(sc.cats.map((c) => c.k), spec.cats);
  assert.ok(s.players.every((p) => Number.isFinite(p.v)));
  const x = G.teamWeek(s.L, s.ctx, 0, 1, 1);
  assert.ok(x.cats.pass_yd > 100 && x.cats.pass_yd < 500, `one quarterback's week of passing (${Math.round(x.cats.pass_yd)})`);
  assert.ok(x.cats.ypc > 2 && x.cats.ypc < 8, `a believable yards per carry (${x.cats.ypc.toFixed(2)})`);
  Z.catchUp(s.L, s.ctx, s.L.start + 3 * WEEK + 1);
  const g = s.L.results[1][0];
  assert.equal(g.sa + g.sb + g.ties, 9, 'nine categories decided the game');
});

test('every sport can pick categories and put a value on many more stats', () => {
  for (const k of ['nba', 'nfl', 'mlb', 'nhl']) {
    const all = S.catCatalog(S.ALL[k]);
    assert.ok(all.length >= 25, `${k}: ${all.length} categories`);
    assert.ok(all.filter((c) => c.adv).length >= 5, `${k}: advanced ones`);
    assert.equal(new Set(all.map((c) => c.k)).size, all.length, `${k}: no repeated keys`);
    assert.ok(S.POINT_STATS[k].length >= 18, `${k}: ${S.POINT_STATS[k].length} stats to value`);
  }
});

// EPA and the rest of nflverse's columns: formulas over them, kept when the live feed (which lacks them) lands.
test('football EPA categories: formulas over the nflverse columns', () => {
  const all = S.catCatalog(S.ALL.nfl, { all: true }), get = (k) => all.find((c) => c.k === k);
  const cols = ['g', 'pass_yd', 'pass_td', 'pass_int', 'pass_att', 'rush_att', 'rec', 'rec_tgt', 'rec_yd', 'epa_pass', 'epa_rush', 'epa_rec', 'pass_sacked', 'sack_yd', 'cpoe_x', 'tm_tgt', 'air_rec', 'yac_rec', 'tm_air'];
  const cm = Object.fromEntries(cols.map((c, i) => [c, i]));
  const at = { g: 1, pass_yd: 300, pass_td: 2, pass_int: 1, pass_att: 38, rush_att: 2, epa_pass: 12, epa_rush: 1, pass_sacked: 2, sack_yd: 15, cpoe_x: 1.9 };
  const row = cols.map((c) => at[c] || 0);
  const val = (k) => { const c = get(k); return c.col ? S.lineVal(row, cm, c.col) : S.ratioVal(c, S.lineVal(row, cm, c.num), S.lineVal(row, cm, c.den)); };
  assert.equal(val('epa'), 13);
  assert.equal(val('epa_db'), 12 / 40, 'per dropback: sacks count as dropbacks');
  assert.equal(val('cpoe'), 5, 'completions over expected per 100 attempts');
  assert.equal(val('anya'), (300 + 40 - 45 - 15) / 40);
  assert.equal(val('sack_pct'), 2 / 40);
  // the pick list only offers them once the columns are in the data
  const fake = S.attach(Object.assign({}, S.nfl), { lines: { tot: { cols } }, players: [] });
  assert.ok(S.catCatalog(fake).some((c) => c.k === 'cpoe'));
  const bare = S.attach(Object.assign({}, S.nfl), { lines: { tot: { cols: ['g', 'pass_yd'] } }, players: [] });
  assert.ok(!S.catCatalog(bare).some((c) => c.k === 'epa'));
});

test('category presets: every category exists, and the live feed keeps columns it lacks', () => {
  for (const [sp, sets] of Object.entries(S.CAT_PRESETS)) {
    const ks = S.catCatalog(S.ALL[sp], { all: true }).map((c) => c.k);
    for (const p of sets) for (const k of p.cats) assert.ok(ks.includes(k), `${sp} ${p.k} ${k}`);
  }
  const weeks = { season: '2026', cols: ['g', 'pass_yd', 'epa_pass'], weeks: { 10: { start: '2026-11-10', final: false, lines: { a: [1, 200, 9.5] } } } };
  Z.mergeLive(weeks, { season: '2026', start: '2026-11-10', updated: 't1', players: { a: [1, 250], b: [1, 80] } });
  assert.deepEqual(weeks.weeks[10].lines.a, [1, 250, 9.5], 'EPA from the file stays');
  assert.deepEqual(weeks.weeks[10].lines.b, [1, 80]);
  Z.mergeLive(weeks, { season: '2026', start: '2026-11-10', updated: 't2', players: { a: [1, 260] } });
  assert.deepEqual(weeks.weeks[10].lines.a, [1, 260, 9.5]);
});
