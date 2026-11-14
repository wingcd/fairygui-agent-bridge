"""Build a temporary Cocos demo with offline packages and exercise its real web runtime.

This is an optional integration probe, not part of the default unittest suite.
It requires Cocos Creator 3.8, its demo project, the locally built fairygui-cc
distribution, Chrome, Python Playwright and Pillow. The source demo is not edited.
"""
import argparse
import base64
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from threading import Thread
from urllib.parse import urlsplit

from fgui import execute
from published import inspect


def successful_build(exit_code, log, has_index):
    if 'build success' not in log or not has_index:
        return False
    errors = [line for line in log.splitlines() if re.search(r'\berror:', line, re.IGNORECASE)]
    if not errors:
        return exit_code == 0
    known = all('[BABEL]' in line and 'deoptimised the styling' in line and 'exceeds the max of 500KB' in line for line in errors)
    return exit_code in (0, 36) and known


PROBE = '''    onLoad() {
        dynamicAtlasManager.enabled = false;
        profiler.hideStats();
        fgui.UIConfig.enableDelayLoad = false;
        (window as any).__fguiProbe = {phase: 'loading', packages: [], components: [], rendered: [], errors: []};
        const state = (window as any).__fguiProbe;
        const names = PACKAGE_NAMES;
        const packages: fgui.UIPackage[] = [];
        const load = (index: number) => {
            if (index >= names.length) { construct(); return; }
            fgui.UIPackage.loadPackage('UI/' + names[index], (error: any, pkg: fgui.UIPackage) => {
                if (error || !pkg) { state.errors.push({package: names[index], error: String(error)}); load(index + 1); return; }
                state.packages.push(names[index]); packages.push(pkg); load(index + 1);
            });
        };
        const construct = () => {
            state.phase = 'constructing';
            const tasks: {pkg: fgui.UIPackage, item: fgui.PackageItem}[] = [];
            for (const pkg of packages)
                for (const item of pkg.getAllItems())
                    if (item.type === fgui.PackageItemType.Component) tasks.push({pkg, item});
            const next = (index: number) => {
                if (index >= tasks.length) {
                    (window as any).__fguiShow = (name: string, id: string) => {
                        profiler.hideStats();
                        const pkg = packages.find(value => value.name === name);
                        if (!pkg) throw new Error('package not loaded: ' + name);
                        const item = pkg.getItemById(id);
                        if (!item) throw new Error('component not found: ' + id);
                        fgui.GRoot.inst.removeChildren(0, -1, true);
                        const obj = pkg.internalCreateObject(item);
                        if (!obj) throw new Error('null component: ' + id);
                        fgui.GRoot.inst.addChild(obj);
                        // Snapshot the authored initial state, rather than
                        // comparing unrelated animation times across reloads.
                        const freeze = (child: fgui.GObject) => {
                            if (child instanceof fgui.GMovieClip || child instanceof fgui.GLoader)
                                child.playing = false;
                            if (child instanceof fgui.GComponent) {
                                for (const transition of ((child as any)._transitions || []))
                                    transition.stop(false, false);
                                for (let i = 0; i < child.numChildren; i++) freeze(child.getChildAt(i));
                            }
                        };
                        freeze(obj);
                    };
                    // Compare each controller page in an independently
                    // constructed component, with gear tweens disabled so the
                    // result describes the settled state rather than timing.
                    (window as any).__fguiControllerStates = (name: string, id: string) => {
                        const pkg = packages.find(value => value.name === name);
                        const item = pkg && pkg.getItemById(id);
                        if (!pkg || !item) throw new Error('component not found: ' + name + '/' + id);
                        const prior = fgui.GearBase.disableAllTweenEffect;
                        fgui.GearBase.disableAllTweenEffect = true;
                        const snapshot = (obj: fgui.GObject): any => {
                            const value: any = {name: obj.name, x: obj.x, y: obj.y,
                                width: obj.width, height: obj.height, scaleX: obj.scaleX, scaleY: obj.scaleY,
                                alpha: obj.alpha, rotation: obj.rotation, visible: obj.visible,
                                finalVisible: obj._finalVisible,
                                grayed: obj.grayed, touchable: obj.touchable, text: obj.text, icon: obj.icon};
                            const color = (obj as any).color;
                            if (color && typeof color.r === 'number') value.color = [color.r, color.g, color.b, color.a];
                            if (obj instanceof fgui.GComponent) {
                                value.children = [];
                                for (let i = 0; i < obj.numChildren; i++) value.children.push(snapshot(obj.getChildAt(i)));
                            }
                            return value;
                        };
                        try {
                            const prototype = pkg.internalCreateObject(item) as fgui.GComponent;
                            const controllers: any[] = [];
                            const collect = (component: fgui.GComponent, path: number[]) => {
                                const items = (component as any)._controllers || [];
                                for (let index = 0; index < items.length; index++) {
                                    const c: fgui.Controller = items[index];
                                    controllers.push({path, index, name: c.name, pages: Array.from({length: c.pageCount}, (_, i) => c.getPageId(i))});
                                }
                                for (let i = 0; i < component.numChildren; i++) {
                                    const child = component.getChildAt(i);
                                    if (child instanceof fgui.GComponent) collect(child, path.concat(i));
                                }
                            };
                            collect(prototype, []);
                            prototype.dispose();
                            const states: any[] = [];
                            for (let c = 0; c < controllers.length; c++)
                                for (let p = 0; p < controllers[c].pages.length; p++) {
                                    const obj = pkg.internalCreateObject(item) as fgui.GComponent;
                                    try {
                                        let owner = obj;
                                        for (const index of controllers[c].path) owner = owner.getChildAt(index) as fgui.GComponent;
                                        const controller = owner.getControllerAt(controllers[c].index);
                                        if (!controller) throw new Error('controller not found: ' + controllers[c].name);
                                        controller.selectedIndex = p;
                                        states.push({path: controllers[c].path, controller: controllers[c].name, page: controllers[c].pages[p], tree: snapshot(obj)});
                                    } finally { obj.dispose(); }
                                }
                            return {controllers, states};
                        } finally { fgui.GearBase.disableAllTweenEffect = prior; }
                    };
                    if (tasks.length) {
                        const first = tasks[0];
                        fgui.GRoot.inst.addChild(first.pkg.internalCreateObject(first.item));
                    }
                    state.phase = 'done';
                    return;
                }
                const {pkg, item} = tasks[index];
                try {
                    const obj = pkg.internalCreateObject(item);
                    if (!obj) throw new Error('null object');
                    fgui.GRoot.inst.addChild(obj);
                    const entry = {package: pkg.name, id: item.id, name: item.name};
                    state.components.push(entry);
                    requestAnimationFrame(() => requestAnimationFrame(() => {
                        state.rendered.push(entry);
                        obj.dispose();
                        next(index + 1);
                    }));
                } catch (e) {
                    state.errors.push({package: pkg.name, item: item.id, error: String(e)});
                    next(index + 1);
                }
            };
            next(0);
        };
        load(0);
    }
'''


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
    def copyfile(self, source, output):
        try: super().copyfile(source, output)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError): pass


