import fs from 'node:fs';
import path from 'node:path';
import {projectRoot,packages,resources,componentPath,parse,attr,children} from './project.mjs';

export const gearOperations={set_display_gear:'gearDisplay',set_display2_gear:'gearDisplay2',set_text_gear:'gearText',set_color_gear:'gearColor',set_position_gear:'gearXY',set_size_gear:'gearSize',set_look_gear:'gearLook',set_font_size_gear:'gearFontSize',set_animation_gear:'gearAni',set_icon_gear:'gearIcon'};
export function gearAttributes(args,tag,node,root,existing) {
 const controllers=children(root,'controller').filter(c=>attr(c,'name')===args.controller);if(controllers.length!==1)throw new Error('controller not found or ambiguous');const parts=(attr(controllers[0],'pages')??'').split(','),known=new Set(parts.filter((_,i)=>i%2===0)),pages=args.pages;
 if(!Array.isArray(pages)||pages.length>32767||pages.some(p=>typeof p!=='string'||!p||!known.has(p))||new Set(pages).size!==pages.length)throw new Error('invalid gear pages');const attrs={controller:args.controller,pages:pages.join(',')};
 if(tag==='gearDisplay')return attrs;if(tag==='gearDisplay2'){if(![0,1].includes(args.condition))throw new Error('display2 condition must be 0 or 1');attrs.condition=String(args.condition);return attrs;}
 const values=args.values,def=args.default;if(!pages.length||!Array.isArray(values)||values.length!==pages.length||values.some(v=>typeof v!=='string'||v.includes('|'))||(def!==undefined&&typeof def!=='string'))throw new Error('gear requires one string per page');
 const numeric=(v,count)=>{const p=v.split(',');return count.includes(p.length)&&p.every(n=>n.trim()&&Number.isFinite(Number(n))&&Math.abs(Number(n))<=100000);};
 const valid=v=>{
  if(tag==='gearText')return true;
  if(tag==='gearIcon')return !v.includes('|');
  if(tag==='gearColor')return /^#[0-9a-f]{6}(?:,#[0-9a-f]{6})?$/i.test(v);
  if(tag==='gearFontSize')return /^\d+$/.test(v)&&Number(v)<=2147483647;
  if(tag==='gearAni')return /^\d+,[ps]$/.test(v)&&Number(v.split(',')[0])<=2147483647;
  if(tag==='gearLook'){const p=v.split(',');return numeric(v,[3,4])&&Number(p[0])>=0&&Number(p[0])<=1&&p.slice(2).every(x=>['0','1'].includes(x));}
  if(tag==='gearXY'||tag==='gearSize'){const p=v.split(',');return (tag==='gearXY'?p.length===2:[2,4].includes(p.length))&&p.slice(0,2).every(x=>/^[+-]?\d+$/.test(x)&&Number(x)>= (tag==='gearSize'?0:-2147483648)&&Number(x)<=2147483647)&&p.slice(2).every(x=>x.trim()&&Number.isFinite(Number(x))&&Math.abs(Number(x))<=100000);}
  return false;
 };
 if(values.some(v=>!(v==='-'&&!['gearText','gearIcon'].includes(tag))&&!valid(v))||(def!==undefined&&!valid(def)))throw new Error('invalid gear value');
 if(['gearText','gearFontSize'].includes(tag)&&!['text','richtext','inputtext'].includes(node.tagName))throw new Error('gear requires a text object');if(tag==='gearAni'&&!['movieclip','jta','loader'].includes(node.tagName))throw new Error('animation gear requires a movieclip or loader');
 if(['gearIcon','gearColor'].includes(tag)){const permitted=tag==='gearIcon'?['loader']:['text','richtext','inputtext','image','movieclip','jta','loader','graph'];if(node.tagName==='component'){const all=packages(projectRoot(args.project)),alias=attr(node,'pkg')||args.pkg,owner=all.filter(p=>alias===attr(p.tree,'id')||alias===path.basename(p.folder));if(owner.length!==1)throw new Error('component package missing or ambiguous');const item=resources(owner[0].tree).filter(i=>i.tagName==='component'&&attr(i,'id')===attr(node,'src'));if(item.length!==1||!['Label','Button','ComboBox'].includes(attr(parse(fs.readFileSync(componentPath(owner[0].folder,item[0])),'component'),'extention')))throw new Error('gear requires a compatible component');}else if(!permitted.includes(node.tagName))throw new Error('gear requires a compatible object');}
 if(tag==='gearIcon'){const all=packages(projectRoot(args.project));for(const url of [...values,...(def!==undefined?[def]:[])])if(url.startsWith('ui://')){const address=url.slice(5),slash=address.indexOf('/'),owners=all.filter(p=>slash>=0?path.basename(p.folder)===address.slice(0,slash):attr(p.tree,'id')===address.slice(0,8));if(owners.length!==1)throw new Error('icon package missing or ambiguous');const items=resources(owners[0].tree).filter(i=>['image','component','movieclip'].includes(i.tagName)&&(slash>=0?path.parse(attr(i,'name')??'').name===address.slice(slash+1):attr(i,'id')===address.slice(8)));if(items.length!==1)throw new Error('icon resource missing or ambiguous');componentPath(owners[0].folder,items[0]);}}
 attrs.values=values.join('|');if(def!==undefined)attrs.default=def;
 if(['gearXY','gearSize','gearLook'].includes(tag)){const keys=['tween','ease','duration','delay'],old=Object.fromEntries(keys.filter(k=>existing?.hasAttribute(k)).map(k=>[k,attr(existing,k)]));let settings=old;if(args.tween!==undefined){const t=args.tween;if(!t||typeof t!=='object'||Array.isArray(t)||typeof t.enabled!=='boolean'||Object.keys(t).some(k=>!['enabled','ease','duration','delay'].includes(k))||(!t.enabled&&Object.keys(t).length!==1)||['duration','delay'].some(k=>k in t&&(typeof t[k]!=='number'||!Number.isFinite(t[k]))))throw new Error('invalid gear tween');settings=t.enabled?{tween:'true',...Object.fromEntries(['ease','duration','delay'].filter(k=>k in t).map(k=>[k,String(t[k])]))}:{};}
  const eases=['Linear',...['Sine','Quad','Cubic','Quart','Quint','Expo','Circ','Elastic','Back','Bounce'].flatMap(f=>['In','Out','InOut'].map(m=>`${f}.${m}`))];if(!['true','false'].includes(settings.tween??'false')||((settings.tween??'false')==='false'&&Object.keys(settings).some(k=>k!=='tween'))||(settings.ease!==undefined&&!eases.includes(settings.ease))||['duration','delay'].some(k=>settings[k]!==undefined&&(!settings[k].trim()||!Number.isFinite(Number(settings[k]))||Number(settings[k])<0||Number(settings[k])>100000)))throw new Error('invalid gear tween');Object.assign(attrs,settings);
 }else if(args.tween!==undefined)throw new Error('tween unsupported for this gear');
 return attrs;
}
