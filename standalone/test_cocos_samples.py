"""Publish all exported sample packages and exercise Cocos' compiled readers.

The harness executes FairyGUI Cocos reader and component setup code with stubbed
engine objects. It does not render UI or exercise a real Cocos application.
Usage: python standalone/test_cocos_samples.py PROJECT COCOS_BUILD
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from fgui import execute
from published import inspect


def run(project, build):
    harness = Path(__file__).with_name('check_cocos_reader.cjs')
    report = {'passed': [], 'failed': []}
    with tempfile.TemporaryDirectory(prefix='fgui-cocos-samples-') as temp:
        output = Path(temp) / 'published'
        publication = execute('publish_project_experimental', {'project': str(project), 'output': str(output)})
        paths = {entry['id']: output / entry['file'] for entry in publication['packages']}
        for entry in publication['packages']:
            try:
                file = output / entry['file']
                expected = inspect(file.read_bytes())
                validation = execute('validate_published', {'project': str(project), 'file': str(file), 'compare_source': True, 'compare_components': True, 'check_overlaps': True, 'exported_only': True})
                if not validation['valid']: raise ValueError('source or atlas comparison failed: ' + json.dumps(validation, ensure_ascii=False)[:2000])
                dependencies = [str(paths[dep['id']]) for dep in entry['dependencies']]
                process = subprocess.run(['node', str(harness), str(build), str(file), *dependencies], capture_output=True, text=True, encoding='utf8', timeout=60)
                if process.returncode: raise ValueError('Cocos reader failed: ' + process.stderr[-2000:])
                actual = json.loads(process.stdout)
                if actual['id'] != expected['id'] or actual['name'] != expected['name']:
                    raise ValueError('package identity differs')
                loaded = {item['id']: item for item in actual['items']}
                items = {item['id']: item for item in expected['items']}
                if loaded.keys() != items.keys(): raise ValueError('loaded item IDs differ')
                for ident, item in items.items():
                    if any(loaded[ident][key] != item[key] for key in ('type', 'width', 'height')):
                        raise ValueError(f'item {ident} type or size differs')
                constructed = {item['id']: item for item in actual['constructed']}
                components = {item['id']: item['component'] for item in items.values() if item['type'] == 3}
                if constructed.keys() != components.keys(): raise ValueError('constructed component IDs differ')
                controllers = 0
                for ident, component in components.items():
                    runtime = constructed[ident]
                    if (runtime['width'], runtime['height']) != (component['width'], component['height']):
                        raise ValueError(f'component {ident} dimensions differ')
                    if [child['id'] for child in runtime['children']] != [child['id'] for child in component['children']]:
                        raise ValueError(f'component {ident} child order differs')
                    if len(runtime['controllers']) != len(component['controllers']): raise ValueError(f'component {ident} controller count differs')
                    for actual_controller, expected_controller in zip(runtime['controllers'], component['controllers']):
                        pages = expected_controller['pages']
                        if (actual_controller['name'], actual_controller['ids'], actual_controller['names']) != (expected_controller['name'], [page['id'] for page in pages], [page['name'] for page in pages]):
                            raise ValueError(f'component {ident} controller pages differ')
                        controllers += 1
                report['passed'].append({'package': entry['package'], 'items': len(items), 'components': len(components), 'controllers': controllers})
            except (ValueError, OSError, KeyError, TypeError, subprocess.TimeoutExpired) as exc:
                report['failed'].append({'package': entry['package'], 'error': str(exc)})
    return report


class CocosSamplesTest(unittest.TestCase):
    def test_exported_sample_packages_load_in_cocos_readers(self):
        demo = Path(os.environ.get('FGUI_COCOS_DEMO', 'E:/game_dev/FairyGUI-cocoscreator/demo'))
        build = Path(os.environ.get('FGUI_COCOS_BUILD', 'E:/game_dev/FairyGUI-cocoscreator/source/build'))
        if not (demo / 'UIProject/assets/Basics/package.xml').is_file() or not (build / 'UIPackage.js').is_file() or not shutil.which('node'):
            self.skipTest('Cocos sample, compiled source or Node.js unavailable')
        result = run(demo / 'UIProject', build)
        self.assertFalse(result['failed'], result['failed'])
        self.assertTrue(result['passed'])


if __name__ == '__main__':
    if len(sys.argv) != 3: raise SystemExit('usage: python test_cocos_samples.py PROJECT COCOS_BUILD')
    result = run(Path(sys.argv[1]), Path(sys.argv[2]))
    print(json.dumps({'counts': {key: len(value) for key, value in result.items()}, 'details': result}, ensure_ascii=False, indent=2))
    raise SystemExit(bool(result['failed']))
