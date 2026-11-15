"""Compare Node-created cross-package resources with a real editor publication."""
import json, os, shutil, subprocess, sys, tempfile, time
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image
from test_editor_roundtrip import invoke, repo, node_cli, bridge_cli
from test_editor_fresh import compare_atlas_pixels
from published import inspect
from test_full_reference import compare_packages

def run(source,editor):
 with tempfile.TemporaryDirectory(prefix='fgui-node-cross-') as tmp:
  temp=Path(tmp);root=temp/'project';(root/'assets').mkdir(parents=True);descriptor=next(source.glob('*.fairy'));shutil.copy2(descriptor,root/descriptor.name)
  if (source/'settings').is_dir():shutil.copytree(source/'settings',root/'settings')
  settings_file=root/'settings'/'Publish.json';settings=json.loads(settings_file.read_text(encoding='utf8'));settings['compressDesc']=True;settings_file.write_text(json.dumps(settings),encoding='utf8')
  plugin=root/'plugins'/'agent-bridge';plugin.mkdir(parents=True)
  for filename in ('main.js','package.json'):shutil.copy2(repo/'plugin'/filename,plugin/filename)
  for name in ('OfflineA','OfflineB'):invoke(node_cli,'create_package',{'project':str(root),'name':name})
  dropdown=invoke(node_cli,'create_component',{'project':str(root),'pkg':'OfflineB','name':'Dropdown','width':40,'height':40,'exported':True})
  combo=invoke(node_cli,'create_component',{'project':str(root),'pkg':'OfflineA','name':'SharedCombo','width':40,'height':20,'extention':'ComboBox','exported':True})
  invoke(node_cli,'set_combobox_options',{'project':str(root),'pkg':'OfflineA','name':'SharedCombo','expected_sha256':combo['sha256'],'props':{'dropdown':'ui://OfflineB/Dropdown'}})
  button=invoke(node_cli,'create_component',{'project':str(root),'pkg':'OfflineB','name':'SharedButton','width':20,'height':15,'extention':'Button','exported':True})
  progress=invoke(node_cli,'create_component',{'project':str(root),'pkg':'OfflineB','name':'SharedProgress','width':20,'height':15,'extention':'ProgressBar','exported':True})
  slider=invoke(node_cli,'create_component',{'project':str(root),'pkg':'OfflineB','name':'SharedSlider','width':20,'height':15,'extention':'Slider','exported':True})
  for resource,name,operation in [(progress,'SharedProgress','set_progress_options'),(slider,'SharedSlider','set_slider_options')]:invoke(node_cli,operation,{'project':str(root),'pkg':'OfflineB','name':name,'expected_sha256':resource['sha256'],'props':{'titleType':'value','reverse':True}})
  invoke(node_cli,'set_button_options',{'project':str(root),'pkg':'OfflineB','name':'SharedButton','props':{'mode':'Check','downEffect':'scale','downEffectValue':0.5},'expected_sha256':button['sha256']})
  image=temp/'icon.png';Image.new('RGBA',(7,5),(30,70,180,255)).save(image)
  imported=invoke(node_cli,'import_image',{'project':str(root),'pkg':'OfflineB','source':str(image),'name':'red,blue.png','exported':True})
  clip=invoke(node_cli,'import_movieclip',{'project':str(root),'pkg':'OfflineB','source':str(source/'assets'/'Guide'/'quan.jta'),'exported':True})
  before=invoke(node_cli,'read_package',{'project':str(root),'pkg':'OfflineB'})
  invoke(node_cli,'set_image_options',{'project':str(root),'pkg':'OfflineB','item':imported['id'],'expected_sha256':before['sha256'],'props':{'scale':'9grid','scale9grid':'1,1,3,2'}})
  base={'project':str(root),'pkg':'OfflineA','name':'Main'};created=invoke(node_cli,'create_component',{**base,'width':100,'height':100,'exported':True})
  inserted=invoke(node_cli,'insert_resource',{**base,'ref_pkg':'OfflineB','ref_name':button['id'],'object_name':'button','expected_sha256':created['sha256']})
  styled=invoke(node_cli,'set_button_instance_options',{**base,'target':'button','props':{'title':'Go','selectedTitle':'Selected','icon':'ui://OfflineB/red,blue','titleColor':'#123456','titleFontSize':18,'checked':True},'expected_sha256':inserted['sha256']})
  invoke(node_cli,'insert_resource',{**base,'ref_pkg':'OfflineB','ref_name':imported['id'],'object_name':'icon','x':12,'y':18,'expected_sha256':styled['sha256']})
  current=invoke(node_cli,'read_component',base);changed=invoke(node_cli,'set_properties',{**base,'target':'icon','props':{'color':'#123456','flip':'hz','fillMethod':'radial90','fillClockwise':False,'fillAmount':65},'expected_sha256':current['sha256']})
  invoke(node_cli,'insert_resource',{**base,'ref_pkg':'OfflineB','ref_name':clip['id'],'object_name':'animation','x':30,'y':35,'expected_sha256':changed['sha256']});current=invoke(node_cli,'read_component',base);invoke(node_cli,'set_properties',{**base,'target':'animation','props':{'color':'#654321','frame':2,'playing':False},'expected_sha256':current['sha256']})
  current=invoke(node_cli,'read_component',base);added=invoke(node_cli,'insert_object',{**base,'object_xml':'<loader id="loader" name="loader" xy="50,30"/>','expected_sha256':current['sha256']});invoke(node_cli,'set_properties',{**base,'target':'loader','props':{'url':'ui://OfflineB/red,blue','align':'center','vAlign':'middle','fill':'scale','color':'#123456','fillMethod':'radial90','fillClockwise':False,'fillAmount':65},'expected_sha256':added['sha256']})
  current=invoke(node_cli,'read_component',base);controller=invoke(node_cli,'create_controller',{**base,'controller':'icons','pages':[{'id':'p0','name':'One'},{'id':'p1','name':'Two'}],'expected_sha256':current['sha256']});invoke(node_cli,'set_icon_gear',{**base,'target':'loader','controller':'icons','pages':['p0','p1'],'values':['ui://OfflineB/red,blue',''],'default':'','expected_sha256':controller['sha256']})
  for resource,name,operation,props in [(progress,'progress','set_progress_instance_options',{'value':42,'min':10,'max':90}),(slider,'slider','set_slider_instance_options',{'value':30,'min':5,'max':75})]:
   current=invoke(node_cli,'read_component',base);added=invoke(node_cli,'insert_resource',{**base,'ref_pkg':'OfflineB','ref_name':resource['id'],'object_name':name,'expected_sha256':current['sha256']});invoke(node_cli,operation,{**base,'target':name,'props':props,'expected_sha256':added['sha256']})
  current=invoke(node_cli,'read_component',base);added=invoke(node_cli,'insert_resource',{**base,'ref_name':combo['id'],'object_name':'combo','expected_sha256':current['sha256']});invoke(node_cli,'set_combobox_instance_options',{**base,'target':'combo','expected_sha256':added['sha256'],'props':{'visibleItemCount':4,'items':[{'title':'One','value':'1','icon':'ui://OfflineB/red,blue'},{'title':'Two','value':'2'}]}})
  output=invoke(node_cli,'publish_project_experimental',{'project':str(root),'output':str(temp/'node')},120)
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
   objects=invoke(bridge_cli,'list-children',base)['children'];names=[item.get('name') for item in objects]
   if names!=['button','icon','animation','loader','progress','slider','combo']:raise RuntimeError(f'editor did not load cross-package objects: {names}')
   differences=[]
   for record in output['packages']:
    out=temp/'editor'/record['package'];out.mkdir(parents=True)
    published=invoke(bridge_cli,'publish',{'project':str(root),'pkg':record['package'],'out_path':str(out),'timeout_ms':60000},80)
    if not published.get('isSuccess'):raise RuntimeError('editor publication failed: '+record['package'])
    node_file=temp/'node'/record['file'];editor_file=out/node_file.name;node_bytes=node_file.read_bytes();editor_bytes=editor_file.read_bytes()
    if node_bytes[8]!=0 or editor_bytes[8]!=0:raise RuntimeError('unexpected compression flag for Cocos publication')
    validation=invoke(node_cli,'validate_published',{'project':str(root),'file':str(editor_file),'compare_components':True,'exported_only':True},120)
    if not validation['valid']:raise RuntimeError('editor component comparison failed: '+json.dumps(validation))
    actual=inspect(node_bytes);expected=inspect(editor_bytes)
    differences.extend([{'package':record['package'],**d} for d in compare_packages(actual,expected)+compare_atlas_pixels(actual,expected,node_file,editor_file)])
   if differences:raise RuntimeError(f'Node publication differs: {differences[:5]}')
   build=source.parent.parent/'source'/'build';runtime_checked=False
   if (build/'UIPackage.js').is_file():
    records={record['package']:record for record in output['packages']};reader=repo/'standalone'/'check_cocos_reader.cjs';observations=[]
    for kind in ('node','editor'):
     paths=[temp/'node'/records[name]['file'] if kind=='node' else temp/'editor'/name/Path(records[name]['file']).name for name in ('OfflineA','OfflineB')]
     run=subprocess.run(['node',str(reader),str(build),*[str(p) for p in paths]],capture_output=True,text=True,encoding='utf-8',timeout=60)
     if run.returncode:raise RuntimeError('Cocos reader failed: '+run.stderr)
     definitions_run=subprocess.run(['node',str(reader),str(build),str(paths[1]),str(paths[0])],capture_output=True,text=True,encoding='utf-8',timeout=60)
     if definitions_run.returncode:raise RuntimeError('Cocos definitions reader failed: '+definitions_run.stderr)
     definitions_data=json.loads(definitions_run.stdout)
     data=json.loads(run.stdout);component=next(c for c in data['constructed'] if any(child.get('name')=='animation' for child in c['children']));animation=next(child for child in component['children'] if child.get('name')=='animation');loader=next(child for child in component['children'] if child.get('name')=='loader');controls={name:{key:next(child for child in component['children'] if child.get('name')==name).get(key) for key in ('progressValue','progressMin','progressMax')} for name in ('progress','slider')};observations.append({'movieclip':{key:animation.get(key) for key in ('resolvedItemId','resolvedPackageId','movieFrame','moviePlaying')},'loader':{key:loader.get(key) for key in ('loaderUrl','loaderAlign','loaderVerticalAlign','loaderFill','fillMethod','fillClockwise','fillAmount','iconInitial','iconSecond')},'controls':controls,'comboInstance':{key:next(child for child in component['children'] if child.get('name')=='combo').get(key) for key in ('comboItems','comboValues','comboIcons','comboVisibleCount')},'comboDropdown':next(c for c in data['constructed'] if c['id']==combo['id']).get('comboDropdown'),'definitions':{name:{key:next(c for c in definitions_data['constructed'] if c['id']==resource['id']).get(key) for key in ('progressTitle','progressReverse')} for name,resource in [('progress',progress),('slider',slider)]}})
    movie=observations[0]['movieclip'];loader=observations[0]['loader']
    if observations[0]!=observations[1] or movie['resolvedItemId']!=clip['id'] or movie['movieFrame']!=2 or movie['moviePlaying'] is not False or loader['loaderUrl']!='ui://OfflineB/red,blue' or loader['iconInitial']!='ui://OfflineB/red,blue' or loader['iconSecond'] is not None or loader['fillMethod']!=3 or abs(loader['fillAmount']-0.65)>0.00001 or observations[0]['comboInstance']!={'comboItems':['One','Two'],'comboValues':['1','2'],'comboIcons':['ui://OfflineB/red,blue'],'comboVisibleCount':4} or observations[0]['comboDropdown']!='ui://OfflineB/Dropdown' or observations[0]['controls']!={'progress':{'progressValue':42,'progressMin':10,'progressMax':90},'slider':{'progressValue':30,'progressMin':5,'progressMax':75}} or observations[0]['definitions']!={'progress':{'progressTitle':2,'progressReverse':True},'slider':{'progressTitle':2,'progressReverse':True}}:raise RuntimeError('Cocos cross-package properties mismatch: '+json.dumps(observations))
    runtime_checked=True
   return {'editor_children':names,'compared_packages':len(output['packages']),'differences':len(differences),'cocos_cross_package_properties_checked':runtime_checked}
  finally:
   if process.poll() is None:
    process.terminate()
    try:process.wait(timeout=10)
    except subprocess.TimeoutExpired:process.kill();process.wait(timeout=10)
if __name__=='__main__':print(json.dumps(run(Path(sys.argv[1]),Path(sys.argv[2])),ensure_ascii=False))
