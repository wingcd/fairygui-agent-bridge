import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';
const run=promisify(execFile),script=fileURLToPath(new URL('./fgui.mjs',import.meta.url));
test('CLI accepts UTF-8 JSON files with and without a BOM and Unicode paths',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-cli-中文 '));
 try{await fs.mkdir(path.join(root,'assets'));await fs.writeFile(path.join(root,'项目.fairy'),'<projectDescription type="CocosCreator"/>');for(const bom of [false,true]){const file=path.join(root,bom?'含标记.json':'普通.json'),payload=Buffer.from(JSON.stringify({project:root}));await fs.writeFile(file,bom?Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),payload]):payload);const {stdout}=await run(process.execPath,[script,'project_info','@'+file],{windowsHide:true});const result=JSON.parse(stdout);assert.equal(result.ok,true,stdout);assert.equal(result.data.package_count,0);assert.equal(result.data.projects[0].file,path.join(root,'项目.fairy'));}}finally{await fs.rm(root,{recursive:true,force:true});}
});
test('CLI rejects malformed UTF-8 JSON files',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-cli-invalid-'));
 try{const file=path.join(root,'args.json');await fs.writeFile(file,Buffer.concat([Buffer.from('{"project":"'),Buffer.from([0xff]),Buffer.from('"}')]));await assert.rejects(run(process.execPath,[script,'project_info','@'+file],{windowsHide:true}),error=>{const result=JSON.parse(error.stdout);assert.equal(error.code,1);assert.equal(result.ok,false);assert.match(result.error,/encoded data|encoding/i);return true;});}finally{await fs.rm(root,{recursive:true,force:true});}
});

test('CLI rejects unexpected arguments instead of silently ignoring them',async()=>{
 await assert.rejects(run(process.execPath,[script,'project_info','{}','unexpected'],{windowsHide:true}),error=>{assert.equal(error.code,1);const result=JSON.parse(error.stdout);assert.equal(result.ok,false);assert.match(result.error,/usage:/);return true;});
});
