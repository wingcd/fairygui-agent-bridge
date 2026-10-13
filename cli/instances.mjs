import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const registryDir = path.join(os.homedir(), '.fgui-agent-bridge');
export function normalizeProject(value) {
    let p = path.resolve(String(value)).replace(/\\/g, '/').replace(/\/$/, '');
    if (/\.fairy$/i.test(p)) p = p.slice(0, p.lastIndexOf('/'));
    return process.platform === 'win32' ? p.toLowerCase() : p;
}
export async function request(url, cmd, args = {}, timeout = 5000) {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
        throw new Error('Bridge URL must be localhost');
    const r = await fetch(u, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({cmd, args}), signal: AbortSignal.timeout(timeout)});
    if (!r.ok) throw new Error(`Bridge HTTP ${r.status}`);
    return r.json();
}
export async function discover({entries, fallback = process.env.FGUI_BRIDGE_URL || 'http://localhost:7531/'} = {}) {
    // When reading the on-disk registry we also prune it: the plugin removes
    // its own file on clean exit, but crashed/hung editors leave orphans.
    // Liveness is this HTTP ping only - never a PID probe (the editor build
    // crashes natively on System.Diagnostics.Process queries).
    const diskFiles = new Map(); // url -> [instance file paths]
    let registryFile = null, registryEntries = null;
    if (!entries) {
        entries = [];
        registryFile = path.join(registryDir, 'registry.json');
        try { registryEntries = JSON.parse(fs.readFileSync(registryFile, 'utf8')); } catch {}
        if (Array.isArray(registryEntries)) entries.push(...registryEntries);
        try {
            const dir = path.join(registryDir, 'instances');
            for (const file of fs.readdirSync(dir)) {
                if (!file.endsWith('.json')) continue;
                try {
                    const e = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
                    entries.push(e);
                    const url = e.url || `http://localhost:${e.port}/`;
                    if (!diskFiles.has(url)) diskFiles.set(url, []);
                    diskFiles.get(url).push(path.join(dir, file));
                } catch {}
            }
        } catch {}
    }
    const urls = new Map(entries.map(e => [e.url || `http://localhost:${e.port}/`, e]));
    if (fallback && !urls.has(fallback)) urls.set(fallback, {});
    const results = await Promise.allSettled([...urls].map(async ([url, e]) => {
        const ping = await request(url, 'ping');
        if (!ping.ok || !ping.data?.projectOpen) return null;
        const info = await request(url, 'project_info');
        if (!info.ok) return null;
        let projectPath = ping.data.projectPath || info.data.projectPath || info.data.path || e.projectPath;
        // Older plugins exposed package basePath but no project path.
        if (!projectPath) {
            const packages = await request(url, 'list_packages');
            const base = packages.data?.[0]?.basePath?.replace(/\\/g, '/');
            if (base?.includes('/assets/')) projectPath = base.slice(0, base.lastIndexOf('/assets/'));
        }
        return {url, port: ping.data.port || Number(new URL(url).port), pid: ping.data.pid || e.pid,
            project: info.data.name || ping.data.project || e.project,
            projectPath,
            packageNames: info.data.packageNames || []};
    }));
    const deadUrls = new Set([...urls.keys()].filter((_, i) => results[i].status === 'rejected'));
    // A registration is only stale once it has failed a ping well after the
    // editor could have armed its listener; young files get the benefit of
    // the doubt (the plugin registers after listener.Start()).
    const isOld = (file) => { try { return Date.now() - fs.statSync(file).mtimeMs > 30000; } catch { return false; } };
    for (const [url, files] of diskFiles)
        if (deadUrls.has(url)) for (const f of files) if (isOld(f)) try { fs.rmSync(f, {force: true}); } catch {}
    if (registryFile && Array.isArray(registryEntries)) {
        const live = registryEntries.filter(e => !deadUrls.has(e.url || `http://localhost:${e.port}/`));
        if (live.length !== registryEntries.length) try { fs.writeFileSync(registryFile, JSON.stringify(live)); } catch {}
    }
    return results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
}
export function selectInstance(instances, selector = {}) {
    let candidates = instances;
    if (selector.bridge_url) candidates = candidates.filter(i => new URL(i.url).origin === new URL(selector.bridge_url).origin);
    if (selector.port !== undefined) candidates = candidates.filter(i => i.port === Number(selector.port));
    if (selector.project) {
        const isPath = /[/\\]|\.fairy$/i.test(selector.project);
        candidates = candidates.filter(i => isPath
            ? i.projectPath && normalizeProject(i.projectPath) === normalizeProject(selector.project)
            : i.project === selector.project);
    }
    if (candidates.length !== 1) throw new Error(candidates.length
        ? 'Multiple matching FairyGUI projects: specify project (absolute path), port, or bridge_url'
        : 'Requested FairyGUI project is not online; no command was sent to another project');
    return candidates[0];
}
export async function route(selector = {}) {
    const explicit = selector.bridge_url || (selector.port !== undefined ? `http://localhost:${selector.port}/` : null);
    const instances = await discover({fallback: explicit || process.env.FGUI_BRIDGE_URL || undefined});
    // Explicit env preserves compatibility; project checks still apply.
    return selectInstance(instances, {...selector, bridge_url: explicit || (!selector.project ? process.env.FGUI_BRIDGE_URL : undefined)});
}
export function stripSelector(args) {
    const {project, port, bridge_url, ...editorArgs} = args;
    return editorArgs;
}
