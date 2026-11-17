import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validate} from './validate.mjs';
import {message} from './mcp.mjs';
import {encodePng} from './images.mjs';

test('validation rejects incompatible loader and list item resource types',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-url-type-validation-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/><image id="icon" name="Icon.png" path="/"/><sound id="sound" name="Sound.wav" path="/"/></resources></packageDescription>');fs.writeFileSync(path.join(folder,'Icon.png'),await encodePng({width:1,height:1,pixels:Buffer.from([1,2,3,255])}));fs.writeFileSync(path.join(folder,'Sound.wav'),'sound');fs.writeFileSync(path.join(folder,'Main.xml'),'<component size="10,10"><displayList><loader id="l" xy="0,0" url="ui://Demo/Sound"/><list id="list" xy="0,0"><item url="ui://Demo/Icon"/></list></displayList></component>');const report=await validate({project:root});assert.ok(report.issues.some(issue=>issue.error.includes('incompatible sound UI resource')));assert.ok(report.issues.some(issue=>issue.error.includes('incompatible image UI resource')));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('validation reports malformed component dimensions',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-component-size-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources></packageDescription>');const file=path.join(folder,'Main.xml');
  for(const size of ['bad','1,-2','1,2147483648','1,2,3']){fs.writeFileSync(file,`<component size="${size}"><displayList/></component>`);const report=await validate({project:root});assert.ok(report.issues.some(issue=>issue.error==='component has invalid size'),size);}
  fs.writeFileSync(file,'<component size="123,456"><displayList/></component>');assert.equal((await validate({project:root})).valid,true);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('validation scopes project descriptors to the explicitly requested FairyGUI file',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-validate-descriptor-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});const selected=path.join(root,'selected.fairy');fs.writeFileSync(selected,'<projectDescription type="CocosCreator"/>');fs.writeFileSync(path.join(root,'other.fairy'),'<broken');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources/></packageDescription>');
  const report=await validate({project:selected});assert.equal(report.valid,true,JSON.stringify(report));const directory=await validate({project:root});assert.equal(directory.valid,false);assert.ok(directory.issues.some(i=>i.path===path.join(root,'other.fairy')));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('exported-only validation follows published dependencies and reports a broken closure',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-export-validation-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');const packageFile=path.join(folder,'package.xml');fs.writeFileSync(packageFile,'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/" exported="true"/><component id="unused" name="Unused.xml" path="/"/><image id="img" name="image.png" path="/"/></resources></packageDescription>');fs.writeFileSync(path.join(folder,'Main.xml'),'<component size="20,20"><displayList><image id="n" src="img" xy="0,0"/></displayList></component>');fs.writeFileSync(path.join(folder,'Unused.xml'),'<component size="20,20"><displayList><image id="n" src="missing" xy="0,0"/></displayList></component>');fs.writeFileSync(path.join(folder,'image.png'),await encodePng({width:4,height:4,pixels:Buffer.alloc(64,255)}));
  assert.equal((await validate({project:root})).valid,false);const response=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'validate',arguments:{project:root,exported_only:true}}});const result=JSON.parse(response.result.content[0].text);assert.equal(result.ok,true,result.error);assert.equal(result.data.valid,true,JSON.stringify(result));assert.match(result.data.scope,/exported resources/);
  fs.writeFileSync(path.join(folder,'image.png'),'corrupt');let report=await validate({project:root,exported_only:true});assert.equal(report.valid,false);assert.ok(report.issues.some(i=>i.resource==='image.png'));
  fs.writeFileSync(path.join(folder,'Main.xml'),'<component size="20,20"><displayList><image id="n" src="missing" xy="0,0"/></displayList></component>');report=await validate({project:root,exported_only:true});assert.equal(report.valid,false);assert.ok(report.issues.some(i=>i.error.includes('cannot determine exported resource closure')));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('validation checks image contents even for unusual extensions and rejects malformed scale settings',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-image-validation-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');const packageFile=path.join(folder,'package.xml'),image=path.join(folder,'image.dat'),item=attrs=>`<packageDescription id="abcdefgh"><resources><image id="img" name="image.dat" path="/" ${attrs}/></resources></packageDescription>`;
  fs.writeFileSync(packageFile,item(''));fs.writeFileSync(image,'not an image');let report=await validate({project:root});assert.equal(report.valid,false);assert.ok(report.issues.some(i=>i.resource==='image.dat'));
  fs.writeFileSync(image,await encodePng({width:4,height:4,pixels:Buffer.alloc(64,255)}));report=await validate({project:root});assert.equal(report.valid,true);assert.ok(report.warnings.some(w=>w.warning.includes('extension .dat')));
  for(const attrs of ['scale="tile" scale9grid="1,1,2,2"','scale="bogus"','duplicatePadding="perhaps"']){fs.writeFileSync(packageFile,item(attrs));report=await validate({project:root});assert.equal(report.valid,false,attrs);}
  fs.writeFileSync(packageFile,item('scale="9grid" scale9grid="3,3,2,2"'));report=await validate({project:root});assert.equal(report.valid,true);assert.ok(report.warnings.some(w=>w.warning.includes('beyond image dimensions')));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('validation reports broken resources, controller pages and malformed packages', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-validation-'));
  try {
    const folder=path.join(root,'assets','Demo'); fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(root,'demo.fairy'),'<projectDescription/>');
    fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="a" name="Main.xml" path="/"/></resources></packageDescription>');
    const file=path.join(folder,'Main.xml');
    fs.writeFileSync(file,'<component><controller name="state" pages="0,off"/><displayList><image id="n1" src="missing"><gearDisplay controller="state" pages="1"/></image></displayList></component>');
    const report=await validate({project:root});
    assert.equal(report.valid,false);
    assert.ok(report.issues.some(i=>i.error.includes('unknown resource missing')));
    assert.ok(report.issues.some(i=>i.error.includes('unknown page 1')));
    const result=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'validate',arguments:{project:root}}});
    assert.equal(JSON.parse(result.result.content[0].text).data.valid,false);
    fs.writeFileSync(file,'<component><displayList><text id="n1" xy="0,0"/></displayList></component>');
    assert.equal((await validate({project:root})).valid,true);
    fs.writeFileSync(file,'<component><displayList><graph id="g" size="10,10" type="rect"/></displayList></component>');assert.ok((await validate({project:root})).issues.some(i=>i.error.includes('missing or invalid xy')));
    fs.writeFileSync(file,'<component><displayList><group id="group" xy="0,0"><text id="nested" xy="0,0"/></group></displayList></component>');assert.ok((await validate({project:root})).issues.some(i=>i.error.includes('group cannot contain nested display objects')));
    fs.writeFileSync(file,'<component><displayList><image id="missing_src" xy="0,0"/></displayList></component>');assert.ok((await validate({project:root})).issues.some(i=>i.error.includes('requires a registered resource ID')));
    fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><sound id="s" name="broken.mp3" path="/"/></resources></packageDescription>');
    fs.writeFileSync(path.join(folder,'broken.mp3'),'bad');
    assert.equal((await validate({project:root})).valid,true);
    const media=await validate({project:root,check_media:true});
    assert.equal(media.valid,false);
    assert.ok(media.issues.some(i=>i.resource==='broken.mp3'));
    fs.writeFileSync(path.join(folder,'package.xml'),'<broken');
    assert.equal((await validate({project:root})).valid,false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('validation reports invalid advanced group layout and bounds',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-group-validation-'));try{const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources></packageDescription>');const file=path.join(folder,'Main.xml');
 for(const bad of ['layout="row"','advanced="yes"','excludeInvisibles="1"','autoSizeDisabled="bad"','lineGap="2147483648"','colGap="1.5"','mainGridIndex="32768"']){fs.writeFileSync(file,`<component size="10,10"><displayList><group id="g" xy="0,0" ${bad}/></displayList></component>`);const result=await validate({project:root});assert.ok(result.issues.some(issue=>issue.error.includes('invalid group')),bad)}
 fs.writeFileSync(file,'<component size="10,10"><displayList><group id="g" xy="0,0" advanced="true" layout="hz" lineGap="-4" colGap="5" excludeInvisibles="true" autoSizeDisabled="true" mainGridIndex="2"/></displayList></component>');assert.equal((await validate({project:root})).valid,true);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('validation rejects nested and self-referencing group membership',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-group-nesting-'));try{const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources></packageDescription>');const file=path.join(folder,'Main.xml');
 for(const target of ['g','other']){fs.writeFileSync(file,`<component size="10,10"><displayList><group id="g" xy="0,0" group="${target}"/><group id="other" xy="0,0"/></displayList></component>`);const result=await validate({project:root});assert.ok(result.issues.some(issue=>issue.error.includes('groups cannot belong to groups')),target);}
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('validation and writes reject unsupported list layout and scrolling values',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-invalid-list-enums-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources></packageDescription>');const file=path.join(folder,'Main.xml'),xml='<component size="100,100"><displayList><list id="l" xy="0,0" layout="flow_hz" selectionMode="single" overflow="scroll" scroll="vertical" scrollBar="auto" renderOrder="ascent"/></displayList></component>';fs.writeFileSync(file,xml);assert.equal((await validate({project:root})).valid,true);
  const {execute}=await import('./project.mjs'),{writeComponent}=await import('./write.mjs'),args={project:root,pkg:'Demo',name:'Main'},sha=execute('read_component',args).sha256;
  for(const [from,to,field] of [['layout="flow_hz"','layout="flow"','layout'],['selectionMode="single"','selectionMode="other"','selectionMode'],['overflow="scroll"','overflow="clip"','overflow'],['scroll="vertical"','scroll="diagonal"','scroll'],['scrollBar="auto"','scrollBar="always"','scrollBar'],['renderOrder="ascent"','renderOrder="reverse"','renderOrder']]){const invalid=xml.replace(from,to);assert.throws(()=>writeComponent({...args,xml:invalid,expected_sha256:sha}),new RegExp('invalid list '+field));assert.equal(fs.readFileSync(file,'utf8'),xml);fs.writeFileSync(file,invalid);const report=await validate({project:root});assert.ok(report.issues.some(issue=>issue.error.includes('invalid list '+field)),field);fs.writeFileSync(file,xml);}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
