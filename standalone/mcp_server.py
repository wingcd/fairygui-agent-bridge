#!/usr/bin/env python3
"""Offline MCP server over stdio, using the same operations as fgui.py."""
import json
import math
import sys
import traceback
from fgui import execute

PROJECT = {'type': 'string', 'description': 'Absolute project directory or .fairy file'}
PKG = {'type': 'string', 'description': 'Package name or id'}
NAME = {'type': 'string', 'description': 'Component name, filename or id'}
NUMBER_OR_STRING = {'anyOf': [{'type': 'number'}, {'type': 'string'}]}
BOOL_OR_STRING = {'anyOf': [{'type': 'boolean'}, {'type': 'string', 'enum': ['true', 'false']}]}
CHILD_PROPERTIES = {'type': 'object', 'minProperties': 1, 'additionalProperties': False, 'properties': {
    **{key: {'type': 'string'} for key in ('name', 'xy', 'size', 'scale', 'pivot', 'text', 'color', 'font')},
    **{key: NUMBER_OR_STRING for key in ('rotation', 'alpha', 'fontSize', 'leading', 'letterSpacing')},
    **{key: BOOL_OR_STRING for key in ('anchor', 'visible', 'touchable', 'grayed', 'bold', 'italic', 'underline', 'singleLine', 'ubb')},
    'align': {'type': 'string', 'enum': ['left', 'center', 'right']},
    'vAlign': {'type': 'string', 'enum': ['top', 'middle', 'bottom']},
    'autoSize': {'type': 'string', 'enum': ['none', 'both', 'height', 'shrink']},
}}
COMPONENT_PROPERTIES = {'type': 'object', 'minProperties': 1, 'additionalProperties': False, 'properties': {
    'size': {'type': 'string', 'description': 'width,height in positive integer pixels'},
    'pivot': {'type': 'string', 'description': 'x,y as finite numbers'},
    'margin': {'type': 'string', 'description': 'four comma-separated nonnegative integers'},
    'opaque': {'type': 'boolean'}, 'overflow': {'type': 'string', 'enum': ['visible', 'hidden', 'scroll']},
}}
BUTTON_OPTIONS = {'type': 'object', 'minProperties': 1, 'additionalProperties': False, 'properties': {
    'mode': {'type': 'string', 'enum': ['Common', 'Check', 'Radio']},
    'sound': {'type': 'string', 'description': 'registered sound UI URL; empty clears the sound'},
    'downEffect': {'type': 'string', 'enum': ['none', 'dark', 'scale']},
    'downEffectValue': {'type': 'number', 'minimum': 0, 'maximum': 10},
}}
BUTTON_INSTANCE_OPTIONS = {'type': 'object', 'minProperties': 1, 'additionalProperties': False, 'properties': {
    **{key: {'type': 'string'} for key in ('title', 'selectedTitle', 'icon', 'selectedIcon', 'titleColor')},
    'titleFontSize': {'type': 'integer', 'minimum': 0, 'maximum': 2147483647},
    'checked': {'type': 'boolean'},
}}
LABEL_INSTANCE_OPTIONS = {'type': 'object', 'minProperties': 1, 'additionalProperties': False, 'properties': {
    **{key: {'type': 'string'} for key in ('title', 'icon', 'titleColor')},
    'titleFontSize': {'type': 'integer', 'minimum': 0, 'maximum': 2147483647},
}}
GEAR_TWEEN = {'type': 'object', 'additionalProperties': False, 'required': ['enabled'], 'properties': {
    'enabled': {'type': 'boolean'},
    'ease': {'type': 'string', 'enum': ['Linear'] + [f'{family}.{mode}' for family in ('Sine', 'Quad', 'Cubic', 'Quart', 'Quint', 'Expo', 'Circ', 'Elastic', 'Back', 'Bounce') for mode in ('In', 'Out', 'InOut')]},
    'duration': {'type': 'number', 'minimum': 0, 'maximum': 100000},
    'delay': {'type': 'number', 'minimum': 0, 'maximum': 100000},
}}
IMAGE_OPTIONS = {'type': 'object', 'minProperties': 1, 'additionalProperties': False, 'properties': {
    'scale': {'type': 'string', 'enum': ['none', '9grid', 'tile']},
    'scale9grid': {'type': 'string', 'description': 'x,y,width,height in pixels'},
    'duplicatePadding': {'type': 'boolean'}, 'exported': {'type': 'boolean'},
}}


