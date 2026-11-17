import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
import {publishProject} from './publish-project.mjs';
import {execute,projectRoot,isFairyDescriptorName} from './project.mjs';
import {inspectPublished} from './published.mjs';
import {digestInputs} from './screenshot-cache.mjs';
import {pixiScreenshot} from './pixi-screenshot.mjs';
import {pixiRenderGate} from './render-gate.mjs';
import {pixiSharedRenders} from './shared-render.mjs';
import {resolveChrome} from './browser-path.mjs';
import {configurePreviewResolution} from './configure-preview.mjs';

const screenshotCache=new Map(),pixiCache=new Map(),pixiInflight=pixiSharedRenders;

export const screenshotBytes = Symbol('screenshotBytes');

// The preview runs the real Cocos runtime in a disposable copy of the supplied demo.
export async function screenshot(args,{signal}={}) {
  args={renderer:'pixi',...args};
  for (const [key,env] of Object.entries({demo:'FGUI_COCOS_DEMO',distribution:'FGUI_COCOS_DISTRIBUTION',creator:'FGUI_COCOS_CREATOR',chrome:'FGUI_CHROME'})) args[key] ??= process.env[env] || undefined;
  if(args.renderer!==undefined&&!['cocos','pixi'].includes(args.renderer))throw new Error('invalid renderer');
  if(args.controller_pages!==undefined&&(args.renderer!=='pixi'||!args.controller_pages||typeof args.controller_pages!=='object'||Array.isArray(args.controller_pages)||Object.entries(args.controller_pages).some(([name,id])=>!name||typeof id!=='string'||!id)))throw new Error('controller_pages requires a PIXI controller name to page ID object');
  if(args.controller_overrides!==undefined&&(args.renderer!=='pixi'||!Array.isArray(args.controller_overrides)||args.controller_overrides.length>128||args.controller_overrides.some(item=>!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(key=>!['path','controller','page'].includes(key))||!Array.isArray(item.path)||item.path.length>32||item.path.some(id=>typeof id!=='string'||!id)||typeof item.controller!=='string'||!item.controller||typeof item.page!=='string'||!item.page)))throw new Error('controller_overrides requires PIXI child ID paths and controller/page IDs');
  const selectedControllers=[...Object.keys(args.controller_pages??{}).map(name=>JSON.stringify([[],name])),...(args.controller_overrides??[]).map(item=>JSON.stringify([item.path,item.controller]))];if(new Set(selectedControllers).size!==selectedControllers.length)throw new Error('duplicate controller override');

  if(args.renderer==='pixi'){
    const checkCancelled=()=>{if(signal?.aborted)throw Object.assign(new Error('render request cancelled'),{name:'AbortError'});};
    checkCancelled();
    args.chrome=await resolveChrome(args.chrome);
    if(args.reuse_screenshot!==undefined&&typeof args.reuse_screenshot!=='boolean')throw new Error('reuse_screenshot must be a boolean');
    if(args.settle_ms!==undefined&&(!Number.isInteger(args.settle_ms)||args.settle_ms<0||args.settle_ms>10000))throw new Error('invalid settle_ms');
    if(args.output!==undefined&&(typeof args.output!=='string'||!args.output))throw new Error('output must be a nonempty path');
    const output=args.output===undefined?null:path.resolve(args.output);if(output){try{await fs.lstat(output);throw new Error('output must not already exist')}catch(e){if(e.code!=='ENOENT')throw e}const parent=await fs.stat(path.dirname(output));if(!parent.isDirectory())throw new Error('output parent must be a directory');}
    let fingerprint,key;
    if(args.reuse_screenshot){
      for(const name of ['project','pkg','name','chrome'])if(typeof args[name]!=='string'||!args[name])throw new Error(name+' is required');
      const root=projectRoot(args.project),selectedProject=await fs.realpath(args.project),here=path.dirname(fileURLToPath(import.meta.url));
      fingerprint=async()=>{const descriptors=(await fs.readdir(root)).filter(isFairyDescriptorName).sort();
      const entries=[['assets',path.join(root,'assets')],['settings',path.join(root,'settings'),true],...descriptors.map(n=>['descriptor/'+n,path.join(root,n)]),['chrome',args.chrome],...['vendor/fairygui-pixi/fairygui.js','node_modules/pixi.js/dist/browser/pixi.min.js','node_modules/@createjs/tweenjs/dist/tweenjs.min.js','node_modules/zlibjs/bin/rawinflate.min.js','package-lock.json'].map(n=>['runtime/'+n,path.join(here,n)]),...(await fs.readdir(here)).filter(n=>n.endsWith('.mjs')&&!n.endsWith('.test.mjs')).sort().map(n=>['implementation/'+n,path.join(here,n)])];
      return digestInputs(entries,{renderer:'pixi',root,selectedProject,pkg:args.pkg,name:args.name,width:args.width??1000,height:args.height??700,settle_ms:args.settle_ms??1000,controller_pages:args.controller_pages??{},controller_overrides:args.controller_overrides??[],chrome:path.resolve(args.chrome)});};
      key=await fingerprint();checkCancelled();const hit=pixiCache.get(key);if(hit){pixiCache.delete(key);pixiCache.set(key,hit);if(output)await fs.writeFile(output,hit.png,{flag:'wx'});return {output,package:hit.pkg,component:hit.component,width:hit.width,height:hit.height,renderer:'FairyGUI PIXI web runtime',experimental:true,cached:true,[screenshotBytes]:hit.png};}
    }
    const render=async renderSignal=>{const result=await pixiRenderGate.run(()=>pixiScreenshot(args),{signal:renderSignal});if(key&&result.png.length<=8*1024*1024&&await fingerprint()===key){pixiCache.set(key,result);while(pixiCache.size>4)pixiCache.delete(pixiCache.keys().next().value);}return result;};
    let rendered,shared=false;if(key){const result=await pixiInflight.run(key,render,signal);rendered=result.value;shared=result.shared;}else rendered=await render(signal);
    checkCancelled();if(output)await fs.writeFile(output,rendered.png,{flag:'wx'});return {output,package:rendered.pkg,component:rendered.component,width:rendered.width,height:rendered.height,renderer:'FairyGUI PIXI web runtime',experimental:true,cached:shared,[screenshotBytes]:rendered.png};
  }
  for (const key of ['project','pkg','name','demo','distribution','creator','chrome'])
    if (typeof args[key] !== 'string' || !args[key]) throw new Error(`${key} is required`);
  const component = execute('list_items',args).filter(item => item.type === 'component' && [item.id,item.name,path.parse(item.name || '').name].includes(args.name));
  if (component.length !== 1) throw new Error('component not found or ambiguous');
  const pkg = execute('list_packages',args).find(item => item.name === args.pkg || item.id === args.pkg);
  if (args.reuse_screenshot !== undefined && typeof args.reuse_screenshot !== 'boolean') throw new Error('reuse_screenshot must be a boolean');
  const width=args.width ?? 1000, height=args.height ?? 700;
  if (![width,height].every(v => Number.isInteger(v) && v >= 1 && v <= 4096)) throw new Error('width and height must be integers between 1 and 4096');
  if (args.settle_ms !== undefined && (!Number.isInteger(args.settle_ms) || args.settle_ms < 0 || args.settle_ms > 10000)) throw new Error('settle_ms must be an integer between 0 and 10000');
  if(args.output!==undefined&&(typeof args.output!=='string'||!args.output))throw new Error('output must be a nonempty path');
  const output=args.output===undefined?null:path.resolve(args.output);
  if(output){try { await fs.lstat(output); throw new Error('output must not already exist'); } catch(e) { if(e.code !== 'ENOENT') throw e; }
  const parent=await fs.stat(path.dirname(output));
  if (!parent.isDirectory()) throw new Error('output parent must be a directory');}
  for (const [key,kind] of [['demo','directory'],['distribution','directory'],['creator','file'],['chrome','file']]) {
    const stat=await fs.stat(args[key]);
    if (!(kind === 'directory' ? stat.isDirectory() : stat.isFile())) throw new Error(`${key} must be a ${kind}`);
  }
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-screenshot-'));
  let server, browser;
  try {
    const result=await publishProject({project:args.project,output:path.join(temp,'published'),exported_only:true,binary_format:true},{extraRoots:new Map([[pkg.path,[component[0].id]]]),roots:new Set([pkg.path])});
    const target=result.packages.find(record=>record.package===pkg.name);
    if (!target) throw new Error('component package has no published resources');
    const published=await inspectPublished({file:path.join(result.output,target.file)});
    if (!published.items.some(item=>item.type===3 && item.id===component[0].id)) throw new Error('component is not included in the published package; export it or reference it from an exported component');
    const inputs=[['published',result.output],...['assets','settings','profiles','preview-template','package.json','tsconfig.json'].map(name=>['demo/'+name,path.join(args.demo,name),['settings','profiles','preview-template'].includes(name)]),['distribution/package.json',path.join(args.distribution,'package.json')],['distribution/dist',path.join(args.distribution,'dist')],['creator',args.creator],['chrome',args.chrome],['implementation',fileURLToPath(import.meta.url)]];
    const fingerprint=()=>digestInputs(inputs,{package:pkg.name,component:component[0].id,width,height,settle_ms:args.settle_ms??1000,creator:path.resolve(args.creator),chrome:path.resolve(args.chrome),demo:path.resolve(args.demo),distribution:path.resolve(args.distribution)});
    const key=args.reuse_screenshot?await fingerprint():null;
    const cached=key?screenshotCache.get(key):null;
    if(cached){if(output)await fs.writeFile(output,cached,{flag:'wx'});return {output,package:pkg.name,component:component[0].id,width,height,renderer:'Cocos Creator web runtime',experimental:true,cached:true,[screenshotBytes]:cached};}
    const demo=path.join(temp,'demo'); await fs.mkdir(demo);
    for (const name of ['assets','settings','profiles','preview-template','package.json','tsconfig.json']) {
      const source=path.join(args.demo,name); try { await fs.cp(source,path.join(demo,name),{recursive:true}); } catch(e) { if(e.code !== 'ENOENT' || !['settings','profiles','preview-template'].includes(name)) throw e; }
    }
    await configurePreviewResolution(demo,width,height);
    const lib=path.join(demo,'node_modules','fairygui-cc'); await fs.mkdir(lib,{recursive:true});
    await fs.copyFile(path.join(args.distribution,'package.json'),path.join(lib,'package.json'));
    await fs.cp(path.join(args.distribution,'dist'),path.join(lib,'dist'),{recursive:true});
    const ui=path.join(demo,'assets','resources','UI'); await fs.mkdir(ui,{recursive:true});
    for(const item of result.packages) for(const file of await fs.readdir(path.join(result.output,item.package),{withFileTypes:true}))
      if(file.isFile()) await fs.copyFile(path.join(result.output,item.package,file.name),path.join(ui,file.name));
    const script=path.join(demo,'assets','script','demo','MainMenu.ts'); let code=await fs.readFile(script,'utf8');
    const start=code.indexOf('    onLoad() {'), end=code.indexOf('\n    onUILoaded()',start);
    if(start<0||end<0) throw new Error('unsupported Cocos demo template');
    const runtime=`    onLoad() {
        dynamicAtlasManager.enabled = false;
        profiler.hideStats();
        fgui.UIConfig.enableDelayLoad = false;
        const state = (window as any).__fguiPreview = { phase: 'loading', errors: [] };
        const names: string[] = ${JSON.stringify(result.packages.map(p=>p.package))};
        const packages: fgui.UIPackage[] = [];
        const next = (i: number) => {
            if (i === names.length) {
                try {
                    const pkg = packages.find(p => p.name === ${JSON.stringify(pkg.name)});
                    const item = pkg && pkg.getItemById(${JSON.stringify(component[0].id)});
                    if (!pkg || !item) throw new Error('component not published');
                    const obj = pkg.internalCreateObject(item);
                    if (!obj) throw new Error('component could not be constructed');
                    const scale = Math.min(1, ${width} / obj.width, ${height} / obj.height);
                    if (Number.isFinite(scale) && scale > 0) obj.setScale(scale, scale);
                    fgui.GRoot.inst.addChild(obj);
                    requestAnimationFrame(() => requestAnimationFrame(() => { state.phase = 'ready'; }));
                } catch (e) { state.errors.push(String(e)); state.phase = 'error'; }
                return;
            }
            fgui.UIPackage.loadPackage('UI/' + names[i], (error: any, pkg: fgui.UIPackage) => {
                if (error || !pkg) { state.errors.push(names[i] + ': ' + String(error)); state.phase = 'error'; return; }
                packages.push(pkg); next(i + 1);
            });
        }; next(0);
    }
`;
    code=`import { profiler } from "cc";` + code.slice(0,start)+runtime+code.slice(end); await fs.writeFile(script,code);
    let log=''; const child=spawn(args.creator,['--project',demo,'--build','platform=web-mobile;debug=true'],{windowsHide:true});
    child.stdout.on('data',d=>{log=(log+d).slice(-100000)});child.stderr.on('data',d=>{log=(log+d).slice(-100000)});
    const codeExit=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error('Cocos build timed out'));},600000);child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('close',c=>{clearTimeout(timer);resolve(c)});});
    const web=path.join(demo,'build','web-mobile');
    const errors=log.split(/\r?\n/).filter(line=>/\berror:/i.test(line));
    if(!log.includes('build success') || ![0,36].includes(codeExit) || errors.some(line=>!line.includes('[BABEL]')||!line.includes('exceeds the max of 500KB'))) throw new Error(`Cocos build failed (${codeExit}): ${log.slice(-4000)}`);
    await fs.access(path.join(web,'index.html'));
    server=http.createServer(async(req,res)=>{try {const url=new URL(req.url,'http://localhost');const relative=decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';const file=path.resolve(web,relative);if(!file.startsWith(web+path.sep))throw new Error('invalid path');const data=await fs.readFile(file); const ext=path.extname(file).toLowerCase();res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.css':'text/css'}[ext]||'application/octet-stream')});res.end(data);}catch{res.writeHead(404);res.end();}});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({executablePath:args.chrome,headless:true,args:['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader']});
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});const errorsBrowser=[];
    page.on('pageerror',error=>errorsBrowser.push(error.message));
    page.on('console',message=>{if(message.type()==='error') errorsBrowser.push(message.text());});
    await page.route('**/favicon.ico',route=>route.fulfill({status:204}));
    await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'load',timeout:60000});
    await page.waitForFunction(() => window.__fguiPreview && window.__fguiPreview.phase !== 'loading',null,{timeout:120000});
    const state=await page.evaluate(() => window.__fguiPreview);
    if(state.phase!=='ready'||state.errors.length||errorsBrowser.length)throw new Error(`runtime failed: ${JSON.stringify({state,errors:errorsBrowser})}`);
    // Allow runtime-loaded assets and browser fonts to finish before capturing.
    await page.waitForLoadState('networkidle',{timeout:30000});
    await page.waitForFunction(() => !document.fonts || document.fonts.status === 'loaded',null,{timeout:30000});
    await page.waitForTimeout(args.settle_ms ?? 1000);
    await page.evaluate(() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    if(errorsBrowser.length) throw new Error(`runtime failed after settling: ${JSON.stringify(errorsBrowser)}`);
    const png=await page.screenshot({type:'png'});
    if(key && png.length<=8*1024*1024 && await fingerprint()===key){screenshotCache.delete(key);screenshotCache.set(key,png);while(screenshotCache.size>4)screenshotCache.delete(screenshotCache.keys().next().value);}
    if(output)await fs.writeFile(output,png,{flag:'wx'});
    return {output,package:pkg.name,component:component[0].id,width,height,renderer:'Cocos Creator web runtime',experimental:true,cached:false,[screenshotBytes]:png};
  } finally { if(browser) await browser.close(); if(server) await new Promise(resolve=>server.close(resolve)); await fs.rm(temp,{recursive:true,force:true,maxRetries:3,retryDelay:500}); }
}

