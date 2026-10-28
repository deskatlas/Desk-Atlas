"""PRD-F26 / SDD-C21 / QAD-TC44/46: provider and deployment boundaries."""
import asyncio
import copy
import importlib.util
import json
from pathlib import Path
from unittest.mock import patch
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException

from rag.answer_provider import answer_model, deepinfra_headers, provider, DEEPINFRA_MODEL

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


api = load('deepinfra_api', ROOT / 'app.py')
deployment = load('deepinfra_deployment', ROOT / 'cloudrun/prepare_deepinfra.py')


@pytest.fixture(autouse=True)
def hosted(monkeypatch):
    monkeypatch.setenv('RAG_MODEL_PROVIDER', 'deepinfra')
    monkeypatch.setenv('RAG_ANSWER_MODEL', DEEPINFRA_MODEL)
    monkeypatch.setenv('DEEPINFRA_API_KEY', 'synthetic-provider-key')
    monkeypatch.delenv('RAG_ANSWER_DIGEST', raising=False)


def completion(content='{"p":[],"c":false}', reason='stop'):
    return {'model': DEEPINFRA_MODEL, 'choices': [{'finish_reason': reason,
        'message': {'content': content}}], 'usage': {'prompt_tokens': 50, 'completion_tokens': 10}}


def test_provider_reasoning_diagnostics_retain_only_numeric_counts():
    from rag import request_timing
    response=completion()
    response['choices'][0]['message']['reasoning_content']='private synthetic reasoning'
    response['usage']['completion_tokens_details']={'reasoning_tokens':4}
    response['usage']['prompt_tokens_details']={'cached_tokens':12}
    counts={}
    token=request_timing.metrics.set(counts)
    try:
        api.record_hosted_usage(response)
        assert counts['reasoning_tokens']==4 and counts['cached_input_tokens']==12
        assert counts['reasoning_bytes']==len('private synthetic reasoning')
        assert all(type(value) is int for value in counts.values())
    finally:
        request_timing.metrics.reset(token)


def test_startup_embedding_recovers_once_from_transient_provider_rate_limit():
    from rag.embedding_provider import HostedEmbeddingFailure
    encoder=type('Encoder',(),{'encode_async':AsyncMock(side_effect=[HostedEmbeddingFailure(429,True),[[1.0]]])})()
    with patch.object(api.asyncio,'sleep',new_callable=AsyncMock) as pause:
        asyncio.run(api.verify_embedding_readiness(encoder))
    assert encoder.encode_async.await_count==2
    pause.assert_awaited_once_with(2)


@pytest.mark.parametrize('status,transient,calls',[(401,False,1),(503,True,2)])
def test_startup_retry_preserves_failed_readiness_and_never_loops(status,transient,calls):
    from rag.embedding_provider import HostedEmbeddingFailure
    encoder=type('Encoder',(),{'encode_async':AsyncMock(side_effect=HostedEmbeddingFailure(status,transient))})()
    with patch.object(api.asyncio,'sleep',new_callable=AsyncMock) as pause:
        with pytest.raises(HostedEmbeddingFailure):
            asyncio.run(api.verify_embedding_readiness(encoder))
    assert encoder.encode_async.await_count==calls
    assert pause.await_count==calls-1


@pytest.mark.parametrize('model', ['Qwen/Qwen3-235B-A22B-Instruct-2507', 'Qwen/Qwen3.6-35B-A3B'])
def test_maintainer_approved_candidate_is_explicit_not_a_fallback(monkeypatch, model):
    from rag.answer_provider import normalize_deepinfra
    monkeypatch.setenv('RAG_ANSWER_MODEL', model)
    assert answer_model() == model
    with pytest.raises(HTTPException):
        normalize_deepinfra(completion(), model)
    monkeypatch.setenv('RAG_ANSWER_MODEL', 'unapproved/model')
    with pytest.raises(HTTPException):
        answer_model()


def test_qwen36_uses_its_native_byte_bound_and_no_unsupported_soft_switch(monkeypatch):
    from rag.answer_provider import document_limits, document_model, deepinfra_payload
    monkeypatch.setenv('RAG_DOCUMENT_ANSWER_MODEL', 'Qwen/Qwen3.6-35B-A3B')
    limits = document_limits()
    assert limits['byte_tokens'] is True
    assert limits['model_request_bytes'] + 2400 + 512 < limits['context_tokens']
    payload = deepinfra_payload({'model': document_model(), 'format': {'type': 'object', 'properties': {}},
                                 'messages': [{'role': 'system', 'content': 'Return JSON.'}], 'options': {'num_predict': 128}}, 'Synthetic')
    assert payload['reasoning_effort'] == 'none'
    assert payload['messages'][0]['content'] == 'Return JSON.'


