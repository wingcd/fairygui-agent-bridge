"""Read published FairyGUI package metadata using the Cocos runtime layout.

Only the component and package fields explicitly decoded below are inspected.
"""
import struct


class Reader:
    def __init__(self, data): self.data, self.pos, self.strings = data, 0, []
    def take(self, n):
        if n < 0 or self.pos + n > len(self.data): raise ValueError('truncated package')
        v = self.data[self.pos:self.pos+n]; self.pos += n; return v
    def u8(self): return self.take(1)[0]
    def u16(self): return struct.unpack('>H', self.take(2))[0]
    def i16(self): return struct.unpack('>h', self.take(2))[0]
    def i32(self): return struct.unpack('>i', self.take(4))[0]
    def string(self): return self.take(self.u16()).decode('utf-8')
    def ref(self):
        n = self.u16()
        if n == 65534: return None
        if n == 65533: return ''
        if n >= len(self.strings): raise ValueError('invalid string table reference')
        return self.strings[n]
    def section(self, base, index):
        self.pos = base
        count, short = self.u8(), self.u8()
        if index >= count: return False
        self.pos += index * (2 if short else 4)
        offset = self.u16() if short else self.i32()
        if offset <= 0: return False
        self.pos = base + offset
        if self.pos >= len(self.data): raise ValueError('invalid section offset')
        return True


