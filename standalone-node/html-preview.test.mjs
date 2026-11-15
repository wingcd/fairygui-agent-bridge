import {test} from 'node:test';import assert from 'node:assert/strict';import {previewHtmlToUbb} from './html-preview.mjs';import {parsePreviewUbb} from './ubb-preview.mjs';
test('HTML preview converts supported nested text and inline images',()=>{const value=previewHtmlToUbb('<font color="#ff0000"><b>Red</b></font><br><img src="ui://abcdefghimg"><a href="event:x">link</a>');assert.equal(value,'[color=#ff0000][b]Red[/b][/color]\n[img]ui://abcdefghimg[/img][url=event:x]link[/url]');assert.equal(parsePreviewUbb(value).length,4);});
test('HTML preview rejects unsupported tags and external images',()=>{for(const value of ['<script>x</script>','<img src="https://example.com/x">','<span style="color:red">x</span>'])assert.throws(()=>previewHtmlToUbb(value));});

test('HTML preview accepts Cocos color and size tags',()=>{assert.equal(previewHtmlToUbb('<color=#ff0000>red <size=30>big</size></color>'),'[color=#ff0000]red [size=30]big[/size][/color]');});

test('HTML text brackets remain literal',()=>{const runs=parsePreviewUbb(previewHtmlToUbb('<b>[literal]</b>'));assert.equal(runs.map(run=>run.text).join(''),'[literal]');assert.ok(runs.every(run=>run.style.bold));});

test('HTML preview retains font faces',()=>{assert.equal(previewHtmlToUbb('<font face=Arial>text</font>'),'[font=Arial]text[/font]');});

test('HTML preview rejects implicit closure and misnested tags',()=>{for(const value of ['<b>unclosed','<b><i>wrong</b></i>'])assert.throws(()=>previewHtmlToUbb(value));});
