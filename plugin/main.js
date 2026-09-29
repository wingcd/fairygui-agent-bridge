// FairyGUI Agent Bridge - editor-side plugin
//
// Runs a localhost HTTP JSON endpoint inside the FairyGUI editor so that AI
// agents (via CLI or MCP) can drive the editor: create components, insert
// objects, set properties, and publish packages - all through official
// editor APIs (undo-aware) with byte-identical publish output.
//
// Threading model: strictly single-threaded. HttpListener.BeginGetContext
// is polled per frame (IsCompleted), so every request is accepted, executed
// and answered on the main Unity thread. No JS ever runs off-thread.
//
// Endpoint: http://localhost:<port>/   (default 7531, override via port.txt
// next to this file)
// Protocol: POST with JSON body  {"cmd": "<command>", "args": {...}}
// Response: JSON {"ok": true, "data": ...} or {"ok": false, "error": "..."}

var VERSION = "0.1.0";

var FairyGUI = CS.FairyGUI;
var FairyEditor = CS.FairyEditor;
var App = FairyEditor.App;

// ---------------- logger ----------------

var PluginDir = App.pluginManager.basePath + "/agent-bridge";
var Bridge = {
    listener: null,
    pendingAccept: null,   // IAsyncResult of BeginGetContext
    queue: [],             // [{ctx, cmd, args}]
    current: null,         // command being executed across frames (publish)
    logLines: []
};

function plog(msg) {
    Bridge.logLines.push("[" + new Date().toISOString() + "] " + msg);
    if (Bridge.logLines.length > 500) Bridge.logLines.shift();
    console.log("[agent-bridge] " + msg);
    try {
        CS.System.IO.File.WriteAllText(
            PluginDir + "/bridge.log",
            Bridge.logLines.join("\n"));
    } catch (e) { /* disk issues must never break the server */ }
}

function readPort() {
    try {
        var s = CS.System.IO.File.ReadAllText(PluginDir + "/port.txt").trim();
        var p = parseInt(s, 10);
        if (p > 0 && p < 65536) return p;
    } catch (e) { }
    return 7531;
}

// ---------------- helpers ----------------

function ok(data) { return { ok: true, data: data === undefined ? null : data }; }
function fail(msg) { return { ok: false, error: String(msg) }; }

function getPkg(nameOrId) {
    var p = App.project.GetPackageByName(String(nameOrId));
    if (p == null) p = App.project.GetPackage(String(nameOrId));
    if (p == null) throw "package not found: " + nameOrId;
    return p;
}

function itemUrl(pkg, item) { return "ui://" + pkg.id + item.id; }

function findItem(pkg, name, recursiveFrom) {
    var root = recursiveFrom || pkg.rootItem;
    if (root.name === name) return root;
    var ch = root.children;
    for (var i = 0; i < ch.Count; i++) {
        var r = findItem(pkg, name, ch.get_Item(i));
        if (r != null) return r;
    }
    return null;
}

function requireComponentItem(pkg, compName) {
    var it = findItem(pkg, compName);
    if (it == null) throw "component not found in package '" + pkg.name + "': " + compName;
    return it;
}

function ensureDocOpen(pkg, compName) {
    var item = requireComponentItem(pkg, compName);
    var url = itemUrl(pkg, item);
    var doc = App.docView.FindDocument(url);
    if (doc == null) doc = App.docView.OpenDocument(url, true);
    if (doc == null) throw "failed to open document: " + compName;
    return { doc: doc, item: item, url: url };
}

function itemInfo(pkg, item, depth) {
    var o = {
        id: item.id,
        name: item.name,
        type: item.type,
        path: item.path,
        exported: false,
        width: item.width,
        height: item.height
    };
    try { o.exported = item.exported; } catch (e) { }
    try { o.file = item.file; } catch (e) { }
    if (depth > 0) {
        o.children = [];
        var ch = item.children;
        for (var i = 0; i < ch.Count; i++) {
            o.children.push(itemInfo(pkg, ch.get_Item(i), depth - 1));
        }
    }
    return o;
}

