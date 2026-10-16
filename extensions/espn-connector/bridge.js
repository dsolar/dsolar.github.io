(() => {
  'use strict';
  const SOURCE='sdn-espn-bridge-v1';
  const allowed=new Set(['ping','open','leagues','snapshot','refresh','disconnect']);
  window.addEventListener('message',event=>{
    const m=event.data;
    if (event.source!==window || event.origin!==location.origin || m?.type!=='SDN_ESPN_REQUEST' || typeof m.id!=='string' || m.id.length>100 || !allowed.has(m.command)) return;
    chrome.runtime.sendMessage({source:SOURCE,command:m.command,leagueId:m.leagueId,season:m.season},response=>{
      const failure=chrome.runtime.lastError;
      window.postMessage({type:'SDN_ESPN_RESPONSE',id:m.id,...(failure?{ok:false,error:{code:'extension_reloaded',message:'Refresh this page to reconnect the extension.'}}:response)},location.origin);
    });
  });
  chrome.runtime.onMessage.addListener(message=>{
    if (message?.type==='SDN_ESPN_UPDATED') window.postMessage({type:'SDN_ESPN_UPDATED'},location.origin);
  });
})();
