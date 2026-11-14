import {inflateRawSync} from 'node:zlib';

// Read bounded, ordinary ZIP archives emitted by the FairyGUI XML publisher.
export function readZip(data){
 if(!Buffer.isBuffer(data)||data.length<22)throw new Error('invalid ZIP archive');let eocd=-1;for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--)if(data.readUInt32LE(i)===0x06054b50&&i+22+data.readUInt16LE(i+20)===data.length){eocd=i;break;}if(eocd<0)throw new Error('ZIP directory missing');
 const disk=data.readUInt16LE(eocd+4),cdDisk=data.readUInt16LE(eocd+6),diskCount=data.readUInt16LE(eocd+8),count=data.readUInt16LE(eocd+10),size=data.readUInt32LE(eocd+12),offset=data.readUInt32LE(eocd+16);if(disk||cdDisk||diskCount!==count||count===65535||offset===0xffffffff||count>10000||offset+size!==eocd)throw new Error('unsupported ZIP directory');
 const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}const crc=bytes=>{let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
 const entries=new Map();let pos=offset,total=0;const decoder=new TextDecoder('utf-8',{fatal:true});
 for(let i=0;i<count;i++){
  if(pos+46>eocd||data.readUInt32LE(pos)!==0x02014b50)throw new Error('invalid ZIP entry');const flags=data.readUInt16LE(pos+8),method=data.readUInt16LE(pos+10),checksum=data.readUInt32LE(pos+16),packed=data.readUInt32LE(pos+20),unpacked=data.readUInt32LE(pos+24),nameLength=data.readUInt16LE(pos+28),extra=data.readUInt16LE(pos+30),comment=data.readUInt16LE(pos+32),local=data.readUInt32LE(pos+42),end=pos+46+nameLength+extra+comment;
  if(end>eocd||flags&1||![0,8].includes(method)||unpacked>128*1024*1024||(total+=unpacked)>128*1024*1024)throw new Error('unsupported or oversized ZIP entry');let name;try{name=decoder.decode(data.subarray(pos+46,pos+46+nameLength));}catch{throw new Error('invalid ZIP filename');}if(!name||name.length>1024||name.includes('\\')||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..')||entries.has(name))throw new Error('unsafe or duplicate ZIP filename');
  if(local+30>offset||data.readUInt32LE(local)!==0x04034b50||data.readUInt16LE(local+6)!==flags||data.readUInt16LE(local+8)!==method)throw new Error('invalid ZIP local header');const ln=data.readUInt16LE(local+26),le=data.readUInt16LE(local+28),start=local+30+ln+le;if(start+packed>offset||!data.subarray(local+30,local+30+ln).equals(data.subarray(pos+46,pos+46+nameLength)))throw new Error('invalid ZIP entry bounds');const compressed=data.subarray(start,start+packed);let bytes;try{bytes=method===0?Buffer.from(compressed):inflateRawSync(compressed,{maxOutputLength:Math.max(1,unpacked)});}catch{throw new Error('invalid ZIP compressed data');}if(bytes.length!==unpacked||crc(bytes)!==checksum)throw new Error('ZIP entry checksum mismatch');entries.set(name,bytes);pos=end;
 }
 if(pos!==eocd)throw new Error('invalid ZIP directory size');return entries;
}
