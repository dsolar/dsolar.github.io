import { importLeague, leagueIdentity, validateSession, SyncError, VERSION } from './espn.mjs';

const encoder = new TextEncoder();
const LIFE = 90 * 86400000;
const INTERVAL = 20 * 60000;
const ALLOWED_ORIGINS = new Set(['https://davidsolar.dev','https://dsolar.github.io']);
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
export const hashToken = async token => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(token))),b=>b.toString(16).padStart(2,'0')).join('');

export async function sessionKey(secret) {
  const material = await crypto.subtle.importKey('raw',encoder.encode(secret),'HKDF',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:encoder.encode('sports-data-nonsense/espn'),info:encoder.encode('espn-session-v1')},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function sealSession(session, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('espn-session-v1')},key,encoder.encode(JSON.stringify(session)));
  return {version:1,iv:b64(iv),ciphertext:b64(new Uint8Array(cipher))};
}
export async function openSession(sealed,key) {
  try {
    const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(sealed.iv),additionalData:encoder.encode('espn-session-v1')},key,unb64(sealed.ciphertext));
    return validateSession(JSON.parse(new TextDecoder().decode(plain)));
  } catch { throw new SyncError('reconnect_required','Reconnect ESPN to renew the saved session.',401); }
}

export function createRestRepository(url, secret, fetcher = fetch) {
  async function request(table, {method='GET',query={},body,prefer} = {}) {
    const endpoint = new URL(`${url}/rest/v1/${table}`);
    for (const [k,v] of Object.entries(query)) endpoint.searchParams.set(k,String(v));
    const response = await fetcher(endpoint.href,{method,headers:{apikey:secret,Authorization:`Bearer ${secret}`,'Content-Type':'application/json',Prefer:prefer || 'return=representation'},body:body === undefined ? undefined : JSON.stringify(body),signal:AbortSignal.timeout(12000)});
    if (!response.ok) throw new SyncError('storage_unavailable','Your connection could not be saved. Please try again.',503);
    return response.status === 204 ? [] : response.json();
  }
  return {
    async connection(hash) { return (await request('espn_sync_connections',{query:{token_hash:`eq.${hash}`,limit:1}}))[0] || null; },
    async saveConnection(row) { return (await request('espn_sync_connections',{method:'POST',query:{on_conflict:'token_hash'},body:row,prefer:'resolution=merge-duplicates,return=representation'}))[0]; },
    async updateConnection(id,body) { await request('espn_sync_connections',{method:'PATCH',query:{id:`eq.${id}`},body}); },
    async leagues(id) { return request('espn_sync_leagues',{query:{connection_id:`eq.${id}`,select:'league_id,season,summary,status,last_synced_at,last_error',order:'last_synced_at.desc'}}); },
    async league(id,identity) { return (await request('espn_sync_leagues',{query:{connection_id:`eq.${id}`,league_id:`eq.${identity.leagueId}`,season:`eq.${identity.season}`,limit:1}}))[0] || null; },
    async saveLeague(row) { return (await request('espn_sync_leagues',{method:'POST',query:{on_conflict:'connection_id,league_id,season'},body:row,prefer:'resolution=merge-duplicates,return=representation'}))[0]; },
    async updateLeague(id,body) { await request('espn_sync_leagues',{method:'PATCH',query:{id:`eq.${id}`},body}); },
    async claimLeague(id,now) { return (await request('espn_sync_leagues',{method:'PATCH',query:{id:`eq.${id}`,or:`(sync_started_at.is.null,sync_started_at.lt.${new Date(Date.parse(now)-120000).toISOString()})`},body:{sync_started_at:now,last_attempt_at:now}})).length > 0; },
    async disconnect(id) { await request('espn_sync_connections',{method:'DELETE',query:{id:`eq.${id}`}}); },
    async schedulerHash() { return (await request('espn_sync_config',{query:{name:'eq.scheduler_token_hash',select:'value',limit:1}}))[0]?.value; },
    async due(now) { return request('espn_sync_leagues',{query:{next_sync_at:`lte.${now}`,status:'in.(connected,partial,error)',select:'*',order:'next_sync_at.asc',limit:4}}); },
    async connectionById(id) { return (await request('espn_sync_connections',{query:{id:`eq.${id}`,limit:1}}))[0] || null; },
    async purgeExpired(now) { await request('espn_sync_connections',{method:'DELETE',query:{expires_at:`lt.${now}`}}); },
  };
}

