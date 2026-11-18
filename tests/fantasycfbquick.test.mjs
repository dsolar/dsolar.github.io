import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { CFB_COLS } from '../supabase/functions/fk-live/cfb.mjs';
import { cfbWindows, cfbBoardGames, cfbSlates } from '../supabase/functions/fk-live/cfb-slates.mjs';
const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js'), V = require('../fantasy-kit/value.js');
const SL = require('../fantasy-kit/slates.js'), Q = require('../fantasy-kit/quick-games.js'), E = require('../fantasy-kit/experience.js');
const F = require('../fantasy-kit/draft.js'), G = require('../fantasy-kit/league.js'), Z = require('../fantasy-kit/season.js');
const pool = JSON.parse(readFileSync(new URL('../fantasy-kit/data/cfb.json', import.meta.url)));
const now = Date.parse('2026-11-16T15:00Z');
const game = (id, at, away = 'KENT', home = 'BGSU') => ({ id: String(id), at, away, home, state: 'pre' });
const week = { sport: 'cfb', week: 12, start: '2026-11-16', end: '2026-11-22', games: [
  game(101, '2026-11-19T00:00Z'), game(102, '2026-11-21T00:00Z'),
  game(103, '2026-11-21T17:00Z', 'OSU', 'MICH'), game(104, '2026-11-21T20:30Z'),
  game(105, '2026-11-22T00:00Z', 'OSU', 'MICH'), game(106, '2026-11-22T05:15Z'),
] };

test('NCAAF offers college windows and includes after-midnight Hawaii kickoffs in Saturday night', () => {
  assert.deepEqual(SL.list(week, now).map(s => s.key), ['full', 'saturday', 'prime', 'friday', 'midweek', 'one', 'custom']);
  for (const [kind, ids] of Object.entries({ full: ['101', '102', '103', '104', '105', '106'], saturday: ['103', '104'], prime: ['105', '106'], friday: ['102'], midweek: ['101'] })) {
    const sl = SL.pick(week, kind, null, now);
    assert.deepEqual(sl.games.map(g => g.id), ids); assert.equal(sl.sport, 'cfb'); assert.equal(sl.week, 12);
  }
  const afterFriday = Date.parse('2026-11-21T06:00Z');
  assert.equal(SL.list(week, afterFriday)[0].label, 'Rest of the week');
  assert.ok(!SL.list(week, afterFriday).some(s => s.kind === 'friday'));
});

test('college quick rules preserve every draft mode, exact games, scoring and postseason week', () => {
  const data = { weeks: [{ ...week, week: 22 }] };
  for (const mode of Q.MODES.map(m => m.key)) for (const scoring of ['half', 'ppr', 'std']) {
    const v = Q.view({ ...Q.initial('cfb'), kind: 'custom', games: ['105', '106'], mode, scoring, period: 'week:22' }, data, S, SL, null, now);
    const href = new URL(Q.setupHref(v, E, SL, true), 'https://davidsolar.dev');
    const r = E.decode(href.searchParams.get('rules'), S);
    assert.equal(r.sport, 'cfb'); assert.equal(r.type, mode); assert.equal(r.scoring, scoring);
    assert.equal(r.slPeriod, 'week:22'); assert.deepEqual(r.slGames, ['105', '106']);
    assert.equal(r.lineup, 'CPT UTIL UTIL UTIL UTIL UTIL');
    assert.equal(href.searchParams.get('custom'), '1');
    assert.equal(Q.scoringRows(v, S).find(r => r.key === 'rec').value, { half: 0.5, ppr: 1, std: 0 }[scoring]);
  }
  assert.throws(() => E.decode(JSON.stringify({ v: 1, rules: { sport: 'nfl', slPeriod: 'week:22' } }), S));
});

const calendar = {
  season: 2026, teams: [{ id: 1, abbr: 'KENT' }, { id: 2, abbr: 'BGSU' }],
  weeks: [{ type: 2, week: 12, start: '2026-11-16T05:00Z', end: '2026-11-23T10:00Z' },
    { type: 2, week: 13, start: '2026-11-23T05:00Z', end: '2026-11-30T10:00Z' }],
  games: [{ post: true, day: '2026-12-05' }],
};
const event = (id, date, status = 'STATUS_SCHEDULED', home = 2) => ({ id: String(id), date, status: { type: { name: status, state: 'pre' } }, competitions: [{ competitors: [
  { homeAway: 'away', team: { id: '1' } }, { homeAway: 'home', team: { id: String(home) } },
] }] });

