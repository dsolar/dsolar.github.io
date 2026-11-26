#!/usr/bin/env node
/* The NFL Hub's season simulation, run here instead of on every visitor's phone (6,000 seasons was the hub's
   biggest stall on load). Same library, seed and game list as the page (nfl/lib/season.js), so the numbers match
   exactly. Writes nfl/data/sim.json, keyed to the games it ran on; the page uses it only when the key matches its
   own games and runs the simulation itself otherwise. Run after anything that rewrites nfl/data/league.json. */
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const S = require(path.join(ROOT, "nfl/lib/season.js"));
const L = JSON.parse(fs.readFileSync(path.join(ROOT, "nfl/data/league.json"), "utf8"));
const games = L.games || [], SIMS = 6000;
const sim = S.simulate(games, Object.keys(S.divOf), { sims: SIMS });
delete sim.winP; delete sim.left;                       // the page rebuilds these from its own game rows
const out = path.join(ROOT, "nfl/data/sim.json");
fs.writeFileSync(out, JSON.stringify({ key: S.gamesKey(games), sims: SIMS, updated: L.updated, sim }));
console.log("nfl sim:", SIMS, "seasons,", fs.statSync(out).size, "bytes");
