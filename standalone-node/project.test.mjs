import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execute,parse } from './project.mjs';
import {DOMParser} from '@xmldom/xmldom';
import { writeComponent, setPropertiesBatch, setComponentProperties, editController, editObject, createComponent, setImageOptions, importResource, unregisterResource } from './write.mjs';
import sharp from 'sharp';
import { validate } from './validate.mjs';
import { preflightPublish } from './preflight.mjs';
import { publishImages } from './publish-images.mjs';

test('mixed-case FairyGUI descriptors work for reads, validation and publication', {skip:process.platform!=='win32'}, async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-descriptor-case-'));
  try {
    const pkg=path.join(root,'assets','Demo');fs.mkdirSync(pkg,{recursive:true});fs.mkdirSync(path.join(root,'settings'));
    const descriptor=path.join(root,'Project.FAIRY');fs.writeFileSync(descriptor,'<projectDescription type="CocosCreator"/>');
    fs.writeFileSync(path.join(root,'settings','Publish.json'),'{"binaryFormat":true,"compressDesc":true}');
    fs.writeFileSync(path.join(pkg,'package.xml'),'<packageDescription id="abcdefgh"><resources><image id="img" name="one.png" path="/" exported="true"/></resources><publish name="Demo"/></packageDescription>');
    fs.writeFileSync(path.join(pkg,'one.png'),await sharp({create:{width:2,height:2,channels:4,background:'#ffffff'}}).png().toBuffer());
    for(const project of [root,descriptor]) {
      assert.equal(execute('project_info',{project}).projects.length,1);
      assert.equal((await validate({project})).valid,true);
      assert.equal((await preflightPublish({project})).valid,true);
      const result=await publishImages({project,pkg:'Demo',output:path.join(root,project===root?'out-directory':'out-file')});
      assert.ok(result.warnings.some(w=>w.setting==='compressDesc'));
    }
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('read project, package, component and children independently by project path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fgui-node-'));
  try {
    const pkg = path.join(root, 'assets', 'Demo'); fs.mkdirSync(pkg, {recursive:true});
    fs.writeFileSync(path.join(root, 'demo.fairy'), '<projectDescription id="p"/>');
    fs.writeFileSync(path.join(pkg, 'package.xml'), '<packageDescription id="abcdefgh"><resources><component id="abc" name="Main.xml" path="/"/></resources></packageDescription>');
    fs.writeFileSync(path.join(pkg, 'Main.xml'), '<component><controller name="state" pages="0,off,1,on"/><displayList><text id="n1" text="测试"><gearText controller="state"/></text></displayList></component>');
    assert.equal(execute('project_info', {project:root}).package_count, 1);
    assert.equal(execute('list_packages', {project:root})[0].id, 'abcdefgh');
    assert.equal(execute('list_items', {project:root,pkg:'abcdefgh'})[0].name, 'Main.xml');
    const args = {project:root,pkg:'Demo',name:'Main'};
    assert.equal(execute('list_children', args).children[0].attributes.text, '测试');
    assert.deepEqual(execute('list_controllers', args).controllers[0].pages, [{id:'0',name:'off'},{id:'1',name:'on'}]);
    assert.equal(execute('read_component', args).sha256, execute('list_children', args).sha256);
    fs.writeFileSync(path.join(pkg, 'Main.xml'), '<!DOCTYPE x [<!ENTITY y "x">]><component/>');
    assert.match(execute('read_component', args).xml, /DOCTYPE/);
    assert.throws(() => execute('list_children', args), /DTD/);
    fs.writeFileSync(path.join(pkg, 'package.xml'), Buffer.concat([Buffer.from([255,254]),Buffer.from('<!DOCTYPE x><packageDescription/>','utf16le')]));
    assert.throws(() => execute('list_packages', {project:root}), /DTD/);
    fs.writeFileSync(path.join(pkg, 'package.xml'), Buffer.from([0x3c,0xff,0x3e]));
    assert.throws(() => execute('list_packages', {project:root}), /encoding/);
  } finally { fs.rmSync(root, {recursive:true,force:true}); }
});

