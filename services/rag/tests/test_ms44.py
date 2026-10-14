"""MS44-TC09/10/11/12: real request cancellation, evidence and honest metrics."""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import threading
from time import perf_counter
from unittest.mock import AsyncMock, patch
from types import SimpleNamespace

import pytest
import httpx
from fastapi import HTTPException
from rag.request_boundary import RequestBoundary
from rag import request_timing

ROOT = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


api = module('ms44_api', ROOT / 'app.py')
benchmark = module('ms44_benchmark', ROOT / 'gateway_benchmark.py')


@pytest.mark.parametrize('stage', ['queue', 'planning', 'embedding', 'retrieval', 'answer'])
def test_disconnect_drains_handler_and_next_request_can_run(stage):
    async def run():
        entered, stopped = asyncio.Event(), asyncio.Event()
        block = True

        async def handler(scope, receive, send):
            await receive()
            if block:
                entered.set()
                try:
                    await asyncio.Future()
                finally:
                    stopped.set()
            else:
                await send({'type': 'http.response.start', 'status': 200, 'headers': []})
                await send({'type': 'http.response.body', 'body': b'{}'})

        # Production ASGI boundary, with a handler blocked at each named stage.
        boundary = RequestBoundary(handler, maximum=1, deadline=1)
        inbound = asyncio.Queue()
        inbound.put_nowait({'type': 'http.request', 'body': b'{}'})
        async def send(_message):
            pass
        task = asyncio.create_task(boundary({'type': 'http'}, inbound.get, send))
        await asyncio.wait_for(entered.wait(), 1)
        assert boundary.active == 1, stage
        start = perf_counter()
        inbound.put_nowait({'type': 'http.disconnect'})
        await asyncio.wait_for(task, 1)
        assert stopped.is_set() and boundary.active == 0
        assert perf_counter() - start < 1
        block = False
        inbound.put_nowait({'type': 'http.request', 'body': b'{}'})
        await asyncio.wait_for(boundary({'type': 'http'}, inbound.get, send), 1)
        assert boundary.active == 0
    asyncio.run(run())


def test_deadline_cancels_real_model_await_and_emits_numeric_timings():
    async def run():
        stopped = asyncio.Event()
        api.app.state.slots = asyncio.Semaphore(1)
        async def inference(*_args):
            try:
                await asyncio.Future()
            finally:
                stopped.set()
        async def handler(scope, receive, send):
            await receive()
            await api.generate('system', {}, api.Answer)
        queue = asyncio.Queue()
        queue.put_nowait({'type': 'http.request', 'body': b'{}'})
        messages = []
        async def send(message):
            messages.append(message)
        boundary = RequestBoundary(handler, maximum=1, deadline=.05)
        with patch.object(api, 'model_request', new=inference), patch.object(api, 'verify_model', new=AsyncMock()):
            await boundary({'type': 'http'}, queue.get, send)
        assert stopped.is_set() and boundary.active == 0 and api.app.state.slots._value == 1
        assert messages[0]['status'] == 504
        headers = dict(messages[0]['headers'])
        assert b'inference;dur=' in headers[b'server-timing']
        assert headers[b'cache-control'] == b'no-store'
    with patch.dict(os.environ, {'RAG_ANSWER_DIGEST': 'a' * 64}):
        asyncio.run(run())


def test_cancelled_native_embedding_keeps_slot_until_work_finishes():
    async def run():
        entered, release = threading.Event(), threading.Event()
        def encode(*_args, **_kwargs):
            entered.set()
            release.wait(timeout=2)
            return [[1.0] + [0.0] * 1023]
        api.app.state.slots = asyncio.Semaphore(1)
        api.app.state.encoder = SimpleNamespace(encode=encode)
        claims = SimpleNamespace(ops=['search'])
        task = asyncio.create_task(api.embed(api.EmbedInput(query='synthetic'), claims))
        try:
            for _ in range(100):
                if entered.is_set():
                    break
                await asyncio.sleep(.002)
            assert entered.is_set()
            task.cancel()
            await asyncio.sleep(.01)
            assert not task.done() and api.app.state.slots._value == 0
        finally:
            release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert api.app.state.slots._value == 1
        vector = await api.embed(api.EmbedInput(query='next'), claims)
        assert vector['vector'][0] == 1
    asyncio.run(run())


