// Correct legacy Pixi easing aliases and exponential curves to match FairyGUI.
// Serialized into the isolated browser preview before components are constructed.
export function installPreviewEase(fgui,createjs){
 const original=fgui.ParseEaseType;
 fgui.ParseEaseType=function(name){
  if(name==='Expo.In')return t=>t===0?0:Math.pow(2,10*(t-1));
  if(name==='Expo.Out')return t=>t===1?1:1-Math.pow(2,-10*t);
  if(name==='Expo.InOut')return t=>t===0?0:t===1?1:t<.5?Math.pow(2,20*t-10)/2:(2-Math.pow(2,-20*t+10))/2;
  if(typeof name==='string'&&name.startsWith('Cubic.'))return original(name.replace('Cubic.','Cube.'));
  return original(name);
 };
}
