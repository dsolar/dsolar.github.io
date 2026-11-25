// Draft grades and the recap (fantasy-kit/draft.js standings, recap): grades are earned against the league and the
// waiver wire, not handed out on a curve; the recap's steals and reaches are slides of half a round or more.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js');
const V = require('../fantasy-kit/value.js');
const F = require('../fantasy-kit/draft.js');
const T0 = Date.UTC(2026, 10, 2, 20, 0, 0);

function setup(key, opts = {}) {
  const data = JSON.parse(readFileSync(new URL(`../fantasy-kit/data/${key}.json`, import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S[key]), data);
  const have = new Set(data.players.flatMap((p) => p.pos));
  const lineup = (opts.lineup || sport.lineup).filter((s) => sport.slots[s] === '*' || sport.slots[s].some((x) => have.has(x)));
  const players = data.players.map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams: opts.teams || 10, lineup, scoring: opts.scoring, budget: opts.budget });
  const D = F.create({ sport, teams: opts.teams || 10, type: opts.type || 'snake', seed: 7, now: T0, lineup, clock: 30, botDelay: 1000, keepers: opts.keepers, teamsList: null, ...(opts.create || {}) });
  if (opts.human != null) D.teams[opts.human].owner = 'David';
  const ctx = F.context(D, players, sport);
  return { sport, players, D, ctx, lineup };
}
function run(s, step = 2000, limit = 3000) {
  let now = T0; F.start(s.D, now);
  for (let i = 0; i < limit && s.D.phase === 'live'; i++) { now += step; F.tick(s.D, s.ctx, now); }
  return now;
}
for (const [key, scoring] of [['nba', 'cats9'], ['nfl', 'half'], ['mlb', 'roto5']]) {
  test(`${key}: grades come from the gap, with a reason, and the recap skips tiny slides`, () => {
    const s = setup(key, { scoring });
    run(s);
    const ctx = F.context(s.D, s.players, s.sport);
    const st = F.standings(s.D, ctx).sort((a, b) => a.rank - b.rank), R = F.recap(s.D, ctx);
    const order = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D'];
    for (let i = 1; i < st.length; i++) assert.ok(order.indexOf(st[i].grade) >= order.indexOf(st[i - 1].grade), 'a better finish never gets a worse grade');
    assert.ok(st.every((r) => typeof r.edge === 'number'));
    assert.ok(Math.abs(st.reduce((t, r) => t + r.edge, 0)) < 1, 'edges are against the league average');
    const near = Math.max(3, Math.ceil(s.D.teams.length / 2));
    for (const x of R.steals.concat(R.reaches)) assert.ok(Math.abs(x.at - x.rank) >= near, `${x.at} vs ${x.rank}`);
    console.log(key, st.map((r) => `${r.grade}${r.edge > 0 ? '+' : ''}${r.edge}${r.strong ? ' S:' + r.strong : ''}${r.thin ? ' T:' + r.thin : ''}`).join(' | '));
  });
}
