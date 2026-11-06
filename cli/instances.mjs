import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

export const registryDir = path.join(os.homedir(), '.fgui-agent-bridge');
const lastCleanup = new Map();
async function cleanupQueue(root) {
    if (Date.now() - (lastCleanup.get(root) || 0) < 60000) return;
    lastCleanup.set(root, Date.now());
    for (const [dir, pattern] of [['requests', /\.(?:tmp|claimed)$/], ['responses', /\.(?:json|tmp)$/]]) {
        const folder = path.join(root, dir);
        let files;
        try { files = await fs.promises.readdir(folder); } catch { continue; }
        for (const name of files.sort().slice(0, 256)) {
            if (!/^[a-f0-9]{32}\.json(?:\.tmp|\.claimed)?$/.test(name) || !pattern.test(name)) continue;
            const file = path.join(folder, name);
            try {
                const stat = await fs.promises.lstat(file);
                if (stat.isFile() && Date.now() - stat.mtimeMs > 600000) await fs.promises.unlink(file);
            } catch {}
        }
    }
}
export function normalizeProject(value) {
    let p = path.resolve(String(value)).replace(/\\/g, '/').replace(/\/$/, '');
    if (/\.fairy$/i.test(p)) p = p.slice(0, p.lastIndexOf('/'));
    return process.platform === 'win32' ? p.toLowerCase() : p;
}
export async function request(url, cmd, args = {}, timeout = 5000) {
    const u = new URL(url);
    if (u.protocol === 'fgui-file:') {
        if (!/^[a-f0-9]{1,64}$/.test(u.hostname) || u.pathname !== '/' || u.search || u.hash)
            throw new Error('Invalid bridge queue identifier');
        const root = path.join(registryDir, 'instances', `queue-${u.hostname}`);
        await cleanupQueue(root);
        // Sortable timestamp preserves approximate arrival order across clients;
        // 80 random bits keep names independent across processes.
        const id = Date.now().toString(16).padStart(12, '0') + randomBytes(10).toString('hex');
        const requestPath = path.join(root, 'requests', `${id}.json`);
        const tempPath = `${requestPath}.tmp`;
        const responsePath = path.join(root, 'responses', `${id}.json`);
        const deadlineMs = Date.now() + timeout;
        try {
            await fs.promises.writeFile(tempPath, JSON.stringify({cmd, args, deadlineMs}), {flag:'wx'});
            await fs.promises.rename(tempPath, requestPath);
            while (Date.now() < deadlineMs) {
                try {
                    const response = JSON.parse(await fs.promises.readFile(responsePath, 'utf8'));
                    if (response.status !== 200) throw new Error(`Bridge HTTP ${response.status}: ${response.result?.error || ''}`);
                    return response.result;
                } catch (e) { if (e.code !== 'ENOENT') throw e; }
                await new Promise(resolve => setTimeout(resolve, 40));
            }
            throw new Error(`Bridge timed out after ${timeout} ms; a command already started may still complete`);
        } finally {
            await Promise.all([tempPath, requestPath, responsePath].map(p => fs.promises.unlink(p).catch(() => {})));
        }
    }
    if (!['http:', 'https:'].includes(u.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
        throw new Error('Bridge URL must be localhost');
    const r = await fetch(u, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({cmd, args, deadlineMs: Date.now() + timeout}), signal: AbortSignal.timeout(timeout)});
    if (!r.ok) throw new Error(`Bridge HTTP ${r.status}`);
    return r.json();
}
export async function discover({entries, fallback = process.env.FGUI_BRIDGE_URL || 'http://localhost:7531/'} = {}) {
    // A timeout can mean a busy editor, not a dead instance. Keep registrations
    // so later discoveries can find an editor that becomes responsive again.
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
                } catch {}
            }
        } catch {}
    }
    const urls = new Map(entries.map(e => [e.transport === 'file' && /^[a-f0-9]{1,64}$/.test(e.id || '') ? `fgui-file://${e.id}/` : e.url || `http://localhost:${e.port}/`, e]));
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
        return {url, port: ping.data.port || (new URL(url).port ? Number(new URL(url).port) : undefined), pid: ping.data.pid || e.pid,
            project: info.data.name || ping.data.project || e.project,
            projectPath,
            packageNames: info.data.packageNames || []};
    }));
    return results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
}
export function commandTimeout(cmd, args = {}) {
    const defaultMs = cmd === 'publish' ? 120000 : 45000;
    return Math.max(10000, (Number(args.timeout_ms) || defaultMs) + 5000);
}
export function selectInstance(instances, selector = {}) {
    let candidates = instances;
    if (selector.bridge_url) {
        const identity = value => { const url = new URL(value); return url.protocol === 'fgui-file:' ? url.href : url.origin; };
        candidates = candidates.filter(i => identity(i.url) === identity(selector.bridge_url));
    }
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
