// College football's current and next fantasy weeks. The hub identifies FBS schools and the season calendar;
// ESPN refreshes kickoff times and states. Only FBS-vs-FBS games have both sides in the fantasy player pool.
import { CFB_ESPN } from './cfb.mjs';
const HUB = 'https://davidsolar.dev/cfb/data/hub.json';
const DAY = 864e5;
const nyDay = (at) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
const add = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);

export function cfbWindows(hub, now = Date.now()) {
  const today = nyDay(now), regular = (hub.weeks || []).filter(w => w.type === 2).map(w => ({
    week: Number(w.week), start: nyDay(Date.parse(w.start)), end: nyDay(Date.parse(w.end) - 6 * 36e5),
  })).filter(w => w.week > 0 && w.start <= w.end).sort((a, b) => a.start.localeCompare(b.start));
  const windows = regular.slice(), last = regular.at(-1);
  // Postseason weeks match the weekly fantasy data: Monday-Sunday, numbered after conference championship week.
  if (last) for (const g of hub.games || []) {
    if (!g.post || !g.day || g.day <= last.end) continue;
    const startPost = add(last.end, 1), n = Math.floor((Date.parse(g.day + 'T12:00:00Z') - Date.parse(startPost + 'T12:00:00Z')) / (7 * DAY));
    const week = last.week + n + 1, start = add(startPost, n * 7);
    if (!windows.some(w => w.week === week)) windows.push({ week, start, end: add(start, 6) });
  }
  const future = windows.sort((a, b) => a.start.localeCompare(b.start)).filter(w => w.end >= today);
  return future.slice(0, 2);
}

export function cfbBoardGames(board, teams) {
  const byId = Object.fromEntries((teams || []).map(t => [String(t.id), t.abbr]));
  return ((board && board.events) || []).flatMap(e => {
    const cs = e.competitions?.[0]?.competitors || [], type = e.status?.type || e.competitions?.[0]?.status?.type || {};
    if (/postpon|cancel/i.test(`${type.name || ''} ${type.description || ''}`)) return [];
    const side = h => byId[String(cs.find(c => c.homeAway === h)?.team?.id || '')];
    const away = side('away'), home = side('home');
    if (!away || !home || !/^\d{1,12}$/.test(String(e.id)) || !Number.isFinite(Date.parse(e.date))) return [];
    return [{ id: String(e.id), at: e.date, away, home, state: type.state || 'pre' }];
  });
}

export async function cfbSlates(getJSON, now = Date.now()) {
  const hub = await getJSON(HUB);
  if (!hub || !Array.isArray(hub.teams) || !Array.isArray(hub.weeks) || !Array.isArray(hub.games)) throw Error('College football schedule unavailable');
  const windows = cfbWindows(hub, now), days = [...new Set(windows.flatMap(w => {
    const out = []; for (let d = w.start; d <= w.end; d = add(d, 1)) out.push(d); return out;
  }))];
  const boards = {}, failures = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, days.length) }, async () => {
    while (cursor < days.length) {
      const day = days[cursor++];
      try {
        const b = await getJSON(`${CFB_ESPN}/scoreboard?dates=${day.replace(/-/g, '')}&groups=80&limit=300`);
        if (!b || !Array.isArray(b.events)) throw Error('Incomplete scoreboard');
        boards[day] = cfbBoardGames(b, hub.teams);
      } catch { failures.push(day); }
    }
  }));
  // Missing dates must never look like an empty schedule or silently remove games from a chosen window.
  if (failures.length) throw Error('College football schedule is temporarily incomplete');
  const weeks = windows.map(w => {
    const unique = new Map();
    for (const games of Object.values(boards)) for (const g of games) if (w.start <= nyDay(Date.parse(g.at)) && nyDay(Date.parse(g.at)) <= w.end) unique.set(g.id, g);
    return { ...w, sport: 'cfb', games: [...unique.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) };
  });
  return { sport: 'cfb', season: String(hub.season), scope: 'FBS-vs-FBS', weeks, updated: new Date(now).toISOString() };
}
