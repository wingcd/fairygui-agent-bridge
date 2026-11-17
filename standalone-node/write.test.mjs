import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execute} from './project.mjs';
import {writeComponent,setComponentProperties,setProperties,setPropertiesBatch,createPackage,createComponent,insertResource} from './write.mjs';
import {message} from './mcp.mjs';
import {validate} from './validate.mjs';

test('pixel hit test edits enforce image geometry and reject conflicting hit tests',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-pixel-edit-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/><image id="img" name="a.png" path="/"/></resources></packageDescription>');fs.writeFileSync(path.join(folder,'a.png'),'image');
  const file=path.join(folder,'Main.xml');fs.writeFileSync(file,'<component size="20,20"><displayList><image id="a" src="img" xy="0,0"/><image id="b" src="img" xy="0,0"/><text id="text" xy="0,0"/></displayList></component>');
  const base={project:root,pkg:'Demo',name:'Main'},call=async(name,extra)=>JSON.parse((await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{...base,...extra,expected_sha256:execute('read_component',base).sha256}}})).result.content[0].text);
  assert.equal((await call('set_properties',{target:'a',props:{forHitTest:true}})).ok,true);
  const before=fs.readFileSync(file);for(const [name,extra] of [['set_properties',{target:'a',props:{xy:'1,0'}}],['set_properties',{target:'a',props:{scale:'1,1'}}],['set_properties',{target:'b',props:{forHitTest:true}}],['set_properties',{target:'text',props:{forHitTest:true}}],['set_component_properties',{props:{hitTest:'text'}}]]){assert.equal((await call(name,extra)).ok,false);assert.deepEqual(fs.readFileSync(file),before);}
  assert.equal((await call('set_properties',{target:'a',props:{forHitTest:false}})).ok,true);
  assert.equal((await call('set_component_properties',{props:{hitTest:'text'}})).ok,true);
  assert.equal((await call('set_properties',{target:'b',props:{forHitTest:true}})).ok,false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('component mask and hit test edits preserve references and revision checks',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-component-mask-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources></packageDescription>');
  const file=path.join(folder,'Main.xml');fs.writeFileSync(file,'<component size="20,20"><displayList><graph id="mask" xy="0,0"/><graph id="hit" xy="0,0"/><group id="editor" xy="0,0"/></displayList></component>');
  const base={project:root,pkg:'Demo',name:'Main'},call=async(props,sha)=>JSON.parse((await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'set_component_properties',arguments:{...base,props,expected_sha256:sha??execute('read_component',base).sha256}}})).result.content[0].text);
  const changed=await call({mask:'mask',hitTest:'hit',reversedMask:true,opaque:false});assert.equal(changed.ok,true,changed.error);
  const before=fs.readFileSync(file);for(const props of [{mask:'missing'},{hitTest:'editor'},{mask:null},{reversedMask:'true'}]){assert.equal((await call(props)).ok,false);assert.deepEqual(fs.readFileSync(file),before);}
  const cleared=await call({mask:null,hitTest:null,reversedMask:null});assert.equal(cleared.ok,true,cleared.error);assert.doesNotMatch(fs.readFileSync(file,'utf8'),/\smask=|\shitTest=|\sreversedMask=/);
  assert.equal((await call({opaque:true},changed.data.sha256)).ok,false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('component scrolling settings can be set and cleared with revision checks',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-component-scroll-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');
  fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/><component id="bar" name="Bar.xml" path="/"/></resources></packageDescription>');fs.writeFileSync(path.join(folder,'Bar.xml'),'<component size="10,10"><displayList/></component>');
  const file=path.join(folder,'Main.xml');fs.writeFileSync(file,'<component size="100,100"><!--keep--><displayList/></component>');
  const base={project:root,pkg:'Demo',name:'Main'},call=async(props,sha)=>JSON.parse((await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'set_component_properties',arguments:{...base,props,expected_sha256:sha??execute('read_component',base).sha256}}})).result.content[0].text);
  assert.equal((await call({scroll:'horizontal'})).ok,false);
  let result=await call({overflow:'scroll',scroll:'horizontal',scrollBar:'auto',scrollBarFlags:4,scrollBarMargin:' 1, 2, 3, 4 ',scrollBarRes:'ui://abcdefghbar,',ptrRes:','});assert.equal(result.ok,true,result.error);
  const before=fs.readFileSync(file);assert.match(before.toString(),/scrollBarMargin="1,2,3,4"/);assert.match(before.toString(),/<!--keep-->/);
  for(const props of [{overflow:'hidden'},{scrollBarRes:'ui://abcdefghmissing,'},{scrollBarFlags:-1}]){assert.equal((await call(props)).ok,false);assert.deepEqual(fs.readFileSync(file),before);}
  result=await call({overflow:'hidden',scroll:null,scrollBar:null,scrollBarFlags:null,scrollBarMargin:null,scrollBarRes:null,ptrRes:null});assert.equal(result.ok,true,result.error);
  assert.doesNotMatch(fs.readFileSync(file,'utf8'),/scrollBarRes=|scrollBarFlags=|ptrRes=/);
  assert.equal((await call({size:'20,20'},'stale')).ok,false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('list and tree items are edited atomically with reference and level validation',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-list-items-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');
  fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/><component id="item" name="Item.xml" path="/"/><image id="icon" name="icon.png" path="/"/></resources></packageDescription>');
  fs.writeFileSync(path.join(folder,'Item.xml'),'<component size="10,10"><displayList/></component>');fs.writeFileSync(path.join(folder,'icon.png'),'image');
  const file=path.join(folder,'Main.xml');fs.writeFileSync(file,'<component size="100,100"><controller name="state" pages="0,One"/><displayList><list id="list" xy="0,0"><gearDisplay controller="state" pages="0"/><item title="old"/></list><list id="tree" treeView="true" xy="0,0"/><text id="text" xy="0,0"/></displayList></component>');
  const base={project:root,pkg:'Demo',name:'Main'},call=async(target,items,sha)=>JSON.parse((await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'set_list_items',arguments:{...base,target,items,expected_sha256:sha??execute('read_component',base).sha256}}})).result.content[0].text);
  let result=await call('list',[{title:'一 & 二',url:'ui://abcdefghitem',icon:'ui://abcdefghicon'},{name:'next',selectedTitle:'已选'}]);assert.equal(result.ok,true,result.error);
  let text=fs.readFileSync(file,'utf8');assert.match(text,/gearDisplay/);assert.match(text,/title="一 &amp; 二"/);assert.doesNotMatch(text,/title="old"/);
  result=await call('tree',[{level:0,title:'root'},{level:1,title:'child'},{level:0,title:'next'}]);assert.equal(result.ok,true,result.error);
  const before=fs.readFileSync(file);for(const [target,items] of [['text',[]],['list',[{level:1}]],['list',[{url:'ui://abcdefghmissing'}]],['tree',[{level:2}]],['tree',[{level:0},{level:2}]]]){result=await call(target,items);assert.equal(result.ok,false,JSON.stringify(items));assert.deepEqual(fs.readFileSync(file),before);}
  assert.equal((await call('list',[],'stale')).ok,false);assert.deepEqual(fs.readFileSync(file),before);
  assert.equal((await call('list',[])).ok,true);text=fs.readFileSync(file,'utf8');assert.match(text,/gearDisplay/);assert.doesNotMatch(text,/title="一/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('list layout and selection edits validate types, limits and references',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-list-edit-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');
  fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/><component id="item" name="Item.xml" path="/"/></resources></packageDescription>');
  fs.writeFileSync(path.join(folder,'Item.xml'),'<component size="10,10"><displayList/></component>');const file=path.join(folder,'Main.xml');fs.writeFileSync(file,'<component size="100,100"><controller name="state" pages="0,One"/><displayList><list id="list" xy="0,0" size="50,50"/><text id="text" xy="0,0"/></displayList></component>');
  const base={project:root,pkg:'Demo',name:'Main'},call=async(target,props)=>JSON.parse((await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'set_properties',arguments:{...base,target,props,expected_sha256:execute('read_component',base).sha256}}})).result.content[0].text);
  const result=await call('list',{layout:'flow_hz',selectionMode:'multiple',lineGap:6,colGap:-2,lineItemCount:3,lineItemCount2:7,autoItemSize:true,autoClearItems:true,renderOrder:'arch',scrollItemToViewOnClick:false,foldInvisibleItems:true,overflow:'hidden',defaultItem:'ui://abcdefghitem',selectionController:'state'});assert.equal(result.ok,true,result.error);
  assert.equal((await call('list',{scroll:'horizontal'})).ok,false);
  const scrolled=await call('list',{overflow:'scroll',scroll:'horizontal',scrollBar:'auto',scrollBarFlags:4,scrollBarMargin:' 1, 2, 3, 4 ',scrollBarRes:',',ptrRes:',',margin:'5,6,7,8',clipSoftness:'2,3',pageController:'state'});assert.equal(scrolled.ok,true,scrolled.error);
  assert.equal((await call('list',{ptrRes:'ui://abcdefghmissing,'})).ok,false);
  assert.equal((await call('list',{overflow:'hidden'})).ok,false);
  const clear=await call('list',{overflow:'hidden',scroll:null,scrollBar:null,scrollBarFlags:null,scrollBarMargin:null,scrollBarRes:null,ptrRes:null,pageController:null});assert.equal(clear.ok,true,clear.error);
  assert.equal((await call('list',{scrollBarFlags:0})).ok,false);
  assert.doesNotMatch(fs.readFileSync(file,'utf8'),/scrollBarFlags=|scrollBarRes=|ptrRes=|pageController=/);
  const before=fs.readFileSync(file);assert.match(before.toString(),/layout="flow_hz"/);assert.match(before.toString(),/selectionController="state"/);
  for(const [target,props] of [['text',{layout:'row'}],['list',{lineCount:-1}],['list',{defaultItem:'bad'}],['list',{defaultItem:'ui://abcdefghmissing'}],['list',{selectionController:'missing'}]]){const rejected=await call(target,props);assert.equal(rejected.ok,false,JSON.stringify(props));assert.deepEqual(fs.readFileSync(file),before);}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('component writes reject references to duplicate resource IDs',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-ambiguous-resource-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');
  fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/><image id="dup" name="one.png" path="/"/><image id="dup" name="two.png" path="/"/></resources></packageDescription>');
  for(const name of ['one.png','two.png'])fs.writeFileSync(path.join(folder,name),'data');
  const file=path.join(folder,'Main.xml'),original='<component size="10,10"><displayList/></component>';fs.writeFileSync(file,original);
  const base={project:root,pkg:'Demo',name:'Main'},expected_sha256=execute('read_component',base).sha256;
  assert.throws(()=>writeComponent({...base,expected_sha256,xml:'<component size="10,10"><displayList><image id="n1" xy="0,0" src="dup"/></displayList></component>'}),/unknown resource dup/);
  assert.equal(fs.readFileSync(file,'utf8'),original);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('malformed components can be read and repaired without bypassing write checks',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-repair-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources></packageDescription>');
  const file=path.join(folder,'Main.xml'),base={project:root,pkg:'Demo',name:'Main'};
  for(const broken of ['<component><displayList>', '<component><displayList><text id="a" xy="0,0"/><text id="a" xy="1,1"/></displayList></component>']){
   fs.writeFileSync(file,broken);assert.equal((await validate({project:root})).valid,false);
   const read=execute('read_component',base);assert.equal(read.xml,broken);
   assert.throws(()=>writeComponent({...base,expected_sha256:read.sha256,xml:'<component><displayList><text id="x" xy="0,0"/><text id="x" xy="0,0"/></displayList></component>'}),/unique/);
   assert.equal(fs.readFileSync(file,'utf8'),broken);
   assert.throws(()=>writeComponent({...base,expected_sha256:'stale',xml:'<component><displayList/></component>'}),/match current/);
   writeComponent({...base,expected_sha256:read.sha256,xml:'<component size="10,10"><displayList><text id="fixed" xy="0,0"/></displayList></component>'});
   assert.equal((await validate({project:root})).valid,true);
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('transition edits validate actions and retain referenced transitions',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-transition-edit-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources></packageDescription>');const file=path.join(folder,'Main.xml');fs.writeFileSync(file,'<component size="10,10"><!--keep--><controller name="state" pages="p0,One,p1,Two"/><displayList><graph id="g" xy="0,0"/></displayList></component>');const base={project:root,pkg:'Demo',name:'Main'},revision=()=>execute('read_component',base).sha256,call=async(name,args)=>JSON.parse((await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{...base,expected_sha256:revision(),...args}}})).result.content[0].text);
  let result=await call('upsert_transition',{transition_xml:'<transition name="show"><item type="Alpha" target="g" time="0" value="0.5"/></transition>'});assert.equal(result.ok,true,result.error);assert.match(fs.readFileSync(file,'utf8'),/<!--keep-->/);result=await call('upsert_transition',{transition_xml:'<transition name="show"><item type="Alpha" target="g" time="1" value="0.8"/></transition>'});assert.equal(result.ok,true,result.error);const before=fs.readFileSync(file);for(const transition_xml of ['<transition name="bad"><item type="Alpha" target="missing" value="1"/></transition>','<transition name="bad"><item type="Alpha" target="g" value="bad"/></transition>']){assert.equal((await call('upsert_transition',{transition_xml})).ok,false);assert.deepEqual(fs.readFileSync(file),before);}result=await call('set_controller_actions',{controller:'state',actions:[{transition:'show'}]});assert.equal(result.ok,true,result.error);assert.equal((await call('remove_transition',{transition:'show'})).ok,false);result=await call('set_controller_actions',{controller:'state',actions:[]});assert.equal(result.ok,true,result.error);result=await call('upsert_transition',{transition_xml:'<transition name="outer"><item type="Transition" value="show"/></transition>'});assert.equal(result.ok,true,result.error);assert.equal((await call('remove_transition',{transition:'show'})).ok,false);result=await call('remove_transition',{transition:'outer'});assert.equal(result.ok,true,result.error);result=await call('remove_transition',{transition:'show'});assert.equal(result.ok,true,result.error);assert.doesNotMatch(fs.readFileSync(file,'utf8'),/<transition/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('transition removal rejects nested references from another package',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-cross-transition-'));try{
  const a=path.join(root,'assets','A'),b=path.join(root,'assets','B');fs.mkdirSync(a,{recursive:true});fs.mkdirSync(b,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(a,'package.xml'),'<packageDescription id="aaaaaaaa"><resources><component id="parent" name="Parent.xml" path="/"/></resources></packageDescription>');fs.writeFileSync(path.join(b,'package.xml'),'<packageDescription id="bbbbbbbb"><resources><component id="child" name="Child.xml" path="/"/></resources></packageDescription>');const child=path.join(b,'Child.xml'),parent=path.join(a,'Parent.xml');fs.writeFileSync(child,'<component size="10,10"><displayList/><transition name="show"/></component>');fs.writeFileSync(parent,'<component size="10,10"><displayList><component id="nested" xy="0,0" src="child" pkg="bbbbbbbb"/></displayList><transition name="outer"><item type="Transition" target="nested" value="show"/></transition></component>');const base={project:root,pkg:'B',name:'Child'},sha=execute('read_component',base).sha256,call=async()=>JSON.parse((await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'remove_transition',arguments:{...base,transition:'show',expected_sha256:sha}}})).result.content[0].text);const blocked=await call();assert.equal(blocked.ok,false);assert.match(blocked.error,/referenced/);assert.match(fs.readFileSync(child,'utf8'),/transition name="show"/);fs.writeFileSync(parent,fs.readFileSync(parent,'utf8').replace('value="show"','value="other"'));assert.equal((await call()).ok,true);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('transition edits respect the shared project write lock',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-transition-lock-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources></packageDescription>');fs.writeFileSync(path.join(folder,'Main.xml'),'<component size="10,10"><displayList/><transition name="show"/></component>');const base={project:root,pkg:'Demo',name:'Main'},sha=execute('read_component',base).sha256,identity=process.platform==='win32'?fs.realpathSync(root).toLowerCase():fs.realpathSync(root),lock=path.join(os.tmpdir(),'fgui-node-'+crypto.createHash('sha256').update(Buffer.from(identity)).digest('hex')+'.lock'),call=async()=>JSON.parse((await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'remove_transition',arguments:{...base,transition:'show',expected_sha256:sha}}})).result.content[0].text);
  fs.mkdirSync(lock);try{const result=await call();assert.equal(result.ok,false);assert.match(result.error,/another Node operation/);}finally{fs.rmdirSync(lock);}assert.equal((await call()).ok,true);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('transition removal rechecks external references immediately before commit',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-transition-rescan-'));try{
  const a=path.join(root,'assets','A'),b=path.join(root,'assets','B');fs.mkdirSync(a,{recursive:true});fs.mkdirSync(b,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(a,'package.xml'),'<packageDescription id="aaaaaaaa"><resources><component id="parent" name="Parent.xml" path="/"/></resources></packageDescription>');fs.writeFileSync(path.join(b,'package.xml'),'<packageDescription id="bbbbbbbb"><resources><component id="child" name="Child.xml" path="/"/></resources></packageDescription>');const child=path.join(b,'Child.xml'),parent=path.join(a,'Parent.xml'),parentXml='<component size="10,10"><displayList><component id="nested" xy="0,0" src="child" pkg="bbbbbbbb"/></displayList></component>';fs.writeFileSync(child,'<component size="10,10"><displayList/><transition name="show"/></component>');fs.writeFileSync(parent,parentXml);const base={project:root,pkg:'B',name:'Child'},sha=execute('read_component',base).sha256,originalFsync=fs.fsyncSync;let injected=false;
  fs.fsyncSync=function(fd){originalFsync(fd);if(!injected){injected=true;fs.writeFileSync(parent,parentXml.replace('</component>','<transition name="outer"><item type="Transition" target="nested" value="show"/></transition></component>'));}};let response;try{response=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'remove_transition',arguments:{...base,transition:'show',expected_sha256:sha}}});}finally{fs.fsyncSync=originalFsync;}const result=JSON.parse(response.result.content[0].text);assert.equal(injected,true);assert.equal(result.ok,false);assert.match(result.error,/referenced/);assert.match(fs.readFileSync(child,'utf8'),/transition name="show"/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('controller transition actions validate pages, transitions and revision',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-controller-action-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources></packageDescription>');const file=path.join(folder,'Main.xml');fs.writeFileSync(file,'<component size="10,10"><!--keep--><controller name="state" pages="p0,One,p1,Two"/><displayList/><transition name="show"/></component>');const base={project:root,pkg:'Demo',name:'Main',controller:'state'},sha=execute('read_component',base).sha256,call=async(args)=>JSON.parse((await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'set_controller_actions',arguments:{...base,...args}}})).result.content[0].text);
  const changed=await call({actions:[{transition:'show',from_pages:['p0'],to_pages:['p1']}],expected_sha256:sha});assert.equal(changed.ok,true,changed.error);assert.match(fs.readFileSync(file,'utf8'),/<!--keep-->/);assert.match(fs.readFileSync(file,'utf8'),/fromPage="p0"/);const before=fs.readFileSync(file);for(const args of [{actions:[],expected_sha256:sha},{actions:[{transition:'missing'}],expected_sha256:changed.data.sha256},{actions:[{transition:'show',to_pages:['missing']}],expected_sha256:changed.data.sha256}]){assert.equal((await call(args)).ok,false);assert.deepEqual(fs.readFileSync(file),before);}assert.equal((await call({actions:[],expected_sha256:changed.data.sha256})).ok,true);assert.doesNotMatch(fs.readFileSync(file,'utf8'),/<action/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('component writes reject newly invalid dimensions without changing the file',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-component-size-write-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources></packageDescription>');const file=path.join(folder,'Main.xml'),original='<component size="20,30"><displayList/></component>';fs.writeFileSync(file,original);
  const args={project:root,pkg:'Demo',name:'Main',expected_sha256:execute('read_component',{project:root,pkg:'Demo',name:'Main'}).sha256};
  assert.throws(()=>writeComponent({...args,xml:'<component size="bad"><displayList/></component>'}),/component has invalid size/);assert.equal(fs.readFileSync(file,'utf8'),original);
  writeComponent({...args,xml:'<component size="40,50"><displayList/></component>'});assert.match(fs.readFileSync(file,'utf8'),/size="40,50"/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('progress and slider instance options validate the referenced type and preserve other values',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-progress-instances-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/><component id="bar" name="Bar.xml" path="/"/><component id="slider" name="Slider.xml" path="/"/></resources></packageDescription>');fs.writeFileSync(path.join(folder,'Bar.xml'),'<component size="20,20" extention="ProgressBar"><displayList/><ProgressBar/></component>');fs.writeFileSync(path.join(folder,'Slider.xml'),'<component size="20,20" extention="Slider"><displayList/><Slider/></component>');const file=path.join(folder,'Main.xml');fs.writeFileSync(file,'<component size="30,30"><displayList><component id="a" xy="0,0" src="bar"/><component id="b" xy="0,0" src="slider"/></displayList></component>');
  const base={project:root,pkg:'Demo',name:'Main'};const call=async(name,target,props)=>{const expected_sha256=execute('read_component',base).sha256;const response=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{...base,target,props,expected_sha256}}});return JSON.parse(response.result.content[0].text);};
  assert.equal((await call('set_progress_instance_options','a',{value:12,max:80})).ok,true);assert.equal((await call('set_progress_instance_options','a',{min:-5})).ok,true);assert.equal((await call('set_slider_instance_options','b',{value:25,min:5,max:50})).ok,true);const before=fs.readFileSync(file);assert.match(before.toString(),/<ProgressBar value="12" max="80" min="-5"\/>/);assert.match(before.toString(),/<Slider value="25" min="5" max="50"\/>/);
  for(const [name,target,props] of [['set_slider_instance_options','a',{value:1}],['set_progress_instance_options','a',{value:1.5}],['set_slider_instance_options','b',{max:2147483648}]]){assert.equal((await call(name,target,props)).ok,false);assert.deepEqual(fs.readFileSync(file),before);}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('progress and slider component options validate and preserve XML',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-progress-options-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="bar" name="Bar.xml" path="/"/><component id="slider" name="Slider.xml" path="/"/></resources></packageDescription>');
  for(const [name,extension] of [['Bar','ProgressBar'],['Slider','Slider']])fs.writeFileSync(path.join(folder,name+'.xml'),`\uFEFF<component size="20,20" extention="${extension}"><!--keep--><displayList/><${extension}/></component>`);
  const call=async(name,component,props)=>{const base={project:root,pkg:'Demo',name:component},expected_sha256=execute('read_component',base).sha256;const response=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{...base,expected_sha256,props}}});return JSON.parse(response.result.content[0].text);};
  for(const [component,operation,extension] of [['Bar','set_progress_options','ProgressBar'],['Slider','set_slider_options','Slider']]){assert.equal((await call(operation,component,{titleType:'value',reverse:true})).ok,true);assert.equal((await call(operation,component,{reverse:false})).ok,true);const file=path.join(folder,component+'.xml'),before=fs.readFileSync(file);assert.match(before.toString(),/^\uFEFF/);assert.match(before.toString(),/<!--keep-->/);assert.match(before.toString(),new RegExp(`<${extension} titleType="value" reverse="false"/>`));for(const props of [{titleType:'invalid'},{reverse:'true'}]){assert.equal((await call(operation,component,props)).ok,false);assert.deepEqual(fs.readFileSync(file),before);}}
  assert.equal((await call('set_slider_options','Bar',{reverse:true})).ok,false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('ComboBox dropdown options validate cross-package component URLs',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-combobox-options-'));
 try{
  const a=path.join(root,'assets','A'),b=path.join(root,'assets','B');fs.mkdirSync(a,{recursive:true});fs.mkdirSync(b,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(a,'package.xml'),'<packageDescription id="aaaaaaaa"><resources><component id="combo" name="Combo.xml" path="/"/></resources></packageDescription>');fs.writeFileSync(path.join(b,'package.xml'),'<packageDescription id="bbbbbbbb"><resources><component id="drop" name="Dropdown.xml" path="/"/><image id="image" name="Image.png" path="/"/></resources></packageDescription>');fs.writeFileSync(path.join(b,'Dropdown.xml'),'<component size="20,20"><displayList/></component>');fs.writeFileSync(path.join(b,'Image.png'),'image');const file=path.join(a,'Combo.xml');fs.writeFileSync(file,'<component size="20,20" extention="ComboBox"><!--keep--><displayList/><ComboBox/></component>');
  const base={project:root,pkg:'A',name:'Combo'};const call=async(dropdown)=>{const expected_sha256=execute('read_component',base).sha256;const response=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'set_combobox_options',arguments:{...base,expected_sha256,props:{dropdown}}}});return JSON.parse(response.result.content[0].text);};
  assert.equal((await call('ui://B/Dropdown')).ok,true);const before=fs.readFileSync(file);assert.match(before.toString(),/<!--keep-->/);assert.match(before.toString(),/dropdown="ui:\/\/B\/Dropdown"/);for(const invalid of ['ui://B/Image','ui://B/Missing','invalid']){assert.equal((await call(invalid)).ok,false);assert.deepEqual(fs.readFileSync(file),before);}assert.equal((await call('')).ok,true);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('ComboBox instance edits preserve unspecified settings and reject invalid icons',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-combo-instance-write-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/><component id="combo" name="Combo.xml" path="/"/><image id="icon" name="Icon.png" path="/"/></resources></packageDescription>');fs.writeFileSync(path.join(folder,'Combo.xml'),'<component size="20,20" extention="ComboBox"><displayList/><ComboBox/></component>');fs.writeFileSync(path.join(folder,'Icon.png'),'icon');const file=path.join(folder,'Main.xml');fs.writeFileSync(file,'<component size="20,20"><displayList><component id="choice" xy="0,0" src="combo"/></displayList></component>');
  const base={project:root,pkg:'Demo',name:'Main',target:'choice'};const call=async(props)=>{const expected_sha256=execute('read_component',base).sha256;const response=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'set_combobox_instance_options',arguments:{...base,expected_sha256,props}}});return JSON.parse(response.result.content[0].text);};
  assert.equal((await call({visibleItemCount:4,items:[{title:'A & B',value:'a',icon:'ui://Demo/Icon'},{title:'Two'}]})).ok,true);assert.equal((await call({visibleItemCount:5})).ok,true);let before=fs.readFileSync(file);assert.match(before.toString(),/visibleItemCount="5"/);assert.match(before.toString(),/title="A &amp; B"/);for(const props of [{items:[{icon:'ui://Demo/Missing'}]},{items:[{title:3}]},{visibleItemCount:-1}]){assert.equal((await call(props)).ok,false);assert.deepEqual(fs.readFileSync(file),before);}assert.equal((await call({items:[]})).ok,true);assert.doesNotMatch(fs.readFileSync(file,'utf8'),/<item/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('image, loader and movieclip properties validate target types and fill settings',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-media-properties-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/><image id="img" name="Icon.png" path="/"/><movieclip id="clip" name="Clip.jta" path="/"/></resources></packageDescription>');fs.writeFileSync(path.join(folder,'Icon.png'),'image');fs.writeFileSync(path.join(folder,'Clip.jta'),'movie');const file=path.join(folder,'Main.xml');fs.writeFileSync(file,'<component size="20,20"><displayList><image id="image" xy="0,0" src="img"/><loader id="loader" xy="0,0"/><jta id="movie" xy="0,0" src="clip"/></displayList></component>');
  const base={project:root,pkg:'Demo',name:'Main'};const call=async(target,props)=>{const expected_sha256=execute('read_component',base).sha256;const response=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'set_properties',arguments:{...base,target,expected_sha256,props}}});return JSON.parse(response.result.content[0].text);};
  assert.equal((await call('image',{fillMethod:'radial90',fillAmount:65,fillClockwise:false,flip:'hz'})).ok,true);assert.equal((await call('loader',{url:'ui://Demo/Icon',fill:'scale'})).ok,true);assert.equal((await call('movie',{frame:2,playing:false})).ok,true);const before=fs.readFileSync(file);for(const [target,props] of [['image',{fillMethod:'none',fillAmount:10}],['image',{frame:2}],['movie',{playing:'no'}],['movie',{frame:[2]}],['loader',{fillAmount:101}],['loader',{url:'ui://Demo/Missing'}]]){assert.equal((await call(target,props)).ok,false);assert.deepEqual(fs.readFileSync(file),before);}assert.equal((await call('image',{fillMethod:'none'})).ok,true);const updated=fs.readFileSync(file,'utf8');assert.doesNotMatch(updated,/fillClockwise|fillAmount/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('graph properties validate geometry and remove obsolete shape attributes',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-graph-properties-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources></packageDescription>');const file=path.join(folder,'Main.xml');fs.writeFileSync(file,'<component size="30,30"><displayList><graph id="g" xy="0,0" type="rect" corner="3"/><text id="t" xy="0,0"/></displayList></component>');
  const base={project:root,pkg:'Demo',name:'Main'};const call=async(target,props)=>{const expected_sha256=execute('read_component',base).sha256;const response=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'set_properties',arguments:{...base,target,expected_sha256,props}}});return JSON.parse(response.result.content[0].text);};
  assert.equal((await call('g',{type:'polygon',points:'0,0,20,0,10,20',lineSize:2,lineColor:'#ff112233',fillColor:'#ff445566'})).ok,true);let xml=fs.readFileSync(file,'utf8');assert.doesNotMatch(xml,/corner=/);assert.match(xml,/points="0,0,20,0,10,20"/);const before=fs.readFileSync(file);for(const [target,props] of [['g',{points:'0,0,1'}],['g',{type:'regular_polygon',sides:2}],['g',{fillColor:'#bad'}],['t',{type:'rect'}],['g',{color:'#112233'}]]){assert.equal((await call(target,props)).ok,false);assert.deepEqual(fs.readFileSync(file),before);}assert.equal((await call('g',{type:'regular_polygon',sides:3,startAngle:15,distances:'1,0.8,1'})).ok,true);xml=fs.readFileSync(file,'utf8');assert.doesNotMatch(xml,/points=/);assert.match(xml,/sides="3"/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('text effects and input settings validate their target and can be cleared',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-text-options-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources></packageDescription>');const file=path.join(folder,'Main.xml');fs.writeFileSync(file,'<component size="30,30"><displayList><text id="input" xy="0,0" input="true"/><text id="label" xy="0,0"/></displayList></component>');
  const base={project:root,pkg:'Demo',name:'Main'};const call=async(target,props)=>{const expected_sha256=execute('read_component',base).sha256;const response=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'set_properties',arguments:{...base,target,expected_sha256,props}}});return JSON.parse(response.result.content[0].text);};
  assert.equal((await call('input',{prompt:'Enter & go',restrict:'0-9',maxLength:5,keyboardType:2,password:true,strokeColor:'#112233',shadowColor:'#445566',shadowOffset:'2,3'})).ok,true);const before=fs.readFileSync(file);for(const [target,props] of [['label',{password:true}],['input',{maxLength:-1}],['input',{shadowColor:null}],['input',{strokeColor:'#abcd'}],['input',{color:'#ff112233'}]]){assert.equal((await call(target,props)).ok,false);assert.deepEqual(fs.readFileSync(file),before);}assert.equal((await call('input',{strokeColor:null,shadowColor:null,shadowOffset:null})).ok,true);const xml=fs.readFileSync(file,'utf8');assert.doesNotMatch(xml,/strokeColor|shadowColor|shadowOffset/);assert.match(xml,/prompt="Enter &amp; go"/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('numeric property input is normalized for publication and rejects arrays',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-normalized-properties-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources><publish name="Demo"/></packageDescription>');const file=path.join(folder,'Main.xml');fs.writeFileSync(file,'<component size="10,10"><displayList><text id="t" xy="0,0"/></displayList></component>');const base={project:root,pkg:'Demo',name:'Main'};
  const revision=()=>execute('read_component',base).sha256;setComponentProperties({...base,expected_sha256:revision(),props:{size:' 20 , 30 ',margin:' 1, 2, 3, 4 '}});setProperties({...base,target:'t',expected_sha256:revision(),props:{xy:' +2, -3 ',size:' 4, 5 ',leading:' 6 '}});const xml=fs.readFileSync(file,'utf8');assert.match(xml,/size="20,30"/);assert.match(xml,/margin="1,2,3,4"/);assert.match(xml,/xy="2,-3"/);assert.match(xml,/leading="6"/);assert.throws(()=>setProperties({...base,target:'t',expected_sha256:revision(),props:{leading:[6]}}),/invalid leading/);if(process.platform==='win32'){const {publishImages}=await import('./publish-images.mjs');const result=await publishImages({...base,output:path.join(root,'out')},{allowSounds:true,allowComponents:true});assert.equal(result.components,1);}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('image publication settings preserve package XML and enforce revisions', async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-image-options-'));
  try {
    const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');
    const file=path.join(folder,'package.xml'),xml='\uFEFF<packageDescription id="abcdefgh"><!--keep--><resources><image id="i" name="pic.png" path="/"/></resources></packageDescription>';fs.writeFileSync(file,xml);
    const {encodePng}=await import('./images.mjs');fs.writeFileSync(path.join(folder,'pic.png'),await encodePng({width:8,height:8,pixels:Buffer.alloc(256,255)}));
    const args={project:root,pkg:'Demo',item:'pic',expected_sha256:execute('read_package',{project:root,pkg:'Demo'}).sha256,props:{scale:'9grid',scale9grid:'1,2,3,4',exported:true}};
    const response=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'set_image_options',arguments:args}});
    assert.equal(response.result.isError,false,response.result.content[0].text);const updated=fs.readFileSync(file,'utf8');assert.match(updated,/^\uFEFF/);assert.match(updated,/<!--keep-->/);assert.match(updated,/scale="9grid"/);assert.match(updated,/scale9grid="1,2,3,4"/);
    const stale=await message({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'set_image_options',arguments:args}});assert.equal(stale.result.isError,true);
    const next={...args,expected_sha256:execute('read_package',{project:root,pkg:'Demo'}).sha256,props:{scale:'tile'}};
    const changed=await message({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'set_image_options',arguments:next}});assert.equal(changed.result.isError,false);assert.doesNotMatch(fs.readFileSync(file,'utf8'),/scale9grid/);
    const before=fs.readFileSync(file),current=execute('read_package',{project:root,pkg:'Demo'}).sha256;
    for(const props of [{scale:'9grid'},{scale:'tile',scale9grid:'1,2,3,4'},{scale:'9grid',scale9grid:'0,0,0,4'},{exported:'true'}]) {
      const rejected=await message({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'set_image_options',arguments:{...args,expected_sha256:current,props}}});
      assert.equal(rejected.result.isError,true);assert.deepEqual(fs.readFileSync(file),before);
    }
    const warned=await message({jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'set_image_options',arguments:{...args,expected_sha256:current,props:{scale:'9grid',scale9grid:'7,7,2,2'}}}});assert.equal(warned.result.isError,false);assert.match(JSON.parse(warned.result.content[0].text).data.warnings[0],/beyond image dimensions/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('resource insertion supports cross-package references and revision checks through MCP', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-insert-'));
  try {
    const a=path.join(root,'assets','A'),b=path.join(root,'assets','B');fs.mkdirSync(a,{recursive:true});fs.mkdirSync(b,{recursive:true});
    fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');
    fs.writeFileSync(path.join(a,'package.xml'),'<packageDescription id="aaaaaaaa"><resources><component id="main" name="Main.xml" path="/"/></resources></packageDescription>');
    fs.writeFileSync(path.join(b,'package.xml'),'<packageDescription id="bbbbbbbb"><resources><image id="img" name="picture.png" path="/"/></resources></packageDescription>');
    fs.writeFileSync(path.join(b,'picture.png'),'image');const file=path.join(a,'Main.xml');
    fs.writeFileSync(file,'\uFEFF<component><!-- <displayList/> --><displayList><text id="old" name="old"/></displayList></component>');
    const args={project:root,pkg:'A',name:'Main',ref_pkg:'B',ref_name:'picture',object_name:'a & b',index:0,x:2,y:-3,expected_sha256:execute('read_component',{project:root,pkg:'A',name:'Main'}).sha256};
    const response=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'insert_resource',arguments:args}});
    assert.equal(response.result.isError,false);const result=JSON.parse(response.result.content[0].text).data;
    assert.equal(result.source_package,'bbbbbbbb');
    const objects=execute('list_children',args).children;assert.deepEqual(objects.map(o=>o.id),[result.id,'old']);
    assert.equal(objects[0].attributes.pkg,'bbbbbbbb');assert.equal(objects[0].name,'a & b');
    assert.match(fs.readFileSync(file,'utf8'),/^\uFEFF/);
    assert.throws(()=>insertResource(args),/expected_sha256/);
    const sha=execute('read_component',args).sha256;
    assert.throws(()=>insertResource({...args,expected_sha256:sha,index:5}),/index/);
    fs.writeFileSync(file,'<component><displayList/></component>');
    insertResource({...args,expected_sha256:execute('read_component',args).sha256,index:0});
    assert.equal(execute('list_children',args).children.length,1);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('component writes preserve XML and reject stale or newly broken references', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-write-'));
  try {
    const folder=path.join(root,'assets','Demo'); fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(root,'demo.fairy'),'<projectDescription/>');
    fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="c" name="Main.xml" path="/"/></resources></packageDescription>');
    const original='<component><displayList><text id="n1" text="old"/></displayList></component>';
    const file=path.join(folder,'Main.xml'); fs.writeFileSync(file,original);
    const args={project:root,pkg:'Demo',name:'Main'}, sha=execute('read_component',args).sha256;
    assert.throws(()=>writeComponent({...args,xml:original,expected_sha256:'old'}),/expected_sha256/);
    assert.throws(()=>writeComponent({...args,xml:original.replace('<text','<image').replace('text="old"','src="missing"'),expected_sha256:sha}),/unknown resource/);
    const rich=original.replace('<text id="n1" text="old"/>','<richtext id="n1" text="&lt;img src=&quot;ui://Demo/missing&quot;/&gt;"/>');
    assert.throws(()=>writeComponent({...args,xml:rich,expected_sha256:sha}),/unknown or ambiguous UI URL/);
    assert.equal(fs.readFileSync(file,'utf8'),original);
    const next=original.replace('old','新文本');
    const result=writeComponent({...args,xml:next,expected_sha256:sha});
    assert.equal(fs.readFileSync(file,'utf8'),next);
    assert.equal(result.sha256,execute('read_component',args).sha256);
    assert.throws(()=>writeComponent({...args,xml:original,expected_sha256:sha}),/expected_sha256/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('child property changes preserve surrounding XML and validate values', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-child-'));
  try {
    const folder=path.join(root,'assets','Demo'); fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(root,'demo.fairy'),'<projectDescription/>');
    fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="c" name="Main.xml" path="/"/></resources></packageDescription>');
    const xml='<?xml version="1.0"?><component><!--<displayList/>--><displayList><graph id="g"/><text id="n1" name="title" text="old"><relation target="g" sidePair="width-width"/></text></displayList></component>';
    const file=path.join(folder,'Main.xml'); fs.writeFileSync(file,xml);
    const args={project:root,pkg:'Demo',name:'Main',target:'title'}, sha=execute('read_component',args).sha256;
    setProperties({...args,expected_sha256:sha,props:{text:'a & b',xy:'12,34'}});
    assert.equal(fs.readFileSync(file,'utf8'),xml.replace('text="old"','text="a &amp; b" xy="12,34"'));
    assert.throws(()=>setProperties({...args,expected_sha256:execute('read_component',args).sha256,props:{alpha:2}}),/invalid alpha/);
    const current=execute('read_component',args).sha256, before=fs.readFileSync(file,'utf8');
    assert.throws(()=>setPropertiesBatch({...args,expected_sha256:current,changes:[{target:'g',props:{xy:'1,2'}},{target:'title',props:{alpha:3}}]}),/invalid alpha/);
    assert.equal(fs.readFileSync(file,'utf8'),before);
    setPropertiesBatch({...args,expected_sha256:current,changes:[{target:'title',props:{name:'renamed'}},{target:'renamed',props:{text:'updated'}}]});
    assert.match(fs.readFileSync(file,'utf8'),/name="renamed" text="updated"/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('component property update preserves BOM, comments and unrelated XML', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-props-'));
  try {
    const folder=path.join(root,'assets','Demo'); fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(root,'demo.fairy'),'<projectDescription/>');
    fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="c" name="Main.xml" path="/"/></resources></packageDescription>');
    const xml='\uFEFF<?xml version="1.0"?><!-- <component size="bad"> --><component size="10,20"><displayList/></component>';
    const file=path.join(folder,'Main.xml'); fs.writeFileSync(file,xml);
    const args={project:root,pkg:'Demo',name:'Main'}, sha=execute('read_component',args).sha256;
    setComponentProperties({...args,expected_sha256:sha,props:{size:'40,60',opaque:false}});
    assert.equal(fs.readFileSync(file,'utf8'),xml.replace('<component size="10,20">','<component size="40,60" opaque="false">'));
    assert.throws(()=>setComponentProperties({...args,expected_sha256:sha,props:{size:'0,2'}}),/invalid size/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('new packages are visible, valid and cannot replace an existing directory', {skip:process.platform!=='win32'}, () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-package-'));
  try {
    fs.mkdirSync(path.join(root,'assets'));fs.writeFileSync(path.join(root,'demo.fairy'),'<projectDescription/>');
    const made=createPackage({project:root,name:'测试 包'});
    assert.match(made.id,/^[0-9a-f]{8}$/);
    assert.equal(execute('list_packages',{project:root})[0].name,'测试 包');
    assert.deepEqual(execute('list_items',{project:root,pkg:made.id}),[]);
    assert.throws(()=>createPackage({project:root,name:'测试 包'}),/exists/);
    assert.throws(()=>createPackage({project:root,name:'../bad'}),/invalid/);
    assert.throws(()=>createPackage({project:root,name:'CON'}),/invalid/);
    const component=createComponent({project:root,pkg:made.id,name:'界面',width:100,height:80,path:'/UI/',exported:true,extention:'ScrollBar'});
    assert.equal(execute('read_component',{project:root,pkg:made.id,name:component.id}).sha256,component.sha256);
    assert.deepEqual(execute('list_children',{project:root,pkg:made.id,name:component.id}).children.map(c=>c.name),['bar','grip']);
    assert.throws(()=>createComponent({project:root,pkg:made.id,name:'界面',width:100,height:80,path:'/UI/'}),/already registered/);
    assert.throws(()=>createComponent({project:root,pkg:made.id,name:'X',width:5,height:5,path:'../bad'}),/invalid package path/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('controller edits preserve XML, revisions and page references through MCP', async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-controller-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources></packageDescription>');
  const file=path.join(folder,'Main.xml');fs.writeFileSync(file,'\uFEFF<component size="100,100"><!--keep--><displayList><text id="t"/></displayList></component>');
  const base={project:root,pkg:'Demo',name:'Main',controller:'state',pages:[{id:'p0',name:'Normal'},{id:'p1',name:'A & B'}],expected_sha256:execute('read_component',{project:root,pkg:'Demo',name:'Main'}).sha256};
  const call=async(name,args)=>{const r=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});return JSON.parse(r.result.content[0].text);};
  const created=await call('create_controller',base);assert.equal(created.ok,true,created.error);assert.match(fs.readFileSync(file,'utf8'),/^\uFEFF/);assert.match(fs.readFileSync(file,'utf8'),/<!--keep-->/);assert.deepEqual(execute('list_controllers',base).controllers[0].pages,base.pages);
  assert.equal((await call('create_controller',base)).ok,false);
  let xml=fs.readFileSync(file,'utf8').replace('<text id="t"/>','<text id="t"><gearDisplay controller="state" pages="p1"/></text>');writeComponent({...base,expected_sha256:created.data.sha256,xml});
  const before=fs.readFileSync(file),sha=execute('read_component',base).sha256,blocked=await call('set_controller_pages',{...base,expected_sha256:sha,pages:[{id:'p0',name:'Normal'}]});assert.equal(blocked.ok,false);assert.match(blocked.error,/unknown page/);assert.deepEqual(fs.readFileSync(file),before);
  const updated=await call('set_controller_pages',{...base,expected_sha256:sha,pages:[{id:'p0',name:'First'},{id:'p1',name:'Second'}],selected:1});assert.equal(updated.ok,true,updated.error);assert.equal(execute('list_controllers',base).controllers[0].selected,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('relation and visibility gear edits work through MCP and reject invalid references', async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-behavior-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources></packageDescription>');
  const file=path.join(folder,'Main.xml');fs.writeFileSync(file,'\uFEFF<component size="100,100"><!--keep--><controller name="state" pages="p0,Normal,p1,Active"/><displayList><text id="a" name="title"/><graph id="b" name="background"/></displayList></component>');
  const base={project:root,pkg:'Demo',name:'Main',target:'title'},revision=()=>execute('read_component',base).sha256;
  const call=async(name,extra)=>{const response=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{...base,expected_sha256:revision(),...extra}}});return JSON.parse(response.result.content[0].text);};
  let result=await call('set_relation',{related_to:'background',side_pairs:['width','top-top']});assert.equal(result.ok,true,result.error);
  result=await call('set_display_gear',{controller:'state',pages:['p1']});assert.equal(result.ok,true,result.error);
  result=await call('set_display2_gear',{controller:'state',pages:['p0'],condition:1});assert.equal(result.ok,true,result.error);
  let obj=execute('list_children',base).children[0];assert.equal(obj.behaviors.find(b=>b.type==='relation').attributes.target,'b');assert.equal(obj.behaviors.find(b=>b.type==='gearDisplay2').attributes.condition,'1');assert.match(fs.readFileSync(file,'utf8'),/^\uFEFF/);assert.match(fs.readFileSync(file,'utf8'),/<!--keep-->/);
  const before=fs.readFileSync(file);result=await call('set_display_gear',{controller:'state',pages:['missing']});assert.equal(result.ok,false);assert.deepEqual(fs.readFileSync(file),before);
  result=await call('remove_relation',{related_to:'background'});assert.equal(result.ok,true,result.error);result=await call('remove_gear',{gear:'display'});assert.equal(result.ok,true,result.error);obj=execute('list_children',base).children[0];assert.deepEqual(obj.behaviors.map(b=>b.type),['gearDisplay2']);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('resource imports validate contents and register atomically through MCP', async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-import-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');const packageFile=path.join(folder,'package.xml');fs.writeFileSync(packageFile,'\uFEFF<packageDescription id="abcdefgh"><!--keep--><resources/></packageDescription>');
  const png=path.join(root,'source.png'),{encodePng}=await import('./images.mjs');fs.writeFileSync(png,await encodePng({width:3,height:2,pixels:Buffer.alloc(24,255)}));
  const call=async(name,args)=>{const r=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{project:root,pkg:'Demo',...args}}});return JSON.parse(r.result.content[0].text);};
  const result=await call('import_image',{source:png,name:'picture.png',path:'/art/icons/',exported:true});assert.equal(result.ok,true,result.error);assert.equal(result.data.width,3);assert.equal(result.data.height,2);assert.deepEqual(fs.readFileSync(result.data.path),fs.readFileSync(png));assert.match(fs.readFileSync(packageFile,'utf8'),/^\uFEFF/);assert.match(fs.readFileSync(packageFile,'utf8'),/<!--keep-->/);assert.equal(execute('list_items',{project:root,pkg:'Demo'})[0].id,result.data.id);
  const before=fs.readFileSync(packageFile);for(const args of [{source:png,name:'picture.png',path:'/art/icons/'},{source:png,name:'bad.jpg'},{source:png,name:'new.png',path:'../escape'}]){const rejected=await call('import_image',args);assert.equal(rejected.ok,false);assert.deepEqual(fs.readFileSync(packageFile),before);}
  const wav=Buffer.alloc(48);wav.write('RIFF',0);wav.writeUInt32LE(40,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(8000,28);wav.writeUInt16LE(1,32);wav.writeUInt16LE(8,34);wav.write('data',36);wav.writeUInt32LE(4,40);const audio=path.join(root,'tone.wav');fs.writeFileSync(audio,wav);
  const sound=await call('import_sound',{source:audio});assert.equal(sound.ok,true,sound.error);assert.deepEqual(fs.readFileSync(sound.data.path),wav);assert.equal(execute('list_items',{project:root,pkg:'Demo'}).length,2);
  const comma=await call('import_image',{source:png,name:'red,blue.png'});assert.equal(comma.ok,true,comma.error);assert.equal(path.basename(comma.data.path),'red,blue.png');
  if(process.env.FGUI_SAMPLE_PROJECT){const source=path.join(process.env.FGUI_SAMPLE_PROJECT,'assets','TreeView','Icons','heart.jta'),clip=await call('import_movieclip',{source});assert.equal(clip.ok,true,clip.error);assert.ok(clip.data.frames>0);assert.deepEqual(fs.readFileSync(clip.data.path),fs.readFileSync(source));}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('bitmap font import validates registered glyphs and texture bounds', async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-font-import-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><image id="img" name="sheet.png" path="/"/></resources></packageDescription>');
  const {encodePng}=await import('./images.mjs');fs.writeFileSync(path.join(folder,'sheet.png'),await encodePng({width:8,height:8,pixels:Buffer.alloc(256,255)}));
  const call=async args=>{const r=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'import_font',arguments:{project:root,pkg:'Demo',...args}}});return JSON.parse(r.result.content[0].text);};
  const bitmap=path.join(root,'glyph.fnt');fs.writeFileSync(bitmap,'info size=12 colored=true\ncommon lineHeight=14 pages=1\nchar id=65 img=img xadvance=9\n');let result=await call({source:bitmap});assert.equal(result.ok,true,result.error);assert.equal(result.data.glyphs,1);assert.equal(result.data.texture,null);
  const ttf=path.join(root,'ttf.fnt');fs.writeFileSync(ttf,'info size=12\ncommon lineHeight=14 pages=1\nchar id=65 x=1 y=1 width=5 height=5 xadvance=6 page=0 chnl=0\n');result=await call({source:ttf,texture:'sheet'});assert.equal(result.ok,true,result.error);assert.equal(result.data.texture,'img');assert.equal(execute('list_items',{project:root,pkg:'Demo'}).find(i=>i.id===result.data.id).texture,'img');
  const before=fs.readFileSync(path.join(folder,'package.xml'));fs.writeFileSync(ttf,'info size=12\ncommon pages=1\nchar id=65 x=5 y=5 width=5 height=5 page=0\n');result=await call({source:ttf,name:'bad.fnt',texture:'img'});assert.equal(result.ok,false);assert.match(result.error,/exceeds texture/);assert.deepEqual(fs.readFileSync(path.join(folder,'package.xml')),before);assert.equal(fs.existsSync(path.join(folder,'bad.fnt')),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('insert, move and remove display objects preserve references and revisions', async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-objects-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources></packageDescription>');const file=path.join(folder,'Main.xml');fs.writeFileSync(file,'\uFEFF<component size="100,100"><!--keep--><displayList><text id="a" name="first"/><graph id="b" name="second"><relation target="a" sidePair="width"/></graph></displayList></component>');
  const base={project:root,pkg:'Demo',name:'Main'},revision=()=>execute('read_component',base).sha256,call=async(name,extra)=>{const r=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{...base,expected_sha256:revision(),...extra}}});return JSON.parse(r.result.content[0].text);};
  let result=await call('insert_object',{object_xml:'<text id="c" name="new" xy="0,0" text="Hi"/>',index:1});assert.equal(result.ok,true,result.error);assert.deepEqual(execute('list_children',base).children.map(x=>x.id),['a','c','b']);
  result=await call('move_object',{target:'b',index:0});assert.equal(result.ok,true,result.error);assert.deepEqual(execute('list_children',base).children.map(x=>x.id),['b','a','c']);assert.match(fs.readFileSync(file,'utf8'),/<!--keep-->/);
  const before=fs.readFileSync(file);result=await call('remove_object',{target:'a'});assert.equal(result.ok,false);assert.match(result.error,/referenced/);assert.deepEqual(fs.readFileSync(file),before);
  result=await call('remove_object',{target:'new'});assert.equal(result.ok,true,result.error);assert.deepEqual(execute('list_children',base).children.map(x=>x.id),['b','a']);
  result=await call('insert_object',{object_xml:'<graph id="a"/>'});assert.equal(result.ok,false);assert.match(result.error,/duplicate/);
  result=await call('insert_object',{object_xml:'<graph id="missing_xy" size="10,10" type="rect"/>'});assert.equal(result.ok,false);assert.match(result.error,/missing or invalid xy/);
  result=await call('insert_object',{object_xml:'<image id="missing_src" xy="0,0"/>'});assert.equal(result.ok,false);assert.match(result.error,/requires a registered resource ID/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('value gears validate page data, object types and tween settings',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-gears-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/><image id="img" name="icon.png" path="/"/></resources></packageDescription>');fs.writeFileSync(path.join(folder,'icon.png'),'image');const file=path.join(folder,'Main.xml');fs.writeFileSync(file,'<component size="100,100"><controller name="state" pages="p0,Normal,p1,Active"/><displayList><text id="t" xy="0,0"/><loader id="l" xy="0,0"/><graph id="g" xy="0,0"/></displayList></component>');
  const base={project:root,pkg:'Demo',name:'Main',controller:'state',pages:['p0','p1']},revision=()=>execute('read_component',base).sha256,call=async(name,extra)=>{const r=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{...base,expected_sha256:revision(),...extra}}});return JSON.parse(r.result.content[0].text);};
  for(const [name,args] of [['set_text_gear',{target:'t',values:['Hello','World'],default:'Hello'}],['set_font_size_gear',{target:'t',values:['12','-'],default:'20'}],['set_color_gear',{target:'t',values:['#ff0000','-']}],['set_icon_gear',{target:'l',values:['ui://Demo/icon','']}],['set_animation_gear',{target:'l',values:['2,p','0,s']}],['set_position_gear',{target:'g',values:['10,20','-'],tween:{enabled:true,ease:'Linear',duration:0.4}}],['set_size_gear',{target:'g',values:['10,20','30,40,1,1']}],['set_look_gear',{target:'g',values:['0.5,10,0,1','1,0,0,1']}]]){const result=await call(name,args);assert.equal(result.ok,true,`${name}: ${result.error}`);}
  let object=execute('list_children',base).children.find(o=>o.id==='g');assert.equal(object.behaviors.find(g=>g.type==='gearXY').attributes.tween,'true');
  let result=await call('set_position_gear',{target:'g',values:['1,2','3,4']});assert.equal(result.ok,true,result.error);object=execute('list_children',base).children.find(o=>o.id==='g');assert.equal(object.behaviors.find(g=>g.type==='gearXY').attributes.tween,'true');
  const before=fs.readFileSync(file);for(const [name,args] of [['set_text_gear',{target:'g',values:['a','b']}],['set_size_gear',{target:'g',values:['-1,2','3,4']}],['set_icon_gear',{target:'l',values:['ui://Demo/missing','']}],['set_look_gear',{target:'g',values:['2,0,0','1,0,0']}],['set_position_gear',{target:'g',values:['1,2','3,4'],tween:{enabled:false,duration:1}}]]){result=await call(name,args);assert.equal(result.ok,false,name);assert.deepEqual(fs.readFileSync(file),before);}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('Button and Label instance options validate types and cross-package icons',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-instances-'));try{
  const a=path.join(root,'assets','A'),b=path.join(root,'assets','B');fs.mkdirSync(a,{recursive:true});fs.mkdirSync(b,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(a,'package.xml'),'<packageDescription id="aaaaaaaa"><resources><component id="main" name="Main.xml" path="/"/></resources></packageDescription>');fs.writeFileSync(path.join(b,'package.xml'),'<packageDescription id="bbbbbbbb"><resources><component id="btn" name="Button.xml" path="/"/><component id="label" name="Label.xml" path="/"/><image id="icon" name="icon.png" path="/"/></resources></packageDescription>');fs.writeFileSync(path.join(b,'Button.xml'),'<component size="10,10" extention="Button"><displayList/><Button/></component>');fs.writeFileSync(path.join(b,'Label.xml'),'<component size="10,10" extention="Label"><displayList/></component>');fs.writeFileSync(path.join(b,'icon.png'),'image');const file=path.join(a,'Main.xml');fs.writeFileSync(file,'<component size="100,100"><displayList><component id="a" xy="0,0" src="btn" pkg="B"/><component id="b" xy="0,0" src="label" pkg="B"/></displayList></component>');
  const base={project:root,pkg:'A',name:'Main'},revision=()=>execute('read_component',base).sha256,call=async(name,extra)=>{const r=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{...base,expected_sha256:revision(),...extra}}});return JSON.parse(r.result.content[0].text);};
  let r=await call('set_button_instance_options',{target:'a',props:{title:'Buy & Go',icon:'ui://B/icon',checked:true,titleColor:'#123456',titleFontSize:18}});assert.equal(r.ok,true,r.error);r=await call('set_button_instance_options',{target:'a',props:{selectedTitle:'Selected'}});assert.equal(r.ok,true,r.error);r=await call('set_label_instance_options',{target:'b',props:{title:'Name',icon:'ui://bbbbbbbbicon'}});assert.equal(r.ok,true,r.error);let xml=fs.readFileSync(file,'utf8');assert.match(xml,/title="Buy &amp; Go"/);assert.match(xml,/selectedTitle="Selected"/);assert.match(xml,/checked="true"/);
  const before=fs.readFileSync(file);for(const [name,args] of [['set_label_instance_options',{target:'a',props:{title:'wrong'}}],['set_button_instance_options',{target:'a',props:{icon:'ui://B/missing'}}],['set_button_instance_options',{target:'a',props:{checked:'true'}}]]){r=await call(name,args);assert.equal(r.ok,false);assert.deepEqual(fs.readFileSync(file),before);}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('Button component settings preserve existing options and validate sounds',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-button-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="button" name="Button.xml" path="/"/><sound id="snd" name="click.wav" path="/"/></resources></packageDescription>');fs.writeFileSync(path.join(folder,'click.wav'),'sound');const file=path.join(folder,'Button.xml');fs.writeFileSync(file,'\uFEFF<component size="10,10" extention="Button"><!--keep--><displayList/><Button mode="Check"/></component>');
  const base={project:root,pkg:'Demo',name:'Button'},revision=()=>execute('read_component',base).sha256,call=async(props)=>{const r=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'set_button_options',arguments:{...base,props,expected_sha256:revision()}}});return JSON.parse(r.result.content[0].text);};
  let result=await call({sound:'ui://Demo/click',downEffect:'scale',downEffectValue:0.5});assert.equal(result.ok,true,result.error);let text=fs.readFileSync(file,'utf8');assert.match(text,/^\uFEFF/);assert.match(text,/<!--keep-->/);assert.match(text,/mode="Check"/);assert.match(text,/sound="ui:\/\/Demo\/click"/);
  const before=fs.readFileSync(file);for(const props of [{sound:'ui://Demo/missing'},{mode:'bad'},{downEffectValue:20}]){result=await call(props);assert.equal(result.ok,false);assert.deepEqual(fs.readFileSync(file),before);}
  fs.writeFileSync(file,'<component size="10,10" extention="Button"><displayList/></component>');result=await call({mode:'Radio'});assert.equal(result.ok,true,result.error);assert.match(fs.readFileSync(file,'utf8'),/<Button mode="Radio"\/>/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('component writes reject newly referenced registered files that do not exist',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-missing-file-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/><image id="img" name="missing.png" path="/"/></resources></packageDescription>');const file=path.join(folder,'Main.xml'),original='<component size="10,10"><displayList/></component>';fs.writeFileSync(file,original);
  const base={project:root,pkg:'Demo',name:'Main'},sha=execute('read_component',base).sha256,xml='<component size="10,10"><displayList><image id="n" xy="0,0" src="img"/></displayList></component>';assert.throws(()=>writeComponent({...base,xml,expected_sha256:sha}),/resource file is missing/);assert.equal(fs.readFileSync(file,'utf8'),original);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('component writes reject incompatible and missing UI URL resources',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-url-types-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/><image id="present" name="present.png" path="/"/><image id="missing" name="missing.png" path="/"/><sound id="sound" name="sound.wav" path="/"/></resources></packageDescription>');fs.writeFileSync(path.join(folder,'present.png'),'image');fs.writeFileSync(path.join(folder,'sound.wav'),'sound');const file=path.join(folder,'Main.xml'),original='<component size="10,10"><displayList/></component>';fs.writeFileSync(file,original);
  const base={project:root,pkg:'Demo',name:'Main'},sha=execute('read_component',base).sha256;
  assert.throws(()=>writeComponent({...base,expected_sha256:sha,xml:'<component size="10,10"><displayList><text id="t" xy="0,0" font="ui://Demo/present"/></displayList></component>'}),/incompatible image UI resource/);
  assert.throws(()=>writeComponent({...base,expected_sha256:sha,xml:'<component size="10,10"><displayList><loader id="l" xy="0,0" url="ui://Demo/sound"/></displayList></component>'}),/incompatible sound UI resource/);
  assert.throws(()=>writeComponent({...base,expected_sha256:sha,xml:'<component size="10,10"><displayList><list id="l" xy="0,0"><item url="ui://Demo/present"/></list></displayList></component>'}),/incompatible image UI resource/);
  assert.throws(()=>writeComponent({...base,expected_sha256:sha,xml:'<component size="10,10"><displayList><loader id="l" xy="0,0" url="ui://Demo/missing"/></displayList></component>'}),/missing UI resource file/);assert.equal(fs.readFileSync(file,'utf8'),original);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('group layout properties can be edited and reject list-only layouts',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-group-edit-'));try{const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources></packageDescription>');const file=path.join(folder,'Main.xml');fs.writeFileSync(file,'<component size="100,100"><displayList><group id="g" xy="0,0"/><list id="l" xy="0,0"/></displayList></component>');const base={project:root,pkg:'Demo',name:'Main',target:'g'};const revision=()=>execute('read_component',base).sha256;const call=async(target,props)=>JSON.parse((await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'set_properties',arguments:{...base,target,props,expected_sha256:revision()}}})).result.content[0].text);
 const result=await call('g',{advanced:true,layout:'hz',lineGap:-4,colGap:5,excludeInvisibles:true,autoSizeDisabled:true,mainGridIndex:2});assert.equal(result.ok,true,result.error);const attrs=execute('list_children',base).children[0].attributes;assert.equal(attrs.advanced,'true');assert.equal(attrs.layout,'hz');assert.equal(attrs.lineGap,'-4');assert.equal(attrs.mainGridIndex,'2');assert.equal(attrs.excludeInvisibles,'true');assert.equal((await call('g',{layout:'row'})).ok,false);assert.equal((await call('l',{layout:'hz'})).ok,false);assert.equal((await call('l',{mainGridIndex:2})).ok,false);assert.equal((await call('l',{advanced:true})).ok,false);assert.equal((await call('l',{group:'missing'})).ok,false);assert.equal((await call('g',{group:'g'})).ok,false);assert.equal((await call('l',{group:'g'})).ok,true);assert.equal(execute('list_children',base).children[1].attributes.group,'g');assert.equal((await call('l',{group:null})).ok,true);assert.equal(execute('list_children',base).children[1].attributes.group,undefined);fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('<group id="g"','<group group="g" id="g"'));assert.equal((await call('g',{group:null})).ok,true);assert.equal((await call('g',{lineGap:40000})).ok,true);assert.equal((await call('l',{lineGap:40000})).ok,false);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('component writes retry transient Windows rename failures without overwriting concurrent changes',{skip:process.platform!=='win32'},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-rename-retry-')),originalRename=fs.renameSync;
 try{
  const dir=path.join(root,'assets','Demo');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(dir,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources></packageDescription>');
  const file=path.join(dir,'Main.xml'),initial='<component size="20,20"><displayList/></component>',edited='<component size="30,30"><displayList/></component>',other='<component size="40,40"><displayList/></component>',args={project:root,pkg:'Demo',name:'Main'};fs.writeFileSync(file,initial);
  let attempts=0;fs.renameSync=(...values)=>{if(++attempts<3){const error=new Error('transient denial');error.code='EPERM';throw error;}return originalRename(...values);};
  writeComponent({...args,xml:edited,expected_sha256:execute('read_component',args).sha256});assert.equal(attempts,3);assert.equal(fs.readFileSync(file,'utf8'),edited);
  attempts=0;fs.renameSync=()=>{attempts++;fs.writeFileSync(file,other);const error=new Error('transient denial');error.code='EPERM';throw error;};assert.throws(()=>writeComponent({...args,xml:initial,expected_sha256:execute('read_component',args).sha256}),/file changed during write/);assert.equal(attempts,1);assert.equal(fs.readFileSync(file,'utf8'),other);
  attempts=0;fs.renameSync=()=>{attempts++;const error=new Error('persistent denial');error.code='EPERM';throw error;};assert.throws(()=>writeComponent({...args,xml:initial,expected_sha256:execute('read_component',args).sha256}),/persistent denial/);assert.equal(attempts,5);assert.equal(fs.readFileSync(file,'utf8'),other);assert.deepEqual(fs.readdirSync(dir).sort(),['Main.xml','package.xml']);
 }finally{fs.renameSync=originalRename;fs.rmSync(root,{recursive:true,force:true});}
});