def test_queued_generation_cancellation_never_reaches_model_and_releases_waiter():
    async def run():
        api.app.state.slots = asyncio.Semaphore(1)
        await api.app.state.slots.acquire()
        inference = AsyncMock(return_value={'message': {'content': '{"quotes":[]}'}})
        with patch.object(api, 'model_request', new=inference), patch.object(api, 'verify_model', new=AsyncMock()):
            task = asyncio.create_task(api.generate('system', {}, api.Answer))
            await asyncio.sleep(.01)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            inference.assert_not_called()
            api.app.state.slots.release()
            assert (await api.generate('system', {}, api.Answer)).quotes == []
    with patch.dict(os.environ, {'RAG_ANSWER_DIGEST': 'a' * 64}):
        asyncio.run(run())


@pytest.mark.parametrize('content,reason', [('bad-json', 'stop'), ('{"quotes":[]}', 'length'), ('{"quotes":[],"private":"injected"}', 'stop')])
def test_malformed_or_truncated_model_output_fails_closed(content, reason):
    async def run():
        api.app.state.slots = asyncio.Semaphore(1)
        with patch.object(api, 'verify_model', new=AsyncMock()), patch.object(api, 'model_request', new=AsyncMock(return_value={
                'message': {'content': content}, 'done_reason': reason})):
            with pytest.raises(HTTPException) as error:
                await api.generate('system', {}, api.Answer)
            assert error.value.detail == 'INVALID_MODEL_OUTPUT'
    with patch.dict(os.environ, {'RAG_ANSWER_DIGEST': 'a' * 64}):
        asyncio.run(run())


def test_token_budgets_are_independent_and_timing_drops_payloads():
    async def run():
        api.app.state.slots = asyncio.Semaphore(1)
        spans = {}
        token = request_timing.current.set(spans)
        inference = AsyncMock(return_value={'message': {'content': '{"quotes":[]}'}, 'load_duration': 3000000,
                                           'prompt_eval_duration': 2000000, 'eval_duration': 1000000})
        try:
            with patch.object(api, 'verify_model', new=AsyncMock()), patch.object(api, 'model_request', new=inference):
                await api.generate('system', {'query': 'private synthetic'}, api.Answer)
                assert inference.call_args.args[1]['options']['num_predict'] == 512
                inference.return_value = {'message': {'content': '{"kind":"DOCUMENT","query":"sop","tools":[]}'}}
                await api.generate('system', {}, api.Plan)
                assert inference.call_args.args[1]['options']['num_predict'] == 256
                request_timing.add('query', 1)
                request_timing.add('queue', float('nan'))
                header = request_timing.header(spans, perf_counter())
                assert 'private' not in header and 'query' not in header and 'NaN' not in header
                assert 'load;dur=3.000' in header and 'prompt;dur=2.000' in header
        finally:
            request_timing.current.reset(token)
    with patch.dict(os.environ, {'RAG_ANSWER_DIGEST': 'a' * 64, 'RAG_PLAN_MAX_TOKENS': '256', 'RAG_ANSWER_MAX_TOKENS': '512'}):
        asyncio.run(run())


