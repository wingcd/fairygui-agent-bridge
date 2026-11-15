// Parse the UBB subset supported by the PIXI screenshot renderer into styled runs.
// This function is also serialized into the preview page, so keep it self-contained.
export function parsePreviewUbb(input) {
  const runs=[],stack=[],style={};let position=0;
  const append=text=>{if(text)runs.push({type:'text',text,style:{...style}});};
  while(position<input.length){
    const start=input.indexOf('[',position);
    if(start<0){append(input.slice(position));break;}
    if(start>position&&input[start-1]==='\\'){append(input.slice(position,start-1)+'[');position=start+1;continue;}
    append(input.slice(position,start));
    const end=input.indexOf(']',start+1);if(end<0)throw new Error('unclosed UBB tag');
    const tag=input.slice(start+1,end),match=/^(\/)?([a-z]+)(?:=([^\]]+))?$/i.exec(tag);
    if(!match)throw new Error('invalid UBB tag');
    const closing=!!match[1],name=match[2].toLowerCase(),value=match[3];
    if(name==='img'){
      if(closing||value!==undefined)throw new Error('invalid UBB image tag');
      const close=input.toLowerCase().indexOf('[/img]',end+1);if(close<0)throw new Error('unclosed UBB image');
      const url=input.slice(end+1,close);if(!/^ui:\/\/[^\s\[\]]+$/.test(url))throw new Error('unsupported UBB image URL');
      runs.push({type:'image',url,style:{...style}});position=close+6;continue;
    }
    if(!['b','i','u','color','size','font','url'].includes(name))throw new Error('unsupported UBB tag '+name);
    if(closing){if(value!==undefined||!stack.length||stack[stack.length-1].name!==name)throw new Error('mismatched UBB tag');const prev=stack.pop();for(const key of Object.keys(style))delete style[key];Object.assign(style,prev.style);}
    else{
      if(['color','size','font'].includes(name)&&value===undefined||['b','i','u'].includes(name)&&value!==undefined)throw new Error('invalid UBB tag attribute');
      if(name==='color'&&!/^#[0-9a-f]{6}$/i.test(value))throw new Error('unsupported UBB color');
      if(name==='size'&&(!/^\d+$/.test(value)||Number(value)<1||Number(value)>512))throw new Error('unsupported UBB size');
      if(name==='font'&&(!value.trim()||value.length>128||/[<>]/.test(value)||value.startsWith('ui://')))throw new Error('unsupported UBB font');
      stack.push({name,style:{...style}});
      if(name==='b')style.bold=true;else if(name==='i')style.italic=true;else if(name==='u')style.underline=true;else if(name==='color')style.color=value;else if(name==='size')style.size=Number(value);else if(name==='font')style.font=value;else if(name==='url'){style.link=value??'';style.underline=true;}
    }
    position=end+1;
  }
  if(stack.length)throw new Error('unclosed UBB tag');return runs;
}
