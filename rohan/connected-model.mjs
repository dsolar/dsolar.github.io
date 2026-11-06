export const isUsableSnapshot = s => s?.leagueId === 270405 && s?.platform === 'espn' && Number.isInteger(s.week) && Number.isFinite(Date.parse(s.importedAt)) && Array.isArray(s.teams) && s.teams.length > 0 && s.teams.every(t=>Array.isArray(t.roster));
export const points = n => Number.isFinite(n) ? n.toLocaleString('en-US',{maximumFractionDigits:2}) : '—';
export function currentMatchups(s) {
  // ESPN matchup periods can span more than one NFL scoring week.
  const period = s.status?.currentMatchupPeriod;
  if (!Number.isInteger(period)) return [];
  return (s.schedule || []).filter(m=>m.matchupPeriodId===period && m.home && m.away);
}
export function weeklyProjection(player, week) {
  return player.stats?.find(s=>s.sourceId===1 && s.week===week && s.splitTypeId===1)?.points ?? null;
}
export const isStale = s => !Number.isFinite(Date.parse(s?.importedAt)) || Date.now()-Date.parse(s.importedAt)>60*60*1000;
