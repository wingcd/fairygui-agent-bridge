import path from 'node:path';
import {attr,children,resources,componentPath,parse} from './project.mjs';
import {readBitmapFont} from './bitmap-font.mjs';
import {richTextUrls} from './references.mjs';

// Match editor publication: a referenced external item must be exported by its
// own package (or reachable from one of that package's exported components).
export async function exportedClosure(packages,readFile,{roots=null,extraRoots=null,onlyExtraRoots=false}={}) {
 const byId=new Map(),byName=new Map(),selected=new Map(),built=new Map(),indexes=new Map();
 for(const pkg of packages){const id=attr(pkg.tree,'id'),name=path.basename(pkg.folder);if(!id||byId.has(id)||byName.has(name))throw new Error('missing or duplicate package identity');byId.set(id,pkg);byName.set(name,pkg);selected.set(pkg.folder,new Set());const ids=new Map(),names=new Map(),exported=[];for(const item of resources(pkg.tree)){const itemId=attr(item,'id');if(!itemId||ids.has(itemId))throw new Error('missing or duplicate resource id');ids.set(itemId,item);const name=path.parse(attr(item,'name')??'').name;let named=names.get(name);if(!named){named=[];names.set(name,named);}named.push(item);if(attr(item,'exported')==='true')exported.push(itemId);}indexes.set(pkg.folder,{ids,names,exported});}
 const resolveUrl=url=>{const address=url.slice(5);let pkg,matches;if(address.includes('/')){const slash=address.indexOf('/');pkg=byName.get(address.slice(0,slash));matches=pkg?(indexes.get(pkg.folder).names.get(address.slice(slash+1))??[]):[];}else{pkg=byId.get(address.slice(0,8));matches=pkg?[indexes.get(pkg.folder).ids.get(address.slice(8))].filter(Boolean):[];}if(matches.length!==1)throw new Error(`unknown or ambiguous UI URL ${url}`);return [pkg,attr(matches[0],'id')];};
 async function build(pkg,seeds=null){if(seeds===null&&built.has(pkg.folder))return built.get(pkg.folder);const own=seeds===null?new Set():selected.get(pkg.folder),todo=seeds===null?[...indexes.get(pkg.folder).exported,...(extraRoots?.get(pkg.folder)??[])]:[...seeds],external=[];
  const add=(target,id)=>{if(target.folder===pkg.folder)todo.push(id);else external.push([target,id]);};
  while(todo.length){const id=todo.pop();if(own.has(id))continue;const item=indexes.get(pkg.folder).ids.get(id);if(!item)throw new Error(`missing published dependency ${id} in ${path.basename(pkg.folder)}`);own.add(id);
   if(item.tagName==='font'){const font=readBitmapFont(await readFile(componentPath(pkg.folder,item)),attr(item,'texture'));for(const image of new Set([font.texture,...font.glyphs.map(g=>g.image)].filter(Boolean)))todo.push(image);}
   if(item.tagName!=='component')continue;const component=parse(await readFile(componentPath(pkg.folder,item)),'component');if(component.tagName!=='component')throw new Error('invalid component');
   for(const child of children(children(component,'displayList')[0]))if(attr(child,'src')){const alias=attr(child,'pkg'),candidates=alias?[...new Set([byId.get(alias),byName.get(alias)].filter(Boolean))]:[pkg];if(candidates.length!==1)throw new Error(`unknown or ambiguous referenced package ${alias}`);add(candidates[0],attr(child,'src'));}
   const rich=new Map(children(children(component,'displayList')[0]).filter(child=>child.tagName==='richtext'&&attr(child,'id')).map(child=>[attr(child,'id'),child]));const stack=[component];while(stack.length){const element=stack.pop();stack.push(...children(element).filter(child=>!(element.tagName==='list'&&attr(element,'autoClearItems')==='true'&&child.tagName==='item')));for(const attribute of Array.from(element.attributes)){const owner=element.tagName==='richtext'&&attribute.name==='text'?element:element.tagName==='gearText'&&['values','default'].includes(attribute.name)&&element.parentNode?.tagName==='richtext'?element.parentNode:element.tagName==='item'&&attr(element,'type')==='Text'&&['value','startValue','endValue'].includes(attribute.name)?rich.get(attr(element,'target')):null;if(owner){const urls=richTextUrls(attribute.value,attr(owner,'ubb')==='true');if(urls.length){for(const url of urls)add(...resolveUrl(url));continue;}}if(element.tagName==='gearIcon'&&attribute.name==='values'){for(const url of attribute.value.split('|'))if(url.startsWith('ui://'))add(...resolveUrl(url));continue;}if(attribute.value.startsWith('ui://')){let exact=null;try{exact=resolveUrl(attribute.value);}catch{}if(exact){add(...exact);continue;}}for(const match of attribute.value.matchAll(/ui:\/\/[^\s\[\]"'<> ,|]+/g)){const [target,id]=resolveUrl(match[0]);add(target,id);}}}
  }
  const result={own,external};if(seeds===null)built.set(pkg.folder,result);selected.set(pkg.folder,own);return result;
 }
 if(onlyExtraRoots){
  // Preview only the selected component and dependencies; still check that
  // external resources belong to their package's normal export closure.
  const allowed=new Map(),queue=[];
  for(const pkg of packages)if(!roots||roots.has(pkg.folder)){const seeds=[...(extraRoots?.get(pkg.folder)??[])];if(seeds.length)queue.push([pkg,seeds]);}
  while(queue.length){const [pkg,seeds]=queue.pop(),record=await build(pkg,seeds);for(const [target,id] of record.external){let eligible=allowed.get(target.folder);if(!eligible){eligible=await exportedClosure(packages,readFile,{roots:new Set([target.folder])});allowed.set(target.folder,eligible);}if(!eligible.get(target.folder)?.has(id))throw new Error(`external resource ${id} is not included in exported package ${path.basename(target.folder)}`);if(!selected.get(target.folder).has(id))queue.push([target,[id]]);}}
  return selected;
 }
 const queue=roots?packages.filter(p=>roots.has(p.folder)):[...packages],visited=new Set();
 while(queue.length){const pkg=queue.pop();if(visited.has(pkg.folder))continue;visited.add(pkg.folder);const record=await build(pkg);for(const [target,id] of record.external){const targetRecord=await build(target);if(!targetRecord.own.has(id))throw new Error(`external resource ${id} is not included in exported package ${path.basename(target.folder)}`);queue.push(target);}}
 return selected;
}
