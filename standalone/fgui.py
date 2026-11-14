#!/usr/bin/env python3
"""Offline FairyGUI project operations. JSON in/out; no editor process required."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import xml.etree.ElementTree as ET


def project_root(project):
    p = Path(project).resolve(strict=True)
    if p.is_file():
        if p.suffix.lower() != '.fairy':
            raise ValueError('project file must have .fairy extension')
        p = p.parent
    if not (p / 'assets').is_dir() or not list(p.glob('*.fairy')):
        raise ValueError('project must contain assets/ and a .fairy file')
    return p


def parse_xml(data, label):
    # DTDs and external entities are not part of the FairyGUI project format.
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ValueError(f'{label}: DTD/entity declarations are not supported')
    try:
        return ET.fromstring(data)
    except ET.ParseError as exc:
        raise ValueError(f'{label}: invalid XML: {exc}') from exc


def packages(root):
    result = []
    for f in sorted((root / 'assets').glob('*/package.xml')):
        tree = parse_xml(f.read_bytes(), str(f))
        if tree.tag != 'packageDescription':
            raise ValueError(f'{f}: expected packageDescription')
        result.append((f.parent, tree))
    return result


def find_package(root, name):
    matches = [(p, x) for p, x in packages(root) if name in (p.name, x.get('id'))]
    if len(matches) != 1:
        raise ValueError(f'package {name!r} not found or ambiguous')
    return matches[0]


def resource_path(folder, item):
    name = item.get('name', '')
    sub = item.get('path', '/').replace('\\', '/').lstrip('/')
    if not name or '/' in name or '\\' in name or name in ('.', '..'):
        raise ValueError('invalid resource name')
    target = (folder / sub / name).resolve()
    if not target.is_relative_to(folder.resolve()):
        raise ValueError('resource path escapes package')
    return target


def find_component(root, pkg, name):
    folder, tree = find_package(root, pkg)
    matches = [x for x in tree.findall('./resources/component') if name in (x.get('id'), x.get('name'), Path(x.get('name', '')).stem)]
    if len(matches) != 1:
        raise ValueError(f'component {name!r} not found or ambiguous')
    return resource_path(folder, matches[0])


def validate_component(data):
    node = parse_xml(data, 'component')
    if node.tag != 'component':
        raise ValueError('component root must be <component>')
    lists = node.findall('displayList')
    if len(lists) > 1:
        raise ValueError('component may have at most one displayList')
    if lists:
        ids = [e.get('id') for e in lists[0]]
        if any(not x for x in ids) or len(ids) != len(set(ids)):
            raise ValueError('displayList children must have unique nonempty ids')


def execute(command, args):
    root = project_root(args['project'])
    if command == 'project_info':
        files = sorted(root.glob('*.fairy'))
        return {'root': str(root), 'projects': [{'file': str(f), 'attributes': parse_xml(f.read_bytes(), str(f)).attrib} for f in files], 'package_count': len(packages(root))}
    if command == 'list_packages':
        return [{'name': p.name, 'id': x.get('id'), 'path': str(p)} for p, x in packages(root)]
    if command == 'list_items':
        folder, tree = find_package(root, args['pkg'])
        return [{'type': x.tag, **x.attrib} for x in tree.findall('./resources/*')]
    if command in ('read_component', 'write_component'):
        f = find_component(root, args['pkg'], args['name'])
        old = f.read_bytes()
        digest = hashlib.sha256(old).hexdigest()
        if command == 'read_component':
            validate_component(old)
            return {'path': str(f), 'xml': old.decode('utf-8-sig'), 'sha256': digest}
        if args.get('expected_sha256') != digest:
            raise ValueError('expected_sha256 is required and must match current file; read it again')
        data = args['xml'].encode('utf-8')
        validate_component(data)
        # Same-directory replace prevents partially written XML after a crash.
        fd, temp = tempfile.mkstemp(prefix='.fgui-', suffix='.tmp', dir=f.parent)
        try:
            with os.fdopen(fd, 'wb') as out:
                out.write(data)
                out.flush()
                os.fsync(out.fileno())
            if hashlib.sha256(f.read_bytes()).hexdigest() != digest:
                raise ValueError('component changed during write')
            os.replace(temp, f)
        finally:
            if os.path.exists(temp):
                os.unlink(temp)
        return {'path': str(f), 'sha256': hashlib.sha256(data).hexdigest()}
    if command == 'validate':
        issues = []
        ids = set()
        for folder, tree in packages(root):
            pid = tree.get('id')
            if not pid or pid in ids:
                issues.append({'path': str(folder / 'package.xml'), 'error': 'missing or duplicate package id'})
            ids.add(pid)
            item_ids = set()
            for item in tree.findall('./resources/*'):
                try:
                    iid = item.get('id')
                    if not iid or iid in item_ids:
                        raise ValueError('missing or duplicate resource id')
                    item_ids.add(iid)
                    f = resource_path(folder, item)
                    if not f.is_file():
                        raise ValueError('registered resource file missing: ' + str(f))
                    if item.tag == 'component':
                        validate_component(f.read_bytes())
                except (ValueError, OSError) as exc:
                    issues.append({'package': folder.name, 'resource': item.get('name'), 'error': str(exc)})
        return {'valid': not issues, 'issues': issues, 'scope': 'XML structure, IDs and registered files; not runtime or publish compatibility'}
    raise ValueError('unknown command: ' + command)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['project_info', 'list_packages', 'list_items', 'read_component', 'write_component', 'validate'])
    parser.add_argument('args', help='JSON object, or @path to a UTF-8 JSON file')
    ns = parser.parse_args()
    try:
        raw = Path(ns.args[1:]).read_text(encoding='utf-8') if ns.args.startswith('@') else ns.args
        result = execute(ns.command, json.loads(raw))
        print(json.dumps({'ok': True, 'data': result}, ensure_ascii=False))
        return 0
    except (ValueError, OSError, KeyError, TypeError) as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}, ensure_ascii=False))
        return 1


if __name__ == '__main__':
    sys.exit(main())
