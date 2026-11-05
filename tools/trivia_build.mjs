// Builds the data-made trivia questions in fantasy-kit/trivia.js (the BUILT block) from two of the site's own games:
//   journeyman/data.js     players' careers, team by team (Journeyman), with college and birthplace
//   guess-the-pick/data.js every first-round pick since 2007 (Guess the Pick), with the team and college
// Only well-known players (each game's fame score), and only questions with one right answer:
//   Which of these teams did he never play for?     three he played for, and one franchise he never did
//   Which team did he start his career with?        his first team, against three that existed that year
//   Where did he play college ball?                 his school, against three other stars' schools
//   Where was he born? (baseball, outside the U.S.)
//   Who was the first pick in the YEAR draft?       against picks 2 to 5
//   Which team drafted him in YEAR?                 (not a pick traded on draft night)
// Run: node tools/trivia_build.mjs   (after either game's data is rebuilt)
import { readFileSync, writeFileSync } from "node:fs";
const ROOT = new URL("../", import.meta.url);
const load = (path, key) => { const window = {}; new Function("window", readFileSync(new URL(path, ROOT), "utf8"))(window); return window[key]; };
const J = load("journeyman/data.js", "JM_DATA"), G = load("guess-the-pick/data.js", "GTP_DATA");

// a seeded shuffle, so a rebuild with the same data gives the same questions
let seed = 20261105;
const rand = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a, n) => shuffle(a).slice(0, n);

// teams that moved or were renamed are one franchise: a Seattle SuperSonic "played for" the Thunder
const FRANCHISE = {
  nba: { SEA: "OKC", NJN: "BRK", WSB: "WAS", CHH: "HORNETS", CHA: "HORNETS", CHO: "HORNETS", NOH: "HORNETS", NOK: "HORNETS", NOP: "HORNETS", SDC: "LAC", KCK: "SAC", VAN: "MEM" },
  nfl: { OAK: "LV", RAI: "LV", STL: "LAR", LA: "LAR", RAM: "LAR", SD: "LAC", PHO: "ARI", HOI: "TEN" },
  mlb: { MON: "WAS", FLO: "MIA", ANA: "LAA", CAL: "LAA", ML4: "MIL", TBA: "TBA" },
};
const fr = (sport, abbr) => FRANCHISE[sport][abbr] || abbr;
const SPORT = { nba: "basketball", nfl: "football", mlb: "baseball" };

const out = { nba: [], nfl: [], mlb: [] };
const add = (sport, q) => { if (new Set([q.a].concat(q.w)).size === 4) out[sport].push(q); };

