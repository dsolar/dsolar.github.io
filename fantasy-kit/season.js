/* Fantasy Kit: a shared league's clock and its emails. No DOM and no network, so the same code runs on a league
   page (live.js) and in the scheduled job that keeps leagues moving when nobody has a page open
   (supabase/functions/fk-clock).

   FK.season:
     startAfter(t, sportKey)              the season's first week: the next Monday at 9:00 UTC (Tuesday for football)
     begin(D, sport, { name, season })    the league that follows a finished draft
     catchUp(L, ctx, now)                 plays every week that has ended, runs bots, waivers and trade reviews; true if anything changed
     driveDraft(D, ctx, now)              a draft's overdue picks (bots, expired clocks); true if anything changed
     events(before, after, o)             the emails a save should send: [{ team, kind, subject, body }]
                                          o: { name, url, seats, me, byId, now } */
(function (root, factory) {
  const FK = root.FK || {};
  const req = typeof require !== "undefined" ? require : null;
  const m = factory(FK.draft || (req ? req("./draft.js") : null), FK.league || (req ? req("./league.js") : null));
  if (typeof module !== "undefined" && module.exports) module.exports = m;
  else (root.FK = root.FK || {}).season = m;
})(this, function (F, G) {
  "use strict";
  const DAY = 864e5, HOUR = 36e5;

  function startAfter(t, sportKey) {
    const d = new Date(t), want = sportKey === "nfl" ? 2 : 1;
    d.setUTCHours(9, 0, 0, 0);
    let add = (want - d.getUTCDay() + 7) % 7;
    if (add === 0 && d.getTime() <= t) add = 7;
    return d.getTime() + add * DAY;
  }

  function begin(D, sport, o = {}) {
    const s = D.season || { format: "h2h", weeks: 14 };
    const weeks = s.weeks || 14, n = D.teams.length;
    const settings = s.format === "guillotine" ? { format: "guillotine", bestBall: true, waiverAt: 60 }
      : { weeks, playoffTeams: Math.min(4, n - (n % 2)), deadline: Math.max(1, weeks - 3), tradeReview: "vote", reviewHours: 24, waiverHours: 36 };
    // a draft that ran out on the clock while nobody was around is "done" in the past; start after now, not then
    const at = Math.max(D.done || 0, o.now || Date.now());
    return G.create({ sport, draft: D, name: o.name || D.name, season: o.season || "", now: at, start: startAfter(at, sport.key), scoring: D.scoring, settings });
  }

  function catchUp(L, ctx, now) {
    if (!L) return false;
    const before = JSON.stringify(L);
    // guillotine bots bid on the chopped roster early in the week, before the midweek waiver run
    const bids = () => {
      L.botBid = L.botBid || {};
      const at = G.weekStart(L, L.week) + HOUR;
      if (!G.isGuillotine(L) || L.botBid[L.week] || now < at || L.week > G.totalWeeks(L)) return;
      L.botBid[L.week] = true;
      G.botBids(L, ctx, at, F.rng(L.seed + L.week * 41));
    };
    while (L.week <= G.totalWeeks(L) && now >= G.weekStart(L, L.week + 1)) {
      const end = G.weekStart(L, L.week + 1);
      bids();
      if (G.isGuillotine(L)) G.tick(L, ctx, G.waiverRunAt(L) + 1);
      G.botWeek(L, ctx, end - 2 * DAY, F.rng(L.seed + L.week * 13));
      G.tick(L, ctx, end - DAY);
      L.prevPower = Object.fromEntries(G.power(L, ctx).map((r) => [r.team, r.rank]));
      G.finishWeek(L, ctx, end);
    }
    bids();
    G.tick(L, ctx, now);
    return JSON.stringify(L) !== before;
  }

  function driveDraft(D, ctx, now) {
    if (!D || D.phase !== "live" || D.paused) return false;
    return F.tick(D, ctx, now, 2000) > 0;
  }

  /* ---------- emails ---------- */
  const ord = (n) => n + (["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10] || "th");
  const fmtS = (x) => (typeof x === "number" ? (Number.isInteger(x) ? String(x) : x.toFixed(1)) : String(x));
  const when = (t) => new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

  function events(b, c, o) {
    const out = [], seats = o.seats || {}, now = o.now || Date.now();
    const doc = c.league || c.draft;
    const teamName = (t) => (doc && doc.teams[t] ? doc.teams[t].name : "A team");
    const pn = (pid) => (F.isPickId(pid) ? `pick ${F.pickIdx(pid) + 1}` : ((o.byId || {})[pid] || {}).n || "a player");
    const names = (ids) => (ids && ids.length ? ids.map(pn).join(", ") : "nothing");
    const seated = Object.keys(seats).map(Number);
    const add = (team, kind, subject, body) => {
      if (team == null || team === o.me || seats[team] == null || out.some((x) => x.team === team && x.subject.endsWith(subject))) return;
      out.push({ team, kind, subject: `${o.name}: ${subject}`, body: `${body}\n\nOpen the league: ${o.url}` });
    };
    function trades(bt, ct) {
      const was = Object.fromEntries((bt || []).map((t) => [t.id, t.status]));
      for (const t of ct || []) {
        const s0 = was[t.id];
        if (s0 == null && t.status === "pending") add(t.to, "trade", `${teamName(t.from)} sent you a trade offer`, `${teamName(t.from)} offered ${names(t.give)} for ${names(t.get)}.${t.note ? `\n\n"${t.note}"` : ""}`);
        else if (s0 === "pending" && t.status !== "pending") {
          const verb = { accepted: "accepted", review: "accepted", rejected: "declined", declined: "declined", expired: "didn't answer" }[t.status];
          if (!verb) continue;
          const body = t.status === "review" ? `${teamName(t.to)} accepted. The league can vote on it until ${when(t.reviewEnds)}.`
            : t.status === "expired" ? `Your offer to ${teamName(t.to)} expired.`
            : `${teamName(t.to)} ${verb} your offer of ${names(t.give)} for ${names(t.get)}.${t.why ? ` "${t.why}"` : ""}`;
          add(t.from, "trade", `${teamName(t.to)} ${verb} your trade`, body);
        } else if (s0 === "review" && t.status === "vetoed") {
          add(t.from, "trade", "your trade was vetoed", "The league voted it down.");
          add(t.to, "trade", "your trade was vetoed", "The league voted it down.");
        }
      }
    }
    const bd = b && b.draft, cd = c.draft;
    if (bd && cd && !(b && b.league)) {
      if (bd.phase === "setup" && cd.phase === "live") seated.forEach((t) => add(t, "draft", "the draft started", "The draft room is live. If your clock runs out, the best player left is taken for you, so jump in."));
      if (bd.phase !== "done" && cd.phase === "done") seated.forEach((t) => add(t, "draft", "the draft is done", `Every pick is in.${c.league ? ` The season starts ${when(c.league.start)}.` : ""} Set your lineup and check the free agents.`));
      if (cd.phase === "live" && cd.type !== "auction" && (cd.clock || 0) >= 3600) {
        try {
          const cc = F.onClock(cd, now), cb = bd.phase === "live" ? F.onClock(bd, now) : null;
          if (cc && (!cb || cb.index !== cc.index) && !F.isBot(cd.teams[cc.team])) add(cc.team, "clock", "you're on the clock", `Pick ${cc.pick} is yours. You have until ${when(cc.deadline)}.`);
        } catch (e) { /* no clock to read */ }
      }
      trades(bd.trades, cd.trades);
    }
    if (c.league) {
      const bl = (b && b.league) || { trades: [], claims: [], results: {} }, cl = c.league;
      trades(bl.trades, cl.trades);
      const was = Object.fromEntries((bl.claims || []).map((x) => [x.id, x.status]));
      for (const x of cl.claims || []) {
        if (was[x.id] !== "open") continue;
        if (x.status === "won") add(x.team, "waiver", `you got ${pn(x.add)}`, `Your $${x.bid} claim for ${pn(x.add)} went through${x.drop ? `, and ${pn(x.drop)} was dropped` : ""}.`);
        else if (x.status === "lost") add(x.team, "waiver", `your claim for ${pn(x.add)} lost`, `${teamName(x.lostTo)} got ${pn(x.add)} with a higher bid or better waiver priority.`);
        else if (x.status === "failed") add(x.team, "waiver", `your claim for ${pn(x.add)} didn't go through`, x.why || "The claim couldn't be processed.");
      }
      for (const w of Object.keys(cl.results || {})) {
        if (bl.results && bl.results[w]) continue;
        const res = cl.results[w];
        if (res && res.block) {
          const gone = (res.chopped || []).map(teamName).join(" and ");
          for (const r of res.block) add(r.team, "week", r.out ? `you were chopped in week ${w}` : `you survived week ${w}`,
            r.out ? `You scored ${fmtS(r.score)}, the lowest this week. Thanks for playing.` : `You scored ${fmtS(r.score)} and finished ${ord(r.rank)}. ${gone} ${(res.chopped || []).length > 1 ? "were" : "was"} chopped, and their players are up for bids.`);
        } else if (Array.isArray(res)) {
          for (const g of res) for (const side of ["a", "b"]) {
            const mine = g[side], opp = side === "a" ? g.b : g.a, sm = side === "a" ? g.sa : g.sb, so = side === "a" ? g.sb : g.sa;
            if (mine == null || mine < 0 || opp == null || opp < 0) continue;
            const won = g.w === "t" ? null : g.w === side;
            add(mine, "week", `week ${w} final`, `You ${won == null ? "tied" : won ? "beat" : "lost to"} ${teamName(opp)}, ${fmtS(sm)} to ${fmtS(so)}.`);
          }
        }
      }
    }
    return out;
  }

  return { startAfter, begin, catchUp, driveDraft, events };
});
