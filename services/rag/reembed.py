"""QAD-TC45: operator-only resumable shadow embeddings through maintenance RPC.

Never prints credentials, document text or vectors. No direct table writes.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
from uuid import UUID

import httpx

from rag.embedding_provider import FINGERPRINT, HostedEncoder

SAFE_CODES = {'PENDING_JOBS_OR_VERSIONS', 'ALREADY_ACTIVE', 'CATALOG_CHANGED',
              'CORPUS_CHANGED_OR_INCOMPLETE', 'INVALID_LIVE_CORPUS', 'INVALID_STATE',
              'INVALID_CHUNK', 'MAINTENANCE_RPC_REJECTED', 'RUN_NOT_PREPARING',
              'RUN_ID_REQUIRED', 'MAINTENANCE_CONFIRMATION_REQUIRED', 'HTTPS_REQUIRED'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['fingerprint', 'begin', 'prepare', 'commit', 'rollback'])
    parser.add_argument('--run')
    parser.add_argument('--scope', default='deskatlas')
    parser.add_argument('--maintenance-confirmed', action='store_true')
    parser.add_argument('--from-saved-config', action='store_true')
    args = parser.parse_args()
    if args.operation == 'fingerprint':
        print(FINGERPRINT)
        return
    if args.from_saved_config:
        root = Path(__file__).resolve().parents[2]
        code = "const fs=require('node:fs');const {parseEnv}=require('node:util');process.stdout.write(JSON.stringify(parseEnv(fs.readFileSync(process.argv[1],'utf8'))));"
        result = subprocess.run(['node', '-e', code, str(root / 'apps/admin-portal/.env.local')], capture_output=True, text=True, check=True)
        config = json.loads(result.stdout)
        os.environ['SUPABASE_URL'] = config.get('SUPABASE_URL') or config['NEXT_PUBLIC_SUPABASE_URL']
        os.environ['SUPABASE_SERVICE_ROLE_KEY'] = config['SUPABASE_SERVICE_ROLE_KEY']
        if args.operation == 'prepare':
            cli = shutil.which('gcloud.cmd') or shutil.which('gcloud')
            secret = subprocess.run([cli, 'secrets', 'versions', 'access', '1', '--secret=deepinfra-api-key',
                                     '--project=deskatlas-rag'], capture_output=True, text=True, check=True)
            os.environ['DEEPINFRA_API_KEY'] = secret.stdout.strip()
    if args.operation in ('commit', 'rollback') and not args.maintenance_confirmed:
        raise ValueError('MAINTENANCE_CONFIRMATION_REQUIRED')
    run = str(UUID(args.run)) if args.run else None
    if args.operation != 'begin' and run is None:
        raise ValueError('RUN_ID_REQUIRED')
    url = os.environ['SUPABASE_URL'].rstrip('/')
    if not url.startswith('https://'):
        raise ValueError('HTTPS_REQUIRED')
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    with httpx.Client(base_url=url, headers={'apikey': key, 'Authorization': 'Bearer ' + key},
                      timeout=60, follow_redirects=False, trust_env=False) as client:
        def rpc(operation, data=None):
            response = client.post('/rest/v1/rpc/kb_embedding_maintenance', json={
                'p_operation': operation, 'p_scope': args.scope, 'p_run': run, 'p_data': data or {}})
            if not response.is_success:
                try:
                    code = response.json().get('message')
                except (ValueError, AttributeError):
                    code = None
                if isinstance(code, str) and code in SAFE_CODES:
                    raise ValueError(code)
                raise ValueError('MAINTENANCE_RPC_REJECTED')
            return response.json()
        if args.operation == 'begin':
            result = rpc('begin', {'fingerprint': FINGERPRINT})
            print('Run ID: ' + result['run_id'])
        elif args.operation == 'prepare':
            encoder = HostedEncoder()
            batches = 0
            while True:
                result = rpc('read')
                if result['status'] != 'PREPARING':
                    raise ValueError('RUN_NOT_PREPARING')
                chunks = result['chunks']
                if not chunks:
                    break
                vectors = encoder.encode([chunk['content'] for chunk in chunks])
                rpc('stage', {'vectors': [{'chunk_id': chunk['chunk_id'], 'vector': vector}
                    for chunk, vector in zip(chunks, vectors, strict=True)]})
                batches += 1
                print('Staged batch: ' + str(batches), flush=True)
            print('SHADOW_EMBEDDINGS_PREPARED: live index unchanged')
        else:
            result = rpc(args.operation)
            print(json.dumps({'operation': args.operation, 'chunks': result['chunks'], 'changed': result['changed']}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        if type(error) is ValueError and str(error) in SAFE_CODES:
            print('Maintenance code: ' + str(error))
        print('REEMBED_FAILED: verify credentials, run ID, pending jobs, unchanged corpus and migration 029; no remote details displayed')
        raise SystemExit(1) from None
