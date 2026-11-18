/* Pure game-box-score helpers. Weekly totals are never presented as a daily NBA/MLB/NHL line. */
(function (root) {
  'use strict';
  const day = (at) => { const d = new Date(at); return Number.isFinite(+d) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d) : ''; };
  function current(games, now = Date.now()) {
    const gs = (games || []).slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return gs.find(g => g.state === 'in') || gs.filter(g => day(g.at) === day(now) && g.state === 'post').at(-1) || gs.find(g => g.state === 'pre') || gs.at(-1) || null;
  }
  function line(sport, player, game, live) {
    if (!game || game.state === 'pre' || !live) return null;
    const box = live.boxes && live.boxes[game.id];
    if (box) return box[player.id] || null;
    // A football team's weekly line is its game's line only when it has exactly one game in that week.
    // College's long opening week can contain two; never present their combined totals as one game's stats.
    if ((sport === 'nfl' || sport === 'cfb') && (live.games[player.t] || []).length === 1) return (live.players || {})[player.id] || null;
    return null;
  }
  function stats(sport, player, row, schema) {
    if (!row) return [];
    const at = (key, ln) => { const cs = schema.cols || (schema.lines || {})[ln] || []; const r = Array.isArray(row) ? row : row[ln]; const i = cs.indexOf(key); return r && i >= 0 && Number.isFinite(r[i]) ? r[i] : null; };
    const n = (key, ln) => at(key, ln) == null ? '—' : String(at(key, ln));
    const pair = (label, key, ln) => [label, n(key, ln)];
    if (sport === 'nfl' || sport === 'cfb') {
      const pos = player.pos || [], out = [];
      if (pos.includes('QB') || at('pass_yd') || at('pass_td')) out.push(pair('Pass YD', 'pass_yd'), pair('Pass TD', 'pass_td'), pair('INT', 'pass_int'));
      if (pos.some(p => ['QB','RB','WR','TE'].includes(p))) out.push(['Rush', `${n('rush_att')}/${n('rush_yd')}`], pair('Rush TD', 'rush_td'));
      if (pos.some(p => ['RB','WR','TE'].includes(p)) || at('rec')) out.push(sport === 'cfb' ? pair('REC', 'rec') : ['Rec/TGT', `${n('rec')}/${n('rec_tgt')}`], pair('Rec YD', 'rec_yd'), pair('Rec TD', 'rec_td'));
      if (pos.includes('K')) out.push(['FG', `${n('fgm')}/${n('fga')}`], pair('XP', 'xpm'));
      if (pos.includes('DEF')) out.push(pair('SACK', 'def_sack'), pair('INT', 'def_int'), pair('TD', 'def_td'), pair('PA', 'pts_allow'));
      if (at('fum_lost')) out.push(pair('FUM', 'fum_lost'));
      return out;
    }
    if (sport === 'nba') return [['PTS','pts'],['REB','reb'],['AST','ast'],['STL','stl'],['BLK','blk'],['3PM','tpm'],['TO','tov'],['MIN','min']].map(([l,k])=>pair(l,k));
    if (sport === 'nhl') {
      if (row.goalie) return [['W', 'w'], ['SV', 'saves'], ['SA', 'sa'], ['GA', 'ga'], ['SO', 'so']].map(([l, k]) => pair(l, k, 'goalie')).concat([
        ['GAA', at('gaa', 'goalie') == null ? '—' : at('gaa', 'goalie').toFixed(2)],
        ['SV%', at('svp', 'goalie') == null ? '—' : at('svp', 'goalie').toFixed(3).replace(/^0/, '')],
      ]);
      return row.sk ? [['G', 'g'], ['A', 'a'], ['PTS', 'pts'], ['+/−', 'pm'], ['PPP', 'ppp'], ['SOG', 'sog'], ['HIT', 'hits'], ['BLK', 'blk']].map(([l, k]) => pair(l, k, 'sk')) : [];
    }
    const out = [];
    if (row.bat) out.push(['H/AB',`${n('h','bat')}/${n('ab','bat')}`], ...[['R','r'],['HR','hr'],['RBI','rbi'],['SB','sb']].map(([l,k])=>pair(l,k,'bat')));
    if (row.pit) { const outs = at('outs','pit'); out.push(['IP',outs == null ? n('ip','pit') : `${Math.floor(outs/3)}.${outs%3}`], ...[['K','k'],['ER','er'],['BB','bb'],['H','h'],['W','w'],['SV','sv']].map(([l,k])=>pair(l,k,'pit'))); }
    return out;
  }
  /* Baseball's lineup status for one player on one New York day, from fk-live ?sport=mlb&lineups=1 ({ days: { date:
     { teams, bat, sp } } }). Returns null when that day isn't in the feed, else { kind, text, ... }:
       nogame   his team doesn't play               ppd      the game's postponed
       batting  in the posted lineup (o: 1 to 9)      out      the lineup's posted and he isn't in it
       pending  the lineup isn't out yet (at: first pitch)
       sp       the probable starting pitcher (opp, home)   rp: a pitcher who isn't starting (null, nothing to say)
     A doubleheader lists each game: "Batting 2nd, sitting game 2". */
  const ORD = (n) => `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n] || 'th'}`;
  const PITCH = new Set(['SP', 'RP', 'P']);
  function lineupStatus(feed, player, date) {
    const d = feed && feed.days && feed.days[date];
    if (!d || !player) return null;
    const id = String(player.id), gs = (d.teams && d.teams[player.t]) || [];
    const pos = player.pos || [], hitter = pos.some((x) => !PITCH.has(x)), pitcher = pos.some((x) => PITCH.has(x));
    const sp = d.sp && d.sp[id];
    if (sp && sp.length) return { kind: 'sp', text: `Probable starter ${sp[0].home ? 'vs' : '@'} ${sp[0].opp}`, opp: sp[0].opp, home: sp[0].home };
    if (!gs.length) return { kind: 'nogame', text: 'No game' };
    if (!hitter && pitcher) return null;
    const live = gs.filter((g) => !g.ppd);
    if (!live.length) return { kind: 'ppd', text: 'Postponed' };
    const bat = (d.bat && d.bat[id]) || [];
    const per = live.map((g) => { const b = bat.find((x) => x.game === g.game); return b ? { k: 'batting', o: b.o } : g.posted ? { k: 'out' } : { k: 'pending', at: g.at }; });
    const word = (x, i) => (x.k === 'batting' ? `Batting ${ORD(x.o)}` : x.k === 'out' ? 'Not in lineup' : 'Lineup not out yet') + (live.length > 1 ? ` (game ${i + 1})` : '');
    const first = per.find((x) => x.k === 'batting') || per.find((x) => x.k === 'pending') || per[0];
    return { kind: first.k, o: first.o, at: first.at || live[0].at, text: per.map(word).join(', ') };
  }
  const api = { day, current, line, stats, lineupStatus };
  (root.FK = root.FK || {}).gameday = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
