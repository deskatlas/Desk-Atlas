"""MS61 v2: real pinned model, synthetic multilingual-input/English-output probe.

No service restart, runtime configuration update, live publication or production
transcript is involved. Retrieval and authenticated gateway/browser paths are
not exercised by this component probe and are not certified by its results.
"""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import sys
import time
from types import SimpleNamespace

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[1]
sys.path.insert(0, str(ROOT / 'services/rag'))
import httpx
import app as api
from ms61_localization import load_fixtures
from rag.identity import canonical_digest, source_snapshot


async def main():
    data = load_fixtures(ROOT / 'services/rag/evaluation/ms61-localization.json')
    cases = [case for case in data['cases'] if case['split'] == 'development']
    model = json.loads((ROOT / 'services/rag/answer-model.json').read_text(encoding='utf-8'))
    os.environ.update(RAG_ANSWER_MODEL=model['model'], RAG_ANSWER_DIGEST=model['manifest_digest'],
                      RAG_MODEL_GPU_LAYERS='-1', RAG_MODEL_KEEP_ALIVE='-1')
    before = source_snapshot(ROOT)
    results = []
    async with httpx.AsyncClient(base_url='http://127.0.0.1:11435', timeout=httpx.Timeout(8, connect=3),
                                 follow_redirects=False, trust_env=False) as client:
        api.app.state.client = client
        api.app.state.slots = asyncio.Semaphore(1)
        await api.verify_model(model['model'], model['manifest_digest'])
        for case in cases:
            started = time.perf_counter()
            result = {'case': case['id'], 'input_language': case['language'], 'output_language': 'en',
                      'plan_kind': None, 'main': None, 'verdict': None, 'status': 'UNAVAILABLE'}
            try:
                async with asyncio.timeout(20):
                    plan = await api.plan(api.PlanInput(message=case['question'],
                        recent_context=api.Context(user_turns=case['history']), business_date='2026-10-17',
                        timezone='Asia/Manila', search_enabled=True), SimpleNamespace(ops=['answer'], role='STAFF'))
                result['plan_kind'] = plan['kind']
                # The whole synthetic source is supplied, not retrieved.
                # Preserve the original multilingual question for projection/review.
                source = api.Source(document_id='synthetic', version_id='v1', chunk_id=case['id'],
                    title='Synthetic evaluation', heading_path='', source_page=None, epoch=1,
                    extraction_method='TEXT', content_hash=hashlib.sha256(case['source'].encode()).hexdigest(), content=case['source'])
                body = api.SynthesisInput(query=case['question'], language='en', presentation_contract='ms60-concise-v1',
                    coverage=api.Coverage(scope='FACTUAL', outcome='COMPLETE', gaps=[]), sources=[source],
                    spans=[api.SynthesisSpan(chunk_id=case['id'], quote=case['source'], start=0, end=api.wire_length(case['source']))])
                async with asyncio.timeout(8):
                    candidate = await api.synthesize(body, SimpleNamespace(ops=['answer']))
                    verdict = await api.verify_support(api.SupportInput(**body.model_dump(), candidate=candidate), SimpleNamespace(ops=['answer']))
                main = candidate['main_blocks']
                result.update(main=[block['text'] for block in main], verdict=verdict,
                              original_question_preserved=body.query == case['question'],
                              canonical_english_main=all(block['text'] in case['source'] for block in main),
                              proof_unchanged=candidate['blocks'][0]['text'] == case['source'], status='COMPONENT_COMPLETE')
            except TimeoutError:
                result['status'] = 'TIMEOUT'
            except api.HTTPException:
                result['status'] = 'MODEL_REJECTED'
            result['elapsed_ms'] = round((time.perf_counter() - started) * 1000)
            results.append(result)
            print(json.dumps({key: result[key] for key in ('case', 'status', 'plan_kind', 'elapsed_ms')}), flush=True)
    assert source_snapshot(ROOT) == before
    with (OUT / 'results.json').open('x', encoding='utf-8') as target:
        json.dump({'schema_version': 1, 'requirement': 'ms61-v2-English-output', 'model_digest': model['manifest_digest'],
            'source_snapshot': before, 'probe_digest': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'cases': results, 'retrieval_exercised': False, 'gateway_browser_exercised': False,
            'full_render_performance_measured': False, 'release_ready': False}, target, ensure_ascii=False, indent=2)


if __name__ == '__main__':
    asyncio.run(main())
