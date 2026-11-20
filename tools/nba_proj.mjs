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
// Team needs for the mock draft: each position group's strength on next season's roster (the season a draftee
// joins), from its two best players' ratings. A group well below the league's typical strength is a need, the
// weakest first; at most two, and none for a team strong everywhere. The groups match the board's G / W / B.
const GROUP = p => p.pos === 'G' ? 'Guard' : p.pos === 'B' ? 'Big' : 'Wing';
const needsAt = i => {
  const str = {};
  for (const c of H.codes) {
    const by = { Guard: [], Wing: [], Big: [] };
    for (const x of H.rosterAt(c, i)) if (x.p && !x.p.two) by[GROUP(x.p)].push(Math.max(0, x.r + 2));
    str[c] = Object.fromEntries(Object.entries(by).map(([g, a]) => { a.sort((u, v) => v - u); return [g, (a[0] || 0) + 0.6 * (a[1] || 0)]; }));
  }
  const med = {}; for (const g of ['Guard', 'Wing', 'Big']) { const a = H.codes.map(c => str[c][g]).sort((u, v) => u - v); med[g] = a[a.length >> 1]; }
  const out = {};
  for (const c of H.codes) out[BOARD[c] || c] = ['Guard', 'Wing', 'Big'].map(g => [g, str[c][g] / Math.max(0.1, med[g])]).filter(x => x[1] < 0.8).sort((a, b) => a[1] - b[1]).slice(0, 2).map(x => x[0]);
  return out;
};
const needs27 = needsAt(1);
for (const c of Object.keys(teams)) teams[c].needs = needs27[c] || [];
// The 2028 draft, for the Big Board's 2028 mock: projected 2027-28 records, and who owns each pick as the trades
// stand (protections as keep ranges, the way the board's mock reads 2027's rules)
const B = c => BOARD[c] || c;
const t28 = {}, rules28 = [], picks28 = [];
const needs28 = needsAt(2);
for (const r of H.standings(1)) t28[B(r.code)] = { w: Math.round(r.projW * 10) / 10, l: Math.round((82 - r.projW) * 10) / 10, needs: needs28[B(r.code)] || [] };
const slots28 = H.draftSlots(2028), order28 = H.codes.slice().sort((a, b) => slots28[a] - slots28[b]);
for (const rnd of [1, 2]) order28.forEach((c, k) => {
  const pk = H.W.picks.find(x => x.y === 2028 && x.r === rnd && x.from === c);
  const owner = pk && pk.owner && pk.owner !== 'OUT' && H.W.T[pk.owner] ? pk.owner : c;
  picks28.push([k + 1 + (rnd === 2 ? 30 : 0), rnd, B(owner), B(c)]);
  if (rnd === 1 && owner !== c) rules28.push({ type: 'to', orig: B(c), to: B(owner), keep: pk.prot ? [pk.prot.lo, pk.prot.hi] : null, note: (pk.note || 'Unprotected').replace(/\b(BRK|CHO|PHO)\b/g, m => BOARD[m]) });
});
const out = { updated: new Date().toISOString().slice(0, 10), asof: H.asOf, source: 'NBA Hub season simulations', sims: H.cfg.sims, teams,
  y2028: { season: '2027-28', teams: t28, order: picks28, first: rules28 } };
writeFileSync(new URL('nba/data/proj.json', root), JSON.stringify(out) + '\n');
console.log('nba/data/proj.json:', Object.keys(teams).length, 'teams; worst:', Object.entries(teams).sort((a, b) => a[1].slot - b[1].slot).slice(0, 3).map(([c, t]) => `${c} ${t.w}-${t.l}`).join(', '));
