import fs from 'node:fs';
import path from 'node:path';
import {XMLSerializer} from '@xmldom/xmldom';
import {projectRoot,packages,resources,componentPath,parse,children,attr} from './project.mjs';
import {referenceIssues,resourceIndex,urlIndex} from './references.mjs';

// Adapt the conventions used by the referenced XML generator to editor XML.
// This only returns a proposal; the caller must review and write it separately.
export function adaptGeneratorComponent(args){
 if(typeof args.xml!=='string')throw new Error('xml is required');
 const root=projectRoot(args.project),all=packages(root),current=all.filter(pkg=>[path.basename(pkg.folder),attr(pkg.tree,'id')].includes(args.pkg));if(current.length!==1)throw new Error('package not found or ambiguous');
 const node=parse(Buffer.from(args.xml,'utf8'),'generator XML');if(node.tagName!=='component')throw new Error('component root is required');const lists=children(node,'displayList');if(lists.length!==1)throw new Error('component must contain one displayList');const list=lists[0],changes=[],assumptions=[];
 if(node.hasAttribute('name')){const name=attr(node,'name');node.removeAttribute('name');changes.push({kind:'component_name',value:name,detail:'component name belongs to the package resource, not the component root'});}
 const objectTypes=new Set(['image','component','text','richtext','inputtext','graph','loader','list','group','movieclip','jta']);
 const vector=(value,label)=>{const parts=(value??'').split(',');if(parts.length!==2||parts.some(v=>!/^[-+]?\d+$/.test(v.trim())||Number(v)<-2147483648||Number(v)>2147483647))throw new Error(`invalid ${label}`);return parts.map(Number);};
 for(const group of children(list).filter(n=>n.tagName==='group')){
  const members=children(group).filter(n=>objectTypes.has(n.tagName));if(!members.length)continue;
  if(children(group).some(n=>!objectTypes.has(n.tagName)))throw new Error('nested generator group contains unsupported metadata or objects; manual conversion required');
  if(members.some(n=>n.tagName==='group'||n.hasAttribute('group')))throw new Error('nested groups or existing group membership require manual conversion');
  const id=attr(group,'id'),layout=attr(group,'layout'),origin=vector(attr(group,'xy'),'group xy');if(!id||!['hz','vt'].includes(layout))throw new Error('nested generator group needs an id and hz/vt layout');
  const gapText=attr(group,'gap')??'0';if(!/^[-+]?\d+$/.test(gapText)||Number(gapText)<-2147483648||Number(gapText)>2147483647)throw new Error('invalid group gap');const gap=Number(gapText),axis=layout==='hz'?0:1;
  if(group.hasAttribute('gap')){const target=layout==='hz'?'colGap':'lineGap';if(group.hasAttribute(target)&&attr(group,target)!==gapText)throw new Error('conflicting group gap settings');group.setAttribute(target,gapText);group.removeAttribute('gap');}
  group.setAttribute('advanced','true');let cursor=0;const anchor=group.nextSibling;
  for(const [memberIndex,member] of members.entries()){if(['text','richtext','inputtext'].includes(member.tagName)&&member.hasAttribute('size')&&!member.hasAttribute('autoSize')){member.setAttribute('autoSize','none');changes.push({kind:'fixed_text_size',id:attr(member,'id')});assumptions.push(`Text ${attr(member,'id')}: explicit generator size is treated as fixed.`);}let local;if(member.hasAttribute('xy')){local=vector(attr(member,'xy'),'nested child xy');if(local[axis]!==cursor){changes.push({kind:'group_relayout',id:attr(member,'id'),axis:layout==='hz'?'x':'y',from:local[axis],to:cursor});assumptions.push(`Group ${id}: layout overrides the main-axis position of ${attr(member,'id')}.`);local[axis]=cursor;}}else{local=[0,0];local[axis]=cursor;}const absolute=local.map((n,i)=>n+origin[i]);if(absolute.some(n=>n< -2147483648||n>2147483647))throw new Error('nested child position is out of range');member.setAttribute('xy',absolute.join(','));member.setAttribute('group',id);if(member.hasAttribute('size')){const size=vector(attr(member,'size'),'nested child size');if(size.some(n=>n<0))throw new Error('invalid nested child size');cursor=local[axis]+(size[axis]===0?0:size[axis]+gap);}else if(memberIndex<members.length-1)throw new Error('size is required to infer nested group layout');group.removeChild(member);list.insertBefore(member,anchor);}
  changes.push({kind:'flatten_group',id,members:members.length});assumptions.push(`Group ${id}: nested xy coordinates are relative to the group; missing positions follow ${layout} layout.`);
 }
 const index=new Map();for(const pkg of all)for(const item of resources(pkg.tree)){const id=attr(item,'id'),pkgId=attr(pkg.tree,'id'),name=attr(item,'name');if(!id||!pkgId||!name)continue;const record={pkg,item,id,pkgId};for(const url of ['ui://'+pkgId+id,'ui://'+path.basename(pkg.folder)+'/'+path.parse(name).name])index.set(url,[...(index.get(url)??[]),record]);}
 for(const child of children(list)){
  const src=attr(child,'src');if(src?.startsWith('ui://')){const expected={image:'image',component:'component',movieclip:'movieclip',jta:'movieclip'}[child.tagName];if(!expected)throw new Error(`cannot convert src URL on ${child.tagName}`);const matches=index.get(src)??[];if(matches.length!==1||matches[0].item.tagName!==expected)throw new Error(`resource URL missing, ambiguous or incompatible: ${src}`);const hit=matches[0];if(!fs.statSync(componentPath(hit.pkg.folder,hit.item)).isFile())throw new Error(`resource file missing: ${src}`);if(child.hasAttribute('pkg'))throw new Error('src URL and pkg cannot both be specified');child.setAttribute('src',hit.id);if(hit.pkg.folder!==current[0].folder)child.setAttribute('pkg',hit.pkgId);changes.push({kind:'resource_url',id:attr(child,'id'),from:src,to:hit.id,package:hit.pkgId});}
  if(child.tagName==='graph')for(const key of ['lineColor','fillColor']){const value=attr(child,key);if(value&&/^#[0-9a-f]{6}$/i.test(value)){child.setAttribute(key,'#ff'+value.slice(1));changes.push({kind:'graph_color',id:attr(child,'id'),attribute:key});}}
  if(child.tagName==='list'&&attr(child,'layout')==='flow'){child.setAttribute('layout','flow_hz');changes.push({kind:'list_layout',id:attr(child,'id'),from:'flow',to:'flow_hz'});assumptions.push(`List ${attr(child,'id')}: generator flow layout is interpreted as flow_hz.`);}
 }
 const objects=children(list),ids=objects.map(child=>attr(child,'id'));if(ids.some(id=>!id)||new Set(ids).size!==ids.length)throw new Error('display objects require unique nonempty IDs');
 const issues=referenceIssues(node,resourceIndex(all),path.basename(current[0].folder),urlIndex(all));
 return {xml:new XMLSerializer().serializeToString(node.ownerDocument),changes,assumptions,reference_issues:issues,references_valid:issues.length===0,scope:'generator convention adaptation and reference checks; review layout and run publication preflight before use'};
}