function propValueIn(v) {
    // pass-through: numbers/bools as-is, everything else as string
    return v;
}

// ---------------- command implementations (sync) ----------------

var COMMANDS = {};

COMMANDS.ping = function (a) {
    return ok({
        version: VERSION,
        editor: "FairyGUI",
        port: Bridge.port,
        projectOpen: App.project != null,
        project: projectLabel()
    });
};

COMMANDS.project_info = function (a) {
    if (App.project == null) throw "no project open";
    var p = App.project;
    var d = { port: Bridge.port, packages: p.allPackages.Count, packageNames: [] };
    try { d.name = p.name; } catch (e) { }
    try { d.path = p.projectPath; } catch (e) { }
    for (var i = 0; i < p.allPackages.Count; i++) {
        d.packageNames.push(p.allPackages.get_Item(i).name);
    }
    return ok(d);
};

COMMANDS.list_packages = function (a) {
    if (App.project == null) throw "no project open";
    var arr = [];
    var ps = App.project.allPackages;
    for (var i = 0; i < ps.Count; i++) {
        var p = ps.get_Item(i);
        arr.push({ id: p.id, name: p.name, basePath: p.basePath });
    }
    return ok(arr);
};

COMMANDS.list_items = function (a) {
    var pkg = getPkg(a.pkg);
    return ok(itemInfo(pkg, pkg.rootItem, a.depth === undefined ? 3 : a.depth));
};

COMMANDS.read_component = function (a) {
    var pkg = getPkg(a.pkg);
    var item = requireComponentItem(pkg, a.name);
    return ok({
        name: item.name,
        url: itemUrl(pkg, item),
        xml: CS.System.IO.File.ReadAllText(item.file)
    });
};

COMMANDS.create_component = function (a) {
    var pkg = getPkg(a.pkg);
    var path = a.path || "";
    var ext = a.extention || "";
    var exported = a.exported === undefined ? true : !!a.exported;
    var it = pkg.CreateComponentItem(String(a.name), a.width | 0, a.height | 0, path, ext, exported, false);
    pkg.Save();
    return ok({ id: it.id, name: it.name, url: itemUrl(pkg, it), file: it.file });
};

COMMANDS.delete_item = function (a) {
    var pkg = getPkg(a.pkg);
    var item = requireComponentItem(pkg, a.name);
    pkg.DeleteItem(item);
    pkg.Save();
    return ok({ deleted: a.name });
};

COMMANDS.open_doc = function (a) {
    var pkg = getPkg(a.pkg);
    var r = ensureDocOpen(pkg, a.name);
    return ok({ opened: a.name, url: r.url });
};

COMMANDS.close_doc = function (a) {
    var pkg = getPkg(a.pkg);
    var item = requireComponentItem(pkg, a.name);
    var doc = App.docView.FindDocument(itemUrl(pkg, item));
    if (doc != null) App.docView.CloseDocument(doc);
    return ok({ closed: a.name });
};

COMMANDS.list_children = function (a) {
    var pkg = getPkg(a.pkg);
    var r = ensureDocOpen(pkg, a.name);
    var content = r.doc.content;
    var arr = [];
    var ch = content.children;
    for (var i = 0; i < ch.Count; i++) {
        var c = ch.get_Item(i);
        var o = { name: c.name };
        try { o.id = c.id; } catch (e) { }
        try { o.objType = c.objType; } catch (e) { }
        arr.push(o);
    }
    return ok({ component: a.name, children: arr });
};

