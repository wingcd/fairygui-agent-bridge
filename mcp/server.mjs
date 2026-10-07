#!/usr/bin/env node
// fgui-agent-bridge MCP server - stdio JSON-RPC 2.0, zero dependencies.
//
// Registers one MCP tool per bridge command and forwards calls to the
// editor plugin over HTTP. Requires Node 18+ (global fetch).
//
// Env:
//   FGUI_BRIDGE_URL   default http://localhost:7531/

import process from "node:process";
import readline from "node:readline";
import { discover, route, request, stripSelector } from '../cli/instances.mjs';

const BASE = process.env.FGUI_BRIDGE_URL || "http://localhost:7531/";

// ---- tool catalogue: name -> { description, inputSchema } ----
const obj = (properties, required) => ({
    type: "object",
    properties,
    ...(required ? { required } : {}),
});
const S = String;

const TOOLS = {
    discover_projects: {
        description: 'List all online FairyGUI editor projects with absolute paths and ports. Each editor command accepts project, port, or bridge_url.',
        inputSchema: obj({}),
    },
    ping: {
        description: "Check the bridge and editor status. Start here.",
        inputSchema: obj({}),
    },
    project_info: {
        description: "Get the currently open FairyGUI project (name, packages).",
        inputSchema: obj({}),
    },
    list_packages: {
        description: "List all UI packages (id, name, basePath) in the project.",
        inputSchema: obj({}),
    },
    list_items: {
        description:
            "List the resource tree of a package: components, images, fonts with ids/paths. " +
            "Item URLs are 'ui://<pkgId><itemId>'.",
        inputSchema: obj(
            {
                pkg: { type: S("string"), description: "package name or id" },
                depth: { type: S("number"), description: "tree depth (default 3, 1=flat top level)" },
            },
            ["pkg"],
        ),
    },
    read_component: {
        description:
            "Return the raw component XML source (the .xml under assets/<pkg>/). " +
            "Read this before editing to learn child ids/names.",
        inputSchema: obj(
            {
                pkg: { type: S("string") },
                name: { type: S("string"), description: "component resource name" },
            },
            ["pkg", "name"],
        ),
    },
    create_component: {
        description:
            "Create a new component in a package (CreateComponentItem). Only FairyGUI-supported types: " +
            "extention must be one of Button/Label/ComboBox/ProgressBar/Slider/ScrollBar/List/Tree (or omit for a plain component; " +
            "CheckBox/Radio do NOT exist - they are Button mode Check/Radio). Split by responsibility - never dump all resources into one component (STANDARDS 2/2.6).",
        inputSchema: obj(
            {
                pkg: { type: S("string") },
                name: { type: S("string") },
                width: { type: S("number") },
                height: { type: S("number") },
                path: { type: S("string"), description: "folder path inside package, '' = root" },
                extention: { type: S("string"), description: "Button/Label/ComboBox/ProgressBar/Slider/ScrollBar/List/Tree" },
                exported: { type: S("boolean") },
            },
            ["pkg", "name", "width", "height"],
        ),
    },
    delete_item: {
        description: "Delete a resource item from a package (use with care).",
        inputSchema: obj({ pkg: { type: S("string") }, name: { type: S("string") } }, ["pkg", "name"]),
    },
    list_children: {
        description: "Open a component and list its stage children (name/id/type).",
        inputSchema: obj({ pkg: { type: S("string") }, name: { type: S("string") } }, ["pkg", "name"]),
    },
    insert_object: {
        description:
            "Insert a library item onto a component's stage. Reference it by url, or by ref_pkg+ref_name. " +
            "Optionally set props right away (same keys as set-property).",
        inputSchema: obj(
            {
                pkg: { type: S("string") },
                name: { type: S("string"), description: "target component being edited" },
                url: { type: S("string"), description: "ui:// url of the item to insert" },
                ref_pkg: { type: S("string") },
                ref_name: { type: S("string") },
                x: { type: S("number") },
                y: { type: S("number") },
                index: { type: S("number"), description: "z-order index" },
                props: { type: S("object") },
            },
            ["pkg", "name"],
        ),
    },
    set_property: {
        description:
            "Set properties of a child inside a component via editor API (undo-aware). " +
            "props keys are FairyGUI editor property names, e.g. xy/size/title/text/icon/fontSize/visible. " +
            "Vector-like values use 'x,y' string form, e.g. {\"xy\":\"100,200\"}.",
        inputSchema: obj(
            {
                pkg: { type: S("string") },
                name: { type: S("string") },
                target: { type: S("string"), description: "child name or 'a/b' path; omit = component root" },
                props: { type: S("object"), description: "e.g. {\"title\":\"Start\",\"xy\":\"50,60\"}" },
            },
            ["pkg", "name", "props"],
        ),
    },
    remove_object: {
        description: "Remove a child from a component's stage.",
        inputSchema: obj(
            { pkg: { type: S("string") }, name: { type: S("string") }, target: { type: S("string") } },
            ["pkg", "name", "target"],
        ),
    },
    save_all: {
        description: "Save all open documents.", inputSchema: obj({}) },
    refresh: {
        description: "Refresh the project view (pick up external file changes).",
        inputSchema: obj({}),
    },
    publish: {
        description:
            "Publish a package (PublishHandler). out_path optional - defaults to the project publish setting. " +
            "Output is byte-identical to clicking Publish in the editor (works on the free editor).",
        inputSchema: obj(
            {
                pkg: { type: S("string") },
                branch: { type: S("string") },
                out_path: { type: S("string"), description: "absolute output directory (overrides publish setting)" },
                timeout_ms: { type: S("number") },
            },
            ["pkg"],
        ),
    },
    screenshot: {
        description: "Capture the editor window to a png (UnityEngine.ScreenCapture).",
        inputSchema: obj({ path: { type: S("string") } }, ["path"]),
    },
    bridge_log: {
        description: "Tail of the bridge log inside the editor (debugging).",
        inputSchema: obj({ tail: { type: S("number") } }),
    },
};

