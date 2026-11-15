import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {encodePng} from './images.mjs';
import {publishImages} from './publish-images.mjs';
import {message} from './mcp.mjs';
import {validatePublished,inspectPublished} from './published.mjs';

test('published component mask and hit test are checked against source', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-mask-check-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription type="CocosCreator"/>');
  fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/" exported="true"/></resources><publish name="Demo"/></packageDescription>');
  const source=path.join(folder,'Main.xml'),original='<component size="100,100" mask="a" hitTest="b" reversedMask="true" opaque="false"><displayList><graph id="a" xy="0,0"/><graph id="b" xy="0,0"/></displayList></component>';fs.writeFileSync(source,original);
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out')},{allowSounds:true,allowComponents:true});
  assert.equal((await validatePublished({project:root,file:result.file,compare_components:true})).valid,true);
  for(const changed of [original.replace('mask="a"','mask="b"'),original.replace('hitTest="b"','hitTest="a"'),original.replace('opaque="false"','opaque="true"'),original.replace('reversedMask="true"','reversedMask="false"')]){fs.writeFileSync(source,changed);const report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(i=>i.error.includes('opacity, mask or hit test')));}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('published component scroll layout is compared with source', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-component-scroll-check-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription type="CocosCreator"/>');
  fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/" exported="true"/></resources><publish name="Demo"/></packageDescription>');
  const source=path.join(folder,'Main.xml'),original='<component size="100,100" pivot="0.5,0.25" margin="1,2,3,4" overflow="scroll" scroll="horizontal" scrollBar="auto" scrollBarFlags="4" scrollBarMargin="5,6,7,8"><displayList/></component>';fs.writeFileSync(source,original);
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out')},{allowSounds:true,allowComponents:true});
  assert.equal((await validatePublished({project:root,file:result.file,compare_components:true})).valid,true);
  for(const changed of [original.replace('scrollBarFlags="4"','scrollBarFlags="5"'),original.replace('pivot="0.5,0.25"','pivot="0.5,0.5"'),original.replace('margin="1,2,3,4"','margin="1,2,3,5"')]){fs.writeFileSync(source,changed);const report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(i=>i.error.includes('component layout or scroll')));}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('published list scrolling and controller settings are checked against source', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-list-scroll-check-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription type="CocosCreator"/>');
  fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/" exported="true"/></resources><publish name="Demo"/></packageDescription>');
  const source=path.join(folder,'Main.xml'),original='<component size="100,100"><controller name="state" pages="p0,One,p1,Two"/><displayList><list id="n1" xy="0,0" size="50,50" overflow="scroll" scroll="horizontal" scrollBar="auto" scrollBarFlags="4" scrollBarMargin="1,2,3,4" margin="5,6,7,8" clipSoftness="2,3" pageController="state" selectionController="state"/></displayList></component>';fs.writeFileSync(source,original);
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out')},{allowSounds:true,allowComponents:true});
  const data=await inspectPublished({file:result.file}),behavior=data.items.find(i=>i.id==='main').component.children[0].listBehavior;
  assert.deepEqual(behavior,{margin:[5,6,7,8],overflow:2,clipSoftness:[2,3],pageController:0,selectionController:0,scroll:{type:0,barDisplay:2,flags:4,barMargin:[1,2,3,4],resources:[null,null,null,null]}});
  assert.equal((await validatePublished({project:root,file:result.file,compare_components:true})).valid,true);
  for(const changed of [original.replace('scrollBarFlags="4"','scrollBarFlags="5"'),original.replace('selectionController="state"','selectionController=""'),original.replace('margin="5,6,7,8"','margin="5,6,7,9"')]){
   fs.writeFileSync(source,changed);const report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(i=>i.error.includes('list overflow, scrolling or controller')));
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('list render order and behavior flags survive publication and auto-clear removes items', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-list-flags-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription type="CocosCreator"/>');
  fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/" exported="true"/><component id="item" name="Item.xml" path="/"/></resources><publish name="Demo"/></packageDescription>');
  fs.writeFileSync(path.join(folder,'Item.xml'),'<component size="10,10"><displayList/></component>');
  const source=path.join(folder,'Main.xml');fs.writeFileSync(source,'<component size="20,20"><displayList><list id="a" xy="0,0" defaultItem="ui://abcdefghitem" renderOrder="arch" autoClearItems="true" scrollItemToViewOnClick="false" foldInvisibleItems="true"><item url="ui://abcdefghmissing" title="clear"/></list><list id="b" xy="0,0" defaultItem="ui://abcdefghitem" renderOrder="descent"><item title="keep"/></list><list id="tree" xy="0,0" treeView="true" defaultItem="ui://abcdefghitem"><item title="root" level="0"/><item title="child" level="1"/></list></displayList></component>');
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out'),exported_only:true},{allowSounds:true,allowComponents:true});
  const data=await inspectPublished({file:result.file}),children=data.items.find(i=>i.id==='main').component.children;
  assert.deepEqual(children.map(c=>[c.listStyle.renderOrder,c.listStyle.scrollItemToViewOnClick,c.listStyle.foldInvisibleItems]),[[2,false,true],[1,true,false],[0,true,false]]);
  const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../standalone'),script='import json,sys\nfrom published import inspect\np=inspect(open(sys.argv[1],"rb").read())\nc=next(i for i in p["items"] if i["id"]=="main")\nprint(json.dumps([len(x["list"]["items"]) for x in c["component"]["children"]]))';
  const read=spawnSync(process.env.PYTHON||'python',['-c',script,result.file],{cwd,encoding:'utf8'});assert.equal(read.status,0,read.stderr);assert.deepEqual(JSON.parse(read.stdout),[0,1,2]);
  assert.equal((await validatePublished({project:root,file:result.file,compare_components:true})).valid,true);
  fs.writeFileSync(source,fs.readFileSync(source,'utf8').replace('title="clear"','title="ignored"'));
  assert.equal((await validatePublished({project:root,file:result.file,compare_components:true})).valid,true);
  fs.writeFileSync(source,fs.readFileSync(source,'utf8').replace('title="child" level="1"','title="child" level="0"'));
  assert.ok((await validatePublished({project:root,file:result.file,compare_components:true})).issues.some(i=>i.error.includes('tree settings')));
  fs.writeFileSync(source,fs.readFileSync(source,'utf8').replace('title="keep"','title="changed"'));
  assert.ok((await validatePublished({project:root,file:result.file,compare_components:true})).issues.some(i=>i.error.includes('list items')));
  fs.writeFileSync(source,fs.readFileSync(source,'utf8').replace('renderOrder="arch"','renderOrder="descent"'));
  assert.ok((await validatePublished({project:root,file:result.file,compare_components:true})).issues.some(i=>i.error.includes('list layout')));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('publication maps editor list item counts and ignores unrelated count attributes', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-list-count-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription type="CocosCreator"/>');
  fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/" exported="true"/></resources><publish name="Demo"/></packageDescription>');
  const layouts=['column','row','flow_hz','flow_vt','pagination'];
  fs.writeFileSync(path.join(folder,'Main.xml'),`<component size="20,20"><displayList>${layouts.map((layout,i)=>`<list id="n${i}" xy="0,0" layout="${layout}" lineItemCount="3" lineItemCount2="7" lineCount="9" colCount="8"/>`).join('')}</displayList></component>`);
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out')},{allowSounds:true,allowComponents:true});
  assert.ok(result.warnings.some(w=>w.setting==='list counts'));
  const data=await inspectPublished({file:result.file}),component=data.items.find(i=>i.id==='main');
  assert.deepEqual(component.component.children.map(child=>[child.listStyle.lineCount,child.listStyle.columnCount]),[[0,0],[0,0],[0,3],[3,0],[7,3]]);
  assert.equal((await validatePublished({project:root,file:result.file,compare_components:true})).valid,true);
  const source=path.join(folder,'Main.xml');fs.writeFileSync(source,fs.readFileSync(source,'utf8').replace('layout="pagination" lineItemCount="3"','layout="pagination" lineItemCount="4"'));
  const report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(issue=>issue.error.includes('item counts')));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('XML WAV publication detects missing and modified sound output', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-xml-wav-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.mkdirSync(path.join(root,'settings'));fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription type="CocosCreator"/>');fs.writeFileSync(path.join(root,'settings','Publish.json'),'{"binaryFormat":false}');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><sound id="snd" name="beep.wav" path="/" exported="true"/></resources><publish name="Demo"/></packageDescription>');
  const wav=Buffer.alloc(48);wav.write('RIFF',0);wav.writeUInt32LE(40,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(4,40);fs.writeFileSync(path.join(folder,'beep.wav'),wav);
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out')},{allowSounds:true});const output=path.join(result.output,'Demo@snd.wav');assert.deepEqual(fs.readFileSync(output),wav);let report=await validatePublished({project:root,file:result.file,compare_source:true});assert.equal(report.valid,true,JSON.stringify(report));const changed=Buffer.from(wav);changed[44]=1;fs.writeFileSync(output,changed);report=await validatePublished({project:root,file:result.file,compare_source:true});assert.ok(report.issues.some(i=>i.error==='published sound bytes differ from source'));fs.unlinkSync(output);report=await validatePublished({project:root,file:result.file});assert.ok(report.issues.some(i=>i.error.includes('sound cannot be validated')));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('XML publication validates image and simple component output and refuses unsupported features', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-xml-publish-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.mkdirSync(path.join(root,'settings'));fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription type="CocosCreator"/>');fs.writeFileSync(path.join(root,'settings','Publish.json'),'{"binaryFormat":false}');
  const packageFile=path.join(folder,'package.xml');fs.writeFileSync(packageFile,'<packageDescription id="abcdefgh"><resources><image id="img" name="image.png" path="/" exported="true" scale="tile"/></resources><publish name="Demo"/></packageDescription>');fs.writeFileSync(path.join(folder,'image.png'),await encodePng({width:4,height:4,pixels:Buffer.alloc(64,255)}));
  const output=path.join(root,'out'),result=await publishImages({project:root,pkg:'Demo',output});const report=await validatePublished({project:root,file:result.file,compare_source:true,check_overlaps:true});assert.equal(report.valid,true,JSON.stringify(report));assert.ok(result.warnings.some(w=>w.setting==='binaryFormat'&&w.message.includes('rejects legacy XML')));assert.ok(fs.existsSync(path.join(output,'Demo@sprites.bytes')));assert.ok(fs.existsSync(path.join(output,'Demo@atlas0.png')));
  if(process.env.FGUI_SAMPLE_PROJECT){const build=process.env.FGUI_COCOS_BUILD||path.resolve(process.env.FGUI_SAMPLE_PROJECT,'../../source/build'),cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../standalone'),runtime=spawnSync(process.execPath,[path.join(cwd,'check_cocos_reader.cjs'),build,result.file],{encoding:'utf8',timeout:60000});assert.notEqual(runtime.status,0);assert.match(runtime.stderr,/old package format/);}
  fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription type="Unity"/>');const otherTarget=await publishImages({project:root,pkg:'Demo',output:path.join(root,'unity')});assert.ok(!otherTarget.warnings.some(w=>w.setting==='binaryFormat'));fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription type="CocosCreator"/>');
  fs.writeFileSync(packageFile,fs.readFileSync(packageFile,'utf8').replace('</resources>','<component id="comp" name="Main.xml" path="/" exported="true"/></resources>'));const componentFile=path.join(folder,'Main.xml');fs.writeFileSync(componentFile,'<component size="40,30"><displayList><image id="n0" name="icon" src="img" xy="0,0"/><text id="n1" name="label" xy="2,3" size="20,10" text="Hello" fontSize="14" color="#112233"/><graph id="n2" name="box" xy="5,6" size="20,10" type="rect" lineSize="1" lineColor="#ff000000" fillColor="#ffffffff"/></displayList></component>');const componentResult=await publishImages({project:root,pkg:'Demo',output:path.join(root,'component')},{allowSounds:true,allowComponents:true});const {inspectPublished}=await import('./published.mjs');const componentReport=await inspectPublished({file:componentResult.file});assert.ok(componentReport.archive_entries.includes('comp.xml'));assert.ok(componentReport.items.some(i=>i.type===3&&i.id==='comp'));
  fs.writeFileSync(componentFile,'<component size="40,30"><displayList><richtext id="n0" xy="0,0" text="unsupported"/></displayList></component>');await assert.rejects(publishImages({project:root,pkg:'Demo',output:path.join(root,'unsupported')},{allowSounds:true,allowComponents:true}),/unsupported XML component features/);assert.equal(fs.existsSync(path.join(root,'unsupported')),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

for(const sample of ['Joystick','MainMenu','Guide','Cooldown','Bag','ListEffect','LoopList','ModalWaiting','TreeView','VirtualList','ScrollPane','Chat','PullToRefresh','Transition']) test(`${sample} sample publishes and loads through the Cocos component reader`, {skip:process.platform!=='win32'||!process.env.FGUI_SAMPLE_PROJECT,timeout:180000}, async () => {
  const project=process.env.FGUI_SAMPLE_PROJECT,build=process.env.FGUI_COCOS_BUILD||path.resolve(project,'../../source/build');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-joystick-node-'));
  try {
    const result=await publishImages({project,pkg:sample,output:path.join(root,'out')},{allowSounds:true,allowComponents:true});
    const reportNode=await validatePublished({project,file:result.file,compare_source:true,compare_components:true,check_overlaps:true});assert.equal(reportNode.valid,true,JSON.stringify(reportNode.issues));
    const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../standalone');
    const script='import json,sys\nfrom fgui import execute\nfrom published import inspect\nfrom pathlib import Path\na=json.load(sys.stdin)\nr=execute("validate_published",{"project":a["project"],"file":a["file"],"compare_source":True,"compare_components":True,"check_overlaps":True})\nprint(json.dumps({"validation":r,"package":inspect(Path(a["file"]).read_bytes())}))\nsys.exit(0 if r["valid"] else 1)';
    const check=spawnSync(process.env.PYTHON||'python',['-c',script],{cwd,input:JSON.stringify({project,file:result.file}),encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024});
    assert.equal(check.status,0,check.stderr+'\n'+check.stdout);
    const runtime=spawnSync(process.execPath,[path.join(cwd,'check_cocos_reader.cjs'),build,result.file],{encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});
    assert.equal(runtime.status,0,runtime.stderr);const report=JSON.parse(runtime.stdout),expected=JSON.parse(check.stdout).package;
    assert.equal(report.id,expected.id);assert.equal(report.name,expected.name);
    const components=expected.items.filter(item=>item.type===3);
    assert.equal(report.constructed.length,components.length);assert.equal(components.length,result.components);
    for(const item of components) {const actual=report.constructed.find(c=>c.id===item.id);assert.ok(actual,`component ${item.id} missing`);assert.equal(actual.width,item.component.width);assert.equal(actual.height,item.component.height);assert.deepEqual(actual.children.map(c=>c.id),item.component.children.map(c=>c.id));assert.deepEqual(actual.controllers.map(c=>({name:c.name,ids:c.ids,names:c.names})),item.component.controllers.map(c=>({name:c.name,ids:c.pages.map(p=>p.id),names:c.pages.map(p=>p.name)})));}
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('basic component publication validates against the Python source reader', {skip:process.platform!=='win32'}, async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-component-publish-'));
  try {
    const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(root,'demo.fairy'),'<projectDescription type="CocosCreator"/>');
    fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><image id="img" name="a.png" path="/"/><component id="comp" name="Main.xml" path="/" exported="true"/><component id="sub" name="Sub.xml" path="/"/></resources><publish name="Demo"/></packageDescription>');
    fs.writeFileSync(path.join(folder,'a.png'),await encodePng({width:4,height:4,pixels:Buffer.alloc(64,255)}));
    fs.writeFileSync(path.join(folder,'Sub.xml'),'<component size="20,20" extention="Button"><displayList/><Button mode="Check" downEffect="scale" downEffectValue="0.75"/></component>');
    fs.writeFileSync(path.join(folder,'Main.xml'),'<component size="100,80" pivot="0.5,0.5" margin="1,2,3,4" overflow="hidden" opaque="false" mask="n1" reversedMask="true" hitTest="n2" idnum="12"><controller name="state" pages="p0,normal,p1,active" selected="1"/><relation target="n1" sidePair="width,height"/><displayList><image id="n1" name="picture" src="img" group="grp" fileName="a.png" locked="true" aspect="false" color="#112233" flip="vt" fillMethod="radial360" fillClockwise="false" fillAmount="25" xy="4,5" size="8,9" scale="1.5,0.5" pivot="0.5,0.3" anchor="true" alpha="0.7" rotation="45" visible="false" grayed="true"><relation target="" sidePair="left-left,top-top"/><gearDisplay controller="state" pages="p1"/><gearDisplay2 controller="state" pages="p0" condition="1"/><gearXY controller="state" pages="p0,p1" values="1,2|-" default="5,6" tween="true" ease="Quad.Out" duration="0.3" delay="0.1"/><gearSize controller="state" pages="p0" values="20,30" default="10,10,2,2"/><gearLook controller="state" pages="p1" values="0.5,45,1,0"/><gearColor controller="state" pages="p0,p1" values="#ff0000|-" default="#010203,#040506"/></image><text id="n2" name="title" xy="5,6" text="Hello" fontSize="22" color="#ff00aa" bold="true"><gearText controller="state" pages="p0,p1" values="Hello|World" default="Hello"/><gearFontSize controller="state" pages="p0,p1" values="12|-" default="22"/></text><richtext id="n3" name="rich" text="[b]Hi[/b]" ubb="true"/><text id="n4" name="input" input="true" prompt="enter" maxLength="10" password="true"/><component id="n5" name="nested" src="sub" xy="5,9"><Button title="OK" icon="ui://Demo/a" controller="state" page="p0" checked="true" titleColor="#112233" titleFontSize="13"/></component><loader id="load" name="loader" xy="1,2" url="ui://abcdefghimg" align="center" vAlign="bottom" fill="scaleFree" color="#010203" fillMethod="radial90" fillClockwise="false" fillAmount="50"><gearIcon controller="state" pages="p0,p1" values="ui://Demo/a|ui://abcdefghimg" default="ui://Demo/a"/><gearAni controller="state" pages="p0,p1" values="0,p|2,s" default="1,p"/></loader><list id="l1" name="list" size="80,60" layout="flow_hz" lineGap="3" colGap="4" overflow="scroll" scroll="vertical" selectionController="state" defaultItem="ui://Demo/Sub"><item title="Hello" icon="ui://Demo/a"/><item url="ui://Demo/Sub" title="World"/></list><list id="l2" name="tree" treeView="true" indent="20" clickToExpand="1" defaultItem="ui://Demo/Sub"><item title="Parent" level="0"/><item title="Child" level="1"/></list><group id="grp" name="group" advanced="true"/><group id="editor" name="editor"/><graph id="g1" name="rect" type="rect" size="10,20" corner="2" lineColor="#ff112233" fillColor="#80445566"/><graph id="g2" name="polygon" type="polygon" points="0,0,10,0,5,6"/></displayList><transition name="intro" autoPlay="true"><item type="XY" target="n1" tween="true" startValue="-,0" endValue="20,30" duration="24" ease="Sine.Out" path="2,0,0,5,5,10,10,0"/><item type="Alpha" target="n1" time="12" value="0.5"/><item type="Visible" target="n2" value="false"/><item type="Text" target="n2" value="Hello"/></transition></component>');
    const args={project:root,pkg:'Demo',output:path.join(root,'out'),width:32,height:32};
    const response=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'publish_basic_experimental',arguments:args}});
    assert.equal(response.result.isError,false,response.result.content[0].text);const result=JSON.parse(response.result.content[0].text).data;
    assert.equal(result.components,2);
    const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../standalone');
    const script='import sys,json\nfrom fgui import execute\na=json.load(sys.stdin)\nr=execute("validate_published",{"project":a["project"],"file":a["file"],"compare_source":True,"compare_components":True,"check_overlaps":True})\nprint(json.dumps(r))\nsys.exit(0 if r["valid"] else 1)';
    const check=spawnSync(process.env.PYTHON||'python',['-c',script],{cwd,input:JSON.stringify({project:root,file:result.file}),encoding:'utf8'});
    assert.equal(check.status,0,check.stderr+'\n'+check.stdout);
    fs.writeFileSync(path.join(folder,'Sub.xml'),'<component size="20,20" extention="Button"><displayList><component id="n1" src="comp"/></displayList><Button/></component>');
    await assert.rejects(publishImages({...args,output:path.join(root,'cycle')},{allowSounds:true,allowComponents:true}),/cyclic component/);
    assert.equal(fs.existsSync(path.join(root,'cycle')),false);
    fs.writeFileSync(path.join(folder,'Sub.xml'),'<component size="20,20"><displayList/></component>');
    fs.writeFileSync(path.join(folder,'Main.xml'),'<component size="100,80"><displayList><list id="n1" treeView="true"><item level="2"/></list></displayList></component>');
    await assert.rejects(publishImages({...args,output:path.join(root,'bad')},{allowSounds:true,allowComponents:true}),/invalid tree level/);
    assert.equal(fs.existsSync(path.join(root,'bad')),false);
    fs.writeFileSync(path.join(folder,'Main.xml'),'<component size="100,80"><displayList/><transition name="bad"><item type="XY" target="missing" value="1,2"/></transition></component>');
    const missingTransition=await publishImages({...args,output:path.join(root,'invalid-transition')},{allowSounds:true,allowComponents:true});assert.match(missingTransition.warnings[0].message,/omitted/);
    fs.writeFileSync(path.join(folder,'Main.xml'),'<component size="100,80"><displayList><graph id="g" type="polygon" points="0,0,1,1"/></displayList></component>');
    await assert.rejects(publishImages({...args,output:path.join(root,'invalid-graph')},{allowSounds:true,allowComponents:true}),/invalid polygon points/);
    assert.equal(fs.existsSync(path.join(root,'invalid-graph')),false);
    fs.writeFileSync(path.join(folder,'Main.xml'),'<component size="100,80"><controller name="state" pages="p0,normal"/><displayList><text id="n1"><gearDisplay controller="state" pages="missing"/></text></displayList></component>');
    const missingPage=await publishImages({...args,output:path.join(root,'invalid-page')},{allowSounds:true,allowComponents:true});assert.deepEqual(missingPage.warnings[0].pages,['missing']);
    fs.writeFileSync(path.join(folder,'Main.xml'),'<component size="100,80"><displayList><text id="n1"><relation target="n1" sidePair="width"/></text></displayList></component>');
    await assert.rejects(publishImages({...args,output:path.join(root,'invalid-relation')},{allowSounds:true,allowComponents:true}),/invalid relation target/);
    assert.equal(fs.existsSync(path.join(root,'invalid-relation')),false);
    fs.writeFileSync(path.join(folder,'Main.xml'),'<component size="100,80"><displayList><image id="n1" src="img" fileName="wrong.png"/></displayList></component>');
    await assert.rejects(publishImages({...args,output:path.join(root,'invalid-filename')},{allowSounds:true,allowComponents:true}),/fileName does not match/);
    fs.writeFileSync(path.join(folder,'Main.xml'),'<component size="100,80" mask="missing"><displayList/></component>');
    await assert.rejects(publishImages({...args,output:path.join(root,'invalid-mask')},{allowSounds:true,allowComponents:true}),/invalid component mask/);
    assert.equal(fs.existsSync(path.join(root,'invalid-mask')),false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('published image package passes Python binary and source validator', {skip:process.platform!=='win32'}, async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-publish-node-'));
  try {
    const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(root,'demo.fairy'),'<projectDescription type="CocosCreator"/>');
    fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><image id="img01" name="a.png" path="/" exported="true" duplicatePadding="true"/><image id="img02" name="b.png" path="/" scale="9grid" scale9grid="1,1,2,2"/></resources><publish name="Demo"/></packageDescription>');
    for(const [name,w,h] of [['a',7,5],['b',4,4]]) {
      const pixels=Buffer.from(Array.from({length:w*h*4},(_,i)=>i*13%256));
      if(name==='a') for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(x===0 || y===0 || x===w-1 || y===h-1) pixels[(y*w+x)*4+3]=0;
      fs.writeFileSync(path.join(folder,name+'.png'),await encodePng({width:w,height:h,pixels}));
    }
    const args={project:root,pkg:'Demo',output:path.join(root,'output'),width:32,height:32,padding:1,rotate_images:true,trim_images:true};
    const result=await publishImages(args);
    assert.equal(result.trimmed_images,1);
    const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../standalone');
    const script='import sys,json\nfrom fgui import execute\na=json.load(sys.stdin)\nr=execute("validate_published",{"project":a["project"],"file":a["file"],"compare_source":True,"check_overlaps":True})\nprint(json.dumps(r))\nsys.exit(0 if r["valid"] else 1)';
    const check=spawnSync(process.env.PYTHON||'python',['-c',script],{cwd,input:JSON.stringify({project:root,file:result.file}),encoding:'utf8',maxBuffer:1024*1024});
    assert.equal(check.status,0,check.stderr+'\n'+check.stdout);
    const pythonArgs={...args,output:path.join(root,'python-output')};
    const python=spawnSync(process.env.PYTHON||'python',['-c','import sys,json\nfrom fgui import execute\nprint(json.dumps(execute("publish_images_experimental",json.load(sys.stdin))))'],{cwd,input:JSON.stringify(pythonArgs),encoding:'utf8'});
    assert.equal(python.status,0,python.stderr);
    assert.deepEqual(fs.readFileSync(result.file),fs.readFileSync(JSON.parse(python.stdout).file));
    await assert.rejects(publishImages(args),/already exist/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('published WAV media record and copied data pass Python validation', {skip:process.platform!=='win32'}, async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-media-node-'));
  try {
    const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(root,'demo.fairy'),'<projectDescription type="CocosCreator"/>');
    fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><sound id="snd01" name="beep.wav" path="/" exported="true"/><component id="btn" name="Button.xml" path="/"/><component id="combo" name="Combo.xml" path="/"/></resources><publish name="Demo"/></packageDescription>');
    const wav=Buffer.alloc(48);wav.write('RIFF',0);wav.writeUInt32LE(40,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(4,40);fs.writeFileSync(path.join(folder,'beep.wav'),wav);
    fs.writeFileSync(path.join(folder,'Button.xml'),'<component size="20,20" extention="Button"><displayList/><Button sound="ui://abcdefghsnd01"/></component>');
    fs.writeFileSync(path.join(folder,'Combo.xml'),'<component size="20,20" extention="ComboBox"><displayList/><ComboBox dropdown="ui://Demo/Button"/></component>');
    const args={project:root,pkg:'Demo',output:path.join(root,'output')},result=await publishImages(args,{allowSounds:true,allowComponents:true});
    assert.equal(result.sounds,1);assert.deepEqual(fs.readFileSync(path.join(result.output,'Demo_snd01.wav')),wav);
    let nodeReport=await validatePublished({project:root,file:result.file});assert.equal(nodeReport.valid,true,JSON.stringify(nodeReport.issues));fs.unlinkSync(path.join(result.output,'Demo_snd01.wav'));nodeReport=await validatePublished({project:root,file:result.file});assert.equal(nodeReport.valid,false);assert.match(nodeReport.issues[0].error,/sound cannot be validated/);fs.writeFileSync(path.join(result.output,'Demo_snd01.wav'),wav);
    const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../standalone');
    const script='import sys,json\nfrom fgui import execute\na=json.load(sys.stdin)\nr=execute("validate_published",{"project":a["project"],"file":a["file"],"compare_source":True})\nprint(json.dumps(r))\nsys.exit(0 if r["valid"] else 1)';
    const check=spawnSync(process.env.PYTHON||'python',['-c',script],{cwd,input:JSON.stringify({project:root,file:result.file}),encoding:'utf8'});
    assert.equal(check.status,0,check.stderr+'\n'+check.stdout);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('published sample JTA passes Python source and frame validation', {skip:process.platform!=='win32' || !process.env.FGUI_SAMPLE_PROJECT}, async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-jta-publish-'));
  try {
    const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(root,'demo.fairy'),'<projectDescription type="CocosCreator"/>');
    fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><movieclip id="clip" name="quan.jta" path="/" exported="true"/><component id="comp" name="Main.xml" path="/"/></resources><publish name="Demo"/></packageDescription>');
    fs.copyFileSync(path.join(process.env.FGUI_SAMPLE_PROJECT,'assets','Bag','images','quan.jta'),path.join(folder,'quan.jta'));
    fs.writeFileSync(path.join(folder,'Main.xml'),'<component size="100,80"><controller name="state" pages="p0,normal,p1,active"/><displayList><jta id="n1" src="clip" color="#030405"><gearAni controller="state" pages="p0,p1" values="3,p|-" default="2,s"/></jta></displayList></component>');
    const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out'),width:1024,height:1024},{allowSounds:true,allowComponents:true});
    assert.equal(result.movieclips,1);
    const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../standalone');
    const script='import sys,json\nfrom fgui import execute\na=json.load(sys.stdin)\nr=execute("validate_published",{"project":a["project"],"file":a["file"],"compare_source":True,"check_overlaps":True})\nprint(json.dumps(r))\nsys.exit(0 if r["valid"] else 1)';
    const check=spawnSync(process.env.PYTHON||'python',['-c',script],{cwd,input:JSON.stringify({project:root,file:result.file}),encoding:'utf8',maxBuffer:1024*1024});
    assert.equal(check.status,0,check.stderr+'\n'+check.stdout);
    const componentFile=path.join(folder,'Main.xml'),original=fs.readFileSync(componentFile,'utf8');let report=await validatePublished({project:root,file:result.file,compare_components:true});assert.equal(report.valid,true,JSON.stringify(report.issues));for(const mutation of ['frame="2"','playing="false"','color="#030406"']){const changed=mutation.startsWith('color')?original.replace('color="#030405"',mutation):original.replace('src="clip"',`src="clip" ${mutation}`);fs.writeFileSync(componentFile,changed);report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(issue=>issue.child==='n1'&&issue.error.includes('movieclip color or playback')),mutation);}
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('published sample bitmap font passes Python source validation', {skip:process.platform!=='win32' || !process.env.FGUI_SAMPLE_PROJECT}, async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-font-publish-'));
  try {
    const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(root,'demo.fairy'),'<projectDescription type="CocosCreator"/>');
    fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><font id="font01" name="BMFontTest.fnt" path="/" exported="true" texture="texture"/><image id="texture" name="BMFontTest_atlas.png" path="/"/></resources><publish name="Demo"/></packageDescription>');
    for(const name of ['BMFontTest.fnt','BMFontTest_atlas.png']) fs.copyFileSync(path.join(process.env.FGUI_SAMPLE_PROJECT,'assets','Basics','font',name),path.join(folder,name));
    const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out'),width:1024,height:1024,rotate_images:true,trim_images:true},{allowSounds:true});
    assert.equal(result.fonts,1);
    const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../standalone');
    const script='import sys,json\nfrom fgui import execute\na=json.load(sys.stdin)\nr=execute("validate_published",{"project":a["project"],"file":a["file"],"compare_source":True,"check_overlaps":True})\nprint(json.dumps(r))\nsys.exit(0 if r["valid"] else 1)';
    const check=spawnSync(process.env.PYTHON||'python',['-c',script],{cwd,input:JSON.stringify({project:root,file:result.file}),encoding:'utf8',maxBuffer:1024*1024});
    assert.equal(check.status,0,check.stderr+'\n'+check.stdout);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('image-glyph bitmap font can be published and validated', {skip:process.platform!=='win32'}, async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-glyph-publish-'));
  try {
    const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(root,'demo.fairy'),'<projectDescription type="CocosCreator"/>');
    fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><font id="font01" name="glyph.fnt" path="/"/><image id="glyph" name="glyph.png" path="/"/><component id="main" name="Main.xml" path="/"/></resources><publish name="Demo"/></packageDescription>');
    fs.writeFileSync(path.join(folder,'glyph.fnt'),'info size=12 colored=true\nchar id=65 img=glyph xoffset=0 yoffset=0 xadvance=8\n');
    fs.writeFileSync(path.join(folder,'glyph.png'),await encodePng({width:3,height:3,pixels:Buffer.alloc(36,255)}));
    const component=path.join(folder,'Main.xml');fs.writeFileSync(component,'<component size="50,40"><displayList><text id="n1" font="ui://abcdefghfont01" text="A"/><text id="n2" font="ui://Demo/glyph" text="A"/></displayList></component>');
    const options={project:root,pkg:'Demo',output:path.join(root,'out'),width:32,height:32};
    const result=await publishImages(options,{allowSounds:true,allowComponents:true});
    const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../standalone');
    const script='import json,sys\nfrom fgui import execute\na=json.load(sys.stdin);r=execute("validate_published",{"project":a["project"],"file":a["file"],"compare_source":True});print(json.dumps(r));sys.exit(0 if r["valid"] else 1)';
    const check=spawnSync(process.env.PYTHON||'python',['-c',script],{cwd,input:JSON.stringify({project:root,file:result.file}),encoding:'utf8'});
    assert.equal(check.status,0,check.stderr+'\n'+check.stdout);
    fs.writeFileSync(component,'<component size="50,40"><displayList><text id="n1" font="ui://abcdefghmissing"/></displayList></component>');
    await assert.rejects(publishImages({...options,output:path.join(root,'invalid')},{allowSounds:true,allowComponents:true}),/UI resource URL is missing/);
    assert.equal(fs.existsSync(path.join(root,'invalid')),false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('cross-package children and URLs publish dependency records', {skip:process.platform!=='win32'}, async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-dependency-'));
  try {
    const a=path.join(root,'assets','Main'),b=path.join(root,'assets','Shared');fs.mkdirSync(a,{recursive:true});fs.mkdirSync(b,{recursive:true});
    fs.writeFileSync(path.join(root,'Test.fairy'),'<projectDescription/>');
    fs.writeFileSync(path.join(a,'package.xml'),'<packageDescription id="aaaaaaaa"><resources><component id="main" name="Main.xml" path="/" exported="true"/></resources><publish name="Main"/></packageDescription>');
    fs.writeFileSync(path.join(b,'package.xml'),'<packageDescription id="bbbbbbbb"><resources><image id="pic" name="pic.png" path="/" exported="true"/><component id="button" name="Button.xml" path="/" exported="true"/></resources><publish name="Shared"/></packageDescription>');
    fs.writeFileSync(path.join(b,'pic.png'),await encodePng({width:4,height:4,pixels:Buffer.alloc(64,255)}));
    fs.writeFileSync(path.join(b,'Button.xml'),'<component size="10,10" extention="Button"><displayList/><Button/></component>');
    fs.writeFileSync(path.join(a,'Main.xml'),'<component size="100,100"><displayList><image id="i" src="pic" pkg="Shared" fileName="pic.png"/><component id="b" src="button" pkg="bbbbbbbb"><Button title="OK"/></component><loader id="l" url="ui://Shared/pic"/></displayList></component>');
    const result=await publishImages({project:root,pkg:'Main',output:path.join(root,'out')},{allowSounds:true,allowComponents:true});
    assert.deepEqual(result.dependencies,[{id:'bbbbbbbb',name:'Shared'}]);
    const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../standalone');
    const script='import json,sys\nfrom pathlib import Path\nfrom published import inspect\np=inspect(Path(sys.argv[1]).read_bytes());print(json.dumps(p))';
    const run=spawnSync(process.env.PYTHON||'python',['-c',script,result.file],{cwd,encoding:'utf8'});assert.equal(run.status,0,run.stderr);const data=JSON.parse(run.stdout);assert.deepEqual(data.dependencies,[{id:'bbbbbbbb',name:'Shared'}]);
    const main=data.items.find(i=>i.id==='main');assert.equal(main.component.children[0].pkg,'bbbbbbbb');assert.equal(main.component.children[1].pkg,'bbbbbbbb');
    let comparison=await validatePublished({project:root,file:result.file,compare_components:true});assert.equal(comparison.valid,true,JSON.stringify(comparison.issues));
    const other=path.join(root,'assets','Other');fs.mkdirSync(other);fs.writeFileSync(path.join(other,'package.xml'),'<packageDescription id="cccccccc"><resources><image id="pic" name="pic.png" path="/" exported="true"/></resources></packageDescription>');fs.writeFileSync(path.join(other,'pic.png'),fs.readFileSync(path.join(b,'pic.png')));const mainFile=path.join(a,'Main.xml');fs.writeFileSync(mainFile,fs.readFileSync(mainFile,'utf8').replace('pkg="Shared"','pkg="Other"'));comparison=await validatePublished({project:root,file:result.file,compare_components:true});assert.equal(comparison.valid,false);assert.ok(comparison.issues.some(issue=>issue.child==='i'&&issue.error.includes('source package')));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});


test('pixel hit test publishes original-image mask before atlas trimming', {skip:process.platform!=='win32'}, async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-hit-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'Test.fairy'),'<projectDescription/>');
  fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><image id="img" name="hit.png" path="/"/><component id="comp" name="Main.xml" path="/" exported="true"/></resources><publish name="Demo"/></packageDescription>');
  const pixels=Buffer.alloc(16*16*4);for(let y=4;y<12;y++)for(let x=4;x<12;x++)pixels[(y*16+x)*4+3]=255;
  fs.writeFileSync(path.join(folder,'hit.png'),await encodePng({width:16,height:16,pixels}));fs.writeFileSync(path.join(folder,'Main.xml'),'<component size="16,16"><displayList><image id="n1" src="img" forHitTest="true"/></displayList></component>');
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out'),trim_images:true},{allowSounds:true,allowComponents:true});assert.equal(result.trimmed_images,1);
  const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../standalone'),script='import json,sys\nfrom fgui import execute\na=json.load(sys.stdin);r=execute("validate_published",{"project":a["project"],"file":a["file"],"compare_source":True,"compare_components":True});print(json.dumps(r));sys.exit(0 if r["valid"] else 1)';
  const check=spawnSync(process.env.PYTHON||'python',['-c',script],{cwd,input:JSON.stringify({project:root,file:result.file}),encoding:'utf8'});assert.equal(check.status,0,check.stderr+'\n'+check.stdout);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('exported-only publication requires external resources to be exported and excludes unused assets', {skip:process.platform!=='win32'}, async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-exported-'));try{
  const a=path.join(root,'assets','Main'),b=path.join(root,'assets','Shared');fs.mkdirSync(a,{recursive:true});fs.mkdirSync(b,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');
  fs.writeFileSync(path.join(a,'package.xml'),'<packageDescription id="aaaaaaaa"><resources><component id="main" name="Main.xml" path="/" exported="true"/><swf id="unused" name="old.swf" path="/"/></resources><publish name="Main"/></packageDescription>');
  fs.writeFileSync(path.join(b,'package.xml'),'<packageDescription id="bbbbbbbb"><resources><image id="icon" name="icon.png" path="/"/><image id="unused" name="unused.png" path="/"/></resources><publish name="Shared"/></packageDescription>');
  fs.writeFileSync(path.join(a,'Main.xml'),'<component size="30,30"><displayList><image id="i" src="icon" pkg="Shared"/></displayList></component>');const png=await encodePng({width:2,height:2,pixels:Buffer.alloc(16,255)});fs.writeFileSync(path.join(b,'icon.png'),png);fs.writeFileSync(path.join(b,'unused.png'),png);
  const args={project:root,pkg:'Main',output:path.join(root,'out'),exported_only:true};await assert.rejects(publishImages(args,{allowSounds:true,allowComponents:true}),/not included in exported package/);
  const bfile=path.join(b,'package.xml');fs.writeFileSync(bfile,fs.readFileSync(bfile,'utf8').replace('id="icon" name="icon.png" path="/"','id="icon" name="icon.png" path="/" exported="true"'));const main=await publishImages(args,{allowSounds:true,allowComponents:true});assert.deepEqual(main.dependencies,[{id:'bbbbbbbb',name:'Shared'}]);
  const shared=await publishImages({...args,pkg:'Shared',output:path.join(root,'other')},{allowSounds:true,allowComponents:true});assert.equal(shared.images,1);
  await assert.rejects(publishImages({...args,output:path.join(root,'all'),exported_only:false},{allowSounds:true,allowComponents:true}),/unsupported resource type swf/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

for(const sample of ['HitTest','Basics']) test(`${sample} exported closure publishes and matches source and Cocos reader`, {skip:process.platform!=='win32'||!process.env.FGUI_SAMPLE_PROJECT,timeout:180000},async()=>{
 const project=process.env.FGUI_SAMPLE_PROJECT,root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-hit-sample-'));try{
  const result=await publishImages({project,pkg:sample,output:path.join(root,'out'),exported_only:true},{allowSounds:true,allowComponents:true});const nodeReport=await validatePublished({project,file:result.file,compare_source:true,compare_components:true,exported_only:true,check_overlaps:true});assert.equal(nodeReport.valid,true,JSON.stringify(nodeReport.issues));const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../standalone');
  const script='import json,sys\nfrom fgui import execute\na=json.load(sys.stdin);r=execute("validate_published",{"project":a["project"],"file":a["file"],"compare_source":True,"compare_components":True,"check_overlaps":True,"exported_only":True});print(json.dumps(r));sys.exit(0 if r["valid"] else 1)';
  const check=spawnSync(process.env.PYTHON||'python',['-c',script],{cwd,input:JSON.stringify({project,file:result.file}),encoding:'utf8'});assert.equal(check.status,0,check.stderr+'\n'+check.stdout);
  const build=process.env.FGUI_COCOS_BUILD||path.resolve(project,'../../source/build'),runtime=spawnSync(process.execPath,[path.join(cwd,'check_cocos_reader.cjs'),build,result.file],{encoding:'utf8',timeout:60000});assert.equal(runtime.status,0,runtime.stderr);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('Cocos compression setting emits editor-compatible uncompressed output with warning', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-compression-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.mkdirSync(path.join(root,'settings'));const descriptor=path.join(root,'p.fairy');fs.writeFileSync(descriptor,'<projectDescription type="CocosCreator"/>');fs.writeFileSync(path.join(root,'settings','Publish.json'),'{"binaryFormat":true,"compressDesc":true}');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><image id="img" name="a.png" path="/" exported="true"/></resources><publish name="Demo"/></packageDescription>');fs.writeFileSync(path.join(folder,'a.png'),await encodePng({width:2,height:2,pixels:Buffer.alloc(16,255)}));
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out')});assert.equal(fs.readFileSync(result.file)[8],0);assert.equal(result.warnings[0].setting,'compressDesc');
  fs.writeFileSync(descriptor,'<projectDescription type="Unity"/>');await assert.rejects(publishImages({project:root,pkg:'Demo',output:path.join(root,'bad')}),/unsupported for this project target/);assert.equal(fs.existsSync(path.join(root,'bad')),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('advanced group layout matches editor serialization and source validation',{skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-group-layout-'));try{const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription type="CocosCreator"/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/" exported="true"/></resources><publish name="Demo"/></packageDescription>');
 const file=path.join(folder,'Main.xml');const groups=['none','hz','vt'].map((layout,i)=>`<group id="g${i}" xy="0,0" size="40,40" advanced="true" layout="${layout}" lineGap="7" colGap="5" excludeInvisibles="true" autoSizeDisabled="true" mainGridIndex="2"/>`).join('');const xml=`<component size="100,100"><displayList>${groups}</displayList></component>`;fs.writeFileSync(file,xml);
 const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out')},{allowSounds:true,allowComponents:true});const data=await inspectPublished({file:result.file});assert.deepEqual(data.items.find(item=>item.id==='main').component.children.map(child=>child.groupStyle),[0,1,2].map(layout=>({layout,lineGap:7,colGap:5,excludeInvisibles:true,autoSizeDisabled:true,mainGridIndex:2})));assert.equal((await validatePublished({project:root,file:result.file,compare_components:true})).valid,true);fs.writeFileSync(file,xml.replace('colGap="5"','colGap="8"'));assert.ok((await validatePublished({project:root,file:result.file,compare_components:true})).issues.some(issue=>issue.error.includes('group layout')));
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
