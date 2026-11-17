// Coalesce identical work while independently tracking each caller's cancellation.
export class SharedRenderRegistry {
 constructor(){this.entries=new Map();}
 snapshot(){return {jobs:this.entries.size,callers:[...this.entries.values()].reduce((total,entry)=>total+entry.users,0)};}
 run(key,start,signal){
  if(signal?.aborted)return Promise.reject(Object.assign(new Error('render request cancelled'),{name:'AbortError'}));
  let entry=this.entries.get(key),shared=!!entry;
  if(!entry){entry={controller:new AbortController(),users:0};this.entries.set(key,entry);entry.promise=Promise.resolve().then(()=>start(entry.controller.signal)).finally(()=>{if(this.entries.get(key)===entry)this.entries.delete(key);});entry.promise.catch(()=>{});}
  entry.users++;
  return new Promise((resolve,reject)=>{
   let done=false;
   const finish=(fn,value)=>{if(done)return;done=true;signal?.removeEventListener('abort',cancel);entry.users--;if(entry.users===0&&this.entries.get(key)===entry){this.entries.delete(key);entry.controller.abort();}fn(value);};
   const cancel=()=>finish(reject,Object.assign(new Error('render request cancelled'),{name:'AbortError'}));
   signal?.addEventListener('abort',cancel,{once:true});entry.promise.then(value=>finish(resolve,{value,shared}),error=>finish(reject,error));if(signal?.aborted)cancel();
  });
 }
}

export const pixiSharedRenders=new SharedRenderRegistry();
