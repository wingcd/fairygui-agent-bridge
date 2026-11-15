"""Verify Node-written Unicode separators survive a real editor open/export.

Usage: python test_editor_unicode_roundtrip.py SAMPLE_PROJECT FAIRYGUI_EDITOR_EXE
The editor and all writes use a temporary project copy.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path

from test_editor_roundtrip import invoke

REPO = Path(__file__).resolve().parent.parent
NODE = REPO / 'standalone-node' / 'fgui.mjs'
BRIDGE = REPO / 'cli' / 'fgui.mjs'


def run(source, editor):
    expected = 'A\u0085B\u2028C\u2029D'
    with tempfile.TemporaryDirectory(prefix='fgui-editor-unicode-') as temp:
        root = Path(temp) / 'project'
        shutil.copytree(source, root)
        plugin = root / 'plugins' / 'agent-bridge'
        plugin.mkdir(parents=True, exist_ok=True)
        for name in ('main.js', 'package.json'):
            shutil.copy2(REPO / 'plugin' / name, plugin / name)
        args = {'project': str(root), 'pkg': 'Bag', 'name': 'UnicodeRoundtrip'}
        package = next(item for item in invoke(NODE, 'list_packages', {'project': str(root)}) if item['name'] == 'Bag')
        created = invoke(NODE, 'create_component', {**args, 'width': 100, 'height': 50})
        expected_key = package['id'] + created['id'] + '-t'
        original = '<component size="100,50"><displayList><text id="t" name="label" xy="0,0" text="Initial"/></displayList></component>'
        written = invoke(NODE, 'write_component', {**args, 'xml': original, 'expected_sha256': created['sha256']})
        invoke(NODE, 'set_properties', {**args, 'target': 't', 'props': {'text': expected}, 'expected_sha256': written['sha256']})
        node_result = invoke(NODE, 'list_children', args)
        if node_result['children'][0]['attributes']['text'] != expected:
            raise AssertionError('Node did not read back the exact text')
        startup = None
        if os.name == 'nt':
            startup = subprocess.STARTUPINFO()
            startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startup.wShowWindow = 0
        process = subprocess.Popen([str(editor), str(next(root.glob('*.fairy')))], cwd=editor.parent, startupinfo=startup, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 75
            while True:
                if process.poll() is not None:
                    raise RuntimeError('editor exited before bridge was ready')
                try:
                    opened = invoke(BRIDGE, 'list-children', args, 8)
                    break
                except (RuntimeError, subprocess.SubprocessError, json.JSONDecodeError):
                    if time.monotonic() > deadline:
                        raise
                    time.sleep(2)
            if not any(child.get('name') == 'label' for child in opened['children']):
                raise AssertionError('editor did not open the Node-authored text')
            invoke(BRIDGE, 'close-doc', args)
            output = root / 'strings.xml'
            invoke(BRIDGE, 'export-strings', {'project': str(root), 'file': str(output)}, 60)
            entries = [(element.get('name'), element.text or '') for element in ET.parse(output).getroot().findall('string')]
            matches = [(key, text) for key, text in entries if key == expected_key and text == expected]
            if len(matches) != 1:
                raise AssertionError(f'editor export did not preserve the exact text: {matches}')
            return {'editor_opened': True, 'text_preserved': True, 'translation_key': matches[0][0]}
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)


if __name__ == '__main__':
    print(json.dumps(run(Path(sys.argv[1]), Path(sys.argv[2])), ensure_ascii=True))
