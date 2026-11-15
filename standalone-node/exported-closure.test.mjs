import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {parse} from './project.mjs';
import {exportedClosure} from './exported-closure.mjs';

test('exported closure handles many resources and preserves ambiguous name rejection',async()=>{
 const n=2000,folder=path.resolve('closure-fixture'),xml='<packageDescription id="abcdefgh"><resources>'+Array.from({length:n},(_,i)=>`<image id="i${i}" name="image${i}.png" path="/" exported="true"/>`).join('')+'</resources></packageDescription>',pkg={folder,tree:parse(Buffer.from(xml),'package')};const result=await exportedClosure([pkg],()=>{throw new Error('unexpected read');});assert.equal(result.get(folder).size,n);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-closure-'));try{const duplicate='<packageDescription id="abcdefgh"><resources><component id="c" name="Main.xml" path="/" exported="true"/><image id="a" name="same.png" path="/"/><image id="b" name="same.jpg" path="/"/></resources></packageDescription>',ambiguous={folder:temp,tree:parse(Buffer.from(duplicate),'package')};fs.writeFileSync(path.join(temp,'Main.xml'),'fixture');await assert.rejects(exportedClosure([ambiguous],async()=>Buffer.from(`<component size="1,1"><displayList><loader id="l" xy="0,0" url="ui://${path.basename(temp)}/same"/></displayList></component>`)),/unknown or ambiguous UI URL/);}finally{fs.rmSync(temp,{recursive:true,force:true});}
});


test('preview closure selects only transitive external dependencies and enforces exports',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fgui-closure-external-'));try{
 const make=(name,id,resources)=>{const folder=path.join(root,name);fs.mkdirSync(folder);return {folder,tree:parse(Buffer.from('<packageDescription id="'+id+'"><resources>'+resources+'</resources></packageDescription>'),'package')};};
 const main=make('Main','aaaaaaaa','<component id="root" name="Root.xml" path="/"/>');
 const shared=make('Shared','bbbbbbbb','<component id="public" name="Public.xml" path="/" exported="true"/><image id="img" name="Img.png" path="/"/><image id="private" name="Private.png" path="/"/><swf id="unused" name="Unused.swf" path="/" exported="true"/>');
 const more=make('More','cccccccc','<component id="next" name="Next.xml" path="/" exported="true"/>');
 fs.writeFileSync(path.join(main.folder,'Root.xml'),'<component size="20,20"><displayList><component id="a" xy="0,0" pkg="Shared" src="public"/><image id="b" xy="0,0" pkg="bbbbbbbb" src="img"/></displayList></component>');
 fs.writeFileSync(path.join(shared.folder,'Public.xml'),'<component size="20,20"><displayList><image id="a" xy="0,0" src="img"/><component id="b" xy="0,0" pkg="cccccccc" src="next"/></displayList></component>');
 fs.writeFileSync(path.join(more.folder,'Next.xml'),'<component size="20,20"><displayList/></component>');
 const packages=[main,shared,more],read=file=>fs.promises.readFile(file),options={roots:new Set([main.folder]),extraRoots:new Map([[main.folder,['root']]]),onlyExtraRoots:true};const closure=await exportedClosure(packages,read,options);assert.deepEqual([...closure.get(main.folder)],['root']);assert.deepEqual(new Set(closure.get(shared.folder)),new Set(['public','img']));assert.deepEqual([...closure.get(more.folder)],['next']);
 fs.writeFileSync(path.join(main.folder,'Root.xml'),'<component size="20,20"><displayList><image id="b" xy="0,0" pkg="bbbbbbbb" src="private"/></displayList></component>');await assert.rejects(exportedClosure(packages,read,options),/external resource private is not included/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