def inspect_component(data, strings, extension=0, version=1):
    r = Reader(data)
    r.strings = strings
    def read_relations(limit):
        relations = []
        for _ in range(r.u8()):
            target, count = r.i16(), r.u8()
            definitions = [{'type': r.u8(), 'percent': bool(r.u8())} for _ in range(count)]
            relations.append({'target': target, 'definitions': definitions})
        if r.pos > limit: raise ValueError('truncated relations')
        return relations
    if not r.section(0, 0): raise ValueError('component missing size section')
    width, height = r.i32(), r.i32()
    base = {}
    if r.u8(): base['constraints'] = [r.i32() for _ in range(4)]
    if r.u8(): base['pivot'] = [*struct.unpack('>ff', r.take(8)), bool(r.u8())]
    if r.u8(): base['margin'] = [r.i32() for _ in range(4)]
    base['overflow'] = r.u8()
    if r.u8(): r.take(8)
    controllers = []
    if r.section(0, 1):
        count = r.i16()
        if count < 0: raise ValueError('invalid controller count')
        for _ in range(count):
            length = r.i16(); begin = r.pos; end = begin + length
            if length < 0 or end > len(data): raise ValueError('invalid controller size')
            if not r.section(begin, 0): raise ValueError('missing controller header')
            name, auto_radio = r.ref(), bool(r.u8())
            if not r.section(begin, 1): raise ValueError('missing controller pages')
            page_count = r.i16()
            if page_count < 0: raise ValueError('invalid controller page count')
            pages = [{'id': r.ref(), 'name': r.ref()} for _ in range(page_count)]
            selected = 0
            if version >= 2:
                kind = r.u8()
                if kind == 1: selected = r.i16()
                elif kind == 3: selected = {'variable': r.ref()}
                elif kind == 2: selected = 'branch'
                elif kind != 0: raise ValueError('invalid controller home page')
            if r.pos > end: raise ValueError('truncated controller')
            controller = {'name': name, 'autoRadioGroupDepth': auto_radio, 'pages': pages, 'selected': selected}
            if r.section(begin, 2):
                action_count = r.i16()
                if action_count < 0: raise ValueError('invalid controller action count')
                actions = []
                for _ in range(action_count):
                    length = r.i16(); action_end = r.pos + length
                    if length < 0 or action_end > end: raise ValueError('invalid controller action length')
                    kind = r.u8()
                    from_count = r.i16()
                    if from_count < 0: raise ValueError('invalid action page count')
                    from_pages = [r.ref() for _ in range(from_count)]
                    to_count = r.i16()
                    if to_count < 0: raise ValueError('invalid action page count')
                    action = {'type': kind, 'from': from_pages, 'to': [r.ref() for _ in range(to_count)]}
                    if kind == 0:
                        action.update(transition=r.ref(), times=r.i32(), delay=struct.unpack('>f', r.take(4))[0], stopOnExit=bool(r.u8()))
                    elif kind == 1:
                        action.update(object=r.ref(), controller=r.ref(), page=r.ref())
                    else: raise ValueError('unsupported controller action')
                    if r.pos > action_end: raise ValueError('truncated controller action')
                    actions.append(action); r.pos = action_end
                if actions: controller['actions'] = actions
            controllers.append(controller)
            r.pos = end
    children = []
    if r.section(0, 2):
        count = r.i16()
        if count < 0: raise ValueError('invalid component child count')
        for _ in range(count):
            length = r.i16()
            begin, end = r.pos, r.pos + length
            if length < 0 or end > len(data): raise ValueError('invalid component child size')
            if not r.section(begin, 0) or r.pos >= end: raise ValueError('missing component child base section')
            child = {'type': r.u8(), 'src': r.ref(), 'pkg': r.ref(), 'id': r.ref(), 'name': r.ref(), 'x': r.i32(), 'y': r.i32()}
            if r.u8(): child['size'] = [r.i32(), r.i32()]
            if r.u8(): child['constraints'] = [r.i32() for _ in range(4)]
            if r.u8(): child['scale'] = list(struct.unpack('>ff', r.take(8)))
            if r.u8(): child['skew'] = list(struct.unpack('>ff', r.take(8)))
            if r.u8(): child['pivot'] = [*struct.unpack('>ff', r.take(8)), bool(r.u8())]
            child['alpha'], child['rotation'] = struct.unpack('>ff', r.take(8))
            child['visible'], child['touchable'], child['grayed'] = bool(r.u8()), bool(r.u8()), bool(r.u8())
            child['blendMode'], child['filter'], child['data'] = r.u8(), r.u8(), r.ref()
            if r.pos > end: raise ValueError('truncated component child')
            if r.section(begin, 1):
                tooltip, group_index = r.ref(), r.i16()
                if tooltip is not None: child['tooltip'] = tooltip
                if group_index >= 0: child['groupIndex'] = group_index
                if r.pos > end: raise ValueError('truncated component child group')
            if r.section(begin, 2):
                gear_count = r.i16()
                if gear_count < 0: raise ValueError('invalid gear count')
                gears = []
                for _ in range(gear_count):
                    length = r.i16(); gear_end = r.pos + length
                    if length < 0 or gear_end > end: raise ValueError('invalid gear size')
                    kind, controller, count = r.u8(), r.i16(), r.i16()
                    if count < 0: raise ValueError('invalid gear page count')
                    gear = {'type': kind, 'controller': controller}
                    if kind in (0, 8):
                        gear['pages'] = [r.ref() for _ in range(count)]
                    elif kind in (1, 2, 3, 4, 5, 6, 7, 9):
                        def gear_value():
                            if kind == 1: return [r.i32(), r.i32()]
                            if kind == 2: return [r.i32(), r.i32(), *struct.unpack('>ff', r.take(8))]
                            if kind == 3: return [*struct.unpack('>ff', r.take(8)), bool(r.u8()), bool(r.u8())]
                            if kind == 4: return [list(r.take(4)), list(r.take(4))]
                            if kind == 5: return {'playing': bool(r.u8()), 'frame': r.i32()}
                            if kind == 9: return r.i32()
                            return r.ref()
                        values = []
                        for _ in range(count):
                            page = r.ref()
                            if page is not None:
                                value = gear_value()
                                values.append({'page': page, 'value': value})
                        gear['values'] = values
                        if r.u8(): gear['default'] = gear_value()
                    if kind in (0, 1, 2, 3, 4, 5, 6, 7, 8, 9):
                        gear['tween'] = bool(r.u8())
                        if gear['tween']:
                            gear['ease'] = r.u8()
                            gear['duration'], gear['delay'] = struct.unpack('>ff', r.take(8))
                    if kind == 8: gear['condition'] = r.u8() if version >= 2 else 0
                    if r.pos > gear_end: raise ValueError('truncated gear')
                    gears.append(gear); r.pos = gear_end
                if gears: child['gears'] = gears
            if r.section(begin, 3):
                relations = read_relations(end)
                if relations: child['relations'] = relations
            if child['type'] in (6, 7, 8):
                if not r.section(begin, 5): raise ValueError('text child missing style section')
                child['font'] = r.ref()
                child['fontSize'] = r.i16()
                child['color'] = list(r.take(4))
                child['align'], child['verticalAlign'] = r.u8(), r.u8()
                child['leading'], child['letterSpacing'] = r.i16(), r.i16()
                child['ubb'], child['autoSize'] = bool(r.u8()), r.u8()
                child['underline'], child['italic'], child['bold'], child['singleLine'] = (bool(r.u8()) for _ in range(4))
                if r.u8():
                    child['strokeColor'] = list(r.take(4))
                    child['stroke'] = struct.unpack('>f', r.take(4))[0]
                if r.u8():
                    child['shadowColor'] = list(r.take(4))
                    child['shadowOffset'] = list(struct.unpack('>ff', r.take(8)))
                child['templateVars'] = bool(r.u8())
                if r.pos > end: raise ValueError('truncated text style')
                if not r.section(begin, 6): raise ValueError('text child missing content section')
                child['text'] = r.ref()
                if r.pos > end: raise ValueError('truncated text content')
                if child['type'] == 8:
                    if not r.section(begin, 4): raise ValueError('input text missing input settings')
                    child['input'] = {'prompt': r.ref(), 'restrict': r.ref(), 'maxLength': r.i32(), 'keyboardType': r.i32(), 'password': bool(r.u8())}
                    if r.pos > end: raise ValueError('truncated input settings')
            elif child['type'] in (10, 17):
                if not r.section(begin, 5): raise ValueError('list missing layout section')
                layout = {'layout': r.u8(), 'selectionMode': r.u8(), 'align': r.u8(), 'verticalAlign': r.u8(), 'lineGap': r.i16(), 'columnGap': r.i16(), 'lineCount': r.i16(), 'columnCount': r.i16(), 'autoResize': bool(r.u8()), 'renderOrder': r.u8(), 'apexIndex': r.i16()}
                if r.u8(): layout['margin'] = [r.i32() for _ in range(4)]
                layout['overflow'] = r.u8()
                if r.u8(): layout['clipSoftness'] = [r.i32(), r.i32()]
                if version >= 2: layout['scrollItemOnClick'], layout['foldInvisible'] = bool(r.u8()), bool(r.u8())
                else: layout['scrollItemOnClick'], layout['foldInvisible'] = True, False
                if r.pos > end: raise ValueError('truncated list layout')
                child['list'] = layout
                if r.section(begin, 4):
                    layout['pageController'] = r.i16()
                if r.section(begin, 6):
                    layout['selectionController'] = r.i16()
                if layout['overflow'] == 2:
                    if not r.section(begin, 7): raise ValueError('scroll list missing settings')
                    scroll = {'type': r.u8(), 'barDisplay': r.u8(), 'flags': r.i32()}
                    if r.u8(): scroll['barMargin'] = [r.i32() for _ in range(4)]
                    scroll['verticalBar'], scroll['horizontalBar'], scroll['header'], scroll['footer'] = (r.ref() for _ in range(4))
                    layout['scroll'] = scroll
                if not r.section(begin, 8): raise ValueError('list missing items')
                layout['defaultItem'], count = r.ref(), r.i16()
                if count < 0: raise ValueError('invalid list item count')
                layout['items'] = []
                for _ in range(count):
                    length = r.i16(); item_end = r.pos + length
                    if length < 0 or item_end > end: raise ValueError('invalid list item length')
                    entry = {'url': r.ref()}
                    if child['type'] == 17:
                        entry['folder'], entry['level'] = bool(r.u8()), r.u8()
                    entry.update({key: r.ref() for key in ('title', 'selectedTitle', 'icon', 'selectedIcon', 'name')})
                    controller_count = r.i16()
                    if controller_count < 0: raise ValueError('invalid list item controller count')
                    entry['controllers'] = [[r.ref(), r.ref()] for _ in range(controller_count)]
                    if version >= 2:
                        property_count = r.i16()
                        if property_count < 0: raise ValueError('invalid list item property count')
                        entry['properties'] = [[r.ref(), r.i16(), r.ref()] for _ in range(property_count)]
                    else: entry['properties'] = []
                    if r.pos > item_end: raise ValueError('truncated list item')
                    layout['items'].append(entry); r.pos = item_end
                if child['type'] == 17:
                    if not r.section(begin, 9): raise ValueError('tree missing settings')
                    layout['indent'], layout['clickToExpand'] = r.i32(), r.u8()
                    if r.pos > end: raise ValueError('truncated tree settings')
            elif child['type'] == 5:
                if not r.section(begin, 5): raise ValueError('group child missing style section')
                child['layout'], child['lineGap'], child['columnGap'] = r.u8(), r.i32(), r.i32()
                if version >= 2:
                    child['excludeInvisibles'], child['autoSizeDisabled'], child['mainGridIndex'] = bool(r.u8()), bool(r.u8()), r.i16()
                else:
                    child['excludeInvisibles'], child['autoSizeDisabled'], child['mainGridIndex'] = False, False, -1
                if r.pos > end: raise ValueError('truncated group style')
            elif child['type'] == 4:
                if not r.section(begin, 5): raise ValueError('loader child missing style section')
                child['url'] = r.ref()
                child['align'], child['verticalAlign'], child['loaderFill'] = r.u8(), r.u8(), r.u8()
                child['shrinkOnly'], child['autoSize'], child['showErrorSign'], child['playing'] = (bool(r.u8()) for _ in range(4))
                child['frame'] = r.i32()
                if r.u8(): child['color'] = list(r.take(4))
                child['fillMethod'] = r.u8()
                if child['fillMethod']:
                    child['fillOrigin'], child['fillClockwise'] = r.u8(), bool(r.u8())
                    child['fillAmount'] = struct.unpack('>f', r.take(4))[0]
                if r.pos > end: raise ValueError('truncated loader style')
            elif child['type'] == 3:
                if not r.section(begin, 5): raise ValueError('graph child missing style section')
                child['graphType'] = r.u8()
                if child['graphType']:
                    child['lineSize'] = r.i32()
                    child['lineColor'] = list(r.take(4))
                    child['fillColor'] = list(r.take(4))
                    if r.u8(): child['cornerRadius'] = list(struct.unpack('>ffff', r.take(16)))
                    if child['graphType'] == 3:
                        count = r.i16()
                        if count < 0: raise ValueError('invalid polygon point count')
                        child['points'] = list(struct.unpack('>' + 'f' * count, r.take(4 * count)))
                    elif child['graphType'] == 4:
                        child['sides'], child['startAngle'] = r.i16(), struct.unpack('>f', r.take(4))[0]
                        count = r.i16()
                        if count < 0: raise ValueError('invalid polygon distance count')
                        child['distances'] = list(struct.unpack('>' + 'f' * count, r.take(4 * count)))
                if r.pos > end: raise ValueError('truncated graph style')
            elif child['type'] == 1:
                if not r.section(begin, 5): raise ValueError('movieclip child missing style section')
                if r.u8(): child['color'] = list(r.take(4))
                child['flip'], child['frame'], child['playing'] = r.u8(), r.i32(), bool(r.u8())
                if r.pos > end: raise ValueError('truncated movieclip style')
            elif child['type'] == 0:
                if not r.section(begin, 5): raise ValueError('image child missing style section')
                if r.u8(): child['color'] = list(r.take(4))
                child['flip'], child['fillMethod'] = r.u8(), r.u8()
                if child['fillMethod']:
                    child['fillOrigin'], child['fillClockwise'] = r.u8(), bool(r.u8())
                    child['fillAmount'] = struct.unpack('>f', r.take(4))[0]
                if r.pos > end: raise ValueError('truncated image style')
            elif child['type'] == 9 and r.section(begin, 6) and r.pos < end:
                subtype = r.u8()
                if subtype in (14, 15):
                    child['progress' if subtype == 14 else 'slider'] = {'value': r.i32(), 'max': r.i32(), 'min': r.i32() if version >= 2 else 0}
                    if r.pos > end: raise ValueError('truncated component instance settings')
                elif subtype == 11:
                    label = {'title': r.ref(), 'icon': r.ref()}
                    if r.u8(): label['color'] = list(r.take(4))
                    label['fontSize'] = r.i32()
                    if r.u8(): r.take(13)  # input overrides are not decoded here
                    label['sound'] = r.ref()
                    if label['sound'] is not None and r.u8(): label['volume'] = struct.unpack('>f', r.take(4))[0]
                    if r.pos > end: raise ValueError('truncated label instance settings')
                    child['label'] = label
                elif subtype == 12:
                    button = {key: r.ref() for key in ('title', 'selectedTitle', 'icon', 'selectedIcon')}
                    if r.u8(): button['color'] = list(r.take(4))
                    button['fontSize'], button['controller'], button['page'], button['sound'] = r.i32(), r.i16(), r.ref(), r.ref()
                    if r.u8(): button['volume'] = struct.unpack('>f', r.take(4))[0]
                    button['checked'] = bool(r.u8())
                    if r.pos > end: raise ValueError('truncated button instance settings')
                    child['button'] = button
                elif subtype == 13:
                    count = r.i16()
                    if count < 0: raise ValueError('invalid combobox item count')
                    combo = {'items': []}
                    for _ in range(count):
                        length = r.i16(); item_end = r.pos + length
                        if length < 0 or item_end > end: raise ValueError('invalid combobox item size')
                        combo['items'].append({'title': r.ref(), 'value': r.ref(), 'icon': r.ref()})
                        if r.pos > item_end: raise ValueError('truncated combobox item')
                        r.pos = item_end
                    combo['title'], combo['icon'] = r.ref(), r.ref()
                    if r.u8(): combo['color'] = list(r.take(4))
                    combo['visibleItemCount'], combo['popupDirection'], combo['controller'] = r.i32(), r.u8(), r.i16()
                    if r.pos > end: raise ValueError('truncated combobox settings')
                    child['comboBox'] = combo
            children.append(child)
            r.pos = end
    result = {'width': width, 'height': height, 'base': base, 'controllers': controllers, 'children': children}
    if r.section(0, 4):
        settings = {'customData': r.ref(), 'opaque': bool(r.u8()), 'mask': r.i16()}
        if settings['mask'] != -1: settings['reversedMask'] = bool(r.u8())
        settings['hitTest'] = r.ref()
        settings['hitTestOffset'], settings['hitTestChild'] = r.i32(), r.i32()
        result['settings'] = settings
    if base['overflow'] == 2:
        if not r.section(0, 7): raise ValueError('scroll component missing settings')
        scroll = {'type': r.u8(), 'barDisplay': r.u8(), 'flags': r.i32()}
        if r.u8(): scroll['barMargin'] = [r.i32() for _ in range(4)]
        scroll['verticalBar'], scroll['horizontalBar'], scroll['header'], scroll['footer'] = (r.ref() for _ in range(4))
        result['scroll'] = scroll
    if r.section(0, 3):
        relations = read_relations(len(data))
        if relations: result['relations'] = relations
    if r.section(0, 5):
        transitions = []
        count = r.i16()
        if count < 0: raise ValueError('invalid transition count')
        for _ in range(count):
            size = r.i16(); start, end = r.pos, r.pos + size
            if size < 0 or end > len(data): raise ValueError('invalid transition size')
            transition = {'name': r.ref(), 'options': r.i32(), 'autoPlay': bool(r.u8()), 'autoPlayTimes': r.i32(), 'autoPlayDelay': struct.unpack('>f', r.take(4))[0], 'items': []}
            item_count = r.i16()
            if item_count < 0: raise ValueError('invalid transition item count')
            for _ in range(item_count):
                size = r.i16(); item_start, item_end = r.pos, r.pos + size
                if size < 0 or item_end > end or not r.section(item_start, 0): raise ValueError('invalid transition item')
                kind = r.u8()
                item = {'type': kind, 'time': struct.unpack('>f', r.take(4))[0], 'target': r.i16(), 'label': r.ref()}
                tween = bool(r.u8())
                def read_value():
                    if kind in (0, 1, 3, 13):
                        flags = [bool(r.u8()), bool(r.u8())]
                        values = list(struct.unpack('>ff', r.take(8)))
                        return {'flags': flags, 'values': values, **({'percent': bool(r.u8()) if version >= 2 else False} if kind == 0 else {})}
                    if kind in (4, 5): return list(struct.unpack('>f', r.take(4)))
                    if kind in (2, 11): return list(struct.unpack('>ff', r.take(8)))
                    if kind == 6: return list(r.take(4))
                    if kind == 7: return {'playing': bool(r.u8()), 'frame': r.i32()}
                    if kind == 8: return bool(r.u8())
                    if kind == 9: return {'sound': r.ref(), 'volume': struct.unpack('>f', r.take(4))[0]}
                    if kind == 10: return {'name': r.ref(), 'times': r.i32()}
                    if kind == 12: return list(struct.unpack('>ffff', r.take(16)))
                    if kind in (14, 15): return r.ref()
                    raise ValueError('unsupported transition action')
                if tween:
                    if not r.section(item_start, 1): raise ValueError('missing transition tween')
                    item['tween'] = {'duration': struct.unpack('>f', r.take(4))[0], 'ease': r.u8(), 'repeat': r.i32(), 'yoyo': bool(r.u8()), 'endLabel': r.ref()}
                    if not r.section(item_start, 2): raise ValueError('missing transition start value')
                    item['tween']['start'] = read_value()
                    if not r.section(item_start, 3): raise ValueError('missing transition end value')
                    item['tween']['end'] = read_value()
                    if version >= 2:
                        path_count = r.i32()
                        if path_count < 0 or path_count > (item_end - r.pos) // 9: raise ValueError('invalid transition path length')
                        if path_count:
                            path = []
                            for _ in range(path_count):
                                curve = r.u8()
                                if curve > 3: raise ValueError('invalid transition curve type')
                                count = 4 if curve == 1 else 6 if curve == 2 else 2
                                path.append({'curve': curve, 'points': list(struct.unpack('>' + 'f' * count, r.take(4 * count)))})
                            item['tween']['path'] = path
                else:
                    if not r.section(item_start, 2): raise ValueError('missing transition value')
                    item['value'] = read_value()
                if r.pos > item_end: raise ValueError('truncated transition item')
                transition['items'].append(item); r.pos = item_end
            if r.pos > end: raise ValueError('truncated transition')
            transitions.append(transition); r.pos = end
        if transitions: result['transitions'] = transitions
    if extension == 12:
        if not r.section(0, 6): raise ValueError('button missing extension section')
        result['button'] = {'mode': r.u8(), 'sound': r.ref(), 'volume': struct.unpack('>f', r.take(4))[0], 'downEffect': r.u8(), 'downEffectValue': struct.unpack('>f', r.take(4))[0]}
    elif extension == 13:
        if not r.section(0, 6): raise ValueError('combobox missing extension section')
        result['comboBox'] = {'dropdown': r.ref()}
    elif extension in (14, 15):
        if not r.section(0, 6): raise ValueError('progress bar missing extension section')
        result['progressBar' if extension == 14 else 'slider'] = {'titleType': r.u8(), 'reverse': bool(r.u8())}
        if extension == 15 and version >= 2:
            result['slider']['wholeNumbers'], result['slider']['changeOnClick'] = bool(r.u8()), bool(r.u8())
        elif extension == 15:
            result['slider']['wholeNumbers'], result['slider']['changeOnClick'] = False, True
    elif extension == 16:
        if not r.section(0, 6): raise ValueError('scrollbar missing extension section')
        result['scrollBar'] = {'fixedGripSize': bool(r.u8())}
    return result


