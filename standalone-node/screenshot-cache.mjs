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
  const unchanged=(a,b)=>a.isFile()&&b.isFile()&&!b.isSymbolicLink()&&a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
 if(stat.isDirectory()) {for(const name of (await fs.readdir(file)).sort())await visit(path.join(file,name),relative+'/'+name);}
  else if(stat.isFile()) {
   // Avoid buffering a large asset or browser executable in memory for every
   // cache lookup. Small files stay on the lower-overhead readFile path.
   if(stat.size<=1024*1024){const bytes=await fs.readFile(file),after=await fs.lstat(file);if(bytes.length!==stat.size||!unchanged(stat,after))throw new Error('screenshot cache input changed while hashing');hash.update(String(bytes.length)+':');hash.update(bytes);}
   else {
    const handle=await fs.open(file,'r');try{
     const before=await handle.stat();if(!before.isFile()||before.dev!==stat.dev||before.ino!==stat.ino||before.size!==stat.size)throw new Error('screenshot cache input changed while hashing');
     hash.update(String(before.size)+':');let length=0;
     for await(const chunk of handle.createReadStream({autoClose:false})){length+=chunk.length;hash.update(chunk);}
     const after=await handle.stat(),pathAfter=await fs.lstat(file);if(length!==before.size||!unchanged(before,after)||!unchanged(after,pathAfter))throw new Error('screenshot cache input changed while hashing');
    }finally{await handle.close();}
   }
  }
  else throw new Error('screenshot caching supports regular files only');
 }
 for(const [label,file,optional] of entries){
  if(optional){try{await fs.lstat(file)}catch(error){if(error.code==='ENOENT'){hash.update(JSON.stringify([label,'missing']));continue}throw error}}
  await visit(file,label);
 }
 return hash.digest('hex');
}
