"""MS-54: read-only authenticated reproduction and content-free baseline reports.

No publication, reprocessing, session creation or feature activation is performed.
Questions come only from the frozen synthetic dataset. Private chats are not saved.
"""
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
from time import perf_counter
from urllib.parse import urlsplit
from uuid import uuid4

import httpx
from gateway_benchmark import timings
from rag.identity import canonical_digest, freeze_identity, source_snapshot
from rag.reliability import evaluate, validate_dataset, validate_diagnostics, validate_record

ROOT = Path(__file__).resolve().parents[2]
EVALUATION = Path(__file__).resolve().parent / 'evaluation'


def dataset():
    data = json.loads((EVALUATION / 'ms54-dataset.json').read_text(encoding='utf-8'))
    lock = json.loads((EVALUATION / 'ms54-lock.json').read_text(encoding='utf-8'))
    return validate_dataset(data, lock), lock


def inventory():
    # Explicit metadata commands. Never enumerate environment values or process command lines.
    revision = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    processes = []
    hardware = {'cpu': platform.processor(), 'logical_cpus': os.cpu_count(), 'os': platform.system()}
    if platform.system() == 'Windows':
        command = "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -in 3000,3003,8000,11434 | Select-Object LocalPort,OwningProcess | ConvertTo-Json -Compress"
        result = subprocess.run(['powershell', '-NoProfile', '-Command', command], capture_output=True, text=True, timeout=15)
        if result.returncode == 0 and result.stdout.strip():
            processes = json.loads(result.stdout)
        result = subprocess.run(['powershell', '-NoProfile', '-Command',
            "Get-CimInstance Win32_ComputerSystem | Select-Object TotalPhysicalMemory | ConvertTo-Json -Compress"],
            capture_output=True, text=True, timeout=15)
        if result.returncode == 0 and result.stdout.strip():
            hardware['physical_memory_bytes'] = json.loads(result.stdout)['TotalPhysicalMemory']
    model = json.loads((ROOT / 'services/rag/answer-model.json').read_text(encoding='utf-8'))
    data, lock = dataset()
    sql = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT / 'supabase/migrations').glob('*.sql'))
           if not p.name.endswith('_down.sql') and int(p.name[:3]) >= 15}
    return {'candidate_revision': revision, 'source_snapshot': source_snapshot(ROOT), 'hardware': hardware,
            'listeners': processes, 'model_manifest_digest': model['manifest_digest'],
            'dataset_digest': lock['dataset_digest'], 'cases': len(data['cases']),
            'local_migration_hashes': sql, 'installed_rpc_definitions': 'PENDING_READ_ONLY_DATABASE_INSPECTION',
            'actual_model_and_embedding_identity': 'VERIFY_AUTHENTICATED_SERVICE_HEALTH',
            'effective_limits': 'CAPTURE_FROM_MATCHING_RUNNING_GATEWAY_AND_SERVICE',
            'local_limit_manifest': json.loads((ROOT / 'services/rag/rag/evidence-budget.json').read_text(encoding='utf-8')) if (ROOT / 'services/rag/rag/evidence-budget.json').exists() else None,
            'release_ready': False}


def save(path, value):
    # Content-free run records stay in the existing ignored artifact directory.
    path = path.resolve()
    if not path.is_relative_to(ROOT / 'services/rag/benchmark-results'):
        raise ValueError('IGNORED_OUTPUT_DIRECTORY_REQUIRED')
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8') as output:
        json.dump(value, output, ensure_ascii=False, allow_nan=False, indent=2)


def classify(status, data, case):
    if status in {408, 504}:
        return 'timeout'
    if status == 429:
        return 'capacity_rejection'
    if status == 403 and case['expected'] == 'refuse':
        return 'correct_refusal'
    if status != 200 or not isinstance(data, dict):
        return 'error'
    answer = data.get('data', {})
    if not isinstance(answer, dict):
        return 'error'
    # Provisional outcomes only. Human review gates acceptance independently.
    if answer.get('kind') == 'CLARIFY':
        return 'correct_clarification' if case['expected'] == 'clarify' else 'unnecessary_refusal'
    if answer.get('kind') == 'UNSUPPORTED' or not answer.get('citations') and not answer.get('tables'):
        return 'correct_refusal' if case['expected'] in {'refuse', 'conflict', 'escalate'} else 'unnecessary_refusal'
    return 'useful_answer'


