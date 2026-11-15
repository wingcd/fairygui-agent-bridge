import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';

export const isFairyDescriptorName = name => name.toLowerCase().endsWith('.fairy');
export const children = (node, name) => Array.from(node?.childNodes || []).filter(n => n.nodeType === 1 && (!name || n.tagName === name));
export const attrs = node => Object.fromEntries(Array.from(node.attributes, a => [a.name, a.value]));
export const attr = (node, key) => node.hasAttribute(key) ? node.getAttribute(key) : null;
export function decodeXml(data, label, preserveBom = false) {
  let encoding = 'utf-8';
  if ((data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0x3c && data[1] === 0)) encoding = 'utf-16le';
  else if ((data[0] === 0xfe && data[1] === 0xff) || (data[0] === 0 && data[1] === 0x3c)) encoding = 'utf-16be';
  try { const text = new TextDecoder(encoding,{fatal:true,ignoreBOM:preserveBom}).decode(data); return preserveBom ? text : text.replace(/^\uFEFF/, ''); }
  catch { throw new Error(`${label}: invalid XML encoding`); }
}
export function parse(data, label) {
  const xml = decodeXml(data, label);
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error(`${label}: DTD/entity declarations are not supported`);
  const errors = [];
  // FairyGUI files use XML 1.0: NEL, line separator and paragraph separator
  // are content, whereas xmldom's default normalization also rewrites them.
  const xml11=/^\s*<\?xml\s+[^?]*\bversion\s*=\s*['"]1\.1['"]/i.test(xml);
  const options={onError:(level,message)=>errors.push(`${level}: ${message}`)};
  if(!xml11)options.normalizeLineEndings=input=>input.replace(/\r\n?/g,'\n');
  const doc = new DOMParser(options).parseFromString(xml, 'application/xml');
  if (errors.length || !doc.documentElement) throw new Error(`${label}: invalid XML: ${errors.join('; ')}`);
  return doc.documentElement;
}
export function projectRoot(project) {
  if (typeof project !== 'string' || !project) throw new Error('project is required');
  let p = fs.realpathSync(project);
  if (fs.statSync(p).isFile()) { if (path.extname(p).toLowerCase() !== '.fairy') throw new Error('project file must have .fairy extension'); p = path.dirname(p); }
  const hasDescriptor=fs.readdirSync(p).some(n=>{if(!isFairyDescriptorName(n))return false;try{return fs.statSync(path.join(p,n)).isFile();}catch{return false;}});
  if (!fs.existsSync(path.join(p, 'assets')) || !fs.statSync(path.join(p, 'assets')).isDirectory() || !hasDescriptor) throw new Error('project must contain assets/ and a .fairy file');
  return p;
}
export function packages(root) {
  return fs.readdirSync(path.join(root, 'assets')).sort().flatMap(name => {
    const folder = path.join(root, 'assets', name), file = path.join(folder, 'package.xml');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return [];
    const tree = parse(fs.readFileSync(file), file);
    if (tree.tagName !== 'packageDescription') throw new Error(`${file}: expected packageDescription`);
    return [{ folder, tree }];
  });
}
export function resources(tree) { return children(children(tree, 'resources')[0]); }
export function componentPath(folder, item) {
  const name = attr(item, 'name') || '', sub = (attr(item, 'path') || '/').replaceAll('\\', '/').replace(/^\/+/, '');
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') throw new Error('invalid resource name');
  const target = fs.realpathSync(path.join(folder, sub, name)), base = fs.realpathSync(folder), rel = path.relative(base, target);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('resource path escapes package');
  return target;
}
const packageListCache=new Map();let packageListBytes=0;
function listPackageRecords(root){return fs.readdirSync(path.join(root,'assets')).sort().flatMap(name=>{const folder=path.join(root,'assets',name),file=path.join(folder,'package.xml');if(!fs.existsSync(file)||!fs.statSync(file).isFile())return [];const bytes=fs.readFileSync(file),cached=packageListCache.get(file);let id;if(cached&&cached.bytes.equals(bytes)){id=cached.id;packageListCache.delete(file);packageListCache.set(file,cached);}else{if(cached){packageListBytes-=cached.bytes.length;packageListCache.delete(file);}const tree=parse(bytes,file);if(tree.tagName!=='packageDescription')throw new Error(file+': expected packageDescription');id=attr(tree,'id');if(bytes.length<=4*1024*1024){packageListCache.set(file,{bytes,id});packageListBytes+=bytes.length;while(packageListCache.size>256||packageListBytes>4*1024*1024){const key=packageListCache.keys().next().value;packageListBytes-=packageListCache.get(key).bytes.length;packageListCache.delete(key);}}}return [{name,id,path:folder}];});}
export function execute(command, args) {
  const root = projectRoot(args.project);
  if(command==='list_packages')return listPackageRecords(root);
  if (command === 'project_info') { const package_count=listPackageRecords(root).length,selected=fs.statSync(args.project).isFile()?[path.basename(fs.realpathSync(args.project))]:fs.readdirSync(root).filter(n => isFairyDescriptorName(n)).sort(); return { root, projects:selected.map(n => ({file:path.join(root,n), attributes:attrs(parse(fs.readFileSync(path.join(root,n)),n))})), package_count }; }
  const all=packages(root);
  const matched = all.filter(({folder,tree}) => args.pkg === path.basename(folder) || args.pkg === attr(tree,'id'));
  if (matched.length !== 1) throw new Error(`package ${JSON.stringify(args.pkg)} not found or ambiguous`);
  const {folder,tree} = matched[0];
  if (command === 'list_items') return resources(tree).map(item => ({type:item.tagName,...attrs(item)}));
  if (command === 'read_package') {
    const file=path.join(folder,'package.xml'),data=fs.readFileSync(file);
    return {path:file,sha256:crypto.createHash('sha256').update(data).digest('hex'),xml:decodeXml(data,file)};
  }
  if (command === 'read_component' || command === 'list_children' || command === 'list_controllers' || command === 'list_transitions') {
    const items = resources(tree).filter(item => item.tagName === 'component' && [attr(item,'id'),attr(item,'name'),path.parse(attr(item,'name') || '').name].includes(args.name));
    if (items.length !== 1) throw new Error(`component ${JSON.stringify(args.name)} not found or ambiguous`);
    const file = componentPath(folder, items[0]), data = fs.readFileSync(file);
    const sha256 = crypto.createHash('sha256').update(data).digest('hex');
    // Raw reads must remain available when validation finds broken component XML,
    // so a client can inspect and repair it using the same revision guard.
    if (command === 'read_component') return {path:file,xml:decodeXml(data,file),sha256};
    const node = parse(data, 'component');
    if (node.tagName !== 'component') throw new Error('component root must be <component>');
    const displays = children(node, 'displayList');
    if (displays.length > 1) throw new Error('component may have at most one displayList');
    const objects = children(displays[0]), ids = objects.map(item => attr(item,'id'));
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('displayList children must have unique nonempty ids');
    if (command === 'list_children') return {path:file,sha256,children:objects.map(item => ({type:item.tagName,id:attr(item,'id'),name:attr(item,'name'),attributes:attrs(item),behaviors:children(item).filter(e => e.tagName === 'relation' || e.tagName.startsWith('gear')).map(e => ({type:e.tagName,attributes:attrs(e)}))}))};
    if (command === 'list_transitions') return {path:file,sha256,transitions:children(node,'transition').map(transition=>({name:attr(transition,'name'),attributes:attrs(transition),items:children(transition).map(item=>({type:item.tagName,attributes:attrs(item)}))}))};
    return {path:file,sha256,controllers:children(node,'controller').map(controller => {
      const pages = (attr(controller,'pages') || '').split(','); if (pages.length === 1 && !pages[0]) pages.pop();
      if (pages.length % 2) throw new Error('invalid controller pages');
      const selected = attr(controller,'selected') || '0'; if (!/^[+-]?\d+$/.test(selected)) throw new Error('invalid controller selected index');
      return {name:attr(controller,'name'),pages:Array.from({length:pages.length/2},(_,i)=>({id:pages[i*2],name:pages[i*2+1]})),selected:Number(selected),actions:children(controller,'action').map(a=>({type:attr(a,'type'),attributes:attrs(a)}))};
    })};
  }
  throw new Error(`unsupported Node operation: ${command}`);
}
