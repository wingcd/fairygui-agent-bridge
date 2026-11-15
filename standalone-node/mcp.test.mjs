import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from './http-server.mjs';
import { message, tools } from './mcp.mjs';

test('MCP validates arguments against the published schemas before execution', async () => {
  const invoke = (name, args) => message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});
  const cases = [
    ['create_component',{project:'missing',pkg:'Demo',name:'Main',width:'10',height:10}],
    ['set_properties',{project:'missing',pkg:'Demo',name:'Main',target:'n1',expected_sha256:'x',props:{visible:'yes'}}],
    ['set_controller_actions',{project:'missing',pkg:'Demo',name:'Main',controller:'state',expected_sha256:'x',actions:[{transition:'go',extra:true}]}],
    ['validate',{project:'missing',check_media:'false'}]
  ];
  for (const [name,args] of cases) {
    assert.ok(tools.find(tool => tool.name === name));
    const response = await invoke(name,args);
    assert.equal(response.result.isError,true);
    assert.match(JSON.parse(response.result.content[0].text).error,/^invalid tool arguments:/);
  }
});

test('CLI and MCP apply the same schemas and return equivalent results', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'fgui-cli-parity-'));
  try {
    fs.mkdirSync(path.join(root,'assets','Demo'),{recursive:true});
    fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');
    fs.writeFileSync(path.join(root,'assets','Demo','package.xml'),'<packageDescription id="abcdefgh"><resources/></packageDescription>');
    for (const [name,args] of [
      ['list_packages',{project:root}],
      ['validate',{project:root,check_media:'false'}],
      ['create_component',{project:root,pkg:'Demo',name:'Main',width:'10',height:10}]
    ]) {
      const response = await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});
      const expected = JSON.parse(response.result.content[0].text);
      const actual = spawnSync(process.execPath,[fileURLToPath(new URL('./fgui.mjs',import.meta.url)),name,JSON.stringify(args)],{encoding:'utf8'});
      assert.equal(actual.status,expected.ok?0:1,actual.stderr);
      assert.deepEqual(JSON.parse(actual.stdout),expected);
    }
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('one Node HTTP service routes requests to separate projects', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'fgui-http-'));
  const server = createServer();
  try {
    for (const name of ['One','Two']) {
      const root = path.join(temp,name); fs.mkdirSync(path.join(root,'assets',name),{recursive:true});
      fs.writeFileSync(path.join(root,'p.fairy'),'<projectDescription/>');
      fs.writeFileSync(path.join(root,'assets',name,'package.xml'),`<packageDescription id="${name}"><resources/></packageDescription>`);
    }
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const url = `http://127.0.0.1:${server.address().port}/mcp`;
    const malformed = await fetch(url,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:7,method:'tools/call',params:{name:{toString:3},arguments:{}}})});
    assert.equal((await malformed.json()).error.code,-32602);
    for (const name of ['One','Two']) {
      const response = await fetch(url,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'list_packages',arguments:{project:path.join(temp,name)}}})});
      const result = await response.json();
      assert.equal(JSON.parse(result.result.content[0].text).data[0].name,name);
    }
    const rejected = await fetch(url,{method:'POST',headers:{'content-type':'application/json',origin:'https://example.com'},body:'{}'});
    assert.equal(rejected.status,403);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temp,{recursive:true,force:true});
  }
});

test('viewer endpoint restricts origins and permitted operations',async()=>{
  const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base=`http://127.0.0.1:${server.address().port}`;
    const page=await fetch(base+'/viewer');assert.equal(page.status,200);assert.match(await page.text(),/FairyGUI 组件预览/);
    const call={method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'create_package',arguments:{project:'x',name:'unsafe'}}})};
    assert.equal((await fetch(base+'/viewer-rpc',call)).status,403);
    call.headers.origin='https://example.com';assert.equal((await fetch(base+'/viewer-rpc',call)).status,403);
    delete call.headers.origin;assert.equal((await fetch(base+'/viewer-rpc',call)).status,403);
  } finally {await new Promise(resolve=>server.close(resolve));}
});


test('MCP rejects unpaired UTF-16 surrogates in values and keys',async()=>{
 for(const argumentsValue of [{project:'bad\ud800'},{project:'ok','bad\udc00':'value'},{project:'ok',nested:['\ud800x']}]){const result=await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'project_info',arguments:argumentsValue}});assert.equal(result.error.code,-32600);}
 const paired=await message({jsonrpc:'2.0',id:1,method:'ping',params:{note:'😀'}});assert.deepEqual(paired.result,{});
});
test('MCP Unicode validation handles large arrays without argument-stack overflow',async()=>{const result=await message({jsonrpc:'2.0',id:1,method:'ping',params:{values:Array(200000).fill('ok')}});assert.deepEqual(result.result,{})});
