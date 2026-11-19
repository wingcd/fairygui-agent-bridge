import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {parse,children,attr} from './project.mjs';
import {previewStaticGroup} from './publish-images.mjs';

test('static group preview follows the Cocos layout algorithm', {skip:!process.env.FGUI_SAMPLE_PROJECT},()=>{
 const build=process.env.FGUI_COCOS_BUILD||path.resolve(process.env.FGUI_SAMPLE_PROJECT,'../../source/build');
 const source=fs.readFileSync(path.join(build,'GGroup.js'),'utf8');
 const begin=source.indexOf('    handleLayout() {'),end=source.indexOf('    moveChildren(',begin);
 assert.ok(begin>=0&&end>begin,'Cocos group layout method not found');
 const Group=vm.runInNewContext('class Group {'+source.slice(begin,end)+'}; Group',{GroupLayoutType:{Horizontal:1,Vertical:2}});
 for(const [layout,axis] of [['hz','x'],['vt','y']]){
  const xml=`<component><displayList><group id="g" xy="10,20" layout="${layout}" colGap="-2" lineGap="3"/><graph id="a" group="g" xy="80,40" size="8,10"/><graph id="b" group="g" xy="30,80" size="0,0"/><graph id="c" group="g" xy="0,0" size="4,6"/></displayList></component>`;
  const node=parse(Buffer.from(xml),'fixture'),objects=children(children(node,'displayList')[0]),group=objects[0];
  const cocos=new Group();Object.assign(cocos,{_updating:0,_layout:layout==='hz'?1:2,_excludeInvisibles:false,_columnGap:-2,_lineGap:3,x:10,y:20});
  const members=objects.slice(1).map(n=>{const [x,y]=attr(n,'xy').split(',').map(Number),[width,height]=attr(n,'size').split(',').map(Number);return {group:cocos,xMin:x,yMin:y,width,height};});
  cocos._parent={numChildren:members.length,getChildAt:i=>members[i]};cocos.handleLayout();
  assert.equal(previewStaticGroup(node,group,true),true);
  for(let i=0;i<members.length;i++)assert.equal(Number(attr(objects[i+1],'xy').split(',')[axis==='x'?0:1]),members[i][axis+'Min']);
 }
});

test('PIXI group preview refuses relations targeting a group',()=>{
 const node=parse(Buffer.from('<component><displayList><group id="g" xy="0,0" layout="hz"/><graph id="a" group="g" xy="0,0" size="10,10"/><graph id="b" xy="20,0" size="10,10"><relation target="g" sidePair="left-left"/></graph></displayList></component>'),'fixture');
 const group=children(children(node,'displayList')[0])[0];
 assert.equal(previewStaticGroup(node,group),false);
});