def run_generation(handler, schema=None, content=None):
    async def run():
        async with httpx.AsyncClient(base_url='https://api.deepinfra.com',
            headers=deepinfra_headers(), transport=httpx.MockTransport(handler)) as client:
            api.app.state.client = client
            api.app.state.slots = asyncio.Semaphore(1)
            return await api.generate('Return the requested JSON.', content or {}, schema or api.PassageSelection)
    return asyncio.run(run())


def test_real_generate_sends_only_hosted_format_and_validates_locally():
    def handler(request):
        assert str(request.url) == 'https://api.deepinfra.com/v1/openai/chat/completions'
        assert request.headers['authorization'] == 'Bearer synthetic-provider-key'
        payload = json.loads(request.content)
        assert payload['model'] == DEEPINFRA_MODEL
        assert payload['reasoning_effort'] == 'none'
        assert payload['messages'][0]['content'].endswith('\n/no_think')
        assert payload['max_tokens'] == 128
        assert not {'options', 'think', 'keep_alive', 'format'} & set(payload)
        assert payload['response_format']['json_schema']['strict'] is True
        assert payload['response_format']['json_schema']['schema']['additionalProperties'] is False
        return httpx.Response(200, json=completion())
    result = run_generation(handler)
    assert result.passages == [] and result.conflicting_sources is False


@pytest.mark.parametrize('reason', ['length', 'content_filter', 'tool_calls', None])
def test_truncated_or_unexpected_finish_rejected_even_when_json_is_valid(reason):
    with pytest.raises(HTTPException, match='INVALID_MODEL_OUTPUT'):
        run_generation(lambda request: httpx.Response(200, json=completion(reason=reason)))


@pytest.mark.parametrize('body', [None, [], {}, {'choices': []}, completion(''),
    completion('not json'), completion('{"p":[],"c":false,"extra":true}'),
    completion('{"p":[],"c":"false"}')])
def test_malformed_or_schema_invalid_response_fails_closed(body):
    with pytest.raises(HTTPException, match='INVALID_MODEL_OUTPUT'):
        run_generation(lambda request: httpx.Response(200, json=body))


@pytest.mark.parametrize('change', ['model', 'refusal', 'usage', 'boolean_count'])
def test_provider_identity_refusal_and_usage_validation(change):
    body = completion()
    if change == 'model':
        body['model'] = 'another-model'
    elif change == 'refusal':
        body['choices'][0]['message']['refusal'] = 'refused'
    elif change == 'usage':
        body['usage'] = []
    else:
        body['usage']['prompt_tokens'] = True
    with pytest.raises(HTTPException, match='INVALID_MODEL_OUTPUT'):
        run_generation(lambda request: httpx.Response(200, json=body))


@pytest.mark.parametrize('status', [401, 403, 429, 500, 302])
def test_provider_failures_never_fallback_or_expose_remote_body(status):
    calls = []
    def handler(request):
        calls.append(request.url)
        return httpx.Response(status, text='synthetic-sensitive-remote-body',
                              headers={'location': 'https://untrusted.example'})
    with pytest.raises(HTTPException, match='MODEL_UNAVAILABLE') as error:
        run_generation(handler)
    assert len(calls) == 1
    assert 'sensitive' not in str(error.value)


def test_provider_timeout_remains_timeout():
    def handler(request):
        raise httpx.ReadTimeout('synthetic-sensitive-error', request=request)
    with pytest.raises(HTTPException, match='MODEL_TIMEOUT'):
        run_generation(handler)


def test_oversized_input_never_reaches_provider():
    def handler(request):
        pytest.fail('context budget must reject before transport')
    with pytest.raises(HTTPException, match='CONTEXT_BUDGET_EXCEEDED'):
        run_generation(handler, content={'query': 'x' * 100_000})


def test_cancellation_propagates_to_provider():
    async def run():
        entered, stopped = asyncio.Event(), asyncio.Event()
        async def handler(request):
            entered.set()
            try:
                await asyncio.Future()
            finally:
                stopped.set()
        async with httpx.AsyncClient(base_url='https://api.deepinfra.com',
            transport=httpx.MockTransport(handler)) as client:
            api.app.state.client = client
            api.app.state.slots = asyncio.Semaphore(1)
            task = asyncio.create_task(api.generate('JSON', {}, api.PassageSelection))
            await asyncio.wait_for(entered.wait(), 1)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert stopped.is_set() and not api.app.state.slots.locked()
    asyncio.run(run())


def test_strict_schema_includes_nullable_nested_properties_without_mutating_pydantic_schema():
    from rag.answer_provider import deepinfra_payload
    original = api.Tool.model_json_schema()
    payload = deepinfra_payload({'model': DEEPINFRA_MODEL, 'messages': [],
        'format': original, 'options': {'num_predict': 1200}}, 'Tool')
    filters = payload['response_format']['json_schema']['schema']['$defs']['Filters']
    assert set(filters['required']) == set(filters['properties'])
    assert {'type': 'null'} in filters['properties']['period']['anyOf']
    assert 'default' not in filters['properties']['basis']
    assert api.Tool.model_json_schema() == original


