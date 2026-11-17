"""Adapt the referenced generator templates and check them with FairyGUI Editor.

Usage: python standalone-node/test_editor_generator.py TEMPLATE_DIR EDITOR_EXE
All generated resources and editor output live in a temporary directory.
"""
import json, os, shutil, subprocess, sys, tempfile, time
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image
from test_editor_roundtrip import repo, node_cli, bridge_cli, invoke
from test_editor_fresh import run as compare_publication


def run(templates, editor):
    files = sorted(templates.glob('*.xml'))
    if not files: raise RuntimeError('no generator templates found')
    with tempfile.TemporaryDirectory(prefix='fgui-generator-editor-') as temp:
        root=Path(temp)/'project';common=root/'assets'/'Common';ui=root/'assets'/'UI'
        common.mkdir(parents=True);ui.mkdir(parents=True)
        (root/'p.fairy').write_text('<projectDescription type="CocosCreator"/>',encoding='utf-8')
        image_names=set();component_names=set()
        for file in files:
            for element in ET.parse(file).getroot().iter():
                value=element.get('src') or (element.get('url') if element.tag=='item' else None)
                if value and value.startswith('ui://Common/'):
                    (image_names if element.tag=='image' else component_names).add(value[len('ui://Common/'):])
        if image_names & component_names: raise RuntimeError('fixture resource names are ambiguous')
        records=[]
        for index,(kind,name) in enumerate([*(('image',name) for name in sorted(image_names)),*(('component',name) for name in sorted(component_names))]):
            filename=name+('.png' if kind=='image' else '.xml')
            records.append(f'<{kind} id="r{index:07d}" name="{filename}" path="/" exported="true"/>')
            if kind=='image': Image.new('RGBA',(16,16),(255,255,255,255)).save(common/filename)
            else: (common/filename).write_text('<component size="100,40" extention="Button"><displayList/><Button/></component>',encoding='utf-8')
        (common/'package.xml').write_text('<packageDescription id="abcdefgh"><resources>'+''.join(records)+'</resources><publish name="Common"/></packageDescription>',encoding='utf-8')
        entries=''.join(f'<component id="t{i}" name="{file.name}" path="/" exported="true"/>' for i,file in enumerate(files))
        (ui/'package.xml').write_text('<packageDescription id="ijklmnop"><resources>'+entries+'</resources><publish name="UI"/></packageDescription>',encoding='utf-8')
        expected={}
        for file in files:
            (ui/file.name).write_text('<component size="10,10"><displayList/></component>',encoding='utf-8')
            args={'project':str(root),'pkg':'UI','name':file.name}
            adapted=invoke(node_cli,'adapt_generator_component',{'project':str(root),'pkg':'UI','xml':file.read_text(encoding='utf-8-sig')})
            if not adapted['references_valid']: raise RuntimeError(f'{file.name}: {adapted["reference_issues"]}')
            sha=invoke(node_cli,'read_component',args)['sha256']
            invoke(node_cli,'write_component',{**args,'xml':adapted['xml'],'expected_sha256':sha})
            expected[file.name]=[child['id'] for child in invoke(node_cli,'list_children',args)['children']]
        publication=compare_publication(root,editor)
        if publication['different'] or publication['failed'] or set(publication['matched'])!={'Common','UI'}: raise RuntimeError(f'editor publication mismatch: {publication}')
        plugin=root/'plugins'/'agent-bridge';plugin.mkdir(parents=True)
        for name in ('main.js','package.json'): shutil.copy2(repo/'plugin'/name,plugin/name)
        startup=None
        if os.name=='nt': startup=subprocess.STARTUPINFO();startup.dwFlags|=subprocess.STARTF_USESHOWWINDOW;startup.wShowWindow=0
        process=subprocess.Popen([str(editor),str(root/'p.fairy')],cwd=editor.parent,startupinfo=startup,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            deadline=time.monotonic()+75;first={'project':str(root),'pkg':'UI','name':files[0].stem}
            while True:
                if process.poll() is not None: raise RuntimeError('editor exited before bridge was ready')
                try: invoke(bridge_cli,'read-component',first,8);break
                except (RuntimeError,subprocess.SubprocessError,json.JSONDecodeError):
                    if time.monotonic()>deadline: raise RuntimeError('editor bridge did not become ready')
                    time.sleep(2)
            for file in files:
                args={'project':str(root),'pkg':'UI','name':file.stem}
                actual=[child.get('id') for child in invoke(bridge_cli,'list-children',args)['children']]
                if actual!=expected[file.name]: raise RuntimeError(f'{file.name}: editor child IDs {actual} != {expected[file.name]}')
                invoke(bridge_cli,'close-doc',args)
        finally:
            if process.poll() is None:
                process.terminate()
                try: process.wait(timeout=10)
                except subprocess.TimeoutExpired: process.kill();process.wait(timeout=10)
        return {'templates':[file.name for file in files],'editor_opened':len(files),'published_packages':publication['matched']}

if __name__=='__main__':
    print(json.dumps(run(Path(sys.argv[1]),Path(sys.argv[2])),ensure_ascii=False))
