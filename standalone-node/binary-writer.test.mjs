import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {encodeImagePackage} from './binary-writer.mjs';
import {inspectImagePackage} from './image-package-reader.mjs';

test('component reader accepts an empty final instance section but rejects out-of-bounds offsets',()=>{
 const components=[{id:'main',name:'Main',width:20,height:20,children:[{type:'component',id:'nested',src:'other',x:0,y:0,button:{title:'Test'}}]}],data=encodeImagePackage('abcdefgh','Demo',[],[],{components});
 const base=9+2+8+2+4+20,items=base+data.readInt32BE(base+6),record=items+2+4,raw=record+23,childList=raw+data.readInt32BE(raw+10),childSize=data.readInt16BE(childList+2),child=childList+4;
 assert.equal(data[child],7);assert.ok(inspectImagePackage(data).items[0].component.children[0].buttonInstance);const empty=Buffer.from(data);empty.writeInt32BE(childSize,child+26);assert.equal(inspectImagePackage(empty).items[0].component.children[0].buttonInstance,undefined);const invalid=Buffer.from(data);invalid.writeInt32BE(childSize+1,child+26);assert.throws(()=>inspectImagePackage(invalid),/invalid component instance section/);
});

test('basic component records match Python in both binary versions', () => {
  const images=[{id:'img',name:'picture',width:8,height:8}],pages=[{width:16,height:16,items:[{id:'img',x:1,y:1,width:8,height:8}]}];
  const components=[{id:'comp',name:'Main',width:120,height:80,exported:true,pivot:[0.5,0.5],margin:[1,2,3,4],overflow:1,settings:{opaque:false,mask:0,reversedMask:true,hitTestChild:1},relations:[{target:0,types:[14,15]}],controllers:[{name:'state',pages:[['p0','normal'],['p1','active']]}],children:[{id:'n1',name:'image',src:'img',x:3,y:-4,imageColor:[17,34,51,255],groupIndex:9,flip:2,fillMethod:5,fillClockwise:false,fillAmount:0.25,size:[10,12],constraints:[1,50,2,60],scale:[1.5,0.5],pivot:[0.5,0.3],anchor:true,alpha:0.7,rotation:45,visible:false,touchable:false,grayed:true,relations:[{target:-1,types:[0,7]}],gears:[{type:'display',controllerIndex:0,pages:['p0','p1']},{type:'display2',controllerIndex:0,pages:['p1'],condition:1},{type:'xy',controllerIndex:0,pages:['p0','p1'],values:[[1,2],null],default:[5,6],tween:{ease:5,duration:0.3,delay:0.1}},{type:'size',controllerIndex:0,pages:['p0'],values:[[20,30,1,1]],default:[10,10,2,2]},{type:'look',controllerIndex:0,pages:['p1'],values:[[0.5,45,1,0]]},{type:'color',controllerIndex:0,pages:['p0','p1'],values:[[[255,0,0,255],[0,0,0,255]],null],default:[[1,2,3,255],[4,5,6,255]]}]},{type:'text',id:'n2',name:'title',x:2,y:3,text:'你好',font:'Arial',fontSize:22,color:[4,5,6,255],bold:true,strokeColor:[1,2,3,255],shadowColor:[9,8,7,255],shadowOffset:[2,-1],gears:[{type:'text',controllerIndex:0,pages:['p0','p1'],values:['hello','world'],default:'default'},{type:'fontSize',controllerIndex:0,pages:['p0','p1'],values:[12,null],default:20}]},{type:'richtext',id:'n3',name:'rich',x:0,y:0,text:'[b]Hi[/b]',ubb:true},{type:'inputtext',id:'n4',name:'input',x:4,y:5,text:'test',font:'Arial',input:{prompt:'enter',restrict:'a-z',maxLength:10,keyboardType:2,password:true}},{type:'component',id:'n5',name:'nested',src:'empty',x:0,y:0,button:{title:'OK',selectedTitle:'Yes',controller:0,page:'p0',checked:true,color:[10,20,30,255],fontSize:13}},{type:'movieclip',id:'n6',name:'clip',src:'movie',x:1,y:2,imageColor:[3,4,5,255],frame:3,playing:false,gears:[{type:'animation',controllerIndex:0,pages:['p0','p1'],values:[{frame:3,playing:true},null],default:{frame:2,playing:false}}]},{type:'graph',id:'g1',name:'rect',x:0,y:0,graphType:1,lineSize:2,lineColor:[10,20,30,40],fillColor:[1,2,3,4],cornerRadius:[2,2,2,2]},{type:'graph',id:'g2',name:'polygon',x:0,y:0,graphType:3,points:[0,0,10,0,5,6]},{type:'graph',id:'g3',name:'regular',x:0,y:0,graphType:4,sides:3,startAngle:5,distances:[1,2,3]},{type:'group',id:'grp',name:'group',x:0,y:0},{type:'loader',id:'load',name:'loader',x:1,y:2,url:'https://example.com/a.png',align:1,vAlign:2,fill:4,imageColor:[1,2,3,255],fillMethod:3,fillClockwise:false,fillAmount:0.5}]},{id:'empty',name:'Empty',width:10,height:20,children:[],extension:12,buttonMode:1,buttonSound:'ui://abcdefghsound',buttonEffect:2,buttonEffectValue:0.75},{id:'progress',name:'Progress',width:10,height:20,children:[],extension:14,titleType:2,reverse:true},{id:'slider',name:'Slider',width:10,height:20,children:[],extension:15},{id:'combo',name:'Combo',width:10,height:20,children:[],extension:13,comboDropdown:'ui://abcdefghcomp'},{id:'label',name:'Label',width:10,height:20,children:[],extension:11},{id:'scroll',name:'Scroll',width:10,height:20,children:[],extension:16}];
  const cwd=resolve(dirname(fileURLToPath(import.meta.url)),'../standalone');
  const script='import json,sys\nfrom binary_writer import encode_image_package\na=json.load(sys.stdin)\nprint(encode_image_package("abcdefgh","Demo",a["images"],a["pages"],components=a["components"],sprite_trim=a["trim"]).hex())';
  for(const [trim,display2] of [[{},false],[{},true],[{img:[0,0,8,8]},true]]) {
    const selected=structuredClone(components);if(!display2)selected[0].children[0].gears=selected[0].children[0].gears.filter(g=>g.type!=='display2');
    const run=spawnSync(process.env.PYTHON||'python',['-c',script],{cwd,input:JSON.stringify({images,pages,components:selected,trim}),encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}});
    assert.equal(run.status,0,run.stderr);
    const result=encodeImagePackage('abcdefgh','Demo',images,pages,{components:selected,spriteTrim:trim});
    assert.equal(result.toString('hex'),run.stdout.trim());
    assert.equal(inspectImagePackage(result).items.filter(i=>i.type===3)[0].component.childCount,11);
  }
});

