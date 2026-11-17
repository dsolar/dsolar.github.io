// College hoops season leagues: real Monday-Sunday weeks from every Division I box score (tools/fantasykit_cbb.mjs),
// a pool kept to chosen conferences, and a season that stops before, after or through March's tournaments.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { firstMonday, weekOf, eventState, addLines, tidy } from '../tools/fantasykit_cbb.mjs';
const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js'), V = require('../fantasy-kit/value.js'), F = require('../fantasy-kit/draft.js'), G = require('../fantasy-kit/league.js'), Z = require('../fantasy-kit/season.js');
const pool = JSON.parse(readFileSync(new URL('../fantasy-kit/data/cbb.json', import.meta.url), 'utf8'));

test('the weekly file: weeks from the Monday on or before Nov 2, finals only, pool players summed', () => {
  assert.equal(firstMonday('2026-27'), '2026-11-02');
  assert.equal(firstMonday('2027-28'), '2027-11-01');
  assert.equal(weekOf('2026-11-02', '2026-11-02'), 1); assert.equal(weekOf('2026-11-08', '2026-11-02'), 1); assert.equal(weekOf('2026-11-17', '2026-11-02'), 3);
  assert.equal(eventState({ status: { type: { state: 'post', completed: true } } }), 'final');
  assert.equal(eventState({ status: { type: { state: 'in' } } }), 'open');
  assert.equal(eventState({ status: { type: { name: 'STATUS_POSTPONED', description: 'Postponed' } } }), 'off');
  const acc = addLines({}, { a: [1, 1, 30.4, 5], b: [1, 1, 10, 1] }, new Set(['a']));
  addLines(acc, { a: [1, 1, 20.3, 2] });
  assert.deepEqual(tidy(acc), { a: [2, 2, 51, 7] });
});

test('college March: the season ends before the conference tournaments, on Selection Sunday, or after the title game', () => {
  const t = new Date(2026, 10, 17).getTime();
  const day = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  assert.equal(day(S.collegeEnd('reg', t)), '2027-3-7');
  assert.equal(day(S.collegeEnd('conf', t)), '2027-3-14');
  assert.equal(day(S.collegeEnd('ncaa', t)), '2027-4-11', 'the Sunday after the Monday title game');
  assert.equal(day(S.collegeEnd('conf', new Date(2026, 1, 1).getTime())), '2026-3-15');
});

test('college hoops is a season sport with points and categories', () => {
  assert.ok(S.SEASON_SPORTS.includes(S.cbb));
  assert.deepEqual(Object.keys(S.cbb.scorings), ['dk', 'points', 'cats9']);
  assert.ok(!S.CAT_PRESETS.cbb.some((x) => x.cats.includes('pm')), 'no plus/minus in college box scores');
  assert.ok(!S.EXTRA_CATS.cbb.some((c) => c.k === 'pm'));
  const sport = S.attach(Object.assign({}, S.cbb), pool);
  const cats = S.customScoring(sport, { type: 'points', weights: { pts: 1 } });
  assert.equal(cats.line, 'pg'); assert.equal(cats.per, 'game');
});

test('a season league kept to the SEC: only SEC players are drafted or added, and real weeks score it', () => {
  const sec = Object.entries(pool.teams).filter(([, t]) => t.conf === 'SEC').map(([k]) => k);
  assert.ok(sec.length >= 14);
  const sport = S.attach(Object.assign({}, S.cbb), pool);
  const players = pool.players.filter((p) => sec.includes(p.t)).map((p) => ({ ...p, l: { ...p.l } }));
  const lineup = S.cbb.lineup.slice(), bench = 2, teams = 4, now = Date.UTC(2026, 10, 20);
  V.evaluate(sport, players, { teams, lineup, bench, scoring: 'points' });
  const D = F.create({ sport, teams, seed: 4, now, lineup, bench, scoring: 'points', botDelay: 0 });
  D.season = { format: 'h2h', weeks: 3, playoffTeams: 0, ir: 0, pool: sec, confs: ['SEC'], collegeEnd: 'conf' };
  assert.ok(S.inPool(D, players[0]));
  const duke = pool.players.find((p) => p.t === 'DUKE');
  assert.ok(!S.inPool(D, duke), 'an ACC player is out of the pool');
  F.start(D, now); let t = now; const c0 = F.context(D, players, sport);
  for (let i = 0; i < 8000 && D.phase === 'live'; i++) { t += 2000; F.tick(D, c0, t); }
  assert.equal(D.phase, 'done');
  // a weekly file with the league's first week filled in: every SEC player scored the same line
  const start = new Date(Z.startAfter(t, 'cbb')).toISOString().slice(0, 10);
  const line = [2, 2, 60, 12, 24, 5, 6, 3, 32, 14, 6, 2, 1, 4, 3, 11, 4, 8, 0, 1, 0];
  const real = { sport: 'cbb', season: pool.season, line: 'pg', cols: pool.lines.pg.cols,
    weeks: { 3: { start, end: start, final: true, lines: Object.fromEntries(players.map((p) => [p.id, line])) } } };
  const L = Z.begin(D, sport, { now: t, real });
  assert.deepEqual(L.settings.pool, sec); assert.deepEqual(L.settings.confs, ['SEC']); assert.equal(L.settings.collegeEnd, 'conf');
  assert.ok(!S.inPool(L, duke), 'still out of the pool once the season starts');
  const ctx = G.context(L, players, sport, { real });
  const tw = G.teamWeek(L, ctx, 0, 1);
  const want = 32 * 1 + 14 * 1.2 + 6 * 1.5 + 2 * 3 + 1 * 3 - 4 * 1 + 3 * 0.5;
  const id = Object.keys(tw.players)[0];
  assert.ok(Math.abs(tw.players[id] - want) < 1e-6, `points from the week's two games: ${tw.players[id]} vs ${want}`);
});
