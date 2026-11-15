"""Inspect the local editor's output for a cross-package component reference."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import wave

from PIL import Image
from fgui import execute
from published import Reader, inspect, compare_source_images


def run(project, editor):
    repo = Path(__file__).resolve().parent.parent
    with tempfile.TemporaryDirectory(prefix='fgui-cross-editor-') as temp:
        root = Path(temp) / 'project'
        (root / 'assets').mkdir(parents=True)
        for package in ('Bag', 'Basics', 'Chat'):
            shutil.copytree(project / 'assets' / package, root / 'assets' / package)
        descriptor = next(project.glob('*.fairy'))
        shutil.copy2(descriptor, root / descriptor.name)
        if (project / 'settings').is_dir():
            shutil.copytree(project / 'settings', root / 'settings')
            publish_settings = root / 'settings' / 'Publish.json'
            settings = json.loads(publish_settings.read_text(encoding='utf8'))
            settings['compressDesc'] = True
            publish_settings.write_text(json.dumps(settings), encoding='utf8')
        plugin = root / 'plugins' / 'agent-bridge'
        plugin.mkdir(parents=True)
        for filename in ('main.js', 'package.json'):
            shutil.copy2(repo / 'plugin' / filename, plugin / filename)
        fresh = execute('create_package', {'project': str(root), 'name': 'OfflineNew'})
        fresh_args = {'project': str(root), 'pkg': fresh['id'], 'name': 'Main', 'width': 23, 'height': 17, 'exported': True}
        fresh_component = execute('create_component', fresh_args)
        execute('set_component_properties', {**fresh_args, 'expected_sha256': fresh_component['sha256'], 'props': {'size': '30,25', 'pivot': '0.5,0.25', 'opaque': False, 'overflow': 'hidden', 'margin': '1,2,3,4'}})
        extensions = ('Label', 'Button', 'ComboBox', 'ProgressBar', 'Slider', 'ScrollBar')
        extension_ids = {}
        for extension in extensions:
            extension_args = {**fresh_args, 'name': 'Probe' + extension, 'extention': extension}
            component = execute('create_component', extension_args)
            extension_ids[extension] = component['id']
            if extension == 'Button':
                execute('set_button_options', {**extension_args, 'expected_sha256': component['sha256'], 'props': {'mode': 'Check', 'downEffect': 'scale', 'downEffectValue': 0.5}})
            elif extension == 'ScrollBar':
                execute('move_object', {**extension_args, 'target': 'grip', 'index': 0, 'expected_sha256': component['sha256']})
        sound_path = Path(temp) / 'offline-sound.wav'
        with wave.open(str(sound_path), 'wb') as output:
            output.setnchannels(1); output.setsampwidth(2); output.setframerate(8000); output.writeframes(b'\0\0' * 80)
        sound = execute('import_sound', {'project': str(root), 'pkg': fresh['id'], 'source': str(sound_path), 'exported': True})
        imported_audio = [(sound, sound_path)]
        sample_mp3 = project / 'assets' / 'Transition' / 'images' / 'BUZZ4.mp3'
        if sample_mp3.is_file():
            imported_audio.append((execute('import_sound', {'project': str(root), 'pkg': fresh['id'], 'source': str(sample_mp3), 'exported': True}), sample_mp3))
        ffmpeg = shutil.which('ffmpeg')
        if ffmpeg:
            ogg_path = Path(temp) / 'offline-sound.ogg'
            encoded = subprocess.run([ffmpeg, '-v', 'error', '-i', str(sound_path), '-c:a', 'libvorbis', '-y', str(ogg_path)], capture_output=True)
            if encoded.returncode == 0:
                imported_audio.append((execute('import_sound', {'project': str(root), 'pkg': fresh['id'], 'source': str(ogg_path), 'exported': True}), ogg_path))
        movie = execute('import_movieclip', {'project': str(root), 'pkg': fresh['id'], 'source': str(root / 'assets' / 'Bag' / 'images' / 'quan.jta'), 'exported': True})
        trim_path = Path(temp) / 'trim-probe.png'
        with Image.new('RGBA', (8, 7), (0, 0, 0, 0)) as probe:
            for y in range(2, 5):
                for x in range(3, 6): probe.putpixel((x, y), (200, 90, 25, 255))
            probe.save(trim_path)
        trimmed = execute('import_image', {'project': str(root), 'pkg': fresh['id'], 'source': str(trim_path), 'exported': True})
        font_texture = execute('import_image', {'project': str(root), 'pkg': fresh['id'], 'source': str(root / 'assets' / 'Basics' / 'font' / 'BMFontTest_atlas.png'), 'exported': True})
        execute('import_font', {'project': str(root), 'pkg': fresh['id'], 'source': str(root / 'assets' / 'Basics' / 'font' / 'BMFontTest.fnt'), 'texture': font_texture['id'], 'exported': True})
        glyph_font_path = Path(temp) / 'glyph.fnt'
        glyph_font_path.write_text(f'info size=12 colored=true\nchar id=65 img={trimmed["id"]} xoffset=0 yoffset=0 xadvance=8\n', encoding='utf8')
        execute('import_font', {'project': str(root), 'pkg': fresh['id'], 'source': str(glyph_font_path), 'exported': True})
        disposable = execute('import_image', {'project': str(root), 'pkg': fresh['id'], 'source': str(trim_path), 'name': 'unregistered.png'})
        package_before = execute('read_package', {'project': str(root), 'pkg': fresh['id']})
        removed = execute('unregister_resource', {'project': str(root), 'pkg': fresh['id'], 'item': disposable['id'], 'expected_sha256': package_before['sha256']})
        if not Path(removed['retained_file']).is_file(): raise RuntimeError('unregistered file was not retained')
        args = {'project': str(root), 'pkg': 'Bag', 'name': 'CrossPackageProbe'}
        created = execute('create_component', {**args, 'width': 100, 'height': 100, 'path': '/generated/ui/', 'exported': True})
        source_image = Path(temp) / 'probe.png'
        Image.new('RGBA', (7, 5), (12, 34, 56, 255)).save(source_image)
        imported = execute('import_image', {'project': str(root), 'pkg': 'Bag', 'source': str(source_image), 'path': '/images/generated/'})
        package_state = execute('read_package', {'project': str(root), 'pkg': 'Bag'})
        execute('set_image_options', {'project': str(root), 'pkg': 'Bag', 'item': imported['id'], 'expected_sha256': package_state['sha256'], 'props': {'scale': '9grid', 'scale9grid': '1,1,3,2'}})
        xml = f'<component size="100,100"><displayList><component id="n0" name="nested" src="rpmb1b" pkg="9leh0eyf" xy="2,3"/><component id="n1" name="externalButton" src="kfcb1h" pkg="y768eypa"><Button title="Offline cross" checked="true"/></component><text id="n2" name="styled" text="sample"/><component id="n3" name="externalLabel" src="{extension_ids["Label"]}" pkg="{fresh["id"]}"/><richtext id="n4" name="inlineImage" size="30,30" ubb="true" text="[img]ui://{fresh["id"]}{trimmed["id"]}[/img]"/></displayList><transition name="Swap" options="6"><item time="0" type="Text" target="n4" value="Updated text"/><item time="12" type="Icon" target="n1" value="ui://{fresh["id"]}{trimmed["id"]}"/><item time="0" type="Color" target="n2" value="#123456"/><item time="12" type="Color" target="n2" tween="true" startValue="#123456" endValue="#abcdef" duration="24"/></transition></component>'
        written = execute('write_component', {**args, 'xml': xml, 'expected_sha256': created['sha256']})
        button = execute('set_button_instance_options', {**args, 'target': 'externalButton', 'expected_sha256': written['sha256'], 'props': {'title': 'Updated & ready', 'selectedTitle': 'Selected', 'icon': 'ui://OfflineNew/trim-probe', 'selectedIcon': 'ui://' + fresh['id'] + trimmed['id'], 'titleColor': '#123456', 'titleFontSize': 18, 'checked': True}})
        label = execute('set_label_instance_options', {**args, 'target': 'externalLabel', 'expected_sha256': button['sha256'], 'props': {'title': 'Label & icon', 'icon': 'ui://OfflineNew/trim-probe', 'titleColor': '#2468ac', 'titleFontSize': 21}})
        inserted = execute('insert_resource', {**args, 'ref_name': imported['id'], 'object_name': 'imported', 'expected_sha256': label['sha256']})
        controlled = execute('create_controller', {**args, 'controller': 'state', 'pages': [{'id': '0', 'name': 'normal'}, {'id': '1', 'name': 'active'}], 'selected': 1, 'expected_sha256': inserted['sha256']})
        styled = execute('set_properties', {**args, 'target': 'n2', 'expected_sha256': controlled['sha256'], 'props': {'fontSize': 22, 'bold': True, 'italic': True, 'align': 'center', 'vAlign': 'middle', 'autoSize': 'none', 'leading': 4, 'letterSpacing': 2, 'pivot': '0.5,0.5', 'anchor': True, 'grayed': True}})
        display = execute('set_display_gear', {**args, 'target': 'n2', 'controller': 'state', 'pages': ['1'], 'expected_sha256': styled['sha256']})
        text_gear = execute('set_text_gear', {**args, 'target': 'n2', 'controller': 'state', 'pages': ['0', '1'], 'values': ['Normal', 'Active'], 'default': 'Default', 'expected_sha256': display['sha256']})
        removed_gear = execute('remove_gear', {**args, 'target': 'n2', 'gear': 'text', 'expected_sha256': text_gear['sha256']})
        text_gear = execute('set_text_gear', {**args, 'target': 'n2', 'controller': 'state', 'pages': ['0', '1'], 'values': ['Normal', 'Active'], 'default': 'Default', 'expected_sha256': removed_gear['sha256']})
        color_gear = execute('set_color_gear', {**args, 'target': 'n2', 'controller': 'state', 'pages': ['0', '1'], 'values': ['#123456,#010203', '#abcdef'], 'default': '#ffffff,#000000', 'expected_sha256': text_gear['sha256']})
        removed_color = execute('remove_gear', {**args, 'target': 'n2', 'gear': 'color', 'expected_sha256': color_gear['sha256']})
        color_gear = execute('set_color_gear', {**args, 'target': 'n2', 'controller': 'state', 'pages': ['0', '1'], 'values': ['#123456,#010203', '#abcdef'], 'default': '#ffffff,#000000', 'expected_sha256': removed_color['sha256']})
        position_gear = execute('set_position_gear', {**args, 'target': 'n2', 'controller': 'state', 'pages': ['0', '1'], 'values': ['0,0', '20,30'], 'default': '0,0', 'tween': {'enabled': True, 'ease': 'Linear', 'duration': 0.4, 'delay': 0.1}, 'expected_sha256': color_gear['sha256']})
        size_gear = execute('set_size_gear', {**args, 'target': 'n2', 'controller': 'state', 'pages': ['0', '1'], 'values': ['10,20', '30,40,1.5,0.5'], 'default': '10,20', 'expected_sha256': position_gear['sha256']})
        look_gear = execute('set_look_gear', {**args, 'target': 'n2', 'controller': 'state', 'pages': ['0', '1'], 'values': ['1,0,0', '0.5,90,1,0'], 'default': '1,0,0,1', 'tween': {'enabled': True, 'ease': 'Linear', 'duration': 0.4}, 'expected_sha256': size_gear['sha256']})
        font_size_gear = execute('set_font_size_gear', {**args, 'target': 'n2', 'controller': 'state', 'pages': ['0', '1'], 'values': ['16', '28'], 'default': '22', 'expected_sha256': look_gear['sha256']})
        loader = execute('insert_object', {**args, 'object_xml': '<loader id="animation_probe" name="animation_probe" size="20,20"/>', 'expected_sha256': font_size_gear['sha256']})
        animation_gear = execute('set_animation_gear', {**args, 'target': 'animation_probe', 'controller': 'state', 'pages': ['0', '1'], 'values': ['0,p', '2,s'], 'default': '1,p', 'expected_sha256': loader['sha256']})
        icon_gear = execute('set_icon_gear', {**args, 'target': 'animation_probe', 'controller': 'state', 'pages': ['0', '1'], 'values': ['ui://OfflineNew/trim-probe', 'ui://' + fresh['id'] + trimmed['id']], 'default': 'ui://OfflineNew/trim-probe', 'expected_sha256': animation_gear['sha256']})
        display2 = execute('set_display2_gear', {**args, 'target': 'n2', 'controller': 'state', 'pages': ['0'], 'condition': 1, 'expected_sha256': icon_gear['sha256']})
        relation = execute('set_relation', {**args, 'target': 'n2', 'related_to': '', 'side_pairs': ['center-center', 'middle-middle'], 'expected_sha256': display2['sha256']})
        removed_relation = execute('remove_relation', {**args, 'target': 'n2', 'related_to': '', 'expected_sha256': relation['sha256']})
        execute('set_relation', {**args, 'target': 'n2', 'related_to': '', 'side_pairs': ['center-center', 'middle-middle'], 'expected_sha256': removed_relation['sha256']})
        output = Path(temp) / 'out'
        output.mkdir()
        startup = None
        if os.name == 'nt':
            startup = subprocess.STARTUPINFO(); startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW; startup.wShowWindow = 0
        process = subprocess.Popen([str(editor), str(root / descriptor.name)], cwd=editor.parent, startupinfo=startup, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                if process.poll() is not None: raise RuntimeError('editor exited before bridge was ready')
                try:
                    ready = subprocess.run(['node', str(repo / 'cli' / 'fgui.mjs'), 'list-items', json.dumps(args)], capture_output=True, text=True, timeout=8)
                    if ready.returncode == 0 and json.loads(ready.stdout).get('ok'): break
                except subprocess.TimeoutExpired:
                    pass
                time.sleep(1)
            else: raise RuntimeError('editor bridge did not become ready')
            listing = subprocess.run(['node', str(repo / 'cli' / 'fgui.mjs'), 'list-items', json.dumps({'project': str(root), 'pkg': 'OfflineNew'})], capture_output=True, text=True, timeout=20, check=True)
            listing_data = json.loads(listing.stdout)
            if not listing_data.get('ok') or disposable['id'] in json.dumps(listing_data, ensure_ascii=False): raise RuntimeError('editor still lists unregistered resource')
            check = subprocess.run(['node', str(repo / 'cli' / 'fgui.mjs'), 'list-children', json.dumps({'project': str(root), 'pkg': 'OfflineNew', 'name': 'Main'})], capture_output=True, text=True, timeout=20, check=True)
            if not json.loads(check.stdout).get('ok'): raise RuntimeError('editor could not open component in new package')
            for extension in extensions:
                check = subprocess.run(['node', str(repo / 'cli' / 'fgui.mjs'), 'list-children', json.dumps({'project': str(root), 'pkg': 'OfflineNew', 'name': 'Probe' + extension})], capture_output=True, text=True, timeout=20, check=True)
                if not json.loads(check.stdout).get('ok'): raise RuntimeError('editor could not open ' + extension + ' component')
            new_publish = subprocess.run(['node', str(repo / 'cli' / 'fgui.mjs'), 'publish', json.dumps({'project': str(root), 'pkg': 'OfflineNew', 'out_path': str(output), 'timeout_ms': 25000})], capture_output=True, text=True, timeout=35, check=True)
            if not json.loads(new_publish.stdout).get('data', {}).get('isSuccess'): raise RuntimeError('editor could not publish new package')
            for imported_sound, original_sound in imported_audio:
                editor_sound = output / ('OfflineNew_' + imported_sound['id'] + original_sound.suffix.lower())
                if editor_sound.read_bytes() != original_sound.read_bytes(): raise RuntimeError('editor published sound bytes differ: ' + original_sound.name)
            new_generated = execute('publish_simple_experimental', {'project': str(root), 'pkg': fresh['id'], 'output': str(Path(temp) / 'new-offline'), 'exported_only': True, 'trim_images': True})
            editor_new = inspect((output / 'OfflineNew.bin').read_bytes())
            offline_new = inspect(Path(new_generated['file']).read_bytes())
            editor_items = sorted((item for item in editor_new['items'] if item['type'] != 4), key=lambda item: (item['type'], item['id']))
            offline_items = sorted((item for item in offline_new['items'] if item['type'] != 4), key=lambda item: (item['type'], item['id']))
            if editor_items != offline_items:
                from test_publish_samples import differences
                raise RuntimeError('new package differs from editor output: ' + json.dumps(differences(editor_items, offline_items, 'items')[:15], ensure_ascii=False))
            for decoded, file in ((editor_new, output / 'OfflineNew.bin'), (offline_new, Path(new_generated['file']))):
                comparison = compare_source_images(decoded, file, {trimmed['id']: Path(trimmed['path'])})
                if comparison['issues'] or comparison['skipped']: raise RuntimeError('trimmed image mismatch: ' + str(comparison))
            for decoded in (editor_new, offline_new):
                sprite = next(item for item in decoded['sprites'] if item['id'] == trimmed['id'])
                geometry = tuple(sprite.get(key) for key in ('width', 'height', 'offset_x', 'offset_y', 'original_width', 'original_height'))
                if geometry != (3, 3, 3, 2, 8, 7): raise RuntimeError('font glyph trim geometry differs: ' + str(geometry))
            published = subprocess.run(['node', str(repo / 'cli' / 'fgui.mjs'), 'publish', json.dumps({**args, 'out_path': str(output), 'timeout_ms': 25000})], capture_output=True, text=True, timeout=35, check=True)
            response = json.loads(published.stdout)
            if not response.get('ok') or not response['data']['isSuccess']: raise RuntimeError('editor publish failed: ' + published.stdout)
            blob = (output / 'Bag.bin').read_bytes()
            info = inspect(blob)
            children = next(item['component']['children'] for item in info['items'] if item['id'] == created['id'])
            r = Reader(blob); r.take(4); version = r.i32(); r.u8(); r.string(); r.string(); r.take(20); base = r.pos
            r.section(base, 4); r.strings = [r.string() for _ in range(r.i32())]
            r.section(base, 0); dependencies = [{'id': r.ref(), 'name': r.ref()} for _ in range(r.i16())]
            generated = execute('publish_simple_experimental', {'project': str(root), 'pkg': 'Bag', 'output': str(Path(temp) / 'offline'), 'exported_only': True})
            offline = inspect(Path(generated['file']).read_bytes())
            offline_children = next(item['component']['children'] for item in offline['items'] if item['id'] == created['id'])
            if offline_children != children or sorted(offline['dependencies'], key=lambda item: item['id']) != sorted(dependencies, key=lambda item: item['id']):
                from test_publish_samples import differences
                raise RuntimeError('offline output does not match editor cross-package metadata: ' + json.dumps({'children': differences(offline_children, children, 'children')[:15], 'offline_dependencies': offline['dependencies'], 'editor_dependencies': dependencies}, ensure_ascii=False))
            editor_component = next(item['component'] for item in info['items'] if item['id'] == created['id'])
            offline_component = next(item['component'] for item in offline['items'] if item['id'] == created['id'])
            if editor_component.get('controllers') != offline_component.get('controllers'):
                raise RuntimeError('controller pages differ from editor output')
            if editor_component.get('transitions') != offline_component.get('transitions'):
                raise RuntimeError('transition actions differ from editor output: ' + json.dumps({'editor': editor_component.get('transitions'), 'offline': offline_component.get('transitions')}, ensure_ascii=False))
            for decoded in (info, offline):
                image_item = next(item for item in decoded['items'] if item['id'] == imported['id'])
                if image_item.get('scale9Grid') != [1, 1, 3, 2]: raise RuntimeError('nine-slice metadata differs')
            for decoded, path in ((info, output / 'Bag.bin'), (offline, Path(generated['file']))):
                report = compare_source_images(decoded, path, {imported['id']: Path(imported['path'])})
                if report['checked'] != 1 or report['issues'] or report['skipped']:
                    raise RuntimeError('imported image pixels did not round-trip: ' + str(report))
            return {'version': version, 'children': children, 'dependencies': dependencies, 'offline_matches': True, 'imported_image_pixels_match': True, 'created_package_matches': True, 'controller_matches': True, 'display_gear_matches': True, 'display2_gear_matches': True, 'text_gear_matches': True, 'icon_gear_matches': True, 'color_gear_matches': True, 'position_gear_matches': True, 'size_gear_matches': True, 'look_gear_matches': True, 'font_size_gear_matches': True, 'animation_gear_matches': True, 'relation_matches': True}
        finally:
            if process.poll() is None:
                process.terminate()
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired: process.kill(); process.wait()


if __name__ == '__main__':
    print(json.dumps(run(Path(sys.argv[1]), Path(sys.argv[2])), ensure_ascii=False))