for (const [name, tool] of Object.entries(TOOLS)) {
    if (name === 'discover_projects') continue;
    Object.assign(tool.inputSchema.properties, {
        project: {type: 'string', description: 'Target project absolute directory/.fairy path (recommended), or unique project name'},
        port: {type: 'integer', minimum: 1, maximum: 65535, description: 'Target editor bridge port'},
        bridge_url: {type: 'string', description: 'Target localhost bridge URL'},
    });
}

// ---- bridge call ----

async function callBridge(cmd, args) {
    if (cmd === 'discover_projects') return {ok: true, data: await discover()};
    const instance = await route(args);
    return request(instance.url, cmd, stripSelector(args), Math.max(10000, (Number(args.timeout_ms) || 45000) + 5000));
}

// ---- JSON-RPC over stdio ----

const rl = readline.createInterface({ input: process.stdin });

function send(msg) {
    process.stdout.write(JSON.stringify(msg) + "\n");
}

rl.on("line", async (line) => {
    line = line.trim();
    if (!line) return;
    let req;
    try {
        req = JSON.parse(line);
    } catch {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
        return;
    }
    // notifications get no response
    if (req.id === undefined || req.id === null) return;

    try {
        if (req.method === "initialize") {
            send({
                jsonrpc: "2.0",
                id: req.id,
                result: {
                    protocolVersion: "2024-11-05",
                    capabilities: { tools: {} },
                    serverInfo: { name: "fgui-agent-bridge", version: "0.2.0" },
                },
            });
        } else if (req.method === "tools/list") {
            send({
                jsonrpc: "2.0",
                id: req.id,
                result: {
                    tools: Object.entries(TOOLS).map(([name, t]) => ({
                        name,
                        description: t.description,
                        inputSchema: t.inputSchema,
                    })),
                },
            });
        } else if (req.method === "tools/call") {
            const name = req.params?.name;
            const args = req.params?.arguments || {};
            if (!TOOLS[name]) {
                send({
                    jsonrpc: "2.0",
                    id: req.id,
                    error: { code: -32602, message: `unknown tool: ${name}` },
                });
                return;
            }
            let out;
            try {
                out = await callBridge(name, args);
            } catch (e) {
                out = { ok: false, error: String(e) + " (is the FairyGUI editor running with the plugin?)" };
            }
            send({
                jsonrpc: "2.0",
                id: req.id,
                result: {
                    content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
                    isError: !out.ok,
                },
            });
        } else if (req.method === "ping") {
            send({ jsonrpc: "2.0", id: req.id, result: {} });
        } else {
            send({
                jsonrpc: "2.0",
                id: req.id,
                error: { code: -32601, message: `method not found: ${req.method}` },
            });
        }
    } catch (e) {
        send({ jsonrpc: "2.0", id: req.id, error: { code: -32603, message: String(e) } });
    }
});

process.stderr.write(`[fgui-agent-bridge mcp] per-request project routing (default hint ${BASE})\n`);
