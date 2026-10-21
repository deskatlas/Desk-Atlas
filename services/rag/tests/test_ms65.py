"""MS65: General document RAG reliability and evidence contract repair tests."""
import pytest
from app import scope_clarification, Coverage


def test_shift_monitoring_reaches_retrieval():
    queries = [
        "Hey, I'm new at the front desk. What should I keep an eye on during my shift?",
        "What should I keep an eye on during my shift?",
        "What should I monitor during my shift?",
        "What should I look out for during my shift?",
    ]
    for q in queries:
        clarification = scope_clarification(q, fresh=True)
        assert clarification is None


def test_handover_clarification_distinguished_from_monitoring():
    handover_q = "I'm finishing my shift now."
    clarification = scope_clarification(handover_q, fresh=True)
    assert clarification == 'Are you handing over your shift or closing the facility?'


def test_reconsideration_gap_message_is_truthful(monkeypatch):
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    import app
    request = app.ContextInput(query='Describe monitoring duties.', original_query='What should I monitor?',
        sources=[app.SelectionSource(chunk_id='canonical', title='Guide', heading_path='Duties', content='Monitor occupancy.')],
        contract_version=3, reliability_contract='ms60-v1', reconsider=True,
        prior_coverage=Coverage(scope='RECOMMENDATION', outcome='COMPLETE', gaps=[]),
        prior_obligations=[app.RequestedObligation(id='o0',request='Monitoring duties',kind='RECOMMENDATION',status='SUPPORTED',chunk_ids=['canonical'])])
    monkeypatch.setattr(app, 'generate', AsyncMock(return_value=app.ContextIndexSelection(p=[], a=False)))
    result = asyncio.run(app.context_selection(request, SimpleNamespace(ops=['answer'])))
    assert result['chunk_ids'] == []
    assert 'supported capacity' in result['coverage']['gaps'][0]
    assert result['obligations'][0]['status'] == 'UNVERIFIED'


def test_qualified_monitoring_is_not_forced_to_clarify():
    for fresh in (True, False):
        assert scope_clarification('What should I monitor on the payment screen during my shift?', fresh) is None


def test_unqualified_monitoring_can_retrieve_an_overview():
    assert scope_clarification('What should I monitor during my shift?', True) is None


def test_partition_preserves_every_canonical_unit_and_utf16():
    import hashlib
    from rag.document_support import canonical_units, partition
    sources = [{'chunk_id': str(i), 'content': f'Rule {i}: verify the badge. 🌍',
                'content_hash': hashlib.sha256(f'Rule {i}: verify the badge. 🌍'.encode()).hexdigest(),
                'heading_path': 'Operations'} for i in range(40)]
    units = canonical_units(sources)
    assert [u for b in partition(units) for u in b] == units
    assert len(units) == 40
    assert units[0]['end'] == len(sources[0]['content']) + 1


def test_generated_heading_prefix_is_context_not_duplicate_source_evidence():
    import hashlib
    from rag.document_support import canonical_units
    heading = 'Operations 🌍 / Entry'
    body = '# Entry\nNever admit a guest before payment.\n\nKeep the reference private.'
    content = heading + '\n\n' + body
    units = canonical_units([{'chunk_id': 'one', 'heading_path': heading, 'content': content,
                              'content_hash': hashlib.sha256(content.encode()).hexdigest()}])
    assert [u['text'] for u in units] == ['# Entry\nNever admit a guest before payment.', 'Keep the reference private.']
    assert all(u['heading'] == heading for u in units)
    for unit in units:
        assert content.encode('utf-16-le')[unit['start'] * 2:unit['end'] * 2].decode('utf-16-le') == unit['text']


def test_actual_heading_without_generated_prefix_remains_evidence():
    import hashlib
    from rag.document_support import canonical_units
    content = 'Payment prerequisites\nNever admit a guest before payment.'
    units = canonical_units([{'chunk_id': 'one', 'heading_path': 'Payment prerequisites', 'content': content,
                              'content_hash': hashlib.sha256(content.encode()).hexdigest()}])
    assert units[0]['text'] == content