for (const sport of ["nba", "nfl", "mlb"]) {
  const teams = J[`${sport}_teams`], players = J[sport];
  // when each team name was in use, from everyone's stints
  const span = teams.map(() => [9999, 0]);
  for (const p of players) for (const [t, a, b] of p.s) { span[t][0] = Math.min(span[t][0], a); span[t][1] = Math.max(span[t][1], b); }
  const existed = (t, y) => span[t][0] <= y && y <= span[t][1];
  const famous = players.filter((p) => p.f >= 0.8);
  for (const p of famous) {
    const mine = new Set(p.s.map(([t]) => fr(sport, teams[t][0])));
    const played = [...new Set(p.s.map(([t]) => t))];
    const first = p.s.slice().sort((x, y) => x[1] - y[1])[0], last = Math.max(...p.s.map((s) => s[2]));
    // one team name per franchise, among the names in use during his career
    const others = (y0, y1) => {
      const by = {};
      teams.forEach((t, i) => { const f = fr(sport, t[0]); if (!mine.has(f) && span[i][1] >= y0 && span[i][0] <= y1 && !by[f]) by[f] = t[1]; });
      return Object.values(by);
    };
    if (played.length >= 3) {
      const never = others(first[1], last);
      if (never.length) add(sport, { id: `jm-never:${p.n}`, q: `Which of these teams did ${p.n} never play for?`, a: pick(never, 1)[0], w: pick(played.map((t) => teams[t][1]).filter((x, i, a) => a.indexOf(x) === i), 3) });
    }
    const wrong = others(first[1], first[1]).filter((n) => teams.some((t, i) => t[1] === n && existed(i, first[1])));
    if (wrong.length >= 3) add(sport, { id: `jm-first:${p.n}`, q: `Which team did ${p.n} start his career with?`, a: teams[first[0]][1], w: pick(wrong, 3) });
    const col = (p.h.find((x) => x[0] === "College") || [])[1];
    if (col) {
      const norm = (c) => c.replace(/\s+St\.$/, " State");
      const pool = [...new Set(famous.map((x) => (x.h.find((y) => y[0] === "College") || [])[1]).filter((c) => c && norm(c) !== norm(col)).map(norm))];
      if (pool.length >= 3) add(sport, { id: `jm-col:${p.n}`, q: `Where did ${p.n} play college ${SPORT[sport]}?`, a: norm(col), w: pick(pool, 3) });
    }
    const born = (p.h.find((x) => x[0] === "Born") || [])[1];
    const COUNTRY = { "D.R.": "Dominican Republic", "P.R.": "Puerto Rico", Venezuela: "Venezuela", Cuba: "Cuba", "Curaçao": "Curaçao", CAN: "Canada", "México": "Mexico", Panama: "Panama", Colombia: "Colombia", Japan: "Japan", "South Korea": "South Korea" };
    const c = born && COUNTRY[born.split(", ").pop()];
    if (sport === "mlb" && c) add(sport, { id: `jm-born:${p.n}`, q: `Where was ${p.n} born?`, a: c, w: pick(["Dominican Republic", "Venezuela", "Puerto Rico", "Cuba", "Mexico", "Japan", "Canada", "Panama"].filter((x) => x !== c), 3) });
  }
}

for (const sport of ["nba", "nfl"]) {
  const picks = G[sport], label = sport.toUpperCase();
  const byYear = {};
  for (const p of picks) (byYear[p.y] = byYear[p.y] || []).push(p);
  for (const [y, ps] of Object.entries(byYear)) {
    const one = ps.find((p) => p.p === 1), next = ps.filter((p) => p.p >= 2 && p.p <= 5);
    if (one && next.length >= 3) add(sport, { id: `gtp-p1:${y}`, q: `Who was the first pick in the ${y} ${label} Draft?`, a: one.n, w: pick(next.map((p) => p.n), 3) });
  }
  for (const p of picks.filter((x) => x.f >= (sport === "nba" ? 0.4 : 0.7) && !x.to && x.tn)) {
    const teamsThatYear = [...new Set(byYear[p.y].map((x) => x.tn).filter((n) => n !== p.tn))];
    if (teamsThatYear.length >= 3) add(sport, { id: `gtp-team:${p.n}`, q: `Which team drafted ${p.n} in ${p.y}?`, a: p.tn, w: pick(teamsThatYear, 3) });
    if (p.col && !out[sport].some((q) => q.id === `jm-col:${p.n}`)) {
      const cols = [...new Set(picks.filter((x) => x.f >= 0.3 && x.col && x.col !== p.col).map((x) => x.col))];
      add(sport, { id: `gtp-col:${p.n}`, q: `Which school did ${p.n} come out of in the ${p.y} draft?`, a: p.col, w: pick(cols, 3) });
    }
  }
}

// written into fantasy-kit/trivia.js between the markers
const file = new URL("fantasy-kit/trivia.js", ROOT), src = readFileSync(file, "utf8");
const START = "/* BUILT: tools/trivia_build.mjs */", END = "/* END BUILT */";
const i = src.indexOf(START), j = src.indexOf(END);
if (i < 0 || j < 0) throw new Error("trivia.js has no BUILT block");
const body = `${START}\n  const BUILT = ${JSON.stringify(out)};\n  ${END}`;
writeFileSync(file, src.slice(0, i) + body + src.slice(j + END.length));
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])));
