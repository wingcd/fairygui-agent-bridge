import {test} from 'node:test';import assert from 'node:assert/strict';import {parsePreviewUbb} from './ubb-preview.mjs';
test('UBB parser retains nested styles, links, images and line breaks',()=>{
 const runs=parsePreviewUbb('A[color=#ff3300][b]B[/b]C[/color]\n[img]ui://abcdefghimg[/img][url=event:x]link[/url]');
 assert.deepEqual(runs,[{type:'text',text:'A',style:{}},{type:'text',text:'B',style:{color:'#ff3300',bold:true}},{type:'text',text:'C',style:{color:'#ff3300'}},{type:'text',text:'\n',style:{}},{type:'image',url:'ui://abcdefghimg',style:{}},{type:'text',text:'link',style:{link:'event:x',underline:true}}]);
});
test('UBB parser rejects mismatched, unsupported and unsafe markup',()=>{
 for(const text of ['[b]x[/i]','[img]https://example.com/x[/img]','[size=9999]x[/size]','[color=red]x[/color]','[b]unfinished','[foo]x[/foo]'])assert.throws(()=>parsePreviewUbb(text));
});

test('UBB parser preserves escaped literal opening brackets',()=>{assert.deepEqual(parsePreviewUbb(String.raw`A \[literal] [b]bold[/b]`),[{type:'text',text:'A [',style:{}},{type:'text',text:'literal] ',style:{}},{type:'text',text:'bold',style:{bold:true}}]);});

test('UBB parser retains font faces',()=>{assert.deepEqual(parsePreviewUbb('[font=Arial]text[/font]'),[{type:'text',text:'text',style:{font:'Arial'}}]);assert.throws(()=>parsePreviewUbb('[font=ui://abcdefghfont]x[/font]'));});
