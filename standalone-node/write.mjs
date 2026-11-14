import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {XMLSerializer} from '@xmldom/xmldom';
import sharp from 'sharp';
import {inspectWav,inspectMp3,inspectOggVorbis} from './sound.mjs';
import {readJta} from './jta.mjs';
import {readBitmapFont} from './bitmap-font.mjs';
import {findReferences} from './find-references.mjs';
import {gearOperations,gearAttributes} from './gear-attributes.mjs';
import {instanceAttributes,comboInstanceElement} from './instance-attributes.mjs';
import {readTransitions} from './transitions.mjs';
import { projectRoot, packages, resources, componentPath, parse, decodeXml, children, attr } from './project.mjs';
import { resourceIndex, urlIndex, referenceIssues } from './references.mjs';
import { execute } from './project.mjs';

const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const utf8Declaration = xml => xml.replace(/^(\uFEFF?<\?xml\s+[^?]*?\bencoding\s*=\s*)(["'])([^"']+)\2/i, '$1$2utf-8$2');
const packageXmlForEdit = data => utf8Declaration(decodeXml(data,'package.xml',true));
function withProjectLock(root, fn) {
  const identity=process.platform==='win32' ? root.toLowerCase() : root;
  const lock=path.join(os.tmpdir(),'fgui-node-'+hash(Buffer.from(identity))+'.lock');
  try { fs.mkdirSync(lock); } catch (error) { if(error.code==='EEXIST') throw new Error(`another Node operation is using this project or a stale lock exists: ${lock}`); throw error; }
  try {return fn();} finally {fs.rmdirSync(lock);}
}
function validateShape(node) {
  if (node.tagName !== 'component') throw new Error('component root must be <component>');
  const lists=children(node,'displayList'); if(lists.length>1) throw new Error('component may have at most one displayList');
  const ids=children(lists[0]).map(n=>attr(n,'id'));
  if(ids.some(id=>!id) || new Set(ids).size!==ids.length) throw new Error('displayList children must have unique nonempty ids');
}
export function writeComponent(args) {
  const root=projectRoot(args.project);
  return withProjectLock(root,()=>writeComponentLocked(args,root));
}
function writeComponentLocked(args,root,beforeCommit=null) {
  if (typeof args.xml !== 'string' || typeof args.expected_sha256 !== 'string') throw new Error('xml and expected_sha256 are required');
    const all=packages(root), found=all.filter(p=>args.pkg===path.basename(p.folder) || args.pkg===attr(p.tree,'id'));
    if(found.length!==1) throw new Error('package not found or ambiguous');
    const {folder,tree}=found[0], matches=resources(tree).filter(n=>n.tagName==='component' && [attr(n,'id'),attr(n,'name'),path.parse(attr(n,'name')||'').name].includes(args.name));
    if(matches.length!==1) throw new Error('component not found or ambiguous');
    const file=componentPath(folder,matches[0]), old=fs.readFileSync(file), before=hash(old);
    if(before!==args.expected_sha256) throw new Error('expected_sha256 is required and must match current file; read it again');
    // XML arrives as a JavaScript string and is written as UTF-8. Keep any
    // encoding declaration consistent with the bytes, including when the
    // string came from a UTF-16 component returned by read_component.
    const xml=utf8Declaration(args.xml);
    let previous; try { previous=parse(old,'component'); } catch { previous=null; }
    const data=Buffer.from(xml,'utf8'), updated=parse(data,'component');
    validateShape(updated);
    const index=resourceIndex(all), urls=urlIndex(all), label=path.basename(folder);
    const previousIssues=previous?.tagName==='component'?referenceIssues(previous,index,label,urls):[], newIssues=referenceIssues(updated,index,label,urls);
    const counts=new Map(); for(const issue of previousIssues) counts.set(issue,(counts.get(issue)||0)+1);
    const introduced=[]; for(const issue of newIssues) {const n=counts.get(issue)||0; if(n) counts.set(issue,n-1); else introduced.push(issue);}
    if(introduced.length) throw new Error('new invalid component reference: '+introduced.join('; '));
    const temp=path.join(path.dirname(file),'.fgui-'+crypto.randomBytes(16).toString('hex')+'.tmp');
    try {
      const fd=fs.openSync(temp,'wx'); try {fs.writeFileSync(fd,data);fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
      if(beforeCommit)beforeCommit();
      if(hash(fs.readFileSync(file))!==before) throw new Error('file changed during write');
      fs.renameSync(temp,file);
    } finally {try {fs.unlinkSync(temp);} catch(error) {if(error.code!=='ENOENT') throw error;}}
    return {path:file,sha256:hash(data)};
}

export function createPackage(args) {
  if(process.platform!=='win32')throw new Error('package creation requires a no-replace directory rename, currently supported only on Windows');
  const name=args.name;
  if(typeof name!=='string' || !/^[\p{L}\p{N}\p{M}_ -]{1,100}$/u.test(name) || name.trim()!==name || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name))throw new Error('invalid package name');
  const root=projectRoot(args.project);
  return withProjectLock(root,()=>{
    const all=packages(root), lower=name.toLocaleLowerCase('en-US');
    if(all.some(p=>[path.basename(p.folder),attr(p.tree,'id')||''].some(s=>s.toLocaleLowerCase('en-US')===lower)))throw new Error('package name already exists or conflicts with an ID');
    const occupied=new Set(all.flatMap(p=>[path.basename(p.folder).toLocaleLowerCase('en-US'),(attr(p.tree,'id')||'').toLocaleLowerCase('en-US')]));
    let id;do{id=crypto.randomBytes(4).toString('hex');}while(occupied.has(id));
    const assets=path.join(root,'assets'), target=path.join(assets,name);
    if(fs.existsSync(target))throw new Error('package directory already exists');
    const escaped=name.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
    const xml=`<?xml version="1.0" encoding="utf-8"?>\n<packageDescription id="${id}">\n  <resources/>\n  <publish name="${escaped}">\n    <atlas name="Default" index="0"/>\n  </publish>\n</packageDescription>\n`;
    parse(Buffer.from(xml),'package.xml');
    const staging=fs.mkdtempSync(path.join(assets,'.fgui-new-package-'));
    try {
      const folder=path.join(staging,'package');fs.mkdirSync(folder);
      const fd=fs.openSync(path.join(folder,'package.xml'),'wx');try{fs.writeFileSync(fd,xml,'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      if(fs.existsSync(target))throw new Error('package directory already exists');
      fs.renameSync(folder,target);
    } finally {fs.rmSync(staging,{recursive:true,force:true});}
    return {id,name,path:target};
  });
}

export function createComponent(args) {
  const name=args.name, width=args.width, height=args.height, extension=args.extention ?? null;
  if(typeof name!=='string' || !/^[\p{L}\p{N}\p{M}_ -]{1,100}$/u.test(name) || name.trim()!==name || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name))throw new Error('invalid component name');
  if(!Number.isInteger(width) || !Number.isInteger(height) || width<=0 || height<=0 || width>100000 || height>100000)throw new Error('invalid component dimensions');
  if(args.exported!==undefined && typeof args.exported!=='boolean')throw new Error('exported must be a boolean');
  if(![null,'Label','Button','ComboBox','ProgressBar','Slider','ScrollBar'].includes(extension))throw new Error('unsupported component extention');
  const requested=args.path ?? '/';if(typeof requested!=='string')throw new Error('invalid package path');
  const parts=requested.replaceAll('\\','/').split('/').filter(Boolean);
  if(parts.some(p=>p==='.' || p==='..' || p.trim()!==p || p.endsWith('.') || !/^[\p{L}\p{N}\p{M}_ .-]{1,100}$/u.test(p) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(p)))throw new Error('invalid package path');
  const root=projectRoot(args.project);
  return withProjectLock(root,()=>{
    const all=packages(root), found=all.filter(p=>args.pkg===path.basename(p.folder) || args.pkg===attr(p.tree,'id'));
    if(found.length!==1)throw new Error('package not found or ambiguous');
    const {folder,tree}=found[0], list=children(tree,'resources');if(list.length!==1)throw new Error('package must have one resources element');
    const filename=name+'.xml', packagePath='/'+parts.join('/')+(parts.length?'/':''), entries=resources(tree);
    if(entries.some(i=>(attr(i,'name')||'').toLowerCase()===filename.toLowerCase() && (attr(i,'path')||'/').replaceAll('\\','/').replace(/^\/+|\/+$/g,'').toLowerCase()===parts.join('/').toLowerCase()))throw new Error('component filename already registered');
    const ids=new Set(entries.map(e=>attr(e,'id')));let id;do{id=crypto.randomBytes(3).toString('hex');}while(ids.has(id));
    const packageFile=path.join(folder,'package.xml'), original=fs.readFileSync(packageFile);
    const xml=packageXmlForEdit(original);
    // Locate the resources tag without rewriting the surrounding package XML.
    const tokens=/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?resources(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/g;
    let match,open=null,close=null;
    while((match=tokens.exec(xml))) {if(match[0].startsWith('<!--') || match[0].startsWith('<?'))continue;if(!open && !match[0].startsWith('</')) {open=match;if(/\/\s*>$/.test(match[0]))break;} else if(open && match[0].startsWith('</')) {close=match;break;}}
    if(!open || (!/\/\s*>$/.test(open[0]) && !close))throw new Error('could not locate resources element');
    const escaped=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
    const entry=`<component id="${id}" name="${escaped(filename)}" path="${escaped(packagePath)}"${args.exported?' exported="true"':''}/>`;
    let changed;if(/\/\s*>$/.test(open[0])) {const replaced=open[0].replace(/\/\s*>$/,`>${entry}</resources>`);changed=xml.slice(0,open.index)+replaced+xml.slice(tokens.lastIndex);} else changed=xml.slice(0,close.index)+'\n    '+entry+'\n  '+xml.slice(close.index);
    parse(Buffer.from(changed),'package.xml');
    const extensionAttr=extension?` extention="${extension}"`:'', extra=['Button','ComboBox','ProgressBar','Slider'].includes(extension)?`\n  <${extension}/>`:'';
    const display=extension==='ScrollBar'?`<displayList>\n    <graph id="n0" name="bar" xy="0,0" size="${width},${height}" type="rect"/>\n    <graph id="n1" name="grip" xy="0,0" size="${width},${Math.max(1,Math.floor(height/4))}" type="rect"/>\n  </displayList>`:'<displayList/>';
    const component=Buffer.from(`<?xml version="1.0" encoding="utf-8"?>\n<component size="${width},${height}"${extensionAttr}>\n  ${display}${extra}\n</component>\n`);
    const created=[],temp=path.join(folder,'.fgui-package-'+crypto.randomBytes(16).toString('hex')+'.tmp');let target=null,made=false;
    try {
      let directory=folder;
      for(const part of parts) {
        directory=path.join(directory,part);if(!fs.existsSync(directory)){fs.mkdirSync(directory);created.push(directory);}
        const real=fs.realpathSync(directory), relative=path.relative(fs.realpathSync(folder),real);
        if(relative==='..' || relative.startsWith('..'+path.sep) || path.isAbsolute(relative) || !fs.statSync(real).isDirectory())throw new Error('package path escapes package');
      }
      target=path.join(directory,filename);const fd=fs.openSync(target,'wx');made=true;try{fs.writeFileSync(fd,component);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      const out=fs.openSync(temp,'wx');try{fs.writeFileSync(out,changed,'utf8');fs.fsyncSync(out);}finally{fs.closeSync(out);}
      if(hash(fs.readFileSync(packageFile))!==hash(original))throw new Error('file changed during write');
      fs.renameSync(temp,packageFile);made=false;
      return {id,name,path:target,sha256:hash(component)};
    } finally {
      if(made && target)fs.unlinkSync(target);
      try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}
      for(const directory of created.reverse())try{fs.rmdirSync(directory);}catch(e){if(e.code!=='ENOTEMPTY' && e.code!=='ENOENT')throw e;}
    }
  });
}

export function setComponentProperties(args) {
  const props=args.props;
  const scrollFields=['scroll','scrollBar','scrollBarFlags','scrollBarMargin','scrollBarRes','ptrRes'];
  if (!props || typeof props!=='object' || Array.isArray(props) || !Object.keys(props).length || Object.keys(props).some(k=>!['size','pivot','opaque','overflow','margin','mask','hitTest','reversedMask',...scrollFields].includes(k))) throw new Error('unsupported or empty component properties');
  for(const [key,value] of Object.entries(props)) {
    if(value===null&&[...scrollFields,'mask','hitTest','reversedMask'].includes(key))continue;
    if (key==='size' || key==='margin' || key==='scrollBarMargin') {
      const parts=typeof value==='string' ? value.split(',') : [], count=key==='size'?2:4;
      if(parts.length!==count || parts.some(x=>!/^\d+$/.test(x.trim()))) throw new Error(`${key} must contain ${count} comma-separated nonnegative integers`);
      if(parts.some(x=>Number(x)>100000 || (key==='size' && Number(x)===0))) throw new Error(`invalid ${key}`);
    } else if(key==='pivot') {
      const parts=typeof value==='string' ? value.split(',') : [];
      if(parts.length!==2 || parts.some(v=>!v.trim() || !Number.isFinite(Number(v)) || Math.abs(Number(v))>100000)) throw new Error('invalid pivot');
    } else if(['opaque','reversedMask'].includes(key) && typeof value!=='boolean') throw new Error(`${key} must be a boolean`);
    else if(['mask','hitTest'].includes(key)&&(typeof value!=='string'||!value))throw new Error(`${key} must be a child ID or null`);
    else if(key==='overflow' && !['visible','hidden','scroll'].includes(value)) throw new Error('invalid component overflow');
    else if(key==='scroll'&&!['horizontal','vertical','both'].includes(value))throw new Error('invalid component scroll');
    else if(key==='scrollBar'&&!['default','visible','auto','hidden'].includes(value))throw new Error('invalid component scrollBar');
    else if(key==='scrollBarFlags'&&(!['number','string'].includes(typeof value)||!/^\d+$/.test(String(value))||Number(value)>2147483647))throw new Error('invalid scrollBarFlags');
    else if(['scrollBarRes','ptrRes'].includes(key)){const parts=typeof value==='string'?value.split(','):[];if(parts.length!==2||parts.some(part=>part&&!part.startsWith('ui://')))throw new Error(`invalid ${key}`);}
  }
  const current=execute('read_component',args);
  if(current.sha256!==args.expected_sha256) throw new Error('expected_sha256 is required and must match current file; read it again');
  const original=fs.readFileSync(current.path);
  if(hash(original)!==current.sha256) throw new Error('file changed during write');
  const source=parse(original,'component'),overflow=props.overflow??attr(source,'overflow')??'visible';
  if(overflow!=='scroll'&&scrollFields.some(key=>Object.hasOwn(props,key)?props[key]!==null:source.hasAttribute(key)))throw new Error('component scroll settings require scroll overflow');
  const displayIds=new Set(children(children(source,'displayList')[0]).filter(child=>child.tagName!=='group'||attr(child,'advanced')==='true').map(child=>attr(child,'id')));
  for(const key of ['mask','hitTest'])if(props[key]!==undefined&&props[key]!==null&&!displayIds.has(props[key]))throw new Error(`${key} must reference a published child ID`);
  if(props.hitTest&&children(children(source,'displayList')[0]).some(child=>child.tagName==='image'&&attr(child,'forHitTest')==='true'))throw new Error('child hitTest cannot be combined with an image pixel hit test');
  const xml=decodeXml(original,'component',true), scanner=/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<component(?=[\s/>])/g;
  let found; while ((found=scanner.exec(xml)) && !found[0].startsWith('<component')) {}
  if(!found) throw new Error('component root not found');
  const begin=found.index; let quote=null,end=begin;
  for(;end<xml.length;end++) {const c=xml[end]; if(quote) {if(c===quote) quote=null;} else if(c==='"' || c==="'") quote=c; else if(c==='>') break;}
  if(end===xml.length) throw new Error('unterminated component tag');
  let tag=xml.slice(begin,end);
  for(const [key,value] of Object.entries(props)) {
    if(value===null){tag=tag.replace(new RegExp(`\\s+${key}\\s*=\\s*(?:"[^"]*"|'[^']*')`),'');continue;}
    const normalized=['size','margin','scrollBarMargin'].includes(key)?value.split(',').map(Number).join(','):key==='scrollBarFlags'?String(Number(value)):String(value),escaped=normalized.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('\n','&#10;').replaceAll('\r','&#13;').replaceAll('\t','&#9;');
    const replacement=`${key}="${escaped}"`, pattern=new RegExp(`(?<![^\\s])${key}\\s*=\\s*(?:"[^"]*"|'[^']*')`);
    if(pattern.test(tag)) tag=tag.replace(pattern,()=>replacement);
    else {let pos=tag.trimEnd().length;if(tag[pos-1]==='/') pos--;tag=tag.slice(0,pos)+' '+replacement+tag.slice(pos);}
  }
  return writeComponent({...args,xml:xml.slice(0,begin)+tag+xml.slice(end)});
}

function editProperties(original, args) {
  const props=args.props;
  const allowed=['name','xy','size','scale','pivot','anchor','rotation','alpha','visible','touchable','grayed','text','color','font','fontSize','align','vAlign','autoSize','leading','letterSpacing','bold','italic','underline','singleLine','ubb','url','fill','fillMethod','fillClockwise','fillAmount','flip','frame','playing','forHitTest','type','lineSize','lineColor','fillColor','corner','points','sides','startAngle','distances','prompt','restrict','maxLength','keyboardType','password','strokeColor','shadowColor','shadowOffset','layout','selectionMode','lineGap','colGap','lineItemCount','lineItemCount2','autoItemSize','autoClearItems','scrollItemToViewOnClick','foldInvisibleItems','renderOrder','overflow','scroll','scrollBar','scrollBarFlags','scrollBarMargin','scrollBarRes','ptrRes','margin','clipSoftness','defaultItem','pageController','selectionController'];
  if(!props || typeof props!=='object' || Array.isArray(props) || !Object.keys(props).length || Object.keys(props).some(k=>!allowed.includes(k))) throw new Error('unsupported property or value');
  for(const [key,value] of Object.entries(props)) {
    if(value===null&&['scroll','scrollBar','scrollBarFlags','scrollBarMargin','scrollBarRes','ptrRes','pageController'].includes(key))continue;
    if(['visible','touchable','anchor','grayed','bold','italic','underline','singleLine','ubb','fillClockwise','playing','password','forHitTest'].includes(key)) {if(typeof value!=='boolean' && !['true','false'].includes(value)) throw new Error(`${key} must be true or false`);}
    else if(['xy','size'].includes(key)) {const p=typeof value==='string'?value.split(','):[];if(p.length!==2 || p.some(x=>! /^[+-]?\d+$/.test(x.trim()) || Number(x)<-2147483648 || Number(x)>2147483647 || (key==='size' && Number(x)<0))) throw new Error(`invalid ${key}`);}
    else if(['scale','pivot'].includes(key)) {const p=typeof value==='string'?value.split(','):[];if(p.length!==2 || p.some(x=>!x.trim() || !Number.isFinite(Number(x)) || Math.abs(Number(x))>100000)) throw new Error(`invalid ${key}`);}
    else if(['rotation','alpha','fontSize'].includes(key)) {if(typeof value==='boolean' || (typeof value!=='number' && typeof value!=='string') || !String(value).trim()) throw new Error(`invalid ${key}`);const n=Number(value);if(!Number.isFinite(n) || (key==='rotation' && Math.abs(n)>100000) || (key==='alpha' && (n<0 || n>1)) || (key==='fontSize' && (!Number.isInteger(n) || n<=0 || n>32767))) throw new Error(`invalid ${key}`);}
    else if(['leading','letterSpacing'].includes(key)) {if(!['number','string'].includes(typeof value)||!/^[+-]?\d+$/.test(String(value).trim()) || Number(value)<-32768 || Number(value)>32767) throw new Error(`invalid ${key}`);}
    else if(key==='align' && !['left','center','right'].includes(value) || key==='vAlign' && !['top','middle','bottom'].includes(value) || key==='autoSize' && !['none','both','height','shrink'].includes(value)) throw new Error(`invalid ${key}`);
    else if(key==='url' && typeof value!=='string')throw new Error('url must be a string');
    else if(key==='fill' && !['none','scale','scaleMatchHeight','scaleMatchWidth','scaleFree','scaleNoBorder'].includes(value))throw new Error('invalid loader fill');
    else if(key==='fillMethod' && !['none','hz','vt','radial90','radial180','radial360'].includes(value))throw new Error('invalid fillMethod');
    else if(key==='flip' && !['none','hz','vt','both'].includes(value))throw new Error('invalid flip');
    else if(key==='frame' && (!['number','string'].includes(typeof value)||!/^\d+$/.test(String(value))||Number(value)>2147483647))throw new Error('invalid frame');
    else if(key==='fillAmount' && (typeof value==='boolean'||!['number','string'].includes(typeof value)||!String(value).trim()||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>100))throw new Error('invalid fillAmount');
    else if(['prompt','restrict'].includes(key)&&typeof value!=='string')throw new Error(`${key} must be a string`);
    else if(['maxLength','keyboardType'].includes(key)&&(typeof value==='boolean'||!['number','string'].includes(typeof value)||!/^\d+$/.test(String(value))||Number(value)>2147483647))throw new Error(`invalid ${key}`);
    else if(['strokeColor','shadowColor'].includes(key)&&value!==null&&(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value)))throw new Error(`invalid ${key}`);
    else if(key==='layout'&&!['column','row','flow_hz','flow_vt','pagination'].includes(value))throw new Error('invalid list layout');
    else if(key==='selectionMode'&&!['single','multiple','multipleSingleClick','none'].includes(value))throw new Error('invalid list selectionMode');
    else if(key==='overflow'&&!['visible','hidden','scroll'].includes(value))throw new Error('invalid list overflow');
    else if(key==='scroll'&&!['horizontal','vertical','both'].includes(value))throw new Error('invalid list scroll');
    else if(key==='scrollBar'&&!['default','visible','auto','hidden'].includes(value))throw new Error('invalid list scrollBar');
    else if(key==='scrollBarFlags'&&(!['number','string'].includes(typeof value)||!/^\d+$/.test(String(value))||Number(value)>2147483647))throw new Error('invalid scrollBarFlags');
    else if(['scrollBarRes','ptrRes'].includes(key)){const parts=typeof value==='string'?value.split(','):[];if(parts.length!==2||parts.some(part=>part&&!part.startsWith('ui://')))throw new Error(`invalid ${key}`);}
    else if(['margin','clipSoftness','scrollBarMargin'].includes(key)){const parts=typeof value==='string'?value.split(','):[];if(parts.length!==(key==='clipSoftness'?2:4)||parts.some(part=>!/^\d+$/.test(part.trim())||Number(part)>100000))throw new Error(`invalid ${key}`);}

    else if(['lineGap','colGap','lineItemCount','lineItemCount2'].includes(key)&&(!['number','string'].includes(typeof value)||!/^[+-]?\d+$/.test(String(value))||Number(value)<(key.startsWith('lineItemCount')?0:-32768)||Number(value)>32767))throw new Error(`invalid ${key}`);
    else if(['autoItemSize','autoClearItems','scrollItemToViewOnClick','foldInvisibleItems'].includes(key)&&typeof value!=='boolean'&&!['true','false'].includes(value))throw new Error(`invalid ${key}`);
    else if(key==='renderOrder'&&!['ascent','descent','arch'].includes(value))throw new Error('invalid list renderOrder');
    else if(['defaultItem','pageController','selectionController'].includes(key)&&typeof value!=='string')throw new Error(`${key} must be a string`);
    else if(key==='defaultItem'&&value&&!value.startsWith('ui://'))throw new Error('defaultItem must be a UI URL or empty');
    else if(key==='shadowOffset'&&value!==null){const parts=typeof value==='string'?value.split(','):[];if(parts.length!==2||parts.some(x=>!x.trim()||!Number.isFinite(Number(x))||Math.abs(Number(x))>100000))throw new Error('invalid shadowOffset');}
    else if(['name','text','font'].includes(key) && typeof value!=='string') throw new Error(`${key} must be a string`);
    else if(key==='color' && (typeof value!=='string' || !/^#[\da-f]{6}$/i.test(value))) throw new Error('color must use #RRGGBB');
  }
  const xml=decodeXml(original,'component',true), node=parse(original,'component'), display=children(node,'displayList')[0], objects=children(display);
  const matches=objects.map((n,i)=>({n,i})).filter(({n})=>args.target===attr(n,'id') || args.target===attr(n,'name'));
  if(matches.length!==1) throw new Error('target child not found or ambiguous');
  const {n:selected,i:targetIndex}=matches[0], type=selected.tagName;
  if('forHitTest' in props&&type!=='image')throw new Error('forHitTest applies only to images');
  if(type==='image'&&String(props.forHitTest??attr(selected,'forHitTest')??'false')==='true'){
    const xy=String(props.xy??attr(selected,'xy')??'').split(',');
    if(attr(selected,'pkg')||attr(node,'hitTest')||objects.some(other=>other!==selected&&other.tagName==='image'&&attr(other,'forHitTest')==='true')||xy.length!==2||xy.some(value=>!value.trim()||Number(value)!==0)||['size','scale','pivot','rotation','flip','fillMethod'].some(key=>Object.hasOwn(props,key)||selected.hasAttribute(key)))throw new Error('pixel hit test image requires an untransformed same-package image at 0,0 and no other hit test');
  }
  if(Object.keys(props).some(k=>['layout','selectionMode','lineGap','colGap','lineItemCount','lineItemCount2','autoItemSize','autoClearItems','scrollItemToViewOnClick','foldInvisibleItems','renderOrder','overflow','scroll','scrollBar','scrollBarFlags','scrollBarMargin','scrollBarRes','ptrRes','margin','clipSoftness','defaultItem','pageController','selectionController'].includes(k))&&type!=='list')throw new Error('list settings apply only to list objects');
  if(type==='list'){const overflow=props.overflow??attr(selected,'overflow')??'visible',scrollFields=['scroll','scrollBar','scrollBarFlags','scrollBarMargin','scrollBarRes','ptrRes','pageController'];if(overflow!=='scroll'&&scrollFields.some(key=>(Object.hasOwn(props,key)?props[key]!==null:selected.hasAttribute(key))))throw new Error('list scroll settings require scroll overflow');}
  if('color' in props&&!['text','richtext','inputtext','image','loader','jta','movieclip'].includes(type))throw new Error('color applies only to text, image, loader and movieclip objects');
  if(Object.keys(props).some(k=>['text','font','fontSize','autoSize','leading','letterSpacing','bold','italic','underline','singleLine','ubb','strokeColor','shadowColor','shadowOffset'].includes(k)) && !['text','richtext','inputtext'].includes(type)) throw new Error('text properties apply only to text objects');
  if(Object.keys(props).some(k=>['prompt','restrict','maxLength','keyboardType','password'].includes(k))&&!(type==='inputtext'||type==='text'&&attr(selected,'input')==='true'))throw new Error('input properties apply only to input text');
  if(['text','richtext','inputtext'].includes(type)&&['shadowColor','shadowOffset'].some(k=>k in props)){const has=key=>key in props?props[key]!==null:selected.hasAttribute(key);if(has('shadowColor')!==has('shadowOffset'))throw new Error('shadowColor and shadowOffset must be set or cleared together');}
  if(('align' in props || 'vAlign' in props) && !['text','richtext','inputtext','loader','list'].includes(type)) throw new Error('alignment applies only to text, loader and list objects');
  if(Object.keys(props).some(k=>['url','fill'].includes(k))&&type!=='loader')throw new Error('url and fill apply only to loader objects');
  if(Object.keys(props).some(k=>['fillMethod','fillClockwise','fillAmount'].includes(k))&&!['image','loader'].includes(type))throw new Error('fill settings apply only to image and loader objects');
  if('flip' in props&&type!=='image')throw new Error('flip applies only to image objects');
  if(Object.keys(props).some(k=>['frame','playing'].includes(k))&&!['jta','movieclip'].includes(type))throw new Error('playback settings apply only to movieclips');
  if(['image','loader'].includes(type)&&(props.fillMethod??attr(selected,'fillMethod')??'none')==='none'&&(['fillClockwise','fillAmount'].some(k=>k in props||(props.fillMethod!=='none'&&selected.hasAttribute(k)))))throw new Error('fillMethod must be enabled when fill properties are present');
  const graphKeys=['type','lineSize','lineColor','fillColor','corner','points','sides','startAngle','distances'];let removeGraph=[];
  if(graphKeys.some(key=>key in props)){
    if(type!=='graph')throw new Error('graph properties apply only to graph objects');
    for(const key of ['type','lineColor','fillColor','corner','points','distances'])if(key in props&&typeof props[key]!=='string')throw new Error(`invalid graph ${key}`);
    for(const key of ['lineSize','sides','startAngle'])if(key in props&&!['string','number'].includes(typeof props[key]))throw new Error(`invalid graph ${key}`);
    const kind=props.type??attr(selected,'type');if(!['rect','eclipse','polygon','regular_polygon'].includes(kind))throw new Error('invalid graph type');
    const compatible={corner:kind==='rect',points:kind==='polygon',sides:kind==='regular_polygon',startAngle:kind==='regular_polygon',distances:kind==='regular_polygon'};
    for(const [key,allowed] of Object.entries(compatible))if(!allowed){if(key in props)throw new Error(`${key} is not valid for ${kind}`);if(props.type!==undefined)removeGraph.push(key);}
    const get=key=>key in props?String(props[key]):removeGraph.includes(key)?null:attr(selected,key),line=get('lineSize');if(line!==null&&(!/^\d+$/.test(line)||Number(line)>100000))throw new Error('invalid graph lineSize');
    for(const key of ['lineColor','fillColor']){const value=get(key);if(value!==null&&!/^#[0-9a-f]{8}$/i.test(value))throw new Error(`invalid graph ${key}`);}
    const floats=key=>{const raw=get(key);if(raw===null)return null;const values=raw.split(',');if(values.some(v=>!v.trim()||!Number.isFinite(Number(v))||Math.abs(Number(v))>1000000))throw new Error(`invalid graph ${key}`);return values.map(Number);};
    const corner=floats('corner');if(corner&&(![1,4].includes(corner.length)||corner.some(v=>v<0)))throw new Error('invalid graph corner');
    const points=floats('points');if(kind==='polygon'&&(!points||points.length<6||points.length%2||points.length>32766))throw new Error('invalid polygon points');
    if(kind==='regular_polygon'){const sides=get('sides'),angle=get('startAngle'),distances=floats('distances');if(sides===null||!/^\d+$/.test(sides)||Number(sides)<3||Number(sides)>32767||angle!==null&&(!angle.trim()||!Number.isFinite(Number(angle))||Math.abs(Number(angle))>1000000)||distances&&(distances.length!==Number(sides)||distances.some(v=>v<0)))throw new Error('invalid regular polygon');}
  }
  if('anchor' in props && !('pivot' in props) && !selected.hasAttribute('pivot')) throw new Error('anchor requires a pivot');
  const token=/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w:.-]*(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?>/g;
  let depth=[], count=0, match, start=-1,end=-1;
  while((match=token.exec(xml))) {
    const tag=match[0]; if(tag.startsWith('<?') || tag.startsWith('<!')) continue;
    if(tag.startsWith('</')) {depth.pop();continue;}
    const name=/^<([^\s/>]+)/.exec(tag)[1];
    if(depth.length===2 && depth[0]==='component' && depth[1]==='displayList' && count++===targetIndex) {start=match.index;end=token.lastIndex-1;break;}
    if(!tag.endsWith('/>')) depth.push(name);
  }
  if(start<0) throw new Error('could not locate child');
  let tag=xml.slice(start,end);
  for(const [key,value] of Object.entries(props)) {
    if(value===null){tag=tag.replace(new RegExp(`\\s+${key}\\s*=\\s*(?:"[^"]*"|'[^']*')`),'');continue;}
    const v=['xy','size','margin','clipSoftness','scrollBarMargin'].includes(key)?value.split(',').map(Number).join(','):['fontSize','leading','letterSpacing','frame','lineGap','colGap','lineItemCount','lineItemCount2','scrollBarFlags'].includes(key)?String(Number(value)):String(value), escaped=v.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('\n','&#10;').replaceAll('\r','&#13;').replaceAll('\t','&#9;');
    const replacement=`${key}="${escaped}"`, pattern=new RegExp(`(?<![^\\s])${key}\\s*=\\s*(?:"[^"]*"|'[^']*')`);
    if(pattern.test(tag)) tag=tag.replace(pattern,()=>replacement);else {let pos=tag.trimEnd().length;if(tag[pos-1]==='/')pos--;tag=tag.slice(0,pos)+' '+replacement+tag.slice(pos);}
  }
  if(props.fillMethod==='none')for(const key of ['fillClockwise','fillAmount'])tag=tag.replace(new RegExp(`\\s+${key}\\s*=\\s*(?:"[^"]*"|'[^']*')`),'');
  for(const key of removeGraph)tag=tag.replace(new RegExp(`\\s+${key}\\s*=\\s*(?:"[^"]*"|'[^']*')`),'');
  return Buffer.from(xml.slice(0,start)+tag+xml.slice(end),'utf8');
}

export function setPropertiesBatch(args) {
  if(!Array.isArray(args.changes) || !args.changes.length || args.changes.length>1000 || args.changes.some(c=>!c || typeof c!=='object' || Array.isArray(c) || typeof c.target!=='string' || Object.keys(c).some(k=>!['target','props'].includes(k)))) throw new Error('changes must be a nonempty list of at most 1000 edits');
  const current=execute('read_component',args); if(current.sha256!==args.expected_sha256) throw new Error('expected_sha256 must match current file');
  let data=fs.readFileSync(current.path); if(hash(data)!==current.sha256) throw new Error('file changed during write');
  for(const change of args.changes) data=editProperties(data,change);
  return writeComponent({...args,xml:data.toString('utf8')});
}
export function setProperties(args) { return setPropertiesBatch({...args,changes:[{target:args.target,props:args.props}]}); }

export async function setImageOptions(args) {
  const props=args.props,keys=['scale','scale9grid','duplicatePadding','exported'];
  if(!props||typeof props!=='object'||Array.isArray(props)||!Object.keys(props).length||Object.keys(props).some(k=>!keys.includes(k)))throw new Error('invalid image options');
  if(props.scale!==undefined&&!['none','tile','9grid'].includes(props.scale))throw new Error('invalid image scale');
  for(const key of ['duplicatePadding','exported'])if(key in props&&typeof props[key]!=='boolean')throw new Error(`${key} must be a boolean`);
  const gridValue=value=>{const v=typeof value==='string'?value.split(','):[];if(v.length!==4||v.some(x=>!/^\d+$/.test(x.trim())||Number(x)>2147483647)||Number(v[2])===0||Number(v[3])===0)throw new Error('invalid scale9grid');return v.map(x=>String(Number(x))).join(',');};
  if(['none','tile'].includes(props.scale)&&'scale9grid' in props)throw new Error('scale9grid requires 9grid scale');
  const root=projectRoot(args.project);let imageSnapshot=null;
  if(props.scale==='9grid'||'scale9grid' in props){const found=packages(root).filter(p=>args.pkg===path.basename(p.folder)||args.pkg===attr(p.tree,'id'));if(found.length!==1)throw new Error('package not found or ambiguous');const {folder,tree}=found[0],packageFile=path.join(folder,'package.xml'),packageBytes=fs.readFileSync(packageFile);if(hash(packageBytes)!==args.expected_sha256)throw new Error('expected_sha256 must match current package');const currentTree=parse(packageBytes,'package.xml'),matches=resources(currentTree).filter(i=>i.tagName==='image'&&[attr(i,'id'),attr(i,'name'),path.parse(attr(i,'name')||'').name].includes(args.item));if(matches.length!==1)throw new Error('image not found or ambiguous');const file=componentPath(folder,matches[0]),bytes=fs.readFileSync(file),image=sharp(bytes,{failOn:'error',limitInputPixels:268402689}),info=await image.metadata();await image.raw().toBuffer();imageSnapshot={file,hash:hash(bytes),width:info.width,height:info.height};}
  return withProjectLock(root,()=>{
    const all=packages(root).filter(p=>args.pkg===path.basename(p.folder)||args.pkg===attr(p.tree,'id'));if(all.length!==1)throw new Error('package not found or ambiguous');
    const {folder}=all[0],file=path.join(folder,'package.xml'),original=fs.readFileSync(file),before=hash(original);if(before!==args.expected_sha256)throw new Error('expected_sha256 must match current package');
    const tree=parse(original,'package.xml');if(tree.tagName!=='packageDescription'||(args.pkg!==path.basename(folder)&&args.pkg!==attr(tree,'id')))throw new Error('package identity changed');
    const entries=resources(tree),images=entries.filter(i=>i.tagName==='image'&&[attr(i,'id'),attr(i,'name'),path.parse(attr(i,'name')||'').name].includes(args.item));if(images.length!==1||!attr(images[0],'id')||entries.filter(i=>attr(i,'id')===attr(images[0],'id')).length!==1)throw new Error('image not found or ambiguous');const item=images[0];
    const updates={};if('scale' in props){updates.scale=props.scale==='none'?null:props.scale;if(props.scale!=='9grid')updates.scale9grid=null;}
    if('scale9grid' in props)updates.scale9grid=gridValue(props.scale9grid);
    for(const key of ['duplicatePadding','exported'])if(key in props)updates[key]=String(props[key]);
    const scale=Object.hasOwn(updates,'scale')?updates.scale:attr(item,'scale'),grid=Object.hasOwn(updates,'scale9grid')?updates.scale9grid:attr(item,'scale9grid');
    let gridWarning=null;if(scale==='9grid'){const values=gridValue(grid).split(',').map(Number);if(imageSnapshot&&(values[0]+values[2]>imageSnapshot.width||values[1]+values[3]>imageSnapshot.height))gridWarning='scale9grid extends beyond image dimensions; preserved for editor compatibility';}else if(grid!==null)throw new Error('scale9grid requires 9grid scale');if(imageSnapshot&&hash(fs.readFileSync(imageSnapshot.file))!==imageSnapshot.hash)throw new Error('image changed during validation');
    const xml=packageXmlForEdit(original),token=/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w:.-]*(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?>/g,stack=[];let m,found=null,index=0;
    const imageIndex=resources(tree).filter(i=>i.tagName==='image').indexOf(item);
    while((m=token.exec(xml))){const t=m[0];if(t.startsWith('<!')||t.startsWith('<?'))continue;if(t.startsWith('</')){stack.pop();continue;}const name=/^<([^\s/>]+)/.exec(t)[1];if(stack.length===2&&stack[0]==='packageDescription'&&stack[1]==='resources'&&name==='image'&&index++===imageIndex){found=m;break;}if(!/\/\s*>$/.test(t))stack.push(name);}
    if(!found)throw new Error('could not locate image resource');let tag=found[0];
    for(const [key,value] of Object.entries(updates)){const pattern=new RegExp(`\\s+${key}\\s*=\\s*(?:"[^"]*"|'[^']*')`);if(pattern.test(tag))tag=tag.replace(pattern,value===null?'':` ${key}="${value}"`);else if(value!==null)tag=tag.replace(/\s*\/?>$/,m=>` ${key}="${value}"${m}`);}
    const data=Buffer.from(xml.slice(0,found.index)+tag+xml.slice(found.index+found[0].length));parse(data,'package.xml');const temp=path.join(folder,'.fgui-package-'+crypto.randomBytes(16).toString('hex')+'.tmp');
    try{const fd=fs.openSync(temp,'wx');try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(hash(fs.readFileSync(file))!==before)throw new Error('file changed during write');if(imageSnapshot&&hash(fs.readFileSync(imageSnapshot.file))!==imageSnapshot.hash)throw new Error('image changed during validation');fs.renameSync(temp,file);}finally{try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
    return {path:file,sha256:hash(data),id:attr(item,'id'),warnings:gridWarning?[gridWarning]:[]};
  });
}

// Insert a registered resource while retaining the original component formatting.
export function insertResource(args) {
  const current=execute('read_component',args);
  if(current.sha256!==args.expected_sha256) throw new Error('expected_sha256 must match current file');
  const root=projectRoot(args.project), all=packages(root);
  const resolve=value=>{const matches=all.filter(p=>value===path.basename(p.folder)||value===attr(p.tree,'id'));if(matches.length!==1)throw new Error('package not found or ambiguous');return matches[0];};
  const target=resolve(args.pkg), source=resolve(args.ref_pkg||args.pkg);
  if(typeof args.ref_name!=='string'||!args.ref_name)throw new Error('ref_name must be a nonempty string');
  const matches=resources(source.tree).filter(item=>[attr(item,'id'),attr(item,'name'),path.parse(attr(item,'name')||'').name].includes(args.ref_name));
  if(matches.length!==1)throw new Error('resource not found or ambiguous');
  const item=matches[0], tag={image:'image',component:'component',movieclip:'jta'}[item.tagName], sourceId=attr(item,'id');
  if(!tag||!sourceId)throw new Error('resource type cannot be inserted as a display object');
  if(!fs.statSync(componentPath(source.folder,item)).isFile())throw new Error('resource file is missing');
  if(source.folder!==target.folder&&!attr(source.tree,'id'))throw new Error('resource package has no ID');
  const name=args.object_name??path.parse(attr(item,'name')||'').name, x=args.x??0, y=args.y??0;
  if(typeof name!=='string'||!name)throw new Error('object_name must be a nonempty string');
  if([x,y].some(n=>!Number.isInteger(n)||n< -2147483648||n>2147483647))throw new Error('x and y must be Int32 integers');
  const original=fs.readFileSync(current.path);if(hash(original)!==current.sha256)throw new Error('file changed during write');
  const node=parse(original,'component'), display=children(node,'displayList')[0];
  if(!display)throw new Error('component requires a displayList');
  const objects=children(display), index=args.index??objects.length;
  if(!Number.isInteger(index)||index<0||index>objects.length)throw new Error('index out of range');
  const ids=new Set(objects.map(n=>attr(n,'id')));let id;do{id='n'+crypto.randomBytes(3).toString('hex');}while(ids.has(id));
  const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('\n','&#10;').replaceAll('\r','&#13;').replaceAll('\t','&#9;');
  const fragment=`<${tag} id="${id}" name="${escape(name)}" src="${escape(sourceId)}" xy="${x},${y}"${source.folder!==target.folder?` pkg="${escape(attr(source.tree,'id'))}"`:''}/>`;
  const xml=decodeXml(original,'component',true);
  const tokens=/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w:.-]*(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?>/g;
  const stack=[];let match,position=-1,self=null,count=0;
  while((match=tokens.exec(xml))) {
    const t=match[0];if(t.startsWith('<!')||t.startsWith('<?'))continue;
    if(t.startsWith('</')) {if(stack.length===2&&stack[0]==='component'&&stack[1]==='displayList'&&index===count){position=match.index;break;} stack.pop();continue;}
    const tagName=/^<([^\s/>]+)/.exec(t)[1];
    if(stack.length===1&&stack[0]==='component'&&tagName==='displayList'&&/\/\s*>$/.test(t)){self=match;break;}
    if(stack.length===2&&stack[0]==='component'&&stack[1]==='displayList'){if(count++===index){position=match.index;break;}}
    if(!/\/\s*>$/.test(t))stack.push(tagName);
  }
  let changed;if(self){changed=xml.slice(0,self.index)+self[0].replace(/\/\s*>$/,`>${fragment}</displayList>`)+xml.slice(self.index+self[0].length);}else if(position>=0)changed=xml.slice(0,position)+fragment+xml.slice(position);else throw new Error('could not locate displayList');
  const result=writeComponent({...args,xml:changed});
  return {...result,id,type:tag,source_id:sourceId,source_package:attr(source.tree,'id')};
}

export function editController(args, create=false) {
  const {controller,pages}=args;if(typeof controller!=='string'||!controller||controller.length>100)throw new Error('invalid controller name');
  if(!Array.isArray(pages)||pages.length>256)throw new Error('pages must be a list of at most 256 entries');const ids=new Set(),parts=[];
  for(const page of pages){if(!page||typeof page!=='object'||Array.isArray(page)||Object.keys(page).sort().join(',')!=='id,name'||typeof page.id!=='string'||!/^[A-Za-z0-9_]{1,64}$/.test(page.id)||ids.has(page.id)||typeof page.name!=='string'||page.name.length>128||page.name.includes(','))throw new Error('invalid or duplicate page');ids.add(page.id);parts.push(page.id,page.name);}
  const current=execute('read_component',args);if(current.sha256!==args.expected_sha256)throw new Error('expected_sha256 must match current file');const original=fs.readFileSync(current.path);if(hash(original)!==current.sha256)throw new Error('file changed during write');
  const root=parse(original,'component'),controllers=children(root,'controller'),matches=controllers.filter(c=>attr(c,'name')===controller);if(create&&matches.length)throw new Error('controller already exists');if(!create&&matches.length!==1)throw new Error('controller not found or ambiguous');
  const selected=args.selected??(create?0:Number(attr(matches[0],'selected')??'0'));if(!Number.isInteger(selected)||selected<0||(pages.length?selected>=pages.length:selected!==0))throw new Error('invalid selected page index');
  const xml=decodeXml(original,'component',true),token=/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w:.-]*(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?>/g,depth=[],targetIndex=create?-1:controllers.indexOf(matches[0]);let match,count=0,start=-1,end=-1;
  while((match=token.exec(xml))){const tag=match[0];if(tag.startsWith('<?')||tag.startsWith('<!'))continue;if(tag.startsWith('</')){depth.pop();continue;}const name=/^<([^\s/>]+)/.exec(tag)[1];if(depth.length===1&&depth[0]==='component'&&((create&&name==='displayList')||(!create&&name==='controller'&&count++===targetIndex))){start=match.index;end=token.lastIndex-1;break;}if(!tag.endsWith('/>'))depth.push(name);}
  if(start<0)throw new Error('could not locate display list or controller');const escape=v=>String(v).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('\n','&#10;').replaceAll('\r','&#13;').replaceAll('\t','&#9;');let changed;
  if(create){const element=`<controller name="${escape(controller)}" pages="${escape(parts.join(','))}" selected="${selected}"/>\n  `;changed=xml.slice(0,start)+element+xml.slice(start);}
  else {let tag=xml.slice(start,end);for(const [key,value] of [['pages',parts.join(',')],['selected',selected]]){const pattern=new RegExp(`(?<![^\\s])${key}\\s*=\\s*(?:"[^"]*"|'[^']*')`),replacement=`${key}="${escape(value)}"`;if(pattern.test(tag))tag=tag.replace(pattern,()=>replacement);else{let pos=tag.trimEnd().length;if(tag[pos-1]==='/')pos--;tag=tag.slice(0,pos)+' '+replacement+tag.slice(pos);}}changed=xml.slice(0,start)+tag+xml.slice(end);}
  return writeComponent({...args,xml:changed});
}

export function setControllerActions(args){
 const {controller,actions}=args;if(typeof controller!=='string'||!controller||!Array.isArray(actions)||actions.length>32767)throw new Error('invalid controller actions');
 const current=execute('read_component',args);if(current.sha256!==args.expected_sha256)throw new Error('expected_sha256 must match current file');const original=fs.readFileSync(current.path);if(hash(original)!==current.sha256)throw new Error('file changed during write');const root=parse(original,'component'),controllers=children(root,'controller'),matches=controllers.filter(c=>attr(c,'name')===controller);if(matches.length!==1)throw new Error('controller not found or ambiguous');const target=matches[0],pages=(attr(target,'pages')??'').split(',').filter((_,i)=>i%2===0),transitions=new Set(children(root,'transition').map(t=>attr(t,'name')));
 const old=children(target);if(old.some(action=>action.tagName!=='action'||attr(action,'type')!=='play_transition'||children(action).length||Array.from(action.attributes).some(a=>!['type','fromPage','toPage','transition'].includes(a.name))))throw new Error('unsupported existing controller action');
 for(const action of actions){if(!action||typeof action!=='object'||Array.isArray(action)||Object.keys(action).some(key=>!['transition','from_pages','to_pages'].includes(key))||typeof action.transition!=='string'||!transitions.has(action.transition))throw new Error('invalid transition action');for(const key of ['from_pages','to_pages'])if(action[key]!==undefined&&(!Array.isArray(action[key])||action[key].some(page=>typeof page!=='string'||!pages.includes(page))||new Set(action[key]).size!==action[key].length))throw new Error(`invalid ${key}`);}
 for(const action of old)target.removeChild(action);for(const action of actions){const entry=root.ownerDocument.createElement('action');entry.setAttribute('type','play_transition');entry.setAttribute('transition',action.transition);for(const [key,field] of [['from_pages','fromPage'],['to_pages','toPage']])if(action[key]?.length)entry.setAttribute(field,action[key].join(','));target.appendChild(entry);}
 const xml=decodeXml(original,'component',true),token=/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w:.-]*(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?>/g,stack=[];let match,count=0,start=-1,end=-1,selectedDepth=-1,index=controllers.indexOf(target);
 while((match=token.exec(xml))){const part=match[0];if(part.startsWith('<?')||part.startsWith('<!'))continue;if(part.startsWith('</')){if(selectedDepth===stack.length){end=token.lastIndex;break;}stack.pop();continue;}const name=/^<([^\s/>]+)/.exec(part)[1],self=/\/\s*>$/.test(part);if(stack.length===1&&stack[0]==='component'&&name==='controller'&&count++===index){start=match.index;if(self){end=token.lastIndex;break;}selectedDepth=stack.length+1;}if(!self)stack.push(name);}
 if(start<0||end<0)throw new Error('could not locate controller XML');return writeComponent({...args,xml:xml.slice(0,start)+new XMLSerializer().serializeToString(target)+xml.slice(end)});
}

export function editTransition(args,remove=false){
 return withProjectLock(projectRoot(args.project),()=>editTransitionLocked(args,remove));
}
function editTransitionLocked(args,remove){
 const current=execute('read_component',args);if(current.sha256!==args.expected_sha256)throw new Error('expected_sha256 must match current file');const original=fs.readFileSync(current.path);if(hash(original)!==current.sha256)throw new Error('file changed during write');const root=parse(original,'component'),existing=children(root,'transition');let name=args.transition,node;
 let verifyReferences=null;if(remove){if(typeof name!=='string'||!name)throw new Error('transition is required');verifyReferences=()=>{const refs=findReferences({...args,item:args.name});if(!refs.complete)throw new Error('cannot safely scan transition references');const targets=new Map();for(const ref of refs.references)if(ref.kind==='child'&&ref.element==='component'){if(!targets.has(ref.path))targets.set(ref.path,new Set());targets.get(ref.path).add(ref.element_id);}for(const [file,ids] of targets){const component=parse(fs.readFileSync(file),'referencing component');for(const transition of children(component,'transition'))for(const action of children(transition,'item'))if(attr(action,'type')==='Transition'&&ids.has(attr(action,'target'))&&attr(action,'value')===name)throw new Error(`transition is referenced by ${file}`);}};verifyReferences();}else{if(typeof args.transition_xml!=='string')throw new Error('transition_xml is required');node=parse(Buffer.from(args.transition_xml,'utf8'),'transition');if(node.tagName!=='transition'||!attr(node,'name'))throw new Error('transition XML must have a name');name=attr(node,'name');const check=root.cloneNode(true);for(const old of children(check,'transition'))check.removeChild(old);check.appendChild(check.ownerDocument.importNode(node,true));const urls=urlIndex(packages(projectRoot(args.project))),warnings=[];readTransitions(check,children(children(root,'displayList')[0]).map(child=>attr(child,'id')),(url,types)=>{const matches=urls.get(url)??[];if(matches.length!==1||!types.includes(matches[0].type)||!matches[0].isFile())throw new Error(`invalid transition URL: ${url}`);},warnings,name);if(warnings.length)throw new Error('transition references a missing target');}
 const matches=existing.filter(t=>attr(t,'name')===name);if(matches.length>1||remove&&matches.length!==1)throw new Error('transition not found or ambiguous');const xml=decodeXml(original,'component',true),token=/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w:.-]*(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?>/g,stack=[];let match,start=-1,end=-1,rootClose=-1,index=matches.length?existing.indexOf(matches[0]):-1,count=0,selectedDepth=-1;
 while((match=token.exec(xml))){const part=match[0];if(part.startsWith('<?')||part.startsWith('<!'))continue;if(part.startsWith('</')){if(selectedDepth===stack.length){end=token.lastIndex;break;}if(stack.length===1&&stack[0]==='component'){rootClose=match.index;break;}stack.pop();continue;}const tag=/^<([^\s/>]+)/.exec(part)[1],self=/\/\s*>$/.test(part);if(stack.length===1&&stack[0]==='component'&&tag==='transition'&&count++===index){start=match.index;if(self){end=token.lastIndex;break;}selectedDepth=stack.length+1;}if(!self)stack.push(tag);}
 const replacement=remove?'':new XMLSerializer().serializeToString(node);if(index>=0){if(start<0||end<0)throw new Error('could not locate transition XML');return writeComponentLocked({...args,xml:xml.slice(0,start)+replacement+xml.slice(end)},projectRoot(args.project),verifyReferences);}if(rootClose<0)throw new Error('could not locate component end');return writeComponentLocked({...args,xml:xml.slice(0,rootClose)+replacement+xml.slice(rootClose)},projectRoot(args.project));
}

// Rewrite only the selected display object; retain all bytes surrounding it.
export function editBehavior(args, operation) {
  const current=execute('read_component',args);if(current.sha256!==args.expected_sha256)throw new Error('expected_sha256 must match current file');const original=fs.readFileSync(current.path);if(hash(original)!==current.sha256)throw new Error('file changed during write');
  const root=parse(original,'component'),objects=children(children(root,'displayList')[0]),matches=objects.map((node,index)=>({node,index})).filter(x=>[attr(x.node,'id'),attr(x.node,'name')].includes(args.target));if(matches.length!==1)throw new Error('target child not found or ambiguous');const {node,index}=matches[0];
  if(operation==='set_list_items'){
    if(node.tagName!=='list'||!Array.isArray(args.items)||args.items.length>32767)throw new Error('target must be a list and items must be an array of at most 32767 entries');
    const isTree=attr(node,'treeView')==='true',keys=['url','title','selectedTitle','icon','selectedIcon','name',...(isTree?['level']:[])],old=children(node,'item');
    for(const item of old)if(children(item).length||Array.from(item.attributes).some(a=>!keys.includes(a.name))||Array.from(item.childNodes).some(n=>(n.nodeType===3||n.nodeType===4)&&n.data.trim()))throw new Error('unsupported existing list item settings');
    const urls=urlIndex(packages(projectRoot(args.project)));let previous=-1;
    for(const item of args.items){
      if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(key=>!keys.includes(key)))throw new Error('invalid list item');
      for(const [key,value] of Object.entries(item))if(key==='level'){if(!Number.isInteger(value)||value<0||value>255||value>previous+1)throw new Error('invalid tree item level');previous=value;}else if(typeof value!=='string')throw new Error(`list item ${key} must be a string`);
      if(isTree&&!Object.hasOwn(item,'level'))previous=0;
      for(const key of ['url','icon','selectedIcon'])if(item[key]){const found=urls.get(item[key])??[],types=key==='url'?['component']:['image','component','movieclip'];if(found.length!==1||!types.includes(found[0].type)||!found[0].isFile())throw new Error(`invalid list item ${key}`);}
    }
    const anchor=old[0]??null;for(const values of args.items){const item=root.ownerDocument.createElement('item');for(const [key,value] of Object.entries(values))item.setAttribute(key,String(value));node.insertBefore(item,anchor);}
    for(const item of old)node.removeChild(item);
    return replaceDisplayObject(args,original,node,index);
  }
  const gearNames={display:'gearDisplay',display2:'gearDisplay2',text:'gearText',color:'gearColor',position:'gearXY',size:'gearSize',look:'gearLook',font_size:'gearFontSize',animation:'gearAni',icon:'gearIcon'};
  let tag,attrs={},existing,element;
  if(['set_relation','remove_relation'].includes(operation)){
    if(typeof args.related_to!=='string')throw new Error('invalid relation target');let related=args.related_to;
    if(related){const found=objects.filter(o=>[attr(o,'id'),attr(o,'name')].includes(related));if(found.length!==1)throw new Error('relation target not found or ambiguous');related=attr(found[0],'id');if(related===attr(node,'id'))throw new Error('relation cannot target itself');}
    tag='relation';existing=children(node,tag).filter(n=>(attr(n,'target')??'')===related);attrs.target=related;
    if(operation==='set_relation'){const valid=['left-left','left-center','left-right','center-center','right-left','right-center','right-right','top-top','top-middle','top-bottom','middle-middle','bottom-top','bottom-middle','bottom-bottom','width-width','height-height','leftext-left','leftext-right','rightext-left','rightext-right','topext-top','topext-bottom','bottomext-top','bottomext-bottom'];const pairs=args.side_pairs,canonical=Array.isArray(pairs)?pairs.map(p=>({width:'width-width',height:'height-height'})[p]??p):[];if(!canonical.length||canonical.length>255||canonical.some(p=>!valid.includes(p))||new Set(canonical).size!==canonical.length)throw new Error('invalid or duplicate relation side pairs');attrs.sidePair=pairs.join(',');}
  }else if(['set_button_instance_options','set_label_instance_options','set_progress_instance_options','set_slider_instance_options'].includes(operation)){tag={set_button_instance_options:'Button',set_label_instance_options:'Label',set_progress_instance_options:'ProgressBar',set_slider_instance_options:'Slider'}[operation];existing=children(node,tag);if(existing.length>1)throw new Error('duplicate instance settings');attrs=instanceAttributes(args,node,tag,existing[0]);}
  else if(operation==='set_combobox_instance_options'){tag='ComboBox';existing=children(node,tag);if(existing.length>1)throw new Error('duplicate instance settings');element=comboInstanceElement(args,node,existing[0]);}
  else if(operation==='remove_gear'){tag=gearNames[args.gear];if(!tag)throw new Error('unsupported gear type');existing=children(node,tag);}
  else {tag=gearOperations[operation];if(!tag)throw new Error('unsupported gear operation');existing=children(node,tag);attrs=gearAttributes(args,tag,node,root,existing[0]);}
  if(existing.length>1)throw new Error('duplicate child behavior');if(!operation.startsWith('remove_')&&!['Button','Label','ProgressBar','Slider','ComboBox'].includes(tag)&&existing.length){const allowed=tag==='relation'?['target','sidePair']:tag==='gearDisplay2'?['controller','pages','condition']:tag==='gearDisplay'?['controller','pages']:['controller','pages','values','default',...(['gearXY','gearSize','gearLook'].includes(tag)?['tween','ease','duration','delay']:[])];if(children(existing[0]).length||Array.from(existing[0].attributes).some(a=>!allowed.includes(a.name))||Array.from(existing[0].childNodes).some(n=>(n.nodeType===3||n.nodeType===4)&&n.data.trim()))throw new Error('unsupported existing child behavior');}const removing=operation.startsWith('remove_');if(removing&&!existing.length)throw new Error('child behavior not found');
  if(removing)node.removeChild(existing[0]);else{const behavior=element??root.ownerDocument.createElement(tag);if(!element)for(const [key,value] of Object.entries(attrs))behavior.setAttribute(key,value);if(existing.length)node.replaceChild(behavior,existing[0]);else node.appendChild(behavior);}
  return replaceDisplayObject(args,original,node,index);
}

function replaceDisplayObject(args,original,node,index){
  const xml=decodeXml(original,'component',true),token=/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w:.-]*(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?>/g,stack=[];let match,count=0,start=-1,end=-1,selectedDepth=-1;
  while((match=token.exec(xml))){const part=match[0];if(part.startsWith('<?')||part.startsWith('<!'))continue;if(part.startsWith('</')){if(selectedDepth===stack.length){end=token.lastIndex;break;}stack.pop();continue;}const name=/^<([^\s/>]+)/.exec(part)[1],self=/\/\s*>$/.test(part);if(stack.length===2&&stack[0]==='component'&&stack[1]==='displayList'&&count++===index){start=match.index;if(self){end=token.lastIndex;break;}selectedDepth=stack.length+1;}if(!self)stack.push(name);}
  if(start<0||end<0)throw new Error('could not locate child XML');const replacement=new XMLSerializer().serializeToString(node);return writeComponent({...args,xml:xml.slice(0,start)+replacement+xml.slice(end)});
}

export async function importResource(args,kind) {
  if(!['image','sound','movieclip','font'].includes(kind))throw new Error('unsupported resource import');
  if(typeof args.source!=='string'||!args.source)throw new Error('source is required');const source=fs.realpathSync(args.source),stat=fs.statSync(source);if(!stat.isFile()||stat.size>128*1024*1024)throw new Error('source must be a file of at most 128 MiB');
  const filename=args.name??path.basename(source),ext=path.extname(filename).toLowerCase(),allowed={image:['.png','.jpg','.jpeg'],sound:['.wav','.mp3','.ogg'],movieclip:['.jta'],font:['.fnt']};
  if(typeof filename!=='string'||filename.trim()!==filename||filename.endsWith('.')||! /^[\p{L}\p{N}\p{M}_, .-]{1,200}$/u.test(filename)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(filename)||!allowed[kind].includes(ext))throw new Error('invalid resource filename or extension');
  if(args.exported!==undefined&&typeof args.exported!=='boolean')throw new Error('exported must be a boolean');const requested=args.path??'/';if(typeof requested!=='string')throw new Error('invalid package path');const parts=requested.replaceAll('\\','/').split('/').filter(Boolean);
  if(parts.some(p=>p==='.'||p==='..'||p.trim()!==p||p.endsWith('.')||! /^[\p{L}\p{N}\p{M}_ .-]{1,100}$/u.test(p)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p)))throw new Error('invalid package path');
  const data=fs.readFileSync(source);if(data.length>128*1024*1024)throw new Error('source exceeds 128 MiB');const root=projectRoot(args.project);let metadata={},textureId=null,fontSnapshot=null;
  if(kind==='image'){const image=sharp(data,{failOn:'error',limitInputPixels:268402689}),info=await image.metadata();if((ext==='.png'&&info.format!=='png')||(['.jpg','.jpeg'].includes(ext)&&info.format!=='jpeg'))throw new Error('image extension does not match its content');await image.raw().toBuffer();metadata={width:info.width,height:info.height};}
  else if(kind==='sound')metadata=ext==='.wav'?inspectWav(data):ext==='.mp3'?inspectMp3(data):inspectOggVorbis(data);
  else if(kind==='movieclip'){const clip=await readJta(data);metadata={width:clip.width,height:clip.height,frames:clip.frames.length,interval:clip.interval};}
  else {const matches=packages(root).filter(p=>args.pkg===path.basename(p.folder)||args.pkg===attr(p.tree,'id'));if(matches.length!==1)throw new Error('package not found or ambiguous');const {folder}=matches[0],packageFile=path.join(folder,'package.xml'),packageBytes=fs.readFileSync(packageFile),tree=parse(packageBytes,'package.xml'),images=resources(tree).filter(i=>i.tagName==='image');fontSnapshot=new Map([[packageFile,hash(packageBytes)]]);
    if(args.texture!==undefined){if(typeof args.texture!=='string'||!args.texture)throw new Error('invalid font texture');const found=images.filter(i=>[attr(i,'id'),attr(i,'name'),path.parse(attr(i,'name')??'').name].includes(args.texture));if(found.length!==1||!attr(found[0],'id'))throw new Error('font texture image not found or ambiguous');textureId=attr(found[0],'id');}
    const font=readBitmapFont(data,textureId),required=new Set(textureId?[textureId]:font.glyphs.map(g=>g.image));for(const imageId of required){const found=images.filter(i=>attr(i,'id')===imageId);if(found.length!==1)throw new Error('font image missing or ambiguous');const file=componentPath(folder,found[0]),bytes=fs.readFileSync(file);fontSnapshot.set(file,hash(bytes));const image=sharp(bytes,{failOn:'error',limitInputPixels:268402689}),info=await image.metadata();await image.raw().toBuffer();if(textureId&&font.glyphs.some(g=>g.x+g.width>info.width||g.y+g.height>info.height))throw new Error('font glyph rectangle exceeds texture dimensions');}metadata={glyphs:font.glyphs.length,font_size:font.fontSize,texture:textureId};
  }
  return withProjectLock(root,()=>{
    const found=packages(root).filter(p=>args.pkg===path.basename(p.folder)||args.pkg===attr(p.tree,'id'));if(found.length!==1)throw new Error('package not found or ambiguous');const {folder,tree}=found[0],entries=resources(tree),packagePath='/'+parts.join('/')+(parts.length?'/':'');
    if(children(tree,'resources').length!==1)throw new Error('package must have one resources element');if(entries.some(i=>(attr(i,'name')??'').toLowerCase()===filename.toLowerCase()&&(attr(i,'path')??'/').replaceAll('\\','/').replace(/^\/+|\/+$/g,'').toLowerCase()===parts.join('/').toLowerCase()))throw new Error('resource filename already registered');
    const packageFile=path.join(folder,'package.xml'),original=fs.readFileSync(packageFile);if(fontSnapshot){if(!fontSnapshot.has(packageFile))throw new Error('font package changed during validation');for(const [file,digest] of fontSnapshot)if(hash(fs.readFileSync(file))!==digest)throw new Error('font dependencies changed during validation');}const xml=packageXmlForEdit(original);
    const ids=new Set(entries.map(i=>attr(i,'id')));let id;do{id=crypto.randomBytes(3).toString('hex');}while(ids.has(id));const escaped=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),entry=`<${kind} id="${id}" name="${escaped(filename)}" path="${escaped(packagePath)}"${args.exported?' exported="true"':''}${textureId?' texture="'+escaped(textureId)+'"':''}/>`;
    const token=/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?resources(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/g;let match,open=null,close=null;while((match=token.exec(xml))){if(match[0].startsWith('<!--')||match[0].startsWith('<?'))continue;if(!open&&!match[0].startsWith('</')){open=match;if(/\/\s*>$/.test(match[0]))break;}else if(open&&match[0].startsWith('</')){close=match;break;}}
    if(!open||(!/\/\s*>$/.test(open[0])&&!close))throw new Error('could not locate resources element');const changed=/\/\s*>$/.test(open[0])?xml.slice(0,open.index)+open[0].replace(/\/\s*>$/,`>${entry}</resources>`)+xml.slice(open.index+open[0].length):xml.slice(0,close.index)+'\n    '+entry+'\n  '+xml.slice(close.index);parse(Buffer.from(changed),'package.xml');
    const created=[],temp=path.join(folder,'.fgui-package-'+crypto.randomBytes(16).toString('hex')+'.tmp');let target=null,made=false;
    try{let directory=folder;for(const part of parts){directory=path.join(directory,part);if(!fs.existsSync(directory)){fs.mkdirSync(directory);created.push(directory);}const real=fs.realpathSync(directory),relative=path.relative(fs.realpathSync(folder),real);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||!fs.statSync(real).isDirectory())throw new Error('package path escapes package');}
      target=path.join(directory,filename);const fd=fs.openSync(target,'wx');made=true;try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const out=fs.openSync(temp,'wx');try{fs.writeFileSync(out,changed,'utf8');fs.fsyncSync(out);}finally{fs.closeSync(out);}if(hash(fs.readFileSync(packageFile))!==hash(original))throw new Error('file changed during write');if(fontSnapshot)for(const [file,digest] of fontSnapshot)if(hash(fs.readFileSync(file))!==digest)throw new Error('font dependencies changed during validation');fs.renameSync(temp,packageFile);made=false;return {id,name:filename,path:target,...metadata,sha256:hash(data)};
    }finally{if(made&&target)fs.unlinkSync(target);try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}for(const directory of created.reverse())try{fs.rmdirSync(directory);}catch(e){if(e.code!=='ENOTEMPTY'&&e.code!=='ENOENT')throw e;}}
  });
}

function displaySpans(xml) {
 const token=/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w:.-]*(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?>/g,stack=[],spans=[];let match,list=null,active=null;
 while((match=token.exec(xml))){const tag=match[0];if(tag.startsWith('<!')||tag.startsWith('<?'))continue;if(tag.startsWith('</')){if(active&&stack.length===3){active.end=token.lastIndex;spans.push(active);active=null;}if(stack.length===2&&stack[0]==='component'&&stack[1]==='displayList')list.close=match.index;stack.pop();continue;}const name=/^<([^\s/>]+)/.exec(tag)[1],self=/\/\s*>$/.test(tag);if(stack.length===1&&stack[0]==='component'&&name==='displayList')list={start:match.index,end:token.lastIndex,self,close:null};else if(stack.length===2&&stack[0]==='component'&&stack[1]==='displayList'){active={start:match.index,end:self?token.lastIndex:null};if(self){spans.push(active);active=null;}}if(!self)stack.push(name);}
 if(!list||(!list.self&&list.close===null))throw new Error('could not locate displayList');return {list,spans};
}
function insertFragment(xml,fragment,index) {const {list,spans}=displaySpans(xml);if(!Number.isInteger(index)||index<0||index>spans.length)throw new Error('insert index outside display list');if(list.self){const opening=xml.slice(list.start,list.end).replace(/\/\s*>$/,`>${fragment}</displayList>`);return xml.slice(0,list.start)+opening+xml.slice(list.end);}const pos=index<spans.length?spans[index].start:list.close;return xml.slice(0,pos)+fragment+xml.slice(pos);}
export function editObject(args,operation) {
 const current=execute('read_component',args);if(current.sha256!==args.expected_sha256)throw new Error('expected_sha256 must match current file');const original=fs.readFileSync(current.path);if(hash(original)!==current.sha256)throw new Error('file changed during write');const node=parse(original,'component'),display=children(node,'displayList')[0],objects=children(display),xml=decodeXml(original,'component',true);if(!display)throw new Error('component has no displayList');let result;
 if(operation==='insert_object'){
  if(typeof args.object_xml!=='string')throw new Error('object_xml must be a string');const object=parse(Buffer.from(args.object_xml),'object_xml');if(!['image','component','text','richtext','inputtext','graph','loader','list','group','movieclip','jta'].includes(object.tagName)||!attr(object,'id'))throw new Error('invalid display-list object');if(objects.some(o=>attr(o,'id')===attr(object,'id')))throw new Error('duplicate object id');result=insertFragment(xml,args.object_xml,args.index??objects.length);
 }else{
  const matches=objects.map((o,i)=>({o,i})).filter(({o})=>[attr(o,'id'),attr(o,'name')].includes(args.target));if(matches.length!==1)throw new Error('target child not found or ambiguous');const {o,index:unused,i}=matches[0],id=attr(o,'id'),{spans}=displaySpans(xml);if(spans.length!==objects.length)throw new Error('display list structure changed');const span=spans[i];
  if(operation==='remove_object'){const excluded=new Set(),walk=n=>{excluded.add(n);for(const c of children(n))walk(c);};walk(o);const stack=[node];while(stack.length){const currentNode=stack.pop();if(excluded.has(currentNode))continue;stack.push(...children(currentNode));for(const a of Array.from(currentNode.attributes))if(a.value.split(/[,;\s]+/).includes(id))throw new Error(`object ${id} is referenced by ${currentNode.tagName}`);}result=xml.slice(0,span.start)+xml.slice(span.end);}
  else{if(!Number.isInteger(args.index)||args.index<0||args.index>=objects.length)throw new Error('move index outside display list');const fragment=xml.slice(span.start,span.end),reduced=xml.slice(0,span.start)+xml.slice(span.end);result=insertFragment(reduced,fragment,args.index);}
 }
 return writeComponent({...args,xml:result});
}

// Remove registration only; the resource file is deliberately retained.
export function unregisterResource(args) {
 const root=projectRoot(args.project);return withProjectLock(root,()=>{
  const current=execute('read_package',args);if(current.sha256!==args.expected_sha256)throw new Error('expected_sha256 must match current package');
  const check=()=>{const result=findReferences(args);if(!result.complete)throw new Error('resource reference scan was incomplete; no changes made');if(result.references.length)throw new Error(`resource has ${result.references.length} detected reference(s); no changes made`);return result;};
  const report=check(),original=fs.readFileSync(current.path);if(hash(original)!==current.sha256)throw new Error('package changed during reference scan');const rootNode=parse(original,'package.xml'),items=resources(rootNode),index=items.findIndex(i=>attr(i,'id')===report.id);if(index<0)throw new Error('resource not found');const retained=componentPath(path.dirname(current.path),items[index]),xml=packageXmlForEdit(original);
  const tokens=/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w:.-]*(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?>/g,stack=[];let match,count=0,start=-1,end=-1,active=false;
  while((match=tokens.exec(xml))){const tag=match[0];if(tag.startsWith('<!')||tag.startsWith('<?'))continue;if(tag.startsWith('</')){if(active&&stack.length===3){end=tokens.lastIndex;break;}stack.pop();continue;}const name=/^<([^\s/>]+)/.exec(tag)[1],self=/\/\s*>$/.test(tag);if(stack.length===2&&stack[0]==='packageDescription'&&stack[1]==='resources'&&count++===index){start=match.index;if(self){end=tokens.lastIndex;break;}active=true;}if(!self)stack.push(name);}
  if(start<0||end<0)throw new Error('could not locate registered resource');const changed=Buffer.from(xml.slice(0,start)+xml.slice(end),'utf8');parse(changed,'package.xml');const temp=path.join(path.dirname(current.path),'.fgui-package-'+crypto.randomBytes(16).toString('hex')+'.tmp');
  try{const fd=fs.openSync(temp,'wx');try{fs.writeFileSync(fd,changed);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}check();if(hash(fs.readFileSync(current.path))!==current.sha256)throw new Error('package changed during reference scan');fs.renameSync(temp,current.path);}finally{try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
  return {id:report.id,name:report.name,type:report.type,retained_file:retained,sha256:hash(changed),scope:report.scope};
 });
}

export function setButtonOptions(args){
 const props=args.props,allowed=['mode','sound','downEffect','downEffectValue'];if(!props||typeof props!=='object'||Array.isArray(props)||!Object.keys(props).length||Object.keys(props).some(k=>!allowed.includes(k)))throw new Error('invalid Button options');
 if('mode' in props&&!['Common','Check','Radio'].includes(props.mode))throw new Error('invalid Button mode');if('downEffect' in props&&!['none','dark','scale'].includes(props.downEffect))throw new Error('invalid Button downEffect');if('downEffectValue' in props&&(typeof props.downEffectValue!=='number'||!Number.isFinite(props.downEffectValue)||props.downEffectValue<0||props.downEffectValue>10))throw new Error('invalid Button downEffectValue');
 const current=execute('read_component',args);if(current.sha256!==args.expected_sha256)throw new Error('expected_sha256 must match current file');const original=fs.readFileSync(current.path);if(hash(original)!==current.sha256)throw new Error('file changed during write');const node=parse(original,'component');if(attr(node,'extention')!=='Button')throw new Error('component is not a Button');
 if('sound' in props){const value=props.sound;if(typeof value!=='string'||(value&&!value.startsWith('ui://')))throw new Error('invalid Button sound URL');if(value){const all=packages(projectRoot(args.project)),address=value.slice(5),slash=address.indexOf('/'),owners=all.filter(p=>slash>=0?path.basename(p.folder)===address.slice(0,slash):attr(p.tree,'id')===address.slice(0,8));if(owners.length!==1)throw new Error('sound package missing or ambiguous');const items=resources(owners[0].tree).filter(i=>i.tagName==='sound'&&(slash>=0?path.parse(attr(i,'name')??'').name===address.slice(slash+1):attr(i,'id')===address.slice(8)));if(items.length!==1)throw new Error('sound resource missing or ambiguous');componentPath(owners[0].folder,items[0]);}}
 const buttons=children(node,'Button');if(buttons.length>1||buttons.some(b=>children(b).length||Array.from(b.attributes).some(a=>!allowed.includes(a.name))||Array.from(b.childNodes).some(n=>(n.nodeType===3||n.nodeType===4)&&n.data.trim())))throw new Error('unsupported or duplicate Button settings');const attributes=Object.fromEntries(Array.from(buttons[0]?.attributes??[]).map(a=>[a.name,a.value]));for(const [key,value] of Object.entries(props))attributes[key]=String(value);
 return writeRootOption(args,original,node,'Button',attributes);
}


function writeRootOption(args,original,node,optionTag,attributes){
 const element=node.ownerDocument.createElement(optionTag);for(const [key,value] of Object.entries(attributes))element.setAttribute(key,value);const replacement=new XMLSerializer().serializeToString(element),xml=decodeXml(original,'component',true),tokens=/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w:.-]*(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?>/g,stack=[];let match,begin=-1,end=-1,rootOpen=null,rootClose=-1,active=false;
 while((match=tokens.exec(xml))){const part=match[0];if(part.startsWith('<!')||part.startsWith('<?'))continue;if(part.startsWith('</')){if(active&&stack.length===2){end=tokens.lastIndex;break;}if(stack.length===1&&stack[0]==='component'){rootClose=match.index;break;}stack.pop();continue;}const tag=/^<([^\s/>]+)/.exec(part)[1],self=/\/\s*>$/.test(part);if(stack.length===0&&tag==='component')rootOpen={start:match.index,end:tokens.lastIndex,self};else if(stack.length===1&&stack[0]==='component'&&tag===optionTag){begin=match.index;if(self){end=tokens.lastIndex;break;}active=true;}if(!self)stack.push(tag);}
 let changed;if(begin>=0&&end>=0)changed=xml.slice(0,begin)+replacement+xml.slice(end);else if(rootOpen?.self)changed=xml.slice(0,rootOpen.start)+xml.slice(rootOpen.start,rootOpen.end).replace(/\/\s*>$/,`>${replacement}</component>`)+xml.slice(rootOpen.end);else if(rootClose>=0)changed=xml.slice(0,rootClose)+replacement+xml.slice(rootClose);else throw new Error(`could not locate ${optionTag} settings`);return writeComponent({...args,xml:changed});
}

export function setProgressOptions(args,extension){
 const props=args.props,allowed=['titleType','reverse'];
 if(!props||typeof props!=='object'||Array.isArray(props)||!Object.keys(props).length||Object.keys(props).some(key=>!allowed.includes(key)))throw new Error(`invalid ${extension} options`);
 if('titleType' in props&&!['percent','valueAndmax','value','max'].includes(props.titleType))throw new Error('invalid titleType');
 if('reverse' in props&&typeof props.reverse!=='boolean')throw new Error('reverse must be boolean');
 const current=execute('read_component',args);if(current.sha256!==args.expected_sha256)throw new Error('expected_sha256 must match current file');const original=fs.readFileSync(current.path);if(hash(original)!==current.sha256)throw new Error('file changed during write');const node=parse(original,'component');if(attr(node,'extention')!==extension)throw new Error(`component is not a ${extension}`);
 const configs=children(node,extension);if(configs.length>1||configs.some(config=>children(config).length||Array.from(config.attributes).some(a=>!allowed.includes(a.name))||Array.from(config.childNodes).some(n=>(n.nodeType===3||n.nodeType===4)&&n.data.trim())))throw new Error(`unsupported or duplicate ${extension} settings`);
 const attributes=Object.fromEntries(Array.from(configs[0]?.attributes??[]).map(a=>[a.name,a.value]));for(const [key,value] of Object.entries(props))attributes[key]=String(value);return writeRootOption(args,original,node,extension,attributes);
}

export function setComboBoxOptions(args){
 const props=args.props;if(!props||typeof props!=='object'||Array.isArray(props)||Object.keys(props).length!==1||typeof props.dropdown!=='string')throw new Error('dropdown must be a string');
 const current=execute('read_component',args);if(current.sha256!==args.expected_sha256)throw new Error('expected_sha256 must match current file');const original=fs.readFileSync(current.path);if(hash(original)!==current.sha256)throw new Error('file changed during write');const node=parse(original,'component');if(attr(node,'extention')!=='ComboBox')throw new Error('component is not a ComboBox');
 if(props.dropdown){const matches=urlIndex(packages(projectRoot(args.project))).get(props.dropdown)??[];if(matches.length!==1||matches[0].type!=='component'||!matches[0].isFile())throw new Error('dropdown must reference an existing component UI URL');}
 const configs=children(node,'ComboBox');if(configs.length>1||configs.some(config=>children(config).length||Array.from(config.attributes).some(a=>a.name!=='dropdown')||Array.from(config.childNodes).some(n=>(n.nodeType===3||n.nodeType===4)&&n.data.trim())))throw new Error('unsupported or duplicate ComboBox settings');
 return writeRootOption(args,original,node,'ComboBox',{dropdown:props.dropdown});
}
