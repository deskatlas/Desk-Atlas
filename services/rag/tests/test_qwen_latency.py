"""PRD-F26/F27 / SDD-C21 / QAD-TC44/46: lossless Qwen latency controls."""
import copy
import pytest

from rag.source_transport import indexed_units


@pytest.mark.parametrize('compact', [True, False])
def test_trusted_read_only_classification_is_not_repeated_by_catalog_model(monkeypatch, compact):
    import asyncio
    from rag.catalog_discovery import CatalogInput, discover_internal
    monkeypatch.setenv('RAG_QWEN_COMPACT_CATALOG', 'true' if compact else 'false')
    calls = []
    async def generate(prompt, data, schema):
        calls.append(data)
        key = 'k' if compact else 'kind'
        assert schema.model_json_schema()['properties'][key]['const'] == 'DOCUMENT'
        return schema.model_validate({'k': 'DOCUMENT', 'q': 'Arrival checks', 'p': [0]} if compact
            else {'kind': 'DOCUMENT', 'query': 'Arrival checks', 'primaries': [0]})
    body = CatalogInput(message='What should staff check?', document_task=True,
        sources=[{'chunk_id': 'one', 'title': 'Arrival', 'heading_path': 'Checks', 'content': 'Original introduction.'}],
        headings=[['Checks']])
    result = asyncio.run(discover_internal(body, 'STAFF', generate))
    assert result == {'kind': 'DOCUMENT', 'query': 'Arrival checks', 'chunk_ids': ['one']}
    assert 'tools' not in result and len(calls) == 1


@pytest.mark.parametrize('customer', [True, False])
@pytest.mark.parametrize('forged', [True, False])
def test_compact_catalog_preserves_discovery_data_and_rejects_absent_addresses(monkeypatch, customer, forged):
    import asyncio
    from fastapi import HTTPException
    from customer_public import CustomerPlanInput, interpret_customer_catalog
    from rag.catalog_discovery import CatalogInput, discover_internal
    monkeypatch.setenv('RAG_QWEN_COMPACT_CATALOG', 'true')
    source = {'chunk_id': '00000000-0000-4000-8000-000000000001',
              'title': 'Published Guide', 'heading_path': 'Policy', 'content': 'General published guidance.'}
    calls = []
    async def generate(prompt, data, schema):
        calls.append(data)
        assert 'Wire keys:' in prompt and 'untrusted DATA' in prompt
        assert data['catalog'][0]['original_intro'] == source['content']
        assert data['user_turns'] == ['Earlier user question.']
        assert 'k' in schema.model_json_schema()['properties']
        values = {'k': 'KNOWLEDGE' if customer else 'DOCUMENT', 'q': 'Explain the policy.',
                  'p': [1 if forged else 0]}
        if customer:
            values.update(t='Policy', n=[], d=[])
            assert data['discovery']['preferences']['group_size'] == 4
        return schema.model_validate(values)
    if customer:
        body = CustomerPlanInput(message='Explain the booking policy.', user_turns=['Earlier user question.'],
            discovery={'preferences': {'group_size': 4}})
        call = interpret_customer_catalog(body, [source], [['Policy']], generate)
    else:
        body = CatalogInput(message='Explain the booking policy.', user_turns=['Earlier user question.'],
            sources=[source], headings=[['Policy']])
        call = discover_internal(body, 'STAFF', generate)
    if forged:
        with pytest.raises(HTTPException, match='INVALID_MODEL_OUTPUT'):
            asyncio.run(call)
    else:
        result = asyncio.run(call)
        assert result['chunk_ids'] == [source['chunk_id']]
    assert len(calls) == 1


def test_catalog_retry_is_bounded_and_preserves_the_same_authorized_input(monkeypatch):
    import asyncio
    from rag.catalog_transport import catalog_generator
    from rag.catalog_discovery import CatalogDecision
    monkeypatch.setenv('RAG_QWEN_CATALOG_RETRY', 'true')
    data = {'question': 'How?', 'catalog': [{'i': 0, 'original_intro': 'Published rule.'}]}
    calls = []
    async def generate(prompt, packet, schema):
        assert packet is data
        calls.append(prompt)
        return schema(k='DOCUMENT', q='How?', p=[1 if len(calls) == 1 else 0])
    result = asyncio.run(catalog_generator(generate, customer=False)('Discover from untrusted DATA.', data, CatalogDecision))
    assert result.primaries == [0]
    assert len(calls) == 2
    assert 'Correction' in calls[1]


