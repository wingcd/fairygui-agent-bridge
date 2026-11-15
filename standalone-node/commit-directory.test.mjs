import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {commitDirectory} from './commit-directory.mjs';

test('directory commit retries transient Windows errors and revalidates inputs',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-commit-'));try{const stage=path.join(root,'stage'),out=path.join(root,'out');await fs.mkdir(stage);let attempts=0,checks=0;await commitDirectory(stage,out,async()=>{checks++},{platform:'win32',sleep:async()=>{},rename:async(a,b)=>{if(attempts++<2)throw Object.assign(new Error('busy'),{code:'EPERM'});await fs.rename(a,b)}});assert.equal(attempts,3);assert.equal(checks,3);assert.ok((await fs.stat(out)).isDirectory());}finally{await fs.rm(root,{recursive:true,force:true});}
});
test('directory commit stops if source changes or destination appears during retry',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-commit-'));try{const stage=path.join(root,'stage'),out=path.join(root,'out');await fs.mkdir(stage);let checks=0;await assert.rejects(commitDirectory(stage,out,async()=>{if(++checks>1)throw new Error('source changed')},{platform:'win32',sleep:async()=>{},rename:async()=>{throw Object.assign(new Error('busy'),{code:'EPERM'})}}),/source changed/);assert.ok((await fs.stat(stage)).isDirectory());
 await assert.rejects(commitDirectory(stage,out,async()=>{},{platform:'win32',sleep:async()=>{await fs.mkdir(out)},rename:async()=>{throw Object.assign(new Error('busy'),{code:'EPERM'})}}),/output directory must not already exist/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