// insert a library item (component/image/etc, referenced by url or pkg+name)
// into a component's stage
COMMANDS.insert_object = function (a) {
    var pkg = getPkg(a.pkg);
    var r = ensureDocOpen(pkg, a.name);
    var url = a.url || null;
    if (!url) {
        var refPkg = getPkg(a.ref_pkg || a.pkg);
        var refItem = requireComponentItem(refPkg, a.ref_name);
        url = itemUrl(refPkg, refItem);
    }
    var pos = null;
    if (a.x !== undefined && a.y !== undefined) {
        pos = new CS.UnityEngine.Vector2(a.x + 0.0, a.y + 0.0);
    }
    var obj;
    if (a.index === undefined) {
        obj = pos != null ? r.doc.InsertObject(url, pos) : r.doc.InsertObject(url);
    } else {
        obj = r.doc.InsertObject(url, pos, a.index | 0);
    }
    if (obj == null) throw "InsertObject returned null for url " + url;
    if (a.props) applyProps(obj, a.props);
    App.docView.SaveDocument(r.doc);
    return ok({ inserted: obj.name, url: url });
};

COMMANDS.set_property = function (a) {
    var pkg = getPkg(a.pkg);
    var r = ensureDocOpen(pkg, a.name);
    var target = a.target ? findChild(r.doc.content, a.target) : r.doc.content;
    if (target == null) throw "target not found: " + a.target;
    var props = a.props || null;
    if (props == null && a.prop !== undefined) props = {};
    if (props == null) throw "no props given (args.props={...} or args.prop/args.value)";
    if (a.prop !== undefined && props[a.prop] === undefined) props[a.prop] = a.value;
    var applied = applyProps(target, props);
    App.docView.SaveDocument(r.doc);
    return ok({ target: a.target || "$root", applied: applied });
};

COMMANDS.remove_object = function (a) {
    var pkg = getPkg(a.pkg);
    var r = ensureDocOpen(pkg, a.name);
    var target = findChild(r.doc.content, a.target);
    if (target == null) throw "target not found: " + a.target;
    r.doc.RemoveObject(target);
    App.docView.SaveDocument(r.doc);
    return ok({ removed: a.target });
};

COMMANDS.save_all = function (a) {
    App.docView.SaveAllDocuments();
    return ok({ saved: true });
};

COMMANDS.refresh = function (a) {
    App.RefreshProject();
    return ok({ refreshed: true });
};

COMMANDS.screenshot = function (a) {
    if (!a.path) throw "args.path required (absolute png path)";
    CS.UnityEngine.ScreenCapture.Screenshot(a.path);
    return ok({ screenshot: a.path });
};

// internal for tests: expose bridge log tail
COMMANDS.bridge_log = function (a) {
    var n = a && a.tail ? a.tail : 40;
    return ok(Bridge.logLines.slice(-n));
};

function findChild(content, target) {
    // supports plain name or "a/b/c" path
    if (target.indexOf("/") >= 0) return content.GetChildByPath(target);
    return content.GetChild(target);
}

function applyProps(obj, props) {
    var applied = [];
    for (var k in props) {
        obj.docElement.SetProperty(k, propValueIn(props[k]));
        applied.push(k);
    }
    return applied;
}

// ---------------- publish (async across frames) ----------------

function startPublish(job) {
    var pkg = getPkg(job.args.pkg);
    var handler = new FairyEditor.PublishHandler(pkg, job.args.branch || "");
    if (job.args.out_path) handler.exportPath = String(job.args.out_path);
    job.handler = handler;
    job.done = false;
    job.files = [];
    handler.add_onComplete(function () {
        job.done = true;
        job.isSuccess = handler.isSuccess;
        try {
            var files = CS.System.IO.Directory.GetFiles(handler.exportPath);
            for (var i = 0; i < files.Length; i++) job.files.push(files[i]);
        } catch (e) { }
    });
    var t0 = Date.now();
    job.t0 = t0;
    handler.Run(); // hot task; onComplete marks completion
    job.deadline = t0 + (job.args.timeout_ms || 120000);
}

