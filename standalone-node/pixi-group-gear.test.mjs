import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {message} from './mcp.mjs';

test('PIXI group relayout follows size gears and size transitions',{skip:!process.env.FGUI_CHROME||process.platform!=='win32',timeout:90000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-group-gear-'));
 try{
  const dir=path.join(root,'assets','Demo');await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(root,'p.fairy'),'<projectDescription type="CocosCreator"/>');
  await fs.writeFile(path.join(dir,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/" exported="true"/></resources><publish name="Demo"/></packageDescription>');
  const xml='<component size="100,50"><controller name="state" pages="a,A,b,B"/><displayList><group id="g" xy="10,10" size="25,10" advanced="true" layout="hz" colGap="5"/><graph id="a" group="g" xy="10,10" size="10,10" type="rect" lineSize="0" fillColor="#ffff0000"><gearSize controller="state" pages="a,b" values="10,10|30,10"/></graph><graph id="b" group="g" xy="25,10" size="10,10" type="rect" lineSize="0" fillColor="#ff00ff00"/></displayList></component>';
  await fs.writeFile(path.join(dir,'Main.xml'),xml);
  for(const [page,greenX] of [['a',25],['b',45]]){
   const response=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'screenshot',arguments:{project:root,pkg:'Demo',name:'Main',width:100,height:50,settle_ms:0,controller_pages:{state:page}}}});
   assert.equal(response.result.isError,false,response.result.content[0].text);
   const pixels=await sharp(Buffer.from(response.result.content[1].data,'base64')).removeAlpha().raw().toBuffer();
   const pixel=x=>[...pixels.subarray((15*100+x)*3,(15*100+x)*3+3)];
   assert.deepEqual(pixel(greenX+2),[0,255,0]);
   if(page==='b')assert.deepEqual(pixel(27),[255,0,0]);
  }
  assert.equal(await fs.readFile(path.join(dir,'Main.xml'),'utf8'),xml);
  const vertical=xml.replace('size="100,50"','size="100,100"').replace('layout="hz" colGap="5"','layout="vt" lineGap="5"').replace('xy="25,10"','xy="10,25"').replace('10,10|30,10','10,10|10,30');
  await fs.writeFile(path.join(dir,'Main.xml'),vertical);
  const result=await message({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'screenshot',arguments:{project:root,pkg:'Demo',name:'Main',width:100,height:100,settle_ms:0,controller_pages:{state:'b'}}}});
  assert.equal(result.result.isError,false,result.result.content[0].text);
  const pixels=await sharp(Buffer.from(result.result.content[1].data,'base64')).removeAlpha().raw().toBuffer();
  assert.deepEqual([...pixels.subarray((47*100+15)*3,(47*100+15)*3+3)],[0,255,0]);
  const animated=xml.replace('<gearSize controller="state" pages="a,b" values="10,10|30,10"/>','').replace('</component>','<transition name="resize" autoPlay="true"><item time="0" type="Size" target="a" tween="false" value="30,10"/></transition></component>');
  await fs.writeFile(path.join(dir,'Main.xml'),animated);
  const frame=await message({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'screenshot',arguments:{project:root,pkg:'Demo',name:'Main',width:100,height:50,settle_ms:200}}});
  assert.equal(frame.result.isError,false,frame.result.content[0].text);
  const animationPixels=await sharp(Buffer.from(frame.result.content[1].data,'base64')).removeAlpha().raw().toBuffer();
  assert.deepEqual([...animationPixels.subarray((15*100+47)*3,(15*100+47)*3+3)],[0,255,0]);
  const tweened=animated.replace('tween="false" value="30,10"','tween="true" startValue="10,10" endValue="30,10" duration="4" ease="Linear"');
  await fs.writeFile(path.join(dir,'Main.xml'),tweened);
  const tweenFrame=await message({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'screenshot',arguments:{project:root,pkg:'Demo',name:'Main',width:100,height:50,settle_ms:700}}});
  assert.equal(tweenFrame.result.isError,false,tweenFrame.result.content[0].text);
  const tweenPixels=await sharp(Buffer.from(tweenFrame.result.content[1].data,'base64')).removeAlpha().raw().toBuffer();
  assert.deepEqual([...tweenPixels.subarray((15*100+47)*3,(15*100+47)*3+3)],[0,255,0]);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
