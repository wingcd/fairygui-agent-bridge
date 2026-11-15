import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readBitmapFont} from './bitmap-font.mjs';

test('image glyph font parses and rejects invalid references', () => {
  const result=readBitmapFont(Buffer.from('info size=12 colored=true\nchar id=65 img=abc xoffset=1 yoffset=-2 xadvance=8\n'));
  assert.equal(result.glyphs[0].image,'abc');assert.equal(result.glyphs[0].yOffset,-2);
  assert.throws(()=>readBitmapFont(Buffer.from('info size=12\nchar id=65\n')),/image missing/);
  assert.throws(()=>readBitmapFont(Buffer.from('info size=12\nkernings count=1\n')),/kerning/);
});
test('reference BMFont parsing matches Python', {skip:!process.env.FGUI_SAMPLE_PROJECT}, () => {
  const file=path.join(process.env.FGUI_SAMPLE_PROJECT,'assets','Basics','font','BMFontTest.fnt'),cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../standalone');
  const script='import sys,json\nfrom bitmap_font import read_bitmap_font\nprint(json.dumps(read_bitmap_font(open(sys.argv[1],"rb").read(),"texture")))';
  const run=spawnSync(process.env.PYTHON||'python',['-c',script,file],{cwd,encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  assert.deepEqual(readBitmapFont(fs.readFileSync(file),'texture'),JSON.parse(run.stdout));
});
