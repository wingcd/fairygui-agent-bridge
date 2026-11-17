import {test} from 'node:test';import assert from 'node:assert/strict';import {RenderGate} from './render-gate.mjs';
test('render gate limits concurrent work, preserves queue order and releases failed slots',async()=>{
 const gate=new RenderGate(2),started=[],finish=[],runs=[];let active=0,peak=0;
 for(let i=0;i<5;i++)runs.push(gate.run(async()=>{started.push(i);active++;peak=Math.max(peak,active);try{await new Promise((resolve,reject)=>finish[i]={resolve,reject});return i;}finally{active--;}}));
 await Promise.resolve();assert.deepEqual(started,[0,1]);finish[1].reject(new Error('failed'));await assert.rejects(runs[1],/failed/);await Promise.resolve();assert.deepEqual(started,[0,1,2]);finish[0].resolve();assert.equal(await runs[0],0);await Promise.resolve();assert.deepEqual(started,[0,1,2,3]);finish[2].resolve();assert.equal(await runs[2],2);await Promise.resolve();assert.deepEqual(started,[0,1,2,3,4]);finish[3].resolve();finish[4].resolve();assert.deepEqual(await Promise.all([runs[3],runs[4]]),[3,4]);assert.equal(peak,2);assert.equal(gate.active,0);assert.equal(gate.waiting.length,0);
});

test('render concurrency can be configured and rejects invalid settings',async()=>{
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');const run=promisify(execFile),code='import {pixiRenderGate} from '+JSON.stringify(new URL('./render-gate.mjs',import.meta.url).href)+'; console.log(pixiRenderGate.limit)';
 for(const value of ['1','4']){const {stdout}=await run(process.execPath,['--input-type=module','-e',code],{env:{...process.env,FGUI_PIXI_CONCURRENCY:value},windowsHide:true});assert.equal(stdout.trim(),value);}
 await assert.rejects(run(process.execPath,['--input-type=module','-e',code],{env:{...process.env,FGUI_PIXI_CONCURRENCY:'0'},windowsHide:true}),error=>{assert.match(error.stderr,/FGUI_PIXI_CONCURRENCY/);return true;});
});

test('HTTP health reports active and queued Pixi renders',async()=>{
 const {pixiRenderGate}=await import('./render-gate.mjs'),{createServer}=await import('./http-server.mjs');const server=createServer(),resolvers=[],jobs=[];
 try{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));for(let i=0;i<pixiRenderGate.limit+1;i++)jobs.push(pixiRenderGate.run(()=>new Promise(resolve=>resolvers.push(resolve))));await Promise.resolve();const response=await fetch(`http://127.0.0.1:${server.address().port}/health`),body=await response.json();assert.equal(body.ok,true);assert.deepEqual(body.pixi_renders,{limit:pixiRenderGate.limit,active:pixiRenderGate.limit,queued:1});}
 finally{while(resolvers.length){const resolve=resolvers.shift();resolve();await Promise.resolve();await Promise.resolve();}await Promise.all(jobs);await new Promise(resolve=>server.close(resolve));}
});
