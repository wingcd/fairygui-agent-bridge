// Bound expensive browser renders while keeping independent projects concurrent.
export class RenderGate {
 constructor(limit){if(!Number.isInteger(limit)||limit<1)throw new Error('render limit must be a positive integer');this.limit=limit;this.active=0;this.waiting=[];}
 async run(task,{signal}={}){
  const aborted=()=>Object.assign(new Error('render request cancelled'),{name:'AbortError'});
  await new Promise((resolve,reject)=>{
   if(signal?.aborted){reject(aborted());return;}
   let grant;const cancel=()=>{const index=this.waiting.indexOf(grant);if(index>=0){this.waiting.splice(index,1);reject(aborted());}};
   grant=()=>{signal?.removeEventListener('abort',cancel);resolve();};
   if(this.active<this.limit){this.active++;grant();}else{this.waiting.push(grant);signal?.addEventListener('abort',cancel,{once:true});}
  });
  try{if(signal?.aborted)throw aborted();return await task();}finally{const next=this.waiting.shift();if(next)next();else this.active--;}
 }
}
const configured=process.env.FGUI_PIXI_CONCURRENCY;
if(configured!==undefined&&!/^[1-4]$/.test(configured))throw new Error('FGUI_PIXI_CONCURRENCY must be an integer between 1 and 4');
export const pixiRenderGate=new RenderGate(configured===undefined?4:Number(configured));
