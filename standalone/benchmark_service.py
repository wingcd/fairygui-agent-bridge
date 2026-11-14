"""Measure read-only requests against one local HTTP service.

Example: python standalone/benchmark_service.py PROJECT1 PROJECT2 --requests 100 --workers 4
The benchmark does not modify the projects. Results depend on machine load and
filesystem cache and are not a guarantee for publication or write performance.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
import math
from pathlib import Path
import statistics
from threading import Thread
import time

from fgui import project_root
from http_server import Handler


def run(projects, requests=100, workers=4, tool='project_info', pkg=None, component=None):
    if not projects: raise ValueError('at least one project is required')
    if type(requests) is not int or not 1 <= requests <= 10000: raise ValueError('requests must be between 1 and 10000')
    if type(workers) is not int or not 1 <= workers <= 64: raise ValueError('workers must be between 1 and 64')
    if tool not in ('project_info', 'list_packages', 'list_children'): raise ValueError('unsupported benchmark tool')
    if tool == 'list_children' and (not pkg or not component): raise ValueError('list_children requires pkg and component')
    roots = [project_root(value) for value in projects]
    allowed_roots = [[root] + [folder.resolve() for folder in (root / 'assets').iterdir() if folder.is_dir()] for root in roots]
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    def call(index):
        project = roots[index % len(roots)]
        arguments = {'project': str(project)}
        if tool == 'list_children': arguments.update(pkg=pkg, name=component)
        request = {'jsonrpc': '2.0', 'id': index, 'method': 'tools/call',
                   'params': {'name': tool, 'arguments': arguments}}
        connection = HTTPConnection('127.0.0.1', server.server_address[1], timeout=60)
        started = time.perf_counter()
        try:
            connection.request('POST', '/rpc', json.dumps(request).encode('utf8'), {'Content-Type': 'application/json'})
            response = connection.getresponse()
            body = json.loads(response.read())
            elapsed = time.perf_counter() - started
            if response.status != 200 or body.get('id') != index or 'error' in body:
                raise ValueError('HTTP or JSON-RPC error: ' + str(body))
            result = json.loads(body['result']['content'][0]['text'])
            if not result.get('ok'): raise ValueError('tool error: ' + str(result))
            data = result['data']
            paths = [data['root']] if tool == 'project_info' else [data['path']] if tool == 'list_children' else [item['path'] for item in data]
            if any(not any(Path(path).resolve().is_relative_to(allowed) for allowed in allowed_roots[index % len(roots)]) for path in paths):
                raise ValueError('incorrect project response: ' + str(result))
            return elapsed
        finally:
            connection.close()
    try:
        for index in range(len(roots)): call(index)  # Warm each project once.
        started = time.perf_counter()
        with ThreadPoolExecutor(max_workers=workers) as executor:
            timings = list(executor.map(call, range(requests)))
        elapsed = time.perf_counter() - started
        ordered = sorted(timings)
        return {'projects': [str(root) for root in roots], 'requests': requests, 'workers': workers,
                'elapsed_seconds': round(elapsed, 4), 'requests_per_second': round(requests / elapsed, 2),
                'latency_ms': {'median': round(statistics.median(ordered) * 1000, 2),
                               'p95': round(ordered[math.ceil(len(ordered) * .95) - 1] * 1000, 2),
                               'max': round(ordered[-1] * 1000, 2)},
                'tool': tool, 'scope': 'one local HTTP server and client threads in the same process; new connection per read-only call; warm cache; includes JSON and network overhead'}
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('projects', nargs='+', type=Path)
    parser.add_argument('--requests', type=int, default=100)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--tool', choices=('project_info', 'list_packages', 'list_children'), default='project_info')
    parser.add_argument('--pkg', help='package name for list_children')
    parser.add_argument('--component', help='component name for list_children')
    args = parser.parse_args()
    print(json.dumps(run(args.projects, args.requests, args.workers, args.tool, args.pkg, args.component), ensure_ascii=False, indent=2))
