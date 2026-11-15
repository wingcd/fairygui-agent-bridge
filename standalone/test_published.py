import struct
import unittest
import tempfile
from pathlib import Path
from published import inspect, inspect_component, validate_atlases, compare_source_images, compare_source_components


def sample():
    u16 = lambda n: struct.pack('>H', n)
    i32 = lambda n: struct.pack('>i', n)
    string = lambda s: u16(len(s.encode())) + s.encode()
    strings = ['atlas', 'image', 'atlas.png']
    atlas = bytes([4]) + u16(0) + u16(0) + u16(65534) + u16(2) + b'\1' + i32(16) + i32(16)
    item = u16(1) + i32(len(atlas)) + atlas
    sprite = u16(1) + u16(0) + i32(1) + i32(2) + i32(3) + i32(4) + b'\0\0'
    sprites = u16(1) + u16(len(sprite)) + sprite
    table = i32(len(strings)) + b''.join(string(s) for s in strings)
    header = b'FGUI' + i32(2) + b'\0' + string('12345678') + string('demo') + bytes(20)
    index_size = 2 + 5*2
    index = bytes([5, 1]) + u16(0) + u16(index_size) + u16(index_size+len(item)) + u16(0) + u16(index_size+len(item)+len(sprites))
    return header + index + item + sprites + table