def test_many_split_chunks_keep_all_source_bodies_within_unchanged_budget():
    import hashlib
    from rag.document_support import canonical_units, partition, BUDGET
    heading = 'Customer workspace guidance / ' + 'Situational recommendations ' * 5
    sources = []
    for i in range(134):
        body = f'# Scenario {i}\n' + 'Preserve the documented conditions. ' * 10
        content = heading + '\n\n' + body
        sources.append({'chunk_id': str(i), 'heading_path': heading, 'content': content,
                        'content_hash': hashlib.sha256(content.encode()).hexdigest()})
    units = canonical_units(sources)
    bundles = partition(units)
    assert len(bundles) <= BUDGET['bundles'] == 24
    assert len(units) == len(sources)
    assert [u['text'] for u in units] == [s['content'][len(heading) + 2:].strip() for s in sources]


def test_distant_restriction_is_checked_even_when_selector_omits_it():
    import asyncio
    import hashlib
    from fastapi import HTTPException
    from rag.document_support import document_answer, Inspection, Composition, Verification
    text = 'Allow access after verification.\n\nNever allow access before confirmed payment.'
    source = {'chunk_id': 'canonical', 'heading_path': 'Procedure', 'content': text,
              'content_hash': hashlib.sha256(text.encode()).hexdigest()}
    checks = 0
    async def generate(prompt, data, schema):
        nonlocal checks
        if schema is Inspection:
            return Inspection(relevant=[0], unresolved=False)
        if schema is Composition:
            return Composition(scope='COMPLETE_PROCEDURE', outcome='COMPLETE', clarification='',
                               blocks=[{'kind': 'step', 'text': 'Allow access after verification.', 'support': [0]}])
        checks += 1
        return Verification(relevant=True, supported=True, complete=checks == 1, consistent=True, safe=True)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(document_answer('How do I admit a customer?', [source], generate))
    assert caught.value.detail == 'UNRESOLVED_CONTEXT'
    assert checks == 2


def test_more_than_six_chunks_can_supply_one_complete_answer():
    import asyncio
    import hashlib
    from rag.document_support import document_answer, Inspection, Composition, Verification
    sources = [{'chunk_id': str(i), 'content': f'Action {i}.', 'heading_path': 'Procedure',
                'content_hash': hashlib.sha256(f'Action {i}.'.encode()).hexdigest()} for i in range(8)]
    async def generate(prompt, data, schema):
        if schema is Inspection:
            return Inspection(relevant=[u['i'] for u in data['units']], unresolved=False)
        if schema is Composition:
            return Composition(scope='COMPLETE_PROCEDURE', outcome='COMPLETE', clarification='',
                blocks=[{'kind': 'step', 'text': s['content'], 'support': [i]} for i, s in enumerate(sources)])
        return Verification(relevant=True, supported=True, complete=True, consistent=True, safe=True)
    result = asyncio.run(document_answer('Explain the whole procedure.', sources, generate))
    assert result['outcome'] == 'COMPLETE'
    assert len(result['spans']) == 8
    assert len(result['synthesis']['blocks']) == 8


def test_acceptance_does_not_turn_component_success_into_milestone_completion():
    from test_ms63 import bundle
    from ms65_acceptance import evaluate
    from rag.identity import canonical_digest
    from rag.document_support import BUDGET
    data, lock, value = bundle()
    manifest = {'dataset_digest': lock['dataset_digest'], 'budget_digest': canonical_digest(BUDGET),
                'documents': [], 'conversations': [], 'audit_case_ids': [], 'observations': []}
    report = evaluate(data, lock, value, manifest)
    assert not report['evaluation_ready'] and not report['release_ready']
    assert 'MS65:HELD_OUT_SAMPLE_MINIMA' in report['pending']
    assert 'MS65:SUPPORT_AND_WORK_MEASUREMENTS_MISSING' in report['pending']
    manifest['budget_digest'] = '0' * 64
    with pytest.raises(ValueError, match='STALE_MS65_MANIFEST'):
        evaluate(data, lock, value, manifest)


def test_private_document_endpoint_requires_identity_and_negotiated_contract(monkeypatch):
    import asyncio
    import httpx
    from app import app
    import secrets
    monkeypatch.setenv('RAG_SERVICE_TOKEN', secrets.token_hex(32))
    payload = {'contract': 'ms65-v1', 'query': 'Explain the rule.', 'sources': [{
        'document_id': 'document', 'version_id': 'version', 'chunk_id': 'chunk', 'title': 'Guide',
        'heading_path': 'Rule', 'source_page': None, 'epoch': 1, 'extraction_method': 'TEXT',
        'content_hash': 'a' * 64, 'content': 'Verify the badge.'}]}
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            denied = await client.post('/v1/document-support', json=payload)
            assert denied.status_code == 401
            payload['contract'] = 'unknown'
            invalid = await client.post('/v1/document-support', json=payload)
            assert invalid.status_code == 422
            assert 'Verify the badge' not in invalid.text
    asyncio.run(run())


