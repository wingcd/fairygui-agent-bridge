import {commitDirectory} from './commit-directory.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {projectRoot,isFairyDescriptorName,packages,resources,componentPath,attr} from './project.mjs';
import {publishImages} from './publish-images.mjs';
import {exportedClosure} from './exported-closure.mjs';

// Stage the complete output beside its final destination, then expose it in one rename.
export async function publishProject(args,{extraRoots=null,roots=null,legacyPreview=false,onlyExtraRoots=false,previewDefaultScrollbars=false}={}) {
  if(process.platform!=='win32')throw new Error('project publication currently requires Windows directory rename semantics');
  if(typeof args.output!=='string'||!args.output)throw new Error('output is required');
  const root=projectRoot(args.project),output=path.resolve(args.output),parent=path.dirname(output);
  try{await fs.lstat(output);throw new Error('output directory must not already exist');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(args.exported_only!==undefined&&typeof args.exported_only!=='boolean')throw new Error('exported_only must be a boolean');
  if(args.binary_format!==undefined&&typeof args.binary_format!=='boolean')throw new Error('binary_format must be a boolean');
  const exportedOnly=args.exported_only??true,all=packages(root),ids=all.map(p=>attr(p.tree,'id')),closure=exportedOnly?await exportedClosure(all,file=>fs.readFile(file),{extraRoots,roots,onlyExtraRoots}):null;
  if(ids.some(id=>!id)||new Set(ids).size!==ids.length)throw new Error('project packages need unique IDs');
  const files=new Set([path.join(root,'settings','Publish.json')]),folders=all.map(p=>p.folder);
  const descriptors=(await fs.readdir(root)).filter(n=>isFairyDescriptorName(n)).sort();for(const file of descriptors)files.add(path.join(root,file));
  for(const pkg of all){files.add(path.join(pkg.folder,'package.xml'));for(const item of resources(pkg.tree))if(!closure||closure.get(pkg.folder).has(attr(item,'id')))files.add(componentPath(pkg.folder,item));}
  const digest=async file=>{try{return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');}catch(e){if(e.code==='ENOENT'&&file===path.join(root,'settings','Publish.json'))return null;throw e;}};
  const snapshot=new Map();for(const file of files)snapshot.set(file,await digest(file));
  const staging=await fs.mkdtemp(path.join(parent,'.fgui-project-'));let moved=false;
  try{
    const records=[],skipped=[];
    for(const pkg of all){const name=path.basename(pkg.folder),id=attr(pkg.tree,'id');if(!resources(pkg.tree).some(item=>!closure||closure.get(pkg.folder).has(attr(item,'id')))){skipped.push({id,package:name,reason:closure?'no exported resources':'empty package'});continue;}
      const result=await publishImages({...args,exported_only:exportedOnly,pkg:name,output:path.join(staging,name)},{allowSounds:true,allowComponents:true,preselectedClosure:closure,legacyPreview,previewDefaultScrollbars});
      records.push({id,package:name,file:`${name}/${path.basename(result.file)}`,dependencies:result.dependencies,warnings:result.warnings});
    }
    if(!records.length)throw new Error('project has no selected resources to publish');
    const included=new Set(records.map(record=>record.id));for(const record of records){const missing=record.dependencies.filter(d=>!included.has(d.id));if(missing.length)throw new Error(`${record.package}: dependency package not included: ${missing.map(d=>d.id).join(', ')}`);}
    const manifest={format:'fgui-offline-project-v1',packages:records,skipped};await fs.writeFile(path.join(staging,'publication.json'),JSON.stringify(manifest,null,2)+'\n');
    await commitDirectory(staging,output,async()=>{
    for(const [file,expected] of snapshot)if(await digest(file)!==expected)throw new Error(`publication source changed: ${file}`);
    if(closure){const current=await exportedClosure(packages(root),file=>fs.readFile(file),{extraRoots,roots,onlyExtraRoots});for(const [folder,ids] of closure){const next=current.get(folder);if(!next||ids.size!==next.size||[...ids].some(id=>!next.has(id)))throw new Error('exported dependency closure changed during publication');}}
    if(JSON.stringify(packages(root).map(p=>p.folder))!==JSON.stringify(folders)||JSON.stringify((await fs.readdir(root)).filter(n=>isFairyDescriptorName(n)).sort())!==JSON.stringify(descriptors))throw new Error('project packages or descriptors changed during publication');
    });moved=true;return {output,manifest:path.join(output,'publication.json'),packages:records,skipped,experimental:true};
  } finally {if(!moved)await fs.rm(staging,{recursive:true,force:true});}
}
