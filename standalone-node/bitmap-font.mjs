function tokens(line) {
  const result=[];let current='',quote=null,started=false;
  for(let i=0;i<line.length;i++) {
    const c=line[i];
    if(quote==="'") {if(c==="'")quote=null;else current+=c;started=true;continue;}
    if(quote==='"') {if(c==='"')quote=null;else if(c==='\\' && i+1<line.length && ['\\','"','$','`','\n'].includes(line[i+1])) current+=line[++i];else current+=c;started=true;continue;}
    if(c==='"' || c==="'") {quote=c;started=true;}
    else if(c==='\\') {if(++i>=line.length)throw new Error('invalid bitmap font line');current+=line[i];started=true;}
    else if(/\s/.test(c)) {if(started){result.push(current);current='';started=false;}}
    else {current+=c;started=true;}
  }
  if(quote)throw new Error('invalid bitmap font line');if(started)result.push(current);return result;
}
function integer(values,key,fallback=0) {
  const text=values[key] ?? String(fallback);if(!/^[+-]?\d+$/.test(text))throw new Error('invalid bitmap font integer');
  const number=Number(text);if(number < -2147483648 || number > 2147483647)throw new Error('bitmap font integer out of range');return number;
}
export function readBitmapFont(data,texture=null) {
  const records=[];
  for(const raw of data.toString('utf8').replace(/^\uFEFF/,'').split(/\r\n|\r|\n/)) {
    const line=raw.trim();if(!line)continue;const parts=tokens(line),type=parts[0],values=Object.create(null);
    for(const token of parts.slice(1)) {const at=token.indexOf('=');if(at<0)throw new Error('invalid bitmap font attribute');const key=token.slice(0,at);if(Object.hasOwn(values,key))throw new Error('duplicate bitmap font attribute');values[key]=token.slice(at+1);}
    if(!['info','common','page','chars','char','kernings','kerning'].includes(type))throw new Error('unsupported bitmap font record');
    if(type==='kerning' || (type==='kernings' && (values.count ?? '0')!=='0'))throw new Error('bitmap font kerning is unsupported');
    records.push([type,values]);
  }
  const infos=records.filter(([t])=>t==='info').map(([,v])=>v),commons=records.filter(([t])=>t==='common').map(([,v])=>v);
  if(infos.length!==1 || commons.length>1)throw new Error('invalid bitmap font header');
  const info=infos[0],common=commons[0]||{},ttf=Boolean(texture);
  if(integer(common,'pages',1)!==1)throw new Error('multi-page bitmap fonts are unsupported');
  if(!['true','false'].includes(info.colored ?? 'false'))throw new Error('invalid bitmap font color setting');
  const size=integer(info,'size');if(size<0)throw new Error('invalid bitmap font size');
  const glyphs=[],seen=new Set();
  for(const [type,entry] of records) {
    if(type!=='char')continue;const id=integer(entry,'id');if(!id)continue;
    if(id<1 || id>65535 || seen.has(id))throw new Error('invalid or duplicate bitmap font glyph');seen.add(id);
    let image=null,x=0,y=0,width=0,height=0,channel=0;
    if(ttf) {
      if(integer(entry,'page')!==0)throw new Error('multi-page bitmap glyph is unsupported');
      [x,y,width,height]=['x','y','width','height'].map(k=>integer(entry,k));
      if(Math.min(x,y,width,height)<0)throw new Error('invalid bitmap font glyph rectangle');
      channel=integer(entry,'chnl');if(channel<0 || channel>255)throw new Error('invalid bitmap font channel');
    } else {image=entry.img;if(!image)throw new Error('bitmap font glyph image missing');}
    glyphs.push({id,image,x,y,xOffset:integer(entry,'xoffset'),yOffset:integer(entry,'yoffset'),width,height,xAdvance:integer(entry,'xadvance'),channel});
  }
  return {ttf,texture,canTint:ttf || info.colored==='true',resizable:false,hasChannel:false,fontSize:size,xAdvance:0,lineHeight:integer(common,'lineHeight',size),glyphs};
}
