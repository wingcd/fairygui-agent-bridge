// FairyGUI Agent Bridge: per-editor local file queues, serviced on the editor
// frame thread. No socket reads or writes run inside FairyGUI.
// Never query System.Diagnostics.Process in the stripped editor runtime.

var VERSION = "0.4.0";

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
    locks: [],
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
    var result = {
        version: VERSION,
        editor: "FairyGUI",
        port: Bridge.port,
        projectPath: projectDirectory(),
        projectOpen: App.project != null,
        project: projectLabel()
    };
    try { result.runInBackground = !!CS.UnityEngine.Application.runInBackground; } catch (e) { }
    return ok(result);
};

// Leases span multiple calls. All checks and mutations run on the editor thread.
function liveLocks() {
    var now = Date.now();
    Bridge.locks = Bridge.locks.filter(function (lock) { return lock.expiresAt > now; });
    return Bridge.locks;
}
function lockScope(a) {
    if (!a.pkg || !a.name) throw "pkg and name required for component lock";
    return String(getPkg(a.pkg).id) + ":" + String(a.name);
}
COMMANDS.acquire_lock = function (a) {
    var scope = a.scope === "project" ? "project" : (a.scope === "component" ? lockScope(a) : null);
    if (!scope) throw "scope must be project or component";
    var locks = liveLocks();
    for (var i = 0; i < locks.length; i++)
        if (scope === "project" || locks[i].scope === "project" || locks[i].scope === scope)
            throw "lock conflict: " + locks[i].scope;
    var duration = Number(a.lease_ms || 300000);
    if (!isFinite(duration) || duration < 1000 || duration > 3600000) throw "lease_ms must be between 1000 and 3600000";
    var token = String(CS.System.Guid.NewGuid().ToString("N"));
    var lock = {scope:scope, token:token, expiresAt:Date.now() + duration, owner:a.owner ? String(a.owner) : null};
    locks.push(lock);
    return ok(lock);
};
COMMANDS.release_lock = function (a) {
    var locks = liveLocks();
    for (var i = 0; i < locks.length; i++) if (locks[i].token === a.lock_token) {
        locks.splice(i, 1); return ok({released:true});
    }
    throw "lock not found or expired";
};
function checkLocks(cmd, a) {
    var reads = {ping:1, project_info:1, operation_status:1, list_packages:1, list_items:1,
        read_component:1, export_strings:1, screenshot:1, bridge_log:1, acquire_lock:1, release_lock:1};
    if (reads[cmd]) return;
    var componentCommands = {create_component:1, delete_item:1, open_doc:1, close_doc:1,
        list_children:1, insert_object:1, set_property:1, remove_object:1};
    var scope = componentCommands[cmd] ? lockScope(a) : "project";
    var locks = liveLocks();
    var valid = !a.lock_token;
    for (var i = 0; i < locks.length; i++) {
        var lock = locks[i];
        if (lock.token === a.lock_token && (lock.scope === "project" || lock.scope === scope)) valid = true;
        if ((scope === "project" || lock.scope === "project" || lock.scope === scope) &&
            (lock.token !== a.lock_token || (scope === "project" && lock.scope !== "project")))
            throw "lock conflict: " + lock.scope;
    }
    if (!valid) throw "lock token expired, invalid, or does not cover operation";
}

