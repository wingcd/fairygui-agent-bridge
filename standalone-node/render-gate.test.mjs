import {test} from 'node:test';import assert from 'node:assert/strict';import {RenderGate} from './render-gate.mjs';
test('render gate limits concurrent work, preserves queue order and releases failed slots',async()=>{
 const gate=new RenderGate(2),started=[],finish=[],runs=[];let active=0,peak=0;
 for(let i=0;i<5;i++)runs.push(gate.run(async()=>{started.push(i);active++;peak=Math.max(peak,active);try{await new Promise((resolve,reject)=>finish[i]={resolve,reject});return i;}finally{active--;}}));
 await Promise.resolve();assert.deepEqual(started,[0,1]);finish[1].reject(new Error('failed'));await assert.rejects(runs[1],/failed/);await Promise.resolve();assert.deepEqual(started,[0,1,2]);finish[0].resolve();assert.equal(await runs[0],0);await Promise.resolve();assert.deepEqual(started,[0,1,2,3]);finish[2].resolve();assert.equal(await runs[2],2);await Promise.resolve();assert.deepEqual(started,[0,1,2,3,4]);finish[3].resolve();finish[4].resolve();assert.deepEqual(await Promise.all([runs[3],runs[4]]),[3,4]);assert.equal(peak,2);assert.equal(gate.active,0);assert.equal(gate.waiting.length,0);
});
