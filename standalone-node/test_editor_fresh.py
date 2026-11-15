"""Compare all Node-published sample packages with a fresh editor publication.

Uses a temporary project copy and only terminates the editor process it starts.
Compares parsed metadata and visible image, frame, and font pixels, not graphical rendering.
"""
import json, os, shutil, subprocess, sys, tempfile, time
from pathlib import Path
from PIL import Image
from functools import lru_cache
repo=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(repo/'standalone'))
from published import inspect
from test_full_reference import compare_packages


def cli(script, command, args, timeout=30):
    process=subprocess.run(['node',str(script),command,json.dumps(args,ensure_ascii=False)],capture_output=True,text=True,encoding='utf-8',timeout=timeout)
    if process.returncode: raise RuntimeError(command+': '+process.stdout+' '+process.stderr)
    response=json.loads(process.stdout)
    if not response.get('ok'): raise RuntimeError(command+': '+process.stdout)
    return response['data']


@lru_cache(maxsize=4)
def read_atlas(file):
    with Image.open(file) as image: return image.convert('RGBA')


def sprite_pixels(info, package_file, sprite):
    atlases={item['id']:item for item in info['items'] if item['type']==4}
    atlas=atlases[sprite['atlas']]
    file=package_file.parent/(package_file.stem+'_'+atlas['file'])
    original=read_atlas(file)
    width=sprite['height'] if sprite['rotated'] else sprite['width']
    height=sprite['width'] if sprite['rotated'] else sprite['height']
    image=original.crop((sprite['x'],sprite['y'],sprite['x']+width,sprite['y']+height))
    if sprite['rotated']: image=image.transpose(Image.Transpose.ROTATE_90)
    full=Image.new('RGBA',(sprite.get('original_width',image.width),sprite.get('original_height',image.height)))
    full.paste(image,(sprite.get('offset_x',0),sprite.get('offset_y',0)))
    # Transparent RGB does not affect the rendered image.
    pixels=bytearray(full.tobytes())
    for index in range(0,len(pixels),4):
        if pixels[index+3]==0: pixels[index:index+3]=b'\0\0\0'
    return full.size,bytes(pixels)


def compare_atlas_pixels(actual,expected,actual_file,expected_file):
    ours={s['id']:s for s in actual['sprites']};theirs={s['id']:s for s in expected['sprites']}
    image_ids={item['id'] for item in expected['items'] if item['type']==0}
    for item in expected['items']:
        if item['type']==1:
            image_ids.update(frame['sprite'] for frame in item['movieclip']['frames'] if frame['sprite'])
        elif item['type']==5:
            font=item['font']
            if font['ttf']: image_ids.add(item['id'])
            image_ids.update(glyph['image'] for glyph in font['glyphs'] if glyph['image'])
    issues=[]
    for ident in sorted(image_ids):
        if ident not in ours or ident not in theirs:issues.append({'id':ident,'error':'sprite missing'});continue
        left=sprite_pixels(actual,actual_file,ours[ident]);right=sprite_pixels(expected,expected_file,theirs[ident])
        if left!=right:issues.append({'id':ident,'error':'renderable pixels differ','actual_size':left[0],'editor_size':right[0]})
    return issues


def run(project,editor):
    with tempfile.TemporaryDirectory(prefix='fgui-node-fresh-') as temp:
        temp=Path(temp);root=temp/'project';shutil.copytree(project,root)
        plugin=root/'plugins'/'agent-bridge';plugin.mkdir(parents=True,exist_ok=True)
        for name in ('main.js','package.json'):shutil.copy2(repo/'plugin'/name,plugin/name)
        publication=cli(repo/'standalone-node'/'fgui.mjs','publish_project_experimental',{'project':str(root),'output':str(temp/'node'),'exported_only':True},240)
        startup=None
        if os.name=='nt': startup=subprocess.STARTUPINFO();startup.dwFlags|=subprocess.STARTF_USESHOWWINDOW;startup.wShowWindow=0
        process=subprocess.Popen([str(editor),str(next(root.glob('*.fairy')))],cwd=editor.parent,startupinfo=startup,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        result={'matched':[],'different':[],'failed':[]}
        try:
            deadline=time.monotonic()+75
            while True:
                if process.poll() is not None:raise RuntimeError('editor exited before bridge was ready')
                try:cli(repo/'cli'/'fgui.mjs','list-packages',{'project':str(root)},8);break
                except (RuntimeError,subprocess.SubprocessError,json.JSONDecodeError):
                    if time.monotonic()>deadline:raise RuntimeError('editor bridge did not become ready')
                    time.sleep(2)
            selected=set(filter(None,os.environ.get('FGUI_EDITOR_PACKAGES','').split(',')))
            for record in publication['packages']:
                if selected and record['package'] not in selected:continue
                try:
                    target=temp/'editor'/record['package'];target.mkdir(parents=True)
                    response=cli(repo/'cli'/'fgui.mjs','publish',{'project':str(root),'pkg':record['package'],'out_path':str(target),'timeout_ms':60000},80)
                    if not response.get('isSuccess'):raise RuntimeError('editor publication reported failure')
                    actual_file=temp/'node'/record['file'];editor_file=target/Path(record['file']).name
                    validation=cli(repo/'standalone-node'/'fgui.mjs','validate_published',{'project':str(root),'file':str(editor_file),'compare_source':True,'compare_components':True,'exported_only':True},120)
                    if not validation['valid']:raise RuntimeError('Node validation rejected editor output: '+json.dumps(validation['issues'],ensure_ascii=False))
                    actual=inspect(actual_file.read_bytes());expected=inspect(editor_file.read_bytes())
                    differences=compare_packages(actual,expected)
                    differences.extend({'path':'atlas.'+d['id'],**d} for d in compare_atlas_pixels(actual,expected,actual_file,editor_file))
                    if differences:result['different'].append({'package':record['package'],'differences':differences})
                    else:result['matched'].append(record['package'])
                except Exception as exc:result['failed'].append({'package':record['package'],'error':str(exc)})
            return result
        finally:
            if process.poll() is None:
                process.terminate()
                try:process.wait(timeout=10)
                except subprocess.TimeoutExpired:process.kill();process.wait(timeout=10)

if __name__=='__main__':
    result=run(Path(sys.argv[1]),Path(sys.argv[2]));print(json.dumps(result,ensure_ascii=False));sys.exit(bool(result['different'] or result['failed']))
