import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readJta} from './jta.mjs';

test('sample JTA metadata and frame pixels match Python', {skip:!process.env.FGUI_SAMPLE_PROJECT}, async () => {
  const file=path.join(process.env.FGUI_SAMPLE_PROJECT,'assets','Bag','images','quan.jta'),cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../standalone');
  const script='import json,sys,hashlib\nfrom jta import read_jta\na=read_jta(open(sys.argv[1],"rb").read())\na["images"]=[{"width":i.width,"height":i.height,"sha256":hashlib.sha256(i.tobytes()).hexdigest()} for i in a["images"]]\nprint(json.dumps(a,ensure_ascii=False))';
  const run=spawnSync(process.env.PYTHON||'python',['-c',script,file],{cwd,encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}});
  assert.equal(run.status,0,run.stderr);
  const bytes=fs.readFileSync(file),actual=await readJta(bytes);
  actual.images=actual.images.map(i=>({width:i.width,height:i.height,sha256:crypto.createHash('sha256').update(i.pixels).digest('hex')}));
  assert.deepEqual(actual,JSON.parse(run.stdout));
  await assert.rejects(readJta(bytes.subarray(0,20)));
  await assert.rejects(readJta(Buffer.concat([bytes,Buffer.from([0])])),/trailing/);
});
