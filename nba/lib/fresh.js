/* NBA Hub data freshness: when each feed last updated, and which have gone quiet. Shared by the page (a banner and the
   How it works list) and tools/nba_fresh.mjs (the daily check that fails, and so emails, when a feed is stale).
   No DOM. */
(function (root) {
  "use strict";
  // [label, file, read its timestamp, days before it counts as stale, which workflow refreshes it]
  const FEEDS = [
    ["Rosters", "hardcap/stats.json", j => j.rostersUpdated, 2, "hardcap-stats"],
    ["Box scores and minutes", "hardcap/stats.json", j => j.last, 5, "hardcap-stats"],   // 5: Thanksgiving and other off days
    ["Injuries", "hardcap/stats.json", j => j.injUpdated, 2, "hardcap-stats"],
    ["Contracts", "hardcap/stats.json", j => j.contractsUpdated, 7, "hardcap-stats"],
    ["Standings and live games", "celtics/live.json", j => j.updated, 2, "nba-live"],
    ["DARKO", "nba/data/darko.json", j => j.pulled, 3, "nba-darko"],
    ["Skill ratings", "nba/data/ratings.json", j => j.updated, 2, "nba-ratings"],
    ["Lineups and on/off", "nba/data/lineups.json", j => j.updated, 2, "nba-lineups"],
    ["Draft Big Board", "draft/nba.json", j => j.updated, 3, "draft-board"],
    ["Ringer Top 100", "nba/data/ringer100.json", j => j.updated, 60, "nba-ringer"],   // the Ringer reshuffles every few weeks: warns only
  ];
  // The NFL Hub's feeds (nfl/app.js loads the same helper)
  const NFL = [
    ["Rosters, contracts, snaps and stats", "nfl/data/league.json", j => j.updated, 2, "nfl-hub"],
    ["Player rating", "nfl/data/rating.json", j => j.built, 9, "nfl-hub"],                      // rebuilt Mondays
    ["Team cap figures", "nfl/data/teamcap.json", j => j.asOf, 30, "otc"],                       // Over The Cap, every week or two: warns only
    ["Draft Big Board", "draft/nfl.json", j => j.updated, 3, "draft-board"],
  ];
  // Site-wide feeds the daily check also watches
  const SITE = [
    ["Player faces", "assets/faces/report.json", j => j.built, 3, "faces"],
  ];
  const day = s => { const t = Date.parse(/^\d{4}-\d\d-\d\d$/.test(s) ? s + "T12:00:00Z" : s); return isNaN(t) ? null : t; };
  // files: { "hardcap/stats.json": parsed JSON, ... }; now: ms. Returns every feed with its age, stale ones flagged.
  // Game feeds go quiet in the offseason (July to mid-October) and over the All-Star break, so they only count in season.
  function inSeason(now) {
    const d = new Date(now), m = d.getUTCMonth() + 1, dd = d.getUTCDate();
    if (m >= 7 && m <= 9) return false;
    if (m === 10 && dd < 25) return false;
    if (m === 2 && dd >= 12 && dd <= 19) return false;
    return true;
  }
  const GAME = new Set(["Box scores and minutes", "Standings and live games", "Skill ratings", "Lineups and on/off", "DARKO"]);
  function check(files, now, list) {
    now = now || Date.now();
    const season = inSeason(now);
    return (list || FEEDS).map(([label, file, get, max, how]) => {
      const j = files[file], s = j ? get(j) : null, t = s ? day(s) : null;
      const age = t == null ? null : (now - t) / 864e5;
      const off = GAME.has(label) && !season;
      // a feed updated by hand only warns; the automatic ones fail the daily check
      return { label, file, when: s || null, age, max, how, manual: how === "by hand" || how === "nba-ringer" || how === "otc", stale: !off && (age == null || age > max), missing: !j };
    });
  }
  const api = { FEEDS, NFL, SITE, check, files: [...new Set(FEEDS.map(f => f[1]))], nflFiles: [...new Set(NFL.map(f => f[1]))], siteFiles: [...new Set(SITE.map(f => f[1]))] };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Fresh = api;
})(typeof self !== "undefined" ? self : this);
