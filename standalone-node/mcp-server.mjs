import readline from 'node:readline';
import { message } from './mcp.mjs';

const input = readline.createInterface({input:process.stdin,crlfDelay:Infinity});
const pending=new Set();
for await (const line of input) {
  // JSON-RPC correlates responses by ID; a long render must not block reads
  // or operations on other projects on the same stdio connection.
  const task=(async()=>{
    let request;
    try { request=JSON.parse(line); }
    catch { process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}})+'\n'); return; }
    let response;
    try { response=await message(request); }
    catch(error) { response={jsonrpc:'2.0',id:request?.id??null,error:{code:-32603,message:'Internal error'}}; }
    if(response)process.stdout.write(JSON.stringify(response)+'\n');
  })();
  pending.add(task);task.finally(()=>pending.delete(task));
}
await Promise.allSettled(pending);
