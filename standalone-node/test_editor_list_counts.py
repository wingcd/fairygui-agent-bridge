"""Probe list count property names on a temporary project in the real editor."""
import json, os, shutil, subprocess, sys, tempfile, time
from pathlib import Path
from test_editor_roundtrip import repo, node_cli, bridge_cli, invoke, inspect, compare_packages, compare_atlas_pixels

def run(source, editor):
    with tempfile.TemporaryDirectory(prefix='fgui-list-count-probe-') as temp:
        root = Path(temp) / 'project'; shutil.copytree(source, root)
        plugin = root / 'plugins' / 'agent-bridge'; plugin.mkdir(parents=True, exist_ok=True)
        for name in ('main.js', 'package.json'): shutil.copy2(repo / 'plugin' / name, plugin / name)
        package_record = invoke(node_cli, 'list_packages', {'project':str(root)})[0]
        package = package_record['name']
        base = {'project':str(root), 'pkg':package, 'name':'NodeListCountProbe'}
        created = invoke(node_cli, 'create_component', {**base, 'width':100, 'height':100, 'exported':True})
        lists=''.join(f'<list id="n{i}" name="{layout}" xy="0,0" size="100,100" layout="{layout}" lineItemCount="3" lineItemCount2="7"/>' for i,layout in enumerate(('column','row','flow_hz','flow_vt','pagination')))
        item = next(entry for entry in invoke(node_cli,'list_items',{'project':str(root),'pkg':package}) if entry['type']=='component' and entry['id']!=created['id'])
        url='ui://'+package_record['id']+item['id']
        lists += f'<list id="flags" name="flags" xy="0,0" size="100,100" defaultItem="{url}" autoClearItems="true" scrollItemToViewOnClick="false" foldInvisibleItems="true"><item title="clear"/></list>'
        lists += f'<list id="keep" name="keep" xy="0,0" size="100,100" defaultItem="{url}" autoClearItems="false"><item title="keep"/></list>'
        lists += ''.join(f'<list id="r{i}" name="{order}" xy="0,0" size="100,100" renderOrder="{order}"/>' for i,order in enumerate(('arch','descent','ascent')))
        invoke(node_cli, 'write_component', {**base, 'expected_sha256':created['sha256'], 'xml':f'<component size="100,100"><displayList>{lists}</displayList></component>'})
        startup = None
        if os.name == 'nt': startup = subprocess.STARTUPINFO(); startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW; startup.wShowWindow = 0
        process = subprocess.Popen([str(editor),str(next(root.glob('*.fairy')))],cwd=editor.parent,startupinfo=startup,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            deadline=time.monotonic()+75
            while True:
                if process.poll() is not None: raise RuntimeError('editor exited before bridge was ready')
                try: invoke(bridge_cli,'list-children',base,8); break
                except (RuntimeError,subprocess.SubprocessError,json.JSONDecodeError):
                    if time.monotonic()>deadline: raise RuntimeError('editor bridge did not become ready')
                    time.sleep(2)
            output=Path(temp)/'output';output.mkdir()
            published=invoke(bridge_cli,'publish',{**base,'out_path':str(output),'timeout_ms':60000},80)
            if not published.get('isSuccess'): raise RuntimeError(f'editor publish failed: {published}')
            node=invoke(node_cli,'publish_basic_experimental',{'project':str(root),'pkg':package,'output':str(Path(temp)/'node-output'),'exported_only':True},120)
            node_file=Path(node['file']);node_package=inspect(node_file.read_bytes())
            files=[p for p in output.iterdir() if p.is_file() and p.suffix.lower() in ('.bytes','.fui','.bin')]
            for file in files:
                try: data=inspect(file.read_bytes())
                except Exception: continue
                for item in data['items']:
                    if item.get('name')=='NodeListCountProbe':
                        differences=compare_packages(node_package,data)+compare_atlas_pixels(node_package,data,node_file,file)
                        if differences: raise RuntimeError(f'Node list publication differs from editor: {differences[:5]}')
                        return [{'name':child['name'],**child['list']} for child in item['component']['children']]
            raise RuntimeError(f'published component not found in {files}')
        finally:
            if process.poll() is None:
                process.terminate()
                try: process.wait(timeout=10)
                except subprocess.TimeoutExpired: process.kill();process.wait(timeout=10)

if __name__ == '__main__':
    print(json.dumps(run(Path(sys.argv[1]),Path(sys.argv[2])),ensure_ascii=False))
