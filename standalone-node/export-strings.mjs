import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {packages,resources,componentPath,parse,children,attr,projectRoot} from './project.mjs';

// Extract the tested TranslationHelper-compatible subset. Numeric-only values
// are ignored as they are by the editor's default export settings.
export async function exportStrings(args){
 const root=projectRoot(args.project),rows=[],keys=new Set(),snapshot=new Map(),initial=packages(root);
 const read=async file=>{const bytes=await fs.readFile(file);snapshot.set(file,crypto.createHash('sha256').update(bytes).digest('hex'));return bytes;};
 const add=(key,value,label)=>{if(!value||value==='-'||!/[\p{L}]/u.test(value))return;if(keys.has(key))throw new Error('duplicate translation key: '+key);keys.add(key);rows.push({key,value,label});};
 for(const pkg of initial){
  const packageFile=path.join(pkg.folder,'package.xml');pkg.tree=parse(await read(packageFile),packageFile);if(pkg.tree.tagName!=='packageDescription')throw new Error('invalid package root: '+packageFile);
  const packageId=attr(pkg.tree,'id');if(!packageId)throw new Error('package id is missing');
  for(const item of resources(pkg.tree)){
   if(item.tagName!=='component')continue;const id=attr(item,'id');if(!id)throw new Error('component id is missing');
   const file=componentPath(pkg.folder,item),component=parse(await read(file),file);if(component.tagName!=='component')throw new Error('invalid component root: '+file);
   for(const object of children(children(component,'displayList')[0])){
    const childId=attr(object,'id');if(!childId)throw new Error('display object id is missing: '+file);const key=packageId+id+'-'+childId,label=attr(object,'name')||childId;
    if(['text','richtext'].includes(object.tagName)){
     add(key,attr(object,'text'),label);add(key+'-prompt',attr(object,'prompt'),label);
     for(const gear of children(object,'gearText')){for(const [i,value] of (attr(gear,'values')??'').split('|').entries())add(key+'-texts_'+i,value,label);add(key+'-texts_def',attr(gear,'default'),label);}
    }
    if(object.tagName==='component'){
     for(const kind of ['Button','Label'])for(const entry of children(object,kind)){add(key,attr(entry,'title'),label);add(key+'-0',attr(entry,'selectedTitle'),label);}
     for(const combo of children(object,'ComboBox'))for(const [i,entry] of children(combo,'item').entries())add(key+'-'+i,attr(entry,'title'),label);
    }
    if(object.tagName==='list')for(const [i,entry] of children(object,'item').entries()){add(key+'-'+i,attr(entry,'title'),label);add(key+'-'+i+'-0',attr(entry,'selectedTitle'),label);}
    add(key+'-tips',attr(object,'tooltips'),label);
   }
  }
 }
 const finalPackages=packages(root).map(pkg=>pkg.folder);if(finalPackages.length!==initial.length||finalPackages.some((folder,i)=>folder!==initial[i].folder))throw new Error('project packages changed during strings export');
 for(const [file,hash] of snapshot){let bytes;try{bytes=await fs.readFile(file);}catch{throw new Error('project source changed during strings export: '+file);}if(crypto.createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error('project source changed during strings export: '+file);}
 const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 const xml='<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'+rows.map(row=>'  <string name="'+escape(row.key)+'" mz="'+escape(row.label)+'">'+escape(row.value)+'</string>\n').join('')+'</resources>\n';
 let output=null;if(args.output!==undefined){if(typeof args.output!=='string'||!args.output)throw new Error('output must be a nonempty path');output=path.resolve(args.output);await fs.writeFile(output,xml,{flag:'wx'});}
 return {xml,count:rows.length,output,experimental:true};
}
