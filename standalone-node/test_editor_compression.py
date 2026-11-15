"""Inspect fresh Unity-target binary compression without modifying source projects."""
import json,os,shutil,subprocess,sys,tempfile,time,xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image
from test_editor_roundtrip import repo,node_cli,bridge_cli,invoke

def run(source,editor,compressed=True):
 with tempfile.TemporaryDirectory(prefix='fgui-compression-probe-') as temp:
  temp=Path(temp);root=temp/'project';(root/'assets').mkdir(parents=True);descriptor=next(source.glob('*.fairy'));tree=ET.parse(descriptor);tree.getroot().set('type','Unity');tree.write(root/descriptor.name,encoding='utf-8',xml_declaration=True);shutil.copytree(source/'settings',root/'settings');settings=root/'settings'/'Publish.json';data=json.loads(settings.read_text(encoding='utf-8-sig'));data.update(binaryFormat=True,compressDesc=compressed);settings.write_text(json.dumps(data),encoding='utf-8')
  plugin=root/'plugins'/'agent-bridge';plugin.mkdir(parents=True)
  for name in ('main.js','package.json'):shutil.copy2(repo/'plugin'/name,plugin/name)
  invoke(node_cli,'create_package',{'project':str(root),'name':'Probe'});image=temp/'icon.png';Image.new('RGBA',(8,8),(100,40,200,255)).save(image);invoke(node_cli,'import_image',{'project':str(root),'pkg':'Probe','source':str(image),'exported':True})
  startup=None
  if os.name=='nt':startup=subprocess.STARTUPINFO();startup.dwFlags|=subprocess.STARTF_USESHOWWINDOW;startup.wShowWindow=0
  process=subprocess.Popen([str(editor),str(root/descriptor.name)],cwd=editor.parent,startupinfo=startup,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  try:
   deadline=time.monotonic()+75
   while True:
    if process.poll() is not None:raise RuntimeError('editor exited before bridge ready')
    try:invoke(bridge_cli,'list-items',{'project':str(root),'pkg':'Probe'},8);break
    except (RuntimeError,subprocess.SubprocessError,json.JSONDecodeError):
     if time.monotonic()>deadline:raise RuntimeError('editor bridge did not become ready')
     time.sleep(2)
   out=temp/'out';out.mkdir();result=invoke(bridge_cli,'publish',{'project':str(root),'pkg':'Probe','out_path':str(out),'timeout_ms':60000},80)
   if not result.get('isSuccess'):raise RuntimeError('editor publication failed')
   files=[p for p in out.iterdir() if p.suffix.lower() in ('.bin','.bytes','.fui')]
   if len(files)!=1:raise RuntimeError('unexpected package outputs '+str(files))
   raw=files[0].read_bytes();return {'filename':files[0].name,'size':len(raw),'header_hex':raw[:64].hex(),'requested_compression':compressed,'compressed_flag':raw[8] if len(raw)>8 else None}
  finally:
   if process.poll() is None:
    process.terminate()
    try:process.wait(timeout=10)
    except subprocess.TimeoutExpired:process.kill();process.wait(timeout=10)
if __name__=='__main__':print(json.dumps(run(Path(sys.argv[1]),Path(sys.argv[2]),'--uncompressed' not in sys.argv[3:])))
