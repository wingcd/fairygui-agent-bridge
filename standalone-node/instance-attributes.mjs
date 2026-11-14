import fs from 'node:fs';
import path from 'node:path';
import {projectRoot,packages,resources,componentPath,parse,attr,children} from './project.mjs';
import {urlIndex} from './references.mjs';

export function instanceAttributes(args,node,extension,existing){
 const progress=['ProgressBar','Slider'].includes(extension);
 const allowed=progress?['value','max','min']:['title','icon','titleColor','titleFontSize',...(extension==='Button'?['selectedTitle','selectedIcon','checked']:[])],props=args.props;
 if(!props||typeof props!=='object'||Array.isArray(props)||!Object.keys(props).length||Object.keys(props).some(k=>!allowed.includes(k)))throw new Error(`invalid ${extension} instance properties`);
 if(node.tagName!=='component'||!attr(node,'src'))throw new Error(`target must reference a ${extension} component`);
 if(children(node).some(child=>['Button','Label','ComboBox','ProgressBar','Slider'].includes(child.tagName)&&child.tagName!==extension))throw new Error('conflicting component instance settings');
 const all=packages(projectRoot(args.project)),alias=attr(node,'pkg')||args.pkg,owners=all.filter(p=>alias===path.basename(p.folder)||alias===attr(p.tree,'id'));if(owners.length!==1)throw new Error('component package not found or ambiguous');
 const matches=resources(owners[0].tree).filter(item=>item.tagName==='component'&&attr(item,'id')===attr(node,'src'));if(matches.length!==1||attr(parse(fs.readFileSync(componentPath(owners[0].folder,matches[0])),'component'),'extention')!==extension)throw new Error(`target must reference a ${extension} component`);
 const existingAllowed=[...allowed,...(extension==='Button'?['controller','page']:[])];if(existing&&(children(existing).length||Array.from(existing.attributes).some(a=>!existingAllowed.includes(a.name))||Array.from(existing.childNodes).some(n=>(n.nodeType===3||n.nodeType===4)&&n.data.trim())))throw new Error(`unsupported ${extension} instance settings`);
 const result=Object.fromEntries(Array.from(existing?.attributes??[]).map(a=>[a.name,a.value]));
 for(const [key,value] of Object.entries(props)){
  if(progress){if(!Number.isInteger(value)||value< -2147483648||value>2147483647)throw new Error(`invalid ${key}`);result[key]=String(value);continue;}
  if(key==='checked'){if(typeof value!=='boolean')throw new Error('checked must be boolean');result[key]=String(value);continue;}
  if(key==='titleFontSize'){if(!Number.isInteger(value)||value<0||value>2147483647)throw new Error('invalid titleFontSize');result[key]=String(value);continue;}
  if(typeof value!=='string')throw new Error(`${key} must be a string`);if(key==='titleColor'&&!/^#[0-9a-f]{6}$/i.test(value))throw new Error('invalid titleColor');
  if(['icon','selectedIcon'].includes(key)&&value){if(!value.startsWith('ui://'))throw new Error('icon must be a registered UI URL');const address=value.slice(5),slash=address.indexOf('/'),owner=all.filter(p=>slash>=0?path.basename(p.folder)===address.slice(0,slash):attr(p.tree,'id')===address.slice(0,8));if(owner.length!==1)throw new Error('icon package missing or ambiguous');const items=resources(owner[0].tree).filter(i=>['image','component','movieclip'].includes(i.tagName)&&(slash>=0?path.parse(attr(i,'name')??'').name===address.slice(slash+1):attr(i,'id')===address.slice(8)));if(items.length!==1)throw new Error('icon resource missing or ambiguous');componentPath(owner[0].folder,items[0]);}
  result[key]=value;
 }
 return result;
}

export function comboInstanceElement(args,node,existing){
 const props=args.props;if(!props||typeof props!=='object'||Array.isArray(props)||!Object.keys(props).length||Object.keys(props).some(key=>!['visibleItemCount','items'].includes(key)))throw new Error('invalid ComboBox instance properties');
 if(node.tagName!=='component'||!attr(node,'src')||children(node).some(child=>['Button','Label','ProgressBar','Slider'].includes(child.tagName)))throw new Error('target must reference a ComboBox component');
 const all=packages(projectRoot(args.project)),alias=attr(node,'pkg')||args.pkg,owners=all.filter(p=>alias===path.basename(p.folder)||alias===attr(p.tree,'id'));if(owners.length!==1)throw new Error('component package not found or ambiguous');
 const matches=resources(owners[0].tree).filter(item=>item.tagName==='component'&&attr(item,'id')===attr(node,'src'));if(matches.length!==1||attr(parse(fs.readFileSync(componentPath(owners[0].folder,matches[0])),'component'),'extention')!=='ComboBox')throw new Error('target must reference a ComboBox component');
 const textPresent=element=>Array.from(element.childNodes).some(n=>(n.nodeType===3||n.nodeType===4)&&n.data.trim());
 if(existing&&(Array.from(existing.attributes).some(a=>a.name!=='visibleItemCount')||textPresent(existing)||children(existing).some(item=>item.tagName!=='item'||children(item).length||textPresent(item)||Array.from(item.attributes).some(a=>!['title','value','icon'].includes(a.name)))))throw new Error('unsupported ComboBox instance settings');
 if('visibleItemCount' in props&&(!Number.isInteger(props.visibleItemCount)||props.visibleItemCount<0||props.visibleItemCount>2147483647))throw new Error('invalid visibleItemCount');
 if('items' in props){if(!Array.isArray(props.items)||props.items.length>32767)throw new Error('invalid ComboBox items');const urls=urlIndex(all);for(const item of props.items){if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['title','value','icon'].includes(k))||Object.values(item).some(v=>typeof v!=='string'))throw new Error('invalid ComboBox item');if(item.icon){const found=urls.get(item.icon)??[];if(found.length!==1||!['image','component','movieclip'].includes(found[0].type)||!found[0].isFile())throw new Error('invalid ComboBox item icon');}}}
 const result=existing?existing.cloneNode(true):node.ownerDocument.createElement('ComboBox');if('visibleItemCount' in props)result.setAttribute('visibleItemCount',String(props.visibleItemCount));if('items' in props){for(const item of children(result))result.removeChild(item);for(const values of props.items){const item=node.ownerDocument.createElement('item');for(const [key,value] of Object.entries(values))item.setAttribute(key,value);result.appendChild(item);}}return result;
}
