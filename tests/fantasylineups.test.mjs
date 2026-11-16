import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const GD = require('../fantasy-kit/gameday.js');

// the shape fk-live ?sport=mlb&lineups=1 returns for one day
const feed = { days: { '2027-04-06': {
  teams: {
    BOS: [{ game: '1', at: '2027-04-06T23:10:00Z', opp: 'NYY', home: true, state: 'pre', posted: true, ppd: false }],
    NYY: [{ game: '1', at: '2027-04-06T23:10:00Z', opp: 'BOS', home: false, state: 'pre', posted: false, ppd: false }],
    TB: [{ game: '2', at: '2027-04-06T17:05:00Z', opp: 'TOR', home: true, state: 'pre', posted: true, ppd: false }, { game: '3', at: '2027-04-06T23:05:00Z', opp: 'TOR', home: true, state: 'pre', posted: true, ppd: false }],
    SEA: [{ game: '4', at: '2027-04-06T02:10:00Z', opp: 'HOU', home: true, state: 'pre', posted: false, ppd: true }],
  },
  bat: { 11: [{ game: '1', o: 3 }], 31: [{ game: '2', o: 2 }] },
  sp: { 21: [{ game: '1', opp: 'NYY', home: true }] },
} } };
const D = '2027-04-06';

test('lineup status: batting spot, not in lineup, not out yet, probable starter, no game, postponed, doubleheader', () => {
  assert.deepEqual(GD.lineupStatus(feed, { id: '11', t: 'BOS', pos: ['OF'] }, D), { kind: 'batting', o: 3, at: '2027-04-06T23:10:00Z', text: 'Batting 3rd' });
  assert.equal(GD.lineupStatus(feed, { id: '12', t: 'BOS', pos: ['1B'] }, D).text, 'Not in lineup');
  assert.equal(GD.lineupStatus(feed, { id: '13', t: 'NYY', pos: ['SS'] }, D).kind, 'pending');
  assert.equal(GD.lineupStatus(feed, { id: '21', t: 'BOS', pos: ['SP'] }, D).text, 'Probable starter vs NYY');
  assert.equal(GD.lineupStatus(feed, { id: '22', t: 'BOS', pos: ['RP'] }, D), null, 'a reliever has nothing to say');
  assert.equal(GD.lineupStatus(feed, { id: '14', t: 'LAD', pos: ['OF'] }, D).kind, 'nogame');
  assert.equal(GD.lineupStatus(feed, { id: '15', t: 'SEA', pos: ['C'] }, D).kind, 'ppd');
  assert.equal(GD.lineupStatus(feed, { id: '31', t: 'TB', pos: ['2B'] }, D).text, 'Batting 2nd (game 1), Not in lineup (game 2)');
  // a two-way player who starts on the mound reads as the starter
  assert.equal(GD.lineupStatus(feed, { id: '21', t: 'BOS', pos: ['UT', 'SP'] }, D).kind, 'sp');
  // a day the feed doesn't cover
  assert.equal(GD.lineupStatus(feed, { id: '11', t: 'BOS', pos: ['OF'] }, '2027-04-08'), null);
});

test('lineup status: auto-start benches a hitter only once his lineup is out and he is not in it', () => {
  const G = require('../fantasy-kit/league.js');
  const day = feed.days[D];
  assert.equal(G.sitting(day, { id: '12', t: 'BOS', pos: ['1B'] }), true, 'posted, not in it');
  assert.equal(G.sitting(day, { id: '11', t: 'BOS', pos: ['OF'] }), false, 'batting third');
  assert.equal(G.sitting(day, { id: '13', t: 'NYY', pos: ['SS'] }), false, 'not out yet: no reason to bench him');
  assert.equal(G.sitting(day, { id: '21', t: 'BOS', pos: ['SP'] }), false, 'pitchers are left alone');
  assert.equal(G.sitting(day, { id: '31', t: 'TB', pos: ['2B'] }), false, 'plays one game of a doubleheader');
  assert.equal(G.sitting(day, { id: '32', t: 'TB', pos: ['2B'] }), true, 'sits both games');
  assert.equal(G.sitting(null, { id: '12', t: 'BOS', pos: ['1B'] }), false, 'no feed, no change');
});
