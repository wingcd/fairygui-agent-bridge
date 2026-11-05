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
// Startup model: the HTTP server is started from the frame loop (onUpdate),
// never from inside the onProjectOpened callback - during project open the
// editor pumps the loading dialog's modal loop, and slow/blocking work done
// in that callback re-enters PlayerLoop and deadlocks the spinner.
//
// IMPORTANT: never call System.Diagnostics.Process from this plugin. In this
// stripped Unity editor build those queries corrupt native state (observed:
// GetProcessById on a foreign pid deadlocks the main thread or crashes the
// editor inside puerts). The plugin therefore registers itself as a plain
// port-keyed JSON file and does NOT probe other instances; liveness of
// registered instances is confirmed by the CLI/MCP side with HTTP pings.
//
// Endpoint: http://localhost:<port>/   (default 7531, override via port.txt
// next to this file)
// Protocol: POST with JSON body  {"cmd": "<command>", "args": {...}}
// Response: JSON {"ok": true, "data": ...} or {"ok": false, "error": "..."}

var VERSION = "0.3.1";

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
    wantServer: false,     // start/restart the listener on the next frame tick
    destroyed: false,
    toolMenu: null,
    port: undefined,       // port we actually bound (set by startServer)
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
    // packages are lazily loaded: the item tree (rootItem.children) is only
    // populated after EnsureOpen, otherwise it looks empty
    try { if (!p.opened) p.EnsureOpen(); } catch (e) { plog("EnsureOpen(" + nameOrId + "): " + e); }
    return p;
}

function itemUrl(pkg, item) {
    // Encoded item URLs reserve exactly eight characters for the package ID.
    // A short handmade package ID silently eats the beginning of the item ID.
    if (String(pkg.id).length !== 8) {
        throw "invalid package id '" + pkg.id + "' in package '" + pkg.name +
            "': FairyGUI encoded URLs require 8 characters; repair package.xml and its ui:// references before editing";
    }
    return "ui://" + pkg.id + item.id;
}

function findItem(pkg, name, recursiveFrom) {
    var root = recursiveFrom || pkg.rootItem;
    if (root == null || root.name === name) return root;
    var ch = root.children;
    if (ch == null) return null;
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
    if (doc == null) {
        // Installed editor.d.ts declares URL overloads only, not FPackageItem.
        var attempts = [
            function () { return App.docView.OpenDocument(url, true); },
            function () { return App.docView.OpenDocument(url); },
        ];
        var lastErr = null;
        for (var i = 0; i < attempts.length && doc == null; i++) {
            try {
                doc = attempts[i]();
                if (doc == null) doc = App.docView.FindDocument(url);
            } catch (e) { lastErr = e; plog("OpenDocument#" + i + " " + compName + ": " + e); }
        }
        if (doc == null) throw "failed to open document: " + compName + (lastErr ? (" (last: " + lastErr + ")") : "");
    }
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
        // 非文件夹项（image/font/sound/jta…）children 为 null——实证：挪一挪猪 common
        // 含 font/sound 登记，list_items depth>0 必炸（findItem 早有同款判空守卫）
        if (ch != null) {
            for (var i = 0; i < ch.Count; i++) {
                o.children.push(itemInfo(pkg, ch.get_Item(i), depth - 1));
            }
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
        projectPath: projectDirectory(),
        projectOpen: App.project != null,
        project: projectLabel()
    });
};

