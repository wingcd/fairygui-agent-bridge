import {readTransitionItemDetails} from './transition-item-reader.mjs';
// Strict reader for the supported package subset.
export function inspectImagePackage(data) {
  let pos=0, strings=[];
  const take=n=>{if(!Number.isSafeInteger(n) || n<0 || pos+n>data.length) throw new Error('truncated package');const out=data.subarray(pos,pos+n);pos+=n;return out;};
  const u8=()=>take(1).readUInt8(0),u16=()=>take(2).readUInt16BE(0),i16=()=>take(2).readInt16BE(0),i32=()=>take(4).readInt32BE(0);
  const str=()=>new TextDecoder('utf8',{fatal:true}).decode(take(u16()));
  const ref=()=>{const n=u16();if(n===65534)return null;if(n===65533)return '';if(n>=strings.length)throw new Error('invalid string reference');return strings[n];};
  if(take(4).toString('ascii')!=='FGUI') throw new Error('invalid FairyGUI package magic');
  const version=i32();if(![1,2,7].includes(version) || u8()!==0)throw new Error('unsupported package version or compression');
  const id=str(),name=str();take(20);const base=pos,count=u8(),short=u8();
  if(count<5 || ![0,1].includes(short))throw new Error('invalid section index');
  const offsets=Array.from({length:count},()=>short?u16():i32());
  function seek(index,required=false) {const offset=offsets[index];if(!offset) {if(required)throw new Error('missing section');return false;}if(offset<2+count*(short?2:4) || base+offset>=data.length) throw new Error('invalid section offset');pos=base+offset;return true;}
  seek(4,true);const n=i32();if(n<0 || n>Math.floor(data.length/2))throw new Error('invalid string count');strings=Array.from({length:n},str);
  const dependencies=[];if(seek(0)){const count=i16();if(count<0)throw new Error('invalid dependency count');for(let i=0;i<count;i++)dependencies.push({id:ref(),name:ref()});if(version>=2){const branches=i16();if(branches!==0)throw new Error('package branches are unsupported');}}
  const items=[];seek(1,true);const itemCount=i16();if(itemCount<0)throw new Error('invalid item count');
  for(let i=0;i<itemCount;i++) {
    const size=i32(),end=pos+size;if(size<0 || end>data.length)throw new Error('invalid item size');
    const type=u8(),item={type,id:ref(),name:ref()};ref();item.file=ref();item.exported=Boolean(u8());item.width=i32();item.height=i32();
    if(type===0) {const scale=u8();if(scale===1){item.scale9Grid=Array.from({length:4},i32);item.tileGridIndex=i32();}else if(scale===2)item.scaleByTile=true;else if(scale!==0)throw new Error('invalid scale');item.smoothing=Boolean(u8());}
    else if(type===3) {
      item.extension=u8();const length=i32();if(length<26 || pos+length>end)throw new Error('invalid component payload size');
      const raw=take(length);if(![6,7,8].includes(raw[0]) || raw[1]!==0 || raw.length<2+4*raw[0])throw new Error('unsupported component sections');
      const offsets=Array.from({length:6},(_,j)=>raw.readInt32BE(2+j*4));
      if(offsets.some(o=>o<2+4*raw[0] || o>=raw.length) || offsets.some((o,j)=>j && o<=offsets[j-1]))throw new Error('invalid component offsets');
      if(offsets[0]+13>raw.length || offsets[2]+2>raw.length)throw new Error('truncated component');
      item.component={width:raw.readInt32BE(offsets[0]),height:raw.readInt32BE(offsets[0]+4),childCount:raw.readInt16BE(offsets[2])};
      if(item.component.childCount<0)throw new Error('invalid child count');
      const childRefs=index=>{if(index===65534)return null;if(index===65533)return '';if(index>=strings.length)throw new Error('invalid child string reference');return strings[index];};
      {
        let cursor=offsets[4];const limit=offsets[5],take=n=>{const pos=cursor;cursor+=n;if(cursor>limit)throw new Error('truncated component settings');return pos;},byte=()=>raw[take(1)],short=()=>raw.readInt16BE(take(2)),int=()=>raw.readInt32BE(take(4)),ref=()=>childRefs(raw.readUInt16BE(take(2)));
        const customData=ref(),opaque=Boolean(byte()),mask=short(),reversedMask=mask!==-1?Boolean(byte()):false,hitTestImage=ref(),hitTestOffset=int(),hitTestChild=int();
        item.component.settings={customData,opaque,mask,reversedMask,hitTestImage,hitTestOffset,hitTestChild};
      }
      {
        let cursor=offsets[0]+8;const limit=offsets[1],take=n=>{const pos=cursor;cursor+=n;if(cursor>limit)throw new Error('truncated component base');return pos;},byte=()=>raw[take(1)],int=()=>raw.readInt32BE(take(4)),float=()=>raw.readFloatBE(take(4));
        const constraints=byte()?Array.from({length:4},int):null,pivot=byte()?[float(),float(),Boolean(byte())]:null,margin=byte()?Array.from({length:4},int):null,overflow=byte(),clipSoftness=byte()?[int(),int()]:null;
        item.component.layout={constraints,pivot,margin,overflow,clipSoftness,scroll:null};
        if(overflow===2){if(raw[0]<8)throw new Error('missing component scroll section');const offset=raw.readInt32BE(30);if(offset<2+4*raw[0]||offset+7>raw.length)throw new Error('invalid component scroll section');let cursor=offset;const take=n=>{const pos=cursor;cursor+=n;if(cursor>raw.length)throw new Error('truncated component scroll section');return pos;},byte=()=>raw[take(1)],int=()=>raw.readInt32BE(take(4)),ref=()=>childRefs(raw.readUInt16BE(take(2)));const type=byte(),barDisplay=byte(),flags=int(),barMargin=byte()?Array.from({length:4},int):null;item.component.layout.scroll={type,barDisplay,flags,barMargin,resources:[ref(),ref(),ref(),ref()]};}
      }
      if([12,13,14,15].includes(item.extension)){
        if(raw[0]<7)throw new Error('missing component extension section');const extensionOffset=raw.readInt32BE(26),later=raw[0]>7?raw.readInt32BE(30):0,limit=later||raw.length,required=item.extension===12?12:2;
        if(extensionOffset<=offsets[5]||extensionOffset+required>limit||limit>raw.length)throw new Error('invalid component extension section');
        if(item.extension===12)item.component.buttonOptions={mode:raw[extensionOffset],sound:childRefs(raw.readUInt16BE(extensionOffset+1)),volume:raw.readFloatBE(extensionOffset+3),downEffect:raw[extensionOffset+7],downEffectValue:raw.readFloatBE(extensionOffset+8)};
        else if(item.extension===13)item.component.comboOptions={dropdown:childRefs(raw.readUInt16BE(extensionOffset))};
        else item.component.progressOptions={titleType:raw[extensionOffset],reverse:Boolean(raw[extensionOffset+1])};
      }
      if(offsets[1]+2>offsets[2])throw new Error('truncated controller section');const controllerCount=raw.readInt16BE(offsets[1]);if(controllerCount<0)throw new Error('invalid controller count');const controllers=[];let controllerAt=offsets[1]+2;
      for(let j=0;j<controllerCount;j++){
        if(controllerAt+2>offsets[2])throw new Error('truncated controller');const length=raw.readInt16BE(controllerAt);controllerAt+=2;const end=controllerAt+length;if(length<6||end>offsets[2])throw new Error('invalid controller size');
        const blocks=raw[controllerAt],shortOffsets=raw[controllerAt+1],header=2+blocks*(shortOffsets?2:4);if(blocks<2||![0,1].includes(shortOffsets)||controllerAt+header>end)throw new Error('invalid controller index');
        const readOffset=index=>shortOffsets?raw.readUInt16BE(controllerAt+2+index*2):raw.readInt32BE(controllerAt+2+index*4),headOffset=readOffset(0),pageOffset=readOffset(1),head=controllerAt+headOffset,pagesAt=controllerAt+pageOffset;
        if(headOffset<header||pageOffset<header||head+3>end||pagesAt+2>end)throw new Error('invalid controller sections');const pageCount=raw.readInt16BE(pagesAt);if(pageCount<0||pagesAt+2+pageCount*4>end)throw new Error('invalid controller pages');
        const pages=[];for(let page=0;page<pageCount;page++)pages.push({id:childRefs(raw.readUInt16BE(pagesAt+2+page*4)),name:childRefs(raw.readUInt16BE(pagesAt+4+page*4))});
        const actions=[];const actionOffset=blocks>2?readOffset(2):0;if(actionOffset){let cursor=controllerAt+actionOffset;if(actionOffset<header||cursor+2>end)throw new Error('invalid controller action section');const count=raw.readInt16BE(cursor);cursor+=2;if(count<0)throw new Error('invalid controller action count');
          for(let k=0;k<count;k++){if(cursor+2>end)throw new Error('truncated controller action');const size=raw.readInt16BE(cursor);cursor+=2;const actionEnd=cursor+size;if(size<5||actionEnd>end)throw new Error('invalid controller action size');const kind=raw[cursor++];
            const pagesList=()=>{if(cursor+2>actionEnd)throw new Error('truncated controller action pages');const n=raw.readInt16BE(cursor);cursor+=2;if(n<0||cursor+2*n>actionEnd)throw new Error('invalid controller action pages');const result=[];for(let n1=0;n1<n;n1++){result.push(childRefs(raw.readUInt16BE(cursor)));cursor+=2;}return result;};
            const from=pagesList(),to=pagesList();if(kind===0){if(cursor+11>actionEnd)throw new Error('truncated play transition action');actions.push({type:0,from,to,transition:childRefs(raw.readUInt16BE(cursor)),times:raw.readInt32BE(cursor+2),delay:raw.readFloatBE(cursor+6),stopOnExit:Boolean(raw[cursor+10])});}
            else if(kind===1){if(cursor+6>actionEnd)throw new Error('truncated change page action');actions.push({type:1,from,to,object:childRefs(raw.readUInt16BE(cursor)),controller:childRefs(raw.readUInt16BE(cursor+2)),page:childRefs(raw.readUInt16BE(cursor+4))});}else throw new Error('unsupported controller action type');cursor=actionEnd;
          }
        }controllers.push({name:childRefs(raw.readUInt16BE(head)),pages,actions});controllerAt=end;
      }
      item.component.controllers=controllers;
      const childRecords=[];let at=offsets[2]+2;const sectionEnd=offsets[3];
      for(let j=0;j<item.component.childCount;j++){
        if(at+2>sectionEnd)throw new Error('truncated component child');const length=raw.readInt16BE(at);at+=2;const end=at+length;
        if(length<4||end>sectionEnd)throw new Error('invalid component child size');const blocks=raw[at],shortOffsets=raw[at+1],header=2+blocks*(shortOffsets?2:4);
        if(!blocks||![0,1].includes(shortOffsets)||at+header>end)throw new Error('invalid component child index');const offset=shortOffsets?raw.readUInt16BE(at+2):raw.readInt32BE(at+2),base=at+offset;
        if(offset<header||base+17>end)throw new Error('invalid component child base');
        const record={type:raw[base],src:childRefs(raw.readUInt16BE(base+1)),pkg:childRefs(raw.readUInt16BE(base+3)),id:childRefs(raw.readUInt16BE(base+5)),name:childRefs(raw.readUInt16BE(base+7)),x:raw.readInt32BE(base+9),y:raw.readInt32BE(base+13)};let cursor=base+17;
        const take=n=>{const pos=cursor;cursor+=n;if(cursor>end)throw new Error('truncated component child properties');return pos;},byte=()=>raw[take(1)],int=()=>raw.readInt32BE(take(4)),float=()=>raw.readFloatBE(take(4));
        if(byte())record.size=[int(),int()];if(byte())record.constraints=[int(),int(),int(),int()];if(byte())record.scale=[float(),float()];if(byte())record.skew=[float(),float()];if(byte())record.pivot=[float(),float(),Boolean(byte())];record.alpha=float();record.rotation=float();record.visible=Boolean(byte());record.touchable=Boolean(byte());record.grayed=Boolean(byte());
        if([6,7,8].includes(record.type)){
          if(blocks<7)throw new Error('missing text sections');const index=section=>shortOffsets?raw.readUInt16BE(at+2+section*2):raw.readInt32BE(at+2+section*4),style=index(5),content=index(6),styleAt=at+style,textAt=at+content;
          if(style<header||content<header||styleAt+20>end||textAt+2>end)throw new Error('invalid text sections');
          record.text=childRefs(raw.readUInt16BE(textAt));record.textStyle={font:childRefs(raw.readUInt16BE(styleAt)),fontSize:raw.readInt16BE(styleAt+2),color:Array.from(raw.subarray(styleAt+4,styleAt+8)),align:raw[styleAt+8],vAlign:raw[styleAt+9],leading:raw.readInt16BE(styleAt+10),letterSpacing:raw.readInt16BE(styleAt+12),ubb:Boolean(raw[styleAt+14]),autoSize:raw[styleAt+15],underline:Boolean(raw[styleAt+16]),italic:Boolean(raw[styleAt+17]),bold:Boolean(raw[styleAt+18]),singleLine:Boolean(raw[styleAt+19])};
          let styleCursor=styleAt+20;const styleEnd=content>style?Math.min(end,textAt):end,styleTake=n=>{const pos=styleCursor;styleCursor+=n;if(styleCursor>styleEnd)throw new Error('truncated text effects');return pos;};
          if(raw[styleTake(1)]){record.textStyle.strokeColor=Array.from(raw.subarray(styleTake(4),styleCursor));record.textStyle.stroke=raw.readFloatBE(styleTake(4));}
          if(raw[styleTake(1)]){record.textStyle.shadowColor=Array.from(raw.subarray(styleTake(4),styleCursor));record.textStyle.shadowOffset=[raw.readFloatBE(styleTake(4)),raw.readFloatBE(styleTake(4))];}styleTake(1);
          if(record.type===8){const input=index(4),inputAt=at+input;if(input<header||inputAt+13>end)throw new Error('invalid text input section');record.input={prompt:childRefs(raw.readUInt16BE(inputAt)),restrict:childRefs(raw.readUInt16BE(inputAt+2)),maxLength:raw.readInt32BE(inputAt+4),keyboardType:raw.readInt32BE(inputAt+8),password:Boolean(raw[inputAt+12])};}
        }
        if(record.type===5){if(blocks<6)throw new Error('missing group style');const offset=shortOffsets?raw.readUInt16BE(at+12):raw.readInt32BE(at+22),pos=at+offset,size=version>=2?13:9;if(offset<header||pos+size>end)throw new Error('invalid group style');record.groupStyle={layout:raw[pos],lineGap:raw.readInt32BE(pos+1),colGap:raw.readInt32BE(pos+5),excludeInvisibles:version>=2?Boolean(raw[pos+9]):false,autoSizeDisabled:version>=2?Boolean(raw[pos+10]):false,mainGridIndex:version>=2?raw.readInt16BE(pos+11):-1};}
        if([0,1].includes(record.type)){
          if(blocks<6)throw new Error('missing image or movieclip style');const offset=shortOffsets?raw.readUInt16BE(at+12):raw.readInt32BE(at+22);let pos=at+offset;if(offset<header||pos>=end)throw new Error('invalid image or movieclip style');
          const take=n=>{const start=pos;pos+=n;if(pos>end)throw new Error('truncated image or movieclip style');return start;},byte=()=>raw[take(1)];let color=null;if(byte()){const start=take(4);color=Array.from(raw.subarray(start,start+4));}const flip=byte();
          if(record.type===0){const fillMethod=byte(),style={color,flip,fillMethod};if(fillMethod){style.fillOrigin=byte();style.fillClockwise=Boolean(byte());style.fillAmount=raw.readFloatBE(take(4));}record.imageStyle=style;}
          else record.movieclipStyle={color,flip,frame:raw.readInt32BE(take(4)),playing:Boolean(byte())};
        }
        if([10,17].includes(record.type)){
          if(blocks<9)throw new Error('missing list sections');
          const index=section=>shortOffsets?raw.readUInt16BE(at+2+section*2):raw.readInt32BE(at+2+section*4),offset=index(5),next=Array.from({length:blocks},(_,section)=>index(section)).filter(value=>value>offset),limit=next.length?Math.min(end,at+Math.min(...next)):end,pos=at+offset;
          if(offset<header||pos+16>limit)throw new Error('invalid list style');
          record.listStyle={layout:raw[pos],selectionMode:raw[pos+1],align:raw[pos+2],vAlign:raw[pos+3],lineGap:raw.readInt16BE(pos+4),colGap:raw.readInt16BE(pos+6),lineCount:raw.readInt16BE(pos+8),columnCount:raw.readInt16BE(pos+10),autoItemSize:Boolean(raw[pos+12]),renderOrder:raw[pos+13],apexIndex:raw.readInt16BE(pos+14)};
          let cursor=pos+16;const take=n=>{const start=cursor;cursor+=n;if(cursor>limit)throw new Error('truncated list style');return start;},byte=()=>raw[take(1)],int=()=>raw.readInt32BE(take(4));
          const margin=byte()?Array.from({length:4},int):null,overflow=byte(),clipSoftness=byte()?[int(),int()]:null;
          record.listStyle.scrollItemToViewOnClick=version>=2?Boolean(byte()):true;
          record.listStyle.foldInvisibleItems=version>=2?Boolean(byte()):false;
          const readController=section=>{const value=index(section);if(!value)return -1;const start=at+value,following=Array.from({length:blocks},(_,i)=>index(i)).filter(other=>other>value),boundary=following.length?Math.min(end,at+Math.min(...following)):end;if(value<header||start+2>boundary)throw new Error('invalid list controller section');return raw.readInt16BE(start);};
          record.listBehavior={margin,overflow,clipSoftness,pageController:readController(4),selectionController:readController(6),scroll:null};
          if(overflow===2){const offset=index(7),start=at+offset,following=Array.from({length:blocks},(_,i)=>index(i)).filter(other=>other>offset),boundary=following.length?Math.min(end,at+Math.min(...following)):end;if(offset<header||start+7>boundary)throw new Error('invalid list scroll section');let cursor=start;const take=n=>{const pos=cursor;cursor+=n;if(cursor>boundary)throw new Error('truncated list scroll section');return pos;},byte=()=>raw[take(1)],int=()=>raw.readInt32BE(take(4)),ref=()=>childRefs(raw.readUInt16BE(take(2)));const type=byte(),barDisplay=byte(),flags=int(),barMargin=byte()?Array.from({length:4},int):null;record.listBehavior.scroll={type,barDisplay,flags,barMargin,resources:[ref(),ref(),ref(),ref()]};}
          const itemOffset=index(8),later=Array.from({length:blocks},(_,section)=>index(section)).filter(value=>value>itemOffset),itemLimit=later.length?Math.min(end,at+Math.min(...later)):end;
          if(itemOffset<header||at+itemOffset+4>itemLimit)throw new Error('invalid list item section');let itemPos=at+itemOffset;
          const itemTake=(n,bound=itemLimit)=>{const start=itemPos;itemPos+=n;if(itemPos>bound)throw new Error('truncated list item');return start;},short=(bound=itemLimit)=>raw.readInt16BE(itemTake(2,bound)),ref=(bound=itemLimit)=>childRefs(raw.readUInt16BE(itemTake(2,bound)));
          const defaultItem=ref(),count=short(),items=[];if(count<0)throw new Error('invalid list item count');
          for(let i=0;i<count;i++){
            const length=short(),itemEnd=itemPos+length;if(length<0||itemEnd>itemLimit)throw new Error('invalid list item length');const item={url:ref(itemEnd)};
            if(record.type===17){item.folder=Boolean(raw[itemTake(1,itemEnd)]);item.level=raw[itemTake(1,itemEnd)];}
            for(const key of ['title','selectedTitle','icon','selectedIcon','name'])item[key]=ref(itemEnd);
            const controllers=short(itemEnd);if(controllers<0)throw new Error('invalid list item controller count');item.controllers=[];for(let j=0;j<controllers;j++)item.controllers.push([ref(itemEnd),ref(itemEnd)]);
            item.properties=[];if(version>=2){const properties=short(itemEnd);if(properties<0)throw new Error('invalid list item property count');for(let j=0;j<properties;j++)item.properties.push([ref(itemEnd),short(itemEnd),ref(itemEnd)]);}
            itemPos=itemEnd;items.push(item);
          }
          record.listContent={defaultItem,items};
          if(record.type===17){if(blocks<10)throw new Error('missing tree settings');const treeOffset=index(9),treePos=at+treeOffset;if(treeOffset<header||treePos+5>end)throw new Error('invalid tree settings');record.listContent.indent=raw.readInt32BE(treePos);record.listContent.clickToExpand=raw[treePos+4];}
        }
        if(record.type===3){
          if(blocks<6)throw new Error('missing graph style');const offset=shortOffsets?raw.readUInt16BE(at+12):raw.readInt32BE(at+22);let pos=at+offset;if(offset<header||pos>=end)throw new Error('invalid graph style');
          const take=n=>{const start=pos;pos+=n;if(pos>end)throw new Error('truncated graph style');return start;},byte=()=>raw[take(1)],int=()=>raw.readInt32BE(take(4)),short=()=>raw.readInt16BE(take(2)),float=()=>raw.readFloatBE(take(4)),color=()=>{const start=take(4);return Array.from(raw.subarray(start,start+4));},type=byte(),graph={type};
          if(type){graph.lineSize=int();graph.lineColor=color();graph.fillColor=color();if(byte())graph.cornerRadius=[float(),float(),float(),float()];if(type===3){const count=short();if(count<0||pos+count*4>end)throw new Error('invalid graph points');graph.points=Array.from({length:count},float);}else if(type===4){graph.sides=short();graph.startAngle=float();const count=short();if(count<0||pos+count*4>end)throw new Error('invalid graph distances');graph.distances=Array.from({length:count},float);}}
          record.graphStyle=graph;
        }
        if(record.type===4){
          if(blocks<6)throw new Error('missing loader style');const offset=shortOffsets?raw.readUInt16BE(at+12):raw.readInt32BE(at+22);let pos=at+offset;if(offset<header||pos>=end)throw new Error('invalid loader style');
          const take=n=>{const start=pos;pos+=n;if(pos>end)throw new Error('truncated loader style');return start;},byte=()=>raw[take(1)],ref=()=>childRefs(raw.readUInt16BE(take(2))),style={url:ref(),align:byte(),vAlign:byte(),fill:byte(),shrinkOnly:Boolean(byte()),autoSize:Boolean(byte()),showErrorSign:Boolean(byte()),playing:Boolean(byte()),frame:raw.readInt32BE(take(4)),color:null};if(byte()){const start=take(4);style.color=Array.from(raw.subarray(start,start+4));}style.fillMethod=byte();if(style.fillMethod){style.fillOrigin=byte();style.fillClockwise=Boolean(byte());style.fillAmount=raw.readFloatBE(take(4));}record.loaderStyle=style;
        }
        if(record.type===9&&blocks>6){
          const offset=shortOffsets?raw.readUInt16BE(at+14):raw.readInt32BE(at+26);
          if(offset){let pos=at+offset;if(offset<header||pos>end)throw new Error('invalid component instance section');if(pos===end){childRecords.push(record);at=end;continue;}const take=n=>{const start=pos;pos+=n;if(pos>end)throw new Error('truncated component instance section');return start;},byte=()=>raw[take(1)],short=()=>raw.readInt16BE(take(2)),int=()=>raw.readInt32BE(take(4)),ref=()=>childRefs(raw.readUInt16BE(take(2))),color=()=>{const start=take(4);return Array.from(raw.subarray(start,start+4));};const kind=byte();
            if(kind===14||kind===15)record.progressInstance={kind,value:int(),max:int(),min:version>=2?int():0};
            else if(kind===11){const label={title:ref(),icon:ref(),color:byte()?color():null,fontSize:int()};if(byte())take(13);label.sound=ref();if(label.sound!==null&&byte())label.volume=raw.readFloatBE(take(4));record.labelInstance=label;}
            else if(kind===12){const button={title:ref(),selectedTitle:ref(),icon:ref(),selectedIcon:ref(),color:byte()?color():null,fontSize:int(),controller:short(),page:ref(),sound:ref()};if(byte())button.volume=raw.readFloatBE(take(4));button.checked=Boolean(byte());record.buttonInstance=button;}
            else if(kind===13){const count=short();if(count<0)throw new Error('invalid ComboBox item count');const items=[];for(let i=0;i<count;i++){const length=short(),itemEnd=pos+length;if(length<0||itemEnd>end)throw new Error('invalid ComboBox item length');const item={title:ref(),value:ref(),icon:ref()};if(pos>itemEnd)throw new Error('truncated ComboBox item');pos=itemEnd;items.push(item);}record.comboInstance={items,title:ref(),icon:ref(),color:byte()?color():null,visibleItemCount:int(),popupDirection:byte(),controller:short()};}
          }
        }
        childRecords.push(record);at=end;
      }
      item.component.children=childRecords;
      const later=Array.from({length:raw[0]-6},(_,j)=>raw.readInt32BE(2+(j+6)*4)).filter(offset=>offset>offsets[5]),transitionEnd=later.length?Math.min(...later):raw.length;
      if(offsets[5]+2>transitionEnd)throw new Error('truncated transition section');const transitionCount=raw.readInt16BE(offsets[5]);if(transitionCount<0)throw new Error('invalid transition count');const transitions=[];let transitionAt=offsets[5]+2;
      for(let j=0;j<transitionCount;j++){
        if(transitionAt+2>transitionEnd)throw new Error('truncated transition');const size=raw.readInt16BE(transitionAt);transitionAt+=2;const end=transitionAt+size;if(size<17||end>transitionEnd)throw new Error('invalid transition size');
        const transition={name:childRefs(raw.readUInt16BE(transitionAt)),options:raw.readInt32BE(transitionAt+2),autoPlay:Boolean(raw[transitionAt+6]),autoPlayTimes:raw.readInt32BE(transitionAt+7),autoPlayDelay:raw.readFloatBE(transitionAt+11),items:[]},count=raw.readInt16BE(transitionAt+15);if(count<0)throw new Error('invalid transition item count');let cursor=transitionAt+17;
        for(let k=0;k<count;k++){if(cursor+2>end)throw new Error('truncated transition item');const length=raw.readInt16BE(cursor);cursor+=2;const itemEnd=cursor+length;if(length<4||itemEnd>end)throw new Error('invalid transition item size');const blocks=raw[cursor],shortOffsets=raw[cursor+1],header=2+blocks*(shortOffsets?2:4);if(!blocks||![0,1].includes(shortOffsets)||cursor+header>itemEnd)throw new Error('invalid transition item index');const offset=shortOffsets?raw.readUInt16BE(cursor+2):raw.readInt32BE(cursor+2),base=cursor+offset;if(offset<header||base+10>itemEnd)throw new Error('invalid transition item header');transition.items.push({type:raw[base],time:raw.readFloatBE(base+1),target:raw.readInt16BE(base+5),label:childRefs(raw.readUInt16BE(base+7)),tween:Boolean(raw[base+9]),...readTransitionItemDetails(raw,cursor,itemEnd,version,childRefs)});cursor=itemEnd;}
        transitions.push(transition);transitionAt=end;
      }
      item.component.transitions=transitions;
    }
    else if(type===5) {
      const length=i32();if(length<0 || pos+length>end)throw new Error('invalid font payload size');
      const raw=take(length);if(raw.length<10 || raw[0]<2 || raw[1]!==0)throw new Error('invalid font sections');
      const a=raw.readInt32BE(2),b=raw.readInt32BE(6);if(a<10 || a+16>raw.length || b<a+16 || b+4>raw.length)throw new Error('invalid font offsets');
      const glyphs=[];let at=b;const count=raw.readInt32BE(at);at+=4;if(count<0 || count>65536)throw new Error('invalid glyph count');
      for(let j=0;j<count;j++) {
        if(at+2>raw.length)throw new Error('truncated glyph');const size=raw.readInt16BE(at);at+=2;const glyphEnd=at+size;if(size<33 || glyphEnd>raw.length)throw new Error('invalid glyph size');
        const glyphId=raw.readUInt16BE(at),index=raw.readUInt16BE(at+2),image=index===65534?null:index===65533?'':strings[index];if(image===undefined)throw new Error('invalid string reference');
        glyphs.push({id:glyphId,image,x:raw.readInt32BE(at+4),y:raw.readInt32BE(at+8),xOffset:raw.readInt32BE(at+12),yOffset:raw.readInt32BE(at+16),width:raw.readInt32BE(at+20),height:raw.readInt32BE(at+24),xAdvance:raw.readInt32BE(at+28),channel:raw[at+32]});at=glyphEnd;
      }
      item.font={ttf:Boolean(raw[a]),canTint:Boolean(raw[a+1]),resizable:Boolean(raw[a+2]),hasChannel:Boolean(raw[a+3]),fontSize:raw.readInt32BE(a+4),xAdvance:raw.readInt32BE(a+8),lineHeight:raw.readInt32BE(a+12),glyphs};
    }
    else if(type===1) {
      item.smoothing=Boolean(u8());const length=i32();if(length<0 || pos+length>end)throw new Error('invalid movieclip payload size');
      const raw=take(length);if(raw.length<10 || raw[0]<2 || raw[1]!==0)throw new Error('invalid movieclip sections');
      const a=raw.readInt32BE(2),b=raw.readInt32BE(6);if(a<10 || a+9>raw.length || b<a+9 || b+2>raw.length)throw new Error('invalid movieclip offsets');
      let at=b;const count=raw.readInt16BE(at);at+=2;if(count<0)throw new Error('invalid movieclip frame count');const frames=[];
      for(let j=0;j<count;j++) {
        if(at+2>raw.length)throw new Error('truncated movieclip frame');const size=raw.readInt16BE(at);at+=2;const frameEnd=at+size;if(size<22 || frameEnd>raw.length)throw new Error('invalid movieclip frame size');
        const rect=[0,1,2,3].map(i=>raw.readInt32BE(at+i*4)),delay=raw.readInt32BE(at+16),index=raw.readUInt16BE(at+20);
        const sprite=index===65534?null:index===65533?'':strings[index];if(sprite===undefined)throw new Error('invalid string reference');
        frames.push({rect,delay,sprite});at=frameEnd;
      }
      item.movieclip={interval:raw.readInt32BE(a),swing:Boolean(raw[a+4]),repeatDelay:raw.readInt32BE(a+5),frames};
    }
    else if(type!==4 && type!==2)throw new Error('unsupported package item');
    if(pos>end)throw new Error('truncated item');pos=end;items.push(item);
  }
  const sprites=[];if(seek(2)) {
    const n=i16();if(n<0)throw new Error('invalid sprite count');
    for(let i=0;i<n;i++) {const size=i16(),end=pos+size;if(size<0 || end>data.length)throw new Error('invalid sprite size');const s={id:ref(),atlas:ref(),x:i32(),y:i32(),width:i32(),height:i32(),rotated:Boolean(u8())};if(version>=2 && u8()) Object.assign(s,{offset_x:i32(),offset_y:i32(),original_width:i32(),original_height:i32()});if(pos>end)throw new Error('truncated sprite');pos=end;sprites.push(s);}
  }
  const hitTests=[];if(seek(3)){const count=i16();if(count<0)throw new Error('invalid pixel hit count');for(let i=0;i<count;i++){const size=i32(),end=pos+size;if(size<15||end>data.length)throw new Error('invalid pixel hit record');const id=ref(),reserved=i32(),width=i32(),divisor=u8(),length=i32();if(reserved!==0||width<=0||![1,2].includes(divisor)||length<0||pos+length!==end)throw new Error('invalid pixel hit data');const pixels=take(length);hitTests.push({id,width,divisor,pixels:Buffer.from(pixels).toString('base64')});}}
  const ids=new Set();for(const item of items) {if(!item.id || ids.has(item.id))throw new Error('missing or duplicate item id');ids.add(item.id);}
  const spriteIds=new Set(), atlases=new Map(items.filter(i=>i.type===4).map(i=>[i.id,i]));
  for(const sprite of sprites) {
    if(!sprite.id || spriteIds.has(sprite.id))throw new Error('missing or duplicate sprite id');spriteIds.add(sprite.id);
    const atlas=atlases.get(sprite.atlas), w=sprite.rotated?sprite.height:sprite.width,h=sprite.rotated?sprite.width:sprite.height;
    if(!atlas || sprite.x<0 || sprite.y<0 || w<=0 || h<=0 || sprite.x+w>atlas.width || sprite.y+h>atlas.height)throw new Error('invalid sprite atlas bounds');
    if(sprite.original_width!==undefined && (sprite.offset_x<0 || sprite.offset_y<0 || sprite.offset_x+sprite.width>sprite.original_width || sprite.offset_y+sprite.height>sprite.original_height)) throw new Error('invalid sprite trim');
  }
  return {version,id,name,dependencies,items,sprites,hitTests};
}
