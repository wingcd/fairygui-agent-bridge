import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, decodeImage } from './images.mjs';
import { atlasLayout, atlasExport } from './atlas-project.mjs';
import { message } from './mcp.mjs';

test('atlas_layout on project files matches Python and is callable through MCP', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'fgui-atlas-node-'));
  try {
    const folder = path.join(root,'assets','Demo'); fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(root,'demo.fairy'),'<projectDescription/>');
    fs.writeFileSync(path.join(folder,'package.xml'),'<packageDescription id="abcdefgh"><resources><image id="a" name="a.png" path="/"/><image id="b" name="b.png" path="/"/></resources></packageDescription>');
    for (const [name,width,height] of [['a',3,4],['b',7,2]]) fs.writeFileSync(path.join(folder,name+'.png'),await encodePng({width,height,pixels:Buffer.alloc(width*height*4,127)}));
    const args = {project:root,pkg:'Demo',width:16,height:16,padding:1,shrink_atlas:true,rotate_images:true};
    const cwd = resolve(dirname(fileURLToPath(import.meta.url)),'../standalone');
    const script = 'import sys,json\nfrom fgui import execute\nprint(json.dumps(execute("atlas_layout",json.load(sys.stdin))))';
    const run = spawnSync(process.env.PYTHON || 'python',['-c',script],{cwd,input:JSON.stringify(args),encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    const expected = JSON.parse(run.stdout);
    assert.deepEqual(await atlasLayout(args),expected);
    const result = await message({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'atlas_layout',arguments:args}});
    assert.deepEqual(JSON.parse(result.result.content[0].text).data,expected);
    if (process.platform === 'win32') {
      const output = path.join(root,'atlas-out');
      const exported = await atlasExport({...args,output});
      assert.equal(exported.image_count,2);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output,'manifest.json'),'utf8')).pages,exported.pages);
      const atlas = await decodeImage(fs.readFileSync(path.join(output,'atlas_0.png')));
      for (const item of exported.pages[0].items) {
        const i = (item.y * atlas.width + item.x) * 4;
        assert.deepEqual([...atlas.pixels.subarray(i,i+4)],[127,127,127,127]);
      }
      await assert.rejects(atlasExport({...args,output}),/already exist/);
    }
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
