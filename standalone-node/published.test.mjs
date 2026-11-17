import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {encodePng,decodeImage} from './images.mjs';
import {publishImages} from './publish-images.mjs';
import {message} from './mcp.mjs';
import {encodeImagePackage} from './binary-writer.mjs';
import {validatePublished} from './published.mjs';

test('published progress and slider instance values are compared with source', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-progress-compare-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/><component id="bar" name="Bar.xml" path="/"/><component id="slider" name="Slider.xml" path="/"/></resources><publish name="Demo"/></packageDescription>');fs.writeFileSync(path.join(folder,'Bar.xml'),'<component size="20,20" extention="ProgressBar"><displayList/><ProgressBar/></component>');fs.writeFileSync(path.join(folder,'Slider.xml'),'<component size="20,20" extention="Slider"><displayList/><Slider/></component>');const source=path.join(folder,'Main.xml'),xml='<component size="40,30"><displayList><component id="a" xy="0,0" src="bar"><ProgressBar value="42" min="10" max="90"/></component><component id="b" xy="0,0" src="slider"><Slider value="30" min="5" max="75"/></component></displayList></component>';fs.writeFileSync(source,xml);
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out')},{allowSounds:true,allowComponents:true});let report=await validatePublished({project:root,file:result.file,compare_components:true});assert.equal(report.valid,true,JSON.stringify(report.issues));
  for(const [from,to,id] of [['value="42"','value="43"','a'],['min="10"','min="11"','a'],['max="75"','max="76"','b'],['<Slider value="30" min="5" max="75"/>','','b']]){fs.writeFileSync(source,xml.replace(from,to));report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(issue=>issue.child===id&&issue.error.includes('progress or slider')),from);}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('published progress component extension options are compared with source', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-progress-extension-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="bar" name="Bar.xml" path="/"/><component id="slider" name="Slider.xml" path="/"/></resources><publish name="Demo"/></packageDescription>');const bar=path.join(folder,'Bar.xml'),slider=path.join(folder,'Slider.xml');const xml=extension=>`<component size="20,20" extention="${extension}"><displayList/><${extension} titleType="value" reverse="true"/></component>`;fs.writeFileSync(bar,xml('ProgressBar'));fs.writeFileSync(slider,xml('Slider'));
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out')},{allowSounds:true,allowComponents:true});let report=await validatePublished({project:root,file:result.file,compare_components:true});assert.equal(report.valid,true,JSON.stringify(report.issues));
  fs.writeFileSync(bar,xml('ProgressBar').replace('titleType="value"','titleType="percent"'));report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(issue=>issue.component==='bar'&&issue.error.includes('component options')));fs.writeFileSync(bar,xml('ProgressBar'));fs.writeFileSync(slider,xml('Slider').replace('reverse="true"','reverse="false"'));report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(issue=>issue.component==='slider'&&issue.error.includes('component options')));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('published Button and ComboBox component options are compared with source', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-component-options-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="button" name="Button.xml" path="/"/><component id="combo" name="Combo.xml" path="/"/><component id="drop" name="Dropdown.xml" path="/"/></resources><publish name="Demo"/></packageDescription>');const button=path.join(folder,'Button.xml'),combo=path.join(folder,'Combo.xml'),buttonXml='<component size="20,20" extention="Button"><displayList/><Button mode="Check" downEffect="scale" downEffectValue="0.5"/></component>',comboXml='<component size="20,20" extention="ComboBox"><displayList/><ComboBox dropdown="ui://Demo/Dropdown"/></component>';fs.writeFileSync(button,buttonXml);fs.writeFileSync(combo,comboXml);fs.writeFileSync(path.join(folder,'Dropdown.xml'),'<component size="20,20"><displayList/></component>');
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out')},{allowSounds:true,allowComponents:true});let report=await validatePublished({project:root,file:result.file,compare_components:true});assert.equal(report.valid,true,JSON.stringify(report.issues));
  for(const [from,to] of [['mode="Check"','mode="Radio"'],['downEffect="scale"','downEffect="dark"'],['downEffectValue="0.5"','downEffectValue="0.6"']]){fs.writeFileSync(button,buttonXml.replace(from,to));report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(issue=>issue.component==='button'&&issue.error.includes('Button component options')),from);}fs.writeFileSync(button,buttonXml);fs.writeFileSync(combo,comboXml.replace('ui://Demo/Dropdown','ui://Demo/Missing'));report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(issue=>issue.component==='combo'&&issue.error.includes('ComboBox dropdown')));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('published Button and Label instance options are compared with source', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-instance-compare-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/><component id="button" name="Button.xml" path="/"/><component id="label" name="Label.xml" path="/"/></resources><publish name="Demo"/></packageDescription>');fs.writeFileSync(path.join(folder,'Button.xml'),'<component size="20,20" extention="Button"><displayList/><Button/></component>');fs.writeFileSync(path.join(folder,'Label.xml'),'<component size="20,20" extention="Label"><displayList/></component>');const source=path.join(folder,'Main.xml'),xml='<component size="40,30"><controller name="state" pages="p0,Off,p1,On"/><displayList><component id="a" xy="0,0" src="button"><Button title="Buy" selectedTitle="Selected" titleColor="#123456" titleFontSize="18" controller="state" page="p1" checked="true"/></component><component id="b" xy="0,0" src="label"><Label title="Hello" titleColor="#abcdef" titleFontSize="14"/></component></displayList></component>';fs.writeFileSync(source,xml);
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out')},{allowSounds:true,allowComponents:true});let report=await validatePublished({project:root,file:result.file,compare_components:true});assert.equal(report.valid,true,JSON.stringify(report.issues));
  for(const [from,to,id,kind] of [['title="Buy"','title="Sell"','a','Button'],['checked="true"','checked="false"','a','Button'],['page="p1"','page="p0"','a','Button'],['titleColor="#abcdef"','titleColor="#abcdee"','b','Label'],['titleFontSize="14"','titleFontSize="15"','b','Label']]){fs.writeFileSync(source,xml.replace(from,to));report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(issue=>issue.child===id&&issue.error.includes(`${kind} instance options`)),from);}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('published ComboBox items and visible count are compared with source', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-combo-instance-compare-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/><component id="combo" name="Combo.xml" path="/"/><image id="icon" name="Icon.png" path="/"/></resources><publish name="Demo"/></packageDescription>');fs.writeFileSync(path.join(folder,'Combo.xml'),'<component size="20,20" extention="ComboBox"><displayList/><ComboBox/></component>');fs.writeFileSync(path.join(folder,'Icon.png'),await encodePng({width:2,height:2,pixels:Buffer.alloc(16,255)}));const source=path.join(folder,'Main.xml'),xml='<component size="40,30"><displayList><component id="choice" xy="0,0" src="combo"><ComboBox visibleItemCount="4"><item title="First" value="one" icon="ui://Demo/Icon"/><item title="Second" value="two"/></ComboBox></component></displayList></component>';fs.writeFileSync(source,xml);
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out')},{allowSounds:true,allowComponents:true});let report=await validatePublished({project:root,file:result.file,compare_components:true});assert.equal(report.valid,true,JSON.stringify(report.issues));
  for(const [from,to] of [['visibleItemCount="4"','visibleItemCount="5"'],['title="First"','title="Changed"'],['value="two"','value="other"'],['icon="ui://Demo/Icon"','icon="ui://Demo/Other"']]){fs.writeFileSync(source,xml.replace(from,to));report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(issue=>issue.child==='choice'&&issue.error.includes('ComboBox instance')),from);}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('published loader comparison detects changed URL and display settings', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-loader-compare-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/><image id="img" name="image.png" path="/"/></resources><publish name="Demo"/></packageDescription>');fs.writeFileSync(path.join(folder,'image.png'),await encodePng({width:4,height:4,pixels:Buffer.alloc(64,255)}));const source=path.join(folder,'Main.xml'),xml='<component size="40,30"><displayList><loader id="icon" xy="0,0" url="ui://Demo/image" align="center" vAlign="middle" fill="scale" color="#123456" fillMethod="radial90" fillClockwise="false" fillAmount="65"/></displayList></component>';fs.writeFileSync(source,xml);
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out')},{allowSounds:true,allowComponents:true});let report=await validatePublished({project:root,file:result.file,compare_components:true});assert.equal(report.valid,true,JSON.stringify(report.issues));
  for(const [from,to] of [['ui://Demo/image','ui://Demo/other'],['align="center"','align="right"'],['fill="scale"','fill="scaleFree"'],['fillAmount="65"','fillAmount="70"']]){fs.writeFileSync(source,xml.replace(from,to));report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(i=>i.child==='icon'&&i.error.includes('loader URL, appearance or fill')),from);}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('published graph comparison detects changed colors and geometry', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-graph-compare-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources><publish name="Demo"/></packageDescription>');const source=path.join(folder,'Main.xml'),xml='<component size="40,30"><displayList><graph id="rect" xy="0,0" size="10,10" type="rect" lineSize="2" lineColor="#ff112233" fillColor="#ff445566" corner="3"/><graph id="poly" xy="0,0" size="10,10" type="polygon" points="0,0,10,0,10,10"/><graph id="regular" xy="0,0" size="10,10" type="regular_polygon" sides="3" startAngle="15" distances="1,0.8,1"/></displayList></component>';fs.writeFileSync(source,xml);
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out')},{allowSounds:true,allowComponents:true});let report=await validatePublished({project:root,file:result.file,compare_components:true});assert.equal(report.valid,true,JSON.stringify(report.issues));
  for(const [from,to,id] of [['lineColor="#ff112233"','lineColor="#ff112234"','rect'],['corner="3"','corner="4"','rect'],['points="0,0,10,0,10,10"','points="0,0,10,0,9,10"','poly'],['startAngle="15"','startAngle="16"','regular']]){fs.writeFileSync(source,xml.replace(from,to));report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(i=>i.child===id&&i.error.includes('graph style or geometry')),from);}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('published image style comparison detects changed color, flip and fill', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-image-style-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/><image id="img" name="image.png" path="/"/></resources><publish name="Demo"/></packageDescription>');fs.writeFileSync(path.join(folder,'image.png'),await encodePng({width:4,height:4,pixels:Buffer.alloc(64,255)}));const source=path.join(folder,'Main.xml'),xml='<component size="40,30"><displayList><image id="pic" src="img" xy="0,0" color="#123456" flip="hz" fillMethod="radial90" fillClockwise="false" fillAmount="65"/></displayList></component>';fs.writeFileSync(source,xml);
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out')},{allowSounds:true,allowComponents:true});let report=await validatePublished({project:root,file:result.file,compare_components:true});assert.equal(report.valid,true,JSON.stringify(report.issues));
  for(const [from,to] of [['color="#123456"','color="#123457"'],['flip="hz"','flip="vt"'],['fillAmount="65"','fillAmount="70"'],['fillClockwise="false"','fillClockwise="true"']]){fs.writeFileSync(source,xml.replace(from,to));report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(i=>i.child==='pic'&&i.error.includes('image color, flip or fill')),from);}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('published text comparison detects input and text effect changes', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-input-compare-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources><publish name="Demo"/></packageDescription>');const source=path.join(folder,'Main.xml'),xml='<component size="40,30"><displayList><text id="input" xy="0,0" input="true" prompt="Enter" restrict="0-9" maxLength="5" keyboardType="2" password="true" strokeColor="#112233" shadowColor="#445566" shadowOffset="2,3"/></displayList></component>';fs.writeFileSync(source,xml);
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out')},{allowSounds:true,allowComponents:true});let report=await validatePublished({project:root,file:result.file,compare_components:true});assert.equal(report.valid,true,JSON.stringify(report.issues));
  for(const [from,to,error] of [['prompt="Enter"','prompt="Changed"','input text settings'],['maxLength="5"','maxLength="6"','input text settings'],['strokeColor="#112233"','strokeColor="#112234"','text style'],['shadowOffset="2,3"','shadowOffset="2,4"','text style']]){fs.writeFileSync(source,xml.replace(from,to));report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(i=>i.child==='input'&&i.error.includes(error)),from);}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('published component comparison detects changed text and styling', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-text-compare-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources><publish name="Demo"/></packageDescription>');const source=path.join(folder,'Main.xml'),xml='<component size="40,30"><displayList><text id="label" xy="0,0" text="Hello" fontSize="14" color="#123456" align="center" bold="true"/></displayList></component>';fs.writeFileSync(source,xml);
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out')},{allowSounds:true,allowComponents:true});let report=await validatePublished({project:root,file:result.file,compare_components:true});assert.equal(report.valid,true,JSON.stringify(report.issues));
  for(const [from,to] of [['text="Hello"','text="Changed"'],['fontSize="14"','fontSize="15"'],['color="#123456"','color="#123457"'],['bold="true"','bold="false"']]){fs.writeFileSync(source,xml.replace(from,to));report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(i=>i.child==='label'&&i.error.includes('text or text style')),from);}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('published component comparison detects changed child transforms', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-child-transform-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources><publish name="Demo"/></packageDescription>');const source=path.join(folder,'Main.xml'),xml='<component size="40,30"><displayList><text id="label" xy="0,0" size="12,10" scale="0.5,1" pivot="0.2,0.3" anchor="true" alpha="0.5" rotation="45" visible="false" touchable="false" grayed="true" restrictSize="1,20,2,30"/></displayList></component>';fs.writeFileSync(source,xml);
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out')},{allowSounds:true,allowComponents:true});let report=await validatePublished({project:root,file:result.file,compare_components:true});assert.equal(report.valid,true,JSON.stringify(report.issues));
  for(const [before,after] of [['size="12,10"','size="13,10"'],['scale="0.5,1"','scale="0.6,1"'],['pivot="0.2,0.3"','pivot="0.3,0.3"'],['alpha="0.5"','alpha="0.6"'],['visible="false"','visible="true"'],['restrictSize="1,20,2,30"','restrictSize="1,21,2,30"']]){fs.writeFileSync(source,xml.replace(before,after));report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(i=>i.child==='label'&&i.error.includes('transform or visibility')),before);}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('published transition comparison detects value and tween changes', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-transition-compare-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources><publish name="Demo"/></packageDescription>');const source=path.join(folder,'Main.xml'),xml='<component size="40,30"><displayList><text id="label" xy="0,0"/></displayList><transition name="move"><item type="Alpha" time="0" target="label" value="0.5"/><item type="XY" time="0" target="label" tween="true" duration="24" ease="Linear" startValue="0,0" endValue="5,10"/></transition></component>';fs.writeFileSync(source,xml);
  const published=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out')},{allowSounds:true,allowComponents:true});let report=await validatePublished({project:root,file:published.file,compare_components:true});assert.equal(report.valid,true,JSON.stringify(report.issues));
  fs.writeFileSync(source,xml.replace('value="0.5"','value="0.7"'));report=await validatePublished({project:root,file:published.file,compare_components:true});assert.ok(report.issues.some(i=>i.item===0&&i.error.includes('value or tween')));
  fs.writeFileSync(source,xml.replace('endValue="5,10"','endValue="5,11"'));report=await validatePublished({project:root,file:published.file,compare_components:true});assert.ok(report.issues.some(i=>i.item===1&&i.error.includes('value or tween')));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('published component comparison detects changed dimensions and child count', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-component-compare-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/" exported="true"/></resources><publish name="Demo"/></packageDescription>');const source=path.join(folder,'Main.xml');fs.writeFileSync(source,'<component size="40,30"><controller name="state" pages="p0,Off,p1,On"><action type="play_transition" fromPage="p0" toPage="p1" transition="t0"/></controller><displayList><text id="label" xy="0,0" text="Hello"/></displayList><transition name="t0"><item type="Alpha" time="0" target="label" value="0.5"/></transition></component>');
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out')},{allowSounds:true,allowComponents:true});let response=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'validate_published',arguments:{project:root,file:result.file,compare_components:true}}});let report=JSON.parse(response.result.content[0].text).data;assert.equal(report.valid,true,JSON.stringify(report));assert.equal(report.components_compared,1);
  fs.writeFileSync(source,'<component size="41,30"><displayList><text id="label" xy="0,0" text="Hello"/></displayList></component>');report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(i=>i.component==='main'&&i.error.includes('dimensions')));
  fs.writeFileSync(source,'<component size="40,30"><displayList><text id="label" xy="0,0"/><text id="extra" xy="0,0"/></displayList></component>');report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(i=>i.component==='main'&&i.error.includes('child count')));
  fs.writeFileSync(source,'<component size="40,30"><displayList><text id="label" xy="12,0" text="Hello"/></displayList></component>');report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(i=>i.child==='label'&&i.error.includes('position')));
  fs.writeFileSync(source,'<component size="40,30"><controller name="state" pages="p0,Off,p1,Changed"/><displayList><text id="label" xy="0,0" text="Hello"/></displayList></component>');report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(i=>i.component==='main'&&i.error.includes('controller names, pages or actions')));
  fs.writeFileSync(source,'<component size="40,30"><controller name="state" pages="p0,Off,p1,On"><action type="play_transition" fromPage="p1" toPage="p0" transition="t0"/></controller><displayList><text id="label" xy="0,0" text="Hello"/></displayList><transition name="t0"/></component>');report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(i=>i.component==='main'&&i.error.includes('controller names, pages or actions')));
  fs.writeFileSync(source,'<component size="40,30"><controller name="state" pages="p0,Off,p1,On"><action type="play_transition" fromPage="p0" toPage="p1" transition="t0"/></controller><displayList><text id="label" xy="0,0" text="Hello"/></displayList><transition name="t0"><item type="Alpha" time="12" target="label" value="0.5"/></transition></component>');report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(i=>i.transition==='t0'&&i.error.includes('timing')));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('published validation detects inconsistent sprite dimensions without source comparison',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-published-size-'));
 try{
  const file=path.join(root,'Demo.bin');
  fs.writeFileSync(file,encodeImagePackage('abcdefgh','Demo',[{id:'img',name:'image',width:8,height:8}],[{width:8,height:8,items:[{id:'img',x:0,y:0,width:4,height:4}]}]));
  fs.writeFileSync(path.join(root,'Demo_atlas0.png'),await encodePng({width:8,height:8,pixels:Buffer.alloc(8*8*4)}));
  const report=await validatePublished({file});assert.equal(report.valid,false);assert.ok(report.issues.some(i=>i.error==='sprite dimensions differ from image metadata'));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('published validation detects corrupt or changed atlas pixels', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-validate-output-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><image id="img" name="image.png" path="/"/></resources><publish name="Demo"/></packageDescription>');
  const pixels=Buffer.alloc(8*8*4);for(let y=2;y<6;y++)for(let x=2;x<6;x++){const i=(y*8+x)*4;pixels[i]=100;pixels[i+3]=255;}fs.writeFileSync(path.join(folder,'image.png'),await encodePng({width:8,height:8,pixels}));
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out'),width:32,height:32,trim_images:true,rotate_images:true});
  const call=async name=>{const r=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{project:root,file:result.file,...(name==='validate_published'?{compare_source:true,check_overlaps:true}:{})}}});return JSON.parse(r.result.content[0].text);};
  const inspected=await call('inspect_published');assert.equal(inspected.ok,true,inspected.error);const sprite=inspected.data.sprites[0];let report=await call('validate_published');assert.equal(report.data.valid,true,JSON.stringify(report));assert.equal(report.data.images_compared,1);
  const sourcePackage=path.join(folder,'package.xml'),sourceXml=fs.readFileSync(sourcePackage,'utf8');fs.writeFileSync(sourcePackage,sourceXml.replace('name="image.png"','scale="tile" name="image.png"'));report=await call('validate_published');assert.equal(report.data.valid,false);assert.ok(report.data.issues.some(i=>i.error.includes('scale settings differ')));fs.writeFileSync(sourcePackage,sourceXml);
  const packageFile=path.join(folder,'package.xml');fs.writeFileSync(packageFile,fs.readFileSync(packageFile,'utf8').replace('id="img" name="image.png" path="/"','id="img" name="image.png" path="/" scale="9grid" scale9grid="7,7,2,2"'));const {validate}=await import('./validate.mjs');const sourceReport=await validate({project:root});assert.equal(sourceReport.valid,true);assert.match(sourceReport.warnings[0].warning,/beyond image dimensions/);const outOfBounds=await publishImages({project:root,pkg:'Demo',output:path.join(root,'grid')});assert.match(outOfBounds.warnings[0].message,/beyond image dimensions/);const gridReport=await message({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'validate_published',arguments:{project:root,file:outOfBounds.file}}});const gridData=JSON.parse(gridReport.result.content[0].text).data;assert.equal(gridData.valid,true);assert.match(gridData.warnings[0].warning,/beyond image dimensions/);
  fs.writeFileSync(sourcePackage,sourceXml);const atlas=path.join(result.output,'Demo_atlas0.png'),decoded=await decodeImage(fs.readFileSync(atlas));decoded.pixels[(sprite.y*decoded.width+sprite.x)*4]^=255;fs.writeFileSync(atlas,await encodePng(decoded));report=await call('validate_published');assert.equal(report.data.valid,false);assert.match(report.data.issues[0].error,/pixels differ/);
  const sharp=(await import('sharp')).default;fs.writeFileSync(atlas,await sharp(decoded.pixels,{raw:{width:decoded.width,height:decoded.height,channels:4}}).jpeg().toBuffer());report=await call('validate_published');assert.equal(report.data.valid,false);assert.ok(report.data.issues.some(i=>i.error.includes('does not match')));
  fs.writeFileSync(atlas,'corrupt');report=await call('validate_published');assert.equal(report.data.valid,false);assert.match(report.data.issues[0].error,/cannot be decoded/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('source pixel comparison ignores invisible RGB but detects alpha changes', {skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-transparent-compare-'));
 try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><image id="img" name="image.png" path="/"/></resources><publish name="Demo"/></packageDescription>');fs.writeFileSync(path.join(folder,'image.png'),await encodePng({width:2,height:2,pixels:Buffer.from([0,0,0,0,200,10,20,255,30,40,50,255,60,70,80,255])}));
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out'),trim_images:false,rotate_images:false}),data=await (await import('./published.mjs')).inspectPublished({file:result.file}),sprite=data.sprites.find(item=>item.id==='img'),atlas=path.join(result.output,'Demo_atlas0.png'),decoded=await decodeImage(fs.readFileSync(atlas)),offset=(sprite.y*decoded.width+sprite.x)*4;decoded.pixels[offset]=123;fs.writeFileSync(atlas,await encodePng(decoded));let report=await validatePublished({project:root,file:result.file,compare_source:true});assert.equal(report.valid,true,JSON.stringify(report.issues));decoded.pixels[offset+3]=1;fs.writeFileSync(atlas,await encodePng(decoded));report=await validatePublished({project:root,file:result.file,compare_source:true});assert.ok(report.issues.some(issue=>issue.error.includes('pixels differ')));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('large package validation checks every image against its sprite',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-many-sprites-'));
 try{
  const images=Array.from({length:2000},(_,i)=>({id:'i'+i,name:'n'+i,width:i===1733?2:1,height:1})),placements=images.map(({id})=>({id,x:0,y:0,width:1,height:1}));const file=path.join(root,'Demo.bin');fs.writeFileSync(file,encodeImagePackage('abcdefgh','Demo',images,[{width:1,height:1,items:placements}]));fs.writeFileSync(path.join(root,'Demo_atlas0.png'),await encodePng({width:1,height:1,pixels:Buffer.from([1,2,3,255])}));const report=await validatePublished({file});assert.equal(report.valid,false);assert.deepEqual(report.issues.filter(issue=>issue.error.includes('sprite dimensions')).map(issue=>issue.image),['i1733']);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('published gear comparison detects changed pages, values, defaults and tween',{skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-gear-compare-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources><publish name="Demo"/></packageDescription>');
  const source=path.join(folder,'Main.xml'),xml='<component size="100,80"><controller name="state" pages="p0,Off,p1,On"/><displayList><text id="title" xy="0,0" text="hello"><gearDisplay controller="state" pages="p0"/><gearDisplay2 controller="state" pages="p1" condition="1"/><gearText controller="state" pages="p0,p1" values="Hello|World" default="Default"/><gearFontSize controller="state" pages="p0,p1" values="12|-" default="20"/><gearXY controller="state" pages="p0,p1" values="1,2|-" default="3,4" tween="true" ease="Quad.Out" duration="0.3" delay="0.1"/><gearColor controller="state" pages="p0" values="#112233,#445566"/></text></displayList></component>';fs.writeFileSync(source,xml);
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out')},{allowSounds:true,allowComponents:true});let report=await validatePublished({project:root,file:result.file,compare_components:true});assert.equal(report.valid,true,JSON.stringify(report.issues));
  for(const [from,to] of [['pages="p0"','pages="p1"'],['condition="1"','condition="0"'],['Hello|World','Hello|Other'],['default="20"','default="21"'],['duration="0.3"','duration="0.4"'],['#112233,#445566','#112234,#445566']]){fs.writeFileSync(source,xml.replace(from,to));report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(issue=>issue.child==='title'&&issue.error.includes('gear')),from);}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('gear source comparison supports size, look, animation and icons',async()=>{
 const {sourceGears}=await import('./gear-comparison.mjs'),{parse}=await import('./project.mjs');
 const xml='<text><gearSize controller="state" pages="p0" values="20,30" default="4,5,2,3"/><gearLook controller="state" pages="p0" values="0.5,90,1"/><gearAni controller="state" pages="p0" values="3,p" default="2,s"/><gearIcon controller="state" pages="p0" values="" default=""/></text>',node=parse(Buffer.from(xml),'test');
 assert.deepEqual(sourceGears(node,[{name:'state'}]),[{type:2,controller:0,values:[{page:'p0',value:[20,30,1,1]}],default:[4,5,2,3],tween:false},{type:3,controller:0,values:[{page:'p0',value:[0.5,90,true,true]}],tween:false},{type:5,controller:0,values:[{page:'p0',value:{playing:true,frame:3}}],default:{playing:false,frame:2},tween:false},{type:7,controller:0,values:[{page:'p0',value:null}],default:null,tween:false}]);
 assert.throws(()=>sourceGears(parse(Buffer.from(xml.replace('0.5,90,1','0.5,90,2')),'test'),[{name:'state'}]),/look flags/);
});

test('published validation detects broken gear references without a source project',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-gear-validate-'));try{
  const file=path.join(root,'Demo.fui'),components=[{id:'main',name:'Main',width:20,height:20,controllers:[{name:'state',pages:[['p0','normal']]}],children:[{type:'text',id:'t',x:0,y:0,text:'Hi',gears:[{type:'display',controllerIndex:0,pages:['p0']}]}]}];
  async function report(){fs.writeFileSync(file,encodeImagePackage('abcdefgh','Demo',[],[],{components}));return validatePublished({file});}
  const valid=await report();assert.equal(valid.valid,true);assert.deepEqual(valid.warnings,[]);components[0].children[0].gears[0].controllerIndex=1;let result=await report();assert.equal(result.valid,false);assert.ok(result.issues.some(issue=>issue.child==='t'&&issue.error.includes('controller index')));
  components[0].children[0].gears[0].controllerIndex=0;components[0].children[0].gears[0].pages=['missing'];result=await report();assert.equal(result.valid,true);assert.ok(result.warnings.some(issue=>issue.child==='t'&&issue.pages.includes('missing')));
  components[0].children[0].gears.push({type:'display',controllerIndex:0,pages:['p0']});result=await report();assert.equal(result.valid,false);assert.ok(result.issues.some(issue=>issue.error.includes('duplicate published gear')));
  components[0].children[0].gears=[{type:'display2',controllerIndex:0,pages:['p0'],condition:2}];result=await report();assert.equal(result.valid,false);assert.ok(result.issues.some(issue=>issue.error.includes('gear condition')));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('published relation comparison detects changes to component and child layout',{skip:process.platform!=='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-relations-compare-'));try{
  const folder=path.join(root,'assets','Demo');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/"/></resources><publish name="Demo"/></packageDescription>');
  const source=path.join(folder,'Main.xml'),xml='<component size="100,80"><relation target="a" sidePair="width-width"/><displayList><text id="a" xy="0,0" text="One"><relation target="" sidePair="left-left,top-top"/></text><text id="b" xy="0,0" text="Two"><relation target="a" sidePair="right-right"/></text></displayList></component>';fs.writeFileSync(source,xml);
  const result=await publishImages({project:root,pkg:'Demo',output:path.join(root,'out')},{allowSounds:true,allowComponents:true});let report=await validatePublished({project:root,file:result.file,compare_components:true});assert.equal(report.valid,true,JSON.stringify(report.issues));
  for(const [from,to,expected] of [['width-width','height-height','component relations'],['left-left,top-top','left-right,top-top','child relations'],['target="a" sidePair="right-right"','target="" sidePair="right-right"','child relations']]){fs.writeFileSync(source,xml.replace(from,to));report=await validatePublished({project:root,file:result.file,compare_components:true});assert.ok(report.issues.some(issue=>issue.error.includes(expected)),from);}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('published validation detects invalid relation targets and types without source',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-relations-validate-'));try{
  const file=path.join(root,'Demo.fui'),components=[{id:'main',name:'Main',width:20,height:20,relations:[{target:0,types:[14]}],children:[{type:'text',id:'a',x:0,y:0,text:'Hi',relations:[{target:-1,types:[0]}]},{type:'text',id:'b',x:0,y:0,text:'Hi',relations:[{target:0,types:[24]}]}]}];
  async function report(){fs.writeFileSync(file,encodeImagePackage('abcdefgh','Demo',[],[],{components}));return validatePublished({file});}
  assert.equal((await report()).valid,true);components[0].relations[0].target=2;let result=await report();assert.equal(result.valid,false);assert.ok(result.issues.some(issue=>issue.component==='main'&&issue.error.includes('relation target')));
  components[0].relations[0].target=0;components[0].children[1].relations[0].target=1;result=await report();assert.equal(result.valid,false);assert.ok(result.issues.some(issue=>issue.child==='b'&&issue.error.includes('relation target')));
  components[0].children[1].relations[0].target=0;components[0].children[1].relations[0].types=[25];result=await report();assert.equal(result.valid,false);assert.ok(result.issues.some(issue=>issue.child==='b'&&issue.error.includes('relation type')));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('published validation detects duplicate component IDs and controller pages',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-component-ids-'));try{
  const file=path.join(root,'Demo.fui'),component={id:'main',name:'Main',width:20,height:20,controllers:[{name:'state',pages:[['p0','normal'],['p1','active']]}],children:[{type:'text',id:'a',x:0,y:0,text:'A'},{type:'text',id:'b',x:0,y:0,text:'B'}]};
  async function report(){fs.writeFileSync(file,encodeImagePackage('abcdefgh','Demo',[],[],{components:[component]}));return validatePublished({file});}
  assert.equal((await report()).valid,true);component.children[1].id='a';let result=await report();assert.equal(result.valid,false);assert.ok(result.issues.some(issue=>issue.error.includes('duplicate published child ID')));component.children[1].id='b';
  component.controllers.push({name:'state',pages:[]});result=await report();assert.equal(result.valid,false);assert.ok(result.issues.some(issue=>issue.error.includes('duplicate published controller name')));component.controllers.pop();
  component.controllers[0].pages[1][0]='p0';result=await report();assert.equal(result.valid,false);assert.ok(result.issues.some(issue=>issue.error.includes('duplicate published controller page ID')));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
