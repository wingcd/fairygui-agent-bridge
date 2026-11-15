import json
import io
import os
from unittest.mock import patch
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
import unittest

from fgui import execute


class OfflineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.pkg = self.root / 'assets' / 'Demo'
        self.pkg.mkdir(parents=True)
        (self.root / 'test.fairy').write_text('<projectDescription id="p"/>', encoding='utf8')
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="c0001" name="Main.xml" path="/"/></resources></packageDescription>', encoding='utf8')
        (self.pkg / 'Main.xml').write_text('<component><displayList><text id="n1" name="label"/></displayList></component>', encoding='utf8')
        self.args = {'project': str(self.root), 'pkg': 'Demo', 'name': 'Main'}

    def tearDown(self):
        self.tmp.cleanup()

    def test_xml_dtd_rejected_in_utf16_without_rejecting_comments(self):
        from fgui import parse_xml
        for encoding in ('utf-8', 'utf-16', 'utf-16-le', 'utf-16-be'):
            document = '<?xml version="1.0"?><!DOCTYPE component [<!ENTITY text "expanded">]><component>&text;</component>'.encode(encoding)
            with self.subTest(encoding=encoding), self.assertRaisesRegex(ValueError, 'DTD/entity'):
                parse_xml(document, 'component')
        node = parse_xml(b'<component><!-- <!DOCTYPE example> --><displayList/></component>', 'component')
        self.assertEqual(node.tag, 'component')

    def test_controller_action_and_widget_references_are_validated_before_write(self):
        source = self.pkg / 'Main.xml'
        xml = '<component size="20,20"><controller name="state" pages="0,off,1,on"><action type="play_transition" fromPage="0" toPage="1" transition="go"/></controller><displayList><list id="n1" selectionController="state"/><component id="n2"><Button controller="state" page="1"/></component></displayList><transition name="go"/></component>'
        source.write_text(xml, encoding='utf8')
        before = execute('read_component', self.args)
        changes = [
            ('selectionController="state"', 'selectionController="missing"', 'selectionController'),
            ('controller="state" page="1"', 'controller="missing" page="1"', 'Button references unknown controller'),
            ('controller="state" page="1"', 'controller="state" page="missing"', 'Button references unknown page'),
            ('fromPage="0"', 'fromPage="missing"', 'action fromPage'),
            ('transition="go"', 'transition="missing"', 'action references unknown transition'),
        ]
        for old, new, message in changes:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                execute('write_component', {**self.args, 'xml': xml.replace(old, new), 'expected_sha256': before['sha256']})
        self.assertEqual(source.read_text(encoding='utf8'), xml)

    def test_insert_object_rejects_invalid_common_geometry_before_write(self):
        before = execute('read_component', self.args)
        for attrs in ('size="bad,10"', 'size="-1,10"', 'xy="1.5,2"', 'scale="nan,1"', 'alpha="2"', 'visible="yes"', 'anchor="true"'):
            with self.subTest(attrs=attrs), self.assertRaises(ValueError):
                execute('insert_object', {**self.args, 'object_xml': f'<graph id="n2" {attrs}/>', 'expected_sha256': before['sha256']})
        self.assertEqual(execute('read_component', self.args)['sha256'], before['sha256'])
        result = execute('insert_object', {**self.args, 'object_xml': '<graph id="n2" xy="-2,3" size="4,5" pivot="0.5,0.5" anchor="true"/>', 'expected_sha256': before['sha256']})
        self.assertNotEqual(result['sha256'], before['sha256'])

    def test_secondary_display_gear_edit_and_publish(self):
        import mcp_server
        from published import inspect
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="20,20"><controller name="state" pages="0,off,1,on"/><displayList><!--keep--><graph id="n1" name="shape"/></displayList></component>', encoding='utf8')
        before = execute('read_component', self.args)
        args = {**self.args, 'target': 'n1', 'controller': 'state', 'pages': ['1'], 'condition': 1, 'expected_sha256': before['sha256']}
        mcp_server.validate_arguments('set_display2_gear', args)
        changed = execute('set_display2_gear', args)
        out = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'out')})
        gear = inspect(Path(out['file']).read_bytes())['items'][0]['component']['children'][0]['gears'][0]
        self.assertEqual((gear['type'], gear['pages'], gear['condition']), (8, ['1'], 1))
        import shutil
        build = Path(os.environ.get('FGUI_COCOS_BUILD', 'E:/game_dev/FairyGUI-cocoscreator/source/build'))
        if (build / 'UIPackage.js').is_file() and shutil.which('node'):
            reader = Path(__file__).with_name('check_cocos_reader.cjs')
            runtime = json.loads(subprocess.run(['node', str(reader), str(build), out['file']], capture_output=True, text=True, encoding='utf8', check=True).stdout)
            child = runtime['constructed'][0]['children'][0]
            self.assertEqual((child['display2Initial'], child['display2Second']), ([True, False], [True, True]))
        for bad in (-1, 2, True, '1'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                execute('set_display2_gear', {**args, 'condition': bad, 'expected_sha256': changed['sha256']})
        execute('remove_gear', {**self.args, 'target': 'n1', 'gear': 'display2', 'expected_sha256': changed['sha256']})
        self.assertNotIn('<gearDisplay2', source.read_text(encoding='utf8'))
        self.assertIn('<!--keep-->', source.read_text(encoding='utf8'))

    def test_icon_gear_edit_and_publish(self):
        import mcp_server
        from published import inspect
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="40,40"><controller name="state" pages="0,normal,1,active"/><displayList><!--keep--><loader id="n1" name="icon" size="10,10"/><graph id="n2"/></displayList></component>', encoding='utf8')
        before = execute('read_component', self.args)
        args = {**self.args, 'target': 'n1', 'controller': 'state', 'pages': ['0', '1'], 'values': ['iconA', 'iconB'], 'default': 'fallback', 'expected_sha256': before['sha256']}
        mcp_server.validate_arguments('set_icon_gear', args)
        changed = execute('set_icon_gear', args)
        out = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'out')})
        gear = inspect(Path(out['file']).read_bytes())['items'][0]['component']['children'][0]['gears'][0]
        self.assertEqual([entry['value'] for entry in gear['values']], ['iconA', 'iconB'])
        self.assertEqual(gear['default'], 'fallback')
        import shutil
        build = Path(os.environ.get('FGUI_COCOS_BUILD', 'E:/game_dev/FairyGUI-cocoscreator/source/build'))
        if (build / 'UIPackage.js').is_file() and shutil.which('node'):
            reader = Path(__file__).with_name('check_cocos_reader.cjs')
            runtime = json.loads(subprocess.run(['node', str(reader), str(build), out['file']], capture_output=True, text=True, encoding='utf8', check=True).stdout)
            child = runtime['constructed'][0]['children'][0]
            self.assertEqual((child['iconInitial'], child['iconSecond']), ('iconA', 'iconB'))
        for bad in (['icon|bad', 'iconB'], ['icon,bad', 'iconB'], ['iconA']):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                execute('set_icon_gear', {**args, 'values': bad, 'expected_sha256': changed['sha256']})
        with self.assertRaisesRegex(ValueError, 'icon-capable'):
            execute('set_icon_gear', {**args, 'target': 'n2', 'expected_sha256': changed['sha256']})
        with self.assertRaisesRegex(ValueError, 'resource not found'):
            execute('set_icon_gear', {**args, 'values': ['ui://abcdefghmissing', 'iconB'], 'expected_sha256': changed['sha256']})
        from PIL import Image
        image_source = self.root / 'icon.png'
        Image.new('RGBA', (2, 2), 'red').save(image_source)
        image = execute('import_image', {'project': str(self.root), 'pkg': 'Demo', 'source': str(image_source), 'exported': True})
        changed = execute('set_icon_gear', {**args, 'values': ['ui://Demo/icon', 'ui://abcdefgh' + image['id']], 'expected_sha256': changed['sha256']})
        Path(image['path']).unlink()
        with self.assertRaisesRegex(ValueError, 'resource not found'):
            execute('set_icon_gear', {**args, 'values': ['ui://Demo/icon', 'iconB'], 'expected_sha256': changed['sha256']})
        execute('remove_gear', {**self.args, 'target': 'n1', 'gear': 'icon', 'expected_sha256': changed['sha256']})
        self.assertNotIn('<gearIcon', source.read_text(encoding='utf8'))
        self.assertIn('<!--keep-->', source.read_text(encoding='utf8'))

    def test_publish_reports_missing_child_before_atlas_packing(self):
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="10,10"><displayList><image id="n1" src="missing"/></displayList></component>', encoding='utf8')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'out')}
        with patch('fgui.atlas_plan', side_effect=AssertionError('atlas packing should not start')):
            with self.assertRaisesRegex(ValueError, r'Main \(c0001\): child n1 references missing image resource missing in package Demo'):
                execute('publish_simple_experimental', args)
        self.assertFalse((self.root / 'out').exists())

    def test_font_size_gear_edit_and_publish(self):
        import mcp_server
        from published import inspect
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="40,40"><controller name="state" pages="0,normal,1,large"/><displayList><!--keep--><text id="n1" name="label" size="10,10"/><graph id="n2"/></displayList></component>', encoding='utf8')
        before = execute('read_component', self.args)
        args = {**self.args, 'target': 'n1', 'controller': 'state', 'pages': ['0', '1'], 'values': ['16', '28'], 'default': '22', 'expected_sha256': before['sha256']}
        mcp_server.validate_arguments('set_font_size_gear', args)
        changed = execute('set_font_size_gear', args)
        out = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'out')})
        gear = inspect(Path(out['file']).read_bytes())['items'][0]['component']['children'][0]['gears'][0]
        self.assertEqual([entry['value'] for entry in gear['values']], [16, 28])
        self.assertEqual(gear['default'], 22)
        import shutil
        build = Path(os.environ.get('FGUI_COCOS_BUILD', 'E:/game_dev/FairyGUI-cocoscreator/source/build'))
        if (build / 'UIPackage.js').is_file() and shutil.which('node'):
            reader = Path(__file__).with_name('check_cocos_reader.cjs')
            runtime = json.loads(subprocess.run(['node', str(reader), str(build), out['file']], capture_output=True, text=True, encoding='utf8', check=True).stdout)
            child = runtime['constructed'][0]['children'][0]
            self.assertEqual((child['fontSizeInitial'], child['fontSizeSecond']), (16, 28))
        for bad in (['-1', '28'], ['1.5', '28'], ['2147483648', '28'], ['16']):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                execute('set_font_size_gear', {**args, 'values': bad, 'expected_sha256': changed['sha256']})
        with self.assertRaisesRegex(ValueError, 'requires a text object'):
            execute('set_font_size_gear', {**args, 'target': 'n2', 'expected_sha256': changed['sha256']})
        changed = execute('set_font_size_gear', {**args, 'values': ['-', '28'], 'expected_sha256': changed['sha256']})
        execute('remove_gear', {**self.args, 'target': 'n1', 'gear': 'font_size', 'expected_sha256': changed['sha256']})
        self.assertNotIn('<gearFontSize', source.read_text(encoding='utf8'))
        self.assertIn('<!--keep-->', source.read_text(encoding='utf8'))

    def test_animation_gear_edit_and_publish(self):
        import mcp_server
        from published import inspect
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="40,40"><controller name="state" pages="0,normal,1,paused"/><displayList><!--keep--><loader id="n1" name="clip" size="10,10"/><graph id="n2"/></displayList></component>', encoding='utf8')
        before = execute('read_component', self.args)
        args = {**self.args, 'target': 'n1', 'controller': 'state', 'pages': ['0', '1'], 'values': ['0,p', '2,s'], 'default': '1,p', 'expected_sha256': before['sha256']}
        mcp_server.validate_arguments('set_animation_gear', args)
        changed = execute('set_animation_gear', args)
        out = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'out')})
        gear = inspect(Path(out['file']).read_bytes())['items'][0]['component']['children'][0]['gears'][0]
        self.assertEqual([entry['value'] for entry in gear['values']], [{'playing': True, 'frame': 0}, {'playing': False, 'frame': 2}])
        self.assertEqual(gear['default'], {'playing': True, 'frame': 1})
        import shutil
        build = Path(os.environ.get('FGUI_COCOS_BUILD', 'E:/game_dev/FairyGUI-cocoscreator/source/build'))
        if (build / 'UIPackage.js').is_file() and shutil.which('node'):
            reader = Path(__file__).with_name('check_cocos_reader.cjs')
            runtime = json.loads(subprocess.run(['node', str(reader), str(build), out['file']], capture_output=True, text=True, encoding='utf8', check=True).stdout)
            child = runtime['constructed'][0]['children'][0]
            self.assertEqual((child['animationInitial'], child['animationSecond']), ([True, 0], [False, 2]))
        for bad in (['-1,p', '2,s'], ['1,x', '2,s'], ['2147483648,p', '2,s'], ['1,p']):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                execute('set_animation_gear', {**args, 'values': bad, 'expected_sha256': changed['sha256']})
        with self.assertRaisesRegex(ValueError, 'requires a movieclip or loader'):
            execute('set_animation_gear', {**args, 'target': 'n2', 'expected_sha256': changed['sha256']})
        changed = execute('set_animation_gear', {**args, 'values': ['-', '2,s'], 'expected_sha256': changed['sha256']})
        execute('remove_gear', {**self.args, 'target': 'n1', 'gear': 'animation', 'expected_sha256': changed['sha256']})
        self.assertNotIn('<gearAni', source.read_text(encoding='utf8'))
        self.assertIn('<!--keep-->', source.read_text(encoding='utf8'))

    def test_set_look_gear_round_trip_and_validation(self):
        import mcp_server
        from published import inspect
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="100,100"><controller name="state" pages="0,normal,1,active"/><displayList><!--keep--><text id="n1" name="label" size="10,20"/></displayList></component>', encoding='utf8')
        before = execute('read_component', self.args)
        args = {**self.args, 'target': 'label', 'controller': 'state', 'pages': ['0', '1'], 'values': ['1,0,0', '0.5,90,1,0'], 'default': '1,0,0,1', 'tween': {'enabled': True, 'ease': 'Linear', 'duration': 0.4}, 'expected_sha256': before['sha256']}
        mcp_server.validate_arguments('set_look_gear', args)
        result = execute('set_look_gear', args)
        published = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'out')})
        gear = inspect(Path(published['file']).read_bytes())['items'][0]['component']['children'][0]['gears'][0]
        self.assertEqual(gear['values'][0]['value'], [1, 0, False, True])
        self.assertEqual(gear['values'][1]['value'], [0.5, 90, True, False])
        self.assertTrue(gear['tween'])
        for bad in ('nan,0,0', '1.1,0,0', '1,inf,0', '1,0,true', '1,0,0,2'):
            with self.subTest(value=bad), self.assertRaises(ValueError):
                execute('set_look_gear', {**args, 'values': ['-', bad], 'expected_sha256': result['sha256']})
        updated = execute('set_look_gear', {**args, 'values': ['-', '1,180,0'], 'expected_sha256': result['sha256'], 'tween': {'enabled': False}})
        self.assertIn('<!--keep-->', source.read_text(encoding='utf8'))
        self.assertNotIn('tween=', source.read_text(encoding='utf8'))
        execute('remove_gear', {**self.args, 'target': 'n1', 'gear': 'look', 'expected_sha256': updated['sha256']})
        self.assertNotIn('<gearLook', source.read_text(encoding='utf8'))

    def test_set_position_and_size_gears_preserve_tween_and_validate(self):
        import mcp_server
        from published import inspect
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="100,100"><controller name="state" pages="0,normal,1,active"/><displayList><!--keep--><text id="n1" name="label" size="10,20" text="x"/></displayList></component>', encoding='utf8')
        before = execute('read_component', self.args)
        base = {**self.args, 'target': 'label', 'controller': 'state', 'pages': ['0', '1']}
        position_args = {**base, 'values': ['1,2', '30,40'], 'default': '0,0', 'tween': {'enabled': True, 'ease': 'Linear', 'duration': 0.4, 'delay': 0.1}, 'expected_sha256': before['sha256']}
        mcp_server.validate_arguments('set_position_gear', position_args)
        position = execute('set_position_gear', position_args)
        size = execute('set_size_gear', {**base, 'values': ['10,20', '30,40,1.5,0.5'], 'default': '10,20', 'expected_sha256': position['sha256']})
        updated = execute('set_position_gear', {**base, 'values': ['2,3', '30,40'], 'expected_sha256': size['sha256']})
        xml = source.read_text(encoding='utf8')
        self.assertIn('<!--keep-->', xml)
        self.assertIn('tween="true"', xml)
        self.assertIn('ease="Linear"', xml)
        self.assertIn('duration="0.4"', xml)
        result = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'out')})
        gears = inspect(Path(result['file']).read_bytes())['items'][0]['component']['children'][0]['gears']
        self.assertEqual(gears[0]['values'][0]['value'], [2, 3])
        self.assertTrue(gears[0]['tween'])
        self.assertAlmostEqual(gears[0]['duration'], 0.4, places=5)
        self.assertEqual(gears[1]['values'][1]['value'], [30, 40, 1.5, 0.5])
        for command, bad in [('set_position_gear', {'values': ['1,2', 'NaN,3']}), ('set_size_gear', {'values': ['-1,2', '3,4']}), ('set_size_gear', {'values': ['1,2,inf,1', '3,4']}), ('set_position_gear', {'values': ['1,2', '3,4'], 'tween': {'enabled': False, 'delay': 1}})]:
            with self.subTest(command=command, bad=bad), self.assertRaises(ValueError):
                execute(command, {**base, **bad, 'expected_sha256': updated['sha256']})
        without_tween = execute('set_position_gear', {**base, 'values': ['-', '30,40'], 'tween': {'enabled': False}, 'expected_sha256': updated['sha256']})
        self.assertNotIn('tween=', source.read_text(encoding='utf8'))
        import shutil
        build = Path(os.environ.get('FGUI_COCOS_BUILD', 'E:/game_dev/FairyGUI-cocoscreator/source/build'))
        if (build / 'UIPackage.js').is_file() and shutil.which('node'):
            static = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'out-static')})
            reader = Path(__file__).with_name('check_cocos_reader.cjs')
            runtime = json.loads(subprocess.run(['node', str(reader), str(build), static['file']], capture_output=True, text=True, encoding='utf8', check=True).stdout)
            child = runtime['constructed'][0]['children'][0]
            self.assertEqual((child['xyInitial'], child['xySecond']), ([0, 0], [30, 40]))
            self.assertEqual((child['sizeInitial'], child['sizeSecond']), ([10, 20, 1, 1], [30, 40, 1.5, 0.5]))
        removed = execute('remove_gear', {**self.args, 'target': 'n1', 'gear': 'position', 'expected_sha256': without_tween['sha256']})
        removed = execute('remove_gear', {**self.args, 'target': 'n1', 'gear': 'size', 'expected_sha256': removed['sha256']})
        self.assertNotIn('<gearXY', source.read_text(encoding='utf8'))
        self.assertNotIn('<gearSize', source.read_text(encoding='utf8'))

    def test_set_color_gear_round_trips_and_validates(self):
        import mcp_server
        from published import inspect
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="20,20"><controller name="state" pages="0,normal,1,active"/><displayList><!--keep--><text id="n1" name="label" size="10,10" text="x"/><group id="n2"/></displayList></component>', encoding='utf8')
        before = execute('read_component', self.args)
        args = {**self.args, 'target': 'label', 'controller': 'state', 'pages': ['0', '1'], 'values': ['#123456,#010203', '#abcdef'], 'default': '#010101', 'expected_sha256': before['sha256']}
        mcp_server.validate_arguments('set_color_gear', args)
        result = execute('set_color_gear', args)
        xml = source.read_text(encoding='utf8')
        self.assertIn('<!--keep-->', xml)
        self.assertIn('values="#123456,#010203|#abcdef"', xml)
        output = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'out')})
        info = inspect(Path(output['file']).read_bytes())
        gear = info['items'][0]['component']['children'][0]['gears'][0]
        self.assertEqual(gear['type'], 4)
        self.assertEqual(gear['values'][0]['value'], [[18, 52, 86, 255], [1, 2, 3, 255]])
        import shutil
        build = Path(os.environ.get('FGUI_COCOS_BUILD', 'E:/game_dev/FairyGUI-cocoscreator/source/build'))
        if (build / 'UIPackage.js').is_file() and shutil.which('node'):
            reader = Path(__file__).with_name('check_cocos_reader.cjs')
            runtime = json.loads(subprocess.run(['node', str(reader), str(build), output['file']], capture_output=True, text=True, encoding='utf8', check=True).stdout)
            child = runtime['constructed'][0]['children'][0]
            self.assertEqual((child['colorInitial']['r'], child['colorInitial']['g'], child['colorInitial']['b']), (18, 52, 86))
            self.assertEqual((child['colorSecond']['r'], child['colorSecond']['g'], child['colorSecond']['b']), (171, 205, 239))
        for bad in ({'values': ['#123', '#abcdef']}, {'values': ['#123456']}, {'pages': ['0', 'missing']}, {'default': '-'}, {'target': 'n2'}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                execute('set_color_gear', {**args, **bad, 'expected_sha256': result['sha256']})
        with self.assertRaisesRegex(ValueError, 'sha256'):
            execute('set_color_gear', args)
        removed = execute('remove_gear', {**self.args, 'target': 'n1', 'gear': 'color', 'expected_sha256': result['sha256']})
        self.assertNotIn('<gearColor', source.read_text(encoding='utf8'))
        self.assertNotEqual(removed['sha256'], result['sha256'])
        execute('create_component', {**self.args, 'name': 'Button', 'width': 10, 'height': 10, 'extention': 'Button'})
        execute('create_component', {**self.args, 'name': 'Plain', 'width': 10, 'height': 10})
        button = execute('insert_resource', {**self.args, 'ref_name': 'Button', 'object_name': 'button', 'expected_sha256': removed['sha256']})
        plain = execute('insert_resource', {**self.args, 'ref_name': 'Plain', 'object_name': 'plain', 'expected_sha256': button['sha256']})
        button_gear = execute('set_color_gear', {**args, 'target': 'button', 'values': ['-', '#abcdef'], 'expected_sha256': plain['sha256']})
        self.assertIn('values="-|#abcdef"', source.read_text(encoding='utf8'))
        with self.assertRaisesRegex(ValueError, 'color-capable component'):
            execute('set_color_gear', {**args, 'target': 'plain', 'expected_sha256': button_gear['sha256']})

    def test_button_instance_options_validate_and_preserve_other_settings(self):
        from PIL import Image
        package = self.pkg / 'package.xml'
        package.write_text('<packageDescription id="abcdefgh"><resources><component id="c0001" name="Main.xml" path="/"/><component id="button" name="Button.xml" path="/"/><image id="img" name="icon.png" path="/"/></resources></packageDescription>', encoding='utf8')
        (self.pkg / 'Button.xml').write_text('<component extention="Button" size="20,20"><displayList/></component>', encoding='utf8')
        Image.new('RGBA', (2, 2)).save(self.pkg / 'icon.png')
        main = self.pkg / 'Main.xml'
        main.write_text('<component size="20,20"><controller name="state" pages="0,off"/><displayList><!--keep--><component id="n1" src="button"><Button title="old" controller="state" page="0"/></component><text id="n2"/></displayList></component>', encoding='utf8')
        before = execute('read_component', self.args)
        args = {**self.args, 'target': 'n1', 'expected_sha256': before['sha256']}
        props = {'title': 'A & B', 'selectedTitle': 'selected', 'icon': 'ui://Demo/icon', 'selectedIcon': 'ui://abcdefghimg', 'titleColor': '#123456', 'titleFontSize': 18, 'checked': True}
        import mcp_server
        mcp_server.validate_arguments('set_button_instance_options', {**args, 'props': props})
        with self.assertRaises(ValueError):
            mcp_server.validate_arguments('set_button_instance_options', {**args, 'props': {'checked': 'true'}})
        result = execute('set_button_instance_options', {**args, 'props': props})
        xml = main.read_text(encoding='utf8')
        self.assertIn('<!--keep-->', xml)
        self.assertIn('title="A &amp; B"', xml)
        self.assertIn('controller="state" page="0"', xml)
        self.assertIn('checked="true"', xml)
        with self.assertRaisesRegex(ValueError, 'sha256'): execute('set_button_instance_options', {**args, 'props': props})
        for bad in ({'checked': 'true'}, {'titleFontSize': -1}, {'titleColor': '#123'}, {'icon': 'ui://abcdefghmissing'}, {'unknown': 'x'}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                execute('set_button_instance_options', {**args, 'expected_sha256': result['sha256'], 'props': bad})
        with self.assertRaisesRegex(ValueError, 'Button component'):
            execute('set_button_instance_options', {**args, 'target': 'n2', 'expected_sha256': result['sha256'], 'props': {'title': 'x'}})
        self.assertEqual(execute('read_component', self.args)['sha256'], result['sha256'])
        cleared = execute('set_button_instance_options', {**args, 'expected_sha256': result['sha256'], 'props': {'icon': '', 'checked': False}})
        self.assertIn('icon=""', main.read_text(encoding='utf8'))
        self.assertNotEqual(cleared['sha256'], result['sha256'])

    def test_label_instance_options_validate_and_preserve_other_settings(self):
        from PIL import Image
        import mcp_server
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="c0001" name="Main.xml" path="/"/><component id="label" name="Label.xml" path="/"/><image id="img" name="icon.png" path="/"/></resources></packageDescription>', encoding='utf8')
        (self.pkg / 'Label.xml').write_text('<component extention="Label" size="20,20"><displayList/></component>', encoding='utf8')
        Image.new('RGBA', (2, 2)).save(self.pkg / 'icon.png')
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="20,20"><displayList><!--keep--><component id="n1" src="label"/><text id="n2"/></displayList></component>', encoding='utf8')
        before = execute('read_component', self.args)
        args = {**self.args, 'target': 'n1', 'expected_sha256': before['sha256']}
        props = {'title': 'A & B', 'icon': 'ui://abcdefghimg', 'titleColor': '#123456', 'titleFontSize': 18}
        mcp_server.validate_arguments('set_label_instance_options', {**args, 'props': props})
        with self.assertRaises(ValueError):
            mcp_server.validate_arguments('set_label_instance_options', {**args, 'props': {'checked': True}})
        result = execute('set_label_instance_options', {**args, 'props': props})
        self.assertIn('<!--keep-->', source.read_text(encoding='utf8'))
        self.assertIn('title="A &amp; B"', source.read_text(encoding='utf8'))
        for bad in ({'checked': True}, {'titleFontSize': -1}, {'titleColor': '#12'}, {'icon': 'ui://abcdefghmissing'}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                execute('set_label_instance_options', {**args, 'expected_sha256': result['sha256'], 'props': bad})
        with self.assertRaisesRegex(ValueError, 'Label component'):
            execute('set_label_instance_options', {**args, 'target': 'n2', 'expected_sha256': result['sha256'], 'props': {'title': 'x'}})
        with self.assertRaisesRegex(ValueError, 'sha256'):
            execute('set_label_instance_options', {**args, 'props': {'title': 'stale'}})
        changed = execute('set_label_instance_options', {**args, 'expected_sha256': result['sha256'], 'props': {'title': 'changed'}})
        self.assertIn('icon="ui://abcdefghimg"', source.read_text(encoding='utf8'))
        self.assertNotEqual(changed['sha256'], result['sha256'])

    def test_sample_comparison_reports_missing_published_package(self):
        from test_publish_samples import run
        published = self.root / 'published'
        published.mkdir()
        report = run(self.root, published)
        self.assertEqual(report['matched'], [])
        self.assertEqual(report['missing_packages'], [{'package': 'Demo', 'expected_file': str(published / 'Demo.bin')}])
        script = Path(__file__).with_name('test_publish_samples.py')
        process = subprocess.run([sys.executable, str(script), str(self.root), str(published)], capture_output=True, text=True, encoding='utf8')
        self.assertNotEqual(process.returncode, 0)
        self.assertEqual(json.loads(process.stdout)['counts']['missing_packages'], 1)

    def test_list_packages_does_not_observe_package_creation_staging(self):
        import fgui
        entered, release = threading.Event(), threading.Event()
        staged_locations = []
        original = fgui.rename_new_directory
        def pause_before_commit(source, destination):
            staged_locations.append(Path(source))
            entered.set()
            if not release.wait(10): raise RuntimeError('test timed out waiting to commit')
            return original(source, destination)
        try:
            with patch.object(fgui, 'rename_new_directory', side_effect=pause_before_commit), ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(execute, 'create_package', {'project': str(self.root), 'name': 'NewPackage'})
                self.assertTrue(entered.wait(10))
                self.assertEqual(staged_locations[0].parent.parent, self.root / 'assets')
                self.assertEqual([item['name'] for item in execute('list_packages', {'project': str(self.root)})], ['Demo'])
                self.assertEqual([item['type'] for item in execute('list_items', {'project': str(self.root), 'pkg': 'Demo'})], ['component'])
                release.set()
                self.assertEqual(future.result(timeout=15)['name'], 'NewPackage')
            self.assertEqual({item['name'] for item in execute('list_packages', {'project': str(self.root)})}, {'Demo', 'NewPackage'})
        finally:
            release.set()

    def test_find_resource_references_and_ignore_literal_url_text(self):
        from PIL import Image
        Image.new('RGBA', (2, 2), 'red').save(self.pkg / 'image.png')
        (self.pkg / 'glyph.fnt').write_text('info size=12 colored=true\nchar id=65 img=img xadvance=2\n', encoding='utf8')
        (self.pkg / 'texture.fnt').write_text('info size=12\n', encoding='utf8')
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="img" name="image.png" path="/" exported="true"/><font id="f1" name="glyph.fnt" path="/"/><font id="f2" name="texture.fnt" path="/" texture="img"/><component id="c0001" name="Main.xml" path="/" exported="true"/></resources></packageDescription>', encoding='utf8')
        (self.pkg / 'Main.xml').write_text('<component size="20,20"><displayList><text id="n1" text="ui://abcdefghmissing"/><loader id="n2" url="ui://abcdefghimg"/></displayList></component>', encoding='utf8')
        other = self.root / 'assets' / 'Other'
        other.mkdir()
        (other / 'package.xml').write_text('<packageDescription id="ijklmnop"><resources><component id="c2" name="C.xml" path="/" exported="true"/></resources></packageDescription>', encoding='utf8')
        (other / 'C.xml').write_text('<component size="20,20"><displayList><image id="n0" src="img" pkg="abcdefgh"/><loader id="n1" url="ui://Demo/image"/></displayList></component>', encoding='utf8')
        report = execute('find_references', {'project': str(self.root), 'pkg': 'Demo', 'item': 'image'})
        self.assertTrue(report['complete'])
        self.assertEqual(sorted(reference['kind'] for reference in report['references']), ['child', 'font_glyph', 'font_texture', 'ui_url', 'ui_url'])
        result = execute('publish_project_experimental', {'project': str(self.root), 'output': str(self.root / 'out'), 'width': 16, 'height': 16})
        self.assertEqual(len(result['packages']), 2)
        (other / 'C.xml').write_text('<component>', encoding='utf8')
        incomplete = execute('find_references', {'project': str(self.root), 'pkg': 'Demo', 'item': 'img'})
        self.assertFalse(incomplete['complete'])
        self.assertEqual(incomplete['warnings'][0]['resource'], 'C.xml')

    def test_rich_text_inline_images_are_published_and_protected(self):
        from PIL import Image
        from xml.etree import ElementTree as ET
        from fgui import component_resource_urls
        from published import inspect
        Image.new('RGBA', (2, 2), 'red').save(self.pkg / 'local.png')
        Image.new('RGBA', (2, 2), 'blue').save(self.pkg / 'unused.png')
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="local" name="local.png" path="/"/><image id="unused" name="unused.png" path="/"/><component id="c0001" name="Main.xml" path="/" exported="true"/></resources></packageDescription>', encoding='utf8')
        other = self.root / 'assets' / 'Other'
        other.mkdir()
        Image.new('RGBA', (2, 2), 'green').save(other / 'icon.png')
        other_package = other / 'package.xml'
        other_package.write_text('<packageDescription id="ijklmnop"><resources><image id="icon" name="icon.png" path="/" exported="true"/></resources></packageDescription>', encoding='utf8')
        component = ET.Element('component', {'size': '20,20'})
        display = ET.SubElement(component, 'displayList')
        rich = ET.SubElement(display, 'richtext', {'id': 'n1', 'ubb': 'true', 'text': '[img]ui://abcdefghlocal[/img] <img src="ui://Other/icon"/> ui://abcdefghunused \\[img]ui://abcdefghunused[/img]'})
        ET.SubElement(rich, 'gearText', {'controller': 'state', 'pages': '0', 'values': '[IMG]ui://abcdefghlocal[/img]', 'default': '[img]ui://Other/icon[/img]'})
        ET.SubElement(component, 'controller', {'name': 'state', 'pages': '0,normal'})
        (self.pkg / 'Main.xml').write_bytes(ET.tostring(component, encoding='utf8'))
        urls = [url for _, _, url in component_resource_urls(component)]
        self.assertEqual(urls.count('ui://abcdefghlocal'), 2)
        self.assertEqual(urls.count('ui://Other/icon'), 2)
        self.assertNotIn('ui://abcdefghunused', urls)
        references = execute('find_references', {'project': str(self.root), 'pkg': 'Demo', 'item': 'local'})
        self.assertEqual(len([item for item in references['references'] if item['kind'] == 'ui_url']), 2)
        package = execute('read_package', {'project': str(self.root), 'pkg': 'Demo'})
        with self.assertRaisesRegex(ValueError, 'detected reference'):
            execute('unregister_resource', {'project': str(self.root), 'pkg': 'Demo', 'item': 'local', 'expected_sha256': package['sha256']})
        args = {'project': str(self.root), 'output': str(self.root / 'all'), 'width': 16, 'height': 16}
        result = execute('publish_project_experimental', args)
        entry = next(item for item in result['packages'] if item['package'] == 'Demo')
        decoded = inspect((Path(result['output']) / entry['file']).read_bytes())
        self.assertIn('local', {item['id'] for item in decoded['items']})
        self.assertNotIn('unused', {item['id'] for item in decoded['items']})
        self.assertEqual(decoded['dependencies'], [{'id': 'ijklmnop', 'name': 'Other'}])
        other_package.write_text('<packageDescription id="ijklmnop"><resources><image id="icon" name="icon.png" path="/"/></resources></packageDescription>', encoding='utf8')
        with self.assertRaisesRegex(ValueError, 'UI URL not included'):
            execute('publish_project_experimental', {**args, 'output': str(self.root / 'missing')})
        self.assertFalse((self.root / 'missing').exists())

    def test_publish_text_and_icon_transition_actions_with_inline_image_dependencies(self):
        from PIL import Image
        from published import inspect
        Image.new('RGBA', (2, 2), 'red').save(self.pkg / 'image.png')
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="img" name="image.png" path="/"/><component id="c0001" name="Main.xml" path="/" exported="true"/></resources></packageDescription>', encoding='utf8')
        xml = '<component size="20,20"><displayList><richtext id="n1" size="10,10" ubb="true"/><loader id="n2" size="10,10"/></displayList><transition name="t"><item type="Text" target="n1" time="0" value="[img]ui://abcdefghimg[/img]"/><item type="Icon" target="n2" time="12" value="ui://Demo/image"/></transition></component>'
        (self.pkg / 'Main.xml').write_text(xml, encoding='utf8')
        result = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'out'), 'width': 16, 'height': 16, 'exported_only': True})
        decoded = inspect(Path(result['file']).read_bytes())
        self.assertIn('img', {item['id'] for item in decoded['items']})
        component = next(item['component'] for item in decoded['items'] if item['id'] == 'c0001')
        items = component['transitions'][0]['items']
        self.assertEqual([(item['type'], item['target'], item['value']) for item in items], [(14, 0, '[img]ui://abcdefghimg[/img]'), (15, 1, 'ui://Demo/image')])
        import shutil
        build = Path(os.environ.get('FGUI_COCOS_BUILD', 'E:/game_dev/FairyGUI-cocoscreator/source/build'))
        if (build / 'UIPackage.js').is_file() and shutil.which('node'):
            reader = Path(__file__).with_name('check_cocos_reader.cjs')
            runtime = json.loads(subprocess.run(['node', str(reader), str(build), result['file']], capture_output=True, text=True, encoding='utf8', check=True).stdout)
            actions = next(item for item in runtime['constructed'] if item['id'] == 'c0001')['transitions'][0]['items']
            self.assertEqual([(item['type'], item['value']['text']) for item in actions], [(14, '[img]ui://abcdefghimg[/img]'), (15, 'ui://Demo/image')])
        references = execute('find_references', {'project': str(self.root), 'pkg': 'Demo', 'item': 'img'})
        self.assertEqual(len([item for item in references['references'] if item['kind'] == 'ui_url']), 2)

    def test_publish_static_and_tweened_transition_colors(self):
        from published import inspect
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="c0001" name="Main.xml" path="/" exported="true"/></resources></packageDescription>', encoding='utf8')
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="20,20"><displayList><text id="n1" size="10,10" text="x"/></displayList><transition name="t" options="6"><item type="Color" target="n1" time="0" value="#123456"/><item type="Color" target="n1" time="12" tween="true" startValue="#123456" endValue="#abcdef" duration="24"/></transition></component>', encoding='utf8')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'out')}
        result = execute('publish_simple_experimental', args)
        decoded = inspect(Path(result['file']).read_bytes())
        transition = next(item['component'] for item in decoded['items'] if item['id'] == 'c0001')['transitions'][0]
        self.assertEqual(transition['options'], 6)
        items = transition['items']
        self.assertEqual(items[0]['value'], [18, 52, 86, 255])
        self.assertEqual((items[1]['tween']['start'], items[1]['tween']['end']), ([18, 52, 86, 255], [171, 205, 239, 255]))
        import shutil
        build = Path(os.environ.get('FGUI_COCOS_BUILD', 'E:/game_dev/FairyGUI-cocoscreator/source/build'))
        if (build / 'UIPackage.js').is_file() and shutil.which('node'):
            reader = Path(__file__).with_name('check_cocos_reader.cjs')
            runtime = json.loads(subprocess.run(['node', str(reader), str(build), result['file']], capture_output=True, text=True, encoding='utf8', check=True).stdout)
            runtime_transition = next(item for item in runtime['constructed'] if item['id'] == 'c0001')['transitions'][0]
            self.assertEqual(runtime_transition['options'], 6)
            actions = runtime_transition['items']
            self.assertEqual(actions[0]['value']['f1'], 0x123456)
            self.assertEqual((actions[1]['tween']['startValue']['f1'], actions[1]['tween']['endValue']['f1']), (0x123456, 0xabcdef))
        source.write_text(source.read_text(encoding='utf8').replace('#123456', '#12345z'), encoding='utf8')
        with self.assertRaisesRegex(ValueError, 'invalid transition color'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'invalid')})
        source.write_text(source.read_text(encoding='utf8').replace('#12345z', '#123456').replace('options="6"', 'options="-1"'), encoding='utf8')
        with self.assertRaisesRegex(ValueError, 'invalid transition options'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'invalid-options')})

    def test_unregister_resource_checks_references_and_preserves_source_file(self):
        from PIL import Image
        image = self.pkg / 'image.png'
        Image.new('RGBA', (2, 2), 'red').save(image)
        package = self.pkg / 'package.xml'
        package.write_text('<packageDescription id="abcdefgh"><resources><!--keep--><component id="c0001" name="Main.xml" path="/"/><image id="img" name="image.png" path="/"/></resources></packageDescription>', encoding='utf8')
        component = self.pkg / 'Main.xml'
        component.write_text('<component size="20,20"><displayList><image id="n1" src="img"/></displayList></component>', encoding='utf8')
        settings = self.root / 'settings' / 'Common.json'
        settings.parent.mkdir()
        settings.write_text('{"nested":{"resource":"ui://abcdefghimg"}}', encoding='utf8')
        args = {'project': str(self.root), 'pkg': 'Demo', 'item': 'img'}
        before = execute('read_package', args)
        report = execute('find_references', args)
        self.assertEqual({item['kind'] for item in report['references']}, {'child', 'project_setting'})
        with self.assertRaisesRegex(ValueError, 'detected reference'):
            execute('unregister_resource', {**args, 'expected_sha256': before['sha256']})
        component.write_text('<component size="20,20"><displayList/></component>', encoding='utf8')
        settings.write_text('{"broken":', encoding='utf8')
        with self.assertRaisesRegex(ValueError, 'scan was incomplete'):
            execute('unregister_resource', {**args, 'expected_sha256': before['sha256']})
        settings.write_text('{}', encoding='utf8')
        with patch('fgui.atomic_replace_checked', side_effect=OSError('write failed')):
            with self.assertRaises(OSError): execute('unregister_resource', {**args, 'expected_sha256': before['sha256']})
        self.assertEqual(execute('read_package', args), before)
        result = execute('unregister_resource', {**args, 'expected_sha256': before['sha256']})
        self.assertEqual(Path(result['retained_file']), image)
        self.assertTrue(image.is_file())
        self.assertIn('<!--keep-->', package.read_text(encoding='utf8'))
        self.assertNotIn('img', [item['id'] for item in execute('list_items', args)])
        self.assertTrue(execute('validate', args)['valid'])
        with self.assertRaisesRegex(ValueError, 'sha256'):
            execute('unregister_resource', {**args, 'expected_sha256': before['sha256']})

    def test_project_validation_resolves_component_references(self):
        from PIL import Image
        other = self.root / 'assets' / 'Other'
        other.mkdir()
        (other / 'package.xml').write_text('<packageDescription id="external"><resources><image id="img" name="i.png" path="/"/></resources></packageDescription>', encoding='utf8')
        Image.new('RGBA', (1, 1)).save(other / 'i.png')
        source = self.pkg / 'Main.xml'
        valid = '<component><controller name="state" pages="0,off,1,on"/><displayList><image id="n1" src="img" pkg="external"><gearDisplay controller="state" pages="1"/><relation target="n2" sidePair="width-width"/></image><group id="n2"/></displayList><transition name="t"><item target="n1"/></transition></component>'
        source.write_text(valid, encoding='utf8')
        self.assertTrue(execute('validate', self.args)['valid'])
        cases = [
            ('src="img"', 'src="missing"', 'unknown resource'),
            ('<image id="n1"', '<component id="n1"', 'requires component resource'),
            ('pkg="external"', 'pkg="missing"', 'unknown package'),
            ('pages="1"', 'pages="2"', 'unknown page'),
            ('controller="state"', 'controller="missing"', 'unknown controller'),
            ('target="n2"', 'target="missing"', 'invalid target'),
            ('target="n1"', 'target="missing"', 'unknown target'),
        ]
        for before, after, expected in cases:
            with self.subTest(expected=expected):
                changed = valid.replace(before, after)
                if before.startswith('<image'): changed = changed.replace('</image>', '</component>')
                source.write_text(changed, encoding='utf8')
                report = execute('validate', self.args)
                self.assertFalse(report['valid'])
                self.assertTrue(any(expected in issue['error'] for issue in report['issues']))

    def test_write_rejects_new_broken_references_but_allows_existing_issues(self):
        source = self.pkg / 'Main.xml'
        original = '<component><displayList><image id="old" src="absent"/><text id="n1"/></displayList></component>'
        source.write_text(original, encoding='utf8')
        before = execute('read_component', self.args)
        bad = original.replace('<text id="n1"/>', '<text id="n1"><gearDisplay controller="missing" pages="1"/></text>')
        with self.assertRaisesRegex(ValueError, 'new invalid component reference.*unknown controller'):
            execute('write_component', {**self.args, 'xml': bad, 'expected_sha256': before['sha256']})
        self.assertEqual(source.read_text(encoding='utf8'), original)
        good = original.replace('<text id="n1"/>', '<text id="n1" text="changed"/>')
        execute('write_component', {**self.args, 'xml': good, 'expected_sha256': before['sha256']})
        self.assertEqual(source.read_text(encoding='utf8'), good)
        current = execute('read_component', self.args)
        with self.assertRaisesRegex(ValueError, 'new invalid component reference.*unknown controller'):
            execute('insert_object', {**self.args, 'expected_sha256': current['sha256'], 'object_xml': '<text id="new"><gearDisplay controller="missing"/></text>'})
        self.assertEqual(source.read_text(encoding='utf8'), good)

    def test_component_mask_and_hit_test_references_are_checked(self):
        source = self.pkg / 'Main.xml'
        valid = '<component mask="n1" hitTest="n2" reversedMask="true"><displayList><graph id="n1"/><graph id="n2"/></displayList></component>'
        source.write_text(valid, encoding='utf8')
        self.assertTrue(execute('validate', self.args)['valid'])
        before = execute('read_component', self.args)
        for changed, expected in (
            (valid.replace('mask="n1"', 'mask="missing"'), 'mask references unknown child'),
            (valid.replace('hitTest="n2"', 'hitTest="missing"'), 'hitTest references unknown child'),
            (valid.replace('mask="n1" ', ''), 'reversedMask requires a mask'),
        ):
            with self.subTest(expected=expected):
                with self.assertRaisesRegex(ValueError, expected):
                    execute('write_component', {**self.args, 'xml': changed, 'expected_sha256': before['sha256']})
                self.assertEqual(source.read_text(encoding='utf8'), valid)
                source.write_text(changed, encoding='utf8')
                report = execute('validate', self.args)
                self.assertTrue(any(expected in issue['error'] for issue in report['issues']))
                source.write_text(valid, encoding='utf8')

    def test_static_ui_url_references_are_validated(self):
        from PIL import Image
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="c0001" name="Main.xml" path="/"/><image id="img01" name="icon.png" path="/"/></resources></packageDescription>', encoding='utf8')
        Image.new('RGBA', (1, 1)).save(self.pkg / 'icon.png')
        source = self.pkg / 'Main.xml'
        valid = '<component><displayList><loader id="n1" url="ui://abcdefghimg01"/><loader id="n2" url="ui://Demo/icon"/></displayList></component>'
        source.write_text(valid, encoding='utf8')
        self.assertTrue(execute('validate', self.args)['valid'])
        before = execute('read_component', self.args)
        for old, new in (('ui://abcdefghimg01', 'ui://abcdefghmissing'), ('ui://Demo/icon', 'ui://Demo/missing')):
            changed = valid.replace(old, new)
            with self.subTest(url=new):
                with self.assertRaisesRegex(ValueError, 'unknown or ambiguous UI URL'):
                    execute('write_component', {**self.args, 'xml': changed, 'expected_sha256': before['sha256']})
                self.assertEqual(source.read_text(encoding='utf8'), valid)
                source.write_text(changed, encoding='utf8')
                self.assertFalse(execute('validate', self.args)['valid'])
                source.write_text(valid, encoding='utf8')
    def test_mcp_utf8_stdio_ignores_process_default_encoding(self):
        chinese = self.root / 'assets' / '界面'
        chinese.mkdir()
        (chinese / 'package.xml').write_text('<packageDescription id="cjk"><resources/></packageDescription>', encoding='utf8')
        request = {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': 'list_packages', 'arguments': {'project': str(self.root)}}}
        env = {**os.environ, 'PYTHONIOENCODING': 'ascii'}
        process = subprocess.run([sys.executable, str(Path(__file__).with_name('mcp_server.py'))], input=(json.dumps(request, ensure_ascii=False) + '\n').encode('utf8'), capture_output=True, env=env, check=True)
        result = json.loads(process.stdout.decode('utf8'))
        data = json.loads(result['result']['content'][0]['text'])
        self.assertIn('界面', [pkg['name'] for pkg in data['data']])

    def test_mcp_unexpected_tool_failure_keeps_server_alive(self):
        import mcp_server
        requests = [
            {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': 'list_packages', 'arguments': {'project': str(self.root)}}},
            {'jsonrpc': '2.0', 'id': 2, 'method': 'ping'},
        ]
        stdin = io.StringIO(''.join(json.dumps(request) + '\n' for request in requests))
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.object(mcp_server.sys, 'stdin', stdin), patch.object(mcp_server.sys, 'stdout', stdout), patch.object(mcp_server.sys, 'stderr', stderr), patch.object(mcp_server, 'execute', side_effect=RuntimeError('unexpected failure')):
            mcp_server.main()
        responses = [json.loads(line) for line in stdout.getvalue().splitlines()]
        self.assertTrue(responses[0]['result']['isError'])
        self.assertIn('internal tool error', responses[0]['result']['content'][0]['text'])
        self.assertEqual(responses[1]['result'], {})
        self.assertIn('unexpected failure', stderr.getvalue())

    def test_output_directory_retry_respects_existing_destination(self):
        import fgui
        source = self.root / 'staging'
        source.mkdir()
        target = self.root / 'output'
        error = PermissionError('temporary sharing violation')
        error.winerror = 5
        real_rename = fgui.os.rename
        with patch.object(fgui.os, 'rename', side_effect=[error, None]) as rename, patch.object(fgui.time, 'sleep') as sleep:
            fgui.rename_new_directory(source, target)
        self.assertEqual(rename.call_count, 2)
        sleep.assert_called_once_with(0.05)
        target.mkdir()
        with patch.object(fgui.os, 'rename', wraps=real_rename) as rename:
            with self.assertRaises(FileExistsError): fgui.rename_new_directory(source, target)
            rename.assert_not_called()

    def test_read_write_and_conflict(self):
        before = execute('read_component', self.args)
        new = '<component><displayList><text id="n1" text="你好"/></displayList></component>'
        execute('write_component', {**self.args, 'xml': new, 'expected_sha256': before['sha256']})
        self.assertEqual(execute('read_component', self.args)['xml'], new)
        with self.assertRaises(ValueError):
            execute('write_component', {**self.args, 'xml': before['xml'], 'expected_sha256': before['sha256']})
        self.assertEqual((self.pkg / 'Main.xml').read_text(encoding='utf8'), new)

    def test_bad_xml_is_never_written(self):
        before = execute('read_component', self.args)
        for xml in ('<component>', '<component><displayList><text id="x"/><text id="x"/></displayList></component>', '<!DOCTYPE component><component/>'):
            with self.assertRaises(ValueError):
                execute('write_component', {**self.args, 'xml': xml, 'expected_sha256': before['sha256']})
        self.assertEqual(execute('read_component', self.args), before)

    def test_set_properties_preserves_other_xml(self):
        original = '<?xml version="1.0"?><component><!-- keep --><displayList><text id="n1" name="label" text="old"/><graph id="n2"/></displayList></component>'
        (self.pkg / 'Main.xml').write_text(original, encoding='utf8')
        before = execute('read_component', self.args)
        execute('set_properties', {**self.args, 'target': 'n1', 'props': {'text': 'A & B', 'xy': '10,20'}, 'expected_sha256': before['sha256']})
        changed = (self.pkg / 'Main.xml').read_text(encoding='utf8')
        self.assertEqual(changed, original.replace('text="old"', 'text="A &amp; B" xy="10,20"'))
        with self.assertRaises(ValueError):
            execute('set_properties', {**self.args, 'target': 'n1', 'props': {'text': 'again'}, 'expected_sha256': before['sha256']})

    def test_display_gear_create_replace_and_validation(self):
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="20,20"><controller name="state" pages="0,off,1,on"/><displayList><text id="n1" name="label"/><graph id="n2"><relation target="" sidePair="width-width"/></graph></displayList></component>', encoding='utf8')
        before = execute('read_component', self.args)
        first = execute('set_display_gear', {**self.args, 'target': 'label', 'controller': 'state', 'pages': ['1'], 'expected_sha256': before['sha256']})
        second = execute('set_display_gear', {**self.args, 'target': 'n1', 'controller': 'state', 'pages': ['0'], 'expected_sha256': first['sha256']})
        third = execute('set_display_gear', {**self.args, 'target': 'n2', 'controller': 'state', 'pages': ['0', '1'], 'expected_sha256': second['sha256']})
        text = execute('read_component', self.args)['xml']
        self.assertEqual(text.count('<gearDisplay'), 2)
        self.assertIn('<relation target="" sidePair="width-width"/>', text)
        with self.assertRaisesRegex(ValueError, 'unknown page'):
            execute('set_display_gear', {**self.args, 'target': 'n1', 'controller': 'state', 'pages': ['missing'], 'expected_sha256': third['sha256']})
        with self.assertRaisesRegex(ValueError, 'sha256'):
            execute('set_display_gear', {**self.args, 'target': 'n1', 'controller': 'state', 'pages': ['1'], 'expected_sha256': first['sha256']})
        output = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'gear')})
        children = execute('inspect_published', {'project': str(self.root), 'file': output['file']})['items'][0]['component']['children']
        self.assertEqual(children[0]['gears'][0]['pages'], ['0'])
        self.assertEqual(children[1]['gears'][0]['pages'], ['0', '1'])

    def test_text_gear_create_replace_and_publish(self):
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="20,20"><controller name="state" pages="0,off,1,on"/><displayList><text id="n1" name="label"/><graph id="n2"/></displayList></component>', encoding='utf8')
        before = execute('read_component', self.args)
        args = {**self.args, 'target': 'label', 'controller': 'state', 'pages': ['0', '1'], 'values': ['A & B', '显示'], 'default': 'default', 'expected_sha256': before['sha256']}
        created = execute('set_text_gear', args)
        updated = execute('set_text_gear', {**args, 'values': ['first', 'second'], 'expected_sha256': created['sha256']})
        content = execute('read_component', self.args)['xml']
        self.assertEqual(content.count('<gearText'), 1)
        self.assertIn('values="first|second"', content)
        for bad in ({'values': ['a|b', 'c']}, {'values': ['one']}, {'pages': ['missing'], 'values': ['x']}, {'target': 'n2'}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                execute('set_text_gear', {**args, **bad, 'expected_sha256': updated['sha256']})
        self.assertEqual(execute('read_component', self.args)['sha256'], updated['sha256'])
        output = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'text-gear')})
        gear = execute('inspect_published', {'project': str(self.root), 'file': output['file']})['items'][0]['component']['children'][0]['gears'][0]
        self.assertEqual((gear['type'], [item['value'] for item in gear['values']], gear['default']), (6, ['first', 'second'], 'default'))

    def test_set_relation_preserves_other_relations_and_gears(self):
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="20,20"><controller name="state" pages="0,off,1,on"/><displayList><text id="n1" name="label"><gearDisplay controller="state" pages="1"/><relation target="" sidePair="width"/><relation target="n2" sidePair="left-left"/></text><graph id="n2" name="box"/></displayList></component>', encoding='utf8')
        before = execute('read_component', self.args)
        first = execute('set_relation', {**self.args, 'target': 'label', 'related_to': '', 'side_pairs': ['width', 'height'], 'expected_sha256': before['sha256']})
        second = execute('set_relation', {**self.args, 'target': 'n1', 'related_to': 'box', 'side_pairs': ['right-right'], 'expected_sha256': first['sha256']})
        xml = execute('read_component', self.args)['xml']
        self.assertEqual(xml.count('<relation '), 2)
        self.assertIn('gearDisplay', xml)
        for related, pairs in [('n1', ['width']), ('missing', ['width']), ('', ['width', 'width-width']), ('', ['invalid'])]:
            with self.subTest(related=related, pairs=pairs), self.assertRaises(ValueError):
                execute('set_relation', {**self.args, 'target': 'n1', 'related_to': related, 'side_pairs': pairs, 'expected_sha256': second['sha256']})
        self.assertEqual(execute('read_component', self.args)['sha256'], second['sha256'])
        result = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'relations')})
        relations = execute('inspect_published', {'project': str(self.root), 'file': result['file']})['items'][0]['component']['children'][0]['relations']
        self.assertEqual([(entry['target'], [definition['type'] for definition in entry['definitions']]) for entry in relations], [(-1, [14, 15]), (1, [6])])

    def test_list_and_remove_controller_behaviors(self):
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="20,20"><controller name="state" pages="0,off,1,on" selected="1"/><displayList><text id="n1" name="label"><gearDisplay controller="state" pages="1"/><gearText controller="state" pages="0,1" values="off|on"/><relation target="" sidePair="width"/><relation target="n2" sidePair="left-left"/></text><graph id="n2" name="box"/></displayList></component>', encoding='utf8')
        listing = execute('list_controllers', self.args)
        self.assertEqual(listing['controllers'][0]['pages'], [{'id': '0', 'name': 'off'}, {'id': '1', 'name': 'on'}])
        self.assertEqual(listing['controllers'][0]['selected'], 1)
        children = execute('list_children', self.args)
        self.assertEqual([behavior['type'] for behavior in children['children'][0]['behaviors']], ['gearDisplay', 'gearText', 'relation', 'relation'])
        first = execute('remove_gear', {**self.args, 'target': 'label', 'gear': 'text', 'expected_sha256': listing['sha256']})
        second = execute('remove_relation', {**self.args, 'target': 'n1', 'related_to': 'box', 'expected_sha256': first['sha256']})
        after = execute('list_children', self.args)
        self.assertEqual([behavior['type'] for behavior in after['children'][0]['behaviors']], ['gearDisplay', 'relation'])
        self.assertEqual(after['children'][0]['behaviors'][1]['attributes']['target'], '')
        with self.assertRaisesRegex(ValueError, 'not found'):
            execute('remove_gear', {**self.args, 'target': 'n1', 'gear': 'text', 'expected_sha256': second['sha256']})
        with self.assertRaisesRegex(ValueError, 'sha256'):
            execute('remove_relation', {**self.args, 'target': 'n1', 'related_to': '', 'expected_sha256': first['sha256']})
        self.assertEqual(execute('list_children', self.args), after)

    def test_replace_retry_rechecks_hash_before_overwrite(self):
        import hashlib
        import fgui
        source = self.root / 'staged'
        target = self.root / 'target'
        source.write_bytes(b'new')
        target.write_bytes(b'old')
        failure = PermissionError('busy')
        failure.winerror = 5
        def race(*unused):
            target.write_bytes(b'external')
            raise failure
        with patch.object(fgui.os, 'replace', side_effect=race) as replace, patch.object(fgui.time, 'sleep'):
            with self.assertRaisesRegex(ValueError, 'changed during write'):
                fgui.atomic_replace_checked(source, target, hashlib.sha256(b'old').hexdigest())
        self.assertEqual(replace.call_count, 1)
        self.assertEqual(target.read_bytes(), b'external')

    def test_controller_pages_reject_removed_references(self):
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="20,20"><!--keep--><displayList><text id="n1"/></displayList></component>', encoding='utf8')
        pages = [{'id': '0', 'name': 'normal'}, {'id': '1', 'name': 'selected'}]
        before = execute('read_component', self.args)
        ctrl = execute('create_controller', {**self.args, 'controller': 'state', 'pages': pages, 'selected': 1, 'expected_sha256': before['sha256']})
        updated = execute('insert_object', {**self.args, 'object_xml': '<graph id="n2"><gearDisplay controller="state" pages="1"/></graph>', 'expected_sha256': ctrl['sha256']})
        saved = execute('read_component', self.args)
        self.assertIn('<!--keep-->', saved['xml'])
        with self.assertRaisesRegex(ValueError, 'unknown page'):
            execute('set_controller_pages', {**self.args, 'controller': 'state', 'pages': pages[:1], 'selected': 0, 'expected_sha256': updated['sha256']})
        self.assertEqual(execute('read_component', self.args), saved)
        pages.append({'id': '2', 'name': 'disabled'})
        changed = execute('set_controller_pages', {**self.args, 'controller': 'state', 'pages': pages, 'expected_sha256': updated['sha256']})
        self.assertIn('selected="1"', execute('read_component', self.args)['xml'])
        published = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'ctrl')})
        controller = execute('inspect_published', {'project': str(self.root), 'file': published['file']})['items'][0]['component']['controllers'][0]
        self.assertEqual(controller['pages'], pages)
        with self.assertRaisesRegex(ValueError, 'sha256'):
            execute('set_controller_pages', {**self.args, 'controller': 'state', 'pages': pages, 'expected_sha256': updated['sha256']})
        with self.assertRaises(ValueError):
            execute('set_controller_pages', {**self.args, 'controller': 'state', 'pages': [{'id': '0', 'name': 'bad,comma'}], 'expected_sha256': changed['sha256']})

    def test_set_component_properties_preserves_children_and_checks_revision(self):
        from published import inspect
        source = self.pkg / 'Main.xml'
        source.write_text('<?xml version="1.0" encoding="utf-8"?>\n<!-- keep -->\n<component size=\'20,30\' custom="x&gt;y"><displayList><text id="n1" text="unchanged"/></displayList></component>', encoding='utf8')
        before = execute('read_component', self.args)
        props = {'size': '40,50', 'pivot': '0.5,0.25', 'opaque': False, 'overflow': 'hidden', 'margin': '1,2,3,4'}
        result = execute('set_component_properties', {**self.args, 'props': props, 'expected_sha256': before['sha256']})
        changed = source.read_text(encoding='utf8')
        self.assertIn('<!-- keep -->', changed)
        self.assertIn('<text id="n1" text="unchanged"/>', changed)
        self.assertIn('size="40,50"', changed)
        with self.assertRaisesRegex(ValueError, 'sha256'):
            execute('set_component_properties', {**self.args, 'props': props, 'expected_sha256': before['sha256']})
        for bad in ({'size': '0,1'}, {'margin': '1,2,3'}, {'opaque': 'false'}, {'overflow': 'bad'}, {'extention': 'Button'}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                execute('set_component_properties', {**self.args, 'props': bad, 'expected_sha256': result['sha256']})
        self.assertEqual(source.read_text(encoding='utf8'), changed)
        source.write_text(changed.replace(' custom="x&gt;y"', ''), encoding='utf8')
        result = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'out')})
        component = next(item for item in inspect(Path(result['file']).read_bytes())['items'] if item['type'] == 3)
        self.assertEqual((component['width'], component['height']), (40, 50))
        self.assertEqual(component['component']['base']['margin'], [1, 2, 3, 4])

    def test_set_button_options_preserves_xml_and_checks_sound_reference(self):
        from published import inspect
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="c0001" name="Main.xml" path="/"/><sound id="snd" name="click.wav" path="/"/></resources></packageDescription>', encoding='utf8')
        (self.pkg / 'click.wav').write_bytes(b'RIFF placeholder')
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="20,30" extention="Button"><!--keep--><displayList/></component>', encoding='utf8')
        before = execute('read_component', self.args)
        props = {'mode': 'Radio', 'sound': 'ui://abcdefghsnd', 'downEffect': 'scale', 'downEffectValue': 0.5}
        result = execute('set_button_options', {**self.args, 'props': props, 'expected_sha256': before['sha256']})
        self.assertIn('<!--keep-->', source.read_text(encoding='utf8'))
        published = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'out')})
        button = next(item for item in inspect(Path(published['file']).read_bytes())['items'] if item['type'] == 3)['component']['button']
        self.assertEqual((button['mode'], button['sound'], button['downEffect'], button['downEffectValue']), (2, 'ui://abcdefghsnd', 2, 0.5))
        changed = execute('set_button_options', {**self.args, 'props': {'mode': 'Check', 'sound': ''}, 'expected_sha256': result['sha256']})
        self.assertIn('mode="Check"', source.read_text(encoding='utf8'))
        current = source.read_bytes()
        for bad in ({'mode': 'CheckBox'}, {'sound': 'ui://abcdefghmissing'}, {'downEffectValue': True}, {'downEffect': 'other'}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                execute('set_button_options', {**self.args, 'props': bad, 'expected_sha256': changed['sha256']})
        with self.assertRaisesRegex(ValueError, 'sha256'):
            execute('set_button_options', {**self.args, 'props': {'mode': 'Radio'}, 'expected_sha256': result['sha256']})
        self.assertEqual(source.read_bytes(), current)

    def test_insert_and_move_display_list_order_preserve_references(self):
        from published import inspect
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="20,20"><displayList><graph id="a" name="first" type="rect"/><text id="b"><relation target="a" sidePair="width-width"/></text><graph id="c" type="rect"/></displayList></component>', encoding='utf8')
        before = execute('read_component', self.args)
        inserted = execute('insert_object', {**self.args, 'expected_sha256': before['sha256'], 'index': 1, 'object_xml': '<text id="x" text="new"/>'})
        self.assertEqual([child['id'] for child in execute('list_children', self.args)['children']], ['a', 'x', 'b', 'c'])
        moved = execute('move_object', {**self.args, 'expected_sha256': inserted['sha256'], 'target': 'first', 'index': 3})
        self.assertEqual([child['id'] for child in execute('list_children', self.args)['children']], ['x', 'b', 'c', 'a'])
        self.assertIn('target="a"', source.read_text(encoding='utf8'))
        saved = source.read_bytes()
        for bad in (-1, 4, True):
            with self.subTest(index=bad), self.assertRaises(ValueError):
                execute('move_object', {**self.args, 'expected_sha256': moved['sha256'], 'target': 'a', 'index': bad})
        with self.assertRaises(ValueError): execute('insert_object', {**self.args, 'expected_sha256': moved['sha256'], 'index': 5, 'object_xml': '<text id="new"/>'})
        with self.assertRaisesRegex(ValueError, 'sha256'): execute('move_object', {**self.args, 'expected_sha256': inserted['sha256'], 'target': 'a', 'index': 0})
        self.assertEqual(source.read_bytes(), saved)
        result = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'out')})
        children = next(item for item in inspect(Path(result['file']).read_bytes())['items'] if item['type'] == 3)['component']['children']
        self.assertEqual([child['id'] for child in children], ['x', 'b', 'c', 'a'])
        self.assertEqual(children[1]['relations'][0]['target'], 3)
        from PIL import Image
        image = self.root / 'input.png'
        Image.new('RGBA', (2, 2), 'red').save(image)
        imported = execute('import_image', {'project': str(self.root), 'pkg': 'Demo', 'source': str(image)})
        current = execute('read_component', self.args)
        resource = execute('insert_resource', {**self.args, 'expected_sha256': current['sha256'], 'ref_name': imported['id'], 'index': 0})
        self.assertEqual(execute('list_children', self.args)['children'][0]['id'], resource['id'])

    def test_list_children_and_atomic_batch_edits(self):
        source = self.pkg / 'Main.xml'
        original = '<component><!--keep--><displayList><text id="n1" name="label" text="old"/><graph id="n2" name="box"/></displayList></component>'
        source.write_text(original, encoding='utf8')
        listing = execute('list_children', self.args)
        self.assertEqual([(child['type'], child['id'], child['name']) for child in listing['children']], [('text', 'n1', 'label'), ('graph', 'n2', 'box')])
        args = {**self.args, 'expected_sha256': listing['sha256']}
        invalid = [{'target': 'n1', 'props': {'text': 'new'}}, {'target': 'n2', 'props': {'xy': 'bad'}}]
        with self.assertRaises(ValueError): execute('set_properties_batch', {**args, 'changes': invalid})
        self.assertEqual(source.read_text(encoding='utf8'), original)
        changes = [{'target': 'label', 'props': {'text': 'new'}}, {'target': 'n2', 'props': {'xy': '10,20'}}]
        result = execute('set_properties_batch', {**args, 'changes': changes})
        updated = execute('list_children', self.args)
        self.assertEqual(result['sha256'], updated['sha256'])
        self.assertEqual([item['attributes'].get('text') for item in updated['children']], ['new', None])
        self.assertEqual(updated['children'][1]['attributes']['xy'], '10,20')
        self.assertIn('<!--keep-->', source.read_text(encoding='utf8'))
        with self.assertRaisesRegex(ValueError, 'sha256'): execute('set_properties_batch', {**args, 'changes': changes})
        self.assertEqual(execute('list_children', self.args), updated)

    def test_batch_matches_sequential_edits_and_name_resolution(self):
        from fgui import edit_child_attributes, edit_children_batch
        xml = b'<component><!--keep--><displayList><text id="same" name="same" text="a &gt; b"/><text id="b" name="other"/></displayList></component>'
        changes = [{'target': 'same', 'props': {'name': 'new', 'text': 'X & Y'}},
                   {'target': 'new', 'props': {'xy': '12,13'}},
                   {'target': 'same', 'props': {'fontSize': 14}},
                   {'target': 'other', 'props': {'name': 'new'}}]
        sequential = xml
        for change in changes: sequential = edit_child_attributes(sequential, change['target'], change['props'])
        batch = edit_children_batch(xml, changes)
        self.assertEqual(batch, sequential)
        self.assertIn(b'<!--keep-->', batch)
        with self.assertRaisesRegex(ValueError, 'ambiguous'):
            edit_children_batch(xml, changes + [{'target': 'new', 'props': {'xy': '1,2'}}])

    def test_mcp_lists_batch_tool_and_rejects_invalid_batch(self):
        requests = [
            {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'},
            {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': 'set_properties_batch', 'arguments': {**self.args, 'expected_sha256': 'x', 'changes': []}}},
            {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': 'list_children', 'arguments': self.args}},
        ]
        process = subprocess.run([sys.executable, str(Path(__file__).with_name('mcp_server.py'))], input=''.join(json.dumps(request) + '\n' for request in requests), capture_output=True, text=True, encoding='utf8', check=True)
        replies = [json.loads(line) for line in process.stdout.splitlines()]
        tools = {item['name']: item for item in replies[0]['result']['tools']}
        self.assertIn('set_properties_batch', tools)
        self.assertEqual(tools['set_properties_batch']['inputSchema']['properties']['changes']['minItems'], 1)
        self.assertTrue(replies[1]['result']['isError'])
        data = json.loads(replies[2]['result']['content'][0]['text'])
        self.assertEqual(data['data']['children'][0]['id'], 'n1')

    def test_edit_text_style_and_pivot_is_publishable(self):
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="100,100"><displayList><text id="n1" name="label"/><graph id="n2"/></displayList></component>', encoding='utf8')
        before = execute('read_component', self.args)
        changes = [{'target': 'n1', 'props': {'pivot': '0.5,0.5', 'anchor': True, 'grayed': True}},
                   {'target': 'n1', 'props': {'fontSize': 22, 'bold': True, 'italic': True, 'align': 'center', 'vAlign': 'middle', 'autoSize': 'none', 'leading': 4, 'letterSpacing': 2}}]
        result = execute('set_properties_batch', {**self.args, 'expected_sha256': before['sha256'], 'changes': changes})
        published = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'styled')})
        info = execute('inspect_published', {'project': str(self.root), 'file': published['file']})
        child = info['items'][0]['component']['children'][0]
        self.assertEqual((child['pivot'], child['grayed'], child['fontSize'], child['bold'], child['italic'], child['align'], child['verticalAlign'], child['leading'], child['letterSpacing']), ([0.5, 0.5, True], True, 22, True, True, 1, 1, 4, 2))
        for target, props in [('n2', {'bold': True}), ('n2', {'align': 'left'}), ('n2', {'anchor': True}), ('n1', {'autoSize': 'bogus'}), ('n1', {'leading': 40000}), ('n1', {'pivot': 'nan,0'})]:
            with self.subTest(props=props), self.assertRaises(ValueError):
                execute('set_properties', {**self.args, 'target': target, 'props': props, 'expected_sha256': result['sha256']})
        self.assertEqual(execute('read_component', self.args)['sha256'], result['sha256'])

    def test_invalid_property_values_do_not_modify_file(self):
        before = execute('read_component', self.args)
        for target, props in [('n1', {'xy': 'x,2'}), ('n1', {'xy': '1.5,2'}), ('n1', {'xy': '2147483648,2'}), ('n1', {'size': '1,2.5'}), ('n1', {'fontSize': True}), ('n1', {'fontSize': 32768}), ('n1', {'size': '-1,2'}), ('n1', {'alpha': 2}), ('n1', {'visible': 'yes'}), ('n1', {'visible': 1}), ('n1', {'fontSize': 'nan'}), ('n1', {'color': 'red'}), ('missing', {'xy': '1,2'})]:
            with self.subTest(props=props), self.assertRaises(ValueError):
                execute('set_properties', {**self.args, 'target': target, 'props': props, 'expected_sha256': before['sha256']})
        self.assertEqual(execute('read_component', self.args), before)

    def test_font_size_is_serialized_as_integer(self):
        before = execute('read_component', self.args)
        execute('set_properties', {**self.args, 'target': 'n1', 'props': {'fontSize': 12.0}, 'expected_sha256': before['sha256']})
        self.assertIn('fontSize="12"', execute('read_component', self.args)['xml'])

    def test_insert_object_and_reject_invalid_references(self):
        before = execute('read_component', self.args)
        common = {**self.args, 'expected_sha256': before['sha256']}
        with self.assertRaises(ValueError):
            execute('insert_object', {**common, 'object_xml': '<image id="x" src="missing"/>'})
        with self.assertRaisesRegex(ValueError, 'requires resource type image'):
            execute('insert_object', {**common, 'object_xml': '<image id="x" src="c0001"/>'})
        with self.assertRaises(ValueError):
            execute('insert_object', {**common, 'object_xml': '<text id="n1"/>'})
        self.assertEqual(execute('read_component', self.args), before)
        execute('insert_object', {**common, 'object_xml': '<text id="n2" text="Hello"/>'})
        self.assertIn('<text id="n2" text="Hello"/>', execute('read_component', self.args)['xml'])
        with self.assertRaises(ValueError):
            execute('insert_object', {**common, 'object_xml': '<text id="n3"/>'})

    def test_insert_into_self_closing_display_list(self):
        (self.pkg / 'Main.xml').write_text('<component><displayList/></component>', encoding='utf8')
        before = execute('read_component', self.args)
        execute('insert_object', {**self.args, 'expected_sha256': before['sha256'], 'object_xml': '<graph id="g"/>'})
        self.assertIn('<displayList><graph id="g"/></displayList>', execute('read_component', self.args)['xml'])

    def test_insert_resource_requires_registered_file(self):
        from PIL import Image
        pkg = self.pkg / 'package.xml'
        pkg.write_text('<packageDescription id="abcdefgh"><resources><component id="c0001" name="Main.xml" path="/"/><image id="i1" name="image.png" path="/"/></resources></packageDescription>')
        before = execute('read_component', self.args)
        args = {**self.args, 'object_xml': '<image id="n2" src="i1"/>', 'expected_sha256': before['sha256']}
        with self.assertRaisesRegex(ValueError, 'file is missing'): execute('insert_object', args)
        Image.new('RGBA', (2, 2)).save(self.pkg / 'image.png')
        execute('insert_object', args)
        self.assertIn('src="i1"', execute('read_component', self.args)['xml'])

    def test_insert_resource_by_name_and_cross_package(self):
        from PIL import Image
        image = self.root / 'input.png'
        Image.new('RGBA', (2, 3), (20, 30, 40, 255)).save(image)
        image_item = execute('import_image', {'project': str(self.root), 'pkg': 'Demo', 'source': str(image), 'path': '/images/'})
        before = execute('read_component', self.args)
        added = execute('insert_resource', {**self.args, 'ref_name': 'input', 'object_name': '图标', 'x': 12, 'y': -5, 'expected_sha256': before['sha256']})
        child = next(c for c in execute('list_children', self.args)['children'] if c['id'] == added['id'])
        self.assertEqual((child['type'], child['attributes']['src'], child['attributes']['xy']), ('image', image_item['id'], '12,-5'))
        self.assertEqual(child['name'], '图标')
        other = execute('create_package', {'project': str(self.root), 'name': 'Other'})
        target = execute('create_component', {'project': str(self.root), 'pkg': other['id'], 'name': 'Target', 'width': 5, 'height': 6, 'exported': True})
        cross = execute('insert_resource', {**self.args, 'ref_pkg': 'Other', 'ref_name': target['id'], 'expected_sha256': added['sha256']})
        child = next(c for c in execute('list_children', self.args)['children'] if c['id'] == cross['id'])
        self.assertEqual((child['type'], child['attributes']['src'], child['attributes']['pkg']), ('component', target['id'], other['id']))
        before_failure = execute('read_component', self.args)
        with self.assertRaises(ValueError):
            execute('insert_resource', {**self.args, 'ref_name': 'missing', 'expected_sha256': cross['sha256']})
        with self.assertRaises(ValueError):
            execute('insert_resource', {**self.args, 'ref_name': image_item['id'], 'x': 1.5, 'expected_sha256': cross['sha256']})
        self.assertEqual(execute('read_component', self.args), before_failure)

    def test_remove_object_refuses_references_and_preserves_siblings(self):
        f = self.pkg / 'Main.xml'
        f.write_text('<component><displayList><text id="a"/><graph id="b"><relation target="a"/></graph></displayList></component>', encoding='utf8')
        before = execute('read_component', self.args)
        with self.assertRaises(ValueError):
            execute('remove_object', {**self.args, 'target': 'a', 'expected_sha256': before['sha256']})
        self.assertEqual(execute('read_component', self.args), before)
        execute('remove_object', {**self.args, 'target': 'b', 'expected_sha256': before['sha256']})
        after = execute('read_component', self.args)
        self.assertEqual(after['xml'], '<component><displayList><text id="a"/></displayList></component>')
        execute('remove_object', {**self.args, 'target': 'a', 'expected_sha256': after['sha256']})
        self.assertEqual(execute('read_component', self.args)['xml'], '<component><displayList></displayList></component>')

    def test_import_image_registers_validates_and_rolls_back(self):
        from PIL import Image
        image_path = self.root / 'input.png'
        Image.new('RGBA', (3, 2), (10, 20, 30, 40)).save(image_path)
        package = self.pkg / 'package.xml'
        package.write_text('<packageDescription id="abcdefgh"><!--keep--><resources/></packageDescription>', encoding='utf8')
        args = {'project': str(self.root), 'pkg': 'Demo', 'source': str(image_path), 'name': '新图片.png', 'exported': True}
        result = execute('import_image', args)
        self.assertEqual((result['name'], result['width'], result['height']), ('新图片.png', 3, 2))
        self.assertEqual(Path(result['path']).read_bytes(), image_path.read_bytes())
        self.assertIn('<!--keep-->', package.read_text(encoding='utf8'))
        self.assertEqual(execute('list_items', args)[0]['id'], result['id'])
        with self.assertRaises(ValueError): execute('import_image', args)
        with self.assertRaisesRegex(ValueError, 'extension does not match'):
            execute('import_image', {**args, 'name': 'wrong.jpg'})
        with self.assertRaises(ValueError): execute('import_image', {**args, 'name': '../escape.png'})
        before = package.read_bytes()
        with patch('fgui.os.replace', side_effect=OSError('replace failed')):
            with self.assertRaisesRegex(OSError, 'replace failed'):
                execute('import_image', {**args, 'name': 'rollback.png'})
        self.assertEqual(package.read_bytes(), before)
        self.assertFalse((self.pkg / 'rollback.png').exists())
        self.assertFalse(list(self.pkg.glob('.fgui-package-*.tmp')))

    def test_image_options_preserve_package_and_publish_metadata(self):
        from PIL import Image
        image = self.root / 'input.png'
        Image.new('RGBA', (7, 5), (1, 2, 3, 255)).save(image)
        imported = execute('import_image', {'project': str(self.root), 'pkg': 'Demo', 'source': str(image)})
        args = {'project': str(self.root), 'pkg': 'Demo'}
        before = execute('read_package', args)
        result = execute('set_image_options', {**args, 'item': imported['id'], 'expected_sha256': before['sha256'], 'props': {'scale': '9grid', 'scale9grid': '1,1,3,2', 'duplicatePadding': True, 'exported': True}})
        entry = next(item for item in execute('list_items', args) if item['id'] == imported['id'])
        self.assertEqual((entry['scale'], entry['scale9grid'], entry['duplicatePadding'], entry['exported']), ('9grid', '1,1,3,2', 'true', 'true'))
        published = execute('publish_simple_experimental', {**args, 'output': str(self.root / 'out'), 'exported_only': True})
        image_info = next(item for item in execute('inspect_published', {**args, 'file': published['file']})['items'] if item['id'] == imported['id'])
        self.assertEqual(image_info['scale9Grid'], [1,1,3,2])
        with self.assertRaisesRegex(ValueError, 'sha256'):
            execute('set_image_options', {**args, 'item': imported['id'], 'expected_sha256': before['sha256'], 'props': {'scale': 'tile'}})
        unchanged = execute('read_package', args)
        for props in ({'scale': 'tile', 'scale9grid': '1,1,2,2'}, {'scale9grid': '1,1,0,2'}, {'duplicatePadding': 'true'}):
            with self.subTest(props=props), self.assertRaises(ValueError):
                execute('set_image_options', {**args, 'item': imported['id'], 'expected_sha256': result['sha256'], 'props': props})
        self.assertEqual(execute('read_package', args), unchanged)
        tile = execute('set_image_options', {**args, 'item': imported['id'], 'expected_sha256': result['sha256'], 'props': {'scale': 'tile'}})
        entry = next(item for item in execute('list_items', args) if item['id'] == imported['id'])
        self.assertEqual(entry['scale'], 'tile')
        self.assertNotIn('scale9grid', entry)
        self.assertEqual(tile['sha256'], execute('read_package', args)['sha256'])

    def test_import_pcm_sound_and_jta_movieclip_with_validation(self):
        import wave
        from test_jta import sample_jta
        from published import inspect
        sound = self.root / 'effect.wav'
        with wave.open(str(sound), 'wb') as output:
            output.setnchannels(1); output.setsampwidth(2); output.setframerate(8000); output.writeframes(b'\x00\x00' * 80)
        movie = self.root / 'clip.jta'
        movie.write_bytes(sample_jta())
        base = {'project': str(self.root), 'pkg': 'Demo', 'path': '/media/', 'exported': True}
        snd = execute('import_sound', {**base, 'source': str(sound)})
        clip = execute('import_movieclip', {**base, 'source': str(movie)})
        self.assertEqual((snd['channels'], snd['sample_rate'], snd['frames']), (1, 8000, 80))
        self.assertEqual((clip['width'], clip['height'], clip['frames']), (4, 3, 2))
        result = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'out'), 'exported_only': True, 'width': 32, 'height': 32})
        published = inspect(Path(result['file']).read_bytes())
        self.assertEqual({item['id'] for item in published['items'] if item['type'] in (1, 2)}, {snd['id'], clip['id']})
        report = execute('validate_published', {'project': str(self.root), 'file': result['file'], 'compare_source': True, 'exported_only': True})
        self.assertTrue(report['valid'], report['issues'])
        self.assertEqual(report['movieclip_comparison']['checked_frames'], 2)
        self.assertEqual(report['sound_comparison']['checked'], 1)
        for command, path in [('import_sound', sound), ('import_movieclip', movie)]:
            broken = self.root / ('broken' + path.suffix)
            broken.write_bytes(path.read_bytes()[:-10])
            with self.subTest(command=command), self.assertRaises(ValueError):
                execute(command, {**base, 'source': str(broken)})
            self.assertFalse((self.pkg / 'media' / broken.name).exists())
        with patch('fgui.atomic_replace_checked', side_effect=OSError('fail')):
            with self.assertRaises(OSError): execute('import_sound', {**base, 'source': str(sound), 'name': 'rollback.wav', 'path': '/new/nested/'})
        self.assertFalse((self.pkg / 'new').exists())

    def test_import_mp3_and_ogg_publish_without_changing_audio_bytes(self):
        import shutil
        sample = Path(os.environ.get('FGUI_COCOS_DEMO', 'E:/game_dev/FairyGUI-cocoscreator/demo')) / 'UIProject/assets/Transition/images/BUZZ4.mp3'
        if not sample.is_file(): self.skipTest('Cocos sample MP3 unavailable')
        base = {'project': str(self.root), 'pkg': 'Demo', 'exported': True}
        mp3 = execute('import_sound', {**base, 'source': str(sample)})
        self.assertEqual(mp3['format'], 'mp3')
        self.assertIn('not decoded', mp3['validation'])
        invalid = self.root / 'broken.mp3'
        invalid.write_bytes(sample.read_bytes()[:-1])
        with self.assertRaises(ValueError): execute('import_sound', {**base, 'source': str(invalid)})
        expected = {mp3['id']: sample.read_bytes()}
        ffmpeg = shutil.which('ffmpeg')
        if ffmpeg:
            ogg = self.root / 'sound.ogg'
            process = subprocess.run([ffmpeg, '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.1', '-c:a', 'libvorbis', '-y', str(ogg)], capture_output=True)
            if process.returncode == 0:
                imported = execute('import_sound', {**base, 'source': str(ogg)})
                self.assertEqual(imported['format'], 'ogg-vorbis')
                expected[imported['id']] = ogg.read_bytes()
        result = execute('publish_simple_experimental', {**base, 'output': str(self.root / 'out'), 'exported_only': True})
        from published import inspect
        items = {item['id']: item for item in inspect(Path(result['file']).read_bytes())['items'] if item['type'] == 2}
        self.assertEqual(set(items), set(expected))
        for ident, data in expected.items():
            self.assertEqual((Path(result['output']) / ('Demo_' + items[ident]['file'])).read_bytes(), data)
        report = execute('validate_published', {'project': str(self.root), 'file': result['file'], 'compare_source': True, 'exported_only': True})
        self.assertTrue(report['valid'], report['issues'])

    def test_import_bitmap_fonts_validate_and_publish_dependencies(self):
        from PIL import Image
        image = self.root / 'texture.png'
        Image.new('RGBA', (8, 8), 'red').save(image)
        image_item = execute('import_image', {'project': str(self.root), 'pkg': 'Demo', 'source': str(image)})
        bmfont = self.root / 'font.fnt'
        bmfont.write_text('info size=12\ncommon lineHeight=12 pages=1\nchar id=65 x=1 y=1 width=3 height=3 page=0 xadvance=4 chnl=0\n', encoding='utf8')
        args = {'project': str(self.root), 'pkg': 'Demo', 'source': str(bmfont), 'texture': image_item['id'], 'path': '/fonts/', 'exported': True}
        font = execute('import_font', args)
        self.assertEqual((font['glyphs'], font['font_size'], font['texture']), (1, 12, image_item['id']))
        glyph_font = self.root / 'glyph.fnt'
        glyph_font.write_text(f'info size=12 colored=true\nchar id=65 img={image_item["id"]} xadvance=4\n', encoding='utf8')
        glyph = execute('import_font', {'project': str(self.root), 'pkg': 'Demo', 'source': str(glyph_font), 'exported': True})
        self.assertIsNone(glyph['texture'])
        report = execute('validate', {'project': str(self.root), 'check_media': True})
        self.assertTrue(report['valid'], report['issues'])
        self.assertEqual(report['media_checked']['font'], 2)
        published = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'out'), 'exported_only': True, 'width': 32, 'height': 32})
        self.assertEqual(published['fonts'], 2)
        report = execute('validate_published', {'project': str(self.root), 'file': published['file'], 'compare_source': True, 'exported_only': True})
        self.assertTrue(report['valid'], report['issues'])
        invalid = self.root / 'invalid.fnt'
        invalid.write_text(bmfont.read_text(encoding='utf8').replace('width=3', 'width=30'), encoding='utf8')
        with self.assertRaisesRegex(ValueError, 'exceeds texture'):
            execute('import_font', {**args, 'source': str(invalid)})
        with self.assertRaisesRegex(ValueError, 'not found or ambiguous'):
            execute('import_font', {**args, 'name': 'missing.fnt', 'texture': 'missing'})
        with patch('fgui.atomic_replace_checked', side_effect=OSError('fail')):
            with self.assertRaises(OSError): execute('import_font', {**args, 'name': 'rollback.fnt', 'path': '/new/fonts/'})
        self.assertFalse((self.pkg / 'new').exists())

    def test_import_image_to_subdirectory_and_reject_escape(self):
        from PIL import Image
        image_path = self.root / 'input.png'
        Image.new('RGBA', (3, 2), (10, 20, 30, 40)).save(image_path)
        args = {'project': str(self.root), 'pkg': 'Demo', 'source': str(image_path), 'path': '/images/界面/'}
        result = execute('import_image', args)
        self.assertEqual(Path(result['path']), self.pkg / 'images' / '界面' / 'input.png')
        entry = next(item for item in execute('list_items', args) if item['id'] == result['id'])
        self.assertEqual(entry['path'], '/images/界面/')
        self.assertTrue(execute('validate', args)['valid'])
        with self.assertRaises(ValueError): execute('import_image', args)
        with self.assertRaisesRegex(ValueError, 'invalid package path'):
            execute('import_image', {**args, 'path': '../escape'})
        before = (self.pkg / 'package.xml').read_bytes()
        with patch('fgui.os.replace', side_effect=OSError('replace failed')):
            with self.assertRaises(OSError): execute('import_image', {**args, 'path': '/new/nested/'})
        self.assertFalse((self.pkg / 'new').exists())
        self.assertEqual((self.pkg / 'package.xml').read_bytes(), before)

    def test_cross_process_write_lock(self):
        before = execute('read_component', self.args)
        script = ('import sys;sys.path.insert(0,sys.argv[1]);from fgui import project_write_lock,project_root;'
                  'lock=project_write_lock(project_root(sys.argv[2]));lock.__enter__();'
                  'print("locked",flush=True);sys.stdin.readline();lock.__exit__(None,None,None)')
        child = subprocess.Popen([sys.executable, '-u', '-c', script, str(Path(__file__).parent), str(self.root)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            self.assertEqual(child.stdout.readline().strip(), 'locked')
            with self.assertRaisesRegex(ValueError, 'another offline operation'):
                execute('write_component', {**self.args, 'xml': before['xml'], 'expected_sha256': before['sha256']})
            for command, extra in [('publish_simple_experimental', {'pkg': 'Demo', 'output': str(self.root / 'published')}), ('atlas_layout', {'pkg': 'Demo'}), ('atlas_export', {'pkg': 'Demo', 'output': str(self.root / 'atlas')}), ('validate', {})]:
                with self.subTest(command=command), self.assertRaisesRegex(ValueError, 'another offline operation'):
                    execute(command, {'project': str(self.root), **extra})
            self.assertFalse((self.root / 'published').exists())
        finally:
            child.communicate('\n', timeout=10)
        self.assertEqual(child.returncode, 0)
        execute('write_component', {**self.args, 'xml': before['xml'], 'expected_sha256': before['sha256']})

    def test_publish_locks_only_its_own_project(self):
        import fgui
        from PIL import Image
        image = self.pkg / 'image.png'
        Image.new('RGBA', (2, 2), (1, 2, 3, 255)).save(image)
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="i" name="image.png" path="/"/></resources></packageDescription>', encoding='utf8')
        other = self.root / 'other-project'
        (other / 'assets').mkdir(parents=True)
        (other / 'project.fairy').write_text('<projectDescription id="other"/>', encoding='utf8')
        entered, release = threading.Event(), threading.Event()
        original_plan = fgui.atlas_plan
        def blocking_plan(*args, **kwargs):
            entered.set()
            if not release.wait(15): raise RuntimeError('test timed out')
            return original_plan(*args, **kwargs)
        try:
            with patch.object(fgui, 'atlas_plan', side_effect=blocking_plan), ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(execute, 'publish_images_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'output'), 'width': 16, 'height': 16})
                self.assertTrue(entered.wait(10))
                with self.assertRaisesRegex(ValueError, 'another offline operation'):
                    execute('create_package', {'project': str(self.root), 'name': 'Blocked'})
                created = execute('create_package', {'project': str(other), 'name': 'Independent'})
                self.assertEqual(created['name'], 'Independent')
                release.set()
                self.assertTrue(Path(future.result(timeout=15)['file']).is_file())
        finally:
            release.set()

    def test_preflight_reports_multiple_package_failures_without_project_changes(self):
        from PIL import Image
        Image.new('RGBA', (2, 2), 'red').save(self.pkg / 'image.png')
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="i" name="image.png" path="/" exported="true"/></resources></packageDescription>', encoding='utf8')
        for name, ident, element, data in [('Unsupported', 'ijklmnop', '<swf id="x" name="bad.swf" path="/" exported="true"/>', b'file'), ('Broken', 'qrstuvwx', '<image id="x" name="bad.png" path="/" exported="true"/>', b'bad')]:
            folder = self.root / 'assets' / name
            folder.mkdir()
            (folder / 'package.xml').write_text(f'<packageDescription id="{ident}"><resources>{element}</resources></packageDescription>', encoding='utf8')
            (folder / ('bad.swf' if name == 'Unsupported' else 'bad.png')).write_bytes(data)
        empty = self.root / 'assets' / 'Empty'
        empty.mkdir()
        (empty / 'package.xml').write_text('<packageDescription id="empty"><resources/></packageDescription>', encoding='utf8')
        before = {path: path.read_bytes() for path in self.root.rglob('*') if path.is_file()}
        report = execute('preflight_publish', {'project': str(self.root), 'width': 16, 'height': 16})
        self.assertFalse(report['valid'])
        self.assertEqual(report['counts'], {'passed': 1, 'failed': 2, 'skipped': 1})
        records = {item['package']: item for item in report['packages']}
        self.assertEqual(records['Demo']['status'], 'passed')
        self.assertIn('unsupported resource types', records['Unsupported']['errors'][0])
        self.assertTrue(records['Broken']['errors'])
        self.assertEqual({path: path.read_bytes() for path in self.root.rglob('*') if path.is_file()}, before)

    def test_preflight_propagates_failed_package_dependencies(self):
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="a" name="A.xml" path="/" exported="true"/></resources></packageDescription>', encoding='utf8')
        (self.pkg / 'A.xml').write_text('<component size="10,10"><displayList><component id="n1" src="b" pkg="ijklmnop"/></displayList></component>', encoding='utf8')
        other = self.root / 'assets' / 'Other'
        other.mkdir()
        (other / 'package.xml').write_text('<packageDescription id="ijklmnop"><resources><component id="b" name="B.xml" path="/" exported="true"/></resources></packageDescription>', encoding='utf8')
        (other / 'B.xml').write_text('<component size="10,10"><displayList><image id="n1" src="c" pkg="qrstuvwx"/></displayList></component>', encoding='utf8')
        third = self.root / 'assets' / 'Third'
        third.mkdir()
        (third / 'package.xml').write_text('<packageDescription id="qrstuvwx"><resources><image id="c" name="bad.png" path="/" exported="true"/></resources></packageDescription>', encoding='utf8')
        (third / 'bad.png').write_bytes(b'invalid')
        report = execute('preflight_publish', {'project': str(self.root), 'width': 16, 'height': 16})
        self.assertEqual(report['counts']['failed'], 3)
        records = {item['package']: item for item in report['packages']}
        self.assertTrue(any('dependency package did not pass' in error for error in records['Demo']['errors']))
        self.assertTrue(any('dependency package did not pass' in error for error in records['Other']['errors']))

    def test_publish_project_is_atomic_and_reports_packages(self):
        import fgui
        from PIL import Image
        image = self.pkg / 'a.png'
        Image.new('RGBA', (2, 2), 'red').save(image)
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="a" name="a.png" path="/" exported="true"/></resources></packageDescription>', encoding='utf8')
        second = self.root / 'assets' / 'Other'
        second.mkdir()
        Image.new('RGBA', (2, 2), 'blue').save(second / 'b.png')
        (second / 'package.xml').write_text('<packageDescription id="ijklmnop"><resources><image id="b" name="b.png" path="/" exported="true"/></resources></packageDescription>', encoding='utf8')
        empty = self.root / 'assets' / 'Empty'
        empty.mkdir()
        (empty / 'package.xml').write_text('<packageDescription id="empty"><resources/></packageDescription>', encoding='utf8')
        args = {'project': str(self.root), 'output': str(self.root / 'all'), 'width': 16, 'height': 16}
        result = execute('publish_project_experimental', args)
        self.assertEqual({item['package'] for item in result['packages']}, {'Demo', 'Other'})
        self.assertEqual(result['skipped'][0]['package'], 'Empty')
        self.assertEqual(json.loads(Path(result['manifest']).read_text(encoding='utf8'))['packages'], result['packages'])
        for entry in result['packages']:
            self.assertTrue((Path(result['output']) / entry['file']).is_file())
        (second / 'package.xml').write_text('<packageDescription id="ijklmnop"><resources><image id="b" name="b.png" path="/" exported="true"/><swf id="s" name="s.swf" path="/"/></resources></packageDescription>', encoding='utf8')
        (second / 's.swf').write_bytes(b'swf')
        failed = self.root / 'failed'
        with self.assertRaisesRegex(ValueError, 'unsupported resource types'):
            execute('publish_project_experimental', {**args, 'output': str(failed), 'exported_only': False})
        self.assertFalse(failed.exists())
        self.assertFalse(list(self.root.glob('.fgui-project-*')))
        original_execute = fgui._execute
        def change_after_first(command, child_args):
            value = original_execute(command, child_args)
            if command == 'publish_simple_experimental' and child_args['pkg'] == 'Demo':
                Image.new('RGBA', (2, 2), 'green').save(image)
            return value
        changed = self.root / 'changed'
        with patch.object(fgui, '_execute', side_effect=change_after_first), self.assertRaisesRegex(ValueError, 'source changed'):
            execute('publish_project_experimental', {**args, 'output': str(changed)})
        self.assertFalse(changed.exists())

    def test_publish_project_manifest_includes_cross_package_dependencies(self):
        from PIL import Image
        other = self.root / 'assets' / 'Other'
        other.mkdir()
        Image.new('RGBA', (2, 2), 'red').save(other / 'image.png')
        (other / 'package.xml').write_text('<packageDescription id="ijklmnop"><resources><image id="img" name="image.png" path="/" exported="true"/></resources></packageDescription>', encoding='utf8')
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="c0001" name="Main.xml" path="/" exported="true"/></resources></packageDescription>', encoding='utf8')
        (self.pkg / 'Main.xml').write_text('<component size="20,20"><displayList><image id="n1" src="img" pkg="ijklmnop"/></displayList></component>', encoding='utf8')
        result = execute('publish_project_experimental', {'project': str(self.root), 'output': str(self.root / 'all'), 'width': 16, 'height': 16})
        main = next(item for item in result['packages'] if item['package'] == 'Demo')
        self.assertEqual(main['dependencies'], [{'id': 'ijklmnop', 'name': 'Other'}])

    def test_publish_many_cross_package_children_uses_one_package_catalog(self):
        import fgui
        from PIL import Image
        other = self.root / 'assets' / 'Other'
        other.mkdir()
        Image.new('RGBA', (2, 2), 'red').save(other / 'image.png')
        (other / 'package.xml').write_text('<packageDescription id="ijklmnop"><resources><image id="img" name="image.png" path="/" exported="true"/></resources></packageDescription>', encoding='utf8')
        for index in range(20):
            folder = self.root / 'assets' / f'Unrelated{index}'
            folder.mkdir()
            (folder / 'package.xml').write_text(f'<packageDescription id="u{index:07}"><resources/></packageDescription>', encoding='utf8')
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="c0001" name="Main.xml" path="/"/></resources></packageDescription>', encoding='utf8')
        children = ''.join(f'<image id="n{i}" src="img" pkg="ijklmnop"/>' for i in range(300))
        (self.pkg / 'Main.xml').write_text('<component size="20,20"><displayList>' + children + '</displayList></component>', encoding='utf8')
        with patch.object(fgui, 'find_package', wraps=fgui.find_package) as lookup:
            result = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'all'), 'width': 16, 'height': 16})
        self.assertEqual(result['dependencies'], [{'id': 'ijklmnop', 'name': 'Other'}])
        self.assertEqual(lookup.call_count, 1)

    def test_publish_detects_other_package_metadata_changed(self):
        import fgui
        from PIL import Image
        image = self.pkg / 'image.png'
        Image.new('RGBA', (2, 2), 'red').save(image)
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="i" name="image.png" path="/"/></resources></packageDescription>', encoding='utf8')
        other = self.root / 'assets' / 'Other'
        other.mkdir()
        metadata = other / 'package.xml'
        metadata.write_text('<packageDescription id="ijklmnop"><resources/></packageDescription>', encoding='utf8')
        original = fgui.render
        def change_metadata(*args, **kwargs):
            canvases = original(*args, **kwargs)
            metadata.write_text('<packageDescription id="changed"><resources/></packageDescription>', encoding='utf8')
            return canvases
        output = self.root / 'output'
        with patch.object(fgui, 'render', side_effect=change_metadata), self.assertRaisesRegex(ValueError, 'source changed'):
            execute('publish_images_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(output), 'width': 16, 'height': 16})
        self.assertFalse(output.exists())

    def test_publish_project_checks_external_ui_urls_and_manifest(self):
        from PIL import Image
        other = self.root / 'assets' / 'Other'
        other.mkdir()
        Image.new('RGBA', (2, 2), 'red').save(other / 'image.png')
        other_package = other / 'package.xml'
        other_package.write_text('<packageDescription id="ijklmnop"><resources><image id="img" name="image.png" path="/" exported="true"/></resources></packageDescription>', encoding='utf8')
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="c0001" name="Main.xml" path="/" exported="true"/></resources></packageDescription>', encoding='utf8')
        component = self.pkg / 'Main.xml'
        component.write_text('<component size="20,20"><displayList><loader id="n1" url="ui://ijklmnopimg"/><loader id="n2" url="ui://Other/image"/></displayList></component>', encoding='utf8')
        args = {'project': str(self.root), 'output': str(self.root / 'all'), 'width': 16, 'height': 16}
        result = execute('publish_project_experimental', args)
        main = next(item for item in result['packages'] if item['package'] == 'Demo')
        self.assertEqual(main['dependencies'], [{'id': 'ijklmnop', 'name': 'Other'}])
        self.assertEqual(main['url_dependencies'], main['dependencies'])
        from published import inspect
        binary = inspect((Path(result['output']) / main['file']).read_bytes())
        self.assertEqual(binary['dependencies'], main['dependencies'])
        single = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'single'), 'width': 16, 'height': 16})
        self.assertEqual(inspect(Path(single['file']).read_bytes())['dependencies'], main['dependencies'])
        component.write_text(component.read_text(encoding='utf8').replace('ui://Other/image', 'ui://Other/missing'), encoding='utf8')
        output = self.root / 'missing'
        with self.assertRaisesRegex(ValueError, 'UI URL not included'):
            execute('publish_project_experimental', {**args, 'output': str(output)})
        self.assertFalse(output.exists())

    def test_publish_rejects_image_changed_during_render(self):
        import fgui
        from PIL import Image
        image = self.pkg / 'image.png'
        Image.new('RGBA', (2, 2), 'red').save(image)
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="i" name="image.png" path="/"/></resources></packageDescription>', encoding='utf8')
        original_render = fgui.render
        def change_image(*args, **kwargs):
            result = original_render(*args, **kwargs)
            Image.new('RGBA', (2, 2), 'blue').save(image)
            return result
        output = self.root / 'output'
        with patch.object(fgui, 'render', side_effect=change_image), self.assertRaisesRegex(ValueError, 'publication source changed'):
            execute('publish_images_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(output), 'width': 16, 'height': 16})
        self.assertFalse(output.exists())
        self.assertFalse(list(self.root.glob('.fgui-publish-*')))

    def test_publish_uses_project_extension_and_rejects_unsupported_formats(self):
        from PIL import Image
        from published import inspect
        Image.new('RGBA', (2, 2), 'red').save(self.pkg / 'image.png')
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="i" name="image.png" path="/"/></resources></packageDescription>', encoding='utf8')
        settings_file = self.root / 'settings' / 'Publish.json'
        settings_file.parent.mkdir()
        args = {'project': str(self.root), 'pkg': 'Demo', 'width': 16, 'height': 16}
        settings_file.write_text(json.dumps({'binaryFormat': True, 'compressDesc': False, 'fileExtension': 'fui', 'atlasSetting': {'trimImage': True}}), encoding='utf8')
        result = execute('publish_images_experimental', {**args, 'output': str(self.root / 'output')})
        self.assertEqual(Path(result['file']).name, 'Demo.fui')
        self.assertEqual(inspect(Path(result['file']).read_bytes())['name'], 'Demo')
        self.assertTrue(any(warning.get('setting') == 'atlasSetting' for warning in result['warnings']))
        for index, settings in enumerate(({'binaryFormat': False}, {'compressDesc': True}, {'fileExtension': '../bad'}, {'binaryFormat': 'true'})):
            settings_file.write_text(json.dumps(settings), encoding='utf8')
            output = self.root / f'bad-{index}'
            with self.subTest(settings=settings), self.assertRaises(ValueError):
                execute('publish_images_experimental', {**args, 'output': str(output)})
            self.assertFalse(output.exists())

    def test_cocos_compress_setting_uses_uncompressed_output_like_editor(self):
        from PIL import Image
        Image.new('RGBA', (2, 2), 'red').save(self.pkg / 'image.png')
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="i" name="image.png" path="/"/></resources></packageDescription>', encoding='utf8')
        (self.root / 'test.fairy').write_text('<projectDescription id="p" type="CocosCreator"/>', encoding='utf8')
        settings = self.root / 'settings' / 'Publish.json'
        settings.parent.mkdir()
        settings.write_text('{"binaryFormat":true,"compressDesc":true}', encoding='utf8')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'out'), 'width': 16, 'height': 16}
        result = execute('publish_images_experimental', args)
        self.assertEqual(Path(result['file']).read_bytes()[8], 0)
        self.assertTrue(any(item.get('setting') == 'compressDesc' for item in result['warnings']))
        (self.root / 'test.fairy').write_text('<projectDescription id="p" type="Unity"/>', encoding='utf8')
        with self.assertRaisesRegex(ValueError, 'compressed publication'):
            execute('publish_images_experimental', {**args, 'output': str(self.root / 'unity')})

    def test_publish_uses_project_atlas_defaults_and_explicit_overrides(self):
        from PIL import Image
        from published import inspect
        source = Image.new('RGBA', (12, 6), (0, 0, 0, 0))
        for y in (2, 3):
            for x in range(1, 11): source.putpixel((x, y), (255, 0, 0, 255))
        source.save(self.pkg / 'image.png')
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="i" name="image.png" path="/"/></resources></packageDescription>', encoding='utf8')
        settings = self.root / 'settings' / 'Publish.json'
        settings.parent.mkdir()
        settings.write_text(json.dumps({'atlasSetting': {'maxSize': 16, 'trimImage': True, 'allowRotation': True, 'paging': True, 'forceSquare': True, 'sizeOption': 'pot'}}), encoding='utf8')
        base = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'out')}
        result = execute('publish_images_experimental', base)
        self.assertEqual(result['trimmed_images'], 1)
        self.assertTrue(result['atlas_options']['rotate_images'])
        atlas = next(item for item in inspect(Path(result['file']).read_bytes())['items'] if item['type'] == 4)
        self.assertEqual(atlas['width'], atlas['height'])
        self.assertLessEqual(atlas['width'], 16)
        override = execute('publish_images_experimental', {**base, 'output': str(self.root / 'override'), 'trim_images': False, 'rotate_images': False})
        self.assertEqual(override['trimmed_images'], 0)
        self.assertFalse(override['atlas_options']['rotate_images'])
        settings.write_text(json.dumps({'atlasSetting': {'maxSize': 8, 'paging': False}}), encoding='utf8')
        Image.new('RGBA', (6, 6), 'blue').save(self.pkg / 'two.png')
        Image.new('RGBA', (6, 6), 'red').save(self.pkg / 'image.png')
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="i" name="image.png" path="/"/><image id="j" name="two.png" path="/"/></resources></packageDescription>', encoding='utf8')
        with self.assertRaisesRegex(ValueError, 'paging is disabled'):
            execute('publish_images_experimental', {**base, 'output': str(self.root / 'no-paging'), 'padding': 1})
        self.assertFalse((self.root / 'no-paging').exists())

    def test_publish_detects_project_settings_changed_during_render(self):
        import fgui
        from PIL import Image
        Image.new('RGBA', (2, 2), 'red').save(self.pkg / 'image.png')
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="i" name="image.png" path="/"/></resources></packageDescription>', encoding='utf8')
        settings_file = self.root / 'settings' / 'Publish.json'
        settings_file.parent.mkdir()
        settings_file.write_text('{"fileExtension":"bin"}', encoding='utf8')
        original_render = fgui.render
        def change_settings(*args, **kwargs):
            result = original_render(*args, **kwargs)
            settings_file.write_text('{"fileExtension":"fui"}', encoding='utf8')
            return result
        output = self.root / 'output'
        with patch.object(fgui, 'render', side_effect=change_settings), self.assertRaisesRegex(ValueError, 'source changed'):
            execute('publish_images_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(output), 'width': 16, 'height': 16})
        self.assertFalse(output.exists())

    def test_publish_detects_same_size_component_change_with_restored_timestamp(self):
        import fgui
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="20,20"><displayList><text id="n1" text="A"/></displayList></component>', encoding='utf8')
        original_stat = source.stat()
        original_render = fgui.render
        def change_component(*args, **kwargs):
            result = original_render(*args, **kwargs)
            source.write_text(source.read_text(encoding='utf8').replace('text="A"', 'text="B"'), encoding='utf8')
            os.utime(source, ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns))
            return result
        output = self.root / 'output'
        with patch.object(fgui, 'render', side_effect=change_component), self.assertRaisesRegex(ValueError, 'publication source changed'):
            execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(output)})
        self.assertFalse(output.exists())
        self.assertFalse(list(self.root.glob('.fgui-publish-*')))

    def test_create_package_and_build_content(self):
        args = {'project': str(self.root), 'name': '新界面'}
        result = execute('create_package', args)
        self.assertEqual(len(result['id']), 8)
        self.assertEqual(Path(result['path']), self.root / 'assets' / '新界面')
        self.assertIn(result['id'], [pkg['id'] for pkg in execute('list_packages', args)])
        self.assertEqual(execute('list_items', {**args, 'pkg': result['id']}), [])
        component = execute('create_component', {'project': str(self.root), 'pkg': result['id'], 'name': 'Main', 'width': 10, 'height': 10, 'exported': True})
        self.assertIn('size="10,10"', execute('read_component', {'project': str(self.root), 'pkg': '新界面', 'name': component['id']})['xml'])
        self.assertTrue(execute('validate', args)['valid'])
        with self.assertRaises(ValueError): execute('create_package', args)
        with self.assertRaises(ValueError): execute('create_package', {**args, 'name': '../escape'})
        with patch('fgui.rename_new_directory', side_effect=OSError('rename failed')):
            with self.assertRaises(OSError): execute('create_package', {**args, 'name': 'rollback'})
        self.assertFalse((self.root / 'assets' / 'rollback').exists())
        self.assertFalse(list((self.root / 'assets').glob('.fgui-new-package-*')))

    def test_create_supported_component_extensions(self):
        from published import inspect
        entries = {'Label': 11, 'Button': 12, 'ComboBox': 13, 'ProgressBar': 14, 'Slider': 15, 'ScrollBar': 16}
        for extension in entries:
            args = {'project': str(self.root), 'pkg': 'Demo', 'name': extension, 'width': 20, 'height': 30, 'extention': extension, 'exported': True}
            result = execute('create_component', args)
            source = execute('read_component', {**args, 'name': result['id']})['xml']
            self.assertIn(f'extention="{extension}"', source)
        result = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'out'), 'exported_only': True})
        components = {item['name']: item['extension'] for item in inspect(Path(result['file']).read_bytes())['items'] if item['type'] == 3}
        self.assertEqual(components, entries)
        with self.assertRaisesRegex(ValueError, 'unsupported component extention'):
            execute('create_component', {'project': str(self.root), 'pkg': 'Demo', 'name': 'Invalid', 'width': 20, 'height': 30, 'extention': 'CheckBox'})

    def test_create_component_subdirectory_and_rollback(self):
        args = {'project': str(self.root), 'pkg': 'Demo', 'name': '新界面', 'width': 20, 'height': 10, 'path': '/界面/弹窗/'}
        created = execute('create_component', args)
        self.assertEqual(Path(created['path']), self.pkg / '界面' / '弹窗' / '新界面.xml')
        item = next(item for item in execute('list_items', args) if item['id'] == created['id'])
        self.assertEqual(item['path'], '/界面/弹窗/')
        self.assertIn('size="20,10"', execute('read_component', {**args, 'name': created['id']})['xml'])
        with self.assertRaises(ValueError): execute('create_component', args)
        with self.assertRaisesRegex(ValueError, 'invalid package path'):
            execute('create_component', {**args, 'path': '../escape'})
        before = (self.pkg / 'package.xml').read_bytes()
        with patch('fgui.os.replace', side_effect=OSError('replace failed')):
            with self.assertRaises(OSError): execute('create_component', {**args, 'path': '/new/nested/'})
        self.assertFalse((self.pkg / 'new').exists())
        self.assertEqual((self.pkg / 'package.xml').read_bytes(), before)

    def test_create_component_registers_and_rejects_collisions(self):
        args = {'project': str(self.root), 'pkg': 'Demo', 'name': '新组件', 'width': 200, 'height': 100, 'exported': True}
        created = execute('create_component', args)
        self.assertIn('size="200,100"', execute('read_component', {**args, 'name': created['id']})['xml'])
        items = execute('list_items', args)
        item = next(x for x in items if x['id'] == created['id'])
        self.assertEqual((item['name'], item['exported']), ('新组件.xml', 'true'))
        self.assertTrue(execute('validate', args)['valid'])
        with self.assertRaises(ValueError): execute('create_component', args)
        with self.assertRaises(ValueError): execute('create_component', {**args, 'name': '../escape'})

    def test_validation_missing_resource_and_escape(self):
        self.assertTrue(execute('validate', self.args)['valid'])
        (self.pkg / 'Main.xml').unlink()
        self.assertFalse(execute('validate', self.args)['valid'])
        (self.pkg / 'package.xml').write_text('<packageDescription id="a"><resources><component id="c" name="secret.xml" path="/../../"/></resources></packageDescription>')
        self.assertFalse(execute('validate', self.args)['valid'])

    def test_validation_checks_image_data_and_format(self):
        from PIL import Image
        package = self.pkg / 'package.xml'
        package.write_text('<packageDescription id="abcdefgh"><resources><image id="i" name="image.png" path="/"/></resources></packageDescription>', encoding='utf8')
        image = self.pkg / 'image.png'
        image.write_bytes(b'not an image')
        report = execute('validate', self.args)
        self.assertFalse(report['valid'])
        self.assertTrue(any('invalid image data' in issue['error'] for issue in report['issues']))
        Image.new('RGB', (2, 2)).save(image, format='JPEG')
        report = execute('validate', self.args)
        self.assertTrue(report['valid'])
        self.assertTrue(any('does not match' in warning['warning'] for warning in report['warnings']))
        Image.new('RGBA', (2, 2)).save(image, format='PNG')
        self.assertTrue(execute('validate', self.args)['valid'])

    def test_optional_media_validation_reports_corrupt_and_invalid_resources(self):
        import wave
        from PIL import Image
        from test_jta import sample_jta
        Image.new('RGBA', (8, 8), 'red').save(self.pkg / 'texture.png')
        (self.pkg / 'font.fnt').write_text('info size=12\ncommon lineHeight=12 pages=1\nchar id=65 x=1 y=1 width=3 height=3 page=0 xadvance=4 chnl=0\n', encoding='utf8')
        with wave.open(str(self.pkg / 'sound.wav'), 'wb') as output:
            output.setnchannels(1); output.setsampwidth(2); output.setframerate(8000); output.writeframes(b'\0\0' * 80)
        (self.pkg / 'clip.jta').write_bytes(sample_jta())
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="img" name="texture.png" path="/"/><font id="font" name="font.fnt" path="/" texture="img"/><sound id="sound" name="sound.wav" path="/"/><movieclip id="clip" name="clip.jta" path="/"/></resources></packageDescription>', encoding='utf8')
        report = execute('validate', {**self.args, 'check_media': True})
        self.assertTrue(report['valid'], report['issues'])
        self.assertEqual(report['media_checked'], {'sound': 1, 'movieclip': 1, 'font': 1})
        (self.pkg / 'sound.wav').write_bytes(b'broken')
        (self.pkg / 'clip.jta').write_bytes(sample_jta()[:-4])
        font = self.pkg / 'font.fnt'
        font.write_text(font.read_text(encoding='utf8').replace('width=3', 'width=30'), encoding='utf8')
        basic = execute('validate', self.args)
        self.assertTrue(basic['valid'])
        report = execute('validate', {**self.args, 'check_media': True})
        self.assertFalse(report['valid'])
        self.assertEqual({issue['resource'] for issue in report['issues']}, {'sound.wav', 'clip.jta', 'font.fnt'})
        with self.assertRaises(ValueError): execute('validate', {**self.args, 'check_media': 'true'})

    def test_validation_collects_broken_descriptors_and_package_errors(self):
        (self.root / 'test.fairy').write_text('<broken/>', encoding='utf8')
        bad = self.root / 'assets' / 'Bad'
        bad.mkdir()
        (bad / 'package.xml').write_text('<packageDescription', encoding='utf8')
        missing = self.root / 'assets' / 'NoResources'
        missing.mkdir()
        (missing / 'package.xml').write_text('<packageDescription id="other"/>', encoding='utf8')
        (self.pkg / 'Main.xml').write_text('<component><displayList><text id="same"/><text id="same"/></displayList></component>', encoding='utf8')
        report = execute('validate', self.args)
        self.assertFalse(report['valid'])
        errors = [issue['error'] for issue in report['issues']]
        self.assertTrue(any('projectDescription root' in error for error in errors))
        self.assertTrue(any('invalid XML' in error for error in errors))
        self.assertTrue(any('exactly one resources' in error for error in errors))
        self.assertTrue(any('unique nonempty ids' in error for error in errors))

    def test_mcp_stdio(self):
        request = {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': 'list_packages', 'arguments': {'project': str(self.root)}}}
        p = subprocess.run([sys.executable, str(Path(__file__).with_name('mcp_server.py'))], input=json.dumps(request) + '\n', capture_output=True, text=True, check=True)
        result = json.loads(json.loads(p.stdout)['result']['content'][0]['text'])
        self.assertEqual(result['data'][0]['name'], 'Demo')

    def test_mcp_rejects_bad_inputs_and_remains_available(self):
        requests = [
            [],
            {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': 'create_component', 'arguments': {'project': str(self.root), 'pkg': 'Demo', 'name': 'Bad', 'width': True, 'height': 1}}},
            {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': 'list_packages', 'arguments': {'project': str(self.root), 'unexpected': 1}}},
            {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': []},
            {'jsonrpc': '2.0', 'id': 4, 'method': 'tools/call', 'params': {'name': 'list_packages', 'arguments': {'project': str(self.root)}}},
        ]
        p = subprocess.run([sys.executable, str(Path(__file__).with_name('mcp_server.py'))], input=''.join(json.dumps(r) + '\n' for r in requests), capture_output=True, text=True, check=True)
        replies = [json.loads(line) for line in p.stdout.splitlines()]
        self.assertEqual(replies[0]['error']['code'], -32600)
        self.assertTrue(replies[1]['result']['isError'])
        self.assertTrue(replies[2]['result']['isError'])
        self.assertIn('error', replies[3])
        self.assertFalse(replies[4]['result']['isError'])
        self.assertFalse((self.pkg / 'Bad.xml').exists())

    def test_mcp_stdio_rejects_invalid_json_unicode_and_ids_without_exiting(self):
        lines = [
            b'{"jsonrpc":"2.0","id":1,"method":"ping","value":"\\ud800"}',
            b'{"jsonrpc":"2.0","id":2,"method":"ping","value":NaN}',
            b'{"jsonrpc":"2.0","id":true,"method":"ping"}',
            b'{"jsonrpc":"2.0","id":3,"method":"tools/call","params":[]}',
            b'{"jsonrpc":"2.0","id":4,"method":"ping"}',
        ]
        process = subprocess.run([sys.executable, str(Path(__file__).with_name('mcp_server.py'))], input=b'\n'.join(lines) + b'\n', capture_output=True, check=True)
        replies = [json.loads(line) for line in process.stdout.splitlines()]
        self.assertEqual([reply.get('error', {}).get('code') for reply in replies], [-32700, -32700, -32600, -32602, None])
        self.assertEqual(replies[-1]['result'], {})

    def test_mcp_validates_nested_schema_before_calling_tool(self):
        import mcp_server
        base = {'project': str(self.root), 'pkg': 'Demo', 'name': 'Main', 'expected_sha256': 'x'}
        cases = [
            ('set_properties_batch', {**base, 'changes': [{'target': 'n1', 'props': {}, 'extra': True}]}, 'changes[0]'),
            ('create_controller', {**base, 'controller': 'c', 'pages': [{'id': 'a'}]}, 'pages[0]'),
            ('set_relation', {**base, 'target': 'n1', 'related_to': '', 'side_pairs': [5]}, 'side_pairs[0]'),
            ('remove_gear', {**base, 'target': 'n1', 'gear': 'bad'}, 'gear'),
        ]
        with patch.object(mcp_server, 'execute') as operation:
            for name, arguments, expected in cases:
                with self.subTest(name=name):
                    result = mcp_server.dispatch({'method': 'tools/call', 'params': {'name': name, 'arguments': arguments}})
                    self.assertTrue(result['isError'])
                    self.assertIn(expected, result['content'][0]['text'])
            operation.assert_not_called()

    def test_mcp_property_schemas_describe_and_validate_supported_inputs(self):
        import mcp_server
        tools = {tool['name']: tool for tool in mcp_server.dispatch({'method': 'tools/list'})['tools']}
        child_schema = tools['set_properties']['inputSchema']['properties']['props']
        self.assertEqual(child_schema['properties']['align']['enum'], ['left', 'center', 'right'])
        self.assertIn('downEffectValue', tools['set_button_options']['inputSchema']['properties']['props']['properties'])
        base = {'project': str(self.root), 'pkg': 'Demo', 'name': 'Main', 'target': 'n1', 'expected_sha256': 'x'}
        for props in ({'xy': '1,2', 'alpha': 0.5, 'visible': True}, {'fontSize': '12', 'bold': 'false'}):
            mcp_server.validate_arguments('set_properties', {**base, 'props': props})
        for props in ({}, {'unknown': 1}, {'align': 'middle'}, {'visible': 'yes'}, {'alpha': float('inf')}):
            with self.subTest(props=props), self.assertRaises(ValueError):
                mcp_server.validate_arguments('set_properties', {**base, 'props': props})
        button_base = {'project': str(self.root), 'pkg': 'Demo', 'name': 'Main', 'expected_sha256': 'x'}
        mcp_server.validate_arguments('set_button_options', {**button_base, 'props': {'downEffectValue': 1}})
        for value in (True, -1, 11, '1'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                mcp_server.validate_arguments('set_button_options', {**button_base, 'props': {'downEffectValue': value}})

    def test_publish_trims_transparent_images_and_preserves_original_geometry(self):
        from PIL import Image
        from published import inspect
        image = Image.new('RGBA', (8, 7), (20, 30, 40, 0))
        for y in range(2, 5):
            for x in range(3, 6): image.putpixel((x, y), (200, 90, 25, 120))
        image.save(self.pkg / 'normal.png')
        image.save(self.pkg / 'nine.png')
        Image.new('RGBA', (4, 4), (9, 8, 7, 0)).save(self.pkg / 'empty.png')
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="normal" name="normal.png" path="/"/><image id="nine" name="nine.png" path="/" scale="9grid" scale9grid="1,1,2,2"/><image id="empty" name="empty.png" path="/"/></resources></packageDescription>', encoding='utf8')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'out'), 'width': 32, 'height': 32, 'trim_images': True}
        result = execute('publish_images_experimental', args)
        self.assertEqual(result['trimmed_images'], 2)
        info = inspect(Path(result['file']).read_bytes())
        self.assertEqual(info['version'], 2)
        sprites = {sprite['id']: sprite for sprite in info['sprites']}
        self.assertEqual(tuple(sprites['normal'][key] for key in ('width', 'height', 'offset_x', 'offset_y', 'original_width', 'original_height')), (3, 3, 3, 2, 8, 7))
        self.assertEqual((sprites['empty']['width'], sprites['empty']['height']), (1, 1))
        self.assertNotIn('offset_x', sprites['nine'])
        report = execute('validate_published', {'project': str(self.root), 'file': result['file'], 'compare_source': True})
        self.assertTrue(report['valid'], report['issues'])
        build = Path(os.environ.get('FGUI_COCOS_BUILD', 'E:/game_dev/FairyGUI-cocoscreator/source/build'))
        if build.is_dir():
            process = subprocess.run(['node', str(Path(__file__).with_name('check_cocos_reader.cjs')), str(build), result['file']], capture_output=True, text=True, encoding='utf8', check=True)
            actual = json.loads(process.stdout)
            self.assertEqual(actual['sprites']['normal']['rect']['width'], 3)
            self.assertEqual(actual['sprites']['normal']['offset'], {'x': 3, 'y': 2})
            self.assertEqual(actual['sprites']['normal']['originalSize'], {'width': 8, 'height': 7})

    def test_publish_rotates_trimmed_sprite_and_cocos_reads_metadata(self):
        from PIL import Image
        from published import inspect
        image = Image.new('RGBA', (8, 5), (0, 0, 0, 0))
        for y in (1, 2):
            for x in range(1, 7): image.putpixel((x, y), (x * 30, y * 70, 20, 120))
        image.save(self.pkg / 'image.png')
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="img" name="image.png" path="/" duplicatePadding="true"/></resources></packageDescription>', encoding='utf8')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'out'), 'width': 4, 'height': 8, 'padding': 1, 'trim_images': True, 'rotate_images': True}
        result = execute('publish_images_experimental', args)
        self.assertEqual((result['trimmed_images'], result['rotated_images']), (1, 1))
        sprite = inspect(Path(result['file']).read_bytes())['sprites'][0]
        self.assertTrue(sprite['rotated'])
        self.assertEqual(tuple(sprite[key] for key in ('width', 'height', 'offset_x', 'offset_y', 'original_width', 'original_height')), (6, 2, 1, 1, 8, 5))
        validation = execute('validate_published', {'project': str(self.root), 'file': result['file'], 'compare_source': True})
        self.assertTrue(validation['valid'], validation['issues'])
        build = Path(os.environ.get('FGUI_COCOS_BUILD', 'E:/game_dev/FairyGUI-cocoscreator/source/build'))
        if build.is_dir():
            process = subprocess.run(['node', str(Path(__file__).with_name('check_cocos_reader.cjs')), str(build), result['file']], capture_output=True, text=True, encoding='utf8', check=True)
            actual = json.loads(process.stdout)['sprites']['img']
            self.assertTrue(actual['rotated'])
            self.assertEqual(actual['offset'], {'x': 1, 'y': 1})
            self.assertEqual(actual['originalSize'], {'width': 8, 'height': 5})

    def test_atlas_export_rotates_and_reports_source_orientation(self):
        from PIL import Image
        image = Image.new('RGBA', (6, 2))
        image.putdata([(x * 30, y * 100, 0, 255) for y in range(2) for x in range(6)])
        image.save(self.pkg / 'image.png')
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="img" name="image.png" path="/"/></resources></packageDescription>', encoding='utf8')
        result = execute('atlas_export', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'atlas'), 'width': 4, 'height': 8, 'padding': 1, 'rotate_images': True})
        item = result['pages'][0]['items'][0]
        self.assertTrue(item['rotated'])
        with Image.open(self.root / 'atlas' / 'atlas_0.png') as atlas:
            restored = atlas.crop((item['x'], item['y'], item['x'] + 2, item['y'] + 6)).transpose(Image.Transpose.ROTATE_90)
            self.assertEqual(restored.tobytes(), image.tobytes())
            restored.close()

    def test_trim_handles_image_glyphs_and_preserves_bitmap_font_textures(self):
        from PIL import Image
        from published import inspect
        image = Image.new('RGBA', (8, 8), (0, 0, 0, 0))
        image.putpixel((3, 4), (255, 0, 0, 255))
        image.save(self.pkg / 'glyph.png')
        (self.pkg / 'font.fnt').write_text('info size=12 colored=true\nchar id=65 img=img xadvance=2\n', encoding='utf8')
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="img" name="glyph.png" path="/"/><font id="font" name="font.fnt" path="/"/></resources></packageDescription>', encoding='utf8')
        result = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'out'), 'width': 16, 'height': 16, 'trim_images': True})
        self.assertEqual(result['trimmed_images'], 1)
        sprite = next(sprite for sprite in inspect(Path(result['file']).read_bytes())['sprites'] if sprite['id'] == 'img')
        self.assertEqual((sprite['width'], sprite['height'], sprite['offset_x'], sprite['offset_y'], sprite['original_width'], sprite['original_height']), (1, 1, 3, 4, 8, 8))
        checked = execute('validate_published', {'project': str(self.root), 'file': result['file'], 'compare_source': True})
        self.assertTrue(checked['valid'], checked['issues'])
        import shutil
        build = Path(os.environ.get('FGUI_COCOS_BUILD', 'E:/game_dev/FairyGUI-cocoscreator/source/build'))
        if (build / 'UIPackage.js').is_file() and shutil.which('node'):
            reader = Path(__file__).with_name('check_cocos_reader.cjs')
            parsed = json.loads(subprocess.run(['node', str(reader), str(build), result['file']], capture_output=True, text=True, encoding='utf8', check=True).stdout)
            glyph = next(item for item in parsed['items'] if item['id'] == 'font')['fontConfig']['fontDefDictionary']['65']
            self.assertEqual((glyph['rect']['width'], glyph['rect']['height'], glyph['xOffset'], glyph['yOffset'], glyph['xAdvance']), (1, 1, 3, 4, 2))
        (self.pkg / 'texture.fnt').write_text('info face="Test" size=16\ncommon lineHeight=18 pages=1\nchar id=65 x=3 y=4 width=1 height=1 xadvance=2 page=0\n', encoding='utf8')
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="img" name="glyph.png" path="/"/><font id="font" name="texture.fnt" path="/" texture="img"/></resources></packageDescription>', encoding='utf8')
        texture_result = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'texture-out'), 'width': 16, 'height': 16, 'trim_images': True})
        self.assertEqual(texture_result['trimmed_images'], 0)
        self.assertEqual(next(s for s in inspect(Path(texture_result['file']).read_bytes())['sprites'] if s['id'] == 'img')['width'], 8)
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="img" name="glyph.png" path="/"/><font id="font" name="font.fnt" path="/"/></resources></packageDescription>', encoding='utf8')
        Image.new('RGBA', (8, 4), (255, 0, 0, 255)).save(self.pkg / 'glyph.png')
        with self.assertRaisesRegex(ValueError, 'exceeds the page'):
            execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'cannot-rotate'), 'width': 6, 'height': 10, 'padding': 1, 'rotate_images': True})

    def test_atlas_export_png_and_manifest(self):
        from PIL import Image
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="i1" name="image.png" path="/"/></resources></packageDescription>')
        image = Image.new('RGBA', (2, 3), (3, 4, 5, 128))
        image.save(self.pkg / 'image.png')
        output = self.root / 'output'
        result = execute('atlas_export', {'project': str(self.root), 'pkg': 'Demo', 'output': str(output), 'width': 16, 'height': 16, 'padding': 1})
        manifest = json.loads((output / 'manifest.json').read_text(encoding='utf8'))
        self.assertEqual(result['pages'], manifest['pages'])
        item = manifest['pages'][0]['items'][0]
        with Image.open(output / 'atlas_0.png') as atlas:
            self.assertEqual(atlas.crop((item['x'], item['y'], item['x']+2, item['y']+3)).tobytes(), image.tobytes())
        with self.assertRaises(ValueError):
            execute('atlas_export', {'project': str(self.root), 'pkg': 'Demo', 'output': str(output)})

    def test_atlas_rejects_source_changes_during_layout_and_export(self):
        import fgui
        from PIL import Image
        image = self.pkg / 'image.png'
        package = self.pkg / 'package.xml'
        package.write_text('<packageDescription id="abcdefgh"><resources><image id="i" name="image.png" path="/"/></resources></packageDescription>', encoding='utf8')
        Image.new('RGBA', (2, 2), 'red').save(image)
        original_plan = fgui.atlas_plan
        def change_image(*args, **kwargs):
            result = original_plan(*args, **kwargs)
            Image.new('RGBA', (2, 2), 'blue').save(image)
            return result
        with patch.object(fgui, 'atlas_plan', side_effect=change_image), self.assertRaisesRegex(ValueError, 'source changed'):
            execute('atlas_layout', {'project': str(self.root), 'pkg': 'Demo', 'width': 16, 'height': 16})
        original_render = fgui.render
        def change_package(*args, **kwargs):
            result = original_render(*args, **kwargs)
            package.write_text(package.read_text(encoding='utf8') + '<!-- changed -->', encoding='utf8')
            return result
        output = self.root / 'output'
        with patch.object(fgui, 'render', side_effect=change_package), self.assertRaisesRegex(ValueError, 'source changed'):
            execute('atlas_export', {'project': str(self.root), 'pkg': 'Demo', 'output': str(output), 'width': 16, 'height': 16})
        self.assertFalse(output.exists())
        self.assertFalse(list(self.root.glob('.fgui-atlas-*')))

    def test_experimental_image_publish_and_unsupported_rejection(self):
        from PIL import Image
        package = self.pkg / 'package.xml'
        package.write_text('<packageDescription id="abcdefgh"><resources><image id="i1" name="image.png" path="/" exported="true" scale="9grid" scale9grid="0,1,1,2"/></resources><publish name="Renamed"/></packageDescription>')
        Image.new('RGBA', (2, 3), (3, 4, 5, 128)).save(self.pkg / 'image.png')
        output = self.root / 'published'
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(output), 'width': 16, 'height': 16}
        result = execute('publish_images_experimental', args)
        self.assertEqual(Path(result['file']).name, 'Renamed.bin')
        report = execute('validate_published', {'project': str(self.root), 'file': result['file'], 'compare_source': True})
        self.assertTrue(report['valid'])
        self.assertEqual(report['source_comparison']['checked'], 1)
        package.write_text('<packageDescription id="abcdefgh"><resources><image id="i1" name="image.png" path="/" scale="9grid" scale9grid="0,1,8,2"/></resources></packageDescription>')
        outside = execute('publish_images_experimental', {**args, 'output': str(self.root / 'outside')})
        info = execute('inspect_published', {'project': str(self.root), 'file': outside['file']})
        self.assertEqual(info['items'][0]['scale9Grid'], [0, 1, 8, 2])
        package.write_text(package.read_text().replace('0,1,8,2', '0,1,-1,2'))
        with self.assertRaises(ValueError):
            execute('publish_images_experimental', {**args, 'output': str(self.root / 'bad')})
        package.write_text('<packageDescription id="abcdefgh"><resources><component id="c" name="Main.xml" path="/"/></resources></packageDescription>')
        with self.assertRaises(ValueError):
            execute('publish_images_experimental', {**args, 'output': str(self.root / 'other')})
        self.assertFalse((self.root / 'other').exists())

    def test_exported_only_resolves_dependencies_and_rejects_missing(self):
        from PIL import Image
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="a" name="A.xml" path="/" exported="true"/><image id="i" name="i.png" path="/"/><swf id="s" name="unused.swf" path="/"/></resources></packageDescription>', encoding='utf8')
        source = self.pkg / 'A.xml'
        source.write_text('<component size="5,5"><displayList><image id="n0" src="i"/></displayList></component>', encoding='utf8')
        Image.new('RGBA', (1, 1), (1, 2, 3, 255)).save(self.pkg / 'i.png')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result'), 'exported_only': True}
        result = execute('publish_simple_experimental', args)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        self.assertEqual({item['id'] for item in info['items'] if item['type'] != 4}, {'a', 'i'})
        report = execute('validate_published', {'project': str(self.root), 'file': result['file'], 'compare_source': True, 'compare_components': True, 'exported_only': True})
        self.assertTrue(report['valid'], report)
        source.write_text(source.read_text().replace('src="i"', 'src="missing"'))
        with self.assertRaisesRegex(ValueError, 'missing published dependency'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'missing')})

    def test_cross_package_publishing_preserves_dependency_and_child(self):
        external = self.root / 'assets' / 'External'
        external.mkdir()
        (external / 'package.xml').write_text('<packageDescription id="external"><resources><component id="target" name="Target.xml" path="/" exported="true"/></resources></packageDescription>', encoding='utf8')
        (external / 'Target.xml').write_text('<component size="5,5"><displayList/></component>', encoding='utf8')
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="a" name="A.xml" path="/" exported="true"/></resources></packageDescription>', encoding='utf8')
        source = self.pkg / 'A.xml'
        source.write_text('<component size="10,10"><displayList><component id="n0" src="target" pkg="external"/></displayList></component>', encoding='utf8')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result'), 'exported_only': True}
        result = execute('publish_simple_experimental', args)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        self.assertEqual(info['dependencies'], [{'id': 'external', 'name': 'External'}])
        self.assertEqual((info['items'][0]['component']['children'][0]['src'], info['items'][0]['component']['children'][0]['pkg']), ('target', 'external'))
        report = execute('validate_published', {'project': str(self.root), 'file': result['file'], 'compare_components': True, 'exported_only': True})
        self.assertTrue(report['valid'], report)
        source.write_text(source.read_text().replace('pkg="external"', 'pkg="abcdefgh"'), encoding='utf8')
        report = execute('validate_published', {'project': str(self.root), 'file': result['file'], 'compare_components': True})
        self.assertFalse(report['valid'])
        self.assertIn('package reference differs', [issue['error'] for issue in report['component_comparison']['issues']])
        source.write_text(source.read_text().replace('pkg="abcdefgh"', 'pkg="external"'), encoding='utf8')
        (external / 'Target.xml').write_text('<component size="5,5" extention="Button"><displayList/><Button/></component>', encoding='utf8')
        source.write_text('<component size="10,10"><displayList><component id="n0" src="target" pkg="external"><Button title="Cross" checked="true"/></component></displayList></component>', encoding='utf8')
        with_button = execute('publish_simple_experimental', {**args, 'output': str(self.root / 'button')})
        button_info = execute('inspect_published', {'project': str(self.root), 'file': with_button['file']})
        button = button_info['items'][0]['component']['children'][0]['button']
        self.assertEqual((button['title'], button['checked']), ('Cross', True))
        (external / 'Target.xml').write_text('<component size="5,5"><displayList/></component>', encoding='utf8')
        with self.assertRaisesRegex(ValueError, 'wrong component type'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'wrong-type')})
        source.write_text('<component size="10,10"><displayList><component id="n0" src="target" pkg="external"/></displayList></component>', encoding='utf8')
        (external / 'package.xml').write_text((external / 'package.xml').read_text().replace(' exported="true"', ''), encoding='utf8')
        with self.assertRaisesRegex(ValueError, 'not published'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'missing')})

    def test_compact_atlas_publication_validates(self):
        from PIL import Image
        source = self.root / 'image.png'
        Image.new('RGBA', (13, 7), (20, 30, 40, 128)).save(source)
        imported = execute('import_image', {'project': str(self.root), 'pkg': 'Demo', 'source': str(source), 'exported': True})
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'compact'), 'width': 512, 'height': 512, 'padding': 2, 'shrink_atlas': True, 'exported_only': True}
        result = execute('publish_simple_experimental', args)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        atlas = next(item for item in info['items'] if item['type'] == 4)
        self.assertEqual((atlas['width'], atlas['height']), (32, 16))
        self.assertTrue(any(item['id'] == imported['id'] for item in info['sprites']))
        report = execute('validate_published', {'project': str(self.root), 'file': result['file'], 'compare_source': True, 'compare_components': True, 'exported_only': True})
        self.assertTrue(report['valid'], report)

    def test_experimental_empty_component_publish(self):
        created = execute('create_component', {'project': str(self.root), 'pkg': 'Demo', 'name': 'Empty', 'width': 123, 'height': 77})
        package = self.pkg / 'package.xml'
        package.write_text(f'<packageDescription id="abcdefgh"><resources><component id="{created["id"]}" name="Empty.xml" path="/"/></resources></packageDescription>')
        result = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result')})
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        self.assertEqual(info['items'][0]['component']['width'], 123)
        self.assertEqual(info['items'][0]['component']['children'], [])
        data = execute('read_component', {'project': str(self.root), 'pkg': 'Demo', 'name': 'Empty'})
        execute('insert_object', {'project': str(self.root), 'pkg': 'Demo', 'name': 'Empty', 'expected_sha256': data['sha256'], 'object_xml': '<movieclip id="n0"/>'})
        with self.assertRaisesRegex(ValueError, 'unsupported component child'):
            execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'invalid')})
        self.assertFalse((self.root / 'invalid').exists())

    def test_experimental_publish_image_child(self):
        from PIL import Image
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="img" name="image.png" path="/"/><component id="comp" name="Main.xml" path="/"/></resources></packageDescription>')
        Image.new('RGBA', (2, 3), (10, 20, 30, 255)).save(self.pkg / 'image.png')
        (self.pkg / 'Main.xml').write_text('<component size="20,30"><displayList><image id="n1" name="picture" src="img" fileName="image.png" locked="true" xy="4,5" size="10,12" scale="2,3" alpha="0.5" rotation="45" visible="false" touchable="false" color="#123456" flip="hz" fillMethod="radial360" fillClockwise="false" fillAmount="50"/><text id="n2" name="label" text="hello" fontSize="18" color="#123456" strokeColor="#aabbcc"/><graph id="n3" type="rect" lineSize="2" fillColor="#80040506"/></displayList></component>')
        result = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result'), 'width': 16, 'height': 16})
        report = execute('validate_published', {'project': str(self.root), 'file': result['file'], 'compare_source': True, 'compare_components': True})
        self.assertTrue(report['valid'], report)
        self.assertEqual(report['component_comparison']['checked'], 1)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        graph = next(c for item in info['items'] if item['type'] == 3 for c in item['component']['children'] if c['id'] == 'n3')
        self.assertEqual(graph['fillColor'], [4, 5, 6, 128])
        label = next(c for item in info['items'] if item['type'] == 3 for c in item['component']['children'] if c['id'] == 'n2')
        self.assertEqual((label['strokeColor'], label['stroke']), ([170, 187, 204, 255], 1.0))
        picture = next(c for item in info['items'] if item['type'] == 3 for c in item['component']['children'] if c['id'] == 'n1')
        self.assertEqual((picture['flip'], picture['fillMethod'], picture['fillClockwise'], picture['fillAmount']), (1, 5, False, 0.5))
        (self.pkg / 'Main.xml').write_text('<component size="20,30"><displayList><text id="n2" strokeColor="red"/></displayList></component>')
        with self.assertRaisesRegex(ValueError, 'invalid strokeColor'):
            execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'bad-stroke')})
        (self.pkg / 'Main.xml').write_text('<component size="20,30"><displayList><image id="n1" src="img" anchor="true"/></displayList></component>')
        with self.assertRaisesRegex(ValueError, 'invalid child anchor'):
            execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'bad-anchor')})
        (self.pkg / 'Main.xml').write_text('<component size="20,30"><displayList><image id="n1" src="img" fileName="wrong.png"/></displayList></component>')
        with self.assertRaisesRegex(ValueError, 'fileName does not match'):
            execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'wrong')})
        (self.pkg / 'Main.xml').write_text('<component size="20,30"><displayList><image id="n1" src="img" alpha="2"/></displayList></component>')
        with self.assertRaisesRegex(ValueError, 'invalid child alpha'):
            execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'bad')})

    def test_experimental_publish_nested_component_and_cycle(self):
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="a" name="A.xml" path="/"/><component id="b" name="B.xml" path="/"/></resources></packageDescription>')
        a, b = self.pkg / 'A.xml', self.pkg / 'B.xml'
        a.write_text('<component size="20,30"><controller name="state" pages="p0,normal,p1,selected" selected="0"/><relation target="n0" sidePair="width-width"/><displayList><component id="n0" src="b" xy="3,4"><gearDisplay controller="state" pages="p0"/><relation target="" sidePair="width,height"/></component></displayList></component>')
        b.write_text('<component size="5,6"><displayList/></component>')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result')}
        result = execute('publish_simple_experimental', args)
        report = execute('validate_published', {'project': str(self.root), 'file': result['file'], 'compare_components': True})
        self.assertTrue(report['valid'], report)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        component = next(item['component'] for item in info['items'] if item['id'] == 'a')
        self.assertEqual(component['relations'], [{'target': 0, 'definitions': [{'type': 14, 'percent': False}]}])
        self.assertEqual(component['children'][0]['relations'], [{'target': -1, 'definitions': [{'type': 14, 'percent': False}, {'type': 15, 'percent': False}]}])
        a.write_text('<component size="20,30"><controller name="state" pages="p0,normal"/><displayList><component id="n0" src="b"><gearDisplay controller="state" pages="missing"/></component></displayList></component>')
        badgear = execute('publish_simple_experimental', {**args, 'output': str(self.root / 'badgear')})
        self.assertEqual(badgear['warnings'][0]['pages'], ['missing'])
        badinfo = execute('inspect_published', {'project': str(self.root), 'file': badgear['file']})
        self.assertEqual(next(item['component'] for item in badinfo['items'] if item['id'] == 'a')['children'][0]['gears'][0]['pages'], ['missing'])
        a.write_text('<component size="20,30"><controller name="state" pages="p0,normal,p1,selected" selected="3"/><displayList/></component>')
        with self.assertRaisesRegex(ValueError, 'invalid controller selection'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'unsupported')})
        a.write_text('<component size="20,30"><displayList><component id="n0" src="b"/></displayList></component>')
        b.write_text('<component size="5,6"><displayList><component id="n1" src="a"/></displayList></component>')
        with self.assertRaisesRegex(ValueError, 'cyclic'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'cycle')})

    def test_experimental_loader_publish_and_invalid_fill(self):
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="a" name="A.xml" path="/"/></resources></packageDescription>')
        component = self.pkg / 'A.xml'
        component.write_text('<component size="20,30"><controller name="state" pages="0,off,1,on"/><displayList><loader id="n0" url="ui://abcdefghimage" align="center" vAlign="middle" fill="scaleFree" color="#123456" fillMethod="hz" fillAmount="50"><gearIcon controller="state" pages="0,1" values="iconA|iconB" default="fallback"/></loader></displayList></component>')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result')}
        result = execute('publish_simple_experimental', args)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        child = info['items'][0]['component']['children'][0]
        self.assertEqual((child['type'], child['url'], child['align'], child['verticalAlign'], child['loaderFill'], child['playing']), (4, 'ui://abcdefghimage', 1, 1, 4, True))
        self.assertEqual((child['color'], child['fillMethod'], child['fillAmount']), ([18, 52, 86, 255], 1, 0.5))
        self.assertEqual((child['gears'][0]['type'], child['gears'][0]['values'][1]['value']), (7, 'iconB'))
        component.write_text('<component size="20,30"><displayList><loader id="n0" fill="unknown"/></displayList></component>')
        with self.assertRaisesRegex(ValueError, 'invalid loader fill'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'bad-fill')})

    def test_experimental_richtext_and_constraints(self):
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="a" name="A.xml" path="/"/></resources></packageDescription>')
        component = self.pkg / 'A.xml'
        component.write_text('<component size="20,30"><displayList><richtext id="n0" restrictSize="1,100,2,200" ubb="true" text="[b]hello[/b]" demoText="preview"/></displayList></component>')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result')}
        result = execute('publish_simple_experimental', args)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        child = info['items'][0]['component']['children'][0]
        self.assertEqual((child['type'], child['text'], child['ubb'], child['constraints']), (7, '[b]hello[/b]', True, [1, 100, 2, 200]))
        component.write_text('<component size="20,30"><displayList><text id="n0" restrictSize="101,100,0,0"/></displayList></component>')
        with self.assertRaisesRegex(ValueError, 'invalid child restrictSize'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'bad-limits')})

    def test_experimental_groups_preserve_runtime_indices(self):
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="a" name="A.xml" path="/"/></resources></packageDescription>')
        component = self.pkg / 'A.xml'
        component.write_text('<component size="20,30"><displayList><text id="n0" group="g0"/><group id="g0"/><text id="n1" group="g1"/><group id="g1" advanced="true"/></displayList></component>')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result')}
        result = execute('publish_simple_experimental', args)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        children = info['items'][0]['component']['children']
        self.assertEqual([child['id'] for child in children], ['n0', 'n1', 'g1'])
        self.assertNotIn('groupIndex', children[0])
        self.assertEqual((children[1]['groupIndex'], children[2]['type'], children[2]['layout']), (2, 5, 0))
        component.write_text('<component size="20,30"><displayList><text id="n0" group="missing"/></displayList></component>')
        with self.assertRaisesRegex(ValueError, 'invalid group reference'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'bad-group')})

    def test_experimental_tiled_image_and_duplicated_padding(self):
        from PIL import Image
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="img" name="img.png" path="/" scale="tile" duplicatePadding="true"/></resources></packageDescription>')
        Image.new('RGBA', (2, 2), (23, 45, 67, 128)).save(self.pkg / 'img.png')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result'), 'width': 8, 'height': 8, 'padding': 1}
        result = execute('publish_images_experimental', args)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        self.assertTrue(info['items'][0]['scaleByTile'])
        with Image.open(self.root / 'result' / 'Demo_atlas0.png') as atlas:
            self.assertEqual(atlas.getpixel((0, 0)), (23, 45, 67, 128))
        with self.assertRaisesRegex(ValueError, 'requires positive atlas padding'):
            execute('publish_images_experimental', {**args, 'output': str(self.root / 'bad-padding'), 'padding': 0})

    def test_validate_published_detects_missing_and_changed_source_images(self):
        from PIL import Image
        package = self.pkg / 'package.xml'
        package.write_text('<packageDescription id="abcdefgh"><resources><image id="img" name="img.png" path="/"/></resources></packageDescription>')
        Image.new('RGBA', (2, 2), (1, 2, 3, 255)).save(self.pkg / 'img.png')
        result = execute('publish_images_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result'), 'width': 8, 'height': 8})
        args = {'project': str(self.root), 'file': result['file'], 'compare_source': True}
        self.assertTrue(execute('validate_published', args)['valid'])
        package.write_text('<packageDescription id="abcdefgh"><resources><image id="img" name="img.png" path="/" scale="tile"/><image id="missing" name="img.png" path="/"/></resources></packageDescription>')
        report = execute('validate_published', args)
        self.assertFalse(report['valid'])
        self.assertEqual(report['source_comparison']['skipped'][0]['id'], 'missing')
        self.assertEqual({issue['error'] for issue in report['image_settings_comparison']['issues']}, {'image scale setting differs', 'image absent from published package'})

    def test_experimental_scroll_component(self):
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="a" name="A.xml" path="/"/></resources></packageDescription>')
        component = self.pkg / 'A.xml'
        component.write_text('<component size="20,30" overflow="scroll" scroll="both" scrollBar="hidden" scrollBarFlags="1" margin="1,2,3,4" scrollBarMargin="5,6,7,8"><displayList/></component>')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result')}
        result = execute('publish_simple_experimental', args)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        actual = info['items'][0]['component']
        self.assertEqual(actual['base']['margin'], [1, 2, 3, 4])
        self.assertEqual(actual['scroll'], {'type': 2, 'barDisplay': 3, 'flags': 1, 'barMargin': [5, 6, 7, 8], 'verticalBar': None, 'horizontalBar': None, 'header': None, 'footer': None})
        component.write_text('<component size="20,30" scroll="both"><displayList/></component>')
        retained = execute('publish_simple_experimental', {**args, 'output': str(self.root / 'retained-scroll')})
        retained_info = execute('inspect_published', {'project': str(self.root), 'file': retained['file']})
        self.assertNotIn('scroll', retained_info['items'][0]['component'])
        component.write_text('<component size="20,30" scroll="invalid"><displayList/></component>')
        with self.assertRaisesRegex(ValueError, 'invalid scroll configuration'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'bad-scroll')})

    def test_experimental_list_items_and_controllers(self):
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="a" name="A.xml" path="/"/></resources></packageDescription>')
        component = self.pkg / 'A.xml'
        component.write_text('<component size="20,30"><controller name="page" pages="p0,first,p1,second"/><displayList><list id="n0" layout="pagination" overflow="scroll" scroll="horizontal" scrollBarRes="ui://abcdefghbar," ptrRes=",ui://abcdefghfooter" pageController="page" selectionController="page" defaultItem="ui://abcdefghitem" lineGap="4"><item title="one"/><item icon="ui://abcdefghicon"/></list></displayList></component>')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result')}
        result = execute('publish_simple_experimental', args)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        ls = info['items'][0]['component']['children'][0]['list']
        self.assertEqual((ls['layout'], ls['autoResize'], ls['pageController'], ls['selectionController'], ls['scroll']['type']), (4, False, 0, 0, 0))
        self.assertEqual((ls['items'][0]['title'], ls['items'][1]['icon']), ('one', 'ui://abcdefghicon'))
        self.assertEqual((ls['scroll']['verticalBar'], ls['scroll']['footer']), ('ui://abcdefghbar', 'ui://abcdefghfooter'))
        component.write_text('<component size="20,30"><displayList><list id="n0" selectionController="missing"/></displayList></component>')
        with self.assertRaisesRegex(ValueError, 'invalid list selectionController'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'bad-list')})

    def test_experimental_sound_copy_and_validation(self):
        package = self.pkg / 'package.xml'
        package.write_text('<packageDescription id="abcdefgh"><resources><sound id="sound1" name="click.wav" path="/" exported="true"/></resources></packageDescription>')
        (self.pkg / 'click.wav').write_bytes(b'RIFF test sound')
        result = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result')})
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        self.assertEqual((result['sounds'], info['items'][0]['type'], info['items'][0]['file']), (1, 2, 'sound1.wav'))
        args = {'project': str(self.root), 'file': result['file'], 'compare_source': True}
        self.assertTrue(execute('validate_published', args)['valid'])
        (self.root / 'result' / 'Demo_sound1.wav').write_bytes(b'changed')
        report = execute('validate_published', args)
        self.assertFalse(report['valid'])
        self.assertEqual(report['sound_comparison']['issues'][0]['error'], 'published sound bytes differ from source')
        package.write_text('<packageDescription id="abcdefgh"><resources><sound id="../escape" name="click.wav" path="/"/></resources></packageDescription>')
        with self.assertRaises(ValueError):
            execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'bad-sound')})

    def test_experimental_transition_export_and_validation(self):
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="a" name="A.xml" path="/"/></resources></packageDescription>')
        source = self.pkg / 'A.xml'
        source.write_text('<component size="20,30"><controller name="state" pages="0,off,1,on"><action type="play_transition" fromPage="0" toPage="1" transition="show"/></controller><displayList><graph id="n0"/></displayList><transition name="show" autoPlay="true" autoPlayRepeat="-1"><item type="XY" target="n0" time="6" tween="true" startValue="1,-" endValue="11,-" duration="12"/><item type="Visible" time="18" value="true"/><item type="Alpha" time="7" tween="true" startValue="0" endValue="1" duration="7"/></transition></component>')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result')}
        result = execute('publish_simple_experimental', args)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        transition = info['items'][0]['component']['transitions'][0]
        action = info['items'][0]['component']['controllers'][0]['actions'][0]
        self.assertEqual((action['from'], action['to'], action['transition']), (['0'], ['1'], 'show'))
        self.assertEqual((transition['name'], transition['autoPlay'], transition['autoPlayTimes']), ('show', True, -1))
        move, visible, alpha = transition['items']
        self.assertEqual((move['time'], move['target'], move['tween']['duration'], move['tween']['start']['flags']), (0.25, 0, 0.5, [True, False]))
        self.assertEqual((visible['time'], visible['value']), (0.75, True))
        self.assertEqual((alpha['time'], alpha['tween']['duration']), (0.2916666865348816, 0.2916666865348816))
        source.write_text('<component size="20,30"><displayList/><transition name="t"><item type="XY" target="missing" value="0,0"/></transition></component>')
        bad = execute('publish_simple_experimental', {**args, 'output': str(self.root / 'bad-transition')})
        self.assertEqual(bad['warnings'][0]['target'], 'missing')
        badinfo = execute('inspect_published', {'project': str(self.root), 'file': bad['file']})
        self.assertEqual(badinfo['items'][0]['component']['transitions'][0]['items'], [])
        source.write_text('<component size="20,30"><controller name="state" pages="0,off"><action type="play_transition" toPage="missing" transition="show"/></controller><displayList/></component>')
        with self.assertRaisesRegex(ValueError, 'unknown page'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'bad-action')})

    def test_experimental_button_instance_and_controller(self):
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="a" name="A.xml" path="/"/><component id="b" name="B.xml" path="/"/></resources></packageDescription>')
        source = self.pkg / 'A.xml'
        source.write_text('<component size="20,30"><controller name="tab" pages="0,one,1,two"/><displayList><component id="n0" src="b"><Button title="Hello" selectedTitle="Chosen" icon="ui://abcdefghicon" checked="true" controller="tab" page="1"/></component></displayList></component>')
        (self.pkg / 'B.xml').write_text('<component size="5,5" extention="Button"><displayList/><Button mode="Radio"/></component>')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result')}
        result = execute('publish_simple_experimental', args)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        child = next(item['component']['children'][0] for item in info['items'] if item['id'] == 'a')
        self.assertEqual((child['button']['title'], child['button']['selectedTitle'], child['button']['controller'], child['button']['page'], child['button']['checked']), ('Hello', 'Chosen', 0, '1', True))
        self.assertTrue(execute('validate_published', {'project': str(self.root), 'file': result['file'], 'compare_components': True})['valid'])
        source.write_text(source.read_text().replace('page="1"', 'page="missing"'))
        with self.assertRaisesRegex(ValueError, 'invalid button page'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'bad-button')})

    def test_experimental_component_mask_and_scrollbar(self):
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="a" name="A.xml" path="/"/></resources></packageDescription>')
        source = self.pkg / 'A.xml'
        source.write_text('<component size="20,30" extention="ScrollBar" opaque="false" mask="n0" reversedMask="true" hitTest="n1"><displayList><graph id="n0" name="bar"/><graph id="n1" name="grip"/></displayList></component>')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result')}
        result = execute('publish_simple_experimental', args)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        comp = info['items'][0]['component']
        self.assertEqual((comp['settings']['opaque'], comp['settings']['mask'], comp['settings']['reversedMask'], comp['settings']['hitTestOffset'], comp['settings']['hitTestChild']), (False, 0, True, 1, 1))
        self.assertEqual(comp['scrollBar'], {'fixedGripSize': False})
        source.write_text(source.read_text().replace('mask="n0"', 'mask="missing"'))
        with self.assertRaisesRegex(ValueError, 'invalid component mask'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'bad-mask')})

    def test_experimental_pixel_hit_mask(self):
        from PIL import Image
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="i" name="image.png" path="/"/><component id="a" name="A.xml" path="/"/></resources></packageDescription>')
        image = Image.new('RGBA', (2, 2))
        image.putdata([(1, 2, 3, a) for a in (0, 10, 11, 255)])
        image.save(self.pkg / 'image.png')
        source = self.pkg / 'A.xml'
        source.write_text('<component size="2,2"><displayList><image id="n0" src="i" forHitTest="true"/></displayList></component>')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result'), 'width': 8, 'height': 8}
        result = execute('publish_simple_experimental', args)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        self.assertEqual(info['hitTests'], [{'id': 'i', 'reserved': 0, 'width': 1, 'divisor': 2, 'pixels': '01'}])
        self.assertTrue(execute('validate_published', {'project': str(self.root), 'file': result['file']})['valid'])
        report = execute('validate_published', {'project': str(self.root), 'file': result['file'], 'compare_source': True})
        self.assertTrue(report['valid'], report)
        self.assertEqual(report['pixel_hit_comparison']['checked'], 1)
        image.putpixel((1, 1), (1, 2, 3, 0))
        image.save(self.pkg / 'image.png')
        report = execute('validate_published', {'project': str(self.root), 'file': result['file'], 'compare_source': True})
        self.assertEqual(report['pixel_hit_comparison']['issues'][0]['error'], 'pixel hit mask differs from source alpha')
        source.write_text('<component size="2,2"><displayList><image id="n0" src="i" xy="1,0" forHitTest="true"/></displayList></component>')
        with self.assertRaisesRegex(ValueError, 'unsupported pixel hit test image geometry'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'bad-hit')})

    def test_experimental_transition_cubic_path(self):
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="a" name="A.xml" path="/"/></resources></packageDescription>')
        source = self.pkg / 'A.xml'
        source.write_text('<component size="20,30"><displayList><graph id="n0"/></displayList><transition name="t"><item type="XY" target="n0" tween="true" startValue="0,0" endValue="10,0" duration="24" path="2,0,0,1,2,3,4,1,2,10,0,0,0,0,0,0"/></transition></component>')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result')}
        result = execute('publish_simple_experimental', args)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        self.assertEqual(info['version'], 2)
        path = info['items'][0]['component']['transitions'][0]['items'][0]['tween']['path']
        self.assertEqual(path[0], {'curve': 2, 'points': [0, 0, 1, 2, 3, 4]})
        source.write_text(source.read_text().replace('2,0,0,1,2,3,4,1', '1,0,0,1,2,3,4,1'))
        with self.assertRaisesRegex(ValueError, 'unsupported transition path point'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'bad-path')})

    def test_publisher_keeps_bitmap_font_glyphs_on_one_atlas(self):
        from PIL import Image
        from published import inspect
        sizes = [(3, 6), (2, 4), (2, 5), (5, 5), (7, 5)]
        entries = []
        for index, size in enumerate(sizes):
            Image.new('RGBA', size, (index * 30, 20, 40, 255)).save(self.pkg / f'{index}.png')
            entries.append(f'<image id="{index}" name="{index}.png" path="/"/>')
        entries.append('<font id="font" name="font.fnt" path="/"/>')
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources>' + ''.join(entries) + '</resources></packageDescription>', encoding='utf8')
        (self.pkg / 'font.fnt').write_text('info size=12 colored=true\nchar id=65 img=0 xadvance=3\nchar id=66 img=1 xadvance=2\n', encoding='utf8')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'output'), 'width': 8, 'height': 8, 'padding': 0}
        result = execute('publish_simple_experimental', args)
        info = inspect(Path(result['file']).read_bytes())
        sprites = {sprite['id']: sprite['atlas'] for sprite in info['sprites']}
        self.assertEqual(sprites['0'], sprites['1'])
        report = execute('validate_published', {'project': str(self.root), 'file': result['file'], 'compare_source': True})
        self.assertTrue(report['valid'], report['issues'])

    def test_publisher_keeps_movieclip_frames_on_one_atlas(self):
        import struct
        from PIL import Image
        from published import inspect
        frame_sizes = [(3, 6), (2, 4)]
        blobs = []
        for size in frame_sizes:
            buffer = io.BytesIO()
            Image.new('RGBA', size, (10, 20, 30, 255)).save(buffer, format='PNG')
            blobs.append(buffer.getvalue())
        data = struct.pack('>H', 4) + b'clip' + struct.pack('>IIIHHBI', 102, 0, 0, 8, 8, 2, 2)
        data += b''.join(struct.pack('>6H', 0, 0, 0, w, h, index) for index, (w, h) in enumerate(frame_sizes))
        data += struct.pack('>H', len(blobs)) + b''.join(struct.pack('>I', len(blob)) + blob for blob in blobs)
        (self.pkg / 'clip.jta').write_bytes(data)
        entries = ['<movieclip id="clip" name="clip.jta" path="/"/>']
        for index, size in enumerate([(2, 5), (5, 5), (7, 5)], start=2):
            Image.new('RGBA', size, (index * 30, 20, 40, 255)).save(self.pkg / f'{index}.png')
            entries.append(f'<image id="{index}" name="{index}.png" path="/"/>')
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources>' + ''.join(entries) + '</resources></packageDescription>', encoding='utf8')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'output'), 'width': 8, 'height': 8, 'padding': 0}
        result = execute('publish_simple_experimental', args)
        sprites = {sprite['id']: sprite['atlas'] for sprite in inspect(Path(result['file']).read_bytes())['sprites']}
        self.assertEqual(sprites['clip_0'], sprites['clip_1'])
        report = execute('validate_published', {'project': str(self.root), 'file': result['file'], 'compare_source': True})
        self.assertTrue(report['valid'], report['issues'])

    def test_experimental_movieclip_publish_and_pixel_validation(self):
        from PIL import Image
        from test_jta import sample_jta
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><movieclip id="clip" name="clip.jta" path="/"/><component id="a" name="A.xml" path="/"/></resources></packageDescription>')
        (self.pkg / 'clip.jta').write_bytes(sample_jta())
        (self.pkg / 'A.xml').write_text('<component size="20,30"><displayList><jta id="n0" src="clip" frame="1" playing="false"/></displayList></component>')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result'), 'width': 16, 'height': 16}
        result = execute('publish_simple_experimental', args)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        clip = next(item for item in info['items'] if item['id'] == 'clip')
        child = next(item for item in info['items'] if item['id'] == 'a')['component']['children'][0]
        self.assertEqual((result['movieclips'], clip['movieclip']['interval'], len(clip['movieclip']['frames']), child['frame'], child['playing']), (1, 83, 2, 1, False))
        report_args = {'project': str(self.root), 'file': result['file'], 'compare_source': True, 'compare_components': True}
        report = execute('validate_published', report_args)
        self.assertTrue(report['valid'], report)
        self.assertEqual(report['movieclip_comparison']['checked_frames'], 2)
        sprite = next(item for item in info['sprites'] if item['id'] == 'clip_0')
        path = self.root / 'result' / 'Demo_atlas0.png'
        with Image.open(path) as original: image = original.convert('RGBA')
        image.putpixel((sprite['x'], sprite['y']), (0, 0, 0, 0))
        image.save(path)
        report = execute('validate_published', report_args)
        self.assertIn('movieclip frame pixels differ', [issue['error'] for issue in report['movieclip_comparison']['issues']])

    def test_experimental_polygon_graphs(self):
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="a" name="A.xml" path="/"/></resources></packageDescription>')
        source = self.pkg / 'A.xml'
        source.write_text('<component size="20,30"><displayList><graph id="r" type="rect" corner="4"/><graph id="p" type="polygon" points="0,0,10,0,5,10"/><graph id="q" type="regular_polygon" sides="3" startAngle="30" distances="0.5,1,0.5"/></displayList></component>')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result')}
        result = execute('publish_simple_experimental', args)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        rectangle, polygon, regular = info['items'][0]['component']['children']
        self.assertEqual(rectangle['cornerRadius'], [4, 4, 4, 4])
        self.assertEqual(polygon['points'], [0, 0, 10, 0, 5, 10])
        self.assertEqual((regular['sides'], regular['startAngle'], regular['distances']), (3, 30, [0.5, 1, 0.5]))
        source.write_text(source.read_text().replace('distances="0.5,1,0.5"', 'distances="0.5,1"'))
        with self.assertRaisesRegex(ValueError, 'invalid polygon distances'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'bad-polygon')})

    def test_experimental_input_text(self):
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="a" name="A.xml" path="/"/></resources></packageDescription>')
        source = self.pkg / 'A.xml'
        source.write_text('<component size="100,100"><displayList><text id="n0" input="true"/><text id="n1" input="true" prompt="Enter" restrict="0-9" maxLength="12" keyboardType="2" password="true"/><text id="n2"/><richtext id="n3"/></displayList></component>')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result')}
        result = execute('publish_simple_experimental', args)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        first, second, text, richtext = info['items'][0]['component']['children']
        self.assertEqual((first['type'], first['fontSize'], first['autoSize']), (8, 0, 1))
        self.assertEqual(second['input'], {'prompt': 'Enter', 'restrict': '0-9', 'maxLength': 12, 'keyboardType': 2, 'password': True})
        self.assertEqual((text['fontSize'], richtext['fontSize']), (0, 0))
        self.assertTrue(execute('validate_published', {'project': str(self.root), 'file': result['file'], 'compare_components': True})['valid'])
        source.write_text(source.read_text().replace('maxLength="12"', 'maxLength="-1"'))
        with self.assertRaisesRegex(ValueError, 'invalid input numeric setting'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'bad-input')})

    def test_experimental_combobox(self):
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="a" name="A.xml" path="/"/><component id="b" name="B.xml" path="/"/></resources></packageDescription>')
        (self.pkg / 'A.xml').write_text('<component size="100,100"><displayList><component id="n0" src="b"><ComboBox visibleItemCount="5"><item title="One" value="one"/><item title="Two"/></ComboBox></component></displayList></component>')
        (self.pkg / 'B.xml').write_text('<component size="20,20" extention="ComboBox"><displayList/><ComboBox dropdown="ui://abcdefghpopup"/></component>')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result')}
        result = execute('publish_simple_experimental', args)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        parent = next(item for item in info['items'] if item['id'] == 'a')['component']
        base = next(item for item in info['items'] if item['id'] == 'b')['component']
        self.assertEqual(base['comboBox']['dropdown'], 'ui://abcdefghpopup')
        self.assertEqual((parent['children'][0]['comboBox']['visibleItemCount'], parent['children'][0]['comboBox']['items'][0]['value']), (5, 'one'))
        self.assertTrue(execute('validate_published', {'project': str(self.root), 'file': result['file'], 'compare_components': True})['valid'])
        (self.pkg / 'B.xml').write_text('<component size="20,20"><displayList/></component>')
        with self.assertRaisesRegex(ValueError, 'ComboBox instance references the wrong component type'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'bad-combo')})

    def test_experimental_tree_hierarchy(self):
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="a" name="A.xml" path="/"/></resources></packageDescription>')
        source = self.pkg / 'A.xml'
        source.write_text('<component size="100,100"><displayList><list id="n0" treeView="true" indent="15" clickToExpand="1" defaultItem="ui://abcdefghitem"><item title="folder" level="0"/><item title="leaf" level="1"/><item title="other" level="0"/></list></displayList></component>')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result')}
        result = execute('publish_simple_experimental', args)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        child = info['items'][0]['component']['children'][0]
        self.assertEqual((child['type'], child['list']['indent'], child['list']['clickToExpand']), (17, 15, 1))
        self.assertEqual([(item['folder'], item['level']) for item in child['list']['items']], [(True, 0), (False, 1), (False, 0)])
        self.assertTrue(execute('validate_published', {'project': str(self.root), 'file': result['file'], 'compare_components': True})['valid'])
        source.write_text(source.read_text().replace('level="1"', 'level="2"'))
        with self.assertRaisesRegex(ValueError, 'invalid tree level'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'bad-tree')})

    def test_experimental_bitmap_font_publish_and_validation(self):
        from PIL import Image
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><image id="tex" name="tex.png" path="/"/><font id="font" name="font.fnt" path="/" texture="tex"/><component id="a" name="A.xml" path="/"/></resources></packageDescription>')
        Image.new('RGBA', (8, 8), (10, 20, 30, 255)).save(self.pkg / 'tex.png')
        font = self.pkg / 'font.fnt'
        font.write_text('info face="Demo" size=16\ncommon lineHeight=18 pages=1\nchar id=65 x=1 y=1 width=3 height=4 xoffset=0 yoffset=1 xadvance=4 page=0 chnl=15\n')
        (self.pkg / 'A.xml').write_text('<component size="100,100"><displayList><text id="n0" font="ui://abcdefghfont" text="A"/></displayList></component>')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result'), 'width': 32, 'height': 32}
        result = execute('publish_simple_experimental', args)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        item = next(item for item in info['items'] if item['id'] == 'font')
        self.assertEqual((result['fonts'], item['font']['ttf'], item['font']['glyphs'][0]['id']), (1, True, 65))
        report_args = {'project': str(self.root), 'file': result['file'], 'compare_source': True}
        report = execute('validate_published', report_args)
        self.assertTrue(report['valid'], report)
        self.assertEqual(report['font_comparison']['checked'], 1)
        font.write_text(font.read_text().replace('xadvance=4', 'xadvance=5'))
        report = execute('validate_published', report_args)
        self.assertIn('bitmap font settings or glyphs differ', [issue['error'] for issue in report['font_comparison']['issues']])

    def test_experimental_animation_gear_transition_and_text_shadow(self):
        from test_jta import sample_jta
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><movieclip id="clip" name="clip.jta" path="/"/><component id="a" name="A.xml" path="/"/></resources></packageDescription>')
        (self.pkg / 'clip.jta').write_bytes(sample_jta())
        source = self.pkg / 'A.xml'
        source.write_text('<component size="30,30"><controller name="state" pages="0,off,1,on"/><displayList><jta id="n0" src="clip"><gearAni controller="state" pages="1" values="1,s" default="0,p"/></jta><text id="n1" shadowColor="#123456" shadowOffset="3,4"/></displayList><transition name="t"><item type="Animation" target="n0" time="0" value="1,p"/></transition></component>')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result'), 'width': 32, 'height': 32}
        result = execute('publish_simple_experimental', args)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        comp = next(item for item in info['items'] if item['id'] == 'a')['component']
        gear = comp['children'][0]['gears'][0]
        self.assertEqual((gear['type'], gear['values'][0]['value'], gear['default']), (5, {'playing': False, 'frame': 1}, {'playing': True, 'frame': 0}))
        self.assertEqual((comp['children'][1]['shadowColor'], comp['children'][1]['shadowOffset']), ([18, 52, 86, 255], [3, 4]))
        self.assertEqual(comp['transitions'][0]['items'][0]['value'], {'playing': True, 'frame': 1})
        source.write_text(source.read_text().replace('values="1,s"', 'values="1,invalid"'))
        with self.assertRaisesRegex(ValueError, 'invalid animation gear value'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'bad-animation')})
        self.assertFalse((self.root / 'cycle').exists())

    def test_experimental_font_size_and_display2_gears(self):
        source = self.pkg / 'Main.xml'
        xml = '<component size="20,30"><controller name="state" pages="0,up,1,down"/><displayList><text id="n1"><gearFontSize controller="state" pages="0,1" values="12|22" default="15"/></text><graph id="n2"><gearDisplay2 controller="state" pages="1" condition="1"/></graph></displayList></component>'
        source.write_text(xml)
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result')}
        result = execute('publish_simple_experimental', args)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        children = next(item for item in info['items'] if item.get('component'))['component']['children']
        self.assertEqual((children[0]['gears'][0]['type'], children[0]['gears'][0]['values'][1]['value'], children[0]['gears'][0]['default']), (9, 22, 15))
        self.assertEqual((children[1]['gears'][0]['type'], children[1]['gears'][0]['condition']), (8, 1))
        source.write_text(xml.replace('condition="1"', 'condition="2"'))
        with self.assertRaisesRegex(ValueError, 'invalid display2 condition'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'bad')})
        source.write_text(xml.replace('values="12|22"', 'values="12|-4"'))
        with self.assertRaisesRegex(ValueError, 'invalid font size gear value'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'bad-size')})

    def test_experimental_publish_text_gear_validation(self):
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="20,30"><controller name="state" pages="0,up,1,down"/><displayList><text id="n1" text="initial"><gearText controller="state" pages="0,1" values="first|second" default="fallback"/></text></displayList></component>')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'result')}
        result = execute('publish_simple_experimental', args)
        self.assertTrue(Path(result['file']).is_file())
        source.write_text('<component size="20,30"><controller name="state" pages="0,up,1,down"/><displayList><text id="n1"><gearText controller="state" pages="0,1" values="first"/></text></displayList></component>')
        with self.assertRaisesRegex(ValueError, 'values and pages differ'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'invalid')})

    def test_controller_allows_unnamed_pages(self):
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="20,30"><controller name="state" pages="0,,1,"/><displayList/></component>')
        result = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'unnamed')})
        component = execute('inspect_published', {'project': str(self.root), 'file': result['file']})['items'][0]['component']
        self.assertEqual(component['controllers'][0]['pages'], [{'id': '0', 'name': ''}, {'id': '1', 'name': ''}])

    def test_experimental_publish_xy_gear(self):
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="20,30"><controller name="state" pages="0,up,1,down"/><displayList><graph id="n1"><gearXY controller="state" pages="0,1" values="1,2|-" default="3,4" tween="true" ease="Quad.Out" duration="0.5" delay="0.25"/><gearSize controller="state" pages="0,1" values="10,20|30,40,2,3" default="5,6"/><gearLook controller="state" pages="0,1" values="1,0,0|0.5,90,1,0"/></graph></displayList></component>')
        args = {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'xy')}
        result = execute('publish_simple_experimental', args)
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        gear = info['items'][0]['component']['children'][0]['gears'][0]
        self.assertEqual((gear['ease'], gear['duration'], gear['delay']), (5, 0.5, 0.25))
        sizegear = info['items'][0]['component']['children'][0]['gears'][1]
        self.assertEqual(sizegear['values'][1]['value'], [30, 40, 2.0, 3.0])
        self.assertEqual(info['items'][0]['component']['children'][0]['gears'][2]['values'][1]['value'], [0.5, 90.0, True, False])
        source.write_text('<component size="20,30"><controller name="state" pages="0,up"/><displayList><graph id="n1"><gearXY controller="state" pages="0" values="a,b"/></graph></displayList></component>')
        with self.assertRaisesRegex(ValueError, 'invalid gear position'):
            execute('publish_simple_experimental', {**args, 'output': str(self.root / 'badxy')})

    def test_experimental_publish_color_gear(self):
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="20,30"><controller name="state" pages="0,up,1,down"/><displayList><graph id="n1"><gearColor controller="state" pages="0,1" values="#ff0000|#0000ff,#112233" default="#ffffff"/></graph></displayList></component>')
        result = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'colors')})
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        gear = info['items'][0]['component']['children'][0]['gears'][0]
        self.assertEqual(gear['values'][1]['value'], [[0, 0, 255, 255], [17, 34, 51, 255]])

    def test_editor_preview_page_and_text_defaults_are_not_runtime_overrides(self):
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="20,30"><controller name="state" pages="0,up,1,down" selected="1"/><displayList><text id="n1" text=""/></displayList></component>')
        result = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'defaults')})
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        component = info['items'][0]['component']
        self.assertEqual(component['controllers'][0]['selected'], 0)
        self.assertEqual(component['children'][0]['color'], [0, 0, 0, 255])
        self.assertIsNone(component['children'][0]['text'])

    def test_experimental_publish_button_extension(self):
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="20,30" extention="Button"><controller name="button" pages="0,up,1,down"/><displayList><graph id="n1" type="rect"/></displayList><Button mode="Radio" sound="ui://abcdefghsound" downEffect="scale" downEffectValue="0.5"/></component>')
        result = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'button')})
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        self.assertEqual(info['items'][0]['extension'], 12)
        self.assertEqual(info['items'][0]['component']['button']['mode'], 2)
        button = info['items'][0]['component']['button']
        self.assertEqual((button['sound'], button['downEffect'], button['downEffectValue']), ('ui://abcdefghsound', 2, 0.5))

    def test_experimental_publish_progress_bar_extension(self):
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="20,30" extention="ProgressBar"><displayList/><ProgressBar titleType="value" reverse="true"/></component>')
        result = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'progress')})
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        self.assertEqual(info['items'][0]['extension'], 14)
        self.assertEqual(info['items'][0]['component']['progressBar'], {'titleType': 2, 'reverse': True})

    def test_experimental_publish_slider_extension(self):
        source = self.pkg / 'Main.xml'
        source.write_text('<component size="20,30" extention="Slider"><displayList/><Slider titleType="value" reverse="true"/></component>')
        result = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'slider')})
        item = execute('inspect_published', {'project': str(self.root), 'file': result['file']})['items'][0]
        self.assertEqual(item['extension'], 15)
        self.assertEqual(item['component']['slider'], {'titleType': 2, 'reverse': True, 'wholeNumbers': False, 'changeOnClick': True})

    def test_progress_instance_value_and_minimum(self):
        package = self.pkg / 'package.xml'
        package.write_text('<packageDescription id="abcdefgh"><resources><component id="a" name="Main.xml" path="/"/><component id="b" name="Bar.xml" path="/"/></resources></packageDescription>')
        (self.pkg / 'Bar.xml').write_text('<component size="20,10" extention="ProgressBar"><displayList/><ProgressBar/></component>')
        (self.pkg / 'Main.xml').write_text('<component size="100,100"><displayList><component id="n1" src="b"><ProgressBar value="63" max="100" min="10"/></component></displayList></component>')
        result = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'progress-instance')})
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        item = next(x for x in info['items'] if x['id'] == 'a')
        self.assertEqual(info['version'], 2)
        self.assertEqual(item['component']['children'][0]['progress'], {'value': 63, 'max': 100, 'min': 10})

    def test_slider_instance_value_and_minimum(self):
        package = self.pkg / 'package.xml'
        package.write_text('<packageDescription id="abcdefgh"><resources><component id="a" name="Main.xml" path="/"/><component id="b" name="Slider.xml" path="/"/></resources></packageDescription>')
        (self.pkg / 'Slider.xml').write_text('<component size="20,10" extention="Slider"><displayList/><Slider/></component>')
        (self.pkg / 'Main.xml').write_text('<component size="100,100"><displayList><component id="n1" src="b"><Slider value="25" max="80" min="5"/></component></displayList></component>')
        result = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'slider-instance')})
        report = execute('validate_published', {'project': str(self.root), 'file': result['file'], 'compare_components': True})
        self.assertTrue(report['valid'], report)

    def test_label_instance_publication(self):
        (self.pkg / 'package.xml').write_text('<packageDescription id="abcdefgh"><resources><component id="a" name="Main.xml" path="/"/><component id="b" name="Label.xml" path="/"/></resources></packageDescription>')
        (self.pkg / 'Label.xml').write_text('<component size="20,10" extention="Label"><displayList/></component>')
        (self.pkg / 'Main.xml').write_text('<component size="100,100"><displayList><component id="n1" src="b"><Label title="hello" titleColor="#123456" titleFontSize="18"/></component></displayList></component>')
        result = execute('publish_simple_experimental', {'project': str(self.root), 'pkg': 'Demo', 'output': str(self.root / 'label-instance')})
        info = execute('inspect_published', {'project': str(self.root), 'file': result['file']})
        label = next(x for x in info['items'] if x['id'] == 'a')['component']['children'][0]['label']
        self.assertEqual(label, {'title': 'hello', 'icon': None, 'color': [18, 52, 86, 255], 'fontSize': 18, 'sound': None})

    def test_one_server_routes_multiple_projects(self):
        with tempfile.TemporaryDirectory() as other:
            root = Path(other)
            (root / 'other.fairy').write_text('<projectDescription id="other"/>')
            pkg = root / 'assets' / 'Other'
            pkg.mkdir(parents=True)
            (pkg / 'package.xml').write_text('<packageDescription id="other123"><resources/></packageDescription>')
            requests = [dict(jsonrpc='2.0', id=i, method='tools/call', params={'name': 'list_packages', 'arguments': {'project': str(p)}}) for i, p in enumerate((self.root, root, self.root), 1)]
            p = subprocess.run([sys.executable, str(Path(__file__).with_name('mcp_server.py'))], input=''.join(json.dumps(r) + '\n' for r in requests), capture_output=True, text=True, check=True)
            results = [json.loads(json.loads(line)['result']['content'][0]['text'])['data'][0]['name'] for line in p.stdout.splitlines()]
            self.assertEqual(results, ['Demo', 'Other', 'Demo'])


if __name__ == '__main__':
    unittest.main()
