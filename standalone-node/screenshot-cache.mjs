import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

// Digest bytes rather than mtime: editors and asset tools may preserve timestamps.
export async function digestInputs(entries,options) {
 const hash=crypto.createHash('sha256');
 hash.update(JSON.stringify(options));
 const canonical=value=>process.platform==='win32'?value.toLowerCase():value;
 async function visit(file,relative,ancestors=new Set()) {
  const stat=await fs.lstat(file);
  if(stat.isSymbolicLink()){
   const target=await fs.realpath(file);hash.update(JSON.stringify([relative,'link',target]));
   await visit(target,relative+'/[link]',ancestors);
   const after=await fs.lstat(file),resolved=await fs.realpath(file);if(!after.isSymbolicLink()||after.dev!==stat.dev||after.ino!==stat.ino||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs||resolved!==target)throw new Error('screenshot cache link changed while hashing');
   return;
  }
  hash.update(JSON.stringify([relative,stat.isDirectory()?'directory':'file']));
  const unchanged=(a,b)=>a.isFile()&&b.isFile()&&!b.isSymbolicLink()&&a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
  if(stat.isDirectory()) {
   const real=canonical(await fs.realpath(file));if(ancestors.has(real))throw new Error('cyclic screenshot cache directory link');const next=new Set(ancestors);next.add(real);
   const names=(await fs.readdir(file)).sort();for(const name of names)await visit(path.join(file,name),relative+'/'+name,next);
   // A newly added or removed dependency must not produce the same key as an
   // older directory snapshot. Check both identity and entries after traversal.
   const after=await fs.lstat(file),current=(await fs.readdir(file)).sort();
   if(!after.isDirectory()||after.isSymbolicLink()||after.dev!==stat.dev||after.ino!==stat.ino||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs||names.length!==current.length||names.some((name,index)=>name!==current[index]))throw new Error('screenshot cache directory changed while hashing');
  }
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
