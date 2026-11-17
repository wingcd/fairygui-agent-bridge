import {attr,children} from './project.mjs';

// Translate the supported source gear forms into the records stored in binary
// packages. Unknown gear pages are retained, matching the editor publisher.
export function sourceGears(child,controllers) {
 const kinds={gearDisplay:0,gearXY:1,gearSize:2,gearLook:3,gearColor:4,gearAni:5,gearText:6,gearIcon:7,gearDisplay2:8,gearFontSize:9};
 const gears=[];
 for(const node of children(child)){
  if(!Object.hasOwn(kinds,node.tagName))continue;
  const type=kinds[node.tagName],controller=controllers.findIndex(item=>item.name===attr(node,'controller'));
  if(controller<0)throw new Error('invalid source gear controller');
  const pages=attr(node,'pages')?attr(node,'pages').split(','):[],gear={type,controller};
  if(type===0||type===8)gear.pages=pages;
  else {
   if(!node.hasAttribute('values'))throw new Error('source gear requires values');
   const values=attr(node,'values').split('|');if(values.length!==pages.length)throw new Error('source gear pages and values differ');
   const number=value=>{if(!value.trim()||!Number.isFinite(Number(value)))throw new Error('invalid source gear number');return Number(value);};
   const parse=value=>{
    if(type===6)return value;if(type===7)return value||null;if(type===9){if(!/^\d+$/.test(value)||Number(value)>2147483647)throw new Error('invalid source font size gear');return Number(value);}
    const parts=value.split(',');
    if(type===4){if(parts.length===1)parts.push('#000000');if(parts.length!==2||parts.some(part=>!/^#[0-9a-f]{6}$/i.test(part)))throw new Error('invalid source gear color');return parts.map(part=>[1,3,5].map(i=>parseInt(part.slice(i,i+2),16)).concat(255));}
    if(type===5){if(parts.length!==2||!/^\d+$/.test(parts[0])||Number(parts[0])>2147483647||!['p','s'].includes(parts[1]))throw new Error('invalid source animation gear');return {playing:parts[1]==='p',frame:Number(parts[0])};}
    if(type===1&&parts.length!==2||type===2&&![2,4].includes(parts.length)||type===3&&![3,4].includes(parts.length))throw new Error('invalid source gear values');
    if([1,2].includes(type)&&parts.slice(0,2).some(part=>!/^[-+]?\d+$/.test(part)||Number(part)<-2147483648||Number(part)>2147483647||type===2&&Number(part)<0))throw new Error('invalid source gear integer');if(type===3&&parts.slice(2).some(part=>!['0','1'].includes(part)))throw new Error('invalid source gear look flags');
    const result=parts.map(number);if(type===2&&result.length===2)result.push(1,1);if(type===3){if(result.length===3)result.push(1);result[2]=Boolean(result[2]);result[3]=Boolean(result[3]);}return result;
   };
   gear.values=pages.flatMap((page,i)=>type!==6&&type!==7&&values[i]==='-'?[]:[{page,value:parse(values[i])}]);
   if(node.hasAttribute('default'))gear.default=parse(attr(node,'default'));
  }
  gear.tween=attr(node,'tween')==='true';
  if(gear.tween){const names=['Linear',...['Sine','Quad','Cubic','Quart','Quint','Expo','Circ','Elastic','Back','Bounce'].flatMap(f=>['In','Out','InOut'].map(mode=>`${f}.${mode}`))];gear.ease=names.indexOf(attr(node,'ease')??'Quad.Out');if(gear.ease<0)throw new Error('invalid source gear ease');gear.duration=Number(attr(node,'duration')??'0.3');gear.delay=Number(attr(node,'delay')??'0');}
  if(type===8)gear.condition=Number(attr(node,'condition')??'0');
  gears.push(gear);
 }
 return gears;
}
