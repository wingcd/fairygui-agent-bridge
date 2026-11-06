#!/usr/bin/env node
// fgui-agent-bridge CLI - zero-dependency client for the editor plugin.
//
// Usage:
//   node cli/fgui.mjs <command> ['{"json":"args"}']
//   node cli/fgui.mjs ping
//   node cli/fgui.mjs list-packages
//   node cli/fgui.mjs list-items '{"pkg":"common"}'
//   node cli/fgui.mjs create-component '{"pkg":"common","name":"Demo","width":400,"height":300}'
//   node cli/fgui.mjs publish '{"pkg":"common","out_path":"C:/tmp/out"}'
//
// Env:
//   FGUI_BRIDGE_URL   default http://localhost:7531/

import process from "node:process";
import { discover, route, request, stripSelector, registryDir, commandTimeout } from './instances.mjs';

const BASE = process.env.FGUI_BRIDGE_URL || "http://localhost:7531/";

const [cmd, ...rest] = process.argv.slice(2);

// discover: list all running bridge instances across projects (no editor needed)
if (cmd === "discover") {
    console.log(JSON.stringify({ok: true, instances: await discover()}, null, 2));
    process.exit(0);
}

// sync-plugins: the editor loads plugins per project (there is no global
// plugin dir), so this keeps ONE source of truth in <repo>/plugin and fans
// it out to every project in ~/.fgui-agent-bridge/projects.json.
// usage: fgui sync-plugins                       update all listed projects
//        fgui sync-plugins '{"add":"D:/work/my-ui"}'     start managing a project
//        fgui sync-plugins '{"remove":"D:/work/my-ui"}'  stop managing it
if (cmd === "sync-plugins" || cmd === "install-all") {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const a = rest.length ? JSON.parse(rest.join(" ")) : {};
    const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "plugin");
    const srcMain = path.join(srcDir, "main.js");
    const srcPkg = path.join(srcDir, "package.json");
    if (!fs.existsSync(srcMain) || !fs.existsSync(srcPkg)) {
        console.error(JSON.stringify({ok: false, error: `plugin sources not found next to the CLI: ${srcDir}`}, null, 2));
        process.exit(4);
    }
    const listFile = path.join(registryDir, "projects.json");
    const normalize = (p) => {
        let v = path.resolve(String(p)).replace(/\\/g, '/').replace(/\/$/, '');
        if (/\.fairy$/i.test(v)) v = v.slice(0, v.lastIndexOf('/'));
        return process.platform === 'win32' ? v.toLowerCase() : v;
    };
    let list = [];
    try { list = JSON.parse(fs.readFileSync(listFile, 'utf8')); } catch {}
    if (!Array.isArray(list)) list = [];
    const normalized = list.map(p => ({store: p, key: normalize(p)}));
    if (a.add) {
        const key = normalize(a.add);
        if (!normalized.some(e => e.key === key)) {
            let store = path.resolve(String(a.add)).replace(/\\/g, '/').replace(/\/$/, '').replace(/\.fairy$/i, '');
            normalized.push({store, key});
        }
    }
    if (a.remove) {
        const key = normalize(a.remove);
        for (let i = normalized.length - 1; i >= 0; i--) if (normalized[i].key === key) normalized.splice(i, 1);
    }
    list = normalized.map(e => e.store);
    try { fs.mkdirSync(registryDir, {recursive: true}); fs.writeFileSync(listFile, JSON.stringify(list, null, 2)); } catch (e) {
        console.error(JSON.stringify({ok: false, error: `cannot write ${listFile}: ${e.message}`}, null, 2));
        process.exit(4);
    }
    const versionOf = (file) => {
        try { return (fs.readFileSync(file, 'utf8').match(/var VERSION = "([^"]+)"/) || [])[1] || '?'; } catch { return null; }
    };
    const newVersion = versionOf(srcMain);
    const results = [];
    for (const proj of list) {
        const dst = path.join(proj, 'plugins', 'agent-bridge');
        const dstMain = path.join(dst, 'main.js');
        const dstPkg = path.join(dst, 'package.json');
        const old = versionOf(dstMain);
        try {
            if (!fs.existsSync(proj)) throw new Error('project directory not found');
            fs.mkdirSync(dst, {recursive: true});
            let changed = false;
            for (const [src, dstd] of [[srcMain, dstMain], [srcPkg, dstPkg]]) {
                const content = fs.readFileSync(src);
                if (!fs.existsSync(dstd) || !fs.readFileSync(dstd).equals(content)) {
                    fs.writeFileSync(dstd, content);
                    changed = true;
                }
            }
            results.push({project: proj, from: old ?? 'none', to: newVersion, status: changed ? 'updated' : 'current'});
        } catch (e) {
            results.push({project: proj, from: old ?? 'none', to: newVersion, status: `error: ${e.message}`});
        }
    }
    const online = await discover().then(r => r.map(i => i.projectPath?.toLowerCase())).catch(() => []);
    console.log(JSON.stringify({ok: true, listFile, pluginVersion: newVersion,
        note: online.length ? 'online projects need an editor restart to load the new plugin' : undefined,
        results}, null, 2));
    process.exit(results.some(r => r.status.startsWith('error')) ? 6 : 0);
}