async def probe(url, run, cases, token):
    origin = urlsplit(url)
    if (origin.scheme != 'http' or origin.hostname not in {'localhost', '127.0.0.1', '::1'}
            or origin.username or origin.password or origin.query or origin.fragment
            or origin.path != '/api/assistant/query'):
        raise ValueError('LOCAL_AUTHENTICATED_GATEWAY_REQUIRED')
    if not token or not token.startswith('Bearer '):
        raise ValueError('AUTHORIZED_BENCHMARK_SESSION_PENDING')
    headers = {'Authorization': token, 'Origin': f'{origin.scheme}://{origin.netloc}'}
    records = []
    async with httpx.AsyncClient(trust_env=False, follow_redirects=False, timeout=60) as client:
        response = await client.get(url, headers=headers)
        state = response.json().get('data', {}) if response.status_code == 200 else {}
        actor = state.get('identity', {})
        if state.get('enabled') is not True or actor.get('role') != run['role']:
            raise ValueError('ACTIVE_AUTHORIZED_ACTOR_REQUIRED')
        for case in cases:
            if case['role'] != run['role']:
                continue
            # Revocation/epoch/audience tests require controlled external state.
            # A synthetic question alone cannot attest that those states occurred.
            if case['scope'] in {'withdrawn', 'epoch', 'audience'}:
                continue
            start, stages, counts, diagnostic, queue = perf_counter(), {}, {}, None, None
            outcome = 'error'
            synthesis_status = 'NOT_ADMITTED'
            try:
                response = await client.post(url, headers=headers, json={
                    'session_id': str(uuid4()), 'request_id': str(uuid4()), 'message': case['question'],
                    'recent_context': {'user_turns': case['history']}})
                elapsed = (perf_counter() - start) * 1000
                synthesis_status = response.json().get('data', {}).get('synthesis_status', 'NOT_ADMITTED')
                diagnostic = json.loads(response.headers['x-rag-diagnostics']) if 'x-rag-diagnostics' in response.headers else None
                validate_diagnostics(diagnostic)
                stages = timings(response.headers.get('server-timing'))
                counts = json.loads(response.headers.get('x-rag-token-counts', '{}'))
                queue = float(response.headers['x-rag-queue-ms']) if 'x-rag-queue-ms' in response.headers else None
                outcome = classify(response.status_code, response.json(), case)
                if diagnostic and diagnostic['counts'].get('epoch') != run['publication_epoch']:
                    outcome = 'error'
                    diagnostic['failures'] = [*diagnostic['failures'][:11], {'stage': 'catalog', 'reason': 'KNOWLEDGE_CHANGED', 'category': 'knowledge_identity_change'}]
            except httpx.TimeoutException:
                elapsed, outcome = (perf_counter() - start) * 1000, 'timeout'
            except httpx.HTTPError:
                elapsed, outcome = (perf_counter() - start) * 1000, 'error'
            except (ValueError, TypeError, KeyError):
                elapsed, outcome = (perf_counter() - start) * 1000, 'error'
                diagnostic, stages, counts, queue = None, {}, {}, None
            record = {'attempt_id': canonical_digest(str(uuid4())), 'case_id': case['id'], 'identity': run['identity'],
                      'role': run['role'], 'outcome': outcome, 'duration_ms': elapsed, 'queue_ms': queue,
                      'stages': stages, 'tokens': counts, 'diagnostics': diagnostic, 'review': None,
                      'app_mode': run['app_mode'], 'measurement': 'gateway_complete', 'synthesis_status': synthesis_status}
            validate_record(record, run['identity'], {case['id']: case})
            records.append(record)
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['inventory', 'freeze', 'probe', 'report'])
    parser.add_argument('--run', type=Path)
    parser.add_argument('--bindings', type=Path)
    parser.add_argument('--settings', type=Path)
    parser.add_argument('--records', type=Path)
    parser.add_argument('--refusal-target', type=Path)
    parser.add_argument('--out', type=Path)
    parser.add_argument('--split', choices=['development', 'held_out'], default='development')
    parser.add_argument('--url', default='http://localhost:3000/api/assistant/query')
    parser.add_argument('--role', choices=['ADMIN', 'STAFF'], default='STAFF')
    parser.add_argument('--app-mode', choices=['development', 'production-build'], default='development')
    parser.add_argument('--publication-epoch', type=int)
    args = parser.parse_args()
    try:
        data, lock = dataset()
        if args.action == 'probe' and not os.environ.get('RAG_BENCHMARK_AUTHORIZATIONS'):
            raise ValueError('AUTHORIZED_BENCHMARK_SESSION_PENDING')
        if args.action == 'inventory':
            result = inventory()
        elif args.action == 'freeze':
            if args.publication_epoch is None or args.publication_epoch < 0:
                raise ValueError('PUBLICATION_EPOCH_REQUIRED')
            bindings = json.loads(args.bindings.read_text(encoding='utf-8'))
            settings = json.loads(args.settings.read_text(encoding='utf-8'))
            identity = freeze_identity(ROOT, bindings, data['cases'], settings)
            result = {'identity': identity, 'bindings': bindings, 'settings': settings,
                      'role': args.role, 'app_mode': args.app_mode, 'publication_epoch': args.publication_epoch}
            evaluate(data, lock, identity, bindings, [], args.split)
        else:
            run = json.loads(args.run.read_text(encoding='utf-8'))
            current = freeze_identity(ROOT, run['bindings'], data['cases'], run['settings'])
            if any(run['identity'][key] != value for key, value in current.items() if key != 'run_id'):
                raise ValueError('FROZEN_RUN_MISMATCH')
            if args.action == 'probe':
                tokens = json.loads(os.environ.get('RAG_BENCHMARK_AUTHORIZATIONS', '[]'))
                cases = [c for c in data['cases'] if c['split'] == args.split]
                records = asyncio.run(probe(args.url, run, cases, tokens[0] if tokens else None))
                if source_snapshot(ROOT) != run['identity']['source_snapshot']:
                    raise ValueError('CANDIDATE_CHANGED_DURING_RUN')
                result = {'identity': run['identity'], 'records': records}
            else:
                records = json.loads(args.records.read_text(encoding='utf-8'))['records']
                target = json.loads(args.refusal_target.read_text(encoding='utf-8')) if args.refusal_target else None
                result = evaluate(data, lock, run['identity'], run['bindings'], records, args.split, target)
        if args.out:
            save(args.out, result)
        print(json.dumps(result, allow_nan=False))
        return 0
    except (ValueError, KeyError, TypeError, AttributeError, OSError, subprocess.SubprocessError) as error:
        # Never print exception text, HTTP bodies, arbitrary headers or input files.
        safe_codes = {'AUTHORIZED_BENCHMARK_SESSION_PENDING', 'ACTIVE_AUTHORIZED_ACTOR_REQUIRED',
                      'FROZEN_RUN_MISMATCH', 'CANDIDATE_CHANGED_DURING_RUN', 'PUBLICATION_EPOCH_REQUIRED',
                      'LOCAL_AUTHENTICATED_GATEWAY_REQUIRED', 'IGNORED_OUTPUT_DIRECTORY_REQUIRED'}
        reason = str(error) if type(error) is ValueError and str(error) in safe_codes else 'MS54_BASELINE_NOT_COMPLETED'
        print(json.dumps({'status': 'PENDING', 'code': reason, 'release_ready': False,
                          'requires': ['frozen matching identity', 'authorized active session', 'current permitted corpus', 'independent review']}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
