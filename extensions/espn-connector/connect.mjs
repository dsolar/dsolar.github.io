const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.hash.slice(1));
const year=new Date().getFullYear();
$('season').value=params.get('season') || (new Date().getMonth()<2?year-1:year);
$('season').max=year+1;
if(params.get('leagueId')) $('league').value=params.get('leagueId');

async function request(command,data={}) {
  const response=await chrome.runtime.sendMessage({source:'sdn-espn-bridge-v1',command,...data});
  if(!response?.ok) throw new Error(response?.error?.message || 'The connector did not respond. Reload this page and try again.');
  return response.data;
}
async function findLeagues(){
  const data=await request('openLeagues');
  $('league-tabs').replaceChildren();
  for(const league of data.leagues){const option=document.createElement('option');option.value=JSON.stringify(league);option.textContent=`${league.name} · ${league.season}`;$('league-tabs').append(option);}
  $('open-leagues').hidden=!data.leagues.length;
  if(data.leagues.length && !params.get('leagueId')) selectTab();
}
function selectTab(){const selected=$('league-tabs').value;if(selected){const league=JSON.parse(selected);$('league').value=league.leagueId;$('season').value=league.season;}}
$('league-tabs').addEventListener('change',selectTab);
$('find-leagues').addEventListener('click',()=>findLeagues().catch(()=>{}));
$('connect-form').addEventListener('submit',async event=>{
  event.preventDefault();
  $('connect').disabled=true;$('status').className='';$('status').textContent='Reading ESPN’s league settings, every roster, and the available-player pool. This can take a minute.';
  try{
    const result=await request('connect',{leagueId:$('league').value,season:Number($('season').value)});
    const s=result.snapshot;
    $('status').textContent='Connected. Your league data has been imported.';
    $('league-name').textContent=s.name;
    $('import-summary').textContent=`${s.teamCount} teams · ${s.teams.reduce((n,t)=>n+t.roster.length,0)} rostered players · ${s.availablePlayers.length} available players. ${s.coverage.availablePlayers?'The available-player pool is complete.':'The available-player pool needs another refresh; the league page shows its current coverage.'}`;
    $('success').hidden=false;$('success').scrollIntoView({behavior:'smooth'});
  }catch(error){$('status').className='error';$('status').textContent=error.message;}
  finally{$('connect').disabled=false;}
});
$('view').addEventListener('click',()=>request('openSite'));
findLeagues().catch(()=>{});
