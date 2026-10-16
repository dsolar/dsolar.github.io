// ESPN's league read endpoints are undocumented. Preserve original rule IDs and
// parameters so unfamiliar scoring categories never silently become defaults.
export const VERSION = '0.1.0';
export const SLOTS = {0:'QB',1:'Team QB',2:'RB',3:'RB/WR',4:'WR',5:'WR/TE',6:'TE',7:'Superflex',8:'DT',9:'DE',10:'LB',11:'DL',12:'CB',13:'S',14:'DB',15:'IDP',16:'D/ST',17:'K',18:'P',19:'HC',20:'Bench',21:'IR',23:'FLEX',24:'Edge',25:'Rookie'};
export const POSITIONS = {1:'QB',2:'RB',3:'WR',4:'TE',5:'K',6:'D/ST',7:'DT',8:'DE',9:'LB',10:'CB',11:'S'};
export const NFL_TEAMS = {0:'FA',1:'ATL',2:'BUF',3:'CHI',4:'CIN',5:'CLE',6:'DAL',7:'DEN',8:'DET',9:'GB',10:'TEN',11:'IND',12:'KC',13:'LV',14:'LAR',15:'MIA',16:'MIN',17:'NE',18:'NO',19:'NYG',20:'NYJ',21:'PHI',22:'ARI',23:'PIT',24:'LAC',25:'SF',26:'SEA',27:'TB',28:'WSH',29:'CAR',30:'JAX',33:'BAL',34:'HOU'};
export const STAT_LABELS = {0:'Pass attempts',1:'Completions',2:'Incompletions',3:'Passing yards',4:'Passing touchdowns',5:'Every 5 passing yards',6:'Every 10 passing yards',7:'Every 20 passing yards',8:'Every 25 passing yards',9:'Every 50 passing yards',10:'Every 100 passing yards',15:'40+ yard passing TD bonus',16:'50+ yard passing TD bonus',17:'300–399 passing yards',18:'400+ passing yards',19:'Passing two-point conversions',20:'Interceptions thrown',23:'Rush attempts',24:'Rushing yards',25:'Rushing touchdowns',26:'Rushing two-point conversions',27:'Every 5 rushing yards',28:'Every 10 rushing yards',29:'Every 20 rushing yards',30:'Every 25 rushing yards',31:'Every 50 rushing yards',32:'Every 100 rushing yards',35:'40+ yard rushing TD bonus',36:'50+ yard rushing TD bonus',37:'100–199 rushing yards',38:'200+ rushing yards',41:'Receptions',42:'Receiving yards',43:'Receiving touchdowns',44:'Receiving two-point conversions',45:'40+ yard receiving TD bonus',46:'50+ yard receiving TD bonus',47:'Every 5 receiving yards',48:'Every 10 receiving yards',49:'Every 20 receiving yards',50:'Every 25 receiving yards',51:'Every 50 receiving yards',52:'Every 100 receiving yards',53:'Each reception',56:'100–199 receiving yards',57:'200+ receiving yards',58:'Targets',63:'Fumble recovery touchdowns',64:'Times sacked',68:'Fumbles',72:'Fumbles lost',74:'Field goals: 50+ yards',77:'Field goals: 40–49 yards',80:'Field goals: under 40 yards',83:'Field goals made',85:'Field goals missed',86:'Extra points made',88:'Extra points missed',89:'D/ST: 0 points allowed',90:'D/ST: 1–6 points allowed',91:'D/ST: 7–13 points allowed',92:'D/ST: 14–17 points allowed',93:'Blocked kick return touchdowns',94:'Defensive touchdowns',95:'Defensive interceptions',96:'Defensive fumble recoveries',97:'Blocked kicks',98:'Safeties',99:'Sacks',101:'Kickoff return touchdowns',102:'Punt return touchdowns',103:'Interception return touchdowns',104:'Fumble return touchdowns',105:'Total return touchdowns',106:'Forced fumbles',107:'Assisted tackles',108:'Solo tackles',109:'Total tackles',113:'Passes defended',114:'Kickoff return yards',115:'Punt return yards',120:'Points allowed',121:'D/ST: 18–21 points allowed',122:'D/ST: 22–27 points allowed',123:'D/ST: 28–34 points allowed',124:'D/ST: 35–45 points allowed',125:'D/ST: 46+ points allowed',127:'Yards allowed',128:'D/ST: under 100 yards allowed',129:'D/ST: 100–199 yards allowed',130:'D/ST: 200–299 yards allowed',131:'D/ST: 300–349 yards allowed',132:'D/ST: 350–399 yards allowed',133:'D/ST: 400–449 yards allowed',134:'D/ST: 450–499 yards allowed',135:'D/ST: 500–549 yards allowed',136:'D/ST: 550+ yards allowed',201:'Field goals: 60+ yards',205:'Defensive two-point returns'};

