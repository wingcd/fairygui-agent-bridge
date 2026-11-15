import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeImage, encodePng, makePixelMask } from './images.mjs';
import sharp from 'sharp';

test('raw pixel comparison can ignore embedded ICC color conversion',async()=>{
 const pixels=Buffer.from([0,243,249,255,230,10,50,255]);
 const profiled=await sharp(pixels,{raw:{width:2,height:1,channels:4}}).withIccProfile('p3').png().toBuffer();
 const unprofiled=await sharp(profiled,{ignoreIcc:true}).png().toBuffer();
 assert.equal((await sharp(profiled).metadata()).hasProfile,true);
 assert.deepEqual((await decodeImage(profiled,{ignoreIcc:true})).pixels,(await decodeImage(unprofiled,{ignoreIcc:true})).pixels);
 assert.notDeepEqual((await decodeImage(profiled)).pixels,(await decodeImage(profiled,{ignoreIcc:true})).pixels);
});

test('PNG round trip preserves RGBA and pixel masks match Python', async () => {
  const image = {width:5,height:3,pixels:Buffer.from(Array.from({length:60},(_,i) => (i*41)%256))};
  const decoded = await decodeImage(await encodePng(image));
  assert.deepEqual(decoded,image);
  const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '../standalone');
  const script = 'import json,sys\nfrom PIL import Image\nfrom pixel_hits import make_pixel_mask\na=json.load(sys.stdin)\ni=Image.frombytes("RGBA",(a["width"],a["height"]),bytes(a["pixels"]))\nfor d in (1,2):\n m=make_pixel_mask(i,d);print(m["pixels"].hex())';
  const result = spawnSync(process.env.PYTHON || 'python',['-c',script],{cwd,input:JSON.stringify({...image,pixels:[...image.pixels]}),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const expected = result.stdout.trim().split(/\r?\n/);
  assert.equal(makePixelMask(image,1).pixels.toString('hex'),expected[0]);
  assert.equal(makePixelMask(image,2).pixels.toString('hex'),expected[1]);
  await assert.rejects(decodeImage(Buffer.from('bad image')));
});
