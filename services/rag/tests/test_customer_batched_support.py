"""PRD-F26/F27 / QAD-TC44/46: customer batching keeps full-source checks."""
import asyncio
import hashlib
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from rag.batched_support import batched_document_answer
from rag.document_support import Composition, Verification
from test_deepinfra import api
from customer_public import select_customer_sources, interpret_customer_catalog, CustomerPlanInput


def source():
    text = 'Reservations need first name, last name and email.\n\nNo account is required.\n\nSelection does not hold inventory.'
    return {'chunk_id': 'customer', 'heading_path': 'Booking', 'content': text,
            'content_hash': hashlib.sha256(text.encode()).hexdigest()}


@pytest.mark.parametrize('principal', ['PUBLIC_VISITOR', 'VERIFIED_CUSTOMER'])
@pytest.mark.parametrize('complete', [True, False])
def test_two_pass_customer_answer_checks_uncited_distant_conditions(monkeypatch, principal, complete):
    monkeypatch.setattr('rag.batched_support.token_count', lambda text: len(text.encode()))
    seen = []
    async def generate(prompt, data, schema):
        seen.append(data)
        assert data['customer_principal'] == principal
        assert 'authenticated_role' not in data
        if 'answer' not in data:
            return schema(scope='FACTUAL', blocks=[{'kind': 'text',
                'text': 'Use your first name, last name and email. No account is required.', 'support': [0, 1]}])
        assert [unit['i'] for unit in data['units']] == [0, 1, 2]
        assert data['units'][2]['text'] == 'Selection does not hold inventory.'
        return Verification(relevant=True, supported=True, complete=complete, consistent=True, safe=True)
    if not complete:
        with pytest.raises(HTTPException) as error:
            asyncio.run(batched_document_answer('How do I book?', [source()], generate,
                actor_role=principal, customer_reference=True))
        assert error.value.detail == 'UNRESOLVED_CONTEXT'
    else:
        result = asyncio.run(batched_document_answer('How do I book?', [source()], generate,
            actor_role=principal, customer_reference=True))
        assert result['outcome'] == 'COMPLETE'
        assert len(seen) == 2
        assert result['spans'][1]['quote'] == 'No account is required.'


@pytest.mark.parametrize('role,customer', [('ADMIN', True), ('STAFF', True), ('PUBLIC_VISITOR', False), ('VERIFIED_CUSTOMER', False), (None, True)])
def test_customer_and_internal_principals_cannot_cross_batching_modes(role, customer):
    generate = AsyncMock()
    with pytest.raises(HTTPException) as error:
        asyncio.run(batched_document_answer('How?', [source()], generate,
            actor_role=role, customer_reference=customer))
    assert error.value.status_code == 403
    generate.assert_not_called()


@pytest.mark.parametrize('enabled', [False, True])
def test_customer_endpoint_uses_separate_rollout_and_restores_limits(monkeypatch, enabled):
    monkeypatch.setenv('RAG_MODEL_PROVIDER', 'deepinfra')
    monkeypatch.setenv('RAG_CUSTOMER_BATCHED_SUPPORT', str(enabled).lower())
    monkeypatch.setenv('RAG_INTERNAL_BATCHED_SUPPORT', 'true')
    monkeypatch.setattr(api, 'admit_customer_operation', lambda *args: None)
    legacy = AsyncMock(return_value={'outcome': 'INSUFFICIENT'})
    batched = AsyncMock(return_value={'outcome': 'COMPLETE'})
    monkeypatch.setattr(api, 'document_answer', legacy)
    monkeypatch.setattr('rag.batched_support.batched_document_answer', batched)
    body = SimpleNamespace(query='How?', sources=[], synthesis=True)
    request = SimpleNamespace(body=AsyncMock(return_value=b'{}'))
    claims = SimpleNamespace(principal='PUBLIC_VISITOR')
    asyncio.run(api.customer_document_support(body, request, claims))
    if enabled:
        batched.assert_awaited_once()
        assert batched.await_args.kwargs['actor_role'] == 'PUBLIC_VISITOR'
        assert batched.await_args.kwargs['customer_reference'] is True
        legacy.assert_not_called()
    else:
        legacy.assert_awaited_once()
        batched.assert_not_called()
    assert api.request_timing.model_limits.get() is None


@pytest.mark.parametrize('mandatory', [False, True])
def test_single_discovery_reads_all_candidates_and_validates_explicit_dependencies(mandatory):
    reference = 'You must follow Document 02.' if mandatory else 'See Document 02 for optional reading.'
    sources = [{'chunk_id': str(i), 'title': f'0{i + 1}_Guide', 'heading_path': 'Guide',
                'content': reference if i == 0 else 'A different policy.'} for i in range(3)]
    async def generate(prompt, data, schema):
        assert [passage['i'] for passage in data['passages']] == [0, 1, 2]
        return schema(primaries=[0], dependencies=[{'primary': 0, 'index': 1,
            'missing_rule': 'Confirmation policy', 'reference_quote': reference}])
    result = asyncio.run(select_customer_sources('How do I book?', sources, generate, single_pass=True))
    assert result == (['0', '1'] if mandatory else ['0'])


@pytest.mark.parametrize('primaries', [[], [0, 2]])
def test_single_discovery_preserves_absence_and_joint_requested_topics(primaries):
    sources = [{'chunk_id': str(i), 'title': 'Guide', 'heading_path': 'Guide', 'content': 'Policy'} for i in range(3)]
    async def generate(prompt, data, schema):
        return schema(primaries=primaries, dependencies=[])
    assert asyncio.run(select_customer_sources('Explain two topics.', sources, generate, single_pass=True)) == [str(i) for i in primaries]


