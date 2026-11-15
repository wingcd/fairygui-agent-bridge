// The legacy Pixi runtime does not interpolate transition colors. Patch its
// transition values so TweenJS interpolates RGB channels independently.
export function installPreviewTransitionColors(fgui){
 const prepare=fgui.Transition.prototype.prepareValue,apply=fgui.Transition.prototype.applyValue;
 fgui.Transition.prototype.prepareValue=function(item,toProps,reversed){
  if(item.type!==6||!item.tween)return prepare.call(this,item,toProps,reversed);
  const from=(reversed?item.endValue:item.startValue).c,to=(reversed?item.startValue:item.endValue).c;
  item.value.f1=(from>>16)&255;item.value.f2=(from>>8)&255;item.value.f3=from&255;
  toProps.f1=(to>>16)&255;toProps.f2=(to>>8)&255;toProps.f3=to&255;
 };
 fgui.Transition.prototype.applyValue=function(item,value){
  if(item.type===6&&item.tween){const byte=n=>Math.max(0,Math.min(255,Math.trunc(n)));value.c=(byte(value.f1)<<16)|(byte(value.f2)<<8)|byte(value.f3);}
  return apply.call(this,item,value);
 };
}
