// Wipe Yoenis as a Draft Lab league (tools/yoenis_draftlab.mjs): the league's climbing keeper costs, the same-round
// rule, the deadline rule, and how keepers carry into the next season.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js');
const V = require('../fantasy-kit/value.js');
const G = require('../fantasy-kit/league.js');
const Z = require('../fantasy-kit/season.js');
const norm = (s) => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\(.*?\)/g, '').replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z]/g, '');
const read = (p) => JSON.parse(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));

function league() {
  const doc = read('tools/yoenis_draftlab.json'), data = read('yoenis/data.json'), pool = read('fantasy-kit/data/mlb.json');
  const L = doc.league, sport = S.attach(Object.assign({}, S.mlb), pool);
  const hide = new Set(L.hidePlayers || []);
  const players = pool.players.filter((p) => !hide.has(p.id)).map((p) => ({ ...p })).concat(L.extraPlayers.map((x) => ({ l: {}, rank: 9999, ...x })));
  V.evaluate(sport, players, { teams: 16, lineup: L.settings.lineup, bench: L.settings.bench, scoring: 'yoenis' });
  const ctx = G.context(L, players, sport, {});
  const name = (n) => players.find((p) => p.n === n);
  return { doc, data, L, sport, ctx, players, name, team: (n) => L.teams.findIndex((t) => t.name === n) };
}

test('yoenis: every rostered player costs what the Yoenis page says, or can\'t be kept for the same reason', () => {
  const { data, L, ctx, team } = league();
  let n = 0;
  for (const [tn, rows] of Object.entries(data.keepers2027)) {
    const t = team(tn), opts = Z.keeperOptions(L, ctx, t);
    for (const e of rows) {
      const o = opts.find((x) => x.n === e.p) || opts.find((x) => norm(x.n) === norm(e.p));
      assert.ok(o, `${tn}: ${e.p} is on the keeper list`);
      if (e.next) { assert.equal(o.cost.round, e.next[0], `${e.p} costs round ${e.next[0]}`); assert.equal(o.cost.year, e.next[1]); }
      else { assert.ok(o.no, `${e.p} can't be kept`); assert.equal(o.no, e.late ? 'late' : 'done'); }
      n++;
    }
  }
  assert.equal(n, 442);
});

test('yoenis: costs climb, never past round 1, and a third year is the last', () => {
  const { L, ctx, name } = league();
  const crochet = name('Garrett Crochet'), ramirez = name('José Ramírez'), elly = name('Elly De La Cruz');
  assert.match(Z.keeperCost(L, crochet.id).label, /Round 9, 3rd year kept/);     // 15, 13, then 9
  assert.equal(Z.keeperCost(L, ramirez.id).round, 1);                           // a 1st stays a 1st
  assert.match(Z.keeperCost(L, elly.id).label, /Kept 3 years/);
  // a player added after Sept 1 can't be kept
  const late = Object.entries(L.keepInfo).find(([, k]) => k.late);
  assert.match(Z.keeperCost(L, late[0]).label, /Added after Sep 1/);
  assert.ok(Z.keeperOptions(L, ctx, 0).every((o) => !o.no || o.surplus < 0), 'players who can\'t be kept sort last');
});

test('yoenis: a second keeper in a round moves up; two 1sts take two 1st-round picks', () => {
  const { L, team, name } = league();
  const me = team("Ippei's Book Club");
  // Olson (round 2) and Yamamoto (round 1 next year): no clash
  let p = Z.keeperPlan(L, me, [name('Matt Olson').id, name('Yoshinobu Yamamoto').id]);
  assert.ok(p.ok); assert.deepEqual(p.rows.map((x) => x.round).sort(), [1, 2]);
  // Bichette and Contreras both cost a 3rd: one moves up to the 2nd
  p = Z.keeperPlan(L, me, [name('Bo Bichette').id, name('William Contreras').id]);
  assert.ok(p.ok); assert.deepEqual(p.rows.map((x) => x.round).sort(), [2, 3]); assert.equal(p.rows.filter((x) => x.moved).length, 1);
  // ...and with Olson in the 2nd too, the next one climbs to the 1st
  p = Z.keeperPlan(L, me, [name('Bo Bichette').id, name('William Contreras').id, name('Matt Olson').id]);
  assert.ok(p.ok); assert.deepEqual(p.rows.map((x) => x.round).sort(), [1, 2, 3]);
  // José Ramírez and Yamamoto both cost a 1st, and the team has one 1st
  p = Z.keeperPlan(L, me, [name('José Ramírez').id, name('Yoshinobu Yamamoto').id]);
  assert.equal(p.ok, false); assert.match(p.why, /two 1st-round picks/);
  // a traded-for 1st makes room for two
  L.picks = { [`1:${(me + 1) % 16}`]: me };
  p = Z.keeperPlan(L, me, [name('José Ramírez').id, name('Yoshinobu Yamamoto').id]);
  assert.ok(p.ok); assert.deepEqual(p.rows.map((x) => x.round), [1, 1]);
  delete L.picks;
  // six is one too many, and a player who can't be kept is turned away
  assert.match(Z.keeperPlan(L, me, ['a', 'b', 'c', 'd', 'e', 'f'].map(() => name('Matt Olson').id)).why, /Keep up to 5/);
  assert.match(Z.keeperPlan(L, me, [name('Elly De La Cruz').id]).why, /Kept 3 years/);
});