@pytest.mark.parametrize('primaries,dependencies', [([3], []), ([0, 0], []),
    ([0], [{'primary': 1, 'index': 2, 'missing_rule': 'Rule', 'reference_quote': 'Rule'}]),
    ([0], [{'primary': 0, 'index': 99, 'missing_rule': 'Rule', 'reference_quote': 'Rule'}])])
def test_single_discovery_rejects_fabricated_addresses(primaries, dependencies):
    sources = [{'chunk_id': str(i), 'title': 'Guide', 'heading_path': 'Guide', 'content': 'Policy'} for i in range(3)]
    async def generate(prompt, data, schema):
        return schema(primaries=primaries, dependencies=dependencies)
    with pytest.raises(HTTPException) as error:
        asyncio.run(select_customer_sources('Help?', sources, generate, single_pass=True))
    assert error.value.detail == 'INVALID_MODEL_OUTPUT'


def test_single_discovery_rejects_capacity_before_inference():
    generate = AsyncMock()
    sources = [{'chunk_id': 'c', 'title': 'Guide', 'heading_path': 'Guide', 'content': 'x' * 100001}]
    with pytest.raises(HTTPException) as error:
        asyncio.run(select_customer_sources('Help?', sources, generate, single_pass=True))
    assert error.value.detail == 'CONTEXT_BUDGET_EXCEEDED'
    generate.assert_not_called()


def test_customer_cannot_supply_an_internal_prepared_closure():
    generate = AsyncMock()
    with pytest.raises(HTTPException):
        asyncio.run(batched_document_answer('How?', [source()], generate,
            actor_role='PUBLIC_VISITOR', customer_reference=True, admitted_units=[]))
    generate.assert_not_called()


def test_customer_discovery_cancellation_restores_context(monkeypatch):
    monkeypatch.setenv('RAG_MODEL_PROVIDER', 'deepinfra')
    monkeypatch.setenv('RAG_CUSTOMER_BATCHED_SUPPORT', 'true')
    monkeypatch.setattr(api, 'admit_customer_operation', lambda *args: None)
    async def run():
        started = asyncio.Event()
        async def generate(*args):
            started.set()
            await asyncio.Future()
        monkeypatch.setattr(api, 'generate', generate)
        body = api.CustomerPlanInput(message='How do I book?')
        task = asyncio.create_task(api.public_customer_plan(body, SimpleNamespace()))
        await asyncio.wait_for(started.wait(), 1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert api.request_timing.model_limits.get() is None
    asyncio.run(run())


def test_catalog_discovery_resolves_question_without_generating_policy_or_granting_internal_operations():
    sources = [{**source(), 'title': 'Booking'}]
    seen = []
    async def generate(prompt, data, schema):
        seen.append(data)
        assert data['catalog'][0]['original_intro'] == sources[0]['content']
        return schema(kind='KNOWLEDGE', search_query='How do I make a guest reservation?', comparison_names=[],
            topic='Guest booking', primaries=[0], dependencies=[])
    result = asyncio.run(interpret_customer_catalog(CustomerPlanInput(message='Paano mag-book?'), sources, [['Booking']], generate))
    assert result['chunk_ids'] == ['customer']
    assert result['plan']['operations'] == [{'name': 'customer_knowledge'}]
    assert len(seen) == 1
    assert 'summary' not in result


def test_catalog_dictionary_retains_every_heading_context_and_reduces_repetition():
    import json
    from customer_public import pack_catalog_headings
    headings = ['Customer policies / Website booking / ' + f'Condition {i}' for i in range(40)]
    entries = [{'i': 0, 'headings': headings, 'original_intro': 'Exact original introduction.'}]
    packed, segments = pack_catalog_headings(entries)
    restored = [' / '.join(segments[index] for index in path) for path in packed[0]['headings']]
    assert restored == headings
    assert entries[0]['headings'] == headings
    assert packed[0]['original_intro'] == entries[0]['original_intro']
    assert len(json.dumps({'catalog': packed, 'heading_segments': segments})) < len(json.dumps(entries))


def test_catalog_private_and_mutation_guards_run_before_discovery_inference():
    generate = AsyncMock()
    for question, expected in [('Show my reservation', 'BOOKING'), ('Approve payment', 'REFUSE')]:
        result = asyncio.run(interpret_customer_catalog(CustomerPlanInput(message=question), [], [], generate))
        assert result['plan']['kind'] == expected
        assert result['chunk_ids'] == []
    generate.assert_not_called()


def test_catalog_model_cannot_invent_an_original_address():
    async def generate(prompt, data, schema):
        return schema.model_construct(kind='KNOWLEDGE', search_query='Booking?', comparison_names=[], primaries=[99], dependencies=[])
    with pytest.raises(HTTPException) as error:
        asyncio.run(interpret_customer_catalog(CustomerPlanInput(message='How do I book?'),
            [{**source(), 'title': 'Booking'}], [['Booking']], generate))
    assert error.value.detail == 'INVALID_MODEL_OUTPUT'


def test_catalog_schema_excludes_heading_indexes_from_document_addresses():
    from customer_public import catalog_interpretation_schema
    schema = catalog_interpretation_schema(2)
    valid = dict(kind='KNOWLEDGE', search_query='QR access?', comparison_names=[], topic='Access', primaries=[0], dependencies=[])
    assert schema.model_validate(valid).primaries == [0]
    with pytest.raises(ValueError):
        schema.model_validate({**valid, 'primaries': [130]})
    with pytest.raises(ValueError):
        schema.model_validate({**valid, 'dependencies': [{'index': 130, 'primary': 0,
            'reference_quote': 'heading', 'missing_rule': 'Unknown'}]})
