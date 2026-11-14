import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { projectRoot, isFairyDescriptorName, parse, children, attr, resources, componentPath } from './project.mjs';
import { referenceIssues, resourceIndex, urlIndex } from './references.mjs';
import {inspectWav,inspectMp3,inspectOggVorbis} from './sound.mjs';
import {readJta} from './jta.mjs';
import {readBitmapFont} from './bitmap-font.mjs';
import {exportedClosure} from './exported-closure.mjs';

export async function validate(args) {
  const checkMedia=args.check_media ?? false;if(typeof checkMedia!=='boolean')throw new Error('check_media must be a boolean');
  const exportedOnly=args.exported_only ?? false;if(typeof exportedOnly!=='boolean')throw new Error('exported_only must be a boolean');
  const root = projectRoot(args.project), requested=fs.realpathSync(args.project), issues=[], warnings=[], all=[],imageJobs=[],mediaChecked={sound:0,movieclip:0,font:0};
  const descriptors=fs.statSync(requested).isFile()?[path.basename(requested)]:fs.readdirSync(root).filter(n=>isFairyDescriptorName(n)).sort();
  for (const file of descriptors) {
    const full=path.join(root,file);
    try { if (parse(fs.readFileSync(full),full).tagName !== 'projectDescription') throw new Error('expected projectDescription root'); }
    catch(error) { issues.push({path:full,error:error.message}); }
  }
  for (const name of fs.readdirSync(path.join(root,'assets')).sort()) {
    const folder=path.join(root,'assets',name), file=path.join(folder,'package.xml');
    if (!fs.existsSync(file)) continue;
    try { const tree=parse(fs.readFileSync(file),file); if(tree.tagName!=='packageDescription') throw new Error('expected packageDescription root'); all.push({folder,tree}); }
    catch(error) { issues.push({path:file,error:error.message}); }
  }
  let closure=null;if(exportedOnly)try{closure=await exportedClosure(all,file=>fs.promises.readFile(file));}catch(error){issues.push({error:`cannot determine exported resource closure: ${error.message}`});}
  const index=resourceIndex(all), urls=urlIndex(all), packageIds=new Set();
  for (const {folder,tree} of all) {
    const packageId=attr(tree,'id'), label=path.basename(folder);
    if (!packageId || packageIds.has(packageId)) issues.push({path:path.join(folder,'package.xml'),error:'missing or duplicate package id'});
    packageIds.add(packageId);
    if (children(tree,'resources').length!==1) issues.push({path:path.join(folder,'package.xml'),error:'package must have exactly one resources element'});
    const ids=new Set();
    for (const item of resources(tree)) {
      const name=attr(item,'name');
      try {
        const id=attr(item,'id'); if(!id || ids.has(id)) throw new Error('missing or duplicate resource id'); ids.add(id);
        if(closure&&!closure.get(folder).has(id))continue;
        const file=componentPath(folder,item);
        if (!fs.statSync(file).isFile()) throw new Error('registered resource file missing: '+file);
        if (item.tagName==='image') imageJobs.push(async()=>{
          const foundWarnings=[];
          try{
            const image=sharp(await fs.promises.readFile(file),{failOn:'error'}),metadata=await image.metadata();await image.raw().toBuffer();
            const extension=path.extname(file).toLowerCase(),expected=extension==='.png'?'png':['.jpg','.jpeg'].includes(extension)?'jpeg':null;
            if(!expected)foundWarnings.push({package:label,resource:name,warning:`image filename extension ${extension||'(none)'} is not PNG or JPEG; editor compatibility is not verified`});
            else if(metadata.format!==expected)foundWarnings.push({package:label,resource:name,warning:`image content format ${metadata.format} does not match ${path.extname(file)}`});
            const scale=attr(item,'scale'),grid=attr(item,'scale9grid'),duplicate=attr(item,'duplicatePadding');
            if(duplicate!==null&&!['true','false'].includes(duplicate))throw new Error('invalid duplicatePadding');
            if(scale==='9grid'){const parts=(grid??'').split(',');if(parts.length!==4||parts.some(v=>!/^\d+$/.test(v)||Number(v)>2147483647)||Number(parts[2])===0||Number(parts[3])===0)throw new Error('invalid scale9grid');const [x,y,w,h]=parts.map(Number);if(x+w>metadata.width||y+h>metadata.height)foundWarnings.push({package:label,resource:name,warning:'scale9grid extends beyond image dimensions; editor may preserve it'});}
            else if((scale!==null&&scale!==''&&scale!=='tile')||grid!==null)throw new Error('invalid image scale settings');
            return {warnings:foundWarnings};
          }catch(error){return {warnings:foundWarnings,issue:{package:label,resource:name,error:error.message}};}
        });
        if (item.tagName==='component') {
          const node=parse(fs.readFileSync(file),'component');
          if(node.tagName!=='component') throw new Error('component root must be <component>');
          const lists=children(node,'displayList'); if(lists.length>1) throw new Error('component may have at most one displayList');
          const objects=children(lists[0]), objectIds=objects.map(n=>attr(n,'id'));
          if(objectIds.some(id=>!id) || new Set(objectIds).size!==objectIds.length) throw new Error('displayList children must have unique nonempty ids');
          for(const error of referenceIssues(node,index,label,urls)) issues.push({package:label,resource:name,error});
        }
        if(checkMedia && item.tagName==='sound') {
          const extension=path.extname(file).toLowerCase(), bytes=fs.readFileSync(file);
          if(extension==='.wav') inspectWav(bytes);else if(extension==='.mp3') inspectMp3(bytes);else if(extension==='.ogg') inspectOggVorbis(bytes);else throw new Error('unsupported sound format for media check');
          mediaChecked.sound++;
        }
        if(checkMedia && item.tagName==='movieclip') {
          if(path.extname(file).toLowerCase()!=='.jta')throw new Error('unsupported movieclip format for media check');
          await readJta(fs.readFileSync(file));mediaChecked.movieclip++;
        }
        if(checkMedia && item.tagName==='font') {
          if(path.extname(file).toLowerCase()!=='.fnt')throw new Error('unsupported font format for media check');
          const font=readBitmapFont(fs.readFileSync(file),attr(item,'texture'));
          const required=new Set(font.ttf?[font.texture]:font.glyphs.map(g=>g.image)), sizes=new Map();
          for(const id of required) {
            const found=resources(tree).filter(r=>r.tagName==='image' && attr(r,'id')===id);
            if(found.length!==1)throw new Error(`font image ${JSON.stringify(id)} is missing or ambiguous`);
            const metadata=await sharp(fs.readFileSync(componentPath(folder,found[0])),{failOn:'error'}).metadata();sizes.set(id,[metadata.width,metadata.height]);
          }
          if(font.ttf) {const [w,h]=sizes.get(font.texture);if(font.glyphs.some(g=>g.x+g.width>w || g.y+g.height>h))throw new Error('font glyph rectangle exceeds texture dimensions');}
          mediaChecked.font++;
        }
      } catch(error) { issues.push({package:label,resource:name,error:error.message}); }
    }
  }
  const results=new Array(imageJobs.length);let next=0;await Promise.all(Array.from({length:Math.min(4,imageJobs.length)},async()=>{while(next<imageJobs.length){const index=next++;results[index]=await imageJobs[index]();}}));for(const result of results){warnings.push(...result.warnings);if(result.issue)issues.push(result.issue);}
  return {valid:issues.length===0,issues,warnings,media_checked:checkMedia?mediaChecked:null,scope:'project and package XML structure, IDs, '+(closure?'exported resources and their dependencies':'all registered resources')+', image decoding and selected component references'+(checkMedia?'; PCM WAV, MP3 framing, Ogg Vorbis structure, JTA v102 and bitmap fonts':'')+'; not full editor or runtime compatibility'};
}