def test_percentiles_do_not_count_fast_failure_as_valid_answer():
    records = [{'duration_ms': 1, 'outcome': 'quality_or_schema_failure', 'http_status': 200, 'stages': {}},
               {'duration_ms': 12000, 'outcome': 'valid_answer', 'http_status': 200, 'stages': {'total': 11900}}]
    result = benchmark.summarize(records)
    assert result['attempts'] == 2 and result['valid_answer_count'] == 1
    assert result['all_p50_ms'] == 1 and result['valid_answer_p50_ms'] == 12000
    assert result['stages']['total']['samples'] == 1
    with pytest.raises(ValueError):
        benchmark.validate_cases([{'synthetic': True, 'language': 'en', 'question': 'How?', 'expected': 'answer'}])


def test_gateway_benchmark_requires_current_exact_evidence_and_complete_restrictions():
    request_id = '123e4567-e89b-42d3-a456-426614174000'
    citation = {'document_id': request_id, 'version_id': request_id, 'chunk_id': request_id,
                'title': 'Synthetic', 'heading_path': 'Procedure', 'source_page': None, 'epoch': 1,
                'extraction_method': 'TEXT', 'content_hash': 'a' * 64}
    content = 'Verify the QR first. Staff must not approve online payment proofs.'
    answer = {'kind': 'DOCUMENT', 'summary': content, 'citations': [citation], 'limitations': [],
              'interpretation': [], 'tables': [], 'as_of': '2026-10-14T00:00:00Z',
              'knowledge_epoch': 1, 'request_id': request_id}
    case = {'expected': 'answer', 'required_quotes': [content], 'version_ids': [request_id]}
    async def run():
        client = SimpleNamespace(get=AsyncMock(return_value=httpx.Response(200, json={'data': {**citation, 'content': content}})))
        assert await benchmark.check_answer(client, 'http://localhost:3003/api/assistant/query', {},
            httpx.Response(200, json={'data': answer}), request_id, case)
        assert not await benchmark.check_answer(client, 'http://localhost:3003/api/assistant/query', {},
            httpx.Response(200, json={'data': {**answer, 'summary': 'Verify the QR first.'}}), request_id, case)
        client.get.return_value = httpx.Response(404)
        assert not await benchmark.check_answer(client, 'http://localhost:3003/api/assistant/query', {},
            httpx.Response(200, json={'data': answer}), request_id, case)
        assert not benchmark.document_contract({**answer, 'invented': 'policy'})
        assert not benchmark.document_contract({**answer, 'citations': [{**citation, 'epoch': -1}]})
    asyncio.run(run())


def test_compact_selection_expands_only_valid_passage_ids_without_regenerating_quotes():
    async def run():
        source = api.Source(document_id='doc', version_id='version', chunk_id='chunk', title='Synthetic',
            heading_path='FAQ', source_page=None, epoch=1, extraction_method='TEXT', content_hash='a'*64,
            content='Who reviews the SOP?\n\nManagement reviews the SOP. Staff must not approve revisions.')
        result = api.PassageSelection(passages=[1], conflicting_sources=False)
        with patch.object(api, 'generate', new=AsyncMock(side_effect=[result, api.EvidenceCheck(supported=True)])) as generate:
            answer = await api.answer(api.AnswerInput(query='Who reviews the SOP?', sources=[source]), SimpleNamespace(ops=['answer']))
        assert answer == {'quotes': [{'chunk_id': 'chunk', 'quote': 'Management reviews the SOP. Staff must not approve revisions.'}], 'conflicting_sources': False}
        assert generate.call_args_list[0].args[2] is api.PassageSelection
        assert 'chunk_id' not in json.dumps(generate.call_args_list[0].args[1])
        assert source.content.split('\n\n')[1] in json.dumps(generate.call_args_list[0].args[1])
        for selection in [api.PassageSelection(passages=[99], conflicting_sources=False),
                          api.PassageSelection(passages=[], conflicting_sources=False)]:
            with patch.object(api, 'generate', new=AsyncMock(return_value=selection)):
                assert (await api.answer(api.AnswerInput(query='Who?', sources=[source]), SimpleNamespace(ops=['answer'])))['quotes'] == []
        with patch.object(api, 'generate', new=AsyncMock(return_value=api.PassageSelection(passages=[1], conflicting_sources=True))):
            assert await api.answer(api.AnswerInput(query='Who?', sources=[source]), SimpleNamespace(ops=['answer'])) == {'quotes': [], 'conflicting_sources': True}
    asyncio.run(run())