class PublishedTest(unittest.TestCase):
    def test_optional_overlap_check_handles_aliases_and_rotated_bounds(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            package = folder / 'demo.bin'
            info = inspect(sample())
            Image.new('RGBA', (16, 16)).save(folder / 'demo_atlas.png')
            original = dict(info['sprites'][0])
            alias = {**original, 'id': 'alias'}
            info['sprites'].append(alias)
            self.assertTrue(validate_atlases(info, package, check_overlaps=True)['valid'])
            partial = {**original, 'id': 'partial', 'x': 3, 'y': 4, 'rotated': True}
            info['sprites'].append(partial)
            self.assertTrue(validate_atlases(info, package)['valid'])
            report = validate_atlases(info, package, check_overlaps=True)
            self.assertFalse(report['valid'])
            self.assertEqual([issue['error'] for issue in report['issues']], ['partially overlapping sprite rectangles'])
            self.assertEqual({report['issues'][0]['sprite'], report['issues'][0]['other_sprite']}, {'image', 'partial'})

    def test_compare_components_detects_child_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'component.xml'
            source.write_text('<component size="10,20"><displayList><text id="a"/><group id="g"/><image id="b"/></displayList></component>')
            info = {'items': [{'id': 'c', 'type': 3, 'component': {'width': 10, 'height': 20, 'children': [{'id': 'a', 'type': 6}, {'id': 'b', 'type': 0}]}}]}
            self.assertFalse(compare_source_components(info, {'c': source})['issues'])
            info['items'][0]['component']['children'].reverse()
            self.assertTrue(compare_source_components(info, {'c': source})['issues'])

    def test_compare_component_references_and_positions(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'component.xml'
            source.write_text('<component size="10,20"><displayList><image id="a" src="image1" xy="12,34"/></displayList></component>')
            child = {'id': 'a', 'type': 0, 'src': 'image1', 'x': 12, 'y': 34}
            info = {'items': [{'id': 'c', 'type': 3, 'component': {'width': 10, 'height': 20, 'children': [child]}}]}
            self.assertFalse(compare_source_components(info, {'c': source})['issues'])
            child.update(src='other', x=13)
            errors = [issue['error'] for issue in compare_source_components(info, {'c': source})['issues']]
            self.assertEqual(errors, ['resource reference differs', 'position differs'])

    def test_compare_component_transform_and_visibility(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'component.xml'
            source.write_text('<component size="10,20"><displayList><image id="a" size="10,20" scale="2,3" pivot="0.5,0.25" visible="false"/></displayList></component>')
            child = {'id': 'a', 'type': 0, 'src': None, 'size': [10,20], 'scale': [2,3], 'pivot': [0.5,0.25,False], 'visible': False}
            info = {'items': [{'id': 'c', 'type': 3, 'component': {'width': 10, 'height': 20, 'children': [child]}}]}
            self.assertFalse(compare_source_components(info, {'c': source})['issues'])
            child['scale'] = [1, 3]
            self.assertEqual(compare_source_components(info, {'c': source})['issues'][0]['error'], 'scale differs')

    def test_compare_component_text_properties(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'component.xml'
            source.write_text('<component size="10,20"><displayList><text id="a" text="hello" fontSize="16" color="#ff0000"/></displayList></component>')
            child = {'type': 6, 'id': 'a', 'src': None, 'text': 'hello', 'fontSize': 16, 'color': [255, 0, 0, 255]}
            info = {'items': [{'id': 'c', 'type': 3, 'component': {'width': 10, 'height': 20, 'children': [child]}}]}
            self.assertFalse(compare_source_components(info, {'c': source})['issues'])
            child['text'] = 'changed'
            self.assertEqual(compare_source_components(info, {'c': source})['issues'][0]['error'], 'text differs')

    def test_compare_text_layout_settings(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'component.xml'
            source.write_text('<component size="10,20"><displayList><text id="a" align="right" vAlign="middle" autoSize="height" leading="5" bold="true"/></displayList></component>')
            child = {'type': 6, 'id': 'a', 'src': None, 'align': 2, 'verticalAlign': 1, 'autoSize': 2, 'leading': 5, 'bold': True}
            info = {'items': [{'id': 'c', 'type': 3, 'component': {'width': 10, 'height': 20, 'children': [child]}}]}
            self.assertFalse(compare_source_components(info, {'c': source})['issues'])
            child['autoSize'] = 0
            self.assertEqual(compare_source_components(info, {'c': source})['issues'][0]['error'], 'autoSize differs')

    def test_compare_explicit_text_image_and_graph_styles(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'component.xml'
            source.write_text('<component size="10,20"><displayList><text id="a" font="Arial" pivot="0.5,0.5" anchor="true" strokeColor="#112233" shadowColor="#445566" shadowOffset="2,3"/><image id="b" color="#123456" flip="hz" fillMethod="radial90" fillClockwise="false" fillAmount="50"/><graph id="c" type="rect" lineSize="2" lineColor="#ff112233" fillColor="#80445566"/></displayList></component>')
            text = {'type': 6, 'id': 'a', 'src': None, 'font': 'Arial', 'pivot': [0.5, 0.5, True], 'strokeColor': [17,34,51,255], 'shadowColor': [68,85,102,255], 'shadowOffset': [2,3]}
            image = {'type': 0, 'id': 'b', 'src': None, 'color': [18,52,86,255], 'flip': 1, 'fillMethod': 3, 'fillClockwise': False, 'fillAmount': 0.5}
            graph = {'type': 3, 'id': 'c', 'src': None, 'graphType': 1, 'lineSize': 2, 'lineColor': [17,34,51,255], 'fillColor': [68,85,102,128]}
            info = {'items': [{'id': 'comp', 'type': 3, 'component': {'width': 10, 'height': 20, 'children': [text, image, graph]}}]}
            self.assertEqual(compare_source_components(info, {'comp': source})['issues'], [])
            text.update(font='Other', pivot=[0.5, 0.5, False], strokeColor=[0,0,0,255], shadowOffset=[9,3])
            image.update(flip=0, fillAmount=1)
            graph.update(graphType=2, fillColor=[0,0,0,128])
            errors = {issue['error'] for issue in compare_source_components(info, {'comp': source})['issues']}
            self.assertEqual(errors, {'font differs', 'anchor differs', 'strokeColor differs', 'shadowOffset differs', 'image flip differs', 'image fillAmount differs', 'graph type differs', 'graph fillColor differs'})

    def test_compare_richtext_type_and_ubb(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'component.xml'
            source.write_text('<component size="10,20"><displayList><richtext id="a" ubb="true"/></displayList></component>')
            child = {'type': 6, 'id': 'a', 'src': None, 'ubb': False}
            info = {'items': [{'id': 'c', 'type': 3, 'component': {'width': 10, 'height': 20, 'children': [child]}}]}
            self.assertEqual({x['error'] for x in compare_source_components(info, {'c': source})['issues']}, {'object type differs', 'ubb differs'})
    def test_component_child_headers_and_truncation(self):
        u16 = lambda n: struct.pack('>H', n)
        i32 = lambda n: struct.pack('>i', n)
        childbase = bytes([9]) + u16(65534) + u16(65534) + u16(0) + u16(1) + i32(12) + i32(34) + b'\0\0\0\0\0' + struct.pack('>ff',1,0) + b'\1\1\0\0\0' + u16(65534)
        child = bytes([1, 1]) + u16(4) + childbase
        size = i32(100) + i32(50) + b'\0\0\0\0\0'
        children = u16(1) + u16(len(child)) + child
        index = bytes([3, 1]) + u16(8) + u16(0) + u16(8 + len(size))
        data = index + size + children
        result = inspect_component(data, ['id1', 'label'])
        self.assertEqual((result['width'], result['height']), (100, 50))
        self.assertEqual(result['children'][0]['name'], 'label')
        self.assertEqual((result['children'][0]['x'], result['children'][0]['y']), (12, 34))
        with self.assertRaises(ValueError): inspect_component(data[:-1], ['id1', 'label'])

    def test_metadata_and_corruption(self):
        data = sample()
        info = inspect(data)
        self.assertEqual(info['name'], 'demo')
        self.assertEqual(info['items'][0]['id'], 'atlas')
        self.assertEqual(info['sprites'][0]['width'], 3)
        for broken in (b'BAD!', data[:30], data[:-1]):
            with self.assertRaises(ValueError): inspect(broken)

    def test_inspect_pixel_hit_test_data(self):
        u16 = lambda n: struct.pack('>H', n)
        i32 = lambda n: struct.pack('>i', n)
        string = lambda s: u16(len(s.encode())) + s.encode()
        hit = u16(0) + i32(0) + i32(4) + b'\2' + i32(2) + b'\x55\xaa'
        item_section = u16(0)
        hit_section = u16(1) + i32(len(hit)) + hit
        table = i32(1) + string('image')
        index_size = 12
        index = bytes([5, 1]) + u16(0) + u16(index_size) + u16(0) + u16(index_size + len(item_section)) + u16(index_size + len(item_section) + len(hit_section))
        data = b'FGUI' + i32(1) + b'\0' + string('12345678') + string('demo') + bytes(20) + index + item_section + hit_section + table
        self.assertEqual(inspect(data)['hitTests'], [{'id': 'image', 'reserved': 0, 'width': 4, 'divisor': 2, 'pixels': '55aa'}])
        with self.assertRaises(ValueError): inspect(data[:-1])

    def test_validate_rejects_missing_pixel_hit_data(self):
        info = {'items': [{'id': 'component', 'type': 3, 'component': {'settings': {'hitTest': 'image'}}}], 'sprites': [], 'hitTests': []}
        result = validate_atlases(info, 'demo.bin')
        self.assertIn('missing pixel hit test data', [issue['error'] for issue in result['issues']])

    def test_atlas_file_and_rotated_bounds(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as tmp:
            package = Path(tmp) / 'demo.bin'
            info = inspect(sample())
            result = validate_atlases(info, package)
            self.assertFalse(result['valid'])
            Image.new('RGBA', (16, 16)).save(Path(tmp) / 'demo_atlas.png')
            self.assertTrue(validate_atlases(info, package)['valid'])
            sprite = info['sprites'][0]
            sprite.update(x=13, y=12, width=4, height=3, rotated=True)
            self.assertTrue(validate_atlases(info, package)['valid'])
            sprite['rotated'] = False
            self.assertFalse(validate_atlases(info, package)['valid'])

    def test_atlas_validation_rejects_duplicate_and_missing_sprites(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            Image.new('RGBA', (16, 16)).save(root / 'demo_atlas.png')
            info = inspect(sample())
            info['items'].append({'id': 'image', 'type': 0})
            self.assertTrue(validate_atlases(info, root / 'demo.bin')['valid'])
            info['sprites'].append(dict(info['sprites'][0]))
            self.assertIn('missing or duplicate sprite id', [x['error'] for x in validate_atlases(info, root / 'demo.bin')['issues']])
            info['sprites'].clear()
            self.assertIn('image has no sprite', [x['error'] for x in validate_atlases(info, root / 'demo.bin')['issues']])

    def test_atlas_validation_rejects_invalid_trim(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            Image.new('RGBA', (16, 16)).save(root / 'demo_atlas.png')
            info = inspect(sample())
            info['sprites'][0].update(offset_x=2, offset_y=0, original_width=4, original_height=4)
            self.assertIn('invalid trimmed sprite geometry', [x['error'] for x in validate_atlases(info, root / 'demo.bin')['issues']])

    def test_source_comparison_detects_changed_pixel(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            info = inspect(sample())
            src = Image.new('RGBA', (3, 4), (10, 20, 30, 255))
            src.save(root / 'source.png')
            sheet = Image.new('RGBA', (16, 16))
            sheet.paste(src, (1, 2))
            sheet.save(root / 'demo_atlas.png')
            args = (info, root / 'demo.bin', {'image': root / 'source.png'})
            self.assertEqual(compare_source_images(*args)['checked'], 1)
            sheet.putpixel((1, 2), (0, 0, 0, 255))
            sheet.save(root / 'demo_atlas.png')
            self.assertTrue(compare_source_images(*args)['issues'])

    def test_source_comparison_decodes_each_atlas_once(self):
        from PIL import Image
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            info = inspect(sample())
            info['sprites'].append({**info['sprites'][0], 'id': 'image2'})
            source = Image.new('RGBA', (3, 4), (10, 20, 30, 255))
            source.save(root / 'source.png')
            sheet = Image.new('RGBA', (16, 16))
            sheet.paste(source, (1, 2))
            sheet.save(root / 'demo_atlas.png')
            original = Image.open
            with patch('PIL.Image.open', wraps=original) as opened:
                report = compare_source_images(info, root / 'demo.bin', {'image': root / 'source.png', 'image2': root / 'source.png'})
            self.assertEqual(report['checked'], 2)
            self.assertEqual(sum(Path(call.args[0]).name == 'demo_atlas.png' for call in opened.call_args_list), 1)

    def test_source_comparison_checks_pixels_outside_trim(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            info = inspect(sample())
            sprite = info['sprites'][0]
            sprite.update(width=2, height=2, offset_x=1, offset_y=1, original_width=4, original_height=4)
            source = Image.new('RGBA', (4, 4))
            source.paste((1, 2, 3, 255), (1, 1, 3, 3))
            source.save(root / 'source.png')
            sheet = Image.new('RGBA', (16, 16))
            sheet.paste(source.crop((1, 1, 3, 3)), (1, 2))
            sheet.save(root / 'demo_atlas.png')
            args = (info, root / 'demo.bin', {'image': root / 'source.png'})
            self.assertEqual(compare_source_images(*args)['checked'], 1)
            source.putpixel((0, 0), (1, 1, 1, 1))
            source.save(root / 'source.png')
            self.assertIn('trimmed region', compare_source_images(*args)['issues'][0]['error'])


if __name__ == '__main__': unittest.main()
