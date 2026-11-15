"""Exercise every registered Cocos demo component on a temporary project copy.

Usage: python standalone/test_samples.py PATH_TO_UI_PROJECT
This is an offline structural round-trip, not an editor or runtime test.
"""
import json
from pathlib import Path
import shutil
import sys
import tempfile
import xml.etree.ElementTree as ET

from fgui import execute


def run(source):
    failures = []
    count = 0
    edited = 0
    with tempfile.TemporaryDirectory(prefix='fgui-samples-') as temp:
        root = Path(temp) / 'project'
        shutil.copytree(source, root)
        project = str(root)
        validation = execute('validate', {'project': project})
        if not validation['valid']:
            failures.extend(validation['issues'])
        for pkg in execute('list_packages', {'project': project}):
            for item in execute('list_items', {'project': project, 'pkg': pkg['id']}):
                if item['type'] != 'component':
                    continue
                count += 1
                args = {'project': project, 'pkg': pkg['id'], 'name': item['id']}
                try:
                    before = execute('read_component', args)
                    tree = ET.fromstring(before['xml'])
                    children = tree.findall('./displayList/*')
                    if not children:
                        continue
                    child = children[0]
                    child.set('xy', '123,456')
                    execute('set_properties', {**args, 'target': child.attrib['id'], 'props': {'xy': '123,456'}, 'expected_sha256': before['sha256']})
                    actual = ET.fromstring(execute('read_component', args)['xml'])
                    if ET.tostring(tree) != ET.tostring(actual):
                        raise ValueError('unexpected semantic change')
                    edited += 1
                except (ValueError, OSError, KeyError, ET.ParseError) as exc:
                    failures.append({'package': pkg['name'], 'component': item.get('name'), 'error': str(exc)})
    return {'components': count, 'edited': edited, 'failures': failures}


if __name__ == '__main__':
    result = run(Path(sys.argv[1]).resolve(strict=True))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(bool(result['failures']))
