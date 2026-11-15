import {test} from 'node:test';import assert from 'node:assert/strict';import {installPreviewEase} from './pixi-ease.mjs';
test('preview easing corrects exponential curves and cubic aliases',()=>{
 const sentinel=()=>.123,fgui={ParseEaseType:name=>name==='Cube.In'?t=>t*t*t:sentinel};installPreviewEase(fgui,{});
 assert.equal(fgui.ParseEaseType('Cubic.In')(.5),.125);assert.equal(fgui.ParseEaseType('Expo.In')(0),0);assert.equal(fgui.ParseEaseType('Expo.In')(.5),.03125);assert.equal(fgui.ParseEaseType('Expo.Out')(.5),.96875);assert.equal(fgui.ParseEaseType('Expo.Out')(1),1);assert.equal(fgui.ParseEaseType('Expo.InOut')(.25),.015625);assert.equal(fgui.ParseEaseType('Expo.InOut')(.75),.984375);assert.equal(fgui.ParseEaseType('Quad.In'),sentinel);
});
