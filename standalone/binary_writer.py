"""Experimental FairyGUI v1 binary encoder for image-only packages.

This module rejects unsupported resource types in its caller; it is not yet a
general-purpose project publisher. The format follows the Cocos ByteBuffer
and UIPackage reader (big-endian, indexed sections and shared string table).
"""
import struct


def encode_empty_component(width, height, children=(), ref=None, controllers=(), version=1, relations=(), extension=0, button_mode=0, pivot=None, overflow=0, title_type=0, reverse=False, margin=None, scroll=None, button_sound=None, button_effect=0, button_effect_value=0.8, transitions=(), settings=None, combo_dropdown=None):
    """Encode a default component and supported simple image children."""
    i32 = lambda n: struct.pack('>i', n)
    i16 = lambda n: struct.pack('>h', n)
    def indexed(parts):
        pos, offsets = 2 + 4 * len(parts), []
        for part in parts:
            offsets.append(pos if part else 0); pos += len(part)
        return bytes([len(parts), 0]) + b''.join(i32(n) for n in offsets) + b''.join(parts)
    def encode_relations(items):
        return bytes([len(items)]) + b''.join(i16(relation['target']) + bytes([len(relation['types'])]) + b''.join(bytes([kind, 0]) for kind in relation['types']) for relation in items)
    encoded_children = []
    for child in children:
        if ref is None: raise ValueError('string encoder required for children')
        text = child.get('type') in ('text', 'richtext', 'inputtext')
        nested = child.get('type') == 'component'
        graph = child.get('type') == 'graph'
        loader = child.get('type') == 'loader'
        group = child.get('type') == 'group'
        list_child = child.get('type') in ('list', 'tree')
        tree_child = child.get('type') == 'tree'
        movieclip = child.get('type') == 'movieclip'
        base = bytes([8 if child.get('type') == 'inputtext' else 7 if child.get('type') == 'richtext' else 6 if text else 9 if nested else 3 if graph else 4 if loader else 5 if group else 17 if tree_child else 10 if list_child else 1 if movieclip else 0]) + ref(child.get('src')) + ref(child.get('pkg')) + ref(child['id']) + ref(child.get('name'))
        base += i32(child['x']) + i32(child['y'])
        base += (b'\1' + b''.join(i32(n) for n in child['size'])) if 'size' in child else b'\0'
        base += b'\1' + b''.join(i32(n) for n in child['constraints']) if 'constraints' in child else b'\0'
        base += (b'\1' + struct.pack('>ff', *child['scale'])) if 'scale' in child else b'\0'
        base += b'\0'  # no skew
        base += (b'\1' + struct.pack('>ffB', *child['pivot'], child.get('anchor', False))) if 'pivot' in child else b'\0'
        base += struct.pack('>ff', child.get('alpha', 1.0), child.get('rotation', 0.0))
        base += bytes([child.get('visible', True), child.get('touchable', True), child.get('grayed', False), 0, 0]) + ref(None)
        gears = []
        for gear in child.get('gears', ()):
            if gear.get('type') in ('xy', 'size', 'look', 'color', 'animation', 'fontSize'):
                pairs = [(page, value) for page, value in zip(gear['pages'], gear['values']) if value is not None]
                def encode_value(value):
                    if gear['type'] == 'look': return struct.pack('>ffBB', *value)
                    if gear['type'] == 'color': return bytes(value[0]) + bytes(value[1])
                    if gear['type'] == 'animation': return bytes([value['playing']]) + i32(value['frame'])
                    if gear['type'] == 'fontSize': return i32(value)
                    return i32(value[0]) + i32(value[1]) + (struct.pack('>ff', value[2], value[3]) if gear['type'] == 'size' else b'')
                values = b''.join(ref(page) + encode_value(value) for page, value in pairs)
                default = b'\1' + encode_value(gear['default']) if 'default' in gear else b'\0'
                tween = gear.get('tween')
                tween_data = b'\1' + bytes([tween['ease']]) + struct.pack('>ff', tween['duration'], tween['delay']) if tween else b'\0'
                raw_gear = bytes([{'xy': 1, 'size': 2, 'look': 3, 'color': 4, 'animation': 5, 'fontSize': 9}[gear['type']]]) + i16(gear['controllerIndex']) + i16(len(pairs)) + values + default + tween_data
                if version >= 2 and gear['type'] == 'xy': raw_gear += b'\0'  # no percentage positions
            elif gear.get('type', 'display') in ('text', 'icon'):
                pairs = b''.join(ref(page) + ref(value) for page, value in zip(gear['pages'], gear['values']))
                default = b'\1' + ref(gear['default']) if 'default' in gear else b'\0'
                raw_gear = bytes([6 if gear['type'] == 'text' else 7]) + i16(gear['controllerIndex']) + i16(len(gear['pages'])) + pairs + default + b'\0'
            else:
                raw_gear = bytes([8 if gear.get('type') == 'display2' else 0]) + i16(gear['controllerIndex']) + i16(len(gear['pages'])) + b''.join(ref(page) for page in gear['pages']) + b'\0'
                if gear.get('type') == 'display2' and version >= 2: raw_gear += bytes([gear.get('condition', 0)])
            if len(raw_gear) > 32767: raise ValueError('gear too large')
            gears.append(i16(len(raw_gear)) + raw_gear)
        gear_section = i16(len(gears)) + b''.join(gears)
        child_relations = child.get('relations', ())
        relation_section = encode_relations(child_relations)
        group_section = ref(None) + i16(child.get('groupIndex', -1))
        if text:
            style = ref(child.get('font')) + i16(child.get('fontSize', 0)) + bytes(child.get('color', (0, 0, 0, 255)))
            style += bytes([child.get('align', 0), child.get('vAlign', 0)])
            style += i16(child.get('leading', 3)) + i16(child.get('letterSpacing', 0))
            style += bytes([child.get('ubb', False), child.get('autoSize', 1), child.get('underline', False), child.get('italic', False), child.get('bold', False), child.get('singleLine', False)])
            style += b'\1' + bytes(child['strokeColor']) + struct.pack('>f', 1.0) if 'strokeColor' in child else b'\0'
            style += b'\1' + bytes(child['shadowColor']) + struct.pack('>ff', *child['shadowOffset']) if 'shadowColor' in child else b'\0'
            style += b'\0'  # no template variables
            input_data = b''
            if child.get('type') == 'inputtext':
                settings_input = child['input']
                input_data = ref(settings_input.get('prompt')) + ref(settings_input.get('restrict')) + i32(settings_input['maxLength']) + i32(settings_input['keyboardType']) + bytes([settings_input['password']])
            child_sections = [base, group_section, gear_section, relation_section, input_data, style, ref(child.get('text', ''))]
        elif nested:
            child_sections = [base, group_section, gear_section, relation_section, i16(-1) + i16(0) + (i16(0) if version >= 2 else b'')]
            if 'progress' in child:
                value, maximum, minimum = child['progress']
                child_sections.extend([b'', bytes([child.get('progressKind', 14)]) + i32(value) + i32(maximum) + (i32(minimum) if version >= 2 else b'')])
            elif 'label' in child:
                label = child['label']
                color = b'\1' + bytes(label['color']) if 'color' in label else b'\0'
                child_sections.extend([b'', b'\x0b' + ref(label.get('title')) + ref(label.get('icon')) + color + i32(label.get('fontSize', 0)) + b'\0' + ref(None)])
            elif 'button' in child:
                button = child['button']
                color = b'\1' + bytes(button['color']) if 'color' in button else b'\0'
                button_data = b'\x0c' + b''.join(ref(button.get(key)) for key in ('title', 'selectedTitle', 'icon', 'selectedIcon')) + color
                button_data += i32(button.get('fontSize', 0)) + i16(button.get('controller', -1)) + ref(button.get('page')) + ref(None) + b'\0' + bytes([button.get('checked', False)])
                child_sections.extend([b'', button_data])
            elif 'comboBox' in child:
                combo = child['comboBox']
                items = []
                for item in combo['items']:
                    entry = b''.join(ref(item.get(key)) for key in ('title', 'value', 'icon'))
                    items.append(i16(len(entry)) + entry)
                combo_data = b'\x0d' + i16(len(items)) + b''.join(items) + ref(None) + ref(None) + b'\0' + i32(combo['visibleItemCount']) + b'\0' + i16(-1)
                child_sections.extend([b'', combo_data])
        elif list_child:
            ls = child['list']
            style = bytes([ls['layout'], ls['selectionMode'], ls['align'], ls['vAlign']])
            style += b''.join(i16(ls[key]) for key in ('lineGap', 'colGap', 'lineCount', 'colCount'))
            style += bytes([ls['autoItemSize'], 0]) + i16(0)
            style += b'\1' + b''.join(i32(v) for v in ls['margin']) if 'margin' in ls else b'\0'
            style += bytes([ls['overflow']])
            style += b'\1' + b''.join(i32(v) for v in ls['clipSoftness']) if 'clipSoftness' in ls else b'\0'
            if version >= 2: style += b'\1\0'
            page = i16(ls['pageController']) + i16(0) + (i16(0) if version >= 2 else b'')
            list_scroll = b''
            if ls['overflow'] == 2:
                st = ls['scroll']
                list_scroll = bytes([st['type'], st['barDisplay']]) + i32(st['flags'])
                list_scroll += b'\1' + b''.join(i32(v) for v in st['barMargin']) if st['barMargin'] is not None else b'\0'
                list_scroll += b''.join(ref(value) for value in st.get('resources', (None, None, None, None)))
            items = []
            for item in ls['items']:
                entry = ref(item.get('url')) + (bytes([item['folder'], item['level']]) if tree_child else b'')
                entry += b''.join(ref(item.get(key)) for key in ('title', 'selectedTitle', 'icon', 'selectedIcon', 'name')) + i16(0) + (i16(0) if version >= 2 else b'')
                items.append(i16(len(entry)) + entry)
            child_sections = [base, group_section, gear_section, relation_section, page, style, i16(ls['selectionController']), list_scroll, ref(ls['defaultItem']) + i16(len(items)) + b''.join(items)]
            if tree_child: child_sections.append(i32(ls['indent']) + bytes([ls['clickToExpand']]))
        elif movieclip:
            color = child.get('imageColor')
            style = (b'\1' + bytes(color) if color else b'\0') + b'\0' + i32(child.get('frame', 0)) + bytes([child.get('playing', True)])
            child_sections = [base, group_section, gear_section, relation_section, b'', style]
        elif loader:
            image_color = child.get('imageColor')
            style = ref(child.get('url')) + bytes([child.get('align', 0), child.get('vAlign', 0), child.get('fill', 0), 0, 0, 0, 1]) + i32(0)
            style += b'\1' + bytes(image_color) if image_color else b'\0'
            style += bytes([child.get('fillMethod', 0)])
            if child.get('fillMethod', 0):
                style += bytes([0, child.get('fillClockwise', True)]) + struct.pack('>f', child.get('fillAmount', 1.0))
            child_sections = [base, group_section, gear_section, relation_section, b'', style]
        elif group:
            style = b'\0' + i32(0) + i32(0) + (b'\0\0' + i16(-1) if version >= 2 else b'')
            child_sections = [base, group_section, gear_section, relation_section, b'', style]
        elif graph:
            graph_type = child.get('graphType', 0)
            style = bytes([graph_type])
            if graph_type:
                style += i32(child.get('lineSize', 1)) + bytes(child.get('lineColor', (0, 0, 0, 255))) + bytes(child.get('fillColor', (255, 255, 255, 255)))
                style += b'\1' + struct.pack('>ffff', *child['cornerRadius']) if 'cornerRadius' in child else b'\0'
                if graph_type == 3:
                    points = child['points']
                    style += i16(len(points)) + struct.pack('>' + 'f' * len(points), *points)
                elif graph_type == 4:
                    distances = child.get('distances', ())
                    style += i16(child['sides']) + struct.pack('>f', child.get('startAngle', 0)) + i16(len(distances)) + struct.pack('>' + 'f' * len(distances), *distances)
            child_sections = [base, group_section, gear_section, relation_section, b'', style]
        else:
            image_color = child.get('imageColor')
            style = (b'\1' + bytes(image_color)) if image_color else b'\0'
            style += bytes([child.get('flip', 0), child.get('fillMethod', 0)])
            if child.get('fillMethod', 0):
                style += bytes([0, child.get('fillClockwise', True)]) + struct.pack('>f', child.get('fillAmount', 1.0))
            child_sections = [base, group_section, gear_section, relation_section, b'', style]
        raw = indexed(child_sections)
        if len(raw) > 32767: raise ValueError('component child too large')
        encoded_children.append(i16(len(raw)) + raw)
    if len(encoded_children) > 32767: raise ValueError('too many component children')
    encoded_controllers = []
    for controller in controllers:
        pages = controller['pages']
        if len(pages) > 32767: raise ValueError('too many controller pages')
        selection = b'' if version == 1 else (b'\1' + i16(controller['selected']) if controller.get('selected', 0) else b'\0')
        actions = []
        for action in controller.get('actions', ()):
            raw_action = bytes([action['type']]) + i16(len(action['from'])) + b''.join(ref(page) for page in action['from']) + i16(len(action['to'])) + b''.join(ref(page) for page in action['to'])
            if action['type'] == 0:
                raw_action += ref(action['transition']) + i32(action['times']) + struct.pack('>f', action['delay']) + bytes([action['stopOnExit']])
            else: raise ValueError('unsupported controller action')
            if len(raw_action) > 32767: raise ValueError('controller action too large')
            actions.append(i16(len(raw_action)) + raw_action)
        raw = indexed([ref(controller['name']) + b'\0', i16(len(pages)) + b''.join(ref(pid) + ref(name) for pid, name in pages) + selection, i16(len(actions)) + b''.join(actions)])
        if len(raw) > 32767: raise ValueError('controller too large')
        encoded_controllers.append(i16(len(raw)) + raw)
    if len(encoded_controllers) > 32767: raise ValueError('too many controllers')
    pivot_data = b'\1' + struct.pack('>ff', *pivot) + b'\0' if pivot is not None else b'\0'
    margin_data = b'\1' + b''.join(i32(v) for v in margin) if margin is not None else b'\0'
    base_data = i32(width) + i32(height) + b'\0' + pivot_data + margin_data + bytes([overflow]) + b'\0'
    encoded_transitions = []
    for trans in transitions:
        encoded_items = []
        for action in trans['items']:
            kind = action['type']
            tween = action.get('tween')
            def encode_transition_value(value):
                if kind in (0, 1, 3):
                    return bytes(value['flags']) + struct.pack('>ff', *value['values']) + (b'\0' if version >= 2 and kind == 0 else b'')
                if kind == 6: return bytes(value)
                if kind == 8: return bytes([value])
                if kind == 7: return bytes([value['playing']]) + i32(value['frame'])
                if kind == 9: return ref(value['sound']) + struct.pack('>f', value['volume'])
                if kind == 10: return ref(value['name']) + i32(value['times'])
                if kind in (14, 15): return ref(value)
                return struct.pack('>' + 'f' * len(value), *value)
            header = bytes([kind]) + struct.pack('>f', action['time']) + i16(action['target']) + ref(action['label']) + bytes([bool(tween)])
            if tween:
                config = struct.pack('>f', tween['duration']) + bytes([tween['ease']]) + i32(tween['repeat']) + bytes([tween['yoyo']]) + ref(tween['endLabel'])
                end_value = encode_transition_value(tween['end'])
                if version >= 2:
                    path = tween.get('path', ())
                    end_value += i32(len(path)) + b''.join(bytes([point['curve']]) + struct.pack('>' + 'f' * len(point['points']), *point['points']) for point in path)
                raw = indexed([header, config, encode_transition_value(tween['start']), end_value])
            else:
                raw = indexed([header, b'', encode_transition_value(action['value'])])
            if len(raw) > 32767: raise ValueError('transition item too large')
            encoded_items.append(i16(len(raw)) + raw)
        if len(encoded_items) > 32767: raise ValueError('too many transition items')
        raw = ref(trans['name']) + i32(trans.get('options', 0)) + bytes([trans['autoPlay']]) + i32(trans['autoPlayTimes']) + struct.pack('>f', 0) + i16(len(encoded_items)) + b''.join(encoded_items)
        if len(raw) > 32767: raise ValueError('transition too large')
        encoded_transitions.append(i16(len(raw)) + raw)
    settings = settings or {}
    mask = settings.get('mask', -1)
    hit_child = settings.get('hitTestChild')
    component_settings = ref(None) + bytes([settings.get('opaque', True)]) + i16(mask) + (bytes([settings.get('reversedMask', False)]) if mask != -1 else b'')
    component_settings += ref(settings.get('hitTestImage')) + i32(1 if hit_child is not None else 0) + i32(hit_child if hit_child is not None else 0)
    sections = [base_data, i16(len(encoded_controllers)) + b''.join(encoded_controllers), i16(len(encoded_children)) + b''.join(encoded_children), encode_relations(relations),
                component_settings, i16(len(encoded_transitions)) + b''.join(encoded_transitions)]
    if extension == 12:
        sections.append(bytes([button_mode]) + ref(button_sound) + struct.pack('>f', 1.0) + bytes([button_effect]) + struct.pack('>f', button_effect_value))
    elif extension == 13:
        sections.append(ref(combo_dropdown))
    elif extension in (14, 15):
        sections.append(bytes([title_type, reverse]) + (b'\0\1' if extension == 15 and version >= 2 else b''))
    elif extension == 16:
        sections.append(b'\0')
    if scroll is not None:
        while len(sections) < 7: sections.append(b'')
        bar_margin = scroll.get('barMargin')
        data = bytes([scroll['type'], scroll['barDisplay']]) + i32(scroll['flags'])
        data += b'\1' + b''.join(i32(v) for v in bar_margin) if bar_margin is not None else b'\0'
        sections.append(data + b''.join(ref(value) for value in scroll.get('resources', (None, None, None, None))))
    return indexed(sections)


