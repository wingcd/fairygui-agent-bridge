#!/usr/bin/env python3
"""Offline FairyGUI project operations. JSON in/out; no editor process required."""
import argparse
import hashlib
from html.parser import HTMLParser
import json
import math
import os
from pathlib import Path
import sys
import tempfile
import time
import subprocess
import re
import secrets
import shutil
import struct
from contextlib import contextmanager
from collections import Counter
from xml.parsers import expat
from xml.sax.saxutils import quoteattr
import xml.etree.ElementTree as ET
from atlas import plan as atlas_plan, plan_grouped, render
from published import inspect as inspect_published, validate_atlases
from binary_writer import encode_image_package
from pixel_hits import make_pixel_mask
from jta import read_jta
from bitmap_font import read_bitmap_font


def rename_new_directory(source, destination):
    """Retry transient Windows sharing violations without replacing output."""
    for delay in (0.05, 0.1, 0.2, 0.4, 0.8, None):
        if Path(destination).exists(): raise FileExistsError(f'output already exists: {destination}')
        try:
            os.rename(source, destination)
            return
        except OSError as exc:
            if delay is None or getattr(exc, 'winerror', None) not in (5, 32, 33): raise
            time.sleep(delay)


def atomic_replace_checked(source, destination, expected_digest):
    """Retry transient sharing failures while rechecking the source revision."""
    for delay in (0.05, 0.1, 0.2, 0.4, 0.8, None):
        if hashlib.sha256(Path(destination).read_bytes()).hexdigest() != expected_digest:
            raise ValueError('file changed during write')
        try:
            os.replace(source, destination)
            return
        except OSError as exc:
            if delay is None or getattr(exc, 'winerror', None) not in (5, 32, 33): raise
            time.sleep(delay)


def append_package_resource(data, element):
    """Add one resource without reserializing existing package XML."""
    root = parse_xml(data, 'package.xml')
    if root.tag != 'packageDescription' or len(root.findall('resources')) != 1:
        raise ValueError('package must have one resources element')
    parser, stack, bounds = expat.ParserCreate(), [], []
    def start(tag, attrs):
        if stack == ['packageDescription'] and tag == 'resources': bounds.append([parser.CurrentByteIndex, None])
        stack.append(tag)
    def end(tag):
        if stack == ['packageDescription', 'resources']: bounds[-1][1] = parser.CurrentByteIndex
        stack.pop()
    parser.StartElementHandler, parser.EndElementHandler = start, end
    parser.Parse(data, True)
    begin, close = bounds[0]
    opening_end = data.find(b'>', begin, close + 1)
    if opening_end < 0: raise ValueError('invalid resources element')
    opening = data[begin:opening_end+1]
    if opening.rstrip().endswith(b'/>'):
        slash = opening.rfind(b'/')
        result = data[:begin] + opening[:slash] + b'>' + element + b'</resources>' + data[opening_end+1:]
    else:
        result = data[:close] + b'\n    ' + element + b'\n  ' + data[close:]
    parse_xml(result, 'package.xml')
    return result


def remove_package_resource(data, ident):
    """Remove one registered resource element without rewriting the package."""
    root = parse_xml(data, 'package.xml')
    if root.tag != 'packageDescription' or len(root.findall('resources')) != 1:
        raise ValueError('package must have one resources element')
    parser, stack, spans = expat.ParserCreate(), [], []
    def start(tag, attrs):
        if stack == ['packageDescription', 'resources'] and attrs.get('id') == ident:
            spans.append([parser.CurrentByteIndex, None])
        stack.append(tag)
    def end(tag):
        if len(stack) == 3 and stack[:2] == ['packageDescription', 'resources'] and spans and spans[-1][1] is None:
            begin = spans[-1][0]
            quote = None
            for opening_end in range(begin, len(data)):
                byte = data[opening_end]
                if quote is not None:
                    if byte == quote: quote = None
                elif byte in (34, 39): quote = byte
                elif byte == 62: break
            else: raise ValueError('invalid resource element')
            position = parser.CurrentByteIndex
            spans[-1][1] = position if data[begin:opening_end].rstrip().endswith(b'/') else data.find(b'>', position) + 1
        stack.pop()
    parser.StartElementHandler, parser.EndElementHandler = start, end
    parser.Parse(data, True)
    if len(spans) != 1 or not spans[0][1]: raise ValueError('resource ID is missing or ambiguous')
    begin, end = spans[0]
    result = data[:begin] + data[end:]
    parse_xml(result, 'package.xml')
    return result


def edit_image_options(data, resource, props):
    if not isinstance(props, dict) or not props or set(props) - {'scale', 'scale9grid', 'duplicatePadding', 'exported'}:
        raise ValueError('invalid image options')
    if props.get('scale') in ('none', 'tile') and 'scale9grid' in props:
        raise ValueError('scale9grid requires 9grid scale')
    updates = {}
    for key, value in props.items():
        if key in ('duplicatePadding', 'exported'):
            if type(value) is not bool: raise ValueError(f'{key} must be a boolean')
            updates[key] = str(value).lower()
        elif key == 'scale':
            if value not in ('none', '9grid', 'tile'): raise ValueError('invalid image scale')
            updates['scale'] = None if value == 'none' else value
            if value in ('none', 'tile'): updates['scale9grid'] = None
        else:
            if not isinstance(value, str): raise ValueError('scale9grid must be four comma-separated integers')
            parts = value.split(',')
            if len(parts) != 4 or any(not re.fullmatch(r'[0-9]+', part.strip()) for part in parts): raise ValueError('invalid scale9grid')
            numbers = [int(part) for part in parts]
            if any(number > 2147483647 for number in numbers) or numbers[2] == 0 or numbers[3] == 0: raise ValueError('invalid scale9grid')
            updates['scale9grid'] = ','.join(str(number) for number in numbers)
    if 'scale' in updates or 'scale9grid' in updates:
        scale = updates.get('scale', resource.get('scale'))
        grid = updates.get('scale9grid', resource.get('scale9grid'))
        if scale == '9grid':
            if not grid: raise ValueError('9grid scale requires scale9grid')
            parts = grid.split(',')
            if len(parts) != 4 or any(not re.fullmatch(r'[0-9]+', part.strip()) for part in parts): raise ValueError('invalid scale9grid')
            numbers = [int(part) for part in parts]
            if any(number > 2147483647 for number in numbers) or numbers[2] == 0 or numbers[3] == 0: raise ValueError('invalid scale9grid')
        if scale != '9grid' and grid is not None: raise ValueError('scale9grid requires 9grid scale')
    parser, stack, found = expat.ParserCreate(), [], []
    def start(tag, attrs):
        if stack == ['packageDescription', 'resources'] and tag == 'image' and attrs.get('id') == resource.get('id'):
            found.append(parser.CurrentByteIndex)
        stack.append(tag)
    def end(tag): stack.pop()
    parser.StartElementHandler, parser.EndElementHandler = start, end
    parser.Parse(data, True)
    if len(found) != 1: raise ValueError('image resource ID is missing or ambiguous')
    begin = found[0]
    quote = None
    for end in range(begin, len(data)):
        char = data[end]
        if quote is not None:
            if char == quote: quote = None
        elif char in (34, 39): quote = char
        elif char == 62: break
    else: raise ValueError('unterminated image tag')
    tag = data[begin:end].decode('utf-8')
    for key, value in updates.items():
        pattern = r'\s+' + re.escape(key) + r'\s*=\s*(?:"[^"]*"|\'[^\']*\')'
        if value is None:
            tag = re.sub(pattern, '', tag, count=1)
        elif re.search(pattern, tag):
            tag = re.sub(pattern, lambda match: ' ' + key + '=' + quoteattr(value), tag, count=1)
        else:
            pos = len(tag.rstrip())
            if tag[:pos].endswith('/'): pos -= 1
            tag = tag[:pos] + ' ' + key + '=' + quoteattr(value) + tag[pos:]
    result = data[:begin] + tag.encode('utf-8') + data[end:]
    parse_xml(result, 'package.xml')
    return result


def package_directory_parts(value):
    if not isinstance(value, str): raise ValueError('package path must be a string')
    parts = [part for part in value.replace('\\', '/').split('/') if part]
    if any(part in ('.', '..') or part != part.strip() or part.endswith('.') or not re.fullmatch(r'[\w .\-]{1,100}', part, re.UNICODE) for part in parts):
        raise ValueError('invalid package path')
    return parts


def create_package_directories(folder, parts, created):
    current = folder
    for part in parts:
        current = current / part
        if not current.resolve().is_relative_to(folder.resolve()): raise ValueError('package path escapes package')
        if not current.exists():
            current.mkdir()
            created.append(current)
        if not current.is_dir(): raise ValueError('package path is not a directory')


def remove_empty_directories(created):
    for directory in reversed(created):
        try: directory.rmdir()
        except OSError: pass


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
    # Inspect the XML prolog with an encoding-aware parser. A byte search alone
    # misses declarations in UTF-16, while parsing the full document here would
    # needlessly duplicate the main parse. XML permits a DTD only before root.
    class RootFound(Exception): pass
    parser = expat.ParserCreate()
    def reject_declaration(*_):
        raise ValueError(f'{label}: DTD/entity declarations are not supported')
    def root_found(*_):
        raise RootFound()
    parser.StartDoctypeDeclHandler = reject_declaration
    parser.EntityDeclHandler = reject_declaration
    parser.StartElementHandler = root_found
    try:
        parser.Parse(data, True)
    except RootFound:
        pass
    except expat.ExpatError:
        # ElementTree below provides the usual contextual parse error.
        pass
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


class PublishSnapshot:
    """Detect persistent external edits to inputs read during publication."""
    def __init__(self):
        self.digests = {}

    @staticmethod
    def digest(path):
        try:
            with Path(path).open('rb') as source:
                digest = hashlib.sha256()
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    digest.update(chunk)
                return digest.hexdigest()
        except (FileNotFoundError, IsADirectoryError):
            return None

    def remember(self, path, digest):
        path = Path(path)
        if path in self.digests and self.digests[path] != digest:
            raise ValueError(f'publication source changed: {path}')
        self.digests[path] = digest

    def track(self, path):
        self.remember(path, self.digest(path))

    def read_package(self, folder, track_dependencies=True):
        package_file = folder / 'package.xml'
        data = package_file.read_bytes()
        self.remember(package_file, hashlib.sha256(data).hexdigest())
        tree = parse_xml(data, str(package_file))
        if tree.tag != 'packageDescription': raise ValueError('expected packageDescription')
        # Dependency discovery can read any component or font in this package.
        for item in tree.findall('./resources/*') if track_dependencies else ():
            if item.tag in ('component', 'font'):
                try: path = resource_path(folder, item)
                except ValueError: continue
                self.track(path)
        return tree

    def verify(self):
        for path, expected in self.digests.items():
            if self.digest(path) != expected:
                raise ValueError(f'publication source changed: {path}')


