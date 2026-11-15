import {test} from 'node:test';import assert from 'node:assert/strict';import {installPreviewEase} from './pixi-ease.mjs';
test('preview easing corrects exponential curves and cubic aliases',()=>{
 const sentinel=()=>.123,fgui={ParseEaseType:name=>name==='Cube.In'?t=>t*t*t:sentinel};installPreviewEase(fgui,{});
 assert.equal(fgui.ParseEaseType('Cubic.In')(.5),.125);assert.equal(fgui.ParseEaseType('Expo.In')(0),0);assert.equal(fgui.ParseEaseType('Expo.In')(.5),.03125);assert.equal(fgui.ParseEaseType('Expo.Out')(.5),.96875);assert.equal(fgui.ParseEaseType('Expo.Out')(1),1);assert.equal(fgui.ParseEaseType('Expo.InOut')(.25),.015625);assert.equal(fgui.ParseEaseType('Expo.InOut')(.75),.984375);assert.equal(fgui.ParseEaseType('Quad.In'),sentinel);
});

test('preview Back and Elastic curves use FairyGUI default parameters',()=>{
 const fgui={ParseEaseType:()=>()=>.123};installPreviewEase(fgui,{});const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);
 close(fgui.ParseEaseType('Back.In')(.5),-.0876975);close(fgui.ParseEaseType('Back.Out')(.5),1.0876975);close(fgui.ParseEaseType('Back.InOut')(.5),.5);
 close(fgui.ParseEaseType('Elastic.In')(.25),-.005524271728019914);close(fgui.ParseEaseType('Elastic.Out')(.25),.7008443879120276);close(fgui.ParseEaseType('Elastic.InOut')(.25),.02579666971713344);close(fgui.ParseEaseType('Elastic.InOut')(.75),1.0018577808696654);
 for(const ease of ['Elastic.In','Elastic.Out','Elastic.InOut']){assert.equal(fgui.ParseEaseType(ease)(0),0);assert.equal(fgui.ParseEaseType(ease)(1),1);}
});
