"""Publish whole exported sample packages and compare editor output semantics.

Checks resource IDs and decoded non-atlas resource metadata, plus hit-test
masks at source-pixel coordinates. Atlas layout is intentionally not compared.
Does not render components, and does not prove parity for unparsed data.
Usage: python standalone/test_full_reference.py PROJECT REFERENCE_DIR
"""
import json
from pathlib import Path
import sys
import tempfile

from fgui import execute, packages, project_root
from published import inspect
from test_publish_samples import compare_hit_test_masks, differences


def compare_packages(actual, reference):
    kinds = (0, 1, 2, 3, 5)
    ours = {item['id']: item for item in actual['items'] if item['type'] in kinds}
    theirs = {item['id']: item for item in reference['items'] if item['type'] in kinds}
    errors = differences(sorted(ours), sorted(theirs), 'resourceIds')
    for ident in sorted(ours.keys() & theirs.keys()):
        errors.extend(differences(ours[ident], theirs[ident], 'resources.' + ident))
    our_hits = {hit['id']: hit for hit in actual['hitTests']}
    their_hits = {hit['id']: hit for hit in reference['hitTests']}
    errors.extend(differences(sorted(our_hits), sorted(their_hits), 'hitTestIds'))
    for ident in sorted(our_hits.keys() & their_hits.keys()):
        image = theirs.get(ident)
        if image is None or image['type'] != 0:
            errors.append({'path': 'hitTests.' + ident, 'error': 'reference image missing'})
            continue
        count = compare_hit_test_masks(our_hits[ident], their_hits[ident], image['width'], image['height'])
        if count:
            errors.append({'path': 'hitTests.' + ident, 'different_pixels': count,
                           'total_pixels': image['width'] * image['height']})
    return errors


def run(project, reference_dir):
    root = project_root(project)
    reference_dir = Path(reference_dir)
    report = {'matched': [], 'different': [], 'failed': []}
    with tempfile.TemporaryDirectory(prefix='fgui-full-reference-') as temp:
        for folder, _ in packages(root):
            try:
                reference = reference_dir / (folder.name + '.bin')
                result = execute('publish_simple_experimental', {'project': str(root), 'pkg': folder.name,
                                 'output': str(Path(temp) / folder.name), 'exported_only': True})
                actual = inspect(Path(result['file']).read_bytes())
                expected = inspect(reference.read_bytes())
                errors = compare_packages(actual, expected)
                record = {'package': folder.name, 'items': sum(item['type'] in (0, 1, 2, 3, 5) for item in actual['items']),
                          'warnings': result['warnings']}
                if errors:
                    record['differences'] = errors
                    report['different'].append(record)
                else:
                    report['matched'].append(record)
            except (ValueError, OSError, KeyError, TypeError) as exc:
                report['failed'].append({'package': folder.name, 'error': str(exc)})
    return report


if __name__ == '__main__':
    report = run(sys.argv[1], sys.argv[2])
    print(json.dumps({'counts': {key: len(value) for key, value in report.items()}, 'details': report}, ensure_ascii=False, indent=2))
    sys.exit(bool(report['different'] or report['failed']))
