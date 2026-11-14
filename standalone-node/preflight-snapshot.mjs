import fs from 'node:fs/promises';
import crypto from 'node:crypto';

// Detect changes between package checks, including creation of an optional file.
export function preflightSnapshot(){
 const files=new Map();
 const digest=data=>data===null?null:crypto.createHash('sha256').update(data).digest('hex');
 function record(file,data){const value=digest(data);if(files.has(file)&&files.get(file)!==value)throw new Error(`project changed during preflight: ${file}`);files.set(file,value);return value;}
 async function read(file,optional=false){
  let data;try{data=await fs.readFile(file);}catch(error){if(!optional||error.code!=='ENOENT')throw error;data=null;}
  record(file,data);return data;
 }
 async function verify(){for(const [file,expected] of files){let data;try{data=await fs.readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;data=null;}if(digest(data)!==expected)throw new Error(`project changed during preflight: ${file}`);}}
 return {read,record,verify};
}
