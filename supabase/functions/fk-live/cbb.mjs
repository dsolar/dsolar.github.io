// College basketball for Draft Lab's one-day games (fk-live ?sport=cbb&slates=1 and ?sport=cbb&games=...).
//
// Slates: the night's featured games, the CBB Hub's best 14 by watchability (davidsolar.dev/cbb/data/dfs.json, written
// by tools/cbb_dfs.py), with tip times and states refreshed from ESPN's college scoreboard. Shaped like the NBA's days.
// Box scores: ESPN's college summary, in the NBA's columns, keyed by ESPN athlete id (the pool's ids: college names
// repeat far more often than the pros').
export const CBB_COLS = ["gp", "eg", "min", "fgm", "fga", "ftm", "fta", "tpm", "pts", "reb", "ast", "stl", "blk", "tov", "oreb", "dreb", "pf", "tpa", "pm", "dd", "td"];
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";
const SITE = "https://davidsolar.dev/cbb/data/dfs.json";

export function cbbBox(s) {
  const out = {};
  for (const side of s?.boxscore?.players || []) {
    const st = side.statistics?.[0]; if (!st) continue;
    const labels = (st.labels || st.names || []).map((x) => String(x).toUpperCase());
    const ix = (k) => labels.indexOf(k);
    for (const a of st.athletes || []) {
      const id = a.athlete?.id; if (!id || a.didNotPlay || !a.stats?.length) continue;
      const v = (k) => (ix(k) >= 0 ? a.stats[ix(k)] : "0") ?? "0";
      const pair = (k) => String(v(k)).split("-").map((x) => Number(x) || 0);
      const [fgm, fga] = pair("FG"), [tpm, tpa] = pair("3PT"), [ftm, fta] = pair("FT");
      const n = (k) => Number(v(k)) || 0, pts = n("PTS"), reb = n("REB"), ast = n("AST"), stl = n("STL"), blk = n("BLK");
      const oreb = n("OREB"), tens = [pts, reb, ast, stl, blk].filter((x) => x >= 10).length;
      out[String(id)] = [1, 1, n("MIN"), fgm, fga, ftm, fta, tpm, pts, reb, ast, stl, blk, n("TO"),
        oreb, Math.max(0, reb - oreb), n("PF"), tpa, 0, tens >= 2 ? 1 : 0, tens >= 3 ? 1 : 0];
    }
  }
  return out;
}

export const cbbSummary = (getJSON, id) => getJSON(`${ESPN}/summary?event=${id}`).catch(() => null);

export async function cbbSlates(getJSON) {
  const dfs = await getJSON(`${SITE}?t=${Math.floor(Date.now() / 300e3)}`);
  if (!dfs || !Array.isArray(dfs.days)) return { weeks: [] };
  const weeks = [];
  for (const d of dfs.days) {
    const board = await getJSON(`${ESPN}/scoreboard?dates=${d.day.replace(/-/g, "")}&groups=50&limit=400`).catch(() => null);
    const live = {};
    for (const e of (board && board.events) || []) live[String(e.id)] = { at: e.date, state: e.status?.type?.state || "pre", off: /postpon|cancel/i.test(e.status?.type?.description || "") };
    const games = (d.games || []).map((g) => {
      const x = live[String(g.id)] || {};
      return { id: String(g.id), at: x.at || g.at, away: g.away, home: g.home, state: x.state || g.state || "pre", off: !!x.off, watch: g.watch, spread: g.spread, total: g.total };
    }).filter((g) => g.at && !g.off).map(({ off, ...g }) => g).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    weeks.push({ day: d.day, start: d.day, end: d.day, sport: "cbb", games });
  }
  return { sport: "cbb", season: dfs.season, weeks, updated: new Date().toISOString() };
}
