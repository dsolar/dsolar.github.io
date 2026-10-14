// Live relay for davidsolar.dev/guillotine/ (a Cloudflare Worker, free plan).
//
// Every request returns one small JSON file: this week's points so far for the league's rostered
// players (Sleeper's public stats feed, scored with Bastille Day rules) and every NFL game's state and
// clock (ESPN's public scoreboard). It reads the rosters from the site's own data.json, so it never
// needs editing week to week. Upstream feeds are cached for about 45 seconds, so they get a request
// or two a minute no matter how many people have the page open.
//
// Setup (once): Cloudflare dashboard > Workers & Pages > Create > Create Worker > name it
// "guillotine-live" > Deploy > Edit code > replace everything with this file > Deploy.
// Then the worker's Settings > Domains & Routes > Add > Custom domain > live.davidsolar.dev.

const DATA_URL = "https://davidsolar.dev/guillotine/data.json";
const UA = "davidsolar-guillotine-live/1.0 (+https://davidsolar.dev/guillotine/)";
const FRESH_MS = 45000;

const SCORING = {
  pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2,
  rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
  rec: 0.5, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
  fum_lost: -2,
};
const SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
const ESPN_FIX = { WSH: "WAS" }; // ESPN's abbreviations that differ from Sleeper's and Yahoo's

let memo = { at: 0, body: null };

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: headers() });
    const now = Date.now();
    if (memo.body && now - memo.at < FRESH_MS) return reply(memo.body);
    try {
      const data = await getJSON(DATA_URL + "?v=" + Math.floor(now / 300000), 300);
      const { season, week } = data;
      const [stats, board] = await Promise.all([
        getJSON(`https://api.sleeper.com/stats/nfl/${season}/${week}?season_type=regular` +
          "&position%5B%5D=QB&position%5B%5D=RB&position%5B%5D=WR&position%5B%5D=TE", 40),
        getJSON(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${week}`, 30),
      ]);
      const body = build(data, stats, board, now);
      memo = { at: now, body };
      return reply(body);
    } catch (e) {
      if (memo.body) return reply(memo.body); // serve the last good answer if a feed hiccups
      return reply({ error: String(e) }, 502);
    }
  },
};

function build(data, stats, board, now) {
  // Only the players on league rosters, so a phone downloads a few KB a minute, not the whole NFL.
  const want = {};
  for (const t of data.teams || []) for (const p of t.roster || []) if (p.name) want[norm(p.name) + "|" + p.pos] = p.nfl;
  const pts = {};
  for (const e of stats || []) {
    const pl = e.player || {};
    const key = norm(`${pl.first_name || ""} ${pl.last_name || ""}`) + "|" + pl.position;
    if (!(key in want)) continue;
    const team = (e.team || pl.team || "").toUpperCase();
    if (pts[key] && pts[key].team === want[key] && team !== want[key]) continue; // same name, wrong team
    const s = e.stats || {};
    pts[key] = { pts: score(s), gp: !!s.gp, team };
  }
  const games = {};
  for (const ev of board.events || []) {
    const st = ev.status || {};
    const comp = (ev.competitions || [])[0] || {};
    const g = {
      state: (st.type || {}).state || "pre", // pre, in, post
      frac: fraction(st),                    // share of the game played
      period: st.period || 0,
      clock: st.displayClock || "",
      start: ev.date,
    };
    for (const c of comp.competitors || []) {
      const abbr = ((c.team || {}).abbreviation || "").toUpperCase();
      games[ESPN_FIX[abbr] || abbr] = g;
    }
  }
  return { season: data.season, week: data.week, fetched: new Date(now).toISOString(), games, pts };
}

function fraction(st) {
  const state = (st.type || {}).state;
  if (state === "post") return 1;
  if (state !== "in") return 0;
  const p = st.period || 1, left = typeof st.clock === "number" ? st.clock : 900;
  if (p > 4) return 0.98; // overtime
  return Math.min(1, ((p - 1) * 900 + (900 - left)) / 3600);
}

function score(s) {
  let total = 0, any = false;
  for (const k in SCORING) if (k in s) { any = true; total += (s[k] || 0) * SCORING[k]; }
  if (!any && typeof s.pts_half_ppr === "number") return s.pts_half_ppr;
  return Math.round(total * 100) / 100;
}

function norm(name) {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[.'’`-]/g, "").split(/\s+/).filter((w) => w && !SUFFIX.has(w)).join(" ");
}

async function getJSON(url, ttl) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, cf: { cacheTtl: ttl, cacheEverything: true } });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

function headers() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "public, max-age=30",
  };
}

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: headers() });
}
