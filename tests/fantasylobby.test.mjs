import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js');
const F = require('../fantasy-kit/draft.js');
const LB = require('../fantasy-kit/lobby.js');
const T0 = Date.UTC(2026, 10, 20, 0, 0, 0);

const draft = (type = 'snake') => {
  const data = JSON.parse(readFileSync(new URL('../fantasy-kit/data/nfl.json', import.meta.url), 'utf8'));
  const sport = S.attach(Object.assign({}, S.nfl), data);
  return F.create({ sport, teams: 8, type, seed: 3, now: T0, clock: 60 });
};

test('lobby: a live draw shuffles the order and reveals it slot by slot, last pick first', () => {
  const D = draft();
  const before = D.round1.slice();
  assert.ok(F.drawOrder(D, T0 + 1000, 99).ok);
  assert.notDeepEqual(D.round1, before, 'shuffled');
  assert.equal(D.drawn.at, T0 + 1000);
  assert.equal(LB.revealed(D, T0 + 1000), 0);
  assert.equal(LB.revealed(D, T0 + 1000 + 3 * LB.STEP + 10), 3);
  assert.ok(LB.drawing(D, T0 + 1000 + 3 * LB.STEP));
  assert.equal(LB.revealed(D, T0 + 1000 + 20 * LB.STEP), 8);
  assert.ok(!LB.drawing(D, T0 + 1000 + 20 * LB.STEP));
  // mid-draw the top of the order is still hidden; the bottom shows
  const html = LB.html({ D, now: T0 + 1000 + 2 * LB.STEP + 10, me: 0, commish: true, seats: { 0: 'David' }, teamAv: () => '', canDraw: true, name: 'Test', url: 'https://x' });
  assert.equal((html.match(/lb-row[^"]*hid/g) || []).length, 6);
  assert.match(html, /Drawing now/);
  // an auction has no order to draw
  assert.equal(F.drawOrder(draft('auction'), T0).ok, false);
});

test('lobby: ready counts only teams with a manager, and the commissioner sees when everyone is in', () => {
  const D = draft();
  const seats = { 0: 'David', 1: 'Sam', 2: 'Alex' };
  assert.deepEqual(LB.counts(D, seats), { claimed: 3, ready: 0, open: 5, all: false });
  D.ready = { 0: T0, 1: T0, 5: T0 };
  assert.deepEqual(LB.counts(D, seats), { claimed: 3, ready: 2, open: 5, all: false });
  D.ready[2] = T0;
  assert.equal(LB.counts(D, seats).all, true);
  const html = LB.html({ D, now: T0, me: 1, commish: true, seats, teamAv: () => '', canDraw: true, name: 'Test', url: 'https://x', invite: 'abc' });
  assert.match(html, /Everyone with a team is ready/);
  assert.match(html, /I'm not ready/);
  assert.match(html, /Invite \(5 open\)/);
  assert.match(html, /When the commissioner starts it/);
});

test('lobby: the calendar file and Google link carry the draft time and the room link', () => {
  const D = draft();
  D.startAt = Date.UTC(2026, 10, 22, 0, 30, 0);
  const ics = LB.ics(D, 'Lige de Rohan', 'https://davidsolar.dev/fantasy/league/?id=1');
  assert.match(ics, /DTSTART:20261122T003000Z/);
  assert.match(ics, /SUMMARY:Lige de Rohan draft/);
  assert.match(ics, /TRIGGER:-PT15M/);
  assert.ok(ics.includes('\r\n'));
  const g = LB.gcal(D, 'Lige de Rohan', 'https://x');
  assert.match(g, /dates=20261122T003000Z\//);
  const end = Date.UTC(2026, 10, 22, 0, 30, 0) + LB.lengthOf(D);
  assert.ok(LB.lengthOf(D) >= 36e5 && LB.lengthOf(D) <= 4 * 36e5);
  assert.ok(end > D.startAt);
  const html = LB.html({ D, now: T0, me: 0, commish: false, seats: { 0: 'David' }, teamAv: () => '', canDraw: true, name: 'L', url: 'https://x' });
  assert.match(html, /Add to calendar/);
  assert.ok(!/Draw the order live/.test(html), 'only the commissioner draws');
});
