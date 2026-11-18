import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js');
const V = require('../fantasy-kit/value.js');
const F = require('../fantasy-kit/draft.js');
const E = require('../fantasy-kit/experience.js');
const N = require('../fantasy-kit/nav.js');
const SX = require('../fantasy-kit/scoring-ui.js');

test('sport landing category presets carry the exact category set into a usable scoring spec', () => {
  for (const [sport, sets] of Object.entries(S.CAT_PRESETS)) for (const set of sets) {
    const form = { sport };
    E.applyQuery(form, new URLSearchParams({ catset: set.k }), S);
    assert.equal(form.scoring, 'cc');
    assert.deepEqual(form.cats, set.cats);
    const sp = S.withScoring(S[sport], { type: 'cats', cats: form.cats });
    assert.deepEqual(sp.scorings.custom.cats.map(c => c.k), set.cats);
    form.cats.pop();
    assert.ok(set.cats.length > form.cats.length, 'the shared preset is not mutated');
  }
});

test('custom templates retain scoring, auction, roster and twist options without identity or access data', () => {
  const form = { sport: 'nfl', teams: 12, type: 'auction', aBudget: 260, scoring: 'cp', kind: 'keeper', lineup: 'QB RB WR TE FLEX', bench: 8,
    weights: { pass_yd: 0.04, pass_td: 6, pass_int: -3 }, posMax: { QB: 3 }, keepN: 4,
    sx: { pos: [['TE', 'rec', 0.5]], mult: { TE: 1.2 }, bonus: [['pass_yd', 300, 3]] },
    crownOn: 1, crownStep: 20, robinOn: 1, robinP: 2, waiverPrice: 'second', minBid: 1, slKind: 'custom', slGames: ['game1', 'game2'],
    name: 'Private league', me: 'Manager', team: 'Team name', email: 'private@example.com', invite: 'secret', token: 'secret', dtAt: 12345 };
  const encoded = E.encode(form), rules = E.decode(encoded, S);
  assert.equal(rules.aBudget, 260);
  assert.deepEqual(rules.weights, form.weights);
  assert.deepEqual(rules.sx, form.sx);
  assert.equal(rules.crownStep, 20);
  assert.equal(rules.waiverPrice, 'second');
  assert.deepEqual(rules.slGames, ['game1', 'game2']);
  assert.ok(!/private|secret|Manager|dtAt/.test(encoded));
  rules.weights.pass_td = 4;
  assert.equal(form.weights.pass_td, 6, 'templates own their rule data');
});

test('invalid templates fail clearly and nested prototype keys never enter imported rules', () => {
  for (const text of ['not json', '{"v":2,"rules":{"sport":"nba"}}', '{"v":1,"rules":{"sport":"unknown"}}', '{"v":1,"rules":{"sport":"nba","teams":0}}', '{"v":1,"rules":{"sport":"nba","lineup":"QB"}}', '{"v":1,"rules":{"sport":"nfl","type":"unknown"}}']) assert.throws(() => E.decode(text, S));
  const r = E.decode('{"v":1,"rules":{"sport":"nfl","posMax":{"__proto__":{"polluted":true},"QB":3},"__proto__":{"polluted":true}}}', S);
  assert.deepEqual(r.posMax, { QB: 3 });
  assert.equal({}.polluted, undefined);
  assert.throws(() => E.decode('x'.repeat(20001), S), /large/);
});

test('demo and draft handoff preserve custom points, premiums, auction budgets and league rules', () => {
  const D = F.create({ sport: S.nfl, teams: 10, type: 'auction', budget: 260, bidClock: 30, now: 1 });
  D.scoringSpec = { type: 'points', base: 'ppr', pos: { TE: { rec: 0.5 } }, posMult: { TE: 1.2 }, bonus: [{ stat: 'rush_yd', at: 100, pts: 3 }] };
  D.season = { format: 'h2h', tally: 'game', dynasty: { rounds: 4, picks: false }, taxi: 3, weeks: 12, rookie: 4 };
  const r = E.decode(E.encode(E.fromDraft(D, { waiverDays: 1, waiverHours: 48, robin: { protect: 2 }, reviewHours: 24 })), S);
  assert.equal(r.scoring, 'ppr');
  assert.equal(r.aBudget, 260); assert.equal(r.clock, 30);
  assert.equal(r.kind, 'dynasty'); assert.equal(r.rookie, 4); assert.equal(r.fpicks, 0); assert.equal(r.taxi, 3);
  assert.equal(r.waiverDays, 1);
  assert.deepEqual(SX.toSpec(r.sx, 'nfl'), { pos: { TE: { rec: 0.5 } }, posMult: { TE: 1.2 }, bonus: [{ stat: 'rush_yd', at: 100, pts: 3 }] });
});