class RichTextImages(HTMLParser):
    """Collect static image sources from rich text without treating links as assets."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.urls = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'img':
            for name, value in attrs:
                if name.lower() == 'src' and value and value.startswith('ui://'):
                    self.urls.append(value)

    handle_startendtag = handle_starttag


def rich_text_resource_urls(value, ubb):
    if ubb:
        # FairyGUI treats a backslash before '[' as an escaped literal tag.
        for match in re.finditer(r'(?<!\\)\[(?i:img)(?:=[^\]]*)?\](ui://[^\[]+)(?=\[)', value):
            yield match.group(1)
    parser = RichTextImages()
    parser.feed(value)
    yield from parser.urls


def component_resource_urls(component):
    """Yield UI URLs only from fields that represent resource references."""
    rich_text_targets = {item.get('id'): item for item in component.findall('./displayList/richtext') if item.get('id')}
    for action in component.findall('./transition/item'):
        target = rich_text_targets.get(action.get('target'))
        if action.get('type') == 'Text' and target is not None:
            for key in ('value', 'startValue', 'endValue'):
                value = action.get(key)
                if value:
                    for url in rich_text_resource_urls(value, target.get('ubb') == 'true'):
                        yield action, key, url
    for element in component.iter():
        if element.tag == 'richtext':
            fields = [(element, 'text')]
            fields.extend((gear, key) for gear in element.findall('gearText') for key in ('values', 'default'))
            for owner, key in fields:
                value = owner.get(key)
                if value:
                    for url in rich_text_resource_urls(value, element.get('ubb') == 'true'):
                        yield owner, key, url
        for key, value in element.attrib.items():
            url_field = key in ('font', 'url', 'defaultItem', 'icon', 'selectedIcon', 'titleIcon', 'scrollBarRes', 'ptrRes', 'dropdown', 'sound')
            url_field |= element.tag == 'gearIcon' and key in ('values', 'default')
            url_field |= element.tag == 'item' and element.get('type') in ('Sound', 'Icon') and key in ('value', 'startValue', 'endValue')
            if url_field:
                for url in re.split(r'[,|]', value):
                    if url.startswith('ui://'): yield element, key, url


def project_url_dependencies(folder, tree, items, by_name, by_id):
    dependencies = {}
    for item in items:
        if item.tag != 'component': continue
        component = parse_xml(resource_path(folder, item).read_bytes(), 'component')
        for _, _, url in component_resource_urls(component):
            address = url[5:]
            if '/' in address:
                owner, name = address.split('/', 1)
                target = by_name.get(owner)
                matches = [] if target is None else [resource for resource in target[2] if Path(resource.get('name', '')).stem == name]
            else:
                target = by_id.get(address[:8])
                matches = [] if target is None else [resource for resource in target[2] if resource.get('id') == address[8:]]
            if target is None or len(matches) != 1:
                raise ValueError(f"{folder.name}/{item.get('name')}: UI URL not included in project publication: {url}")
            target_id = target[1].get('id')
            if target_id != tree.get('id'): dependencies[target_id] = {'id': target_id, 'name': target[0].name}
    return dependencies


def select_exported_resources(folder, package):
    """Conservatively resolve exported items and their same-package dependencies."""
    items = package.findall('./resources/*')
    by_id, by_name = {}, {}
    for item in items:
        ident = item.get('id')
        if not ident or ident in by_id: raise ValueError('missing or duplicate resource id')
        by_id[ident] = item
        by_name.setdefault(Path(item.get('name', '')).stem, []).append(ident)
    package_id = package.get('id', '')
    todo = [item.get('id') for item in items if item.get('exported') == 'true']
    selected = set()
    while todo:
        ident = todo.pop()
        if ident in selected: continue
        item = by_id.get(ident)
        if item is None: raise ValueError(f'missing published dependency {ident}')
        selected.add(ident)
        if item.tag == 'font':
            font = read_bitmap_font(resource_path(folder, item).read_bytes(), item.get('texture'))
            if font['texture']: todo.append(font['texture'])
            todo.extend(glyph['image'] for glyph in font['glyphs'] if glyph['image'])
        if item.tag != 'component': continue
        component = parse_xml(resource_path(folder, item).read_bytes(), 'component')
        validate_component(ET.tostring(component, encoding='utf-8'))
        for child in component.findall('./displayList/*'):
            if child.get('src') and (not child.get('pkg') or child.get('pkg') in (package_id, folder.name)):
                todo.append(child.get('src'))
        for _, _, candidate in component_resource_urls(component):
            address = candidate[5:]
            if '/' in address:
                owner, name = address.split('/', 1)
                if owner != folder.name: continue
                matches = by_name.get(name, [])
                if len(matches) != 1: raise ValueError(f'unknown or ambiguous UI URL {candidate}')
                todo.append(matches[0])
            elif package_id and address.startswith(package_id):
                todo.append(address[len(package_id):])
    return [item for item in items if item.get('id') in selected]


def project_resource_index(all_packages):
    """Index package aliases, declining to resolve ambiguous identifiers."""
    candidates = {}
    for folder, tree in all_packages:
        resources = {item.get('id'): item.tag for item in tree.findall('./resources/*') if item.get('id')}
        for alias in {folder.name, tree.get('id')} - {None, ''}:
            candidates.setdefault(alias, []).append(resources)
    return {alias: values[0] for alias, values in candidates.items() if len(values) == 1}


def project_url_index(all_packages):
    """Count exact static UI URLs; duplicate addresses cannot be resolved safely."""
    addresses = Counter()
    for folder, tree in all_packages:
        package_id = tree.get('id')
        for item in tree.findall('./resources/*'):
            ident, name = item.get('id'), item.get('name')
            if package_id and ident:
                addresses['ui://' + package_id + ident] += 1
            if name:
                addresses['ui://' + folder.name + '/' + Path(name).stem] += 1
    return addresses


def component_reference_issues(node, resource_index, current_package, url_index=None):
    """Check references that can be resolved from project XML without publishing."""
    issues = []
    children = node.findall('./displayList/*')
    child_ids = {child.get('id') for child in children}
    group_ids = {child.get('id') for child in children if child.tag == 'group'}
    if url_index is not None:
        for owner, field, url in component_resource_urls(node):
            if url_index[url] != 1:
                issues.append(f'{owner.tag} {field} references unknown or ambiguous UI URL {url}')
    for attribute in ('mask', 'hitTest'):
        target = node.get(attribute)
        if target and target not in child_ids:
            issues.append(f'component {attribute} references unknown child {target}')
    if node.get('reversedMask') == 'true' and not node.get('mask'):
        issues.append('component reversedMask requires a mask')
    controllers = {}
    for controller in node.findall('controller'):
        name = controller.get('name')
        parts = controller.get('pages', '').split(',') if controller.get('pages') else []
        if not name or name in controllers or len(parts) % 2 or any(not page for page in parts[::2]) or len(parts[::2]) != len(set(parts[::2])):
            issues.append('invalid or duplicate controller or page IDs')
            continue
        controllers[name] = set(parts[::2])
    for child in children:
        label = child.get('id', '?')
        if child.get('src'):
            package = child.get('pkg') or current_package
            resources = resource_index.get(package)
            if resources is None:
                issues.append(f'child {label}: unknown package {package}')
            elif child.get('src') not in resources:
                issues.append(f'child {label}: unknown resource {child.get("src")} in package {package}')
            else:
                expected = {'image': 'image', 'component': 'component', 'movieclip': 'movieclip', 'jta': 'movieclip'}.get(child.tag)
                if expected and resources[child.get('src')] != expected:
                    issues.append(f'child {label}: {child.tag} requires {expected} resource, got {resources[child.get("src")]}')
        group = child.get('group')
        if group and group not in group_ids:
            issues.append(f'child {label}: unknown group {group}')
        if child.tag in ('list', 'tree'):
            for key in ('pageController', 'selectionController'):
                controller = child.get(key)
                if controller and controller not in controllers:
                    issues.append(f'child {label}: {key} references unknown controller {controller}')
        for button in child.findall('Button'):
            controller, page = button.get('controller'), button.get('page')
            if controller and controller not in controllers:
                issues.append(f'child {label}: Button references unknown controller {controller}')
            elif page and (not controller or page not in controllers[controller]):
                issues.append(f'child {label}: Button references unknown page {page} in controller {controller or "?"}')
        for gear in child:
            if not gear.tag.startswith('gear'): continue
            controller = gear.get('controller')
            if controller not in controllers:
                issues.append(f'child {label}: {gear.tag} references unknown controller {controller}')
                continue
            for page in filter(None, gear.get('pages', '').split(',')):
                if page not in controllers[controller]:
                    issues.append(f'child {label}: {gear.tag} references unknown page {page} in controller {controller}')
        for relation in child.findall('relation'):
            target = relation.get('target')
            if target and (target not in child_ids or target == child.get('id')):
                issues.append(f'child {label}: relation references invalid target {target}')
    for relation in node.findall('relation'):
        target = relation.get('target')
        if target and target not in child_ids:
            issues.append(f'component relation references unknown target {target}')
    for transition in node.findall('transition'):
        for item in transition.findall('item'):
            target = item.get('target')
            if target and target not in child_ids:
                issues.append(f'transition {transition.get("name", "?")}: unknown target {target}')
    transition_names = {transition.get('name') for transition in node.findall('transition')}
    for controller in node.findall('controller'):
        name = controller.get('name')
        if name not in controllers: continue
        for action in controller.findall('action'):
            for key in ('fromPage', 'toPage'):
                for page in filter(None, action.get(key, '').split(',')):
                    if page not in controllers[name]:
                        issues.append(f'controller {name}: action {key} references unknown page {page}')
            if action.get('type') == 'play_transition' and action.get('transition') and action.get('transition') not in transition_names:
                issues.append(f'controller {name}: action references unknown transition {action.get("transition")}')
    return issues


def controller_page_attributes(pages, selected):
    if not isinstance(pages, list) or len(pages) > 256: raise ValueError('pages must be a list of at most 256 entries')
    ids, parts = set(), []
    for page in pages:
        if not isinstance(page, dict) or set(page) != {'id', 'name'}: raise ValueError('each page requires id and name')
        ident, name = page['id'], page['name']
        if not isinstance(ident, str) or not re.fullmatch(r'[A-Za-z0-9_]{1,64}', ident) or ident in ids:
            raise ValueError('invalid or duplicate page ID')
        if not isinstance(name, str) or len(name) > 128 or ',' in name: raise ValueError('invalid page name')
        ids.add(ident); parts.extend((ident, name))
    if type(selected) is not int or selected < 0 or (pages and selected >= len(pages)) or (not pages and selected != 0):
        raise ValueError('invalid selected page index')
    return ids, ','.join(parts)


def edit_controller_pages(data, name, pages, selected, create):
    validate_component(data)
    if not isinstance(name, str) or not name or len(name) > 100: raise ValueError('invalid controller name')
    root = parse_xml(data, 'component')
    matches = [ctrl for ctrl in root.findall('controller') if ctrl.get('name') == name]
    if create and matches: raise ValueError('controller already exists')
    if not create and len(matches) != 1: raise ValueError('controller not found or ambiguous')
    if selected is None:
        try: selected = 0 if create else int(matches[0].get('selected', '0'))
        except ValueError: raise ValueError('invalid selected page index')
    page_ids, encoded_pages = controller_page_attributes(pages, selected)
    if not create:
        for action in matches[0].findall('action'):
            for key in ('fromPage', 'toPage'):
                if any(page not in page_ids for page in filter(None, action.get(key, '').split(','))):
                    raise ValueError('controller action references removed page')
        for child in root.findall('./displayList/*'):
            button = child.find('Button')
            if button is not None and button.get('controller') == name and button.get('page') and button.get('page') not in page_ids:
                raise ValueError('button references removed page')
    parser, stack, positions = expat.ParserCreate(), [], []
    def start(tag, attrs):
        if stack == ['component'] and ((create and tag == 'displayList') or (not create and tag == 'controller' and attrs.get('name') == name)):
            positions.append(parser.CurrentByteIndex)
        stack.append(tag)
    def end(tag): stack.pop()
    parser.StartElementHandler, parser.EndElementHandler = start, end
    parser.Parse(data, True)
    if len(positions) != 1: raise ValueError('component must have one displayList or matching controller')
    begin = positions[0]
    if create:
        element = ('<controller name=' + quoteattr(name) + ' pages=' + quoteattr(encoded_pages) + ' selected=' + quoteattr(str(selected)) + '/>\n  ').encode('utf-8')
        result = data[:begin] + element + data[begin:]
    else:
        quote = None
        for end in range(begin, len(data)):
            char = data[end]
            if quote is not None:
                if char == quote: quote = None
            elif char in (34, 39): quote = char
            elif char == 62: break
        else: raise ValueError('unterminated controller tag')
        tag = data[begin:end].decode('utf-8')
        for key, value in (('pages', encoded_pages), ('selected', str(selected))):
            pattern = r'(?<![^\s])' + key + r'\s*=\s*(?:"[^"]*"|\'[^\']*\')'
            attr = key + '=' + quoteattr(value)
            if re.search(pattern, tag): tag = re.sub(pattern, lambda match: attr, tag, count=1)
            else:
                pos = len(tag.rstrip())
                if tag[:pos].endswith('/'): pos -= 1
                tag = tag[:pos] + ' ' + attr + tag[pos:]
        result = data[:begin] + tag.encode('utf-8') + data[end:]
    validate_component(result)
    return result


def edit_extension_instance(data, target, props, root, package, extension):
    """Edit a registered Button or Label instance without rewriting surrounding XML."""
    if extension not in ('Button', 'Label'): raise ValueError('unsupported extension')
    if not isinstance(target, str) or not target: raise ValueError('target must be a nonempty string')
    allowed = {'title', 'icon', 'titleColor', 'titleFontSize'}
    if extension == 'Button': allowed |= {'selectedTitle', 'selectedIcon', 'checked'}
    if not isinstance(props, dict) or not props or set(props) - allowed: raise ValueError(f'invalid {extension} instance properties')
    node = parse_xml(data, 'component')
    matches = [item for item in node.findall('./displayList/*') if target in (item.get('id'), item.get('name'))]
    if len(matches) != 1: raise ValueError('target child not found or ambiguous')
    child = matches[0]
    if child.tag != 'component' or not child.get('src'): raise ValueError(f'target must reference a {extension} component')
    folder, source_package = find_package(root, child.get('pkg') or package)
    resources = [item for item in source_package.findall('./resources/component') if item.get('id') == child.get('src')]
    if len(resources) != 1: raise ValueError(f'{extension} component resource not found or ambiguous')
    source = resource_path(folder, resources[0])
    if not source.is_file() or parse_xml(source.read_bytes(), f'{extension} component').get('extention') != extension:
        raise ValueError(f'target must reference a {extension} component')
    settings = child.findall(extension)
    existing_allowed = allowed | ({'controller', 'page'} if extension == 'Button' else set())
    if len(settings) > 1 or any(set(item.attrib) - existing_allowed or len(item) or (item.text or '').strip() for item in settings):
        raise ValueError(f'unsupported or duplicate {extension} instance settings')
    attrs = dict(settings[0].attrib) if settings else {}
    for key, value in props.items():
        if key == 'checked':
            if type(value) is not bool: raise ValueError('checked must be a boolean')
            value = str(value).lower()
        elif key == 'titleFontSize':
            if type(value) is not int or not 0 <= value <= 2147483647: raise ValueError(f'invalid {extension} titleFontSize')
            value = str(value)
        elif not isinstance(value, str): raise ValueError(key + ' must be a string')
        if key == 'titleColor' and not re.fullmatch(r'#[0-9a-fA-F]{6}', value): raise ValueError(f'invalid {extension} titleColor')
        if key in ('icon', 'selectedIcon') and value:
            if not value.startswith('ui://'): raise ValueError(f'{extension} icon must be a registered UI URL or empty')
            address = value[5:]
            if '/' in address:
                owner, name = address.split('/', 1)
                icon_folder, icon_package = find_package(root, owner)
                if icon_folder.name != owner: raise ValueError(f'{extension} icon URL requires a package name')
                icons = [item for item in icon_package.findall('./resources/*') if Path(item.get('name', '')).stem == name]
            else:
                icon_folder, icon_package = find_package(root, address[:8])
                if icon_package.get('id') != address[:8]: raise ValueError(f'{extension} icon URL requires a package ID')
                icons = [item for item in icon_package.findall('./resources/*') if item.get('id') == address[8:]]
            if len(icons) != 1 or icons[0].tag not in ('image', 'component', 'movieclip') or not resource_path(icon_folder, icons[0]).is_file():
                raise ValueError(f'{extension} icon resource not found or ambiguous')
        attrs[key] = value
    element = ('<' + extension + ''.join(' ' + key + '=' + quoteattr(value) for key, value in attrs.items()) + '/>').encode('utf-8')
    return upsert_child_element(data, child, extension, element)


def set_child_gear(data, target, controller, pages, kind, values=None, default=None, project=None, package=None, tween=None, condition=None):
    """Create or replace a supported child gear without reserializing XML."""
    validate_component(data)
    if not isinstance(target, str) or not target or not isinstance(controller, str) or not controller:
        raise ValueError('target and controller must be nonempty strings')
    root = parse_xml(data, 'component')
    controllers = [item for item in root.findall('controller') if item.get('name') == controller]
    if len(controllers) != 1: raise ValueError('controller not found or ambiguous')
    parts = controllers[0].get('pages', '').split(',') if controllers[0].get('pages') else []
    if len(parts) % 2: raise ValueError('invalid controller pages')
    if not isinstance(pages, list) or len(pages) > 32767 or any(not isinstance(page, str) or not page for page in pages) or len(set(pages)) != len(pages):
        raise ValueError('pages must be a list of unique page IDs')
    if any(page not in parts[::2] for page in pages): raise ValueError('gear references unknown page')
    if kind not in ('gearDisplay', 'gearDisplay2', 'gearText', 'gearColor', 'gearXY', 'gearSize', 'gearLook', 'gearFontSize', 'gearAni', 'gearIcon'): raise ValueError('unsupported gear type')
    if kind == 'gearDisplay2':
        if type(condition) is not int or condition not in (0, 1): raise ValueError('display2 condition must be 0 (and) or 1 (or)')
    elif condition is not None: raise ValueError('condition is supported only for display2')
    if tween is not None and kind not in ('gearXY', 'gearSize', 'gearLook'): raise ValueError('tween is unsupported for this gear')
    if kind == 'gearText':
        if not pages or not isinstance(values, list) or len(values) != len(pages) or any(not isinstance(value, str) or '|' in value for value in values):
            raise ValueError('text gear requires one pipe-free string per page')
        if default is not None and not isinstance(default, str): raise ValueError('text gear default must be a string')
    if kind == 'gearIcon':
        if not pages or not isinstance(values, list) or len(values) != len(pages) or any(not isinstance(value, str) or '|' in value or ',' in value for value in values):
            raise ValueError('icon gear requires one string without pipe or comma per page')
        if default is not None and (not isinstance(default, str) or '|' in default or ',' in default): raise ValueError('invalid icon gear default')
        catalog = None
        for url in dict.fromkeys(values + ([default] if default is not None else [])):
            if not url.startswith('ui://'): continue
            address = url[5:]
            if catalog is None: catalog = packages(project)
            if '/' in address:
                owner, name = address.split('/', 1)
                owners = [(folder, tree) for folder, tree in catalog if folder.name == owner]
                if len(owners) != 1: raise ValueError(f'icon gear package not found or ambiguous: {owner}')
                folder, url_package = owners[0]
                matches = [item for item in url_package.findall('./resources/*') if Path(item.get('name', '')).stem == name]
            else:
                owners = [(folder, tree) for folder, tree in catalog if tree.get('id') == address[:8]]
                if len(owners) != 1: raise ValueError(f'icon gear package not found or ambiguous: {address[:8]}')
                folder, url_package = owners[0]
                matches = [item for item in url_package.findall('./resources/*') if item.get('id') == address[8:]]
            if len(matches) != 1 or matches[0].tag not in ('image', 'component', 'movieclip') or not resource_path(folder, matches[0]).is_file():
                raise ValueError(f'icon gear resource not found or ambiguous: {url}')
    if kind == 'gearFontSize':
        def valid_font_size(value):
            if not isinstance(value, str) or not re.fullmatch(r'[0-9]{1,10}', value): return False
            return int(value) <= 2147483647
        if not pages or not isinstance(values, list) or len(values) != len(pages) or any(value != '-' and not valid_font_size(value) for value in values):
            raise ValueError('font size gear requires one nonnegative integer or - per page')
        if default is not None and not valid_font_size(default): raise ValueError('invalid font size gear default')
    if kind == 'gearAni':
        def valid_animation(value):
            if not isinstance(value, str) or not re.fullmatch(r'[0-9]{1,10},[ps]', value): return False
            return int(value.split(',')[0]) <= 2147483647
        if not pages or not isinstance(values, list) or len(values) != len(pages) or any(value != '-' and not valid_animation(value) for value in values):
            raise ValueError('animation gear requires one frame,p or frame,s value or - per page')
        if default is not None and not valid_animation(default): raise ValueError('invalid animation gear default')
    if kind == 'gearColor':
        def valid_color(value):
            return isinstance(value, str) and bool(re.fullmatch(r'#[0-9a-fA-F]{6}(?:,#[0-9a-fA-F]{6})?', value))
        if not pages or not isinstance(values, list) or len(values) != len(pages) or any(value != '-' and not valid_color(value) for value in values):
            raise ValueError('color gear requires one color, color pair, or - per page')
        if default is not None and not valid_color(default): raise ValueError('invalid color gear default')
    if kind in ('gearXY', 'gearSize'):
        def valid_transform(value):
            if not isinstance(value, str): return False
            parts = value.split(',')
            if len(parts) not in ((2, 4) if kind == 'gearSize' else (2,)): return False
            try:
                dimensions = [int(part) for part in parts[:2]]
                scale = [float(part) for part in parts[2:]]
            except ValueError: return False
            if any(not -2147483648 <= number <= 2147483647 for number in dimensions): return False
            if kind == 'gearSize' and any(number < 0 for number in dimensions): return False
            return all(math.isfinite(number) and abs(number) <= 100000 for number in scale)
        if not pages or not isinstance(values, list) or len(values) != len(pages) or any(value != '-' and not valid_transform(value) for value in values):
            raise ValueError('transform gear requires one valid value or - per page')
        if default is not None and not valid_transform(default): raise ValueError('invalid transform gear default')
    if kind == 'gearLook':
        def valid_look(value):
            if not isinstance(value, str): return False
            parts = value.split(',')
            if len(parts) not in (3, 4) or any(part not in ('0', '1') for part in parts[2:]): return False
            try: alpha, rotation = float(parts[0]), float(parts[1])
            except ValueError: return False
            return math.isfinite(alpha) and math.isfinite(rotation) and 0 <= alpha <= 1 and abs(rotation) <= 100000
        if not pages or not isinstance(values, list) or len(values) != len(pages) or any(value != '-' and not valid_look(value) for value in values):
            raise ValueError('look gear requires one valid value or - per page')
        if default is not None and not valid_look(default): raise ValueError('invalid look gear default')
    matches = [child for child in root.findall('./displayList/*') if target in (child.get('id'), child.get('name'))]
    if len(matches) != 1: raise ValueError('target child not found or ambiguous')
    selected = matches[0]
    if kind in ('gearText', 'gearFontSize') and selected.tag not in ('text', 'richtext', 'inputtext'):
        raise ValueError('text or font size gear requires a text object')
    if kind == 'gearAni' and selected.tag not in ('movieclip', 'jta', 'loader'):
        raise ValueError('animation gear requires a movieclip or loader object')
    if kind == 'gearIcon':
        if selected.tag == 'component' and selected.get('src'):
            folder, source_package = find_package(project, selected.get('pkg') or package)
            resources = [item for item in source_package.findall('./resources/component') if item.get('id') == selected.get('src')]
            if len(resources) != 1: raise ValueError('icon gear component resource not found or ambiguous')
            source = resource_path(folder, resources[0])
            if not source.is_file() or parse_xml(source.read_bytes(), 'component').get('extention') not in ('Label', 'Button', 'ComboBox'):
                raise ValueError('icon gear requires an icon-capable component')
        elif selected.tag != 'loader':
            raise ValueError('icon gear requires a loader or icon-capable component')
    if kind == 'gearColor':
        if selected.tag == 'component' and selected.get('src'):
            folder, source_package = find_package(project, selected.get('pkg') or package)
            resources = [item for item in source_package.findall('./resources/component') if item.get('id') == selected.get('src')]
            if len(resources) != 1: raise ValueError('color gear component resource not found or ambiguous')
            source = resource_path(folder, resources[0])
            if not source.is_file() or parse_xml(source.read_bytes(), 'component').get('extention') not in ('Label', 'Button', 'ComboBox'):
                raise ValueError('color gear requires a color-capable component')
        elif selected.tag not in ('text', 'richtext', 'inputtext', 'image', 'movieclip', 'loader', 'graph'):
            raise ValueError('color gear requires a color-capable object')
    gears = selected.findall(kind)
    allowed = {'controller', 'pages'} if kind in ('gearDisplay', 'gearDisplay2') else {'controller', 'pages', 'values', 'default'}
    if kind == 'gearDisplay2': allowed.add('condition')
    if kind in ('gearXY', 'gearSize', 'gearLook'): allowed |= {'tween', 'ease', 'duration', 'delay'}
    if len(gears) > 1 or any(set(gear.attrib) - allowed or len(gear) or (gear.text or '').strip() for gear in gears):
        raise ValueError('unsupported or duplicate gear')
    attrs = ' controller=' + quoteattr(controller) + ' pages=' + quoteattr(','.join(pages))
    if kind == 'gearDisplay2': attrs += ' condition=' + quoteattr(str(condition))
    if kind not in ('gearDisplay', 'gearDisplay2'):
        attrs += ' values=' + quoteattr('|'.join(values))
        if default is not None: attrs += ' default=' + quoteattr(default)
    if kind in ('gearXY', 'gearSize', 'gearLook'):
        names = ['Linear'] + [f'{family}.{mode}' for family in ('Sine', 'Quad', 'Cubic', 'Quart', 'Quint', 'Expo', 'Circ', 'Elastic', 'Back', 'Bounce') for mode in ('In', 'Out', 'InOut')]
        existing = {key: gears[0].get(key) for key in ('tween', 'ease', 'duration', 'delay') if gears and key in gears[0].attrib}
        if tween is not None:
            if not isinstance(tween, dict) or set(tween) - {'enabled', 'ease', 'duration', 'delay'} or type(tween.get('enabled')) is not bool:
                raise ValueError('invalid gear tween settings')
            if not tween['enabled'] and len(tween) != 1: raise ValueError('disabled tween cannot specify timing or easing')
            existing = {'tween': 'true'} if tween['enabled'] else {}
            if tween['enabled']:
                for key in ('ease', 'duration', 'delay'):
                    if key in tween:
                        value = tween[key]
                        if key != 'ease' and (type(value) not in (int, float) or not math.isfinite(value)):
                            raise ValueError('invalid gear tween timing')
                        existing[key] = str(value)
        if existing.get('tween', 'false') not in ('true', 'false') or (existing.get('tween', 'false') == 'false' and set(existing) - {'tween'}):
            raise ValueError('invalid existing gear tween settings')
        if 'ease' in existing and existing['ease'] not in names: raise ValueError('invalid gear tween easing')
        for key in ('duration', 'delay'):
            if key in existing:
                try: number = float(existing[key])
                except ValueError: raise ValueError('invalid gear tween timing')
                if not math.isfinite(number) or not 0 <= number <= 100000: raise ValueError('invalid gear tween timing')
        attrs += ''.join(' ' + key + '=' + quoteattr(value) for key, value in existing.items())
    element = ('<' + kind + attrs + '/>').encode('utf-8')
    return upsert_child_element(data, selected, kind, element)


def upsert_child_element(data, selected, kind, element, relation_target=None):
    ident = selected.get('id')
    parser, stack = expat.ParserCreate(), []
    state = {'active': False, 'begin': None, 'close': None, 'gear': None}
    def tag_end(begin):
        quote = None
        for end in range(begin, len(data)):
            char = data[end]
            if quote is not None:
                if char == quote: quote = None
            elif char in (34, 39): quote = char
            elif char == 62: return end
        raise ValueError('unterminated XML tag')
    def start(tag, attrs):
        if stack == ['component', 'displayList'] and attrs.get('id') == ident:
            state['active'] = True
            state['begin'] = parser.CurrentByteIndex
        elif state['active'] and len(stack) == 3 and tag == kind and (relation_target is None or attrs.get('target', '') == relation_target):
            state['matching'] = True
            state['gear'] = [parser.CurrentByteIndex, None]
        stack.append(tag)
    def end(tag):
        if state['active'] and len(stack) == 4 and tag == kind and state.get('matching'):
            begin = state['gear'][0]
            opening_end = tag_end(begin)
            state['gear'][1] = opening_end + 1 if data[begin:opening_end].rstrip().endswith(b'/') else tag_end(parser.CurrentByteIndex) + 1
            state['matching'] = False
        elif state['active'] and len(stack) == 3:
            state['close'] = parser.CurrentByteIndex
            state['active'] = False
        stack.pop()
    parser.StartElementHandler, parser.EndElementHandler = start, end
    parser.Parse(data, True)
    if state['begin'] is None or state['close'] is None: raise ValueError('could not locate target child')
    if state['gear'] is None and not element: raise ValueError('child behavior not found')
    if state['gear'] is not None:
        begin, end = state['gear']
        result = data[:begin] + element + data[end:]
    else:
        begin = state['begin']
        opening_end = tag_end(begin)
        opening = data[begin:opening_end + 1]
        if opening[:-1].rstrip().endswith(b'/'):
            slash = opening.rfind(b'/')
            replacement = opening[:slash] + b'>' + element + b'</' + selected.tag.encode('utf-8') + b'>'
            result = data[:begin] + replacement + data[opening_end + 1:]
        else:
            result = data[:state['close']] + b'\n      ' + element + b'\n    ' + data[state['close']:]
    validate_component(result)
    return result


RELATION_TYPES = ('left-left', 'left-center', 'left-right', 'center-center', 'right-left', 'right-center', 'right-right', 'top-top', 'top-middle', 'top-bottom', 'middle-middle', 'bottom-top', 'bottom-middle', 'bottom-bottom', 'width-width', 'height-height', 'leftext-left', 'leftext-right', 'rightext-left', 'rightext-right', 'topext-top', 'topext-bottom', 'bottomext-top', 'bottomext-bottom')


def set_child_relation(data, target, related_to, side_pairs):
    validate_component(data)
    if not isinstance(target, str) or not target or not isinstance(related_to, str): raise ValueError('invalid relation target')
    root = parse_xml(data, 'component')
    children = root.findall('./displayList/*')
    matches = [child for child in children if target in (child.get('id'), child.get('name'))]
    if len(matches) != 1: raise ValueError('target child not found or ambiguous')
    selected = matches[0]
    if related_to:
        matches = [child for child in children if related_to in (child.get('id'), child.get('name'))]
        if len(matches) != 1: raise ValueError('relation target not found or ambiguous')
        related_to = matches[0].get('id')
        if related_to == selected.get('id'): raise ValueError('relation cannot target itself')
    aliases = {'width': 'width-width', 'height': 'height-height'}
    if not isinstance(side_pairs, list) or not side_pairs or len(side_pairs) > 255 or any(not isinstance(pair, str) or aliases.get(pair, pair) not in RELATION_TYPES for pair in side_pairs):
        raise ValueError('invalid relation side pairs')
    if len({aliases.get(pair, pair) for pair in side_pairs}) != len(side_pairs): raise ValueError('duplicate relation side pair')
    relations = [relation for relation in selected.findall('relation') if relation.get('target', '') == related_to]
    if len(relations) > 1 or any(set(relation.attrib) != {'target', 'sidePair'} or len(relation) or (relation.text or '').strip() for relation in relations):
        raise ValueError('unsupported or duplicate relation for target')
    element = ('<relation target=' + quoteattr(related_to) + ' sidePair=' + quoteattr(','.join(side_pairs)) + '/>').encode('utf-8')
    return upsert_child_element(data, selected, 'relation', element, related_to)


def remove_child_behavior(data, target, kind, related_to=None):
    validate_component(data)
    if not isinstance(target, str) or not target: raise ValueError('target must be a nonempty string')
    root = parse_xml(data, 'component')
    children = root.findall('./displayList/*')
    matches = [child for child in children if target in (child.get('id'), child.get('name'))]
    if len(matches) != 1: raise ValueError('target child not found or ambiguous')
    selected = matches[0]
    if kind == 'relation':
        if not isinstance(related_to, str): raise ValueError('invalid relation target')
        if related_to:
            matches = [child for child in children if related_to in (child.get('id'), child.get('name'))]
            if len(matches) != 1: raise ValueError('relation target not found or ambiguous')
            related_to = matches[0].get('id')
        matches = [item for item in selected.findall(kind) if item.get('target', '') == related_to]
    else:
        matches = selected.findall(kind)
    if len(matches) != 1: raise ValueError('child behavior not found or ambiguous')
    return upsert_child_element(data, selected, kind, b'', related_to if kind == 'relation' else None)


def validate_child_properties(props):
    if not isinstance(props, dict) or not props:
        raise ValueError('props must be a nonempty object')
    allowed = {'name', 'xy', 'size', 'scale', 'pivot', 'anchor', 'rotation', 'alpha', 'visible', 'touchable', 'grayed', 'text', 'color', 'font', 'fontSize', 'align', 'vAlign', 'autoSize', 'leading', 'letterSpacing', 'bold', 'italic', 'underline', 'singleLine', 'ubb'}
    if any(k not in allowed or not isinstance(v, (str, int, float, bool)) for k, v in props.items()):
        raise ValueError('unsupported property or value')
    for key, value in props.items():
        if key in ('visible', 'touchable', 'anchor', 'grayed', 'bold', 'italic', 'underline', 'singleLine', 'ubb'):
            if type(value) is not bool and value not in ('true', 'false'):
                raise ValueError(f'{key} must be true or false')
        elif key in ('xy', 'size'):
            parts = str(value).split(',')
            if len(parts) != 2 or any(not re.fullmatch(r'[+-]?[0-9]+', part.strip()) for part in parts):
                raise ValueError(f'{key} must be two comma-separated integers')
            numbers = [int(part) for part in parts]
            if any(number < -2147483648 or number > 2147483647 for number in numbers) or (key == 'size' and any(number < 0 for number in numbers)):
                raise ValueError(f'invalid {key}')
        elif key in ('scale', 'pivot'):
            parts = str(value).split(',')
            try: numbers = [float(part) for part in parts]
            except ValueError: raise ValueError(f'{key} must be two comma-separated numbers')
            if len(numbers) != 2 or any(not math.isfinite(number) or abs(number) > 100000 for number in numbers): raise ValueError(f'invalid {key}')
        elif key in ('rotation', 'alpha', 'fontSize'):
            if isinstance(value, bool): raise ValueError(f'{key} must be a number')
            try:
                number = float(value)
            except (ValueError, TypeError):
                raise ValueError(f'{key} must be a number')
            if not math.isfinite(number) or (key == 'rotation' and abs(number) > 100000) or (key == 'alpha' and not 0 <= number <= 1) or (key == 'fontSize' and (number <= 0 or number > 32767 or not number.is_integer())):
                raise ValueError(f'invalid {key}')
        elif key in ('leading', 'letterSpacing'):
            if isinstance(value, bool) or not re.fullmatch(r'[+-]?[0-9]+', str(value).strip()) or not -32768 <= int(value) <= 32767:
                raise ValueError(f'invalid {key}')
        elif key in ('align', 'vAlign', 'autoSize'):
            options = {'align': ('left', 'center', 'right'), 'vAlign': ('top', 'middle', 'bottom'), 'autoSize': ('none', 'both', 'height', 'shrink')}
            if value not in options[key]: raise ValueError(f'invalid {key}')
        elif key in ('name', 'text', 'font') and not isinstance(value, str):
            raise ValueError(f'{key} must be a string')
        elif key == 'color' and not re.fullmatch(r'#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?', str(value)):
            raise ValueError('color must be #RRGGBB or #AARRGGBB')


def edit_children_batch(data, changes):
    """Apply child edits with one XML scan while retaining unrelated bytes."""
    validate_component(data)
    if not isinstance(changes, list) or not 1 <= len(changes) <= 1000:
        raise ValueError('changes must be a nonempty list of at most 1000 edits')
    parser = expat.ParserCreate()
    stack, children, index = [], [], {}
    def add_index(value, number):
        if value is not None: index.setdefault(value, set()).add(number)
    def remove_index(value, number):
        if value is not None:
            index[value].discard(number)
            if not index[value]: del index[value]
    def start(tag, attrs):
        if stack == ['component', 'displayList']:
            begin = parser.CurrentByteIndex
            quote = None
            for end in range(begin, len(data)):
                char = data[end]
                if quote is not None:
                    if char == quote: quote = None
                elif char in (34, 39): quote = char
                elif char == 62: break
            else: raise ValueError('unterminated start tag')
            number = len(children)
            children.append({'begin': begin, 'end': end, 'type': tag, 'id': attrs.get('id'), 'name': attrs.get('name'), 'attrs': dict(attrs), 'tag': data[begin:end].decode('utf-8'), 'changed': False})
            add_index(attrs.get('id'), number)
            add_index(attrs.get('name'), number)
        stack.append(tag)
    def end(tag): stack.pop()
    parser.StartElementHandler, parser.EndElementHandler = start, end
    parser.Parse(data, True)
    for change in changes:
        if not isinstance(change, dict) or set(change) != {'target', 'props'} or not isinstance(change['target'], str) or not change['target']:
            raise ValueError('each change requires a nonempty target and props')
        props = change['props']
        validate_child_properties(props)
        matches = index.get(change['target'], set())
        if len(matches) != 1: raise ValueError('target child not found or ambiguous')
        number = next(iter(matches))
        child = children[number]
        text_fields = {'text', 'font', 'fontSize', 'autoSize', 'leading', 'letterSpacing', 'bold', 'italic', 'underline', 'singleLine', 'ubb'}
        if text_fields.intersection(props) and child['type'] not in ('text', 'richtext', 'inputtext'):
            raise ValueError('text properties apply only to text objects')
        if {'align', 'vAlign'}.intersection(props) and child['type'] not in ('text', 'richtext', 'inputtext', 'loader', 'list'):
            raise ValueError('alignment applies only to text, loader and list objects')
        if 'anchor' in props and 'pivot' not in props and 'pivot' not in child['attrs']:
            raise ValueError('anchor requires a pivot')
        tag = child['tag']
        for key, value in props.items():
            value = str(int(float(value))) if key == 'fontSize' else str(value).lower() if isinstance(value, bool) else str(value)
            child['attrs'][key] = value
            attr = key + '=' + quoteattr(value)
            pattern = r'(?<![^\s])' + re.escape(key) + r'\s*=\s*(?:"[^"]*"|\'[^\']*\')'
            if re.search(pattern, tag): tag = re.sub(pattern, lambda match: attr, tag, count=1)
            else:
                pos = len(tag.rstrip())
                if tag[:pos].endswith('/'): pos -= 1
                tag = tag[:pos] + ' ' + attr + tag[pos:]
            if key == 'name':
                # An ID and a name can be identical: keep the ID index intact.
                if child['name'] != child['id']: remove_index(child['name'], number)
                child['name'] = value
                add_index(value, number)
        child['tag'] = tag
        child['changed'] = True
    chunks, offset = [], 0
    for child in children:
        if not child['changed']: continue
        chunks.extend((data[offset:child['begin']], child['tag'].encode('utf-8')))
        offset = child['end']
    chunks.append(data[offset:])
    result = b''.join(chunks)
    validate_component(result)
    return result


def edit_child_attributes(data, target, props):
    """Edit only the selected start tag, preserving the rest of the XML bytes."""
    return edit_children_batch(data, [{'target': target, 'props': props}])


def edit_component_properties(data, props):
    """Edit the component root start tag while preserving all other bytes."""
    validate_component(data)
    if not isinstance(props, dict) or not props or set(props) - {'size', 'pivot', 'opaque', 'overflow', 'margin'}:
        raise ValueError('unsupported or empty component properties')
    for key, value in props.items():
        if key in ('size', 'margin'):
            parts = value.split(',') if isinstance(value, str) else []
            count = 2 if key == 'size' else 4
            if len(parts) != count or any(not re.fullmatch(r'[0-9]+', part.strip()) for part in parts):
                raise ValueError(f'{key} must contain {count} comma-separated nonnegative integers')
            numbers = [int(part) for part in parts]
            if any(number > 100000 or (key == 'size' and number == 0) for number in numbers): raise ValueError(f'invalid {key}')
        elif key == 'pivot':
            validate_child_properties({'pivot': value})
        elif key == 'opaque':
            if type(value) is not bool: raise ValueError('opaque must be a boolean')
        elif key == 'overflow' and value not in ('visible', 'hidden', 'scroll'):
            raise ValueError('invalid component overflow')
    parser = expat.ParserCreate()
    start = []
    def capture(tag, attributes):
        if not start: start.append(parser.CurrentByteIndex)
    parser.StartElementHandler = capture
    parser.Parse(data, True)
    begin = start[0]
    quote = None
    for end in range(begin, len(data)):
        char = data[end]
        if quote is not None:
            if char == quote: quote = None
        elif char in (34, 39): quote = char
        elif char == 62: break
    else: raise ValueError('unterminated component tag')
    tag = data[begin:end].decode('utf-8')
    for key, value in props.items():
        value = str(value).lower() if isinstance(value, bool) else value
        attr = key + '=' + quoteattr(value)
        pattern = r'(?<![^\s])' + re.escape(key) + r'\s*=\s*(?:"[^"]*"|\'[^\']*\')'
        if re.search(pattern, tag): tag = re.sub(pattern, lambda match: attr, tag, count=1)
        else:
            pos = len(tag.rstrip())
            if tag[:pos].endswith('/'): pos -= 1
            tag = tag[:pos] + ' ' + attr + tag[pos:]
    result = data[:begin] + tag.encode('utf-8') + data[end:]
    validate_component(result)
    return result


def edit_button_options(data, props):
    """Edit or insert a Button settings element without rewriting other XML."""
    validate_component(data)
    root = parse_xml(data, 'component')
    if root.get('extention') != 'Button': raise ValueError('component is not a Button')
    if not isinstance(props, dict) or not props or set(props) - {'mode', 'sound', 'downEffect', 'downEffectValue'}:
        raise ValueError('unsupported or empty Button options')
    if 'mode' in props and props['mode'] not in ('Common', 'Check', 'Radio'): raise ValueError('invalid Button mode')
    if 'downEffect' in props and props['downEffect'] not in ('none', 'dark', 'scale'): raise ValueError('invalid Button downEffect')
    if 'sound' in props and (not isinstance(props['sound'], str) or (props['sound'] and not props['sound'].startswith('ui://'))):
        raise ValueError('invalid Button sound URL')
    if 'downEffectValue' in props:
        value = props['downEffectValue']
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 10: raise ValueError('invalid Button downEffectValue')
    buttons = root.findall('Button')
    if len(buttons) > 1: raise ValueError('duplicate Button settings')
    parser, stack, state = expat.ParserCreate(), [], {'button': None, 'root': None, 'close': None}
    def start(tag, attrs):
        if not stack: state['root'] = parser.CurrentByteIndex
        elif stack == ['component'] and tag == 'Button': state['button'] = parser.CurrentByteIndex
        stack.append(tag)
    def end(tag):
        if stack == ['component']: state['close'] = parser.CurrentByteIndex
        stack.pop()
    parser.StartElementHandler, parser.EndElementHandler = start, end
    parser.Parse(data, True)
    def tag_end(begin):
        quote = None
        for pos in range(begin, len(data)):
            char = data[pos]
            if quote is not None:
                if char == quote: quote = None
            elif char in (34, 39): quote = char
            elif char == 62: return pos
        raise ValueError('unterminated XML tag')
    if state['button'] is None:
        attrs = ''.join(' ' + key + '=' + quoteattr(str(value)) for key, value in props.items())
        element = ('<Button' + attrs + '/>').encode('utf-8')
        root_end = tag_end(state['root'])
        opening = data[state['root']:root_end + 1]
        if opening[:-1].rstrip().endswith(b'/'):
            slash = opening.rfind(b'/')
            replacement = opening[:slash] + b'>' + element + b'</component>'
            result = data[:state['root']] + replacement + data[root_end + 1:]
        else:
            result = data[:state['close']] + b'\n  ' + element + b'\n' + data[state['close']:]
    else:
        begin = state['button']
        end = tag_end(begin)
        tag = data[begin:end].decode('utf-8')
        for key, value in props.items():
            attr = key + '=' + quoteattr(str(value))
            pattern = r'(?<![^\s])' + re.escape(key) + r'\s*=\s*(?:"[^"]*"|\'[^\']*\')'
            if re.search(pattern, tag): tag = re.sub(pattern, lambda match: attr, tag, count=1)
            else:
                pos = len(tag.rstrip())
                if tag[:pos].endswith('/'): pos -= 1
                tag = tag[:pos] + ' ' + attr + tag[pos:]
        result = data[:begin] + tag.encode('utf-8') + data[end:]
    validate_component(result)
    return result


def insert_child(data, fragment, index=None):
    validate_component(data)
    if not isinstance(fragment, str): raise ValueError('object_xml must be a string')
    node = parse_xml(fragment.encode('utf-8'), 'object_xml')
    if node.tag not in {'image', 'component', 'text', 'richtext', 'inputtext', 'graph', 'loader', 'list', 'group', 'movieclip', 'jta'}:
        raise ValueError('unsupported display-list object type')
    if not node.get('id'): raise ValueError('object must have an id')
    root = parse_xml(data, 'component')
    display = root.find('displayList')
    if display is None: raise ValueError('component has no displayList')
    if any(child.get('id') == node.get('id') for child in display): raise ValueError('duplicate object id')
    if index is None: index = len(display)
    if type(index) is not int or not 0 <= index <= len(display): raise ValueError('insert index outside display list')
    parser = expat.ParserCreate()
    stack, bounds, positions = [], [], []
    def start(tag, attrs):
        if stack == ['component'] and tag == 'displayList': bounds.append([parser.CurrentByteIndex, None])
        elif stack == ['component', 'displayList']: positions.append(parser.CurrentByteIndex)
        stack.append(tag)
    def end(tag):
        if stack == ['component', 'displayList']: bounds[-1][1] = parser.CurrentByteIndex
        stack.pop()
    parser.StartElementHandler, parser.EndElementHandler = start, end
    parser.Parse(data, True)
    begin, close = bounds[0]
    quote = None
    for opening_end in range(begin, len(data)):
        byte = data[opening_end]
        if quote is not None:
            if byte == quote: quote = None
        elif byte in (34, 39): quote = byte
        elif byte == 62: break
    else: raise ValueError('invalid displayList opening tag')
    opening = data[begin:opening_end + 1]
    encoded = fragment.encode('utf-8')
    if opening.rstrip().endswith(b'/>'):
        pos = opening.rfind(b'/')
        replacement = opening[:pos] + b'>' + encoded + b'</displayList>'
        result = data[:begin] + replacement + data[opening_end + 1:]
    elif index < len(positions):
        position = positions[index]
        result = data[:position] + encoded + b'\n    ' + data[position:]
    else:
        result = data[:close] + b'\n    ' + encoded + b'\n  ' + data[close:]
    validate_component(result)
    return result


def move_child(data, target, index):
    """Move a display-list element to its final index without changing its XML."""
    validate_component(data)
    if not isinstance(target, str) or not target: raise ValueError('target must be a nonempty string')
    root = parse_xml(data, 'component')
    display = root.find('displayList')
    if display is None: raise ValueError('component has no displayList')
    children = list(display)
    if type(index) is not int or not 0 <= index < len(children): raise ValueError('move index outside display list')
    matches = [number for number, child in enumerate(children) if target in (child.get('id'), child.get('name'))]
    if len(matches) != 1: raise ValueError('target child not found or ambiguous')
    if matches[0] == index: return data
    ident = children[matches[0]].get('id')
    parser, stack, span = expat.ParserCreate(), [], []
    def start(tag, attrs):
        if stack == ['component', 'displayList'] and attrs.get('id') == ident: span.append([parser.CurrentByteIndex, None])
        stack.append(tag)
    def end(tag):
        if len(stack) == 3 and stack[:2] == ['component', 'displayList'] and span and span[-1][1] is None:
            begin = span[-1][0]
            quote = None
            for opening_end in range(begin, len(data)):
                byte = data[opening_end]
                if quote is not None:
                    if byte == quote: quote = None
                elif byte in (34, 39): quote = byte
                elif byte == 62: break
            else: raise ValueError('invalid child tag')
            pos = parser.CurrentByteIndex
            span[-1][1] = pos if data[begin:opening_end].rstrip().endswith(b'/') else data.find(b'>', pos) + 1
        stack.pop()
    parser.StartElementHandler, parser.EndElementHandler = start, end
    parser.Parse(data, True)
    if len(span) != 1 or not span[0][1]: raise ValueError('could not locate object')
    begin, end = span[0]
    fragment = data[begin:end].decode('utf-8')
    return insert_child(data[:begin] + data[end:], fragment, index)


def remove_child(data, target):
    validate_component(data)
    root = parse_xml(data, 'component')
    display = root.find('displayList')
    matches = [node for node in display or () if target in (node.get('id'), node.get('name'))]
    if len(matches) != 1: raise ValueError('target child not found or ambiguous')
    selected = matches[0]
    ident = selected.get('id')
    # Refuse removal when another element mentions this id. This is deliberately
    # conservative: relations, groups, transitions and gears may depend on it.
    selected_nodes = set(selected.iter())
    for node in root.iter():
        if node in selected_nodes: continue
        for value in node.attrib.values():
            if ident in re.split(r'[,;\s]+', value):
                raise ValueError(f'object {ident} is referenced by {node.tag}')
    parser = expat.ParserCreate()
    stack, span = [], []
    def start(tag, attrs):
        if stack == ['component', 'displayList'] and attrs.get('id') == ident:
            span.append([parser.CurrentByteIndex, None])
        stack.append(tag)
    def end(tag):
        if len(stack) == 3 and stack[:2] == ['component', 'displayList'] and span and span[-1][1] is None:
            pos = parser.CurrentByteIndex
            start_pos = span[-1][0]
            quote = None
            for opening_end in range(start_pos, len(data)):
                byte = data[opening_end]
                if quote is not None:
                    if byte == quote: quote = None
                elif byte in (34, 39): quote = byte
                elif byte == 62: break
            self_closing = data[start_pos:opening_end].rstrip().endswith(b'/')
            # Expat points after a self-closing tag, or at a normal closing tag.
            if not self_closing:
                pos = data.find(b'>', pos) + 1
            span[-1][1] = pos
        stack.pop()
    parser.StartElementHandler, parser.EndElementHandler = start, end
    parser.Parse(data, True)
    if len(span) != 1 or span[0][1] is None: raise ValueError('could not locate object')
    result = data[:span[0][0]] + data[span[0][1]:]
    validate_component(result)
    return result


@contextmanager
def project_write_lock(root):
    """Serialize cooperating project writes and snapshot operations."""
    key = hashlib.sha256(os.path.normcase(str(root)).encode('utf-8')).hexdigest()
    lock_dir = Path(tempfile.gettempdir()) / 'fgui-agent-bridge-locks'
    lock_dir.mkdir(exist_ok=True)
    with open(lock_dir / (key + '.lock'), 'a+b') as handle:
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b'\0'); handle.flush()
        handle.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise ValueError('another offline operation is using this project') from exc
        try:
            yield
        finally:
            if os.name == 'nt':
                handle.seek(0); msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def execute(command, args):
    locked_commands = {'write_component', 'set_properties', 'set_properties_batch', 'set_component_properties', 'set_button_options', 'set_button_instance_options', 'set_label_instance_options', 'insert_object', 'insert_resource', 'move_object', 'remove_object', 'create_component', 'create_package', 'import_image', 'import_sound', 'import_movieclip', 'import_font', 'find_references', 'unregister_resource', 'set_image_options', 'create_controller', 'set_controller_pages', 'set_display_gear', 'set_display2_gear', 'set_text_gear', 'set_color_gear', 'set_position_gear', 'set_size_gear', 'set_look_gear', 'set_font_size_gear', 'set_animation_gear', 'set_icon_gear', 'set_relation', 'remove_relation', 'remove_gear', 'publish_images_experimental', 'publish_simple_experimental', 'publish_project_experimental', 'preflight_publish', 'atlas_layout', 'atlas_export', 'validate', 'lint'}
    compare_source = command == 'validate_published' and (args.get('compare_source') or args.get('compare_components'))
    if command in locked_commands or compare_source:
        with project_write_lock(project_root(args['project'])):
            return _execute(command, args)
    return _execute(command, args)


def _execute(command, args):
    root = project_root(args['project'])
    if command == 'preflight_publish':
        exported_only = args.get('exported_only', True)
        if type(exported_only) is not bool: raise ValueError('exported_only must be a boolean')
        snapshot = PublishSnapshot()
        snapshot.track(root / 'settings' / 'Publish.json')
        requested_project = Path(args['project']).resolve()
        descriptors = [requested_project] if requested_project.is_file() else sorted(root.glob('*.fairy'))
        for descriptor in descriptors: snapshot.track(descriptor)
        initial_folders = [folder for folder, _ in packages(root)]
        records, selected, by_id, by_name, issues = [], [], {}, {}, []
        for folder in initial_folders:
            record = {'package': folder.name, 'status': 'failed', 'errors': [], 'warnings': []}
            records.append(record)
            try:
                tree = snapshot.read_package(folder)
                package_id = tree.get('id')
                record['id'] = package_id
                if not package_id or package_id in by_id:
                    raise ValueError('missing or duplicate project package ID')
                items = select_exported_resources(folder, tree) if exported_only else tree.findall('./resources/*')
                if not items:
                    record.update(status='skipped', reason='no selected resources')
                    continue
                for item in items: snapshot.track(resource_path(folder, item))
                entry = (folder, tree, items)
                by_id[package_id] = entry
                by_name[folder.name] = entry
                selected.append((entry, record))
            except (ValueError, OSError, KeyError, TypeError) as exc:
                record['errors'].append(str(exc))
        if not initial_folders: issues.append('project has no packages')
        elif not selected and all(record['status'] == 'skipped' for record in records): issues.append('project has no selected resources to publish')
        with tempfile.TemporaryDirectory(prefix='fgui-preflight-') as temp:
            for (folder, tree, items), record in selected:
                try:
                    child_args = {key: args[key] for key in ('project', 'width', 'height', 'padding', 'shrink_atlas', 'optimize_atlas', 'trim_images', 'rotate_images') if key in args}
                    child_args.update(pkg=folder.name, output=str(Path(temp) / folder.name), exported_only=exported_only)
                    result = _execute('publish_simple_experimental', child_args)
                    url_dependencies = project_url_dependencies(folder, tree, items, by_name, by_id)
                    dependencies = {item['id']: item for item in result['dependencies']}
                    dependencies.update(url_dependencies)
                    report = _execute('validate_published', {'project': str(root), 'file': result['file'], 'compare_source': True, 'compare_components': True, 'check_overlaps': True, 'exported_only': exported_only})
                    record['warnings'] = result['warnings']
                    record['dependencies'] = [dependencies[key] for key in sorted(dependencies)]
                    comparison_keys = ('source_comparison', 'image_settings_comparison', 'sound_comparison', 'movieclip_comparison', 'font_comparison', 'pixel_hit_comparison', 'component_comparison')
                    record['validation'] = {'atlas_count': report['atlas_count'], 'sprite_count': report['sprite_count'], 'issues': report['issues'],
                                            'comparisons': {key: report[key] for key in comparison_keys if key in report}}
                    if not report['valid']:
                        record['errors'].append('published output failed source or atlas validation')
                    else:
                        record['status'] = 'passed'
                except (ValueError, OSError, KeyError, TypeError, ImportError) as exc:
                    record['errors'].append(str(exc))
        while True:
            passed_ids = {record.get('id') for record in records if record['status'] == 'passed'}
            changed = False
            for record in records:
                if record['status'] != 'passed': continue
                missing = [dep['id'] for dep in record.get('dependencies', []) if dep['id'] not in passed_ids]
                if missing:
                    record['status'] = 'failed'
                    record['errors'].append('dependency package did not pass preflight: ' + ', '.join(missing))
                    changed = True
            if not changed: break
        snapshot.verify()
        if requested_project.is_dir() and sorted(root.glob('*.fairy')) != descriptors: raise ValueError('project descriptors changed during preflight')
        if [folder for folder, _ in packages(root)] != initial_folders: raise ValueError('project packages changed during preflight')
        counts = {status: sum(record['status'] == status for record in records) for status in ('passed', 'failed', 'skipped')}
        return {'valid': not issues and not counts['failed'], 'counts': counts, 'packages': records, 'issues': issues, 'scope': 'experimental publication and supported source comparisons; temporary output only; not full editor or graphical runtime parity'}
    if command == 'find_references':
        target_folder, target_package = find_package(root, args['pkg'])
        snapshot = PublishSnapshot()
        target_package = snapshot.read_package(target_folder)
        if args['pkg'] not in (target_folder.name, target_package.get('id')): raise ValueError('package identity changed during reference scan')
        name = args['item']
        if not isinstance(name, str) or not name: raise ValueError('item must be a nonempty string')
        matches = [item for item in target_package.findall('./resources/*') if name in (item.get('id'), item.get('name'), Path(item.get('name', '')).stem)]
        if len(matches) != 1: raise ValueError('resource not found or ambiguous')
        target = matches[0]
        resource_path(target_folder, target)
        ident, package_id = target.get('id'), target_package.get('id')
        if not ident or not package_id or sum(item.get('id') == ident for item in target_package.findall('./resources/*')) != 1:
            raise ValueError('resource or package ID is missing or ambiguous')
        initial_packages = packages(root)
        if any(folder != target_folder and ({folder.name, tree.get('id')} & {target_folder.name, package_id}) for folder, tree in initial_packages):
            raise ValueError('target package name or ID is ambiguous')
        initial_folders = [folder for folder, _ in initial_packages]
        references, warnings = [], []
        compact_url = 'ui://' + package_id + ident
        named_url = 'ui://' + target_folder.name + '/' + Path(target.get('name', '')).stem
        settings_dir = root / 'settings'
        settings_files = sorted(settings_dir.rglob('*.json')) if settings_dir.is_dir() else []
        for settings_file in settings_files:
            try:
                snapshot.track(settings_file)
                document = json.loads(settings_file.read_text(encoding='utf-8-sig'))
                pending = [('$', document)]
                while pending:
                    key, value = pending.pop()
                    if isinstance(value, dict):
                        pending.extend((key + '.' + str(name), child) for name, child in value.items())
                    elif isinstance(value, list):
                        pending.extend((f'{key}[{index}]', child) for index, child in enumerate(value))
                    elif isinstance(value, str):
                        for url in re.split(r'[,|]', value):
                            if url in (compact_url, named_url):
                                references.append({'path': str(settings_file), 'kind': 'project_setting', 'attribute': key, 'value': url})
            except (ValueError, OSError, UnicodeError, RecursionError) as exc:
                warnings.append({'path': str(settings_file), 'error': str(exc)})
        for folder in initial_folders:
            tree = snapshot.read_package(folder)
            for item in tree.findall('./resources/*'):
                if item.tag not in ('component', 'font'): continue
                try:
                    path = resource_path(folder, item)
                    if item.tag == 'component':
                        data = path.read_bytes()
                        validate_component(data)
                        component = parse_xml(data, str(path))
                        for child in component.findall('./displayList/*'):
                            owner = child.get('pkg') or tree.get('id')
                            if owner in (package_id, target_folder.name) and child.get('src') == ident:
                                references.append({'package': folder.name, 'resource': item.get('name'), 'path': str(path), 'kind': 'child', 'element': child.tag, 'element_id': child.get('id'), 'attribute': 'src', 'value': ident})
                        for element, attribute, url in component_resource_urls(component):
                            if url in (compact_url, named_url):
                                references.append({'package': folder.name, 'resource': item.get('name'), 'path': str(path), 'kind': 'ui_url', 'element': element.tag, 'element_id': element.get('id'), 'attribute': attribute, 'value': url})
                    elif folder == target_folder and target.tag == 'image':
                        font = read_bitmap_font(path.read_bytes(), item.get('texture'))
                        if font['texture'] == ident:
                            references.append({'package': folder.name, 'resource': item.get('name'), 'path': str(path), 'kind': 'font_texture', 'attribute': 'texture', 'value': ident})
                        for glyph in font['glyphs']:
                            if glyph['image'] == ident:
                                references.append({'package': folder.name, 'resource': item.get('name'), 'path': str(path), 'kind': 'font_glyph', 'glyph': glyph['id'], 'attribute': 'img', 'value': ident})
                except (ValueError, OSError, KeyError, TypeError) as exc:
                    warnings.append({'package': folder.name, 'resource': item.get('name'), 'error': str(exc)})
        snapshot.verify()
        current_settings = sorted(settings_dir.rglob('*.json')) if settings_dir.is_dir() else []
        if current_settings != settings_files: raise ValueError('project settings changed during reference scan')
        if [folder for folder, _ in packages(root)] != initial_folders: raise ValueError('project packages changed during reference scan')
        return {'package': target_folder.name, 'id': ident, 'name': target.get('name'), 'type': target.tag, 'references': references, 'complete': not warnings, 'warnings': warnings, 'scope': 'registered components: direct children and supported UI URL fields; project settings JSON; same-package bitmap font textures and glyphs; dynamic and other references excluded'}
    if command == 'unregister_resource':
        current = _execute('read_package', args)
        if args.get('expected_sha256') != current['sha256']: raise ValueError('expected_sha256 must match current package')
        report = _execute('find_references', args)
        if not report['complete']: raise ValueError('resource reference scan was incomplete; no changes made')
        if report['references']: raise ValueError(f"resource has {len(report['references'])} detected reference(s); no changes made")
        original = Path(current['path']).read_bytes()
        if hashlib.sha256(original).hexdigest() != current['sha256']: raise ValueError('package changed during resource scan')
        package = parse_xml(original, 'package.xml')
        target = next(item for item in package.findall('./resources/*') if item.get('id') == report['id'])
        retained_file = resource_path(Path(current['path']).parent, target)
        changed = remove_package_resource(original, report['id'])
        temporary = None
        try:
            fd, temporary = tempfile.mkstemp(prefix='.fgui-package-', suffix='.tmp', dir=Path(current['path']).parent)
            with os.fdopen(fd, 'wb') as output:
                output.write(changed); output.flush(); os.fsync(output.fileno())
            atomic_replace_checked(temporary, current['path'], current['sha256'])
            temporary = None
        finally:
            if temporary: Path(temporary).unlink(missing_ok=True)
        return {'id': report['id'], 'name': report['name'], 'type': report['type'], 'retained_file': str(retained_file), 'sha256': hashlib.sha256(changed).hexdigest(), 'scope': report['scope']}
    if command == 'publish_project_experimental':
        output = Path(args['output']).absolute()
        if output.exists() or not output.parent.is_dir(): raise ValueError('output must be a new directory with an existing parent')
        exported_only = args.get('exported_only', True)
        if type(exported_only) is not bool: raise ValueError('exported_only must be a boolean')
        snapshot = PublishSnapshot()
        snapshot.track(root / 'settings' / 'Publish.json')
        requested_project = Path(args['project']).resolve()
        descriptors = [requested_project] if requested_project.is_file() else sorted(root.glob('*.fairy'))
        for descriptor in descriptors: snapshot.track(descriptor)
        package_folders = [folder for folder, _ in packages(root)]
        if not package_folders: raise ValueError('project has no packages')
        selected, skipped = [], []
        for folder in package_folders:
            tree = snapshot.read_package(folder)
            items = select_exported_resources(folder, tree) if exported_only else tree.findall('./resources/*')
            if not items:
                skipped.append({'package': folder.name, 'reason': 'no selected resources'})
                continue
            for item in items: snapshot.track(resource_path(folder, item))
            selected.append((folder, tree, items))
        if not selected: raise ValueError('project has no selected resources to publish')
        by_id, by_name = {}, {}
        for folder, tree, items in selected:
            package_id = tree.get('id')
            if not package_id or package_id in by_id: raise ValueError('missing or duplicate project package ID')
            by_id[package_id] = (folder, tree, items)
            by_name[folder.name] = (folder, tree, items)
        with tempfile.TemporaryDirectory(prefix='.fgui-project-', dir=output.parent) as staging:
            records = []
            for folder, tree, items in selected:
                child_args = {key: args[key] for key in ('project', 'width', 'height', 'padding', 'shrink_atlas', 'optimize_atlas', 'trim_images', 'rotate_images') if key in args}
                child_args.update(pkg=folder.name, output=str(Path(staging) / folder.name), exported_only=exported_only)
                result = _execute('publish_simple_experimental', child_args)
                url_dependencies = project_url_dependencies(folder, tree, items, by_name, by_id)
                dependencies = {dependency['id']: dependency for dependency in result['dependencies']}
                dependencies.update(url_dependencies)
                records.append({'id': tree.get('id'), 'package': folder.name, 'file': (Path(folder.name) / Path(result['file']).name).as_posix(),
                                'dependencies': [dependencies[key] for key in sorted(dependencies)],
                                'url_dependencies': [url_dependencies[key] for key in sorted(url_dependencies)], 'warnings': result['warnings']})
            published = {record['id'] for record in records}
            for record in records:
                missing = [dependency['id'] for dependency in record['dependencies'] if dependency['id'] not in published]
                if missing: raise ValueError(f"{record['package']}: dependencies not included in project publication: {', '.join(missing)}")
            manifest = {'format': 'fgui-offline-project-v1', 'packages': records, 'skipped': skipped}
            (Path(staging) / 'publication.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
            snapshot.verify()
            if requested_project.is_dir() and sorted(root.glob('*.fairy')) != descriptors: raise ValueError('project descriptors changed during publication')
            if [folder for folder, _ in packages(root)] != package_folders: raise ValueError('project packages changed during publication')
            rename_new_directory(staging, output)
        return {'output': str(output), 'manifest': str(output / 'publication.json'), **manifest}
    if command in ('read_package', 'set_image_options'):
        folder, package = find_package(root, args['pkg'])
        package_file = folder / 'package.xml'
        original = package_file.read_bytes()
        digest = hashlib.sha256(original).hexdigest()
        if command == 'read_package':
            return {'path': str(package_file), 'sha256': digest, 'xml': original.decode('utf-8-sig')}
        if args.get('expected_sha256') != digest: raise ValueError('expected_sha256 must match current package')
        name = args['item']
        if not isinstance(name, str) or not name: raise ValueError('item must be a nonempty string')
        images = [item for item in package.findall('./resources/image') if name in (item.get('id'), item.get('name'), Path(item.get('name', '')).stem)]
        if len(images) != 1: raise ValueError('image not found or ambiguous')
        if not images[0].get('id'): raise ValueError('image has no ID')
        changed = edit_image_options(original, images[0], args.get('props'))
        fd, temp = tempfile.mkstemp(prefix='.fgui-package-', suffix='.tmp', dir=folder)
        try:
            with os.fdopen(fd, 'wb') as output:
                output.write(changed); output.flush(); os.fsync(output.fileno())
            atomic_replace_checked(temp, package_file, digest)
        finally:
            if os.path.exists(temp): os.unlink(temp)
        return {'path': str(package_file), 'sha256': hashlib.sha256(changed).hexdigest(), 'id': images[0].get('id')}
    if command == 'create_package':
        name = args['name']
        if not isinstance(name, str) or not re.fullmatch(r'[\w\- ]{1,100}', name, re.UNICODE) or name.strip() != name:
            raise ValueError('package name must contain letters, digits, spaces, underscores or hyphens')
        existing = packages(root)
        if any(name.casefold() in (folder.name.casefold(), (tree.get('id') or '').casefold()) for folder, tree in existing):
            raise ValueError('package name already exists or conflicts with an ID')
        ids = {tree.get('id') for _, tree in existing}
        ident = secrets.token_hex(4)
        while ident in ids or any(ident.casefold() == folder.name.casefold() for folder, _ in existing):
            ident = secrets.token_hex(4)
        assets = root / 'assets'
        target = assets / name
        if target.exists(): raise ValueError('package directory already exists')
        xml = ('<?xml version="1.0" encoding="utf-8"?>\n<packageDescription id=' + quoteattr(ident) + '>\n  <resources/>\n  <publish name=' + quoteattr(name) + '>\n    <atlas name="Default" index="0"/>\n  </publish>\n</packageDescription>\n').encode('utf-8')
        parse_xml(xml, 'package.xml')
        # The extra staging level keeps package.xml out of the direct package
        # scan while keeping the rename on the assets filesystem, even if assets
        # is a junction or mount on another volume.
        with tempfile.TemporaryDirectory(prefix='.fgui-new-package-', dir=assets) as staging:
            staged_package = Path(staging) / 'package'
            staged_package.mkdir()
            with open(staged_package / 'package.xml', 'xb') as output:
                output.write(xml); output.flush(); os.fsync(output.fileno())
            rename_new_directory(staged_package, target)
        return {'id': ident, 'name': name, 'path': str(target)}
    if command in ('import_image', 'import_sound', 'import_movieclip', 'import_font'):
        import io
        kind = {'import_image': 'image', 'import_sound': 'sound', 'import_movieclip': 'movieclip', 'import_font': 'font'}[command]
        folder, package = find_package(root, args['pkg'])
        source = Path(args['source']).resolve(strict=True)
        if not source.is_file(): raise ValueError(f'{kind} source must be a file')
        filename = args.get('name') or source.name
        if not isinstance(filename, str) or filename != filename.strip() or filename in ('.', '..') or not re.fullmatch(r'[\w .\-]{1,200}', filename, re.UNICODE) or filename.endswith('.'):
            raise ValueError(f'invalid {kind} filename')
        suffix = Path(filename).suffix.lower()
        allowed_extensions = {'image': ('.png', '.jpg', '.jpeg'), 'sound': ('.wav', '.mp3', '.ogg'), 'movieclip': ('.jta',), 'font': ('.fnt',)}
        if suffix not in allowed_extensions[kind]: raise ValueError(f'{kind} filename must use ' + ', '.join(allowed_extensions[kind]))
        if type(args.get('exported', False)) is not bool: raise ValueError('exported must be a boolean')
        parts = package_directory_parts(args.get('path', '/'))
        package_path = '/' + '/'.join(parts) + ('/' if parts else '')
        if any(item.get('name', '').casefold() == filename.casefold() and item.get('path', '/').replace('\\', '/').strip('/').casefold() == '/'.join(parts).casefold() for item in package.findall('./resources/*')):
            raise ValueError(f'{kind} filename already registered')
        if source.stat().st_size > 128 * 1024 * 1024: raise ValueError(f'{kind} source exceeds 128 MiB')
        data = source.read_bytes()
        if len(data) > 128 * 1024 * 1024: raise ValueError(f'{kind} source exceeds 128 MiB')
        metadata = {}
        if kind == 'image':
            from PIL import Image
            try:
                with Image.open(io.BytesIO(data)) as image:
                    image_format, width, height = image.format, image.width, image.height
                    image.verify()
                with Image.open(io.BytesIO(data)) as image: image.load()
            except (OSError, SyntaxError, ValueError, Image.DecompressionBombError) as exc:
                raise ValueError('invalid image source') from exc
            if (suffix == '.png' and image_format != 'PNG') or (suffix in ('.jpg', '.jpeg') and image_format != 'JPEG'):
                raise ValueError('image extension does not match its content')
            if width <= 0 or height <= 0: raise ValueError('invalid image dimensions')
            metadata = {'width': width, 'height': height}
        elif kind == 'sound':
            from sound import inspect_sound
            metadata = inspect_sound(data, suffix)
        elif kind == 'movieclip':
            clip = read_jta(data)
            try: metadata = {'width': clip['width'], 'height': clip['height'], 'frames': len(clip['frames']), 'interval': clip['interval']}
            finally:
                for image in clip['images']: image.close()
        else:
            from PIL import Image
            texture = args.get('texture')
            texture_id = None
            if texture is not None:
                if not isinstance(texture, str) or not texture: raise ValueError('font texture must be a nonempty image ID or name')
                matches = [item for item in package.findall('./resources/image') if texture in (item.get('id'), item.get('name'), Path(item.get('name', '')).stem)]
                if len(matches) != 1 or not matches[0].get('id'): raise ValueError('font texture image not found or ambiguous')
                texture_id = matches[0].get('id')
            font = read_bitmap_font(data, texture_id)
            required = [texture_id] if texture_id else [glyph['image'] for glyph in font['glyphs']]
            image_sizes = {}
            for image_id in set(required):
                matches = [item for item in package.findall('./resources/image') if item.get('id') == image_id]
                if len(matches) != 1: raise ValueError(f'font image {image_id!r} is missing or ambiguous')
                try:
                    with Image.open(resource_path(folder, matches[0])) as image:
                        image.load()
                        image_sizes[image_id] = image.size
                except (OSError, Image.DecompressionBombError) as exc:
                    raise ValueError(f'invalid font image {image_id!r}') from exc
            if texture_id:
                image_width, image_height = image_sizes[texture_id]
                if any(glyph['x'] + glyph['width'] > image_width or glyph['y'] + glyph['height'] > image_height for glyph in font['glyphs']):
                    raise ValueError('font glyph rectangle exceeds texture dimensions')
            metadata = {'glyphs': len(font['glyphs']), 'font_size': font['fontSize'], 'texture': texture_id}
        ids = {item.get('id') for item in package.findall('./resources/*')}
        ident = secrets.token_hex(3)
        while ident in ids: ident = secrets.token_hex(3)
        package_file = folder / 'package.xml'
        original = package_file.read_bytes()
        element = ('<' + kind + ' id=' + quoteattr(ident) + ' name=' + quoteattr(filename) + ' path=' + quoteattr(package_path) + (' exported="true"' if args.get('exported', False) else '') + (' texture=' + quoteattr(texture_id) if kind == 'font' and texture_id else '') + '/>').encode('utf-8')
        changed = append_package_resource(original, element)
        target = folder.joinpath(*parts, filename)
        if not target.resolve().is_relative_to(folder.resolve()): raise ValueError(f'{kind} path escapes package')
        created, temporary, created_dirs = False, None, []
        try:
            create_package_directories(folder, parts, created_dirs)
            with open(target, 'xb') as output:
                created = True
                output.write(data); output.flush(); os.fsync(output.fileno())
            fd, temporary = tempfile.mkstemp(prefix='.fgui-package-', suffix='.tmp', dir=folder)
            with os.fdopen(fd, 'wb') as output:
                output.write(changed); output.flush(); os.fsync(output.fileno())
            atomic_replace_checked(temporary, package_file, hashlib.sha256(original).hexdigest())
            temporary = None
        except BaseException:
            if created: target.unlink(missing_ok=True)
            remove_empty_directories(created_dirs)
            raise
        finally:
            if temporary: Path(temporary).unlink(missing_ok=True)
        return {'id': ident, 'name': filename, 'path': str(target), **metadata, 'sha256': hashlib.sha256(data).hexdigest()}
    if command == 'create_component':
        folder, package = find_package(root, args['pkg'])
        name = args['name']
        if not isinstance(name, str) or not re.fullmatch(r'[\w\- ]{1,100}', name, re.UNICODE) or name.strip() != name:
            raise ValueError('component name must contain letters, digits, spaces, underscores or hyphens')
        width, height = args['width'], args['height']
        if any(type(x) is not int or x <= 0 or x > 100000 for x in (width, height)):
            raise ValueError('width and height must be positive integers up to 100000')
        if type(args.get('exported', False)) is not bool:
            raise ValueError('exported must be a boolean')
        extension = args.get('extention')
        if extension not in (None, 'Label', 'Button', 'ComboBox', 'ProgressBar', 'Slider', 'ScrollBar'):
            raise ValueError('unsupported component extention')
        entries = package.findall('./resources/*')
        filename = name + '.xml'
        parts = package_directory_parts(args.get('path', '/'))
        package_path = '/' + '/'.join(parts) + ('/' if parts else '')
        if any(item.get('name', '').casefold() == filename.casefold() and item.get('path', '/').replace('\\', '/').strip('/').casefold() == '/'.join(parts).casefold() for item in entries):
            raise ValueError('component filename already registered')
        ids = {item.get('id') for item in entries}
        ident = secrets.token_hex(3)
        while ident in ids: ident = secrets.token_hex(3)
        package_file = folder / 'package.xml'
        original = package_file.read_bytes()
        entry = ('<component id=' + quoteattr(ident) + ' name=' + quoteattr(filename) + ' path=' + quoteattr(package_path) + (' exported="true"' if args.get('exported', False) else '') + '/>').encode('utf-8')
        changed = append_package_resource(original, entry)
        extension_attribute = ' extention=' + quoteattr(extension) if extension else ''
        extension_settings = '\n  <' + extension + '/>' if extension in ('Button', 'ComboBox', 'ProgressBar', 'Slider') else ''
        if extension == 'ScrollBar':
            display_list = ('<displayList>\n    <graph id="n0" name="bar" size="%d,%d" type="rect"/>\n'
                            '    <graph id="n1" name="grip" size="%d,%d" type="rect"/>\n  </displayList>'
                            % (width, height, width, max(1, height // 4)))
        else:
            display_list = '<displayList/>'
        component = ('<?xml version="1.0" encoding="utf-8"?>\n<component size="%d,%d"%s>\n  %s%s\n</component>\n' % (width, height, extension_attribute, display_list, extension_settings)).encode('utf-8')
        target = folder.joinpath(*parts, filename)
        if not target.resolve().is_relative_to(folder.resolve()): raise ValueError('component path escapes package')
        created = False
        temp = None
        created_dirs = []
        try:
            create_package_directories(folder, parts, created_dirs)
            with open(target, 'xb') as output:
                created = True
                output.write(component); output.flush(); os.fsync(output.fileno())
            fd, temp = tempfile.mkstemp(prefix='.fgui-package-', suffix='.tmp', dir=folder)
            with os.fdopen(fd, 'wb') as output:
                output.write(changed); output.flush(); os.fsync(output.fileno())
            atomic_replace_checked(temp, package_file, hashlib.sha256(original).hexdigest())
            temp = None
        except BaseException:
            if created: target.unlink(missing_ok=True)
            remove_empty_directories(created_dirs)
            raise
        finally:
            if temp: Path(temp).unlink(missing_ok=True)
        return {'id': ident, 'name': name, 'path': str(target), 'sha256': hashlib.sha256(component).hexdigest()}
    if command in ('publish_images_experimental', 'publish_simple_experimental'):
        from PIL import Image
        folder, tree = find_package(root, args['pkg'])
        snapshot = PublishSnapshot()
        tree = snapshot.read_package(folder)
        if args['pkg'] not in (folder.name, tree.get('id')): raise ValueError('package identity changed during publication')
        package_files = sorted((root / 'assets').glob('*/package.xml'))
        package_aliases = {}
        for package_file in package_files:
            candidate_folder = package_file.parent
            candidate = tree if candidate_folder == folder else snapshot.read_package(candidate_folder, track_dependencies=False)
            for alias in {candidate_folder.name, candidate.get('id')} - {None, ''}:
                package_aliases.setdefault(alias, []).append((candidate_folder, candidate))
        settings_file = root / 'settings' / 'Publish.json'
        snapshot.track(settings_file)
        if settings_file.is_file():
            try: settings = json.loads(settings_file.read_text(encoding='utf-8-sig'))
            except (ValueError, UnicodeError) as exc: raise ValueError('invalid project Publish.json') from exc
            if not isinstance(settings, dict): raise ValueError('project Publish.json must be an object')
        else:
            settings = {}
        args = dict(args)
        atlas_settings = settings.get('atlasSetting', {})
        if not isinstance(atlas_settings, dict): raise ValueError('project atlasSetting must be an object')
        for key in ('trimImage', 'allowRotation', 'paging', 'forceSquare'):
            if key in atlas_settings and type(atlas_settings[key]) is not bool: raise ValueError(f'invalid atlasSetting {key}')
        max_size = atlas_settings.get('maxSize', 2048)
        if type(max_size) is not int or not 0 < max_size <= 2147483647: raise ValueError('invalid atlasSetting maxSize')
        size_option = atlas_settings.get('sizeOption')
        if size_option not in (None, 'pot'): raise ValueError(f'unsupported atlasSetting sizeOption {size_option!r}')
        args.setdefault('width', max_size)
        args.setdefault('height', max_size)
        args.setdefault('trim_images', atlas_settings.get('trimImage', False))
        args.setdefault('rotate_images', atlas_settings.get('allowRotation', False))
        if size_option == 'pot': args.setdefault('shrink_atlas', True)
        force_square = atlas_settings.get('forceSquare', False)
        paging = atlas_settings.get('paging', True)
        binary_format, compressed = settings.get('binaryFormat', True), settings.get('compressDesc', False)
        if type(binary_format) is not bool or type(compressed) is not bool:
            raise ValueError('invalid project publication format settings')
        if not binary_format: raise ValueError('project requests XML publication, which is unsupported')
        if compressed:
            requested_project = Path(args['project']).resolve()
            descriptors = [requested_project] if requested_project.is_file() else sorted(root.glob('*.fairy'))
            for descriptor in descriptors:
                snapshot.track(descriptor)
            projects = [parse_xml(descriptor.read_bytes(), str(descriptor)) for descriptor in descriptors]
            if any(project.tag != 'projectDescription' for project in projects): raise ValueError('invalid project description')
            project_types = {project.get('type') for project in projects}
            if project_types != {'CocosCreator'}:
                raise ValueError('project requests compressed publication, which is unsupported for this target')
        file_extension = settings.get('fileExtension', 'bin')
        if not isinstance(file_extension, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,16}', file_extension):
            raise ValueError('invalid project publication file extension')
        items = tree.findall('./resources/*')
        if args.get('exported_only'):
            items = select_exported_resources(folder, tree)
        for item in items:
            snapshot.track(resource_path(folder, item))
        allowed_types = {'image'} if command == 'publish_images_experimental' else {'image', 'component', 'sound', 'movieclip', 'font'}
        if not items: raise ValueError('cannot publish an empty package')
        unsupported_types = sorted({item.tag for item in items if item.tag not in allowed_types})
        if unsupported_types:
            details = [f"{item.tag} {item.get('name', '?')} ({item.get('id', '?')})" for item in items if item.tag in unsupported_types]
            raise ValueError('unsupported resource types: ' + ', '.join(unsupported_types) + '; resources: ' + ', '.join(details))
        if any(set(item.attrib) - {'id', 'name', 'path', 'exported', 'scale', 'scale9grid', 'duplicatePadding', 'texture'} or len(item) for item in items):
            raise ValueError('image settings such as scale, branches and trimming are unsupported')
        package_id = tree.get('id')
        publish = tree.find('publish')
        name = publish.get('name') if publish is not None and publish.get('name') else folder.name
        if not package_id or not name or name in ('.', '..') or '/' in name or '\\' in name:
            raise ValueError('invalid package id or output name')
        output = Path(args['output']).absolute()
        if output.exists() or not output.parent.is_dir():
            raise ValueError('output must be a new directory with an existing parent')
        images, sources, components, sounds, movieclips, fonts, duplicated, resource_ids = [], {}, [], [], [], [], set(), set()
        cropped_sources = {}
        if type(args.get('trim_images', False)) is not bool: raise ValueError('trim_images must be a boolean')
        if type(args.get('rotate_images', False)) is not bool: raise ValueError('rotate_images must be a boolean')
        registered_ids = {item.get('id') for item in items}
        warnings = []
        if compressed:
            warnings.append({'setting': 'compressDesc', 'message': 'output is uncompressed; this matches observed Cocos Creator editor publication'})
        if atlas_settings:
            warnings.append({'setting': 'atlasSetting', 'message': 'project atlas defaults are applied; trimming and rotation exclude nine-slice, tiled, font images and movieclip frames'})
            unknown_atlas_keys = sorted(set(atlas_settings) - {'maxSize', 'trimImage', 'allowRotation', 'paging', 'forceSquare', 'sizeOption'})
            if unknown_atlas_keys: warnings.append({'setting': 'atlasSetting', 'keys': unknown_atlas_keys, 'message': 'unrecognized project atlas settings were not applied'})
        codegen = settings.get('codeGeneration')
        if isinstance(codegen, dict) and (codegen.get('codePath') or codegen.get('codeType')):
            warnings.append({'setting': 'codeGeneration', 'message': 'generated code is not produced by offline publication'})
        dependencies, external_packages, external_extensions = {}, {}, {}
        external_trees = {folder: tree}
        try:
            for item in items:
                ident = item.get('id')
                if not ident or ident in resource_ids or ident.startswith('atlas'):
                    raise ValueError('invalid, duplicate or reserved image id')
                resource_ids.add(ident)
                if item.get('exported', 'false') not in ('true', 'false'):
                    raise ValueError('invalid exported attribute')
                if item.tag == 'font':
                    if set(item.attrib) - {'id', 'name', 'path', 'exported', 'texture'}: raise ValueError(f'{ident}: unsupported font settings')
                    source_path = resource_path(folder, item)
                    if source_path.suffix.lower() != '.fnt': raise ValueError(f'{ident}: unsupported font source')
                    font = read_bitmap_font(source_path.read_bytes(), item.get('texture'))
                    font.update(id=ident, name=source_path.stem, exported=item.get('exported') == 'true')
                    fonts.append(font)
                    continue
                if item.tag == 'movieclip':
                    if set(item.attrib) - {'id', 'name', 'path', 'exported'}: raise ValueError(f'{ident}: unsupported movieclip settings')
                    source_path = resource_path(folder, item)
                    if source_path.suffix.lower() != '.jta': raise ValueError(f'{ident}: unsupported movieclip source')
                    jta = read_jta(source_path.read_bytes())
                    try:
                        frames = []
                        for index, frame in enumerate(jta['frames']):
                            sprite_id = f'{ident}_{index}'
                            if sprite_id in registered_ids or sprite_id in sources: raise ValueError(f'{ident}: movieclip sprite id collision')
                            source_image = jta['images'][frame['imageIndex']].copy()
                            sources[sprite_id] = source_image
                            frames.append({'id': sprite_id, 'width': source_image.width, 'height': source_image.height, 'rect': frame['rect'], 'delay': frame['delay']})
                        movieclips.append({'id': ident, 'name': source_path.stem, 'width': jta['width'], 'height': jta['height'], 'interval': jta['interval'], 'frames': frames, 'exported': item.get('exported') == 'true'})
                    finally:
                        for image in jta['images']: image.close()
                    continue
                if item.tag == 'sound':
                    if set(item.attrib) - {'id', 'name', 'path', 'exported'} or not re.fullmatch(r'[A-Za-z0-9_-]+', ident): raise ValueError(f'{ident}: unsupported sound settings or invalid id')
                    source = resource_path(folder, item)
                    ext = source.suffix.lower()
                    if ext not in ('.wav', '.mp3', '.ogg') or not source.is_file(): raise ValueError(f'{ident}: unsupported or missing sound file')
                    sounds.append({'id': ident, 'name': source.stem, 'file': ident + ext, 'exported': item.get('exported') == 'true', 'source': source})
                    continue
                if item.tag == 'component':
                    if 'scale' in item.attrib or 'scale9grid' in item.attrib or 'duplicatePadding' in item.attrib or 'texture' in item.attrib:
                        raise ValueError(f'{ident}: unsupported component settings')
                    node = parse_xml(resource_path(folder, item).read_bytes(), item.get('name', 'component'))
                    if node.tag != 'component' or 'size' not in node.attrib or set(node.attrib) - {'size', 'extention', 'idnum', 'initName', 'pivot', 'overflow', 'margin', 'scroll', 'scrollBar', 'scrollBarFlags', 'scrollBarMargin', 'scrollBarRes', 'ptrRes', 'opaque', 'mask', 'reversedMask', 'hitTest', 'designImageLayer', 'designImageAlpha', 'bgColor', 'bgColorEnabled'} or any(child.tag not in ('displayList', 'controller', 'relation', 'Button', 'ComboBox', 'ProgressBar', 'Slider', 'transition') or (child.tag == 'displayList' and child.attrib) for child in node) or len(node.findall('displayList')) > 1:
                        raise ValueError(f'{ident}: unsupported component settings')
                    # The editor records packages referenced by UI URLs in the
                    # binary dependency table, not only direct child sources.
                    for _, _, url in component_resource_urls(node):
                        address = url[5:]
                        named = '/' in address
                        owner, resource_name = address.split('/', 1) if named else (address[:8], address[8:])
                        if owner in (folder.name, package_id):
                            continue
                        candidates = package_aliases.get(owner, [])
                        if len(candidates) != 1:
                            raise ValueError(f'{ident}: UI URL not included in publication: {url}')
                        ref_folder, ref_tree = candidates[0]
                        if (named and ref_folder.name != owner) or (not named and ref_tree.get('id') != owner):
                            raise ValueError(f'{ident}: UI URL not included in publication: {url}')
                        if ref_folder not in external_trees:
                            external_trees[ref_folder] = snapshot.read_package(ref_folder)
                        ref_tree = external_trees[ref_folder]
                        ref_id = ref_tree.get('id')
                        if not ref_id or owner not in (ref_folder.name, ref_id):
                            raise ValueError('dependency package identity changed during publication')
                        if ref_id not in external_packages:
                            external_packages[ref_id] = select_exported_resources(ref_folder, ref_tree)
                        refs = [resource for resource in external_packages[ref_id] if (Path(resource.get('name', '')).stem if named else resource.get('id')) == resource_name]
                        if len(refs) != 1 or not resource_path(ref_folder, refs[0]).is_file():
                            raise ValueError(f'{ident}: UI URL not included in publication: {url}')
                        dependencies[ref_id] = {'id': ref_id, 'name': ref_folder.name}
                    if 'idnum' in node.attrib and not node.get('idnum').isdigit(): raise ValueError(f'{ident}: invalid editor id counter')
                    extension = node.get('extention')
                    if extension not in (None, 'Label', 'Button', 'ComboBox', 'ProgressBar', 'Slider', 'ScrollBar'): raise ValueError(f'{ident}: unsupported component extension')
                    combo_nodes = node.findall('ComboBox')
                    if len(combo_nodes) > 1 or (combo_nodes and extension != 'ComboBox'): raise ValueError(f'{ident}: invalid ComboBox settings')
                    combo_node = combo_nodes[0] if combo_nodes else None
                    if combo_node is not None and (set(combo_node.attrib) - {'dropdown'} or len(combo_node)): raise ValueError(f'{ident}: unsupported ComboBox settings')
                    combo_dropdown = combo_node.get('dropdown') or None if combo_node is not None else None
                    if combo_dropdown is not None and not combo_dropdown.startswith('ui://'): raise ValueError(f'{ident}: invalid ComboBox dropdown')
                    buttons = node.findall('Button')
                    if len(buttons) > 1 or (buttons and extension != 'Button'): raise ValueError(f'{ident}: invalid Button settings')
                    button = buttons[0] if buttons else None
                    if button is not None and (set(button.attrib) - {'mode', 'sound', 'downEffect', 'downEffectValue'} or len(button)):
                        raise ValueError(f'{ident}: unsupported Button settings')
                    mode = button.get('mode', 'Common') if button is not None else 'Common'
                    if mode not in ('Common', 'Check', 'Radio'): raise ValueError(f'{ident}: unsupported Button mode')
                    button_sound = button.get('sound') or None if button is not None else None
                    if button_sound is not None and not button_sound.startswith('ui://'): raise ValueError(f'{ident}: invalid Button sound')
                    button_effect = button.get('downEffect', 'none') if button is not None else 'none'
                    if button_effect not in ('none', 'dark', 'scale'): raise ValueError(f'{ident}: invalid Button downEffect')
                    try: button_effect_value = float(button.get('downEffectValue', '0.8')) if button is not None else 0.8
                    except ValueError: raise ValueError(f'{ident}: invalid Button downEffectValue')
                    if not math.isfinite(button_effect_value) or not 0 <= button_effect_value <= 10: raise ValueError(f'{ident}: invalid Button downEffectValue')
                    bars = node.findall('ProgressBar') + node.findall('Slider')
                    if len(bars) > 1 or (bars and bars[0].tag != extension): raise ValueError(f'{ident}: invalid progress or slider settings')
                    bar = bars[0] if bars else None
                    if bar is not None and (set(bar.attrib) - {'titleType', 'reverse'} or len(bar)): raise ValueError(f'{ident}: unsupported ProgressBar settings')
                    title_type = bar.get('titleType', 'percent') if bar is not None else 'percent'
                    if title_type not in ('percent', 'valueAndmax', 'value', 'max'): raise ValueError(f'{ident}: invalid progress title type')
                    reverse = bar.get('reverse', 'false') if bar is not None else 'false'
                    if reverse not in ('true', 'false'): raise ValueError(f'{ident}: invalid progress reverse')
                    try: dims = [int(value) for value in node.get('size', '').split(',')]
                    except ValueError: raise ValueError(f'{ident}: invalid component size')
                    if len(dims) != 2 or any(v <= 0 or v > 100000 for v in dims): raise ValueError(f'{ident}: invalid component size')
                    overflow = node.get('overflow', 'visible')
                    if overflow not in ('visible', 'hidden', 'scroll'): raise ValueError(f'{ident}: unsupported component overflow')
                    def margin_value(key):
                        if key not in node.attrib: return None
                        try: values = [int(x) for x in node.get(key).split(',')]
                        except ValueError: raise ValueError(f'{ident}: invalid {key}')
                        if len(values) != 4 or any(x < 0 or x > 100000 for x in values): raise ValueError(f'{ident}: invalid {key}')
                        return values
                    margin, bar_margin = margin_value('margin'), margin_value('scrollBarMargin')
                    def scroll_resources(element):
                        resources = []
                        for key in ('scrollBarRes', 'ptrRes'):
                            values = element.get(key, ',').split(',')
                            if len(values) != 2 or any(value and not value.startswith('ui://') for value in values): raise ValueError(f'{ident}: invalid {key}')
                            resources.extend(value or None for value in values)
                        return resources
                    root_scroll_resources = scroll_resources(node)
                    scroll = None
                    if overflow == 'scroll':
                        direction, bar_display = node.get('scroll', 'vertical'), node.get('scrollBar', 'default')
                        directions = {'horizontal': 0, 'vertical': 1, 'both': 2}
                        bar_displays = {'default': 0, 'visible': 1, 'auto': 2, 'hidden': 3}
                        if direction not in directions or bar_display not in bar_displays: raise ValueError(f'{ident}: invalid scroll configuration')
                        try: flags = int(node.get('scrollBarFlags', '0'))
                        except ValueError: raise ValueError(f'{ident}: invalid scrollBarFlags')
                        if flags < 0 or flags > 2147483647: raise ValueError(f'{ident}: invalid scrollBarFlags')
                        scroll = {'type': directions[direction], 'barDisplay': bar_displays[bar_display], 'flags': flags, 'barMargin': bar_margin, 'resources': root_scroll_resources}
                    else:
                        # The editor retains these settings when scrolling is
                        # turned off; the runtime has no scroll section then.
                        if node.get('scroll', 'vertical') not in ('horizontal', 'vertical', 'both') or node.get('scrollBar', 'default') not in ('default', 'visible', 'auto', 'hidden'):
                            raise ValueError(f'{ident}: invalid scroll configuration')
                        try: flags = int(node.get('scrollBarFlags', '0'))
                        except ValueError: raise ValueError(f'{ident}: invalid scrollBarFlags')
                        if flags < 0 or flags > 2147483647: raise ValueError(f'{ident}: invalid scrollBarFlags')
                    root_pivot = None
                    if 'pivot' in node.attrib:
                        try: root_pivot = [float(part) for part in node.get('pivot').split(',')]
                        except ValueError: raise ValueError(f'{ident}: invalid component pivot')
                        if len(root_pivot) != 2 or any(not math.isfinite(v) or abs(v) > 100000 for v in root_pivot): raise ValueError(f'{ident}: invalid component pivot')
                    controllers = []
                    for ctrl in node.findall('controller'):
                        if set(ctrl.attrib) - {'name', 'pages', 'selected'} or not ctrl.get('name'):
                            raise ValueError(f'{ident}: unsupported controller settings')
                        parts = ctrl.get('pages', '').split(',') if ctrl.get('pages') else []
                        if len(parts) % 2 or any(not x for x in parts[::2]) or len(set(parts[::2])) != len(parts[::2]):
                            raise ValueError(f'{ident}: invalid controller pages')
                        try: selected = int(ctrl.get('selected', '0'))
                        except ValueError: raise ValueError(f'{ident}: invalid controller selection')
                        if selected < 0 or selected > 32767 or (parts and selected >= len(parts) // 2) or (not parts and selected != 0): raise ValueError(f'{ident}: invalid controller selection')
                        # `selected` is the editor's current preview page. The
                        # reference editor publishes the default home page 0.
                        actions = []
                        for action in ctrl:
                            if action.tag != 'action' or action.get('type') != 'play_transition' or set(action.attrib) - {'type', 'fromPage', 'toPage', 'transition'} or len(action) or not action.get('transition'):
                                raise ValueError(f'{ident}: unsupported controller action')
                            from_pages = action.get('fromPage', '').split(',') if action.get('fromPage') else []
                            to_pages = action.get('toPage', '').split(',') if action.get('toPage') else []
                            if any(page not in parts[::2] for page in from_pages + to_pages): raise ValueError(f'{ident}: controller action references unknown page')
                            actions.append({'type': 0, 'from': from_pages, 'to': to_pages, 'transition': action.get('transition'), 'times': 1, 'delay': 0.0, 'stopOnExit': False})
                        if len(actions) > 32767: raise ValueError(f'{ident}: too many controller actions')
                        controllers.append({'name': ctrl.get('name'), 'pages': list(zip(parts[::2], parts[1::2])), 'selected': 0, 'actions': actions})
                    if len({c['name'] for c in controllers}) != len(controllers): raise ValueError(f'{ident}: duplicate controller names')
                    children = []
                    all_display_nodes = node.findall('./displayList/*')
                    all_ids = [child.get('id') for child in all_display_nodes]
                    if any(not value for value in all_ids) or len(set(all_ids)) != len(all_ids): raise ValueError(f'{ident}: invalid or duplicate child id')
                    groups = {child.get('id'): child for child in all_display_nodes if child.tag == 'group'}
                    for group in groups.values():
                        if not group.get('id') or group.get('advanced', 'false') not in ('true', 'false'):
                            raise ValueError(f'{ident}: invalid group')
                        if group.get('advanced', 'false') == 'false' and (set(group.attrib) - {'id', 'name', 'xy', 'size', 'advanced', 'locked'} or len(group)):
                            raise ValueError(f'{ident}: unsupported editor group settings')
                    display_nodes = [child for child in all_display_nodes if child.tag != 'group' or child.get('advanced') == 'true']
                    display_ids = [child.get('id') for child in display_nodes]
                    opaque, reversed_mask = node.get('opaque', 'true'), node.get('reversedMask', 'false')
                    if opaque not in ('true', 'false') or reversed_mask not in ('true', 'false'): raise ValueError(f'{ident}: invalid component mask or opaque setting')
                    mask, hit_test = node.get('mask'), node.get('hitTest')
                    if (mask and mask not in display_ids) or (hit_test and hit_test not in display_ids) or (reversed_mask == 'true' and not mask):
                        raise ValueError(f'{ident}: invalid component mask or hit test target')
                    root_settings = {'opaque': opaque == 'true', 'mask': display_ids.index(mask) if mask else -1, 'reversedMask': reversed_mask == 'true', 'hitTestChild': display_ids.index(hit_test) if hit_test else None}
                    transitions = []
                    for trans in node.findall('transition'):
                        if set(trans.attrib) - {'name', 'options', 'autoPlay', 'autoPlayRepeat'} or not trans.get('name'): raise ValueError(f'{ident}: unsupported transition settings')
                        auto_play = trans.get('autoPlay', 'false')
                        if auto_play not in ('true', 'false'): raise ValueError(f'{ident}: invalid transition autoplay')
                        try: repeat = int(trans.get('autoPlayRepeat', '1'))
                        except ValueError: raise ValueError(f'{ident}: invalid transition repeat')
                        if not -1 <= repeat <= 2147483647: raise ValueError(f'{ident}: invalid transition repeat')
                        try: options = int(trans.get('options', '0'))
                        except ValueError: raise ValueError(f'{ident}: invalid transition options')
                        if not 0 <= options <= 2147483647: raise ValueError(f'{ident}: invalid transition options')
                        transition = {'name': trans.get('name'), 'options': options, 'autoPlay': auto_play == 'true', 'autoPlayTimes': repeat, 'items': []}
                        for action in trans:
                            if action.tag != 'item' or set(action.attrib) - {'type', 'time', 'target', 'tween', 'startValue', 'endValue', 'value', 'duration', 'ease', 'repeat', 'yoyo', 'label', 'label2', 'path'} or len(action): raise ValueError(f'{ident}: unsupported transition item')
                            kinds = {'XY': 0, 'Size': 1, 'Scale': 2, 'Pivot': 3, 'Alpha': 4, 'Rotation': 5, 'Color': 6, 'Animation': 7, 'Visible': 8, 'Sound': 9, 'Transition': 10, 'Shake': 11, 'ColorFilter': 12, 'Text': 14, 'Icon': 15}
                            kind = kinds.get(action.get('type'))
                            if kind is None: raise ValueError(f'{ident}: unsupported transition action')
                            try: frame = int(action.get('time', '0'))
                            except ValueError: raise ValueError(f'{ident}: invalid transition time')
                            if not 0 <= frame <= 2400000: raise ValueError(f'{ident}: invalid transition time')
                            target = action.get('target')
                            if target and target not in display_ids:
                                warnings.append({'component': ident, 'transition': trans.get('name'), 'target': target, 'message': 'transition item omitted because its target is missing, matching editor output'})
                                continue
                            animated = action.get('tween', 'false')
                            if animated not in ('true', 'false'): raise ValueError(f'{ident}: invalid transition tween')
                            def transition_value(value):
                                if value is None: raise ValueError(f'{ident}: missing transition value')
                                if kind == 6:
                                    if not re.fullmatch(r'#[0-9a-fA-F]{6}', value): raise ValueError(f'{ident}: invalid transition color')
                                    return [int(value[i:i + 2], 16) for i in (1, 3, 5)] + [255]
                                if kind == 8:
                                    if value not in ('true', 'false'): raise ValueError(f'{ident}: invalid transition visibility')
                                    return value == 'true'
                                if kind == 7:
                                    parts = value.split(',')
                                    if len(parts) != 2 or parts[1] not in ('p', 's'): raise ValueError(f'{ident}: invalid transition animation')
                                    try: frame = int(parts[0])
                                    except ValueError: raise ValueError(f'{ident}: invalid transition animation')
                                    if not 0 <= frame <= 2147483647: raise ValueError(f'{ident}: invalid transition animation')
                                    return {'playing': parts[1] == 'p', 'frame': frame}
                                if kind == 9: return {'sound': value, 'volume': 1.0}
                                if kind == 10: return {'name': value, 'times': 1}
                                if kind in (14, 15): return value
                                parts = value.split(',')
                                expected = 4 if kind == 12 else 2 if kind in (0, 1, 2, 3, 11) else 1
                                if len(parts) != expected: raise ValueError(f'{ident}: invalid transition value')
                                try: values = [0.0 if v == '-' and kind in (0, 1, 3) else float(v) for v in parts]
                                except ValueError: raise ValueError(f'{ident}: invalid transition value')
                                if any(not math.isfinite(v) or abs(v) > 100000 for v in values): raise ValueError(f'{ident}: invalid transition value')
                                return {'flags': [part != '-' for part in parts], 'values': values} if kind in (0, 1, 3) else values
                            # FairyGUI computes frame times with a float32 tick.
                            frame_tick = struct.unpack('>f', struct.pack('>f', 1 / 24))[0]
                            entry = {'type': kind, 'time': frame * frame_tick, 'target': display_ids.index(target) if target else -1, 'label': action.get('label')}
                            if animated == 'true':
                                if kind not in (0, 1, 2, 3, 4, 5, 6, 12): raise ValueError(f'{ident}: invalid transition tween type')
                                names = ['Linear'] + [f'{family}.{mode}' for family in ('Sine', 'Quad', 'Cubic', 'Quart', 'Quint', 'Expo', 'Circ', 'Elastic', 'Back', 'Bounce') for mode in ('In', 'Out', 'InOut')]
                                ease, yoyo = action.get('ease', 'Quad.Out'), action.get('yoyo', 'false')
                                if ease not in names or yoyo not in ('true', 'false'): raise ValueError(f'{ident}: invalid transition tween settings')
                                try: duration, loops = int(action.get('duration', '0')), int(action.get('repeat', '0'))
                                except ValueError: raise ValueError(f'{ident}: invalid transition duration or repeat')
                                if not 0 <= duration <= 2400000 or not -1 <= loops <= 2147483647: raise ValueError(f'{ident}: invalid transition duration or repeat')
                                entry['tween'] = {'duration': duration * frame_tick, 'ease': names.index(ease), 'repeat': loops, 'yoyo': yoyo == 'true', 'endLabel': action.get('label2'), 'start': transition_value(action.get('startValue')), 'end': transition_value(action.get('endValue'))}
                                if 'path' in action.attrib:
                                    if kind != 0: raise ValueError(f'{ident}: path requires XY transition')
                                    parts = action.get('path').split(',')
                                    if not parts or len(parts) % 8 or len(parts) // 8 > 32767: raise ValueError(f'{ident}: invalid transition path')
                                    path = []
                                    for index in range(0, len(parts), 8):
                                        values = parts[index:index + 8]
                                        if values[0] != '2' or values[7] not in ('0', '1'): raise ValueError(f'{ident}: unsupported transition path point')
                                        try: points = [float(value) for value in values[1:7]]
                                        except ValueError: raise ValueError(f'{ident}: invalid transition path point')
                                        if any(not math.isfinite(value) or abs(value) > 1000000 for value in points): raise ValueError(f'{ident}: invalid transition path point')
                                        path.append({'curve': 2, 'points': points})
                                    entry['tween']['path'] = path
                            else:
                                if any(key in action.attrib for key in ('duration', 'repeat', 'ease', 'yoyo', 'startValue', 'endValue', 'label2', 'path')): raise ValueError(f'{ident}: transition tween settings without tween')
                                entry['value'] = transition_value(action.get('value'))
                            transition['items'].append(entry)
                        transitions.append(transition)
                    if len({t['name'] for t in transitions}) != len(transitions) or len(transitions) > 32767: raise ValueError(f'{ident}: duplicate or excessive transitions')
                    if any(action['transition'] not in {t['name'] for t in transitions} for ctrl in controllers for action in ctrl['actions']):
                        raise ValueError(f'{ident}: controller action references unknown transition')
                    relation_names = RELATION_TYPES
                    def read_relation(relation, owner_id=None):
                        if set(relation.attrib) != {'target', 'sidePair'} or len(relation): raise ValueError(f'{ident}: unsupported relation settings')
                        target = relation.get('target')
                        if target and (target not in display_ids or target == owner_id): raise ValueError(f'{ident}: invalid relation target')
                        pairs = relation.get('sidePair', '').split(',')
                        pairs = [{'width': 'width-width', 'height': 'height-height'}.get(pair, pair) for pair in pairs]
                        if not pairs or any(pair not in relation_names for pair in pairs) or len(pairs) > 255: raise ValueError(f'{ident}: unsupported relation type')
                        return {'target': display_ids.index(target) if target else -1, 'types': [relation_names.index(pair) for pair in pairs]}
                    root_relations = [read_relation(relation) for relation in node.findall('relation')]
                    if len(root_relations) > 255: raise ValueError(f'{ident}: too many relations')
                    for child in display_nodes:
                        if child.tag == 'jta': child.tag = 'movieclip'
                        if child.tag == 'text' and 'input' in child.attrib:
                            if child.get('input') not in ('true', 'false'): raise ValueError(f'{ident}: invalid input flag')
                            if child.get('input') == 'true': child.tag = 'inputtext'
                        allowed = {'id', 'name', 'pkg', 'xy', 'size', 'scale', 'alpha', 'rotation', 'visible', 'touchable', 'locked', 'aspect', 'pivot', 'anchor', 'grayed', 'restrictSize', 'group'}
                        allowed |= {'src', 'fileName', 'color', 'flip', 'fillMethod', 'fillClockwise', 'fillAmount', 'forHitTest'} if child.tag == 'image' else {'src', 'fileName'} if child.tag == 'component' else {'text', 'fontSize', 'color', 'font', 'align', 'vAlign', 'autoSize', 'leading', 'letterSpacing', 'underline', 'italic', 'bold', 'singleLine', 'strokeColor', 'shadowColor', 'shadowOffset', 'ubb', 'demoText', 'input'} if child.tag in ('text', 'richtext', 'inputtext') else {'type', 'lineSize', 'lineColor', 'fillColor', 'corner', 'points', 'sides', 'startAngle', 'distances'} if child.tag == 'graph' else {'url', 'align', 'vAlign', 'fill', 'color', 'fillMethod', 'fillClockwise', 'fillAmount'} if child.tag == 'loader' else set()
                        if child.tag == 'inputtext': allowed |= {'prompt', 'restrict', 'maxLength', 'keyboardType', 'password'}
                        if child.tag == 'group': allowed |= {'advanced'}
                        if child.tag == 'richtext': allowed.discard('input')
                        if child.tag == 'movieclip': allowed |= {'src', 'fileName', 'color', 'frame', 'playing'}
                        if child.tag == 'list': allowed |= {'layout', 'selectionMode', 'align', 'vAlign', 'lineGap', 'colGap', 'lineCount', 'colCount', 'autoItemSize', 'overflow', 'scroll', 'scrollBar', 'scrollBarFlags', 'scrollBarMargin', 'scrollBarRes', 'ptrRes', 'clipSoftness', 'margin', 'defaultItem', 'pageController', 'selectionController', 'treeView', 'indent', 'clickToExpand'}
                        if child.tag not in ('image', 'text', 'richtext', 'inputtext', 'component', 'graph', 'loader', 'group', 'list', 'movieclip') or set(child.attrib) - allowed or not child.get('id') or (child.tag in ('image', 'component', 'movieclip') and not child.get('src')):
                            raise ValueError(f'{ident}: unsupported component child')
                        if 'locked' in child.attrib and child.get('locked') not in ('true', 'false'):
                            raise ValueError(f'{ident}: invalid editor lock flag')
                        if 'aspect' in child.attrib and child.get('aspect') not in ('true', 'false'):
                            raise ValueError(f'{ident}: invalid editor aspect flag')
                        child_folder, child_resources, external_id = folder, items, None
                        if child.get('pkg'):
                            candidates = package_aliases.get(child.get('pkg'), [])
                            if len(candidates) != 1: raise ValueError(f"package {child.get('pkg')!r} not found or ambiguous")
                            child_folder, other_tree = candidates[0]
                            if child_folder not in external_trees:
                                external_trees[child_folder] = snapshot.read_package(child_folder)
                            other_tree = external_trees[child_folder]
                            if child.get('pkg') not in (child_folder.name, other_tree.get('id')): raise ValueError('dependency package identity changed during publication')
                            external_id = other_tree.get('id')
                            if not external_id: raise ValueError(f'{ident}: referenced package has no ID')
                            if external_id == package_id: external_id = None; child_folder = folder
                            else:
                                if child.tag not in ('image', 'component', 'movieclip'):
                                    raise ValueError(f'{ident}: package reference requires a resource child')
                                if external_id not in external_packages:
                                    external_packages[external_id] = select_exported_resources(child_folder, other_tree)
                                child_resources = external_packages[external_id]
                                refs = [resource for resource in child_resources if resource.get('id') == child.get('src') and resource.tag == child.tag]
                                if len(refs) != 1: raise ValueError(f'{ident}: referenced external resource is missing or not published')
                                dependencies[external_id] = {'id': external_id, 'name': child_folder.name}
                                if child.tag == 'component':
                                    key = (external_id, child.get('src'))
                                    if key not in external_extensions:
                                        external_root = parse_xml(resource_path(child_folder, refs[0]).read_bytes(), 'external component')
                                        if external_root.tag != 'component': raise ValueError(f'{ident}: invalid external component')
                                        external_extensions[key] = {'Label': 11, 'Button': 12, 'ComboBox': 13, 'ProgressBar': 14, 'Slider': 15, 'ScrollBar': 16, None: 0}.get(external_root.get('extention'))
                        if 'fileName' in child.attrib:
                            refs = [resource for resource in child_resources if resource.get('id') == child.get('src') and resource.tag == child.tag]
                            if len(refs) != 1:
                                raise ValueError(f'{ident}: fileName has no matching resource')
                            actual = resource_path(child_folder, refs[0]).relative_to(child_folder.resolve()).as_posix()
                            if child.get('fileName').replace('\\', '/').lstrip('/') != actual:
                                raise ValueError(f'{ident}: fileName does not match referenced resource')
                        try: xy = [int(v) for v in child.get('xy', '0,0').split(',')]
                        except ValueError: raise ValueError(f'{ident}: invalid child position')
                        if len(xy) != 2 or any(v < -2147483648 or v > 2147483647 for v in xy): raise ValueError(f'{ident}: invalid child position')
                        obj = {'type': child.tag, 'id': child.get('id'), 'name': child.get('name'), 'src': child.get('src'), 'x': xy[0], 'y': xy[1]}
                        if external_id: obj['pkg'] = external_id
                        if child.tag == 'image' and 'forHitTest' in child.attrib:
                            if child.get('forHitTest') not in ('true', 'false'): raise ValueError(f'{ident}: invalid forHitTest')
                            if child.get('forHitTest') == 'true':
                                if external_id: raise ValueError(f'{ident}: external pixel hit test image unsupported')
                                if root_settings['hitTestChild'] is not None or 'hitTestImage' in root_settings or xy != [0, 0] or any(key in child.attrib for key in ('size', 'scale', 'pivot', 'rotation', 'flip', 'fillMethod')):
                                    raise ValueError(f'{ident}: unsupported pixel hit test image geometry')
                                root_settings['hitTestImage'] = child.get('src')
                        if child.tag == 'list':
                            settings = {}
                            tree_flag = child.get('treeView', 'false')
                            if tree_flag not in ('true', 'false'): raise ValueError(f'{ident}: invalid treeView flag')
                            is_tree = tree_flag == 'true'
                            if is_tree:
                                obj['type'] = 'tree'
                                try: indent, click = int(child.get('indent', '15')), int(child.get('clickToExpand', '0'))
                                except ValueError: raise ValueError(f'{ident}: invalid tree settings')
                                if not 0 <= indent <= 100000 or not 0 <= click <= 2: raise ValueError(f'{ident}: invalid tree settings')
                                settings.update(indent=indent, clickToExpand=click)
                            elif any(key in child.attrib for key in ('indent', 'clickToExpand')):
                                raise ValueError(f'{ident}: tree settings require treeView')
                            mappings = [('layout', {'column': 0, 'row': 1, 'flow_hz': 2, 'flow_vt': 3, 'pagination': 4}, 'column'), ('selectionMode', {'single': 0, 'multiple': 1, 'multipleSingleClick': 2, 'none': 3}, 'single'), ('align', {'left': 0, 'center': 1, 'right': 2}, 'left'), ('vAlign', {'top': 0, 'middle': 1, 'bottom': 2}, 'top'), ('overflow', {'visible': 0, 'hidden': 1, 'scroll': 2}, 'visible')]
                            for key, mapping, default in mappings:
                                value = child.get(key, default)
                                if value not in mapping: raise ValueError(f'{ident}: invalid list {key}')
                                settings[key] = mapping[value]
                            for key in ('lineGap', 'colGap', 'lineCount', 'colCount'):
                                try: value = int(child.get(key, '0'))
                                except ValueError: raise ValueError(f'{ident}: invalid list {key}')
                                if not -32768 <= value <= 32767 or (key.endswith('Count') and value < 0): raise ValueError(f'{ident}: invalid list {key}')
                                settings[key] = value
                            auto = child.get('autoItemSize', 'true' if settings['layout'] in (0, 1) else 'false')
                            if auto not in ('true', 'false'): raise ValueError(f'{ident}: invalid list autoItemSize')
                            settings['autoItemSize'] = auto == 'true'
                            for key, count in [('margin', 4), ('clipSoftness', 2), ('scrollBarMargin', 4)]:
                                if key not in child.attrib: continue
                                try: values = [int(x) for x in child.get(key).split(',')]
                                except ValueError: raise ValueError(f'{ident}: invalid list {key}')
                                if len(values) != count or any(v < 0 or v > 100000 for v in values): raise ValueError(f'{ident}: invalid list {key}')
                                settings[key] = values
                            for key in ('pageController', 'selectionController'):
                                controller_name = child.get(key)
                                matches = [i for i, ctrl in enumerate(controllers) if ctrl['name'] == controller_name] if controller_name else []
                                if controller_name and len(matches) != 1: raise ValueError(f'{ident}: invalid list {key}')
                                settings[key] = matches[0] if matches else -1
                            if settings['overflow'] == 2:
                                directions, displays = {'horizontal': 0, 'vertical': 1, 'both': 2}, {'default': 0, 'visible': 1, 'auto': 2, 'hidden': 3}
                                direction, display = child.get('scroll', 'vertical'), child.get('scrollBar', 'default')
                                if direction not in directions or display not in displays: raise ValueError(f'{ident}: invalid list scroll')
                                try: flags = int(child.get('scrollBarFlags', '0'))
                                except ValueError: raise ValueError(f'{ident}: invalid list scrollBarFlags')
                                if not 0 <= flags <= 2147483647: raise ValueError(f'{ident}: invalid list scrollBarFlags')
                                settings['scroll'] = {'type': directions[direction], 'barDisplay': displays[display], 'flags': flags, 'barMargin': settings.get('scrollBarMargin'), 'resources': scroll_resources(child)}
                            elif any(key in child.attrib for key in ('scroll', 'scrollBar', 'scrollBarFlags', 'scrollBarMargin', 'scrollBarRes', 'ptrRes', 'pageController')):
                                raise ValueError(f'{ident}: list scroll settings require scroll overflow')
                            settings['defaultItem'] = child.get('defaultItem') or None
                            settings['items'] = []
                            for item_node in child.findall('item'):
                                if set(item_node.attrib) - ({'url', 'title', 'selectedTitle', 'icon', 'selectedIcon', 'name'} | ({'level'} if is_tree else set())) or len(item_node): raise ValueError(f'{ident}: unsupported list item settings')
                                entry = {key: item_node.get(key) or None for key in ('url', 'title', 'selectedTitle', 'icon', 'selectedIcon', 'name')}
                                if is_tree:
                                    try: level = int(item_node.get('level', '0'))
                                    except ValueError: raise ValueError(f'{ident}: invalid tree level')
                                    previous = settings['items'][-1]['level'] if settings['items'] else -1
                                    if not 0 <= level <= 255 or level > previous + 1: raise ValueError(f'{ident}: invalid tree level')
                                    entry['level'] = level
                                settings['items'].append(entry)
                            if is_tree:
                                for index, entry in enumerate(settings['items']):
                                    entry['folder'] = index + 1 < len(settings['items']) and settings['items'][index + 1]['level'] > entry['level']
                            if len(settings['items']) > 32767: raise ValueError(f'{ident}: too many list items')
                            obj['list'] = settings
                        if 'group' in child.attrib:
                            parent_group = groups.get(child.get('group'))
                            if parent_group is None or child.tag == 'group': raise ValueError(f'{ident}: invalid group reference')
                            if parent_group.get('advanced') == 'true': obj['groupIndex'] = display_ids.index(child.get('group'))
                        if 'restrictSize' in child.attrib:
                            try: limits = [int(value) for value in child.get('restrictSize').split(',')]
                            except ValueError: raise ValueError(f'{ident}: invalid child restrictSize')
                            if len(limits) != 4 or any(value < 0 or value > 100000 for value in limits) or any(limits[i+1] and limits[i] > limits[i+1] for i in (0, 2)): raise ValueError(f'{ident}: invalid child restrictSize')
                            obj['constraints'] = limits
                        if child.tag == 'loader':
                            obj['url'] = child.get('url') or None
                            for key, mapping in [('align', {'left': 0, 'center': 1, 'right': 2}), ('vAlign', {'top': 0, 'middle': 1, 'bottom': 2}), ('fill', {'none': 0, 'scale': 1, 'scaleMatchHeight': 2, 'scaleMatchWidth': 3, 'scaleFree': 4, 'scaleNoBorder': 5})]:
                                if key in child.attrib:
                                    if child.get(key) not in mapping: raise ValueError(f'{ident}: invalid loader {key}')
                                    obj[key] = mapping[child.get(key)]
                        if 'pivot' in child.attrib:
                            try: pivot = [float(v) for v in child.get('pivot').split(',')]
                            except ValueError: raise ValueError(f'{ident}: invalid child pivot')
                            if len(pivot) != 2 or any(not math.isfinite(v) or abs(v) > 100000 for v in pivot): raise ValueError(f'{ident}: invalid child pivot')
                            obj['pivot'] = pivot
                        if 'anchor' in child.attrib:
                            if child.get('anchor') not in ('true', 'false') or 'pivot' not in obj: raise ValueError(f'{ident}: invalid child anchor')
                            obj['anchor'] = child.get('anchor') == 'true'
                        if 'grayed' in child.attrib:
                            if child.get('grayed') not in ('true', 'false'): raise ValueError(f'{ident}: invalid child grayed')
                            obj['grayed'] = child.get('grayed') == 'true'
                        if child.tag == 'movieclip':
                            try: obj['frame'] = int(child.get('frame', '0'))
                            except ValueError: raise ValueError(f'{ident}: invalid movieclip frame')
                            if not 0 <= obj['frame'] <= 2147483647: raise ValueError(f'{ident}: invalid movieclip frame')
                            playing = child.get('playing', 'true')
                            if playing not in ('true', 'false'): raise ValueError(f'{ident}: invalid movieclip playing')
                            obj['playing'] = playing == 'true'
                        if child.tag in ('image', 'loader', 'movieclip'):
                            if 'color' in child.attrib:
                                color = child.get('color')
                                if not re.fullmatch(r'#[0-9a-fA-F]{6}', color): raise ValueError(f'{ident}: invalid image color')
                                obj['imageColor'] = [int(color[i:i+2], 16) for i in (1, 3, 5)] + [255]
                            flips = {'none': 0, 'hz': 1, 'vt': 2, 'both': 3}
                            flip = child.get('flip', 'none')
                            if flip not in flips: raise ValueError(f'{ident}: invalid image flip')
                            obj['flip'] = flips[flip]
                            fills = {'none': 0, 'hz': 1, 'vt': 2, 'radial90': 3, 'radial180': 4, 'radial360': 5}
                            method = child.get('fillMethod', 'none')
                            if method not in fills: raise ValueError(f'{ident}: invalid image fill method')
                            obj['fillMethod'] = fills[method]
                            if any(key in child.attrib for key in ('fillClockwise', 'fillAmount')) and not obj['fillMethod']:
                                raise ValueError(f'{ident}: image fill settings require fillMethod')
                            clockwise = child.get('fillClockwise', 'true')
                            if clockwise not in ('true', 'false'): raise ValueError(f'{ident}: invalid image fill direction')
                            obj['fillClockwise'] = clockwise == 'true'
                            try: amount = float(child.get('fillAmount', '100'))
                            except ValueError: raise ValueError(f'{ident}: invalid image fill amount')
                            if not math.isfinite(amount) or not 0 <= amount <= 100: raise ValueError(f'{ident}: invalid image fill amount')
                            obj['fillAmount'] = amount / 100
                        gears, relations, progress_override = [], [], None
                        for gear in child:
                            if child.tag == 'list' and gear.tag == 'item': continue
                            if gear.tag == 'ComboBox' and child.tag == 'component':
                                if 'comboBox' in obj or set(gear.attrib) - {'visibleItemCount'}: raise ValueError(f'{ident}: unsupported ComboBox instance settings')
                                try: visible = int(gear.get('visibleItemCount', '0'))
                                except ValueError: raise ValueError(f'{ident}: invalid ComboBox visibleItemCount')
                                if not 0 <= visible <= 2147483647: raise ValueError(f'{ident}: invalid ComboBox visibleItemCount')
                                entries = []
                                for entry in gear:
                                    if entry.tag != 'item' or set(entry.attrib) - {'title', 'value', 'icon'} or len(entry): raise ValueError(f'{ident}: unsupported ComboBox item')
                                    entries.append({key: entry.get(key) for key in ('title', 'value', 'icon')})
                                if len(entries) > 32767: raise ValueError(f'{ident}: too many ComboBox items')
                                obj['comboBox'] = {'items': entries, 'visibleItemCount': visible}
                                continue
                            if gear.tag == 'Button' and child.tag == 'component':
                                if 'button' in obj or set(gear.attrib) - {'title', 'selectedTitle', 'icon', 'selectedIcon', 'titleColor', 'titleFontSize', 'controller', 'page', 'checked'} or len(gear): raise ValueError(f'{ident}: unsupported button instance settings')
                                button_instance = {key: gear.get(key) for key in ('title', 'selectedTitle', 'icon', 'selectedIcon')}
                                controller_name, page = gear.get('controller'), gear.get('page')
                                matches = [i for i, ctrl in enumerate(controllers) if ctrl['name'] == controller_name] if controller_name else []
                                if controller_name and len(matches) != 1: raise ValueError(f'{ident}: invalid button controller')
                                if page is not None and (not matches or page not in {p[0] for p in controllers[matches[0]]['pages']}): raise ValueError(f'{ident}: invalid button page')
                                button_instance.update(controller=matches[0] if matches else -1, page=page)
                                checked = gear.get('checked', 'false')
                                if checked not in ('true', 'false'): raise ValueError(f'{ident}: invalid button checked')
                                button_instance['checked'] = checked == 'true'
                                color = gear.get('titleColor')
                                if color is not None:
                                    if not re.fullmatch(r'#[0-9a-fA-F]{6}', color): raise ValueError(f'{ident}: invalid button color')
                                    button_instance['color'] = [int(color[i:i+2], 16) for i in (1, 3, 5)] + [255]
                                try: button_instance['fontSize'] = int(gear.get('titleFontSize', '0'))
                                except ValueError: raise ValueError(f'{ident}: invalid button font size')
                                if not 0 <= button_instance['fontSize'] <= 2147483647: raise ValueError(f'{ident}: invalid button font size')
                                obj['button'] = button_instance
                                continue
                            if gear.tag == 'Label' and child.tag == 'component':
                                if 'label' in obj or set(gear.attrib) - {'title', 'icon', 'titleColor', 'titleFontSize'} or len(gear): raise ValueError(f'{ident}: unsupported label instance settings')
                                label = {'title': gear.get('title'), 'icon': gear.get('icon')}
                                color = gear.get('titleColor')
                                if color is not None:
                                    if not re.fullmatch(r'#[0-9a-fA-F]{6}', color): raise ValueError(f'{ident}: invalid label color')
                                    label['color'] = [int(color[i:i+2], 16) for i in (1, 3, 5)] + [255]
                                try: label['fontSize'] = int(gear.get('titleFontSize', '0'))
                                except ValueError: raise ValueError(f'{ident}: invalid label font size')
                                if not 0 <= label['fontSize'] <= 2147483647: raise ValueError(f'{ident}: invalid label font size')
                                obj['label'] = label
                                continue
                            if gear.tag in ('ProgressBar', 'Slider') and child.tag == 'component':
                                if progress_override is not None or set(gear.attrib) - {'value', 'max', 'min'} or len(gear): raise ValueError(f'{ident}: unsupported progress instance settings')
                                try: progress_override = [int(gear.get(key, default)) for key, default in [('value', '50'), ('max', '100'), ('min', '0')]]
                                except ValueError: raise ValueError(f'{ident}: invalid progress instance value')
                                if any(value < -2147483648 or value > 2147483647 for value in progress_override): raise ValueError(f'{ident}: invalid progress instance value')
                                obj['progressKind'] = 14 if gear.tag == 'ProgressBar' else 15
                                continue
                            if gear.tag == 'relation':
                                relations.append(read_relation(gear, child.get('id')))
                                continue
                            allowed_gear = {'controller', 'pages'} if gear.tag == 'gearDisplay' else {'controller', 'pages', 'condition'} if gear.tag == 'gearDisplay2' else {'controller', 'pages', 'values', 'default'} if (gear.tag in ('gearText', 'gearFontSize') and child.tag in ('text', 'richtext', 'inputtext')) or (gear.tag == 'gearIcon' and child.tag in ('loader', 'component')) or (gear.tag == 'gearAni' and child.tag in ('movieclip', 'loader')) or gear.tag == 'gearColor' else {'controller', 'pages', 'values', 'default', 'tween', 'ease', 'duration', 'delay'} if gear.tag in ('gearXY', 'gearSize', 'gearLook') else set()
                            if not allowed_gear or set(gear.attrib) - allowed_gear or len(gear) or not gear.get('controller'):
                                raise ValueError(f'{ident}: unsupported child behavior')
                            matches = [i for i, ctrl in enumerate(controllers) if ctrl['name'] == gear.get('controller')]
                            gear_type = {'gearDisplay': 'display', 'gearDisplay2': 'display2', 'gearFontSize': 'fontSize', 'gearText': 'text', 'gearIcon': 'icon', 'gearAni': 'animation', 'gearXY': 'xy', 'gearSize': 'size', 'gearLook': 'look', 'gearColor': 'color'}[gear.tag]
                            if len(matches) != 1 or any(existing['type'] == gear_type for existing in gears): raise ValueError(f'{ident}: invalid or duplicate gear controller')
                            pages = gear.get('pages', '').split(',') if gear.get('pages') else []
                            unknown_pages = [page for page in pages if page not in {p[0] for p in controllers[matches[0]]['pages']}]
                            if unknown_pages:
                                warnings.append({'component': ident, 'child': child.get('id'), 'gear': gear.tag, 'pages': unknown_pages, 'message': 'unknown gear pages retained to match editor output'})
                            if len(set(pages)) != len(pages): raise ValueError(f'{ident}: duplicate gear page')
                            data = {'type': gear_type, 'controllerIndex': matches[0], 'pages': pages}
                            if gear_type == 'display2':
                                condition = gear.get('condition', '0')
                                if condition not in ('0', '1'): raise ValueError(f'{ident}: invalid display2 condition')
                                data['condition'] = int(condition)
                            if gear_type in ('xy', 'size', 'look'):
                                tween = gear.get('tween', 'false')
                                if tween not in ('true', 'false'): raise ValueError(f'{ident}: invalid gear tween')
                                if tween == 'false' and any(key in gear.attrib for key in ('ease', 'duration', 'delay')): raise ValueError(f'{ident}: tween settings require tween=true')
                                if tween == 'true':
                                    names = ['Linear'] + [f'{family}.{mode}' for family in ('Sine', 'Quad', 'Cubic', 'Quart', 'Quint', 'Expo', 'Circ', 'Elastic', 'Back', 'Bounce') for mode in ('In', 'Out', 'InOut')]
                                    ease = gear.get('ease', 'Quad.Out')
                                    if ease not in names: raise ValueError(f'{ident}: unsupported tween ease')
                                    try: duration, delay = float(gear.get('duration', '0.3')), float(gear.get('delay', '0'))
                                    except ValueError: raise ValueError(f'{ident}: invalid tween timing')
                                    if not all(math.isfinite(x) and 0 <= x <= 100000 for x in (duration, delay)): raise ValueError(f'{ident}: invalid tween timing')
                                    data['tween'] = {'ease': names.index(ease), 'duration': duration, 'delay': delay}
                            if gear_type in ('text', 'icon', 'animation', 'xy', 'size', 'look', 'color', 'fontSize'):
                                if 'values' not in gear.attrib: raise ValueError(f'{ident}: gear requires values')
                                values = gear.get('values').split('|')
                                if len(values) != len(pages): raise ValueError(f'{ident}: gear values and pages differ')
                                if gear_type == 'fontSize':
                                    def pair(value):
                                        try: size = int(value)
                                        except ValueError: raise ValueError(f'{ident}: invalid font size gear value')
                                        if not 0 <= size <= 2147483647: raise ValueError(f'{ident}: invalid font size gear value')
                                        return size
                                    values = [None if value == '-' else pair(value) for value in values]
                                elif gear_type == 'animation':
                                    def pair(value):
                                        parts = value.split(',')
                                        if len(parts) != 2 or parts[1] not in ('p', 's'): raise ValueError(f'{ident}: invalid animation gear value')
                                        try: frame = int(parts[0])
                                        except ValueError: raise ValueError(f'{ident}: invalid animation gear value')
                                        if not 0 <= frame <= 2147483647: raise ValueError(f'{ident}: invalid animation gear value')
                                        return {'playing': parts[1] == 'p', 'frame': frame}
                                    values = [None if value == '-' else pair(value) for value in values]
                                elif gear_type == 'color':
                                    def pair(value):
                                        colors = value.split(',')
                                        if len(colors) not in (1, 2) or any(not re.fullmatch(r'#[0-9a-fA-F]{6}', color) for color in colors): raise ValueError(f'{ident}: invalid gear color')
                                        if len(colors) == 1: colors.append('#000000')
                                        return [[int(color[i:i+2], 16) for i in (1, 3, 5)] + [255] for color in colors]
                                    values = [None if value == '-' else pair(value) for value in values]
                                elif gear_type == 'look':
                                    def pair(value):
                                        parts = value.split(',')
                                        if len(parts) not in (3, 4) or any(x not in ('0', '1') for x in parts[2:]): raise ValueError(f'{ident}: invalid gear look')
                                        try: alpha, rotation = float(parts[0]), float(parts[1])
                                        except ValueError: raise ValueError(f'{ident}: invalid gear look')
                                        if not math.isfinite(alpha) or not math.isfinite(rotation) or not 0 <= alpha <= 1 or abs(rotation) > 100000: raise ValueError(f'{ident}: invalid gear look')
                                        return [alpha, rotation, int(parts[2]), int(parts[3]) if len(parts) == 4 else 1]
                                    values = [None if value == '-' else pair(value) for value in values]
                                elif gear_type in ('xy', 'size'):
                                    def pair(value):
                                        parts = value.split(',')
                                        if len(parts) not in ((2, 4) if gear_type == 'size' else (2,)): raise ValueError(f'{ident}: invalid gear position or size')
                                        try: numbers = [int(part) for part in parts[:2]] + ([float(part) for part in parts[2:]] if len(parts) == 4 else ([1.0, 1.0] if gear_type == 'size' else []))
                                        except ValueError: raise ValueError(f'{ident}: invalid gear position or size')
                                        if any(v < -2147483648 or v > 2147483647 for v in numbers[:2]) or (gear_type == 'size' and (any(v < 0 for v in numbers[:2]) or any(not math.isfinite(v) or abs(v) > 100000 for v in numbers[2:]))): raise ValueError(f'{ident}: invalid gear position or size')
                                        return numbers
                                    values = [None if value == '-' else pair(value) for value in values]
                                data['values'] = values
                                if 'default' in gear.attrib: data['default'] = pair(gear.get('default')) if gear_type in ('xy', 'size', 'look', 'color', 'animation', 'fontSize') else gear.get('default')
                            gears.append(data)
                        obj['gears'] = gears
                        if progress_override is not None: obj['progress'] = progress_override
                        if sum(key in obj for key in ('progress', 'label', 'button', 'comboBox')) > 1: raise ValueError(f'{ident}: conflicting component instance settings')
                        if len(relations) > 255: raise ValueError(f'{ident}: too many relations')
                        obj['relations'] = relations
                        if child.tag == 'graph':
                            kind = child.get('type')
                            if kind not in (None, 'rect', 'eclipse', 'polygon', 'regular_polygon'): raise ValueError(f'{ident}: unsupported graph type')
                            obj['graphType'] = {None: 0, 'rect': 1, 'eclipse': 2, 'polygon': 3, 'regular_polygon': 4}[kind]
                            try: line_size = int(child.get('lineSize', '1'))
                            except ValueError: raise ValueError(f'{ident}: invalid lineSize')
                            if line_size < 0 or line_size > 100000: raise ValueError(f'{ident}: invalid lineSize')
                            obj['lineSize'] = line_size
                            for color_key, default in [('lineColor', '#ff000000'), ('fillColor', '#ffffffff')]:
                                value = child.get(color_key, default)
                                if not re.fullmatch(r'#[0-9a-fA-F]{8}', value): raise ValueError(f'{ident}: invalid {color_key}')
                                obj[color_key] = tuple(int(value[i:i+2], 16) for i in (3, 5, 7, 1))
                            def graph_floats(key):
                                try: values = [float(v) for v in child.get(key, '').split(',')]
                                except ValueError: raise ValueError(f'{ident}: invalid graph {key}')
                                if any(not math.isfinite(v) or abs(v) > 1000000 for v in values): raise ValueError(f'{ident}: invalid graph {key}')
                                return values
                            if 'corner' in child.attrib:
                                if kind != 'rect': raise ValueError(f'{ident}: corner requires rectangle')
                                radius = graph_floats('corner')
                                if len(radius) not in (1, 4) or any(v < 0 for v in radius): raise ValueError(f'{ident}: invalid graph corner')
                                obj['cornerRadius'] = radius * 4 if len(radius) == 1 else radius
                            if kind == 'polygon':
                                points = graph_floats('points')
                                if len(points) < 6 or len(points) % 2 or len(points) > 32766: raise ValueError(f'{ident}: invalid polygon points')
                                obj['points'] = points
                            elif 'points' in child.attrib: raise ValueError(f'{ident}: points require polygon')
                            if kind == 'regular_polygon':
                                try: sides, angle = int(child.get('sides', '0')), float(child.get('startAngle', '0'))
                                except ValueError: raise ValueError(f'{ident}: invalid regular polygon')
                                if not 3 <= sides <= 32767 or not math.isfinite(angle) or abs(angle) > 1000000: raise ValueError(f'{ident}: invalid regular polygon')
                                distances = graph_floats('distances') if 'distances' in child.attrib else []
                                if distances and (len(distances) != sides or any(value < 0 for value in distances)): raise ValueError(f'{ident}: invalid polygon distances')
                                obj.update(sides=sides, startAngle=angle, distances=distances)
                            elif any(key in child.attrib for key in ('sides', 'startAngle', 'distances')): raise ValueError(f'{ident}: regular polygon settings on wrong graph type')
                        if child.tag in ('text', 'richtext', 'inputtext'):
                            obj['text'] = child.get('text') or None
                            try: font_size = int(child.get('fontSize', '0'))
                            except ValueError: raise ValueError(f'{ident}: invalid fontSize')
                            if not 0 <= font_size <= 32767: raise ValueError(f'{ident}: invalid fontSize')
                            obj['fontSize'] = font_size
                            color = child.get('color', '#000000')
                            if not re.fullmatch(r'#[0-9a-fA-F]{6}', color): raise ValueError(f'{ident}: invalid text color')
                            obj['color'] = tuple(int(color[i:i+2], 16) for i in (1, 3, 5)) + (255,)
                            if 'strokeColor' in child.attrib:
                                color = child.get('strokeColor')
                                if not re.fullmatch(r'#[0-9a-fA-F]{6}', color): raise ValueError(f'{ident}: invalid strokeColor')
                                obj['strokeColor'] = tuple(int(color[i:i+2], 16) for i in (1, 3, 5)) + (255,)
                            if 'shadowColor' in child.attrib or 'shadowOffset' in child.attrib:
                                color = child.get('shadowColor')
                                if not color or not re.fullmatch(r'#[0-9a-fA-F]{6}', color) or 'shadowOffset' not in child.attrib: raise ValueError(f'{ident}: invalid text shadow')
                                try: offset = [float(part) for part in child.get('shadowOffset').split(',')]
                                except ValueError: raise ValueError(f'{ident}: invalid text shadow')
                                if len(offset) != 2 or any(not math.isfinite(v) or abs(v) > 100000 for v in offset): raise ValueError(f'{ident}: invalid text shadow')
                                obj['shadowColor'] = tuple(int(color[i:i+2], 16) for i in (1, 3, 5)) + (255,)
                                obj['shadowOffset'] = offset
                            if child.get('font'): obj['font'] = child.get('font')
                            for key, mapping in [('align', {'left': 0, 'center': 1, 'right': 2}), ('vAlign', {'top': 0, 'middle': 1, 'bottom': 2}), ('autoSize', {'none': 0, 'both': 1, 'height': 2, 'shrink': 3})]:
                                if key in child.attrib:
                                    if child.get(key) not in mapping: raise ValueError(f'{ident}: invalid text {key}')
                                    obj[key] = mapping[child.get(key)]
                            for key in ('leading', 'letterSpacing'):
                                if key in child.attrib:
                                    try: val = int(child.get(key))
                                    except ValueError: raise ValueError(f'{ident}: invalid text {key}')
                                    if not -32768 <= val <= 32767: raise ValueError(f'{ident}: invalid text {key}')
                                    obj[key] = val
                            for key in ('underline', 'italic', 'bold', 'singleLine', 'ubb'):
                                if key in child.attrib:
                                    if child.get(key) not in ('true', 'false'): raise ValueError(f'{ident}: invalid text {key}')
                                    obj[key] = child.get(key) == 'true'
                            if child.tag == 'inputtext':
                                if child.get('input', 'true') != 'true': raise ValueError(f'{ident}: invalid input flag')
                                password = child.get('password', 'false')
                                if password not in ('true', 'false'): raise ValueError(f'{ident}: invalid input password')
                                try: max_length, keyboard = int(child.get('maxLength', '0')), int(child.get('keyboardType', '0'))
                                except ValueError: raise ValueError(f'{ident}: invalid input numeric setting')
                                if not 0 <= max_length <= 2147483647 or not 0 <= keyboard <= 2147483647: raise ValueError(f'{ident}: invalid input numeric setting')
                                obj['input'] = {'prompt': child.get('prompt'), 'restrict': child.get('restrict'), 'maxLength': max_length, 'keyboardType': keyboard, 'password': password == 'true'}
                        for key in ('size', 'scale'):
                            if key not in child.attrib: continue
                            try: vals = [int(v) if key == 'size' else float(v) for v in child.get(key).split(',')]
                            except ValueError: raise ValueError(f'{ident}: invalid child {key}')
                            if len(vals) != 2 or any(not math.isfinite(v) or abs(v) > 100000 for v in vals) or (key == 'size' and any(v < 0 for v in vals)):
                                raise ValueError(f'{ident}: invalid child {key}')
                            obj[key] = vals
                        for key in ('alpha', 'rotation'):
                            if key not in child.attrib: continue
                            try: val = float(child.get(key))
                            except ValueError: raise ValueError(f'{ident}: invalid child {key}')
                            if not math.isfinite(val) or abs(val) > 100000 or (key == 'alpha' and not 0 <= val <= 1): raise ValueError(f'{ident}: invalid child {key}')
                            obj[key] = val
                        for key in ('visible', 'touchable'):
                            if key in child.attrib:
                                if child.get(key) not in ('true', 'false'): raise ValueError(f'{ident}: invalid child {key}')
                                obj[key] = child.get(key) == 'true'
                        children.append(obj)
                    if len({c['id'] for c in children}) != len(children): raise ValueError(f'{ident}: duplicate child id')
                    if extension == 'ScrollBar' and any(sum(child['name'] == required for child in children) != 1 for required in ('bar', 'grip')):
                        raise ValueError(f'{ident}: ScrollBar requires unique bar and grip children')
                    components.append({'id': ident, 'name': Path(item.attrib['name']).stem, 'width': dims[0], 'height': dims[1], 'exported': item.get('exported') == 'true', 'children': children, 'controllers': controllers, 'relations': root_relations, 'transitions': transitions, 'settings': root_settings, 'extension': {'Label': 11, 'Button': 12, 'ComboBox': 13, 'ProgressBar': 14, 'Slider': 15, 'ScrollBar': 16, None: 0}[extension], 'comboDropdown': combo_dropdown, 'buttonMode': {'Common': 0, 'Check': 1, 'Radio': 2}[mode], 'buttonSound': button_sound, 'buttonEffect': {'none': 0, 'dark': 1, 'scale': 2}[button_effect], 'buttonEffectValue': button_effect_value, 'titleType': {'percent': 0, 'valueAndmax': 1, 'value': 2, 'max': 3}[title_type], 'reverse': reverse == 'true', 'pivot': root_pivot, 'margin': margin, 'overflow': {'visible': 0, 'hidden': 1, 'scroll': 2}[overflow], 'scroll': scroll})
                    continue
                if 'texture' in item.attrib: raise ValueError(f'{ident}: unsupported image texture setting')
                with Image.open(resource_path(folder, item)) as source:
                    image = source.convert('RGBA')
                duplicate = item.get('duplicatePadding', 'false')
                if duplicate not in ('true', 'false'): raise ValueError(f'{ident}: invalid duplicatePadding')
                if duplicate == 'true': duplicated.add(ident)
                sources[ident] = image
                data = {'id': ident, 'name': Path(item.attrib['name']).stem, 'width': image.width, 'height': image.height, 'exported': item.get('exported') == 'true'}
                scale = item.get('scale')
                if scale == '9grid':
                    try:
                        grid = [int(v) for v in item.get('scale9grid', '').split(',')]
                    except ValueError:
                        raise ValueError(f'{ident}: invalid scale9grid')
                    # Editor output preserves even rectangles extending beyond
                    # the image (e.g. the official Bag demo's 7.png).
                    if len(grid) != 4 or any(value < 0 or value > 2147483647 for value in grid) or grid[2] == 0 or grid[3] == 0:
                        raise ValueError(f'{ident}: invalid scale9grid')
                    data['scale9grid'] = grid
                elif scale == 'tile' and item.get('scale9grid') is None:
                    data['scaleByTile'] = True
                elif scale not in (None, '') or item.get('scale9grid') is not None:
                    raise ValueError(f'{ident}: unsupported scale setting')
                images.append(data)
            image_ids, movieclip_ids = set(sources), {clip['id'] for clip in movieclips}
            for component in components:
                for child in component['children']:
                    if child.get('pkg'): continue
                    expected_ids = image_ids if child['type'] == 'image' else movieclip_ids if child['type'] == 'movieclip' else None
                    if expected_ids is not None and child['src'] not in expected_ids:
                        raise ValueError(f"{component['name']} ({component['id']}): child {child['id']} references missing {child['type']} resource {child['src']} in package {folder.name}")
            frames = [frame for clip in movieclips for frame in clip['frames']]
            image_map = {image['id']: image for image in images}
            groups = [[frame['id'] for frame in clip['frames']] for clip in movieclips]
            font_images, font_textures = set(), set()
            for font in fonts:
                required = [font['texture']] if font['ttf'] else [glyph['image'] for glyph in font['glyphs']]
                if any(resource not in image_map for resource in required): raise ValueError(f"{font['id']}: font texture or glyph image missing")
                groups.append(required)
                font_images.update(required)
                if font['ttf']:
                    font_textures.add(font['texture'])
                    texture = image_map[font['texture']]
                    if any(glyph['x'] + glyph['width'] > texture['width'] or glyph['y'] + glyph['height'] > texture['height'] for glyph in font['glyphs']):
                        raise ValueError(f"{font['id']}: font glyph outside texture")
            sprite_trim, layout_images = {}, []
            for image in images:
                ident = image['id']
                layout = dict(image)
                if args.get('trim_images', False) and ident not in font_textures and 'scale9grid' not in image and not image.get('scaleByTile'):
                    source = sources[ident]
                    alpha = source.getchannel('A')
                    try: bounds = alpha.getbbox() or (0, 0, 1, 1)
                    finally: alpha.close()
                    if bounds != (0, 0, source.width, source.height):
                        cropped_sources[ident] = source.crop(bounds)
                        layout.update(width=bounds[2] - bounds[0], height=bounds[3] - bounds[1])
                        sprite_trim[ident] = (bounds[0], bounds[1], source.width, source.height)
                layout_images.append(layout)
            width, height, padding = args.get('width', 2048), args.get('height', 2048), args.get('padding', 2)
            rotatable = {image['id'] for image in images if image['id'] not in font_images and 'scale9grid' not in image and not image.get('scaleByTile')} if args.get('rotate_images', False) else set()
            pages = atlas_plan([*layout_images, *frames], width, height, padding, args.get('shrink_atlas', False), args.get('optimize_atlas', False), rotatable)
            frame_pages = {item['id']: index for index, page in enumerate(pages) for item in page['items']}
            if any(len({frame_pages[ident] for ident in group}) > 1 for group in groups):
                pages = plan_grouped([*layout_images, *frames], groups, width, height, padding, args.get('shrink_atlas', False) or args.get('optimize_atlas', False), rotatable)
            if force_square:
                for page in pages:
                    side = max(page['width'], page['height'])
                    if side > min(width, height): raise ValueError('square atlas exceeds configured dimensions')
                    page['width'] = page['height'] = side
            if not paging and len(pages) > 1: raise ValueError('project atlas paging is disabled and resources do not fit on one page')
            if size_option == 'pot' and any(page['width'] & (page['width'] - 1) or page['height'] & (page['height'] - 1) for page in pages):
                raise ValueError('project requires power-of-two atlas dimensions')
            if duplicated and args.get('padding', 2) == 0: raise ValueError('duplicatePadding requires positive atlas padding')
            component_map = {c['id']: c for c in components}
            visiting, visited = set(), set()
            def visit(ident):
                if ident in visiting: raise ValueError('cyclic component references are unsupported')
                if ident in visited: return
                if ident not in component_map: raise ValueError(f'component reference {ident} not found')
                visiting.add(ident)
                for child in component_map[ident]['children']:
                    if child['type'] == 'component' and not child.get('pkg'): visit(child['src'])
                visiting.remove(ident); visited.add(ident)
            for ident in component_map: visit(ident)
            for component in components:
                for child in component['children']:
                    overrides = ('progress', 'label', 'button', 'comboBox')
                    if any(key in child for key in overrides):
                        extension = external_extensions.get((child['pkg'], child['src'])) if child.get('pkg') else component_map[child['src']]['extension']
                        expected = {'progress': child.get('progressKind', 14), 'label': 11, 'button': 12, 'comboBox': 13}
                        for key in overrides:
                            if key in child and extension != expected[key]:
                                raise ValueError(f"{component['id']}: {'ComboBox' if key == 'comboBox' else key} instance references the wrong component type")
            hit_images = {component['settings']['hitTestImage'] for component in components if 'hitTestImage' in component['settings']}
            hit_tests = []
            for image_id in sorted(hit_images):
                if image_id not in sources: raise ValueError(f'pixel hit test image {image_id} not found')
                hit_tests.append({'id': image_id, **make_pixel_mask(sources[image_id])})
            blob = encode_image_package(package_id, folder.name, images, pages, components, sounds, hit_tests, movieclips, fonts, [dependencies[key] for key in sorted(dependencies)], sprite_trim)
            with tempfile.TemporaryDirectory(prefix='.fgui-publish-', dir=output.parent) as temp:
                canvases = render(pages, {**sources, **cropped_sources}, duplicated, args.get('padding', 2))
                try:
                    for index, canvas in enumerate(canvases): canvas.save(Path(temp) / f'{name}_atlas{index}.png', 'PNG')
                finally:
                    for canvas in canvases: canvas.close()
                binary = Path(temp) / (name + '.' + file_extension)
                binary.write_bytes(blob)
                for sound in sounds:
                    shutil.copyfile(sound['source'], Path(temp) / (name + '_' + sound['file']))
                report = validate_atlases(inspect_published(blob), binary, check_overlaps=True)
                if not report['valid']:
                    raise ValueError('generated atlas validation failed: ' + str(report['issues']))
                snapshot.verify()
                if compressed and requested_project.is_dir() and sorted(root.glob('*.fairy')) != descriptors: raise ValueError('project descriptors changed during publication')
                if sorted((root / 'assets').glob('*/package.xml')) != package_files: raise ValueError('project packages changed during publication')
                rename_new_directory(temp, output)
            return {'output': str(output), 'file': str(output / (name + '.' + file_extension)), 'images': len(images), 'components': len(components), 'sounds': len(sounds), 'movieclips': len(movieclips), 'fonts': len(fonts), 'pages': len(pages), 'trimmed_images': len(sprite_trim), 'rotated_images': sum(bool(item.get('rotated')) for page in pages for item in page['items']), 'atlas_options': {'width': width, 'height': height, 'trim_images': args['trim_images'], 'rotate_images': args['rotate_images'], 'paging': paging, 'force_square': force_square, 'size_option': size_option}, 'experimental': True, 'warnings': warnings, 'dependencies': [dependencies[key] for key in sorted(dependencies)]}
        finally:
            for source in cropped_sources.values(): source.close()
            for source in sources.values(): source.close()
    if command in ('inspect_published', 'validate_published'):
        result = inspect_published(Path(args['file']).read_bytes())
        if command == 'validate_published':
            if type(args.get('check_overlaps', False)) is not bool: raise ValueError('check_overlaps must be a boolean')
            report = validate_atlases(result, args['file'], check_overlaps=args.get('check_overlaps', False))
            if args.get('compare_source'):
                from published import compare_source_images
                folder, tree = find_package(root, result['id'])
                selected = select_exported_resources(folder, tree) if args.get('exported_only') else tree.findall('./resources/*')
                sources = {item.get('id'): resource_path(folder, item) for item in selected if item.tag == 'image'}
                report['source_comparison'] = compare_source_images(result, args['file'], sources)
                report['valid'] = report['valid'] and not report['source_comparison']['issues'] and not report['source_comparison']['skipped']
                from published import compare_image_settings
                report['image_settings_comparison'] = compare_image_settings(result, [item for item in selected if item.tag == 'image'])
                report['valid'] = report['valid'] and not report['image_settings_comparison']['issues']
                from published import compare_source_sounds
                sound_sources = {item.get('id'): resource_path(folder, item) for item in selected if item.tag == 'sound'}
                report['sound_comparison'] = compare_source_sounds(result, args['file'], sound_sources)
                report['valid'] = report['valid'] and not report['sound_comparison']['issues']
                from published import compare_source_movieclips
                clip_sources = {item.get('id'): resource_path(folder, item) for item in selected if item.tag == 'movieclip'}
                report['movieclip_comparison'] = compare_source_movieclips(result, args['file'], clip_sources)
                report['valid'] = report['valid'] and not report['movieclip_comparison']['issues']
                from published import compare_source_fonts
                font_sources = {item.get('id'): (resource_path(folder, item), item.get('texture')) for item in selected if item.tag == 'font'}
                report['font_comparison'] = compare_source_fonts(result, font_sources)
                report['valid'] = report['valid'] and not report['font_comparison']['issues']
                from published import compare_source_pixel_hits
                report['pixel_hit_comparison'] = compare_source_pixel_hits(result, sources)
                report['valid'] = report['valid'] and not report['pixel_hit_comparison']['issues'] and not report['pixel_hit_comparison']['skipped']
            if args.get('compare_components'):
                from published import compare_source_components
                folder, tree = find_package(root, result['id'])
                selected = select_exported_resources(folder, tree) if args.get('exported_only') else tree.findall('./resources/*')
                sources = {item.get('id'): resource_path(folder, item) for item in selected if item.tag == 'component'}
                package_aliases = {alias: package.get('id') for package_folder, package in packages(root) for alias in (package_folder.name, package.get('id'))}
                report['component_comparison'] = compare_source_components(result, sources, package_aliases)
                report['valid'] = report['valid'] and not report['component_comparison']['issues'] and not report['component_comparison']['skipped']
            return report
        atlas_ids = {item['id'] for item in result['items'] if item['type'] == 4}
        result['issues'] = [f"sprite {s['id']}: unknown atlas {s['atlas']}" for s in result['sprites'] if s['atlas'] not in atlas_ids]
        return result
    if command in ('atlas_layout', 'atlas_export'):
        try:
            from PIL import Image
        except ImportError as exc:
            raise ValueError('atlas_layout requires Pillow') from exc
        folder, tree = find_package(root, args['pkg'])
        if type(args.get('rotate_images', False)) is not bool: raise ValueError('rotate_images must be a boolean')
        snapshot = PublishSnapshot()
        tree = snapshot.read_package(folder, track_dependencies=False)
        if args['pkg'] not in (folder.name, tree.get('id')): raise ValueError('package identity changed during atlas generation')
        image_items = tree.findall('./resources/image')
        for item in image_items:
            snapshot.track(resource_path(folder, item))
        images, sources = [], {}
        try:
            for item in image_items:
                with Image.open(resource_path(folder, item)) as image:
                    images.append({'id': item.attrib['id'], 'width': image.width, 'height': image.height})
                    if command == 'atlas_export':
                        sources[item.attrib['id']] = image.convert('RGBA')
            rotatable = {image['id'] for image in images} if args.get('rotate_images', False) else set()
            pages = atlas_plan(images, args.get('width', 2048), args.get('height', 2048), args.get('padding', 2), args.get('shrink_atlas', False), args.get('optimize_atlas', False), rotatable)
            if command == 'atlas_layout':
                snapshot.verify()
                return {'pages': pages, 'image_count': len(images), 'scope': 'layout only; optional rotation; no trimming, image export or FairyGUI package descriptor'}
            output = Path(args['output']).absolute()
            if output.exists():
                raise ValueError('output directory must not already exist')
            if not output.parent.is_dir():
                raise ValueError('output parent directory must already exist')
            with tempfile.TemporaryDirectory(prefix='.fgui-atlas-', dir=output.parent) as staging:
                canvases = render(pages, sources)
                try:
                    for index, canvas in enumerate(canvases):
                        filename = f'atlas_{index}.png'
                        canvas.save(Path(staging) / filename, format='PNG')
                        pages[index]['file'] = filename
                finally:
                    for canvas in canvases: canvas.close()
                manifest = {'pages': pages, 'image_count': len(images), 'package': folder.name, 'format': 'fgui-agent-atlas-layout-v1'}
                (Path(staging) / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
                snapshot.verify()
                rename_new_directory(staging, output)
            return {'output': str(output), **manifest, 'scope': 'atlas images and layout only; not a FairyGUI published package'}
        finally:
            for source in sources.values(): source.close()
    if command in ('remove_relation', 'remove_gear'):
        current = _execute('read_component', args)
        if args.get('expected_sha256') != current['sha256']: raise ValueError('expected_sha256 must match current file')
        if command == 'remove_relation':
            data = remove_child_behavior(Path(current['path']).read_bytes(), args['target'], 'relation', args['related_to'])
        else:
            kinds = {'display': 'gearDisplay', 'display2': 'gearDisplay2', 'text': 'gearText', 'color': 'gearColor', 'position': 'gearXY', 'size': 'gearSize', 'look': 'gearLook', 'font_size': 'gearFontSize', 'animation': 'gearAni', 'icon': 'gearIcon'}
            if args.get('gear') not in kinds: raise ValueError('unsupported gear type')
            data = remove_child_behavior(Path(current['path']).read_bytes(), args['target'], kinds[args['gear']])
        return _execute('write_component', {**args, 'xml': data.decode('utf-8')})
    if command == 'set_relation':
        current = _execute('read_component', args)
        if args.get('expected_sha256') != current['sha256']: raise ValueError('expected_sha256 must match current file')
        data = set_child_relation(Path(current['path']).read_bytes(), args['target'], args['related_to'], args['side_pairs'])
        return _execute('write_component', {**args, 'xml': data.decode('utf-8')})
    if command in ('set_display_gear', 'set_display2_gear', 'set_text_gear', 'set_color_gear', 'set_position_gear', 'set_size_gear', 'set_look_gear', 'set_font_size_gear', 'set_animation_gear', 'set_icon_gear'):
        current = _execute('read_component', args)
        if args.get('expected_sha256') != current['sha256']: raise ValueError('expected_sha256 must match current file')
        kind = {'set_display_gear': 'gearDisplay', 'set_display2_gear': 'gearDisplay2', 'set_text_gear': 'gearText', 'set_color_gear': 'gearColor', 'set_position_gear': 'gearXY', 'set_size_gear': 'gearSize', 'set_look_gear': 'gearLook', 'set_font_size_gear': 'gearFontSize', 'set_animation_gear': 'gearAni', 'set_icon_gear': 'gearIcon'}[command]
        data = set_child_gear(Path(current['path']).read_bytes(), args['target'], args['controller'], args['pages'], kind, args.get('values'), args.get('default'), root, args['pkg'], args.get('tween'), args.get('condition'))
        return _execute('write_component', {**args, 'xml': data.decode('utf-8')})
    if command in ('create_controller', 'set_controller_pages'):
        current = _execute('read_component', args)
        if args.get('expected_sha256') != current['sha256']: raise ValueError('expected_sha256 must match current file')
        data = edit_controller_pages(Path(current['path']).read_bytes(), args['controller'], args['pages'], args.get('selected'), command == 'create_controller')
        return _execute('write_component', {**args, 'xml': data.decode('utf-8')})
    if command == 'insert_resource':
        current = _execute('read_component', args)
        if args.get('expected_sha256') != current['sha256']:
            raise ValueError('expected_sha256 must match current file')
        target_folder, target_package = find_package(root, args['pkg'])
        source_folder, source_package = find_package(root, args.get('ref_pkg') or args['pkg'])
        resource_name = args['ref_name']
        if not isinstance(resource_name, str) or not resource_name: raise ValueError('ref_name must be a nonempty string')
        matches = [item for item in source_package.findall('./resources/*') if resource_name in (item.get('id'), item.get('name'), Path(item.get('name', '')).stem)]
        if len(matches) != 1: raise ValueError('resource not found or ambiguous')
        resource = matches[0]
        if not resource.get('id'): raise ValueError('resource has no ID')
        tag = {'image': 'image', 'component': 'component', 'movieclip': 'jta'}.get(resource.tag)
        if not tag: raise ValueError('resource type cannot be inserted as a display object')
        if not resource_path(source_folder, resource).is_file(): raise ValueError('object resource file is missing')
        name = args.get('object_name', Path(resource.get('name', '')).stem)
        if not isinstance(name, str) or not name: raise ValueError('object_name must be a nonempty string')
        x, y = args.get('x', 0), args.get('y', 0)
        if any(type(value) is not int or not -2147483648 <= value <= 2147483647 for value in (x, y)):
            raise ValueError('x and y must be Int32 integers')
        component = parse_xml(current['xml'].encode('utf-8'), 'component')
        ids = {child.get('id') for child in component.findall('./displayList/*')}
        ident = 'n' + secrets.token_hex(3)
        while ident in ids: ident = 'n' + secrets.token_hex(3)
        attrs = {'id': ident, 'name': name, 'src': resource.get('id'), 'xy': f'{x},{y}'}
        if source_folder != target_folder:
            if not source_package.get('id'): raise ValueError('resource package has no ID')
            attrs['pkg'] = source_package.get('id')
        fragment = '<' + tag + ''.join(' ' + key + '=' + quoteattr(value) for key, value in attrs.items()) + '/>'
        result = _execute('insert_object', {**args, 'object_xml': fragment})
        return {**result, 'id': ident, 'type': tag, 'source_id': resource.get('id'), 'source_package': source_package.get('id')}
    if command in ('set_properties', 'set_properties_batch', 'set_component_properties', 'set_button_options', 'set_button_instance_options', 'set_label_instance_options', 'insert_object', 'move_object', 'remove_object'):
        current = _execute('read_component', args)
        if args.get('expected_sha256') != current['sha256']:
            raise ValueError('expected_sha256 must match current file')
        original = Path(current['path']).read_bytes()
        if command == 'insert_object':
            fragment = args['object_xml']
            node = parse_xml(fragment.encode('utf-8'), 'object_xml')
            # Validate common geometry and visibility before inserting raw XML.
            # Other object-specific attributes remain outside this subset.
            common = {key: node.attrib[key] for key in ('xy', 'size', 'scale', 'pivot', 'anchor', 'rotation', 'alpha', 'visible', 'touchable', 'grayed') if key in node.attrib}
            if common: validate_child_properties(common)
            if 'anchor' in common and 'pivot' not in common: raise ValueError('anchor requires a pivot')
            if node.get('src'):
                folder, package = find_package(root, node.get('pkg') or args['pkg'])
                matches = [item for item in package.findall('./resources/*') if item.get('id') == node.get('src')]
                if len(matches) != 1:
                    raise ValueError('object resource reference not found')
                expected = {'image': 'image', 'component': 'component', 'movieclip': 'movieclip', 'jta': 'movieclip'}.get(node.tag)
                if expected and matches[0].tag != expected:
                    raise ValueError(f'{node.tag} object requires resource type {expected}')
                if not resource_path(folder, matches[0]).is_file():
                    raise ValueError('object resource file is missing')
            data = insert_child(original, fragment, args.get('index'))
        elif command == 'move_object':
            data = move_child(original, args['target'], args['index'])
        elif command == 'remove_object':
            data = remove_child(original, args['target'])
        elif command == 'set_properties_batch':
            data = edit_children_batch(original, args.get('changes'))
        elif command == 'set_component_properties':
            data = edit_component_properties(original, args.get('props'))
        elif command in ('set_button_instance_options', 'set_label_instance_options'):
            extension = 'Button' if command == 'set_button_instance_options' else 'Label'
            data = edit_extension_instance(original, args['target'], args.get('props'), root, args['pkg'], extension)
        elif command == 'set_button_options':
            props = args.get('props')
            data = edit_button_options(original, props)
            sound = props.get('sound')
            if sound:
                address = sound[5:]
                if '/' in address:
                    owner, resource_name = address.split('/', 1)
                    sound_folder, sound_package = find_package(root, owner)
                    if sound_folder.name != owner: raise ValueError('Button sound URL requires a package name')
                    matches = [item for item in sound_package.findall('./resources/sound') if Path(item.get('name', '')).stem == resource_name]
                else:
                    sound_folder, sound_package = find_package(root, address[:8])
                    if sound_package.get('id') != address[:8]: raise ValueError('Button sound URL requires a package ID')
                    matches = [item for item in sound_package.findall('./resources/sound') if item.get('id') == address[8:]]
                if len(matches) != 1 or not resource_path(sound_folder, matches[0]).is_file(): raise ValueError('Button sound resource not found or ambiguous')
        else:
            data = edit_child_attributes(original, args['target'], args['props'])
        return _execute('write_component', {**args, 'xml': data.decode('utf-8')})
    if command == 'lint':
        script = Path(__file__).resolve().parent.parent / 'scripts' / 'lint_components.mjs'
        try:
            result = subprocess.run(['node', str(script), str(root)], capture_output=True,
                                    encoding='utf-8', errors='replace', timeout=120)
        except subprocess.TimeoutExpired as exc:
            raise ValueError('lint timed out after 120 seconds') from exc
        if result.returncode not in (0, 1):
            raise ValueError(f'lint failed ({result.returncode}): {result.stderr or result.stdout}')
        return {'valid': result.returncode == 0, 'report': result.stdout, 'stderr': result.stderr}
    if command == 'project_info':
        files = sorted(root.glob('*.fairy'))
        return {'root': str(root), 'projects': [{'file': str(f), 'attributes': parse_xml(f.read_bytes(), str(f)).attrib} for f in files], 'package_count': len(packages(root))}
    if command == 'list_packages':
        return [{'name': p.name, 'id': x.get('id'), 'path': str(p)} for p, x in packages(root)]
    if command == 'list_items':
        folder, tree = find_package(root, args['pkg'])
        return [{'type': x.tag, **x.attrib} for x in tree.findall('./resources/*')]
    if command == 'list_controllers':
        current = _execute('read_component', args)
        root = parse_xml(current['xml'].encode('utf-8'), 'component')
        controllers = []
        for controller in root.findall('controller'):
            parts = controller.get('pages', '').split(',') if controller.get('pages') else []
            if len(parts) % 2: raise ValueError('invalid controller pages')
            try: selected = int(controller.get('selected', '0'))
            except ValueError: raise ValueError('invalid controller selected index')
            controllers.append({'name': controller.get('name'), 'pages': [{'id': ident, 'name': name} for ident, name in zip(parts[::2], parts[1::2])], 'selected': selected,
                                'actions': [{'type': action.get('type'), 'attributes': dict(action.attrib)} for action in controller.findall('action')]})
        return {'path': current['path'], 'sha256': current['sha256'], 'controllers': controllers}
    if command == 'list_children':
        current = _execute('read_component', args)
        node = parse_xml(current['xml'].encode('utf-8'), 'component')
        return {'path': current['path'], 'sha256': current['sha256'], 'children': [{'type': child.tag, 'id': child.get('id'), 'name': child.get('name'), 'attributes': dict(child.attrib), 'behaviors': [{'type': behavior.tag, 'attributes': dict(behavior.attrib)} for behavior in child if behavior.tag == 'relation' or behavior.tag.startswith('gear')]} for child in node.findall('./displayList/*')]}
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
        folder, _ = find_package(root, args['pkg'])
        all_packages = packages(root)
        resource_index = project_resource_index(all_packages)
        url_index = project_url_index(all_packages)
        previous = Counter(component_reference_issues(parse_xml(old, 'component'), resource_index, folder.name, url_index))
        updated = Counter(component_reference_issues(parse_xml(data, 'component'), resource_index, folder.name, url_index))
        introduced = list((updated - previous).elements())
        if introduced:
            raise ValueError('new invalid component reference: ' + '; '.join(introduced))
        # Same-directory replace prevents partially written XML after a crash.
        fd, temp = tempfile.mkstemp(prefix='.fgui-', suffix='.tmp', dir=f.parent)
        try:
            with os.fdopen(fd, 'wb') as out:
                out.write(data)
                out.flush()
                os.fsync(out.fileno())
            atomic_replace_checked(temp, f, digest)
        finally:
            if os.path.exists(temp):
                os.unlink(temp)
        return {'path': str(f), 'sha256': hashlib.sha256(data).hexdigest()}
    if command == 'validate':
        try:
            from PIL import Image
        except ImportError as exc:
            raise ValueError('project validation requires Pillow') from exc
        check_media = args.get('check_media', False)
        if type(check_media) is not bool: raise ValueError('check_media must be a boolean')
        issues, warnings = [], []
        media_checked = {'sound': 0, 'movieclip': 0, 'font': 0}
        ids = set()
        for descriptor in sorted(root.glob('*.fairy')):
            try:
                if parse_xml(descriptor.read_bytes(), str(descriptor)).tag != 'projectDescription':
                    raise ValueError('expected projectDescription root')
            except (ValueError, OSError) as exc:
                issues.append({'path': str(descriptor), 'error': str(exc)})
        all_packages = []
        for package_file in sorted((root / 'assets').glob('*/package.xml')):
            try:
                tree = parse_xml(package_file.read_bytes(), str(package_file))
                if tree.tag != 'packageDescription': raise ValueError('expected packageDescription root')
                all_packages.append((package_file.parent, tree))
            except (ValueError, OSError) as exc:
                issues.append({'path': str(package_file), 'error': str(exc)})
        resource_index = project_resource_index(all_packages)
        url_index = project_url_index(all_packages)
        for folder, tree in all_packages:
            pid = tree.get('id')
            if not pid or pid in ids:
                issues.append({'path': str(folder / 'package.xml'), 'error': 'missing or duplicate package id'})
            ids.add(pid)
            if len(tree.findall('resources')) != 1:
                issues.append({'path': str(folder / 'package.xml'), 'error': 'package must have exactly one resources element'})
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
                    if item.tag == 'image' and f.suffix.lower() in ('.png', '.jpg', '.jpeg'):
                        try:
                            with Image.open(f) as image:
                                expected_format = 'PNG' if f.suffix.lower() == '.png' else 'JPEG'
                                if image.format != expected_format:
                                    warnings.append({'package': folder.name, 'resource': item.get('name'), 'warning': f'image content format {image.format} does not match {f.suffix}'})
                                image.load()
                        except (OSError, SyntaxError, Image.DecompressionBombError) as exc:
                            raise ValueError('invalid image data: ' + str(exc)) from exc
                    if item.tag == 'component':
                        data = f.read_bytes()
                        validate_component(data)
                        component = parse_xml(data, str(f))
                        issues.extend({'package': folder.name, 'resource': item.get('name'), 'error': error} for error in component_reference_issues(component, resource_index, folder.name, url_index))
                    elif check_media and item.tag == 'sound':
                        from sound import inspect_sound
                        inspect_sound(f.read_bytes(), f.suffix)
                        media_checked['sound'] += 1
                    elif check_media and item.tag == 'movieclip':
                        if f.suffix.lower() != '.jta': raise ValueError('unsupported movieclip format for media check')
                        clip = read_jta(f.read_bytes())
                        for image in clip['images']: image.close()
                        media_checked['movieclip'] += 1
                    elif check_media and item.tag == 'font':
                        if f.suffix.lower() != '.fnt': raise ValueError('unsupported font format for media check')
                        font = read_bitmap_font(f.read_bytes(), item.get('texture'))
                        required = [font['texture']] if font['ttf'] else [glyph['image'] for glyph in font['glyphs']]
                        image_items = {}
                        for ident in set(required):
                            matches = [resource for resource in tree.findall('./resources/image') if resource.get('id') == ident]
                            if len(matches) != 1: raise ValueError(f'font image {ident!r} is missing or ambiguous')
                            image_file = resource_path(folder, matches[0])
                            with Image.open(image_file) as texture: image_items[ident] = texture.size
                        if font['ttf']:
                            width, height = image_items[font['texture']]
                            if any(glyph['x'] + glyph['width'] > width or glyph['y'] + glyph['height'] > height for glyph in font['glyphs']):
                                raise ValueError('font glyph rectangle exceeds texture dimensions')
                        media_checked['font'] += 1
                except (ValueError, OSError, Image.DecompressionBombError) as exc:
                    issues.append({'package': folder.name, 'resource': item.get('name'), 'error': str(exc)})
        return {'valid': not issues, 'issues': issues, 'warnings': warnings, 'media_checked': media_checked if check_media else None, 'scope': 'project and package XML structure, IDs, registered files, PNG/JPEG decoding and selected component references' + ('; supported sound, JTA and bitmap font structures' if check_media else '') + '; not runtime or publish compatibility'}
    raise ValueError('unknown command: ' + command)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['project_info', 'list_packages', 'list_items', 'find_references', 'unregister_resource', 'read_package', 'set_image_options', 'read_component', 'list_children', 'list_controllers', 'write_component', 'create_package', 'create_component', 'import_image', 'import_sound', 'import_movieclip', 'import_font', 'set_properties', 'set_properties_batch', 'set_component_properties', 'set_button_options', 'set_button_instance_options', 'set_label_instance_options', 'insert_object', 'insert_resource', 'move_object', 'create_controller', 'set_controller_pages', 'set_display_gear', 'set_display2_gear', 'set_text_gear', 'set_color_gear', 'set_position_gear', 'set_size_gear', 'set_look_gear', 'set_font_size_gear', 'set_animation_gear', 'set_icon_gear', 'set_relation', 'remove_relation', 'remove_gear', 'remove_object', 'validate', 'lint', 'atlas_layout', 'atlas_export', 'inspect_published', 'validate_published', 'publish_images_experimental', 'publish_simple_experimental', 'publish_project_experimental', 'preflight_publish'])
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