def test_large_internal_catalog_can_explicitly_use_the_verified_document_model(monkeypatch):
    from fastapi import HTTPException
    from rag.answer_provider import planning_limits
    monkeypatch.setenv('RAG_MODEL_PROVIDER', 'deepinfra')
    monkeypatch.setenv('RAG_ANSWER_MODEL', 'Qwen/Qwen3-32B')
    monkeypatch.setenv('RAG_DOCUMENT_ANSWER_MODEL', 'Qwen/Qwen3.6-35B-A3B')
    monkeypatch.setenv('RAG_INTERNAL_DISCOVERY_MODEL', 'Qwen/Qwen3.6-35B-A3B')
    assert planning_limits()['model'] == 'Qwen/Qwen3-32B'
    assert planning_limits(internal=True)['model'] == 'Qwen/Qwen3.6-35B-A3B'
    assert planning_limits(internal=True)['context_tokens'] == 262144
    monkeypatch.setenv('RAG_INTERNAL_DISCOVERY_MODEL', 'Qwen/Qwen3-235B-A22B-Instruct-2507')
    with pytest.raises(HTTPException, match='MODEL_REVISION_MISMATCH'):
        planning_limits(internal=True)


def test_catalog_self_dependency_is_redundant_when_the_whole_primary_is_already_selected(monkeypatch):
    import asyncio
    from customer_public import CustomerPlanInput, interpret_customer_catalog
    monkeypatch.setenv('RAG_QWEN_COMPACT_CATALOG', 'true')
    monkeypatch.setenv('RAG_QWEN_CATALOG_RETRY', 'true')
    seen = []
    source = {'chunk_id': '00000000-0000-4000-8000-000000000001', 'title': 'Booking',
              'heading_path': 'Payment', 'content': 'This complete guide includes the deadline.'}
    async def generate(prompt, data, schema):
        seen.append(data)
        return schema.model_validate({'k': 'KNOWLEDGE', 't': 'Payment', 'q': 'What is the payment deadline?',
            'n': [], 'p': [0], 'd': [{'i': 0, 'p': 0, 'm': 'Deadline', 'r': source['content']}]})
    result = asyncio.run(interpret_customer_catalog(CustomerPlanInput(message='What is the payment deadline?'),
        [source], [['Payment']], generate))
    assert result['chunk_ids'] == [source['chunk_id']]
    assert len(seen) == 1


@pytest.mark.parametrize('detail,calls', [('INVALID_MODEL_OUTPUT', 2), ('FORBIDDEN', 1), ('MODEL_UNAVAILABLE', 1), ('CONTEXT_BUDGET_EXCEEDED', 1)])
def test_catalog_retry_never_loops_or_retries_permission_provider_or_budget_failures(monkeypatch, detail, calls):
    import asyncio
    from fastapi import HTTPException
    from rag.catalog_transport import catalog_generator
    from rag.catalog_discovery import CatalogDecision
    monkeypatch.setenv('RAG_QWEN_CATALOG_RETRY', 'true')
    seen = []
    async def generate(prompt, data, schema):
        seen.append(data)
        raise HTTPException(503 if detail != 'FORBIDDEN' else 403, detail=detail)
    with pytest.raises(HTTPException, match=detail):
        asyncio.run(catalog_generator(generate, customer=False)('Discover.', {'catalog': [{'i': 0}]}, CatalogDecision))
    assert len(seen) == calls