test('UTF-16 package metadata edits retain resources and write valid UTF-8 declarations', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fgui-node-package-utf16-'));
  try {
    const pkg = path.join(root, 'assets', 'Demo'); fs.mkdirSync(pkg, {recursive:true});
    fs.writeFileSync(path.join(root, 'demo.fairy'), '<projectDescription/>');
    const png = await sharp({create:{width:2,height:2,channels:4,background:'#ffffff'}}).png().toBuffer();
    fs.writeFileSync(path.join(pkg, 'existing.png'), png);
    const source = path.join(root, 'new.png'); fs.writeFileSync(source, png);
    const packageXml = '<?xml version="1.0" encoding="utf-16"?><packageDescription id="abcdefgh"><resources><image id="img" name="existing.png" path="/"/></resources><publish name="Demo"/></packageDescription>';
    const args = {project:root,pkg:'Demo'};
    for (const encoding of ['le','be']) {
      const encode = text => {const bytes=Buffer.from(text,'utf16le');return encoding==='le'?Buffer.concat([Buffer.from([0xff,0xfe]),bytes]):Buffer.concat([Buffer.from([0xfe,0xff]),bytes.swap16()]);};
      const operations = [
        () => createComponent({...args,name:`Created_${encoding}`,width:10,height:10}),
        digest => setImageOptions({...args,item:'img',props:{exported:true},expected_sha256:digest}),
        () => importResource({...args,source,name:`Imported_${encoding}.png`},'image'),
        digest => unregisterResource({...args,item:'img',expected_sha256:digest})
      ];
      for (const operation of operations) {
        fs.writeFileSync(path.join(pkg,'package.xml'),encode(packageXml));
        const before=execute('read_package',args);
        await operation(before.sha256);
        const after=execute('read_package',args);
        assert.match(after.xml,/encoding="utf-8"/);
        assert.notEqual(after.sha256,before.sha256);
        assert.ok(fs.existsSync(path.join(pkg,'existing.png')));
      }
    }
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('read UTF-16 package and component XML while hashing the original bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fgui-node-utf16-'));
  try {
    const pkg = path.join(root, 'assets', 'Demo'); fs.mkdirSync(pkg, {recursive:true});
    fs.writeFileSync(path.join(root, 'demo.fairy'), '<projectDescription/>');
    const packageXml = '<packageDescription id="abcdefgh"><resources><component id="abc" name="Main.xml" path="/"/></resources></packageDescription>';
    const componentXml = '<?xml version="1.0" encoding="utf-16"?><component><displayList><text id="n1" text="测试"/></displayList></component>';
    for (const encoding of ['le', 'be']) {
      const encode = text => {
        const bytes = Buffer.from(text, 'utf16le');
        return encoding === 'le' ? Buffer.concat([Buffer.from([0xff, 0xfe]), bytes]) : Buffer.concat([Buffer.from([0xfe, 0xff]), bytes.swap16()]);
      };
      fs.writeFileSync(path.join(pkg, 'package.xml'), encode(packageXml));
      fs.writeFileSync(path.join(pkg, 'Main.xml'), encode(componentXml));
      const args = {project:root,pkg:'Demo',name:'Main'};
      assert.equal(execute('read_package', args).xml, packageXml);
      const component = execute('read_component', args);
      assert.equal(component.xml, componentXml);
      assert.equal(component.sha256, execute('list_children', args).sha256);
      assert.equal(execute('list_children', args).children[0].attributes.text, '测试');
      writeComponent({...args, xml:component.xml, expected_sha256:component.sha256});
      assert.equal(execute('read_component', args).xml, componentXml.replace('utf-16', 'utf-8'));
      const operations = [
        digest => setPropertiesBatch({...args, expected_sha256:digest, changes:[{target:'n1',props:{text:'修改'}},{target:'n1',props:{xy:'12,34'}}]}),
        digest => setComponentProperties({...args, expected_sha256:digest, props:{size:'100,200'}}),
        digest => editController({...args, expected_sha256:digest, controller:'state', pages:[{id:'p0',name:'正常'}]}, true),
        digest => editObject({...args, expected_sha256:digest, object_xml:'<text id="n2" xy="0,0" text="新增"/>'}, 'insert_object')
      ];
      for (const operation of operations) {
        fs.writeFileSync(path.join(pkg, 'Main.xml'), encode(componentXml));
        const before = execute('read_component', args);
        operation(before.sha256);
        const after = execute('read_component', args);
        assert.match(after.xml, /encoding="utf-8"/);
        assert.match(after.xml, /测试|修改/);
        assert.notEqual(after.sha256, before.sha256);
      }
    }
  } finally { fs.rmSync(root, {recursive:true,force:true}); }
});


