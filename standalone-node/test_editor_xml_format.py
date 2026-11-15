"""Inspect XML publication format emitted by the editor on a temporary project."""
import json,os,shutil,subprocess,sys,tempfile,time,zipfile,wave,xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image
from test_editor_roundtrip import invoke,repo,node_cli,bridge_cli

def run(source,editor,scale=None,image_only=False,sound=False,basic_children=False):
 with tempfile.TemporaryDirectory(prefix='fgui-xml-editor-') as temp:
  temp=Path(temp);root=temp/'project';(root/'assets').mkdir(parents=True);descriptor=next(source.glob('*.fairy'));shutil.copy2(descriptor,root/descriptor.name);shutil.copytree(source/'settings',root/'settings')
  setting=root/'settings'/'Publish.json';data=json.loads(setting.read_text(encoding='utf8'));data['binaryFormat']=False;data['compressDesc']=False;setting.write_text(json.dumps(data),encoding='utf8')
  plugin=root/'plugins'/'agent-bridge';plugin.mkdir(parents=True)
  for name in ('main.js','package.json'):shutil.copy2(repo/'plugin'/name,plugin/name)
  invoke(node_cli,'create_package',{'project':str(root),'name':'Probe'});src=temp/'icon.png';probe=Image.new('RGBA',(8,6),(0,0,0,0));probe.paste((20,80,200,255),(2,1,5,4));probe.save(src)
  imported=invoke(node_cli,'import_image',{'project':str(root),'pkg':'Probe','source':str(src)})
  if sound:
   wav=temp/'beep.wav'
   with wave.open(str(wav),'wb') as audio:audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(44100);audio.writeframes(bytes(882))
   invoke(node_cli,'import_sound',{'project':str(root),'pkg':'Probe','source':str(wav),'exported':True})
  if scale or image_only:
   if scale and scale not in ('tile','9grid'):raise ValueError('scale must be tile or 9grid')
   package=root/'assets'/'Probe'/'package.xml';document=ET.parse(package);image=next(i for i in document.getroot().find('resources') if i.get('id')==imported['id']);image.set('exported','true')
   if scale:image.set('scale',scale)
   if scale=='9grid':image.set('scale9grid','1,1,3,3')
   document.write(package,encoding='utf-8',xml_declaration=True)
  if image_only:invoke(node_cli,'create_package',{'project':str(root),'name':'Bridge'})
  base={'project':str(root),'pkg':'Bridge' if image_only else 'Probe','name':'Main'};component=invoke(node_cli,'create_component',{**base,'width':100,'height':50,'exported':True})
  if not image_only:invoke(node_cli,'insert_resource',{**base,'ref_name':imported['id'],'object_name':'icon','expected_sha256':component['sha256']})
  if basic_children:
   current=invoke(node_cli,'read_component',base)
   for xml in ['<text id="txt" name="label" xy="2,3" size="60,20" text="Hello XML" fontSize="14" color="#112233"/>','<graph id="shape" name="box" xy="5,6" size="20,10" type="rect" lineSize="1" lineColor="#ff000000" fillColor="#ffffffff"/>']:
    current=invoke(node_cli,'insert_object',{**base,'object_xml':xml,'expected_sha256':current['sha256']})
  startup=None
  if os.name=='nt':startup=subprocess.STARTUPINFO();startup.dwFlags|=subprocess.STARTF_USESHOWWINDOW;startup.wShowWindow=0
  process=subprocess.Popen([str(editor),str(root/descriptor.name)],cwd=editor.parent,startupinfo=startup,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  try:
   deadline=time.monotonic()+75
   while True:
    if process.poll() is not None:raise RuntimeError('editor exited before bridge was ready')
    try:invoke(bridge_cli,'read-component',base,8);break
    except (RuntimeError,subprocess.SubprocessError,json.JSONDecodeError):
     if time.monotonic()>deadline:raise RuntimeError('editor bridge did not become ready')
     time.sleep(2)
   output=temp/'out';output.mkdir();result=invoke(bridge_cli,'publish',{'project':str(root),'pkg':'Probe','out_path':str(output),'timeout_ms':60000},80)
   if not result.get('isSuccess'):raise RuntimeError('editor publication failed')
   inspected=invoke(node_cli,'inspect_published',{'project':str(root),'file':str(output/'Probe.bin')});report=invoke(node_cli,'validate_published',{'project':str(root),'file':str(output/'Probe.bin'),'compare_source':True,'exported_only':True,'check_overlaps':True})
   if inspected.get('format')!='xml' or not report.get('valid'):raise RuntimeError('Node XML inspection or validation failed: '+json.dumps(report))
   generated=invoke(node_cli,'publish_images_experimental' if image_only else 'publish_basic_experimental',{'project':str(root),'pkg':'Probe','output':str(temp/'node-out'),'exported_only':True,'trim_images':True})
   own=invoke(node_cli,'inspect_published',{'project':str(root),'file':generated['file']});own_report=invoke(node_cli,'validate_published',{'project':str(root),'file':generated['file'],'compare_source':True,'exported_only':True,'check_overlaps':True})
   fields=('id','name','file','width','height','exported','scale9Grid','scaleByTile');pick=lambda item:{key:item.get(key) for key in fields}
   actual=sorted((pick(i) for i in own['items'] if i['type'] in (0,2,3)),key=lambda item:item['id']);expected=sorted((pick(i) for i in inspected['items'] if i['type'] in (0,2,3)),key=lambda item:item['id'])
   if not own_report['valid'] or actual!=expected:raise RuntimeError('generated XML package metadata differs from editor: '+json.dumps({'report':own_report,'actual':actual,'expected':expected}))
   for item in inspected['items']:
    if item['type']==2 and (Path(generated['output'])/('Probe@'+item['file'])).read_bytes()!=(output/('Probe@'+item['file'])).read_bytes():raise RuntimeError('generated sound differs from editor')
   with zipfile.ZipFile(generated['file']) as own_archive,zipfile.ZipFile(output/'Probe.bin') as editor_archive:
    for item in inspected['items']:
     if item['type']==3:
      filename=item['id']+'.xml';actual=ET.canonicalize(own_archive.read(filename),strip_text=True);expected=ET.canonicalize(editor_archive.read(filename),strip_text=True)
      if actual!=expected:raise RuntimeError(f'generated XML component differs from editor: {filename}: {actual} != {expected}')
   files={f.name:{'size':f.stat().st_size,'head':f.read_bytes()[:256].hex()} for f in output.iterdir() if f.is_file()}
   with zipfile.ZipFile(output/'Probe.bin') as archive: entries={name:archive.read(name).decode('utf8') for name in archive.namelist()}
   source_component=invoke(node_cli,'read_component',base)['xml']
   return {'files':files,'entries':entries,'sprites':(output/'Probe@sprites.bytes').read_text(encoding='utf8'),'source_component':source_component,'node_validation':report}
  finally:
   if process.poll() is None:
    process.terminate()
    try:process.wait(timeout=10)
    except subprocess.TimeoutExpired:process.kill();process.wait(timeout=10)
if __name__=='__main__':print(json.dumps(run(Path(sys.argv[1]),Path(sys.argv[2]),sys.argv[3] if len(sys.argv)>3 and sys.argv[3]!='none' else None,'--image-only' in sys.argv[3:],'--sound' in sys.argv[3:],'--basic-children' in sys.argv[3:]),ensure_ascii=False))
