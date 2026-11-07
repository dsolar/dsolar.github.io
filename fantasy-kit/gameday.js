/* Pure game-box-score helpers. Weekly totals are never presented as a daily NBA/MLB line. */
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
    // NFL has one game per team in a week. Its weekly line is that game's line.
    if (sport === 'nfl' && (live.games[player.t] || []).length === 1) return (live.players || {})[player.id] || null;
    return null;
  }
  function stats(sport, player, row, schema) {
    if (!row) return [];
    const at = (key, ln) => { const cs = schema.cols || (schema.lines || {})[ln] || []; const r = Array.isArray(row) ? row : row[ln]; const i = cs.indexOf(key); return r && i >= 0 && Number.isFinite(r[i]) ? r[i] : null; };
    const n = (key, ln) => at(key, ln) == null ? '—' : String(at(key, ln));
    const pair = (label, key, ln) => [label, n(key, ln)];
    if (sport === 'nfl') {
      const pos = player.pos || [], out = [];
      if (pos.includes('QB') || at('pass_yd') || at('pass_td')) out.push(pair('Pass YD', 'pass_yd'), pair('Pass TD', 'pass_td'), pair('INT', 'pass_int'));
      if (pos.some(p => ['QB','RB','WR','TE'].includes(p))) out.push(['Rush', `${n('rush_att')}/${n('rush_yd')}`], pair('Rush TD', 'rush_td'));
      if (pos.some(p => ['RB','WR','TE'].includes(p)) || at('rec')) out.push(['Rec/TGT', `${n('rec')}/${n('rec_tgt')}`], pair('Rec YD', 'rec_yd'), pair('Rec TD', 'rec_td'));
      if (pos.includes('K')) out.push(['FG', `${n('fgm')}/${n('fga')}`], pair('XP', 'xpm'));
      if (pos.includes('DEF')) out.push(pair('SACK', 'def_sack'), pair('INT', 'def_int'), pair('TD', 'def_td'), pair('PA', 'pts_allow'));
      if (at('fum_lost')) out.push(pair('FUM', 'fum_lost'));
      return out;
    }
    if (sport === 'nba') return [['PTS','pts'],['REB','reb'],['AST','ast'],['STL','stl'],['BLK','blk'],['3PM','tpm'],['TO','tov'],['MIN','min']].map(([l,k])=>pair(l,k));
    const out = [];
    if (row.bat) out.push(['H/AB',`${n('h','bat')}/${n('ab','bat')}`], ...[['R','r'],['HR','hr'],['RBI','rbi'],['SB','sb']].map(([l,k])=>pair(l,k,'bat')));
    if (row.pit) { const outs = at('outs','pit'); out.push(['IP',outs == null ? n('ip','pit') : `${Math.floor(outs/3)}.${outs%3}`], ...[['K','k'],['ER','er'],['BB','bb'],['H','h'],['W','w'],['SV','sv']].map(([l,k])=>pair(l,k,'pit'))); }
    return out;
  }
  const api = { day, current, line, stats };
  (root.FK = root.FK || {}).gameday = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