// lint: run the STANDARDS.md static checker locally (scripts/lint_components.mjs).
// No editor needed - pure file audit of the project on disk.
// usage: fgui lint '{"project":"D:/work/my-ui"}'
if (cmd === "lint") {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const { spawn } = await import("node:child_process");
    const a = rest.length ? JSON.parse(rest.join(" ")) : {};
    if (!a.project) {
        console.error(JSON.stringify({ ok: false, error: 'args.project is required (project root containing assets/)' }, null, 2));
        process.exit(4);
    }
    let proj = path.resolve(String(a.project));
    if (/\.fairy$/i.test(proj)) proj = path.dirname(proj);
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "lint_components.mjs");
    if (!fs.existsSync(script)) {
        console.error(JSON.stringify({ ok: false, error: `lint script not found: ${script}` }, null, 2));
        process.exit(4);
    }
    const child = spawn(process.execPath, [script, proj], { stdio: "inherit" });
    // await the child: process.exit must not be scheduled async-only, or execution
    // falls through to the editor-forwarding branch below and races the lint child.
    try {
        const code = await new Promise((resolve, reject) => {
            child.once("error", reject);
            child.once("close", (c) => resolve(c));
        });
        process.exit(code ?? 1);
    } catch (e) {
        console.error(JSON.stringify({ ok: false, error: String(e) }, null, 2));
        process.exit(3);
    }
}

// launch: start the editor with a project (window minimized-friendly,
// the plugin sets runInBackground itself).
// usage: fgui launch '{"project":"D:/work/my-ui","editor":"optional/exe/path"}'
if (cmd === "launch" || cmd === "ensure") {
    const { spawn } = await import("node:child_process");
    const fs = await import("node:fs");
    const a = rest.length ? JSON.parse(rest.join(" ")) : {};

    const ping = async (url) => {
        try {
            return await request(url, 'ping', {}, 3000);
        } catch {
            return null;
        }
    };

    const alive = async () => {
        try { const instance = await route({project: a.project, port: a.port, bridge_url: a.bridge_url});
            return {...await ping(instance.url), instance}; } catch (e) {
                if (e.code === 'BRIDGE_UNRESPONSIVE') throw e;
                return null;
            }
    };

    if (!a.project) {
        console.error(JSON.stringify({ok: false, error: 'args.project is required; ensure never reuses an unrelated editor'}));
        process.exit(4);
    }
    let existing;
    try { existing = await alive(); }
    catch (e) {
        if (cmd !== 'launch' || e.code !== 'BRIDGE_UNRESPONSIVE') {
            console.error(JSON.stringify({ok:false, error:String(e)}, null, 2));
            process.exit(3);
        }
    }
    if (existing?.ok) {
        console.log(JSON.stringify({ ok: true, already: true, ping: existing }, null, 2));
        process.exit(0);
    }

    const findEditor = () => {
        if (a.editor) return a.editor;
        if (process.env.FGUI_EDITOR_EXE) return process.env.FGUI_EDITOR_EXE;
        const candidates = [
            "C:/Program Files/FairyGUI-Editor/FairyGUI-Editor.exe",
            "D:/Program Files/FairyGUI-Editor/FairyGUI-Editor.exe",
            "D:/Applications/FairyGUI-Editor/FairyGUI-Editor.exe",
            "C:/Applications/FairyGUI-Editor/FairyGUI-Editor.exe",
            "/Applications/FairyGUI-Editor.app", // macOS
        ];
        for (const c of candidates) {
            try {
                fs.accessSync(c);
                return c;
            } catch { /* keep looking */ }
        }
        return null;
    };

    const editor = findEditor();
    const project = a.project;
    if (!editor) {
        console.error(JSON.stringify({
            ok: false,
            error: "editor executable not found; pass args.editor or set FGUI_EDITOR_EXE",
        }, null, 2));
        process.exit(4);
    }
    if (!project) {
        console.error(JSON.stringify({ ok: false, error: "args.project (dir containing the .fairy file) required" }, null, 2));
        process.exit(4);
    }
    // the editor wants the absolute path of the .fairy project descriptor;
    // accept either the file or its containing directory
    const path = await import("node:path");
    let proj = project;
    if (!proj.toLowerCase().endsWith(".fairy")) {
        const found = fs.readdirSync(proj).filter((f) => f.toLowerCase().endsWith(".fairy"));
        if (found.length !== 1) {
            console.error(JSON.stringify({ ok: false, error: `expected one .fairy file in ${proj}; found ${found.length}, pass the exact file path` }, null, 2));
            process.exit(4);
        }
        proj = path.join(proj, found[0]);
    }
    proj = path.resolve(proj);

    const isMacApp = editor.endsWith(".app");
    // args.args: 透传给编辑器的额外命令行（如 ["-screen-width","1400","-screen-height","900"]）
    const extra = Array.isArray(a.args) ? a.args.map(String) : [];
    const child = isMacApp
        ? spawn("open", ["-a", editor, proj], { detached: true, stdio: "ignore" })
        // Unity-based FairyGUI can stall before creating a window when started
        // with SW_HIDE. Start normally unless the caller explicitly requests it.
        : spawn(editor, [proj, ...extra], { detached: true, stdio: "ignore", windowsHide: a.visible === false, cwd: path.dirname(editor) });
    let exited = null;
    child.on('exit', (code, signal) => { exited = {code, signal}; });
    try {
        await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    } catch (error) {
        console.error(JSON.stringify({ok:false,error:`Editor launch failed: ${error.message}`}));
        process.exit(4);
    }
    child.unref();

    if (cmd === "launch") {
        console.log(JSON.stringify({ ok: true, launched: editor, project: proj, pid: child.pid,
            ready: false, message: 'Process created; use ensure/discover to verify the target project bridge' }, null, 2));
        process.exit(0);
    }

    // ensure: wait for the bridge to answer
    const deadline = Date.now() + (a.timeout_ms || 180000);
    while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        let p;
        try { p = await alive(); }
        catch (e) { if (e.code !== 'BRIDGE_UNRESPONSIVE') throw e; }
        if (p?.ok) {
            console.log(JSON.stringify({ ok: true, launched: editor, waitedMs: Date.now() - (deadline - (a.timeout_ms || 180000)), ping: p }, null, 2));
            process.exit(0);
        }
        if (!isMacApp && exited) {
            console.error(JSON.stringify({ok:false,error:'Editor exited before the target project bridge became ready',project:proj,...exited}));
            process.exit(5);
        }
    }
    console.error(JSON.stringify({ ok: false, error: "bridge did not come up in time; check plugins/agent-bridge/bridge.log inside the project" }, null, 2));
    process.exit(5);
}

