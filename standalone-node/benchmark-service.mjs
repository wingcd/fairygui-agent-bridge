#!/usr/bin/env node
// Read-only throughput measurement on one loopback service. Pass one or more
// project directories; figures depend on disk cache and machine load.
import {performance} from 'node:perf_hooks';
import path from 'node:path';
import {createServer} from './http-server.mjs';
import {projectRoot} from './project.mjs';
const argv=process.argv.slice(2),toolArg=argv.find(value=>value.startsWith('--tool=')),tool=toolArg?.slice(7)??'list_packages';
if(!['list_packages','project_info'].includes(tool))throw new Error('tool must be list_packages or project_info');
const projects=argv.filter(value=>value!==toolArg).map(value=>{projectRoot(value);return path.resolve(value);});
if(!projects.length)throw new Error('usage: node benchmark-service.mjs PROJECT [PROJECT ...]');
const requests=100,workers=4,server=createServer(),latencies=[];let next=0;
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const endpoint=`http://127.0.0.1:${server.address().port}/rpc`,start=performance.now();
try {
 await Promise.all(Array.from({length:workers},async()=>{while(true){const i=next++;if(i>=requests)return;const began=performance.now();const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:i,method:'tools/call',params:{name:tool,arguments:{project:projects[i%projects.length]}}})});const result=await response.json();if(!response.ok||result.error||!JSON.parse(result.result.content[0].text).ok)throw new Error('benchmark request failed');latencies.push(performance.now()-began);}}));
 const elapsed=(performance.now()-start)/1000;latencies.sort((a,b)=>a-b);const percentile=p=>latencies[Math.ceil(latencies.length*p)-1];console.log(JSON.stringify({projects:projects.length,requests,workers,elapsed_seconds:elapsed,requests_per_second:requests/elapsed,latency_ms:{p50:percentile(.5),p95:percentile(.95),max:latencies.at(-1)},scope:`read-only ${tool}; filesystem cache and machine load affect results`}));
} finally {await new Promise(resolve=>server.close(resolve));}
