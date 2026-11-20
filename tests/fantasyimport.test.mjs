import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
const require = createRequire(import.meta.url);
const S = require('../fantasy-kit/sports.js');
const I = require('../fantasy-kit/import.js');

const sleeperNfl = {
  league_id: '1180000000000000000', name: 'Lige de Test', sport: 'nfl', season: '2026', total_rosters: 12,
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'REC_FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'IR'],
  settings: { type: 2, playoff_teams: 6, playoff_week_start: 15, trade_deadline: 11, waiver_type: 2, waiver_budget: 200, waiver_clear_days: 2, league_average_match: 1, divisions: 2, taxi_slots: 3, reserve_slots: 2 },
  scoring_settings: { pass_yd: 0.04, pass_td: 6, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6, fum_lost: -2, bonus_rec_te: 0.5, fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50p: 5, xpm: 1, pts_allow_0: 10, sack: 1, int: 2, def_td: 6, weird_stat: 1 },
};
const sleeperDraft = { type: 'auction', settings: { budget: 200, pick_timer: 90 } };

test('Sleeper football: lineup, dynasty, playoffs, FAAB, scoring and bonuses carry over', () => {
  const r = I.fromSleeper(sleeperNfl, sleeperDraft, S);
  const f = r.form;
  assert.equal(f.sport, 'nfl'); assert.equal(f.teams, 12); assert.equal(f.name, 'Lige de Test');
  assert.equal(f.lineup, 'QB RB RB WR WR WR TE FLEX SFLEX FLEX K DEF');
  assert.equal(f.bench, 6); assert.equal(f.ir, 2);
  assert.equal(f.kind, 'dynasty'); assert.equal(f.taxi, 3);
  assert.equal(f.playoffs, 6); assert.equal(f.weeks, 14); assert.equal(f.deadline, 11);
  assert.equal(f.waivers, 'faab'); assert.equal(f.faab, 200); assert.equal(f.median, 1); assert.equal(f.divs, 2);
  assert.equal(f.type, 'auction'); assert.equal(f.aBudget, 200); assert.equal(f.clock, 90);
  assert.equal(f.scoring, 'cp'); assert.equal(f.weights.pass_td, 6); assert.equal(f.weights.rec, 1); assert.equal(f.weights.def_int, 2);
  assert.equal(f.weights.fgm, 3); assert.equal(f.weights.fgm_50p, 2);
  assert.equal(f.tepOn, 1); assert.equal(f.tepAmt, 0.5);
  assert.ok(r.notes.some((n) => /WR\/TE flex/.test(n)));
  assert.ok(r.unmapped.includes('weird stat'));
});

test('Sleeper basketball and errors', () => {
  const r = I.fromSleeper({ league_id: '1', name: 'Hoops', sport: 'nba', total_rosters: 10, roster_positions: ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'UTIL', 'UTIL', 'BN', 'BN', 'IR'], settings: { type: 0, playoff_teams: 5, waiver_type: 0 },
    scoring_settings: { pts: 1, reb: 1.2, ast: 1.5, stl: 3, blk: 3, to: -1, tpm: 0.5 } }, null, S);
  assert.equal(r.form.lineup, 'PG SG G SF PF F C UTIL UTIL');
  assert.equal(r.form.playoffs, 4); assert.ok(r.notes.some((n) => /5 playoff teams became 4/.test(n)));
  assert.equal(r.form.waivers, 'rolling'); assert.equal(r.form.weights.tov, -1);
  assert.throws(() => I.fromSleeper({ league_id: '2', sport: 'lcs' }, null, S), /doesn't run LCS/);
});

