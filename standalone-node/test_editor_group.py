"""Check how the real editor handles nested group objects in a temporary project."""
import json, os, shutil, subprocess, sys, tempfile, time
from pathlib import Path
from test_editor_roundtrip import invoke, repo, node_cli, bridge_cli

def run(source,editor):
 with tempfile.TemporaryDirectory(prefix='fgui-group-editor-') as temp:
  root=Path(temp)/'project';shutil.copytree(source,root);plugin=root/'plugins'/'agent-bridge';plugin.mkdir(parents=True,exist_ok=True)
  for name in ('main.js','package.json'):shutil.copy2(repo/'plugin'/name,plugin/name)
  base={'project':str(root),'pkg':'Bag','name':'NestedGroupProbe'};created=invoke(node_cli,'create_component',{**base,'width':100,'height':100,'exported':True})
  Path(created['path']).write_text('<component size="100,100"><displayList><group id="g" name="group" xy="0,0" size="50,50" advanced="true"><text id="n" name="nested" xy="0,0" text="probe"/></group></displayList></component>',encoding='utf8')
  startup=None
  if os.name=='nt':startup=subprocess.STARTUPINFO();startup.dwFlags|=subprocess.STARTF_USESHOWWINDOW;startup.wShowWindow=0
  process=subprocess.Popen([str(editor),str(next(root.glob('*.fairy')))],cwd=editor.parent,startupinfo=startup,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  try:
   deadline=time.monotonic()+75
   while True:
    if process.poll() is not None:raise RuntimeError('editor exited before bridge was ready')
    try:invoke(bridge_cli,'read-component',base,8);break
    except (RuntimeError,subprocess.SubprocessError,json.JSONDecodeError):
     if time.monotonic()>deadline:raise RuntimeError('editor bridge did not become ready')
     time.sleep(2)
   children=invoke(bridge_cli,'list-children',base)['children'];names=[child.get('name') for child in children]
   if 'nested' in names:raise RuntimeError('nested child unexpectedly appeared in editor display list')
   return {'editor_children':names,'nested_child_loaded':False}
  finally:
   if process.poll() is None:
    process.terminate()
    try:process.wait(timeout=10)
    except subprocess.TimeoutExpired:process.kill();process.wait(timeout=10)
if __name__=='__main__':print(json.dumps(run(Path(sys.argv[1]),Path(sys.argv[2])),ensure_ascii=False))