def count_screenshot_differences(offline_png, reference_png):
    """Count pixels whose largest RGB difference exceeds one, rejecting size changes."""
    from PIL import Image, ImageChops
    with Image.open(io.BytesIO(offline_png)) as left, Image.open(io.BytesIO(reference_png)) as right:
        if left.size != right.size:
            raise ValueError(f'screenshot dimensions differ: {left.size} versus {right.size}')
        diff = ImageChops.difference(left.convert('RGB'), right.convert('RGB'))
        red, green, blue = diff.split()
        maximum = ImageChops.lighter(ImageChops.lighter(red, green), blue)
        return sum(maximum.histogram()[2:])


@contextmanager
def temporary_workspace():
    """Do not lose a successful report if an editor subprocess holds a file open."""
    path = Path(tempfile.mkdtemp(prefix='fgui-real-cocos-'))
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)
        if path.exists():
            print(f'Warning: temporary workspace could not be fully removed: {path}', file=sys.stderr)


def run(demo, distribution, creator, chrome, screenshot=None, compare_reference=False, comparison_output=None, settle_ms=750, compare_controller_states=False):
    if type(settle_ms) is not int or not 0 <= settle_ms <= 5000: raise ValueError('settle_ms must be between 0 and 5000')
    if compare_controller_states and not compare_reference: raise ValueError('controller state comparison requires reference comparison')
    from PIL import Image
    from playwright.sync_api import sync_playwright
    if comparison_output:
        destination = Path(comparison_output).absolute()
        if not compare_reference or destination.exists() or not destination.parent.is_dir():
            raise ValueError('comparison output must be a new directory with an existing parent and requires reference comparison')
    with temporary_workspace() as temp:
        project = temp / 'demo'
        project.mkdir()
        for name in ('assets', 'settings', 'profiles', 'preview-template'):
            if (demo / name).is_dir(): shutil.copytree(demo / name, project / name)
        for name in ('package.json', 'tsconfig.json'):
            shutil.copy2(demo / name, project / name)
        lib = project / 'node_modules' / 'fairygui-cc'
        lib.mkdir(parents=True)
        shutil.copy2(distribution / 'package.json', lib / 'package.json')
        shutil.copytree(distribution / 'dist', lib / 'dist')
        output = temp / 'published'
        result = execute('publish_project_experimental', {'project': str(demo / 'UIProject'), 'output': str(output)})
        ui = project / 'assets' / 'resources' / 'UI'
        expected = set()
        for record in result['packages']:
            package_dir = output / record['package']
            decoded = inspect((output / record['file']).read_bytes())
            expected.update((decoded['name'], item['id']) for item in decoded['items'] if item['type'] == 3)
            for file in package_dir.iterdir():
                if file.is_file(): shutil.copy2(file, ui / file.name)
        script = project / 'assets' / 'script' / 'demo' / 'MainMenu.ts'
        code = script.read_text(encoding='utf8')
        start, end = code.index('    onLoad() {'), code.index('\n    onUILoaded()')
        names = [record['package'] for record in result['packages']]
        script.write_text('import { profiler } from "cc";\n' + code[:start] + PROBE.replace('PACKAGE_NAMES', json.dumps(names)) + code[end:], encoding='utf8')
        startup = None
        if os.name == 'nt':
            startup = subprocess.STARTUPINFO()
            startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startup.wShowWindow = 0
        try:
            with (temp / 'build.log').open('w', encoding='utf8') as log:
                build = subprocess.run([str(creator), '--project', str(project), '--build', 'platform=web-mobile;debug=true'], stdout=log, stderr=subprocess.STDOUT, startupinfo=startup, timeout=600)
        except subprocess.TimeoutExpired as error:
            tail = (temp / 'build.log').read_text(encoding='utf8', errors='replace')[-4000:]
            raise RuntimeError(f'Cocos build timed out after 600 seconds: {tail}') from error
        build_log = (temp / 'build.log').read_text(encoding='utf8', errors='replace')
        web = project / 'build' / 'web-mobile'
        # Creator may exit nonzero after logging Babel's large-file note as an
        # error even though its build task reports success. Runtime is checked below.
        if not successful_build(build.returncode, build_log, (web / 'index.html').is_file()):
            raise RuntimeError(f'Cocos build failed (exit {build.returncode}): {build_log[-4000:]}')
        server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(web)))
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True, executable_path=str(chrome), args=['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'])
                try:
                    page = browser.new_page(viewport={'width': 1000, 'height': 700})
                    errors = []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
                    page.route('**/favicon.ico', lambda route: route.fulfill(status=204))
                    page.goto(f'http://127.0.0.1:{server.server_port}/', wait_until='load', timeout=60000)
                    page.wait_for_function("window.__fguiProbe && window.__fguiProbe.phase === 'done'", timeout=120000)
                    page.wait_for_timeout(8000)  # Give asynchronous texture loads and rendering time to finish.
                    cdp = page.context.new_cdp_session(page)
                    def capture():
                        return base64.b64decode(cdp.send('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False})['data'])
                    state = page.evaluate('window.__fguiProbe')
                    actual = [(item['package'], item['id']) for item in state['components']]
                    rendered = [(item['package'], item['id']) for item in state['rendered']]
                    if state['errors'] or errors or set(actual) != expected or len(actual) != len(expected) or set(rendered) != expected or len(rendered) != len(expected) or set(state['packages']) != set(names):
                        raise RuntimeError('Cocos runtime validation failed: ' + json.dumps({'state_errors': state['errors'], 'browser_errors': errors, 'missing': sorted(expected - set(actual)), 'unexpected': sorted(set(actual) - expected), 'not_rendered': sorted(expected - set(rendered))}, ensure_ascii=False))
                    pixels = capture()
                    with Image.open(io.BytesIO(pixels)).convert('RGB') as image:
                        colors = image.getcolors(maxcolors=256)
                        if colors is not None and len(colors) < 100: raise RuntimeError('rendered canvas has too few distinct colors')
                    if screenshot: Path(screenshot).write_bytes(pixels)
                    build_diagnostics = [line.strip() for line in build_log.splitlines() if any(word in line.lower() for word in ('error', 'warn', 'babel'))]
                    build_errors = [line.strip() for line in build_log.splitlines() if re.search(r'\berror:', line, re.IGNORECASE)]
                    report = {'packages': len(names), 'components': len(actual), 'rendered_components': len(rendered), 'screenshot_component': state['components'][0], 'browser_errors': errors, 'build_exit_code': build.returncode, 'build_errors': build_errors[-20:], 'build_diagnostics': build_diagnostics[-20:], 'scope': 'real Cocos web runtime preloads all selected packages and attaches each component for two animation frames; no exhaustive interaction testing'}
                    if compare_reference:
                        reference_ui = demo / 'assets' / 'resources' / 'UI'
                        reference_items, overrides, required_assets = set(), {}, set()
                        for name in names:
                            reference_file = reference_ui / (name + '.bin')
                            if not reference_file.is_file(): continue
                            decoded = inspect(reference_file.read_bytes())
                            reference_items.update((decoded['name'], item['id']) for item in decoded['items'] if item['type'] == 3)
                            required_assets.add(reference_file)
                            for item in decoded['items']:
                                if item['type'] == 4 and item.get('file'):
                                    required_assets.add(reference_ui / (name + '_' + item['file']))
                        for meta in reference_ui.glob('*.meta'):
                            source = meta.with_suffix('')
                            if not source.is_file(): continue
                            try: uuid = json.loads(meta.read_text(encoding='utf8'))['uuid']
                            except (ValueError, KeyError): continue
                            overrides[uuid + source.suffix.lower()] = source
                        common = sorted(expected & reference_items)
                        if not common: raise RuntimeError('no components shared with historical published packages')
                        if not required_assets.issubset(set(overrides.values())):
                            raise RuntimeError('historical binary or atlas lacks a matching asset and metadata: ' + str(sorted(map(str, required_assets - set(overrides.values())))))
                        async_frame = "() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
                        offline_images, offline_states, pending_fonts = {}, {}, []
                        for name, ident in common:
                            page.evaluate('([name,id]) => window.__fguiShow(name,id)', [name, ident])
                            page.evaluate(async_frame)
                            if settle_ms: page.wait_for_timeout(settle_ms)
                            if page.evaluate('document.fonts.status') != 'loaded': pending_fonts.append({'package': name, 'id': ident, 'version': 'offline'})
                            offline_images[(name, ident)] = capture()
                            if compare_controller_states:
                                offline_states[(name, ident)] = page.evaluate('([name,id]) => window.__fguiControllerStates(name,id)', [name, ident])
                        replaced = set()
                        def use_reference(route):
                            source = overrides.get(Path(urlsplit(route.request.url).path).name)
                            if source:
                                replaced.add(source)
                                route.fulfill(path=str(source))
                            else: route.continue_()
                        page.route('**/assets/resources/native/**', use_reference)
                        page.reload(wait_until='load', timeout=60000)
                        page.wait_for_function("window.__fguiProbe && window.__fguiProbe.phase === 'done'", timeout=120000)
                        page.wait_for_timeout(1000)
                        reference_state = page.evaluate('window.__fguiProbe')
                        if reference_state['errors'] or errors: raise RuntimeError('historical runtime errors: ' + json.dumps({'state': reference_state['errors'], 'browser': errors}, ensure_ascii=False))
                        if not required_assets.issubset(replaced):
                            raise RuntimeError('historical assets were not requested: ' + str(sorted(map(str, required_assets - replaced))))
                        differences, state_differences, state_count = [], [], 0
                        comparison_dir = None
                        if comparison_output:
                            comparison_dir = Path(comparison_output).absolute()
                            comparison_dir.mkdir(exist_ok=False)
                        for name, ident in common:
                            page.evaluate('([name,id]) => window.__fguiShow(name,id)', [name, ident])
                            page.evaluate(async_frame)
                            if settle_ms: page.wait_for_timeout(settle_ms)
                            if page.evaluate('document.fonts.status') != 'loaded': pending_fonts.append({'package': name, 'id': ident, 'version': 'historical'})
                            reference_pixels = capture()
                            if compare_controller_states:
                                reference_states = page.evaluate('([name,id]) => window.__fguiControllerStates(name,id)', [name, ident])
                                offline_state = offline_states[(name, ident)]
                                state_count += len(offline_state['states'])
                                if offline_state != reference_states:
                                    state_differences.append({'package': name, 'id': ident, 'offline': offline_state, 'historical': reference_states})
                            changed = count_screenshot_differences(offline_images[(name, ident)], reference_pixels)
                            if changed:
                                entry = {'package': name, 'id': ident, 'pixels_over_one': changed}
                                if comparison_dir:
                                    stem = f'{len(differences) + 1:04d}'
                                    offline_path, reference_path = comparison_dir / (stem + '_offline.png'), comparison_dir / (stem + '_historical.png')
                                    offline_path.write_bytes(offline_images[(name, ident)])
                                    reference_path.write_bytes(reference_pixels)
                                    entry.update(offline_image=str(offline_path), historical_image=str(reference_path))
                                differences.append(entry)
                        if errors: raise RuntimeError('browser errors during screenshot comparison: ' + json.dumps(errors, ensure_ascii=False))
                        report['historical_comparison'] = {'compared': len(common), 'different': differences, 'only_offline': len(expected - reference_items), 'only_historical': len(reference_items - expected), 'settle_ms': settle_ms, 'pending_fonts': pending_fonts, 'scope': 'initial-state screenshots with movieclips, loaders and transitions paused; differences above one RGB level; historical assets may differ from current source'}
                        if compare_controller_states:
                            report['controller_comparison'] = {'components': len(common), 'offline_page_states': state_count, 'different': state_differences, 'scope': 'root and nested controllers independently switched through each page with gear tweens disabled; compares component property trees, not rendered frames or user input; historical assets may differ from current source'}
                    return report
                finally:
                    browser.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--demo', type=Path, required=True)
    parser.add_argument('--distribution', type=Path, required=True, help='fairygui-cc source directory containing package.json and dist')
    parser.add_argument('--creator', type=Path, required=True)
    parser.add_argument('--chrome', type=Path, required=True)
    parser.add_argument('--screenshot', type=Path)
    parser.add_argument('--compare-reference', action='store_true', help='also compare default-state screenshots with historical demo assets')
    parser.add_argument('--comparison-output', type=Path, help='new directory for screenshot pairs with differences; requires --compare-reference')
    parser.add_argument('--compare-controller-states', action='store_true', help='compare controller page state trees with historical packages; requires --compare-reference')
    parser.add_argument('--settle-ms', type=int, default=750, help='wait per component before each reference screenshot (0..5000; default 750)')
    args = parser.parse_args()
    if args.comparison_output and not args.compare_reference: parser.error('--comparison-output requires --compare-reference')
    if args.compare_controller_states and not args.compare_reference: parser.error('--compare-controller-states requires --compare-reference')
    print(json.dumps(run(args.demo, args.distribution, args.creator, args.chrome, args.screenshot, args.compare_reference, args.comparison_output, args.settle_ms, args.compare_controller_states), ensure_ascii=False, indent=2))
