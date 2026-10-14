"""MS44-TC11: authenticated local gateway, synthetic corpus, no payload output.

Expected quotes/IDs are fixture inputs only. No documents are uploaded/published.
Schema/evidence checks are mechanical; multilingual semantic review stays separate.
"""
import argparse
import asyncio
from collections import Counter
from datetime import datetime
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import re
import subprocess
from time import perf_counter
from urllib.parse import urlsplit
from uuid import UUID, uuid4
import httpx
from rag.evaluation import percentile


def timings(header):
    result = {}
    for part in (header or '').split(','):
        match = re.fullmatch(r'\s*([a-z_]+);dur=(\d+(?:\.\d+)?)\s*', part)
        if match:
            result[match[1]] = float(match[2])
    return result


def validate_cases(cases):
    if not isinstance(cases, list) or not cases:
        raise ValueError('SYNTHETIC_CASES_REQUIRED')
    for case in cases:
        if (case.get('synthetic') is not True or case.get('language') not in {'en', 'tl', 'taglish'}
                or not isinstance(case.get('question'), str) or not case['question'].strip()
                or not 1 <= len(case['question']) <= 2000
                or case.get('expected') not in {'answer', 'gap', 'conflict', 'forbidden'}):
            raise ValueError('INVALID_CASE')
        if case['expected'] == 'answer' and (not case.get('required_quotes') or not case.get('version_ids')):
            raise ValueError('EXPECTED_EVIDENCE_REQUIRED')
        if case['expected'] == 'answer':
            if (not isinstance(case['version_ids'], list) or len(case['version_ids']) > 6
                    or not isinstance(case['required_quotes'], list) or len(case['required_quotes']) > 6):
                raise ValueError('INVALID_EXPECTED_EVIDENCE')
            for version in case['version_ids']:
                UUID(version)
        if any(not isinstance(q, str) or not q.strip() for q in case.get('required_quotes', [])):
            raise ValueError('INVALID_EXPECTED_QUOTES')
    return cases


def document_contract(data):
    """Document-only subset of assistantAnswerSchema; reject unknown/prose fields."""
    required = {'kind', 'summary', 'tables', 'citations', 'interpretation', 'as_of', 'limitations', 'knowledge_epoch', 'request_id'}
    if not isinstance(data, dict) or set(data) != required or data['kind'] != 'DOCUMENT':
        return False
    if (not isinstance(data['summary'], str) or not data['summary'].strip() or len(data['summary']) > 20000
            or data['tables'] != [] or type(data['knowledge_epoch']) is not int or data['knowledge_epoch'] < 0):
        return False
    try:
        UUID(data['request_id'])
        if not data['as_of'].endswith('Z'):
            return False
        datetime.fromisoformat(data['as_of'].replace('Z', '+00:00'))
    except (ValueError, TypeError, AttributeError):
        return False
    for key, count, size in [('limitations', 30, 500), ('interpretation', 30, 1000)]:
        if (not isinstance(data[key], list) or len(data[key]) > count
                or any(not isinstance(line, str) or len(line) > size for line in data[key])):
            return False
    if not isinstance(data['citations'], list) or len(data['citations']) > 6:
        return False
    keys = {'document_id', 'version_id', 'chunk_id', 'title', 'heading_path', 'source_page', 'epoch', 'extraction_method', 'content_hash'}
    for citation in data['citations']:
        if not isinstance(citation, dict) or set(citation) != keys:
            return False
        try:
            for key in ('document_id', 'version_id', 'chunk_id'):
                UUID(citation[key])
        except (ValueError, TypeError, AttributeError):
            return False
        if (type(citation['epoch']) is not int or citation['epoch'] < 0
                or (citation['source_page'] is not None and (type(citation['source_page']) is not int or citation['source_page'] <= 0))
                or not isinstance(citation['content_hash'], str) or not re.fullmatch('[a-f0-9]{64}', citation['content_hash'])):
            return False
        if any(not isinstance(citation[key], str) or len(citation[key]) > size
               for key, size in [('title', 200), ('heading_path', 500), ('extraction_method', 50)]):
            return False
    return True