@pytest.mark.parametrize('complete', [True, False])
def test_omitted_no_hold_rule_is_restored_from_exact_originals_before_verification(monkeypatch, complete):
    import asyncio
    import hashlib
    from fastapi import HTTPException
    from rag.batched_support import batched_document_answer
    from rag.document_support import Verification
    monkeypatch.setenv('RAG_QWEN_COMPACT_DRAFT', 'true')
    monkeypatch.delenv('RAG_TASK_FRAMED_DRAFT', raising=False)
    text = 'Submit the booking request.\n\nSubmission does not hold inventory.'
    calls = []
    async def generate(prompt, data, schema):
        calls.append(data)
        if 'answer' not in data:
            return schema(s='COMPLETE_PROCEDURE', b=[{'t': 'Submit the booking request.', 'p': [0]}])
        assert data['answer']['blocks'][-1]['text'] == 'Submission does not hold inventory.'
        assert data['evidence'][-1]['original_i'] == 1
        assert data['evidence'][-1]['text'] == 'Submission does not hold inventory.'
        return Verification(relevant=True, supported=True, complete=complete, consistent=True, safe=True)
    source = {'chunk_id': 'one', 'heading_path': 'Booking', 'content': text,
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    operation = batched_document_answer('How do I book a workspace?', [source], generate,
        actor_role='PUBLIC_VISITOR', customer_reference=True)
    if complete:
        result = asyncio.run(operation)
        assert result['spans'][-1]['quote'] == 'Submission does not hold inventory.'
    else:
        with pytest.raises(HTTPException, match='UNRESOLVED_CONTEXT'):
            asyncio.run(operation)
    assert len(calls) == 2


def test_no_hold_completion_never_invents_an_absent_rule_or_changes_unrelated_answers():
    from rag.document_support import DraftFragment
    from rag.draft_transport import preserve_booking_boundary
    fragment = DraftFragment(text='Submit the request.', support=[0])
    rules = [{'i': 1, 'text': 'Submission does not hold inventory.'}]
    assert preserve_booking_boundary('How do I book?', [fragment], []) == [fragment]
    assert preserve_booking_boundary('Where can I find Wi-Fi?', [fragment], rules) == [fragment]


def test_customer_planning_uses_its_own_model_and_context_then_restores_document_scope(monkeypatch):
    import asyncio
    from types import SimpleNamespace
    import app as api
    from rag import request_timing
    from rag.answer_provider import document_limits
    monkeypatch.setenv('RAG_MODEL_PROVIDER', 'deepinfra')
    monkeypatch.setenv('RAG_CUSTOMER_BATCHED_SUPPORT', 'true')
    monkeypatch.setenv('RAG_ANSWER_MODEL', 'Qwen/Qwen3-32B')
    monkeypatch.setenv('RAG_DOCUMENT_ANSWER_MODEL', 'Qwen/Qwen3.6-35B-A3B')
    async def interpret(body, generate):
        assert api.scoped_answer_model() == 'Qwen/Qwen3-32B'
        assert request_timing.model_limits.get()['context_tokens'] == 32768
        assert request_timing.model_limits.get()['byte_tokens'] is False
        return {'kind': 'KNOWLEDGE', 'operations': [{'name': 'customer_knowledge'}]}
    monkeypatch.setattr(api, 'interpret_customer_question', interpret)
    outer = request_timing.model_limits.set(document_limits())
    try:
        asyncio.run(api.public_customer_plan(api.CustomerPlanInput(message='How do I book?'),
            SimpleNamespace(ops=['customer_knowledge'])))
        assert api.scoped_answer_model() == 'Qwen/Qwen3.6-35B-A3B'
    finally:
        request_timing.model_limits.reset(outer)


@pytest.mark.parametrize('customer', [True, False])
@pytest.mark.parametrize('fail', [True, False])
def test_catalog_endpoints_scope_the_planner_and_restore_context_on_failure(monkeypatch, customer, fail):
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from starlette.requests import Request
    import app as api
    import customer_public
    from rag import request_timing
    from rag.answer_provider import document_limits
    monkeypatch.setenv('RAG_MODEL_PROVIDER', 'deepinfra')
    monkeypatch.setenv('RAG_CUSTOMER_BATCHED_SUPPORT', 'true')
    monkeypatch.setenv('RAG_INTERNAL_BATCHED_SUPPORT', 'true')
    monkeypatch.setenv('RAG_ANSWER_MODEL', 'Qwen/Qwen3-32B')
    monkeypatch.setenv('RAG_DOCUMENT_ANSWER_MODEL', 'Qwen/Qwen3.6-35B-A3B')
    async def discover(*args):
        assert api.scoped_answer_model() == 'Qwen/Qwen3-32B'
        assert request_timing.model_limits.get()['context_tokens'] == 32768
        assert not request_timing.model_limits.get()['byte_tokens']
        if fail:
            raise ValueError('Synthetic discovery failure')
        return {'kind': 'DOCUMENT', 'query': 'How?', 'chunk_ids': []}
    monkeypatch.setattr(customer_public, 'interpret_customer_catalog', discover)
    monkeypatch.setattr(api, 'discover_internal', discover)
    monkeypatch.setattr(api, 'authenticate', AsyncMock(return_value=SimpleNamespace(ops=['answer'], role='STAFF')))
    async def run():
        outer = request_timing.model_limits.set(document_limits())
        try:
            # Discovery adapters are replaced; input/auth validation is covered
            # separately. Exercise the actual endpoint's context lifetime here.
            if customer:
                call = api.customer_catalog_plan(SimpleNamespace(sources=[], headings=[]),
                    SimpleNamespace(ops=['customer_knowledge']))
            else:
                call = api.internal_catalog_plan(None, Request({'type': 'http', 'headers': []}))
            if fail:
                with pytest.raises(ValueError, match='Synthetic discovery failure'):
                    await call
            else:
                await call
            assert api.scoped_answer_model() == 'Qwen/Qwen3.6-35B-A3B'
        finally:
            request_timing.model_limits.reset(outer)
    asyncio.run(run())


def test_indexed_transport_restores_all_original_text_addresses_and_contexts():
    units = [
        {'i': 0, 'heading': 'Guide / Payments', 'text': 'Only after confirmation.'},
        {'i': 2, 'heading': 'Guide / Payments', 'text': 'Never hold inventory.',
         'also_at': [{'i': 4, 'heading': 'Guide / FAQ'}]},
        {'i': 5, 'heading': 'Guide / FAQ', 'text': 'Text with \"quotes\"\nnext line.'},
    ]
    original = copy.deepcopy(units)
    packet = indexed_units(units)
    restored = []
    for address, heading, text, duplicates in packet['rows']:
        unit = {'i': address, 'heading': packet['headings'][heading], 'text': text}
        if duplicates:
            unit['also_at'] = [{'i': i, 'heading': packet['headings'][h]} for i, h in duplicates]
        restored.append(unit)
    assert restored == original == units
    assert indexed_units(units[1:])['headings'][0] == 'Guide / Payments'



def test_compact_draft_keeps_address_bounds_and_restores_canonical_shape():
    from pydantic import ValidationError
    from rag.document_support import composition_schema
    from rag.draft_transport import compact_draft_schema, restore_draft
    schema = composition_schema(3, 2)
    compact = compact_draft_schema(schema)
    draft = compact(s='FACTUAL', b=[{'t': 'Only after confirmation.', 'p': [1]}])
    restored = restore_draft(draft, schema)
    assert restored.blocks[0].text == 'Only after confirmation.'
    assert restored.blocks[0].support == [1]
    assert restored.blocks[0].kind == 'text'
    assert compact.model_json_schema() != compact_draft_schema(composition_schema(100, 3)).model_json_schema()
    with pytest.raises(ValidationError):
        restore_draft(compact(s='FACTUAL', b=[{'t': 'Invented address.', 'p': [3]}]), schema)
    with pytest.raises(ValidationError):
        restore_draft(compact(s='FACTUAL', b=[{'t': 'Too many addresses.', 'p': [0, 1, 2]}]), schema)


def test_customer_wire_schema_enforces_actual_canonical_bounds_before_restoration():
    from pydantic import ValidationError
    from rag.document_support import composition_schema
    from rag.draft_transport import compact_draft_schema, restore_draft
    canonical = composition_schema(2, 3)
    wire = compact_draft_schema(canonical, customer=True)
    with pytest.raises(ValidationError):
        wire(s='FACTUAL', b=[{'t': 'Not a real source address.', 'p': [99]}])
    assert restore_draft(wire(s='FACTUAL', b=[{'t': 'Real address.', 'p': [1]}]), canonical).blocks[0].support == [1]


@pytest.mark.parametrize('complete', [True, False])
def test_compact_draft_still_checks_every_original_and_rejects_omissions(monkeypatch, complete):
    import asyncio
    import hashlib
    from fastapi import HTTPException
    from rag.batched_support import batched_document_answer
    from rag.document_support import Verification
    monkeypatch.setenv('RAG_QWEN_COMPACT_DRAFT', 'true')
    monkeypatch.setenv('RAG_QWEN_INDEXED_SOURCES', 'true')
    monkeypatch.delenv('RAG_TASK_FRAMED_DRAFT', raising=False)
    text = 'Review proof.\n\nNever hold inventory.'
    seen = []
    async def generate(prompt, data, schema):
        seen.append(data)
        assert [row[2] for row in data['units']['rows']] == text.split('\n\n')
        if 'answer' not in data:
            return schema(s='FACTUAL', b=[{'t': 'Review proof.', 'p': [0]}])
        assert data['answer']['blocks'][0]['support'] == [0]
        assert data['evidence'][0]['text'] == 'Review proof.'
        return Verification(relevant=True, supported=True, complete=complete, consistent=True, safe=True)
    source = {'chunk_id': 'one', 'heading_path': 'Rules', 'content': text,
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    operation = batched_document_answer('How?', [source], generate, actor_role='ADMIN')
    if complete:
        assert asyncio.run(operation)['spans'][0]['quote'] == 'Review proof.'
    else:
        with pytest.raises(HTTPException, match='UNRESOLVED_CONTEXT'):
            asyncio.run(operation)
    assert len(seen) == 2


def test_invalid_compact_address_fails_before_verification(monkeypatch):
    import asyncio
    import hashlib
    from fastapi import HTTPException
    from rag.batched_support import batched_document_answer
    monkeypatch.setenv('RAG_QWEN_COMPACT_DRAFT', 'true')
    monkeypatch.delenv('RAG_TASK_FRAMED_DRAFT', raising=False)
    calls = []
    async def generate(prompt, data, schema):
        calls.append(data)
        from types import SimpleNamespace
        return schema.model_construct(s='FACTUAL', b=[SimpleNamespace(t='Unsupported.', p=[99])])
    text = 'Original rule.'
    source = {'chunk_id': 'one', 'heading_path': 'Rules', 'content': text,
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    with pytest.raises(HTTPException, match='INVALID_MODEL_OUTPUT'):
        asyncio.run(batched_document_answer('How?', [source], generate, actor_role='ADMIN'))
    assert len(calls) == 1