def inspect(data):
    r = Reader(data)
    if r.take(4) != b'FGUI': raise ValueError('invalid FairyGUI package magic')
    version = r.i32()
    if r.u8(): raise ValueError('compressed packages are not supported')
    package_id, name = r.string(), r.string()
    r.take(20)
    base = r.pos
    if not r.section(base, 4): raise ValueError('missing string table')
    count = r.i32()
    if count < 0 or count > len(data) // 2: raise ValueError('invalid string count')
    r.strings = [r.string() for _ in range(count)]
    if r.section(base, 5):
        count = r.i32()
        if count < 0 or count > len(data) // 6: raise ValueError('invalid long string count')
        for _ in range(count):
            index, size = r.u16(), r.i32()
            if index >= len(r.strings): raise ValueError('invalid long string reference')
            r.strings[index] = r.take(size).decode('utf-8')
    dependencies = []
    if r.section(base, 0):
        count = r.i16()
        if count < 0: raise ValueError('invalid package dependency count')
        dependencies = [{'id': r.ref(), 'name': r.ref()} for _ in range(count)]
    if not r.section(base, 1): raise ValueError('missing item section')
    count = r.i16()
    if count < 0: raise ValueError('invalid item count')
    items = []
    for _ in range(count):
        size = r.i32(); end = r.pos + size
        if size < 0 or end > len(data): raise ValueError('invalid item size')
        kind, item_id, item_name, path, file = r.u8(), r.ref(), r.ref(), r.ref(), r.ref()
        exported, width, height = bool(r.u8()), r.i32(), r.i32()
        if r.pos > end: raise ValueError('truncated item')
        item = {'type': kind, 'id': item_id, 'name': item_name, 'file': file, 'exported': exported, 'width': width, 'height': height}
        if kind == 5:
            length = r.i32()
            if length < 0 or r.pos + length > end: raise ValueError('invalid font payload size')
            font = Reader(r.take(length)); font.strings = r.strings
            if not font.section(0, 0): raise ValueError('missing font settings')
            settings = {'ttf': bool(font.u8()), 'canTint': bool(font.u8()), 'resizable': bool(font.u8()), 'hasChannel': bool(font.u8()), 'fontSize': font.i32(), 'xAdvance': font.i32(), 'lineHeight': font.i32(), 'glyphs': []}
            if not font.section(0, 1): raise ValueError('missing font glyphs')
            count = font.i32()
            if count < 0 or count > 65536: raise ValueError('invalid font glyph count')
            for _ in range(count):
                length = font.i16(); glyph_end = font.pos + length
                if length < 0 or glyph_end > len(font.data): raise ValueError('invalid font glyph size')
                glyph = {'id': font.u16(), 'image': font.ref(), 'x': font.i32(), 'y': font.i32(), 'xOffset': font.i32(), 'yOffset': font.i32(), 'width': font.i32(), 'height': font.i32(), 'xAdvance': font.i32(), 'channel': font.u8()}
                if font.pos > glyph_end: raise ValueError('truncated font glyph')
                settings['glyphs'].append(glyph); font.pos = glyph_end
            item['font'] = settings
        elif kind == 1:
            item['smoothing'] = bool(r.u8())
            length = r.i32()
            if length < 0 or r.pos + length > end: raise ValueError('invalid movieclip payload size')
            clip = Reader(r.take(length)); clip.strings = r.strings
            if not clip.section(0, 0): raise ValueError('missing movieclip timing')
            movie = {'interval': clip.i32(), 'swing': bool(clip.u8()), 'repeatDelay': clip.i32(), 'frames': []}
            if not clip.section(0, 1): raise ValueError('missing movieclip frames')
            frames = clip.i16()
            if frames < 0: raise ValueError('invalid movieclip frame count')
            for _ in range(frames):
                length = clip.i16(); frame_end = clip.pos + length
                if length < 0 or frame_end > len(clip.data): raise ValueError('invalid movieclip frame size')
                frame = {'rect': [clip.i32() for _ in range(4)], 'delay': clip.i32(), 'sprite': clip.ref()}
                if clip.pos > frame_end: raise ValueError('truncated movieclip frame')
                movie['frames'].append(frame); clip.pos = frame_end
            item['movieclip'] = movie
        elif kind == 0:
            scale_option = r.u8()
            if scale_option == 1:
                item['scale9Grid'] = [r.i32() for _ in range(4)]
                item['tileGridIndex'] = r.i32()
            elif scale_option == 2:
                item['scaleByTile'] = True
            elif scale_option != 0: raise ValueError('invalid image scale option')
            item['smoothing'] = bool(r.u8())
            if r.pos > end: raise ValueError('truncated image settings')
        elif kind == 3:
            item['extension'] = r.u8()
            length = r.i32()
            if length < 0 or r.pos + length > end: raise ValueError('invalid component payload size')
            item['component'] = inspect_component(r.take(length), r.strings, item['extension'], version)
        items.append(item)
        r.pos = end
    sprites = []
    if r.section(base, 2):
        count = r.i16()
        if count < 0: raise ValueError('invalid sprite count')
        for _ in range(count):
            size = r.i16(); end = r.pos + size
            if size < 0 or end > len(data): raise ValueError('invalid sprite size')
            sprite = {'id': r.ref(), 'atlas': r.ref(), 'x': r.i32(), 'y': r.i32(), 'width': r.i32(), 'height': r.i32(), 'rotated': bool(r.u8())}
            if version >= 2 and r.u8():
                sprite['offset_x'], sprite['offset_y'], sprite['original_width'], sprite['original_height'] = r.i32(), r.i32(), r.i32(), r.i32()
            if r.pos > end: raise ValueError('truncated sprite')
            sprites.append(sprite); r.pos = end
    hit_tests = []
    if r.section(base, 3):
        count = r.i16()
        if count < 0: raise ValueError('invalid pixel hit test count')
        for _ in range(count):
            size = r.i32(); end = r.pos + size
            if size < 0 or end > len(data): raise ValueError('invalid pixel hit test size')
            test = {'id': r.ref(), 'reserved': r.i32(), 'width': r.i32(), 'divisor': r.u8()}
            length = r.i32()
            if length < 0 or r.pos + length > end or test['width'] <= 0 or test['divisor'] == 0: raise ValueError('invalid pixel hit test data')
            test['pixels'] = r.take(length).hex()
            hit_tests.append(test); r.pos = end
    return {'version': version, 'id': package_id, 'name': name, 'dependencies': dependencies, 'items': items, 'sprites': sprites, 'hitTests': hit_tests, 'scope': 'item metadata and component child headers; remaining component data and texture pixels not verified'}