test('the feed aligns with real fantasy weeks and maps only usable FBS matchups', () => {
  assert.deepEqual(cfbWindows(calendar, now), [{ week: 12, start: '2026-11-16', end: '2026-11-22' }, { week: 13, start: '2026-11-23', end: '2026-11-29' }]);
  assert.deepEqual(cfbWindows(calendar, Date.parse('2026-12-03T12:00Z')), [{ week: 14, start: '2026-11-30', end: '2026-12-06' }]);
  const board = { events: [event(1, '2026-11-19T00:00Z'), event(2, '2026-11-19T00:00Z', 'STATUS_POSTPONED'),
    event(3, '2026-11-19T00:00Z', 'STATUS_CANCELED'), event(4, '2026-11-19T00:00Z', 'STATUS_SCHEDULED', 999), event('bad', 'invalid')] };
  assert.deepEqual(cfbBoardGames(board, calendar.teams), [game(1, '2026-11-19T00:00Z')]);
});

test('schedule requests use individual dates, deduplicate games and reject incomplete weeks', async () => {
  const urls = [];
  const get = async url => {
    if (url.endsWith('/hub.json')) return calendar;
    urls.push(url);
    return { events: url.includes('20261118') || url.includes('20261119') ? [event(1, '2026-11-19T00:00Z')] : [] };
  };
  const data = await cfbSlates(get, now);
  assert.equal(urls.length, 14); assert.ok(urls.every(u => /dates=\d{8}&groups=80&limit=300$/.test(u)));
  assert.equal(data.scope, 'FBS-vs-FBS'); assert.equal(data.weeks[0].games.length, 1); assert.equal(data.weeks[1].games.length, 0);
  await assert.rejects(cfbSlates(async url => url.includes('20261120') ? {} : get(url), now), /incomplete/);
});

function league(kind = 'custom', ids = ['103', '104']) {
  const sl = SL.pick(week, kind, ids, now), lu = SL.lineup(sl.games.length, 2, 'cfb');
  const sport = S.attach({ ...S.cfb }, pool);
  const players = pool.players.filter(p => sl.teams.includes(p.t)).map(p => ({ ...p }));
  V.evaluate(sport, players, { teams: 2, lineup: lu.lineup, bench: lu.bench, scoring: 'half' });
  const D = F.create({ sport, teams: 2, seed: 31, now, lineup: lu.lineup, bench: lu.bench, scoring: 'half', botDelay: 0 });
  D.season = { format: 'h2h', tally: 'allplay', weeks: 1, oneWeek: true, playoffTeams: 0, slate: { ...sl, mult: lu.mult }, ir: 0 };
  F.start(D, now); const draftCtx = F.context(D, players, sport); let t = now;
  for (let i = 0; i < 3000 && D.phase === 'live'; i++) { t += 2000; F.tick(D, draftCtx, t); }
  assert.equal(D.phase, 'done');
  const L = Z.begin(D, sport, { now: t, real: true });
  const real = { season: '2026', line: 'tot', cols: CFB_COLS, weeks: {} };
  return { L, sl, t, players, real, ctx: G.context(L, players, sport, { real }) };
}
const box = (players, teams, pts) => Object.fromEntries(players.filter(p => teams.includes(p.t)).map(p => [p.id, CFB_COLS.map(c => c === 'g' ? 1 : /^pts_(std|half_ppr|ppr)$/.test(c) ? pts : 0)]));

test('a college window scores only selected game boxes, locks at kickoff and closes on their final', () => {
  const { L, sl, t, players, real, ctx } = league();
  assert.equal(L.start, t); assert.equal(G.weekStart(L, 2), sl.last + 4 * 36e5);
  assert.deepEqual(Z.slateGames(L), ['103', '104']); assert.equal(L.settings.slate.day, undefined);
  const p = players.find(p => p.t === 'KENT');
  const liveGames = Object.fromEntries(sl.teams.map(t => [t, [
    { id: '999', at: '2026-11-17T00:00Z', state: 'post' },
    ...sl.games.filter(g => g.away === t || g.home === t),
  ]]));
  G.setKicks(L, { start: week.start, updated: new Date(now).toISOString(), games: liveGames });
  assert.equal(L.kick.teams.KENT, sl.last, 'an earlier unselected game cannot lock this window');
  assert.equal(G.isLocked(L, p, 1, sl.last - 1), false); assert.equal(G.isLocked(L, p, 1, sl.last + 1), true);
  Z.mergeGames(real, { games: { '103': { state: 'post', lines: box(players, ['OSU', 'MICH'], 10) },
    '104': { state: 'in', lines: box(players, ['KENT', 'BGSU'], 20) },
    '999': { state: 'post', lines: box(players, ['KENT', 'BGSU'], 99) } } });
  const lu = G.lineupFor(L, ctx, 0, 1), tw = G.teamWeek(L, ctx, 0, 1);
  assert.ok(tw.total > 0);
  for (const [id, pts] of Object.entries(tw.players)) assert.equal(pts, (['KENT', 'BGSU'].includes(ctx.byId[id].t) ? 20 : 10) * G.slotMult(L, lu.indexOf(id), id));
  assert.equal(G.canFinish(L, ctx, sl.last + 3 * 36e5), false, 'waits for the selected live game');
  Z.mergeGames(real, { games: { '104': { state: 'post', lines: box(players, ['KENT', 'BGSU'], 20) } } });
  const final = sl.last + 3 * 36e5;
  assert.equal(G.canFinish(L, ctx, final), true, 'can finish before the four-hour estimate');
  Z.catchUp(L, ctx, final); assert.equal(L.week, 2);
});

