import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
import {publishProject} from './publish-project.mjs';
import {execute} from './project.mjs';

// The preview runs the real Cocos runtime in a disposable copy of the supplied demo.
export async function screenshot(args) {
  for (const key of ['project','pkg','name','output','demo','distribution','creator','chrome'])
    if (typeof args[key] !== 'string' || !args[key]) throw new Error(`${key} is required`);
  const component = execute('list_items',args).filter(item => item.type === 'component' && [item.id,item.name,path.parse(item.name || '').name].includes(args.name));
  if (component.length !== 1) throw new Error('component not found or ambiguous');
  const pkg = execute('list_packages',args).find(item => item.name === args.pkg || item.id === args.pkg);
  const width=args.width ?? 1000, height=args.height ?? 700;
  if (![width,height].every(v => Number.isInteger(v) && v >= 1 && v <= 4096)) throw new Error('width and height must be integers between 1 and 4096');
  const output=path.resolve(args.output);
  try { await fs.lstat(output); throw new Error('output must not already exist'); } catch(e) { if(e.code !== 'ENOENT') throw e; }
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-screenshot-'));
  let server, browser;
  try {
    const demo=path.join(temp,'demo'); await fs.mkdir(demo);
    for (const name of ['assets','settings','profiles','preview-template','package.json','tsconfig.json']) {
      const source=path.join(args.demo,name); try { await fs.cp(source,path.join(demo,name),{recursive:true}); } catch(e) { if(e.code !== 'ENOENT' || !['settings','profiles','preview-template'].includes(name)) throw e; }
    }
    const lib=path.join(demo,'node_modules','fairygui-cc'); await fs.mkdir(lib,{recursive:true});
    await fs.copyFile(path.join(args.distribution,'package.json'),path.join(lib,'package.json'));
    await fs.cp(path.join(args.distribution,'dist'),path.join(lib,'dist'),{recursive:true});
    const result=await publishProject({project:args.project,output:path.join(temp,'published'),exported_only:true,binary_format:true});
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
    await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'load',timeout:60000});
    await page.waitForFunction(() => window.__fguiPreview && window.__fguiPreview.phase !== 'loading',null,{timeout:120000});
    const state=await page.evaluate(() => window.__fguiPreview);
    if(state.phase!=='ready'||state.errors.length||errorsBrowser.length)throw new Error(`runtime failed: ${JSON.stringify({state,errors:errorsBrowser})}`);
    await page.waitForTimeout(args.settle_ms ?? 1000);
    const png=await page.screenshot({type:'png'});await fs.writeFile(output,png,{flag:'wx'});
    return {output,package:pkg.name,component:component[0].id,width,height,renderer:'Cocos Creator web runtime',experimental:true};
  } finally { if(browser) await browser.close(); if(server) await new Promise(resolve=>server.close(resolve)); await fs.rm(temp,{recursive:true,force:true,maxRetries:3,retryDelay:500}); }
}