def test_explicit_configuration_rejects_unknown_provider_or_model(monkeypatch):
    monkeypatch.setenv('RAG_MODEL_PROVIDER', 'unknown')
    with pytest.raises(HTTPException, match='INVALID_MODEL_PROVIDER'):
        provider()
    monkeypatch.setenv('RAG_MODEL_PROVIDER', 'deepinfra')
    monkeypatch.setenv('RAG_ANSWER_MODEL', 'qwen3:4b')
    with pytest.raises(HTTPException, match='MODEL_REVISION_MISMATCH'):
        answer_model()


def test_startup_canary_requires_real_structured_completion(monkeypatch):
    monkeypatch.setenv('KB_ENABLED', 'false')
    monkeypatch.setenv('RAG_SERVICE_TOKEN', 's' * 32)
    monkeypatch.setenv('RAG_CAPABILITY_SECRET', 'c' * 32)
    monkeypatch.setenv('RAG_SCOPE_ID', 'synthetic')
    real_client = httpx.AsyncClient
    for valid in (True, False):
        calls = []
        def handler(request):
            calls.append(request.url)
            return httpx.Response(200, json=completion(reason='stop' if valid else 'length'))
        def client_factory(**kwargs):
            assert kwargs['base_url'] == 'https://api.deepinfra.com'
            assert kwargs['follow_redirects'] is False
            assert kwargs['trust_env'] is False
            client = real_client(**kwargs, transport=httpx.MockTransport(handler))
            clients.append(client)
            return client
        async def start():
            async with api.lifespan(api.app):
                assert valid
        clients = []
        with patch.object(api.httpx, 'AsyncClient', side_effect=client_factory):
            if valid:
                asyncio.run(start())
            else:
                with pytest.raises(HTTPException, match='INVALID_MODEL_OUTPUT'):
                    asyncio.run(start())
        assert len(calls) == 1
        assert all(client.is_closed for client in clients)


@pytest.mark.parametrize('key', ['', ' ', 'key\nheader'])
def test_missing_or_invalid_secret_fails_without_echoing_it(monkeypatch, key):
    monkeypatch.setenv('DEEPINFRA_API_KEY', key)
    with pytest.raises(HTTPException, match='MISSING_MODEL_CREDENTIAL'):
        deepinfra_headers()


def test_revision_preparation_preserves_live_configuration_and_removes_only_ollama():
    service = {'metadata': {'name': deployment.SERVICE, 'resourceVersion': 'old'},
        'status': {'url': 'https://service.run.app'},
        'spec': {'traffic': [{'latestRevision': True, 'percent': 100}], 'template': {
            'metadata': {'name': 'old-revision', 'annotations': {
                'run.googleapis.com/container-dependencies': '{"api":["ollama"]}',
                'autoscaling.knative.dev/minScale': '0'}},
            'spec': {'serviceAccountName': 'existing-account', 'containerConcurrency': 1,
                'containers': [{'name': 'api', 'image': 'old', 'env': [
                    {'name': name, 'valueFrom': {'secretKeyRef': {'name': name, 'key': '1'}}}
                    for name in ('RAG_SERVICE_TOKEN', 'RAG_CAPABILITY_SECRET')
                ] + [{'name': 'RAG_EMBEDDING_FINGERPRINT', 'value': 'existing'},
                     {'name': 'RAG_ANSWER_DIGEST', 'value': 'old-digest'}]},
                    {'name': 'ollama', 'image': 'old'}]}}}}
    original = copy.deepcopy(service)
    result = deployment.prepare(service, deployment.IMAGE_PREFIX + 'a' * 64)
    assert service == original
    assert 'status' not in result
    template = result['spec']['template']
    assert 'name' not in template['metadata']
    assert 'run.googleapis.com/container-dependencies' not in template['metadata']['annotations']
    assert template['spec']['serviceAccountName'] == 'existing-account'
    assert len(template['spec']['containers']) == 1
    env = {item['name']: item for item in template['spec']['containers'][0]['env']}
    assert env['RAG_EMBEDDING_FINGERPRINT']['value'] == 'existing'
    assert env['RAG_MODEL_PROVIDER']['value'] == 'deepinfra'
    assert env['DEEPINFRA_API_KEY']['valueFrom']['secretKeyRef']['key'] == '1'
    assert 'RAG_ANSWER_DIGEST' not in env
    with pytest.raises(ValueError, match='IMMUTABLE_DEEPINFRA_IMAGE_REQUIRED'):
        deployment.prepare(service, 'mutable:latest')
