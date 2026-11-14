// Decode the value and tween sections of one bounded transition-item record.
export function readTransitionItemDetails(raw,start,end,version,resolveRef){
 const count=raw[start],small=raw[start+1],header=2+count*(small?2:4);
 if(!count||![0,1].includes(small)||start+header>end)throw new Error('invalid transition item index');
 const offsets=Array.from({length:count},(_,i)=>small?raw.readUInt16BE(start+2+i*2):raw.readInt32BE(start+2+i*4));
 if(offsets.some(offset=>offset!==0&&(offset<header||start+offset>=end)))throw new Error('invalid transition item offset');
 const section=index=>{const offset=offsets[index];if(!offset||offset<header||start+offset>=end)throw new Error('missing or invalid transition item section');const next=offsets.filter(n=>n>offset);return {pos:start+offset,end:next.length?start+Math.min(...next):end};};
 const head=section(0);if(head.pos+10>head.end)throw new Error('truncated transition item header');const type=raw[head.pos],tween=Boolean(raw[head.pos+9]);
 const readValue=sectionIndex=>{
  const state=section(sectionIndex),take=n=>{const at=state.pos;state.pos+=n;if(state.pos>state.end)throw new Error('truncated transition value');return at;};
  const byte=()=>raw[take(1)],number=()=>raw.readFloatBE(take(4)),int=()=>raw.readInt32BE(take(4)),ref=()=>resolveRef(raw.readUInt16BE(take(2)));let value;
  if([0,1,3,13].includes(type)){const flags=[Boolean(byte()),Boolean(byte())],values=[number(),number()];value={flags,values};if(type===0&&version>=2&&byte())value.percent=true;}
  else if([4,5].includes(type))value=[number()];else if([2,11].includes(type))value=[number(),number()];else if(type===6)value=[byte(),byte(),byte(),byte()];
  else if(type===7)value={playing:Boolean(byte()),frame:int()};else if(type===8)value=Boolean(byte());else if(type===9)value={sound:ref(),volume:number()};else if(type===10)value={name:ref(),times:int()};else if(type===12)value=[number(),number(),number(),number()];else if([14,15].includes(type))value=ref();else throw new Error('unsupported transition action type');
  return {value,state};
 };
 if(!tween)return {value:readValue(2).value};
 const config=section(1);if(config.pos+12>config.end)throw new Error('truncated transition tween');const at=config.pos,settings={duration:raw.readFloatBE(at),ease:raw[at+4],repeat:raw.readInt32BE(at+5),yoyo:Boolean(raw[at+9]),endLabel:resolveRef(raw.readUInt16BE(at+10)),start:readValue(2).value};
 const finish=readValue(3);settings.end=finish.value;if(version>=2){if(finish.state.pos+4>finish.state.end)throw new Error('truncated transition path');const n=raw.readInt32BE(finish.state.pos);finish.state.pos+=4;if(n<0||n>(finish.state.end-finish.state.pos)/9)throw new Error('invalid transition path count');if(n){settings.path=[];for(let i=0;i<n;i++){if(finish.state.pos>=finish.state.end)throw new Error('truncated transition path');const curve=raw[finish.state.pos++],count=curve===1?4:curve===2?6:2;if(curve>3||finish.state.pos+count*4>finish.state.end)throw new Error('invalid transition path');const points=[];for(let j=0;j<count;j++){points.push(raw.readFloatBE(finish.state.pos));finish.state.pos+=4;}settings.path.push({curve,points});}}}
 return {tweenConfig:settings};
}