// Read directly during queue polling so a long-running publish cannot block status.
COMMANDS.operation_status = function () {
    var now = Date.now();
    function describe(job) {
        if (!job) return null;
        return { command: job.cmd, package: job.args.pkg || null,
            component: job.args.name || null, target: job.args.target || null,
            receivedAt: job.receivedAt, elapsedMs: now - job.receivedAt };
    }
    var pending = [];
    for (var i = 0; i < Bridge.queue.length; i++) {
        var item = Bridge.queue[i];
        if (typeof item.deadlineMs !== "number" || item.deadlineMs > now) pending.push(describe(item));
    }
    return ok({ busy: Bridge.current != null || pending.length > 0,
        publishing: Bridge.current != null && Bridge.current.cmd === "publish",
        current: describe(Bridge.current), queuedCount: pending.length, queue: pending, locks: liveLocks().map(function (l) { return {scope:l.scope, owner:l.owner, expiresAt:l.expiresAt}; }) });
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

// ---------------- file queue transport ----------------
// Each editor owns a private queue. Clients publish complete requests by atomic
// rename; this frame loop claims each file before executing it. No socket I/O is
// performed on the editor thread.
var InstancesDir = (function () {
    try { return CS.System.Environment.GetFolderPath(CS.System.Environment.SpecialFolder.UserProfile) + "/.fgui-agent-bridge/instances"; }
    catch (e) { return null; }
})();
function projectDirectory() {
    try { if (App.project && App.project.basePath) return String(App.project.basePath).replace(/\\/g, '/').replace(/\/$/, ''); } catch (e) { }
    return String(PluginDir).replace(/\\/g, '/').replace(/\/$/, '').split('/').slice(0, -2).join('/');
}
function projectLabel() { try { return App.project && App.project.name ? String(App.project.name) : ""; } catch (e) { return ""; } }
function startServer() {
    if (Bridge.destroyed || Bridge.instanceId) return false;
    if (!InstancesDir || !projectDirectory()) throw new Error("cannot determine project or registry path");
    var id = Date.now().toString(16) + Math.floor(Math.random() * 0x100000000).toString(16) + Math.floor(Math.random() * 0x100000000).toString(16);
    var root = InstancesDir + "/queue-" + id;
    CS.System.IO.Directory.CreateDirectory(root + "/requests");
    CS.System.IO.Directory.CreateDirectory(root + "/responses");
    PluginDir = projectDirectory() + "/plugins/agent-bridge";
    var tmp = InstancesDir + "/queue-" + id + ".tmp";
    CS.System.IO.File.WriteAllText(tmp, JSON.stringify({transport:"file", id:id, project:projectLabel(), projectPath:projectDirectory()}));
    CS.System.IO.File.Move(tmp, InstancesDir + "/queue-" + id + ".json");
    Bridge.instanceId = id;
    Bridge.queueRoot = root;
    plog("file queue started: " + id + " project=" + projectDirectory());
    return true;
}
function writeResponse(ctx, status, obj) {
    if (!ctx || !ctx.id || !Bridge.queueRoot) return;
    try {
        var target = Bridge.queueRoot + "/responses/" + ctx.id + ".json";
        var temp = target + ".tmp";
        CS.System.IO.File.WriteAllText(temp, JSON.stringify({status:status, result:obj}));
        CS.System.IO.File.Move(temp, target);
    } catch (e) { plog("file response failed: " + e); }
}
function pumpAccepts() {
    var dir = Bridge.queueRoot + "/requests";
    var files = CS.System.IO.Directory.GetFiles(dir, "*.json");
    var paths = [];
    for (var n = 0; n < files.Length; n++) paths.push(String(files.GetValue(n)));
    paths.sort();
    // Bound work per frame; atomic rename from the client means files are complete.
    for (var i = 0; i < paths.length && i < 8; i++) {
        var file = paths[i];
        var match = file.replace(/\\/g, '/').match(/\/([a-f0-9]{32})\.json$/);
        if (!match) continue;
        var claimed = file + ".claimed";
        try { CS.System.IO.File.Move(file, claimed); } catch (e) { continue; }
        try {
            var msg = JSON.parse(CS.System.IO.File.ReadAllText(claimed));
            if (!msg || !msg.cmd || typeof msg.deadlineMs !== "number" || Date.now() >= msg.deadlineMs) continue;
            var ctx = {id:match[1]};
            if (msg.cmd === "ping" || msg.cmd === "project_info" || msg.cmd === "operation_status") {
                try { writeResponse(ctx, 200, COMMANDS[msg.cmd](msg.args || {})); }
                catch (e) { writeResponse(ctx, 200, fail(msg.cmd + ": " + e)); }
            } else {
                Bridge.queue.push({ctx:ctx, cmd:String(msg.cmd), args:msg.args || {}, receivedAt:Date.now(), deadlineMs:msg.deadlineMs});
            }
        } catch (e) { plog("invalid queue request: " + e); }
        finally { try { CS.System.IO.File.Delete(claimed); } catch (e) {} }
    }
}
function stepQueue() {
    // finish the running async job first
    if (Bridge.current != null) {
        var job = Bridge.current;
        var out;
        try { out = ASYNC_STEPPERS[job.cmd](job); }
        catch (e) { out = fail(job.cmd + ": " + e); }
        if (out !== null && out !== undefined) {
            releasePublish(job, !job.done);
            writeResponse(job.ctx, 200, out, job.cmd, job.receivedAt);
            Bridge.current = null;
        }
        return; // one async job at a time
    }
    var next = Bridge.queue.shift();
    if (next == null) return;
    if (typeof next.deadlineMs === 'number' && isFinite(next.deadlineMs) && Date.now() >= next.deadlineMs) {
        // Expired before execution: never apply a stale command.
        return;
    }
    var cmd = next.cmd;
    try { checkLocks(cmd, next.args); }
    catch (e) { writeResponse(next.ctx, 200, fail(String(e))); return; }
    if (ASYNC_STARTERS[cmd]) {
        var job = { ctx: next.ctx, cmd: cmd, args: next.args, receivedAt: next.receivedAt };
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
    writeResponse(next.ctx, 200, result, cmd, next.receivedAt);
}

function onUpdate() {
    if (Bridge.destroyed) return;
    // Another editor component may reset the Unity player setting after boot.
    try {
        if (!CS.UnityEngine.Application.runInBackground) {
            CS.UnityEngine.Application.runInBackground = true;
            if (!Bridge.lastBackgroundWarning || Date.now() - Bridge.lastBackgroundWarning > 60000) {
                Bridge.lastBackgroundWarning = Date.now();
                plog("runInBackground had been reset; restored it");
            }
        }
    } catch (e) { }
    // Start/restart the server here, never from the onProjectOpened callback
    // (see the startup model note in the header comment).
    if (Bridge.wantServer) {
        Bridge.wantServer = false;
        try { startServer(); } catch (e) { plog("startServer failed: " + e); }
    }
    if (!Bridge.instanceId) return;
    try { pumpAccepts(); } catch (e) { plog("queue poll failed: " + e); }
    try { stepQueue(); } catch (e) { plog("queue execution failed: " + e); }

}

function boot() {
    // keep the frame loop (and thus the queue pump) running when the editor
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
        toolMenu.AddItem("Agent bridge: restart queue", "agentbridge_restart", function () {
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
    Bridge.locks = [];
    for (var i = 0; i < queued.length; i++) {
        writeResponse(queued[i].ctx, 503, fail("project closed or bridge stopped"));
    }
    if (Bridge.instanceId && InstancesDir) {
        try { CS.System.IO.File.Delete(InstancesDir + "/queue-" + Bridge.instanceId + ".json"); } catch (e) { }
    }
    Bridge.instanceId = null;
    Bridge.queueRoot = null;
    Bridge.port = undefined;
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
