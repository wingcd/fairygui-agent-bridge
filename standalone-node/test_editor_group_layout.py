"""Probe advanced-group serialization in a temporary FairyGUI project."""
import json, os, shutil, subprocess, sys, tempfile, time
from pathlib import Path
from test_editor_roundtrip import repo, node_cli, bridge_cli, invoke, inspect

def run(source, editor):
    with tempfile.TemporaryDirectory(prefix='fgui-group-layout-') as temp:
        root=Path(temp)/'project';shutil.copytree(source,root)
        plugin=root/'plugins'/'agent-bridge';plugin.mkdir(parents=True,exist_ok=True)
        for name in ('main.js','package.json'):shutil.copy2(repo/'plugin'/name,plugin/name)
        package=invoke(node_cli,'list_packages',{'project':str(root)})[0]['name'];base={'project':str(root),'pkg':package,'name':'NodeGroupLayoutProbe'}
        created=invoke(node_cli,'create_component',{**base,'width':100,'height':100,'exported':True})
        groups=''.join(f'<group id="g{i}" name="{layout}" xy="0,0" size="40,40"/>' for i,layout in enumerate(('none','hz','vt')))
        invoke(node_cli,'write_component',{**base,'expected_sha256':created['sha256'],'xml':f'<component size="100,100"><displayList>{groups}<graph id="member" xy="3,4" size="10,10"/></displayList></component>'})
        for i,layout in enumerate(('none','hz','vt')):
            revision=invoke(node_cli,'read_component',base)['sha256']
            invoke(node_cli,'set_properties',{**base,'target':f'g{i}','expected_sha256':revision,'props':{'advanced':True,'layout':layout,'lineGap':7,'colGap':5,'excludeInvisibles':True,'autoSizeDisabled':True,'mainGridIndex':2}})
        revision=invoke(node_cli,'read_component',base)['sha256']
        invoke(node_cli,'set_properties',{**base,'target':'member','expected_sha256':revision,'props':{'group':'g1'}})
        startup=None
        if os.name=='nt':startup=subprocess.STARTUPINFO();startup.dwFlags|=subprocess.STARTF_USESHOWWINDOW;startup.wShowWindow=0
        process=subprocess.Popen([str(editor),str(next(root.glob('*.fairy')))],cwd=editor.parent,startupinfo=startup,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            deadline=time.monotonic()+75
            while True:
                if process.poll() is not None:raise RuntimeError('editor exited before bridge was ready')
                try:invoke(bridge_cli,'list-children',base,8);break
                except (RuntimeError,subprocess.SubprocessError,json.JSONDecodeError):
                    if time.monotonic()>deadline:raise RuntimeError('editor bridge did not become ready')
                    time.sleep(2)
            output=Path(temp)/'output';output.mkdir();response=invoke(bridge_cli,'publish',{**base,'out_path':str(output),'timeout_ms':60000},80)
            if not response.get('isSuccess'):raise RuntimeError(f'editor publish failed: {response}')
            for file in output.iterdir():
                if file.suffix.lower() not in ('.bytes','.fui','.bin'):continue
                try:data=inspect(file.read_bytes())
                except Exception:continue
                for item in data['items']:
                    if item.get('name')=='NodeGroupLayoutProbe':
                        result=item['component']['children']
                        member=next(child for child in result if child.get('id')=='member')
                        if member.get('groupIndex')!=1:raise RuntimeError(f'editor group membership differs: {member}')
                        generated=invoke(node_cli,'publish_basic_experimental',{'project':str(root),'pkg':package,'output':str(Path(temp)/'node-publish'),'exported_only':True},120)
                        node_items=inspect(Path(generated['file']).read_bytes())['items']
                        node_children=next(value for value in node_items if value.get('name')=='NodeGroupLayoutProbe')['component']['children']
                        fields=('id','layout','lineGap','columnGap','excludeInvisibles','autoSizeDisabled','mainGridIndex','groupIndex')
                        def projection(records):return [{key:record[key] for key in fields if key in record} for record in records]
                        if projection(result)!=projection(node_children):raise RuntimeError(f'group serialization differs: editor={projection(result)} node={projection(node_children)}')
                        return result
            raise RuntimeError('published group component not found')
        finally:
            if process.poll() is None:
                process.terminate()
                try:process.wait(timeout=10)
                except subprocess.TimeoutExpired:process.kill();process.wait(timeout=10)

if __name__=='__main__':print(json.dumps(run(Path(sys.argv[1]),Path(sys.argv[2])),ensure_ascii=False))
