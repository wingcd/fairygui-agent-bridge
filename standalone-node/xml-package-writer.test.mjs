import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeXmlImagePackage} from './xml-package-writer.mjs';
import {readZip} from './zip-reader.mjs';
import {parse,children,attr} from './project.mjs';
import {inspectXmlPackage} from './xml-package-reader.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('legacy XML package encodes movieclip frame descriptors and sprite references',()=>{
 const clip={id:'clip',name:'Spinner',width:20,height:30,interval:100,exported:true,frames:[{rect:[2,3,10,12],delay:25},{rect:[0,1,7,8],delay:0}]};
 const pages=[{width:64,height:64,items:[{id:'clip_0',x:0,y:0,width:10,height:12,rotated:false},{id:'clip_1',x:10,y:0,width:7,height:8,rotated:false}]}];
 const result=encodeXmlImagePackage('abcdefgh','Demo',[],pages,{},[],[],[clip]);
 const archive=readZip(result.blob),pkg=parse(archive.get('package.xml'),'package');
 const item=children(children(pkg,'resources')[0],'movieclip')[0];
 assert.equal(attr(item,'id'),'clip');assert.equal(attr(item,'size'),'20,30');
 const descriptor=parse(archive.get('clip.xml'),'movieclip');assert.equal(attr(descriptor,'interval'),'100');
 const frames=children(children(descriptor,'frames')[0],'frame');assert.deepEqual(frames.map(f=>[attr(f,'rect'),attr(f,'sprite'),attr(f,'addDelay')]),[['2,3,10,12','0','25'],['0,1,7,8','1','0']]);
 assert.match(result.sprites,/clip_0 0 0 0 10 12 0/);assert.match(result.sprites,/clip_1 0 10 0 7 8 0/);
});

test('XML inspection validates movieclip descriptors and frame sprite references',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-xml-clip-'));
 try{
  const file=path.join(dir,'Demo.fui'),clip={id:'clip',name:'Clip',width:20,height:20,interval:100,frames:[{rect:[0,0,10,10],delay:0}]};
  const pages=[{width:16,height:16,items:[{id:'clip_0',x:0,y:0,width:10,height:10,rotated:false}]}];
  const result=encodeXmlImagePackage('abcdefgh','Demo',[],pages,{},[],[],[clip]);await fs.writeFile(file,result.blob);await fs.writeFile(path.join(dir,'Demo@sprites.bytes'),result.sprites);
  const inspected=await inspectXmlPackage(file,result.blob);assert.deepEqual(inspected.items.find(i=>i.id==='clip').movieclip,{interval:100,frames:[{rect:[0,0,10,10],delay:0,sprite:'clip_0'}]});
  await fs.writeFile(path.join(dir,'Demo@sprites.bytes'),result.sprites.replace('10 10 0','9 10 0'));await assert.rejects(inspectXmlPackage(file,result.blob),/movieclip frame sprite size mismatch/);
  await fs.writeFile(path.join(dir,'Demo@sprites.bytes'),'// missing frame\n');await assert.rejects(inspectXmlPackage(file,result.blob),/movieclip frame sprite missing/);
  const missing=encodeXmlImagePackage('abcdefgh','Demo',[],pages,{},[],[],[]);const archive=readZip(missing.blob);assert.equal(archive.has('clip.xml'),false);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('XML inspection checks image-glyph font references',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-xml-font-'));
 try{
  const file=path.join(dir,'Demo.fui'),font={id:'font',name:'Font',ttf:false,fontSize:16,lineHeight:16,canTint:false,glyphs:[{id:65,image:'glyph',xOffset:0,yOffset:0,xAdvance:12}]};
  const images=[{id:'glyph',name:'Glyph',width:12,height:16}],pages=[{width:16,height:16,items:[{id:'glyph',x:0,y:0,width:12,height:16,rotated:false}]}];
  const valid=encodeXmlImagePackage('abcdefgh','Demo',images,pages,{},[],[],[],[font]);await fs.writeFile(path.join(dir,'Demo@sprites.bytes'),valid.sprites);
  const inspected=await inspectXmlPackage(file,valid.blob);assert.equal(inspected.items.find(i=>i.id==='font').font.glyphs[0].image,'glyph');
  const bad=encodeXmlImagePackage('abcdefgh','Demo',[],[],{},[],[],[],[font]);await fs.writeFile(path.join(dir,'Demo@sprites.bytes'),bad.sprites);await assert.rejects(inspectXmlPackage(file,bad.blob),/bitmap font glyph image missing/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('XML inspection checks atlas-font texture and glyph bounds',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-xml-atlas-font-'));try{
  const file=path.join(dir,'Demo.fui'),glyph={id:65,x:2,y:3,width:8,height:10,xOffset:0,yOffset:0,xAdvance:8,channel:15};
  const font={id:'font',name:'Font',ttf:true,texture:'tex',fontSize:16,lineHeight:16,canTint:true,glyphs:[glyph]};
  const image={id:'tex',name:'Texture',width:16,height:16},pages=[{width:16,height:16,items:[{id:'tex',x:0,y:0,width:16,height:16,rotated:false}]}];
  const valid=encodeXmlImagePackage('abcdefgh','Demo',[image],pages,{},[],[],[],[font]);await fs.writeFile(path.join(dir,'Demo@sprites.bytes'),valid.sprites);
  const inspected=await inspectXmlPackage(file,valid.blob);assert.equal(inspected.items.find(i=>i.id==='font').font.texture,'tex');
  const invalid=encodeXmlImagePackage('abcdefgh','Demo',[image],pages,{},[],[],[],[{...font,glyphs:[{...glyph,x:12}]}]);await assert.rejects(inspectXmlPackage(file,invalid.blob),/glyph outside texture/);
  const missing=encodeXmlImagePackage('abcdefgh','Demo',[],[],{},[],[],[],[font]);await fs.writeFile(path.join(dir,'Demo@sprites.bytes'),missing.sprites);await assert.rejects(inspectXmlPackage(file,missing.blob),/font texture missing/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
