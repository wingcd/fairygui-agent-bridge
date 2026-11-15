"""Publish each sample component with its same-package dependencies in isolation.

Reports unsupported cases and parsed metadata differences for each component
and its sliced same-package image/component and UI URL dependencies against
reference editor output. It does not test whole packages or runtime rendering.
"""
from collections import Counter
import json
from pathlib import Path
import shutil
import sys
import tempfile
import xml.etree.ElementTree as ET
from fgui import execute, packages, resource_path
from published import inspect, compare_source_movieclips, compare_source_fonts
from bitmap_font import read_bitmap_font


def differences(a, b, path='component'):
    if isinstance(a, dict) and isinstance(b, dict):
        return sum((differences(a.get(k), b.get(k), path + '.' + k) for k in sorted(set(a) | set(b))), [])
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b): return [{'path': path, 'actual_length': len(a), 'expected_length': len(b)}]
        return sum((differences(x, y, f'{path}[{n}]') for n, (x, y) in enumerate(zip(a, b))), [])
    return [] if a == b else [{'path': path, 'actual': a, 'expected': b}]


def url_dependency(value, package_id, package_name, entries, names):
    if not value.startswith('ui://'): return None
    address = value[5:]
    if '/' in address:
        pkg_name, resource_name = address.split('/', 1)
        if pkg_name != package_name: raise ValueError('cross-package URL dependency')
        matches = names.get(resource_name, [])
        if len(matches) != 1: raise ValueError('unknown or ambiguous UI URL dependency')
        return matches[0]
    if len(package_id) != 8 or not address.startswith(package_id): raise ValueError('cross-package URL dependency')
    ident = address[8:]
    if ident not in entries: raise ValueError('unknown UI URL dependency')
    return ident


def compare_hit_test_masks(actual, reference, width, height):
    """Compare Cocos pixel-hit decisions at integer source-image coordinates."""
    actual_bytes, reference_bytes = bytes.fromhex(actual['pixels']), bytes.fromhex(reference['pixels'])
    def bit(mask, pixels, x, y):
        scaled_x, scaled_y = x // mask['divisor'], y // mask['divisor']
        pos = scaled_y * mask['width'] + scaled_x
        return scaled_x < mask['width'] and pos // 8 < len(pixels) and bool(pixels[pos // 8] & (1 << (pos % 8)))
    return sum(bit(actual, actual_bytes, x, y) != bit(reference, reference_bytes, x, y) for y in range(height) for x in range(width))