test('one-game college showdowns have a 1.5x captain and can finish that same night', () => {
  const { L, sl, players, real, ctx } = league('one', ['101']);
  assert.equal(L.settings.mult.CPT, 1.5); assert.equal(L.settings.showdown, undefined);
  Z.mergeGames(real, { games: { '101': { state: 'post', lines: box(players, sl.teams, 10) } } });
  const lu = G.lineupFor(L, ctx, 0, 1), tw = G.teamWeek(L, ctx, 0, 1);
  assert.equal(tw.players[lu[0]], 15); assert.equal(tw.players[lu[1]], 10);
  Z.catchUp(L, ctx, sl.last + 3 * 36e5); assert.equal(L.week, 2);
});

test('long opening windows count both games for a school and lock at its first kickoff', () => {
  const { L, sl, players, real, ctx } = league('custom', ['101', '104']);
  assert.equal(L.kick.teams.KENT, sl.first);
  const p = players.find(p => p.t === 'KENT'); assert.equal(G.gamesLeft(L, ctx, p, 1, 0), 2);
  Z.mergeGames(real, { games: { '101': { state: 'post', lines: box(players, sl.teams, 10) }, '104': { state: 'in', lines: box(players, sl.teams, 5) } } });
  assert.equal(G.gamesLeft(L, ctx, p, 1, 0.5), 0.5);
  const lu = G.lineupFor(L, ctx, 0, 1), tw = G.teamWeek(L, ctx, 0, 1);
  assert.equal(tw.players[lu[0]], 22.5, 'both boxes count with the captain multiplier');
});

test('the deployed handler supports a full FBS slate above twenty games and caches final boxes', async () => {
  const originalFetch = globalThis.fetch, originalDeno = globalThis.Deno;
  let handler; const writes = [], ids = Array.from({ length: 130 }, (_, i) => String(1000 + i));
  const future = new Date(Date.now() + 864e5).toISOString();
  const schedule = { weeks: [{ games: ids.slice(1).map(id => game(id, future)) }] };
  globalThis.Deno = { env: { get: k => k === 'SUPABASE_URL' ? 'https://test.invalid' : 'test-service-key' }, serve: fn => { handler = fn; } };
  globalThis.fetch = async (url, init = {}) => {
    if (url.startsWith('https://test.invalid/rest/v1/')) {
      if (init.method === 'POST') { writes.push(JSON.parse(init.body)); return new Response(null, { status: 201 }); }
      return Response.json(url.includes('fk_live?sport=eq.cfb-slates') ? [{ data: schedule, updated_at: new Date().toISOString() }] : []);
    }
    assert.ok(url.includes('/summary?event=1000'), `unexpected external request: ${url}`);
    return Response.json({ header: { competitions: [{ date: new Date().toISOString(), status: { type: { state: 'post', completed: true } }, competitors: [] }] } });
  };
  try {
    const entry = new URL('../supabase/functions/fk-live/index.ts', import.meta.url);
    const ts = readFileSync(entry, 'utf8').replace(/from "(\.\/[^\"]+)"/g, (_, p) => `from "${new URL(p, entry).href}"`);
    const js = stripTypeScriptTypes(ts, { mode: 'strip' });
    await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
    const result = await (await handler(new Request('https://test.invalid/fk-live?sport=cfb&games=' + ids.join(',')))).json();
    assert.equal(Object.keys(result.games).length, 130); assert.equal(result.line, 'tot'); assert.deepEqual(result.cols, CFB_COLS);
    assert.equal(result.games['1000'].state, 'post'); assert.equal(result.games['1129'].state, 'pre');
    assert.ok(writes.some(rows => Array.isArray(rows) && rows.some(r => r.sport === 'cfb' && r.gid === '1000' && r.final)));
  } finally { globalThis.fetch = originalFetch; globalThis.Deno = originalDeno; }
});
