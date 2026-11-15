"""Opt-in editor interoperability test on a temporary copy of a project.

Launches and terminates only the editor process started by this script.
Usage: python standalone/test_editor_roundtrip.py PROJECT EDITOR_EXE [--all]
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

from fgui import execute


def run(source, editor, all_samples=False, only=None):
    repo = Path(__file__).resolve().parent.parent
    with tempfile.TemporaryDirectory(prefix='fgui-editor-test-') as temp:
        root = Path(temp) / 'project'
        shutil.copytree(source, root)
        plugins = root / 'plugins' / 'agent-bridge'
        plugins.mkdir(parents=True, exist_ok=True)
        for name in ('main.js', 'package.json'):
            shutil.copy2(repo / 'plugin' / name, plugins / name)
        created_items = []
        edited_samples = []
        skipped_samples = []
        for entry in execute('list_packages', {'project': str(root)}):
            package = entry['name']
            # Edit an existing component in each package as well as creating one.
            for item in execute('list_items', {'project': str(root), 'pkg': package}):
                if item['type'] != 'component': continue
                if only and (package, Path(item['name']).stem) != only: continue
                sample = {'project': str(root), 'pkg': package, 'name': item['id']}
                before = execute('read_component', sample)
                children = ET.fromstring(before['xml']).findall('./displayList/*')
                target = next((child for child in children if child.get('id') and child.tag != 'group'), None)
                if target is None:
                    skipped_samples.append(package + '/' + item['name'])
                    continue
                execute('set_properties', {**sample, 'target': target.get('id'), 'props': {'xy': '123,456'}, 'expected_sha256': before['sha256']})
                # The editor bridge resolves item names, not IDs.
                sample['name'] = Path(item['name']).stem
                edited_samples.append((sample, target.get('id')))
                if not all_samples: break
            common = {'project': str(root), 'pkg': package, 'name': 'OfflineRoundtripCheck'}
            created = execute('create_component', {**common, 'width': 123, 'height': 77, 'exported': True})
            updated = execute('insert_object', {**common, 'expected_sha256': created['sha256'], 'object_xml': '<text id="n0" name="label" xy="10,20" text="Offline test"/>'})
            updated = execute('set_properties', {**common, 'expected_sha256': updated['sha256'], 'target': 'n0', 'props': {'text': 'Edited offline', 'xy': '20,30'}})
            updated = execute('insert_object', {**common, 'expected_sha256': updated['sha256'], 'object_xml': '<graph id="n1" name="removed"/>'})
            execute('remove_object', {**common, 'expected_sha256': updated['sha256'], 'target': 'n1'})
            created_items.append(common)
        descriptor = next(root.glob('*.fairy'))
        startup = None
        if os.name == 'nt':
            startup = subprocess.STARTUPINFO(); startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW; startup.wShowWindow = 0
        process = subprocess.Popen([str(editor), str(descriptor)], cwd=Path(editor).parent, startupinfo=startup, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 45
            args = json.dumps(created_items[0])
            while time.monotonic() < deadline:
                if process.poll() is not None: raise RuntimeError('editor exited before bridge was ready')
                result = subprocess.run(['node', str(repo / 'cli' / 'fgui.mjs'), 'read-component', args], capture_output=True, text=True, timeout=8)
                if result.returncode == 0:
                    response = json.loads(result.stdout)
                    if response.get('ok') and 'Edited offline' in result.stdout:
                        for common in created_items:
                            opened = subprocess.run(['node', str(repo / 'cli' / 'fgui.mjs'), 'list-children', json.dumps(common)], capture_output=True, text=True, timeout=20, check=True)
                            details = json.loads(opened.stdout)
                            names = [x.get('name') for x in details.get('data', {}).get('children', [])]
                            if not details.get('ok') or names != ['label']:
                                raise RuntimeError('editor failed to load edited component: ' + opened.stdout)
                            subprocess.run(['node', str(repo / 'cli' / 'fgui.mjs'), 'close-doc', json.dumps(common)], capture_output=True, text=True, timeout=20, check=True)
                        failures = []
                        opened_count = 0
                        for sample, target_id in edited_samples:
                            try:
                                opened = subprocess.run(['node', str(repo / 'cli' / 'fgui.mjs'), 'list-children', json.dumps(sample)], capture_output=True, text=True, timeout=20, check=True)
                                details = json.loads(opened.stdout)
                                ids = [child.get('id') for child in details.get('data', {}).get('children', [])]
                                if not details.get('ok') or target_id not in ids:
                                    raise ValueError('edited child not loaded: ' + opened.stdout)
                                opened_count += 1
                                subprocess.run(['node', str(repo / 'cli' / 'fgui.mjs'), 'close-doc', json.dumps(sample)], capture_output=True, text=True, timeout=20, check=True)
                            except (ValueError, subprocess.SubprocessError) as exc:
                                detail = str(exc)
                                if isinstance(exc, subprocess.CalledProcessError): detail += ' stdout=' + (exc.stdout or '') + ' stderr=' + (exc.stderr or '')
                                failures.append({'package': sample['pkg'], 'component': sample['name'], 'error': detail})
                        return {'packages': len(created_items), 'editor_opened': True, 'child_loaded': True,
                                'edited_samples_opened': opened_count, 'skipped_samples': skipped_samples, 'failures': failures}
                time.sleep(2)
            raise RuntimeError('editor bridge did not read the temporary project before timeout')
        finally:
            if process.poll() is None:
                process.terminate()
                try: process.wait(timeout=10)
                except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=10)


if __name__ == '__main__':
    only_arg = next((arg[7:] for arg in sys.argv[3:] if arg.startswith('--only=')), None)
    only = tuple(only_arg.split('/', 1)) if only_arg else None
    if only is not None and len(only) != 2: raise ValueError('--only requires PACKAGE/COMPONENT')
    report = run(Path(sys.argv[1]), Path(sys.argv[2]), '--all' in sys.argv[3:], only)
    print(json.dumps(report, ensure_ascii=False))
    sys.exit(bool(report['failures']))