if (!cmd || cmd === "-h" || cmd === "--help") {
    console.log(`fgui-agent-bridge CLI

usage: fgui <command> ['{"json":"args"}']
legacy HTTP fallback: ${BASE} (file queues discovered automatically)

commands are forwarded verbatim to the editor plugin, e.g.:
  ping | operation-status | acquire-lock | release-lock | project-info | list-packages | list-items | read-component
  create-component | delete-item | open-doc | close-doc | list-children
  insert-object | set-property | remove-object | save-all | refresh
  publish | screenshot | bridge-log

special:
  discover   list ALL running bridge instances across projects
             (reads ~/.fgui-agent-bridge/instances/*.json, pings each)
  sync-plugins
             fan <repo>/plugin out to every project in
             ~/.fgui-agent-bridge/projects.json (add/remove via
             '{"add":"D:/work/my-ui"}' / '{"remove":"..."}')
  lint       run the STANDARDS.md checker locally on a project - no editor
             needed. e.g. fgui lint '{"project":"D:/work/my-ui"}'
             exit 0 = clean, 1 = blocking issues found (see report)

examples:
  fgui ping
  fgui list-items '{"pkg":"common","depth":2}'
  fgui set-property '{"pkg":"common","name":"Demo","target":"n0","props":{"title":"Hi"}}'
  fgui publish '{"pkg":"common","out_path":"C:/tmp/out"}'

env:
  FGUI_BRIDGE_URL  select a discovered queue URL or legacy localhost HTTP URL`);
    process.exit(cmd ? 0 : 1);
}

const args = rest.length ? JSON.parse(rest.join(" ")) : {};

try {
    const instance = await route(args);
    const json = await request(instance.url, cmd.replace(/-/g, "_"), stripSelector(args), commandTimeout(cmd, args));
    console.log(JSON.stringify(json, null, 2));
    process.exit(json.ok ? 0 : 2);
} catch (e) {
    console.error(JSON.stringify({ ok: false, error: String(e) }, null, 2));
    console.error("Is the FairyGUI editor running with the agent-bridge plugin installed?");
    process.exit(3);
}
