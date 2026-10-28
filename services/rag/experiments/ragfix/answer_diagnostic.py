"""QAD-TC44/46: read-only inference diagnostic, never imported by serving."""
import asyncio
import hashlib
import json
import os
import sys
import time
from pathlib import Path

import httpx
from fastapi import HTTPException

from rag.answer_provider import document_model, document_limits, deepinfra_headers, deepinfra_payload, normalize_deepinfra, DEEPINFRA_MODELS, BENCHMARK_MODELS
from rag.batched_support import batched_document_answer
from rag.document_support import wire
from rag.request_timing import model_limits


def diagnostic_model():
    model = os.environ.get('RAG_BENCHMARK_MODEL')
    if model is not None:
        if model not in BENCHMARK_MODELS:
            raise ValueError('INVALID_BENCHMARK_MODEL')
        return model
    return document_model()


def diagnostic_limits():
    return {'context_tokens': 262144, 'model_request_bytes': 240000, 'byte_tokens': True} if diagnostic_model() in BENCHMARK_MODELS else document_limits()


async def run(data, ledger=None):
    trace = {'question': data['question'], 'role': data['role'], 'model': diagnostic_model(), 'calls': []}
    patch_file = os.environ.get('RAG_DIAGNOSTIC_SOURCE_PATCHES')
    if patch_file:
        proposal = json.loads(Path(patch_file).read_text(encoding='utf-8'))
        if proposal['status'] != 'UNPUBLISHED_REVIEW_DRAFT':
            raise ValueError('INVALID_SOURCE_DRAFT')
        count = 0
        for patch in proposal['patches']:
            for source in data['sources']:
                if source['chunk_id'] != patch['chunk_id']:
                    continue
                if source['version_id'] != patch['version_id'] or source['content'].count(patch['old']) != 1:
                    raise ValueError('STALE_SOURCE_DRAFT')
                source['content'] = source['content'].replace(patch['old'], patch['new'])
                source['content_hash'] = hashlib.sha256(source['content'].encode()).hexdigest()
                count += 1
        trace.update(source_state='UNPUBLISHED_RECONCILIATION', source_patch_count=count)
    started = time.perf_counter()
    token = model_limits.set(diagnostic_limits())
    packet_bytes = int(os.environ.get('RAG_DIAGNOSTIC_PACKET_BYTES', '0'))
    if packet_bytes:
        from rag import batched_support
        original_packets = batched_support.packets
        def bounded_packets(units, prompt, payload, schema):
            groups, group = [], []
            for unit in units:
                if group and len(wire(payload([*group, unit]))) > packet_bytes:
                    groups.extend(original_packets(group, prompt, payload, schema))
                    group = []
                group.append(unit)
            if group:
                groups.extend(original_packets(group, prompt, payload, schema))
            if len(groups) > 24:
                raise HTTPException(400, detail='CONTEXT_BUDGET_EXCEEDED')
            return groups
        batched_support.packets = bounded_packets
    async with httpx.AsyncClient(timeout=50, trust_env=False, follow_redirects=False) as client:
        async def generate(prompt, content, schema):
            model = os.environ.get('RAG_DIAGNOSTIC_REVIEW_MODEL', diagnostic_model()) if schema.__name__ == 'Review' else diagnostic_model()
            if model not in DEEPINFRA_MODELS | BENCHMARK_MODELS:
                raise HTTPException(503, detail='MODEL_REVISION_MISMATCH')
            payload = deepinfra_payload({'model': model, 'format': schema.model_json_schema(),
                'messages': [{'role': 'system', 'content': prompt}, {'role': 'user', 'content': wire(content).decode()}],
                'options': {'num_predict': 1200}}, schema.__name__)
            if os.environ.get('RAG_DIAGNOSTIC_INSTRUCTION_TAIL') == 'true':
                payload['messages'].append({'role': 'system', 'content': prompt})
            if os.environ.get('RAG_DIAGNOSTIC_BOUNDARY_TAIL') == 'true' and 'answer' not in content and 'candidate' not in content:
                payload['messages'].append({'role': 'system', 'content': '''Answer the question, not the first nearby source procedure. Keep every consequential action conditional in its OWN sentence. For example, every payment-collection sentence must state the documented unpaid/new-booking or outstanding-amount prerequisite; an earlier sentence mentioning new bookings does not qualify a later command. For a confirmed paid arrival do not demand payment again. When explaining check-in, preserve confirmed status and active-window eligibility from the original controls. When explaining submission/payment/allocation, retain the original no-hold and approved-candidate/manual-resolution controls. Cite their exact original units alongside the action. These are completeness checks, not permission to invent a missing rule. Prefer a short conditional overview to copying an unqualified checklist.'''})
            if model in BENCHMARK_MODELS:
                payload.pop('service_tier', None)
            serialized = wire(payload)
            if len(serialized) > diagnostic_limits()['model_request_bytes'] or len(serialized) + 1712 > diagnostic_limits()['context_tokens']:
                raise HTTPException(400, detail='CONTEXT_BUDGET_EXCEEDED')
            reservation = None
            if model in BENCHMARK_MODELS:
                if ledger is None:
                    raise ValueError('BENCHMARK_BUDGET_REQUIRED')
                reservation = ledger.reserve(model, len(serialized), 1200)
            call_start = time.perf_counter()
            response = await client.post('https://api.deepinfra.com/v1/openai/chat/completions', content=serialized,
                headers={**deepinfra_headers(), 'Content-Type': 'application/json'})
            response.raise_for_status()
            usage = response.json().get('usage', {})
            if reservation is not None:
                ledger.settle(reservation, usage)
            normalized = normalize_deepinfra(response.json(), model)
            try:
                value = schema.model_validate_json(normalized['message']['content'])
            except ValueError:
                directory = Path('.cache/answer-diagnostic')
                directory.mkdir(parents=True, exist_ok=True)
                (directory / 'last-invalid-output.json').write_bytes(wire({'model': model,
                    'schema': schema.__name__, 'output': normalized['message']['content']}))
                raise
            trace['calls'].append({'schema': schema.__name__, 'model': model, 'elapsed_ms': round((time.perf_counter()-call_start)*1000),
                'input_tokens': normalized.get('prompt_eval_count'), 'output_tokens': normalized.get('eval_count'),
                'request_bytes': len(serialized),
                'cached_input_tokens': (usage.get('prompt_tokens_details') or {}).get('cached_tokens', 0),
                'reasoning_tokens': (usage.get('completion_tokens_details') or {}).get('reasoning_tokens', 0),
                'result': value.model_dump()})
            return value
        try:
            operation = generate
            if os.environ.get('RAG_DIAGNOSTIC_CLAIM_REVIEW') == 'true':
                from .claim_review import reviewing
                operation = reviewing(generate)
            if os.environ.get('RAG_DIAGNOSTIC_INVARIANT_GUARD') == 'true':
                from .invariant_guard import guarding
                operation = guarding(generate)
            if os.environ.get('RAG_DIAGNOSTIC_TASK_FRAMING') == 'true':
                from .task_framed_draft import framing
                operation = framing(operation)
            if os.environ.get('RAG_DIAGNOSTIC_OPERATION') == 'catalog':
                from customer_public import interpret_customer_catalog, CustomerPlanInput
                groups = {}
                for source in data['sources']:
                    groups.setdefault(source['version_id'], []).append(source)
                introductions = [group[0] for group in groups.values()]
                headings = [list(dict.fromkeys(source['heading_path'] for source in group)) for group in groups.values()]
                trace['answer'] = await interpret_customer_catalog(CustomerPlanInput(message=data['question']), introductions, headings, operation)
            else:
                trace['answer'] = await batched_document_answer(data['question'], data['sources'], operation,
                    actor_role=data['role'], customer_reference=data['role'] == 'PUBLIC_VISITOR')
            trace['status'] = 'COMPLETE'
        except HTTPException as error:
            trace.update(status='FAILED', reason=error.detail)
        finally:
            model_limits.reset(token)
    trace['elapsed_ms'] = round((time.perf_counter()-started)*1000)
    directory = Path('.cache/answer-diagnostic')
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / (str(time.time_ns()) + '.json')
    path.write_bytes(wire({**trace, 'sources': data['sources']}))
    print(json.dumps({**trace, 'private_trace_path': str(path.resolve())}))
    return trace['status'] == 'COMPLETE' and trace['elapsed_ms'] < 10000


if __name__ == '__main__':
    ledger = None
    try:
        if os.environ.get('RAG_BENCHMARK_MODEL'):
            from rag.benchmark_budget import BenchmarkBudget
            ledger = BenchmarkBudget('.cache/answer-diagnostic')
        ok = asyncio.run(run(json.loads(sys.stdin.buffer.read().decode('utf-8')), ledger))
    except (ValueError, httpx.HTTPError, FileExistsError) as error:
        print(json.dumps({'status': 'FAILED', 'reason': 'DIAGNOSTIC_PROVIDER_FAILURE',
            'http_status': error.response.status_code if isinstance(error, httpx.HTTPStatusError) else None,
            'error_type': type(error).__name__}))
        ok = False
    finally:
        if ledger is not None:
            ledger.close()
    raise SystemExit(0 if ok else 1)
