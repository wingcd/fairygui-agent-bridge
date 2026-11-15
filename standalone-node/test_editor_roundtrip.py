"""Open Node-authored components in a real FairyGUI editor on a temporary project copy."""
import json, os, re, shutil, subprocess, sys, tempfile, time
import xml.etree.ElementTree as ET
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent / 'standalone'))
from published import inspect
from test_full_reference import compare_packages
from test_editor_fresh import compare_atlas_pixels

repo = Path(__file__).resolve().parent.parent
node_cli = repo / 'standalone-node' / 'fgui.mjs'
bridge_cli = repo / 'cli' / 'fgui.mjs'

def invoke(cli, command, args, timeout=30):
    result = subprocess.run(['node', str(cli), command, json.dumps(args, ensure_ascii=False)], capture_output=True, text=True, encoding='utf-8', timeout=timeout)
    if result.returncode: raise RuntimeError(f'{command}: {result.stdout} {result.stderr}')
    response = json.loads(result.stdout)
    if not response.get('ok'): raise RuntimeError(f'{command}: {response}')
    return response['data']

def run(source, editor, limit=None):
    with tempfile.TemporaryDirectory(prefix='fgui-node-editor-') as temp:
        root = Path(temp) / 'project'
        shutil.copytree(source, root)
        plugin = root / 'plugins' / 'agent-bridge'; plugin.mkdir(parents=True, exist_ok=True)
        for name in ('main.js', 'package.json'): shutil.copy2(repo / 'plugin' / name, plugin / name)
        packages = invoke(node_cli, 'list_packages', {'project': str(root)})
        if limit is not None: packages = packages[:limit]
        created, edited, skipped = [], [], []
        for package in packages:
            pkg_name = package['name']
            if os.environ.get('FGUI_TEST_UTF16_PACKAGE') == '1':
                package_file = Path(package['path']) / 'package.xml'
                xml = package_file.read_text(encoding='utf-8-sig')
                if re.match(r'<\?xml\b', xml):
                    xml = re.sub(r'(<\?xml\s+[^?]*?\bencoding\s*=\s*["\'])[^"\']+', r'\1utf-16', xml, count=1, flags=re.I)
                else:
                    xml = '<?xml version="1.0" encoding="utf-16"?>\n' + xml
                package_file.write_text(xml, encoding='utf-16')
            items = invoke(node_cli, 'list_items', {'project': str(root), 'pkg': pkg_name})
            for resource in items:
                if resource['type'] != 'component': continue
                sample = {'project': str(root), 'pkg': pkg_name, 'name': resource['id']}
                original = invoke(node_cli, 'read_component', sample)
                objects = ET.fromstring(original['xml']).findall('./displayList/*')
                child = next((obj for obj in objects if obj.get('id') and obj.tag != 'group'), None)
                if child is None: continue
                invoke(node_cli, 'set_properties', {**sample, 'target': child.get('id'), 'props': {'xy': '123,456'}, 'expected_sha256': original['sha256']})
                edited.append(({**sample, 'name': Path(resource['name']).stem}, child.get('id')))
                break
            else: skipped.append(pkg_name)
            base = {'project': str(root), 'pkg': package['name'], 'name': 'NodeEditorRoundtrip'}
            list_resource = next((entry for entry in items if entry['type'] == 'component'), None)
            list_url = 'ui://' + package['id'] + list_resource['id'] if list_resource else None
            item = invoke(node_cli, 'create_component', {**base, 'width': 123, 'height': 77, 'exported': True})
            xml = '<component size="123,77"><displayList><text id="n0" name="label" xy="10,20" text="Node offline"/></displayList></component>'
            if os.environ.get('FGUI_TEST_REPAIR') == '1':
                Path(item['path']).write_text('<component><displayList>', encoding='utf-8')
                item = invoke(node_cli, 'read_component', base)
                if invoke(node_cli, 'validate', {'project': str(root)})['valid']:
                    raise RuntimeError('validation failed to detect malformed component')
            written = invoke(node_cli, 'write_component', {**base, 'xml': xml, 'expected_sha256': item['sha256']})
            normalized = invoke(node_cli, 'set_component_properties', {**base, 'props':{'size':' 123, 77 ', 'margin':' 1, 2, 3, 4 '}, 'expected_sha256':written['sha256']})
            normalized = invoke(node_cli, 'set_component_properties', {**base, 'props':{'overflow':'scroll','scroll':'horizontal','scrollBar':'auto','scrollBarFlags':4,'scrollBarMargin':'1,2,3,4'}, 'expected_sha256':normalized['sha256']})
            normalized = invoke(node_cli, 'set_component_properties', {**base, 'props':{'overflow':'hidden','scroll':None,'scrollBar':None,'scrollBarFlags':None,'scrollBarMargin':None}, 'expected_sha256':normalized['sha256']})
            normalized = invoke(node_cli, 'set_component_properties', {**base, 'props':{'overflow':'scroll','scroll':'horizontal','scrollBar':'auto','scrollBarFlags':4,'scrollBarMargin':'1,2,3,4'}, 'expected_sha256':normalized['sha256']})
            effects = invoke(node_cli, 'set_properties', {**base, 'target':'n0', 'props':{'xy':' 10, 20 ', 'leading':' 3 ', 'strokeColor':'#112233','shadowColor':'#445566','shadowOffset':'2,3'}, 'expected_sha256':normalized['sha256']})
            controller = invoke(node_cli, 'create_controller', {**base, 'controller': 'state', 'pages': [{'id': 'p0', 'name': 'Normal'}, {'id': 'p1', 'name': 'Active'}], 'expected_sha256': effects['sha256']})
            changed = invoke(node_cli, 'set_display_gear', {**base, 'target': 'n0', 'controller': 'state', 'pages': ['p1'], 'expected_sha256': controller['sha256']})
            changed = invoke(node_cli, 'insert_object', {**base, 'object_xml': '<graph id="n1" name="decoration" xy="0,0" size="10,10" scale="0.5,1" pivot="0.2,0.3" anchor="true" alpha="0.5" rotation="45" type="rect" lineSize="1" lineColor="#ff000000" fillColor="#ffffffff" corner="3"/>', 'expected_sha256': changed['sha256']})
            changed = invoke(node_cli, 'insert_object', {**base, 'object_xml': '<text id="input" name="input" xy="10,40" input="true"/>', 'expected_sha256': changed['sha256']})
            changed = invoke(node_cli, 'set_properties', {**base,'target':'input','props':{'prompt':'Enter','restrict':'0-9','maxLength':5,'keyboardType':2,'password':True},'expected_sha256':changed['sha256']})
            changed = invoke(node_cli, 'insert_object', {**base, 'object_xml': '<graph id="poly" name="polygon" xy="40,5" size="20,20"/>', 'expected_sha256': changed['sha256']})
            changed = invoke(node_cli, 'set_properties', {**base, 'target':'poly','props':{'type':'polygon','lineSize':2,'lineColor':'#ff112233','fillColor':'#ff445566','points':'0,0,20,0,10,20'},'expected_sha256':changed['sha256']})
            changed = invoke(node_cli, 'insert_object', {**base, 'object_xml': '<graph id="regular" name="regular" xy="65,5" size="20,20"/>', 'expected_sha256': changed['sha256']})
            changed = invoke(node_cli, 'set_properties', {**base, 'target':'regular','props':{'type':'regular_polygon','sides':3,'startAngle':15,'distances':'1,0.8,1'},'expected_sha256':changed['sha256']})
            changed = invoke(node_cli, 'set_component_properties', {**base, 'props':{'mask':'n1','hitTest':'n0','reversedMask':True,'opaque':False},'expected_sha256':changed['sha256']})
            changed = invoke(node_cli, 'insert_object', {**base, 'object_xml': '<list id="list" name="list" xy="5,5" size="40,30"/>', 'expected_sha256': changed['sha256']})
            changed = invoke(node_cli, 'set_properties', {**base, 'target':'list','props':{'layout':'flow_hz','selectionMode':'multiple','lineGap':6,'colGap':3,'lineItemCount':3,'lineItemCount2':7,'autoItemSize':False,'overflow':'hidden','selectionController':'state'},'expected_sha256':changed['sha256']})
            if list_url:
                changed = invoke(node_cli, 'set_list_items', {**base,'target':'list','items':[{'url':list_url,'title':'First'},{'url':list_url,'title':'Second'}],'expected_sha256':changed['sha256']})
            changed = invoke(node_cli, 'insert_object', {**base, 'object_xml': '<list id="list2" name="list2" xy="5,5" size="40,30"/>', 'expected_sha256': changed['sha256']})
            changed = invoke(node_cli, 'set_properties', {**base, 'target':'list2','props':{'layout':'pagination','lineItemCount':3,'lineItemCount2':7},'expected_sha256':changed['sha256']})
            changed = invoke(node_cli, 'insert_object', {**base, 'object_xml': '<list id="list3" name="list3" xy="5,5" size="40,30" treeView="true"/>', 'expected_sha256': changed['sha256']})
            changed = invoke(node_cli, 'set_properties', {**base, 'target':'list3','props':{'layout':'flow_vt','lineItemCount':3,'lineItemCount2':7,'overflow':'scroll','scroll':'horizontal','scrollBar':'auto','scrollBarFlags':4,'scrollBarMargin':'1,2,3,4','margin':'5,6,7,8','clipSoftness':'2,3','pageController':'state'},'expected_sha256':changed['sha256']})
            changed = invoke(node_cli, 'set_properties', {**base, 'target':'list3','props':{'overflow':'hidden','scroll':None,'scrollBar':None,'scrollBarFlags':None,'scrollBarMargin':None,'pageController':None},'expected_sha256':changed['sha256']})
            changed = invoke(node_cli, 'set_properties', {**base, 'target':'list3','props':{'overflow':'scroll','scroll':'horizontal','scrollBar':'auto','scrollBarFlags':4,'scrollBarMargin':'1,2,3,4','pageController':'state'},'expected_sha256':changed['sha256']})
            if list_url:
                changed = invoke(node_cli, 'set_list_items', {**base,'target':'list3','items':[{'url':list_url,'title':'Root','level':0},{'url':list_url,'title':'Child','level':1}],'expected_sha256':changed['sha256']})
            changed = invoke(node_cli, 'insert_object', {**base, 'object_xml': '<graph id="n2" name="removed" xy="0,0" size="5,5" type="rect" lineSize="1" lineColor="#ff000000" fillColor="#ffffffff"/>', 'expected_sha256': changed['sha256']})
            changed = invoke(node_cli, 'move_object', {**base, 'target': 'n1', 'index': 0, 'expected_sha256': changed['sha256']})
            changed = invoke(node_cli, 'remove_object', {**base, 'target': 'n2', 'expected_sha256': changed['sha256']})
            changed = invoke(node_cli, 'set_text_gear', {**base, 'target': 'n0', 'controller': 'state', 'pages': ['p0', 'p1'], 'values': ['Normal', 'Active'], 'expected_sha256': changed['sha256']})
            invoke(node_cli, 'set_position_gear', {**base, 'target': 'n1', 'controller': 'state', 'pages': ['p0', 'p1'], 'values': ['0,0', '10,20'], 'tween': {'enabled': True, 'ease': 'Linear', 'duration': 0.3}, 'expected_sha256': changed['sha256']})
            current=invoke(node_cli,'read_component',base);changed=invoke(node_cli,'upsert_transition',{**base,'transition_xml':'<transition name="test_transition"><item type="Alpha" time="12" target="n1" value="0.5"/><item type="XY" time="0" target="n1" tween="true" duration="24" ease="Linear" startValue="0,0" endValue="10,20"/></transition>','expected_sha256':current['sha256']})
            invoke(node_cli,'set_controller_actions',{**base,'controller':'state','actions':[{'transition':'test_transition','from_pages':['p0'],'to_pages':['p1']}],'expected_sha256':changed['sha256']})
            listed = invoke(node_cli, 'list_transitions', base)
            transition = next((entry for entry in listed['transitions'] if entry['name'] == 'test_transition'), None)
            if not transition or [item['attributes'].get('type') for item in transition['items']] != ['Alpha', 'XY'] or transition['items'][1]['attributes'].get('endValue') != '10,20':
                raise RuntimeError(f'Node transition listing differs from source: {listed}')
            if listed['sha256'] != invoke(node_cli, 'read_component', base)['sha256']:
                raise RuntimeError('transition listing returned a stale component hash')
            created.append(base)
        startup = None
        if os.name == 'nt': startup = subprocess.STARTUPINFO(); startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW; startup.wShowWindow = 0
        process = subprocess.Popen([str(editor), str(next(root.glob('*.fairy')))], cwd=editor.parent, startupinfo=startup, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic()+75
            while True:
                if process.poll() is not None: raise RuntimeError('editor exited before bridge was ready')
                try: invoke(bridge_cli, 'read-component', created[0], 8); break
                except (RuntimeError, subprocess.SubprocessError, json.JSONDecodeError):
                    if time.monotonic()>deadline: raise RuntimeError('editor bridge did not become ready')
                    time.sleep(2)
            for item in created:
                result = invoke(bridge_cli, 'list-children', item)
                if [child.get('name') for child in result.get('children', [])] != ['decoration', 'label', 'input', 'polygon', 'regular', 'list', 'list2', 'list3']: raise RuntimeError(f'editor did not load Node-authored component: {item}; actual={result}')
                invoke(bridge_cli, 'close-doc', item)
            for sample, child_id in edited:
                result = invoke(bridge_cli, 'list-children', sample)
                if child_id not in [child.get('id') for child in result.get('children', [])]: raise RuntimeError(f'editor did not load edited sample child: {sample}')
                invoke(bridge_cli, 'close-doc', sample)
            components_checked=0
            (Path(temp) / 'node-output').mkdir()
            for sample in created:
                editor_output = Path(temp) / 'editor-output' / sample['pkg']; editor_output.mkdir(parents=True)
                response = invoke(bridge_cli, 'publish', {**sample, 'out_path': str(editor_output), 'timeout_ms': 60000}, 80)
                if not response.get('isSuccess'): raise RuntimeError(f"editor publication failed: {sample['pkg']}")
                generated = invoke(node_cli, 'publish_basic_experimental', {'project': str(root), 'pkg': sample['pkg'], 'output': str(Path(temp) / 'node-output' / sample['pkg']), 'exported_only': True}, 120)
                node_file = Path(generated['file']); editor_file = editor_output / node_file.name
                node_validation = invoke(node_cli, 'validate_published', {'project':str(root),'file':str(editor_file),'compare_source':True,'compare_components':True,'exported_only':True},120)
                if not node_validation['valid']: raise RuntimeError(f"Node validation of {sample['pkg']} failed: {node_validation['issues']}")
                components_checked += node_validation['components_compared']
                actual, expected = inspect(node_file.read_bytes()), inspect(editor_file.read_bytes())
                differences = compare_packages(actual, expected) + compare_atlas_pixels(actual, expected, node_file, editor_file)
                if differences: raise RuntimeError(f"edited package {sample['pkg']} differs from editor publication: {differences[:5]}")
            build=source.parent.parent/'source'/'build';graph_runtime=False
            if (build/'UIPackage.js').is_file() and not generated['dependencies']:
                observations=[]
                for file in (node_file,editor_file):
                    result=subprocess.run(['node',str(repo/'standalone'/'check_cocos_reader.cjs'),str(build),str(file)],capture_output=True,text=True,encoding='utf-8',timeout=60)
                    if result.returncode:raise RuntimeError('Cocos graph reader failed: '+result.stderr)
                    package=json.loads(result.stdout);comp=next(c for c in package['constructed'] if any(child.get('name')=='polygon' for child in c['children']));graphs={child['name']:{key:child.get(key) for key in ('graphType','graphPoints','graphSides','graphStartAngle','graphDistances')} for child in comp['children'] if child.get('name') in ('polygon','regular')};observations.append(graphs)
                if observations[0]!=observations[1] or observations[0]['polygon']['graphType']!=3 or observations[0]['regular']['graphType']!=4 or observations[0]['regular']['graphSides']!=3:raise RuntimeError(f'Cocos graph properties differ: {observations}')
                graph_runtime=True
            return {'editor_opened': True, 'packages': len(created), 'components_loaded': len(created), 'existing_samples_loaded': len(edited), 'edited_publications_compared': len(created), 'editor_components_checked_by_node':components_checked, 'cocos_graph_reader_checked':graph_runtime, 'skipped_samples': skipped}
        finally:
            if process.poll() is None:
                process.terminate()
                try: process.wait(timeout=10)
                except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=10)

if __name__ == '__main__':
    print(json.dumps(run(Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3]) if len(sys.argv)>3 else None), ensure_ascii=False))
