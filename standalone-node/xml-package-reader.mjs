import fs from 'node:fs/promises';
import path from 'node:path';
import {parse,children,attr} from './project.mjs';
import {readZip} from './zip-reader.mjs';
import {readBitmapFont} from './bitmap-font.mjs';

export async function inspectXmlPackage(file,data){
 const archive=readZip(data),packageBytes=archive.get('package.xml');if(!packageBytes)throw new Error('XML package.xml missing');const root=parse(packageBytes,'package.xml');if(root.tagName!=='packageDescription')throw new Error('invalid XML package root');const id=attr(root,'id'),name=attr(root,'name');if(!id||!name||children(root,'resources').length!==1)throw new Error('invalid XML package identity or resources');
 const types={image:0,movieclip:1,sound:2,component:3,atlas:4,font:5},items=[],ids=new Set();
 for(const item of children(children(root,'resources')[0])){const type=types[item.tagName];if(type===undefined)throw new Error(`unsupported XML resource type ${item.tagName}`);const itemId=attr(item,'id'),size=(attr(item,'size')??'0,0').split(',');if(!itemId||ids.has(itemId)||size.length!==2||size.some(v=>!/^\d+$/.test(v)||Number(v)>2147483647))throw new Error('invalid XML resource metadata');ids.add(itemId);const record={type,id:itemId,name:attr(item,'name'),file:attr(item,'file'),exported:attr(item,'exported')==='true',width:Number(size[0]),height:Number(size[1])};
  if(type===0){const scale=attr(item,'scale');if(scale==='9grid'){const values=(attr(item,'scale9grid')??'').split(',');if(values.length!==4||values.some(v=>!/^\d+$/.test(v)||Number(v)>2147483647))throw new Error('invalid XML scale9grid');record.scale9Grid=values.map(Number);}else if(scale==='tile')record.scaleByTile=true;else if(scale!==null&&scale!=='')throw new Error('unsupported XML image scale');if(scale!=='9grid'&&attr(item,'scale9grid')!==null)throw new Error('unexpected XML scale9grid');}
  if(type===3){const entry=archive.get(itemId+'.xml');if(!entry||parse(entry,itemId+'.xml').tagName!=='component')throw new Error(`component XML missing or invalid: ${itemId}`);}
  if(type===1){
   const entry=archive.get(itemId+'.xml');if(!entry)throw new Error(`movieclip XML missing: ${itemId}`);
   const clip=parse(entry,itemId+'.xml'),interval=attr(clip,'interval')??'0',groups=children(clip,'frames');
   if(clip.tagName!=='movieclip'||!/^\d+$/.test(interval)||Number(interval)>2147483647||groups.length!==1)throw new Error(`invalid movieclip XML: ${itemId}`);
   const frames=children(groups[0]);if(!frames.length)throw new Error(`movieclip has no frames: ${itemId}`);
   record.movieclip={interval:Number(interval),frames:frames.map((frame,index)=>{
    const rect=(attr(frame,'rect')??'').split(','),delay=attr(frame,'addDelay')??'0',suffix=attr(frame,'sprite')??String(index);
    if(frame.tagName!=='frame'||rect.length!==4||rect.some((v,i)=>!(i<2?/^-?\d+$/:/^\d+$/).test(v)||Math.abs(Number(v))>2147483647)||!/^\d+$/.test(delay)||Number(delay)>2147483647||!/^[A-Za-z0-9_-]+$/.test(suffix))throw new Error(`invalid movieclip frame: ${itemId}:${index}`);
    return {rect:rect.map(Number),delay:Number(delay),sprite:`${itemId}_${suffix}`};
   })};
  }
  if(type===5){
   const entry=archive.get(itemId+'.fnt');if(!entry)throw new Error(`bitmap font descriptor missing: ${itemId}`);
   const text=new TextDecoder('utf-8',{fatal:true}).decode(entry);
   // Legacy atlas fonts use a different texture record; only the image-glyph
   // form is fully inspected here.
   const texture=attr(item,'texture');
   if(texture)record.font=readBitmapFont(entry,texture);
   else if(!/^info\s+.*\bface=/m.test(text))record.font=readBitmapFont(entry);
  }
  items.push(record);
 }
 const spriteFile=path.join(path.dirname(path.resolve(file)),path.parse(file).name+'@sprites.bytes');let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(spriteFile));}catch(e){if(e.code==='ENOENT'&&!items.some(i=>i.type===0||i.type===4))text='';else throw new Error(`XML sprite manifest cannot be read: ${e.message}`);}
 const sprites=[],spriteIds=new Set(),atlases=new Map(items.filter(i=>i.type===4).map(i=>[i.id,i]));for(const raw of text.split(/\r?\n/)){const line=raw.trim();if(!line||line.startsWith('//'))continue;const fields=line.split(/\s+/);if(![7,11].includes(fields.length)||fields.slice(1).some(v=>!/^\d+$/.test(v)||Number(v)>2147483647))throw new Error('invalid XML sprite record');const [spriteId,index,x,y,width,height,rotated,...trim]=fields;if(spriteIds.has(spriteId)||!['0','1'].includes(rotated)||Number(width)<=0||Number(height)<=0)throw new Error('invalid or duplicate XML sprite');spriteIds.add(spriteId);const sprite={id:spriteId,atlas:'atlas'+index,x:Number(x),y:Number(y),width:Number(width),height:Number(height),rotated:rotated==='1'};if(trim.length)Object.assign(sprite,{offset_x:Number(trim[0]),offset_y:Number(trim[1]),original_width:Number(trim[2]),original_height:Number(trim[3])});const atlas=atlases.get(sprite.atlas),w=sprite.rotated?sprite.height:sprite.width,h=sprite.rotated?sprite.width:sprite.height;if(!atlas||sprite.x+w>atlas.width||sprite.y+h>atlas.height||(trim.length&&(sprite.offset_x+sprite.width>sprite.original_width||sprite.offset_y+sprite.height>sprite.original_height)))throw new Error('XML sprite outside atlas or original image');sprites.push(sprite);}
 const bySprite=new Map(sprites.map(sprite=>[sprite.id,sprite]));
 for(const item of items)if(item.type===1)for(const frame of item.movieclip.frames)if(frame.rect[2]>0&&frame.rect[3]>0){const sprite=bySprite.get(frame.sprite);if(!sprite)throw new Error(`movieclip frame sprite missing: ${frame.sprite}`);if((sprite.original_width??sprite.width)!==frame.rect[2]||(sprite.original_height??sprite.height)!==frame.rect[3])throw new Error(`movieclip frame sprite size mismatch: ${frame.sprite}`);}
 const byItem=new Map(items.map(item=>[item.id,item]));
 for(const item of items)if(item.type===5&&item.font){
  if(item.font.ttf){const texture=byItem.get(item.font.texture);if(texture?.type!==0)throw new Error(`bitmap font texture missing: ${item.id}:${item.font.texture}`);for(const glyph of item.font.glyphs)if(glyph.x+glyph.width>texture.width||glyph.y+glyph.height>texture.height)throw new Error(`bitmap font glyph outside texture: ${item.id}:${glyph.id}`);}
  else for(const glyph of item.font.glyphs)if(byItem.get(glyph.image)?.type!==0)throw new Error(`bitmap font glyph image missing: ${item.id}:${glyph.image}`);
 }
 return {format:'xml',version:null,id,name,dependencies:[],items,sprites,hitTests:[],archive_entries:[...archive.keys()],scope:'XML package resource metadata, component XML well-formedness and sprite manifest; component behavior not inspected'};
}
