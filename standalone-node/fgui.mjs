#!/usr/bin/env node
import fs from 'node:fs';
import {message} from './mcp.mjs';

try {
  const [command, raw] = process.argv.slice(2);
  if (!command || !raw) throw new Error('usage: node fgui.mjs COMMAND JSON_OR_@FILE');
  const args = JSON.parse(raw.startsWith('@') ? fs.readFileSync(raw.slice(1),'utf8') : raw);
  const response = await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:command,arguments:args}});
  if (response.error) throw new Error(response.error.message);
  const result = JSON.parse(response.result.content[0].text);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  process.stdout.write(JSON.stringify({ok:false,error:error.message}) + '\n');
  process.exitCode = 1;
}