function stepPublish(job) {
    if (job.done) {
        return ok({ isSuccess: job.isSuccess, elapsedMs: Date.now() - job.t0, files: job.files });
    }
    if (Date.now() > job.deadline) {
        try { job.handler.Exit(); } catch (e) { }
        return fail("publish timed out after " + (Date.now() - job.t0) + "ms");
    }
    return null; // keep waiting, called again next frame
}

// ---------------- async command registry ----------------

var ASYNC_STARTERS = { publish: startPublish };
var ASYNC_STEPPERS = { publish: stepPublish };

// ---------------- instance registry (multi-project support) ----------------
// A fixed per-user registry file maps running editor instances to their
// ports, so agents can tell several open projects apart.

var RegistryPath = (function () {
    try {
        return CS.System.Environment.GetFolderPath(CS.System.Environment.SpecialFolder.UserProfile)
            + "/.fgui-agent-bridge/registry.json";
    } catch (e) { return null; }
})();

function registryRead() {
    if (RegistryPath == null) return [];
    try {
        var s = CS.System.IO.File.ReadAllText(RegistryPath);
        var arr = JSON.parse(s);
        return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
}

function registryWrite(arr) {
    if (RegistryPath == null) return;
    try {
        CS.System.IO.Directory.CreateDirectory(
            CS.System.IO.Path.GetDirectoryName(RegistryPath));
        CS.System.IO.File.WriteAllText(RegistryPath, JSON.stringify(arr));
    } catch (e) { plog("registry write failed: " + e); }
}

function processAlive(pid) {
    if (!pid) return false;
    try {
        var p = CS.System.Diagnostics.Process.GetProcessById(pid);
        return p != null && !p.HasExited;
    } catch (e) { return false; }
}

function registryRegister(port) {
    var myPid = CS.System.Diagnostics.Process.GetCurrentProcess().Id;
    var arr = registryRead().filter(function (e) { return processAlive(e.pid) && e.pid !== myPid; });
    var entry = {
        port: port,
        pid: myPid,
        project: projectLabel(),
        startedAt: new Date().toISOString()
    };
    arr.push(entry);
    registryWrite(arr);
    return entry;
}

function registryUnregister() {
    var arr = registryRead().filter(function (e) { return processAlive(e.pid); });
    registryWrite(arr);
}

function projectLabel() {
    try {
        if (App.project != null) {
            var n = App.project.name;
            if (n) return String(n);
        }
    } catch (e) { }
    return "";
}

// ---------------- HTTP plumbing (main thread only) ----------------

function startServer() {
    var wanted = readPort();
    var maxTries = 21; // e.g. 7531..7551
    for (var port = wanted; port < wanted + maxTries; port++) {
        try {
            var listener = new CS.System.Net.HttpListener();
            listener.Prefixes.Add("http://localhost:" + port + "/");
            listener.Start();
            Bridge.listener = listener;
            Bridge.port = port;
            Bridge.pendingAccept = listener.BeginGetContext(null, null);
            var entry = registryRegister(port);
            plog("listening on http://localhost:" + port + "/ v" + VERSION
                + (port !== wanted ? " (default port busy, auto-picked)" : ""));
            return true;
        } catch (e) {
            // port busy or listener error - try the next port
        }
    }
    plog("FAILED to start http listener on ports " + wanted + ".." + (wanted + maxTries - 1));
    return false;
}

function readBody(ctx) {
    var req = ctx.Request;
    if (req.ContentLength64 <= 0) return "";
    var ms = new CS.System.IO.MemoryStream();
    req.InputStream.CopyTo(ms);
    var bytes = ms.ToArray();
    return CS.System.Text.Encoding.UTF8.GetString(bytes);
}

function writeResponse(ctx, status, obj) {
    try {
        var resp = ctx.Response;
        var body = JSON.stringify(obj);
        var bytes = CS.System.Text.Encoding.UTF8.GetBytes(body);
        resp.StatusCode = status;
        resp.ContentType = "application/json; charset=utf-8";
        resp.ContentLength64 = bytes.Length;
        resp.Headers.Set("Access-Control-Allow-Origin", "*");
        resp.OutputStream.Write(bytes, 0, bytes.Length);
        resp.OutputStream.Close();
    } catch (e) {
        plog("writeResponse failed (client gone?): " + e);
    }
}

function pumpAccepts() {
    if (Bridge.pendingAccept == null) return;
    if (!Bridge.pendingAccept.IsCompleted) return;
    var ctx = null;
    try {
        ctx = Bridge.listener.EndGetContext(Bridge.pendingAccept);
    } catch (e) {
        plog("EndGetContext error: " + e);
    }
    // immediately re-arm for the next request
    try {
        Bridge.pendingAccept = Bridge.listener.BeginGetContext(null, null);
    } catch (e) {
        Bridge.pendingAccept = null;
        plog("re-arm failed, server down: " + e);
    }
    if (ctx == null) return;
    handleRequest(ctx);
}

function handleRequest(ctx) {
    var req = ctx.Request;
    // simple CORS preflight support for browser consoles
    if (req.HttpMethod === "OPTIONS") {
        ctx.Response.Headers.Set("Access-Control-Allow-Origin", "*");
        ctx.Response.Headers.Set("Access-Control-Allow-Methods", "POST, OPTIONS");
        ctx.Response.Headers.Set("Access-Control-Allow-Headers", "Content-Type");
        writeResponse(ctx, 200, ok({ cors: true }));
        return;
    }
    var body = "";
    try { body = readBody(ctx); } catch (e) { writeResponse(ctx, 400, fail("bad body: " + e)); return; }
    var msg = null;
    try { msg = body ? JSON.parse(body) : {}; } catch (e) { }
    if (!msg || !msg.cmd) {
        writeResponse(ctx, 400, fail("body must be JSON like {\"cmd\":..., \"args\":{...}}"));
        return;
    }
    Bridge.queue.push({ ctx: ctx, cmd: String(msg.cmd), args: msg.args || {} });
}

function stepQueue() {
    // finish the running async job first
    if (Bridge.current != null) {
        var job = Bridge.current;
        var out = ASYNC_STEPPERS[job.cmd](job);
        if (out !== null && out !== undefined) {
            writeResponse(job.ctx, 200, out);
            Bridge.current = null;
        }
        return; // one async job at a time
    }
    var next = Bridge.queue.shift();
    if (next == null) return;
    var cmd = next.cmd;
    if (ASYNC_STARTERS[cmd]) {
        var job = { ctx: next.ctx, cmd: cmd, args: next.args };
        try {
            ASYNC_STARTERS[cmd](job);
            Bridge.current = job;
        } catch (e) {
            writeResponse(next.ctx, 200, fail(cmd + ": " + e));
        }
        return;
    }
    var fn = COMMANDS[cmd];
    if (fn == null) {
        writeResponse(next.ctx, 404, fail("unknown command: " + cmd + " (see commands in README)"));
        return;
    }
    var result;
    try {
        result = fn(next.args);
    } catch (e) {
        result = fail(cmd + ": " + (e && e.message ? e.message : e));
    }
    writeResponse(next.ctx, 200, result);
}

function onUpdate() {
    if (Bridge.listener == null) return;
    pumpAccepts();
    stepQueue();
}

function boot() {
    if (App.project != null) {
        startServer();
    } else {
        App.add_onProjectOpened(function () { startServer(); });
    }
    App.add_onUpdate(onUpdate);
    // convenience menu item
    try {
        var toolMenu = App.menu.GetSubMenu("tool");
        toolMenu.AddItem("Agent bridge: restart server", "agentbridge_restart", function () {
            Bridge.listener = null;
            Bridge.pendingAccept = null;
            startServer();
        });
    } catch (e) {
        plog("menu hook skipped: " + e);
    }
}

boot();

function onDestroy() {
    try { registryUnregister(); } catch (e) { }
    try { if (Bridge.listener != null) Bridge.listener.Close(); } catch (e) { }
}
