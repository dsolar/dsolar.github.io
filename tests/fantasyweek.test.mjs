// One week and one game: players valued on the week's projection (data lines "wk<N>", value.js league.week), the
// week a slate or a showdown plays (sports.js weekFor), and football's calibrated week-to-week swing (league.js).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js'), V = require('../fantasy-kit/value.js'), F = require('../fantasy-kit/draft.js'), G = require('../fantasy-kit/league.js'), Z = require('../fantasy-kit/season.js'), SL = require('../fantasy-kit/slates.js');
const fx = JSON.parse(readFileSync(new URL('./fixtures/nfl-slates.json', import.meta.url), 'utf8'));
const base = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
const now = Date.parse('2026-11-05T13:00Z');
const W = fx.weeks[0].week;

// the data file with a made-up projection for week W: each player's own per-game line, one player flipped high
function data() {
  const d = structuredClone(base), cols = d.lines.tot.cols;
  for (const k of Object.keys(d.lines)) if (d.lines[k].week != null) delete d.lines[k];
  d.lines['wk' + W] = { label: `Week ${W} projection`, cols, proj: true, week: W, start: fx.weeks[0].start, end: fx.weeks[0].end };
  for (const p of d.players) {
    for (const k of Object.keys(p.l)) if (/^wk\d+$/.test(k)) delete p.l[k];
    const t = p.l.tot, g = t && t[0];
    if (g) p.l['wk' + W] = [1].concat(t.slice(1).map((x) => Math.round((x / g) * 100) / 100));
  }
  return d;
}
const half = (d, p) => p.l['wk' + W][d.lines.tot.cols.indexOf('pts_half_ppr')];

test('a one-week game values each player on his projection for that week, and says so (sport.weekOf)', () => {
  const d = data(), sl = SL.pick(fx.weeks[0], 'full', null, now);
  const sport = S.attach(Object.assign({}, S.nfl), d);
  const players = structuredClone(d.players.filter((p) => sl.teams.includes(p.t)));
  // a backup projected big this week (named the starter), and a star ruled out
  const backup = players.find((p) => p.pos[0] === 'QB' && half(d, p) < 6 && half(d, p) > 0.5);
  backup.l['wk' + W] = backup.l['wk' + W].map((x, i) => (i ? x * 25 / half(d, backup) : 1));
  const star = players.filter((p) => p.pos[0] === 'WR').sort((a, b) => half(d, b) - half(d, a))[0];
  star.inj = 'Out';
  const lu = SL.lineup(sl.games.length, 8);
  V.evaluate(sport, players, { teams: 8, lineup: lu.lineup, bench: lu.bench, scoring: 'half', week: S.weekFor({ season: { slate: sl } }, sport) });
  assert.equal(sport.weekOf, W);
  for (const p of players.filter((x) => x.l['wk' + W] && !x.inj)) assert.ok(Math.abs(p.v / 17 - p.wk[W]) < 1e-6, p.n);
  assert.ok(Math.abs(backup.v / 17 - 25) < 0.01, 'the new starter is valued on this week');
  assert.ok(backup.rank < 40, `the new starter ranks high (${backup.rank})`);
  assert.equal(star.v, 0, 'a player who is out is worth nothing this week');
  assert.equal(sport.market, null, 'no season-long market ranks');
  // the same pool for a season: season values, and no week
  const again = structuredClone(d.players.filter((p) => sl.teams.includes(p.t)));
  V.evaluate(sport, again, { teams: 8, lineup: lu.lineup, bench: lu.bench, scoring: 'half' });
  assert.equal(sport.weekOf, undefined);
  assert.ok(again.find((p) => p.id === backup.id).wk[W] < 6, 'p.wk is there in a season league too');
});

test('custom scoring scores the week line stat by stat', () => {
  const d = data(), sport = S.withScoring(S.attach(Object.assign({}, S.nfl), d), { type: 'points', weights: { rec: 2, rec_yd: 0.1, rec_td: 6, rush_yd: 0.1, rush_td: 6, pass_yd: 0.04, pass_td: 4, pass_int: -2 } });
  const players = d.players.map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams: 10, lineup: S.nfl.lineup, bench: 6, scoring: 'custom', week: W });
  const wr = players.filter((p) => p.pos[0] === 'WR' && p.l['wk' + W]).sort((a, b) => b.v - a.v)[0];
  const cols = d.lines.tot.cols, l = wr.l['wk' + W], at = (c) => l[cols.indexOf(c)] || 0;
  const want = Object.entries(sport.scorings.custom.weights).reduce((a, [k, w]) => a + at(k) * w, 0);
  assert.equal(sport.scorings.custom.weights.rec, 2);
  assert.ok(Math.abs(wr.wk[W] - want) < 0.02, `${wr.wk[W]} vs ${want}`);
});

test('weekFor: a slate keeps its week; an older showdown finds it from kickoff, a Monday night game on Monday', () => {
  const d = data(), sport = S.attach(Object.assign({}, S.nfl), d);
  assert.equal(S.weekFor({ settings: { slate: { week: W } } }, sport), W);
  assert.equal(S.weekFor({ season: { showdown: { week: W } } }, sport), W);
  const mon = Date.parse(fx.weeks[0].end + 'T00:15:00Z') + 864e5;   // 8:15 PM Monday in New York is Tuesday in UTC
  assert.equal(S.weekFor({ settings: { showdown: { at: mon } } }, sport), W);
  assert.equal(S.weekFor({ settings: { showdown: { at: mon + 7 * 864e5 } } }, sport), null, 'no projection for that week');
  assert.equal(S.weekFor({ settings: {} }, sport), null);
});

test('a showdown: the captain and the flex come from that week, and the odds use football\'s real swing', () => {
  const d = data(), sport = S.attach(Object.assign({}, S.nfl), d), g = fx.weeks[0].games[0];
  const players = d.players.filter((p) => p.t === g.away || p.t === g.home).map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams: 2, lineup: S.SHOWDOWN.lineup, bench: 0, scoring: 'half', budget: 50, week: W });
  const D = F.create({ sport, teams: 2, seed: 9, now, lineup: S.SHOWDOWN.lineup.slice(), bench: 0, scoring: 'half', botDelay: 0 });
  D.season = { format: 'h2h', tally: 'game', weeks: 1, oneWeek: true, playoffTeams: 0, showdown: { id: g.id, teams: [g.away, g.home], at: Date.parse(g.at), week: W, label: `${g.away} @ ${g.home}` } };
  F.start(D, now); let t = now; const ctx = F.context(D, players, sport);
  for (let i = 0; i < 2000 && D.phase === 'live'; i++) { t += 3000; F.tick(D, ctx, t); }
  assert.notEqual(D.phase, 'live');
  const top = players.slice().sort((a, b) => b.v - a.v).slice(0, 2).map((p) => p.id), picked = Object.values(F.rosters(D)).flat();
  assert.ok(top.every((id) => picked.includes(id)), 'the two best this week go in the draft');
  const L = Z.begin(D, sport, { now: t });
  assert.equal(S.weekFor(L, sport), W);
  const c2 = G.context(L, players, sport);
  const [m] = G.matchups(L, c2, 1, 0);
  assert.ok(m.winProb > 0.02 && m.winProb < 0.98, `odds ${m.winProb}`);
  const pa = G.projection(L, c2, m.a, 1);
  assert.ok(pa.var > 0 && Math.sqrt(pa.var) < pa.total, 'a team\'s week swings, but by less than its projection');
});