def test_lossless_compact_context_retains_contradictions_and_deduplicates_exact_text():
    async def run():
        base = dict(document_id='doc', version_id='version', title='Synthetic', source_page=None, epoch=1,
                    extraction_method='TEXT', content_hash='a'*64, heading_path='FAQ / Review')
        sources = [api.Source(**base, chunk_id='one', content='FAQ / Review\n\nManagement must review the SOP.'),
                   api.Source(**base, chunk_id='two', content='FAQ / Review\n\nManagement must review the SOP.\n\nOnly staff, never management, may review the SOP.')]
        with patch.object(api, 'generate', new=AsyncMock(return_value=api.PassageSelection(p=[], c=True))) as generate:
            result = await api.answer(api.AnswerInput(query='Who reviews the SOP?', sources=sources), SimpleNamespace(ops=['answer']))
        data = generate.call_args.args[1]
        assert data['passages'] == ['Management must review the SOP.', 'Only staff, never management, may review the SOP.']
        assert data['sources'][0]['p'] == [0] and data['sources'][1]['p'] == [0, 1]
        assert set(data['headings']) == {'Synthetic', 'FAQ', 'Review'}
        assert result == {'quotes': [], 'conflicting_sources': True}
        # Compact and original external schemas remain distinct.
        assert api.PassageSelection.model_validate_json('{"p":[0],"c":false}').passages == [0]
        with pytest.raises(ValueError):
            api.PassageSelection.model_validate_json('{"p":[0],"quote":"invented"}')
    asyncio.run(run())


def test_oversized_paragraph_keeps_original_evidence_selection_contract():
    async def run():
        source = api.Source(document_id='doc', version_id='version', chunk_id='chunk', title='Synthetic',
            heading_path='Policy', source_page=None, epoch=1, extraction_method='TEXT', content_hash='a'*64,
            content='Only admins may approve. ' * 100)
        selected = api.Answer(quotes=[api.Quote(chunk_id='chunk', quote='Only admins may approve.')])
        with patch.object(api, 'generate', new=AsyncMock(return_value=selected)) as generate:
            answer = await api.answer(api.AnswerInput(query='Who may approve?', sources=[source]), SimpleNamespace(ops=['answer']))
        assert generate.call_args.args[2] is api.Answer
        assert generate.call_args.args[1]['sources'][0]['content'] == source.content
        assert answer['quotes'][0]['quote'] == 'Only admins may approve.'
    asyncio.run(run())


@pytest.mark.parametrize('layers', ['-1', '0', '256'])
def test_cpu_gpu_controls_keep_the_pinned_model_and_output_contract(layers):
    async def run():
        api.app.state.slots = asyncio.Semaphore(1)
        inference = AsyncMock(return_value={'message': {'content': '{"p":[0],"c":false}'}})
        with patch.object(api, 'verify_model', new=AsyncMock()), patch.object(api, 'model_request', new=inference):
            selected = await api.generate('Select evidence', {}, api.PassageSelection)
        payload = inference.call_args.args[1]
        assert selected.passages == [0]
        assert payload['options']['num_gpu'] == int(layers)
        assert payload['options']['num_predict'] == 128 and payload['keep_alive'] == -1
        assert payload['model'] == 'qwen3:4b'
    with patch.dict(os.environ, {'RAG_ANSWER_DIGEST': 'a'*64, 'RAG_ANSWER_MODEL': 'qwen3:4b',
                                'RAG_MODEL_GPU_LAYERS': layers, 'RAG_MODEL_KEEP_ALIVE': '-1'}):
        asyncio.run(run())


