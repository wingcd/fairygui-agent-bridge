#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import {resolveChrome} from './browser-path.mjs';
import {message} from './mcp.mjs';
import {execute,projectRoot} from './project.mjs';

// Audit registered components through the same MCP screenshot interface.
export async function auditScreenshots(project,{width=800,height=600,settle_ms=0,concurrency=1,onResult=()=>{}}={}) {
 if(![width,height].every(value=>Number.isInteger(value)&&value>=1&&value<=4096))throw new Error('width and height must be integers between 1 and 4096');
 if(!Number.isInteger(settle_ms)||settle_ms<0||settle_ms>10000)throw new Error('settle_ms must be an integer between 0 and 10000');
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>4)throw new Error('concurrency must be an integer between 1 and 4');
 if(typeof onResult!=='function')throw new Error('onResult must be a function');
 const root=projectRoot(project),selected=path.resolve(project),packages=execute('list_packages',{project:selected}),jobs=[];
 for(const pkg of packages)for(const item of execute('list_items',{project:selected,pkg:pkg.name}).filter(item=>item.type==='component'))jobs.push({pkg,item});
 if(!jobs.length)throw new Error('project has no registered components to audit');
 const chrome=await resolveChrome();try{if(!(await fs.stat(chrome)).isFile())throw new Error('not a file');}catch{throw new Error('Chrome executable not found: '+chrome);}
 const results=new Array(jobs.length);let next=0;
 await Promise.all(Array.from({length:Math.min(concurrency,jobs.length)},async()=>{
  for(;;){const index=next++;if(index>=jobs.length)return;const {pkg,item}=jobs[index];
   const response=await message({jsonrpc:'2.0',id:index,method:'tools/call',params:{name:'screenshot',arguments:{project:selected,pkg:pkg.name,name:item.id,renderer:'pixi',chrome,width,height,settle_ms}}});
   const result=response.result,body=JSON.parse(result?.content?.[0]?.text??'{}'),image=result?.content?.find(part=>part.type==='image');
   const row={package:pkg.name,component:item.name,id:item.id,ok:!result?.isError&&body.ok===true&&!!image};
   if(!row.ok)row.error=body.error??response.error?.message??'screenshot did not return an image';
   else try{if(image.mimeType!=='image/png'||typeof image.data!=='string')throw new Error('screenshot did not return PNG data');const bytes=Buffer.from(image.data,'base64');if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('invalid PNG signature');const decoded=await sharp(bytes,{failOn:'error'}).raw().toBuffer({resolveWithObject:true});if(decoded.info.width!==width||decoded.info.height!==height)throw new Error('screenshot dimensions do not match the viewport');}catch(error){row.ok=false;row.error='invalid screenshot: '+error.message;}
   results[index]=row;onResult(row);
  }
 }));
 return {project:root,total:results.length,passed:results.filter(row=>row.ok).length,failed:results.filter(row=>!row.ok).length,results};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
 const [project,option,...extra]=process.argv.slice(2);
 if(!project||extra.length||option&&!/^--concurrency=[1-4]$/.test(option)){console.error('usage: node audit-screenshots.mjs PROJECT [--concurrency=1..4]');process.exitCode=2;}
 else {try{const concurrency=option?Number(option.slice('--concurrency='.length)):1,summary=await auditScreenshots(project,{concurrency,onResult:row=>console.log(JSON.stringify(row))});console.log(JSON.stringify({total:summary.total,passed:summary.passed,failed:summary.failed}));if(summary.failed)process.exitCode=1;}catch(error){console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}}
}
