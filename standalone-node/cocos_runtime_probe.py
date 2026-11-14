"""Run the real Cocos web-runtime probe using the Node standalone publisher."""
import argparse,json,subprocess,sys
from pathlib import Path
repo=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(repo/'standalone'))
import cocos_runtime_probe as probe

def node_execute(command,args):
    if command!='publish_project_experimental':raise ValueError('unexpected probe operation: '+command)
    run=subprocess.run(['node',str(repo/'standalone-node'/'fgui.mjs'),command,json.dumps(args)],capture_output=True,text=True,encoding='utf-8',timeout=300)
    if run.returncode:raise RuntimeError(run.stdout+'\n'+run.stderr)
    result=json.loads(run.stdout)
    if not result.get('ok'):raise RuntimeError(result.get('error','Node publication failed'))
    return result['data']

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--demo',type=Path,required=True);parser.add_argument('--distribution',type=Path,required=True);parser.add_argument('--creator',type=Path,required=True);parser.add_argument('--chrome',type=Path,required=True)
    parser.add_argument('--compare-reference',action='store_true');parser.add_argument('--compare-controller-states',action='store_true');parser.add_argument('--settle-ms',type=int,default=750)
    args=parser.parse_args();probe.execute=node_execute
    result=probe.run(args.demo,args.distribution,args.creator,args.chrome,compare_reference=args.compare_reference,compare_controller_states=args.compare_controller_states,settle_ms=args.settle_ms)
    print(json.dumps(result,ensure_ascii=False))
