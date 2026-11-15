import test from 'node:test';
import assert from 'node:assert/strict';
import {message,tools} from './mcp.mjs';

test('CLI captures a PNG using the default PIXI renderer',{skip:!process.env.FGUI_CHROME||!process.env.FGUI_SAMPLE_PROJECT,timeout:120000},async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{fileURLToPath}=await import('node:url');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-pixi-cli-'));
 try{
  const output=path.join(root,'capture.png'),args={project:process.env.FGUI_SAMPLE_PROJECT,pkg:'MainMenu',name:'Main',output,chrome:process.env.FGUI_CHROME,settle_ms:0};
  const {stdout}=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('./fgui.mjs',import.meta.url)),'screenshot',JSON.stringify(args)],{timeout:110000,windowsHide:true}).catch(error=>{throw new Error(`CLI failed: ${error.stdout||error.message}`)});
  const result=JSON.parse(stdout);assert.equal(result.ok,true,stdout);assert.match(result.data.renderer,/PIXI/);assert.deepEqual((await fs.readFile(output)).subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('viewer renders and downloads a default PIXI screenshot',{skip:!process.env.FGUI_CHROME||!process.env.FGUI_SAMPLE_PROJECT,timeout:120000},async()=>{
 const {chromium}=await import('playwright-core'),{createServer}=await import('./http-server.mjs');
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-pixi-viewer-')),server=createServer();let browser;
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({executablePath:process.env.FGUI_CHROME,headless:true});
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/viewer`);
  assert.equal(await page.locator('[name=renderer]').inputValue(),'pixi');
  for(const [key,value] of Object.entries({project:process.env.FGUI_SAMPLE_PROJECT,pkg:'MainMenu',name:'Main',chrome:process.env.FGUI_CHROME,settle_ms:'0'}))await page.locator(`[name="${key}"]`).fill(value);
  await page.locator('button[type=submit]').click();await page.waitForFunction(()=>!document.querySelector('button[type=submit]').disabled,null,{timeout:100000});
  const state=await page.evaluate(()=>({status:document.querySelector('#status').textContent,visible:!document.querySelector('#image').hidden,width:document.querySelector('#image').naturalWidth}));assert.equal(state.visible,true,state.status);assert.ok(state.width>0);
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#download').click()]);const file=path.join(root,'preview.png');await download.saveAs(file);assert.deepEqual((await fs.readFile(file)).subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});}
});

test('screenshot tool publishes its required inputs and checks viewport limits',async()=>{
  const schema=tools.find(tool=>tool.name==='screenshot').inputSchema;
  assert.deepEqual(schema.required,['project','pkg','name']);
  const result=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'screenshot',arguments:{project:'x',pkg:'x',name:'x',output:'x',demo:'x',distribution:'x',creator:'x',chrome:'x',width:4097}}});
  assert.equal(result.result.isError,true);
  assert.match(result.result.content[0].text,/invalid tool arguments/);
});

test('screenshot rejects missing output parent before starting a build',async()=>{
  const fs=await import('node:fs/promises');
  const os=await import('node:os');
  const path=await import('node:path');
  const {screenshot}=await import('./screenshot.mjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-shot-test-'));
  try {
    await fs.mkdir(path.join(root,'assets','P'),{recursive:true});
    await fs.writeFile(path.join(root,'p.fairy'),'<project/>');
    await fs.writeFile(path.join(root,'assets','P','package.xml'),'<packageDescription id="abcdefgh"><resources><component id="item" name="Main.xml"/></resources></packageDescription>');
    const keys=['FGUI_COCOS_DEMO','FGUI_COCOS_DISTRIBUTION','FGUI_COCOS_CREATOR','FGUI_CHROME'];const previous=keys.map(k=>process.env[k]);
    try {for(const k of keys)process.env[k]=root;await assert.rejects(screenshot({project:root,pkg:'P',name:'Main',output:path.join(root,'missing','out.png')}),/ENOENT/);} finally {keys.forEach((k,i)=>{if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i]})}
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test('MCP screenshot response includes PNG image and JSON metadata',async()=>{
  const {toolContent}=await import('./mcp.mjs');
  const {screenshotBytes}=await import('./screenshot.mjs');
  const png=Buffer.from([137,80,78,71]);
  const blocks=toolContent('screenshot',{ok:true,data:{output:'a.png',[screenshotBytes]:png}});
  assert.equal(JSON.parse(blocks[0].text).data.output,'a.png');
  assert.deepEqual(blocks[1],{type:'image',mimeType:'image/png',data:png.toString('base64')});
});

test('real Cocos screenshot returns the saved PNG through MCP', {skip:!process.env.FGUI_SCREENSHOT_CONFIG,timeout:720000},async()=>{
  const fs=await import('node:fs/promises');
  const os=await import('node:os');
  const path=await import('node:path');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-shot-mcp-'));
  try {
    const config={...JSON.parse(await fs.readFile(process.env.FGUI_SCREENSHOT_CONFIG,'utf8')),renderer:'cocos'};
    const output=path.join(root,'capture.png');
    const response=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'screenshot',arguments:{...config,output,reuse_screenshot:true}}});
    assert.equal(response.result.isError,false,response.result.content[0].text);
    const image=response.result.content.find(item=>item.type==='image');
    assert.equal(image?.mimeType,'image/png');
    assert.deepEqual(Buffer.from(image.data,'base64'),await fs.readFile(output));
    const second=await message({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'screenshot',arguments:{...config,reuse_screenshot:true}}});
    assert.equal(second.result.isError,false,second.result.content[0].text);
    assert.equal(JSON.parse(second.result.content[0].text).data.cached,true);
    assert.equal(JSON.parse(second.result.content[0].text).data.output,null);
    assert.deepEqual(Buffer.from(second.result.content[1].data,'base64'),await fs.readFile(output));
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test('viewer renders a real Cocos screenshot in the browser', {skip:!process.env.FGUI_SCREENSHOT_CONFIG,timeout:720000},async()=>{
  const fs=await import('node:fs/promises'), os=await import('node:os'), path=await import('node:path');
  const {chromium}=await import('playwright-core'),{createServer}=await import('./http-server.mjs');
  const config={...JSON.parse(await fs.readFile(process.env.FGUI_SCREENSHOT_CONFIG,'utf8')),renderer:'cocos'};
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-viewer-test-'));
  const server=createServer();let browser;
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({executablePath:config.chrome,headless:true});
    const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/viewer`);
    await page.locator('[name=renderer]').selectOption('cocos');
    for(const key of ['project','pkg','name','demo','distribution','creator','chrome']) await page.locator(`[name="${key}"]`).fill(config[key]);
    // Leave output empty: the viewer must expose an actual browser download.
    await page.locator('button[type=submit]').click();await page.waitForFunction(()=>!document.querySelector('button[type=submit]').disabled,null,{timeout:700000});
    if (await page.locator('#image').isVisible()) await page.locator('#image').evaluate(img => img.decode());
    const state=await page.evaluate(()=>({status:document.querySelector('#status').textContent,visible:!document.querySelector('#image').hidden,width:document.querySelector('#image').naturalWidth}));
    assert.equal(state.visible,true,state.status);assert.ok(state.width>0);const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#download').click()]);const downloaded=path.join(root,'download.png');await download.saveAs(downloaded);assert.deepEqual((await fs.readFile(downloaded)).subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
  } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});}
});

