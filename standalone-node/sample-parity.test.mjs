import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute } from './project.mjs';

test('sample project read operations match Python', {skip:!process.env.FGUI_SAMPLE_PROJECT}, () => {
  const project = process.env.FGUI_SAMPLE_PROJECT;
  const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../standalone');
  const code = `import json,sys\nfrom fgui import execute\np=sys.argv[1]\na={'project':p}\nr={}\nfor pkg in execute('list_packages',a):\n name=pkg['name']; r[name]={}\n for item in execute('list_items',{**a,'pkg':name}):\n  if item['type']=='component':\n   x={**a,'pkg':name,'name':item['id']}\n   r[name][item['id']]={k:execute(k,x) for k in ('read_component','list_children','list_controllers')}\nprint(json.dumps(r,ensure_ascii=False))`;
  const run = spawnSync(process.env.PYTHON || 'python',['-c',code,project],{cwd:directory,encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'},maxBuffer:64*1024*1024,timeout:180000});
  assert.equal(run.status,0,run.stderr);
  const expected = JSON.parse(run.stdout); let count = 0;
  for (const [pkg, items] of Object.entries(expected)) for (const [name, operations] of Object.entries(items)) {
    for (const [operation, value] of Object.entries(operations)) assert.deepEqual(execute(operation,{project,pkg,name}),value,`${pkg}/${name} ${operation}`);
    count++;
  }
  assert.ok(count > 0);
});