COMMANDS.project_info = function (a) {
    if (App.project == null) throw "no project open";
    var p = App.project;
    var d = { port: Bridge.port, packages: p.allPackages.Count, packageNames: [] };
    d.projectPath = projectDirectory();
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

COMMANDS.export_strings = function (a) {
    if (App.project == null) throw "no project open";
    var file = a.file ? String(a.file) : (projectDirectory() + "/strings.xml");
    var handler = new FairyEditor.ExportStringsHandler();
    handler.Parse(App.project.allPackages, false, false);
    handler.Export(file, false, false);
    return ok({ file: file, packages: App.project.allPackages.Count });
};

COMMANDS.import_strings = function (a) {
    if (App.project == null) throw "no project open";
    if (!a.file) throw "file required (FairyGUI-export strings xml format)";
    var file = String(a.file);
    if (!CS.System.IO.File.Exists(file)) throw "file not found: " + file;
    var handler = new FairyEditor.ImportStringsHandler();
    handler.Parse(file);
    handler.Import();
    var count = 0;
    var it = handler.strings.GetEnumerator();
    while (it.MoveNext()) {
        var it2 = it.Current.Value.GetEnumerator();
        while (it2.MoveNext()) count += it2.Current.Value.Count;
    }
    App.docView.SaveAllDocuments();
    App.RefreshProject();
    return ok({ file: file, strings: count });
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
    if (String(pkg.id).length !== 8) itemUrl(pkg, { id: "" });
    if (!(a.width > 0 && a.height > 0)) throw "positive component width and height required";
    if (!a.name || findItem(pkg, String(a.name))) throw "component name missing or already exists: " + a.name;
    // both path and extentionId must be null (not "") when unused - the
    // empty string breaks internal dictionary lookups in CreateComponentItem
    var path = a.path ? String(a.path) : null;
    var exported = a.exported === undefined ? true : !!a.exported;
    var ext = a.extention ? String(a.extention) : null;
    var it = pkg.CreateComponentItem(String(a.name), a.width | 0, a.height | 0, path, ext, exported, false);
    pkg.Save();
    // Do not report a usable component until the editor can load its document.
    var opened = ensureDocOpen(pkg, it.name);
    return ok({ id: it.id, name: it.name, url: opened.url, file: it.file, openable: true });
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
    // 注意：被 Unity 裁剪的方法在 Jint 里可能暴露为 truthy 但不可调用，
    // typeof/真值守卫都会漏，必须 try/catch 实调
    var sc = null;
    try { sc = CS.UnityEngine.ScreenCapture; } catch (e) {}
    var last = null;
    if (sc) {
        try {
            sc.CaptureScreenshotAsFile(String(a.path)); // 同步写盘
            return ok({ screenshot: a.path });
        } catch (e1) { last = e1; plog("screenshot: CaptureScreenshotAsFile failed: " + e1); }
        try {
            sc.CaptureScreenshot(String(a.path)); // 异步：帧末写盘
            return ok({ screenshot: a.path, async: true });
        } catch (e2) { last = e2; plog("screenshot: CaptureScreenshot failed: " + e2); }
    }
    throw "ScreenCapture API unavailable in this editor build (" + last + "); use OS-level window capture (e.g. PowerShell CopyFromScreen) instead";
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

function setOneProp(obj, k, v) {
    try {
        obj.docElement.SetProperty(k, v);
        return "set";
    } catch (e1) {
        try {
            // extention props (title/icon/... on Button/Label/ProgressBar
            // extention components) live on a separate setter
            obj.docElement.SetExtensionProperty(k, v);
            return "ext";
        } catch (e2) {
            // vector-like editor xml attrs may map to scalar props
            if (typeof v === "string" && v.indexOf(",") >= 0) {
                var parts = v.split(",");
                var x = parseInt(parts[0], 10), y = parseInt(parts[1], 10);
                if (k === "size") {
                    obj.docElement.SetProperty("width", x);
                    obj.docElement.SetProperty("height", y);
                    return "w/h";
                }
                if (k === "xy") {
                    obj.docElement.SetProperty("x", x);
                    obj.docElement.SetProperty("y", y);
                    return "x/y";
                }
                if (k === "pivot" || k === "anchor" || k === "scale") {
                    obj.docElement.SetProperty(k + "X", x);
                    obj.docElement.SetProperty(k + "Y", y);
                    return k + "X/" + k + "Y";
                }
            }
            throw e2;
        }
    }
}

function applyProps(obj, props) {
    var applied = [];
    for (var k in props) {
        applied.push(k + ":" + setOneProp(obj, k, propValueIn(props[k])));
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
    job.onComplete = function () {
        if (Bridge.destroyed || job.cancelled) return;
        job.done = true;
        job.isSuccess = handler.isSuccess;
        job.exportPath = handler.exportPath;
        try {
            var files = CS.System.IO.Directory.GetFiles(handler.exportPath);
            for (var i = 0; i < files.Length; i++) job.files.push(files.GetValue(i));
        } catch (e) { }
    };
    handler.add_onComplete(job.onComplete);
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
        return fail("publish timed out after " + (Date.now() - job.t0) + "ms");
    }
    return null; // keep waiting, called again next frame
}

function releasePublish(job, cancel) {
    if (job.handler == null) return;
    job.cancelled = !!cancel;
    try { job.handler.remove_onComplete(job.onComplete); } catch (e) { }
    if (cancel) {
        try { job.handler.Exit(); } catch (e) { }
    }
    job.onComplete = null;
    job.handler = null;
}

// ---------------- async command registry ----------------

var ASYNC_STARTERS = { publish: startPublish };
var ASYNC_STEPPERS = { publish: stepPublish };

// ---------------- instance registry (multi-project support) ----------------
// Each running instance drops one small JSON file keyed by its own port;
// the CLI/MCP side enumerates them and confirms liveness with an HTTP ping.
// The plugin never reads or probes other instances (see the Process API
// warning in the header) and never writes shared files, so concurrent
// editor startups cannot clobber each other's registrations.

var InstancesDir = (function () {
    try {
        return CS.System.Environment.GetFolderPath(CS.System.Environment.SpecialFolder.UserProfile)
            + "/.fgui-agent-bridge/instances";
    } catch (e) { return null; }
})();

function instanceFilePath(port) {
    // port comes from our own bound listener, digits only - no separators
    return InstancesDir + "/" + port + ".json";
}

function instanceRegister(port) {
    if (InstancesDir == null) return;
    try {
        CS.System.IO.Directory.CreateDirectory(InstancesDir);
        CS.System.IO.File.WriteAllText(instanceFilePath(port), JSON.stringify({
            port: port,
            project: projectLabel(),
            projectPath: projectDirectory(),
            startedAt: new Date().toISOString()
        }));
    } catch (e) { plog("instance registration failed: " + e); }
}

function instanceUnregister() {
    if (InstancesDir == null || Bridge.port === undefined) return;
    try {
        var file = instanceFilePath(Bridge.port);
        if (CS.System.IO.File.Exists(file)) CS.System.IO.File.Delete(file);
    } catch (e) { }
}

function projectDirectory() {
    // The plugin is installed at <project>/plugins/agent-bridge.
    // Avoid additional native Path overloads in the stripped Unity editor build.
    return String(PluginDir).replace(/\\/g, '/').replace(/\/$/, '').split('/').slice(0, -2).join('/');
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
    if (Bridge.destroyed || Bridge.listener != null) return false;
    var wanted = readPort();
    var maxTries = 21; // e.g. 7531..7551
    for (var port = wanted; port < wanted + maxTries; port++) {
        var listener = null;
        try {
            listener = new CS.System.Net.HttpListener();
            listener.Prefixes.Add("http://localhost:" + port + "/");
            listener.Start();
            var pendingAccept = listener.BeginGetContext(null, null);
            Bridge.listener = listener;
            Bridge.port = port;
            Bridge.pendingAccept = pendingAccept;
            instanceRegister(port);
            plog("listening on http://localhost:" + port + "/ v" + VERSION
                + (port !== wanted ? " (default port busy, auto-picked)" : ""));
            return true;
        } catch (e) {
            try { if (listener != null) listener.Close(); } catch (closeError) { }
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
    ms.Position = 0;
    var sr = new CS.System.IO.StreamReader(ms);
    var s = sr.ReadToEnd();
    sr.Close();
    return s;
}

function writeResponse(ctx, status, obj) {
    try {
        var resp = ctx.Response;
        var body = JSON.stringify(obj);
        resp.StatusCode = status;
        resp.ContentType = "application/json; charset=utf-8";
        resp.Headers.Set("Access-Control-Allow-Origin", "*");
        // no ContentLength64 => chunked; avoids Encoding.GetBytes whose
        // string overload is stripped in the editor's Unity runtime
        var sw = new CS.System.IO.StreamWriter(resp.OutputStream);
        sw.Write(body);
        sw.Flush();
        sw.Close();
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
    // Discovery must remain responsive while an asynchronous publish is active.
    if (msg.cmd === "ping" || msg.cmd === "project_info") {
        try { writeResponse(ctx, 200, COMMANDS[msg.cmd](msg.args || {})); }
        catch (e) { writeResponse(ctx, 200, fail(msg.cmd + ": " + e)); }
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
            releasePublish(job, !job.done);
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
            releasePublish(job, true);
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
        var stack = e && e.stack ? " | " + String(e.stack).split("\n").slice(0, 4).join(" <- ") : "";
        result = fail(cmd + ": " + (e && e.message ? e.message : e) + stack);
    }
    writeResponse(next.ctx, 200, result);
}

function onUpdate() {
    if (Bridge.destroyed) return;
    // Start/restart the server here, never from the onProjectOpened callback
    // (see the startup model note in the header comment).
    if (Bridge.wantServer) {
        Bridge.wantServer = false;
        try { startServer(); } catch (e) { plog("startServer failed: " + e); }
    }
    if (Bridge.listener == null) return;
    pumpAccepts();
    stepQueue();
}

function boot() {
    // keep the frame loop (and thus the HTTP pump) running when the editor
    // window loses focus or is minimized - without this Unity pauses
    try { CS.UnityEngine.Application.runInBackground = true; } catch (e) {
        plog("runInBackground not settable: " + e);
    }
    Bridge.wantServer = App.project != null;
    App.add_onProjectOpened(onProjectOpened);
    App.add_onProjectClosed(onProjectClosed);
    App.add_onUpdate(onUpdate);
    // convenience menu item
    try {
        var toolMenu = App.menu.GetSubMenu("tool");
        Bridge.toolMenu = toolMenu;
        toolMenu.AddItem("Agent bridge: restart server", "agentbridge_restart", function () {
            if (Bridge.current != null) {
                plog('restart deferred: a command is still running');
                return;
            }
            stopServer();
            Bridge.wantServer = true; // picked up on the next frame tick
        });
    } catch (e) {
        plog("menu hook skipped: " + e);
    }
}

function onProjectOpened() {
    if (!Bridge.destroyed) Bridge.wantServer = true;
}

function onProjectClosed() {
    stopServer();
}

function stopServer() {
    Bridge.wantServer = false;
    if (Bridge.current != null) {
        var job = Bridge.current;
        Bridge.current = null;
        releasePublish(job, true);
        writeResponse(job.ctx, 503, fail("project closed or bridge stopped"));
    }
    var queued = Bridge.queue;
    Bridge.queue = [];
    for (var i = 0; i < queued.length; i++) {
        writeResponse(queued[i].ctx, 503, fail("project closed or bridge stopped"));
    }
    instanceUnregister();
    var listener = Bridge.listener;
    Bridge.listener = null;
    Bridge.pendingAccept = null;
    Bridge.port = undefined;
    try { if (listener != null) listener.Close(); } catch (e) { }
}

function onDestroy() {
    if (Bridge.destroyed) return;
    Bridge.destroyed = true;
    // Unhook native delegates before the host disposes this plugin's JS env.
    try { App.remove_onUpdate(onUpdate); } catch (e) { }
    try { App.remove_onProjectOpened(onProjectOpened); } catch (e) { }
    try { App.remove_onProjectClosed(onProjectClosed); } catch (e) { }
    try {
        if (Bridge.toolMenu != null) Bridge.toolMenu.RemoveItem("agentbridge_restart");
    } catch (e) { }
    Bridge.toolMenu = null;
    stopServer();
}

// Puerts loads this file as a CommonJS module; lifecycle hooks must be exported.
exports.onDestroy = onDestroy;
boot();