async def check_answer(client, url, headers, response, request_id, case):
    if case['expected'] == 'forbidden':
        return response.status_code == 403
    if response.status_code != 200:
        return False
    data = response.json().get('data', {})
    if not document_contract(data) or data['request_id'] != request_id:
        return False
    if case['expected'] in {'gap', 'conflict'}:
        marker = 'CONFLICTING_SOURCES:' if case['expected'] == 'conflict' else 'NO_RELEVANT_SOURCE:'
        return not data['citations'] and any(line.startswith(marker) for line in data['limitations'])
    if data.get('kind') != 'DOCUMENT' or data['limitations'] or data['tables'] or not data['citations']:
        return False
    if not set(case['version_ids']).issubset({s.get('version_id') for s in data['citations']}):
        return False
    summary = data['summary']
    if not all(quote in summary for quote in case['required_quotes']):
        return False
    # Independently read current authorized sources. These requests are outside
    # query latency and reported separately as harness evidence-check cost.
    contents = []
    base = url.rsplit('/query', 1)[0]
    for citation in data['citations']:
        version, chunk = citation.get('version_id', ''), citation.get('chunk_id', '')
        if not all(re.fullmatch(r'[a-fA-F0-9-]{36}', value) for value in (version, chunk)):
            return False
        source = await client.get(f'{base}/sources/{version}/{chunk}', headers=headers)
        if source.status_code != 200:
            return False
        current = source.json().get('data', {})
        if (current.get('content_hash') != citation.get('content_hash')
                or current.get('epoch') != data['knowledge_epoch']
                or current.get('version_id') != version or current.get('chunk_id') != chunk
                or not isinstance(current.get('content'), str)):
            return False
        if any(current.get(key) != value for key, value in citation.items()):
            return False
        contents.append(current['content'])
    # Summary is deterministically joined exact extracts. Check every paragraph
    # and every required restriction against current text, not HTTP status alone.
    return (all(any(part in text for text in contents) for part in summary.split('\n\n'))
            and all(any(q in text for text in contents) for q in case['required_quotes']))


def summarize(records):
    valid = [r['duration_ms'] for r in records if r['outcome'] == 'valid_answer']
    all_times = [r['duration_ms'] for r in records]
    stages = sorted({key for record in records for key in record['stages']})
    return {'attempts': len(records), 'outcomes': dict(Counter(r['outcome'] for r in records)),
            'completed': sum(r['http_status'] is not None for r in records),
            'all_p50_ms': percentile(all_times, .5), 'all_p95_ms': percentile(all_times, .95),
            'valid_answer_count': len(valid), 'valid_answer_p50_ms': percentile(valid, .5),
            'valid_answer_p95_ms': percentile(valid, .95),
            'timing_measurements_complete': bool(records) and all('total' in r['stages'] and
                (r['outcome'] != 'valid_answer' or all(stage in r['stages'] for stage in
                    ('plan', 'embed', 'retrieve', 'answer', 'auth', 'catalog', 'evidence', 'python_embed_queue', 'python_answer_queue')))
                for r in records),
            'stages': {key: {'samples': sum(key in r['stages'] for r in records),
                            'p50_ms': percentile([r['stages'][key] for r in records if key in r['stages']], .5),
                            'p95_ms': percentile([r['stages'][key] for r in records if key in r['stages']], .95)}
                       for key in stages}}


