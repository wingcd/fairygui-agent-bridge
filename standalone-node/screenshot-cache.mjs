import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

// Digest bytes rather than mtime: editors and asset tools may preserve timestamps.
export async function digestInputs(entries,options) {
 const hash=crypto.createHash('sha256');
 hash.update(JSON.stringify(options));
 async function visit(file,relative) {
  const stat=await fs.lstat(file);if(stat.isSymbolicLink())throw new Error('screenshot caching does not support symbolic links');
  hash.update(JSON.stringify([relative,stat.isDirectory()?'directory':'file']));
  if(stat.isDirectory()) {for(const name of (await fs.readdir(file)).sort())await visit(path.join(file,name),relative+'/'+name);}
  else if(stat.isFile()) {const bytes=await fs.readFile(file);hash.update(String(bytes.length)+':');hash.update(bytes);}
  else throw new Error('screenshot caching supports regular files only');
 }
 for(const [label,file,optional] of entries){
  if(optional){try{await fs.lstat(file)}catch(error){if(error.code==='ENOENT'){hash.update(JSON.stringify([label,'missing']));continue}throw error}}
  await visit(file,label);
 }
 return hash.digest('hex');
}