def validate_atlases(info, package_file, check_overlaps=False):
    """Validate registrations and geometry; optionally reject partial overlaps.

    Identical rectangles are allowed as texture aliases. General FairyGUI
    packages may intentionally share partial regions, so overlap checks are
    optional for external packages but used for our own generated layouts.
    """
    from pathlib import Path
    from PIL import Image
    package_file = Path(package_file)
    issues, sizes = [], {}
    item_ids = set()
    for item in info['items']:
        ident = item.get('id')
        if not ident or ident in item_ids:
            issues.append({'item': ident, 'error': 'missing or duplicate item id'})
        item_ids.add(ident)
    atlases = [item for item in info['items'] if item['type'] == 4]
    seen = set()
    for item in atlases:
        ident, filename = item['id'], item['file']
        if not ident or ident in seen:
            issues.append({'atlas': ident, 'error': 'missing or duplicate atlas id'})
            continue
        seen.add(ident)
        if not filename:
            issues.append({'atlas': ident, 'error': 'missing atlas filename'})
            continue
        # Cocos resolves the basename relative to the package's load path.
        basename = filename.replace('\\', '/').split('/')[-1]
        path = package_file.parent / (package_file.stem + '_' + basename)
        try:
            with Image.open(path) as image:
                image.verify()
            with Image.open(path) as image:
                sizes[ident] = image.size
                if image.size != (item['width'], item['height']):
                    issues.append({'atlas': ident, 'error': 'atlas dimensions differ from package metadata', 'actual': list(image.size), 'declared': [item['width'], item['height']]})
        except (OSError, ValueError) as exc:
            issues.append({'atlas': ident, 'file': str(path), 'error': str(exc)})
    sprite_ids, rectangles = set(), {}
    for sprite in info['sprites']:
        sprite_id = sprite['id']
        if not sprite_id or sprite_id in sprite_ids:
            issues.append({'sprite': sprite_id, 'error': 'missing or duplicate sprite id'})
        sprite_ids.add(sprite_id)
        width, height = sprite['width'], sprite['height']
        if 'original_width' in sprite:
            ox, oy = sprite['offset_x'], sprite['offset_y']
            ow, oh = sprite['original_width'], sprite['original_height']
            if ox < 0 or oy < 0 or ow <= 0 or oh <= 0 or ox + width > ow or oy + height > oh:
                issues.append({'sprite': sprite_id, 'error': 'invalid trimmed sprite geometry'})
        ident = sprite['atlas']
        if ident not in seen:
            issues.append({'sprite': sprite['id'], 'error': f'unknown atlas {ident}'})
            continue
        if ident not in sizes: continue
        w, h = sprite['width'], sprite['height']
        if sprite['rotated']: w, h = h, w
        x, y = sprite['x'], sprite['y']
        aw, ah = sizes[ident]
        if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > aw or y + h > ah:
            issues.append({'sprite': sprite['id'], 'atlas': ident, 'error': 'sprite rectangle outside atlas'})
        elif check_overlaps:
            rectangles.setdefault(ident, []).append((x, y, w, h, sprite_id))
    if check_overlaps:
        overlap_count = 0
        truncated = False
        for atlas, entries in rectangles.items():
            active, unique = [], set()
            for x, y, w, h, sprite_id in sorted(entries, key=lambda entry: entry[:4]):
                rect = (x, y, w, h)
                if rect in unique: continue
                unique.add(rect)
                active = [entry for entry in active if entry[0] + entry[2] > x]
                for ox, oy, ow, oh, other_id in active:
                    if y < oy + oh and oy < y + h:
                        if overlap_count >= 100:
                            truncated = True
                            break
                        issues.append({'atlas': atlas, 'sprite': sprite_id, 'other_sprite': other_id, 'error': 'partially overlapping sprite rectangles'})
                        overlap_count += 1
                if truncated: break
                active.append((x, y, w, h, sprite_id))
            if truncated: break
        if truncated: issues.append({'error': 'additional sprite overlaps omitted after 100 reports'})
    for item in info['items']:
        if item['type'] == 0 and item['id'] not in sprite_ids:
            issues.append({'item': item['id'], 'error': 'image has no sprite'})
        elif item['type'] == 1:
            for frame in item['movieclip']['frames']:
                if frame['sprite'] is not None and frame['sprite'] not in sprite_ids:
                    issues.append({'item': item['id'], 'sprite': frame['sprite'], 'error': 'movieclip frame sprite missing'})
        elif item['type'] == 5:
            if item['font']['ttf'] and item['id'] not in sprite_ids:
                issues.append({'item': item['id'], 'error': 'bitmap font texture sprite missing'})
            for glyph in item['font']['glyphs']:
                if glyph['image'] is not None and glyph['image'] not in sprite_ids:
                    issues.append({'item': item['id'], 'sprite': glyph['image'], 'error': 'bitmap font glyph sprite missing'})
    hit_ids = set()
    image_ids = {item['id'] for item in info['items'] if item['type'] == 0}
    for hit in info.get('hitTests', []):
        ident = hit['id']
        if ident not in image_ids or ident in hit_ids:
            issues.append({'item': ident, 'error': 'unknown or duplicate pixel hit test image'})
        hit_ids.add(ident)
    dependency_ids = {entry['id'] for entry in info.get('dependencies', [])}
    for item in info['items']:
        if item['type'] == 3:
            for child in item['component'].get('children', []):
                if child.get('pkg') and child['pkg'] not in dependency_ids:
                    issues.append({'item': item['id'], 'child': child['id'], 'error': 'missing package dependency', 'package': child['pkg']})
            hit_id = item['component'].get('settings', {}).get('hitTest')
            if hit_id is not None and hit_id not in hit_ids:
                issues.append({'item': item['id'], 'error': 'missing pixel hit test data', 'image': hit_id})
    return {'valid': not issues, 'issues': issues, 'atlas_count': len(atlases), 'sprite_count': len(info['sprites']), 'overlaps_checked': check_overlaps, 'scope': 'item and sprite IDs, image sprite presence, atlas files and sprite bounds' + (', partial sprite overlaps' if check_overlaps else '') + '; component semantics and pixel fidelity not verified'}