function summary(snapshot) {
  return {name:snapshot.name,teamCount:snapshot.teamCount,week:snapshot.week,availableCount:snapshot.availablePlayers.length,coverage:snapshot.coverage};
}

export function createHandler({supabaseUrl,serviceKey,repository,fetcher=fetch,clock=()=>new Date(),encryptionSecret} = {}) {
  const repo = repository || createRestRepository(supabaseUrl,serviceKey,fetcher);
  const key = sessionKey(encryptionSecret || serviceKey);
  const timestamp = () => clock().toISOString();
  const deadline = () => new Date(clock().getTime() + LIFE).toISOString();

  async function saveSnapshot(connection,snapshot,existingId) {
    return repo.saveLeague({...(existingId?{id:existingId}:{}),connection_id:connection.id,league_id:snapshot.leagueId,season:snapshot.season,
      snapshot,summary:summary(snapshot),status:snapshot.coverage.availablePlayers?'connected':'partial',last_synced_at:snapshot.importedAt,
      last_attempt_at:timestamp(),last_error:null,sync_started_at:null,next_sync_at:new Date(clock().getTime()+INTERVAL).toISOString()});
  }

  async function refresh(connection,league,force = false) {
    if (!force && league.last_attempt_at && clock().getTime()-Date.parse(league.last_attempt_at)<30000) return {snapshot:league.snapshot,cached:true};
    if (!await repo.claimLeague(league.id,timestamp())) return {snapshot:league.snapshot,cached:true};
    try {
      const session = await openSession(connection.session_cipher,await key);
      const snapshot = await importLeague({leagueId:league.league_id,season:league.season},session,{fetcher,now:timestamp()});
      await saveSnapshot(connection,snapshot,league.id);
      await repo.updateConnection(connection.id,{status:'connected',last_error:null});
      return {snapshot,cached:false};
    } catch (error) {
      const e = error instanceof SyncError ? error : new SyncError('sync_failed','The refresh failed. Your last successful import has been kept.');
      await repo.updateLeague(league.id,{status:e.status===401?'reconnect_required':'error',last_error:{code:e.code,message:e.message},sync_started_at:null,next_sync_at:new Date(clock().getTime()+INTERVAL).toISOString()});
      if (e.status===401) await repo.updateConnection(connection.id,{status:'reconnect_required',last_error:{code:e.code,message:e.message}});
      throw e;
    }
  }

  return async function handler(req) {
    const origin = req.headers.get('Origin');
    const allowed = !origin || ALLOWED_ORIGINS.has(origin) || /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
    const headers = {'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin',
      ...(origin && allowed ? {'Access-Control-Allow-Origin':origin} : {}),
      'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
    const send = (body,status=200) => new Response(JSON.stringify(body),{status,headers});
    if (!allowed) return send({error:{code:'origin_not_allowed',message:'Open the connection from davidsolar.dev.'}},403);
    if (req.method==='OPTIONS') return new Response(null,{status:204,headers});
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'health';
    try {
      if (action==='health' && req.method==='GET') return send({ok:true,version:VERSION,platform:'espn',mode:'read-only',refreshMinutes:20});
      if (action==='scheduled' && req.method==='POST') {
        const incoming = req.headers.get('X-ESPN-Scheduler') || '';
        if (!/^[a-f0-9]{64}$/.test(incoming) || await hashToken(incoming)!==await repo.schedulerHash()) throw new SyncError('unauthorized','Scheduler authentication required.',401);
        await repo.purgeExpired(timestamp());
        const due = await repo.due(timestamp());
        const results = await Promise.allSettled(due.map(async league=>{
          const connection = await repo.connectionById(league.connection_id);
          if (!connection || connection.status==='reconnect_required') return {skipped:true};
          return refresh(connection,league);
        }));
        return send({ok:true,attempted:results.length,succeeded:results.filter(x=>x.status==='fulfilled'&&!x.value.skipped).length,failed:results.filter(x=>x.status==='rejected').length});
      }
      if (!['GET','POST'].includes(req.method)) throw new SyncError('method_not_allowed','Use GET or POST.',405);
      const token = (req.headers.get('Authorization') || '').replace(/^Bearer /,'');
      if (!/^[a-f0-9]{64}$/.test(token)) throw new SyncError('unauthorized','Connect the ESPN extension first.',401);
      const hash = await hashToken(token);
      let connection = await repo.connection(hash);
      if (connection && Date.parse(connection.expires_at)<clock().getTime()) { await repo.disconnect(connection.id); connection=null; }
      let body = {};
      if (req.method==='POST') {
        if (Number(req.headers.get('Content-Length') || 0)>30000) throw new SyncError('request_too_large','The request is too large.',413);
        const text = await req.text();
        if (text.length>30000) throw new SyncError('request_too_large','The request is too large.',413);
        try { body = JSON.parse(text || '{}'); } catch { throw new SyncError('invalid_request','The request was not valid JSON.',400); }
      }
      if (action==='connect' && req.method==='POST') {
        const identity = leagueIdentity(body.leagueId,body.season);
        const session = validateSession(body.session);
        const existing = connection ? await repo.league(connection.id,identity) : null;
        if (existing?.last_attempt_at && clock().getTime()-Date.parse(existing.last_attempt_at)<15000) throw new SyncError('wait_a_moment','Please wait a few seconds before reconnecting.',429);
        const snapshot = await importLeague(identity,session,{fetcher,now:timestamp()});
        const cipher = await sealSession(session,await key);
        connection = await repo.saveConnection({id:connection?.id || crypto.randomUUID(),token_hash:hash,session_cipher:cipher,status:'connected',last_error:null,last_used_at:timestamp(),expires_at:deadline()});
        await saveSnapshot(connection,snapshot,existing?.id);
        return send({ok:true,snapshot,connection:{status:'connected',expiresAt:connection.expires_at}});
      }
      if (!connection) throw new SyncError('unauthorized','This browser has no active connection. Connect ESPN to continue.',401);
      await repo.updateConnection(connection.id,{last_used_at:timestamp(),expires_at:deadline()});
      if (action==='leagues' && req.method==='GET') return send({ok:true,status:connection.status,leagues:await repo.leagues(connection.id)});
      if (action==='disconnect' && req.method==='POST') { await repo.disconnect(connection.id); return send({ok:true}); }
      const identity = leagueIdentity(req.method==='POST'?body.leagueId:url.searchParams.get('leagueId'),req.method==='POST'?body.season:url.searchParams.get('season'));
      const league = await repo.league(connection.id,identity);
      if (!league) throw new SyncError('not_found','This league has not been connected in this browser.',404);
      if (action==='snapshot' && req.method==='GET') return send({ok:true,snapshot:league.snapshot,status:league.status,lastError:league.last_error});
      if (action==='refresh' && req.method==='POST') return send({ok:true,...await refresh(connection,league)});
      throw new SyncError('not_found','Unknown connection action.',404);
    } catch (error) {
      const e = error instanceof SyncError ? error : new SyncError('service_unavailable','The connection service is temporarily unavailable. Try again shortly.',503);
      // Never log errors containing requests, headers, ESPN responses, or cookies.
      return send({error:{code:e.code,message:e.message}},e.status);
    }
  };
}
