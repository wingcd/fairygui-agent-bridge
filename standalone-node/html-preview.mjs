import {parseDocument,Parser} from 'htmlparser2';

// Convert a deliberately limited HTML subset to the preview's UBB representation.
export function previewHtmlToUbb(input) {
 const normalized=input.replace(/<color=(#[0-9a-f]{6})>/gi,'<font color="$1">').replace(/<\/color>/gi,'</font>').replace(/<size=(\d+)>/gi,'<font size="$1">').replace(/<\/size>/gi,'</font>');
 const syntax=new Parser({onclosetag(name,implied){if(implied&&!['br','img'].includes(name))throw new Error('unclosed or mismatched HTML tag '+name);}},{decodeEntities:true,lowerCaseTags:true});syntax.end(normalized);
 const doc=parseDocument(normalized,{decodeEntities:true,lowerCaseTags:true,lowerCaseAttributeNames:true});
 const escapeText=value=>value.replace(/\[/g,'\\[');
 function convert(node){
  if(node.type==='text')return escapeText(node.data);
  if(node.type!=='tag')throw new Error('unsupported HTML node');
  const name=node.name,attrs=node.attribs??{},keys=Object.keys(attrs),inner=()=>node.children.map(convert).join('');
  if(name==='br'){if(keys.length||node.children.length)throw new Error('invalid HTML br');return '\n';}
  if(name==='img'){if(keys.some(k=>k!=='src')||!/^ui:\/\/[^\s\[\]]+$/.test(attrs.src??''))throw new Error('unsupported HTML image');return `[img]${attrs.src}[/img]`;}
  if(['b','i','u'].includes(name)){if(keys.length)throw new Error('unsupported HTML style attributes');return `[${name}]${inner()}[/${name}]`;}
  if(name==='a'){if(keys.some(k=>k!=='href')||!attrs.href||/[\[\]]/.test(attrs.href))throw new Error('unsupported HTML link');return `[url=${attrs.href}]${inner()}[/url]`;}
  if(name==='font'){
   if(keys.some(k=>!['color','size','face'].includes(k))||!keys.length)throw new Error('unsupported HTML font');
   if(attrs.color&&!/^#[0-9a-f]{6}$/i.test(attrs.color))throw new Error('unsupported HTML color');
   if(attrs.size&&(!/^\d+$/.test(attrs.size)||+attrs.size<1||+attrs.size>512))throw new Error('unsupported HTML font size');
   if(attrs.face&&(!attrs.face.trim()||attrs.face.length>128||/[<>\[\]]/.test(attrs.face)||attrs.face.startsWith('ui://')))throw new Error('unsupported HTML font face');
   let result=inner();if(attrs.face)result=`[font=${attrs.face}]${result}[/font]`;if(attrs.size)result=`[size=${attrs.size}]${result}[/size]`;if(attrs.color)result=`[color=${attrs.color}]${result}[/color]`;return result;
  }
  throw new Error('unsupported HTML tag '+name);
 }
 return doc.children.map(convert).join('');
}