def compare_source_images(info, package_file, sources):
    """Compare registered image sprites, including trim and clockwise rotation."""
    from pathlib import Path
    from PIL import Image, ImageChops
    package_file = Path(package_file)
    atlas_items = {item['id']: item for item in info['items'] if item['type'] == 4}
    sprites = {sprite['id']: sprite for sprite in info['sprites']}
    issues, skipped, checked = [], [], 0
    # Process images in atlas order so each page is decoded only once.
    ordered = sorted(sources.items(), key=lambda pair: str(sprites.get(pair[0], {}).get('atlas', '')))
    sheet = None
    sheet_key = None
    for ident, source_path in ordered:
        sprite = sprites.get(ident)
        if not sprite:
            skipped.append({'id': ident, 'reason': 'no sprite in published package'})
            continue
        try:
            atlas = atlas_items[sprite['atlas']]
            filename = atlas['file'].replace('\\', '/').split('/')[-1]
            atlas_path = package_file.parent / (package_file.stem + '_' + filename)
            x, y, w, h = (sprite[k] for k in ('x', 'y', 'width', 'height'))
            if sheet_key != atlas_path:
                if sheet is not None: sheet.close()
                sheet, sheet_key = None, None
                with Image.open(atlas_path) as atlas_file:
                    sheet = atlas_file.convert('RGBA')
                sheet_key = atlas_path
            with Image.open(source_path) as source_file:
                source = source_file.convert('RGBA')
                if source.size != (sprite.get('original_width', w), sprite.get('original_height', h)):
                    raise ValueError('source dimensions differ from published original size')
                offset_x, offset_y = sprite.get('offset_x', 0), sprite.get('offset_y', 0)
                if offset_x < 0 or offset_y < 0 or offset_x + w > source.width or offset_y + h > source.height:
                    raise ValueError('trim rectangle outside source image')
                alpha = source.getchannel('A')
                # A crop that matches can still silently discard visible source
                # pixels. Check all four regions outside the declared trim.
                outside = [(0, 0, source.width, offset_y),
                           (0, offset_y + h, source.width, source.height),
                           (0, offset_y, offset_x, offset_y + h),
                           (offset_x + w, offset_y, source.width, offset_y + h)]
                if any(right > left and bottom > top and alpha.crop((left, top, right, bottom)).getbbox()
                       for left, top, right, bottom in outside):
                    raise ValueError('trimmed region contains visible source pixels')
                expected = source.crop((offset_x, offset_y, offset_x + w, offset_y + h))
                rw, rh = (h, w) if sprite['rotated'] else (w, h)
                actual = sheet.crop((x, y, x + rw, y + rh))
                if sprite['rotated']: actual = actual.transpose(Image.Transpose.ROTATE_90)
                if ImageChops.difference(expected, actual).getbbox(alpha_only=False):
                    raise ValueError('sprite pixels differ from source')
                checked += 1
        except (OSError, ValueError, KeyError, AttributeError) as exc:
            issues.append({'id': ident, 'error': str(exc)})
    if sheet is not None: sheet.close()
    return {'checked': checked, 'skipped': skipped, 'issues': issues, 'scope': 'exact RGBA comparison of registered image sprites; other resource types excluded'}


