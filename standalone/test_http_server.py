import concurrent.futures
import http.client
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from email.message import Message

from http_server import Handler


class HttpServerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.projects = []
        for name in ('One', 'Two'):
            root = Path(self.temp.name) / name
            (root / 'assets').mkdir(parents=True)
            (root / 'project.fairy').write_text('<projectDescription id="p"/>', encoding='utf8')
            self.projects.append(root)
        self.process = subprocess.Popen([sys.executable, '-u', str(Path(__file__).with_name('http_server.py')), '--port', '0'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf8')
        address = self.process.stderr.readline().strip()
        if not address.startswith('http://127.0.0.1:'): raise RuntimeError('server did not start: ' + address)
        self.port = int(address.split(':')[2].split('/')[0])

    def tearDown(self):
        self.process.terminate()
        self.process.communicate(timeout=10)
        self.temp.cleanup()

    def request(self, body, headers=None, path='/rpc'):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=15)
        try:
            connection.request('POST', path, body=body, headers=headers or {'Content-Type': 'application/json'})
            response = connection.getresponse()
            data = response.read()
            return response.status, json.loads(data) if data else None
        finally:
            connection.close()

    def rpc(self, ident, name, arguments):
        data = {'jsonrpc': '2.0', 'id': ident, 'method': 'tools/call', 'params': {'name': name, 'arguments': arguments}}
        status, response = self.request(json.dumps(data).encode('utf8'))
        self.assertEqual(status, 200)
        return json.loads(response['result']['content'][0]['text'])

    def test_one_server_handles_multiple_projects(self):
        def work(index):
            root = str(self.projects[index])
            created = self.rpc(index + 1, 'create_package', {'project': root, 'name': 'Package' + str(index)})
            self.assertTrue(created['ok'], created)
            return self.rpc(index + 10, 'list_packages', {'project': root})
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(work, (0, 1)))
        self.assertEqual([[item['name'] for item in result['data']] for result in results], [['Package0'], ['Package1']])

    def test_one_server_isolates_icon_gear_edits_across_projects(self):
        def work(index):
            args = {'project': str(self.projects[index]), 'pkg': 'UI', 'name': 'Main'}
            self.assertTrue(self.rpc(100 + index, 'create_package', {'project': args['project'], 'name': 'UI'})['ok'])
            component = self.rpc(110 + index, 'create_component', {**args, 'width': 20, 'height': 20})
            self.assertTrue(component['ok'], component)
            inserted = self.rpc(120 + index, 'insert_object', {**args, 'object_xml': '<loader id="icon" name="icon"/>', 'expected_sha256': component['data']['sha256']})
            self.assertTrue(inserted['ok'], inserted)
            controller = self.rpc(130 + index, 'create_controller', {**args, 'controller': 'state', 'pages': [{'id': '0', 'name': 'normal'}], 'expected_sha256': inserted['data']['sha256']})
            self.assertTrue(controller['ok'], controller)
            changed = self.rpc(140 + index, 'set_icon_gear', {**args, 'target': 'icon', 'controller': 'state', 'pages': ['0'], 'values': ['icon' + str(index)], 'expected_sha256': controller['data']['sha256']})
            self.assertTrue(changed['ok'], changed)
            return self.rpc(150 + index, 'list_children', args)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(work, (0, 1)))
        for index, result in enumerate(results):
            self.assertTrue(result['ok'], result)
            gear = result['data']['children'][0]['behaviors'][0]
            self.assertEqual((gear['type'], gear['attributes']['values']), ('gearIcon', 'icon' + str(index)))

    def test_preflight_runs_for_two_projects_through_one_server(self):
        def work(index):
            project = str(self.projects[index])
            package = self.rpc(10 + index, 'create_package', {'project': project, 'name': 'UI'})
            self.assertTrue(package['ok'], package)
            component = self.rpc(20 + index, 'create_component', {'project': project, 'pkg': 'UI', 'name': 'Main', 'width': 10, 'height': 10, 'exported': True})
            self.assertTrue(component['ok'], component)
            return self.rpc(30 + index, 'preflight_publish', {'project': project})
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(work, (0, 1)))
        for result in results:
            self.assertTrue(result['ok'], result)
            self.assertTrue(result['data']['valid'], result)
            self.assertEqual(result['data']['counts'], {'passed': 1, 'failed': 0, 'skipped': 0})

    def test_http_exposes_same_tool_schemas_and_errors(self):
        query = {'jsonrpc': '2.0', 'id': 'catalog', 'method': 'tools/list'}
        status, response = self.request(json.dumps(query).encode())
        tools = {tool['name']: tool for tool in response['result']['tools']}
        self.assertEqual(status, 200)
        self.assertIn('project', tools['list_packages']['inputSchema']['required'])
        self.assertIn('set_properties_batch', tools)
        result = self.rpc(2, 'list_packages', {})
        self.assertFalse(result['ok'])
        self.assertIn('project', result['error'])

    def test_rpc_distinguishes_invalid_parameters_and_unknown_methods(self):
        for method, params, expected in (
            ('tools/call', [], -32602),
            ('tools/call', {'name': 'does_not_exist'}, -32602),
            ('does_not_exist', {}, -32601),
        ):
            request = {'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}
            status, response = self.request(json.dumps(request).encode())
            self.assertEqual(status, 200)
            self.assertEqual(response['error']['code'], expected)

    def test_streamable_http_handshake_tools_and_batches(self):
        headers = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'}
        initialize = {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-11-25', 'capabilities': {}, 'clientInfo': {'name': 'test', 'version': '1'}}}
        status, response = self.request(json.dumps(initialize).encode(), headers, '/mcp')
        self.assertEqual((status, response['result']['protocolVersion']), (200, '2025-03-26'))
        self.assertIsNone(response.get('error'))
        notification = {'jsonrpc': '2.0', 'method': 'notifications/initialized'}
        self.assertEqual(self.request(json.dumps(notification).encode(), headers, '/mcp'), (202, None))
        call = {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': 'list_packages', 'arguments': {'project': str(self.projects[0])}}}
        status, response = self.request(json.dumps(call).encode(), headers, '/mcp')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(response['result']['content'][0]['text'])['data'], [])
        batch = [{'jsonrpc': '2.0', 'id': 3, 'method': 'ping'}, notification, {'jsonrpc': '2.0', 'id': 4, 'method': 'tools/list'}]
        status, response = self.request(json.dumps(batch).encode(), headers, '/mcp')
        self.assertEqual((status, [item['id'] for item in response]), (200, [3, 4]))
        self.assertTrue(any(tool['name'] == 'list_packages' for tool in response[1]['result']['tools']))
        self.assertEqual(self.request(json.dumps(initialize).encode(), {'Content-Type': 'application/json'}, '/mcp')[0], 406)
        self.assertEqual(self.request(b'[]', headers, '/mcp')[0], 400)
        invalid_init = {**initialize, 'params': {**initialize['params'], 'clientInfo': {}}}
        self.assertEqual(self.request(json.dumps(invalid_init).encode(), headers, '/mcp')[1]['error']['code'], -32602)
        self.assertEqual(self.request(b'{"jsonrpc":"2.0","id":"\\ud800","method":"ping"}', headers, '/mcp')[0], 400)
        invalid_call = {'jsonrpc': '2.0', 'id': 8, 'method': 'tools/call', 'params': []}
        self.assertEqual(self.request(json.dumps(invalid_call).encode(), headers, '/mcp')[1]['error']['code'], -32602)
        self.assertEqual(self.request(json.dumps([initialize]).encode(), headers, '/mcp')[0], 400)
        self.assertEqual(self.request(json.dumps(call).encode(), {**headers, 'MCP-Protocol-Version': '9999'}, '/mcp')[0], 400)
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=15)
        try:
            connection.request('GET', '/mcp', headers={'Accept': 'text/event-stream'})
            response = connection.getresponse()
            self.assertEqual(response.status, 405)
            self.assertEqual(response.getheader('Allow'), 'GET, POST')
            response.read()
        finally:
            connection.close()

    def test_rejected_posts_drain_bounded_body_before_reply(self):
        handler = object.__new__(Handler)
        handler.headers = Message()
        handler.headers['Content-Length'] = '5'
        handler.rfile = io.BytesIO(b'hello')
        observed = []
        handler.reply = lambda status, payload: observed.append((status, handler.rfile.tell()))
        handler.reject_post(406, {'error': 'bad accept'})
        self.assertEqual(observed, [(406, 5)])
        self.assertTrue(handler.close_connection)
        for index in range(20):
            status, _ = self.request(json.dumps({'jsonrpc': '2.0', 'id': index, 'method': 'ping'}).encode(), {'Content-Type': 'application/json'}, '/mcp')
            self.assertEqual(status, 406)

    def test_official_mcp_sdk_client_when_available(self):
        python = os.environ.get('FGUI_MCP_CLIENT_PYTHON')
        if not python: self.skipTest('set FGUI_MCP_CLIENT_PYTHON to a Python with the official MCP SDK')
        script = Path(__file__).with_name('check_official_mcp_client.py')
        url = f'http://127.0.0.1:{self.port}/mcp'
        process = subprocess.run([python, str(script), url, *(str(path) for path in self.projects)], capture_output=True, text=True, encoding='utf8', timeout=60)
        self.assertEqual(process.returncode, 0, f'official HTTP MCP client failed:\nstdout: {process.stdout}\nstderr: {process.stderr}')
        result = json.loads(process.stdout)
        self.assertEqual(result['protocol'], '2025-03-26')
        self.assertEqual(result['packages'], [['SdkPackage0'], ['SdkPackage1']])
        self.assertIsNone(result['session'])

    def test_official_mcp_sdk_stdio_when_available(self):
        python = os.environ.get('FGUI_MCP_CLIENT_PYTHON')
        if not python: self.skipTest('set FGUI_MCP_CLIENT_PYTHON to a Python with the official MCP SDK')
        script = Path(__file__).with_name('check_official_mcp_stdio.py')
        server = Path(__file__).with_name('mcp_server.py')
        process = subprocess.run([python, str(script), str(server), *(str(path) for path in self.projects)], capture_output=True, text=True, encoding='utf8', timeout=60, check=True)
        result = json.loads(process.stdout)
        self.assertEqual(result['protocol'], '2024-11-05')
        self.assertEqual(result['packages'], [['StdioPackage0'], ['StdioPackage1']])

    def test_rejects_browser_origin_and_bad_requests(self):
        message = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'ping'}).encode()
        self.assertEqual(self.request(message, {'Content-Type': 'application/json', 'Origin': 'https://example.com'})[0], 403)
        self.assertEqual(self.request(message, {'Content-Type': 'application/json', 'Host': 'evil.example'})[0], 403)
        self.assertEqual(self.request(message, {'Content-Type': 'text/plain'})[0], 415)
        self.assertEqual(self.request(b'{')[1]['error']['code'], -32700)
        self.assertEqual(self.request(b'{"jsonrpc":"2.0","id":true,"method":"ping"}')[1]['error']['code'], -32600)
        self.assertEqual(self.request(b'{"jsonrpc":"2.0","method":"notifications/initialized"}'), (204, None))
        status, response = self.request(message)
        self.assertEqual((status, response['result']), (200, {}))


if __name__ == '__main__': unittest.main()
