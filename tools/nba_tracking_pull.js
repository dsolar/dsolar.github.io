// NBA player tracking, pulled through a browser on nba.com (stats.nba.com refuses GitHub's and Supabase's servers,
// so this can't run in a GitHub Action). Run it on any www.nba.com/stats page: paste it into the console, or run it
// with a browser automation tool there (start it without awaiting, then poll window.__nbaDone: it takes 15-20
// seconds and a long-running call can drop the automation's connection).
//
// It pulls nine tracking feeds, then hands the result to Supabase (the nba_tracking_put function, with the site's
// public key; see tools/fantasykit_pools.sql), where the NBA tracking GitHub job (nba-tracking.yml, which runs
// tools/nba_tracking.py) picks it up and publishes nba/data/tracking.json. window.__nbaDone ends up as
// {ok, players, bytes} on success or {error} on failure.
//
// Payload: {season, pulled, failed, cols: [...], p: {nbaId: [name, team, gp, min, ...cols]}}
window.__nbaDone = null;
(async () => {
  const now = new Date(), y = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  const season = y + "-" + String(y + 1).slice(2);
  const P = "College=&Conference=&Country=&DateFrom=&DateTo=&Division=&DraftPick=&DraftYear=&GameScope=&Height=&ISTRound=&LastNGames=0&LeagueID=00&Location=&Month=0&OpponentTeamID=0&Outcome=&PORound=0&PerMode=PerGame&PlayerExperience=&PlayerOrTeam=Player&PlayerPosition=&Season=" + season + "&SeasonSegment=&SeasonType=Regular%20Season&StarterBench=&TeamID=0&VsConference=&VsDivision=&Weight=";
  const H = { "x-nba-stats-origin": "stats", "x-nba-stats-token": "true" };
  // feed -> [url, [[source column, our name], ...]]
  const FEEDS = {
    speed: ["leaguedashptstats?" + P + "&PtMeasureType=SpeedDistance", [["DIST_MILES", "dist"], ["DIST_MILES_OFF", "dist_o"], ["DIST_MILES_DEF", "dist_d"], ["AVG_SPEED", "spd"], ["AVG_SPEED_OFF", "spd_o"], ["AVG_SPEED_DEF", "spd_d"]]],
    drives: ["leaguedashptstats?" + P + "&PtMeasureType=Drives", [["DRIVES", "drv"], ["DRIVE_PTS", "drv_pts"], ["DRIVE_FG_PCT", "drv_fg"], ["DRIVE_AST", "drv_ast"], ["DRIVE_TOV", "drv_tov"]]],
    rim: ["leaguedashptstats?" + P + "&PtMeasureType=Defense", [["DEF_RIM_FGA", "rim_fga"], ["DEF_RIM_FG_PCT", "rim_fg"]]],
    reb: ["leaguedashptstats?" + P + "&PtMeasureType=Rebounding", [["REB_CHANCES", "reb_ch"], ["REB_CHANCE_PCT", "reb_chp"], ["REB_CONTEST_PCT", "reb_con"]]],
    cs: ["leaguedashptstats?" + P + "&PtMeasureType=CatchShoot", [["CATCH_SHOOT_FG3A", "cs3a"], ["CATCH_SHOOT_FG3_PCT", "cs3"], ["CATCH_SHOOT_EFG_PCT", "cs_efg"]]],
    pu: ["leaguedashptstats?" + P + "&PtMeasureType=PullUpShot", [["PULL_UP_FGA", "pu_fga"], ["PULL_UP_FG3_PCT", "pu3"], ["PULL_UP_EFG_PCT", "pu_efg"]]],
    touch: ["leaguedashptstats?" + P + "&PtMeasureType=Possessions", [["TOUCHES", "tch"], ["TIME_OF_POSS", "top"], ["AVG_SEC_PER_TOUCH", "sec_tch"], ["AVG_DRIB_PER_TOUCH", "drib_tch"]]],
    pass: ["leaguedashptstats?" + P + "&PtMeasureType=Passing", [["PASSES_MADE", "passes"], ["POTENTIAL_AST", "pot_ast"], ["AST_POINTS_CREATED", "ast_pts"], ["SECONDARY_AST", "sec_ast"]]],
    hustle: ["leaguehustlestatsplayer?" + P, [["CONTESTED_SHOTS", "contest"], ["DEFLECTIONS", "defl"], ["CHARGES_DRAWN", "charges"], ["SCREEN_AST_PTS", "scr_pts"], ["LOOSE_BALLS_RECOVERED", "loose"], ["BOX_OUTS", "boxouts"]]],
  };
  const cols = [], out = {}, failed = [];
  const r1 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);
  for (const [feed, [url, want]] of Object.entries(FEEDS)) {
    let rs = null;
    for (let tryN = 0; tryN < 3 && !rs; tryN++) {
      try {
        const r = await fetch("https://stats.nba.com/stats/" + url, { headers: H, signal: AbortSignal.timeout(25000) });
        const j = await r.json();
        rs = j.resultSets && j.resultSets[0];
      } catch (e) { await new Promise((ok) => setTimeout(ok, 1500)); }
    }
    const at = cols.length;
    want.forEach(([, k]) => cols.push(k));
    if (!rs) { failed.push(feed); continue; }
    const ix = (c) => rs.headers.indexOf(c), iId = ix("PLAYER_ID"), iN = ix("PLAYER_NAME"), iT = ix("TEAM_ABBREVIATION"), iG = ix("GP") >= 0 ? ix("GP") : ix("G"), iM = ix("MIN");
    rs.rowSet.forEach((row) => {
      const id = String(row[iId]);
      const rec = out[id] || (out[id] = [row[iN], row[iT], row[iG], r1(row[iM])]);
      if (rec[2] == null && iG >= 0) rec[2] = row[iG];
      want.forEach(([src], i) => { const k = ix(src); rec[4 + at + i] = k >= 0 ? r1(row[k]) : null; });
    });
    await new Promise((ok) => setTimeout(ok, 600));
  }
  Object.values(out).forEach((rec) => { for (let i = 0; i < 4 + cols.length; i++) if (rec[i] === undefined) rec[i] = null; });
  const body = { season, pulled: new Date().toISOString().slice(0, 16) + "Z", failed, cols, p: out };
  if (Object.keys(out).length < 150) throw new Error("only " + Object.keys(out).length + " players came back; feeds failed: " + failed.join(", "));
  const r = await fetch("https://baxrczyufqbzrogftmyn.supabase.co/rest/v1/rpc/nba_tracking_put", { method: "POST", headers: { apikey: "sb_publishable_brDXGevzcoI7mBaPO7Plow_yaUy4gk4", "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
  const txt = await r.text();
  if (!r.ok) throw new Error("Supabase said " + r.status + ": " + txt.slice(0, 200));
  window.__nbaDone = Object.assign(JSON.parse(txt), { failed });
  return window.__nbaDone;
})().catch((e) => { window.__nbaDone = { error: String(e && e.message || e) }; });
