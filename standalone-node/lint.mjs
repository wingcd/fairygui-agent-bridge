import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {projectRoot} from './project.mjs';
const run=promisify(execFile),script=fileURLToPath(new URL('../scripts/lint_components.mjs',import.meta.url));
export async function lint(args){
 const root=projectRoot(args.project);try{const result=await run(process.execPath,[script,root],{encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024,windowsHide:true});return {valid:true,report:result.stdout,stderr:result.stderr};}
 catch(error){if(error.killed||error.code==='ETIMEDOUT')throw new Error('lint timed out after 120 seconds');if(error.code===1)return {valid:false,report:error.stdout,stderr:error.stderr};throw new Error(`lint failed (${error.code}): ${error.stderr||error.stdout||error.message}`);}
}
