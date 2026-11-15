// FairyGUI binary records for the supported standalone publisher subset.
const byte = n => Buffer.from([Number(n)]);
function i16(n) { const b=Buffer.alloc(2);b.writeInt16BE(n);return b; }
function u16(n) { const b=Buffer.alloc(2);b.writeUInt16BE(n);return b; }
function i32(n) { const b=Buffer.alloc(4);b.writeInt32BE(n);return b; }
function f32(n) { const b=Buffer.alloc(4);b.writeFloatBE(n);return b; }
const join = list => Buffer.concat(list);
function str(value) {const b=Buffer.from(value,'utf8');if(b.length>65535) throw new Error('string too long');return join([u16(b.length),b]);}

export function encodeImagePackage(packageId, packageName, images, pages, {spriteTrim={},sounds=[],movieclips=[],fonts=[],components=[],dependencies=[],hitTests=[]} = {}) {
  if(!packageId || !packageName) throw new Error('package id and name required');
  const version=Object.keys(spriteTrim).length || components.some(c=>(c.transitions??[]).some(t=>t.items.some(a=>a.tween?.path?.length))) || components.some(c=>c.children.some(child=>(child.gears??[]).some(g=>g.type==='display2')||(child.progress?.[2]??0)!==0||child.list?.scrollItemToViewOnClick===false||child.list?.foldInvisibleItems===true||child.groupStyle?.excludeInvisibles||child.groupStyle?.autoSizeDisabled||(child.groupStyle?.mainGridIndex??-1)!==-1)) ? 2 : 1, table=[], indices=new Map();
  function ref(value) {
    if(value===null || value===undefined) return u16(65534);
    if(value==='') return u16(65533);
    if(!indices.has(value)) {if(table.length>=65533) throw new Error('string table too large');indices.set(value,table.length);table.push(value);}
    return u16(indices.get(value));
  }
  const placements=new Map();
  pages.forEach((page,index)=>page.items.forEach(item=>{if(placements.has(item.id)) throw new Error('duplicate layout id');placements.set(item.id,{index,item});}));
  const allSprites=[...images,...movieclips.flatMap(clip=>clip.frames)];
  if(placements.size!==allSprites.length || allSprites.some(image=>!placements.has(image.id)) || new Set(allSprites.map(i=>i.id)).size!==allSprites.length) throw new Error('image and layout ids do not match');
  for(const [id,trim] of Object.entries(spriteTrim)) {
    const image=images.find(i=>i.id===id), placement=placements.get(id);
    if(!image) throw new Error('trim references unknown image');
    if(!Array.isArray(trim) || trim.length!==4 || trim.some(x=>!Number.isInteger(x) || x<0)) throw new Error('invalid sprite trim');
    const [x,y,w,h]=trim;
    if(w!==image.width || h!==image.height || x+placement.item.width>w || y+placement.item.height>h) throw new Error('sprite trim outside original image');
  }
  if(images.length+pages.length+sounds.length+movieclips.length+fonts.length+components.length>32767) throw new Error('too many items');
  const records=[];
  for(const image of images) {
    const parts=[byte(0),ref(image.id),ref(image.name),ref(null),ref(null),byte(Boolean(image.exported)),i32(image.width),i32(image.height)];
    if(image.scale9grid!==undefined && image.scale9grid!==null) parts.push(byte(1),...image.scale9grid.map(i32),i32(0));
    else parts.push(byte(image.scaleByTile ? 2 : 0));
    parts.push(byte(1)); if(version>=2) parts.push(ref(null),byte(0),byte(0));
    const record=join(parts);records.push(i32(record.length),record);
  }
  pages.forEach((page,index)=>{
    const parts=[byte(4),ref('atlas'+index),ref(null),ref(null),ref('atlas'+index+'.png'),byte(0),i32(page.width),i32(page.height)];
    if(version>=2) parts.push(ref(null),byte(0),byte(0));
    const record=join(parts);records.push(i32(record.length),record);
  });
  for(const sound of sounds) {
    const parts=[byte(2),ref(sound.id),ref(sound.name),ref(null),ref(sound.file),byte(Boolean(sound.exported)),i32(0),i32(0)];
    if(version>=2) parts.push(ref(null),byte(0),byte(0));
    const record=join(parts);records.push(i32(record.length),record);
  }
  for(const clip of movieclips) {
    const frames=[];for(const frame of clip.frames) {const raw=join([...frame.rect.map(i32),i32(frame.delay),ref(frame.id)]);frames.push(i16(raw.length),raw);}
    const timing=join([i32(clip.interval),byte(0),i32(0)]),frameSection=join([i16(clip.frames.length),...frames]);
    const indexed=join([byte(2),byte(0),i32(10),i32(10+timing.length),timing,frameSection]);
    const parts=[byte(1),ref(clip.id),ref(clip.name),ref(null),ref(null),byte(Boolean(clip.exported)),i32(clip.width),i32(clip.height),byte(1),i32(indexed.length),indexed];
    if(version>=2)parts.push(ref(null),byte(0),byte(0));const record=join(parts);records.push(i32(record.length),record);
  }
  for(const font of fonts) {
    const glyphs=[];
    for(const glyph of font.glyphs) {
      if(glyph.image && placements.get(glyph.image)?.item.rotated)throw new Error('bitmap font glyphs cannot be rotated');
      const raw=join([u16(glyph.id),ref(glyph.image),...['x','y','xOffset','yOffset','width','height','xAdvance'].map(k=>i32(glyph[k])),byte(glyph.channel)]);glyphs.push(i16(raw.length),raw);
    }
    const header=join([byte(font.ttf),byte(font.canTint),byte(font.resizable),byte(font.hasChannel),i32(font.fontSize),i32(font.xAdvance),i32(font.lineHeight)]);
    const glyphData=join([i32(font.glyphs.length),...glyphs]), indexed=join([byte(2),byte(0),i32(10),i32(10+header.length),header,glyphData]);
    const parts=[byte(5),ref(font.id),ref(font.name),ref(null),ref(null),byte(Boolean(font.exported)),i32(0),i32(0),i32(indexed.length),indexed];
    if(version>=2)parts.push(ref(null),byte(0),byte(0));const record=join(parts);records.push(i32(record.length),record);
  }
  for(const component of components) {
    const indexed=sections=>{let offset=2+4*sections.length;const offsets=sections.map(s=>{const at=s.length?offset:0;offset+=s.length;return i32(at);});return join([byte(sections.length),byte(0),...offsets,...sections]);};
    const relations=items=>join([byte(items.length),...items.flatMap(r=>[i16(r.target),byte(r.types.length),...r.types.flatMap(type=>[byte(type),byte(0)])])]);
    const childRecords=[];
    for(const child of component.children) {
      const text=['text','richtext','inputtext'].includes(child.type);
      const base=join([byte(child.type==='tree'?17:child.type==='list'?10:child.type==='component'?9:child.type==='group'?5:child.type==='loader'?4:child.type==='graph'?3:child.type==='movieclip'?1:child.type==='inputtext'?8:child.type==='richtext'?7:text?6:0),ref(child.src),ref(child.pkg),ref(child.id),ref(child.name),i32(child.x),i32(child.y),...(child.size?[byte(1),...child.size.map(i32)]:[byte(0)]),...(child.constraints?[byte(1),...child.constraints.map(i32)]:[byte(0)]),...(child.scale?[byte(1),...child.scale.map(f32)]:[byte(0)]),byte(0),...(child.pivot?[byte(1),...child.pivot.map(f32),byte(child.anchor??false)]:[byte(0)]),f32(child.alpha??1),f32(child.rotation??0),byte(child.visible??true),byte(child.touchable??true),byte(child.grayed??false),byte(0),byte(0),ref(null)]);
      const gears=[];
      for(const gear of child.gears??[]) {
        let raw;
        if(['text','icon'].includes(gear.type)) raw=join([byte(gear.type==='text'?6:7),i16(gear.controllerIndex),i16(gear.pages.length),...gear.pages.flatMap((page,i)=>[ref(page),ref(gear.values[i])]),...(Object.hasOwn(gear,'default')?[byte(1),ref(gear.default)]:[byte(0)]),byte(0)]);
        else if(gear.type==='fontSize') {const values=gear.pages.map((page,i)=>[page,gear.values[i]]).filter(([,value])=>value!==null);raw=join([byte(9),i16(gear.controllerIndex),i16(values.length),...values.flatMap(([page,value])=>[ref(page),i32(value)]),...(Object.hasOwn(gear,'default')?[byte(1),i32(gear.default)]:[byte(0)]),byte(0)]);}
        else if(['color','animation'].includes(gear.type)) {
          const encode=value=>gear.type==='color'?join(value.map(color=>Buffer.from(color))):join([byte(value.playing),i32(value.frame)]);
          const values=gear.pages.map((page,i)=>[page,gear.values[i]]).filter(([,value])=>value!==null);
          raw=join([byte(gear.type==='color'?4:5),i16(gear.controllerIndex),i16(values.length),...values.flatMap(([page,value])=>[ref(page),encode(value)]),...(Object.hasOwn(gear,'default')?[byte(1),encode(gear.default)]:[byte(0)]),byte(0)]);
        }
        else if(['xy','size','look'].includes(gear.type)) {
          const encode=value=>gear.type==='look'?join([f32(value[0]),f32(value[1]),byte(value[2]),byte(value[3])]):join([i32(value[0]),i32(value[1]),...(gear.type==='size'?[f32(value[2]),f32(value[3])]:[])]);
          const values=gear.pages.map((page,i)=>[page,gear.values[i]]).filter(([,value])=>value!==null);
          raw=join([byte({xy:1,size:2,look:3}[gear.type]),i16(gear.controllerIndex),i16(values.length),...values.flatMap(([page,value])=>[ref(page),encode(value)]),...(Object.hasOwn(gear,'default')?[byte(1),encode(gear.default)]:[byte(0)]),...(gear.tween?[byte(1),byte(gear.tween.ease),f32(gear.tween.duration),f32(gear.tween.delay)]:[byte(0)]),...(gear.type==='xy'&&version>=2?[byte(0)]:[])]);
        }
        else raw=join([byte(gear.type==='display2'?8:0),i16(gear.controllerIndex),i16(gear.pages.length),...gear.pages.map(ref),byte(0),...(gear.type==='display2'&&version>=2?[byte(gear.condition??0)]:[])]);
        if(raw.length>32767)throw new Error('gear too large');gears.push(i16(raw.length),raw);
      }
      let sections=[base,join([ref(null),i16(child.groupIndex??-1)]),join([i16((child.gears??[]).length),...gears]),relations(child.relations??[]),Buffer.alloc(0)];
      if(text) {
        const style=join([ref(child.font),i16(child.fontSize??0),Buffer.from(child.color??[0,0,0,255]),byte(child.align??0),byte(child.vAlign??0),i16(child.leading??3),i16(child.letterSpacing??0),byte(child.ubb??false),byte(child.autoSize??1),byte(child.underline??false),byte(child.italic??false),byte(child.bold??false),byte(child.singleLine??false),...(child.strokeColor?[byte(1),Buffer.from(child.strokeColor),f32(1)]:[byte(0)]),...(child.shadowColor?[byte(1),Buffer.from(child.shadowColor),...child.shadowOffset.map(f32)]:[byte(0)]),byte(0)]);
        if(child.type==='inputtext')sections[4]=join([ref(child.input.prompt),ref(child.input.restrict),i32(child.input.maxLength),i32(child.input.keyboardType),byte(child.input.password)]);
        sections.push(style,ref(child.text));
      } else if(child.type==='component') {
        sections[4]=join([i16(-1),i16(0),...(version>=2?[i16(0)]:[])]);
        if(child.progress)sections.push(Buffer.alloc(0),join([byte(child.progressKind??14),i32(child.progress[0]),i32(child.progress[1]),...(version>=2?[i32(child.progress[2])]:[])]));
        else if(child.label) {const label=child.label;sections.push(Buffer.alloc(0),join([byte(11),ref(label.title),ref(label.icon),...(label.color?[byte(1),Buffer.from(label.color)]:[byte(0)]),i32(label.fontSize??0),byte(0),ref(null)]));}
        else if(child.button) {const button=child.button;sections.push(Buffer.alloc(0),join([byte(12),...['title','selectedTitle','icon','selectedIcon'].map(key=>ref(button[key])),...(button.color?[byte(1),Buffer.from(button.color)]:[byte(0)]),i32(button.fontSize??0),i16(button.controller??-1),ref(button.page),ref(null),byte(0),byte(button.checked??false)]));}
        else if(child.comboBox){const combo=child.comboBox,items=[];for(const item of combo.items){const raw=join(['title','value','icon'].map(k=>ref(item[k])));items.push(i16(raw.length),raw);}sections.push(Buffer.alloc(0),join([byte(13),i16(combo.items.length),...items,ref(null),ref(null),byte(0),i32(combo.visibleItemCount),byte(0),i16(-1)]));}
      }
      else if(child.type==='list'||child.type==='tree') {
        const ls=child.list,style=join([byte(ls.layout),byte(ls.selectionMode),byte(ls.align),byte(ls.vAlign),...['lineGap','colGap','lineCount','colCount'].map(k=>i16(ls[k])),byte(ls.autoItemSize),byte(ls.renderOrder??0),i16(0),...(ls.margin?[byte(1),...ls.margin.map(i32)]:[byte(0)]),byte(ls.overflow),...(ls.clipSoftness?[byte(1),...ls.clipSoftness.map(i32)]:[byte(0)]),...(version>=2?[byte(ls.scrollItemToViewOnClick??true),byte(ls.foldInvisibleItems??false)]:[])]);
        const scroll=ls.scroll?join([byte(ls.scroll.type),byte(ls.scroll.barDisplay),i32(ls.scroll.flags),...(ls.scroll.barMargin?[byte(1),...ls.scroll.barMargin.map(i32)]:[byte(0)]),...ls.scroll.resources.map(ref)]):Buffer.alloc(0),items=[];
        for(const item of ls.items){const entry=join([ref(item.url),...(child.type==='tree'?[byte(item.folder),byte(item.level)]:[]),...['title','selectedTitle','icon','selectedIcon','name'].map(k=>ref(item[k])),i16(0),...(version>=2?[i16(0)]:[])]);if(entry.length>32767)throw new Error('list item too large');items.push(i16(entry.length),entry);}
        sections=[...sections.slice(0,4),join([i16(ls.pageController),i16(0),...(version>=2?[i16(0)]:[])]),style,i16(ls.selectionController),scroll,join([ref(ls.defaultItem),i16(ls.items.length),...items])];if(child.type==='tree')sections.push(join([i32(ls.indent),byte(ls.clickToExpand)]));
      }
      else if(child.type==='movieclip') sections.push(join([...(child.imageColor?[byte(1),Buffer.from(child.imageColor)]:[byte(0)]),byte(0),i32(child.frame??0),byte(child.playing??true)]));
      else if(child.type==='group'){const g=child.groupStyle??{};sections.push(join([byte(g.layout??0),i32(g.lineGap??0),i32(g.colGap??0),...(version>=2?[byte(g.excludeInvisibles??false),byte(g.autoSizeDisabled??false),i16(g.mainGridIndex??-1)]:[])]));}
      else if(child.type==='loader')sections.push(join([ref(child.url),byte(child.align??0),byte(child.vAlign??0),byte(child.fill??0),byte(0),byte(0),byte(0),byte(1),i32(0),...(child.imageColor?[byte(1),Buffer.from(child.imageColor)]:[byte(0)]),byte(child.fillMethod??0),...(child.fillMethod?[byte(0),byte(child.fillClockwise??true),f32(child.fillAmount??1)]:[])]));
      else if(child.type==='graph') {
        const type=child.graphType??0,style=[byte(type)];
        if(type) {style.push(i32(child.lineSize??1),Buffer.from(child.lineColor??[0,0,0,255]),Buffer.from(child.fillColor??[255,255,255,255]),...(child.cornerRadius?[byte(1),...child.cornerRadius.map(f32)]:[byte(0)]));
          if(type===3)style.push(i16(child.points.length),...child.points.map(f32));
          else if(type===4)style.push(i16(child.sides),f32(child.startAngle??0),i16((child.distances??[]).length),...(child.distances??[]).map(f32));
        }
        sections.push(join(style));
      }
      else sections.push(join([...(child.imageColor?[byte(1),Buffer.from(child.imageColor)]:[byte(0)]),byte(child.flip??0),byte(child.fillMethod??0),...(child.fillMethod?[byte(0),byte(child.fillClockwise??true),f32(child.fillAmount??1)]:[])]));
      const raw=indexed(sections);
      if(raw.length>32767)throw new Error('component child too large');childRecords.push(i16(raw.length),raw);
    }
    if(component.children.length>32767)throw new Error('too many component children');
    const controllerRecords=[];
    for(const controller of component.controllers??[]) {
      const pages=controller.pages;if(pages.length>32767)throw new Error('too many controller pages');
      const actions=[];for(const action of controller.actions??[]){const raw=join([byte(action.type),i16(action.from.length),...action.from.map(ref),i16(action.to.length),...action.to.map(ref),ref(action.transition),i32(action.times),f32(action.delay),byte(action.stopOnExit)]);if(raw.length>32767)throw new Error('controller action too large');actions.push(i16(raw.length),raw);}
      const raw=indexed([join([ref(controller.name),byte(0)]),join([i16(pages.length),...pages.flatMap(([id,name])=>[ref(id),ref(name)]),...(version>=2?[byte(0)]:[])]),join([i16((controller.actions??[]).length),...actions])]);
      if(raw.length>32767)throw new Error('controller too large');controllerRecords.push(i16(raw.length),raw);
    }
    if((component.controllers??[]).length>32767)throw new Error('too many controllers');
    const base=join([i32(component.width),i32(component.height),byte(0),...(component.pivot?[byte(1),...component.pivot.map(f32),byte(0)]:[byte(0)]),...(component.margin?[byte(1),...component.margin.map(i32)]:[byte(0)]),byte(component.overflow??0),byte(0)]);
    const mask=component.settings?.mask??-1,hit=component.settings?.hitTestChild;
    const settings=join([ref(null),byte(component.settings?.opaque??true),i16(mask),...(mask!==-1?[byte(component.settings?.reversedMask??false)]:[]),ref(component.settings?.hitTestImage),i32(hit===null||hit===undefined?0:1),i32(hit??0)]);
    const transitions=[];
    for(const transition of component.transitions??[]){const items=[];for(const action of transition.items){const kind=action.type,tw=action.tween;
      const value=v=>[0,1,3].includes(kind)?join([...v.flags.map(byte),...v.values.map(f32),...(version>=2&&kind===0?[byte(0)]:[])]):kind===6?Buffer.from(v):kind===8?byte(v):kind===7?join([byte(v.playing),i32(v.frame)]):kind===9?join([ref(v.sound),f32(v.volume)]):kind===10?join([ref(v.name),i32(v.times)]):[14,15].includes(kind)?ref(v):join(v.map(f32));
      const header=join([byte(kind),f32(action.time),i16(action.target),ref(action.label),byte(Boolean(tw))]);let raw;
      if(tw){const config=join([f32(tw.duration),byte(tw.ease),i32(tw.repeat),byte(tw.yoyo),ref(tw.endLabel)]),end=join([value(tw.end),...(version>=2?[i32((tw.path??[]).length),...(tw.path??[]).flatMap(p=>[byte(p.curve),...p.points.map(f32)])]:[])]);raw=indexed([header,config,value(tw.start),end]);}
      else raw=indexed([header,Buffer.alloc(0),value(action.value)]);
      if(raw.length>32767)throw new Error('transition item too large');items.push(i16(raw.length),raw);
    }const raw=join([ref(transition.name),i32(transition.options),byte(transition.autoPlay),i32(transition.autoPlayTimes),f32(0),i16(transition.items.length),...items]);if(raw.length>32767)throw new Error('transition too large');transitions.push(i16(raw.length),raw);}
    const extension=component.extension??0,sections=[base,join([i16((component.controllers??[]).length),...controllerRecords]),join([i16(component.children.length),...childRecords]),relations(component.relations??[]),settings,join([i16((component.transitions??[]).length),...transitions])];
    if(extension===12)sections.push(join([byte(component.buttonMode??0),ref(component.buttonSound),f32(1),byte(component.buttonEffect??0),f32(component.buttonEffectValue??0.8)]));
    else if(extension===13)sections.push(ref(component.comboDropdown));
    else if(extension===14||extension===15)sections.push(join([byte(component.titleType??0),byte(component.reverse??false),...(extension===15&&version>=2?[byte(0),byte(1)]:[])]));
    else if(extension===16)sections.push(byte(0));
    if(component.scroll){while(sections.length<7)sections.push(Buffer.alloc(0));const scroll=component.scroll;sections.push(join([byte(scroll.type),byte(scroll.barDisplay),i32(scroll.flags),...(scroll.barMargin?[byte(1),...scroll.barMargin.map(i32)]:[byte(0)]),...scroll.resources.map(ref)]));}
    const payload=indexed(sections);
    const record=join([byte(3),ref(component.id),ref(component.name),ref(null),ref(null),byte(Boolean(component.exported)),i32(component.width),i32(component.height),byte(extension),i32(payload.length),payload,...(version>=2?[ref(null),byte(0),byte(0)]:[])]);
    records.push(i32(record.length),record);
  }
  const items=join([i16(images.length+pages.length+sounds.length+movieclips.length+fonts.length+components.length),...records]), sprites=[];
  for(const image of allSprites) {
    const {index,item}=placements.get(image.id), parts=[ref(image.id),ref('atlas'+index),...['x','y','width','height'].map(k=>i32(item[k])),byte(Boolean(item.rotated))];
    if(version>=2) {const trim=spriteTrim[image.id];if(trim) parts.push(byte(1),...trim.map(i32));else parts.push(byte(0));}
    const record=join(parts);sprites.push(i16(record.length),record);
  }
  for(const font of fonts) if(font.ttf) {
    const p=placements.get(font.texture);if(!p)throw new Error('bitmap font texture missing');if(p.item.rotated)throw new Error('bitmap font textures cannot be rotated');
    const record=join([ref(font.id),ref('atlas'+p.index),...['x','y','width','height'].map(k=>i32(p.item[k])),byte(0),...(version>=2?[byte(0)]:[])]);sprites.push(i16(record.length),record);
  }
  const spriteCount=allSprites.length+fonts.filter(f=>f.ttf).length;
  if(spriteCount>32767) throw new Error('too many sprites');
  if(dependencies.length>32767)throw new Error('too many dependencies');
  const deps=join([i16(dependencies.length),...dependencies.flatMap(dep=>[ref(dep.id),ref(dep.name)]),...(version>=2?[i16(0)]:[])]), spriteSection=join([i16(spriteCount),...sprites]);
  if(hitTests.length>32767)throw new Error('too many pixel hit tests');const hitRecords=[];for(const hit of hitTests){const raw=join([ref(hit.id),i32(0),i32(hit.width),byte(hit.divisor),i32(hit.pixels.length),Buffer.from(hit.pixels)]);hitRecords.push(i32(raw.length),raw);}const hitSection=hitTests.length?join([i16(hitTests.length),...hitRecords]):Buffer.alloc(0);
  const strings=join([i32(table.length),...table.map(str)]), sections=[deps,items,spriteSection,hitSection,strings];
  let offset=2+4*sections.length;const offsets=[];
  for(const section of sections) {offsets.push(section.length?offset:0);offset+=section.length;}
  return join([Buffer.from('FGUI'),i32(version),byte(0),str(packageId),str(packageName),Buffer.alloc(20),byte(sections.length),byte(0),...offsets.map(i32),...sections]);
}
