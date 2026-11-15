"""Publish each complete sample package, then validate its generated assets.

This exercises all registered resources, including unused ones. It checks the
validator's documented source-comparison subset, not editor or runtime parity.
Usage: python standalone/test_full_packages.py PROJECT [--exported-only]
"""
import json
from pathlib import Path
import sys
import tempfile
import time

from fgui import execute, packages, project_root


def run(project, exported_only=False, shrink_atlas=False, optimize_atlas=False):
    root = project_root(project)
    report = {'passed': [], 'failed': []}
    with tempfile.TemporaryDirectory(prefix='fgui-full-packages-') as temp:
        for folder, _ in packages(root):
            start = time.perf_counter()
            try:
                result = execute('publish_simple_experimental', {
                    'project': str(root), 'pkg': folder.name,
                    'output': str(Path(temp) / folder.name), 'exported_only': exported_only, 'shrink_atlas': shrink_atlas, 'optimize_atlas': optimize_atlas,
                })
                validation = execute('validate_published', {
                    'project': str(root), 'file': result['file'],
                    'compare_source': True, 'compare_components': True, 'exported_only': exported_only,
                })
                entry = {'package': folder.name, 'seconds': round(time.perf_counter() - start, 3),
                         'validation': validation, 'publication_warnings': result.get('warnings', [])}
                report['passed' if validation['valid'] else 'failed'].append(entry)
            except (ValueError, OSError, KeyError, TypeError) as exc:
                report['failed'].append({'package': folder.name, 'error': str(exc),
                                         'seconds': round(time.perf_counter() - start, 3)})
    return report


if __name__ == '__main__':
    result = run(sys.argv[1], '--exported-only' in sys.argv[2:], '--shrink-atlas' in sys.argv[2:], '--optimize-atlas' in sys.argv[2:])
    print(json.dumps({'counts': {key: len(value) for key, value in result.items()},
                      'details': result}, ensure_ascii=False, indent=2))
    sys.exit(bool(result['failed']))
