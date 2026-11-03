/* Real trade-ups run through the mock draft's pricing, so tweaks to pick values don't drift from what teams
   actually pay. Each trade is priced as if it happened in the 2027 draft: picks at the same slots, next year's
   picks one year out, an average team's future pick at the middle of the round.
   Run: node tools/draft_trades_test.js  (exits 1 if a trade lands outside its range) */
const fs = require("fs");
const path = require("path");
const E = require("../draft/engine.js");

const root = path.join(__dirname, "..");
const load = (lg) => { const D = JSON.parse(fs.readFileSync(path.join(root, "draft", lg + ".json"), "utf8")); D.chart = "jj"; return D; };

// A pick this year: a number. A future pick: [yearsOut, round, protection, team] where team is "bad" (a pick
// that projected near the top when traded) or left out for an average team.
const TRADES = {
  nfl: [
    { name: "Rams 15 to 1 (2016)", give: [15, 43, 45, 76, [1, 1], [1, 3]], get: [1, 113, 177] },
    { name: "Eagles 8 to 2 (2016)", give: [8, 77, 100, [1, 1], [2, 2]], get: [2, [1, 4]] },
    { name: "Bears 3 to 2 (2017)", give: [3, 67, 111, [1, 3]], get: [2] },
    { name: "Chiefs 27 to 10 (2017)", give: [27, 91, [1, 1]], get: [10] },
    { name: "Jets 6 to 3 (2018): three 2nds, rich", lo: 1.1, hi: 1.35, give: [6, 37, 49, [1, 2]], get: [3] },
    { name: "Bills 12 to 7 (2018): two 2nds, rich", lo: 1.1, hi: 1.35, give: [12, 53, 56], get: [7, 255] },
    { name: "49ers 12 to 3 (2021)", give: [12, [1, 1], [1, 3], [2, 1]], get: [3] },
    { name: "Panthers 9 to 1 (2023), before DJ Moore", give: [9, 61, [1, 1], [2, 2]], get: [1], lo: 0.7 },
    { name: "Jaguars 5 to 2 (2025)", give: [5, 36, 126, [1, 1]], get: [2, 104, 200] }
  ],
  nba: [
    { name: "76ers 3 to 1 (2017), Lakers 1st top-1 protected", give: [3, [1, 1, "1-1", "bad"]], get: [1] },
    { name: "Mavericks 5 to 3 (2018)", give: [5, [1, 1, "1-5", "bad"]], get: [3] },
    { name: "Hawks 8 to 4 (2019): a rich price", give: [8, 17, 35, [1, 1, "1-10"]], get: [4], lo: 1.1, hi: 1.6 },
    { name: "Pelicans 23 to 13 (2025): the overpay", give: [23, [1, 1, "", "bad"]], get: [13], lo: 1.3, hi: 3 }
  ]
};

let bad = 0;
for (const lg of ["nfl", "nba"]) {
  const D = load(lg);
  const year = D.year || 2027;
  const val = (x) => {
    if (typeof x === "number") return E.pickValue(D, x);
    const [k, rd, prot, team] = x;
    const orig = team === "bad" ? D.order.picks.find((p) => p[1] === 1 && p[0] === 5)[3] : "AVG";
    return E.futureValue(D, { orig, year: year + k, rd, prot: prot || "" });
  };
  console.log(`\n${lg.toUpperCase()} (${lg === "nfl" ? "Jimmy Johnson" : "Big Board NBA curve"})`);
  for (const t of TRADES[lg]) {
    const give = t.give.reduce((s, x) => s + val(x), 0);
    const get = t.get.reduce((s, x) => s + val(x), 0);
    const r = give / get, lo = t.lo || 0.9, hi = t.hi || 1.25;
    const ok = r >= lo && r <= hi;
    if (!ok) bad++;
    console.log(`${ok ? "ok " : "OFF"} ${(100 * r).toFixed(0).padStart(4)}%  ${t.name}  (want ${Math.round(lo * 100)}-${Math.round(hi * 100)}%)`);
  }
}
console.log(bad ? `\n${bad} trade(s) out of range` : "\nAll in range");
process.exit(bad ? 1 : 0);