def validate_unicode(value):
    """Reject unpaired surrogate escapes before they reach paths or output."""
    pending = [value]
    while pending:
        current = pending.pop()
        if isinstance(current, str): current.encode('utf-8', 'strict')
        elif isinstance(current, list): pending.extend(current)
        elif isinstance(current, dict):
            pending.extend(current.keys())
            pending.extend(current.values())


SPECS = {
    'project_info': ('Read project metadata', {}, []),
    'list_packages': ('List packages', {}, []),
    'list_items': ('List registered package resources', {'pkg': PKG}, ['pkg']),
    'find_references': ('Find selected static component and bitmap font references to a registered resource; reports incomplete scans', {'pkg': PKG, 'item': {'type': 'string', 'description': 'resource ID, filename or unique stem'}}, ['pkg', 'item']),
    'unregister_resource': ('Remove an unreferenced resource registration after a static scan; preserves the source file; requires package SHA-256', {'pkg': PKG, 'item': {'type': 'string', 'description': 'resource ID, filename or unique stem'}, 'expected_sha256': {'type': 'string'}}, ['pkg', 'item', 'expected_sha256']),
    'read_package': ('Read package XML and its SHA-256', {'pkg': PKG}, ['pkg']),
    'set_image_options': ('Set image scale, nine-slice, padding or exported flag; requires package SHA-256', {'pkg': PKG, 'item': {'type': 'string'}, 'props': IMAGE_OPTIONS, 'expected_sha256': {'type': 'string'}}, ['pkg', 'item', 'props', 'expected_sha256']),
    'read_component': ('Read component XML and its SHA-256 for optimistic concurrency', {'pkg': PKG, 'name': NAME}, ['pkg', 'name']),
    'list_controllers': ('List controllers, pages and actions with the component SHA-256', {'pkg': PKG, 'name': NAME}, ['pkg', 'name']),
    'list_children': ('List display-list children and component SHA-256', {'pkg': PKG, 'name': NAME}, ['pkg', 'name']),
    'write_component': ('Replace an existing component after structural and selected reference validation and SHA-256 comparison', {'pkg': PKG, 'name': NAME, 'xml': {'type': 'string'}, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'xml', 'expected_sha256']),
    'create_package': ('Create a new empty package in the project', {'name': {'type': 'string'}}, ['name']),
    'create_component': ('Create and register an empty component or supported extension in a package directory; extension children and resources must be configured separately', {'pkg': PKG, 'name': NAME, 'path': {'type': 'string'}, 'width': {'type': 'integer', 'minimum': 1}, 'height': {'type': 'integer', 'minimum': 1}, 'exported': {'type': 'boolean'}, 'extention': {'type': 'string', 'enum': ['Label', 'Button', 'ComboBox', 'ProgressBar', 'Slider', 'ScrollBar']}}, ['pkg', 'name', 'width', 'height']),
    'import_image': ('Import a PNG or JPEG into a package directory and register it', {'pkg': PKG, 'source': {'type': 'string'}, 'name': {'type': 'string'}, 'path': {'type': 'string'}, 'exported': {'type': 'boolean'}}, ['pkg', 'source']),
    'import_sound': ('Import PCM WAV, framed MP3 or Ogg Vorbis sound; MP3 and Ogg checks validate container structure but do not decode audio', {'pkg': PKG, 'source': {'type': 'string'}, 'name': {'type': 'string'}, 'path': {'type': 'string'}, 'exported': {'type': 'boolean'}}, ['pkg', 'source']),
    'import_movieclip': ('Import and register a supported FairyGUI JTA v102 movieclip', {'pkg': PKG, 'source': {'type': 'string'}, 'name': {'type': 'string'}, 'path': {'type': 'string'}, 'exported': {'type': 'boolean'}}, ['pkg', 'source']),
    'import_font': ('Import a supported bitmap font; supply texture image ID/name for BMFont or register each image glyph first', {'pkg': PKG, 'source': {'type': 'string'}, 'name': {'type': 'string'}, 'path': {'type': 'string'}, 'texture': {'type': 'string'}, 'exported': {'type': 'boolean'}}, ['pkg', 'source']),
    'set_properties': ('Edit supported attributes of a display-list child by id or unique name; read component first for SHA-256', {'pkg': PKG, 'name': NAME, 'target': {'type': 'string'}, 'props': CHILD_PROPERTIES, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'target', 'props', 'expected_sha256']),
    'set_component_properties': ('Edit component root size, pivot, opaque, overflow or margin; requires current component SHA-256', {'pkg': PKG, 'name': NAME, 'props': COMPONENT_PROPERTIES, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'props', 'expected_sha256']),
    'set_button_options': ('Edit Button component mode, sound and down effect; requires current component SHA-256', {'pkg': PKG, 'name': NAME, 'props': BUTTON_OPTIONS, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'props', 'expected_sha256']),
    'set_button_instance_options': ('Edit a Button child instance title, selected title, icons, title color, font size or checked state; requires component SHA-256', {'pkg': PKG, 'name': NAME, 'target': {'type': 'string'}, 'props': BUTTON_INSTANCE_OPTIONS, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'target', 'props', 'expected_sha256']),
    'set_label_instance_options': ('Edit a Label child instance title, icon, title color or font size; requires component SHA-256', {'pkg': PKG, 'name': NAME, 'target': {'type': 'string'}, 'props': LABEL_INSTANCE_OPTIONS, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'target', 'props', 'expected_sha256']),
    'set_properties_batch': ('Atomically edit multiple display-list children; requires the current SHA-256', {'pkg': PKG, 'name': NAME, 'changes': {'type': 'array', 'minItems': 1, 'maxItems': 1000, 'items': {'type': 'object', 'properties': {'target': {'type': 'string'}, 'props': CHILD_PROPERTIES}, 'required': ['target', 'props'], 'additionalProperties': False}}, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'changes', 'expected_sha256']),
    'create_controller': ('Create a controller with pages; requires component SHA-256', {'pkg': PKG, 'name': NAME, 'controller': {'type': 'string'}, 'pages': {'type': 'array', 'maxItems': 256, 'items': {'type': 'object', 'properties': {'id': {'type': 'string'}, 'name': {'type': 'string'}}, 'required': ['id', 'name'], 'additionalProperties': False}}, 'selected': {'type': 'integer', 'minimum': 0}, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'controller', 'pages', 'expected_sha256']),
    'set_controller_pages': ('Replace controller pages while checking references; requires component SHA-256', {'pkg': PKG, 'name': NAME, 'controller': {'type': 'string'}, 'pages': {'type': 'array', 'maxItems': 256, 'items': {'type': 'object', 'properties': {'id': {'type': 'string'}, 'name': {'type': 'string'}}, 'required': ['id', 'name'], 'additionalProperties': False}}, 'selected': {'type': 'integer', 'minimum': 0}, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'controller', 'pages', 'expected_sha256']),
    'set_text_gear': ('Create or replace a text gear; requires component SHA-256', {'pkg': PKG, 'name': NAME, 'target': {'type': 'string'}, 'controller': {'type': 'string'}, 'pages': {'type': 'array', 'minItems': 1, 'maxItems': 32767, 'items': {'type': 'string'}}, 'values': {'type': 'array', 'minItems': 1, 'maxItems': 32767, 'items': {'type': 'string'}}, 'default': {'type': 'string'}, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'target', 'controller', 'pages', 'values', 'expected_sha256']),
    'set_color_gear': ('Create or replace a color gear on a color-capable child; colors are #RRGGBB, optional comma-separated outline, or - for an unset page; requires component SHA-256', {'pkg': PKG, 'name': NAME, 'target': {'type': 'string'}, 'controller': {'type': 'string'}, 'pages': {'type': 'array', 'minItems': 1, 'maxItems': 32767, 'items': {'type': 'string'}}, 'values': {'type': 'array', 'minItems': 1, 'maxItems': 32767, 'items': {'type': 'string'}}, 'default': {'type': 'string'}, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'target', 'controller', 'pages', 'values', 'expected_sha256']),
    'set_position_gear': ('Set per-page x,y positions or -; optionally configure tween; requires component SHA-256', {'pkg': PKG, 'name': NAME, 'target': {'type': 'string'}, 'controller': {'type': 'string'}, 'pages': {'type': 'array', 'minItems': 1, 'maxItems': 32767, 'items': {'type': 'string'}}, 'values': {'type': 'array', 'minItems': 1, 'maxItems': 32767, 'items': {'type': 'string'}}, 'default': {'type': 'string'}, 'tween': GEAR_TWEEN, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'target', 'controller', 'pages', 'values', 'expected_sha256']),
    'set_size_gear': ('Set per-page width,height[,scaleX,scaleY] or -; optionally configure tween; requires component SHA-256', {'pkg': PKG, 'name': NAME, 'target': {'type': 'string'}, 'controller': {'type': 'string'}, 'pages': {'type': 'array', 'minItems': 1, 'maxItems': 32767, 'items': {'type': 'string'}}, 'values': {'type': 'array', 'minItems': 1, 'maxItems': 32767, 'items': {'type': 'string'}}, 'default': {'type': 'string'}, 'tween': GEAR_TWEEN, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'target', 'controller', 'pages', 'values', 'expected_sha256']),
    'set_look_gear': ('Set per-page alpha,rotation,grayed[,touchable] or -; optionally configure tween; requires component SHA-256', {'pkg': PKG, 'name': NAME, 'target': {'type': 'string'}, 'controller': {'type': 'string'}, 'pages': {'type': 'array', 'minItems': 1, 'maxItems': 32767, 'items': {'type': 'string'}}, 'values': {'type': 'array', 'minItems': 1, 'maxItems': 32767, 'items': {'type': 'string'}}, 'default': {'type': 'string'}, 'tween': GEAR_TWEEN, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'target', 'controller', 'pages', 'values', 'expected_sha256']),
    'set_font_size_gear': ('Set per-page font sizes as nonnegative integer strings or - on a text object; requires component SHA-256', {'pkg': PKG, 'name': NAME, 'target': {'type': 'string'}, 'controller': {'type': 'string'}, 'pages': {'type': 'array', 'minItems': 1, 'maxItems': 32767, 'items': {'type': 'string'}}, 'values': {'type': 'array', 'minItems': 1, 'maxItems': 32767, 'items': {'type': 'string'}}, 'default': {'type': 'string'}, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'target', 'controller', 'pages', 'values', 'expected_sha256']),
    'set_animation_gear': ('Set per-page frame,p (playing), frame,s (stopped) or - on a movieclip or loader; requires component SHA-256', {'pkg': PKG, 'name': NAME, 'target': {'type': 'string'}, 'controller': {'type': 'string'}, 'pages': {'type': 'array', 'minItems': 1, 'maxItems': 32767, 'items': {'type': 'string'}}, 'values': {'type': 'array', 'minItems': 1, 'maxItems': 32767, 'items': {'type': 'string'}}, 'default': {'type': 'string'}, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'target', 'controller', 'pages', 'values', 'expected_sha256']),
    'set_icon_gear': ('Set per-page icon or loader URLs without pipes or commas; ui:// resources must exist; requires component SHA-256', {'pkg': PKG, 'name': NAME, 'target': {'type': 'string'}, 'controller': {'type': 'string'}, 'pages': {'type': 'array', 'minItems': 1, 'maxItems': 32767, 'items': {'type': 'string'}}, 'values': {'type': 'array', 'minItems': 1, 'maxItems': 32767, 'items': {'type': 'string'}}, 'default': {'type': 'string'}, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'target', 'controller', 'pages', 'values', 'expected_sha256']),
    'remove_relation': ('Remove a child relation to a parent or sibling; requires component SHA-256', {'pkg': PKG, 'name': NAME, 'target': {'type': 'string'}, 'related_to': {'type': 'string'}, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'target', 'related_to', 'expected_sha256']),
    'remove_gear': ('Remove a child display, display2, text, icon, color, position, size, look, font size or animation gear; requires component SHA-256', {'pkg': PKG, 'name': NAME, 'target': {'type': 'string'}, 'gear': {'type': 'string', 'enum': ['display', 'display2', 'text', 'icon', 'color', 'position', 'size', 'look', 'font_size', 'animation']}, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'target', 'gear', 'expected_sha256']),
    'set_relation': ('Create or replace a child relation to a sibling or parent; requires component SHA-256', {'pkg': PKG, 'name': NAME, 'target': {'type': 'string'}, 'related_to': {'type': 'string'}, 'side_pairs': {'type': 'array', 'minItems': 1, 'maxItems': 255, 'items': {'type': 'string'}}, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'target', 'related_to', 'side_pairs', 'expected_sha256']),
    'set_display_gear': ('Create or replace a child visibility gear; requires component SHA-256', {'pkg': PKG, 'name': NAME, 'target': {'type': 'string'}, 'controller': {'type': 'string'}, 'pages': {'type': 'array', 'maxItems': 32767, 'items': {'type': 'string'}}, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'target', 'controller', 'pages', 'expected_sha256']),
    'set_display2_gear': ('Set a secondary visibility gear and its AND (0) or OR (1) condition; requires component SHA-256', {'pkg': PKG, 'name': NAME, 'target': {'type': 'string'}, 'controller': {'type': 'string'}, 'pages': {'type': 'array', 'maxItems': 32767, 'items': {'type': 'string'}}, 'condition': {'type': 'integer', 'enum': [0, 1]}, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'target', 'controller', 'pages', 'condition', 'expected_sha256']),
    'insert_object': ('Insert one XML object into a component display list at a zero-based index, or append if omitted; requires SHA-256', {'pkg': PKG, 'name': NAME, 'object_xml': {'type': 'string'}, 'index': {'type': 'integer', 'minimum': 0}, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'object_xml', 'expected_sha256']),
    'insert_resource': ('Insert an image, component or movieclip resource at a zero-based index, or append if omitted; requires SHA-256', {'pkg': PKG, 'name': NAME, 'ref_pkg': PKG, 'ref_name': {'type': 'string'}, 'object_name': {'type': 'string'}, 'x': {'type': 'integer'}, 'y': {'type': 'integer'}, 'index': {'type': 'integer', 'minimum': 0}, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'ref_name', 'expected_sha256']),
    'move_object': ('Move an existing display-list child to a zero-based final index; requires SHA-256', {'pkg': PKG, 'name': NAME, 'target': {'type': 'string'}, 'index': {'type': 'integer', 'minimum': 0}, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'target', 'index', 'expected_sha256']),
    'remove_object': ('Remove one child by id or unique name; reject detected references; requires SHA-256', {'pkg': PKG, 'name': NAME, 'target': {'type': 'string'}, 'expected_sha256': {'type': 'string'}}, ['pkg', 'name', 'target', 'expected_sha256']),
    'validate': ('Check project XML, registered files, PNG/JPEG decoding, IDs and selected component references; optionally check supported sound, JTA and bitmap font structures; requires Pillow', {'check_media': {'type': 'boolean'}}, []),
    'lint': ('Run the existing project standards and reference checker; requires Node.js', {}, []),
    'atlas_layout': ('Plan a deterministic atlas layout for registered images, with optional rotation; requires Pillow; does not publish', {'pkg': PKG, 'width': {'type': 'integer', 'minimum': 1}, 'height': {'type': 'integer', 'minimum': 1}, 'padding': {'type': 'integer', 'minimum': 0}, 'shrink_atlas': {'type': 'boolean'}, 'optimize_atlas': {'type': 'boolean'}}, ['pkg']),
    'atlas_export': ('Export atlas PNGs and layout manifest to a new directory; requires Pillow; not a FairyGUI published package', {'pkg': PKG, 'output': {'type': 'string'}, 'width': {'type': 'integer', 'minimum': 1}, 'height': {'type': 'integer', 'minimum': 1}, 'padding': {'type': 'integer', 'minimum': 0}, 'shrink_atlas': {'type': 'boolean'}, 'optimize_atlas': {'type': 'boolean'}}, ['pkg', 'output']),
    'inspect_published': ('Read uncompressed FairyGUI binary package metadata and check sprite atlas references; does not validate component payloads or texture pixels', {'file': {'type': 'string'}}, ['file']),
    'validate_published': ('Check published atlas files and sprite bounds; optionally flag partial sprite overlaps and compare source images and components; requires Pillow', {'file': {'type': 'string'}, 'compare_source': {'type': 'boolean'}, 'compare_components': {'type': 'boolean'}, 'exported_only': {'type': 'boolean'}, 'check_overlaps': {'type': 'boolean'}}, ['file']),
    'publish_images_experimental': ('Experimental Cocos binary publication for image-only packages, including basic nine-slice; unsupported resources are rejected', {'pkg': PKG, 'output': {'type': 'string'}, 'width': {'type': 'integer', 'minimum': 1}, 'height': {'type': 'integer', 'minimum': 1}, 'padding': {'type': 'integer', 'minimum': 0}, 'shrink_atlas': {'type': 'boolean'}, 'optimize_atlas': {'type': 'boolean'}, 'trim_images': {'type': 'boolean'}}, ['pkg', 'output']),
    'publish_simple_experimental': ('Experimental Cocos binary publication for a limited subset of component features; unsupported content is rejected', {'exported_only': {'type': 'boolean'}, 'pkg': PKG, 'output': {'type': 'string'}, 'width': {'type': 'integer', 'minimum': 1}, 'height': {'type': 'integer', 'minimum': 1}, 'padding': {'type': 'integer', 'minimum': 0}, 'shrink_atlas': {'type': 'boolean'}, 'optimize_atlas': {'type': 'boolean'}, 'trim_images': {'type': 'boolean'}}, ['pkg', 'output']),
    'publish_project_experimental': ('Publish all selected project packages atomically into package subdirectories and return a dependency manifest; experimental Cocos subset', {'output': {'type': 'string'}, 'exported_only': {'type': 'boolean'}, 'width': {'type': 'integer', 'minimum': 1}, 'height': {'type': 'integer', 'minimum': 1}, 'padding': {'type': 'integer', 'minimum': 0}, 'shrink_atlas': {'type': 'boolean'}, 'optimize_atlas': {'type': 'boolean'}, 'trim_images': {'type': 'boolean'}}, ['output']),
    'preflight_publish': ('Temporarily publish and validate each project package, report all package errors and dependencies, then remove temporary output', {'exported_only': {'type': 'boolean'}, 'width': {'type': 'integer', 'minimum': 1}, 'height': {'type': 'integer', 'minimum': 1}, 'padding': {'type': 'integer', 'minimum': 0}, 'shrink_atlas': {'type': 'boolean'}, 'optimize_atlas': {'type': 'boolean'}, 'trim_images': {'type': 'boolean'}}, []),
}