def test_partition_refuses_aggregate_overflow_without_truncation():
    from fastapi import HTTPException
    from rag.document_support import partition, BUDGET
    units = [{'i': i, 'text': 'x' * 1400} for i in range(200)]
    with pytest.raises(HTTPException) as caught:
        partition(units)
    assert caught.value.detail == 'CONTEXT_BUDGET_EXCEEDED'
    assert len(units) == 200


def test_new_diagnostics_can_account_for_more_than_six_support_chunks():
    from rag.reliability import validate_diagnostics
    value = {'schema_version': 2, 'stage': 'support', 'failures': [],
             'counts': {'bundle_count': 2, 'support_passes': 6, 'support_units': 40},
             'ranked_units': ['a' * 64] * 8, 'closure_units': ['b' * 64] * 40}
    validate_diagnostics(value)
    value['schema_version'] = 1
    with pytest.raises(ValueError):
        validate_diagnostics(value)


def test_source_mutation_is_rejected_before_any_inference():
    import hashlib
    from fastapi import HTTPException
    from rag.document_support import canonical_units
    source = {'chunk_id': 'one', 'content': 'Changed text', 'heading_path': 'Policy',
              'content_hash': hashlib.sha256(b'Original text').hexdigest()}
    with pytest.raises(HTTPException) as caught:
        canonical_units([source])
    assert caught.value.detail == 'INVALID_MODEL_OUTPUT'


@pytest.mark.parametrize('synthesis', [False, True])
def test_exact_mode_and_schema_failure_still_require_independent_checks(synthesis):
    import asyncio
    import hashlib
    from fastapi import HTTPException
    from rag.document_support import document_answer, Inspection, Composition, Verification
    source = {'chunk_id': 'one', 'content': 'Verify payment before access.', 'heading_path': 'Rule',
              'content_hash': hashlib.sha256(b'Verify payment before access.').hexdigest()}
    checks = []
    async def generate(prompt, data, schema):
        if schema is Inspection:
            return Inspection(relevant=[0], unresolved=False)
        if schema is Composition:
            assert synthesis
            raise HTTPException(503, detail='INVALID_MODEL_OUTPUT')
        checks.append(data)
        return Verification(relevant=True, supported=True, complete=True, consistent=True, safe=True)
    result = asyncio.run(document_answer('Explain access.', [source], generate, synthesis))
    assert result['outcome'] == 'COMPLETE'
    assert result['synthesis']['blocks'][0]['text'] == source['content']
    assert len(checks) == 2


def test_unknown_unit_selection_cannot_fabricate_proof():
    import asyncio
    import hashlib
    from fastapi import HTTPException
    from rag.document_support import document_answer, Inspection
    source = {'chunk_id': 'one', 'content': 'Verify the badge.', 'heading_path': 'Rule',
              'content_hash': hashlib.sha256(b'Verify the badge.').hexdigest()}
    async def generate(prompt, data, schema):
        return Inspection(relevant=[42], unresolved=False)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(document_answer('Explain access.', [source], generate))
    assert caught.value.detail == 'INVALID_MODEL_OUTPUT'


def test_aggregate_admission_uses_actual_model_wire_before_inference():
    from rag import request_timing
    state = {'calls': 0, 'bytes': 0, 'output': 0, 'max_calls': 2, 'max_bytes': 300, 'max_output': 50}
    token = request_timing.work.set(state)
    try:
        assert request_timing.reserve_model_work(150, 20)
        assert not request_timing.reserve_model_work(151, 20)
        assert state['calls'] == 1 and state['bytes'] == 150
        assert not request_timing.reserve_model_work(100, 31)
        assert request_timing.reserve_model_work(150, 30)
        assert not request_timing.reserve_model_work(0, 0)
    finally:
        request_timing.work.reset(token)
    assert request_timing.work.get() is None
