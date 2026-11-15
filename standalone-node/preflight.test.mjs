import {test} from 'node:test';
import assert from 'node:assert/strict';
import {message} from './mcp.mjs';

test('preflight snapshot detects edits and creation of optional settings',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{preflightSnapshot}=await import('./preflight-snapshot.mjs');const root=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-snapshot-'));
 try{const file=path.join(root,'Publish.json'),first=preflightSnapshot();await first.read(file,true);await first.verify();await fs.writeFile(file,'{}');await assert.rejects(first.verify(),/project changed during preflight/);const second=preflightSnapshot();await second.read(file);await fs.writeFile(file,'{"binaryFormat":false}');await assert.rejects(second.read(file),/project changed during preflight/);await assert.rejects(second.verify(),/project changed during preflight/);}finally{await fs.rm(root,{recursive:true,force:true});}
});

test('preflight rejects settings changed during an all-resources scan', {skip:process.platform!=='win32'},async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{encodePng}=await import('./images.mjs'),{preflightPublish}=await import('./preflight.mjs');const root=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-preflight-change-')),originalRead=fs.default.readFile;
 try{
  const folder=path.join(root,'assets','Demo'),settings=path.join(root,'settings','Publish.json'),image=path.join(folder,'image.png');await fs.mkdir(folder,{recursive:true});await fs.mkdir(path.dirname(settings));await fs.writeFile(path.join(root,'p.fairy'),'<projectDescription/>');await fs.writeFile(settings,'{"binaryFormat":true}');await fs.writeFile(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><image id="img" name="image.png" path="/" exported="true"/></resources><publish name="Demo"/></packageDescription>');await fs.writeFile(image,await encodePng({width:4,height:4,pixels:Buffer.alloc(64,255)}));
  let changed=false;fs.default.readFile=async function(file,...args){if(!changed&&String(file)===image){changed=true;await fs.writeFile(settings,'{"binaryFormat":false}');}return originalRead.call(this,file,...args);};
  await assert.rejects(preflightPublish({project:root,exported_only:false}),/project changed during preflight/);assert.equal(changed,true);
 }finally{fs.default.readFile=originalRead;await fs.rm(root,{recursive:true,force:true});}
});

test('preflight detects an earlier package image changed while checking a later package', {skip:process.platform!=='win32'},async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{encodePng}=await import('./images.mjs'),{preflightPublish}=await import('./preflight.mjs');const root=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-preflight-source-')),originalRead=fs.default.readFile;
 try{
  const first=path.join(root,'assets','A'),second=path.join(root,'assets','B');await fs.mkdir(first,{recursive:true});await fs.mkdir(second,{recursive:true});await fs.writeFile(path.join(root,'p.fairy'),'<projectDescription/>');
  const png=await encodePng({width:4,height:4,pixels:Buffer.alloc(64,255)}),changedPng=await encodePng({width:4,height:4,pixels:Buffer.alloc(64,127)});for(const [folder,id] of [[first,'aaaaaaaa'],[second,'bbbbbbbb']]){await fs.writeFile(path.join(folder,'package.xml'),`<packageDescription id="${id}"><resources><image id="img" name="image.png" path="/" exported="true"/></resources></packageDescription>`);await fs.writeFile(path.join(folder,'image.png'),png);}
  const firstImage=path.join(first,'image.png'),secondImage=path.join(second,'image.png');let changed=false;fs.default.readFile=async function(file,...args){if(!changed&&String(file)===secondImage){changed=true;await fs.writeFile(firstImage,changedPng);}return originalRead.call(this,file,...args);};
  await assert.rejects(preflightPublish({project:root,exported_only:false}),/project changed during preflight/);assert.equal(changed,true);
 }finally{fs.default.readFile=originalRead;await fs.rm(root,{recursive:true,force:true});}
});

test('preflight reports every Cocos sample package in one call', {skip:process.platform!=='win32'||!process.env.FGUI_SAMPLE_PROJECT,timeout:180000}, async()=>{
  const result=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'preflight_publish',arguments:{project:process.env.FGUI_SAMPLE_PROJECT,exported_only:false}}});
  assert.equal(result.result.isError,false);
  const report=JSON.parse(result.result.content[0].text).data;
  assert.equal(report.packages.length,16);assert.equal(report.valid,false);
  for(const name of ['Joystick','MainMenu','Guide','Cooldown'])assert.equal(report.packages.find(p=>p.package===name)?.ok,true,name);
  assert.match(report.packages.find(p=>p.package==='Basics').error,/swf/);
  assert.ok(report.packages.filter(p=>!p.ok).every(p=>typeof p.error==='string' && p.error.length));
});

test('exported-only preflight evaluates all sample packages and preserves warnings', {skip:process.platform!=='win32'||!process.env.FGUI_SAMPLE_PROJECT,timeout:180000}, async()=>{
  const result=await message({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'preflight_publish',arguments:{project:process.env.FGUI_SAMPLE_PROJECT}}});assert.equal(result.result.isError,false);
  const report=JSON.parse(result.result.content[0].text).data;assert.equal(report.valid,true);assert.equal(report.packages.length,16);assert.ok(report.packages.every(p=>p.ok));
  assert.ok(report.packages.find(p=>p.package==='PullToRefresh').warnings.some(w=>w.gear==='gearDisplay'));assert.ok(report.packages.find(p=>p.package==='Transition').warnings.some(w=>w.transition==='t0'));
});

test('exported-only preflight isolates a broken package and dependent packages', {skip:process.platform!=='win32'},async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path'),{encodePng}=await import('./images.mjs');const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-preflight-errors-'));try{
  fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');for(const n of ['A','B','C'])fs.mkdirSync(path.join(root,'assets',n),{recursive:true});
  fs.writeFileSync(path.join(root,'assets','A','package.xml'),'<packageDescription id="aaaaaaaa"><resources><component id="main" name="Main.xml" path="/" exported="true"/></resources></packageDescription>');fs.writeFileSync(path.join(root,'assets','A','Main.xml'),'<component size="10,10"><displayList><image id="n" xy="0,0" src="missing"/></displayList></component>');
  fs.writeFileSync(path.join(root,'assets','B','package.xml'),'<packageDescription id="bbbbbbbb"><resources><image id="img" name="icon.png" path="/" exported="true"/></resources></packageDescription>');fs.writeFileSync(path.join(root,'assets','B','icon.png'),await encodePng({width:2,height:2,pixels:Buffer.alloc(16,255)}));
  fs.writeFileSync(path.join(root,'assets','C','package.xml'),'<packageDescription id="cccccccc"><resources><component id="main" name="Main.xml" path="/" exported="true"/></resources></packageDescription>');fs.writeFileSync(path.join(root,'assets','C','Main.xml'),'<component size="10,10"><displayList><component id="n" xy="0,0" src="main" pkg="A"/></displayList></component>');
  const response=await message({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'preflight_publish',arguments:{project:root}}});assert.equal(response.result.isError,false);const report=JSON.parse(response.result.content[0].text).data;assert.equal(report.valid,false);assert.equal(report.packages.length,3);assert.equal(report.packages.find(p=>p.package==='B').ok,true);for(const n of ['A','C']){const entry=report.packages.find(p=>p.package===n);assert.equal(entry.ok,false);assert.match(entry.error,/missing published dependency/);}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
