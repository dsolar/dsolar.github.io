// NHL hub data checks: node --test tests/nhl_hub.test.mjs
// Reads nhl/data/hub.json (built by tools/nhl_hub_build.py) and checks the odds and ratings hang together.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const H = JSON.parse(readFileSync(new URL('../nhl/data/hub.json', import.meta.url), 'utf8'));
const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('32 teams in two conferences of 16 and four divisions of 8', () => {
  assert.equal(H.teams.length, 32);
  for (const c of ['E', 'W']) assert.equal(H.teams.filter(t => t.conf === c).length, 16);
  const divs = {};
  H.teams.forEach(t => { divs[t.div] = (divs[t.div] || 0) + 1; });
  assert.deepEqual(Object.values(divs).sort(), [8, 8, 8, 8]);
});

test('odds add up: 16 playoff teams, 4 division winners, 8 in round two, 1 champion', () => {
  near(sum(H.teams, t => t.odds.po), 16, 0.02, 'playoff spots');
  near(sum(H.teams, t => t.odds.div), 4, 0.01, 'division titles');
  near(sum(H.teams, t => t.odds.r2), 8, 0.01, 'second round');
  near(sum(H.teams, t => t.odds.cf), 4, 0.01, 'conference finals');
  near(sum(H.teams, t => t.odds.final), 2, 0.01, 'Cup final');
  near(sum(H.teams, t => t.odds.cup), 1, 0.01, 'Cup');
  near(sum(H.teams, t => t.odds.pres), 1, 0.01, "Presidents' Trophy");
  for (const t of H.teams) assert.ok(t.odds.cup <= t.odds.final && t.odds.final <= t.odds.cf && t.odds.cf <= t.odds.r2 && t.odds.r2 <= t.odds.po, t.abbr);
});

test('strength is centered and in a sane range', () => {
  near(sum(H.teams, t => t.rating) / 32, 0, 0.01, 'mean strength');
  for (const t of H.teams) assert.ok(Math.abs(t.rating) < 1.5, `${t.abbr} ${t.rating}`);
});

test('projected points: never below the points banked, and about two a game plus overtime points', () => {
  for (const t of H.teams) assert.ok(t.projPts >= t.rec.points - 0.01, t.abbr);
  const games = sum(H.teams, t => t.rec.gamesPlayed + t.left) / 2;
  const pts = sum(H.teams, t => t.projPts);
  // every game is worth 2 points, 3 when it goes past regulation (about a quarter of games)
  assert.ok(pts > games * 2.15 && pts < games * 2.35, `${pts} points over ${games} games`);
});

test('every team has its lines, pairs and goalies, with no player used twice', () => {
  const ids = new Set(H.players.map(p => p.id));
  for (const t of H.teams) {
    assert.ok(t.lines.length >= 3, `${t.abbr} lines`);
    assert.ok(t.pairs.length >= 2, `${t.abbr} pairs`);
    assert.ok(t.goalies.length >= 1, `${t.abbr} goalies`);
    const used = [...t.lines, ...t.pairs].flatMap(l => l.ids);
    assert.equal(new Set(used).size, used.length, `${t.abbr} repeats a player`);
    used.forEach(i => assert.ok(ids.has(i), `${t.abbr} line player ${i} not on the roster`));
    near(sum(t.goalies, g => g[1]), 1, 0.01, `${t.abbr} goalie shares`);
  }
});

test('ratings: stars near the top, replacement below average, tiers by rank', () => {
  const sk = H.players.filter(p => p.grp !== 'G');
  assert.ok(sk.length > 600);
  assert.ok(H.repl.F < 0 && H.repl.D < 0 && H.repl.G < 0);
  const top = sk.slice().sort((a, b) => b.war - a.war).slice(0, 25).map(p => p.name);
  assert.ok(top.includes('Connor McDavid'), 'McDavid in the top 25');
  for (const g of ['F', 'D', 'G']) {
    const ps = H.players.filter(p => p.grp === g).sort((a, b) => a.rank - b.rank);
    ps.forEach((p, i) => assert.equal(p.rank, i + 1));
    for (let i = 1; i < ps.length; i++) assert.ok(ps[i].war <= ps[i - 1].war);
  }
});
