/* Fantasy Kit: one-week slates. A slate is the set of real games a one-week league drafts from and plays: the whole
   week, Sunday's day games, the night games, one game (a showdown) or games you pick. The schedule comes from the
   live feed (cloud.slates(): this NFL week and next, each game { id, at, away, home, state }).

   FK.slates:
     open(week, now)           the games in a week that haven't kicked off (10 minutes' notice)
     list(week, now)           the slates you can start: [{ key, kind, label, sub, games }]
     pick(week, kind, ids, now) one slate, ready for a draft's season: { kind, label, week, games, teams, first, last }
     lineup(n, teams)          the starting lineup a slate of n games supports: { lineup, bench, mult, note }
     et(iso)                   { wd, h, m } in New York (0 is Sunday)
     kick(iso)                 "Thu 8:15 PM"

   One-day slates (basketball): the feed (cloud.slates("nba")) has today's and tomorrow's games, each day shaped like a
   week with a day ({ day, start, end, games }). list, pick and open read a day the same way, with a day's own slates:
   the main slate (every game), the early and late games, one game (a showdown) or games you pick. A day slate carries
   { sport, day } and no week. lineup(n, teams, "nba") gives basketball's lineups. dayName(day) is "Tonight",
   "Tomorrow" or "Fri, Nov 14". word(sport) is how a game starts: "kicks off" or "tips off".
*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.FK = root.FK || {}).slates = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const ET_FMT = typeof Intl !== "undefined" ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit", hour12: false }) : null;
  function et(iso) {
    const d = new Date(iso);
    if (!ET_FMT) return { wd: d.getUTCDay(), h: d.getUTCHours(), m: d.getUTCMinutes() };
    const p = Object.fromEntries(ET_FMT.formatToParts(d).map((x) => [x.type, x.value]));
    return { wd: DAYS.indexOf(p.weekday), h: Number(p.hour) % 24, m: Number(p.minute) };
  }
  const kick = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });
  const open = (week, now = Date.now()) => ((week && week.games) || []).filter((g) => (g.state || "pre") === "pre" && Date.parse(g.at) > now + 10 * 60e3);
  // night games: Thursday, Sunday and Monday nights (and any other weekday night game)
  const night = (g) => { const t = et(g.at); return (t.wd === 0 && t.h >= 19) || (t.wd !== 0 && t.wd !== 6) || (t.wd === 6 && t.h >= 19); };
  const sunday = (g) => { const t = et(g.at); return t.wd === 0 && t.h < 19; };
  const days = (gs) => { const ds = [...new Set(gs.map((g) => et(g.at).wd))]; const order = [4, 5, 6, 0, 1, 2, 3]; ds.sort((a, b) => order.indexOf(a) - order.indexOf(b)); return ds.map((d) => DAYS[d]); };
  const gamesN = (n) => `${n} game${n === 1 ? "" : "s"}`;
  function nightSub(gs) {
    const names = { 4: "Thursday", 0: "Sunday", 1: "Monday" }, ds = days(gs).map((d) => names[DAYS.indexOf(d)] || d);
    return `${ds.length > 1 ? `${ds.slice(0, -1).join(", ")} and ${ds[ds.length - 1]}` : ds[0]} night${ds.length > 1 ? "s" : ""}`;
  }
  const isDay = (w) => !!(w && w.day);
  const tip = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  const nyDay = (t) => new Date(t).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  function dayName(day, now = Date.now()) {
    if (day === nyDay(now)) return "Tonight";
    if (day === nyDay(now + 864e5)) return "Tomorrow";
    return new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
  }
  // a day's early games tip before 8 PM in New York; its late games at 9 PM or after (or past midnight)
  const early = (g) => et(g.at).h < 20 && et(g.at).h >= 6;
  const late = (g) => et(g.at).h >= 21 || et(g.at).h < 6;
  function dayList(w, now) {
    const gs = open(w, now), all = w.games || [];
    if (!gs.length) return [];
    const out = [], span = (x) => `${gamesN(x.length)}, ${tip(x[0].at)}${x.length > 1 && x[x.length - 1].at !== x[0].at ? ` to ${tip(x[x.length - 1].at)}` : ""}`;
    if (gs.length >= 2) out.push({ key: "full", kind: "full", label: gs.length < all.length ? "Rest of the night" : "Main slate", sub: span(gs), games: gs });
    const ea = gs.filter(early), la = gs.filter(late);
    if (ea.length >= 2 && ea.length < gs.length) out.push({ key: "early", kind: "early", label: "Early", sub: `${span(ea)}`, games: ea });
    if (la.length >= 2 && la.length < gs.length) out.push({ key: "late", kind: "late", label: "Late", sub: `${span(la)}`, games: la });
    out.push({ key: "one", kind: "one", label: "One game", sub: "A showdown: a captain at 1.5x and five flex", games: gs });
    out.push({ key: "custom", kind: "custom", label: "Pick your games", sub: "Any of the night's games", games: gs });
    return out;
  }
  function dayPick(w, kind, ids, now) {
    const gs = open(w, now), byId = Object.fromEntries(gs.map((g) => [g.id, g]));
    let games = kind === "full" ? gs : kind === "early" ? gs.filter(early) : kind === "late" ? gs.filter(late) : (ids || []).map((id) => byId[id]).filter(Boolean);
    if (kind === "one") games = games.slice(0, 1);
    if (!games.length) return null;
    games = games.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const name = games.length === 1 ? label(games[0]) : kind === "full" ? (games.length < (w.games || []).length ? "Rest of the night" : "Main slate")
      : kind === "early" ? "Early games" : kind === "late" ? "Late games" : "Your games";
    return {
      sport: w.sport || "nba", kind: games.length === 1 ? "one" : kind, label: name, day: w.day,
      games: games.map((g) => ({ id: g.id, at: g.at, away: g.away, home: g.home })),
      teams: [...new Set(games.flatMap((g) => [g.away, g.home]))],
      first: Date.parse(games[0].at), last: Date.parse(games[games.length - 1].at),
    };
  }
  function list(week, now = Date.now()) {
    if (isDay(week)) return dayList(week, now);
    const gs = open(week, now), all = (week && week.games) || [];
    if (!gs.length) return [];
    const out = [];
    const full = gs, sun = gs.filter(sunday), pr = gs.filter(night);
    if (full.length >= 2) out.push({ key: "full", kind: "full", label: full.length < all.length ? "Rest of the week" : "Full week", sub: `${gamesN(full.length)}, ${days(full)[0]} to ${days(full).slice(-1)[0]}`, games: full });
    if (sun.length >= 2 && sun.length < full.length) {
      const t = et(sun[0].at), early = t.h < 12;
      out.push({ key: "sunday", kind: "sunday", label: "Sunday", sub: `${gamesN(sun.length)}, ${early ? "from the morning game" : "1 PM"} to the late afternoon`, games: sun });
    }
    if (pr.length >= 2 && pr.length < full.length) out.push({ key: "prime", kind: "prime", label: "Primetime", sub: `${gamesN(pr.length)}: ${nightSub(pr)}`, games: pr });
    out.push({ key: "one", kind: "one", label: "One game", sub: "A showdown: a captain at 1.5x and five flex", games: gs });
    out.push({ key: "custom", kind: "custom", label: "Pick your games", sub: "Any games on the schedule", games: gs });
    return out;
  }
  const label = (g) => `${g.away} @ ${g.home}`;
  function pick(week, kind, ids, now = Date.now()) {
    if (isDay(week)) return dayPick(week, kind, ids, now);
    const gs = open(week, now), byId = Object.fromEntries(gs.map((g) => [g.id, g]));
    let games = kind === "full" ? gs : kind === "sunday" ? gs.filter(sunday) : kind === "prime" ? gs.filter(night)
      : (ids || []).map((id) => byId[id]).filter(Boolean);
    if (kind === "one") games = games.slice(0, 1);
    if (!games.length) return null;
    games = games.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const name = games.length === 1 ? label(games[0]) : kind === "full" ? (games.length < ((week && week.games) || []).length ? "Rest of the week" : "Full week")
      : kind === "sunday" ? "Sunday" : kind === "prime" ? "Primetime" : "Your games";
    return {
      kind: games.length === 1 ? "one" : kind, label: name, week: week.week,
      games: games.map((g) => ({ id: g.id, at: g.at, away: g.away, home: g.home })),
      teams: [...new Set(games.flatMap((g) => [g.away, g.home]))],
      first: Date.parse(games[0].at), last: Date.parse(games[games.length - 1].at),
    };
  }
  // A lineup the slate's players can fill for every team: one game is a showdown; two or three games, a captain and
  // five flex of any position; four to seven, one of each with fewer receivers; eight or more, the one-week lineup.
  // With more teams drafting than the slate has quarterbacks to start, the QB spot becomes a superflex.
  // Basketball, as DraftKings sets it: one game is a showdown, and so are two or three (a captain and five flex, plus a
  // bench spot), since that few teams' players can't fill eight real positions for a group; four or more start PG, SG,
  // SF, PF, C, a guard, a forward and a flex, with one bench spot.
  function nbaLineup(n) {
    if (n <= 1) return { lineup: ["CPT", "UTIL", "UTIL", "UTIL", "UTIL", "UTIL"], bench: 0, mult: { CPT: 1.5 }, note: "A captain at 1.5x and five flex of any position, no bench" };
    if (n <= 3) return { lineup: ["CPT", "UTIL", "UTIL", "UTIL", "UTIL", "UTIL"], bench: 1, mult: { CPT: 1.5 }, note: "A captain at 1.5x, five flex of any position and one bench spot" };
    return { lineup: ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"], bench: 1, mult: null, note: "PG, SG, SF, PF, C, a guard, a forward and a flex, one bench spot" };
  }
  function lineup(n, teams, sport) {
    if (sport === "nba") return nbaLineup(n);
    if (n <= 1) return { lineup: ["CPT", "UTIL", "UTIL", "UTIL", "UTIL", "UTIL"], bench: 0, mult: { CPT: 1.5 }, note: "A captain at 1.5x and five flex of any position, no bench" };
    if (n <= 3) return { lineup: ["CPT", "UTIL", "UTIL", "UTIL", "UTIL", "UTIL"], bench: 1, mult: { CPT: 1.5 }, note: "A captain at 1.5x, five flex of any position and one bench spot" };
    const qb = teams > 2 * n ? "SFLEX" : "QB";
    if (n <= 7) return { lineup: [qb, "RB", "RB", "WR", "WR", "TE", "FLEX"], bench: 1, mult: null, note: `${qb === "QB" ? "QB" : "Superflex"}, 2 RB, 2 WR, TE and a flex, one bench spot` };
    return { lineup: [qb, "RB", "RB", "WR", "WR", "WR", "TE", "FLEX"], bench: 2, mult: null, note: `${qb === "QB" ? "QB" : "Superflex"}, 2 RB, 3 WR, TE and a flex, two bench spots` };
  }
  const word = (sport) => (sport === "nba" ? "tips off" : "kicks off");
  return { open, list, pick, lineup, et, kick, label, night, sunday, isDay, dayName, tip, word, early, late };
});
