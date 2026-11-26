// NHL quick games: one-night hockey slates build valid league rules, with hockey's lineups
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js'), SL = require('../fantasy-kit/slates.js');
const Q = require('../fantasy-kit/quick-games.js'), E = require('../fantasy-kit/experience.js');
const nba = JSON.parse(readFileSync(new URL('./fixtures/nba-slates.json', import.meta.url)));
const nhl = { ...structuredClone(nba), sport: 'nhl', weeks: structuredClone(nba.weeks).map(w => ({ ...w, sport: 'nhl' })) };
const now = Date.parse(nhl.weeks[0].start + 'T12:00:00Z');

test('hockey lineups: a captain showdown up to three games, then C, two W, two D, a goalie and two skater flex', () => {
  assert.deepEqual(SL.lineup(1, 4, 'nhl').mult, { CPT: 1.5 });
  assert.equal(SL.lineup(3, 4, 'nhl').bench, 1);
  assert.deepEqual(SL.lineup(6, 8, 'nhl').lineup, ['C', 'W', 'W', 'D', 'D', 'G', 'UTIL', 'UTIL']);
  assert.equal(SL.word('nhl'), 'drops the puck');
});

test('the builder hands a one-night NHL game to setup as valid rules', () => {
  for (const mode of Q.MODES.map(m => m.key)) {
    const st = { ...Q.initial('nhl'), mode, period: SL.periodKey(nhl.weeks[0]), teams: 6 };
    const v = Q.view(st, nhl, S, SL, null, now);
    assert.equal(v.sport, 'nhl'); assert.ok(v.slate, 'a slate');
    const r = E.decode(new URL(Q.setupHref(v, E, SL), 'https://davidsolar.dev').searchParams.get('rules'), S);
    assert.equal(r.sport, 'nhl'); assert.equal(r.scoring, 'points'); assert.equal(r.kind, 'week');
    assert.equal(r.lineup, v.lineup.lineup.join(' '));
  }
});
