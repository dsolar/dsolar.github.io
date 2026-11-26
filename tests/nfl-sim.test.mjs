// The saved NFL season simulation (tools/nfl_sim.js) must come back identical to running it on the page
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("../nfl/lib/season.js");

test("a saved simulation hydrates to the same result as a fresh run", () => {
  const T = Object.keys(S.divOf), games = [];
  for (let w = 1; w <= 18; w++) for (let i = 0; i < T.length; i += 2) {
    const a = T[(i + w) % T.length], h = T[(i + 1 + 3 * w) % T.length];
    if (a === h) continue;
    games.push(w <= 12 ? ["REG", w, "", a, h, 17 + (i % 9), 20 + (w % 7), -2.5, 0, 0] : ["REG", w, "", a, h, null, null, w % 2 ? 3 : null, 0, 0]);
  }
  const fresh = S.simulate(games, T, { sims: 300 });
  const saved = S.simulate(games, T, { sims: 300 }); delete saved.winP; delete saved.left;
  const back = S.hydrate(JSON.parse(JSON.stringify({ sim: saved })), games);
  assert.deepEqual(JSON.parse(JSON.stringify(back.teams)), JSON.parse(JSON.stringify(fresh.teams)));
  assert.equal(back.left.length, fresh.left.length);
  for (const g of fresh.left) assert.equal(back.winP.get(g), fresh.winP.get(g));
  assert.equal(S.gamesKey(games), S.gamesKey(JSON.parse(JSON.stringify(games))));
  assert.notEqual(S.gamesKey(games), S.gamesKey(games.slice(1)));
});