test('sport context is explicit while saved mocks remain independently resumable', () => {
  const saved = { D: { sport: 'nba', phase: 'setup' } };
  assert.ok(E.mockConflict('nfl', saved));
  assert.ok(!E.mockConflict('nba', saved));
  assert.ok(!E.mockConflict(null, saved));
  for (const sport of Object.keys(S.ALL)) {
    assert.equal(N.href('draft', { sport }), `/fantasy/mock/?s=${sport}#draft`);
    assert.equal(N.href('rankings', { sport }), `/fantasy/rankings/?s=${sport}`);
    assert.equal(N.href('week', { sport }), `/fantasy/quick/?s=${sport}`);
  }
});

test('landing rankings use the same default and custom league sizes and budgets as the draft', () => {
  const base = E.rankingConfig(S, 'nba');
  assert.equal(base.teams, 10); assert.equal(base.budget, 200);
  const custom = E.rankingConfig(S, 'nba', { sport: 'nba', teams: 14, budget: 260, scoring: 'points', lineup: 'PG SG C UTIL', bench: 2 });
  assert.deepEqual(custom, { teams: 14, budget: 260, scoring: 'points', lineup: ['PG', 'SG', 'C', 'UTIL'], bench: 2 });
  assert.deepEqual(E.rankingConfig(S, 'nba', { sport: 'nfl', teams: 16, scoring: 'ppr' }), base);
});

test('draft guidance uses legal available players and does not change the draft or queue', () => {
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nba.json', import.meta.url)));
  const sp = S.attach({ ...S.nba }, data), players = data.players.map(p => ({ ...p }));
  V.evaluate(sp, players, { teams: 10, scoring: 'cats9' });
  const D = F.create({ sport: sp, teams: 10, scoring: 'cats9', seed: 4, now: 100, clock: 30 });
  D.teams[0].queue = [players.at(-1).id];
  const ctx = F.context(D, players, sp), before = JSON.stringify(D), a = E.draftAdvice(F, D, ctx, 0);
  assert.ok(a.best && a.fit);
  for (const p of [a.best, a.fit, a.later].filter(Boolean)) { assert.ok(F.canAdd(D, ctx, 0, p).ok); assert.equal(ctx.own[p.id], undefined); }
  assert.equal(JSON.stringify(D), before);
  D.type = 'pack'; assert.equal(E.draftAdvice(F, D, ctx, 0), null, 'no hidden pack information is suggested');
});

test('category targets invert for the opposing manager, skip settled categories and stop at final', () => {
  const scoring = { cats: [{ k: 'ft' }, { k: 'reb' }, { k: 'blk' }] };
  const g = { a: 0, b: 1, proj: { probs: { ft: 0.45, reb: 0.97, blk: 0.3 } } };
  assert.equal(E.targets(g, 0, scoring)[0].probability, 0.45);
  assert.equal(E.targets(g, 1, scoring)[0].probability, 0.55);
  assert.ok(E.targets(g, 0, scoring).every(t => t.category.k !== 'reb'));
  g.final = true; assert.deepEqual(E.targets(g, 0, scoring), []);
});

test('pickup specialists need a meaningful current sample, including players with zero recorded games', () => {
  const sp = { cols: { pg: { gp: 0 } }, gMax: { pg: { col: 'gp', hi: 15 } } };
  for (const gp of [0, 1, 3, 5]) assert.ok(!E.reliableSample(S, sp, { l: { pg: [gp] } }));
  for (const gp of [6, 10, 15]) assert.ok(E.reliableSample(S, sp, { l: { pg: [gp] } }));
  assert.ok(E.reliableSample(S, { ...sp, gMax: { pg: { col: 'gp', hi: 3 } } }, { l: { pg: [1] } }), 'do not exclude the entire pool early in a season');
});
