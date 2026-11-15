import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from fgui import execute


class OfflineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.pkg = self.root / 'assets' / 'Demo'
        self.pkg.mkdir(parents=True)
        (self.root / 'test.fairy').write_text('<projectDescription id="p"/>', encoding='utf8')
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="c0001" name="Main.xml" path="/"/></resources></packageDescription>', encoding='utf8')
        (self.pkg / 'Main.xml').write_text('<component><displayList><text id="n1" name="label"/></displayList></component>', encoding='utf8')
        self.args = {'project': str(self.root), 'pkg': 'Demo', 'name': 'Main'}

    def tearDown(self):
        self.tmp.cleanup()

    def test_read_write_and_conflict(self):
        before = execute('read_component', self.args)
        new = '<component><displayList><text id="n1" text="你好"/></displayList></component>'
        execute('write_component', {**self.args, 'xml': new, 'expected_sha256': before['sha256']})
        self.assertEqual(execute('read_component', self.args)['xml'], new)
        with self.assertRaises(ValueError):
            execute('write_component', {**self.args, 'xml': before['xml'], 'expected_sha256': before['sha256']})
        self.assertEqual((self.pkg / 'Main.xml').read_text(encoding='utf8'), new)

    def test_bad_xml_is_never_written(self):
        before = execute('read_component', self.args)
        for xml in ('<component>', '<component><displayList><text id="x"/><text id="x"/></displayList></component>', '<!DOCTYPE component><component/>'):
            with self.assertRaises(ValueError):
                execute('write_component', {**self.args, 'xml': xml, 'expected_sha256': before['sha256']})
        self.assertEqual(execute('read_component', self.args), before)

    def test_validation_missing_resource_and_escape(self):
        self.assertTrue(execute('validate', self.args)['valid'])
        (self.pkg / 'Main.xml').unlink()
        self.assertFalse(execute('validate', self.args)['valid'])
        (self.pkg / 'package.xml').write_text('<packageDescription id="a"><resources><component id="c" name="secret.xml" path="/../../"/></resources></packageDescription>')
        self.assertFalse(execute('validate', self.args)['valid'])

    def test_mcp_stdio(self):
        request = {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': 'list_packages', 'arguments': {'project': str(self.root)}}}
        p = subprocess.run([sys.executable, str(Path(__file__).with_name('mcp_server.py'))], input=json.dumps(request) + '\n', capture_output=True, text=True, check=True)
        result = json.loads(json.loads(p.stdout)['result']['content'][0]['text'])
        self.assertEqual(result['data'][0]['name'], 'Demo')


if __name__ == '__main__':
    unittest.main()
