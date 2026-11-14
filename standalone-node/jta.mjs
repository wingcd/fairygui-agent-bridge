import {decodeImage} from './images.mjs';

export async function readJta(data) {
  let pos=0;
  const read=n=>{if(n<0 || pos+n>data.length)throw new Error('truncated JTA resource');const result=data.subarray(pos,pos+n);pos+=n;return result;};
  const u8=()=>read(1).readUInt8(0),u16=()=>read(2).readUInt16BE(0),u32=()=>read(4).readUInt32BE(0);
  const name=new TextDecoder('utf8',{fatal:true}).decode(read(u16())),version=u32(),reserved1=u32(),reserved2=u32(),width=u16(),height=u16(),rate=u8(),count=u32();
  if(version!==102 || reserved1 || reserved2 || !width || !height || !rate || count>32767)throw new Error('unsupported JTA header');
  const frames=[];
  for(let i=0;i<count;i++) {
    const delay=u16(),x=u16(),y=u16(),w=u16(),h=u16(),index=u16();
    if(!w || !h || x+w>width || y+h>height)throw new Error('invalid JTA frame rectangle');
    frames.push({rect:[x,y,w,h],delay:Math.floor(delay*1000/24),imageIndex:index});
  }
  const imageCount=u16(),images=[];
  for(let i=0;i<imageCount;i++) {
    const bytes=read(u32());
    if(bytes.length<8 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('unsupported JTA frame image format');
    images.push(await decodeImage(bytes));
  }
  if(pos!==data.length)throw new Error('unsupported trailing JTA data');
  for(const frame of frames) {const image=images[frame.imageIndex];if(!image || image.width!==frame.rect[2] || image.height!==frame.rect[3])throw new Error('invalid JTA frame image');}
  return {name,width,height,interval:Math.floor(rate*1000/24),frames,images};
}
