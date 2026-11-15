"""Compare Node-published packages with an existing FairyGUI editor publication.

Compares parsed non-atlas resource records and hit masks; this is not a rendering test.
"""
import json, subprocess, sys, tempfile
from pathlib import Path
repo = Path(__file__).resolve().parent.parent
sys.path.insert(0,str(repo / 'standalone'))
from published import inspect
from test_full_reference import compare_packages


def run(project, reference):
    result={'matched':[], 'different':[], 'failed':[]}
    with tempfile.TemporaryDirectory(prefix='fgui-node-reference-') as temp:
        args={'project':str(project),'output':str(Path(temp)/'output'),'exported_only':True}
        process=subprocess.run(['node',str(repo/'standalone-node'/'fgui.mjs'),'publish_project_experimental',json.dumps(args)],capture_output=True,text=True,encoding='utf-8',timeout=240)
        if process.returncode: raise RuntimeError(process.stdout+'\n'+process.stderr)
        report=json.loads(process.stdout)['data']
        for item in report['packages']:
            try:
                actual=inspect((Path(temp)/'output'/item['file']).read_bytes())
                expected=inspect((Path(reference)/(item['package']+'.bin')).read_bytes())
                differences=compare_packages(actual,expected)
                if differences: result['different'].append({'package':item['package'],'differences':differences})
                else: result['matched'].append(item['package'])
            except Exception as exc: result['failed'].append({'package':item['package'],'error':str(exc)})
    return result

if __name__=='__main__':
    report=run(Path(sys.argv[1]),Path(sys.argv[2]))
    print(json.dumps(report,ensure_ascii=False))
    sys.exit(bool(report['different'] or report['failed']))
