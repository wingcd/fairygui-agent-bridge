import {attr,children} from './project.mjs';

// Convert editor frames and values to the runtime transition representation.
export function readTransitions(node, displayIds, requireUrl, warnings=[], component=null) {
  const result=[], names=new Set(), hasText=n=>Array.from(n.childNodes).some(c=>(c.nodeType===3||c.nodeType===4)&&c.data.trim());
  const integer=(value,min,max,label)=>{if(!/^[+-]?\d+$/.test(value)||Number(value)<min||Number(value)>max)throw new Error(`invalid transition ${label}`);return Number(value);};
  const kinds={XY:0,Size:1,Scale:2,Pivot:3,Alpha:4,Rotation:5,Color:6,Animation:7,Visible:8,Sound:9,Transition:10,Shake:11,ColorFilter:12,Text:14,Icon:15};
  const easeNames=['Linear',...['Sine','Quad','Cubic','Quart','Quint','Expo','Circ','Elastic','Back','Bounce'].flatMap(f=>['In','Out','InOut'].map(m=>`${f}.${m}`))];
  for(const trans of children(node,'transition')) {
    const name=attr(trans,'name'),auto=attr(trans,'autoPlay')??'false';
    if(!name||names.has(name)||Array.from(trans.attributes).some(a=>!['name','options','autoPlay','autoPlayRepeat'].includes(a.name))||hasText(trans)||!['true','false'].includes(auto))throw new Error('invalid transition settings');names.add(name);
    const output={name,options:integer(attr(trans,'options')??'0',0,2147483647,'options'),autoPlay:auto==='true',autoPlayTimes:integer(attr(trans,'autoPlayRepeat')??'1',-1,2147483647,'repeat'),items:[]};
    for(const item of children(trans)) {
      if(item.tagName!=='item'||children(item).length||hasText(item)||Array.from(item.attributes).some(a=>!['type','time','target','tween','startValue','endValue','value','duration','ease','repeat','yoyo','label','label2','path'].includes(a.name)))throw new Error('unsupported transition item');
      const kind=kinds[attr(item,'type')],target=attr(item,'target'),tween=attr(item,'tween')??'false';if(kind===undefined||!['true','false'].includes(tween))throw new Error('invalid transition action');if(target&&!displayIds.includes(target)){warnings.push({component,transition:name,target,message:'transition item omitted because its target is missing, matching editor output'});continue;}
      const value=raw=>{
        if(raw===null)throw new Error('missing transition value');
        if(kind===6){if(!/^#[0-9a-f]{6}$/i.test(raw))throw new Error('invalid transition color');return [1,3,5].map(i=>parseInt(raw.slice(i,i+2),16)).concat(255);}
        if(kind===8){if(!['true','false'].includes(raw))throw new Error('invalid transition visibility');return raw==='true';}
        if(kind===7){const p=raw.split(',');if(p.length!==2||!['p','s'].includes(p[1]))throw new Error('invalid transition animation');return {frame:integer(p[0],0,2147483647,'animation'),playing:p[1]==='p'};}
        if(kind===9){if(raw.startsWith('ui://'))requireUrl(raw,['sound']);return {sound:raw,volume:1};}
        if(kind===10)return {name:raw,times:1};
        if(kind===14||kind===15){if(kind===15&&raw.startsWith('ui://'))requireUrl(raw,['image','component','movieclip']);return raw;}
        const parts=raw.split(','),count=kind===12?4:[0,1,2,3,11].includes(kind)?2:1;if(parts.length!==count||parts.some(v=>!(v==='-'&&[0,1,3].includes(kind))&&(!v.trim()||!Number.isFinite(Number(v))||Math.abs(Number(v))>100000)))throw new Error('invalid transition value');const values=parts.map(v=>v==='-'?0:Number(v));return [0,1,3].includes(kind)?{flags:parts.map(v=>v!=='-'),values}:values;
      };
      const tick=Math.fround(1/24),entry={type:kind,time:integer(attr(item,'time')??'0',0,2400000,'time')*tick,target:target?displayIds.indexOf(target):-1,label:attr(item,'label')};
      if(tween==='true'){
        const ease=easeNames.indexOf(attr(item,'ease')??'Quad.Out'),yoyo=attr(item,'yoyo')??'false';if(![0,1,2,3,4,5,6,12].includes(kind)||ease<0||!['true','false'].includes(yoyo))throw new Error('invalid transition tween');
        entry.tween={duration:integer(attr(item,'duration')??'0',0,2400000,'duration')*tick,ease,repeat:integer(attr(item,'repeat')??'0',-1,2147483647,'repeat'),yoyo:yoyo==='true',endLabel:attr(item,'label2'),start:value(attr(item,'startValue')),end:value(attr(item,'endValue'))};
        if(item.hasAttribute('path')){if(kind!==0)throw new Error('transition path requires XY');const p=attr(item,'path').split(',');if(!p.length||p.length%8||p.length/8>32767)throw new Error('invalid transition path');entry.tween.path=[];for(let i=0;i<p.length;i+=8){const q=p.slice(i,i+8);if(q[0]!=='2'||!['0','1'].includes(q[7])||q.slice(1,7).some(v=>!v.trim()||!Number.isFinite(Number(v))||Math.abs(Number(v))>1000000))throw new Error('invalid transition path point');entry.tween.path.push({curve:2,points:q.slice(1,7).map(Number)});}}
      }else{if(['duration','repeat','ease','yoyo','startValue','endValue','label2','path'].some(k=>item.hasAttribute(k)))throw new Error('transition tween settings without tween');entry.value=value(attr(item,'value'));}
      output.items.push(entry);
    }
    if(output.items.length>32767)throw new Error('too many transition items');result.push(output);
  }
  if(result.length>32767)throw new Error('too many transitions');return result;
}
