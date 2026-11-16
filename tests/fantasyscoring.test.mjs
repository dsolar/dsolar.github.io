import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js');
const V = require('../fantasy-kit/value.js');
const R = require('../fantasy-kit/rules.js');

const load = (key) => JSON.parse(readFileSync(new URL(`../fantasy-kit/data/${key}.json`, import.meta.url), 'utf8'));
const scored = (key, spec, scoring) => {
  const data = load(key), sport = S.withScoring(S.attach(Object.assign({}, S[key]), data), spec);
  const players = data.players.map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams: 12, scoring: spec ? 'custom' : scoring });
  return { sport, players, by: Object.fromEntries(players.map((p) => [p.id, p])) };
};

test('scoring v2: a position multiplier scales the whole score, after the extras', () => {
  const spec = { type: 'points', base: 'half', posMult: { TE: 1.5 }, pos: { TE: { rec: 0.5 } } };
  const sc = S.withScoring(S.attach(Object.assign({}, S.nfl), load('nfl')), spec).scorings.custom;
  assert.deepEqual(sc.posMult, { TE: 1.5 });
  assert.match(sc.label, /TE premium \+0\.5, TE premium 1\.5x/);
  // 10 half-PPR points and 4 catches: (10 + 2) x 1.5 for a tight end, 10 for a receiver
  const st = { pts_half_ppr: 10, rec: 4 }, at = (k) => st[k] || 0;
  assert.equal(S.pointsOf(sc, { pos: ['TE'] }, at), 18);
  assert.equal(S.pointsOf(sc, { pos: ['WR'] }, at), 10);
  // a multiplier of 1 (or junk) is dropped
  const sc2 = S.withScoring(S.nfl, { type: 'points', base: 'half', posMult: { TE: 1, WR: 'x' } }).scorings.custom;
  assert.equal(sc2.posMult, null);
});

test('scoring v2: season values follow the multiplier, so tight ends climb', () => {
  const base = scored('nfl', null, 'half'), mult = scored('nfl', { type: 'points', base: 'half', posMult: { TE: 1.5 } });
  const te = mult.players.filter((p) => p.pos[0] === 'TE').sort((a, b) => b.fpts - a.fpts)[0];
  assert.ok(Math.abs(te.fpts - base.by[te.id].fpts * 1.5) < 0.01, 'a tight end scores 1.5x');
  const wr = mult.players.filter((p) => p.pos[0] === 'WR').sort((a, b) => b.fpts - a.fpts)[0];
  assert.ok(Math.abs(wr.fpts - base.by[wr.id].fpts) < 0.01, 'a receiver is unchanged');
  assert.ok(te.rank < base.by[te.id].rank, 'the top tight end moves up the overall ranks');
});

test('scoring v2: position rules work in basketball and baseball; game bonuses are football only', () => {
  const spec = { type: 'points', base: 'points', pos: { C: { reb: 0.5 } }, posMult: { PG: 1.1 }, bonus: [{ stat: 'pts', at: 40, pts: 5 }] };
  const sc = S.withScoring(S.nba, spec).scorings.custom;
  assert.equal(sc.bonus, null, 'a basketball week sums many games, so no game bonuses');
  const st = { pts: 20, reb: 10 }, at = (k) => st[k] || 0;
  // points weights: 20 + 12 = 32; a center adds 5 for his boards; a point guard scores 1.1x
  assert.equal(Math.round(S.pointsOf(sc, { pos: ['C'] }, at) * 100) / 100, 37);
  assert.equal(Math.round(S.pointsOf(sc, { pos: ['PG'] }, at) * 100) / 100, 35.2);
  const mlb = S.withScoring(S.mlb, { type: 'points', weights: { 'bat.hr': 4, 'pit.k': 1 }, posMult: { RP: 2 } }).scorings.custom;
  assert.equal(S.pointsOf(mlb, { pos: ['RP'] }, (k) => ({ 'pit.k': 3 })[k] || 0), 6);
});

test('scoring v2: bonus rows stack into tiers, and any football stat can carry one', () => {
  const spec = { type: 'points', base: 'ppr', bonus: [{ stat: 'rush_yd', at: 100, pts: 3 }, { stat: 'rush_yd', at: 200, pts: 5 }, { stat: 'rec', at: 10, pts: 2 }] };
  const sc = S.withScoring(S.nfl, spec).scorings.custom;
  assert.match(sc.label, /game bonuses$/);
  const p = { pos: ['RB'] };
  assert.equal(S.extraPts(sc, p, (k) => ({ rush_yd: 150 })[k] || 0), 3);
  assert.equal(S.extraPts(sc, p, (k) => ({ rush_yd: 210, rec: 11 })[k] || 0), 10);
  const lines = S.bonusLines(sc, 'nfl');
  assert.ok(lines.includes('200-yard rushing game: +5'));
  assert.ok(lines.includes('10+ receptions in a game: +2'));
  // projected: a back who catches 6 a game sometimes reaches 10
  const pr = S.extraPts({ bonus: [{ stat: 'rec', at: 10, pts: 2 }] }, p, (k) => ({ rec: 102 })[k] || 0, 17);
  assert.ok(pr > 0.5 && pr < 8, `expected bonus over a season: ${pr}`);
});

