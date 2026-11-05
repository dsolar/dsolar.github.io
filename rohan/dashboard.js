(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const node = (tag, text, cls) => { const el = document.createElement(tag); el.textContent = text; if(cls) el.className = cls; return el; };
  fetch('league.json', {cache:'no-store'}).then(r => {if(!r.ok) throw Error(); return r.json();}).then(data => {
    const teams = [...data.teams].sort((a,b) => a.rank-b.rank);
    $('desk-source').textContent = `Saved Week ${data.week} · Updated ${new Date(data.updated).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'America/New_York'})}. Standings and roster notes below describe this snapshot, not a live ESPN connection.`;
    teams.forEach(t => {
      const tr=node('tr',''); if(t.rank===6) tr.className='chase-cut';
      tr.append(node('td',String(t.rank).padStart(2,'0')));
      const team=node('td',''); team.append(node('strong',t.name),node('small',t.owner));tr.append(team,node('td',t.record),node('td',t.rank<=2?'Bye position':t.rank<=6?'CHASE position':'Chasing'));
      $('desk-standings').append(tr);
      const option=node('option',t.name);option.value=t.name;$('desk-team').append(option);
    });
    let saved;try{saved=localStorage.getItem('rohan:desk-team');}catch{}
    if(teams.some(t=>t.name===saved)) $('desk-team').value=saved;
    const render=()=>{
      const t=teams.find(t=>t.name===$('desk-team').value);if(!t)return;
      const starters=t.players.filter(p=>!['Bench','IR'].includes(p[0]));
      const flagged=starters.filter(p=>['Q','D','O','DTD','IR','SUSP'].includes(p[4]));
      const next=t.players.filter(p=>p[0]!=='IR'&&data.bye_next.includes(p[2]));
      const missing=Object.entries({QB:1,RB:2,WR:3,TE:1,FLEX:1,'D/ST':1,K:1}).flatMap(([slot,count])=>starters.filter(p=>p[0]===slot).length<count?[slot]:[]);
      const focus=$('desk-focus');focus.replaceChildren(node('h3',`${t.record} · No. ${t.rank}`));
      const notes=[['Lineup check',missing.length?`Unfilled in snapshot: ${missing.join(', ')}. Review these slots on ESPN.`:'All ten starting slots are represented in this snapshot.'],['Health watch',flagged.length?flagged.map(p=>`${p[1]} (${p[4]})`).join(' · '):'No flagged starters in this snapshot. Check current designations before kickoff.'],['Snapshot-week bye exposure',next.length?`${next.length} rostered players: ${next.map(p=>p[1]).join(', ')}.`:'No active-roster players on the listed snapshot-week bye teams.']];
      notes.forEach(([title,text])=>{const item=node('div','','desk-note');item.append(node('h4',title),node('p',text));focus.append(item);});
      try{localStorage.setItem('rohan:desk-team',t.name);}catch{}
    };
    $('desk-team').addEventListener('change',render);render();
  }).catch(()=>{$('desk-source').textContent='The league snapshot could not load. Use Open ESPN above for the official league.';});
})();
