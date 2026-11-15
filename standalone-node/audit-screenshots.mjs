#!/usr/bin/env node
// Audit every registered component through the same MCP screenshot interface.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import {resolveChrome} from './browser-path.mjs';
import {message} from './mcp.mjs';
import {execute,projectRoot} from './project.mjs';

export async function auditScreenshots(project,{width=800,height=600,settle_ms=0,onResult=()=>{}}={}) {
 if(![width,height].every(value=>Number.isInteger(value)&&value>=1&&value<=4096))throw new Error('width and height must be integers between 1 and 4096');
 if(!Number.isInteger(settle_ms)||settle_ms<0||settle_ms>10000)throw new Error('settle_ms must be an integer between 0 and 10000');
 if(typeof onResult!=='function')throw new Error('onResult must be a function');
 const root=projectRoot(project),selected=path.resolve(project),packages=execute('list_packages',{project:selected}),results=[];let chrome;
 for(const pkg of packages){
  const items=execute('list_items',{project:selected,pkg:pkg.name}).filter(item=>item.type==='component');
  for(const item of items){
   if(!chrome){chrome=await resolveChrome();try{if(!(await fs.stat(chrome)).isFile())throw new Error('not a file');}catch{throw new Error('Chrome executable not found: '+chrome);}}
   const response=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'screenshot',arguments:{project:selected,pkg:pkg.name,name:item.id,renderer:'pixi',chrome,width,height,settle_ms}}});
   const result=response.result,body=JSON.parse(result?.content?.[0]?.text??'{}'),image=result?.content?.find(part=>part.type==='image');
   const row={package:pkg.name,component:item.name,id:item.id,ok:!result?.isError&&body.ok===true&&!!image};
   if(!row.ok)row.error=body.error??response.error?.message??'screenshot did not return an image';
   else try{if(image.mimeType!=='image/png'||typeof image.data!=='string')throw new Error('screenshot did not return PNG data');const bytes=Buffer.from(image.data,'base64');if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('invalid PNG signature');const decoded=await sharp(bytes,{failOn:'error'}).raw().toBuffer({resolveWithObject:true});if(decoded.info.width!==width||decoded.info.height!==height)throw new Error('screenshot dimensions do not match the viewport');}catch(error){row.ok=false;row.error='invalid screenshot: '+error.message;}
   results.push(row);onResult(row);
  }
 }
 if(!results.length)throw new Error('project has no registered components to audit');
 return {project:root,total:results.length,passed:results.filter(row=>row.ok).length,failed:results.filter(row=>!row.ok).length,results};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
 if(process.argv.length!==3){console.error('usage: node audit-screenshots.mjs PROJECT');process.exitCode=2;}
 else {try{const summary=await auditScreenshots(process.argv[2],{onResult:row=>console.log(JSON.stringify(row))});console.log(JSON.stringify({total:summary.total,passed:summary.passed,failed:summary.failed}));if(summary.failed)process.exitCode=1;}catch(error){console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}}
}
