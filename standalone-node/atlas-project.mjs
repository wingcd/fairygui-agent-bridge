import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { projectRoot, packages, resources, componentPath } from './project.mjs';
import { decodeImage, encodePng } from './images.mjs';
import { plan, render } from './atlas.mjs';

const digest = data => crypto.createHash('sha256').update(data).digest('hex');
async function prepare(args, keepPixels) {
  const root = projectRoot(args.project);
  const matched = packages(root).filter(({folder,tree}) => args.pkg === path.basename(folder) || args.pkg === tree.getAttribute('id'));
  if (matched.length !== 1) throw new Error('package not found or ambiguous');
  const {folder,tree} = matched[0], packageFile = path.join(folder,'package.xml');
  const packageBytes = await fs.readFile(packageFile);
  // Ensure the package did not change between the XML parse and this snapshot.
  const reloaded = packages(root).filter(p => p.folder === folder)[0];
  if (!reloaded || digest(packageBytes) !== digest(await fs.readFile(packageFile))) throw new Error('publication source changed');
  const snapshot = [[packageFile,digest(packageBytes)]], images = [], sources = Object.create(null);
  for (const item of resources(reloaded.tree).filter(item => item.tagName === 'image')) {
    const file = componentPath(folder,item), bytes = await fs.readFile(file), image = await decodeImage(bytes);
    snapshot.push([file,digest(bytes)]);
    images.push({id:item.getAttribute('id'),width:image.width,height:image.height});
    if (keepPixels) sources[item.getAttribute('id')] = image;
  }
  const rotate = args.rotate_images ?? false, shrink = args.shrink_atlas ?? false, optimize = args.optimize_atlas ?? false;
  if ([rotate,shrink,optimize].some(value => typeof value !== 'boolean')) throw new Error('atlas options must be boolean');
  const pages = plan(images,{width:args.width ?? 2048,height:args.height ?? 2048,padding:args.padding ?? 2,shrink,optimize,rotatable:rotate ? images.map(item=>item.id) : []});
  return {pages,images,sources,snapshot,folder};
}
async function verify(snapshot) {
  for (const [file,hash] of snapshot) if (digest(await fs.readFile(file)) !== hash) throw new Error(`publication source changed: ${file}`);
}
export async function atlasLayout(args) {
  const {pages,images,snapshot} = await prepare(args,false);
  await verify(snapshot);
  return {pages,image_count:images.length,scope:'layout only; optional rotation; no trimming, image export or FairyGUI package descriptor'};
}

export async function atlasExport(args) {
  if (process.platform !== 'win32') throw new Error('atlas export requires a no-replace directory rename, currently supported only on Windows');
  if (typeof args.output !== 'string' || !args.output) throw new Error('output is required');
  const output = path.resolve(args.output), parent = path.dirname(output);
  try { await fs.lstat(output); throw new Error('output directory must not already exist'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const {pages,images,sources,snapshot,folder} = await prepare(args,true);
  const stage = await fs.mkdtemp(path.join(parent,'.fgui-atlas-'));
  let moved = false;
  try {
    const canvases = render(pages,sources);
    for (const [index,canvas] of canvases.entries()) {
      const filename = `atlas_${index}.png`;
      await fs.writeFile(path.join(stage,filename),await encodePng(canvas));
      pages[index].file = filename;
    }
    const manifest = {pages,image_count:images.length,package:path.basename(folder),format:'fgui-agent-atlas-layout-v1'};
    await fs.writeFile(path.join(stage,'manifest.json'),JSON.stringify(manifest,null,2),'utf8');
    await verify(snapshot);
    try { await fs.lstat(output); throw new Error('output directory must not already exist'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rename(stage,output); moved = true;
    return {output,...manifest,scope:'atlas images and layout only; not a FairyGUI published package'};
  } finally { if (!moved) await fs.rm(stage,{recursive:true,force:true}); }
}
