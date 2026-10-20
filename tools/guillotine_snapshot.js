#!/usr/bin/env node
// Save each week's opening odds to guillotine/history.json, plus every team's score once a week is over.
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

// Every team's score each finished week, and the closest chop: the gap between the team that got cut and
// the lowest team that survived. Yahoo's pull carries weekly scores (t.scores, first week first); the pasted
// league page only has season totals, so there each score is the change in season points between the
// last update of one week and the first update of the next (Yahoo's season total already counts the
// points scored so far, which the paste records as t.points).
const r2 = (x) => Math.round(x * 100) / 100;
function recordWeek(w, scores, overwrite) {
  const e = (hist.weeks[String(w)] = hist.weeks[String(w)] || {});
  if (e.scores && !overwrite) return;
  e.scores = scores;
  const cut = (data.teams || []).find((t) => t.out === w);
  const cutScore = cut ? (typeof scores[cut.name] === "number" ? scores[cut.name] : cut.cut) : null;
  const rest = Object.keys(scores).filter((n) => !cut || n !== cut.name).sort((a, b) => scores[a] - scores[b]);
  if (cut && typeof cutScore === "number" && rest.length && scores[rest[0]] >= cutScore) {
    e.next_team = rest[0];
    e.next_score = scores[rest[0]];
  }
}
const first = data.first_week || 1;
if ((data.teams || []).some((t) => Array.isArray(t.scores))) {
  for (let w = first; w < data.week; w++) {
    const scores = {};
    for (const t of data.teams) {
      const s = (t.scores || [])[w - first];
      if (typeof s === "number" && (!t.out || t.out >= w)) scores[t.name] = r2(s);
    }
    if (Object.keys(scores).length > 1) recordWeek(w, scores, true);
  }
} else {
  const seen = hist.last_seen;
  if (seen && seen.week === data.week - 1) {
    const scores = {};
    for (const t of data.teams || []) {
      const s = seen.teams[t.name];
      if (s && typeof t.season_pts === "number") scores[t.name] = r2(t.season_pts - s.season + (s.points || 0));
    }
    if (Object.keys(scores).length > 1) recordWeek(seen.week, scores, false);
  }
}
// Remember where each team's season total stands, for next week's scores.
if (alive.some((t) => typeof t.season_pts === "number")) {
  const teams = {};
  for (const t of alive) if (typeof t.season_pts === "number") teams[t.name] = { season: t.season_pts, points: t.points || 0 };
  hist.last_seen = { week: data.week, teams };
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
