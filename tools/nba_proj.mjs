// Runs the NBA Hub's season simulations in Node and saves each team's projected record and draft odds to
// nba/data/proj.json, so the Big Board's projected order matches the hub's lottery table.
// Usage: node tools/nba_proj.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const read = p => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const opt = p => { try { return read(p); } catch { return null; } };
const Hub = require('../nba/hub.js');
require('../nba/lib/season.js'); require('../nba/lib/offseason.js');

const inputs = {
  data: read('celtics/data.json'), stats: opt('hardcap/stats.json') || {}, fixes: opt('hardcap/contracts.json'), live: opt('celtics/live.json'),
  board: opt('draft/nba.json') || {}, picks: read('nba/data/picks.json'), teams: opt('tools/draft_teams.json'),
  tpes: opt('nba/data/tpes.json'), exceptions: opt('nba/data/exceptions.json'), dead: opt('nba/data/dead.json'), darko: opt('nba/data/darko.json'),
  taxhist: opt('nba/data/taxhist.json'), ratings: opt('nba/data/ratings.json'), lineups: opt('nba/data/lineups.json'), frozen: opt('nba/data/frozen.json'),
  moves: opt('nba/data/moves.json'), trades: opt('nba/data/trades.json'),
};
// The page's defaults, so the numbers match what a visitor sees
const H = Hub.build(inputs, {});
const s0 = H.season0(), slots = H.draftSlots(2027);
const r = x => Math.round(x * 1000) / 1000;
// saved under the Big Board's codes (ESPN style)
const BOARD = { BRK: 'BKN', CHO: 'CHA', PHO: 'PHX' };
const teams = {};
for (const c of H.codes) {
  const o = s0[c];
  teams[BOARD[c] || c] = { w: Math.round(o.projW * 10) / 10, l: Math.round(o.projL * 10) / 10, slot: slots[c], avgPick: Math.round(o.avgPick * 10) / 10, no1: r(o.no1), top4: r(o.top4),
    odds: o.slots.slice(1, 15).map(r) };
}
const out = { updated: new Date().toISOString().slice(0, 10), asof: H.asOf, source: 'NBA Hub season simulations', sims: H.cfg.sims, teams };
writeFileSync(new URL('nba/data/proj.json', root), JSON.stringify(out) + '\n');
console.log('nba/data/proj.json:', Object.keys(teams).length, 'teams; worst:', Object.entries(teams).sort((a, b) => a[1].slot - b[1].slot).slice(0, 3).map(([c, t]) => `${c} ${t.w}-${t.l}`).join(', '));
