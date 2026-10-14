#!/usr/bin/env node
// Save each week's opening odds to guillotine/history.json.
//
// Runs after the data pull. Until the week's first game kicks off, every run refreshes that week's
// snapshot (rosters and projections settle as waivers clear); once a game has started the snapshot
// is frozen, so it holds the odds going into the week. It also records who was actually cut each
// week, which lets the page show movers week to week and what the model gave each casualty.
//
//   node tools/guillotine_snapshot.js [--today YYYY-MM-DD]
"use strict";
const fs = require("fs");
const path = require("path");
const Sim = require("../guillotine/sim.js");

const DATA = path.join(__dirname, "..", "guillotine", "data.json");
const HIST = path.join(__dirname, "..", "guillotine", "history.json");
const r4 = (x) => Math.round(x * 10000) / 10000;
const r1 = (x) => Math.round(x * 10) / 10;

const arg = process.argv.indexOf("--today");
const today = arg > 0 ? process.argv[arg + 1]
  : new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()); // YYYY-MM-DD

const data = JSON.parse(fs.readFileSync(DATA, "utf8"));
const hist = fs.existsSync(HIST) ? JSON.parse(fs.readFileSync(HIST, "utf8")) : { weeks: {} };
const before = JSON.stringify(hist);
const wk = String(data.week);

// Record each elimination on the week it happened.
for (const t of data.teams || []) {
  if (!t.out) continue;
  const w = (hist.weeks[String(t.out)] = hist.weeks[String(t.out)] || {});
  w.cut_team = t.name;
  if (typeof t.cut === "number") w.cut_score = t.cut;
}

// Has the week started? A finished game on any roster, or the first game's date has arrived.
const alive = (data.teams || []).filter((t) => !t.out);
const dates = alive.flatMap((t) => (t.roster || []).map((p) => p.date).filter(Boolean)).sort();
const started = alive.some((t) => (t.roster || []).some((p) => p.final)) || (dates.length && today >= dates[0]);

const entry = hist.weeks[wk] || {};
if (!entry.frozen) {
  const sim = Sim.simulate(data, { pregame: true });
  const teams = {};
  for (const t of sim.teams) {
    teams[t.name] = { chop: r4(t.pChop), win: r4(t.pWin), expected: r1(t.now), surv: t.surv.map(r4) };
    if (t.faab !== null) teams[t.name].faab = t.faab;
  }
  const odds = { teams, cut_line: sim.cut.median != null ? r1(sim.cut.median) : null };
  const same = JSON.stringify({ teams: entry.teams, cut_line: entry.cut_line }) === JSON.stringify(odds);
  Object.assign(entry, odds);
  if (!same || !entry.taken) entry.taken = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  if (started) entry.frozen = true;
  hist.weeks[wk] = entry;
}

// Keep weeks in order in the file.
hist.weeks = Object.fromEntries(Object.entries(hist.weeks).sort((a, b) => +a[0] - +b[0]));
const after = JSON.stringify(hist);
if (after === before) {
  console.log(`Week ${wk} snapshot unchanged${entry.frozen ? " (frozen)" : ""}.`);
} else {
  fs.writeFileSync(HIST, JSON.stringify(hist, null, 1) + "\n");
  console.log(`Saved week ${wk} odds${entry.frozen ? " and froze them (the week has started)" : ""}.`);
}
