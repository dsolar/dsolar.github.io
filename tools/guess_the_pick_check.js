/* Checks Guess the Pick's data and rules. Run from the repo root: node tools/guess_the_pick_check.js */
global.window = global;
require("../guess-the-pick/data.js");
const G = require("../guess-the-pick/engine.js");
const D = window.GTP_DATA;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("FAIL", msg); } };
const find = (sport, y, p) => D[sport].findIndex(x => x.y === y && x.p === p);

for (const sport of ["nba", "nfl"]) {
  const picks = D[sport];
  const years = new Set(picks.map(p => p.y));
  ok(years.size === 20, `${sport}: 20 drafts (has ${years.size})`);
  for (const y of years) {
    const first = picks.filter(p => p.y === y && p.r === 1).length;
    ok(first >= (sport === "nba" ? 29 : 31), `${sport} ${y}: a full first round (has ${first})`);
  }
  picks.forEach((p, i) => {
    ok(p.n && p.tn && p.line && p.p > 0 && p.rp > 0 && p.r > 0, `${sport} pick ${i} has every field`);
    ok(!p.to || p.ton, `${sport} ${p.y} #${p.p}: a "went to" team has a name`);
    ok(!/—/.test(p.line + p.n + p.col), `${sport} ${p.y} #${p.p}: no em dashes`);
  });

  // The daily ten: ten different picks from ten different drafts, the same all day
  const pool = G.pool(picks);
  const a = G.daily(picks, sport, new Date("2026-10-28T14:00:00Z")), b = G.daily(picks, sport, new Date("2026-10-29T03:30:00Z"));
  ok(a.length === 10 && new Set(a).size === 10, `${sport}: daily has ten different picks`);
  ok(new Set(a.map(i => picks[i].y)).size === 10, `${sport}: daily picks come from ten drafts`);
  ok(a.join() === b.join(), `${sport}: 11:30pm in Boston is still the same day`);
  ok(a.join() !== G.daily(picks, sport, new Date("2026-10-30T14:00:00Z")).join(), `${sport}: a new day, a new ten`);
  const seen = [];
  for (let k = 0; k < 50; k++) { const i = G.endless(picks, seen); ok(!seen.includes(i), `${sport}: endless doesn't repeat`); seen.push(i); }
}

// Famous picks, straight from the record
const nba = D.nba, nfl = D.nfl;
const luka = nba[find("nba", 2018, 3)], jokic = nba[find("nba", 2014, 41)], kd = nba[find("nba", 2007, 2)];
ok(luka.n === "Luka Dončić" && luka.t === "ATL" && luka.to === "DAL", "Luka: picked by Atlanta, went to Dallas");
ok(nba[find("nba", 2018, 5)].to === "ATL", "Trae Young went to Atlanta");
ok(jokic.n === "Nikola Jokić" && jokic.r === 2 && jokic.rp === 11 && !jokic.to, "Jokic: Denver, round 2, pick 11");
ok(kd.tn === "Seattle SuperSonics" && !kd.to, "Durant: a Sonic, and OKC isn't a move");
ok(nba[find("nba", 2011, 15)].to === "SAS", "Kawhi went to San Antonio");
ok(nfl[find("nfl", 2012, 1)].n === "Andrew Luck", "2012 NFL #1: Andrew Luck");
ok(nfl[find("nfl", 2017, 10)].n === "Patrick Mahomes", "2017 NFL #10: Patrick Mahomes");
ok(nfl[find("nfl", 2022, 262)].n === "Brock Purdy", "Mr. Irrelevant 2022: Brock Purdy");
ok(nfl[find("nfl", 2007, 1)].tn === "Oakland Raiders", "2007 Raiders were in Oakland");
ok(nfl.find(p => p.y === 2015 && p.t === "WAS").tn === "Washington Redskins", "Washington's name by year");

// Guessing
const np = G.pool(nba);
ok(G.norm("Luka Dončić") === "luka doncic" && G.norm("Jaren Jackson Jr.") === "jaren jackson", "names normalize");
ok(G.judge("luka doncic", luka, np) === "right", "full name, no accents");
ok(G.judge("Dončić", luka, np) === "right", "a last name nobody else has");
ok(G.judge("Trae Young", luka, np) === "wrong", "a real player, just not this one");
ok(G.judge("Lukaa Doncic", luka, np) === "unknown", "a typo isn't a wrong guess");
const green = nba[find("nba", 2012, 35)];
ok(G.judge("Green", green, np) === "unknown" || G.judge("Green", green, np) === "wrong", "a shared last name isn't enough");
ok(G.suggest("jok", np, 6)[0] === "Nikola Jokić", "suggestions: jok finds Jokic first");
ok(G.suggest("ka le", np, 6).includes("Kawhi Leonard"), "suggestions match any word start");

console.log(fails ? `${fails} check(s) failed` : "All Guess the Pick checks passed");
process.exit(fails ? 1 : 0);