test('package listing cache uses exact file bytes and returns independent records',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-list-cache-'));try{const dir=path.join(root,'assets','Demo');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');const file=path.join(dir,'package.xml'),original='<packageDescription id="aaaaaaaa"><resources/></packageDescription>';fs.writeFileSync(file,original);const stamp=fs.statSync(file).mtime;let count=0;const parse=DOMParser.prototype.parseFromString;DOMParser.prototype.parseFromString=function(...args){count++;return parse.apply(this,args)};try{const first=execute('list_packages',{project:root});first[0].id='changed';assert.equal(execute('list_packages',{project:root})[0].id,'aaaaaaaa');assert.equal(count,1);}finally{DOMParser.prototype.parseFromString=parse;}fs.writeFileSync(file,original.replace('aaaaaaaa','bbbbbbbb'));fs.utimesSync(file,stamp,stamp);assert.equal(execute('list_packages',{project:root})[0].id,'bbbbbbbb');assert.equal(execute('project_info',{project:root}).package_count,1);fs.writeFileSync(file,'<broken');assert.throws(()=>execute('list_packages',{project:root}));assert.throws(()=>execute('project_info',{project:root}));fs.writeFileSync(file,original);assert.equal(execute('list_packages',{project:root})[0].id,'aaaaaaaa');}finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('project_info respects an explicitly selected descriptor',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-info-descriptor-'));
 try{fs.mkdirSync(path.join(root,'assets'));const selected=path.join(root,'selected.fairy');fs.writeFileSync(selected,'<projectDescription type="CocosCreator"/>');fs.writeFileSync(path.join(root,'broken.fairy'),'<broken');const info=execute('project_info',{project:selected});assert.equal(info.projects.length,1);assert.equal(info.projects[0].file,selected);assert.equal(info.projects[0].attributes.type,'CocosCreator');assert.throws(()=>execute('project_info',{project:root}));}finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('project_info resolves descriptor symbolic links',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-info-link-'));
 try{fs.mkdirSync(path.join(root,'assets'));const selected=path.join(root,'selected.fairy'),alias=path.join(root,'alias.fairy');fs.writeFileSync(selected,'<projectDescription type="CocosCreator"/>');try{fs.symlinkSync(selected,alias,'file');}catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('file symbolic links unavailable');return;}throw error;}const info=execute('project_info',{project:alias});assert.equal(info.projects.length,1);assert.equal(info.projects[0].file,selected);}finally{fs.rmSync(root,{recursive:true,force:true});}
});


test('XML 1.0 parsing preserves Unicode line and paragraph separators',()=>{
 const source='<component><displayList><text id="t" xy="0,0" text="A\u0085B\u2028C\u2029D"/></displayList></component>',node=parse(Buffer.from(source),'component');
 assert.equal(node.getElementsByTagName('text')[0].getAttribute('text'),'A\u0085B\u2028C\u2029D');
 const xml11=parse(Buffer.from('<?xml version="1.1"?><text value="A\u2028B"/>'),'xml11');assert.equal(xml11.getAttribute('value'),'A B');
});

test('XML parsing rejects forbidden characters and accepts valid XML 1.1 references',()=>{
 for(const control of ['\u0000','\u0001','\u000b','\u000c','\u001f','\ufffe','\uffff'])assert.throws(()=>parse(Buffer.from(`<component value="A${control}B"/>`),'test'),/invalid XML character/);
 for(const reference of ['&#0;','&#1;','&#xB;','&#xFFFE;'])assert.throws(()=>parse(Buffer.from(`<component value="A${reference}B"/>`),'test'),/invalid XML/);
 assert.equal(parse(Buffer.from('<?xml version="1.1"?><component value="A&#1;B"/>'),'test').getAttribute('value'),'A\u0001B');
 assert.throws(()=>parse(Buffer.from('<?xml version="1.1"?><component value="A\u0001B"/>'),'test'),/invalid XML character/);
 assert.equal(parse(Buffer.from('<component value="A\u0085B\u2028C😀"/>'),'test').getAttribute('value'),'A\u0085B\u2028C😀');
});

test('component writes reject XML-forbidden control characters without changing files',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-invalid-xml-char-'));try{
  const dir=path.join(root,'assets','Demo');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(dir,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources></packageDescription>');const file=path.join(dir,'Main.xml'),xml='<component size="20,20"><displayList><text id="t" xy="0,0" text="Hello"/></displayList></component>';fs.writeFileSync(file,xml);const args={project:root,pkg:'Demo',name:'Main'},sha=execute('read_component',args).sha256;
  for(const value of ['Hello\u0001World','Hello&#1;World']){assert.throws(()=>writeComponent({...args,xml:xml.replace('Hello',value),expected_sha256:sha}),/invalid XML character/);assert.equal(fs.readFileSync(file,'utf8'),xml);}
  fs.writeFileSync(file,xml.replace('Hello','Hello&#1;World'));const report=await validate({project:root});assert.equal(report.valid,false);assert.ok(report.issues.some(issue=>issue.error.includes('invalid XML character')));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
