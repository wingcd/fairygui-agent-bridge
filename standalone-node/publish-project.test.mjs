import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {message} from './mcp.mjs';
import {encodePng} from './images.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const call=async args=>{const r=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'publish_project_experimental',arguments:args}});return JSON.parse(r.result.content[0].text);};
test('project and preflight preserve the explicitly selected descriptor target', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-descriptor-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.mkdirSync(path.join(root,'settings'));const cocos=path.join(root,'cocos.fairy'),unity=path.join(root,'unity.fairy');fs.writeFileSync(cocos,'<projectDescription type="CocosCreator"/>');fs.writeFileSync(unity,'<projectDescription type="Unity"/>');fs.writeFileSync(path.join(root,'settings','Publish.json'),'{"binaryFormat":true,"compressDesc":true}');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><image id="img" name="image.png" path="/" exported="true"/></resources><publish name="Demo"/></packageDescription>');fs.writeFileSync(path.join(folder,'image.png'),await encodePng({width:4,height:4,pixels:Buffer.alloc(64,255)}));
  const pre=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'preflight_publish',arguments:{project:cocos}}});const report=JSON.parse(pre.result.content[0].text);assert.equal(report.ok,true,report.error);assert.equal(report.data.valid,true,JSON.stringify(report));assert.ok(report.data.packages[0].warnings.some(w=>w.setting==='compressDesc'));
  const output=path.join(root,'published'),result=await call({project:cocos,output});assert.equal(result.ok,true,result.error);assert.ok(result.data.packages[0].warnings.some(w=>w.setting==='compressDesc'));
  const other=await call({project:unity,output:path.join(root,'unity')});assert.equal(other.ok,false);assert.match(other.error,/unsupported for this project target/);assert.equal(fs.existsSync(path.join(root,'unity')),false);
  fs.writeFileSync(path.join(root,'settings','Publish.json'),'{"binaryFormat":false}');const xmlUnity=await call({project:unity,output:path.join(root,'xml-unity')});assert.equal(xmlUnity.ok,true,xmlUnity.error);assert.ok(!xmlUnity.data.packages[0].warnings.some(w=>w.setting==='binaryFormat'));const xmlCocos=await call({project:cocos,output:path.join(root,'xml-cocos')});assert.equal(xmlCocos.ok,true,xmlCocos.error);assert.ok(xmlCocos.data.packages[0].warnings.some(w=>w.setting==='binaryFormat'));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('publication format override works across MCP preflight and project publish without changing settings', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-format-override-'));
 try{
  const folder=path.join(root,'assets','Demo'),settings=path.join(root,'settings');fs.mkdirSync(folder,{recursive:true});fs.mkdirSync(settings);fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription type="CocosCreator"/>');const settingFile=path.join(settings,'Publish.json'),original='{"binaryFormat":false}';fs.writeFileSync(settingFile,original);fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><image id="img" name="image.png" path="/" exported="true"/></resources><publish name="Demo"/></packageDescription>');fs.writeFileSync(path.join(folder,'image.png'),await encodePng({width:4,height:4,pixels:Buffer.alloc(64,255)}));
  const invoke=async(name,args)=>{const response=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});return JSON.parse(response.result.content[0].text);};
  const preflight=await invoke('preflight_publish',{project:root,binary_format:true});assert.equal(preflight.ok,true,preflight.error);assert.equal(preflight.data.valid,true);assert.ok(!preflight.data.packages[0].warnings.some(w=>w.setting==='binaryFormat'));
  const output=path.join(root,'published'),result=await call({project:root,output,binary_format:true});assert.equal(result.ok,true,result.error);const file=path.join(output,result.data.packages[0].file);assert.equal(fs.readFileSync(file).readUInt32BE(0),0x46475549);assert.equal(fs.readFileSync(settingFile,'utf8'),original);
  if(process.env.FGUI_SAMPLE_PROJECT){const build=process.env.FGUI_COCOS_BUILD||path.resolve(process.env.FGUI_SAMPLE_PROJECT,'../../source/build'),script=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../standalone/check_cocos_reader.cjs'),run=spawnSync(process.execPath,[script,build,file],{encoding:'utf8',timeout:60000});assert.equal(run.status,0,run.stderr);}
  const invalid=await call({project:root,output:path.join(root,'invalid'),binary_format:'true'});assert.equal(invalid.ok,false);assert.equal(fs.existsSync(path.join(root,'invalid')),false);
  fs.writeFileSync(settingFile,'{"binaryFormat":true}');const xml=await invoke('publish_images_experimental',{project:root,pkg:'Demo',output:path.join(root,'xml'),binary_format:false});assert.equal(xml.ok,true,xml.error);assert.equal(fs.readFileSync(xml.data.file).readUInt32LE(0),0x04034b50);assert.equal(fs.readFileSync(settingFile,'utf8'),'{"binaryFormat":true}');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('project publication stages dependencies and fails atomically', {skip:process.platform!=='win32'}, async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-project-publish-'));
 try{
  const a=path.join(root,'assets','Main'),b=path.join(root,'assets','Shared');fs.mkdirSync(a,{recursive:true});fs.mkdirSync(b,{recursive:true});
  fs.writeFileSync(path.join(root,'Test.fairy'),'<projectDescription/>');
  fs.writeFileSync(path.join(a,'package.xml'),'<packageDescription id="aaaaaaaa"><resources><component id="main" name="Main.xml" path="/" exported="true"/><swf id="unused" name="unused.swf" path="/"/></resources><publish name="Main"/></packageDescription>');
  fs.writeFileSync(path.join(b,'package.xml'),'<packageDescription id="bbbbbbbb"><resources><image id="pic" name="pic.png" path="/" exported="true"/></resources><publish name="Shared"/></packageDescription>');
  fs.writeFileSync(path.join(b,'pic.png'),await encodePng({width:4,height:4,pixels:Buffer.alloc(64,255)}));
  const component=path.join(a,'Main.xml');fs.writeFileSync(component,'<component size="30,30"><displayList><image id="i" src="pic" pkg="Shared"/></displayList></component>');
  const output=path.join(root,'published'),result=await call({project:root,output});assert.equal(result.ok,true,result.error);const manifest=JSON.parse(fs.readFileSync(result.data.manifest,'utf8'));
  assert.equal(manifest.packages.length,2);assert.deepEqual(manifest.packages.find(p=>p.package==='Main').dependencies,[{id:'bbbbbbbb',name:'Shared'}]);for(const p of manifest.packages)assert.ok(fs.existsSync(path.join(output,p.file)));
  const includeAll=await call({project:root,output:path.join(root,'all-resources'),exported_only:false});assert.equal(includeAll.ok,false);assert.equal(fs.existsSync(path.join(root,'all-resources')),false);
  const collision=await call({project:root,output});assert.equal(collision.ok,false);assert.match(collision.error,/already exist/);
  fs.writeFileSync(component,'<component size="30,30"><displayList><image id="i" src="missing" pkg="Shared"/></displayList></component>');
  const bad=path.join(root,'bad'),failed=await call({project:root,output:bad});assert.equal(failed.ok,false);assert.equal(fs.existsSync(bad),false);assert.equal(fs.readdirSync(root).some(n=>n.startsWith('.fgui-project-')),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
