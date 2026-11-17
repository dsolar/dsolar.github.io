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
const WEEK = 7 * 864e5, DAY = 864e5;

function league(n, season, owners = [0], seed = 3) {
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.nfl), data);
  const have = new Set(data.players.flatMap((p) => p.pos));
  const lineup = sport.lineup.filter((s) => sport.slots[s] === '*' || sport.slots[s].some((x) => have.has(x)));
  const players = data.players.map((p) => ({ ...p }));
  V.evaluate(sport, players, { teams: n, lineup, scoring: 'half' });
  const T0 = Date.UTC(2026, 8, 1);
  const D = F.create({ sport, type: 'snake', teams: n, seed, now: T0, lineup, scoring: 'half', botDelay: 0 });
  D.season = season;
  let t = T0; F.start(D, t);
  const dctx = F.context(D, players, sport);
  for (let i = 0; i < 40000 && D.phase === 'live'; i++) { t += 3000; F.tick(D, dctx, t); }
  const L = Z.begin(D, sport, { now: t });
  for (const o of owners) L.teams[o].owner = 'Me';
  return { L, ctx: G.context(L, players, sport) };
}

test('deal or no deal: an offer under the projection, new each morning, taken before the first game', () => {
  const { L, ctx } = league(6, { format: 'h2h', weeks: 4, playoffTeams: 2, deal: { max: 1 } });
  assert.deepEqual(L.settings.deal, { max: 1 });
  const ws = G.weekStart(L, 1), d0 = ws + 3600e3;
  G.runDeals(L, ctx, d0);
  const o = G.dealOffer(L, 0);
  assert.ok(o && o.offer > 0 && o.offer < o.base && o.offer >= o.base * 0.85, `offer ${o && o.offer} of ${o && o.base}`);
  // the same morning, the same offer; the next morning, a new one
  G.runDeals(L, ctx, d0 + 3600e3); assert.equal(G.dealOffer(L, 0).at, o.at);
  G.runDeals(L, ctx, d0 + DAY); assert.equal(G.dealOffer(L, 0).day, 1);
  // bots decided on their own
  for (let t = 1; t < 6; t++) { const b = G.dealOffer(L, t); assert.ok(b.taken || b.passed, `bot ${t} decided`); }
  // too late after the first game
  assert.equal(G.dealTake(L, 0, G.dealDue(L, 1) + 1).ok, false);
  assert.ok(G.dealTake(L, 0, d0 + DAY + 60).ok);
  assert.equal(G.dealsLeft(L, 0), 0);
  const offer = G.dealOffer(L, 0).offer;
  Z.catchUp(L, ctx, L.start + 1 * WEEK + 1);
  const g = L.results[1].find((x) => x.a === 0 || x.b === 0);
  assert.equal(g.a === 0 ? g.sa : g.sb, offer, 'scored the offer');
  assert.ok(L.deals[1][0].actual != null, 'what he would have scored is kept');
  // out of deals: no more offers
  G.runDeals(L, ctx, G.weekStart(L, 2) + 3600e3);
  assert.equal(G.dealOffer(L, 0), null);
  assert.ok(L.tx.some((e) => e.type === 'deal' && e.team === 0));
});

test('deal or no deal: not in the playoffs, and a categories league gets no offers', () => {
  const { L, ctx } = league(4, { format: 'h2h', weeks: 2, playoffTeams: 2, deal: { max: 0 } });
  Z.catchUp(L, ctx, L.start + 2 * WEEK + 1);
  assert.equal(L.week, 3);
  G.runDeals(L, ctx, G.weekStart(L, 3) + 3600e3);
  assert.equal(G.dealOffer(L, 0), null, 'no deals in the playoffs');
  const roto = league(4, { format: 'roto', weeks: 3, deal: { max: 2 } }).L;
  assert.equal(roto.settings.deal, undefined);
});
