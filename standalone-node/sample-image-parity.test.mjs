import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {decodeImage} from './images.mjs';

test('sample image decoding matches Pillow RGBA pixel data', {skip:!process.env.FGUI_SAMPLE_PROJECT,timeout:180000}, async () => {
  const project=process.env.FGUI_SAMPLE_PROJECT;
  const script='import pathlib,json,sys,hashlib\nfrom PIL import Image\nr=[]\nfor f in sorted((pathlib.Path(sys.argv[1])/"assets").rglob("*")):\n if f.suffix.lower() not in (".png",".jpg",".jpeg") or not f.is_file(): continue\n try:\n  with Image.open(f) as i:\n   a=i.convert("RGBA");r.append({"path":str(f),"width":a.width,"height":a.height,"sha256":hashlib.sha256(a.tobytes()).hexdigest()})\n except (OSError,ValueError): pass\nprint(json.dumps(r,ensure_ascii=False))';
  const run=spawnSync(process.env.PYTHON||'python',['-c',script,project],{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'},timeout:150000,maxBuffer:8*1024*1024});
  assert.equal(run.status,0,run.stderr);
  const expected=JSON.parse(run.stdout), mismatches=[];
  for(const item of expected) {
    const actual=await decodeImage(fs.readFileSync(item.path));
    const digest=crypto.createHash('sha256').update(actual.pixels).digest('hex');
    if(actual.width!==item.width || actual.height!==item.height || digest!==item.sha256) mismatches.push(path.relative(project,item.path));
  }
  assert.ok(expected.length>0);
  assert.deepEqual(mismatches,[]);
});