@pytest.mark.parametrize('text,conflict', [
    ('Only administrators may approve online payment proofs. Staff may approve online payment proofs.', True),
    ('Staff can approve online payment proofs. Staff must not approve online payment proofs.', True),
    ('Only administrators may approve online payment proofs. Staff must not approve online payment proofs.', False),
    ('Management should review the SOP. Employees must follow the SOP.', False),
    ('Only administrators may approve online payment proofs. Staff may approve counter payments.', False),
])
def test_explicit_permission_contradictions_fail_closed(text, conflict):
    source = api.Source(document_id='doc', version_id='v', chunk_id='chunk', title='Synthetic', heading_path='Rules',
        source_page=None, epoch=1, extraction_method='TEXT', content_hash='a'*64, content=text)
    assert api.explicit_permission_conflict([source]) is conflict


def test_independent_support_verdict_blocks_irrelevant_but_exact_selected_quote():
    async def run():
        source = api.Source(document_id='doc', version_id='v', chunk_id='chunk', title='Synthetic', heading_path='Rules',
            source_page=None, epoch=1, extraction_method='TEXT', content_hash='a'*64, content='Management reviews the SOP.')
        with patch.object(api, 'generate', new=AsyncMock(side_effect=[
                api.PassageSelection(p=[0], c=False), api.EvidenceCheck(supported=False)])) as generate:
            result = await api.answer(api.AnswerInput(query='What is the refund amount?', sources=[source]), SimpleNamespace(ops=['answer']))
        assert result == {'quotes': []}
        assert generate.call_args.args[2] is api.EvidenceCheck
    asyncio.run(run())


def test_five_user_harness_uses_synchronized_batches_and_checks_verified_actors():
    async def run():
        class Client:
            def __init__(self, *_args, **_kwargs):
                self.calls = 0
                self.arrived = 0
                self.barrier = asyncio.Event()
            async def __aenter__(self):
                return self
            async def __aexit__(self, *_args):
                pass
            async def get(self, _url, headers):
                actor = int(headers['Authorization'].split()[-1])
                return httpx.Response(200, json={'data': {'enabled': True, 'identity': {
                    'id': f'123e4567-e89b-42d3-a456-{actor:012d}', 'role': 'STAFF'}}})
            async def post(self, _url, headers, json):
                self.calls += 1
                if self.calls != 1:  # The first explicit warm-up is excluded.
                    barrier = self.barrier
                    self.arrived += 1
                    if self.arrived == 5:
                        self.arrived = 0
                        self.barrier = asyncio.Event()
                        barrier.set()
                    await asyncio.wait_for(barrier.wait(), 1)
                return httpx.Response(200, headers={'server-timing': 'total;dur=3'}, json={'data': {
                    'kind': 'DOCUMENT', 'summary': 'No verified answer is available.', 'tables': [], 'citations': [],
                    'limitations': ['NO_RELEVANT_SOURCE: synthetic gap'], 'interpretation': [],
                    'as_of': '2026-10-14T00:00:00Z', 'knowledge_epoch': 1, 'request_id': json['request_id']}})
        args = SimpleNamespace(url='http://localhost:3003/api/assistant/query', profile='five', batches=20)
        cases = [{'question': 'synthetic gap', 'expected': 'gap', 'language': 'en'}]
        with patch.object(benchmark.httpx, 'AsyncClient', Client):
            result = await benchmark.run(args, cases, [f'Bearer {i}' for i in range(5)])
            assert len(result['batches']) == 20 and result['attempts'] == 100
            assert result['outcomes'] == {'valid_expected_outcome': 100}
            assert result['valid_answer_count'] == 0 and result['valid_answer_p95_ms'] is None
            with pytest.raises(ValueError, match='DISTINCT_ACTIVE_TEST_ACTORS_REQUIRED'):
                await benchmark.run(args, cases, ['Bearer 0'] * 5)
    asyncio.run(run())
