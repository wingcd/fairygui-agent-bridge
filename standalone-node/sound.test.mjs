import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import {inspectWav,inspectMp3,inspectOggVorbis} from './sound.mjs';

test('PCM WAV validation reads data and rejects truncated files', () => {
  const wav=Buffer.alloc(48);wav.write('RIFF',0);wav.writeUInt32LE(40,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(4,40);
  assert.deepEqual(inspectWav(wav),{format:'wav-pcm',channels:1,sample_rate:8000,frames:2,sample_width:2});
  assert.throws(()=>inspectWav(wav.subarray(0,46)),/invalid/);
  assert.throws(()=>inspectMp3(Buffer.from('bad')));
});
test('Ogg Vorbis pages and checksums match Python', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-ogg-'));
  try {
    const file=path.join(root,'audio.ogg');
    const generated=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.1','-c:a','libvorbis','-y',file],{encoding:'utf8'});
    if(generated.error?.code==='ENOENT' || generated.status!==0) {t.skip('ffmpeg Vorbis encoder unavailable');return;}
    const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../standalone');
    const python=spawnSync(process.env.PYTHON||'python',['-c','import json,sys\nfrom sound import inspect_ogg_vorbis\nprint(json.dumps(inspect_ogg_vorbis(open(sys.argv[1],"rb").read())))',file],{cwd,encoding:'utf8'});
    assert.equal(python.status,0,python.stderr);
    const bytes=fs.readFileSync(file);
    assert.deepEqual(inspectOggVorbis(bytes),JSON.parse(python.stdout));
    const broken=Buffer.from(bytes);broken[100]^=1;
    assert.throws(()=>inspectOggVorbis(broken),/checksum/);
    assert.throws(()=>inspectOggVorbis(bytes.subarray(0,bytes.length-1)));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('sample MP3 structural metadata matches Python', {skip:!process.env.FGUI_SAMPLE_PROJECT}, () => {
  const file=path.join(process.env.FGUI_SAMPLE_PROJECT,'assets','Transition','images','BUZZ4.mp3'),cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../standalone');
  const run=spawnSync(process.env.PYTHON||'python',['-c','import json,sys\nfrom sound import inspect_mp3\nprint(json.dumps(inspect_mp3(open(sys.argv[1],"rb").read())))',file],{cwd,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  assert.deepEqual(inspectMp3(fs.readFileSync(file)),JSON.parse(run.stdout));
});
