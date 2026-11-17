import fs from 'node:fs';
import {children,attr,componentPath} from './project.mjs';
import {Parser} from 'htmlparser2';

// Checks references expressible from project XML; does not claim runtime parity.
export function urlIndex(all) {
  const entries=new Map();
  const add=(url,record)=>entries.set(url,[...(entries.get(url)||[]),record]);
  for(const {folder,tree} of all)for(const item of children(children(tree,'resources')[0])){
    const id=attr(item,'id'),packageId=attr(tree,'id'),name=attr(item,'name'),record={type:item.tagName,isFile:()=>{try{return fs.statSync(componentPath(folder,item)).isFile();}catch{return false;}}};
    if(id&&packageId)add('ui://'+packageId+id,record);
    if(name)add('ui://'+folder.split(/[\\/]/).pop()+'/'+name.replace(/\.[^.]*$/,''),record);
  }
  return entries;
}
function* descendants(node) { yield node; for (const child of children(node)) yield* descendants(child); }
export function richTextUrls(value, ubb) {
  const urls=[];
  if (ubb) for (const m of value.matchAll(/(?<!\\)\[img(?:=[^\]]*)?\](ui:\/\/[^\[]+)(?=\[)/gi)) urls.push(m[1]);
  const parser=new Parser({onopentag(name,attrs) {if(name==='img' && attrs.src?.startsWith('ui://')) urls.push(attrs.src);}}, {decodeEntities:true,lowerCaseTags:true,lowerCaseAttributeNames:true});
  parser.end(value); return urls;
}
export function referenceIssues(node, resourceIndex, currentPackage, urls = null) {
  const issues = [], objects = children(children(node,'displayList')[0]), ids = new Set(objects.map(n=>attr(n,'id')));
  const size=attr(node,'size');
  if(size!==null){const parts=size.split(',');if(parts.length!==2||parts.some(part=>!/^\d+$/.test(part.trim())||Number(part)>2147483647))issues.push('component has invalid size');}
  const groups = new Set(objects.filter(n=>n.tagName === 'group').map(n=>attr(n,'id'))), controllers = new Map();
  const checkUrl=(url,owner,key,types=null)=>{const matches=urls?.get(url)??[];if(matches.length!==1)issues.push(`${owner.tagName} ${key} references unknown or ambiguous UI URL ${url}`);else if(types&&!types.includes(matches[0].type))issues.push(`${owner.tagName} ${key} references incompatible ${matches[0].type} UI resource ${url}`);else if(!matches[0].isFile())issues.push(`${owner.tagName} ${key} references missing UI resource file ${url}`);};
  if (urls) for (const element of descendants(node)) {
    if(element.tagName==='richtext') {
      const fields=[[element,'text']];
      for(const gear of children(element,'gearText')) for(const key of ['values','default']) fields.push([gear,key]);
      for(const [owner,key] of fields) { const value=attr(owner,key); if(value) for(const url of richTextUrls(value,attr(element,'ubb')==='true')) checkUrl(url,owner,key,['image','component','movieclip']); }
    }
    for (let i=0;i<element.attributes.length;i++) {
      const {name,value}=element.attributes.item(i);
      let urlField=['font','url','defaultItem','icon','selectedIcon','titleIcon','scrollBarRes','ptrRes','dropdown','sound'].includes(name);
      urlField ||= element.tagName==='gearIcon' && ['values','default'].includes(name);
      urlField ||= element.tagName==='item' && ['Sound','Icon'].includes(attr(element,'type')) && ['value','startValue','endValue'].includes(name);
      if(urlField)for(const url of element.tagName==='gearIcon'&&name==='values'?value.split('|'):urls.has(value)?[value]:value.split(/[,|]/))if(url.startsWith('ui://')){let types=null;if(name==='font')types=['font'];else if(name==='sound'||(element.tagName==='item'&&attr(element,'type')==='Sound'))types=['sound'];else if(['defaultItem','scrollBarRes','ptrRes','dropdown'].includes(name)||(name==='url'&&element.tagName==='item'&&element.parentNode?.tagName==='list'))types=['component'];else if(name==='url'&&element.tagName==='loader')types=['image','component','movieclip'];else if(['icon','selectedIcon','titleIcon'].includes(name)||element.tagName==='gearIcon'||(element.tagName==='item'&&attr(element,'type')==='Icon'))types=['image','component','movieclip'];checkUrl(url,element,name,types);}
    }
  }
  if(urls) {
    const rich=new Map(objects.filter(n=>n.tagName==='richtext' && attr(n,'id')).map(n=>[attr(n,'id'),n]));
    for(const transition of children(node,'transition')) for(const action of children(transition,'item')) {
      const target=rich.get(attr(action,'target')); if(attr(action,'type')!=='Text' || !target) continue;
      for(const key of ['value','startValue','endValue']) {const value=attr(action,key);if(value) for(const url of richTextUrls(value,attr(target,'ubb')==='true')) checkUrl(url,action,key,['image','component','movieclip']);}
    }
  }
  for (const field of ['mask','hitTest']) { const id = attr(node,field); if (id && !ids.has(id)) issues.push(`component ${field} references unknown child ${id}`); }
  if (attr(node,'reversedMask') === 'true' && !attr(node,'mask')) issues.push('component reversedMask requires a mask');
  for (const controller of children(node,'controller')) {
    const name = attr(controller,'name'), raw = attr(controller,'pages'), parts = raw ? raw.split(',') : [], pages = parts.filter((_,i)=>i%2===0);
    if (!name || controllers.has(name) || parts.length%2 || pages.some(p=>!p) || new Set(pages).size!==pages.length) { issues.push('invalid or duplicate controller or page IDs'); continue; }
    controllers.set(name,new Set(pages));
  }
  for (const child of objects) {
    const id = attr(child,'id') || '?', src = attr(child,'src'), pkg = attr(child,'pkg') || currentPackage;
    const xy=attr(child,'xy'),coordinates=xy===null?[]:xy.split(',');if(coordinates.length!==2||coordinates.some(v=>! /^[+-]?\d+$/.test(v.trim())||Number(v)<-2147483648||Number(v)>2147483647))issues.push(`child ${id}: missing or invalid xy`);
    if(['image','component','movieclip','jta'].includes(child.tagName)&&!src)issues.push(`child ${id}: ${child.tagName} requires a registered resource ID in src`);
    if (src) {
      const found = resourceIndex.get(pkg);
      if (!found) issues.push(`child ${id}: unknown package ${pkg}`);
      else if (!found.has(src)) issues.push(`child ${id}: unknown resource ${src} in package ${pkg}`);
      else { const expected = {image:'image',component:'component',movieclip:'movieclip',jta:'movieclip'}[child.tagName],record=found.get(src);if(expected && record.type!==expected)issues.push(`child ${id}: ${child.tagName} requires ${expected} resource, got ${record.type}`);if(!record.isFile())issues.push(`child ${id}: referenced resource file is missing or invalid: ${src}`); }
    }
    if(child.tagName==='group'&&children(child).some(n=>['image','component','text','richtext','inputtext','graph','loader','list','group','movieclip','jta'].includes(n.tagName)))issues.push(`child ${id}: group cannot contain nested display objects; use sibling objects with a group reference`);
    if(child.tagName==='group'){
      const layout=attr(child,'layout');if(layout!==null&&!['none','hz','vt'].includes(layout))issues.push(`child ${id}: invalid group layout`);
      for(const field of ['advanced','excludeInvisibles','autoSizeDisabled']){const value=attr(child,field);if(value!==null&&!['true','false'].includes(value))issues.push(`child ${id}: invalid group ${field}`);}
      for(const field of ['lineGap','colGap','mainGridIndex']){const value=attr(child,field),min=field==='mainGridIndex'?-32768:-2147483648,max=field==='mainGridIndex'?32767:2147483647;if(value!==null&&(!/^[+-]?\d+$/.test(value)||Number(value)<min||Number(value)>max))issues.push(`child ${id}: invalid group ${field}`);}
    }
    const group = attr(child,'group'); if (group && child.tagName==='group') issues.push(`child ${id}: groups cannot belong to groups`); if (group && !groups.has(group)) issues.push(`child ${id}: unknown group ${group}`);
    if (['list','tree'].includes(child.tagName)) {
      const enums={layout:['row','column','flow_hz','flow_vt','pagination'],selectionMode:['single','multiple','multipleSingleClick','none'],overflow:['visible','hidden','scroll'],scroll:['horizontal','vertical','both'],scrollBar:['default','visible','auto','hidden'],renderOrder:['ascent','descent','arch']};
      for(const [field,values] of Object.entries(enums)){const value=attr(child,field);if(value!==null&&!values.includes(value))issues.push(`child ${id}: invalid list ${field} ${value}`);}
      for(const field of ['pageController','selectionController']){const c=attr(child,field);if(c&&!controllers.has(c))issues.push(`child ${id}: ${field} references unknown controller ${c}`);}
    }
    for (const button of children(child,'Button')) {
      const c=attr(button,'controller'), page=attr(button,'page');
      if (c && !controllers.has(c)) issues.push(`child ${id}: Button references unknown controller ${c}`);
      else if (page && (!c || !controllers.get(c).has(page))) issues.push(`child ${id}: Button references unknown page ${page} in controller ${c || '?'}`);
    }
    for (const gear of children(child).filter(n=>n.tagName.startsWith('gear'))) {
      const c=attr(gear,'controller');
      if (!controllers.has(c)) { issues.push(`child ${id}: ${gear.tagName} references unknown controller ${c}`); continue; }
      for (const page of (attr(gear,'pages') || '').split(',').filter(Boolean)) if (!controllers.get(c).has(page)) issues.push(`child ${id}: ${gear.tagName} references unknown page ${page} in controller ${c}`);
    }
    for (const relation of children(child,'relation')) { const target=attr(relation,'target'); if(target && (!ids.has(target) || target===id)) issues.push(`child ${id}: relation references invalid target ${target}`); }
  }
  for (const relation of children(node,'relation')) { const target=attr(relation,'target'); if(target && !ids.has(target)) issues.push(`component relation references unknown target ${target}`); }
  for (const transition of children(node,'transition')) for (const item of children(transition,'item')) { const target=attr(item,'target'); if(target && !ids.has(target)) issues.push(`transition ${attr(transition,'name') || '?'}: unknown target ${target}`); }
  const transitions = new Set(children(node,'transition').map(n=>attr(n,'name')));
  for(const transition of children(node,'transition'))for(const item of children(transition,'item'))if(attr(item,'type')==='Transition'&&!attr(item,'target')&&attr(item,'value')&&!transitions.has(attr(item,'value')))issues.push(`transition ${attr(transition,'name')||'?'}: nested transition references unknown transition ${attr(item,'value')}`);
  for (const controller of children(node,'controller')) {
    const name=attr(controller,'name'); if (!controllers.has(name)) continue;
    for (const action of children(controller,'action')) {
      for (const key of ['fromPage','toPage']) for (const page of (attr(action,key)||'').split(',').filter(Boolean)) if (!controllers.get(name).has(page)) issues.push(`controller ${name}: action ${key} references unknown page ${page}`);
      const transition=attr(action,'transition'); if (attr(action,'type')==='play_transition' && transition && !transitions.has(transition)) issues.push(`controller ${name}: action references unknown transition ${transition}`);
    }
  }
  return issues;
}

export function resourceIndex(all) {
  const entries = new Map();
  for (const {folder,tree} of all) {
    const resources = new Map(), duplicateIds = new Set();
    for (const item of children(children(tree,'resources')[0])) {
      const id=attr(item,'id');if(!id)continue;
      if(resources.has(id)||duplicateIds.has(id)){resources.delete(id);duplicateIds.add(id);continue;}
      resources.set(id,{type:item.tagName,isFile:()=>{try{return fs.statSync(componentPath(folder,item)).isFile();}catch{return false;}}});
    }
    for (const alias of new Set([folder.split(/[\\/]/).pop(),attr(tree,'id')].filter(Boolean))) entries.set(alias,[...(entries.get(alias)||[]),resources]);
  }
  return new Map([...entries].filter(([,v])=>v.length===1).map(([k,v])=>[k,v[0]]));
}