def compare_image_settings(info, entries):
    """Compare the supported published image settings with package.xml."""
    images = {item['id']: item for item in info['items'] if item['type'] == 0}
    issues, checked = [], 0
    for entry in entries:
        ident = entry.get('id')
        actual = images.get(ident)
        if actual is None:
            issues.append({'id': ident, 'error': 'image absent from published package'})
            continue
        scale = entry.get('scale') or ''
        try:
            if scale not in ('', 'tile', '9grid'): raise ValueError('unsupported source image scale setting')
            grid = [int(v) for v in entry.get('scale9grid', '').split(',')] if scale == '9grid' else None
            if grid is not None and len(grid) != 4: raise ValueError('invalid source image scale9grid')
            if actual.get('scale9Grid') != grid or actual.get('scaleByTile', False) != (scale == 'tile'):
                issues.append({'id': ident, 'error': 'image scale setting differs', 'source': {'scale': scale, 'scale9Grid': grid}, 'published': {'scale9Grid': actual.get('scale9Grid'), 'scaleByTile': actual.get('scaleByTile', False)}})
            if entry.get('exported', 'false') not in ('true', 'false'): raise ValueError('invalid exported flag')
            if actual['exported'] != (entry.get('exported') == 'true'):
                issues.append({'id': ident, 'error': 'image exported flag differs'})
            checked += 1
        except ValueError as exc:
            issues.append({'id': ident, 'error': str(exc)})
    return {'checked': checked, 'issues': issues, 'scope': 'image scale mode, nine-slice rectangle and exported flag'}


def compare_source_sounds(info, package_file, sources):
    """Compare sound files in bounded chunks without decoding audio."""
    from pathlib import Path
    package_file = Path(package_file)
    sounds = {item['id']: item for item in info['items'] if item['type'] == 2}
    issues, checked = [], 0
    for ident, source in sources.items():
        item = sounds.get(ident)
        if item is None:
            issues.append({'id': ident, 'error': 'sound absent from published package'})
            continue
        try:
            filename = item['file'].replace('\\', '/').split('/')[-1]
            target = package_file.parent / (package_file.stem + '_' + filename)
            with open(source, 'rb') as a, open(target, 'rb') as b:
                while True:
                    left, right = a.read(1048576), b.read(1048576)
                    if left != right: raise ValueError('published sound bytes differ from source')
                    if not left: break
            checked += 1
        except (OSError, ValueError, KeyError, AttributeError) as exc:
            issues.append({'id': ident, 'error': str(exc)})
    return {'checked': checked, 'issues': issues, 'scope': 'exact sound file byte comparison; audio decoding not verified'}


def compare_source_movieclips(info, package_file, sources):
    """Check supported JTA timing, frame geometry and frame pixels."""
    from pathlib import Path
    from PIL import Image, ImageChops
    from jta import read_jta
    package_file = Path(package_file)
    clips = {item['id']: item for item in info['items'] if item['type'] == 1}
    atlases = {item['id']: item for item in info['items'] if item['type'] == 4}
    sprites = {sprite['id']: sprite for sprite in info['sprites']}
    checked, checked_frames, issues = 0, 0, []
    for ident, source in sources.items():
        if ident not in clips:
            issues.append({'id': ident, 'error': 'movieclip absent from published package'})
            continue
        jta = None
        try:
            jta = read_jta(Path(source).read_bytes())
            clip = clips[ident]
            if (clip['width'], clip['height'], clip['movieclip']['interval'], len(clip['movieclip']['frames'])) != (jta['width'], jta['height'], jta['interval'], len(jta['frames'])):
                raise ValueError('movieclip dimensions, timing or frame count differ')
            sheet_id, sheet = None, None
            try:
                for original, frame in zip(jta['frames'], clip['movieclip']['frames']):
                    if (frame['rect'], frame['delay']) != (original['rect'], original['delay']): raise ValueError('movieclip frame geometry or timing differs')
                    sprite = sprites[frame['sprite']]
                    if sprite['atlas'] != sheet_id:
                        if sheet is not None: sheet.close()
                        sheet = None
                        atlas = atlases[sprite['atlas']]
                        basename = atlas['file'].replace('\\', '/').split('/')[-1]
                        with Image.open(package_file.parent / (package_file.stem + '_' + basename)) as file:
                            sheet = file.convert('RGBA')
                        sheet_id = sprite['atlas']
                    x, y, w, h = (sprite[key] for key in ('x', 'y', 'width', 'height'))
                    rw, rh = (h, w) if sprite['rotated'] else (w, h)
                    actual = sheet.crop((x, y, x + rw, y + rh))
                    if sprite['rotated']: actual = actual.transpose(Image.Transpose.ROTATE_90)
                    source_frame = jta['images'][original['imageIndex']]
                    if actual.size != source_frame.size or ImageChops.difference(actual, source_frame).getbbox(alpha_only=False):
                        raise ValueError('movieclip frame pixels differ')
                    checked_frames += 1
            finally:
                if sheet is not None: sheet.close()
            checked += 1
        except (OSError, ValueError, KeyError, IndexError, AttributeError) as exc:
            issues.append({'id': ident, 'error': str(exc)})
        finally:
            if jta is not None:
                for image in jta['images']: image.close()
    return {'checked': checked, 'checked_frames': checked_frames, 'issues': issues, 'scope': 'JTA v102 frame timing, rectangles and exact frame pixels'}


def compare_source_fonts(info, sources):
    """Check supported bitmap font metadata, glyphs and texture aliases."""
    from pathlib import Path
    from bitmap_font import read_bitmap_font
    fonts = {item['id']: item for item in info['items'] if item['type'] == 5}
    sprites = {item['id']: item for item in info['sprites']}
    checked, issues = 0, []
    for ident, (path, texture) in sources.items():
        if ident not in fonts:
            issues.append({'id': ident, 'error': 'bitmap font absent from published package'})
            continue
        try:
            expected = read_bitmap_font(Path(path).read_bytes(), texture)
            expected.pop('texture')
            if expected != fonts[ident]['font']: raise ValueError('bitmap font settings or glyphs differ')
            if texture:
                actual_sprite, texture_sprite = sprites[ident], sprites[texture]
                if any(actual_sprite.get(key) != texture_sprite.get(key) for key in ('atlas', 'x', 'y', 'width', 'height', 'rotated', 'offset_x', 'offset_y', 'original_width', 'original_height')):
                    raise ValueError('bitmap font texture sprite differs')
            checked += 1
        except (OSError, ValueError, KeyError) as exc:
            issues.append({'id': ident, 'error': str(exc)})
    return {'checked': checked, 'issues': issues, 'scope': 'bitmap font settings, glyph records and texture aliases'}


