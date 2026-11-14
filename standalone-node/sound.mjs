// Validate supported audio framing; MP3 audio payload is not decoded.
export function inspectWav(data) {
  try {
    if(data.length<12 || data.toString('ascii',0,4)!=='RIFF' || data.toString('ascii',8,12)!=='WAVE' || data.readUInt32LE(4)+8>data.length) throw new Error();
    const end=data.readUInt32LE(4)+8; let p=12, fmt=null, size=null;
    while(p+8<=end) {
      const id=data.toString('ascii',p,p+4), n=data.readUInt32LE(p+4);p+=8;
      if(p+n>end) throw new Error();
      if(id==='fmt ' && !fmt) {if(n<16)throw new Error();fmt={kind:data.readUInt16LE(p),channels:data.readUInt16LE(p+2),rate:data.readUInt32LE(p+4),align:data.readUInt16LE(p+12),bits:data.readUInt16LE(p+14)};}
      if(id==='data' && size===null) size=n;
      p+=n+(n%2);
    }
    if(!fmt || fmt.kind!==1 || !fmt.channels || !fmt.rate || !fmt.bits || !size)throw new Error();
    const sampleWidth=Math.ceil(fmt.bits/8), frameSize=fmt.channels*sampleWidth;
    if(fmt.align!==frameSize || size%frameSize)throw new Error();
    return {format:'wav-pcm',channels:fmt.channels,sample_rate:fmt.rate,frames:size/frameSize,sample_width:sampleWidth};
  } catch {throw new Error('invalid or unsupported PCM WAV');}
}
export function inspectMp3(data) {
  let start=0,end=data.length;
  if(data.subarray(0,3).toString('ascii')==='ID3') {
    if(end<10 || ![2,3,4].includes(data[3]) || [...data.subarray(6,10)].some(v=>v&128)) throw new Error('invalid ID3v2 header');
    let size=0;for(const value of data.subarray(6,10))size=(size<<7)|value;
    start=10+size+(data[3]===4 && (data[5]&16)?10:0);if(start>end)throw new Error('truncated ID3v2 tag');
  }
  if(end-start>=128 && data.toString('ascii',end-128,end-125)==='TAG')end-=128;
  const rates=[44100,48000,32000],v1=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320],v2=[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
  let position=start,frames=0,samples=0,firstRate=null,firstChannels=null;
  while(position<end) {
    if(position+4>end)throw new Error('truncated MP3 frame header');
    const h=data.readUInt32BE(position),version=(h>>>19)&3,layer=(h>>>17)&3,bitrate=(h>>>12)&15,rateIndex=(h>>>10)&3,padding=(h>>>9)&1;
    if((h>>>21)!==0x7ff || version===1 || layer!==1 || bitrate===0 || bitrate===15 || rateIndex===3)throw new Error('unsupported or invalid MP3 frame header');
    const rate=rates[rateIndex]/({3:1,2:2,0:4}[version]), length=Math.floor((version===3?144:72)*(version===3?v1:v2)[bitrate]*1000/rate)+padding,channels=((h>>>6)&3)===3?1:2;
    if(length<4 || position+length>end)throw new Error('truncated MP3 frame');
    if(firstRate===null){firstRate=rate;firstChannels=channels;}else if(firstRate!==rate || firstChannels!==channels)throw new Error('MP3 changes sample rate or channel count');
    frames++;samples+=version===3?1152:576;position+=length;
  }
  if(!frames)throw new Error('empty MP3 stream');
  return {format:'mp3',channels:firstChannels,sample_rate:firstRate,frames,duration_seconds:samples/firstRate,duration_estimated:true,validation:'MPEG Layer III frame structure; audio not decoded'};
}

const oggCrcTable=Array.from({length:256},(_,byte)=>{let v=(byte<<24)>>>0;for(let i=0;i<8;i++)v=((v<<1)^((v&0x80000000)?0x04c11db7:0))>>>0;return v;});
export function inspectOggVorbis(data) {
  let position=0,serial=null,sequence=null,continued=false,eos=false,pageCount=0,finalGranule=null,packet=[],packetSize=0;
  const packets=[];
  while(position<data.length) {
    if(eos || position+27>data.length || data.toString('ascii',position,position+4)!=='OggS' || data[position+4]!==0)throw new Error('invalid Ogg page header');
    const flags=data[position+5],granule=data.readBigUInt64LE(position+6),currentSerial=data.readUInt32LE(position+14),currentSequence=data.readUInt32LE(position+18),checksum=data.readUInt32LE(position+22),count=data[position+26];
    if((flags & ~7) || Boolean(flags&1)!==continued)throw new Error('invalid Ogg packet continuation');
    if(serial===null) {if(!(flags&2) || currentSequence!==0)throw new Error('Ogg stream does not start at beginning');serial=currentSerial;sequence=0;}
    else if(currentSerial!==serial || currentSequence!==sequence+1 || (flags&2))throw new Error('unsupported chained or discontinuous Ogg stream');
    sequence=currentSequence;
    const headerEnd=position+27+count;if(headerEnd>data.length)throw new Error('truncated Ogg segment table');
    const lacing=data.subarray(position+27,headerEnd),end=headerEnd+lacing.reduce((a,b)=>a+b,0);if(end>data.length)throw new Error('truncated Ogg page');
    let crc=0;for(let offset=position;offset<end;offset++){const byte=offset>=position+22 && offset<position+26?0:data[offset];crc=(((crc<<8)>>>0)^oggCrcTable[((crc>>>24)^byte)&255])>>>0;}
    if(crc!==checksum)throw new Error('Ogg page checksum mismatch');
    let cursor=headerEnd;
    for(const length of lacing) {
      if(packets.length<3){packet.push(data.subarray(cursor,cursor+length));packetSize+=length;}
      cursor+=length;continued=length===255;
      if(!continued && packets.length<3){packets.push(Buffer.concat(packet,packetSize));packet=[];packetSize=0;}
    }
    if(granule!==0xffffffffffffffffn) finalGranule=granule;
    eos=Boolean(flags&4);position=end;pageCount++;
  }
  if(!eos || continued || packets.length<3)throw new Error('incomplete Ogg Vorbis stream');
  if(!packets.every((packet,i)=>packet.subarray(0,7).equals(Buffer.concat([Buffer.from([[1,3,5][i]]),Buffer.from('vorbis')]))))throw new Error('unsupported Ogg codec or invalid Vorbis headers');
  const first=packets[0];if(first.length<30 || first.readUInt32LE(7)!==0)throw new Error('invalid Vorbis identification header');
  const channels=first[11],rate=first.readUInt32LE(12);if(!channels || !rate || !(first[29]&1))throw new Error('invalid Vorbis audio parameters');
  return {format:'ogg-vorbis',channels,sample_rate:rate,pages:pageCount,duration_seconds:finalGranule===null?null:Number(finalGranule)/rate,validation:'Ogg page checksums and Vorbis headers; audio not decoded'};
}
