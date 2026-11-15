import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFile} from 'node:child_process';import {fileURLToPath} from 'node:url';import {execute} from './project.mjs';

test('separate CLI processes cannot overwrite the same revision',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-process-race-'));
 try{const dir=path.join(root,'assets','Demo');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription type="CocosCreator"/>');fs.writeFileSync(path.join(dir,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources></packageDescription>');const file=path.join(dir,'Main.xml');fs.writeFileSync(file,'<component size="40,40"><displayList><text id="t" xy="0,0" text="initial"/></displayList></component>');const base={project:root,pkg:'Demo',name:'Main'},sha=execute('read_component',base).sha256,script=fileURLToPath(new URL('./fgui.mjs',import.meta.url));
  const invoke=text=>new Promise(resolve=>execFile(process.execPath,[script,'set_properties',JSON.stringify({...base,target:'t',props:{text},expected_sha256:sha})],{windowsHide:true},(error,stdout,stderr)=>resolve({error,stdout,stderr})));
  const responses=await Promise.all([invoke('first'),invoke('second')]);const parsed=responses.map(result=>JSON.parse(result.stdout));assert.equal(parsed.filter(result=>result.ok).length,1);assert.equal(parsed.filter(result=>!result.ok).length,1);assert.match(fs.readFileSync(file,'utf8'),/text="(first|second)"/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