def compare_source_pixel_hits(info, sources):
    """Check masks against the supported source alpha sampling algorithm."""
    from PIL import Image
    from pixel_hits import make_pixel_mask
    checked, issues, skipped = 0, [], []
    for hit in info.get('hitTests', []):
        ident = hit['id']
        if ident not in sources:
            issues.append({'id': ident, 'error': 'pixel hit source image missing'})
            continue
        if hit['divisor'] not in (1, 2):
            skipped.append({'id': ident, 'reason': 'pixel hit sampling divisor is unsupported'})
            continue
        try:
            with Image.open(sources[ident]) as image:
                image = image.convert('RGBA')
                expected = make_pixel_mask(image, hit['divisor'])
                if expected['width'] != hit['width']: raise ValueError('pixel hit width differs from source')
                if expected['pixels'] != bytes.fromhex(hit['pixels']): raise ValueError('pixel hit mask differs from source alpha')
                checked += 1
        except (OSError, ValueError, KeyError) as exc:
            issues.append({'id': ident, 'error': str(exc)})
    return {'checked': checked, 'issues': issues, 'skipped': skipped, 'scope': 'alpha threshold masks at supported resolutions; exact editor parity not guaranteed'}


def compare_source_components(info, sources, package_aliases=None):
    """Compare stable child IDs/order and component size, not full semantics."""
    import xml.etree.ElementTree as ET
    import math
    components = {item['id']: item for item in info['items'] if item['type'] == 3}
    checked, skipped, issues = 0, [], []
    for ident, file in sources.items():
        item = components.get(ident)
        if item is None:
            skipped.append({'id': ident, 'reason': 'component absent from published package'})
            continue
        try:
            root = ET.parse(file).getroot()
            if root.tag != 'component': raise ValueError('invalid component XML root')
            actual_ids = [child['id'] for child in item['component']['children']]
            # Editor-only organizational groups can be omitted in published
            # data; compare a group when it is present in the published list.
            child_ids = [child.get('id') for child in root.findall('./displayList/*')
                         if child.tag != 'group' or child.get('id') in actual_ids]
            if child_ids != actual_ids:
                issues.append({'id': ident, 'error': 'display-list child IDs or order differ', 'source': child_ids, 'published': actual_ids})
            published_children = {child['id']: child for child in item['component']['children']}
            for child in root.findall('./displayList/*'):
                actual = published_children.get(child.get('id'))
                if actual is None: continue
                expected_type = {'image': 0, 'movieclip': 1, 'jta': 1, 'graph': 3, 'loader': 4, 'group': 5, 'text': 6, 'richtext': 7, 'component': 9}.get(child.tag)
                if child.tag == 'inputtext' or (child.tag == 'text' and child.get('input') == 'true'): expected_type = 8
                if child.tag == 'list': expected_type = 17 if child.get('treeView') == 'true' else 10
                if expected_type is not None and actual.get('type') != expected_type:
                    issues.append({'id': ident, 'child': child.get('id'), 'error': 'object type differs', 'source': expected_type, 'published': actual.get('type')})
                source_package = child.get('pkg') or None
                if source_package and package_aliases is not None:
                    source_package = package_aliases.get(source_package, source_package)
                    if source_package == info['id']: source_package = None
                if source_package != actual.get('pkg'):
                    issues.append({'id': ident, 'child': child.get('id'), 'error': 'package reference differs', 'source': source_package, 'published': actual.get('pkg')})
                source_ref = child.get('src') or None
                if source_ref != actual.get('src'):
                    issues.append({'id': ident, 'child': child.get('id'), 'error': 'resource reference differs', 'source': source_ref, 'published': actual.get('src')})
                if child.get('xy'):
                    position = [int(part.strip()) for part in child.get('xy').split(',')]
                    if position != [actual['x'], actual['y']]:
                        issues.append({'id': ident, 'child': child.get('id'), 'error': 'position differs', 'source': position, 'published': [actual['x'], actual['y']]})
                for key in ('size', 'scale', 'pivot'):
                    if key not in child.attrib: continue
                    expected = [float(v) for v in child.get(key).split(',')]
                    published = actual.get(key)
                    if published is None or len(expected) != len(published[:2]) or any(not math.isclose(a, b, abs_tol=1e-5) for a, b in zip(expected, published[:2])):
                        issues.append({'id': ident, 'child': child.get('id'), 'error': f'{key} differs', 'source': expected, 'published': published})
                if 'anchor' in child.attrib and (len(actual.get('pivot', [])) < 3 or (child.get('anchor') == 'true') != actual['pivot'][2]):
                    issues.append({'id': ident, 'child': child.get('id'), 'error': 'anchor differs'})
                for key in ('alpha', 'rotation'):
                    if key in child.attrib and not math.isclose(float(child.get(key)), actual.get(key, 1 if key == 'alpha' else 0), abs_tol=1e-5):
                        issues.append({'id': ident, 'child': child.get('id'), 'error': f'{key} differs', 'source': child.get(key), 'published': actual.get(key)})
                for key in ('visible', 'touchable', 'grayed'):
                    if key in child.attrib and child.get(key) in ('true', 'false') and (child.get(key) == 'true') != actual.get(key):
                        issues.append({'id': ident, 'child': child.get('id'), 'error': f'{key} differs', 'source': child.get(key), 'published': actual.get(key)})
                for tag, field in [('ProgressBar', 'progress'), ('Slider', 'slider')]:
                    progress = child.find(tag)
                    if progress is not None:
                        expected_progress = {key: int(progress.get(key, default)) for key, default in [('value', '50'), ('max', '100'), ('min', '0')]}
                        if actual.get(field) != expected_progress:
                            issues.append({'id': ident, 'child': child.get('id'), 'error': f'{field} values differ', 'source': expected_progress, 'published': actual.get(field)})
                button = child.find('Button')
                if button is not None:
                    published_button = actual.get('button')
                    if published_button is None:
                        issues.append({'id': ident, 'child': child.get('id'), 'error': 'button instance settings absent'})
                    else:
                        for key in ('title', 'selectedTitle', 'icon', 'selectedIcon'):
                            if key in button.attrib and button.get(key) != published_button.get(key):
                                issues.append({'id': ident, 'child': child.get('id'), 'error': f'button {key} differs', 'source': button.get(key), 'published': published_button.get(key)})
                        if 'checked' in button.attrib and (button.get('checked') == 'true') != published_button.get('checked'):
                            issues.append({'id': ident, 'child': child.get('id'), 'error': 'button checked differs'})
                combo = child.find('ComboBox')
                if combo is not None:
                    published_combo = actual.get('comboBox')
                    expected_items = [{key: entry.get(key) for key in ('title', 'value', 'icon')} for entry in combo.findall('item')]
                    if published_combo is None or published_combo['items'] != expected_items:
                        issues.append({'id': ident, 'child': child.get('id'), 'error': 'ComboBox items differ'})
                    if published_combo is not None and 'visibleItemCount' in combo.attrib and int(combo.get('visibleItemCount')) != published_combo['visibleItemCount']:
                        issues.append({'id': ident, 'child': child.get('id'), 'error': 'ComboBox visible item count differs'})
                if child.tag in ('text', 'richtext', 'inputtext') and actual.get('type') in (6, 7, 8):
                    for key in ('text', 'fontSize'):
                        if key not in child.attrib: continue
                        value = int(child.get(key)) if key == 'fontSize' else child.get(key)
                        actual_value = actual.get(key)
                        if key == 'text' and actual_value is None: actual_value = ''
                        if value != actual_value:
                            issues.append({'id': ident, 'child': child.get('id'), 'error': f'{key} differs', 'source': value, 'published': actual.get(key)})
                    if 'font' in child.attrib and (child.get('font') or None) != actual.get('font'):
                        issues.append({'id': ident, 'child': child.get('id'), 'error': 'font differs', 'source': child.get('font'), 'published': actual.get('font')})
                    for source_key, binary_key in (('strokeColor', 'strokeColor'), ('shadowColor', 'shadowColor')):
                        color_value = child.get(source_key)
                        if color_value and len(color_value) == 7 and color_value.startswith('#'):
                            expected_color = [int(color_value[index:index+2], 16) for index in (1, 3, 5)] + [255]
                            if expected_color != actual.get(binary_key):
                                issues.append({'id': ident, 'child': child.get('id'), 'error': source_key + ' differs', 'source': expected_color, 'published': actual.get(binary_key)})
                    if 'shadowOffset' in child.attrib:
                        offset = [float(part) for part in child.get('shadowOffset').split(',')]
                        published_offset = actual.get('shadowOffset')
                        if published_offset is None or len(offset) != len(published_offset) or any(not math.isclose(a, b, abs_tol=1e-5) for a, b in zip(offset, published_offset)):
                            issues.append({'id': ident, 'child': child.get('id'), 'error': 'shadowOffset differs', 'source': offset, 'published': published_offset})
                    color = child.get('color')
                    if color and len(color) == 7 and color.startswith('#'):
                        rgb = [int(color[i:i+2], 16) for i in (1, 3, 5)]
                        if rgb != actual['color'][:3]:
                            issues.append({'id': ident, 'child': child.get('id'), 'error': 'text color differs', 'source': rgb, 'published': actual['color'][:3]})
                    for key, binary_key, mapping in [
                        ('align', 'align', {'left': 0, 'center': 1, 'right': 2}),
                        ('vAlign', 'verticalAlign', {'top': 0, 'middle': 1, 'bottom': 2}),
                        ('autoSize', 'autoSize', {'none': 0, 'both': 1, 'height': 2, 'shrink': 3}),
                    ]:
                        if key in child.attrib and child.get(key) in mapping and mapping[child.get(key)] != actual.get(binary_key):
                            issues.append({'id': ident, 'child': child.get('id'), 'error': f'{key} differs', 'source': child.get(key), 'published': actual.get(binary_key)})
                    for key in ('leading', 'letterSpacing'):
                        if key in child.attrib and int(child.get(key)) != actual.get(key):
                            issues.append({'id': ident, 'child': child.get('id'), 'error': f'{key} differs', 'source': child.get(key), 'published': actual.get(key)})
                    for key in ('underline', 'italic', 'bold', 'singleLine', 'ubb'):
                        if key in child.attrib and child.get(key) in ('true', 'false') and (child.get(key) == 'true') != actual.get(key):
                            issues.append({'id': ident, 'child': child.get('id'), 'error': f'{key} differs', 'source': child.get(key), 'published': actual.get(key)})
                if child.tag in ('image', 'loader') and actual.get('type') in (0, 4):
                    if 'color' in child.attrib and len(child.get('color')) == 7 and child.get('color').startswith('#'):
                        expected_color = [int(child.get('color')[index:index+2], 16) for index in (1, 3, 5)] + [255]
                        if actual.get('color') != expected_color:
                            issues.append({'id': ident, 'child': child.get('id'), 'error': 'image color differs', 'source': expected_color, 'published': actual.get('color')})
                    if child.tag == 'image' and 'flip' in child.attrib:
                        flips = {'none': 0, 'hz': 1, 'vt': 2, 'both': 3}
                        if child.get('flip') in flips and actual.get('flip') != flips[child.get('flip')]:
                            issues.append({'id': ident, 'child': child.get('id'), 'error': 'image flip differs'})
                    if 'fillMethod' in child.attrib:
                        fills = {'none': 0, 'hz': 1, 'vt': 2, 'radial90': 3, 'radial180': 4, 'radial360': 5}
                        if child.get('fillMethod') in fills and actual.get('fillMethod') != fills[child.get('fillMethod')]:
                            issues.append({'id': ident, 'child': child.get('id'), 'error': 'image fillMethod differs'})
                    if 'fillClockwise' in child.attrib and (child.get('fillClockwise') == 'true') != actual.get('fillClockwise'):
                        issues.append({'id': ident, 'child': child.get('id'), 'error': 'image fillClockwise differs'})
                    if 'fillAmount' in child.attrib and not math.isclose(float(child.get('fillAmount')) / 100, actual.get('fillAmount', -1), abs_tol=1e-5):
                        issues.append({'id': ident, 'child': child.get('id'), 'error': 'image fillAmount differs'})
                if child.tag == 'graph' and actual.get('type') == 3:
                    kinds = {'rect': 1, 'eclipse': 2, 'polygon': 3, 'regular_polygon': 4}
                    if 'type' in child.attrib and child.get('type') in kinds and actual.get('graphType') != kinds[child.get('type')]:
                        issues.append({'id': ident, 'child': child.get('id'), 'error': 'graph type differs'})
                    if 'lineSize' in child.attrib and int(child.get('lineSize')) != actual.get('lineSize'):
                        issues.append({'id': ident, 'child': child.get('id'), 'error': 'graph lineSize differs'})
                    for key in ('lineColor', 'fillColor'):
                        value = child.get(key)
                        if value and len(value) == 9 and value.startswith('#'):
                            color = [int(value[index:index+2], 16) for index in (3, 5, 7, 1)]
                            if color != actual.get(key):
                                issues.append({'id': ident, 'child': child.get('id'), 'error': 'graph ' + key + ' differs'})
                if child.tag in ('movieclip', 'jta') and actual.get('type') == 1:
                    if 'frame' in child.attrib and int(child.get('frame')) != actual.get('frame'):
                        issues.append({'id': ident, 'child': child.get('id'), 'error': 'movieclip frame differs'})
                    if 'playing' in child.attrib and (child.get('playing') == 'true') != actual.get('playing'):
                        issues.append({'id': ident, 'child': child.get('id'), 'error': 'movieclip playing differs'})
                if expected_type == 8 and actual.get('type') == 8:
                    settings = actual['input']
                    for key in ('prompt', 'restrict'):
                        if key in child.attrib and child.get(key) != settings[key]:
                            issues.append({'id': ident, 'child': child.get('id'), 'error': f'input {key} differs'})
                    for key in ('maxLength', 'keyboardType'):
                        if key in child.attrib and int(child.get(key)) != settings[key]:
                            issues.append({'id': ident, 'child': child.get('id'), 'error': f'input {key} differs'})
                    if 'password' in child.attrib and (child.get('password') == 'true') != settings['password']:
                        issues.append({'id': ident, 'child': child.get('id'), 'error': 'input password differs'})
                if expected_type in (10, 17) and actual.get('type') == expected_type:
                    source_items = child.findall('item')
                    actual_items = actual['list']['items']
                    if len(source_items) != len(actual_items):
                        issues.append({'id': ident, 'child': child.get('id'), 'error': 'list item count differs'})
                    else:
                        for index, (source_item, actual_item) in enumerate(zip(source_items, actual_items)):
                            for key in ('url', 'title', 'selectedTitle', 'icon', 'selectedIcon', 'name'):
                                if (source_item.get(key) or None) != actual_item.get(key):
                                    issues.append({'id': ident, 'child': child.get('id'), 'item': index, 'error': f'list item {key} differs'})
                            if expected_type == 17 and int(source_item.get('level', '0')) != actual_item.get('level'):
                                issues.append({'id': ident, 'child': child.get('id'), 'item': index, 'error': 'tree item level differs'})
            if root.get('size'):
                size = [int(x.strip()) for x in root.get('size').split(',')]
                if size != [item['component']['width'], item['component']['height']]:
                    issues.append({'id': ident, 'error': 'component dimensions differ', 'source': size, 'published': [item['component']['width'], item['component']['height']]})
            if root.get('extention') == 'ComboBox':
                combo = root.find('ComboBox')
                dropdown = combo.get('dropdown') or None if combo is not None else None
                if item['component'].get('comboBox', {}).get('dropdown') != dropdown:
                    issues.append({'id': ident, 'error': 'ComboBox dropdown differs'})
            checked += 1
        except (OSError, ValueError, ET.ParseError, KeyError) as exc:
            issues.append({'id': ident, 'error': str(exc)})
    return {'checked': checked, 'skipped': skipped, 'issues': issues, 'scope': 'component dimensions, child IDs/order, references, explicit transforms, text style, selected image and graph properties; not full semantics'}
