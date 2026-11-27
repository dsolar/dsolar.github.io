import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const S = require('../nfl/lib/season.js');
const data = JSON.parse(readFileSync(new URL('../nfl/data/games.json', import.meta.url), 'utf8'));
const GAMES = data.games || data, TEAMS = Object.keys(S.divOf);

// play every game but the last week, at random, then check the marks against every way the last week can go
function lateSeason(seed) {
  let s = seed; const r = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const last = Math.max(...GAMES.filter((g) => g[0] === 'REG').map((g) => g[1]));
  const games = GAMES.map((g) => (g[0] === 'REG' && g[5] == null && g[1] < last ? Object.assign(g.slice(), { 5: r() < 0.5 ? 20 : 17, 6: r() < 0.5 ? 24 : 10 }) : g.slice()));
  return { games, open: games.filter((g) => g[0] === 'REG' && g[5] == null) };
}

test('playoff picture: seven seeds a conference, division winners first', () => {
  const P = S.picture(GAMES, TEAMS);
  for (const c of ['AFC', 'NFC']) {
    assert.equal(P[c].seeds.length, 7);
    const divs = P[c].seeds.slice(0, 4).map((t) => S.divOf[t]);
    assert.equal(new Set(divs).size, 4, 'one winner from each division');
    assert.equal(P[c].seeds.length + P[c].hunt.length + P[c].out.length, 16);
  }
});

test('playoff picture: z, y, x and e hold in every way the last week can go', () => {
  let marked = 0;
  for (const seed of [3, 11]) {
    const { games, open } = lateSeason(seed);
    const P = S.picture(games, TEAMS), marks = Object.entries(P.marks);
    marked += marks.length;
    if (!marks.length) continue;
    assert.ok(open.length <= 16, 'one week left');
    for (let m = 0; m < 1 << open.length; m++) {
      open.forEach((g, k) => { const aw = (m >> k) & 1; g[5] = aw ? 27 : 13; g[6] = aw ? 13 : 27; });
      const F = S.picture(games, TEAMS);
      for (const [t, mk] of marks) {
        const sd = F[S.confOf[t]].seeds, at = sd.indexOf(t);
        if (mk === 'z') assert.equal(at, 0, `${t} z`);
        if (mk === 'y') assert.ok(at >= 0 && at < 4, `${t} y`);
        if (mk === 'x') assert.ok(at >= 0, `${t} x`);
        if (mk === 'e') assert.equal(at, -1, `${t} e`);
      }
    }
    open.forEach((g) => { g[5] = null; g[6] = null; });
  }
  assert.ok(marked > 0, 'some team was marked');
});
