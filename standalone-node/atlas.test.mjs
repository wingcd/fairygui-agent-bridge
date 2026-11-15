import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { pack, plan, planGrouped, render } from './atlas.mjs';

test('native atlas layouts match the Python implementation on deterministic varied inputs', () => {
  let state = 91345;
  const random = n => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return Math.floor(state / 4294967296 * n); };
  const cases = [];
  for (let c = 0; c < 120; c++) {
    const images = Array.from({ length: random(25) }, (_, i) => ({ id: `图${i}`, width: 1 + random(28), height: 1 + random(28) }));
    const options = { width: 64, height: 64, padding: random(3), shrink: Boolean(random(2)), optimize: Boolean(random(2)), rotatable: images.filter(() => random(2)).map(i => i.id) };
    cases.push({ images, options });
  }
  const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../standalone');
  const script = 'import sys,json\nfrom atlas import plan\na=json.load(sys.stdin)\nprint(json.dumps([plan(c["images"],**c["options"]) for c in a],ensure_ascii=False))';
  const run = spawnSync(process.env.PYTHON || 'python', ['-c', script], { cwd: directory, input: JSON.stringify(cases), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr);
  const expected = JSON.parse(run.stdout);
  cases.forEach(({ images, options }, i) => assert.deepEqual(plan(images, options), expected[i], `case ${i}`));
});

test('native layout rejects invalid dimensions and duplicate ids', () => {
  assert.throws(() => pack([{ id: 'a', width: 1, height: 1 }, { id: 'a', width: 2, height: 2 }]), /unique/);
  assert.throws(() => pack([{ id: 'a', width: 65, height: 1 }], { width: 64, height: 64 }), /exceeds/);
});

test('grouped packing matches Python with overlapping groups and rotation', () => {
  const images = [{id:'a',width:7,height:4}, {id:'b',width:5,height:8}, {id:'c',width:3,height:6}, {id:'d',width:4,height:4}];
  const groups = [['a', 'b'], ['b', 'c']];
  const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../standalone');
  const script = 'import sys,json\nfrom atlas import plan_grouped\na=json.load(sys.stdin)\nprint(json.dumps(plan_grouped(a["images"],a["groups"],32,32,1,True,rotatable=["a","b"])))';
  const run = spawnSync(process.env.PYTHON || 'python', ['-c', script], { cwd: directory, input: JSON.stringify({images, groups}), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(planGrouped(images, groups, {width:32,height:32,padding:1,shrink:true,rotatable:['a','b']}), JSON.parse(run.stdout));
  assert.throws(() => planGrouped(images, [['missing']]), /unknown image/);
});

test('rendered atlas pixels match Python including rotation and transparent RGB', () => {
  const source = {width:3,height:2,pixels:Buffer.from([1,2,3,0, 4,5,6,10, 7,8,9,255, 11,12,13,128, 14,15,16,1, 17,18,19,250])};
  const pages = [{width:8,height:7,items:[{id:'a',x:2,y:1,width:3,height:2,rotated:true}]}];
  const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../standalone');
  const script = 'import sys,json\nfrom PIL import Image\nfrom atlas import render\na=json.load(sys.stdin)\ns=Image.frombytes("RGBA",(3,2),bytes(a["pixels"]))\np=render(a["pages"],{"a":s},{"a"},1)[0]\nprint(p.tobytes().hex())';
  const run = spawnSync(process.env.PYTHON || 'python',['-c',script],{cwd:directory,input:JSON.stringify({pages,pixels:[...source.pixels]}),encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  assert.equal(render(pages,{a:source},{duplicatePadding:['a'],padding:1})[0].pixels.toString('hex'),run.stdout.trim());
});


test('rotated atlas sprites retain their original orientation when decoded',()=>{
 const src={width:3,height:2,pixels:Buffer.from([255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,0,255, 0,255,255,255, 255,0,255,255])},item={id:'a',x:1,y:1,width:3,height:2,rotated:true},page={width:4,height:5,items:[item]};const atlas=render([page],{a:src})[0];const get=(x,y)=>[...atlas.pixels.subarray((y*atlas.width+x)*4,(y*atlas.width+x)*4+4)];assert.deepEqual(get(1,1),[255,255,0,255]);assert.deepEqual(get(2,1),[255,0,0,255]);assert.deepEqual(get(1,3),[255,0,255,255]);assert.deepEqual(get(2,3),[0,0,255,255]);for(let y=0;y<src.height;y++)for(let x=0;x<src.width;x++){const from=(y*src.width+x)*4;assert.deepEqual(get(item.x+src.height-1-y,item.y+x),[...src.pixels.subarray(from,from+4)]);}
});