test('preview publication includes an unexported target without modifying the project',{skip:process.platform!=='win32'},async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {publishProject}=await import('./publish-project.mjs');const {inspectPublished}=await import('./published.mjs');const root=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-shot-unpublished-'));
 try{const pkg=path.join(root,'assets','Demo');await fs.mkdir(pkg,{recursive:true});await fs.writeFile(path.join(root,'p.fairy'),'<projectDescription/>');await fs.writeFile(path.join(pkg,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="visible" name="Visible.xml" path="/" exported="true"/><component id="hidden" name="Hidden.xml" path="/"/></resources><publish name="Demo"/></packageDescription>');
 const other=path.join(root,'assets','Other');await fs.mkdir(other,{recursive:true});await fs.writeFile(path.join(other,'package.xml'),'<packageDescription id="bbbbbbbb"><resources><swf id="unsupported" name="x.swf" exported="true"/></resources></packageDescription>');await fs.writeFile(path.join(other,'x.swf'),'irrelevant');
 for(const name of ['Visible','Hidden'])await fs.writeFile(path.join(pkg,name+'.xml'),'<component size="10,10"><displayList/></component>');
 const before=await fs.readFile(path.join(pkg,'package.xml'),'utf8');const result=await publishProject({project:root,output:path.join(root,'out'),binary_format:true},{extraRoots:new Map([[pkg,['hidden']]]),roots:new Set([pkg])});const data=await inspectPublished({file:path.join(result.output,result.packages[0].file)});assert.ok(data.items.some(item=>item.id==='hidden'&&item.type===3));assert.equal(await fs.readFile(path.join(pkg,'package.xml'),'utf8'),before);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('stdio MCP serves another project while a real screenshot is rendering',{skip:!process.env.FGUI_SCREENSHOT_CONFIG,timeout:720000},async()=>{
 const fs=await import('node:fs/promises'),{spawn}=await import('node:child_process'),readline=await import('node:readline');const config={...JSON.parse(await fs.readFile(process.env.FGUI_SCREENSHOT_CONFIG,'utf8')),renderer:'cocos'};const os=await import('node:os'),path=await import('node:path');const other=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-other-project-'));await fs.mkdir(path.join(other,'assets','Other'),{recursive:true});await fs.writeFile(path.join(other,'p.fairy'),'<projectDescription/>');await fs.writeFile(path.join(other,'assets','Other','package.xml'),'<packageDescription id="abcdefgh"><resources/></packageDescription>');const script=new URL('./mcp-server.mjs',import.meta.url);const {fileURLToPath}=await import('node:url');const child=spawn(process.execPath,[fileURLToPath(script)],{stdio:['pipe','pipe','pipe'],windowsHide:true});const responses=[],lines=readline.createInterface({input:child.stdout});let stderr='';child.stderr.on('data',v=>stderr+=v);
 const done=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('stdio screenshot timed out')),700000);lines.on('line',line=>{try{const value=JSON.parse(line);responses.push(value);if(responses.some(v=>v.id===10)&&responses.some(v=>v.id===11)&&responses.some(v=>v.id===12)){clearTimeout(timer);resolve();}}catch(error){clearTimeout(timer);reject(error)}});child.on('error',reject);child.on('exit',code=>{if(code!==0)reject(new Error(`stdio exited ${code}: ${stderr}`))});});
 try{child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:10,method:'tools/call',params:{name:'screenshot',arguments:config}})+'\n');child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:11,method:'ping'})+'\n');child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:12,method:'tools/call',params:{name:'list_packages',arguments:{project:other}}})+'\n');child.stdin.end();await done;assert.ok(responses.findIndex(v=>v.id===12)<responses.findIndex(v=>v.id===10));assert.equal(JSON.parse(responses.find(v=>v.id===12).result.content[0].text).data[0].name,'Other');assert.equal(responses.find(v=>v.id===10).result.isError,false);}finally{if(child.exitCode===null){child.kill();}lines.close();await fs.rm(other,{recursive:true,force:true});}
});

