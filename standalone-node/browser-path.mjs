import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Explicit arguments and environment configuration always take precedence.
export async function resolveChrome(explicit) {
 const configured=explicit??process.env.FGUI_CHROME;
 if(configured)return configured;
 const candidates=process.platform==='win32'?
  [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean).map(root=>path.join(root,'Google','Chrome','Application','chrome.exe')):
  process.platform==='darwin'?['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',path.join(os.homedir(),'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')]:
  ['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'];
 for(const candidate of candidates)try{if((await fs.stat(candidate)).isFile())return candidate;}catch(error){if(!['ENOENT','ENOTDIR','EACCES'].includes(error.code))throw error;}
 throw new Error('Chrome was not found; provide chrome or set FGUI_CHROME');
}
