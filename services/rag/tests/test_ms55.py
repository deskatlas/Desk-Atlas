"""MS55-TC03/08: private service query contract, fallback and batch fences."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from test_assistant import api


def body(message='I need somewhere for an interview'):
    return api.PlanInput(message=message, recent_context=api.Context(user_turns=[]), business_date='2026-10-15', timezone='Asia/Manila', search_enabled=True)


@pytest.mark.parametrize('invalid', [None, {}, [], 'invalid', {'version': 'future'}, {'version': 'ms55-v1', 'original': 'changed', 'alternatives': []}])
def test_invalid_search_falls_back_without_replanning(monkeypatch, invalid):
    generate = AsyncMock(return_value=api.Plan(kind='DOCUMENT', query='invented task', tools=[], search=invalid))
    monkeypatch.setattr(api, 'generate', generate)
    result = asyncio.run(api.plan(body(), SimpleNamespace(ops=['answer'], role='STAFF')))
    assert result['query'] == body().message and 'search' not in result
    generate.assert_called_once()


def test_meaning_scope_followups_and_conditions_are_part_of_single_planner_contract(monkeypatch):
    search = {'version': 'ms55-v1', 'original': body().message, 'standalone': 'Documented workspace characteristics for interviews', 'alternatives': []}
    generate = AsyncMock(return_value=api.Plan(kind='DOCUMENT', query=body().message, tools=[], search=search))
    monkeypatch.setattr(api, 'generate', generate)
    result = asyncio.run(api.plan(body(), SimpleNamespace(ops=['answer'], role='STAFF')))
    assert result['search'] == search
    instructions = generate.call_args.args[0]
    # Prompt prose may be compacted; assert the externally supplied current
    # question and existing bounded search contract, not particular adjectives.
    assert generate.call_args.args[1]['message'] == body().message
    assert generate.call_args.args[2] is api.KnowledgePlan
    assert 'negation' in instructions
    with pytest.raises(ValueError):
        api.QueryUnderstanding.model_validate({**search, 'alternatives': ['one', 'two', 'three']})


def test_staff_report_is_forbidden_even_with_valid_search(monkeypatch):
    monkeypatch.setattr(api, 'generate', AsyncMock(return_value=api.Plan(kind='REPORT', query='', tools=[])))
    with pytest.raises(HTTPException) as error:
        asyncio.run(api.plan(body(), SimpleNamespace(ops=['answer'], role='STAFF')))
    assert error.value.status_code == 403


def test_batch_is_one_encoder_admission_and_rejects_bad_or_missing_vectors(monkeypatch):
    async def check():
        monkeypatch.setattr(api.app.state, 'encoder', object(), raising=False)
        monkeypatch.setattr(api.app.state, 'slots', asyncio.Semaphore(1), raising=False)
        encoded = AsyncMock(return_value=[[2.0] + [0.0] * 1023] * 2)
        monkeypatch.setattr(api, 'encoder_work', encoded)
        request = api.EmbedQueriesInput(queries=['Original', 'Original with interpretation'])
        result = await api.embed_queries(request, SimpleNamespace(ops=['search']))
        assert len(result['embeddings']) == 2 and result['embeddings'][0]['vector'][0] == 1
        encoded.assert_awaited_once_with(request.queries)
        for invalid in [[], [[0.0] * 1024] * 2, [[float('nan')] * 1024] * 2]:
            encoded.return_value = invalid
            with pytest.raises(HTTPException) as error:
                await api.embed_queries(request, SimpleNamespace(ops=['search']))
            assert error.value.detail == 'EMBEDDING_MISMATCH'
        with pytest.raises(HTTPException) as error:
            await api.embed_queries(request, SimpleNamespace(ops=['answer']))
        assert error.value.status_code == 403
        with pytest.raises(ValueError):
            api.EmbedQueriesInput(queries=['x'] * 5)
    asyncio.run(check())


def test_comparison_binds_actor_corpus_config_and_keeps_refusals_separate():
    from copy import deepcopy
    from uuid import uuid4
    from ms55_compare import compare, MODES
    from rag.identity import canonical_digest, FIELDS
    identity = {key: 'a' * 64 for key in FIELDS}
    identity.update(schema_version=1, candidate_revision='a' * 40, run_id=str(uuid4()))
    bundles = {}
    for mode in MODES:
        branch, query = mode.split('_')
        settings = {'RAG_HYBRID_RETRIEVAL': True, 'RAG_HYBRID_MODE': branch, 'RAG_HYBRID_QUERY_MODE': query}
        report = {'identity': {**identity, 'config_digest': canonical_digest(settings)}, 'dataset_digest': 'b' * 64,
                  'split': 'held_out', 'cases': [{'id': 'synthetic', 'type': 'faq', 'direct': 1, 'hits': int(branch == 'fused'), 'all_direct': branch == 'fused'}],
                  'groups': {'overall': {'count': 1, 'recall_at_6_micro': float(branch == 'fused')}}, 'attempts': 1, 'expected_attempts': 1,
                  'gateway_accepted_p95_ms': None, 'gateway_all_p95_ms': 10, 'outcomes': {'unnecessary_refusal': 1}, 'failure_breakdown': {}, 'pending': []}
        bundles[mode] = {'settings': settings, 'report': report}
    result = compare(bundles)
    assert not result['release_ready'] and result['recovered_complete_support_questions'] == 1
    assert result['modes']['semantic_original']['accepted_excerpt_p95_ms'] is None
    for change in ('corpus', 'config', 'content'):
        changed = deepcopy(bundles)
        target = changed['fused_expanded']
        if change == 'corpus':
            target['report']['identity']['corpus_digest'] = 'c' * 64
        elif change == 'config':
            target['settings']['RAG_MIN_SIMILARITY'] = 0
        else:
            target['report']['groups']['overall']['private_question'] = 'secret'
        with pytest.raises(ValueError):
            compare(changed)


def test_cancelled_batch_drains_native_encoder_before_releasing_work(monkeypatch):
    from threading import Event
    started, release = Event(), Event()
    queries = ['Original', 'Original plus interpretation']
    def encode(values, *, query):
        assert values == queries and query
        started.set()
        assert release.wait(5)
        return [[1.0] + [0.0] * 1023] * 2
    monkeypatch.setattr(api.app.state, 'encoder', SimpleNamespace(encode=encode), raising=False)
    async def check():
        task = asyncio.create_task(api.encoder_work(queries))
        try:
            assert await asyncio.to_thread(started.wait, 5)
            task.cancel()
            await asyncio.sleep(0)
            assert not task.done()
        finally:
            release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
    asyncio.run(check())
