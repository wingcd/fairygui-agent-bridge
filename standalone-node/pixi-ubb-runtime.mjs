// Install styled UBB rendering on the legacy FairyGUI PIXI text field.
// This function is serialized into the isolated browser preview.
export function installPreviewUbb(fgui, PIXI, parseUbb) {
 const setup=fgui.GTextField.prototype.setupBeforeAdd;
 fgui.GTextField.prototype.setupBeforeAdd=function(xml){setup.call(this,xml);this.$previewUbb=xml.attributes.ubb==='true';};
 const original=fgui.GTextField.prototype.renderNow;
 fgui.GTextField.prototype.renderNow=function(updateBounds){
  if(!this.$previewUbb)return original.call(this,updateBounds);
  const source=this.$text,runs=parseUbb(source),plain=runs.map(run=>run.type==='text'?run.text:'\uFFFC').join('');
  this.$text=plain;try{original.call(this,updateBounds);}finally{this.$text=source;}
  const field=this.$textField;field.text='';if(this.$previewRich){field.removeChild(this.$previewRich);this.$previewRich.destroy({children:true});}if(this.$previewRichMask){field.removeChild(this.$previewRichMask);this.$previewRichMask.destroy();this.$previewRichMask=null;}
  const container=this.$previewRich=new PIXI.Container();field.addChild(container);
  const limit=this.$widthAutoSize||!this.multipleLine?Infinity:Math.max(1,this.width-4),leading=Number(this.$style.leading)||0;
  const lines=[{segments:[],width:0,height:0}],line=()=>lines[lines.length-1];let wrapPending=false;
  function next(){wrapPending=false;lines.push({segments:[],width:0,height:0});}
  function add(display,w,h,whitespace=false){if(wrapPending){if(whitespace){display.destroy();return false;}next();}const current=line();if(current.width>0&&current.width+w>limit){if(whitespace){display.destroy();wrapPending=true;return false;}while(current.segments.length&&current.segments[current.segments.length-1].whitespace){const trailing=current.segments.pop();current.width=trailing.x;trailing.display.destroy();}next();}line().segments.push({display,x:line().width,height:h,whitespace});line().width+=w;line().height=Math.max(line().height,h);return true;}
  for(const run of runs){
   if(run.type==='image'){const obj=fgui.UIPackage.createObjectFromURL(run.url);if(!obj)throw Error('UBB image resource missing: '+run.url);add(obj.displayObject,obj.width,obj.height);continue;}
   const style=this.$style.clone();if(run.style.bold)style.fontWeight='bold';if(run.style.italic)style.fontStyle='italic';if(run.style.color)style.fill=run.style.color;if(run.style.size)style.fontSize=run.style.size;if(run.style.font)style.fontFamily=run.style.font;style.wordWrap=false;
   for(const part of run.text.match(/\n|[^\S\n]+|[^\s]+/gu)||[]){if(part==='\n'){next();continue;}const chunks=part.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu)||[];
    const pieces=chunks.flatMap(chunk=>Number.isFinite(limit)&&PIXI.TextMetrics.measureText(chunk,style).width>limit?Array.from(chunk):[chunk]);
    for(const piece of pieces){const display=new PIXI.Text(piece,style);const added=add(display,PIXI.TextMetrics.measureText(piece,style).width,display.height,/^[^\S\n]+$/u.test(piece));if(run.style.underline&&added){const stroke=new PIXI.Graphics();stroke.lineStyle(Math.max(1,Number(style.fontSize)/16),typeof style.fill==='string'?parseInt(style.fill.replace('#',''),16):style.fill);stroke.moveTo(0,display.height-2);stroke.lineTo(display.width,display.height-2);display.addChild(stroke);}}
   }
  }
  const width=Math.max(0,...lines.map(current=>current.width));let y=0;
  for(const current of lines){const h=current.height||Number(this.$style.fontSize)||12,align=this.$style.align,offset=align==='center'?(width-current.width)/2:align==='right'?width-current.width:0;for(const part of current.segments){part.display.x=offset+part.x;part.display.y=y+h-part.height;container.addChild(part.display);}y+=h+leading;}
  this.$textWidth=width?Math.ceil(width)+4:0;this.$textHeight=y?Math.ceil(y-leading)+4:0;
  if(updateBounds!==false&&(this.$widthAutoSize||this.$heightAutoSize)){this.$updatingSize=true;this.setSize(this.$widthAutoSize?this.$textWidth:this.width,this.$heightAutoSize?this.$textHeight:this.height);this.$updatingSize=false;}
  this.layoutAlign();
  if(this.autoSize===0){const clip=this.$previewRichMask=new PIXI.Graphics();clip.beginFill(0xffffff);clip.drawRect(-this.$offset.x,-this.$offset.y,this.width,this.height);clip.endFill();field.addChild(clip);container.mask=clip;}
 };
}
