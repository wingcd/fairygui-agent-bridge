// Bound expensive browser renders while keeping independent projects concurrent.
export class RenderGate {
 constructor(limit){if(!Number.isInteger(limit)||limit<1)throw new Error('render limit must be a positive integer');this.limit=limit;this.active=0;this.waiting=[];}
 async run(task){
  await new Promise(resolve=>{if(this.active<this.limit){this.active++;resolve();}else this.waiting.push(resolve);});
  try{return await task();}finally{const next=this.waiting.shift();if(next)next();else this.active--;}
 }
}
const configured=process.env.FGUI_PIXI_CONCURRENCY;
if(configured!==undefined&&!/^[1-4]$/.test(configured))throw new Error('FGUI_PIXI_CONCURRENCY must be an integer between 1 and 4');
export const pixiRenderGate=new RenderGate(configured===undefined?4:Number(configured));