test('ESPN football points and basketball categories', () => {
  const nfl = { settings: { name: 'ESPN Ball', size: 10,
    rosterSettings: { lineupSlotCounts: { 0: 1, 2: 2, 4: 2, 6: 1, 23: 1, 16: 1, 17: 1, 20: 7, 21: 1, 7: 0 } },
    scoringSettings: { scoringType: 'H2H_POINTS', scoringItems: [{ statId: 3, points: 0.04 }, { statId: 4, points: 4 }, { statId: 53, points: 0.5 }, { statId: 80, points: 3 }, { statId: 74, points: 5 }, { statId: 89, points: 5 }, { statId: 999, points: 1 }] },
    scheduleSettings: { matchupPeriodCount: 14, playoffTeamCount: 4, divisions: [{}, {}] }, draftSettings: { type: 'AUCTION', auctionBudget: 200, keeperCount: 2, timePerSelection: 60 },
    acquisitionSettings: { isUsingAcquisitionBudget: true, acquisitionBudget: 100, waiverHours: 48 }, tradeSettings: { deadlineDate: 1765000000000 } } };
  const r = I.fromEspn(nfl, 'nfl', S), f = r.form;
  assert.equal(f.lineup, 'QB RB RB WR WR TE FLEX K DEF');
  assert.equal(f.bench, 7); assert.equal(f.ir, 1); assert.equal(f.weeks, 14); assert.equal(f.playoffs, 4); assert.equal(f.divs, 2);
  assert.equal(f.type, 'auction'); assert.equal(f.aBudget, 200); assert.equal(f.kind, 'keeper'); assert.equal(f.keepN, 2);
  assert.equal(f.faab, 100); assert.equal(f.waiverDays, 2);
  assert.equal(f.weights.rec, 0.5); assert.equal(f.weights.fgm, 3); assert.equal(f.weights.fgm_50p, 2);
  assert.ok(r.unmapped.includes('ESPN stat 999'));
  assert.ok(r.notes.some((n) => /trade deadline/.test(n)));
  const nba = { settings: { name: 'Cats', size: 12, rosterSettings: { lineupSlotCounts: { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 11: 3, 12: 3, 13: 1 } },
    scoringSettings: { scoringType: 'H2H_CATEGORY', scoringItems: [19, 20, 17, 0, 6, 3, 2, 1, 11].map((statId) => ({ statId })) }, scheduleSettings: { matchupPeriodCount: 19, playoffTeamCount: 6 } } };
  const b = I.fromEspn(nba, 'nba', S);
  assert.equal(b.form.season, 'h2hcats'); assert.equal(b.form.scoring, 'cc');
  assert.deepEqual(b.form.cats, ['fg', 'ft', 'tpm', 'pts', 'reb', 'ast', 'stl', 'blk', 'tov']);
  assert.equal(b.form.lineup, 'PG SG G SF PF F C UTIL UTIL UTIL');
});

test('Yahoo pasted settings: basketball categories and football points', () => {
  const nba = `League Settings
League Name: Don't Forget to Hoop
Max Teams: 12
Scoring Type: Head-to-Head - Categories
Draft Type: Live Standard Draft
Waiver Type: FAB w/ Continual rolling list tiebreak
FAB Balance: 100
Playoffs: Week 20, 21 and 22 (6 teams)
Roster Positions: PG, SG, G, SF, PF, F, C, C, Util, Util, BN, BN, BN, IL, IL
Stat Categories: Field Goal Percentage (FG%), Free Throw Percentage (FT%), 3-point Shots Made (3PTM), Points Scored (PTS), Total Rebounds (REB), Assists (AST), Steals (ST), Blocked Shots (BLK), Turnovers (TO)`;
  const r = I.fromYahooText(nba, S), f = r.form;
  assert.equal(f.sport, 'nba'); assert.equal(f.name, "Don't Forget to Hoop"); assert.equal(f.teams, 12);
  assert.equal(f.lineup, 'PG SG G SF PF F C C UTIL UTIL'); assert.equal(f.bench, 3); assert.equal(f.ir, 2);
  assert.equal(f.season, 'h2hcats'); assert.equal(f.scoring, 'cc'); assert.equal(f.cats.length, 9);
  assert.equal(f.waivers, 'faab'); assert.equal(f.faab, 100); assert.equal(f.playoffs, 6); assert.equal(f.weeks, 19);
  const nfl = `League Name: Sunday Funday
Max Teams: 10
Scoring Type: Head-to-Head - Points
Draft Type: Live Auction Draft
Roster Positions: QB, WR, WR, WR, RB, RB, TE, W/R/T, Q/W/R/T, K, DEF, BN, BN, BN, BN, BN, IR
Stat Modifiers
Passing Yards: 25 yards per point
Passing Touchdowns: 4
Interceptions: -1
Rushing Yards: 10 yards per point
Rushing Touchdowns: 6
Receptions: 0.5
Receiving Yards: 10 yards per point
Receiving Touchdowns: 6
Fumbles Lost: -2`;
  const y = I.fromYahooText(nfl, S);
  assert.equal(y.form.sport, 'nfl'); assert.equal(y.form.type, 'auction');
  assert.equal(y.form.lineup, 'QB WR WR WR RB RB TE FLEX SFLEX K DEF');
  assert.equal(y.form.weights.pass_yd, 0.04); assert.equal(y.form.weights.rush_yd, 0.1); assert.equal(y.form.weights.rec, 0.5); assert.equal(y.form.weights.pass_int, -1);
  assert.throws(() => I.fromYahooText('just\nsome\nwords\nhere', S), /Roster Positions/);
});