async def run(args, cases, tokens):
    origin = urlsplit(args.url)
    async with httpx.AsyncClient(follow_redirects=False, trust_env=False, timeout=60) as client:
        # Distinct tokens alone do not establish distinct active actors.
        actors = set()
        count = 5 if args.profile in {'five', 'ingestion'} else 1
        for token in tokens[:count]:
            verified = await client.get(args.url, headers={'Authorization': token})
            if verified.status_code != 200:
                raise ValueError('ACTIVE_TEST_SESSION_REQUIRED')
            state = verified.json().get('data', {})
            actor = state.get('identity', {})
            if state.get('enabled') is not True or actor.get('role') not in {'ADMIN', 'STAFF'}:
                raise ValueError('AVAILABLE_AUTHORIZED_GATEWAY_REQUIRED')
            actors.add(str(UUID(actor['id'])))
        if len(actors) != count:
            raise ValueError('DISTINCT_ACTIVE_TEST_ACTORS_REQUIRED')
        async def execute(case, actor):
            request_id = str(uuid4())
            headers = {'Authorization': tokens[actor], 'Origin': f'{origin.scheme}://{origin.netloc}'}
            start = perf_counter()
            status, stages, outcome, check_ms, token_counts = None, {}, 'transport_failure', 0, {}
            try:
                response = await client.post(args.url, headers=headers, json={
                    'session_id': str(uuid4()), 'request_id': request_id, 'message': case['question']})
                duration = (perf_counter() - start) * 1000
                status, stages = response.status_code, timings(response.headers.get('server-timing'))
                counts = json.loads(response.headers.get('x-rag-token-counts', '{}'))
                if isinstance(counts, dict):
                    token_counts = {key: value for key, value in counts.items() if re.fullmatch(r'(plan|answer)_(input|output)', key)
                                    and type(value) is int and 0 <= value <= 10_000_000}
                checking = perf_counter()
                correct = await check_answer(client, args.url, headers, response, request_id, case)
                check_ms = (perf_counter() - checking) * 1000
                outcome = ('valid_answer' if case['expected'] == 'answer' else 'valid_expected_outcome') if correct else {
                    429: 'capacity_rejection', 408: 'timeout_or_cancel', 504: 'timeout',
                    401: 'auth_failure', 403: 'forbidden', 503: 'unavailable'}.get(status, 'quality_or_schema_failure')
            except httpx.TimeoutException:
                if status is None:
                    duration = (perf_counter() - start) * 1000
                outcome = 'timeout' if status is None else 'evidence_check_failure'
            except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
                if status is None:
                    duration = (perf_counter() - start) * 1000
                else:
                    outcome = 'quality_or_schema_failure'
            return {'language': case['language'], 'duration_ms': duration, 'http_status': status,
                    'stages': stages, 'tokens': token_counts, 'outcome': outcome, 'evidence_check_ms': check_ms}

        if args.profile != 'cold':
            warm = await execute(cases[0], 0)
            if warm['outcome'] not in {'valid_answer', 'valid_expected_outcome'}:
                raise ValueError('AUTHENTICATED_GROUNDED_WARMUP_FAILED')
        records, batches = [], []
        if args.profile in {'five', 'ingestion'}:
            for batch in range(args.batches):
                rows = await asyncio.gather(*(execute(cases[(batch * 5 + i) % len(cases)], i) for i in range(5)))
                records.extend(rows)
                batches.append(summarize(rows))
        elif args.profile == 'representative':
            for language in ('en', 'tl', 'taglish'):
                group = [case for case in cases if case['language'] == language]
                if len(group) < 3:
                    raise ValueError('THREE_TOPICS_PER_LANGUAGE_REQUIRED')
                for i in range(args.samples):
                    records.append(await execute(group[i % len(group)], 0))
        else:
            if args.profile == 'repeat' and cases[0]['expected'] != 'answer':
                raise ValueError('ANSWERABLE_REPEAT_CASE_REQUIRED')
            for _ in range(1 if args.profile == 'cold' else args.samples):
                records.append(await execute(cases[0], 0))
        return {**summarize(records), 'batches': batches,
                'languages': {language: summarize([r for r in records if r['language'] == language])
                              for language in ('en', 'tl', 'taglish')}, 'records': records}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://localhost:3003/api/assistant/query')
    parser.add_argument('--cases', type=Path, required=True)
    parser.add_argument('--profile', choices=['repeat', 'representative', 'five', 'cold', 'ingestion'], required=True)
    parser.add_argument('--samples', type=int, default=30)
    parser.add_argument('--batches', type=int, default=20)
    parser.add_argument('--app-mode', choices=['development', 'production-build'], required=True)
    parser.add_argument('--reset-description', default='')
    args = parser.parse_args()
    url = urlsplit(args.url)
    if (url.scheme != 'http' or url.hostname not in {'localhost', '127.0.0.1', '::1'}
            or url.username or url.password or url.query or url.fragment
            or url.path != '/api/assistant/query' or args.samples < 30 or args.batches < 20):
        parser.error('Use local query route, >=30 samples and >=20 batches')
    try:
        if args.profile == 'cold' and not args.reset_description:
            raise ValueError('CONTROLLED_COLD_RESET_REQUIRED')
        cases = validate_cases(json.loads(args.cases.read_text(encoding='utf-8')))
        tokens = json.loads(os.environ.get('RAG_BENCHMARK_AUTHORIZATIONS', '[]'))
        count = 5 if args.profile in {'five', 'ingestion'} else 1
        if (not isinstance(tokens, list) or len(tokens) < count or len(set(tokens)) != len(tokens)
                or any(not isinstance(t, str) or not t.startswith('Bearer ') for t in tokens)):
            raise ValueError('ACTIVE_DISTINCT_TEST_SESSIONS_REQUIRED')
        result = asyncio.run(run(args, cases, tokens))
    except Exception:
        print(json.dumps({'status': 'BLOCKED', 'error_code': 'GATEWAY_BENCHMARK_NOT_COMPLETED',
                          'requirements': ['local gateway', 'active test sessions', 'permitted published synthetic corpus'],
                          'release_evidence': False}))
        return 1
    root = Path(__file__).resolve().parents[2]
    revision = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=root, capture_output=True, text=True).stdout.strip()
    dirty = subprocess.run(['git', 'status', '--porcelain'], cwd=root, capture_output=True, text=True).stdout
    print(json.dumps({'profile': args.profile, 'app_mode': args.app_mode,
                      'revision': revision, 'working_tree_dirty': bool(dirty),
                      'os': platform.system(), 'architecture': platform.machine(), 'cpu_count': os.cpu_count(),
                      'python': platform.python_version(), 'httpx': importlib.metadata.version('httpx'),
                      'cold_reset_documented': bool(args.reset_description),
                      'semantic_language_review': 'PENDING', 'release_evidence': False,
                      'browser_render_measurement': 'NOT_MEASURED', **result}, allow_nan=False))
    return 0 if result['timing_measurements_complete'] and all(key in {'valid_answer', 'valid_expected_outcome'} for key in result['outcomes']) else 1


if __name__ == '__main__':
    raise SystemExit(main())
