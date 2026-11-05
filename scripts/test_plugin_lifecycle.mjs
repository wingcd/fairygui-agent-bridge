import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../plugin/main.js', import.meta.url), 'utf8');
const events = {onUpdate: new Set(), onProjectOpened: new Set(), onProjectClosed: new Set()};
const menuItems = new Map();
const listeners = [];
const files = new Map();
let failAccept = false;
const menu = {
    AddItem(label, id, callback) { menuItems.set(id, callback); },
    RemoveItem(id) { menuItems.delete(id); }
};
const App = {project: {name: 'test'}, pluginManager: {basePath: '/test/plugins'},
    menu: {GetSubMenu: () => menu}};
for (const [name, callbacks] of Object.entries(events)) {
    App['add_' + name] = callback => callbacks.add(callback);
    App['remove_' + name] = callback => callbacks.delete(callback);
}
class HttpListener {
    constructor() { this.Prefixes = {Add() {}}; listeners.push(this); }
    Start() { this.started = true; }
    BeginGetContext() {
        if (failAccept) { failAccept = false; throw Error('accept failed'); }
        return {IsCompleted: false};
    }
    Close() { this.closed = true; }
}
function load(project = {}) {
    App.project = project;
    const context = vm.createContext({exports: {}, console: {log() {}}, CS: {
        FairyGUI: {}, FairyEditor: {App}, UnityEngine: {Application: {}}, System: {
            Environment: {SpecialFolder: {UserProfile: 0}, GetFolderPath: () => '/user'},
            IO: {Directory: {CreateDirectory() {}}, File: {
                ReadAllText() { throw Error('no override'); },
                WriteAllText(name, value) { files.set(name, value); },
                Exists: name => files.has(name), Delete: name => files.delete(name)
            }}, Net: {HttpListener}
        }
    }});
    vm.runInContext(source, context);
    return context;
}
function tick() { for (const callback of [...events.onUpdate]) callback(); }
function emit(name) { for (const callback of [...events[name]]) callback(); }
function assertReleased(plugin) {
    for (const callbacks of Object.values(events)) assert.equal(callbacks.size, 0);
    assert.equal(menuItems.size, 0);
    assert.equal(plugin.Bridge.listener, null);
    assert.equal(plugin.Bridge.pendingAccept, null);
    assert.equal(plugin.Bridge.current, null);
    assert.equal(plugin.Bridge.queue.length, 0);
    assert.equal([...files.keys()].filter(name => name.endsWith('/7531.json')).length, 0);
}

// Repeated project switches must not leave delegates into destroyed JS contexts.
for (let i = 0; i < 5; i++) {
    const plugin = load();
    tick();
    assert.equal(plugin.Bridge.port, 7531);
    const listener = listeners.at(-1);
    plugin.exports.onDestroy();
    plugin.exports.onDestroy();
    assertReleased(plugin);
    assert(listener.closed);
    plugin.onUpdate();
    assert.equal(plugin.Bridge.listener, null);
}

// Close during publish: detach callback before Exit (which may complete inline).
const plugin = load(null);
tick();
assert.equal(plugin.Bridge.listener, null);
App.project = {};
emit('onProjectOpened');
tick();
let detached = false;
let exited = false;
const responseStatuses = [];
plugin.writeResponse = (ctx, status) => responseStatuses.push(status);
plugin.Bridge.current = {onComplete() {}, handler: {
    remove_onComplete() { detached = true; },
    Exit() { assert(detached); exited = true; }
}};
plugin.Bridge.queue.push({ctx: {}});
emit('onProjectClosed');
assert(exited);
assert.deepEqual(responseStatuses, [503, 503]);
assert(listeners.at(-1).closed);
assert.equal(plugin.Bridge.wantServer, false);
emit('onProjectOpened');
tick();
const count = listeners.length;
plugin.startServer();
assert.equal(listeners.length, count);
plugin.exports.onDestroy();
assertReleased(plugin);

// Health checks must bypass a running asynchronous publish and its queue.
const healthPlugin = load({name: 'test', allPackages: {Count: 0, get_Item() {}}});
tick();
const replies = [];
healthPlugin.readBody = ctx => JSON.stringify({cmd: ctx.cmd});
healthPlugin.writeResponse = (ctx, status, body) => replies.push({cmd: ctx.cmd, status, body});
healthPlugin.Bridge.current = {cmd: 'publish'};
healthPlugin.handleRequest({Request: {HttpMethod: 'POST'}, cmd: 'ping'});
healthPlugin.handleRequest({Request: {HttpMethod: 'POST'}, cmd: 'project_info'});
assert.equal(replies.length, 2);
assert(replies.every(reply => reply.body.ok));
assert.equal(healthPlugin.Bridge.queue.length, 0);
healthPlugin.Bridge.current = null;
healthPlugin.exports.onDestroy();
assertReleased(healthPlugin);

// A listener that starts but fails to arm must also be closed before retrying.
failAccept = true;
const retryPlugin = load();
tick();
assert(listeners.at(-2).closed);
assert.equal(retryPlugin.Bridge.port, 7532);
retryPlugin.exports.onDestroy();
assertReleased(retryPlugin);
assert(listeners.every(listener => listener.closed));
console.log('Plugin lifecycle tests passed');