for name in ('atlas_layout', 'atlas_export', 'publish_images_experimental', 'publish_simple_experimental', 'publish_project_experimental', 'preflight_publish'):
    SPECS[name][1]['rotate_images'] = {'type': 'boolean', 'description': 'Allow clockwise atlas rotation for supported images'}


def validate_arguments(name, args):
    _, props, required = SPECS[name]
    types = {'string': str, 'integer': int, 'boolean': bool, 'object': dict, 'array': list}
    def check(value, schema, path):
        if 'anyOf' in schema:
            for option in schema['anyOf']:
                try:
                    check(value, option, path)
                    return
                except ValueError:
                    pass
            raise ValueError(f'{path} does not match an allowed type or value')
        kind = schema['type']
        if kind == 'number':
            if type(value) not in (int, float) or (type(value) is float and not math.isfinite(value)): raise ValueError(f'{path} must be a finite number')
        elif type(value) is not types[kind]: raise ValueError(f'{path} must be {kind}')
        if 'enum' in schema and value not in schema['enum']: raise ValueError(f'{path} has an unsupported value')
        if 'minimum' in schema and value < schema['minimum']: raise ValueError(f'{path} must be at least {schema["minimum"]}')
        if 'maximum' in schema and value > schema['maximum']: raise ValueError(f'{path} must be at most {schema["maximum"]}')
        if kind == 'array':
            if not schema.get('minItems', 0) <= len(value) <= schema.get('maxItems', len(value)):
                raise ValueError(f'{path} has invalid length')
            if 'items' in schema:
                for index, item in enumerate(value): check(item, schema['items'], f'{path}[{index}]')
        elif kind == 'object':
            properties = schema.get('properties', {})
            if len(value) < schema.get('minProperties', 0): raise ValueError(f'{path} must not be empty')
            missing = [key for key in schema.get('required', []) if key not in value]
            if missing: raise ValueError(f'{path} missing required fields: ' + ', '.join(missing))
            unknown = set(value) - set(properties)
            if schema.get('additionalProperties') is False and unknown:
                raise ValueError(f'{path} has unknown fields: ' + ', '.join(sorted(unknown)))
            for key in properties:
                if key in value: check(value[key], properties[key], f'{path}.{key}')
    check(args, {'type': 'object', 'properties': {'project': PROJECT, **props}, 'required': ['project', *required], 'additionalProperties': False}, 'arguments')


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
        if not isinstance(params, dict): raise ValueError('params must be an object')
        name = params.get('name')
        if not isinstance(name, str) or name not in SPECS:
            raise ValueError('unknown tool')
        args = params.get('arguments', {})
        try:
            validate_arguments(name, args)
            data = {'ok': True, 'data': execute(name, args)}
        except (ValueError, OSError, KeyError, TypeError, ImportError) as exc:
            data = {'ok': False, 'error': str(exc)}
        except Exception:
            traceback.print_exc(file=sys.stderr)
            data = {'ok': False, 'error': 'internal tool error; see server stderr'}
        return {'content': [{'type': 'text', 'text': json.dumps(data, ensure_ascii=False)}], 'isError': not data['ok']}
    raise ValueError('unknown method')


