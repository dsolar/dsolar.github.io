import { leagueIdentity } from './espn.mjs';

const API = 'https://baxrczyufqbzrogftmyn.supabase.co/functions/v1/espn-sync';
const SITE = 'https://davidsolar.dev/trade-analyzer/';
const BRIDGE = 'sdn-espn-bridge-v1';
const publicCommands = new Set(['ping','open','leagues','snapshot','refresh','disconnect']);
const privateCommands = new Set(['connect','openLeagues','openSite']);

function senderKind(sender) {
  if (sender.id !== chrome.runtime.id || !sender.url) return null;
  try {
    const url = new URL(sender.url);
    if (url.protocol==='chrome-extension:' && url.hostname===chrome.runtime.id && url.pathname==='/connect.html') return 'extension';
    if (['https://davidsolar.dev','https://dsolar.github.io'].includes(url.origin) && url.pathname.startsWith('/trade-analyzer/')) return 'site';
  } catch { /* Reject malformed origins. */ }
  return null;
}

async function api(action, body, query = {}) {
  const { connectionToken } = await chrome.storage.local.get('connectionToken');
  if (!connectionToken) { const e = new Error('Connect ESPN in the extension first.'); e.code='not_connected'; throw e; }
  const url = new URL(API);
  url.searchParams.set('action',action);
  for (const [key,value] of Object.entries(query)) url.searchParams.set(key,String(value));
  let response;
  try { response = await fetch(url.href,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${connectionToken}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(120000),cache:'no-store'}); }
  catch { const e = new Error('The connection service could not be reached. Try again shortly.');e.code='network_error';throw e; }
  let result;
  try { result=await response.json(); } catch { const e=new Error('The connection service returned an unexpected response.');e.code='invalid_response';throw e; }
  if (!response.ok || result.error) { const e=new Error(result.error?.message || 'The request could not be completed.');e.code=result.error?.code || 'sync_failed';throw e; }
  return result;
}

async function notifySite() {
  const tabs = await chrome.tabs.query({url:['https://davidsolar.dev/trade-analyzer/*','https://dsolar.github.io/trade-analyzer/*']});
  await Promise.allSettled(tabs.map(tab=>chrome.tabs.sendMessage(tab.id,{type:'SDN_ESPN_UPDATED'})));
}

async function readESPNCookies() {
  const [swid,s2] = await Promise.all(['SWID','espn_s2'].map(name=>chrome.cookies.get({url:'https://fantasy.espn.com/',name})));
  if (!swid?.value || !s2?.value) { const e = new Error('Open ESPN and sign in in this browser, then try Connect again.');e.code='sign_in_required';throw e; }
  return {swid:swid.value,espnS2:s2.value};
}

async function command(message,sender) {
  const kind=senderKind(sender);
  if (!kind || message.source!==BRIDGE || !(publicCommands.has(message.command) || (kind==='extension' && privateCommands.has(message.command)))) { const e=new Error('This page is not allowed to use the ESPN connector.');e.code='not_allowed';throw e; }
  if (message.command==='ping') return {installed:true,version:chrome.runtime.getManifest().version};
  if (message.command==='openSite') { await chrome.tabs.create({url:SITE});return {opened:true}; }
  if (message.command==='open') {
    const identity = leagueIdentity(message.leagueId || 270405,message.season || new Date().getFullYear());
    await chrome.tabs.create({url:chrome.runtime.getURL(`connect.html#leagueId=${identity.leagueId}&season=${identity.season}`)});
    return {opened:true};
  }
  if (message.command==='openLeagues') {
    const tabs=await chrome.tabs.query({url:'https://fantasy.espn.com/football/*'});
    const leagues=new Map();
    for (const tab of tabs) {
      try { const identity=leagueIdentity(tab.url,new Date().getFullYear());leagues.set(`${identity.leagueId}:${identity.season}`,{...identity,name:(tab.title || '').replace(/ - ESPN.*$/,'') || `League ${identity.leagueId}`}); } catch { /* Non-league ESPN tabs are ignored. */ }
    }
    return {leagues:[...leagues.values()]};
  }
  if (message.command==='connect') {
    const identity=leagueIdentity(message.leagueId,message.season);
    const session=await readESPNCookies();
    const saved=await chrome.storage.local.get('connectionToken');
    if (!saved.connectionToken) {
      const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
      await chrome.storage.local.set({connectionToken:token});
    }
    const result=await api('connect',{...identity,session});
    await chrome.storage.local.set({selectedLeague:identity});
    await notifySite();
    // The site receives only league data. Cookies and connection tokens never
    // leave the extension's own contexts except in HTTPS backend requests.
    return {snapshot:result.snapshot};
  }
  if (message.command==='leagues') {
    const saved=await chrome.storage.local.get(['connectionToken','selectedLeague']);
    if (!saved.connectionToken) return {connected:false,leagues:[],selectedLeague:null};
    try { return {...await api('leagues'),connected:true,selectedLeague:saved.selectedLeague || null}; }
    catch(e) { if (['unauthorized','not_connected'].includes(e.code)) return {connected:false,leagues:[],selectedLeague:null};throw e; }
  }
  if (message.command==='disconnect') {
    await api('disconnect',{});
    await chrome.storage.local.remove(['connectionToken','selectedLeague']);
    await notifySite();
    return {disconnected:true};
  }
  const identity=leagueIdentity(message.leagueId,message.season);
  const result=message.command==='refresh'?await api('refresh',identity):await api('snapshot',undefined,identity);
  await chrome.storage.local.set({selectedLeague:identity});
  return result;
}

chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if (message?.source!==BRIDGE) return;
  command(message,sender).then(data=>respond({ok:true,data})).catch(error=>respond({ok:false,error:{code:error.code || 'connector_error',message:error.message || 'The connection failed.'}}));
  return true;
});
chrome.action.onClicked.addListener(()=>chrome.tabs.create({url:chrome.runtime.getURL('connect.html')}));
// Restrict storage access to extension pages and the service worker. A site
// content script cannot read the device token through chrome.storage.
void chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
