"""Compare a supported real sample against the editor's published package."""
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from fgui import execute
from published import inspect


class ReferenceSampleTest(unittest.TestCase):
    def test_bag_nine_slice_matches_editor_output(self):
        demo = Path(os.environ.get('FGUI_COCOS_DEMO', 'E:/game_dev/FairyGUI-cocoscreator/demo'))
        project = demo / 'UIProject'
        published = demo / 'assets/resources/UI/Bag.bin'
        if not (project / 'assets/Bag/package.xml').is_file() or not published.is_file():
            self.skipTest('Cocos sample unavailable')
        expected = next(i for i in inspect(published.read_bytes())['items'] if i['id'] == 'thi7g')
        with tempfile.TemporaryDirectory() as temp:
            result = execute('publish_simple_experimental', {'project': str(project), 'pkg': 'Bag', 'output': str(Path(temp) / 'generated')})
            actual = next(i for i in inspect(Path(result['file']).read_bytes())['items'] if i['id'] == 'thi7g')
            self.assertEqual(actual['scale9Grid'], expected['scale9Grid'])
            self.assertEqual(actual['scale9Grid'], [83, 1, 166, 2])
            report = execute('validate_published', {'project': str(project), 'file': result['file'], 'compare_source': True, 'compare_components': True})
            self.assertTrue(report['valid'])

    def test_editor_publishing_with_stale_component_references(self):
        demo = Path(os.environ.get('FGUI_COCOS_DEMO', 'E:/game_dev/FairyGUI-cocoscreator/demo'))
        project = demo / 'UIProject'
        if not (project / 'assets/PullToRefresh/Footer.xml').is_file(): self.skipTest('Cocos sample unavailable')
        with tempfile.TemporaryDirectory() as temp:
            for package, name, warning_count in [('PullToRefresh', 'Footer', 1), ('Transition', 'BOSS', 6)]:
                with self.subTest(package=package):
                    reference = inspect((demo / 'assets/resources/UI' / (package + '.bin')).read_bytes())
                    expected = next(item for item in reference['items'] if item['type'] == 3 and item['name'] == name)
                    result = execute('publish_simple_experimental', {'project': str(project), 'pkg': package, 'output': str(Path(temp) / package)})
                    actual = next(item for item in inspect(Path(result['file']).read_bytes())['items'] if item['type'] == 3 and item['name'] == name)
                    self.assertEqual(sum('component' in warning for warning in result['warnings']), warning_count)
                    self.assertEqual(actual, expected)

    def test_exported_resource_closure_matches_all_demo_packages(self):
        from fgui import packages, select_exported_resources
        demo = Path(os.environ.get('FGUI_COCOS_DEMO', 'E:/game_dev/FairyGUI-cocoscreator/demo'))
        if not (demo / 'UIProject/assets/Basics/package.xml').is_file(): self.skipTest('Cocos sample unavailable')
        for folder, package in packages(demo / 'UIProject'):
            with self.subTest(package=folder.name):
                actual = {item.get('id') for item in select_exported_resources(folder, package)}
                expected = {item['id'] for item in inspect((demo / 'assets/resources/UI' / (folder.name + '.bin')).read_bytes())['items'] if item['type'] in (0, 1, 2, 3, 5)}
                self.assertEqual(actual, expected)

    def test_exported_only_publishes_previously_blocked_demo_packages(self):
        demo = Path(os.environ.get('FGUI_COCOS_DEMO', 'E:/game_dev/FairyGUI-cocoscreator/demo'))
        project = demo / 'UIProject'
        if not (project / 'assets/Basics/package.xml').is_file(): self.skipTest('Cocos sample unavailable')
        with tempfile.TemporaryDirectory() as temp:
            for package in ('Basics', 'HitTest'):
                with self.subTest(package=package):
                    args = {'project': str(project), 'pkg': package, 'output': str(Path(temp) / package), 'exported_only': True}
                    result = execute('publish_simple_experimental', args)
                    report = execute('validate_published', {'project': str(project), 'file': result['file'], 'compare_source': True, 'compare_components': True, 'exported_only': True})
                    self.assertTrue(report['valid'], report)

    def test_bag_dot_matches_editor_metadata(self):
        demo = Path(os.environ.get('FGUI_COCOS_DEMO', 'E:/game_dev/FairyGUI-cocoscreator/demo'))
        source = demo / 'UIProject/assets/Bag/dot.xml'
        published = demo / 'assets/resources/UI/Bag.bin'
        if not source.is_file() or not published.is_file(): self.skipTest('Cocos sample unavailable')
        expected = next(i for i in inspect(published.read_bytes())['items'] if i['id'] == 'osdok')
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'project'
            package = root / 'assets/Bag'
            package.mkdir(parents=True)
            (root / 'project.fairy').write_text('<projectDescription id="p" type="CocosCreator" version="3"/>')
            (package / 'package.xml').write_text('<packageDescription id="rbw1tv9t"><resources><component id="osdok" name="dot.xml" path="/"/></resources></packageDescription>')
            shutil.copyfile(source, package / 'dot.xml')
            output = root / 'generated'
            result = execute('publish_simple_experimental', {'project': str(root), 'pkg': 'Bag', 'output': str(output)})
            actual = inspect(Path(result['file']).read_bytes())['items'][0]
            self.assertEqual(actual['extension'], expected['extension'])
            self.assertEqual(actual['component'], expected['component'])


if __name__ == '__main__': unittest.main()
