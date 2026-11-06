import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fgui-queue-'));
process.env.USERPROFILE = home;
process.env.HOME = home;
const {request, discover, selectInstance, route} = await import('../cli/instances.mjs');
const callbacks = {onUpdate: new Set(), onProjectOpened: new Set(), onProjectClosed: new Set()};
const App = {project: {name:'test', basePath:path.join(home,'project'), allPackages:{Count:0}},
    pluginManager: {basePath:path.join(home,'project','plugins')},
    menu:{GetSubMenu:()=>({AddItem(){},RemoveItem(){}})}};
for (const [name, set] of Object.entries(callbacks)) {
    App['add_'+name] = fn => set.add(fn); App['remove_'+name] = fn => set.delete(fn);
}
const dir = {CreateDirectory:p=>fs.mkdirSync(p,{recursive:true}), GetFiles:(p)=>{
    const names=fs.readdirSync(p).filter(n=>n.endsWith('.json')).map(n=>path.join(p,n));
    return {Length:names.length, GetValue:i=>names[i]};
}};
const file = {WriteAllText:(p,v)=>fs.writeFileSync(p,v), ReadAllText:p=>fs.readFileSync(p,'utf8'),
    Move:(a,b)=>{if(fs.existsSync(b)) throw Error('exists'); fs.renameSync(a,b);},
    Delete:p=>{try {fs.unlinkSync(p);} catch(e) {if(e.code!=='ENOENT') throw e;}}, Exists:p=>fs.existsSync(p)};
const context=vm.createContext({exports:{},console,CS:{FairyGUI:{},FairyEditor:{App},UnityEngine:{Application:{}},System:{
    Environment:{SpecialFolder:{UserProfile:0},GetFolderPath:()=>home},IO:{Directory:dir,File:file}}}});
