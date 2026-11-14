"""Local HTTP JSON-RPC gateway for the offline MCP tool catalogue.

Provides a stateless MCP 2025-03-26 Streamable HTTP endpoint with JSON
responses and a separate lightweight JSON-RPC gateway. Binds only to IPv4
loopback and rejects browser Origin headers.
"""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import sys
import traceback

from mcp_server import dispatch, validate_unicode

MAX_BODY = 16 * 1024 * 1024
MCP_VERSION = '2025-03-26'


def mcp_message(req):
    invalid = {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32600, 'message': 'Invalid Request'}}
    if not isinstance(req, dict) or req.get('jsonrpc') != '2.0': return invalid
    if 'id' in req and type(req['id']) not in (str, int, type(None)): return invalid
    if 'method' not in req:
        if 'id' in req and (('result' in req) != ('error' in req)): return None
        return invalid
    if not isinstance(req['method'], str): return invalid
    if 'id' not in req: return None
    if req['method'] == 'initialize':
        params = req.get('params')
        if not isinstance(params, dict) or not isinstance(params.get('protocolVersion'), str) or not isinstance(params.get('capabilities'), dict) or not isinstance(params.get('clientInfo'), dict) or not isinstance(params['clientInfo'].get('name'), str) or not isinstance(params['clientInfo'].get('version'), str):
            return {'jsonrpc': '2.0', 'id': req['id'], 'error': {'code': -32602, 'message': 'Invalid initialize parameters'}}
        result = {'protocolVersion': MCP_VERSION, 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'fgui-standalone', 'version': '0.1.0'}}
        return {'jsonrpc': '2.0', 'id': req['id'], 'result': result}
    try:
        result = dispatch(req)
        return {'jsonrpc': '2.0', 'id': req['id'], 'result': result}
    except (ValueError, TypeError) as exc:
        code = -32601 if str(exc) == 'unknown method' else -32602
        return {'jsonrpc': '2.0', 'id': req['id'], 'error': {'code': code, 'message': str(exc)}}
    except Exception:
        traceback.print_exc(file=sys.stderr)
        return {'jsonrpc': '2.0', 'id': req['id'], 'error': {'code': -32603, 'message': 'Internal error'}}


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'fgui-offline/0.1'

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def log_message(self, format, *args):
        pass

    def reply(self, status, payload=None):
        body = b'' if payload is None else json.dumps(payload, ensure_ascii=False, allow_nan=False).encode('utf-8')
        self.send_response(status)
        if payload is not None: self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        if status == 405: self.send_header('Allow', 'GET, POST' if self.path == '/mcp' else 'POST')
        self.end_headers()
        if body: self.wfile.write(body)

    def allowed(self):
        host = self.headers.get('Host', '')
        expected_port = str(self.server.server_address[1])
        return (not self.headers.get('Origin') and host in ('127.0.0.1:' + expected_port, 'localhost:' + expected_port))

    def reject_post(self, status, payload):
        # On Windows, closing a socket with an unread request body can reset the
        # connection before the client receives the error response. Drain only
        # a single, bounded Content-Length body; never trust transfer encoding.
        lengths = self.headers.get_all('Content-Length', [])
        if len(lengths) == 1 and not self.headers.get('Transfer-Encoding'):
            try:
                length = int(lengths[0])
                if 0 <= length <= MAX_BODY:
                    remaining = length
                    while remaining:
                        chunk = self.rfile.read(min(remaining, 65536))
                        if not chunk: break
                        remaining -= len(chunk)
            except (OSError, ValueError):
                pass
        self.close_connection = True
        return self.reply(status, payload)

    def do_GET(self):
        if not self.allowed(): return self.reply(403, {'error': 'loopback host required; browser origins are not accepted'})
        if self.path == '/health': return self.reply(200, {'ok': True, 'transport': 'json-rpc-http', 'mcp_version': MCP_VERSION})
        if self.path == '/mcp': return self.reply(405, {'error': 'server-initiated streams are not supported'})
        return self.reply(404, {'error': 'not found'})

    def do_POST(self):
        if not self.allowed():
            return self.reject_post(403, {'error': 'loopback host required; browser origins are not accepted'})
        if self.path not in ('/rpc', '/mcp'):
            return self.reject_post(404, {'error': 'not found'})
        if self.path == '/mcp':
            accept = self.headers.get('Accept', '')
            if 'application/json' not in accept or 'text/event-stream' not in accept:
                return self.reject_post(406, {'error': 'Accept must include application/json and text/event-stream'})
            version = self.headers.get('MCP-Protocol-Version')
            if version and version != MCP_VERSION:
                return self.reject_post(400, {'error': 'unsupported MCP protocol version'})
        if self.headers.get_content_type() != 'application/json':
            return self.reject_post(415, {'error': 'Content-Type must be application/json'})
        if len(self.headers.get_all('Content-Length', [])) != 1 or self.headers.get('Transfer-Encoding'):
            self.close_connection = True
            return self.reply(400, {'error': 'exactly one Content-Length is required'})
        try:
            length = int(self.headers.get('Content-Length', ''))
        except ValueError:
            self.close_connection = True
            return self.reply(411, {'error': 'valid Content-Length required'})
        if length <= 0 or length > MAX_BODY:
            self.close_connection = True
            return self.reply(413, {'error': 'invalid request size'})
        try:
            raw = self.rfile.read(length)
            if len(raw) != length: raise ValueError('truncated request')
            req = json.loads(raw.decode('utf-8'), parse_constant=lambda value: (_ for _ in ()).throw(ValueError('invalid JSON constant')))
            validate_unicode(req)
        except (UnicodeError, ValueError, RecursionError):
            return self.reply(400, {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32700, 'message': 'Parse error'}})
        if self.path == '/mcp':
            if isinstance(req, list):
                if not req or len(req) > 100:
                    return self.reply(400, {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32600, 'message': 'Invalid batch'}})
                if any(isinstance(message, dict) and message.get('method') == 'initialize' for message in req):
                    return self.reply(400, {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32600, 'message': 'Initialize cannot be batched'}})
                responses = [response for message in req if (response := mcp_message(message)) is not None]
                return self.reply(200, responses) if responses else self.reply(202)
            response = mcp_message(req)
            return self.reply(200, response) if response is not None else self.reply(202)
        if not isinstance(req, dict) or req.get('jsonrpc') != '2.0' or not isinstance(req.get('method'), str) or ('id' in req and type(req['id']) not in (str, int, type(None))):
            return self.reply(400, {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32600, 'message': 'Invalid Request'}})
        if 'id' not in req: return self.reply(204)
        try:
            result = dispatch(req)
            response = {'jsonrpc': '2.0', 'id': req['id'], 'result': result}
        except (ValueError, TypeError) as exc:
            code = -32601 if str(exc) == 'unknown method' else -32602
            response = {'jsonrpc': '2.0', 'id': req['id'], 'error': {'code': code, 'message': str(exc)}}
        except Exception:
            traceback.print_exc(file=sys.stderr)
            response = {'jsonrpc': '2.0', 'id': req['id'], 'error': {'code': -32603, 'message': 'Internal error'}}
        return self.reply(200, response)

    def do_DELETE(self):
        if not self.allowed(): return self.reply(403, {'error': 'loopback host required; browser origins are not accepted'})
        return self.reply(405, {'error': 'stateless server has no sessions'})


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=7532, help='loopback port (0 chooses an available port)')
    args = parser.parse_args()
    if not 0 <= args.port <= 65535: parser.error('port must be between 0 and 65535')
    with Server(('127.0.0.1', args.port), Handler) as server:
        print('http://127.0.0.1:' + str(server.server_address[1]) + '/rpc', file=sys.stderr, flush=True)
        try: server.serve_forever(poll_interval=0.2)
        except KeyboardInterrupt: pass


if __name__ == '__main__': main()
