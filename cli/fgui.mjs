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
if (!cmd || cmd === "-h" || cmd === "--help") {
    console.log(`fgui-agent-bridge CLI

usage: fgui <command> ['{"json":"args"}']
bridge: ${BASE}

commands are forwarded verbatim to the editor plugin, e.g.:
  ping | project-info | list-packages | list-items | read-component
  create-component | delete-item | open-doc | close-doc | list-children
  insert-object | set-property | remove-object | save-all | refresh
  publish | screenshot | bridge-log

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