def encode_image_package(package_id, package_name, images, pages, components=(), sounds=(), hit_tests=(), movieclips=(), fonts=(), dependencies=(), sprite_trim=None):
    if not package_id or not package_name:
        raise ValueError('package id and name required')
    def u16(n): return struct.pack('>H', n)
    def i16(n): return struct.pack('>h', n)
    def i32(n): return struct.pack('>i', n)
    def string(value):
        data = value.encode('utf-8')
        if len(data) > 65535: raise ValueError('string too long')
        return u16(len(data)) + data
    sprite_trim = sprite_trim or {}
    version = 2 if sprite_trim or any(gear.get('type') == 'display2' for comp in components for child in comp.get('children', ()) for gear in child.get('gears', ())) or any(ctrl.get('selected', 0) != 0 for comp in components for ctrl in comp.get('controllers', ())) or any(child.get('progress', [0, 0, 0])[2] != 0 for comp in components for child in comp.get('children', ())) or any(action.get('tween', {}).get('path') for comp in components for transition in comp.get('transitions', ()) for action in transition.get('items', ())) else 1
    table, indices = [], {}
    def ref(value):
        if value is None: return u16(65534)
        if value == '': return u16(65533)
        if value not in indices:
            if len(table) >= 65533: raise ValueError('string table too large')
            indices[value] = len(table); table.append(value)
        return u16(indices[value])
    frame_images = [frame for clip in movieclips for frame in clip['frames']]
    all_sprites = [*images, *frame_images]
    placements = {item['id']: (index, item) for index, page in enumerate(pages) for item in page['items']}
    if len(placements) != len(all_sprites) or {i['id'] for i in all_sprites} != set(placements):
        raise ValueError('image and layout ids do not match')
    image_map = {image['id']: image for image in images}
    if set(sprite_trim) - set(image_map): raise ValueError('trim references unknown image')
    for ident, trim in sprite_trim.items():
        if len(trim) != 4 or any(type(value) is not int or value < 0 for value in trim): raise ValueError('invalid sprite trim')
        x, y, original_width, original_height = trim
        image, item = image_map[ident], placements[ident][1]
        if (original_width, original_height) != (image['width'], image['height']) or x + item['width'] > original_width or y + item['height'] > original_height:
            raise ValueError('sprite trim outside original image')
    if len(images) + len(pages) + len(components) + len(sounds) + len(movieclips) + len(fonts) > 32767: raise ValueError('too many items')
    records = []
    for image in images:
        record = b'\0' + ref(image['id']) + ref(image['name']) + ref(None) + ref(None)
        record += bytes([bool(image.get('exported'))]) + i32(image['width']) + i32(image['height'])
        grid = image.get('scale9grid')
        if grid is not None:
            record += b'\1' + b''.join(i32(v) for v in grid) + i32(0)
        elif image.get('scaleByTile'):
            record += b'\2'
        else:
            record += b'\0'
        record += b'\1'  # smoothing enabled
        if version >= 2: record += ref(None) + b'\0\0'
        records.append(i32(len(record)) + record)
    for index, page in enumerate(pages):
        record = b'\4' + ref('atlas' + str(index)) + ref(None) + ref(None) + ref('atlas' + str(index) + '.png')
        record += b'\0' + i32(page['width']) + i32(page['height'])
        if version >= 2: record += ref(None) + b'\0\0'
        records.append(i32(len(record)) + record)
    for sound in sounds:
        record = b'\2' + ref(sound['id']) + ref(sound['name']) + ref(None) + ref(sound['file'])
        record += bytes([bool(sound.get('exported'))]) + i32(0) + i32(0)
        if version >= 2: record += ref(None) + b'\0\0'
        records.append(i32(len(record)) + record)
    for clip in movieclips:
        raw_frames = []
        for frame in clip['frames']:
            data = b''.join(i32(value) for value in frame['rect']) + i32(frame['delay']) + ref(frame['id'])
            raw_frames.append(i16(len(data)) + data)
        timing = i32(clip['interval']) + b'\0' + i32(0)
        frame_section = i16(len(raw_frames)) + b''.join(raw_frames)
        indexed = b'\2\0' + i32(10) + i32(10 + len(timing)) + timing + frame_section
        record = b'\1' + ref(clip['id']) + ref(clip['name']) + ref(None) + ref(None)
        record += bytes([bool(clip.get('exported'))]) + i32(clip['width']) + i32(clip['height']) + b'\1' + i32(len(indexed)) + indexed
        if version >= 2: record += ref(None) + b'\0\0'
        records.append(i32(len(record)) + record)
    for font in fonts:
        glyph_records = []
        for glyph in font['glyphs']:
            if glyph['image'] is not None and glyph['image'] in placements and placements[glyph['image']][1].get('rotated'):
                raise ValueError('bitmap font glyphs cannot be rotated')
            raw = u16(glyph['id']) + ref(glyph['image']) + b''.join(i32(glyph[key]) for key in ('x', 'y', 'xOffset', 'yOffset', 'width', 'height', 'xAdvance')) + bytes([glyph['channel']])
            glyph_records.append(i16(len(raw)) + raw)
        header = bytes([font['ttf'], font['canTint'], font['resizable'], font['hasChannel']]) + i32(font['fontSize']) + i32(font['xAdvance']) + i32(font['lineHeight'])
        glyph_data = i32(len(glyph_records)) + b''.join(glyph_records)
        indexed = b'\2\0' + i32(10) + i32(10 + len(header)) + header + glyph_data
        record = b'\5' + ref(font['id']) + ref(font['name']) + ref(None) + ref(None)
        record += bytes([bool(font.get('exported'))]) + i32(0) + i32(0) + i32(len(indexed)) + indexed
        if version >= 2: record += ref(None) + b'\0\0'
        records.append(i32(len(record)) + record)
    for component in components:
        payload = encode_empty_component(component['width'], component['height'], component.get('children', ()), ref, component.get('controllers', ()), version, component.get('relations', ()), component.get('extension', 0), component.get('buttonMode', 0), component.get('pivot'), component.get('overflow', 0), component.get('titleType', 0), component.get('reverse', False), component.get('margin'), component.get('scroll'), component.get('buttonSound'), component.get('buttonEffect', 0), component.get('buttonEffectValue', 0.8), component.get('transitions', ()), component.get('settings'), component.get('comboDropdown'))
        record = b'\3' + ref(component['id']) + ref(component['name']) + ref(None) + ref(None)
        record += bytes([bool(component.get('exported'))]) + i32(component['width']) + i32(component['height'])
        record += bytes([component.get('extension', 0)]) + i32(len(payload)) + payload
        if version >= 2: record += ref(None) + b'\0\0'
        records.append(i32(len(record)) + record)
    items = i16(len(records)) + b''.join(records)
    sprites = []
    for image in all_sprites:
        index, item = placements[image['id']]
        record = ref(image['id']) + ref('atlas' + str(index))
        record += b''.join(i32(item[k]) for k in ('x', 'y', 'width', 'height')) + bytes([bool(item.get('rotated'))])
        if version >= 2:
            trim = sprite_trim.get(image['id'])
            record += b'\1' + b''.join(i32(value) for value in trim) if trim else b'\0'
        sprites.append(i16(len(record)) + record)
    for font in fonts:
        if font['ttf']:
            index, item = placements[font['texture']]
            if item.get('rotated'): raise ValueError('bitmap font textures cannot be rotated')
            record = ref(font['id']) + ref('atlas' + str(index))
            record += b''.join(i32(item[k]) for k in ('x', 'y', 'width', 'height')) + b'\0' + (b'\0' if version >= 2 else b'')
            sprites.append(i16(len(record)) + record)
    if len(sprites) > 32767: raise ValueError('too many sprites')
    sprite_section = i16(len(sprites)) + b''.join(sprites)
    if len(dependencies) > 32767: raise ValueError('too many package dependencies')
    dependencies = i16(len(dependencies)) + b''.join(ref(dep['id']) + ref(dep['name']) for dep in dependencies) + (i16(0) if version >= 2 else b'')
    strings = i32(len(table)) + b''.join(string(s) for s in table)
    hits = []
    for hit in hit_tests:
        pixels = hit['pixels']
        record = ref(hit['id']) + i32(0) + i32(hit['width']) + bytes([hit['divisor']]) + i32(len(pixels)) + pixels
        hits.append(i32(len(record)) + record)
    if len(hits) > 32767: raise ValueError('too many pixel hit tests')
    hit_section = i16(len(hits)) + b''.join(hits) if hits else b''
    strings = i32(len(table)) + b''.join(string(s) for s in table)
    sections = [dependencies, items, sprite_section, hit_section, strings]
    index_size = 2 + 4 * len(sections)
    offset, offsets = index_size, []
    for section in sections:
        offsets.append(offset if section else 0)
        offset += len(section)
    index = bytes([len(sections), 0]) + b''.join(i32(x) for x in offsets)
    return b'FGUI' + i32(version) + b'\0' + string(package_id) + string(package_name) + bytes(20) + index + b''.join(sections)
