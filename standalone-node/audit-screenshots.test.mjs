import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {auditScreenshots} from './audit-screenshots.mjs';
test('screenshot audit reports valid and broken components',{skip:!process.env.FGUI_CHROME||process.platform!=='win32',timeout:90000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fgui audit 中文 -'));
 try{const dir=path.join(root,'assets','Demo');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(root,'p.fairy'),'<projectDescription type="CocosCreator"/>');await fs.writeFile(path.join(dir,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="good" name="Good.xml" path="/"/><component id="bad" name="Bad.xml" path="/"/></resources><publish name="Demo"/></packageDescription>');await fs.writeFile(path.join(dir,'Good.xml'),'<component size="20,20"><displayList/></component>');await fs.writeFile(path.join(dir,'Bad.xml'),'<component size="20,20"><displayList><image id="i" src="missing"/></displayList></component>');const seen=[],report=await auditScreenshots(root,{width:40,height:40,onResult:row=>seen.push(row)});assert.equal(report.total,2);assert.equal(report.passed,1);assert.equal(report.failed,1);assert.equal(seen.length,2);assert.match(report.results.find(row=>!row.ok).error,/missing/);const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{fileURLToPath}=await import('node:url');await assert.rejects(promisify(execFile)(process.execPath,[fileURLToPath(new URL('./audit-screenshots.mjs',import.meta.url)),root],{windowsHide:true,timeout:90000}),error=>{assert.equal(error.code,1);const rows=error.stdout.trim().split(/\r?\n/).map(JSON.parse),summary=rows.at(-1);assert.deepEqual(summary,{total:2,passed:1,failed:1});return true;});}finally{await fs.rm(root,{recursive:true,force:true});}
});

test('screenshot audit does not report an empty project as passing',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-empty-audit-'));
 try{const dir=path.join(root,'assets','Demo');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(root,'p.fairy'),'<projectDescription type="CocosCreator"/>');await fs.writeFile(path.join(dir,'package.xml'),'<packageDescription id="abcdefgh"><resources/></packageDescription>');await assert.rejects(auditScreenshots(root),/no registered components/);}finally{await fs.rm(root,{recursive:true,force:true});}
});

test('screenshot audit CLI returns structured errors for invalid projects',async()=>{
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{fileURLToPath}=await import('node:url');
 const script=fileURLToPath(new URL('./audit-screenshots.mjs',import.meta.url)),missing=path.join(os.tmpdir(),'fgui-missing-audit-'+Date.now());
 await assert.rejects(promisify(execFile)(process.execPath,[script,missing],{windowsHide:true}),error=>{const detail=JSON.parse(error.stderr.trim());assert.equal(detail.ok,false);assert.equal(typeof detail.error,'string');assert.equal(error.code,1);return true;});
});

test('screenshot audit validates options before inspecting a project',async()=>{
 for(const options of [{width:0},{height:4097},{settle_ms:-1},{onResult:null}])await assert.rejects(auditScreenshots('unused',options));
});

test('screenshot audit preserves an explicitly selected descriptor',{skip:!process.env.FGUI_CHROME||process.platform!=='win32',timeout:90000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-audit-descriptor-'));
 try{const dir=path.join(root,'assets','Demo');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(root,'selected.fairy'),'<projectDescription type="CocosCreator"/>');await fs.writeFile(path.join(root,'broken.fairy'),'<broken');await fs.writeFile(path.join(dir,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources><publish name="Demo"/></packageDescription>');await fs.writeFile(path.join(dir,'Main.xml'),'<component size="20,20"><displayList/></component>');const report=await auditScreenshots(path.join(root,'selected.fairy'),{width:20,height:20});assert.equal(report.total,1);assert.equal(report.failed,0,JSON.stringify(report));}finally{await fs.rm(root,{recursive:true,force:true});}
});

test('screenshot audit rejects a missing browser before processing components',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-audit-browser-')),previous=process.env.FGUI_CHROME;
 try{const dir=path.join(root,'assets','Demo');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(root,'p.fairy'),'<projectDescription type="CocosCreator"/>');await fs.writeFile(path.join(dir,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources></packageDescription>');process.env.FGUI_CHROME=path.join(root,'missing-browser');let count=0;await assert.rejects(auditScreenshots(root,{onResult:()=>count++}),/Chrome executable not found/);assert.equal(count,0);}finally{if(previous===undefined)delete process.env.FGUI_CHROME;else process.env.FGUI_CHROME=previous;await fs.rm(root,{recursive:true,force:true});}
});
