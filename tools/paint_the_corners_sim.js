/* Paint the Corners balance check. Plays thousands of simulated games with four
   pitching styles and prints runs per 9, strikeout and walk rates for each lineup.
   Run from the repo root:  node tools/paint_the_corners_sim.js 2000
     random    throws any pitch anywhere on the 5x5 grid
     zoneOnly  throws anything, always in the strike zone
     learner   plays well with only what the screen shows
     oracle    plays well and secretly knows every hot and cold zone
*/
const E = require('../paint-the-corners/engine.js');
const { inZone, zIdx } = E;

function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
const keys = (s) => s.pitcher.pitches.map(p => p.key);

const strategies = {
  random(s) { return [rnd(keys(s)), Math.floor(Math.random() * 5), Math.floor(Math.random() * 5)]; },
  zoneOnly(s) { return [rnd(keys(s)), 1 + Math.floor(Math.random() * 3), 1 + Math.floor(Math.random() * 3)]; },
  learner(s) { return smartish(s, false); },
  oracle(s) { return smartish(s, true); },
};

function smartish(s, oracle) {
  const b = E.batter(s);
  const last = s.abPitches[s.abPitches.length - 1];
  const heatAt = (i) => (oracle || b.known[i]) ? b.heat[i] : 0.15;
  const P = (k) => s.pitchMap[k];
  const types = keys(s).filter(t => !last || t !== last.type || Math.random() < 0.15);
  const typeScore = (t) => {
    const f = P(t).fam;
    const known = oracle || b.pitchKnown[f];
    return (known ? (b.vs[f] || 0) * 0.07 : 0) - P(t).stuff;
  };
  if (s.strikes === 2 && s.balls < 3 && Math.random() < 0.6) {
    const t = types.filter(t => P(t).fam !== 'FB').sort((a, c) => typeScore(a) - typeScore(c))[0];
    if (t) return P(t).fam === 'SL' ? [t, 4, Math.random() < 0.5 ? 1 : 0] : [t, 4, 2];
  }
  if (s.strikes === 2 && Math.random() < 0.5 && types.includes('FB')) return ['FB', 0, 2];
  let best = null;
  for (const t of types) {
    for (let r = 1; r <= 3; r++) for (let c = 1; c <= 3; c++) {
      let v = heatAt(zIdx(r, c)) * 0.1 + typeScore(t) - E.locEdge(P(t), r, c, b.bats);
      if (r === 2 && c === 2) v += 0.12;
      if (E.isZoneCorner(r, c)) v += s.balls >= 2 ? 0.06 : -0.02;
      if (s.balls === 3) v += P(t).miss * 0.4;
      v += Math.random() * 0.03;
      if (!best || v < best.v) best = { v, t, r, c };
    }
  }
  return [best.t, best.r, best.c];
}

function run(stratName, games, modeKey, year) {
  const agg = { pa: 0, k: 0, bb: 0, h: 0, hr: 0, runs: 0, outs: 0, pitches: 0, games: 0, results: {}, gs: 0 };
  for (let g = 0; g < games; g++) {
    const s = E.newGame(modeKey, year, 1000 + g);
    let guard = 0;
    while (!s.over && guard++ < 2000) {
      const [t, r, c] = strategies[stratName](s);
      E.throwPitch(s, t, r, c);
    }
    agg.pa += s.stats.bf; agg.k += s.stats.k; agg.bb += s.stats.bb + s.stats.hbp; agg.h += s.stats.h; agg.hr += s.stats.hr;
    agg.runs += s.runs; agg.outs += s.stats.outs; agg.pitches += s.pitchCount; agg.games++;
    agg.results[s.result] = (agg.results[s.result] || 0) + 1;
    agg.gs += E.gameScore(s);
  }
  const inn = agg.outs / 3;
  const pct = (x) => (100 * x).toFixed(1) + '%';
  const res = Object.entries(agg.results).map(([k, v]) => `${k} ${pct(v / agg.games)}`).join(' ');
  console.log(`${stratName.padEnd(8)} ${modeKey} ${year}: R/9 ${(agg.runs / inn * 9).toFixed(2)}  K% ${pct(agg.k / agg.pa)}  BB% ${pct(agg.bb / agg.pa)}  H/9 ${(agg.h / inn * 9).toFixed(1)}  HR/9 ${(agg.hr / inn * 9).toFixed(2)}  P/IP ${(agg.pitches / inn).toFixed(1)}  GS ${(agg.gs / agg.games).toFixed(1)}  ${res}`);
}

const N = +process.argv[2] || 2000;
const modes = (process.argv[3] || 'cg,hold').split(',');
for (const m of modes) for (const y of [2003, 2004]) for (const st of ['random', 'zoneOnly', 'learner', 'oracle']) run(st, N, m, y);
