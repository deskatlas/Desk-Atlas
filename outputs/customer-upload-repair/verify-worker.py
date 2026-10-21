import importlib.util
import json
from pathlib import Path
import subprocess
import sys
root=Path(sys.argv[1])
sys.path.insert(0,'/opt/deskatlas/rag')
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec)
    sys.modules[name]=module
    spec.loader.exec_module(module)
    return module
support=load('rag.document_support',root/'rag/document_support.py')
preparation=load('repair_preparation',root/'knowledge/preparation.py')
from knowledge.chunk import chunk_sections
from rag.embedding_provider import ByteTokenizer
values=dict(line.split('=',1) for line in Path('/etc/deskatlas-worker.env').read_text().splitlines() if '=' in line)
for name in ['03_Kiosk_Checkin_and_Customer_Rewards.docx.md','06_Situational_Workspace_Recommendations_Handbook.docx.md']:
    path=Path('/tmp')/name
    path.chmod(0o444)
    result=subprocess.run(['docker','run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--memory','2g','--cpus','2','--tmpfs','/tmp:rw,noexec,nosuid,size=1073741824','--mount',f'type=bind,source={path},target=/input/source,readonly',values['KB_PARSER_IMAGE'],'--source','/input/source','--type','MD'],capture_output=True,check=True,timeout=120)
    extraction=json.loads(result.stdout)['data']
    chunks=chunk_sections(extraction['sections'],ByteTokenizer())
    assert preparation.verify_preparation(extraction,chunks)=='kb-auto-v1'
    assert preparation.verify_support_preparation(extraction,chunks)=='ms65-v1'
    units=support.canonical_units([{'chunk_id':str(c['ordinal']),'heading_path':c['heading_path'],'content':c['content'],'content_hash':c['content_sha256']} for c in chunks])
    print(json.dumps({'file':name[:2],'preparation':'passed','chunks':len(chunks),'units':len(units),'bundles':len(support.partition(units))}),flush=True)