test('image package encoding is byte-for-byte equal to Python for v1 and v2', () => {
  const images=[{id:'img01',name:'图像',width:8,height:8,exported:true,scale9grid:[1,1,3,3]},{id:'img02',name:'tile',width:4,height:6,scaleByTile:true}];
  const pages=[{width:32,height:32,items:[{id:'img01',x:1,y:1,width:8,height:8},{id:'img02',x:10,y:1,width:4,height:6,rotated:true}]}];
  const cwd=resolve(dirname(fileURLToPath(import.meta.url)),'../standalone');
  const sounds=[{id:'snd01',name:'sound',file:'snd01.ogg',exported:true}];
  for(const spriteTrim of [{},{img01:[0,0,8,8]}]) {
    const script='import sys,json\nfrom binary_writer import encode_image_package\na=json.load(sys.stdin)\nprint(encode_image_package("abcdefgh","测试",a["images"],a["pages"],sounds=a["sounds"],sprite_trim=a["trim"]).hex())';
    const result=spawnSync(process.env.PYTHON||'python',['-c',script],{cwd,input:JSON.stringify({images,pages,trim:spriteTrim,sounds}),env:{...process.env,PYTHONIOENCODING:'utf-8'},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    assert.equal(encodeImagePackage('abcdefgh','测试',images,pages,{spriteTrim,sounds}).toString('hex'),result.stdout.trim());
    const data=encodeImagePackage('abcdefgh','测试',images,pages,{spriteTrim,sounds}), parsed=inspectImagePackage(data);
    assert.equal(parsed.items.length,4);
    assert.equal(parsed.sprites.length,2);
    assert.equal(parsed.id,'abcdefgh');
    assert.throws(()=>inspectImagePackage(data.subarray(0,30)));
  }
  assert.throws(()=>encodeImagePackage('abcdefgh','p',images,[]),/layout ids/);
});

test('movieclip frame records match Python binary layout', () => {
  const movieclips=[{id:'clip',name:'run',width:10,height:12,interval:41,exported:true,frames:[{id:'clip_0',width:3,height:4,rect:[1,2,3,4],delay:83},{id:'clip_1',width:2,height:5,rect:[0,1,2,5],delay:41}]}];
  const pages=[{width:16,height:16,items:[{id:'clip_0',x:1,y:1,width:3,height:4},{id:'clip_1',x:5,y:1,width:2,height:5}]}];
  const cwd=resolve(dirname(fileURLToPath(import.meta.url)),'../standalone');
  const script='import json,sys\nfrom binary_writer import encode_image_package\na=json.load(sys.stdin)\nprint(encode_image_package("abcdefgh","demo",[],a["pages"],movieclips=a["movieclips"]).hex())';
  const run=spawnSync(process.env.PYTHON||'python',['-c',script],{cwd,input:JSON.stringify({pages,movieclips}),encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  assert.equal(encodeImagePackage('abcdefgh','demo',[],pages,{movieclips}).toString('hex'),run.stdout.trim());
});

test('bitmap font records and texture sprite match Python binary layout', () => {
  const images=[{id:'texture',name:'atlas',width:8,height:8}],pages=[{width:16,height:16,items:[{id:'texture',x:1,y:1,width:8,height:8}]}];
  const fonts=[{id:'font01',name:'font',ttf:true,texture:'texture',canTint:true,resizable:false,hasChannel:false,fontSize:12,xAdvance:0,lineHeight:14,glyphs:[{id:65,image:null,x:1,y:1,xOffset:0,yOffset:2,width:3,height:4,xAdvance:5,channel:0}]}];
  const cwd=resolve(dirname(fileURLToPath(import.meta.url)),'../standalone');
  const script='import json,sys\nfrom binary_writer import encode_image_package\na=json.load(sys.stdin)\nprint(encode_image_package("abcdefgh","demo",a["images"],a["pages"],fonts=a["fonts"]).hex())';
  const run=spawnSync(process.env.PYTHON||'python',['-c',script],{cwd,input:JSON.stringify({images,pages,fonts}),encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  assert.equal(encodeImagePackage('abcdefgh','demo',images,pages,{fonts}).toString('hex'),run.stdout.trim());
});

test('list, tree and transition records match Python in both binary versions', () => {
  const list={layout:2,selectionMode:1,align:1,vAlign:2,lineGap:3,colGap:4,lineCount:2,colCount:3,autoItemSize:false,margin:[1,2,3,4],clipSoftness:[2,3],overflow:2,pageController:0,selectionController:0,scroll:{type:1,barDisplay:2,flags:3,barMargin:[1,2,3,4],resources:[null,null,null,null]},defaultItem:'ui://abcdefghsub',items:[{title:'One',icon:'ui://abcdefghimg',level:0,folder:true},{title:'Two',level:1,folder:false}]};
  const components=[{id:'main',name:'Main',width:100,height:100,controllers:[{name:'state',pages:[['p0','normal']]}],children:[{type:'list',id:'l',x:0,y:0,list},{type:'tree',id:'t',x:0,y:0,list:{...list,indent:20,clickToExpand:1}}],transitions:[{name:'intro',options:2,autoPlay:true,autoPlayTimes:1,items:[{type:0,time:0,target:0,label:null,tween:{duration:1,ease:2,repeat:0,yoyo:false,endLabel:null,start:{flags:[false,true],values:[0,2]},end:{flags:[true,true],values:[20,30]}}},{type:8,time:0.5,target:1,label:'hide',value:false},{type:14,time:1,target:0,label:null,value:'hello'}]}]}];
  const cwd=resolve(dirname(fileURLToPath(import.meta.url)),'../standalone');
  const script='import json,sys\nfrom binary_writer import encode_image_package\na=json.load(sys.stdin)\nprint(encode_image_package("abcdefgh","Demo",[],[],components=a).hex())';
  for(const path of [false,true]){const selected=structuredClone(components);if(path)selected[0].transitions[0].items[0].tween.path=[{curve:2,points:[0,0,1,1,2,2]}];const run=spawnSync(process.env.PYTHON||'python',['-c',script],{cwd,input:JSON.stringify(selected),encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.equal(encodeImagePackage('abcdefgh','Demo',[],[],{components:selected}).toString('hex'),run.stdout.trim());}
});


test('nested component pivot-as-anchor preserves the editor position',()=>{
 const components=[{id:'main',name:'Main',width:750,height:1334,children:[{type:'component',id:'start',src:'button',x:375,y:1069,size:[383,147],pivot:[0.5,0.5],anchor:true}]},{id:'button',name:'Button',width:383,height:147,children:[]}];const data=inspectImagePackage(encodeImagePackage('abcdefgh','Demo',[],[],{components}));const child=data.items.find(item=>item.id==='main').component.children[0];assert.equal(child.x,375);assert.equal(child.y,1069);assert.deepEqual(child.size,[383,147]);assert.deepEqual(child.pivot,[0.5,0.5,true]);assert.equal(child.x-child.size[0]*child.pivot[0],183.5);assert.equal(child.y-child.size[1]*child.pivot[1],995.5);
});
