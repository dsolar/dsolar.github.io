// A one-day or one-week mock that plays out live (fantasy/demo/?play=mock): the mock draft's slate draft becomes a
// one-week league with no playoffs, head to head or everyone vs everyone, scored from the slate's games.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js'), V = require('../fantasy-kit/value.js'), F = require('../fantasy-kit/draft.js'), G = require('../fantasy-kit/league.js'), Z = require('../fantasy-kit/season.js'), SL = require('../fantasy-kit/slates.js');

function nightMock(k, tally, n) {
  const data = JSON.parse(readFileSync(new URL(`../fantasy-kit/data/${k}.json`, import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S[k]), data);
  const teams = [...new Set(data.players.map((p) => p.t))].filter((t) => t && t !== 'FA').slice(0, k === 'nfl' ? 16 : 8);
  const now = Date.parse('2026-11-17T15:00:00Z'), first = now + 4 * 36e5, games = [];
  for (let i = 0; i < teams.length; i += 2) games.push({ id: 'g' + i, at: new Date(first + i * 36e5).toISOString(), away: teams[i], home: teams[i + 1] });
  const slate = { kind: 'full', label: 'Tonight', games, teams, first, last: first + teams.length * 36e5, ...(S.daily(k) ? { day: '2026-11-17' } : { week: 11 }) };
  const lu = SL.lineup(games.length, n, k);
  const players = data.players.filter((p) => teams.includes(p.t)).map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams: n, lineup: lu.lineup, bench: lu.bench, scoring: Object.keys(sport.scorings)[0], week: S.weekFor({ season: { slate } }, sport), oneDay: !!S.dayOf({ season: { slate } }) });
  const D = F.create({ sport, teams: n, seed: 3, now, lineup: lu.lineup, bench: lu.bench, botDelay: 0 });
  D.season = { format: 'h2h', tally, weeks: 1, playoffTeams: 0, waiverDays: 0, oneWeek: true, slate };
  F.start(D, now); let t = now; const c0 = F.context(D, players, sport);
  for (let i = 0; i < 5000 && D.phase === 'live'; i++) { t += 2000; F.tick(D, c0, t); }
  const weeks = { season: String(data.season), cols: (data.lines.tot || data.lines.pg).cols, weeks: {} };
  const L = Z.begin(JSON.parse(JSON.stringify(D)), sport, { now: t, real: weeks });
  return { D, L, sport, players, weeks, t };
}

for (const [k, tally, n] of [['nba', 'game', 2], ['nba', 'allplay', 5], ['cbb', 'game', 4], ['nfl', 'game', 6]]) {
  test(`${k}, ${tally === 'allplay' ? 'everyone vs everyone' : 'head to head'}, ${n} teams: one week, no playoffs, the slate's games`, () => {
    const { D, L, sport, players, weeks, t } = nightMock(k, tally, n);
    assert.equal(D.phase, 'done');
    assert.equal(G.totalWeeks(L), 1, 'just the one week');
    assert.equal(L.settings.tally, tally);
    const ctx = G.context(L, players, sport, { real: weeks });
    if (tally === 'game') assert.equal(G.matchups(L, ctx, 1, 0).length, n / 2);
    if (S.daily(k)) assert.ok((Z.slateGames(L) || []).length >= 1, 'a night scores its own games');
    assert.equal(G.canFinish(L, ctx, t), false, 'not final before the games');
  });
}