test('yoenis: after the deadline, a team that never picked keeps nobody (or its best values, if the league says so)', () => {
  const { L, ctx } = league();
  L.next = { opened: 1, due: 2, picks: { 3: [] }, missed: 'none' };
  assert.deepEqual(Z.keepersOf(L, ctx, 0), []);
  L.next.missed = 'auto';
  const auto = Z.keepersOf(L, ctx, 0);
  assert.ok(auto.length > 0 && auto.length <= 5);
  assert.ok(Z.keeperPlan(L, 0, auto).ok, 'the automatic picks follow the same-round rule');
  assert.deepEqual(Z.keepersOf(L, ctx, 3), [], 'a team that chose nobody keeps nobody');
});

test('yoenis: keepers go on next spring\'s board in their rounds and carry their years into the new season', () => {
  const { L, ctx, sport, team, name } = league();
  const me = team("Ippei's Book Club");
  const ks = [name('José Ramírez').id, name('Garrett Crochet').id, name('Bo Bichette').id, name('William Contreras').id];
  L.next = { opened: 1, due: 2, picks: { [me]: ks }, missed: 'none' };
  const D2 = Z.nextDraft(L, ctx, sport, L.next.picks, { now: Date.UTC(2027, 2, 20), seed: 0.5 });
  const mine = D2.board.map((b, k) => (b && b.team === me ? { pid: b.pid, round: Math.floor(k / 16) + 1 } : null)).filter(Boolean);
  const at = (pid) => mine.find((x) => x.pid === pid).round;
  assert.equal(at(name('José Ramírez').id), 1);
  assert.equal(at(name('Garrett Crochet').id), 9);
  assert.deepEqual([at(name('Bo Bichette').id), at(name('William Contreras').id)].sort(), [2, 3]);
  assert.equal(D2.board.filter(Boolean).length, 4, 'nobody else kept anyone (they missed the deadline)');
  // the new season knows each keeper's history: Crochet's 3 years are up next spring
  const L2 = Z.begin(D2, sport, { now: Date.UTC(2027, 2, 26) });
  assert.deepEqual(L2.settings.keeperRule, L.settings.keeperRule);
  assert.equal(L2.keepInfo[name('Garrett Crochet').id].years, 3);
  assert.equal(L2.keepInfo[name('Bo Bichette').id].years, 1);
  assert.equal(L2.keepInfo[name('Bo Bichette').id].base, 3);
});

test('yoenis: the imported season reads as over, with Yahoo\'s final places', () => {
  const { L, doc } = league();
  assert.ok(L.week > G.totalWeeks(L));
  const st = G.standings(L);
  assert.equal(st.length, 16); assert.equal(st[0].rank, 1);
  assert.equal(G.finish(L).champion, st[0].team);
  assert.equal(G.summary(L).champion.name, L.teams[st[0].team].name);
  assert.equal(doc.seasons.length, 13); assert.equal(doc.seasons[0].season, '2013'); assert.ok(doc.seasons.every((s) => s.champion && s.standings.length >= 10));
});

test('yoenis: offseason trades of players and next year\'s picks, and the draft follows them', () => {
  const { L, ctx, sport, team, name } = league();
  assert.ok(G.offseason(L), 'trades are open between seasons');
  const me = team("Ippei's Book Club"), them = team('Bulba');
  assert.equal(G.pickRounds(L), 25);
  assert.equal(G.picksOf(L, me).length, 25, 'one pick a round, next season only');
  // send Olson and our 2nd for their 1st
  const olson = name('Matt Olson').id;
  const r = G.propose(L, ctx, me, them, [olson], [], Date.now(), { pickGive: [`2:${me}`], pickGet: [`1:${them}`] });
  assert.ok(r.ok, r.why);
  L.settings.tradeReview = 'none';
  assert.ok(G.respond(L, ctx, r.trade.id, true, Date.now()).ok);
  assert.ok(L.rosters[them].includes(olson));
  assert.equal(G.pickOwner(L, `1:${them}`), me);
  assert.equal(G.pickOwner(L, `2:${me}`), them);
  // Olson keeps his draft round on his new team
  assert.equal(Z.keeperCost(L, olson).round, 2);
  // two 1st-round keepers now fit; and with no 2nd left, a 2nd-round cost moves up to a 1st... which is now full
  let p = Z.keeperPlan(L, me, [name('José Ramírez').id, name('Yoshinobu Yamamoto').id]);
  assert.ok(p.ok, p.why); assert.deepEqual(p.rows.map((x) => x.round), [1, 1]);
  // the commissioner's order after the lottery, and the traded picks, shape next spring's board
  L.next = { opened: 1, due: 2, picks: { [me]: [name('José Ramírez').id, name('Yoshinobu Yamamoto').id] }, missed: 'none' }; L.nextOrder = L.teams.map((t) => t.id).reverse();
  const D2 = Z.nextDraft(L, ctx, sport, L.next.picks, { now: Date.UTC(2027, 2, 20), seed: 0.3 });
  assert.equal(D2.round1[0], 15, 'the set order, first pick first');
  const r1 = D2.order.slice(0, 16), r2 = D2.order.slice(16, 32);
  assert.equal(r1.filter((x) => x === me).length, 2, 'two 1sts');
  assert.equal(r2.filter((x) => x === me).length, 0, 'no 2nd');
  assert.equal(D2.via[r1.findIndex((x, i) => x === me && D2.via[i] != null)], them);
  const mine = D2.board.map((b, k) => (b && b.team === me ? Math.floor(k / 16) + 1 : null)).filter(Boolean);
  assert.deepEqual(mine, [1, 1]);
  // picks only trade between seasons when the league says so
  L.settings.pickTrades = 'offseason'; L.week = 5;
  assert.match(G.tradeCheck(L, ctx, { from: me, to: them, give: [], get: [], pickGive: [`3:${me}`], pickGet: [] }, null).why, /offseason only/);
});