test('rules: raid twists go one at a time, and stay out of dynasty', () => {
  const ok = R.check({ sport: 'nfl', kind: 'redraft', season: 'h2h', type: 'snake', robinOn: 1 });
  assert.equal(ok.errors.length, 0);
  const two = R.check({ sport: 'nfl', kind: 'redraft', season: 'h2h', type: 'snake', robinOn: 1, conqOn: 1 });
  assert.ok(two.errors.some((e) => e.ids.includes('robinOn') && e.ids.includes('conqOn')));
  const vamp = R.check({ sport: 'nfl', kind: 'redraft', season: 'h2h', type: 'snake', vampOn: 1, conqOn: 1 });
  assert.ok(vamp.errors.length, 'the vampire already raids');
  const dyn = R.check({ sport: 'nfl', kind: 'dynasty', season: 'h2h', type: 'snake', conqOn: 1 });
  assert.ok(dyn.errors.some((e) => e.ids.includes('conqOn')));
  const keep = R.check({ sport: 'nfl', kind: 'keeper', season: 'h2h', type: 'snake', robinOn: 1 });
  assert.equal(keep.errors.length, 0);
  assert.ok(keep.warnings.length, 'a keeper league is warned');
  // turning one on switches the clashing ones off
  const f = { sport: 'nfl', kind: 'redraft', season: 'h2h', type: 'snake', robinOn: 1 };
  const off = R.turnOn(f, 'conqOn');
  assert.deepEqual(off, ['robinOn']);
  assert.equal(f.robinOn, 0); assert.equal(f.conqOn, 1);
});

test('rules: the hangover with kingslayer warns but is allowed; the registry lists every twist once', () => {
  const r = R.check({ sport: 'nfl', kind: 'redraft', season: 'h2h', type: 'snake', crownOn: 1, hangOn: 1, waivers: 'faab' });
  assert.equal(r.errors.length, 0);
  assert.ok(r.warnings.some((w) => w.ids.includes('crownOn') && w.ids.includes('hangOn')));
  const ids = R.OPTIONS.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const o of R.OPTIONS) assert.ok(o.label && o.group, `${o.id} has a label and group`);
});

test('rules: a league built with clashing twists keeps only the first raid', () => {
  const s = { robin: { protect: 2 }, conquest: { protect: 3 }, crown: { step: 10 } };
  const dropped = R.cleanSettings(s, { kind: 'redraft' });
  assert.ok(s.robin && !s.conquest && s.crown);
  assert.deepEqual(dropped, ['conquest']);
  const d2 = { robin: { protect: 2 } }; R.cleanSettings(d2, { kind: 'dynasty' });
  assert.ok(!d2.robin, 'no raids in dynasty');
});

test('scoring editor: rows become the spec sports.js reads, and back to the same points', () => {
  const SX = require('../fantasy-kit/scoring-ui.js');
  const sx = SX.empty();
  SX.QUICK.nfl.find((q) => q[0] === 'tep')[2](sx);
  SX.QUICK.nfl.find((q) => q[0] === 'tier')[2](sx);
  sx.mult.TE = 1.5; sx.mult.QB = 1;
  const ex = SX.toSpec(sx, 'nfl', { '*': { pass_td: 2 } });
  assert.deepEqual(ex.pos, { '*': { pass_td: 2 }, TE: { rec: 0.5 } });
  assert.deepEqual(ex.posMult, { TE: 1.5 });
  assert.equal(ex.bonus.length, 2);
  assert.equal(SX.count(sx), 4);
  assert.equal(SX.summary(sx, 'nfl'), 'TE +0.5, TE 1.5x, 2 game bonuses');
  // basketball drops the bonus rows; nothing set is null
  assert.equal(SX.toSpec({ pos: [], mult: {}, bonus: [['pts', 40, 5]] }, 'nba'), null);
  assert.equal(SX.toSpec(SX.empty(), 'mlb'), null);
  // the old form's toggles carry over
  const old = SX.fromLegacy({ tepOn: 1, tepAmt: 0.75, b300pOn: 1 });
  assert.deepEqual(old.pos, [['TE', 'rec', 0.75]]);
  assert.deepEqual(old.bonus, [['pass_yd', 300, 3]]);
  const sc = S.withScoring(S.nfl, Object.assign({ type: 'points', base: 'half' }, ex)).scorings.custom;
  assert.equal(S.pointsOf(sc, { pos: ['TE'] }, (k) => ({ pts_half_ppr: 10, rec: 4 })[k] || 0), 18);
});
