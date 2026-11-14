import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {projectRoot,isFairyDescriptorName,packages,attr,parse} from './project.mjs';
import {exportedClosure} from './exported-closure.mjs';
import {publishImages} from './publish-images.mjs';
import {preflightSnapshot} from './preflight-snapshot.mjs';

// Exercise every package independently and discard all temporary publications.
export async function preflightPublish(args) {
  if(args.exported_only!==undefined&&typeof args.exported_only!=='boolean')throw new Error('exported_only must be a boolean');
  if(args.binary_format!==undefined&&typeof args.binary_format!=='boolean')throw new Error('binary_format must be a boolean');
  const exportedOnly=args.exported_only??true,root=projectRoot(args.project), all=packages(root),snapshot=preflightSnapshot(),read=snapshot.read,descriptors=(await fs.readdir(root)).filter(n=>isFairyDescriptorName(n)).sort();
  await read(path.join(root,'settings','Publish.json'),true);for(const file of descriptors)await read(path.join(root,file));for(const pkg of all)pkg.tree=parse(await read(path.join(pkg.folder,'package.xml')),'package.xml');
  let closure=null;const closureErrors=new Map();if(exportedOnly){try{closure=await exportedClosure(all,read);}catch{closure=new Map(all.map(pkg=>[pkg.folder,new Set()]));for(const pkg of all){try{const partial=await exportedClosure(all,read,{roots:new Set([pkg.folder])});for(const [folder,ids] of partial)for(const id of ids)closure.get(folder).add(id);}catch(error){closureErrors.set(pkg.folder,error.message);}}}}
  const staging=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-node-preflight-'));
  const results=[];
  try {
    for(const [index,pkg] of all.entries()) {
      const name=path.basename(pkg.folder),id=attr(pkg.tree,'id');
      if(closureErrors.has(pkg.folder)){results.push({package:name,id,ok:false,error:closureErrors.get(pkg.folder)});continue;}
      if(closure&&closure.get(pkg.folder).size===0){results.push({package:name,id,ok:true,skipped:true,reason:'no exported resources'});continue;}
      try {
        const published=await publishImages({...args,exported_only:exportedOnly,pkg:name,output:path.join(staging,String(index))},{allowSounds:true,allowComponents:true,preselectedClosure:closure,recordSource:snapshot.record});
        const {output,file,...stats}=published;results.push({package:name,id,ok:true,...stats});
      } catch(error) {results.push({package:name,id,ok:false,error:error.message});}
    }
  } finally {await fs.rm(staging,{recursive:true,force:true});}
  await snapshot.verify();if(JSON.stringify(packages(root).map(p=>p.folder))!==JSON.stringify(all.map(p=>p.folder)))throw new Error('project packages changed during preflight');if(JSON.stringify((await fs.readdir(root)).filter(n=>isFairyDescriptorName(n)).sort())!==JSON.stringify(descriptors))throw new Error('project descriptors changed during preflight');
  let changed;do {changed=false;const passed=new Set(results.filter(r=>r.ok).map(r=>r.id));for(const result of results)if(result.ok){const missing=(result.dependencies??[]).filter(d=>!passed.has(d.id));if(missing.length){result.ok=false;result.error='dependency package did not pass preflight: '+missing.map(d=>d.id).join(', ');changed=true;}}}while(changed);
  return {valid:results.some(result=>result.ok&&!result.skipped)&&results.every(result=>result.ok),packages:results,scope:'experimental Node publication only; does not verify editor or runtime compatibility'};
}
