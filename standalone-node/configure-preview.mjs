import fs from 'node:fs/promises';
import path from 'node:path';

// Configure only the disposable Cocos project copy used for a screenshot.
export async function configurePreviewResolution(demo,width,height){
 const file=path.join(demo,'settings','v2','packages','project.json');let settings;
 try{settings=JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;settings={};}
 if(!settings||typeof settings!=='object'||Array.isArray(settings))throw new Error('invalid Cocos project settings');
 settings.general??={};if(typeof settings.general!=='object'||Array.isArray(settings.general))throw new Error('invalid Cocos general settings');
 const resolution=settings.general.designResolution;if(resolution!==undefined&&resolution!==null&&(typeof resolution!=='object'||Array.isArray(resolution)))throw new Error('invalid Cocos design resolution');
 settings.general.designResolution={...(resolution??{}),width,height,fitWidth:false,fitHeight:true};
 await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(settings,null,2));
}
