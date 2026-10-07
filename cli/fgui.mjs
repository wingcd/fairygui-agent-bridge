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

const BASE = process.env.FGUI_BRIDGE_URL || "http://localhost:7531/";

const [cmd, ...rest] = process.argv.slice(2);

// discover: list all running bridge instances across projects (no editor needed)
if (cmd === "discover") {
    const os = await import("node:os");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const regPath = path.join(os.homedir(), ".fgui-agent-bridge", "registry.json");
    let entries = [];
    try {
        entries = JSON.parse(fs.readFileSync(regPath, "utf8"));
    } catch {
        entries = [];
    }
    const alive = [];
    for (const e of entries) {
        try {
            process.kill(e.pid, 0); // liveness probe, signal 0
        } catch {
            continue; // stale entry
        }
        let ping = null;
        try {
            const r = await fetch(`http://localhost:${e.port}/`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ cmd: "ping" }),
            });
            ping = await r.json();
        } catch {
            continue; // not answering
        }
        alive.push({ port: e.port, pid: e.pid, project: ping?.data?.project || e.project, url: `http://localhost:${e.port}/` });
    }
    console.log(JSON.stringify({ ok: true, registry: regPath, instances: alive }, null, 2));
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

    const alive = async () => ping(BASE);

    if (cmd === "ensure" && (await alive())?.ok) {
        console.log(JSON.stringify({ ok: true, already: true, ping: await alive() }, null, 2));
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
        if (found.length === 0) {
            console.error(JSON.stringify({ ok: false, error: `no .fairy file found in ${proj}` }, null, 2));
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
        : spawn(editor, [proj, ...extra], { detached: true, stdio: "ignore" });
    child.unref();

    if (cmd === "launch") {
        console.log(JSON.stringify({ ok: true, launched: editor, project }, null, 2));
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
    const res = await fetch(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: cmd.replace(/-/g, "_"), args }),
    });
    const json = await res.json();
    console.log(JSON.stringify(json, null, 2));
    process.exit(json.ok ? 0 : 2);
} catch (e) {
    console.error(JSON.stringify({ ok: false, error: String(e) }, null, 2));
    console.error("Is the FairyGUI editor running with the agent-bridge plugin installed?");
    process.exit(3);
}
