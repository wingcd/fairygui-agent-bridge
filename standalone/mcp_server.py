#!/usr/bin/env python3
"""Offline MCP server over stdio, using the same operations as fgui.py."""
import json
import sys
from fgui import execute

PROJECT = {'type': 'string', 'description': 'Absolute project directory or .fairy file'}
PKG = {'type': 'string', 'description': 'Package name or id'}
NAME = {'type': 'string', 'description': 'Component name, filename or id'}
SPECS = {
    'project_info': ('Read project metadata', {}, []),
    'list_packages': ('List packages', {}, []),
    'list_items': ('List registered package resources', {'pkg': PKG}, ['pkg']),
    'read_component': ('Read component XML and its SHA-256 for optimistic concurrency', {'pkg': PKG, 'name': NAME}, ['pkg', 'name']),
    'write_component': ('Replace an existing component after structural validation and SHA-256 comparison', {'pkg': PKG, 'name': NAME, 'xml': {'type': 'string'}, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'xml', 'expected_sha256']),
    'validate': ('Check project XML, registered files and IDs; does not validate published runtime output', {}, []),
}


def dispatch(req):
    method = req.get('method')
    if method == 'initialize':
        return {'protocolVersion': '2024-11-05', 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'fgui-standalone', 'version': '0.1.0'}}
    if method == 'ping':
        return {}
    if method == 'tools/list':
        return {'tools': [{'name': name, 'description': desc, 'inputSchema': {'type': 'object', 'properties': {'project': PROJECT, **props}, 'required': ['project', *required], 'additionalProperties': False}} for name, (desc, props, required) in SPECS.items()]}
    if method == 'tools/call':
        params = req.get('params', {})
        name = params.get('name')
        if name not in SPECS:
            raise ValueError('unknown tool')
        args = params.get('arguments', {})
        try:
            data = {'ok': True, 'data': execute(name, args)}
        except (ValueError, OSError, KeyError, TypeError) as exc:
            data = {'ok': False, 'error': str(exc)}
        return {'content': [{'type': 'text', 'text': json.dumps(data, ensure_ascii=False)}], 'isError': not data['ok']}
    raise ValueError('unknown method')


def main():
    for line in sys.stdin:
        try:
            req = json.loads(line)
            if 'id' not in req:
                continue
            try:
                response = {'jsonrpc': '2.0', 'id': req['id'], 'result': dispatch(req)}
            except (ValueError, TypeError) as exc:
                response = {'jsonrpc': '2.0', 'id': req['id'], 'error': {'code': -32601, 'message': str(exc)}}
        except (ValueError, TypeError) as exc:
            response = {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32700, 'message': str(exc)}}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
