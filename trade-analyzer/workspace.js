(() => {
  const workspace=document.getElementById('workspace');
  const update=()=>{
    document.body.classList.toggle('has-league',!workspace.hidden);
    document.getElementById('desk-help').textContent=workspace.hidden?'Connect your league above to unlock these workspaces. Your actual rosters and rules drive every comparison.':'Your league is loaded. Pick a question or work directly in the tabs below.';
  };
  document.querySelectorAll('[data-workspace]').forEach(button=>button.addEventListener('click',()=>{
    if(workspace.hidden){document.getElementById('setup').scrollIntoView({block:'start',behavior:'smooth'});document.getElementById('connect').focus({preventScroll:true});return;}
    const tab=document.getElementById('tab-'+button.dataset.workspace);tab.click();tab.scrollIntoView({block:'center',behavior:'smooth'});tab.focus({preventScroll:true});
  }));
  new MutationObserver(update).observe(workspace,{attributes:true,attributeFilter:['hidden']});update();
})();
