import {findMutualTrades} from './lib/finder.mjs?v=3';
self.addEventListener('message',async event=>{
  try{
    const {snapshot,teamId,settings,overrides,options}=event.data;
    const result=await findMutualTrades(snapshot,teamId,settings,overrides,options,progress=>self.postMessage({type:'progress',progress}));
    self.postMessage({type:'result',result});
  }catch(error){self.postMessage({type:'error',message:error.message || 'The search could not be completed.'});}
});
