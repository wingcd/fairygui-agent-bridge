// The editor's legacy XML package is an ordinary ZIP containing package.xml.
// Only editor-verified image and simple component records are emitted.
const escape = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
function zipEntries(entries){
 const payloads=[],directories=[];let offset=0;
 for(const [name,body] of entries){const filename=Buffer.from(name),data=Buffer.from(body);let crc=0xffffffff;
 for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1;}crc=(crc^0xffffffff)>>>0;
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(filename.length,26);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(filename.length,28);
 central.writeUInt32LE(offset,42);const payload=Buffer.concat([local,filename,data]);payloads.push(payload);directories.push(Buffer.concat([central,filename]));offset+=payload.length;}
 const directory=Buffer.concat(directories),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...payloads,directory,end]);
}
export function encodeXmlImagePackage(id,name,images,pages,spriteTrim,components=[],sounds=[]){
 const lines=[`<packageDescription id="${escape(id)}" name="${escape(name)}">`,'  <resources>'];
 for(const image of images){if(!/^[A-Za-z0-9_-]+$/.test(image.id))throw new Error('XML sprite ID contains unsupported characters');let extra=image.exported?' exported="true"':'';if(image.scale9grid)extra+=` scale="9grid" scale9grid="${image.scale9grid.join(',')}"`;else if(image.scaleByTile)extra+=' scale="tile"';lines.push(`    <image id="${escape(image.id)}" name="${escape(image.name)}" path="${escape(image.path??'/')}" size="${image.width},${image.height}"${extra}/>`);}
 for(const component of components){if(!/^[A-Za-z0-9_-]+$/.test(component.id))throw new Error('XML component ID contains unsupported characters');lines.push(`    <component id="${escape(component.id)}" name="${escape(component.name)}" path="${escape(component.path??'/')}" size="${component.width},${component.height}"${component.exported?' exported="true"':''}/>`);}
 for(const sound of sounds)lines.push(`    <sound id="${escape(sound.id)}" name="${escape(sound.name)}" path="${escape(sound.path??'/')}" size="0,0"${sound.exported?' exported="true"':''} file="${escape(sound.file)}"/>`);
 pages.forEach((page,i)=>lines.push(`    <atlas id="atlas${i}" size="${page.width},${page.height}" file="atlas${i}.png"/>`));lines.push('  </resources>','</packageDescription>');
 const sprites=['//FairyGUI atlas sprites.'];pages.forEach((page,i)=>page.items.forEach(item=>{const trim=spriteTrim[item.id];sprites.push([item.id,i,item.x,item.y,item.width,item.height,item.rotated?1:0,...(trim??[])].join(' '));}));
 return {blob:zipEntries([['package.xml',lines.join('\n')+'\n'],...components.map(c=>[`${c.id}.xml`,c.xml])]),sprites:sprites.join('\n')+'\n'};
}