def main():
    # MCP stdio messages are UTF-8 regardless of the Windows console code page.
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8')
    for line in sys.stdin:
        try:
            req = json.loads(line, parse_constant=lambda value: (_ for _ in ()).throw(ValueError('invalid JSON constant')))
            validate_unicode(req)
            if not isinstance(req, dict) or req.get('jsonrpc') != '2.0' or not isinstance(req.get('method'), str) or ('id' in req and type(req['id']) not in (str, int, type(None))):
                response = {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32600, 'message': 'Invalid Request'}}
                print(json.dumps(response), flush=True)
                continue
            if 'id' not in req:
                continue
            try:
                response = {'jsonrpc': '2.0', 'id': req['id'], 'result': dispatch(req)}
            except (ValueError, TypeError) as exc:
                code = -32601 if str(exc) == 'unknown method' else -32602
                response = {'jsonrpc': '2.0', 'id': req['id'], 'error': {'code': code, 'message': str(exc)}}
            except Exception:
                traceback.print_exc(file=sys.stderr)
                response = {'jsonrpc': '2.0', 'id': req['id'], 'error': {'code': -32603, 'message': 'Internal error'}}
        except (ValueError, TypeError, UnicodeError, RecursionError):
            response = {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32700, 'message': 'Parse error'}}
        print(json.dumps(response, ensure_ascii=False, allow_nan=False), flush=True)


if __name__ == '__main__':
    main()
