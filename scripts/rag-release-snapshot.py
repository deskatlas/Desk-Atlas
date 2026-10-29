"""PRD-F26 / SDD-C20 / QAD-TC44/46: content-free release preservation check."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--compare', type=Path)
args = parser.parse_args()
cli = shutil.which('gcloud.cmd') or shutil.which('gcloud')
def read(*command):
    result = subprocess.run([cli, *command, '--project=deskatlas-rag', '--region=us-central1', '--format=json'],
                            check=True, capture_output=True, text=True)
    return json.loads(result.stdout)
service = read('run', 'services', 'describe', 'deskatlas-rag-chat-production')
policy = read('run', 'services', 'get-iam-policy', 'deskatlas-rag-chat-production')
if any(m in {'allUsers', 'allAuthenticatedUsers'} for b in policy.get('bindings', []) for m in b.get('members', [])):
    raise SystemExit('PRIVATE_IAM_REQUIRED')
spec = copy.deepcopy(service['spec']['template']['spec'])
container = spec['containers'][0]
image = container.pop('image')
mutable = {'RAG_TASK_FRAMED_DRAFT', 'RAG_QWEN_INDEXED_SOURCES'}
flags = {x['name']: x.get('value') for x in container.get('env', []) if x['name'] in mutable}
container['env'] = sorted([x for x in container.get('env', []) if x['name'] not in mutable], key=lambda x: x['name'])
annotations = {k: v for k, v in service['spec']['template']['metadata'].get('annotations', {}).items()
               if k not in {'run.googleapis.com/client-name', 'run.googleapis.com/client-version'}}
stable = {'spec': spec, 'annotations': annotations, 'iam_bindings': sorted(policy.get('bindings', []), key=lambda x: x['role'])}
digest = hashlib.sha256(json.dumps(stable, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
receipt = {'service': service['metadata']['name'], 'url': service['status']['url'],
           'latest_ready_revision': service['status']['latestReadyRevisionName'], 'traffic': service['status']['traffic'],
           'image': image, 'unchanged_configuration_sha256': digest, 'latency_flags': flags, 'private_iam': True}
if args.compare and json.loads(args.compare.read_text())['unchanged_configuration_sha256'] != digest:
    raise SystemExit('UNEXPECTED_RUNTIME_CONFIGURATION_CHANGE')
if args.compare and flags != {'RAG_TASK_FRAMED_DRAFT': 'false', 'RAG_QWEN_INDEXED_SOURCES': 'true'}:
    raise SystemExit('INVALID_LATENCY_PROFILE')
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt))
