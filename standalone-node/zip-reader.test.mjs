import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readZip} from './zip-reader.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {encodePng} from './images.mjs';
import {validatePublished} from './published.mjs';

function stored(name,body){const filename=Buffer.from(name),payload=Buffer.from(body);let crc=0xffffffff;for(const b of payload){crc^=b;for(let i=0;i<8;i++)crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1;}crc=(crc^0xffffffff)>>>0;const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(payload.length,18);local.writeUInt32LE(payload.length,22);local.writeUInt16LE(filename.length,26);const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(payload.length,20);central.writeUInt32LE(payload.length,24);central.writeUInt16LE(filename.length,28);const localBytes=Buffer.concat([local,filename,payload]),directory=Buffer.concat([central,filename]),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(localBytes.length,16);return Buffer.concat([localBytes,directory,end]);}

test('XML ZIP reader bounds paths, sizes, checksums and local entries',()=>{
 const valid=stored('package.xml','<packageDescription/>');assert.equal(readZip(valid).get('package.xml').toString(),'<packageDescription/>');
 assert.throws(()=>readZip(stored('../escape.xml','bad')),/unsafe/);const corrupt=Buffer.from(valid);corrupt[30+Buffer.byteLength('package.xml')]^=1;assert.throws(()=>readZip(corrupt),/checksum/);
 const directoryOffset=valid.readUInt32LE(valid.length-6),huge=Buffer.from(valid);huge.writeUInt32LE(129*1024*1024,directoryOffset+24);assert.throws(()=>readZip(huge),/oversized/);
 const encrypted=Buffer.from(valid);encrypted.writeUInt16LE(1,directoryOffset+8);assert.throws(()=>readZip(encrypted),/unsupported/);
});

test('XML publication validation compares tile and nine-grid settings with the source',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-xml-scale-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');
  const image=await encodePng({width:4,height:4,pixels:Buffer.alloc(4*4*4,255)});fs.writeFileSync(path.join(folder,'image.png'),image);
  const file=path.join(root,'Demo.bin');fs.writeFileSync(path.join(root,'Demo@atlas0.png'),image);fs.writeFileSync(path.join(root,'Demo@sprites.bytes'),'//FairyGUI atlas sprites.\nimg 0 0 0 4 4 0\n');
  for(const setting of ['scale="tile"','scale="9grid" scale9grid="1,1,2,2"']){
   fs.writeFileSync(path.join(folder,'package.xml'),`<packageDescription id="abcdefgh"><resources><image id="img" name="image.png" path="/" ${setting}/></resources><publish name="Demo"/></packageDescription>`);
   const xml=`<packageDescription id="abcdefgh" name="Demo"><resources><image id="img" name="image" path="/" size="4,4" ${setting}/><atlas id="atlas0" size="4,4" file="atlas0.png"/></resources></packageDescription>`;
   fs.writeFileSync(file,stored('package.xml',xml));let report=await validatePublished({file,project:root,compare_source:true});assert.equal(report.valid,true,JSON.stringify(report));
   fs.writeFileSync(file,stored('package.xml',xml.replace(` ${setting}`,'')));report=await validatePublished({file,project:root,compare_source:true});assert.equal(report.valid,false);assert.ok(report.issues.some(i=>i.error.includes('scale settings differ')));
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
