import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {discover, selectInstance, request, stripSelector, normalizeProject} from '../cli/instances.mjs';

const observed = [];
const servers = [];
async function editor(project, projectPath) {
    const server = http.createServer(async (req, res) => {
        let body = ''; for await (const part of req) body += part;
        const a = JSON.parse(body); observed.push({project, ...a});
        const data = a.cmd === 'project_info' ? {name: project, projectPath, packageNames: ['Common']}
            : {project, projectPath, projectOpen: true, port: server.address().port};
        res.end(JSON.stringify({ok: true, data}));
    });
    await new Promise(resolve => server.listen(0, 'localhost', resolve));
    servers.push(server); return {port: server.address().port};
}
try {
    const entries = await Promise.all([editor('ui', '/games/a/ui'), editor('ui', '/games/b/ui')]);
    const instances = await discover({entries, fallback: null});
    assert.equal(instances.length, 2);
    assert.throws(() => selectInstance(instances), /Multiple/);
    assert.throws(() => selectInstance(instances, {project: 'ui'}), /Multiple/);
    const b = selectInstance(instances, {project: '/games/b/ui/Game.fairy'});
    assert.equal(b.port, entries[1].port);
    assert.equal(selectInstance(instances, {port: entries[0].port}).projectPath, '/games/a/ui');
    assert.throws(() => selectInstance(instances, {project: '/games/missing'}), /not online/);
    assert.throws(() => selectInstance(instances, {project: '/games/a/ui', port: entries[1].port}), /not online/);
    await request(b.url, 'publish', stripSelector({project: '/games/b/ui', pkg: 'Common'}));
    assert.deepEqual(observed.at(-1), {project: 'ui', cmd: 'publish', args: {pkg: 'Common'}});
    assert.equal(normalizeProject('/games/a/ui/Game.fairy'), normalizeProject('/games/a/ui/'));
    await assert.rejects(request('http://example.com/', 'ping'), /localhost/);
    // Exercise the real stdio MCP process with an isolated registry.
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'fgui-routing-test-'));
    const registry = path.join(fixture, '.fgui-agent-bridge'); fs.mkdirSync(registry);
    fs.writeFileSync(path.join(registry, 'registry.json'), JSON.stringify(entries));
    const child = spawn(process.execPath, [fileURLToPath(new URL('../mcp/server.mjs', import.meta.url))],
        {env: {...process.env, USERPROFILE: fixture, HOME: fixture, FGUI_BRIDGE_URL: `http://localhost:${entries[0].port}/`}, stdio: ['pipe','pipe','pipe'], windowsHide: true});
    let pending = '', seq = 0; const replies = new Map();
    child.stdout.on('data', chunk => {
        pending += chunk; let end;
        while ((end = pending.indexOf('\n')) >= 0) {
            const message = JSON.parse(pending.slice(0,end)); pending = pending.slice(end+1);
            const callback = replies.get(message.id); if (callback) callback(message);
        }
    });
    const rpc = (method, params) => new Promise((resolve,reject) => {
        const id = ++seq; const timer=setTimeout(()=>reject(new Error('MCP test timeout')),15000);
        replies.set(id, value => {clearTimeout(timer); replies.delete(id); resolve(value);});
        child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
    });
    try {
        const list=await rpc('tools/list');
        assert(list.result.tools.find(t=>t.name==='discover_projects'));
        assert(list.result.tools.find(t=>t.name==='publish').inputSchema.properties.project);
        const selected=await rpc('tools/call',{name:'publish',arguments:{project:'/games/b/ui',pkg:'Common'}});
        assert.equal(selected.result.isError,false);
        const missing=await rpc('tools/call',{name:'publish',arguments:{project:'/games/missing',pkg:'Common'}});
        assert.equal(missing.result.isError,true);
        assert.match(missing.result.content[0].text,/not online/);
        console.log('PASS: real MCP process exposes discovery/selectors and routes B while default URL points at A');
    } finally {child.stdin.end(); await new Promise(resolve=>child.on('exit',resolve));}
    console.log('PASS: simultaneous projects, duplicate names, path/port targeting, no cross-project fallback, selector stripping');
} finally {
    await Promise.all(servers.map(s => new Promise(resolve => s.close(resolve))));
}
