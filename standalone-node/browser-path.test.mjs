import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {resolveChrome} from './browser-path.mjs';

test('browser selection prefers explicit configuration and detects Windows installs', {skip:process.platform!=='win32'},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fgui-browser-path-'));
 const names=['FGUI_CHROME','PROGRAMFILES','PROGRAMFILES(X86)','LOCALAPPDATA'],previous=Object.fromEntries(names.map(key=>[key,process.env[key]]));
 try{
  for(const key of names)delete process.env[key];process.env.PROGRAMFILES=root;
  const binary=path.join(root,'Google','Chrome','Application','chrome.exe');await fs.mkdir(path.dirname(binary),{recursive:true});await fs.writeFile(binary,'fixture');
  assert.equal(await resolveChrome(),binary);process.env.FGUI_CHROME='';assert.equal(await resolveChrome(),binary);delete process.env.FGUI_CHROME;await assert.rejects(resolveChrome(''),/nonempty browser executable path/);await assert.rejects(resolveChrome('   '),/nonempty browser executable path/);
  process.env.FGUI_CHROME='environment-browser';assert.equal(await resolveChrome(),'environment-browser');assert.equal(await resolveChrome('explicit-browser'),'explicit-browser');
  delete process.env.FGUI_CHROME;await fs.unlink(binary);const edge=path.join(root,'Microsoft','Edge','Application','msedge.exe');await fs.mkdir(path.dirname(edge),{recursive:true});await fs.writeFile(edge,'fixture');assert.equal(await resolveChrome(),edge);await fs.unlink(edge);await assert.rejects(resolveChrome(),/Chrome or Edge was not found/);
 }finally{for(const key of names){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key]}await fs.rm(root,{recursive:true,force:true});}
});
