"""Compare generated pixel masks with a locally installed FairyGUI editor.

Runs the editor only on a temporary project copy and terminates that process.
Usage: python standalone/test_editor_pixel_outputs.py PROJECT EDITOR_EXE [--pattern]
"""
import json
import os
from pathlib import Path
import random
import shutil
import subprocess
import sys
import tempfile
import time

from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'standalone'))
from pixel_hits import make_pixel_mask
from published import inspect
from test_full_reference import compare_packages


def run(project, editor, pattern=False):
    repo = Path(__file__).resolve().parent.parent
    with tempfile.TemporaryDirectory(prefix='fgui-pixel-editor-') as temp:
        root = Path(temp) / 'project'
        (root / 'assets').mkdir(parents=True)
        shutil.copytree(project / 'assets' / 'HitTest', root / 'assets' / 'HitTest')
        descriptor = next(project.glob('*.fairy'))
        shutil.copy2(descriptor, root / descriptor.name)
        plugin = root / 'plugins' / 'agent-bridge'
        plugin.mkdir(parents=True)
        for name in ('main.js', 'package.json'):
            shutil.copy2(repo / 'plugin' / name, plugin / name)
        def node_call(command, args):
            result = subprocess.run(['node', str(repo / 'standalone-node' / 'fgui.mjs'), command, json.dumps(args)], capture_output=True, text=True, encoding='utf-8', timeout=90, check=True)
            response = json.loads(result.stdout)
            if not response.get('ok'): raise RuntimeError(f'{command} failed: {response}')
            return response['data']
        for name in ('button1', 'button2', 'button3'):
            args = {'project': str(root), 'pkg': 'HitTest', 'name': name}
            revision = node_call('read_component', args)['sha256']
            revision = node_call('set_properties', {**args, 'target':'n1', 'props':{'forHitTest':False}, 'expected_sha256':revision})['sha256']
            node_call('set_properties', {**args, 'target':'n1', 'props':{'forHitTest':True}, 'expected_sha256':revision})
        if pattern:
            rng = random.Random(78)
            for name in ('0.png', '1.png', '2.png'):
                target = root / 'assets' / 'HitTest' / name
                with Image.open(target) as original:
                    image = Image.new('RGBA', original.size)
                image.putdata([(1, 2, 3, rng.choice((0, 5, 10, 11, 20, 255))) for _ in range(image.width * image.height)])
                image.save(target)
        output = Path(temp) / 'out'
        output.mkdir()
        startup = None
        if os.name == 'nt':
            startup = subprocess.STARTUPINFO()
            startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startup.wShowWindow = 0
        process = subprocess.Popen([str(editor), str(root / descriptor.name)], cwd=editor.parent, startupinfo=startup, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            args = {'project': str(root), 'pkg': 'HitTest'}
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                if process.poll() is not None: raise RuntimeError('editor exited before bridge was ready')
                result = subprocess.run(['node', str(repo / 'cli' / 'fgui.mjs'), 'list-items', json.dumps(args)], capture_output=True, text=True, timeout=8)
                if result.returncode == 0 and json.loads(result.stdout).get('ok'): break
                time.sleep(1)
            else: raise RuntimeError('editor bridge did not become ready')
            result = subprocess.run(['node', str(repo / 'cli' / 'fgui.mjs'), 'publish', json.dumps({**args, 'out_path': str(output), 'timeout_ms': 25000})], capture_output=True, text=True, timeout=35, check=True)
            response = json.loads(result.stdout)
            if not response.get('ok') or not response['data']['isSuccess']: raise RuntimeError('editor publish failed: ' + result.stdout)
            package = inspect((output / 'HitTest.bin').read_bytes())
            report = node_call('validate_published', {'project':str(root),'file':str(output / 'HitTest.bin'),'compare_components':True,'exported_only':True})
            if not report['valid']: raise RuntimeError(f'Node validation of editor pixel package failed: {report["issues"]}')
            node_args = {'project': str(root), 'pkg': 'HitTest', 'output': str(Path(temp) / 'node-out'), 'exported_only': True}
            node_run = subprocess.run(['node', str(repo / 'standalone-node' / 'fgui.mjs'), 'publish_basic_experimental', json.dumps(node_args)], capture_output=True, text=True, timeout=90, check=True)
            node_result = json.loads(node_run.stdout)
            if not node_result.get('ok'): raise RuntimeError('Node publication failed: ' + node_run.stdout)
            node_package = inspect(Path(node_result['data']['file']).read_bytes())
            differences = compare_packages(node_package, package)
            items = {item['id']: item for item in package['items']}
            results = []
            for hit in package['hitTests']:
                image_file = root / 'assets' / 'HitTest' / (items[hit['id']]['name'] + '.png')
                with Image.open(image_file) as source:
                    generated = make_pixel_mask(source.convert('RGBA'))
                same = generated['width'] == hit['width'] and generated['divisor'] == hit['divisor'] and generated['pixels'].hex() == hit['pixels']
                results.append({'id': hit['id'], 'matches_editor': same, 'width': hit['width'], 'divisor': hit['divisor']})
            if len(results) != 3: raise RuntimeError('expected three pixel masks from sample')
            return {'pattern': pattern, 'results': results, 'differences': differences, 'all_match': not differences and all(item['matches_editor'] for item in results)}
        finally:
            if process.poll() is None:
                process.terminate()
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired: process.kill(); process.wait()


if __name__ == '__main__':
    report = run(Path(sys.argv[1]), Path(sys.argv[2]), '--pattern' in sys.argv[3:])
    print(json.dumps(report, ensure_ascii=False))
    sys.exit(0 if report['all_match'] else 1)
