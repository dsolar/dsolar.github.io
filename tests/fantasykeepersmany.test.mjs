import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js'), V = require('../fantasy-kit/value.js'), F = require('../fantasy-kit/draft.js'), G = require('../fantasy-kit/league.js'), Z = require('../fantasy-kit/season.js');

test('a limited dynasty: twelve keepers at no cost fill each team\'s last twelve picks, and the rest is drafted', () => {
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.nfl), data), players = data.players.map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams: 8, scoring: 'half' });
  const T0 = Date.UTC(2026, 8, 1), D = F.create({ sport, teams: 8, seed: 2, now: T0, scoring: 'half', botDelay: 0 });
  D.season = { format: 'h2h', weeks: 4, playoffTeams: 2, keepers: 12, keeperCost: 'free' }; F.start(D, T0);
  let t = T0; const c = F.context(D, players, sport); for (let i = 0; i < 20000 && D.phase === 'live'; i++) { t += 3000; F.tick(D, c, t); }
  const L = Z.begin(D, sport, { now: t }), ctx = G.context(L, players, sport);
  Z.catchUp(L, ctx, L.start + 9 * 7 * 864e5);
  const D2 = Z.nextDraft(L, ctx, sport, {}, { now: L.start + 10 * 7 * 864e5, seed: 1 });
  const n = 8, by = {};
  D2.board.forEach((e, i) => { if (e && e.keeper) (by[e.team] = by[e.team] || []).push(Math.floor(i / n) + 1); });
  assert.equal(Object.keys(by).length, 8);
  for (const rs of Object.values(by)) assert.deepEqual(rs.sort((a, b) => a - b), Array.from({ length: 12 }, (_, k) => D2.rounds - 11 + k));
});
