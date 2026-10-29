/* Checks Journeyman's data. Run from the repo root: node tools/journeyman_check.js */
global.window = global;
require("../journeyman/data.js");
require("../guess-the-pick/names.js");
require("../journeyman/names-mlb.js");
const G = require("../guess-the-pick/engine.js");
const D = window.JM_DATA;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("FAIL", msg); } };
const path = (sport, name) => {
  const p = D[sport].find(x => x.n === name);
  return p ? p.s.map(s => D[sport + "_teams"][s[0]][0]).join(">") : "";
};
for (const sport of ["nba", "nfl", "mlb"]) {
  const players = D[sport], teams = D[sport + "_teams"];
  ok(players.length >= 300, `${sport}: at least 300 players (has ${players.length})`);
  players.forEach(p => {
    ok(p.n && p.line && p.h.length === 3 && p.s.length >= 4 && p.fr >= 4, `${sport} ${p.n}: complete, 4+ franchises`);
    ok(p.s.every((s, k) => teams[s[0]] && s[1] <= s[2] && (k === 0 || p.s[k - 1][1] <= s[1])), `${sport} ${p.n}: stops in order`);
    ok(p.s.every((s, k) => k === 0 || teams[p.s[k - 1][0]][0] !== teams[s[0]][0]), `${sport} ${p.n}: no repeated stop back to back`);
    ok(!/—/.test(p.n + p.line + JSON.stringify(p.h)), `${sport} ${p.n}: no em dashes`);
    ok(p.s[p.s.length - 1][2] >= 2000, `${sport} ${p.n}: career ended 2000 or later`);
  });
  teams.forEach(t => ok(/^#[0-9A-F]{6}$/i.test(t[2]) && /^#[0-9A-F]{6}$/i.test(t[3]), `${sport} ${t[1]}: has colors`));
  const pool = G.pool(players, window.GTP_NAMES[sport]);
  ok(players.every(p => pool.byKey[G.norm(p.n)]), `${sport}: every answer is in the guess box`);
  const a = G.daily(players, "jm-" + sport, new Date("2026-10-28T14:00:00Z"));
  ok(a.length === 10 && new Set(a).size === 10, `${sport}: daily has ten different players`);
}
ok(path("nba", "Jamal Crawford").startsWith("CHI>NYK>GSW>ATL>POR>LAC>MIN>PHO>BRK"), "Jamal Crawford's path");
ok(path("nfl", "Ryan Fitzpatrick") === "STL>CIN>BUF>TEN>HOU>NYJ>TB>MIA>WAS", "Ryan Fitzpatrick's path");
ok(path("mlb", "Edwin Jackson").split(">").length >= 14, "Edwin Jackson has his 14 teams");
ok(path("nfl", "Adrian Peterson").startsWith("MIN>NO>ARI"), "Adrian Peterson's Vikings years are one stop");
const mp = G.pool(D.mlb, window.GTP_NAMES.mlb), jd = D.mlb.find(p => p.n === "J. D. Martinez");
ok(jd && G.judge("JD Martinez", jd, mp) === "right", "JD Martinez matches J. D. Martinez");
console.log(fails ? `${fails} check(s) failed` : "All Journeyman checks passed");
process.exit(fails ? 1 : 0);