vm.runInContext(fs.readFileSync(new URL('../plugin/main.js',import.meta.url),'utf8'),context);
const tick=()=>{for(const fn of [...callbacks.onUpdate])fn();};
let running=true; const timer=setInterval(tick,5);
try {
    tick();
    const id=context.Bridge.instanceId; assert(id);
    const url=`fgui-file://${id}/`;
    context.CS.UnityEngine.Application.runInBackground=false;
    tick();
    assert.equal(context.CS.UnityEngine.Application.runInBackground,true);
    const queue=path.join(home,'.fgui-agent-bridge','instances',`queue-${id}`);
    const oldResponse=path.join(queue,'responses',`${'c'.repeat(32)}.json`);
    const recentResponse=path.join(queue,'responses',`${'d'.repeat(32)}.json`);
    fs.writeFileSync(oldResponse,'{}'); fs.writeFileSync(recentResponse,'{}');
    const oldTime=new Date(Date.now()-700000); fs.utimesSync(oldResponse,oldTime,oldTime);
    assert.equal((await request(url,'ping',{},1000)).data.runInBackground,true);
    let executions=0;
    context.COMMANDS.count = a => {executions++;return context.ok({value:a.value});};
    const replies=await Promise.all(Array.from({length:30},(_,i)=>request(url,'count',{value:i},5000)));
    assert.deepEqual(replies.map(x=>x.data.value),Array.from({length:30},(_,i)=>i));
    assert.equal(executions,30);
    assert(!fs.existsSync(oldResponse)); assert(fs.existsSync(recentResponse));
    const instances=await discover({fallback:null});
    assert.equal(instances.length,1); assert.equal(instances[0].projectPath,App.project.basePath.replace(/\\/g,'/'));
    // Independent CLI processes must receive only their own responses.
    const cli = fileURLToPath(new URL('../cli/fgui.mjs', import.meta.url));
    const children = Array.from({length:8}, (_,i) => new Promise((resolve,reject) => {
        const child=spawn(process.execPath,[cli,'count',JSON.stringify({project:App.project.basePath,value:i})],
            {env:{...process.env, USERPROFILE:home, HOME:home},windowsHide:true});
        let out='',err=''; child.stdout.on('data',x=>out+=x); child.stderr.on('data',x=>err+=x);
        child.on('error',reject); child.on('close',code=>code===0 ? resolve(JSON.parse(out).data.value) : reject(Error(err)));
    }));
    assert.deepEqual(await Promise.all(children),[0,1,2,3,4,5,6,7]);
    assert.equal(executions,38);
    // A long asynchronous publish must not block discovery; queued edits wait.
    let finish=false;
    context.ASYNC_STARTERS.slow = job => { job.started=true; };
    context.ASYNC_STEPPERS.slow = () => finish ? context.ok({done:true}) : null;
    const slow=request(url,'slow',{},5000);
    await new Promise(resolve=>setTimeout(resolve,100));
    assert(context.Bridge.current && context.Bridge.current.cmd==='slow');
    const queued=request(url,'count',{value:42},5000);
    assert.equal((await request(url,'ping',{},1000)).ok,true);
    assert.equal(executions,38);
    finish=true;
    assert.equal((await slow).data.done,true);
    assert.equal((await queued).data.value,42);
    assert.equal(executions,39);
    // Two editors, even with the same project path, have isolated queues.
    const second=vm.createContext({exports:{},console,CS:context.CS});
    vm.runInContext(fs.readFileSync(new URL('../plugin/main.js',import.meta.url),'utf8'),second);
    tick();
    const both=await discover({fallback:null});
    assert.equal(both.length,2);
    assert.throws(()=>selectInstance(both,{project:App.project.basePath}),/Multiple/);
    const secondUrl=`fgui-file://${second.Bridge.instanceId}/`;
    assert.equal(selectInstance(both,{bridge_url:secondUrl}).url,secondUrl);
    assert.equal((await request(secondUrl,'ping')).ok,true);
    second.exports.onDestroy();
    clearInterval(timer); running=false;
    await assert.rejects(request(url,'count',{value:99},80),/timed out/);
    await assert.rejects(route({project:App.project.basePath}), error =>
        error.code === 'BRIDGE_UNRESPONSIVE' && /registered bridge/.test(error.message));
    tick(); assert.equal(executions,39);
    const staleId='b'.repeat(32);
    fs.writeFileSync(path.join(home,'.fgui-agent-bridge','instances',`queue-${id}`,'requests',`${staleId}.json`),
        JSON.stringify({cmd:'count',args:{value:99},deadlineMs:Date.now()-1}));
    tick(); assert.equal(executions,39);
    context.Bridge.queue.push({cmd:'count',args:{value:99},ctx:{id:staleId},deadlineMs:Date.now()-1});
    tick(); assert.equal(executions,39);
    let detached=false, exited=false;
    context.Bridge.current={cmd:'publish',ctx:{id:'a'.repeat(32)},onComplete(){},handler:{
        remove_onComplete(){detached=true;}, Exit(){assert(detached);exited=true;}
    }};
    for(const fn of [...callbacks.onProjectClosed])fn();
    assert(exited);
    assert.equal(context.Bridge.current,null);
    assert(!fs.existsSync(path.join(home,'.fgui-agent-bridge','instances',`queue-${id}.json`)));
    for(const fn of [...callbacks.onProjectOpened])fn();
    tick(); assert(context.Bridge.instanceId && context.Bridge.instanceId!==id);
    const reopened=context.Bridge.instanceId;
    context.exports.onDestroy();
    assert.equal(callbacks.onUpdate.size,0);
    assert(!fs.existsSync(path.join(home,'.fgui-agent-bridge','instances',`queue-${reopened}.json`)));
    console.log('PASS: concurrent clients, unique responses, expiry, discovery, and lifecycle');
} finally {if(running)clearInterval(timer); context.exports.onDestroy(); fs.rmSync(home,{recursive:true,force:true});}