test('reading what was pasted', () => {
  assert.deepEqual(I.parseInput('https://sleeper.com/leagues/1180123456789012345/league'), { source: 'sleeper', id: '1180123456789012345' });
  assert.deepEqual(I.parseInput('https://fantasy.espn.com/basketball/league?leagueId=12345&seasonId=2027'), { source: 'espn', id: '12345', sport: 'nba', season: 2027 });
  assert.equal(I.parseInput('123456').source, 'espn');
  assert.deepEqual(I.parseInput('https://basketball.fantasysports.yahoo.com/nba/282497/6'), { source: 'yahoo-link', id: '282497', sport: 'nba' });
  assert.equal(I.espnSeason('nba', Date.UTC(2026, 10, 20)), 2027);
  assert.equal(I.espnSeason('nfl', Date.UTC(2027, 0, 5)), 2026);
});

test("Yahoo: a real public league's Settings page (points basketball)", () => {
  const text = `Yahoo Sports Fantasy Basketball
Scoring & Settings
Setting Value
League ID#: 282497
League Name: Yahoo H2H-Pts 282497
Auto-renew Enabled: No
Draft Type: Live Standard Draft
Draft Time: Mon Nov 2 11:57am EST
Max Teams: 10
Live Draft Pick Time: 1 Minute
Scoring Type: Head-to-Head - Points
Max Acquisitions for Entire Season: No maximum
Max Trades for Entire Season No maximum
Trade End Date: March 4, 2027
Allow Draft Pick Trades: No
Waiver Time: 1 day
Waiver Type: Continual rolling list
Waiver Mode: Standard
Allow injured players from waivers or free agents to be added directly to injury slot: No
Can't Cut List Provider: Yahoo Sports
Trade Review: League Votes
Votes Required to Veto: Default
Trade Reject Time: 2 days
Post Draft Players: Follow Waiver Rules
Max Acquisitions per Week: 4
Weekly Deadline: Daily - Today
Start Scoring on: Week 4
Playoffs: 6 teams - Week 20, 21 and 22 (ends Sunday, Apr 4)
Playoff Tie-Breaker: Higher seed wins
Playoff Reseeding: Yes
Lock Eliminated Teams: Yes
Divisions: No
Lock Benched Players: No
Make League Publicly Viewable: Yes
Send unjoined players email reminders: Yes
Roster Positions: PG, SG, G, SF, PF, F, C, C, Util, Util, BN, BN, BN, IL, IL, IL
Players Stat Category Value
Points Scored (PTS) 1
Total Rebounds (REB) 1.2
Assists (AST) 1.5
Blocked Shots (BLK) 3
Steals (ST) 3
Turnovers (TO) -1
`;
  const r = I.fromYahooText(text, S), f = r.form;
  assert.equal(f.lineup, 'PG SG G SF PF F C C UTIL UTIL'); assert.equal(f.bench, 3); assert.equal(f.ir, 3);
  assert.deepEqual(f.weights, { pts: 1, reb: 1.2, ast: 1.5, blk: 3, stl: 3, tov: -1 });
  assert.equal(f.clock, 60); assert.equal(f.maxAdds, 4); assert.equal(f.review, 'vote'); assert.equal(f.reseed, 1);
  assert.equal(f.playoffs, 6); assert.equal(f.weeks, 16); assert.equal(f.waivers, 'rolling'); assert.equal(f.waiverDays, 1);
});