export class SyncError extends Error {
  constructor(code, message, status = 502) { super(message); this.code = code; this.status = status; }
}

export function leagueIdentity(input, season) {
  let id = String(input ?? '').trim();
  if (id.startsWith('http')) {
    let url;
    try { url = new URL(id); } catch { throw new SyncError('invalid_league', 'Enter an ESPN football league link or league ID.', 400); }
    if (url.protocol !== 'https:' || url.hostname !== 'fantasy.espn.com' || !url.pathname.startsWith('/football/')) throw new SyncError('invalid_league', 'Use a fantasy.espn.com football league link.', 400);
    id = url.searchParams.get('leagueId') || '';
    season = url.searchParams.get('seasonId') || season;
  }
  const year = Number(season);
  if (!/^[1-9]\d{0,10}$/.test(id) || !Number.isSafeInteger(Number(id))) throw new SyncError('invalid_league', 'Enter a valid numeric ESPN league ID.', 400);
  if (!Number.isInteger(year) || year < 2018 || year > new Date().getUTCFullYear() + 1) throw new SyncError('invalid_season', 'Choose a supported ESPN season.', 400);
  return { leagueId: Number(id), season: year };
}

export function validateSession(input) {
  const swid = String(input?.swid || '');
  const espnS2 = String(input?.espnS2 || '');
  if (!/^\{?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\}?$/i.test(swid) || !espnS2 || espnS2.length > 20000 || /[\s;\r\n]/.test(espnS2)) throw new SyncError('sign_in_required', 'Sign into ESPN in this browser, then connect again.', 401);
  return { swid, espnS2 };
}

