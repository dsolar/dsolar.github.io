// A league is saved as one document, capped at 1.5 MB by the server (fk_save). A full season of a big league, with
// every team saving a lineup every day, has to stay well under it.
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
const WEEK = 7 * 864e5, CAP = 1500000;

function season(key, n, s, bench) {
  const data = JSON.parse(readFileSync(new URL(`../fantasy-kit/data/${key}.json`, import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S[key]), data);
  const have = new Set(data.players.flatMap((p) => p.pos));
  const lineup = sport.lineup.filter((x) => sport.slots[x] === '*' || sport.slots[x].some((y) => have.has(y)));
  const players = data.players.map((p) => ({ ...p }));
  const scoring = Object.keys(sport.scorings).find((k) => sport.scorings[k].type === 'points') || Object.keys(sport.scorings)[0];
  V.evaluate(sport, players, { teams: n, lineup, scoring, bench });
  const T0 = Date.UTC(2026, 3, 1), D = F.create({ sport, type: 'snake', teams: n, seed: 7, now: T0, lineup, scoring, bench, botDelay: 0 });
  D.season = s;
  let t = T0; F.start(D, t); const dc = F.context(D, players, sport);
  for (let i = 0; i < 100000 && D.phase === 'live'; i++) { t += 3000; F.tick(D, dc, t); }
  const L = Z.begin(D, sport, { now: t });
  Z.catchUp(L, G.context(L, players, sport), L.start + (G.totalWeeks(L) + 1) * WEEK + 1);
  // the worst case for a daily league: every team saved a lineup for every day
  L.dayLineups = {};
  for (let w = 1; w <= G.totalWeeks(L); w++) { L.dayLineups[w] = {}; for (const tm of L.teams) { L.dayLineups[w][tm.id] = {}; for (let d = 0; d < 7; d++) L.dayLineups[w][tm.id][d] = (L.lineups[w] && L.lineups[w][tm.id] || []).slice(); } }
  return Buffer.byteLength(JSON.stringify(L)) + Buffer.byteLength(JSON.stringify(D));
}

test('a full 12-team baseball season with daily lineups stays well under the save cap', () => {
  const b = season('mlb', 12, { format: 'h2h', weeks: 22, playoffTeams: 6 }, 8);
  assert.ok(b < CAP * 0.6, `${Math.round(b / 1024)} KB`);
});

test('a full 14-team football season stays well under the save cap', () => {
  const b = season('nfl', 14, { format: 'h2h', weeks: 14, playoffTeams: 6 }, 7);
  assert.ok(b < CAP * 0.4, `${Math.round(b / 1024)} KB`);
});
