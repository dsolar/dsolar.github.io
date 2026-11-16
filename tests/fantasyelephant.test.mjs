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
const T0 = Date.UTC(2026, 9, 1, 20, 0, 0);

function setup(key, opts = {}) {
  const data = JSON.parse(readFileSync(new URL(`../fantasy-kit/data/${key}.json`, import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S[key]), data);
  const have = new Set(data.players.flatMap((p) => p.pos));
  const lineup = sport.lineup.filter((s) => sport.slots[s] === '*' || sport.slots[s].some((x) => have.has(x)));
  const players = data.players.map((p) => ({ ...p }));
  const teams = opts.teams || 10, scoring = opts.scoring || Object.keys(sport.scorings)[0];
  V.evaluate(sport, players, { teams, lineup, scoring });
  const D = F.create({ sport, teams, type: 'elephant', seed: opts.seed || 7, now: T0, lineup, clock: 30, botDelay: 1000, scoring, steals: opts.steals });
  const ctx = F.context(D, players, sport);
  return { sport, players, D, ctx, lineup };
}
const run = (s, step = 2000, limit = 4000) => { let now = T0; F.start(s.D, now); for (let i = 0; i < limit && s.D.phase === 'live'; i++) { now += step; F.tick(s.D, s.ctx, now); } return now; };

test('white elephant tax: defaults, settings in range, and drafts from before the tax have no tags', () => {
  const s = setup('nfl');
  assert.equal(s.D.steals.tax, 0.8); assert.equal(s.D.steals.golden, 1.15);
  const t = setup('nfl', { steals: { tax: 0.75, golden: 1.2, perTeam: 2, freeze: 1 } });
  assert.deepEqual([t.D.steals.tax, t.D.steals.golden, t.D.steals.perTeam, t.D.steals.freeze], [0.75, 1.2, 2, 1]);
  const off = setup('nfl', { steals: { tax: 1, golden: 1 } });
  assert.deepEqual([off.D.steals.tax, off.D.steals.golden], [1, 1]);
  assert.equal(setup('nfl', { steals: { tax: 0.1, golden: 3 } }).D.steals.tax, 0.5, 'clamped');
  // an old draft: no tax or golden saved
  delete s.D.steals.tax; delete s.D.steals.golden;
  s.D.board[0] = { n: 1, team: 0, pid: 'x', steal: true };
  assert.deepEqual(F.tags(s.D), {});
});

test('white elephant tax: the thief\'s player is taxed, the robbed team\'s make-up pick is golden, and standings count both', () => {
  const s = setup('nfl');
  for (const t of s.D.teams) t.owner = 'M' + t.id;
  let now = T0; F.start(s.D, now);
  const go = () => { const c = F.onClock(s.D, now); F.pick(s.D, s.ctx, c.team, F.autoChoice(s.D, s.ctx, c.team).id, now); now += 1000; };
  for (let i = 0; i < 12; i++) go();        // into round 2: team 7 is up (10 teams, snake: picks 11-20 go 9..0)
  const c = F.onClock(s.D, now), star = s.D.board[0].pid, victim = s.D.board[0].team;
  const before = F.standings(s.D, s.ctx);
  assert.ok(F.steal(s.D, s.ctx, c.team, star, now).ok);
  const mk = F.onClock(s.D, now);
  assert.ok(mk.makeup && mk.team === victim);
  const gold = F.autoChoice(s.D, s.ctx, victim).id;
  F.pick(s.D, s.ctx, victim, gold, now + 1);
  const tg = F.tags(s.D);
  assert.deepEqual(tg[star], { mult: 0.8, kind: 'stolen' });
  assert.deepEqual(tg[gold], { mult: 1.15, kind: 'golden' });
  assert.equal(Object.keys(tg).length, 2);
  const after = F.standings(s.D, s.ctx), p = s.ctx.byId[star];
  const thief = after.find((r) => r.team === c.team);
  assert.ok(thief.starters.includes(p));
  const raw = thief.starters.reduce((a, x) => a + (x ? x.v || 0 : 0), 0);
  assert.ok(Math.abs(raw - thief.score - 0.2 * p.v) < 1e-6, 'the stolen star counts 80% for the thief');
  // stealing the golden pick makes him stolen, not both
  now += 5000;
  while (F.onClock(s.D, now).team === victim) go();
  const c2 = F.onClock(s.D, now);
  if (c2.team !== victim && F.canSteal(s.D, s.ctx, c2.team, gold, now).ok) {
    F.steal(s.D, s.ctx, c2.team, gold, now);
    assert.equal(F.tags(s.D)[gold].kind, 'stolen');
  }
  assert.ok(before.length === after.length);
});

test('white elephant tax: bots still steal, mostly after the first round, and the draft finishes legal', () => {
  let steals = 0, early = 0;
  for (const seed of [1, 2, 3, 4]) {
    const s = setup('nfl', { seed, scoring: 'half' });
    run(s);
    assert.equal(s.D.phase, 'done');
    const ros = F.rosters(s.D);
    assert.ok(ros.every((ids) => ids.length === F.sizeOf(s.D)));
    assert.equal(new Set(ros.flat()).size, ros.flat().length, 'nobody on two teams');
    s.D.board.forEach((x, i) => { if (x && x.steal) { steals++; if (F.slotInfo(s.D, i).round <= 1) early++; } });
    const tg = F.tags(s.D);
    for (const [pid, t] of Object.entries(tg)) assert.ok(ros.flat().includes(pid) && (t.mult === 0.8 || t.mult === 1.15));
  }
  assert.ok(steals >= 3, `${steals} bot steals`);
  assert.ok(early <= steals / 3, `${early} of ${steals} steals in round 1`);
});

test('white elephant tax: the season carries the tags, a trade keeps them, a drop clears them', () => {
  const s = setup('nfl', { seed: 3, scoring: 'half' });
  run(s);
  let tg = F.tags(s.D);
  if (!Object.keys(tg).length) {
    // make sure there's one of each to carry: tag the first two picks by hand
    s.D.board[0].steal = true; s.D.extra[1] = { from: 0, forbid: null, at: T0 }; tg = F.tags(s.D);
  }
  s.D.season = { format: 'h2h', weeks: 4, playoffTeams: 2 };
  const L = Z.begin(s.D, s.sport, { now: T0 + 1 });
  for (const [pid, t] of Object.entries(tg)) { assert.equal(L.pmult[pid], t.mult); assert.equal(L.etags[pid], t.kind); }
  const ctx = G.context(L, s.players, s.sport);
  const pid = Object.keys(tg)[0], team = L.rosters.findIndex((r) => r.includes(pid));
  // a commissioner move to another team keeps the tag; a drop to free agency clears it
  const other = (team + 1) % L.teams.length;
  assert.ok(G.commishMove(L, ctx, pid, other, T0 + 2).ok);
  assert.equal(L.pmult[pid], tg[pid].mult);
  assert.ok(G.commishMove(L, ctx, pid, null, T0 + 3).ok);
  assert.equal(L.pmult[pid], undefined); assert.equal(L.etags[pid], undefined);
});

test('white elephant tax: a category league skips the tags', () => {
  const s = setup('nba', { seed: 2, scoring: 'cats9' });
  run(s);
  s.D.board[0].steal = true;
  s.D.season = { format: 'h2h', weeks: 4, playoffTeams: 2 };
  const L = Z.begin(s.D, s.sport, { now: T0 + 1 });
  assert.ok(!L.etags);
});
