import fs from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

// Windows scanners may temporarily hold a generated directory open. Revalidate
// inputs and the absent destination before each bounded retry.
export async function commitDirectory(stage,output,validate,{rename=fs.rename,platform=process.platform,sleep=delay}={}) {
  for(let attempt=0;;attempt++) {
    await validate();
    try { await fs.lstat(output); throw new Error('output directory must not already exist'); }
    catch(error) { if(error.code!=='ENOENT') throw error; }
    try { await rename(stage,output); return; }
    catch(error) {
      if(platform!=='win32'||!['EPERM','EBUSY'].includes(error.code)||attempt>=12) throw error;
      await sleep(Math.min(100,20*(2**attempt)));
    }
  }
}
