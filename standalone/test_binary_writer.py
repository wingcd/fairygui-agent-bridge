import unittest
import json
import os
from pathlib import Path
import subprocess
import tempfile
from atlas import pack, plan
from binary_writer import encode_image_package
from published import inspect


class WriterTest(unittest.TestCase):
    def test_image_package_metadata(self):
        images = [{'id': 'abcde', 'name': 'icon', 'width': 7, 'height': 5, 'exported': True}, {'id': 'fghij', 'name': '背景', 'width': 3, 'height': 8}]
        pages = pack(images, 32, 32, 1)
        blob = encode_image_package('12345678', 'Demo', images, pages)
        metadata = inspect(blob)
        self.assertEqual((metadata['id'], metadata['name'], metadata['version']), ('12345678', 'Demo', 1))
        self.assertEqual([(x['id'], x['name'], x['exported']) for x in metadata['items'] if x['type'] == 0], [('abcde', 'icon', True), ('fghij', '背景', False)])
        self.assertEqual({x['id'] for x in metadata['sprites']}, {'abcde', 'fghij'})
        self.assertEqual(blob, encode_image_package('12345678', 'Demo', images, pages))

    def test_invalid_layout_rejected(self):
        with self.assertRaises(ValueError):
            encode_image_package('12345678', 'Demo', [{'id': 'a', 'width': 1, 'height': 1}], [])

    def test_image_child_headers_roundtrip(self):
        images = [{'id': 'abcde', 'name': 'icon', 'width': 7, 'height': 5}]
        components = [{'id': 'comp1', 'name': 'Main', 'width': 123, 'height': 77,
                       'children': [{'id': 'n0', 'name': 'picture', 'src': 'abcde', 'x': 10, 'y': 20}]}]
        info = inspect(encode_image_package('12345678', 'Demo', images, pack(images, 32, 32), components))
        child = next(item for item in info['items'] if item['type'] == 3)['component']['children'][0]
        self.assertEqual({k: child[k] for k in ('type', 'src', 'pkg', 'id', 'name', 'x', 'y', 'flip', 'fillMethod')}, {'type': 0, 'src': 'abcde', 'pkg': None, 'id': 'n0', 'name': 'picture', 'x': 10, 'y': 20, 'flip': 0, 'fillMethod': 0})

    def test_actual_cocos_package_reader_when_available(self):
        build = Path(os.environ.get('FGUI_COCOS_BUILD', 'E:/game_dev/FairyGUI-cocoscreator/source/build'))
        if not (build / 'UIPackage.js').is_file():
            self.skipTest('Cocos build not available; set FGUI_COCOS_BUILD')
        images = [{'id': 'abcde', 'name': 'icon', 'width': 7, 'height': 5, 'exported': True, 'scale9grid': [1, 1, 3, 2]}]
        images.append({'id': 'tile1', 'name': 'tile', 'width': 3, 'height': 3, 'scaleByTile': True})
        frames = [{'id': 'clip1_0', 'width': 3, 'height': 2, 'rect': [1, 2, 3, 2], 'delay': 83}]
        movieclips = [{'id': 'clip1', 'name': 'clip', 'width': 5, 'height': 6, 'interval': 125, 'frames': frames}]
        glyph = {'id': 65, 'image': 'abcde', 'x': 0, 'y': 0, 'xOffset': 1, 'yOffset': 2, 'width': 0, 'height': 0, 'xAdvance': 8, 'channel': 0}
        fonts = [{'id': 'font1', 'name': 'font', 'ttf': False, 'canTint': True, 'resizable': False, 'hasChannel': False, 'fontSize': 12, 'xAdvance': 0, 'lineHeight': 14, 'glyphs': [glyph]}, {'id': 'font2', 'name': 'ttf', 'ttf': True, 'texture': 'tile1', 'canTint': True, 'resizable': False, 'hasChannel': False, 'fontSize': 16, 'xAdvance': 0, 'lineHeight': 18, 'glyphs': [{**glyph, 'image': None, 'x': 1, 'y': 1, 'width': 1, 'height': 1}]}]
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'Demo.bin'
            components = [{'id': 'comp1', 'name': 'Main', 'width': 123, 'height': 77, 'exported': True, 'children': [{'id': 'n0', 'name': 'picture', 'src': 'abcde', 'x': 10, 'y': 20, 'size': [30,40], 'scale': [2, 3], 'alpha': 0.5, 'rotation': 45, 'visible': False, 'touchable': False}, {'type': 'text', 'id': 'n1', 'name': 'label', 'x': 3, 'y': 4, 'text': '你好', 'fontSize': 18, 'color': (10, 20, 30, 255)}]}]
            components[0]['children'][1].update({'align': 1, 'vAlign': 2, 'leading': 5, 'letterSpacing': 2, 'autoSize': 0, 'bold': True, 'italic': True, 'strokeColor': (170, 187, 204, 255), 'shadowColor': (1, 2, 3, 255), 'shadowOffset': [3, 4]})
            components[0]['controllers'] = [{'name': 'state', 'pages': [('p0', 'normal'), ('p1', 'selected')], 'selected': 1, 'actions': [{'type': 0, 'from': ['p0'], 'to': ['p1'], 'transition': 'move', 'times': 1, 'delay': 0, 'stopOnExit': False}]}]
            components[0]['transitions'] = [{'name': 'move', 'autoPlay': True, 'autoPlayTimes': 2, 'items': [{'type': 0, 'time': 0.25, 'target': 0, 'label': None, 'tween': {'duration': 0.5, 'ease': 5, 'repeat': 0, 'yoyo': False, 'endLabel': None, 'start': {'flags': [True, False], 'values': [1, 0]}, 'end': {'flags': [True, False], 'values': [11, 0]}, 'path': [{'curve': 2, 'points': [0, 0, 1, 2, 3, 4]}, {'curve': 2, 'points': [10, 0, 0, 0, 0, 0]}]}}]}]
            components[0]['transitions'][0]['items'].append({'type': 7, 'time': 1, 'target': 7, 'label': None, 'value': {'playing': True, 'frame': 4}})
            components[0]['pivot'] = [0.5, 0.5]
            components[0]['settings'] = {'hitTestImage': 'abcde'}
            components[0]['overflow'] = 1
            components[0]['children'][0].update({'imageColor': [10,20,30,255], 'flip': 1, 'fillMethod': 5, 'fillClockwise': False, 'fillAmount': 0.5, 'pivot': [0.5, 0.25], 'anchor': True, 'grayed': True})
            components[0]['relations'] = [{'target': 0, 'types': [14, 15]}]
            components[0]['children'][0]['gears'] = [{'controllerIndex': 0, 'pages': ['p0']}]
            components[0]['children'][1]['gears'] = [{'type': 'text', 'controllerIndex': 0, 'pages': ['p0', 'p1'], 'values': ['first', 'second'], 'default': 'fallback'}]
            components[0]['children'][1]['gears'].append({'type': 'fontSize', 'controllerIndex': 0, 'pages': ['p0', 'p1'], 'values': [12, 22]})
            components[0]['children'].append({'type': 'graph', 'id': 'n3', 'name': 'panel', 'x': 1, 'y': 2, 'graphType': 1, 'lineSize': 2, 'lineColor': (1, 2, 3, 255), 'fillColor': (4, 5, 6, 128), 'cornerRadius': [1, 2, 3, 4]})
            components[0]['children'].append({'type': 'loader', 'id': 'n7', 'name': 'icon', 'x': 6, 'y': 7, 'url': 'ui://12345678abcde', 'align': 1, 'vAlign': 1, 'fill': 4, 'imageColor': (10, 20, 30, 255), 'fillMethod': 5, 'fillClockwise': False, 'fillAmount': 0.5, 'gears': [{'type': 'icon', 'controllerIndex': 0, 'pages': ['p0', 'p1'], 'values': ['icon-a', 'icon-b'], 'default': 'fallback'}]})
            components[0]['children'].append({'type': 'richtext', 'id': 'n8', 'name': 'rich', 'x': 0, 'y': 0, 'text': '[b]hello[/b]', 'ubb': True, 'constraints': [2, 300, 4, 200]})
            components[0]['children'][4]['groupIndex'] = 5
            components[0]['children'].append({'type': 'group', 'id': 'n9', 'name': 'group', 'x': 0, 'y': 0})
            components[0]['children'].append({'type': 'list', 'id': 'n10', 'name': 'list', 'x': 0, 'y': 0, 'list': {'layout': 2, 'selectionMode': 0, 'align': 0, 'vAlign': 0, 'lineGap': 3, 'colGap': 4, 'lineCount': 0, 'colCount': 0, 'autoItemSize': False, 'overflow': 2, 'pageController': -1, 'selectionController': 0, 'scroll': {'type': 1, 'barDisplay': 3, 'flags': 2, 'barMargin': None}, 'defaultItem': 'ui://12345678comp1', 'items': [{'title': 'first', 'icon': 'ui://12345678abcde'}]}})
            components[0]['children'].append({'type': 'movieclip', 'id': 'n11', 'name': 'anim', 'src': 'clip1', 'x': 0, 'y': 0, 'frame': 1, 'playing': False, 'imageColor': [20, 40, 60, 255], 'gears': [{'type': 'animation', 'controllerIndex': 0, 'pages': ['p0', 'p1'], 'values': [{'playing': False, 'frame': 2}, {'playing': True, 'frame': 4}]}]})
            components[0]['children'].append({'type': 'graph', 'id': 'n12', 'name': 'polygon', 'x': 0, 'y': 0, 'graphType': 3, 'points': [0, 0, 10, 0, 5, 10]})
            components[0]['children'].append({'type': 'graph', 'id': 'n13', 'name': 'regular', 'x': 0, 'y': 0, 'graphType': 4, 'sides': 3, 'startAngle': 30, 'distances': [0.5, 1, 0.5]})
            components[0]['children'].append({'type': 'inputtext', 'id': 'n14', 'name': 'input', 'x': 0, 'y': 0, 'text': 'hello', 'fontSize': 16, 'input': {'prompt': 'Enter', 'restrict': '0-9', 'maxLength': 12, 'keyboardType': 2, 'password': True}})
            components[0]['children'].append({'type': 'tree', 'id': 'n15', 'name': 'tree', 'x': 0, 'y': 0, 'list': {'layout': 0, 'selectionMode': 0, 'align': 0, 'vAlign': 0, 'lineGap': 0, 'colGap': 0, 'lineCount': 0, 'colCount': 0, 'autoItemSize': True, 'overflow': 0, 'pageController': -1, 'selectionController': -1, 'defaultItem': 'ui://12345678node', 'indent': 15, 'clickToExpand': 1, 'items': [{'title': 'folder', 'folder': True, 'level': 0}, {'title': 'leaf', 'folder': False, 'level': 1}]}})
            components[0]['children'][2]['gears'] = [{'type': 'xy', 'controllerIndex': 0, 'pages': ['p0', 'p1'], 'values': [[11, 22], [33, 44]], 'default': [1, 2], 'tween': {'ease': 5, 'duration': 0.5, 'delay': 0.25}}]
            components[0]['children'][2]['gears'].append({'type': 'size', 'controllerIndex': 0, 'pages': ['p0', 'p1'], 'values': [[10, 20, 1, 1], [30, 40, 2, 3]]})
            components[0]['children'][2]['gears'].append({'type': 'look', 'controllerIndex': 0, 'pages': ['p0', 'p1'], 'values': [[1, 0, 0, 1], [0.5, 90, 1, 0]]})
            components[0]['children'][2]['gears'].append({'type': 'color', 'controllerIndex': 0, 'pages': ['p0', 'p1'], 'values': [[[255,0,0,255],[0,0,0,255]], [[0,0,255,255],[0,0,0,255]]]})
            components[0]['children'][2]['gears'].append({'type': 'display2', 'controllerIndex': 0, 'pages': ['p1'], 'condition': 1})
            components[0]['children'][2]['relations'] = [{'target': -1, 'types': [14, 15]}, {'target': 0, 'types': [0]}]
            components.append({'id': 'comp2', 'name': 'Parent', 'width': 250, 'height': 150, 'children': [{'type': 'component', 'id': 'n2', 'name': 'nested', 'src': 'comp1', 'x': 8, 'y': 9}]})
            components.append({'id': 'comp3', 'name': 'Button', 'width': 100, 'height': 50, 'extension': 12, 'buttonMode': 2, 'buttonSound': 'ui://12345678sound', 'buttonEffect': 1, 'buttonEffectValue': 0.5})
            components.append({'id': 'comp4', 'name': 'Progress', 'width': 100, 'height': 50, 'extension': 14, 'titleType': 2, 'reverse': True})
            components.append({'id': 'comp5', 'name': 'Slider', 'width': 100, 'height': 50, 'extension': 15, 'titleType': 1, 'reverse': True})
            components.append({'id': 'comp6', 'name': 'Label', 'width': 50, 'height': 20, 'extension': 11})
            components.append({'id': 'comp7', 'name': 'Scroll', 'width': 50, 'height': 20, 'overflow': 2, 'margin': [1, 2, 3, 4], 'scroll': {'type': 2, 'barDisplay': 3, 'flags': 1, 'barMargin': [5, 6, 7, 8], 'resources': ['ui://12345678vbar', None, None, 'ui://12345678footer']}})
            components.append({'id': 'comp8', 'name': 'ScrollBar', 'width': 50, 'height': 20, 'extension': 16, 'settings': {'opaque': False, 'mask': 0, 'reversedMask': True, 'hitTestChild': 1}, 'children': [{'type': 'graph', 'id': 'bar', 'name': 'bar', 'x': 0, 'y': 0}, {'type': 'graph', 'id': 'grip', 'name': 'grip', 'x': 0, 'y': 0}]})
            components.append({'id': 'comp9', 'name': 'Combo', 'width': 50, 'height': 20, 'extension': 13, 'comboDropdown': 'ui://12345678popup'})
            components[1]['children'].append({'type': 'component', 'id': 'n4', 'name': 'progress', 'src': 'comp4', 'x': 5, 'y': 6, 'progress': [63, 100, 10]})
            components[1]['children'].append({'type': 'component', 'id': 'n5', 'name': 'slider', 'src': 'comp5', 'x': 7, 'y': 8, 'progress': [25, 80, 5], 'progressKind': 15})
            components[1]['children'].append({'type': 'component', 'id': 'n6', 'name': 'label', 'src': 'comp6', 'x': 0, 'y': 0, 'label': {'title': 'hello', 'icon': None, 'color': [10, 20, 30, 255], 'fontSize': 17}})
            components[1]['controllers'] = [{'name': 'tabs', 'pages': [('p0', 'first'), ('p1', 'second')]}]
            components[1]['children'].append({'type': 'component', 'id': 'n7', 'name': 'button', 'src': 'comp3', 'x': 0, 'y': 0, 'button': {'title': 'normal', 'selectedTitle': 'selected', 'icon': 'ui://12345678abcde', 'controller': 0, 'page': 'p1', 'checked': True}})
            components[1]['children'].append({'type': 'component', 'id': 'n8', 'name': 'combo', 'src': 'comp9', 'x': 0, 'y': 0, 'comboBox': {'visibleItemCount': 5, 'items': [{'title': 'One', 'value': 'one', 'icon': None}, {'title': 'Two', 'value': 'two', 'icon': None}]}})
            file.write_bytes(encode_image_package('12345678', 'Demo', images, pack(images + frames, 32, 32, 1), components, (), [{'id': 'abcde', 'width': 7, 'divisor': 1, 'pixels': b'\x01\0\0\0\0'}], movieclips, fonts, [{'id': 'external', 'name': 'Other'}]))
            script = Path(__file__).with_name('check_cocos_reader.cjs')
            process = subprocess.run(['node', str(script), str(build), str(file)], capture_output=True, text=True, encoding='utf-8', check=True)
            result = json.loads(process.stdout)
            self.assertEqual(result['constructed'][0]['hitSamples'], [True, False])
            nested_button = result['constructed'][1]['children'][4]
            self.assertEqual((nested_button['labelTitle'], nested_button['buttonSelectedTitle'], nested_button['labelIcon'], nested_button['buttonChecked'], nested_button['buttonRelatedController'], nested_button['buttonRelatedPage']), ('normal', 'selected', 'ui://12345678abcde', True, 'tabs', 'p1'))
            nested_combo = result['constructed'][1]['children'][5]
            self.assertEqual((nested_combo['comboItems'], nested_combo['comboValues'], nested_combo['comboVisibleCount'], nested_combo['comboSelectedIndex'], nested_combo['text']), (['One', 'Two'], ['one', 'two'], 5, 0, 'One'))
            combo = next(comp for comp in result['constructed'] if comp['id'] == 'comp9')
            self.assertEqual(combo['comboDropdown'], 'ui://12345678popup')
            button = next(comp for comp in result['constructed'] if comp['id'] == 'comp3')
            self.assertEqual((button['buttonSound'], button['buttonEffect'], button['buttonEffectValue']), ('ui://12345678sound', 1, 0.5))
            scroll = next(comp for comp in result['constructed'] if comp['id'] == 'comp7')
            scrollbar = next(comp for comp in result['constructed'] if comp['id'] == 'comp8')
            self.assertEqual((scrollbar['scrollBarFixedGrip'], scrollbar['scrollBarGrip'], scrollbar['scrollBarBar']), (False, 'grip', 'bar'))
            self.assertEqual((scrollbar['opaque'], scrollbar['maskInfo'], scrollbar['hitChild']), (False, ['bar', True], 'grip'))
            self.assertTrue(result['constructed'][0]['opaque'])
            self.assertEqual(scroll['scroll'], {'type': 2, 'barDisplay': 3, 'flags': 1, 'barMargin': [5, 6, 7, 8], 'resources': ['ui://12345678vbar', None, None, 'ui://12345678footer']})
            self.assertEqual(scroll['margin'], {'top': 1, 'bottom': 2, 'left': 3, 'right': 4})
            self.assertEqual((result['id'], result['name']), ('12345678', 'Demo'))
            self.assertEqual(result['dependencies'], [{'id': 'external', 'name': 'Other'}])
            clip = next(item for item in result['items'] if item['id'] == 'clip1')
            self.assertEqual((clip['interval'], clip['swing'], clip['repeatDelay'], clip['frames'][0]['rect'], clip['frames'][0]['delay']), (0.125, False, 0, {'x': 1, 'y': 2, 'width': 3, 'height': 2}, 0.083))
            font = next(item for item in result['items'] if item['id'] == 'font1')
            self.assertEqual((font['fontSize'], font['fontConfig']['commonHeight'], font['fontConfig']['fontDefDictionary']['65']['xAdvance']), (12, 14, 8))
            ttf = next(item for item in result['items'] if item['id'] == 'font2')
            self.assertEqual((ttf['fontSize'], ttf['fontConfig']['fontDefDictionary']['65']['rect']['width']), (16, 1))
            transition = result['constructed'][0]['transitions'][0]
            self.assertEqual((transition['name'], transition['autoPlay'], transition['autoPlayTimes']), ('move', True, 2))
            action = transition['items'][0]
            self.assertEqual((action['type'], action['time'], action['target'], action['tween']['duration'], action['tween']['endValue']['f1']), (0, 0.25, 'n0', 0.5, 11))
            anim_action = transition['items'][1]
            self.assertEqual((anim_action['type'], anim_action['target'], anim_action['value']), (7, 'n11', {'playing': True, 'frame': 4}))
            self.assertEqual((action['tween']['path']['_segments'][0]['type'], action['tween']['path']['_points'][2]), (2, {'x': 1, 'y': 2}))
            self.assertEqual(result['items'][0]['width'], 7)
            self.assertEqual(result['items'][0]['scale9Grid'], {'x': 1, 'y': 1, 'width': 3, 'height': 2})
            self.assertTrue(result['items'][1]['scaleByTile'])
            self.assertEqual(result['sprites']['abcde']['atlas'], 'atlas0')
            self.assertEqual(result['sprites']['abcde']['rect'], {'x': 1, 'y': 1, 'width': 7, 'height': 5})
            child = result['constructed'][0]['children'][1]
            loader = result['constructed'][0]['children'][3]
            self.assertEqual((loader['loaderUrl'], loader['loadedUrl'], loader['loaderAlign'], loader['loaderVerticalAlign'], loader['loaderFill'], loader['loaderPlaying'], loader['loaderFrame']), ('ui://12345678abcde', 'ui://12345678abcde', 1, 1, 4, True, 0))
            self.assertEqual((loader['color'], loader['fillMethod'], loader['fillClockwise'], loader['fillAmount']), ({'r': 10, 'g': 20, 'b': 30, 'a': 255}, 5, False, 0.5))
            self.assertEqual((loader['iconInitial'], loader['iconSecond']), ('icon-a', 'icon-b'))
            rich = result['constructed'][0]['children'][4]
            self.assertEqual((rich['text'], rich['ubb'], rich['minWidth'], rich['maxWidth'], rich['minHeight'], rich['maxHeight']), ('[b]hello[/b]', True, 2, 300, 4, 200))
            self.assertEqual(rich['group'], 'n9')
            group = result['constructed'][0]['children'][5]
            self.assertEqual((group['groupLayout'], group['groupLineGap'], group['groupColumnGap']), (0, 0, 0))
            list_child = result['constructed'][0]['children'][6]
            self.assertEqual((list_child['listLayout'], list_child['listDefaultItem'], list_child['listSelection']), (2, 'ui://12345678comp1', 'state'))
            self.assertEqual(list_child['listItems'], [[None, 'first', None, 'ui://12345678abcde', None, None]])
            movie_child = result['constructed'][0]['children'][7]
            self.assertEqual((movie_child['movieFrame'], movie_child['moviePlaying'], movie_child['color']), (1, False, {'r': 20, 'g': 40, 'b': 60, 'a': 255}))
            self.assertEqual((movie_child['animationInitial'], movie_child['animationSecond']), ([False, 2], [True, 4]))
            self.assertEqual((result['constructed'][0]['pivot'], result['constructed'][0]['overflow']), ([0.5, 0.5, False], 1))
            self.assertEqual(result['constructed'][0]['relations'], [{'target': 'n0', 'definitions': [{'type': 14, 'percent': False}, {'type': 15, 'percent': False}]}])
            self.assertEqual(result['constructed'][0]['controllers'], [{'name': 'state', 'ids': ['p0', 'p1'], 'names': ['normal', 'selected'], 'selected': 1, 'actions': [{'from': ['p0'], 'to': ['p1'], 'transition': 'move', 'times': 1, 'delay': 0, 'stopOnExit': False}], 'actionRuns': [{'name': 'move', 'times': 1, 'delay': 0}]}])
            self.assertEqual((result['constructed'][0]['children'][0]['gearPages'], result['constructed'][0]['children'][0]['gearVisibleInitial'], result['constructed'][0]['children'][0]['gearVisibleSecond']), (['p0'], True, False))
            self.assertEqual((child['fontSize'], child['align'], child['verticalAlign'], child['leading'], child['autoSize'], child['letterSpacing'], child['bold'], child['italic']), (18, 1, 2, 5, 0, 2, True, True))
            self.assertEqual((child['stroke'], child['strokeColor']), (1, {'r': 170, 'g': 187, 'b': 204, 'a': 255}))
            self.assertEqual((child['shadowColor'], child['shadowOffset']), ({'r': 1, 'g': 2, 'b': 3, 'a': 255}, {'x': 3, 'y': 4}))
            self.assertEqual((child['fontSizeInitial'], child['fontSizeSecond']), (12, 22))
            self.assertEqual((result['constructed'][0]['children'][2]['display2Initial'], result['constructed'][0]['children'][2]['display2Second']), ([True, False], [True, True]))
            self.assertEqual((child['textInitial'], child['textSecond'], child['text']), ('first', 'second', 'second'))
            self.assertEqual(result['constructed'][0]['children'][0]['width'], 30)
            picture = result['constructed'][0]['children'][0]
            self.assertEqual((picture['pivot'], picture['grayed']), ([0.5, 0.25, True], True))
            self.assertEqual((picture['color'], picture['flip'], picture['fillMethod'], picture['fillClockwise'], picture['fillAmount']), ({'r':10,'g':20,'b':30,'a':255}, 1, 5, False, 0.5))
            graph = result['constructed'][0]['children'][2]
            self.assertEqual(graph['graphCorners'], [1, 2, 3, 4])
            self.assertEqual(result['constructed'][0]['children'][8]['graphPoints'], [0, 0, 10, 0, 5, 10])
            regular = result['constructed'][0]['children'][9]
            self.assertEqual((regular['graphSides'], regular['graphStartAngle'], regular['graphDistances']), (3, 30, [0.5, 1, 0.5]))
            text_input = result['constructed'][0]['children'][10]
            self.assertEqual((text_input['text'], text_input['inputPrompt'], text_input['inputRestrict'], text_input['inputMaxLength'], text_input['inputPassword']), ('hello', 'Enter', '0-9', 12, True))
            tree = result['constructed'][0]['children'][11]
            self.assertEqual((tree['treeIndent'], tree['treeClick'], tree['treeNodes']), (15, 1, [{'title': 'folder', 'folder': True, 'children': [{'title': 'leaf', 'folder': False}]}]))
            self.assertEqual((graph['graphType'], graph['lineSize'], graph['fillColor']), (1, 2, {'r': 4, 'g': 5, 'b': 6, 'a': 128}))
            self.assertEqual((graph['xyInitial'], graph['xySecond']), ([11, 22], [33, 44]))
            self.assertEqual((graph['sizeInitial'], graph['sizeSecond']), ([10, 20, 1, 1], [30, 40, 2, 3]))
            self.assertEqual((graph['lookInitial'], graph['lookSecond']), ([1, 0, False, True], [0.5, 90, True, False]))
            self.assertEqual((graph['colorInitial'], graph['colorSecond']), ({'r':255,'g':0,'b':0,'a':255}, {'r':0,'g':0,'b':255,'a':255}))
            self.assertEqual(graph['relations'], [{'target': 'parent', 'definitions': [{'type': 14, 'percent': False}, {'type': 15, 'percent': False}]}, {'target': 'n0', 'definitions': [{'type': 0, 'percent': False}]}])
            self.assertEqual(graph['xyTween'], {'easeType': 5, 'duration': 0.5, 'delay': 0.25})
            nested = result['constructed'][1]['children'][0]
            self.assertEqual((nested['id'], nested['name'], nested['x'], nested['y'], nested['width'], nested['height']), ('n2', 'nested', 8, 9, 123, 77))
            self.assertEqual((result['constructed'][2]['buttonMode'], result['constructed'][2]['buttonVolume'], result['constructed'][2]['buttonEffect']), (2, 1, 1))
            self.assertEqual((result['constructed'][3]['progressTitle'], result['constructed'][3]['progressReverse']), (2, True))
            self.assertEqual((result['constructed'][4]['progressTitle'], result['constructed'][4]['progressReverse']), (1, True))
            progress = result['constructed'][1]['children'][1]
            self.assertEqual((progress['progressValue'], progress['progressMax'], progress['progressMin']), (63, 100, 10))
            slider = result['constructed'][1]['children'][2]
            self.assertEqual((slider['progressValue'], slider['progressMax'], slider['progressMin']), (25, 80, 5))
            label = result['constructed'][1]['children'][3]
            self.assertEqual((label['labelTitle'], label['labelColor'], label['labelFontSize']), ('hello', {'r': 10, 'g': 20, 'b': 30, 'a': 255}, 17))

    def test_compact_atlas_dimensions_with_cocos_reader(self):
        build = Path(os.environ.get('FGUI_COCOS_BUILD', 'E:/game_dev/FairyGUI-cocoscreator/source/build'))
        if not (build / 'UIPackage.js').is_file(): self.skipTest('Cocos build unavailable')
        images = [{'id': 'i', 'name': 'image', 'width': 13, 'height': 7}]
        pages = pack(images, 512, 512, 2, shrink=True)
        with tempfile.TemporaryDirectory() as tmp:
            binary = Path(tmp) / 'Demo.bin'
            binary.write_bytes(encode_image_package('12345678', 'Demo', images, pages))
            process = subprocess.run(['node', str(Path(__file__).with_name('check_cocos_reader.cjs')), str(build), str(binary)], capture_output=True, text=True, encoding='utf8', check=True)
            result = json.loads(process.stdout)
            atlas = next(item for item in result['items'] if item['type'] == 4)
            self.assertEqual((atlas['width'], atlas['height']), (32, 16))
            self.assertEqual(result['sprites']['i']['rect'], {'x': 2, 'y': 2, 'width': 13, 'height': 7})

    def test_optimized_atlas_placements_with_cocos_reader(self):
        import random
        build = Path(os.environ.get('FGUI_COCOS_BUILD', 'E:/game_dev/FairyGUI-cocoscreator/source/build'))
        if not (build / 'UIPackage.js').is_file(): self.skipTest('Cocos build unavailable')
        rng = random.Random(0)
        images = [{'id': str(i), 'name': str(i), 'width': rng.randint(10, 70), 'height': rng.randint(10, 70)} for i in range(12)]
        pages = plan(images, 256, 256, 2, optimize=True)
        self.assertEqual((pages[0]['width'], pages[0]['height']), (128, 256))
        with tempfile.TemporaryDirectory() as tmp:
            binary = Path(tmp) / 'Demo.bin'
            binary.write_bytes(encode_image_package('12345678', 'Demo', images, pages))
            process = subprocess.run(['node', str(Path(__file__).with_name('check_cocos_reader.cjs')), str(build), str(binary)], capture_output=True, text=True, encoding='utf8', check=True)
            result = json.loads(process.stdout)
            for item in pages[0]['items']:
                self.assertEqual(result['sprites'][item['id']]['rect'], {key: item[key] for key in ('x', 'y', 'width', 'height')})

    def test_cocos_constructs_child_from_loaded_external_package(self):
        build = Path(os.environ.get('FGUI_COCOS_BUILD', 'E:/game_dev/FairyGUI-cocoscreator/source/build'))
        if not (build / 'UIPackage.js').is_file(): self.skipTest('Cocos build unavailable')
        external = [{'id': 'button', 'name': 'Button', 'width': 44, 'height': 22, 'extension': 12}]
        parent = [{'id': 'main', 'name': 'Main', 'width': 100, 'height': 100,
                   'children': [{'type': 'component', 'id': 'n0', 'name': 'nested', 'src': 'button', 'pkg': 'external', 'x': 3, 'y': 4,
                                 'button': {'title': 'Cross package', 'checked': True}}]}]
        dependency = {'id': 'external', 'name': 'Other'}
        with tempfile.TemporaryDirectory() as tmp:
            main = Path(tmp) / 'Main.bin'
            other = Path(tmp) / 'Other.bin'
            main.write_bytes(encode_image_package('12345678', 'Main', [], [], parent, dependencies=[dependency]))
            other.write_bytes(encode_image_package('external', 'Other', [], [], external))
            p = subprocess.run(['node', str(Path(__file__).with_name('check_cocos_reader.cjs')), str(build), str(main), str(other)], capture_output=True, text=True, encoding='utf-8', check=True)
            result = json.loads(p.stdout)
            child = result['constructed'][0]['children'][0]
            self.assertEqual((child['resolvedPackageId'], child['resolvedItemId'], child['width'], child['height']), ('external', 'button', 44, 22))
            self.assertEqual((child['labelTitle'], child['buttonChecked']), ('Cross package', True))

    def test_selected_controller_page_v2_with_cocos(self):
        build = Path(os.environ.get('FGUI_COCOS_BUILD', 'E:/game_dev/FairyGUI-cocoscreator/source/build'))
        if not (build / 'UIPackage.js').is_file(): self.skipTest('Cocos build unavailable')
        component = {'id': 'c1', 'name': 'Main', 'width': 10, 'height': 20, 'controllers': [{'name': 'state', 'pages': [('0', 'up'), ('1', 'down')], 'selected': 1}]}
        data = encode_image_package('12345678', 'Demo', [], [], [component])
        self.assertEqual(inspect(data)['version'], 2)
        with tempfile.TemporaryDirectory() as tmp:
            binary = Path(tmp) / 'Demo.bin'
            binary.write_bytes(data)
            p = subprocess.run(['node', str(Path(__file__).with_name('check_cocos_reader.cjs')), str(build), str(binary)], capture_output=True, text=True, encoding='utf-8', check=True)
            self.assertEqual(json.loads(p.stdout)['constructed'][0]['controllers'][0]['selected'], 1)


if __name__ == '__main__': unittest.main()
