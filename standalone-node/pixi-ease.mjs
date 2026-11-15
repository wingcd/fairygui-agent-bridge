// Correct legacy Pixi easing aliases and exponential curves to match FairyGUI.
// Serialized into the isolated browser preview before components are constructed.
export function installPreviewEase(fgui,createjs){
 const original=fgui.ParseEaseType;
 fgui.ParseEaseType=function(name){
  if(name==='Expo.In')return t=>t===0?0:Math.pow(2,10*(t-1));
  if(name==='Expo.Out')return t=>t===1?1:1-Math.pow(2,-10*t);
  if(name==='Expo.InOut')return t=>t===0?0:t===1?1:t<.5?Math.pow(2,20*t-10)/2:(2-Math.pow(2,-20*t+10))/2;
  const amount=1.70158;
  if(name==='Back.In')return t=>t*t*((amount+1)*t-amount);
  if(name==='Back.Out')return t=>{const x=t-1;return x*x*((amount+1)*x+amount)+1;};
  if(name==='Back.InOut')return t=>{const a=amount*1.525,x=t<.5?2*t:2*t-2;return t<.5?x*x*((a+1)*x-a)/2:(x*x*((a+1)*x+a)+2)/2;};
  if(['Elastic.In','Elastic.Out','Elastic.InOut'].includes(name))return t=>{if(t===0||t===1)return t;const both=name==='Elastic.InOut',period=both?.45:.3,phase=period/(2*Math.PI)*Math.asin(1/amount),x=both?2*t-1:name==='Elastic.In'?t-1:t,wave=Math.sin((x-phase)*2*Math.PI/period);if(name==='Elastic.In'||both&&t<.5)return -(both?.5:1)*amount*Math.pow(2,10*x)*wave;return 1+(both?.5:1)*amount*Math.pow(2,-10*x)*wave;};
  if(typeof name==='string'&&name.startsWith('Cubic.'))return original(name.replace('Cubic.','Cube.'));
  return original(name);
 };
}
