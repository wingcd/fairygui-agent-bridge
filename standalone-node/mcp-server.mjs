import readline from 'node:readline';
import { message } from './mcp.mjs';

const input = readline.createInterface({input:process.stdin,crlfDelay:Infinity});
for await (const line of input) {
  let response;
  try { response = await message(JSON.parse(line)); }
  catch { response = {jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}; }
  if (response) process.stdout.write(JSON.stringify(response) + '\n');
}