def run(project, published):
    report = {'matched': [], 'different': [], 'unsupported': [], 'not_published': [], 'missing_packages': []}
    for folder, package in packages(project):
        binary = published / (folder.name + '.bin')
        if not binary.is_file():
            report['missing_packages'].append({'package': folder.name, 'expected_file': str(binary)})
            continue
        expected_package = inspect(binary.read_bytes())
        expected = {item['id']: item for item in expected_package['items'] if item['type'] in (0, 1, 2, 3, 5)}
        expected_hits = {item['id']: item for item in expected_package['hitTests']}
        entries = {item.get('id'): item for item in package.findall('./resources/*')}
        names = {}
        for entry in entries.values():
            names.setdefault(Path(entry.get('name', '')).stem, []).append(entry.get('id'))
        for item in package.findall('./resources/component'):
            ident = item.get('id')
            label = folder.name + '/' + item.get('name', ident)
            if ident not in expected or expected[ident]['type'] != 3:
                report['not_published'].append(label); continue
            try:
                needed, todo = {}, [ident]
                while todo:
                    current = todo.pop()
                    if current in needed: continue
                    resource = entries.get(current)
                    if resource is None: raise ValueError('cross-package or missing dependency')
                    needed[current] = resource
                    if resource.tag == 'component':
                        component = ET.parse(resource_path(folder, resource)).getroot()
                        for child in component.findall('./displayList/*'):
                            if child.get('pkg'): raise ValueError('cross-package dependency')
                            if child.get('src'): todo.append(child.get('src'))
                        for element in component.iter():
                            for key, value in element.attrib.items():
                                values = value.split(',') if key in ('scrollBarRes', 'ptrRes') else [value]
                                for candidate in (part for value in values for part in value.split('|')):
                                    target = url_dependency(candidate, package.get('id', ''), folder.name, entries, names)
                                    if target: todo.append(target)
                    elif resource.tag == 'font':
                        font = read_bitmap_font(resource_path(folder, resource).read_bytes(), resource.get('texture'))
                        if font['texture']: todo.append(font['texture'])
                        todo.extend(glyph['image'] for glyph in font['glyphs'] if glyph['image'])
                with tempfile.TemporaryDirectory(prefix='fgui-publish-sample-') as temp:
                    root = Path(temp) / 'project'
                    dest = root / 'assets' / folder.name
                    dest.mkdir(parents=True)
                    (root / 'project.fairy').write_text('<projectDescription id="p" type="CocosCreator" version="3"/>')
                    package_copy = ET.Element('packageDescription', {'id': package.get('id')})
                    resources = ET.SubElement(package_copy, 'resources')
                    for resource in needed.values():
                        resources.append(ET.fromstring(ET.tostring(resource)))
                        src = resource_path(folder, resource)
                        dst = resource_path(dest, resource)
                        dst.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copyfile(src, dst)
                    ET.ElementTree(package_copy).write(dest / 'package.xml', encoding='utf-8', xml_declaration=True)
                    result = execute('publish_simple_experimental', {'project': str(root), 'pkg': folder.name, 'output': str(root / 'out')})
                    actual_package = inspect(Path(result['file']).read_bytes())
                    actual = {x['id']: x for x in actual_package['items'] if x['type'] in (0, 1, 2, 3, 5)}
                    mismatches = []
                    for resource_id in needed:
                        if resource_id not in expected or resource_id not in actual:
                            mismatches.append({'path': 'resources.' + resource_id, 'actual': resource_id in actual, 'expected': resource_id in expected})
                            continue
                        # Atlas placement and filenames are intentionally excluded;
                        # compare all decoded item and component semantics.
                        mismatches.extend(differences(actual[resource_id], expected[resource_id], 'resources.' + resource_id))
                        if needed[resource_id].tag == 'sound':
                            actual_file = Path(result['file']).parent / (Path(result['file']).stem + '_' + actual[resource_id]['file'])
                            reference_file = binary.parent / (binary.stem + '_' + expected[resource_id]['file'])
                            if actual_file.read_bytes() != reference_file.read_bytes():
                                mismatches.append({'path': 'resources.' + resource_id + '.bytes', 'actual': 'different', 'expected': 'reference sound'})
                    used_hits = {item['component'].get('settings', {}).get('hitTest') for item in actual.values() if item['type'] == 3}
                    actual_hits = {hit['id']: hit for hit in actual_package['hitTests']}
                    for hit_id in used_hits - {None}:
                        if hit_id not in actual_hits or hit_id not in expected_hits:
                            mismatches.append({'path': 'resources.' + hit_id + '.hitTest', 'actual': hit_id in actual_hits, 'expected': hit_id in expected_hits})
                        else:
                            image = expected[hit_id]
                            different = compare_hit_test_masks(actual_hits[hit_id], expected_hits[hit_id], image['width'], image['height'])
                            if different: mismatches.append({'path': 'resources.' + hit_id + '.hitTest', 'different_pixels': different, 'total_pixels': image['width'] * image['height']})
                    clip_sources = {resource_id: resource_path(dest, resource) for resource_id, resource in needed.items() if resource.tag == 'movieclip'}
                    if clip_sources:
                        for source_name, info, package_file in [('generated', actual_package, result['file']), ('reference', expected_package, binary)]:
                            report_clip = compare_source_movieclips(info, package_file, clip_sources)
                            mismatches.extend({'path': 'movieclip.' + source_name + '.' + issue['id'], 'error': issue['error']} for issue in report_clip['issues'])
                    font_sources = {resource_id: (resource_path(dest, resource), resource.get('texture')) for resource_id, resource in needed.items() if resource.tag == 'font'}
                    if font_sources:
                        for source_name, info in [('generated', actual_package), ('reference', expected_package)]:
                            font_report = compare_source_fonts(info, font_sources)
                            mismatches.extend({'path': 'font.' + source_name + '.' + issue['id'], 'error': issue['error']} for issue in font_report['issues'])
                    if not mismatches:
                        report['matched'].append(label)
                    else:
                        report['different'].append({'sample': label, 'differences': mismatches[:20]})
            except (ValueError, OSError, KeyError, ET.ParseError) as exc:
                report['unsupported'].append({'sample': label, 'reason': str(exc)})
    return report


if __name__ == '__main__':
    result = run(Path(sys.argv[1]), Path(sys.argv[2]))
    print(json.dumps({'counts': {key: len(value) for key, value in result.items()}, 'reasons': Counter(x['reason'].split(': ', 1)[-1] for x in result['unsupported']), 'details': result}, ensure_ascii=False, indent=2))
    sys.exit(bool(result['different'] or result['unsupported'] or result['not_published'] or result['missing_packages']))
