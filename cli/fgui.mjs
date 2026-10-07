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
import { discover, route, request, stripSelector } from './instances.mjs';

const BASE = process.env.FGUI_BRIDGE_URL || "http://localhost:7531/";

const [cmd, ...rest] = process.argv.slice(2);

// discover: list all running bridge instances across projects (no editor needed)
if (cmd === "discover") {
    console.log(JSON.stringify({ok: true, instances: await discover()}, null, 2));
    process.exit(0);
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
            const r = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ cmd: "ping" }),
                signal: AbortSignal.timeout(3000),
            });
            return await r.json();
        } catch {
            return null;
        }
    };

    const alive = async () => {
        try { const instance = await route({project: a.project, port: a.port, bridge_url: a.bridge_url});
            return {...await ping(instance.url), instance}; } catch { return null; }
    };

    if (!a.project) {
        console.error(JSON.stringify({ok: false, error: 'args.project is required; ensure never reuses an unrelated editor'}));
        process.exit(4);
    }
    const existing = await alive();
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
        : spawn(editor, [proj, ...extra], { detached: true, stdio: "ignore", windowsHide: a.visible !== true, cwd: path.dirname(editor) });
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
        const p = await alive();
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
bridge: ${BASE}

commands are forwarded verbatim to the editor plugin, e.g.:
  ping | project-info | list-packages | list-items | read-component
  create-component | delete-item | open-doc | close-doc | list-children
  insert-object | set-property | remove-object | save-all | refresh
  publish | screenshot | bridge-log

special:
  discover   list ALL running bridge instances across projects
             (reads ~/.fgui-agent-bridge/registry.json, pings each)

examples:
  fgui ping
  fgui list-items '{"pkg":"common","depth":2}'
  fgui set-property '{"pkg":"common","name":"Demo","target":"n0","props":{"title":"Hi"}}'
  fgui publish '{"pkg":"common","out_path":"C:/tmp/out"}'

env:
  FGUI_BRIDGE_URL  override bridge base url (default http://localhost:7531/)`);
    process.exit(cmd ? 0 : 1);
}

const args = rest.length ? JSON.parse(rest.join(" ")) : {};

try {
    const instance = await route(args);
    const json = await request(instance.url, cmd.replace(/-/g, "_"), stripSelector(args), Math.max(10000, (Number(args.timeout_ms) || 45000) + 5000));
    console.log(JSON.stringify(json, null, 2));
    process.exit(json.ok ? 0 : 2);
} catch (e) {
    console.error(JSON.stringify({ ok: false, error: String(e) }, null, 2));
    console.error("Is the FairyGUI editor running with the agent-bridge plugin installed?");
    process.exit(3);
}
