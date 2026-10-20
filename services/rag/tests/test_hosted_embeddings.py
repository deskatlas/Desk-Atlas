"""SDD-C21/C23 / QAD-TC44/45: shared encoder and generation isolation."""
import asyncio
import copy
import json
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest

from rag.embedding_provider import (CONTRACT, FINGERPRINT, HostedEncoder, ByteTokenizer,
    payload, vectors_from_response, embedding_fingerprint)


def response(count=1):
    return {'model': CONTRACT['model'], 'data': [
        {'index': index, 'embedding': [2.0] + [0.0] * 1023} for index in reversed(range(count))]}


def test_document_query_contract_and_fingerprint(monkeypatch):
    monkeypatch.setenv('RAG_EMBEDDING_PROVIDER', 'deepinfra')
    assert embedding_fingerprint({}) == FINGERPRINT
    assert payload(['Office opens at nine.'], False)['input'] == ['Office opens at nine.']
    assert payload(['Opening time?'], True)['input'][0].startswith('Instruct: ')
    assert payload(['Text'], False)['dimensions'] == 1024
    monkeypatch.setenv('RAG_EMBEDDING_PROVIDER', 'local')
    assert embedding_fingerprint({'embedding': {}}) != FINGERPRINT


def test_ordering_normalization_and_finite_checks():
    assert vectors_from_response(response(2), 2) == [[1.0] + [0.0] * 1023] * 2


@pytest.mark.parametrize('kind', ['model', 'count', 'duplicate', 'dimension', 'nan', 'zero', 'boolean', 'index'])
def test_bad_responses_rejected(kind):
    body = response(2)
    if kind == 'model': body['model'] = 'other'
    elif kind == 'count': body['data'].pop()
    elif kind == 'duplicate': body['data'][0]['index'] = 0
    elif kind == 'dimension': body['data'][0]['embedding'].pop()
    elif kind == 'nan': body['data'][0]['embedding'][0] = float('nan')
    elif kind == 'zero': body['data'][0]['embedding'][0] = 0
    elif kind == 'boolean': body['data'][0]['embedding'][0] = True
    else: body['data'][0]['index'] = True
    with pytest.raises(ValueError, match='INVALID_EMBEDDING_OUTPUT'):
        vectors_from_response(body, 2)


@pytest.mark.parametrize('texts', [[], [''], [' '], ['x' * 30001], ['a'] * 5])
def test_no_truncation_or_invalid_batches(texts):
    with pytest.raises(ValueError): payload(texts, False)


def test_utf8_upper_bound_chunker_preserves_text():
    from knowledge.chunk import chunk_sections
    tokenizer = ByteTokenizer()
    text = 'Mahalagang paalala: café. ' * 70
    chunks = chunk_sections([{'text': text, 'heading': '', 'page': None, 'method': 'TEXT'}], tokenizer)
    assert len(chunks) > 1
    assert all(chunk['token_count'] <= 800 for chunk in chunks)
    assert len(tokenizer.encode('漢字')) >= len('漢字'.encode('utf-8'))


def test_sync_and_async_use_same_contract_and_fixed_origin(monkeypatch):
    monkeypatch.setenv('DEEPINFRA_API_KEY', 'synthetic-key')
    real_sync, real_async = httpx.Client, httpx.AsyncClient
    requests = []
    def handler(request):
        assert str(request.url) == CONTRACT['endpoint']
        assert request.headers['authorization'] == 'Bearer synthetic-key'
        requests.append(json.loads(request.content))
        return httpx.Response(200, json=response())
    with patch('rag.embedding_provider.httpx.Client', side_effect=lambda **kw: real_sync(**kw, transport=httpx.MockTransport(handler))), patch(
        'rag.embedding_provider.httpx.AsyncClient', side_effect=lambda **kw: real_async(**kw, transport=httpx.MockTransport(handler))):
        encoder = HostedEncoder()
        assert encoder.encode(['synthetic']) == asyncio.run(encoder.encode_async(['synthetic']))
    assert requests[0] == requests[1]


def test_async_cancel_propagates_without_background_embedding(monkeypatch):
    monkeypatch.setenv('DEEPINFRA_API_KEY', 'synthetic-key')
    real = httpx.AsyncClient
    async def run():
        entered, stopped = asyncio.Event(), asyncio.Event()
        async def handler(request):
            entered.set()
            try: await asyncio.Future()
            finally: stopped.set()
        with patch('rag.embedding_provider.httpx.AsyncClient', side_effect=lambda **kw: real(**kw, transport=httpx.MockTransport(handler))):
            task = asyncio.create_task(HostedEncoder().encode_async(['synthetic']))
            await asyncio.wait_for(entered.wait(), 1)
            task.cancel()
            with pytest.raises(asyncio.CancelledError): await task
            assert stopped.is_set()
    asyncio.run(run())


def test_worker_uses_hosted_fingerprint_without_loading_weights(monkeypatch):
    from knowledge import worker
    monkeypatch.setenv('KB_ENABLED', 'true')
    monkeypatch.setenv('RAG_EMBEDDING_PROVIDER', 'deepinfra')
    monkeypatch.setenv('DEEPINFRA_API_KEY', 'synthetic-key')
    monkeypatch.setenv('KB_WORKER_TOKEN', 'x' * 32)
    monkeypatch.setenv('KB_WORKER_MODE', 'all')
    seen = []
    with patch.object(worker, 'LazyEncoder', side_effect=AssertionError('Local weights must not load')), patch.object(
        worker, 'run_lanes', side_effect=lambda gateway, encoder, fingerprint: seen.append((encoder, fingerprint))):
        worker.main()
    assert isinstance(seen[0][0], HostedEncoder) and seen[0][1] == FINGERPRINT


@pytest.mark.parametrize('status', [302, 401, 429, 500])
def test_errors_no_redirect_fallback_or_payload_logging(monkeypatch, status):
    monkeypatch.setenv('DEEPINFRA_API_KEY', 'synthetic-key')
    real = httpx.Client
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(status, text='private body', headers={'location': 'https://untrusted.example'})
    with patch('rag.embedding_provider.httpx.Client', side_effect=lambda **kw: real(**kw, transport=httpx.MockTransport(handler))):
        with pytest.raises(ValueError, match='EMBEDDING_FAILED') as error:
            HostedEncoder().encode(['synthetic'])
        assert 'private' not in str(error.value)
    assert len(calls) == 1