export function espnURL({ leagueId, season }, views, week) {
  const url = new URL(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`);
  for (const view of views) url.searchParams.append('view', view);
  if (week) url.searchParams.set('scoringPeriodId', String(week));
  return url.href;
}

async function readJSON(url, session, fetcher, filter) {
  const headers = { accept:'application/json', cookie:`SWID=${session.swid}; espn_s2=${session.espnS2}` };
  if (filter) headers['X-Fantasy-Filter'] = JSON.stringify(filter);
  let response;
  try { response = await fetcher(url, { method:'GET', headers, redirect:'error', signal:AbortSignal.timeout(18000) }); }
  catch { throw new SyncError('espn_unavailable', 'ESPN could not be reached. Your last successful import has been kept.'); }
  if ([401,403].includes(response.status)) throw new SyncError('reconnect_required', 'ESPN rejected the connection. Sign into ESPN and reconnect.', 401);
  if (response.status === 404) throw new SyncError('league_not_found', 'ESPN could not find this league and season. Check the link and account.', 404);
  if (response.status === 429) throw new SyncError('espn_busy', 'ESPN is limiting requests. Try again in a few minutes.', 429);
  if (!response.ok) throw new SyncError('espn_unavailable', 'ESPN could not complete the import. Try again shortly.');
  let data;
  try { data = await response.json(); } catch { throw new SyncError('reconnect_required', 'ESPN returned a sign-in page instead of league data. Reconnect your account.', 401); }
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new SyncError('unexpected_response', 'ESPN returned an unfamiliar response. No existing import was replaced.');
  return data;
}

function compactStats(stats, season) {
  return (stats || []).filter(s => s.seasonId === season && [0,1].includes(s.statSourceId)).map(s => ({
    sourceId:s.statSourceId, splitTypeId:s.statSplitTypeId, week:s.scoringPeriodId ?? 0,
    matchupPeriodId:s.matchupPeriodId ?? null, points:Number.isFinite(s.appliedTotal) ? s.appliedTotal : null, stats:s.stats || {},
  }));
}

export function normalizePlayer(entry, season, draft = new Map()) {
  const wrapped = entry.playerPoolEntry || entry;
  const p = wrapped.player || {};
  const id = Number(p.id ?? wrapped.id ?? entry.playerId);
  if (!Number.isSafeInteger(id) || id === 0 || !p.fullName) throw new SyncError('unexpected_player', 'A player record is incomplete. No existing import was replaced.');
  return {
    id, name:p.fullName, positionId:p.defaultPositionId ?? null, position:POSITIONS[p.defaultPositionId] || `Position ${p.defaultPositionId ?? '?'}`,
    nflTeamId:p.proTeamId ?? null, nflTeam:NFL_TEAMS[p.proTeamId] || 'Unknown', eligibleSlots:p.eligibleSlots || [],
    injuryStatus:p.injuryStatus || 'UNKNOWN', active:p.active ?? null, availability:wrapped.status || 'ROSTERED',
    onTeamId:wrapped.onTeamId ?? null, lineupSlotId:entry.lineupSlotId ?? null,
    lineupSlot:entry.lineupSlotId == null ? null : SLOTS[entry.lineupSlotId] || `Slot ${entry.lineupSlotId}`,
    acquisitionType:entry.acquisitionType ?? null, acquisitionDate:entry.acquisitionDate ?? null,
    keeperValue:entry.keeperValue ?? null, keeperValueFuture:entry.keeperValueFuture ?? null,
    draft:draft.get(id) || null, stats:compactStats(p.stats, season),
    percentOwned:p.ownership?.percentOwned ?? null, percentStarted:p.ownership?.percentStarted ?? null,
  };
}

export function normalizeLeague(core, available, identity, options = {}) {
  const s = core.settings;
  const counts = s?.rosterSettings?.lineupSlotCounts;
  const scoring = s?.scoringSettings?.scoringItems;
  if (Number(core.id) !== identity.leagueId || !s || !counts || !Array.isArray(scoring) || !scoring.length || !Array.isArray(core.teams) || !core.teams.length) throw new SyncError('incomplete_league', 'ESPN did not return complete league settings, scoring rules, and teams. No existing import was replaced.');
  if (s.size && core.teams.length !== s.size) throw new SyncError('incomplete_teams', 'ESPN returned only part of the league. No existing import was replaced.');
  if (core.teams.some(t => !Array.isArray(t.roster?.entries))) throw new SyncError('incomplete_rosters', 'ESPN did not return every team’s roster. No existing import was replaced.');
  const draft = new Map((core.draftDetail?.picks || []).map(p => [p.playerId, {auctionPrice:p.bidAmount ?? null, overallPick:p.overallPickNumber ?? null, round:p.roundId ?? null, teamId:p.teamId ?? null, keeper:p.keeper ?? null}]));
  const teams = core.teams.map(t => ({
    id:t.id, name:t.name || [t.location,t.nickname].filter(Boolean).join(' ') || t.abbrev || `Team ${t.id}`,
    abbreviation:t.abbrev || '', rank:t.playoffSeed ?? t.rankCalculatedFinal ?? null,
    record:t.record || null, pointsFor:t.points ?? t.record?.overall?.pointsFor ?? null,
    transactionCounter:t.transactionCounter || {}, waiverRank:t.waiverRank ?? null,
    roster:t.roster.entries.map(e => normalizePlayer(e, identity.season, draft)),
  }));
  const rosterIds = new Set(teams.flatMap(t => t.roster.map(p => p.id)));
  const players = new Map();
  for (const p of available) { const n = normalizePlayer(p, identity.season, draft); if (!rosterIds.has(n.id) && ['FREEAGENT','WAIVERS'].includes(n.availability) && !(n.onTeamId > 0)) players.set(n.id,n); }
  const normalizeSwid = id => String(id || '').replace(/[{}]/g,'').toLowerCase();
  const myTeamIds = options.viewerSwid ? core.teams.filter(t => (t.owners || []).some(id => normalizeSwid(id) === normalizeSwid(options.viewerSwid))).map(t => t.id) : [];
  const warnings = [];
  if (!options.availableComplete) warnings.push('The available-player pool is incomplete. Refresh before relying on replacement options.');
  if (!Array.isArray(core.schedule) || !core.schedule.length) warnings.push('The remaining matchup schedule was not returned.');
  if (!core.draftDetail?.picks?.length) warnings.push('Draft prices were not returned. Keeper costs may need a separate source.');
  return {
    schemaVersion:1, connectorVersion:VERSION, platform:'espn', leagueId:identity.leagueId, season:identity.season,
    name:s.name || 'ESPN league', importedAt:options.now || new Date().toISOString(), week:core.scoringPeriodId ?? core.status?.currentScoringPeriod ?? null,
    teamCount:teams.length, myTeamIds, status:core.status || {},
    rules:{
      roster:s.rosterSettings, scoring:s.scoringSettings, acquisition:s.acquisitionSettings || {}, trade:s.tradeSettings || {},
      schedule:s.scheduleSettings || {}, draft:s.draftSettings || {},
      lineupSlots:Object.entries(counts).filter(([,count]) => count > 0).map(([id,count]) => ({id:Number(id),name:SLOTS[id] || `Slot ${id}`,count})),
      scoringItems:scoring.map(item => ({...item,label:STAT_LABELS[item.statId] || `ESPN scoring category ${item.statId}`})),
    },
    teams, availablePlayers:[...players.values()],
    schedule:(core.schedule || []).map(m => ({id:m.id,matchupPeriodId:m.matchupPeriodId,winner:m.winner ?? null,playoffTierType:m.playoffTierType ?? null,
      home:m.home ? {teamId:m.home.teamId,totalPoints:m.home.totalPoints ?? null,totalProjectedPoints:m.home.totalProjectedPoints ?? null,pointsByScoringPeriod:m.home.pointsByScoringPeriod || {}} : null,
      away:m.away ? {teamId:m.away.teamId,totalPoints:m.away.totalPoints ?? null,totalProjectedPoints:m.away.totalProjectedPoints ?? null,pointsByScoringPeriod:m.away.pointsByScoringPeriod || {}} : null})),
    coverage:{settings:true,rosters:true,schedule:!!core.schedule?.length,availablePlayers:!!options.availableComplete,draft:!!core.draftDetail?.picks?.length},
    keeperRules:{platform:s.draftSettings || {},houseRules:null,reviewRequired:true},
    warnings,
  };
}

export async function importLeague(identity, sessionInput, {fetcher = fetch, now, pageSize = 250, maxPages = 40} = {}) {
  const session = validateSession(sessionInput);
  const started = Date.now();
  const core = await readJSON(espnURL(identity,['mSettings','mTeam','mRoster','mMatchup','mStatus','mDraftDetail']),session,fetcher);
  if (!core.settings || !Array.isArray(core.teams)) throw new SyncError('incomplete_league', 'ESPN did not return league settings and rosters. Reconnect and try again.');
  const available = [], seen = new Set();
  let complete = false;
  for (let page = 0; page < maxPages; page++) {
    if (Date.now()-started > 65000) break;
    const filter = {players:{filterStatus:{value:['FREEAGENT','WAIVERS']},limit:pageSize,offset:page * pageSize,sortPercOwned:{sortPriority:1,sortAsc:false}}};
    const data = await readJSON(espnURL(identity,['kona_player_info'],core.scoringPeriodId || 1),session,fetcher,filter);
    if (!Array.isArray(data.players)) throw new SyncError('incomplete_available', 'ESPN did not return available players. No existing import was replaced.');
    let added = 0;
    for (const player of data.players) {
      const id = player.player?.id ?? player.id;
      if (!seen.has(id)) { seen.add(id); available.push(player); added++; }
    }
    if (data.players.length < pageSize || (Number.isFinite(data.total) && seen.size >= data.total)) { complete = true; break; }
    if (!added) break; // ESPN ignored pagination; explicitly mark the pool incomplete.
  }
  return normalizeLeague(core,available,identity,{availableComplete:complete,viewerSwid:session.swid,now});
}