test('HTTP MCP serves another project while a real screenshot is rendering',{skip:!process.env.FGUI_SCREENSHOT_CONFIG,timeout:720000},async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');const {createServer}=await import('./http-server.mjs');const config={...JSON.parse(await fs.readFile(process.env.FGUI_SCREENSHOT_CONFIG,'utf8')),renderer:'cocos'};const root=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-http-other-'));const server=createServer();
 try{await fs.mkdir(path.join(root,'assets','Other'),{recursive:true});await fs.writeFile(path.join(root,'p.fairy'),'<projectDescription/>');await fs.writeFile(path.join(root,'assets','Other','package.xml'),'<packageDescription id="abcdefgh"><resources/></packageDescription>');await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/mcp`,headers={'content-type':'application/json',accept:'application/json, text/event-stream'},call=(id,name,args)=>fetch(url,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}})}).then(response=>response.json());let screenshotDone=false;const pending=call(1,'screenshot',config).then(value=>{screenshotDone=true;return value});const second=await call(2,'list_packages',{project:root});assert.equal(screenshotDone,false);assert.equal(JSON.parse(second.result.content[0].text).data[0].name,'Other');const image=await pending;assert.equal(image.result.isError,false);assert.equal(image.result.content[1].mimeType,'image/png');
 }finally{await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true})}
});

test('Cocos and PIXI fit a component to the same viewport',{skip:!process.env.FGUI_SCREENSHOT_CONFIG||process.platform!=='win32',timeout:600000},async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),sharp=(await import('sharp')).default,config=JSON.parse(await fs.readFile(process.env.FGUI_SCREENSHOT_CONFIG,'utf8')),root=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-viewport-parity-'));
 try{const dir=path.join(root,'assets','Demo');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(root,'p.fairy'),'<projectDescription type="CocosCreator"/>');await fs.writeFile(path.join(dir,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/" exported="true"/></resources><publish name="Demo"/></packageDescription>');await fs.writeFile(path.join(dir,'Main.xml'),'<component size="400,200"><displayList><graph id="g" xy="100,50" size="100,50" type="rect" lineSize="0" fillColor="#ffff0000"/></displayList></component>');const bounds=[];for(const renderer of ['pixi','cocos']){const response=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'screenshot',arguments:{...config,project:root,pkg:'Demo',name:'Main',renderer,width:200,height:100,settle_ms:0}}});assert.equal(response.result.isError,false,response.result.content[0].text);const {data,info}=await sharp(Buffer.from(response.result.content[1].data,'base64')).removeAlpha().raw().toBuffer({resolveWithObject:true});let minX=200,minY=100,maxX=-1,maxY=-1;for(let y=0;y<100;y++)for(let x=0;x<200;x++){const i=(y*info.width+x)*3;if(data[i]>200&&data[i+1]<50&&data[i+2]<50){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}assert.ok(maxX>=minX&&maxY>=minY,renderer+' graph is visible');bounds.push([minX,minY,maxX,maxY]);}for(let i=0;i<4;i++)assert.ok(Math.abs(bounds[0][i]-bounds[1][i])<=2,`bounds differ: ${JSON.stringify(bounds)}`);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('one HTTP service renders two projects concurrently',{skip:!process.env.FGUI_CHROME||process.platform!=='win32',timeout:90000},async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),sharp=(await import('sharp')).default,{createServer}=await import('./http-server.mjs'),root=await fs.mkdtemp(path.join(os.tmpdir(),'fgui http 截图 -')),server=createServer();
 try{const projects=[];for(const [name,color] of [['one','#ffff0000'],['two','#ff00ff00']]){const project=path.join(root,name),dir=path.join(project,'assets','Demo');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(project,'p.fairy'),'<projectDescription type="CocosCreator"/>');await fs.writeFile(path.join(dir,'package.xml'),'<packageDescription id="abcdefgh"><resources><component id="main" name="Main.xml" path="/" exported="true"/></resources><publish name="Demo"/></packageDescription>');await fs.writeFile(path.join(dir,'Main.xml'),`<component size="40,40"><displayList><graph id="g" xy="0,0" size="20,20" type="rect" lineSize="0" fillColor="${color}"/></displayList></component>`);projects.push(project);}await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const endpoint=`http://127.0.0.1:${server.address().port}/rpc`,responses=await Promise.all(projects.map((project,id)=>fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name:'screenshot',arguments:{project,pkg:'Demo',name:'Main',width:40,height:40,settle_ms:0,reuse_screenshot:true}}})})));const colors=[];for(const response of responses){assert.equal(response.status,200);const payload=await response.json();assert.equal(payload.result.isError,false,payload.result.content[0].text);const raw=await sharp(Buffer.from(payload.result.content.find(c=>c.type==='image').data,'base64')).removeAlpha().raw().toBuffer();colors.push([...raw.subarray((10*40+10)*3,(10*40+10)*3+3)]);}assert.deepEqual(colors,[[255,0,0],[0,255,0]]);}finally{if(server.listening)await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});}
});
